import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CleaningRecipeEditor from '../../src/components/cleaning/CleaningRecipeEditor';
import ChipsInput from '../../src/components/cleaning/ChipsInput';
import {
  describeNormalization,
  lossyWarnings,
  patternLabel,
  recipeProblem,
  sameRecipe,
  sendable,
} from '../../src/components/cleaning/recipe';
import type { CleaningRecipe, CleaningRecipeState, CleaningSteps, LayerStream } from '../../src/types';

const getCleaningRecipe = vi.fn();
const saveCleaningRecipe = vi.fn();
const previewCleaning = vi.fn();
const previewLayer = vi.fn();
const recleanSource = vi.fn();

vi.mock('../../src/api/client', () => ({
  getCleaningRecipe: (...a: unknown[]) => getCleaningRecipe(...a),
  saveCleaningRecipe: (...a: unknown[]) => saveCleaningRecipe(...a),
  previewCleaning: (...a: unknown[]) => previewCleaning(...a),
  previewLayer: (...a: unknown[]) => previewLayer(...a),
  recleanSource: (...a: unknown[]) => recleanSource(...a),
}));

const STANDARD: CleaningRecipe = {
  disabled: [],
  null_tokens: ['', 'n/a', 'null'],
  keep_as_text: [],
  force_types: {},
  dedupe_on: [],
  categorical_max_distinct: 60,
  fold_skip: [],
  sex_columns: null,
  ranges: [{ unit: 'bpm', low: 20, high: 300, pattern: 'heart_rate' }],
  normalize: null,
};

function state(overrides: Partial<CleaningRecipeState> = {}): CleaningRecipeState {
  return {
    source_id: 3,
    mode: 'standard',
    recipe: STANDARD,
    standard: STANDARD,
    rules: [
      { name: 'trim_whitespace', tier: 'structural', title: 'Whitespace normalised', summary: 'Trims.' },
      { name: 'sentinel_nulls', tier: 'structural', title: 'Placeholders to null', summary: 'n/a → null.' },
      { name: 'cast_types', tier: 'structural', title: 'Types applied', summary: 'Casts.' },
      { name: 'deduplicate_rows', tier: 'structural', title: 'Duplicate rows removed', summary: 'Dedupes.' },
      { name: 'fold_categories', tier: 'categorical', title: 'Categories unified', summary: 'Folds.' },
      { name: 'flag_implausible_measurements', tier: 'domain', title: 'Implausible values', summary: 'Flags.' },
    ],
    forceable_types: ['string', 'integer', 'decimal', 'boolean', 'date', 'timestamp'],
    lossy: [],
    normalize_default: { mode: 'off', text_column: '', code_column: '', min_confidence: 0.82 },
    normalize_modes: ['off', 'suggest', 'fill'],
    runs: 0,
    stale_runs: 0,
    reclean: {},
    ...overrides,
  };
}

const STREAMS: LayerStream[] = [
  { source_id: 3, source_name: 'encounters', relation: 'encounters', objects: 1, rows: 10, size_bytes: 100 },
  { source_id: null, source_name: 'legacy', relation: 'legacy', objects: 1, rows: 1, size_bytes: 10 },
];

const PREVIEW: CleaningSteps = {
  run_id: 'run-1',
  source_id: 3,
  rows_in: 4,
  rows_out: 4,
  sample: 8,
  preview: true,
  lossy: [],
  steps: [
    {
      rule: 'trim_whitespace',
      title: 'Whitespace normalised',
      tier: 'structural',
      cells_changed: 0,
      rows_removed: 0,
      columns_removed: 0,
      flagged: 0,
      note: 'Turned off in this source\'s cleaning recipe.',
      columns: [],
      changed: false,
      skipped: true,
      preview_columns: [],
      preview_rows: [],
    },
  ],
};

function renderEditor(streams = STREAMS) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CleaningRecipeEditor projectId={7} streams={streams} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getCleaningRecipe.mockResolvedValue(state());
  previewLayer.mockResolvedValue({ columns: [{ name: 'patient_id' }, { name: 'heart_rate' }], rows: [] });
});

