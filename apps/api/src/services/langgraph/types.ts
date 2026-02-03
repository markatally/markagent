/**
 * LangGraph Agent System - Type Definitions
 * 
 * Core types for the LangGraph-based orchestration system.
 * All schemas are Zod-based for runtime validation.
 */

import { z } from 'zod';

// ============================================================
// BASE SCHEMAS
// ============================================================

/**
 * Parsed intent from user prompt
 */
export const ParsedIntentSchema = z.object({
  scenario: z.enum(['research', 'ppt', 'summary', 'general_chat']),
  entities: z.record(z.string()),
  parameters: z.record(z.unknown()),
  confidence: z.number().min(0).max(1),
});

/**
 * Single execution step in the graph
 */
export const ExecutionStepSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  startTime: z.coerce.date(),
  endTime: z.coerce.date().optional(),
  input: z.unknown(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
});

/**
 * Agent error with structured information
 */
export const AgentErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  nodeId: z.string().optional(),
  severity: z.enum(['warning', 'error', 'fatal']).default('error'),
  details: z.record(z.unknown()).optional(),
  timestamp: z.coerce.date().default(() => new Date()),
});

/**
 * Base agent state - extended by scenario-specific states
 */
export const AgentStateSchema = z.object({
  // Identity
  sessionId: z.string(),
  userId: z.string(),
  requestId: z.string(),
  timestamp: z.coerce.date(),
  
  // Input
  userPrompt: z.string(),
  parsedIntent: ParsedIntentSchema.optional(),
  
  // Execution tracking
  currentNode: z.string().default(''),
  executionHistory: z.array(ExecutionStepSchema).default([]),
  
  // Output accumulation
  intermediateResults: z.record(z.unknown()).default({}),
  
  // Error handling
  errors: z.array(AgentErrorSchema).default([]),
  warnings: z.array(AgentErrorSchema).default([]),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'stopped']).default('pending'),
  
  // Final output
  finalOutput: z.unknown().optional(),
});

// ============================================================
// RESEARCH SCENARIO SCHEMAS
// ============================================================

/**
 * Academic paper metadata
 * publicationDate resolved via tools only (CrossRef > arXiv v1 > Semantic Scholar).
 */
export const PaperSchema = z.object({
  id: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  abstract: z.string(),
  url: z.string().url(),
  source: z.enum(['arxiv', 'semantic_scholar', 'pubmed', 'google_scholar', 'other']),
  publishedDate: z.coerce.date().optional(),
  citationCount: z.number().optional(),
  doi: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  /** Source of publication date when present (crossref | arxiv_v1 | semantic_scholar) */
  publicationDateSource: z.string().optional(),
  /** Confidence when date is known (high | medium | low) */
  publicationDateConfidence: z.enum(['high', 'medium', 'low']).optional(),
  /** Exclusion/constraint notes when partial results are included */
  exclusionReasons: z.array(z.string()).optional(),
});

/**
 * Summary of a single paper
 */
export const PaperSummarySchema = z.object({
  paperId: z.string(),
  paperTitle: z.string(),
  mainContributions: z.array(z.string()).min(1),
  methodology: z.string(),
  keyFindings: z.array(z.string()).min(1),
  limitations: z.array(z.string()),
  relevanceScore: z.number().min(0).max(1).optional(),
});

/**
 * A claim with REQUIRED citations
 * CRITICAL: supportingPaperIds MUST have at least one entry
 */
export const ClaimSchema = z.object({
  id: z.string(),
  statement: z.string(),
  supportingPaperIds: z.array(z.string()).min(1),  // MANDATORY: at least one citation
  confidence: z.enum(['high', 'medium', 'low']),
  category: z.string(),
  evidenceType: z.enum(['direct', 'inferred', 'synthesized']).default('direct'),
});

/**
 * Comparison matrix for papers
 */
export const ComparisonMatrixSchema = z.object({
  dimensions: z.array(z.string()),
  papers: z.array(z.object({
    paperId: z.string(),
    scores: z.record(z.union([z.number(), z.string()])),
  })),
  summary: z.string().optional(),
});

