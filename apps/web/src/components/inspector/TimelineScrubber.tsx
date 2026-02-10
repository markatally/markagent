import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

interface TimelineScrubberProps {
  currentIndex: number;
  totalSteps: number;
  isLive: boolean;
  showLiveIndicator?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onJumpToLive: () => void;
  onSeek?: (index: number) => void;
  className?: string;
  /** Show "Back" / "Forward" labels next to step buttons (default true for discoverability) */
  showBackForwardLabels?: boolean;
  /** Label for the step counter, e.g. "Page" or "Step" (default "Step") */
  stepLabel?: string;
}

/**
 * Timeline scrubber below the browser viewport: step nav, slider, Jump to live (Manus-style).
 */
export function TimelineScrubber({
  currentIndex,
  totalSteps,
  isLive,
  showLiveIndicator = true,
  onPrevious,
  onNext,
  onJumpToLive,
  onSeek,
  className,
  showBackForwardLabels = true,
  stepLabel = 'Step',
}: TimelineScrubberProps) {
  const total = Math.max(1, totalSteps);
  const value = totalSteps === 0 ? 0 : currentIndex;
  const atStart = value <= 0;
  const atEnd = totalSteps === 0 || value >= total - 1;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {stepLabel} {value + 1} of {total}
        </span>
        {!isLive && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onJumpToLive}>
            Jump to live
          </Button>
        )}
        {showLiveIndicator && isLive && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            live
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => onSeek?.(0)}
          disabled={totalSteps === 0}
          aria-label="Go to first step"
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size={showBackForwardLabels ? 'default' : 'icon'}
          className={cn('shrink-0', showBackForwardLabels && 'gap-1 px-2')}
          onClick={onPrevious}
          disabled={totalSteps === 0 || atStart}
          aria-label="Back (previous step)"
        >
          <ChevronLeft className="h-4 w-4" />
          {showBackForwardLabels && <span className="text-xs">Back</span>}
        </Button>
        <div className="flex-1 px-2">
          <input
            type="range"
            min={0}
            max={Math.max(0, total - 1)}
            value={value}
            onChange={(e) => onSeek?.(e.target.valueAsNumber)}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
            aria-label={`Select ${stepLabel.toLowerCase()} to view`}
          />
        </div>
        <Button
          variant="ghost"
          size={showBackForwardLabels ? 'default' : 'icon'}
          className={cn('shrink-0', showBackForwardLabels && 'gap-1 px-2')}
          onClick={onNext}
          disabled={totalSteps === 0 || atEnd}
          aria-label="Forward (next step)"
        >
          {showBackForwardLabels && <span className="text-xs">Forward</span>}
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => onSeek?.(total - 1)}
          disabled={totalSteps === 0}
          aria-label="Go to last step"
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
