import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipProvider } from '@/components/ui/tooltip';
import { splitBursts, type Mark } from '@/lib/bursts';
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
  onBack: () => void;
  onMark: (assetId: string, mark: Mark) => void;
  onProfileChange: (profileId: string) => void;
  onAction: (kind: ActionKind, assetIds: string[]) => void;
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
  onBack,
  onMark,
  onProfileChange,
  onAction,
}: Props) {
  const { groups, rest } = splitBursts(assets);
  const totalSize = assets.reduce((sum, asset) => sum + (asset.size ?? 0), 0);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-5">
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
                {truncated ? ' · capped, some assets are not shown' : ''}
                {busy ? ' · working…' : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {busy ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
            <span className="text-sm text-muted-foreground">Compression profile</span>
            <Select value={profileId} onValueChange={onProfileChange}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Choose a profile" />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Array.from({ length: 10 }, (_unused, index) => (
              <Skeleton key={index} className="aspect-4/3 rounded-xl" />
            ))}
          </div>
        ) : null}

        {!loading && groups.length > 0 ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Match groups</h3>
            {groups.map((group) => (
              <BurstGroupCard key={group.key} group={group} marks={marks} busy={busy} onMark={onMark} onAction={onAction} />
            ))}
          </section>
        ) : null}

        {!loading && rest.length > 0 ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              Remaining images ({rest.length})
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {rest.map((asset) => (
                <PhotoTile
                  key={asset.id}
                  asset={asset}
                  footer={
                    <AssetActions
                      disabled={busy}
                      compressible={asset.profiles.length > 0 && !asset.isVideo}
                      onCompress={() => onAction('compress', [asset.id])}
                      onTrash={() => onAction('trash', [asset.id])}
                      onArchive={() => onAction('archive', [asset.id])}
                    />
                  }
                />
              ))}
            </div>
          </section>
        ) : null}

        {!loading && assets.length === 0 && !error ? (
          <p className="text-sm text-muted-foreground">No images or videos were captured in this month.</p>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
