import type { BurstGroup, TimelineBlock } from '@/lib/bursts';
import type { LibraryAsset } from '@/types';

/** Space between two thumbnails, and between two rows: `gap-3`, kept in one place for both grids. */
export const GRID_GAP = 12;

/** A row of the month grid: one burst card, or up to `columns` single images. */
export type GridRow = { kind: 'group'; key: string; group: BurstGroup } | { kind: 'singles'; key: string; assets: LibraryAsset[] };

/**
 * How many thumbnails fit across the month grid. The number is read from the grid's own width and
 * used for both the CSS tracks and the chunking of rows, so a row can never disagree with the track
 * count it is rendered in. Desktop stops at four columns: tiles that size read as photos rather than
 * as contact-sheet stamps, which is also why five is not offered on a wide screen.
 */
export function columnsForWidth(width: number): number {
  if (width >= 1000) return 4;
  if (width >= 640) return 3;
  return 2;
}

/**
 * Cuts the month's blocks into rows a virtualizer can place. A burst keeps its own card, and the
 * singles between bursts are filled row by row; the first asset of a row names it, so the key stays
 * the same across re-renders and the measured height of a row can be reused.
 */
export function gridRows(blocks: readonly TimelineBlock[], columns: number): GridRow[] {
  const rows: GridRow[] = [];
  for (const block of blocks) {
    if (block.kind === 'group') {
      rows.push({ kind: 'group', key: `group:${block.key}`, group: { key: block.key, items: block.items } });
      continue;
    }
    for (let start = 0; start < block.assets.length; start += columns) {
      const assets = block.assets.slice(start, start + columns);
      rows.push({ kind: 'singles', key: `singles:${assets[0]?.id ?? start}`, assets });
    }
  }
  return rows;
}
