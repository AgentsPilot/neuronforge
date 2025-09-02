// Complete type definitions for autonomous intelligent agent system

// Core execution types
export interface ExecutionContext {
  id: string
  query: string
  intent: Intent
  currentStep: number
  totalSteps: number
  executionState: 'planning' | 'executing' | 'monitoring' | 'recovering' | 'completed' | 'failed'
  results: Record<string, any>
  errors: ExecutionError[]
  startTime: number
  estimatedCompletion: number
  confidence: number
  dependencies: string[]
  pluginAttempts: Record<string, number>
  fallbackStrategies: string[]
  confidenceLevel: number
  currentStrategy: string
  executionHistory: ExecutionStep[]
  criticalErrors: string[]
  recoveryAttempts: number
}

export interface ExecutionError {
  step: string
  plugin: string
  errorType: 'timeout' | 'auth' | 'rate_limit' | 'data_unavailable' | 'parsing_error' | 'unknown'
  message: string
  timestamp: number
  recoveryAttempts: number
  maxRecoveryAttempts: number
  recoverable: boolean
}

export interface ExecutionStep {
  id: string
  action: string
  plugins: string[]
  priority: number
  dependencies: string[]
  timeout: number
  retries: number
  validation: ValidationRule[]
  rollback?: RollbackAction
  monitoring: boolean
  timestamp: number
  plugin?: string
  success: boolean
  duration: number
  result?: any
  error?: string
  confidence: number
}

// Intelligence and reasoning types
export interface Intent {
  queryType: 'financial_data' | 'competitive_analysis' | 'operational_metrics' | 
            'customer_intelligence' | 'strategic_planning' | 'compliance_check' | 
            'communication' | 'document_processing' | 'research_investigation' |
            'predictive_analysis' | 'risk_assessment' | 'optimization'
  businessFunction: string[]
  requiredCapabilities: string[]
  dataRequirements: string[]
  urgency: 'immediate' | 'recent' | 'historical' | 'timeless'
  complexity: 'simple' | 'moderate' | 'complex' | 'expert'
  confidence: number
  reasoning: ReasoningChain
  goals: Goal[]
  constraints: {
    time_limit?: number
    budget_limit?: number
    data_sensitivity: 'public' | 'internal' | 'confidential'
    accuracy_threshold: number
  }
}

export interface ReasoningChain {
  premise: string
  inference_steps: ReasoningStep[]
  conclusion: string
  overall_confidence: number
  assumptions: string[]
  alternative_explanations: string[]
}

export interface ReasoningStep {
  step: number
  reasoning: string
  evidence: string[]
  confidence: number
}

export interface Goal {
  id: string
  description: string
  priority: number
  deadline?: number
  subgoals: Goal[]
  success_criteria: string[]
  progress: number
  status: 'pending' | 'active' | 'completed' | 'failed' | 'paused'
}

// Plugin and capability types
export interface PluginMatch {
  plugin: string
  matchingCapabilities: string[]
  score: number
  priority: number
  confidence?: number
  riskFactors?: RiskFactor[]
}

export interface AdaptiveCapability {
  name: string
  baseEffectiveness: number
  currentEffectiveness: number
  adaptationHistory: {
    timestamp: number
    context: string
    adjustment: number
    reason: string
  }[]
  optimizationStrategy: 'performance' | 'reliability' | 'speed' | 'accuracy'
}

// Execution strategy types
export interface ExecutionStrategy {
  id: string
  steps: ExecutionStep[]
  toolChain: string[]
  parallelExecution: boolean
  fallbackPlan: FallbackStrategy[]
  monitoring: MonitoringConfig
  adaptation: AdaptationConfig
  timeouts: Record<string, number>
  retryPolicies: Record<string, RetryPolicy>
}

export interface FallbackStrategy {
  trigger: string
  action: 'alternative_plugin' | 'simplified_approach' | 'human_intervention' | 'cached_data'
  parameters: any
  confidence_impact: number
}

