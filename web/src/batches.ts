import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { AssetMediaStatus } from '@immich/sdk';
import {
  copyTagsAndAlbums,
  downloadOriginal,
  getAssetSnapshot,
  getAlbumIdsForAsset,
  removeOriginal,
  sha1Base64,
  uploadReplacement,
  verifyReplacement,
  type AssetSnapshot,
} from './immich.js';
import { compatibleProfiles, generateCandidates, PROFILES, type Candidate, type ProfileId } from './optimizer.js';

const MAX_BATCH_ASSETS = 100;
const MAX_PARALLEL_ITEMS = 3;
const BATCH_TTL_MS = 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type BatchMode = 'compare' | 'batch';
type BatchStatus = 'preparing' | 'awaiting-choice' | 'review' | 'applying' | 'complete' | 'failed' | 'expired' | 'abandoned';
type ItemStatus = 'queued' | 'processing' | 'awaiting-choice' | 'ready' | 'applying' | 'replaced' | 'skipped' | 'failed';
export class BatchRequestError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

interface BatchItem {
  assetId: string;
  asset?: AssetSnapshot;
  sourceSize: number | null;
  status: ItemStatus;
  candidates: Candidate[];
  replacementId: string | null;
  originalDeleted: boolean;
  message: string | null;
  workDir: string | null;
}

interface Batch {
  id: string;
  mode: BatchMode;
  profileIds: ProfileId[];
  deleteOriginal: boolean;
  status: BatchStatus;
  createdAt: number;
  items: BatchItem[];
  currentIndex: number;
  workDir: string;
  error: string | null;
}

const batches = new Map<string, Batch>();
let workRoot = '';
let activeBatchId: string | null = null;

export async function initializeBatches(dataDir: string): Promise<void> {
  workRoot = join(dataDir, 'work');
  await mkdir(workRoot, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(workRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('batch-')) {
      await rm(join(workRoot, entry.name), { recursive: true, force: true });
    }
  }

  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, batch] of batches) {
      if (now - batch.createdAt <= BATCH_TTL_MS || batch.status === 'preparing' || batch.status === 'applying') continue;
      batch.status = 'expired';
      for (const item of batch.items) item.status = item.status === 'replaced' ? 'replaced' : 'skipped';
      void rm(batch.workDir, { recursive: true, force: true }).catch((error: unknown) => {
        console.error(`unable to remove expired optimizer batch: ${error instanceof Error ? error.message : 'unknown error'}`);
      });
      if (activeBatchId === id) activeBatchId = null;
      batches.delete(id);
    }
  }, 60 * 60 * 1000);
  timer.unref();
}

function isProfileId(value: unknown): value is ProfileId {
  return typeof value === 'string' && PROFILES.some((profile) => profile.id === value);
}

function createItem(assetId: string): BatchItem {
  return {
    assetId,
    sourceSize: null,
    status: 'queued',
    candidates: [],
    replacementId: null,
    originalDeleted: false,
    message: null,
    workDir: null,
  };
}

export async function createBatch(options: {
  assetIds: unknown;
  profileIds: unknown;
  deleteOriginal: unknown;
}): Promise<{ id: string }> {
  if (!Array.isArray(options.assetIds) || options.assetIds.length === 0 || options.assetIds.length > MAX_BATCH_ASSETS) {
    throw new BatchRequestError(400, `Select between 1 and ${MAX_BATCH_ASSETS} assets`);
  }
  const assetIds = options.assetIds;
  if (assetIds.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))) {
    throw new BatchRequestError(400, 'Every selected asset ID must be a UUID');
  }
  if (new Set(assetIds).size !== assetIds.length) throw new BatchRequestError(400, 'Selected asset IDs must be unique');
  if (!Array.isArray(options.profileIds) || options.profileIds.length === 0 || options.profileIds.length > PROFILES.length) {
    throw new BatchRequestError(400, 'Select at least one supported optimization profile');
  }
  const profileIds = options.profileIds;
  if (profileIds.some((id) => !isProfileId(id))) throw new BatchRequestError(400, 'Unknown optimization profile');
  if (new Set(profileIds).size !== profileIds.length) throw new BatchRequestError(400, 'Optimization profiles must be unique');
  if (typeof options.deleteOriginal !== 'boolean') throw new BatchRequestError(400, 'deleteOriginal must be a boolean');
  if (activeBatchId) {
    const active = batches.get(activeBatchId);
    if (active && !['complete', 'failed', 'expired'].includes(active.status)) {
      throw new BatchRequestError(409, 'Another run is still open. Apply or discard it in the Compress tab, then try again.');
    }
    activeBatchId = null;
  }

  const id = randomUUID();
  const batchDir = await mkdtemp(join(workRoot, `batch-${id}-`));
  const batch: Batch = {
    id,
    mode: profileIds.length === 1 ? 'batch' : 'compare',
    profileIds,
    deleteOriginal: options.deleteOriginal,
    status: 'preparing',
    createdAt: Date.now(),
    items: assetIds.map((assetId) => createItem(assetId)),
    currentIndex: 0,
    workDir: batchDir,
    error: null,
  };
  batches.set(id, batch);
  activeBatchId = id;
  if (batch.mode === 'compare') void runCompare(batch);
  else void runBatchPreview(batch);
  return { id };
}

