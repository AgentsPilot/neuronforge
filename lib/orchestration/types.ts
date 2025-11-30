/**
 * Orchestration Type Definitions
 *
 * Comprehensive type system for AgentPilot intelligent orchestration.
 * All configuration values are stored in database and configurable via admin UI.
 * NO hardcoded defaults - everything is runtime-configurable.
 *
 * IMPORTANT: This orchestration system integrates with existing AIS (Agent Intensity System).
 * AIS scores are calculated at the AGENT level (not per step):
 * - creation_score: Agent design complexity
 * - execution_score: Agent execution complexity (averaged across runs)
 * - combined_score: Weighted average for pricing multiplier
 *
 * Orchestration uses these agent-level scores for routing decisions.
 */

// ============================================================================
// INTENT TYPES
// ============================================================================

/**
 * Intent classification for workflow steps
 * Used to determine appropriate token budgets, compression strategies, and model routing
 */
export type IntentType =
  | 'extract'      // Data extraction from sources
  | 'summarize'    // Content summarization/condensation
  | 'generate'     // Creative content generation
  | 'validate'     // Data validation/verification
  | 'send'         // External API calls/notifications
  | 'transform'    // Data transformation/processing
  | 'conditional'  // Branching logic evaluation
  | 'aggregate'    // Data aggregation/collection
  | 'filter'       // Data filtering/selection
  | 'enrich';      // Data enrichment from external sources

/**
 * Intent classification result with confidence scoring
 */
export interface IntentClassification {
  intent: IntentType;
  confidence: number; // 0-1 scale
  reasoning: string;
  alternativeIntents?: Array<{
    intent: IntentType;
    confidence: number;
  }>;
}

// ============================================================================
// BULLETPROOF CLASSIFICATION (Phase 1)
// ============================================================================

/**
 * Classification method/tier used
 * Tier 1: Pattern matching (fast, free)
 * Tier 2: LLM classification (moderate cost)
 * Tier 3: Enhanced with context (higher cost, better accuracy)
 */
export type ClassificationMethod = 'pattern' | 'llm' | 'enhanced' | 'fallback';

/**
 * Classification tier for escalation tracking
 */
export type ClassificationTier = 1 | 2 | 3;

/**
 * Validation result for cross-checking classifications
 */
export interface ClassificationValidation {
  primary: IntentClassification;
  verification?: IntentClassification;
  agreement: boolean;
  confidenceDelta: number;
  needsEscalation: boolean;
  method: ClassificationMethod;
  tier: ClassificationTier;
}

/**
 * Ambiguity detection for multi-intent conflicts
 */
export interface AmbiguityDetection {
  isAmbiguous: boolean;
  conflictingIntents: Array<{
    intent: IntentType;
    confidence: number;
    reasoning: string;
  }>;
  recommendation: 'use_primary' | 'escalate' | 'split_step';
  ambiguityScore: number; // 0-1, higher = more ambiguous
}

/**
 * Workflow context for context-aware classification (Tier 3)
 */
export interface WorkflowContext {
  workflowId: string;
  workflowGoal?: string;
  currentStepIndex: number;
  totalSteps: number;
  previousSteps: Array<{
    stepId: string;
    intent: IntentType;
    summary: string;
  }>;
  nextSteps: Array<{
    stepId: string;
    description: string;
  }>;
}

/**
 * Classification telemetry for monitoring accuracy
 */
export interface ClassificationTelemetry {
  stepId: string;
  workflowId: string;
  agentId: string;
  method: ClassificationMethod;
  tier: ClassificationTier;
  intent: IntentType;
  confidence: number;
  latencyMs: number;
  tokensUsed: number;
  cost: number;
  wasValidated: boolean;
  wasAmbiguous: boolean;
  timestamp: Date;
}

/**
 * Confidence thresholds for tier escalation
 */
