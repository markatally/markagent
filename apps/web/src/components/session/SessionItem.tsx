import { formatDistanceToNow } from 'date-fns';
import { MessageSquare, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@mark/shared';
import { cn } from '../../lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '../ui/alert-dialog';
import { Button } from '../ui/button';
import { useDeleteSession } from '../../hooks/useSessions';

interface SessionItemProps {
  session: Session & { _count?: { messages: number } };
  isActive?: boolean;
}

export function SessionItem({ session, isActive }: SessionItemProps) {
  const navigate = useNavigate();
  const deleteSession = useDeleteSession();

  const handleClick = () => {
    navigate(`/chat/${session.id}`);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    deleteSession.mutate(session.id);
  };

  const messageCount = session._count?.messages ?? 0;
  const timeAgo = formatDistanceToNow(new Date(session.lastActiveAt), {
    addSuffix: true,
  });

  return (
    <div
      className={cn(
        'group relative flex cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors hover:bg-accent',
        isActive && 'bg-accent border-primary'
      )}
      onClick={handleClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 overflow-hidden">
          <h3 className="truncate font-medium text-sm">
            {session.name || 'Untitled Session'}
          </h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              <span>{messageCount}</span>
            </div>
            <span>•</span>
            <span>{timeAgo}</span>
          </div>
        </div>

        {/* Delete button */}
        <AlertDialog>
          <AlertDialogTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete session?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete "{session.name || 'Untitled Session'}" and
                all its messages. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
