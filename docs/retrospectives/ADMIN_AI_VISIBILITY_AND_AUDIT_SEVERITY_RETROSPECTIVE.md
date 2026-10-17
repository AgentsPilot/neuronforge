# Admin AI Visibility & Audit Severity Retrospective

> **Last Updated**: 2026-10-02
> **Cycle Duration**: 2026-09-22 (one user question) → 2026-10-02 (last merge)
> **Outcome**: Nine PRs merged to `main`; `main` tip at the time of writing is `34d665b4`

## Overview

This was a multi-cycle session, not a feature. It started with one question — after the Business OS LLM
attribution work, is there anywhere an admin can actually *see* the AI calls now being tracked? The
answer was "partly": audit lines on one admin page, cost lines on another, nothing joining them. A
second thread opened on 2026-09-30 when the user noticed a refund flagged as a `critical` event needing
attention. Headline numbers: 11 calendar days, 9 merged PRs, 7 findings worth carrying forward, 7 open
items, 2 cycles the user had to cut back, 1 standing preference recorded, and the original ask (Gap B)
**still unbuilt** — and now needing re-planning rather than implementation.

---

## What we shipped

| PR | What |
|---|---|
| #100 | Business OS AI actions became filterable in `/admin/audit-trail` — catalogue-driven dropdowns, AI detail renderer. Also closed a live `error.message` leak to the client on a cross-account admin route |
| #106 | `/admin/business-os-llm` reworked after the user found it unreadable — switch surface and fail-open banner removed, provenance markers re-based on database-vs-code |
| #111 | Cross-tenant fix: the insights cron minted one `runId` per run and reused it across every business, so one `session_id` spanned N businesses |
| #113 | The Gap B slice-B0 workplan committed |
| #138 | A missing resource name stopped masquerading as a GUID; business name added beside the user |
| #141 | The account filter chip shows a business name instead of a truncated UUID |
| #146 | A business-name picker, so an operator can set the account filter without knowing a UUID |
| #147 | The audit filter card tightened — ~434px to ~228px, 1 to 3 visible rows at 1080p |
| #157 / #160 / #167 | Audit severity false positives fixed (refund, plan cancellation, password change); a refused admin access is now recorded |
| #169 | `.gitignore` cleanup |

PR numbers are this session's own record. `#167` (`feature/record-refused-admin-access`) and `#169` are
the merges visible at the `main` tip above.

---

## The findings worth remembering

Each of these cost review rounds. They would otherwise be rediscovered.

1. **ts-jest in this repo does not type-check.** SA asserted a missing field would redden a suite; Dev
   disproved it; SA re-ran it twice and retracted. `const n: number = 'definitely not a number'` passes
   in a test file. With no CI job running Jest and `next.config.js` setting `ignoreBuildErrors: true`,
   **a scoped `tsc` is the only type gate in this repo** — and `npx tsc --noEmit -p tsconfig.json` OOMs
   silently and reads as a clean pass. A throwaway scoped config over the touched files, compared against
   the same files on clean `main`, is the only honest check. This outlives every other finding here.
2. **An audit writer's `severity` beats the registration.** `AuditTrailService.ts:173` resolves
   `input.severity || metadata.severity`, and `:174` does the same for `compliance_flags`. Changing
   `lib/audit/events.ts` alone fixes nothing — the call site's override has to go in the same commit, and
   both keys, not just severity.
3. **`AuditTrail.log()` only queues** (batch 100 / 5000 ms, `AuditTrailService.ts:112-128`). A row written
   just before a 403 or a redirect is lost when the serverless instance freezes. Worse, `flush()`
   early-returns while another flush is in flight (`:245`) and clears the queue before the insert
   (`:250-251`), so a second concurrent caller **resolved reporting success having written nothing**.
4. **A failed audit INSERT is invisible** — the service is `silent: true` by default (`:73`), and
   `handleError` logs and swallows. No test in this repo can prove a row lands.
5. **Nine registered security audit events have zero writers**, five of them naming four features that do
   not exist at all (impersonation, 2FA, account termination, data erasure). The admin "critical events"
   tile has therefore never shown a security event and cannot.
6. **`(session_id, user_id)` is permanently the correct grouping key** for `token_usage`, even after #111.
   Historical rows carry the shared id with no discriminator but `user_id`, are not backfilled, and cannot
   be split without editing append-only audit evidence.
