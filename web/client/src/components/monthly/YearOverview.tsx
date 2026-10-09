import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, Images } from 'lucide-react';
import { MONTH_NAMES } from '@/lib/months';
import type { MonthCounts } from '@/types';

interface Props {
  year: number;
  counts: MonthCounts | null;
  loading: boolean;
  error: string;
  onYearChange: (year: number) => void;
  onOpenMonth: (month: number) => void;
}

export function YearOverview({ year, counts, loading, error, onYearChange, onOpenMonth }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{year}</h2>
          <p className="text-sm text-muted-foreground">
            {counts ? `${counts.total} captures · pick a month to review it` : 'Loading captures…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous year" onClick={() => onYearChange(year - 1)}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon" aria-label="Next year" onClick={() => onYearChange(year + 1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {MONTH_NAMES.map((name) => (
            <Skeleton key={name} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {MONTH_NAMES.map((name, index) => {
            const month = index + 1;
            const count = counts?.months.find((entry) => entry.month === month)?.count ?? 0;
            return (
              <button
                key={name}
                type="button"
                disabled={count === 0}
                onClick={() => onOpenMonth(month)}
                className="flex h-28 flex-col justify-between rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/60 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span className="text-sm font-semibold">{name}</span>
                <span className="flex items-center gap-2 text-2xl font-semibold tabular-nums">
                  <Images className="size-4 text-muted-foreground" />
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
