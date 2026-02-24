import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { PipelineMetrics } from '../types';

interface MetricsChartProps {
  /** One entry per pipeline run. */
  dataPoints: { label: string; metrics: PipelineMetrics }[];
}

export default function MetricsChart({ dataPoints }: MetricsChartProps) {
  // Collect numeric metric keys across all data points
  const numericKeys = new Set<string>();
  for (const dp of dataPoints) {
    for (const [key, val] of Object.entries(dp.metrics)) {
      if (typeof val === 'number') numericKeys.add(key);
    }
  }
  const keys = Array.from(numericKeys);

  // If only one run or no numeric keys, render a table
  if (dataPoints.length <= 1 || keys.length === 0) {
    const single = dataPoints[0]?.metrics ?? {};
    const entries = Object.entries(single).filter(
      ([, v]) => typeof v === 'number' || typeof v === 'boolean',
    );
    if (entries.length === 0) {
      return (
        <p className="py-4 text-center text-sm text-slate-500">
          No metrics recorded for this pipeline.
        </p>
      );
    }
    return (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700 text-left text-xs text-slate-400">
            <th className="pb-2">Metric</th>
            <th className="pb-2 text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="border-b border-slate-800">
              <td className="py-2 text-slate-300">{k}</td>
              <td className="py-2 text-right font-mono text-slate-100">
                {typeof v === 'number' ? v.toFixed(4) : String(v)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // Multiple data points - render chart
  const chartData = dataPoints.map((dp) => ({
    name: dp.label,
    ...Object.fromEntries(
      keys.map((k) => [k, dp.metrics[k] ?? null]),
    ),
  }));

  const colors = ['#818cf8', '#34d399', '#f97316', '#f472b6', '#facc15'];

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
        <YAxis stroke="#94a3b8" fontSize={11} />
        <Tooltip
          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: 8 }}
          labelStyle={{ color: '#e2e8f0' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {keys.map((k, i) => (
          <Line
            key={k}
            type="monotone"
            dataKey={k}
            stroke={colors[i % colors.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
