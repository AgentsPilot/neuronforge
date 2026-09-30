# Workplan: Audit severity — normal business operations are not "critical"

> **Last Updated**: 2026-09-30

**Developer:** Dev
**Requirement:** none (fix cycle; user report relayed by TL — no BA requirement MD)
**Branch:** `fix/audit-severity-normal-operations` (cut from `main` at `f75e491d`)
**Date:** 2026-09-30
**Status:** Code Complete — awaiting SA review

## Overview

A business owner refunding one of their own clients was recorded as a `critical`
audit event, which made the admin health dashboard's "Critical events in 24 h"
tile go amber ("needs attention"). This workplan downgrades the refund, and
reports a sweep of every other event that can be stored `critical` so SA can
decide the rest.

---

## Analysis Summary

**The chain that produces the false positive**

| Step | Where |
|---|---|
| The refund route passes `severity: 'critical'` explicitly, twice | `app/api/payments/refunds/route.ts:270` (scope `all`) and `:386` (single) |
| `PAYMENT_REFUNDED` is also registered `severity: 'critical'` | `lib/audit/events.ts:1036-1040` |
| `AuditTrailService` prefers what the writer passes | `lib/services/AuditTrailService.ts:173` — `severity: input.severity \|\| metadata.severity` |
| The health route counts **every** `critical` row in 24 h / 7 d, action-blind | `app/api/admin/health-summary/route.ts:180-181` |
| One row is enough to turn the tile amber | `lib/admin/health/rules.ts:250-258` — `critical.any24h`, `atLeast critical24h 1` |
| The tile label reads as "needs attention" | `lib/admin/health/rules.ts:77` |

Because line 173 prefers the caller's value, editing `EVENT_METADATA` alone
fixes nothing — both call sites decide.

**Severity does two jobs.** It is a compliance/record classification *and* the
operational alert trigger. That conflation is the root cause; relabelling one
event treats the symptom for that event only. See "Recommendation to SA" below.

---

## Implementation Approach

1. **`PAYMENT_REFUNDED` becomes `warning`, not `info`.** A refund is money
   leaving the business, human-initiated and effectively irreversible — notable
   to anyone scanning the trail, but not an error and not a platform concern.
   `warning` also makes it agree with its own neighbours, which were already
   classified that way: `PAYMENT_BLOCK_EXECUTED` (`warning`),
   `INVOICE_MARKED_PAID` (`warning`), `PAYMENT_INVOICE_VOIDED` (`warning`).
   `info` would put a refund on the same footing as a routine read.

2. **The call sites stop passing a severity at all.** Rather than write
   `'warning'` in three places that can drift apart (which is exactly how this
   bug survived), the registration in `lib/audit/events.ts` becomes the single
   source of truth and the route passes nothing. The SOC2 flag already came
   from the registration (neither call site passed `complianceFlags`), so it is
   unchanged.

3. **A guard test pins both halves** — the registered severity/flags, and the
   source-level fact that the refund route passes no explicit severity — so a
   future edit cannot silently re-raise it.

4. **The critical tile's footnote is corrected.** It currently claims the count
   "includes routine events such as password changes and refunds"
   (`lib/admin/health/evaluateHealth.ts:686-687`). After this change refunds are
   not counted, and password changes never were (they are stored `warning` — see
   sweep). Leaving the sentence would make the tile lie about its own figure.
   This is display text, not counting logic.

**Not done:** the health-summary counting logic is untouched.

---

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `lib/audit/events.ts` | modify | `PAYMENT_REFUNDED` severity `critical` → `warning`, with the reason in a comment |
| `app/api/payments/refunds/route.ts` | modify | Drop the explicit `severity: 'critical'` at both audit writes |
| `lib/admin/health/evaluateHealth.ts` | modify | Correct the critical tile's footnote (display text only) |
| `lib/audit/__tests__/paymentRefundSeverity.guard.test.ts` | create | Pin the registration and the absence of an explicit severity at the call sites |

---

## Task List

- [x] Step 1: Trace the chain and confirm `input.severity || metadata.severity` is what decides
- [x] Step 2: Sweep axis A — every event registered `critical` in `lib/audit/events.ts` (27 found)
- [x] Step 3: Sweep axis B — every audit call site passing `critical`/`warning` explicitly in `app/` and `lib/`
- [x] Step 4: Cross-reference the two axes, since either can decide the stored value
- [x] Step 5: Check whether `severity` drives retention, archiving, alerting or a filter default
- [x] Step 6: Downgrade `PAYMENT_REFUNDED` in `EVENT_METADATA`
- [x] Step 7: Remove the explicit severity at both refund call sites
- [x] Step 8: Correct the critical tile footnote
- [x] Step 9: Add the guard test
- [x] Step 10: Run the affected suites and `npm run build`

