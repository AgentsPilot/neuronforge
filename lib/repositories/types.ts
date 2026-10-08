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

  // Legacy / wider Agent fields (kept for forward-compat — repository spreads input directly)
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
  effective_date: string;
  retired_date: string | null;
  created_at: string;
}

/** Everything needed to insert one pricing row. The caller owns the clock. */
export interface CreateAiModelPricingInput {
  provider: string;
  model_name: string;
  input_cost_per_token: number;
  output_cost_per_token: number;
  effective_date: string;
}

/** One catalogue entry handed to `syncMany`. Same shape as an insert. */
export type AiModelPricingSyncEntry = CreateAiModelPricingInput;

/** Per-model outcome of a sync run; the values are model names. */
export interface AiModelPricingSyncResult {
  updated: string[];
  created: string[];
  failed: string[];
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
 */
export interface BusinessOsInvitePublicView {
  id: string;
  issuer_kind: 'admin' | 'account';
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

/** Slice 5b: the two invite facts the payment hold and its screen need. */
export interface BusinessOsInviteHoldFacts {
  grant_kind: BusinessOsInviteGrantKind;
  language: string;
}

/**
 * Slice 5b (T-19): what `business_os_finalise_friend_invite_redemption`
 * answered. `finalised` and `already_finalised` carry the invite id and the
 * level written; the refusals carry neither.
 */
export type FriendFinaliseOutcome =
  | { outcome: 'finalised' | 'already_finalised'; inviteId: string; level: number }
  | { outcome: 'issuer_not_eligible' | 'not_matched' };
