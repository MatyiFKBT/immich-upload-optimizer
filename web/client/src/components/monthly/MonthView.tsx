import { useMemo } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import { buildTimeline, type Mark } from '@/lib/bursts';
import { formatBytes } from '@/lib/format';
import { monthLabel } from '@/lib/months';
import type { ActionKind, LibraryAsset, ProfileOption } from '@/types';
import { AssetActions } from './AssetActions';
import { BurstGroupCard } from './BurstGroupCard';
import { PhotoTile } from './PhotoTile';

interface Props {
  year: number;
  month: number;
  assets: LibraryAsset[];
  truncated: boolean;
  loading: boolean;
  error: string;
  marks: ReadonlyMap<string, Mark>;
  profiles: ProfileOption[];
  profileId: string;
  busy: boolean;
  promptsHidden: boolean;
  pendingAssetIds: ReadonlySet<string>;
  onBack: () => void;
  onMark: (assetId: string, mark: Mark) => void;
  onProfileChange: (profileId: string) => void;
  onAction: (kind: ActionKind, assetIds: string[]) => void;
  onResetPrompts: () => void;
}

export function MonthView({
  year,
  month,
  assets,
  truncated,
  loading,
  error,
  marks,
  profiles,
  profileId,
  busy,
  promptsHidden,
  pendingAssetIds,
  onBack,
  onMark,
  onProfileChange,
  onAction,
  onResetPrompts,
}: Props) {
  // Server order is oldest first, so the month reads 1st → end with bursts where they happened.
  const blocks = useMemo(() => buildTimeline(assets), [assets]);
  const totalSize = assets.reduce((sum, asset) => sum + (asset.size ?? 0), 0);
  const optimizedCount = assets.filter((asset) => asset.optimized).length;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
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
          <div className="flex items-center gap-2">
            {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
            {promptsHidden ? (
              <Button variant="ghost" size="sm" onClick={onResetPrompts}>
                Re-enable prompts
              </Button>
            ) : null}
            <span className="text-sm text-muted-foreground">Compression profile</span>
            <Select value={profileId} onValueChange={onProfileChange}>
              <SelectTrigger className="w-56">
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
          Ordered from the 1st. Bursts share a capture minute and keep their own action bar; single images carry their own buttons.
          Actions are queued and run one after another, so you can keep working.
        </p>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 10 }, (_unused, index) => (
              <Skeleton key={index} className="aspect-4/3 rounded-xl" />
            ))}
          </div>
        ) : null}

        {!loading
          ? blocks.map((block) =>
              block.kind === 'group' ? (
                <BurstGroupCard
                  key={`group:${block.key}`}
                  group={{ key: block.key, items: block.items }}
                  marks={marks}
                  pending={pendingAssetIds}
                  profileId={profileId}
                  busy={busy}
                  onMark={onMark}
                  onAction={onAction}
                />
              ) : (
                <div key={`singles:${block.assets[0]?.id ?? 'empty'}`} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  {block.assets.map((asset) => (
                    <PhotoTile
                      key={asset.id}
                      asset={asset}
                      footer={
                        <AssetActions
                          disabled={busy || pendingAssetIds.has(asset.id)}
                          compressible={!asset.isVideo && asset.profiles.some((profile) => profile.id === profileId)}
                          onCompress={() => onAction('compress', [asset.id])}
                          onTrash={() => onAction('trash', [asset.id])}
                          onArchive={() => onAction('archive', [asset.id])}
                        />
                      }
                    />
                  ))}
                </div>
              ),
            )
          : null}

        {!loading && assets.length === 0 && !error ? (
          <p className="text-sm text-muted-foreground">No images or videos were captured in this month.</p>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
