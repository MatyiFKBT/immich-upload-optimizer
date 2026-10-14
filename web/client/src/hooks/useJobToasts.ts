import { useCallback, useMemo, useRef } from 'react';
import { toast } from '@/components/ui/sonner';
import type { Job } from '@/types';

/** The handle `toast.promise` returns: the toast's id with an `unwrap` helper attached. */
export type JobToastHandle = string | number | { unwrap: () => Promise<unknown> };

interface Waiter {
  handle: JobToastHandle;
  resolve: (job: Job) => void;
  reject: (error: Error) => void;
}

/** Copy for the single toast an action owns; `toast.promise` swaps the loading text for the result. */
export interface JobToastCopy {
  loading: string;
  success: (job: Job) => string;
  error: (error: unknown) => string;
}

/**
 * One toast per queued action, driven by `toast.promise`. `toast.promise` normally watches the request
 * it is given, but a queued job keeps running after its request has returned, so the promise handed to
 * it settles when the job queue reports the job's terminal state instead. The same toast therefore
 * spins from the button press and turns into the job's own result.
 */
export function useJobToasts() {
  const waiters = useRef(new Map<string, Waiter>());

  /**
   * Shows the action's toast for an enqueue request and returns that request, so the caller can await
   * it and roll back an optimistic edit; a request that fails turns the same toast into the error.
   */
  const watch = useCallback((enqueue: Promise<Job>, copy: JobToastCopy): Promise<Job> => {
    // The enqueue request cannot resolve before `toast.promise` has returned below, so this promise
    // body always runs with the toast handle already assigned.
    const settled = enqueue.then(
      (job) =>
        new Promise<Job>((resolve, reject) => {
          waiters.current.set(job.id, { handle, resolve, reject });
        }),
    );
    const handle: JobToastHandle = toast.promise(settled, copy);
    return enqueue;
  }, []);

  /** Terminal state of a queued job: resolves its toast with the job, or rejects it with the failure. */
  const settle = useCallback((job: Job) => {
    const waiter = waiters.current.get(job.id);
    if (!waiter) {
      // Queued before this tab mounted, so there is no spinner to turn into the result.
      if (job.status === 'failed') toast.error(job.message ?? 'The job failed');
      else toast.success(job.message ?? 'The job finished');
      return;
    }
    waiters.current.delete(job.id);
    if (job.status === 'failed') waiter.reject(new Error(job.message ?? 'The job failed'));
    else waiter.resolve(job);
  }, []);

  /** A cancelled job never settles, so its toast is dismissed instead of spinning forever. */
  const drop = useCallback((jobId: string, message: string) => {
    const waiter = waiters.current.get(jobId);
    if (!waiter) return;
    waiters.current.delete(jobId);
    // Always a bare id, because `watch` always passes a loading message.
    if (typeof waiter.handle === 'string' || typeof waiter.handle === 'number') toast.dismiss(waiter.handle);
    toast.info(message);
  }, []);

  return useMemo(() => ({ watch, settle, drop }), [watch, settle, drop]);
}
