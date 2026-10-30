/**
 * Feature Flags Utility
 *
 * Centralized feature flag management for gradual rollouts and A/B testing.
 */

import { clientLogger } from '@/lib/logger/client';

// C-33: the parser now lives in a zero-import module so server code can share
// the same rules without importing this module's dependency graph.
import { parseBooleanFlag } from '@/lib/utils/parseBooleanFlag';

/**
 * Check if thread-based agent creation flow is enabled
 *
 * @returns {boolean} True if thread-based flow should be used, false to use legacy flow
 */
export function isThreadBasedAgentCreationEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION;
  clientLogger.debug({ flag: 'NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION', value: flag ?? null }, 'Feature flag evaluated');
  return parseBooleanFlag(flag);
}

// Retired 2026-05-31: USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW
// flag + useEnhancedTechnicalWorkflowReview() helper were a rollout safety net
// for picking between V4 (standard) and V5 (LLM-reviewed) generators inside
// /api/generate-agent-v4. Git log shows the flag was never enabled in any
// commit since its introduction (c29c93f), and the V4 route itself is now the
// dormant fallback when NEXT_PUBLIC_USE_V6_AGENT_GENERATION=true (V6 is the
// production primary). Route collapsed to V4-only; V5WorkflowGenerator source
// kept for now (broader V4/V5 stack retirement is a separate cleanup).

/**
 * Check if new conversational UI V2 is enabled
 *
 * @returns {boolean} True if new UI should be used, false to use legacy UI
 */
export function isNewAgentCreationUIEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI;
  clientLogger.debug({ flag: 'NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI', value: flag ?? null }, 'Feature flag evaluated');
  return parseBooleanFlag(flag);
}

/**
 * Check if V6 agent generation is enabled
 *
 * When enabled, the agent creation flow will use the V6 5-phase pipeline
 * (semantic plan → grounding → formalization → compilation → validation)
 * instead of the V4 direct generation approach.
 *
 * @returns {boolean} True if V6 generation is enabled, false otherwise
 */
export function isV6AgentGenerationEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_V6_AGENT_GENERATION;
  clientLogger.debug({ flag: 'NEXT_PUBLIC_USE_V6_AGENT_GENERATION', value: flag ?? null }, 'Feature flag evaluated');
  return parseBooleanFlag(flag);
}

/**
 * Check if V6 Review Mode is enabled
 *
 * When enabled, V6 agent generation uses split API flow with user review UI:
 * - API 1: generate-semantic-grounded (P1+P2+Detection)
 * - Review UI: User reviews ambiguities and makes decisions
 * - API 2: compile-with-decisions (P3+P4+P5)
 *
 * When disabled, uses single API flow (generate-ir-semantic) without review.
 *
 * NOTE: This flag only has effect when NEXT_PUBLIC_USE_V6_AGENT_GENERATION=true.
 * NOTE: This flag defaults to TRUE (enabled) when not set.
 *
 * @returns {boolean} True if review mode enabled, false for direct generation
 */
export function isV6ReviewModeEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_V6_REVIEW_MODE;
  clientLogger.debug({ flag: 'NEXT_PUBLIC_USE_V6_REVIEW_MODE', value: flag ?? null, default: true }, 'Feature flag evaluated');
  // Default to TRUE - review mode is enabled by default
  return parseBooleanFlag(flag, true);
}

/**
 * Move the user to calibration after agent creation.
 *
 * Default OFF. When off, agent creation auto-redirects to the agent page as
 * today. When on, a choice card invites the user to calibrate the new agent
 * before going live (approve → /v2/sandbox/[id]?from=creation, decline →
 * /agents/[id]). Opt-in via NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION=true.
 *
 * @returns {boolean} True if the post-creation calibration prompt should show
 */
export function isMoveToCalibrationAfterCreationEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION;
  clientLogger.debug({ flag: 'NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION', value: flag ?? null, default: false }, 'Feature flag evaluated');
  return parseBooleanFlag(flag, false);
}

// Retired 2026-05-20 (P6): NEXT_PUBLIC_USE_V6_PIPELINE_A flag + useV6PipelineA()
// helper were a rollout safety net for switching the V2 UI from the semantic
// pipeline (Pipeline B) to the IntentContract pipeline (Pipeline A). Pipeline A
// is now the unconditional V6 path. See docs/v6/V6_PIPELINE_A_MIGRATION.md § P6.

