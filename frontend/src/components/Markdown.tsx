import { Fragment, type ReactNode } from 'react';

/**
 * Lightweight Markdown renderer (no external dependencies).
 * Supports: headings, paragraphs, bold, italics, inline code, fenced code
 * blocks, ordered/unordered lists, and horizontal rules — enough for the
 * AI advisor reports.
 */
export default function Markdown({ content }: { content: string }) {
  return <div className="space-y-3 text-sm leading-relaxed text-slate-300">{renderBlocks(content)}</div>;
}

function renderBlocks(md: string): ReactNode[] {
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
          className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-indigo-200"
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
      const cls =
        level <= 2
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

    // Horizontal rule
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="border-slate-700/60" />);
      i++;
      continue;
    }

    // Lists (ordered or unordered)
    if (/^\s*([-*]|\d+[.)])\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, '');
        // absorb indented continuation lines
        while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1]) && !/^\s*([-*]|\d+[.)])\s+/.test(lines[i + 1])) {
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
      !/^\s*([-*]|\d+[.)])\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(<p key={key++}>{renderInline(para.join(' '))}</p>);
  }

  return blocks;
}

/** Render inline markdown: `code`, **bold**, *italic*. */
function renderInline(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((part, idx) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={idx} className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-amber-300">
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
        return <Fragment key={idx}>{part}</Fragment>;
      })}
    </>
  );
}
