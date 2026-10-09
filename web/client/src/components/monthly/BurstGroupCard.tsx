import { Archive, Minimize2, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatGroupTime, suggestedKeeper, type BurstGroup, type Mark } from '@/lib/bursts';
import type { ActionKind } from '@/types';
import { PhotoTile } from './PhotoTile';

interface Props {
  group: BurstGroup;
  marks: ReadonlyMap<string, Mark>;
  busy: boolean;
  onMark: (assetId: string, mark: Mark) => void;
  onAction: (kind: ActionKind, assetIds: string[]) => void;
}

export function BurstGroupCard({ group, marks, busy, onMark, onAction }: Props) {
  const keeper = suggestedKeeper(group);
  const trashed = group.items.filter((item) => marks.get(item.id) === 'trash').map((item) => item.id);
  const kept = group.items.filter((item) => marks.get(item.id) === 'keep');
  const compressible = kept.filter((item) => item.profiles.length > 0).map((item) => item.id);
  const compressSkipped = kept.length - compressible.length;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{group.items.length} in this burst</Badge>
          <span className="text-xs text-muted-foreground tabular-nums">{formatGroupTime(group.key)}</span>
        </div>
        <p className="text-xs text-muted-foreground">Left click keeps · right click trashes</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {group.items.map((item) => (
          <PhotoTile
            key={item.id}
            asset={item}
            mark={marks.get(item.id)}
            suggested={item.id === keeper}
            onKeep={() => onMark(item.id, 'keep')}
            onTrash={() => onMark(item.id, 'trash')}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button
          variant="destructive"
          size="sm"
          disabled={busy || trashed.length === 0}
          onClick={() => onAction('trash', trashed)}
        >
          <Trash2 className="size-4" />
          Trash {trashed.length > 0 ? trashed.length : ''}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || compressible.length === 0}
          onClick={() => onAction('compress', compressible)}
        >
          <Minimize2 className="size-4" />
          Compress {compressible.length > 0 ? compressible.length : ''}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || kept.length === 0}
          onClick={() => onAction('archive', kept.map((item) => item.id))}
        >
          <Archive className="size-4" />
          Archive {kept.length > 0 ? kept.length : ''}
        </Button>
        {compressSkipped > 0 ? (
          <span className="text-xs text-muted-foreground">{compressSkipped} kept file(s) have no supported compression profile</span>
        ) : null}
      </div>
    </div>
  );
}
