import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import type { ActionKind } from '@/types';

export interface PendingAction {
  kind: ActionKind;
  assetIds: string[];
  title: string;
  description: string;
  confirmLabel: string;
}

const KIND_LABEL: Record<ActionKind, string> = {
  compress: 'compress and delete',
  trash: 'trash',
  archive: 'archive',
};

interface Props {
  pending: PendingAction | null;
  onCancel: () => void;
  onConfirm: (remember: boolean) => void;
}

export function ActionConfirm({ pending, onCancel, onConfirm }: Props) {
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    setRemember(false);
  }, [pending]);

  return (
    <AlertDialog open={pending !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title ?? ''}</AlertDialogTitle>
          <AlertDialogDescription>{pending?.description ?? ''}</AlertDialogDescription>
        </AlertDialogHeader>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox checked={remember} onCheckedChange={(checked) => setRemember(checked === true)} />
          Don&apos;t ask again for {pending ? KIND_LABEL[pending.kind] : ''} actions
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={pending?.kind === 'trash' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
            onClick={() => onConfirm(remember)}
          >
            {pending?.confirmLabel ?? 'Confirm'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
