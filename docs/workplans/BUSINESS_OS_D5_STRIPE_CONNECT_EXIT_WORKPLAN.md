# Workplan: D5 / SX-5 — Stripe Connect fixes (confirmed delete, Standard deauthorize, money-in-flight refusals, G-8 wording)

> **Last Updated**: 2026-10-30

**Developer:** Dev
**Requirement:** [BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md) §6.2 row SX-5, §7 AC ("Connect delete clears G-8 only on Stripe's confirmed deletion; Standard accounts are deauthorized"), §8.1 P-8, §9 BQ-12 / BQ-19, §10 carried rulings (C-5, C-9, C-11, SA-14), §11 B.1 / B.8; parent [BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md) §17 (K-4, C-5, SA-14) and `## SA Review — 2026-10-25` (XC-5)
**Plan:** [BUSINESS_OS_ACCOUNT_DELETION_PLAN.md](/docs/workplans/BUSINESS_OS_ACCOUNT_DELETION_PLAN.md) row SX-5
**Branch:** `feature/stripe-connect-exit-d5` (worktree `neuronforge-d5`, from `origin/main` `a0804002`)
**Date:** 2026-10-30
**Status:** Code Complete with SA code review fixes F-1 to F-4 (2026-10-30, uncommitted in `neuronforge-d5`; ready for QA). No migration

## Overview

