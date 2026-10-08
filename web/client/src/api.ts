import type { Album, AssetItem, Batch, ProfileOption, SearchFilters, SearchResult } from './types';

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

export function thumbnailUrl(assetId: string): string {
  return `/api/assets/${encodeURIComponent(assetId)}/thumbnail`;
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
};

export type { AssetItem, Batch, SearchFilters };
