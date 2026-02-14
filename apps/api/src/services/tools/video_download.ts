import fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { prisma } from '../prisma';
import type { Tool, ToolContext, ToolResult, ProgressCallback } from './types';
import {
  buildYtDlpMissingError,
  categorizeYtDlpError,
  resolveYtDlpRunner,
  runYtDlpCommand,
} from './video_runtime';

type ExecFileResult = { stdout: string; stderr: string };
type ExecFileFn = (
  command: string,
  args: string[],
  options?: { timeout?: number; maxBuffer?: number }
) => Promise<ExecFileResult>;

type PersistFileRecordFn = (input: {
  sessionId: string;
  filename: string;
  filepath: string;
  sizeBytes: number;
  mimeType: string;
}) => Promise<string | undefined>;

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeFilename(value: string): string {
  return path.basename(value).replace(/[\/\\:*?"<>|\x00]/g, '_');
}

function stripExtension(value: string): string {
  const parsed = path.parse(value);
  return parsed.name || value;
}

function buildFormatSelector(container: 'mp4' | 'mkv', quality: string): string {
  const maxHeight = (() => {
    if (quality === '1080p') return 1080;
    if (quality === '720p') return 720;
    if (quality === '480p') return 480;
    return null;
  })();

  if (container === 'mp4') {
    if (!maxHeight) {
      return 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';
    }
    return `bestvideo[height<=${maxHeight}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${maxHeight}][ext=mp4]/best[height<=${maxHeight}]`;
  }

  if (!maxHeight) {
    return 'bestvideo+bestaudio/best';
  }
  return `bestvideo[height<=${maxHeight}]+bestaudio/best[height<=${maxHeight}]`;
}

function getMimeTypeForContainer(container: 'mp4' | 'mkv'): string {
  return container === 'mp4' ? 'video/mp4' : 'video/x-matroska';
}

async function resolveDownloadedFilePath(
  outputDir: string,
  stem: string,
  container: 'mp4' | 'mkv',
  stdout: string
): Promise<string | null> {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const extension = `.${container}`;

  // Prefer explicit after_move path emitted by yt-dlp.
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.toLowerCase().endsWith(extension)) continue;
    const candidate = path.isAbsolute(line) ? line : path.join(outputDir, line);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }

  // Fallback: scan output directory for matching stem.
  const entries = await fs.readdir(outputDir);
  const matches = entries.filter(
    (name) => name.startsWith(`${stem}.`) && name.toLowerCase().endsWith(extension)
  );

  if (matches.length === 0) return null;

  let newestPath: string | null = null;
  let newestTime = -1;
  for (const name of matches) {
    const fullPath = path.join(outputDir, name);
    const stats = await fs.stat(fullPath);
    const mtime = stats.mtimeMs;
    if (mtime > newestTime) {
      newestPath = fullPath;
      newestTime = mtime;
    }
  }
  return newestPath;
}

export class VideoDownloadTool implements Tool {
  name = 'video_download';
  description =
    'Download a video URL into local MP4 or MKV file. Supports quality selection and optional authenticated browser cookies.';
  requiresConfirmation = true;
  timeout = 10 * 60 * 1000;

