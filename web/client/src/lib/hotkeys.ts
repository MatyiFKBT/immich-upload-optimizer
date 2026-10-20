/**
 * True when a shortcut should leave the key to a form control. Buttons are deliberately not
 * included: a shortcut such as F should still work after a tile was clicked.
 */
export function isTypingTarget(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="option"]'));
}

/** A dialog or alert dialog owns Escape, so page-level shortcuts must not fire behind it. */
export function hasOpenDialog(): boolean {
  return typeof document !== 'undefined' && Boolean(document.querySelector('[role="dialog"], [role="alertdialog"]'));
}