---

## Sweep results

Method: a script parsed `EVENT_METADATA` entry by entry, then scanned every
non-test `.ts`/`.tsx` under `app/`, `lib/`, `components/`, `hooks/` for audit
write objects (`action:` + optional `severity:`), and cross-referenced the two.
Every row below was then verified by reading the call site, because a windowed
scan can attribute a neighbouring object's severity to the wrong event (it did
so once, for `MEMORY_SUMMARIZATION_FAILED`).

**27 events are registered `critical`.** Of those, only 13 are actually stored
`critical`; 5 are overridden lower at their only call site, and 9 are never
written at all. A further 4 events are stored `critical` from a call site
although their registration says otherwise or does not exist.

### A. Stored `critical` — no change recommended (11)

| Event | Class |
|---|---|
| `AGENTKIT_LOOP_DETECTED` | platform malfunction / cost runaway |
| `AGENTKIT_ITERATION_TOKEN_LIMIT_EXCEEDED` | platform malfunction / cost runaway |
| `AGENTKIT_CIRCUIT_BREAKER_TRIGGERED` | platform malfunction / cost runaway |
| `TOKEN_DISCREPANCY_DETECTED` (unregistered) | platform malfunction (billing integrity) |
| `ARCHIVE_RUN_FAILED` | platform malfunction, needs an admin to Continue |
| `PLUGIN_ACT_AS` | admin acting as a user |
| `AI_PRICING_DELETED` | destructive, revenue effect |
| `AI_PRICING_ZERO_SET` | destructive, revenue effect |
| `REWARD_CONFIG_DELETED` | destructive, admin |
| `DATA_ANONYMIZED` | destructive, irreversible (GDPR erasure) |
| `BUSINESS_DATA_PURGED` | destructive, irreversible |

### B. Stored `critical` — recommended change (5, refund included)

| Event | Where it is written | Now | Recommend | Why |
|---|---|---|---|---|
| `PAYMENT_REFUNDED` | `app/api/payments/refunds/route.ts:270,386` + registration | critical | **warning** — done in this change | Normal business operation by the owner on their own client |
| `PAYMENT_PLAN_CANCELLED` (unregistered) | `app/api/payments/plans/[id]/cancel/route.ts:113` | critical | **warning** + register it | Same class, and the code comment says it was matched to the refund on purpose ("audited at the same level as money moving") — leaving it makes the two disagree |
| `PILOT_EXECUTION_FAILED` | `lib/pilot/WorkflowPilot.ts:1132, 3343` | critical | **warning** | The registration already says `warning`; the call sites override it. A workflow failing is a routine user-visible outcome, and it is written **once per failed run** — the highest-volume critical writer in the codebase |
| `ORCHESTRATION_STEP_FAILED` (unregistered) | `lib/orchestration/WorkflowOrchestrator.ts:417` | critical | **warning** + register it | The inline comment says why it is critical: *"Changed from 'error' to 'critical' (valid constraint value)"* — it was picked because `'error'` fails the table's CHECK, not because it means critical. `warning` is what it meant |
| `AGENT_GENERATION_FAILED` | `app/api/generate-agent-v4/route.ts:284` | critical | **warning** | The registration says `warning`, and the v2/v3 routes pass `'error'` (which the severity CHECK rejects — those rows are dropped, a separate pre-existing bug). One route out of four disagreeing is drift, not intent |

`MEMORY_SUMMARIZATION_FAILED` (`lib/memory/MemorySummarizer.ts:282`, registration
also `critical`) is a judgement call I would leave to SA: one LLM summarisation
failing is a transient platform malfunction, so `critical` is defensible, but it
is written per execution and swallowed (`don't throw`), so it will raise the tile
routinely. My weak preference is `warning`.

`SETTINGS_SECURITY_UPDATED` (`components/settings/SecurityTab.tsx:113`) stays
`critical`: it is a security-settings change, which is the category the tile is
for. Note it is **pinned** at `critical` by
`lib/audit/__tests__/stepZeroRegistrations.test.ts`.

### C. Registered `critical`, stored lower — latent disagreement, no live effect (5)

