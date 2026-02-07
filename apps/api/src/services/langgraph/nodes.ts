/**
 * LangGraph Agent System - Graph Node Implementations
 * 
 * Each node is a distinct step in the graph with pre/post conditions.
 * Nodes don't call each other directly - coordination is via LangGraph.
 */

import type { 
  AgentState, 
  ResearchState, 
  PPTState, 
  SummaryState, 
  ChatState,
  ParsedIntent,
  ExecutionStep,
  AgentError,
  ConditionResult,
  RecallAttempt,
} from './types';
import type { SkillRegistry, SkillContext } from './skills';
import type { ToolRegistry } from '../tools/registry';
import type { LLMClient } from '../llm';

// ============================================================
// QUERY REFORMULATION UTILITIES
// ============================================================

/**
 * Generates simplified/reformulated queries from the original query
 * Strategy: Remove adjectives, split compound queries, use synonyms
 */
function generateReformulatedQueries(originalQuery: string): string[] {
  const queries: string[] = [];
  
  // Strategy 1: Remove common adjectives and qualifiers
  const adjectives = ['advanced', 'novel', 'state-of-the-art', 'modern', 'recent', 'new', 'emerging', 'cutting-edge', 'comprehensive', 'systematic'];
  let simplified = originalQuery;
  for (const adj of adjectives) {
    simplified = simplified.replace(new RegExp(`\\b${adj}\\b`, 'gi'), '').trim();
  }
  if (simplified !== originalQuery && simplified.length > 3) {
    queries.push(simplified.replace(/\s+/g, ' ').trim());
  }
  
  // Strategy 2: Extract key noun phrases (split on common connectors)
  const parts = originalQuery.split(/\s+(?:and|or|for|in|with|using|about)\s+/i);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length >= 3 && trimmed !== originalQuery) {
      queries.push(trimmed);
    }
  }
  
  // Strategy 3: Use core terms only (remove stopwords more aggressively)
  const stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'i', 'we', 'you', 'they', 'it', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'now']);
  const coreTerms = originalQuery
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopwords.has(word))
    .slice(0, 5)
    .join(' ');
  if (coreTerms.length >= 3 && coreTerms !== originalQuery.toLowerCase()) {
    queries.push(coreTerms);
  }
  
  // Strategy 4: Common research topic reformulations
  const domainAliases: Record<string, string[]> = {
    'ai agents': ['LLM agents', 'autonomous agents', 'intelligent agents'],
    'llm': ['large language model', 'language model', 'GPT'],
    'multi-agent': ['multiagent', 'multi agent', 'collaborative agents'],
    'reinforcement learning': ['RL', 'reward learning', 'policy learning'],
    'autonomous systems': ['autonomous agents', 'self-driving', 'robotic systems'],
  };
  
  for (const [term, aliases] of Object.entries(domainAliases)) {
    if (originalQuery.toLowerCase().includes(term)) {
      for (const alias of aliases) {
        const reformulated = originalQuery.toLowerCase().replace(term, alias);
        if (reformulated !== originalQuery.toLowerCase()) {
          queries.push(reformulated);
        }
      }
    }
  }
  
  // Deduplicate and limit
  const unique = [...new Set(queries.map(q => q.toLowerCase().trim()))];
  return unique.slice(0, 6);
}

// ============================================================
// NODE INTERFACES
// ============================================================

/**
 * Precondition - must pass before node execution
 */
export interface Precondition<TState> {
  name: string;
  check(state: TState): boolean;
  errorMessage: string;
  severity: 'error' | 'fatal';
}

/**
 * Postcondition - must pass after node execution
 */
export interface Postcondition<TState, TOutput> {
  name: string;
  check(state: TState, output: TOutput): boolean;
  errorMessage: string;
  severity: 'warning' | 'error' | 'fatal';
}

/**
 * Graph node interface
 */
export interface GraphNode<TState extends AgentState, TInput, TOutput> {
  id: string;
  name: string;
  description: string;
  
  // Conditions
  preconditions: Precondition<TState>[];
  postconditions: Postcondition<TState, TOutput>[];
  
  // Execution
  execute(state: TState, input: TInput, context: NodeContext): Promise<TOutput>;
  
  // State update
  updateState(state: TState, output: TOutput): TState;
}

/**
 * Context provided to node execution
 */
export interface NodeContext {
  skills: SkillRegistry;
  tools: ToolRegistry;
  llm: LLMClient;
  sessionId: string;
  userId: string;
}

/**
 * Node execution result
 */
export interface NodeExecutionResult<TOutput> {
  success: boolean;
  output?: TOutput;
  error?: AgentError;
  preconditionResults: ConditionResult[];
  postconditionResults: ConditionResult[];
  duration: number;
}

// ============================================================
// NODE EXECUTOR
// ============================================================

/**
 * Executes a graph node with condition checking
 */
