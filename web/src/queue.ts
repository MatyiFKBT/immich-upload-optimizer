import { randomUUID } from 'node:crypto';
import { applyBatchResults, createBatch, getBatch, BatchRequestError, type BatchView } from './batches.js';
import { archiveAssets, getAssetBrief, getAssetSnapshot, trashAssets, unlinkMotionVideo } from './immich.js';
import { bestProfileFor, type ProfileId } from './optimizer.js';

export type JobKind = 'compress' | 'trash' | 'archive' | 'motion';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobView {
  id: string;
  kind: JobKind;
  assetIds: string[];
  /** Assets the job actually settled (replaced or deliberately skipped), for removing them from the grid. */
  resolvedIds: string[];
  profileId: string | null;
  /** Live-photo jobs only: also compress each still with its best profile after unlinking. */
  compress: boolean;
  status: JobStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  replaced: number;
  skipped: number;
  failed: number;
  message: string | null;
}

const MAX_JOBS = 200;
const JOB_TIMEOUT_MS = 30 * 60 * 1000;
const BATCH_SLOT_WAIT_MS = 15 * 60 * 1000;
const SLOT_RETRY_MS = 3000;
const BATCH_POLL_MS = 1000;

const jobs: JobView[] = [];
let draining = false;

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export function initializeQueue(): void {
  jobs.length = 0;
  draining = false;
}

/** Newest first, so the client can render the most recent activity at the top. */
export function listJobs(): JobView[] {
  return [...jobs].reverse();
}

export function enqueueJob(options: { kind: JobKind; assetIds: string[]; profileId: string | null; compress?: boolean }): JobView {
  const job: JobView = {
    id: randomUUID(),
    kind: options.kind,
    assetIds: options.assetIds,
    resolvedIds: [],
    profileId: options.profileId,
    compress: options.compress === true,
    status: 'queued',
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    replaced: 0,
    skipped: 0,
    failed: 0,
    message: null,
  };
  jobs.push(job);
  trimJobs();
  void drain().catch((error: unknown) => {
    console.error(`job queue stopped: ${error instanceof Error ? error.message : 'unknown error'}`);
  });
  return job;
}

export function cancelJob(jobId: string): void {
  const index = jobs.findIndex((job) => job.id === jobId);
  if (index < 0) throw new BatchRequestError(404, 'Job not found');
  const job = jobs[index]!;
  if (job.status !== 'queued') throw new BatchRequestError(409, 'Only a queued job can be cancelled');
  jobs.splice(index, 1);
}

function trimJobs(): void {
  while (jobs.length > MAX_JOBS) {
    const finished = jobs.findIndex((job) => job.status === 'done' || job.status === 'failed');
    if (finished < 0) return;
    jobs.splice(finished, 1);
  }
}

/** Runs queued jobs one at a time; each failure is contained so the queue always keeps moving. */
async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const job = jobs.find((candidate) => candidate.status === 'queued');
      if (!job) return;
      job.status = 'running';
      job.startedAt = Date.now();
      try {
        await executeJob(job);
        job.status = 'done';
      } catch (error) {
        job.status = 'failed';
        job.message = error instanceof Error ? error.message : 'The job failed';
      } finally {
        job.finishedAt = Date.now();
      }
    }
  } finally {
    draining = false;
  }
}

async function executeJob(job: JobView): Promise<void> {
  if (job.kind === 'trash') {
    await trashAssets(job.assetIds);
    job.resolvedIds = job.assetIds;
    job.message = `Moved ${job.assetIds.length} asset(s) to the Immich trash`;
    return;
  }
  if (job.kind === 'archive') {
    await archiveAssets(job.assetIds);
    job.resolvedIds = job.assetIds;
    job.message = `Archived ${job.assetIds.length} asset(s)`;
    return;
  }
  if (job.kind === 'motion') {
    await runUnlinkMotion(job);
    return;
  }
  await runCompression(job);
}

/**
 * Detaches and trashes the motion video behind each still. The video is only trashed after Immich
 * confirms the link is gone, so a still never ends up pointing at a trashed video.
 */