These are **not** firing the tile today, because the only call site overrides the
registration. They are the same trap as the refund, pointing the other way: the
next caller written without an explicit severity will silently be `critical`.

| Event | Registration | Stored | Recommend |
|---|---|---|---|
| `AGENT_DELETED` | critical | `warning` — `app/api/agents/[id]/route.ts:545` | Align registration → `warning`. TL's candidate; it is already an ordinary user operation in practice |
| `DATA_EXPORTED` | critical | `info` — `app/api/user/data-export/route.ts:199` | Align registration → `warning`. TL's other candidate. Compare `USER_DATA_EXPORTED` (the same act from the V2 settings tab) which is registered `warning`: the same user action is classified three different ways today |
| `SETTINGS_API_KEY_CREATED` | critical | `warning` — `app/api/user/api-keys/route.ts:191` | Align registration → `warning` |
| `USER_PASSWORD_CHANGED` | critical | `warning` — `app/api/user/change-password/route.ts:202` | **Leave.** Pinned at `critical` by `stepZeroRegistrations.test.ts` because the browser caller (`SecurityTab`) now takes its severity from the registration — changing it changes what that surface stores. Needs SA to decide the two callers' disagreement separately |
| `USER_EMAIL_CHANGED` | critical | `warning` — `app/api/user/change-email/route.ts:188` | Align registration → `warning`, unless SA wants the pair with `USER_PASSWORD_CHANGED` kept |

### D. Registered `critical`, never written (9) — dead registrations

`ADMIN_IMPERSONATION_STARTED`, `ADMIN_IMPERSONATION_ENDED`, `DATA_DELETED`,
`MEMORY_ALERT_TRIGGERED`, `SECURITY_ANOMALY_DETECTED`, `SECURITY_BREACH_DETECTED`,
`SECURITY_UNAUTHORIZED_ACCESS`, `SETTINGS_2FA_DISABLED`, `USER_TERMINATED`.

No writer exists anywhere in `app/`, `lib/` or `components/`. They cannot
produce a false positive, and they should keep `critical` — but they are worth
recording, because they are the events the tile's design assumes it is counting
and none of them can occur.

---

## Recommendation to SA (the structural fix)

Relabelling events one at a time keeps `severity` overloaded, and the tile will
drift again the moment someone adds a `critical` event that is not an operational
alert. I recommend, as a **separate** slice, not in this change:

Add an explicit alert classification to `EventMetadata` — e.g.
`operationalAlert: true` — and have the health tile count rows whose *action* is
in the alerting set rather than rows whose *severity* is `critical`. That
separates the compliance/record job from the alert job, leaves every stored
severity alone, needs no migration, and makes "what lights up the dashboard" a
reviewed list of ~11 event names instead of a side effect of a severity label.
It also fixes the count for historical rows immediately, rather than waiting for
the windows to roll.

If SA prefers to stay with severity alone, the B and C tables above are the
proposal to accept or amend.

---

## Answers to the three checks

1. **Does `severity` drive anything besides the tile and display?** No.
   - Retention/archiving is date-based only: `lib/archiving/config.ts` has
     `RETENTION_DAYS_OPTIONS` per source and no severity field; no SQL in
     `supabase/migrations/` mentions `severity` in any `audit_trail` predicate
     (the only `severity` columns in migrations belong to `insights`,
     `execution_optimization` and `platform_learning` tables).
   - No `compliance_flags`-driven or severity-driven retention exists.
   - It is a filter *value* in `AuditTrailRepository` (`.eq('severity', …)`), a
     CSV column, and a badge colour.
2. **Existing rows.** Confirmed: this changes future writes only. `audit_trail`
   rows keep their stored `severity`, and no backfill is performed. The tile will
   keep counting refunds already written until they fall out of the 24 h window
   (then the 7 d figure). That is acceptable — both windows are rolling and
   self-clear, and rewriting stored audit rows to make a dashboard look right is
   the wrong trade on a compliance surface.
