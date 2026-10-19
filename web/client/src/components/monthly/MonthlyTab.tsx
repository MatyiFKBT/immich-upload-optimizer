import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseAsBoolean, parseAsInteger, useQueryState } from 'nuqs';
import { api } from '@/api';
import { ActionConfirm, type PendingAction } from '@/components/monthly/ActionConfirm';
import { JobQueuePanel } from '@/components/monthly/JobQueuePanel';
import { MonthView } from '@/components/monthly/MonthView';
import { YearOverview } from '@/components/monthly/YearOverview';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/components/ui/sonner';
import { useJobs } from '@/hooks/useJobs';
import { useJobToasts } from '@/hooks/useJobToasts';
import { clearConfirmations, CONFIRM_KINDS, isConfirmationHidden, setConfirmationHidden } from '@/lib/confirmPrefs';
import { useMonthAssets, useMonthCounts, useMonthStorage } from '@/hooks/useLibrary';
import type { Mark } from '@/lib/bursts';
import type { ActionKind, ExtraButton, Job, LibraryAsset, ProfileOption, ReviewDecision } from '@/types';

interface Props {
  profiles: ProfileOption[];
  extraButtons: readonly ExtraButton[];
}

const FocusedReview = lazy(() => import('@/components/monthly/FocusedReview').then((module) => ({ default: module.FocusedReview })));

const KIND_LABEL: Record<ActionKind, string> = {
  compress: 'Compress and delete original',
  trash: 'Move to trash',
  archive: 'Archive',
  tagArchive: 'Tag and archive',
};

// The review position lives in the URL, so a month is linkable and the Back button walks the year
// grid and the months the user visited. Moving between the year grid and a month is navigation and
// pushes a history entry; the archived switch is a filter and replaces the current one. The year
// defaults to the current one and is dropped from the URL while it matches; the other two are dropped
// whenever they are unset or false.
const yearParser = parseAsInteger.withDefault(new Date().getFullYear()).withOptions({ history: 'push' });
const monthParser = parseAsInteger.withOptions({ history: 'push' });
const includeArchivedParser = parseAsBoolean.withDefault(false).withOptions({ history: 'replace' });
const focusReviewParser = parseAsBoolean.withDefault(false).withOptions({ history: 'replace' });

function kindLabel(kind: ActionKind, tag: string | null): string {
  if (kind === 'tagArchive') return tag ? `Tag as “${tag}” and archive` : 'Tag and archive';
  return KIND_LABEL[kind];
}

function actionCopy(kind: ActionKind, what: string, tag: string | null): { title: string; description: string; confirmLabel: string } {
  if (kind === 'tagArchive') {
    const label = tag ?? 'the tag';
    return {
      title: `Queue “${label}” for ${what}?`,
      description: `The job runs in the background, one job at a time. Each asset is tagged “${label}” in Immich first, and only archived once Immich confirms the tag was applied, so nothing leaves the timeline untagged. Archiving is reversible from Immich; the tag stays.`,
      confirmLabel: `Queue “${label}”`,
    };
  }
  if (kind === 'compress') {
    return {
      title: `Queue compression for ${what}?`,
      description:
        'The job runs in the background, one job at a time. Each original is replaced only after the smaller candidate is uploaded, verified, tagged, and its tags and albums are copied; the original is deleted afterwards. A replacement cannot be undone.',
      confirmLabel: 'Queue compression',
    };
  }
  if (kind === 'trash') {
    return {
      title: `Queue trashing ${what}?`,
      description: 'Trashed assets stay in Immich and can be restored from there.',
      confirmLabel: 'Queue trash',
    };
  }
  return {
    title: `Queue archiving ${what}?`,
    description: 'Archived assets leave the timeline but stay in the library.',
    confirmLabel: 'Queue archive',
  };
}

/** An action waiting for confirmation; `tag` carries the button label for a tag-and-archive action. */
type QueuedAction = PendingAction & { kind: ActionKind; tag: string | null };

