import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { thumbnailUrl } from '@/api';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Mark } from '@/lib/bursts';
import type { LibraryAsset } from '@/types';

interface Props {
  asset: LibraryAsset;
  mark?: Mark;
  suggested?: boolean;
  onKeep?: () => void;
  onTrash?: () => void;
  footer?: ReactNode;
}

export function PhotoTile({ asset, mark, suggested, onKeep, onTrash, footer }: Props) {
  const interactive = Boolean(onKeep || onTrash);
  return (
    <div
      className={cn(
        'asset-tile group relative flex flex-col gap-2 rounded-xl border bg-card p-2 transition-colors',
        mark === 'keep' && 'border-success ring-2 ring-success/40',
        mark === 'trash' && 'border-destructive ring-2 ring-destructive/40',
        mark === undefined && 'border-border',
      )}
    >
      <button
        type="button"
        disabled={!interactive}
        onClick={onKeep}
        onContextMenu={(event) => {
          if (!onTrash) return;
          event.preventDefault();
          onTrash();
        }}
        title={interactive ? 'Left click to keep · right click to trash' : asset.originalFileName}
        className="relative block w-full overflow-hidden rounded-lg bg-muted"
      >
        <img src={thumbnailUrl(asset.id)} alt={asset.originalFileName} loading="lazy" decoding="async" className="aspect-4/3 w-full object-cover" />
        {mark === 'trash' ? <span className="absolute inset-0 bg-destructive/35" /> : null}
        {mark === 'keep' ? <span className="absolute inset-0 bg-success/20" /> : null}
        {suggested && mark === undefined ? (
          <Badge className="absolute top-2 left-2" variant="secondary">
            suggested
          </Badge>
        ) : null}
        {asset.isVideo ? (
          <Badge className="absolute top-2 right-2" variant="secondary">
            video
          </Badge>
        ) : null}
        {asset.optimized ? (
          <Badge className="absolute bottom-2 left-2 bg-success text-success-foreground">optimized</Badge>
        ) : null}
      </button>

      <div className="min-w-0 px-1">
        <p className="truncate text-xs font-medium" title={asset.originalFileName}>
          {asset.originalFileName}
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {asset.localDateTime.slice(11, 16)} · {formatBytes(asset.size)}
        </p>
      </div>

      {footer ? <div className="flex justify-center gap-1">{footer}</div> : null}
    </div>
  );
}