describe('recipe helpers', () => {
  it('names only the options that lose data, and not when their rule is off', () => {
    expect(lossyWarnings(STANDARD)).toEqual([]);
    const lossy = { ...STANDARD, force_types: { age: 'integer', code: 'string' }, dedupe_on: ['patient_id'] };
    const warnings = lossyWarnings(lossy);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('age → integer');
    expect(warnings[0]).not.toContain('code');
    expect(warnings[1]).toContain('patient_id');
    expect(lossyWarnings({ ...lossy, disabled: ['cast_types', 'deduplicate_rows'] })).toEqual([]);
  });

  it('does not count reordering as a change', () => {
    expect(sameRecipe({ ...STANDARD, null_tokens: ['null', '', 'n/a'] }, STANDARD)).toBe(true);
    expect(sameRecipe({ ...STANDARD, null_tokens: ['-'] }, STANDARD)).toBe(false);
  });

  it('refuses coding without two different columns', () => {
    const coding = (text: string, code: string) => ({
      ...STANDARD,
      normalize: { mode: 'fill' as const, text_column: text, code_column: code, min_confidence: 0.82 },
    });
    expect(recipeProblem(STANDARD)).toBeNull();
    expect(recipeProblem(coding('procedure', ''))).toMatch(/Choose/);
    expect(recipeProblem(coding('Code', 'code'))).toMatch(/different/);
    expect(recipeProblem(coding('procedure', 'code'))).toBeNull();
  });

  it('says what coding did, or why it could not', () => {
    expect(describeNormalization(undefined)).toBeNull();
    expect(describeNormalization({})).toBeNull();
    expect(describeNormalization({ error: 'no column called code' })).toMatch(/could not be completed: no column/);
    expect(describeNormalization({ mode: 'fill', column: 'code', filled: 5, unresolved: 0 })).toMatch(
      /5 filled in into code/,
    );
  });

  it('reads a built-in name pattern as the names it matches', () => {
    expect(patternLabel('(^|_)(heart_rate|pulse|hr)(_|$)')).toBe('heart_rate, pulse, hr');
    expect(patternLabel('^custom.*$')).toBe('^custom.*$');
  });

  it('leaves out a range not yet pointed at a column', () => {
    const draft = { ...STANDARD, ranges: [{ column: ' ', unit: '', low: 0, high: 1 }, ...STANDARD.ranges] };
    expect(sendable(draft).ranges).toEqual(STANDARD.ranges);
  });
});

describe('ChipsInput', () => {
  it('adds on Enter and comma, ignores repeats, removes by button and Backspace', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<ChipsInput label="Tokens" values={['n/a']} onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: 'Tokens' });

    await userEvent.type(input, '-{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['n/a', '-']);
    await userEvent.type(input, 'n/a,');
    expect(onChange).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Remove n/a' }));
    expect(onChange).toHaveBeenLastCalledWith([]);

    rerender(<ChipsInput label="Tokens" values={['a', 'b']} onChange={onChange} />);
    await userEvent.type(input, '{Backspace}');
    expect(onChange).toHaveBeenLastCalledWith(['a']);
  });
});

