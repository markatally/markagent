import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { prisma } from '../prisma';
import type { Tool, ToolContext, ToolResult, ProgressCallback } from './types';
import {
  buildYtDlpMissingError,
  buildWhisperMissingError,
  resolveYtDlpRunner,
  resolveWhisperRunner,
  runYtDlpCommand,
  runWhisperCommand,
  type YtDlpRunner,
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

interface TranscriptSegment {
  start: string;
  end: string;
  text: string;
}

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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanSubtitleText(value: string): string {
  return normalizeWhitespace(
    decodeBasicEntities(
      value
        .replace(/<[^>]*>/g, ' ')
        .replace(/\{\\an\d\}/g, ' ')
        .replace(/\[[^\]]*?\]/g, ' ')
    )
  );
}

function parseSubtitleSegments(content: string): TranscriptSegment[] {
  const blocks = content
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  const segments: TranscriptSegment[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    if (lines[0].toUpperCase() === 'WEBVTT' || lines[0].startsWith('NOTE')) {
      continue;
    }

    let timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0) continue;

    const timingLine = lines[timingIndex];
    const timingParts = timingLine.split('-->');
    if (timingParts.length < 2) continue;

    const start = normalizeWhitespace(timingParts[0]).replace(',', '.');
    const end = normalizeWhitespace(timingParts[1]).split(' ')[0].replace(',', '.');
    if (!start || !end) continue;

    const textLines = lines.slice(timingIndex + 1);
    if (textLines.length === 0) continue;

    const text = cleanSubtitleText(textLines.join(' '));
    if (!text) continue;

    const previous = segments.length > 0 ? segments[segments.length - 1] : null;
    // Collapse repeated adjacent subtitle text from auto-generated tracks.
    if (previous && previous.text === text && previous.end === start) {
      previous.end = end;
      continue;
    }

    segments.push({ start, end, text });
  }

  return segments;
}

function buildTranscriptText(
  segments: TranscriptSegment[],
  includeTimestamps: boolean
): string {
  if (includeTimestamps) {
    return segments.map((segment) => `[${segment.start} --> ${segment.end}] ${segment.text}`).join('\n');
  }
  return segments.map((segment) => segment.text).join('\n');
}

function buildSubtitleLanguageSelector(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (!normalized || normalized === 'auto') {
    return 'all,-live_chat,-danmaku';
  }

  const primary = normalized.split('-')[0];
  const candidates = new Set<string>([
    normalized,
    `${normalized}.*`,
    primary,
    `${primary}.*`,
    // Bilibili uses ai-{lang} for AI-generated subtitles (e.g. ai-zh, ai-en)
    `ai-${primary}`,
    `ai-${normalized}`,
    'en',
    'en.*',
    'ai-en',
  ]);

  return `${Array.from(candidates).join(',')},-live_chat,-danmaku`;
}

function scoreSubtitleCandidate(
  filename: string,
  preferredLanguage: string
): number {
  const normalized = filename.toLowerCase();
  const preferred = preferredLanguage.toLowerCase();
  const preferredPrimary = preferred.split('-')[0];

  let score = 0;
  if (normalized.endsWith('.vtt')) score += 40;
  else if (normalized.endsWith('.srt')) score += 30;
  else if (normalized.endsWith('.ass')) score += 20;
  else score += 5;

  if (normalized.includes(`.${preferred}.`)) score += 80;
  if (normalized.includes(`.${preferredPrimary}.`)) score += 60;
  // Bilibili AI-generated subtitles: ai-zh, ai-en, etc.
  if (normalized.includes(`.ai-${preferredPrimary}.`)) score += 70;
  if (normalized.includes(`.ai-${preferred}.`)) score += 75;
  if (normalized.includes('.en.')) score += 30;
  if (normalized.includes('.ai-en.')) score += 25;
  if (normalized.includes('.auto.')) score += 10;

  return score;
}

