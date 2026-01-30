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

export interface AppConfig {
  llm: LLMConfig;
  rateLimits: RateLimitsConfig;
  sandbox: SandboxConfig;
  session: SessionConfig;
  tools: ToolsConfig;
  security: SecurityConfig;
  logging: LoggingConfig;
}

let cachedConfig: AppConfig | null = null;

/**
 * Load application configuration from JSON file with environment overrides
 */
export function loadConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH;

  let config: AppConfig;

  try {
    const configFile = fs.readFileSync(configPath, 'utf-8');
    config = JSON.parse(configFile) as AppConfig;
  } catch (error) {
    console.error(`Failed to load config from ${configPath}:`, error);
    throw new Error(`Configuration file not found or invalid: ${configPath}`);
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
