import { Fragment, type ReactNode } from 'react';

/**
 * Lightweight Markdown renderer (no external dependencies).
 * Supports: headings, paragraphs, bold, italics, inline code, links, fenced
 * code blocks, ordered/unordered lists, tables, quotes and horizontal rules —
 * enough for the AI advisor reports and a notebook's markdown cells.
 *
 * `notebook` sets it the way Colab and Jupyter set a text cell: larger type and
 * headings that step down in size, instead of the compact report style.
 */
export default function Markdown({ content, notebook = false }: { content: string; notebook?: boolean }) {
  return (
    <div className={`leading-relaxed text-slate-300 ${notebook ? 'space-y-3.5 text-[15px]' : 'space-y-3 text-sm'}`}>
      {renderBlocks(content, notebook)}
    </div>
  );
}

const NOTEBOOK_HEADINGS = [
  'text-[26px] font-semibold leading-snug text-slate-50',
  'text-[21px] font-semibold leading-snug text-slate-50',
  'text-[17px] font-semibold text-slate-100',
  'text-[15px] font-semibold text-slate-100',
];

const LIST_ITEM = /^\s*([-*]|\d+[.)])\s+/;
const QUOTE = /^\s*>/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function tableCells(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

function renderBlocks(md: string, notebook: boolean): ReactNode[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        code.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(
        <pre
          key={key++}
          className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-950 p-3 font-display text-xs text-indigo-200"
        >
          {code.join('\n')}
        </pre>,
      );
      continue;
    }

    // Headings
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const cls = notebook
        ? NOTEBOOK_HEADINGS[level - 1]
        : level <= 2
          ? 'mt-5 text-base font-bold text-slate-100 border-b border-slate-700/60 pb-1'
          : 'mt-4 text-sm font-semibold text-slate-200';
      blocks.push(
        <h4 key={key++} className={cls}>
          {renderInline(heading[2])}
        </h4>,
      );
      i++;
      continue;
    }

    // Table: a header row, a rule of dashes, then the rows
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
      const head = tableCells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        rows.push(tableCells(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key++} className="overflow-x-auto">
          <table className="border-collapse text-left text-[0.93em]">
            <thead>
              <tr>
                {head.map((cell, idx) => (
                  <th key={idx} className="border border-slate-700 bg-slate-800/70 px-3 py-1.5 font-semibold text-slate-100">
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={rowIdx}>
                  {row.map((cell, idx) => (
                    <td key={idx} className="border border-slate-700 px-3 py-1.5">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Quote
    if (QUOTE.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      blocks.push(
        <blockquote key={key++} className="border-l-2 border-slate-600 pl-3 text-slate-400">
          {renderInline(quote.join(' '))}
        </blockquote>,
      );
      continue;
    }

    // Horizontal rule
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="border-slate-700/60" />);
      i++;
      continue;
    }

    // Lists (ordered or unordered)
    if (LIST_ITEM.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      while (i < lines.length && LIST_ITEM.test(lines[i])) {
        let item = lines[i].replace(LIST_ITEM, '');
        // absorb indented continuation lines
        while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !LIST_ITEM.test(lines[i + 1])) {
          i++;
          item += ' ' + lines[i].trim();
        }
        items.push(item);
        i++;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(
        <ListTag
          key={key++}
          className={`ml-5 space-y-1.5 ${ordered ? 'list-decimal' : 'list-disc'} marker:text-slate-500`}
        >
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph (merge consecutive non-empty, non-special lines)
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trimStart().startsWith('```') &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !LIST_ITEM.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !TABLE_ROW.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(<p key={key++}>{renderInline(para.join(' '))}</p>);
  }

  return blocks;
}

const LINK = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/;

/** Render inline markdown: `code`, **bold**, *italic*, [links](https://…). */
function renderInline(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g);
  return (
    <>
      {parts.map((part, idx) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={idx} className="rounded bg-slate-800 px-1.5 py-0.5 font-display text-[0.85em] text-amber-300">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={idx} className="font-semibold text-slate-100">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          return <em key={idx}>{part.slice(1, -1)}</em>;
        }
        const link = part.match(LINK);
        if (link) {
          return (
            <a
              key={idx}
              href={link[2]}
              target="_blank"
              rel="noreferrer"
              className="text-brand-400 underline-offset-2 hover:underline"
            >
              {link[1]}
            </a>
          );
        }
        return <Fragment key={idx}>{part}</Fragment>;
      })}
    </>
  );
}