export interface ValidationRule {
  type: 'data_quality' | 'completeness' | 'accuracy' | 'timeliness' | 'format'
  condition: string
  threshold: number
  action: 'warn' | 'retry' | 'fail' | 'fallback'
}

export interface RetryPolicy {
  maxAttempts: number
  backoffStrategy: 'exponential' | 'linear' | 'fixed'
  baseDelay: number
  maxDelay: number
  conditions: string[]
}

export interface RollbackAction {
  type: 'revert_data' | 'reset_state' | 'notify_user'
  parameters: any
  cleanup: string[]
}

// Monitoring and performance types
export interface MonitoringConfig {
  realTimeTracking: boolean
  performanceThresholds: Record<string, number>
  alerting: {
    channels: string[]
    severityLevels: string[]
  }
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error'
    retention: number
  }
}

export interface AdaptationConfig {
  learningRate: number
  adaptationTriggers: string[]
  improvementMetrics: string[]
  rollbackConditions: string[]
}

export interface PerformanceMetrics {
  accuracy: number
  speed: number
  reliability: number
  userSatisfaction: number
  resourceEfficiency: number
  adaptability: number
  autonomy_level: number
}

// Learning and memory types
export interface LearningEvent {
  id: string
  timestamp: number
  executionId: string
  agentType: string
  query: string
  queryType: string
  strategy: string
  outcome: 'success' | 'partial' | 'failure'
  metrics: PerformanceMetrics
  lessons: string[]
  improvements: string[]
  context: {
    pluginsUsed: string[]
    dataQuality: 'high' | 'medium' | 'low'
    complexityLevel: string
    environmentFactors: Record<string, any>
  }
}

export interface HistoricalData {
  queryPattern: string
  successfulStrategies: string[]
  failedStrategies: string[]
  avgExecutionTime: number
  avgAccuracy: number
  lastUpdated: number
  usageFrequency: number
}

export interface AgentMemory {
  shortTerm: Map<string, any>
  longTerm: Map<string, HistoricalData>
  workingMemory: ExecutionContext[]
  learningHistory: LearningEvent[]
}

// Autonomy and decision-making types
export interface AutomationRule {
  id: string
  trigger: {
    type: 'schedule' | 'event' | 'threshold' | 'pattern'
    condition: any
  }
  action: {
    type: 'execute_query' | 'generate_report' | 'notify' | 'update_data'
    parameters: any
  }
  enabled: boolean
  lastExecuted?: number
  nextExecution?: number
}

export interface RiskFactor {
  type: 'single_point_of_failure' | 'low_reliability' | 'resource_conflict' | 'data_staleness' | 
        'historical_failure' | 'resource_exhaustion' | 'dependency_complexity'
  severity: 'low' | 'medium' | 'high'
  description: string
  mitigation: string
  probability?: number
  impact?: 'low' | 'medium' | 'high'
}

// Enhanced result types
export interface IntelligenceResult {
  intent: Intent
  pluginMatches: PluginMatch[]
  executionStrategy: ExecutionStrategy
  systemPrompt: string
  autonomyLevel: number
  reasoning: ReasoningChain
  monitoring: {
    healthChecks: string[]
    alertThresholds: Record<string, number>
    progressTracking: boolean
  }
}

// Planning types
export interface PlanningNode {
  id: string
  action: string
  dependencies: string[]
  estimatedDuration: number
  confidence: number
  fallbackOptions: string[]
  resources: {
    plugins: string[]
    dataRequirements: string[]
    computeComplexity: 'low' | 'medium' | 'high'
  }
}

// Prompt enhancement types
export interface QueryClassification {
  queryType: string
  complexity: 'simple' | 'moderate' | 'complex' | 'expert'
  urgency: 'low' | 'medium' | 'high'
  confidence: number
  keywords: string[]
  businessContext: string[]
}

export interface EnhancedPrompt {
  original: string
  enhanced: string
  template: PromptTemplate
  reasoning: ReasoningPattern
  metadata: {
    queryType: string
    urgencyLevel: string
    enhancementLayers: string[]
    expectedConfidence: number
  }
}

export interface PromptTemplate {
  enhancementLayers: string[]
  reasoningFramework: string
  outputOptimization: string
}