describe('CleaningRecipeEditor', () => {
  it('starts from the standard, with every rule on', async () => {
    renderEditor();
    expect(await screen.findByText('Platform standard')).toBeInTheDocument();
    expect(getCleaningRecipe).toHaveBeenCalledWith(3);
    for (const box of screen.getAllByRole('checkbox')) expect(box).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save recipe' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Back to the standard/ })).not.toBeInTheDocument();
  });

  it('turns a rule off and saves it', async () => {
    getCleaningRecipe.mockResolvedValue(state({ runs: 2 }));
    saveCleaningRecipe.mockResolvedValue(
      state({ mode: 'custom', recipe: { ...STANDARD, disabled: ['trim_whitespace'] }, runs: 2, stale_runs: 2 }),
    );
    renderEditor();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Run "Whitespace normalised"' }));
    expect(screen.getByText('Standard, with unsaved changes')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save recipe' }));
    await waitFor(() =>
      expect(saveCleaningRecipe).toHaveBeenCalledWith(3, { recipe: { ...STANDARD, disabled: ['trim_whitespace'] } }),
    );
    expect(await screen.findByText('Custom recipe')).toBeInTheDocument();
    // What is already in silver was made the old way, and the editor says so.
    expect(screen.getByText(/2 of 2 extraction\(s\) in silver were cleaned with a different recipe/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clean silver again' })).toBeEnabled();
  });

  it('warns while a lossy option is being set', async () => {
    renderEditor();
    const row = (await screen.findByText('Duplicate rows removed')).closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: /Options/ }));
    await userEvent.click(within(row).getByRole('radio', { name: /match on these key columns/ }));
    // With column suggestions the input is a combobox.
    await userEvent.type(within(row).getByRole('combobox', { name: 'Key columns' }), 'patient_id{Enter}');

    const warnings = screen.getByRole('list', { name: 'Lossy options' });
    expect(warnings).toHaveTextContent('Duplicates by key (patient_id)');
  });

  it('forces a type on a column', async () => {
    renderEditor();
    const row = (await screen.findByText('Types applied')).closest('li')!;
    await userEvent.click(within(row).getByRole('button', { name: /Options/ }));
    await userEvent.type(within(row).getByRole('combobox', { name: 'Column to force' }), 'age');
    await userEvent.click(within(row).getByRole('button', { name: 'Force type' }));

    expect(within(row).getByRole('combobox', { name: 'Type forced on age' })).toHaveValue('integer');
    expect(screen.getByRole('list', { name: 'Lossy options' })).toHaveTextContent('age → integer');
  });

  it('tries the draft without saving it', async () => {
    previewCleaning.mockResolvedValue(PREVIEW);
    renderEditor();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Run "Whitespace normalised"' }));
    await userEvent.click(screen.getByRole('button', { name: 'Try it on the latest extraction' }));

    await waitFor(() =>
      expect(previewCleaning).toHaveBeenCalledWith(7, 3, { ...STANDARD, disabled: ['trim_whitespace'] }),
    );
    const preview = await screen.findByRole('region', { name: 'Preview' });
    expect(within(preview).getByText('turned off')).toBeInTheDocument();
    expect(saveCleaningRecipe).not.toHaveBeenCalled();
  });

  it('discards changes and goes back to the standard', async () => {
    getCleaningRecipe.mockResolvedValue(state({ mode: 'custom', recipe: { ...STANDARD, fold_skip: ['code'] } }));
    saveCleaningRecipe.mockResolvedValue(state());
    renderEditor();

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Run "Whitespace normalised"' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByRole('checkbox', { name: 'Run "Whitespace normalised"' })).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: /Back to the standard/ }));
    await waitFor(() => expect(saveCleaningRecipe).toHaveBeenCalledWith(3, { reset: true }));
    expect(await screen.findByText('Platform standard')).toBeInTheDocument();
  });

  it('shows the save error instead of losing the draft', async () => {
    saveCleaningRecipe.mockRejectedValue(new Error("a range's low (5) must be below its high (1)"));
    renderEditor();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Run "Whitespace normalised"' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save recipe' }));

    expect(await screen.findByText(/must be below its high/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Run "Whitespace normalised"' })).not.toBeChecked();
  });

  it('cleans silver again and follows it until it is done', async () => {
    getCleaningRecipe.mockResolvedValue(state({ mode: 'custom', runs: 3, stale_runs: 1 }));
    recleanSource.mockResolvedValue(
      state({ mode: 'custom', runs: 3, stale_runs: 1, reclean: { status: 'queued' } }),
    );
    renderEditor();

    await userEvent.click(await screen.findByRole('button', { name: 'Clean silver again' }));

    expect(recleanSource).toHaveBeenCalledWith(3);
    expect(await screen.findByRole('status')).toHaveTextContent('Cleaning silver again');
  });

  it('does not clean silver again with unsaved changes', async () => {
    getCleaningRecipe.mockResolvedValue(state({ mode: 'custom', runs: 3, stale_runs: 1 }));
    renderEditor();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Run "Whitespace normalised"' }));

    expect(screen.getByRole('button', { name: 'Clean silver again' })).toBeDisabled();
  });

  it('says when the last attempt failed and changed nothing', async () => {
    getCleaningRecipe.mockResolvedValue(
      state({ runs: 1, stale_runs: 1, reclean: { status: 'failed', error: 'a rule broke' } }),
    );
    renderEditor();

    expect(await screen.findByText(/failed and changed nothing: a rule broke/)).toBeInTheDocument();
  });

  it('asks for both columns before coding, then saves the settings', async () => {
    saveCleaningRecipe.mockResolvedValue(state({ mode: 'custom' }));
    renderEditor();
    await userEvent.click(await screen.findByRole('radio', { name: /^Suggest/ }));

    expect(screen.getByText('Choose the text column and the code column to code.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save recipe' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Try it on the latest extraction' })).toBeDisabled();

    await userEvent.type(screen.getByRole('combobox', { name: 'Text column' }), 'procedure');
    await userEvent.type(screen.getByRole('combobox', { name: 'Code column' }), 'code');
    await userEvent.click(screen.getByRole('button', { name: 'Save recipe' }));

    await waitFor(() =>
      expect(saveCleaningRecipe).toHaveBeenCalledWith(3, {
        recipe: {
          ...STANDARD,
          normalize: { mode: 'suggest', text_column: 'procedure', code_column: 'code', min_confidence: 0.82 },
        },
      }),
    );
  });

  it('starts from the pair the source was registered with', async () => {
    getCleaningRecipe.mockResolvedValue(
      state({ normalize_default: { mode: 'fill', text_column: 'procedure', code_column: 'code', min_confidence: 0.82 } }),
    );
    renderEditor();

    expect(await screen.findByText(/codes from procedure written to code/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /^Fill/ }));
    expect(screen.getByRole('combobox', { name: 'Text column' })).toHaveValue('procedure');
  });

  it('shows what coding would do in the preview', async () => {
    previewCleaning.mockResolvedValue({
      ...PREVIEW,
      normalization: { mode: 'suggest', column: 'code_suggested', filled: 2, unresolved: 1, already_coded: 3, vocabulary_size: 2 },
    });
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: 'Try it on the latest extraction' }));

    const preview = await screen.findByRole('region', { name: 'Preview' });
    expect(preview).toHaveTextContent('Codes: 2 suggested into code_suggested, 1 left empty, 3 already coded');
  });

  it('renders nothing when no stream belongs to a source', () => {
    const { container } = renderEditor([STREAMS[1]]);
    expect(container).toBeEmptyDOMElement();
  });
});
