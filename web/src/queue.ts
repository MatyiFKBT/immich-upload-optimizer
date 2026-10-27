import { randomUUID } from 'node:crypto';
import { applyBatchResults, createBatch, getBatch, BatchRequestError, type BatchView } from './batches.js';
import { archiveAssets, getAssetSnapshot, pauseQueuesForBatch, resumeQueuesAfterBatch, tagAndArchiveAssets, tagAssetIfMissing, trashAssets } from './immich.js';
import { removeMotionFromAsset } from './motion.js';
import { bestProfileFor, type ProfileId } from './optimizer.js';
import { recordJob } from './stats.js';

export type JobKind = 'compress' | 'trash' | 'archive' | 'tagArchive' | 'motion' | 'review';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface ReviewDecision {
  assetId: string;
  disposition: 'keep' | 'trash';
  tags: string[];
}

export interface JobView {
  id: string;
  kind: JobKind;
  assetIds: string[];
  /** Assets the job actually settled (replaced or deliberately skipped), for removing them from the grid. */
  resolvedIds: string[];
  profileId: string | null;
  /** `tagArchive` jobs only: the tag to apply before archiving, from the configured extra buttons. */
  tag: string | null;
  /** Live-photo jobs only: also compress each still with its best profile after unlinking. */
  compress: boolean;
  /** Focused monthly review jobs: per-asset decisions and tags to apply to kept assets. */
  reviewDecisions: ReviewDecision[] | null;
  /** Focused monthly review statistics. */
  trashCount: number;
  tagCounts: Record<string, number>;
  status: JobStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  replaced: number;
  skipped: number;
  failed: number;
  message: string | null;
}

/** What a job learned that the job view does not already carry; only its own kind fills it in. */
interface JobOutcome {
  /** Motion jobs: how many videos were unlinked from a still and moved to the trash. */
  motionVideos: number;
  /** Motion jobs: how many stills were rewritten to remove an embedded motion video. */
  motionStills: number;
}

const MAX_JOBS = 200;
const JOB_TIMEOUT_MS = 30 * 60 * 1000;
const BATCH_SLOT_WAIT_MS = 15 * 60 * 1000;
const SLOT_RETRY_MS = 3000;
const BATCH_POLL_MS = 1000;

const jobs: JobView[] = [];
let draining = false;
/** Tag names the running server is allowed to apply, i.e. the labels configured in `EXTRA_BUTTONS`. */
let allowedTags: readonly string[] = [];

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export function initializeQueue(extraTags: readonly string[] = []): void {
  jobs.length = 0;
  draining = false;
  allowedTags = extraTags;
}

/** Newest first, so the client can render the most recent activity at the top. */
export function listJobs(): JobView[] {
  return [...jobs].reverse();
}

export function enqueueJob(options: { kind: JobKind; assetIds: string[]; profileId: string | null; compress?: boolean; tag?: string | null; decisions?: ReviewDecision[] }): JobView {
  // The tag comes from the client, so it is only accepted when an operator configured it in
  // EXTRA_BUTTONS; a request can never create or apply an arbitrary tag.
  const tag = options.kind === 'tagArchive' ? options.tag ?? null : null;
  if (options.kind === 'tagArchive') {
    if (!tag) throw new BatchRequestError(400, 'A tag-and-archive job needs the tag of a configured button');
    if (!allowedTags.includes(tag)) throw new BatchRequestError(400, 'That tag is not configured in EXTRA_BUTTONS');
  }
  if (options.kind === 'review') {
    const decisions = options.decisions;
    if (!decisions || decisions.length !== options.assetIds.length || decisions.length === 0) {
      throw new BatchRequestError(400, 'A focused review job needs one decision for every asset');
    }
    const decisionIds = new Set<string>();
    for (const decision of decisions) {
      if (!options.assetIds.includes(decision.assetId) || decisionIds.has(decision.assetId)) {
        throw new BatchRequestError(400, 'Focused review decisions must match unique asset IDs');
      }
      if (decision.disposition !== 'keep' && decision.disposition !== 'trash') {
        throw new BatchRequestError(400, 'A focused review decision must be keep or trash');
      }
      if (!Array.isArray(decision.tags) || (decision.disposition === 'trash' && decision.tags.length > 0)) {
        throw new BatchRequestError(400, 'Only kept assets can have tags');
      }
      if (new Set(decision.tags).size !== decision.tags.length || decision.tags.some((name) => !allowedTags.includes(name))) {
        throw new BatchRequestError(400, 'Focused review tags must come from configured EXTRA_BUTTONS');
      }
      decisionIds.add(decision.assetId);
    }
    if (decisionIds.size !== options.assetIds.length) throw new BatchRequestError(400, 'Every focused review asset needs exactly one decision');
  }

  const job: JobView = {
    id: randomUUID(),
    kind: options.kind,
    assetIds: options.assetIds,
    resolvedIds: [],
    profileId: options.profileId,
    tag,
    compress: options.compress === true,
    reviewDecisions: options.kind === 'review' ? options.decisions!.map((decision) => ({ ...decision, tags: [...decision.tags] })) : null,
    trashCount: 0,
    tagCounts: {},
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
      let outcome: JobOutcome | undefined;
      try {
        outcome = await executeJob(job);
        job.status = job.kind === 'review' && job.failed > 0 ? 'failed' : 'done';
      } catch (error) {
        job.status = 'failed';
        job.message = error instanceof Error ? error.message : 'The job failed';
      }
      job.finishedAt = Date.now();
      const finishedAt = job.finishedAt;
      // Recorded here and not in the job itself, so every job lands in the local record exactly once,
      // whether it finished or failed.
      recordJob({
        kind: job.kind,
        failed: job.status === 'failed',
        settled: job.resolvedIds.length,
        motionVideos: outcome?.motionVideos ?? 0,
        motionStills: outcome?.motionStills ?? 0,
        tag: job.tag,
        reviewTrashed: job.trashCount,
        reviewTagCounts: job.tagCounts,
        finishedAt,
      });
    }
  } finally {
    draining = false;
  }
}