export interface ReasoningPattern {
  framework: string[]
  validation: string
}

// Memory system types
export interface MemoryItem {
  id: string
  data: any
  timestamp: number
  expiration: number
  accessCount: number
  importance: number
  tags: string[]
}

export interface WorkingMemoryContext {
  executionId: string
  query: string
  intent: any
  startTime: number
  currentFocus: string
  activeVariables: Map<string, any>
  hypotheses: Hypothesis[]
  evidence: Map<string, any>
  decisions: Decision[]
  subgoals: Goal[]
  progressMarkers: Map<string, number>
  confidenceHistory: number[]
  lastUpdated: number
}

export interface Hypothesis {
  id: string
  statement: string
  confidence: number
  evidence: string[]
  status: 'pending' | 'confirmed' | 'rejected' | 'modified'
  timestamp: number
}

export interface Decision {
  id: string
  context: string
  options: string[]
  chosen: string
  reasoning: string
  confidence: number
  outcome: 'success' | 'failure' | 'pending'
  timestamp: number
  autonomous: boolean
  changed: boolean
  strategy?: string
}

export interface EpisodicMemory {
  id: string
  timestamp: number
  query: string
  intent: any
  outcome: string
  strategies: string[]
  results: any
  lessons: string[]
  context: any
  importance: number
  metrics: PerformanceMetrics
}

export interface SemanticKnowledge {
  domain: string
  concepts: Map<string, Concept>
  relationships: Map<string, Relationship>
  expertise_level: number
  last_updated: number
}

export interface Concept {
  name: string
  definition: string
  confidence: number
  examples: string[]
  related_concepts: string[]
}

export interface Relationship {
  from: string
  to: string
  type: string
  strength: number
  evidence: string[]
}

// Monitoring types
export interface MonitoringSession {
  executionId: string
  startTime: number
  context: ExecutionContext
  metrics: ExecutionMetrics
  alerts: Alert[]
  healthStatus: HealthStatus
  lastUpdate: number
  cleanupInterval?: NodeJS.Timeout
}

export interface ExecutionMetrics {
  currentStep: number
  totalSteps: number
  progressPercentage: number
  confidenceLevel: number
  errorCount: number
  warningCount: number
  pluginPerformance: Map<string, PluginPerformanceMetrics>
  resourceUsage: ResourceUsage
}

export interface PluginPerformanceMetrics {
  executionTime: number
  successRate: number
  errorRate: number
  dataQuality: number
  reliability: number
  lastUsed: number
}

export interface ResourceUsage {
  memory: number
  cpu: number
  network: number
}

export interface Alert {
  id: string
  type: string
  severity: 'low' | 'medium' | 'high'
  timestamp: number
  executionId: string
  data: any
  handled: boolean
}

export type HealthStatus = 'healthy' | 'degraded' | 'critical'

// Agent brain and reasoning types
export interface AnalysisResult {
  queryUnderstanding: QueryUnderstanding
  patterns: PatternAnalysis
  strategicPlan: StrategicPlan
  uncertaintyAnalysis: UncertaintyAnalysis
  knowledgeIntegration: KnowledgeIntegration
  confidence: number
  recommendations: string[]
}

export interface QueryUnderstanding {
  originalQuery: string
  intent: IntentAnalysis
  goals: Goal[]
  constraints: QueryConstraints
  complexity: ComplexityAnalysis
  informationNeeds: InformationRequirements
  reasoningChain: ReasoningChain
  confidence: number
}

export interface IntentAnalysis {
  primary: string
  secondary: string[]
  confidence: number
  actionVerbs: string[]
}

export interface QueryConstraints {
  timeLimit?: number
  dataScope: 'internal' | 'external' | 'both'
  outputFormat: string
  confidenceRequirement: number
  resourceLimits: ResourceLimits
}

export interface ComplexityAnalysis {
  score: number
  level: 'simple' | 'moderate' | 'complex' | 'expert'
  factors: string[]
  estimatedProcessingTime: number
  resourceRequirements: ResourceRequirements
}