D5 fixes the two Stripe Connect buttons in Business Setup → Payments so that they tell the truth and cannot lose money. **Delete** must remove our record only after Stripe confirms the account is gone. For an Express account, that means Stripe deleted it. For a Standard account (the owner's own Stripe account, linked by OAuth), it means Stripe confirmed that our access is revoked. When Stripe refuses, the owner gets an honest refusal and our record stays (BQ-19). Both buttons refuse while client money still runs through the account. **Disconnect** refuses while client payment plans are running (BQ-12, user answer 2026-10-30: block). **Delete** refuses on the same running plans and also on pending payments or refunds (D-2 via `runAccountDeletionCheck`, SA-14). The account-deletion blocker for Stripe (G-8) gets wording that names the button that actually clears it. **No migration.** No webhook change is required; two webhook follow-ups are listed for the PLAN PAYMENTS session (§8). Estimate **≈ 2.5 d** against the 2 d budget. A split into D5a (server) and D5b (UI and copy) is offered in §10.

## Table of Contents

1. [What exists today (verified on a0804002)](#1-what-exists-today-verified-on-a0804002)
2. [Scope and non-scope](#2-scope-and-non-scope)
3. [Design](#3-design)
4. [Copy (en / he / es drafts)](#4-copy-en--he--es-drafts)
5. [Files to create / modify](#5-files-to-create--modify)
6. [Migration](#6-migration)
7. [Task list](#7-task-list)
8. [Cross-session items](#8-cross-session-items)
9. [Test plan](#9-test-plan)
10. [Effort and split option](#10-effort-and-split-option)
11. [Risks](#11-risks)
12. [Open questions for SA](#12-open-questions-for-sa)
13. [Questions for the user (business only)](#13-questions-for-the-user-business-only)
14. [SA Review Notes](#14-sa-review-notes)
15. [QA Testing Report](#15-qa-testing-report)
16. [Commit Info](#16-commit-info)
17. [Change History](#change-history)

---

## 1. What exists today (verified on a0804002)

### 1.1 The two routes (brief point 1)

| Route | What it does | Express / Custom | Standard (OAuth) |
|---|---|---|---|
| `POST /api/payments/stripe-connect/disconnect` | Sets `charges_enabled`, `payouts_enabled`, `details_submitted`, `onboarding_completed` to `false` on our `stripe_connect_accounts` row. **Never calls Stripe.** Never touches the `plugin_connections` `stripe` row. Audit `STRIPE_CONNECT_ACCOUNT_DISCONNECTED`. No check for running client plans | Account stays live at Stripe | Account stays live at Stripe, our OAuth access stays granted |
| `DELETE /api/payments/stripe-connect/delete` | Calls `stripeService.deleteConnectedAccount` (`stripe.accounts.del`) inside a `try` whose `catch` **logs a warning and carries on** ("may already be deleted"), then deletes our row. Audit `STRIPE_CONNECT_ACCOUNT_DELETED`. Returns success | `accounts.del` works only when the live account's balances are zero. A refusal (balance, payout on its way) is swallowed and **our row is deleted anyway** | `accounts.del` is refused for live Standard accounts, so it **always** takes the swallowed path. **OAuth deauthorize is never called**: `StripeService` has `oauth.token` but no `oauth.deauthorize` |

Confirmed: delete clears our record before (and regardless of) Stripe's answer. This is **K-4** (parent §17.1). After a refused delete:

- the Express account still exists at Stripe and keeps its balance and its client subscriptions;
- for a Standard account, we keep API access to it;
- yet G-8 no longer sees the `stripe_connect_accounts` row.

Both routes take no request body (no Zod schema is needed, CLAUDE.md rule 2: nothing to validate), use `getUser()` for the user, Pino with `correlationId`, and a non-blocking audit. **0 `console.*`** in either route, in `lib/stripe/StripeService.ts`, `components/business-os/ConfigurationDialog.tsx` and `components/payments/StripeConnectStatus.tsx`.

Further facts that shape the design:

| # | Fact | Evidence | Effect |
|---|---|---|---|
| E-1 | There are **two** places a Stripe account is recorded: `stripe_connect_accounts` (Express creation routes, and the Standard OAuth `callback` route) and `plugin_connections` with `plugin_key = 'stripe'`. The second gets written in two cases: the Express onboarding return creates a placeholder row (`access_token: 'express'`, `profile_data.stripe_account_id`), and the wizard's "connect existing account" button goes through `/api/v2/plugins/connect`, so a Standard account linked that way exists **only** in `plugin_connections` | `callback/route.ts` L95–L166, `StripeConnectWizard.tsx` L766–L773 | Delete must handle both tables. Today a Standard account linked through the plugin path gets **404 "No payment account found"** from Delete |
| E-2 | `lib/payments/stripeAccountContext.ts` `resolveUserConnectAccounts(db, userId)` already lists every Stripe account a business uses, from both tables, de-duplicated; `BusinessPurgeRepository.resolveConnectAccounts(userId)` wraps it (rule 1) | `stripeAccountContext.ts` L85–L127, `BusinessPurgeRepository.ts` L345 | Reused: one answer to "which accounts must be released" |
| E-3 | `/api/plugins/disconnect` only sets the plugin row's `status = 'disconnected'`; the row stays | `user-plugin-connections.ts` `disconnectPlugin` → `updateStatus` | Combined with G-8 (§1.2), an owner whose business has a `stripe` plugin row can **never** clear G-8 today, not even with Delete. Delete must remove that row too |
| E-4 | Two OAuth client ids are in use: the callback flow reads `STRIPE_CLIENT_ID` (`oauth-link/route.ts`), the plugin definition `NEXT_PUBLIC_STRIPE_CLIENT_ID` (`stripe-plugin-v2.json`) | as named | Deauthorize must send the client id the account was linked with (§3.2, SA Q-3) |
| E-5 | After a soft Disconnect, card checkout still works for an Express account that finished onboarding: `create-checkout` (and the public invoice pay and website checkout routes) fall back to the **active** `plugin_connections` row when `onboarding_completed` is false. `refresh-status` also rewrites the four fields from Stripe, so one refresh shows "Connected" again | `app/api/payments/create-checkout/route.ts` L105–L160, `refresh-status/route.ts` L53 | Disconnect does not really stop payments. **Out of D5 scope**; raised as a finding and a business question (§13 U-2), with a follow-up row (§8 X-4) |
| E-6 | No webhook handles `account.updated` or `account.application.deauthorized` | `grep` over `app/` and `lib/` | When an owner revokes access from their own Stripe dashboard, our rows stay. D5 handles that case at Delete time ("already gone", §3.2); the webhook is a cross-session follow-up (§8 X-1) |

### 1.2 G-8 today and its wording (brief point 2)

G-8 is computed in the generated cleanup function (`scripts/generate-test-account-cleanup-sql.ts` L1323–L1329, live in the latest regenerated migration):

```sql
(SELECT count(*) FROM public.stripe_connect_accounts AS connect WHERE connect.user_id = <uid>)
+ (SELECT count(*) FROM public.plugin_connections AS plugins WHERE plugins.user_id = <uid> AND plugins.plugin_key = 'stripe')
```

**It is strict:** it blocks while any row exists in either table, whatever its flags or status. A soft-disconnected row and a `disconnected` plugin row both block. It does not ask Stripe whether an account is still live, and it does not need to: once D5 is in place, a row exists exactly until Stripe has confirmed the release. **SA-14 ("G-8 strict") is already met by the SQL, and D5 does not change it** (a change would be a cleanup regeneration under the S-1 lock).

Wording:

| Where | Text today | Problem |
|---|---|---|
| `settings.account_delete.blocker.stripe_connected` (en/he/es, `lib/business-os/translations/*.ts`) and the fallback copy in `components/business-os/purge/DangerZonePanel.tsx` L81 | "Your Stripe account is still connected for client payments. Disconnect it in Settings → Payments." | Sends the owner to **Disconnect**, which does not clear G-8; and the place is called **Business Setup → Payments** (`config.title`, `config.tab.payments`), not Settings |
| `app/admin/users/deletionCopy.ts` `stripe_connected` | "… Disconnect it first." | Same wrong verb, admin-facing |
| SQL `clears` column of G-8 | "Disconnect Stripe from the business first." | Shown only in the admin test-account cleanup panel. Changing it is a regeneration (S-1); deferred to the next regeneration holder (§8 X-3) |
| `config.stripe.delete_message` (confirm box) | "This will permanently delete your Stripe account. All payment history and settings will be lost." | Untrue for Standard (the account stays the owner's), and our payment history is kept. Breaks C-9 |

### 1.3 D-2 and the deletion check (brief point 3)

`runAccountDeletionCheck` (`lib/business-os/account-deletion/selfServiceDeletion.ts`) runs the cleanup function in `anonymise_check` mode, which is read-only, and returns its guard rows. G-9 rows are generated from `LOCAL_BLOCKING_CONDITIONS` (`lib/business-os/purge/localPrecondition.ts`):

| Condition | Table | Statuses |
|---|---|---|
| C1 "client payment plans running" | `payment_plan_subscriptions` | `pending`, `active`, `past_due`, `paused` |
| C2 "payments pending" | `payment_transactions` | `pending` |
| C2 "refunds in flight" | `payment_refunds` | `pending` |
| C3 "unpaid invoices" | `payment_invoices` | `sent`, `overdue`. Reported only in the anonymise modes, never blocking (TL-6) |

`blockerCopy.ts` maps them to `client_plans_running` and `client_payments_pending`.

**D-2 does not flow through the check today.** Neither Connect route calls `runAccountDeletionCheck`, and nothing refuses Disconnect or Delete for money in flight. The only callers are the deletion-check route and the self-delete route. The v1 SA text that defined "D-2" was condensed away in the v2 rewrite (parent §17). This workplan reads it, from the v1 change-history line ("refuse delete with running client plans") and SA-14, as **"the Connect delete refuses while client money is in flight, and the decision comes from the same G-9 rows `runAccountDeletionCheck` returns"**. SA to confirm (Q-1).

"Running client plans" in code: rows of `payment_plan_subscriptions` in `pending/active/past_due/paused`. Each one is a Stripe subscription or schedule **on the connected account** (`stripe_connect_account_id`, `stripe_subscription_id` / `stripe_schedule_id`). The owner ends one from Orders (`MoneyDetailDrawer` → `CancelPlanModal` → `/api/payments/plans/{id}/cancel`) or from the client's record (`PaymentManagementModal`).

### 1.4 The existing guard (brief point 6)

`app/api/payments/stripe-connect/__tests__/stripeDecidesConnectStatus.guard.test.ts` (FX-1) pins two things:

1. The root `stripe-connect/route.ts` serves GET only. It has no POST, PUT, PATCH or DELETE, no `zod` import, no `z.object(` and no `request.json()`.
2. Across every `.ts` under `stripe-connect/` (except `__tests__`), no `z.object({ … })` literal names `charges_enabled`, `payouts_enabled`, `details_submitted` or `onboarding_completed`. Stripe's verdict must never come from a request body.

It does **not** pin anything about delete ordering, deauthorize, or refusals. Disconnect's constant `false` writes are not caller input and pass the guard; D5 keeps that. D5 adds a sibling guard (§9).

### 1.5 Tenant isolation and repositories (brief point 5)

Both routes run as the service role (`new StripeConnectRepository(supabaseServer)`). Neither takes a caller-supplied id: the user is `getUser()`, and every row is chosen by that `user_id` (`findByUserId`, `update(userId, …)`, `delete(id, userId)` with `.eq('id').eq('user_id')`). The Stripe account id always comes from **our** row, never from the request. Per `tenant-isolation-guard` Step 1, the repository scope already covers this: there is no caller id, no trigger, no upsert and no raw payload. D5 keeps it that way: no body, no ids from the client, a fixed literal patch. The new plugin-row delete (§3.4) is `.eq('user_id', userId).eq('plugin_key', 'stripe')`. Rule-4 comments are added where `supabaseServer` is used (C-11). Rule 1: every DB read and write goes through `StripeConnectRepository`, `BusinessPurgeRepository`, `PluginConnectionRepository` or `TestAccountCleanupRepository` (through `runAccountDeletionCheck`). No direct `.from()` in the routes or the new modules.

### 1.6 Migration (brief point 4)

None (§6).

---

## 2. Scope and non-scope

**In scope**

- Delete: release at Stripe first; remove our rows (both tables) only on a confirmed release; honest refusal otherwise (BQ-19).
- Standard accounts: OAuth deauthorize (C-5).
- D-2: Delete refuses on running client plans and pending payments or refunds, read through `runAccountDeletionCheck` (SA-14).
- BQ-12 (answered 2026-10-30, **block**): Disconnect refuses while client payment plans are running.
- G-8 wording in en/he/es, the DangerZonePanel fallback and the admin copy; a truthful delete confirm box per account kind (C-9).
- Show the refusal to the owner in both UIs that call these routes (today one fails silently, the other uses `alert` with raw route text).

**Not in scope**

- The G-8 SQL (strict already; S-1 lock). Its `clears` text goes to the next regeneration (§8 X-3).
- Webhooks (§8 X-1, X-2).
- Making soft Disconnect actually stop checkout (E-5). Raised as a finding with a business question; it becomes its own follow-up if the user wants it.
- Any retry queue or background job for a refused delete (user, BQ-19: "simple approach").

---

## 3. Design

### 3.1 One guard for "client money still runs through Stripe"

New `lib/business-os/account-deletion/connectExitGuard.ts`, server-only, with injected deps for tests:

```ts
export type ConnectExitAction = 'disconnect' | 'delete';
export type ConnectExitVerdict =
  | { kind: 'clear' }
  | { kind: 'blocked'; blockers: BlockerView[] }   // codes from blockerCopy: client_plans_running / client_payments_pending
  | { kind: 'unreadable' };                         // fail closed: nothing changes, "try again"
export async function checkConnectExit(subject: SessionSubject, action: ConnectExitAction, deps?): Promise<ConnectExitVerdict>;
```

- **Which conditions block.** Disconnect blocks on C1 only (BQ-12 is about plans). Delete blocks on C1 and C2. C3 never blocks (TL-6).
- **Delete (SA-14).** Calls `runAccountDeletionCheck`. Of its rows it keeps only the **G-9** rows, mapped by `blockerCodeOf`. A G-9 row the map cannot name (`contact_support`) still blocks: fail safe. G-8 is ignored here, because it is always present while the account is linked. All other guards (G-4, G-6 …) are the account-deletion's business, not this button's.
- **When the check is `unavailable`** (no session email, the cleanup secret is not configured, or the function is out of date), Delete falls back to `businessPurgeRepository.countLocalBlockingState(userId)` and `decideLocalPrecondition`. That is the same `LOCAL_BLOCKING_CONDITIONS` the G-9 SQL is generated from, so it is the same rule, not a second one. Without the fallback, Delete would be unusable on any deployment without the cleanup secret. SA to rule (Q-2).
- **Disconnect** uses the local counts directly. Running the whole cleanup function for a soft toggle is heavy, and it needs the cleanup secret. Same predicates, filtered to C1 (SA Q-2).
- **A failed read is never a "no"** (`count: null` → `unreadable`, and a `failed` check → `unreadable`). Requirement §12 "fails closed".
- **Pure mapping** in `connectExitBlockers(rows, action)`, unit-tested without I/O.

### 3.2 Releasing an account at Stripe: `connectRelease.ts`

New `lib/business-os/account-deletion/connectRelease.ts` with injected Stripe deps. It asks **Stripe** what the account is, in the spirit of "Stripe decides" (FX-1), instead of trusting our `stripe_account_type`:

**As amended by SA W-3, W-4 and W-11 (binding; folded in before T-4):**

1. `retrieveConnectedAccountKind(id)`. The result decides the path:
   - `type === 'standard'` or `controller.type === 'account'` → **deauthorize**;
   - otherwise (Express or Custom, platform-controlled) → **delete**;
   - Stripe answers with a deleted object (`deleted: true`) → `already_gone`.
   - **W-4: only this step can decide "already gone".** A retrieve error counts as gone only when its `{ code, statusCode }` is in `ALREADY_GONE_ON_RETRIEVE`, the list of shapes recorded by the spike. Any shape that also appears in spike case (d), a test-mode key reading a live account, is never on the list. **The list ships empty** (§14 spike record: the spike could not run), so every retrieve error is a refusal: transient → `stripe_unreachable`, anything else → `not_available`. Matching is on `code` and `statusCode`, never on the error class.
2. **Deauthorize:** `stripe.oauth.deauthorize({ client_id, stripe_user_id: id })`. Confirmed only when the response's `stripe_user_id === id`. **W-3:** `client_id` is the one server-side `STRIPE_CLIENT_ID`, whichever table the row came from. If it is unset, the result is `not_available`, with no Stripe call and a Pino `error`. **W-11:** every deauthorize refusal is `not_available` (or `stripe_unreachable` when transient), **never** `stripe_refused`, because a deauthorize does not depend on a balance.
3. **Delete:** `stripe.accounts.del(id)`. Confirmed only when the response is `{ deleted: true, id }`. An invalid-request error (a balance, a payout on its way) → `stripe_refused`, which is **Express only**. Transient → `stripe_unreachable`. Anything else (permission, authentication) → `not_available`. A `del` error never means "already gone" (W-4).
4. Only `{ type, code, statusCode }` is logged or returned (in development only). Stripe's message never is (W-13).

Return type: `{ kind: 'released', how: 'deleted' | 'deauthorized' | 'already_gone' } | { kind: 'refused', reason: 'stripe_refused' | 'stripe_unreachable' | 'not_available', step, stripe? }`.

`StripeService` gains `retrieveConnectedAccountKind(id)` and `deauthorizeConnectedAccount({ clientId, accountId })`. `deleteConnectedAccount` changes its return type from `void` to the deleted object; it has one caller, the delete route. DELETE owns the OAuth deauthorize method (§11 B.1).

### 3.3 The delete route, in order

**As amended by SA W-5, W-6, W-8, W-9, W-10 and W-12 (binding; folded in before T-7):**

```
DELETE /api/payments/stripe-connect/delete
1. getUser() → 401                                                          (unchanged; no rate limit, W-6)
2. W-8: read both tables through error-surfacing repository calls (NOT resolveConnectAccounts, which drops read errors):
   StripeConnectRepository.findByUserId + PluginConnectionRepository.findByUserAndPlugin(userId, 'stripe')
   - any read error other than "no row" (PGRST116) → 503 { error: 'check_failed' }, no Stripe call
   - no row in either table → 404 { error: 'not_found' }
   - a plugin row naming no account id → 409 { error: 'not_available' }
3. W-9: distinct account ids across the two rows; more than one → 409 { error: 'not_available' }, no Stripe call.
   The healthy two-row case (Express placeholder) names ONE account.
4. W-10: does another user's row (either table) name this account? count-only cross-user read (rule-4 comment)
   - yes → 409 { error: 'not_available' }, no Stripe call, audit details `shared: true` only
   - read error → 503 { error: 'check_failed' }
5. checkConnectExit(subject, 'delete')
   - blocked → 409 { error: 'client_money_in_flight', blockers }          (nothing at Stripe, nothing in our DB)
   - unreadable → 503 { error: 'check_failed' }
6. releaseConnectedAccount(accountId)
   - refused → 409 { error: 'stripe_refused' | 'not_available' } or 502 { error: 'stripe_unreachable' }; no row touched
7. W-5: on release, delete every row that names the released account (by construction: both rows, step 3):
   StripeConnectRepository.delete(id, userId); PluginConnectionRepository.deleteByUserAndPlugin(userId, 'stripe');
   pluginStatusCache.invalidate in the ROUTE. A DB failure here → 500.
8. W-12: success → audit STRIPE_CONNECT_ACCOUNT_DELETED { account_type, how }, awaited + flushed;
   refusal → STRIPE_CONNECT_DELETE_REFUSED { reason, step, blocker codes, stripe {type, code} } with log().catch() only.
```

A retry after a step-7 failure is safe, but it is not automatic. Retrieve on a deleted account is "already gone" only if Stripe answers with a deleted object, or the error shape is on the recorded list. Until then, such a retry is refused as `not_available` (contact us). That is the conservative side of W-4.

The route has no `try { stripe } catch { continue }` any more. A sibling guard pins this (§9).

### 3.4 The disconnect route

```
POST /api/payments/stripe-connect/disconnect
1. getUser() → 401;  (no rate limit, W-6)
3. findByUserId → 404 (unchanged)
4. checkConnectExit(subject, 'disconnect')
   - blocked → 409 { error: 'client_plans_running', blockers }  (BQ-12: block)
   - unreadable → 503 { error: 'check_failed' }
5. existing literal update (four fields false), unchanged; audit as today; refusal audit STRIPE_CONNECT_DISCONNECT_REFUSED
```

The route response carries a **code and counts**, never prose. Each UI turns the code into its own language's text (§4), the same way the deletion drawer does.

### 3.5 Repository addition

`PluginConnectionRepository.deleteByUserAndPlugin(userId, pluginKey)`: `.delete().eq('user_id', userId).eq('plugin_key', pluginKey)`, `{ count: 'exact' }`, returning `AgentRepositoryResult<number>`. It is add-only, and the file is not in §11's ownership tables, so it goes into the coordination file first (§8 X-5). It also invalidates `pluginStatusCache` for the user, as `/api/plugins/disconnect` does.

The Express placeholder row and the Standard plugin row are deleted, not marked `disconnected`. G-8 is strict and counts any row, and the account no longer exists for us.

### 3.6 UI

- `ConfigurationDialog.tsx` (Business Setup → Payments). Today a failure only logs, so the owner sees nothing. D5 adds one inline message (`role="alert"`) under the Stripe buttons, built from the code. On a refusal the dialog's state stays "connected" or "disconnected" as it was. The delete confirm text depends on `stripeAccountData.stripe_account_type`: Express or Standard (C-9).
- `StripeConnectStatus.tsx` (invoice settings, `/payments`). Replace `alert(result.error)` with the same message, inline in the confirm dialog.
- The message builder is one plain-TS module, `components/payments/stripeConnectExitCopy.ts`. It maps a code and its counts to a translation key, so the two components cannot drift.
- Button label: today "Delete Account" (en), "מחק חשבון" (he), "Eliminar Cuenta" (es). That sits too close to "Delete my account". D5 proposes "Remove connection" (§13 U-1). The G-8 copy names whichever label the user picks.

---

## 4. Copy (en / he / es drafts)

Keys are under `config.stripe.*` (Business Setup) and `settings.account_delete.blocker.*` (deletion drawer). `{n}` is a count. Each counted string has an `_uncounted` twin, as the drawer already does. Hebrew uses the plural "you" form the drawer already uses. Spanish is a draft (requirement §12).

| Key | en | he | es |
|---|---|---|---|
| `settings.account_delete.blocker.stripe_connected` (G-8, P-8) | Your Stripe account is still linked for client payments. Remove it in Business Setup → Payments → Remove connection. Disconnect on its own does not remove it. | חשבון ה-Stripe שלכם עדיין מקושר לתשלומי לקוחות. הסירו אותו בהגדרות העסק ← תשלומים ← הסרת החיבור. ניתוק בלבד לא מסיר אותו. | Tu cuenta de Stripe sigue vinculada para pagos de clientes. Quítala en Configuración del Negocio → Pagos → Quitar conexión. Desconectar no basta para quitarla. |
| `config.stripe.delete_account` (button, U-1) | Remove connection | הסרת החיבור | Quitar conexión |
| `config.stripe.delete_title` | Remove Stripe from your business? | להסיר את Stripe מהעסק? | ¿Quitar Stripe de tu negocio? |
| `config.stripe.delete_message_express` | This closes the Stripe account we set up for you and removes it from your business. Your past payments stay in your records here. This cannot be undone. | פעולה זו סוגרת את חשבון ה-Stripe שפתחנו עבורכם ומסירה אותו מהעסק. התשלומים הקודמים נשארים ברשומות שלכם כאן. לא ניתן לבטל פעולה זו. | Esto cierra la cuenta de Stripe que creamos para ti y la quita de tu negocio. Tus pagos anteriores siguen en tus registros aquí. No se puede deshacer. |
| `config.stripe.delete_message_standard` | This removes our access to your Stripe account. Your Stripe account stays open and stays yours. Your past payments stay in your records here. | פעולה זו מסירה את הגישה שלנו לחשבון ה-Stripe שלכם. חשבון ה-Stripe נשאר פתוח ושלכם. התשלומים הקודמים נשארים ברשומות שלכם כאן. | Esto quita nuestro acceso a tu cuenta de Stripe. Tu cuenta de Stripe sigue abierta y sigue siendo tuya. Tus pagos anteriores siguen en tus registros aquí. |
| `config.stripe.refused.client_plans_running` (Disconnect and Delete) | {n} client payment plans are still running through Stripe. End them first in Orders, or from each client's record, then try again. | {n} תוכניות תשלום של לקוחות עדיין פעילות דרך Stripe. סיימו אותן קודם בהזמנות או בכרטיס של כל לקוח, ואז נסו שוב. | {n} planes de pago de clientes siguen activos a través de Stripe. Termínalos primero en Pedidos o desde la ficha de cada cliente y vuelve a intentarlo. |
| `config.stripe.refused.client_payments_pending` (Delete) | {n} client payments or refunds are still being processed. Wait for them to finish, then try again. | {n} תשלומים או החזרים של לקוחות עדיין בטיפול. חכו שיסתיימו ואז נסו שוב. | {n} pagos o reembolsos de clientes todavía se están procesando. Espera a que terminen y vuelve a intentarlo. |
| `config.stripe.refused.stripe_refused` (BQ-19) | Stripe did not let us remove this account yet, usually because it still holds money for you (a balance or a payout on its way). Nothing was changed. Try again once Stripe has paid it out. | Stripe עדיין לא מאפשר להסיר את החשבון, בדרך כלל כי יש בו עדיין כסף שלכם (יתרה או העברה בדרך). לא שינינו דבר. נסו שוב אחרי ש-Stripe יעביר את הכסף. | Stripe todavía no nos deja quitar esta cuenta, normalmente porque aún guarda dinero tuyo (un saldo o un pago en camino). No hemos cambiado nada. Vuelve a intentarlo cuando Stripe lo haya pagado. |
| `config.stripe.refused.stripe_unreachable` | We could not reach Stripe right now. Nothing was changed. Please try again in a few minutes. | לא הצלחנו להתחבר ל-Stripe כרגע. לא שינינו דבר. נסו שוב בעוד כמה דקות. | No pudimos conectar con Stripe ahora. No hemos cambiado nada. Vuelve a intentarlo en unos minutos. |
| `config.stripe.refused.check_failed` | We could not check your client payments right now. Nothing was changed. Please try again. | לא הצלחנו לבדוק את תשלומי הלקוחות כרגע. לא שינינו דבר. נסו שוב. | No pudimos comprobar los pagos de tus clientes ahora. No hemos cambiado nada. Vuelve a intentarlo. |
| `config.stripe.refused.not_available` | We need to finish something on our side before this account can be removed. Contact us at {support}. | אנחנו צריכים להשלים משהו מצדנו לפני שאפשר להסיר את החשבון. פנו אלינו בכתובת {support}. | Tenemos que terminar algo por nuestra parte antes de poder quitar esta cuenta. Escríbenos a {support}. |
| `app/admin/users/deletionCopy.ts` `stripe_connected` (en only, admin) | A Stripe account is linked to this business. Nothing was deleted. The owner removes it in Business Setup → Payments → Remove connection; Disconnect alone does not clear it. | — | — |

`config.stripe.delete_message` (the old single text) is removed from all three files once both components use the per-kind keys. The `_uncounted` twins of the two counted strings drop "{n}" ("Client payment plans are still running …").

---

## 5. Files to create / modify

| File | Action | Reason | Owner |
|---|---|---|---|
| `lib/business-os/account-deletion/connectExitGuard.ts` | create | §3.1 | DELETE (`account-deletion/**`) |
| `lib/business-os/account-deletion/connectRelease.ts` | create | §3.2 | DELETE |
| `lib/stripe/StripeService.ts` | modify | `retrieveConnectedAccountKind`, `deauthorizeConnectedAccount`, `deleteConnectedAccount` returns Stripe's answer | DELETE (OAuth deauthorize method, B.1) |
| `app/api/payments/stripe-connect/delete/route.ts` | modify | §3.3 | DELETE |
| `app/api/payments/stripe-connect/disconnect/route.ts` | modify | §3.4 | DELETE |
| `lib/repositories/PluginConnectionRepository.ts` | modify (add one method) | §3.5 | **unlisted → coordination file first** (§8 X-5) |
| `components/payments/stripeConnectExitCopy.ts` | create | §3.6 code → key | **unlisted → coordination** (X-6) |
| `components/business-os/ConfigurationDialog.tsx` | modify | inline refusal, per-kind confirm text | **unlisted → coordination** (X-6) |
| `components/payments/StripeConnectStatus.tsx` | modify | inline refusal instead of `alert` | **unlisted → coordination** (X-6) |
| `lib/business-os/translations/{en,he,es}.ts` | modify | §4 keys (add, edit G-8 and the button label, remove old `delete_message`) | shared practice (add / edit own keys); noted in coordination |
| `components/business-os/purge/DangerZonePanel.tsx` | modify | G-8 fallback text = en dictionary | DELETE (XC-6 kept list) |
| `app/admin/users/deletionCopy.ts` | modify | admin G-8 text | DELETE (B.8) |
| `app/api/payments/stripe-connect/__tests__/stripeConnectExit.guard.test.ts` | create | §9 | DELETE |
| `lib/business-os/account-deletion/__tests__/connectExitGuard.test.ts`, `connectRelease.test.ts` | create | §9 | DELETE |
| `app/api/payments/stripe-connect/delete/__tests__/route.test.ts`, `disconnect/__tests__/route.test.ts` | create | §9 | DELETE |
| `docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md` | modify | §6.2 SX-5 as-built note + Change History row (not §9.2, which the TL edits, and not §11) | DELETE |
| `lib/audit/events.ts`, `lib/audit/eventAudience.ts`, `lib/audit/__tests__/eventAudience.test.ts` | modify (add-only) | W-12: four events registered (two new refusals, plus the two existing unregistered ones); count pin 229 → 233, Business OS 66 → 70 | S-9 anchor (W-17 c) |
| `components/business-os/account-deletion/DeleteAccountDrawer.tsx` + its render test | modify | `blockerCopyKey` maps `stripe_connected` to the new `stripe_linked` key (translations add-only, S-7); test expectation follows the new text | DELETE |
| `lib/repositories/__tests__/PluginConnectionRepository.connectExit.test.ts`, `components/payments/__tests__/stripeConnectExitCopy.test.ts` | create | repository and copy tests | DELETE |

**Not touched:** `scripts/generate-test-account-cleanup-sql.ts` and every S-1 file, `blockerCopy.ts` logic (codes unchanged; only translations change), `selfServiceDeletion.ts` (called, not edited), the webhook route, `stripeDecidesConnectStatus.guard.test.ts`.

**Guard files touched:** none of the G-* guards. D5 **reads** `runAccountDeletionCheck` (`lib/business-os/account-deletion/selfServiceDeletion.ts`) and `LOCAL_BLOCKING_CONDITIONS` / `decideLocalPrecondition` (`lib/business-os/purge/localPrecondition.ts`, via `BusinessPurgeRepository`), and edits only the owner-facing G-8 wording.

---

## 6. Migration

**None.** No column, table, function or policy changes. G-8 already reads both tables strictly. The release state lives at Stripe, and our rows exist exactly until Stripe confirms. Number 20261101 is not needed.

---

## 7. Task list

- ⬜ T-1 (TL / RM, not Dev) Coordination file: add claims for `PluginConnectionRepository.ts` (add-only method), `ConfigurationDialog.tsx`, `StripeConnectStatus.tsx`, the new `stripeConnectExitCopy.ts`, and the translation keys; record X-1…X-4 for PLAN PAYMENTS / S-1 (§8)
- ✅ T-2 (ran, test mode only; could not exercise Connect, see §14; ships conservative) Stripe test-mode spike (≤ 1 h, Q-4): the error `type` / `code` for (a) `accounts.del` with a non-zero balance, (b) retrieve or deauthorize of an already-deauthorized Standard account, (c) retrieve of a deleted Express account. Record the codes in §14 before T-4
- ✅ T-3 `StripeService`: three methods (§3.2)
- ✅ T-4 `connectRelease.ts` + unit tests
- ✅ T-5 `connectExitGuard.ts` (pure mapping + check / fallback) + unit tests
- ✅ T-6 (plus the W-10 count-only `countOtherUsersNamingStripeAccount`) `PluginConnectionRepository.deleteByUserAndPlugin` + unit test
- ✅ T-7 Delete route rewrite (§3.3) + route tests
- ✅ T-8 Disconnect route (§3.4) + route tests
- ✅ T-9 Copy: translations en/he/es, `DangerZonePanel` fallback, admin `deletionCopy.ts`
- ✅ T-10 `stripeConnectExitCopy.ts` + `ConfigurationDialog` / `StripeConnectStatus` inline messages and per-kind confirm text
- ✅ T-11 `stripeConnectExit.guard.test.ts`
- ✅ T-12 (typecheck and tests; `npm run build` not run, see the Change History row) Typecheck filtered to touched files; `npm test` subsets; `npm run build`
- ✅ T-13 Requirement §6.2 as-built note + Change History row
- ✅ T-14 SA code review fixes: F-1 (`record_not_removed` copy in en/he/es + `alert: true` logs + copy and route tests), F-2 (§8 X-1 corrected, X-9 and X-10 added), F-3 (Remove button styled red, tsc error gone), F-4 (neutral `check_failed`). F-5, F-6, F-7 and X-11 left as SA notes

---

## 8. Cross-session items

| # | Item | Owner | Why it is not in D5 |
|---|---|---|---|
| X-1 | Handle `account.application.deauthorized` (owner revoked us from their Stripe dashboard): mark the row so the UI stops showing "Connected". It must **not** delete our rows silently while client plans are running, so the money-in-flight question has to be decided there too | PLAN PAYMENTS (webhook files) | **Corrected (SA F-2):** D5 does **not** treat a revoked account as gone. `ALREADY_GONE_ON_RETRIEVE` ships empty (§14), so an owner who revoked us in their own Stripe dashboard gets "contact us" when they press Remove connection, and G-8 keeps blocking their account deletion until support clears the row (X-10). This webhook is therefore the owner's only self-service route out of that state, not just a UI improvement |
| X-2 | Handle `account.updated` so `charges_enabled` and the other three come from Stripe without `refresh-status` | PLAN PAYMENTS | Not needed for exit correctness |
| X-3 | G-8 `clears` text in the generator: "Remove the Stripe connection in Business Setup → Payments (Disconnect alone does not clear it)." | Next S-1 lock holder | Changing it regenerates the cleanup function |
| X-4 | Soft Disconnect does not stop card checkout (E-5): the checkout routes fall back to the active plugin row, and `refresh-status` re-enables the flags | TL to schedule (DELETE or PLAN PAYMENTS), only if U-2 = yes | Touches checkout routes outside B.1; it is a behaviour change, not an exit fix |
| X-5 | `PluginConnectionRepository.deleteByUserAndPlugin` (add-only) | Shared / unlisted, raised in coordination | B.1: unlisted files are raised first |
| X-6 | `ConfigurationDialog.tsx`, `StripeConnectStatus.tsx`, new `stripeConnectExitCopy.ts` | Unlisted, raised in coordination | Same |
| X-9 | **Owed:** the Connect-sandbox spike of §14, cases (a) to (d), in the sandbox `STRIPE_CLIENT_ID` belongs to. A shape goes onto `ALREADY_GONE_ON_RETRIEVE` only with its recorded `{type, code, statusCode}` as a unit-test fixture, and only if it does not also appear in case (d) | TL / Dev | Could not run on 2026-10-30: the available test key is not a Connect platform |
| X-10 | **Support runbook** for a "contact us" Connect refusal (`not_available`, `record_not_removed`, a revoked or shared account). Support confirms in the Stripe dashboard that the account is deleted, or our access is revoked, and is not used by another business. Then it removes that one business's `stripe_connect_accounts` row and `plugin_connections` `stripe` row. Today the only way is hand SQL scoped by `user_id`; a short runbook is enough for now, and an admin action is a later choice | TL | Not code in D5; the refusals already name the support address |

---

## 9. Test plan

All Jest, small fixtures, inside the existing job (no added CI time).

| Test | Proves |
|---|---|
| `connectRelease.test.ts` | Express `del` → `{deleted:true}` = released/deleted; `del` throws invalid-request (balance) → `stripe_refused`; standard → `deauthorize` called with **our** account id and the source's client id, confirmed only on matching `stripe_user_id`; `account_invalid` / `resource_missing` → `already_gone`; auth / connection error → `stripe_unreachable`; missing client id → `not_available`, no Stripe call; Stripe's message never appears in the result or the log facts |
| `connectExitGuard.test.ts` | Delete: G-9 plan rows → `client_plans_running` with count; pending rows → `client_payments_pending`; unmapped G-9 → still blocks; G-8 / G-6 / G-4 rows alone → `clear`; check `unavailable` → local fallback used (C3 ignored); `failed` or `count: null` → `unreadable`. Disconnect: C1 > 0 → blocked; C2 only → clear |
| `delete/__tests__/route.test.ts` | 401; 404 when neither table has a row; **K-4 regression**: Stripe refuses → 409 `stripe_refused`, `StripeConnectRepository.delete` and plugin delete **not called**; money in flight → 409, **no Stripe call**; check unreadable → 503, no Stripe call; Express success → both rows deleted, audit `how: 'deleted'`; Standard (plugin-only) success → deauthorize + plugin row deleted (today: 404); already gone → rows deleted; no body read; audit failure does not fail the request |
| `disconnect/__tests__/route.test.ts` | 401; plans running → 409 `client_plans_running`, `update` not called; unreadable → 503, not called; clear → literal four-field update (unchanged shape) |
| `PluginConnectionRepository` unit | delete filters on `user_id` and `plugin_key` |
| `stripeConnectExit.guard.test.ts` (source) | the delete route imports `releaseConnectedAccount` and `checkConnectExit`; it no longer calls `deleteConnectedAccount` directly; no `catch` block in it is followed by a repository `delete(`; neither route reads `request.json()`; the disconnect route calls `checkConnectExit` before `update(`. CRLF-normalised (repo flake note) |
| Translation parity | every new `config.stripe.refused.*` and `delete_message_*` key exists in en, he and es; `DangerZonePanel` fallback equals the en G-8 text (existing test pattern, extended) |
| Existing | `stripeDecidesConnectStatus.guard.test.ts`, `blockerCopy.test.ts`, deletion-check route tests stay green unchanged |

**QA manual (critical path, Stripe test mode):**

1. An Express account with a balance: Remove → refusal shown, account still listed.
2. After the payout: Remove → gone; the deletion drawer no longer shows G-8.
3. A Standard account via the wizard's "existing account" button: Remove → app access revoked in the Stripe dashboard.
4. A running client plan: Disconnect and Remove both refuse, and the message points to Orders.

---

## 10. Effort and split option

| Part | Days |
|---|---|
| Spike + StripeService + `connectRelease` + tests | 0.6 |
| `connectExitGuard` + tests | 0.4 |
| Two routes + repo method + route tests + guard | 0.7 |
| Copy en/he/es + two UI components | 0.6 |
| Build / typecheck / docs | 0.2 |
| **Total** | **≈ 2.5 d** (budget 2 d, cap 2.5 d) |

The overrun comes from E-1 and E-3 (the second table and the plugin-only Standard path), which the requirement row did not know about. **Split option, if SA prefers:** D5a = server (T-2…T-8, T-11; ≈ 1.6 d), which already closes K-4 and both refusals. The UIs would then show today's generic failure for a refusal until D5b = copy and UI (T-9, T-10; ≈ 0.9 d). Because of that, I recommend one PR, and splitting only if review time is the constraint.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| A wrong "already gone" reading (for example a test-mode key against a live account returns a permission error) would clear G-8 for an account that still exists | Only the codes verified in T-2 count as gone; `StripeAuthenticationError` and anything else is `stripe_unreachable`. SA Q-4 |
| Two OAuth client ids (E-4): deauthorize with the wrong one fails | Fails closed as `stripe_refused` / `not_available` (row kept, owner told). T-2 checks which id each path uses in test mode |
| `runAccountDeletionCheck` is a heavy call on a button press | Delete only, rate-limited; measured `serverMs` is logged. Disconnect uses the light local counts |
| An Express account deleted while a client plan started between check and release | Same window the account-deletion path accepts; the check runs immediately before the release. No lock added (no migration) |
| Owners with a plugin row that names no account id cannot remove it themselves | Honest `not_available` refusal with the support address; expected to be rare (legacy rows) |

---

## 12. Open questions for SA

| # | Question | Dev default |
|---|---|---|
| Q-1 | Is "D-2" = "the Connect delete refuses while client money is in flight, decided by the G-9 rows of `runAccountDeletionCheck`"? The v1 text is gone from the docs | Yes, as designed |
| Q-2 | When the check is `unavailable`, may Delete fall back to `countLocalBlockingState` (same `LOCAL_BLOCKING_CONDITIONS`)? And may Disconnect use the local counts only? | Yes to both |
| Q-3 | Deauthorize client id per source: `STRIPE_CLIENT_ID` for `stripe_connect_accounts`, the plugin's `NEXT_PUBLIC_STRIPE_CLIENT_ID` for `plugin_connections`. Missing → refuse | As stated |
| Q-4 | Which Stripe error codes count as "already gone" (to be confirmed by the T-2 spike) | `account_invalid`, `resource_missing` / 404 only |
| Q-5 | Delete removes the `plugin_connections` `stripe` row (not just `status = 'disconnected'`), because G-8 counts any row | Delete it |
| Q-6 | Add `RATE_LIMITS.write` on both routes (requirement §12 lists rate limits for request / keep / cancel, not these) | Add it |
| Q-7 | One PR, or the D5a / D5b split (§10) | One PR |

---

## 13. Questions for the user (business only)

| # | Question | Suggested answer |
|---|---|---|
| U-1 | The Stripe button in Business Setup → Payments says **"Delete Account"**, which sounds like deleting your whole business account. Shall we rename it to **"Remove connection"**? | Yes, rename it |
| U-2 | Today, after you press **Disconnect**, clients can still pay you by card through your website and invoice links, because the Stripe account is still live. Should Disconnect stop card payments too? (A separate small fix, not part of this step) | Yes, Disconnect should stop new card payments |

Answered before this workplan (2026-10-30, recorded by the TL in requirement §9.2):

- **BQ-12 = block:** Disconnect is refused while client payment plans are running.
- **BQ-19 = honest refusal:** keep the record, no retry queue and no background job.

---

## 14. SA Review Notes

The SA verdict is in `## SA Workplan Review — 2026-10-30` below.

### T-2 spike record (W-4), 2026-10-30, Dev

The spike ran against Stripe **test mode only**, with the `sk_test_` key in the main checkout's `.env.local`. The live key was never read. Result: **the spike could not exercise Connect.** The test key belongs to a Stripe account that is not a Connect platform.

| Probe | Answer `{type, code, statusCode}` |
|---|---|
| `accounts.create({ type: 'express' })` | `StripeInvalidRequestError`, no code, 400 ("You can only create new accounts if you've signed up for Connect") |
| `accounts.create({ type: 'standard' })` | same |
| `accounts.retrieve('acct_1ZZZZZZZZZZZZZZZ')` | `StripePermissionError`, `platform_account_required`, 403 |

None of cases (a) to (d) could be produced, so **no error shape is recorded as "already gone"** and `ALREADY_GONE_ON_RETRIEVE` ships **empty**. The code is conservative: any retrieve, delete or deauthorize error is a refusal, and only Stripe's own success answers release:

- `deleted: true` from `del`;
- the echoed `stripe_user_id` from `deauthorize`;
- a deleted object from `retrieve`.

**Manual step (owed before switching on any "already gone" shape):** in the Connect-enabled sandbox (the one `STRIPE_CLIENT_ID` belongs to), record `{type, code, statusCode}` for:

- (a) `accounts.del` on an Express account with a balance (only reproducible with a live key, so read it from Stripe's docs or a support answer, never from a live call);
- (b) `retrieve` after a Standard account's access was revoked;
- (c) `retrieve` of a deleted Express account;
- (d) a test key retrieving a live account id.

Add a shape to the list only if it appears in (b) or (c) and not in (d).

---

## 15. QA Testing Report

_QA to populate._

---

## 16. Commit Info

_RM to populate._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-30 | Created (Dev) | Workplan for D5 / SX-5 on `a0804002`. Findings: K-4 confirmed (delete swallows Stripe's refusal and deletes our row; no deauthorize); G-8 strict in SQL (both tables, any row) but its copy points to Disconnect and to "Settings"; D-2 not wired; a second account table (`plugin_connections`) that Delete ignores, so G-8 can never clear for those businesses; soft Disconnect does not stop checkout. Design: `connectRelease` (Stripe decides the kind; delete / deauthorize / already gone; honest refusal), `connectExitGuard` (G-9 via `runAccountDeletionCheck` for Delete, C1 local counts for Disconnect per BQ-12 = block), delete both rows only on confirmed release, en/he/es copy. No migration. Cross-session X-1…X-6. ≈ 2.5 d |
| 2026-10-30 | SA workplan review | APPROVED WITH CHANGES, rulings W-1…W-19 (section below) |
| 2026-10-30 | SA rulings folded in (Dev) | §3.2 and §3.3 amended for W-3, W-4, W-5, W-6, W-8, W-9, W-10, W-11, W-12 before T-4 / T-7; §3.4 drops the rate limit (W-6); §14 spike record |
| 2026-10-30 | Implemented (Dev) | Code Complete, uncommitted. New `connectRelease.ts`, `connectExitGuard.ts`, `stripeConnectExitCopy.ts`; both routes rewritten; `StripeService` +2 methods and `deleteConnectedAccount` returns Stripe's answer; `PluginConnectionRepository` +2 methods; 4 audit events registered (229 → 233); en/he/es keys add-only (14 per language) with the old G-8 and delete-confirm keys left in place unread; G-8 owner text, DangerZonePanel fallback and admin copy updated; U-1 label isolated in `STRIPE_REMOVE_BUTTON_KEY`. Tests: 7 new files, 52 + 33 touched-area and guard suites green. The one red is the pre-existing Windows-only path-separator failure in `stripeDecidesConnectStatus.guard.test.ts` ("is actually reading the directory"), which fails identically on `main`. Typecheck on touched files: only pre-existing classes remain (`entityType 'stripe_connect_account'` not in `AUDIT_ENTITY_TYPES`, at the same lines as before and in four other Connect routes; Button `variant="destructive"` in `StripeConnectStatus`), left for SA because fixing the first widens a runtime client-write allow-list. `npm run build` not run here (the full `tsc` alone takes over 10 minutes on this machine). Spike could not run, so `ALREADY_GONE_ON_RETRIEVE` ships empty |
| 2026-10-30 | SA code review fixes (Dev) | F-1: new add-only key `config.stripe.refused.record_not_removed` (en/he/es; "Stripe has released the account, but we could not finish removing it here. Contact us at {support}."), mapped in `stripeConnectExitCopy.ts`, so both UIs never say "Nothing was changed" for it; both step-7 failure logs carry `alert: true`; a copy test (all three languages) and two route tests (Connect row, plugin row) prove the owner text. F-2: §8 X-1 rationale corrected (a revoked account gets "contact us", not "already gone"); X-9 (owed Connect-sandbox spike) and X-10 (support runbook for a stale Connect row) added. F-3: `StripeConnectStatus` Remove confirm uses `variant="default"` with the red classes, which clears its tsc error. F-4: `check_failed` reworded neutrally (a D5 key, new in this PR). Tests: 98 suites / 1619 tests in the touched area plus the guards, all green except the pre-existing Windows-only `stripeDecidesConnectStatus` path-separator test (F-7). Targeted tsc: only the four X-11 `entityType` errors remain in touched files |
| 2026-10-30 | QA fixes B-1, B-2, E-4 (Dev) | B-1: `refusalLines` renders a `contact_support` (or any unnamed) blocker as the existing contact-us line `config.stripe.refused.not_available` with the address from `supportContact.ts`. It comes once, after the named lines, and is never "try again" or dropped; a blocked answer with no blockers reads the same. No new key. B-2: both `record_not_removed` returns write a non-blocking `STRIPE_CONNECT_DELETE_REFUSED` row with `reason: 'record_not_removed'`, `step: 'remove_rows'`, `table` (`stripe_connect_accounts` / `plugin_connections`), `how` and `account_kind`. A refusal, because our record was not removed; no new event, so the counts stay 233 / 70. E-4: English fallback for `config.stripe.delete_account` (one line), so a U-1 revert never reads as the generic sentence. Tests: two copy tests (contact-only and mixed lists), and the F-1 route tests now assert the B-2 audit row, plus one for an audit failure on that path. 113 suites / 1,817 tests green, including QA's four files and the guards, except the pre-existing Windows-only F-7 test. Targeted tsc: only the X-11 `entityType` class (now five sites in the two routes) |

---

## SA Workplan Review — 2026-10-30

**Reviewed by SA on `a0804002`.** I checked the workplan's claims against the code: both routes, `StripeService` L1590–L1650, `stripeAccountContext.ts` L85–L127, `PluginConnectionRepository`, `ResetGuard.ts`, `selfServiceDeletion.ts` L70–L100, `rateLimit.ts`, `cancelPlan.ts`, `stripe-plugin-v2.json`, and the FKs and triggers in the payment-tables migration. I also checked the en/he/es labels and requirement §6.2, §7, §8.1 P-8, §9.2 and §11 B.1/B.2, plus parent §17 and XC-5.

**Verdict: APPROVED WITH CHANGES.** The design is right. Stripe answers first, our rows go only on a confirmed release, refusals are honest, the check runs before any Stripe call, there is no body, there are no caller ids, and no migration is needed. K-4 is closed correctly. The changes below must go into the build. W-4, W-8, W-9, W-10 and W-11 must be settled before T-4/T-7 start. The rest can be done during implementation. None of them needs another SA workplan pass. They will be checked at code review.

### Rulings on the open questions

| # | Q | Ruling | Priority |
|---|---|---|---|
| **W-1** | Q-1 | **Confirmed.** D-2 means "the Connect delete refuses while client money is in flight, decided by the G-9 rows of `runAccountDeletionCheck`" (SA-14; the parent's created-row text says "refuse delete with running client plans"). This filter is the button's own: G-9 only. It is not the XC-5 filter, which serves the deletion path; say so in a code comment so nobody "aligns" them. **One addition:** when the check returns `blockers: [{ guard: 'unknown' }]` (the engine saw a block but parsed nothing, `selfServiceDeletion.ts` L89), Delete returns `unreadable` (503), **not** `clear`. While an account is linked, G-8 is always present, so an `unknown`-only list means the parse failed. | High |
| **W-2** | Q-2 | **Approved, narrowly.** Delete may fall back to `countLocalBlockingState` + `decideLocalPrecondition` **only when the outcome is `kind: 'unavailable'`** (no email, secret not configured, function out of date). On `kind: 'failed'` it returns 503 and never falls back. A broken engine is not a missing one. Log the fallback at `warn` with the reason. Disconnect uses the local counts filtered to C1 (approved). Reuse `decideLocalPrecondition` and `LOCAL_BLOCKING_CONDITIONS` as they are, with no hand-written predicates, and keep `count: null` → `unreadable`. | High |
| **W-3** | Q-3 | **Use one server-side client id, `STRIPE_CLIENT_ID`, for both sources, with no per-source branching.** Deauthorize is authenticated with `STRIPE_SECRET_KEY`, and `client_id` must be the `ca_…` id of *that same* platform. There is only one per key mode. Both OAuth paths exchanged their codes with `STRIPE_SECRET_KEY` (`StripeService.handleOAuthCallback`; the plugin JSON's `client_secret: ${STRIPE_SECRET_KEY}`). So every linked account, whichever table it sits in, belongs to that one platform, and the two env vars can only legitimately hold the same value. A client id is not a secret, so `NEXT_PUBLIC_` is not a leak. But server-only code must not take its authority from a browser-exposed variable. If `STRIPE_CLIENT_ID` is unset, refuse with `not_available`, make **no** Stripe call, and log at `error` (a config fault). The "two client ids" risk row (§11) shrinks to that. Making the two vars match is a TL / env-inventory item (X-7), not D5 code. | Medium |
| **W-4** | Q-4 | **Only the `retrieve` step can decide "already gone". An error from `del` or `deauthorize` never can.** Stripe's OAuth `invalid_client` means both "not connected" and "wrong client id", so a deauthorize error cannot prove anything. The T-2 spike **adds case (d): a test-mode key retrieving a live-mode account id.** Stripe answers that with a "similar object exists in live mode" `resource_missing`. Any code that also shows up in (d) **does not** count as gone. If a deleted Express account cannot be told apart from (d), that case returns `not_available` (contact us) instead of clearing G-8. Match on `code` (and `statusCode`), not on the error class: a revoked Standard account can come back as a permission-type error. Record the exact `{type, code, statusCode}` for (a)–(d) in §14 before T-4, and use those recorded shapes as the unit-test fixtures. | High |
| **W-5** | Q-5 | **Delete the row: approved.** G-8 counts any row, and the row holds tokens we no longer need. Two conditions apply. (a) A row is deleted **only if its own account id was released in this call** (`deleted`, `deauthorized` or `already_gone`). Never delete the plugin row "by key" when its account was never sent to Stripe. (b) Invalidate `pluginStatusCache` **in the route**, not in the repository: the cache lives in `app/api/plugins/user-status/route.ts`, and a repository must not import a route module. The repository method stays data-only: `.delete().eq('user_id').eq('plugin_key')`, `{ count: 'exact' }`. | Medium |
| **W-6** | Q-6 | **No rate limit in D5.** `lib/security/rateLimit.ts` is the brake for *unauthenticated* endpoints. It is keyed by hashed IP, not by user, so "keyed by user" would mean extending a shared S-17 surface. It also writes a row on every press. §12 does not ask for it here, and these are two rarely-pressed buttons behind a session. Drop step 2 from §3.3 and §3.4 and T-list mentions. | Low |
| **W-7** | Q-7 | **One PR.** D5a alone would leave both UIs showing a generic failure for the new refusals. After W-6/W-9, the estimate fits the 2.5 d cap. | — |

### Design rulings

| # | Area | Ruling | Priority |
|---|---|---|---|
| **W-8** | Reading the rows (§3.3 step 3) | **Do not use `resolveConnectAccounts` / `resolveUserConnectAccounts` for the delete decision.** It destructures `{ data }` and **drops the Supabase error** (`stripeAccountContext.ts` L92–L106). A failed plugin-row read therefore looks like "no plugin account", and step 6 would then delete a plugin row whose account was never released. That is K-4 again, through the side door. Read each table through an error-surfacing repository call instead: `StripeConnectRepository.findByUserId` and `PluginConnectionRepository.findByUserAndPlugin`. Treat "not found" (including PGRST116) as no row, and treat any other error as 503 `check_failed`, before any Stripe call. De-duplicate by account id in the route (or in `connectRelease`). The resolver stays as it is; the file is not ours to edit. | High |
| **W-9** | More than one distinct account | **Refuse up front with 409 `not_available`, before any Stripe call, and drop the partial-release branch** in §3.3 step 5. The resolver already logs this case as an anomaly. It is legacy and rare. Handling it partially would make "Nothing was changed" untrue (C-9) and needs extra mapping and tests. Support handles it. The healthy case is the same account in both tables (the Express placeholder), which is one account: release it once, then delete both rows. | High |
| **W-10** | A Standard account shared by two businesses | Deauthorize revokes **the platform's** access to the account, so it would cut off every business on our platform that uses it. That is a cross-tenant effect at Stripe that no `.eq('user_id')` can stop. The same owner can link the same Standard account to two businesses through OAuth (Stripe returns the same `stripe_user_id`), and `plugin_connections` has no uniqueness on the account id. (`stripe_connect_accounts.stripe_account_id` is `UNIQUE`.) **Before releasing, confirm that no other user's row in either table names the account.** If one does, return `not_available` and make no Stripe call. Run the check on both paths: it costs one query. Implement it as an add-only repository read that is cross-user by design and **returns a count or a boolean only**, so no other tenant's data leaves the repository. Give it a rule-4 comment. `findOwnerIdByStripeAccountId` already exists for the connect table. Test: another owner exists → no `deauthorize` / `del` call and no row deleted. | High |
| **W-11** | A refused deauthorize | Map **every deauthorize refusal to `not_available`** (contact us), not to `stripe_refused`. The `stripe_refused` copy explains a refusal by "a balance or a payout on its way". That is true for an Express `del` and false for a Standard deauthorize, which does not care about balances (C-9). A refused deauthorize is a platform-side fault (client id, Stripe state) that the owner cannot wait out. `stripe_refused` is used for Express `del` only. | High |
| **W-12** | Audit | Removing or disconnecting a payment account is a money/access change. On the **success** path of both routes, `await auditTrail.flush().catch(…)` after `log()` (new-api-route skill, WC-7). Refusal audits are `log().catch()` only, with no flush. `details` carries codes, counts, `how`/`reason` and the Stripe `{type, code}`, never Stripe's `message` and never anything about another tenant (W-10 logs "shared: true" only). Register the two new actions (`STRIPE_CONNECT_DELETE_REFUSED`, `STRIPE_CONNECT_DISCONNECT_REFUSED`) in `lib/audit/eventAudience.ts` at DELETE's S-9 anchor (add-only), and add that file to §5. The two existing `STRIPE_CONNECT_ACCOUNT_*` actions are unregistered today; you may add them in the same block. | Medium |
| **W-13** | Error format | `error` carries a stable code, following the deletion-check route's `error: 'blocked'` + `blockers` precedent. Add `details` only behind the `NODE_ENV === 'development'` guard, and even there only `{type, code}`, never the message. The outer `catch` stays a generic 500. The 401/404/409/502/503 statuses are approved. `stripeConnectExitCopy.ts` must map any unknown code to a generic "could not complete, nothing was changed" key, so a new server code can never print raw text (the old `alert(result.error)` problem). | Medium |
| **W-14** | Tenant isolation (`tenant-isolation-guard`) | **Step 1 is passed, apart from W-10.** There is no body, no caller-supplied id, no upsert, and a fixed literal patch. The account id comes only from our own rows. The only trigger on `stripe_connect_accounts` is `updated_at`. **No FK references either table** (verified), so a row delete cascades nothing. That is also what makes the copy "your past payments stay in your records here" true. The rule-4 comments on `supabaseServer` are approved. W-10 is the one effect that reaches past the tenant, and it is at Stripe, not in the DB. | — |
| **W-15** | Migration | **None needed: confirmed.** The release state lives at Stripe, rows exist until confirmation, and with no retry queue (BQ-19) there is no "release pending" state to store. G-8 is already strict over both tables (SA-14). No policy changes. Number 20261101 stays free. | — |
| **W-16** | Copy (C-9) | The drafts are truthful, and the labels match the live keys (`config.title`, `config.tab.payments`, `nav.payments`, `config.stripe.disconnect`) in all three languages; the Hebrew `←` direction is right for RTL. Changes: (a) the `stripe_refused` copy is shown for Express only (W-11). (b) *Suggested:* the Express confirm text adds that the owner will no longer be able to open that account's Stripe dashboard. (c) *Low:* the Hebrew G-8 text quotes the button, `"נתק"`, rather than the noun `ניתוק`. (d) The UI shows the Express text when our row's `stripe_account_type` is `express`/`custom`, and the Standard text otherwise; a plugin-only row is the OAuth path, so Standard is right. (e) `{support}` comes from `lib/business-os/supportContact.ts`, not a literal. (f) The `{n}` plural matches the existing drawer strings; acceptable. QA check: a `pending` and a `paused` client plan can each be ended from Orders. `cancelPlan` closes a `pending` plan locally, so the "end them in Orders" instruction holds only if the UI offers the button for those statuses. | Medium |

### Cross-session items

| # | Ruling |
|---|---|
| **W-17** | **X-1 to X-6 are correctly scoped.** The webhook files are not touched (PLAN PAYMENTS), and there are no S-1 files or EXPORT surfaces. `stripeAccountContext.ts` is read-only. Three claims are missing and go into T-1: **(a)** `StripeService.ts`. B.1 grants DELETE the "OAuth deauthorize" method only, so `retrieveConnectedAccountKind` and the changed return type of `deleteConnectedAccount` (its only caller is the delete route; verified) need a claim. **(b)** Translations (S-7 is "add only, never edit or delete"). List each *edited or removed* pre-existing key in the claim: `config.stripe.delete_account` (relabel), `config.stripe.delete_message` (removal; its only reader is `ConfigurationDialog.tsx` L1320), `config.stripe.delete_title`. Put the new `config.stripe.refused.*` / `delete_message_*` keys in one block at DELETE's anchor. **(c)** `lib/audit/eventAudience.ts` (S-9, W-12). New items: **X-7** (TL, env inventory): `STRIPE_CLIENT_ID` and `NEXT_PUBLIC_STRIPE_CLIENT_ID` must hold the same value, or the plugin should read the server one (W-3). **X-8** (TL, for the purge owner): `ResetGuard.ts`'s `try/catch` around `resolveConnectAccounts` never fires, because the resolver swallows read errors (W-8). A failed read there reads as "no account" and gets past Reset control 1. This is a finding only, not D5 work. |

### Proportionality and tests

| # | Ruling | Priority |
|---|---|---|
| **W-18** | Test plan approved, with three additions: the W-1 `unknown`-only case, the W-8 read-error case (plugin read fails → 503, no Stripe call, no delete), and the W-10 shared-account case. The source guard stays minimal: the delete route imports `releaseConnectedAccount`/`checkConnectExit` and not `getStripeService`, neither route reads `request.json()`, and Disconnect calls the check before `update(`. Drop the "no `catch` followed by `delete(`" regex: it is brittle across formatting, and the K-4 route test already proves the behaviour. Normalise CRLF. | Low |
| **W-19** | The design is proportionate. Two small modules with injected deps, one add-only repository method, no queue, no lock, no webhook, no migration. W-6 and W-9 remove work; W-8 and W-10 add about 0.15 d. Expected total **≈ 2.4 d**, inside the 2.5 d cap. Add nothing beyond this list. In particular: no row lock against the check-then-release race (accepted, the same window as the deletion path), no Stripe-side subscription listing, and no fix for plugin-only Disconnect (it still returns 404; note it in the as-built text). | — |

### Approval

- [x] Workplan approved. Proceed to implementation with W-1…W-19 applied. W-4 (spike codes recorded in §14), W-8, W-9, W-10 and W-11 are conditions to settle before T-4/T-7. Everything else is checked at code review.

---

## SA Code Review — 2026-10-30

**Reviewed by SA** on the uncommitted tree in `neuronforge-d5` (`feature/stripe-connect-exit-d5`, base `a0804002`). I read all 17 modified files and the 11 new files (the diff, plus the full text of both routes, `connectRelease.ts`, `connectExitGuard.ts`, `stripeConnectExitCopy.ts` and the tests). I also checked the code the change relies on: `findByUserAndPlugin` (`.single()`), `StripeConnectRepository.findByUserId` / `delete` / `findOwnerIdByStripeAccountId`, the `(user_id, plugin_key)` upsert conflict key (one `stripe` row per user), `AuditTrailService.buildLogEntry`, `requestSchemas.ts` `CLIENT_WRITABLE_ENTITY_TYPES`, `ownerVisibility.ts`, `components/ui/button.tsx`, the GET `stripe-connect` route (it returns the whole row, so `stripe_account_type` reaches the UI), and the en/he/es labels.

**Verdict: APPROVED WITH CHANGES.** The server half does what was ruled. Stripe answers first. Our rows go only on Stripe's own positive answer. Every refusal comes before any write, and the early ones come before any Stripe call. No body is read, and no id comes from the caller. K-4 is closed, and the route test proves it. **F-1 and F-2 must be done before RM commits.** F-3 is strongly recommended in the same PR. The rest are notes. No further SA pass is needed: QA can check F-1 and F-2 as part of its run.

### Verification run by SA

| Check | Result |
|---|---|
| Touched-area Jest (`app/api/payments/stripe-connect`, `lib/business-os/account-deletion`, `PluginConnectionRepository*`, `components/payments`, `components/business-os/account-deletion`, `components/business-os/purge`, `lib/audit`, `app/admin/users`) | **88 / 89 suites, 1409 / 1410 tests green.** The one red is `stripeDecidesConnectStatus.guard.test.ts` › "is actually reading the directory". The file is unchanged from `a0804002`, and the failure is the Windows path separator in `endsWith('create-account-custom/route.ts')`. Its second test, the one that matters (no `z.object` names a Stripe-owned field), passes and covers the two rewritten routes |
| `lib/repositories` (all) + `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts` | 132 / 132 suites, 3198 tests green |
| Targeted `tsc` (a temporary tsconfig over the 14 touched source files and their imports; it ran to completion with no OOM, and the file was removed afterwards) | Touched files show **only** the two pre-existing classes: `entityType 'stripe_connect_account'` (delete L95, L182; disconnect L77, L113) and `variant="destructive"` (`StripeConnectStatus.tsx` L527). Nothing new |
| ESLint on the 9 touched source files | 0 errors. 8 warnings, all pre-existing in `ConfigurationDialog.tsx` (unused imports, two `any`) |
| `console.*` in every touched file | 0 |
| `NEXT_PUBLIC_`, secret or key literals added in the diff | none. `STRIPE_CLIENT_ID` is read only in `connectRelease.ts`, which is `server-only` |
| Files outside §5 | none. The webhook files, `stripeAccountContext.ts`, `generate-test-account-cleanup-sql.ts` and the existing FX-1 guard are untouched |
| Translations | add-only: 51 `+` lines and 0 `-` lines across the three files (14 keys per locale, plus comments) |
| `npm run build` | **not run** (by Dev or by SA). This is still owed as ship-drill step 1 before RM opens the PR |

### Rulings carried from the workplan review

| Ruling | Built as ruled? |
|---|---|
| W-1 `unknown`-only → unreadable; G-9-only filter; XC-5 comment | ✅ `verdictFromCheckRows`, plus the module header comment |
| W-2 fallback only on `unavailable`; `failed` → 503; warn log | ✅ `checkConnectExit`. Reuses `decideLocalPrecondition`; `count: null` → unreadable |
| W-3 one server `STRIPE_CLIENT_ID`; unset → `not_available`, no call, error log | ✅ `step: 'config'`, logged at `error` with `alert: true` in the route |
| W-4 only retrieve decides "gone"; list ships empty; match on code + status | ✅ `ALREADY_GONE_ON_RETRIEVE = []`, `matchesShape`, a test pins the empty list |
| W-5 rows deleted only for the released account; cache invalidated in the route; repo data-only | ✅ |
| W-6 no rate limit | ✅ |
| W-8 error-surfacing reads; PGRST116 = no row; else 503 before Stripe | ✅ (the one-row-per-user conflict key means `.single()`'s PGRST116 can only mean "no row") |
| W-9 more than one account → 409 before Stripe | ✅ |
| W-10 cross-user count only, rule-4 comment, both tables, `shared: true` only | ✅ see the tenant section |
| W-11 every deauthorize refusal → `not_available` / `stripe_unreachable` | ✅ `stripe_refused` only on the `del` step |
| W-12 success awaited + flushed; refusals `.catch` only; 4 events registered | ✅ both routes; 229 → 233, BOS 66 → 70 |
| W-13 stable codes; dev-only `{type, code}`; unknown code → generic | ✅ but see F-1 for one code that is "known" to the server and generic to the UI |
| W-16 copy (Express dashboard line, Hebrew `"נתק"`, kind by row type, `{support}` from `supportContact.ts`) | ✅ all six |
| W-18 guard minimal, CRLF-normalised, comments stripped; the three added tests | ✅ |

### Tenant isolation (`tenant-isolation-guard`) and repositories

- Step 1 holds. The user comes from `getUser()`, and no body is read (pinned by the guard and by a route test that sends a body). Every scoped read and write is `.eq('user_id', user.id)`. The account id comes only from our own rows, and the plugin-row id is checked against `^acct_[A-Za-z0-9]+$` before use.
- **The W-10 read is correct.** `countOtherUsersNamingStripeAccount` returns a head count only: `{ count: 'exact', head: true }`, so no row reaches JS. It is `⟨unscoped-by-design⟩` with a rule-4 comment. It re-validates the id shape **before** the id is put into the `.or()` filter string, which closes PostgREST filter injection, and a test pins that. It is a SELECT, so the UPDATE + `.or()` + `.select()` PostgREST defect does not apply. The connect-table half reuses the existing `findOwnerIdByStripeAccountId` (`maybeSingle`, unique column). The owner id is compared and dropped inside `isStripeAccountShared`. Any read error → `unreadable` → 503, never "not shared".
- Rule 1: there is no `.from()` in either route or in the new modules.

### Rulings asked for

**(a) The spike shipping `ALREADY_GONE_ON_RETRIEVE` empty is acceptable for this slice.** It is the C-5 safe direction: G-8 is never cleared without Stripe's positive answer. The cost is that two cases get "contact us" instead of a clean removal: an owner who revoked us from their own Stripe dashboard, and a retry after a step-7 DB failure. Neither loses money, and both are rare. Conditions: F-1 and F-2.

**(b) A `deleted: true` answer from retrieve is handled, and handling it is right.** `StripeService.retrieveConnectedAccountKind` reads it defensively (the SDK does not type it on `Account`), and `connectRelease` maps it to `released / already_gone`, with no further Stripe call. This is tested. It is safe to trust because it is Stripe's own positive object, not an error shape, so spike case (d) (a test key reading a live id) cannot produce it. In practice Stripe usually answers a retrieve of a deleted account with an error, so this branch will rarely fire. It still costs nothing.

**(c) The two pre-existing tsc errors.** D5 **need not** fix the `entityType` one. It is type-only: `AuditTrailService.buildLogEntry` writes `entity_type` without checking it at runtime, so all four audit writes land. The same literal is in four other Connect routes. One correction to the Dev's reason: browser writes are gated by the separate `CLIENT_WRITABLE_ENTITY_TYPES` list, so registering the type would not widen them. The real cost is that `AUDIT_ENTITY_OWNER_VISIBILITY` must give it a visibility, and an `'operator'` choice would change the owner-policy migration pin. That is a small follow-up for the audit owner, not D5 (X-11 below). The `variant="destructive"` error is F-3: D5 relabelled that exact button, and the error is visible to users.

### Code Review Comments

| # | Where | Finding | Priority |
|---|---|---|---|
| **F-1** | `delete/route.ts` L161–L175 + `stripeConnectExitCopy.ts` `PLAIN` | **C-9.** When Stripe has already deleted or deauthorized the account but our row delete fails, the route answers 500 `record_not_removed`. The copy module does not know that code, so both UIs show the generic text, *"This could not be completed. **Nothing was changed.** Please try again."* That is false: the account is gone at Stripe. A retry will then be refused as `not_available`, because the list is empty. **Fix:** add `record_not_removed` to `PLAIN` with a new add-only key `config.stripe.refused.record_not_removed` in en/he/es, saying for example *"Stripe has released the account, but we could not finish removing it here. Contact us at {support}."* (Standard: "released" covers both deleted and access removed). Add a copy test and the parity line. Log both step-7 failures with `alert: true` (as the `config` refusal already does), because support must act on them | **Blocking** (before commit) |
| **F-2** | Workplan §8 X-1, §3.3 note, cross-session list | §8 X-1 still says *"D5 already treats a revoked account as `already_gone` when the owner presses Remove"*. With the empty list, that is no longer true: a dashboard-revoked owner gets "contact us". Correct the X-1 rationale. X-1 now matters more than "only improves what the UI shows". Add two rows: **X-9** (TL / Dev, owed): the Connect-sandbox spike of §14, cases (a)–(d). A shape goes on the list only with its recorded fixture. **X-10** (TL): a support path for "contact us" Connect refusals. Today nothing but hand SQL clears a real business's stale `stripe_connect_accounts` / `plugin_connections` row after support has confirmed at Stripe that it is gone. A short runbook is enough for now. Doc-only | **Blocking** (before commit; doc) |
| **F-3** | `components/payments/StripeConnectStatus.tsx` L527 | `variant="destructive"` is not a `Button` variant, so `variantClasses[variant]` is `undefined`. The irreversible **Remove connection** confirm button renders with no background or colour, beside an outlined Cancel. This is pre-existing, but D5 relabelled this exact button. Use `variant="default"` with the red classes the ConfigurationDialog confirm already uses (`text-white bg-red-500 hover:bg-red-600`), or add a `destructive` variant to `button.tsx` (shared primitive, so the first option is the proportionate one). That also clears the file's tsc error | Should-fix (same PR) |
| F-4 | `stripeConnectExitCopy.ts` `check_failed` | The text names "your client payments", but the route also uses `check_failed` for a failed read of our own row (`read_connect` / `read_plugin`) and for the W-10 shared check. It stays truthful where it counts ("Nothing was changed. Please try again"). Optional: make it neutral ("We could not check this right now …") | Note |
| F-5 | `connectExitGuard.ts` `verdictFromCheckRows` | A `checked` outcome with `canDelete: false` and an **empty** blocker list reads as `clear`. Today that case is unreachable, because `runAccountDeletionCheck` turns "blocked, nothing parsed" into one `unknown` row. Optional hardening: treat `rows.length === 0` under `canDelete: false` as `unreadable` | Note |
| F-6 | translations, `DangerZonePanel` | Left in place unread, which is correct under S-7 add-only: `config.stripe.delete_account`, `delete_title`, `delete_message`, `settings.account_delete.blocker.stripe_connected` (and its fallback), and `payments.stripe.disconnect_title/_desc/_warning/_button` (no reader left in `app/` or `components/`). Record them for a later key sweep | Note |
| F-7 | `stripeDecidesConnectStatus.guard.test.ts` | The pre-existing Windows-only red (path separator). It is not D5's file, and Linux CI is unaffected. If someone fixes it, normalise `\\` → `/` in `filesUnder` | Note |

### Further follow-ups (not D5)

- **X-11** (audit owner): register `stripe_connect_account` in `AUDIT_ENTITY_TYPES` with an owner-visibility decision. This clears the type error in all six Connect routes in one place.

### Mechanical fixes made by SA

None. A temporary `tsconfig.sa-d5.json` was created at the worktree root to run the targeted typecheck and was deleted straight afterwards. `git status` is as the Dev left it.

### Code Approved for QA: Yes, once F-1 and F-2 are done (F-3 recommended in the same pass). QA's manual critical path (§9) stands. Add one check for F-1: force the row delete to fail, for example with a mocked repository in a route test, and confirm the owner text no longer says "Nothing was changed".

---

## QA Report — D5 (2026-10-30)

**QA, 2026-10-30.** Tested the uncommitted tree in `neuronforge-d5` (`feature/stripe-connect-exit-d5`, base `a0804002`), after the Dev reported F-1 to F-4 done.
**Test mode:** full · **Strategy:** A + B (Jest unit and route tests over mocked edges; the real `connectRelease` and `connectExitGuard` are wired into one route suite) · **Focus:** api, security, ui (copy) · **Input source:** TL brief.
**Skipped:** the §9 manual Stripe test-mode path (it needs a Connect-platform test key, the same blocker as the §14 spike; owed with X-9) and `npm run build` (the TL is running it in this worktree).

### Verdict: **PASS WITH NOTES**

No High or Medium bugs. Two Low bugs (B-1, B-2) are listed below. Neither changes money or our rows the wrong way, so neither blocks commit; the TL decides whether they go into this PR.

### Test counts

| Run | Suites | Tests | Result |
|---|---|---|---|
| Touched area before QA (`app/api/payments/stripe-connect`, `lib/business-os/account-deletion`, `PluginConnectionRepository*`, `components/payments`, `components/business-os/account-deletion`, `components/business-os/purge`, `lib/audit`, `app/admin/users`) | 89 | 1412 | 1411 pass, 1 known red |
| The same area plus `lib/stripe` and the QA files | 104 | 1607 | 1606 pass, 1 known red |
| The four new QA files alone | 4 | 84 | 84 pass |

The one red is `stripeDecidesConnectStatus.guard.test.ts` › "is actually reading the directory". It is the known Windows path-separator failure (F-7), also red on `main` locally.

**QA files added. All are new, with 0 CR bytes:**

- `app/api/payments/stripe-connect/delete/__tests__/route.d5.qa.test.ts` (26 tests). The route runs with the REAL release and guard modules; only `getStripeService`, the repositories, the check engine and the local counts are faked.
- `lib/stripe/__tests__/connectExitMethods.qa.test.ts` (12 tests). `retrieveConnectedAccountKind`, `deauthorizeConnectedAccount` and `deleteConnectedAccount` against hand-built Stripe answers.
- `components/payments/__tests__/stripeConnectExit.d5.qa.test.ts` (40 tests). Copy drift, placeholders, F-1 in all three languages, C-9 text per account kind, G-8 wording, and source checks on the screens and on Disconnect.
- `components/payments/__tests__/StripeConnectStatus.rtl.d5.qa.test.tsx` (6 tests). A Hebrew RTL render of the Remove refusal.

### Coverage against the brief

| Behaviour | Tested | Result | Evidence |
|---|---|---|---|
| Delete refuses before any Stripe call: Connect or plugin read error → 503 | ✅ | Pass | Dev route suite (W-8) |
| … more than one distinct account → 409 `not_available` | ✅ | Pass | Dev suite (W-9). QA: a plugin row whose `stripe_account_id` is malformed while `id` is valid also refuses |
| … account shared with another user (W-10) → 409, no Stripe call, nothing about the other business in the body, logs or audit | ✅ | Pass | QA: via the plugin count, and via another owner's Connect row, with the real `isStripeAccountShared` |
| … client money in flight (G-9) → 409 with counts | ✅ | Pass | QA: the real `toBlockerViews` over G-8 + two G-9 rows |
| … a check that returns only `unknown` → 503 | ✅ | Pass | QA end to end |
| … a check that FAILED → 503, never the local fallback | ✅ | Pass | QA: `countLocalBlockingState` not called |
| Local fallback only when the check is unavailable (C1 blocks; C3 alone does not; no email → local) | ✅ | Pass | QA |
| Standard → deauthorize with our account id and `STRIPE_CLIENT_ID`; Express/Custom → delete | ✅ | Pass | QA: a plugin-only Standard account deauthorizes and removes only the plugin row; `del` is never called |
| Rows deleted only on Stripe's positive answer, after it, and only for the released account | ✅ | Pass | QA: call order checked; with two rows naming one account (Connect by `stripe_account_id`, plugin by `id`), one retrieve, one delete, both rows go; a `deleted:false` or a different echoed id removes nothing |
| `STRIPE_CLIENT_ID` unset, empty or whitespace → 409, no Stripe call, an `error` log with `alert:true` | ✅ | Pass | QA |
| Every Stripe error refuses; timeout or network at retrieve, deauthorize or delete → 502; a raw `fetch failed` with no Stripe type → 409; `resource_missing` on retrieve → refusal (`ALREADY_GONE_ON_RETRIEVE` is empty) | ✅ | Pass | QA |
| A refused deauthorize → `not_available`, never `stripe_refused` | ✅ | Pass | Dev and QA |
| F-1: Stripe released but the row delete fails → 500 `record_not_removed`; the owner text never says "Nothing was changed" | ✅ | Pass | Dev route suite (en). QA: en, he and es, plus the Hebrew render |
| Disconnect blocked while client plans run (C1), allowed otherwise; never calls Stripe | ✅ | Pass | Dev suite. QA source check: no StripeService, `connectRelease` or `deauthorize` in the route |
| Errors never carry Stripe's message | ✅ | Pass | QA: in production and development, the body, every logger call and the audit carry no message, `ca_`/`sk_` text or client id; dev `details` is `{type, code}` only |
| Audit: success awaited and flushed; refusals `.catch` with no flush; 233 total / 70 BOS | ✅ | Pass | Dev suites and `eventAudience.test.ts` (green) |
| No secret in logs; no `console.*` | ✅ | Pass | QA log scan as above; grep shows 0 `console.*` in the touched files |
| Copy: en/he/es complete; the support address from `supportContact.ts`; C-9 confirm text per kind; label "Remove connection" | ✅ | Pass | QA: every key the copy module names exists in all three languages; the English fallback equals `en` key by key; no `{n}`, `{support}` or raw key survives in any refusal line in any language; `removeMessageKey` express/custom → Express, everything else → Standard; the Standard text never carries the Express "cannot be undone" sentence |
| UI: inline refusal, no `alert`, in ConfigurationDialog and StripeConnectStatus | ✅ | Pass | QA source checks on `handleDeleteAccount`, `confirmDeleteStripe` and `confirmDisconnectStripe`, plus the render. The remaining `alert(` calls in StripeConnectStatus are the pre-existing setup/dashboard paths, outside D5 |
| F-3: the red confirm button classes | ✅ | Pass | QA: source and render (`!bg-red-500 !text-white`), no `variant="destructive"` |
| G-8 wording in DeleteAccountDrawer, DangerZonePanel and admin `deletionCopy.ts` | ✅ | Pass | QA: `blockerCopyKey` → `stripe_linked`; the DangerZonePanel fallback equals `en`; the admin copy names Remove connection |
| Hebrew RTL render of the refusal | ✅ | Pass | QA: the dialog is `dir="rtl"`, the inline `role="alert"` holds the Hebrew line with the address, and a network failure shows the generic Hebrew line |
| Translations add-only | ✅ | Pass | `git diff` on en/he/es: 0 removed lines |
| New files have 0 CR bytes | ✅ | Pass | All 11 Dev files and 4 QA files have 0 CR. The modified tracked files are uniformly CRLF (autocrlf checkout) or uniformly LF (the two routes). None is mixed |
| Entitlements registration | n/a | — | The diff imports nothing from `lib/business-os/entitlements/` |

### Bugs

1. **B-1: an unnamed G-9 blocker reads as "try again"** (Low). File: `components/payments/stripeConnectExitCopy.ts`, `refusalLines`.
   - **Steps:** the check returns a G-9 row whose item text `toBlockerViews` cannot name, so the route answers 409 `client_money_in_flight` with `blockers: [{ code: 'contact_support' }]`.
   - **Expected:** a contact-us line, for example the `not_available` copy with `{support}`. Only we can clear that blocker.
   - **Actual:** the `COUNTED` filter drops `contact_support`, so the owner sees the generic *"This could not be completed. Nothing was changed. Please try again."* Every retry fails the same way. In a mixed list (`client_plans_running` + `contact_support`) the contact line is dropped silently.
   - The guard is right to block (fail safe). Only the words are wrong. This is rare, because today's engine item texts all map.
2. **B-2: the F-1 path leaves no audit row** (Low). File: `app/api/payments/stripe-connect/delete/route.ts`, the two `record_not_removed` returns.
   - **Situation:** Stripe has irreversibly deleted or deauthorized the account, but our row delete failed.
   - **Expected:** a non-blocking audit entry recording that Stripe released the account. One option is `STRIPE_CONNECT_DELETE_REFUSED` with `reason: 'record_not_removed'`, `how` and `step`.
   - **Actual:** no audit entry, neither the success event nor a refusal. There is only a Pino `error` with `alert: true`. The audit trail for this account then never shows the Stripe-side release, and support (X-10) has to rebuild it from logs.

### Edge notes

- **E-1:** ConfigurationDialog shows Remove for a plugin-only account only when its row is `status === 'active'`. G-8 counts a `stripe` row whatever its status. An owner with an expired or inactive plugin row is blocked by G-8 text that names a button they cannot see. This is a pre-existing UI condition, and support handles it (X-10).
- **E-2:** Disconnect on a plugin-only account returns 404 `No payment account found`, which the UI shows as the generic "Nothing was changed. Please try again." This is known and accepted (W-19, as-built note).
- **E-3:** A lost response, or the outer `catch` 500, after Stripe has released shows the generic "Nothing was changed". The client cannot know otherwise. It is rare, and a retry then gets `not_available` (contact us).
- **E-4:** The U-1 revert note says to set `STRIPE_REMOVE_BUTTON_KEY` back to `config.stripe.delete_account`. That key has no `FALLBACK` entry, so if a translation were missing the button would read as the generic refusal sentence. Add a fallback if U-1 is reverted.
- **E-5:** `retrieveConnectedAccountKind` treats `controller.type === 'account'` as Standard. An owner-controlled account that was never OAuth-linked would fail deauthorize and get `not_available`. That is the safe direction.
- **E-6 (theoretical):** a Connect row with an empty `stripe_account_id` drops out of the de-duplication, and would be deleted alongside a released plugin account. A Connect id that is not `acct_`-shaped makes the W-10 count throw, which gives 503 every time. Both are safe or harmless, assuming the column holds real ids.
- **E-7:** The §9 manual Stripe test-mode path (an Express account with a balance, after payout, a Standard revoke, a running plan) is still owed. It needs a Connect-platform test key (X-9).

### Final status

- [x] All acceptance criteria in the brief pass under test. Ready for commit once the TL's `npm run build` is green; B-1 and B-2 are Low, at the TL's discretion
- [ ] Issues found that Dev must address before commit: none blocking
