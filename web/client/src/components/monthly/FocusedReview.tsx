import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HotkeysProvider, useHotkeys } from '@tanstack/react-hotkeys';
import { ArrowRight, ArrowUpLeft, CalendarDays, Check, CircleHelp, ExternalLink, LayoutGrid, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { thumbnailUrl } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FaceRow } from '@/components/monthly/FaceRow';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { assetLink } from '@/lib/immichLinks';
import { formatBytes } from '@/lib/format';
import { buildReviewStacks, formatReviewDay, loadFocusReviewDraft, loadFocusReviewPrefs, saveFocusReviewDraft, saveFocusReviewPrefs, type FocusReviewDraft, type FocusReviewPrefs, type ReviewChoice, type ReviewDecision, type ReviewStack, type SinglesGridSize } from '@/lib/focusedReview';
import { monthLabel } from '@/lib/months';
import { cn } from '@/lib/utils';
import type { ExtraButton, Job, LibraryAsset } from '@/types';

interface Props {
  year: number;
  month: number;
  assets: LibraryAsset[];
  loading: boolean;
  error: string;
  truncated: boolean;
  includeArchived: boolean;
  extraButtons: readonly ExtraButton[];
  jobs: Job[];
  cancelledReviewJobs: ReadonlySet<string>;
  onBack: () => void;
  onQueue: (decisions: ReviewDecision[]) => Promise<Job>;
}

type AssetReviewState = 'ready' | 'queued' | 'done' | 'failed' | 'unknown';
type StackReviewState = 'ready' | 'queued' | 'done' | 'failed' | 'unknown';

/** Digits 1–9 map to the configured EXTRA_BUTTONS slots, in button order. */
const TAG_HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
const GRID_SIZE_OPTIONS: readonly SinglesGridSize[] = [2, 3, 4, 5];
/** Literal classes, because the strict CSP forbids inline styles. */
const GRID_COLUMN_CLASS: Record<SinglesGridSize, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
};

function isTerminal(job: Job): boolean {
  return job.status === 'done' || job.status === 'failed';
}

