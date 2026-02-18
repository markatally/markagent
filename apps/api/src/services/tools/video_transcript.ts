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
import { extractPreviewSnapshots } from './video_preview_snapshots';

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

interface ParsedTimestampRange {
  start: number;
  end: number;
}

interface TranscriptTimeoutProfile {
  subtitleFetchMs: number;
  audioExtractMs: number;
  whisperMs: number;
  snapshotMs: number;
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

  const rawSegments: TranscriptSegment[] = [];

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

    rawSegments.push({ start, end, text });
  }

  return normalizeSubtitleSegments(rawSegments);
}

function parseTimestampToSeconds(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  const match = normalized.match(/^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function formatTimestampForOutput(value: string): string {
  const totalSeconds = parseTimestampToSeconds(value);
  if (totalSeconds == null) return value;

  const totalMilliseconds = Math.round(totalSeconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const secondsWhole = Math.floor((totalMilliseconds % 60_000) / 1_000);
  const milliseconds = totalMilliseconds % 1_000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    secondsWhole
  ).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

function parseRange(segment: TranscriptSegment): ParsedTimestampRange | null {
  const start = parseTimestampToSeconds(segment.start);
  const end = parseTimestampToSeconds(segment.end);
  if (start == null || end == null) return null;
  return { start, end };
}

function areNearBoundary(previousEnd: number, nextStart: number, toleranceSeconds = 0.2): boolean {
  return Math.abs(nextStart - previousEnd) <= toleranceSeconds;
}

function durationSeconds(range: ParsedTimestampRange): number {
  return Math.max(0, range.end - range.start);
}

function findOverlapSuffixPrefix(previousText: string, currentText: string): number {
  const maxLen = Math.min(previousText.length, currentText.length);
  for (let len = maxLen; len >= 8; len -= 1) {
    if (previousText.slice(-len) === currentText.slice(0, len)) {
      return len;
    }
  }
  return 0;
}

function normalizeSubtitleSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const normalized: TranscriptSegment[] = [];

  for (const current of segments) {
    if (normalized.length === 0) {
      normalized.push({ ...current });
      continue;
    }

    const previous = normalized[normalized.length - 1];
    const previousRange = parseRange(previous);
    const currentRange = parseRange(current);

    // If ranges are unparseable, preserve previous behavior and keep both.
    if (!previousRange || !currentRange) {
      normalized.push({ ...current });
      continue;
    }

    if (!areNearBoundary(previousRange.end, currentRange.start)) {
      normalized.push({ ...current });
      continue;
    }

    if (previous.text === current.text) {
      previous.end = current.end;
      continue;
    }

    // Progressive cues often repeat previous text and append more words.
    if (current.text.startsWith(previous.text)) {
      previous.text = current.text;
      previous.end = current.end;
      continue;
    }

    // Some tracks emit micro-cues that "roll back" to a short repeated snippet.
    if (previous.text.includes(current.text) && durationSeconds(currentRange) <= 0.35) {
      previous.end = current.end;
      continue;
    }

    // Trim textual overlap so only new continuation words are emitted.
    const overlap = findOverlapSuffixPrefix(previous.text, current.text);
    if (overlap > 0) {
      const remainingText = normalizeWhitespace(current.text.slice(overlap));
      if (!remainingText) {
        previous.end = current.end;
        continue;
      }
      normalized.push({
        start: current.start,
        end: current.end,
        text: remainingText,
      });
      continue;
    }

    normalized.push({ ...current });
  }

  return normalized;
}

function buildTranscriptText(
  segments: TranscriptSegment[],
  includeTimestamps: boolean
): string {
  if (includeTimestamps) {
    return segments
      .map(
        (segment) =>
          `[${formatTimestampForOutput(segment.start)} --> ${formatTimestampForOutput(
            segment.end
          )}] ${segment.text}`
      )
      .join('\n');
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

function toFinitePositiveNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export class VideoTranscriptTool implements Tool {
  name = 'video_transcript';
  description =
    'Extract full transcript text from a video URL. Tries subtitle tracks first; if none exist, falls back to Whisper speech-to-text transcription.';
  requiresConfirmation = false;
  timeout = 900000;

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
      durationSeconds: {
        type: 'number' as const,
        description:
          'Optional known video duration in seconds (for dynamic timeout tuning). If omitted, the tool will probe metadata.',
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

    const hintedDurationSeconds = toFinitePositiveNumber(params.durationSeconds);
    const resolvedDurationSeconds =
      hintedDurationSeconds ??
      (await this.resolveVideoDurationSeconds(url, cookiesFromBrowser, ytDlpRunner));
    const timeoutProfile = this.buildTimeoutProfile(resolvedDurationSeconds);

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
      commandTimeoutMs: timeoutProfile.subtitleFetchMs,
    });

    if (subtitleResult.subtitlePath) {
      // Subtitles found on first attempt
      return this.processSubtitleFile({
        subtitlePath: subtitleResult.subtitlePath,
        url,
        language,
        includeTimestamps,
        cookiesFromBrowser: effectiveCookies,
        ytDlpRunner,
        stem,
        outputDir,
        startTime,
        onProgress,
        snapshotTimeoutMs: timeoutProfile.snapshotMs,
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
          commandTimeoutMs: timeoutProfile.subtitleFetchMs,
        });

        if (retryResult.subtitlePath) {
          return this.processSubtitleFile({
            subtitlePath: retryResult.subtitlePath,
            url,
            language,
            includeTimestamps,
            cookiesFromBrowser: browser,
            ytDlpRunner,
            stem,
            outputDir,
            startTime,
            onProgress,
            snapshotTimeoutMs: timeoutProfile.snapshotMs,
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
      audioExtractTimeoutMs: timeoutProfile.audioExtractMs,
      whisperTimeoutMs: timeoutProfile.whisperMs,
      snapshotTimeoutMs: timeoutProfile.snapshotMs,
    });
  }

  private async resolveVideoDurationSeconds(
    url: string,
    cookiesFromBrowser: string,
    ytDlpRunner: YtDlpRunner
  ): Promise<number | null> {
    const args = ['--no-playlist', '--dump-single-json', '--no-warnings'];
    if (cookiesFromBrowser) {
      args.push('--cookies-from-browser', cookiesFromBrowser);
    }
    args.push(url);

    try {
      const { stdout } = await runYtDlpCommand(this.execFileFn, ytDlpRunner, args, {
        timeout: Math.max(45000, Math.floor(this.timeout / 2)),
        maxBuffer: 20 * 1024 * 1024,
      });
      const parsed = JSON.parse(stdout || '{}');
      return toFinitePositiveNumber(parsed?.duration);
    } catch {
      return null;
    }
  }

  private buildTimeoutProfile(durationSeconds: number | null): TranscriptTimeoutProfile {
    const baseline = this.timeout;
    if (!durationSeconds) {
      return {
        subtitleFetchMs: baseline,
        audioExtractMs: baseline,
        whisperMs: baseline,
        snapshotMs: baseline,
      };
    }

    // Dynamic scaling by media length (no fixed one-size limit).
    const subtitleFetchMs = Math.max(
      baseline,
      Math.round((durationSeconds * 0.35 + 120) * 1000)
    );
    const audioExtractMs = Math.max(
      baseline,
      Math.round((durationSeconds * 1.25 + 180) * 1000)
    );
    const whisperMs = Math.max(
      baseline,
      Math.round((durationSeconds * 4.0 + 240) * 1000)
    );
    const snapshotMs = Math.max(
      baseline,
      Math.round((durationSeconds * 0.8 + 120) * 1000)
    );

    return { subtitleFetchMs, audioExtractMs, whisperMs, snapshotMs };
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
    commandTimeoutMs: number;
  }): Promise<{ subtitlePath: string | null; authRequired: boolean; error?: string }> {
    const { url, language, cookiesFromBrowser, stem, outputDir, ytDlpRunner, commandTimeoutMs } = opts;

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
        timeout: commandTimeoutMs,
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
    url: string;
    language: string;
    includeTimestamps: boolean;
    cookiesFromBrowser: string;
    ytDlpRunner: YtDlpRunner;
    stem: string;
    outputDir: string;
    startTime: number;
    onProgress?: ProgressCallback;
    snapshotTimeoutMs: number;
  }): Promise<ToolResult> {
    const {
      subtitlePath,
      url,
      language,
      includeTimestamps,
      cookiesFromBrowser,
      ytDlpRunner,
      stem,
      outputDir,
      startTime,
      onProgress,
      snapshotTimeoutMs,
    } = opts;

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
      url,
      language,
      includeTimestamps,
      cookiesFromBrowser,
      ytDlpRunner,
      stem,
      outputDir,
      startTime,
      onProgress,
      snapshotTimeoutMs,
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
    url: string;
    language: string;
    includeTimestamps: boolean;
    cookiesFromBrowser: string;
    ytDlpRunner: YtDlpRunner;
    stem: string;
    outputDir: string;
    startTime: number;
    onProgress?: ProgressCallback;
    snapshotTimeoutMs: number;
  }): Promise<ToolResult> {
    const {
      segments,
      source,
      url,
      language,
      includeTimestamps,
      cookiesFromBrowser,
      ytDlpRunner,
      stem,
      outputDir,
      startTime,
      onProgress,
      snapshotTimeoutMs,
    } = opts;

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

    const previewSnapshots = await this.capturePreviewSnapshots({
      url,
      cookiesFromBrowser,
      ytDlpRunner,
      stem,
      outputDir,
      onProgress,
      snapshotTimeoutMs,
    });

    onProgress?.(100, 100, 'Transcript extraction complete');

    const summary = [
      'Transcript extraction completed.',
      `Source: ${source}`,
      `Segments: ${segments.length}`,
      `Transcript file: ${transcriptFilename}`,
      `Path: ${relativeTranscriptPath}`,
      ...(previewSnapshots.length > 0
        ? [
            `Snapshots: ${previewSnapshots.length} frame${
              previewSnapshots.length === 1 ? '' : 's'
            } sampled across video timeline`,
          ]
        : []),
      '',
      '--- Transcript ---',
      transcriptText,
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
      ],
      previewSnapshots: previewSnapshots.length > 0 ? previewSnapshots : undefined,
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
    audioExtractTimeoutMs: number;
    whisperTimeoutMs: number;
    snapshotTimeoutMs: number;
  }): Promise<ToolResult> {
    const {
      url,
      language,
      includeTimestamps,
      cookiesFromBrowser,
      stem,
      outputDir,
      startTime,
      onProgress,
      ytDlpRunner,
      audioExtractTimeoutMs,
      whisperTimeoutMs,
      snapshotTimeoutMs,
    } = opts;

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
        timeout: audioExtractTimeoutMs,
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
        timeout: whisperTimeoutMs,
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
      url,
      language,
      includeTimestamps,
      cookiesFromBrowser,
      ytDlpRunner,
      stem,
      outputDir,
      startTime,
      onProgress,
      snapshotTimeoutMs,
    });
  }

  private async capturePreviewSnapshots(opts: {
    url: string;
    cookiesFromBrowser: string;
    ytDlpRunner: YtDlpRunner;
    stem: string;
    outputDir: string;
    onProgress?: ProgressCallback;
    snapshotTimeoutMs: number;
  }): Promise<string[]> {
    const { url, cookiesFromBrowser, ytDlpRunner, stem, outputDir, onProgress, snapshotTimeoutMs } = opts;
    const snapshotTemplate = path.join(outputDir, `${stem}.snapshots.%(ext)s`);
    const snapshotArgs = [
      '--no-playlist',
      '--no-warnings',
      '--format',
      'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[height<=480]/best',
      '--output',
      snapshotTemplate,
      url,
    ];
    if (cookiesFromBrowser) {
      snapshotArgs.splice(snapshotArgs.length - 1, 0, '--cookies-from-browser', cookiesFromBrowser);
    }

    try {
      await runYtDlpCommand(this.execFileFn, ytDlpRunner, snapshotArgs, {
        timeout: snapshotTimeoutMs,
        maxBuffer: 30 * 1024 * 1024,
      });
    } catch {
      return [];
    }

    const downloadedPath = await this.resolveSnapshotDownloadPath(outputDir, `${stem}.snapshots.`);
    if (!downloadedPath) return [];

    try {
      return await extractPreviewSnapshots(
        this.execFileFn,
        downloadedPath,
        outputDir,
        url,
        onProgress,
        { base: 80, span: 15 }
      );
    } finally {
      await fs.rm(downloadedPath, { force: true }).catch(() => {});
    }
  }

  private async resolveSnapshotDownloadPath(
    outputDir: string,
    prefix: string
  ): Promise<string | null> {
    try {
      const entries = await fs.readdir(outputDir);
      const candidates = entries.filter((name) => name.startsWith(prefix));
      if (candidates.length === 0) return null;

      let newestPath: string | null = null;
      let newestTime = -1;
      for (const name of candidates) {
        const fullPath = path.join(outputDir, name);
        const stats = await fs.stat(fullPath);
        if (stats.mtimeMs > newestTime) {
          newestTime = stats.mtimeMs;
          newestPath = fullPath;
        }
      }
      return newestPath;
    } catch {
      return null;
    }
  }
}
