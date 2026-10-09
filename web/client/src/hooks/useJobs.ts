import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import type { Job } from '@/types';

const ACTIVE_POLL_MS = 2000;
const IDLE_POLL_MS = 8000;

/**
 * Polls the server-side job queue. `onSettled` fires once per job when it reaches a terminal state
 * after this hook has mounted, so a page load does not replay old completions.
 */
export function useJobs(onSettled: (job: Job) => void) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState('');
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;
  const seenRef = useRef(new Set<string>());
  const firstLoadRef = useRef(true);
  const kickRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const result = await api.jobs();
        if (cancelled) return;
        setJobs(result.jobs);
        setError('');
        const replay = firstLoadRef.current;
        firstLoadRef.current = false;
        for (const job of result.jobs) {
          const terminal = job.status === 'done' || job.status === 'failed';
          if (!terminal || seenRef.current.has(job.id)) continue;
          seenRef.current.add(job.id);
          if (!replay) settledRef.current(job);
        }
        const active = result.jobs.some((job) => job.status === 'queued' || job.status === 'running');
        timer = window.setTimeout(load, active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'Unable to load the job queue');
        timer = window.setTimeout(load, IDLE_POLL_MS);
      }
    };

    kickRef.current = () => {
      window.clearTimeout(timer);
      void load();
    };
    void load();
    return () => {
      cancelled = true;
      kickRef.current = null;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const refresh = useCallback(() => kickRef.current?.(), []);

  return { jobs, error, refresh };
}