function FocusedReviewBody({ year, month, assets, loading, error, truncated, includeArchived, extraButtons, jobs, cancelledReviewJobs, onBack, onQueue }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<FocusReviewDraft>(() => loadFocusReviewDraft(year, month));
  const [prefs, setPrefs] = useState<FocusReviewPrefs>(loadFocusReviewPrefs);
  const [dayOpen, setDayOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastTouchedId, setLastTouchedId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [atEnd, setAtEnd] = useState(false);
  const { singlesGrid, gridSize } = prefs;
  const stacks = useMemo(() => buildReviewStacks(assets, singlesGrid ? gridSize : 0), [assets, gridSize, singlesGrid]);
  const jobById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);

  const assetState = useCallback((assetId: string, snapshot: FocusReviewDraft = draft): AssetReviewState => {
    if (snapshot.completedIds.includes(assetId)) return 'done';
    if (snapshot.failedIds.includes(assetId)) return 'failed';
    const jobId = snapshot.jobsByAsset[assetId];
    if (!jobId) return 'ready';
    if (cancelledReviewJobs.has(jobId)) return 'failed';
    const job = jobById.get(jobId);
    if (!job) return 'unknown';
    if (job.status === 'queued' || job.status === 'running') return 'queued';
    return job.resolvedIds.includes(assetId) ? 'done' : 'failed';
  }, [cancelledReviewJobs, draft, jobById]);

  const stackState = useCallback((stack: ReviewStack, snapshot: FocusReviewDraft = draft): StackReviewState => {
    const states = stack.items.map((asset) => assetState(asset.id, snapshot));
    if (states.every((state) => state === 'done')) return 'done';
    if (states.some((state) => state === 'unknown')) return 'unknown';
    if (states.some((state) => state === 'queued')) return 'queued';
    if (states.some((state) => state === 'failed')) return 'failed';
    return 'ready';
  }, [assetState, draft]);

  const isActionable = (stack: ReviewStack) => ['ready', 'failed', 'unknown'].includes(stackState(stack));
  const isBurstStack = (stack: ReviewStack) => stack.layout === 'row' && stack.items.length > 1;

  useEffect(() => saveFocusReviewDraft(year, month, draft), [year, month, draft]);
  useEffect(() => saveFocusReviewPrefs(prefs), [prefs]);

  // Reconcile terminal jobs against the locally saved draft. Failed/ambiguous assets keep their
  // choices for a deliberate retry; successful decisions are remembered so they are not revisited.
  useEffect(() => {
    setDraft((previous) => {
      let changed = false;
      const next: FocusReviewDraft = {
        ...previous,
        choices: { ...previous.choices },
        completedIds: [...previous.completedIds],
        jobsByAsset: { ...previous.jobsByAsset },
        failedIds: [...previous.failedIds],
      };
      for (const job of jobs) {
        if (job.kind !== 'review' || !isTerminal(job)) continue;
        for (const decision of job.reviewDecisions ?? []) {
          if (next.jobsByAsset[decision.assetId] !== job.id) continue;
          changed = true;
          delete next.jobsByAsset[decision.assetId];
          if (job.resolvedIds.includes(decision.assetId)) {
            if (!next.completedIds.includes(decision.assetId)) next.completedIds.push(decision.assetId);
            delete next.choices[decision.assetId];
            next.failedIds = next.failedIds.filter((id) => id !== decision.assetId);
          } else if (!next.failedIds.includes(decision.assetId)) {
            next.failedIds.push(decision.assetId);
          }
        }
      }
      return changed ? next : previous;
    });
  }, [jobs]);

  const activeStack = atEnd
    ? null
    : (stacks.find((stack) => stack.key === draft.currentStackKey && ['ready', 'failed', 'unknown'].includes(stackState(stack)))) ??
      stacks.find((stack) => ['ready', 'failed', 'unknown'].includes(stackState(stack))) ??
      null;

  /** Changing the singles layout keeps the page that holds the selected photo in front of the user. */
  const updatePrefs = (next: FocusReviewPrefs) => {
    const anchorId = focusedId ?? activeStack?.items[0]?.id;
    setPrefs(next);
    if (!anchorId) return;
    const regrouped = buildReviewStacks(assets, next.singlesGrid ? next.gridSize : 0);
    const anchor = regrouped.find((stack) => stack.items.some((asset) => asset.id === anchorId));
    if (anchor) {
      setAtEnd(false);
      setDraft((previous) => ({ ...previous, currentStackKey: anchor.key }));
    }
  };

  useEffect(() => {
    if (!activeStack || loading || dayOpen || helpOpen) return;
    const target = activeStack.items.find((asset) => asset.id === focusedId && (assetState(asset.id) === 'ready' || assetState(asset.id) === 'failed'))
      ?? activeStack.items.find((asset) => assetState(asset.id) === 'ready' || assetState(asset.id) === 'failed')
      ?? activeStack.items[0];
    if (!target) return;
    const card = rootRef.current?.querySelector<HTMLElement>(`[data-review-asset-id="${target.id}"]`);
    if (!card) return;
    const frame = window.requestAnimationFrame(() => {
      setFocusedId(target.id);
      card.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeStack?.key, dayOpen, helpOpen, loading]);

  useEffect(() => {
    if (loading || stacks.length === 0 || atEnd) return;
    const selected = stacks.find((stack) => stack.key === draft.currentStackKey);
    if (selected && isActionable(selected)) return;
    const next = stacks.find(isActionable);
    if (next?.key !== draft.currentStackKey) {
      setDraft((previous) => ({ ...previous, currentStackKey: next?.key ?? null }));
    }
  }, [atEnd, draft.currentStackKey, loading, stacks]);

  const dayStacks = activeStack ? stacks.filter((stack) => stack.day === activeStack.day) : [];
  const dayIndex = activeStack ? dayStacks.findIndex((stack) => stack.key === activeStack.key) : -1;
  const dayRemaining = dayStacks.filter(isActionable).length;
  const dayQueued = dayStacks.filter((stack) => stackState(stack) === 'queued').length;
  const monthRemaining = stacks.filter(isActionable).length;
  const allQueued = stacks.length > 0 && monthRemaining === 0 && stacks.some((stack) => stackState(stack) === 'queued');
  const complete = monthRemaining === 0 && !allQueued && (stacks.length > 0 || draft.completedIds.length > 0);
  const selectedAsset = focusedAsset();
  const selectedChoice = selectedAsset ? draft.choices[selectedAsset.id] : undefined;
  const selectedState = selectedAsset ? assetState(selectedAsset.id) : null;

  const choose = (assetId: string, disposition: ReviewChoice['disposition']) => {
    if (assetState(assetId) === 'done' || assetState(assetId) === 'queued' || assetState(assetId) === 'unknown') return;
    setFocusedId(assetId);
    setLastTouchedId(assetId);
    setDraft((previous) => {
      const old = previous.choices[assetId];
      const choices = { ...previous.choices };
      if (old?.disposition === disposition) delete choices[assetId];
      else choices[assetId] = { disposition, tags: disposition === 'keep' && old?.disposition === 'keep' ? old.tags : [] };
      return { ...previous, choices, failedIds: previous.failedIds.filter((id) => id !== assetId) };
    });
  };

  const toggleTag = (assetId: string, tag: string) => {
    if (assetState(assetId) !== 'ready' && assetState(assetId) !== 'failed') return;
    setDraft((previous) => {
      const choice = previous.choices[assetId];
      if (!choice || choice.disposition !== 'keep') return previous;
      const tags = choice.tags.includes(tag) ? choice.tags.filter((candidate) => candidate !== tag) : [...choice.tags, tag];
      return { ...previous, choices: { ...previous.choices, [assetId]: { ...choice, tags } } };
    });
  };

  const canApply = Boolean(activeStack) && !submitting && activeStack!.items.every((asset) => {
    const state = assetState(asset.id);
    return state === 'done' || ((state === 'ready' || state === 'failed') && draft.choices[asset.id] !== undefined);
  });

  const nextStackAfter = (stack: ReviewStack): ReviewStack | undefined => {
    const currentIndex = stacks.findIndex((candidate) => candidate.key === stack.key);
    return stacks.slice(currentIndex + 1).find(isActionable);
  };

  const setCurrentStack = (key: string) => {
    setAtEnd(false);
    setDraft((previous) => ({ ...previous, currentStackKey: key }));
    setDayOpen(false);
    setFocusedId(null);
  };

  /** Alt+S skips singles and lands on the next burst stack that still needs review. */
  const jumpToNextBurst = () => {
    if (!activeStack) return;
    const currentIndex = stacks.findIndex((stack) => stack.key === activeStack.key);
    const next = stacks.slice(currentIndex + 1).find((stack) => isBurstStack(stack) && isActionable(stack));
    if (next) setCurrentStack(next.key);
  };

  const applyAndNext = async () => {
    if (!activeStack || !canApply) return;
    const decisions = activeStack.items.flatMap((asset) => {
      if (assetState(asset.id) === 'done') return [];
      const choice = draft.choices[asset.id];
      return choice ? [{ assetId: asset.id, disposition: choice.disposition, tags: choice.disposition === 'keep' ? choice.tags : [] }] : [];
    });
    if (decisions.length === 0) return;
    setSubmitting(true);
    try {
      const job = await onQueue(decisions);
      const next = nextStackAfter(activeStack);
      setAtEnd(!next);
      setDraft((previous) => {
        const jobsByAsset = { ...previous.jobsByAsset };
        for (const decision of decisions) jobsByAsset[decision.assetId] = job.id;
        return { ...previous, jobsByAsset, currentStackKey: next?.key ?? null };
      });
      setFocusedId(null);
      setLastTouchedId(null);
    } catch {
      // The enqueue toast reports the failure; staged choices stay in the draft for a retry.
    } finally {
      setSubmitting(false);
    }
  };

  const skipStack = () => {
    if (!activeStack || submitting) return;
    const next = nextStackAfter(activeStack);
    setAtEnd(!next);
    setDraft((previous) => ({ ...previous, currentStackKey: next?.key ?? null }));
    setFocusedId(null);
  };

  const undoLast = () => {
    if (!lastTouchedId) return;
    setDraft((previous) => {
      const choices = { ...previous.choices };
      delete choices[lastTouchedId];
      return { ...previous, choices };
    });
    setLastTouchedId(null);
  };

  const reviewUnknownAgain = (assetId: string) => {
    setDraft((previous) => ({
      ...previous,
      jobsByAsset: omit(previous.jobsByAsset, assetId),
      failedIds: [...new Set([...previous.failedIds, assetId])],
    }));
  };

  function focusedAsset() {
    return activeStack?.items.find((asset) => asset.id === focusedId) ??
      activeStack?.items.find((asset) => assetState(asset.id) === 'ready' || assetState(asset.id) === 'failed');
  }

  const focusAsset = (asset: LibraryAsset) => {
    setFocusedId(asset.id);
    const card = rootRef.current?.querySelector<HTMLElement>(`[data-review-asset-id="${asset.id}"]`);
    if (!card) return;
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  };

  /** Vim j/k: move the selection inside the current stack, stopping at its ends. */
  const moveFocus = (delta: 1 | -1) => {
    if (!activeStack) return;
    const items = activeStack.items;
    const currentIndex = items.findIndex((asset) => asset.id === focusedId);
    const startIndex = currentIndex >= 0 ? currentIndex : delta > 0 ? -1 : items.length;
    const nextIndex = Math.max(0, Math.min(items.length - 1, startIndex + delta));
    const next = items[nextIndex];
    if (next) focusAsset(next);
  };

  const markFocused = (disposition: ReviewChoice['disposition']) => {
    const target = focusedAsset();
    if (target) choose(target.id, disposition);
  };

  /** Digits keep the focused photo and toggle the tag of the matching EXTRA_BUTTONS slot. */
  const toggleTagAt = (index: number) => {
    const button = extraButtons[index];
    const target = focusedAsset();
    if (!button || !target) return;
    const state = assetState(target.id);
    if (state === 'done' || state === 'queued' || state === 'unknown') return;
    if (draft.choices[target.id]?.disposition !== 'keep') choose(target.id, 'keep');
    toggleTag(target.id, button.label);
    focusAsset(target);
  };

  /** Tag chips are shared by the row card and the selected-cell bar under a singles grid. */
  const renderTagButtons = (asset: LibraryAsset, choice: ReviewChoice, locked: boolean) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-muted-foreground">Tags:</span>
      {extraButtons.length === 0 ? <span className="text-xs text-muted-foreground">No configured tags</span> : null}
      {extraButtons.map((button, index) => (
        <button
          key={button.label}
          type="button"
          disabled={locked}
          aria-pressed={choice.tags.includes(button.label)}
          onClick={() => {
            toggleTag(asset.id, button.label);
            focusAsset(asset);
          }}
          className={cn(
            'min-h-8 rounded-full border px-2.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-primary',
            choice.tags.includes(button.label) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-accent',
            locked && 'opacity-60',
          )}
        >
          {index < 9 ? <span className="mr-1 tabular-nums opacity-60">{index + 1}</span> : null}
          {button.label}
        </button>
      ))}
    </div>
  );

  const shortcutAllowed = (event: KeyboardEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;
    // The dialog intentionally starts without focusing a control, so body focus still drives the
    // review shortcuts. Otherwise keep shortcuts inside this modal and out of interactive controls.
    if (target === document.body) return true;
    if (!rootRef.current?.contains(target)) return false;
    return !target.closest('button, a, input, textarea, select, [contenteditable="true"], [role="checkbox"], [role="combobox"]');
  };

  useHotkeys(
    [
      { hotkey: 'J', callback: (event) => { if (shortcutAllowed(event)) moveFocus(1); } },
      { hotkey: 'K', callback: (event) => { if (shortcutAllowed(event)) moveFocus(-1); } },
      ...TAG_HOTKEYS.slice(0, Math.min(TAG_HOTKEYS.length, extraButtons.length)).map((hotkey, index) => ({
        hotkey,
        callback: (event: KeyboardEvent) => { if (shortcutAllowed(event)) toggleTagAt(index); },
      })),
      { hotkey: 'Space', callback: (event) => { if (shortcutAllowed(event)) markFocused('keep'); } },
      { hotkey: 'Backspace', callback: (event) => { if (shortcutAllowed(event)) markFocused('trash'); } },
      { hotkey: 'Delete', callback: (event) => { if (shortcutAllowed(event)) markFocused('trash'); } },
      { hotkey: 'D', callback: (event) => { if (shortcutAllowed(event)) markFocused('trash'); } },
      { hotkey: 'Z', callback: (event) => { if (shortcutAllowed(event)) undoLast(); } },
      { hotkey: 'Enter', callback: (event) => { if (shortcutAllowed(event)) void applyAndNext(); } },
      { hotkey: 'S', callback: (event) => { if (shortcutAllowed(event)) skipStack(); } },
      // Physical KeyS so macOS Option+S (which types “ß”) still jumps.
      { hotkey: 'Alt+[KeyS]', callback: (event) => { if (shortcutAllowed(event)) jumpToNextBurst(); } },
      { hotkey: 'O', callback: (event) => { if (shortcutAllowed(event)) setDayOpen(true); } },
      { hotkey: 'Escape', callback: (event) => { if (shortcutAllowed(event)) onBack(); } },
      // '?' is global inside the review, even after a button (such as the help button) has focus.
      { hotkey: '?', callback: () => setHelpOpen(true), options: { ignoreInputs: false } },
    ],
    { target: document, enabled: !dayOpen && !helpOpen && !loading, ignoreInputs: true, preventDefault: true, stopPropagation: true },
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onBack(); }}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="!fixed !inset-0 !top-0 !left-0 !z-50 !h-[100dvh] !w-screen !min-w-0 !max-w-none !translate-x-0 !translate-y-0 !gap-0 !overflow-hidden !rounded-none !border-0 !p-0 shadow-none sm:!max-w-none"
      >
        <DialogTitle className="sr-only">Focused monthly review</DialogTitle>
        <DialogDescription className="sr-only">Review photos in chronological stacks. Decisions are only applied when you choose Apply and next.</DialogDescription>
    <div ref={rootRef} className="flex h-[100dvh] min-w-0 w-full flex-col overflow-hidden bg-background" aria-label="Focused monthly review">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-3 py-3 backdrop-blur sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="outline" size="icon" aria-label="Back to the month grid" title="Back to the month grid" onClick={onBack}>
              <ArrowUpLeft />
            </Button>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{monthLabel(month)} {year} · Focused review</p>
              <h2 className="truncate text-base font-semibold sm:text-lg">
                {activeStack ? formatReviewDay(activeStack.day) : complete ? 'Month review complete' : allQueued ? 'Waiting for queued actions' : 'Focused review'}
              </h2>
              {activeStack ? (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {activeStack.layout === 'grid' ? 'Grid' : 'Stack'} {dayIndex + 1} of {dayStacks.length} · {dayRemaining} left today{dayQueued > 0 ? ` · ${dayQueued} queued` : ''}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">{loading ? 'Loading the month…' : `${monthRemaining} stack(s) left to review`}</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant={singlesGrid ? 'secondary' : 'ghost'}
              size="sm"
              className="h-10 sm:h-9"
              aria-pressed={singlesGrid}
              title="Group single photos between burst stacks into a grid"
              onClick={() => updatePrefs({ ...prefs, singlesGrid: !singlesGrid })}
            >
              <LayoutGrid />
              <span className="hidden md:inline">Singles grid</span>
              <span className="md:hidden">{singlesGrid ? 'Grid on' : 'Grid off'}</span>
            </Button>
            {singlesGrid ? (
              <select
                aria-label="Singles grid size"
                value={gridSize}
                onChange={(event) => {
                  const nextSize = Number(event.target.value);
                  if (GRID_SIZE_OPTIONS.includes(nextSize as SinglesGridSize)) updatePrefs({ ...prefs, gridSize: nextSize as SinglesGridSize });
                }}
                className="h-10 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9"
              >
                {GRID_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size}×{size}</option>
                ))}
              </select>
            ) : null}
            {activeStack ? (
              <Button variant="outline" size="sm" className="h-10 sm:h-9" onClick={() => setDayOpen(true)}>
                <CalendarDays />
                <span className="hidden sm:inline">Day overview</span>
                <span className="sm:hidden">{dayRemaining} left today</span>
              </Button>
            ) : null}
            <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setHelpOpen(true)}>
              <CircleHelp />
            </Button>
          </div>
        </header>

        {truncated ? (
          <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs text-foreground">
            This month reached the 3,000-asset limit. Focused review only covers the assets loaded so far.
          </div>
        ) : null}
        {!includeArchived ? null : (
          <div className="sr-only" aria-live="polite">Archived assets are included in this review.</div>
        )}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {error ? <p className="px-4 py-3 text-sm text-destructive">{error}</p> : null}
          {loading ? (
            <div className="flex min-h-0 flex-1 items-center justify-center gap-3 p-4">
              {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-[55vh] w-[28vw] rounded-2xl" />)}
            </div>
          ) : activeStack ? (
            <>
              {activeStack.layout === 'grid' ? (
                <>
                  <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3 sm:p-6">
                    <div
                      className={cn('grid w-full max-w-[min(72rem,calc(100dvh-220px))] gap-2', GRID_COLUMN_CLASS[activeStack.columns ?? gridSize])}
                    >
                      {activeStack.items.map((asset) => (
                        <GridTile
                          key={asset.id}
                          asset={asset}
                          state={assetState(asset.id)}
                          choice={draft.choices[asset.id]}
                          focused={focusedId === asset.id}
                          onChoose={choose}
                          onFocus={() => setFocusedId(asset.id)}
                        />
                      ))}
                    </div>
                  </div>
                  {selectedAsset && selectedState ? (
                    <div className="shrink-0 border-t bg-background/95 px-3 py-2 sm:px-6">
                      <div className="mx-auto flex min-h-9 max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                        <span className="max-w-[45vw] truncate font-medium" title={selectedAsset.originalFileName}>{selectedAsset.originalFileName}</span>
                        <span className="text-muted-foreground tabular-nums">{selectedAsset.localDateTime.slice(11, 16)}</span>
                        <FaceRow asset={selectedAsset} />
                        {selectedState === 'done' ? <Badge className="bg-success text-success-foreground"><Check className="size-3" /> Reviewed</Badge> : null}
                        {selectedState === 'queued' ? <Badge variant="secondary"><Loader2 className="size-3 animate-spin" /> Queued in Immich</Badge> : null}
                        {selectedState === 'unknown' ? (
                          <Button variant="secondary" size="sm" className="h-8" onClick={() => reviewUnknownAgain(selectedAsset.id)}>I checked — review again</Button>
                        ) : null}
                        {selectedState === 'failed' ? <span className="text-destructive">Previous attempt did not settle this photo.</span> : null}
                        {selectedChoice?.disposition === 'keep' ? renderTagButtons(selectedAsset, selectedChoice, selectedState === 'done' || selectedState === 'queued' || selectedState === 'unknown') : null}
                        {selectedChoice?.disposition === 'trash' ? <span className="text-destructive">Will move to Immich trash when applied</span> : null}
                        {!selectedChoice && !['done', 'queued', 'unknown'].includes(selectedState) ? (
                          <span className="text-muted-foreground">Space keeps · D trashes{extraButtons.length > 0 ? ' · 1–9 tags' : ''}</span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="focus-review-scroller flex min-h-0 min-w-0 flex-1 snap-x snap-mandatory items-stretch gap-3 overflow-x-auto px-3 py-3 sm:justify-center sm:px-6">
                {activeStack.items.map((asset) => {
                  const state = assetState(asset.id);
                  const choice = draft.choices[asset.id];
                  const locked = state === 'done' || state === 'queued' || state === 'unknown';
                  const isFocused = focusedId === asset.id;
                  return (
                    <article
                      key={asset.id}
                      data-review-asset-id={asset.id}
                      className={cn(
                        'flex h-full w-[82vw] min-w-[82vw] max-w-[560px] shrink-0 snap-center flex-col gap-2 rounded-2xl border bg-card p-2.5 sm:w-auto sm:min-w-[280px] sm:flex-1',
                        choice?.disposition === 'keep' && 'border-success ring-2 ring-success/40',
                        choice?.disposition === 'trash' && 'border-destructive ring-2 ring-destructive/40',
                        state === 'done' && 'border-success/60',
                        isFocused && 'ring-2 ring-primary/40',
                      )}
                      tabIndex={-1}
                      onFocusCapture={() => setFocusedId(asset.id)}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-2 px-1">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium" title={asset.originalFileName}>{asset.originalFileName}</p>
                          <p className="text-xs text-muted-foreground tabular-nums">{asset.localDateTime.slice(11, 16)} · {formatBytes(asset.size)}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {state === 'queued' ? <Badge variant="secondary"><Loader2 className="size-3 animate-spin" /> Queued</Badge> : null}
                          {state === 'done' ? <Badge className="bg-success text-success-foreground"><Check className="size-3" /> Reviewed</Badge> : null}
                          {state === 'failed' ? <Badge variant="destructive">Needs retry</Badge> : null}
                          {state === 'unknown' ? <Badge variant="destructive">Status unknown</Badge> : null}
                          {asset.isVideo ? <Badge variant="outline">video</Badge> : null}
                          {asset.visibility === 'archive' ? <Badge variant="secondary">archived</Badge> : null}
                          <a
                            href={assetLink(asset.id)}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open ${asset.originalFileName} in Immich`}
                            title="Open in Immich"
                            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            <ExternalLink className="size-4" />
                          </a>
                        </div>
                      </div>

                      <div className="relative flex min-h-[180px] flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
                        <img
                          src={thumbnailUrl(asset.id, 'preview')}
                          alt={asset.originalFileName}
                          loading={activeStack.items.indexOf(asset) < 3 ? 'eager' : 'lazy'}
                          decoding="async"
                          className="h-full max-h-full w-full object-contain"
                        />
                        {!locked ? (
                          <>
                            <button
                              type="button"
                              aria-label={`Keep ${asset.originalFileName}`}
                              aria-pressed={choice?.disposition === 'keep'}
                              className="group/keep absolute inset-y-0 left-0 flex w-1/2 cursor-pointer items-end justify-start bg-transparent p-3 text-white outline-none transition-colors hover:bg-success/20 focus-visible:bg-success/25"
                              onClick={(event) => {
                                const card = event.currentTarget.closest('article');
                                choose(asset.id, 'keep');
                                requestAnimationFrame(() => card?.focus());
                              }}
                            >
                              <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-3 py-2 text-sm font-semibold shadow-sm backdrop-blur">
                                <Check className="size-4" /> Keep <span className="hidden md:inline">←</span>
                              </span>
                            </button>
                            <button
                              type="button"
                              aria-label={`Mark ${asset.originalFileName} for Immich trash`}
                              aria-pressed={choice?.disposition === 'trash'}
                              className="group/trash absolute inset-y-0 right-0 flex w-1/2 cursor-pointer items-end justify-end bg-transparent p-3 text-white outline-none transition-colors hover:bg-destructive/25 focus-visible:bg-destructive/30"
                              onClick={(event) => {
                                const card = event.currentTarget.closest('article');
                                choose(asset.id, 'trash');
                                requestAnimationFrame(() => card?.focus());
                              }}
                            >
                              <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-3 py-2 text-sm font-semibold shadow-sm backdrop-blur">
                                <Trash2 className="size-4" /> Trash <span className="hidden md:inline">→</span>
                              </span>
                            </button>
                          </>
                        ) : null}
                        {state === 'done' ? <div className="absolute inset-0 grid place-items-center bg-success/15 text-sm font-semibold text-white">Reviewed</div> : null}
                        {state === 'queued' ? <div className="absolute inset-0 grid place-items-center bg-black/45 text-sm font-semibold text-white">Queued in Immich</div> : null}
                        {state === 'unknown' ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 px-4 text-center text-sm text-white">
                          <span>We can’t confirm whether the queued action finished. Check Immich before retrying.</span>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => reviewUnknownAgain(asset.id)}
                          >
                            I checked — review again
                          </Button>
                        </div> : null}
                      </div>

                      <FaceRow asset={asset} className="px-1" />

                      <div className="min-h-10 px-1">
                        {choice?.disposition === 'keep' ? renderTagButtons(asset, choice, locked) : choice?.disposition === 'trash' ? (
                          <p className="flex items-center gap-1 text-xs text-destructive"><Trash2 className="size-3" /> Will move to Immich trash when applied</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Choose Keep or Trash · nothing changes until you apply this stack</p>
                        )}
                        {assetState(asset.id) === 'failed' ? <p className="mt-1 text-xs text-destructive">The previous attempt did not settle this photo. Review the choice and apply again.</p> : null}
                      </div>
                    </article>
                  );
                })}
                </div>
              )}
              <div className="shrink-0 border-t bg-background/95 px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur sm:px-6 sm:pb-4">
                <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{activeStack.items.filter((asset) => draft.choices[asset.id]?.disposition === 'keep').length} keep</span>
                    <span>·</span>
                    <span>{activeStack.items.filter((asset) => draft.choices[asset.id]?.disposition === 'trash').length} to trash</span>
                    <span className="hidden sm:inline">· Nothing is applied until you continue</span>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                    <div className="flex w-full gap-2 sm:w-auto">
                      <Button variant="outline" className="h-11 flex-1 sm:flex-none" disabled={!lastTouchedId || submitting} onClick={undoLast}>
                        <RotateCcw /> Undo
                      </Button>
                      <Button variant="ghost" className="h-11 flex-1 sm:flex-none" disabled={submitting} onClick={skipStack}>
                        Skip for now <ArrowRight />
                      </Button>
                    </div>
                    <Button
                      className="h-11 w-full sm:w-auto sm:min-w-52"
                      variant={activeStack.items.some((asset) => draft.choices[asset.id]?.disposition === 'trash') ? 'destructive' : 'default'}
                      disabled={!canApply}
                      onClick={() => void applyAndNext()}
                    >
                      {submitting ? <Loader2 className="animate-spin" /> : <Check />}
                      {submitting ? 'Queueing…' : `Apply ${activeStack.items.filter((asset) => assetState(asset.id) !== 'done').length} & next`}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              {loading ? null : complete ? (
                <>
                  <div className="grid size-14 place-items-center rounded-full bg-success/15 text-success"><Check className="size-7" /></div>
                  <h3 className="text-xl font-semibold">Month reviewed</h3>
                  <p className="max-w-md text-sm text-muted-foreground">All loaded stacks have been reviewed. You can return to the month grid or open the day overview from any stack.</p>
                  <Button onClick={onBack}>Back to month grid</Button>
                </>
              ) : allQueued ? (
                <>
                  <Loader2 className="size-8 animate-spin text-primary" />
                  <h3 className="text-xl font-semibold">Actions are queued</h3>
                  <p className="max-w-md text-sm text-muted-foreground">The remaining stacks are waiting for their Immich actions to finish. You can return to the month grid while the queue runs.</p>
                  <Button variant="outline" onClick={onBack}>Back to month grid</Button>
                </>
              ) : error ? null : monthRemaining > 0 ? (
                <>
                  <h3 className="text-xl font-semibold">Review paused</h3>
                  <p className="max-w-md text-sm text-muted-foreground">{monthRemaining} stack(s) are still untouched or need a retry. Your staged decisions are saved on this device.</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={() => { setAtEnd(false); const next = stacks.find(isActionable); if (next) setDraft((previous) => ({ ...previous, currentStackKey: next.key })); }}>Review remaining</Button>
                    <Button variant="outline" onClick={onBack}>Back to month grid</Button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-xl font-semibold">No assets to review</h3>
                  <p className="text-sm text-muted-foreground">{includeArchived ? 'This month has no loaded assets.' : 'This month has no loaded assets. Archived assets are hidden unless “Include archived assets” is enabled.'}</p>
                  <Button variant="outline" onClick={onBack}>Back to month grid</Button>
                </>
              )}
            </div>
          )}
        </main>

        <Dialog open={dayOpen} onOpenChange={setDayOpen}>
          <DialogContent className="flex max-h-[min(82dvh,720px)] flex-col gap-3 overflow-hidden p-4 sm:max-w-xl sm:p-6">
            <DialogHeader>
              <DialogTitle>{activeStack ? formatReviewDay(activeStack.day) : 'Day overview'}</DialogTitle>
              <DialogDescription>
                {dayRemaining} stack(s) left to review{dayQueued ? ` · ${dayQueued} queued` : ''}. Select a stack to jump to it.
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
              {dayStacks.map((stack) => {
                const state = stackState(stack);
                const label = state === 'done' ? 'Reviewed' : state === 'queued' ? 'Queued' : state === 'failed' ? 'Needs retry' : state === 'unknown' ? 'Check status' : 'Remaining';
                return (
                  <button
                    key={stack.key}
                    type="button"
                    disabled={state === 'done' || state === 'queued'}
                    onClick={() => setCurrentStack(stack.key)}
                    className={cn(
                      'flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60',
                      stack.key === activeStack?.key && 'border-primary bg-accent/70',
                      state === 'failed' && 'border-destructive/40',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-xs font-medium">
                        {stack.items.length > 1 ? stack.items.length : <img src={thumbnailUrl(stack.items[0]!.id)} alt="" className="size-full object-cover" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {stack.layout === 'grid'
                            ? `Grid · ${stack.items.length} photos`
                            : `${stack.minute.slice(11, 16)} · ${stack.items.length} ${stack.items.length === 1 && stack.items[0]?.isVideo ? 'video' : stack.items.length === 1 ? 'photo' : 'photos'}`}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{stack.items[0]?.originalFileName ?? 'Media stack'}</span>
                      </span>
                    </span>
                    <Badge variant={state === 'failed' || state === 'unknown' ? 'destructive' : state === 'done' ? 'secondary' : 'outline'}>{label}</Badge>
                  </button>
                );
              })}
              {truncated ? <p className="px-1 py-2 text-xs text-muted-foreground">The day counts reflect only assets loaded before the month limit.</p> : null}
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Focused review shortcuts</DialogTitle>
              <DialogDescription>Shortcuts work when the review itself has focus, not while a tag or dialog control is active.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <Shortcut keys="J / K">Move between photos in this stack</Shortcut>
              <Shortcut keys="1…9">Keep the focused photo and toggle that tag</Shortcut>
              <Shortcut keys="Space">Mark the focused photo to keep</Shortcut>
              <Shortcut keys="D / Del / ⌫">Mark the focused photo for Immich trash</Shortcut>
              <Shortcut keys="Tab">Move focus between photos and controls</Shortcut>
              <Shortcut keys="Z">Undo the last mark</Shortcut>
              <Shortcut keys="Enter">Apply this stack and continue</Shortcut>
              <Shortcut keys="S">Skip this stack for now</Shortcut>
              <Shortcut keys="Alt+S">Jump to the next burst stack, skipping singles</Shortcut>
              <Shortcut keys="O">Open this day’s stack overview</Shortcut>
              <Shortcut keys="?">Show this keyboard help</Shortcut>
              <Shortcut keys="Esc">Return to the month grid</Shortcut>
            </div>
          </DialogContent>
        </Dialog>
    </div>
      </DialogContent>
    </Dialog>
  );
}

function Shortcut({ keys, children }: { keys: string; children: string }) {
  return <div className="flex items-center justify-between gap-4 border-b py-2 last:border-0"><kbd className="rounded bg-muted px-2 py-1 text-xs font-medium">{keys}</kbd><span className="text-right text-muted-foreground">{children}</span></div>;
}

interface GridTileProps {
  asset: LibraryAsset;
  state: AssetReviewState;
  choice: ReviewChoice | undefined;
  focused: boolean;
  onChoose: (assetId: string, disposition: ReviewChoice['disposition']) => void;
  onFocus: () => void;
}

/** A compact cell for a page of single photos; the selected cell's details sit under the grid. */
function GridTile({ asset, state, choice, focused, onChoose, onFocus }: GridTileProps) {
  const locked = state === 'done' || state === 'queued' || state === 'unknown';
  return (
    <article
      data-review-asset-id={asset.id}
      tabIndex={-1}
      onFocusCapture={onFocus}
      className={cn(
        'relative aspect-square min-w-0 overflow-hidden rounded-xl border bg-black outline-none',
        choice?.disposition === 'keep' && 'border-success ring-2 ring-success/40',
        choice?.disposition === 'trash' && 'border-destructive ring-2 ring-destructive/40',
        state === 'done' && 'border-success/60',
        focused && 'z-10 ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}
    >
      <img
        src={thumbnailUrl(asset.id, 'preview')}
        alt={asset.originalFileName}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-cover"
      />
      <span className="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
        {asset.localDateTime.slice(11, 16)}
      </span>
      {choice ? (
        <span
          className={cn(
            'pointer-events-none absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full text-white shadow-sm',
            choice.disposition === 'keep' ? 'bg-success' : 'bg-destructive',
          )}
          title={choice.disposition === 'keep' ? 'Keep' : 'Move to Immich trash'}
        >
          {choice.disposition === 'keep' ? <Check className="size-3.5" /> : <Trash2 className="size-3.5" />}
        </span>
      ) : null}
      {!locked ? (
        <>
          <button
            type="button"
            aria-label={`Keep ${asset.originalFileName}`}
            aria-pressed={choice?.disposition === 'keep'}
            className="absolute inset-y-0 left-0 flex w-1/2 items-end justify-start p-1.5 outline-none transition-colors hover:bg-success/20 focus-visible:bg-success/25"
            onClick={(event) => {
              const tile = event.currentTarget.closest('article');
              onChoose(asset.id, 'keep');
              requestAnimationFrame(() => tile?.focus());
            }}
          >
            <span className="grid size-7 place-items-center rounded-full bg-black/65 text-white shadow-sm"><Check className="size-3.5" /></span>
          </button>
          <button
            type="button"
            aria-label={`Mark ${asset.originalFileName} for Immich trash`}
            aria-pressed={choice?.disposition === 'trash'}
            className="absolute inset-y-0 right-0 flex w-1/2 items-end justify-end p-1.5 outline-none transition-colors hover:bg-destructive/25 focus-visible:bg-destructive/30"
            onClick={(event) => {
              const tile = event.currentTarget.closest('article');
              onChoose(asset.id, 'trash');
              requestAnimationFrame(() => tile?.focus());
            }}
          >
            <span className="grid size-7 place-items-center rounded-full bg-black/65 text-white shadow-sm"><Trash2 className="size-3.5" /></span>
          </button>
        </>
      ) : null}
      {state === 'done' ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-success/30 p-1 text-center text-[11px] font-semibold text-white">
          <span className="rounded bg-success/85 px-1.5 py-1">Reviewed</span>
        </div>
      ) : null}
      {state === 'queued' ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/50 p-1 text-center text-[11px] font-semibold text-white">
          <span className="inline-flex items-center gap-1 rounded bg-black/60 px-1.5 py-1"><Loader2 className="size-3 animate-spin" /> Queued</span>
        </div>
      ) : null}
      {state === 'unknown' ? (
        <button
          type="button"
          onClick={onFocus}
          className="absolute inset-0 grid place-items-center bg-black/60 p-1 text-center text-[11px] font-semibold text-white"
        >
          <span className="rounded bg-destructive/85 px-1.5 py-1">Check status</span>
        </button>
      ) : null}
      {state === 'failed' ? (
        <span className="pointer-events-none absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded bg-destructive/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">Retry</span>
      ) : null}
    </article>
  );
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

export function FocusedReview(props: Props) {
  return (
    <HotkeysProvider
      scope="focused-month-review"
      exclusive
      defaultOptions={{ hotkey: { ignoreInputs: true, preventDefault: true, stopPropagation: true } }}
    >
      <FocusedReviewBody {...props} />
    </HotkeysProvider>
  );
}
