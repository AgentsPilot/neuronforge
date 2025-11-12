/**
 * Orchestration System - Public API
 *
 * Intent-based workflow orchestration for token optimization
 *
 * Features:
 * - Phase 1 (COMPLETE): Intent classification, Token budgeting, Feature flags
 * - Phase 2 (COMPLETE): Compression, AIS routing, Intent handlers
 * - Phase 3+ (Future): Adaptive learning, Cost optimization
 */

// Main service
export { OrchestrationService, orchestrationService } from './OrchestrationService';

// Core components
export { IntentClassifier, intentClassifier } from './IntentClassifier';
export { TokenBudgetManager, tokenBudgetManager } from './TokenBudgetManager';

// Phase 2 services
export { CompressionService, compressionService } from './CompressionService';
export { RoutingService, routingService } from './RoutingService';
export { MemoryCompressor, memoryCompressor } from './MemoryCompressor';

// Phase 4 - WorkflowPilot integration
export { WorkflowOrchestrator } from './WorkflowOrchestrator';

// Intent handlers (all 10 types)
export {
  BaseHandler,
  ExtractHandler,
  SummarizeHandler,
  GenerateHandler,
  ValidateHandler,
  SendHandler,
  TransformHandler,
  ConditionalHandler,
  AggregateHandler,
  FilterHandler,
  EnrichHandler,
} from './handlers';

// Export handler registry instance separately
export { handlerRegistry } from './handlers';

// Types
export type {
  // Intent types
  IntentType,
  IntentClassification,

  // Budget types
  TokenBudget,
  BudgetConstraints,
  BudgetAllocationStrategy,

  // Compression types (Phase 2)
  CompressionStrategy,
  CompressionPolicy,
  CompressionResult,

  // Routing types (Phase 2)
  ModelTier,
  RoutingDecision,
  RoutingContext,
  ModelConfig,

  // Handler types
  IntentHandler,
  HandlerContext,
  HandlerResult,
  HandlerRegistry,

  // Metadata types
  OrchestrationMetadata,
  StepMetadata,

  // Metrics types
  PerformanceMetrics,
  CostMetrics,
  QualityMetrics,
  OrchestrationMetrics,

  // Audit types
  OrchestrationAuditEvent,
  OrchestrationAuditLog,

  // Config types
  OrchestrationConfigKey,
  OrchestrationConfig,

  // Service interfaces
  IIntentClassifier,
  ITokenBudgetManager,
  ICompressionService,
  IRoutingService,
  IConfigService,

  // Integration types
  AISIntegration,
  MemoryIntegration,
  AuditIntegration,
  TokenIntegration,
} from './types';

// Error classes
export {
  OrchestrationError,
  BudgetExceededError,
  IntentClassificationError,
  CompressionError,
  RoutingError,
} from './types';
