import { useId, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';

/**
 * A list of short values edited as chips: columns, placeholder strings.
 *
 * Enter or a comma adds what is typed; known values are suggested as you
 * type. Duplicates are ignored rather than refused — adding a value that is
 * already there is not a mistake worth a message.
 */
export default function ChipsInput({
  label,
  values,
  onChange,
  suggestions = [],
  placeholder,
  disabled = false,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const listId = useId();

  function add(raw: string) {
    const value = raw.trim().replace(/,$/, '').trim();
    if (value && !values.includes(value)) onChange([...values, value]);
    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(draft);
    } else if (event.key === 'Backspace' && !draft && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <div>
      <span className="mb-1 block text-xs text-slate-400">{label}</span>
      <div
        className={`flex min-h-[2.25rem] flex-wrap items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 focus-within:border-brand-500 ${
          disabled ? 'opacity-50' : ''
        }`}
      >
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded bg-slate-800 py-0.5 pl-2 pr-1 font-display text-xs text-slate-200"
          >
            {value === '' ? '(empty)' : value}
            <button
              type="button"
              aria-label={`Remove ${value || 'empty'}`}
              disabled={disabled}
              onClick={() => onChange(values.filter((item) => item !== value))}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-700 hover:text-slate-100"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          aria-label={label}
          list={suggestions.length ? listId : undefined}
          value={draft}
          disabled={disabled}
          placeholder={values.length ? '' : placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => draft.trim() && add(draft)}
          className="min-w-[8rem] flex-1 bg-transparent px-1 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none"
        />
        {suggestions.length > 0 && (
          <datalist id={listId}>
            {suggestions
              .filter((option) => !values.includes(option))
              .map((option) => (
                <option key={option} value={option} />
              ))}
          </datalist>
        )}
      </div>
    </div>
  );
}