export interface InformationRequirements {
  dataTypes: string[]
  sources: string[]
  freshness: 'current' | 'recent' | 'historical'
  accuracy: 'moderate' | 'high' | 'very_high'
  completeness: 'basic' | 'comprehensive' | 'exhaustive'
}

export interface ResourceRequirements {
  pluginsNeeded: number
  dataSourcesNeeded: number
  processingPower: 'low' | 'medium' | 'high'
  memoryUsage: 'low' | 'medium' | 'high'
}

export interface ResourceLimits {
  maxPlugins: number
  maxExecutionTime: number
  maxDataSources: number
}

export interface PatternAnalysis {
  queryType: string
  confidence: number
  historicalPatterns: string[]
  similarQueries: string[]
  successFactors: string[]
  riskFactors: string[]
}

export interface StrategicPlan {
  framework: StrategicFramework
  executionSteps: StrategicExecutionStep[]
  dependencies: DependencyMap
  riskAssessment: RiskAssessment
  confidence: number
  estimatedDuration: number
  successProbability: number
  fallbackOptions: FallbackOption[]
}

export interface StrategicFramework {
  name: string
  steps: string[]
  suitableFor: string[]
}

export interface StrategicExecutionStep {
  id: string
  name: string
  description: string
  requiredCapabilities: string[]
  estimatedDuration: number
  confidence: number
  dependencies: string[]
  riskFactors: string[]
  successCriteria: string[]
}

export interface DependencyMap {
  critical: Dependency[]
  optional: Dependency[]
  parallel: ParallelGroup[]
}

export interface Dependency {
  dependent: string
  dependency: string
  reason: string
}

export interface ParallelGroup {
  dependencies: string[]
  tasks: ParallelTask[]
  steps?: string[]
  reason: string
}

export interface ParallelTask {
  id: string
  action: string
  estimatedDuration: number
  confidence: number
  resources: {
    plugins: string[]
    dataRequirements: string[]
    computeComplexity: 'low' | 'medium' | 'high'
  }
  fallbackOptions?: string[]
}

export interface RiskAssessment {
  risks: Risk[]
  overallRiskLevel: 'low' | 'medium' | 'high'
  mitigation_priority: string[]
  monitoring_points: string[]
}

export interface Risk {
  type: string
  probability: number
  impact: 'low' | 'medium' | 'high'
  description: string
  mitigation: string
}

export interface FallbackOption {
  name: string
  description: string
  trigger: string
  impact: string
  confidence_adjustment: number
}

export interface UncertaintyAnalysis {
  highRiskFactors: string[]
  informationGaps: string[]
  confidenceIntervals: Record<string, [number, number]>
  assumptions: string[]
  sensitivity: Record<string, number>
}

export interface KnowledgeIntegration {
  relevantKnowledge: string[]
  expertiseAreas: string[]
  knowledgeGaps: string[]
  confidence: number
}

// Autonomy and control types
export interface AutonomyLevel {
  level: number
  description: string
  capabilities: string[]
  restrictions: string[]
  monitoring: string
}

export interface ControlPolicy {
  name: string
  rules: string[]
  enforcement: 'strict' | 'moderate' | 'flexible'
  exceptions: string[]
}

export interface SafetyConstraints {
  maxResourceUsage: number
  requiredConfidenceLevel: number
  maxExecutionTime: number
  allowedOperations: string[]
  forbiddenOperations: string[]
  escalationTriggers: string[]
}

export interface EmergencyProtocol {
  name: string
  trigger: string
  actions: string[]
  recovery: string
}

export interface AutonomousExecutionState {
  id: string
  strategy: ExecutionStrategy
  context: ExecutionContext
  autonomyLevel: AutonomyLevel
  currentStep: number
  executionPhase: 'initialization' | 'executing' | 'recovering' | 'completed' | 'failed'
  decisions: AutonomousDecision[]
  adaptations: Adaptation[]
  safetyChecks: SafetyCheck[]
  resourceUsage: ResourceUsageTracking
  emergencyState: EmergencyState | null
  lastDecisionTime: number
}

