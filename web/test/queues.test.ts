import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configureImmich,
  configureQueueMarker,
  pauseQueuesForBatch,
  resumeQueuesAfterBatch,
  resumeQueuesLeftPaused,
} from '../src/immich.js';

const originalFetch = globalThis.fetch;
let directory = '';
let markerPath = '';

interface Queue {
  name: string;
  isPaused: boolean;
  statistics: Record<string, never>;
}

/** Answers GET /queues with `queues`, records every PUT /queues/:name, and returns 200. */
function stubQueues(queues: Queue[]): { updates: { name: string; isPaused: boolean }[] } {
  const updates: { name: string; isPaused: boolean }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/queues')) {
      return new Response(JSON.stringify(queues), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const match = /\/queues\/([^/?]+)$/.exec(url);
    if (match && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { isPaused: boolean };
      updates.push({ name: decodeURIComponent(match[1]!), isPaused: body.isPaused });
      return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { updates };
}

const queue = (name: string, isPaused = false): Queue => ({ name, isPaused, statistics: {} });

beforeEach(async () => {
  configureImmich('http://immich.test/api', 'test-key');
  directory = await mkdtemp(join(tmpdir(), 'queues-test-'));
  markerPath = join(directory, 'paused-queues.json');
  configureQueueMarker(directory);
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await rm(directory, { recursive: true, force: true });
});

describe('queue pause for a batch', () => {
  it('pauses every queue except the one uploads need, and leaves already paused ones alone', async () => {
    const { updates } = stubQueues([
      queue('metadataExtraction'),
      queue('faceDetection'),
      queue('smartSearch', true),
      queue('ocr'),
    ]);

    const result = await pauseQueuesForBatch();

    expect(result.blocked).toBe(false);
    expect(result.error).toBeNull();
    expect(result.paused).toEqual(['faceDetection', 'ocr']);
    expect(result.keptRunning).toEqual(['metadataExtraction']);
    expect(updates).toEqual([
      { name: 'faceDetection', isPaused: true },
      { name: 'ocr', isPaused: true },
    ]);
    expect(JSON.parse(await readFile(markerPath, 'utf8'))).toEqual({ queues: ['faceDetection', 'ocr'] });
  });

  it('resumes exactly the queues it paused and removes the marker', async () => {
    const { updates } = stubQueues([queue('metadataExtraction'), queue('faceDetection')]);
    const result = await pauseQueuesForBatch();
    updates.length = 0;

    await resumeQueuesAfterBatch(result.paused);

    expect(updates).toEqual([{ name: 'faceDetection', isPaused: false }]);
    await expect(access(markerPath)).rejects.toThrow();
  });

  it('pauses nothing when metadata extraction is already paused', async () => {
    const { updates } = stubQueues([queue('metadataExtraction', true), queue('faceDetection')]);

    const result = await pauseQueuesForBatch();

    expect(result.blocked).toBe(true);
    expect(result.paused).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('resumes queues a previous run left paused', async () => {
    const { updates } = stubQueues([queue('metadataExtraction'), queue('faceDetection')]);
    await writeFile(markerPath, `${JSON.stringify({ queues: ['faceDetection'] })}\n`);

    await resumeQueuesLeftPaused();

    expect(updates).toEqual([{ name: 'faceDetection', isPaused: false }]);
    await expect(access(markerPath)).rejects.toThrow();
  });

  it('keeps the batch running when the queue list cannot be read', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 403 })) as typeof fetch;

    const result = await pauseQueuesForBatch();

    expect(result.paused).toEqual([]);
    expect(result.error).toContain('could not read the queues');
  });
});
