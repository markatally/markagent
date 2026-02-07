/**
 * LangGraph Agent System - Atomic Skill Definitions
 * 
 * Each skill does exactly ONE thing with strict input/output schemas.
 * Skills NEVER call each other directly - all coordination via LangGraph.
 */

import { z, ZodSchema } from 'zod';
import type { ToolRegistry } from '../tools/registry';
import type { LLMClient } from '../llm';
import type { 
  RetryPolicy, 
  SkillMetadata,
  Paper,
  PaperSummary,
  Claim,
  ComparisonMatrix,
  Outline,
  Slide,
  ContentChunk,
  KeyPoint,
} from './types';

// ============================================================
// SKILL INTERFACES
// ============================================================

/**
 * Context provided to skill execution
 */
export interface SkillContext {
  sessionId: string;
  userId: string;
  tools: ToolRegistry;
  llm: LLMClient;
  startTime: number;
  abortSignal?: AbortSignal;
}

/**
 * Atomic skill interface - the core abstraction
 */
export interface AtomicSkill<TInput, TOutput> {
  // Metadata
  metadata: SkillMetadata;
  
  // Schemas (Zod-based for runtime validation)
  inputSchema: ZodSchema<TInput>;
  outputSchema: ZodSchema<TOutput>;
  
  // Core execution
  execute(input: TInput, context: SkillContext): Promise<TOutput>;
  
  // Optional hooks
  beforeExecute?(input: TInput, context: SkillContext): Promise<TInput>;
  afterExecute?(output: TOutput, context: SkillContext): Promise<TOutput>;
}

/**
 * Skill execution result with metadata
 */
export interface SkillExecutionResult<TOutput> {
  success: boolean;
  output?: TOutput;
  error?: string;
  duration: number;
  retries: number;
}

// ============================================================
// SKILL REGISTRY
// ============================================================

/**
 * Central registry for all atomic skills
 */
export class SkillRegistry {
  private skills: Map<string, AtomicSkill<any, any>> = new Map();
  
  /**
   * Register a skill
   */
  register<TInput, TOutput>(skill: AtomicSkill<TInput, TOutput>): void {
    this.validateSkill(skill);
    this.skills.set(skill.metadata.id, skill);
    console.log(`[SkillRegistry] Registered skill: ${skill.metadata.id} v${skill.metadata.version}`);
  }
  
  /**
   * Get a skill by ID
   */
  get<TInput, TOutput>(id: string): AtomicSkill<TInput, TOutput> | undefined {
    return this.skills.get(id);
  }
  
  /**
   * Check if a skill exists
   */
  has(id: string): boolean {
    return this.skills.has(id);
  }
  
  /**
   * Get all skills
   */
  getAll(): AtomicSkill<any, any>[] {
    return Array.from(this.skills.values());
  }
  
  /**
   * Get skills by category
   */
  getByCategory(category: string): AtomicSkill<any, any>[] {
    return this.getAll().filter(s => s.metadata.category === category);
  }
  
  /**
   * List all skill IDs
   */
  listIds(): string[] {
    return Array.from(this.skills.keys());
  }
  
