import { useCallback, useMemo, useRef } from 'react';
import { toast } from '@/components/ui/sonner';

type ToastId = string | number;

/**
 * Keeps the loading toast of every job a tab queued, so the job's terminal state can replace that
 * toast in place instead of adding a second one next to the spinner. Only jobs queued from this
 * mounted component are tracked; anything else keeps the plain toast it always had.
 */
export function useJobToasts() {
  const ids = useRef(new Map<string, ToastId>());

  /** Spinner shown the moment a queued action is submitted; resolved once the request returns a job id. */
  const start = useCallback((message: string): ToastId => toast.loading(message), []);

  const track = useCallback((jobId: string, toastId: ToastId): void => {
    ids.current.set(jobId, toastId);
  }, []);

  /** Options that turn the next toast into the queued job's own message; empty for an untracked job. */
  const settle = useCallback((jobId: string): { id?: ToastId } => {
    const toastId = ids.current.get(jobId);
    ids.current.delete(jobId);
    return toastId === undefined ? {} : { id: toastId };
  }, []);

  return useMemo(() => ({ start, track, settle }), [start, track, settle]);
}
