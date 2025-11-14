'use client';

import React, { useState, useEffect } from 'react';
import {
  Brain,
  Database,
  Zap,
  Shield,
  GitBranch,
  Activity,
  FileText,
  CheckCircle,
  ArrowRight,
  Play,
  Pause,
  RotateCcw,
  ChevronRight,
  BarChart3,
  Lightbulb,
  Settings,
  Workflow
} from 'lucide-react';

interface AnimationStep {
  id: number;
  title: string;
  subsystem: 'ais' | 'memory' | 'routing' | 'execution' | 'audit' | 'analytics' | 'database' | 'pilot';
  description: string;
  connections: number[];
  data?: Record<string, any>;
}

const ANIMATION_STEPS: AnimationStep[] = [
  // Phase 1: Agent Creation
  {
    id: 1,
    title: 'User Creates Agent',
    subsystem: 'execution',
    description: 'User accesses Smart Agent Builder UI and provides: (1) Agent goal/objective in natural language, (2) Optional configuration (schedule, plugins, input/output schema). Frontend validates inputs and sends POST request to /api/create-agent. Request includes: agent_name, description, user_prompt, mode (on_demand/scheduled), timezone. This initiates the agent creation pipeline which will trigger AIS analysis, Pilot generation, and database storage.',
    connections: [2],
    data: {
      action: 'create_agent',
      input: 'Goal: Process customer orders',
      endpoint: 'POST /api/create-agent',
      validation: 'goal + optional config'
    }
  },
  {
    id: 2,
    title: 'AIS Analysis',
    subsystem: 'ais',
    description: 'IntentAnalyzer uses 6 analytical factors to calculate Agent Intensity Score (0-10): Goal Complexity, Required Capabilities, Expected Interactions, Automation Potential, Data Processing Need, and Integration Complexity. Each factor is weighted and combined using a scoring algorithm. The AIS score determines default model tier selection and influences cost estimates.',
    connections: [3],
    data: {
      factors: ['Goal Complexity', 'Required Capabilities', 'Expected Interactions'],
      score: 7.5,
      algorithm: 'Weighted sum with normalization'
    }
  },
  {
    id: 3,
    title: 'Generate Pilot Workflow',
    subsystem: 'pilot',
    description: 'AI Orchestrator (using GPT-4o Mini with Claude Sonnet 4 fallback) analyzes user goal and auto-generates a multi-step Pilot workflow. Process: (1) Parse goal into required capabilities, (2) Identify data sources and transformations needed, (3) Generate step sequence with 4 types: llm_decision (AI reasoning), transform (data manipulation), conditional (branching logic), api_call (external integration). Each step gets: operation name, input/output mappings, tool requirements, error handling. (4) Workflow validated against schema - if validation fails, retry with Claude Sonnet 4. (5) GPT-4o Mini provides 97% cost savings (~$0.001 vs ~$0.03 per agent). Workflow stored in agent.pilot_steps (JSON array). This eliminates manual workflow creation.',
    connections: [4],
    data: {
      steps_generated: 12,
      step_types: ['llm_decision', 'transform', 'conditional', 'api_call'],
      workflow_complexity: 'medium',
      primary_generator: 'gpt-4o-mini',
      fallback_generator: 'claude-sonnet-4',
      cost_savings: '97%',
      validation: 'schema checked',
      auto_mapped: 'inputs/outputs between steps'
    }
  },
  {
    id: 4,
    title: 'Store Agent Config',
    subsystem: 'database',
    description: 'DatabaseService persists complete agent configuration to PostgreSQL (Supabase): (1) INSERT into agents table with columns: id (uuid), user_id (fk), agent_name, description, user_prompt, ais_score (decimal), pilot_enabled (boolean), pilot_steps (jsonb array), plugins_required (text array), input_schema (jsonb), output_schema (jsonb), mode (enum: on_demand|scheduled), created_at, updated_at. (2) Pilot_steps stored as JSONB for efficient querying and indexing. (3) Database enforces foreign key constraints and validates schema on insert. Transaction ensures atomicity - if storage fails, entire agent creation rolls back.',
    connections: [5],
    data: {
      table: 'agents',
      ais: 7.5,
      pilot_enabled: true,
      pilot_steps: 12,
      storage_format: 'JSONB',
      transaction: 'atomic'
    }
  },
  {
    id: 5,
    title: 'Audit: Agent Created',
    subsystem: 'audit',
    description: 'AuditService logs immutable audit record for SOC2 compliance: (1) INSERT into audit_logs table with: event_type="AGENT_CREATED", severity="info", user_id, agent_id, timestamp (ISO 8601), metadata (jsonb containing: agent_name, ais_score, pilot_enabled, plugins_required). (2) Audit logs are append-only (no updates/deletes) for tamper-proof compliance. (3) Indexed by user_id, agent_id, timestamp for efficient compliance reporting. (4) Log retention: 7 years per SOC2 requirements. (5) Includes request context: IP address, user agent, session ID for security audit trail.',
    connections: [6],
    data: {
      event: 'AGENT_CREATED',
      severity: 'info',
      retention: '7 years',
      immutable: true,
      indexed: ['user_id', 'agent_id', 'timestamp']
    }
  },

  // Phase 2: Execution Start
  {
    id: 6,
    title: 'User Runs Agent',
    subsystem: 'execution',
    description: 'User initiates agent execution via UI or API: (1) Frontend POST request to /api/run-agent with payload: agent_id, input_data (user-provided context/variables), execution_mode (sync|async). (2) Backend validates: agent exists, user has permissions, required plugins are connected, input_data matches agent.input_schema. (3) Creates execution_id (uuid) for tracking. (4) If scheduled agent: cron job triggers automatically based on schedule. (5) Request queued if system under load (>95% capacity). (6) Returns execution_id immediately for async mode, waits for completion in sync mode.',
    connections: [7],
    data: {
      action: 'run_agent',
      context: 'Process 150 orders',
      endpoint: 'POST /api/run-agent',
      mode: 'async',
      validation: 'permissions + schema + plugins'
    }
  },
  {
    id: 7,
    title: 'Pilot Executor Initializes',
    subsystem: 'pilot',
    description: 'StepExecutor class initializes execution environment: (1) Loads agent.pilot_steps array from database, (2) Creates execution_context object to store intermediate step results, (3) Initializes step_index=0, (4) Validates all required plugins are connected, (5) Prepares tool registry for plugin actions. Execution mode is sequential - each step must complete before next begins. Context persists across all steps, allowing data flow: step N outputs become step N+1 inputs.',
    connections: [8],
    data: {
      total_steps: 12,
      execution_mode: 'sequential',
      initial_context: 'Order data: 150 items',
      context_keys: ['user_input', 'step_results', 'execution_metadata'],
      plugin_registry: 'validated'
    }
  },
  {
    id: 8,
    title: 'Create Execution Record',
    subsystem: 'database',
    description: 'DatabaseService creates execution tracking record: (1) INSERT into executions table with columns: id (execution_id uuid), agent_id (fk), user_id (fk), status (enum: running|completed|failed|cancelled), total_steps (integer from pilot_steps.length), current_step_index (integer, starts at 0), input_data (jsonb), result (jsonb, null initially), total_tokens (integer, 0 initially), total_cost (decimal, 0.0 initially), started_at (timestamp), completed_at (timestamp, null initially), error_message (text, null). (2) Status indexed for monitoring queries. (3) Record updated throughout execution with real-time progress, token consumption, and costs.',
    connections: [9],
    data: {
      table: 'executions',
      status: 'running',
      total_steps: 12,
      current_step_index: 0,
      real_time_updates: true
    }
  },
  {
    id: 9,
    title: 'Audit: Execution Started',
    subsystem: 'audit',
    description: 'AuditService logs execution initiation: (1) INSERT into audit_logs with event_type="EXECUTION_STARTED", severity="info", execution_id, agent_id, user_id. (2) Metadata includes: input_data_hash (SHA-256 for data integrity verification), total_steps, execution_mode (sync|async), triggered_by (user|schedule|api). (3) Timestamp marks official start for SLA tracking. (4) This log enables compliance auditors to trace: who executed what agent, when, and with what inputs. (5) Cross-referenced with execution record for complete audit trail.',
    connections: [10],
    data: {
      event: 'EXECUTION_STARTED',
      severity: 'info',
      data_integrity: 'SHA-256 hash',
      compliance: 'SLA tracking enabled'
    }
  },

  // Phase 3: Step Execution (Loop)
  {
    id: 10,
    title: 'Pilot Step: Load Context',
    subsystem: 'pilot',
    description: 'StepExecutor prepares context for current Pilot step: (1) Loads step definition from agent.pilot_steps[current_index] containing: operation, step_type, input_mappings, output_mappings, required_tools. (2) Resolves input_mappings by querying execution_context for previous step outputs (e.g., "customer_id": "step_2.output.id"). (3) Builds prompt context string by concatenating: user_input, resolved variables, step-specific instructions. (4) Validates all required inputs are present, throws error if missing. (5) Calculates context_size in tokens using tiktoken library. (6) If context exceeds model limit, truncates oldest conversation history first.',
    connections: [11],
    data: {
      step_index: 3,
      step_type: 'llm_decision',
      inputs_mapped: ['customer_id', 'order_data'],
      context_size: '1,200 tokens',
      mapping_resolver: 'execution_context query',
      validation: 'required inputs check'
    }
  },
  {
    id: 11,
    title: 'Load Memory Context',
    subsystem: 'memory',
    description: 'MemoryService retrieves agent-specific learned patterns from agent_memories table: (1) Query filters by: agent_id, memory_type IN ("routing_pattern", "execution_outcome", "user_preference"), importance >= 5 (high priority memories). (2) ORDER BY importance DESC, last_accessed_at DESC LIMIT 10 to get most relevant memories. (3) Returns structured data: routing patterns (tier recommendations + success rates), execution outcomes (previous results + accuracy metrics), user preferences (response style, verbosity). (4) Each memory includes: confidence score (0-1), last_updated timestamp, access_count (popularity tracking). (5) Stale memories (>30 days unused) are weighted lower. (6) Memories injected into LLM context to improve decision-making.',
    connections: [12],
    data: {
      memories: [
        'routing_pattern: Use tier2 for llm_decision',
        'execution_outcome: Previous success with 95% accuracy',
        'user_preference: Concise responses'
      ],
      query: 'agent_id + memory_type + importance>=5',
      limit: 10,
      ordering: 'importance DESC, last_accessed DESC'
    }
  },
  {
    id: 12,
    title: 'Analyze Step Complexity',
    subsystem: 'routing',
    description: 'TaskComplexityAnalyzer (TCA) evaluates 6 weighted factors for the current Pilot step to determine optimal model tier: (1) Prompt Length - measures input size, (2) Data Size - evaluates structured data volume, (3) Reasoning Depth - assesses logical complexity, (4) Condition Count - counts branching logic, (5) Context Depth - measures conversation history, (6) Output Complexity - evaluates response requirements. Each factor scores 0-1, combined into a final complexity score (0-10) using weighted averaging. Score determines tier: 0-3→tier1(haiku), 3-7→tier2(sonnet), 7-10→tier3(opus).',
    connections: [13],
    data: {
      factors: {
        'Prompt Length': 0.35,
        'Data Size': 0.25,
        'Reasoning Depth': 0.75,
        'Condition Count': 0.50,
        'Context Depth': 0.33,
        'Output Complexity': 0.60
      },
      score: 4.95,
      step_type: 'llm_decision',
      recommended_tier: 'tier2 (sonnet)'
    }
  },
  {
    id: 13,
    title: 'Check Routing Memory',
    subsystem: 'memory',
    description: 'Query agent_memories table for learned routing patterns specific to this step type and agent. System retrieves historical routing decisions filtered by: agent_id, memory_type="routing_pattern", step_type. Returns pattern confidence level (0-1) based on execution count: low(<3), medium(3-10), high(10+). High confidence patterns (>0.7 success rate) can override complexity-based routing. Memory includes success_rate (0-1) and total_runs for statistical significance.',
    connections: [14],
    data: {
      found: true,
      pattern: 'tier2',
      confidence: 'high',
      successRate: 0.92,
      total_runs: 15,
      query: 'agent_id + step_type + memory_type'
    }
  },
  {
    id: 14,
    title: 'Intelligent Routing Decision',
    subsystem: 'routing',
    description: 'IntelligentRoutingEngine makes final tier selection using a decision hierarchy: (1) Check routing memory - if high confidence (≥10 runs) AND success_rate>0.7, use learned pattern (MEMORY OVERRIDE), (2) Otherwise use complexity score from TCA. Memory override saves costs by selecting proven efficient tiers. Decision is logged to routing_history for future learning. Final output: selected tier + specific model (e.g., tier2→claude-3-5-haiku-20241022).',
    connections: [15],
    data: {
      decision: 'MEMORY OVERRIDE',
      selectedTier: 'tier2',
      model: 'claude-3-5-haiku-20241022',
      reason: 'Historical: 92% success, 65% cost savings',
      decision_path: 'memory_confidence > complexity_analysis'
    }
  },
  {
    id: 15,
    title: 'Execute Pilot Step',
    subsystem: 'pilot',
    description: 'StepExecutor runs the Pilot step using selected model and routing decision: (1) For llm_decision steps: Call Anthropic API with model (e.g., claude-3-5-haiku-20241022), system prompt, user context, tools (if plugin actions required). (2) For transform steps: Execute data transformation logic (JS eval in sandboxed environment). (3) For conditional steps: Evaluate boolean expression to determine branch path. (4) For api_call steps: Execute HTTP request to external API with auth headers. (5) Tool use: If LLM requests tool calls, execute plugin actions (e.g., read_database, send_email) and feed results back to LLM. (6) Track metrics: input_tokens, output_tokens, execution_time_ms, cost (calculated from token usage). (7) Handle errors with retry logic (exponential backoff, max 3 retries).',
    connections: [16],
    data: {
      model: 'claude-3-5-haiku-20241022',
      step_result: 'Customer classification completed',
      tool_calls: 2,
      tokens: 800,
      executionTime: '1,250ms',
      retry_logic: 'exponential backoff, max 3',
      tool_sandbox: 'isolated execution'
    }
  },
  {
    id: 16,
    title: 'Record Routing Decision',
    subsystem: 'database',
    description: 'DatabaseService persists routing decision for analytics and learning: (1) INSERT into pilot_step_routing_history table with: execution_id, step_index, agent_id, selected_tier, selected_model, complexity_score (from TCA), routing_source (enum: complexity|routing_memory|override), confidence_score (if memory used), decision_factors (jsonb: all 6 TCA factors), timestamp. (2) This table enables: ML model training on routing patterns, cost analysis per tier, success rate tracking by complexity band. (3) Indexed by agent_id + step_index for fast pattern queries. (4) Used by LearningEngine to update routing memory after step completion. (5) Data retained indefinitely for continuous learning improvement.',
    connections: [17],
    data: {
      tables: ['pilot_step_routing_history', 'audit_logs'],
      routing_source: 'routing_memory',
      indexed: ['agent_id', 'step_index'],
      retention: 'indefinite',
      ml_training: true
    }
  },
  {
    id: 17,
    title: 'Audit: Routing Decision',
    subsystem: 'audit',
    description: 'AuditService logs routing decision for transparency and compliance: (1) INSERT into audit_logs with event_type="PILOT_ROUTING_DECISION", severity="debug", execution_id, agent_id, step_index. (2) Metadata contains complete decision context: selected_tier, selected_model, complexity_score (0-10), all 6 TCA factors with individual scores, routing_source (complexity|memory|override), memory_confidence (if applicable), override_reason (if manual). (3) Enables compliance review: verify routing decisions are optimal and not wasteful. (4) Used for cost optimization audits: identify agents consistently routed to expensive tiers. (5) Supports appeals: users can request manual review if routing seems incorrect.',
    connections: [18],
    data: {
      event: 'PILOT_ROUTING_DECISION',
      tier: 'tier2',
      complexity: 4.95,
      step_index: 3,
      transparency: 'full decision context',
      compliance_review: true
    }
  },
  {
    id: 18,
    title: 'Learn from Execution',
    subsystem: 'memory',
    description: 'LearningEngine updates routing patterns using Exponential Moving Average (EMA) algorithm with α=0.3 smoothing factor. Formula: new_success_rate = α × current_outcome + (1-α) × old_success_rate. This balances recent performance with historical data. System also increments execution_count and recalculates confidence level. Confidence formula: min(execution_count / 10, 1.0). Patterns with confidence ≥0.7 become eligible for memory override. Learning creates a continuous improvement cycle where the system becomes more efficient over time.',
    connections: [19],
    data: {
      algorithm: 'Exponential Moving Average (α=0.3)',
      formula: 'new = 0.3×current + 0.7×old',
      updated: 'successRate: 0.92 → 0.946',
      confidence: '1.0 (high)',
      memory_type: 'routing_pattern',
      execution_count: '15 → 16'
    }
  },
  {
    id: 19,
    title: 'Update Agent Memory',
    subsystem: 'database',
    description: 'DatabaseService persists updated learned pattern: (1) UPSERT (INSERT ON CONFLICT UPDATE) into agent_memories table using composite key: agent_id + memory_type + memory_key (e.g., "llm_decision_tier"). (2) Updates columns: memory_value (jsonb containing: success_rate, execution_count, cost_savings, selected_tier), confidence_score (0-1), importance (0-10, calculated from success_rate × execution_count), last_accessed_at (current timestamp), access_count (incremented), updated_at. (3) UPSERT ensures: new patterns inserted, existing patterns updated without duplicates. (4) Importance index enables fast high-priority memory retrieval. (5) Old low-importance memories (<3, unused >90 days) periodically archived for database performance.',
    connections: [20],
    data: {
      table: 'agent_memories',
      memory_type: 'routing_pattern',
      importance: 9,
      operation: 'UPSERT',
      composite_key: 'agent_id + memory_type + memory_key',
      archival: 'importance<3 AND unused>90d'
    }
  },
  {
    id: 20,
    title: 'Pilot Step Complete',
    subsystem: 'pilot',
    description: 'StepExecutor finalizes current step and prepares for next: (1) Extracts structured outputs from step result using output_mappings defined in pilot_steps (e.g., "customer_category": "response.category"). (2) Stores outputs in execution_context object with key pattern: step_{index}.output.{field_name} (e.g., "step_3.output.customer_category": "premium"). (3) Updates execution record: current_step_index++, step_results array (append current step metrics), total_tokens += step_tokens, total_cost += step_cost. (4) Determines next step: if conditional branch taken, skip to branch target index, otherwise increment by 1. (5) If all steps complete, exits loop to finalization phase.',
    connections: [21],
    data: {
      step_completed: '3/12',
      outputs_stored: ['customer_category', 'priority_level'],
      next_step: 'Transform Data (step 4)',
      context_key_pattern: 'step_{index}.output.{field}',
      branching: 'conditional aware'
    }
  },
  {
    id: 21,
    title: 'Audit: Step Completed',
    subsystem: 'audit',
    description: 'AuditService logs step completion with performance metrics: (1) INSERT into audit_logs with event_type="PILOT_STEP_COMPLETED", severity="debug", execution_id, agent_id, step_index. (2) Metadata includes: step_type (llm_decision|transform|conditional|api_call), selected_model, input_tokens, output_tokens, total_tokens, execution_time_ms, cost_usd, success (boolean), error_message (if failed), tool_calls_count, outputs_generated (array of field names). (3) Enables performance monitoring: identify slow steps, expensive steps, high-failure steps. (4) Cost tracking: aggregate token usage per step type for billing accuracy. (5) Debugging: trace execution flow and identify bottlenecks or errors.',
    connections: [22],
    data: {
      event: 'PILOT_STEP_COMPLETED',
      step_index: 3,
      tokens: 800,
      duration: '1,250ms',
      cost: '$0.0012',
      performance_tracking: true
    }
  },

  // Conditional Logic Example
  {
    id: 22,
    title: 'Pilot Conditional Step',
    subsystem: 'pilot',
    description: 'StepExecutor evaluates conditional branching logic for workflow control: (1) Loads condition definition from pilot_steps: condition_expression (JS expression string), true_branch (next step index if true), false_branch (next step index if false). (2) Resolves variables in expression from execution_context (e.g., "priority_level == \'high\'" becomes "premium == \'high\'"). (3) Safely evaluates expression in sandboxed VM2 environment to prevent code injection. (4) Based on boolean result: updates next_step_index to appropriate branch target. (5) Logs branching decision to audit trail for workflow traceability. (6) Conditionals enable dynamic workflows: skip unnecessary steps, implement error handling branches, create parallel processing paths.',
    connections: [23],
    data: {
      condition: 'if priority_level == "high"',
      evaluation: true,
      branch_taken: 'high_priority_path',
      skip_steps: [5, 6],
      sandbox: 'VM2 isolated execution',
      branching_options: ['true_branch', 'false_branch']
    }
  },

  // Phase 4: Workflow Completion
  {
    id: 23,
    title: 'All Pilot Steps Complete',
    subsystem: 'pilot',
    description: 'StepExecutor finalizes workflow execution after all steps complete: (1) Aggregates metrics from all executed steps: total_steps_executed (count of steps run), steps_skipped (from conditional branches), total_tokens (sum of all step tokens), total_duration_ms (sum of step execution times), total_cost_usd (sum of step costs). (2) Builds final result object by extracting output_schema fields from execution_context (e.g., if output_schema requires "customer_list", extract step_12.output.customers). (3) Validates final outputs against agent.output_schema - if validation fails, marks execution as failed. (4) Calculates efficiency metrics: tokens per step, cost per step, avg execution time. (5) Prepares summary for user display and database storage.',
    connections: [24],
    data: {
      total_steps_executed: 12,
      steps_skipped: 2,
      total_tokens: 12500,
      total_duration: '18,750ms',
      total_cost: '$0.0185',
      validation: 'output_schema checked'
    }
  },
  {
    id: 24,
    title: 'Execution Complete',
    subsystem: 'execution',
    description: 'ExecutionManager marks execution as complete: (1) Determines final status: "completed" (all steps succeeded), "partial_success" (some steps failed but workflow continued), "failed" (critical error stopped execution). (2) For sync mode: immediately returns result to API caller with status code (200/207/500). (3) For async mode: triggers webhook notification if configured (POST to user_webhook_url with execution_id + status + result). (4) Releases execution resources: clears execution_context from memory, closes plugin connections, cancels any pending timers. (5) Triggers downstream actions: scheduled reports, email notifications, webhook deliveries based on agent configuration.',
    connections: [25],
    data: {
      status: 'completed',
      totalTokens: 12500,
      duration: '18,750ms',
      cost: '$0.0185',
      webhook: 'triggered if configured',
      resources: 'released'
    }
  },
  {
    id: 25,
    title: 'Store Execution Outcome',
    subsystem: 'database',
    description: 'DatabaseService persists final execution outcome to multiple tables: (1) UPDATE executions table: status="completed", result (jsonb with all output fields), total_tokens, total_cost, completed_at (timestamp), error_message (if applicable). (2) INSERT into agent_memories with memory_type="execution_outcome": stores summarized result + success metrics for future context. Memory importance calculated from: execution success (binary) + result quality (if measurable) + cost efficiency. (3) If execution failed: stores error patterns for failure prevention learning. (4) Execution history enables: trend analysis (success rates over time), cost forecasting, failure pattern detection.',
    connections: [26],
    data: {
      tables: ['executions', 'agent_memories'],
      success: true,
      result_summary: 'Processed 150 orders, 148 successful',
      memory_importance: 8,
      operations: ['UPDATE executions', 'INSERT agent_memories']
    }
  },
  {
    id: 26,
    title: 'Audit: Execution Completed',
    subsystem: 'audit',
    description: 'AuditService logs final execution completion for compliance and analysis: (1) INSERT into audit_logs with event_type="EXECUTION_COMPLETED", severity="info", execution_id, agent_id, user_id. (2) Comprehensive metadata: final_status (completed|partial_success|failed), total_steps_executed, steps_skipped, total_tokens (input + output), total_cost_usd, execution_duration_ms, success_rate (successful_steps / total_steps), result_hash (SHA-256 for data integrity), error_count. (3) Enables compliance reporting: demonstrate agent performed as intended, track resource consumption, verify no unauthorized actions. (4) Business intelligence: aggregate execution metrics for ROI analysis, identify high-performing agents, optimize resource allocation.',
    connections: [27],
    data: {
      event: 'EXECUTION_COMPLETED',
      metrics: 'tokens: 12,500 | cost: $0.0185',
      success_rate: '98.7%',
      result_hash: 'SHA-256',
      compliance: 'full traceability'
    }
  },
  {
    id: 27,
    title: 'Aggregate Analytics',
    subsystem: 'analytics',
    description: 'AnalyticsService updates real-time metrics cache for dashboard display: (1) Increments analytics_cache counters: total_executions, successful_executions, total_tokens, total_cost. (2) Calculates rolling averages (30-day window): avg_tokens_per_execution, avg_cost_per_execution, avg_execution_duration, success_rate_percentage. (3) Updates per-agent metrics: agent_execution_count, agent_total_tokens, agent_success_rate for leaderboard rankings. (4) Computes cost efficiency: compare actual cost (using routing) vs baseline_cost (if all tier3), calculate percentage savings. (5) Memory override statistics: count steps where routing_source="routing_memory", calculate override_success_rate. (6) Triggers materialized view refresh for complex analytics queries. (7) Data cached in Redis with 5-minute TTL for fast dashboard loading.',
    connections: [],
    data: {
      metrics: [
        'Token efficiency: +35% (vs baseline)',
        'Cost savings: 42% (vs all tier3)',
        'Memory overrides: 8/12 steps (67%)',
        'Avg step complexity: 4.8',
        'Routing accuracy: 100%'
      ],
      cache: 'Redis 5min TTL',
      rolling_window: '30 days',
      materialized_views: 'refreshed'
    }
  }
];