async function prepareItem(batch: Batch, item: BatchItem): Promise<void> {
  item.status = 'processing';
  item.message = null;
  const asset = await getAssetSnapshot(item.assetId);
  if (asset.isTrashed) throw new Error('Asset is already in Immich Trash');
  const matchingProfiles = compatibleProfiles(asset).filter((profile) => batch.profileIds.includes(profile.id));
  if (matchingProfiles.length === 0) {
    item.asset = asset;
    item.status = 'skipped';
    item.message = 'No selected profile supports this image format';
    return;
  }

  const itemDir = join(batch.workDir, `asset-${item.assetId}`);
  await mkdir(itemDir, { recursive: true, mode: 0o700 });
  item.workDir = itemDir;
  const sourcePath = join(itemDir, 'source');
  const sourceSize = await downloadOriginal(item.assetId, sourcePath);
  if (sourceSize === 0) throw new Error('Immich returned an empty original file');
  if (await sha1Base64(sourcePath) !== asset.checksum) {
    throw new Error('Downloaded original checksum does not match Immich metadata');
  }

  item.asset = asset;
  item.sourceSize = sourceSize;
  const matchingIds = matchingProfiles.map((profile) => profile.id);
  item.candidates = await generateCandidates({
    asset,
    sourcePath,
    sourceSize,
    profileIds: matchingIds,
    workDir: itemDir,
  });
  await rm(sourcePath, { force: true });
}

async function cleanupItem(item: BatchItem): Promise<void> {
  if (!item.workDir) return;
  await rm(item.workDir, { recursive: true, force: true });
  item.workDir = null;
  for (const candidate of item.candidates) candidate.path = null;
}

async function finishBatch(batch: Batch): Promise<void> {
  batch.status = 'complete';
  batch.currentIndex = batch.items.length;
  activeBatchId = null;
  await rm(batch.workDir, { recursive: true, force: true });
  for (const item of batch.items) {
    item.workDir = null;
    for (const candidate of item.candidates) candidate.path = null;
  }
}

async function failBatch(batch: Batch, error: unknown): Promise<void> {
  batch.error = error instanceof Error ? error.message : 'Batch processing failed';
  batch.status = 'failed';
  activeBatchId = null;
  await rm(batch.workDir, { recursive: true, force: true });
  for (const item of batch.items) {
    item.workDir = null;
    for (const candidate of item.candidates) candidate.path = null;
  }
}

async function prepareItems(batch: Batch): Promise<void> {
  let next = 0;
  let completed = 0;
  const workerCount = Math.min(MAX_PARALLEL_ITEMS, batch.items.length);
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const item = batch.items[index];
      if (!item) return;
      try {
        await prepareItem(batch, item);
        const eligible = item.candidates.some((candidate) => candidate.eligible && candidate.path !== null);
        if (item.status === 'skipped' || !eligible) {
          if (item.status !== 'skipped') {
            item.status = 'skipped';
            item.message = item.candidates.length ? 'No candidate is smaller than the original' : 'No usable candidate was generated';
          }
          await cleanupItem(item);
        } else {
          item.status = 'awaiting-choice';
        }
      } catch (error) {
        item.status = 'failed';
        item.message = error instanceof Error ? error.message : 'Unable to optimize this image';
        await cleanupItem(item);
      }
      completed += 1;
      batch.currentIndex = completed;
    }
  };
  await Promise.all(Array.from({ length: workerCount }, worker));
}

async function runCompare(batch: Batch): Promise<void> {
  try {
    batch.status = 'preparing';
    await prepareItems(batch);
    batch.currentIndex = batch.items.length;
    if (batch.items.some((item) => item.status === 'awaiting-choice')) {
      batch.status = 'awaiting-choice';
    } else {
      await finishBatch(batch);
    }
  } catch (error) {
    await failBatch(batch, error);
  }
}

