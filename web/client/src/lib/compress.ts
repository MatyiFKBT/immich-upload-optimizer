import { api } from '@/api';
import { rememberBatchId } from '@/lib/storage';
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

function summarise(batch: Batch): CompressionOutcome {
  return {
    batchId: batch.id,
    replaced: batch.items.filter((item) => item.status === 'replaced').length,
    skipped: batch.items.filter((item) => item.status === 'skipped').length,
    failed: batch.items.filter((item) => item.status === 'failed').length,
    resolvedIds: batch.items.filter((item) => item.status === 'replaced' || item.status === 'skipped').map((item) => item.assetId),
    notes: batch.items
      .filter((item) => item.status === 'failed' || (item.status === 'skipped' && item.message))
      .map((item) => `${item.originalFileName}: ${item.message ?? 'skipped'}`),
  };
}

/**
 * Drives the existing batch pipeline for the monthly cleanup flow: one profile, delete-original on,
 * then applies every candidate that Immich verified as strictly smaller. Any failure releases the
 * single active-run slot so the next attempt is not blocked by a half-finished run.
 */
export async function compressAndDeleteOriginals(assetIds: string[], profileId: string): Promise<CompressionOutcome> {
  const created = await api.createBatch({ assetIds, profileIds: [profileId], deleteOriginal: true });
  rememberBatchId(created.id);
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

  try {
    const prepared = await waitFor((batch) => batch.status !== 'preparing');

    if (prepared.status !== 'review') {
      if (prepared.status === 'complete' || prepared.status === 'failed' || prepared.status === 'abandoned') {
        return summarise(prepared);
      }
      throw new Error(prepared.error ?? `Compression run ended as ${prepared.status}`);
    }

    const ready = prepared.items.filter((item) => item.status === 'ready' && item.candidates[0]?.eligible === true).map((item) => item.assetId);
    if (ready.length === 0) {
      await api.abandon(created.id).catch(() => undefined);
      return summarise(prepared);
    }

    await api.apply(created.id, ready);
    return summarise(await waitFor((batch) => batch.status === 'complete' || batch.status === 'failed' || batch.status === 'abandoned'));
  } catch (error) {
    await api.abandon(created.id).catch(() => undefined);
    throw error;
  }
}