/**
 * Check if AI Data Layer is enabled for Business OS Chat
 *
 * When enabled, the Business OS chat uses the new AI Data Layer with
 * autonomous tool calling instead of the hardcoded capability system.
 *
 * Features:
 * - LLM can directly query any entity (contacts, services, bookings, etc.)
 * - LLM can perform mutations with user confirmation
 * - No hardcoded capabilities or switch statements
 * - Multi-language support through natural LLM generation
 *
 * @returns {boolean} True if AI Data Layer is enabled, false for legacy system
 */
export function isAIDataLayerEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_AI_DATA_LAYER;
  clientLogger.debug({ flag: 'NEXT_PUBLIC_USE_AI_DATA_LAYER', value: flag ?? null, default: false }, 'Feature flag evaluated');
  return parseBooleanFlag(flag, false);
}

/**
 * Whether the customer-facing "delete my business" surface should be RENDERED.
 *
 * ⚠️ **THIS IS A RENDERING HINT. IT IS NOT AN AUTHORIZATION BOUNDARY.**
 *
 * Named `…Visible`, not `…Enabled`, on purpose. Its server-side counterpart
 * `isBusinessDeleteSurfaceEnabled()` in `lib/business-os/purge/purgeAuthz.ts`
 * reads the SAME env var and decides what is *permitted*; this one decides only
 * what is *drawn*. The two must never be merged, and the split is enforced by
 * dependencies in both directions: `purgeAuthz` imports `AdminAccessService`,
 * so importing it from here would drag an admin lookup into the client bundle,
 * and importing this module from there would put a rendering hint in charge of
 * an authorization decision. Two identically-named functions would be one
 * autocomplete-assisted import away from exactly that mistake.
 *
 * A `NEXT_PUBLIC_*` value is compiled into the client bundle, and the purge
 * routes are callable directly regardless of what the UI chooses to draw. The
 * boundary is `authorizePurge()` in `lib/business-os/purge/purgeAuthz.ts`,
 * which performs its own server-side read (C-22) and, while this flag is off,
 * restricts the customer-surface Purge to platform admins.
 *
 * **Do not "simplify" `authorizePurge` to call this function.** Doing so would move
 * a destructive-capability check into the client bundle and reopen on the
 * customer surface exactly the hole T30 closed on the internal one. That is not
 * a hypothetical tidy-up: it is the shape this codebase has already shipped
 * more than once. A test in the purge route suite asserts the server refusal,
 * so this note is backed by something that fails rather than by good intentions.
 *
 * Defaults to **off** (D9): un-gating requires the AC-2/5/10/13/16/24/37
 * checklist demonstrated on a real account.
 *
 * @returns {boolean} True if the customer-facing delete surface should render
 */
export function isBusinessDeleteSurfaceVisible(): boolean {
  const flag = process.env.NEXT_PUBLIC_ENABLE_BUSINESS_DELETE;
  return parseBooleanFlag(flag);
}

/**
 * Whether the owner's **Credit history** link and panel are drawn on the
 * Business OS Credits card (credit deduction slice 7a).
 *
 * Parked by the user's decision of 2026-10-02: the history ships committed but
 * dark. **Defaults to off** — unset, blank or anything unrecognised is off.
 *
 * A rendering switch only. The route `GET /api/business-os/credits/history`
 * makes its own server-side read of the same variable
 * (`isCreditHistoryRouteEnabled()` in
 * `lib/business-os/credits/creditHistoryFlag.ts`) and answers 404 while it is
 * off, so the history is unreachable whatever a client draws. Neither reader
 * imports the other (the server one must not pull this module's client logger
 * into a route; this one must not pull server code into the client bundle).
 *
 * The literal `process.env.NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY` access is
 * what lets Next inline the value into the client bundle.
 *
 * @returns {boolean} True if the credit history link should render
 */
export function isBusinessOsCreditHistoryEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY;
  return parseBooleanFlag(flag, false);
}

