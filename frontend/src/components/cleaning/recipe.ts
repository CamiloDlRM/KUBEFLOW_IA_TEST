import type {
  CleaningRecipe,
  CustomStep,
  CustomStepKind,
  NormalizationResult,
  NormalizeSettings,
} from '../../types';

/** Each kind of rule, as the "add a rule" menu offers it. */
export const STEP_KINDS: { kind: CustomStepKind; label: string; hint: string }[] = [
  { kind: 'rename', label: 'Rename a column', hint: 'Give a column the name your notebook expects.' },
  { kind: 'drop_columns', label: 'Drop columns', hint: 'Remove columns silver should not carry.' },
  { kind: 'replace_values', label: 'Replace values', hint: 'Map spellings or codes onto the ones you use.' },
  { kind: 'fill_nulls', label: 'Fill empty values', hint: 'Write a fixed value where a column is empty.' },
  { kind: 'convert_units', label: 'Convert units', hint: 'Multiply and shift, optionally only on some rows.' },
  { kind: 'parse_dates', label: 'Read dates in a format', hint: 'For dates written like 03/02/2024.' },
  { kind: 'split_column', label: 'Split a column', hint: 'For values like 120/80; the original is kept.' },
  { kind: 'validate', label: 'Check a condition', hint: 'Flag or drop the rows that fail it.' },
  { kind: 'compute', label: 'Compute a column', hint: 'A new or rewritten column from an expression.' },
];

/** A new rule of ``kind``, empty where the person has to choose. */
export function newStep(kind: CustomStepKind): CustomStep {
  switch (kind) {
    case 'rename':
      return { kind, label: '', column: '', to: '' };
    case 'drop_columns':
      return { kind, label: '', columns: [] };
    case 'replace_values':
      return { kind, label: '', column: '', mapping: [{ from: '', to: '' }], ignore_case: false };
    case 'fill_nulls':
      return { kind, label: '', column: '', value: '' };
    case 'convert_units':
      return { kind, label: '', column: '', factor: 1, offset: 0, when: '', from_unit: '', to_unit: '' };
    case 'parse_dates':
      return { kind, label: '', column: '', format: '%d/%m/%Y', as: 'date' };
    case 'split_column':
      return { kind, label: '', column: '', separator: '/', into: [] };
    case 'validate':
      return { kind, label: '', condition: '', action: 'flag' };
    case 'compute':
      return { kind, label: '', column: '', expression: '' };
  }
}

/** The rule's name: the person's, or one made from what it does. Mirrors CustomStep.title. */
export function stepTitle(step: CustomStep): string {
  if (step.label.trim()) return step.label.trim();
  switch (step.kind) {
    case 'rename':
      return `Rename ${step.column || '…'} → ${step.to || '…'}`;
    case 'drop_columns':
      return `Drop ${step.columns.join(', ') || '…'}`;
    case 'replace_values':
      return `Replace values in ${step.column || '…'}`;
    case 'fill_nulls':
      return `Fill empty ${step.column || '…'} with '${step.value}'`;
    case 'convert_units':
      return `Convert ${step.column || '…'}${step.from_unit && step.to_unit ? ` from ${step.from_unit} to ${step.to_unit}` : ''}`;
    case 'parse_dates':
      return `Read ${step.column || '…'} as ${step.as}s (${step.format})`;
    case 'split_column':
      return `Split ${step.column || '…'} into ${step.into.join(', ') || '…'}`;
    case 'validate':
      return `Check ${step.condition || '…'}${step.action === 'drop' ? ' — failing rows removed' : ''}`;
    case 'compute':
      return `Compute ${step.column || '…'} = ${step.expression || '…'}`;
  }
}

/** What a rule can lose, in words, or null. Mirrors CustomStep.lossy. */
export function stepLossy(step: CustomStep): string | null {
  const title = stepTitle(step);
  if (step.kind === 'drop_columns') return `Your rule “${title}”: the column(s) are removed from silver.`;
  if (step.kind === 'replace_values' && step.mapping.some((entry) => !entry.to))
    return `Your rule “${title}”: some values are replaced by null.`;
  if (step.kind === 'validate' && step.action === 'drop')
    return `Your rule “${title}”: rows that fail the condition are removed.`;
  return null;
}

/** What a rule still needs before it can be saved, or null. */
export function stepProblem(step: CustomStep): string | null {
  const missing = (value: string) => !value.trim();
  switch (step.kind) {
    case 'rename':
      return missing(step.column) || missing(step.to) ? 'choose the column and its new name' : null;
    case 'drop_columns':
      return step.columns.length === 0 ? 'choose at least one column' : null;
    case 'replace_values': {
      if (missing(step.column)) return 'choose the column';
      if (step.mapping.length === 0 || step.mapping.some((entry) => missing(entry.from)))
        return 'every replacement needs a value to replace';
      const keys = step.mapping.map((entry) => (step.ignore_case ? entry.from.trim().toLowerCase() : entry.from.trim()));
      return new Set(keys).size !== keys.length ? 'a value is replaced twice' : null;
    }
    case 'fill_nulls':
      return missing(step.column) || missing(step.value) ? 'choose the column and the value' : null;
    case 'convert_units':
      if (missing(step.column)) return 'choose the column';
      return !Number.isFinite(step.factor) || step.factor === 0 ? 'the factor must be a number other than 0' : null;
    case 'parse_dates':
      if (missing(step.column)) return 'choose the column';
      return step.format.includes('%') ? null : 'the format uses % codes, for example %d/%m/%Y';
    case 'split_column':
      if (missing(step.column) || !step.separator) return 'choose the column and the separator';
      return step.into.length < 2 ? 'name at least two new columns' : null;
    case 'validate':
      return missing(step.condition) ? 'write the condition' : null;
    case 'compute':
      return missing(step.column) || missing(step.expression) ? 'choose the column and write the expression' : null;
  }
}

