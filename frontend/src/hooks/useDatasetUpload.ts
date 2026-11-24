import { useEffect } from 'react';
import { useIsMutating, useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import type { MutationState } from '@tanstack/react-query';
import { uploadDataset } from '../api/client';

export interface UploadVars {
  file: File;
  description: string;
}

/** Every upload of a project carries this key, whichever panel started it. */
export const uploadKey = (projectId: number) => ['upload', projectId] as const;

/**
 * Uploading a dataset, in a way that outlives the panel that started it.
 *
 * The request can take a while (the file is streamed, profiled and stored
 * before the backend answers). A plain `useMutation` keeps "uploading" in the
 * component, so leaving the page and coming back showed an idle button while
 * the file was still on its way. The mutation itself lives in the app's
 * QueryClient, though, so this reads its state from the mutation cache: any
 * panel mounted later sees the upload in flight, and how it ended.
 *
 * The invalidations sit on the mutation, not on `mutate()`, because only the
 * former still run once the panel that started the upload has unmounted.
 */
export function useDatasetUpload(projectId: number) {
  const queryClient = useQueryClient();
  const key = uploadKey(projectId);

  const mutation = useMutation({
    mutationKey: key,
    mutationFn: ({ file, description }: UploadVars) => uploadDataset(projectId, file, description),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['datasets', projectId] });
      queryClient.invalidateQueries({ queryKey: ['uploads', projectId] });
    },
  });

  // Select the state, not the Mutation: the Mutation object is mutated in
  // place, so useMutationState would see the same reference and not re-render.
  const states = useMutationState({
    filters: { mutationKey: key },
    select: (m) => m.state as MutationState<unknown, Error, UploadVars>,
  });
  // The newest one; `.at(-1)` is past the project's TypeScript target.
  const state = states[states.length - 1];

  return {
    start: (vars: UploadVars, onSent?: () => void) => mutation.mutate(vars, { onSuccess: onSent }),
    isPending: state?.status === 'pending',
    isSuccess: state?.status === 'success',
    error: state?.status === 'error' ? state.error : null,
    /** The file being sent right now, if any; known even after a remount. */
    sending: state?.status === 'pending' ? state.variables ?? null : null,
    /** Forget how earlier uploads ended (an upload still in flight is kept). */
    clear: () => {
      const cache = queryClient.getMutationCache();
      for (const m of cache.findAll({ mutationKey: key })) {
        if (m.state.status !== 'pending') cache.remove(m);
      }
      mutation.reset();
    },
  };
}

/**
 * Ask before a reload or tab close while any upload is in flight: the browser
 * would cut the request and the file would never arrive. Mounted once at the
 * app root so it holds wherever in the app the person has gone.
 */
export function useWarnOnUnloadWhileUploading() {
  const uploading = useIsMutating({ mutationKey: ['upload'] }) > 0;
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploading]);
}
