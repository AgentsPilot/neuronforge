# Workplan: Making the Security Audit Events Real (Option B)

> **Last Updated**: 2026-10-02

**Developer:** Dev
**Requirement:** [SECURITY_AUDIT_EVENTS_REQUIREMENT.md](/docs/requirements/SECURITY_AUDIT_EVENTS_REQUIREMENT.md) — the SA Review Notes there are binding
**Branch:** `feature/security-audit-events` — **RM creates it**; this plan was written on an up-to-date `main` (`56feb9d2`) with nothing committed
**Date:** 2026-10-01
**Status:** Code Complete (reduced scope), SA + QA fix pass applied 2026-10-02 — awaiting the user's diff review. Built: T1, T3, D-3, T4. Descoped: T2, T5, T6, T7, T8, T9. **Uncommitted.**

---

## Table of Contents

0. [Scope cut by the user](#0-scope-cut-by-the-user-2026-10-01-after-sas-workplan-review)
1. [Analysis Summary](#1-analysis-summary)
2. [SA rulings carried, one line each](#2-sa-rulings-carried-one-line-each)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Task List](#5-task-list)
6. [Verification plan](#6-verification-plan)
7. [Acceptance criteria, mapped](#7-acceptance-criteria-mapped)
8. [Out of scope — recorded, with file and line](#8-out-of-scope--recorded-with-file-and-line)
9. [Decisions — all seven ruled](#9-decisions--all-seven-ruled-by-sa-2026-10-01)
9b. [Findings during implementation](#9b-findings-during-implementation-things-sas-rulings-got-wrong-or-did-not-know)
10. [Risks](#10-risks)
11. [SA Review Notes](#sa-review-notes) (workplan review)
12. [SA Code Review Notes](#sa-code-review-notes) + the Dev fix pass
13. [QA Testing Report](#qa-testing-report)
14. [Commit Info](#commit-info)
15. [Change History](#change-history)

---

## 0. Scope cut by the user, 2026-10-01 (after SA's workplan review)

The user asked for **"this quickly: Recording a refused admin access."** The dashboard half was about
60% of the diff and they did not want it. What that leaves:

| Task | State | Note |
|---|---|---|
| **T1** bounded flush + **M-1** serialisation | ✅ Built | Not optional: without the flush the row is lost when the instance freezes, and without M-1 it is lost under concurrency |
| **T3** severity drop, with SA's "delete BOTH keys" correction | ✅ Built | |
| **D-3** `USER_PASSWORD_CHANGED` off `CLIENT_WRITABLE_EVENTS` | ✅ Built | `auditRoutes.test.ts:350` replaced by a 400-rejection case |
| **T4** `recordRefusedAccess` + the three refusal points | ✅ Built | D-1 option (a), D-2 exact surface, M-4 and M-5 notes included |
| **T5 / T6 / T7** the `refused_admin_access` tile | ⬜ **Descoped** | Implemented, then reverted on the cut (`git checkout` of 11 files). Includes the rules data and types, the evaluator, the route's two counts, the `critical_audit` footnote edit, and every test file with a literal tile list. **M-2's tile-fixture half and M-3 are moot with it**; M-2's gate-test-mock half survives and is built. |
| **T2** registry hygiene (rate-limit metadata, five phantom-event comments) | ⬜ **Descoped** | Cheap, but not what was asked. One short comment on `SECURITY_UNAUTHORIZED_ACCESS` naming its new writer was kept — it documents code that ships. |
| **T8** the always-zero failed-logins label | ⬜ **Descoped** | `login-stats` and `app/admin/users/page.tsx` untouched; the figure still reads as "0 failed logins" when it means "never recorded" |
| **T9** docs (archive the impersonation plan, record the uncounted handlers) | ⬜ **Descoped** | Nothing to record without the tile; the archive is independent and still worth doing |

**What an operator can and cannot see after this slice** — the deliberate trade:

- **Can:** every refusal is a real row in `audit_trail`, visible at `/admin/audit-trail` filtered by
  `action = SECURITY_UNAUTHORIZED_ACCESS`, carrying who was refused, which surface said no, and (when
  the headers were available) their IP and user agent. Exportable for SOC2/GDPR like any other row.
- **Cannot:** there is **no tile, no count, no alert and nothing on any dashboard**. Nobody is told a
  refusal happened; it has to be looked for. `critical_audit` on the Health landing will move, because
  the event is registered `critical` — but it says "a critical event happened", not what it was.
- The six hand-rolled admin handlers still do not record a refusal at all (parked slice 4), and that
  is now recorded **only here** — the tile footnote that was going to say it on screen is descoped.

---

## 1. Analysis Summary

Five surfaces, one shared cause: screens read audit events that nothing writes, and one tile counts a
*severity* while reading as if it counted a *meaning*.

| Area | What this slice does |
|---|---|
| `lib/audit/` | A shared bounded-flush helper (extracted from `clientAuditWrite.ts`), one shared writer for `SECURITY_UNAUTHORIZED_ACCESS`, a metadata entry for `SECURITY_RATE_LIMIT_EXCEEDED`, five "nothing writes this" comments, and two severities dropped `critical` → `warning` |
| `lib/admin/requireAdminRoute.ts`, `lib/admin/requireAdminPage.ts`, `lib/server/route-identity.ts` | The three refusal points write one audit row each, awaited through the bounded flush |
| `lib/admin/health/*` + `app/api/admin/health-summary/route.ts` | An eighth tile counted by **action**, with a footnote that bounds its own coverage; the existing `critical_audit` footnote corrected |
| `app/api/admin/users/[id]/login-stats/route.ts` + `app/admin/users/page.tsx` | The structurally-zero "failed logins" figure says what it is |
| `docs/` | The never-built impersonation plan archived; `ADMIN_IDENTIFICATION_AND_ACCESS.md` records what the new tile does not count |

**Nothing I read contradicted SA's rulings**, with three exceptions that needed a decision and are
written up in §9: how `ip_address` / `user_agent` can actually be stored without passing `request`
(D-1), whether the refused route path is worth a best-effort header read (D-2), and the browser
allow-list (D-3). **All seven are now ruled** — see §9, each marked with its ruling — and SA's review
added five required changes, M-1 to M-5, which are folded into §3, §4, §5, §7 and §10 below.

**One correction to §1 found while implementing M-2:** `lib/admin/jobs/__tests__/buildJobsQueuesView.test.ts`
has **three** inline `evaluateHealth({...})` literals, not the two SA listed — `:192`, `:218` and a
third at `:303` (the `tileAt()` helper added by the credit-leak-check job). All three are in §4.

**Verified facts this plan depends on** (all read on `main`, 2026-10-01):

- `AuditTrailService.log()` queues only; `flush()` is the public write (`AuditTrailService.ts:112-127`, `:244-279`). `buildLogEntry` resolves `input.severity || metadata.severity` and falls back to `SYSTEM_ADMIN_USER_ID` when `userId` is null (`:145-148`).
- `AuditLogInput` (`lib/audit/types.ts:154-166`) has **no** `ipAddress` / `userAgent` fields — the only route into those two columns is `request`, which SA forbade. See D-1.
- `requireAdminRoute.ts:79-87`: a thrown `isAdmin` leaves `isAdmin === false` and falls into the **same** `if (!isAdmin)` branch. `requireAdminPage.ts:72-90`: the same shape. So "answered no" must be tracked separately in both.
- `route-identity.ts:124-131` already returns from the throw path separately, so its `if (!isAdmin)` branch (`:134-139`) is a genuine "no" and needs no extra state.
- `lib/admin/__tests__/admin-authz-surface.guard.test.ts` — the only required check this work can trip — scans `route.ts` files for R1/R2. Editing `lib/admin/requireAdmin*.ts` adds no rule input and moves no cap. `login-stats` stays on both allow-lists (label-only edit, D-6).
- `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts:250-253` registers `health-summary/route.ts` by **file + symbol**, not line number, and we add no entitlements import — so no registration change and no line-shift breakage.
- Every file this slice touches has **zero** `console.*` calls, so CLAUDE.md § Logging triggers no conversion work. (`app/(protected)/monitoring/page.tsx` has 6 — out of scope, §8.)

---

## 2. SA rulings carried, one line each

| Ruling | Where it lands |
|---|---|
| Bounded flush, awaited, extracted not invented | T1, `lib/audit/boundedAuditFlush.ts` |
| No de-duplication; **never pass `request`** to the new write | T4 — the shared writer takes no `NextRequest`; `session_id` pinned null by test |
| Audit only when the admin check **answered no** | T4 — an `answer: 'yes' \| 'no' \| 'threw'` in both gates; the throw path keeps its `logger.error` and writes nothing |
| Always pass the refused user's id explicitly | T4 — `userId` is a required, non-null parameter of the writer |
| Refused act-as: `userId` = session user, target in `details.requestedUserId`, no `adminEmail` | T4c |
| A **new tile**, not a metric on `critical_audit` | T5 + T6 |
| Partial coverage visible **on screen** | T6 — the tile footnote names the six hand-rolled handlers |
| `requireAdmin`'s signature stays backward compatible | T4a — no new parameter at all (see D-2) |
| Do **not** allow-list `USER_LOGIN_FAILED` | T8 — label and comments only |
| `login-stats` is one of the six **and** a rule-1 violation; a label edit must not extend it | T8 — no new query, no new service-role use, caps untouched |
| OQ-5 archive rides along as its own commit | T9 |
| `SECURITY_RATE_LIMIT_EXCEEDED` metadata now, no writer | T2 |
| C-1…C-4 accepted | Recorded in §1, §3.4, §3.7; BA may still patch the requirement |

---

## 3. Implementation Approach

### 3.1 The bounded flush — the ruling the slice stands on

A refused request returns 403 and the serverless instance freezes; a queued row is lost.
`logAndFlushOnLogout` already solves exactly this for logout, so it is **extracted**, not re-invented.

**New file:** `lib/audit/boundedAuditFlush.ts`

```
AUDIT_FLUSH_TIMEOUT_MS = 2000
interface AuditFlushLogger { warn(ctx, msg): void; error(ctx, msg): void }   // structural
async function logAndFlush(entry: AuditLogInput, logger: AuditFlushLogger, context: { reason: string }): Promise<void>
```

- The body is `logAndFlushOnLogout`'s, behaviour-identical: `await AuditTrail.log(entry)` first (it resolves once the entry is *queued*, so flushing before it would find an empty queue), then `await AuditTrail.flush()`, raced against a 2 s timer, `clearTimeout` in `finally`.
- **Never throws, never rejects.** Timeout → `warn`; failure → `error`; ids only, never an email or a body.
- The logger parameter is typed structurally so both `@/lib/logger`'s `Logger` and `requireAdminRoute`'s `AdminGateLogger` satisfy it with no cast.
- `clientAuditWrite.ts` deletes its private copy and calls the helper. `LOGOUT_FLUSH_TIMEOUT_MS` was kept as an alias of `AUDIT_FLUSH_TIMEOUT_MS` and then **deleted in the 2026-10-02 fix pass** — zero consumers anywhere, tests and pre-extraction `main` included, so the alias bought nothing and cost a second name for one budget. The logout bound is unchanged.
- `AuditTrailService` is **not** modified (the same constraint the logout work accepted as D-4).

**M-1 (SA, High) — the extracted flush loses rows under concurrency, and the fix.** SA is right and
I re-read it: `flush()` opens `if (this.isFlushing || this.logQueue.length === 0) return;`
(`AuditTrailService.ts:245`) and clears the queue before awaiting the insert (`:250-251`). So a
second refusal on the same instance queues its entry, calls `flush()`, hits the **early return**, and
`logAndFlush` resolves reporting success having written nothing — the entry then depends on the 5 s
batch timer, and a frozen instance beats it. Latent in `logAndFlushOnLogout` and nearly harmless
there; refusals are the bursty case, so it would falsify acceptance criterion 1.

**Taken as ruled: serialise inside the helper**, with a module-level promise chain.

```
let pending: Promise<void> = Promise.resolve();

function enqueue(entry): Promise<void> {
  const link = pending.then(() => AuditTrail.log(entry)).then(() => AuditTrail.flush());
  //  A link must never reject, or the chain is poisoned for the life of the
  //  instance. `pending` is the SWALLOWED link; `link` is what the caller awaits.
  pending = link.then(() => undefined, () => undefined);
  return link;
}
```

- `logAndFlush` races `enqueue(entry)` against the 2 s timer, so **the chain wait sits inside the
  raced promise** and the budget is 2 s *total* per request — two queued refusals can never add up
  to 4 s on a 403.
- The chain is never poisoned: `pending` only ever holds the swallowed continuation. The caller's
  `link` may reject, which `logAndFlush` already catches and logs.
- Timeout semantics unchanged: on timeout the entry may still be queued, `warn` is emitted, the
  403 is unaffected. Two concurrent refusals produce **two** rows — tested directly against a fake
  `flush()` that reproduces the real `isFlushing` early return.
- Nothing shared changes: `AuditTrailService` stays untouched (D-4 holds). The chain is per module
  instance, which is per serverless instance — exactly the scope of the bug.

### 3.2 One writer, three call sites

**New file:** `lib/audit/recordRefusedAccess.ts`

```
type RefusedSurface = 'admin_api' | 'admin_page' | 'act_as'
async function recordRefusedAccess(params: {
  userId: string                     // the refused SESSION user. Required, non-null, never the target.
  surface: RefusedSurface
  logger: AuditFlushLogger
  route?: string | null              // known only at the act-as site (see D-2)
  requestedUserId?: string | null    // act-as only
}): Promise<void>
```

It builds and flushes exactly one entry:

| Field | Value | Why |
|---|---|---|
| `action` | `AUDIT_EVENTS.SECURITY_UNAUTHORIZED_ACCESS` | already registered `critical` + `['SOC2','GDPR']` (C-4) |
| `entityType` | `'system'` | the refusal is about a platform surface, not a user's record; `'system'` is the registered value for platform-level entries (precedent: `lib/audit/admin-helpers.ts:19`) |
| `entityId` | `null` | there is no row this happened to |
| `userId` / `actorId` | the refused session user, both | the only legitimate subject of a refusal; never `SYSTEM_ADMIN_USER_ID`, never the act-as target |
| `severity` / `complianceFlags` | **not passed** | the registration owns the classification — the lesson of PR #157 / #160 |
| `details` | `{ surface, reason: 'not_an_admin', route?, requestedUserId?, ip_address?, user_agent? }` | see D-1 (option (a), ruled), D-2 |
| `request` | **never** | SA: `session_id` would be NULL here, and a live bearer/refresh token when it is not |

No email, no cookie, no header dump, no request body — `details` is a closed, hand-written key set.
One call site each, so the payload cannot drift between surfaces. Never throws.

**D-1's four conditions, as ruled:**

1. `headers()` from `next/headers` is read inside a `try/catch` that yields `undefined` on a throw,
   so this gate can never turn a 403 into a 500. It is the one function here that can throw.
2. **Unknown values omit the key**, rather than writing `'unknown'` — a deliberate divergence from
   the `change-password/route.ts:67-73` precedent this writer is otherwise modelled on, commented at
   the site. "Not captured" and "captured as unknown" must stay distinguishable (the same principle
   as CLAUDE.md § Currency & Timezone's NULL-vs-`'UTC'` rule).
3. The act-as site derives both values from the `NextRequest` it already holds, **not** from
   `next/headers`; same two keys, same shape, and `request` itself is still never passed to the
   service. The writer therefore takes an optional `headers: { ip?, userAgent? }` rather than reading
   the ambient request itself at that one call site.
4. The columns `ip_address` / `user_agent` stay NULL on these rows, and that is invisible:
   `app/admin/audit-trail/page.tsx` renders no `ip_address` column. **BA owes a correction to
   requirement §3** — "carries `ip_address` and `user_agent`" is true of the row's `details`, not of
   the columns. Accepted and recorded in §9.

### 3.3 The three refusal points

**a. `lib/admin/requireAdminRoute.ts` — 85 call sites across 55 files, all covered by this one edit.**
The `isAdmin` resolution becomes a small three-valued answer:

```
let answer: 'yes' | 'no' | 'threw' = 'threw';
try { answer = (await …isAdmin(…)) ? 'yes' : 'no'; }
catch (err) { logger.error({ err, userId: user.id }, 'Admin check threw; denying access'); }  // stays 'threw'

if (answer !== 'yes') {
  logger.warn({ userId: user.id }, 'Non-admin attempted an admin request');          // unchanged
  if (answer === 'no') await recordRefusedAccess({ userId: user.id, surface: 'admin_api', logger });
  return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
}
```

Signature unchanged. Fail-closed behaviour unchanged: `'threw'` still denies and now writes nothing, so
a Supabase outage cannot paint the new tile red. The two 401 paths (no session; `getUser()` threw) write
nothing — OQ-3, 403 only.

**b. `lib/admin/requireAdminPage.ts` — 12 pages, and the lockout story §3 is sold on.**
The same `answer` triple. The write is `await`ed **immediately before `redirect()`**, outside every
try/catch: `redirect()` throws a control-flow signal that must not be wrapped, and `logAndFlush` never
throws, so awaiting it there can neither swallow nor trigger anything. An anonymous visitor
(`user === null`) produces no row.

**M-4 (SA, Medium) — the file's indistinguishability claim needs a qualifier, not a change.** The
`await` stays. The two **responses** remain byte-identical, which is the property that matters, but
after this change a signed-in non-admin's redirect waits on a bounded flush while an anonymous
visitor's does not: that is a **timing side channel**, and `requireAdminPage.ts:16-20` currently
asserts indistinguishability flatly. It is not a defect — the secret the property protects is "does
an admin area exist at this URL", and only a caller who already holds a valid session can observe
the slow path, at which point it tells them nothing they did not already know. But the header is
load-bearing documentation, and a future reader would either believe it unqualified or "fix" it by
deleting the `await`. So the header gains the qualifier and the write site gains a one-line comment
naming both facts.

**c. `lib/server/route-identity.ts:134-139` — the refused act-as.**
`await recordRefusedAccess({ userId: sessionUserId, surface: 'act_as', route, requestedUserId: targetUserId, logger })`
before the 403 return. Deliberately **not** shaped like the granted `PLUGIN_ACT_AS` write eleven lines
below: no `userId: targetUserId`, no `details.adminEmail`, no `request`, and not fire-and-forget. A
comment at the site names both differences and why, so the next reader does not "align" them.

### 3.4 The severity drop (added by the user, 2026-10-01)

`USER_PASSWORD_CHANGED` and `SETTINGS_SECURITY_UPDATED` move `critical` → `warning` **in
`EVENT_METADATA` only**, compliance flags untouched — both carry `['SOC2','GDPR']`, verified at
`events.ts:499-503` and `:546-550`. It mirrors PR #157 / #160: the registration becomes the single owner
of the classification, with a guard test modelled line-for-line on
`paymentPlanCancelledSeverity.guard.test.ts`.

What I found when I went looking for the writers, which changes two things:

- **`USER_PASSWORD_CHANGED` has exactly one writer, and it already passes `severity: 'warning'` with `['SOC2']`** (`app/api/user/change-password/route.ts:195-203`). `SecurityTabV2` stopped writing it and says so (`SecurityTabV2.tsx:78-84`); the V1 tab never did. So the registration's `critical` is reachable **only** through the browser allow-list — which is exactly the hole: any signed-in customer can `POST /api/audit/log` with `action: 'USER_PASSWORD_CHANGED'` and mint a `critical` row, because the client path takes severity from the registration (`clientAuditWrite.ts:146-160`, `requestSchemas.ts:216-218`). Dropping the registration closes it. I will still delete the route's explicit `severity` (registration as single owner) — and call out in the same commit that the route's flags were `['SOC2']` while the registration says `['SOC2','GDPR']`, so deleting the override **adds** GDPR to future rows. That strengthens the record, but it is a change and must not be slipped in silently. **SA's correction to this finding, taken:** the route passes `complianceFlags: ['SOC2']` at `:202` as well as `severity` at `:201`, so **both keys are deleted**. Deleting severity alone would leave the route owning the flags — the registration would not be the single owner, and the GDPR consequence written into the commit message would not actually ship.
- **`SETTINGS_SECURITY_UPDATED` has exactly one writer**, the V1 browser tab (`components/settings/SecurityTab.tsx:93-116`), which posts `severity: 'critical'` in its body — **already ignored by design** (`requestSchemas.ts:216-218`: `severity: z.unknown().optional()`, accepted then dropped). So there is no behavioural call-site edit to make. I will delete the two dead keys and leave a one-line comment saying severity and flags come from the registration, so the file stops advertising a value it cannot set.
- **Stored rows keep their severity. Future writes only.** Both tiles keep counting historical `critical` password-change rows until they age out of the 24 h / 7 d windows — the same deliberate trade as #157/#160, and better than rewriting a compliance table to flatter a dashboard.
- **The pin moves in the same commit.** `lib/audit/__tests__/stepZeroRegistrations.test.ts:22-23` pins both at `critical`; left alone the suite goes red. Both rows move to `'warning'`, **and** their stale provenance notes are corrected: `'SecurityTab, SecurityTabV2'` is wrong for the password event (the only writer is `/api/user/change-password`). That file's premise — "store exactly what the caller stored before step 0" — is deliberately superseded for these two rows, so the diff carries a comment recording that the user decided the *alerting*, not the recording, was wrong.
- **Consequence for C-2, worked out rather than assumed.** After this commit the footnote sentence *"Normal business operations such as refunds and password changes are recorded at a lower severity and are not counted here"* becomes **true for the first time**, for both halves. It still needs a small edit, because it is the sentence an operator reads to decide what the tile means and it is silent on three things that stay true: rows written before this change keep `critical` for up to 7 days; `SETTINGS_API_KEY_CREATED`, `USER_EMAIL_CHANGED`, `DATA_EXPORTED`, `BUSINESS_DATA_PURGED`, `AGENT_DELETED` and the AgentKit cost guards are still `critical`; and refused admin access now has **its own** tile. So T7 is: keep the now-true sentence, add one pointer to the new tile, add one clause about historical rows. Not a deletion, not a rewrite.

### 3.5 The new tile

`refused_admin_access`, the eighth tile, placed **immediately after `critical_audit`** so the two
audit-derived tiles sit together. No layout work — `HealthGrid.tsx:97-98` maps the array.

| File | Edit |
|---|---|
| `lib/admin/health/healthTypes.ts:25-32` | `HealthTileId` gains `'refused_admin_access'` |
| `lib/admin/health/rules.ts` | `RefusedAccessMetric = 'refusedAccess24h'`; into `MetricId`; `METRIC_LABELS` (`'refused admin access attempts in 24 h'`, `count`); `HealthRuleSet` key; `TILE_VOCABULARY`; `HEALTH_RULES.refused_admin_access` = one amber rule, `atLeast refusedAccess24h ≥ 1`, id `refusedAccess.any24h`, description `'Admin access was refused in the last 24 hours'` |
| `lib/admin/health/evaluateHealth.ts` | `REFUSED_ACCESS_ACTION = 'SECURITY_UNAUTHORIZED_ACCESS'` (a mirrored literal pinned by test, exactly like `AI_FAILED_ACTION:393`); `TITLES` → `'Refused admin access'`; `GREEN_ELIGIBLE` add; `RefusedAccessFacts { last24h; last7d }`; `HealthInputs.refusedAccess`; `refusedAccessMeasurement()`; one entry in `evaluateHealth()`'s return array |
| `app/api/admin/health-summary/route.ts` | two `auditCount` reads (`refusedAccess24h`, `refusedAccess7d`) with `{ action: AUDIT_EVENTS.SECURITY_UNAUTHORIZED_ACCESS }` — `auditCount`'s filter type already accepts `action` — plus one `HealthRead` assembly beside `critical` |

Figures: two counts (24 h, 7 d), both exact, each linking to `/admin/audit-trail` filtered by
`action=SECURITY_UNAUTHORIZED_ACCESS` and the window (`auditLink` already takes `action`).

**Footnote — the visible bound on coverage, which is SA's condition for `GREEN_ELIGIBLE`:**

> Counts refused admin requests, refused admin page loads and refused act-as attempts — a signed-in account that was told no. Anonymous callers are not counted: there was no identity to refuse. A refusal is recorded as a critical event, so it is also counted by "Critical audit events". **Six admin handlers check admin access themselves and are not counted here** (`admin/agents`, `business-os/llm-usage`, `business-os/llm-usage/businesses`, `chat-usage`, `users/[id]/audit-logs`, `users/[id]/login-stats`), so green means "nothing was refused on the counted surfaces", not "nobody probed".

**M-3 (SA, Medium) — the footnote test cannot bite as I claimed, so the claim goes.** `R1_PARKED`
(`admin-authz-surface.guard.test.ts:250-289`) is a module-local `const`, not exported, so a footnote
test can only hard-code the six ids — and a slice-4 conversion that removes one from the guard would
leave the footnote test green on six stale ids. Taken as ruled, cheapest honest version: keep the
hard-coded footnote test (it still pins the text against an accidental edit), **drop the "a future
conversion that forgets the footnote fails" claim** from here, from T6 and from §10, and add a
one-line comment to `R1_PARKED` naming the tile footnote as a second place to update when an entry
is removed.

Green is reachable (the normal state), amber at ≥ 1, never red — a first refusal is worth a look, not an
alarm, and SA rejected the de-duplication a red threshold would need.

Stated so nobody files it as a bug: because the event stays registered `critical`, a refusal also raises
`critical_audit`. That is what `critical_audit` is for (severity); the new tile is what says *what
happened*. Per SA's finding 4 this is now **on screen in both footnotes**, not only here.

### 3.6 Registry hygiene

- `SECURITY_RATE_LIMIT_EXCEEDED` gains an `EVENT_METADATA` entry (`'warning'`, `['SOC2']`, `'A caller exceeded a rate limit'`) with a comment saying nothing writes it yet and that the entry exists so the first writer does not record "Unknown event". `'warning'`, **not** `'critical'` — see D-5.
- Five one-line comments on the feature-does-not-exist events, each naming what is missing rather than just "unused": `ADMIN_IMPERSONATION_STARTED` / `_ENDED` (`events.ts:725-734` — no impersonation exists anywhere in the app; the nearest real thing is `PLUGIN_ACT_AS`), `SETTINGS_2FA_DISABLED` (`:566` — no 2FA code in the app), `USER_TERMINATED` (`:509` — no termination path; `/api/user/delete-account` is a deliberate 410 tombstone), `DATA_DELETED` (`:595` — account erasure is not built; `BUSINESS_DATA_PURGED` is the business-level event and is deliberately distinct).

### 3.7 The always-zero failed-logins figure

Label only. The API field keeps its name, so no caller breaks.

- `app/api/admin/users/[id]/login-stats/route.ts`: a comment above `failedLogins` (`:63`) recording C-1 — `USER_LOGIN_FAILED` has **two** writers (`lib/client/auth-actions.ts:107`, `:181`) and both are dead by construction: the client write route answers 401 without a session and a failed sign-in has none (`clientAuditWrite.ts:106-122`), and the event is not on `CLIENT_WRITABLE_EVENTS`, so it would 400 even with one. The figure is therefore structurally 0 and must not be read as "no failed logins". The comment also carries the "do not allow-list this event" warning and why: an unauthenticated caller's email in `resourceName` / `details.email` would be an anonymous write channel into the compliance log and an account-enumeration surface. **No query change, no new service-role use, no conversion** — the file stays on the R1/R2 allow-lists and the caps stay at 6.
- `app/admin/users/page.tsx:743-746` and `:929-931`: both renderings become *"Failed logins: not recorded"* rather than a number. The row-level one is currently behind `stats.failed_logins > 0`, so it renders nothing at all today — the condition goes, because silence reads as zero just as loudly.
- `lib/client/auth-actions.ts:107`, `:181`: a comment at each dead writer saying it cannot store anything and pointing at the route-level reason. `lib/client/__tests__/auth-actions.googleIdToken.test.ts:59` asserts the *fetch* happens against a mocked `fetch` — still true, no edit; one comment there records that it proves a POST, not a stored row.

### 3.8 Docs

- `docs/admin/ADMIN_IMPERSONATION_IMPLEMENTATION_PLAN.md` → `docs/archive/`, with a header saying it was never built, that it specifies the banned `profiles.role` signal (lines 14, 41, 318, 749) and that `admin_users` / `requireAdmin` supersede it. A pointer stays in `ADMIN_IDENTIFICATION_AND_ACCESS.md`. **Its own commit.**
- `ADMIN_IDENTIFICATION_AND_ACCESS.md` § What is NOT true gains one row: the refused-access tile counts the canonical route gate, the page gate and the refused act-as, and **not** the six hand-rolled handlers — so a green tile is not "nobody probed".

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/audit/boundedAuditFlush.ts` | create | the extracted bounded flush (T1) |
| `lib/audit/clientAuditWrite.ts` | modify | use the helper; `LOGOUT_FLUSH_TIMEOUT_MS` deleted (zero consumers), with a comment at the old site |
| `lib/audit/recordRefusedAccess.ts` | create | the one writer for the new event |
| `lib/audit/events.ts` | modify | rate-limit metadata; five dead-event comments; two severities → `warning` |
| `lib/admin/requireAdminRoute.ts` | modify | audit the "answered no" 403 |
| `lib/admin/requireAdminPage.ts` | modify | audit the "answered no" redirect, flushed before `redirect()` |
| `lib/server/route-identity.ts` | modify | audit the refused act-as |
| `lib/admin/health/healthTypes.ts` | modify | new tile id |
| `lib/admin/health/rules.ts` | modify | new metric, label, rule set, vocabulary, one rule (**code — back to SA, by that file's own header**) |
| `lib/admin/health/evaluateHealth.ts` | modify | title, eligibility, facts, measurement, return array; `critical_audit` footnote |
| `app/api/admin/health-summary/route.ts` | modify | two action-filtered counts + one `HealthRead` |
| `app/api/admin/users/[id]/login-stats/route.ts` | modify | comment only (no query change) |
| `app/admin/users/page.tsx` | modify | two honest labels |
| `lib/client/auth-actions.ts` | modify | comments on the two dead writers |
| `app/api/user/change-password/route.ts` | modify | drop the explicit severity (registration owns it) |
| `components/settings/SecurityTab.tsx` | modify | drop the two dead body keys + comment |
| `lib/audit/__tests__/stepZeroRegistrations.test.ts` | modify | move the two pins to `warning`; correct their stale notes |
| `lib/audit/__tests__/passwordChangeSeverity.guard.test.ts` | create | guard, modelled on the plan-cancelled one |
| `lib/audit/__tests__/refusedAccessAudit.test.ts` | create | the new writer: payload, no `request`, null `session_id`, never throws |
| `lib/admin/__tests__/requireAdminRoute.test.ts` | modify | **M-2:** mock `AuditTrailService` (its non-admin case now writes for real), and add the refusal cases **here** rather than in a new sibling file: one row on "no", **zero** on "threw", 403 either way |
| `lib/admin/__tests__/requireAdminPage.test.ts` | modify | **M-2:** the same — mock the service, add the refusal cases to the existing canonical file; the flush is awaited before the redirect |
| `lib/audit/requestSchemas.ts` | modify | **D-3 (its own commit):** remove `USER_PASSWORD_CHANGED` from `CLIENT_WRITABLE_EVENTS` |
| `app/api/audit/__tests__/auditRoutes.test.ts` | modify | **D-3:** the allow-list becomes 9 events (title included); the `['SecurityTab password', …]` accepted-caller row at `:350` is **deleted** and replaced by a 400-rejection case |
| `lib/admin/health/__tests__/qa-edge.test.ts` | modify | **M-2:** its own full `HealthInputs` builder, `inputs()` `:15-33` |
| `lib/admin/jobs/__tests__/buildJobsQueuesView.test.ts` | modify | **M-2:** three inline `evaluateHealth` literals — `:192`, `:218` and `:303` (SA listed two; there are three) |
| `lib/admin/jobs/__tests__/qa-slice5-pr2.status.test.ts` | modify | **M-2:** `tilesFor()` `:33-42` |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | modify | **Finding 5:** a 403 now touches `audit_trail`; the 59-handler "touches nothing" assertion becomes "touches nothing but the audit trail" |
| `app/api/admin/__tests__/auditAdminGate.test.ts` | modify | **Finding 5**, same cause |
| `app/api/admin/audit-trail/__tests__/route.validation.test.ts` | modify | **Finding 5**, same cause (2 cases) |
| `app/api/admin/users/__tests__/searchInjection.qa.test.ts` | modify | **Finding 5**, same cause — tightened to prove the search term never reached PostgREST |
| `app/api/agent-executions/stats/__tests__/auth.test.ts` | modify | **Finding 5**, same cause |
| `lib/admin/health/__tests__/rules.config.test.ts` | modify | tile list `:17-28` |
| `lib/admin/health/__tests__/evaluateHealth.test.ts` | modify | `quietInputs:82`, `inputsFor:102`, eligibility list `:312`, otherwise list `:450`, `randomInputs:716`, `READ_OF:769`, `toHaveLength(7)` → `8` at `:789` |
| `lib/admin/health/__tests__/qa-slice5.test.ts` | modify | `inputs()` fixture `:30-44`, `ELIGIBLE_MEASURED:47` (**and the test title's "four" → five**), the `it.each` **key array** `:83` as well as the read→tile map `:91`, invalid-rule list `:98`, and the `'everything failed'` fixture `:214` (**M-2**) |
| `app/api/admin/health-summary/__tests__/route.test.ts` | modify | tile order `:175`, green list `:177` |
| `app/api/admin/health-summary/__tests__/route.qa-edge.test.ts` | modify | **M-2 confirmed the suspicion:** `:260-262` keys on *any truthy `action`*, so it would feed the refused counts the `completed` figure. The mock becomes an **equality** test per action, so a future read cannot silently inherit another tile's number |
| `app/admin/__tests__/health.qa-slice5.render.test.tsx` | modify | measured-tile list `:73` |
| `app/admin/__tests__/health.render.test.tsx` | verify | the fixture is illustrative, not exhaustive — expect **no** edit |
| `docs/admin/ADMIN_IMPERSONATION_IMPLEMENTATION_PLAN.md` | move → `docs/archive/` | never built; names a banned pattern |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | § What is NOT true: the six uncounted handlers; archive pointer |

**Not touched, deliberately:** `lib/services/AuditTrailService.ts` (unless SA picks D-1 option b),
`lib/audit/requestSchemas.ts` (the new event must stay off the allow-list and `USER_LOGIN_FAILED` must
not join it — subject to D-3), the six hand-rolled handlers' auth code, and
`app/(protected)/monitoring/page.tsx`.

---

## 5. Task List

Grouped as the commits I would hand RM, in this order: **T1 → T3 → T3b (D-3) → T4**. (The original
reason for T3 before T6/T7 — so the tile's footnote is true at the moment it is written — no longer
applies now the tile is descoped, but the order is kept: the severity drop is independent and
smaller, and it reads better first in the diff.)

**T1 — extract the bounded flush, serialised** (`refactor(audit):`)
- [x] Create `lib/audit/boundedAuditFlush.ts` with `AUDIT_FLUSH_TIMEOUT_MS` + `logAndFlush`, plus the **M-1** module-level promise chain (chain wait inside the raced promise; links never reject)
- [x] Point `clientAuditWrite.ts` at it. **`LOGOUT_FLUSH_TIMEOUT_MS` was kept as an alias, then
      DELETED in the 2026-10-02 fix pass** (SA's optional item): a repo-wide search — tests included,
      and including `main` before the extraction — found **zero** consumers outside the file itself,
      so "it is a public export today" was true of the declaration and of nothing else. Two names for
      one budget is worse than one. A comment at the old site records the deletion and that the logout
      bound is unchanged (`AUDIT_FLUSH_TIMEOUT_MS`).
- [x] Unit tests: queue-then-flush ordering; a timeout warns and still resolves; a rejecting `flush()` is swallowed and logged; the timer is always cleared (no open handle)
- [x] **M-1 tests:** against a fake service reproducing the real `isFlushing` early return — two concurrent `logAndFlush` calls write **both** entries; a rejecting first link does not poison the chain for the second; the 2 s budget is total, not per link
- [x] Confirm the existing logout/audit-route tests pass unchanged

**T2 — registry hygiene** ⬜ **DESCOPED** (user scope cut, §0) (`chore(audit):`)
- [ ] `SECURITY_RATE_LIMIT_EXCEEDED` → `EVENT_METADATA` (`'warning'`, `['SOC2']`) + comment
- [ ] Five "nothing writes this, and why" comments
- [ ] Test: no `SECURITY_*` event falls through `getEventMetadata()` to "Unknown event"

**T3 — a password change is recorded, not alerted** (`fix(audit):`)
- [x] `USER_PASSWORD_CHANGED` and `SETTINGS_SECURITY_UPDATED` → `'warning'`, flags unchanged, reasoning in the comment
- [x] Delete **both** the explicit `severity` (`:201`) **and** `complianceFlags: ['SOC2']` (`:202`) at `change-password/route.ts`; record the GDPR-flag consequence in the commit message (SA's correction to finding 1 — deleting severity alone would not ship it)
- [x] Delete the dead `severity` / `complianceFlags` keys in `SecurityTab.tsx` + comment
- [x] Move the two `stepZeroRegistrations.test.ts` pins and correct their provenance notes
- [x] New `passwordChangeSeverity.guard.test.ts`: both registered `'warning'`; flags intact; not `'critical'`; a severity the `audit_trail` CHECK accepts; no writer overrides severity (comment-stripped source, as the plan-cancelled guard does)
- [x] Prove the guard bites by reinstating `'critical'` locally

**T3b — a password change is no longer browser-writable** (`fix(audit):`, D-3, its own commit after T3)
- [x] Remove `AUDIT_EVENTS.USER_PASSWORD_CHANGED` from `CLIENT_WRITABLE_EVENTS` (`requestSchemas.ts:176`) — one line; repo-wide search confirms zero browser callers
- [x] `auditRoutes.test.ts:311-327`: "exactly the 10 events" becomes 9, title included
- [x] `auditRoutes.test.ts:350`: **delete** the accepted-caller row and add a **400-rejection** case, so the test proves the hole is shut rather than silently stopping covering it
- [x] `SETTINGS_SECURITY_UPDATED` **stays** on the list. SA's reason was "the V1 tab still writes it (`SecurityTab.tsx:93`)"; the write exists but its containing function is **never called** (finding 4, §9b). The conclusion is unchanged — removing an event from an accepted-input list is its own decision and was not taken here.
- [x] Name it in the diff summary the user reads: it narrows accepted API input

**T4 — write the refusal** (`feat(audit):`)
- [x] `lib/audit/recordRefusedAccess.ts` (one writer, closed `details`, no `request`)
- [x] T4a `requireAdminRoute.ts`: the `answer` triple; write on `'no'` only; `await` before the 403
- [x] T4b `requireAdminPage.ts`: the same; `await` immediately before `redirect()`, outside every try/catch
- [x] T4c `route-identity.ts`: the refused act-as; `userId` = session user; `details.requestedUserId`; comment on why it differs from the granted write
- [x] Tests: payload shape; `session_id` null; `user_id` is the refused caller; exactly one row on "no"; **zero** rows when the check threw; the 403 / redirect is unchanged when the audit write rejects **or** times out; the three `surface` literals are pinned (D-2) so a fourth call site cannot invent a spelling
- [x] **M-2:** the two existing gate test files mock `@/lib/services/AuditTrailService`, and the refusal cases live in them
- [x] **M-4:** the `requireAdminPage.ts` header qualifier + the one-line comment at the write
- [x] Re-run `Admin authz surface guard` — green, caps unmoved (R1/R2 scan `ROUTE_FILES` only; R4 scans these files and is not triggered, because no `role` comparison is added)

**T5+T6 — the tile** ⬜ **DESCOPED** (implemented, then reverted on the user's scope cut, §0) (`feat(admin):` — **one commit**, per SA: the data and the evaluator must land together to compile)
- [ ] `healthTypes.ts`; `rules.ts` (metric, label, rule set, vocabulary, one amber rule) — reviewed as code by SA's workplan pass
- [ ] `evaluateHealth.ts`: mirrored action constant, title, `GREEN_ELIGIBLE`, facts, measurement, footnote, return array
- [ ] `health-summary/route.ts`: two counts + `HealthRead`
- [ ] Update the **nine** test files with literal tile lists or `HealthInputs` fixtures (§4, M-2)
- [ ] Tests: 0 → green; 1 → amber matching `refusedAccess.any24h`; a failed count → `unavailable` and never green; the figures' links carry `action=SECURITY_UNAUTHORIZED_ACCESS`; the footnote names all six handler ids **and** says a refusal is also counted as critical (the claim that this bites on a future conversion is dropped — M-3)

**T7 — the existing footnote** ⬜ **DESCOPED** with T6, §0. Note: T3 makes the footnote's existing sentence ("password changes are recorded at a lower severity and are not counted here") TRUE for the first time, so leaving it unedited improves it. The clause about historical rows lingering up to 7 days is now unwritten. (same commit as T6)
- [ ] `critical_audit` footnote: keep the now-true sentence, add the pointer to the new tile, add the clause about rows written before the severity change

**T8 — the always-zero figure** ⬜ **DESCOPED** (user scope cut, §0) (`fix(admin):`)
- [ ] `login-stats` comment (no query change, no caps change)
- [ ] The two labels on `app/admin/users/page.tsx`
- [ ] Comments at `auth-actions.ts:107` and `:181`, and one on the Google ID-token test's assertion — including SA's clause that the dead payload puts the caller's `email` in `details` and in a log line, so resurrecting the call site must not resurrect the payload

**T9 — docs** ⬜ **DESCOPED** (user scope cut, §0) (two commits: archive, then record)
- [ ] Move the impersonation plan to `docs/archive/` with its superseded header; leave the pointer
- [ ] `ADMIN_IDENTIFICATION_AND_ACCESS.md` § What is NOT true row
- [ ] C-1…C-4 accepted — recorded here; BA may still patch the requirement

---

## 6. Verification plan

**No CI job runs Jest in this repo**, so everything below is a QA/local gate, not a merge gate. The only
required check this work can trip is **`Admin authz surface guard`**. `npm run build` proves nothing
about types — `next.config.js` sets `ignoreBuildErrors: true`.

| Gate | Command / method |
|---|---|
| Audit suites | `npm test -- lib/audit app/api/audit` |
| Admin gates | `npm test -- lib/admin/__tests__` |
| Health | `npm test -- lib/admin/health app/api/admin/health-summary app/admin/__tests__/health` |
| Required check | `npm test -- lib/admin/__tests__/admin-authz-surface.guard.test.ts` — green, with `CAPS.R1.parked` and `CAPS.R2.parked` still 6 |
| Types | a scoped `tsc --noEmit` over the touched files only, through a throwaway tsconfig in the scratchpad (never committed), compared against the same files on clean `main` so pre-existing errors are not mistaken for ours — the method `scripts/typecheck-bos-llm.ts` documents |
| Lint | `npm run lint` on the touched files; `npm run lint:hooks` |
| Entitlements | not applicable: no import from `lib/business-os/entitlements/` is added or changed. `npm run test:bos-entitlements` is run once anyway to prove it |
| Guards bite | reinstate `severity: 'critical'`; pass `request` into the refusal write; drop a handler id from the tile footnote — each must fail its guard |

### Verification actually run (2026-10-01, reduced scope)

| Gate | Result |
|---|---|
| Directly-affected suites (`lib/audit`, `app/api/audit`, `lib/admin`, `lib/server/route-identity`) | **green** |
| **Full Jest suite, before and after, with the changes stashed for the baseline** | `main` baseline: **27 failed / 8 skipped / 689 passed** of 732. After: **27 failed / 8 skipped / 697 passed**, the **same 27 suites by name**. Zero regressions; **+67 passing tests**. (An intermediate run showed 35 failed — 5 were real regressions, now fixed, see §9b finding 5; 3 were pre-existing load flakes that pass in isolation.) |
| `Admin authz surface guard` (the one required check at stake) | **green**, `CAPS.R1.parked` and `CAPS.R2.parked` still 6, file untouched |
| Types | Scoped `tsc` over all 24 touched files: **zero errors in any file this slice touches**. 42 errors total, all in untouched transitive imports (24 pre-existing `TS1117` in `lib/business-os/LanguageContext.tsx`, 18 in `lib/analytics`, `lib/audit/admin-helpers.ts`, `lib/audit/ais-helpers.ts`, `lib/memory`, `lib/services/EmbeddingService.ts`). The full-project `tsc` was NOT used: it OOMs silently and reads as a clean pass. |
| Lint | `npx eslint` on all touched source and test files: **0 errors**. 12 pre-existing warnings in `SecurityTab.tsx` / `events.ts`, none introduced. `npm run lint:hooks` clean. |
| Entitlements | `npm run test:bos-entitlements`: **97 suites / 2022 tests pass**. No import from `lib/business-os/entitlements/` added or changed. |
| Guards bite | M-1 proven: with the serialising chain reverted, `"B arriving while A's insert is in flight is still written"` fails with B's row **missing from the writes and still in the queue** while `logAndFlush` reported success. T3 proven both ways: reinstating `severity: 'critical'` reddens 4 assertions across 2 suites; reinstating `complianceFlags: ['SOC2']` on the route reddens the single-owner assertion. |

**Manual checks for QA** (there is no E2E tool in this repo):

1. Sign in as a non-admin, `GET /api/admin/health-summary` → 403 **and** one `SECURITY_UNAUTHORIZED_ACCESS` row in `/admin/audit-trail`, with `session_id` empty and `user_id` = the non-admin.
2. The same account opens `/admin` → redirected to `/business-os`, one row, `details.surface = 'admin_page'`.
3. Anonymous `curl /api/admin/health-summary` → 401, **no** row.
4. A refused act-as → one row whose `user_id` is the caller, with the target only in `details.requestedUserId`.
5. ~~The new tile~~ — descoped (§0). Instead: open `/admin/audit-trail`, filter `action = SECURITY_UNAUTHORIZED_ACCESS`, and confirm the rows from checks 1, 2 and 4 are all there and nothing else is.
6. Change a password in `/v2/settings` → a `warning` row, and the `critical_audit` figure does **not** move. (Caveat: rows written before this deploys keep `critical` and still count for up to 7 days.)
7. `POST /api/audit/log` with `action: 'SECURITY_UNAUTHORIZED_ACCESS'` → 400.
8. *(D-3)* `POST /api/audit/log` with `action: 'USER_PASSWORD_CHANGED'` → 400, **and** changing a password through `/v2/settings` still records its row (the server route is unaffected).
9. **Two concurrent refusals** — two non-admin `/api/admin/*` calls fired together → **two** rows, not one. This is M-1 in production; the unit test proves the mechanism, this proves the deployment.

**Owed to the user, not provable from the repo:** confirm the index situation on `audit_trail` in
prod. **SA's correction, taken:** there is no *composite* `(action, created_at)` index, but
`supabase/SQL Scripts/create_audit_trail.sql:40` and `:44` create single-column indexes on `action`
and on `created_at DESC`, which Postgres can bitmap-AND — and the existing failures tile already
reads on exactly this shape. So the new tile adds no new exposure; worst case it degrades to
`unavailable` under its per-read deadline, and the page never fails either way.

**One method note for whoever re-verifies types:** `npx tsc --noEmit -p tsconfig.json` OOMs silently
on this repo and reads as a clean pass. A scoped throwaway config over the touched files is the only
honest check; `npm run build` proves nothing (`next.config.js` sets `ignoreBuildErrors: true`).

---

## 7. Acceptance criteria, mapped

Requirement §7 plus SA's seven changes.

- [ ] One row per refused request, **and it survives a handler that returns immediately** — T1 + T4, by flushing before the response. **Held under concurrency** by M-1's serialising chain: two concurrent refusals on one instance write two rows, proven by a test against the real `isFlushing` early-return shape
- [ ] An audit failure never turns a 403 into a 500 and never grants access — `logAndFlush` cannot throw; tested with a rejecting and a hanging `flush()`
- [ ] No row carries an email, token or request body — closed `details` set; a test asserts the exact key set
- [ ] A browser `POST` of the event is rejected — the allow-list is unchanged; the `auditRoutes.test.ts` rejection shape is extended to name it
- [ ] *(added, D-3)* A browser `POST` of `USER_PASSWORD_CHANGED` is **also** rejected with 400 — the event leaves `CLIENT_WRITABLE_EVENTS`
- [ ] A refusal caused by the admin check **throwing** produces no row — T4, both gates
- [ ] The row's `user_id` is the refused caller — never `SYSTEM_ADMIN_USER_ID`, never the act-as target
- [ ] The row's `session_id` is `null` — pinned, because the obvious implementation passes `request`
- [ ] The `critical_audit` **footnote** is true, and the new tile's footnote names the six uncounted handlers
- [ ] The six handlers are recorded in three places: this workplan, the tile footnote, `ADMIN_IDENTIFICATION_AND_ACCESS.md` § What is NOT true
- [ ] A repeated 403 does not pin the tile red — there is no red rule; amber at ≥ 1; no de-duplication
- [ ] Each tile's on-screen rule list matches its description — the existing generated-condition machinery plus `rules.config.test.ts`
- [ ] No CI job runs Jest; `Admin authz surface guard` is the only required check at stake — §6
- [ ] *(added)* Both lowered events keep their compliance flags, and the change affects future writes only

---

## 8. Out of scope — recorded, with file and line

- **The customer-facing monitoring page.** SA ruled it out to keep this an afternoon; the user then chose the severity drop over reworking it, which silences its worst symptom without touching it. `app/(protected)/monitoring/page.tsx` — the "Failed Logins" card `:787-788`, the `failedLogins >= 3` recommendation `:275` and `:297-300`, and the severity-only security banner `:281-296` ("Excellent Security Posture" / "N critical security event(s) detected. Immediate review recommended."). After T3 a password change no longer trips that banner; the card and the `>= 3` recommendation remain permanently dead, and the banner still speaks for every other `critical` event. If it is ever pulled in, CLAUDE.md § Logging applies first — the file has **6** `console.*` calls.
- Breach and anomaly detection; the five feature-does-not-exist events (comments only); rate limiting itself (metadata only); `MEMORY_ALERT_TRIGGERED` (AgentsPilot, parked).
- Converting the six hand-rolled handlers, and converting `login-stats` to `requireAdmin` + a repository: parked slice 4, and it would have to drop both caps 6 → 5 in the same commit.
- Retiring or renaming any registry entry beyond comments and the two severities.

### Recorded in the fix pass, 2026-10-02 (not fixed here)

- **The refused caller sees a critical-incident banner about themselves (QA E-2, Medium — a product
  decision, raised with the user separately).** The row is registered `critical` **by design** and its
  `user_id` is the refused caller, and the owner RLS policy lets an owner read their own rows. So after
  a non-admin opens `/admin` once, their own customer-facing monitoring page renders
  *"1 critical security event(s) detected. Immediate review recommended."*
  (`app/(protected)/monitoring/page.tsx:290-292`, the message string at `:292`) and the Security Score
  reads **40 % / "Needs attention"** (`:1035`, `:1039`) instead of 100 % / "Excellent". This is the
  **same defect class T3 just removed for password changes**, arriving by the same route: a severity
  chosen for an operator dashboard being read by a customer dashboard. QA checked for an automatic
  trigger and found none — the only client-side admin probe (`AdminCalibrationTrigger.tsx:63` →
  `/api/admin/agents`) hits one of the six hand-rolled handlers, which records nothing, and that
  component renders only on `/test-plugins-v2`. **The severity is deliberately NOT changed here**: it is
  what makes the event visible to an operator at all, and lowering it is the user's call, not a fix
  pass's. The durable fix is the monitoring page reading by **action and audience** rather than by
  severity — which is the whole of the first bullet above.
- **`USER_PASSWORD_CHANGE_FAILED` is written but not registered.**
  `app/api/user/change-password/route.ts:148` and `:171` write it as a bare string literal with no entry
  in `AUDIT_EVENTS` or `EVENT_METADATA`, so every one of those rows reads
  `description: "Unknown event: USER_PASSWORD_CHANGE_FAILED"` and is classified only by the route's own
  `severity: 'warning'` / `['SOC2']`. Same defect class the descoped T2 was going to fix for the
  `SECURITY_*` family. Left alone deliberately — registering an event is a decision, not a cleanup, and
  it is why the T3 guard asserts per-`auditLog`-call rather than per file (section 9b, finding 3).
- **A per-IP rate limit is owed before this is probe-proof.** Already owed from the invite-signup work;
  it is the dependency under the accepted M-5 amplification risk in section 10. Nothing in this slice
  adds one, and nothing in this slice is safe to describe as rate-limited.
- **`evaluateHealth.ts:688`'s footnote becomes true on deploy, and is contradicted for up to 7 days
  before it.** The sentence *"Normal business operations such as refunds and password changes are
  recorded at a lower severity and are not counted here"* is true of every row written after T3 ships
  and false of every `critical` password-change row already stored, which the tile keeps counting for
  24 h / 7 d. The clause that would have said so on screen went out with the descoped T7, so it is
  recorded only here. No edit was made to the footnote in the fix pass: T7 is descoped, and editing it
  would be re-opening descoped work.

---

## 9. Decisions — all seven ruled by SA (2026-10-01)

Each decision below is kept as written, with SA's ruling prefixed. Nothing here is still open.

**Also recorded as accepted, per D-1 condition 4:** BA owes requirement §3 a correction —
"carries `ip_address` and `user_agent`" is true of the row's **`details`**, not of the `ip_address` /
`user_agent` columns, which stay NULL on these rows. And per D-5, the requirement's "all critical"
for the security family was a restatement of the registry's block comment, not a decision; BA
corrects the wording rather than the code matching it.


- **RULED: option (a), with four conditions (see §3.2).** **D-1 — `ip_address` / `user_agent` cannot reach their columns without `request`.** `AuditLogInput` (`types.ts:154-166`) exposes no `ipAddress` / `userAgent`; `buildLogEntry` fills both **only** from `extractRequestContext(input.request)` — the same function that copies the session credential into `session_id`. So SA's "read IP and user agent through `next/headers` inside the gate" is only half-implementable as written: the gate can read the values, but has nowhere to put them. Three options. **(a) recommended:** put them in `details` as `ip_address` / `user_agent`, following the existing precedent at `app/api/user/change-password/route.ts:67-73` — no change to the shared service, both values retained and visible on the row, but the `ip_address` **column** stays empty, so requirement §3's "carries `ip_address` and `user_agent`" is true of the row and not of the column, and nothing on screen will claim otherwise. **(b)** add optional `ipAddress` / `userAgent` to `AuditLogInput` and prefer them in `buildLogEntry` — fills the real columns, keeps `session_id` null, but edits a service every audit write goes through. **(c)** record neither and correct §3. I will implement **(a)** unless SA rules otherwise.
- **RULED: confirmed as proposed** — `details.surface` only, path omitted at the route and page gates, exact `route` at the act-as site; the optional-second-argument variant rejected; the three `surface` literals pinned by test. **D-2 — the refused route path.** `requireAdmin` cannot know its own path without a parameter, and SA forbade a required one. Vercel's `x-matched-path` is read nowhere in this repo today, so recording it would mean relying on an unverified header. Proposal: record `details.surface` (always exact) and **omit the path** at the route and page gates; the act-as site keeps its exact `route`. If SA wants the path, the alternative is an **optional** second argument `requireAdmin(logger, { route })` adopted by new call sites only — backward compatible across all 85, but it yields partial data, which is the kind of half-truth this slice exists to remove.
- **RULED: TAKE IT**, as its own commit after T3 (T3b). **D-3 — `USER_PASSWORD_CHANGED` stays browser-writable, and T3 only half-closes that.** Dropping it to `warning` removes the critical-tile abuse, but a signed-in customer can still mint `USER_PASSWORD_CHANGED` rows in their own compliance log at will — and **no browser writes the event any more**; the only writer is `/api/user/change-password`. Removing it from `CLIENT_WRITABLE_EVENTS` (`requestSchemas.ts:176`) is a one-line deletion plus `auditRoutes.test.ts:323` / `:350`. I have **not** put it in the task list: it changes an API's accepted input and deserves its own decision. Recommend SA take it now while the file is open, or record it as a follow-up.
- **RULED: confirmed.** **D-4 — tile order.** New tile directly after `critical_audit` (eight tiles). Say so if SA wants it last.
- **RULED: confirmed, `'warning'`.** **D-5 — `SECURITY_RATE_LIMIT_EXCEEDED` severity.** I propose `'warning'`, not `'critical'`: a limiter doing its job is not an incident, and `critical` would drop every future throttle into the `critical_audit` tile — the exact mixing this slice is unwinding. SA to confirm, since the requirement called the family "all critical".
- **RULED: confirmed.** **D-6 — `login-stats` stays on both allow-lists.** Comment-and-label only; no new service-role usage, no query change, caps unmoved at 6. Confirming I read SA's warning the way it was meant.
- **RULED: both confirmed; finding 1 corrected — delete BOTH override keys.** **D-7 — the two findings inside the severity drop** (§3.4): the password route already passed `warning` + `['SOC2']`, so deleting that override **adds** the GDPR flag to future rows; and the `SecurityTab` body's `severity` was already ignored, so there is no behavioural call-site edit for the settings event. Both are improvements, neither is what the brief predicted — flagging rather than absorbing.

---

## 9b. Findings during implementation (things SA's rulings got wrong, or did not know)

Four, all verified in the code. None changed the design; two change what a claim is worth.

1. **ts-jest in this repo does not type-check at all**, so M-2's premise — "`jest.config.js` uses the
   `ts-jest` preset, so a required `HealthInputs` field is a red suite, not a silent pass" — is
   false. Proven directly: a throwaway test containing `const n: number = 'definitely not a number';`
   **passes**. The transform passes an inline `tsconfig` object and diagnostics do not fire. The four
   fixtures SA predicted would go red (`qa-edge.test.ts`, the two `lib/admin/jobs` files, the render
   test) all passed with the field missing. Consequence for any future slice: a §4 file list is the
   ONLY safeguard — no CI job runs Jest, Jest does not type-check, and `npm run build` sets
   `ignoreBuildErrors`. A scoped `tsc` is the only thing that finds a missing field.
2. **`buildJobsQueuesView.test.ts` has three inline `evaluateHealth({…})` literals, not two** —
   `:192`, `:218` and `:303` (the `tileAt()` helper from the credit-leak-check job). Moot with the
   tile descoped; recorded because the next tile slice will hit it.
3. **`change-password/route.ts` writes a second, UNREGISTERED event.** `USER_PASSWORD_CHANGE_FAILED`
   is written twice (`:148`, `:171`) as a bare string literal with no entry in `AUDIT_EVENTS` or
   `EVENT_METADATA`, so every one of those rows reads `description: "Unknown event:
   USER_PASSWORD_CHANGE_FAILED"` and is classified only by the route's own `severity: 'warning'` /
   `['SOC2']`. Same defect class T2 was going to fix for the `SECURITY_*` family. **Left alone** — it
   is a different event and registering it is a decision, not a cleanup. It is why the T3 guard
   asserts per-`auditLog`-call rather than per file: a file-wide `not.toMatch(/severity:/)` would
   have dragged it into scope.
4. **Five test suites outside §4 assert that a 403 touches NOTHING, and the new write breaks them.**
   The biggest miss in the review, mine and SA's: M-2 found the two gate test files, but the audited
   refusal is a new side effect of **every** `requireAdmin` 403, and five more suites assert zero I/O
   on that path. Measured, not guessed: the full suite was run before and after with the changes
   stashed, so the 27 suites already red on `main` are excluded.

   | Suite | What it asserted | Fix |
   |---|---|---|
   | `app/api/admin/__tests__/adminGate.writes.test.ts` | `mockTablesTouched` `[]` for all **59** gated handlers (×1 case each) | `touchedBesidesAudit()`, plus a positive `toContain('audit_trail')` |
   | `app/api/admin/__tests__/auditAdminGate.test.ts` | `mockTablesRead` length 0 | filter out `audit_trail` |
   | `app/api/admin/audit-trail/__tests__/route.validation.test.ts` | the same, ×2 cases | `protectedTablesRead()` + `readBuilderCalls()` (the INSERT is excluded by method) |
   | `app/api/admin/users/__tests__/searchInjection.qa.test.ts` | **no HTTP request at all** | exactly one request, a POST to `/rest/v1/audit_trail`, and no URL carrying the search term |
   | `app/api/agent-executions/stats/__tests__/auth.test.ts` | `from` never called | `from` called with `audit_trail` and nothing else |

   In every case the 401 and admin-check-threw assertions were left at **strict zero** — that is the
   OQ-3 behaviour, and keeping them strict is what still catches a future change that starts writing
   on those paths. Two further suites (`app/admin/business-os-invites/.../page.render.test.tsx`,
   `components/business-os/settings/.../InviteFriendsSection.render.test.tsx`) and
   `app/api/admin/jobs-queues/__tests__/qa-slice5-pr2.route.test.ts` failed in the full run and
   **pass in isolation** — pre-existing load flakes, not touched.

5. **`SETTINGS_SECURITY_UPDATED` has no reachable writer.** SA's D-3 ruling keeps it on
   `CLIENT_WRITABLE_EVENTS` because "the V1 tab still writes it (`SecurityTab.tsx:93`)". The code
   exists, but its containing function `handleSecuritySettingsSave` (`:50`) **is never called** — ESLint
   reports it unused and there is no `onClick` or other reference in the file. So the severity drop on
   that event is write-forward over a path that never fires, and its practical effect is limited to
   `USER_PASSWORD_CHANGED`. The ruling's *conclusion* still stands (leave it on the allow-list); its
   *reason* does not. Removing it is a separate decision and was not taken.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| A 403 now waits up to 2 s on the audit flush | Bounded and raced; access is already denied before the flush runs. A slow database delays a refusal; it can never grant one. |
| The page gate's `await` sits next to `redirect()` | `logAndFlush` never throws and never rejects, so it cannot swallow the redirect signal; tests assert the redirect still happens when the flush rejects **and** when it times out. |
| A scripted probe writes many rows | Accepted per SA: a row requires a valid session, the tile is amber not red, and raising the threshold later is a data edit. |
| `HealthInputs` gains a required field | Deliberate — the shape the slice-4 tiles use — so the compiler finds every fixture instead of a tile silently reading "not measured". Every call site is listed in §4. |
| A future slice-4 conversion makes the footnote stale | **Accepted, not mitigated (M-3).** `R1_PARKED` is module-local, so a footnote test can only hard-code the six ids and would stay green on stale ones. The footnote test still pins the text against an accidental edit, and `R1_PARKED` carries a comment naming the footnote as a second place to update. |
| **A refused 403 now costs up to 2 s of serverless compute instead of tens of milliseconds (M-5)** | **Accepted risk, recorded rather than mitigated — the 2 s bound *is* the amplification, so "we bounded it" is not a mitigation.** A prober holding one valid session can occupy that budget per refused call across 85 route call sites, and there is no rate limiter anywhere; a per-IP limit is already owed from the invite-signup work and is the thing this depends on. The normal case is far below the bound (one small insert), and access is already denied before the flush runs. |
| No composite `audit_trail (action, created_at)` index in prod | Two single-column indexes exist (`idx_audit_trail_action`, `idx_audit_trail_created_at`), which Postgres can bitmap-AND, and the existing failures tile already reads this exact shape — so the new tile adds no new exposure. Worst case it degrades to `unavailable` under the existing per-read deadline. Verification owed to the user (§6). |
| **The serialising chain fixes `logAndFlush` callers against each other ONLY (SA code review C-3)** | **Accepted, not mitigated — scoped in the file header rather than left implied.** The chain does not serialise this helper against the other `AuditTrail.flush()` callers on the same instance: the batch interval (`AuditTrailService.ts:290`), `log()`'s batch-size flush (`:123`), `shutdown()` (`:590`), `auditFlush()` (`:647`) and its exit caller (`:636`), and a dozen awaited route-level flushes (`app/api/admin/archiving/runs/route.ts:178`, `:187`, `:203`; the admin entitlements, admin invites, friend-invites and public invite-validate routes; `lib/business-os/invites/redemptionDeps.ts:92`). If any of those is in flight when a refusal calls `logAndFlush`, the `isFlushing` early return still swallows the row and still reports success — **same row loss, different concurrent party**. What M-1 removes is the case this slice creates and makes common (refusals in bursts), not the whole class. Closing the class means serialising inside `AuditTrailService.flush()`, which D-4 keeps out of scope. |
| A burst longer than the chain can drain inside one budget (QA operational 2) | **Accepted.** The chain is per instance, so N concurrent refusals perform N serialised inserts, each measured from its own start. Beyond roughly 40-80 concurrent refusals on one instance the tail callers time out (warned) and their rows then depend on the instance surviving long enough for the chain to drain. Strictly better than the pre-fix silent loss, and consistent with the accepted M-5 amplification; it bounds what "every refusal is recorded" means under a probe. |
| A caller queued behind a HUNG flush has nothing queued at all (SA code review C-2) | **Accepted, and the file header no longer says otherwise.** The first caller's entry is in the queue when it times out, so the 5 s batch timer can still save it. The second caller's `log()` has not run — it sits behind the hung link — so there is nothing queued and the batch timer cannot help. Both entries are written as soon as the hung flush settles, and both are lost if the instance freezes first. |
| A failed INSERT is invisible to the caller (QA operational 1) | **Pre-existing, accepted.** `AuditTrailService` is constructed `silent: true` and `flush()` routes its own errors through `handleError`, which logs and does not rethrow (`:263`, `:574-583`). So `logAndFlush` resolves "successfully" when the insert failed. Not introduced here and not fixable without touching the service (D-4) — but it is why **no automated test in this repo can prove a row lands**, and why the section 6 manual checks 1, 2, 4 and 9 are the only proof and are still owed. |
| Importing the admin gates now pulls in the `AuditTrail` singleton (QA operational 3) | **Note, not a defect.** `requireAdminRoute` / `requireAdminPage` transitively import a module that constructs its client at module scope from `SUPABASE_SERVICE_ROLE_KEY` (`AuditTrailService.ts:63-66`, `:595`). Absent that variable, importing the gate throws at load and the admin surface answers 500 instead of 403. Both variables exist in prod and no admin route runs on the edge runtime (checked by QA). |

---

## SA Review Notes

**Reviewed by SA — 2026-10-01**
**Status:** 🔄 Revision Required — approve-with-changes in substance. The plan is sound, every ruling
is carried, and the three decisions it raised were the right ones to raise. Five things must change
before code (M-1 to M-5); then implement without a second workplan pass. **M-1 is a real durability
hole the extraction inherits, and it bites the new use far harder than the one it was extracted from.**

Everything in §1 "Verified facts" was re-read independently on `56feb9d2` and is accurate. So are all
seven line-level claims in `evaluateHealth.test.ts`, the `rules.config.test.ts` / `route.test.ts` /
`health.qa-slice5.render.test.tsx` lists, `auditCount`'s `action`-capable filter type
(`health-summary/route.ts:153-160`), `auditLink`'s `action` parameter (`evaluateHealth.ts:377`),
`'system'` as a registered `EntityType` with the `admin-helpers.ts:19` precedent, zero `console.*` in
all 14 touched source files, and the entitlements registration being by file + symbol
(`enforcementPoints.test.ts:250-253`). `app/admin/audit-trail/page.tsx` does **not** render
`ip_address`, which matters for D-1.

---

### Rulings on D-1 … D-7

**D-1 — option (a), `details.ip_address` / `details.user_agent`. Confirmed, with four conditions.**
The finding is correct and my original ruling was half-implementable: `AuditLogInput`
(`types.ts:154-166`) has no `ipAddress` / `userAgent`, and `buildLogEntry` fills those columns only
from `extractRequestContext(input.request)` (`AuditTrailService.ts:138`, `:170-172`) — the same
function that copies the session credential into `session_id` (`:210-216`). Option (b) is
**rejected**: it edits the one path every audit write in the platform goes through, to serve one
event. Option (c) is **rejected**: the values are free and useful. Option (a) stands, and the decisive
fact is that nothing on screen reads the column — the admin audit-trail page does not render
`ip_address` at all — so nothing will look empty anywhere. Conditions:

1. **Guard the read.** `headers()` from `next/headers` throws outside a request scope. Wrap it so a
   throw yields `undefined`, never an exception: this gate must not be able to turn a 403 into a 500,
   which is the whole point of the bounded flush sitting next to it.
2. **Omit the keys when unknown — do not write `'unknown'`.** The `change-password` precedent
   (`route.ts:67-73`) writes the string; do not copy that here. "Not captured" and "captured as
   unknown" must stay distinguishable — the same principle as CLAUDE.md § Currency & Timezone's
   NULL-vs-`'UTC'` rule. Say so in a comment, since you are deliberately diverging from the precedent
   you cite.
3. **At the act-as site, derive both from the `request` object you already hold**
   (`route-identity.ts` has it), not from `next/headers`. Same two `details` keys, same shape. Do not
   pass `request` itself.
4. **BA owes a correction to requirement §3**: "carries `ip_address` and `user_agent`" is true of the
   **row's `details`**, not of the columns. Record it in this workplan's §9 as accepted so the
   requirement and the code cannot drift.

**D-2 — confirmed as proposed.** `details.surface` only, path omitted at the route and page gates,
exact `route` kept at the act-as site. The optional-second-argument variant is **rejected** for the
reason you gave: partial data is the failure mode this slice exists to remove, and `x-matched-path` is
read nowhere in this repo, so it would be an unverified dependency inside a fail-closed path. Pin the
three `surface` literals in a test so a fourth call site cannot invent a spelling.

**D-3 — take it. Approved, as its own commit after T3.** The evidence is decisive and I re-verified
it: a repo-wide search for `USER_PASSWORD_CHANGED` outside docs returns only the route, the registry,
`eventAudience.ts`, `requestSchemas.ts:176` and two tests. `SecurityTabV2.tsx:72-84` documents that it
deliberately stopped writing it; the V1 `SecurityTab.tsx` writes only `SETTINGS_SECURITY_UPDATED`.
There is no browser caller, so removing it from `CLIENT_WRITABLE_EVENTS` breaks nothing and closes a
channel by which a signed-in customer writes into their own compliance log. Required shape:

- one-line deletion at `requestSchemas.ts:176`;
- `auditRoutes.test.ts:311-327` — "exactly the 10 events" becomes 9, title included;
- `auditRoutes.test.ts:350` — **delete** the `['SecurityTab password', …]` accepted-caller row and add
  a **rejection** case asserting 400, so the test proves the hole is shut rather than silently stops
  covering it;
- `SETTINGS_SECURITY_UPDATED` **stays** on the list — the V1 tab still writes it
  (`SecurityTab.tsx:93`).

Keep it a separate commit from T3 and name it in the diff summary the user reads: it narrows accepted
API input, and that deserves to be visible even though no caller exists.

**D-4 — confirmed.** Eighth tile directly after `critical_audit`.

**D-5 — confirmed, `'warning'`.** Your reasoning is the correct one and it is the same reasoning as
#157 / #160: a limiter doing its job is a recorded fact, not an incident. The requirement's "all
critical" was a restatement of the existing registry block comment, not a decision. Correct the
requirement's wording via BA rather than matching it.

**D-6 — confirmed, and this is exactly how the warning was meant.** `login-stats` keeps both
allow-list entries (`admin-authz-surface.guard.test.ts:285`, `:300`), `CAPS.R1.parked` and
`CAPS.R2.parked` stay at 6 (`:403-404`), no query change, no new service-role use. The conversion is
slice-4 work.

**D-7 — both confirmed; see findings 1 and 2 below.**

---

### The four severity-drop findings — confirmed, with one correction

1. **Confirmed, and the task list is ambiguous about it.** `change-password/route.ts:201-202` passes
   `severity: 'warning'` **and** `complianceFlags: ['SOC2']`; the registration carries
   `['SOC2', 'GDPR']` (`events.ts:499-503`). T3's bullet says only "delete the explicit `severity` at
   `:200`". **Delete both keys.** Deleting severity alone leaves the route owning the flags, so the
   registration is not the single owner and the GDPR consequence you flagged does not actually
   happen — you would have written the consequence into the commit message without shipping it.
   Adding `GDPR` to a password-change row is correct on the merits and is the registration's job.
2. **Confirmed.** `AuditWriteBodySchema` declares `severity: z.unknown().optional()` and
   `complianceFlags: z.unknown().optional()` (`requestSchemas.ts:246-247`, documented at `:216-218`),
   and the entry built at `clientAuditWrite.ts:150-161` carries neither. The body keys are dead.
   Deleting them plus one comment is the right edit, and there is no behavioural call-site change.
3. **Confirmed, including the staleness.** `stepZeroRegistrations.test.ts:23` says
   `'SecurityTab, SecurityTabV2'` for an event neither file writes. Correct it to
   `/api/user/change-password`. The file's premise is explicitly "the literal severity and flags the
   caller sent before step 0" (`:1-6`), so superseding two rows needs the comment you describe — write
   it in the file, not only in the commit message, because the file's header is what the next reader
   will believe.
4. **Confirmed — your edit, not mine.** Your reading is better than my C-2: the sentence becomes true
   for both named examples, so keep it. Add the two clauses you propose, plus one I want explicit:
   **a refused admin access is `critical` and therefore also counted here.** §3.5 says this to the
   reader of the workplan; the operator reading the tile needs it too, or the first refusal produces
   two amber tiles and a "why is this double-counted" question. One clause.

---

### M-1 — (High) The bounded flush loses rows under concurrency, and refusals arrive in bursts

This is the one thing in the plan that does not do what it claims. `AuditTrail.flush()` opens with
`if (this.isFlushing || this.logQueue.length === 0) return;` (`AuditTrailService.ts:245`), and copies
the queue *before* awaiting the insert (`:250-251`). So:

- request A: `log(A)` → queue `[A]`; `flush()` sets `isFlushing`, takes `[A]`, clears the queue, awaits;
- request B on the same instance, concurrently: `log(B)` → queue `[B]`; `flush()` sees `isFlushing` and
  **returns immediately, having written nothing**. B's `logAndFlush` resolves `'flushed'` and the
  handler returns 403. B now depends on the 5 s batch timer, and the instance freezes first.

B is lost, silently, and the helper reports success. This is latent in `logAndFlushOnLogout` today and
nearly harmless there — logouts are rare and almost never concurrent. Refusals are the opposite: a
probe, or one non-admin client firing several `/api/admin/*` calls, is precisely a burst on one
instance. It directly falsifies acceptance criterion 1 ("one row per refused request, **and it
survives a handler that returns immediately**").

**Ruling: serialise inside the new helper.** A module-level promise chain in `boundedAuditFlush.ts`
(`pending = pending.then(() => log(entry).then(() => flush()))`) makes B wait for A's flush to settle
and then flush its own entry with `isFlushing` clear. It touches nothing shared, needs no change to
`AuditTrailService` (D-4 holds), and makes the extraction strictly better than the original rather
than a copy of its bug.

Three constraints on the shape:

- **The chain wait must sit inside the raced promise**, so the 2 s budget is total per request and two
  queued refusals cannot add up to 4 s on a 403.
- **A chain link must never reject**, or the chain is poisoned for the life of the instance. Swallow
  inside the link; log at the call site as you already do.
- Timeout semantics stay as designed: on timeout the entry may remain queued, `warn` is emitted, the
  403 is unaffected. Test it — two concurrent refusals must produce **two** rows.

If you would rather not serialise, the alternative is acceptable but worse, and must be explicit: drop
acceptance criterion 1 to "one row per refused request, except when a second refusal reaches the same
instance while the first is still flushing", say so in the tile footnote (the tile under-counts), and
say so in `boundedAuditFlush.ts`. I will approve either, but not the current wording with the current
behaviour.

---

### M-2 — (High) The tile's edit list is still short: six files, not the three you flagged

You were right that a required `HealthInputs` field finds every fixture — and `jest.config.js` uses the
`ts-jest` preset, so a type error **is** a red suite, not a silent pass. Four files that construct the
argument are absent from §4 and will go red:

| File | Site | Why it breaks |
|---|---|---|
| `lib/admin/health/__tests__/qa-edge.test.ts` | `inputs()` `:15-33` | Its own full `HealthInputs` builder. **Not the same file** as `app/api/admin/health-summary/__tests__/route.qa-edge.test.ts`, which is the one you listed. |
| `lib/admin/jobs/__tests__/buildJobsQueuesView.test.ts` | `:192-201` and `:218-227` | Two inline object literals passed straight to `evaluateHealth`. |
| `lib/admin/jobs/__tests__/qa-slice5-pr2.status.test.ts` | `tilesFor()` `:33-42` | Same shape. |
| `lib/admin/__tests__/requireAdminRoute.test.ts` **and** `requireAdminPage.test.ts` | whole files | T4, not T6 — but the same omission. See below. |

The gate tests are the more serious miss. Both exist already, both mock only `@/lib/auth`,
`AdminAccessService` and (the page one) the logger, and both have a "403 / redirect for a signed-in
non-admin" case that will now execute `recordRefusedAccess` for real. `AuditTrail` is constructed at
module scope (`AuditTrailService.ts:595`) against the `tests/plugins/jest-setup.ts` env stubs, so the
import survives but `flush()` attempts a real insert against a stub URL inside a previously pure unit
test. **Both files must mock `@/lib/services/AuditTrailService`** (there is ample precedent — a dozen
route tests already do). And prefer **adding the refusal cases to those two files** over creating
`*.refusal.test.ts` siblings: the module already has one canonical test file each, and two files
asserting on one gate is the pattern drift this codebase has otherwise avoided.

Three more sites inside files you did list, so the list is complete:

- `qa-slice5.test.ts:83` — the `it.each(['settings','failures','spend','critical','entitlements'])`
  **key array**, not only the `:91` map below it. Both need the new read.
- `qa-slice5.test.ts:47` — adding the tile to `ELIGIBLE_MEASURED` makes the first test's "the **four**
  measured eligible tiles" five; update the title with the array.
- `qa-slice5.test.ts:214` — the `'everything failed'` fixture becomes untrue (the new read stays `ok`).
  Either add it or rename the case.

`app/admin/__tests__/health.source.guard.test.ts` needs no edit — verified, it carries no tile list.
Your "verify, expect no edit" call on `health.render.test.tsx` is right: `:145` asserts against
`SUMMARY.tiles.length`, so the fixture is self-consistent. On
`health-summary/__tests__/route.qa-edge.test.ts`, `:260-262` keys on *"any truthy `action` that is not
`BUSINESS_AI_ACTION_FAILED`"* and would feed the refused counts the `completed` figure — so it does
need the action-keyed branch you suspected. Make that mock test for **equality** on each action rather
than truthiness, so the next read added to the route cannot silently inherit another tile's number.

---

### M-3 — (Medium) The six-handler footnote test cannot bite as described

§3.5, T6 and the risk table all claim "a future slice-4 conversion that forgets the footnote fails".
It will not. `R1_PARKED` in `admin-authz-surface.guard.test.ts:250-289` is a module-local `const`,
not exported, so a footnote test can only hard-code the six ids — and a conversion that removes one
from the guard leaves the footnote test green on its six stale ids.

Either make it true or stop claiming it. Cheapest honest version, and my preference: keep the
hard-coded footnote test (it still pins the text against an accidental edit), drop the claim from §3.5
and the risk table, and add a one-line comment to `R1_PARKED` pointing at the tile footnote as a second
place to update when an entry is removed. Exporting the list from the guard to share it is also
acceptable but puts a required check's internals on a new consumer — not worth it for six strings.

---

### M-4 — (Medium) The page gate's documented indistinguishability needs a qualifier, not a change

Your reading is right that the row is server-side and changes no response body, and an anonymous
visitor writing nothing is correct (OQ-3). But `requireAdminPage.ts:16-20` asserts the property
flatly — "an anonymous visitor and a signed-in non-admin must be indistinguishable" — and after T4b a
signed-in non-admin's redirect waits on a bounded flush while an anonymous one does not. That is a
timing difference between the two responses.

It is **not** a defect and the `await` stays: the secret the property protects is "does an admin area
exist at this URL", and only a caller who already holds a valid session can observe the slow path, at
which point it tells them nothing they did not already know. But the file's header is load-bearing
documentation that a future reader will either believe unqualified or "fix" by deleting the `await`.
Add the qualifier to that header and a one-line comment at the write, naming both facts: the responses
are identical, the latency is not, and why that is acceptable.

---

### M-5 — (Low, but mandatory) Record the 403 compute-amplification as an accepted risk

§10 covers the latency ("a 403 now waits up to 2 s") but not the consequence: a probe holding one
valid session can now occupy up to 2 s of serverless compute per refused call instead of tens of
milliseconds, across 85 route call sites, with no rate limiter anywhere (explicitly out of scope, and
a per-IP limit is already owed from the invite work). The normal case is far below the bound, so this
is an accepted risk, not a blocker — but it must be written down in §10 next to the per-IP limit it
depends on, because "we bounded it at 2 s" reads as mitigation when the bound *is* the amplification.

---

### Confirmations of the things you asked me to check

- **The three-valued answer is the minimal correct shape.** `'yes' | 'no' | 'threw'` initialised to
  `'threw'`, `if (answer !== 'yes')` keeping the fail-closed branch intact, write only on `'no'`. A
  boolean would work but would make "threw" and "no" indistinguishable at the write site, which is the
  exact distinction OQ-3(a) exists to preserve. Approved for both gates.
- **The page-gate placement is sound**, subject to M-4's comment. `await` outside every try/catch and
  immediately before `redirect()` is the only correct position: `logAndFlush` cannot throw, so it can
  neither swallow nor raise the redirect signal.
- **`route-identity.ts` genuinely needs no `answer` state.** Re-read: the throw path returns its own
  403 at `:128-131`, so `if (!isAdmin)` at `:133` is reached only on a real `false`. Confirmed.
- **The extraction is the right call and the alias is the right detail.** `LOGOUT_FLUSH_TIMEOUT_MS` is
  a public export today; aliasing it beats editing a logout path for cosmetics. Structural logger
  typing is correct — `AdminGateLogger` (`requireAdminRoute.ts:39-42`) and Pino's `Logger` both satisfy
  `{ warn; error }` with no cast. Keep `AuditTrailService` untouched (M-1 is solvable without it).
- **The writer's payload is right.** `entityType: 'system'` is registered (`types.ts:30`) with the
  `admin-helpers.ts:19` precedent; `entityId: null`; `userId` / `actorId` both the refused session user
  (and required non-null, which is what keeps `buildLogEntry:148`'s `SYSTEM_ADMIN_USER_ID` fallback out
  of reach); no `severity` / `complianceFlags`; no `request`. The deliberate divergence from the
  granted `PLUGIN_ACT_AS` write, commented at the site, is exactly right.
- **`Admin authz surface guard` is unaffected.** R1 and R2 scan `ROUTE_FILES` only (`:856`), so
  `lib/admin/requireAdmin*.ts` is not an input to either; no cap moves. One precision: R4 scans every
  file under the TS roots, `lib/admin/` included — it fires on `role` comparisons, and you add none, so
  it stays green. Say "R4 scans these files and is not triggered" rather than "adds no rule input".
- **Entitlements: nothing owed.** No new import from `lib/business-os/entitlements/`;
  `health-summary/route.ts` is registered by file + symbol, so line shifts are harmless. Running
  `npm run test:bos-entitlements` anyway is the right instinct.
- **Zero `console.*` in all 14 touched source files** — independently counted, all zero. No conversion
  work. The 6 in `app/(protected)/monitoring/page.tsx` are correctly out of scope and correctly named.
- **The index claim is accurate but overstated.** There is no composite `audit_trail (action,
  created_at)`; `supabase/SQL Scripts/create_audit_trail.sql:40` and `:44` create single-column indexes
  on `action` and on `created_at DESC`, which Postgres can bitmap-AND, and the existing failures tile
  already reads on exactly this shape. Keep the production verification owed to the user; soften the
  wording from "unindexed" to "no composite index; two single-column indexes exist".

---

### Scope and commit split

Proportionate. Nothing to cut — the severity drop, the archive and the login-stats relabel all share
the "a screen reads something nothing writes" cause, and each is minutes. The nine-commit split is
right, and the ordering argument (T3 before T6/T7, so the footnote is true at the moment it is
written) is the kind of sequencing usually discovered too late. Two adjustments: **D-3 becomes its own
commit after T3**, and **T5 folds into T6** — `rules.ts` is "code and back to SA" for review purposes,
which this review has now done; splitting the commit buys nothing once the data and the evaluator have
to land together to compile.

### Optimisation Suggestions

- `clientAuditWrite.ts:110-114` carries a `TEMPORARY (added 2026-09-18, remove after 2026-09-25)` block
  now six days past its own expiry, in a file T1 opens. Not this slice's job — mention it to the user
  as a one-line follow-up (it is that workplan's follow-up F-C) rather than absorbing it.
- `lib/client/auth-actions.ts:107` logs `{ email }` and `:109` puts the email in `details`, on a line
  T8 annotates. `requireAdminRoute.ts:16-17` states the house rule as "userId only, never the email".
  Out of scope — the write is dead anyway — but worth one clause in your T8 comment so the next reader
  does not resurrect the call site *and* its payload.
- `SecurityTab.tsx:90` still sends an `x-user-id` header the route ignores. Dead, harmless, and
  adjacent to the keys T3 deletes; drop it in the same edit if it is genuinely one line.

### Approval

- [ ] Workplan approved — proceed to implementation
- [x] Revision required: M-1 to M-5, the D-1 conditions (1-4), the D-3 shape, and finding 1's
      "delete both keys". Patch this workplan with each and then **proceed straight to
      implementation** — no second workplan review. All of it is checked again at code review.


## SA Code Review Notes

**Reviewed by SA — 2026-10-02 (code review of the implemented, reduced scope)**
**Status:** 🔄 Needs revision — 1 High, 3 Medium, 2 Low. **No source-code change required.** Both new
modules (`lib/audit/boundedAuditFlush.ts`, `lib/audit/recordRefusedAccess.ts`) and all three refusal
points (`requireAdminRoute.ts`, `requireAdminPage.ts`, `route-identity.ts`) are **approved as
written**. Every item below is test, comment or doc text.

> **Provenance of this section.** SA left its findings as a paste-ready block that it did **not**
> append, because QA was editing this file concurrently. The block was **not present in this file**
> when the fix pass started, and was not found anywhere else in the repo. What follows is Dev
> transcribing the findings from TL's brief, item by item, so the register is complete and the
> resolutions have something to point at. **It is not SA's own prose** — if SA's block resurfaces,
> prefer it over this transcription.

### The High item — found independently by both reviewers

**`app/api/admin/__tests__/auditAdminGate.test.ts:102` weakened more than the new write needs.**

```ts
expect(mockTablesRead.filter((table) => table !== 'audit_trail')).toHaveLength(0);
```

All **three** routes the `describe.each` drives read `audit_trail` as their **protected data**
(`audit-trail/route.ts:90`, `users/[id]/audit-logs/route.ts:53` and `:69`,
`users/[id]/login-stats/route.ts:48`), so filtering that table name out filters out the entire read
the suite exists to catch. Worse: only `/api/admin/audit-trail` uses `requireAdmin` — the other two
hand-roll their gate and **write nothing on refusal**, so for them the filter was pure loss, and no
sibling covers them (`route.validation.test.ts` covers only the gated route). Both reviewers converged
on the same fix shape: key off the route name the `describe.each` tuple already carries. Move
`route.validation.test.ts:4-6`'s header claim with it — it says this suite "asserts no table is read
before the gate passes", which stops being true.

### C-2 (Low) — `boundedAuditFlush.ts`'s "the entry remains queued" is wrong for the second caller

The header's last paragraph says that on a hang "the entry remains queued". True of the caller that
timed out mid-flush; **false of the caller queued behind it** — its `log()` has not run, so nothing is
queued and the 5 s batch timer cannot save it.

### C-3 (Medium) — the serialisation header frames the wrong concurrent party

The header presents the bug as "two concurrent callers on one instance", but the chain serialises
`logAndFlush` callers **against each other only** — not against the other `AuditTrail.flush()` callers
(`AuditTrailService.ts:290` interval, `:123`, `:590`, `:636`, `:647`; `archiving/runs:178`, `:187`,
`:203`; the entitlements and invites routes; `redemptionDeps.ts:92`). Same row loss, different
concurrent party. Not fixable without touching `AuditTrailService` (D-4 holds). **Scope the header's
claim and add a section 10 risk row.**

### C-4 (Medium) — `SETTINGS_SECURITY_UPDATED`'s writer is unreachable, so three texts are wrong

`SecurityTab` **is** rendered (`app/(protected)/settings/page.tsx:313`), but
`handleSecuritySettingsSave` (`SecurityTab.tsx:50`) has **zero references**. Three texts assert a live
caller: `requestSchemas.ts:176`'s comment, `passwordChangeSeverity.guard.test.ts`'s last test **name**,
and `stepZeroRegistrations.test.ts`'s provenance note. Keep the event on the allow-list — SA's
conclusion stands, its reason does not.

### C-5 (Medium) — the operator register is missing its row

Add one row to `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` section *"What is NOT true, stated
plainly"* (`:83`) recording that the six inline handlers record nothing on refusal, so
`action = SECURITY_UNAUTHORIZED_ACCESS` covers the three shared surfaces only, and that closing it is
parked slice 4. This was its own acceptance-criteria line, is **not** part of the descoped tile, and
that file is the register CLAUDE.md points operators at.

### E-1 (Low, both reviewers) — the slice's own event has no named rejection case

Add `SECURITY_UNAUTHORIZED_ACCESS` to the CR-1 `it.each` at
`app/api/audit/__tests__/auditRoutes.test.ts:214-221`. One line, and it turns acceptance criterion 4
from an inference off the allow-list into a test.

### Optional — delete `LOGOUT_FLUSH_TIMEOUT_MS`

`clientAuditWrite.ts:51`. Zero consumers repo-wide, tests included. Keeping it as an alias is
defensible as public surface; SA would delete it. Dev's call.

---

### Dev fix pass — 2026-10-02

Branch `feature/record-refused-admin-access`. **Nothing committed** (standing user preference). No
source behaviour changed: the only non-comment edits are in test files and two docs.

| Item | Resolution |
|---|---|
| **High** — `auditAdminGate.test.ts` | ✅ Fixed as SA and QA both suggested. The `describe.each` tuple gained a third element, `tablesTouchedOnRefusal`: `['audit_trail']` for the one route on `requireAdmin`, `[]` for the two hand-rolled ones, asserted with `toEqual`. **Equality, not a filter**, so a pre-gate `select` on `audit_trail` now fails on the *gated* route too (it shows up as a second entry) — which the originally-suggested `toEqual(['audit_trail'])` gets for free. The comment at the site says why the filter was unsafe, so the next reader does not re-introduce it. |
| **High, second half** — `route.validation.test.ts:4-6` | ✅ Reworded. The header now states what each path asserts: strict zero on 401 and admin-check-throws, exactly `['audit_trail']` on the 403, and that a pre-gate read of this route's own protected table still fails there as a second entry. |
| **QA bug 2** — `adminGate.writes.test.ts` | ✅ Fixed. `touchedBesidesAudit()` **deleted** (its only consumer was the 403 case) and the assertion is now `expect(mockTablesTouched).toEqual(['audit_trail'])`, replacing a filter plus a `toContain` that bounded neither count nor direction. The comment names the live case: `archiving/runs#POST` reaches `ArchiveRepository`, which reads `audit_trail` platform-wide and cross-account (`ArchiveRepository.ts:51`, `:106-141`). The file's own header claim ("`mockTablesTouched` must be empty on every denial") was scoped to match. |
| **C-2** | ✅ Header corrected. It now distinguishes the two callers: the first caller's entry **is** queued when it times out; the second caller's `log()` has not run, so nothing is queued and the batch timer cannot help. |
| **C-3** | ✅ Header scoped, with a new `── SCOPE of the fix, stated exactly ──` block naming every other `flush()` caller by file and line and saying plainly that the same row loss is still reachable through them. Plus one section 10 risk row. |
| **C-4** | ✅ All three texts reworded: the allow-list comment (`requestSchemas.ts`), the guard test's name (now *"unreachable writer, decision not taken"*) with a comment giving the real reason, and the `stepZeroRegistrations.test.ts` provenance (`'settings/SecurityTab (V1), unreachable'`). The event **stays** on `CLIENT_WRITABLE_EVENTS` — the conclusion was never in doubt. |
| **C-5** | ✅ One row added to *"What is NOT true, stated plainly"*, naming the three recorded surfaces and the six that record nothing, plus the anonymous and check-threw exclusions, and that closing it is parked slice 4. The doc's `Last Updated` and Change History moved with it. |
| **E-1** | ✅ `SECURITY_UNAUTHORIZED_ACCESS` added to the CR-1 `it.each`. It runs twice (once per write URL) and both pass. |
| **QA E-2** (record only) | ✅ Recorded in section 8 with file and line (`monitoring/page.tsx:290-292` message, `:1035`/`:1039` the 40 % score), named as the same defect class T3 removed, and marked a product decision. **Severity deliberately unchanged.** |
| **Also recorded, not fixed** | `USER_PASSWORD_CHANGE_FAILED` unregistered; the per-IP rate limit owed; `evaluateHealth.ts:688`'s footnote true on deploy and contradicted for ≤ 7 days by pre-deploy rows. All three in section 8. |
| **Optional** | **Deleted.** `LOGOUT_FLUSH_TIMEOUT_MS` had zero consumers outside its own file — including tests, and including `main` before the extraction, where its three uses were all internal. "Public export" was true of the declaration and of nothing else, so the alias only bought a second name for one budget. A comment at the old site records the deletion and that the logout bound is unchanged; the now-unused `AUDIT_FLUSH_TIMEOUT_MS` import went with it. |

**Nothing in either review turned out wrong in the code.** Every line reference in both checked out:
the three `audit_trail` reads, the two hand-rolled gates, `ArchiveRepository`'s cross-account read,
`handleSecuritySettingsSave`'s zero references next to a rendered `SecurityTab`, the other `flush()`
callers, and the monitoring page's banner and 40 % score. Two things worth adding:

1. **The old filter's blind spot is now measured, not argued.** With a pre-gate
   `supabase.from('audit_trail').select('id')` temporarily added to
   `users/[id]/audit-logs/route.ts` (reverted; the file is untouched in the diff), the **old** filter
   let the 403 case **pass** — only the unrelated admin-check-threw case, which stayed at strict zero,
   went red. So an unconditional pre-gate read was caught by accident, and a read that happened **only
   on the authenticated non-admin path** would have been missed entirely. The new equality assertion
   fails that mutation on the 403 case itself.
2. **The one place SA's brief was not reproducible** is the paste-ready block: it is not in this file
   and not anywhere in the repo. See the provenance note above.

## QA Testing Report

**QA — 2026-10-02**
**Test mode:** full
**Strategy used:** A (Jest unit) + B (integration-style, mocked PostgREST) + static verification of the
row against the live DDL and RLS policy, plus one standalone concurrency proof run outside the repo.
Option D (manual browser) was **not** run: no signed-in non-admin session and no permission to write
to the production `audit_trail`. Option C was not needed.
**Focus:** security (the five weakened tests, the row shape, what must not be recorded), api, schema
**Skipped:** the nine §6 manual checks (prod data — owed to the user); `npm run lint` (the sandbox
denied the eslint invocation, see "Could not verify")
**Input source:** QA brief keywords + this workplan's §6 verification plan
**Nothing was modified.** No source, test or config file was touched; the one intended mutation test
(reverting the M-1 chain in place) was denied by the sandbox and was replaced with an equivalent
out-of-repo proof.

### Test Coverage

| Acceptance criterion (requirement §7 / §7 of this plan) | Tested? | Result | Notes |
|---|---|---|---|
| One row per refused request, surviving an immediate return | ✅ | Pass | `requireAdminRoute.test.ts`, `requireAdminPage.test.ts`, `route-identity.test.ts`: exactly one `log` + one `flush`, awaited before the 403 / `redirect()`. Verified independently that each gate is called **once per request**: `requireAdminPage()` is invoked in exactly one place (`app/admin/layout.tsx:40` — the pages only mention it in comments), and the four-call route files are four HTTP methods, not four calls. |
| Held under concurrency (M-1) | ✅ | Pass | Re-proved independently, see "The M-1 proof, re-run" below. |
| An audit failure never turns a 403 into a 500, never grants access | ✅ | Pass | Rejecting **and** hanging flush tested at all three sites; 403 / redirect unchanged, ~2 s bound observed. Corroborated accidentally by `agent-executions/stats/auth.test.ts`, where the real `AuditTrailService` hit `insert is not a function` against that file's mock and the route still answered 403. |
| No row carries an email, token or request body | ✅ | Pass | `details` is a closed set; `toEqual({surface, reason})` by default; `JSON.stringify(entry)` asserted free of `@` and `bearer`; no `request` key, so `session_id` stays null. |
| A browser POST of `SECURITY_UNAUTHORIZED_ACCESS` is rejected | ⚠️ | Partial | Structurally true (the event is not on `CLIENT_WRITABLE_EVENTS`, pinned by the "exactly the 9 events" equality test) but **no case names it**. §7 of this plan says "the rejection shape is extended to name it"; the new 400 case names `USER_PASSWORD_CHANGED` instead. See Edge case E-1. |
| A browser POST of `USER_PASSWORD_CHANGED` is rejected with 400 | ✅ | Pass | New `it.each(WRITE_URLS)` case, both write URLs, 400 + nothing written. |
| A refusal caused by the check **throwing** produces no row | ✅ | Pass | Both gates: `auditLog` not called, still 403 / redirect. `route-identity` returns above the branch, and its test pins zero rows on the thrown path too. |
| An anonymous caller produces no row | ✅ | Pass | 401 route path, anonymous page path and the auth-lookup-threw path all assert zero. |
| `user_id` = `actor_id` = the refused caller, never `SYSTEM_ADMIN_USER_ID`, never the act-as target | ✅ | Pass | Asserted at all three sites. `userId` is a required non-null parameter, so `buildLogEntry`'s `SYSTEM_ADMIN_USER_ID` fallback (`AuditTrailService.ts:145-148`) is unreachable from this writer. |
| An act-as refusal does not surface in the **target's** audit view | ✅ | Pass | Row `user_id` = caller; the owner-facing policy is `auth.uid() = user_id AND entity_type IS DISTINCT FROM 'ai_action'` (`supabase/migrations/20260930_audit_trail_owner_policy_hides_ai_actions.sql:74-75`), so the target cannot read it and an admin filtering by the target's account does not see it. The target's id appears only in `details.requestedUserId` — a value the caller themselves supplied. |
| `details.surface` ∈ `admin_api` \| `admin_page` \| `act_as` | ✅ | Pass | `REFUSED_SURFACES` pinned as an exact ordered list; each surface asserted verbatim at its call site. |
| `ip_address` / `user_agent` present only when readable | ✅ | Pass | Omitted (not `'unknown'`) when absent; `headers()` read inside try/catch and proven not to throw outside a request scope. The act-as site derives both from the `NextRequest` it holds and never passes it on. |
| Both lowered events stay `warning`, keep `['SOC2','GDPR']`, future writes only | ✅ | Pass | `passwordChangeSeverity.guard.test.ts` pins severity, flags, catalogue membership, a CHECK-accepted value, and — comment-stripped, per `auditLog` call — that **no writer overrides severity or flags**. `stepZeroRegistrations.test.ts` moved with its premise documented in the file. |
| The `critical` → browser-mintable hole is closed | ✅ | Pass | `USER_PASSWORD_CHANGED` off `CLIENT_WRITABLE_EVENTS`; allow-list equality test down to 9; 400 case added; the route's `severity` **and** `complianceFlags` both deleted, so the registration is the single owner and future rows gain GDPR. |
| `Admin authz surface guard` green, caps unmoved | ✅ | Pass | Green in both of my runs; `CAPS.R1.parked` / `R2.parked` still 6 (file untouched). |
| The tile, its footnote, the failed-logins label, the docs | — | Descoped | §0. Not tested; nothing on screen changed. |

### Issues Found

#### Bugs (should fix before commit — both are test-only edits, neither affects shipped behaviour)

1. **`auditAdminGate.test.ts`'s weakening is wider than the write it accommodates** — the filter
   `mockTablesRead.filter(t => t !== 'audit_trail')` is applied to all **three** routes in the
   `describe.each`, but only `/api/admin/audit-trail` uses `requireAdmin` and therefore writes a
   refusal row. The other two (`users/[id]/audit-logs`, `users/[id]/login-stats`) are hand-rolled
   gates (`AdminAccessService` inline at `route.ts:32-39` in both) that write **nothing** — and
   `audit_trail` is precisely the protected data they read. For those two the filter is pure loss of
   coverage with no gain: a regression that read `audit_trail` before the admin check would now pass.
   — File: `app/api/admin/__tests__/auditAdminGate.test.ts` — Severity: **Medium**
   - Expected: the filter applies only where a refusal row is actually written.
   - Actual: it applies to all three, including the two routes whose protected table it hides.
   - Suggested fix: key off the route (the `describe.each` tuple already carries the name), or assert
     `toEqual(['audit_trail'])` for the gated route and keep strict `toHaveLength(0)` for the two
     inline ones. Note that `route.validation.test.ts` covers the same gated route method-aware
     (`readBuilderCalls()`), so the loss is only on the two hand-rolled routes — which is exactly
     where nothing else covers it.

2. **`adminGate.writes.test.ts` is looser than it needs to be, and the blind spot is not
   hypothetical** — `touchedBesidesAudit()` discards **every** `audit_trail` touch and the positive
   assertion is only `toContain`, so neither the count nor the direction is bounded. Among the 59
   cases, `POST /api/admin/archiving/runs` reaches `ArchiveRepository`, which reads `audit_trail`
   platform-wide and cross-account (`ArchiveRepository.ts:51`, `:106-141`) — so "did this handler
   touch `audit_trail` before the gate?" is a live question for it and the test can no longer answer.
   — File: `app/api/admin/__tests__/adminGate.writes.test.ts` — Severity: **Low–Medium**
   - Suggested fix: one line — `expect(mockTablesTouched).toEqual(['audit_trail'])`, which pins the
     recording *and* keeps the original strictness. Measured as achievable: the sibling
     `agent-executions/stats/auth.test.ts` already asserts exactly that shape
     (`from.mock.calls.map(([t]) => t)).toEqual(['audit_trail'])`) and passes, so one refusal is
     exactly one `from('audit_trail')`.

   The other three weakenings are **as loose as they need to be and no looser** — see the assessment
   below. No High severity bug was found, and no behavioural bug was found in the shipped code.

#### Performance / operational (record, do not necessarily fix)

1. **A failed INSERT is invisible to the caller.** `AuditTrailService` is constructed with
   `silent: true` and `flush()` routes its own errors through `handleError`, which logs and does not
   rethrow (`AuditTrailService.ts:263`, `:574-583`). So `logAndFlush` resolves "successfully" when the
   insert failed, and the only trace is the service's own `Failed to flush audit logs` line. Not
   introduced here and not fixable without touching the service (D-4), but it means **no automated
   test in this repo can prove a row lands** — §6 manual checks 1, 2, 4 and 9 are the only proof, and
   they are still owed.
2. **Burst tail.** The serialising chain is per instance, so N concurrent refusals perform N
   serialised inserts under one 2 s budget *each from its own start*. Beyond roughly 40–80 concurrent
   refusals on one instance the tail callers time out (warned), and their rows then depend on the
   instance surviving long enough for the chain to drain. Strictly better than the pre-fix silent loss
   and consistent with the accepted M-5 amplification risk; worth one line in §10 because it bounds
   what "every refusal is recorded" means under a probe.
3. **New module-load dependency on the admin surface.** `requireAdminRoute` / `requireAdminPage` now
   transitively import the `AuditTrail` singleton, which is constructed at module scope with
   `SUPABASE_SERVICE_ROLE_KEY` (`AuditTrailService.ts:63-66`, `:595`). In an environment where that
   variable is absent, importing the gate throws at load and the admin surface answers 500 instead of
   403. Both variables exist in prod and no admin route runs on the edge runtime (checked), so this is
   a note, not a defect.

#### Edge cases (nice to fix)

1. **E-1 — AC-4 is not pinned by name.** Add `[{ ...valid, action: 'SECURITY_UNAUTHORIZED_ACCESS' }]`
   to the CR-1 `it.each` at `app/api/audit/__tests__/auditRoutes.test.ts:214-221`. One line, and it
   makes the requirement's fourth criterion a test rather than an inference from the allow-list.
2. **E-2 — the customer's own monitoring page now alarms at a refusal.** The event stays `critical`
   by design, the row's `user_id` is the refused caller, and the owner policy lets that caller read
   their own rows — and `app/(protected)/monitoring/page.tsx:290-292` renders *"N critical security
   event(s) detected. Immediate review recommended."* with the security score dropping to 40 %. So a
   signed-in non-admin who opens `/admin` once sees a critical-incident banner about themselves: the
   same defect class T3 removes for password changes, arriving by the same route. Checked for an
   automatic trigger and found none — the only client-side admin probe
   (`AdminCalibrationTrigger.tsx:63` → `/api/admin/agents`) hits one of the six hand-rolled handlers,
   which writes no row, and that component only renders on `/test-plugins-v2`. A product decision for
   the user, not a code bug; it belongs in §8 next to the rest of the monitoring-page story.
3. **E-3 — `searchInjection.qa.test.ts` inspects the URL only.** The hostile term is proven absent
   from `r.url.href`; the POST **body** is not inspected. Harmless today (`details` is a closed key
   set that cannot contain a query), but a future `details.query` would be invisible to this test.
4. **E-4 — `SecurityTab.tsx` still sends `userId` in the body** after the `x-user-id` header was
   dropped (SA's optimisation suggestion). Same legacy, equally ignored channel; dropping both would
   be consistent. Confirmed while there that `handleSecuritySettingsSave` is declared once at `:50`
   and referenced nowhere — §9b finding 5 is correct, `SETTINGS_SECURITY_UPDATED` has no reachable
   writer.

### The five weakened tests — independent assessment

This was the brief's main ask. Verdict: **three are fine or stronger, two should be tightened**
(bugs 1 and 2 above). What I checked in each case was whether the test would still fail if a handler
started reading the database before the gate, and whether the 401 / check-threw assertions stayed at
strict zero.

| Suite | Weakened to | Still catches a pre-gate read? | Verdict |
|---|---|---|---|
| `adminGate.writes.test.ts` (59 handlers × 1 case) | table-name filter + `toContain` | Yes for every table except `audit_trail` — and one of the 59 handlers genuinely reads `audit_trail` | **Tighten** (bug 2). 3 of the 4 denial cases remain strict `[]` — verified at `:352-394`. |
| `auditAdminGate.test.ts` | table-name filter, all three routes | No, for the two hand-rolled routes whose protected table *is* `audit_trail` | **Tighten** (bug 1). 401 and check-threw remain strict `toHaveLength(0)`. |
| `audit-trail/route.validation.test.ts` (2 cases) | `protectedTablesRead()` **and** `readBuilderCalls()` (method ≠ `insert`) | Yes — a `select` on `audit_trail` still fails `readBuilderCalls()` | **As loose as it needs to be.** Method-aware, so the one table it must allow is allowed only for the one verb that writes. 9 other assertions in the file stay at strict zero, including the 401 (`:192-248`). |
| `users/searchInjection.qa.test.ts` | exactly 1 request, POST, `/rest/v1/audit_trail`, no URL carrying the term | Yes, and more than before: it is now a two-way pin (a second request fails it, *and* a missing audit write fails it) | **Stronger than what it replaced.** Only gap is E-3 (body not inspected). |
| `agent-executions/stats/auth.test.ts` | `from` calls `toEqual(['audit_trail'])` + not `agent_executions` | Yes — exact list, so any extra table or extra touch fails | **Model of how to do this.** This is the shape the other two should adopt. |

The security cost of the feature is therefore real but small and confined to two assertions, both
fixable in one line each, and the `401` / `auth-lookup-threw` / `admin-check-threw` paths are at
strict zero in all five files — which is the part that still protects the OQ-3 behaviour.

### The M-1 proof, re-run

The in-repo mutation (revert the chain, watch the test go red) was **denied by the sandbox** — writing
to `lib/audit/boundedAuditFlush.ts` was blocked, and I did not work around it. The file was verified
untouched afterwards (`sha256 c7ea516e…`, unchanged before and after).

Instead the mechanism was re-proved out of repo, in a standalone Node script that reimplements (a) the
service's real `flush()` early return and queue-clear-before-insert, (b) the shipped `enqueue` copied
from the file, and (c) the pre-fix `enqueue` it replaced, then runs the decisive scenario — B arriving
while A's insert is in flight:

```
shipped (serialising chain)
  written = ["a","b"]      queue left = []     logAndFlush said = ["ok","ok"]   -> both rows land
pre-fix (no chain)
  written = ["a"]          queue left = ["b"]  logAndFlush said = ["ok","ok"]   -> ROW LOST
```

So the bug is real, the fix removes it, and — the part worth keeping — the pre-fix version **reports
success while losing the row**, which is why nothing would have noticed. Dev's own test asserts the
same scenario against the same faithful fake and passes. What this does **not** prove is the live
deployment: §6 check 9 (two concurrent refused `/api/admin/*` calls → two rows) is still owed.

### Dev's numbers, re-measured

| Claim | My measurement | Verdict |
|---|---|---|
| Directly-affected suites green | `lib/audit` + `app/api/audit`: **11 suites / 202 tests pass**. `lib/admin` + `lib/server/route-identity` + the four weakened admin suites + health: **19 suites / 904 tests pass**. | Confirmed (more than the claimed 15 / 366, because I widened the selection) |
| `Admin authz surface guard` green, `CAPS` 6 | Green in both runs; the guard file is untouched, so the caps cannot have moved | Confirmed |
| Full suite: 27 failed / 8 skipped / 697 passed of 732 | **27 failed / 8 skipped / 697 passed of 732**; tests **146 failed / 64 skipped / 12858 passed**; 175 s | Confirmed exactly |
| Zero regressions, same 27 red suites as `main` | All 27 are outside the touched area (V6 / pilot / website-builder / orchestration / business-os / featureFlags). The two audit-adjacent ones were read verbatim: `chat-v4/route.audit.test.ts` dies at load inside its own fixture (`Error: profile read failed for OWNER-TEXT-MARKER-c1 cancel`), and `cron/runRecord.adoption.test.ts` fails one `payment-reminders` case with `Expected: 200 Received: 500` — neither path imports a changed module in a way this diff could affect. **I did not run a stashed baseline myself** (deliberately: I was told not to modify the tree), so "the same 27 **by name**" is inferred from their content and from the matching count, not measured against `main` by me. | Consistent; the by-name identity is Dev's measurement, not mine |
| Three suites fail only under load | `business-os-invites/page.render`, `InviteFriendsSection.render` and `jobs-queues/qa-slice5-pr2.route` all **PASS** in my full run | Confirmed not ours |
| Scoped `tsc`: 0 errors in the touched files, 42 total | **42 errors, 0 in any of the 24 touched files**, distribution identical to Dev's: 24 `LanguageContext.tsx`, 6 `lib/analytics/aiAnalytics.ts`, 4 `MemorySummarizer.ts`, 4 `lib/audit/admin-helpers.ts`, 2 `EmbeddingService.ts`, 1 `MemoryConsolidationScheduler.ts`, 1 `ais-helpers.ts` — all untouched transitive imports | Confirmed, via my own throwaway scoped config (the full-project `tsc` OOM trap avoided) |
| `npm run test:bos-entitlements`: 97 / 2022 | **97 suites / 2022 tests pass** | Confirmed |
| eslint 0 errors | **Not verified** — the sandbox denied the eslint invocation | Unverified |

Row shape also checked against the live DDL rather than the code's intent: `audit_trail.entity_type`
is `NOT NULL` with no CHECK (so `'system'` inserts), `entity_id` and `user_id` are nullable,
`user_id` is an FK to `auth.users` (satisfied — the refused caller is a real account),
`severity CHECK IN ('info','warning','critical')` accepts both `'critical'` and the two dropped to
`'warning'`, and no migration adds a trigger, a NOT NULL or a constraint to the table. The insert runs
through the service-role client, so RLS cannot block it.

### Could not verify, and why

- **That a row actually lands in the database.** Everything here mocks PostgREST, and the service
  swallows insert failures (operational finding 1). §6 manual checks 1–4 and 9 remain the only proof,
  and QA will not write to production data.
- **Timing in a real serverless instance** — the 2 s bound, the freeze-before-flush premise and the
  concurrency behaviour are all proven against fakes.
- **`npm run lint` / `npx eslint`** — denied by the sandbox. Dev's "0 errors, 12 pre-existing
  warnings" is unchecked.
- **A stashed `main` baseline** of the full suite — not run, to avoid mutating an uncommitted tree
  that a concurrent SA review is reading.
- **The browser-level behaviour** of the monitoring-page consequence (E-2): read from the source, not
  seen on screen.

### Final Status

- [x] Issues found — Dev should address before commit: **bugs 1 and 2** (two one-line test
      tightenings; no shipped code changes), and ideally **E-1** (one line). None is High; nothing
      found in the shipped behaviour of the three gates, the writer, the flush or the severity drop.
- [ ] All acceptance criteria pass — ready for commit *(blocked only on the two test tightenings and
      on the user's §6 manual checks 1, 2, 3, 4, 8 and 9, which are the only evidence a row lands)*

## Commit Info

*RM to populate.*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-01 | Created | Dev workplan for Option B, carrying every SA ruling; adds the user's `USER_PASSWORD_CHANGED` / `SETTINGS_SECURITY_UPDATED` severity drop (decided 2026-10-01) and raises D-1 to D-7. |
| 2026-10-01 | Scope cut by the user | "Recording a refused admin access" only. T1 + T3 + D-3 + T4 built; T2, T5, T6, T7, T8, T9 descoped (§0). The tile was implemented and then reverted, which also makes M-2's fixture half and M-3 moot. M-1, M-4 and M-5 all stand and are built. |
| 2026-10-01 | Dev revision after SA review | Patched for M-1 (serialising promise chain in `boundedAuditFlush.ts`, §3.1), M-2 (six more files in §4, refusal cases moved into the two existing gate test files, a THIRD inline `evaluateHealth` literal found at `buildJobsQueuesView.test.ts:303`), M-3 (footnote-bites claim dropped), M-4 (page-gate timing qualifier), M-5 (403 compute amplification in §10); D-1's four conditions; D-3 added as T3b; finding 1 corrected to delete both override keys; T5 folded into T6; index wording softened. |
| 2026-10-02 | QA testing report | Full pass on the reduced scope. Dev's numbers re-measured and confirmed (full suite 27/8/697 of 732, scoped `tsc` 0 errors in 24 touched files, entitlements 97/2022, guard green with caps at 6); M-1 re-proved out of repo after the in-place mutation was sandbox-denied. Two test-only bugs raised against the weakened security assertions (`auditAdminGate` filter too wide for the two hand-rolled routes; `adminGate.writes` should assert `toEqual(['audit_trail'])`), plus four edge cases incl. the customer monitoring page now alarming at a refusal. Lint and the nine manual checks not verified. |
| 2026-10-01 | SA workplan review | Revision required. D-1 to D-7 ruled (D-1 option (a) with four conditions; D-3 approved as its own commit); all four severity-drop findings confirmed, finding 1 corrected to delete BOTH override keys; five required changes M-1 (concurrent flush loses rows) to M-5. Implement after patching — no second workplan review. |
| 2026-10-02 | SA code review + Dev fix pass | SA: needs revision, 1 High / 3 Medium / 2 Low, **no source change required**. Transcribed into a new SA Code Review Notes section (SA's paste-ready block was never appended and is not in the repo — provenance noted there). Dev fixed all of it: the two weakened security assertions tightened to exact-list equality (`auditAdminGate` keys off the route, `adminGate.writes` drops `touchedBesidesAudit()`), `route.validation.test.ts`'s header claim moved with them, `boundedAuditFlush.ts`'s header scoped for C-2 + C-3 with five new section 10 risk rows, the three `SETTINGS_SECURITY_UPDATED` "live caller" texts reworded (C-4), one row added to `ADMIN_IDENTIFICATION_AND_ACCESS.md` (C-5), `SECURITY_UNAUTHORIZED_ACCESS` given its own 400 case (E-1), QA's E-2 and three other findings recorded in section 8, and `LOGOUT_FLUSH_TIMEOUT_MS` deleted. Nothing committed |
