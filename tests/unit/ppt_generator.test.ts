/**
 * PPT Generator Tool Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { PptGeneratorTool } from '../../apps/api/src/services/tools/ppt_generator';
import type { ToolContext } from '../../apps/api/src/services/tools/types';
import { promises as fs } from 'fs';
import path from 'path';

describe('PptGeneratorTool', () => {
  const mockWorkspaceDir = '/tmp/test-ppt-workspace';
  // Match the tool's output directory: outputs/ppt
  const mockOutputDir = path.join(process.cwd(), 'outputs', 'ppt');
  let mockContext: ToolContext;

  beforeEach(async () => {
    // Create temporary workspace
    await fs.mkdir(mockWorkspaceDir, { recursive: true });
    // Create output directory following project convention
    await fs.mkdir(mockOutputDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up
    try {
      await fs.rm(mockWorkspaceDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    try {
      await fs.rm(mockOutputDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should generate a basic PowerPoint presentation', async () => {
    const tool = new PptGeneratorTool(mockContext);

    const result = await tool.execute({
      presentation: {
        title: 'Test Presentation',
        subtitle: 'Created by Mark Agent',
        slides: [
          {
            title: 'Introduction',
            content: ['This is a test presentation'],
            bullets: ['First point', 'Second point'],
          },
        ],
      },
      filename: 'test.pptx',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Successfully generated PowerPoint');
    expect(result.output).toContain('test.pptx');

    // Verify file was created in outputs directory
    const filePath = path.join(mockOutputDir, 'test.pptx');
    const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
    expect(fileExists).toBe(true);
  });

  it('should handle presentation with multiple slides', async () => {
    const tool = new PptGeneratorTool(mockContext);

    const result = await tool.execute({
      presentation: {
        title: 'Multi Slide Presentation',
        slides: [
          {
            title: 'Slide 1',
            content: ['Content for slide 1'],
          },
          {
            title: 'Slide 2',
            content: ['Content for slide 2'],
            bullets: ['Point A', 'Point B', 'Point C'],
          },
          {
            title: 'Slide 3',
            content: ['Content for slide 3'],
            notes: 'Speaker notes for slide 3',
          },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('4'); // 3 content slides + 1 title slide
  });

  it('should require presentation title', async () => {
    const tool = new PptGeneratorTool(mockContext);

    const result = await tool.execute({
      presentation: {
        title: '',
        slides: [{ title: 'Test', content: [] }],
      },
    });

    expect(result.success).toBe(false);
  });

  it('should require slides array', async () => {
    const tool = new PptGeneratorTool(mockContext);

    const result = await tool.execute({
      presentation: {
        title: 'Test',
        slides: [],
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('at least one slide');
  });

  it('should generate default filename when not provided', async () => {
    const tool = new PptGeneratorTool(mockContext);

    const result = await tool.execute({
      presentation: {
        title: 'Default Filename Test',
        slides: [{ title: 'Test', content: ['Test content'] }],
      },
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('presentation.pptx');

    // Verify file with default name was created
    const filePath = path.join(mockOutputDir, 'presentation.pptx');
    const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
    expect(fileExists).toBe(true);
  });

  it('should sanitize filenames with invalid characters', async () => {
    const tool = new PptGeneratorTool(mockContext);

    const result = await tool.execute({
      presentation: {
        title: 'Sanitization Test',
        slides: [{ title: 'Test', content: ['Test'] }],
      },
      filename: 'test:file:name.pptx',
    });

    expect(result.success).toBe(true);
    // Path separators and invalid chars should be replaced with underscores
    expect(result.output).toContain('file_name.pptx');
  });

  it('should add .pptx extension if missing', async () => {
    const tool = new PptGeneratorTool(mockContext);

    const result = await tool.execute({
      presentation: {
        title: 'Extension Test',
        slides: [{ title: 'Test', content: ['Test'] }],
      },
      filename: 'myfile',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('myfile.pptx');

    const filePath = path.join(mockOutputDir, 'myfile.pptx');
    const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
    expect(fileExists).toBe(true);
  });

  it('should handle optional fields (subtitle, author, notes)', async () => {
    const tool = new PptGeneratorTool(mockContext);

    const result = await tool.execute({
      presentation: {
        title: 'Optional Fields Test',
        subtitle: 'With subtitle',
        author: 'Mark Agent',
        slides: [
          {
            title: 'Slide with notes',
            content: ['Content'],
            notes: 'These are speaker notes',
          },
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  it('should include artifacts in result', async () => {
    const tool = new PptGeneratorTool(mockContext);

    const result = await tool.execute({
      presentation: {
        title: 'Artifacts Test',
        slides: [{ title: 'Test', content: ['Test'] }],
      },
    });

    expect(result.success).toBe(true);
    expect(result.artifacts).toBeDefined();
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts![0].type).toBe('file');
    expect(result.artifacts![0].mimeType).toContain('presentationml.presentation');
  });
});