export class NodeExecutor {
  /**
   * Execute a node with full condition checking
   */
  async execute<TState extends AgentState, TInput, TOutput>(
    node: GraphNode<TState, TInput, TOutput>,
    state: TState,
    input: TInput,
    context: NodeContext
  ): Promise<NodeExecutionResult<TOutput>> {
    const startTime = Date.now();
    const preconditionResults: ConditionResult[] = [];
    const postconditionResults: ConditionResult[] = [];
    
    // Check preconditions
    for (const precondition of node.preconditions) {
      const passed = precondition.check(state);
      preconditionResults.push({
        passed,
        conditionName: precondition.name,
        message: passed ? undefined : precondition.errorMessage,
      });
      
      if (!passed && (precondition.severity === 'fatal' || precondition.severity === 'error')) {
        return {
          success: false,
          error: {
            code: 'PRECONDITION_FAILED',
            message: precondition.errorMessage,
            nodeId: node.id,
            severity: 'fatal',
            timestamp: new Date(),
          },
          preconditionResults,
          postconditionResults,
          duration: Date.now() - startTime,
        };
      }
    }
    
    // Execute node
    let output: TOutput;
    try {
      output = await node.execute(state, input, context);
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'NODE_EXECUTION_ERROR',
          message: error instanceof Error ? error.message : String(error),
          nodeId: node.id,
          severity: 'fatal',
          timestamp: new Date(),
        },
        preconditionResults,
        postconditionResults,
        duration: Date.now() - startTime,
      };
    }
    
    // Check postconditions
    for (const postcondition of node.postconditions) {
      const passed = postcondition.check(state, output);
      postconditionResults.push({
        passed,
        conditionName: postcondition.name,
        message: passed ? undefined : postcondition.errorMessage,
      });
      
      if (!passed && (postcondition.severity === 'fatal' || postcondition.severity === 'error')) {
        return {
          success: false,
          error: {
            code: 'POSTCONDITION_FAILED',
            message: postcondition.errorMessage,
            nodeId: node.id,
            severity: 'fatal',
            timestamp: new Date(),
          },
          preconditionResults,
          postconditionResults,
          duration: Date.now() - startTime,
        };
      }
    }
    
    return {
      success: true,
      output,
      preconditionResults,
      postconditionResults,
      duration: Date.now() - startTime,
    };
  }
}

// ============================================================
// TOP-LEVEL NODES
// ============================================================

/**
 * Intent Parsing Node
 * Extracts intent from user prompt and classifies scenario
 */
export const IntentParsingNode: GraphNode<AgentState, void, ParsedIntent> = {
  id: 'intent_parsing',
  name: 'Intent Parsing',
  description: 'Parse user prompt to extract intent and classify scenario',
  
  preconditions: [
    {
      name: 'has_user_prompt',
      check: (state) => !!state.userPrompt && state.userPrompt.length > 0,
      errorMessage: 'User prompt is required',
      severity: 'fatal',
    },
  ],
  
  postconditions: [
    {
      name: 'has_valid_scenario',
      check: (_state, output) => ['research', 'ppt', 'summary', 'general_chat'].includes(output.scenario),
      errorMessage: 'Invalid scenario classification',
      severity: 'fatal',
    },
  ],
  
  async execute(state, _input, context) {
    const prompt = `Analyze the following user request and classify it into one of these scenarios:
- research: Academic research, paper analysis, literature review
- ppt: Presentation creation, slides, PowerPoint
- summary: Summarization of content, documents, articles
- general_chat: General questions, coding help, other tasks

User request: "${state.userPrompt}"

Respond with JSON:
{
  "scenario": "research|ppt|summary|general_chat",
  "entities": {"key": "value"},
  "parameters": {"key": "value"},
  "confidence": 0.9
}

Extract relevant entities like topic, keywords, file paths, etc.`;

    const response = await context.llm.chat([
      { role: 'system', content: 'You are an intent classifier. Always respond with valid JSON. Be precise in classification.' },
      { role: 'user', content: prompt },
    ]);
    
    const content = response.content || '';
    
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error('[IntentParsingNode] Failed to parse response:', error);
    }
    
    // Default to general chat if parsing fails
    return {
      scenario: 'general_chat',
      entities: {},
      parameters: {},
      confidence: 0.5,
    };
  },
  
  updateState(state, output) {
    return {
      ...state,
      parsedIntent: output,
      currentNode: 'intent_parsing',
      executionHistory: [
        ...state.executionHistory,
        {
          nodeId: 'intent_parsing',
          nodeName: 'Intent Parsing',
          startTime: new Date(),
          endTime: new Date(),
          input: state.userPrompt,
          output,
        },
      ],
    };
  },
};

// ============================================================
// RESEARCH NODES
// ============================================================

/**
 * Paper Discovery Node
 * MANDATORY tool usage - uses paper_search to find papers
 * 
 * RECALL-PERMISSIVE DESIGN:
 * - Zero results NEVER cause fatal errors
 * - Implements multi-attempt recall with query reformulation
 * - Tracks all attempts for downstream recovery nodes
 * - Constraints (year, venue) applied ONLY during verification, not search
 */
