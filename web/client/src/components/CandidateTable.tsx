import { formatBytes } from '../format';
import { thumbnailUrl } from '../api';
import type { BatchItem } from '../types';

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
    <tr>
      <td>
        <input
          type="checkbox"
          checked={selected}
          disabled={item.status !== 'ready' || candidate?.eligible !== true}
          onChange={(event) => onToggleApplyItem?.(item.assetId, event.target.checked)}
        />
      </td>
      <td className="batch-item-name">
        <img className="batch-thumb" alt="" loading="lazy" src={thumbnailUrl(item.assetId)} />
        <span>{item.originalFileName}</span>
      </td>
      <td className="size-value">{formatBytes(item.sourceSize)}</td>
      <td className="size-value">{formatBytes(candidate?.size)}</td>
      <td className={saved === null ? 'not-smaller' : 'saving size-value'}>
        {saved === null || item.sourceSize === null || item.sourceSize === 0
          ? '—'
          : `${formatBytes(saved)} (${Math.round((saved / item.sourceSize) * 100)}%)`}
      </td>
      <td className={failed ? 'failed-text' : undefined}>
        {item.replacementId ? `${resultText} · replacement ${item.replacementId}` : resultText}
      </td>
    </tr>
  );
}

export function CandidateTable({ batch, applySelection, onToggleApplyItem }: Props) {
  return (
    <div className="batch-table-wrap">
      <table className="batch-table">
        <thead>
          <tr>
            <th>Apply</th>
            <th>Image</th>
            <th>Original</th>
            <th>Candidate</th>
            <th>Savings</th>
            <th>Result</th>
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