const SUBSYSTEM_CONFIG = {
  pilot: {
    name: 'Pilot Workflow',
    icon: Workflow,
    color: 'from-cyan-500 to-cyan-700',
    borderColor: 'border-cyan-500',
    textColor: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10'
  },
  ais: {
    name: 'AIS System',
    icon: Brain,
    color: 'from-purple-500 to-purple-700',
    borderColor: 'border-purple-500',
    textColor: 'text-purple-400',
    bgColor: 'bg-purple-500/10'
  },
  memory: {
    name: 'Memory System',
    icon: Lightbulb,
    color: 'from-yellow-500 to-yellow-700',
    borderColor: 'border-yellow-500',
    textColor: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10'
  },
  routing: {
    name: 'Routing Engine',
    icon: GitBranch,
    color: 'from-blue-500 to-blue-700',
    borderColor: 'border-blue-500',
    textColor: 'text-blue-400',
    bgColor: 'bg-blue-500/10'
  },
  execution: {
    name: 'Execution',
    icon: Zap,
    color: 'from-green-500 to-green-700',
    borderColor: 'border-green-500',
    textColor: 'text-green-400',
    bgColor: 'bg-green-500/10'
  },
  audit: {
    name: 'Audit Trail',
    icon: Shield,
    color: 'from-red-500 to-red-700',
    borderColor: 'border-red-500',
    textColor: 'text-red-400',
    bgColor: 'bg-red-500/10'
  },
  analytics: {
    name: 'Analytics',
    icon: BarChart3,
    color: 'from-indigo-500 to-indigo-700',
    borderColor: 'border-indigo-500',
    textColor: 'text-indigo-400',
    bgColor: 'bg-indigo-500/10'
  },
  database: {
    name: 'Database',
    icon: Database,
    color: 'from-slate-500 to-slate-700',
    borderColor: 'border-slate-500',
    textColor: 'text-slate-400',
    bgColor: 'bg-slate-500/10'
  }
};