export interface ClassificationThresholds {
  tier1MinConfidence: number;  // Below this → escalate to Tier 2 (default: 0.9)
  tier2MinConfidence: number;  // Below this → escalate to Tier 3 (default: 0.7)
  tier3MinConfidence: number;  // Below this → use fallback (default: 0.6)
  validationDisagreementThreshold: number; // Above this delta → escalate (default: 0.3)
}

// ============================================================================
// TOKEN BUDGET MANAGEMENT
// ============================================================================

/**
 * Token budget allocation for a workflow step
 */
export interface TokenBudget {
  allocated: number;        // Initial budget allocation
  used: number;            // Tokens consumed
  remaining: number;       // Tokens left
  compressed: number;      // Tokens saved via compression
  overageAllowed: boolean; // Whether budget overage is permitted
  overageLimit?: number;   // Max overage if allowed
}

/**
 * Budget constraints for orchestration
 */
export interface BudgetConstraints {
  maxTokensPerStep: number;
  maxTokensPerWorkflow: number;
  allowOverage: boolean;
  overageThreshold: number; // Percentage (e.g., 1.2 = 20% overage)
  criticalStepMultiplier: number; // Budget multiplier for critical steps
}

/**
 * Budget allocation strategy
 */
export type BudgetAllocationStrategy =
  | 'equal'        // Equal distribution across steps
  | 'proportional' // Based on step complexity/intent
  | 'adaptive'     // Dynamic based on execution history
  | 'priority'     // Based on step priority scores
  | 'predictive';  // Historical data-driven prediction (Phase 1)

// ============================================================================
// COMPRESSION STRATEGIES
// ============================================================================

/**
 * Compression strategy types
 */
export type CompressionStrategy =
  | 'semantic'     // Semantic summarization
  | 'structural'   // Remove redundant structure
  | 'template'     // Template-based compression
  | 'truncate'     // Simple truncation
  | 'none';        // No compression

/**
 * Compression policy for content optimization
 */
export interface CompressionPolicy {
  enabled: boolean;
  strategy: CompressionStrategy;
  targetRatio: number;      // Target compression ratio (e.g., 0.5 = 50% reduction)
  minQualityScore: number;  // Minimum acceptable quality after compression
  preserveFields?: string[]; // Fields to never compress
  aggressiveness: 'low' | 'medium' | 'high';
}

/**
 * Compression result with quality metrics
 */
export interface CompressionResult {
  original: string;
  compressed: string;
  originalTokens: number;
  compressedTokens: number;
  ratio: number;            // Actual compression ratio achieved
  qualityScore: number;     // Quality assessment (0-1)
  strategy: CompressionStrategy;
  metadata?: Record<string, any>;
}

// ============================================================================
// AIS-BASED ROUTING
// ============================================================================

/**
 * Model tier for routing decisions
 * Based on agent-level AIS combined_score (not per-step scoring)
 */
export type ModelTier = 'fast' | 'balanced' | 'powerful';

/**
 * Routing decision based on agent-level AIS scores
 * IMPORTANT: Uses existing agent_intensity_metrics table data
 */
export interface RoutingDecision {
  tier: ModelTier;
  model: string;
  provider: string;
  reason: string;
  estimatedCost: number;
  estimatedLatency: number;
  agentAIS?: {
    // Agent-level scores from agent_intensity_metrics table
    creation_score: number;      // Agent design complexity (0-10)
    execution_score: number;     // Agent execution complexity (0-10)
    combined_score: number;      // Weighted average for routing
  };
}

/**
 * Routing context for decision making
 * Uses agent-level complexity from existing AIS system
 */
export interface RoutingContext {
  agentId: string;
  intent: IntentType;
  stepComplexity?: number;      // Optional: step-specific complexity hint
  budgetRemaining: number;
  previousFailures: number;
  userTier?: string;            // User subscription tier

  // Agent-level AIS scores (from agent_intensity_metrics table)
  agentAIS?: {
    creation_score: number;
    execution_score: number;
    combined_score: number;
  };
}

/**
 * Model configuration for routing
 * Stored in database, configurable via admin UI
 */