export interface AutonomousDecision {
  id: string
  context: string
  options: ExecutionOption[]
  chosen: string
  reasoning: string
  confidence: number
  timestamp: number
  autonomous: boolean
  riskAssessment: string
}

export interface ExecutionOption {
  id: string
  description: string
  risk: 'very_low' | 'low' | 'medium' | 'high'
  confidence: number
  resources: { time: number, plugins: number }
  benefits: string[]
}

export interface Adaptation {
  type: string
  step: string
  description: string
  impact: 'positive' | 'negative' | 'neutral'
  timestamp: number
}

export interface SafetyCheck {
  type: string
  severity: 'info' | 'warning' | 'critical'
  message: string
  passed: boolean
}

export interface SafetyCheckResult {
  passed: boolean
  checks: SafetyCheck[]
  riskLevel: 'low' | 'medium' | 'high'
  recommendations: string[]
}

export interface ResourceUsageTracking {
  plugins: number
  memory: number
  time: number
  confidence: number
}

export interface EmergencyState {
  protocol: string
  triggered_at: number
  current_action: string
  recovery_progress: number
}

// Learning system types
export interface PatternRecord {
  id: string
  queryType: string
  outcome: 'success' | 'partial' | 'failure'
  occurrences: number
  avgConfidence: number
  firstSeen: number
  lastSeen: number
  strategies: Map<string, number>
  lessons: string[]
  improvements: string[]
  environmentalFactors: any[]
}

export interface PerformanceBaseline {
  agentType: string
  accuracy: number
  speed: number
  reliability: number
  userSatisfaction: number
  sampleCount: number
  firstRecorded: number
  lastUpdated: number
  trend: 'improving' | 'stable' | 'declining'
}

export interface AdaptationStrategy {
  name: string
  triggers: string[]
  actions: string[]
  learningWeight: number
}

export interface IdentifiedPatterns {
  successful_strategies: Map<string, number>
  failure_modes: Map<string, number>
  performance_correlations: Map<string, CorrelationData>
  seasonal_patterns: Map<string, any>
  improvement_opportunities: ImprovementOpportunity[]
}

export interface CorrelationData {
  correlation: number
  strength: 'weak' | 'moderate' | 'strong'
  dataPoints: number
  insight: string
}

export interface ImprovementOpportunity {
  type: string
  description: string
  priority: 'low' | 'medium' | 'high'
  suggestedActions: string[]
  expectedImpact: number
}

export interface LearningInsights {
  totalLearningEvents: number
  successRate: number
  avgAccuracy: number
  topLessons: string[]
  improvementTrends: Map<string, TrendData>
  recommendations: string[]
}

export interface TrendData {
  current: number
  previous: number
  change: number
  trend: 'improving' | 'stable' | 'declining'
}

export interface LearningProgress {
  totalLearningEvents: number
  identifiedPatterns: number
  consolidatedPatterns: number
  learningMaturity: 'nascent' | 'developing' | 'mature' | 'expert'
  activeAdaptations: number
  knowledgeGraphNodes: number
  lastConsolidation: number
}

// Knowledge graph types
export interface KnowledgeNode {
  id: string
  type: string
  value: string
  weight: number
  connections: number
  lastUpdated: number
  metadata: Record<string, any>
}

export interface KnowledgeEdge {
  id: string
  from: string
  to: string
  relationship: string
  strength: number
  count: number
  lastUpdated: number
}

export interface RelatedPattern {
  relationship: string
  strength: number
  fromNode: string
  toNode: string
  confidence: number
  usageCount: number
}

// Memory management types
export interface MemoryLimits {
  shortTermCapacity: number
  workingMemoryCapacity: number
  longTermRetention: number
  shortTermRetention: number
  maxMemorySize: number
  consolidationThreshold: number
}

export interface MemoryCleanupReport {
  shortTermCleaned: number
  longTermConsolidated: number
  episodesCleaned: number
  workingContextsCleaned: number
  memoryFreed: number
  patterns_consolidated: number
}

