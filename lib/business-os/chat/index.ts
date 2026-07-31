/**
 * Business OS Chat Module
 *
 * Deterministic-first chat architecture.
 * AI understands. AgentPilot executes.
 */

// Core orchestrator
export { ChatOrchestrator } from './ChatOrchestrator';
export type { OrchestratorInput, OrchestratorResult, LLMContext } from './ChatOrchestrator';

// Session management
export { commandSessionRepository } from './CommandSessionRepository';
export type {
  CommandSession,
  SessionStatus,
  SessionChoice,
  EntityContext,
  CommandSessionResult
} from './CommandSessionRepository';

// State machine
export { transitionSession, canTransition, getStateDescription } from './SessionStateMachine';
export type { SessionTransition, SessionAction, TransitionResult } from './SessionStateMachine';

// Input classification
export {
  classifyInteraction,
  getClassificationConfidence,
  isAmbiguous,
  extractEntityIds,
  cleanInput
} from './InteractionClassifier';
export type { InteractionType, ClassifierContext } from './InteractionClassifier';

// Parameter parsing
export {
  parseDate,
  parseTime,
  parseDateTime,
  parseDuration,
  parseMoney,
  parseEmail,
  parsePhone,
  parseBoolean,
  parseNumber,
  parseParameter
} from './ParameterParsers';
export type { ParamType, ParseResult, MoneyValue } from './ParameterParsers';

// Capability registry
export {
  CAPABILITY_REGISTRY,
  getCapability,
  getCapabilitiesForEntity,
  getCapabilitiesForDomain,
  searchCapabilities,
  getRequiredParams,
  getOptionalParams,
  generateLLMToolSchema,
  generateMinimalToolSchema,
  validateParams
} from './CapabilityRegistry';
export type { Capability, CapabilityParam } from './CapabilityRegistry';

// Entity resolution
export { EntityResolver } from './EntityResolver';
export type {
  EntityType,
  ResolvedEntity,
  EntityChoice,
  ResolutionStatus,
  ResolutionResult
} from './EntityResolver';

// Capability execution
export { CapabilityEngine } from './CapabilityEngine';
export type { ExecutionResult } from './CapabilityEngine';

// Response rendering
export { ResponseRenderer } from './ResponseRenderer';
export type { ChatResponse, ChatAction, EntityCardAction } from './ResponseRenderer';
