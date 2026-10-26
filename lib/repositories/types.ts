// lib/repositories/types.ts
// Type definitions for repository layer

/**
 * Enum for agent statuses
 */
export enum AgentStatusEnum {
  DRAFT = 'draft',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DELETED = 'deleted',
}

// Type alias for flexibility (can use enum values or string literals)
export type AgentStatus = 'draft' | 'active' | 'inactive' | 'deleted' | 'archived';

// Post-creation background-calibration gate state (Phase 2). NULL on the agent
// row means legacy/pre-existing — interpreted at read-time as deferred.
export type CalibrationGateStatus = 'running' | 'passed' | 'failed' | 'skipped';

export interface Agent {
  id: string;
  user_id: string;
  agent_name: string;
  description?: string | null;
  status: AgentStatus;
  config: Record<string, unknown>;
  schedule_cron?: string | null;
  timezone?: string | null;
  next_run_at?: string | null;
  deactivation_reason?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  // Organization and grouping (Automation Intelligence Platform)
  org_id?: string | null;              // Organization this agent belongs to
  tags?: string[] | null;              // User-defined tags for flexible categorization
  // Additional fields used in agent detail page
  mode?: string | null;
  plugins_required?: string[] | null;
  connected_plugins?: unknown[] | Record<string, unknown> | null;
  input_schema?: unknown[] | null;
  output_schema?: unknown[] | null;
  user_prompt?: string | null;
  workflow_steps?: unknown[] | null;
  // Additional fields used in agent execution
  pilot_steps?: unknown[] | null;
  pilot_steps_original?: unknown[] | null; // Original workflow before calibration - never modified after first set
  system_prompt?: string | null;
  enhanced_prompt?: string | null;
  trigger_condintion?: Record<string, unknown> | null;
  // Intelligence features
  insights_enabled?: boolean;
  production_ready?: boolean;
  // Calibration state
  is_calibrated?: boolean;
  last_successful_calibration_id?: string | null;
  calibration_prompt_decision?: 'accepted' | 'declined' | null;
  calibration_prompt_decided_at?: string | null;
  // Post-creation background-calibration gate (Phase 2)
  calibration_status?: CalibrationGateStatus | null;
  // Business intelligence context
  workflow_purpose?: string | null;
  // ROI tracking - estimated time saved per item automated (in seconds)
  manual_time_per_item_seconds?: number | null;
  // ROI tracking - hourly rate for this automation (different tasks have different costs)
  hourly_rate_usd?: number | null;
  // Creation metadata + AI context (JSONB column populated at agent creation time;
  // shape matches CreateAgentInput.agent_config — creation_metadata + ai_context)
  agent_config?: Record<string, unknown> | null;
  // AI generation timestamp (separate from created_at — when the AI generated
  // the workflow, not when the DB row was inserted)
  ai_generated_at?: string | null;
  // Workflow scheduling / runtime metadata
  ai_reasoning?: string | null;
  ai_confidence?: number | null;
  trigger_conditions?: Record<string, unknown> | null;
  detected_categories?: unknown | null;
  generated_plan?: unknown | null;
  created_from_prompt?: string | null;
}

export interface CreateAgentInput {
  // Identity
  id?: string;                                   // optional explicit ID (frontend-provided for token-tracking consistency)
  user_id: string;
  agent_name: string;
  description?: string | null;

  // Prompts
  user_prompt?: string | null;
  system_prompt?: string | null;
  created_from_prompt?: string | null;

  // Schema / I/O
  input_schema?: unknown[] | null;
  output_schema?: unknown[] | null;

  // Plugins / execution
  plugins_required?: string[] | null;
  connected_plugins?: unknown[] | Record<string, unknown> | null;
  workflow_steps?: unknown[] | null;
  pilot_steps?: unknown[] | null;
  generated_plan?: unknown | null;
  detected_categories?: unknown | null;
  trigger_conditions?: Record<string, unknown> | null;

  // AI / creation metadata
  ai_reasoning?: string | null;
  ai_confidence?: number | null;
  ai_generated_at?: string | null;
  agent_config?: Record<string, unknown> | null;  // JSONB: creation_metadata + ai_context

  // Lifecycle / scheduling
  status?: AgentStatus;
  mode?: string | null;
  schedule_cron?: string | null;
  timezone?: string | null;
  /**
   * Added 2026-10-25 (mailbox lead channel). `schedule_cron` alone does NOT
   * make an agent run: the scheduled runner selects on `mode = 'scheduled'`
   * AND `schedule_enabled = true`, and skips any row whose `next_run` is null.
   * An agent created with a cron and none of these three is dormant with
   * nothing to show why. Type-only — the repository spreads input directly.
   */
  schedule_enabled?: boolean | null;
  next_run?: string | null;

  /**
   * Added 2026-10-25 (mailbox lead channel). The column has existed on `Agent`
   * since tags shipped; it was simply never typed as creatable. The channel is
   * found by tag rather than by name — a name is the owner's to change — so
   * creating one without its tag would make the next setup create a second
   * agent reading the same mailbox. Type-only.
   */
  tags?: string[] | null;

  /**
   * ⚠️ THERE IS NO `config` COLUMN ON `agents`. Use `agent_config`.
   *
   * Kept only because it predates this warning. The repository spreads input
   * straight into the insert, so passing this makes PostgREST refuse the WHOLE
   * write with "Could not find the 'config' column of 'agents' in the schema
   * cache" — a 500 at the last step of an otherwise correct flow, which is
   * exactly how it was found (2026-10-25, mailbox lead channel).
   *
   * The real JSONB column is `agent_config`, and it is shared, so namespace
   * your keys and merge rather than replace.
   */
  config?: Record<string, unknown>;
}