export interface MemoryInsights {
  totalMemoryItems: number
  shortTermItems: number
  longTermPatterns: number
  episodicMemories: number
  semanticConcepts: number
  workingContexts: number
  memoryUsageBytes: number
  memoryEfficiency: number
  consolidationOpportunities: ConsolidationOpportunity[]
  insights: string[]
}

export interface ConsolidationOpportunity {
  type: string
  count: number
  description: string
  impact: string
}

export interface MemoryUsageStats {
  shortTermUtilization: number
  workingMemoryUtilization: number
  totalMemoryUsage: number
  maxMemoryLimit: number
  efficiency: number
  lastCleanup: number
}

export interface MemorySearchResult {
  type: 'short_term' | 'long_term' | 'episodic' | 'semantic' | 'working'
  key: string
  data: any
  relevance: number
  timestamp: number
  importance: number
}

export interface MemoryOptimization {
  memoryFreed: number
  shortTermOptimized: number
  longTermOptimized: number
  episodicOptimized: number
  efficiencyGain: number
  recommendations: string[]
}

export type MemoryType = 'short_term' | 'long_term' | 'episodic' | 'semantic' | 'working' | 'all'

// Recovery and error handling types
export interface RecoveryPlan {
  feasible: boolean
  strategy: string
  estimatedTime: number
  confidence: number
  actions: string[]
}

export interface RecoveryStrategy {
  name: string
  actions: string[]
  expectedConfidence: number
  estimatedTime: number
}

export interface RecoveryActionResult {
  success: boolean
  data: any
  confidence: number
}

export interface StepRecoveryResult {
  shouldContinue: boolean
  result: any
  strategy: string
  confidence: number
}

export interface ContinuationDecision {
  shouldContinue: boolean
  reason: string
  confidence: number
}

export interface StepOutcome {
  success: boolean
  quality: 'low' | 'medium' | 'high'
  completeness: number
  insights: string[]
}

export interface AdaptationAssessment {
  needed: boolean
  reasons: string[]
  urgency: 'low' | 'medium' | 'high'
}

export interface AdaptationPlan {
  adaptations: AdaptationAction[]
  priority: 'low' | 'medium' | 'high'
  expectedConfidenceGain: number
  implementation_time: number
}

export interface AdaptationAction {
  type: string
  action: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  expectedImpact: number
}

export type ErrorType = 'timeout' | 'authentication' | 'rate_limit' | 'network' | 'data_processing' | 'unknown'

// Execution and results types
export interface SmartPluginResult {
  data: any
  confidence: number
  freshness: number
  quality: 'high' | 'medium' | 'low'
  source: string
  fallbackUsed: boolean
  executionTime: number
}

export interface ExecutionCallbacks {
  onStepStart?: (step: ExecutionStep) => void
  onStepComplete?: (step: ExecutionStep, result: any) => void
  onStepError?: (step: ExecutionStep, error: any) => void
  onProgressUpdate?: (progress: number) => void
}

// Supporting utility types
export interface SequentialStep {
  action: string
  plugins: string[]
  estimatedDuration: number
  confidence: number
  complexity: 'low' | 'medium' | 'high'
  dataRequirements: string[]
  fallbackOptions?: string[]
}

export interface ExecutionSummary {
  executionId: string
  progress: number
  confidence: number
  healthStatus: HealthStatus
  duration: number
  currentStep: number
  totalSteps: number
}

export interface SystemHealthReport {
  totalActiveExecutions: number
  healthyExecutions: number
  degradedExecutions: number
  criticalExecutions: number
  averageConfidence: number
  totalAlerts: number
  systemStatus: 'optimal' | 'good' | 'degraded' | 'critical'
  recommendations: string[]
}

export interface MonitoringSummary {
  executionId: string
  totalDuration: number
  finalHealthStatus: HealthStatus
  totalAlerts: number
  criticalAlerts: number
  finalConfidence: number
  finalProgress: number
  pluginPerformance: [string, PluginPerformanceMetrics][]
  resourceUsage: number
  recoveryEvents: number
  lessons: string[]
}

