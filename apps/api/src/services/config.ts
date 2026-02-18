import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get directory of this file for reliable path resolution
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config path relative to this file: services/ -> src/ -> api/ -> apps/ -> project root
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../../../../config/default.json');

export interface LLMConfig {
  provider: string;
  baseUrl: string;
  model: string;
  /** Max tokens for completion; use a high value (e.g. 131072) so large tool-call payloads (e.g. ppt_generator) are not truncated. */
  maxTokens: number;
  temperature: number;
  timeout: number;
  streaming: boolean;
}

export interface RateLimitsConfig {
  enabled: boolean;
  requests: {
    perMinute: number;
    perHour: number;
    perDay: number;
  };
  tokens: {
    perMinute: number;
    perHour: number;
    perDay: number;
  };
  concurrent: {
    maxSessions: number;
    maxRequestsPerSession: number;
  };
}

export interface SandboxConfig {
  enabled: boolean;
  memory: string;
  cpu: string;
  timeout: number;
  diskSpace: string;
  networkAccess: boolean;
}

export interface SessionConfig {
  maxIdleTime: number;
  maxDuration: number;
  maxHistoryMessages: number;
  contextWindowTokens: number;
}

export interface ToolsConfig {
  enabled: string[];
  requireApproval: string[];
  timeout: Record<string, number>;
}

export interface SecurityConfig {
  maxFileUploadSize: string;
  allowedFileTypes: string[];
  blockedCommands: string[];
}

export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  enableDebugMode: boolean;
  retentionDays: number;
}

export interface BrowserConfig {
  enabled: boolean;
  maxConcurrentSessions: number;
  viewport: { width: number; height: number };
  idleTimeoutMs: number;
  screencast?: {
    format: 'jpeg' | 'png';
    quality?: number;
    maxWidth?: number;
    maxHeight?: number;
    everyNthFrame?: number;
  };
}

export interface ExecutionConfig {
  sandboxVisualization: {
    enabled: boolean;
    defaultMode: 'direct' | 'sandbox';
    maxConcurrentSandboxes: number;
    terminalMaxLines: number;
    maxFileSize: string;
  };
  pptPipeline?: {
    enabled: boolean;
  };
}

export interface AppConfig {
  llm: LLMConfig;
  rateLimits: RateLimitsConfig;
  sandbox: SandboxConfig;
  browser?: BrowserConfig;
  execution: ExecutionConfig;
  session: SessionConfig;
  tools: ToolsConfig;
  security: SecurityConfig;
  logging: LoggingConfig;
}

let cachedConfig: AppConfig | null = null;

function resolveConfigPath(rawPath: string): string {
  const candidates: string[] = [];
  if (path.isAbsolute(rawPath)) {
    candidates.push(rawPath);
  } else {
    candidates.push(path.resolve(process.cwd(), rawPath));
    // Also resolve relative to repository root for monorepo/dev-server cwd drift.
    candidates.push(path.resolve(__dirname, '../../../../', rawPath));
    candidates.push(rawPath);
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return candidates[0] || rawPath;
}

/**
 * Load application configuration from JSON file with environment overrides
 */
export function loadConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const requestedPath = process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH;
  const configPath = resolveConfigPath(requestedPath);

  let config: AppConfig;

  try {
    const configFile = fs.readFileSync(configPath, 'utf-8');
    config = JSON.parse(configFile) as AppConfig;
  } catch (error) {
    console.error(`Failed to load config from ${configPath} (requested: ${requestedPath}):`, error);
    throw new Error(`Configuration file not found or invalid: ${requestedPath}`);
  }

  // Override with environment variables if present
  if (process.env.LLM_BASE_URL) {
    config.llm.baseUrl = process.env.LLM_BASE_URL;
  }
  if (process.env.LLM_MODEL) {
    config.llm.model = process.env.LLM_MODEL;
  }
  if (process.env.LOG_LEVEL) {
    config.logging.level = process.env.LOG_LEVEL as LoggingConfig['level'];
  }

  cachedConfig = config;
  return config;
}

/**
 * Get the loaded config (must call loadConfig first)
 */
export function getConfig(): AppConfig {
  if (!cachedConfig) {
    return loadConfig();
  }
  return cachedConfig;
}

/**
 * Clear cached config (useful for testing)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}