7. **A hand-written `as never as {…}` / `as unknown as {…}` signature re-declaration defeats every
   type-level protection.** Threading one new type exposed five test files doing it; three snapshots had
   pinned the broken value. The repo-wide population of that cast shape is ~90 sites.

---

## Process, honestly

Two cycles drifted and the user corrected both. A three-line refund fix grew into a nine-commit slice
before they cut it back to the one part they wanted; an account-picker change acquired URL-mirroring
behaviour nobody asked for, which two reviewers independently found had made shareable links misleading.
The pattern in both: every individual step was approved, but the next step kept being *offered* rather
than the work being allowed to stop. A standing preference was recorded as a result — UI-only work takes
a short path (user → Dev → SA + QA in parallel → user reads the diff → RM), and the full cycle is
reserved for data, money, security and unsettled design.

---

## Open items

| Item | Context to pick it up cold |
|---|---|
| **Gap B — the original ask, still unbuilt** | `docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md` (approved 2026-09-22, FR-B1…FR-B11). **Needs re-planning, not implementation**: the user observed that `business_os_credit_charges` (migration `20261015`) already materialises one row per AI action with cost, service, outcome and account, written from inside `runAiAction` — which may make the planned B0 grouping RPC redundant. Decide that before any B1 work |
| **The customer-facing monitoring page** | `app/(protected)/monitoring/page.tsx` — a permanently-zero "Failed Logins" card (`:787-788`), a banner keyed on **severity alone** (`:281-296`, message at `:292`, score at `:1035`/`:1039`), and 6 `console.*` calls. Consequence already live: a non-admin who opens `/admin` once sees *"1 critical security event(s) detected"* about themselves. The durable fix is reading by **action and audience**, not severity |
| **The audit-trail CSV export** | `app/admin/audit-trail/page.tsx:431-442` — `exportLogs` builds rows with a bare `.join(',')`, no quoting, no escaping: column-shifting on any value containing a comma, and formula injection on a leading `=`, `+`, `-` or `@`. The in-file comment at `:423-430` makes this the explicit gate on adding the Business column the page now shows — fix the quoting first |
| **Three Business OS events still unregistered** | `PAYMENT_INVOICE_VOIDED`, `TOKEN_DISCREPANCY_DETECTED`, `USER_PASSWORD_CHANGE_FAILED` (the last written as a bare literal at `app/api/user/change-password/route.ts:148` and `:171`, so every row reads `description: "Unknown event: …"`). Plus 31 unregistered action values measured live in `audit_trail`. Registering an event is a decision, not a cleanup |
| **The descoped action-filtered dashboard tile** | Full 14-file plan already written: `docs/workplans/security-audit-events-workplan.md` T5/T6/T7. It was implemented, then reverted on the user's scope cut |
| **A shared admin density standard** | Recommended by SA, never written. Two pages have been densified ad hoc so far |
| **The bounded-flush residual** | `lib/audit/boundedAuditFlush.ts`'s serialising chain covers its own callers only — the ~12 other `AuditTrail.flush()` callers still hit the `isFlushing` early return |
| **Workplan commit record** | `docs/workplans/security-audit-events-workplan.md` still reads Status "Uncommitted" with `## Commit Info` as *"RM to populate"*, although its work merged as #167. Needs closing out |

---

## Owed by the user in production

Not provable from this repo. Nothing in the tree can substitute for any of these.

1. **Verify a refusal row actually lands.** Get refused on an admin URL, then filter `/admin/audit-trail`
   by `action = SECURITY_UNAUTHORIZED_ACCESS`. Every test around this mocks PostgREST, and the service
   swallows insert failures (finding 4) — so this check is the *only* evidence the feature works.
   Worth doing twice concurrently as well: two simultaneous refusals must produce **two** rows.
2. **Confirm the indexes.** `audit_trail` should carry `idx_audit_trail_action` and
   `idx_audit_trail_created_at` in production (there is no composite `(action, created_at)`).
3. **Post-deploy checks still outstanding from the Business OS LLM Layer 2 work**, which predates this
   session and is not closed by anything merged here.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-02 | Initial retrospective | Written by TL covering 2026-09-22 → 2026-10-02: the admin AI-visibility thread and the audit-severity thread. Records 9 merged PRs, 7 carry-forward findings, 7 open items and 3 production checks owed. Uncommitted — RM commits separately. |
