import { useCallback, useMemo } from 'react';
import { useHotkeys } from '@tanstack/react-hotkeys';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeft, Loader2, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useGridBox } from '@/hooks/useGridBox';
import { buildTimeline, type Mark } from '@/lib/bursts';
import { formatBytes } from '@/lib/format';
import { hasOpenDialog, isTypingTarget } from '@/lib/hotkeys';
import { columnsForWidth, GRID_GAP, gridRows } from '@/lib/monthGrid';
import { monthLabel } from '@/lib/months';
import type { ActionKind, ExtraButton, LibraryAsset, ProfileOption } from '@/types';
import { AssetActions } from './AssetActions';
import { BurstGroupCard } from './BurstGroupCard';
import { PhotoTile } from './PhotoTile';

interface Props {
  year: number;
  month: number;
  assets: LibraryAsset[];
  includeArchived: boolean;
  truncated: boolean;
  loading: boolean;
  error: string;
  marks: ReadonlyMap<string, Mark>;
  profiles: ProfileOption[];
  profileId: string;
  busy: boolean;
  promptsHidden: boolean;
  pendingAssetIds: ReadonlySet<string>;
  extraButtons: readonly ExtraButton[];
  onBack: () => void;
  onStartFocused: () => void;
  onMark: (assetId: string, mark: Mark) => void;
  onProfileChange: (profileId: string) => void;
  onAction: (kind: ActionKind, assetIds: string[], tag?: string) => void;
  onResetPrompts: () => void;
}

/** Rows rendered beyond the viewport, so a fast scroll does not run into empty space. */
const OVERSCAN_ROWS = 4;
/** Thumbnail, name line and action row of one tile, before its own height is measured. */
const TILE_CHROME = 150;
/** Header and action bar of a burst card, which wraps the same tiles. */
const BURST_CHROME = 140;
/** Padding inside a burst card: the tiles in it have a little less room than the outer grid. */
const BURST_INSET = 24;

