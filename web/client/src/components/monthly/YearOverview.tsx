import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, Images } from 'lucide-react';
import { formatBytes } from '@/lib/format';
import { MONTH_NAMES } from '@/lib/months';
import { cn } from '@/lib/utils';
import type { MonthCounts, MonthStorage } from '@/types';

interface Props {
  year: number;
  counts: MonthCounts | null;
  /** Size per month, sampled by the server; a month without an entry has no estimate yet. */
  storage: MonthStorage[];
  loading: boolean;
  storageLoading: boolean;
  error: string;
  storageError: string;
  onYearChange: (year: number) => void;
  onOpenMonth: (month: number) => void;
}

/**
 * Heat for a month against the heaviest month of the year: the tint only has to show which months
 * carry the library, so four steps are enough and the numbers stay readable on every one of them.
 */
const STORAGE_HEAT = [
  { box: 'border-border bg-card', size: 'text-muted-foreground' },
  { box: 'border-success/40 bg-success/10', size: 'text-success' },
  { box: 'border-primary/40 bg-primary/10', size: 'text-primary' },
  { box: 'border-destructive/40 bg-destructive/10', size: 'text-destructive' },
  { box: 'border-destructive/60 bg-destructive/20', size: 'text-destructive' },
];

function storageHeat(bytes: number, heaviest: number): (typeof STORAGE_HEAT)[number] {
  if (bytes <= 0 || heaviest <= 0) return STORAGE_HEAT[0]!;
  const share = bytes / heaviest;
  if (share <= 0.25) return STORAGE_HEAT[1]!;
  if (share <= 0.5) return STORAGE_HEAT[2]!;
  if (share <= 0.75) return STORAGE_HEAT[3]!;
  return STORAGE_HEAT[4]!;
}

export function YearOverview({ year, counts, storage, loading, storageLoading, error, storageError, onYearChange, onOpenMonth }: Props) {
  const heaviest = storage.reduce((largest, entry) => Math.max(largest, entry.bytes), 0);
  const yearBytes = storage.reduce((sum, entry) => sum + entry.bytes, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{year}</h2>
          <p className="text-sm text-muted-foreground">
            {counts ? `${counts.total} captures` : 'Loading captures…'}
            {yearBytes > 0 ? ` · about ${formatBytes(yearBytes)}` : ''}
            {counts ? ' · pick a month to review it' : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous year" onClick={() => onYearChange(year - 1)}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon" aria-label="Next year" onClick={() => onYearChange(year + 1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {storageError ? <p className="text-sm text-destructive">{storageError}</p> : null}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {MONTH_NAMES.map((name) => (
            <Skeleton key={name} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {MONTH_NAMES.map((name, index) => {
              const month = index + 1;
              const count = counts?.months.find((entry) => entry.month === month)?.count ?? 0;
              const entry = storage.find((candidate) => candidate.month === month);
              const heat = storageHeat(entry?.bytes ?? 0, heaviest);
              const size = entry && entry.bytes > 0 ? `${entry.estimated ? '~' : ''}${formatBytes(entry.bytes)}` : '';
              const sizeTitle =
                !entry || entry.bytes <= 0
                  ? `${count} capture(s)`
                  : entry.estimated
                    ? `${count} capture(s) · about ${formatBytes(entry.bytes)}, scaled from ${entry.sampled} of them`
                    : `${count} capture(s) · ${formatBytes(entry.bytes)}`;
              return (
                <button
                  key={name}
                  type="button"
                  disabled={count === 0}
                  onClick={() => onOpenMonth(month)}
                  title={sizeTitle}
                  className={cn(
                    'flex h-24 flex-col justify-between rounded-xl border p-3 text-left transition-colors hover:border-primary/60 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-45 sm:h-28',
                    heat.box,
                  )}
                >
                  <span className="flex w-full items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">{name}</span>
                    <span className={cn('text-xs font-medium tabular-nums', size ? heat.size : 'text-muted-foreground')}>{size}</span>
                  </span>
                  <span className="flex items-center gap-2 text-2xl font-semibold tabular-nums">
                    <Images className="size-4 text-muted-foreground" />
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Sizes are estimates: Immich stores no per-month total, so the server reads a sample of each month's files and scales it by the
            month's capture count. A month that fits in one page is measured exactly, a scaled number is prefixed with <span className="font-medium">~</span>, and the colors run from the lightest to the heaviest month of {year}
            {storageLoading && storage.length === 0 ? ' — reading sizes…' : ''}.
          </p>
        </>
      )}
    </div>
  );
}
