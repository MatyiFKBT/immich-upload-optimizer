import type { LibraryAsset } from '@/types';

export type ReviewDisposition = 'keep' | 'trash';

export interface ReviewChoice {
  disposition: ReviewDisposition;
  tags: string[];
}

export interface ReviewDecision {
  assetId: string;
  disposition: ReviewDisposition;
  tags: string[];
}

export interface ReviewStack {
  key: string;
  day: string;
  minute: string;
  items: LibraryAsset[];
}

export interface FocusReviewDraft {
  version: 1;
  choices: Record<string, ReviewChoice>;
  completedIds: string[];
  jobsByAsset: Record<string, string>;
  failedIds: string[];
  currentStackKey: string | null;
}

const DRAFT_PREFIX = 'immichOptimizer.focusReview.v1.';

export function buildReviewStacks(assets: readonly LibraryAsset[]): ReviewStack[] {
  const buckets = new Map<string, ReviewStack>();
  for (const asset of assets) {
    const minute = asset.localDateTime.slice(0, 16);
    // Burst stacks are for still images. Keep videos reviewable, but as independent one-item stacks.
    const key = asset.isVideo ? `video:${asset.id}` : `photos:${minute}`;
    const stack = buckets.get(key);
    if (stack) {
      stack.items.push(asset);
    } else {
      buckets.set(key, { key, day: asset.localDateTime.slice(0, 10), minute, items: [asset] });
    }
  }

  return [...buckets.values()].sort((left, right) => {
    const byMinute = left.minute.localeCompare(right.minute);
    return byMinute !== 0 ? byMinute : left.key.localeCompare(right.key);
  });
}

export function emptyFocusReviewDraft(): FocusReviewDraft {
  return { version: 1, choices: {}, completedIds: [], jobsByAsset: {}, failedIds: [], currentStackKey: null };
}

function isChoice(value: unknown): value is ReviewChoice {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const choice = value as Record<string, unknown>;
  return (choice.disposition === 'keep' || choice.disposition === 'trash') && Array.isArray(choice.tags) && choice.tags.every((tag) => typeof tag === 'string');
}

export function loadFocusReviewDraft(year: number, month: number): FocusReviewDraft {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`${DRAFT_PREFIX}${year}-${month}`) ?? 'null');
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return emptyFocusReviewDraft();
    const raw = value as Record<string, unknown>;
    if (raw.version !== 1) return emptyFocusReviewDraft();

    const choices: Record<string, ReviewChoice> = {};
    if (typeof raw.choices === 'object' && raw.choices !== null && !Array.isArray(raw.choices)) {
      for (const [assetId, choice] of Object.entries(raw.choices)) if (isChoice(choice)) choices[assetId] = choice;
    }
    const completedIds = Array.isArray(raw.completedIds) ? raw.completedIds.filter((id): id is string => typeof id === 'string') : [];
    const jobsByAsset: Record<string, string> = {};
    if (typeof raw.jobsByAsset === 'object' && raw.jobsByAsset !== null && !Array.isArray(raw.jobsByAsset)) {
      for (const [assetId, jobId] of Object.entries(raw.jobsByAsset)) if (typeof jobId === 'string') jobsByAsset[assetId] = jobId;
    }
    const failedIds = Array.isArray(raw.failedIds) ? raw.failedIds.filter((id): id is string => typeof id === 'string') : [];
    return {
      version: 1,
      choices,
      completedIds,
      jobsByAsset,
      failedIds,
      currentStackKey: typeof raw.currentStackKey === 'string' ? raw.currentStackKey : null,
    };
  } catch {
    return emptyFocusReviewDraft();
  }
}

export function saveFocusReviewDraft(year: number, month: number, draft: FocusReviewDraft): void {
  try {
    const key = `${DRAFT_PREFIX}${year}-${month}`;
    const isEmpty = Object.keys(draft.choices).length === 0 && draft.completedIds.length === 0 && Object.keys(draft.jobsByAsset).length === 0;
    if (isEmpty) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Private browsing or a full storage quota should not interrupt the review.
  }
}

export function formatReviewDay(day: string, options: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }): string {
  const date = new Date(`${day}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return day;
  return new Intl.DateTimeFormat(undefined, options).format(date);
}
