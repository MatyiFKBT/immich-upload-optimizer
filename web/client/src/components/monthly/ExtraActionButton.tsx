import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { lucideIcon } from '@/lib/lucideIcon';
import type { ExtraButton } from '@/types';

interface Props {
  button: ExtraButton;
  /** How many assets the button would act on, shown in the burst action bar. */
  count?: number;
  disabled?: boolean;
  onClick: () => void;
  /** Icon-only, for the per-image button row; otherwise an icon with the label next to it. */
  compact?: boolean;
}

/** One operator-defined button: it applies the tag named by its label and then archives the assets. */
export function ExtraActionButton({ button, count = 0, disabled, onClick, compact }: Props) {
  const Icon = lucideIcon(button.icon);
  const description = `Tag as “${button.label}” and archive`;

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" className="size-10 sm:size-8" disabled={disabled} aria-label={description} onClick={onClick}>
            <Icon className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{description}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-9 grow basis-[7rem] sm:h-8 sm:flex-none"
      disabled={disabled}
      title={description}
      onClick={onClick}
    >
      <Icon className="size-4" />
      {button.label}
      {count > 0 ? ` ${count}` : ''}
    </Button>
  );
}