async function resolveSubtitlePath(
  outputDir: string,
  stem: string,
  preferredLanguage: string
): Promise<string | null> {
  const entries = await fs.readdir(outputDir);
  const candidates = entries.filter((name) => {
    const lower = name.toLowerCase();
    return (
      name.startsWith(`${stem}.`) &&
      (lower.endsWith('.vtt') || lower.endsWith('.srt') || lower.endsWith('.ass'))
    );
  });

  if (candidates.length === 0) return null;

  const ranked = candidates
    .map((filename) => ({
      filename,
      score: scoreSubtitleCandidate(filename, preferredLanguage),
    }))
    .sort((a, b) => b.score - a.score);

  return path.join(outputDir, ranked[0].filename);
}

export class VideoTranscriptTool implements Tool {
  name = 'video_transcript';
  description =
    'Extract full transcript text from a video URL. Tries subtitle tracks first; if none exist, falls back to Whisper speech-to-text transcription.';
  requiresConfirmation = false;
  timeout = 300000;

  inputSchema = {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string' as const,
        description: 'Video page URL to extract transcript from.',
      },
      language: {
        type: 'string' as const,
        description: 'Preferred subtitle language (default: en). Use "auto" to accept any language.',
      },
      includeTimestamps: {
        type: 'boolean' as const,
        description: 'Include [start --> end] timestamps in transcript text (default: true).',
      },
      filename: {
        type: 'string' as const,
        description: 'Optional transcript filename stem (without extension).',
      },
      cookiesFromBrowser: {
        type: 'string' as const,
        description:
          'Optional browser profile for authenticated pages (e.g. chrome, edge, firefox).',
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
          maxBuffer: options?.maxBuffer ?? 30 * 1024 * 1024,
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
    const language = String(params.language || 'en').trim() || 'en';
    const includeTimestamps = params.includeTimestamps !== false;
    const cookiesFromBrowser = String(params.cookiesFromBrowser || '').trim();

    if (!url || !isHttpUrl(url)) {
      return {
        success: false,
        output: '',
        error: 'A valid http/https video URL is required',
        duration: Date.now() - startTime,
      };
    }

    const ytDlpRunner = await resolveYtDlpRunner(this.execFileFn);
    if (!ytDlpRunner) {
      return {
        success: false,
        output: '',
        error: buildYtDlpMissingError(),
        duration: Date.now() - startTime,
      };
    }

    const outputDir = path.join(process.cwd(), 'outputs', 'transcripts');
    await fs.mkdir(outputDir, { recursive: true });

    const requestedName = String(params.filename || '').trim();
    const stem = sanitizeFilename(
      stripExtension(requestedName) || `transcript-${Date.now().toString(36)}`
    );

    onProgress?.(10, 100, 'Fetching available subtitle tracks...');

    // Attempt subtitle extraction — if cookies were provided, use them directly.
    // Otherwise try without cookies first, then auto-retry with browser cookies
    // if yt-dlp reports that authentication is required.
    const effectiveCookies = cookiesFromBrowser;
    const subtitleResult = await this.attemptSubtitleExtraction({
      url,
      language,
      cookiesFromBrowser: effectiveCookies,
      stem,
      outputDir,
      ytDlpRunner,
    });

    if (subtitleResult.subtitlePath) {
      // Subtitles found on first attempt
      return this.processSubtitleFile({
        subtitlePath: subtitleResult.subtitlePath,
        language,
        includeTimestamps,
        stem,
        outputDir,
        startTime,
        onProgress,
      });
    }

    // No subtitles found. If auth was hinted and no cookies were provided,
    // auto-retry with detected browser cookies.
    if (!effectiveCookies && subtitleResult.authRequired) {
      onProgress?.(30, 100, 'Subtitles require authentication, retrying with browser cookies...');

      const browserCandidates = ['chrome', 'edge', 'firefox', 'safari'];
      for (const browser of browserCandidates) {
        // Clean up any stale files from the previous attempt
        await this.cleanSubtitleFiles(outputDir, stem);

        const retryResult = await this.attemptSubtitleExtraction({
          url,
          language,
          cookiesFromBrowser: browser,
          stem,
          outputDir,
          ytDlpRunner,
        });

        if (retryResult.subtitlePath) {
          return this.processSubtitleFile({
            subtitlePath: retryResult.subtitlePath,
            language,
            includeTimestamps,
            stem,
            outputDir,
            startTime,
            onProgress,
          });
        }

        // If this browser's cookies worked (no error) but still no subs, stop trying others
        if (!retryResult.error) break;
      }
    }

    // If the first attempt had a hard error (not auth-related), return it
    if (subtitleResult.error && !subtitleResult.authRequired) {
      return {
        success: false,
        output: '',
        error: subtitleResult.error,
        duration: Date.now() - startTime,
      };
    }

    // No subtitle track found — fall back to Whisper speech-to-text
    onProgress?.(60, 100, 'No subtitles found, falling back to Whisper transcription...');
    return this.whisperFallback({
      url,
      language,
      includeTimestamps,
      cookiesFromBrowser: effectiveCookies,
      stem,
      outputDir,
      startTime,
      onProgress,
      ytDlpRunner,
    });
  }

