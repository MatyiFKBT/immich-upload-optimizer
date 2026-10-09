import { useEffect, useState } from 'react';
import { CalendarDays, Minimize2 } from 'lucide-react';
import { api } from '@/api';
import { CompressTab } from '@/components/compress/CompressTab';
import { MonthlyTab } from '@/components/monthly/MonthlyTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toaster } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import type { Album, ProfileOption } from '@/types';

export function App() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [albumResponse, profileResponse] = await Promise.all([api.albums(), api.profiles()]);
        if (cancelled) return;
        setAlbums(albumResponse.albums);
        setProfiles(profileResponse.profiles);
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
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-primary uppercase">Immich tool</p>
          <h1 className="text-3xl font-semibold tracking-tight">Media optimizer</h1>
          <p className="text-sm text-muted-foreground">Compare smaller versions, and keep the library tidy month by month.</p>
        </div>
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
      </header>

      {loadError ? <p className="mb-4 text-sm text-destructive">{loadError}</p> : null}

      <Tabs defaultValue="compress" className="gap-6">
        <TabsList>
          <TabsTrigger value="compress">
            <Minimize2 />
            Compress
          </TabsTrigger>
          <TabsTrigger value="monthly">
            <CalendarDays />
            Monthly cleanup
          </TabsTrigger>
        </TabsList>
        <TabsContent value="compress">
          <CompressTab albums={albums} profiles={profiles} />
        </TabsContent>
        <TabsContent value="monthly">
          <MonthlyTab profiles={profiles} />
        </TabsContent>
      </Tabs>

      <footer className="pt-8 text-center text-xs text-muted-foreground">
        API credentials stay in the server container. Originals are only removed when you explicitly ask for it.
      </footer>
      <Toaster />
    </div>
  );
}