/**
 * Why a draft cannot be sent yet, or null. The server would refuse it too;
 * saying so beside the field is kinder than a 422 after the click.
 */
export function recipeProblem(recipe: CleaningRecipe): string | null {
  for (const [index, step] of recipe.steps.entries()) {
    const problem = stepProblem(step);
    if (problem) return `Your rule ${index + 1}: ${problem}.`;
  }
  const settings = recipe.normalize;
  if (!settings || settings.mode === 'off') return null;
  const text = settings.text_column.trim();
  const code = settings.code_column.trim();
  if (!text || !code) return 'Choose the text column and the code column to code.';
  if (text.toLowerCase() === code.toLowerCase()) return 'The text column and the code column must be different.';
  return null;
}

/** One normalisation setting, in words. */
export function describeNormalize(settings: NormalizeSettings): string {
  if (settings.mode === 'off' || !settings.text_column || !settings.code_column) return 'no coding';
  const where = settings.mode === 'suggest' ? `${settings.code_column}_suggested` : settings.code_column;
  return `codes from ${settings.text_column} written to ${where}`;
}

/** What coding did, in a sentence, or null when it did not run. */
export function describeNormalization(result: NormalizationResult | undefined): string | null {
  if (!result || Object.keys(result).length === 0) return null;
  if (result.error) return `Codes could not be completed: ${result.error}`;
  const filled = (result.filled ?? 0).toLocaleString();
  const where = result.column ? ` into ${result.column}` : '';
  const verb = result.mode === 'suggest' ? 'suggested' : 'filled in';
  return (
    `Codes: ${filled} ${verb}${where}, ${(result.unresolved ?? 0).toLocaleString()} left empty, ` +
    `${(result.already_coded ?? 0).toLocaleString()} already coded (vocabulary of ${(result.vocabulary_size ?? 0).toLocaleString()} terms).`
  );
}

/**
 * The parts of a cleaning recipe the editor computes itself, kept out of the
 * component so they can be pinned by tests.
 */

/**
 * The options in a draft that can lose data, said in words. Mirrors
 * `CleaningRecipe.lossy` on the backend, so the warning shows while the
 * option is being set, not only after a save or a preview.
 */
export function lossyWarnings(recipe: CleaningRecipe): string[] {
  const warnings: string[] = [];
  const forced = Object.entries(recipe.force_types).filter(([, kind]) => kind !== 'string');
  if (forced.length > 0 && !recipe.disabled.includes('cast_types')) {
    warnings.push(
      `Forced types (${forced.map(([column, kind]) => `${column} → ${kind}`).join(', ')}): values that do not fit become null.`,
    );
  }
  if (recipe.dedupe_on.length > 0 && !recipe.disabled.includes('deduplicate_rows')) {
    warnings.push(
      `Duplicates by key (${recipe.dedupe_on.join(', ')}): rows matching on these columns are removed even where other columns differ.`,
    );
  }
  for (const step of recipe.steps) {
    const loss = stepLossy(step);
    if (loss) warnings.push(loss);
  }
  return warnings;
}

/** Order-insensitive comparison, so reordering chips is not an unsaved change. */
export function sameRecipe(a: CleaningRecipe, b: CleaningRecipe): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(recipe: CleaningRecipe): unknown {
  const sorted = (values: string[]) => [...values].sort();
  return {
    ...recipe,
    disabled: sorted(recipe.disabled),
    null_tokens: sorted(recipe.null_tokens),
    keep_as_text: sorted(recipe.keep_as_text),
    fold_skip: sorted(recipe.fold_skip),
    dedupe_on: sorted(recipe.dedupe_on),
    sex_columns: recipe.sex_columns === null ? null : sorted(recipe.sex_columns),
    force_types: Object.fromEntries(Object.entries(recipe.force_types).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/**
 * A built-in range's name pattern, read as the column names it matches:
 * `(^|_)(age|edad)(_|$)` is "age, edad". A pattern of another shape is shown
 * as it is.
 */
export function patternLabel(pattern: string): string {
  const names = /^\(\^\|_\)\(([^()]+)\)\(_\|\$\)$/.exec(pattern);
  return names ? names[1].split('|').join(', ') : pattern;
}

/**
 * The draft as it is sent: a range row added but not yet pointed at a column
 * is left out rather than refused, the way an empty chip input adds nothing.
 */
export function sendable(recipe: CleaningRecipe): CleaningRecipe {
  return {
    ...recipe,
    ranges: recipe.ranges.filter((range) => (range.column ?? '').trim() || (range.pattern ?? '').trim()),
  };
}
