/**
 * Where a run is shown: on its project's canvas, with that run selected.
 * Runs older than projects have no canvas, so they keep their own page.
 */
export function runLink(runId: string, projectId: number | null | undefined): string {
  return projectId != null ? `/pipelines/canvas/${projectId}?run=${runId}` : `/pipelines/${runId}`;
}