export default function SystemFlowVisualization() {
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(3000); // ms per step
  const [activeConnections, setActiveConnections] = useState<number[]>([]);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (isPlaying && currentStep < ANIMATION_STEPS.length - 1) {
      const timer = setTimeout(() => {
        const nextStep = currentStep + 1;
        setCurrentStep(nextStep);
        setCompletedSteps(prev => new Set([...prev, currentStep]));

        // Highlight connections
        const step = ANIMATION_STEPS[currentStep];
        setActiveConnections(step.connections);

        // Clear active connections after animation
        setTimeout(() => setActiveConnections([]), speed / 2);
      }, speed);

      return () => clearTimeout(timer);
    } else if (currentStep >= ANIMATION_STEPS.length - 1) {
      setIsPlaying(false);
      setCompletedSteps(prev => new Set([...prev, currentStep]));
    }
  }, [isPlaying, currentStep, speed]);

  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);
  const handleReset = () => {
    setIsPlaying(false);
    setCurrentStep(0);
    setCompletedSteps(new Set());
    setActiveConnections([]);
  };

  const handleStepClick = (stepId: number) => {
    setIsPlaying(false);
    setCurrentStep(stepId);
    const completed = new Set<number>();
    for (let i = 0; i < stepId; i++) {
      completed.add(i);
    }
    setCompletedSteps(completed);
  };

  const step = ANIMATION_STEPS[currentStep];
  const subsystem = SUBSYSTEM_CONFIG[step.subsystem];
  const SubsystemIcon = subsystem.icon;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      {/* Header */}
      <div className="border-b border-slate-700 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-20">
        <div className="max-w-[1800px] mx-auto px-8 py-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                System Flow Visualization
              </h1>
              <p className="text-slate-400">
                Complete integration: Pilot Workflow, AIS, Memory, Routing, Executions, Audit Trail, and Analytics
              </p>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4">
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
              >
                <option value={1000}>Very Fast (1s)</option>
                <option value={2000}>Fast (2s)</option>
                <option value={3000}>Normal (3s)</option>
                <option value={4000}>Slow (4s)</option>
                <option value={5000}>Very Slow (5s)</option>
                <option value={7000}>Ultra Slow (7s)</option>
                <option value={10000}>Presentation (10s)</option>
              </select>

              <button
                onClick={handleReset}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg flex items-center gap-2 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>

              <button
                onClick={isPlaying ? handlePause : handlePlay}
                className={`px-6 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                  isPlaying
                    ? 'bg-orange-600 hover:bg-orange-700'
                    : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-4 h-4" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Play
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-slate-700 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${((currentStep + 1) / ANIMATION_STEPS.length) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-[1800px] mx-auto px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left: Execution Timeline - Full height, no scrolling */}
          <div className="lg:col-span-4">
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
              <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Execution Timeline ({ANIMATION_STEPS.length} Steps)
              </h3>

              <div className="space-y-2">
                {ANIMATION_STEPS.map((s, idx) => {
                  const sConfig = SUBSYSTEM_CONFIG[s.subsystem];
                  const SIcon = sConfig.icon;
                  const isCompleted = completedSteps.has(idx);
                  const isCurrent = idx === currentStep;
                  const isConnected = activeConnections.includes(idx);

                  return (
                    <div
                      key={s.id}
                      onClick={() => handleStepClick(idx)}
                      className={`p-3 rounded-lg border-l-4 cursor-pointer transition-all duration-300 ${
                        isCurrent
                          ? `${sConfig.borderColor} bg-gradient-to-r ${sConfig.bgColor} shadow-lg scale-105`
                          : isCompleted
                          ? 'border-green-500 bg-green-500/10'
                          : isConnected
                          ? `${sConfig.borderColor} ${sConfig.bgColor}`
                          : 'border-slate-700 bg-slate-800/30 hover:bg-slate-700/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-1.5 rounded flex-shrink-0 ${isCompleted ? 'bg-green-600' : isCurrent ? `bg-gradient-to-br ${sConfig.color}` : 'bg-slate-700'}`}>
                          {isCompleted ? (
                            <CheckCircle className="w-4 h-4 text-white" />
                          ) : (
                            <SIcon className="w-4 h-4 text-white" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs text-slate-500">#{s.id}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${sConfig.bgColor} ${sConfig.textColor}`}>
                              {sConfig.name}
                            </span>
                          </div>
                          <h4 className={`text-sm font-medium ${isCurrent ? 'text-white' : 'text-slate-300'}`}>
                            {s.title}
                          </h4>
                          <p className="text-xs text-slate-500 mt-1 line-clamp-2">{s.description}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: Current Step Details + Subsystems */}
          <div className="lg:col-span-8 space-y-6">
            {/* Current Step Card */}
            <div className={`p-6 rounded-xl border-2 ${subsystem.borderColor} ${subsystem.bgColor} shadow-xl`}>
              <div className="flex items-start gap-4 mb-4">
                <div className={`p-3 rounded-xl bg-gradient-to-br ${subsystem.color} shadow-lg`}>
                  <SubsystemIcon className="w-8 h-8 text-white" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm text-slate-400">Step {currentStep + 1} of {ANIMATION_STEPS.length}</span>
                    <span className={`text-xs px-2 py-1 rounded ${subsystem.bgColor} ${subsystem.textColor} font-semibold`}>
                      {subsystem.name}
                    </span>
                  </div>
                  <h2 className="text-2xl font-bold mb-2">{step.title}</h2>
                  <p className="text-slate-300">{step.description}</p>
                </div>
              </div>

              {/* Step Data */}
              {step.data && (
                <div className="mt-4 p-4 bg-slate-900/50 rounded-lg border border-slate-700">
                  <h3 className="text-sm font-semibold text-slate-400 mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Step Data
                  </h3>
                  <div className="space-y-2">
                    {Object.entries(step.data).map(([key, value]) => (
                      <div key={key} className="flex flex-col gap-1">
                        <span className="text-xs text-slate-500 uppercase font-semibold">{key.replace(/_/g, ' ')}</span>
                        {Array.isArray(value) ? (
                          <ul className="text-sm text-slate-300 space-y-1 ml-2">
                            {value.map((item, idx) => (
                              <li key={idx} className="flex items-start gap-2">
                                <ChevronRight className="w-3 h-3 text-slate-500 mt-0.5 flex-shrink-0" />
                                <span>{typeof item === 'object' ? JSON.stringify(item) : item}</span>
                              </li>
                            ))}
                          </ul>
                        ) : typeof value === 'object' ? (
                          <div className="text-sm text-slate-300 ml-2 space-y-1">
                            {Object.entries(value).map(([k, v]) => (
                              <div key={k} className="flex items-center gap-2">
                                <span className="text-slate-500">{k}:</span>
                                <span className="text-white font-mono">{String(v)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-sm text-white font-mono">{String(value)}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Connections */}
              {step.connections.length > 0 && (
                <div className="mt-4 flex items-center gap-2 text-sm text-slate-400">
                  <ArrowRight className="w-4 h-4" />
                  <span>Connects to step{step.connections.length > 1 ? 's' : ''}: {step.connections.map(c => c + 1).join(', ')}</span>
                </div>
              )}
            </div>

            {/* Subsystem Icons Grid */}
            <div>
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5" />
                Subsystems (8 Components)
              </h2>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(SUBSYSTEM_CONFIG).map(([key, config]) => {
                  const Icon = config.icon;
                  const isActive = step.subsystem === key;
                  const activityCount = ANIMATION_STEPS.slice(0, currentStep + 1).filter(s => s.subsystem === key).length;
                  const hasActivity = activityCount > 0;

                  return (
                    <div
                      key={key}
                      className={`p-4 rounded-lg border-2 transition-all duration-300 ${
                        isActive
                          ? `${config.borderColor} ${config.bgColor} shadow-lg scale-105`
                          : hasActivity
                          ? 'border-slate-600 bg-slate-800/50'
                          : 'border-slate-700 bg-slate-800/30 opacity-50'
                      }`}
                    >
                      <div className="flex flex-col items-center gap-3">
                        <div className={`p-3 rounded-lg bg-gradient-to-br ${config.color} relative`}>
                          <Icon className="w-6 h-6 text-white" />
                          {hasActivity && (
                            <div className="absolute -top-1 -right-1 w-5 h-5 bg-slate-900 rounded-full flex items-center justify-center border-2 border-slate-700">
                              <span className="text-xs text-white font-bold">{activityCount}</span>
                            </div>
                          )}
                        </div>
                        <div className="text-center">
                          <h3 className="font-semibold text-white text-sm">{config.name}</h3>
                          {isActive && (
                            <div className="flex items-center justify-center gap-1 text-xs text-slate-400 mt-1">
                              <Activity className="w-3 h-3 animate-pulse" />
                              Active
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
