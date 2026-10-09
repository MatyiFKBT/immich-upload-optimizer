import type { LibraryAsset } from '@/types';

export type Mark = 'keep' | 'trash';

export interface BurstGroup {
  /** Local capture time truncated to the minute, e.g. `2024-05-03T14:07`. */
  key: string;
  items: LibraryAsset[];
}

export interface BurstSplit {
  groups: BurstGroup[];
  rest: LibraryAsset[];
}

/** Splits a month into same-minute groups (bursts) and everything else, preserving input order. */
export function splitBursts(assets: LibraryAsset[]): BurstSplit {
  const buckets = new Map<string, LibraryAsset[]>();
  for (const asset of assets) {
    const key = asset.localDateTime.slice(0, 16);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(asset);
    else buckets.set(key, [asset]);
  }

  const groups: BurstGroup[] = [];
  const rest: LibraryAsset[] = [];
  for (const [key, items] of buckets) {
    if (items.length > 1) groups.push({ key, items });
    else rest.push(...items);
  }
  return { groups, rest };
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
