import { mkdir, mkdtemp, open, readdir, rm, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { AssetMediaStatus } from '@immich/sdk';
import {
  copyTagsAndAlbums,
  downloadOriginal,
  getAlbumIdsForAsset,
  getAssetBrief,
  getAssetSnapshot,
  readMotionState,
  readStoredOriginalSize,
  removeOriginal,
  sha1Base64,
  trashAssets,
  unlinkMotionVideo,
  uploadReplacement,
  verifyReplacement,
  type AssetSnapshot,
} from './immich.js';
import { runProcess } from './optimizer.js';
import { recordReplacement } from './stats.js';

const STRIP_TIMEOUT_MS = 2 * 60 * 1000;
const IDENTIFY_TIMEOUT_MS = 30 * 1000;
const METADATA_WAIT_MS = 30 * 1000;
const METADATA_POLL_MS = 1000;

let workRoot = '';

/**
 * Scratch space for rewriting stills. Directories are removed in `removeMotionFromAsset`, and any
 * leftover from a crash is removed here at startup, so a stopped job cannot leak files.
 */
export async function initializeMotion(dataDir: string): Promise<void> {
  workRoot = join(dataDir, 'work', 'motion');
  await mkdir(workRoot, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(workRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    await rm(join(workRoot, entry.name), { recursive: true, force: true }).catch(() => undefined);
  }
}

export type MotionOutcome =
  /** The JPEG was rewritten without its video and replaced by a new asset; the original is in the trash. */
  | { status: 'stripped'; replacementId: string; bytesBefore: number; bytesAfter: number }
  /** The video is a separate Immich asset (iPhone live photo): the link was removed and the video trashed. */
  | { status: 'unlinked'; videoId: string }
  /** Nothing to do; the reason is shown to the person who queued the job. */
  | { status: 'skipped'; reason: string };

export interface MotionInspection {
  /** Motion metadata or trailing bytes were found; the file carries its video. */
  hasMotion: boolean;
  hasMarkers: boolean;
  hasTrailer: boolean;
}

function isJpeg(asset: { originalFileName: string; originalMimeType: string | null }): boolean {
  const extension = extname(asset.originalFileName).toLowerCase();
  const mime = (asset.originalMimeType ?? '').toLowerCase();
  return (extension === '.jpg' || extension === '.jpeg') && (!mime || mime === 'image/jpeg');
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Every tag exiftool reports, keyed by family 1 group and name, as numbers where numeric. */
async function readExif(path: string): Promise<Record<string, unknown>> {
  const output = await runProcess('exiftool', ['-j', '-G1', '-n', path], IDENTIFY_TIMEOUT_MS);
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('exiftool returned unreadable metadata');
  }
  const first = Array.isArray(parsed) ? parsed[0] : null;
  if (typeof first !== 'object' || first === null) throw new Error('exiftool returned no metadata for the file');
  return first as Record<string, unknown>;
}

/** A JPEG ends with its end-of-image marker; anything after it is a trailer, such as a motion video. */
async function endsAtJpegEnd(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (info.size < 4) return false;
    const tail = Buffer.alloc(2);
    await handle.read(tail, 0, 2, info.size - 2);
    return tail[0] === 0xff && tail[1] === 0xd9;
  } finally {
    await handle.close();
  }
}

function values(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  return value === undefined ? [] : [String(value)];
}

/**
 * Android motion photos mark the embedded video in the Google camera namespace (`MicroVideo*` or
 * `MotionPhoto*`) or list it in a container directory with the semantic `MotionPhoto`. Exiftool
 * calls the container namespace `GContainer`.
 */
function hasMotionMarkers(tags: Record<string, unknown>): boolean {
  const microVideo = tags['XMP-GCamera:MicroVideo'];
  if (microVideo !== undefined && Number(microVideo) !== 0) return true;
  const motionPhoto = tags['XMP-GCamera:MotionPhoto'];
  if (motionPhoto !== undefined && Number(motionPhoto) !== 0) return true;
  if (tags['XMP-GCamera:MicroVideoOffset'] !== undefined) return true;

  const semantics = [
    ...values(tags['XMP-GContainer:DirectoryItemSemantic']),
    ...values(tags['GContainer:DirectoryItemSemantic']),
  ];
  if (semantics.some((value) => /motionphoto/i.test(value))) return true;

  const mimes = [...values(tags['XMP-GContainer:DirectoryItemMime']), ...values(tags['GContainer:DirectoryItemMime'])];
  return mimes.some((value) => /^video\//i.test(value));
}

export async function inspectMotion(path: string): Promise<MotionInspection> {
  const [tags, endsCleanly] = await Promise.all([readExif(path), endsAtJpegEnd(path)]);
  const hasMarkers = hasMotionMarkers(tags);
  return { hasMotion: hasMarkers || !endsCleanly, hasMarkers, hasTrailer: !endsCleanly };
}

async function imageShape(path: string): Promise<{ format: string; width: number; height: number }> {
  const output = await runProcess('magick', ['identify', '-quiet', '-format', '%m %w %h', path], IDENTIFY_TIMEOUT_MS);
  const [format, width, height] = output.trim().split(/\s+/);
  const shape = { format: format ?? '', width: Number(width), height: Number(height) };
  if (!shape.format || !Number.isInteger(shape.width) || !Number.isInteger(shape.height)) {
    throw new Error('The image could not be measured');
  }
  return shape;
}

/**
 * Copies the JPEG into `outputPath` without its motion video and without the metadata that points at
 * it. The source file is not touched. Every result is checked before it is returned: the still must
 * be a smaller, valid JPEG with the same pixel size and no motion metadata or trailing bytes.
 */
export async function stripMotionStill(options: { sourcePath: string; outputPath: string; sourceSize: number }): Promise<{ path: string; size: number }> {
  await runProcess(
    'exiftool',
    [
      '-m', '-q', '-q',
      '-o', options.outputPath,
      '-XMP-GCamera:all=',
      '-XMP-GContainer:all=',
      '-Trailer:All=',
      options.sourcePath,
    ],
    STRIP_TIMEOUT_MS,
  );

  const output = await stat(options.outputPath).catch(() => null);
  if (!output?.isFile() || output.size === 0) throw new Error('exiftool produced no still image');
  if (output.size >= options.sourceSize) throw new Error('The still is not smaller than the motion photo; nothing was changed');

  const [before, after, inspection] = await Promise.all([
    imageShape(options.sourcePath),
    imageShape(options.outputPath),
    inspectMotion(options.outputPath),
  ]);
  if (after.format !== 'JPEG') throw new Error(`The still is ${after.format || 'an unknown format'}, not JPEG`);
  if (after.width !== before.width || after.height !== before.height) {
    throw new Error(`The still is ${after.width}×${after.height} but the original is ${before.width}×${before.height}`);
  }
  if (inspection.hasMotion) {
    const detail = [inspection.hasMarkers ? 'motion metadata' : '', inspection.hasTrailer ? 'trailing video data' : '']
      .filter((part) => part !== '')
      .join(' and ');
    throw new Error(`The still still carries ${detail}; nothing was changed`);
  }
  return { path: options.outputPath, size: output.size };
}

/**
 * Waits until Immich has extracted the replacement's metadata, then confirms that it is a still.
 * The link and the motion flag can appear a moment after the upload returns, so checking them in the
 * same pass as the tags would race the metadata job. A file whose metadata never arrives is accepted:
 * the rewritten file is already proven clean locally, and this only confirms that Immich agrees.
 */
async function settleReplacement(assetId: string): Promise<void> {
  const deadline = Date.now() + METADATA_WAIT_MS;
  let state = await readMotionState(assetId);
  while (!state.ready && Date.now() <= deadline) {
    await delay(METADATA_POLL_MS);
    state = await readMotionState(assetId);
  }
  if (state.livePhotoVideoId !== null) {
    throw new Error(`Immich linked a motion video (${state.livePhotoVideoId}) to the replacement; original retained`);
  }
  if (state.isMotion) throw new Error('Immich still classifies the replacement as a motion photo; original retained');
}

/** Detaches a separate video asset (iPhone live photos) and trashes it. */
async function unlinkRecipe(asset: AssetSnapshot): Promise<MotionOutcome> {
  const videoId = asset.livePhotoVideoId;
  if (!videoId) return { status: 'skipped', reason: 'no embedded motion video and no linked video' };
  // Never trust the link blindly: it must point at a different, live video asset, otherwise the
  // trash step could remove the still itself or an unrelated asset.
  if (videoId === asset.id) throw new Error('Immich reports the motion video as the image itself; nothing was changed');
  const linked = await getAssetBrief(videoId);
  if (!linked.isVideo || linked.isTrashed) {
    throw new Error(`Linked asset is ${linked.isTrashed ? 'already trashed' : 'not a video'}; nothing was changed`);
  }
  const remaining = await unlinkMotionVideo(asset.id);
  if (remaining) throw new Error('Immich still reports the motion video as linked');
  await trashAssets([videoId]);
  return { status: 'unlinked', videoId };
}

/**
 * Removes the motion video from one still.
 *
 * A JPEG that carries its video (Android motion photo) is rewritten without it and uploaded as a new
 * asset. The new asset must be readable at the uploaded size, carry every original tag and album, and
 * no longer be a motion photo before the original is moved to the Immich trash. A failure after the
 * upload moves the replacement to the trash instead, so the original is never lost.
 *
 * Any other asset keeps the old path: the linked video is detached and trashed, and the still stays
 * as it is.
 */
export async function removeMotionFromAsset(assetId: string): Promise<MotionOutcome> {
  if (!workRoot) throw new Error('The motion work directory is not ready');
  const asset = await getAssetSnapshot(assetId);
  if (asset.isTrashed) throw new Error('Asset is already in Immich trash');
  if (!isJpeg(asset)) return unlinkRecipe(asset);

  const directory = await mkdtemp(join(workRoot, `motion-${assetId.slice(0, 8)}-`));
  const sourcePath = join(directory, 'source.jpg');
  try {
    const sourceSize = await downloadOriginal(assetId, sourcePath);
    if (sourceSize === 0) throw new Error('Immich returned an empty original file');
    if (await sha1Base64(sourcePath) !== asset.checksum) {
      throw new Error('Downloaded original checksum does not match Immich metadata');
    }

    const inspection = await inspectMotion(sourcePath);
    // A JPEG without embedded motion is an iPhone-style live photo at most, so only the link can go.
    if (!inspection.hasMotion) return await unlinkRecipe(asset);

    const still = await stripMotionStill({ sourcePath, outputPath: join(directory, 'still.jpg'), sourceSize });

    // The original may have changed while the download and rewrite ran; never replace a newer file.
    const current = await getAssetSnapshot(assetId);
    if (current.isTrashed || current.checksum !== asset.checksum) {
      throw new Error('Original asset changed or was trashed after it was read; replacement refused');
    }
    const albumIds = await getAlbumIdsForAsset(assetId);
    const uploaded = await uploadReplacement({
      filePath: still.path,
      filename: asset.originalFileName,
      mimeType: 'image/jpeg',
      fileCreatedAt: current.fileCreatedAt,
      fileModifiedAt: current.fileModifiedAt,
      isFavorite: current.isFavorite,
      visibility: current.visibility,
      livePhotoVideoId: null,
    });
    if (uploaded.status !== AssetMediaStatus.Created || uploaded.id === assetId) {
      throw new Error('Immich reported a duplicate upload; original retained and no metadata or deletion attempted');
    }

    try {
      const stored = await readStoredOriginalSize(uploaded.id);
      if (!stored.readable) throw new Error('Immich could not serve the uploaded still back; original retained');
      if (stored.size !== null && stored.size !== still.size) {
        throw new Error(`Immich stored ${stored.size} bytes for the still but ${still.size} were uploaded; original retained`);
      }
      const tagIds = [...new Set(current.tagIds)];
      await copyTagsAndAlbums({ newAssetId: uploaded.id, tagIds, albumIds });
      // The live-photo link is judged after metadata extraction, in `settleReplacement`.
      await verifyReplacement({ assetId: uploaded.id, checksum: uploaded.checksum, tagIds, albumIds });
      await settleReplacement(uploaded.id);
    } catch (error) {
      // The replacement is unusable or unverified: drop it so the library does not keep an extra
      // still, and leave the original in place.
      await trashAssets([uploaded.id]).catch(() => undefined);
      throw error;
    }

    await removeOriginal(assetId);
    recordReplacement({ before: sourceSize, after: still.size, reclaimed: true, at: Date.now() });
    return { status: 'stripped', replacementId: uploaded.id, bytesBefore: sourceSize, bytesAfter: still.size };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
