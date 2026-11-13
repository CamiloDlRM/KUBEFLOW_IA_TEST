import type { CleaningRecipe } from '../../types';

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
