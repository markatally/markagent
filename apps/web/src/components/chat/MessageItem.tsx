import { useMemo } from 'react';
import { Bot, User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Message } from '@mark/shared';
import { cn } from '../../lib/utils';
import { formatDistanceToNow } from 'date-fns';
import type { Components } from 'react-markdown';
import { useChatStore } from '../../stores/chatStore';
import { InteractiveTable } from './InteractiveTable';
import { parseContentWithTables } from '../../lib/tableParser';

interface MessageItemProps {
  message: Message;
  isStreaming?: boolean;
}

/**
 * Table block marker pattern used to embed table references in message content.
 * Format: <!--TABLE:tableId-->
 */
const TABLE_BLOCK_PATTERN = /<!--TABLE:([a-zA-Z0-9_-]+)-->/g;

/**
 * Custom markdown components for ReactMarkdown
 * Includes styled table components for clean table rendering
 */
const markdownComponents: Components = {
  // Code blocks with syntax highlighting
  code(props) {
    const { children, className, ...rest } = props;
    const match = /language-(\w+)/.exec(className || '');
    return match ? (
      <SyntaxHighlighter
        style={oneDark as any}
        language={match[1]}
        PreTag="div"
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    ) : (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  },

  // Table components with responsive styling
  table({ children, ...props }) {
    return (
      <div className="my-4 w-full overflow-x-auto rounded-lg border border-border">
        <table
          className="w-full border-collapse text-sm"
          {...props}
        >
          {children}
        </table>
      </div>
    );
  },

  thead({ children, ...props }) {
    return (
      <thead
        className="bg-muted/50 border-b border-border"
        {...props}
      >
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
      <tr
        className="transition-colors hover:bg-muted/30"
        {...props}
      >
        {children}
      </tr>
    );
  },

  th({ children, style, ...props }) {
    // Handle text alignment from markdown
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
    // Handle text alignment from markdown
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

/**
 * Renders a Table IR block from the chat store.
 * Handles both streaming (incomplete) and completed tables.
 */
function TableBlockRenderer({ tableId }: { tableId: string }) {
  const streamingTables = useChatStore((state) => state.streamingTables);
  const completedTables = useChatStore((state) => state.completedTables);

  const completedTable = completedTables.get(tableId);
  const streamingTable = streamingTables.get(tableId);

  if (completedTable) {
    // Table is complete - render with sorting enabled
    return <InteractiveTable table={completedTable.table} isStreaming={false} />;
  }

  if (streamingTable) {
    // Table is still streaming - render placeholder with schema
    // Create a partial TableIR with empty data for the streaming state
    const partialTable = {
      schema: streamingTable.schema,
      data: [],
      caption: streamingTable.caption,
    };
    return <InteractiveTable table={partialTable} isStreaming={true} />;
  }

  // Table not found - render placeholder
  return (
    <div className="my-4 p-4 rounded-lg border border-border bg-muted/20 text-sm text-muted-foreground">
      Loading table...
    </div>
  );
}

/**
 * Parses message content and returns an array of content segments.
 * Each segment is either a text block or a table block reference.
 */
function parseMessageContent(content: string): Array<{ type: 'text' | 'table'; value: string }> {
  const segments: Array<{ type: 'text' | 'table'; value: string }> = [];
  let lastIndex = 0;

  // Reset regex state
  TABLE_BLOCK_PATTERN.lastIndex = 0;

  let match;
  while ((match = TABLE_BLOCK_PATTERN.exec(content)) !== null) {
    // Add text before the table marker
    if (match.index > lastIndex) {
      const textSegment = content.slice(lastIndex, match.index).trim();
      if (textSegment) {
        segments.push({ type: 'text', value: textSegment });
      }
    }

    // Add the table reference
    segments.push({ type: 'table', value: match[1] });
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last table marker
  if (lastIndex < content.length) {
    const textSegment = content.slice(lastIndex).trim();
    if (textSegment) {
      segments.push({ type: 'text', value: textSegment });
    }
  }

  // If no table markers found, return the entire content as text
  if (segments.length === 0 && content.trim()) {
    segments.push({ type: 'text', value: content });
  }

  return segments;
}

export function MessageItem({ message, isStreaming }: MessageItemProps) {
  const isUser = message.role === 'user';

  // First check for explicit TABLE markers (from backend Table IR events)
  const explicitTableSegments = parseMessageContent(message.content);
  const hasExplicitTableBlocks = explicitTableSegments.some((s) => s.type === 'table');

  // If no explicit markers, parse markdown tables and convert to Table IR
  // Only do this for non-streaming, completed messages
  const parsedContent = useMemo(() => {
    if (hasExplicitTableBlocks || isStreaming) {
      return null; // Use explicit markers or skip during streaming
    }
    return parseContentWithTables(message.content);
  }, [message.content, hasExplicitTableBlocks, isStreaming]);

  const hasMarkdownTables = parsedContent?.hasTables ?? false;

  return (
    <div
      className={cn(
        'flex gap-3 p-4',
        isUser && 'bg-muted/50'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-primary' : 'bg-secondary'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-primary-foreground" />
        ) : (
          <Bot className="h-4 w-4 text-secondary-foreground" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 space-y-2 overflow-hidden">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">
            {isUser ? 'You' : 'Assistant'}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(message.createdAt), {
              addSuffix: true,
            })}
          </span>
        </div>

        {/* Message content - render segments */}
        <div className="prose prose-sm dark:prose-invert max-w-none">
          {hasExplicitTableBlocks ? (
            // Render mixed content: text + explicit table block references
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
            // Render parsed markdown tables as interactive Table IR
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
            // No tables - render as plain markdown (existing behavior)
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {message.content}
            </ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
}
