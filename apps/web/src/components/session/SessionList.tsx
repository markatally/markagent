import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useSessions } from '../../hooks/useSessions';
import { SessionItem } from './SessionItem';
import { ScrollArea } from '../ui/scroll-area';
import { Skeleton } from '../ui/skeleton';

export function SessionList() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { data: sessions, isLoading, error } = useSessions();

  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        <p>Failed to load sessions</p>
        <p className="text-xs mt-1">{(error as Error).message}</p>
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        <p>No sessions yet</p>
        <p className="text-xs mt-1">Create a new session to get started</p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-2 p-2">
        {sessions.map((session) => (
          <SessionItem
            key={session.id}
            session={session}
            isActive={session.id === sessionId}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
