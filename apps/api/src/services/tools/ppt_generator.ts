/**
 * PowerPoint Generator Tool
 * Creates PowerPoint presentations from structured content
 * Uses pptxgenjs open-source library
 */

import PptxGenJS from 'pptxgenjs';
import path from 'path';
import { promises as fs } from 'fs';
import { prisma } from '../prisma';
import type { Tool, ToolResult, ToolContext } from './types';

/**
 * Slide content structure
 */
interface Slide {
  title: string;
  content: string[];
  bullets?: string[];
  notes?: string;
}

/**
 * Presentation structure
 */
interface Presentation {
  title: string;
  subtitle?: string;
  author?: string;
  slides: Slide[];
}

/**
 * PowerPoint Generator Tool
 * Generates .pptx files from structured presentation content
 */
export class PptGeneratorTool implements Tool {
  name = 'ppt_generator';
  description = 'Generate PowerPoint (.pptx) presentation from structured content. Create professional presentations with titles, content, and bullet points.';
  requiresConfirmation = false; // No confirmation needed for file generation
  timeout = 30000;

  inputSchema = {
    type: 'object' as const,
    properties: {
      presentation: {
        type: 'object' as const,
        description: 'The presentation data structure',
        properties: {
          title: {
            type: 'string' as const,
            description: 'Presentation title (shown on first slide)',
          },
          subtitle: {
            type: 'string' as const,
            description: 'Optional subtitle for the title slide',
          },
          author: {
            type: 'string' as const,
            description: 'Optional author name',
          },
          slides: {
            type: 'array' as const,
            description: 'Array of slide objects with title, content, and bullets',
            items: {
              type: 'object' as const,
              properties: {
                title: {
                  type: 'string' as const,
                  description: 'Slide title',
                },
                content: {
                  type: 'array' as const,
                  description: 'Array of content paragraphs/text for slide',
                  items: { type: 'string' as const },
                },
                bullets: {
                  type: 'array' as const,
                  description: 'Optional bullet points',
                  items: { type: 'string' as const },
                },
                notes: {
                  type: 'string' as const,
                  description: 'Optional presenter notes',
                },
              },
              required: ['title', 'content'],
            },
          },
        },
        required: ['title', 'slides'],
      },
      filename: {
        type: 'string' as const,
        description: 'Output filename (default: presentation.pptx)',
      },
    },
    required: ['presentation'],
  };

  constructor(private context: ToolContext) {}

  async execute(params: Record<string, any>): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const normalizedParams: Record<string, any> = { ...(params || {}) };

      // Normalize common LLM mistakes
      if (typeof normalizedParams.presentation === 'string') {
        try {
          normalizedParams.presentation = JSON.parse(normalizedParams.presentation);
        } catch {
          // Keep as-is; validation below will handle invalid structure
        }
      }

      if (!normalizedParams.presentation && (normalizedParams.title || normalizedParams.slides)) {
        normalizedParams.presentation = {
          title: normalizedParams.title,
          subtitle: normalizedParams.subtitle,
          author: normalizedParams.author,
          slides: normalizedParams.slides,
        };
      }

      let presentation = normalizedParams.presentation as Presentation;

      if (presentation && typeof (presentation as any).slides === 'string') {
        try {
          const parsedSlides = JSON.parse((presentation as any).slides);
          if (Array.isArray(parsedSlides)) {
            presentation = { ...presentation, slides: parsedSlides };
          }
        } catch {
          // Keep as-is; validation below will handle invalid structure
        }
      }

      if (presentation && Array.isArray(presentation.slides)) {
        presentation = {
          ...presentation,
          slides: presentation.slides.map((slide) => {
            if (!slide || typeof slide !== 'object') return slide;
            const normalizedSlide = { ...slide };
            if (typeof normalizedSlide.content === 'string') {
              normalizedSlide.content = [normalizedSlide.content];
            }
            if (typeof normalizedSlide.bullets === 'string') {
              normalizedSlide.bullets = [normalizedSlide.bullets];
            }
            return normalizedSlide;
          }),
        };
      }

      const filename = (normalizedParams.filename as string) || 'presentation.pptx';

      // Validate presentation structure
      if (!presentation || typeof presentation !== 'object') {
        return {
          success: false,
          output: '',
          error: 'Presentation data is required',
          duration: Date.now() - startTime,
        };
      }