/**
 * Admin delete's **own off switch** (BQ-1, the user's decision of 2026-10-06):
 * may an admin delete a business from `/admin/users`?
 *
 * **SERVER-ONLY. Default off** — unset, blank or anything unrecognised is off.
 * No `NEXT_PUBLIC_` prefix on purpose: this is a destructive-capability
 * decision, so it must never be compiled into the client bundle, and a client
 * that calls it reads `undefined` (off).
 *
 * Independent of the delete function being installed: even after the
 * service-role key is rotated and `purge_business_data` is applied, admin
 * delete stays off for real customers until "close the login" (AD-3) and the
 * data export ship, and is then turned on deliberately. Read by the admin
 * commit route BEFORE token verification (SA AC2-6) and by the preview, which
 * mints no commit token while it is off (SA T-10).
 *
 * Fail direction: if this module ever stops being importable on the server
 * (see `parseBooleanFlag.ts`'s note), the admin commit route errors (500)
 * rather than deletes.
 *
 * @returns {boolean} True only when `ADMIN_BUSINESS_DELETE_ENABLED` is `true` / `1`
 */
export function isAdminBusinessDeleteEnabled(): boolean {
  const flag = process.env.ADMIN_BUSINESS_DELETE_ENABLED;
  return parseBooleanFlag(flag, false);
}

/**
 * The agent scheduler's off switch: may the platform run agents by the clock?
 *
 * **SERVER-ONLY. Default off** — unset, blank or anything unrecognised is off.
 * No `NEXT_PUBLIC_` prefix: it decides whether the platform writes to a
 * business's clients unprompted, so it is never compiled into a client bundle.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE SCHEDULE SHIPS BEFORE THE SWITCH IS THROWN
 *
 * `/api/run-scheduled-agents` is scheduled in `vercel.json` from the moment
 * this work lands — its guard test records the route being un-retired, and the
 * schedule and that record belong in the same commit. But a live cron on the
 * next deploy would run the adopted agents for real, and their plans send email
 * to real clients.
 *
 * So the schedule lands inert. With this off the pass reaps nothing, queues
 * nothing and runs nothing, and answers with zero counts and no error — which
 * is also how an operator tells a scheduler that is switched off from one that
 * is broken.
 *
 * ⚠️ **Leave it unset until the repeat-send gate is closed.** `sendInvoiceChase`
 * currently performs no writes, so nothing records that a chase was sent;
 * `executeMutate` carries no idempotency claim; and the invoice plan's
 * `sent_at` filter reads the invoice's own send date, which is static. With
 * `daily` among the chaser's cadence choices and `120` among its stop choices,
 * switching this on today risks up to 120 consecutive emails to one client
 * about one invoice.
 *
 * ⚠️ **It also holds back a double-run of the mailbox channel.** That agent is
 * `mode='scheduled'` with `schedule_enabled` set, so this scheduler selects it
 * — proven live on 2026-10-29, when a pass picked it up and ran it correctly
 * through `WorkflowPilot`. But it still has its OWN cron
 * (`/api/cron/inbox-enquiries`) claiming on `last_run` while this one claims on
 * `next_run`, and neither claim excludes the other. Until that cron is retired
 * and its `schedule_cron` is moved from every five minutes to every fifteen
 * (its runner enforces a 15-minute floor today), switching this on means two
 * schedulers reading one mailbox.
 *
 * Validation before then is done with BizQL's dry run, which genuinely performs
 * nothing — it returns before the quota check, the idempotency claim and the
 * send — so the whole chain can be proven while sending zero messages. The
 * chain WAS proven that way: a read-only probe agent went cron → enqueue →
 * claim → pilot → plugin → BizQL, completed in `production` mode, and a second
 * pass re-queued and re-ran nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @returns {boolean} True only when `AGENT_SCHEDULER_ENABLED` is `true` / `1`
 */
export function isAgentSchedulerEnabled(): boolean {
  const flag = process.env.AGENT_SCHEDULER_ENABLED;
  return parseBooleanFlag(flag, false);
}

/**
 * The Business OS credits boost checkout's kill switch (credits boost slice 3,
 * SA F-14): may an owner start a boost purchase at all?
 *
 * **SERVER-ONLY. Default off** — unset, blank or anything unrecognised is off.
 * No `NEXT_PUBLIC_` prefix: it decides whether money can be taken, so it is
 * never compiled into a client bundle.
 *
 * ⚠️ **SA C-1: leave it unset on Vercel (Preview and Production) until slice 4a
 * is merged and deployed.** Before 4a, a paid boost session reaches the
 * agent-platform webhook handler, which no-ops and marks the event completed,
 * so the payment would never be credited. The optional allow-list
 * `BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS` (lib/business-os/boost/
 * boostCheckoutAccess.ts) narrows who passes; it does not change this rule.
 *
 * @returns {boolean} True only when `BUSINESS_OS_CREDITS_BOOST_ENABLED` is `true` / `1`
 */
