import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspectMotion, stripMotionStill } from '../src/motion.js';

/**
 * The rewrite needs the real exiftool and ImageMagick, which the production image installs. Where
 * they are missing (a plain CI runner), the suite is skipped instead of failing on the tool, and the
 * marker detection has no fixture to read either.
 */
const hasTools = spawnSync('exiftool', ['-ver']).status === 0 && spawnSync('magick', ['-version']).status === 0;

describe.skipIf(!hasTools)('motion photo rewrite', () => {
  let directory = '';
  let motionPath = '';
  let cleanPath = '';

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'motion-test-'));
    cleanPath = join(directory, 'clean.jpg');
    execFileSync('magick', ['-size', '64x48', 'gradient:blue-white', cleanPath]);

    // A motion photo is a JPEG with the video appended after its end marker and XMP that points at it.
    const clean = await readFile(cleanPath);
    motionPath = join(directory, 'motion.jpg');
    const trailer = Buffer.alloc(4096, 0x42);
    await writeFile(motionPath, Buffer.concat([clean, trailer]));
    execFileSync('exiftool', [
      '-overwrite_original',
      '-XMP-GCamera:MicroVideo=1',
      '-XMP-GCamera:MicroVideoVersion=1',
      '-XMP-GCamera:MicroVideoOffset=4096',
      '-XMP-GCamera:MicroVideoPresentationTimestampUs=0',
      motionPath,
    ]);
  }, 60_000);

  afterAll(async () => {
    if (directory !== '') await rm(directory, { recursive: true, force: true });
  });

  it('finds the video inside a motion photo', async () => {
    const inspection = await inspectMotion(motionPath);
    expect(inspection.hasMotion).toBe(true);
    expect(inspection.hasMarkers).toBe(true);
    expect(inspection.hasTrailer).toBe(true);
  });

  it('leaves a clean JPEG alone', async () => {
    const inspection = await inspectMotion(cleanPath);
    expect(inspection.hasMotion).toBe(false);
  });

  it('writes a smaller still with no motion data left', async () => {
    const sourceSize = (await readFile(motionPath)).length;
    const stillPath = join(directory, 'still.jpg');
    const still = await stripMotionStill({ sourcePath: motionPath, outputPath: stillPath, sourceSize });

    expect(still.size).toBeLessThan(sourceSize);
    expect(still.size).toBe((await readFile(stillPath)).length);
    const inspection = await inspectMotion(still.path);
    expect(inspection).toEqual({ hasMotion: false, hasMarkers: false, hasTrailer: false });
    const bytes = await readFile(still.path);
    expect([...bytes.subarray(-2)]).toEqual([0xff, 0xd9]);
  });

  it('refuses a still that is not smaller than its source', async () => {
    const sourceSize = (await readFile(motionPath)).length;
    const stillPath = join(directory, 'too-big.jpg');
    await expect(
      stripMotionStill({ sourcePath: motionPath, outputPath: stillPath, sourceSize: 16 }),
    ).rejects.toThrow(/not smaller/);
  });
});
