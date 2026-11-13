import { useId, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, TriangleAlert, X } from 'lucide-react';
import { getCleaningRecipe } from '../../api/client';
import type { CustomStep, CustomStepKind } from '../../types';
import ChipsInput from './ChipsInput';
import { STEP_KINDS, newStep, stepLossy, stepProblem, stepTitle } from './recipe';

/**
 * A source's own silver rules, edited as blocks.
 *
 * They run after the standard, in this order, on the cleaned table — so the
 * column names offered are silver's, and values are already typed (a yes/no
 * column reads as true/false). Two blocks take an expression in DuckDB's SQL,
 * over the row's own columns and nothing else.
 */

const FIELD =
  'rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-brand-500 focus:outline-none';

/** Common conversions, so nobody has to remember that a pound is 0.45359237 kg. */
const UNIT_PRESETS: { label: string; from: string; to: string; factor: number; offset: number }[] = [
  { label: 'lb → kg', from: 'lb', to: 'kg', factor: 0.45359237, offset: 0 },
  { label: 'kg → lb', from: 'kg', to: 'lb', factor: 2.20462262, offset: 0 },
  { label: '°F → °C', from: '°F', to: '°C', factor: 5 / 9, offset: -160 / 9 },
  { label: '°C → °F', from: '°C', to: '°F', factor: 1.8, offset: 32 },
  { label: 'in → cm', from: 'in', to: 'cm', factor: 2.54, offset: 0 },
  { label: 'cm → m', from: 'cm', to: 'm', factor: 0.01, offset: 0 },
  { label: 'glucose mg/dL → mmol/L', from: 'mg/dL', to: 'mmol/L', factor: 0.0555, offset: 0 },
  { label: 'glucose mmol/L → mg/dL', from: 'mmol/L', to: 'mg/dL', factor: 18.016, offset: 0 },
];

const DATE_FORMATS = ['%d/%m/%Y', '%m/%d/%Y', '%d-%m-%Y', '%Y%m%d', '%d/%m/%Y %H:%M', '%d/%m/%y'];

