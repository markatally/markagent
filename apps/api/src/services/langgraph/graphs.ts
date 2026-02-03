/**
 * LangGraph Agent System - Graph Definitions
 * 
 * Defines the DAG structure for each scenario.
 * All routing is DETERMINISTIC - no LLM-driven flow control.
 */

import type {
  AgentState,
  ResearchState,
  PPTState,
  SummaryState,
  ChatState,
  ParsedIntent,
} from './types';
import {
  NodeExecutor,
  IntentParsingNode,
  PaperDiscoveryNode,
  DiscoveryValidationNode,
  RecallRecoveryNode,
  PaperSummarizeNode,
  PaperCompareNode,
  SynthesisNode,
  FinalWriterNode,
  HaltNode,
  FailureHandlerNode,
  type NodeContext,
  type GraphNode,
} from './nodes';
import type { SkillRegistry } from './skills';
import type { ToolRegistry } from '../tools/registry';
import type { LLMClient } from '../llm';

// ============================================================
// GRAPH TYPES
// ============================================================

/**
 * Edge definition - connection between nodes
 */
export interface Edge {
  from: string;
  to: string | 'END';
}

/**
 * Conditional edge - routing based on state
 */
export interface ConditionalEdge<TState> {
  from: string;
  condition: (state: TState) => string;
  routes: Record<string, string | 'END'>;
}

/**
 * Graph definition
 */
export interface GraphDefinition<TState extends AgentState> {
  id: string;
  name: string;
  entryPoint: string;
  nodes: Map<string, GraphNode<TState, any, any>>;
  edges: Edge[];
  conditionalEdges: ConditionalEdge<TState>[];
}

/**
 * Graph execution result
 */
export interface GraphExecutionResult<TState> {
  success: boolean;
  finalState: TState;
  executionPath: string[];
  totalDuration: number;
}

// ============================================================
// GRAPH EXECUTOR
// ============================================================

/**
 * Executes a graph definition against a state
 */
export class GraphExecutor<TState extends AgentState> {
  private nodeExecutor = new NodeExecutor();
  
  constructor(
    private graph: GraphDefinition<TState>,
    private context: NodeContext
  ) {}
  
  /**
   * Execute the graph from entry point to END
   */
  async execute(initialState: TState): Promise<GraphExecutionResult<TState>> {
    const startTime = Date.now();
    const executionPath: string[] = [];
    let currentState = initialState;
    let currentNodeId = this.graph.entryPoint;
    
    while (currentNodeId !== 'END') {
      executionPath.push(currentNodeId);
      
      const node = this.graph.nodes.get(currentNodeId);
      if (!node) {
        throw new Error(`Node not found: ${currentNodeId}`);
      }
      
      // Execute node
      const result = await this.nodeExecutor.execute(
        node,
        currentState,
        undefined, // No explicit input for most nodes
        this.context
      );
      
      if (!result.success) {
        // Node failed - check if we should go to failure handler
        if (currentNodeId !== 'failure_handler' && this.graph.nodes.has('failure_handler')) {
          currentState = node.updateState(currentState, result.error);
          currentNodeId = 'failure_handler';
          continue;
        }
        
        return {
          success: false,
          finalState: currentState,
          executionPath,
          totalDuration: Date.now() - startTime,
        };
      }
      
      // Update state
      currentState = node.updateState(currentState, result.output);
      
      // Determine next node
      currentNodeId = this.getNextNode(currentNodeId, currentState);
    }
    
    return {
      success: currentState.status !== 'failed',
      finalState: currentState,
      executionPath,
      totalDuration: Date.now() - startTime,
    };
  }
  
  /**
   * Get next node based on edges
   */
  private getNextNode(currentNodeId: string, state: TState): string {
    // Check conditional edges first
    for (const condEdge of this.graph.conditionalEdges) {
      if (condEdge.from === currentNodeId) {
        const routeKey = condEdge.condition(state);
        const nextNode = condEdge.routes[routeKey];
        if (nextNode) {
          return nextNode;
        }
      }
    }
    
    // Check regular edges
    for (const edge of this.graph.edges) {
      if (edge.from === currentNodeId) {
        return edge.to;
      }
    }
    
    // No edge found - end
    return 'END';
  }
}

// ============================================================
// RESEARCH GRAPH
// ============================================================