async function runBatchPreview(batch: Batch): Promise<void> {
  try {
    batch.status = 'preparing';
    await prepareItems(batch);
    for (const item of batch.items) {
      if (item.status !== 'awaiting-choice') continue;
      const candidate = item.candidates[0];
      if (!candidate?.eligible || !candidate.path) {
        item.status = 'skipped';
        item.message = candidate?.error ?? 'No smaller candidate was generated';
        await cleanupItem(item);
      } else {
        item.status = 'ready';
      }
    }
    // A run where nothing produced a smaller candidate has nothing to review; finishing here keeps it
    // from holding the single active-run slot forever.
    if (batch.items.some((item) => item.status === 'ready')) {
      batch.status = 'review';
      batch.currentIndex = batch.items.length;
    } else {
      await finishBatch(batch);
    }
  } catch (error) {
    await failBatch(batch, error);
  }
}

async function replaceItem(batch: Batch, item: BatchItem, candidate: Candidate): Promise<void> {
  if (!item.asset || item.sourceSize === null || !candidate.path || !candidate.size) {
    throw new Error('Candidate is missing required source or file data');
  }
  const actualCandidateSize = (await lstat(candidate.path)).size;
  if (actualCandidateSize !== candidate.size || actualCandidateSize >= item.sourceSize) {
    throw new Error('Candidate size changed or is not strictly smaller; upload refused');
  }

  const current = await getAssetSnapshot(item.assetId);
  if (current.isTrashed || current.checksum !== item.asset.checksum) {
    throw new Error('Original asset changed or was trashed after comparison; replacement refused');
  }
  const albumIds = await getAlbumIdsForAsset(item.assetId);
  const uploaded = await uploadReplacement({
    filePath: candidate.path,
    filename: candidate.filename,
    mimeType: candidate.mimeType,
    fileCreatedAt: current.fileCreatedAt,
    fileModifiedAt: current.fileModifiedAt,
    isFavorite: current.isFavorite,
    visibility: current.visibility,
    livePhotoVideoId: current.livePhotoVideoId,
  });
  if (uploaded.status !== AssetMediaStatus.Created || uploaded.id === item.assetId) {
    throw new Error('Immich reported a duplicate upload; original retained and no metadata or deletion attempted');
  }
  item.replacementId = uploaded.id;

  await copyTagsAndAlbums({ newAssetId: uploaded.id, tagIds: current.tagIds, albumIds });
  await verifyReplacement({ assetId: uploaded.id, checksum: uploaded.checksum, tagIds: current.tagIds, albumIds, livePhotoVideoId: current.livePhotoVideoId });

  if (batch.deleteOriginal) {
    await removeOriginal(item.assetId);
    item.originalDeleted = true;
  }
  item.status = 'replaced';
  item.message = batch.deleteOriginal ? 'Replacement verified; original deleted through Immich' : 'Replacement verified; original kept';
}

export function getBatch(id: string): Record<string, unknown> | null {
  const batch = batches.get(id);
  if (!batch) return null;
  return {
    id: batch.id,
    mode: batch.mode,
    status: batch.status,
    currentIndex: batch.currentIndex,
    total: batch.items.length,
    resolved: batch.items.filter((item) => ['replaced', 'skipped', 'failed'].includes(item.status)).length,
    awaiting: batch.items.filter((item) => item.status === 'awaiting-choice').length,
    busy: batch.items.some((item) => item.status === 'applying'),
    deleteOriginal: batch.deleteOriginal,
    error: batch.error,
    items: batch.items.map((item) => ({
      assetId: item.assetId,
      originalFileName: item.asset?.originalFileName ?? item.assetId,
      originalMimeType: item.asset?.originalMimeType ?? null,
      sourceSize: item.sourceSize,
      status: item.status,
      message: item.message,
      replacementId: item.replacementId,
      originalDeleted: item.originalDeleted,
      candidates: item.candidates.map((candidate) => ({
        profileId: candidate.profileId,
        label: candidate.label,
        mimeType: candidate.mimeType,
        filename: candidate.filename,
        size: candidate.size,
        eligible: candidate.eligible,
        error: candidate.error,
      })),
    })),
  };
}


async function settleCompareBatch(batch: Batch): Promise<void> {
  const pending = batch.items.some((item) => item.status === 'awaiting-choice' || item.status === 'applying' || item.status === 'processing' || item.status === 'queued');
  if (!pending) await finishBatch(batch);
}

