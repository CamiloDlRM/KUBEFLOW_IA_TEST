import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { TriangleAlert, X } from 'lucide-react';
import { API_BASE, predict } from '../../api/client';
import type { ModelCard, ModelDeployment, ModelEffect, ModelInput, PredictionResult } from '../../types';
import Spinner from '../Spinner';
import EffectStrip from './EffectStrip';
import { classColor, formatValue } from './effects';

/**
 * Ask a deployed model a question, knowing what it expects.
 *
 * The form is built from the model's card: one field per input, in the order
 * the model takes them, each starting at its typical training value and
 * showing the range the model saw. Under each, the input's effect strip says
 * what the model answered across that range in training, so a value can be
 * chosen to land in a particular answer — and a value outside the range is
 * flagged as the extrapolation it is.
 *
 * When the notebook wrote notes, each input also says what it is and in what
 * unit, the header says what the model predicts, and each answer says what it
 * means. The API section spells out the request and response for calling the
 * model from outside, position by position.
 *
 * A model with no card — trained before cards, or by a notebook that wrote no
 * features — gets the raw JSON editor and a line on how to give it one.
 */
export default function TestModelModal({ model, onClose }: { model: ModelDeployment; onClose: () => void }) {
  const card: ModelCard = model.model_card ?? {};
  const inputs = card.inputs ?? [];
  const described = inputs.length > 0 && inputs.every((input) => input.type);

  const [values, setValues] = useState<string[]>(() =>
    inputs.map((input, index) => {
      const typical = card.baseline?.values[index] ?? input.median ?? '';
      // A median is 37.208396 minutes; nobody types that, and it is no truer than 37.21.
      return typeof typical === 'number' ? String(Number(typical.toFixed(2))) : String(typical);
    }),
  );
  const [raw, setRaw] = useState(!described);
  const [json, setJson] = useState(() =>
    JSON.stringify({ data: [described ? card.baseline?.values ?? [] : []] }, null, 2),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  const numbers = values.map((value) => (value.trim() === '' ? NaN : Number(value)));
  const formReady = numbers.every((value) => Number.isFinite(value));

  const mutation = useMutation({
    mutationFn: (payload: unknown) => predict(model.model_name, payload),
  });

  function send() {
    setJsonError(null);
    if (!raw) {
      mutation.mutate({ data: [numbers] });
      return;
    }
    try {
      mutation.mutate(JSON.parse(json));
    } catch {
      setJsonError('Invalid JSON payload.');
    }
  }

  const effects = useMemo(
    () => Object.fromEntries((card.effects ?? []).map((effect) => [effect.input, effect])),
    [card.effects],
  );
  // The legend lists only the classes some strip actually shows.
  const shown = useMemo(() => {
    const seen = new Set<string>();
    for (const effect of card.effects ?? []) {
      for (const segment of effect.segments ?? []) seen.add(String(segment.prediction));
    }
    return (card.classes ?? []).filter((label) => seen.has(String(label)));
  }, [card.effects, card.classes]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={`Test ${model.model_name}`}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Test: {model.model_name}</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              v{model.version}
              {described &&
                ` · ${card.kind ?? 'model'} trained on ${(card.rows ?? 0).toLocaleString('en-US')} rows · ${
                  inputs.length
                } inputs, sent in this order`}
            </p>
            {card.target && (
              <p className="mt-1 text-xs text-slate-300">
                Predicts <span className="font-display text-slate-100">{card.target.name}</span>
                {card.target.description && ` — ${card.target.description}`}
              </p>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {!described && (
            <p className="rounded-lg border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs leading-relaxed text-amber-200">
              <TriangleAlert size={13} className="mr-1 inline align-[-2px]" aria-hidden="true" />
              {card.note ||
                "This model's run did not record its training features, so its inputs cannot be described."}{' '}
              To get the guide, write the frame the model was fitted on in the notebook's export cell —{' '}
              <code className="font-display text-amber-100">X_train.to_parquet(TRAINING_FEATURES_PATH)</code> — and
              run the pipeline again. Until then, send one number per input, in the order it was trained on.
            </p>
          )}

          {described && (
            <section aria-label="Inputs" className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">What to send</h4>
                {shown.length > 1 && (
                  <ul aria-label="Answers" className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-300">
                    {shown.map((label) => (
                      <li
                        key={String(label)}
                        title={card.class_notes?.[String(label)]}
                        className="flex items-center gap-1.5"
                      >
                        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: classColor(card.classes, label) }} />
                        {String(label)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {card.class_notes && (
                <details className="text-[11px] text-slate-400">
                  <summary className="cursor-pointer select-none text-slate-300 hover:text-slate-100">
                    What each answer means
                  </summary>
                  <dl className="mt-1.5 grid gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
                    {(card.classes ?? [])
                      .filter((label) => card.class_notes?.[String(label)])
                      .map((label) => (
                        <div key={String(label)} className="contents">
                          <dt className="flex items-center gap-1.5 font-display text-slate-200">
                            <span aria-hidden="true" className="h-2 w-2 rounded-sm" style={{ background: classColor(card.classes, label) }} />
                            {String(label)}
                          </dt>
                          <dd>{card.class_notes?.[String(label)]}</dd>
                        </div>
                      ))}
                  </dl>
                </details>
              )}
              <p className="text-[11px] leading-relaxed text-slate-500">
                Each strip splits the training rows by that input, sized by how many rows fall in each range; the colour
                is what the model answered for most of them. It shows what goes together in the data, not what one input
                does on its own — <span className="text-slate-300">Send</span> asks the model itself.
              </p>
              <ol className="space-y-4">
                {inputs.map((input, index) => (
                  <InputRow
                    key={input.name}
                    index={index}
                    input={input}
                    value={values[index] ?? ''}
                    disabled={raw}
                    effect={effects[input.name]}
                    classes={card.classes}
                    onChange={(next) => setValues((current) => current.map((v, i) => (i === index ? next : v)))}
                  />
                ))}
              </ol>
            </section>
          )}

          <section aria-label="Request" className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Request</h4>
              {described && (
                <button
                  type="button"
                  onClick={() => {
                    if (!raw) setJson(JSON.stringify({ data: [numbers] }, null, 2));
                    setRaw(!raw);
                  }}
                  className="text-[11px] text-brand-400 hover:text-brand-300"
                >
                  {raw ? 'Use the form' : 'Edit as JSON (several rows)'}
                </button>
              )}
            </div>
            {raw ? (
              <textarea
                aria-label="JSON payload"
                value={json}
                onChange={(event) => setJson(event.target.value)}
                rows={5}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-display text-xs text-slate-200 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            ) : (
              <pre className="overflow-x-auto rounded-lg bg-slate-950 px-3 py-2 font-display text-xs text-slate-300">
                {JSON.stringify({ data: [numbers.map((n) => (Number.isFinite(n) ? n : null))] })}
              </pre>
            )}
            {jsonError && <p className="text-xs text-red-400">{jsonError}</p>}
          </section>

          {described && <ApiReference model={model} card={card} row={numbers} />}

          {mutation.isError && (
            <p className="rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs text-red-300">
              {(mutation.error as Error).message}
            </p>
          )}
          {mutation.isSuccess && <Answer result={mutation.data} classes={card.classes} />}
        </div>

        <footer className="flex justify-end gap-3 border-t border-slate-800 px-5 py-3">
          <button onClick={onClose} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">
            Close
          </button>
          <button
            onClick={send}
            disabled={mutation.isPending || (!raw && !formReady)}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {mutation.isPending && <Spinner size="sm" />}
            Send request
          </button>
        </footer>
      </div>
    </div>
  );
}

function InputRow({
  index,
  input,
  value,
  disabled,
  effect,
  classes,
  onChange,
}: {
  index: number;
  input: ModelInput;
  value: string;
  disabled: boolean;
  effect: ModelEffect | undefined;
  classes: (string | number)[] | undefined;
  onChange: (value: string) => void;
}) {
  const id = `model-input-${index}`;
  const number = value.trim() === '' ? null : Number(value);
  const outside =
    number !== null &&
    Number.isFinite(number) &&
    input.min != null &&
    input.max != null &&
    (number < input.min || number > input.max);

  return (
    <li className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_9rem]">
      <div className="min-w-0">
        <label htmlFor={id} className="flex items-baseline gap-2">
          <span aria-hidden="true" className="font-display text-[11px] text-slate-500">{index + 1}</span>
          <span className="truncate font-display text-sm text-slate-100">{input.name}</span>
          {input.unit && (
            <span className="shrink-0 rounded bg-slate-800 px-1.5 py-px text-[10px] text-slate-300">{input.unit}</span>
          )}
        </label>
        {input.description && <p className="text-xs text-slate-300">{input.description}</p>}
        <p className="text-[11px] text-slate-500">
          {input.type === 'number'
            ? `number · trained on ${formatValue(input.min)} – ${formatValue(input.max)} · typical ${formatValue(
                input.median as number,
              )}`
            : `one of ${input.values?.slice(0, 5).join(', ')}${(input.values?.length ?? 0) > 5 ? '…' : ''}`}
          {input.missing ? ` · ${Math.round(input.missing * 100)}% missing in training` : ''}
        </p>
      </div>
      <input
        id={id}
        type="number"
        step="any"
        inputMode="decimal"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`h-9 w-full rounded-lg border bg-slate-950 px-3 font-display text-sm text-slate-100 focus:outline-none focus:ring-1 disabled:opacity-40 ${
          outside ? 'border-amber-600 focus:ring-amber-500' : 'border-slate-700 focus:border-brand-500 focus:ring-brand-500'
        }`}
      />
      {effect && (
        <div className="sm:col-span-2">
          <EffectStrip effect={effect} classes={classes} value={number !== null && Number.isFinite(number) ? number : null} />
        </div>
      )}
      {outside && (
        <p className="text-[11px] text-amber-300 sm:col-span-2">
          <TriangleAlert size={12} className="mr-1 inline align-[-2px]" aria-hidden="true" />
          Outside what the model saw in training ({formatValue(input.min)} – {formatValue(input.max)}): its answer here is
          extrapolation, not something it learned.
        </p>
      )}
    </li>
  );
}

function Answer({ result, classes }: { result: PredictionResult; classes: (string | number)[] | undefined }) {
  const rows = result.prediction;
  const probabilities = result.probabilities ?? [];
  return (
    <section aria-label="Answer" className="space-y-3 rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-3">
      {rows.map((prediction, index) => {
        const ranked = Object.entries(probabilities[index] ?? {}).sort(([, a], [, b]) => b - a);
        return (
          <div key={index} className="space-y-2">
            <p className="flex items-center gap-2 text-sm text-slate-300">
              {rows.length > 1 && <span className="font-display text-[11px] text-slate-500">row {index + 1}</span>}
              <span aria-hidden="true" className="h-3 w-3 rounded-sm" style={{ background: classColor(classes, prediction) }} />
              <span className="text-base font-semibold text-slate-100">{String(prediction)}</span>
              {ranked.length > 0 && (
                <span className="text-xs text-slate-500">{Math.round(ranked[0][1] * 100)}% sure</span>
              )}
            </p>
            {ranked.length > 1 && index === 0 && (
              <ul aria-label="Probability per class" className="space-y-1">
                {ranked.slice(0, 6).map(([label, p]) => (
                  <li key={label} className="grid grid-cols-[7rem_minmax(0,1fr)_3rem] items-center gap-2 text-[11px]">
                    <span className="truncate text-slate-300">{label}</span>
                    <span className="h-2 rounded-sm bg-slate-800">
                      <span
                        className="block h-full rounded-sm"
                        style={{ width: `${Math.max(p * 100, 0.5)}%`, background: classColor(classes, label) }}
                      />
                    </span>
                    <span className="text-right font-display tabular-nums text-slate-400">{(p * 100).toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <details className="text-[11px] text-slate-500">
        <summary className="cursor-pointer select-none hover:text-slate-300">Raw response</summary>
        <pre className="mt-1 overflow-x-auto font-display text-slate-400">{JSON.stringify(result, null, 2)}</pre>
      </details>
    </section>
  );
}

/**
 * How to call the model from outside the platform: the exact shape of the
 * request, what each position in a row is, and what comes back.
 *
 * The model takes rows of plain numbers with no names — position is the only
 * thing that says which number is which — so the positions are spelled out.
 */
function ApiReference({ model, card, row }: { model: ModelDeployment; card: ModelCard; row: number[] }) {
  const inputs = card.inputs ?? [];
  const url = `${API_BASE}/models/${model.model_name}/predict`;
  const example = JSON.stringify({ data: [row.map((n) => (Number.isFinite(n) ? n : 0))] });
  const curl = `curl -X POST ${url} \\
  -H "Authorization: Bearer <your token>" \\
  -H "Content-Type: application/json" \\
  -d '${example}'`;
  const classes = (card.classes ?? []).map(String);

  return (
    <details aria-label="API" className="rounded-lg border border-slate-800 bg-slate-950/40">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200">
        Call it from code
      </summary>
      <div className="space-y-3 border-t border-slate-800 px-3 py-3 text-[11px] text-slate-400">
        <p>
          <span className="font-display text-slate-200">POST {url}</span> with a JSON body: <code className="text-slate-200">data</code> is
          a list of rows, and each row is {inputs.length} numbers in this order. Several rows are answered in one call.
        </p>
        <table className="w-full border-separate border-spacing-0 font-display">
          <thead>
            <tr className="text-left text-slate-500">
              <th scope="col" className="border-b border-slate-800 py-1 pr-3 font-normal">#</th>
              <th scope="col" className="border-b border-slate-800 py-1 pr-3 font-normal">field</th>
              <th scope="col" className="border-b border-slate-800 py-1 pr-3 font-normal">type</th>
              <th scope="col" className="border-b border-slate-800 py-1 font-normal">seen in training</th>
            </tr>
          </thead>
          <tbody>
            {inputs.map((input, index) => (
              <tr key={input.name} className="text-slate-300">
                <td className="py-1 pr-3 text-slate-500">{index}</td>
                <td className="py-1 pr-3">{input.name}</td>
                <td className="py-1 pr-3">number{input.unit ? ` (${input.unit})` : ''}</td>
                <td className="py-1">
                  {input.type === 'number' ? `${formatValue(input.min)} – ${formatValue(input.max)}` : input.values?.join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          The answer has one entry per row in <code className="text-slate-200">prediction</code>
          {card.target ? <> — a value of <span className="text-slate-200">{card.target.name}</span></> : null}
          {classes.length > 0 && (
            <>
              , one of <span className="text-slate-200">{classes.join(', ')}</span>
            </>
          )}
          {card.kind === 'classifier' && (
            <>
              . <code className="text-slate-200">probabilities</code> gives, per row, each class's probability from 0 to 1
            </>
          )}
          .
        </p>
        <pre className="overflow-x-auto rounded bg-slate-950 px-3 py-2 text-slate-300">{curl}</pre>
      </div>
    </details>
  );
}
