import {
  addAssetsToAlbums,
  AssetOrder,
  AssetTypeEnum,
  AssetVisibility,
  deleteAssets,
  getAllAlbums,
  getAssetInfo,
  getAssetOriginalPath,
  getAssetThumbnailPath,
  init,
  searchAssets,
  uploadAsset,
  bulkTagAssets,
  SearchOrderField,
} from '@immich/sdk';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, openAsBlob } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAX_ASSET_BYTES = 1024 * 1024 * 1024;
const TRANSFER_TIMEOUT_MS = 15 * 60 * 1000;

export interface SearchAsset {
  id: string;
  originalFileName: string;
  originalMimeType: string | null;
  fileCreatedAt: string;
  fileModifiedAt: string;
  isFavorite: boolean;
  isTrashed: boolean;
  checksum: string;
  size: number | null;
  livePhotoVideoId: string | null;
}

export interface AssetSnapshot extends SearchAsset {
  visibility: AssetVisibility;
  tagIds: string[];
}

export interface AlbumSummary {
  id: string;
  albumName: string;
}

let apiBaseUrl = '';
let apiKey = '';

export function configureImmich(baseUrl: string, key: string): void {
  apiBaseUrl = baseUrl.replace(/\/+$/, '');
  apiKey = key;
  init({ baseUrl: apiBaseUrl, apiKey });
}

function mapAsset(asset: Awaited<ReturnType<typeof getAssetInfo>>): SearchAsset {
  return {
    id: asset.id,
    originalFileName: asset.originalFileName,
    originalMimeType: asset.originalMimeType ?? null,
    fileCreatedAt: asset.fileCreatedAt,
    fileModifiedAt: asset.fileModifiedAt,
    isFavorite: asset.isFavorite,
    isTrashed: asset.isTrashed,
    checksum: asset.checksum,
    livePhotoVideoId: asset.livePhotoVideoId ?? null,
    size: asset.exifInfo?.fileSizeInByte ?? null,
  };
}

export async function listAlbums(): Promise<AlbumSummary[]> {
  const albums = await getAllAlbums({});
  return albums.map((album) => ({ id: album.id, albumName: album.albumName }));
}

export async function searchImages(options: {
  albumId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  size: number;
}): Promise<{ items: SearchAsset[]; nextCursor: string | null; total: number }> {
  const filter: {
    type: { eq: AssetTypeEnum };
    albumIds?: { any: string[] };
    takenAt?: { gte?: string; lte?: string };
  } = { type: { eq: AssetTypeEnum.Image } };
  if (options.albumId) filter.albumIds = { any: [options.albumId] };
  if (options.from || options.to) {
    const takenAt: { gte?: string; lte?: string } = {};
    if (options.from) takenAt.gte = `${options.from}T00:00:00.000Z`;
    if (options.to) takenAt.lte = `${options.to}T23:59:59.999Z`;
    filter.takenAt = takenAt;
  }

  const response = await searchAssets({
    metadataSearchDto: {
      filter,
      size: options.size,
      withExif: true,
      ...(options.cursor ? { cursor: options.cursor } : {}),
      orderBy: { direction: AssetOrder.Desc, field: SearchOrderField.FileCreatedAt },
    },
  });
  const items = response.assets.items.map(mapAsset);
  return { items, nextCursor: response.assets.nextCursor ?? null, total: response.assets.total };
}

export async function getAssetSnapshot(id: string): Promise<AssetSnapshot> {
  const asset = await getAssetInfo({ id });
  return {
    ...mapAsset(asset),
    visibility: asset.visibility,
    tagIds: (asset.tags ?? []).map((tag) => tag.id),
  };
}

export async function getAlbumIdsForAsset(id: string): Promise<string[]> {
  const albums = await getAllAlbums({ assetId: id });
  return albums.map((album) => album.id);
}