/**
 * Final research report
 */
export const ResearchReportSchema = z.object({
  title: z.string(),
  abstract: z.string(),
  sections: z.array(z.object({
    heading: z.string(),
    content: z.string(),
    citations: z.array(z.string()),
  })),
  bibliography: z.array(z.object({
    paperId: z.string(),
    citation: z.string(),
  })),
  generatedAt: z.coerce.date(),
});

/**
 * Recall attempt tracking for research recovery
 */
export const RecallAttemptSchema = z.object({
  attemptNumber: z.number(),
  query: z.string(),
  sources: z.array(z.string()),
  resultsFound: z.number(),
  timestamp: z.coerce.date(),
  strategy: z.enum(['original', 'simplified', 'sub_query', 'broadened', 'academic_skill_direct']),
});

/**
 * Research-specific state
 */
export const ResearchStateSchema = AgentStateSchema.extend({
  // Query
  searchQuery: z.string().optional(),
  searchSources: z.array(z.enum(['arxiv', 'semantic_scholar', 'pubmed', 'google_scholar'])).default(['arxiv', 'semantic_scholar']),
  
  // Discovery phase
  discoveredPapers: z.array(PaperSchema).default([]),
  validPapers: z.array(PaperSchema).default([]),
  discoveryMetadata: z.object({
    totalFound: z.number(),
    sourcesSearched: z.array(z.string()),
    searchDuration: z.number(),
  }).optional(),
  
  // Recall tracking (for multi-attempt recovery)
  recallAttempts: z.array(RecallAttemptSchema).default([]),
  queriesAttempted: z.array(z.string()).default([]),
  maxRecallAttempts: z.number().default(5),
  recallExhausted: z.boolean().default(false),
  
  // Summarization phase
  paperSummaries: z.record(z.string(), PaperSummarySchema).default({}),
  
  // Comparison phase
  comparisonMatrix: ComparisonMatrixSchema.optional(),
  
  // Synthesis phase
  synthesizedClaims: z.array(ClaimSchema).default([]),
  
  // Final output
  finalReport: ResearchReportSchema.optional(),
  
  // Evidence gap report (for graceful halt)
  evidenceGapReport: z.object({
    queriesAttempted: z.array(z.string()),
    sourcesAttempted: z.array(z.string()),
    totalAttempts: z.number(),
    partialResults: z.array(PaperSchema).optional(),
    gaps: z.array(z.string()),
    recommendations: z.array(z.string()),
    timestamp: z.coerce.date(),
  }).optional(),
});

// ============================================================
// PPT SCENARIO SCHEMAS
// ============================================================

/**
 * Presentation outline
 */
export const OutlineSchema = z.object({
  title: z.string(),
  sections: z.array(z.object({
    title: z.string(),
    bulletPoints: z.array(z.string()),
    estimatedSlides: z.number(),
  })),
  totalEstimatedSlides: z.number(),
});

/**
 * Single slide content
 */
export const SlideSchema = z.object({
  slideNumber: z.number(),
  title: z.string(),
  content: z.array(z.string()),
  notes: z.string().optional(),
  layout: z.enum(['title', 'content', 'two_column', 'image', 'bullet_points', 'comparison']).default('content'),
  visualSuggestions: z.array(z.string()).optional(),
});

/**
 * PPT-specific state
 */
export const PPTStateSchema = AgentStateSchema.extend({
  topic: z.string().optional(),
  context: z.string().optional(),
  targetAudience: z.string().optional(),
  outline: OutlineSchema.optional(),
  slides: z.array(SlideSchema).default([]),
  outputPath: z.string().optional(),
  outputFileId: z.string().optional(),
});

// ============================================================
// SUMMARY SCENARIO SCHEMAS
// ============================================================

/**
 * Content chunk for processing
 */
export const ContentChunkSchema = z.object({
  id: z.string(),
  content: z.string(),
  startPosition: z.number(),
  endPosition: z.number(),
  chunkIndex: z.number(),
});

