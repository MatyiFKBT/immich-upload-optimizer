import { Archive, Minimize2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ExtraButton } from '@/types';
import { ExtraActionButton } from './ExtraActionButton';

interface Props {
  disabled?: boolean;
  compressible: boolean;
  /** The asset already sits in the archive, so archiving it again is not offered. */
  archived: boolean;
  extraButtons: readonly ExtraButton[];
  onCompress: () => void;
  onTrash: () => void;
  onArchive: () => void;
  onExtraAction: (button: ExtraButton) => void;
}

export function AssetActions({ disabled, compressible, archived, extraButtons, onCompress, onTrash, onArchive, onExtraAction }: Props) {
  const actions = [
    {
      key: 'compress',
      label: 'Compress and delete original',
      icon: Minimize2,
      onClick: onCompress,
      enabled: compressible,
      disabledHint: 'The selected compression profile does not support this format',
    },
    { key: 'trash', label: 'Move to trash', icon: Trash2, onClick: onTrash, enabled: true, disabledHint: '' },
    { key: 'archive', label: 'Archive', icon: Archive, onClick: onArchive, enabled: !archived, disabledHint: 'Already archived' },
  ] as const;

  return (
    <>
      {actions.map((action) => (
        <Tooltip key={action.key}>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="size-10 sm:size-8"
              disabled={disabled || !action.enabled}
              aria-label={action.label}
              onClick={action.onClick}
            >
              <action.icon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{action.enabled ? action.label : action.disabledHint}</TooltipContent>
        </Tooltip>
      ))}
      {extraButtons.map((button) => (
        <ExtraActionButton key={button.label} button={button} compact disabled={disabled} onClick={() => onExtraAction(button)} />
      ))}
    </>
  );
}