export const PaperDiscoveryNode: GraphNode<ResearchState, void, any> = {
  id: 'paper_discovery',
  name: 'Paper Discovery',
  description: 'Discover academic papers using search tools with multi-attempt recall',
  
  preconditions: [
    {
      name: 'has_search_query',
      check: (state) => !!state.searchQuery && state.searchQuery.length >= 3,
      errorMessage: 'Search query must be at least 3 characters',
      severity: 'fatal',
    },
  ],
  
  // CRITICAL: No fatal postconditions - zero results trigger recovery, not failure
  postconditions: [
    {
      name: 'tracking_complete',
      check: (_state, output) => output.recallAttempts && output.recallAttempts.length > 0,
      errorMessage: 'Recall attempts must be tracked',
      severity: 'warning',
    },
  ],
  
  async execute(state, _input, context) {
    const skillContext: SkillContext = {
      sessionId: context.sessionId,
      userId: context.userId,
      tools: context.tools,
      llm: context.llm,
      startTime: Date.now(),
    };
    
    const maxAttempts = state.maxRecallAttempts || 5;
    const recallAttempts: RecallAttempt[] = [...(state.recallAttempts || [])];
    const queriesAttempted = new Set<string>(state.queriesAttempted || []);
    const allPapers: any[] = [...(state.discoveredPapers || [])];
    const sources = state.searchSources || ['arxiv', 'semantic_scholar'];
    
    // Generate queries to try
    const queriesToTry: Array<{ query: string; strategy: RecallAttempt['strategy'] }> = [];
    
    // Start with original query if not tried
    if (!queriesAttempted.has(state.searchQuery!.toLowerCase())) {
      queriesToTry.push({ query: state.searchQuery!, strategy: 'original' });
    }
    
    // Add reformulated queries
    const reformulated = generateReformulatedQueries(state.searchQuery!);
    for (const q of reformulated) {
      if (!queriesAttempted.has(q.toLowerCase())) {
        queriesToTry.push({ query: q, strategy: 'simplified' });
      }
    }
    
    // Execute search attempts (up to maxAttempts)
    let attemptNumber = recallAttempts.length;
    
    for (const { query, strategy } of queriesToTry) {
      if (attemptNumber >= maxAttempts) {
        console.log(`[PaperDiscovery] Max recall attempts (${maxAttempts}) reached`);
        break;
      }
      
      if (queriesAttempted.has(query.toLowerCase())) {
        continue;
      }
      
      attemptNumber++;
      queriesAttempted.add(query.toLowerCase());
      
      console.log(`[PaperDiscovery] Attempt ${attemptNumber}/${maxAttempts}: "${query}" (${strategy})`);
      
      try {
        const result = await context.skills.execute(
          'paper_discovery',
          {
            query,
            sources,
            maxResults: 20,
            // CRITICAL: Do NOT apply date constraints at search time
            // Constraints are applied during verification only
          },
          skillContext
        );
        
        const output = result.output as { papers?: any[] } | undefined;
        const papersFound = result.success && output?.papers?.length 
          ? output.papers 
          : [];
        
        recallAttempts.push({
          attemptNumber,
          query,
          sources,
          resultsFound: papersFound.length,
          timestamp: new Date(),
          strategy,
        });
        
        if (papersFound.length > 0) {
          // Deduplicate by title
          const existingTitles = new Set(allPapers.map((p: any) => p.title?.toLowerCase()));
          for (const paper of papersFound) {
            if (!existingTitles.has(paper.title?.toLowerCase())) {
              allPapers.push(paper);
              existingTitles.add(paper.title?.toLowerCase());
            }
          }
          
          console.log(`[PaperDiscovery] Found ${papersFound.length} papers, total: ${allPapers.length}`);
          
          // If we have enough papers, we can stop early
          if (allPapers.length >= 10) {
            console.log(`[PaperDiscovery] Sufficient papers found, stopping recall`);
            break;
          }
        }
      } catch (error) {
        console.error(`[PaperDiscovery] Attempt ${attemptNumber} failed:`, error);
        
        recallAttempts.push({
          attemptNumber,
          query,
          sources,
          resultsFound: 0,
          timestamp: new Date(),
          strategy,
        });
      }
    }
    
    // Determine if recall is exhausted
    const recallExhausted = attemptNumber >= maxAttempts || 
      (queriesToTry.length === 0 && allPapers.length === 0);
    
    return {
      papers: allPapers,
      recallAttempts,
      queriesAttempted: Array.from(queriesAttempted),
      recallExhausted,
      metadata: {
        totalFound: allPapers.length,
        sourcesSearched: sources,
        searchDuration: Date.now() - skillContext.startTime,
        attemptsUsed: attemptNumber,
      },
    };
  },
  
  updateState(state, output) {
    // Filter valid papers (must have title and meaningful abstract)
    const validPapers = output.papers.filter((p: any) => 
      p.title && p.abstract && p.abstract.length > 50
    );
    
    return {
      ...state,
      discoveredPapers: output.papers,
      validPapers,
      discoveryMetadata: output.metadata,
      recallAttempts: output.recallAttempts,
      queriesAttempted: output.queriesAttempted,
      recallExhausted: output.recallExhausted,
      currentNode: 'paper_discovery',
    };
  },
};

/**
 * Discovery Validation Node
 * 
 * VERIFICATION CONSTRAINT: Requires minimum papers for synthesis
 * NOTE: Insufficient papers triggers RECOVERY, not failure
 * The graph's conditional edge handles routing to RecallRecoveryNode or HaltNode
 */
