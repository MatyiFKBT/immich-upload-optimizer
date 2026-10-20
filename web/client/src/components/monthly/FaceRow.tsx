import { personThumbnailUrl } from '@/api';
import { personLink } from '@/lib/immichLinks';
import { cn } from '@/lib/utils';
import type { LibraryAsset } from '@/types';

/** Faces beyond this are only counted; a compact row is not the place for a long list. */
const FACE_LIMIT = 4;

/**
 * The people Immich recognized in an asset, linked to their person page. Shared by the month grid
 * and focused review so a face row looks the same wherever an asset is shown.
 */
export function FaceRow({ asset, className }: { asset: LibraryAsset; className?: string }) {
  if (asset.people.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {asset.people.slice(0, FACE_LIMIT).map((person) => (
        <a
          key={person.id}
          href={personLink(person.id)}
          target="_blank"
          rel="noreferrer"
          title={`${person.name} in Immich`}
          className="shrink-0 rounded-full ring-1 ring-border transition hover:ring-2 hover:ring-primary focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        >
          <img src={personThumbnailUrl(person.id)} alt={person.name} loading="lazy" decoding="async" className="size-7 rounded-full object-cover" />
        </a>
      ))}
      {asset.people.length > FACE_LIMIT ? (
        <span className="text-xs text-muted-foreground" title={asset.people.slice(FACE_LIMIT).map((person) => person.name).join(', ')}>
          +{asset.people.length - FACE_LIMIT}
        </span>
      ) : null}
    </div>
  );
}
