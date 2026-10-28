// lib/repositories/index.ts
// Export all repositories and types

// Repositories
export { AgentRepository, agentRepository } from './AgentRepository';
// No singleton (RLS slice 2c-1, SA R-8): its old default was the browser
// client, which on the server talks to the database as `anon`. Construct it
// with the caller's client.
export { ExecutionRepository } from './ExecutionRepository';
export { AgentMetricsRepository, agentMetricsRepository } from './AgentMetricsRepository';
export { ConfigRepository, configRepository } from './ConfigRepository';
export { MemoryRepository, memoryRepository } from './MemoryRepository';
export { PluginConnectionRepository, pluginConnectionRepository } from './PluginConnectionRepository';
export { SystemConfigRepository, systemConfigRepository } from './SystemConfigRepository';
export { AiModelPricingRepository, aiModelPricingRepository } from './AiModelPricingRepository';
export { AiModelImagePricingRepository, aiModelImagePricingRepository } from './AiModelImagePricingRepository';
export { AiPriceProposalRepository, aiPriceProposalRepository } from './AiPriceProposalRepository';
export { AiPriceApplyRepository, aiPriceApplyRepository } from './AiPriceApplyRepository';
export { BoostPackRepository, boostPackRepository } from './BoostPackRepository';
export { ExchangeRatesRepository, exchangeRatesRepository } from './ExchangeRatesRepository';
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
// Business OS credit ledger, any service (credit deduction slice 3b-i). Server-only,
// service role, write-only through one RPC; no caller until slice 3b-ii — a
// source guard in its test enforces that, barrel included.
export {
  BusinessOsCreditChargeRepository,
  businessOsCreditChargeRepository,
  BOS_RECORD_CREDIT_CHARGE_RPC,
} from './BusinessOsCreditChargeRepository';
export type {
  BusinessOsCreditChargeInput,
  BusinessOsCreditChargeWriteResult,
  BusinessOsCreditChargeTrigger,
  BusinessOsCreditChargeAnchorSource,
} from './BusinessOsCreditChargeRepository';
// Business OS credit ledger, READ-ONLY (credit deduction slice 4a): the operator
// cost report's reads. Server-only, service role, no write method.
export {
  BusinessOsCreditLedgerReadRepository,
  businessOsCreditLedgerReadRepository,
  CREDIT_LEDGER_ROW_COLUMNS,
  CREDIT_TOTALS_COLUMNS,
  CREDIT_LEDGER_READ_LIMITS,
  CHARGE_LIST_LIMITS,
} from './BusinessOsCreditLedgerReadRepository';
export type {
  CreditLedgerRow,
  CreditTotalsRow,
  CreditPeriodStartRange,
  CreditLedgerPageOptions,
  CreditLedgerPagedResult,
  ChargeListSort,
  ChargeListFilter,
  ChargeListOptions,
  ChargeListPage,
} from './BusinessOsCreditLedgerReadRepository';
// Admin finance & business health page (slice 1a): read-only, service role,
// (its billing status and revenue head count reads were removed by R4-FU-1);
// slice 2a adds the businesses' client payments and refunds
// (layer B); slice 4a adds the platform's boost purchases; slice 5a its paid
// plan invoices. No write method.
export {
  BusinessOsFinanceReadRepository,
  businessOsFinanceReadRepository,
  FINANCE_BOOST_PURCHASE_COLUMNS,
  FINANCE_PLAN_PAYMENT_COLUMNS,
  FINANCE_CLIENT_INSTALMENT_DUE_COLUMNS,
  FINANCE_CLIENT_INVOICE_DUE_COLUMNS,
  FINANCE_CLIENT_PAYMENT_COLUMNS,
  FINANCE_CLIENT_PLAN_COLUMNS,
  FINANCE_CLIENT_REFUND_COLUMNS,
  FINANCE_READ_LIMITS,
} from './BusinessOsFinanceReadRepository';
export type {
  FinanceBillingStatusRow,
  FinanceBoostPurchaseRow,
  FinanceClientDueRow,
  FinanceClientPaymentRow,
  FinanceClientPlanRow,
  FinanceClientRange,
  FinanceClientReadOptions,
  FinanceClientReadResult,
  FinanceClientRefundRow,
  FinancePlanPaymentRow,
} from './BusinessOsFinanceReadRepository';
// Business OS credit ledger, the OWNER'S OWN read (credit deduction slice 6a):
// the dashboard card. Takes the caller's RLS client (required, so no singleton);
// owner-granted columns only; no write method.
export {
  BusinessOsCreditOwnerReadRepository,
  OWNER_TOTALS_COLUMNS,
  OWNER_CHARGE_COLUMNS,
  OWNER_CREDIT_READ_LIMITS,
} from './BusinessOsCreditOwnerReadRepository';
export type { OwnerCreditTotalsRow, OwnerCreditChargeRow, OwnerCeilingResult } from './BusinessOsCreditOwnerReadRepository';
// The credit period key from the database's own rule (slice 6a). Service role:
// the function's EXECUTE is service_role only, and it reads no table.
export { BusinessOsCreditPeriodRepository, businessOsCreditPeriodRepository } from './BusinessOsCreditPeriodRepository';
// Business OS credit lots (credit deduction slice 11a): credits added to an
// account and taken back. Server-only, service role, append-only through two
// RPCs; no caller until 11b — a source guard enforces that, barrel included.
export {
  BusinessOsCreditLotRepository,
  businessOsCreditLotRepository,
  BOS_RECORD_CREDIT_LOT_RPC,
  BOS_REVERSE_CREDIT_LOT_RPC,
  CREDIT_LOT_COLUMNS,
  CREDIT_LOT_DRAW_COLUMNS,
  CREDIT_LOT_READ_LIMITS,
} from './BusinessOsCreditLotRepository';
export type {
  BusinessOsCreditLot,
  BusinessOsCreditLotRow,
  BusinessOsCreditLotDrawRow,
  BusinessOsCreditLotInput,
  BusinessOsCreditLotRecordResult,
  BusinessOsCreditLotReverseInput,
  BusinessOsCreditLotReverseResult,
  BusinessOsCreditLotReverseStatus,
  BusinessOsCreditLotSource,
  BusinessOsCreditLotActorKind,
} from './BusinessOsCreditLotRepository';
// Business OS billing record (plan payments P-2a): the Business OS Stripe
// customer per account per mode. Server-only, service role, no client grant;
// one caller (businessOsStripeCustomer.ts) — a source guard enforces that,
// barrel included.
export {
  BusinessOsBillingAccountRepository,
  businessOsBillingAccountRepository,
  BILLING_ACCOUNT_COLUMNS,
  BOS_BILLING_ACCOUNTS_TABLE,
} from './BusinessOsBillingAccountRepository';
export type {
  BusinessOsBillingAccount,
  BusinessOsBillingCustomerInput,
  BusinessOsBillingCustomerRecordResult,
  BusinessOsSubscriptionStatus,
} from './BusinessOsBillingAccountRepository';
// Business OS boost purchases and cap overrides (credits boost slice 2a).
// Server-only, service role; written only through five RPCs. The two
// `…ForWebhook` finders are unscoped by design (R-6) and guarded (SA C-5).
export {
  BusinessOsBoostPurchaseRepository,
  businessOsBoostPurchaseRepository,
  BOS_RESERVE_BOOST_PURCHASE_RPC,
  BOS_ATTACH_BOOST_CHECKOUT_RPC,
  BOS_ABANDON_BOOST_PURCHASE_RPC,
  BOS_SET_BOOST_CAP_OVERRIDE_RPC,
  BOS_END_BOOST_CAP_OVERRIDE_RPC,
  BOOST_PURCHASE_COLUMNS,
  BOOST_CAP_OVERRIDE_COLUMNS,
  BOOST_PURCHASE_READ_LIMITS,
  BOOST_PURCHASE_STATUSES,
  BOS_CREDIT_BOOST_PURCHASE_RPC,
  BOS_TRANSITION_BOOST_PURCHASE_RPC,
  BOS_RECORD_BOOST_RECEIPT_RPC,
  BOOST_FLAG_REASONS,
  BOOST_TRANSITION_TARGETS,
} from './BusinessOsBoostPurchaseRepository';
export type {
  BusinessOsBoostPurchase,
  BusinessOsBoostPurchaseStatus,
  BusinessOsBoostReservationInput,
  BusinessOsBoostReservationResult,
  BusinessOsBoostAttachStatus,
  BusinessOsBoostAbandonStatus,
  BusinessOsBoostCapOverride,
  BusinessOsBoostCapOverrideInput,
  BusinessOsBoostSetCapOverrideResult,
  BusinessOsBoostEndCapOverrideResult,
  BusinessOsBoostCreditInput,
  BusinessOsBoostCreditResult,
  BusinessOsBoostFlagReason,
  BusinessOsBoostTransitionInput,
  BusinessOsBoostTransitionResult,
  BusinessOsBoostTransitionStatus,
  BusinessOsBoostTransitionTarget,
  BusinessOsBoostReceiptStatus,
} from './BusinessOsBoostPurchaseRepository';
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
// Admin reorganisation slice 5: the cron run record (writer: lib/cron/cronRunRecorder.ts
// only) and the admin-only, cross-account jobs & queues reads (app/api/admin/** only).
// Source guards enforce both, barrel included.
export { BosCronRunRepository, bosCronRunRepository } from './BosCronRunRepository';
export { AdminJobsQueuesRepository, adminJobsQueuesRepository } from './AdminJobsQueuesRepository';
// ADMIN_BOS_CLEANUP slice 7b: the one admin write to a live queue row (cancel one
// item). Its ONLY permitted caller is app/api/admin/jobs-queues/items/action/route.ts;
// a source guard enforces it, barrel exempt (AdminQueueActionsRepository.test.ts R-9).
export { AdminQueueActionsRepository, adminQueueActionsRepository } from './AdminQueueActionsRepository';
// Admin Archiving, read-only in Slice 1 (docs/workplans/ADMIN_ARCHIVING_SLICE_1_UI_WORKPLAN.md)
export { ArchiveRepository, archiveRepository } from './ArchiveRepository';
export type {
  ArchiveBatchCounts,
  ArchiveRunRow,
  ClaimRunResult,
  CreateRunResult,
} from './ArchiveRepository';
// S-6 free-tier grant (docs/workplans/ALLOCATE_FREE_TIER_S6_FIX_WORKPLAN.md)
export { UserSubscriptionRepository, userSubscriptionRepository } from './UserSubscriptionRepository';
// CF-5 PR 1: the Stripe webhook's idempotency claim table (processed_webhook_events).
export { ProcessedWebhookEventRepository, processedWebhookEventRepository } from './ProcessedWebhookEventRepository';
export type {
  NewWebhookClaimRow,
  ProcessedWebhookEventColumns,
  WebhookClaim,
  WebhookClaimResult,
  WebhookClaimStatus,
} from './ProcessedWebhookEventRepository';
// The refund ledger (payment_refunds): the Stripe refund webhook's reads and
// writes, and RefundService's post-reply compare-and-set writes.
export { PaymentRefundRepository, paymentRefundRepository, STRIPE_REFUND_MATCH_COLUMNS } from './PaymentRefundRepository';
export type {
  ExpectedRefundState,
  NewWebhookRefundRow,
  PaymentRefundResult,
  StripeRefundLedgerRow,
  StripeRefundMatch,
  StripeRefundStatePatch,
} from './PaymentRefundRepository';
// CF-5 PR 5: the Stripe webhook's agent-platform legacy writes (billing_events,
// boost_pack_purchases) and the types of the legacy sections it added to
// UserSubscriptionRepository and SystemConfigRepository.
export { BillingEventRepository, billingEventRepository } from './BillingEventRepository';
export type { BillingEventResult, NewLegacyBillingEventRow } from './BillingEventRepository';
export {
  LegacyBoostPackPurchaseRepository,
  legacyBoostPackPurchaseRepository,
} from './LegacyBoostPackPurchaseRepository';
export type {
  LegacyBoostPackPurchaseResult,
  NewLegacyBoostPackPurchaseRow,
} from './LegacyBoostPackPurchaseRepository';
export type {
  LegacyBalance,
  LegacyDunningState,
  LegacyDunningStatus,
  LegacyWebhookResult,
} from './UserSubscriptionRepository';
export type { LegacyWebhookConfigKey, LegacyWebhookConfigResult } from './SystemConfigRepository';
// CF-5 PR 3: the types of PaymentTransactionRepository's Stripe webhook section (payment_transactions).
export type {
  NewWebhookTransactionRow,
  WebhookDisputeState,
  WebhookStripeReference,
  WebhookTransactionByIntentColumns,
  WebhookTransactionByReferenceColumns,
  WebhookTransactionFields,
  WebhookTransactionResult,
} from './PaymentRepository';
export type {
  LedgerCallRow,
  LedgerLabelRow,
  LedgerSummaryRow,
  TokenUsageFeatureFilter,
  TokenUsageMatch,
  TokenUsageWindow,
  UsageSummaryRpcRow,
} from './TokenUsageRepository';
// Business OS invites (invite-only signup, Slice 0). Admin-scoped and
// token-scoped methods only; see the repository header (C-13).
export { BusinessOsInviteRepository, businessOsInviteRepository } from './BusinessOsInviteRepository';
export type {
  BusinessOsInvite,
  BusinessOsInviteGrantKind,
  BusinessOsInvitePublicView,
  BusinessOsInviteRedemptionView,
  CreateBusinessOsInviteInput,
  RecordInviteEmailOutcomeInput,
  RevokeBusinessOsInviteInput,
  BusinessOsAccountLineageLevel,
} from './types';
// User preferences (invite signup Slice 2a, C-8): read-only, scoped by user_id.
export { UserPreferencesRepository, userPreferencesRepository } from './UserPreferencesRepository';
// Lineage (Slice 1b). Written only by the finalise function; read by the admin list.
export { BusinessOsAccountLineageRepository, businessOsAccountLineageRepository } from './BusinessOsAccountLineageRepository';
// Data export jobs (DE-8a). Service-role table: per-account methods filter
// (id, user_id); the two sweep reads are cross-account for the DE-8b cron.
export {
  BusinessOsDataExportJobRepository,
  businessOsDataExportJobRepository,
  DATA_EXPORT_JOB_COLUMNS,
  DATA_EXPORT_JOB_LIMITS,
} from './BusinessOsDataExportJobRepository';
export type {
  DataExportJob,
  DataExportJobCounts,
  DataExportJobRef,
  DataExportJobState,
  DataExportSweepRef,
  DataExportJobStatus,
  DataExportFailureReason,
  DataExportRequesterKind,
  DataExportStartOutcome,
} from './types';
// Data export zip bucket (DE-8b): paths only from exportObjectPath. The files
// repository (BusinessDataExportFilesRepository) is deliberately NOT exported
// here: its one importer is lib/business-os/data-export/fileManifest.ts (F-6).
export {
  BusinessOsDataExportStorageRepository,
  businessOsDataExportStorageRepository,
} from './BusinessOsDataExportStorageRepository';
export type { ExportBucketListing, ExportBucketObject, ExportFileBudget } from './types';

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
  UserSubscriptionBillingSummary,
  FreeTierNewRowValues,
  FreeTierNewRow,
  FreeTierGrantPatch,
  FreeTierInsertOutcome,
  FreeTierUpdateOutcome,
  // AI model pricing types
  AiModelPricing,
  AiModelPricingExactRow,
  AiModelImagePricing,
  AiModelImagePricingExactRow,
  AiPriceSubmitLine,
  AiPriceSubmitInput,
  AiPriceSubmitResultLine,
  AiPricePendingLine,
  AiPriceDecisionLine,
  AiPriceApplyLineInput,
  AiPriceApplyMargin,
  AiPriceApplyResultRow,
  AiPriceOpenMarginReview,
  AiModelPricingHistoryRow,
  AiModelImagePricingHistoryRow,
  PriceHistoryRowsPage,
  AiPriceAppliedLineRecord,
  AiPriceApplyBatchRecord,
  // Boost pack (agent-platform catalog) types
  BoostPack,
  BoostPackWriteInput,
  // Exchange rates (admin-maintained platform table) types
  ExchangeRateRow,
  ExchangeRateHistoryRow,
} from './types';

export { AgentStatusEnum, STATUS_TRANSITIONS } from './types';

// Memory types (exported from repository file)
export type { RunMemory } from './MemoryRepository';