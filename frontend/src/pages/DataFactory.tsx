import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getMedallion, getProject, getSources } from '../api/client';
import type { Medallion } from '../types';
import Spinner from '../components/Spinner';
import StageMap, { type Stage } from '../components/StageMap';
import SourcesPanel from '../components/SourcesPanel';
import UploadPanel from '../components/UploadPanel';
import SourcePreviews from '../components/SourcePreviews';
import LayerStage from '../components/LayerStage';
import LayerDiff from '../components/LayerDiff';
import GoldDefinition from '../components/GoldDefinition';

/**
 * The data factory, as a path with stages rather than one page with everything.
 *
 * The old page put connecting, previewing, extracting, the three layers and the
 * gold editor in one column, and it was overwhelming for a reason: those are
 * five different jobs, done at different times, and stacking them gives no
 * answer to "where am I". The map answers that before anything is read.
 *
 * It opens on the furthest stage reached, because that is where the work is —
 * not on stage one, which a returning user has finished with.
 */
const STAGE_IDS = ['connect', 'preview', 'extract', 'bronze', 'silver', 'gold'] as const;
type StageId = (typeof STAGE_IDS)[number];

export default function DataFactory() {
  const { projectId } = useParams<{ projectId: string }>();
  const id = Number(projectId);

  const { data: project } = useQuery({
    queryKey: ['project', id],
    queryFn: () => getProject(id),
    enabled: Number.isFinite(id),
  });

  const { data: sources } = useQuery({ queryKey: ['sources'], queryFn: getSources });

  const { data: medallion, isLoading } = useQuery({
    queryKey: ['medallion', id],
    queryFn: () => getMedallion(id),
    enabled: Number.isFinite(id),
  });

  const mine = (sources ?? []).filter((source) => source.project_id === id);
  const stages = buildStages(mine.length, medallion);

  const [selected, setSelected] = useState<StageId | null>(null);
  // Chosen once the data arrives, then left alone: re-deriving it on every
  // refetch would yank a reader out of the stage they were reading whenever a
  // background poll landed.
  useEffect(() => {
    if (selected === null && medallion) {
      const reached = stages.filter((stage) => stage.reached);
      setSelected((reached[reached.length - 1]?.id as StageId) ?? 'connect');
    }
  }, [medallion, selected, stages]);

  if (isLoading || !medallion) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  const current = selected ?? 'connect';

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={`/projects/${id}`}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand-400 hover:text-brand-300"
        >
          ← {project?.name ?? 'Project'}
        </Link>
        <h2 className="mt-2 text-2xl font-bold text-slate-100">Data Factory</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Where the data comes in, gets cleaned, and becomes the table this project trains
          on. Pick any stage you have reached.
        </p>
      </div>

      <StageMap
        stages={stages}
        current={current}
        onSelect={(stageId) => setSelected(stageId as StageId)}
      />

      <div className="space-y-6">
        {current === 'connect' && (
          <>
            <SourcesPanel projectId={id} mode="connect" />
            <UploadPanel projectId={id} />
          </>
        )}

        {current === 'preview' && <SourcePreviews projectId={id} sources={mine} />}

        {current === 'extract' && <SourcesPanel projectId={id} mode="extract" />}

        {current === 'bronze' && (
          <LayerStage projectId={id} summary={medallion.bronze} />
        )}

        {current === 'silver' && (
          <>
            <LayerStage projectId={id} summary={medallion.silver} />
            <LayerDiff projectId={id} streams={medallion.silver.streams} />
          </>
        )}

        {current === 'gold' && (
          <>
            <LayerStage projectId={id} summary={medallion.gold} />
            <p className="text-xs text-slate-500">
              Every build gold has produced is listed under{' '}
              <Link
                to={`/projects/${id}/datasets`}
                className="text-brand-400 hover:text-brand-300"
              >
                all builds
              </Link>
              , including the one the next pipeline run will use.
            </p>
            <GoldDefinition projectId={id} summary={medallion.gold} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * What the user can reach, and why not when they cannot.
 *
 * Every "blocked" line names the action that unlocks the stage. A disabled
 * step with no explanation makes a person guess, and the guess is usually that
 * the feature is broken.
 */
function buildStages(sourceCount: number, medallion: Medallion | undefined): Stage[] {
  const bronze = medallion?.bronze;
  const silver = medallion?.silver;
  const gold = medallion?.gold;

  return [
    {
      id: 'connect',
      label: 'Connect',
      caption: 'A database, or files you upload',
      reached: true,
      badge: sourceCount ? `${sourceCount}` : undefined,
    },
    {
      id: 'preview',
      label: 'Preview',
      caption: 'Check each source loaded correctly',
      reached: sourceCount > 0,
      blocked: 'Connect a source first',
    },
    {
      id: 'extract',
      label: 'Extract',
      caption: 'Choose one and bring its rows in',
      reached: sourceCount > 0,
      blocked: 'Connect a source first',
    },
    {
      id: 'bronze',
      label: 'Bronze',
      caption: 'Exactly what the source said',
      tone: 'bronze',
      reached: (bronze?.objects ?? 0) > 0,
      blocked: 'Run an extraction',
      badge: bronze ? `${bronze.rows.toLocaleString()} rows` : undefined,
    },
    {
      id: 'silver',
      label: 'Silver',
      caption: 'Cleaned, typed, and what changed',
      tone: 'silver',
      reached: (silver?.objects ?? 0) > 0,
      blocked: 'Run an extraction',
      badge: silver ? `${silver.rows.toLocaleString()} rows` : undefined,
    },
    {
      id: 'gold',
      label: 'Gold',
      caption: 'The table this project trains on',
      tone: 'gold',
      reached: (gold?.version ?? 0) > 0,
      blocked: 'Build silver first',
      badge: gold?.version ? `v${gold.version}` : undefined,
    },
  ];
}