export function MonthlyTab({ profiles, extraButtons }: Props) {
  const [year, setYear] = useQueryState('year', yearParser);
  const [month, setMonth] = useQueryState('month', monthParser);
  const [includeArchived, setIncludeArchived] = useQueryState('includeArchived', includeArchivedParser);
  const [focusReview, setFocusReview] = useQueryState('focus', focusReviewParser);
  const [marks, setMarks] = useState<ReadonlyMap<string, Mark>>(() => new Map());
  const [profileId, setProfileId] = useState('');
  const [pending, setPending] = useState<QueuedAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelledReviewJobs, setCancelledReviewJobs] = useState<ReadonlySet<string>>(() => new Set());
  const [promptsHidden, setPromptsHidden] = useState(() => CONFIRM_KINDS.some((kind) => isConfirmationHidden(kind)));

  const { counts, loading: countsLoading, error: countsError } = useMonthCounts(year);
  // Only the year grid shows sizes, so the heavier sampling request waits until it is on screen.
  const { months: storage, loading: storageLoading, error: storageError } = useMonthStorage(year, month === null);
  const { assets, truncated, loading, error, remove, restore } = useMonthAssets(year, month, includeArchived);
  /** Assets hidden the moment an action was queued, so a job that cannot settle them puts them back. */
  const queuedSnapshots = useRef(new Map<string, LibraryAsset>());
  const { watch: watchJobToast, settle: settleJobToast, drop: dropJobToast } = useJobToasts();

  const handleSettled = useCallback(
    (job: Job) => {
      const kind = job.kind;
      if (kind === 'motion') return; // the live-photo tab owns its own jobs
      if (kind === 'review') {
        const resolved = new Set(job.resolvedIds);
        const trashed = (job.reviewDecisions ?? []).filter((decision) => decision.disposition === 'trash' && resolved.has(decision.assetId)).map((decision) => decision.assetId);
        remove(trashed);
        settleJobToast(job);
        return;
      }
      // `resolvedIds` holds exactly the assets the job settled (replaced, trashed, archived, or a
      // deliberate skip); anything else it was given is still in the library and comes back.
      const affected = job.resolvedIds;
      const settled = new Set(affected);
      const unsettled: LibraryAsset[] = [];
      for (const assetId of job.assetIds) {
        const snapshot = queuedSnapshots.current.get(assetId);
        if (!snapshot) continue;
        queuedSnapshots.current.delete(assetId);
        if (!settled.has(assetId)) unsettled.push(snapshot);
      }
      remove(affected);
      restore(unsettled);
      setMarks((previous) => {
        const next = new Map(previous);
        for (const id of affected) next.delete(id);
        return next;
      });
      // The action's own toast carries the outcome, so the queue only has to settle its promise.
      settleJobToast(job);
    },
    [remove, restore, settleJobToast],
  );

  const { jobs, error: jobsError, refresh: refreshJobs } = useJobs(handleSettled);

  useEffect(() => {
    setMarks(new Map());
    // A reloaded month starts from Immich again, so snapshots from the previous month are stale.
    queuedSnapshots.current.clear();
  }, [year, month]);

  const activeProfileId = profileId || profiles[0]?.id || '';

  const pendingAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const job of jobs) {
      if (job.status !== 'queued' && job.status !== 'running') continue;
      for (const id of job.assetIds) ids.add(id);
    }
    return ids;
  }, [jobs]);

  const toggleMark = (assetId: string, mark: Mark) => {
    setMarks((previous) => {
      const next = new Map(previous);
      if (next.get(assetId) === mark) next.delete(assetId);
      else next.set(assetId, mark);
      return next;
    });
  };

  const submitJob = async (kind: ActionKind, assetIds: string[], tag: string | null = null) => {
    if (kind === 'compress' && !activeProfileId) {
      toast.error('Choose a compression profile first');
      return;
    }
    // The queued job is the only thing that will touch these assets, so hide them right away instead
    // of showing a month that still contains them until the queue gets around to reporting back.
    const requested = new Set(assetIds);
    const hidden = assets.filter((asset) => requested.has(asset.id));
    for (const asset of hidden) queuedSnapshots.current.set(asset.id, asset);
    remove(assetIds);
    setBusy(true);
    const label = kindLabel(kind, tag);
    // One toast per action: it spins from the click and shows the job's own result when it settles,
    // or the request's error if the job could not be queued at all.
    const request = watchJobToast(
      api.enqueueJob({ kind, assetIds, profileId: kind === 'compress' ? activeProfileId : null, ...(kind === 'tagArchive' ? { tag } : {}) }),
      {
        loading: `${label} · ${assetIds.length} asset(s)`,
        success: (job) => job.message ?? `${label} finished`,
        error: (error) => `${label} failed — ${error instanceof Error ? error.message : 'unknown error'}`,
      },
    );
    try {
      await request;
      refreshJobs();
    } catch {
      // The toast already reports the failure; only the optimistic edit needs rolling back.
      for (const asset of hidden) queuedSnapshots.current.delete(asset.id);
      restore(hidden);
    } finally {
      setBusy(false);
    }
  };

  const submitFocusedReview = useCallback(async (decisions: ReviewDecision[]) => {
    const assetIds = decisions.map((decision) => decision.assetId);
    const request = watchJobToast(
      api.enqueueJob({ kind: 'review', assetIds, profileId: null, decisions }),
      {
        loading: `Applying ${assetIds.length} focused review decision(s)`,
        success: (job) => job.message ?? 'Focused review stack finished',
        error: (error) => `Focused review failed — ${error instanceof Error ? error.message : 'unknown error'}`,
      },
    );
    const job = await request;
    refreshJobs();
    return job;
  }, [refreshJobs, watchJobToast]);

  const requestAction = (kind: ActionKind, assetIds: string[], tag: string | null = null) => {
    if (assetIds.length === 0) return;
    if (isConfirmationHidden(kind)) {
      void submitJob(kind, assetIds, tag);
      return;
    }
    const what = assetIds.length === 1 ? 'this asset' : `${assetIds.length} assets`;
    setPending({ kind, assetIds, tag, ...actionCopy(kind, what, tag) });
  };

  const confirmPending = (remember: boolean) => {
    const action = pending;
    if (!action) return;
    setPending(null);
    if (remember) {
      setConfirmationHidden(action.kind, true);
      setPromptsHidden(true);
      toast.info(`No longer asking before ${kindLabel(action.kind, action.tag).toLowerCase()} actions. Use “Re-enable prompts” to bring them back.`);
    }
    void submitJob(action.kind, action.assetIds, action.tag);
  };

  const cancelQueuedJob = async (jobId: string) => {
    try {
      const cancelled = jobs.find((job) => job.id === jobId);
      await api.cancelJob(jobId);
      if (cancelled?.kind === 'review') setCancelledReviewJobs((previous) => new Set([...previous, jobId]));
      // A cancelled job never settles, so its toast has to be dropped by hand.
      dropJobToast(jobId, 'Queued job cancelled');
      refreshJobs();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Unable to cancel the job');
    }
  };

  const resetPrompts = () => {
    clearConfirmations(CONFIRM_KINDS);
    setPromptsHidden(false);
    toast.info('Confirmation prompts are back on for every action.');
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={includeArchived} onCheckedChange={(checked) => void setIncludeArchived(checked === true)} />
          Include archived assets
        </label>
      </div>

      {month === null ? (
        <YearOverview
          year={year}
          counts={counts}
          storage={storage}
          loading={countsLoading}
          storageLoading={storageLoading}
          error={countsError}
          storageError={storageError}
          onYearChange={(next) => void setYear(next)}
          onOpenMonth={(next) => void setMonth(next)}
        />
      ) : focusReview ? (
        <Suspense fallback={<div className="fixed inset-0 z-[60] grid place-items-center bg-background text-sm text-muted-foreground">Loading focused review…</div>}>
          <FocusedReview
            year={year}
            month={month}
            assets={assets}
            loading={loading}
            error={error}
            truncated={truncated}
            includeArchived={includeArchived}
            extraButtons={extraButtons}
            jobs={jobs}
            cancelledReviewJobs={cancelledReviewJobs}
            onBack={() => void setFocusReview(false)}
            onQueue={submitFocusedReview}
          />
        </Suspense>
      ) : (
        <MonthView
          year={year}
          month={month}
          assets={assets}
          includeArchived={includeArchived}
          truncated={truncated}
          loading={loading}
          error={error}
          marks={marks}
          profiles={profiles}
          profileId={activeProfileId}
          busy={busy}
          promptsHidden={promptsHidden}
          pendingAssetIds={pendingAssetIds}
          extraButtons={extraButtons}
          onBack={() => void setMonth(null)}
          onStartFocused={() => void setFocusReview(true)}
          onMark={toggleMark}
          onProfileChange={setProfileId}
          onAction={requestAction}
          onResetPrompts={resetPrompts}
        />
      )}

      <JobQueuePanel jobs={jobs} error={jobsError} onCancel={(jobId) => void cancelQueuedJob(jobId)} />

      <ActionConfirm pending={pending} onCancel={() => setPending(null)} onConfirm={confirmPending} />
    </div>
  );
}
