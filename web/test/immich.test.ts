import { afterEach, describe, expect, it } from 'vitest';
import { assetIsMotion, configureImmich, copyTagsAndAlbums, readMotionState } from '../src/immich.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * Immich rejects the deprecated top-level `id` field when it is combined with a filter ("Deprecated
 * field id cannot be combined with filter", HTTP 400). The motion check must send the id inside the
 * filter, or it fails for every upload and the replacement is trashed for nothing.
 */
describe('assetIsMotion', () => {
  it('asks with the id inside the filter, never as a separate field', async () => {
    configureImmich('http://immich.test/api', 'test-key');
    const requests: { url: string; body: unknown }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      requests.push({ url: String(input), body });
      return new Response(JSON.stringify({ assets: { items: [], nextCursor: null, total: 0 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await expect(assetIsMotion('22577e80-a6af-4862-b03b-9b13c260f5c1')).resolves.toBe(false);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual({
      filter: { id: { eq: '22577e80-a6af-4862-b03b-9b13c260f5c1' }, isMotion: { eq: true } },
      size: 1,
    });
    expect(requests[0]?.body).not.toHaveProperty('id');
  });

  it('retries the tag request until Immich makes the tags readable', async () => {
    configureImmich('http://immich.test/api', 'test-key');
    let tagRequests = 0;
    let tagReads = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (url.endsWith('/tags/assets')) {
        tagRequests += 1;
        return new Response(JSON.stringify({ count: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      // Immich acknowledges the tag request before the links are readable: the first read is empty.
      tagReads += 1;
      const tags = tagReads >= 2 ? (body?.tagIds ?? ['tag-1']).map((id: string) => ({ id })) : [];
      return new Response(JSON.stringify({ id: 'asset-1', tags }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    await expect(copyTagsAndAlbums({ newAssetId: 'asset-1', tagIds: ['tag-1'], albumIds: [] })).resolves.toBeUndefined();
    expect(tagRequests).toBe(2);
    expect(tagReads).toBe(2);
  });

  it('gives up when the tags never become readable', async () => {
    configureImmich('http://immich.test/api', 'test-key');
    globalThis.fetch = (async (input: RequestInfo | URL) =>
      new Response(JSON.stringify(String(input).endsWith('/tags/assets') ? { count: 0 } : { id: 'asset-1', tags: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    await expect(copyTagsAndAlbums({ newAssetId: 'asset-1', tagIds: ['tag-1'], albumIds: [] })).rejects.toThrow(/still missing/);
  }, 10_000);

  it('reads the motion state and readiness of a fresh upload', async () => {
    configureImmich('http://immich.test/api', 'test-key');
    const responses: Record<string, unknown> = {
      '/search/metadata': { assets: { items: [{ id: 'asset-1' }], nextCursor: null, total: 1 } },
      '/assets/asset-1': { id: 'asset-1', hasMetadata: false, livePhotoVideoId: 'video-1' },
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      const key = Object.keys(responses).find((path) => url.endsWith(path));
      return new Response(JSON.stringify(key ? responses[key] : {}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    await expect(readMotionState('asset-1')).resolves.toEqual({
      ready: false,
      isMotion: true,
      livePhotoVideoId: 'video-1',
    });
  });

  it('reports a motion photo that Immich returns', async () => {
    configureImmich('http://immich.test/api', 'test-key');
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ assets: { items: [{ id: 'asset-1' }], nextCursor: null, total: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    await expect(assetIsMotion('asset-1')).resolves.toBe(true);
  });
});