/**
 * Minimum papers required for comprehensive synthesis
 * This is a verification constraint, NOT a recall constraint
 */
const MIN_PAPERS_FOR_SYNTHESIS = 3;

/**
 * Create the Research scenario graph
 * 
 * RECALL-PERMISSIVE DESIGN:
 * - Zero results from initial discovery trigger recovery, not failure
 * - Recovery attempts multiple strategies before considering halt
 * - HaltNode produces Evidence Gap Report instead of generic failure
 * - Constraints applied during verification, not search
 * 
 * Flow:
 * PaperDiscovery -> DiscoveryValidation -> (continue/recover/halt)
 *   continue -> PaperSummarize -> PaperCompare -> Synthesis -> FinalWriter -> END
 *   recover -> RecallRecovery -> DiscoveryValidation (loop back)
 *   halt -> HaltNode (Evidence Gap Report) -> END
 */
export function createResearchGraph(): GraphDefinition<ResearchState> {
  const nodes = new Map<string, GraphNode<ResearchState, any, any>>();
  
  nodes.set('paper_discovery', PaperDiscoveryNode);
  nodes.set('discovery_validation', DiscoveryValidationNode);
  nodes.set('recall_recovery', RecallRecoveryNode);
  nodes.set('paper_summarize', PaperSummarizeNode);
  nodes.set('paper_compare', PaperCompareNode);
  nodes.set('synthesis', SynthesisNode);
  nodes.set('final_writer', FinalWriterNode);
  nodes.set('halt', HaltNode as unknown as GraphNode<ResearchState, any, any>);
  nodes.set('failure_handler', FailureHandlerNode as unknown as GraphNode<ResearchState, any, any>);
  
  const edges: Edge[] = [
    { from: 'paper_discovery', to: 'discovery_validation' },
    // Discovery validation routes via conditional edge (see below)
    // Recovery routes back to validation
    { from: 'recall_recovery', to: 'discovery_validation' },
    // Main research pipeline
    { from: 'paper_summarize', to: 'paper_compare' },
    { from: 'paper_compare', to: 'synthesis' },
    { from: 'synthesis', to: 'final_writer' },
    { from: 'final_writer', to: 'END' },
    // Terminal nodes
    { from: 'halt', to: 'END' },
    { from: 'failure_handler', to: 'END' },
  ];
  
  const conditionalEdges: ConditionalEdge<ResearchState>[] = [
    {
      from: 'discovery_validation',
      condition: (state) => {
        const paperCount = state.validPapers.length;
        const recallExhausted = state.recallExhausted === true;
        
        // Case 1: Sufficient papers - continue to synthesis
        if (paperCount >= MIN_PAPERS_FOR_SYNTHESIS) {
          return 'continue';
        }
        
        // Case 2: Insufficient papers but recall not exhausted - try recovery
        if (!recallExhausted) {
          return 'recover';
        }
        
        // Case 3: Recall exhausted - go to halt node for evidence gap report
        // NOTE: This is NOT a failure - it's a valid completion with documentation
        return 'halt';
      },
      routes: {
        continue: 'paper_summarize',
        recover: 'recall_recovery',
        halt: 'halt',
      },
    },
  ];
  
  return {
    id: 'research',
    name: 'Research Scenario',
    entryPoint: 'paper_discovery',
    nodes,
    edges,
    conditionalEdges,
  };
}

// ============================================================
// PPT GRAPH
// ============================================================

/**
 * Create the PPT scenario graph
 * 
 * Flow:
 * ContentAnalysis -> OutlineGeneration -> SlideContentCreation -> VisualSuggestions -> PPTExport -> END
 */
export function createPPTGraph(): GraphDefinition<PPTState> {
  const nodes = new Map<string, GraphNode<PPTState, any, any>>();
  
  // TODO: Implement PPT nodes
  // nodes.set('content_analysis', ContentAnalysisNode);
  // nodes.set('outline_generation', OutlineGenerationNode);
  // nodes.set('slide_content', SlideContentNode);
  // nodes.set('visual_suggestions', VisualSuggestionsNode);
  // nodes.set('ppt_export', PPTExportNode);
  nodes.set('failure_handler', FailureHandlerNode as unknown as GraphNode<PPTState, any, any>);
  
  const edges: Edge[] = [
    // { from: 'content_analysis', to: 'outline_generation' },
    // { from: 'outline_generation', to: 'slide_content' },
    // { from: 'slide_content', to: 'visual_suggestions' },
    // { from: 'visual_suggestions', to: 'ppt_export' },
    // { from: 'ppt_export', to: 'END' },
    { from: 'failure_handler', to: 'END' },
  ];
  
  return {
    id: 'ppt',
    name: 'PPT Scenario',
    entryPoint: 'failure_handler', // Placeholder until nodes implemented
    nodes,
    edges,
    conditionalEdges: [],
  };
}

