import { Checkbox } from '@/components/ui/checkbox';
import { thumbnailUrl } from '@/api';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { BatchItem } from '@/types';

interface Props {
  batch: { items: BatchItem[] };
  applySelection?: ReadonlySet<string>;
  onToggleApplyItem?: (assetId: string, checked: boolean) => void;
}

function CandidateRow({
  item,
  selected,
  onToggleApplyItem,
}: {
  item: BatchItem;
  selected: boolean;
  onToggleApplyItem?: (assetId: string, checked: boolean) => void;
}) {
  const candidate = item.candidates[0];
  const eligible = candidate?.eligible === true && Number.isFinite(item.sourceSize);
  const saved = eligible && candidate?.size !== null && candidate?.size !== undefined ? (item.sourceSize ?? 0) - candidate.size : null;
  const resultText = item.message ?? (item.status === 'ready' ? 'Ready' : item.status);
  const failed = item.status === 'failed' || item.message?.includes('Not smaller') === true;

  return (
    <tr className="border-b border-border last:border-0">
      <td className="p-2">
        <Checkbox
          checked={selected}
          disabled={item.status !== 'ready' || candidate?.eligible !== true}
          onCheckedChange={(checked) => onToggleApplyItem?.(item.assetId, checked === true)}
          aria-label={`Apply ${item.originalFileName}`}
        />
      </td>
      <td className="p-2">
        <div className="flex items-center gap-2">
          <img src={thumbnailUrl(item.assetId)} alt="" loading="lazy" decoding="async" className="h-10 w-14 rounded object-cover" />
          <span className="max-w-[220px] truncate text-xs font-medium" title={item.originalFileName}>
            {item.originalFileName}
          </span>
        </div>
      </td>
      <td className="p-2 text-xs tabular-nums whitespace-nowrap">{formatBytes(item.sourceSize)}</td>
      <td className="p-2 text-xs tabular-nums whitespace-nowrap">{formatBytes(candidate?.size)}</td>
      <td className={cn('p-2 text-xs tabular-nums whitespace-nowrap', saved === null ? 'text-destructive' : 'font-medium text-success')}>
        {saved === null || item.sourceSize === null || item.sourceSize === 0
          ? '—'
          : `${formatBytes(saved)} (${Math.round((saved / item.sourceSize) * 100)}%)`}
      </td>
      <td className={cn('p-2 text-xs', failed && 'text-destructive')}>
        {item.replacementId ? `${resultText} · replacement ${item.replacementId}` : resultText}
      </td>
    </tr>
  );
}

export function CandidateTable({ batch, applySelection, onToggleApplyItem }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            <th className="p-2">Apply</th>
            <th className="p-2">Image</th>
            <th className="p-2">Original</th>
            <th className="p-2">Candidate</th>
            <th className="p-2">Savings</th>
            <th className="p-2">Result</th>
          </tr>
        </thead>
        <tbody>
          {batch.items.map((item) => (
            <CandidateRow
              key={item.assetId}
              item={item}
              selected={applySelection?.has(item.assetId) ?? false}
              onToggleApplyItem={onToggleApplyItem}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
