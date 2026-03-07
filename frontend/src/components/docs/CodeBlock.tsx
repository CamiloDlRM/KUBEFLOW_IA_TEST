import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CodeBlockProps {
  children: string;
  language?: string;
}

export function CodeBlock({ children, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative group rounded-lg border border-[#27272a] bg-[#18181b] overflow-hidden">
      {language && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#27272a]">
          <span className="text-xs text-[#52525b] font-mono">{language}</span>
        </div>
      )}
      <button
        onClick={handleCopy}
        className="absolute top-2.5 right-3 flex items-center gap-1.5 text-xs text-[#52525b] hover:text-[#a1a1aa] transition-colors"
      >
        {copied ? (
          <>
            <Check size={14} className="text-green-400" />
            <span className="text-green-400">Copiado!</span>
          </>
        ) : (
          <>
            <Copy size={14} />
            <span>Copiar</span>
          </>
        )}
      </button>
      <pre className="p-4 overflow-x-auto text-sm leading-relaxed">
        <code className="font-mono text-[#e4e4e7]">{children}</code>
      </pre>
    </div>
  );
}