// ============================================================
// SUMMARY GRAPH
// ============================================================

/**
 * Create the Summary scenario graph
 * 
 * Flow:
 * ContentIngestion -> ChunkProcessing -> KeyExtraction -> SummaryGeneration -> END
 */
export function createSummaryGraph(): GraphDefinition<SummaryState> {
  const nodes = new Map<string, GraphNode<SummaryState, any, any>>();
  
  // TODO: Implement Summary nodes
  nodes.set('failure_handler', FailureHandlerNode as unknown as GraphNode<SummaryState, any, any>);
  
  const edges: Edge[] = [
    { from: 'failure_handler', to: 'END' },
  ];
  
  return {
    id: 'summary',
    name: 'Summary Scenario',
    entryPoint: 'failure_handler', // Placeholder until nodes implemented
    nodes,
    edges,
    conditionalEdges: [],
  };
}

// ============================================================
// GENERAL CHAT GRAPH
// ============================================================

/**
 * Create the General Chat scenario graph
 * 
 * Flow:
 * ToolDetection -> (needs_tools/no_tools)
 *   needs_tools -> ToolExecution -> ResponseGeneration -> END
 *   no_tools -> ResponseGeneration -> END
 */
export function createGeneralChatGraph(): GraphDefinition<ChatState> {
  const nodes = new Map<string, GraphNode<ChatState, any, any>>();
  
  // TODO: Implement Chat nodes
  nodes.set('failure_handler', FailureHandlerNode as unknown as GraphNode<ChatState, any, any>);
  
  const edges: Edge[] = [
    { from: 'failure_handler', to: 'END' },
  ];
  
  return {
    id: 'general_chat',
    name: 'General Chat Scenario',
    entryPoint: 'failure_handler', // Placeholder until nodes implemented
    nodes,
    edges,
    conditionalEdges: [],
  };
}

// ============================================================
// ROUTER GRAPH
// ============================================================

/**
 * Top-level router that routes to scenario graphs
 */
export class AgentRouter {
  private nodeExecutor = new NodeExecutor();
  private researchGraph: GraphDefinition<ResearchState>;
  private pptGraph: GraphDefinition<PPTState>;
  private summaryGraph: GraphDefinition<SummaryState>;
  private chatGraph: GraphDefinition<ChatState>;
  
  constructor(
    private skills: SkillRegistry,
    private tools: ToolRegistry,
    private llm: LLMClient
  ) {
    this.researchGraph = createResearchGraph();
    this.pptGraph = createPPTGraph();
    this.summaryGraph = createSummaryGraph();
    this.chatGraph = createGeneralChatGraph();
  }
  