export const DiscoveryValidationNode: GraphNode<ResearchState, void, { passed: boolean; paperCount: number }> = {
  id: 'discovery_validation',
  name: 'Discovery Validation',
  description: 'Validate paper count and determine next step (continue, recover, or halt)',
  
  preconditions: [],
  
  postconditions: [],
  
  async execute(state, _input, _context) {
    const MIN_REQUIRED = 3;
    const paperCount = state.validPapers.length;
    const recallExhausted = state.recallExhausted === true;
    const attemptCount = state.recallAttempts?.length || 0;
    
    console.log(`[DiscoveryValidation] Papers: ${paperCount}, Recall exhausted: ${recallExhausted}, Attempts: ${attemptCount}`);
    
    return {
      passed: paperCount >= MIN_REQUIRED,
      paperCount,
      requiredCount: MIN_REQUIRED,
      recallExhausted,
      attemptCount,
      message: paperCount >= MIN_REQUIRED
        ? `Found ${paperCount} valid papers, proceeding to summarization`
        : recallExhausted
          ? `Only ${paperCount} valid papers found after ${attemptCount} attempts. Generating Evidence Gap Report.`
          : `Only ${paperCount} valid papers found, attempting recovery strategies`,
    };
  },
  
  updateState(state, output) {
    // NOTE: We do NOT set status to 'failed' here anymore
    // The graph routing handles whether to:
    // 1. Continue to synthesis (enough papers)
    // 2. Try recovery (insufficient but not exhausted)
    // 3. Go to halt node (exhausted, will produce Evidence Gap Report)
    
    if (!output.passed && !state.recallExhausted) {
      // Will be routed to recovery - add warning, not error
      return {
        ...state,
        warnings: [
          ...state.warnings,
          {
            code: 'INSUFFICIENT_PAPERS_RECOVERING',
            message: `Only ${output.paperCount} valid papers found, attempting recovery`,
            nodeId: 'discovery_validation',
            severity: 'warning',
            timestamp: new Date(),
          },
        ],
        currentNode: 'discovery_validation',
      };
    }
    
    if (!output.passed && state.recallExhausted) {
      // Will be routed to halt node - add informational note
      return {
        ...state,
        warnings: [
          ...state.warnings,
          {
            code: 'RECALL_EXHAUSTED',
            message: `Recall strategies exhausted with ${output.paperCount} papers. Evidence Gap Report will be generated.`,
            nodeId: 'discovery_validation',
            severity: 'warning',
            timestamp: new Date(),
          },
        ],
        currentNode: 'discovery_validation',
      };
    }
    
    return {
      ...state,
      currentNode: 'discovery_validation',
    };
  },
};

/**
 * Paper Summarize Node
 * Summarizes each paper individually
 */
export const PaperSummarizeNode: GraphNode<ResearchState, void, Record<string, any>> = {
  id: 'paper_summarize',
  name: 'Paper Summarization',
  description: 'Summarize each discovered paper individually',
  
  preconditions: [
    {
      name: 'has_valid_papers',
      check: (state) => state.validPapers.length >= 3,
      errorMessage: 'Must have at least 3 valid papers',
      severity: 'fatal',
    },
  ],
  
  postconditions: [
    {
      name: 'all_papers_summarized',
      check: (state, output) => Object.keys(output).length === state.validPapers.length,
      errorMessage: 'Not all papers were summarized',
      severity: 'error',
    },
  ],
  
  async execute(state, _input, context) {
    const summaries: Record<string, any> = {};
    
    const skillContext: SkillContext = {
      sessionId: context.sessionId,
      userId: context.userId,
      tools: context.tools,
      llm: context.llm,
      startTime: Date.now(),
    };
    
    // Process papers one at a time (as per architecture spec)
    for (const paper of state.validPapers) {
      const result = await context.skills.execute(
        'paper_summarize',
        { paper },
        skillContext
      );
      
      if (result.success && result.output) {
        summaries[paper.id] = result.output;
      }
    }
    
    return summaries;
  },
  
  updateState(state, output) {
    return {
      ...state,
      paperSummaries: output,
      currentNode: 'paper_summarize',
    };
  },
};

/**
 * Paper Compare Node
 * Compare papers across multiple dimensions
 */
export const PaperCompareNode: GraphNode<ResearchState, void, any> = {
  id: 'paper_compare',
  name: 'Paper Comparison',
  description: 'Compare papers across methodology, novelty, and impact dimensions',
  
  preconditions: [
    {
      name: 'has_summaries',
      check: (state) => Object.keys(state.paperSummaries).length >= 3,
      errorMessage: 'Must have at least 3 paper summaries',
      severity: 'fatal',
    },
  ],
  
  postconditions: [
    {
      name: 'has_comparison_matrix',
      check: (_state, output) => !!output && output.papers && output.papers.length > 0,
      errorMessage: 'Comparison matrix must be generated',
      severity: 'error',
    },
  ],
  
  async execute(state, _input, context) {
    const summaries = Object.values(state.paperSummaries);
    
    const skillContext: SkillContext = {
      sessionId: context.sessionId,
      userId: context.userId,
      tools: context.tools,
      llm: context.llm,
      startTime: Date.now(),
    };
    
    const result = await context.skills.execute(
      'paper_compare',
      {
        summaries,
        dimensions: ['methodology', 'novelty', 'impact', 'limitations'],
      },
      skillContext
    );
    
    if (!result.success) {
      throw new Error(result.error || 'Paper comparison failed');
    }
    
    return result.output;
  },
  
  updateState(state, output) {
    return {
      ...state,
      comparisonMatrix: output,
      currentNode: 'paper_compare',
    };
  },
};

