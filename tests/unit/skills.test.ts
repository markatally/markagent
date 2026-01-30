import { describe, it, expect, beforeAll } from 'bun:test';
import path from 'path';

// Set CONFIG_PATH for tests if not already set
if (!process.env.CONFIG_PATH) {
  process.env.CONFIG_PATH = path.join(process.cwd(), 'config/default.json');
}

// Import after setting CONFIG_PATH
import {
  SkillProcessor,
  getSkillProcessor,
} from '../../apps/api/src/services/skills/processor';

describe('Phase 6.4: Skill Invocation', () => {
  describe('SkillProcessor Singleton', () => {
    it('should get singleton instance', () => {
      const processor = getSkillProcessor();
      const processor2 = getSkillProcessor();

      expect(processor).toBeDefined();
      expect(processor).toBe(processor2);
    });
  });

  describe('Skill Command Detection', () => {
    let processor: SkillProcessor;

    beforeAll(() => {
      processor = getSkillProcessor();
    });

    it('should detect slash commands', () => {
      expect(processor.isSkillCommand('/code')).toBe(true);
      expect(processor.isSkillCommand('/debug something')).toBe(true);
      expect(processor.isSkillCommand('/test')).toBe(true);
    });

    it('should not detect regular messages as commands', () => {
      expect(processor.isSkillCommand('hello')).toBe(false);
      expect(processor.isSkillCommand('create a function')).toBe(false);
      expect(processor.isSkillCommand('')).toBe(false);
    });

    it('should not detect just a slash', () => {
      expect(processor.isSkillCommand('/')).toBe(false);
    });

    it('should handle whitespace', () => {
      expect(processor.isSkillCommand('  /code  ')).toBe(true);
      expect(processor.isSkillCommand('\n/test\n')).toBe(true);
    });
  });

  describe('Skill Command Parsing', () => {
    let processor: SkillProcessor;

    beforeAll(() => {
      processor = getSkillProcessor();
    });

    it('should parse basic command', () => {
      const result = processor.parseCommand('/code');

      expect(result).not.toBeNull();
      expect(result!.skillName).toBe('code');
      expect(result!.skill).toBeDefined();
      expect(result!.userInput).toBe('');
    });

    it('should parse command with user input', () => {
      const result = processor.parseCommand('/code Create a REST API');

      expect(result).not.toBeNull();
      expect(result!.skillName).toBe('code');
      expect(result!.userInput).toBe('Create a REST API');
    });

    it('should parse command with parameters', () => {
      const result = processor.parseCommand('/code language=python Create a script');

      expect(result).not.toBeNull();
      expect(result!.parameters.language).toBe('python');
      expect(result!.userInput).toBe('Create a script');
    });

    it('should parse multiple parameters', () => {
      const result = processor.parseCommand(
        '/code language=typescript framework=react Build a component'
      );

      expect(result).not.toBeNull();
      expect(result!.parameters.language).toBe('typescript');
      expect(result!.parameters.framework).toBe('react');
      expect(result!.userInput).toBe('Build a component');
    });

    it('should return null for unknown skill', () => {
      const result = processor.parseCommand('/unknownskill test');
      expect(result).toBeNull();
    });

    it('should return null for non-command input', () => {
      const result = processor.parseCommand('not a command');
      expect(result).toBeNull();
    });

    it('should handle skill aliases', () => {
      // /generate is an alias for /code
      const result = processor.parseCommand('/generate a function');

      expect(result).not.toBeNull();
      expect(result!.skillName).toBe('code');
    });
  });

  describe('Prompt Formatting', () => {
    let processor: SkillProcessor;

    beforeAll(() => {
      processor = getSkillProcessor();
    });

    it('should format prompts for skill invocation', () => {
      const invocation = processor.parseCommand('/code Create a hello world function');

      expect(invocation).not.toBeNull();

      const formatted = processor.formatPrompts(invocation!);

      expect(formatted.systemPrompt).toBeDefined();
      expect(formatted.systemPrompt.length).toBeGreaterThan(0);
      expect(formatted.userPrompt).toBeDefined();
      expect(formatted.userPrompt).toContain('hello world function');
      expect(formatted.requiredTools).toBeDefined();
      expect(Array.isArray(formatted.requiredTools)).toBe(true);
    });

    it('should substitute template variables', () => {
      const invocation = processor.parseCommand('/code language=python Build API');

      expect(invocation).not.toBeNull();

      const formatted = processor.formatPrompts(invocation!, {
        workspaceFiles: ['main.py', 'utils.py'],
        additionalContext: { customVar: 'custom value' },
      });

      // Should include workspace files
      expect(formatted.userPrompt).toContain('main.py');
    });

    it('should include required tools from skill', () => {
      const invocation = processor.parseCommand('/code test');

      expect(invocation).not.toBeNull();

      const formatted = processor.formatPrompts(invocation!);

      // Code skill requires file_writer, file_reader, code_analyzer
      expect(formatted.requiredTools).toContain('file_writer');
      expect(formatted.requiredTools).toContain('file_reader');
    });
  });

  describe('Skill Listing', () => {
    let processor: SkillProcessor;

    beforeAll(() => {
      processor = getSkillProcessor();
    });

    it('should list all skills', () => {
      const skills = processor.getAllSkills();

      expect(Array.isArray(skills)).toBe(true);
      expect(skills.length).toBeGreaterThan(0);
    });

    it('should have at least the documented 31 skills', () => {
      const skills = processor.getAllSkills();
      expect(skills.length).toBeGreaterThanOrEqual(31);
    });

    it('should have code skill', () => {
      const skill = processor.getSkill('code');

      expect(skill).toBeDefined();
      expect(skill!.name).toBe('code');
      expect(skill!.category).toBe('development');
    });

    it('should have debug skill', () => {
      const skill = processor.getSkill('debug');

      expect(skill).toBeDefined();
      expect(skill!.name).toBe('debug');
      expect(skill!.category).toBe('debugging');
    });

    it('should have test skill', () => {
      const skill = processor.getSkill('test');

      expect(skill).toBeDefined();
      expect(skill!.name).toBe('test');
      expect(skill!.category).toBe('testing');
    });

    it('should list skills by category', () => {
      const byCategory = processor.listSkillsByCategory();

      expect(byCategory.has('development')).toBe(true);
      expect(byCategory.has('debugging')).toBe(true);
      expect(byCategory.has('testing')).toBe(true);
      expect(byCategory.has('devops')).toBe(true);
    });
  });

  describe('Skill Help', () => {
    let processor: SkillProcessor;

    beforeAll(() => {
      processor = getSkillProcessor();
    });

    it('should format skill help text', () => {
      const skill = processor.getSkill('code');
      expect(skill).toBeDefined();

      const help = processor.formatSkillHelp(skill!);

      expect(help).toContain('/code');
      expect(help).toContain(skill!.description);
      expect(help).toContain('Category:');
    });

    it('should include aliases in help', () => {
      const skill = processor.getSkill('code');
      expect(skill).toBeDefined();

      const help = processor.formatSkillHelp(skill!);

      // Code skill has aliases
      if (skill!.aliases.length > 0) {
        expect(help).toContain('Aliases:');
      }
    });

    it('should include parameters in help', () => {
      const skill = processor.getSkill('code');
      expect(skill).toBeDefined();

      const help = processor.formatSkillHelp(skill!);

      if (skill!.parameters && skill!.parameters.length > 0) {
        expect(help).toContain('Parameters:');
      }
    });
  });

  describe('Skill Categories', () => {
    let processor: SkillProcessor;

    beforeAll(() => {
      processor = getSkillProcessor();
    });

    it('should have development category skills', () => {
      const byCategory = processor.listSkillsByCategory();
      const devSkills = byCategory.get('development') || [];

      const devSkillNames = devSkills.map((s) => s.name);
      expect(devSkillNames).toContain('code');
      expect(devSkillNames).toContain('refactor');
      expect(devSkillNames).toContain('review');
    });

    it('should have debugging category skills', () => {
      const byCategory = processor.listSkillsByCategory();
      const debugSkills = byCategory.get('debugging') || [];

      const debugSkillNames = debugSkills.map((s) => s.name);
      expect(debugSkillNames).toContain('debug');
      expect(debugSkillNames).toContain('fix');
    });

    it('should have devops category skills', () => {
      const byCategory = processor.listSkillsByCategory();
      const devopsSkills = byCategory.get('devops') || [];

      const devopsSkillNames = devopsSkills.map((s) => s.name);
      expect(devopsSkillNames).toContain('deploy');
      expect(devopsSkillNames).toContain('docker');
      expect(devopsSkillNames).toContain('git');
    });
  });
});
