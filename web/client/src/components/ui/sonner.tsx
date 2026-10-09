import type { CSSProperties } from 'react';
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import 'sonner/dist/styles.css';

/**
 * shadcn/ui Sonner wrapper. Upstream reads the theme from `next-themes`; this app follows the OS
 * preference (`color-scheme: light dark`) and has no theme provider, so it is fixed to `system`.
 * The stylesheet is imported here on purpose: the CSP forbids sonner's runtime-injected inline
 * <style>, so this bundled copy is what actually styles the toasts.
 */
// Sonner's CSS custom properties are not part of CSSProperties, so the object is asserted wholesale.
const themeVariables = {
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
  '--border-radius': 'var(--radius)',
} as CSSProperties;

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      position="bottom-right"
      closeButton
      richColors
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={themeVariables}
      {...props}
    />
  );
}

export { Toaster };
export { toast } from 'sonner';
