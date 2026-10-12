import type { ReactNode } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { personThumbnailUrl, thumbnailUrl } from '@/api';
import { formatBytes } from '@/lib/format';
import { assetLink, personLink } from '@/lib/immichLinks';
import { cn } from '@/lib/utils';
import type { Mark } from '@/lib/bursts';
import type { LibraryAsset } from '@/types';

/** Faces beyond this are only counted; a tile is too small for a long face row. */
const FACE_LIMIT = 4;

interface Props {
  asset: LibraryAsset;
  mark?: Mark;
  suggested?: boolean;
  onKeep?: () => void;
  onTrash?: () => void;
  footer?: ReactNode;
}

// Right-click trashing is a desktop shortcut, but a long press on a phone fires the same event.
// Only wire it up for a fine pointer and let touch users use the visible Keep/Trash buttons.
const finePointer = typeof window === 'undefined' || window.matchMedia('(pointer: fine)').matches;

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
      <a
        href={assetLink(asset.id)}
        target="_blank"
        rel="noreferrer"
        title={`Open ${asset.originalFileName} in Immich`}
        className="relative block w-full overflow-hidden rounded-lg bg-muted focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        onContextMenu={(event) => {
          if (!onTrash || !finePointer) return;
          event.preventDefault();
          onTrash();
        }}
      >
        <img src={thumbnailUrl(asset.id)} alt={asset.originalFileName} loading="lazy" decoding="async" className="aspect-4/3 w-full object-contain" />
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
      </a>

      <div className="min-w-0 px-1">
        <p className="truncate text-xs font-medium" title={asset.originalFileName}>
          {asset.originalFileName}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {asset.localDateTime.slice(11, 16)} · {formatBytes(asset.size)}
        </p>
      </div>

      {asset.people.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 px-1">
          {asset.people.slice(0, FACE_LIMIT).map((person) => (
            <a
              key={person.id}
              href={personLink(person.id)}
              target="_blank"
              rel="noreferrer"
              title={`${person.name} in Immich`}
              className="shrink-0 rounded-full ring-1 ring-border transition hover:ring-2 hover:ring-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
            >
              <img src={personThumbnailUrl(person.id)} alt={person.name} loading="lazy" decoding="async" className="size-7 rounded-full object-cover" />
            </a>
          ))}
          {asset.people.length > FACE_LIMIT ? (
            <span className="text-xs text-muted-foreground" title={asset.people.slice(FACE_LIMIT).map((person) => person.name).join(', ')}>
              +{asset.people.length - FACE_LIMIT}
            </span>
          ) : null}
        </div>
      ) : null}

      {interactive ? (
        <div className="mt-auto flex gap-1">
          <Button
            type="button"
            variant={mark === 'keep' ? 'default' : 'outline'}
            size="sm"
            className="h-9 flex-1 px-2 text-xs sm:h-8 sm:px-3 sm:text-sm"
            aria-pressed={mark === 'keep'}
            aria-label="Keep this image"
            disabled={!onKeep}
            onClick={onKeep}
          >
            <Check className="hidden size-4 sm:block" />
            Keep
          </Button>
          <Button
            type="button"
            variant={mark === 'trash' ? 'destructive' : 'outline'}
            size="sm"
            className="h-9 flex-1 px-2 text-xs sm:h-8 sm:px-3 sm:text-sm"
            aria-pressed={mark === 'trash'}
            aria-label="Mark this image for the trash"
            disabled={!onTrash}
            onClick={onTrash}
          >
            <Trash2 className="hidden size-4 sm:block" />
            Trash
          </Button>
        </div>
      ) : null}

      {footer ? <div className="mt-auto flex flex-wrap justify-center gap-1">{footer}</div> : null}
    </div>
  );
}
