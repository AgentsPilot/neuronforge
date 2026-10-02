# Requirement: Making the Security Audit Events Real

> **Last Updated**: 2026-09-30

**Created by:** BA
**Date:** 2026-09-30
**Status:** Draft — written to support a go/no-go decision, not to argue for the work

## Overview

The admin Health landing has a tile that counts `severity: 'critical'` audit rows in the last 24 hours, and an operator reads it as "a security event needs attention". The nine events it was designed to catch are registered in `lib/audit/events.ts` and **nothing writes any of them**, so the tile has never shown a security event and cannot. This document establishes which of the nine describe something that can actually happen in this product, what each would cost, what it would buy two technical-owner admins, and how that compares with simply renaming the tile to what it really means.

**Bottom line up front:** of the nine, **one** is cheap and worth doing, **two** are projects with no detector behind them, **five** describe features this platform does not have, and **one** belongs to the parked AgentsPilot product. Separately, the tile would still not be a security tile even if all nine were written, because it filters on *severity* and not on *action* — that is a second change, and it is the change the operator actually wants.

---

## Table of Contents

1. [Per-event verdict](#1-per-event-verdict)
2. [Why the tile is not fixed by writing the events](#2-why-the-tile-is-not-fixed-by-writing-the-events)
3. [What it would buy](#3-what-it-would-buy)
4. [Options](#4-options)
5. [Overlap with existing work](#5-overlap-with-existing-work)
6. [Functional requirements, if Option B is chosen](#6-functional-requirements-if-option-b-is-chosen)
7. [Acceptance criteria for Option B](#7-acceptance-criteria-for-option-b)
8. [Out of scope](#8-out-of-scope)
9. [Open questions](#9-open-questions)
10. [Notes on integration points](#10-notes-on-integration-points)
11. [SA Review Notes](#sa-review-notes)
12. [Change History](#change-history)

---

## 1. Per-event verdict

Every "does it exist" claim below was read from the code on `main`, 2026-09-30. Where a fact could not be established from the repository, it is marked **unverified**.

| Event | Does the thing it names occur today? | Verdict | Effort |
|---|---|---|---|
| `SECURITY_UNAUTHORIZED_ACCESS` | **Yes.** Two refusal points already exist and already log. `requireAdmin` (`lib/admin/requireAdminRoute.ts:85`) writes a Pino `warn` — "Non-admin attempted an admin request" — and returns 403. `resolveActingUserIdentity` (`lib/server/route-identity.ts:134`) does the same for a refused act-as. Neither writes an audit row. | **Cheap — real, and the only one that is** | S |
| `SECURITY_ANOMALY_DETECTED` | Only if something decides what "anomalous" means. There is no detector, no baseline, and no scheduled job that looks at audit history. | **Project** — "write the event" and "build the thing that decides when" are different pieces of work | M–L |
| `SECURITY_BREACH_DETECTED` | No. Nothing in the platform can conclude a breach. A breach is established by a human after investigation, not by a rule. | **Project, and arguably not a product feature at all** | L |
| `ADMIN_IMPERSONATION_STARTED` / `_ENDED` | **No — the platform has no impersonation.** There is no `app/api/admin/impersonate/*` route (verified against the full list of 59 admin route files). `docs/admin/ADMIN_IMPERSONATION_IMPLEMENTATION_PLAN.md` exists but was never built, and is stale: it specifies `profiles.role = 'admin'` as the admin signal, which is now a banned pattern. **The nearest real thing already works:** an admin acting on another user's behalf writes `PLUGIN_ACT_AS` at `critical`, with actor, target, route and reason (`route-identity.ts:145-157`). | **Feature does not exist; a near-equivalent is already audited** | — |
| `SETTINGS_2FA_DISABLED` | **No — there is no 2FA.** `components/v2/settings/SecurityTabV2.tsx` offers password change, data export and an erasure request; there is no enrol, challenge or factor-list code anywhere in the app. Whether Supabase Auth has MFA enabled at the project level is **unverified** (not readable from the repo), but no application code would use it. | **Feature does not exist** | — |
| `USER_TERMINATED` | **No — there is no termination path.** `POST /api/user/delete-account` is a deliberate 410 tombstone; the shared `DangerZonePanel` replaced it with a data export and a `mailto:` to a personal address marked `TEMP-ERASURE-CONTACT`. Erasure is an out-of-band human process. `USER_SUSPENDED` / `USER_REACTIVATED` are in the same position. | **Feature does not exist.** The gap is account termination, not the audit line | — |
| `DATA_DELETED` | **Effectively a duplicate of a gap, not of a working event.** `BUSINESS_DATA_PURGED` is written and covers a business reset; `events.ts:120-124` deliberately keeps the two apart so "erasure requests" does not return test resets. That distinction is correct — but `DATA_DELETED` has nothing to attach to until account erasure is built. | **Feature does not exist** | — |
| `MEMORY_ALERT_TRIGGERED` | Agent-memory sentiment alerting. Tagged `'agentspilot'` in `lib/audit/eventAudience.ts:177`. | **Out of scope** (parked product) | — |

**One extra finding, same family:** `SECURITY_RATE_LIMIT_EXCEEDED` is registered in `AUDIT_EVENTS` but has **no `EVENT_METADATA` entry**, so it falls through `getEventMetadata()` to severity `'info'`. Even if something wrote it, it could never reach the critical tile. There is also no rate-limiting module in `lib/` — consistent with the per-IP rate limit still being owed on the invite work.

---

## 2. Why the tile is not fixed by writing the events

This is the part most likely to be missed when sizing the work.

`app/api/admin/health-summary/route.ts:180` counts audit rows by `{ severity: 'critical' }`. It does not filter by action — a deliberate choice, noted in the `PAYMENT_REFUNDED` comment in `events.ts`. So the tile counts **every** event registered at `critical`, and the set that can actually fire it today is dominated by things that are not security events:

- `USER_PASSWORD_CHANGED` and `SETTINGS_SECURITY_UPDATED` are on the **browser-writable allow-list** (`lib/audit/requestSchemas.ts:168-179`). An owner changing their own password turns the "security event" tile amber.
- `DATA_EXPORTED`, `BUSINESS_DATA_PURGED`, `ARCHIVE_RUN_FAILED`, `AI_PRICING_ZERO_SET`, `AGENT_DELETED`, `REWARD_CONFIG_DELETED` and the three AgentKit runaway-cost guards are all `critical`.
- Two more were only just removed from that set — `PAYMENT_REFUNDED` (PR #157) and `PAYMENT_PLAN_CANCELLED` (PR #160).

Consequence: adding `SECURITY_UNAUTHORIZED_ACCESS` puts a real signal into a bucket where it is indistinguishable from a password change. Making the tile mean "security" needs a **new metric** in `lib/admin/health/rules.ts` filtered by action, which that file's own header classifies as **code, not data — and back to SA**. That is a real increment on top of any event-writing work, and it is the increment that delivers the operator value.

**Second instance of the same bug class, found while verifying:** `app/api/admin/users/[id]/login-stats/route.ts:51` computes a "failed logins" figure from `USER_LOGIN_FAILED` rows. `USER_LOGIN_FAILED` is not client-writable and no server sign-in route exists, so that number is structurally always 0 and the admin user detail has been showing it as a fact. This is not a one-off tile problem; it is a pattern of screens reading events nothing writes.

---

## 3. What it would buy

Audience, from `docs/requirements/ADMIN_MODULE_BOS_REORGANISATION_REQUIREMENT.md` §1: **two platform admins, both technical owners, neither support staff; job to be done is "monitor and find issues"; there are no live customers yet.**

Concretely, for the one cheap event:

- **Who looks:** either owner, on the `/admin` Health landing, which is the screen they open first.
- **When:** when the tile is not green.
- **What they would do differently:** a refused admin request has exactly two plausible causes in a two-admin, invite-only product. Either a legitimate admin's `admin_users` row is not bound to their `user_id` — a self-inflicted lockout worth fixing in minutes — or someone is probing `/api/admin/*`. Today both are invisible on the dashboard: the only record is a Pino `warn`, which on Vercel is short-retention and is not queryable from the Health route. An audit row is queryable, carries `ip_address` and `user_agent`, is retained, and is already on the admin audit-trail screen with filters.
- **What it does not buy:** compliance posture. There is no SOC 2 audit in flight and no customer asking. Writing `SECURITY_BREACH_DETECTED` would add a row type nobody can produce.

For the two detector events, the honest answer is: **nothing, until there is traffic**. Anomaly detection needs a baseline, and with no live customers there is no baseline and nothing to compare against. The classic input — repeated failed logins — **is not being recorded at all** (see §2). Building a detector now means building it against data that does not exist yet.

---

## 4. Options

| | Option | Scope | Effort | What the operator gets |
|---|---|---|---|---|
| **A** | **Rename only** (the fallback already on the table) | Retitle the tile to what it measures — a destructive admin operation or a platform malfunction — and record in the doc that no security event can currently fire it. Optionally also correct the always-0 "failed logins" label in §2. | ~10 min (+~10 min for the login-stats label) | A tile that does not lie. No new signal. |
| **B** | **Cheap subset + honest label** *(BA's recommendation if anything is done)* | Write `SECURITY_UNAUTHORIZED_ACCESS` at the two refusal points that already exist; add an action-filtered "refused access" metric and rule to `lib/admin/health/rules.ts`; rename the critical tile to match what it still mixes together. | S — one afternoon of build, plus SA review for the new metric | One genuinely new, actionable signal on the screen they already read, and a tile whose title is true. |
| **C** | **Full nine** | Option B, plus an anomaly detector, plus a breach definition, plus building impersonation, 2FA, account termination and account erasure so the other five events have call sites. | L, and mostly not audit work at all — four product features wearing an audit-event costume | Marginal. Four features nobody has asked for, and a detector with no baseline to detect against. |

**Recommendation: Option B, or Option A if the appetite is zero.** Option C should be ruled out as a unit; if impersonation, 2FA, termination or erasure are ever wanted, each should be requested on its own merits — the audit line is then a one-line footnote inside that feature, not a reason to build it.

**Also recommend, either way:** mark the five feature-does-not-exist events in `events.ts` with a one-line comment saying nothing writes them and why. That is minutes, and it stops the next reader (human or agent) concluding the capability exists — which is precisely how this tile came to be trusted.

---

## 5. Overlap with existing work

Counted carefully, because double-counting would overstate the cost and ignoring it would understate it.

| Existing work | Effect on this scope |
|---|---|
| **Admin authz unification** (`docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`) | **Both cheaper and dearer.** Cheaper: `requireAdmin` is one canonical gate with one denial branch, so 78 of 84 handlers are covered by one added line. Dearer: **6 handlers still hand-roll their own check** (slice 4 de-duplication is PARKED) and each has its own denial branch — e.g. `app/api/admin/users/[id]/login-stats/route.ts:40`. "Audit every refusal" is therefore 7 edits, not 1, or it is knowingly incomplete until slice 4 lands. |
| **Identity-hardening sweep** | **Cheaper.** `resolveActingUserIdentity` already writes a `critical`, non-blocking, request-bearing audit entry for a *granted* act-as. The refused branch is the same function, three lines up. The plumbing, the severity convention and the "never fail the request on an audit failure" pattern are all in place and proven. |
| **Audit archiving module** (live) | **Minor constraint.** Critical rows age out of the live table per retention. Any future detector reading history must respect the archive boundary, or it will read "no events" as "nothing happened". Not a cost for Option B, which is write-only. |
| **Account deletion / erasure gap** (tracked backlog: account deletion never calls erasure) | **Do not double-count.** `USER_TERMINATED` and `DATA_DELETED` are blocked behind it. Building erasure is its own requirement with its own justification; when it happens, its audit entry is a footnote inside it. Zero here. |
| **Business OS purge** (`BUSINESS_DATA_PURGED` / `_BLOCKED`, both written) | **Template, not overlap.** It is the worked example of a destructive event audited properly, including the *refused* case — which is the same shape this proposes for a refused admin request. |

---

## 6. Functional requirements, if Option B is chosen

1. A refused admin API request writes one `SECURITY_UNAUTHORIZED_ACCESS` audit entry, non-blocking, with the session user id, the route and the refusal reason class (signed-out vs not-an-admin).
2. It must never carry the caller's email, cookies, token or any request body. `requireAdminRoute.ts` already states the "userId only, never the email" rule; this must not weaken it.
3. A refused act-as (`route-identity.ts`) writes the same event, with the requested target id.
4. The event must not be browser-writable — it must not be added to `CLIENT_WRITABLE_EVENTS`.
5. The event is registered in `EVENT_METADATA` with an explicit severity, and in `eventAudience.ts`. **BA proposes `critical`** on the existing tagging (it already is), but see OQ-2 — the severity choice and the noise consequence are the same decision.
6. `lib/admin/health/rules.ts` gains an action-filtered metric for refused access, and the existing `critical_audit` tile is retitled so it no longer claims to be about security.
7. The existing Pino `warn` at each refusal point stays. The audit row is additional, not a replacement.

## 7. Acceptance criteria for Option B

- [ ] A non-admin request to any `requireAdmin`-gated route produces exactly one audit row, and still returns 403.
- [ ] An audit write failure does not turn a 403 into a 500, and does not grant access.
- [ ] No audit row produced by this work contains an email address, a token or a request body.
- [ ] A browser POST of `SECURITY_UNAUTHORIZED_ACCESS` to `/api/audit/log` is rejected.
- [ ] The Health tile's title is true for what it counts, and its rule list on screen matches its description.
- [ ] A repeated 403 from the same session does not make the tile permanently red — whatever OQ-2 decides is what ships.
- [ ] The 6 hand-rolled admin checks are either covered or explicitly listed as not covered, in the workplan. No silent partial coverage.

---

## 8. Out of scope

- Anything in the AgentsPilot product (`lib/pilot/`, `lib/orchestration/`, `lib/agentkit/`, agent generation), including `MEMORY_ALERT_TRIGGERED`.
- Building impersonation, 2FA, account suspension, account termination or account erasure.
- Any anomaly or breach detector.
- Rate limiting, and therefore `SECURITY_RATE_LIMIT_EXCEEDED`.
- Retiring or renaming any existing registry entry beyond adding explanatory comments.

## 9. Open questions

- [ ] **OQ-1 — Is Option B wanted at all, or is Option A the answer?** (raised by: BA | status: needs user decision) *Suggested resolution:* Option B, on the strength of the one real event; Option A is a legitimate outcome and no further work is implied by choosing it.
- [ ] **OQ-2 — Noise control on repeated refusals.** (raised by: BA | status: open) A scripted probe could write thousands of rows and pin the tile red. *Suggested resolution:* one row per session-user-and-route per hour, and count distinct sessions rather than rows in the tile rule. This is a design decision for SA, not a business one.
- [ ] **OQ-3 — Does an anonymous 401 deserve a row, or only an authenticated 403?** (raised by: BA | status: open) *Suggested resolution:* 403 only. A 401 on `/api/admin/*` is ordinary internet background noise and would drown the signal; a 403 means a real, identified account was refused, which is the interesting case.
- [ ] **OQ-4 — Should the always-0 "failed logins" figure on the admin user detail be fixed in the same pass?** (raised by: BA | status: open) *Suggested resolution:* relabel it in this pass (minutes); recording real login failures needs a server-side sign-in seam that does not exist, and is a separate item.
- [ ] **OQ-5 — Is the stale `ADMIN_IMPERSONATION_IMPLEMENTATION_PLAN.md` archived?** (raised by: BA | status: open) *Suggested resolution:* move to `docs/archive/`. It specifies `profiles.role`, which is a banned pattern, and a reader could take it for current design.

## 10. Notes on integration points

- `lib/audit/events.ts` — registry, `EVENT_METADATA` severity, and the comments proposed in §4.
- `lib/audit/eventAudience.ts` — already tags all four `SECURITY_*` events `'shared'`.
- `lib/audit/requestSchemas.ts` — the browser allow-list this event must stay off.
- `lib/admin/requireAdminRoute.ts` and the 6 hand-rolled admin checks — the 403 call sites.
- `lib/server/route-identity.ts` — the refused act-as call site, and the working precedent.
- `lib/admin/health/rules.ts` + `app/api/admin/health-summary/route.ts` — the tile, its metric and its title. A new metric here is code and needs SA review by that file's own rule.
- `lib/services/AuditTrailService.ts` — the non-blocking write path; `audit_trail` already stores `ip_address` and `user_agent`.
- `app/api/admin/users/[id]/login-stats/route.ts` — the second always-0 reader (OQ-4).

---

## SA Review Notes

**Reviewed by SA — 2026-09-30**
**Status:** 🔄 Approve with changes — Dev may write the workplan now, carrying every ruling below. Four factual corrections are owed to this document (C-1 to C-4); they change the shape of the work, not the decision.

### Factual corrections to this requirement (verified against `main`)

- **C-1 — `USER_LOGIN_FAILED` has two writers; §2 and OQ-4 say it has none.** `lib/client/auth-actions.ts:107` (password sign-in) and `:181` (Google ID-token sign-in) both call `auditAuthEvent({ action: 'USER_LOGIN_FAILED' })`. Both are dead by construction, for two independent reasons: `handleClientAuditWrite` returns **401 without a session** (`lib/audit/clientAuditWrite.ts:106-122`) and a failed sign-in has none; and the event is not in `CLIENT_WRITABLE_EVENTS` (`lib/audit/requestSchemas.ts:168-179`), so even with a session it is a 400. The figure is structurally 0 — the conclusion stands, the reason does not. Consequence: the relabel must also comment the two dead call sites, or the next reader "fixes" them. `lib/client/__tests__/auth-actions.googleIdToken.test.ts:59` asserts that audit **is** written, against a mocked `fetch` — green while nothing is stored.
- **C-2 — the tile's title is already honest; the lie is in its footnote.** `TITLES.critical_audit` is `'Critical audit events'` (`lib/admin/health/evaluateHealth.ts:400`), and the footnote already explains that "critical" is a severity. The false sentence is in that same footnote: *"Normal business operations such as refunds and password changes are recorded at a lower severity and are not counted here."* Refunds are `warning` (PR #157), but `USER_PASSWORD_CHANGED` is still `severity: 'critical'` (`lib/audit/events.ts:499-503`) **and** client-writable (`requestSchemas.ts:176`). So §4/§6.6's "retitle" is aimed at the wrong string: the honest-label work is **fixing that footnote sentence**.
- **C-3 — a third always-zero surface, customer-facing, not in §2.** `app/(protected)/monitoring/page.tsx` shows a "Failed Logins" card (`:787-788`) and a security recommendation gated on `failedLogins >= 3` (`:276`, `:300`), both permanently dead. The same page tells the **customer** "Excellent Security Posture" / "N critical security events detected. Immediate review recommended." from severity alone (`:280-296`) — so a customer who changes their own password is told a critical security event needs immediate review. A live, reproducible false alarm.
- **C-4 — parts of §6 are already done.** §6.5's `EVENT_METADATA` registration exists at `critical` (`events.ts:747-751`); `eventAudience.ts:219` already tags the event `'shared'`; §6.4 is already true (it is not on the allow-list). The only registry work left is the §4 comments.

### Rulings on the open questions

- **OQ-2 — REJECTED as proposed. No de-duplication, no distinct-session counting.** `session_id` is unusable: `AuditTrailService` fills it from `sb-access-token` / `sb-refresh-token` / `session_id` cookies or the first 32 characters of the `authorization` header (`lib/services/AuditTrailService.ts:207-215`). This project sets **chunked** Supabase cookies (`sb-<ref>-auth-token.0/.1`, see the comment in `lib/server/route-identity.ts`), so none of those names match a browser request to `/api/admin/*` and there is no `Authorization` header — `session_id` will be NULL. When it *is* populated it holds a live bearer or refresh token (open item OI-B, cited at `clientAuditWrite.ts:17`), so **do not pass `request` into the new write**: it would copy a valid authenticated user's session credential into `audit_trail` for a brand-new event class. Per-refusal de-duplication would also need a read-before-write on the fail-closed path (in-process memory does not survive a serverless instance), which is worse than the noise it prevents. The real noise control is OQ-3 (403-only means a write requires a valid session) plus the rule's threshold — and a threshold change is a **data** edit under that file's own rule, needing no SA re-review. Ship amber at >= 1.
- **OQ-3 — CONFIRMED, 403 only, with two mandatory refinements.** (a) `requireAdmin`'s fail-closed design routes `AdminAccessService.isAdmin` **throwing** into the same `!isAdmin` 403 branch (`lib/admin/requireAdminRoute.ts:79-87`). Auditing that branch unconditionally means a Supabase outage emits `SECURITY_UNAUTHORIZED_ACCESS` for every legitimate admin request and paints the new tile red during an outage — audit only when the check answered "no"; the throw path keeps its `logger.error` and writes nothing. Same shape at `lib/admin/requireAdminPage.ts:72-80`. (b) Always pass the refused user's id explicitly: `buildLogEntry` falls back to `SYSTEM_ADMIN_USER_ID` when `userId` is null (`AuditTrailService.ts:145-148`), so a null-user row would be attributed to the system admin account.
- **OQ-4 — IN SCOPE for the admin surface only, on the corrected reasoning (C-1).** Relabel `app/api/admin/users/[id]/login-stats/route.ts:63` and its two renderings (`app/admin/users/page.tsx:743-746`, `:929-931`), and comment the two dead writers. **Do not** allow-list `USER_LOGIN_FAILED` as a shortcut: its payload carries `resourceName: email` and `details.email` from an unauthenticated caller, which would create an anonymous attacker-controlled write channel into the compliance log and an account-enumeration surface. Real recording needs a server-side sign-in seam — separate item, as proposed. The customer-facing surfaces in C-3 are **out of this slice** but must be named with file and line in §8 and raised to the user as their own quick fix; a false security claim in front of a customer outranks one in front of two owners. If they are pulled in, CLAUDE.md § Logging applies first: that page has 6 `console.*` calls.
- **OQ-5 — rides along, as its own commit.** Verified stale: `docs/admin/ADMIN_IMPERSONATION_IMPLEMENTATION_PLAN.md` names `profiles.role = 'admin'` at lines 14, 41, 318 and 749. Move to `docs/archive/`, add a one-line header saying it was never built and is superseded by `admin_users` / `requireAdmin`, and leave a pointer from `ADMIN_IDENTIFICATION_AND_ACCESS.md`.

### Ruling on the parked-slice-4 tension

Partial coverage **is** acceptable, and it is **not** 7 edits. Measured: 85 `await requireAdmin(` call sites in 55 route files, plus the 6 hand-rolled handlers enumerated in `lib/admin/__tests__/admin-authz-surface.guard.test.ts:278-287` (`admin/agents#GET`, `business-os/llm-usage#GET`, `business-os/llm-usage/businesses#GET`, `chat-usage#GET`, `users/[id]/audit-logs#GET`, `users/[id]/login-stats#GET`).

- Instrument the canonical gate and the refused act-as only. Adding the write inline six times is precisely the duplication slice 4 exists to delete, and five of the six are cross-tenant admin **reads**.
- Bound the incompleteness **on screen**, not only in the workplan: the tile footnote must say that six handlers check admin access themselves and are not counted. That is what stops an operator reading green as "nobody probed".
- **Add `requireAdminPage` to the slice** (`lib/admin/requireAdminPage.ts:82-90`, 12 pages). It is the more likely home of §3's lockout story — an admin whose `admin_users` row is unbound opens `/admin`, is redirected, and makes no API call, so a route-only version leaves the tile green in exactly the scenario §3 sells. Mechanically easy: `redirect()` is deliberately outside any try/catch, so `await` the bounded flush immediately before it.
- If `login-stats` is edited for the relabel: it is one of the six (guard allow-list at `:285` and `:300`) **and** it calls `createClient(... SERVICE_ROLE ...)` directly at lines 8-11 — a CLAUDE.md rule-1 violation and a deprecated pattern. A label-only edit must not extend it. Converting it to `requireAdmin` + a repository is slice-4 work and must drop `CAPS.R1.parked` and `CAPS.R2.parked` from 6 to 5 **in the same commit** (equality-asserted; the guard is a required check on `main`). Decide deliberately, do not drift into it.

### Rulings on the two smaller findings

- **`SECURITY_RATE_LIMIT_EXCEEDED` — confirmed, and it is worse than merely unwritten.** Registered at `events.ts:328` with no `EVENT_METADATA` entry, so `getEventMetadata()` gives it severity `'info'` and "Unknown event" — the same trap that swallowed refunds (see the comment at `events.ts:1035`). Leave it unwritten, but **add its metadata entry now** (three lines, no writer, zero behaviour change) so the trap is disarmed before the per-IP rate limit owed on the invite work lands. Approved as in-scope.
- **`PLUGIN_ACT_AS` — confirmed, and it changes the second call site's payload.** Keep the refused-act-as write, but set `userId` = the **refused session user**, `actorId` = the same, and carry the requested target in `details.requestedUserId`. Do **not** copy the granted write's `userId: targetUserId` (`route-identity.ts:145-157`): a refusal has no legitimate subject but the refuser, and the event is tagged `'shared'`, so attributing it to the target would surface "Unauthorized access attempt" inside an innocent account's own audit view. Also do not copy its `details.adminEmail` — §6.2's "userId only, never the email" is the rule and it conflicts with that precedent.

### The change this requirement is missing entirely — durability

`AuditTrailService.log()` only **queues** (`AuditTrailService.ts:112-127`; `batchSize: 100`, `batchIntervalMs: 5000`). A refused request returns 403 immediately and does nothing else, so the serverless instance freezes long before the 5-second timer fires and the row is lost. This is not hypothetical: it is the production loss already hit on logout (`clientAuditWrite.ts:37-44`, "production showed exactly that on 2026-09-19"), which is why `logAndFlushOnLogout` exists with a 2-second bounded flush.

**Ruling:** the refusal write must `await` a bounded flush before responding. Extract `logAndFlushOnLogout` from `clientAuditWrite.ts` into a shared `lib/audit/` helper (an extraction of an existing pattern, not a new one) and call it from both gates. Bounded (<= 2 s), never throws, never turns a 403 into a 500 or a hang; access is already denied before it runs, so a flush failure can grant nothing. Without this, §7's "produces exactly one audit row" is untestable and the slice delivers nothing.

### Ruling on the metric's shape — a new tile, not a new metric on `critical_audit`

Adding `refusedAccess24h` to `critical_audit` leaves the mixed bucket intact and re-creates the disease being fixed; one title cannot be true for both meanings. A separate tile is cheap here:

- `app/admin/components/health/HealthGrid.tsx:97-98` maps the API array into a responsive grid — an eighth tile needs no layout work.
- `auditCount` in `app/api/admin/health-summary/route.ts:154-160` already accepts `{ action }` (the failures tile uses it) and runs in the same `Promise.all` under its own per-read deadline, so the read is isolated and degrades to `unavailable`.
- `auditLink` (`evaluateHealth.ts:377`) already takes `action`, so the figure links straight to a filtered `/admin/audit-trail`.

Edits to budget: `healthTypes.ts:25-32`; `rules.ts` (new metric type, `METRIC_LABELS`, `HealthRuleSet`, `TILE_VOCABULARY`, `HEALTH_RULES`); `evaluateHealth.ts` (`TITLES:400`, `GREEN_ELIGIBLE:99`, a measurement function, the return array, `HealthInputs`); `health-summary/route.ts` (two counts plus a `HealthRead`); and the literal tile lists in `rules.config.test.ts:17-28`, `evaluateHealth.test.ts:312`/`:450`, `qa-slice5.test.ts:47`/`:98`, `health-summary/__tests__/route.test.ts:175-177`, `app/admin/__tests__/health.qa-slice5.render.test.tsx:73`. Put the tile in `GREEN_ELIGIBLE` **only** with the six-uncounted-handlers footnote, or green overclaims.

### Acceptance criteria — changes required

1. "produces exactly one audit row" → add "**and survives a handler that returns immediately**" (the bounded flush).
2. Add: a refusal caused by the admin check **throwing** produces **no** audit row.
3. Add: the row's `user_id` is the refused caller — never `SYSTEM_ADMIN_USER_ID`, never the act-as target.
4. Add: the row's `session_id` is `null` — no session credential is stored (pin it; the obvious implementation passes `request`).
5. Restate the title criterion against the **footnote** (C-2), and add that the footnote names the six handlers that are not counted.
6. Keep the six-handlers criterion, and widen the record to: the workplan, the tile footnote, and `ADMIN_IDENTIFICATION_AND_ACCESS.md` § What is NOT true.
7. State plainly that **no CI job runs Jest**, so all of the above are QA/local gates, not merge gates. The only required check this work can trip is `Admin authz surface guard`.

### Notes for whoever writes the workplan

- Do not introduce a new import from `lib/business-os/entitlements/`. `health-summary/route.ts:46` already imports `entitlements/mode` and is registered in `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts`; a new one must be registered in the same diff.
- `requireAdmin`'s signature must stay backward compatible — 85 call sites. Read IP and user agent through `next/headers` inside the gate (it is already in a dynamic-request context via `getUser()`), or record neither and correct §3's claim about `ip_address`. Do not add a required second parameter.
- Confirm an index on `audit_trail (action, created_at)` in prod, or accept the new tile going `unavailable` under load. The existing failures tile already depends on the same shape.
- **Do not bundle** the question of whether `USER_PASSWORD_CHANGED` / `SETTINGS_SECURITY_UPDATED` should drop to `warning` like refunds did. It would shrink the mixed bucket materially, but it changes what existing rows mean — that is a decision for the user, raised separately. Worth telling them alongside it: because `USER_PASSWORD_CHANGED` is both `critical` and client-writable, any signed-in customer can put rows in the admin critical tile at will.

### Approval

- [x] Workplan may be written, carrying every ruling above
- [ ] C-1 to C-4 patched into this requirement by BA (or noted as accepted in the workplan)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-09-30 | Created | BA scoping of the nine unwritten security audit events, for a go/no-go decision. Per-event verdicts verified against `main`. |
| 2026-09-30 | SA review | Approve with changes. Rulings on OQ-2 to OQ-5, the parked-slice-4 tension and both smaller findings; four factual corrections (C-1 to C-4); durability and tile-shape rulings added. |
