type ExecFileResult = { stdout: string; stderr: string };
type ExecFileFn = (
  command: string,
  args: string[],
  options?: { timeout?: number; maxBuffer?: number }
) => Promise<ExecFileResult>;

export type YtDlpRunner = {
  command: string;
  baseArgs: string[];
  label: 'yt-dlp' | 'python3 -m yt_dlp' | 'python -m yt_dlp';
};

const YTDLP_CANDIDATES: YtDlpRunner[] = [
  { command: 'yt-dlp', baseArgs: [], label: 'yt-dlp' },
  { command: 'python3', baseArgs: ['-m', 'yt_dlp'], label: 'python3 -m yt_dlp' },
  { command: 'python', baseArgs: ['-m', 'yt_dlp'], label: 'python -m yt_dlp' },
];

export async function resolveYtDlpRunner(
  execFileFn: ExecFileFn
): Promise<YtDlpRunner | null> {
  for (const candidate of YTDLP_CANDIDATES) {
    try {
      await execFileFn(candidate.command, [...candidate.baseArgs, '--version'], {
        timeout: 10000,
      });
      return candidate;
    } catch {
      // try next candidate
    }
  }

  return null;
}

export async function runYtDlpCommand(
  execFileFn: ExecFileFn,
  runner: YtDlpRunner,
  args: string[],
  options?: { timeout?: number; maxBuffer?: number }
): Promise<ExecFileResult> {
  return execFileFn(runner.command, [...runner.baseArgs, ...args], options);
}

export interface InstallStrategy {
  command: string;
  label: string;
}

/**
 * Returns platform-aware ordered install strategies for yt-dlp.
 */
export function getInstallCommands(): InstallStrategy[] {
  const platform = process.platform;
  if (platform === 'darwin') {
    return [
      { command: 'brew install yt-dlp', label: 'Homebrew (macOS)' },
      { command: 'pip3 install --user yt-dlp', label: 'pip3 --user' },
      { command: 'python3 -m pip install --user yt-dlp', label: 'python3 pip --user' },
    ];
  }
  // Linux and other platforms
  return [
    { command: 'pip3 install --user yt-dlp', label: 'pip3 --user' },
    { command: 'python3 -m pip install --user yt-dlp', label: 'python3 pip --user' },
    { command: 'sudo apt-get install -y yt-dlp', label: 'apt (Debian/Ubuntu)' },
  ];
}

export function buildYtDlpMissingError(): string {
  const strategies = getInstallCommands();
  return JSON.stringify({
    code: 'YTDLP_NOT_FOUND',
    message: 'yt-dlp is not installed or not found in PATH.',
    triedCandidates: YTDLP_CANDIDATES.map((c) => c.label),
    recoveryHint: `Use bash_executor to install yt-dlp. Recommended commands (try in order): ${strategies.map((s) => s.command).join(' ; ')}`,
    installCommands: strategies.map((s) => s.command),
  });
}

// ── Whisper runner helpers (mirrors yt-dlp pattern) ─────────────────────────

export type WhisperRunner = {
  command: string;
  baseArgs: string[];
  label: 'whisper' | 'python3 -m whisper' | 'python -m whisper';
};

const WHISPER_CANDIDATES: WhisperRunner[] = [
  { command: 'whisper', baseArgs: [], label: 'whisper' },
  { command: 'python3', baseArgs: ['-m', 'whisper'], label: 'python3 -m whisper' },
  { command: 'python', baseArgs: ['-m', 'whisper'], label: 'python -m whisper' },
];

export async function resolveWhisperRunner(
  execFileFn: ExecFileFn
): Promise<WhisperRunner | null> {
  for (const candidate of WHISPER_CANDIDATES) {
    try {
      await execFileFn(candidate.command, [...candidate.baseArgs, '--help'], {
        timeout: 10000,
      });
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function runWhisperCommand(
  execFileFn: ExecFileFn,
  runner: WhisperRunner,
  args: string[],
  options?: { timeout?: number; maxBuffer?: number }
): Promise<ExecFileResult> {
  return execFileFn(runner.command, [...runner.baseArgs, ...args], options);
}

export function getWhisperInstallCommands(): InstallStrategy[] {
  return [
    { command: 'pip3 install openai-whisper', label: 'pip3' },
    { command: 'python3 -m pip install openai-whisper', label: 'python3 pip' },
  ];
}

export function buildWhisperMissingError(): string {
  const strategies = getWhisperInstallCommands();
  return JSON.stringify({
    code: 'WHISPER_NOT_FOUND',
    message: 'openai-whisper is not installed or not found in PATH.',
    triedCandidates: WHISPER_CANDIDATES.map((c) => c.label),
    recoveryHint: `Use bash_executor to install whisper. Recommended commands (try in order): ${strategies.map((s) => s.command).join(' ; ')}`,
    installCommands: strategies.map((s) => s.command),
  });
}

/**
 * Categorize a yt-dlp execution error into a machine-readable code and hint.
 */
export function categorizeYtDlpError(error: any): {
  code: string;
  message: string;
  recoveryHint: string;
} {
  const stderr = String(error?.stderr || error?.message || '');
  const stderrSnippet = stderr.slice(0, 500);

  if (/requested format not available/i.test(stderr) || /no video formats found/i.test(stderr)) {
    return {
      code: 'FORMAT_UNAVAILABLE',
      message: `Requested format/quality not available. ${stderrSnippet}`,
      recoveryHint: 'Retry with lower quality (720p → 480p) or switch container to mkv.',
    };
  }

  if (/unable to download webpage/i.test(stderr) || /urlopen error/i.test(stderr) || /ENOTFOUND/i.test(stderr)) {
    return {
      code: 'NETWORK_ERROR',
      message: `Network error during download. ${stderrSnippet}`,
      recoveryHint: 'Verify the URL is correct and accessible. For sites requiring login, use cookiesFromBrowser parameter.',
    };
  }

  if (/geo.?restrict/i.test(stderr) || /blocked/i.test(stderr) || /not available in your country/i.test(stderr)) {
    return {
      code: 'GEO_BLOCKED',
      message: `Content appears geo-restricted. ${stderrSnippet}`,
      recoveryHint: 'Try using cookiesFromBrowser for authenticated access, or inform the user about geo-restrictions.',
    };
  }

  return {
    code: 'DOWNLOAD_FAILED',
    message: `Video download failed. ${stderrSnippet}`,
    recoveryHint: 'Check the URL and try again. If the error persists, the video may be unavailable.',
  };
}