3. **Other consumers of `critical`.** Two, not one.
   - `app/api/admin/health-summary/route.ts:180-181` → the tile (the reported one).
   - **`app/(protected)/monitoring/page.tsx`** — a *user-facing* page that reads
     `/api/audit/query` for the signed-in account and renders
     "**Critical Events Require Attention** — N critical security event(s)
     detected. Immediate review recommended." (line ~290) whenever
     `stats.critical > 0`. So an owner refunding a client was being told by their
     own page that a critical security event needed review. Same bug, worse
     audience. It is a linked, ungated sidebar item — labelled "Audit Trail" —
     in `app/(protected)/layout.tsx:626-632`. Caveat: that is the AgentsPilot
     shell (the parked product), so a Business OS-only owner may not reach it
     today; `/v2/monitoring` is still a placeholder.
   - Note: that page also suppresses its green "Excellent Security Posture"
     banner when any `warning` exists (`hasWarnings`), so a refund at `warning`
     will still hide that banner. It will no longer raise the red one.
   - No digest, email, cron or alert keys off severity. The admin audit page's
     severity filter defaults to `all`, so nothing is hidden or surfaced by
     default.

---

## Other things found in the code, not fixed here

- `app/api/generate-agent-v2/route.ts:771`, `route copy.ts:418`,
  `app/api/generate-agent-v3/route.ts:146,177` pass `severity: 'error'`, which is
  not in `AuditSeverity` (`'info' | 'warning' | 'critical'`) and fails the
  table's CHECK — those audit rows are lost. Same class of bug as the one the
  `USER_DATA_EXPORTED` comment in `events.ts` already records for `'medium'`.
  It type-checks only because the helper's parameter is loosely typed at those
  call sites. Worth its own fix.
- `app/api/generate-agent-v2/route copy.ts` is a stray file ("route copy.ts")
  under `app/api/`, still containing audit writes.
- `console.*` in files I read but did **not** modify, so left alone per
  CLAUDE.md § Logging (flag → propose → convert): `app/(protected)/monitoring/page.tsx`
  (~4 incl. a `console.log` of a computed breakdown on every render),
  `app/api/agents/[id]/route.ts`, `app/api/user/api-keys/route.ts`,
  `app/api/user/change-email/route.ts`, `app/api/user/data-export/route.ts`,
  `lib/memory/MemorySummarizer.ts`, `lib/orchestration/WorkflowOrchestrator.ts`.
  Happy to convert any of these on request.
- The line numbers in the task brief (`refunds/route.ts:219`/`:312`,
  `events.ts:1011`) are from a `.claude/worktrees/` copy, not the primary tree.
  The live lines are `:270`/`:386` and `:1036`.

---

## SA Review Notes

**Code Review by SA — 2026-09-30**
**Status:** ✅ Code Approved (with required workplan corrections C-1..C-4 — documentation only, no code change)
**Verified against the working tree, not the brief.** SA made no code changes.

### What I re-verified independently

| Claim | Verdict |
|---|---|
| `buildLogEntry` prefers the caller: `severity: input.severity \|\| metadata.severity` | ✅ `lib/services/AuditTrailService.ts:173` |
| SOC2 flag is unaffected by dropping the caller's severity | ✅ line 174 is `input.complianceFlags \|\| metadata.complianceFlags \|\| []`, and `grep complianceFlags app/api/payments/refunds/route.ts` returns nothing. Registration keeps `['SOC2']` |
| Only two writers of `PAYMENT_REFUNDED` exist, both in the guarded file | ✅ `refunds/route.ts:270,396` and nowhere else in `app/`, `lib/`, `components/` |
| The tile counts severity action-blind, one row flips it | ✅ `health-summary/route.ts:180-181`; `rules.ts:250-258` `atLeast critical24h 1` |
| Second consumer, owner-facing | ✅ `app/(protected)/monitoring/page.tsx:290-292` red banner on `stats.critical > 0`; `:282` green banner suppressed by `stats.warning > 0`; `:1035-1039` a "security score" drops 100→75 on any warning. Linked as "Audit Trail" at `layout.tsx:626`. `app/v2/monitoring/page.tsx` is a literal placeholder |
| 9 registered-`critical` events have no writer | ✅ all nine return 0 references outside `events.ts` / `eventAudience.ts` / tests |
| Registered-`critical` count | ✅ 26 after the change (27 before) out of 137 registrations |
| Severity drives nothing else | ✅ no `severity` predicate on `audit_trail` in `supabase/migrations/`; archiving is date-based |
| Dev's test claim | ✅ spot-checked: `lib/audit` + `lib/admin/health` = 11 suites / 322 tests green; `lib/payments` + `app/api/payments` + `lib/services` = 52 suites / 763 tests green |
| Scoped typecheck | ✅ 0 diagnostics for all four in-scope files (scoped `tsconfig`, removed afterwards). Note the full-project `tsc` **OOM-crashes**, so "0 in scope" is the only honest claim available |
| Lint | ✅ 1 warning, `lib/audit/events.ts:1129` unused `_` — pre-existing, outside the diff hunk |

