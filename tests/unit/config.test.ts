import { describe, it, expect, beforeAll } from 'bun:test';
import { clearConfigCache, getConfig, loadConfig } from '../../apps/api/src/services/config';
import type { AppConfig } from '../../apps/api/src/services/config';
import path from 'path';

// Set CONFIG_PATH for tests if not already set
if (!process.env.CONFIG_PATH) {
  process.env.CONFIG_PATH = path.join(process.cwd(), 'config/default.json');
}

describe('Phase 1: Config Service', () => {
  let config: AppConfig;

  beforeAll(() => {
    config = getConfig();
  });

  describe('Config Loading', () => {
    it('should load config from file', () => {
      expect(config).toBeDefined();
      expect(config.llm).toBeDefined();
      expect(config.session).toBeDefined();
      expect(config.tools).toBeDefined();
      expect(config.security).toBeDefined();
    });

    it('should resolve relative CONFIG_PATH from repo root even when cwd is apps/api', () => {
      const originalCwd = process.cwd();
      const originalConfigPath = process.env.CONFIG_PATH;
      try {
        process.chdir(path.join(originalCwd, 'apps/api'));
        process.env.CONFIG_PATH = 'config/default.json';
        clearConfigCache();
        const resolved = loadConfig();
        expect(resolved.session).toBeDefined();
        expect(resolved.tools.enabled.length).toBeGreaterThan(0);
      } finally {
        process.chdir(originalCwd);
        process.env.CONFIG_PATH = originalConfigPath;
        clearConfigCache();
        config = getConfig();
      }
    });

    it('should have valid LLM config', () => {
      expect(config.llm.provider).toBe('openai-compatible');
      expect(config.llm.baseUrl).toBeDefined();
      expect(config.llm.model).toBeDefined();
      expect(typeof config.llm.temperature).toBe('number');
      expect(typeof config.llm.maxTokens).toBe('number');
    });

    it('should have valid session config', () => {
      expect(typeof config.session.maxHistoryMessages).toBe('number');
      expect(typeof config.session.contextWindowTokens).toBe('number');
      expect(config.session.maxHistoryMessages).toBeGreaterThan(0);
      expect(config.session.contextWindowTokens).toBeGreaterThan(0);
    });

    it('should have valid security config', () => {
      expect(Array.isArray(config.security.blockedCommands)).toBe(true);
      expect(config.security.blockedCommands.length).toBeGreaterThan(0);
    });

    it('should have valid tools config', () => {
      expect(Array.isArray(config.tools.enabled)).toBe(true);
      expect(config.tools.enabled).toContain('file_reader');
      expect(config.tools.enabled).toContain('file_writer');
      expect(config.tools.enabled).toContain('bash_executor');
    });
  });

  describe('Environment Variable Overrides', () => {
    it('should override LLM_BASE_URL from env if set', () => {
      const originalUrl = process.env.LLM_BASE_URL;

      // Config should use env var if available
      if (originalUrl) {
        expect(config.llm.baseUrl).toBe(originalUrl);
      }
    });

    it('should override LLM_MODEL from env if set', () => {
      const originalModel = process.env.LLM_MODEL;

      if (originalModel) {
        expect(config.llm.model).toBe(originalModel);
      }
    });
  });

  describe('Config Validation', () => {
    it('should have required API key placeholder', () => {
      expect(process.env.LLM_API_KEY).toBeDefined();
    });

    it('should have JWT secret', () => {
      expect(process.env.JWT_SECRET).toBeDefined();
      expect(process.env.JWT_SECRET!.length).toBeGreaterThanOrEqual(32);
    });

    it('should have encryption key', () => {
      expect(process.env.ENCRYPTION_KEY).toBeDefined();
      expect(process.env.ENCRYPTION_KEY!.length).toBeGreaterThanOrEqual(32);
    });

    it('should have database URL', () => {
      expect(process.env.DATABASE_URL).toBeDefined();
      expect(process.env.DATABASE_URL).toContain('postgresql://');
    });

    it('should have Redis URL', () => {
      expect(process.env.REDIS_URL).toBeDefined();
      expect(process.env.REDIS_URL).toContain('redis://');
    });
  });
});
