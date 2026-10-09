import { spawn } from 'node:child_process';
import { readdir, mkdir, rm, lstat } from 'node:fs/promises';
import { basename, extname, join, parse } from 'node:path';
import type { SearchAsset } from './immich.js';

export const PROFILES = [
  { id: 'jpeg-jpeg', label: 'Optimized JPEG', outputExtension: '.jpg', mimeType: 'image/jpeg', sources: ['jpeg'] },
  { id: 'jpeg-avif', label: 'AVIF', outputExtension: '.avif', mimeType: 'image/avif', sources: ['jpeg'] },
  { id: 'jpeg-jxl-lossy', label: 'Lossy JPEG-XL', outputExtension: '.jxl', mimeType: 'image/jxl', sources: ['jpeg'] },
  { id: 'jpeg-jxl-lossless', label: 'Lossless JPEG-XL', outputExtension: '.jxl', mimeType: 'image/jxl', sources: ['jpeg'] },
  { id: 'heic-avif', label: 'AVIF', outputExtension: '.avif', mimeType: 'image/avif', sources: ['heic'] },
  { id: 'heic-jxl', label: 'JPEG-XL', outputExtension: '.jxl', mimeType: 'image/jxl', sources: ['heic'] },
] as const;

export type ProfileId = (typeof PROFILES)[number]['id'];

export interface Candidate {
  profileId: ProfileId;
  label: string;
  mimeType: string;
  filename: string;
  size: number | null;
  eligible: boolean;
  path: string | null;
  error: string | null;
}

function sourceKind(asset: { originalFileName: string; originalMimeType: string | null }): 'jpeg' | 'heic' | null {
  const extension = extname(basename(asset.originalFileName)).toLowerCase();
  const mime = (asset.originalMimeType ?? '').toLowerCase();
  if ((extension === '.jpg' || extension === '.jpeg') && (!mime || mime === 'image/jpeg')) return 'jpeg';
  if ((extension === '.heic' || extension === '.heif') && (!mime || mime === 'image/heic' || mime === 'image/heif')) return 'heic';
  return null;
}

export function compatibleProfiles(asset: { originalFileName: string; originalMimeType: string | null }): typeof PROFILES[number][] {
  const kind = sourceKind(asset);
  return kind ? PROFILES.filter((profile) => profile.sources.some((source) => source === kind)) : [];
}

function runProcess(command: string, args: string[], timeoutMs = 10 * 60 * 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < 16_384) stdout += chunk.slice(0, 16_384 - stdout.length);
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 16_384) stderr += chunk.slice(0, 16_384 - stderr.length);
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`${command} could not start: ${error.message}`));
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) return reject(new Error(`${command} exceeded its processing time limit`));
      if (code !== 0) {
        const detail = stderr.trim() || signal || `exit code ${code}`;
        return reject(new Error(`${command} failed: ${detail.slice(0, 2000)}`));
      }
      resolve(stdout.trim());
    });
  });
}

async function expectedImageFormat(path: string): Promise<string> {
  const output = await runProcess('magick', ['identify', '-quiet', '-format', '%m', path], 30_000);
  return output.trim().toUpperCase();
}

async function executeProfile(profile: typeof PROFILES[number], sourcePath: string, sourceName: string, itemDir: string): Promise<{ path: string; filename: string }> {
  const outputDir = join(itemDir, profile.id);
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const base = parse(basename(sourceName)).name || 'optimized';
  const outputPath = join(outputDir, `${base}${profile.outputExtension}`);

  switch (profile.id) {
    case 'jpeg-jpeg':
      await runProcess('caesiumclt', [
        '--quality', '82', '--exif', '--keep-orientation', '--keep-dates', '--threads', '1',
        '--output', outputDir, sourcePath,
      ]);
      break;
    case 'jpeg-avif':
      await runProcess('avifenc', ['-c', 'aom', '-a', 'tune=iq', '-q', '60', '-s', '6', sourcePath, outputPath]);
      break;
    case 'jpeg-jxl-lossy':
      await runProcess('cjxl', ['--lossless_jpeg=0', '-q', '75', '-e', '7', sourcePath, outputPath]);
      break;
    case 'jpeg-jxl-lossless':
      await runProcess('cjxl', ['--lossless_jpeg=1', sourcePath, outputPath]);
      break;
    case 'heic-avif':
      await runProcess('magick', ['-quality', '75', sourcePath, outputPath]);
      break;
    case 'heic-jxl':
      await runProcess('magick', ['-quality', '75', sourcePath, outputPath]);
      break;
  }

  let candidatePath = outputPath;
  if (profile.id === 'jpeg-jpeg') {
    const outputFiles = (await readdir(outputDir, { withFileTypes: true })).filter((entry) => entry.isFile());
    if (outputFiles.length !== 1) throw new Error(`Caesium produced ${outputFiles.length} output files; expected one`);
    candidatePath = join(outputDir, outputFiles[0]!.name);
  }
  const outputStat = await lstat(candidatePath);
  if (!outputStat.isFile() || outputStat.size <= 0) throw new Error('Optimizer produced an empty or invalid output file');

  const actualFormat = await expectedImageFormat(candidatePath);
  const expectedFormat = profile.outputExtension === '.jpg' ? 'JPEG' : profile.outputExtension === '.avif' ? 'AVIF' : 'JXL';
  if (actualFormat !== expectedFormat) throw new Error(`Optimizer output is ${actualFormat || 'unknown'}, expected ${expectedFormat}`);

  return {
    path: candidatePath,
    filename: `${base}${profile.outputExtension}`,
  };
}

export async function generateCandidates(options: {
  asset: SearchAsset;
  sourcePath: string;
  sourceSize: number;
  profileIds: ProfileId[];
  workDir: string;
}): Promise<Candidate[]> {
  const supported = compatibleProfiles(options.asset);
  const candidates: Candidate[] = [];
  for (const profileId of options.profileIds) {
    const profile = supported.find((item) => item.id === profileId);
    if (!profile) {
      candidates.push({
        profileId,
        label: profileId,
        mimeType: 'application/octet-stream',
        filename: options.asset.originalFileName,
        size: null,
        eligible: false,
        path: null,
        error: 'This profile does not support the source image format',
      });
      continue;
    }

    try {
      const generated = await executeProfile(profile, options.sourcePath, options.asset.originalFileName, options.workDir);
      const size = (await lstat(generated.path)).size;
      const eligible = size < options.sourceSize;
      candidates.push({
        profileId,
        label: profile.label,
        mimeType: profile.mimeType,
        filename: generated.filename,
        size,
        eligible,
        path: eligible ? generated.path : null,
        error: eligible ? null : 'Not smaller than the original; upload disabled',
      });
      if (!eligible) await rm(generated.path, { force: true });
    } catch (error) {
      candidates.push({
        profileId,
        label: profile.label,
        mimeType: profile.mimeType,
        filename: options.asset.originalFileName,
        size: null,
        eligible: false,
        path: null,
        error: error instanceof Error ? error.message : 'Optimization failed',
      });
    }
  }
  return candidates;
}
