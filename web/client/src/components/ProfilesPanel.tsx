import type { ProfileOption } from '../types';

interface Props {
  profiles: ProfileOption[];
  selected: ReadonlySet<string>;
  assetCount: number;
  deleteOriginals: boolean;
  starting: boolean;
  message: string;
  messageFailed: boolean;
  onToggleProfile: (profileId: string) => void;
  onDeleteOriginalsChange: (value: boolean) => void;
  onStart: () => void;
}

export function ProfilesPanel({
  profiles,
  selected,
  assetCount,
  deleteOriginals,
  starting,
  message,
  messageFailed,
  onToggleProfile,
  onDeleteOriginalsChange,
  onStart,
}: Props) {
  const canStart = selected.size > 0 && assetCount > 0 && !starting;
  const startLabel = assetCount > 0 ? `Prepare ${assetCount} selected image${assetCount === 1 ? '' : 's'}` : 'Prepare selected images';

  return (
    <section className="panel profile-panel" aria-labelledby="profile-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">02 / COMPARE</p>
          <h2 id="profile-heading">Compression profiles</h2>
        </div>
        <p className="hint">Only candidates smaller than the source can be uploaded.</p>
      </div>
      <div className="profile-list">
        {profiles.map((profile) => (
          <label key={profile.id} className="profile-option">
            <input type="checkbox" checked={selected.has(profile.id)} onChange={() => onToggleProfile(profile.id)} />
            <span>
              <strong>{profile.label}</strong>
              <small>
                {profile.sources.includes('jpeg') ? 'JPEG source' : 'HEIC / HEIF source'} · {profile.id}
              </small>
            </span>
          </label>
        ))}
      </div>
      <div className="run-controls">
        <label className="toggle-row">
          <input type="checkbox" checked={deleteOriginals} onChange={(event) => onDeleteOriginalsChange(event.target.checked)} />
          <span>
            <strong>Delete originals after verified replacement</strong>
            <small>Off by default. Immich deletion happens only after upload, tags, and albums are verified.</small>
          </span>
        </label>
        <button className="button primary" type="button" disabled={!canStart} onClick={onStart}>
          {startLabel}
        </button>
      </div>
      <p className={messageFailed ? 'message error' : 'message'} role="status">
        {message}
      </p>
    </section>
  );
}
