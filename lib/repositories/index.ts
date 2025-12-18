// lib/repositories/index.ts
// Export all repositories and types

// Repositories
export { AgentRepository, agentRepository } from './AgentRepository';
export { ExecutionRepository, executionRepository } from './ExecutionRepository';
export { SharedAgentRepository, sharedAgentRepository } from './SharedAgentRepository';
export { AgentMetricsRepository, agentMetricsRepository } from './AgentMetricsRepository';
export { ConfigRepository, configRepository } from './ConfigRepository';
export { MemoryRepository, memoryRepository } from './MemoryRepository';
export { SystemConfigRepository, systemConfigRepository } from './SystemConfigRepository';
export { AgentStatsRepository, agentStatsRepository } from './AgentStatsRepository';
export { AgentConfigurationRepository, agentConfigurationRepository } from './AgentConfigurationRepository';
export { AgentLogsRepository, agentLogsRepository } from './AgentLogsRepository';
export { ExecutionLogRepository, executionLogRepository } from './ExecutionLogRepository';

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
  ExecutionStatusRecord,
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
  SystemSettingsConfig,
} from './types';

export { AgentStatusEnum, STATUS_TRANSITIONS } from './types';

// Memory types (exported from repository file)
export type { RunMemory } from './MemoryRepository';

// Execution types (exported from repository file)
export type { CreateExecutionInput } from './ExecutionRepository';

// Agent stats types (exported from repository file)
export type { AgentStats } from './AgentStatsRepository';

// Agent configuration types (exported from repository file)
export type { AgentConfiguration, AgentConfigurationInputValues } from './AgentConfigurationRepository';

// Agent logs types (exported from repository file)
export type { AgentLog, CreateAgentLogInput } from './AgentLogsRepository';

// Execution log types (exported from repository file)
export type { ExecutionLog, CreateExecutionLogInput, ExecutionLogLevel, ExecutionLogPhase } from './ExecutionLogRepository';