export function advanceCompareBatch(batchId: string, assetId: string, profileId: unknown): void {
  const batch = batches.get(batchId);
  if (!batch || batch.mode !== 'compare' || batch.status !== 'awaiting-choice') throw new BatchRequestError(409, 'Batch is not waiting for an image decision');
  const item = batch.items.find((value) => value.assetId === assetId);
  if (!item || item.status !== 'awaiting-choice') throw new BatchRequestError(409, 'Asset is not waiting for a decision');
  if (profileId !== null && !isProfileId(profileId)) throw new BatchRequestError(400, 'Unknown optimization profile');
  const candidate = profileId === null ? null : item.candidates.find((value) => value.profileId === profileId && value.eligible && value.path);
  if (profileId !== null && !candidate) throw new BatchRequestError(409, 'Selected profile has no smaller candidate');

  item.status = candidate ? 'applying' : 'skipped';
  if (!candidate) item.message = 'Skipped by user; original kept';
  void (async () => {
    if (candidate) {
      try {
        await replaceItem(batch, item, candidate);
      } catch (error) {
        item.status = 'failed';
        item.message = error instanceof Error ? error.message : 'Replacement failed; original retained';
      }
    }
    await cleanupItem(item);
    await settleCompareBatch(batch);
  })().catch(async (error: unknown) => {
    try {
      await failBatch(batch, error);
    } catch (cleanupError) {
      batch.status = 'failed';
      batch.error = cleanupError instanceof Error ? cleanupError.message : 'Batch failed and temporary files could not be cleaned';
      activeBatchId = null;
    }
  });
}

export function applyBatchResults(batchId: string, assetIds: unknown): void {
  const batch = batches.get(batchId);
  if (!batch || batch.mode !== 'batch' || batch.status !== 'review') throw new BatchRequestError(409, 'Batch is not ready for apply');
  if (!Array.isArray(assetIds) || assetIds.some((id) => typeof id !== 'string')) throw new BatchRequestError(400, 'assetIds must be an array');
  if (new Set(assetIds).size !== assetIds.length) throw new BatchRequestError(400, 'assetIds must be unique');
  const selected = new Set(assetIds as string[]);
  const ready = new Set(batch.items.filter((item) => item.status === 'ready' && item.candidates[0]?.eligible).map((item) => item.assetId));
  if ([...selected].some((id) => !ready.has(id))) throw new BatchRequestError(400, 'Apply can include only ready assets with smaller candidates');

  for (const item of batch.items) {
    if (selected.has(item.assetId)) item.status = 'applying';
    else if (item.status === 'ready') {
      item.status = 'skipped';
      item.message = 'Not selected for apply; original kept';
    }
  }
  batch.status = 'applying';
  void (async () => {
    for (const item of batch.items) {
      if (item.status !== 'applying') continue;
      const candidate = item.candidates[0];
      if (!candidate) {
        item.status = 'failed';
        item.message = 'Candidate was unavailable; original retained';
        continue;
      }
      try {
        await replaceItem(batch, item, candidate);
      } catch (error) {
        item.status = 'failed';
        item.message = error instanceof Error ? error.message : 'Replacement failed; original retained';
      }
      await cleanupItem(item);
    }
    for (const item of batch.items) await cleanupItem(item);
    await finishBatch(batch);
  })().catch(async (error: unknown) => {
    try {
      await failBatch(batch, error);
    } catch (cleanupError) {
      batch.status = 'failed';
      batch.error = cleanupError instanceof Error ? cleanupError.message : 'Batch failed and temporary files could not be cleaned';
      activeBatchId = null;
    }
  });
}

/** Releases the single active-run slot for a prepared run the user no longer wants. */
export async function abandonBatch(id: string): Promise<void> {
  const batch = batches.get(id);
  if (!batch) throw new BatchRequestError(404, 'Batch not found or expired');
  if (batch.status === 'preparing' || batch.status === 'applying') {
    throw new BatchRequestError(409, 'This run is still working; wait for it to finish before discarding it');
  }
  if (['complete', 'failed', 'expired', 'abandoned'].includes(batch.status)) return;

  for (const item of batch.items) {
    if (['queued', 'processing', 'ready', 'awaiting-choice'].includes(item.status)) {
      item.status = 'skipped';
      item.message = 'Run discarded; original kept';
    }
  }
  batch.status = 'abandoned';
  batch.currentIndex = batch.items.length;
  activeBatchId = null;
  await rm(batch.workDir, { recursive: true, force: true });
  for (const item of batch.items) {
    item.workDir = null;
    for (const candidate of item.candidates) candidate.path = null;
  }
}

export function validateAssetId(id: string): boolean {
  return UUID_PATTERN.test(id);
}