export interface ModelConfig {
  tier: ModelTier;
  provider: string;
  model: string;
  maxTokens: number;
  temperature: number;
  costPerToken: number;
  avgLatencyMs: number;
  supportedIntents: IntentType[];
}

// ============================================================================
// HANDLER INTERFACES
// ============================================================================

/**
 * Base handler interface for intent processing
 */
export interface IntentHandler {
  intent: IntentType;
  handle(context: HandlerContext): Promise<HandlerResult>;
  estimateTokens(context: HandlerContext): Promise<number>;
  validate(context: HandlerContext): Promise<boolean>;
}

/**
 * Context passed to intent handlers
 */
export interface HandlerContext {
  stepId: string;
  agentId: string;
  userId: string;  // ✅ User ID for token tracking and analytics
  executionId: string;  // ✅ Execution ID for token correlation with agent_executions
  intent: IntentType;
  input: any;
  budget: TokenBudget;
  compressionPolicy: CompressionPolicy;
  routingDecision: RoutingDecision;
  metadata: OrchestrationMetadata;
  memory?: any;  // Memory context if available
  plugins?: any; // Available plugins
  executionContext?: any;  // ✅ ExecutionContext for variable resolution (from Pilot)
}

/**
 * Result from intent handler execution
 */
export interface HandlerResult {
  success: boolean;
  output: any;
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };
  cost: number;
  latency: number;
  quality?: number;
  compressed?: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

// ============================================================================
// ORCHESTRATION METADATA
// ============================================================================

/**
 * Comprehensive orchestration metadata for a workflow execution
 */
export interface OrchestrationMetadata {
  executionId: string;
  workflowId: string;
  agentId: string;
  userId: string;
  startTime: Date;
  endTime?: Date;
  totalBudget: TokenBudget;
  budgetStrategy: BudgetAllocationStrategy;
  featureFlags: {
    orchestrationEnabled: boolean;
    compressionEnabled: boolean;
    aisRoutingEnabled: boolean;
    adaptiveBudgetEnabled: boolean;
  };
  steps: StepMetadata[];
  globalMetrics: OrchestrationMetrics;

  // Agent-level AIS scores for this execution
  agentAIS?: {
    creation_score: number;
    execution_score: number;
    combined_score: number;
  };
}

/**
 * Metadata for individual workflow step
 */
export interface StepMetadata {
  stepId: string;
  intent: IntentType;
  classification: IntentClassification;
  budget: TokenBudget;
  compressionPolicy: CompressionPolicy;
  routingDecision: RoutingDecision;
  startTime: Date;
  endTime?: Date;
  result?: HandlerResult;
}

// ============================================================================
// METRICS AND MONITORING
// ============================================================================

/**
 * Performance metrics for orchestration
 */
export interface PerformanceMetrics {
  totalExecutionTime: number;
  orchestrationOverhead: number;
  intentClassificationTime: number;
  compressionTime: number;
  routingDecisionTime: number;
  avgStepLatency: number;
  stepsCompleted: number;
  stepsFailed: number;
}

/**
 * Cost metrics for orchestration
 */
export interface CostMetrics {
  totalTokensUsed: number;
  totalTokensSaved: number;
  totalCost: number;
  costSavings: number;
  avgCostPerStep: number;
  budgetUtilization: number; // Percentage of budget used
}

/**
 * Quality metrics for orchestration
 */
export interface QualityMetrics {
  avgQualityScore: number;
  minQualityScore: number;
  compressionQualityImpact: number;
  successRate: number;
  retryRate: number;
}

/**
 * Comprehensive orchestration metrics
 */
export interface OrchestrationMetrics {
  performance: PerformanceMetrics;
  cost: CostMetrics;
  quality: QualityMetrics;
  timestamp: Date;
}

// ============================================================================
// AUDIT AND LOGGING
// ============================================================================

/**
 * Audit event types for orchestration
 */
export type OrchestrationAuditEvent =
  | 'intent_classified'
  | 'budget_allocated'
  | 'compression_applied'
  | 'routing_decided'
  | 'handler_executed'
  | 'budget_exceeded'
  | 'quality_degraded'
  | 'step_failed'
  | 'workflow_completed';