async function executeJob(job: JobView): Promise<JobOutcome | undefined> {
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
  if (job.kind === 'tagArchive') {
    if (!job.tag) throw new Error('This job has no tag to apply');
    await tagAndArchiveAssets(job.assetIds, job.tag);
    job.resolvedIds = job.assetIds;
    job.message = `Tagged ${job.assetIds.length} asset(s) “${job.tag}” and archived them`;
    return;
  }
  if (job.kind === 'review') {
    await runFocusedReview(job);
    return;
  }
  if (job.kind === 'motion') {
    return runRemoveMotion(job);
  }
  await runCompression(job);
}

/**
 * Applies one stack's explicit decisions independently. Keeps are only tagged, never archived; trash
 * uses Immich's reversible non-forced trash. Failed assets remain unresolved so the client can offer
 * a safe, deliberate retry.
 */
async function runFocusedReview(job: JobView): Promise<void> {
  const decisions = job.reviewDecisions ?? [];
  const failures: string[] = [];
  for (const decision of decisions) {
    try {
      if (decision.disposition === 'trash') {
        await trashAssets([decision.assetId]);
        job.trashCount += 1;
      } else {
        for (const tag of decision.tags) {
          const added = await tagAssetIfMissing(decision.assetId, tag);
          if (added) job.tagCounts[tag] = (job.tagCounts[tag] ?? 0) + 1;
        }
      }
      job.resolvedIds.push(decision.assetId);
    } catch (error) {
      job.failed += 1;
      failures.push(`${decision.assetId}: ${error instanceof Error ? error.message : 'action failed'}`);
    }
  }
  const tagCount = Object.values(job.tagCounts).reduce((sum, count) => sum + count, 0);
  const summary = `Reviewed ${job.resolvedIds.length} of ${decisions.length} asset(s) · ${job.trashCount} moved to Immich trash · ${tagCount} tag(s) applied`;
  job.message = failures.length > 0 ? `${summary} · ${failures.length} need review — ${failures.slice(0, 2).join(' · ')}` : summary;
}

/**
 * Removes the motion video from each still. Android motion photos carry the video inside the JPEG,
 * so those stills are rewritten and uploaded as a verified replacement; the original only goes to
 * the Immich trash after the new asset is proven readable, tagged, in its albums, and no longer a
 * motion photo. A separate video asset (iPhone live photo) is still detached and trashed alone.
 */
async function runRemoveMotion(job: JobView): Promise<JobOutcome> {
  // Immich's background work is paused for the batch: faces, search, thumbnails and the like would
  // otherwise compete with the uploads. Metadata extraction stays on, because it stores each upload
  // and writes the EXIF fields this job verifies.
  const queues = await pauseQueuesForBatch();
  if (queues.blocked) {
    throw new Error('The Immich queue metadataExtraction is paused; resume it under Administration → Jobs, then retry');
  }
  const queueNotes: string[] = [];
  if (queues.error !== null) queueNotes.push(`Immich queues were not fully paused (${queues.error})`);

  try {
    return await removeMotionFromEveryAsset(job);
  } finally {
    const resumeError = await resumeQueuesAfterBatch(queues.paused);
    if (resumeError !== null) console.error(`unable to resume Immich queues: ${resumeError}`);
    const warnings = [...queueNotes];
    if (resumeError !== null) warnings.push(`Immich queues not resumed (${resumeError})`);
    if (warnings.length > 0) job.message = `${job.message ?? 'Motion job finished'} — ${warnings.join(' · ')}`;
  }
}

async function removeMotionFromEveryAsset(job: JobView): Promise<JobOutcome> {
  const resolved: string[] = [];
  // Stills that can be compressed afterwards: the replacement for a rewritten JPEG, the still itself
  // for a live photo whose video was only unlinked.
  const compressibleIds: string[] = [];
  const failures: string[] = [];
  const lastCompressionNotes: string[] = [];
  let unlinked = 0;
  let stripped = 0;
  let skipped = 0;

  for (const assetId of job.assetIds) {
    let label = assetId;
    try {
      const asset = await getAssetSnapshot(assetId);
      label = asset.originalFileName;
      const outcome = await removeMotionFromAsset(assetId);
      if (outcome.status === 'skipped') {
        skipped += 1;
        resolved.push(assetId);
        continue;
      }
      resolved.push(assetId);
      if (outcome.status === 'stripped') {
        stripped += 1;
        compressibleIds.push(outcome.replacementId);
      } else {
        unlinked += 1;
        compressibleIds.push(assetId);
      }
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : 'failed'}`);
    }
  }

  const parts = [stripped > 0 ? `Rewrote ${stripped} still(s) without their motion video` : 'No still needed rewriting'];
  if (unlinked > 0) parts.push(`${unlinked} linked video(s) unlinked and trashed`);
  if (skipped > 0) parts.push(`${skipped} had no motion video`);
  if (failures.length > 0) parts.push(`${failures.length} failed`);

  // Motion data is gone by now, so a compressed replacement can never inherit a dead motion link.
  const byProfile = new Map<ProfileId, string[]>();
  let unsupported = 0;
  if (job.compress) {
    for (const assetId of compressibleIds) {
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
  return { motionVideos: unlinked, motionStills: stripped };
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