### Code review comments

1. `lib/admin/health/evaluateHealth.ts:686-688` — the new footnote's claim about password changes is **true today, and fragile for exactly the reason this change exists**. `USER_PASSWORD_CHANGED` is registered `critical`; it reads `warning` only because its single writer (`app/api/user/change-password/route.ts:202`) overrides it — the very pattern this change just argued against and removed from the refund route. Suggest asserting only what the registration guarantees, e.g. *"Normal business operations such as refunds are recorded at a lower severity and are not counted here."* — Priority: Medium (wording, not a defect).
2. `app/api/payments/refunds/route.ts:264-267` — the first comment forward-references "see the single-payment path below". Fine, but a reader hitting the group path first has to go hunting. Consider naming the file and line, or making this block the short one. — Priority: Low.
3. `lib/audit/__tests__/paymentRefundSeverity.guard.test.ts:71` — `expect(code).not.toMatch(/severity\s*:/)` is file-scoped, so it cannot see a *new* writer of `PAYMENT_REFUNDED` added in another file. Today there is none, so the guard is adequate; a repo-wide scan asserting "exactly two `PAYMENT_REFUNDED` writers, none passing a severity" would close it permanently. — Priority: Low (optimisation).
4. `app/api/payments/refunds/route.ts` uses `supabaseServer` directly at `:469,566,622,735,745,834` — pre-existing, outside the diff, and this change adds no DB access, so CLAUDE.md rule 1 is not newly violated. Recorded so it is not mistaken for accepted convention. — Priority: Low (pre-existing).
5. **Commit hygiene for RM:** `.claude/settings.local.json` (per-machine permission churn) is modified in this branch and must **not** ride along. Neither should the four untracked docs belonging to other work (`docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md`, `docs/requirements/BUSINESS_OS_CREDITS_BOOST_*.md`, `docs/workplans/environment-readiness-staging.md`). The `.gitignore` line for `.claude/launch.json` is harmless but unrelated — RM's call. — Priority: Medium.

### Required workplan corrections (documentation, not code)

- **C-1 — the `'error'` bug does *not* type-check.** The "Other things found" section says it "type-checks only because the helper's parameter is loosely typed at those call sites." It is a hard error: `AuditLogInput.severity?: AuditSeverity` (`lib/audit/types.ts:163`), and a scoped `tsc` reports `app/api/generate-agent-v3/route.ts(156,9)` and `(188,9)`: **`error TS2322: Type '"error"' is not assignable to type 'AuditSeverity | undefined'`**. It survives because `next.config.js` sets `typescript.ignoreBuildErrors: true` and no CI job typechecks `app/api/generate-agent-*`. This matters: the type system already names the bug, so prevention is a typecheck gate, not a new guard. It also means `npm run build` passing proves nothing about types anywhere in this repo.
- **C-2 — the stated reason to leave `USER_PASSWORD_CHANGED` alone is stale.** Table C says the pin exists "because the browser caller (`SecurityTab`) now takes its severity from the registration." On the current tree **the browser does not write that event at all**: both tabs call `changePassword()` (`lib/client/change-password.ts`), which POSTs `/api/user/change-password`, and the server route writes it at `warning`. The stale attribution is in two places — `lib/audit/requestSchemas.ts:176` (`// SecurityTab (V1, V2)`) and `stepZeroRegistrations.test.ts:23` (`'SecurityTab, SecurityTabV2'`). The pin's real meaning is "what the caller stored before step 0", i.e. historical continuity, not a live surface. **The decision to leave it alone stands** (out of scope, and the Step-0 pin deserves its own decision) — only the reason needs correcting.
- **C-3 — `PAYMENT_INVOICE_VOIDED` is not registered.** The Implementation Approach cites it as a money neighbour "already classified" `warning`. It is stored `warning` by its call site (`lib/payments/invoiceLifecycle.ts:141`) but has **no entry in `EVENT_METADATA`**, so it records with the description **"Unknown event"**. The comparison still holds substantively; the shipped comment in `events.ts` correctly names only the two registered neighbours, so no code change is needed. Add it to the unregistered list below.
- **C-4 — the unregistered set is four, not three.** `PAYMENT_PLAN_CANCELLED`, `ORCHESTRATION_STEP_FAILED`, `TOKEN_DISCREPANCY_DETECTED` **and `PAYMENT_INVOICE_VOIDED`** all have no registration, so every row they write carries `description: "Unknown event"` — a record-quality defect on money and billing-integrity events that is independent of severity. The sweep missed the fourth because it filtered on `critical`.

