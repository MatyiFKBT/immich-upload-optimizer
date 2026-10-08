import { useState, type FormEvent } from 'react';
import type { Album, AssetItem, SearchFilters } from '../types';
import { AssetGrid } from './AssetGrid';

interface Props {
  albums: Album[];
  results: AssetItem[];
  total: number;
  nextCursor: string | null;
  selected: ReadonlySet<string>;
  searching: boolean;
  message: string;
  messageFailed: boolean;
  onSearch: (filters: SearchFilters) => void;
  onLoadMore: () => void;
  onToggle: (asset: AssetItem) => void;
  onToggleAll: (checked: boolean) => void;
}

export function SearchPanel({
  albums,
  results,
  total,
  nextCursor,
  selected,
  searching,
  message,
  messageFailed,
  onSearch,
  onLoadMore,
  onToggle,
  onToggleAll,
}: Props) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [albumId, setAlbumId] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSearch({ ...(albumId ? { albumId } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) });
  };

  const allLoadedSelected = results.length > 0 && results.every((asset) => selected.has(asset.id));

  return (
    <section className="panel search-panel" aria-labelledby="search-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">01 / FIND</p>
          <h2 id="search-heading">Choose images</h2>
        </div>
        <p className="hint">Search by capture date, album, or both.</p>
      </div>
      <form onSubmit={submit}>
        <div className="search-fields">
          <label>
            From
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <label className="album-field">
            Album
            <select value={albumId} onChange={(event) => setAlbumId(event.target.value)}>
              <option value="">Choose an album</option>
              {albums.map((album) => (
                <option key={album.id} value={album.id}>
                  {album.albumName}
                </option>
              ))}
            </select>
          </label>
          <button className="button primary search-button" type="submit" disabled={searching}>
            Search Immich
          </button>
        </div>
        <p className="form-note">Search dates use UTC capture timestamps. At least one filter is required.</p>
      </form>
      <p className={messageFailed ? 'message error' : 'message'} role="status">
        {message}
      </p>
      {results.length > 0 && (
        <div className="results-toolbar">
          <label className="select-all">
            <input type="checkbox" checked={allLoadedSelected} onChange={(event) => onToggleAll(event.target.checked)} />
            Select loaded images
          </label>
          <span className="hint">
            {results.length} supported shown · {total} Immich image matches
          </span>
        </div>
      )}
      <AssetGrid assets={results} selected={selected} onToggle={onToggle} />
      <div className="load-more-wrap">
        {nextCursor && (
          <button className="button secondary" type="button" disabled={searching} onClick={onLoadMore}>
            Load next page
          </button>
        )}
      </div>
    </section>
  );
}
