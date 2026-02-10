import { useCallback, useEffect, useState } from 'react';
import { X, GripVertical } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { cn } from '../../lib/utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Button } from '../ui/button';
import { ToolCallCard } from './ToolCallCard';
import { ReasoningTrace } from './ReasoningTrace';
import { SourcesList } from './SourcesList';
import { ComputerPanel } from './ComputerPanel';

const MIN_INSPECTOR_WIDTH = 280;
const MAX_INSPECTOR_WIDTH = 560;
const DEFAULT_INSPECTOR_WIDTH = 320;
const STORAGE_KEY = 'inspector-width';
const clampInspectorWidth = (value: number) =>
  Math.min(Math.max(value, MIN_INSPECTOR_WIDTH), MAX_INSPECTOR_WIDTH);

interface InspectorPanelProps {
  open: boolean;
  sessionId?: string;
  onClose?: () => void;
}

export function InspectorPanel({ open, sessionId, onClose }: InspectorPanelProps) {
  const inspectorTab = useChatStore((state) => state.inspectorTab);
  const setInspectorTab = useChatStore((state) => state.setInspectorTab);
  const toolCalls = useChatStore((state) => state.toolCalls);
  const selectedMessageId = useChatStore((state) => state.selectedMessageId);
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored
      ? clampInspectorWidth(parseInt(stored, 10))
      : DEFAULT_INSPECTOR_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;
      setWidth(clampInspectorWidth(window.innerWidth - e.clientX));
    },
    [isResizing]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const sessionToolCalls = sessionId
    ? Array.from(toolCalls.values())
        .filter((call) => {
          if (call.sessionId !== sessionId) return false;
          if (call.status === 'pending') return false;
          // When a message is selected, only show its tool calls
          if (selectedMessageId) {
            return call.messageId === selectedMessageId;
          }
          return true;
        })
        .reverse()
    : [];

  const showComputerTab = !!sessionId;

  return (
    <aside
      style={{ width: open ? width : 0 }}
      className={cn(
        'relative flex h-full shrink-0 flex-col bg-background transition-[width] duration-200',
        open ? 'border-l' : 'border-l border-transparent',
        isResizing && 'transition-none',
        'overflow-hidden'
      )}
      aria-hidden={!open}
    >
      {open ? (
        <>
          <div className="flex h-12 items-center justify-between border-b px-3">
            <div className="text-sm font-medium text-foreground">Inspector</div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close inspector"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 min-w-0 overflow-hidden">
            {sessionId ? (
              <Tabs
                value={inspectorTab}
                onValueChange={(value) =>
                  setInspectorTab(value as 'reasoning' | 'tools' | 'sources' | 'computer')
                }
                className="flex h-full flex-col"
              >
                <div className="shrink-0 border-b px-3 pb-2 pt-3">
                  <TabsList className="w-full">
                    <TabsTrigger value="tools" className="flex-1">Tools</TabsTrigger>
                    <TabsTrigger value="sources" className="flex-1">Sources</TabsTrigger>
                    <TabsTrigger value="reasoning" className="flex-1">Reasoning</TabsTrigger>
                    {showComputerTab ? (
                      <TabsTrigger value="computer" className="flex-1">Computer</TabsTrigger>
                    ) : null}
                  </TabsList>
                </div>

                <div className="relative flex-1 min-w-0 overflow-hidden">
                  <TabsContent
                    value="tools"
                    forceMount
                    className="absolute inset-0 m-0 min-w-0 overflow-y-auto p-3 data-[state=inactive]:hidden"
                  >
                    {sessionToolCalls.length > 0 ? (
                      <div className="min-w-0 rounded-xl border bg-muted/10">
                        <div className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <span>Tool Calls</span>
                          </div>
                        </div>
                        <div className="min-w-0 space-y-3 overflow-x-auto px-4 pb-4">
                          {sessionToolCalls.map((call, index) => (
                            <ToolCallCard
                              key={call.toolCallId}
                              toolCall={call}
                              isLast={index === sessionToolCalls.length - 1}
                            />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                        No tool activity yet.
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent
                    value="sources"
                    forceMount
                    className="absolute inset-0 m-0 min-w-0 overflow-y-auto p-3 data-[state=inactive]:hidden"
                  >
                    <SourcesList sessionId={sessionId} selectedMessageId={selectedMessageId} />
                  </TabsContent>

                  <TabsContent
                    value="reasoning"
                    forceMount
                    className="absolute inset-0 m-0 min-w-0 overflow-y-auto p-3 data-[state=inactive]:hidden"
                  >
                    <ReasoningTrace sessionId={sessionId} selectedMessageId={selectedMessageId} />
                  </TabsContent>

                  <TabsContent
                    value="computer"
                    forceMount
                    className="absolute inset-0 m-0 flex h-full min-h-0 min-w-0 flex-col overflow-hidden px-3 pt-3 pb-0 data-[state=inactive]:hidden"
                  >
                    <ComputerPanel sessionId={sessionId} />
                  </TabsContent>
                </div>
              </Tabs>
            ) : (
              <div className="p-4 text-sm text-muted-foreground">
                Inspector is available once a session is selected.
              </div>
            )}
          </div>

          <div
            onMouseDown={handleMouseDown}
            className={cn(
              'absolute left-0 top-0 hidden h-full w-1 cursor-col-resize items-center justify-center group hover:bg-primary/20 transition-colors md:flex',
              isResizing && 'bg-primary/30'
            )}
          >
            <div
              className={cn(
                'absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 flex h-8 w-4 items-center justify-center rounded bg-border opacity-0 transition-opacity group-hover:opacity-100',
                isResizing && 'opacity-100 bg-primary/50'
              )}
            >
              <GripVertical className="h-3 w-3 text-muted-foreground" />
            </div>
          </div>
        </>
      ) : null}
    </aside>
  );
}
