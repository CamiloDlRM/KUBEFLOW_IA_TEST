import type { KeyboardEvent } from 'react';
import { Highlight, themes } from 'prism-react-renderer';

/**
 * A code cell you can type in: a transparent <textarea> laid exactly over the
 * same text highlighted by Prism. Both layers share one grid cell and the same
 * font, size, line height and padding, so the caret sits on the coloured text.
 * The highlighted layer sets the size; the textarea stretches to it, so the
 * cell grows with the code and never scrolls on its own vertically.
 */

const THEME = themes.vsDark;
const INDENT = '    ';
/** Shared by both layers: any difference here and the caret drifts off the text. */
const TEXT = 'whitespace-pre px-3 py-2.5 font-display text-[13px] leading-[1.6] [tab-size:4]';

function insertAtCaret(textarea: HTMLTextAreaElement, text: string) {
  // execCommand keeps the browser's undo history; setRangeText is the fallback.
  if (!document.execCommand('insertText', false, text)) {
    textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

export default function CodeInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const lineCount = value.split('\n').length;

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const textarea = event.currentTarget;
    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      insertAtCaret(textarea, INDENT);
    } else if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Keep the line's indentation, and go one level deeper after a colon.
      const before = value.slice(0, textarea.selectionStart);
      const line = before.slice(before.lastIndexOf('\n') + 1);
      const indent = line.match(/^[ \t]*/)?.[0] ?? '';
      event.preventDefault();
      insertAtCaret(textarea, `\n${indent}${line.trimEnd().endsWith(':') ? INDENT : ''}`);
    } else if (event.key === 'Escape') {
      // Tab indents here, so Escape is the way out for the keyboard.
      textarea.blur();
    }
  }

  return (
    <div className="flex">
      <div
        aria-hidden="true"
        className="shrink-0 select-none py-2.5 pl-3 pr-1 text-right font-display text-[13px] leading-[1.6] text-slate-600"
      >
        {Array.from({ length: lineCount }, (_, index) => (
          <div key={index}>{index + 1}</div>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="grid w-max min-w-full">
          <Highlight code={value} language="python" theme={THEME}>
            {({ tokens, getTokenProps }) => (
              // Token colours only: an italic or bold token would be wider than the text typed over it.
              <pre
                aria-hidden="true"
                className={`col-start-1 row-start-1 m-0 [&_span]:![font-style:normal] [&_span]:![font-weight:inherit] ${TEXT}`}
                style={{ color: THEME.plain.color }}
              >
                {tokens.map((line, index) => (
                  // An empty line still takes its row, or the layers stop matching.
                  <div key={index} className="min-h-[1.6em]">
                    {line.map((token, tokenIndex) => (
                      <span key={tokenIndex} {...getTokenProps({ token })} />
                    ))}
                  </div>
                ))}
              </pre>
            )}
          </Highlight>
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label={label}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            className={`col-start-1 row-start-1 h-full w-full resize-none overflow-hidden border-0 bg-transparent text-transparent caret-slate-100 outline-none selection:bg-brand-500/40 focus:ring-0 ${TEXT}`}
          />
        </div>
      </div>
    </div>
  );
}