  /**
   * Run yt-dlp to download subtitle tracks for a video.
   * Returns the resolved subtitle path (if any), whether auth was required,
   * and any error message.
   */
  private async attemptSubtitleExtraction(opts: {
    url: string;
    language: string;
    cookiesFromBrowser: string;
    stem: string;
    outputDir: string;
    ytDlpRunner: YtDlpRunner;
  }): Promise<{ subtitlePath: string | null; authRequired: boolean; error?: string }> {
    const { url, language, cookiesFromBrowser, stem, outputDir, ytDlpRunner } = opts;

    const subtitleSelector = buildSubtitleLanguageSelector(language);
    const subtitleTemplate = path.join(outputDir, `${stem}.%(ext)s`);
    const subtitleArgs = [
      '--no-playlist',
      '--skip-download',
      // NOTE: do NOT use --no-warnings here — we need stderr warnings
      // to detect auth requirements (e.g. Bilibili "logged in" hint).
      '--write-subs',
      '--write-auto-subs',
      '--sub-format',
      'vtt/srt/best',
      '--sub-langs',
      subtitleSelector,
      '--output',
      subtitleTemplate,
    ];
    if (cookiesFromBrowser) {
      subtitleArgs.push('--cookies-from-browser', cookiesFromBrowser);
    }
    subtitleArgs.push(url);

    let stderr = '';
    try {
      const result = await runYtDlpCommand(this.execFileFn, ytDlpRunner, subtitleArgs, {
        timeout: this.timeout,
        maxBuffer: 30 * 1024 * 1024,
      });
      stderr = result.stderr || '';
    } catch (error: any) {
      stderr = error?.stderr || '';
      const isAuthHint = /logged in|login|authentication/i.test(stderr);
      if (isAuthHint) {
        return { subtitlePath: null, authRequired: true };
      }
      return {
        subtitlePath: null,
        authRequired: false,
        error: error?.stderr || error?.message || 'Failed to fetch subtitles',
      };
    }

    const subtitlePath = await resolveSubtitlePath(outputDir, stem, language);
    const authRequired = !subtitlePath && /logged in|login|authentication/i.test(stderr);

    return { subtitlePath, authRequired };
  }

  /**
   * Read, parse, and return a transcript result from a resolved subtitle file.
   */
  private async processSubtitleFile(opts: {
    subtitlePath: string;
    language: string;
    includeTimestamps: boolean;
    stem: string;
    outputDir: string;
    startTime: number;
    onProgress?: ProgressCallback;
  }): Promise<ToolResult> {
    const { subtitlePath, language, includeTimestamps, stem, outputDir, startTime, onProgress } = opts;

    onProgress?.(55, 100, 'Parsing subtitle transcript...');
    const subtitleContent = await fs.readFile(subtitlePath, 'utf8');
    const segments = parseSubtitleSegments(subtitleContent);

    if (segments.length === 0) {
      return {
        success: false,
        output: '',
        error: `Subtitle file was downloaded but no transcript content could be parsed: ${path.basename(subtitlePath)}`,
        duration: Date.now() - startTime,
      };
    }

    return this.buildTranscriptResult({
      segments,
      source: path.basename(subtitlePath),
      language,
      includeTimestamps,
      stem,
      outputDir,
      startTime,
      onProgress,
    });
  }

