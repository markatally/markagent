import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'fs/promises';
import path from 'path';
import { VideoProbeTool } from '../../apps/api/src/services/tools/video_probe';
import { VideoDownloadTool } from '../../apps/api/src/services/tools/video_download';
import { VideoTranscriptTool } from '../../apps/api/src/services/tools/video_transcript';
import type { ToolContext } from '../../apps/api/src/services/tools/types';

const mockContext: ToolContext = {
  sessionId: 'video-tools-session',
  userId: 'video-tools-user',
  workspaceDir: '/tmp/video-tools-workspace',
};

async function safeCleanup(filepath: string): Promise<void> {
  await fs.rm(filepath, { recursive: true, force: true }).catch(() => {});
}

afterEach(async () => {
  await safeCleanup(path.join(process.cwd(), 'outputs', 'video'));
  await safeCleanup(path.join(process.cwd(), 'outputs', 'transcripts'));
});

describe('VideoProbeTool', () => {
  it('returns validation error for invalid URL', async () => {
    const tool = new VideoProbeTool(mockContext);
    const result = await tool.execute({ url: 'not-a-url' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('valid http/https video URL');
  });

  it('returns metadata artifact when probe succeeds', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const tool = new VideoProbeTool(mockContext, {
      execFileFn: async (command, args) => {
        calls.push({ command, args });
        if (args.includes('--version')) {
          return { stdout: '2026.01.01\n', stderr: '' };
        }
        return {
          stdout: JSON.stringify({
            title: 'Demo Video',
            uploader: 'Demo Channel',
            duration: 90,
            webpage_url: 'https://example.com/video',
            subtitles: { en: [{ ext: 'vtt' }] },
            automatic_captions: {},
          }),
          stderr: '',
        };
      },
    });

    const result = await tool.execute({
      url: 'https://example.com/video',
      includeFormats: true,
      includeSubtitles: true,
      cookiesFromBrowser: 'chrome',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Demo Video');
    expect(result.output).toContain('Subtitle languages: en');
    const artifact = result.artifacts?.find((item) => item.name === 'video-probe.json');
    expect(artifact).toBeDefined();
    const parsed = JSON.parse(String(artifact?.content || '{}'));
    expect(parsed.title).toBe('Demo Video');
    expect(parsed.subtitles).toBeDefined();
    const commandCall = calls.find((entry) => entry.args.includes('--dump-single-json'));
    expect(commandCall).toBeDefined();
    expect(commandCall!.args).toContain('--cookies-from-browser');
  });
});

describe('VideoDownloadTool', () => {
  it('creates downloadable file artifact and persists metadata', async () => {
    let persistedFilename = '';
    const tool = new VideoDownloadTool(mockContext, {
      execFileFn: async (_command, args) => {
        if (args.includes('--version')) {
          return { stdout: '2026.01.01\n', stderr: '' };
        }

        const outputIndex = args.findIndex((value) => value === '--output');
        const template = outputIndex >= 0 ? args[outputIndex + 1] : '';
        const outputPath = template.replace('.%(ext)s', '.mp4');
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, 'fake video content');
        return { stdout: `${outputPath}\n`, stderr: '' };
      },
      persistFileRecord: async (input) => {
        persistedFilename = input.filename;
        return 'file-video-123';
      },
    });

    const result = await tool.execute({
      url: 'https://example.com/video',
      container: 'mp4',
      quality: '720p',
      filename: 'unit-video-download',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Video download completed.');
    expect(persistedFilename).toContain('unit-video-download');
    const artifact = result.artifacts?.find((item) => item.type === 'file');
    expect(artifact).toBeDefined();
    expect(artifact?.fileId).toBe('file-video-123');
    expect(artifact?.name.toLowerCase().endsWith('.mp4')).toBe(true);
  });

  it('falls back to python3 -m yt_dlp when yt-dlp binary is unavailable', async () => {
    const seenCommands: string[] = [];
    const tool = new VideoDownloadTool(mockContext, {
      execFileFn: async (command, args) => {
        seenCommands.push(command);
        if (args.includes('--version')) {
          if (command === 'yt-dlp') {
            throw new Error('yt-dlp missing');
          }
          return { stdout: '2026.01.01\n', stderr: '' };
        }

        const outputIndex = args.findIndex((value) => value === '--output');
        const template = outputIndex >= 0 ? args[outputIndex + 1] : '';
        const outputPath = template.replace('.%(ext)s', '.mp4');
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, 'video-by-python-module');
        return { stdout: `${outputPath}\n`, stderr: '' };
      },
      persistFileRecord: async () => 'file-python-fallback',
    });

    const result = await tool.execute({
      url: 'https://example.com/video',
      filename: 'fallback-download',
    });

    expect(result.success).toBe(true);
    expect(seenCommands).toContain('yt-dlp');
    expect(seenCommands).toContain('python3');
  });

  it('returns structured YTDLP_NOT_FOUND error when all yt-dlp runners are missing', async () => {
    const tool = new VideoDownloadTool(mockContext, {
      execFileFn: async () => {
        throw new Error('runner missing');
      },
    });

    const result = await tool.execute({
      url: 'https://example.com/video',
      filename: 'install-attempt-test',
    });

    expect(result.success).toBe(false);
    const parsed = JSON.parse(result.error!);
    expect(parsed.code).toBe('YTDLP_NOT_FOUND');
    expect(parsed.installCommands).toBeDefined();
    expect(parsed.installCommands.length).toBeGreaterThan(0);
    expect(parsed.recoveryHint).toContain('bash_executor');
  });
});

describe('VideoTranscriptTool', () => {
  it('extracts transcript from subtitle file and returns file artifact', async () => {
    let persistedFilename = '';
    const tool = new VideoTranscriptTool(mockContext, {
      execFileFn: async (_command, args) => {
        if (args.includes('--version')) {
          return { stdout: '2026.01.01\n', stderr: '' };
        }

        const outputIndex = args.findIndex((value) => value === '--output');
        const template = outputIndex >= 0 ? args[outputIndex + 1] : '';
        const subtitlePath = template.replace('.%(ext)s', '.en.vtt');
        await fs.mkdir(path.dirname(subtitlePath), { recursive: true });
        await fs.writeFile(
          subtitlePath,
          [
            'WEBVTT',
            '',
            '00:00:00.000 --> 00:00:02.000',
            'Hello world',
            '',
            '00:00:02.000 --> 00:00:04.000',
            'This is a test',
            '',
          ].join('\n'),
          'utf8'
        );
        return { stdout: '', stderr: '' };
      },
      persistFileRecord: async (input) => {
        persistedFilename = input.filename;
        return 'file-transcript-456';
      },
    });

    const result = await tool.execute({
      url: 'https://example.com/video',
      language: 'en',
      includeTimestamps: true,
      filename: 'unit-video-transcript',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Transcript extraction completed.');
    expect(persistedFilename).toBe('unit-video-transcript.transcript.txt');

    const transcriptArtifact = result.artifacts?.find(
      (item) => item.type === 'file' && item.name.endsWith('.transcript.txt')
    );
    expect(transcriptArtifact?.fileId).toBe('file-transcript-456');

    const dataArtifact = result.artifacts?.find((item) => item.name === 'video-transcript.json');
    expect(dataArtifact).toBeDefined();
    const payload = JSON.parse(String(dataArtifact?.content || '{}'));
    expect(payload.segmentCount).toBe(2);
    expect(payload.transcript).toContain('Hello world');
    expect(payload.transcript).toContain('[00:00:00.000 --> 00:00:02.000]');
  });

  it('returns install guidance when no yt-dlp runner is available', async () => {
    const tool = new VideoTranscriptTool(mockContext, {
      execFileFn: async () => {
        throw new Error('missing');
      },
    });

    const result = await tool.execute({
      url: 'https://example.com/video',
    });

    expect(result.success).toBe(false);
    const parsed = JSON.parse(result.error!);
    expect(parsed.code).toBe('YTDLP_NOT_FOUND');
    expect(parsed.installCommands).toBeDefined();
  });

  it('falls back to Whisper when no subtitles are found', async () => {
    let persistedFilename = '';
    const tool = new VideoTranscriptTool(mockContext, {
      execFileFn: async (command, args) => {
        // yt-dlp version check
        if (args.includes('--version')) {
          return { stdout: '2026.01.01\n', stderr: '' };
        }
        // yt-dlp subtitle extraction — produce no subtitle files
        if (args.includes('--write-subs')) {
          const outputIndex = args.findIndex((v) => v === '--output');
          const template = outputIndex >= 0 ? args[outputIndex + 1] : '';
          await fs.mkdir(path.dirname(template), { recursive: true });
          // No subtitle files written
          return { stdout: '', stderr: '' };
        }
        // whisper --help probe
        if (args.includes('--help') && (command === 'whisper' || args.includes('whisper'))) {
          return { stdout: 'usage: whisper', stderr: '' };
        }
        // yt-dlp audio extraction
        if (args.includes('--extract-audio')) {
          const outputIndex = args.findIndex((v) => v === '--output');
          const audioPath = outputIndex >= 0 ? args[outputIndex + 1] : '';
          await fs.mkdir(path.dirname(audioPath), { recursive: true });
          await fs.writeFile(audioPath, 'fake wav data');
          return { stdout: '', stderr: '' };
        }
        // whisper transcription
        if (args.includes('--output_format')) {
          const audioArg = args.find((a) => a.endsWith('.wav'));
          const dirIndex = args.findIndex((v) => v === '--output_dir');
          const outputDir = dirIndex >= 0 ? args[dirIndex + 1] : '';
          const stem = path.basename(audioArg || '', '.wav');
          const srtPath = path.join(outputDir, `${stem}.srt`);
          await fs.writeFile(
            srtPath,
            [
              '1',
              '00:00:00,000 --> 00:00:03,000',
              'Whisper transcribed line one',
              '',
              '2',
              '00:00:03,000 --> 00:00:06,000',
              'Whisper transcribed line two',
              '',
            ].join('\n'),
            'utf8'
          );
          return { stdout: '', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      },
      persistFileRecord: async (input) => {
        persistedFilename = input.filename;
        return 'file-whisper-789';
      },
    });

    const result = await tool.execute({
      url: 'https://example.com/no-subs-video',
      language: 'zh',
      includeTimestamps: true,
      filename: 'whisper-fallback-test',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Transcript extraction completed.');
    expect(result.output).toContain('whisper:');
    expect(persistedFilename).toBe('whisper-fallback-test.transcript.txt');
    expect(result.artifacts?.length).toBe(2);

    const dataArtifact = result.artifacts?.find((item) => item.name === 'video-transcript.json');
    const payload = JSON.parse(String(dataArtifact?.content || '{}'));
    expect(payload.segmentCount).toBe(2);
    expect(payload.transcript).toContain('Whisper transcribed line one');
  });

  it('returns WHISPER_NOT_FOUND error when whisper missing and no subtitles', async () => {
    const tool = new VideoTranscriptTool(mockContext, {
      execFileFn: async (command, args) => {
        // yt-dlp version check succeeds
        if (args.includes('--version')) {
          if (command === 'yt-dlp') return { stdout: '2026.01.01\n', stderr: '' };
          throw new Error('not found');
        }
        // yt-dlp subtitle extraction — no subtitle files
        if (args.includes('--write-subs')) {
          const outputIndex = args.findIndex((v) => v === '--output');
          const template = outputIndex >= 0 ? args[outputIndex + 1] : '';
          await fs.mkdir(path.dirname(template), { recursive: true });
          return { stdout: '', stderr: '' };
        }
        // whisper --help probe fails for all candidates
        if (args.includes('--help')) {
          throw new Error('whisper not found');
        }
        return { stdout: '', stderr: '' };
      },
    });

    const result = await tool.execute({
      url: 'https://example.com/no-subs-video',
      filename: 'whisper-missing-test',
    });

    expect(result.success).toBe(false);
    const parsed = JSON.parse(result.error!);
    expect(parsed.code).toBe('WHISPER_NOT_FOUND');
    expect(parsed.installCommands).toBeDefined();
    expect(parsed.installCommands.length).toBeGreaterThan(0);
  });

  it('auto-retries with browser cookies when subtitles need login', async () => {
    const cookiesUsed: string[] = [];
    let persistedFilename = '';
    const tool = new VideoTranscriptTool(mockContext, {
      execFileFn: async (_command, args) => {
        if (args.includes('--version')) {
          return { stdout: '2026.01.01\n', stderr: '' };
        }
        if (args.includes('--write-subs')) {
          const outputIndex = args.findIndex((v) => v === '--output');
          const template = outputIndex >= 0 ? args[outputIndex + 1] : '';
          await fs.mkdir(path.dirname(template), { recursive: true });

          const cookieIndex = args.findIndex((v) => v === '--cookies-from-browser');
          const browser = cookieIndex >= 0 ? args[cookieIndex + 1] : null;

          if (!browser) {
            // First attempt without cookies: return auth warning, no subtitle files
            cookiesUsed.push('none');
            return {
              stdout: '',
              stderr: 'WARNING: [BiliBili] Subtitles are only available when logged in. Use --cookies-from-browser or --cookies for the authentication.',
            };
          }

          // Retry with browser cookies
          cookiesUsed.push(browser);
          if (browser === 'chrome') {
            // Simulate successful subtitle download with chrome cookies
            const subtitlePath = template.replace('.%(ext)s', '.ai-zh.srt');
            await fs.writeFile(
              subtitlePath,
              [
                '1',
                '00:00:00,080 --> 00:00:03,080',
                '自动重试成功的字幕内容',
                '',
              ].join('\n'),
              'utf8'
            );
          }
          return { stdout: '', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      },
      persistFileRecord: async (input) => {
        persistedFilename = input.filename;
        return 'file-auto-retry';
      },
    });

    const result = await tool.execute({
      url: 'https://www.bilibili.com/video/BV1itzyBJErX',
      language: 'zh',
      includeTimestamps: true,
      filename: 'auth-retry-test',
      // No cookiesFromBrowser — should auto-retry
    });

    // Should have tried without cookies first, then retried with chrome
    expect(cookiesUsed).toContain('none');
    expect(cookiesUsed).toContain('chrome');
    // Should succeed via auto-retry
    expect(result.success).toBe(true);
    expect(result.output).toContain('Transcript extraction completed.');
    expect(persistedFilename).toBe('auth-retry-test.transcript.txt');
  });

  it('handles Bilibili ai-zh subtitle tracks correctly', async () => {
    let persistedFilename = '';
    const tool = new VideoTranscriptTool(mockContext, {
      execFileFn: async (_command, args) => {
        if (args.includes('--version')) {
          return { stdout: '2026.01.01\n', stderr: '' };
        }

        const outputIndex = args.findIndex((v) => v === '--output');
        const template = outputIndex >= 0 ? args[outputIndex + 1] : '';
        // Simulate Bilibili writing an ai-zh.srt file
        const subtitlePath = template.replace('.%(ext)s', '.ai-zh.srt');
        await fs.mkdir(path.dirname(subtitlePath), { recursive: true });
        await fs.writeFile(
          subtitlePath,
          [
            '1',
            '00:00:00,080 --> 00:00:03,080',
            '这期视频呢会跟大家分享一下这三部分的内容',
            '',
            '2',
            '00:00:03,080 --> 00:00:04,680',
            'clouds skills的工作原理',
            '',
            '3',
            '00:00:04,680 --> 00:00:07,480',
            '了解一点原理是必不可少的',
            '',
          ].join('\n'),
          'utf8'
        );
        return { stdout: '', stderr: '' };
      },
      persistFileRecord: async (input) => {
        persistedFilename = input.filename;
        return 'file-bilibili-ai-zh';
      },
    });

    const result = await tool.execute({
      url: 'https://www.bilibili.com/video/BV1itzyBJErX',
      language: 'zh',
      includeTimestamps: true,
      filename: 'bilibili-ai-zh-test',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Transcript extraction completed.');
    expect(result.output).toContain('ai-zh.srt');
    expect(persistedFilename).toBe('bilibili-ai-zh-test.transcript.txt');

    const dataArtifact = result.artifacts?.find((item) => item.name === 'video-transcript.json');
    const payload = JSON.parse(String(dataArtifact?.content || '{}'));
    expect(payload.segmentCount).toBe(3);
    expect(payload.transcript).toContain('这期视频呢会跟大家分享一下这三部分的内容');
    expect(payload.transcript).toContain('clouds skills的工作原理');
  });

  it('includes transcript text in output field for conversation history', async () => {
    const tool = new VideoTranscriptTool(mockContext, {
      execFileFn: async (_command, args) => {
        if (args.includes('--version')) {
          return { stdout: '2026.01.01\n', stderr: '' };
        }
        const outputIndex = args.findIndex((v) => v === '--output');
        const template = outputIndex >= 0 ? args[outputIndex + 1] : '';
        const subtitlePath = template.replace('.%(ext)s', '.en.vtt');
        await fs.mkdir(path.dirname(subtitlePath), { recursive: true });
        await fs.writeFile(
          subtitlePath,
          [
            'WEBVTT',
            '',
            '00:00:00.000 --> 00:00:02.000',
            'First line of dialogue',
            '',
            '00:00:02.000 --> 00:00:04.000',
            'Second line of dialogue',
            '',
          ].join('\n'),
          'utf8'
        );
        return { stdout: '', stderr: '' };
      },
      persistFileRecord: async () => 'file-output-check',
    });

    const result = await tool.execute({
      url: 'https://example.com/video',
      language: 'en',
      includeTimestamps: true,
      filename: 'output-text-test',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('--- Transcript ---');
    expect(result.output).toContain('First line of dialogue');
    expect(result.output).toContain('Second line of dialogue');
  });
});
