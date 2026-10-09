/** Shared so a run started in either tab is visible to — and discardable from — the Compress tab. */
export const BATCH_ID_KEY = 'immichOptimizerBatchId';

export function rememberBatchId(batchId: string): void {
  try {
    localStorage.setItem(BATCH_ID_KEY, batchId);
  } catch {
    // Storage can be unavailable; the run still works, it just cannot be resumed after a reload.
  }
}
