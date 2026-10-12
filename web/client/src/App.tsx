import { useEffect, useState } from 'react';
import { CalendarDays, Film, Minimize2 } from 'lucide-react';
import { api } from '@/api';
import { CompressTab } from '@/components/compress/CompressTab';
import { MonthlyTab } from '@/components/monthly/MonthlyTab';
import { MotionTab } from '@/components/motion/MotionTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { Album, ExtraButton, ProfileOption } from '@/types';

export function App() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [extraButtons, setExtraButtons] = useState<ExtraButton[]>([]);
  const [authDisabled, setAuthDisabled] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [albumResponse, profileResponse, configResponse] = await Promise.all([api.albums(), api.profiles(), api.config()]);
        if (cancelled) return;
        setAlbums(albumResponse.albums);
        setProfiles(profileResponse.profiles);
        setExtraButtons(configResponse.extraButtons);
        setAuthDisabled(configResponse.authDisabled);
        setConnected(true);
      } catch (error) {
        if (cancelled) return;
        setConnected(false);
        setLoadError(error instanceof Error ? error.message : 'Unable to reach the server');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-primary uppercase">Immich tool</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Media optimizer</h1>
          <p className="text-sm text-muted-foreground">Compare smaller versions, keep the library tidy month by month, and drop live-photo videos.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {authDisabled ? (
            <span
              className="rounded-full border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive"
              title="WEB_AUTH_DISABLED is set: this service does not authenticate callers. Protect it with your own proxy."
            >
              No authentication
            </span>
          ) : null}
          <span
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium',
              connected === null && 'text-muted-foreground',
              connected === true && 'border-success/40 text-success',
              connected === false && 'border-destructive/40 text-destructive',
            )}
          >
            {connected === null ? 'Connecting…' : connected ? 'Connected to Immich' : 'Connection failed'}
          </span>
        </div>
      </header>

      {loadError ? <p className="mb-4 text-sm text-destructive">{loadError}</p> : null}

      <Tabs defaultValue="compress" className="gap-6">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="compress" className="text-xs sm:text-sm">
            <Minimize2 />
            Compress
          </TabsTrigger>
          <TabsTrigger value="monthly" className="text-xs sm:text-sm">
            <CalendarDays />
            <span className="sm:hidden">Cleanup</span>
            <span className="hidden sm:inline">Monthly cleanup</span>
          </TabsTrigger>
          <TabsTrigger value="motion" className="text-xs sm:text-sm">
            <Film />
            <span className="sm:hidden">Live</span>
            <span className="hidden sm:inline">Live photos</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="compress">
          <CompressTab albums={albums} profiles={profiles} />
        </TabsContent>
        <TabsContent value="monthly">
          <MonthlyTab profiles={profiles} extraButtons={extraButtons} />
        </TabsContent>
        <TabsContent value="motion">
          <MotionTab />
        </TabsContent>
      </Tabs>

      <footer className="pt-8 text-center text-xs text-muted-foreground">
        API credentials stay in the server container. Originals are only removed when you explicitly ask for it.
      </footer>
      <Toaster />
    </div>
  );
}
