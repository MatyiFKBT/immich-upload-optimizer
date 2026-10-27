import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A local record of what this service did to the library. Immich only knows the current state of an
 * asset, so "what did the cleanup reclaim" cannot be asked of it afterwards; the numbers are counted
 * here as the work happens and persisted under `WEB_DATA_DIR/stats.json`, which is a mounted volume
 * in the documented deployment, so they survive a restart.
 *
 * Bytes are only counted when a replacement really removed its original: an asset swapped with
 * "keep the original" on grew the library instead of shrinking it, and claiming otherwise would be a
 * bigger lie than a smaller number.
 */
export interface JobRecord {
  kind: 'compress' | 'trash' | 'archive' | 'tagArchive' | 'motion' | 'review';
  failed: boolean;
  /** Assets it settled: replaced, trashed, archived, or deliberately skipped. */
  settled: number;
  /** Motion jobs only: videos unlinked from a still and moved to the trash. */
  motionVideos: number;
  /** Motion jobs only: stills rewritten to drop an embedded motion video. */
  motionStills: number;
  /** `tagArchive` jobs only: the tag applied before archiving. */
  tag: string | null;
  /** Focused review jobs only: assets actually moved to the reversible Immich trash. */
  reviewTrashed: number;
  /** Focused review jobs only: successful tag applications by configured tag. */
  reviewTagCounts: Record<string, number>;
  finishedAt: number;
}

export interface ReplacementRecord {
  /** Bytes of the original that was removed, and of the file that replaced it. */
  before: number | null;
  after: number | null;
  /** False when the run kept its originals, in which case no space was reclaimed. */
  reclaimed: boolean;
  at: number;
}

/** Everything counted for one month, and for the whole history. */
export interface StatsCounters {
  /** Assets that a smaller replacement was uploaded for. */
  optimized: number;
  /** Bytes of the originals removed for those replacements, and of their replacements. */
  bytesBefore: number;
  bytesAfter: number;
  trashed: number;
  archived: number;
  motionVideos: number;
  motionStills: number;
  jobs: number;
  failed: number;
}

export interface StatsBucket extends StatsCounters {
  savedBytes: number;
  /** Share of `bytesBefore` that the replacements removed, as a whole percent. */
  savedPercent: number;
}

export interface StatsView {
  /** When the first job was recorded, and when the record last changed. Both are epoch milliseconds. */
  startedAt: number;
  updatedAt: number;
  totals: StatsBucket;
  /** Newest month first; only months with recorded activity are listed. */
  months: ({ month: string } & StatsBucket)[];
  /** Configured-tag applications, whether archived or kept, most used first. */
  byTag: { tag: string; assets: number }[];
}

interface Store {
  version: number;
  startedAt: number;
  updatedAt: number;
  totals: StatsCounters;
  months: Record<string, StatsCounters>;
  byTag: Record<string, number>;
}

const STORE_VERSION = 1;
/** A month of history costs a few dozen bytes, so a couple of centuries is a generous cap. */
const MAX_MONTHS = 240;
/** Writes are coalesced: a job can record a replacement per asset, and each one would rewrite the file. */
const WRITE_DELAY_MS = 500;

function emptyCounters(): StatsCounters {
  return { optimized: 0, bytesBefore: 0, bytesAfter: 0, trashed: 0, archived: 0, motionVideos: 0, motionStills: 0, jobs: 0, failed: 0 };
}

let store: Store = { version: STORE_VERSION, startedAt: 0, updatedAt: Date.now(), totals: emptyCounters(), months: {}, byTag: {} };
let statsPath: string | null = null;
let writeTimer: NodeJS.Timeout | null = null;

/** `YYYY-MM` in UTC: the month the work happened in, not the month the assets were captured. */
function monthKey(at: number): string {
  return new Date(at).toISOString().slice(0, 7);
}

function countNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function readCounters(value: unknown): StatsCounters {
  const raw = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    optimized: countNumber(raw.optimized),
    bytesBefore: countNumber(raw.bytesBefore),
    bytesAfter: countNumber(raw.bytesAfter),
    trashed: countNumber(raw.trashed),
    archived: countNumber(raw.archived),
    motionVideos: countNumber(raw.motionVideos),
    motionStills: countNumber(raw.motionStills),
    jobs: countNumber(raw.jobs),
    failed: countNumber(raw.failed),
  };
}

