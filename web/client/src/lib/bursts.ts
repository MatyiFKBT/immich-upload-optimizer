import type { LibraryAsset } from '@/types';

export type Mark = 'keep' | 'trash';

export interface BurstGroup {
  /** Local capture time truncated to the minute, e.g. `2024-05-03T14:07`. */
  key: string;
  items: LibraryAsset[];
}

/** Render-ready blocks: bursts stay together, surrounding singles collapse into one grid. */
export type TimelineBlock = { kind: 'group'; key: string; items: LibraryAsset[] } | { kind: 'singles'; assets: LibraryAsset[] };

/**
 * One ordered stream for a month: assets sharing a capture minute form a burst, everything else is a
 * single. Order follows the input, which the server returns oldest first, so the month reads from the
 * 1st onwards and bursts sit exactly where they happened.
 */
export function buildTimeline(assets: LibraryAsset[]): TimelineBlock[] {
  const buckets = new Map<string, LibraryAsset[]>();
  for (const asset of assets) {
    const key = asset.localDateTime.slice(0, 16);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(asset);
    else buckets.set(key, [asset]);
  }

  const blocks: TimelineBlock[] = [];
  let singles: LibraryAsset[] = [];
  const flushSingles = () => {
    if (singles.length > 0) {
      blocks.push({ kind: 'singles', assets: singles });
      singles = [];
    }
  };

  for (const [key, items] of buckets) {
    if (items.length > 1) {
      flushSingles();
      blocks.push({ kind: 'group', key, items });
    } else {
      singles.push(...items);
    }
  }
  flushSingles();
  return blocks;
}

/** The largest file in a burst is usually the best frame to keep; a hint, never enforced. */
export function suggestedKeeper(group: BurstGroup): string | null {
  let best: LibraryAsset | null = null;
  for (const item of group.items) {
    if (item.size === null) continue;
    if (!best || best.size === null || item.size > best.size) best = item;
  }
  return best?.id ?? null;
}

export function formatGroupTime(key: string): string {
  const [date, time] = key.split('T');
  if (!date || !time) return key;
  return `${date} · ${time}`;
}
