import { api } from '@/api';
import type { Batch } from '@/types';

const POLL_INTERVAL_MS = 1500;
const MAX_WAIT_MS = 20 * 60 * 1000;

export interface CompressionOutcome {
  batchId: string;
  replaced: number;
  skipped: number;
  failed: number;
  /** Assets that ended as replaced or deliberately skipped, so the caller can drop them from the grid. */
  resolvedIds: string[];
  notes: string[];
}

/**
 * Drives the existing batch pipeline for the monthly cleanup flow: one profile, delete-original on,
 * then applies every candidate that Immich verified as strictly smaller.
 */
export async function compressAndDeleteOriginals(assetIds: string[], profileId: string): Promise<CompressionOutcome> {
  const created = await api.createBatch({ assetIds, profileIds: [profileId], deleteOriginal: true });
  const deadline = Date.now() + MAX_WAIT_MS;
  const sleep = () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    window.setTimeout(resolve, POLL_INTERVAL_MS);
    return promise;
  };

  const waitFor = async (finished: (batch: Batch) => boolean): Promise<Batch> => {
    for (;;) {
      const batch = await api.batch(created.id);
      if (finished(batch)) return batch;
      if (Date.now() > deadline) throw new Error('Compression timed out; check the Compress tab for this run');
      await sleep();
    }
  };

  const prepared = await waitFor((batch) => batch.status !== 'preparing');
  if (prepared.status !== 'review') {
    throw new Error(prepared.error ?? `Compression run ended as ${prepared.status}`);
  }

  const ready = prepared.items.filter((item) => item.status === 'ready' && item.candidates[0]?.eligible === true).map((item) => item.assetId);
  if (ready.length === 0) {
    return {
      batchId: created.id,
      replaced: 0,
      skipped: prepared.items.length,
      failed: 0,
      resolvedIds: prepared.items.map((item) => item.assetId),
      notes: prepared.items.map((item) => `${item.originalFileName}: ${item.message ?? 'no smaller candidate'}`),
    };
  }

  await api.apply(created.id, ready);
  const finished = await waitFor((batch) => batch.status === 'complete' || batch.status === 'failed');

  return {
    batchId: created.id,
    replaced: finished.items.filter((item) => item.status === 'replaced').length,
    skipped: finished.items.filter((item) => item.status === 'skipped').length,
    failed: finished.items.filter((item) => item.status === 'failed').length,
    resolvedIds: finished.items.filter((item) => item.status === 'replaced' || item.status === 'skipped').map((item) => item.assetId),
    notes: finished.items
      .filter((item) => item.status === 'failed' || (item.status === 'skipped' && item.message))
      .map((item) => `${item.originalFileName}: ${item.message ?? 'skipped'}`),
  };
}
