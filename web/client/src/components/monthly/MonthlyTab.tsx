import { useEffect, useState } from 'react';
import { api } from '@/api';
import { ActionConfirm, type PendingAction } from '@/components/monthly/ActionConfirm';
import { MonthView } from '@/components/monthly/MonthView';
import { YearOverview } from '@/components/monthly/YearOverview';
import { toast } from '@/components/ui/toaster';
import { clearConfirmations, isConfirmationHidden, setConfirmationHidden } from '@/lib/confirmPrefs';
import { useMonthAssets, useMonthCounts } from '@/hooks/useLibrary';
import type { Mark } from '@/lib/bursts';
import { compressAndDeleteOriginals } from '@/lib/compress';
import type { ActionKind, ProfileOption } from '@/types';

interface Props {
  profiles: ProfileOption[];
}

const ACTION_KINDS: readonly ActionKind[] = ['compress', 'trash', 'archive'];

const ACTION_COPY: Record<ActionKind, { title: (what: string) => string; description: string; confirmLabel: string }> = {
  compress: {
    title: (what) => `Compress ${what} and delete the originals?`,
    description:
      'Each original is replaced only after the smaller candidate is uploaded, verified, and its tags and albums are copied. The original is deleted afterwards. A replacement cannot be undone.',
    confirmLabel: 'Compress and delete originals',
  },
  trash: {
    title: (what) => `Move ${what} to the Immich trash?`,
    description: 'Trashed assets stay in Immich and can be restored from there.',
    confirmLabel: 'Move to trash',
  },
  archive: {
    title: (what) => `Archive ${what}?`,
    description: 'Archived assets leave the timeline but stay in the library.',
    confirmLabel: 'Archive',
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

  useEffect(() => {
    setMarks(new Map());
  }, [year, month]);

  const activeProfileId = profileId || profiles[0]?.id || '';

  const toggleMark = (assetId: string, mark: Mark) => {
    setMarks((previous) => {
      const next = new Map(previous);
      if (next.get(assetId) === mark) next.delete(assetId);
      else next.set(assetId, mark);
      return next;
    });
  };

  const runAction = async (kind: ActionKind, assetIds: string[]) => {
    setBusy(true);
    try {
      let resolvedIds = assetIds;
      if (kind === 'trash') {
        const result = await api.trash(assetIds);
        toast.success(`Moved ${result.accepted} asset(s) to the trash`);
      } else if (kind === 'archive') {
        const result = await api.archive(assetIds);
        toast.success(`Archived ${result.accepted} asset(s)`);
      } else {
        const outcome = await compressAndDeleteOriginals(assetIds, activeProfileId);
        resolvedIds = outcome.resolvedIds;
        if (outcome.replaced > 0) toast.success(`Replaced ${outcome.replaced} asset(s) with smaller versions`);
        if (outcome.skipped > 0) toast.info(`Left ${outcome.skipped} asset(s) unchanged: no strictly smaller candidate`);
        if (outcome.failed > 0) toast.error(`${outcome.failed} asset(s) failed — ${outcome.notes.slice(0, 2).join(' · ')}`);
      }
      remove(resolvedIds);
      setMarks((previous) => {
        const next = new Map(previous);
        for (const id of resolvedIds) next.delete(id);
        return next;
      });
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'The action failed');
    } finally {
      setBusy(false);
    }
  };

  const requestAction = (kind: ActionKind, assetIds: string[]) => {
    if (assetIds.length === 0) return;
    if (isConfirmationHidden(kind)) {
      void runAction(kind, assetIds);
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
    void runAction(action.kind, action.assetIds);
  };

  const resetPrompts = () => {
    clearConfirmations(ACTION_KINDS);
    setPromptsHidden(false);
    toast.info('Confirmation prompts are back on for every action.');
  };

  return (
    <>
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
          onBack={() => setMonth(null)}
          onMark={toggleMark}
          onProfileChange={setProfileId}
          onAction={requestAction}
          onResetPrompts={resetPrompts}
        />
      )}

      <ActionConfirm pending={pending} onCancel={() => setPending(null)} onConfirm={confirmPending} />
    </>
  );
}
