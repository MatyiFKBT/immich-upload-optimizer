import { RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useStats } from '@/hooks/useStats';
import { formatBytes } from '@/lib/format';
import { monthLabel } from '@/lib/months';
import { cn } from '@/lib/utils';

interface TileProps {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}

function StatTile({ label, value, detail, tone }: TileProps) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        <p className={cn('text-2xl font-semibold tabular-nums', tone)}>{value}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

/** `2026-10` → `October 2026`; the server only ever writes that shape. */
function monthHeading(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  return `${monthLabel(Number(match[2]!))} ${match[1]!}`;
}

/**
 * What this service did to the library, read from the record it keeps under `WEB_DATA_DIR`. Immich
 * only knows the current state of an asset, so reclaimed space can only be counted while it happens.
 */
export function StatsTab() {
  const { stats, loading, error, refresh } = useStats();

  const totals = stats?.totals;
  const months = stats?.months ?? [];
  const heaviest = months.reduce((largest, month) => Math.max(largest, month.savedBytes), 0);
  const nothingRecorded = totals !== undefined && totals.jobs === 0 && totals.optimized === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Recorded activity</h2>
          <p className="text-sm text-muted-foreground">
            Counted as jobs finish and kept in <code>stats.json</code> inside the data directory, so a container restart does not lose the
            history. Space is only counted for originals that were really removed: a run that kept its originals reports replacements but no
            reclaimed bytes.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {loading && !stats ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_unused, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : null}

      {totals ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Disk reclaimed"
              value={formatBytes(totals.savedBytes)}
              detail={
                totals.bytesBefore > 0
                  ? `${totals.savedPercent}% smaller than the ${formatBytes(totals.bytesBefore)} they replaced`
                  : 'Nothing removed yet'
              }
              tone="text-success"
            />
            <StatTile
              label="Assets replaced"
              value={String(totals.optimized)}
              detail={`${totals.jobs} job(s) run${totals.failed > 0 ? ` · ${totals.failed} failed` : ''}`}
            />
            <StatTile label="Moved to trash" value={String(totals.trashed)} detail={`${totals.archived} archived`} />
            <StatTile
              label="Live videos dropped"
              value={String(totals.motionVideos)}
              detail="Stills kept, motion videos trashed"
            />
          </div>

          {nothingRecorded ? (
            <p className="text-sm text-muted-foreground">
              Nothing recorded yet. Actions taken in the cleanup and live-photo tabs land here as their jobs finish, and a completed
              optimization in the Compress tab counts as a replaced asset.
            </p>
          ) : null}

          {months.length > 0 ? (
            <Card className="py-4">
              <CardContent className="px-4">
                <h3 className="mb-3 text-sm font-semibold">Month by month</h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-border text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                        <th className="p-2">Month</th>
                        <th className="p-2">Replaced</th>
                        <th className="p-2">Reclaimed</th>
                        <th className="p-2">Trashed</th>
                        <th className="p-2">Archived</th>
                        <th className="p-2">Live videos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {months.map((month) => (
                        <tr key={month.month} className="border-b border-border last:border-0">
                          <td className="p-2 text-xs font-medium whitespace-nowrap">{monthHeading(month.month)}</td>
                          <td className="p-2 text-xs tabular-nums">{month.optimized}</td>
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium tabular-nums whitespace-nowrap text-success">
                                {month.savedBytes > 0 ? formatBytes(month.savedBytes) : '—'}
                              </span>
                              {heaviest > 0 && month.savedBytes > 0 ? (
                                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                                  <span
                                    className="block h-full rounded-full bg-success"
                                    style={{ width: `${Math.max(4, Math.round((month.savedBytes / heaviest) * 100))}%` }}
                                  />
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="p-2 text-xs tabular-nums">{month.trashed}</td>
                          <td className="p-2 text-xs tabular-nums">{month.archived}</td>
                          <td className="p-2 text-xs tabular-nums">{month.motionVideos}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {stats && stats.byTag.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Archived with your buttons:</span>
              {stats.byTag.map((entry) => (
                <Badge key={entry.tag} variant="secondary">
                  {entry.tag} · {entry.assets}
                </Badge>
              ))}
            </div>
          ) : null}

          {stats && stats.startedAt > 0 ? (
            <p className="text-xs text-muted-foreground">Counting since {new Date(stats.startedAt).toLocaleString()}.</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
