import { formatBytes } from '../format';
import { thumbnailUrl } from '../api';
import type { AssetItem } from '../types';

interface Props {
  assets: AssetItem[];
  selected: ReadonlySet<string>;
  onToggle: (asset: AssetItem) => void;
}

interface CardProps {
  asset: AssetItem;
  selected: boolean;
  onToggle: (asset: AssetItem) => void;
}

function AssetCard({ asset, selected, onToggle }: CardProps) {
  const taken = asset.fileCreatedAt ? new Date(asset.fileCreatedAt).toLocaleDateString() : 'Date unavailable';
  return (
    <div className={selected ? 'asset-card selected' : 'asset-card'}>
      <div className="asset-thumb-wrap">
        <img className="asset-thumb" loading="lazy" alt={asset.originalFileName} src={thumbnailUrl(asset.id)} />
        <label className="asset-check" aria-label={`Select ${asset.originalFileName}`}>
          <input type="checkbox" checked={selected} onChange={() => onToggle(asset)} />
        </label>
      </div>
      <div className="asset-card-body">
        <p className="asset-name">{asset.originalFileName}</p>
        <p className="asset-meta">
          {taken} · {formatBytes(asset.size)}
        </p>
        <p className="asset-meta">{asset.profiles.map((profile) => profile.label).join(', ')}</p>
      </div>
    </div>
  );
}

export function AssetGrid({ assets, selected, onToggle }: Props) {
  return (
    <div className="asset-grid">
      {assets.map((asset) => (
        <AssetCard key={asset.id} asset={asset} selected={selected.has(asset.id)} onToggle={onToggle} />
      ))}
    </div>
  );
}