export interface UpdateAgentInput {
  agent_name?: string;
  description?: string;
  config?: Record<string, unknown>;
  // Added 2026-06-10 (Effort Estimator cycle, Risk #3 option-a): allow
  // writes of the JSONB `agent_config` column via the repository so the
  // estimator's read-modify-write can stay on the repository layer instead
  // of falling back to a direct Supabase call. `AgentRepository.update`
  // already spreads input directly into the Supabase update, so no impl
  // change is needed — this is purely a type extension.
  agent_config?: Record<string, unknown> | null;
  schedule_cron?: string | null;
  timezone?: string | null;
  /* See the note on these two in `CreateAgentInput`: re-pointing an existing
     agent must be able to restore all three scheduling facts, not just the
     cron. Type-only — `update` spreads input directly. */
  mode?: string | null;
  schedule_enabled?: boolean | null;
  next_run?: string | null;
  // ROI tracking - hourly rate for this automation
  hourly_rate_usd?: number | null;
}

export interface UpdateAgentDetailsInput {
  agent_name?: string;
  description?: string | null;
  schedule_cron?: string | null;
  mode?: 'on_demand' | 'scheduled';
  timezone?: string | null;
}

export interface AgentRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

// Status transition rules
export const STATUS_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  draft: ['active', 'deleted'],      // Draft can activate or be deleted
  active: ['inactive', 'deleted'],   // Active can be paused or deleted
  inactive: ['active', 'deleted'],   // Inactive can be reactivated or deleted
  deleted: [],                        // Terminal state - only restore() bypasses this
  archived: [],                       // Archived agents cannot transition
};

// ============ Execution Types ============

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'success' | 'error';

export interface ExecutionTokensUsed {
  total?: number;
  prompt?: number;
  completion?: number;
  adjusted?: number;
  intensityMultiplier?: number;
  intensityScore?: number;
  _source?: string;
}

export interface ExecutionLogs {
  tokensUsed?: ExecutionTokensUsed;
  pilot?: boolean;
  agentkit?: boolean;
  model?: string;
  provider?: string;
  iterations?: number;
  toolCalls?: unknown[];
  executionId?: string;
  stepsCompleted?: number;
  stepsFailed?: number;
  stepsSkipped?: number;
  totalSteps?: number;
  inputValuesUsed?: number;
  [key: string]: unknown; // Allow additional properties
}

export interface Execution {
  id: string;
  agent_id: string;
  user_id?: string;
  execution_type?: 'manual' | 'scheduled';
  status: ExecutionStatus;
  scheduled_at?: string;
  started_at: string;
  completed_at?: string | null;
  execution_duration_ms?: number | null;
  logs?: ExecutionLogs | null;
  result?: Record<string, unknown> | null;
  error_message?: string | null;
  input_data?: Record<string, unknown> | null;
  output?: unknown;
  cron_expression?: string | null;
  progress?: number;
  retry_count?: number;
  created_at?: string;
}

// Lightweight execution record for status polling (GET handler)
export interface ExecutionStatusRecord {
  id: string;
  agent_id: string;
  execution_type?: 'manual' | 'scheduled';
  status: ExecutionStatus;
  progress?: number;
  scheduled_at?: string;
  started_at?: string;
  completed_at?: string | null;
  error_message?: string | null;
  execution_duration_ms?: number | null;
  retry_count?: number;
}

export interface TokenUsage {
  id: string;
  execution_id: string;
  input_tokens: number;
  output_tokens: number;
  activity_type: string;
}

// ============ Shared Agent Types ============

export interface SharedAgent {
  id: string;
  original_agent_id: string;
  user_id: string;
  agent_name: string;
  description?: string | null;
  system_prompt?: string | null;
  user_prompt: string;
  input_schema?: unknown | null;
  output_schema?: unknown | null;
  plugins_required?: string[] | null;
  workflow_steps?: unknown | null;
  mode?: string | null;
  generated_plan?: string | null;
  ai_reasoning?: string | null;
  ai_confidence?: number | null;
  detected_categories?: string[] | null;
  created_from_prompt?: string | null;
  ai_generated_at?: string | null;
  connected_plugins?: unknown[] | Record<string, unknown> | null;
  shared_at: string;
  created_at?: string | null;
  updated_at?: string | null;
  import_count?: number | null;
  average_score?: number | null;
  total_ratings?: number | null;
  quality_score?: number | null;
  reliability_score?: number | null;
  efficiency_score?: number | null;
  adoption_score?: number | null;
  complexity_score?: number | null;
  last_imported_at?: string | null;
  score_calculated_at?: string | null;
  base_executions?: number | null;
  base_success_rate?: number | null;
}

export interface CreateSharedAgentInput {
  original_agent_id: string;
  user_id: string;
  agent_name: string;
  description?: string | null;
  system_prompt?: string | null;
  user_prompt: string;
  input_schema?: unknown | null;
  output_schema?: unknown | null;
  plugins_required?: string[] | null;
  workflow_steps?: unknown | null;
  mode?: string | null;
  generated_plan?: string | null;
  ai_reasoning?: string | null;
  ai_confidence?: number | null;
  detected_categories?: string[] | null;
  created_from_prompt?: string | null;
  ai_generated_at?: string | null;
  connected_plugins?: unknown[] | Record<string, unknown> | null;
  quality_score?: number | null;
  reliability_score?: number | null;
  efficiency_score?: number | null;
  adoption_score?: number | null;
  complexity_score?: number | null;
  base_executions?: number | null;
  base_success_rate?: number | null;
}

// ============ Agent Metrics Types ============

export interface AgentMetrics {
  agent_id: string;
  user_id: string;
  success_rate: number;
  total_executions: number;
  avg_execution_time_ms?: number | null;
  last_execution_at?: string | null;
}

// ============ Config Types ============

export interface SystemConfig {
  config_key: string;
  config_value: string;
}

export interface RewardConfig {
  reward_key: string;
  credits_amount: number;
  is_active: boolean;
}

// ============ Plugin Connection Types ============

export interface UpsertPluginConnectionInput {
  user_id: string;
  plugin_key: string;
  plugin_name: string;
  access_token: string;
  refresh_token?: string | null;
  expires_at?: string | null;
  scope?: string | null;
  username?: string;
  email?: string | null;
  profile_data?: Record<string, unknown> | null;
  settings?: Record<string, unknown>;
  status?: string;
  connected_at?: string;
}

