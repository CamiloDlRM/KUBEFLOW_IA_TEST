import { useQuery } from '@tanstack/react-query';
import { getRepos, getPipelines, getPipeline, getReady, getPipelineLogs } from '../api/client';

export function useRepos() {
  return useQuery({
    queryKey: ['repos'],
    queryFn: getRepos,
    refetchInterval: 10_000,
  });
}

export function usePipelines(page = 1, size = 20) {
  return useQuery({
    queryKey: ['pipelines', page, size],
    queryFn: () => getPipelines(page, size),
    refetchInterval: 10_000,
  });
}

export function usePipeline(id: string | undefined) {
  return useQuery({
    queryKey: ['pipeline', id],
    queryFn: () => getPipeline(id!),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const pipeline = query.state.data;
      if (pipeline && (pipeline.status === 'running' || pipeline.status === 'queued')) {
        return 5_000;
      }
      return false;
    },
  });
}

export function usePipelineLogs(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['pipeline-logs', id],
    queryFn: () => getPipelineLogs(id!),
    enabled: Boolean(id) && enabled,
    staleTime: 30_000,
  });
}

export function useServiceHealth() {
  return useQuery({
    queryKey: ['health', 'ready'],
    queryFn: getReady,
    refetchInterval: 15_000,
    retry: 1,
  });
}
