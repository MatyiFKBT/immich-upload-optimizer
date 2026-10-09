import type { Album, Batch, Job, JobKind, MonthAssets, MonthCounts, ProfileOption, SearchFilters, SearchResult } from './types';

export class ApiError extends Error {}

function hasErrorMessage(payload: unknown): payload is { error: string } {
  return typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string';
}

async function request<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(path, {
    method: options?.method ?? 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    ...(options?.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(options.body) }),
  });
  const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
  const payload: unknown = isJson ? await response.json() : {};
  if (!response.ok) {
    throw new ApiError(hasErrorMessage(payload) ? payload.error : `Request failed (${response.status})`);
  }
  return payload as T;
}

export function thumbnailUrl(assetId: string, size: 'thumbnail' | 'preview' = 'thumbnail'): string {
  return `/api/assets/${encodeURIComponent(assetId)}/thumbnail?size=${size}`;
}

export const api = {
  profiles: () => request<{ profiles: ProfileOption[] }>('/api/profiles'),
  albums: () => request<{ albums: Album[] }>('/api/albums'),
  search: (filters: SearchFilters) => request<SearchResult>('/api/search', { method: 'POST', body: filters }),
  createBatch: (body: { assetIds: string[]; profileIds: string[]; deleteOriginal: boolean }) =>
    request<{ id: string }>('/api/batches', { method: 'POST', body }),
  batch: (batchId: string) => request<Batch>(`/api/batches/${encodeURIComponent(batchId)}`),
  decide: (batchId: string, assetId: string, profileId: string | null) =>
    request<{ accepted: boolean }>(`/api/batches/${encodeURIComponent(batchId)}/assets/${encodeURIComponent(assetId)}/decision`, {
      method: 'POST',
      body: { profileId },
    }),
  apply: (batchId: string, assetIds: string[]) =>
    request<{ accepted: boolean }>(`/api/batches/${encodeURIComponent(batchId)}/apply`, { method: 'POST', body: { assetIds } }),
  abandon: (batchId: string) =>
    request<{ accepted: boolean }>(`/api/batches/${encodeURIComponent(batchId)}/abandon`, { method: 'POST', body: {} }),
  monthCounts: (year: number) => request<MonthCounts>(`/api/library/months/${year}`),
  monthAssets: (year: number, month: number) => request<MonthAssets>(`/api/library/months/${year}/${month}`),
  jobs: () => request<{ jobs: Job[] }>('/api/library/jobs'),
  enqueueJob: (body: { kind: JobKind; assetIds: string[]; profileId: string | null }) =>
    request<Job>('/api/library/jobs', { method: 'POST', body }),
  cancelJob: (jobId: string) => request<{ accepted: boolean }>(`/api/library/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' }),
};

export type { AssetItem, Batch, Job, JobKind, LibraryAsset, MonthAssets, MonthCounts, SearchFilters } from './types';
