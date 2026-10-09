import type { ActionKind } from '@/types';

const PREFIX = 'immichOptimizer.confirm.';

/** Action kinds the user has acknowledged; their confirmation dialogs are skipped. */
export function isConfirmationHidden(kind: ActionKind): boolean {
  try {
    return localStorage.getItem(PREFIX + kind) === 'hidden';
  } catch {
    return false;
  }
}

export function setConfirmationHidden(kind: ActionKind, hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(PREFIX + kind, 'hidden');
    else localStorage.removeItem(PREFIX + kind);
  } catch {
    // Storage can be unavailable; the dialog then simply keeps asking.
  }
}

export function anyConfirmationHidden(kinds: readonly ActionKind[]): boolean {
  return kinds.some((kind) => isConfirmationHidden(kind));
}

export function clearConfirmations(kinds: readonly ActionKind[]): void {
  for (const kind of kinds) setConfirmationHidden(kind, false);
}