/**
 * Synthesis Node
 * Generate evidence-backed claims
 * CRITICAL: Every claim MUST cite at least one paper
 */
export const SynthesisNode: GraphNode<ResearchState, void, any> = {
  id: 'synthesis',
  name: 'Claim Synthesis',
  description: 'Synthesize evidence-backed claims from paper summaries',
  
  preconditions: [
    {
      name: 'has_summaries_and_comparison',
      check: (state) => 
        Object.keys(state.paperSummaries).length >= 3 && 
        !!state.comparisonMatrix,
      errorMessage: 'Must have summaries and comparison matrix',
      severity: 'fatal',
    },
  ],
  
  postconditions: [
    {
      name: 'all_claims_have_citations',
      check: (_state, output) => 
        output.claims && output.claims.every((c: any) => 
          c.supportingPaperIds && c.supportingPaperIds.length >= 1
        ),
      errorMessage: 'Every claim MUST reference at least one paper',
      severity: 'fatal',
    },
    {
      name: 'citations_are_valid',
      check: (state, output) => {
        const validIds = new Set(state.validPapers.map(p => p.id));
        return output.claims.every((c: any) => 
          c.supportingPaperIds.every((id: string) => validIds.has(id))
        );
      },
      errorMessage: 'All cited paper IDs must be valid',
      severity: 'fatal',
    },
  ],
  
  async execute(state, _input, context) {
    const summaries = Object.values(state.paperSummaries);
    
    const skillContext: SkillContext = {
      sessionId: context.sessionId,
      userId: context.userId,
      tools: context.tools,
      llm: context.llm,
      startTime: Date.now(),
    };
    
    const result = await context.skills.execute(
      'claim_synthesis',
      {
        summaries,
        comparisonMatrix: state.comparisonMatrix,
        maxClaims: 10,
      },
      skillContext
    );
    
    if (!result.success) {
      throw new Error(result.error || 'Claim synthesis failed');
    }
    
    return result.output;
  },
  
  updateState(state, output) {
    return {
      ...state,
      synthesizedClaims: output.claims,
      currentNode: 'synthesis',
    };
  },
};

/**
 * Final Writer Node
 * Produce the final research report
 */
export const FinalWriterNode: GraphNode<ResearchState, void, any> = {
  id: 'final_writer',
  name: 'Final Report Writer',
  description: 'Generate the final research report with citations',
  
  preconditions: [
    {
      name: 'has_claims',
      check: (state) => state.synthesizedClaims && state.synthesizedClaims.length > 0,
      errorMessage: 'Must have synthesized claims',
      severity: 'fatal',
    },
  ],
  
  postconditions: [
    {
      name: 'has_report',
      check: (_state, output) => !!output && !!output.title && output.sections?.length > 0,
      errorMessage: 'Report must have title and sections',
      severity: 'error',
    },
  ],
  
  async execute(state, _input, context) {
    const claims = state.synthesizedClaims;
    const papers = state.validPapers;
    const summaries = state.paperSummaries;
    
    const claimsText = claims
      .map((c, i) => {
        const statement = 'statement' in c ? c.statement : c.claim;
        return `${i + 1}. ${statement} [${c.supportingPaperIds.join(', ')}] (${c.confidence} confidence)`;
      })
      .join('\n');
    
    const bibliographyText = papers.map(p => 
      `[${p.id}] ${p.authors?.join(', ')}. "${p.title}". ${p.source}. ${p.url}`
    ).join('\n');
    
    const prompt = `Write a research report based on the following synthesized claims and sources.

Claims:
${claimsText}

Bibliography:
${bibliographyText}

Generate a structured report in JSON format:
{
  "title": "Report Title",
  "abstract": "Brief summary of findings",
  "sections": [
    {
      "heading": "Section Title",
      "content": "Section content with inline citations like [paper_id]",
      "citations": ["paper_id_1", "paper_id_2"]
    }
  ],
  "bibliography": [
    {"paperId": "id", "citation": "Formatted citation string"}
  ]
}

IMPORTANT: 
- Every claim must be supported by citations
- Use the paper IDs provided
- Include an introduction and conclusion section`;

    const response = await context.llm.chat([
      { role: 'system', content: 'You are an expert research report writer. Always include citations. Respond with valid JSON.' },
      { role: 'user', content: prompt },
    ]);
    
    const content = response.content || '';
    
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return {
          ...JSON.parse(jsonMatch[0]),
          generatedAt: new Date(),
        };
      }
    } catch (error) {
      console.error('[FinalWriterNode] Failed to parse report:', error);
    }
    
    throw new Error('Failed to generate research report');
  },
  
  updateState(state, output) {
    return {
      ...state,
      finalReport: output,
      finalOutput: output,
      status: 'completed',
      currentNode: 'final_writer',
    };
  },
};

