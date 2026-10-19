import { CheckCheck, Loader2, Tag, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Job, JobStatus } from '@/types';

function jobLabel(job: Job): string {
  switch (job.kind) {
    case 'compress':
      return 'Compress and delete original';
    case 'trash':
      return 'Move to trash';
    case 'archive':
      return 'Archive';
    case 'tagArchive':
      return job.tag ? `Tag as “${job.tag}” and archive` : 'Tag and archive';
    case 'motion':
      return 'Unlink and trash motion video';
    case 'review':
      return 'Focused monthly review';
  }
}

const STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
};

interface Props {
  jobs: Job[];
  error: string;
  onCancel: (jobId: string) => void;
}

export function JobQueuePanel({ jobs, error, onCancel }: Props) {
  if (jobs.length === 0 && !error) return null;
  const active = jobs.filter((job) => job.status === 'queued' || job.status === 'running').length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Job queue</CardTitle>
          <span className="text-xs text-muted-foreground">
            {active > 0 ? `${active} waiting or running · jobs run one after another` : 'Idle'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {jobs.slice(0, 12).map((job) => (
          <div
            key={job.id}
            className={cn(
              'flex flex-wrap items-center justify-between gap-3 rounded-lg border p-2.5',
              job.status === 'failed' ? 'border-destructive/40' : 'border-border',
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              {job.status === 'running' ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : null}
              {job.kind === 'trash' ? <Trash2 className="size-4 shrink-0 text-muted-foreground" /> : null}
              {job.kind === 'tagArchive' ? <Tag className="size-4 shrink-0 text-muted-foreground" /> : null}
              {job.kind === 'review' ? <CheckCheck className="size-4 shrink-0 text-muted-foreground" /> : null}
              <div className="min-w-0">
                <p className="text-xs font-medium">
                  {jobLabel(job)} · {job.assetIds.length} asset(s)
                </p>
                <p className="truncate text-xs text-muted-foreground" title={job.message ?? ''}>
                  {job.message ?? STATUS_LABEL[job.status]}
                  {job.status === 'done' && job.kind === 'compress' && job.replaced > 0 ? ` · ${job.replaced} replaced` : ''}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant={job.status === 'failed' ? 'destructive' : 'secondary'}>{STATUS_LABEL[job.status]}</Badge>
              {job.status === 'queued' ? (
                <Button variant="ghost" size="icon" className="size-9 sm:size-7" aria-label="Cancel this queued job" onClick={() => onCancel(job.id)}>
                  <X className="size-4" />
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
