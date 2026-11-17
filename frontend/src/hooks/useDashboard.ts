import { useQuery } from '@tanstack/react-query';
import { getPipelineStats, getProjects } from '../api/client';

/** The success rate of the caller's runs over the last 30 days, and the 30 before. */
export function usePipelineStats() {
  return useQuery({ queryKey: ['pipelines', 'stats'], queryFn: getPipelineStats, refetchInterval: 30_000 });
}

/** The projects the caller may see, to name each run by its project. */
export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: getProjects });
}
