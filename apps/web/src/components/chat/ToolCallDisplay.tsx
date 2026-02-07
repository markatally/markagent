import { useState } from 'react';
import { ChevronRight, Loader2, Search, Download } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { triggerDownload } from '../../lib/download';
import { StatusIcon } from '../ui/status-icon';

interface ToolCallDisplayProps {
  sessionId: string;
}

// Shimmer effect for loading content
const Shimmer = ({ className }: { className?: string }) => (
  <div className={cn('animate-pulse bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 bg-[length:200%_100%]', className)} style={{ animation: 'shimmer 1.5s infinite' }} />
);

// Add shimmer keyframes to global styles if not already present
const addShimmerStyles = () => {
  if (typeof document !== 'undefined' && !document.getElementById('shimmer-styles')) {
    const style = document.createElement('style');
    style.id = 'shimmer-styles';
    style.textContent = `
      @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `;
    document.head.appendChild(style);
  }
};

addShimmerStyles();

/**
 * Handle file download for PPT generator
 */
async function handleDownload(
  e: React.MouseEvent<HTMLButtonElement>,
  sessionId: string,
  fileId: string | undefined,
  filename: string
): Promise<void> {
  e.stopPropagation();

  if (!fileId) {
    console.error('No fileId provided for download');
    return;
  }

  try {
    await triggerDownload(sessionId, fileId, filename);
  } catch (error) {
    console.error('Download failed:', error);
    alert(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function ToolCallDisplay({ sessionId }: ToolCallDisplayProps) {
  const [expandedCalls, setExpandedCalls] = useState<Set<string>>(new Set());
  const toolCalls = useChatStore((state) => state.toolCalls);

  // Show all non-pending calls - pending calls are already shown as 'running' when started
  const sessionToolCalls = Array.from(toolCalls.values()).filter(
    (call) => call.status !== 'pending' && call.sessionId === sessionId
  );

  const groupedToolCalls = new Map<string, typeof sessionToolCalls>();
  for (const call of sessionToolCalls) {
    const existing = groupedToolCalls.get(call.toolName) || [];
    existing.push(call);
    groupedToolCalls.set(call.toolName, existing);
  }

  if (sessionToolCalls.length === 0) {
    return null;
  }

  const toggleExpand = (toolName: string) => {
    setExpandedCalls((prev) => {
      const next = new Set(prev);
      if (next.has(toolName)) {
        next.delete(toolName);
      } else {
        next.add(toolName);
      }
      return next;
    });
  };

  const getStatusLabel = (status: string, toolName: string) => {
    if (status === 'running') {
      if (toolName === 'web_search') return 'Searching...';
      if (toolName === 'ppt_generator') return 'Generating...';
      return 'Running...';
    }
    return status;
  };

  return (
    <div className="space-y-2 p-4 border-t bg-muted/30">
      <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center justify-between">
        <span>Tool Calls</span>
        <span className="text-muted-foreground">
          {sessionToolCalls.filter(c => c.status === 'running').length > 0 && (
            <span className="flex items-center gap-1 text-blue-600">
              <Loader2 className="h-3 w-3 animate-spin" />
              {sessionToolCalls.filter(c => c.status === 'running').length} in progress
            </span>
          )}
        </span>
      </div>
      {Array.from(groupedToolCalls.entries()).map(([toolName, toolCallGroup]) => {
        const completedCall = toolCallGroup.find((call) => call.status === 'completed');
        const runningCall = toolCallGroup.find((call) => call.status === 'running');
        const latestCall = toolCallGroup[toolCallGroup.length - 1];
        const representativeCall = completedCall || runningCall || latestCall;
        const failedCount = toolCallGroup.filter((call) => call.status === 'failed').length;
        const latestFailedCall = [...toolCallGroup].reverse().find((call) => call.status === 'failed');

        const isExpanded = expandedCalls.has(toolName);
        const isRunning = representativeCall.status === 'running';

        return (
          <Card
            key={toolName}
            className={cn(
              'text-sm transition-all duration-200',
              isRunning && 'border-blue-200 bg-blue-50/30',
              representativeCall.status === 'completed' && 'border-green-200 bg-green-50/20',
              representativeCall.status === 'failed' && 'border-red-200 bg-red-50/20'
            )}
          >
            <CardHeader
              className="flex cursor-pointer items-center gap-2 rounded-md p-3 transition-colors hover:bg-muted/50"
              onClick={() => toggleExpand(toolName)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleExpand(toolName);
                }
              }}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
            >
              <div className="flex w-full items-center justify-between">
                <div className="flex items-center gap-2">
                  <ChevronRight
                    className={cn(
                      'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                      isExpanded && 'rotate-90'
                    )}
                  />
                  {isRunning && <Search className="h-4 w-4 text-blue-500 animate-pulse" />}
                  <CardTitle className="text-sm font-medium">
                    {toolName}
                  </CardTitle>
                </div>
                {/* Show Download button for completed ppt_generator, otherwise show status badge */}
                {toolName === 'ppt_generator' && 
                 completedCall?.result?.artifacts?.[0]?.fileId ? (
                  <button
                    onClick={(e) => handleDownload(
                      e, 
                      sessionId, 
                      completedCall?.result?.artifacts?.[0]?.fileId, 
                      completedCall?.result?.artifacts?.[0]?.name || 'presentation.pptx'
                    )}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded hover:bg-primary/90 transition-colors cursor-pointer"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </button>
                ) : (
                  <Badge
                    variant={
                      representativeCall.status === 'completed'
                        ? 'default'
                        : representativeCall.status === 'failed'
                        ? 'destructive'
                        : 'secondary'
                    }
                    className={cn(
                      'flex items-center gap-1',
                      isRunning && 'bg-blue-100 text-blue-700 hover:bg-blue-100'
                    )}
                  >
                    <StatusIcon
                      status={
                        representativeCall.status === 'running'
                          ? 'running'
                          : representativeCall.status === 'failed'
                          ? 'failed'
                          : 'completed'
                      }
                      size="sm"
                    />
                  </Badge>
                )}
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="p-3 pt-0 space-y-2">
                {/* Parameters */}
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    Parameters:
                  </div>
                  {/* Show shimmer only if running AND no params yet */}
                  {isRunning && (!representativeCall.params || Object.keys(representativeCall.params).length === 0) ? (
                    <Shimmer className="h-20 rounded w-full" />
                  ) : (
                    <SyntaxHighlighter
                      language="json"
                      style={oneDark as any}
                      customStyle={{ margin: 0, borderRadius: '4px', fontSize: '11px' }}
                    >
                      {JSON.stringify(representativeCall.params, null, 2)}
                    </SyntaxHighlighter>
                  )}
                </div>

                {/* Result (only show if no artifacts and not running) */}
                {representativeCall.result && (!representativeCall.result.artifacts || representativeCall.result.artifacts.length === 0) && representativeCall.status !== 'running' && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      Result:
                    </div>
                    <pre className="text-xs bg-secondary p-2 rounded overflow-auto max-h-96">
                      {representativeCall.result.output}
                    </pre>
                  </div>
                )}

                {/* Running indicator */}
                {isRunning && (
                  <div className="text-xs text-blue-600 flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>{getStatusLabel(representativeCall.status, toolName)}</span>
                  </div>
                )}

                {/* Failed attempts */}
                {failedCount > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {failedCount} failed attempt{failedCount === 1 ? '' : 's'}
                  </div>
                )}

                {/* Error */}
                {latestFailedCall?.error && (
                  <div>
                    <div className="text-xs font-medium text-destructive mb-1">
                      Error:
                    </div>
                    <pre className="text-xs bg-destructive/10 text-destructive p-2 rounded overflow-auto max-h-96">
                      {latestFailedCall.error}
                    </pre>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
