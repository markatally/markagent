import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ToolResult } from '@mark/shared';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { StatusIcon } from '../ui/status-icon';

interface ToolCallStatus {
  toolCallId: string;
  toolName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  params: any;
  result?: ToolResult;
  error?: string;
  progress?: {
    current: number;
    total: number;
    message?: string;
  };
}

interface ToolCallCardProps {
  toolCall: ToolCallStatus;
  isLast?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  web_search: 'Web Search',
  paper_search: 'Paper Search',
  ppt_generator: 'Presentation',
  file_reader: 'File Reader',
  file_writer: 'File Writer',
  bash_executor: 'Shell Command',
};

function formatToolName(toolName: string) {
  return TOOL_LABELS[toolName] ?? toolName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function ToolCallCard({ toolCall, isLast = false }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const artifactCount = toolCall.result?.artifacts?.length ?? 0;
  const statusIcon =
    toolCall.status === 'running'
      ? 'running'
      : toolCall.status === 'failed'
      ? 'failed'
      : 'completed';

  return (
    <div className="relative flex gap-3">
      <div className="flex flex-col items-center">
        <StatusIcon status={statusIcon} size="md" />
        {!isLast && <div className="mt-1 h-full w-px bg-border" />}
      </div>

      <div className="min-w-0 flex-1 pb-2">
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className={cn(
            'flex w-full items-center justify-between rounded-md p-1.5 -m-1.5 text-left transition-colors hover:bg-muted/50',
            expanded && 'bg-muted/50'
          )}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse details' : 'Expand details'}
        >
          <div className="flex items-center gap-2">
            <ChevronRight
              className={cn(
                'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                expanded && 'rotate-90'
              )}
            />
            <div className="text-sm font-medium text-foreground">
              {formatToolName(toolCall.toolName)}
            </div>
          </div>
        </button>

        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {toolCall.progress ? (
            <span>
              {toolCall.progress.current}/{toolCall.progress.total}{' '}
              {toolCall.progress.message ? `• ${toolCall.progress.message}` : ''}
            </span>
          ) : null}
          {artifactCount > 0 ? (
            <span>
              {artifactCount} artifact{artifactCount === 1 ? '' : 's'}
            </span>
          ) : null}
        </div>

        {expanded ? (
          <div className="mt-3 space-y-3 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <div className="font-medium text-foreground">Details</div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowRaw((prev) => !prev)}
              >
                {showRaw ? 'Hide raw' : 'View raw'}
              </Button>
            </div>

            {showRaw ? (
              <div className="space-y-2">
                <div>
                  <div className="mb-1 text-foreground">Parameters</div>
                  <pre className="max-h-64 max-w-full overflow-auto rounded bg-muted/40 p-2 text-xs">
                    {JSON.stringify(toolCall.params ?? {}, null, 2)}
                  </pre>
                </div>

                {toolCall.result ? (
                  <div>
                    <div className="mb-1 text-foreground">Result</div>
                    <pre className="max-h-64 max-w-full overflow-auto rounded bg-muted/40 p-2 text-xs">
                      {toolCall.result.output || 'No output'}
                    </pre>
                  </div>
                ) : null}

                {toolCall.error ? (
                  <div>
                    <div className="mb-1 text-destructive">Error</div>
                    <pre className="max-h-64 max-w-full overflow-auto rounded bg-destructive/10 p-2 text-xs text-destructive">
                      {toolCall.error}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-muted-foreground">
                Raw parameters and outputs are hidden by default.
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