/**
 * A row of `ai_model_pricing` — platform-wide reference data (one price per
 * provider/model/effective_date). There is no `user_id` column: see the header
 * of `AiModelPricingRepository` for why the mandatory user scoping does not
 * apply and what replaces it.
 */
export interface AiModelPricing {
  id: string;
  provider: string;
  model_name: string;
  /**
   * `numeric` columns come back from PostgREST as strings on some paths and as
   * numbers on others — `lib/ai/pricing.ts:23-24` types them as strings and
   * `parseFloat`s them, while the admin screen treats them as numbers. The union
   * is the honest type; the route passes rows through untouched so today's
   * response bytes are unchanged.
   */
  input_cost_per_token: number | string;
  output_cost_per_token: number | string;
  /**
   * Per token, for input served from the provider's prompt cache. NULL means
   * "not set": the charge then uses the provider's derived rule (OpenAI: half
   * the input rate). A 0 is treated as not set too (AI model price review
   * slice 7, O-5). Optional because some readers select a column subset.
   */
  cached_input_cost_per_token?: number | string | null;
  effective_date: string;
  retired_date: string | null;
  created_at: string;
}

/**
 * An active `ai_model_pricing` row read with its prices as exact decimal TEXT
 * (`::text` casts), for the admin price comparison only (AI model price review
 * slice 3). Never a JS float.
 */
export interface AiModelPricingExactRow {
  id: string;
  provider: string;
  model_name: string;
  input_cost_per_token: string;
  output_cost_per_token: string;
  cached_input_cost_per_token: string | null;
  effective_date: string;
  created_at: string;
}

/**
 * One active row of `ai_model_image_pricing` (AI model price review slice 7):
 * the price of ONE generated image for a provider, model, size and quality.
 * `cost_per_image` is `numeric`; PostgREST returns it as a number or a string
 * depending on the path, so the union is the honest type (as on
 * `AiModelPricing`). Read by the billing reader through
 * `AiModelImagePricingRepository.listActive()`.
 */
export interface AiModelImagePricing {
  id: string;
  provider: string;
  model_name: string;
  size: string;
  quality: string;
  cost_per_image: number | string;
  effective_date: string;
  created_at: string;
}

/** The same row with `cost_per_image` cast to TEXT, so the exact decimal survives (admin comparison only). */
export interface AiModelImagePricingExactRow {
  id: string;
  provider: string;
  model_name: string;
  size: string;
  quality: string;
  cost_per_image: string;
  effective_date: string;
  created_at: string;
}

/**
 * A pending provider price line, as handed to `ai_price_submit_pending`
 * (AI model price review slice 3). Every price is a decimal STRING: per 1M
 * tokens or per image for the proposed price, per token or per image for the
 * current snapshot. The database converts them; no float is ever sent.
 */
export interface AiPriceSubmitLine {
  kind: 'token' | 'image';
  provider: string;
  model_name: string;
  image_size?: string;
  image_quality?: string;
  input_per_1m?: string;
  output_per_1m?: string;
  cached_input_per_1m?: string;
  price_per_image?: string;
  current_basis: 'table' | 'in_code_fallback' | 'image_setting' | 'unpriced';
  current_row_id?: string;
  current_input_cost_per_token?: string;
  current_output_cost_per_token?: string;
  current_cached_input_cost_per_token?: string;
  current_cost_per_image?: string;
  source_url: string;
  checked_on: string;
  flags: string[];
  /**
   * Slice 5, fetched lines only (migration `20261069` writes them): the
   * LiteLLM cross-check. Text and a display percentage, never a price.
   */
  cross_check_verdict?: 'agrees' | 'differs' | 'not_listed' | 'unavailable';
  cross_check_value?: string | null;
  cross_check_source?: string;
  cross_check_fetched_at?: string;
  cross_check_diff_pct?: string | null;
}

export interface AiPriceSubmitInput {
  adminUserId: string;
  sourceKind: 'manual' | 'fetch';
  providerOutcomes: Record<string, unknown> | null;
  lines: AiPriceSubmitLine[];
}

/** A stored fetch round (slice 5), as the status read needs it. */
export interface AiPriceFetchRoundRow {
  id: string;
  created_at: string;
  created_by: string;
  provider_outcomes: unknown;
}

/** The result of a fetch round submit (slice 5, SA SC-8): the round id, and one row per stored line. */
export interface AiPriceFetchRoundSubmitResult {
  roundId: string;
  lines: AiPriceSubmitResultLine[];
}

/** One row of the submit RPC's result: one per submitted line. */
export interface AiPriceSubmitResultLine {
  proposalId: string;
  lineId: string;
  /** 1-based position of the line in the submitted list. */
  lineIndex: number;
  supersededLineId: string | null;
}

/** A pending line as the comparison read needs it (prices as submitted, per 1M or per image). */
export interface AiPricePendingLine {
  id: string;
  proposal_id: string;
  kind: 'token' | 'image';
  provider: string;
  model_name: string;
  image_size: string | null;
  image_quality: string | null;
  input_per_1m: string | null;
  output_per_1m: string | null;
  cached_input_per_1m: string | null;
  price_per_image: string | null;
  source_url: string;
  checked_on: string;
  flags: string[];
  cross_check_verdict: string | null;
  /** Slice 5 (read with the line; absent in older doubles). */
  cross_check_value?: string | null;
  cross_check_diff_pct?: number | string | null;
  cross_check_source?: string | null;
  cross_check_fetched_at?: string | null;
  created_by: string;
  created_at: string;
}

/**
 * A price line as Apply and Dismiss read it (AI model price review slice 8):
 * the proposed prices as submitted (per 1M or per image), the snapshot of what
 * was charged when it was recorded, and its state. Every number is exact TEXT
 * (`::text` in the select, SA RC-6): it is compared by value with
 * `lib/ai/pricing-research/decimal.ts`, never through a JS number.
 */
