# Requirement Amendment: Account Hard Delete from `/admin/users` (AU-1, AU-2)

> **Last Updated**: 2026-10-08

**Created by:** BA
**Date:** 2026-10-08
**Status:** SA-approved with conditions AU-C1…AU-C9 (2026-10-08, §7). User decisions AU-1 and AU-2 recorded (2026-10-08). The appendix splices are applied **after** SA review, insert-only.
**Amends:** [TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md](/docs/requirements/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md) (as on `origin/main`)
**Touches:** [ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md](/docs/requirements/ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md) (UD-1, UD-5, D14, OX-1 / OX-1r) · [BUSINESS_OS_BUSINESS_DATA_PURGE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_BUSINESS_DATA_PURGE_REQUIREMENT.md) (D3)

## Overview

The Danger Zone on `/test-business-os` can already remove a test account for good ("Remove a test account": check, then delete, then per-table report), through the admin routes `/api/admin/test-account-cleanup/{check,delete}`, which run the generated cleanup SQL (`public.operator_test_account_cleanup`, secret-gated) over the Production-only direct connection. The owner wants **the same delete on the admin Businesses page** (`/admin/users`), for **any account** an admin picks there, and wants the AD-1/AD-2 "Delete…" button (a preview only; the real purge is switched off) **hidden for now**. This is a UI slice. No server, route, SQL or database change.

---

## 1. User decisions (2026-10-08)

| # | Decision | Status |
|---|---|---|
| **AU-1** | On `/admin/users`, each business row (expanded) gets a danger section that runs the **same** hard delete as the Danger Zone "Remove a test account": the same secret-gated `public.operator_test_account_cleanup`, through the existing `/api/admin/test-account-cleanup/check` and `/delete` routes. It works for **any account**: the email is pre-filled from the row and **locked**, and the tag is pre-filled with **that same email**, so the email-contains-tag rule is always met. It removes **everything**, including money history (credits, charges, our invoices to the business) and the login, so **the email is freed** for a new sign-up | ✅ Decided by user |
| **AU-2** | The existing AD-1/AD-2 **"Delete…"** button on `/admin/users` (preview only, real purge off) is **hidden for now**. Its code, route and tests stay in place | ✅ Decided by user |

---

## 2. What this reverses or narrows

Stated plainly, so nobody reads the older decisions as still covering this page.

| Earlier decision | Before | After this amendment |
|---|---|---|
| **UD-1** (admin delete) | "Delete" closes the login; the **email is not reusable**; financial records kept | **Narrowed.** UD-1 now applies **only to the AD-2/AD-3 purge path**, which is inactive. The `/admin/users` hard delete (AU-1) **deletes the login and frees the email** |
| **UD-5** (admin delete) | Financial records kept unchanged after deletion | **Narrowed.** Applies **only to the AD-2/AD-3 purge path**. The AU-1 hard delete **removes** the account's money history (credits, charges, our invoices). Paying customers stay blocked in practice by the guards in §3 |
| **D14** (admin delete, partial purge D3 / FU-9) | On the admin surface the login is closed, never hard-deleted | **Narrowed** to the AD-2/AD-3 purge path. AU-1 is a separate path that hard-deletes `auth.users` under OX-1r |
| **D3** (purge) | `auth.users` and `profiles` are never deleted, at any level | **Unchanged for the purge engine.** The hard delete continues to live **outside** the purge engine, under OX-1r only |
| **OX-1r** (Danger Zone requirement, SA-7) | Operator-only hard delete of `auth.users` for accounts **whose email contains the test tag**, by pasted SQL or the admin-only `/api/admin/test-account-cleanup/*` routes | **Widened** to: "…for **test accounts, or any account an admin chooses on `/admin/users`**, subject to **every** guard of the generated SQL." Same routes, same SQL, same single caller path. Wording for SA to rule (§6, SQ-1) |
| **Danger Zone §10 Out of scope** | "Removing a real customer, or any account not matching the tag rule" is out of scope | **Reversed for `/admin/users` only.** The Danger Zone section itself keeps its free-text tag behaviour (BQ-2) |
| **AD-1 entry point** | "Delete…" button in the expanded row (FR-A1) | **Hidden** (AU-2). Preview route and code kept; un-hiding is a one-line change when AD-2 is ready |

---

## 3. Guards that still refuse (unchanged)

