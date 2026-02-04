/**
 * External Skills API Routes
 * Endpoints for managing and executing external skills
 */

import { Hono } from 'hono';
import { getEnhancedSkillProcessor } from '../services/skills/enhanced-processor';
import { getExternalSkillLoader } from '../services/external-skills/loader';
import { prisma } from '../services/prisma';
import { z } from 'zod';

const app = new Hono();

// Validation schemas
const ExecuteSkillSchema = z.object({
  input: z.string().min(1),
  parameters: z.record(z.any()).optional(),
  context: z
    .object({
      workspaceId: z.string().optional(),
      workspaceFiles: z.array(z.string()).optional(),
      additionalContext: z.record(z.any()).optional(),
    })
    .optional(),
});

const ToggleSkillSchema = z.object({
  enabled: z.boolean(),
});

/**
 * GET /api/skills/external
 * List all available external skills
 */
app.get('/', async (c) => {
  try {
    const processor = getEnhancedSkillProcessor();
    const query = c.req.query('q');
    const category = c.req.query('category');
    const enabled = c.req.query('enabled');

    let skills = await processor.listAvailableExternalSkills();

    // Filter by category
    if (category) {
      skills = skills.filter((s) => s.category === category);
    }

    // Filter by enabled status
    if (enabled !== undefined) {
      const enabledSet = new Set(processor['registry'].getEnabledExternal());
      const shouldBeEnabled = enabled === 'true';
      skills = skills.filter((s) => enabledSet.has(s.canonicalId) === shouldBeEnabled);
    }

    // Search by query
    if (query) {
      const lowerQuery = query.toLowerCase();
      skills = skills.filter(
        (s) =>
          s.name.toLowerCase().includes(lowerQuery) ||
          s.description.toLowerCase().includes(lowerQuery)
      );
    }

    return c.json({
      skills: skills.map((skill) => ({
        canonicalId: skill.canonicalId,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        version: skill.version,
        contractVersion: skill.contractVersion,
        invocationPattern: skill.kind ?? skill.invocationPattern,
        capabilityLevel: skill.capabilityLevel,
        executionScope: skill.executionScope,
        isProtected: skill.isProtected,
        source: {
          repoUrl: skill.sourceInfo?.repoUrl,
          repoPath: skill.sourceInfo?.repoPath,
        },
        enabled: processor['registry'].isExternalEnabled(skill.canonicalId),
      })),
      total: skills.length,
    });
  } catch (error) {
    console.error('Error listing external skills:', error);
    return c.json(
      {
        error: 'Failed to list external skills',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/skills/external/:canonicalId
 * Get details of a specific external skill
 */
app.get('/:canonicalId', async (c) => {
  try {
    const canonicalId = c.req.param('canonicalId');
    const loader = getExternalSkillLoader();
    const skill = await loader.getSkill(canonicalId);

    if (!skill) {
      return c.json({ error: 'Skill not found' }, 404);
    }

    const processor = getEnhancedSkillProcessor();
    const enabled = processor['registry'].isExternalEnabled(canonicalId);

    return c.json({
      skill: {
        ...skill,
        enabled,
      },
    });
  } catch (error) {
    console.error('Error getting external skill:', error);
    return c.json(
      {
        error: 'Failed to get external skill',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/skills/external/:canonicalId/toggle
 * Enable or disable an external skill
 */
app.post('/:canonicalId/toggle', async (c) => {
  try {
    const canonicalId = c.req.param('canonicalId');
    const body = await c.req.json();
    const validated = ToggleSkillSchema.parse(body);

    const processor = getEnhancedSkillProcessor();

    if (validated.enabled) {
      const success = await processor.enableExternalSkill(canonicalId);
      if (!success) {
        return c.json({ error: 'Failed to enable skill - skill not found' }, 404);
      }

      // TODO: Persist user preference to database
      // await prisma.userExternalSkill.upsert({ ... })

      return c.json({
        success: true,
        message: `Skill ${canonicalId} enabled`,
        enabled: true,
      });
    } else {
      processor.disableExternalSkill(canonicalId);

      // TODO: Update database
      // await prisma.userExternalSkill.update({ ... })

      return c.json({
        success: true,
        message: `Skill ${canonicalId} disabled`,
        enabled: false,
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request body', details: error.errors }, 400);
    }

    console.error('Error toggling external skill:', error);
    return c.json(
      {
        error: 'Failed to toggle external skill',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/skills/external/:canonicalId/execute
 * Execute an external skill
 */
app.post('/:canonicalId/execute', async (c) => {
  try {
    const canonicalId = c.req.param('canonicalId');
    const body = await c.req.json();
    const validated = ExecuteSkillSchema.parse(body);

    const processor = getEnhancedSkillProcessor();

    // Check if skill is enabled
    if (!processor['registry'].isExternalEnabled(canonicalId)) {
      return c.json(
        {
          error: 'Skill not enabled',
          message: `Please enable the skill ${canonicalId} before executing it`,
        },
        403
      );
    }

    // Get the skill
    const loader = getExternalSkillLoader();
    const skill = await loader.getSkill(canonicalId);

    if (!skill) {
      return c.json({ error: 'Skill not found' }, 404);
    }

    // Execute the skill
    const result = await processor.executeInvocation(
      {
        skillName: skill.name,
        skill: {
          name: skill.name,
          description: skill.description,
          aliases: [],
          category: 'development',
          systemPrompt: skill.systemPrompt || '',
          userPromptTemplate: skill.userPromptTemplate || '',
          requiredTools: skill.requiredTools || [],
          isExternal: true,
          externalMetadata: {
            canonicalId: skill.canonicalId,
            version: skill.version,
            capabilityLevel: skill.capabilityLevel,
            invocationPattern: skill.kind ?? skill.invocationPattern,
            source: skill.sourceInfo,
          },
        },
        userInput: validated.input,
        parameters: validated.parameters || {},
        isExternal: true,
        externalSkill: skill,
      },
      {
        workspaceId: validated.context?.workspaceId,
        workspaceFiles: validated.context?.workspaceFiles,
        additionalContext: validated.context?.additionalContext,
        metadata: validated.context?.additionalContext,
      }
    );

    // TODO: Log execution to database
    // await prisma.externalSkillExecution.create({ ... })

    return c.json({
      success: result.success,
      result: result.output,
      executionTime: result.executionTimeMs,
      metadata: result.metadata,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request body', details: error.errors }, 400);
    }

    console.error('Error executing external skill:', error);
    return c.json(
      {
        error: 'Failed to execute external skill',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/skills/all
 * Get all skills (product + external) combined
 */
app.get('/all/list', async (c) => {
  try {
    const processor = getEnhancedSkillProcessor();
    const category = c.req.query('category');

    const skills = category
      ? await processor.getSkillsByCategoryAsync(category)
      : await processor.getAllSkillsAsync();

    return c.json({
      skills: skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        category: skill.category,
        aliases: skill.aliases,
        isExternal: skill.isExternal,
        requiredTools: skill.requiredTools,
        parameters: skill.parameters,
        ...(skill.externalMetadata && {
          external: {
            canonicalId: skill.externalMetadata.canonicalId,
            version: skill.externalMetadata.version,
            invocationPattern: skill.externalMetadata.invocationPattern,
          },
        }),
      })),
      total: skills.length,
    });
  } catch (error) {
    console.error('Error listing all skills:', error);
    return c.json(
      {
        error: 'Failed to list skills',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/skills/stats
 * Get skill statistics
 */
app.get('/stats/summary', async (c) => {
  try {
    const processor = getEnhancedSkillProcessor();
    const stats = await processor.getSkillStats();

    return c.json(stats);
  } catch (error) {
    console.error('Error getting skill stats:', error);
    return c.json(
      {
        error: 'Failed to get skill stats',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/skills/search
 * Search skills by query
 */
app.post('/search', async (c) => {
  try {
    const body = await c.req.json();
    const query = body.query || '';

    if (!query) {
      return c.json({ error: 'Query is required' }, 400);
    }

    const processor = getEnhancedSkillProcessor();
    const skills = await processor.searchSkills(query);

    return c.json({
      skills: skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        category: skill.category,
        isExternal: skill.isExternal,
        ...(skill.externalMetadata && {
          canonicalId: skill.externalMetadata.canonicalId,
        }),
      })),
      total: skills.length,
      query,
    });
  } catch (error) {
    console.error('Error searching skills:', error);
    return c.json(
      {
        error: 'Failed to search skills',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

export const externalSkillRoutes = app;
export default app;
