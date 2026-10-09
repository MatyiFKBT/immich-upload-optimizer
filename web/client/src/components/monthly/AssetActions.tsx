import { Archive, Minimize2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface Props {
  disabled?: boolean;
  compressible: boolean;
  onCompress: () => void;
  onTrash: () => void;
  onArchive: () => void;
}

export function AssetActions({ disabled, compressible, onCompress, onTrash, onArchive }: Props) {
  const actions = [
    { key: 'compress', label: 'Compress and delete original', icon: Minimize2, onClick: onCompress, enabled: compressible },
    { key: 'trash', label: 'Move to trash', icon: Trash2, onClick: onTrash, enabled: true },
    { key: 'archive', label: 'Archive', icon: Archive, onClick: onArchive, enabled: true },
  ] as const;

  return (
    <>
      {actions.map((action) => (
        <Tooltip key={action.key}>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={disabled || !action.enabled}
              aria-label={action.label}
              onClick={action.onClick}
            >
              <action.icon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{action.enabled ? action.label : 'The selected compression profile does not support this format'}</TooltipContent>
        </Tooltip>
      ))}
    </>
  );
}
