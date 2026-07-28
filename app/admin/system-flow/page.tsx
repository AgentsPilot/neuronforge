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
  subsystem: 'vocabulary' | 'understanding' | 'grounding' | 'formalization' | 'compilation' | 'validation' | 'execution' | 'database' | 'pilot' | 'routing' | 'memory' | 'audit';
  description: string;
  connections: number[];
  data?: Record<string, any>;
}

const ANIMATION_STEPS: AnimationStep[] = [
  // ============================================================================
  // PHASE 0: USER INPUT & VOCABULARY EXTRACTION
  // ============================================================================
  {
    id: 1,
    title: 'User Creates Agent',
    subsystem: 'execution',
    description: 'User accesses the Agent Builder UI (/v2/agents/new) and provides their automation goal in natural language. The conversational creation flow guides users through: (1) Describing what they want to automate, (2) Connecting required plugins (Google Sheets, Gmail, Slack, etc.), (3) Answering clarifying questions. The system collects: agent_name, user_prompt, connected_plugins, user_context. This triggers the V6 semantic agent generation pipeline.',
    connections: [2],
    data: {
      endpoint: 'POST /api/v6/generate-ir-intent-contract',
      input: 'Goal: Summarize my Gmail emails and save to Google Sheets',
      connected_plugins: ['google-mail', 'google-sheets'],
      pipeline_version: 'V6 Semantic'
    }
  },
  {
    id: 2,
    title: 'Plugin Vocabulary Extraction',
    subsystem: 'vocabulary',
    description: 'PluginVocabularyExtractor loads schemas for all connected plugins: (1) Reads plugin definitions from lib/plugins/definitions/*.json, (2) Extracts available actions (search_emails, read_range, append_rows, etc.), (3) Extracts input/output parameter schemas for each action, (4) Builds a "vocabulary" the LLM can use to understand available capabilities. This vocabulary is injected into subsequent LLM prompts to ensure the AI only uses valid plugin operations.',
    connections: [3],
    data: {
      plugins_loaded: ['google-mail', 'google-sheets'],
      actions_extracted: ['search_emails', 'read_range', 'append_rows', 'write_range'],
      output_schemas: 'Extracted for filter field validation',
      vocabulary_tokens: '~2,000 tokens injected'
    }
  },
  {
    id: 3,
    title: 'Hard Requirements Extraction',
    subsystem: 'vocabulary',
    description: 'HardRequirementsExtractor analyzes the Enhanced Prompt to identify non-negotiable constraints that MUST be preserved throughout the pipeline: (1) Unit of work (per-email, per-row, batch), (2) Thresholds (e.g., "only emails from last 7 days"), (3) Routing rules (e.g., "if priority=high then notify"), (4) Invariants (e.g., "never delete original data"). These requirements are embedded in every subsequent phase to prevent the LLM from "forgetting" critical constraints.',
    connections: [4],
    data: {
      unit_of_work: 'per_email',
      thresholds: ['newer_than:7d'],
      routing_rules: ['if attachment exists → process attachment'],
      invariants: ['preserve original email metadata'],
      propagation: 'Phase 0 → Phase 1 → Phase 3 → Phase 4'
    }
  },

  // ============================================================================
  // PHASE 1: SEMANTIC UNDERSTANDING
  // ============================================================================
  {
    id: 4,
    title: 'Semantic Plan Generation',
    subsystem: 'understanding',
    description: 'SemanticPlanGenerator uses Claude Opus 4.5 to deeply understand user intent WITHOUT being forced to produce precise executable code. This "understanding phase" focuses on: (1) Identifying what the user really wants, (2) Making assumptions explicit (e.g., "I assume emails means Gmail inbox"), (3) Expressing uncertainty about ambiguous requirements, (4) Reasoning about the workflow structure. Output is a SemanticPlan with assumptions, ambiguities, inferences, and reasoning chains.',
    connections: [5],
    data: {
      model: 'claude-opus-4-5-20251101',
      temperature: 0.3,
      output_format: 'SemanticPlan JSON',
      key_sections: ['assumptions', 'ambiguities', 'inferences', 'data_understanding', 'workflow_structure'],
      focus: 'Understanding, NOT code generation'
    }
  },
  {
    id: 5,
    title: 'Identify Assumptions',
    subsystem: 'understanding',
    description: 'The SemanticPlan contains explicit assumptions the LLM made about the user\'s intent. Each assumption has: (1) A unique ID, (2) Category (field_name, data_type, value_format, structure, behavior), (3) Description (what was assumed), (4) Impact if wrong (critical, recoverable, cosmetic), (5) Validation strategy (how to verify), (6) Fallback action (what to do if wrong). Example: "Assuming email column exists and contains email addresses".',
    connections: [6],
    data: {
      assumption_categories: ['field_name', 'data_type', 'value_format', 'structure', 'behavior'],
      example_assumption: {
        id: 'email_field_exists',
        description: 'Column "Email" exists in Google Sheets',
        impact_if_wrong: 'critical',
        validation_strategy: 'field_match with fuzzy matching'
      },
      total_assumptions: 5
    }
  },
  {
    id: 6,
    title: 'Semantic Skeleton Generation',
    subsystem: 'understanding',
    description: 'SemanticSkeletonGenerator (if enabled via V6_SEMANTIC_SKELETON_ENABLED) creates a structural blueprint of the workflow: (1) Goal summary, (2) Unit of work (what gets processed as one item), (3) Loop structure (nested loops for iteration), (4) Conditional logic (if/then/else branches), (5) Collection points (where to aggregate results), (6) Flow outline (ordered list of high-level steps). This skeleton guides the IR Formalization phase to produce correct control flow.',
    connections: [7],
    data: {
      goal: 'Summarize Gmail emails and save to Google Sheets',
      unit_of_work: 'per_email',
      loop_structure: [
        { level: 1, over: 'emails', collect_results: true }
      ],
      flow_outline: [
        '1. Fetch emails from Gmail',
        '2. For each email: extract summary',
        '3. Collect summaries',
        '4. Write to Google Sheets'
      ]
    }
  },

  // ============================================================================
  // PHASE 2: GROUNDING (Data Validation)
  // ============================================================================
  {
    id: 7,
    title: 'Grounding Engine Initialization',
    subsystem: 'grounding',
    description: 'GroundingEngine validates SemanticPlan assumptions against REAL data source metadata. For tabular data (Google Sheets, Airtable), it receives actual column headers and sample rows. For API data (Gmail, Slack), it receives output field schemas. Grounding prevents the LLM from "hallucinating" field names that don\'t exist. Configuration: min_confidence (0.7), fail_fast (false), max_candidates (3).',
    connections: [8],
    data: {
      data_source_metadata: {
        type: 'tabular',
        headers: ['Name', 'Email Address', 'Status', 'Created At'],
        sample_rows: 5
      },
      config: {
        min_confidence: 0.7,
        fail_fast: false,
        max_candidates: 3
      }
    }
  },
  {
    id: 8,
    title: 'Field Name Validation',
    subsystem: 'grounding',
    description: 'FieldMatcher uses fuzzy matching algorithms to validate field_name assumptions: (1) Exact match (Email === Email), (2) Case-insensitive match (email === Email), (3) Separator normalization (email_address ≈ Email Address), (4) Levenshtein distance for typos, (5) Semantic matching with field descriptions. Returns: matched (boolean), actual_field_name (corrected name), confidence (0-1), match_method (exact|fuzzy|semantic).',
    connections: [9],
    data: {
      assumption: 'Email field exists',
      candidates_tried: ['Email', 'email', 'email_address'],
      match_result: {
        matched: true,
        actual_field_name: 'Email Address',
        confidence: 0.92,
        match_method: 'semantic (via description)'
      }
    }
  },
  {
    id: 9,
    title: 'Data Type Validation',
    subsystem: 'grounding',
    description: 'DataSampler analyzes sample data to validate data_type assumptions: (1) Samples up to 10 values from the column, (2) Detects actual data type (string, number, date, email, boolean), (3) For email fields: validates with RFC 5322 regex pattern, (4) For date fields: detects format (ISO 8601, US, EU), (5) Calculates type consistency percentage. Validation fails if <80% of values match expected type.',
    connections: [10],
    data: {
      field: 'Email Address',
      expected_type: 'email',
      sample_size: 10,
      validation_result: {
        actual_type: 'email',
        format_match_rate: 0.95,
        invalid_values: ['N/A', 'pending'],
        validated: true
      }
    }
  },
  {
    id: 10,
    title: 'Grounded Semantic Plan',
    subsystem: 'grounding',
    description: 'GroundingEngine produces a GroundedSemanticPlan with validation results: (1) grounded: true (grounding completed), (2) grounding_results (array of validation results per assumption), (3) grounding_errors (any assumptions that failed), (4) grounding_confidence (geometric mean of all validations), (5) validated_assumptions_count / total_assumptions_count. If >50% of assumptions skipped, grounding fails. Grounded facts (resolved field names, validated types) propagate to IR Formalization.',
    connections: [11],
    data: {
      grounded: true,
      grounding_confidence: 0.89,
      validated_count: 4,
      skipped_count: 1,
      grounding_results: [
        { assumption_id: 'email_field', validated: true, resolved_value: 'Email Address' },
        { assumption_id: 'status_field', validated: true, resolved_value: 'Status' }
      ]
    }
  },

  // ============================================================================
  // PHASE 3: IR FORMALIZATION (Enhanced Prompt → Declarative IR)
  // ============================================================================
  {
    id: 11,
    title: 'IR Formalizer Initialization',
    subsystem: 'formalization',
    description: 'IRFormalizer prepares to convert the Enhanced Prompt + Grounded Semantic Plan into precise, executable Declarative IR v4.0. This is the FORMALIZATION phase - mechanical mapping, not understanding. The formalizer loads: (1) System prompt from formalization-system-v4.md, (2) Plugin schemas for parameter validation, (3) Resolved user inputs (literal values, not variables), (4) Hard requirements for enforcement tracking.',
    connections: [12],
    data: {
      ir_version: '4.0',
      model: 'gpt-5.2 or claude-opus-4-5',
      temperature: 0.1,
      system_prompt: 'formalization-system-v4.md',
      inputs: ['Enhanced Prompt', 'Grounded Semantic Plan', 'Plugin Schemas', 'Hard Requirements']
    }
  },
  {
    id: 12,
    title: 'Build Formalization Request',
    subsystem: 'formalization',
    description: 'IRFormalizer constructs a comprehensive prompt for IR generation: (1) Enhanced Prompt sections (data, actions, output, delivery, processing_steps), (2) Available plugins with action schemas and OUTPUT FIELDS (critical for filter field names), (3) Resolved user inputs (use literal values, NOT variables), (4) Hard requirements formatted with HardRequirementsFormatter, (5) Semantic structure from skeleton (if enabled). The prompt instructs the LLM to use EXACT field names from plugin output schemas.',
    connections: [13],
    data: {
      prompt_sections: [
        '## Data Sources (from Enhanced Prompt)',
        '## Actions & Logic',
        '## Available Plugins (with Output Fields)',
        '## Resolved User Inputs (USE LITERAL VALUES)',
        '## Hard Requirements (MUST ENFORCE)'
      ],
      critical_instruction: 'Use EXACT field names from Output Fields in filters',
      estimated_tokens: '~4,000 input tokens'
    }
  },
  {
    id: 13,
    title: 'Generate Declarative IR v4.0',
    subsystem: 'formalization',
    description: 'LLM generates the Declarative IR v4.0 execution graph: (1) execution_graph.nodes (operation nodes: fetch, transform, ai, deliver), (2) execution_graph.edges (data flow connections), (3) execution_graph.variables (typed variable declarations), (4) requirements_enforcement (tracking of hard requirement enforcement). For loops: nodes have loop_config with item_variable and collect_outputs. For conditionals: nodes have conditional_config with condition expression.',
    connections: [14],
    data: {
      ir_structure: {
        ir_version: '4.0',
        goal: 'Summarize emails and save to sheets',
        execution_graph: {
          entry_node: 'fetch_emails',
          nodes: { /* 6 operation nodes */ },
          edges: [ /* data flow connections */ ],
          variables: [ /* typed declarations */ ]
        }
      },
      node_types: ['fetch', 'transform', 'ai', 'deliver'],
      control_flow: ['loops', 'conditionals', 'parallel']
    }
  },
  {
    id: 14,
    title: 'Plugin Parameter Validation',
    subsystem: 'formalization',
    description: 'PluginParameterValidator checks generated IR against actual plugin schemas: (1) Validates operation_type matches available actions, (2) Validates config parameters use EXACT names from schema (e.g., "range" not "sheet_name"), (3) Auto-corrects common LLM errors (numeric strings → numbers), (4) Validates required parameters are present. Logs corrections and errors for debugging.',
    connections: [15],
    data: {
      validation_checks: [
        'operation_type exists in plugin actions',
        'config parameter names match schema',
        'required parameters present',
        'type coercion (string → number)'
      ],
      auto_corrections: 2,
      validation_errors: 0
    }
  },
  {
    id: 15,
    title: 'IR Structure Validation',
    subsystem: 'formalization',
    description: 'Comprehensive IR validation catches LLM generation errors before compilation: (1) Schema validation (JSON schema compliance), (2) Execution graph validation (no cycles, valid edges), (3) Field reference validation (fields exist in plugin schemas), (4) Type consistency validation (operations receive correct types), (5) Requirement enforcement validation (hard requirements enforced). Failed validation triggers retry with error feedback.',
    connections: [16],
    data: {
      validators: [
        'ExecutionGraphValidator',
        'FieldReferenceValidator',
        'TypeConsistencyValidator',
        'RequirementEnforcementValidator'
      ],
      validation_result: 'PASSED',
      formalization_confidence: 0.95
    }
  },

  // ============================================================================
  // PHASE 4: COMPILATION (IR → PILOT DSL)
  // ============================================================================
  {
    id: 16,
    title: 'Execution Graph Compiler',
    subsystem: 'compilation',
    description: 'ExecutionGraphCompiler transforms Declarative IR v4.0 into PILOT DSL (the runtime format): (1) Walks execution graph in topological order (respecting data dependencies), (2) Compiles each node to a PILOT step: action (plugin calls), llm_decision (AI reasoning), transform (data manipulation), conditional (branching). (3) Resolves variable references ({{var.field}} → actual values), (4) Generates scatter-gather for parallel execution nodes.',
    connections: [17],
    data: {
      input: 'Declarative IR v4.0 execution_graph',
      output: 'PILOT DSL pilot_steps array',
      compilation_order: 'topological (respects data deps)',
      step_types: ['action', 'llm_decision', 'transform', 'conditional', 'parallel']
    }
  },
  {
    id: 17,
    title: 'Compile Fetch Operations',
    subsystem: 'compilation',
    description: 'For each fetch node in IR: (1) Create PILOT action step with plugin_key and operation_type, (2) Map config parameters from IR to PILOT format, (3) Handle loop_config: if fetch is inside a loop, wrap with scatter-gather pattern, (4) Set output_variable for downstream steps to reference. Fetch operations become the entry points that load data from external sources (Gmail, Sheets, Airtable, etc.).',
    connections: [18],
    data: {
      ir_node: {
        type: 'operation',
        operation: { operation_type: 'fetch', plugin_key: 'google-mail', action: 'search_emails' }
      },
      pilot_step: {
        type: 'action',
        operation: 'fetch_emails',
        plugin_key: 'google-mail',
        action_id: 'search_emails',
        config: { query: 'newer_than:7d', max_results: 100 }
      }
    }
  },
  {
    id: 18,
    title: 'Compile Transform Operations',
    subsystem: 'compilation',
    description: 'Transform nodes become PILOT transform steps: (1) filter type → filter_expression with field/operator/value conditions, (2) map type → map_expression for field extraction, (3) reduce type → reduce_operation (sum, count, avg, concat), (4) group_by type → group_by_field for aggregation. Compiler validates transform inputs are arrays (critical for filter operations). Auto-fixes common LLM error: filter on object instead of nested array field.',
    connections: [19],
    data: {
      transform_types: ['filter', 'map', 'reduce', 'group_by', 'sort'],
      example_filter: {
        type: 'transform',
        transform_type: 'filter',
        input: '{{emails}}',
        filter_expression: { field: 'subject', operator: 'contains', value: 'urgent' }
      },
      auto_fix: 'filter {{item}} → {{item.attachments}} using skeleton hints'
    }
  },
  {
    id: 19,
    title: 'Compile AI Operations',
    subsystem: 'compilation',
    description: 'AI nodes become PILOT llm_decision steps: (1) Extract prompt_template from IR, (2) Map input variables to context, (3) Set output_schema for structured extraction, (4) Configure model preferences (temperature, model_preference). AI steps use the OrchestrationService for intelligent model routing based on task complexity.',
    connections: [20],
    data: {
      ir_ai_node: {
        operation_type: 'ai',
        ai: {
          purpose: 'summarize_email',
          prompt_template: 'Summarize this email: {{current_email.body}}',
          output_schema: { summary: 'string', key_points: 'array' }
        }
      },
      pilot_step: {
        type: 'llm_decision',
        operation: 'summarize_email',
        prompt: 'Summarize this email...',
        output_schema: { summary: 'string' }
      }
    }
  },
  {
    id: 20,
    title: 'Compile Delivery Operations',
    subsystem: 'compilation',
    description: 'Delivery nodes become PILOT action steps for output: (1) Map plugin_key and action (e.g., google-sheets.append_rows), (2) Resolve input data from collected results, (3) Configure output format (table columns, message template). Delivery operations are typically the final steps that write results to external destinations.',
    connections: [21],
    data: {
      ir_deliver_node: {
        operation_type: 'deliver',
        plugin_key: 'google-sheets',
        action: 'append_rows'
      },
      pilot_step: {
        type: 'action',
        operation: 'save_results',
        plugin_key: 'google-sheets',
        action_id: 'append_rows',
        config: { spreadsheet_id: '{{sheet_id}}', data: '{{summaries}}' }
      }
    }
  },

  // ============================================================================
  // PHASE 5: VALIDATION & NORMALIZATION
  // ============================================================================
  {
    id: 21,
    title: 'PILOT Normalizer',
    subsystem: 'validation',
    description: 'PilotNormalizer ensures compiled DSL meets runtime requirements: (1) Validates all required fields present on each step, (2) Normalizes variable references to consistent format, (3) Validates step dependencies form a DAG (no circular dependencies), (4) Ensures parallel blocks have proper scatter-gather structure, (5) Validates plugin actions exist and parameters match schema.',
    connections: [22],
    data: {
      normalizations: [
        'Variable reference format: {{var.field}}',
        'Step ID uniqueness check',
        'Dependency graph validation',
        'Plugin action existence check'
      ],
      validation_status: 'PASSED'
    }
  },
  {
    id: 22,
    title: 'Workflow Validator',
    subsystem: 'validation',
    description: 'WorkflowValidator performs pre-flight checks before execution: (1) All required plugins are connected, (2) OAuth tokens are valid (not expired), (3) Input schema matches expected format, (4) Output schema is achievable from workflow steps, (5) Resource limits are within bounds (max steps, max parallel). Returns validation_passed + any warnings or errors.',
    connections: [23],
    data: {
      pre_flight_checks: [
        'Plugin connections verified',
        'OAuth tokens valid',
        'Input schema matches',
        'Resource limits OK'
      ],
      validation_passed: true,
      warnings: []
    }
  },
  {
    id: 23,
    title: 'DSL Reviewer (Optional)',
    subsystem: 'validation',
    description: 'DSLReviewer (if V6_REVIEW_MODE enabled) performs a final AI-powered review of the generated workflow: (1) Checks for logical errors the validators might miss, (2) Verifies workflow achieves stated goal, (3) Identifies potential improvements, (4) Flags any security concerns (data exposure, excessive permissions). Review results are shown to user in Review UI before agent activation.',
    connections: [24],
    data: {
      review_enabled: true,
      review_model: 'claude-sonnet-4',
      review_checks: ['goal_achievement', 'logical_errors', 'security_concerns'],
      review_result: 'APPROVED',
      suggestions: []
    }
  },

  // ============================================================================
  // PHASE 6: STORAGE & ACTIVATION
  // ============================================================================
  {
    id: 24,
    title: 'Store Agent Configuration',
    subsystem: 'database',
    description: 'AgentRepository persists the complete agent configuration to PostgreSQL: (1) agents table: id, agent_name, user_prompt, pilot_steps (JSONB), input_schema, output_schema, status, (2) agent_config: ai_context with full V6 pipeline artifacts (Enhanced Prompt, IntentContract, IR, DSL), (3) Plugin associations in agent_plugins table. Transaction ensures atomicity - partial saves roll back.',
    connections: [25],
    data: {
      tables: ['agents', 'agent_plugins'],
      pilot_steps: 'Compiled PILOT DSL array',
      ai_context: {
        enhanced_prompt: '...',
        intent_contract: '...',
        declarative_ir: '...',
        compilation_metadata: '...'
      },
      status: 'draft → active'
    }
  },
  {
    id: 25,
    title: 'Agent Ready for Execution',
    subsystem: 'execution',
    description: 'Agent is now ready for execution. User can: (1) Test with sample data in sandbox mode, (2) Activate for on-demand execution, (3) Set up scheduled execution (cron). The V6 pipeline has transformed natural language into a fully executable workflow with validated plugins, correct field mappings, and proper control flow.',
    connections: [26],
    data: {
      pipeline_complete: true,
      total_phases: 6,
      phases: ['Vocabulary', 'Understanding', 'Grounding', 'Formalization', 'Compilation', 'Validation'],
      execution_options: ['On-Demand', 'Scheduled', 'API Trigger'],
      estimated_generation_time: '8-15 seconds'
    }
  },

  // ============================================================================
  // EXECUTION PHASE: RUNTIME WORKFLOW EXECUTION
  // ============================================================================
  {
    id: 26,
    title: 'User Triggers Execution',
    subsystem: 'execution',
    description: 'User initiates agent execution via: (1) Dashboard "Run" button (on-demand), (2) Scheduled cron trigger, (3) API call to /api/run-agent. System validates: agent exists, user has permissions, plugins connected, OAuth tokens valid. Creates execution_id (UUID) for tracking. Request includes: agent_id, input_data, execution_mode (sync|async).',
    connections: [27],
    data: {
      triggers: ['Manual (Dashboard)', 'Scheduled (Cron)', 'API Call'],
      endpoint: 'POST /api/run-agent',
      validation: ['permissions', 'plugin_connections', 'oauth_tokens'],
      execution_id: 'uuid generated'
    }
  },
  {
    id: 27,
    title: 'WorkflowPilot Initializes',
    subsystem: 'pilot',
    description: 'WorkflowPilot class initializes the execution environment: (1) Loads agent.pilot_steps (compiled DSL) from database, (2) Creates ExecutionContext to store intermediate results, (3) Initializes StepExecutor, ParallelExecutor, ConditionalEvaluator, (4) Validates all required plugins are connected, (5) Loads PilotConfig (maxParallelSteps, enableCaching, enableProgressTracking). Execution mode: sequential by default, parallel for scatter-gather blocks.',
    connections: [28],
    data: {
      components: ['StepExecutor', 'ParallelExecutor', 'ConditionalEvaluator', 'StateManager'],
      pilot_steps: 'Loaded from agent.pilot_steps',
      execution_context: 'Created for result storage',
      config: { maxParallelSteps: 5, enableCaching: true }
    }
  },
  {
    id: 28,
    title: 'Create Execution Record',
    subsystem: 'database',
    description: 'AgentExecutionRepository creates tracking record: (1) INSERT into agent_executions with: id, agent_id, user_id, status="running", total_steps, current_step=0, input_data, started_at. (2) Indexed for real-time monitoring. (3) Record updated throughout execution with progress, token usage, costs. Status transitions: running → completed|failed|cancelled.',
    connections: [29],
    data: {
      table: 'agent_executions',
      status: 'running',
      tracking: ['step_progress', 'token_usage', 'cost_usd', 'duration_ms'],
      real_time_updates: true
    }
  },
  {
    id: 29,
    title: 'Audit: Execution Started',
    subsystem: 'audit',
    description: 'AuditTrailService logs execution initiation: (1) INSERT into audit_trail with action="EXECUTION_STARTED", (2) Metadata: execution_id, agent_id, input_data_hash (SHA-256), triggered_by (user|schedule|api), (3) Timestamp for SLA tracking, (4) Non-blocking batched insert for performance. Enables compliance: trace who executed what agent, when, with what inputs.',
    connections: [30],
    data: {
      event: 'EXECUTION_STARTED',
      severity: 'info',
      metadata: ['execution_id', 'agent_id', 'input_hash', 'triggered_by'],
      batched: true,
      compliance: 'SOC2 audit trail'
    }
  },
  {
    id: 30,
    title: 'Load Memory Context',
    subsystem: 'memory',
    description: 'MemoryInjector retrieves agent-specific learned patterns: (1) Query agent_memory for routing_patterns, execution_outcomes, user_preferences, (2) Filter by importance >= 5 and recency, (3) Returns: successful routing decisions, previous execution results, user style preferences. Memory enables personalization and continuous improvement.',
    connections: [31],
    data: {
      memory_types: ['routing_pattern', 'execution_outcome', 'user_preference'],
      query_filters: { importance: '>=5', recency: 'last_30_days' },
      injection_point: 'LLM context for llm_decision steps'
    }
  },
  {
    id: 31,
    title: 'Step Executor: Load Step',
    subsystem: 'pilot',
    description: 'StepExecutor prepares current PILOT step for execution: (1) Load step from pilot_steps[current_index], (2) Resolve input variables from ExecutionContext (e.g., {{step_1.output.emails}}), (3) Validate required inputs present, (4) Determine step type: action (plugin call), llm_decision (AI reasoning), transform (data manipulation), conditional (branching).',
    connections: [32],
    data: {
      step_types: ['action', 'llm_decision', 'transform', 'conditional', 'parallel'],
      input_resolution: '{{variable.path}} → actual value',
      validation: 'required inputs check',
      current_step: '1/8'
    }
  },
  {
    id: 32,
    title: 'Intelligent Model Routing',
    subsystem: 'routing',
    description: 'OrchestrationService selects optimal model for llm_decision steps: (1) TaskComplexityAnalyzer evaluates 6 factors (prompt_length, data_size, reasoning_depth, condition_count, context_depth, output_complexity), (2) Check routing memory for learned patterns, (3) Select tier: 0-3→haiku, 3-7→sonnet, 7-10→opus, (4) Memory override if high confidence pattern exists (>0.7 success rate, >10 executions).',
    connections: [33],
    data: {
      complexity_factors: ['prompt_length', 'data_size', 'reasoning_depth', 'condition_count'],
      tiers: { haiku: '0-3', sonnet: '3-7', opus: '7-10' },
      memory_override: 'if confidence > 0.7 AND runs > 10',
      cost_optimization: 'up to 65% savings with intelligent routing'
    }
  },
  {
    id: 33,
    title: 'Execute Plugin Action',
    subsystem: 'pilot',
    description: 'For action steps, StepExecutor calls external plugins: (1) Get OAuth credentials from plugin_connections, (2) Execute plugin action (e.g., google-mail.search_emails, google-sheets.append_rows), (3) Handle pagination for large result sets, (4) Retry with exponential backoff on transient failures (max 3 retries), (5) Store output in ExecutionContext.',
    connections: [34],
    data: {
      plugin_call: { plugin: 'google-mail', action: 'search_emails', config: { query: 'newer_than:7d' } },
      oauth: 'Retrieved from plugin_connections',
      retry: 'exponential backoff, max 3',
      result: 'Stored in ExecutionContext'
    }
  },
  {
    id: 34,
    title: 'Execute LLM Decision',
    subsystem: 'pilot',
    description: 'For llm_decision steps, StepExecutor calls AI provider: (1) Build prompt from template + context + memory, (2) Call Anthropic/OpenAI API with selected model (from routing), (3) Parse structured output using output_schema, (4) Track token usage (input_tokens, output_tokens) and cost, (5) Handle tool_use if step requires plugin calls.',
    connections: [35],
    data: {
      model: 'claude-3-5-haiku-20241022 (from routing)',
      prompt: 'Built from template + context + memory',
      output_schema: { summary: 'string', key_points: 'array' },
      token_tracking: { input: 1200, output: 450, cost_usd: 0.0018 }
    }
  },
  {
    id: 35,
    title: 'Track Token Usage',
    subsystem: 'database',
    description: 'Token usage recorded for cost tracking and analytics: (1) INSERT into token_usage with: execution_id, step_id, model_name, provider, input_tokens, output_tokens, cost_usd. (2) Cost calculated using lib/ai/pricing.ts with model-specific rates. (3) Supports per-execution and per-user aggregation. (4) Enables model cost comparison and optimization insights.',
    connections: [36],
    data: {
      table: 'token_usage',
      columns: ['execution_id', 'model_name', 'provider', 'input_tokens', 'output_tokens', 'cost_usd'],
      pricing_source: 'lib/ai/pricing.ts (cached from ai_model_pricing table)',
      aggregation: ['per_execution', 'per_user', 'per_model']
    }
  },
  {
    id: 36,
    title: 'Execute Transform Step',
    subsystem: 'pilot',
    description: 'For transform steps, apply data transformations: (1) filter: evaluate filter_expression against each item, return matching items, (2) map: extract/transform fields from each item, (3) reduce: aggregate values (sum, count, avg, concat), (4) group_by: group items by field value, (5) sort: order items by field. Transforms are CPU-only (no LLM calls).',
    connections: [37],
    data: {
      transform_types: ['filter', 'map', 'reduce', 'group_by', 'sort'],
      example: {
        type: 'filter',
        input: '{{emails}}',
        expression: { field: 'has_attachment', operator: 'equals', value: true }
      },
      execution: 'CPU-only, no LLM calls'
    }
  },
  {
    id: 37,
    title: 'Handle Parallel Execution',
    subsystem: 'pilot',
    description: 'ParallelExecutor handles scatter-gather patterns: (1) Scatter: distribute items across parallel workers (up to maxParallelSteps), (2) Execute inner steps for each item concurrently, (3) Gather: collect all results into output array, (4) Respects loop_config.collect_outputs to determine aggregation. Enables efficient processing of large datasets (e.g., 100 emails in parallel).',
    connections: [38],
    data: {
      pattern: 'scatter-gather',
      max_parallel: 5,
      example: 'Process 100 emails → 5 parallel workers → 20 emails each',
      collect_outputs: true,
      concurrency_control: 'Promise.all with limit'
    }
  },
  {
    id: 38,
    title: 'Evaluate Conditionals',
    subsystem: 'pilot',
    description: 'ConditionalEvaluator handles branching logic: (1) Parse condition expression (e.g., "{{item.priority}} == \'high\'"), (2) Resolve variables from ExecutionContext, (3) Safely evaluate in sandboxed environment (no code injection), (4) Return branch path: true_branch or false_branch step IDs. Enables dynamic workflows with skip logic.',
    connections: [39],
    data: {
      condition: "{{item.priority}} == 'high'",
      evaluation: true,
      branches: { true: 'notify_step', false: 'skip_to_end' },
      sandbox: 'Safe expression evaluation'
    }
  },
  {
    id: 39,
    title: 'Update Execution Progress',
    subsystem: 'database',
    description: 'StateManager updates execution record after each step: (1) UPDATE agent_executions SET current_step_index++, step_results (append metrics), total_tokens_used += step_tokens, total_cost_usd += step_cost. (2) If enableRealTimeUpdates: push to Supabase Realtime for live dashboard. (3) Enables progress tracking and live monitoring.',
    connections: [40],
    data: {
      update_frequency: 'after each step',
      fields_updated: ['current_step_index', 'step_results', 'total_tokens_used', 'total_cost_usd'],
      realtime: 'Supabase Realtime for live dashboard',
      progress: '5/8 steps complete'
    }
  },
  {
    id: 40,
    title: 'Learn Routing Patterns',
    subsystem: 'memory',
    description: 'MemorySummarizer updates routing patterns using EMA (Exponential Moving Average): (1) new_success_rate = 0.3 × current + 0.7 × historical, (2) Increment execution_count, (3) Recalculate confidence = min(count/10, 1.0), (4) High-confidence patterns (>0.7) enable memory override in future executions. Creates continuous improvement loop.',
    connections: [41],
    data: {
      algorithm: 'EMA (α=0.3)',
      formula: 'new = 0.3 × current + 0.7 × old',
      pattern_updated: { tier: 'sonnet', success_rate: '0.92 → 0.94', confidence: 1.0 },
      memory_type: 'routing_pattern'
    }
  },
  {
    id: 41,
    title: 'Execution Complete',
    subsystem: 'pilot',
    description: 'WorkflowPilot finalizes execution after all steps complete: (1) Aggregate metrics: total_steps, tokens_used, total_cost, duration_ms, (2) Build final output from ExecutionContext using output_schema, (3) Validate output against agent.output_schema, (4) Determine status: completed (all success), partial_success (some failures), failed (critical error). (5) Release resources.',
    connections: [42],
    data: {
      total_steps: 8,
      total_tokens: 15000,
      total_cost_usd: 0.0185,
      duration_ms: 12500,
      status: 'completed',
      output: { summaries: '[8 email summaries]', saved_to: 'Google Sheets row 150' }
    }
  },
  {
    id: 42,
    title: 'Aggregate Model Usage',
    subsystem: 'database',
    description: 'aggregate_execution_model_usage() PostgreSQL function summarizes LLM usage: (1) Query token_usage grouped by model/provider, (2) Calculate total_cost_usd, primary_model, models_used array, (3) UPDATE agent_executions with aggregated data. Enables cost analysis per model, routing efficiency metrics, and billing accuracy.',
    connections: [43],
    data: {
      function: 'aggregate_execution_model_usage(execution_id)',
      output: {
        total_cost_usd: 0.0185,
        primary_model: 'claude-3-5-haiku-20241022',
        models_used: [{ model: 'haiku', tokens: 12000, cost: 0.012 }, { model: 'sonnet', tokens: 3000, cost: 0.0065 }]
      }
    }
  },
  {
    id: 43,
    title: 'Store Execution Outcome',
    subsystem: 'database',
    description: 'Final execution results persisted: (1) UPDATE agent_executions SET status="completed", result (JSONB), completed_at, (2) INSERT into agent_memory with memory_type="execution_outcome" for future context, (3) If failed: store error patterns for failure prevention. History enables trend analysis, cost forecasting, failure detection.',
    connections: [44],
    data: {
      tables: ['agent_executions', 'agent_memory'],
      execution_result: { success: true, output_rows: 8 },
      memory_stored: 'execution_outcome with importance=8',
      history_retention: 'indefinite'
    }
  },
  {
    id: 44,
    title: 'Audit: Execution Completed',
    subsystem: 'audit',
    description: 'AuditTrailService logs final completion: (1) INSERT audit_trail with action="EXECUTION_COMPLETED", (2) Metadata: status, total_tokens, total_cost, duration, success_rate, result_hash (SHA-256), (3) Enables compliance reporting: verify agent performed as intended, track resource consumption. (4) Batched non-blocking insert.',
    connections: [45],
    data: {
      event: 'EXECUTION_COMPLETED',
      metrics: { tokens: 15000, cost: '$0.0185', duration: '12.5s', success_rate: '100%' },
      result_hash: 'SHA-256 for integrity',
      compliance: 'Full audit trail for SOC2'
    }
  },
  {
    id: 45,
    title: 'Return Results to User',
    subsystem: 'execution',
    description: 'Execution results delivered to user: (1) Sync mode: immediate HTTP response with result, (2) Async mode: webhook notification to configured URL, (3) Dashboard: real-time update via Supabase Realtime, (4) Email notification if configured. User sees: execution status, output data, token usage, cost, duration.',
    connections: [],
    data: {
      delivery_methods: ['HTTP Response', 'Webhook', 'Dashboard Realtime', 'Email'],
      response: {
        success: true,
        execution_id: 'uuid',
        result: { summaries: 8, saved_to: 'Sheet row 150' },
        metrics: { tokens: 15000, cost: '$0.0185', duration: '12.5s' }
      },
      full_cycle_complete: true
    }
  }
];

