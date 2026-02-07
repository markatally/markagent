import { Check, Loader2, X } from 'lucide-react';
import { cn } from '../../lib/utils';

type StatusIconSize = 'sm' | 'md';
type StatusIconState = 'running' | 'completed' | 'failed';

interface StatusIconProps {
  status: StatusIconState;
  size?: StatusIconSize;
  className?: string;
}

const SIZE_STYLES: Record<StatusIconSize, { circle: string; icon: string }> = {
  sm: {
    circle: 'h-4 w-4 min-h-4 min-w-4',
    icon: 'h-3 w-3',
  },
  md: {
    circle: 'h-6 w-6 min-h-6 min-w-6',
    icon: 'h-3.5 w-3.5',
  },
};

export function StatusIcon({ status, size = 'md', className }: StatusIconProps) {
  const styles = SIZE_STYLES[size];

  if (status === 'failed') {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full bg-red-500 text-white',
          styles.circle,
          className
        )}
      >
        <X className={styles.icon} strokeWidth={2.5} />
      </span>
    );
  }

  if (status === 'running') {
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50/50 text-blue-600',
          styles.circle,
          className
        )}
      >
        <Loader2 className={cn(styles.icon, 'animate-spin')} strokeWidth={2.5} />
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-green-500 text-white',
        styles.circle,
        className
      )}
    >
      <Check className={styles.icon} strokeWidth={2.5} />
    </span>
  );
}
