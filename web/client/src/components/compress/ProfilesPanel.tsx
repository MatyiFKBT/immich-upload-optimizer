import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { ProfileOption } from '@/types';

interface Props {
  profiles: ProfileOption[];
  selected: ReadonlySet<string>;
  assetCount: number;
  deleteOriginals: boolean;
  starting: boolean;
  message: string;
  messageFailed: boolean;
  onToggleProfile: (profileId: string) => void;
  onDeleteOriginalsChange: (value: boolean) => void;
  onStart: () => void;
}

export function ProfilesPanel({
  profiles,
  selected,
  assetCount,
  deleteOriginals,
  starting,
  message,
  messageFailed,
  onToggleProfile,
  onDeleteOriginalsChange,
  onStart,
}: Props) {
  const canStart = selected.size > 0 && assetCount > 0 && !starting;
  const startLabel = assetCount > 0 ? `Prepare ${assetCount} selected image${assetCount === 1 ? '' : 's'}` : 'Prepare selected images';

  return (
    <Card>
      <CardHeader>
        <p className="text-xs font-semibold tracking-widest text-primary uppercase">02 / Compare</p>
        <CardTitle>Compression profiles</CardTitle>
        <p className="text-sm text-muted-foreground">Only candidates smaller than the source can be uploaded.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {profiles.map((profile) => (
            <label
              key={profile.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                selected.has(profile.id) ? 'border-primary bg-accent' : 'border-border hover:bg-accent/50',
              )}
            >
              <Checkbox checked={selected.has(profile.id)} onCheckedChange={() => onToggleProfile(profile.id)} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{profile.label}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {profile.sources.includes('jpeg') ? 'JPEG source' : 'HEIC / HEIF source'} · {profile.id}
                </span>
              </span>
            </label>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
          <label className="flex max-w-2xl cursor-pointer items-start gap-3">
            <Checkbox checked={deleteOriginals} onCheckedChange={(checked) => onDeleteOriginalsChange(checked === true)} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium">Delete originals after verified replacement</span>
              <span className="block text-xs text-muted-foreground">
                Off by default. Immich deletion happens only after upload, tags, and albums are verified.
              </span>
            </span>
          </label>
          <Button disabled={!canStart} onClick={onStart}>
            {startLabel}
          </Button>
        </div>

        {message ? <p className={messageFailed ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{message}</p> : null}
      </CardContent>
    </Card>
  );
}
