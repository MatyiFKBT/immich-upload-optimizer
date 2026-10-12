/**
 * Immich's link helper redirects a public path to the viewer's own instance, so an asset or person
 * can be opened from the optimizer without knowing the Immich origin here (the browser never talks to
 * the Immich API directly; this is only a page link).
 */
const HELPER_ORIGIN = 'https://my.immich.app';

/** `https://my.immich.app/photos/<id>`, which opens the asset in the user's Immich. */
export function assetLink(assetId: string): string {
  return `${HELPER_ORIGIN}/photos/${encodeURIComponent(assetId)}`;
}

/** `https://my.immich.app/people/<id>`, which opens that person's page in the user's Immich. */
export function personLink(personId: string): string {
  return `${HELPER_ORIGIN}/people/${encodeURIComponent(personId)}`;
}
