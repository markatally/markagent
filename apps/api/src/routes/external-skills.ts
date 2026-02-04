/**
 * External Skills Routes
 * API endpoints for listing and getting external skill information
 */

import { Hono } from 'hono';
import { requireAuth, AuthContext } from '../middleware/auth';
import { getExternalSkillLoader } from '../services/external-skills/loader';

const externalSkills = new Hono<AuthContext>();
const loader = getExternalSkillLoader();

externalSkills.use('*', requireAuth);

externalSkills.get('/', async (c) => {
  const category = c.req.query('category');
  const skills = category
    ? await loader.getSkillsByCategory(category)
    : await loader.listSkills();
  return c.json({ skills, total: skills.length });
});

externalSkills.get('/snapshot/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const snapshot = await loader.getSkillSnapshot(sessionId);
  return c.json({
    snapshotId: snapshot.snapshotId,
    createdAt: snapshot.createdAt,
    total: snapshot.skills.size,
  });
});

externalSkills.get('/:canonicalId', async (c) => {
  const canonicalId = c.req.param('canonicalId');
  const skill = await loader.getSkill(canonicalId);
  if (!skill) {
    return c.json(
      {
        error: {
          code: 'EXTERNAL_SKILL_NOT_FOUND',
          message: `External skill "${canonicalId}" not found`,
        },
      },
      404
    );
  }
  return c.json(skill);
});

export { externalSkills as externalSkillRoutes };