function parseStore(value: unknown): Store {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('the file does not hold a JSON object');
  const raw = value as Record<string, unknown>;
  if (raw.version !== STORE_VERSION) throw new Error(`it was written by version ${String(raw.version)}, this build writes ${STORE_VERSION}`);

  const months: Record<string, StatsCounters> = {};
  for (const [month, counters] of Object.entries(typeof raw.months === 'object' && raw.months !== null ? (raw.months as Record<string, unknown>) : {})) {
    if (/^\d{4}-\d{2}$/.test(month)) months[month] = readCounters(counters);
  }
  const byTag: Record<string, number> = {};
  for (const [tag, count] of Object.entries(typeof raw.byTag === 'object' && raw.byTag !== null ? (raw.byTag as Record<string, unknown>) : {})) {
    const assets = countNumber(count);
    if (tag !== '' && assets > 0) byTag[tag] = assets;
  }

  return {
    version: STORE_VERSION,
    startedAt: countNumber(raw.startedAt),
    updatedAt: countNumber(raw.updatedAt) || Date.now(),
    totals: readCounters(raw.totals),
    months,
    byTag,
  };
}

/**
 * Loads the record from `dataDir`. A missing file is a first run; a damaged one is set aside as
 * `stats.json.corrupt` instead of being overwritten, so a bad write cannot silently reset the
 * history to zero.
 */
export async function initializeStats(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  statsPath = join(dataDir, 'stats.json');
  try {
    store = parseStore(JSON.parse(await readFile(statsPath, 'utf8')));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    const reason = error instanceof Error ? error.message : 'unknown error';
    await rename(statsPath, `${statsPath}.corrupt`).catch(() => undefined);
    console.error(`stats.json could not be read (${reason}); it was kept as stats.json.corrupt and counting starts over`);
  }
}

function pruneMonths(): void {
  const keys = Object.keys(store.months);
  if (keys.length <= MAX_MONTHS) return;
  keys.sort();
  for (const key of keys.slice(0, keys.length - MAX_MONTHS)) delete store.months[key];
}

function scheduleWrite(): void {
  if (statsPath === null || writeTimer !== null) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void writeStore();
  }, WRITE_DELAY_MS);
  writeTimer.unref();
}

async function writeStore(): Promise<void> {
  if (statsPath === null) return;
  const body = `${JSON.stringify(store, null, 2)}\n`;
  try {
    // A half-written file would be worse than a stale one, so the new copy lands and is then renamed
    // into place, which is atomic on the same filesystem.
    await writeFile(`${statsPath}.tmp`, body, { mode: 0o600 });
    await rename(`${statsPath}.tmp`, statsPath);
  } catch (error) {
    console.error(`unable to write stats.json: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

/** Counts one finished library job. The queue reports every job exactly once. */
export function recordJob(record: JobRecord): void {
  const counters = store.months[monthKey(record.finishedAt)] ?? (store.months[monthKey(record.finishedAt)] = emptyCounters());
  for (const target of [store.totals, counters]) {
    target.jobs += 1;
    if (record.failed) target.failed += 1;
    if (record.kind === 'trash') target.trashed += record.settled;
    if (record.kind === 'review') target.trashed += record.reviewTrashed;
    if (record.kind === 'archive' || record.kind === 'tagArchive') target.archived += record.settled;
    if (record.kind === 'motion') {
      target.motionVideos += record.motionVideos;
      target.motionStills += record.motionStills;
    }
  }
  if (record.tag !== null && record.settled > 0) {
    store.byTag[record.tag] = (store.byTag[record.tag] ?? 0) + record.settled;
  }
  for (const [tag, count] of Object.entries(record.reviewTagCounts)) {
    if (count > 0) store.byTag[tag] = (store.byTag[tag] ?? 0) + count;
  }
  if (store.startedAt === 0) store.startedAt = record.finishedAt;
  store.updatedAt = record.finishedAt;
  pruneMonths();
  scheduleWrite();
}

/** Counts one verified replacement, reported by the optimizer where the original is actually removed. */
export function recordReplacement(record: ReplacementRecord): void {
  const counters = store.months[monthKey(record.at)] ?? (store.months[monthKey(record.at)] = emptyCounters());
  for (const target of [store.totals, counters]) {
    target.optimized += 1;
    if (!record.reclaimed) continue;
    target.bytesBefore += record.before ?? 0;
    target.bytesAfter += record.after ?? 0;
  }
  if (store.startedAt === 0) store.startedAt = record.at;
  store.updatedAt = record.at;
  pruneMonths();
  scheduleWrite();
}

function bucket(counters: StatsCounters): StatsBucket {
  const savedBytes = Math.max(0, counters.bytesBefore - counters.bytesAfter);
  return {
    ...counters,
    savedBytes,
    savedPercent: counters.bytesBefore > 0 ? Math.round((savedBytes / counters.bytesBefore) * 100) : 0,
  };
}

export function getStats(): StatsView {
  return {
    startedAt: store.startedAt,
    updatedAt: store.updatedAt,
    totals: bucket(store.totals),
    months: Object.keys(store.months)
      .sort()
      .reverse()
      .map((month) => ({ month, ...bucket(store.months[month]!) })),
    byTag: Object.entries(store.byTag)
      .map(([tag, assets]) => ({ tag, assets }))
      .sort((left, right) => right.assets - left.assets),
  };
}
