import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import type { Album, AssetItem, SearchFilters } from '@/types';
import { AssetGrid } from './AssetGrid';
import { FIELD_CLASS } from './field';

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
    <Card>
      <CardHeader>
        <p className="text-xs font-semibold tracking-widest text-primary uppercase">01 / Find</p>
        <CardTitle>Choose images</CardTitle>
        <p className="text-sm text-muted-foreground">Search by capture date, album, or both. Trashed assets are excluded.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.6fr_auto]">
          <label className="grid gap-1.5 text-sm font-medium">
            From
            <input type="date" className={FIELD_CLASS} value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            To
            <input type="date" className={FIELD_CLASS} value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Album
            <select className={FIELD_CLASS} value={albumId} onChange={(event) => setAlbumId(event.target.value)}>
              <option value="">Choose an album</option>
              {albums.map((album) => (
                <option key={album.id} value={album.id}>
                  {album.albumName}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={searching} className="self-end">
            Search Immich
          </Button>
        </form>

        <p className="text-xs text-muted-foreground">Search dates use UTC capture timestamps. At least one filter is required.</p>

        {message ? <p className={messageFailed ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{message}</p> : null}

        {results.length > 0 ? (
          <>
            <Separator />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox checked={allLoadedSelected} onCheckedChange={(checked) => onToggleAll(checked === true)} />
                Select loaded images
              </label>
              <span className="text-xs text-muted-foreground">
                {results.length} supported shown · {total} Immich image matches
              </span>
            </div>
            <AssetGrid assets={results} selected={selected} onToggle={onToggle} />
            {nextCursor ? (
              <div className="flex justify-center pt-2">
                <Button variant="outline" disabled={searching} onClick={onLoadMore}>
                  Load next page
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