/**
 * Audit log entry for orchestration events
 * Integrates with existing AuditTrailService
 */
export interface OrchestrationAuditLog {
  id: string;
  executionId: string;
  stepId?: string;
  agentId: string;
  event: OrchestrationAuditEvent;
  timestamp: Date;
  actor: 'system' | 'user' | 'orchestrator';
  data: Record<string, any>;
  severity: 'info' | 'warning' | 'critical';  // ✅ Changed 'error' to 'critical' to match DB constraint
}

// ============================================================================
// CONFIGURATION (Database-driven)
// ============================================================================

/**
 * Configuration key types for database lookup
 * All values are stored in system_config table or similar
 * Configurable via admin UI
 */
export type OrchestrationConfigKey =
  // Token budget configs (per intent type)
  | 'orchestration_token_budget_extract'
  | 'orchestration_token_budget_summarize'
  | 'orchestration_token_budget_generate'
  | 'orchestration_token_budget_validate'
  | 'orchestration_token_budget_send'
  | 'orchestration_token_budget_transform'
  | 'orchestration_token_budget_conditional'
  | 'orchestration_token_budget_aggregate'
  | 'orchestration_token_budget_filter'
  | 'orchestration_token_budget_enrich'

  // Compression configs (per intent type)
  | 'orchestration_compression_enabled'
  | 'orchestration_compression_strategy_extract'
  | 'orchestration_compression_strategy_summarize'
  | 'orchestration_compression_strategy_generate'
  | 'orchestration_compression_strategy_validate'
  | 'orchestration_compression_strategy_send'
  | 'orchestration_compression_strategy_transform'
  | 'orchestration_compression_strategy_conditional'
  | 'orchestration_compression_strategy_aggregate'
  | 'orchestration_compression_strategy_filter'
  | 'orchestration_compression_strategy_enrich'
  | 'orchestration_compression_target_ratio'
  | 'orchestration_compression_min_quality'
  | 'orchestration_compression_aggressiveness'

  // AIS routing configs (agent-level thresholds)
  | 'orchestration_ais_routing_enabled'
  | 'orchestration_ais_fast_tier_max_score'       // Max combined_score for fast tier
  | 'orchestration_ais_balanced_tier_max_score'   // Max combined_score for balanced tier
  | 'orchestration_ais_powerful_tier_min_score'   // Min combined_score for powerful tier
  | 'orchestration_ais_quality_weight'
  | 'orchestration_ais_cost_weight'

  // Budget configs
  | 'orchestration_budget_overage_allowed'
  | 'orchestration_budget_overage_threshold'
  | 'orchestration_budget_allocation_strategy'
  | 'orchestration_max_tokens_per_step'
  | 'orchestration_max_tokens_per_workflow'

  // Feature flags
  | 'orchestration_enabled'
  | 'orchestration_adaptive_budget_enabled'

  // Thresholds
  | 'orchestration_intent_classification_confidence_threshold'
  | 'orchestration_quality_score_minimum'
  | 'orchestration_max_retry_attempts'

  // Bulletproof Classification (Phase 1)
  | 'orchestration_bulletproof_classification_enabled'
  | 'orchestration_validation_enabled'
  | 'orchestration_ambiguity_detection_enabled'
  | 'orchestration_tier1_min_confidence'
  | 'orchestration_tier2_min_confidence'
  | 'orchestration_tier3_min_confidence'
  | 'orchestration_validation_disagreement_threshold';

/**
 * Configuration value retrieved from database
 */
export interface OrchestrationConfig {
  key: OrchestrationConfigKey;
  value: any;
  type: 'string' | 'number' | 'boolean' | 'json';
  description?: string;
  updatedAt: Date;
  updatedBy?: string;
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Base orchestration error class
 */
export class OrchestrationError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'OrchestrationError';
  }
}

/**
 * Budget exceeded error
 */