  /**
   * Route and execute the appropriate scenario graph
   */
  async run(
    sessionId: string,
    userId: string,
    userPrompt: string
  ): Promise<GraphExecutionResult<AgentState>> {
    const startTime = Date.now();
    
    // Create initial state
    const initialState: AgentState = {
      sessionId,
      userId,
      requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(),
      userPrompt,
      parsedIntent: undefined,
      currentNode: '',
      executionHistory: [],
      intermediateResults: {},
      errors: [],
      warnings: [],
      status: 'running',
      finalOutput: undefined,
    };
    
    const context: NodeContext = {
      skills: this.skills,
      tools: this.tools,
      llm: this.llm,
      sessionId,
      userId,
    };
    
    // Step 1: Parse intent
    const intentResult = await this.nodeExecutor.execute(
      IntentParsingNode,
      initialState,
      undefined,
      context
    );
    
    if (!intentResult.success || !intentResult.output) {
      return {
        success: false,
        finalState: {
          ...initialState,
          status: 'failed',
          errors: [{
            code: 'INTENT_PARSE_FAILED',
            message: 'Failed to parse user intent',
            severity: 'fatal',
            timestamp: new Date(),
          }],
        },
        executionPath: ['intent_parsing'],
        totalDuration: Date.now() - startTime,
      };
    }
    
    const parsedIntent = intentResult.output;
    const stateWithIntent = IntentParsingNode.updateState(initialState, parsedIntent);
    
    // Step 2: Route to scenario graph (DETERMINISTIC routing)
    const scenario = parsedIntent.scenario;
    
    switch (scenario) {
      case 'research': {
        const researchState = this.createResearchState(stateWithIntent, parsedIntent);
        const executor = new GraphExecutor(this.researchGraph, context);
        const result = await executor.execute(researchState);
        
        return {
          success: result.success,
          finalState: result.finalState,
          executionPath: ['intent_parsing', ...result.executionPath],
          totalDuration: Date.now() - startTime,
        };
      }
      
      case 'ppt': {
        const pptState = this.createPPTState(stateWithIntent, parsedIntent);
        const executor = new GraphExecutor(this.pptGraph, context);
        const result = await executor.execute(pptState);
        
        return {
          success: result.success,
          finalState: result.finalState,
          executionPath: ['intent_parsing', ...result.executionPath],
          totalDuration: Date.now() - startTime,
        };
      }
      
      case 'summary': {
        const summaryState = this.createSummaryState(stateWithIntent, parsedIntent);
        const executor = new GraphExecutor(this.summaryGraph, context);
        const result = await executor.execute(summaryState);
        
        return {
          success: result.success,
          finalState: result.finalState,
          executionPath: ['intent_parsing', ...result.executionPath],
          totalDuration: Date.now() - startTime,
        };
      }
      
      case 'general_chat':
      default: {
        const chatState = this.createChatState(stateWithIntent, parsedIntent);
        const executor = new GraphExecutor(this.chatGraph, context);
        const result = await executor.execute(chatState);
        
        return {
          success: result.success,
          finalState: result.finalState,
          executionPath: ['intent_parsing', ...result.executionPath],
          totalDuration: Date.now() - startTime,
        };
      }
    }
  }
  
  /**
   * Create research-specific state
   */
  private createResearchState(baseState: AgentState, intent: ParsedIntent): ResearchState {
    // Extract search query from intent
    const searchQuery = intent.entities.topic || 
                       intent.entities.query || 
                       intent.parameters.searchQuery as string ||
                       baseState.userPrompt;
    
    return {
      ...baseState,
      searchQuery,
      searchSources: ['arxiv', 'semantic_scholar'],
      discoveredPapers: [],
      validPapers: [],
      discoveryMetadata: undefined,
      // Recall tracking for multi-attempt recovery
      recallAttempts: [],
      queriesAttempted: [],
      maxRecallAttempts: 5,
      recallExhausted: false,
      // Remaining research state
      paperSummaries: {},
      comparisonMatrix: undefined,
      synthesizedClaims: [],
      finalReport: undefined,
      evidenceGapReport: undefined,
    };
  }
  
  /**
   * Create PPT-specific state
   */
  private createPPTState(baseState: AgentState, intent: ParsedIntent): PPTState {
    const topic = intent.entities.topic ||
                 intent.parameters.topic as string ||
                 baseState.userPrompt;
    
    return {
      ...baseState,
      topic,
      context: intent.entities.context,
      targetAudience: intent.entities.audience,
      outline: undefined,
      slides: [],
      outputPath: undefined,
      outputFileId: undefined,
    };
  }
  
  /**
   * Create summary-specific state
   */
  private createSummaryState(baseState: AgentState, intent: ParsedIntent): SummaryState {
    return {
      ...baseState,
      sourceContent: intent.entities.content,
      sourceUrl: intent.entities.url,
      contentType: undefined,
      chunks: [],
      keyPoints: [],
      summary: undefined,
      summaryLength: 'standard',
    };
  }
  
  /**
   * Create chat-specific state
   */
  private createChatState(baseState: AgentState, _intent: ParsedIntent): ChatState {
    return {
      ...baseState,
      conversationHistory: [],
      toolsUsed: [],
      responseContent: undefined,
    };
  }
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a configured agent router
 */
export function createAgentRouter(
  skills: SkillRegistry,
  tools: ToolRegistry,
  llm: LLMClient
): AgentRouter {
  return new AgentRouter(skills, tools, llm);
}
