import { useMemo } from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar';
import { cn } from '../../lib/utils';

interface SourceFaviconProps {
  url: string;
  className?: string;
}

function getDomain(url: string): string | null {
  try {
    const u = new URL(url);
    let host = u.hostname || '';
    if (host.startsWith('www.')) host = host.slice(4);
    return host || null;
  } catch {
    return null;
  }
}

function getDomainInitials(domain: string): string {
  const parts = domain.split('.');
  if (parts.length >= 2) {
    const name = parts[parts.length - 2];
    if (name.length >= 2) {
      return name.slice(0, 2).toUpperCase();
    }
    return name.slice(0, 1).toUpperCase();
  }
  if (domain.length >= 2) return domain.slice(0, 2).toUpperCase();
  return domain.slice(0, 1).toUpperCase() || '?';
}

export function SourceFavicon({ url, className }: SourceFaviconProps) {
  const { domain, faviconUrl, initials } = useMemo(() => {
    const d = getDomain(url);
    if (!d) return { domain: '', faviconUrl: '', initials: '?' };
    const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(d)}&sz=32`;
    return { domain: d, faviconUrl: favicon, initials: getDomainInitials(d) };
  }, [url]);

  if (!domain) {
    return (
      <Avatar className={cn('h-5 w-5 shrink-0', className)}>
        <AvatarFallback className="text-[10px] font-medium">?</AvatarFallback>
      </Avatar>
    );
  }

  return (
    <Avatar className={cn('h-5 w-5 shrink-0', className)}>
      <AvatarImage src={faviconUrl} alt={domain} />
      <AvatarFallback className="text-[10px] font-medium text-muted-foreground">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
