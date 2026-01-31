import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle, XCircle, Loader2, Search } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ArtifactDisplay } from './ArtifactDisplay';

interface ToolCallDisplayProps {
  sessionId: string;
}

// Animated pulsing dots for in-progress status
const PulsingDots = () => (
  <span className="flex items-center gap-1">
    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
  </span>
);

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

export function ToolCallDisplay({ sessionId }: ToolCallDisplayProps) {
  const [expandedCalls, setExpandedCalls] = useState<Set<string>>(new Set());
  const toolCalls = useChatStore((state) => state.toolCalls);

  // Show all non-pending calls - pending calls are already shown as 'running' when started
  const sessionToolCalls = Array.from(toolCalls.values()).filter(
    (call) => call.status !== 'pending'
  );

  if (sessionToolCalls.length === 0) {
    return null;
  }

  const toggleExpand = (toolCallId: string) => {
    setExpandedCalls((prev) => {
      const next = new Set(prev);
      if (next.has(toolCallId)) {
        next.delete(toolCallId);
      } else {
        next.add(toolCallId);
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
      {sessionToolCalls.map((toolCall) => {
        const isExpanded = expandedCalls.has(toolCall.toolCallId);
        const isRunning = toolCall.status === 'running';

        return (
          <Card
            key={toolCall.toolCallId}
            className={cn(
              'text-sm transition-all duration-200',
              isRunning && 'border-blue-200 bg-blue-50/30',
              toolCall.status === 'completed' && 'border-green-200 bg-green-50/20',
              toolCall.status === 'failed' && 'border-red-200 bg-red-50/20'
            )}
          >
            <CardHeader className="p-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => toggleExpand(toolCall.toolCallId)}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  {isRunning && <Search className="h-4 w-4 text-blue-500 animate-pulse" />}
                  <CardTitle className="text-sm font-medium">
                    {toolCall.toolName}
                  </CardTitle>
                </div>
                <Badge
                  variant={
                    toolCall.status === 'completed'
                      ? 'default'
                      : toolCall.status === 'failed'
                      ? 'destructive'
                      : 'secondary'
                  }
                  className={cn(
                    'flex items-center gap-1',
                    isRunning && 'bg-blue-100 text-blue-700 hover:bg-blue-100'
                  )}
                >
                  {toolCall.status === 'running' && <PulsingDots />}
                  {toolCall.status === 'completed' && (
                    <CheckCircle className="h-3 w-3" />
                  )}
                  {toolCall.status === 'failed' && <XCircle className="h-3 w-3" />}
                  <span>{getStatusLabel(toolCall.status, toolCall.toolName)}</span>
                </Badge>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="p-3 pt-0 space-y-2">
                {/* Parameters */}
                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    Parameters:
                  </div>
                  {isRunning && toolCall.status === 'running' ? (
                    <Shimmer className="h-20 rounded w-full" />
                  ) : (
                    <SyntaxHighlighter
                      language="json"
                      style={oneDark as any}
                      customStyle={{ margin: 0, borderRadius: '4px', fontSize: '11px' }}
                    >
                      {JSON.stringify(toolCall.params, null, 2)}
                    </SyntaxHighlighter>
                  )}
                </div>

                {/* Artifacts */}
                {toolCall.result?.artifacts && toolCall.result.artifacts.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      Generated Files:
                    </div>
                    {toolCall.result.artifacts.map((artifact, idx) => (
                      <ArtifactDisplay key={idx} artifact={artifact} sessionId={sessionId} />
                    ))}
                  </div>
                )}

                {/* Result (only show if no artifacts and not running) */}
                {toolCall.result && (!toolCall.result.artifacts || toolCall.result.artifacts.length === 0) && toolCall.status !== 'running' && (
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      Result:
                    </div>
                    <pre className="text-xs bg-secondary p-2 rounded overflow-auto max-h-40">
                      {toolCall.result.output}
                    </pre>
                  </div>
                )}

                {/* Running indicator */}
                {isRunning && (
                  <div className="text-xs text-blue-600 flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>{getStatusLabel(toolCall.status, toolCall.toolName)}</span>
                  </div>
                )}

                {/* Error */}
                {toolCall.error && (
                  <div>
                    <div className="text-xs font-medium text-destructive mb-1">
                      Error:
                    </div>
                    <pre className="text-xs bg-destructive/10 text-destructive p-2 rounded overflow-auto max-h-40">
                      {toolCall.error}
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
