import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function Row({ keys, children }: { keys: string; children: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-2 last:border-0">
      <kbd className="rounded bg-muted px-2 py-1 text-xs font-medium">{keys}</kbd>
      <span className="text-right text-muted-foreground">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold tracking-widest text-primary uppercase">{title}</h3>
      {children}
    </section>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The app-wide shortcut reference; Focused review keeps its own, larger list behind its own `?`. */
export function ShortcutHelpDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(85dvh,760px)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts are ignored while typing in a field. <kbd className="rounded bg-muted px-1">Mod</kbd> is Command on macOS and Control elsewhere.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <Section title="Everywhere">
            <Row keys="Alt+1…4">Switch between Compress, Monthly cleanup, Live photos, and Stats</Row>
            <Row keys="?">Show this help</Row>
          </Section>
          <Section title="Monthly cleanup">
            <Row keys="F">Open Focused review</Row>
            <Row keys="? in Focused review">Show all focused-review shortcuts</Row>
          </Section>
          <Section title="Compress">
            <Row keys="Mod+A">Select every loaded search result</Row>
            <Row keys="Esc">Clear the image selection</Row>
            <Row keys="Mod+Enter">Prepare the selected images</Row>
          </Section>
          <Section title="Live photos">
            <Row keys="Mod+A">Select every loaded live photo</Row>
            <Row keys="Esc">Clear the selection</Row>
            <Row keys="U">Unlink the selected live photos</Row>
            <Row keys="R">Refresh the list</Row>
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
