import type { ConfirmKind } from '@/types';

/** Every kind that can be acknowledged, including the live-photo tab's own action. */
export const CONFIRM_KINDS: readonly ConfirmKind[] = ['compress', 'trash', 'archive', 'motion'];

const PREFIX = 'immichOptimizer.confirm.';

/** Action kinds the user has acknowledged; their confirmation dialogs are skipped. */
export function isConfirmationHidden(kind: ConfirmKind): boolean {
  try {
    return localStorage.getItem(PREFIX + kind) === 'hidden';
  } catch {
    return false;
  }
}

export function setConfirmationHidden(kind: ConfirmKind, hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(PREFIX + kind, 'hidden');
    else localStorage.removeItem(PREFIX + kind);
  } catch {
    // Storage can be unavailable; the dialog then simply keeps asking.
  }
}

export function anyConfirmationHidden(kinds: readonly ConfirmKind[]): boolean {
  return kinds.some((kind) => isConfirmationHidden(kind));
}

export function clearConfirmations(kinds: readonly ConfirmKind[]): void {
  for (const kind of kinds) setConfirmationHidden(kind, false);
}
