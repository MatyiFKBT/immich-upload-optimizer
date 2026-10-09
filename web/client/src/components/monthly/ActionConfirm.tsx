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
import type { ActionKind } from '@/types';

export interface PendingAction {
  kind: ActionKind;
  assetIds: string[];
  title: string;
  description: string;
  confirmLabel: string;
}

interface Props {
  pending: PendingAction | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ActionConfirm({ pending, onCancel, onConfirm }: Props) {
  return (
    <AlertDialog open={pending !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title ?? ''}</AlertDialogTitle>
          <AlertDialogDescription>{pending?.description ?? ''}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={pending?.kind === 'trash' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
            onClick={onConfirm}
          >
            {pending?.confirmLabel ?? 'Confirm'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
