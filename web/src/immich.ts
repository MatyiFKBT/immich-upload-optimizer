import {
  addAssetsToAlbums,
  AssetOrder,
  AssetTypeEnum,
  AssetVisibility,
  CalendarHeatmapType,
  deleteAssets,
  getAllAlbums,
  getAssetInfo,
  getAssetOriginalPath,
  getAssetThumbnailPath,
  getAllTags,
  getMyCalendarHeatmap,
  getPeopleThumbnailPath,
  init,
  searchAssets,
  updateAsset,
  updateAssets,
  upsertTags,
  uploadAsset,
  bulkTagAssets,
  SearchOrderField,
} from '@immich/sdk';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, openAsBlob } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAX_ASSET_BYTES = 1024 * 1024 * 1024;
const TRANSFER_TIMEOUT_MS = 15 * 60 * 1000;

export interface SearchAsset {
  id: string;
  originalFileName: string;
  originalMimeType: string | null;
  fileCreatedAt: string;
  fileModifiedAt: string;
  isFavorite: boolean;
  isTrashed: boolean;
  checksum: string;
  size: number | null;
  livePhotoVideoId: string | null;
}

export interface AssetSnapshot extends SearchAsset {
  visibility: AssetVisibility;
  tagIds: string[];
}

export interface AlbumSummary {
  id: string;
  albumName: string;
}

let apiBaseUrl = '';
let apiKey = '';

export function configureImmich(baseUrl: string, key: string): void {
  apiBaseUrl = baseUrl.replace(/\/+$/, '');
  apiKey = key;
  init({ baseUrl: apiBaseUrl, apiKey });
}

function mapAsset(asset: Awaited<ReturnType<typeof getAssetInfo>>): SearchAsset {
  return {
    id: asset.id,
    originalFileName: asset.originalFileName,
    originalMimeType: asset.originalMimeType ?? null,
    fileCreatedAt: asset.fileCreatedAt,
    fileModifiedAt: asset.fileModifiedAt,
    isFavorite: asset.isFavorite,
    isTrashed: asset.isTrashed,
    checksum: asset.checksum,
    livePhotoVideoId: asset.livePhotoVideoId ?? null,
    size: asset.exifInfo?.fileSizeInByte ?? null,
  };
}

export async function listAlbums(): Promise<AlbumSummary[]> {
  const albums = await getAllAlbums({});
  return albums.map((album) => ({ id: album.id, albumName: album.albumName }));
}

export async function searchImages(options: {
  albumId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  size: number;
}): Promise<{ items: SearchAsset[]; nextCursor: string | null; total: number }> {
  const filter: {
    type: { eq: AssetTypeEnum };
    trashedAt: { eq: null };
    albumIds?: { any: string[] };
    takenAt?: { gte?: string; lte?: string };
  } = { type: { eq: AssetTypeEnum.Image }, trashedAt: { eq: null } };
  if (options.albumId) filter.albumIds = { any: [options.albumId] };
  if (options.from || options.to) {
    const takenAt: { gte?: string; lte?: string } = {};
    if (options.from) takenAt.gte = `${options.from}T00:00:00.000Z`;
    if (options.to) takenAt.lte = `${options.to}T23:59:59.999Z`;
    filter.takenAt = takenAt;
  }

  const response = await searchAssets({
    metadataSearchDto: {
      filter,
      size: options.size,
      withExif: true,
      ...(options.cursor ? { cursor: options.cursor } : {}),
      orderBy: { direction: AssetOrder.Desc, field: SearchOrderField.FileCreatedAt },
    },
  });
  const items = response.assets.items.map(mapAsset);
  return { items, nextCursor: response.assets.nextCursor ?? null, total: response.assets.total };
}

export async function getAssetSnapshot(id: string): Promise<AssetSnapshot> {
  const asset = await getAssetInfo({ id });
  return {
    ...mapAsset(asset),
    visibility: asset.visibility,
    tagIds: (asset.tags ?? []).map((tag) => tag.id),
  };
}

export async function getAlbumIdsForAsset(id: string): Promise<string[]> {
  const albums = await getAllAlbums({ assetId: id });
  return albums.map((album) => album.id);
}

/** Whether Immich has finished extracting an asset's metadata, so EXIF-derived fields are final. */
export async function assetHasMetadata(id: string): Promise<boolean> {
  const asset = await getAssetInfo({ id });
  return asset.hasMetadata;
}

