# Business OS Purge — Cron Register (AC-25 input)

> **Last Updated**: 2026-10-05

## Overview

Purge slice 3b (task T3b-5, FR-14). For every cron `vercel.json` schedules, this names **where it finds work** (its tenant-selection predicate) and **which purge level removes that source**. It was verified line by line against the code on branch `feature/purge-slice3b-purge-level` on 2026-10-05.

> ⚠️ **This is input to AC-25, not evidence for it** (SA §12.5). The evidence is the parent workplan's post-rotation live sweep (T28). This register says which rows a cron *should* stop finding. T28 checks that it actually does.

> ⚠️ **The requirement's "six crons" is stale.** `vercel.json` schedules **13**. The correction is spliced into the requirement (§0.4, slice 3 status).

**Reading the "Starved by" column.** A source is starved by **Reset** when every table it selects from is classified `reset`. It is starved by **Purge only** when the source includes a `purge` table (`business_profiles`, `channel_connections`), which Reset keeps on purpose (§10.2). The classifications are those in `lib/business-os/purge/descriptors.ts`.

---

## The 13 scheduled crons

| # | Cron (`/api/cron/…`) | Schedule | Where it finds work (verified) | Source tables · level | Starved by |
|---|---|---|---|---|---|
| 1 | `calendar-sync` | `*/5 * * * *` | `businessProfileRepository.getUsersWithCalendarSyncEnabled` → `business_profiles` (sync provider set) | `business_profiles` · purge | **Purge only.** After a Reset it returns in about 5 min (FR-26) |
| 2 | `insight-metrics` | `0 3 * * *` | `business_events` select in the route | `business_events` · reset | Both |
| 3 | `insight-detect` | `30 3 * * *` | Four enumeration selects in the route: `payment_invoices`, `scheduling_bookings`, `crm_contacts`, `business_events`. Per-business reads of `business_profiles`, `scheduling_services` and `user_preferences` only decorate a tenant already found | all four · reset | Both |
| 4 | `insight-automations` | `*/5 * * * *` | `AutomationManager.getDueAutomations` → `insight_automations WHERE is_active AND next_check_at due` | `insight_automations` · reset | Both |
| 5 | `insight-actions` | `*/15 * * * *` | `drainInsightActions` → `insightActionRepository.claimDue` (queue) | `insight_actions` · reset | Both |
| 6 | `channel-metrics-sync` | `30 * * * *` | `channelMetricsSyncService.syncDue` → `ChannelConnectionRepository.findDueForSync` | `channel_connections` · purge | **Purge only.** After a Reset it returns on the connection's next sync, up to about 20 h (FR-26) |
| 7 | `payment-reminders` | `40 * * * *` | `billDueDatedStages` → `payment_plan_installments`; `processOverdueItems` → `payment_invoices`; `processDueReminders` → reminder queue `claimDue`; `markAllOverdueInvoices` → `payment_invoices` | `payment_plan_installments`, `payment_invoices`, `payment_reminders` · reset | Both |
| 8 | `intake-reminders` | `15 * * * *` | `intakeReminderService.sendDue` → `scheduling_bookings` | `scheduling_bookings` · reset | Both |
| 9 | `payment-retry` | `0 * * * *` | `processDueRetries` → `payment_invoices`, `payment_plan_installments`; `processScheduledExecutions` → `paymentAutomationExecutionRepository.claimDue` | `payment_invoices`, `payment_plan_installments`, `payment_automation_executions` · reset | Both |
| 10 | `daily-briefing` | `10 * * * *` | `enqueueDueBusinesses` → `business_profiles WHERE daily_briefing_email_enabled`, then the `daily_briefing_sends` queue (`claimDue`) | `business_profiles` · purge; `daily_briefing_sends` · reset | **Purge only.** ⚠️ After a **Reset** the briefing keeps being enqueued and sent (OQ-8: an FR-26 copy question for BA, not slice 3) |
| 11 | `lead-response` | `*/5 * * * *` | `leadResponseRepository.claimDue` (queue); `enqueueApprovedChases` sweeps `business_profiles` with the automation's opt-in column set, then `findGaps` on the business's data | `lead_responses` · reset; `business_profiles` · purge | **Purge** fully. **Reset** empties the queue; the sweep still lists the business, but its gaps read `reset` tables, so it enqueues nothing until new data arrives |
| 12 | `abandoned-proposal-invoices` | `20 * * * *` | `proposals` and `payment_invoices` selects in the route | `proposals`, `payment_invoices` · reset | Both |
| 13 | `credit-leak-check` | `45 4 * * *` | `runCreditLeakCheck`: lists accounts from the plan pages, then reads `token_usage` and `business_os_credit_charges` per account. Read-only; writes no business data | `token_usage`, `business_os_credit_charges` · never | **Neither — correct.** A platform billing check. It must keep seeing a purged account, because the account's charges are retained (`never`) |

## The two public INSERT paths (AC-27)

| Path | Resolves the owner through | Level that removes it | After a Purge or Reset | Test |
|---|---|---|---|---|
| `POST /api/website/analytics/track` | `website_pages` (by subdomain, or by `page_id` for the signed-in owner) | reset | 404 before any insert | `app/api/website/analytics/track/__tests__/route.test.ts` |
| `GET /go/[code]` | `smart_links` (by code) | reset | Redirect to `/go/unavailable?reason=notfound`, no click recorded | `app/go/[code]/__tests__/route.test.ts` |

Both tests are structural: they prove the route inserts nothing when the lookup finds nothing. The live half (a real request after a real Purge, plus `agent_memories`, C-32) is in T28.

## Notes found during verification

- **Direct Supabase calls outside repositories (CLAUDE.md rule 1).** Several cron paths read with `supabaseServer.from(...)` directly: `insight-metrics`, `insight-detect` and `abandoned-proposal-invoices` in the route, and `DailyBriefingDispatchService`, `LeadResponseDispatchService`, `PaymentRetryService` and `PaymentReminderService` in services. They are pre-existing, and slice 3b does not touch them. They are recorded here so the predicates above can be found.
- **`insight-detect`'s `.limit(500)` with no pagination** is the pre-existing coverage bug FU-16 (requirement §6.3). It does not change which level starves the cron.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-05 | Created (Dev, purge slice 3b T3b-5) | All 13 `vercel.json` crons verified against the code. The workplan §8 draft held, with two corrections: `credit-leak-check` reads `token_usage` and `business_os_credit_charges` (not the charges table alone), and `lead-response`'s sweep reads `business_profiles` through the automation opt-in column |
