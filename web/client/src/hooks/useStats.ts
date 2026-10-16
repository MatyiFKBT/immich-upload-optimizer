import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import type { Stats } from '@/types';

/** Only a finished job changes the record, so an open tab keeps up with a slow poll. */
const POLL_MS = 15_000;

export function useStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (): Promise<Stats | null> => {
    try {
      const result = await api.stats();
      setStats(result);
      setError('');
      return result;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load the recorded stats');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      await load();
      if (cancelled) return;
      timer = window.setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [load]);

  return { stats, loading, error, refresh: load };
}