/**
 * Recall Recovery Node
 * Triggered when initial discovery yields insufficient papers
 * Implements additional recovery strategies:
 * - Academic skills directly (ArxivSearchSkill, SemanticScholarSkill)
 * - Broader query variations
 * - Relaxed constraints
 * 
 * DESIGN PRINCIPLE: Recall permissive, verification strict
 */
export const RecallRecoveryNode: GraphNode<ResearchState, void, any> = {
  id: 'recall_recovery',
  name: 'Recall Recovery',
  description: 'Additional recall strategies when initial discovery is insufficient',
  
  preconditions: [
    {
      name: 'has_initial_attempt',
      check: (state) => state.recallAttempts && state.recallAttempts.length > 0,
      errorMessage: 'Must have attempted initial discovery',
      severity: 'error',
    },
  ],
  
  postconditions: [],
  
  async execute(state, _input, context) {
    const skillContext: SkillContext = {
      sessionId: context.sessionId,
      userId: context.userId,
      tools: context.tools,
      llm: context.llm,
      startTime: Date.now(),
    };
    
    const maxAttempts = state.maxRecallAttempts || 5;
    const recallAttempts: RecallAttempt[] = [...(state.recallAttempts || [])];
    const queriesAttempted = new Set<string>(state.queriesAttempted || []);
    const allPapers: any[] = [...(state.discoveredPapers || [])];
    const currentAttempts = recallAttempts.length;
    
    // If already exhausted, skip
    if (state.recallExhausted || currentAttempts >= maxAttempts) {
      console.log('[RecallRecovery] Recall already exhausted');
      return {
        papers: allPapers,
        recallAttempts,
        queriesAttempted: Array.from(queriesAttempted),
        recallExhausted: true,
      };
    }
    
    console.log(`[RecallRecovery] Starting recovery with ${allPapers.length} papers found so far`);
    
    // Recovery Strategy 1: Use broadened domain-specific queries
    const broadQueries = [
      'machine learning agents',
      'neural network agents',
      'artificial intelligence autonomous',
      'deep learning robotics',
      'reinforcement learning applications',
    ];
    
    let attemptNumber = currentAttempts;
    
    for (const query of broadQueries) {
      if (attemptNumber >= maxAttempts) break;
      if (queriesAttempted.has(query.toLowerCase())) continue;
      if (allPapers.length >= 10) break; // Sufficient papers
      
      attemptNumber++;
      queriesAttempted.add(query.toLowerCase());
      
      console.log(`[RecallRecovery] Attempt ${attemptNumber}: broadened query "${query}"`);
      
      try {
        const result = await context.skills.execute(
          'paper_discovery',
          {
            query,
            sources: ['arxiv', 'semantic_scholar'],
            maxResults: 15,
          },
          skillContext
        );
        
        const output = result.output as { papers?: any[] } | undefined;
        const papersFound = result.success && output?.papers?.length 
          ? output.papers 
          : [];
        
        recallAttempts.push({
          attemptNumber,
          query,
          sources: ['arxiv', 'semantic_scholar'],
          resultsFound: papersFound.length,
          timestamp: new Date(),
          strategy: 'broadened',
        });
        
        if (papersFound.length > 0) {
          const existingTitles = new Set(allPapers.map((p: any) => p.title?.toLowerCase()));
          for (const paper of papersFound) {
            if (!existingTitles.has(paper.title?.toLowerCase())) {
              allPapers.push(paper);
              existingTitles.add(paper.title?.toLowerCase());
            }
          }
          console.log(`[RecallRecovery] Found ${papersFound.length} papers, total: ${allPapers.length}`);
        }
      } catch (error) {
        console.error(`[RecallRecovery] Attempt ${attemptNumber} failed:`, error);
        recallAttempts.push({
          attemptNumber,
          query,
          sources: ['arxiv', 'semantic_scholar'],
          resultsFound: 0,
          timestamp: new Date(),
          strategy: 'broadened',
        });
      }
    }
    
    // Recovery Strategy 2: Direct academic skill calls (if still insufficient)
    if (allPapers.length < 5 && attemptNumber < maxAttempts) {
      const coreTerms = (state.searchQuery || '')
        .split(/\s+/)
        .filter(w => w.length > 3)
        .slice(0, 3)
        .join(' ');
      
      if (coreTerms && !queriesAttempted.has(coreTerms.toLowerCase())) {
        attemptNumber++;
        queriesAttempted.add(coreTerms.toLowerCase());
        
        console.log(`[RecallRecovery] Attempt ${attemptNumber}: core terms "${coreTerms}"`);
        
        try {
          const result = await context.skills.execute(
            'paper_discovery',
            {
              query: coreTerms,
              sources: ['arxiv', 'semantic_scholar'],
              maxResults: 20,
            },
            skillContext
          );
          
          const output = result.output as { papers?: any[] } | undefined;
          const papersFound = result.success && output?.papers?.length 
            ? output.papers 
            : [];
          
          recallAttempts.push({
            attemptNumber,
            query: coreTerms,
            sources: ['arxiv', 'semantic_scholar'],
            resultsFound: papersFound.length,
            timestamp: new Date(),
            strategy: 'academic_skill_direct',
          });
          
          if (papersFound.length > 0) {
            const existingTitles = new Set(allPapers.map((p: any) => p.title?.toLowerCase()));
            for (const paper of papersFound) {
              if (!existingTitles.has(paper.title?.toLowerCase())) {
                allPapers.push(paper);
                existingTitles.add(paper.title?.toLowerCase());
              }
            }
            console.log(`[RecallRecovery] Core terms found ${papersFound.length} papers, total: ${allPapers.length}`);
          }
        } catch (error) {
          console.error(`[RecallRecovery] Core terms attempt failed:`, error);
        }
      }
    }
    
    const recallExhausted = attemptNumber >= maxAttempts;
    
    return {
      papers: allPapers,
      recallAttempts,
      queriesAttempted: Array.from(queriesAttempted),
      recallExhausted,
    };
  },
  
  updateState(state, output) {
    const validPapers = output.papers.filter((p: any) => 
      p.title && p.abstract && p.abstract.length > 50
    );
    
    return {
      ...state,
      discoveredPapers: output.papers,
      validPapers,
      recallAttempts: output.recallAttempts,
      queriesAttempted: output.queriesAttempted,
      recallExhausted: output.recallExhausted,
      currentNode: 'recall_recovery',
    };
  },
};