  inputSchema = {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string' as const,
        description: 'Video page URL to download.',
      },
      container: {
        type: 'string' as const,
        enum: ['mp4', 'mkv'],
        description: 'Output container format (default: mp4).',
      },
      quality: {
        type: 'string' as const,
        enum: ['best', '1080p', '720p', '480p'],
        description: 'Target quality ceiling (default: best).',
      },
      filename: {
        type: 'string' as const,
        description: 'Optional output filename (without path).',
      },
      cookiesFromBrowser: {
        type: 'string' as const,
        description:
          'Optional browser profile for authenticated downloads (e.g. chrome, edge, firefox).',
      },
    },
    required: ['url'],
  };

  private execFileFn: ExecFileFn;
  private persistFileRecord: PersistFileRecordFn;

  constructor(
    private context: ToolContext,
    deps?: {
      execFileFn?: ExecFileFn;
      persistFileRecord?: PersistFileRecordFn;
    }
  ) {
    const execFileAsync = promisify(execFile);
    this.execFileFn =
      deps?.execFileFn ??
      (async (command, args, options) => {
        const result = await execFileAsync(command, args, {
          timeout: options?.timeout,
          maxBuffer: options?.maxBuffer ?? 40 * 1024 * 1024,
        });
        return {
          stdout: typeof result.stdout === 'string' ? result.stdout : String(result.stdout),
          stderr: typeof result.stderr === 'string' ? result.stderr : String(result.stderr),
        };
      });
    this.persistFileRecord =
      deps?.persistFileRecord ??
      (async (input) => {
        const dbFile = await prisma.file.create({
          data: {
            sessionId: input.sessionId,
            filename: input.filename,
            filepath: input.filepath,
            sizeBytes: BigInt(input.sizeBytes),
            mimeType: input.mimeType,
          },
        });
        return dbFile.id;
      });
  }

  async execute(params: Record<string, any>, onProgress?: ProgressCallback): Promise<ToolResult> {
    const startTime = Date.now();
    const url = String(params.url || '').trim();
    const container = (params.container === 'mkv' ? 'mkv' : 'mp4') as 'mp4' | 'mkv';
    const quality = ['best', '1080p', '720p', '480p'].includes(String(params.quality))
      ? String(params.quality)
      : 'best';
    const cookiesFromBrowser = String(params.cookiesFromBrowser || '').trim();

    if (!url || !isHttpUrl(url)) {
      return {
        success: false,
        output: '',
        error: 'A valid http/https video URL is required',
        duration: Date.now() - startTime,
      };
    }

    onProgress?.(2, 100, 'Checking yt-dlp availability...');

    const ytDlpRunner = await resolveYtDlpRunner(this.execFileFn);
    if (!ytDlpRunner) {
      return {
        success: false,
        output: '',
        error: buildYtDlpMissingError(),
        duration: Date.now() - startTime,
      };
    }

    const outputDir = path.join(process.cwd(), 'outputs', 'video');
    await fs.mkdir(outputDir, { recursive: true });

    const requestedName = String(params.filename || '').trim();
    const stem = sanitizeFilename(
      stripExtension(requestedName) || `video-${Date.now().toString(36)}`
    );
    const template = path.join(outputDir, `${stem}.%(ext)s`);
    const formatSelector = buildFormatSelector(container, quality);

    const args = [
      '--no-playlist',
      '--newline',
      '--format',
      formatSelector,
      '--merge-output-format',
      container,
      '--output',
      template,
      '--print',
      'after_move:filepath',
    ];
    if (cookiesFromBrowser) {
      args.push('--cookies-from-browser', cookiesFromBrowser);
    }
    args.push(url);

    onProgress?.(10, 100, 'Preparing video download...');

    try {
      const { stdout, stderr } = await runYtDlpCommand(this.execFileFn, ytDlpRunner, args, {
        timeout: this.timeout,
        maxBuffer: 60 * 1024 * 1024,
      });

      onProgress?.(70, 100, 'Finalizing downloaded file...');

      const downloadedPath = await resolveDownloadedFilePath(outputDir, stem, container, stdout);
      if (!downloadedPath) {
        return {
          success: false,
          output: '',
          error: `Download finished but output file could not be located.\n${stderr || stdout}`,
          duration: Date.now() - startTime,
        };
      }

      const stats = await fs.stat(downloadedPath);
      const basename = path.basename(downloadedPath);
      const relativeFilepath = `outputs/video/${basename}`;
      const mimeType = getMimeTypeForContainer(container);

      let fileId: string | undefined;
      if (this.context.sessionId) {
        try {
          fileId = await this.persistFileRecord({
            sessionId: this.context.sessionId,
            filename: basename,
            filepath: relativeFilepath,
            sizeBytes: stats.size,
            mimeType,
          });
        } catch (error: any) {
          console.warn(
            '[video_download] Failed to persist file metadata:',
            error?.message || error
          );
        }
      }

      onProgress?.(100, 100, 'Download complete');

      return {
        success: true,
        output: [
          'Video download completed.',
          `Saved file: ${basename}`,
          `Container: ${container}`,
          `Quality policy: ${quality}`,
          `Size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`,
          `Path: ${relativeFilepath}`,
        ].join('\n'),
        duration: Date.now() - startTime,
        artifacts: [
          {
            type: 'file',
            name: basename,
            content: '',
            mimeType,
            fileId,
            size: stats.size,
          },
        ],
      };
    } catch (error: any) {
      const categorized = categorizeYtDlpError(error);
      return {
        success: false,
        output: '',
        error: JSON.stringify(categorized),
        duration: Date.now() - startTime,
      };
    }
  }
}
