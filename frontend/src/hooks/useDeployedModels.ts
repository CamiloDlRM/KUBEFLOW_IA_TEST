import { useQuery } from '@tanstack/react-query';
import { getModels, getModelTraffic } from '../api/client';

/** The deployed models the caller may see: the server already scopes them. */
export function useDeployedModels() {
  return useQuery({ queryKey: ['models'], queryFn: getModels, refetchInterval: 30_000 });
}

/** Prediction requests per model, read from Prometheus by the backend. */
export function useModelTraffic() {
  return useQuery({ queryKey: ['models', 'traffic'], queryFn: getModelTraffic, refetchInterval: 30_000 });
}