      if (!presentation.title || !Array.isArray(presentation.slides)) {
        return {
          success: false,
          output: '',
          error: 'Presentation must have title and slides array',
          duration: Date.now() - startTime,
        };
      }

      if (presentation.slides.length === 0) {
        return {
          success: false,
          output: '',
          error: 'Presentation must have at least one slide',
          duration: Date.now() - startTime,
        };
      }

      // Generate PPTX
      const pptx = new PptxGenJS();

      // Set metadata
      pptx.title = presentation.title;
      pptx.author = presentation.author || 'Mark Agent';
      pptx.subject = presentation.title;

      // Create title slide
      const titleSlide = pptx.addSlide();
      titleSlide.addText(presentation.title, {
        x: 1,
        y: 1.5,
        w: '80%',
        h: 1,
        fontSize: 44,
        bold: true,
        align: 'center',
        color: '363636',
      });

      if (presentation.subtitle) {
        titleSlide.addText(presentation.subtitle, {
          x: 1,
          y: 2.5,
          w: '80%',
          h: 0.75,
          fontSize: 24,
          align: 'center',
          color: '666666',
        });
      }

      // Create content slides
      for (let i = 0; i < presentation.slides.length; i++) {
        const slideData = presentation.slides[i];
        const slide = pptx.addSlide();

        // Add slide title
        slide.addText(slideData.title, {
          x: 0.5,
          y: 0.5,
          w: '90%',
          h: 0.75,
          fontSize: 32,
          bold: true,
          color: '363636',
        });

        let yPos = 1.5;

        // Add content paragraphs
        if (slideData.content && Array.isArray(slideData.content)) {
          for (const content of slideData.content) {
            slide.addText(content, {
              x: 0.5,
              y: yPos,
              w: '90%',
              h: 0.75,
              fontSize: 18,
              color: '444444',
            });
            yPos += 0.85;
          }
        }

        // Add bullet points
        if (slideData.bullets && Array.isArray(slideData.bullets)) {
          for (const bullet of slideData.bullets) {
            slide.addText(`• ${bullet}`, {
              x: 0.5,
              y: yPos,
              w: '85%',
              h: 0.5,
              fontSize: 16,
              color: '555555',
            });
            yPos += 0.55;
          }
        }

        // Add speaker notes
        if (slideData.notes) {
          slide.addNotes(slideData.notes);
        }
      }

      // Create outputs directory if it doesn't exist (project convention)
      const outputsDir = path.join(process.cwd(), 'outputs', 'ppt');
      await fs.mkdir(outputsDir, { recursive: true });

      // Sanitize filename
      const safeFilename = this.sanitizeFilename(filename.endsWith('.pptx') ? filename : `${filename}.pptx`);
      const filepath = path.join(outputsDir, safeFilename);

      // Generate to PPTX file
      await pptx.writeFile({ fileName: filepath });

      // Get file size
      const stats = await fs.stat(filepath);
      const sizeBytes = stats.size;
      const sizeKB = (sizeBytes / 1024).toFixed(2);

      // Save to database for download when context is available
      let fileId: string | undefined;
      if (this.context?.sessionId) {
        try {
          const dbFile = await prisma.file.create({
            data: {
              sessionId: this.context.sessionId,
              filename: safeFilename,
              filepath: `outputs/ppt/${safeFilename}`,
              sizeBytes: BigInt(sizeBytes),
              mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            },
          });
          fileId = dbFile.id;
        } catch (error) {
          console.warn('Failed to save file to database:', error);
          // Continue without database entry - file still exists on disk
        }
      }

      const output = `Successfully generated PowerPoint presentation:

📊 Presentation: ${presentation.title}
📄 Filename: ${safeFilename}
📊 Slides: ${presentation.slides.length + 1} (including title slide)
📦 Size: ${sizeKB} KB
📍 Location: outputs/ppt/${safeFilename}

The presentation is ready for download.`;

      return {
        success: true,
        output,
        duration: Date.now() - startTime,
        artifacts: [
          {
            type: 'file',
            name: safeFilename,
            content: '', // File is on disk, not in memory
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            fileId,
            size: sizeBytes,
          },
        ],
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message || 'Failed to generate PowerPoint',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Sanitize filename to prevent path traversal
   */
  private sanitizeFilename(filename: string): string {
    const basename = path.basename(filename);
    return basename.replace(/[\/\\:*?"<>|\x00]/g, '_');
  }
}