export interface PerformanceReport {
  timeRange: 'hour' | 'day' | 'week'
  totalExecutions: number
  successRate: number
  averageConfidence: number
  averageExecutionTime: number
  healthDistribution: Record<HealthStatus, number>
  topIssues: string[]
  recommendations: string[]
}

// Alert and handler types
export interface AlertHandler {
  severity: 'low' | 'medium' | 'high'
  handler: (session: MonitoringSession, alert: Alert) => Promise<void>
}

export interface PerformanceThresholds {
  maxExecutionTime: number
  minConfidenceLevel: number
  maxErrorRate: number
  maxPluginFailures: number
  minDataQuality: number
  maxRecoveryAttempts: number
  responseTimeWarning: number
  memoryUsageLimit: number
}

// Metrics and snapshots
export interface MetricsSnapshot {
  timestamp: number
  executionId: string
  progress: number
  confidence: number
  errorCount: number
  healthStatus: HealthStatus
  resourceUsage: ResourceUsage
  activePlugins: string[]
}

export interface AggregatedMetrics {
  totalExecutions: number
  successfulExecutions: number
  averageExecutionTime: number
  averageConfidence: number
  pluginReliability: Map<string, number>
  commonFailurePatterns: Map<string, number>
  performanceTrends: PerformanceTrend[]
  lastUpdated: number
}

export interface PerformanceTrend {
  timestamp: number
  metric: string
  value: number
  trend: 'improving' | 'stable' | 'declining'
}

// Enhanced capability types
export interface EmergentCapability {
  id: string
  plugin: string
  context: string
  discoveredAt: number
  confidence: number
  performance: PerformanceMetrics
  validationAttempts: number
  validated: boolean
}

export interface PotentialCapability {
  id: string
  plugin: string
  pattern: string
  context: string
  discoveredAt: number
  confidence: number
  evidenceCount: number
  needsValidation: boolean
}

export interface PluginCombination {
  plugins: string[]
  score: number
  coverage: number
  synergy: number
  estimatedPerformance: PerformanceMetrics
  riskFactors: RiskFactor[]
}

// Learning-specific types
export interface StrategyPerformance {
  totalExecutions: number
  successfulExecutions: number
  avgAccuracy: number
  avgSpeed: number
  queryTypes: Set<string>
}

export interface PluginPerformanceAnalysis {
  totalUsage: number
  successfulUsage: number
  avgAccuracy: number
  avgSpeed: number
  successRate: number
}

// Intent analyzer interface (for compatibility)
export interface IntentAnalyzer {
  analyzeIntent(query: string, inputVariables: Record<string, any>): Intent
}

// Capability matcher interface (for compatibility)  
export interface CapabilityMatcher {
  findOptimalPlugins(requiredCapabilities: string[], availablePlugins: string[]): PluginMatch[]
}

// MISSING TYPES - Added for universal prompt generator compatibility
export interface SmartIntentAnalysis {
  primaryIntent: string
  subIntents: string[]
  urgency: 'low' | 'medium' | 'high' | 'critical'
  complexity: 'simple' | 'moderate' | 'complex' | 'expert'
  businessContext: string
  requiredCapabilities: string[]
  dataRequirements: string[]
  expectedOutputFormat: string
  qualityThreshold: number
  confidenceLevel: number
  dataSource?: string
  actionType?: string
  scope?: string
  timeframe?: string | null
}

export interface AdaptiveStrategy {
  name: string
  primaryApproach: string
  fallbackStrategies: string[]
  performanceOptimizations: string[]
}

export interface ContextualMemory {
  userPatterns: Record<string, any>
  domainKnowledge: Record<string, any>
  executionHistory: any[]
  preferredStrategies: string[]
  failurePatterns: string[]
  successFactors: string[]
}

export interface SmartPromptData {
  systemPrompt: string
  userPrompt: string
  context: any
  strategy: string
  confidenceBoost: number
}

// RunAgent input types
export interface RunAgentInput {
  supabase: any
  agent: any
  userId: string
  input_variables: Record<string, any>
  override_user_prompt?: string
}