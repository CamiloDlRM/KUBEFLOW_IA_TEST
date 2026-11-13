import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/*
 * The app's dropdown, for the places a native <select> or <datalist> would
 * open the browser's own list instead: the same trigger and list the branch
 * and notebook pickers use.
 */
// shortcut: options are reached with Tab, not the arrow keys, like the pickers
// this copies; add roving focus if a long list ever goes in one.

const LIST =
  'absolute left-0 z-20 mt-0.5 max-h-52 min-w-full overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 p-1.5 shadow-xl';

function optionClass(selected: boolean): string {
  return `w-full whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition ${
    selected ? 'bg-brand-600/25 text-brand-300' : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
  }`;
}

/** A ref for the menu's wrapper: a click outside it, or Escape, closes it. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

/** One of a fixed set of choices. */
export function SelectMenu<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  /** What is being chosen, for screen readers: the visible label sits outside. */
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const shown = options.find((option) => option.value === value)?.label ?? value;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${shown}`}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-brand-500/20 bg-brand-600/20 px-3 py-1.5 text-left text-sm font-medium text-brand-400 transition hover:bg-brand-600/30 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed"
      >
        <span className="truncate">{shown}</span>
        <ChevronDown size={16} aria-hidden="true" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul role="listbox" aria-label={label} className={LIST}>
          {options.map((option) => (
            <li key={option.value} role="option" aria-selected={option.value === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={optionClass(option.value === value)}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A text field that offers values to pick, and still takes one that is not offered. */
export function SuggestInput({
  id,
  value,
  suggestions,
  onChange,
  className = '',
}: {
  id: string;
  value: string;
  suggestions: string[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const listId = useId();

  return (
    <div ref={ref} className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        className={`${className} pr-8`}
      />
      <ChevronDown
        size={14}
        aria-hidden="true"
        className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
      />
      {open && suggestions.length > 0 && (
        <ul id={listId} role="listbox" className={LIST}>
          {suggestions.map((suggestion) => (
            <li key={suggestion} role="option" aria-selected={suggestion === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(suggestion);
                  setOpen(false);
                }}
                className={`${optionClass(suggestion === value)} font-display`}
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