async function runUnlinkMotion(job: JobView): Promise<void> {
  const resolved: string[] = [];
  const unlinkedIds: string[] = [];
  const failures: string[] = [];
  const lastCompressionNotes: string[] = [];
  let unlinked = 0;
  let skipped = 0;

  for (const assetId of job.assetIds) {
    let label = assetId;
    try {
      const asset = await getAssetSnapshot(assetId);
      label = asset.originalFileName;
      const videoId = asset.livePhotoVideoId;
      if (!videoId) {
        skipped += 1;
        resolved.push(assetId);
        continue;
      }
      // Never trust the link blindly: it must point at a different, live video asset, otherwise the
      // trash step could remove the still itself or an unrelated asset.
      if (videoId === assetId) {
        failures.push(`${label}: Immich reports the motion video as the image itself; nothing was changed`);
        continue;
      }
      const linked = await getAssetBrief(videoId);
      if (!linked.isVideo || linked.isTrashed) {
        failures.push(`${label}: linked asset is ${linked.isTrashed ? 'already trashed' : 'not a video'}; nothing was changed`);
        continue;
      }
      const remaining = await unlinkMotionVideo(assetId);
      if (remaining) throw new Error('Immich still reports the motion video as linked');
      await trashAssets([videoId]);
      unlinked += 1;
      unlinkedIds.push(assetId);
      resolved.push(assetId);
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }

  const parts = [`Unlinked and trashed ${unlinked} motion video(s)`];
  if (skipped > 0) parts.push(`${skipped} had no linked video`);
  if (failures.length > 0) parts.push(`${failures.length} failed`);

  // Videos are gone by now, so a compressed replacement can never inherit a dead motion link.
  const byProfile = new Map<ProfileId, string[]>();
  let unsupported = 0;
  if (job.compress) {
    for (const assetId of unlinkedIds) {
      const asset = await getAssetSnapshot(assetId);
      const profileId = bestProfileFor(asset);
      if (!profileId) {
        unsupported += 1;
        continue;
      }
      const bucket = byProfile.get(profileId);
      if (bucket) bucket.push(assetId);
      else byProfile.set(profileId, [assetId]);
    }
    if (unsupported > 0) parts.push(`${unsupported} left uncompressed (no profile for that format)`);
  }

  for (const [profileId, ids] of byProfile) {
    try {
      const summary = await compressAssets(ids, profileId);
      job.replaced += summary.replaced;
      job.failed += summary.failed;
      lastCompressionNotes.push(...summary.notes);
      parts.push(`${profileId}: ${summariseCompression(summary)}`);
    } catch (error) {
      // compressAssets only throws before anything is applied, so these originals are untouched.
      job.failed += ids.length;
      parts.push(`${profileId} compression stopped before applying anything: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }

  job.resolvedIds = resolved;
  job.skipped = skipped;
  job.failed += failures.length;
  const notes = [...failures, ...lastCompressionNotes];
  job.message = `${parts.join(', ')}${notes.length > 0 ? ` — ${notes.slice(0, 2).join(' · ')}` : ''}`;
}


/** Waits for the single optimizer slot instead of failing when the Compress tab holds it. */
async function createBatchWhenFree(options: { assetIds: string[]; profileIds: string[]; deleteOriginal: boolean }): Promise<{ id: string }> {
  const deadline = Date.now() + BATCH_SLOT_WAIT_MS;
  for (;;) {
    try {
      return await createBatch(options);
    } catch (error) {
      if (!(error instanceof BatchRequestError) || error.statusCode !== 409) throw error;
      if (Date.now() > deadline) throw new Error('Another run held the optimizer for too long; the job was dropped');
      await delay(SLOT_RETRY_MS);
    }
  }
}

interface CompressionSummary {
  replaced: number;
  skipped: number;
  failed: number;
  resolvedIds: string[];
  notes: string[];
  /** Apply was requested but the run had not reached a terminal state when we stopped waiting. */
  stillRunning: boolean;
}

function summariseBatch(view: BatchView | null, stillRunning: boolean): CompressionSummary {
  const items = view?.items ?? [];
  return {
    replaced: items.filter((item) => item.status === 'replaced').length,
    skipped: items.filter((item) => item.status === 'skipped').length,
    failed: items.filter((item) => item.status === 'failed').length,
    resolvedIds: items.filter((item) => item.status === 'replaced' || item.status === 'skipped').map((item) => item.assetId),
    notes: items
      .filter((item) => item.status === 'failed' || (item.status === 'skipped' && item.message))
      .map((item) => `${item.originalFileName}: ${item.message ?? 'skipped'}`),
    stillRunning,
  };
}

/** Runs one compression batch to completion and applies every candidate Immich verified as smaller. */
async function compressAssets(assetIds: string[], profileId: string): Promise<CompressionSummary> {
  const created = await createBatchWhenFree({ assetIds, profileIds: [profileId], deleteOriginal: true });
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let lastView: BatchView | null = null;
  const waitFor = async (finished: (view: BatchView) => boolean): Promise<BatchView> => {
    for (;;) {
      const view = getBatch(created.id);
      if (!view) throw new Error('The run disappeared before it finished');
      lastView = view;
      if (finished(view)) return view;
      if (Date.now() > deadline) throw new Error('The compression run timed out');
      await delay(BATCH_POLL_MS);
    }
  };

  const prepared = await waitFor((view) => view.status !== 'preparing');
  if (prepared.status === 'abandoned' || prepared.status === 'expired') throw new Error('The run was discarded before it finished');

  const ready = prepared.status === 'review'
    ? prepared.items.filter((item) => item.status === 'ready' && item.candidates[0]?.eligible === true).map((item) => item.assetId)
    : [];
  if (ready.length === 0) return summariseBatch(prepared, false);

  applyBatchResults(created.id, ready);
  try {
    return summariseBatch(await waitFor((view) => view.status === 'complete' || view.status === 'failed' || view.status === 'abandoned' || view.status === 'expired'), false);
  } catch {
    // Items were already applied, so replacements may have happened; reporting a failure here would
    // claim the originals were kept when they may not have been. Report what is actually known.
    return summariseBatch(lastView, true);
  }
}

function summariseCompression(summary: CompressionSummary): string {
  const parts = [summary.replaced > 0 ? `Replaced ${summary.replaced} asset(s)` : 'Nothing replaced'];
  if (summary.skipped > 0) parts.push(`left ${summary.skipped} unchanged`);
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  if (summary.stillRunning) parts.push('still applying, check the Compress tab');
  return `${parts.join(', ')}${summary.notes.length > 0 ? ` — ${summary.notes.slice(0, 2).join(' · ')}` : ''}`;
}

async function runCompression(job: JobView): Promise<void> {
  if (!job.profileId) throw new Error('A compression job needs a profile');
  const summary = await compressAssets(job.assetIds, job.profileId);
  job.replaced = summary.replaced;
  job.skipped = summary.skipped;
  job.failed = summary.failed;
  job.resolvedIds = summary.resolvedIds;
  job.message = summariseCompression(summary);
}
