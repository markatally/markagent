/**
 * LangGraph Agent System - Main Entry Point
 * 
 * This module provides a LangGraph-based orchestration system for AI agents
 * with the following principles:
 * 
 * 1. LangGraph-Centric Orchestration - All behavior expressed as explicit nodes/edges
 * 2. Atomic & Pluggable Skills - Each capability is single-purpose with strict schemas
 * 3. Separation of Responsibilities - Distinct nodes for intent, routing, execution
 * 4. Deterministic Routing - No LLM-driven flow control, explicit conditional edges
 * 5. Evidence-Backed Output - All claims must have citations
 */

// Types
export * from './types';

// Skills
export {
  type AtomicSkill,
  type SkillContext,
  type SkillExecutionResult,
  SkillRegistry,
  createDefaultSkillRegistry,
  // Research skills
  PaperDiscoverySkill,
  PaperSummarizeSkill,
  PaperCompareSkill,
  ClaimSynthesisSkill,
  // PPT skills
  OutlineGenerateSkill,
  // Summary skills
  ContentChunkSkill,
} from './skills';

// Nodes
export {
  type GraphNode,
  type NodeContext,
  type NodeExecutionResult,
  type Precondition,
  type Postcondition,
  NodeExecutor,
  // Top-level nodes
  IntentParsingNode,
  // Research nodes
  PaperDiscoveryNode,
  DiscoveryValidationNode,
  RecallRecoveryNode,
  PaperSummarizeNode,
  PaperCompareNode,
  SynthesisNode,
  FinalWriterNode,
  HaltNode,
  // Common nodes
  FailureHandlerNode,
  // Registry
  NodeRegistry,
} from './nodes';

// Graphs
export {
  type GraphDefinition,
  type GraphExecutionResult,
  type Edge,
  type ConditionalEdge,
  GraphExecutor,
  AgentRouter,
  createAgentRouter,
  createResearchGraph,
  createPPTGraph,
  createSummaryGraph,
  createGeneralChatGraph,
} from './graphs';

// Validation utilities
export { ValidationRules, ValidationExecutor } from './validation';