export interface AiPriceDecisionLine {
  id: string;
  proposal_id: string;
  kind: 'token' | 'image';
  provider: string;
  model_name: string;
  image_size: string | null;
  image_quality: string | null;
  input_per_1m: string | null;
  output_per_1m: string | null;
  cached_input_per_1m: string | null;
  price_per_image: string | null;
  current_basis: 'table' | 'in_code_fallback' | 'image_setting' | 'unpriced';
  current_row_id: string | null;
  current_input_cost_per_token: string | null;
  current_output_cost_per_token: string | null;
  current_cached_input_cost_per_token: string | null;
  current_cost_per_image: string | null;
  source_url: string;
  checked_on: string;
  flags: string[];
  state: 'pending' | 'superseded' | 'applied' | 'dismissed';
  created_by: string;
}

/** One line handed to `ai_price_apply_lines`: an id and the admin's own words, nothing else (slice 8, SA 2.5). */
export interface AiPriceApplyLineInput {
  line_id: string;
  reason: string;
  override_reason?: string;
}

/** The margin record stored on the apply batch; computed by the server, never by the client (MP-FR-14). */
export interface AiPriceApplyMargin {
  needed: boolean;
  items: Array<Record<string, unknown>>;
}

/** One row of the apply function's result: one per applied line. */
export interface AiPriceApplyResultRow {
  batchId: string;
  lineId: string;
  /** Which live table took the new row: token prices or image prices. */
  liveKind: 'token' | 'image';
  newRowId: string;
  retiredRowIds: string[];
  appliedAt: string;
}

/** An apply whose margin review is still open (MP-FR-14), as the page shows it. */
export interface AiPriceOpenMarginReview {
  id: string;
  applied_by: string;
  applied_at: string;
  line_count: number;
  margin_items: Array<Record<string, unknown>>;
}

/**
 * One stored `ai_model_pricing` row of any state (current, later, superseded,
 * retired) for the admin price history (AI model price review slice 9). Prices
 * are exact TEXT (`::text`), never a JS float. `created_at` is nullable in the
 * captured table definition, so a legacy row may have none.
 */
export interface AiModelPricingHistoryRow {
  id: string;
  provider: string;
  model_name: string;
  input_cost_per_token: string;
  output_cost_per_token: string;
  cached_input_cost_per_token: string | null;
  effective_date: string;
  retired_date: string | null;
  created_at: string | null;
  proposal_id: string | null;
  proposal_line_id: string | null;
}

/** The image twin of `AiModelPricingHistoryRow` (slice 9); `cost_per_image` as exact TEXT. */
export interface AiModelImagePricingHistoryRow {
  id: string;
  provider: string;
  model_name: string;
  size: string;
  quality: string;
  cost_per_image: string;
  effective_date: string;
  retired_date: string | null;
  created_at: string | null;
  proposal_id: string | null;
  proposal_line_id: string | null;
}

/** A bounded history read (slice 9): the newest rows, and whether more exist. */
export interface PriceHistoryRowsPage<R> {
  rows: R[];
  truncated: boolean;
}

/**
 * A pending-price line as the price history reads it (slice 9): what Apply
 * wrote on it (who, when, why), where the price came from, and how it was
 * entered (the round's `source_kind`, embedded through the line's FK).
 */
export interface AiPriceAppliedLineRecord {
  id: string;
  proposal_id: string;
  kind: 'token' | 'image';
  image_size: string | null;
  image_quality: string | null;
  input_per_1m: string | null;
  output_per_1m: string | null;
  cached_input_per_1m: string | null;
  price_per_image: string | null;
  source_url: string;
  checked_on: string;
  state: 'pending' | 'superseded' | 'applied' | 'dismissed';
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  override_reason: string | null;
  apply_batch_id: string | null;
  created_by: string;
  created_at: string;
  ai_price_proposals: { source_kind: string } | null;
}

/** One apply batch as the price history reads it (slice 9): no margin items. */
export interface AiPriceApplyBatchRecord {
  id: string;
  applied_by: string;
  applied_at: string;
  line_count: number;
  margin_review_needed: boolean;
  margin_review_done: boolean;
  margin_review_by: string | null;
  margin_review_at: string | null;
  margin_review_note: string | null;
}

/**
 * A row of `boost_packs` — the agent-platform Pilot-Credit boost catalog, a
 * platform-wide table with no `user_id`. See the header of `BoostPackRepository`
 * for why the mandatory user scoping does not apply. PostgREST returns the
 * `numeric` columns (`price_usd`, `bonus_percentage`) as JSON numbers. Nullable
 * columns per the table definition (docs/BOOST_PACK_ADMIN_INTERFACE.md):
 * `badge_text` and `is_active` (DEFAULT true, but no NOT NULL).
 */
