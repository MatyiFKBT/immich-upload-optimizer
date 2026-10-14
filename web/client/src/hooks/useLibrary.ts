import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import type { LibraryAsset, MonthCounts } from '@/types';

export function useMonthCounts(year: number) {
  const [counts, setCounts] = useState<MonthCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const result = await api.monthCounts(year);
        if (cancelled) return;
        setCounts(result);
        setError('');
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'Unable to load month counts');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year]);

  return { counts, loading, error };
}

export function useMonthAssets(year: number | null, month: number | null, includeArchived: boolean) {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (year === null || month === null) {
      setAssets([]);
      setTruncated(false);
      setError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setAssets([]);
    void (async () => {
      try {
        const result = await api.monthAssets(year, month, includeArchived);
        if (cancelled) return;
        setAssets(result.items);
        setTruncated(result.truncated);
        setError('');
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'Unable to load this month');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year, month, includeArchived]);

  const remove = useCallback((assetIds: readonly string[]) => {
    const removed = new Set(assetIds);
    setAssets((previous) => previous.filter((asset) => !removed.has(asset.id)));
  }, []);

  /**
   * Puts optimistically hidden assets back after a job could not settle them, keeping the month in
   * capture order. Assets already present are never duplicated.
   */
  const restore = useCallback((items: readonly LibraryAsset[]) => {
    if (items.length === 0) return;
    setAssets((previous) => {
      const known = new Set(previous.map((asset) => asset.id));
      const missing = items.filter((item) => !known.has(item.id));
      if (missing.length === 0) return previous;
      return [...previous, ...missing].sort((left, right) => left.localDateTime.localeCompare(right.localDateTime));
    });
  }, []);

  return { assets, truncated, loading, error, remove, restore };
}
