import { FileText, FileImage, FileCode, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import type { Artifact } from '@mark/shared';
import { filesApi } from '../../lib/api';

interface ArtifactDisplayProps {
  artifact: Artifact;
  sessionId: string;
}

/**
 * Get icon based on artifact type
 */
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

/**
 * Get file size in human readable format
 */
function formatFileSize(bytes?: number): string {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Handle file download with proper error handling
 * Uses fetch + blob to ensure the file is properly downloaded
 */
async function handleDownload(
  e: React.MouseEvent<HTMLButtonElement>,
  sessionId: string,
  fileId: string | undefined,
  filename: string
): Promise<void> {
  e.preventDefault();

  if (!fileId) {
    console.error('No fileId provided for download');
    return;
  }

  try {
    // Use authenticated API call to include auth headers
    const blob = await filesApi.download(sessionId, fileId);

    // Create download URL from blob
    const downloadUrl = URL.createObjectURL(blob);

    // Create temporary link and trigger download
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up
    URL.revokeObjectURL(downloadUrl);
  } catch (error) {
    console.error('Download failed:', error);
    alert(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function ArtifactDisplay({ artifact, sessionId }: ArtifactDisplayProps) {
  const fileSize = formatFileSize(artifact.size);

  return (
    <Card className="mt-2 border-l-4 border-l-muted-foreground/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded">
              {getArtifactIcon(artifact.type)}
            </div>
            <div>
              <CardTitle className="text-base">{artifact.name}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-xs">
                  {artifact.mimeType?.split('/')[1]?.split('.')[0] || 'file'}
                </Badge>
                {fileSize !== '-' && (
                  <span className="text-xs text-muted-foreground">
                    {fileSize}
                  </span>
                )}
              </div>
            </div>
          </div>
          {artifact.type === 'file' && artifact.fileId && (
            <button
              onClick={(e) => handleDownload(e, sessionId, artifact.fileId, artifact.name)}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded hover:bg-primary/90 transition-colors cursor-pointer"
            >
              <Download className="h-4 w-4" />
              Download
            </button>
          )}
        </div>
      </CardHeader>

      {artifact.content && (
        <CardContent className="pt-0">
          {artifact.type === 'code' ? (
            <pre className="text-xs bg-secondary p-3 rounded overflow-auto max-h-64 font-mono">
              {artifact.content}
            </pre>
          ) : (
            <div className="text-xs text-muted-foreground p-3 bg-muted/30 rounded max-h-48 overflow-auto">
              {typeof artifact.content === 'string' ? artifact.content : '[Binary content]'}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
