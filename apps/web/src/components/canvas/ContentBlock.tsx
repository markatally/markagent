import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { CodeBlock } from '../ui/code-block';
import { useChatStore } from '../../stores/chatStore';
import { InteractiveTable } from '../chat/InteractiveTable';
import { parseContentWithTables } from '../../lib/tableParser';
import { cn } from '../../lib/utils';

/**
 * Table block marker pattern used to embed table references in content.
 * Format: <!--TABLE:tableId-->
 */
const TABLE_BLOCK_PATTERN = /<!--TABLE:([a-zA-Z0-9_-]+)-->/g;

const markdownComponents: Components = {
  code(props) {
    const { children, className, node, ...rest } = props;
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');
    const isBlock = /\n/.test(codeString) || (node as { position?: unknown })?.position;

    if (match) {
      return (
        <CodeBlock
          language={match[1]}
          code={codeString}
        />
      );
    }

    if (isBlock && !className) {
      return (
        <CodeBlock
          language="text"
          code={codeString}
        />
      );
    }

    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <pre className="not-prose">{children}</pre>;
  },
  table({ children, ...props }) {
    return (
      <div className="not-prose my-4 w-full overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-sm" {...props}>
          {children}
        </table>
      </div>
    );
  },
  thead({ children, ...props }) {
    return (
      <thead className="bg-muted/50 border-b border-border" {...props}>
        {children}
      </thead>
    );
  },
  tbody({ children, ...props }) {
    return (
      <tbody className="divide-y divide-border" {...props}>
        {children}
      </tbody>
    );
  },
  tr({ children, ...props }) {
    return (
      <tr className="transition-colors hover:bg-muted/30" {...props}>
        {children}
      </tr>
    );
  },
  th({ children, style, ...props }) {
    const alignClass = style?.textAlign === 'center'
      ? 'text-center'
      : style?.textAlign === 'right'
        ? 'text-right'
        : 'text-left';

    return (
      <th
        className={cn(
          'px-4 py-3 font-semibold text-foreground whitespace-nowrap',
          alignClass
        )}
        {...props}
      >
        {children}
      </th>
    );
  },
  td({ children, style, ...props }) {
    const alignClass = style?.textAlign === 'center'
      ? 'text-center'
      : style?.textAlign === 'right'
        ? 'text-right'
        : 'text-left';

    return (
      <td
        className={cn(
          'px-4 py-3 text-muted-foreground',
          alignClass
        )}
        {...props}
      >
        {children}
      </td>
    );
  },
};

function TableBlockRenderer({ tableId }: { tableId: string }) {
  const streamingTables = useChatStore((state) => state.streamingTables);
  const completedTables = useChatStore((state) => state.completedTables);

  const completedTable = completedTables.get(tableId);
  const streamingTable = streamingTables.get(tableId);

  if (completedTable) {
    return <InteractiveTable table={completedTable.table} isStreaming={false} />;
  }

  if (streamingTable) {
    const partialTable = {
      schema: streamingTable.schema,
      data: [],
      caption: streamingTable.caption,
    };
    return <InteractiveTable table={partialTable} isStreaming={true} />;
  }

  return (
    <div className="not-prose my-4 rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
      Loading table...
    </div>
  );
}

function parseContent(content: string): Array<{ type: 'text' | 'table'; value: string }> {
  const segments: Array<{ type: 'text' | 'table'; value: string }> = [];
  let lastIndex = 0;

  TABLE_BLOCK_PATTERN.lastIndex = 0;

  let match;
  while ((match = TABLE_BLOCK_PATTERN.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textSegment = content.slice(lastIndex, match.index).trim();
      if (textSegment) {
        segments.push({ type: 'text', value: textSegment });
      }
    }

    segments.push({ type: 'table', value: match[1] });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    const textSegment = content.slice(lastIndex).trim();
    if (textSegment) {
      segments.push({ type: 'text', value: textSegment });
    }
  }

  if (segments.length === 0 && content.trim()) {
    segments.push({ type: 'text', value: content });
  }

  return segments;
}

interface ContentBlockProps {
  content: string;
  isStreaming?: boolean;
}

export function ContentBlock({ content, isStreaming }: ContentBlockProps) {
  const explicitTableSegments = parseContent(content);
  const hasExplicitTableBlocks = explicitTableSegments.some((s) => s.type === 'table');

  const parsedContent = useMemo(() => {
    if (hasExplicitTableBlocks || isStreaming) {
      return null;
    }
    return parseContentWithTables(content);
  }, [content, hasExplicitTableBlocks, isStreaming]);

  const hasMarkdownTables = parsedContent?.hasTables ?? false;

  return (
    <div className="prose prose-neutral dark:prose-invert max-w-none">
      {hasExplicitTableBlocks ? (
        explicitTableSegments.map((segment, index) =>
          segment.type === 'table' ? (
            <TableBlockRenderer key={`table-${segment.value}-${index}`} tableId={segment.value} />
          ) : (
            <ReactMarkdown
              key={`text-${index}`}
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {segment.value}
            </ReactMarkdown>
          )
        )
      ) : hasMarkdownTables && parsedContent ? (
        parsedContent.segments.map((segment, index) =>
          segment.type === 'table' ? (
            <InteractiveTable
              key={`md-table-${index}`}
              table={segment.table}
              isStreaming={isStreaming}
            />
          ) : (
            <ReactMarkdown
              key={`text-${index}`}
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {segment.content}
            </ReactMarkdown>
          )
        )
      ) : (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      )}
    </div>
  );
}
