import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { loadConfig, type AppConfig } from './config.js';
import { advanceCompareBatch, applyBatchResults, BatchRequestError, createBatch, getBatch, initializeBatches, validateAssetId } from './batches.js';
import { configureImmich, listAlbums, searchImages, streamThumbnail } from './immich.js';
import { compatibleProfiles, PROFILES } from './optimizer.js';

const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url));
const CLIENT_DIR = join(ROOT_DIR, 'dist', 'client');
const MAX_JSON_BYTES = 1_000_000;
const ASSET_ID_PATTERN = /^[0-9a-f-]{36}$/i;

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

function jsonResponse(context: Context, statusCode: number, data: unknown): Response {
  return context.json(data as object, statusCode as ContentfulStatusCode, { 'cache-control': 'no-store' });
}

async function readJson(context: Context): Promise<Record<string, unknown>> {
  const contentType = (context.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new HttpError(415, 'Request body must be JSON');
  let value: unknown;
  try {
    value = await context.req.json();
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new HttpError(400, 'Request body must be a JSON object');
  return value as Record<string, unknown>;
}

function isAuthenticated(authorization: string | undefined, password: string): boolean {
  if (!authorization?.startsWith('Basic ')) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const separator = decoded.indexOf(':');
  if (separator < 0 || decoded.slice(0, separator) !== 'optimizer') return false;
  const submitted = Buffer.from(decoded.slice(separator + 1));
  const expected = Buffer.from(password);
  return submitted.length === expected.length && timingSafeEqual(submitted, expected);
}

function requireSameOrigin(context: Context): void {
  const origin = context.req.header('origin');
  const host = context.req.header('host');
  if (!origin || !host) throw new HttpError(403, 'Same-origin request required');
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new HttpError(403, 'Same-origin request required');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host.toLowerCase() !== host.toLowerCase()) {
    throw new HttpError(403, 'Same-origin request required');
  }
}

function validDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `${label} must be a calendar date`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${label} must be a valid calendar date`);
  }
  return value;
}

let indexHtmlCache: string | null = null;

async function indexHtml(): Promise<string> {
  if (indexHtmlCache === null) indexHtmlCache = await readFile(join(CLIENT_DIR, 'index.html'), 'utf8');
  return indexHtmlCache;
}

export function createApp(config: AppConfig): Hono {
  const app = new Hono();

  app.use('*', async (context, next) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) context.header(name, value);
    await next();
  });

  app.get('/healthz', (context) => jsonResponse(context, 200, { status: 'ok' }));

  app.use('*', async (context, next) => {
    if (!isAuthenticated(context.req.header('authorization'), config.webPassword)) {
      return context.body('Authentication required', 401, {
        'www-authenticate': 'Basic realm="Immich Web Media Optimizer", charset="UTF-8"',
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
      });
    }
    await next();
  });

  app.use('/api/*', bodyLimit({ maxSize: MAX_JSON_BYTES, onError: (context) => jsonResponse(context, 413, { error: 'Request body is too large' }) }));
  app.use('/api/*', async (context, next) => {
    if (context.req.method !== 'GET') requireSameOrigin(context);
    await next();
  });

  app.get('/api/profiles', (context) => jsonResponse(context, 200, {
    profiles: PROFILES.map(({ id, label, sources }) => ({ id, label, sources })),
  }));

  app.get('/api/albums', async (context) => jsonResponse(context, 200, { albums: await listAlbums() }));

  app.post('/api/search', async (context) => {
    const body = await readJson(context);
    const albumId = body.albumId === '' || body.albumId === undefined ? undefined : body.albumId;
    if (albumId !== undefined && (typeof albumId !== 'string' || !validateAssetId(albumId))) {
      throw new HttpError(400, 'albumId must be a UUID');
    }
    const from = validDate(body.from, 'from');
    const to = validDate(body.to, 'to');
    if (!albumId && !from && !to) throw new HttpError(400, 'Choose an album, a date range, or both');
    if (from && to && from > to) throw new HttpError(400, 'The start date must not be after the end date');
    const cursor = body.cursor;
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 2048)) {
      throw new HttpError(400, 'Invalid search cursor');
    }

    const result = await searchImages({
      ...(typeof albumId === 'string' ? { albumId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(typeof cursor === 'string' && cursor ? { cursor } : {}),
      size: 100,
    });
    const items = result.items.flatMap((asset) => {
      if (asset.isTrashed) return [];
      const profiles = compatibleProfiles(asset);
      if (profiles.length === 0) return [];
      return [{
        ...asset,
        profiles: profiles.map((profile) => ({ id: profile.id, label: profile.label })),
      }];
    });
    return jsonResponse(context, 200, {
      items,
      nextCursor: result.nextCursor,
      total: result.total,
      profiles: PROFILES.map(({ id, label, sources }) => ({ id, label, sources })),
    });
  });

  app.post('/api/batches', async (context) => {
    const body = await readJson(context);
    const created = await createBatch({
      assetIds: body.assetIds,
      profileIds: body.profileIds,
      deleteOriginal: body.deleteOriginal,
    });
    return jsonResponse(context, 202, created);
  });

  app.get('/api/batches/:batchId', (context) => {
    const batchId = context.req.param('batchId');
    if (!ASSET_ID_PATTERN.test(batchId)) throw new HttpError(404, 'Batch not found or expired');
    const batch = getBatch(batchId);
    if (!batch) throw new HttpError(404, 'Batch not found or expired');
    return jsonResponse(context, 200, batch);
  });

  app.post('/api/batches/:batchId/assets/:assetId/decision', async (context) => {
    const body = await readJson(context);
    const profileId = body.profileId === undefined ? null : body.profileId;
    advanceCompareBatch(context.req.param('batchId'), context.req.param('assetId'), profileId);
    return jsonResponse(context, 202, { accepted: true });
  });

  app.post('/api/batches/:batchId/apply', async (context) => {
    const body = await readJson(context);
    applyBatchResults(context.req.param('batchId'), body.assetIds);
    return jsonResponse(context, 202, { accepted: true });
  });

  app.get('/api/assets/:assetId/thumbnail', async (context) => {
    const assetId = context.req.param('assetId');
    if (!ASSET_ID_PATTERN.test(assetId)) throw new HttpError(404, 'Not found');
    const upstream = await streamThumbnail(assetId);
    if (!upstream.ok || !upstream.body) throw new HttpError(upstream.status || 502, 'Unable to retrieve Immich thumbnail');
    return context.body(upstream.body as ReadableStream, 200, {
      'content-type': upstream.headers.get('content-type') ?? 'image/jpeg',
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    });
  });

  app.all('/api/*', (context) => jsonResponse(context, 404, { error: 'Not found' }));

  app.use('/assets/*', async (context, next) => {
    context.header('cache-control', 'private, max-age=31536000, immutable');
    await next();
  });

  app.use('*', async (context, next) => {
    if (context.req.method !== 'GET' && context.req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    await next();
  });

  app.use('*', serveStatic({ root: CLIENT_DIR }));

  app.get('*', async (context) => context.html(await indexHtml(), 200, { 'cache-control': 'no-store' }));

  app.onError((error, context) => {
    const statusCode = error instanceof HttpError || error instanceof BatchRequestError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    if (statusCode >= 500) console.error(`request failed: ${message}`);
    return jsonResponse(context, statusCode, { error: statusCode >= 500 ? 'Request failed; inspect the batch status before retrying' : message });
  });

  return app;
}

async function main(): Promise<void> {
  const config = await loadConfig();
  configureImmich(config.immichApiBaseUrl, config.immichApiKey);
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  await initializeBatches(config.dataDir);

  const server = serve({ fetch: createApp(config).fetch, hostname: config.webHost, port: config.webPort }, (info) => {
    console.log(`Immich Web Media Optimizer listening on ${config.webHost}:${info.port}`);
  });
  // serve() always uses HTTP/1, but its declared return type also covers HTTP/2 servers.
  if ('requestTimeout' in server) {
    server.requestTimeout = 16 * 60 * 1000;
    server.headersTimeout = 60_000;
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  console.error(`startup failed: ${message}`);
  process.exitCode = 1;
});
