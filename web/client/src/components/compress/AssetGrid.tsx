import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { thumbnailUrl } from '@/api';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { AssetItem } from '@/types';

interface CardProps {
  asset: AssetItem;
  selected: boolean;
  onToggle: (asset: AssetItem) => void;
}

function AssetCard({ asset, selected, onToggle }: CardProps) {
  const taken = asset.fileCreatedAt ? new Date(asset.fileCreatedAt).toLocaleDateString() : 'Date unavailable';
  return (
    <div className={cn('asset-tile overflow-hidden rounded-xl border bg-card', selected ? 'border-primary ring-2 ring-primary/30' : 'border-border')}>
      <div className="relative aspect-4/3 bg-muted">
        <img src={thumbnailUrl(asset.id)} alt={asset.originalFileName} loading="lazy" decoding="async" className="size-full object-cover" />
        <label className="absolute top-2 left-2 grid size-6 place-items-center rounded-md bg-background/90">
          <Checkbox checked={selected} onCheckedChange={() => onToggle(asset)} aria-label={`Select ${asset.originalFileName}`} />
        </label>
        {asset.profiles.length > 1 ? (
          <Badge variant="secondary" className="absolute right-2 bottom-2">
            {asset.profiles.length} profiles
          </Badge>
        ) : null}
      </div>
      <div className="space-y-1 p-2">
        <p className="truncate text-xs font-medium" title={asset.originalFileName}>
          {asset.originalFileName}
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {taken} · {formatBytes(asset.size)}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">{asset.profiles.map((profile) => profile.label).join(', ')}</p>
      </div>
    </div>
  );
}

interface Props {
  assets: AssetItem[];
  selected: ReadonlySet<string>;
  onToggle: (asset: AssetItem) => void;
}

export function AssetGrid({ assets, selected, onToggle }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {assets.map((asset) => (
        <AssetCard key={asset.id} asset={asset} selected={selected.has(asset.id)} onToggle={onToggle} />
      ))}
    </div>
  );
}