  /**
   * Execute a skill with retry logic
   */
  async execute<TInput, TOutput>(
    skillId: string,
    input: TInput,
    context: SkillContext
  ): Promise<SkillExecutionResult<TOutput>> {
    const skill = this.get<TInput, TOutput>(skillId);
    
    if (!skill) {
      return {
        success: false,
        error: `Skill not found: ${skillId}`,
        duration: 0,
        retries: 0,
      };
    }
    
    const startTime = Date.now();
    let retries = 0;
    const { maxRetries, backoffMs, backoffMultiplier } = skill.metadata.retryPolicy;
    
    while (retries <= maxRetries) {
      try {
        // Validate input
        const validatedInput = skill.inputSchema.parse(input);
        
        // Run beforeExecute hook
        const processedInput = skill.beforeExecute
          ? await skill.beforeExecute(validatedInput, context)
          : validatedInput;
        
        // Execute skill
        let output = await skill.execute(processedInput, context);
        
        // Run afterExecute hook
        output = skill.afterExecute
          ? await skill.afterExecute(output, context)
          : output;
        
        // Validate output
        const validatedOutput = skill.outputSchema.parse(output);
        
        return {
          success: true,
          output: validatedOutput,
          duration: Date.now() - startTime,
          retries,
        };
      } catch (error) {
        retries++;
        
        if (retries > maxRetries) {
          return {
            success: false,
            error: this.formatExecutionError(error),
            duration: Date.now() - startTime,
            retries: retries - 1,
          };
        }
        
        // Wait before retry
        const waitTime = backoffMs * Math.pow(backoffMultiplier, retries - 1);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    return {
      success: false,
      error: 'Max retries exceeded',
      duration: Date.now() - startTime,
      retries,
    };
  }
  
  /**
   * Validate skill definition
   */
  private validateSkill(skill: AtomicSkill<any, any>): void {
    const { metadata } = skill;
    
    if (!metadata.id) {
      throw new Error('Skill must have an id');
    }
    
    if (!metadata.name) {
      throw new Error('Skill must have a name');
    }
    
    if (!metadata.version) {
      throw new Error('Skill must have a version');
    }
    
    if (!skill.inputSchema || !this.isZodSchema(skill.inputSchema)) {
      throw new Error('Skill must have a valid Zod input schema');
    }
    
    if (!skill.outputSchema || !this.isZodSchema(skill.outputSchema)) {
      throw new Error('Skill must have a valid Zod output schema');
    }
    
    if (typeof skill.execute !== 'function') {
      throw new Error('Skill must implement execute function');
    }
    
    if (this.skills.has(metadata.id)) {
      console.warn(`[SkillRegistry] Overwriting existing skill: ${metadata.id}`);
    }
  }

  private isZodSchema(value: unknown): value is z.ZodTypeAny {
    return !!value && typeof (value as z.ZodTypeAny).safeParse === 'function';
  }

  private formatExecutionError(error: unknown): string {
    if (error && typeof error === 'object' && (error as any).name === 'ZodError') {
      return `validation error: ${error instanceof Error ? error.message : String(error)}`;
    }
    return error instanceof Error ? error.message : String(error);
  }
}

// ============================================================
// RESEARCH SKILLS
// ============================================================

/**
 * Paper Discovery Skill
 * Discovers academic papers from multiple sources
 */
export const PaperDiscoveryInputSchema = z.object({
  query: z.string().min(3).max(500),
  sources: z.array(z.enum(['arxiv', 'semantic_scholar', 'pubmed', 'google_scholar'])).default(['arxiv', 'semantic_scholar']),
  maxResults: z.number().min(1).max(50).default(20),
  dateRange: z.object({
    start: z.coerce.date().optional(),
    end: z.coerce.date().optional(),
  }).optional(),
});

export const PaperDiscoveryOutputSchema = z.object({
  papers: z.array(z.object({
    id: z.string(),
    title: z.string(),
    authors: z.array(z.string()),
    abstract: z.string(),
    url: z.string().url(),
    source: z.enum(['arxiv', 'semantic_scholar', 'pubmed', 'google_scholar', 'other']),
    publishedDate: z.coerce.date().optional(),
    citationCount: z.number().optional(),
    publicationDateSource: z.string().optional(),
    publicationDateConfidence: z.enum(['high', 'medium', 'low']).optional(),
    exclusionReasons: z.array(z.string()).optional(),
  })),
  metadata: z.object({
    totalFound: z.number(),
    sourcesSearched: z.array(z.string()),
    duration: z.number(),
    sourcesSkipped: z.array(z.string()).optional(),
    exclusionReasons: z.array(z.string()).optional(),
  }),
});

export type PaperDiscoveryInput = z.infer<typeof PaperDiscoveryInputSchema>;
export type PaperDiscoveryOutput = z.infer<typeof PaperDiscoveryOutputSchema>;

export const PaperDiscoverySkill: AtomicSkill<PaperDiscoveryInput, PaperDiscoveryOutput> = {
  metadata: {
    id: 'paper_discovery',
    name: 'Paper Discovery',
    version: '1.1.0', // Version bump for recall-permissive behavior
    description: 'Discovers academic papers from multiple sources. Zero results are informational, not errors.',
    category: 'research',
    requiredTools: ['paper_search'],
    estimatedDurationMs: 10000,
    retryPolicy: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
  },
  
  inputSchema: PaperDiscoveryInputSchema,
  outputSchema: PaperDiscoveryOutputSchema,
  
  async execute(input, context) {
    const startTime = Date.now();
    const searchTool = context.tools.getTool('paper_search');

    if (!searchTool) {
      // RECALL-PERMISSIVE: Return empty results instead of throwing
      console.warn('[PaperDiscoverySkill] paper_search tool not available, returning empty results');
      return {
        papers: [],
        metadata: {
          totalFound: 0,
          sourcesSearched: [],
          duration: Date.now() - startTime,
          sourcesSkipped: ['paper_search_unavailable'],
          exclusionReasons: ['paper_search tool is required but not available'],
        },
      };
    }

    const sourcesParam =
      input.sources.length === 0 || (input.sources.includes('arxiv') && input.sources.includes('semantic_scholar'))
        ? 'all'
        : input.sources[0] === 'arxiv'
          ? 'arxiv'
          : 'semantic_scholar';

    let result;
    try {
      result = await searchTool.execute({
        query: input.query,
        sources: sourcesParam,
        topK: input.maxResults,
        // CRITICAL: Do not pass dateRange here - constraints applied during verification only
      });
    } catch (error) {
      // RECALL-PERMISSIVE: Catch errors and return empty results
      console.error('[PaperDiscoverySkill] Search failed:', error);
      return {
        papers: [],
        metadata: {
          totalFound: 0,
          sourcesSearched: input.sources,
          duration: Date.now() - startTime,
          sourcesSkipped: [],
          exclusionReasons: [`Search error: ${error instanceof Error ? error.message : String(error)}`],
        },
      };
    }

    let papers: Paper[] = [];

    // Parse results from artifact (primary method)
    if (result.artifacts?.length) {
      const artifact = result.artifacts.find((a) => a.name === 'search-results.json');
      if (artifact && typeof artifact.content === 'string') {
        try {
          const data = JSON.parse(artifact.content) as {
            results?: Array<{
              title: string;
              authors: string[];
              abstract?: string;
              link: string;
              source: string;
              doi?: string | null;
              publicationDate?: string | null;
              publicationDateSource?: string | null;
              publicationDateConfidence?: string | null;
              venue?: string | null;
              citationCount?: number | null;
              exclusionReasons?: string[];
            }>;
            zeroResults?: boolean;
            suggestion?: string;
          };
          if (data.results?.length) {
            papers = data.results.map((r, i) => ({
              id: r.doi ?? r.link ?? `paper_${i}`,
              title: r.title,
              authors: r.authors?.length ? r.authors : ['Unknown'],
              abstract: r.abstract ?? '',
              url: r.link,
              source: mapSourceToPaperSource(r.source),
              publishedDate: r.publicationDate ? new Date(r.publicationDate) : undefined,
              citationCount: r.citationCount ?? undefined,
              publicationDateSource: r.publicationDateSource ?? undefined,
              publicationDateConfidence: (r.publicationDateConfidence as 'high' | 'medium' | 'low') ?? undefined,
              exclusionReasons: r.exclusionReasons,
            }));
          }
        } catch (e) {
          console.error('[PaperDiscoverySkill] Failed to parse search-results.json:', e);
        }
      }
    }

    // Fallback: Parse from output text if no artifact results
    if (papers.length === 0 && result.output) {
      for (const source of input.sources) {
        papers.push(...parseSearchResultsToPapers(result.output, source));
      }
    }

    const uniquePapers = deduplicatePapers(papers);
    const data = result.artifacts?.[0];
    const parsed = data && typeof data.content === 'string' ? (() => { try { return JSON.parse(data.content); } catch { return {}; } })() : {};
    const sourcesSearched = parsed.sourcesQueried ?? input.sources;
    const sourcesSkipped = parsed.sourcesSkipped ?? [];
    const exclusionReasons = parsed.exclusionReasons ?? [];

    // RECALL-PERMISSIVE: Log zero results but don't treat as error
    if (uniquePapers.length === 0) {
      console.log(`[PaperDiscoverySkill] Zero papers found for query "${input.query}". This is informational, not an error.`);
    }

    return {
      papers: uniquePapers.slice(0, input.maxResults),
      metadata: {
        totalFound: uniquePapers.length,
        sourcesSearched,
        duration: Date.now() - startTime,
        sourcesSkipped: sourcesSkipped.length ? sourcesSkipped : undefined,
        exclusionReasons: exclusionReasons.length ? exclusionReasons : undefined,
      },
    };
  },
};

/**
 * Paper Summarize Skill
 * Summarizes a single academic paper
 */
export const PaperSummarizeInputSchema = z.object({
  paper: z.object({
    id: z.string(),
    title: z.string(),
    abstract: z.string(),
    authors: z.array(z.string()).optional(),
  }),
});

export const PaperSummarizeOutputSchema = z.object({
  paperId: z.string(),
  paperTitle: z.string(),
  mainContributions: z.array(z.string()).min(1),
  methodology: z.string(),
  keyFindings: z.array(z.string()).min(1),
  limitations: z.array(z.string()),
  relevanceScore: z.number().min(0).max(1).optional(),
});

export type PaperSummarizeInput = z.infer<typeof PaperSummarizeInputSchema>;
export type PaperSummarizeOutput = z.infer<typeof PaperSummarizeOutputSchema>;

export const PaperSummarizeSkill: AtomicSkill<PaperSummarizeInput, PaperSummarizeOutput> = {
  metadata: {
    id: 'paper_summarize',
    name: 'Paper Summarization',
    version: '1.0.0',
    description: 'Summarizes a single academic paper extracting key contributions and findings',
    category: 'research',
    requiredTools: [],
    estimatedDurationMs: 5000,
    retryPolicy: { maxRetries: 2, backoffMs: 500, backoffMultiplier: 2 },
  },
  
  inputSchema: PaperSummarizeInputSchema,
  outputSchema: PaperSummarizeOutputSchema,
  
  async execute(input, context) {
    const { paper } = input;
    
    const prompt = `Analyze the following academic paper and provide a structured summary.

Title: ${paper.title}
Authors: ${paper.authors?.join(', ') || 'Unknown'}

Abstract:
${paper.abstract}

Provide your analysis in the following JSON format:
{
  "mainContributions": ["contribution 1", "contribution 2"],
  "methodology": "Brief description of the methodology",
  "keyFindings": ["finding 1", "finding 2"],
  "limitations": ["limitation 1"],
  "relevanceScore": 0.8
}

Be concise but comprehensive. Focus on the actual scientific contributions.`;

    const response = await context.llm.chat([
      { role: 'system', content: 'You are an expert academic paper analyzer. Always respond with valid JSON.' },
      { role: 'user', content: prompt },
    ]);
    
    // Parse LLM response
    const content = response.content || '';
    const parsed = JSON.parse(extractJSON(content));
    
    return {
      paperId: paper.id,
      paperTitle: paper.title,
      mainContributions: parsed.mainContributions || ['Unable to extract'],
      methodology: parsed.methodology || 'Not specified',
      keyFindings: parsed.keyFindings || ['Unable to extract'],
      limitations: parsed.limitations || [],
      relevanceScore: parsed.relevanceScore,
    };
  },
};

/**
 * Paper Compare Skill
 * Compares multiple papers across dimensions
 */
export const PaperCompareInputSchema = z.object({
  summaries: z.array(z.object({
    paperId: z.string(),
    paperTitle: z.string(),
    mainContributions: z.array(z.string()),
    methodology: z.string(),
    keyFindings: z.array(z.string()),
  })),
  dimensions: z.array(z.string()).default(['methodology', 'novelty', 'impact', 'limitations']),
});

export const PaperCompareOutputSchema = z.object({
  dimensions: z.array(z.string()),
  papers: z.array(z.object({
    paperId: z.string(),
    scores: z.record(z.union([z.number(), z.string()])),
  })),
  summary: z.string().optional(),
});

export type PaperCompareInput = z.infer<typeof PaperCompareInputSchema>;
export type PaperCompareOutput = z.infer<typeof PaperCompareOutputSchema>;

export const PaperCompareSkill: AtomicSkill<PaperCompareInput, PaperCompareOutput> = {
  metadata: {
    id: 'paper_compare',
    name: 'Paper Comparison',
    version: '1.0.0',
    description: 'Compares multiple academic papers across specified dimensions',
    category: 'research',
    requiredTools: [],
    estimatedDurationMs: 8000,
    retryPolicy: { maxRetries: 2, backoffMs: 500, backoffMultiplier: 2 },
  },
  
  inputSchema: PaperCompareInputSchema,
  outputSchema: PaperCompareOutputSchema,
  
  async execute(input, context) {
    const { summaries, dimensions } = input;
    
    const paperDescriptions = summaries.map(s => `
Paper: ${s.paperTitle} (ID: ${s.paperId})
Contributions: ${s.mainContributions.join('; ')}
Methodology: ${s.methodology}
Findings: ${s.keyFindings.join('; ')}
`).join('\n---\n');

    const prompt = `Compare the following academic papers across these dimensions: ${dimensions.join(', ')}

Papers:
${paperDescriptions}

Provide a comparison in JSON format:
{
  "papers": [
    {
      "paperId": "paper_id",
      "scores": {
        "methodology": "Score or description",
        "novelty": "Score or description",
        ...
      }
    }
  ],
  "summary": "Brief overall comparison summary"
}

Use 1-5 numeric scores where applicable, or descriptive text for qualitative dimensions.`;

    const response = await context.llm.chat([
      { role: 'system', content: 'You are an expert at comparing academic papers. Always respond with valid JSON.' },
      { role: 'user', content: prompt },
    ]);
    
    const content = response.content || '';
    const parsed = JSON.parse(extractJSON(content));
    
    return {
      dimensions,
      papers: parsed.papers || [],
      summary: parsed.summary,
    };
  },
};

/**
 * Claim Synthesis Skill
 * Generates evidence-backed claims from paper summaries
 * CRITICAL: Every claim MUST have at least one supporting paper ID
 */
export const ClaimSynthesisInputSchema = z.object({
  summaries: z.array(z.object({
    paperId: z.string(),
    paperTitle: z.string(),
    mainContributions: z.array(z.string()),
    keyFindings: z.array(z.string()),
  })),
  comparisonMatrix: PaperCompareOutputSchema.optional(),
  maxClaims: z.number().min(1).max(20).default(10),
});

export const ClaimSynthesisOutputSchema = z.object({
  claims: z.array(z.object({
    id: z.string(),
    statement: z.string(),
    supportingPaperIds: z.array(z.string()).min(1), // MANDATORY
    confidence: z.enum(['high', 'medium', 'low']),
    category: z.string(),
    evidenceType: z.enum(['direct', 'inferred', 'synthesized']).default('direct'),
  })),
});

export type ClaimSynthesisInput = z.infer<typeof ClaimSynthesisInputSchema>;
export type ClaimSynthesisOutput = z.infer<typeof ClaimSynthesisOutputSchema>;

export const ClaimSynthesisSkill: AtomicSkill<ClaimSynthesisInput, ClaimSynthesisOutput> = {
  metadata: {
    id: 'claim_synthesis',
    name: 'Claim Synthesis',
    version: '1.0.0',
    description: 'Synthesizes evidence-backed claims from paper summaries. Every claim MUST cite sources.',
    category: 'research',
    requiredTools: [],
    estimatedDurationMs: 10000,
    retryPolicy: { maxRetries: 2, backoffMs: 500, backoffMultiplier: 2 },
  },
  
  inputSchema: ClaimSynthesisInputSchema,
  outputSchema: ClaimSynthesisOutputSchema,
  
  async execute(input, context) {
    const { summaries, maxClaims } = input;
    
    // Build paper ID list for validation
    const validPaperIds = new Set(summaries.map(s => s.paperId));
    
    const summaryText = summaries.map(s => `
[${s.paperId}] ${s.paperTitle}
- Contributions: ${s.mainContributions.join('; ')}
- Findings: ${s.keyFindings.join('; ')}
`).join('\n');

    const prompt = `Based on the following paper summaries, synthesize ${maxClaims} key claims.

CRITICAL REQUIREMENT: Every claim MUST cite at least one paper ID using the IDs provided below.

Papers:
${summaryText}

Valid Paper IDs: ${Array.from(validPaperIds).join(', ')}

Generate claims in JSON format:
{
  "claims": [
    {
      "id": "claim_1",
      "statement": "The claim statement",
      "supportingPaperIds": ["paper_id_1", "paper_id_2"],
      "confidence": "high|medium|low",
      "category": "methodology|finding|trend|gap",
      "evidenceType": "direct|inferred|synthesized"
    }
  ]
}

IMPORTANT: 
- Every claim MUST have at least one paper ID in supportingPaperIds
- Only use paper IDs from the list provided
- If a claim is synthesized from multiple papers, include all relevant IDs`;

    const response = await context.llm.chat([
      { role: 'system', content: 'You are an expert research synthesizer. ALWAYS cite sources. NEVER make claims without paper references.' },
      { role: 'user', content: prompt },
    ]);
    
    const content = response.content || '';
    const parsed = JSON.parse(extractJSON(content));
    
    // Validate that all claims have citations and citations are valid
    const validatedClaims = (parsed.claims || [])
      .filter((claim: any) => {
        if (!claim.supportingPaperIds || claim.supportingPaperIds.length === 0) {
          console.warn(`[ClaimSynthesis] Rejecting claim without citations: ${claim.statement}`);
          return false;
        }
        
        // Filter to only valid paper IDs
        claim.supportingPaperIds = claim.supportingPaperIds.filter(
          (id: string) => validPaperIds.has(id)
        );
        
        if (claim.supportingPaperIds.length === 0) {
          console.warn(`[ClaimSynthesis] Rejecting claim with invalid citations: ${claim.statement}`);
          return false;
        }
        
        return true;
      })
      .slice(0, maxClaims);
    
    return { claims: validatedClaims };
  },
};

// ============================================================
// PPT SKILLS
// ============================================================

export const OutlineGenerateSkill: AtomicSkill<
  { topic: string; context?: string; targetAudience?: string },
  Outline
> = {
  metadata: {
    id: 'outline_generate',
    name: 'Outline Generation',
    version: '1.0.0',
    description: 'Generates a presentation outline from a topic',
    category: 'ppt',
    requiredTools: [],
    estimatedDurationMs: 5000,
    retryPolicy: { maxRetries: 2, backoffMs: 500, backoffMultiplier: 2 },
  },
  
  inputSchema: z.object({
    topic: z.string().min(3),
    context: z.string().optional(),
    targetAudience: z.string().optional(),
  }),
  
  outputSchema: z.object({
    title: z.string(),
    sections: z.array(z.object({
      title: z.string(),
      bulletPoints: z.array(z.string()),
      estimatedSlides: z.number(),
    })),
    totalEstimatedSlides: z.number(),
  }),
  
  async execute(input, context) {
    const { topic, context: topicContext, targetAudience } = input;
    
    const prompt = `Create a presentation outline for: "${topic}"
${topicContext ? `Context: ${topicContext}` : ''}
${targetAudience ? `Target audience: ${targetAudience}` : ''}

Respond with JSON:
{
  "title": "Presentation Title",
  "sections": [
    {
      "title": "Section Title",
      "bulletPoints": ["Point 1", "Point 2"],
      "estimatedSlides": 2
    }
  ],
  "totalEstimatedSlides": 10
}`;

    const response = await context.llm.chat([
      { role: 'system', content: 'You are an expert presentation designer. Always respond with valid JSON.' },
      { role: 'user', content: prompt },
    ]);
    
    const content = response.content || '';
    return JSON.parse(extractJSON(content));
  },
};

// ============================================================
// SUMMARY SKILLS
// ============================================================

export const ContentChunkSkill: AtomicSkill<
  { content: string; maxChunkSize?: number },
  { chunks: ContentChunk[] }
> = {
  metadata: {
    id: 'content_chunk',
    name: 'Content Chunking',
    version: '1.0.0',
    description: 'Splits content into processable chunks',
    category: 'summary',
    requiredTools: [],
    estimatedDurationMs: 1000,
    retryPolicy: { maxRetries: 1, backoffMs: 100, backoffMultiplier: 1 },
  },
  
  inputSchema: z.object({
    content: z.string(),
    maxChunkSize: z.number().default(2000),
  }),
  
  outputSchema: z.object({
    chunks: z.array(z.object({
      id: z.string(),
      content: z.string(),
      startPosition: z.number(),
      endPosition: z.number(),
      chunkIndex: z.number(),
    })),
  }),
  
  async execute(input, _context) {
    const { content, maxChunkSize = 2000 } = input;
    const chunks: ContentChunk[] = [];
    
    // Split by paragraphs, then combine up to maxChunkSize
    const paragraphs = content.split(/\n\n+/);
    let currentChunk = '';
    let startPos = 0;
    let currentPos = 0;
    let chunkIndex = 0;
    
    for (const para of paragraphs) {
      if (currentChunk.length + para.length > maxChunkSize && currentChunk.length > 0) {
        chunks.push({
          id: `chunk_${chunkIndex}`,
          content: currentChunk.trim(),
          startPosition: startPos,
          endPosition: currentPos,
          chunkIndex,
        });
        chunkIndex++;
        startPos = currentPos;
        currentChunk = '';
      }
      
      currentChunk += para + '\n\n';
      currentPos += para.length + 2;
    }
    
    // Add remaining content
    if (currentChunk.trim().length > 0) {
      chunks.push({
        id: `chunk_${chunkIndex}`,
        content: currentChunk.trim(),
        startPosition: startPos,
        endPosition: currentPos,
        chunkIndex,
      });
    }
    
    return { chunks };
  },
};

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Extract JSON from LLM response (handles markdown code blocks)
 */
function extractJSON(content: string): string {
  // Try to extract from code blocks
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  
  // Try to find JSON object directly
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }
  
  return content;
}

function mapSourceToPaperSource(source: string): 'arxiv' | 'semantic_scholar' | 'pubmed' | 'google_scholar' | 'other' {
  if (source === 'arxiv' || source === 'semantic_scholar' || source === 'pubmed' || source === 'google_scholar') {
    return source;
  }
  return 'other';
}

/**
 * Parse search results into Paper format (fallback when artifact not available)
 */
function parseSearchResultsToPapers(output: string, source: string): Paper[] {
  const papers: Paper[] = [];
  
  // This is a simplified parser - real implementation would be more sophisticated
  try {
    const lines = output.split('\n');
    let currentPaper: Partial<Paper> | null = null;
    
    for (const line of lines) {
      if (line.includes('Title:') || line.match(/^\d+\./)) {
        if (currentPaper?.title) {
          papers.push(currentPaper as Paper);
        }
        currentPaper = {
          id: `paper_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          source: source as any,
          authors: [],
          abstract: '',
          url: '',
          title: line.replace(/^[\d.]+\s*Title:\s*/, '').trim(),
        };
      } else if (currentPaper && line.includes('Abstract:')) {
        currentPaper.abstract = line.replace('Abstract:', '').trim();
      } else if (currentPaper && line.includes('URL:')) {
        currentPaper.url = line.replace('URL:', '').trim();
      }
    }
    
    if (currentPaper?.title) {
      papers.push(currentPaper as Paper);
    }
  } catch (error) {
    console.error('[parseSearchResultsToPapers] Error:', error);
  }
  
  return papers;
}

/**
 * Deduplicate papers by title similarity
 */
function deduplicatePapers(papers: Paper[]): Paper[] {
  const seen = new Set<string>();
  const unique: Paper[] = [];
  
  for (const paper of papers) {
    const normalizedTitle = paper.title.toLowerCase().trim();
    if (!seen.has(normalizedTitle)) {
      seen.add(normalizedTitle);
      unique.push(paper);
    }
  }
  
  return unique;
}

// ============================================================
// DEFAULT REGISTRY
// ============================================================

/**
 * Create and populate default skill registry
 */
export function createDefaultSkillRegistry(): SkillRegistry {
  const registry = new SkillRegistry();
  
  // Register research skills
  registry.register(PaperDiscoverySkill);
  registry.register(PaperSummarizeSkill);
  registry.register(PaperCompareSkill);
  registry.register(ClaimSynthesisSkill);
  
  // Register PPT skills
  registry.register(OutlineGenerateSkill);
  
  // Register summary skills
  registry.register(ContentChunkSkill);
  
  return registry;
}