  /**
   * Remove any subtitle files from a previous attempt for the given stem.
   */
  private async cleanSubtitleFiles(outputDir: string, stem: string): Promise<void> {
    try {
      const entries = await fs.readdir(outputDir);
      for (const entry of entries) {
        if (
          entry.startsWith(`${stem}.`) &&
          (entry.endsWith('.vtt') || entry.endsWith('.srt') || entry.endsWith('.ass'))
        ) {
          await fs.rm(path.join(outputDir, entry), { force: true }).catch(() => {});
        }
      }
    } catch {
      // Directory may not exist yet
    }
  }

  private async buildTranscriptResult(opts: {
    segments: TranscriptSegment[];
    source: string;
    language: string;
    includeTimestamps: boolean;
    stem: string;
    outputDir: string;
    startTime: number;
    onProgress?: ProgressCallback;
  }): Promise<ToolResult> {
    const { segments, source, language, includeTimestamps, stem, outputDir, startTime, onProgress } = opts;

    const transcriptText = buildTranscriptText(segments, includeTimestamps);
    const transcriptFilename = `${stem}.transcript.txt`;
    const transcriptPath = path.join(outputDir, transcriptFilename);
    await fs.writeFile(transcriptPath, transcriptText, 'utf8');

    const transcriptStats = await fs.stat(transcriptPath);
    const relativeTranscriptPath = `outputs/transcripts/${transcriptFilename}`;

    let fileId: string | undefined;
    if (this.context.sessionId) {
      try {
        fileId = await this.persistFileRecord({
          sessionId: this.context.sessionId,
          filename: transcriptFilename,
          filepath: relativeTranscriptPath,
          sizeBytes: transcriptStats.size,
          mimeType: 'text/plain',
        });
      } catch (error: any) {
        console.warn(
          '[video_transcript] Failed to persist transcript metadata:',
          error?.message || error
        );
      }
    }

    onProgress?.(100, 100, 'Transcript extraction complete');

    // Include truncated transcript text in output so it flows into conversation history
    const MAX_OUTPUT_TEXT = 8 * 1024;
    const truncatedText = transcriptText.length > MAX_OUTPUT_TEXT
      ? transcriptText.slice(0, MAX_OUTPUT_TEXT) + '\n...[truncated]'
      : transcriptText;

    const summary = [
      'Transcript extraction completed.',
      `Source: ${source}`,
      `Segments: ${segments.length}`,
      `Transcript file: ${transcriptFilename}`,
      `Path: ${relativeTranscriptPath}`,
      '',
      '--- Transcript ---',
      truncatedText,
    ].join('\n');

    return {
      success: true,
      output: summary,
      duration: Date.now() - startTime,
      artifacts: [
        {
          type: 'file',
          name: transcriptFilename,
          content: '',
          mimeType: 'text/plain',
          fileId,
          size: transcriptStats.size,
        },
        {
          type: 'data',
          name: 'video-transcript.json',
          content: JSON.stringify({
            source,
            language,
            includeTimestamps,
            segmentCount: segments.length,
            transcript: transcriptText,
            segments,
          }),
          mimeType: 'application/json',
        },
      ],
    };
  }

  private resolveWhisperLanguage(language: string): string | null {
    const normalized = language.trim().toLowerCase();
    if (!normalized || normalized === 'auto') return null;

    const mapping: Record<string, string> = {
      'zh-hans': 'zh',
      'zh-hant': 'zh',
      'zh-cn': 'zh',
      'zh-tw': 'zh',
      'chinese': 'zh',
      'english': 'en',
      'japanese': 'ja',
      'korean': 'ko',
      'french': 'fr',
      'german': 'de',
      'spanish': 'es',
      'russian': 'ru',
      'portuguese': 'pt',
      'arabic': 'ar',
    };

    return mapping[normalized] ?? normalized.split('-')[0];
  }