/**
 * Key points extracted from content
 */
export const KeyPointSchema = z.object({
  id: z.string(),
  point: z.string(),
  importance: z.enum(['high', 'medium', 'low']),
  sourceChunkId: z.string(),
});

/**
 * Summary-specific state
 */
export const SummaryStateSchema = AgentStateSchema.extend({
  sourceContent: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  contentType: z.enum(['text', 'article', 'document', 'webpage']).optional(),
  chunks: z.array(ContentChunkSchema).default([]),
  keyPoints: z.array(KeyPointSchema).default([]),
  summary: z.string().optional(),
  summaryLength: z.enum(['brief', 'standard', 'detailed']).default('standard'),
});

// ============================================================
// GENERAL CHAT SCENARIO SCHEMAS
// ============================================================

/**
 * Tool call tracking
 */
export const ToolCallRecordSchema = z.object({
  id: z.string(),
  toolName: z.string(),
  input: z.record(z.unknown()),
  output: z.unknown().optional(),
  success: z.boolean(),
  error: z.string().optional(),
  duration: z.number(),
  timestamp: z.coerce.date(),
});

/**
 * General chat state
 */
export const ChatStateSchema = AgentStateSchema.extend({
  conversationHistory: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.string(),
    toolCalls: z.array(ToolCallRecordSchema).optional(),
  })).default([]),
  toolsUsed: z.array(ToolCallRecordSchema).default([]),
  responseContent: z.string().optional(),
});

// ============================================================
// SKILL DEFINITIONS
// ============================================================

/**
 * Retry policy for skills
 */
export const RetryPolicySchema = z.object({
  maxRetries: z.number().min(0).max(10).default(3),
  backoffMs: z.number().min(100).max(60000).default(1000),
  backoffMultiplier: z.number().min(1).max(10).default(2),
});

/**
 * Atomic skill metadata
 */
export const SkillMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  category: z.enum(['research', 'ppt', 'summary', 'utility', 'tool']),
  requiredTools: z.array(z.string()).default([]),
  estimatedDurationMs: z.number().default(5000),
  retryPolicy: RetryPolicySchema.default({}),
});

// ============================================================
// VALIDATION SCHEMAS
// ============================================================

/**
 * Validation rule result
 */
export const ValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(AgentErrorSchema).default([]),
  warnings: z.array(AgentErrorSchema).default([]),
});

/**
 * Node pre/post condition
 */
export const ConditionResultSchema = z.object({
  passed: z.boolean(),
  conditionName: z.string(),
  message: z.string().optional(),
});

// ============================================================
// TYPE EXPORTS
// ============================================================

export type ParsedIntent = z.infer<typeof ParsedIntentSchema>;
export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;
export type AgentError = z.infer<typeof AgentErrorSchema>;
export type AgentState = z.infer<typeof AgentStateSchema>;

export type Paper = z.infer<typeof PaperSchema>;
export type PaperSummary = z.infer<typeof PaperSummarySchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type ComparisonMatrix = z.infer<typeof ComparisonMatrixSchema>;
export type ResearchReport = z.infer<typeof ResearchReportSchema>;
export type RecallAttempt = z.infer<typeof RecallAttemptSchema>;
export type ResearchState = z.infer<typeof ResearchStateSchema>;

export type Outline = z.infer<typeof OutlineSchema>;
export type Slide = z.infer<typeof SlideSchema>;
export type PPTState = z.infer<typeof PPTStateSchema>;

export type ContentChunk = z.infer<typeof ContentChunkSchema>;
export type KeyPoint = z.infer<typeof KeyPointSchema>;
export type SummaryState = z.infer<typeof SummaryStateSchema>;

export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;
export type ChatState = z.infer<typeof ChatStateSchema>;

export type RetryPolicy = z.infer<typeof RetryPolicySchema>;
export type SkillMetadata = z.infer<typeof SkillMetadataSchema>;

export type ValidationResult = z.infer<typeof ValidationResultSchema>;
export type ConditionResult = z.infer<typeof ConditionResultSchema>;
