import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/api';
import { ActionConfirm, type PendingAction } from '@/components/monthly/ActionConfirm';
import { JobQueuePanel } from '@/components/monthly/JobQueuePanel';
import { MonthView } from '@/components/monthly/MonthView';
import { YearOverview } from '@/components/monthly/YearOverview';
import { toast } from '@/components/ui/toaster';
import { useJobs } from '@/hooks/useJobs';
import { clearConfirmations, isConfirmationHidden, setConfirmationHidden } from '@/lib/confirmPrefs';
import { useMonthAssets, useMonthCounts } from '@/hooks/useLibrary';
import type { Mark } from '@/lib/bursts';
import type { ActionKind, Job, ProfileOption } from '@/types';

interface Props {
  profiles: ProfileOption[];
}

const ACTION_KINDS: readonly ActionKind[] = ['compress', 'trash', 'archive'];

const KIND_LABEL: Record<ActionKind, string> = {
  compress: 'Compress and delete original',
  trash: 'Move to trash',
  archive: 'Archive',
};

const ACTION_COPY: Record<ActionKind, { title: (what: string) => string; description: string; confirmLabel: string }> = {
  compress: {
    title: (what) => `Queue compression for ${what}?`,
    description:
      'The job runs in the background, one job at a time. Each original is replaced only after the smaller candidate is uploaded, verified, tagged, and its tags and albums are copied; the original is deleted afterwards. A replacement cannot be undone.',
    confirmLabel: 'Queue compression',
  },
  trash: {
    title: (what) => `Queue trashing ${what}?`,
    description: 'Trashed assets stay in Immich and can be restored from there.',
    confirmLabel: 'Queue trash',
  },
  archive: {
    title: (what) => `Queue archiving ${what}?`,
    description: 'Archived assets leave the timeline but stay in the library.',
    confirmLabel: 'Queue archive',
  },
};

export function MonthlyTab({ profiles }: Props) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState<number | null>(null);
  const [marks, setMarks] = useState<ReadonlyMap<string, Mark>>(() => new Map());
  const [profileId, setProfileId] = useState('');
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [promptsHidden, setPromptsHidden] = useState(() => ACTION_KINDS.some((kind) => isConfirmationHidden(kind)));

  const { counts, loading: countsLoading, error: countsError } = useMonthCounts(year);
  const { assets, truncated, loading, error, remove } = useMonthAssets(year, month);

  const handleSettled = useCallback(
    (job: Job) => {
      const affected = job.resolvedIds.length > 0 ? job.resolvedIds : job.assetIds;
      remove(affected);
      setMarks((previous) => {
        const next = new Map(previous);
        for (const id of affected) next.delete(id);
        return next;
      });
      if (job.status === 'failed') {
        toast.error(`${KIND_LABEL[job.kind]} failed — ${job.message ?? 'unknown error'}`);
      } else if (job.kind === 'compress' && job.replaced === 0) {
        toast.info(job.message ?? 'Nothing was replaced');
      } else {
        toast.success(job.message ?? `${KIND_LABEL[job.kind]} finished`);
      }
    },
    [remove],
  );

  const { jobs, error: jobsError, refresh: refreshJobs } = useJobs(handleSettled);

  useEffect(() => {
    setMarks(new Map());
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

  const submitJob = async (kind: ActionKind, assetIds: string[]) => {
    if (kind === 'compress' && !activeProfileId) {
      toast.error('Choose a compression profile first');
      return;
    }
    setBusy(true);
    try {
      await api.enqueueJob({ kind, assetIds, profileId: kind === 'compress' ? activeProfileId : null });
      toast.success(`${KIND_LABEL[kind]} queued · ${assetIds.length} asset(s)`);
      refreshJobs();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Unable to queue the job');
    } finally {
      setBusy(false);
    }
  };

  const requestAction = (kind: ActionKind, assetIds: string[]) => {
    if (assetIds.length === 0) return;
    if (isConfirmationHidden(kind)) {
      void submitJob(kind, assetIds);
      return;
    }
    const what = assetIds.length === 1 ? 'this asset' : `${assetIds.length} assets`;
    setPending({ kind, assetIds, title: ACTION_COPY[kind].title(what), description: ACTION_COPY[kind].description, confirmLabel: ACTION_COPY[kind].confirmLabel });
  };

  const confirmPending = (remember: boolean) => {
    const action = pending;
    if (!action) return;
    setPending(null);
    if (remember) {
      setConfirmationHidden(action.kind, true);
      setPromptsHidden(true);
      toast.info(`No longer asking before ${action.kind} actions. Use “Re-enable prompts” to bring them back.`);
    }
    void submitJob(action.kind, action.assetIds);
  };

  const cancelQueuedJob = async (jobId: string) => {
    try {
      await api.cancelJob(jobId);
      toast.info('Queued job cancelled');
      refreshJobs();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Unable to cancel the job');
    }
  };

  const resetPrompts = () => {
    clearConfirmations(ACTION_KINDS);
    setPromptsHidden(false);
    toast.info('Confirmation prompts are back on for every action.');
  };

  return (
    <div className="space-y-5">
      {month === null ? (
        <YearOverview
          year={year}
          counts={counts}
          loading={countsLoading}
          error={countsError}
          onYearChange={setYear}
          onOpenMonth={setMonth}
        />
      ) : (
        <MonthView
          year={year}
          month={month}
          assets={assets}
          truncated={truncated}
          loading={loading}
          error={error}
          marks={marks}
          profiles={profiles}
          profileId={activeProfileId}
          busy={busy}
          promptsHidden={promptsHidden}
          pendingAssetIds={pendingAssetIds}
          onBack={() => setMonth(null)}
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
