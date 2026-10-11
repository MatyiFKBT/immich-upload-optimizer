// Form controls under 16px make iOS Safari zoom the page on focus, so the fields are 16px on
// phones and drop to the usual 14px from `sm` up.
export const FIELD_CLASS =
  'h-10 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:h-9 sm:text-sm';