export default function CustomSteps({
  steps,
  onChange,
  columns,
  otherSources,
}: {
  steps: CustomStep[];
  onChange: (steps: CustomStep[]) => void;
  columns: string[];
  otherSources: { id: number; name: string }[];
}) {
  const queryClient = useQueryClient();
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const columnList = useId();

  const set = (index: number, step: CustomStep) => onChange(steps.map((current, i) => (i === index ? step : current)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...steps];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next);
  };

  async function copyFrom(sourceId: number) {
    const name = otherSources.find((source) => source.id === sourceId)?.name ?? 'that source';
    try {
      const other = await queryClient.fetchQuery({
        queryKey: ['cleaning-recipe', sourceId],
        queryFn: () => getCleaningRecipe(sourceId),
      });
      if (other.recipe.steps.length === 0) {
        setCopyNote(`${name} has no rules of its own.`);
        return;
      }
      onChange([...steps, ...other.recipe.steps]);
      setCopyNote(`Copied ${other.recipe.steps.length} rule(s) from ${name}. Save to keep them.`);
    } catch (error) {
      setCopyNote((error as Error).message);
    }
  }

  return (
    <div>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Your rules</h4>
      <div className="space-y-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-3">
        <p className="text-xs text-slate-400">
          Rules of your own, run in this order after the standard, on the cleaned table. Each one shows up in the
          step-by-step view with what it changed.
        </p>

        {/* One list of silver's columns for every field that names one. */}
        <datalist id={columnList}>
          {columns.map((column) => (
            <option key={column} value={column} />
          ))}
        </datalist>

        {steps.length > 0 && (
          <ol className="space-y-2">
            {steps.map((step, index) => (
              <StepCard
                key={index}
                step={step}
                number={index + 1}
                columnList={columnList}
                columns={columns}
                onChange={(next) => set(index, next)}
                onRemove={() => onChange(steps.filter((_, i) => i !== index))}
                onUp={index > 0 ? () => move(index, -1) : undefined}
                onDown={index < steps.length - 1 ? () => move(index, 1) : undefined}
              />
            ))}
          </ol>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative inline-flex items-center">
            <Plus size={13} className="pointer-events-none absolute left-2.5 text-brand-300" aria-hidden="true" />
            <select
              aria-label="Add a rule"
              value=""
              onChange={(event) => {
                if (event.target.value) onChange([...steps, newStep(event.target.value as CustomStepKind)]);
              }}
              className="rounded-lg border border-brand-500/50 bg-slate-950 py-1.5 pl-7 pr-3 text-xs text-brand-200 focus:outline-none"
            >
              <option value="">Add a rule…</option>
              {STEP_KINDS.map((kind) => (
                <option key={kind.kind} value={kind.kind} title={kind.hint}>
                  {kind.label}
                </option>
              ))}
            </select>
          </label>
          {otherSources.length > 0 && (
            <select
              aria-label="Copy rules from another source"
              value=""
              onChange={(event) => event.target.value && copyFrom(Number(event.target.value))}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none"
            >
              <option value="">Copy rules from…</option>
              {otherSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          )}
          {copyNote && <span className="text-xs text-slate-400">{copyNote}</span>}
        </div>
      </div>
    </div>
  );
}

function StepCard({
  step,
  number,
  columnList,
  columns,
  onChange,
  onRemove,
  onUp,
  onDown,
}: {
  step: CustomStep;
  number: number;
  columnList: string;
  columns: string[];
  onChange: (step: CustomStep) => void;
  onRemove: () => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const kind = STEP_KINDS.find((entry) => entry.kind === step.kind);
  const problem = stepProblem(step);
  const loss = stepLossy(step);
  const title = stepTitle(step);

  return (
    <li aria-label={`Rule ${number}: ${title}`} className="rounded-lg border border-slate-700 bg-slate-950/40">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-3 py-2">
        <span className="font-display text-xs text-slate-600">{number}</span>
        <span className="rounded bg-brand-600/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-brand-200">
          {kind?.label ?? step.kind}
        </span>
        <input
          aria-label={`Name of rule ${number}`}
          value={step.label}
          onChange={(event) => onChange({ ...step, label: event.target.value })}
          placeholder={title}
          className="min-w-[10rem] flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />
        {loss && (
          <span title={loss} className="inline-flex items-center gap-1 text-[11px] text-amber-300">
            <TriangleAlert size={12} aria-hidden="true" /> loses data
          </span>
        )}
        <IconButton label={`Move rule ${number} up`} onClick={onUp}>
          <ArrowUp size={13} />
        </IconButton>
        <IconButton label={`Move rule ${number} down`} onClick={onDown}>
          <ArrowDown size={13} />
        </IconButton>
        <IconButton label={`Remove rule ${number}`} onClick={onRemove}>
          <X size={14} />
        </IconButton>
      </div>
      <div className="space-y-3 px-3 py-3 text-xs text-slate-400">
        <StepFields step={step} columnList={columnList} columns={columns} onChange={onChange} />
        {problem && <p className="text-amber-300">Still needed: {problem}.</p>}
      </div>
    </li>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={!onClick}
      className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? 'sm:col-span-2' : ''}`}>
      {label}
      {children}
    </label>
  );
}

function ColumnInput({
  label,
  value,
  onChange,
  columnList,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  columnList: string;
}) {
  return (
    <Field label={label}>
      <input list={columnList} value={value} onChange={(event) => onChange(event.target.value)} className={FIELD} />
    </Field>
  );
}

function Expression({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <Field label={label} wide>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={`${FIELD} font-display`}
      />
      <span className="text-slate-500">
        SQL over this row's columns (DuckDB). Text goes in single quotes; it cannot read anything but the row.
      </span>
    </Field>
  );
}

function StepFields({
  step,
  columnList,
  columns,
  onChange,
}: {
  step: CustomStep;
  columnList: string;
  columns: string[];
  onChange: (step: CustomStep) => void;
}) {
  const grid = 'grid gap-3 sm:grid-cols-2';
  switch (step.kind) {
    case 'rename':
      return (
        <div className={grid}>
          <ColumnInput label="Column" value={step.column} columnList={columnList} onChange={(column) => onChange({ ...step, column })} />
          <Field label="New name">
            <input value={step.to} onChange={(event) => onChange({ ...step, to: event.target.value })} className={FIELD} />
          </Field>
        </div>
      );
    case 'drop_columns':
      return (
        <ChipsInput
          label="Columns to drop"
          values={step.columns}
          onChange={(next) => onChange({ ...step, columns: next })}
          suggestions={columns}
          placeholder="column name"
        />
      );
    case 'replace_values':
      return (
        <div className="space-y-2">
          <div className={grid}>
            <ColumnInput label="Column" value={step.column} columnList={columnList} onChange={(column) => onChange({ ...step, column })} />
            <label className="flex items-center gap-2 self-end pb-1.5">
              <input
                type="checkbox"
                checked={step.ignore_case}
                onChange={(event) => onChange({ ...step, ignore_case: event.target.checked })}
              />
              Ignore upper and lower case
            </label>
          </div>
          <p className="text-slate-500">
            Matched against the value as silver shows it (a yes/no column reads true/false). Leave “becomes” empty to
            empty the value.
          </p>
          {step.mapping.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                aria-label={`Value ${index + 1} to replace`}
                value={entry.from}
                onChange={(event) =>
                  onChange({
                    ...step,
                    mapping: step.mapping.map((item, i) => (i === index ? { ...item, from: event.target.value } : item)),
                  })
                }
                placeholder="M."
                className={`${FIELD} w-36`}
              />
              <span className="text-slate-600">becomes</span>
              <input
                aria-label={`Replacement ${index + 1}`}
                value={entry.to ?? ''}
                onChange={(event) =>
                  onChange({
                    ...step,
                    mapping: step.mapping.map((item, i) => (i === index ? { ...item, to: event.target.value } : item)),
                  })
                }
                placeholder="(empty)"
                className={`${FIELD} w-36`}
              />
              <IconButton
                label={`Remove replacement ${index + 1}`}
                onClick={
                  step.mapping.length > 1
                    ? () => onChange({ ...step, mapping: step.mapping.filter((_, i) => i !== index) })
                    : undefined
                }
              >
                <X size={13} />
              </IconButton>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...step, mapping: [...step.mapping, { from: '', to: '' }] })}
            className="text-brand-300 hover:text-brand-200"
          >
            + Another value
          </button>
        </div>
      );
    case 'fill_nulls':
      return (
        <div className={grid}>
          <ColumnInput label="Column" value={step.column} columnList={columnList} onChange={(column) => onChange({ ...step, column })} />
          <Field label="Fill with">
            <input value={step.value} onChange={(event) => onChange({ ...step, value: event.target.value })} className={FIELD} />
          </Field>
        </div>
      );
    case 'convert_units':
      return (
        <div className={grid}>
          <ColumnInput label="Column" value={step.column} columnList={columnList} onChange={(column) => onChange({ ...step, column })} />
          <Field label="Conversion">
            <select
              value={UNIT_PRESETS.find((preset) => preset.factor === step.factor && preset.offset === step.offset)?.label ?? ''}
              onChange={(event) => {
                const preset = UNIT_PRESETS.find((entry) => entry.label === event.target.value);
                if (preset)
                  onChange({ ...step, factor: preset.factor, offset: preset.offset, from_unit: preset.from, to_unit: preset.to });
              }}
              className={FIELD}
            >
              <option value="">Custom factor</option>
              {UNIT_PRESETS.map((preset) => (
                <option key={preset.label} value={preset.label}>
                  {preset.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Multiply by">
            <input
              type="number"
              step="any"
              value={step.factor}
              onChange={(event) => onChange({ ...step, factor: Number(event.target.value) })}
              className={FIELD}
            />
          </Field>
          <Field label="Then add">
            <input
              type="number"
              step="any"
              value={step.offset}
              onChange={(event) => onChange({ ...step, offset: Number(event.target.value) })}
              className={FIELD}
            />
          </Field>
          <Expression
            label="Only where (optional)"
            value={step.when}
            onChange={(when) => onChange({ ...step, when })}
            placeholder="weight_unit = 'lb'"
          />
        </div>
      );
    case 'parse_dates':
      return (
        <div className={grid}>
          <ColumnInput label="Column" value={step.column} columnList={columnList} onChange={(column) => onChange({ ...step, column })} />
          <Field label="Written as">
            <input
              list="date-formats"
              value={step.format}
              onChange={(event) => onChange({ ...step, format: event.target.value })}
              className={`${FIELD} font-display`}
            />
            <datalist id="date-formats">
              {DATE_FORMATS.map((format) => (
                <option key={format} value={format} />
              ))}
            </datalist>
          </Field>
          <Field label="Read as">
            <select
              value={step.as}
              onChange={(event) => onChange({ ...step, as: event.target.value as 'date' | 'timestamp' })}
              className={FIELD}
            >
              <option value="date">date</option>
              <option value="timestamp">date and time</option>
            </select>
          </Field>
          <p className="self-end pb-1.5 text-slate-500">
            %d day, %m month, %Y four-digit year, %H:%M time. All or nothing: if any value does not match, the column is
            left as it was and the misses are flagged.
          </p>
        </div>
      );
    case 'split_column':
      return (
        <div className={grid}>
          <ColumnInput label="Column" value={step.column} columnList={columnList} onChange={(column) => onChange({ ...step, column })} />
          <Field label="Separator">
            <input
              value={step.separator}
              onChange={(event) => onChange({ ...step, separator: event.target.value })}
              className={`${FIELD} w-24 font-display`}
            />
          </Field>
          <div className="sm:col-span-2">
            <ChipsInput
              label="New columns, in order"
              values={step.into}
              onChange={(into) => onChange({ ...step, into })}
              placeholder="systolic, diastolic"
            />
          </div>
        </div>
      );
    case 'validate':
      return (
        <div className={grid}>
          <Expression
            label="Every row should satisfy"
            value={step.condition}
            onChange={(condition) => onChange({ ...step, condition })}
            placeholder="discharge_date >= admission_date"
          />
          <fieldset className="flex flex-wrap gap-4 sm:col-span-2">
            <legend className="sr-only">What happens to a row that fails</legend>
            <label className="flex items-center gap-2">
              <input type="radio" checked={step.action === 'flag'} onChange={() => onChange({ ...step, action: 'flag' })} />
              Flag it and keep it
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={step.action === 'drop'} onChange={() => onChange({ ...step, action: 'drop' })} />
              Remove it <span className="text-amber-300">— loses those rows</span>
            </label>
          </fieldset>
          <p className="text-slate-500 sm:col-span-2">
            A row the condition cannot answer — a null in a column it reads — is not counted against it.
          </p>
        </div>
      );
    case 'compute':
      return (
        <div className={grid}>
          <ColumnInput
            label="Column to write (new or existing)"
            value={step.column}
            columnList={columnList}
            onChange={(column) => onChange({ ...step, column })}
          />
          <div />
          <Expression
            label="Value"
            value={step.expression}
            onChange={(expression) => onChange({ ...step, expression })}
            placeholder="round(weight_kg / (height_cm / 100) ^ 2, 1)"
          />
        </div>
      );
  }
}