---

### Rulings

#### The implemented refund change — APPROVED, including the part Dev was not briefed to do

- **`warning`, not `info`** — agreed, and for the reason given: a refund is irreversible money movement, which outranks a routine read, and `warning` is where its money neighbours sit.
- **Dropping the explicit severity at both call sites — this is the correct call and the most valuable part of the change.** Verified it can change nothing else: `severity` was the only resolved field either site passed, `complianceFlags` was never passed, and the registration supplies both. The bug existed because the same fact was written in three places with no single owner; one owner plus a guard is the fix. Keep it.
- **The footnote rewrite is in scope and right.** A dashboard whose footnote documents its own false positive instead of fixing it is worse than an unlabelled one. Only the password-change half of the new sentence needs softening (comment 1).
- **The guard test is well built** — pinning the registration *and* the source-level absence of an override is the pair that matters, and stripping comments first so the explanation cannot satisfy the assertion is exactly right.

#### The four proposed changes

| # | Event | Ruling |
|---|---|---|
| 1 | `PAYMENT_PLAN_CANCELLED` | **APPROVED — `warning` + register it.** Decisive: the call site comment at `plans/[id]/cancel/route.ts:106-107` says it was matched to the refund on purpose ("audited at the same level as money moving"). Downgrading the refund and not this one silently breaks a stated intent — worse than leaving both. Registering it also fixes its "Unknown event" description. Follow the same shape: registration owns the severity, call site passes nothing. |
| 2 | `PILOT_EXECUTION_FAILED` | **APPROVED — `warning`.** The registration already says `warning` (`events.ts:941`); two call sites override (`WorkflowPilot.ts:1132,3343`). A failed workflow run is a routine user-visible outcome, and at one row per failure it is the highest-volume `critical` writer in the repo. Remove the overrides rather than editing the registration — the registration is already correct. |
| 3 | `ORCHESTRATION_STEP_FAILED` | **APPROVED — `warning` + register it.** The comment at `WorkflowOrchestrator.ts:417` is self-incriminating: *"✅ Changed from 'error' to 'critical' (valid constraint value)"*. `critical` was picked because `'error'` was rejected, not because the event is critical — the same bug family as C-1, patched by picking the wrong end of the enum. **Additionally: that write is `await`ed and not `.catch()`-ed** (`:408`), which violates CLAUDE.md § Audit Trail (audit is always non-blocking) and means an audit failure can replace the real step error. Fix that in the same edit. |
| 4 | `AGENT_GENERATION_FAILED` | **APPROVED — `warning`.** Registration says `warning` (`events.ts:410`); one of four routes disagrees (`generate-agent-v4/route.ts:284`). Remove the override. Note the other three routes are the `'error'` bug, so "four routes" is really "one writes `critical`, three write nothing at all". |

**Scope ruling:** all four go in **one follow-up slice together with the structural fix below**, not into this branch. This branch's value is that it is a single, fully-guarded, obviously-correct change to the reported defect; four more relabellings across the pilot and orchestrator would put it in front of a different reviewer's risk appetite. Do them next, immediately.

#### `MEMORY_SUMMARIZATION_FAILED` — **`warning`.**

Ruling: downgrade. `lib/memory/MemorySummarizer.ts:282` writes it once per execution inside a `catch` that deliberately swallows (*"don't throw — summarization failures should not break execution"*). An event the platform has decided is safe to ignore cannot simultaneously be the platform's definition of "immediate review recommended"; and because it is per-execution it will hold the tile amber continuously, which trains an operator to ignore the tile. Both the registration (`events.ts:805`) and the call site say `critical`, so both change; registration owns it, call site passes nothing. If the concern is losing visibility of a systemic summarisation outage, that is a rate question — a failure-count tile — not a severity label.

#### The green-banner residual — **ACCEPTABLE. Do not fix it here.**

Post-fix the reported harm is gone: no red *"Critical Events Require Attention — immediate review recommended"* for a refund. The green "Excellent Security Posture" banner requires `stats.critical === 0 && stats.warning === 0`, so on any real account it was already unreachable — `PILOT_EXECUTION_FAILED`, `AGENT_DELETED`, `INVOICE_MARKED_PAID`, `PAYMENT_BLOCK_EXECUTED` and password changes are all `warning`. A refund is not what breaks that banner and suppressing refunds would not restore it. Same for the 75%/"Good" security score at `:1035-1039`.

