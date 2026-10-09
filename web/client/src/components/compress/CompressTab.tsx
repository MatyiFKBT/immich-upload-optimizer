import { useEffect, useRef, useState } from 'react';
import { api, type AssetItem, type Batch, type SearchFilters } from '@/api';
import type { Album, ProfileOption } from '@/types';
import { BatchPanel } from './BatchPanel';
import { ProfilesPanel } from './ProfilesPanel';
import { SearchPanel } from './SearchPanel';

const POLL_INTERVAL_MS = 1100;
const BATCH_ID_STORAGE_KEY = 'immichOptimizerBatchId';

interface Props {
  albums: Album[];
  profiles: ProfileOption[];
}

export function CompressTab({ albums, profiles }: Props) {
  const [filters, setFilters] = useState<SearchFilters | null>(null);
  const [results, setResults] = useState<AssetItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState('');
  const [searchFailed, setSearchFailed] = useState(false);

  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [selectedProfiles, setSelectedProfiles] = useState<ReadonlySet<string>>(() => new Set());
  const [deleteOriginals, setDeleteOriginals] = useState(false);

  const [starting, setStarting] = useState(false);
  const [runMessage, setRunMessage] = useState('');
  const [runFailed, setRunFailed] = useState(false);

  const [batchId, setBatchId] = useState<string | null>(() => localStorage.getItem(BATCH_ID_STORAGE_KEY));
  const [batch, setBatch] = useState<Batch | null>(null);
  const [batchMessage, setBatchMessage] = useState('');
  const [applySelection, setApplySelection] = useState<ReadonlySet<string>>(() => new Set());
  const initializedReview = useRef<string | null>(null);

  useEffect(() => {
    if (!batchId) return;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await api.batch(batchId);
        if (cancelled) return;
        setBatch(loaded);
        setBatchMessage('');
      } catch (error) {
        if (cancelled) return;
        setBatchMessage(error instanceof Error ? error.message : 'Unable to load the run');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [batchId]);

  const polling = batch !== null && (batch.status === 'preparing' || batch.status === 'applying' || batch.busy);
  useEffect(() => {
    if (!polling || !batchId) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          setBatch(await api.batch(batchId));
          setBatchMessage('');
        } catch (error) {
          setBatchMessage(error instanceof Error ? error.message : 'Unable to refresh the run');
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [polling, batchId, batch]);

  useEffect(() => {
    if (!batch || batch.status !== 'review' || initializedReview.current === batch.id) return;
    initializedReview.current = batch.id;
    setApplySelection(new Set(batch.items.filter((item) => item.status === 'ready' && item.candidates[0]?.eligible === true).map((item) => item.assetId)));
  }, [batch]);

  const toggleAsset = (asset: AssetItem) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(asset.id)) next.delete(asset.id);
      else next.add(asset.id);
      return next;
    });
  };

  const toggleAllLoaded = (checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      for (const asset of results) {
        if (checked) next.add(asset.id);
        else next.delete(asset.id);
      }
      return next;
    });
  };

  const toggleProfile = (profileId: string) => {
    setSelectedProfiles((previous) => {
      const next = new Set(previous);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  };

  const runSearch = async (values: SearchFilters) => {
    if (!values.albumId && !values.from && !values.to) {
      setSearchFailed(true);
      setSearchMessage('Choose an album, a start date, or an end date.');
      return;
    }
    setFilters(values);
    setSelected(new Set());
    setSearching(true);
    setSearchFailed(false);
    setSearchMessage('Searching Immich…');
    try {
      const result = await api.search(values);
      setResults(result.items);
      setNextCursor(result.nextCursor);
      setTotal(result.total);
      setSearchMessage(result.items.length === 0 ? 'No supported JPEG, HEIC, or HEIF images on this page.' : '');
    } catch (error) {
      setSearchFailed(true);
      setSearchMessage(error instanceof Error ? error.message : 'Unable to search Immich');
    } finally {
      setSearching(false);
    }
  };

  const loadMore = async () => {
    if (!filters || !nextCursor) return;
    setSearching(true);
    try {
      const result = await api.search({ ...filters, cursor: nextCursor });
      setResults((previous) => [...previous, ...result.items]);
      setNextCursor(result.nextCursor);
      setTotal(result.total);
      setSearchMessage('');
    } catch (error) {
      setSearchFailed(true);
      setSearchMessage(error instanceof Error ? error.message : 'Unable to load the next page');
    } finally {
      setSearching(false);
    }
  };

  const startBatch = async () => {
    const assetIds = [...selected];
    const profileIds = [...selectedProfiles];
    if (assetIds.length === 0 || profileIds.length === 0) return;
    setStarting(true);
    setRunFailed(false);
    setRunMessage('Creating optimization run…');
    try {
      const created = await api.createBatch({ assetIds, profileIds, deleteOriginal: deleteOriginals });
      localStorage.setItem(BATCH_ID_STORAGE_KEY, created.id);
      setBatchId(created.id);
      setBatch(await api.batch(created.id));
      setRunMessage('Run created. Original assets remain safe until each replacement is verified.');
      requestAnimationFrame(() => document.getElementById('batch-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (error) {
      setRunFailed(true);
      setRunMessage(error instanceof Error ? error.message : 'Unable to start the run');
    } finally {
      setStarting(false);
    }
  };

  const decide = async (assetId: string, profileId: string | null) => {
    if (!batchId) return;
    try {
      await api.decide(batchId, assetId, profileId);
      setBatch(await api.batch(batchId));
      setBatchMessage('');
    } catch (error) {
      setBatchMessage(error instanceof Error ? error.message : 'Unable to record the decision');
    }
  };

  const applySelected = async () => {
    if (!batchId || !batch) return;
    const assetIds = batch.items.filter((item) => applySelection.has(item.assetId)).map((item) => item.assetId);
    if (assetIds.length === 0) {
      setBatchMessage('Select at least one candidate to apply.');
      return;
    }
    if (!window.confirm(`Apply ${assetIds.length} verified-smaller candidate(s)?`)) return;
    try {
      await api.apply(batchId, assetIds);
      setBatch(await api.batch(batchId));
      setBatchMessage('');
    } catch (error) {
      setBatchMessage(error instanceof Error ? error.message : 'Unable to apply the selected replacements');
    }
  };

  const toggleApplyItem = (assetId: string, checked: boolean) => {
    setApplySelection((previous) => {
      const next = new Set(previous);
      if (checked) next.add(assetId);
      else next.delete(assetId);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      <SearchPanel
        albums={albums}
        results={results}
        total={total}
        nextCursor={nextCursor}
        selected={selected}
        searching={searching}
        message={searchMessage}
        messageFailed={searchFailed}
        onSearch={runSearch}
        onLoadMore={loadMore}
        onToggle={toggleAsset}
        onToggleAll={toggleAllLoaded}
      />

      <ProfilesPanel
        profiles={profiles}
        selected={selectedProfiles}
        assetCount={selected.size}
        deleteOriginals={deleteOriginals}
        starting={starting}
        message={runMessage}
        messageFailed={runFailed}
        onToggleProfile={toggleProfile}
        onDeleteOriginalsChange={setDeleteOriginals}
        onStart={startBatch}
      />

      <BatchPanel
        batch={batch}
        message={batchMessage}
        applySelection={applySelection}
        onDecide={decide}
        onToggleApplyItem={toggleApplyItem}
        onApply={applySelected}
      />
    </div>
  );
}