export function MonthView({
  year,
  month,
  assets,
  includeArchived,
  truncated,
  loading,
  error,
  marks,
  profiles,
  profileId,
  busy,
  promptsHidden,
  pendingAssetIds,
  extraButtons,
  onBack,
  onStartFocused,
  onMark,
  onProfileChange,
  onAction,
  onResetPrompts,
}: Props) {
  // Server order is oldest first, so the month reads 1st → end with bursts where they happened.
  const blocks = useMemo(() => buildTimeline(assets), [assets]);
  const totalSize = assets.reduce((sum, asset) => sum + (asset.size ?? 0), 0);
  const optimizedCount = assets.filter((asset) => asset.optimized).length;

  const { ref: gridRef, width, scrollMargin } = useGridBox();
  const columns = columnsForWidth(width);
  const rows = useMemo(() => gridRows(blocks, columns), [blocks, columns]);

  // A month can hold thousands of assets, so only the rows around the viewport are in the document.
  // These heights are estimates that the rendered rows immediately replace with their measured ones;
  // they only have to be close enough that the scrollbar does not jump while the first rows settle.
  const estimateRowHeight = useCallback(
    (index: number): number => {
      // Before the container is measured, a plausible tile width keeps the first estimate in range.
      const gridWidth = width > 0 ? width : 180 * columns;
      const columnWidth = (gridWidth - GRID_GAP * (columns - 1)) / columns;
      const row = rows[index];
      if (!row || row.kind === 'singles') return columnWidth * 0.75 + TILE_CHROME;
      const innerColumn = (gridWidth - BURST_INSET - GRID_GAP * (columns - 1)) / columns;
      return Math.ceil(row.group.items.length / columns) * (innerColumn * 0.75 + TILE_CHROME) + BURST_CHROME;
    },
    [rows, columns, width],
  );

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: estimateRowHeight,
    overscan: OVERSCAN_ROWS,
    scrollMargin,
    getItemKey: useCallback((index: number) => rows[index]?.key ?? index, [rows]),
  });

  useHotkeys(
    [
      { hotkey: 'F', callback: (event) => { if (!isTypingTarget(event) && !hasOpenDialog()) onStartFocused(); }, options: { ignoreInputs: false } },
    ],
    { target: document, enabled: !loading, ignoreInputs: true, preventDefault: true, stopPropagation: true },
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
          <div className="flex items-start gap-3">
            <Button variant="outline" size="icon" aria-label="Back to the year" onClick={onBack}>
              <ArrowLeft />
            </Button>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                {monthLabel(month)} {year}
              </h2>
              <p className="text-sm text-muted-foreground">
                {loading ? 'Loading the month…' : `${assets.length} asset(s) · ${formatBytes(totalSize)}`}
                {optimizedCount > 0 ? ` · ${optimizedCount} already optimized` : ''}
                {truncated ? ' · capped, some assets are not shown' : ''}
                {busy ? ' · queueing…' : ''}
              </p>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
            <Button variant="default" size="sm" className="h-10 sm:h-9" title="Focused review (F)" onClick={onStartFocused}>
              <Maximize2 />
              Focused review
            </Button>
            {promptsHidden ? (
              <Button variant="ghost" size="sm" onClick={onResetPrompts}>
                Re-enable prompts
              </Button>
            ) : null}
            <span className="hidden text-sm text-muted-foreground sm:inline">Compression profile</span>
            <Select value={profileId} onValueChange={onProfileChange}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Compression profile">
                <SelectValue placeholder="Choose a profile" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.label} · {profile.sources.includes('jpeg') ? 'JPEG source' : 'HEIC / HEIF source'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Ordered from the 1st. Bursts share a capture minute and keep their own action bar; single images carry their own buttons. Click an
          image to open it in Immich. Actions are queued and run one after another, so you can keep working. Only the rows you are looking at
          are rendered, so a month of thousands of assets stays responsive.
        </p>
        <p className="text-xs text-muted-foreground">Press <kbd className="rounded bg-muted px-1">F</kbd> for Focused review.</p>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div ref={gridRef}>
          {loading ? (
            <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${GRID_GAP}px` }}>
              {Array.from({ length: columns * 2 }, (_unused, index) => (
                <Skeleton key={index} className="aspect-4/3 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="relative" style={{ height: `${virtualizer.getTotalSize()}px` }}>
              {virtualizer.getVirtualItems().map((item) => {
                const row = rows[item.index];
                if (!row) return null;
                return (
                  <div
                    key={item.key}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    className="absolute top-0 left-0 w-full"
                    style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
                  >
                    {row.kind === 'group' ? (
                      <div className="pb-3">
                        <BurstGroupCard
                          group={row.group}
                          columns={columns}
                          marks={marks}
                          pending={pendingAssetIds}
                          profileId={profileId}
                          busy={busy}
                          extraButtons={extraButtons}
                          onMark={onMark}
                          onAction={onAction}
                        />
                      </div>
                    ) : (
                      <div className="grid pb-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${GRID_GAP}px` }}>
                        {row.assets.map((asset) => (
                          <PhotoTile
                            key={asset.id}
                            asset={asset}
                            footer={
                              <AssetActions
                                disabled={busy || pendingAssetIds.has(asset.id)}
                                compressible={!asset.isVideo && asset.profiles.some((profile) => profile.id === profileId)}
                                archived={asset.visibility === 'archive'}
                                extraButtons={extraButtons}
                                onCompress={() => onAction('compress', [asset.id])}
                                onTrash={() => onAction('trash', [asset.id])}
                                onArchive={() => onAction('archive', [asset.id])}
                                onExtraAction={(button) => onAction('tagArchive', [asset.id], button.label)}
                              />
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {!loading && assets.length === 0 && !error ? (
          <p className="text-sm text-muted-foreground">
            {includeArchived
              ? 'No images or videos were captured in this month.'
              : 'No images or videos were captured in this month. Archived assets are hidden — tick “Include archived assets” to review them.'}
          </p>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
