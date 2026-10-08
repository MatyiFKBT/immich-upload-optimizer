import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { advanceCompareBatch, applyBatchResults, BatchRequestError, createBatch, getBatch, initializeBatches, validateAssetId } from './batches.js';
import { configureImmich, listAlbums, searchImages, streamThumbnail } from './immich.js';
import { compatibleProfiles, PROFILES } from './optimizer.js';

const ROOT_DIR = fileURLToPath(new URL('../', import.meta.url));
const PUBLIC_DIR = join(ROOT_DIR, 'public');
const MAX_JSON_BYTES = 1_000_000;

class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

function writeJson(response: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new HttpError(415, 'Request body must be JSON');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_JSON_BYTES) throw new HttpError(413, 'Request body is too large');
    chunks.push(buffer);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new HttpError(400, 'Request body must be a JSON object');
  return value as Record<string, unknown>;
}

function isAuthenticated(request: IncomingMessage, password: string): boolean {
  const authorization = request.headers.authorization;
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

function requireSameOrigin(request: IncomingMessage): void {
  const origin = request.headers.origin;
  const host = request.headers.host;
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

function sendChallenge(response: ServerResponse): void {
  response.writeHead(401, {
    'www-authenticate': 'Basic realm="Immich Web Media Optimizer", charset="UTF-8"',
    'cache-control': 'no-store',
    'content-type': 'text/plain; charset=utf-8',
  });
  response.end('Authentication required');
}

async function serveStatic(response: ServerResponse, pathname: string): Promise<void> {
  const files: Record<string, { file: string; type: string }> = {
    '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
    '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
  };
  const target = files[pathname];
  if (!target) throw new HttpError(404, 'Not found');
  const body = await readFile(join(PUBLIC_DIR, target.file));
  response.writeHead(200, {
    'content-type': target.type,
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  response.end(body);
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

async function handleApi(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
  if (request.method === 'GET' && pathname === '/api/profiles') {
    writeJson(response, 200, { profiles: PROFILES.map(({ id, label, sources }) => ({ id, label, sources })) });
    return;
  }
  if (request.method === 'GET' && pathname === '/api/albums') {
    writeJson(response, 200, { albums: await listAlbums() });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/search') {
    requireSameOrigin(request);
    const body = await readJson(request);
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
      const profiles = compatibleProfiles(asset);
      if (profiles.length === 0) return [];
      return [{
        ...asset,
        profiles: profiles.map((profile) => ({ id: profile.id, label: profile.label })),
      }];
    });
    writeJson(response, 200, {
      items,
      nextCursor: result.nextCursor,
      total: result.total,
      profiles: PROFILES.map(({ id, label, sources }) => ({ id, label, sources })),
    });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/batches') {
    requireSameOrigin(request);
    const body = await readJson(request);
    const created = await createBatch({
      assetIds: body.assetIds,
      profileIds: body.profileIds,
      deleteOriginal: body.deleteOriginal,
    });
    writeJson(response, 202, created);
    return;
  }

  const batchMatch = pathname.match(/^\/api\/batches\/([0-9a-f-]{36})$/i);
  if (request.method === 'GET' && batchMatch) {
    const batch = getBatch(batchMatch[1]!);
    if (!batch) throw new HttpError(404, 'Batch not found or expired');
    writeJson(response, 200, batch);
    return;
  }

  const decisionMatch = pathname.match(/^\/api\/batches\/([0-9a-f-]{36})\/assets\/([0-9a-f-]{36})\/decision$/i);
  if (request.method === 'POST' && decisionMatch) {
    requireSameOrigin(request);
    const body = await readJson(request);
    const profileId = body.profileId === undefined ? null : body.profileId;
    advanceCompareBatch(decisionMatch[1]!, decisionMatch[2]!, profileId);
    writeJson(response, 202, { accepted: true });
    return;
  }

  const applyMatch = pathname.match(/^\/api\/batches\/([0-9a-f-]{36})\/apply$/i);
  if (request.method === 'POST' && applyMatch) {
    requireSameOrigin(request);
    const body = await readJson(request);
    applyBatchResults(applyMatch[1]!, body.assetIds);
    writeJson(response, 202, { accepted: true });
    return;
  }

  const thumbnailMatch = pathname.match(/^\/api\/assets\/([0-9a-f-]{36})\/thumbnail$/i);
  if (request.method === 'GET' && thumbnailMatch) {
    const upstream = await streamThumbnail(thumbnailMatch[1]!);
    if (!upstream.ok || !upstream.body) throw new HttpError(upstream.status || 502, 'Unable to retrieve Immich thumbnail');
    response.writeHead(200, {
      'content-type': upstream.headers.get('content-type') ?? 'image/jpeg',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    });
    await pipeline(Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream<Uint8Array>), response);
    return;
  }

  throw new HttpError(404, 'Not found');
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, password: string): Promise<void> {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('content-security-policy', "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");

  let pathname: string;
  try {
    pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    throw new HttpError(400, 'Invalid request URL');
  }
  if (request.method === 'GET' && pathname === '/healthz') {
    writeJson(response, 200, { status: 'ok' });
    return;
  }
  if (!isAuthenticated(request, password)) {
    sendChallenge(response);
    return;
  }
  if (pathname.startsWith('/api/')) {
    await handleApi(request, response, pathname);
    return;
  }
  if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed');
  await serveStatic(response, pathname);
}

async function main(): Promise<void> {
  const config = await loadConfig();
  configureImmich(config.immichApiBaseUrl, config.immichApiKey);
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  await initializeBatches(config.dataDir);

  const server = createServer((request, response) => {
    void handleRequest(request, response, config.webPassword).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      const statusCode = error instanceof HttpError || error instanceof BatchRequestError ? error.statusCode : 500;
      const message = error instanceof Error ? error.message : 'Unexpected server error';
      if (statusCode >= 500) console.error(`request failed: ${message}`);
      writeJson(response, statusCode, { error: statusCode >= 500 ? 'Request failed; inspect the batch status before retrying' : message });
    });
  });
  server.requestTimeout = 16 * 60 * 1000;
  server.headersTimeout = 60_000;
  server.listen(config.webPort, config.webHost, () => {
    console.log(`Immich Web Media Optimizer listening on ${config.webHost}:${config.webPort}`);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  console.error(`startup failed: ${message}`);
  process.exitCode = 1;
});