async function streamResponseToFile(response: Response, destination: string): Promise<number> {
  if (!response.ok || !response.body) {
    throw new Error(`Immich file request failed with HTTP ${response.status}`);
  }
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (contentLength > MAX_ASSET_BYTES) {
    await response.body.cancel();
    throw new Error('Asset exceeds the 1 GiB processing limit');
  }

  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.byteLength;
      if (received > MAX_ASSET_BYTES) {
        callback(new Error('Asset exceeds the 1 GiB processing limit'));
      } else {
        callback(null, chunk);
      }
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>),
      limiter,
      createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
    );
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
  return received;
}

async function fetchImmichFile(path: string, destination: string): Promise<number> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: { 'x-api-key': apiKey },
    redirect: 'error',
    signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
  });
  return streamResponseToFile(response, destination);
}

export async function downloadOriginal(id: string, destination: string): Promise<number> {
  return fetchImmichFile(getAssetOriginalPath(id), destination);
}

export async function streamThumbnail(id: string): Promise<Response> {
  const path = `${getAssetThumbnailPath(id)}?size=thumbnail`;
  return fetch(`${apiBaseUrl}${path}`, {
    headers: { 'x-api-key': apiKey },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
}

export async function sha1Base64(filePath: string): Promise<string> {
  const hash = createHash('sha1');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('base64');
}

export async function uploadReplacement(options: {
  filePath: string;
  filename: string;
  mimeType: string;
  fileCreatedAt: string;
  fileModifiedAt: string;
  isFavorite: boolean;
  visibility: AssetVisibility;
  livePhotoVideoId: string | null;
}): Promise<{ id: string; status: string; checksum: string }> {
  const checksum = await sha1Base64(options.filePath);
  const filename = basename(options.filename);
  const blob = await openAsBlob(options.filePath, { type: options.mimeType });
  // Immich derives the asset type from the multipart file part's own filename. oazapfts appends a
  // bare Blob without a filename, which the runtime labels "blob" and Immich rejects with
  // "Unsupported file type blob", so the part must be a File carrying the real name.
  const assetData = new File([blob as unknown as BlobPart], filename, { type: options.mimeType });
  const result = await uploadAsset({
    xImmichChecksum: checksum,
    assetMediaCreateDto: {
      assetData,
      filename,
      fileCreatedAt: options.fileCreatedAt,
      fileModifiedAt: options.fileModifiedAt,
      isFavorite: options.isFavorite,
      ...(options.livePhotoVideoId ? { livePhotoVideoId: options.livePhotoVideoId } : {}),
      visibility: options.visibility,
    },
  });
  return { id: result.id, status: result.status, checksum };
}

export async function copyTagsAndAlbums(options: {
  newAssetId: string;
  tagIds: string[];
  albumIds: string[];
}): Promise<void> {
  if (options.tagIds.length > 0) {
    await bulkTagAssets({ tagBulkAssetsDto: { assetIds: [options.newAssetId], tagIds: options.tagIds } });
  }
  if (options.albumIds.length > 0) {
    const result = await addAssetsToAlbums({
      albumsAddAssetsDto: { albumIds: options.albumIds, assetIds: [options.newAssetId] },
    });
    if (!result.success) throw new Error('Immich did not confirm adding the replacement to its albums');
  }
}

export async function verifyReplacement(options: {
  assetId: string;
  checksum: string;
  tagIds: string[];
  albumIds: string[];
  livePhotoVideoId: string | null;
}): Promise<void> {
  const [asset, albums] = await Promise.all([
    getAssetInfo({ id: options.assetId }),
    getAllAlbums({ assetId: options.assetId }),
  ]);
  if (asset.isTrashed || asset.checksum !== options.checksum || (asset.livePhotoVideoId ?? null) !== options.livePhotoVideoId) {
    throw new Error('Replacement asset verification failed');
  }
  const actualTags = new Set((asset.tags ?? []).map((tag) => tag.id));
  for (const id of options.tagIds) {
    if (!actualTags.has(id)) throw new Error('Replacement is missing one or more original tags');
  }
  const actualAlbums = new Set(albums.map((album) => album.id));
  for (const id of options.albumIds) {
    if (!actualAlbums.has(id)) throw new Error('Replacement is missing one or more original albums');
  }
}

export async function removeOriginal(id: string): Promise<void> {
  await deleteAssets({ assetBulkDeleteDto: { ids: [id] } });
}