export class BudgetExceededError extends OrchestrationError {
  constructor(allocated: number, required: number, context?: Record<string, any>) {
    super(
      `Budget exceeded: required ${required} tokens, only ${allocated} allocated`,
      'BUDGET_EXCEEDED',
      context
    );
    this.name = 'BudgetExceededError';
  }
}

/**
 * Intent classification error
 */
export class IntentClassificationError extends OrchestrationError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'INTENT_CLASSIFICATION_FAILED', context);
    this.name = 'IntentClassificationError';
  }
}

/**
 * Compression error
 */
export class CompressionError extends OrchestrationError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'COMPRESSION_FAILED', context);
    this.name = 'CompressionError';
  }
}

/**
 * Routing error
 */
export class RoutingError extends OrchestrationError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'ROUTING_FAILED', context);
    this.name = 'RoutingError';
  }
}

// ============================================================================
// HANDLER REGISTRY
// ============================================================================

/**
 * Registry for intent handlers
 */
export interface HandlerRegistry {
  register(intent: IntentType, handler: IntentHandler): void;
  get(intent: IntentType): IntentHandler | undefined;
  has(intent: IntentType): boolean;
  getAll(): Map<IntentType, IntentHandler>;
}

// ============================================================================
// SERVICE INTERFACES
// ============================================================================

/**
 * Intent classifier service interface
 */
export interface IIntentClassifier {
  classify(step: any): Promise<IntentClassification>;
  getConfidenceThreshold(): Promise<number>;
}

/**
 * Token budget manager service interface
 */
export interface ITokenBudgetManager {
  allocateBudget(
    workflow: any,
    intents: IntentClassification[],
    agentAIS?: { creation_score: number; execution_score: number; combined_score: number }
  ): Promise<Map<string, TokenBudget>>;
  trackUsage(stepId: string, tokensUsed: number): Promise<void>;
  checkBudget(stepId: string, requiredTokens: number): Promise<boolean>;
  getBudgetStatus(stepId: string): Promise<TokenBudget>;
}

/**
 * Compression service interface
 */
export interface ICompressionService {
  compress(
    content: string,
    policy: CompressionPolicy,
    intent: IntentType
  ): Promise<CompressionResult>;
  getPolicy(intent: IntentType): Promise<CompressionPolicy>;
}

/**
 * Routing service interface
 * Uses agent-level AIS scores for routing decisions
 */
export interface IRoutingService {
  route(context: RoutingContext): Promise<RoutingDecision>;
  getModelConfig(tier: ModelTier, intent: IntentType): Promise<ModelConfig>;
  getTierFromAIS(combined_score: number): Promise<ModelTier>;
}

/**
 * Configuration service interface
 */
export interface IConfigService {
  get<T = any>(key: OrchestrationConfigKey): Promise<T>;
  set(key: OrchestrationConfigKey, value: any): Promise<void>;
  getAll(): Promise<OrchestrationConfig[]>;
  reload(): Promise<void>; // Reload config from database
}

// ============================================================================
// INTEGRATION WITH EXISTING SYSTEMS
// ============================================================================

/**
 * Integration point with existing AIS system
 * Fetches agent-level scores from agent_intensity_metrics table
 */
export interface AISIntegration {
  getAgentScores(agentId: string): Promise<{
    creation_score: number;
    execution_score: number;
    combined_score: number;
  } | null>;
}

/**
 * Integration point with existing memory system
 */
export interface MemoryIntegration {
  getMemoryContext(userId: string, agentId: string): Promise<any>;
  getMemoryTokenBudget(): number; // Returns ~800 token budget for memory
}

/**
 * Integration point with existing audit system
 */
export interface AuditIntegration {
  logOrchestrationEvent(log: OrchestrationAuditLog): Promise<void>;
}

/**
 * Integration point with existing token tracking
 */
export interface TokenIntegration {
  trackTokenUsage(
    userId: string,
    agentId: string,
    executionId: string,
    tokens: { input: number; output: number; total: number },
    cost: number,
    provider: string,
    model: string
  ): Promise<void>;
}
