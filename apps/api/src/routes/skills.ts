/**
 * Skills Routes
 * API endpoints for listing and getting skill information
 */

import { Hono } from 'hono';
import { requireAuth, AuthContext } from '../middleware/auth';
import { getSkillProcessor } from '../services/skills/processor';

const skills = new Hono<AuthContext>();

// All skill routes require authentication
skills.use('*', requireAuth);

/**
 * GET /api/skills
 * List all available skills
 */
skills.get('/', async (c) => {
  const processor = getSkillProcessor();
  const allSkills = processor.getAllSkills();

  // Group by category
  const byCategory = processor.listSkillsByCategory();

  return c.json({
    skills: allSkills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      aliases: skill.aliases,
      category: skill.category,
      requiredTools: skill.requiredTools,
      parameters: skill.parameters || [],
    })),
    categories: Array.from(byCategory.entries()).map(([category, skills]) => ({
      name: category,
      skills: skills.map((s) => s.name),
    })),
    total: allSkills.length,
  });
});

/**
 * GET /api/skills/:name
 * Get details for a specific skill
 */
skills.get('/:name', async (c) => {
  const name = c.req.param('name');
  const processor = getSkillProcessor();

  const skill = processor.getSkill(name);
  if (!skill) {
    return c.json(
      {
        error: {
          code: 'SKILL_NOT_FOUND',
          message: `Skill "${name}" not found`,
        },
      },
      404
    );
  }

  return c.json({
    name: skill.name,
    description: skill.description,
    aliases: skill.aliases,
    category: skill.category,
    systemPrompt: skill.systemPrompt,
    userPromptTemplate: skill.userPromptTemplate,
    requiredTools: skill.requiredTools,
    parameters: skill.parameters || [],
    help: processor.formatSkillHelp(skill),
  });
});

/**
 * POST /api/skills/:name/parse
 * Parse a skill command and return formatted prompts
 * Useful for previewing what a skill will do
 */
skills.post('/:name/parse', async (c) => {
  const name = c.req.param('name');
  const processor = getSkillProcessor();

  const skill = processor.getSkill(name);
  if (!skill) {
    return c.json(
      {
        error: {
          code: 'SKILL_NOT_FOUND',
          message: `Skill "${name}" not found`,
        },
      },
      404
    );
  }

  let body: { input: string; context?: Record<string, string> };
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          code: 'INVALID_JSON',
          message: 'Invalid JSON in request body',
        },
      },
      400
    );
  }

  if (!body.input || typeof body.input !== 'string') {
    return c.json(
      {
        error: {
          code: 'INPUT_REQUIRED',
          message: 'Input is required',
        },
      },
      400
    );
  }

  // Create mock invocation for formatting
  const invocation = {
    skillName: skill.name,
    skill,
    userInput: body.input,
    parameters: body.context || {},
  };

  const formatted = processor.formatPrompts(invocation, {
    additionalContext: body.context,
  });

  return c.json({
    skillName: skill.name,
    formatted: {
      systemPrompt: formatted.systemPrompt,
      userPrompt: formatted.userPrompt,
      requiredTools: formatted.requiredTools,
    },
  });
});

export { skills as skillRoutes };
