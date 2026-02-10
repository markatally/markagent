import { useEffect, useRef } from 'react';
import { useBrowserStream } from '../../hooks/useBrowserStream';
import { cn } from '../../lib/utils';

const ASPECT_RATIO = 16 / 9;

interface BrowserViewportProps {
  sessionId: string | null;
  enabled: boolean;
  snapshotUrl?: string | null;
  /** When false, show stored snapshot instead of live WebSocket frame (e.g. when scrubbing history) */
  showLive?: boolean;
  /** When true, fill parent height and use minHeight instead of fixed 16:9 aspect ratio */
  fillHeight?: boolean;
  minHeight?: number;
  className?: string;
}

/**
 * Renders live browser screencast frames on a canvas.
 * Connects to WebSocket and draws JPEG frames as they arrive.
 */
export function BrowserViewport({
  sessionId,
  enabled,
  snapshotUrl,
  showLive = true,
  fillHeight = false,
  minHeight = 320,
  className,
}: BrowserViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { frameDataUrl, status, error } = useBrowserStream(sessionId, enabled);
  const displayLive = showLive !== false && !!frameDataUrl;
  const viewportStyle = fillHeight
    ? ({ minHeight } as const)
    : ({ aspectRatio: ASPECT_RATIO } as const);

  useEffect(() => {
    if (!frameDataUrl || !canvasRef.current) return;

    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio ?? 1;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.scale(dpr, dpr);

      const scale = Math.min(w / img.width, h / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const x = (w - drawW) / 2;
      const y = (h - drawH) / 2;

      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, x, y, drawW, drawH);
    };
    img.src = frameDataUrl;
  }, [frameDataUrl]);

  if (!enabled && !snapshotUrl) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border bg-muted/20 text-sm text-muted-foreground',
          className
        )}
        style={viewportStyle}
      >
        Browser view is off
      </div>
    );
  }

  if (enabled && status === 'connecting') {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border bg-muted/20 text-sm text-muted-foreground',
          className
        )}
        style={viewportStyle}
      >
        Connecting...
      </div>
    );
  }

  if (status === 'error' || error) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 text-sm text-destructive',
          className
        )}
        style={viewportStyle}
      >
        {error ?? 'Connection failed'}
      </div>
    );
  }

  if (status === 'closed' && !frameDataUrl && !snapshotUrl) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border bg-muted/20 text-sm text-muted-foreground',
          className
        )}
        style={viewportStyle}
      >
        No browser session
      </div>
    );
  }

  return (
    <div
      data-testid="browser-viewport"
      className={cn('overflow-hidden rounded-lg border bg-black', fillHeight && 'min-h-0 flex-1', className)}
      style={viewportStyle}
    >
      {displayLive ? (
        <canvas
          ref={canvasRef}
          className="h-full max-h-full w-full object-contain"
          style={{ width: '100%', height: '100%' }}
        />
      ) : snapshotUrl ? (
        <img
          data-testid="browser-viewport-screenshot"
          src={snapshotUrl}
          alt="Browser screenshot"
          className="h-full max-h-full w-full object-contain"
        />
      ) : frameDataUrl ? (
        <canvas
          ref={canvasRef}
          className="h-full max-h-full w-full object-contain"
          style={{ width: '100%', height: '100%' }}
        />
      ) : null}
    </div>
  );
}
