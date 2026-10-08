import type { Batch, BatchStatus } from '../types';
import { CandidateTable } from './CandidateTable';
import { CompareList } from './CompareList';

const STATUS_LABEL: Record<BatchStatus, string> = {
  preparing: 'Preparing candidates',
  'awaiting-choice': 'Choose replacements',
  review: 'Review batch results',
  applying: 'Applying selected replacements',
  complete: 'Complete',
  failed: 'Stopped',
  expired: 'Expired',
};

interface Props {
  batch: Batch | null;
  message: string;
  applySelection: ReadonlySet<string>;
  onDecide: (assetId: string, profileId: string | null) => void;
  onToggleApplyItem: (assetId: string, checked: boolean) => void;
  onApply: () => void;
}

export function BatchPanel({ batch, message, applySelection, onDecide, onToggleApplyItem, onApply }: Props) {
  if (!batch) return null;

  const progress =
    batch.mode === 'compare'
      ? `${batch.resolved} of ${batch.total} images decided`
      : `${Math.min(batch.currentIndex + (batch.currentIndex < batch.total ? 1 : 0), batch.total)} of ${batch.total} images`;

  let content;
  if (batch.status === 'preparing' || batch.status === 'applying') {
    content = (
      <>
        <p className="hint">
          {batch.status === 'preparing'
            ? 'Downloading and optimizing every selected image. Decisions unlock as soon as the run finishes.'
            : 'Uploading replacements and verifying their Immich metadata…'}
        </p>
        <CandidateTable batch={batch} />
      </>
    );
  } else if (batch.mode === 'compare' && batch.status === 'awaiting-choice') {
    content = <CompareList batch={batch} onDecide={onDecide} />;
  } else if (batch.mode === 'batch' && batch.status === 'review') {
    content = (
      <>
        <p className="hint">Candidates are ready. Uncheck any image you want to leave unchanged, then explicitly apply the selected replacements.</p>
        <CandidateTable batch={batch} applySelection={applySelection} onToggleApplyItem={onToggleApplyItem} />
        <button className="button primary" type="button" onClick={onApply}>
          Apply selected replacements
        </button>
      </>
    );
  } else {
    content = <CandidateTable batch={batch} />;
  }

  return (
    <section id="batch-panel" className="panel batch-panel" aria-labelledby="batch-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">03 / APPLY</p>
          <h2 id="batch-heading">Optimization run</h2>
        </div>
        <span className="status-pill">{STATUS_LABEL[batch.status]}</span>
      </div>
      <p className="hint">
        {progress} · originals {batch.deleteOriginal ? 'will be deleted only after verification' : 'will be kept'}
      </p>
      <div>{content}</div>
      <p className={message ? 'message error' : 'message'} role="status">
        {batch.error ?? message}
      </p>
    </section>
  );
}