The pre-filled tag removes only the **tag rule** as a protection on this page. Every other guard in the generated SQL runs unchanged, in the check and again inside the delete transaction, with no override. Numbering is as in the generator on `origin/main` (G-1 … G-19), corrected by Dev 2026-10-09 to SA's list in §7 (AU-C8).

| Guard (by purpose) | Effect for a real customer |
|---|---|
| Email-contains-tag (G-2) | Always met on this page (tag = email). **Not a protection here** |
| Target is an admin (G-4) | Admins can never be removed, including the acting admin |
| Live Stripe **ever** (G-5: any live-mode Stripe customer, payment or subscription in the account's history) | **Any account that ever paid us in live mode is refused.** This is what keeps paying customers out in practice |
| Live or not-yet-ended platform plan subscription, test or live mode (G-6) | Refused until ended |
| Legacy Stripe ids (G-7: `user_subscriptions`, `credit_transactions`, `billing_events`; treated as real money) | Refused |
| Money in flight (G-9: pending payments or refunds, sent or overdue invoices, active client subscriptions) | Refused |
| Stripe Connect account or Stripe plugin connection (G-8) | Refused |
| Consent ledger rows (G-14) | Refused (consent evidence is not wiped by this tool) |
| Invite circle (G-15: the account invited others, or sits in an invite lineage that others depend on) | Refused |
| Other accounts in its organisation (G-13) | Refused |
| Shared agents imported by others (G-16) | Refused |
| Storage files remaining (G-12) | Cleared by the storage step first (SA-6), then re-checked |
| Catalog / unknown-reference checks (G-10, G-17, G-18) and the in-transaction survivor scan | Any unreviewed link or survivor rolls everything back |

**In practice:** an account that never had live money, has no Connect account, no consent records and no invite circle can be removed. A real paying customer cannot.

---

## 4. Open item (business, not blocking)

- [ ] **OI-AU-1 Legal retention of financial records for deleted customers is unverified.** This was UD-5's caveat. AU-1 deletes credits, charges and our invoices for accounts that never had live Stripe money (test-mode or free usage). The owner checks with the accountant or lawyer whether any of those records must be kept. (raised by: BA | status: pending user, owner to ask accountant/lawyer) **BA suggestion:** this does not block the slice, because the live-Stripe-ever guard keeps every account with real payments out. If the answer is "keep", the fix is to add the relevant tables to the kept set in the generator, not to change this page.

---

## 5. Scope for Dev (one UI slice, short path)

~1 day. UI-only short path: Dev → SA code review + QA in parallel → user sees the diff → RM.

1. **Reusable panel.** Make `components/business-os/purge/TestAccountCleanupPanel.tsx` reusable with a **locked mode**: props for a pre-filled email and tag that render read-only. The typed confirmation (FR-6) stays: the admin still types the email. The Danger Zone usage is unchanged.
2. **Mount it** in the expanded business row of `app/admin/users/page.tsx` (already admin-only via `requireAdminPage` in the admin layout), in a visually separated danger area, never in the collapsed row.
3. **Hide** the AD-1 "Delete…" entry point (AU-2). Code kept.
4. **After a CLEAN delete**, refresh the list or remove the row. A blocked or refused result leaves the row as is and shows the panel's normal report.
5. **Audit:** the same events as the Danger Zone (`BUSINESS_TEST_ACCOUNT_REMOVED` / `…_REMOVAL_REFUSED`), admin as actor. Depends on migration **20261047** (branch `feature/cleanup-panel-copy-button`) landing; until then the actor behaves as it does on the Danger Zone today. The source may distinguish the page if SA wants (SQ-5) without a server change only if the route already accepts it; otherwise it stays `admin_page`.
6. **No** server, route, SQL, migration or database change. No new CI step.

**Acceptance criteria**
- [ ] The expanded row shows the section; the email and tag are pre-filled from the row and cannot be edited.
- [ ] Check shows OK or BLOCKED with every guard, exactly as on the Danger Zone.
- [ ] A real customer with live Stripe history shows BLOCKED, and nothing is removed.
- [ ] An admin row shows BLOCKED (G-4).
- [ ] After a CLEAN delete the row disappears or the list refreshes, and the email can sign up again.
- [ ] The "Delete…" button is no longer visible; its code and tests remain.
- [ ] The Danger Zone "Remove a test account" behaves exactly as before.
- [ ] The page's source guard (no `lib/business-os` imports under `app/admin/users`) stays green.

---

## 6. Questions for SA

- [ ] **SQ-1 OX-1r wording.** Proposed: "operator-only hard delete of `auth.users`, for accounts whose email contains the test tag **or** an account chosen by an admin on `/admin/users`, run as pasted SQL or by the admin-only `/api/admin/test-account-cleanup/*` routes, all executing the same generated SQL over the direct Postgres connection, subject to every guard. No RPC beyond the secret-gated function, no other caller." (raised by: BA | status: open)
- [ ] **SQ-2 Tag pre-filled with the email**, versus making the admin type it. BA view: typing the email twice adds nothing, since the confirmation already requires typing it; pre-fill is acceptable **because** the typed confirmation stays. (raised by: BA | status: open)
- [ ] **SQ-3 Extra "this is a real customer" copy.** BA suggestion: one fixed warning line in locked mode ("This permanently removes a real account, its login and its money history. It cannot be undone."), no extra checkbox. (raised by: BA | status: open)
- [ ] **SQ-4 Page source guard.** The panel lives in `components/`; confirm the guard that forbids `lib/business-os` imports in `app/admin/users` is not tripped transitively, and that the panel itself imports nothing from `lib/business-os` that the guard or the entitlements registration would catch. (raised by: BA | status: open)
- [ ] **SQ-5 Audit source.** Keep `admin_page` for both surfaces, or distinguish `/admin/users`? Only if no route change is needed. (raised by: BA | status: open)

---

## 7. SA Review Notes

**Reviewed by SA — 2026-10-08** (against `origin/main`; the main checkout is stale)
**Status:** ✅ Approved with conditions AU-C1 … AU-C9

### Corrections to the BA text (read these over §Overview, §3 and SQ-1)

- **No direct connection.** `pg` / `SUPABASE_DB_URL` were removed by re-ruling R-7. The routes call the single secret-gated RPC `public.operator_test_account_cleanup` through `TestAccountCleanupRepository`. Read "over the Production-only direct connection" in the Overview and "over the direct Postgres connection" in SQ-1 as "through the secret-gated RPC".
- **Nothing new on the server.** The tag is free text (BQ-2), so an admin on the Danger Zone can already type the full email as the tag today. AU-1 adds no server capability; OX-1r is widened to match what the routes already permit, and the email lock is a UI convenience, not a control. The guards are the only safety, as before.
- **Guard ids (generator on `origin/main`, `guardRowsCte`):** G-1 exactly one login · G-2 email contains tag · G-3 typed confirmation (delete block only) · G-4 not an admin · **G-5 live Stripe ever** (live-mode rows in `business_os_billing_accounts`, `business_os_boost_purchases`, `business_os_billing_events`) · **G-6 live or not-ended plan subscription, test or live mode** · **G-7 legacy Stripe ids** (`user_subscriptions`, `credit_transactions`, `billing_events`; treated as real money) · **G-8 Stripe Connect / Stripe plugin connection** · **G-9 money in flight** · G-10 unreviewed or actor links to the login · G-11 schema drift · G-12 storage files · G-13 other accounts in its organisation · **G-14 consent ledger** · **G-15 invitation circle** · G-16 shared agents imported by others · G-17 unreviewed delete triggers · G-18 inbound links to removed tables · G-19 SET NULL into NOT NULL. §3's unnumbered rows are G-5, G-6, G-9, G-8, G-14, G-15; add G-7, G-13, G-16 (BA omitted them; all refuse a real customer).
- **G-2 with tag = email always passes:** both `cleanup.target_email` and `cleanup.test_tag` are `lower(btrim(...))` in `params`, so case differences in the row email cannot make it fail.

### Rulings

- **SQ-1 (OX-1r wording).** Use the R-7 sentence with one inserted clause: "OX-1r: operator-only hard delete of `auth.users` for accounts whose email contains the test tag, **or an account an admin chooses on `/admin/users` (tag = that email; every other guard applies)**, run either as pasted SQL or by the admin-only `/api/admin/test-account-cleanup/*` routes through the single secret-gated RPC `public.operator_test_account_cleanup`, both generated from the same builders. No other RPC, no other caller." The splices A.2, B.4 and C.1 must use this sentence.
- **SQ-2 (tag pre-fill).** Approved. G-3 (typed email) is the deliberate act; a second typing of the same string adds nothing.
- **SQ-3 (warning copy).** Approved as the user accepted: one fixed line in locked mode, no checkbox, no reason field. The locked-mode intro must not say "test account" or "the email must contain the tag".
- **SQ-4 (source guard).** Not tripped. `app/admin/users/__tests__/source.guard.test.ts` scans the direct imports of the files in `SCREEN_FILES` only; the page importing `@/components/business-os/purge/TestAccountCleanupPanel` is not a `lib/business-os` specifier. The panel's only `lib/business-os` import is `import type` from `cleanupApiTypes.ts`, which itself has no imports (pinned by the panel's own source guard) and is not under `entitlements/`, so no entitlements registration. Conditions AU-C3, AU-C4.
- **SQ-5 (audit source).** Keep `admin_page` for both surfaces. Both body schemas are `.strict()` and the success row's source is set by the route via settings and written inside the function, so a distinct value needs a schema + route change, which is out of scope for a UI slice. Nothing rides 20261047 for this slice; the slice does not depend on 20261047 landing (actor behaves as on the Danger Zone until it does).