/**
 * Halt Node (Evidence Gap Report)
 * Called ONLY after all recall strategies are exhausted
 * Generates a structured report explaining why research cannot proceed
 * 
 * DESIGN: Halt is a NODE, not a default behavior
 * This ensures the agent provides value even when papers cannot be found
 */
export const HaltNode: GraphNode<ResearchState, void, any> = {
  id: 'halt',
  name: 'Evidence Gap Report',
  description: 'Generate structured report when all recall strategies exhausted',
  
  preconditions: [
    {
      name: 'recall_exhausted',
      check: (state) => state.recallExhausted === true,
      errorMessage: 'Halt should only be reached after recall exhaustion',
      severity: 'error', // Non-fatal: allows continuing even if not exhausted
    },
  ],
  
  postconditions: [],
  
  async execute(state, _input, context) {
    const queriesAttempted = state.queriesAttempted || [];
    const sourcesAttempted = [...new Set(
      (state.recallAttempts || []).flatMap(a => a.sources)
    )];
    const totalAttempts = state.recallAttempts?.length || 0;
    const partialResults = state.discoveredPapers || [];
    
    // Generate gaps analysis
    const gaps: string[] = [];
    const recommendations: string[] = [];
    
    if (totalAttempts > 0 && partialResults.length === 0) {
      gaps.push('No papers found across all search attempts');
      recommendations.push('Consider reformulating the research question with more specific or general terms');
      recommendations.push('Verify that the topic has published academic literature');
    } else if (partialResults.length < 3) {
      gaps.push(`Only ${partialResults.length} papers found, minimum 3 required for synthesis`);
      recommendations.push('Consider expanding the search to related domains');
      recommendations.push('Try using alternative terminology common in the field');
    }
    
    if (sourcesAttempted.length < 2) {
      gaps.push('Limited academic sources were available');
      recommendations.push('Consider adding additional sources like PubMed or Google Scholar');
    }
    
    // Generate human-readable report
    const reportText = generateEvidenceGapReport({
      originalQuery: state.searchQuery || '',
      queriesAttempted,
      sourcesAttempted,
      totalAttempts,
      partialResults,
      gaps,
      recommendations,
    });
    
    return {
      type: 'evidence_gap_report',
      originalQuery: state.searchQuery,
      queriesAttempted,
      sourcesAttempted,
      totalAttempts,
      partialResults: partialResults.slice(0, 5), // Include up to 5 partial results
      gaps,
      recommendations,
      reportText,
      timestamp: new Date(),
    };
  },
  
  updateState(state, output) {
    return {
      ...state,
      evidenceGapReport: {
        queriesAttempted: output.queriesAttempted,
        sourcesAttempted: output.sourcesAttempted,
        totalAttempts: output.totalAttempts,
        partialResults: output.partialResults,
        gaps: output.gaps,
        recommendations: output.recommendations,
        timestamp: output.timestamp,
      },
      finalOutput: output.reportText,
      status: 'completed', // NOT failed - this is a valid completion with evidence gap report
      currentNode: 'halt',
    };
  },
};

/**
 * Generate human-readable Evidence Gap Report
 */
