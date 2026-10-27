import { afterEach, describe, expect, it } from 'vitest';
import { assetIsMotion, configureImmich } from '../src/immich.js';

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