/**
 * True while Immich still classifies an asset as a motion photo. Immich exposes this only as a search
 * filter, not on the asset itself, so this is the one way to confirm a replacement carries no video.
 * The asset id must be part of the filter too: Immich rejects the top-level `id` field as deprecated
 * when it is combined with a filter, and answers with HTTP 400.
 */
export async function assetIsMotion(id: string): Promise<boolean> {
  const response = await searchAssets({
    metadataSearchDto: { filter: { id: { eq: id }, isMotion: { eq: true } }, size: 1 },
  });
  return response.assets.items.some((asset) => asset.id === id);
}


async function streamResponseToFile(response: Response, destination: string): Promise<number> {
  if (!response.ok || !response.body) {
    throw new Error(`Immich file request failed with HTTP ${response.status}`);
  }
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (contentLength > MAX_ASSET_BYTES) {
    await response.body.cancel();
    throw new Error('Asset exceeds the 1 GiB processing limit');
  }

  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.byteLength;
      if (received > MAX_ASSET_BYTES) {
        callback(new Error('Asset exceeds the 1 GiB processing limit'));
      } else {
        callback(null, chunk);
      }
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>),
      limiter,
      createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
    );
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
  return received;
}

async function fetchImmichFile(path: string, destination: string): Promise<number> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: { 'x-api-key': apiKey },
    redirect: 'error',
    signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
  });
  return streamResponseToFile(response, destination);
}

export async function downloadOriginal(id: string, destination: string): Promise<number> {
  return fetchImmichFile(getAssetOriginalPath(id), destination);
}

/**
 * Confirms Immich can serve an asset's original and reports how many bytes it stores, using a
 * one-byte range request so the body is never downloaded. Used to prove a replacement is really
 * retrievable before any original is removed.
 */
