import { DocumentRenderer } from '../canvas/DocumentRenderer';

interface MessageListProps {
  sessionId: string;
}

export function MessageList({ sessionId }: MessageListProps) {
  return <DocumentRenderer sessionId={sessionId} />;
}
