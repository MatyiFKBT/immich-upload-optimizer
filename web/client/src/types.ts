export interface ProfileOption {
  id: string;
  label: string;
  sources: string[];
}

export interface AssetProfile {
  id: string;
  label: string;
}

export interface AssetItem {
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
  profiles: AssetProfile[];
}

export interface Album {
  id: string;
  albumName: string;
}

export interface Candidate {
  profileId: string;
  label: string;
  mimeType: string;
  filename: string;
  size: number | null;
  eligible: boolean;
  error: string | null;
}

export type BatchItemStatus = 'queued' | 'processing' | 'awaiting-choice' | 'ready' | 'applying' | 'replaced' | 'skipped' | 'failed';

export type BatchStatus = 'preparing' | 'awaiting-choice' | 'review' | 'applying' | 'complete' | 'failed' | 'expired' | 'abandoned';

export interface BatchItem {
  assetId: string;
  originalFileName: string;
  originalMimeType: string | null;
  sourceSize: number | null;
  status: BatchItemStatus;
  message: string | null;
  replacementId: string | null;
  originalDeleted: boolean;
  candidates: Candidate[];
}

export interface Batch {
  id: string;
  mode: 'compare' | 'batch';
  status: BatchStatus;
  currentIndex: number;
  total: number;
  resolved: number;
  awaiting: number;
  busy: boolean;
  deleteOriginal: boolean;
  error: string | null;
  items: BatchItem[];
}

export interface SearchFilters {
  albumId?: string;
  from?: string;
  to?: string;
  cursor?: string;
}

export interface SearchResult {
  items: AssetItem[];
  nextCursor: string | null;
  total: number;
  profiles: ProfileOption[];
}

export type AssetVisibility = 'archive' | 'timeline' | 'hidden' | 'locked';

export type ActionKind = 'compress' | 'trash' | 'archive';

export interface LibraryAsset {
  id: string;
  originalFileName: string;
  originalMimeType: string | null;
  localDateTime: string;
  fileCreatedAt: string;
  size: number | null;
  isVideo: boolean;
  visibility: AssetVisibility;
  profiles: AssetProfile[];
}

export interface MonthCount {
  month: number;
  count: number;
}

export interface MonthCounts {
  year: number;
  months: MonthCount[];
  total: number;
}

export interface MonthAssets {
  year: number;
  month: number;
  truncated: boolean;
  items: LibraryAsset[];
}
