import { formatBytes } from '../format';
import { thumbnailUrl } from '../api';
import type { Batch, BatchItem, BatchItemStatus } from '../types';

const STATUS_TEXT: Record<BatchItemStatus, string> = {
  queued: 'Waiting to be processed…',
  processing: 'Downloading and optimizing…',
  'awaiting-choice': 'Waiting for your decision…',
  applying: 'Uploading replacement and verifying metadata…',
  ready: 'Ready',
  replaced: 'Replaced',
  skipped: 'Skipped',
  failed: 'Failed',
};

interface Props {
  batch: Batch;
  onDecide: (assetId: string, profileId: string | null) => void;
}

function CompareItem({ item, index, total, onDecide }: { item: BatchItem; index: number; total: number; onDecide: Props['onDecide'] }) {
  if (item.status !== 'awaiting-choice') {
    const outcome = item.message ?? STATUS_TEXT[item.status];
    return (
      <div className="compare-item">
        <div className="compare-item-head">
          <span className="asset-name">{item.originalFileName}</span>
          <span className="hint">
            Image {index + 1} of {total} · original {formatBytes(item.sourceSize)}
          </span>
        </div>
        <p className={item.status === 'failed' ? 'failed-text' : 'hint'}>
          {item.replacementId ? `${outcome} · replacement ${item.replacementId}` : outcome}
        </p>
      </div>
    );
  }

  const eligibleSizes = item.candidates.filter((candidate) => candidate.eligible && candidate.size !== null).map((candidate) => candidate.size);
  const bestSize = eligibleSizes.length > 1 ? Math.min(...(eligibleSizes as number[])) : null;

  return (
    <div className="compare-item">
      <div className="compare-item-head">
        <span className="asset-name">{item.originalFileName}</span>
        <span className="hint">
          Image {index + 1} of {total} · original {formatBytes(item.sourceSize)}
        </span>
      </div>
      <div className="current-comparison">
        <img alt={item.originalFileName} loading="lazy" src={thumbnailUrl(item.assetId)} />
        <div className="candidate-list">
          {item.candidates.map((candidate) => {
            const isBest = candidate.size !== null && candidate.size === bestSize;
            const sizeText =
              candidate.size === null
                ? candidate.error
                : `${formatBytes(candidate.size)} · ${
                    candidate.eligible ? `${formatBytes((item.sourceSize ?? 0) - candidate.size)} smaller` : 'not smaller than original'
                  }`;
            return (
              <div key={candidate.profileId} className={isBest ? 'candidate-row best' : 'candidate-row'}>
                <div>
                  <strong>
                    {candidate.label}
                    {isBest && <span className="best-badge">Smallest</span>}
                  </strong>
                  <small>{sizeText}</small>
                </div>
                <button
                  className={isBest ? 'button primary' : 'button secondary'}
                  type="button"
                  disabled={!candidate.eligible}
                  onClick={() => onDecide(item.assetId, candidate.profileId)}
                >
                  {candidate.eligible ? (isBest ? 'Replace with smallest' : 'Replace with this') : 'Not eligible'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div className="decision-actions">
        <button className="button secondary" type="button" onClick={() => onDecide(item.assetId, null)}>
          Keep original
        </button>
      </div>
    </div>
  );
}

export function CompareList({ batch, onDecide }: Props) {
  const awaiting = batch.awaiting;
  return (
    <div>
      <p className="hint">
        {awaiting > 0
          ? `Every selected image is already optimized. ${awaiting} still need a decision.`
          : 'All images have been decided.'}
      </p>
      {batch.items.map((item, index) => (
        <CompareItem key={item.assetId} item={item} index={index} total={batch.total} onDecide={onDecide} />
      ))}
    </div>
  );
}
