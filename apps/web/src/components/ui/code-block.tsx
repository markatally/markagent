import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '../../lib/utils';

const PURE_BLACK_STYLE = {
  margin: 0,
  background: '#000000',
  borderRadius: '0.5rem',
};

const COPY_RESET_MS = 2000;

export interface CodeBlockProps {
  language: string;
  code: string;
  className?: string;
  customStyle?: React.CSSProperties;
  PreTag?: keyof JSX.IntrinsicElements;
}

export function CodeBlock({
  language,
  code,
  className,
  customStyle = {},
  PreTag = 'div',
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      const t = setTimeout(() => setCopied(false), COPY_RESET_MS);
      return () => clearTimeout(t);
    } catch {
      setCopied(false);
    }
  }, [code]);

  return (
    <div className={cn('group relative', className)}>
      <button
        type="button"
        onClick={handleCopy}
        className="absolute top-2 right-2 z-10 flex h-8 w-8 items-center justify-center rounded-md text-gray-400 opacity-0 transition-all hover:bg-white/10 hover:text-gray-200 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
        aria-label={copied ? 'Copied' : 'Copy code'}
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-400" aria-hidden />
        ) : (
          <Copy className="h-4 w-4" aria-hidden />
        )}
      </button>
      <SyntaxHighlighter
        style={oneDark as React.CSSProperties}
        language={language}
        PreTag={PreTag}
        customStyle={{ ...PURE_BLACK_STYLE, ...customStyle }}
        codeTagProps={{ style: { background: 'transparent' } }}
        lineProps={{ style: { background: 'transparent' } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