### Scope confirmations

- **UI-only.** No new route, no route change, no schema, no generator, no migration (beyond 20261047, which is independent).
- **Admin authz census / `adminGate.writes`:** no change. No route added or touched; the three cleanup handlers are already counted.
- **`no-deletion-paths` guard:** no change, provided AU-C4.
- **Hiding Delete… (AU-2) vs AD-1/AD-2 tests.** `deleteBusinessDialog.render.test.tsx` renders the dialog directly, and the preview/commit route tests do not touch the page, so both are unaffected. The page source guard ("the page opens it from the expanded row only…") requires exactly one `<DeleteBusinessDialog`, `data-testid="delete-business-open"` after `data-testid="danger-area"`, and the `onDeleted={() => { void fetchUsers(); }}` shape. Hiding by a module-level constant (AU-C5) keeps all of that true with no test edits; deleting the JSX would turn it red.

### Conditions for Dev

- **AU-C1** Locked mode by **optional** props on `TestAccountCleanupPanel` (e.g. `lockedEmail`, `onRemoved`). With no props the Danger Zone render is byte-for-byte unchanged and `TestAccountCleanupPanel.render.test.tsx` passes **unmodified**. Locked mode: email and tag read-only (tag = email), the typed confirmation stays, the fixed warning line, no empty-tag hint.
- **AU-C2** Mount inside `data-testid="danger-area"` in the expanded row only, `key={user.id}` so state never carries between rows, and only when the row has an email. After a `CLEAN` result call `onRemoved` → `void fetchUsers()`; any other result leaves the row.
- **AU-C3** The page imports the panel only, never `cleanupApiTypes` or anything else under `lib/business-os`. Any new file under `app/admin/users` goes into `SCREEN_FILES`.
- **AU-C4** Do not write `operator_test_account_cleanup` anywhere in the page or panel (code or comments).
- **AU-C5** Hide Delete… with `const SHOW_AD1_DELETE_ENTRY = false` gating the button and the dialog; replace the danger-area paragraph (it describes the preview). Add a source-guard assertion that the constant is `false` and that `<TestAccountCleanupPanel` sits after `danger-area`.
- **AU-C6** Render tests for locked mode: inputs read-only and pre-filled, warning line present, check body carries `{ email, tag: email }`, `onRemoved` fires on `CLEAN` only.
- **AU-C7** No `console.*` (both files are clean today; the panel's one hit is a comment).
- **AU-C8** Correct §3 with the guard ids above when applying the splices.
- **AU-C9** Splices A–C (with the SQ-1 sentence) plus one runbook line are applied by Dev on the feature branch from `origin/main` (see below), insert-only, with `git diff --stat` showing zero deletions.

### Splices: not applied by SA

The main checkout's copies of all three target docs are stale against `origin/main` (Danger Zone 254 vs 278 lines, admin delete 399 vs 419, purge 1234 vs 1263), so splicing them here would not be insert-only against `origin/main`. Dev applies them on the slice branch, with these anchor fixes:
- **A.2** anchors on §12 **R-7** (the current OX-1r), not SA-7 (superseded); add as a new bullet after R-7.
- **B.4** and **C.1** anchor on the OX-1r **table rows** (admin delete §3 and §9.1; purge §9 after the OX-1r row next to D3). Insert as a table row (e.g. `**OX-1r (AU-1)**`), not a blockquote, or the table breaks.
- **Runbook** (`docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md`): one sentence after the Overview's OX-1r paragraph ("`/admin/users` hosts the same panel, email locked, tag = email, AU-1"), plus a Change History row. Note it also corrects "it is not the admin delete … never frees the email": that remains true of AD-2/AD-3 only. No generator header edit (it feeds the drift test).

### Approval
[x] Requirement approved with conditions AU-C1 … AU-C9. Short path: Dev → SA code review + QA in parallel → user diff → RM.

**Code Review by SA — 2026-10-09: ✅ Code Approved for QA.** AU-C1…AU-C9 met. No-props render test unmodified, and the no-props behaviour is unchanged. Locked mode sends only the row email as email and tag (state is seeded once, inputs are `readOnly` with guarded `onChange`, `key={user.id}`), and the typed confirmation is still required. No server or DB change, authz census untouched. The page imports only the panel, and the function name appears in neither file. Splices insert-only (0 deletions), no `console.*`. 14 suites / 357 tests green. **AU-C2 deviation (Done / unmount) accepted:** it still fires only after CLEAN, at most once (the ref is cleared before the call), and the closure carries no row id. The deviation does not change the condition's intent, which is that the row leaves after CLEAN and never otherwise. Low, optional: the `onLog` success text still says "Test account removed" (unused on this page).

---

## Appendix: splice text (insert-only, apply after SA review)

### A. `TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md`

**A.1 — after §10 Out of scope, first bullet, add:**

> - *Amended 2026-10-08 (AU-1):* on `/admin/users` only, an admin may run this same delete on **any account**, with the email locked and the tag pre-filled to that email. All guards still apply. See [TEST_ACCOUNT_CLEANUP_ADMIN_USERS_AMENDMENT.md](/docs/requirements/TEST_ACCOUNT_CLEANUP_ADMIN_USERS_AMENDMENT.md).

**A.2 — §12 SA-7, after the OX-1r sentence, add:**

> *Widened 2026-10-08 (AU-1, SA-ruled wording per the amendment's SQ-1):* OX-1r also covers an account an admin chooses on `/admin/users`, subject to every guard. Same routes, same SQL.

**A.3 — Change History row:**

> | 2026-10-08 | AU-1 / AU-2 amendment | Same hard delete mounted on `/admin/users` for any account (email locked, tag = email); OX-1r widened; AD-1 Delete… hidden. See TEST_ACCOUNT_CLEANUP_ADMIN_USERS_AMENDMENT.md |

### B. `ADMIN_DELETE_USER_BUSINESS_REQUIREMENT.md`

**B.1 — §9.1, after the UD-1 row, add:**

> | **UD-1a** | Scope of UD-1 after AU-1 | **UD-1 applies only to the AD-2/AD-3 purge path (inactive).** The `/admin/users` hard delete (AU-1, OX-1r) deletes the login and frees the email. See TEST_ACCOUNT_CLEANUP_ADMIN_USERS_AMENDMENT.md | ✅ Decided by user 2026-10-08 |

**B.2 — §9.1, after the UD-5 row, add:**

> | **UD-5a** | Scope of UD-5 after AU-1 | **UD-5 applies only to the AD-2/AD-3 purge path.** The AU-1 hard delete removes money history for accounts the guards allow (never any live Stripe money). Legal retention still unverified (OI-AU-1, owner to ask accountant/lawyer) | ✅ Decided by user 2026-10-08 |

**B.3 — §3, after the D14 row, add:**

> | **D14a** | D14 scope | D14 (login closed, never hard-deleted) governs the AD-2/AD-3 purge path only. The separate OX-1r hard delete on `/admin/users` (AU-1) is not bound by it | ✅ User 2026-10-08 |

**B.4 — next to the OX-1 / OX-1r note, add:**

> *2026-10-08:* OX-1r widened to "test accounts, or any account an admin chooses on `/admin/users`, subject to every guard" (AU-1).

**B.5 — §6.1, after FR-A1, add:**

> - *2026-10-08 (AU-2):* the **Delete…** entry point is **hidden** on `/admin/users`. Code, route and tests are kept; it returns when AD-2 is activated.

**B.6 — Change History row:**

> | 2026-10-08 | AU-1 / AU-2 | UD-1, UD-5 and D14 narrowed to the inactive AD-2/AD-3 path; OX-1r widened; Delete… hidden. See TEST_ACCOUNT_CLEANUP_ADMIN_USERS_AMENDMENT.md |

### C. `BUSINESS_OS_BUSINESS_DATA_PURGE_REQUIREMENT.md`

**C.1 — §9, next to D3 (after the existing OX-1r splice), add:**

> *2026-10-08 (AU-1):* D3 is unchanged for the purge engine. The OX-1r hard delete, outside this engine, now also covers any account an admin chooses on `/admin/users`, subject to every guard of the generated cleanup SQL. See TEST_ACCOUNT_CLEANUP_ADMIN_USERS_AMENDMENT.md.

**C.2 — Change History row:**

> | 2026-10-08 | OX-1r widened (AU-1) | Note next to D3 only; the purge engine and D3 are unchanged |

---

## QA Testing Report

**QA — 2026-10-09**
**Test mode:** full · **Strategy used:** A (Jest render + source guards), regression plant; D (browser) not possible here, since it needs an admin session. Manual checks are listed below.
**Focus:** ui, security · **Skipped:** live/browser calls, DB writes · **Input source:** coordinator prompt

### Test Coverage
| Check | Tested? | Result | Notes |
|---|---|---|---|
| Panel suites: locked (10) + Danger Zone render test **unmodified** (`git diff` empty) | ✅ | Pass | |
| `app/admin/users` suites incl. source guard (AU-C2…C5, C7) | ✅ | Pass | |
| Cleanup routes, `lib/business-os/purge` guards (incl. no-deletion-paths), cleanup wire types, cleanup SQL drift (`scripts/__tests__/testAccountCleanupSql.test.ts`) | ✅ | Pass | 33 suites / 844 tests |
| `npm run test:authz-guard` | ✅ | Pass | 2 suites / 203 tests |
| Full `npm test` | ⚠️ | **1 new failure** | 14 failed: 11 quarantined, 2 Windows-only (CRLF `bookingsSearchAndPaging.guard`, backslash `oneAddressPolicy.guard`), **1 caused by this change** (Bug 1) |
| eslint on the 4 touched code files | ✅ | exit 0 | 9 warnings, all on lines already in `page.tsx` |
| tsc (repo-wide exit 2, from errors that were already there) scoped to `app/admin/users/` + `components/business-os/purge/` | ✅ | 0 errors | |
| Locked inputs read-only, typing does not change them; check body `{email, tag: email}`; delete body `{email, tag: email, confirmEmail}` | ✅ | Pass | render test |
| Typed confirmation required (Delete disabled until the email is typed again) | ✅ | Pass | Exact-match compare (`normaliseEmail` equality), so wrong text keeps it disabled. The locked test only checks the empty and correct cases (Edge 1) |
| Warning line present; no "test account" / "must contain" copy; no empty-tag hint | ✅ | Pass | |
| Report stays after CLEAN, Done fires onRemoved once (second click no-op); unmount after CLEAN fires once; unmount without CLEAN, SURVIVORS, refused 409, BLOCKED check never fire | ✅ | Pass | |
| Network error never fires | ✅ (reading) | Pass | the catch path never sets `cleanPending`. No test for it (Edge 2) |
| Second row independent | ✅ (source guard) | Pass | `key={user.id}`, one mount per expanded row |
| Rows without email show no panel | ✅ (source guard) | Pass | ternary + "This login has no email…" line |
| Delete… button + dialog not rendered | ✅ (source guard) | Pass | `SHOW_AD1_DELETE_ENTRY = false` gates both |
| Danger Zone (no props) unchanged | ✅ | Pass | unmodified render test green. Its `onRemoved?.()` call is a no-op with no props |
| No raw server text; no email in debug console | ✅ (reading) | Pass | errors go through `checkErrorSentence`/`deleteErrorSentence`. The page passes no `onLog`, and the `onLog` strings carry codes and counts only |
| Regression plant: locked tag initial state → `DEFAULT_TEST_TAG` | ✅ | Red as expected | 3/10 locked tests failed; file restored, `cmp` identical |
| Doc splices insert-only | ✅ | Pass | `git diff --numstat`: 7/2/3/3 additions, **0 deletions** on the 4 tracked docs |

### Issues Found

#### Bugs (must fix before commit)
1. **New AU-C4 source-guard test names the DB function and breaks the R-7 single-reader guard.** File: `app/admin/users/__tests__/source.guard.test.ts`. Severity: **High** (the Jest gate runs on every PR, and this suite is not quarantined).
   - Repro: `npx jest lib/server/__tests__/testCleanupSecret.test.ts`
   - Expected: `naming(FUNCTION_NAME)` equals `['lib/repositories/TestAccountCleanupRepository.ts']`.
   - Actual: the result also contains `app/admin/users/__tests__/source.guard.test.ts`, because the AU-C4 test writes the literal `'operator_test_account_cleanup'`. Fix: build the literal so it never appears whole (e.g. `'operator_test_' + 'account_cleanup'`), or import the name from the repository's constant. Either way, keep R-7 green.

#### Edge Cases (nice to fix)
1. Locked test: add a case that types the wrong email (Delete stays disabled).
2. Locked test: add a case where a network error on delete does not call `onRemoved`.

### Manual visual checks (admin session, owed)
1. Expand a business row. The danger area shows the new paragraph, the red-bordered panel titled "Remove this account permanently", the bold warning line, and Email/Tag pre-filled, greyed and read-only. No "Delete…" button.
2. Check, then type a wrong email: Delete stays disabled. Type the correct one: "Delete this account" is enabled.
3. On a disposable account: Delete. "Account removed." and the table stay, Copy works, and Done refreshes the list, which no longer shows the row.
4. Repeat, but collapse the row instead of pressing Done. The list refreshes once.
5. On a refused account (e.g. an admin): BLOCKED, no Delete button, the list does not change.
6. Expand two rows: each panel keeps its own state. A row with no email shows the "no email" line.
7. The panel's light styling (#f0fff4 report box) reads acceptably on the dark admin theme.
8. The `/test-business-os` Danger Zone panel still looks and behaves as before.

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address Bug 1 before commit

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-08 | Created (BA) | Records user decisions AU-1 (same hard delete on `/admin/users` for any account, email locked, tag = email, money history and login removed) and AU-2 (hide AD-1 Delete…). States what UD-1, UD-5, D14, OX-1r and Danger Zone §10 now mean, lists the guards that still refuse, opens OI-AU-1 (legal retention, non-blocking), scopes one UI slice, raises SQ-1…SQ-5, and gives insert-only splices for three docs |
| 2026-10-08 | SA review (§7) | Approved with conditions AU-C1…AU-C9. SQ-1 reworded on the R-7 sentence (RPC, not direct connection); SQ-2, SQ-3 approved; SQ-4 not tripped; SQ-5 keep `admin_page`. Guard ids filled from the generator (adds G-7, G-13, G-16). UI-only confirmed; census, writes gate, no-deletion-paths unchanged; Delete… hidden by a constant so the AD-1 source guard stays green. Splices left to Dev (local docs stale), with anchor fixes and a runbook line |
| 2026-10-09 | UI slice code complete (Dev, uncommitted) | Branch `feature/admin-users-hard-delete` (stacked on #273). Panel locked mode (`lockedEmail`, `onRemoved`), mounted in the `/admin/users` danger area, Delete… hidden by `SHOW_AD1_DELETE_ENTRY = false`; locked-mode render tests and source-guard assertions. §3 guard ids corrected (AU-C8). Splices A.1, A.2, A.3, B.1–B.6, C.1, C.2 and the runbook line applied insert-only (B.1 and B.4 placed after the §9.1 OX-1r row, B.3 and B.4 after the §3 OX-1r row). Awaiting SA code review and QA |
| 2026-10-09 | Deviation from AU-C2 wording (coordinator default, user may override) | AU-C2 says "after a CLEAN result call `onRemoved`". Because the refresh replaces the list with a spinner and unmounted the per-table report at once, locked mode now keeps the report (Copy still usable) under a grey **Done** button; `onRemoved` → `void fetchUsers()` fires once on Done, or on unmount after a CLEAN result so the list never keeps a deleted account. Non-CLEAN results never call it. Tests updated |
