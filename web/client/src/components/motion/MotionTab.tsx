import { useCallback, useEffect, useState } from 'react';
import { CircleSlash, Film, Loader2, RefreshCw } from 'lucide-react';
import { api, thumbnailUrl, type Job, type MotionPhoto } from '@/api';
import { ActionConfirm, type PendingAction } from '@/components/monthly/ActionConfirm';
import { JobQueuePanel } from '@/components/monthly/JobQueuePanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { useJobs } from '@/hooks/useJobs';
import { clearConfirmations, CONFIRM_KINDS, isConfirmationHidden, setConfirmationHidden } from '@/lib/confirmPrefs';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';

const MOTION = 'motion' as const;

export function MotionTab() {
  const [items, setItems] = useState<MotionPhoto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [promptsHidden, setPromptsHidden] = useState(() => isConfirmationHidden(MOTION));

  const load = useCallback(async (cursor?: string) => {
    setLoading(true);
    try {
      const result = await api.motionPhotos(cursor);
      setItems((previous) => (cursor ? [...previous, ...result.items] : result.items));
      setNextCursor(result.nextCursor);
      setTotal(result.total);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load live photos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSettled = useCallback(
    (job: Job) => {
      if (job.kind !== MOTION) return;
      const affected = job.resolvedIds.length > 0 ? job.resolvedIds : job.assetIds;
      const removed = new Set(affected);
      setItems((previous) => previous.filter((item) => !removed.has(item.id)));
      setSelected((previous) => {
        const next = new Set(previous);
        for (const id of affected) next.delete(id);
        return next;
      });
      if (job.status === 'failed') toast.error(`Motion video cleanup failed — ${job.message ?? 'unknown error'}`);
      else toast.success(job.message ?? 'Motion videos unlinked and trashed');
    },
    [],
  );

  const { jobs, error: jobsError, refresh: refreshJobs } = useJobs(handleSettled);

  const toggle = (assetId: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  const setAllLoaded = (checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const item of items) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  };

  const pendingAssetIds = new Set<string>();
  for (const job of jobs) {
    if (job.status !== 'queued' && job.status !== 'running') continue;
    for (const id of job.assetIds) pendingAssetIds.add(id);
  }

  const enqueue = async (assetIds: string[]) => {
    setBusy(true);
    try {
      await api.enqueueJob({ kind: MOTION, assetIds, profileId: null });
      toast.success(`Unlink queued · ${assetIds.length} live photo(s)`);
      refreshJobs();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : 'Unable to queue the job');
    } finally {
      setBusy(false);
    }
  };

  const requestAction = () => {
    const assetIds = [...selected].filter((id) => !pendingAssetIds.has(id));
    if (assetIds.length === 0) {
      toast.info('Select at least one live photo first');
      return;
    }
    if (isConfirmationHidden(MOTION)) {
      void enqueue(assetIds);
      return;
    }
    setPending({
      kind: MOTION,
      assetIds,
      title: `Unlink and trash the motion video for ${assetIds.length === 1 ? 'this live photo' : `${assetIds.length} live photos`}?`,
      description:
        'Each still image keeps its place in the library and keeps its date, albums and tags; only the paired video is detached and moved to the Immich trash, where it can be restored. The original image file is never modified.',
      confirmLabel: 'Unlink and trash videos',
    });
  };

  const confirmPending = (remember: boolean) => {
    const action = pending;
    if (!action) return;
    setPending(null);
    if (remember) {
      setConfirmationHidden(MOTION, true);
      setPromptsHidden(true);
      toast.info('No longer asking before unlinking motion videos. Use “Re-enable prompts” to bring it back.');
    }
    void enqueue(action.assetIds);
  };

  const resetPrompts = () => {
    clearConfirmations(CONFIRM_KINDS);
    setPromptsHidden(false);
    toast.info('Confirmation prompts are back on for every action.');
  };

  const allLoadedSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  const selectableCount = [...selected].filter((id) => !pendingAssetIds.has(id)).length;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Live photos</CardTitle>
              <p className="text-sm text-muted-foreground">
                Still images that still carry a paired motion video (iPhone Live Photos, Samsung Motion Photos). Unlinking keeps the photo and
                moves only the video to the trash.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {promptsHidden ? (
                <Button variant="ghost" size="sm" onClick={resetPrompts}>
                  Re-enable prompts
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
                Refresh
              </Button>
              <Button size="sm" disabled={busy || selectableCount === 0} onClick={requestAction}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <CircleSlash className="size-4" />}
                Unlink and trash ({selectableCount})
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {loading && items.length === 0 ? 'Searching Immich…' : `${items.length} shown · ${total} Immich matches`}
            {' · jobs run one after another, so you can queue more while one is running'}
          </p>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          {items.length > 0 ? (
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox checked={allLoadedSelected} onCheckedChange={(checked) => setAllLoaded(checked === true)} />
              Select loaded live photos
            </label>
          ) : null}

          {loading && items.length === 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {Array.from({ length: 10 }, (_unused, index) => (
                <Skeleton key={index} className="aspect-4/3 rounded-xl" />
              ))}
            </div>
          ) : null}

          {items.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {items.map((item) => {
                const isPending = pendingAssetIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'asset-tile overflow-hidden rounded-xl border bg-card',
                      selected.has(item.id) ? 'border-primary ring-2 ring-primary/30' : 'border-border',
                    )}
                  >
                    <div className="relative aspect-4/3 bg-muted">
                      <img src={thumbnailUrl(item.id)} alt={item.originalFileName} loading="lazy" decoding="async" className="size-full object-cover" />
                      <label className="absolute top-2 left-2 grid size-6 place-items-center rounded-md bg-background/90">
                        <Checkbox
                          checked={selected.has(item.id)}
                          disabled={isPending}
                          onCheckedChange={() => toggle(item.id)}
                          aria-label={`Select ${item.originalFileName}`}
                        />
                      </label>
                      <Badge className="absolute right-2 bottom-2" variant="secondary">
                        <Film className="size-3" />
                        video
                      </Badge>
                      {isPending ? (
                        <span className="absolute bottom-2 left-2">
                          <Badge variant="secondary">queued</Badge>
                        </span>
                      ) : null}
                    </div>
                    <div className="space-y-1 p-2">
                      <p className="truncate text-xs font-medium" title={item.originalFileName}>
                        {item.originalFileName}
                      </p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {item.localDateTime.slice(0, 16).replace('T', ' · ')} · {formatBytes(item.size)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {!loading && items.length === 0 && !error ? (
            <p className="text-sm text-muted-foreground">
              No images with a linked motion video were found. If you know you have Live or Motion photos, the Immich search flag behind this list
              may not match your server version — tell me and I will switch the query.
            </p>
          ) : null}

          {nextCursor ? (
            <div className="flex justify-center pt-2">
              <Button variant="outline" disabled={loading} onClick={() => void load(nextCursor)}>
                Load more
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <JobQueuePanel jobs={jobs.filter((job) => job.kind === MOTION)} error={jobsError} onCancel={(jobId) => void api.cancelJob(jobId).then(refreshJobs).catch(() => toast.error('Unable to cancel the job'))} />

      <ActionConfirm pending={pending} onCancel={() => setPending(null)} onConfirm={confirmPending} />
    </div>
  );
}