export interface BoostPack {
  id: string;
  pack_key: string;
  pack_name: string;
  display_name: string;
  description: string;
  price_usd: number;
  bonus_percentage: number;
  credits_amount: number;
  bonus_credits: number;
  badge_text: string | null;
  is_active: boolean | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * The fields an admin may write. Every field is optional at this layer because
 * the route keeps its historic semantics: POST requires the four text fields
 * (enforced by its Zod schema), PUT is a partial update. A field left undefined
 * is not sent, so the database default or the existing value stands.
 */
export interface BoostPackWriteInput {
  pack_key?: string;
  pack_name?: string;
  display_name?: string;
  description?: string;
  price_usd?: number;
  bonus_percentage?: number;
  credits_amount?: number;
  bonus_credits?: number;
  badge_text?: string | null;
  is_active?: boolean | null;
}

/**
 * A row of `exchange_rates`, the admin-maintained rate table (Admin Exchange
 * Rates slice 1a). Platform-wide, no `user_id`: see the header of
 * `ExchangeRatesRepository`. `rate_to_usd` is read cast to text
 * (`rate_to_usd::text`), so the exact `numeric(12,6)` value never passes
 * through a JS number. `is_enabled` is nullable live (DEFAULT true, no NOT NULL).
 */
export interface ExchangeRateRow {
  id: string;
  currency_code: string;
  currency_name: string;
  currency_symbol: string;
  rate_to_usd: string;
  is_enabled: boolean | null;
  decimal_places: number | null;
  last_updated_at: string | null;
  updated_by: string | null;
}

/** A row of `exchange_rate_history`, written only by the live trigger on a rate change. Rates read as text. */
export interface ExchangeRateHistoryRow {
  id: string;
  currency_code: string;
  old_rate: string | null;
  new_rate: string;
  changed_by: string | null;
  changed_at: string;
  change_reason: string | null;
}

export interface SystemSettingsConfig {
  id: string;
  key: string;
  value: any; // JSONB can be any type
  category: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  updated_by?: string | null;
}

// ============ User Subscription (billing summary read) Types ============

/**
 * The `user_subscriptions` columns the Settings billing screen shows
 * (GET /api/billing/summary). Allow-listed: exactly what BillingSettings reads,
 * nothing more — no Stripe ids, no quotas, no internal throttles.
 */
export interface UserSubscriptionBillingSummary {
  balance: number | null;
  total_spent: number | null;
  status: string | null;
  created_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  monthly_credits: number | null;
  monthly_amount_usd: number | null;
}

// ============ User Subscription (free-tier grant) Types ============
//
// S-6 fix (docs/workplans/ALLOCATE_FREE_TIER_S6_FIX_WORKPLAN.md). These types are
// deliberately CLOSED (SA RC-4): no index signature, no Partial<Row>. The keys a
// grant must never write on an existing row are declared `?: never`, so passing
// an object that carries them is a compile error even when it is not a literal.

/** The columns the free-tier grant reads. Allow-listed, never `select('*')`. */
export interface UserSubscriptionGrantState {
  user_id: string;
  balance: number | null;
  total_earned: number | null;
  storage_quota_mb: number | null;
  executions_quota: number | null;
  account_frozen: boolean | null;
  free_tier_granted_at: string | null;
}

/**
 * Typed inputs for a brand-new `user_subscriptions` row. The repository builds
 * the insert payload from these field by field; `user_id` comes from the
 * authenticated caller as a separate argument.
 */
export interface FreeTierNewRowValues {
  rawTokens: number;
  storageMb: number;
  /** `null` = unlimited. */
  executionsQuota: number | null;
  grantedAt: string;
  expiresAt: string;
}

/**
 * The exact insert payload for a new row. The ONLY free-tier type allowed to
 * hold `account_frozen` — and only as `false` (a brand-new row may initialise it).
 */
export interface FreeTierNewRow {
  readonly user_id: string;
  readonly balance: number;
  readonly total_earned: number;
  readonly storage_quota_mb: number;
  readonly storage_used_mb: 0;
  readonly executions_quota: number | null;
  readonly executions_used: 0;
  readonly status: 'active';
  readonly free_tier_granted_at: string;
  readonly free_tier_expires_at: string;
  readonly free_tier_initial_amount: number;
  readonly account_frozen: false;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * The patch applied to an EXISTING row by the once-only grant. Built from
 * numbers and dates only. `free_tier_expires_at` is present only when the row
 * held no credits before (workplan Q3 (a)).
 */
export interface FreeTierGrantPatch {
  readonly balance: number;
  readonly total_earned: number;
  readonly storage_quota_mb: number;
  /** `null` = unlimited. */
  readonly executions_quota: number | null;
  readonly free_tier_granted_at: string;
  readonly free_tier_initial_amount: number;
  readonly free_tier_expires_at?: string;
  readonly updated_at: string;
  // Never written on an existing row. `never` turns an attempt into a compile error.
  readonly account_frozen?: never;
  readonly status?: never;
  readonly user_id?: never;
  readonly id?: never;
  readonly storage_used_mb?: never;
  readonly executions_used?: never;
}

/** Result of the plain (never upsert) insert. `conflict` = Postgres 23505 only. */
export interface FreeTierInsertOutcome {
  inserted: boolean;
  conflict: boolean;
}

/** Result of the conditional update. `updated` = exactly one row matched. */
export interface FreeTierUpdateOutcome {
  updated: boolean;
}

// ============================================================================
// Business OS invites (invite-only signup, Slice 0)
// ============================================================================
//
// `business_os_invites` is a platform record, not tenant data: it has no
// `user_id` column. See `BusinessOsInviteRepository` for why it is reached
// unscoped, and by whom.

/** Which entitlements basis an invite grants. Mirrors the `grant_kind` CHECK. */
export type BusinessOsInviteGrantKind = 'cohort' | 'tier';

/**
 * One invite as the ADMIN surface reads it. Every column except `token_hash`,
 * which no reader ever selects.
 */
export interface BusinessOsInvite {
  id: string;
  email: string;
  email_locked: boolean;
  invite_type: string;
  grant_kind: BusinessOsInviteGrantKind;
  grant_id: string;
  access_open_ended: boolean | null;
  access_months: number | null;
  issuer_kind: 'admin' | 'account';
  issuer_admin_id: string | null;
  issuer_account_id: string | null;
  inviter_display_name: string;
  language: string;
  personal_note: string | null;
  internal_reason: string;
  link_expiry_days: number;
  link_expires_at: string;
  first_viewed_at: string | null;
  revoked_at: string | null;
  revoked_by_admin_id: string | null;
  revoke_reason: string | null;
  redeemed_at: string | null;
  redeemed_account_id: string | null;
  /** Slice 1a (FR-8a): when the invite was first opened by an email that already had an account. */
  opened_by_existing_account_at: string | null;
  /** Slice 1b (R-1): the server-generated account id a signup claimed this invite for, and when. */
  claimed_at: string | null;
  claimed_account_id: string | null;
  /** Slice 1b (FR-12a, SA D-2): the last failure of a signup that stopped halfway. Never an email. */
  redemption_failed_at: string | null;
  redemption_failed_step: string | null;
  redemption_error_code: string | null;
  redemption_error_message: string | null;
  redemption_failed_account_id: string | null;
  /**
   * Slice 2a (FR-14 to FR-16, workplan D-5 to D-7): the invitation email facts
   * of the CURRENT link. Read to derive the list's email status, and never put
   * in a view as-is: the list shows `emailStatus`, not these. `email_problem_detail`
   * and `inviter_reply_to` are deliberately NOT read by the admin surface.
   */
  email_attempted_at: string | null;
  email_sent_at: string | null;
  email_provider_message_id: string | null;
  email_problem: string | null;
  email_problem_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One invite as the PUBLIC page's lookup reads it: only what the page may show
 * or needs to decide the state. No email, no issuer id, no reasons, no hash.
 * `id` is read so `markFirstViewed` can target the row; it is never returned.
 * `issuer_kind` (Slice 5a, F5a-10) is read only to branch an account-issued
 * invite away from the existing-account check; it is never returned either.
 * `invite_type` (plan payments P-9.1, SA C-2) is read only so an admin Paid
 * invite is judged by the same predicate as the signup; never returned.
 */
export interface BusinessOsInvitePublicView {
  id: string;
  issuer_kind: 'admin' | 'account';
  invite_type: string;
  grant_kind: BusinessOsInviteGrantKind;
  grant_id: string;
  access_open_ended: boolean | null;
  access_months: number | null;
  inviter_display_name: string;
  language: string;
  personal_note: string | null;
  link_expires_at: string;
  first_viewed_at: string | null;
  revoked_at: string | null;
  redeemed_at: string | null;
}

/**
 * What an admin-issued invite is created with: the explicit allow-list.
 *
 * `issuer_kind` is not here: `createForAdmin` sets it to `admin` itself, so an
 * admin-issued row can never claim an account issuer.
 */
export interface CreateBusinessOsInviteInput {
  token_hash: string;
  email: string;
  invite_type: string;
  grant_kind: BusinessOsInviteGrantKind;
  grant_id: string;
  access_open_ended: boolean | null;
  access_months: number | null;
  issuer_admin_id: string;
  inviter_display_name: string;
  language: string;
  personal_note: string | null;
  internal_reason: string;
  link_expiry_days: number;
  link_expires_at: string;
  /**
   * Slice 2a (D-2): the issuing admin's own auth email, lower-cased, taken from
   * the gate and never from the request body. `null` when the gate has none;
   * the invitation then goes out with no Reply-To.
   */
  inviter_reply_to: string | null;
  /** Slice 2a (D-5): stamped at insert when an invitation email is requested. */
  email_attempted_at: string | null;
}

/**
 * Slice 2a (D-6): how one invitation send ended, recorded by a compare-and-swap
 * on the invite id AND the hash of the link that was emailed, so an outcome
 * for a link that has since been replaced (Slice 2b) changes nothing.
 */
export interface RecordInviteEmailOutcomeInput {
  id: string;
  tokenHash: string;
  now: Date;
  outcome:
    | { kind: 'sent'; providerMessageId: string | null }
    | { kind: 'problem'; problem: string; detail: string | null };
}

/**
 * Slice 5a (F5a-6, F5a-7): what `business_os_create_friend_invite` is called
 * with. The explicit allow-list: the issuer comes from the session, and the
 * cohort, type, grant, allowance, limits, expiry and reason from config. Only
 * the email, note and language come from the champion's (validated) request.
 */
export interface CreateFriendInviteInput {
  issuerAccountId: string;
  issuerCohort: string;
  inviteType: string;
  grantId: string;
  allowance: number;
  dailyLimit: number;
  dailyWindowHours: number;
  tokenHash: string;
  email: string;
  inviterDisplayName: string;
  inviterReplyTo: string | null;
  language: string;
  personalNote: string | null;
  internalReason: string;
  linkExpiryDays: number;
}

/** How the send function answered (T-17). `created` carries the new id and the stamped expiry. */
export type CreateFriendInviteResult =
  | { outcome: 'created'; inviteId: string; linkExpiresAt: string }
  | { outcome: 'not_eligible' | 'allowance_reached' | 'daily_limit' | 'already_invited' };

/**
 * Slice 5a (F5a-9): one invite as the CHAMPION's list reads it. The last three
 * columns are read only to derive the status and the allowance; the route never
 * returns them.
 */
export interface BusinessOsFriendInviteListRow {
  id: string;
  email: string;
  created_at: string;
  link_expires_at: string;
  revoked_at: string | null;
  redeemed_at: string | null;
  claimed_account_id: string | null;
}

/** Slice 5a (F5a-8): a champion's revoke of their own invite. */
export interface RevokeFriendInviteInput {
  id: string;
  issuerAccountId: string;
  reason: string;
  now: Date;
  /** A claim made at or after this instant is LIVE, and blocks the revoke (I-2). */
  claimLeaseCutoff: Date;
}

/**
 * Admin delete AD-2a: revoke every PENDING invite one account issued, after an
 * admin deleted that account's business (SA AC2-9). `issuerAccountId` is the
 * deleted business's account (validated as a UUID by the repository).
 */
export interface RevokePendingIssuerInvitesByAdminInput {
  issuerAccountId: string;
  adminId: string;
  /** At least 3 characters (CHECK `business_os_invites_revocation_complete`). */
  reason: string;
  now: Date;
  /** A claim made at or after this instant is LIVE: that invite is skipped (BQ-3). */
  claimLeaseCutoff: Date;
}

/** A revoke, as the conditional UPDATE needs it. */
export interface RevokeBusinessOsInviteInput {
  id: string;
  adminId: string;
  reason: string;
  now: Date;
  /**
   * Slice 1b (I-2): a claim made at or after this instant is LIVE, and a live
   * claim cannot be revoked (`signup_in_progress`).
   */
  claimLeaseCutoff: Date;
}

/**
 * One invite as the SIGNUP routes read it (Slice 1b), by token hash only.
 *
 * Carries the invitee email because the account is created for exactly that
 * address (email lock), and the code/claim counters the routes decide on. It is
 * never returned to a visitor as-is: the routes build their own allow-listed
 * responses.
 */
export interface BusinessOsInviteRedemptionView {
  id: string;
  email: string;
  invite_type: string;
  issuer_kind: 'admin' | 'account';
  /** Slice 5b: the champion who sent a friend invite (NULL on an admin invite). */
  issuer_account_id: string | null;
  /**
   * N-1: the auth user id of the admin who issued an admin invite (NULL on a
   * friend invite), so that admin can be told it was accepted. Server-side
   * only: never returned by a redemption route (SA C-2, pinned by test).
   */
  issuer_admin_id: string | null;
  grant_kind: BusinessOsInviteGrantKind;
  grant_id: string;
  access_open_ended: boolean | null;
  access_months: number | null;
  language: string;
  link_expires_at: string;
  revoked_at: string | null;
  redeemed_at: string | null;
  signup_code_hash: string | null;
  signup_code_expires_at: string | null;
  signup_code_attempts: number;
  signup_code_sent_count: number;
  signup_code_window_started_at: string | null;
  signup_code_last_sent_at: string | null;
  claimed_at: string | null;
  claimed_account_id: string | null;
}

/**
 * Store a freshly issued code: a compare-and-swap on the send count AND the
 * last-sent time observed with the row (SA MF-2), on a still-pending,
 * unexpired invite with no live claim.
 */
export interface IssueSignupCodeInput {
  id: string;
  observedSentCount: number;
  /**
   * `signup_code_last_sent_at` as read with the row (`null` before the first
   * code). The count alone is not enough: at a 24 h rollover every parallel
   * request resets the count to the same value, so only the last-sent time
   * tells the first writer from the rest.
   */
  observedLastSentAt: string | null;
  claimLeaseCutoff: Date;
  codeHash: string;
  expiresAt: Date;
  sentCount: number;
  windowStartedAt: Date;
  now: Date;
}

/** Count one attempt (a compare-and-swap on the observed attempt count and the live code). */
export interface CountSignupCodeAttemptInput {
  id: string;
  observedAttempts: number;
  codeHash: string;
  now: Date;
}

/** Clear the code and claim the invite for a server-generated account id (R-1, D-dev-1). */
export interface ClaimInviteForSignupInput {
  id: string;
  codeHash: string;
  accountId: string;
  /** The `claimed_account_id` read with the row: `null` for a first claim, the stale claimant otherwise (I-6). */
  observedClaimedAccountId: string | null;
  now: Date;
  claimLeaseCutoff: Date;
}

/**
 * Claim the invite for a server-generated account id after a verified Google
 * ID token proved the mailbox (Slice 3b, D-3). Every condition of the code
 * claim except the code hash; any outstanding code is cleared with the claim.
 */
export type ClaimInviteForGoogleSignupInput = Omit<ClaimInviteForSignupInput, 'codeHash'>;

/** The FR-12a record (SA D-2). Every value already scrubbed by the caller. */
export interface RecordRedemptionFailureInput {
  id: string;
  claimedAccountId: string;
  step: string;
  errorCode: string | null;
  errorMessage: string | null;
  failedAccountId: string | null;
  now: Date;
}

/** One lineage row, as the admin list reads it (Slice 1b; parent from Slice 5b). */
export interface BusinessOsAccountLineageLevel {
  account_id: string;
  invite_id: string | null;
  level: number;
  /** NULL for an L1 champion (`admin_invite`); the inviting account for L2+ (FR-36). */
  parent_account_id: string | null;
  /**
   * Plan payments P-5b.2 (FR-25, S5-8): what the admin paid line needs. The
   * hold predicate reads `source` and `first_paid_at`; `first_payment_ref` is
   * the invoice id the money history is matched on, together with the account.
   * Never a date or an amount shown from here (AC-F2.2).
   */
  source: 'admin_invite' | 'account_invite' | 'organic';
  first_paid_at: string | null;
  first_payment_ref: string | null;
}

/**
 * Slice 5b (T-13 layer 2): what the payment hold reads about ONE account's own
 * lineage row. Nothing about its parent or its tree.
 */
export interface BusinessOsAccountHoldFacts {
  invite_id: string | null;
  source: 'admin_invite' | 'account_invite' | 'organic';
  first_paid_at: string | null;
}

/**
 * Plan payments P-5b.2 (P5-C10): the same hold facts for MANY accounts at once,
 * keyed by the account, for the shadow report and the launch dry run (admin
 * only). Read in batches, never one `readPaymentHold` per account.
 */
export interface BusinessOsAccountHoldFactsRow extends BusinessOsAccountHoldFacts {
  account_id: string;
}

/**
 * Money MK-5b (§5.1, G-2): where an account came from, for the admin Finance
 * Converted this month list. `first_paid_at` is a cross-check only.
 */
export interface BusinessOsAccountSignupSourceRow {
  account_id: string;
  source: BusinessOsAccountHoldFacts['source'];
  /** The lineage `first_paid_at` stamp, renamed here so the stamp's own name stays with its known readers (P5-C4). */
  stamped_at: string | null;
}

/**
 * Plan payments P-5b.2 (S5-8, SA C-11): one (account, invoice) pair the admin
 * paid line asks the money history about. Both come from the SAME lineage row
 * (`account_id`, `first_payment_ref`), and a money row is kept only when it
 * matches both.
 */
export interface BusinessOsPaidInvoicePair {
  accountId: string;
  invoiceId: string;
}

/**
 * Plan payments P-5b.2 (FR-25): one paid plan invoice from
 * `business_os_billing_events`, as the admin paid line shows it. The amount is
 * what was paid, tax included (Stripe `amount_paid`), in minor units of USD.
 */
export interface BusinessOsPaidInvoiceFacts {
  accountId: string;
  invoiceId: string;
  amountMinor: number;
  amountTaxMinor: number | null;
  currency: 'usd';
  paidAt: string;
  livemode: boolean;
}

/**
 * Slice 5b: the invite facts the payment hold and its screen need. `grant_id`
 * (P-9.2, SA C-5) is the tier an admin Paid invite sells; NOT NULL in the
 * schema, and an empty one makes the hold unreadable, never a held result
 * with no tier.
 */
export interface BusinessOsInviteHoldFacts {
  grant_kind: BusinessOsInviteGrantKind;
  grant_id: string;
  language: string;
}

/**
 * Plan payments P-5b.1 (N-2, SA S5-5 c): what the "your friend subscribed"
 * email needs about ONE invite: who issued it, the address they typed, and who
 * redeemed it (the cross-check against the paying account). Nothing else.
 * P-9.2 (T10, SA Q-10): also the issuing admin and the grant kind, so an
 * admin PAID invitee's first payment tells the admin who issued it (a
 * champion's cohort invite owes nobody that email).
 */
export interface BusinessOsInviteNotificationFacts {
  issuer_kind: 'admin' | 'account';
  issuer_account_id: string | null;
  issuer_admin_id: string | null;
  grant_kind: BusinessOsInviteGrantKind;
  email: string;
  redeemed_account_id: string | null;
}

/**
 * Slice 5b (T-19): what `business_os_finalise_friend_invite_redemption`
 * answered. `finalised` and `already_finalised` carry the invite id and the
 * level written; the refusals carry neither.
 */
export type FriendFinaliseOutcome =
  | { outcome: 'finalised' | 'already_finalised'; inviteId: string; level: number }
  | { outcome: 'issuer_not_eligible' | 'not_matched' };

/**
 * Plan payments P-9.1 (SA-P9): what `business_os_finalise_admin_paid_invite_redemption`
 * answered. The friend's outcome without `level` (always 1 for an admin
 * invite) and without `issuer_not_eligible` (an admin issuer is not re-checked
 * in SQL; redemption re-checks the switch and the shape first).
 */
export type AdminPaidFinaliseOutcome =
  | { outcome: 'finalised' | 'already_finalised'; inviteId: string }
  | { outcome: 'not_matched' };

// ============================================================================
// Data export jobs (DE-8a, table business_os_data_exports, migration 20261074)
// ============================================================================

/** `queued` is reserved for Phase 2 and never written in Phase 1. */
export type DataExportJobStatus = 'queued' | 'running' | 'ready' | 'failed' | 'expired';
export type DataExportFailureReason = 'over_ceiling' | 'timeout' | 'error';
export type DataExportRequesterKind = 'owner' | 'admin';

/** One export job. Dates, counts and bytes only, never exported content (§0.4.1 E). */
export interface DataExportJob {
  id: string;
  user_id: string;
  /** The auth user id of whoever started it: the owner, or the admin from the session (SA Q-2). */
  requested_by: string;
  requested_by_kind: DataExportRequesterKind;
  status: DataExportJobStatus;
  failure_reason: DataExportFailureReason | null;
  bytes: number | null;
  file_count: number | null;
  row_count: number | null;
  created_at: string;
  finished_at: string | null;
  ready_at: string | null;
  expires_at: string | null;
  expired_at: string | null;
  owner_downloaded_at: string | null;
  updated_at: string;
}

/** What the start function answered. `retryAt` is when the refusal stops applying. */
export type DataExportStartOutcome =
  | { outcome: 'started'; jobId: string }
  | { outcome: 'in_progress'; retryAt: string }
  | { outcome: 'daily_limit'; retryAt: string };

/** Sizes recorded when a job finishes. */
export interface DataExportJobCounts {
  bytes: number;
  fileCount: number;
  rowCount: number;
}

/** The cross-account sweep reads (cron only): just enough to scope each effect by the row's own owner. */
export interface DataExportJobRef {
  id: string;
  user_id: string;
}

/**
 * DE-10a (SA-2, W10-6): a sweep row with its requester kind, so the cron puts
 * the audit row of an admin-prepared job off the owner's account. Typed as the
 * stored kind, but the sweep treats any other value as admin (fails toward hidden).
 */
export interface DataExportSweepRef extends DataExportJobRef {
  requested_by_kind: DataExportRequesterKind;
}

export interface DataExportJobState extends DataExportJobRef {
  status: DataExportJobStatus;
}

// ============================================================================
// Data export files and the export bucket (DE-8b)
// ============================================================================

/**
 * A listing budget shared (mutated) across calls: a wall-clock deadline and a
 * number of storage calls left. Hitting it gives `truncated: true`.
 */
export interface ExportFileBudget {
  deadlineAt: number;
  callsLeft: number;
}

/** One stored object of the owner, as the listing reported it. */
export interface ExportOwnerObject {
  /** The full storage key, always `${userId}/...`. Internal: never written to the zip. */
  key: string;
  /** `metadata.size`; 0 when the listing did not say (the real bytes are counted on download). */
  size: number;
  contentType: string | null;
}

export interface ExportOwnerObjects {
  objects: ExportOwnerObject[];
  /** Names dropped as unsafe (F-3); should always be 0. */
  rejected: number;
  truncated: boolean;
}

/** The uuid folders at a bucket's root (the size watch). */
export interface ExportOwnerFolders {
  owners: string[];
  /** Root entries that are not a uuid folder (never descended). */
  skipped: number;
  truncated: boolean;
}

/** A live `contact_documents` row, for matching files (never exported as such). */
export interface ExportLiveDocumentFile {
  id: string;
  contact_id: string | null;
  storage_path: string | null;
  storage_bucket: string | null;
  file_name: string | null;
  mime_type: string | null;
}

/** A `user_media` row's id and key, for linking pictures to records. */
export interface ExportMediaPath {
  id: string;
  storage_path: string | null;
}

/** One `{user_id}/{job_id}/1.zip` found by the export bucket sweep. */
export interface ExportBucketObject {
  userId: string;
  jobId: string;
  /** ISO timestamp, or null when Storage did not say (kept, never guessed). */
  createdAt: string | null;
}

export interface ExportBucketListing {
  objects: ExportBucketObject[];
  /** Anything not shaped `{uuid}/{uuid}/1.zip`: counted, never removed (SA C-10). */
  unexpected: number;
  truncated: boolean;
}
