# Performance Improvement: Scoping (Master Document)

> **Last Updated**: 2026-10-13

**Created by:** BA (from TL framing, with BA refinements)
**Date:** 2026-10-12
**Status:** Draft. User answers recorded (all defaults, §0). SA approved the measurement plan with changes (§0, §5, §5A, §7). Phase 1 may start

## Overview

This is the master document for the platform performance work stream. The team measures where AgentPilot / Business OS is slow, expensive or failing. It ranks those findings by evidence, and the user picks what gets fixed. **Round 1** takes only items that leave the business unchanged: same output, same charges, same timing users rely on, same features, same failure behaviour and same records kept. Anything that would change the business goes on the **Parked: business round** list (§12) for a later round. Every later stage (baseline, ranking, decisions, slices, PRs, re-measurement) is recorded in §0 and in the relevant section of this file.

---

## Table of Contents

- [§0 Status and Decisions Log](#0-status-and-decisions-log)
- [§1 Goal](#1-goal)
- [§2 Non-Goals](#2-non-goals)
- [§3 User Stories](#3-user-stories)
- [§4 Phases and Owners](#4-phases-and-owners)
- [§5 Evidence Sources and Availability](#5-evidence-sources-and-availability)
- [§5A Phase-1 Baseline Runbook (SA)](#5a-phase-1-baseline-runbook-sa)
- [§6 Round-1 Filter (the "business unchanged" test)](#6-round-1-filter-the-business-unchanged-test)
- [§7 Ranking Rubric](#7-ranking-rubric)
- [§8 Definition of Done](#8-definition-of-done)
- [§9 Guardrails](#9-guardrails)
- [§10 Open Business Questions for the User](#10-open-business-questions-for-the-user)
- [§11 Baseline and Ranked List (placeholders)](#11-baseline-and-ranked-list-placeholders)
- [§12 Parked: Business Round](#12-parked-business-round)
- [§13 Open Questions (team-internal)](#13-open-questions-team-internal)
- [§14 Integration Points](#14-integration-points)
- [Change History](#change-history)

---

## §0 Status and Decisions Log

Newest entries at the bottom. Every stage of this stream adds a row here: scoping, SA review, user answers, baseline, ranking, decision points, each PERF slice's PR and merge, re-measurement, deferrals.

| Date | Stage | Entry | By |
|---|---|---|---|
| 2026-10-12 | Phase 0: Scoping | TL framed the stream. BA reviewed it and wrote this master doc. Changes from the TL framing: a 5th filter question (failure behaviour and records kept), a Reach factor in the rubric, test/eval accounts excluded from the baseline, a Round-1 definition of done, a per-slice "no measured gain, no merge" rule, and defaults for every user question. | TL, BA |
| — | Phase 0: SA review | ✅ SA reviewed the measurement plan (§5) and the rubric mechanics (§7). The verdict is in the 2026-10-12 SA row below | SA |
| 2026-10-12 | Phase 0: User answers | ✅ User accepted all §10 defaults ("defaults, go ahead"): Q1 audience order a, b, c, d; Q2 cost counts if output is identical; Q3a read-only prod queries OK; Q3b user exports Vercel function data; Q3c real-user page-load measurement parked (local Lighthouse instead); Q4 team drafts the test/eval account list and the user confirms it; Q5 up to 5 slices or 3 weeks, with a check-in after slice 3 | User |
| 2026-10-12 | Phase 0: SA review | **APPROVED WITH CHANGES.** The measurement plan is sound. SA changes are applied in place. (1) §5 factual fixes: BOS usage rows are `token_usage` rows with `feature = 'business-os-<area>'` and `component = <call name>`. Cron history is `bos_cron_runs` (`source = 'vercel_cron'`). Insight cron schedules corrected from `vercel.json`. (2) New §5 rules 4–6: diff `pg_stat_statements` snapshots instead of resetting; every probe is a single SELECT that calls no function which writes; collect evidence in a set order. (3) New **§5A Phase-1 Baseline Runbook**, 25 ordered read-only steps. (4) §7: numeric band anchors for every factor; C and E now score 0–3 and K scores 0–2, so "none" adds nothing and the divisor cannot reach zero; explicit audience mapping (a = 3, b = 2, c = 2, d / CI = 1); a numeric threshold for the concentration check. (5) §13 SA items answered: noise thresholds are set per metric in §5A.3, and "expected at launch" frequency is allowed under the §7 rules. **Condition:** step R12 (the draft test/eval account list) must be confirmed by the user before any "real accounts" number is used for ranking. Until then, those numbers are labelled *provisional*. | SA |
| 2026-10-12 | User-directed slice | ⬜ **PERF-STRIPE-1** added by the user: the Stripe webhook route is slow enough to time out (§11.4). Measure-first: Vercel and Stripe delivery data (added to R24), then per-step timing in the handler. High risk (Connect money, SR-10), so it needs SA review and the P-0 Connect harness. | User |
| 2026-10-12 | Phase 1: DB baseline captured | ✅ The DB steps R0–R21 ran on prod (`jgccgkyhpwirgknnceoh`) with SELECT and plain `EXPLAIN` only. Results are in §11.1. **R0: `transaction_read_only = off`** (connector role `postgres`), so the connector can write; nothing was written. PG 17.4. **`pg_stat_statements` window: 2026-02-20 00:47 UTC → 2026-10-12 18:33 UTC (≈ 234 days)**, `dealloc = 42`. The T0 snapshot (R4) was taken at 2026-10-12 18:33:26 UTC. The R12 excluded-accounts draft (6 ids: 3 strong, 3 to ask) **awaits user confirmation**; every "real" number is *provisional* until then. R22–R25 are not part of this run. | Dev (agent) |
| 2026-10-12 | Phase 1: routed out (security) | The R7 security advisors are logged only and routed to the **DB exposure lockdown** stream: `security_definer_view` 13 (e.g. `monthly_token_usage`, `daily_token_usage`), `rls_disabled_in_public` 6 (`agent_stats`, `agent_logs`, `agent_configurations`, `shared_agents`, `shared_agent_imports`, `agent_executions`), `authenticated_security_definer_function_executable` 7, `rls_enabled_no_policy` 34, `function_search_path_mutable` 145, `extension_in_public` 2, plus auth OTP expiry, leaked-password protection and the Postgres version. Not part of this stream. | Dev (agent) |
| 2026-10-12 | Phase 1: routed out (TS) | Real failures seen in the baseline, routed to the **Troubleshooter**: (1) R11, 26 Postgres `42703` undefined-column errors in 24 h from app queries (`payment_invoices.proposal_id` ×11, `business_profiles.chase_quotes_enabled` ×9, `smart_link_clicks.created_at` ×4, `proposals.total_amount` ×1), the phantom-column class; (2) R18, `calendar-sync` ends `partial` in 4,353 of 4,355 runs; (3) R18, 22 `bos_cron_runs` rows stuck in `running` past their deadline (`insight-automations` 16). An unverified observation for the credit-deduction owner: R16 vs R14, real accounts' chat token cost $0.093 against $0.0445 of `chat_turn` charge cost (72 planner rows vs 21 charges). | Dev (agent) |

| 2026-10-13 | Phase 2: SA technical scoring | ✅ SA scored the candidates from the §11.1 baseline (R0–R23) and the §11.4 diagnosis, with the code verified on main @ `82469a8a`. R24/R25 are not in, so every R is *estimated* (cap 2), bundle L values are *estimated* from R22, real figures are *provisional* (R12 unconfirmed), and nothing qualifies for the queue jump. Results in §11.2: **7 Round-1 candidates** (top: PC-1 lazy configuration/scheduling dialogs 4.00, PC-2 owner-side phone library 4.00, then PC-3/PC-4/PC-5 at 1.33), **10 Needs evidence** (including `run_memories`, the RLS cleanup, the `audit_trail` insert and PERF-STRIPE-1 F1–F7), **9 Rejected** (notably planner prompt caching, which is already in place). **7 §12 entries** (BIZ-1..BIZ-7). The §6 readings are SA tentative. **Next:** the BA applies the §6 filter (PC-5 is borderline on Q1), then the TL compiles for Decision point 1 | SA |
| 2026-10-13 | Phase 2: BA §6 filter | BA final verdicts in §11.2. PASS WITH CONDITION: PC-1, PC-2, PC-3 (preload when the widget paints), PC-6, PC-7. PC-4 passes but is low value, so skip it unless R24 shows real cron hosting cost. PC-5 is parked as §12 BIZ-8 (Q1 borderline: a longer English window for Hebrew and Spanish owners). NE-11 added: chat embedding stores may never finish. The TL is to compile the Decision point 1 short list next | BA |
| 2026-10-13 | Decision point 1 | ✅ The user picked **PC-1 → PERF-1** (lazy Configuration/Scheduling dialogs), **PC-2 → PERF-2** (lazy phone library in owner modals and drawers) and **PC-3 → PERF-3** (preload the phone library when the booking widget paints). Not picked: PC-4, PC-6, PC-7. These are UI and bundle slices, so they take the short path: Dev → SA code review and QA in parallel → the user sees the diff → RM | User |
| 2026-10-13 | Phase 4: Dev | PERF-1 and PERF-2 are implemented, uncommitted. Workplan: `docs/workplans/PERF_1_2_3_BUNDLE_SLICES_WORKPLAN.md`. First Load JS, before → after: `/business-os` 663 → 472 kB, `/business-os/crm` 670 → 512, `/scheduling` 564 → 403, `/business-os/orders` 572 → 393, `/business-os/settings` 552 → 387. The `/business-os` layout drops from 588 to 351 kB gz. Cost: +0.8 kB shared on every route (CSS chunk loader). **PERF-3 has nothing to ship:** `app/site/[subdomain]/book/BookingWidget.tsx` is not imported anywhere, and the live booking flow uses a plain `tel` input (R22's 207 kB was stale; live `/site/[subdomain]/book` is 160 kB with no phone library). The remaining phone library on public pages is `ContactFormBlock` = BIZ-7. The dead file is a cleanup candidate. SA review and QA are running | Dev |
| 2026-10-13 | Phase 4: review, QA, browser | SA: APPROVED WITH CHANGES (R1 Pino conversion, R2 recovery wording); all three new patterns approved and scoped. Dev applied R1, O-1 (retry on interaction, with a test) and O-2. QA: 102/102 plus 31/31 tests, guards catch 5/5 regressions, AC-2.4 identical in 26/26 comparisons. **Browser (production build, unthrottled, localhost):** dialog and phone chunks load after first paint with no click (M1/M6 ✅). Calendar dialog and New Booking open fully drawn, with the real phone field and country picker in the first frame (M2/M7 ✅). Esc and Cancel close cleanly (M5b ✅). `/business-os/settings?section=business` and `?section=invoice` open on the right tab, fully drawn, with the real phone field (M4/AC-2.5 ✅). Add Contact shows the real phone field on first open, and typing formats correctly (M7 ✅). **Not run:** M3 (chat-driven dialog), M5a/c/d, M7 drawer, M8 deep link and M9 save round-trip: the test account has no contacts, and creating one writes to prod. Also not run: M11 dark mode and M12 blocked chunk (covered by unit tests). Fast 3G throttling was not available in the in-app browser. **Pre-existing bug found (not ours):** `/business-os/crm` in board view with zero pipeline stages shows "Loading contacts…" forever, because `fetchBoard` returns before `setLoading(false)` (`app/business-os/crm/page.tsx:267`). Logged as X-7 | QA / main session |
| 2026-10-13 | Phase 4: RM | The user approved the diff. **PERF-1** is commit `177ad8f9` on `feature/perf-1-lazy-dialogs`, PR [#342](https://github.com/AgentsPilot/neuronforge/pull/342): 11/11 checks green, Vercel preview deployed, mergeable. **PERF-2** is commit `75d45fd7` on `feature/perf-2-lazy-phone-lib`, pushed, with no PR yet: it opens after #342 merges and is then updated from main. This scoping doc is deliberately **not committed** (public repo; it holds prod account ids and open security findings). The main checkout has been restored to HEAD for the slice files | RM |
| 2026-10-13 | PERF-1 merged; PERF-2 PR | #342 (PERF-1) merged 2026-10-13 14:25 UTC as `2c46c3b5`. PERF-2 was updated from main (merge commit `9e07f409`, clean, 13 files) and opened as [#344](https://github.com/AgentsPilot/neuronforge/pull/344) | RM / main session |
| 2026-10-13 | PERF-2 browser checks | Production build of `861a742a`, signed in as the user's test account (one contact). ✅ Drawer phone field on first open. ✅ `?contact=…&section=details` deep link. ✅ Save round-trip (country US→IL, re-entered, saved; stored `+972546778512` is unchanged). ✅ Dark mode. Not run: throttled network (unit tests cover it). #344 description updated | main session |
| 2026-10-13 | PERF-2 merged; Round-1 picks done | #344 merged 2026-10-13 19:05 UTC as `0873aafd`. Every item picked at Decision point 1 is done (PERF-1 and PERF-2 shipped; PERF-3 had nothing to ship). Per §8, Round 1 can close. Results are in §11.3. Still open: PERF-STRIPE-1 (waiting on the R24 Vercel/Stripe export) | main session |
| 2026-10-13 | Business round: decision | The user opened the business round. **Pursue:** BIZ-8 (choose the owner's language before first render, removing today's English/LTR flash), BIZ-7 (phone library on demand in the public contact-form block), BIZ-1 (**only** the progressive image preview option; model, quality and size changes stay parked). **Stay parked** (with recommendation): BIZ-2 no for now (quality risk for ~$1/month); BIZ-5 no for now (leads would go out later; revisit with R24 cost data); BIZ-3 no (failed money events would not be retried); BIZ-4 no (audit rows could be lost); BIZ-6 no (gain too small). These change behaviour, so they take the **full cycle**: BA requirement → SA → Dev workplan → SA → Dev → SA code review → QA → user diff → RM | User |
| 2026-10-14 | New candidate measured: blank-until-mount owner pages | `V2ThemeProvider` returns `null` until its mount effect runs (`lib/design-system-v2/theme-provider.tsx:260-262`, "Prevent SSR flash"), so every full load of `/business-os/*`, `/onboarding-*` and `/v2` paints nothing until all first-load JS has run. It hides only the header, tabs and spinners; no business data. SA analysis: scratchpad `theme-blank-analysis.md`. **Measured** (production build of origin/main, local, warm, same-origin iframe sampler; blank = header marker time − max(domInteractive, CSS end)): `/business-os` median 122 ms, Settings 88, CRM 112, Email automation 108 (≈110 ms overall). First-load JS ≈620–755 kB encoded, so on a cold slow-4G phone the blank is ≈2.5–3.5 s. **Over SA's thresholds** (warm < 100 ms and cold < 1 s), so the recommendation is option (a): a pre-paint theme script plus a small theme stylesheet, rendering children immediately while keeping the `mounted` guard on the DOM effect. No business decision; it also removes today's wrong-theme flash when the in-app choice differs from the OS. One slice, sequenced after BR-1a (#380). Order relative to BR-1b is for SA. Side findings in the same file: a direct browser DB read (rule 1) and one `console.error` | main session / SA |
| 2026-10-14 | TH-1: SA workplan review and RC-7 stop | SA approved the TH-1 workplan with changes (RC-1..RC-9; worktree `neuronforge-th1`, branch `feature/perf-th1-theme-prepaint`). **RC-7 stop condition hit.** Read-only prod check: `system_settings_config` has one non-empty `v2_custom_tokens` row (set 2025-11-30) overriding `colors.primary` and `colors.secondary`, neither of which equals the default. Values are not recorded (public repo). Effect: once TH-1 paints from HTML, owners would see the default primary/secondary brand colours until the client token fetch returns (seconds on a slow phone), then a swap. Today that swap is hidden behind the blank screen. This is a visible change and needs the user's decision. **Follow-ups recorded (SA):** TH-2, a browser DB read of `system_settings_config` in `theme-provider.tsx` (rule 1; the table is kept anon-readable by migration 20260920a, so tightening needs a prod RLS change and user authorization). TH-3: the provider never removes `.dark` or its inline `--v2-*` on unmount, so client navigation to a public page keeps them. Chore: delete the unused `lib/hooks/useTheme.ts`, which is a second `.dark` writer and has a `console.log` | SA / main session |
| 2026-10-15 | TH-1: user decision on brand colours | The user chose the recommendation: **fold TH-2 into TH-1**. The server reads the custom brand tokens and inlines them in the HTML, so the correct colours show from the first frame with no swap, and the browser's direct DB read of `system_settings_config` is removed. Tightening that table's RLS (migration 20260920a keeps it anon-readable) remains a separate step that needs the user's authorization. The TH-1 workplan is to be revised and re-reviewed by SA | User |
| 2026-10-15 | TH-1 revision 2 + T-0(g) | Dev revised the TH-1 workplan to fold in the server-side token read (rebased to `936dfd04`). The server reads tokens through `systemConfigRepository.getByKey` with the service role, behind a 60 s process cache. The read starts before the payment hold, and tokens are validated against an allow-list with formats. They are inlined as a segment-level `<style>`, and the provider's browser read and `console.error` are removed. `/v2` becomes a force-dynamic server layout. **T-0(g) passed** (read-only, yes/no only): both live custom colours are 7-character hex values with no forbidden characters, so they pass unchanged. **TH-2b recorded:** tighten `system_settings_config` RLS (kept anon-readable by 20260920a). It needs an inventory of anon readers first (the migration names `OrchestrationService` and `MemoryCompressor`) and the user's authorization. **Also noted:** the admin save route (`app/api/admin/ui-config/route.ts`) stores tokens without validation and has 8 `console.*` calls, so the server-side read validation becomes the security boundary. SA re-review is pending | Dev / main session |
| 2026-10-15 | TH-1 rev 2: SA re-review | **APPROVED WITH CHANGES** (RC-10..RC-14): a required 1000 ms deadline on the token read, which falls back to the last good value or the defaults (a stalled read must never hold owner pages); G-8 narrowed (a third browser reader, `lib/hooks/useUIVersion.ts`, was added to the TH-2b inventory); the T-12 name check `{--v2-primary, --v2-secondary}`; and sanitizer hardening. T-0(g) accepted. Implementation started. RC-14, the logging-rule conversion of the admin ui-config route (8), page (4) and `useUIVersion.ts` (3) as F-1, was put to the user | SA |
| 2026-10-15 | RC-14 answered | The user said **queue F-1** for after TH-1. Scope: convert `console.*` to Pino in `app/api/admin/ui-config/route.ts` (8), `app/admin/ui-config/page.tsx` (4) and `lib/hooks/useUIVersion.ts` (3), and add write-side Zod validation to the admin ui-config save, reusing TH-1's `customTokens.ts` grammar. Full cycle, since it touches an admin write route | User |
| 2026-10-15 | TH-1 code review + QA | Dev implemented TH-1 (28/28 mutation probes caught; branch build exit 0, route sizes unchanged). Dev found and fixed IN-2: a synchronous setState during hydration under the Suspense boundary caused React to discard the server HTML. **SA code review: APPROVED WITH CHANGES.** CR-1 adds an info-level read-time log; without it RC-10(e) has no data, because production logs at info. CR-2 adds test T-P2b. CR-3: the RC-5(a) safety-net proof must run on a production build with a server-throwing component (curl, signed out, scratch export). CR-4 is docs. **QA: 7 new suites / 220 tests and 7,990 entitlements tests green. QA-1 (Medium):** the sanitizer tests don't reject `;`/`:`-only values; probes b1–b4 went undetected. The code is correct, but the guard is missing. Fixes sent to Dev. Browser P0 checks (markup and RC-12, 21-route smoke, RC-10(e) read time, 20-pair server guard) follow on the CR-1 build | SA / QA |
| 2026-10-15 | TH-1: fixes, CR-3 proof, IN-11 ruling | Dev applied QA-1 (`;`/`:` reject table; probes b1–b5 now caught), CR-1 (info-level read time), CR-2 and CR-4. **CR-3 passed** on a production build: a server-throwing child gives 200, the shell and scripts, the client-render marker, and one logged error with a digest. **IN-11 (stop):** local cold and expiry token reads took 470–1718 ms (median ≈ 800). A deadline-fired cold render showed default brand colours with nothing correcting them, which is worse than today. **SA ruling:** RC-15 stale-while-revalidate (an expired cache returns at once and refreshes in the background) plus RC-16 (on a cold, unknown-state render only, the provider fetches the sanitized tokens from a new public read-only route `/api/design-system/v2-custom-tokens` and applies them; no browser DB read). Every path is now equal to or better than today. Gate: local functional checks L-1..L-4 block; Vercel-preview latency guards V-1..V-3 are recorded. No user decision needed | SA |
| 2026-10-15 | TH-1: RC-15/RC-16 built, SA delta review, browser P0-1 | Dev applied RC-15 and RC-16 (44/44 probes caught). The new public route is `/api/design-system/v2-custom-tokens`. **SA delta review: APPROVED** on condition SA-D1, which arms the deadline only when a caller waits, so background refreshes don't log false "slow" warns. Sent to Dev. The `supabaseFetch.test.ts` failure is pre-existing and Windows-only (Jest's `process.env` proxy), unrelated. **Browser P0-1 passed** (production builds, base 3011 vs branch 3012): all 9 owner routes have the same status (200); on the branch the header toggle is in the server HTML on all 7 BOS routes, there is exactly one custom-token style with names `{--v2-primary, --v2-secondary}` (RC-12), and no `dark` on `<html>`. On base there is no toggle and no style. The remaining browser checks are paused: the browser's session expired, and the user must sign in again | main session / SA |
| 2026-10-15 | TH-1 browser checks complete | SA-D1 applied. Production builds base vs branch: status parity on all 21 routes; BOS blank time **0 ms** (was ≈110 ms); correct theme with 0 flips in light and dark; custom brand colours on the first frame; public pages untouched; 0 correction-route calls on warm loads; background reads 248–1383 ms with no page waiting; 3 cold restarts with first reads of 323–687 ms (deadline never fired, so the correction path is covered by T-P10); response time base ≈217 vs branch 215 ms. `/v2/billing` shows React #419 (the boundary catches its server redirect, lands correctly; SA-accepted). New follow-up: Stripe ConnectJS SSR info log (consider the `pure` loader). **Ready for the user to see the diff** | main session |
| 2026-10-15 | TH-1 approved; F-1 started | The user approved the TH-1 diff: RM to commit and open the PR with auto-merge (`--merge`) and Auto-fix. **F-1 started:** admin ui-config save validation (reusing TH-1's `customTokens.ts` grammar), Pino conversion of the route, page and `useUIVersion.ts`, and a check of route auth and repository use. Workplan first; code after TH-1 merges | User |
| 2026-10-15 | RM: TH-1 | Commit `5bb948f4` on `feature/perf-th1-theme-prepaint`, PR [#422](https://github.com/AgentsPilot/neuronforge/pull/422), auto-merge (`--merge`, merge queue) and Auto-fix on. The public-repo scan is clean; only names and yes/no are recorded for the prod token row. The PR conflicts with main in `app/business-os/layout.tsx` because of P-6a.2 (#418, `readPaymentNotice` + `PlanPaymentBanner`); the Dev is merging main into the branch, preserving the hold-first/overlap rules and the text guards. Worktree kept until merge | RM |
| 2026-10-15 | F-1 workplan + SA review | Dev found that the admin ui-config route is correctly `requireAdmin`-gated but uses a module-level service-role client (rule 1), validates nothing, leaks raw Postgres error `details` in production, and writes no audit. `useUIVersion.ts` and `useTheme.ts` are confirmed dead. **SA: APPROVED WITH CHANGES** (R-1..R-8, applied during build, no further workplan round). **R-1 (High): a second unvalidated write path.** `PUT /api/admin/system-config` can store `v2_custom_tokens`, so add it to `LOCKED_KEYS`. Also: prototype-pollution-safe empty-value dropping, a corrected schema/sanitizer parity test, no reflection of caller keys, GET returns sanitized tokens (Q-2c), and a non-blocking audit with names only. Rulings: drop empty values; keep `ui_version` validated (removing it is a follow-up); presets move to `presets.ts`. No business decision: invalid admin saves are refused with a message. Workplan in the session scratchpad; implementation starts after #422 merges | SA |
| 2026-10-16 | Merges + F-1 build | **Merged:** #364 BR-2 (2026-10-14), #365 BR-3 (2026-10-14), #422 **TH-1** (2026-10-15, after merging main to resolve the P-6a.2 layout conflict). TH-1 worktree removed (junction first; shared node_modules intact). Owed post-deploy: TH-1 Vercel guards V-1..V-3 and the BR-1a p75/p90 check. **F-1 implementation started** on `fix/f1-admin-ui-config-hardening` (worktree `neuronforge-f1`), applying SA R-1..R-8. **Next:** BR-1b (active dictionary only), branching from main after TH-1 per the SA §12.6 addendum | main session |
| 2026-10-16 | F-1 reviewed, approved, PR | **SA code review APPROVED** (no code changes). **QA PASS**: 1,332 tests, authz-guard 203, 21 Dev probes + 5 QA probes caught. **T8 browser check moved to post-deploy (user decision):** admin sign-in cannot reach localhost because the Google/OTP redirect returns to production. Option A (no visible change) will run on production `/admin/ui-config` after deploy. The user asked whether ui-config affects Business OS; answer: the custom tokens drive primary/secondary across 27 BOS files (owner app, onboarding, /v2), while the `ui_version` toggle has no reader. User approved the diff. Commit `ae62256e` on `fix/f1-admin-ui-config-hardening`, PR [#436](https://github.com/AgentsPilot/neuronforge/pull/436), auto-merge and Auto-fix on. Public-repo scan clean. Worktree removed. **Follow-up:** the F-1 workplan in the PR still says T8 is pre-commit and has an empty Commit Info; fix in a docs PR | RM / User |
| 2026-10-16 | PERF-1 defect reported by Offir | The Business Setup tab click did nothing. The `ConfigurationDialog` chunk load timed out; the `.catch` in `lazyDialogs.tsx` resolved to a null component, and `next/dynamic` cached it for the page's life, so the button stayed silently inert until reload. QA had flagged this edge case in PERF-1 review and SA accepted it as low risk; that judgement was wrong. Offir reverted locally to static imports (not pushed). **User decision:** keep lazy loading and fix the failure mode now: retry, a visible error with retry instead of null, no caching of the failure, plus a test. A reply was sent to Offir explaining this and asking him to hold his revert. Fix branch `fix/lazy-dialogs-load-failure`. Follow-up (Offir's suggestion): split the heavy parts (Stripe wizard, services editor, phone library) per tab. F-1 #436 merged; the post-deploy T8 Option A check is owed | User / main session |
| 2026-10-16 | Lazy-dialog fix: PR | SA **APPROVED** (`createLazyDialog` approved as a reusable pattern under four conditions). QA **PASS**, with a test added for Offir's exact scenario. Confirmed latest main (`98735db9`) had no fix from Offir; his revert was never pushed. The user approved the diff. Commit `406ca34a`, PR [#439](https://github.com/AgentsPilot/neuronforge/pull/439), auto-merge and Auto-fix on; all 11 checks green; in the merge queue. On merge: reply to Offir's thread. Owed post-deploy: block the chunk, check the error in he/en, retry. Follow-up: Offir's per-tab split of heavy settings parts. Leftover empty folder `neuronforge-lazyfix` to delete by hand (Windows lock) | RM |
| 2026-10-16 | Lazy-dialog fix merged | #439 merged 2026-10-16 18:45 UTC as `68262daf`. Follow-up email sent to Offir in the same thread with the PR link and a summary, asking him to drop his local static-import change. Owed post-deploy: the manual chunk-block check (he/en, retry). Follow-up: per-tab split | main session |

**Current phase:** 2 (Triage and ranking). SA scoring is done; the BA §6 filter is next. Prod access is **read-only**, following the §5A runbook. No code changes until Decision point 1.

---

## §1 Goal

Make the platform measurably faster, more reliable and (if the user agrees, §10 Q2) cheaper to run, **without changing anything a business owner, their clients or an admin would notice except speed and reliability**.

Specifically:
1. Produce an evidence-backed baseline of hot paths: latency, error/timeout rate, cost and reach.
2. Rank the candidate improvements so the user can pick from a short list written in business terms.
3. Ship the picked items as small numbered slices (PERF-1, PERF-2, …), each with before/after numbers from the same source as the baseline.
4. Hand over a clean parked list of business-changing ideas for a later round.

## §2 Non-Goals

- **No business changes in Round 1.** That rules out cheaper or different models, prompt changes that alter output, cron frequency changes, longer staleness, feature removal, and changes to pricing, credits or plan limits. These are parked (§12), not argued.
- **Not a bug-fix stream.** Real failures found during the baseline go to the Troubleshooter (TS) as separate items. They are logged in §0 and do not join this stream.
- **Not a security stream.** Security findings from the Supabase advisors (RLS, SECURITY DEFINER, exposed views) go to the existing DB exposure lockdown stream. They are logged in §0 only.
- **No new observability product** (APM, log aggregator, Web Vitals) without an explicit user decision. See §10 Q3c.
- **No schema changes or index builds applied by agents to prod.** Those ship as reviewed migrations that the user applies or authorises (§9).
- **Not the V6 agent-generation pipeline**, unless the baseline shows it among the top hot paths. The focus is Business OS.

---

## §3 User Stories

- As the **product owner**, I want a ranked list of performance problems backed by real numbers, so that I spend effort where it matters most and can see what I am choosing between.
- As the **product owner**, I want Round 1 to change nothing my customers would notice except speed, so that I can approve it without a business review.
- As a **business owner**, I want the chat and dashboard to respond faster, so that I can run my business without waiting.
- As a **client of a business**, I want booking and intake pages to load quickly, so that I complete my booking instead of giving up.
- As an **admin**, I want admin screens to load in reasonable time, so that I can support customers efficiently.

---

## §4 Phases and Owners

| # | Phase | Owner | Output | User decides? |
|---|---|---|---|---|
| 0 | Scoping | BA writes it, SA approves the measurement plan | This document | ✅ Answers §10 and grants access (§10 Q3) |
| 1 | Baseline measurement (read-only, no code) | SA leads, Dev runs the queries and exports | Baseline table in §11.1: hot path, audience, p50/p95 latency, error/timeout rate, cost per call, frequency, **reach (distinct real accounts)**, source and window for every number | No |
| 2 | Triage and ranking | SA scores the technical side, BA applies the §6 filter, TL compiles | Ranked list in §11.2, in four groups: **Round 1**, **Needs evidence**, **Parked: business round** (§12), **Rejected** (with reason) | No |
| 3 | Decision point 1 | TL presents | Short list in business terms. For each item: who notices, what gets faster or cheaper, roughly how much, **how confident we are** (measured vs estimated), and effort in slices | ✅ Picks the top N |
| 4 | Delivery: PERF-1, PERF-2, … | Standard cycle per slice. UI/bundle-only slices take the short path | Per slice: diff, same-output proof, before/after numbers from the same source and the same measurement method | ✅ Sees each diff before commit |
| 5 | Re-measure and close Round 1 | SA + TL | Before/after summary in §11.3, Round-1 done check (§8), parked list ready | ✅ Whether to open the business round |

**Notes**
- The Troubleshooter is not part of this stream. Failures go to TS separately (§2).
- If Phase 1 shows that a high-impact area cannot be measured (for example, route durations are not logged), the first slice may be **PERF-0: instrumentation**. It is a new pattern, so it needs SA review (CLAUDE.md rule 7). It is still subject to the §6 filter and to user approval at Decision point 1.
- Phase 3 is the only point where the user picks items. Items found later join the list and are presented at the next checkpoint. They are not slipped into a running slice.

---

## §5 Evidence Sources and Availability

| Source | What it tells us | Availability | Constraint |
|---|---|---|---|
| Supabase performance advisors, `pg_stat_statements`, missing/unused indexes, bloat | Slowest and most frequent queries, index gaps | Now, via the connector (**points at PROD**) | Read-only. Needs a one-time user OK (§10 Q3a). **Never reset `pg_stat_statements`**: a reset is a write and destroys the history. `EXPLAIN ANALYZE` only on SELECTs, never on writes. |
| Supabase API / Postgres logs | Slow requests, errors | Now | Short retention window. Capture early. |
| LLM usage/cost tables: `token_usage` (written by `callWithTracking` through `lib/analytics/aiAnalytics.ts`; BOS rows have `feature = 'business-os-<area>'` and `component = <call name>` from `lib/business-os/llm/callCatalog.ts`), `business_os_credit_charges`, and the admin AI activity view (UI over the same rows) | Cost per call (`cost_usd`), call volume, LLM latency (`latency_ms`, recorded on every tracked call), failures (`success`) | Now, via read-only SQL | Best-instrumented area. **Exclude eval/test accounts** (the eval-usage leak finding: `eval:chat` writes usage rows to its account). The platform account (`00000000-0000-0000-0000-000000000000`) is reported as its own bucket, not as a test account. **Never select** `request_payload`, `response_metadata`, `metadata` or `error_message`: they can hold owner text. |
| Cron/queue history: `bos_cron_runs` (one row per run, `source = 'vercel_cron'`, with `duration_ms`, `outcome`, `error_class`, numbers-only `counts`) and the claim/drain tables (`payment_reminders`, `payment_automation_executions`, `insight_actions`). Schedules come from `vercel.json`: insight-detect daily at 03:30 UTC, insight-actions every 15 min, insight-automations every 5 min, and the others listed there | Run counts, durations, failures, empty runs, backlog | DB side now | `bos_cron_runs` only covers jobs wired to the recorder (`lib/cron/cronRunRecorder.ts`), from `bos_cron_run_recording.installed_at` onward. Jobs with no rows there need Vercel data for durations. |
| Vercel function duration, cold starts, timeouts | Real route latency and timeouts | **Needs user access** (§10 Q3b) | Short retention. Ask early so the baseline window is not lost. |
| Pino logs in prod | Route-level detail | Partly instrumented. Output goes to Vercel stdout, with no aggregator and few duration logs | Adding timing logs = PERF-0, which needs SA review (§4) |
| Next.js build output / bundle size | Client JS weight per page | Now, run locally | — |
| CI critical path (`gh`) | PR feedback time | Now | Secondary, internal-only target. Ranked with the internal audience weight (§7). |
| Client page-load (Web Vitals / Speed Insights) | Real-user page speed | **Not instrumented** | Turning it on is a cost and privacy decision (§10 Q3c). Local Lighthouse runs are the stand-in. |
| Chat golden set (`npm run eval:chat`) | Same-output proof for chat/LLM items | Now | Makes real LLM calls (real cost) and writes usage rows. Always `--no-cache` for before/after. Noise band is at least ±3 scenarios. |

**Baseline rules (BA additions)**
1. **Real vs test traffic.** Every frequency and reach number is reported twice: all accounts, and real accounts only (test/eval accounts excluded per §10 Q4). Ranking uses real accounts only. Before launch, real traffic may be thin. If so, SA may use "expected at launch" frequency, but it must be labelled *estimated* and scores at most 2.
2. **Same window, same method.** Each number records its source, time window and method. "After" numbers must use the same source and method. A before/after drawn from different sources does not count.
3. **No number, no rank.** An item with no measured number goes to "Needs evidence" (§11.2), not into the ranking.

**Baseline rules (SA additions)**
4. **Windows from `pg_stat_statements` come from snapshot diffs, never from a reset.** The view is cumulative since `stats_reset`. A windowed figure is snapshot T1 minus snapshot T0, matched on `(queryid, userid)`. A slice that rewrites a query gets a new `queryid`, so its before/after compares the old and new `queryid` for the same call site, and the slice workplan names both.
5. **Every probe is one plain SELECT that writes nothing.** No `EXPLAIN ANALYZE` on any statement that calls a function, unless that function is confirmed `STABLE` or `IMMUTABLE`. A `SELECT claim_due_*(...)` call looks like a read, but it is an UPDATE. Prefer `EXPLAIN` without `ANALYZE`, and `EXPLAIN (GENERIC_PLAN)` where the server version supports it (PG16+, see R0). Never select PII columns: only ids, counts, durations, sizes and costs. Copy no raw log lines or query parameter values into this file.
6. **Capture order follows retention.** Short-lived sources first: Vercel export (R24) and Supabase logs (R11) on day 1. Cumulative sources (pg stats, `token_usage`, `bos_cron_runs`) can follow. See §5A for the order.

---

## §5A Phase-1 Baseline Runbook (SA)

Written by SA on 2026-10-12. The main session runs these steps in order. Steps marked **[prod]** use the Supabase connector, which **points at PROD**. Steps marked **[gh]**, **[local]** and **[user]** run elsewhere.

### §5A.1 Ground rules for every step

- **SELECT only.** No DDL, no DML, no `pg_stat_statements_reset()`, no `pg_stat_reset()`, no `ANALYZE`/`VACUUM`, no `EXPLAIN ANALYZE` on anything but a plain SELECT that calls no writing function (§5 rule 5).
- **No PII.** Output only ids, counts, durations, sizes and costs. The `token_usage` columns `request_payload`, `response_metadata`, `metadata` and `error_message`, the `admin_users` columns `email` and `notes`, and every name, email, phone or message column are never selected.
- **"verify live"** marks a name that was taken from migrations or code but could not be confirmed against the live schema from the repo. Before running a step that uses one, check the name with the `business-os-schema-check` skill (for example, `select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = '<t>'`). If the name is missing, record the step as "skipped: schema differs" in §11.1. Do not improvise a replacement.
- **Heavy-table guard.** R10 runs before the `token_usage` steps. If `token_usage` has more than about 5 M live rows, cut every `token_usage` window below from 30 days to 14 days.
- **Recording.** Each step names what goes into §11.1. Raw outputs larger than that go in the session scratchpad. They are not committed and are not pasted into this file. Every §11.1 number records source, window (UTC) and step id (for example, "R13, `token_usage`, 2026-09-12..2026-10-12 UTC").

### §5A.2 Ordered steps

**Day 1: short-retention sources first**

**R24 [user]: Vercel export.** Run it first, in parallel with everything below. The full steps are at the end of this list.

**R0 [prod]: Pre-flight.**
```sql
select version() as pg_version,
       current_user,
       current_setting('transaction_read_only') as read_only,
       now() as captured_at_utc;
```
Record: PG major version (it decides whether `EXPLAIN (GENERIC_PLAN)` is usable), the connector role, and the start time of the run. If `read_only` is `off`, the connector can write. Every following statement must still be SELECT-only. Note this in §0.

**R1 [prod]: `pg_stat_statements` exists, and its window (§13 item 1).**
```sql
-- 1a. Is the extension installed, and in which schema?
select e.extname, e.extversion, n.nspname as schema
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where e.extname = 'pg_stat_statements';
```
```sql
-- 1b. How far back the stats go, and whether entries were evicted.
-- Replace "extensions." with the schema returned by 1a (Supabase default is "extensions": verify live).
select i.stats_reset,
       now() - i.stats_reset                                   as window_length,
       i.dealloc                                               as entries_evicted_since_reset,
       current_setting('pg_stat_statements.max', true)         as max_entries,
       current_setting('pg_stat_statements.track', true)       as track,
       (select count(*) from extensions.pg_stat_statements)    as entries_now
from extensions.pg_stat_statements_info i;
```
Record: `stats_reset`, `window_length`, `dealloc`. If 1a returns no row, record "pg_stat_statements unavailable" and skip R3 to R6. **Do not enable it**: that is a change and needs user approval. If `dealloc > 0`, rare queries were evicted. The top lists are still valid, but the totals are a floor. Note that in §11.1.

**R2 [prod]: Window of the table and index counters.**
```sql
select stats_reset, now() - stats_reset as window_length
from pg_stat_database
where datname = current_database();
```
Record: the window that applies to R8, R9 and R10 (`idx_scan`, `seq_scan`). Under about 7 days, "unused index" findings are *weak evidence* only.

**R11 [prod]: Supabase logs (short retention).** Use the connector's `get_logs` with service `api`, then service `postgres` (the connector returns only a recent window, about the last 24 h: verify). Count only: API responses by status class (2xx/4xx/5xx), the top 10 paths by 5xx count with the query string stripped, and postgres `ERROR`/`FATAL` lines by SQLSTATE or first 60 characters of the message, with any literal values removed. Record: counts per class and the window. **No raw lines** go into this file.

**Database load**

**R3 [prod]: Which roles carry the statement load.** This decides the role filter for R4 and R5.
```sql
select r.rolname,
       count(*)                                   as statements,
       sum(s.calls)                               as calls,
       round(sum(s.total_exec_time)::numeric, 0)  as total_ms
from extensions.pg_stat_statements s
join pg_roles r on r.oid = s.userid
group by r.rolname
order by total_ms desc;
```
Record: total time per role. App traffic is normally `authenticated`, `anon`, `service_role` and/or `authenticator`. Treat `postgres`, `supabase_admin` and similar roles as platform or dashboard traffic, and report them separately. If app traffic does not appear under the expected roles, use the roles this step shows: verify live.

**R4 [prod]: Top 25 statements by total time. This is also the T0 snapshot.**
```sql
select s.queryid,
       r.rolname,
       s.calls,
       round(s.total_exec_time::numeric, 0)   as total_ms,
       round(s.mean_exec_time::numeric, 2)    as mean_ms,
       round(s.stddev_exec_time::numeric, 2)  as stddev_ms,
       round(s.max_exec_time::numeric, 0)     as max_ms,
       s.rows,
       round(100.0 * s.shared_blks_hit / nullif(s.shared_blks_hit + s.shared_blks_read, 0), 1) as cache_hit_pct,
       round((100.0 * s.total_exec_time / sum(s.total_exec_time) over ())::numeric, 1)      as pct_of_all_time,
       left(regexp_replace(s.query, '\s+', ' ', 'g'), 160)                                 as query_head
from extensions.pg_stat_statements s
join pg_roles r on r.oid = s.userid
where r.rolname in ('authenticated', 'anon', 'service_role', 'authenticator')  -- adjust from R3
order by s.total_exec_time desc
limit 25;
```
Record: one §11.1 row per statement that can be mapped to a hot path (`queryid`, `calls`, `total_ms`, `mean_ms`, `pct_of_all_time`, R1 window). Keep the full output as the **T0 snapshot**, with its `captured_at`. `query_head` is normalised by the extension (constants become `$n`), but it goes to the scratchpad only. In §11.1, name the table and the operation instead of pasting SQL.

**R5 [prod]: Top 25 statements by mean time.** Use the same SELECT as R4, with the extra filter `and s.calls >= 50` and `order by s.mean_exec_time desc`.
Record: statements with a mean above 100 ms, with `calls`, `mean_ms` and `max_ms`.

**R6 [prod]: Plan check for the top statements (no execution).** For each of the top 5 in R4 or R5, run this if R0 shows PG ≥ 16:
```sql
explain (generic_plan) <query text from R4, with its $n placeholders left in place>;
```
If the server is older than PG16, defer this to Phase 2, where SA substitutes representative ids (ids only) and runs plain `EXPLAIN` with **no `ANALYZE`**. Skip any statement that calls a function.
Record: per `queryid`, the plan's top node, whether a `Seq Scan` hits a table over 10 k rows, and estimated rows.

**R7 [prod]: Supabase performance advisors.** Use the connector's `get_advisors` with type `performance`.
Record: lint name, table and count (for example `unindexed_foreign_keys`, `unused_index`, `auth_rls_initplan`, `multiple_permissive_policies`, `duplicate_index`). Security advisors are **out of scope**: log them in §0 only and route them to the DB exposure lockdown stream.

**R8 [prod]: Unused-index signal.**
```sql
select s.relname          as table_name,
       s.indexrelname     as index_name,
       s.idx_scan,
       pg_relation_size(s.indexrelid) as index_bytes
from pg_stat_user_indexes s
join pg_index i on i.indexrelid = s.indexrelid
where s.schemaname = 'public'
  and s.idx_scan = 0
  and not i.indisunique
  and not i.indisprimary
order by index_bytes desc
limit 30;
```
Record: the count and total bytes of never-scanned, non-unique indexes, and the R2 window. These are candidates only. **Dropping an index is not a Round-1 item** unless SA confirms it serves no claim or drain path (for example `idx_payment_reminders_scheduled` is a partial index that serves the claim). An index that looks unused may serve a rare cron.

**R9 [prod]: Missing-index signal (sequential-scan-heavy tables).**
```sql
select relname,
       seq_scan,
       seq_tup_read,
       idx_scan,
       n_live_tup,
       round(seq_tup_read::numeric / nullif(seq_scan, 0), 0) as avg_rows_per_seq_scan
from pg_stat_user_tables
where schemaname = 'public'
  and n_live_tup > 1000
order by seq_tup_read desc
limit 25;
```
Record: tables where `avg_rows_per_seq_scan` is over 1,000 and `seq_scan` is high compared with `idx_scan`. Cross-check them against R7's `unindexed_foreign_keys` and R6's plans.

**R10 [prod]: Table sizes, dead tuples and cache hit.**
```sql
select c.relname,
       pg_total_relation_size(c.oid)                         as total_bytes,
       pg_relation_size(c.oid)                               as heap_bytes,
       pg_indexes_size(c.oid)                                as index_bytes,
       coalesce(pg_total_relation_size(c.reltoastrelid), 0)  as toast_bytes,
       st.n_live_tup,
       st.n_dead_tup,
       round(100.0 * st.n_dead_tup / nullif(st.n_live_tup + st.n_dead_tup, 0), 1) as dead_pct,
       st.last_autovacuum,
       st.last_autoanalyze
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables st on st.relid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
order by total_bytes desc
limit 30;
```
```sql
select pg_database_size(current_database()) as db_bytes,
       round(100.0 * sum(heap_blks_hit) / nullif(sum(heap_blks_hit + heap_blks_read), 0), 2) as table_cache_hit_pct,
       round(100.0 * sum(idx_blks_hit)  / nullif(sum(idx_blks_hit  + idx_blks_read),  0), 2) as index_cache_hit_pct
from pg_statio_user_tables
where schemaname = 'public';
```
Record: the top 10 tables by size, any table with `dead_pct` over 20% and more than 10 k rows, the DB size, and the cache hit ratios. Also record `token_usage.n_live_tup` for the heavy-table guard (§5A.1). The `dead_pct` figure is a bloat *signal*. A precise bloat estimate needs `pgstattuple`, which this runbook does not install.

**Accounts: the Q4 draft, before any "real accounts" number**

**R12 [prod]: Draft list of candidate test/eval accounts (for §10 Q4).** Ids and behaviour only.
```sql
with bos as (
  select user_id,
         count(*)                            as calls,
         count(distinct session_id)          as groups,
         round(sum(cost_usd)::numeric, 4)    as cost_usd,
         min(created_at)                     as first_call,
         max(created_at)                     as last_call
  from public.token_usage
  where feature like 'business-os-%'
    and created_at >= now() - interval '60 days'
  group by user_id
),
chat_groups as (                                 -- one row per chat turn group
  select user_id, session_id, min(created_at) as t0
  from public.token_usage
  where feature = 'business-os-chat'
    and created_at >= now() - interval '60 days'
  group by user_id, session_id
),
per_hour as (
  select user_id, date_trunc('hour', t0) as h, count(*) as n
  from chat_groups
  group by user_id, date_trunc('hour', t0)
),
bursts as (                                      -- eval:chat fires ~80 scenarios in one sitting
  select user_id,
         count(*) filter (where n >= 20) as eval_like_burst_hours,
         max(n)                          as max_chat_groups_in_one_hour
  from per_hour
  group by user_id
)
select b.user_id,
       b.calls, b.groups, b.cost_usd, b.first_call, b.last_call,
       coalesce(x.eval_like_burst_hours, 0)       as eval_like_burst_hours,
       coalesce(x.max_chat_groups_in_one_hour, 0) as max_chat_groups_in_one_hour,
       (a.user_id is not null)                    as is_active_platform_admin,
       (b.user_id = '00000000-0000-0000-0000-000000000000') as is_platform_account,
       round((100.0 * b.cost_usd / nullif(sum(b.cost_usd) over (), 0))::numeric, 1) as pct_of_bos_llm_cost
from bos b
left join bursts x on x.user_id = b.user_id
left join public.admin_users a on a.user_id = b.user_id and a.is_active
order by b.cost_usd desc nulls last;
```
Verify live: the types of `token_usage.user_id` and `token_usage.session_id`. If `user_id` is `text`, cast it in the join (`a.user_id::text = b.user_id`). Then the main session drafts the candidate list:
- any account with `eval_like_burst_hours > 0`
- any account with `is_active_platform_admin`
- the known eval-account prefix `b509258d…` (from the parked eval-usage leak finding)
- any account with more than 50% of BOS LLM cost (the concentration check)

The platform account is listed **separately**, not as a test account. The user confirms the list **by id**. The user can look up who each id belongs to in `/admin/users`, so no email goes into this file. Record: the draft list, then the confirmed list, in §11.1 under "Excluded accounts", with the date confirmed. Until the user confirms, every "real" number is labelled *provisional*.

**R21 [prod]: Reach denominator (active real accounts).**
```sql
select count(distinct user_id) as active_accounts_all,
       count(distinct user_id) filter (
         where user_id <> all (array[<confirmed excluded ids>]::uuid[])   -- verify type, see R12
           and user_id <> '00000000-0000-0000-0000-000000000000'
       ) as active_accounts_real
from public.token_usage
where feature like 'business-os-%'
  and created_at >= now() - interval '30 days';
```
Record: both counts and the window. This is the denominator for R (§7). An account with no BOS AI use in 30 days does not count as active. That is a known undercount, and it is accepted for Round 1.

**AI usage and cost**

**R13 [prod]: BOS LLM per call name, all accounts.**
```sql
select feature,
       component                                         as call_name,
       count(*)                                          as calls,
       count(distinct user_id)                           as accounts,
       count(*) filter (where success is false)          as failed,
       round(sum(cost_usd)::numeric, 4)                  as cost_usd,
       round(avg(cost_usd)::numeric, 6)                  as mean_cost_usd,
       count(latency_ms)                                 as latency_n,
       percentile_cont(0.5)  within group (order by latency_ms) as p50_ms,
       percentile_cont(0.95) within group (order by latency_ms) as p95_ms,
       sum(input_tokens)                                 as input_tokens,
       sum(output_tokens)                                as output_tokens
from public.token_usage
where feature like 'business-os-%'
  and created_at >= now() - interval '30 days'
group by feature, component
order by cost_usd desc nulls last;
```
Record: one §11.1 row per call name in the top 10 by cost, plus every call name with p95 over 10 s. Fields: calls, accounts, failed %, cost per call, p50/p95, and `latency_n` (the sample size for the noise rule). The zero-token chat cache-hit rows (component `BizQLPlanCache`, listed in `BOS_KNOWN_NON_CATALOG_COMPONENTS`) show up as their own call name. Keep them: their count is the plan-cache hit volume.

**R14 [prod]: The same, real accounts only.** Use R13 with this extra filter:
```sql
  and user_id <> all (array[<confirmed excluded ids>]::uuid[])
  and user_id <> '00000000-0000-0000-0000-000000000000'
```
Then run the platform account alone (`and user_id = '00000000-0000-0000-0000-000000000000'`) and record it as its own bucket.
Record: the "real" column of §11.1. **Ranking uses this step** (§5 rule 1).

**R15 [prod]: Daily volume, and the split-half noise check.**
```sql
select date_trunc('day', created_at)::date      as day,
       feature,
       count(*)                                 as calls,
       count(distinct user_id)                  as accounts,
       percentile_cont(0.95) within group (order by latency_ms) as p95_ms,
       round(sum(cost_usd)::numeric, 4)         as cost_usd
from public.token_usage
where feature like 'business-os-%'
  and created_at >= now() - interval '30 days'
  and user_id <> all (array[<confirmed excluded ids>]::uuid[])
group by 1, 2
order by 1, 2;
```
Record: whether traffic is thin (fewer than 5 real accounts a day on a feature means §5 rule 1 "estimated" applies). Also record the p95 and cost-per-call of each feature for the first 15 days against the last 15 days. That gap is the observed noise used in §5A.3.

**R16 [prod]: Credit charges by service and action.**
```sql
select service,
       action_type,
       triggered_by,
       outcome,
       count(*)                            as charges,
       count(distinct user_id)             as accounts,
       round(sum(credits)::numeric, 2)     as credits,
       round(sum(cost_usd)::numeric, 4)    as cost_usd,
       count(*) filter (where is_fallback_priced) as fallback_priced
from public.business_os_credit_charges
where kind = 'charge'
  and created_at >= now() - interval '30 days'
group by 1, 2, 3, 4
order by cost_usd desc;
```
Run it twice: all accounts, then with the R14 exclusion added on `user_id`.
Record: cost per action type (all / real). This is the cost (C) evidence that ties to what customers are charged. `cost_usd` here is in platform USD, so there is no currency mixing.

**R17 [prod]: Non-BOS LLM spend (context only).**
```sql
select feature,
       count(*) as calls,
       round(sum(cost_usd)::numeric, 4) as cost_usd,
       percentile_cont(0.95) within group (order by latency_ms) as p95_ms
from public.token_usage
where (feature is null or feature not like 'business-os-%')
  and created_at >= now() - interval '30 days'
group by feature
order by cost_usd desc nulls last
limit 15;
```
Record: one line, the share of total LLM cost that is not Business OS. That share decides whether the V6/agents side is "among the top hot paths" (§2).

**Background work**

**R18 [prod]: Cron run history.**
```sql
select (select installed_at from public.bos_cron_run_recording) as recording_since;
```
```sql
select job,
       source,
       count(*)                                                     as runs,
       count(*) filter (where outcome = 'failed')                   as failed,
       count(*) filter (where outcome = 'partial')                  as partial,
       count(*) filter (where outcome = 'running' and deadline_at < now()) as stuck_past_deadline,
       count(*) filter (where error_class = 'timeout')              as timeouts,
       percentile_cont(0.5)  within group (order by duration_ms)    as p50_ms,
       percentile_cont(0.95) within group (order by duration_ms)    as p95_ms,
       max(duration_ms)                                             as max_ms,
       round(avg(extract(epoch from (deadline_at - started_at)) * 1000)::numeric, 0) as mean_budget_ms
from public.bos_cron_runs
where started_at >= now() - interval '30 days'
group by job, source
order by job, source;
```
Record: one §11.1 row per job (audience c), with runs, failure % and p50/p95 against the budget. Also list the jobs in `vercel.json` that have **no** rows. Those need R24 data.

**R19 [prod]: Empty runs per job.**
```sql
select job,
       count(*) as finished_runs,
       count(*) filter (
         where not exists (
           select 1 from jsonb_each(counts) e
           where jsonb_typeof(e.value) = 'number' and (e.value)::numeric > 0
         )
       ) as empty_runs
from public.bos_cron_runs
where started_at >= now() - interval '30 days'
  and outcome <> 'running'
group by job
order by empty_runs desc;
```
Record: the empty-run % per job. A high empty % is a candidate for "skip runs with nothing to do while the visible schedule stays the same", which passes §6. A schedule change is parked. If a job records no counts at all, this step cannot tell an empty run from a busy one. Mark that job "no counts" rather than empty.

**R20 [prod]: Queue backlog.**
```sql
select 'payment_reminders' as queue, status, count(*) as n,
       count(*) filter (where status = 'pending' and scheduled_at < now() - interval '1 hour') as overdue_1h,
       max(attempts) as max_attempts
from public.payment_reminders group by status
union all
select 'payment_automation_executions', status, count(*),
       count(*) filter (where status = 'pending' and scheduled_at < now() - interval '1 hour'),
       max(attempts)
from public.payment_automation_executions group by status
union all
select 'insight_actions', status, count(*),
       count(*) filter (where status = 'pending' and coalesce(next_attempt_at, created_at) < now() - interval '1 hour'),
       max(attempts)
from public.insight_actions group by status
order by 1, 2;
```
Verify live: `insight_actions` has no `scheduled_at` in its create migration. `coalesce(next_attempt_at, created_at)` is the SA's proxy for "due since". Check the claim function in `20260917_insight_actions.sql` against the live table before trusting the overdue column.
Record: pending and overdue counts and `max_attempts` per queue. Rows stuck in `processing` or `running` belong to TS (a failure, §2), not to this stream.

**Build, CI, hosting and pages**

**R22 [local]: Route sizes from `next build`.**
1. Use a checkout at `origin/main` with no local changes. Do not use `git stash` or `git worktree remove --force`: see the repo's worktree hazards. Record `git rev-parse HEAD`.
2. Run `npm run build 2>&1 | tee "<scratchpad>/next-build-<sha>.txt"`. If it fails on Google font downloads (the known `next/font` flake), retry once.
3. Run it a second time and confirm that the numbers match. Bundle output is deterministic, so a mismatch means the checkout is not clean.

Record: the "First Load JS shared by all" size. Also record the route, size and First Load JS for the top 15 routes by First Load JS, plus every route under audience a (the `/business-os` and `/v2` dashboard and chat) and audience b (`/book`, `/c`, `/site/[subdomain]`, `/invoice`, `/proposal`, `/reschedule`, `/payments`).

**R23 [gh]: CI timings.**
```bash
gh run list --workflow build.yml --event pull_request --status success --limit 30 \
  --json databaseId,headSha,createdAt,updatedAt
gh run list --workflow tests.yml --event pull_request --status success --limit 30 \
  --json databaseId,headSha,createdAt,updatedAt
# per run, for job-level detail:
gh run view <databaseId> --json jobs \
  --jq '.jobs[] | [.name, .startedAt, .completedAt, .conclusion] | @tsv'
# critical path for one PR head: every workflow on that commit
gh run list --commit <headSha> --json workflowName,createdAt,updatedAt,conclusion
```
Record: for the last 20 successful PR runs, the median and p90 wall-clock time of `build.yml` and `tests.yml`, and the PR critical path. The critical path runs from the earliest workflow `createdAt` to the latest required-check `updatedAt` on the same `headSha`. Also record the slowest job in each workflow. The audience is internal (A = 1).

**R25 [local, optional]: Lighthouse stand-in for page load (§10 Q3c).** In Chrome DevTools, open the Lighthouse panel and choose Mobile, Performance only. Run it 5 times per page and take the median LCP, TBT and total transfer size. Use public pages of a **confirmed test account** only: one `/book` page, one `/site/[subdomain]` page and one intake page. Record: the medians, with the URL path pattern only (no business names).

**R24 [user]: Vercel export.** The main session sends these steps to the user on day 1. Retention is short, so data lost before export cannot be recovered. Dashboard labels may differ slightly from this description. Capture what is shown.
1. **Function performance.** Go to vercel.com, open the team, open the production project, then the **Observability** tab and its Functions view. Set the time range to the **longest window offered** (7 days or more if the plan allows). Sort by **invocations**, then by **total duration** (or GB-hours), and capture the top 30 routes each way. Per route, capture: invocations, error count or rate (5xx), duration percentiles as shown (p75/p95/p99), timeouts, and cold-start share if shown. Make sure the cron routes (`/api/cron/*`) , `/api/business-os/chat-v4` and `/api/stripe/webhook` (PERF-STRIPE-1, §11.4) are in the capture. **Also, in the Stripe dashboard:** open Developers → Webhooks → the production endpoint, and capture the delivery history over the same window: response times, failed deliveries and retries per event type. Counts and timings only, no payloads. Use CSV export where offered, screenshots otherwise.
2. **Timeouts.** In the same project, open the **Logs** tab and use the same window. Filter by status `504`, or search for `FUNCTION_INVOCATION_TIMEOUT` and "Task timed out". Capture a **count per route only**. Do not paste or share log lines, because they can hold customer data.
3. **Hosting cost.** Open **Team → Usage** for the current billing cycle and the previous one. Capture Function Invocations, Function Duration (GB-hours) and Edge Requests / Fast Origin Transfer for this project. This is the hosting evidence for C.
4. **Limits.** Open **Project → Settings → Functions** and capture the default max duration and the region. This is the "near timeout" reference for L.
5. On every capture, note the window start and end in UTC.

Record: one §11.1 row per route in the top 15 by invocations or total duration, with p50/p95 (or the closest percentiles shown) and error and timeout %. Add a §0 row with the export date. If the user cannot export within 2 days, those routes go to "Needs evidence", and PERF-0 instrumentation becomes a candidate (§4 notes).

### §5A.3 Noise thresholds (§8 rule 3, §13)

A slice's "after" number beats noise only if it clears the threshold for its metric. The threshold also requires that the before and after windows have the same length and use the same source and method.

| Metric | Source | Minimum sample per window | Threshold to count as a gain |
|---|---|---|---|
| p95 latency (route, LLM call, cron) | R24 / R13 / R18 | 200 samples. Between 30 and 199 samples, use p50 instead with the same rule. Under 30, use a synthetic measure | Improvement ≥ **max(10%, 2 × the split-half gap measured in R15)** for that path |
| Query time | R4 snapshot diff (§5 rule 4) | 500 calls in the diff window | `mean_exec_time` improvement ≥ max(15%, 2 × the split-half gap of two consecutive diff windows) |
| Query, synthetic | Plain `EXPLAIN (ANALYZE, BUFFERS)` on a **SELECT that calls no function**, 7 runs, first run discarded | n/a | **Buffers** (shared hit + read) down ≥ 20% with the same row count. This is the primary measure, because buffers are deterministic and prod timing is shared and noisy. The median time must also not get worse |
| Error / timeout rate | R13 / R18 / R24 | 500 calls | Relative drop ≥ 50% **and** an absolute drop of at least 5 per 1,000 calls. Smaller samples: extend the window, do not merge |
| Cost per call | R13 / R16 (real accounts), plus the eval set run before and after with `--no-cache` | 50 calls | Median cost per call down ≥ 5%, with the same-output proof attached (§6) |
| Bundle (First Load JS) | R22 | Deterministic | Down ≥ 5% or ≥ 10 kB on the affected route, whichever is smaller |
| CI wall-clock | R23 | 10 runs | Median down ≥ max(10%, 30 s) |
| Lighthouse LCP / TBT | R25 | 5 runs | Median down ≥ 10% |

A slice with no metric that can reach its minimum sample in a 14-day "after" window is not merged on speed grounds. The slice workplan must name its metric and the expected sample before Dev starts.

---

## §6 Round-1 Filter (the "business unchanged" test)

**The BA applies this filter. The user does not have to.** It is written in plain terms so the user can audit any call. An item enters Round 1 only if the answer to **all five** questions is **No**.

| # | Question | In plain terms |
|---|---|---|
| 1 | **Output:** could any business owner, client or admin see a different result for the same input? That covers content, numbers, row order, which data is shown, and LLM wording or quality. | Would anyone see something different, not just faster? |
| 2 | **Money:** does it change what anyone is charged, their credits, prices or plan limits? | Would anyone's bill or balance change? |
| 3 | **Timing users rely on:** does it change *when* something visible happens, such as reminder or cron schedules, insight freshness, or how long data can stay out of date? *Happening sooner because it is faster does not count as a change.* | Would anything arrive later, earlier by schedule, or show older data? |
| 4 | **Scope:** does it remove, hide or degrade a feature, or need a product decision? | Would a feature go away or get worse? |
| 5 | **Failures and records** *(BA addition)*: does it change what happens when something fails (a new timeout, retry, fallback, or fail-open vs fail-closed), or which records are kept (audit trail, usage rows, charge rows, logs used for support)? | Would errors behave differently, or would we keep less history? |

**Why Q5 was added:** common performance fixes add timeouts, retries or fallbacks, or shrink tables by deleting or archiving rows. None of these change "output" in the normal case, but they change what users experience when something goes wrong, and what the business can audit later. Those are business decisions.

**Passes (typical):** indexes; query shape; N+1 removal; selecting only needed columns; caching pure reads **with invalidation on every write path** (including webhooks, crons and service-role writers); bundle splitting and lazy loading; cold-start trimming; batching identical work; skipping cron runs with nothing to do while the visible schedule stays the same; CI speed.

**Fails (park it):** cheaper or faster models; prompt trimming that changes output; a less frequent cron; longer cache TTLs that let data go stale; dropping features; credit or pricing changes; new timeouts or fallbacks that change error behaviour; deleting or archiving data to speed up queries.

**Borderline rule:** if the team cannot agree on a "No" within one exchange, the item is parked, not argued. It gets one line on what it would change and what it would gain (§12 format). Typical borderline cases:
- A cache whose invalidation might miss an out-of-band writer (a Stripe webhook, a cron, an admin tool)
- A query rewrite that may reorder rows that tie on the sort key
- Lazy loading that changes what is visible on first paint

**Same-output proof is part of every slice:**
- LLM paths: the eval golden set before and after, `--no-cache`, with any difference outside the ±3 noise band explained.
- Queries: a before/after row comparison on identical inputs, order included where the UI depends on order.
- UI/bundle: a visual check of the affected pages by QA.

---

## §7 Ranking Rubric

Each factor is scored 1–3, with **one line of evidence** (source and number) per score.

| Factor | Meaning | 1 | 2 | 3 |
|---|---|---|---|---|
| **Latency (L)** | User-facing slowness on this path, p95 | Barely noticeable | Noticeable wait | Painful wait or close to timeout |
| **Reach (R)** *(replaces the TL's "frequency")* | How often the path runs **and** how many distinct real accounts hit it | Rare, or a handful of accounts | Regular use by some accounts | Most active accounts, daily or more |
| **Audience weight (A)** *(BA addition)* | Who waits. Set from the user's answer to §10 Q1 | Internal (admin, CI) | Middle-ranked audience | Top-ranked audience |
| **Cost (C)** | LLM and infra spend that could be removed with identical output | Negligible | Visible on the bill | A leading line item |
| **Errors (E)** | Error or timeout rate on the path | Rare | Occasional | Frequent. **Can jump the queue** (see below) |
| **Effort (F)** | Slices needed | ≤1 slice | 2 slices | 3+ slices (split it) |
| **Risk (K)** | Touches money, tenant isolation or shared infra | None | One of them | Several, or a migration on a hot table |

**Priority = (L × R × A ÷ 3 + C + E) ÷ (F + K)**

- With A = 3 (top audience) this reduces to the TL's formula (L × R + C + E). A lower-ranked audience scales the latency term down, so an admin-only screen does not outrank a client page with the same raw latency.
- If §10 Q2 is answered "speed only", C is fixed at 0 for every item.
- **Queue jump:** E = 3 on a top-two audience path goes to the top of the list, whatever the formula says. It is still checked for being a real bug (TS) rather than a performance item.
- **Ties** go to the item that reuses existing infrastructure.
- **Concentration check (BA addition):** if more than about half of a path's load comes from one account, R is scored for the platform without that account, and the item is flagged. One heavy or test account must not drive the ranking.

### §7.1 SA amendments (2026-10-12): scoring mechanics

These rules take precedence over the table above where the two differ.

**Ranges.** L, R, A and F score 1–3. **C and E score 0–3**, where 0 means "none measured". **K scores 0–2.**
- *Why:* in the table above, "negligible" cost and "rare" errors still score 1. That adds a constant +2 to every numerator, which squeezes the latency term. Because the offset is divided by different divisors, it can also reorder items. Zero has to mean none. Starting K at 0 also stops a no-risk item paying the same penalty as a 1-slice effort, while F ≥ 1 keeps the divisor at 1 or more. The formula is unchanged: numerator 0.33–15, divisor 1–5.

**Band anchors.** Each score cites the step in §5A that produced it.

| Factor | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| L, interactive paths (audiences a, b, d) | — | p95 < 1 s | p95 1–3 s | p95 > 3 s, or p95 > 50% of the function's max duration (R24 step 4) |
| L, background paths (audience c) | — | p95 duration < 25% of its budget (`deadline_at − started_at`, R18) | 25–75% | > 75%, or any timeout in the window |
| L, CI | — | median < 5 min | 5–10 min | > 10 min |
| R (R21 denominator) | — | < 10% of active real accounts, or fewer than 3 accounts | 10–50% | > 50% **and** the path runs at least daily |
| R, CI | — | < 20 PR runs a week | 20–100 | > 100 |
| A (from the §10 Q1 answer) | — | d: admin screens; CI | b: client pages; c: background | a: owner chat and dashboard |
| C (share of total variable spend in the window: R14 + R16 + R24 step 3) | no removable cost | < 2% | 2–10% | > 10% |
| E (error + timeout rate, at least 100 calls, otherwise 0 and labelled "Needs evidence" for E) | none measured | < 0.5% | 0.5–2% | > 2% |
| F | — | ≤ 1 slice | 2 slices | 3+ slices. The item must be split before it is ranked; F = 3 is kept only for an item that cannot be split, and it is flagged |
| K | none | one of: money, tenant isolation, shared infra | several, or a migration on a hot table (top 10 by `calls` in R4, or > 1 GB in R10) | — |

**Audience mapping.** Q1 ranked four audiences (a, b, c, d) onto three levels, so a = 3, b = 2, c = 2, d = 1. The queue jump's "top-two audience" means a and b.

**Concentration.** "About half" means more than 50% of the path's calls **or** cost in the window, measured in R13/R14 per `user_id`.

**Estimated frequency (§5 rule 1, §13).** When real traffic is thin (R15), R may come from the **per-active-account rate**: calls per active account per day on that path, measured on real accounts. If fewer than 3 real accounts use the path, confirmed test accounts may be used, and the item is labelled. No launch-size forecast is needed: the expected launch account count multiplies every path equally, so it does not change the order. An estimated R is capped at 2, is labelled *estimated*, and **cannot trigger the queue jump**.

**Sanity check of the formula.** With A = 3 the formula reduces to the TL's L × R + C + E (§7 above). The largest possible latency term (9) is bigger than the largest C + E (6), so a severe and widespread user-facing wait outranks a pure cost item. That matches §10 Q1/Q2: cost counts, but speed comes first. For an internal-only path (A = 1) the latency term is at most 3, so a large cost (C = 3) can lift it above a middling user-facing item. That is intended.

---

## §8 Definition of Done

### Per slice (PERF-n)

A slice is done when **all** of these are true:
1. The §6 filter is recorded as five "No" answers in the slice's workplan.
2. Same-output proof is attached (§6).
3. Before/after numbers come from the same source and method as the baseline, and show an improvement beyond noise. **The noise threshold per metric is set in §5A.3.**
4. The standard cycle is complete: SA code review, QA, the user has seen the diff, then the RM commits.
5. This master doc is updated (§0 row, §11.3 result).

**No measured gain, no merge.** If the "after" numbers do not beat the noise threshold, the slice is not merged. It is recorded in §11.3 as "no measurable effect", unless the user chooses to keep it for another reason.

### Round 1

Round 1 closes at the **first** of these:
- All items the user picked at Decision point 1 are done (or recorded as "no measurable effect"); **or**
- The time box from §10 Q5 is reached. Unfinished items return to the ranked list; **or**
- The user stops it.

On close, the Phase 5 output must exist: a before/after summary per shipped slice in business terms, the remaining ranked list, and the §12 parked list with every entry complete. The user then decides whether to open the business round.

---

## §9 Guardrails

| Guardrail | Rule |
|---|---|
| Slice size | Small numbered slices (PERF-1, PERF-2, …), a few days each, reusing existing infrastructure. Anything new (a cache layer, a timing helper, an observability tool) needs SA review first (CLAUDE.md rule 7). |
| CI time | No added CI time. Any perf gate must fit inside the existing build's critical path, and SA rules on runtime before it is built. |
| Commit | Nothing is committed (even locally) before the user has seen the diff. |
| Prod DB | Read-only for agents. Migrations and indexes ship as reviewed migrations that the user applies or authorises. Index builds use `CREATE INDEX CONCURRENTLY`. No `pg_stat_statements` reset. No `EXPLAIN ANALYZE` on writes. |
| Data access | Repository pattern (CLAUDE.md rule 1) and `user_id` scoping (rule 4) still apply. Every cache key includes the tenant (`user_id` / business id). A cache must never serve one tenant's data to another. |
| LLM | Any change on an LLM path follows the BOS LLM call standards (`bos-llm-call-standards` skill). Same-output proof via the eval set. |
| Logging | Pino via `createLogger`. Timing logs carry no PII (no emails, names or message content), only ids, route and duration. |
| Money and timezone | Never sum across currencies. `user_preferences.timezone` stays the clock authority. A performance change must not move either rule. |
| Master doc | Every stage is added to this file (§0 plus the relevant section). |

---

## §10 Open Business Questions for the User

Each question has a **proposed default**, so the user can answer "defaults" for any of them.

| # | Question | Proposed default | Why we ask |
|---|---|---|---|
| Q1 | **Who should feel the speed-up first?** Rank: (a) business owners in chat and dashboard, (b) their clients on public booking and intake pages, (c) background work like reminders and insights, (d) admin screens. | a, b, c, d | Sets the Audience weight (§7) |
| Q2 | **Does "same result, lower AI or hosting bill" count as a Round-1 win, or only speed?** | Yes, it counts, as long as the output is identical | Sets whether Cost scores (§7) |
| Q3 | **Access.** (a) OK for the team to run read-only performance queries on the live database? (b) Vercel function speed data: will you export the last available days, or give read-only access? (c) Turn on real-user page-load measurement (small cost and a data-collection notice), or park it? | (a) Yes, read-only. (b) You export it now, before it expires. (c) Park it, and use local Lighthouse runs instead | Without (a) and (b) there is no baseline (§5) |
| Q4 | **Which accounts are your own test or eval accounts?** We will draft the list from the data, and you confirm it. | Exclude the accounts we list, once you confirm them | So test traffic does not drive the ranking (§5 rule 1) |
| Q5 | **Time box for Round 1?** | Up to 5 slices or 3 weeks, whichever comes first, with a check-in after slice 3 | Gives Round 1 a clear end (§8) |

---

## §11 Baseline and Ranked List (placeholders)

### §11.1 Baseline (Phase 1, DB steps captured 2026-10-12)

DB-side steps R0–R21 ran on 2026-10-12 against prod (`jgccgkyhpwirgknnceoh`), SELECT-only. R22–R25 (build, CI, Vercel, Lighthouse) are owned elsewhere and are not in this section yet. Raw outputs are in the session scratchpad (`perf-baseline/`, one file per step). They are not committed. **Every "real" number below is *provisional*** until the user confirms the excluded-accounts list (R12).

**Run facts**

| Item | Value | Step |
|---|---|---|
| Postgres | 17.4, so `EXPLAIN (GENERIC_PLAN)` is usable | R0 |
| Connector role / `transaction_read_only` | `postgres` / **`off`**: the connector can write. Every statement in this run was a SELECT or a plain `EXPLAIN` | R0 |
| Run start | 2026-10-12 18:31 UTC | R0 |
| `pg_stat_statements` | v1.11 in `extensions`; `track = top`, `max = 5000`, 4,812 entries | R1 |
| `pg_stat_statements` window | since 2026-02-20 00:47 UTC (≈ 234 days, the last server restart); `dealloc = 42`, so totals are a floor | R1 |
| Table/index counter window | `pg_stat_database.stats_reset` is null, so the counters run from the server start on 2026-02-20 (≈ 234 days). Unused-index findings are valid evidence for the window | R2 |
| T0 snapshot for later diffs | R4 output, `captured_at` 2026-10-12 18:33:26 UTC | R4 |
| DB size / cache hit | 288 MB; table hit 99.96%, index hit 99.97% | R10 |
| `token_usage` live rows | 29,664: below the heavy-table guard, so the 30-day windows stand | R10 |
| Reach denominator | Active BOS accounts in 30 days: **8 all / 5 real (provisional)**; 3 if the two weak candidates are also excluded. The platform account has 0 rows | R21 |
| Traffic | **Thin on every feature**: at most 3 real accounts a day on any BOS feature, so §5 rule 1 *estimated* applies to every BOS path | R15 |

**Excluded accounts (draft, R12, awaiting user confirmation by id)**

| user_id | Reason | Strength |
|---|---|---|
| `08456106-aa50-4810-b12c-7ca84102da31` | Active platform admin. 12 eval-like burst hours (up to 117 chat groups in one hour). 45.8% of BOS LLM cost (60 d) | Strong |
| `b509258d-0f79-43df-9ac0-0942086b0b58` | Known eval-account prefix. 6 eval-like burst hours (up to 59 an hour). 35.6% of cost | Strong |
| `868fda6a-59fa-4e99-8930-9951484078bf` | Active platform admin (10 calls, 0.2% of cost) | Strong |
| `5f63adbd-7297-4e93-b0c7-b12cc2198e85` | The only target of a `test_harness / test_take_credits` charge (R16, 2026-10-11). No chat bursts | Ask |
| `9e738959-4431-4b30-9156-c5d85f341bae` | 3 calls in total, all in one 10-second batch starting at the exact instant of the eval account's first call (2026-09-16 03:44:07) | Ask |
| `279e8e40-faa1-41d7-b992-34ea2dad820c` | Same pattern as `9e738959…` | Ask |

Concentration: no single account holds more than 50% of cost, but the top two strong candidates hold 81.4%. The *provisional* real numbers exclude the three **Strong** ids only.

**Database load (`pg_stat_statements`, 234-day cumulative window; app roles `service_role`, `authenticated`, `authenticator`, `anon`)**

App roles carry 4,982 s of statement time: `service_role` 3,438 s, `authenticated` 1,284 s, `authenticator` 260 s, `anon` 0.2 s. `postgres` (dashboard, migrations and connector, 1,914 s) and the `supabase_*` roles are platform traffic and are reported separately (R3).

| Hot path (table · operation) | Audience | queryid | Calls | Mean / max ms | % of app time | Notes | Step |
|---|---|---|---|---|---|---|---|
| `run_memories` · exact-count page by `user_id` (`authenticated`) | d / agents | -6875512150121936523 | 4,188 | 168 / 1,291 | **14.1%** | The generic plan is an index-only scan (R6), so the cost is not in the plan shape as owner. Advisors flag `run_memories` for `auth_rls_initplan` (2) and `multiple_permissive_policies` (5): RLS is the likely cost. Needs a T1 diff to show current traffic | R4, R5, R6, R7 |
| `audit_trail` · INSERT | c | 672022337835576627 | 7,254 | 41 / 589 | 5.9% | Insert path for every audited action | R4 |
| `bos_cron_runs` · INSERT | c | 3798885043333070963 | 16,710 | 8.6 / 385 | 2.9% | One row per cron run | R4 |
| `pg_timezone_names` (`authenticator`) | platform | -7726440967385220442 | 303 | 471 / 2,029 | 2.9% | PostgREST schema-cache reload, together with schema introspection (-8499716384108332911, 209 ms mean, 1.3%) | R4, R5 |
| `plugin_connections` · SELECT by `user_id` + `status` | a / c | 1219696275303107598 | 77,266 | 1.8 / 225 | 2.8% | Highest-volume app read. Index scan | R4, R6 |
| `agents` · SELECT by `user_id` + `status` | agents | -6716544499683944537 | 15,951 | 7.5 / 757 | 2.4% | — | R4 |
| `token_usage` · SELECT `cost_usd` by `activity_type` | d | -746602750349855467 | 264 | 213 / 816 | 1.1% | Index scan, about 1.2 k rows per call | R5, R6 |
| `audit_trail` · page ordered by `created_at` + exact count of the whole table | d | 4663737260211941920 | 86 | 160 / 787 | 0.3% | Plan counts all ≈ 60 k rows on every call | R5, R6 |
| RPC `purge_schema_introspect()` | d | 3778185200176754377 | 50 | 493 / 1,430 | 0.5% | Calls a function, so no plan was taken | R5 |
| RPC `(p_jobs, p_now, p_recent)` | d | -2169893070643821903 | 77 | 308 / 822 | 0.5% | Calls a function, so no plan was taken | R5 |

Statements with a mean above 100 ms (R5, calls ≥ 50) are the ten-odd above plus RPC `(p_user_id, p_since)` (129 ms, 380 calls).

**Index and table signals**

| Signal | Value | Step |
|---|---|---|
| Performance advisors | `auth_rls_initplan` 312 (123 tables, e.g. `crm_contacts` 8, `scheduling_bookings` 4, `business_profiles` 3, `run_memories` 2); `multiple_permissive_policies` 365 (41 tables); `unindexed_foreign_keys` 56 (41 tables, e.g. `scheduling_bookings` invoice/payment-plan FKs); `unused_index` 276; `duplicate_index` 11 (incl. `token_usage` `idx_token_usage_user_created` = `idx_token_usage_user_date`, `crm_contacts`, `run_memories`) | R7 |
| Never-scanned non-unique indexes | 276 indexes, 47 MB in total. The largest are vector indexes: `run_memories.idx_run_memories_embedding` 14.3 MB, `business_chat_plan_cache.idx_bcpc_embedding` 8.7 MB. Candidates only, not Round-1 drops (§5A R8) | R8 |
| Seq-scan-heavy tables (avg rows per seq scan over 1 k) | `audit_trail` 187 seq scans × 12.5 k rows; `token_usage` 893 × 4.3 k; `run_memories` 5,687 × 1.2 k; `workflow_executions` 60 × 1.1 k. `agent_executions`: 7,014 × 583 | R9 |
| Largest tables | `audit_trail` 49 MB (60 k rows), `workflow_executions` 43 MB (38 MB of it TOAST), `token_usage` 41 MB (27.5 MB of it indexes), `run_memories` 29 MB | R10 |
| Bloat signal | No table over 10 k rows with more than 20% dead tuples | R10 |

**Supabase API and Postgres logs (R11, about 24 h: 2026-10-11 18:35 → 2026-10-12 18:31 UTC, counts only)**

| Measure | Value |
|---|---|
| API responses | 2xx 33,325 (origin p50 73 ms / p95 369 ms); 3xx 20; 4xx 211; **5xx 0** |
| Top paths by volume | `scheduling_bookings` 4,487 (p95 325 ms), `business_profiles` 3,344 (275), `bos_cron_runs` 3,302 (505), `scheduling_services` 2,062, `auth/v1/user` 1,804 (504), `crm_contacts` 1,632 (462), `payment_invoices` 1,523 (492) |
| Slowest paths (n ≥ 20, p95) | `auth/v1/token` 1,169 ms, `lead_responses` 863, `payment_automation_executions` 825, `payment_reminders` 816, `daily_briefing_sends` 813, `system_settings_config` 810 |
| 4xx | 406 on `insights` (87) and `user_intake_settings` (70); 400 on `payment_invoices` (11) and `business_profiles` (9) |
| Postgres | 42 `ERROR`, 0 `FATAL`. 26 are `42703` undefined column (`payment_invoices.proposal_id` 11, `business_profiles.chase_quotes_enabled` 9, `smart_link_clicks.created_at` 4, `proposals.total_amount` 1, one other). 13 are `42501` permission denied (locked-down views and tables) |

**AI usage and cost (`token_usage`, 30 days to 2026-10-12 18:39 UTC, data from 2026-09-16)**

| Hot path (feature · call) | Audience | p50 / p95 ms (all) | Failed | Cost per call | Calls all / real | Accounts all / real | Step |
|---|---|---|---|---|---|---|---|
| chat · `planner` | a | 1,279 / 2,447 (real: 2,022 / 4,366) | 24 / 2,158 = 1.1% (real 0) | $0.00091 (real $0.00116) | 2,158 / 72 | 5 / 2 | R13, R14 |
| images · `image_generation` | a | 53,448 / 58,071 (real 54,420 / 58,286) | 0 | $0.25 | 4 / 3 | 4 / 3 | R13, R14 |
| chat · `BizQLPlanner` | a | 2,076 / 4,465 | 0 | $0.00146 | 48 / 6 | 4 / 2 | R13, R14 |
| briefing · `daily_narration` | a / c | 1,599 / 2,795 | 0 | $0.00017 | 308 / 191 | 5 / 3 | R13, R14 |
| website · `full_site` | a | 6,955 / 9,324 | 0 | $0.0126 | 4 / 3 | 4 / 3 | R13, R14 |
| insights · `health_summary` | c | 3,365 / 5,153 | 0 | $0.00036 | 92 / 45 | 5 / 3 | R13, R14 |
| website · `landing_page` | a | 6,145 / 6,984 | 0 | $0.0103 | 3 / 2 | 3 / 2 | R13, R14 |
| leads · `reply_recommendation` (p95 > 10 s) | c | 2,475 / 53,090 | 0 | $0.00012 | 4 / 2 | 3 / 1 | R13, R14 |
| chat · `verified_question_store_embedding` (p95 > 10 s) | a | 4,169 / 18,540 | 0 | ≈ $0 | 5 / 4 | 3 / 2 | R13, R14 |
| chat · `EmbeddingService` (p95 > 10 s) | a | 273 / 16,776 | 0 | ≈ $0 | 12 / 0 | 2 / 0 | R13 |
| chat · `plan_cache_store_embedding` | a | 191 / 386 (real p95 49,245, n = 8) | 0 | ≈ $0 | 604 / 8 | 5 / 2 | R13, R14 |
| chat · `BizQLPlanCache` (plan-cache hits) | a | 63 / 218 | 0 | $0 | 57 / 0 | 1 / 0 | R13 |

- BOS LLM cost over 30 days: **$3.27 all / $0.99 real (provisional)**. The chat `planner` is 60% of the all-accounts cost, mostly from the two strong candidates. It averages about 10.6 k input tokens against 94 output tokens per call. Among real accounts, `image_generation` is 76% of cost.
- Split-half noise (R15, real accounts, first 15 days vs last 15): chat feature p95 11.9 s → 6.4 s (n = 42 / 59, below 200, so use p50: 1.9 s → 1.7 s, a 10% gap); insights p95 3.8 s → 4.5 s (19%); briefing p95 2.6 s → 2.7 s (2%). Cost-per-call gaps are 34–43% per feature. At these sample sizes the §5A.3 bars are dominated by the split-half gap.
- Credit charges (R16, platform USD): $0.97 all / $0.63 real (provisional). `image_generation` is 77% / 80% of it. There is no fallback pricing and every charge succeeded. One `test_harness` charge (20,000 credits, `5f63adbd…`).
- Non-BOS LLM (R17): $0.47 of $3.73 total (12.6%), mostly `onboarding`, `business-os` and `landing-page-generation` under legacy feature names. No V6 or agent-generation feature appears in the window, so V6 is not a top hot path (§2).

**Background work (`bos_cron_runs`, recording since 2026-09-27 13:15 UTC, so ≈ 15 days; all 17 `vercel.json` crons have rows)**

| Job | Audience | Runs | p50 / p95 ms | p95 vs budget | Failed / timeouts | Empty runs | Step |
|---|---|---|---|---|---|---|---|
| `insight-detect` | c | 15 | 57,317 / 76,892 (max 92,663) | 21% of 360 s | 0 / 0 | 0% | R18, R19 |
| `insight-metrics` | c | 15 | 10,050 / 14,956 | 4% | 0 / 0 | 0% | R18, R19 |
| `daily-briefing` | c | 364 | 349 / 4,343 | 4% of 120 s | 0 / 0 | 67% | R18, R19 |
| `payment-reminders` | c | 350 | 1,272 / 3,445 | 3% | 0 / 0 | 89% | R18, R19 |
| `lead-response` (every 5 min) | c | 4,340 | 1,589 / 2,922 | 2% | 0 / 0 | **99.4%** | R18, R19 |
| `calendar-sync` (every 5 min) | c | 4,355 | 1,113 / 1,955 | 1% | 0 / 0 (**4,353 `partial`**) | 0% | R18, R19 |
| `insight-automations` (every 5 min) | c | 4,350 | 804 / 1,327 | < 1% | 0 / 0 | **100%** | R18, R19 |
| `insight-actions` (every 15 min) | c | 1,453 | 182 / 343 | < 1% | 0 / 0 | **99.9%** | R18, R19 |
| `payment-retry` (hourly) | c | 361 | 693 / 1,517 | 1% | 0 / 0 | **100%** | R18, R19 |
| `intake-reminders` / `abandoned-proposal-invoices` / `channel-metrics-sync` | c | 361 / 364 / 361 | p95 682 / 964 / 1,487 | < 2% | 0 / 0 | 99% / 95% / 91% | R18, R19 |

- No cron is near its budget. The largest is `insight-detect` at 21%.
- 22 runs are stuck in `running` past their deadline: `insight-automations` 16, `calendar-sync` 2, `channel-metrics-sync` 2, `lead-response` 1, `payment-retry` 1. These belong to TS (§2).
- Some daily jobs have fewer runs than their schedule implies (`bos-billing-reconcile` 3, `insight-measure` 5, `stripe-settlement-gap` 7, `credit-leak-check` 12 over about 15 days). This is probably later wiring to the recorder. Not verified.
- Queue backlog (R20): `payment_reminders` has 25 pending, 0 overdue by more than 1 h, and max attempts 1. `insight_actions` has 4 rows, all terminal. `payment_automation_executions` is empty. Nothing is stuck in processing.

**Skipped or deferred in the DB steps**

- R6 took no plan for the statements that call a function (`purge_schema_introspect`, the `(p_jobs…)`, `(p_user_id, p_since)` and claim RPCs), or for PostgREST-internal catalog queries.
- R6 plans were taken as the table owner, so RLS policy cost is not visible in them.
- No step was skipped for schema drift. Every "verify live" name exists: `token_usage.user_id` and `session_id` are `uuid`, and `insight_actions` has no `scheduled_at`, as expected.

#### R22 / R23: bundle and CI (captured 2026-10-12)

**R22, `next build` on origin/main `f99249b3`** (Next 14.2.35). Two runs gave identical output (556 routes). Local build *times* (28m and 10m) are **not a baseline**: the machine was saturated. The CI Build step below is the build-time number.
- **Shared JS:** 87.8 kB. Middleware: 64.9 kB.
- **Heaviest pages (First Load JS):**
  - Owner Business OS pages: `/business-os/website` 658 kB, `/business-os/crm` 655 kB, `/business-os` 651 kB, `/business-os/orders` 556 kB, `/scheduling` 554 kB, `/onboarding-build` 549 kB, `/payments` 547 kB, `/business-os/settings` 542 kB.
  - Client pages: `/site/[subdomain]` and `/[slug]` 285 kB; contact pages 231 kB; book pages 207 kB.
  - Distribution across 106 pages: 15 pages are under 100 kB, and 15 are over 300 kB.
- **Why the owner pages are heavy:** the `/business-os` layout alone carries about **566 kB gz** before any page code. The largest contributors:
  - `lib/business-os/LanguageContext.tsx` is a 12.5k-line file holding the `en`, `es` and `he` dictionaries inline. Its chunk is **159.5 kB gz** and loads on every `/business-os` page.
  - `ConfigurationDialog` is imported statically by the layout: **60.8 kB gz**.
  - `react-phone-number-input`: **50 kB gz**, on 14 pages including the public `/site` pages.
  - recharts on `/v2/agents/[id]`: **95.6 kB gz**.

**R23, CI** (`gh`, PR runs 2026-09-14..2026-10-12; first-attempt successes; docs-only runs excluded)
| | n | Median | p90 |
|---|---|---|---|
| build.yml | 314 | 3m13s | 4m03s |
| tests.yml | 148 | 3m06s | 3m58s |
| **Critical path per commit** | 147 | **3m47s** | **4m24s** |
- **Which check finishes last:** Build on 71% of commits, Tests on 28%. The median margin over the next check is only 36 s.
- **Installing dependencies** takes 59 s in Build and 1m15s in every test shard, all on the critical path. Queue time is about 0 s. There are about 100 PR builds a week.

**Candidate items from R22/R23, all passing §6, for Phase 2 ranking**
- Load only the active language dictionary (about 100 kB gz per owner page). This passes only if the dictionary is chosen before first render.
- Load `ConfigurationDialog` and `SchedulingDialog` when they are opened.
- Load the phone-number library only where a phone field is used. It is borderline where the field is visible at first paint.
- Load recharts on demand on `/v2/agents/[id]`.
- Cache CI dependencies keyed on the lockfile, in both workflows. Expected saving is about 40–60 s. SA must rule on cache-restore time against the "no added CI time" rule.
- Rebalance the test shards. This is minor: a 22 s spread, below the noise threshold.

### §11.2 Ranked list (Phase 2: SA technical scoring and BA §6 filter both done 2026-10-13; PC-5 parked as BIZ-8)

**Scoring basis (SA, 2026-10-13).** Code verified on main @ `82469a8a`. The R24 Vercel/Stripe export and the R25 Lighthouse runs are **not in**, so:
- **Every R is *estimated* and capped at 2** (§7.1): at most 3 real accounts a day on any BOS path (R15), 5 real active accounts in 30 days (R21). Every "real" figure is **provisional**: it excludes the 3 Strong ids only, and R12 is not yet confirmed by the user. No item can use the queue jump.
- **Bundle items take an *estimated* L from R22 (First Load JS), capped at 2,** until R25 gives a page-load time. Their success metric is R22, which is deterministic, so the "no measured gain, no merge" rule can still be applied.
- **E = 0 everywhere.** No ranked path has ≥ 100 calls of error or timeout data (route data comes with R24).
- **C = 0 everywhere.** No item removes measured spend with identical output. The two cost-heavy LLM paths have no output-identical lever left (see Rejected PC-R1 and §12 BIZ-1/BIZ-2). Hosting cost for crons is unknown until R24 step 3.
- IDs are candidate IDs (`PC-n`). PERF-n numbers are given only when the user picks at Decision point 1.
- The §6 column is **SA tentative**. The BA owns the filter call.

**Round 1**

| Rank | ID | Item | L | R | A | C | E | F | K | Priority | Evidence (one line per score) | §6 filter (Q1–Q5), SA tentative |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | PC-1 | **Load `ConfigurationDialog` and `SchedulingDialog` only when opened** (owner Business OS pages). Today the layout mounts `ConfigurationDialog` closed on every `/business-os` page (`components/business-os/ConfigurationDialogProvider.tsx:30`, `:196`), and the header mounts `SchedulingDialog` closed (`BusinessOSHeader.tsx:13`, `:219`). All static import sites must go lazy, or the chunk stays on those pages: `app/business-os/page.tsx:12,17`, `app/business-os/website/page.tsx:29`, `app/onboarding-build/page.tsx:25`. Reuses `next/dynamic`, which is already in the repo. Expected: about −61 kB gz per owner page, plus the `SchedulingDialog` share | 2 | 2 | 3 | 0 | 0 | 1 | 0 | **4.00** | L: R22, owner pages 651–658 kB First Load, est. (no R25). R: R21, the layout serves all 5 real active accounts, est., cap 2. A: owner dashboard = a. C: none. E: none measured. F: one slice, 4 import sites. K: UI only | Q1 No: both dialogs are closed at first paint, and the closed dialog's effects are gated (`ConfigurationDialog.tsx:117`). **Condition:** prefetch the chunk after first paint, so the first open is not visibly slower. Q2–Q5 No |
| 2 | PC-2 | **Load the phone-number library on demand on owner pages.** It is used only inside modals and drawers that open on click: `CRMContactModal`, `CRMContactDrawer`, `contact-drawer/ClientDetailsSection`, `SchedulingBookingModal` (via `components/crm/phoneField.ts:38-44`). The settings page (`BusinessProfileSection`, field visible) stays static | 2 | 2 | 3 | 0 | 0 | 1 | 0 | **4.00** | L: R22, `/business-os/crm` 655 kB and `/scheduling` 554 kB, est. R: R21, est., cap 2. A: a. C: none. E: none. F: one slice. K: UI only | Q1 No: the field sits in UI that opens on click. Same prefetch condition as PC-1. Q2–Q5 No. *Tie with PC-1 broken on reach: PC-1 is layout-wide, PC-2 covers only some pages* |
| 3 | PC-3 | **Phone-number library on demand on public booking pages.** `app/site/[subdomain]/book/BookingWidget.tsx:13,18,20` imports it statically, but the phone field belongs to a later step, after `service` (`:820`). Preload it when the step before the details step is entered. The contact-form block is **not** included, because its field is visible at first paint: that part goes to §12 BIZ-7 | 1 | 2 | 2 | 0 | 0 | 1 | 0 | **1.33** | L: R22, book pages 207 kB, `/site` 285 kB (−50 kB gz is up to ~24%), est. R: R21, est., cap 2. A: client pages = b. C: none. E: none. F: one slice. K: UI only (the payment step is untouched) | Q1 No, provided the preload lands before the details step renders. QA checks the visuals. Q2–Q5 No |
| 4 | PC-4 | **Trim the empty-run path of `lead-response`** (every 5 min, 99.4% empty, p50 1.6 s). The run is not idle: for every approved business it runs `automationApplies` + `findGaps` + a per-item `hasRowFor` in sequence (`lib/services/LeadResponseDispatchService.ts:578-690`). Batch or bound-parallelise the per-business work. **Not** "skip the run": the `bos_cron_runs` row (`lib/cron/cronRunRecorder.ts:194`) and the schedule both stay | 1 | 2 | 2 | 0 | 0 | 1 | 0 | **1.33** | L: R18, p95 2,922 ms = 2% of the 60 s budget. R: R18, 4,340 runs in 15 d, platform-wide, est., cap 2. A: background = c. C: 0 until R24 step 3 prices cron GB-hours. E: R18, 0 failed. F: one slice. K: none (messaging consent gates are untouched) | Q1 No, if the same rows are enqueued (proof: dry-run diff of the enqueue set). Q3 No: same schedule, same due times. Q5 No: the recorder row and the per-business `warn` are kept. Q2/Q4 No. **Value depends on R24 step 3.** If cron hosting cost is negligible, the user may skip it |
| — (parked, BIZ-8) | PC-5 | **Load only the active language dictionary.** `lib/business-os/LanguageContext.tsx` (12,503 lines) holds `en` (`:112`), `es` (`:4217`) and `he` (`:8141`) inline. Production code reads them only through `t()` (`:12375`); only tests import `translations` directly. Feasible: keep `en` static as the fallback and load `es`/`he` on demand. Expected: about −106 kB gz per owner page for `en` users and about −53 kB for `he`/`es` users | 2 | 2 | 3 | 0 | 0 | 2 | 1 | **1.33** | L: R22, 159.5 kB gz chunk on every owner page, est. R: R21, est., cap 2. A: a. C: none. E: none. F: two slices (a: mechanical move to per-language modules with an unchanged bundle; b: async load). K: shared infra, the provider every BOS page uses (it also carries the currency and timezone authority, CLAUDE.md) | **Q1 borderline.** First paint is *already* English for everyone (`useState('en')`, `:12136`), and `he`/`es` is applied after mount from localStorage (`:12163`). The split adds one chunk fetch to that English window on a cold cache. It passes only if the language switches *after* the dictionary has arrived (never a mixed-language frame) **and** the BA accepts the longer English window on a first visit. Otherwise it goes to §12. Q2–Q5 No. *Ranked after PC-3/PC-4 on the tie rule: async dictionaries are a new pattern (rule 7)* |
| 6 | PC-6 | **Admin platform dashboard: sum `token_usage.cost_usd` in SQL.** Today it fetches every `memory_creation` row and sums in JS (`app/api/admin/dashboard/route.ts:79-82`). The same route also pulls every `token_usage` row in the period (`:61-63`). Use one aggregate through a repository | 1 | 1 | 1 | 0 | 0 | 1 | 0 | **0.33** | L: R4/R6, query mean 213 ms, max 816, ~1.2 k rows per call; route p95 unknown. R: R4, 264 calls in 234 d. A: admin = d. C: none. E: none. F: one slice. K: none (admin read, already `requireAdmin`-gated) | Q1 No: the same total, proven to the cent on identical inputs. Q2–Q5 No |
| 7 | PC-7 | **CI: cache `node_modules` keyed on the lockfile** in build.yml and tests.yml. The npm download cache is already on (`build.yml:100`, `tests.yml:99`), so only the `npm ci` extract and link time (59 s Build, 75 s per shard) is in play | 1 | 2 | 1 | 0 | 0 | 1 | 1 | **0.33** | L: R23, critical path median 3m47s. R: R23, about 100 PR builds a week (the 2/3 boundary). A: CI = d. C: none measured. E: none. F: one slice. K: shared CI infra. The 10 GB cache budget is already contended (`build.yml:106-109`, `tests.yml:37-39`) | All No (CI only). **SA doubt:** restoring a ~1 GB `node_modules` often takes 20–40 s, so the net gain may miss the CI bar (max(10%, 30 s)). Run one spike PR before committing to the slice. *Tie with PC-6 broken on reuse: PC-7 adds a cache* |

**Concentration check.** None of the ranked paths is driven by one account. The bundle items are per page load. PC-4 is platform-wide. PC-6 is admin-only.

**BA final §6 verdicts (2026-10-13).** These replace the "SA tentative" column. Every condition below is a QA acceptance criterion for the slice's workplan.

| ID | Verdict | Acceptance criteria (summary) | Who notices |
|---|---|---|---|
| PC-1 | **PASS WITH CONDITION** | AC-1.1 both chunks are prefetched after first paint, with no click needed. AC-1.2 under Fast 3G with cache off, the first open looks identical to main: no spinner, no empty frame, same animation, same starting tab. AC-1.3 the chat-driven dialog on My Day and the onboarding-build dialog work on first open (pre-filled services, one tab, one post-back). AC-1.4 any path that opens a dialog at first render stays eager, or looks identical. AC-1.5 close behaviour is unchanged: capabilities refresh, `onClose` fires once, and the closing-grace behaviour is kept | Business owners: every Business OS page loads ~61 kB less. Nothing looks different |
| PC-2 | **PASS WITH CONDITION** | AC-2.1 prefetched after first paint. AC-2.2 the phone field renders in the same frame as the other fields on first open of `CRMContactModal`, `CRMContactDrawer`, `ClientDetailsSection` and `SchedulingBookingModal`, under throttling. AC-2.3 surfaces opened by deep link or at load stay static, or look identical. AC-2.4 the stored value and validation messages are identical for 5 sample inputs (IL, US, UK, invalid, empty). AC-2.5 `BusinessProfileSection` is unchanged | Business owners on CRM and Scheduling: pages ~50 kB lighter |
| PC-3 | **PASS WITH CONDITION** (BA change: preload **when the widget paints**, not on the step before details, because some paths skip steps) | AC-3.1 the chunk is requested once the widget paints. AC-3.2 on the fastest click path to the details step (normal flow, preselected service, single-service site), under Fast 3G with cache off, the field renders in the same frame as the others. AC-3.3 the stored phone and the confirmation email/SMS are identical. AC-3.4 the payment and confirmation screens are unchanged. AC-3.5 the contact-form block is untouched (BIZ-7) | Clients on booking pages: up to ~¼ less to download, mostly felt on mobile |
| PC-4 | **PASS WITH CONDITION, low value.** Present as "skip unless R24 step 3 shows real cron hosting cost" | AC-4.1 the dry-run diff of the enqueue set on a mixed fixture is identical. AC-4.2 one failing business does not stop the others, and the per-business `warn` and run outcome are the same. AC-4.3 exactly one `bos_cron_runs` row with the same `counts`, and `vercel.json` is unchanged. AC-4.4 two overlapping runs produce no duplicate enqueues. AC-4.5 parallelism is capped (SA sets the cap) and there are no new 429 or connection-pool errors. AC-4.6 there is one "now" per run and `user_preferences.timezone` is the time zone | Nobody, by design. At most a smaller background-hosting bill |
| PC-5 | **PARK → §12 BIZ-8.** Q1 borderline: Hebrew and Spanish owners would see English (and LTR) for longer on first visits and new devices | — | — |
| PC-6 | **PASS WITH CONDITION, low value** | AC-6.1 every dashboard figure is identical at its display precision for at least 3 periods, including one with null `cost_usd`. AC-6.2 any one-cent difference between SQL numeric and JS float is shown to the user before merge. AC-6.3 the period boundaries and the `memory_creation` filter are identical. AC-6.4 access goes through a repository method with a unit test, and auth still returns 403. AC-6.5 if the full-row pull at `:61-63` changes, AC-6.1 covers every number it feeds | Admins only, on a rarely used screen (264 calls in 234 days) |
| PC-7 | **PASS WITH CONDITION** | AC-7.1 the key is lockfile hash + `.nvmrc` Node version + OS, with no fallback restore keys. AC-7.2 a cache miss runs a full `npm ci`, and a PR that changes the lockfile passes. AC-7.3 postinstall steps run, or are proven to be in the cache. AC-7.4 a spike PR shows the median critical path down by at least max(10%, 30 s) over 10 runs, or it does not merge. AC-7.5 the existing caches keep their hit rate | Developers only: PR checks finish up to ~1 min sooner, if the spike proves it |

BA confirms BIZ-1..BIZ-7 are correctly parked, and agrees with every Rejected item. PC-R3 (duplicate indexes) would pass §6, so the drops can be folded into a later migration.

**Needs evidence** (no measured number yet)

| ID | Item | Missing evidence | How to get it |
|---|---|---|---|
| NE-1 | `run_memories` exact-count page (14.1% of app DB time, 168 ms mean) plus the RLS initplan (2) / permissive-policy (5) rewrite on that table | Whether it still runs. The 234-day total may be history. Callers are legacy agent-platform pages only: `app/v2/dashboard/page.tsx:154`, `lib/hooks/useDashboardData.ts:105`, `app/(protected)/dashboard/page.tsx:99`. Since the V2 rewrite was removed, sign-in no longer lands on `/v2/dashboard` (`app/auth/callback/page.tsx:140`) | A T1 snapshot with the R4 SQL, diffed against T0 on `queryid -6875512150121936523` (calls and mean in the window). If it is live, `EXPLAIN` it as role `authenticated` inside a read-only transaction. R24 invocations for `/v2/dashboard`. If ≈ 0 calls → Rejected. If live → one slice, K = 2 (an RLS policy migration on tenant isolation), coordinated with the DB exposure lockdown |
| NE-2 | Platform-wide `auth_rls_initplan` (312) / `multiple_permissive_policies` (365) cleanup, hot BOS tables first (`crm_contacts` 8/20, `scheduling_bookings` 4, `business_profiles` 3, `plugin_connections` 2/5) | Whether BOS hot reads run under RLS at all. In R4 the hot BOS statements run as `service_role`, which bypasses RLS. `authenticated` is 1,284 s of 4,982 s app time (R3), mostly agent-platform tables. R11 shows high REST volume on `scheduling_bookings` (4,487 a day) but not the role | A T1 diff filtered to `rolname = 'authenticated'` on those tables. If material, split per table group (CRM ×3, scheduling, business profile, plugin connections): one slice each, K = 2, coordinated with the DB exposure lockdown |
| NE-3 | `audit_trail` INSERT, 41 ms mean (max 589), 5.9% of app time. Some request paths await the flush (WC-7, the Stripe webhook) | Its cause. SA hypothesis: three never-scanned GIN indexes (`idx_audit_trail_changes`, `idx_audit_trail_compliance`, `idx_audit_trail_search`; R8, 0 scans in 234 d). Not proven: triggers have not been checked | Read-only: list triggers on `audit_trail`; `pg_stat_user_indexes` for its indexes; a T1 diff for the insert's mean. If the GIN indexes are the cause → one migration slice (`DROP INDEX CONCURRENTLY`), K = 2 (a top-10-by-calls table). SA must confirm that no search, claim or archive path reads them (§5A R8) |
| NE-4 | PERF-STRIPE-1 F1 (claim insert-first), F2 (reuse the boost purchase row), F3 (start the `invoice.paid` subscription read early) | Production durations. All local evidence is `next dev` (§11.4). Warm `invoice.paid` is p50 1.29 s and typically 3–4 s, which is real but test-mode only | R24 step 1: `/api/stripe/webhook` p50/p95, timeouts and cold-start share, plus the Stripe dashboard delivery history (response times, failures, retries per event type). Then F0: time against `next build && next start` before any code. The user already picked this slice (§11.4). It stays K = 2 and needs the P-0 Connect harness |
| NE-5 | PERF-STRIPE-1 F4 (reuse the resolver's invoice lines), F5 (one price-list fetch per burst) | Whether the rare F4 path or Stripe call volume (F5) is ever a cost in production. F5 brings no latency gain | Same R24 / Stripe export as NE-4. Fold into the NE-4 slice only if they show up there |
| NE-6 | PERF-STRIPE-1 F6, trim the route's import tree (351 modules via `invoiceSettlement.ts:316` and `route.ts:1577`) | The prod cold-start share and cold duration of `/api/stripe/webhook`. The large gain is local-only | R24 step 1 cold-start share. One slice of its own if cold starts are > 10% of invocations |
| NE-7 | PERF-STRIPE-1 F7, function region versus Supabase `us-east-2` | The actual function region (no region is set in `vercel.json`, so the default `iad1` is assumed) | R24 step 4 (Project → Settings → Functions). Config only, no slice, if it is mismatched |
| NE-8 | Server route latency in general (chat-v4 end to end, owner dashboard APIs, public booking APIs) | Route p95 and the non-LLM share. The chat planner's real p95 is 4.4 s (R14), but the route's own time is unknown | R24 step 1. Compare the route p95 with the summed `token_usage.latency_ms` per turn to find time spent outside the LLM. Any item that comes out of this is ranked at the next checkpoint |
| NE-9 | Load recharts on demand on `/v2/agents/[id]` (95.6 kB gz, R22) | Whether real accounts use the page. It is the agent platform: R17 shows no agent features in the window, and §2 sets the focus on BOS | R24 invocations for `/v2/agents/[id]`. If ≈ 0 → Rejected |
| NE-10 | (Cross-cutting) page-load time for PC-1, PC-2, PC-3, PC-5 | Lighthouse LCP/TBT, to replace the *estimated* L from R22 | R25, 5 runs per affected page, before and after |
| NE-11 | (BA, from PC-R8) Fire-and-forget chat embedding stores may never finish once the function is frozen after the reply. That would leave the plan cache unfilled, so more planner calls are paid for | Plan-cache rows written vs stores attempted | A read-only count comparison. Route the result to the chat owner or the business round: making the stores complete can change which plan is served (Q1), so it is not Round-1-clean |

**Rejected**

| ID | Item | Reason (e.g. no measurable gain, duplicate, belongs to TS or the security stream) |
|---|---|---|
| PC-R1 | Provider prompt caching for the chat planner (~10.6 k input against 94 output tokens) | **Already in place.** `lib/business-os/bizql/planner/Planner.ts:577` sends `prompt_cache_key`, and `lib/ai/providers/openaiProvider.ts:557-580` costs cached tokens at half rate. The planner default is `gpt-4o-mini` (`modelSettingsPolicy.ts:197`; the live model is DB-resolved, not verified). R13 gives $1.84 for 22.8 M input tokens, ≈ $0.081/M against $0.15/M list price, so about 92% of input is already billed as cached (real accounts ≈ 59%, because thin traffic lets the cache expire). Nothing output-identical is left. Shrinking the prompt is §12 BIZ-2 |
| PC-R2 | Speed up `image_generation` without a business change (p95 58 s, 76% of real BOS LLM cost) | **No such lever exists.** It is one provider call (`openaiProvider.ts:306-313`, `n: 1`) whose time is the provider's render. Every remaining lever changes the image or the experience (quality, size, model, format, streamed partial previews). That is §12 BIZ-1 |
| PC-R3 | Duplicate indexes (11, including the `token_usage` pair `idx_token_usage_user_created` = `idx_token_usage_user_date`, plus pairs on `run_memories` and `crm_contacts`) | **No measurable gain.** Each is a small btree. `token_usage` inserts already average 11 ms (R4), and removing one index cannot clear the 15% query bar. Fold the drops into any later migration that touches those tables |
| PC-R4 | Unindexed foreign keys (56 on 41 tables) | **No measured cost.** None of the 41 tables is in R9's seq-scan-heavy list or among R4's hot statements. The DB is 288 MB with a 99.96% hit rate (R10). Revisit only if a T1 diff shows a parent-side delete or join on one of them |
| PC-R5 | `pg_timezone_names` (303 calls, 471 ms mean) | **Not app code.** It is PostgREST's schema-cache reload (role `authenticator`), run after DDL or restarts, about 1.3 times a day. No user request waits on it in a way we control |
| PC-R6 | Full exact count on the admin `audit_trail` list (86 calls, 160 ms mean) | **No pass-shaped gain.** The count is already an index-only scan (R6). The only real speedups, an estimated total or dropping the total, change what the admin sees, so they belong in §12 BIZ-6 |
| PC-R7 | Empty-run trims for `insight-automations`, `insight-actions`, `payment-retry`, `payment-reminders` | **Nothing removable, or an order risk.** `insight-automations` already does one query when idle (`AutomationManager.ts:358-383`). `insight-actions` has a p50 of 182 ms. The two payment crons run ordered money stages in sequence (`payment-reminders/route.ts`: bill due stages → overdue → reminders → mark overdue), and they run hourly with nobody waiting. Skipping the run itself is §12 BIZ-5 |
| PC-R8 | Slow chat embedding stores (`plan_cache_store_embedding` real p95 49 s, n = 8; `verified_question_store_embedding` p95 18.5 s) | **Not on the user's path.** Both are fire-and-forget (`Planner.ts:785` `void cache.store`; `app/api/business-os/chat-v4/route.ts:2071` `void ...remember`). The long tail most likely measures a function frozen after the reply |
| PC-R9 | Rebalance the Jest shards | **Below the noise bar.** A 22 s spread against the CI bar of max(10%, 30 s) (§5A.3, R23) |

### §11.3 Delivery results (Phase 4/5)

| Slice | Item | Before | After | Same source? | Same-output proof | PR | Status |
|---|---|---|---|---|---|---|---|
| PERF-1 | Configuration/Scheduling dialogs on demand (PC-1) | First Load JS: `/business-os` 663, `/crm` 670, `/scheduling` 564, `/orders` 572, `/settings` 552, `/payments` 558, `/website` 668, `/onboarding-build` 559 kB | 520 / 561 / 452 / 393 / 387 / 381 / 531 / 450 kB (−16% to −32%); layout 588 → 351 kB gz; +0.8 kB shared on every route | ✅ `next build` route table at the same base (`468845cc`), deterministic | Guard tests; QA AC review; browser checks on a production build (§0) | [#342](https://github.com/AgentsPilot/neuronforge/pull/342) | ✅ Merged 2026-10-13 |
| PERF-2 | Phone-number library on demand (PC-2) | `/business-os` 520, `/crm` 561, `/scheduling` 452 kB (after PERF-1) | 472 / 512 / 403 kB (−8.7% to −10.8%); re-measured on `861a742a`: 473 / 513 / 404 kB | ✅ Same method | AC-2.4 26/26 identical; live save round-trip stored the same `+972…` value | [#344](https://github.com/AgentsPilot/neuronforge/pull/344) | ✅ Merged 2026-10-13 |
| PERF-3 | Phone library on public booking (PC-3) | — | — | — | — | — | ⬜ Not shipped: the target was dead code (`BookingWidget.tsx`); the live booking flow has no phone library |

### §11.4 User-directed slices

Slices the user added directly. They skip Decision point 1 because the user has already picked them. They still follow measure-first, the §6 filter, the §8 definition of done and the §9 guardrails, and they count toward the §10 Q5 time box.

#### PERF-STRIPE-1: Stripe webhook route slow enough to time out

**Added:** 2026-10-12 by the user, from the Stripe testing session. **Status:** 🟡 Diagnosed (code trace plus DB timings). Waiting on the Stripe dashboard delivery history before deciding whether code changes are warranted. No code until SA has reviewed a fix.

**Diagnosis (2026-10-12).** Read-only code trace on main @ `82469a8a`. Full detail with file:line is in the session scratchpad (`perf-stripe/diagnosis.md`).
- **No fixed timeout is waited out anywhere in our webhook code.** Checked: timeout constants, retry and polling loops, `AbortSignal`, locks, advisory locks, sleeps, and audit flushes on the `charge.updated` path. `charge.updated` makes 3 DB calls and no Stripe calls. It is not one of the boost charge event types.
- **Most likely cause of the local ~30 s:** the `next dev` route is disposed after 60 s idle (`onDemandEntries` defaults) and recompiled on the next hit. With dynamic imports the route is 351 modules (openai, anthropic, textract, react-pdf, xlsx through `invoiceSettlement.ts:316` → `plugin-executer-v2` and `route.ts:1577` → `BookingEmailService`).
- **Concurrency:** the 11 events share no lock. Claims are per `event_id` with no claim RPC. Only `invoice.paid` takes row locks, inside one short RPC.
- **Real handler cost:** 3 sequential network calls for no-op events; 4 DB calls plus 1–2 Stripe calls for plan `checkout.session.completed`; 6–8 DB calls plus 1–3 Stripe calls for plan `invoice.paid`.

**DB timing evidence.** Read-only query on `processed_webhook_events`, last 30 days. All rows are test mode; there are no live-mode events. *Lag* = claim time minus Stripe's `created`, which includes delivery delay and compile. *Handler* = `completed_at − processed_at`, our own code.
- `charge.updated`: handler p95 0.90 s, max 2.90 s. The slow delivery (2026-10-12 18:05) had a **lag of 32.7 s and a handler time of 2.9 s**, so the ~30 s happened before our code ran. This confirms the diagnosis.
- `customer.created`: handler max 0.63 s, lag 230.8 s (resend).
- The plan-payment burst (2026-10-12 18:22): all 11 events were claimed within the same 0.1 s after about 24 s of lag. They queued on one thing, consistent with a compile. Inside the handler, `invoice.paid` took **30.1 s** and `checkout.session.completed` **19.8 s**, while the others took about 3.3 s. This *is* time inside our code. The likely cause is the first-use compile of the dynamic import chains (local only), but this is **not yet proven**.
- When warm, `invoice.paid` takes p50 1.29 s and typically 3–4 s (lag about 2 s). That cost is genuine and is the real target of F1–F3.
- Bursts on other days (2026-09-30 to 2026-10-09) show the same pattern of about 20–30 s lag and fast handlers. The table does not record which endpoint (local CLI or deployed) received each event. The Stripe dashboard delivery history (R24) decides that.

**Candidate fixes from the diagnosis.** All need SA review plus the P-0 Connect harness.
| # | Fix | §6 | Expected saving |
|---|---|---|---|
| F0 | Time locally against `next build && next start`, or keep the route warm, before any code change | PASS (dev only) | Removes the local artefact; no prod effect |
| F1 | Claim insert-first (`route.ts:2279-2326`) | PASS, if SA confirms all 4 claim states behave the same | 1 call per event |
| F2 | Reuse the boost purchase row within one request | PASS; a new pattern, so SA must review | 1–2 calls on boost events |
| F3 | Start the subscription read in `invoice.paid` early, alongside the account lookup | PASS in that form only | About 1 Stripe call |
| F4 | Reuse the resolver's invoice lines | PASS | Rare case only |
| F5 | One price-list fetch for a whole burst | PASS | Fewer Stripe calls, no latency gain |
| F6 | Trim the route's import tree (lazy heavy chains) | PASS. Better as its own slice | Big local gain, small prod cold-start gain |
| F7 | Match the Vercel function region to the Supabase region | PASS (config) | 0.5–1.5 s per money event if they are mismatched. **Likely already fine:** Supabase is in `us-east-2`. Neither `vercel.json` nor the route sets a region, so Vercel's default `iad1` (us-east-1) applies, which is only a few ms away. Confirm with R24 step 4 |
| F8 | Reply to Stripe before processing | **PARK** (Q5) | — |
| F9 | Stop awaiting the audit flush | **PARK** (Q5) | — |

**Observed locally (2026-10-11/12).** `next dev` on main @ `96ced52a`; Stripe sandbox; `stripe listen --all-snapshot` forwarding to `localhost:3000/api/stripe/webhook`; the CLI waits at most 30 s for a reply.

| Event | Delivery | Time to reply |
|---|---|---|
| `charge.updated` (after a boost payment) | First delivery | > 30 s, timed out |
| Same event, resent alone | Resend | ~30 s (200). Slow both times |
| `customer.created` (plan checkout start) | First delivery | > 30 s, timed out. Resent: ~13 s |
| Plan payment: 11 events at once (`invoice.paid`, `checkout.session.completed`, `invoice_payment.paid`, `customer.subscription.created`, …) | First delivery | 8 answered in ~27 s. `invoice.paid`, `checkout.session.completed` and `invoice_payment.paid` timed out (> 30 s) |
| Those three, resent one at a time | Resend | 10–18 s each (200) |
| `product.created` (no handler work) | Warm route | ~2 s |

**Not broken (do not re-test).** The work completes even when the reply is late: the plan was written about 45 s after payment, and boost credits were granted. Resends are idempotent: still one billing row, one audit entry, and the plan version unchanged.

**Why it matters.** If production replies are this slow, Stripe marks deliveries as failed and retries them, so payments show up late in the app. The retries themselves are harmless, but the delay and the noise are real.

**Questions to answer, in order**
1. **Production timing first.** Real `/api/stripe/webhook` durations and timeouts from the Vercel export (R24; the route is added to that capture). Delivery history on the production webhook endpoint in the Stripe dashboard: response times, failures, retries. The user exports these; capture counts and timings only, no payloads. This decides whether the problem is a local dev-server artifact or real in production.
2. **Where the time goes inside the handler.** Even warm and one at a time, money events take 10–18 s locally against ~2 s for a no-op event. Time each step: signature check, event claim, the Stripe API calls made inside handlers (re-fetching invoices, payment intents, subscriptions), DB calls and RPCs, and the audit `flush()` before responding.
3. **The ~30 s on `charge.updated`.** It happened twice, on first delivery and on resend. A consistent ~30 s looks like a fixed timeout being waited out somewhere, not general slowness. Find which code path `charge.updated` takes.
4. **Concurrency.** Eleven events arrive together on every subscription payment. Check whether they contend for one lock or the same rows.

**Pointers.** `app/api/stripe/webhook/route.ts`, `lib/business-os/billing/webhookDispatcher.ts`, `lib/business-os/billing/planBillingHandler.ts` (P-3b.2, PR #299), and the boost charge handler in `lib/business-os/boost/`. The local dev server compiles routes on first use (the first hit took 54 s), so warm the route before timing anything.

**Constraints**
- **High risk (K = 2).** The route carries live Connect money (requirement SR-10). Any change needs SA review **and** the P-0 Connect harness evidence. See the plan payments requirement and the Stripe webhook repository work (CF-5).
- **§6 filter notes, settled up front.**
  - Making the handler itself faster (fewer redundant Stripe re-fetches, parallel independent calls, removing a waited-out timeout, cheaper DB access) **passes**.
  - Replying 200 to Stripe **before** the work is done (acknowledge first, process in the background) **fails Q5**: if the work then fails, Stripe no longer retries it. That changes failure behaviour on money events, so it goes to §12 (business round) unless SA shows the existing claim/queue already guarantees the retry.
  - Changing the audit `flush()` before the reply also touches Q5 (records kept). It is borderline, and parked unless it is proven loss-free.
- **Possible real bug.** If question 3 finds a fixed timeout being waited out on every call, the root cause is a defect. It is still fixed in this slice, but logged in §0 as a bug found, not only a speed-up.
- **Same-output proof.** The resend idempotency checks above (one billing row, one audit entry, plan version unchanged) plus the P-0 Connect harness.
- **Noise threshold.** §5A.3 "p95 latency" and "error / timeout rate", using the Vercel and Stripe delivery data from question 1.

---

### §11.5 Out-of-scope findings (documented, lower priority)

The Phase-1 baseline turned these up. They are **not performance items**, and the user decided on 2026-10-12 to keep them **out of this stream's plan, at lower priority**, so the focus stays on performance. They are recorded here so they are not lost. Each goes to its owner when the user chooses.

| # | Finding | Evidence | Suggested owner |
|---|---|---|---|
| X-1 | 26 Postgres `42703` undefined-column errors in 24 h: `payment_invoices.proposal_id` ×11, `business_profiles.chase_quotes_enabled` ×9, `smart_link_clicks.created_at` ×4, `proposals.total_amount` ×1. They match 400s on those REST paths. These are real failing requests. | R11 | Troubleshooter (`business-os-schema-check`) |
| X-2 | `calendar-sync` ends `partial` in 4,353 of 4,355 runs. | R18 | Troubleshooter |
| X-3 | 22 `bos_cron_runs` rows are stuck in `running` past their deadline (16 of them `insight-automations`). | R18 | Troubleshooter / durable-queue-drain owner |
| X-4 | Unverified: for real accounts, chat token cost is $0.093 but `chat_turn` charge cost is $0.0445 (72 planner rows vs 21 charges). | R14 / R16 | Credit-deduction owner |
| X-5 | Security advisors: 13 `security_definer_view`; 6 `rls_disabled_in_public` (incl. `agent_executions`, `shared_agents`); 7 `authenticated_security_definer_function_executable`; 34 `rls_enabled_no_policy`; 145 `function_search_path_mutable`. Also auth OTP expiry, leaked-password protection and the Postgres version. | R7 | DB exposure lockdown stream |
| X-7 | `/business-os/crm` stays on "Loading contacts…" forever for an account with **zero pipeline stages**, because board view is the default and `fetchBoard` returns before `setLoading(false)` (`app/business-os/crm/page.tsx:267`). Found during the PERF-2 browser check. Pre-existing on main, and not touched by PERF-2. | Browser check 2026-10-13 | CRM owner (small UI fix) |
| X-6 | The Supabase connector runs as role `postgres` with `transaction_read_only = off`. Agent sessions can write to prod, so only the agents' own rules keep them read-only. | R0 | User / environments & deployment strategy |

---

## §12 Parked: Business Round

Items that failed (or were borderline on) the §6 filter. These are **not** rejected. They are inputs to the business round, where the user decides on the business change. The first entries were added by SA on 2026-10-13 during Phase 2 and are **SA tentative**: the BA confirms the filter call.

**Entry format** (every column is required):

| ID | Item | Filter question(s) failed | What would change for the business (plain terms, who notices) | Expected gain (speed / cost / reliability, with evidence) | Evidence source | Raised by / date |
|---|---|---|---|---|---|---|
| BIZ-1 | Faster or cheaper website images: lower quality or size, another image model, a different file format, or streamed partial previews | Q1 (the image itself), Q4 (preview experience) | Generated website images would look different, or would appear progressively. Owners building their site notice | Today: p50 53 s, p95 58 s per image, $0.25 each, 76% of real accounts' BOS LLM cost ($0.75 of $0.99 over 30 d, provisional). The gain depends on the option chosen | R13, R14, R16 (`image_generation`) | SA / 2026-10-13 |
| BIZ-2 | Trim the chat planner's instruction prompt (~10.6 k input tokens per call against 94 output) | Q1 (plan quality and wording) | Chat answers could change for some questions. Owners notice. Needs the eval golden set | Planner is 60% of all-account BOS LLM cost ($1.96 / 30 d). Input is already ~92% cache-billed (PC-R1), so the removable cost is at most about half of the input bill. Some latency gain on cache misses | R13, R14 | SA / 2026-10-13 |
| BIZ-3 | PERF-STRIPE-1 F8: reply 200 to Stripe before the work is done | Q5 (failure behaviour on money events) | If the work fails after the reply, Stripe no longer retries it, so a payment could be missed silently. Owners and the platform would notice only when something goes wrong | Removes all handler time from Stripe's timeout (warm `invoice.paid` 3–4 s, test mode) | §11.4 diagnosis, `processed_webhook_events` | SA / 2026-10-13 (from §11.4) |
| BIZ-4 | PERF-STRIPE-1 F9: stop awaiting the audit flush before replying to Stripe | Q5 (records kept) | An audit row for a money event could be lost if the function freezes after the reply. Admins and support notice later | Small: one flush per money event | §11.4 diagnosis | SA / 2026-10-13 (from §11.4) |
| BIZ-5 | Run the mostly-empty crons less often, or skip recording their empty runs (`insight-automations` 100% empty, every 5 min; `insight-actions` 99.9%, every 15 min; `lead-response` 99.4%, every 5 min; `payment-retry` 100%, hourly) | Q3 (schedule), Q5 (cron history rows) | Lead replies, chases and automations would go out later, and the admin cron-health page would show fewer runs. Owners and admins notice | Up to about 10.5 k fewer invocations in 15 d across the four jobs (4,350 + 1,453 + 4,340 + 361 runs). The hosting saving is unknown until R24 step 3 | R18, R19 | SA / 2026-10-13 |
| BIZ-6 | Admin audit-trail list: show an estimated total, or drop the total, instead of an exact count | Q1 (the number shown) | Admins see "about 60,000" or no total instead of the exact figure | Up to 160 ms mean on an admin screen used 86 times in 234 d. **Gain is small.** Listed for completeness | R5, R6 (`queryid 4663737260211941920`) | SA / 2026-10-13 |
| BIZ-7 | Load the phone-number library on demand in the public site's contact-form block (`components/website/blocks/ContactFormBlock.tsx:6-10`), where the phone field is visible at first paint | Q1 borderline (first paint, §6 borderline rule) | On a site with a contact form, the phone field could appear a moment after the rest of the form. Clients notice | About 50 kB gz off `/site/[subdomain]` and contact pages (285 kB / 231 kB First Load) | R22 | SA / 2026-10-13 |
| BIZ-8 | Load only the active language dictionary (PC-5, `lib/business-os/LanguageContext.tsx`) | Q1 borderline (first paint) | English owners load ~106 kB less. Hebrew and Spanish owners see English, with Hebrew also left-to-right, for longer before their language appears, mainly on first visits and new devices. **Business-round option:** choose the language before first render from a cookie or the server. That also removes today's English flash, but it is a new pattern that needs SA review | About −106 kB gz per owner page for `en`, about −53 kB for `he`/`es` (159.5 kB chunk) | R22; `LanguageContext.tsx:12136/12163` | BA / 2026-10-13 |

---

## §13 Open Questions (team-internal)

- [x] **SA:** Confirm that `pg_stat_statements` is enabled on prod and how far back its data goes. If it was reset recently, the baseline window is short. (raised by: BA | status: **resolved by SA 2026-10-12** | resolution: the exact read-only SQL is runbook step **R1** (§5A). The main session runs it via the connector and records `stats_reset`, the window length and `dealloc` in §11.1. If the extension is missing, it is **not** enabled without user approval. The `pg_stat_statements` sources are then marked "Needs evidence". Windows are taken by snapshot diff, never by reset (§5 rule 4))
- [x] **SA:** Set the noise threshold per metric (p95 latency, error rate, cost) used by the "no measured gain, no merge" rule. (raised by: BA | status: **resolved by SA 2026-10-12** | resolution: §5A.3. The BA's ±10% becomes a floor: the real bar is max(10%, 2 × the observed split-half gap), with minimum samples. The synthetic query measure uses **buffers**, not time, and runs `EXPLAIN ANALYZE` only on plain SELECTs that call no function. Error and cost bars have their own rows)
- [x] **SA:** With thin real traffic before launch, decide whether "expected at launch" frequency may be used, and how it is estimated. (raised by: BA | status: **resolved by SA 2026-10-12** | resolution: allowed. The estimate is the measured per-active-account rate, so no launch forecast is needed. It is labelled *estimated*, R is capped at 2, and it cannot trigger the queue jump. See §7.1)
- [ ] **TL:** Should insight cron cost from the eval account (the eval-usage leak, currently parked) be excluded by account id now, before that fix ships? (raised by: BA | status: open | suggested resolution: yes, exclude via the §10 Q4 list)

---

## §14 Integration Points

Affected by measurement (read-only). Code changes are decided per slice.

| Area | Systems / tables |
|---|---|
| Database | Supabase prod (`pg_stat_statements`, advisors), all `lib/repositories/` |
| LLM | `getProviderFactory()`, BOS `callWithTracking`, usage rows, `business_os_credit_charges`, admin AI activity view |
| Background | Vercel crons (insight-detect, insight-automations, payment reminder/automation drains), claim/drain tables |
| Hosting | Vercel functions (duration, cold starts), Next.js build/bundle |
| Quality gates | `npm run eval:chat` (same-output proof), CI critical path |
| Related streams | DB exposure lockdown (security advisor findings), Troubleshooter (real failures), eval usage leak exemption (test-account exclusion), environments and deployment strategy (no staging DB: all measurement is against prod, read-only) |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-12 | Created | BA merged the TL framing with BA refinements: a 5th filter question (failures and records), Reach and Audience factors plus a concentration check in the rubric, test/eval account exclusion, a definition of done (per slice and Round 1) with "no measured gain, no merge", defaults for all user questions, and the format for the parked list. Status: Draft. |
| 2026-10-12 | User answers | User accepted all §10 defaults. Recorded in §0. |
| 2026-10-12 | Out-of-scope findings | The user decided to record the six non-performance baseline findings (X-1..X-6) in §11.5, keep them out of this plan, and treat them as lower priority. |
| 2026-10-12 | PERF-STRIPE-1 added | The user added a dedicated slice from the Stripe testing session: the webhook route is slow enough to time out. Added in §11.4. The Stripe webhook route and the Stripe dashboard delivery history were added to the R24 export. |
| 2026-10-12 | SA review: APPROVED WITH CHANGES | §5 table fixes (`token_usage` feature/component naming, `bos_cron_runs`, cron schedules from `vercel.json`, columns never to select). §5 rules 4–6 added (snapshot diff, writes-nothing probes, capture order). New §5A Phase-1 Baseline Runbook (R0–R25) and §5A.3 noise thresholds. New §7.1 scoring mechanics (C/E 0–3, K 0–2, numeric bands, audience mapping, concentration and estimated-R rules). §8 rule 3 now points to §5A.3. §13 SA items resolved. §0 row added; status updated to Phase 1. |
| 2026-10-12 | Phase 1 DB baseline | §11.1 filled from runbook steps R0–R21 (prod, read-only): run facts, the R12 excluded-accounts draft (awaiting user confirmation, so real numbers are provisional), DB load (R3–R6), advisors and index/table signals (R7–R10), log counts (R11), AI usage and cost (R13–R17), and crons and queues (R18–R20). §0 rows added: baseline captured, security advisors routed to the DB exposure lockdown, failures routed to TS. R22–R25 not included. |
| 2026-10-13 | Phase 2: SA technical scoring | §11.2 filled. The scoring basis is stated there (R estimated and capped at 2, bundle L estimated from R22, C and E at 0, provisional real figures). It has a ranked Round-1 table (PC-1..PC-7, with code file:line), Needs evidence (NE-1..NE-10, each with how to get it) and Rejected (PC-R1..PC-R9). §12 gets its first entries, BIZ-1..BIZ-7 (SA tentative), and the example row is removed. §0 row added; the current phase is now 2. |
