import { Lock } from 'lucide-react';
import { cn } from '../../lib/utils';

interface BrowserToolbarProps {
  status: 'idle' | 'launching' | 'active' | 'closed';
  currentUrl: string;
  currentTitle?: string;
  actionLabel?: string;
  isLive?: boolean;
  showLiveIndicator?: boolean;
  className?: string;
  /** When set (e.g. PPT search mode), show this instead of "Agent is using Browser" */
  displayLabel?: string;
}

const ACTION_LABELS: Record<string, string> = {
  browser_navigate: 'Browsing',
  browser_click: 'Clicking',
  browser_type: 'Typing',
  browser_scroll: 'Scrolling',
  browser_wait: 'Waiting',
  browser_extract: 'Reading',
  browser_screenshot: 'Capturing',
};

/**
 * Toolbar above the browser viewport: status line and URL bar (Manus-style).
 */
export function BrowserToolbar({
  status,
  currentUrl,
  currentTitle,
  actionLabel,
  isLive = true,
  showLiveIndicator = true,
  className,
  displayLabel,
}: BrowserToolbarProps) {
  const displayUrl = currentUrl || (displayLabel ? '' : 'No page loaded');
  const statusText = status === 'active' ? (actionLabel ?? 'Browsing') : status === 'closed' ? 'Closed' : 'Launching...';
  const titleLabel = displayLabel ?? 'Agent is using Browser';

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{titleLabel}</span>
        <span>{statusText}</span>
        {showLiveIndicator && isLive && status === 'active' && (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            Live
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
        <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-muted-foreground" title={currentTitle ?? displayUrl}>
          {displayUrl || (displayLabel ? '—' : 'No page loaded')}
        </span>
      </div>
    </div>
  );
}

export function getBrowserActionLabel(toolName: string): string {
  return ACTION_LABELS[toolName] ?? 'Browsing';
}
