import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Batch, BatchStatus } from '@/types';
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
        <p className="text-xs text-muted-foreground">
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
        <p className="text-xs text-muted-foreground">
          Candidates are ready. Uncheck any image you want to leave unchanged, then explicitly apply the selected replacements.
        </p>
        <CandidateTable batch={batch} applySelection={applySelection} onToggleApplyItem={onToggleApplyItem} />
        <Button onClick={onApply}>Apply selected replacements</Button>
      </>
    );
  } else {
    content = <CandidateTable batch={batch} />;
  }

  return (
    <Card id="batch-panel" className="border-primary/30">
      <CardHeader>
        <p className="text-xs font-semibold tracking-widest text-primary uppercase">03 / Apply</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Optimization run</CardTitle>
          <span className="flex items-center gap-2">
            {batch.status === 'preparing' || batch.status === 'applying' ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : null}
            <Badge variant={batch.status === 'failed' ? 'destructive' : 'secondary'}>{STATUS_LABEL[batch.status]}</Badge>
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {progress} · originals {batch.deleteOriginal ? 'will be deleted only after verification' : 'will be kept'}
        </p>
        {content}
        {batch.error || message ? <p className="text-sm text-destructive">{batch.error ?? message}</p> : null}
      </CardContent>
    </Card>
  );
}
