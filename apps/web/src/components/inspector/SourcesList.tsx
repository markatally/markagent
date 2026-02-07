import { useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { SourceFavicon } from './SourceFavicon';

interface SourcesListProps {
  sessionId: string;
  selectedMessageId?: string | null;
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)]+/g) || [];
  return matches.map((url) => url.replace(/[),.]+$/, ''));
}

export function SourcesList({ sessionId, selectedMessageId }: SourcesListProps) {
  const toolCalls = useChatStore((state) => state.toolCalls);

  const sources = useMemo(() => {
    const urls = new Set<string>();
    const sessionToolCalls = Array.from(toolCalls.values()).filter((call) => {
      if (call.sessionId !== sessionId) return false;
      if (selectedMessageId) {
        return call.messageId === selectedMessageId;
      }
      return true;
    });

    for (const call of sessionToolCalls) {
      if (call.result?.output) {
        extractUrls(call.result.output).forEach((url) => urls.add(url));
      }

      for (const artifact of call.result?.artifacts || []) {
        if (typeof artifact.content === 'string') {
          extractUrls(artifact.content).forEach((url) => urls.add(url));
        }
      }
    }

    return Array.from(urls);
  }, [toolCalls, sessionId, selectedMessageId]);

  if (sources.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
        No sources detected yet.
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      {sources.map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-muted-foreground transition hover:text-foreground"
        >
          <SourceFavicon url={url} />
          <span className="truncate flex-1 min-w-0">{url}</span>
          <ExternalLink className="h-4 w-4 shrink-0" />
        </a>
      ))}
    </div>
  );
}