  private async whisperFallback(opts: {
    url: string;
    language: string;
    includeTimestamps: boolean;
    cookiesFromBrowser: string;
    stem: string;
    outputDir: string;
    startTime: number;
    onProgress?: ProgressCallback;
    ytDlpRunner: { command: string; baseArgs: string[]; label: string };
  }): Promise<ToolResult> {
    const { url, language, includeTimestamps, cookiesFromBrowser, stem, outputDir, startTime, onProgress, ytDlpRunner } = opts;

    // 1. Resolve whisper runner
    const whisperRunner = await resolveWhisperRunner(this.execFileFn);
    if (!whisperRunner) {
      return {
        success: false,
        output: '',
        error: buildWhisperMissingError(),
        duration: Date.now() - startTime,
      };
    }

    // 2. Extract audio via yt-dlp
    const audioPath = path.join(outputDir, `${stem}.wav`);
    const audioArgs = [
      '--no-playlist',
      '--no-warnings',
      '--extract-audio',
      '--audio-format', 'wav',
      '--output', audioPath,
    ];
    if (cookiesFromBrowser) {
      audioArgs.push('--cookies-from-browser', cookiesFromBrowser);
    }
    audioArgs.push(url);

    onProgress?.(65, 100, 'Extracting audio for Whisper transcription...');

    try {
      await runYtDlpCommand(this.execFileFn, ytDlpRunner, audioArgs, {
        timeout: this.timeout,
        maxBuffer: 30 * 1024 * 1024,
      });
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: `Failed to extract audio for Whisper: ${error?.stderr || error?.message || 'unknown error'}`,
        duration: Date.now() - startTime,
      };
    }

    // Verify audio file exists
    try {
      await fs.access(audioPath);
    } catch {
      return {
        success: false,
        output: '',
        error: 'Audio extraction completed but WAV file was not found.',
        duration: Date.now() - startTime,
      };
    }

    // 3. Run whisper
    onProgress?.(75, 100, 'Running Whisper speech-to-text (this may take a few minutes)...');

    const whisperArgs = [audioPath, '--model', 'medium', '--output_format', 'srt', '--output_dir', outputDir];
    const whisperLang = this.resolveWhisperLanguage(language);
    if (whisperLang) {
      whisperArgs.push('--language', whisperLang);
    }

    try {
      await runWhisperCommand(this.execFileFn, whisperRunner, whisperArgs, {
        timeout: this.timeout,
        maxBuffer: 30 * 1024 * 1024,
      });
    } catch (error: any) {
      // Clean up audio file
      await fs.rm(audioPath, { force: true }).catch(() => {});
      return {
        success: false,
        output: '',
        error: `Whisper transcription failed: ${error?.stderr || error?.message || 'unknown error'}`,
        duration: Date.now() - startTime,
      };
    }

    // 4. Parse SRT output
    const srtPath = path.join(outputDir, `${stem}.srt`);
    let srtContent: string;
    try {
      srtContent = await fs.readFile(srtPath, 'utf8');
    } catch {
      // Clean up audio file
      await fs.rm(audioPath, { force: true }).catch(() => {});
      return {
        success: false,
        output: '',
        error: 'Whisper completed but SRT output file was not found.',
        duration: Date.now() - startTime,
      };
    }

    const segments = parseSubtitleSegments(srtContent);

    // 5. Clean up temporary audio file
    await fs.rm(audioPath, { force: true }).catch(() => {});

    if (segments.length === 0) {
      return {
        success: false,
        output: '',
        error: 'Whisper transcription produced no recognizable speech segments.',
        duration: Date.now() - startTime,
      };
    }

    // 6. Build result using shared method
    return this.buildTranscriptResult({
      segments,
      source: `whisper:${path.basename(srtPath)}`,
      language,
      includeTimestamps,
      stem,
      outputDir,
      startTime,
      onProgress,
    });
  }
}