const SUBSYSTEM_CONFIG = {
  // V6 Agent Generation Pipeline Phases
  vocabulary: {
    name: 'Phase 0: Vocabulary',
    icon: FileText,
    color: 'from-amber-500 to-amber-700',
    borderColor: 'border-amber-500',
    textColor: 'text-amber-400',
    bgColor: 'bg-amber-500/10'
  },
  understanding: {
    name: 'Phase 1: Understanding',
    icon: Brain,
    color: 'from-purple-500 to-purple-700',
    borderColor: 'border-purple-500',
    textColor: 'text-purple-400',
    bgColor: 'bg-purple-500/10'
  },
  grounding: {
    name: 'Phase 2: Grounding',
    icon: Shield,
    color: 'from-teal-500 to-teal-700',
    borderColor: 'border-teal-500',
    textColor: 'text-teal-400',
    bgColor: 'bg-teal-500/10'
  },
  formalization: {
    name: 'Phase 3: Formalization',
    icon: GitBranch,
    color: 'from-blue-500 to-blue-700',
    borderColor: 'border-blue-500',
    textColor: 'text-blue-400',
    bgColor: 'bg-blue-500/10'
  },
  compilation: {
    name: 'Phase 4: Compilation',
    icon: Workflow,
    color: 'from-cyan-500 to-cyan-700',
    borderColor: 'border-cyan-500',
    textColor: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10'
  },
  validation: {
    name: 'Phase 5: Validation',
    icon: CheckCircle,
    color: 'from-green-500 to-green-700',
    borderColor: 'border-green-500',
    textColor: 'text-green-400',
    bgColor: 'bg-green-500/10'
  },
  // Execution Runtime Components
  execution: {
    name: 'User / Trigger',
    icon: Zap,
    color: 'from-orange-500 to-orange-700',
    borderColor: 'border-orange-500',
    textColor: 'text-orange-400',
    bgColor: 'bg-orange-500/10'
  },
  pilot: {
    name: 'PILOT Runtime',
    icon: Activity,
    color: 'from-pink-500 to-pink-700',
    borderColor: 'border-pink-500',
    textColor: 'text-pink-400',
    bgColor: 'bg-pink-500/10'
  },
  routing: {
    name: 'Model Routing',
    icon: GitBranch,
    color: 'from-indigo-500 to-indigo-700',
    borderColor: 'border-indigo-500',
    textColor: 'text-indigo-400',
    bgColor: 'bg-indigo-500/10'
  },
  memory: {
    name: 'Memory System',
    icon: Lightbulb,
    color: 'from-yellow-500 to-yellow-700',
    borderColor: 'border-yellow-500',
    textColor: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10'
  },
  audit: {
    name: 'Audit Trail',
    icon: BarChart3,
    color: 'from-red-500 to-red-700',
    borderColor: 'border-red-500',
    textColor: 'text-red-400',
    bgColor: 'bg-red-500/10'
  },
  database: {
    name: 'Storage',
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
    <div className="space-y-6">
      {/* Header */}
      <header className="border-b border-slate-700 pb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-4 mb-1">
                <h1 className="text-xl font-semibold text-white">System Flow Visualizer</h1>
                <span className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400">V6 Pipeline</span>
              </div>
              <p className="text-sm text-slate-400">
                V6 Generation (Phases 0-5) + PILOT Execution Runtime — Full Agent Lifecycle
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-4">
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded-lg text-white"
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
              className="p-2 rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors"
              title="Reset animation"
            >
              <RotateCcw className="w-5 h-5 text-slate-400" />
            </button>

            <button
              onClick={isPlaying ? handlePause : handlePlay}
              className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
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
        <div className="w-full bg-slate-700 rounded-full h-2 mt-4">
          <div
            className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${((currentStep + 1) / ANIMATION_STEPS.length) * 100}%` }}
          />
        </div>
      </header>

      {/* Main Content */}
      <div className="">
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
                          : 'border-slate-700 bg-slate-800/30 hover:bg-slate-900/50'
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

            {/* Pipeline Phases Grid - Organized by Section */}
            <div className="space-y-6">
              {/* V6 Agent Generation Pipeline */}
              <div>
                <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                  <Workflow className="w-5 h-5 text-blue-400" />
                  V6 Agent Generation Pipeline
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  {(['vocabulary', 'understanding', 'grounding', 'formalization', 'compilation', 'validation'] as const).map((key) => {
                    const config = SUBSYSTEM_CONFIG[key];
                    const Icon = config.icon;
                    const isActive = step.subsystem === key;
                    const activityCount = ANIMATION_STEPS.slice(0, currentStep + 1).filter(s => s.subsystem === key).length;
                    const hasActivity = activityCount > 0;

                    return (
                      <div
                        key={key}
                        className={`p-3 rounded-lg border-2 transition-all duration-300 ${
                          isActive
                            ? `${config.borderColor} ${config.bgColor} shadow-lg scale-105`
                            : hasActivity
                            ? 'border-slate-600 bg-slate-800/50'
                            : 'border-slate-700 bg-slate-800/30 opacity-50'
                        }`}
                      >
                        <div className="flex flex-col items-center gap-2">
                          <div className={`p-2 rounded-lg bg-gradient-to-br ${config.color} relative`}>
                            <Icon className="w-5 h-5 text-white" />
                            {hasActivity && (
                              <div className="absolute -top-1 -right-1 w-4 h-4 bg-slate-900 rounded-full flex items-center justify-center border border-slate-700">
                                <span className="text-[10px] text-white font-bold">{activityCount}</span>
                              </div>
                            )}
                          </div>
                          <div className="text-center">
                            <h3 className="font-semibold text-white text-xs">{config.name}</h3>
                            {isActive && (
                              <div className="flex items-center justify-center gap-1 text-[10px] text-slate-400 mt-0.5">
                                <Activity className="w-2 h-2 animate-pulse" />
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

              {/* Execution Runtime */}
              <div>
                <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-pink-400" />
                  Execution Runtime
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                  {(['execution', 'pilot', 'routing', 'memory', 'audit', 'database'] as const).map((key) => {
                    const config = SUBSYSTEM_CONFIG[key];
                    const Icon = config.icon;
                    const isActive = step.subsystem === key;
                    const activityCount = ANIMATION_STEPS.slice(0, currentStep + 1).filter(s => s.subsystem === key).length;
                    const hasActivity = activityCount > 0;

                    return (
                      <div
                        key={key}
                        className={`p-3 rounded-lg border-2 transition-all duration-300 ${
                          isActive
                            ? `${config.borderColor} ${config.bgColor} shadow-lg scale-105`
                            : hasActivity
                            ? 'border-slate-600 bg-slate-800/50'
                            : 'border-slate-700 bg-slate-800/30 opacity-50'
                        }`}
                      >
                        <div className="flex flex-col items-center gap-2">
                          <div className={`p-2 rounded-lg bg-gradient-to-br ${config.color} relative`}>
                            <Icon className="w-5 h-5 text-white" />
                            {hasActivity && (
                              <div className="absolute -top-1 -right-1 w-4 h-4 bg-slate-900 rounded-full flex items-center justify-center border border-slate-700">
                                <span className="text-[10px] text-white font-bold">{activityCount}</span>
                              </div>
                            )}
                          </div>
                          <div className="text-center">
                            <h3 className="font-semibold text-white text-xs">{config.name}</h3>
                            {isActive && (
                              <div className="flex items-center justify-center gap-1 text-[10px] text-slate-400 mt-0.5">
                                <Activity className="w-2 h-2 animate-pulse" />
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
    </div>
  );
}