export async function readStoredOriginalSize(assetId: string): Promise<{ readable: boolean; size: number | null }> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${getAssetOriginalPath(assetId)}`, {
      headers: { 'x-api-key': apiKey, range: 'bytes=0-0' },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { readable: false, size: null };
  }

  const contentRange = response.headers.get('content-range');
  const contentLength = response.headers.get('content-length');
  await response.body?.cancel();
  if (!response.ok) return { readable: false, size: null };

  const total = contentRange ? Number(/bytes \d+-\d+\/(\d+)/.exec(contentRange)?.[1] ?? Number.NaN) : Number.NaN;
  if (Number.isFinite(total)) return { readable: true, size: total };
  return { readable: true, size: contentLength ? Number(contentLength) : null };
}

export type ThumbnailSize = 'thumbnail' | 'preview';

export async function streamThumbnail(id: string, size: ThumbnailSize = 'thumbnail'): Promise<Response> {
  const path = `${getAssetThumbnailPath(id)}?size=${size}`;
  return fetch(`${apiBaseUrl}${path}`, {
    headers: { 'x-api-key': apiKey },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
}

/** The cropped face Immich stores for a person, used by the month view's face row. */
export async function streamPersonThumbnail(personId: string): Promise<Response> {
  return fetch(`${apiBaseUrl}${getPeopleThumbnailPath(personId)}`, {
    headers: { 'x-api-key': apiKey },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
}

export async function sha1Base64(filePath: string): Promise<string> {
  const hash = createHash('sha1');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('base64');
}

export async function uploadReplacement(options: {
  filePath: string;
  filename: string;
  mimeType: string;
  fileCreatedAt: string;
  fileModifiedAt: string;
  isFavorite: boolean;
  visibility: AssetVisibility;
  livePhotoVideoId: string | null;
}): Promise<{ id: string; status: string; checksum: string }> {
  const checksum = await sha1Base64(options.filePath);
  const filename = basename(options.filename);
  const blob = await openAsBlob(options.filePath, { type: options.mimeType });
  // Immich derives the asset type from the multipart file part's own filename. oazapfts appends a
  // bare Blob without a filename, which the runtime labels "blob" and Immich rejects with
  // "Unsupported file type blob", so the part must be a File carrying the real name.
  const assetData = new File([blob], filename, { type: options.mimeType });
  const result = await uploadAsset({
    xImmichChecksum: checksum,
    assetMediaCreateDto: {
      assetData,
      filename,
      fileCreatedAt: options.fileCreatedAt,
      fileModifiedAt: options.fileModifiedAt,
      isFavorite: options.isFavorite,
      ...(options.livePhotoVideoId ? { livePhotoVideoId: options.livePhotoVideoId } : {}),
      visibility: options.visibility,
    },
  });
  return { id: result.id, status: result.status, checksum };
}

export async function copyTagsAndAlbums(options: {
  newAssetId: string;
  tagIds: string[];
  albumIds: string[];
}): Promise<void> {
  if (options.tagIds.length > 0) {
    await bulkTagAssets({ tagBulkAssetsDto: { assetIds: [options.newAssetId], tagIds: options.tagIds } });
  }
  if (options.albumIds.length > 0) {
    const result = await addAssetsToAlbums({
      albumsAddAssetsDto: { albumIds: options.albumIds, assetIds: [options.newAssetId] },
    });
    if (!result.success) throw new Error('Immich did not confirm adding the replacement to its albums');
  }
}

export async function verifyReplacement(options: {
  assetId: string;
  checksum: string;
  tagIds: string[];
  albumIds: string[];
  livePhotoVideoId: string | null;
}): Promise<void> {
  const [asset, albums] = await Promise.all([
    getAssetInfo({ id: options.assetId }),
    getAllAlbums({ assetId: options.assetId }),
  ]);
  if (asset.isTrashed || asset.checksum !== options.checksum || (asset.livePhotoVideoId ?? null) !== options.livePhotoVideoId) {
    throw new Error('Replacement asset verification failed');
  }
  const actualTags = new Set((asset.tags ?? []).map((tag) => tag.id));
  for (const id of options.tagIds) {
    if (!actualTags.has(id)) throw new Error('Replacement is missing one or more original tags');
  }
  const actualAlbums = new Set(albums.map((album) => album.id));
  for (const id of options.albumIds) {
    if (!actualAlbums.has(id)) throw new Error('Replacement is missing one or more original albums');
  }
}

export async function removeOriginal(id: string): Promise<void> {
  await deleteAssets({ assetBulkDeleteDto: { ids: [id] } });
}

export interface MonthCount {
  month: number;
  count: number;
}

export interface AssetPerson {
  id: string;
  name: string;
}

export interface LibraryAsset {
  id: string;
  originalFileName: string;
  originalMimeType: string | null;
  localDateTime: string;
  fileCreatedAt: string;
  size: number | null;
  isVideo: boolean;
  visibility: AssetVisibility;
  /** Recognized, named people in the asset; unnamed or hidden clusters are left out. */
  people: AssetPerson[];
}

const MONTH_ASSET_LIMIT = 3000;
const MONTH_PAGE_SIZE = 250;

/** Per-month capture counts for a year, aggregated from Immich's per-day calendar heatmap. */
export async function getMonthCounts(year: number): Promise<{ year: number; months: MonthCount[]; total: number }> {
  const heatmap = await getMyCalendarHeatmap({
    $from: `${year}-01-01`,
    to: `${year}-12-31`,
    $type: CalendarHeatmapType.Taken,
  });
  const months: MonthCount[] = Array.from({ length: 12 }, (_unused, index) => ({ month: index + 1, count: 0 }));
  for (const day of heatmap.series) {
    const bucket = months[Number(day.date.slice(5, 7)) - 1];
    if (bucket) bucket.count += day.count;
  }
  return { year, months, total: heatmap.totalCount };
}

export interface MonthStorage {
  month: number;
  /** Captures Immich reports for the month, from the same heatmap the year grid counts with. */
  count: number;
  /** Estimated bytes the month's assets occupy. */
  bytes: number;
  /** How many assets the sum was taken from. */
  sampled: number;
  /** True when the month was too large to read in full and `bytes` was scaled from the sample. */
  estimated: boolean;
}

const STORAGE_SAMPLE_PAGES = 4;
const STORAGE_MONTH_WORKERS = 4;
const STORAGE_CACHE_MS = 10 * 60 * 1000;

const storageCache = new Map<number, { at: number; value: MonthStorage[] }>();
const storageInFlight = new Map<number, Promise<MonthStorage[]>>();

/**
 * Size of one month, read from the first page of its assets. Immich aggregates no sizes, and paging
 * a whole year of EXIF metadata would be dozens of requests, so a month that does not fit in one
 * page is scaled from it: the estimate is the sample's average per asset times the month's capture
 * count. Reading is only continued past the first page while that page held nothing from the month,
 * which a single very busy first day can cause.
 */
async function sampleMonthStorage(year: number, month: number, count: number): Promise<MonthStorage> {
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const filter: { trashedAt: { eq: null }; takenAt: { gte: string; lte: string } } = {
    trashedAt: { eq: null },
    takenAt: {
      gte: new Date(Date.UTC(year, month - 1, 1) - 86_400_000).toISOString(),
      lte: new Date(Date.UTC(year, month, 1) + 86_400_000).toISOString(),
    },
  };

  let cursor: string | undefined;
  let bytes = 0;
  let sampled = 0;
  let complete = false;
  for (let page = 0; page < STORAGE_SAMPLE_PAGES; page += 1) {
    const response = await searchAssets({
      metadataSearchDto: {
        filter,
        size: MONTH_PAGE_SIZE,
        withExif: true,
        ...(cursor ? { cursor } : {}),
        orderBy: { direction: AssetOrder.Asc, field: SearchOrderField.FileCreatedAt },
      },
    });
    for (const asset of response.assets.items) {
      const capturedAt = asset.localDateTime || asset.fileCreatedAt;
      if (!capturedAt.startsWith(monthPrefix)) continue;
      sampled += 1;
      bytes += asset.exifInfo?.fileSizeInByte ?? 0;
    }
    const nextCursor = response.assets.nextCursor ?? null;
    if (!nextCursor || response.assets.items.length === 0) {
      complete = true;
      break;
    }
    if (sampled > 0) break;
    cursor = nextCursor;
  }

  const estimated = !complete;
  const scale = estimated && sampled > 0 ? count / sampled : 1;
  return { month, count, bytes: Math.round(bytes * scale), sampled, estimated };
}

/** Per-month storage estimates for a year, newest requests served from a short-lived cache. */
export async function estimateMonthStorage(year: number): Promise<{ year: number; months: MonthStorage[] }> {
  const cached = storageCache.get(year);
  if (cached && Date.now() - cached.at < STORAGE_CACHE_MS) return { year, months: cached.value };

  const running = storageInFlight.get(year);
  if (running) return { year, months: await running };

  const pending = (async (): Promise<MonthStorage[]> => {
    const counts = await getMonthCounts(year);
    const populated = counts.months.filter((entry) => entry.count > 0);
    const months: MonthStorage[] = [];
    let next = 0;
    // A handful of months at a time keeps the request from turning into a burst against Immich.
    const worker = async (): Promise<void> => {
      for (;;) {
        const entry = populated[next];
        next += 1;
        if (!entry) return;
        // One unreadable month only costs its own number: the rest of the year still gets estimates.
        months.push(
          await sampleMonthStorage(year, entry.month, entry.count).catch(() => ({
            month: entry.month,
            count: entry.count,
            bytes: 0,
            sampled: 0,
            estimated: true,
          })),
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(STORAGE_MONTH_WORKERS, populated.length) }, worker));
    months.sort((left, right) => left.month - right.month);
    return months;
  })();

  storageInFlight.set(year, pending);
  try {
    const months = await pending;
    storageCache.set(year, { at: Date.now(), value: months });
    return { year, months };
  } finally {
    storageInFlight.delete(year);
  }
}

/**
 * Every asset whose local capture time falls in the given month, newest first, capped at
 * `MONTH_ASSET_LIMIT`. `takenAt` is compared in UTC while the month is derived from the asset's
 * local capture time, so the query range is widened by one day on each side and filtered exactly
 * afterwards. Immich's metadata search returns archived assets like any other, and the month view
 * reviews the timeline, so they are left out unless `includeArchived` asks for them.
 *
 * The exclusion has to name `locked` as well: Immich rejects any visibility filter that could still
 * match a locked asset with 401 "Elevated permission is required" unless the session is elevated, and
 * an explicit visibility filter also suppresses the `visibility != locked` condition Immich would
 * otherwise add on its own. `notIn` keeps every other visibility in play, so hidden assets are
 * returned exactly as they were before this filter existed.
 */
export async function listMonthAssets(
  year: number,
  month: number,
  options: { includeArchived?: boolean } = {},
): Promise<{ items: LibraryAsset[]; truncated: boolean; scanned: number; range: { from: string; to: string } }> {
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const filter: {
    trashedAt: { eq: null };
    takenAt: { gte: string; lte: string };
    visibility?: { notIn: AssetVisibility[] };
  } = {
    trashedAt: { eq: null },
    takenAt: {
      gte: new Date(Date.UTC(year, month - 1, 1) - 86_400_000).toISOString(),
      lte: new Date(Date.UTC(year, month, 1) + 86_400_000).toISOString(),
    },
  };
  if (!options.includeArchived) filter.visibility = { notIn: [AssetVisibility.Archive, AssetVisibility.Locked] };

  const items: LibraryAsset[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  let truncated = false;

  for (;;) {
    const response = await searchAssets({
      metadataSearchDto: {
        filter,
        size: MONTH_PAGE_SIZE,
        withExif: true,
        withPeople: true,
        ...(cursor ? { cursor } : {}),
        orderBy: { direction: AssetOrder.Asc, field: SearchOrderField.FileCreatedAt },
      },
    });
    scanned += response.assets.items.length;
    for (const asset of response.assets.items) {
      const capturedAt = asset.localDateTime || asset.fileCreatedAt;
      if (!capturedAt.startsWith(monthPrefix)) continue;
      items.push({
        id: asset.id,
        originalFileName: asset.originalFileName,
        originalMimeType: asset.originalMimeType ?? null,
        localDateTime: capturedAt,
        fileCreatedAt: asset.fileCreatedAt,
        size: asset.exifInfo?.fileSizeInByte ?? null,
        isVideo: asset.type === AssetTypeEnum.Video,
        visibility: asset.visibility,
        // Immich returns face clusters without a name for people nobody has labelled yet, and hidden
        // people on request; neither is worth a face in the tile.
        people: (asset.people ?? []).flatMap((person) =>
          person.isHidden || person.name.trim() === '' ? [] : [{ id: person.id, name: person.name }],
        ),
      });
      if (items.length >= MONTH_ASSET_LIMIT) {
        truncated = true;
        break;
      }
    }
    const nextCursor = response.assets.nextCursor ?? null;
    if (truncated || !nextCursor || response.assets.items.length === 0) break;
    cursor = nextCursor;
  }

  items.sort((left, right) => left.localDateTime.localeCompare(right.localDateTime));
  return { items, truncated, scanned, range: { from: filter.takenAt.gte, to: filter.takenAt.lte } };
}

export const OPTIMIZED_TAG_NAME = 'optimized';

let cachedOptimizedTagId: string | null = null;

/** The `optimized` tag if it exists; null when nothing has been compressed yet. */
export async function findOptimizedTagId(): Promise<string | null> {
  if (cachedOptimizedTagId) return cachedOptimizedTagId;
  const tags = await getAllTags({});
  const match = tags.find((tag) => tag.name.toLowerCase() === OPTIMIZED_TAG_NAME);
  if (match) cachedOptimizedTagId = match.id;
  return cachedOptimizedTagId;
}

/** Creates the `optimized` tag on first use; Immich upserts by name, so this is idempotent. */
export async function ensureOptimizedTagId(): Promise<string> {
  if (cachedOptimizedTagId) return cachedOptimizedTagId;
  const [tag] = await upsertTags({ tagUpsertDto: { tags: [OPTIMIZED_TAG_NAME] } });
  if (!tag) throw new Error(`Immich did not return the "${OPTIMIZED_TAG_NAME}" tag`);
  cachedOptimizedTagId = tag.id;
  return tag.id;
}

/** Ids of assets already carrying the `optimized` tag inside a capture range. */
export async function listOptimizedAssetIds(from: string, to: string): Promise<Set<string>> {
  const id = await findOptimizedTagId();
  if (!id) return new Set();

  const ids = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const response = await searchAssets({
      metadataSearchDto: {
        filter: { trashedAt: { eq: null }, takenAt: { gte: from, lte: to }, tagIds: { any: [id] } },
        size: MONTH_PAGE_SIZE,
        withExif: false,
        ...(cursor ? { cursor } : {}),
        orderBy: { direction: AssetOrder.Asc, field: SearchOrderField.FileCreatedAt },
      },
    });
    for (const asset of response.assets.items) ids.add(asset.id);
    const nextCursor = response.assets.nextCursor ?? null;
    if (!nextCursor || response.assets.items.length === 0 || ids.size >= MONTH_ASSET_LIMIT) break;
    cursor = nextCursor;
  }
  return ids;
}

/** Moves assets to the Immich trash. Reversible from Immich itself, unlike a forced delete. */
export async function trashAssets(ids: string[]): Promise<void> {
  await deleteAssets({ assetBulkDeleteDto: { ids, force: false } });
}

export async function archiveAssets(ids: string[]): Promise<void> {
  await updateAssets({ assetBulkUpdateDto: { ids, visibility: AssetVisibility.Archive } });
}

/**
 * Applies `tagName` (created on first use) to every asset and then archives them. Immich reports how
 * many assets it tagged, and archiving only happens once that count matches, so no asset can leave
 * the timeline without carrying its tag.
 */
const configuredTagIds = new Map<string, string>();

async function configuredTagId(tagName: string): Promise<string> {
  const cached = configuredTagIds.get(tagName);
  if (cached) return cached;
  const [tag] = await upsertTags({ tagUpsertDto: { tags: [tagName] } });
  if (!tag) throw new Error(`Immich did not return the "${tagName}" tag`);
  configuredTagIds.set(tagName, tag.id);
  return tag.id;
}

/** Applies a configured tag without changing visibility, and verifies Immich accepted every asset. */
export async function tagAssets(ids: string[], tagName: string): Promise<void> {
  const tagId = await configuredTagId(tagName);
  const result = await bulkTagAssets({ tagBulkAssetsDto: { assetIds: ids, tagIds: [tagId] } });
  if (result.count !== ids.length) {
    throw new Error(`Immich tagged ${result.count} of ${ids.length} asset(s) with "${tagName}"`);
  }
}

/**
 * Adds one configured tag to a kept asset only when it is not already present. The pre-check makes
 * retries after a partial stack result idempotent and keeps the local tag-application count exact.
 */
export async function tagAssetIfMissing(assetId: string, tagName: string): Promise<boolean> {
  const tagId = await configuredTagId(tagName);
  const before = await getAssetSnapshot(assetId);
  if (before.tagIds.includes(tagId)) return false;
  try {
    await tagAssets([assetId], tagName);
    return true;
  } catch (error) {
    // A lost response can leave Immich with the tag even though the write call failed. Confirm the
    // state before reporting failure so retrying the stack does not duplicate work or stats.
    const after = await getAssetSnapshot(assetId).catch(() => null);
    if (after?.tagIds.includes(tagId)) return false;
    throw error;
  }
}

/** Applies `tagName` (created on first use) to every asset and then archives them. */
export async function tagAndArchiveAssets(ids: string[], tagName: string): Promise<void> {
  await tagAssets(ids, tagName);
  await archiveAssets(ids);
}

export interface MotionPhoto {
  id: string;
  originalFileName: string;
  localDateTime: string;
  size: number | null;
  livePhotoVideoId: string;
}

const MOTION_PAGE_SIZE = 100;

/**
 * Still images that still reference a motion video. `isMotion` narrows the query, and the
 * `livePhotoVideoId` check keeps only assets that really carry a link, so the caller can always
 * resolve the video it is about to unlink.
 */
export async function listMotionPhotos(cursor?: string): Promise<{ items: MotionPhoto[]; nextCursor: string | null; total: number }> {
  const response = await searchAssets({
    metadataSearchDto: {
      filter: { trashedAt: { eq: null }, isMotion: { eq: true }, type: { eq: AssetTypeEnum.Image } },
      size: MOTION_PAGE_SIZE,
      withExif: true,
      ...(cursor ? { cursor } : {}),
      orderBy: { direction: AssetOrder.Desc, field: SearchOrderField.FileCreatedAt },
    },
  });

  const items = response.assets.items.flatMap((asset) => {
    if (asset.type !== AssetTypeEnum.Image || !asset.livePhotoVideoId) return [];
    return [{
      id: asset.id,
      originalFileName: asset.originalFileName,
      localDateTime: asset.localDateTime || asset.fileCreatedAt,
      size: asset.exifInfo?.fileSizeInByte ?? null,
      livePhotoVideoId: asset.livePhotoVideoId,
    }];
  });

  return { items, nextCursor: response.assets.nextCursor ?? null, total: response.assets.total };
}

/**
 * Minimal facts about a linked asset, used to confirm a motion link really points at a live video
 * before anything destructive is done with it.
 */
export async function getAssetBrief(id: string): Promise<{ isVideo: boolean; isTrashed: boolean; originalFileName: string }> {
  const asset = await getAssetInfo({ id });
  return {
    isVideo: asset.type === AssetTypeEnum.Video,
    isTrashed: asset.isTrashed,
    originalFileName: asset.originalFileName,
  };
}

/**
 * Detaches the motion video from a still. Returns the video id Immich still reports afterwards, which
 * is null on success; the caller must not trash the video while a link remains.
 */
export async function unlinkMotionVideo(assetId: string): Promise<string | null> {
  const updated = await updateAsset({ id: assetId, updateAssetDto: { livePhotoVideoId: null } });
  return updated.livePhotoVideoId ?? null;
}

