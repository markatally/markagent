import { Download, FileCode, FileImage, FileText } from 'lucide-react';
import type { Artifact } from '@mark/shared';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { triggerDownload } from '../../lib/download';

interface ArtifactCardProps {
  artifact: Artifact;
  sessionId: string;
}

function getArtifactIcon(type: Artifact['type']) {
  switch (type) {
    case 'file':
      return <FileText className="h-5 w-5" />;
    case 'image':
      return <FileImage className="h-5 w-5" />;
    case 'code':
      return <FileCode className="h-5 w-5" />;
    default:
      return <FileText className="h-5 w-5" />;
  }
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function handleDownload(
  sessionId: string,
  fileId: string | undefined,
  filename: string
): Promise<void> {
  if (!fileId) {
    console.error('No fileId provided for download');
    return;
  }

  try {
    await triggerDownload(sessionId, fileId, filename);
  } catch (error) {
    console.error('Download failed:', error);
    alert(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function ArtifactCard({ artifact, sessionId }: ArtifactCardProps) {
  const fileSize = formatFileSize(artifact.size);

  return (
    <Card className="border bg-card">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded bg-primary/10 p-2 text-primary">
              {getArtifactIcon(artifact.type)}
            </div>
            <div>
              <CardTitle className="text-base">{artifact.name}</CardTitle>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {artifact.mimeType?.split('/')[1]?.split('.')[0] || 'file'}
                </Badge>
                {fileSize !== '-' && (
                  <span className="text-xs text-muted-foreground">{fileSize}</span>
                )}
              </div>
            </div>
          </div>

          {artifact.type === 'file' && artifact.fileId ? (
            <Button
              size="sm"
              onClick={() => handleDownload(sessionId, artifact.fileId, artifact.name)}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Download
            </Button>
          ) : null}
        </div>
      </CardHeader>

      {artifact.content ? (
        <CardContent className="pt-0">
          {artifact.type === 'code' ? (
            <pre className="max-h-64 overflow-auto rounded bg-secondary p-3 text-xs font-mono">
              {artifact.content}
            </pre>
          ) : (
            <div className="max-h-48 overflow-auto rounded bg-muted/30 p-3 text-xs text-muted-foreground">
              {typeof artifact.content === 'string' ? artifact.content : '[Binary content]'}
            </div>
          )}
        </CardContent>
      ) : null}
    </Card>
  );
}