That page needs its own decision, not a patch inside a severity change: it is on the parked AgentsPilot shell, computes `stats` over the *filtered* log set (so the red banner has no time bound at all, unlike the tile's 24 h), and contains 6 `console.*` calls including a `console.log` of a recomputed breakdown on **every render**. Record as a follow-up: either drive both banners off the alert set from the structural fix, or retire the page in favour of a V2 surface. Explicitly **not** a reason to block.

#### Structural question 1 — the nine dead registrations. **Dev's reading is correct, and I am upgrading it from evidence to the finding.**

Verified: `ADMIN_IMPERSONATION_STARTED/ENDED`, `DATA_DELETED`, `MEMORY_ALERT_TRIGGERED`, `SECURITY_ANOMALY_DETECTED`, `SECURITY_BREACH_DETECTED`, `SECURITY_UNAUTHORIZED_ACCESS`, `SETTINGS_2FA_DISABLED`, `USER_TERMINATED` — zero writers anywhere.

A tile captioned "critical security events" whose entire intended population is unwritable is not measuring what its label claims. Every row it has ever counted came from a different set: destructive admin operations, platform malfunctions, and — until this change — a business owner refunding a client. **Keep all nine at `critical`** (they are correctly classified for the day something writes them; the cost of a dead registration is zero and deleting them would lose a deliberate decision). But record plainly, in the tile's own docs, that the tile's amber state currently means "a destructive admin operation or a platform malfunction occurred", not "a security event occurred" — and that no security event in the catalogue can fire it. The missing detectors are a product gap, not this cycle's work; note it and move on.

#### Structural question 2 — the `operationalAlert` slice. **Right shape, one amendment. It FOLLOWS the relabelling; it does not supersede it.**

Approved in principle, and it is **not a new pattern** — `lib/audit/eventAudience.ts` is already exactly this: an explicit, one-entry-per-event side classification of the catalogue, pure (safe in a client bundle), `satisfies Record<AuditEvent, …>`, with a Jest guard that fails on an untagged or stale entry and a documented fail-*open* default. Follow it.

**Amendment — do not put the flag on `EventMetadata`.** Two reasons:
1. The whole point is to stop conflating the compliance record with the alert trigger. Widening the record shape to carry the alert re-conflates them in a new field.
2. `operationalAlert?: boolean` on `EventMetadata` defaults to absent, i.e. **fail-closed** — a genuinely alarming new event added by someone who never read this decision silently alerts nobody. That is the wrong failure direction for a security tile, and it is the opposite of `eventAudience`'s reasoning, where the costly mistake is hiding.

Instead: a sibling module (`lib/audit/operationalAlerts.ts`) with `satisfies Record<AuditEvent, boolean>`, so **every** event forces a decision and a newly added event does not compile until someone chooses. Its Jest guard should assert exhaustiveness, and the slice should state the default for an unclassified action reaching the counter at runtime (I would alert, matching `eventAudience`'s "hiding is the costlier mistake").

**Ordering — relabelling first, structure second, and both in the next slice:**
- The relabelling is needed *regardless*. Stored severity is the compliance record; `PILOT_EXECUTION_FAILED` at `critical` and `ORCHESTRATION_STEP_FAILED` at "whatever passed the CHECK" are wrong *as records*, and the alert-set change would leave them wrong forever while merely hiding them from one tile.
- The structural fix is what stops recurrence, and Dev is right that it repairs historical rows immediately instead of waiting for a 7-day window to roll.
- So: one follow-up slice — relabel (4 events + `MEMORY_SUMMARIZATION_FAILED`, and register the 4 unregistered), then introduce the alert set and point **both** consumers (`health-summary` and `/monitoring`) at it. Neither half supersedes the other.

Ship the slice with a rendered list of the ~11 alerting names in the workplan for the user to approve by name — that list is the product decision, and it should not be inferred from a label a second time.

#### The `'error'` severity bug — **its own fix, NOT this branch. Priority raised.**

Confirmed at `app/api/generate-agent-v2/route.ts:783`, `app/api/generate-agent-v2/route copy.ts:430`, `app/api/generate-agent-v3/route.ts:156,188` — and see C-1: it is a real `TS2322`, not a loose type.

**It is worse than "those rows are lost."** `AuditTrailService.flush()` (`:250-255`) clears the queue and then inserts the whole batch in **one** `.insert(logsToWrite)`. A single invalid `severity` fails the entire statement, and the queue has already been emptied (`:251`, documented at `:267-274` as accepted loss). So one `'error'` write **destroys every unrelated audit row batched with it** — which is what the existing `'medium'` comment at `events.ts:485-487` recorded ("every such row failed its whole batch and none was stored"). That makes it silent, correlated audit-record loss on a compliance surface, not a cosmetic bug.

Rulings:
- **Fix it in its own branch, next, ahead of the relabelling slice.** It is four one-word edits (`'error'` → `'warning'`, matching the `AGENT_GENERATION_FAILED` registration, which also settles the v4 override in passing).
- **Add the missing guard on the other axis.** `stepZeroRegistrations.test.ts:57-61` already asserts every *registered* severity is one the table accepts. Nothing asserts it for *call sites* — which is precisely the hole both `'medium'` and `'error'` lived in. A source scan over `app/`, `lib/`, `components/` asserting every literal `severity:` in an audit write is one of the three accepted values would have caught both, and is cheaper than reasoning about it again.
- **Verify the CHECK against the live schema before landing** (`business-os-schema-check`): no migration in `supabase/migrations/` creates `audit_trail` or its `severity` constraint, so the constraint's existence rests on the prior observation recorded in `events.ts:485-487`. The values are wrong either way (they are outside `AuditSeverity`), but the *consequence* — whole-batch loss — should be confirmed, not inherited.
- **`app/api/generate-agent-v2/route copy.ts` — delete it, in that same branch.** A `route copy.ts` inside `app/api/` is dead code that contains live audit writes and is one rename away from being a route. Deleting it is in scope for the file's own fix; do not let it become a third branch.

### Mandatory-rule conformance (this diff)

| Rule | Verdict |
|---|---|
| 1 — repository pattern | N/A for this diff (no DB access added). Pre-existing `supabaseServer` use in the refunds route noted at comment 4 |
| 2 — Zod on inputs | ✅ unchanged; `RefundSchema.safeParse` at `:176` |
| 3 — Pino, no `console.*` | ✅ **all three modified files are already `console.*`-free.** Dev correctly did not reformat the seven non-compliant files it only read. `app/(protected)/monitoring/page.tsx` (6 calls, one per render) becomes mandatory the moment anyone edits that page — see the banner ruling |
| 4 / Security — `user_id` scoping, RLS, secrets | ✅ unchanged; no auth, query or error-shape change |
| 6 — TypeScript strict | ✅ 0 in-scope diagnostics |
| 7 — no new patterns | ✅ "registration is the single source of truth" narrows an existing pattern rather than adding one |
| Audit trail non-blocking | ✅ both refund writes keep `.catch(...)`. Violated at `WorkflowOrchestrator.ts:408` — folded into ruling 3 |

### Can the tile still drift after this change?

Yes, and it should be said plainly rather than left implied. This change removes one false positive and makes one event's classification single-owned. It does **not** stop the next `critical` registration from lighting up an admin dashboard and an owner's page, because the trigger is still a label chosen for a different purpose. Guard coverage after this change: `PAYMENT_REFUNDED` only. That is the argument for doing the structural slice next rather than eventually — but it is not an argument against merging this, which fixes the reported defect correctly and completely.

### Code Approved for QA: **Yes**

Conditions, none of which require a code change:
1. Apply workplan corrections C-1..C-4.
2. Soften the footnote's password-change clause (comment 1) — recommended, at Dev's discretion.
3. RM excludes `.claude/settings.local.json` and the four unrelated untracked docs (comment 5).
4. Open the follow-ups as agreed above: (a) the `'error'` severity fix + `route copy.ts` deletion + the call-site severity guard, next; (b) the relabelling + `operationalAlert` slice, with the ~11 alerting names listed for user approval; (c) the `/monitoring` page decision (banners + `console.*`).

**For QA:** the interesting cases are a refund writing `severity = 'warning'` end to end, the SOC2 flag still present on that row, the tile counting one fewer, and the owner's `/monitoring` page no longer showing the red banner for a refund-only account — while still not showing the green one (expected; see the banner ruling).

## QA Testing Report
_(QA populates)_

## Commit Info
_(RM populates)_

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-09-30 | Created | Workplan, sweep results and the three checks for the audit-severity fix |
| 2026-09-30 | SA code review | Code approved; rulings on the four proposals, MEMORY_SUMMARIZATION_FAILED, the banner residual, both structural questions and the 'error' bug; corrections C-1..C-4 required |
