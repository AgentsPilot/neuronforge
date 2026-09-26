// lib/repositories/index.ts
// Export all repositories and types

// Repositories
export { AgentRepository, agentRepository } from './AgentRepository';
export { ExecutionRepository, executionRepository } from './ExecutionRepository';
export { SharedAgentRepository, sharedAgentRepository } from './SharedAgentRepository';
export { AgentMetricsRepository, agentMetricsRepository } from './AgentMetricsRepository';
export { ConfigRepository, configRepository } from './ConfigRepository';
export { MemoryRepository, memoryRepository } from './MemoryRepository';
export { PluginConnectionRepository, pluginConnectionRepository } from './PluginConnectionRepository';
export { SystemConfigRepository, systemConfigRepository } from './SystemConfigRepository';
export { AiModelPricingRepository, aiModelPricingRepository } from './AiModelPricingRepository';
export { AgentConfigurationRepository, agentConfigurationRepository } from './AgentConfigurationRepository';
export { AgentStatsRepository, agentStatsRepository } from './AgentStatsRepository';
export { AgentLogsRepository, agentLogsRepository } from './AgentLogsRepository';
export { ExecutionLogRepository, executionLogRepository } from './ExecutionLogRepository';
export { CalibrationSessionRepository } from './CalibrationSessionRepository';
export { CalibrationHistoryRepository } from './CalibrationHistoryRepository';
export { InsightRepository } from './InsightRepository';
export { UserProfileRepository, userProfileRepository } from './UserProfileRepository';
export type { UserProfile } from './UserProfileRepository';

// Business OS entitlements (component 1). Server-only: these tables have RLS on
// with no policies, so every method runs with the service role by design — see
// the header of each file. Never import them from a 'use client' module.
export {
  BusinessOsAccountPlanRepository,
  businessOsAccountPlanRepository,
  BOS_ENTITLEMENT_BATCH_LIMIT,
} from './BusinessOsAccountPlanRepository';
export type {
  BusinessOsAccountPlan,
  BusinessOsEntitlementOverride,
  BusinessOsEntitlementInputs,
  BusinessOsAccountPlanPatch,
  EnsureBusinessOsAccountPlanInput,
  CreateBusinessOsOverrideInput,
  ResetBusinessOsPlanStateInput,
} from './BusinessOsAccountPlanRepository';
export {
  BusinessOsEntitlementShadowRepository,
  businessOsEntitlementShadowRepository,
  BOS_SHADOW_EVENT_BATCH_LIMIT,
} from './BusinessOsEntitlementShadowRepository';
export type {
  BusinessOsShadowEvent,
  BusinessOsShadowEventInput,
} from './BusinessOsEntitlementShadowRepository';
export {
  OrganizationRepository,
  organizationRepository,
} from './OrganizationRepository';
export type {
  Organization,
  OrganizationMember,
  OrganizationRole,
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from './OrganizationRepository';
export {
  WorkflowGroupRepository,
  workflowGroupRepository,
} from './WorkflowGroupRepository';
export type {
  WorkflowGroup,
  WorkflowGroupWithStats,
  CreateWorkflowGroupInput,
  UpdateWorkflowGroupInput,
} from './WorkflowGroupRepository';
// Row types live in the repository file: `TokenUsage` in ./types is an unrelated
// execution-token type (Layer 1.1 workplan Q-9).
export { TokenUsageRepository, tokenUsageRepository } from './TokenUsageRepository';
// Admin-only, cross-account (admin reorganisation slice 2a). Only
// app/api/admin/** may import it; a source guard enforces that, barrel included.
export {
  AdminTokenUsageAnalyticsRepository,
  adminTokenUsageAnalyticsRepository,
} from './AdminTokenUsageAnalyticsRepository';
// Admin Archiving, read-only in Slice 1 (docs/workplans/ADMIN_ARCHIVING_SLICE_1_UI_WORKPLAN.md)
export { ArchiveRepository, archiveRepository } from './ArchiveRepository';
// S-6 free-tier grant (docs/workplans/ALLOCATE_FREE_TIER_S6_FIX_WORKPLAN.md)
export { UserSubscriptionRepository, userSubscriptionRepository } from './UserSubscriptionRepository';
export type {
  LedgerCallRow,
  LedgerLabelRow,
  LedgerSummaryRow,
  TokenUsageFeatureFilter,
  TokenUsageMatch,
  TokenUsageWindow,
  UsageSummaryRpcRow,
} from './TokenUsageRepository';

// Types
export type {
  // Agent types
  Agent,
  AgentStatus,
  CreateAgentInput,
  UpdateAgentInput,
  UpdateAgentDetailsInput,
  AgentRepositoryResult,
  // Execution types
  Execution,
  ExecutionStatus,
  ExecutionLogs,
  ExecutionTokensUsed,
  TokenUsage,
  // Shared agent types
  SharedAgent,
  CreateSharedAgentInput,
  // Metrics types
  AgentMetrics,
  // Config types
  SystemConfig,
  RewardConfig,
  // Plugin connection types
  UpsertPluginConnectionInput,
  // User subscription (free-tier grant) types
  UserSubscriptionGrantState,
  FreeTierNewRowValues,
  FreeTierNewRow,
  FreeTierGrantPatch,
  FreeTierInsertOutcome,
  FreeTierUpdateOutcome,
  // AI model pricing types
  AiModelPricing,
  CreateAiModelPricingInput,
  AiModelPricingSyncEntry,
  AiModelPricingSyncResult,
} from './types';

export { AgentStatusEnum, STATUS_TRANSITIONS } from './types';

// Memory types (exported from repository file)
export type { RunMemory } from './MemoryRepository';