function generateEvidenceGapReport(data: {
  originalQuery: string;
  queriesAttempted: string[];
  sourcesAttempted: string[];
  totalAttempts: number;
  partialResults: any[];
  gaps: string[];
  recommendations: string[];
}): string {
  let report = `# Research Process & Evidence Gap Report\n\n`;
  
  report += `## Original Research Query\n`;
  report += `"${data.originalQuery}"\n\n`;
  
  report += `## Search Summary\n`;
  report += `- **Total search attempts**: ${data.totalAttempts}\n`;
  report += `- **Sources searched**: ${data.sourcesAttempted.join(', ') || 'None'}\n`;
  report += `- **Papers found**: ${data.partialResults.length}\n\n`;
  
  report += `## Queries Attempted\n`;
  if (data.queriesAttempted.length > 0) {
    for (const query of data.queriesAttempted) {
      report += `- "${query}"\n`;
    }
  } else {
    report += `- No queries were executed\n`;
  }
  report += `\n`;
  
  report += `## Identified Gaps\n`;
  if (data.gaps.length > 0) {
    for (const gap of data.gaps) {
      report += `- ${gap}\n`;
    }
  } else {
    report += `- No specific gaps identified\n`;
  }
  report += `\n`;
  
  if (data.partialResults.length > 0) {
    report += `## Partial Results\n`;
    report += `The following papers were found but insufficient for comprehensive synthesis:\n\n`;
    for (const paper of data.partialResults.slice(0, 5)) {
      report += `### ${paper.title}\n`;
      report += `- **Authors**: ${paper.authors?.join(', ') || 'Unknown'}\n`;
      report += `- **Source**: ${paper.source || 'Unknown'}\n`;
      if (paper.url) report += `- **URL**: ${paper.url}\n`;
      report += `\n`;
    }
  }
  
  report += `## Recommendations\n`;
  if (data.recommendations.length > 0) {
    for (const rec of data.recommendations) {
      report += `- ${rec}\n`;
    }
  } else {
    report += `- No specific recommendations\n`;
  }
  report += `\n`;
  
  report += `## Next Steps\n`;
  report += `This report documents the research process and findings. To proceed:\n`;
  report += `1. Review the partial results above for relevance\n`;
  report += `2. Consider the recommendations for refining your search\n`;
  report += `3. Provide additional context or domain-specific terminology\n`;
  report += `4. Specify particular venues, authors, or time periods if known\n\n`;
  
  report += `---\n`;
  report += `*Report generated at ${new Date().toISOString()}*\n`;
  
  return report;
}

/**
 * Failure Handler Node
 * Handles graph execution failures gracefully
 * NOTE: This is for unexpected errors, not for zero-result searches
 */
export const FailureHandlerNode: GraphNode<AgentState, void, any> = {
  id: 'failure_handler',
  name: 'Failure Handler',
  description: 'Handle unexpected execution failures and produce failure report',
  
  preconditions: [],
  postconditions: [],
  
  async execute(state, _input, _context) {
    return {
      failedAt: state.currentNode,
      errors: state.errors,
      partialResults: extractPartialResults(state),
      suggestions: generateSuggestions(state.errors),
      recoveryOptions: determineRecoveryOptions(state),
    };
  },
  
  updateState(state, output) {
    return {
      ...state,
      status: 'failed',
      finalOutput: output,
      currentNode: 'failure_handler',
    };
  },
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function extractPartialResults(state: AgentState): Record<string, any> {
  const results: Record<string, any> = {};
  
  if ('discoveredPapers' in state) {
    const rs = state as ResearchState;
    results.discoveredPapers = rs.discoveredPapers?.length || 0;
    results.validPapers = rs.validPapers?.length || 0;
    results.summarizedPapers = Object.keys(rs.paperSummaries || {}).length;
    results.synthesizedClaims = rs.synthesizedClaims?.length || 0;
  }
  
  return results;
}

function generateSuggestions(errors: AgentError[]): string[] {
  const suggestions: string[] = [];
  
  for (const error of errors) {
    if (error.code === 'INSUFFICIENT_PAPERS') {
      suggestions.push('Try broadening your search query');
      suggestions.push('Include more paper sources (arxiv, semantic_scholar, pubmed)');
      suggestions.push('Reduce specificity of search terms');
    } else if (error.code === 'PRECONDITION_FAILED') {
      suggestions.push('Ensure all required inputs are provided');
    } else if (error.code === 'POSTCONDITION_FAILED') {
      suggestions.push('Previous step may have produced incomplete results');
    }
  }
  
  return [...new Set(suggestions)];
}

function determineRecoveryOptions(state: AgentState): string[] {
  const options: string[] = [];
  
  if ('searchQuery' in state) {
    options.push('modify_search_query');
  }
  
  options.push('restart_from_beginning');
  options.push('export_partial_results');
  
  return options;
}

// ============================================================
// NODE REGISTRY
// ============================================================

/**
 * Registry of all available nodes
 */
export const NodeRegistry = {
  // Top-level
  intent_parsing: IntentParsingNode,
  
  // Research
  paper_discovery: PaperDiscoveryNode,
  discovery_validation: DiscoveryValidationNode,
  recall_recovery: RecallRecoveryNode,
  paper_summarize: PaperSummarizeNode,
  paper_compare: PaperCompareNode,
  synthesis: SynthesisNode,
  final_writer: FinalWriterNode,
  halt: HaltNode,
  
  // Failure handling
  failure_handler: FailureHandlerNode,
};