export function isBusinessOsCreditsBoostEnabled(): boolean {
  const flag = process.env.BUSINESS_OS_CREDITS_BOOST_ENABLED;
  return parseBooleanFlag(flag, false);
}

/**
 * The customer self-delete's off switch (data export DE-10b.2, SA Review 2
 * TQ-10, workplan §2.1): may a signed-in owner delete their own account from
 * Settings → Danger Zone?
 *
 * **SERVER-ONLY. Default off.** On only for the exact string `true`: unset,
 * blank, `1`, `TRUE ` and anything else are off, because this gates an
 * irreversible erasure. No `NEXT_PUBLIC_` prefix: the browser learns the state
 * only from `GET /api/business-os/account/deletion-check`, which answers
 * `{ enabled: false }` while it is off (the Danger Zone keeps today's body),
 * and `POST /api/business-os/account/delete` answers 404.
 *
 * Rollback is unsetting it and redeploying. No data changes with it.
 *
 * @returns {boolean} True only when `BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED` is exactly `true`
 */
export function isAccountSelfDeleteEnabled(): boolean {
  return process.env.BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED === 'true';
}

/**
 * Get all feature flags status.
 *
 * ⚠️ **Debug helper only — it has NO production consumer**, by design. Nothing
 * outside this module and its test suite reads it, and nothing should start:
 * the returned object's type is inferred from this literal, so a key rename is
 * a compile error (TS2339) at every reader — but `next.config.js` sets
 * `typescript.ignoreBuildErrors: true`, so that error would never reach the
 * build. Wiring this into a real feature gate therefore converts a loud failure
 * into a silent "feature is quietly off". Call the individual `is…Enabled`
 * readers instead; they are the supported surface.
 *
 * @returns {object} Object with all feature flags and their status
 */
export function getFeatureFlags() {
  return {
    isThreadBasedAgentCreationEnabled: isThreadBasedAgentCreationEnabled(),
    isNewAgentCreationUIEnabled: isNewAgentCreationUIEnabled(),
    isV6AgentGenerationEnabled: isV6AgentGenerationEnabled(),
    isV6ReviewModeEnabled: isV6ReviewModeEnabled(),
    isMoveToCalibrationAfterCreationEnabled: isMoveToCalibrationAfterCreationEnabled(),
    isAIDataLayerEnabled: isAIDataLayerEnabled(),
    isBusinessDeleteSurfaceVisible: isBusinessDeleteSurfaceVisible(),
    isBusinessOsCreditHistoryEnabled: isBusinessOsCreditHistoryEnabled(),
  };
}

/**
 * TEMPORARY, FOR TESTING: let a package session be marked held before its hour.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS
 *
 * Marking a session held is what RAISES AND EMAILS ITS INVOICE, and the refund
 * it then allows is the next link in the same chain. Neither can be exercised
 * until a session's hour has actually passed — the earliest on a six-week
 * package is weeks out — so the whole money path was untestable without
 * waiting or rewriting dates in the database by hand.
 *
 * WHAT IT CHANGES, AND WHAT IT DOES NOT
 *
 * The clock gate is in the UI only: `MeetingRowActions` withholds both
 * outcomes until `isMeetingPastDue`, because a meeting still ahead cannot have
 * been held any more than it can have been missed. The SERVER never checks the
 * time — `setMeetingOutcome` records what the owner says — so this opens the
 * control and changes nothing else. Everything downstream is the real path:
 * the real stage, the real invoice, the real email.
 *
 * WHICH IS ALSO WHY IT MUST NOT REACH PRODUCTION. With it on, a stray tap on a
 * session three weeks out bills a client for work nobody has done — the exact
 * accident the gate was added to prevent. Off, absent, or any value but
 * `true`, and the gate behaves as it always has.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function isEarlySessionOutcomeEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_ALLOW_EARLY_SESSION_OUTCOME;
  clientLogger.debug(
    { flag: 'NEXT_PUBLIC_ALLOW_EARLY_SESSION_OUTCOME', value: flag ?? null },
    'Feature flag evaluated'
  );
  return parseBooleanFlag(flag);
}
