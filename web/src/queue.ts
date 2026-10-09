import { randomUUID } from 'node:crypto';
import { applyBatchResults, createBatch, getBatch, BatchRequestError, type BatchView } from './batches.js';
import { archiveAssets, trashAssets } from './immich.js';

export type JobKind = 'compress' | 'trash' | 'archive';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface JobView {
  id: string;
  kind: JobKind;
  assetIds: string[];
  /** Assets the job actually settled (replaced or deliberately skipped), for removing them from the grid. */
  resolvedIds: string[];
  profileId: string | null;
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

export function enqueueJob(options: { kind: JobKind; assetIds: string[]; profileId: string | null }): JobView {
  const job: JobView = {
    id: randomUUID(),
    kind: options.kind,
    assetIds: options.assetIds,
    resolvedIds: [],
    profileId: options.profileId,
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
  await runCompression(job);
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

async function runCompression(job: JobView): Promise<void> {
  if (!job.profileId) throw new Error('A compression job needs a profile');
  const created = await createBatchWhenFree({ assetIds: job.assetIds, profileIds: [job.profileId], deleteOriginal: true });
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  const waitFor = async (finished: (view: BatchView) => boolean): Promise<BatchView> => {
    for (;;) {
      const view = getBatch(created.id);
      if (!view) throw new Error('The run disappeared before it finished');
      if (finished(view)) return view;
      if (Date.now() > deadline) throw new Error('The compression run timed out');
      await delay(BATCH_POLL_MS);
    }
  };

  const prepared = await waitFor((view) => view.status !== 'preparing');
  if (prepared.status === 'abandoned' || prepared.status === 'expired') throw new Error('The run was discarded before it finished');

  let finished = prepared;
  if (prepared.status === 'review') {
    const ready = prepared.items.filter((item) => item.status === 'ready' && item.candidates[0]?.eligible === true).map((item) => item.assetId);
    if (ready.length > 0) {
      applyBatchResults(created.id, ready);
      finished = await waitFor((view) => view.status === 'complete' || view.status === 'failed' || view.status === 'abandoned' || view.status === 'expired');
    }
  }
  if (finished.status === 'abandoned' || finished.status === 'expired') throw new Error('The run was discarded before it finished');

  job.replaced = finished.items.filter((item) => item.status === 'replaced').length;
  job.skipped = finished.items.filter((item) => item.status === 'skipped').length;
  job.failed = finished.items.filter((item) => item.status === 'failed').length;
  job.resolvedIds = finished.items.filter((item) => item.status === 'replaced' || item.status === 'skipped').map((item) => item.assetId);

  const parts = [job.replaced > 0 ? `Replaced ${job.replaced} asset(s)` : 'Nothing replaced'];
  if (job.skipped > 0) parts.push(`left ${job.skipped} unchanged`);
  if (job.failed > 0) parts.push(`${job.failed} failed`);
  const notes = finished.items
    .filter((item) => item.status === 'failed' || (item.status === 'skipped' && item.message))
    .map((item) => `${item.originalFileName}: ${item.message ?? 'skipped'}`);
  job.message = `${parts.join(', ')}${notes.length > 0 ? ` — ${notes.slice(0, 2).join(' · ')}` : ''}`;
}
