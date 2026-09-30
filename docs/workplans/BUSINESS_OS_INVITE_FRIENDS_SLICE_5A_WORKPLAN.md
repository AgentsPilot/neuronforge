# Workplan: Business OS Invite-Only Signup, Slice 5a (Champion "Invite friends")

> **Last Updated**: 2026-09-30

**Developer:** Dev
**Requirement:** [BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md): §7.9 FR-28 to FR-33 and FR-38, §8.1 to §8.3, §17 (T-17 to T-21, **F5a-1 to F5a-16**), UD-5.1 to UD-5.3, BQ-13 to BQ-15
**Previous slices:** [Slice 0](/docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_0_WORKPLAN.md), [Slice 1](/docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_1_WORKPLAN.md), [Slice 2](/docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_2_WORKPLAN.md), [Slice 3](/docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_3_WORKPLAN.md)
**Date:** 2026-09-30
**Branch:** `feature/bos-invite-friend-5a`, cut from `origin/main` at `fe7f6410` (the #153 merge, the commit SA's §17 was checked against), in the `neuronforge-invite-s0` worktree. Upstream tracking unset. **F5a-1 is met:** every file and line reference below was re-checked on this branch.
**Status:** SA workplan review ✅ approved with conditions (R-1 to R-7 folded in). **Code Complete, uncommitted** (2026-09-30, §6.1). Waiting for SA code review, the user's look at the diff, then QA. **Merge only after `20261023` is applied and its checker is PASS (§4.1).**

> **Note on the requirement file.** The requirement with §17 exists only as an uncommitted file in this worktree (865 lines, carried over unchanged from `docs/bos-invite-slice-5-scope`). It has to be committed, by RM on its own docs branch or with this slice, before this workplan's links resolve on `main`.

## Overview

A Founding Partner (an account whose plan row holds the champion cohort, in force) gets an **"Invite friends"** section in Business OS settings. It shows **"N of 5 invites left"**, a form (friend's email, optional note, language), the champion's own list with statuses (Pending, Expired, Revoked; revoked and expired rows say the slot came back), and Revoke with a confirmation. Sending creates a **Paid invite to Essentials** issued by the account, emails it through the existing 2a path as "<Champion> via AgentPilot" with the champion's email as Reply-To, and shows the link once. The friend's invite page says "<Champion> invited you", shows the note, Essentials with its price and what it includes, "payment required", and **"sign-up for this invitation opens soon"**. It shows no form and creates nothing. Admins see account-issued rows in their list. **Everything ships inert** behind `accountInvitesAvailable: false`. No friend signup (5b), no payment (5c), no perks (FR-38).

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Implementation Approach](#2-implementation-approach)
3. [Files to Create / Modify](#3-files-to-create--modify)
4. [Migration `20261023`](#4-migration-20261023)
5. [API contracts](#5-api-contracts)
6. [Task List](#6-task-list)
7. [Traceability (F5a-1 to F5a-16)](#7-traceability-f5a-1-to-f5a-16)
8. [Test plan](#8-test-plan)
9. [Production manual check](#9-production-manual-check)
10. [Rollback](#10-rollback)
11. [Questions for SA](#11-questions-for-sa)
12. [Logging-standard check (console.*)](#12-logging-standard-check-console)
13. [SA Review Notes](#sa-review-notes)
14. [QA Testing Report](#qa-testing-report)
15. [Commit Info](#commit-info)

---

## 1. Analysis Summary

| Area | As built on `fe7f6410` | 5a change |
|---|---|---|
| Table `business_os_invites` | `issuer_kind` / `issuer_account_id` with the `one_issuer` CHECK (20261012). Indexes only on `token_hash`, `email`, `created_at`. `internal_reason` is required (3–500 characters); `revoke_reason` is required when revoked; `revoked_by_admin_id` may be NULL. `service_role` has `SELECT, INSERT, UPDATE`. | No column. A partial index, and one SQL function (§4). |
| Config `entitlements/config/invites.ts` | `INVITE_ISSUANCE_POLICY = { admin, paidInvitesAvailable: false, paidUnavailableReason }` | Adds the `account` entry, `accountInvitesAvailable: false`, and `FRIEND_INVITE_LIMITS` (5, 10 per 24 h). |
| Repository `BusinessOsInviteRepository.ts` (720 lines) | `ForAdmin`, public and redemption methods. The header already names `listForIssuerAccount` / `revokeForIssuerAccount` as the future shape. `revokeForAdmin` is the single `mutationOrSelect` exemption. | Three issuer-scoped methods. `issuer_kind` is added to `BUSINESS_OS_INVITE_PUBLIC_COLUMNS`, read on the server and never returned. |
| Redemption `inviteRedemption.ts:242` | `if (row.grant_kind === 'tier') return refuse(409, 'paid_invites_not_available')`. It runs before `emailHasAccount`, before any code is sent, and before any user is created, in all three entry points (`requestSignupCode`, `completeSignup`, `completeGoogleSignup`). | **Unchanged.** A new test pins it for an account-issued tier row (F5a-10). |
| Public view `publicInviteView.ts:160-165` | Runs the existing-account check for every matched, grant-available token. | Account-issued tier invites branch **before** that check, to a new state `signup_opens_soon` (F5a-10). |
| Email `inviteEmail.ts`, `inviteSender.ts`, `invite-invitation.ts` | `sendInvitationEmail` never throws and records its outcome with `recordInviteEmailOutcome`. The template already has `offer.kind = 'payment_required'`. | Reused as they are, with no parallel builder (F5a-6). |
| Admin list `adminInviteOps.ts`, `app/admin/business-os-invites/**` | `InviteListView` has **no issuer fields**, and the screen has **no issuer filter** (the state, type and email filters exist). | Adds `issuerKind`, `issuerAccountId` and `revokedByInviter` to the view (the pinned `INVITE_LIST_VIEW_KEYS`), plus an issuer filter (F5a-11). |
| Settings `app/business-os/settings/page.tsx` (1,289 lines, 0 `console.*`) | Collapsible rows are driven by the page's `expandedSection`. `PlanSection` is at line 1017. | One import and one JSX line. The section owns its own collapsible row, so when it is not eligible it renders nothing at all, header included. |
| Plan-row read | `BusinessOsAccountPlanRepository.findEntitlementInputs(accountId)`, which `redemptionDeps.ts` also uses. | Reused for the TypeScript eligibility pre-check. **SQL decides** (T-17). |
| Migrations | Highest file `20261020`. Two files share `20261012`. **`20261023` is free** (`ls supabase/migrations`, 2026-09-30). | `20261023_business_os_friend_invites.sql`. |

**Services not touched:** `EntitlementService` (the rule does not depend on the mode, T-17), the provider factory, and any LLM call.

---

## 2. Implementation Approach

### 2.1 Module layout

```
lib/business-os/invites/friendInviteOps.ts     pure ops: eligibility, summary+list, send, revoke; isCountedFriendInvite; toFriendInviteView
lib/business-os/invites/friendInviteDeps.ts    production wiring (server-only), shared by the two routes
app/api/business-os/friend-invites/route.ts                   GET summary+list, POST send
app/api/business-os/friend-invites/[inviteId]/revoke/route.ts POST revoke
components/business-os/settings/InviteFriendsSection.tsx      self-contained UI (own fetch, own row)
components/business-os/settings/inviteFriendsCopy.ts          en/he/es copy (the invitePageCopy.ts precedent)
```

The ops follow `adminInviteOps.ts`: pure functions that receive their repositories and clock, so the routes stay thin (auth, Zod, HTTP shape, audit).

### 2.2 Key decisions

| # | Decision | Why |
|---|---|---|
| D-1 | **Eligibility = the switch AND an in-force champion.** A pure `isInForceChampion(plan, now)` checks `cohort === FRIEND_INVITE_POLICY.issuerCohort` and `cohort_expires_at` NULL or later than `now`, reading `findEntitlementInputs`. It never calls `check()` or `getSnapshot()`. | T-17 (mode). The SQL re-check is what decides. The TypeScript check only decides what the GET shows, and saves the POST a round trip. |
| D-2 | **The send order** (F5a-6, **amended by R-3**): `.strict()` body parse → switch (a config constant, no I/O) → in-force champion read → own-email refusal (normalised; the session email) → name, Reply-To and language snapshot → token (C-3) → RPC → email. The email runs after the row exists, and a failure never fails the create (FR-16). A whitespace-only note is stored as NULL (R-7). | F5a-6; CLAUDE.md rule 2 (Zod before any business read, R-3). A non-champion with a bad body therefore gets 400, not 403. |
| D-3 | **The SQL function stamps `link_expires_at` and `email_attempted_at` from `now()`.** The expiry is `now() + make_interval(days => p_link_expiry_days)` with `INVITE_LINK_EXPIRY.defaultDays` passed in. The function returns `(result_outcome, result_invite_id, result_link_expires_at)`. The TypeScript side then builds the `InvitationEmailRow` from what it sent plus what came back. | One clock for the count and the expiry. The `expiry_after_creation` CHECK holds by construction. The prefixed OUT names avoid plpgsql column ambiguity. |
| D-4 | **Fixed server strings.** `internal_reason` = `'Friend invite from a champion account'`, and `revoke_reason` = `'Revoked by the inviting champion'`. Both are constants in `friendInviteOps.ts`. `revoked_by_admin_id` stays NULL, which on an account-issued row means "revoked by the inviter". That is said in code and derived as `revokedByInviter` in the admin view. | §17.1 "New" fact; F5a-8. |
| D-5 | **Revoke = one count-only UPDATE:** `.eq('id')` `.eq('issuer_kind','account')` `.eq('issuer_account_id', accountId)` `.is('redeemed_at', null)` `.is('revoked_at', null)` `.or(noLiveClaim(cutoff))`, `{ count: 'exact' }`, **no `.select` anywhere in the method's block**. The guard reads to the end of the block. `casWon` gives 0 → 404, 1 → 200. **No second read in 5a:** an account-issued invite cannot be accepted until 5b, so the "already used → 409" refinement is left to 5b (F5a-8 says it *may*). | F5a-8, T-20. The `EXEMPT` set is unchanged. |
| D-6 | **Revoke is not gated by the switch or the cohort.** Only the session and ownership inside the UPDATE gate it. A champion whose cohort lapsed, or who revokes after the switch is turned off, can still withdraw their own pending invite. | Withdrawing is never harmful, and it makes the live no-match write check possible on production with the switch off (§9 A-4). **Q-2 for SA.** |
| D-7 | **The champion's list** uses an explicit column list (`id, email, created_at, link_expires_at, revoked_at, redeemed_at, claimed_account_id`, the last three needed only to derive the status), newest first, capped at `FRIEND_INVITE_LIST_LIMIT = 200`, with a `truncated` flag. The response carries only `id, email, createdAt, linkExpiresAt, status, slotReturned`. | F5a-9. The derivation inputs never leave the server. |
| D-8 | **"N of 5 left"** = `allowance − rows.filter(isCountedFriendInvite).length`, clamped at ≥ 0. `isCountedFriendInvite` mirrors the SQL predicate exactly, and a test pins both texts together. With more than 200 rows the display may overstate what is left. The SQL refusal is what counts (T-17). | T-17 "display uses the same predicate". |
| D-9 | **Status** (5a): `revoked` → **Revoked**; `redeemed_at` → **Joined** (not reachable until 5b, which renames it per F5b-7); counted and not redeemed → **Pending** (a claimed-past-expiry row therefore stays Pending, since it holds its slot); otherwise **Expired**. `slotReturned` is true for Revoked and Expired. | FR-31, BQ-15, T-17. Uses `deriveInviteState` (C-11) plus the counted predicate. |
| D-10 | **Inviter name snapshot** = the champion's `profiles.full_name`, trimmed and capped at 200 (the `adminInviteOps` rule, extracted as an exported pure helper). **Fallback when empty: `INVITER_NAME_FALLBACK` ("AgentPilot"), never the email** (R-1). The ops test pins "nameless champion → 'AgentPilot'; the display name never contains the session email". | **SA ruling on Q-1 (R-1):** the display name is shown on the public page to anyone holding the link and in the admin list, an address in a From display name is a phishing pattern, and BQ-9 already decided this fallback. |
| D-11 | **Section copy lives in `inviteFriendsCopy.ts`**, not in `LanguageContext.tsx`. `InviteFriendsSection` reads only `language`/`isRTL` from `useLanguage()` for display. The persisted invite language comes from the form, whose default the server supplies from `preferred_language` (C-8). | `LanguageContext.tsx` is 11,498 lines with 9 `console.*` calls (§12). Not touching it keeps this slice out of it. This is the `invitePageCopy.ts` precedent. |
| D-12 | **Invite page (keyed on `issuer_kind = 'account'`, whatever the grant kind, R-5):** a pending account-issued invite shows the narrow `unavailable` state when `accountInvitesAvailable` is false **or** its grant is not a tier, and `signup_opens_soon` otherwise. Either way it never reaches the existing-account check or the `valid` state with a form. The issuer's cohort is **not** re-checked on the page in 5a (5b re-checks at redemption, T-19). `first_viewed_at` is stamped only on `signup_opens_soon` (the admin sees it; the champion never does, F5a-9). | T-18: "no longer available" once off. |
| D-13 | **Advisory lock key, namespaced (R-4):** `pg_advisory_xact_lock(hashtextextended('business_os_friend_invite:' \|\| p_issuer_account_id::text, 0))`. The held purge function (`supabase/held/20260916b_purge_business_data.sql:127`) locks on the bare account id, so an un-namespaced key would make a friend send and a purge of the same account contend. The text test pins the prefix. This is a **new SQL pattern, ruled by SA in T-17**. | T-17, R-4. |

### 2.3 Tenant isolation (`tenant-isolation-guard`)

A service-role path with one caller-supplied id (`inviteId` on revoke).

- **Account:** `resolveAccountId(user.id)` after `getUser()`, never from the request.
- **Revoke:** ownership lives *inside* the UPDATE (D-5), so there is no gap between checking and writing. Not found and not yours give the same 404.
- **Send:** an explicit allow-list. The RPC arguments are built field by field. The issuer, cohort, grant, type, allowance, limit, expiry, reason and Reply-To all come from the session or config. The body is `.strict()` (email, `personalNote`, language). An injected `issuerAccountId`, `grantId`, `inviteType`, `linkExpiryDays`, `level` or `accountId` gives a 400 and no write (AC-16).
- **List:** `.eq('issuer_kind','account').eq('issuer_account_id', accountId)`.
- **No trigger or upsert** exists on `business_os_invites` (confirmed by the Slice 2 checker's M09), so none of the scope-defeating three applies.

### 2.4 Audit (F5a-13)

New `AUDIT_EVENTS`: `BOS_FRIEND_INVITE_CREATED`, `BOS_FRIEND_INVITE_REVOKED` and `BOS_FRIEND_INVITE_REFUSED`, each with its metadata row in `events.ts` and a `'bos'` entry in `eventAudience.ts`. The actor is the champion (`userId` = account id). `entityId` is the invite id; a refusal has none. Details: created → `{ language }`; refused → `{ reason }`, where the reason is one of `not_eligible | own_email | allowance_reached | daily_limit | already_invited`. The email outcome reuses `BOS_INVITE_EMAIL_SENT` / `BOS_INVITE_EMAIL_NOT_SENT` exactly as the admin create route does. **Never** the email, token, hash or note. All calls are non-blocking: `.catch(err => requestLogger.error({ err }, …))`.

---

## 3. Files to Create / Modify

All paths were verified against the tree at `fe7f6410`. **15 new, 24 modified.**

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261023_business_os_friend_invites.sql` | create | §4: the function and the partial index (F5a-2) |
| `scripts/check-bos-friend-invites-migration.sql` | create | Read-only checker (F5a-2). Lives in `scripts/`, following the four existing `check-bos-invite*` files (**Q-4**) |
| `supabase/SQL Scripts/20261023_business_os_friend_invites_rollback.sql` | create | Rollback (F5a-2) |
| `supabase/migrations/__tests__/business-os-friend-invites.migration.test.ts` | create | Text test: C-2 privileges, `SECURITY INVOKER`, `search_path = ''`, no plan names or numeric literals, the checker's lists match the migration |
| `lib/business-os/invites/friendInviteOps.ts` | create | §2.1 |
| `lib/business-os/invites/friendInviteDeps.ts` | create | Production wiring (`server-only`) |
| `lib/business-os/invites/__tests__/friendInviteOps.test.ts` | create | Eligibility, predicate, status, send order, refusals, allow-list |
| `app/api/business-os/friend-invites/route.ts` | create | GET, POST (F5a-5) |
| `app/api/business-os/friend-invites/[inviteId]/revoke/route.ts` | create | POST revoke (F5a-5, F5a-8) |
| `app/api/business-os/friend-invites/__tests__/route.test.ts` | create | F5a-14 |
| `app/api/business-os/friend-invites/__tests__/revoke.route.test.ts` | create | F5a-14, tenant-isolation step 7 |
| `components/business-os/settings/InviteFriendsSection.tsx` | create | F5a-12 |
| `components/business-os/settings/inviteFriendsCopy.ts` | create | en/he/es copy (D-11) |
| `components/business-os/settings/__tests__/InviteFriendsSection.render.test.tsx` | create | Renders nothing when not eligible; "N of 5"; 0 left; revoke confirmation; link shown once; RTL |
| `lib/business-os/entitlements/__tests__/friendInviteConfig.invariant.test.ts` | create | Pins 5, 10, 24, the switch off, and grant = `TIER_ORDER[0]` (the one place allowed to name `'basic'`/`'champion'`). Alternatively extend `inviteConfig.invariant.test.ts`; Dev picks one |
| `lib/business-os/entitlements/config/invites.ts` | modify | `account` entry, `accountInvitesAvailable: false`, `FRIEND_INVITE_POLICY` / `FRIEND_INVITE_LIMITS` exports (F5a-3) |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | New `KNOWN_NON_GATE_IMPORTERS` entries (F5a-4): `friendInviteOps.ts`, `friendInviteDeps.ts`, both routes (`resolveAccountId`, `getEntitlementConfig`), and `publicInviteView.ts` gains `INVITE_ISSUANCE_POLICY` |
| `lib/repositories/BusinessOsInviteRepository.ts` | modify | `createForIssuerAccount` (RPC), `listForIssuerAccount`, `revokeForIssuerAccount`; `issuer_kind` in `PUBLIC_COLUMNS`; header comment (F5a-7) |
| `lib/repositories/types.ts` | modify | `CreateFriendInviteInput`, `FriendInviteRpcResult`, `BusinessOsFriendInviteListRow`; `BusinessOsInvitePublicView` gains `issuer_kind` |
| `lib/repositories/__tests__/BusinessOsInviteRepository.test.ts` | modify | One test per new method, the public-surface pin, and the new public column |
| `lib/business-os/invites/inviteSchemas.ts` | modify | `sendFriendInviteSchema` (`.strict()`: email, `personalNote` ≤ `PERSONAL_NOTE_MAX`, language `en`/`he`/`es`), `friendInviteIdSchema` (`z.string().uuid()`), and an empty `.strict()` revoke body. No new entitlements import |
| `lib/business-os/invites/__tests__/inviteSchemas.test.ts` | modify | Injected fields → fail |
| `lib/business-os/invites/publicInviteView.ts` | modify | `signup_opens_soon` state before the existing-account check (F5a-10, D-12) |
| `lib/business-os/invites/__tests__/publicInviteView.test.ts` | modify | Account-issued tier: new state, `emailHasAccount` and `findInviteeEmailForPublicCheck` **never called**; switch off → `unavailable` |
| `app/api/public/invites/validate/__tests__/route.test.ts` | modify | New state passes through, logged by state only. The route itself is unchanged (it returns `outcome.response`) |
| `lib/business-os/invites/__tests__/inviteRedemption.test.ts` | modify | F5a-10 pin: an `issuer_kind: 'account', grant_kind: 'tier'` row is refused by the code, complete and Google entry points before `sendEmail`, `createUser` or the claim is called |
| `app/invite/page.tsx` | modify | Render `signup_opens_soon`: name, note, offer with price, "payment required", "opens soon". No `SignupForm`, no `GoogleSignupButton` |
| `app/invite/invitePageCopy.ts` | modify | en/he/es strings for the new state |
| `app/invite/__tests__/page.render.test.tsx` | modify | The new state shows no form and no Google button |
| `lib/business-os/invites/adminInviteOps.ts` | modify | View gains `issuerKind`, `issuerAccountId`, `revokedByInviter`; export the name-snapshot helper (D-10) |
| `lib/business-os/invites/__tests__/adminInviteOps.test.ts` | modify | `INVITE_LIST_VIEW_KEYS` pin; account row mapping |
| `app/admin/business-os-invites/types.ts` | modify | `InviteRow` mirrors the three fields |
| `app/admin/business-os-invites/inviteFilter.ts` | modify | Issuer filter (`all` / `admin` / `account`) |
| `app/admin/business-os-invites/components/InviteFilters.tsx` | modify | Issuer select |
| `app/admin/business-os-invites/components/InviteList.tsx` | modify | "Champion: <name> · <account id>" on account rows; "Revoked by the inviter" |
| `app/admin/business-os-invites/__tests__/page.render.test.tsx` | modify | Account-row render, filter, admin revoke on an account row (F5a-11) |
| `lib/audit/events.ts` | modify | Three constants and their metadata (§2.4) |
| `lib/audit/eventAudience.ts` | modify | `'bos'` for the three |
| `app/business-os/settings/page.tsx` | modify | One import and `<InviteFriendsSection />` below the plan row |

**Not touched:** `inviteRedemption.ts` (only its test changes), `inviteEmail.ts`, `inviteSender.ts`, `invite-invitation.ts`, `LanguageContext.tsx`, the entitlements catalog and tier matrix, and anything under `/api/admin/**` (the authz guard counts do not move).

---

## 4. Migration `20261023`

**File:** `supabase/migrations/20261023_business_os_friend_invites.sql`

The Slice 0–2 editor rules apply: one `BEGIN`/`COMMIT`, no `--` or block comments, one statement per change, alias names only (no single letters). Literals are limited to structural values that already live in table CHECKs (`'account'`, `'tier'`) and the four refusal classes, as in `20261014`. **No plan name and no count or limit appears in the SQL.**

```sql
BEGIN;

CREATE INDEX business_os_invites_issuer_account_idx ON public.business_os_invites (issuer_account_id, created_at) WHERE issuer_kind = 'account';

CREATE FUNCTION public.business_os_create_friend_invite(
  p_issuer_account_id uuid, p_issuer_cohort text, p_invite_type text, p_grant_id text,
  p_allowance integer, p_daily_limit integer, p_daily_window_hours integer,
  p_token_hash text, p_email text, p_inviter_display_name text, p_inviter_reply_to text,
  p_language text, p_personal_note text, p_internal_reason text, p_link_expiry_days integer)
RETURNS TABLE (result_outcome text, result_invite_id uuid, result_link_expires_at timestamptz)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_counted integer;
  v_recent integer;
  v_invite_id uuid;
  v_expires_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('business_os_friend_invite:' || p_issuer_account_id::text, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.business_os_account_plans AS plan_row
     WHERE plan_row.user_id = p_issuer_account_id
       AND plan_row.cohort = p_issuer_cohort
       AND (plan_row.cohort_expires_at IS NULL OR plan_row.cohort_expires_at > now())
  ) THEN
    RETURN QUERY SELECT 'not_eligible'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT count(*) INTO v_counted FROM public.business_os_invites AS invite_row
   WHERE invite_row.issuer_kind = 'account' AND invite_row.issuer_account_id = p_issuer_account_id
     AND invite_row.revoked_at IS NULL
     AND (invite_row.redeemed_at IS NOT NULL OR invite_row.claimed_account_id IS NOT NULL OR invite_row.link_expires_at > now());
  IF v_counted >= p_allowance THEN
    RETURN QUERY SELECT 'allowance_reached'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  SELECT count(*) INTO v_recent FROM public.business_os_invites AS recent_row
   WHERE recent_row.issuer_kind = 'account' AND recent_row.issuer_account_id = p_issuer_account_id
     AND recent_row.created_at > now() - make_interval(hours => p_daily_window_hours);
  IF v_recent >= p_daily_limit THEN
    RETURN QUERY SELECT 'daily_limit'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.business_os_invites AS same_row
     WHERE same_row.issuer_kind = 'account' AND same_row.issuer_account_id = p_issuer_account_id
       AND same_row.email = p_email AND same_row.redeemed_at IS NULL AND same_row.revoked_at IS NULL
       AND (same_row.claimed_account_id IS NOT NULL OR same_row.link_expires_at > now())
  ) THEN
    RETURN QUERY SELECT 'already_invited'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  INSERT INTO public.business_os_invites AS new_row (
    token_hash, email, invite_type, grant_kind, grant_id, access_open_ended, access_months,
    issuer_kind, issuer_account_id, inviter_display_name, inviter_reply_to, language, personal_note,
    internal_reason, link_expiry_days, link_expires_at, email_attempted_at)
  VALUES (
    p_token_hash, p_email, p_invite_type, 'tier', p_grant_id, NULL, NULL,
    'account', p_issuer_account_id, p_inviter_display_name, p_inviter_reply_to, p_language, p_personal_note,
    p_internal_reason, p_link_expiry_days, now() + make_interval(days => p_link_expiry_days), now())
  RETURNING new_row.id, new_row.link_expires_at INTO v_invite_id, v_expires_at;

  RETURN QUERY SELECT 'created'::text, v_invite_id, v_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.business_os_create_friend_invite(uuid, text, text, text, integer, integer, integer, text, text, text, text, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_os_create_friend_invite(uuid, text, text, text, integer, integer, integer, text, text, text, text, text, text, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.business_os_create_friend_invite(uuid, text, text, text, integer, integer, integer, text, text, text, text, text, text, text, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.business_os_create_friend_invite(uuid, text, text, text, integer, integer, integer, text, text, text, text, text, text, text, integer) FROM service_role;
GRANT EXECUTE ON FUNCTION public.business_os_create_friend_invite(uuid, text, text, text, integer, integer, integer, text, text, text, text, text, text, text, integer) TO service_role;

COMMIT;
```

(The file itself has one statement per blank-line-separated block, as in `20261014`. It is condensed here for reading.)

- **Privileges:** `SECURITY INVOKER` as `service_role`, which already holds `SELECT` on `business_os_account_plans` (20261009) and `SELECT, INSERT` on `business_os_invites` (20261012). No table grant changes. `pg_advisory_xact_lock` needs no privilege.
- **The `0` in `hashtextextended`** is the hash seed, not a policy number. The text test allows exactly that one numeric literal, and pins the `'business_os_friend_invite:'` key prefix (R-4).
- **The lock:** the same issuer serialises; different champions never wait on each other (T-17).
- **Safe before the code deploys:** nothing calls it. The index is additive.
- **CHECKs satisfied by construction:** `one_issuer` (account + id, admin id NULL), `access_shape` (tier + NULL, NULL), `reason_length` (a fixed string of at least 3 characters), `expiry_after_creation` (`now()` + days > the `now()` default), `email_normalised` (normalised by Zod first), `inviter_reply_to_normalised` (`normaliseReplyToAddress`).

### 4.1 Pre-check, apply, verify (the user, SQL editor)

| Step | What | Expected | If not |
|---|---|---|---|
| 1 | `SELECT count(*) AS friend_invite_function FROM pg_proc JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace WHERE pg_namespace.nspname = 'public' AND pg_proc.proname = 'business_os_create_friend_invite';` | `0` | `1`: already applied; go to step 3. |
| 2 | Paste the whole migration. | "Success. No rows returned." | One transaction; nothing is half-applied. Send the error text to Dev. |
| 3 | Paste `scripts/check-bos-friend-invites-migration.sql`. | `VERDICT PASS` | Any FAIL: rollback (§10), do not merge. |
| 4 | Paste the Slice 0 checker `scripts/check-bos-invites-migration.sql`. | `VERDICT PASS` | Stop. The table's end state changed unexpectedly. |
| 5 | Merge the PR (the merge is the deploy). | §9 part A | — |

### 4.2 Checker rows (`scripts/check-bos-friend-invites-migration.sql`)

This uses the Slice 0–2 shape: `SET default_transaction_read_only = on`, one final `SELECT` with a `VERDICT`, names in explicit `IN (…)` lists, and `aclexplode` over `COALESCE(proacl, acldefault('f', proowner))`.

| Row | Check | Expected |
|---|---|---|
| F01 | The function exists with exactly the 15-argument signature | 1 |
| F02 | `prosecdef = false` (`SECURITY INVOKER`) | true |
| F03 | `proconfig` contains `search_path=""` | true |
| F04 | `EXECUTE` held by `service_role` only; none for `PUBLIC`, `anon`, `authenticated` | exact |
| F05 | `business_os_invites_issuer_account_idx` exists, is partial, on `(issuer_account_id, created_at)` | 1 |
| F06 | Table: no privilege for `PUBLIC`/`anon`/`authenticated`; `service_role` exactly `SELECT INSERT UPDATE` | exact |
| F07 | No column-level ACL on `business_os_invites` | 0 |
| F08 | RLS on, 0 policies, 0 triggers | on / 0 / 0 |

---

## 5. API contracts

Every handler: `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `getUser()` first (401 when missing), `resolveAccountId(user.id)`, Pino `logger.child({ correlationId })`, the CLAUDE.md error format, and **`Cache-Control: no-store` on every response** (each is personal, and POST carries the one-time link). No log line ever carries the email, token, hash or note.

| Method and path | Request | Success | Refusals |
|---|---|---|---|
| `GET /api/business-os/friend-invites` | None. The query string is ignored and never read (the `my-plan` precedent) | Not eligible (switch off, not a champion, lapsed): `200 { eligible: false }`, no reason given. Eligible: `200 { eligible: true, allowance, remaining, defaultLanguage, languages, invites: [{ id, email, createdAt, linkExpiresAt, status, slotReturned }], truncated }` | 401; 500 |
| `POST /api/business-os/friend-invites` | `.strict()` `{ email, personalNote?, language }` | `201 { invite: <list item>, link, email: { status } }` (no `remaining`: the section re-reads the GET, §6.1 deviation 1) | 400 invalid or injected field (nothing written); 401; 403 `not_eligible`; 409 `own_email` / `allowance_reached` / `already_invited` (each with its own message); 429 `daily_limit` (the number is never shown); 500 |
| `POST /api/business-os/friend-invites/[inviteId]/revoke` | `inviteId` `z.string().uuid()`; body absent or `{}` (`.strict()`) | `200 { revoked: true }` (the section re-reads the GET) | 400 bad id or body; 401; **404 for not found, not yours, or no longer revocable**; 500 |

User-facing messages (in English in the API; the section maps the error codes to en/he/es):

- `allowance_reached`: "All {allowance} of your invites are in use." The number is interpolated from `FRIEND_INVITE_LIMITS`, never written in copy (R-7); the same holds for "N of {allowance} left" in the section.
- `already_invited`: "You already have a live invite to this address."
- `own_email`: "You can't invite yourself."
- `daily_limit`: "You've sent a lot of invites today. Please try again tomorrow."

---

## 6. Task List

- ✅ **T-0** Confirm branch `feature/bos-invite-friend-5a` (`git branch --show-current`). Record the schema-check result (skill `business-os-schema-check`) for the columns named in §4 against the live DB.
- ✅ **T-1** Config (F5a-3): the `account` entry, `accountInvitesAvailable: false`, `FRIEND_INVITE_LIMITS` `{ lifetimeAllowance: 5, dailySendLimit: 10, dailyWindowHours: 24 }`, the derived `FRIEND_INVITE_POLICY` `{ issuerCohort, inviteType, grantId: TIER_ORDER[0] }`; the header comment; the invariant test.
- ✅ **T-2** Migration, checker, rollback and text test (§4, F5a-2).
- ✅ **T-3** Repository: three methods, `issuer_kind` in the public columns, types, header, and a unit test per method (F5a-7, F5a-8).
- ✅ **T-4** `friendInviteOps.ts` and its tests: `isInForceChampion`, `isCountedFriendInvite`, `toFriendInviteView`, `getFriendInviteSummary`, `sendFriendInvite`, `revokeFriendInvite` (D-1 to D-10).
- ✅ **T-5** Schemas and their tests.
- ✅ **T-6** Audit constants and audience (§2.4).
- ✅ **T-7** `friendInviteDeps.ts`, the two routes and their tests (F5a-5, F5a-14).
- ✅ **T-8** Public view `signup_opens_soon`, the invite page and copy, their tests, and the redemption pin test (F5a-10).
- ✅ **T-9** Admin list: view fields, issuer filter, render, and tests (F5a-11).
- ✅ **T-10** `InviteFriendsSection`, its copy and render test, and the one-line mount in settings (F5a-12).
- ✅ **T-11** Entitlements registration (F5a-4); run `npm run test:bos-entitlements` and record the result here.
- ✅ **T-12** Guards and full check: `npx tsc --noEmit`, `npm run lint`, `npm run lint:hooks`, `npm test -- lib/repositories/__tests__/mutationOrSelect.guard.test.ts`, `npm run test:authz-guard`, `npm test -- lib/business-os/invites app/api/business-os/friend-invites app/invite app/admin/business-os-invites components/business-os/settings`. `git diff --stat` before hand-over, checking for deletions with no matching insertions.
- ✅ **T-13** Hand over **uncommitted** for SA code review, the user's diff view, then QA.

---

### 6.1 Implementation record (Dev, 2026-09-30)

Built on `feature/bos-invite-friend-5a` at `fe7f6410`, **uncommitted**. `20261023` is still free on `origin/main` (re-checked after `git fetch`, 2026-09-30).

**Files: 14 new, 28 modified** (plus this workplan). The plan said 15 new and 24 modified. The differences:
- The config invariants went into the existing `inviteConfig.invariant.test.ts` rather than a new file (the plan allowed either).
- Four more files are modified, each forced by a guard: `lib/audit/filterOptions.ts` (the new events would otherwise fall into a group called "Bos"), `lib/audit/__tests__/eventAudience.test.ts` (the pinned counts go 169 → 172 and 24 → 27 Business OS), and `lib/repositories/__tests__/businessOsEntitlements.imports.guard.test.ts` (RC-15: `friendInviteDeps.ts` names the plan repository, so it is registered as read-only in `ALLOWED` and `NO_STATE_WRITE_REFERRERS`).
- `app/admin/business-os-invites/page.tsx` needed no change: the issuer filter rides on `EMPTY_INVITE_FILTER`.

**R-items, as built:**

| # | Where |
|---|---|
| R-1 | `inviterNameFromProfile` is extracted from `adminInviteOps.ts` and shared. A nameless champion, or a failed profile read, is "AgentPilot". Tested in `friendInviteOps.test.ts`: the name is `INVITER_NAME_FALLBACK`, contains no `@`, and the From header is `AgentPilot <address>` |
| R-2 | §9 Part B is rewritten: probes P-1 to P-3, at most 2 live invites, the host swap, the pre-flight, the local fallback, and the clean-up count |
| R-3 | Both handlers parse with `.strict()` Zod before any business read. The route test asserts that a 400 reads no plan row |
| R-4 | `hashtextextended('business_os_friend_invite:' \|\| p_issuer_account_id::text, 0)`, pinned by the migration text test |
| R-5 | `publicInviteView.ts` branches on `issuer_kind === 'account'` before the existing-account check. A cohort-grant account row is `unavailable`. Tested |
| R-6 | The three new methods log `safeDbError` and return `toError`. They are added to the M-1 leak suite in the repository test, which injects `details` holding an email and a hash |
| R-7 | Every allowance in copy and in the API messages is interpolated from `FRIEND_INVITE_LIMITS`. The section test uses an allowance of 7 to prove it. A blank note is stored as NULL |

**Deviations from the plan (for SA):**
1. **No `remaining` on the POST or revoke response** (§5). After every send or revoke the section re-reads the GET, which is the one place "N left" is derived. This avoids a second derivation or a second read inside the write. POST returns `{ invite, link, email: { status } }` and revoke returns `{ revoked: true }`.
2. **`friendInviteOps.ts` describes the plan reader structurally** (`IssuerPlanReader`) instead of importing the plan repository's type, so only the wiring (`friendInviteDeps.ts`) names that repository (RC-15). The route wiring goes through `friendInviteDeps.ts`, so the routes import nothing from the entitlements module except `resolveAccountId`.
3. **SA suggestion taken:** a `not_eligible` refusal caused by the switch itself is **not audited**, because only a hand-made POST can reach it. Every other refusal is audited by reason class.
4. **Not taken (optional SA suggestions):** the nameless-champion hint, the exact "N left" count query, and the accordion consistency. The section owns its own open/closed state, so two rows can be open at once.
5. **SQL text:** the `EXISTS` sub-selects select a column rather than `1`, so the text test can hold "no numeric literal except the hash seed". The checker reads the index key columns from `pg_index.indkey` rather than matching text, so its literals stay plain. The editor-safety literal rule is widened for exactly one literal, the lock-key prefix, which contains `:`.
6. **Refusal messages** live in `friendInviteOps.ts` (`friendInviteRefusalMessage`), not in the route: Next.js route files may not export other names.
7. `resolveInviteFormLanguage` is reused as it is. Its parameter is named `adminId` but receives the champion's account id. It is a naming wart only, and I left it to avoid touching the admin tests.
8. **Invite page:** the offer block of `valid` is extracted into a local `InviteOfferDetails`, rendered by both `valid` and `signup_opens_soon`. The markup and test ids are unchanged, and the existing page tests are green.

**Checks run (2026-09-30):**

| Check | Result |
|---|---|
| New and changed suites (invites, friend-invite routes, invite page, admin invites, settings section, repositories, audit, migrations, entitlements) | ✅ all green. New: `friendInviteOps` 54, routes 37 (GET/POST 26 + revoke 11), section 18, migration text 23; plus additions to the repository, public view, validate route, redemption, schemas, admin ops and admin page suites |
| `npm run test:bos-entitlements` (T-11) | ✅ 94 suites, 1,983 tests |
| `npm run test:authz-guard` | ✅ 119 tests; the counts do not move |
| `mutationOrSelect.guard` | ✅ `EXEMPT` unchanged |
| `tierLiteral.forbidden` | ✅ no baseline change |
| Full `npx jest --ci` | 27 suites / 146 tests fail. **Identical on a clean `origin/main` worktree (27 / 146)**, so there are 0 regressions. None is in an area this slice touches (V6, pilot, orchestration, website-builder, feature flags, chat-v4, cron, the `tokenUsage` contract) |
| `npx eslint` on every touched `.ts`/`.tsx` | ✅ 0 errors; 5 warnings, all on lines this slice did not change |
| `npm run lint:hooks` | ✅ clean |
| `npx tsc --noEmit` (filtered to touched files) | ✅ nothing new; the repo's ~2,100 existing errors are unchanged |
| `npx next build` (the CI placeholder env) | ✅ exit 0. Both friend-invite routes are listed as dynamic (ƒ) |
| **PGlite** (the migration over `20261012`, `20261013`, `20261014`, `20261020`) | ✅ Pre-check 0 → 1. **Checker `VERDICT PASS`, 10/10.** P-2 as `service_role`, rolled back: `created`, `created`, `allowance_reached`, `already_invited` (same address), `daily_limit`, `not_eligible` (trial account), `not_eligible` (wrong cohort). A revoked invite gives its slot back. An expired one gives its slot back. **A claimed-past-expiry invite holds its slot** (`allowance_reached`). Inserted rows satisfy every CHECK (account issuer, tier grant, `email_attempted_at` set, expiry after creation). 0 rows after the rollback. `anon` and `authenticated` get "permission denied for function". The rollback script leaves the pre-check back at 0. **P-1 (the lock under two connections) cannot run in PGlite; QA runs it in the SQL editor (§9)** |
| **Live no-match check** (production PostgREST, 2026-09-30) | ✅ `revokeForIssuerAccount` with id and account `00000000-0000-0000-0000-000000000000` returned `{ data: false, error: null }`: the count-only UPDATE with `.or` raises no 42703 and writes nothing. Two read-only probes also passed: `listForIssuerAccount` (the 7 list columns exist, 0 rows) and `findByTokenHashForPublicView` (the public columns, including `issuer_kind`, exist). The script ran from the worktree and is deleted |
| Requirement file | ✅ still 865 lines, same md5 (`10f8f6fd…`), uncommitted and untouched |
| `git diff --stat` | ✅ no file shrank; every deletion is a replaced line |

**Before merge (the user, §4.1):** apply `20261023`, then the checker to PASS, then the Slice 0 checker to PASS. **After merge:** §9 Part A on production, with the switch off.

**QA5a-1 (test fix, 2026-09-30):** the migration text test now pins the whole `v_recent` statement exactly, through its semicolon, as `v_counted` is pinned. Proof: with the mutant `AND recent_row.revoked_at IS NULL` added to the daily window, the suite goes 23/23 → 1 failed. The mutant was applied to the migration file itself, not a scratch copy, then restored from a backup copy; `diff` against the backup shows it identical. The migration SQL is unchanged. Suite back to 23/23.

**5b switch-on condition (SA code review N-4):** once `accountInvitesAvailable` is on, a signed-in non-champion can send refused POSTs at will, and each one writes a `BOS_FRIEND_INVITE_REFUSED` audit row (only the refusal caused by the switch itself is left unaudited; a non-champion refused while the switch is on is audited). **Before the switch is turned on**, either add a per-account rate limit on the send route or stop auditing `not_eligible`. The 5b workplan must carry this.

**5b carry-over (SA Q-3):** the champion's revoke returns one 404 for "not found", "not yours" and "no longer revocable". Once 5b lets a friend accept, add the scoped second read that turns "already used" into a 409, beside F5b-7.

## 7. Traceability (F5a-1 to F5a-16)

| # | Where it is met |
|---|---|
| F5a-1 | Header: branch cut from `origin/main` `fe7f6410`; references re-checked (§1) |
| F5a-2 | §4, T-2 |
| F5a-3 | T-1; no tier or cohort literal outside `entitlements/config/**`; `tierLiteral.forbidden.test.ts` green with no baseline change |
| F5a-4 | T-11; the `KNOWN_NON_GATE_IMPORTERS` `why` text: "an issuance rule on who may invite, keyed on the cohort, with no capability (the `adminInviteOps.ts` precedent); if the cap moves to a capability these become gates" |
| F5a-5 | §5, T-7 |
| F5a-6 | D-2, D-3, D-10; the existing `sendInvitationEmail`, `buildInviteFromHeader`, `recordInviteEmailOutcome` and `resolveInviteFormLanguage` |
| F5a-7 | T-3: `createForIssuerAccount`, `listForIssuerAccount`, `revokeForIssuerAccount`; no `ForAdmin` reuse |
| F5a-8 | D-4, D-5 |
| F5a-9 | D-7 |
| F5a-10 | D-12, T-8, the redemption pin test |
| F5a-11 | T-9 |
| F5a-12 | T-10, D-11 |
| F5a-13 | §2.4, T-6 |
| F5a-14 | §8 |
| F5a-15 (amended by SA, R-2) | §9 Part B: probes P-1 and P-2 (rolled back), B-6, the clean-up count |
| F5a-16 | Scope: FR-28 to FR-33, FR-38 only. No resend, friend signup or perks |

FR-28 → D-1, T-10 · FR-29 → §4, D-8 · FR-30 → D-2, §5 · FR-31 → D-9 · FR-32 → D-5, D-6 · FR-33 → T-8 · FR-38 → nothing grants credits.

---

## 8. Test plan

| Suite | Cases |
|---|---|
| Routes (`route.test.ts`) | GET: 401; `{ eligible: false }` for trial, Essentials, expired champion, and switch off; eligible payload has only the allowed keys; `no-store`. POST: happy path 201 with link and `no-store`; 401; 400 for a bad email, a note over 1,000 characters, a bad language, and **each injected field** (`grantId`, `inviteType`, `issuerAccountId`, `linkExpiryDays`, `level`, `accountId`), with the RPC never called; 403 for a non-champion and for the switch off; 409 `own_email` (case and whitespace variants); 409 `allowance_reached` and 409 `already_invited`, with distinct messages; 429 `daily_limit`; a failed email still gives 201; audit carries no email |
| Revoke (`revoke.route.test.ts`) | 401; 400 for a non-uuid and for an injected body field; 200 for own pending; **another account's id → 404 and the UPDATE's filters include the caller's `issuer_account_id`** (so no row changes; tenant-isolation step 7); 0 rows → 404 with the same body as not-yours; the audit is written only on 200 |
| Ops (`friendInviteOps.test.ts`) | `isCountedFriendInvite`: pending (counted), expired (not), revoked (not), accepted (counted), claimed past expiry (counted), revoked + claimed (not). A **text test pins the SQL predicate string in the migration to the TypeScript mirror**. `isInForceChampion`: NULL expiry, future, past, other cohort, no row. Status/`slotReturned` for each. Send order: switch checked before any read; own email refused before the token and the RPC; the RPC arguments are exactly the allow-list; each refusal class maps to its status |
| Repository | `createForIssuerAccount`: RPC name and argument map, outcome parsing, error → `safeDbError` logged, `toError` returned, and **`details` never reaches the logger** (R-6). `listForIssuerAccount`: select string equals the D-7 list (never `token_hash`, `first_viewed_at`, `opened_by_existing_account_at`, `inviter_reply_to`, `internal_reason`, …), both issuer filters, order, limit. `revokeForIssuerAccount`: `{ count: 'exact' }`, both issuer filters, `redeemed_at`/`revoked_at` NULL, `noLiveClaim`, no `.select`, `casWon` 0/1/2 |
| Migration text | C-2 statements present; `SECURITY INVOKER`; `SET search_path = ''`; no `basic`/`pro`/`champion`/`trial` and no numeric literal except the hash seed; no `--`; the checker's `IN` lists match |
| Public view and page | `signup_opens_soon` for an account-issued tier invite carries the name, note, offer and expiry and no masked email; `findInviteeEmailForPublicCheck` and `emailHasAccount` never called; switch off → `unavailable`; the page renders no `SignupForm` and no Google button |
| Redemption pin | For `issuer_kind: 'account'` + tier, each of `requestSignupCode`, `completeSignup` and `completeGoogleSignup` returns 409 `paid_invites_not_available` with `sendEmail`, `createUser`, `emailHasAccount` and the claim methods never called |
| Admin | Account row shows the champion's name and id; the issuer filter; "Revoked by the inviter"; admin revoke on an account row calls `revokeForAdmin` |
| UI | Renders `null` for `{ eligible: false }` and on fetch error; "3 of 5 left"; at 0 the form is replaced by the plain line; send shows the link once with a copy button, and it is gone after a refetch; revoke asks for confirmation; he → `dir="rtl"`; labels bound to inputs |
| Guards (must stay green) | `mutationOrSelect` (EXEMPT unchanged), `tierLiteral.forbidden`, `npm run test:bos-entitlements`, `npm run test:authz-guard` |

---

## 9. Production manual check

**Test identities.** Champion: the user's own account if its plan row is an in-force champion; otherwise a **test champion**, made by sending an admin Champion invite (open-ended) to `<user>+champ5a@gmail.com` and signing up through it. Friend: `<user>+friend5a@gmail.com`. Both arrive in the user's own Gmail.

### Part A — production, after the migration and the merge (switch **off**)

| # | Step | Expected |
|---|---|---|
| A-1 | §4.1 steps 1–4 | Checker `VERDICT PASS`; the Slice 0 checker PASS |
| A-2 | Sign in as the champion and open Business OS settings | **No "Invite friends" row.** "Your plan" is unchanged |
| A-3 | In the browser console on the app origin: `fetch('/api/business-os/friend-invites').then(r=>r.json())` | `{ success: true, data: { eligible: false } }` |
| A-4 | **Live no-match write (the PostgREST lesson):** `fetch('/api/business-os/friend-invites/00000000-0000-4000-8000-000000000000/revoke',{method:'POST'}).then(r=>r.status)` | **404**, not 500. Vercel logs show no 42703 |
| A-5 | `/admin/business-os-invites` | The list loads; the issuer filter shows; existing admin rows are unchanged |
| A-6 | An existing admin champion invite link still opens as before | `valid`, with the signup form |

### Part B — switch **on**, reduced (F5a-15 as amended by SA, R-2)

**The race is proven by rolled-back SQL probes, not by live rows.** QA runs them in the SQL editor; nothing is kept and no email is sent. Probe addresses are `<user>+probe…@gmail.com` only. The probe text may name the cohort and tier ids: it goes in the QA report and is never committed.

| # | Probe | Expected |
|---|---|---|
| P-1 | **The lock.** Tab 1: `BEGIN; SET LOCAL ROLE service_role;` call `business_os_create_friend_invite` for the test champion's id, then `SELECT pg_sleep(20); ROLLBACK;`. Tab 2, started within those 20 s: `BEGIN; SET LOCAL ROLE service_role;` call it with a different address and hash, then `ROLLBACK;`. Optional tab 3: `pg_locks` shows tab 2's advisory lock not granted | Tab 2 answers only after tab 1 rolls back (about the remaining sleep). This proves the same-issuer lock serialises, and `SET LOCAL ROLE` proves the `service_role` privileges |
| P-2 | **Every refusal branch**, one tab, one `BEGIN … ROLLBACK` as `service_role`: `p_allowance` = current count + 1, called twice (`created`, then `allowance_reached`); the same address again with room left (`already_invited`); `p_daily_limit = 1` (`daily_limit`); a non-champion id (`not_eligible`) | Each class exactly as listed. Dev also ran this in PGlite (see the implementation record) |
| P-3 | Read-only: `SELECT count(*) FROM public.business_os_invites WHERE email LIKE '<user>+probe%';` | **0** |

**The live screens, with at most 2 real friend invites.** Pre-flight before booking the session: the preview has the production Supabase and email-sender settings, and the champion can sign in on the preview host (the in-app email and password sign-in on `/test-business-os`). If either fails (the user has no Vercel admin), use the **local fallback**: `npm run dev` with `accountInvitesAvailable: true` in the working copy only, **never committed**, against the same live database. The link then uses the local origin.

- **Champion:** reuse the test Founding Partner from the earlier invite demos, or the user's own account if it is a champion. Only if neither exists, make one with a **1-month access period**, and write its account id in the QA report.
- **Friends:** only `<user>+friend5a…@gmail.com`. Never a third party.
- **The switch-on build:** a throwaway branch `preview/bos-friend-5a-switch-on` (this branch plus one commit setting `accountInvitesAvailable: true`), **never merged**, deleted the same day. Or the local fallback.

| # | Step | Expected |
|---|---|---|
| B-1 | Sign in as the champion on the preview (or locally) → settings | "Invite friends", "N of {allowance} invites left", language defaulting to the champion's preference |
| B-2 | Send invite 1 to `+friend5a`, with a note, in Hebrew | Link shown once with a copy button; the count drops by one; the list shows Pending. The email arrives as "<Champion> via AgentPilot" (or "AgentPilot" for a nameless champion), Reply-To = the champion's address, Hebrew and RTL, "payment required" |
| B-3 | Open the link in a private window. **The link uses the production origin** (`platformUrl`), so on a preview replace the host with the preview's host and keep the `#t=…` fragment (no swap needed locally) | "<Champion> invited you", the note, Essentials with its price and what it includes, "payment required", "sign-up opens soon". **No form, no Google button.** (Opened on production as-is: "no longer available", which is correct while the switch is off there) |
| B-4 | Send to the same address again; send to the champion's own address | 409 "already have a live invite"; 409 "can't invite yourself". Neither writes a row |
| B-6 | SQL editor: paste checker rows F01 to F04 again | PASS (recorded in the QA report) |
| B-7 | Send invite 2 to `+friend5a2`, then revoke it (confirm) | Revoked, "slot back"; the count rises by one; that link now says revoked |
| B-8 | Admin list, issuer filter = account | The rows show the champion's name and account id; "Revoked by the inviter" on invite 2 |
| B-9 | Admin revokes invite 1 | The champion's count rises by one |
| B-10 | **Clean-up.** Every test invite revoked; the preview branch deleted the same day; then read-only `SELECT count(*) FROM public.business_os_invites WHERE issuer_kind = 'account' AND revoked_at IS NULL AND redeemed_at IS NULL;` | **0**, recorded in the QA report. The revoked rows stay as history (intended); no friend account can exist in 5a |

Seeing "0 left" live is optional (the render test covers it) and costs 3 more `+alias` invites, all revoked.

---

## 10. Rollback

| Layer | How | Notes |
|---|---|---|
| Behaviour | Already off: `accountInvitesAvailable: false`. If a switch-on PR later misbehaves, revert that one line | No data change needed |
| Code | Revert the merge PR | The public page and the admin list go back to their Slice 3 behaviour. Account-issued rows (from preview testing only) stay readable by the admin list as generic rows |
| Database | `supabase/SQL Scripts/20261023_business_os_friend_invites_rollback.sql`: `BEGIN; DROP FUNCTION public.business_os_create_friend_invite(<15-arg signature>); DROP INDEX public.business_os_invites_issuer_account_idx; COMMIT;` | **Revert the code first**, or the send route returns 500 (the RPC is missing). Rows are never deleted. Any live account-issued invite should be revoked by an admin first |

---

## 11. Questions for SA

| # | Question | Dev's recommendation |
|---|---|---|
| Q-1 | When a champion has no `full_name`, what is the inviter-name fallback? | ~~The champion's email~~. **SA: rejected.** "AgentPilot" (`INVITER_NAME_FALLBACK`), never the email (R-1, D-10) |
| Q-2 | Should revoke be gated by the switch or by the cohort? | No (D-6). Only the session and ownership. Withdrawing is harmless, and this is what makes the production no-match check (A-4) possible with the switch off. **SA: approved** |
| Q-3 | F5a-8's optional second read (already used → 409). | Deferred to 5b (D-5), because account-issued invites cannot be accepted in 5a. **SA: approved; a 5b carry-over beside F5b-7** |
| Q-4 | F5a-2 says the checker goes in `supabase/SQL Scripts/`, but all four invite checkers are in `scripts/check-bos-invite*.sql`. | Follow the precedent: the checker in `scripts/`, the rollback in `supabase/SQL Scripts/`. **SA: approved** |
| Q-5 | The 24-hour window as a parameter (`p_daily_window_hours`), not only the limit. | Yes. It keeps "no numbers in the SQL" literal. It costs one argument. **SA: approved** |
| Q-6 | On the invite page, a pending account-issued invite shows `unavailable` while the switch is off (D-12). The champion's cohort is not re-checked on the page in 5a. | Accept; 5b re-checks at redemption (T-19). **SA: approved** (see B-3 on the link's origin) |
| Q-7 | The list is capped at 200 rows, so "N left" may overstate what is left beyond that (D-8). | Accept: at 10 a day that takes 20 or more days of churn, and the SQL refusal is authoritative. **SA: approved** |

---

## 12. Logging-standard check (console.*)

Counted on `fe7f6410` for every file this slice modifies: **0 `console.*`** in all 24 (tests included), including `app/business-os/settings/page.tsx`, `BusinessOsInviteRepository.ts`, `publicInviteView.ts`, `adminInviteOps.ts`, `app/invite/page.tsx`, `lib/audit/events.ts` and the admin page files.

**Flag (not touched by this plan):** `lib/business-os/LanguageContext.tsx` has **9 `console.*` calls** (lines 11225–11361: language and currency sync). D-11 keeps this slice out of that file, so it is not converted here. Converting it is proposed as a separate small change for the user to approve.

New files use `createLogger` only.

---

## SA Review Notes

### SA Workplan Review — 2026-09-30

**Reviewed by SA — 2026-09-30**
**Status:** ✅ Approved with conditions. Fold R-1 to R-7 into this workplan before or while implementing. No second workplan review is needed; SA checks each R-item at code review. R-2 changes the manual check (§9 Part B) and amends F5a-15, which SA wrote.

Checked on `feature/bos-invite-friend-5a` at `fe7f6410` against: migrations `20261009`, `20261012`, `20261014`, `20261020`; `BusinessOsInviteRepository.ts` (`noLiveClaim`, `casWon`, `safeDbError`, `revokeForAdmin`, `createForAdmin`); `publicInviteView.ts:147-165`; `inviteRedemption.ts:242`; `inviteSender.ts`; `inviteEmail.ts`; `adminInviteOps.ts` (`INVITER_NAME_FALLBACK`, `INVITE_LIST_VIEW_KEYS`, `revokeInviteForAdmin`); `config/invites.ts`; `enforcementPoints.test.ts` `KNOWN_NON_GATE_IMPORTERS`; `mutationOrSelect.guard.test.ts`; `my-plan/route.ts`; `lib/utils/origins.ts`; `supabase/held/20260916b_purge_business_data.sql`.

#### What is right

| Area | Verdict |
|---|---|
| **Migration vs T-17 / T-21** | ✅ The lock is taken first. Then come the cohort re-check (cohort passed in, `cohort_expires_at` NULL or in the future), the counted rule (**identical** to T-17's predicate), the cap, the rolling window, the per-recipient guard (counted and not accepted, same normalised email) and the insert, all in one transaction on the database clock. Refusal classes match T-17. Under READ COMMITTED each plpgsql statement takes a fresh snapshot, so a send that waited on the lock counts the row the first send committed. The function is VOLATILE by default, so PostgREST does not run it read-only. No plan name and no policy number appears in the SQL. |
| **CHECKs** | ✅ Each was re-read against `20261012`/`20261014`/`20261020`. `access_shape` (tier + NULL + NULL), `one_issuer`, `inviter_name_length` (NOT NULL, 1–200: so the fallback must be a real string, see R-1), `expiry_after_creation` (both sides use the same `now()`), `email_sent_shape` (`email_attempted_at` set, `email_sent_at` NULL). All hold by construction. `email_locked` defaults to `true`, as FR-30 needs. |
| **C-2 privileges, SECURITY context, search_path** | ✅ Same five statements as `20261014`. `SECURITY INVOKER` as `service_role`, which already holds `SELECT` on `business_os_account_plans` (20261009:21) and `SELECT, INSERT` on the invites (20261012). `SET search_path = ''` with every relation schema-qualified. `pg_advisory_xact_lock`, `hashtextextended`, `make_interval` and `now()` resolve from `pg_catalog`, which is always searched. |
| **SQL-editor safety** | ✅ One `BEGIN`/`COMMIT`, no `--`, aliases in full, and a dollar-quoted body as in `20261014`. The pre-check / apply / checker / Slice 0 checker sequence (§4.1) is right. The `CREATE INDEX` takes a brief write lock on a small table, which is fine. The rollback drops only the function and the index. |
| **Checker and rollback location (Q-4)** | ✅ See the ruling. |
| **Routes** | ✅ `getUser()` → 401 → `resolveAccountId(user.id)` (the `my-plan` precedent), `nodejs` / `force-dynamic`, `correlationId`, `no-store` on every response, `.strict()` bodies, uuid path id. They sit outside `/api/admin/**`, so the authz guard counts do not move. |
| **Tenant isolation walk** | ✅ The account comes from the session only. Revoke ownership is inside the UPDATE (`issuer_kind` + `issuer_account_id`), and "not found" and "not yours" give the same 404. Send uses an explicit field-by-field allow-list, and the list has both issuer filters. There is no trigger or upsert on the table, and step 7 (another account's id → 404, no row changed) is in the test plan. |
| **`.or()` with `.select()`** | ✅ Revoke is `{ count: 'exact' }` + `.or(noLiveClaim)` with **no** `.select` in the method block; `EXEMPT` is unchanged. The list is a plain SELECT (the guard covers mutations only). The RPC is not a mutation chain. |
| **Redemption stays shut (F5a-10)** | ✅ `inviteRedemption.ts:242` refuses every `grant_kind = 'tier'` row before `emailHasAccount`, any code and any user. The finalise function also filters `issuer_kind = 'admin'` (20261014), which is a second, independent stop. The pin test across all three entry points is the right one. |
| **Existing-account check skipped** | ✅ In intent. The branch sits before `findInviteeEmailForPublicCheck` / `emailHasAccount`, and the test asserts both are never called. Tighten the key per R-5. |
| **Admin list** | ✅ `BUSINESS_OS_INVITE_ADMIN_COLUMNS` already selects `issuer_kind` / `issuer_account_id`, so no query changes. `revokeForAdmin` has no issuer filter, so admin revoke already works on champion rows and stamps the admin's id, which makes `revokedByInviter` false. Adding the three keys to the pinned `INVITE_LIST_VIEW_KEYS` is the right way to do it. |
| **`KNOWN_NON_GATE_IMPORTERS`** | ✅ The list of files is complete: `friendInviteOps.ts`, `friendInviteDeps.ts`, both routes, and `publicInviteView.ts` gaining `INVITE_ISSUANCE_POLICY`. `inviteSchemas.ts` gains no symbol (`PERSONAL_NOTE_MAX` is local). The section, its copy and the invite page must import **nothing** from the module (the number comes from the GET). The suite's exact-symbols test settles the symbol lists, so record the `npm run test:bos-entitlements` result at T-11 as planned. `friendInviteOps.ts` will likely need `planLabel` for the email's plan name, so register it as well. |
| **Audit, M-1 scrub** | ✅ The email outcome goes through `sendInvitationEmail`, which already scrubs the problem detail (`scrubProblemDetail`: token, link, hash, email-shaped text). The audit details are the reason class or the language only. R-6 covers the one new database-error path. |
| **`LanguageContext.tsx` (9 `console.*`)** | ✅ **Fine as planned.** The CLAUDE.md rule covers files that are opened *to be modified*. D-11 keeps this slice from editing it: the section only calls the `useLanguage()` hook and keeps its copy in `inviteFriendsCopy.ts`, the `invitePageCopy.ts` precedent. §12 flags the file and proposes a separate conversion, which is exactly what the rule asks. TL puts it to the user as its own small change. |
| **File count** | ✅ Verified: **15 new, 24 modified** (13 of the 39 are tests). |
| **Is it honestly small?** | 🟡 **Medium, not small**, and acceptable as one PR. It has about 22 production files, and roughly a third of them are the admin-list rendering (T-9). Everything ships inert, and each part is needed for the demo. The §17.3 "few days" holds only if T-9 stays at rendering and a filter. **If it runs long, T-9 is the clean split point** (5a-2). Admin revoke already works on champion rows without it, so clean-up does not depend on it. Commit in task order so SA can review each part separately. |

#### Rulings on Q-1 to Q-7

| # | Ruling |
|---|---|
| **Q-1** | **Rejected: never the email.** A nameless champion falls back to `INVITER_NAME_FALLBACK` ("AgentPilot"), the fallback the user already decided for admins in BQ-9. Four reasons. (1) **Disclosure is wider than the Reply-To.** A Reply-To shows only to someone who replies to the email. The display name is snapshotted on the row and shown on the **public invite page** to anyone who holds the link, including a forwarded one, and in the admin list. (2) **Phishing pattern.** `"dana@example.com via AgentPilot" <platform address>` puts an address in the From display name. Spoofers use that pattern, mail filters score it, and users are taught to distrust it. `cleanInviterName` does not strip `@`, and it should not have to. (3) One fallback, one code path: reuse the extracted helper unchanged. (4) The concern that "AgentPilot invited you" misleads is covered by the champion's own personal note and the Reply-To. Optional (see the suggestions below): tell a nameless champion what the friend will see. See **R-1**. |
| **Q-2** | **Approved.** Revoke is gated only by the session and by ownership inside the UPDATE, not by the switch or the cohort. Withdrawing is never harmful. A lapsed champion can still take back a live invite. It is what makes A-4, the live no-match write check, possible on production. The route still rejects a non-uuid id or any body field. |
| **Q-3** | **Approved.** "Already used → 409" is left to 5b. In 5a no account-issued invite can be accepted, so 0 rows means not found, not yours, revoked or expired, and one 404 is honest. Record it as a 5b carry-over beside F5b-7. |
| **Q-4** | **Approved.** Follow the precedent: the checker goes in `scripts/check-bos-friend-invites-migration.sql`, next to the four `check-bos-invite*` files, and the rollback in `supabase/SQL Scripts/`, next to the four invite rollbacks. F5a-2 is read that way. What it required was that both scripts exist and follow the conventions, not a folder. |
| **Q-5** | **Approved.** The 24 h window is a parameter. It keeps "no numbers in the SQL" literal at the cost of one argument, and the text test enforces it. |
| **Q-6** | **Approved.** While the switch is off, a pending account-issued invite shows the narrow `unavailable` state (T-18), and nothing is stamped. The issuer's cohort is re-checked at redemption in 5b (T-19), not on the page. Note: the link in every email points at the production origin (`platformUrl`, `lib/utils/origins.ts:63`), so during the Part B demo the friend's emailed link shows `unavailable` on production. See R-2. |
| **Q-7** | **Approved.** The list is capped at 200 with `truncated`. Counted rows can never exceed the allowance (a row joins the count only by an insert under the lock), so the display can only overstate when an old accepted or claimed invite sits beyond the 200 newest rows. At 10 a day that takes weeks of deliberate churn, and the SQL refusal is what decides. An optional exact fix is in the suggestions below. |

#### Item 8: the switch-on check on production data

**Is the plan acceptable as written? No. Acceptable with R-2.** A throwaway preview with the switch on writes to the **live production database**, because there is no preview database. That is acceptable only for a small, named set of rows on the tester's own addresses, each revocable, with a verified clean-up. The race does not need real rows at all.

**Rows the §9 Part B plan would write, as written:**

| What | How many | Removable? |
|---|---|---|
| A test Founding Partner, if a new one is made: an admin Champion invite, a new sign-in account, a plan row with the champion cohort (**open-ended as written**), a lineage row (L1), audit rows | 1 account | **No.** Plan and lineage rows are deliberately never deleted, and an open-ended champion never lapses. It would show up in future circle reports (Slice 6) as a real L1 champion |
| Friend invites from that champion | **5** (B-2 = 1, B-5's build-up = 3, the race = 1 created) | Revocable, not deletable. The app holds no DELETE on the table, and revoked invites stay as history, like every invite |
| Invitation emails | 5, to `+alias` addresses | Sent through the real platform sender and counted in its statistics |
| Audit rows (`BOS_FRIEND_INVITE_*`, `BOS_INVITE_EMAIL_*`) | about 12 | Permanent, which is correct |
| Friend accounts | **0** | 5a cannot redeem a tier invite (`inviteRedemption.ts:242`) |

**Three problems with Part B as written:**
1. **B-3 cannot pass as written.** The link, both the emailed one and the one shown once, is built from the **production** origin, not the preview host. Opened as-is it lands on production, where the switch is off and the page says "no longer available" (D-12). To see "sign-up opens soon", the tester replaces the host with the preview's host and keeps the `#t=…` fragment.
2. **Signing in on a preview is not proven.** `/login` lives on the marketing site, which returns to the production origin, and Google sign-in may not allow the preview URL. The in-app email and password sign-in on `/test-business-os` should work on the preview host for a champion made through the code-and-password signup. **Confirm it before booking the session**, together with the preview having the production Supabase and email-sender settings. The user has no Vercel admin, so if either is missing, use the local fallback below.
3. **The live race (B-5) needs 5 real invites and proves less than a probe.** Two browser fetches depend on network timing, so a pass does not show the lock was contended.

**The safer alternative, which is now required for the race (F5a-15 amended by SA):**
- **P-1, the lock, with nothing kept.** QA runs this in two SQL-editor tabs. Tab 1: `BEGIN; SET LOCAL ROLE service_role;` call the function for the test champion's id, then `SELECT pg_sleep(20); ROLLBACK;`. Tab 2, started within those 20 s: `BEGIN; SET LOCAL ROLE service_role;` call it again with a different address and hash, then `ROLLBACK;`. **Expected:** tab 2 takes about the remaining sleep time to answer, which proves the same-issuer lock serialises. Optionally, a third tab shows tab 2's advisory lock as not granted in `pg_locks`. `SET LOCAL ROLE` also proves the `service_role` privileges for real.
- **P-2, every refusal branch, with nothing kept.** One tab, one `BEGIN … ROLLBACK`, as `service_role`: call with `p_allowance` = the current count + 1 twice (`created`, then `allowance_reached`); the same address again with room left (`already_invited`); `p_daily_limit = 1` (`daily_limit`); a non-champion id (`not_eligible`). The probe text may name the cohort and tier ids: it is pasted into the QA report, never committed.
- **After both:** a read-only `SELECT count(*) … WHERE email LIKE '<user>+probe%'` returns **0**. Probe addresses are `<user>+probe…@gmail.com` only, and no email is sent (SQL only).
- A PGlite run of the migration over the `20261012`/`20261014`/`20261020` DDL (the earlier QA pattern) may replace P-2. It cannot replace P-1, because PGlite has one connection.
- Serialisation (P-1) plus correct sequential counting (P-2) proves that two sends cannot pass 5. The route test proves the TypeScript never counts or inserts outside the RPC.

**What stays live (Part B, reduced):** the **screens**, B-1 to B-4 and B-7 to B-9, with **at most 2 real friend invites**. It runs on the preview (or on the local fallback: `npm run dev` with the switch flipped in the working copy only, **never committed**, against the same live database; the link then uses the local origin, so B-3 needs no host swap). Conditions:
- **Champion:** reuse the test Founding Partner the user already made for the earlier invite demos, or the user's own account if it is a champion. Only if neither exists, make one with a **1-month access period, not open-ended**, so it lapses by itself, and write its account id in the QA report.
- **Friends:** only the tester's own `<user>+friend5a…@gmail.com` addresses. Never a third party's.
- **Seeing "0 of 5 left" live is optional.** The render test covers it. If the user wants to see it, it costs 3 more `+alias` invites, all revoked afterwards.
- **Clean-up (replaces B-10):** revoke every test invite (as the champion, or an admin), delete the preview branch the same day, then run a read-only SQL count of account-issued invites with `revoked_at IS NULL AND redeemed_at IS NULL`, which must be **0**. Record it in the QA report. The revoked rows stay as history. That is intended, and nothing else needs clean-up because no friend account can be created in 5a.

#### R-items

| # | Item | Priority |
|---|---|---|
| **R-1** | **Q-1:** the inviter-name fallback is `INVITER_NAME_FALLBACK` via the extracted `adminInviteOps` helper, never the email. Update D-10, §11 and the ops test: "nameless champion → 'AgentPilot'; the display name never contains `@` from the session email." | High |
| **R-2** | **§9 Part B / F5a-15 as amended above:** P-1 and P-2 replace the live race (B-5). Part B is cut to at most 2 `+alias` invites, with the champion rule, the B-3 host swap, the sign-in and settings pre-flight, the local fallback and the clean-up count. Update the QA-report placeholder to "P-1 and P-2 results and the B-6 SQL paste". | High |
| **R-3** | **Zod before any business read (CLAUDE.md rule 2).** D-2 puts the plan-row read before the `.strict()` parse. The order becomes: `.strict()` parse → switch (a config constant, no I/O) → in-force champion read → own-email refusal → name, Reply-To and language → token → RPC → email. The only visible effect is that a non-champion with a bad body gets 400 instead of 403. Adjust the route test expectations. | Medium |
| **R-4** | **Namespace the advisory lock key.** D-13's "no other advisory lock" holds for applied migrations only. The held purge function takes `pg_try_advisory_xact_lock(hashtextextended(p_user_id::text, 0))`, **the identical key for the same account** (`supabase/held/20260916b_purge_business_data.sql:127`). If it is applied, a friend send and a purge of the same account would contend, and the purge would falsely answer `already_running`. Use `hashtextextended('business_os_friend_invite:' \|\| p_issuer_account_id::text, 0)`. That adds a structural string, not a plan name or a number. The text test pins it, and D-13 is corrected. | Medium |
| **R-5** | **Key the public-view branch on `issuer_kind = 'account'`, whatever the grant kind** (F5a-10 says "account-issued invites"). An account row with a non-tier grant cannot be created by 5a, but if one exists it gets `unavailable` and never reaches the existing-account check or the `valid` state with a form. Add one test. | Medium |
| **R-6** | **M-1 scrub on the new database path.** `createForIssuerAccount`, `listForIssuerAccount` and `revokeForIssuerAccount` log `safeDbError(error)` and return `toError(error)`, like their siblings. A CHECK failure inside the RPC returns `details: "Failing row contains (…)"`, which holds the friend's email and the note. Never log the RPC arguments. The repository test asserts that `details` never reaches the logger. | Low |
| **R-7** | **No hard-coded "5" in copy or API messages.** "All 5 of your invites are in use" and "N of 5" interpolate the server's `allowance`, so changing `FRIEND_INVITE_LIMITS` never leaves stale text (the spirit of F5a-3). Also: a whitespace-only note is stored as NULL. | Low |

#### Optimisation suggestions (non-blocking)

- **Nameless-champion hint.** The GET could return whether a name is on file, so the section can say "Friends will see 'AgentPilot' as the sender. Add your name in your profile." One boolean.
- **Exact "N left" (Q-7).** A second, count-only read with the counted predicate replaces the 200-row approximation. `.or` on a SELECT is allowed. It returns at most `allowance` rows by the invariant.
- **Refusal audit while the switch is off.** Consider not auditing `not_eligible` when the refusal is the switch itself. Only hand-made POSTs can reach it, and it would otherwise let any signed-in user add audit rows at will.
- **Accordion consistency.** The section owns its own collapsible state while the page drives the others through `expandedSection`, so two rows could be open at once. This is acceptable, but match the page's behaviour if it is cheap.

#### For the user (business terms)

1. **Nothing changes for customers when this merges.** Friend invites stay switched off until you choose to turn them on, and SA's advice is still **to wait for 5b** before doing that in production.
2. **You will run one database change** in the SQL editor before the merge, the same routine as earlier slices: a pre-check, the change, then two "PASS" checkers.
3. **The "two invites at the same moment" proof no longer touches real data.** QA runs it as a SQL script that undoes itself. Nothing is saved and no email is sent.
4. **Seeing the screens with invites switched on does write a few real records**, because test sites share the live database. To keep that small and clean:
   - use the test Founding Partner account from the earlier invite demos (or your own, if it is one). If a new one is needed, it gets a 1-month access period so it lapses by itself;
   - send **at most two** test invites, only to your own `+alias` Gmail addresses;
   - revoke them at the end. They remain in the admin list as "revoked" history, which is normal and cannot be removed from the app. No friend account is created, because friends cannot sign up until 5b.
5. **A test email's link opens the live site**, where invites are off, so it says "no longer available". To see the friend's page, open the link on the test site's address. QA will walk you through it.
6. **A Founding Partner with no name on their profile** sends invites as "AgentPilot", the same rule you chose for admins. It never shows their email address as the sender name.
7. **Separate, small, your call:** the app's language settings file still logs the old way (9 places). Dev proposes converting it as its own change, not inside this feature.

### Approval
[x] Workplan approved, proceed to implementation, subject to R-1 to R-7 (folded into this workplan) and the amended F5a-15 / §9 Part B.

### SA Code Review 5a — 2026-09-30

**Code Review by SA — 2026-09-30**
**Status:** ✅ Code Approved. No blocker, no must-fix. Four nits (N-1 to N-4). N-1 and N-2 are one-line doc or comment fixes that Dev can fold in before the user's diff view. None needs a second SA pass.

Reviewed uncommitted on `feature/bos-invite-friend-5a` at `fe7f6410` (the `neuronforge-invite-s0` worktree): 14 new files and 29 modified, which is 28 plus the requirement file. That file is still 865 lines.

#### Migration `20261023`: approved to paste

| Check | Verdict |
|---|---|
| Lock first, namespaced (R-4) | ✅ `PERFORM pg_advisory_xact_lock(hashtextextended('business_os_friend_invite:' \|\| p_issuer_account_id::text, 0))` is the first statement. It cannot collide with the held purge function's bare-id key. |
| Cohort re-check | ✅ `plan_row.user_id = p_issuer_account_id AND plan_row.cohort = p_issuer_cohort AND (cohort_expires_at IS NULL OR > now())`, under the lock. |
| Counted rule | ✅ Character for character T-17's predicate: `revoked_at IS NULL AND (redeemed_at IS NOT NULL OR claimed_account_id IS NOT NULL OR link_expires_at > now())`, scoped by `issuer_kind = 'account'` and the issuer. It is pinned against the file and against the TypeScript mirror. |
| Cap, then daily limit, then duplicate | ✅ In T-17 order. The window counts every send whatever its state (T-21). The duplicate guard is live and not accepted, for the same normalised email, including claimed rows. |
| Insert | ✅ `'tier'`, `'account'`, NULL access, and expiry and `email_attempted_at` from the same `now()`. Every CHECK holds by construction (re-read against 20261012). |
| `SECURITY INVOKER`, `SET search_path = ''` | ✅ Every relation is schema-qualified. The built-ins resolve from `pg_catalog`. |
| C-2 | ✅ `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated` and `service_role`, then `GRANT EXECUTE` to `service_role`. **No enumerated REVOKE.** Exactly one `GRANT` (text-tested). |
| Partial index | ✅ `(issuer_account_id, created_at) WHERE issuer_kind = 'account'`, not unique. |
| No plan names and no numbers | ✅ The only numeric literal in the body is the hash seed `0`. Cohort, tier, allowance, limit, window and expiry are all parameters. |
| **SQL-editor safety of the `:` (deviation 5)** | ✅ **Safe.** The Supabase SQL editor sends the text as-is and does no bind-variable substitution. The colon sits inside a single-quoted literal inside a dollar-quoted body, where even psql would not interpolate. Applied migrations already carry colons in literals (`20261001:189`, `20261002:298`, `:315`), and this file already relies on `::` casts. Widening the text test for exactly this one literal is the right shape. |
| One transaction, re-paste fails cleanly | ✅ One `BEGIN`/`COMMIT`, no `IF NOT EXISTS` / `OR REPLACE`, no `--`. |
| Checker | ✅ Read-only (`default_transaction_read_only`). F01 to F08 match §4.2. F03 compares `proconfig` to `search_path=""` via `chr()`, which keeps the literals plain. F05 reads the key columns from `pg_index.indkey`. Dev's PGlite run gave VERDICT PASS 10/10. |
| Rollback | ✅ Drops exactly the function (full signature) and the index. §10 says to revert the code first, which is correct. |

**Paste order (§4.1):** pre-check `0` → migration → friend checker `VERDICT PASS` → Slice 0 checker `VERDICT PASS` → merge.

#### Tenant isolation (`tenant-isolation-guard`)

| Step | Verdict |
|---|---|
| Account source | ✅ Both handlers call `getUser()` → 401, then `resolveAccountId(user.id)`. The issuer is never read from the request. The GET never reads the query string (source-guarded). |
| Send allow-list | ✅ `sendFriendInviteSchema` is `.strict()` with email, `personalNote` and `language` only. The RPC arguments are mapped field by field in `createForIssuerAccount`. Issuer, cohort, type, grant, allowance, limits, expiry and reason come from the session or config. Injected fields → 400 with no RPC (tested). |
| Revoke | ✅ One count-only UPDATE: `.eq('id')`, `.eq('issuer_kind','account')`, `.eq('issuer_account_id', <session>)`, `redeemed_at`/`revoked_at` NULL, `.or(noLiveClaim)`, `{ count: 'exact' }`, **no `.select`**. Not found, not yours and not revocable give the same 404 body. The test asserts that the other account's row is unchanged and that every UPDATE carried the session account (step 7). `mutationOrSelect` `EXEMPT` is unchanged. Dev's live no-match returned `{ data: false }`, so there was no 42703. |
| No `ForAdmin` reuse | ✅ The ops' repository type is a `Pick` of the three `ForIssuerAccount` methods plus `recordInviteEmailOutcome` (hash-filtered). The routes reach nothing else. |
| Champion list | ✅ It reads `BUSINESS_OS_FRIEND_INVITE_LIST_COLUMNS` (7 columns, both issuer filters, capped at 200) and returns only `id, email, createdAt, linkExpiresAt, status, slotReturned` (`FRIEND_INVITE_VIEW_KEYS`, built field by field). `first_viewed_at`, `opened_by_existing_account_at`, `token_hash`, reply-to and reasons are never selected. |
| Triggers and upserts | ✅ None on the table (checker F08). |

#### R-items

| # | Verdict |
|---|---|
| R-1 | ✅ `inviterNameFromProfile` is shared with admin. A nameless champion, or a failed profile read, becomes `INVITER_NAME_FALLBACK`. The test pins "AgentPilot", no `@`, and the From header `AgentPilot <sender>`. |
| R-2 | ✅ §9 Part B has P-1 to P-3, at most 2 invites, the host swap, the pre-flight, the local fallback and the clean-up count. |
| R-3 | ✅ POST: `getUser` → `.strict()` parse → ops (switch → plan read). Revoke: both id and body parsed before the UPDATE. The test asserts that a 400 reads no plan row. |
| R-4 | ✅ See the migration table. |
| R-5 | ✅ `publicInviteView.ts`: `issuer_kind === 'account'` branches **before** `findInviteeEmailForPublicCheck` / `emailHasAccount`. A non-tier grant, or the switch off, gives `unavailable`. Otherwise `signup_opens_soon` with no masked email. Tested, including "the existing-account check is never called" (F5a-10). |
| R-6 | ✅ All three methods log `safeDbError` and return `toError`. The RPC arguments are never logged. The M-1 leak suite covers all three with `details` holding an email and a hash. |
| R-7 | ✅ Every allowance in the API messages and in en/he/es copy is interpolated (the section test uses 7). A whitespace-only note trims to `""` and becomes NULL (`friendInviteOps.ts:360`). |

#### Redemption stays shut, on all three paths

✅ `loadRedeemableInvite` refuses `grant_kind = 'tier'` (`paid_invites_not_available`) before `emailHasAccount`, any code, any claim or any user. An account-issued **cohort** row, which 5a cannot create, is refused too: `allowedTypes` is `[]` for `issuer_kind !== 'admin'`, so it gets `unavailable`, still before any side effect. The pin test drives `requestSignupCode`, `completeSignup` and `completeGoogleSignup` and asserts that only the token lookup ran. Independently, the 20261014 finalise function filters `issuer_kind = 'admin'`.

#### Entitlements (`business-os-entitlements`)

✅ `KNOWN_NON_GATE_IMPORTERS` registers `friendInviteOps.ts`, `friendInviteDeps.ts`, both routes (`resolveAccountId` only) and `publicInviteView.ts` gaining `INVITE_ISSUANCE_POLICY`, each with its exact symbols and the F5a-4 `why`. The section, its copy and the invite page import nothing from the module. The migration text test imports `COHORT_IDS` / `TIER_ORDER` only to assert their absence from the SQL. The tier and cohort literals live only in `config/invites.ts` (`CHAMPION_COHORT`, `TIER_ORDER[0]`) and the config invariant test. `npm run test:bos-entitlements` is green (below).

#### Audit

✅ `BOS_FRIEND_INVITE_CREATED` / `_REVOKED` / `_REFUSED` each have metadata, a `'bos'` audience and a `filterOptions` group (so they do not fall into a "Bos" group). `eventAudience.test.ts` moves 169 → 172 and 24 → 27 Business OS, with the reason in a comment. The champion is both `userId` and `actorId`. Details are `{ correlationId, language }`, `{ correlationId }` or `{ correlationId, reason }` only. The email outcome reuses `BOS_INVITE_EMAIL_SENT` / `_NOT_SENT` exactly as the admin route does. Every call is `.catch` → `logger.error`.

#### UI and admin

✅ `InviteFriendsSection` returns `null` for loading, `eligible: false`, a non-OK response or a fetch error. All hooks run before the early return. With the switch off the GET does **no** database read, so mounting it for every account costs one cheap request. The invite page's `signup_opens_soon` shows the offer (via the extracted `InviteOfferDetails`) and "opens soon", with no `SignupForm` and no Google button. On the admin side, account rows show "Champion · <account id>" and "Revoked by the inviter" (`revoked_by_admin_id` NULL on an account row). The issuer filter rides on `EMPTY_INVITE_FILTER`, and a row from an older server reads as admin. No `console.*` appears in any touched or new file.

#### Rulings on the deviations

The implementation record lists **8** deviations, not 7. All are accepted.

| # | Ruling |
|---|---|
| 1 | **Accepted.** There is no `remaining` on the POST or revoke response; the section re-reads the GET. One derivation, and the section already refetches. §5 still documents `remaining` on both, so see N-1. |
| 2 | **Accepted.** The structural `IssuerPlanReader` keeps the plan repository's name in the wiring only. `friendInviteDeps.ts` in RC-15 `ALLOWED` + `NO_STATE_WRITE_REFERRERS` follows the `creditLeakCheckDeps.ts` precedent exactly, and the latter pins it read-only. |
| 3 | **Accepted** (it was SA's suggestion). The switch-off `not_eligible` is not audited. See N-4 for the switch-on case. |
| 4 | **Accepted.** All three suggestions were optional. |
| 5 | **Accepted.** Column-selecting `EXISTS`, `indkey` in the checker and the one widened literal are all sound (see the migration table). |
| 6 | **Accepted.** Next.js route files may export only handlers and config. |
| 7 | **Accepted** as a naming wart. Rename `adminId` → `accountId` in `resolveInviteFormLanguage` when that file is next touched for a reason. |
| 8 | **Accepted.** `InviteOfferDetails` is a pure extraction. The markup and test ids are unchanged, and the existing page tests are green. |

#### Code Review Comments

1. `docs/workplans/BUSINESS_OS_INVITE_FRIENDS_SLICE_5A_WORKPLAN.md` §5 (the POST and revoke rows) — still promises `remaining` in both responses. Deviation 1 removed it. Update the two rows so QA does not test for it. Priority: Low (N-1)
2. `lib/repositories/BusinessOsInviteRepository.ts:43` — "`token_hash` is written once, by `createForAdmin`" is now untrue: `createForIssuerAccount` writes it too, through the SQL function. Say "by `createForAdmin` or the friend send function". Priority: Low (N-2)
3. `lib/business-os/invites/friendInviteOps.ts:418` — the returned `invite.createdAt` is the app clock (`deps.now`), while the row's `created_at` is the database clock. The difference is cosmetic, and the section refetches straight away. Returning the function's `created_at`, or dropping `createdAt` from the POST, would keep "one clock". Optional. Priority: Low (N-3)
4. `app/api/business-os/friend-invites/route.ts:142` — once the switch is **on**, any signed-in non-champion can POST repeatedly and add one `BOS_FRIEND_INVITE_REFUSED` row per call. Each call is one plan read and no RPC, and the SQL daily limit never runs for them. This is not reachable in 5a (the switch is off). **Record it as a switch-on precondition for 5b:** skip the audit for a TypeScript-side `not_eligible` as well, or rate-limit it. Priority: Low (N-4)

#### Optimisation Suggestions

- The checker proves privileges and shape, not the body. An optional F09, `prosrc` containing the lock-key prefix, would catch a stale or hand-edited function on production. It is not needed for approval, because the text test pins the file.
- Under heavy parallel load (two full Jest runs at once), `InviteFriendsSection.render.test.tsx` and the admin `page.render.test.tsx` failed once on timing. Both pass alone (69/69) and in the full run. Watch them in CI. There is no action unless they flake there.

#### Checks run by SA (2026-09-30)

| Check | Result |
|---|---|
| Touched areas (`lib/business-os/invites`, both friend-invite routes, `app/invite`, `app/admin/business-os-invites`, `components/business-os/settings`, `lib/audit`, `app/api/public/invites`, `mutationOrSelect.guard`, the migration text test) | ✅ 32 suites, 904 tests |
| `npm run test:bos-entitlements` | ✅ 94 suites, 1,983 tests |
| `npm run test:authz-guard` | ✅ 119 tests |
| Full `npx jest` on this branch | 27 suites / 146 tests fail |
| Full `npx jest` on a clean `fe7f6410` checkout | 27 suites / 146 tests fail. **The failing-suite list is identical** (diffed), and none is in this slice's area. Dev's baseline claim holds: 0 regressions |
| `npx next build` (CI placeholder env from `build.yml`) | ✅ exit 0. Both routes are `ƒ` (dynamic) |

### Code Approved for QA: Yes

The migration is **approved to paste** in the §4.1 order, before merge. Dev folds in N-1 and N-2 (docs and comments only, with no re-review). N-3 is optional. N-4 is a 5b switch-on precondition. Then the user's diff view, then QA with the P-1 and P-2 probes.

---

## QA Testing Report

*(QA to populate. Must include the P-1 and P-2 results, the P-3 and B-10 counts, and the B-6 SQL paste, per F5a-15 as amended.)*

### QA Report 5a — 2026-09-30

**QA — 2026-09-30**
**Test mode:** full
**Strategy used:** A + B (Jest: the repository's suites plus 40 scratchpad adversarial probes), C (PGlite: the real migration chain and every P-2 branch as `service_role` in a rolled-back transaction), mutation testing (16 mutants, one file at a time), and log analysis of every route path. D (browser) is left to the user's reduced demo below. The migration is not on production yet, so P-1 is written as a user step.
**Focus:** all (security, schema, api, ui)
**Skipped:** the live browser demo and P-1 (a two-connection lock race cannot run in PGlite, and QA does not write to production). Both are exact user steps below.
**Input source:** the prompt (TL's QA brief), the workplan's §8 and §9 (as amended by SA R-2), and the SA code review.

**Verdict: ✅ PASS WITH NOTES.** No High or Medium bug. One Low test gap (QA5a-1) and two informational notes. **The merge is gated on the user's before-merge steps below** (the migration, both checkers, then P-1).

Tested uncommitted on `feature/bos-invite-friend-5a` at `fe7f6410` (the `neuronforge-invite-s0` worktree). QA took a byte snapshot of all 44 changed or new files before starting. Every mutant was restored and its hash checked against that snapshot, and at the end the whole tree matched it. The only change QA made is this section and one Change History row. The requirement file is untouched: still 865 lines, same hash.

#### Test Coverage

| Acceptance criterion / brief item | Tested? | Result | Notes |
|---|---|---|---|
| Touched suites green | ✅ | Pass | 33 suites, **1,006 / 1,006** (`lib/business-os/invites`, both friend-invite routes, `app/invite`, `app/admin/business-os-invites`, `components/business-os/settings`, `lib/audit`, `app/api/public/invites`, `mutationOrSelect.guard`, the repository and the migration text test) |
| `npm run test:authz-guard` | ✅ | Pass | **119 / 119**, counts unchanged |
| `npm run test:bos-entitlements` (the diff imports from `entitlements/`) | ✅ | Pass | **94 suites, 1,983 / 1,983** |
| P-2 in PGlite: migration chain `20261012`, `13`, `14`, `20`, `23` | ✅ | Pass | **45 / 45 assertions.** Detail below |
| Checker `check-bos-friend-invites-migration.sql` | ✅ | Pass | **VERDICT PASS, 11 pass 0 fail** (F01, F02, F03, F04a, F04b, F05, F06a, F06b, F07, F08, F09) |
| Slice 0 checker after `20261023` | ✅ | Pass | VERDICT PASS (11 / 0) |
| Rollback | ✅ | Pass | Pre-check back to 0, index gone, the friend checker FAILs (as it should), the Slice 0 checker still PASSes, and a re-apply works. A second paste of the migration fails cleanly in one transaction |
| P-1 lock race (two connections) | ⚠️ | Not runnable here | User step below. The lock-first order and the namespaced key are pinned by the text test and checker F09 |
| 401 signed out (GET, POST, revoke) | ✅ | Pass | Repository suites |
| Non-champion → 403 (POST) / `{ eligible: false }` (GET) | ✅ | Pass | Trial, Essentials, expired champion. SQL `not_eligible` too (PGlite) |
| Switch off → section hidden, no DB read, POST refused | ✅ | Pass | UI test; the probe confirms the GET makes **0 plan reads** even for a real champion; POST 403, not audited |
| `.strict()` rejects injected fields | ✅ | Pass | The repository's 6 fields, plus QA probes for `issuerId`, `email_locked`, `tier`, `cohort`, `grant_kind`, `issuer_account_id`, `replyTo`, `inviterDisplayName`, a `__proto__` key, a `constructor` key and an array body: all 400, **0 plan reads, 0 RPC calls** |
| Another champion's invite id → 404, row unchanged | ✅ | Pass | Revoke route test; mutants M1 and M1b (the ownership predicates removed) are both killed |
| Blank note → NULL | ✅ | Pass | Probe: spaces, tabs and newlines, empty and absent all reach the RPC as `null`; a padded note is trimmed; the friend's email is trimmed and lower-cased |
| Nameless champion sends as "AgentPilot" | ✅ | Pass | Probe: a null name, a blank name, no profile row and a failed profile read all give RPC name `AgentPilot` and From `AgentPilot <platform address>`. The session email is never in the name, the From header, the subject or the text. Reply-To = the session email. A named champion gives `"Dana Levi via AgentPilot" <…>` |
| List returns only the allowed fields | ✅ | Pass | Probe: with the repository **over-returning** `token_hash`, `first_viewed_at`, `opened_by_existing_account_at`, `inviter_reply_to`, `internal_reason` and `personal_note`, each item still has exactly `id, email, createdAt, linkExpiresAt, status, slotReturned`, and none of those values appears in the body. A spoofed `?accountId=` is ignored |
| Friend page: `signup_opens_soon`, no form, no Google button, no existing-account lookup | ✅ | Pass | Repository tests (`findInviteeEmailForPublicCheck` / `emailHasAccount` never called). Probe in en/he/es with a signed-in visitor and Google configured: **0** `input`/`form`/`textarea`/`select`, no Google button, one network call (validate), `dir` rtl for he |
| All three redemption paths refuse account-issued invites before any side effect | ✅ | Pass | Redemption pin test; mutant M7 (refusal removed) is killed by 5 tests |
| Admin issuer filter | ✅ | Pass | Admin page render test (a row from an older server reads as admin) |
| No email, token or note in logs or audit | ✅ | Pass | Probe captures **every** logger call and audit entry on: happy path, email not sent (provider reason carrying the friend's address), `allowance_reached`, `daily_limit`, `already_invited`, `not_eligible`, a DB error, and `own_email`. None contains the friend's email, the note, the session email, the token or its first 12 characters. Audit details are exactly `{correlationId, language}` or `{correlationId, reason}`. The 429 message holds no digit. (The repository's M-1 suite covers `safeDbError`. PGlite shows why it matters: a CHECK failure's `detail` is "Failing row contains (… the friend's email …)") |
| en/he/es copy | ✅ | Pass | Probe: he and es have every en key of `inviteFriendsCopy`, none empty and none identical to English. Hebrew strings are in Hebrew. The interpolated sentences carry the numbers passed in (allowance 7). `signupOpensSoon` exists in all three (repository test) |

**P-2 in PGlite (all as `service_role`, one transaction, rolled back):**

| Probe | Result |
|---|---|
| created ×5, then the 6th | `created` ×5 → `allowance_reached` ✅ |
| Inserted row | `issuer_kind` account, `issuer_admin_id` NULL, `grant_kind` tier, `grant_id` = the first tier, type paid, access NULL/NULL, `email_locked` true, `email_attempted_at` set, `email_sent_at` NULL, expiry = DB `now()` + 30 days ✅ |
| Another champion is unaffected by the first one's 5 | `created` ✅ |
| Revoked → the slot returns | `created`, then full again ✅ |
| Expired (unclaimed) → the slot returns | `created` ✅ |
| **Claimed but expired keeps its slot** | `allowance_reached` ✅ |
| Same live address | `already_invited` ✅; a claimed-past-expiry address is also `already_invited` ✅; a revoked address can be re-invited ✅; the same address from **another** champion is `created` ✅ |
| `daily_limit` at 10 in 24 h, **including slots freed by revokes** | 10 created with every one revoked (0 counted) → the 11th is `daily_limit` ✅. A send 25 h old leaves the window (`created`); one 23 h old still counts (`daily_limit`) ✅. The cap is checked before the daily limit ✅ |
| `not_eligible` | trial account ✅, expired champion cohort ✅, **no plan row** ✅, Essentials tier with no cohort ✅, and a wrong cohort parameter ✅. `not_eligible` wins even with allowance 0 ✅ |
| Refusals | write **0 rows**, and return NULL id and expiry ✅ |
| An un-normalised email | refused by `business_os_invites_email_normalised` ✅ |
| `anon` / `authenticated` execute | "permission denied for function" ✅; `has_function_privilege` false / false / true (service_role) ✅ |
| After `ROLLBACK` | **0 rows** ✅ |

#### Mutation testing (16 mutants, one file at a time, each restored and hash-checked)

| # | Mutant | File | Killed by |
|---|---|---|---|
| M1 | Revoke without `.eq('issuer_account_id', …)` (the ownership predicate) | `BusinessOsInviteRepository.ts` | ✅ repository test |
| M1b | Revoke without `.eq('issuer_kind','account')` | `BusinessOsInviteRepository.ts` | ✅ repository test |
| M2a | Counted rule (TS): a claimed invite no longer counted | `friendInviteOps.ts` | ✅ ops tests (2) |
| M2b | Counted rule (SQL): a claimed invite no longer counted | migration | ✅ text test + PGlite |
| M2c | Counted rule (SQL): a revoked invite still counted | migration | ✅ text test + PGlite |
| M3 | Cap comparison `>=` → `>` | migration | ✅ text test + PGlite (a 6th invite created) |
| M4 | Daily window `hours` → `days` | migration | ✅ text test + PGlite |
| **M4b** | **Daily window counts only non-revoked rows** (appends `AND recent_row.revoked_at IS NULL`) | migration | ⚠️ **Survives Jest**; killed only by QA's PGlite (see QA5a-1) |
| M5 | R-1: a nameless champion falls back to the session email | `friendInviteOps.ts` | ✅ ops test |
| M5b | R-1: a failed profile read falls back to the session email | `friendInviteOps.ts` | ✅ ops test |
| M6 | R-5: the public branch keyed on `account` AND tier (a cohort account row falls through) | `publicInviteView.ts` | ✅ public view test |
| M6b | The public page ignores the switch | `publicInviteView.ts` | ✅ public view + validate route (2) |
| M7 | Redemption tier refusal removed | `inviteRedemption.ts` | ✅ redemption tests (5) |
| M8 | Switch gate always on | `friendInviteOps.ts` | ✅ ops + route (4) |
| M9 | Own-email refusal removed | `friendInviteOps.ts` | ✅ ops (4) |
| M10 | `.strict()` dropped from the send schema | `inviteSchemas.ts` | ✅ schema + route (15) |

**15 of 16 are killed by the repository's own suites. All 16 are killed once QA's PGlite run is counted.**

#### Issues Found

##### Bugs (must fix before commit)
None.

##### Performance Issues (should fix)
None. With the switch off, the GET makes no database read (pinned). Mounting the section for every account costs one cheap request.

##### Edge Cases (nice to fix)
1. **QA5a-1: the daily-limit text test does not pin "whatever its state"** — `supabase/migrations/__tests__/business-os-friend-invites.migration.test.ts:144-147` — Severity: Low (test gap; the SQL itself is correct).
   - The test asserts that the window clause is *present* (`toContain`). Appending `AND recent_row.revoked_at IS NULL` still passes it (M4b), but it breaks T-21: send and revoke in a loop would then have no daily limit. PGlite catches it; CI does not run PGlite.
   - Fix (Dev, optional before merge): assert the whole `v_recent` statement, from `SELECT count(*) INTO v_recent` to the closing `;`, with whitespace normalised. The `v_counted` statement is already pinned that way, which is why M2c is killed.
2. **QA5a-2 (information): two older checkers FAIL on the current schema, not because of 5a** — `scripts/check-bos-invite-existing-account-migration.sql:66` (E02 expects 16 CHECKs) and `scripts/check-bos-invite-signup-migration.sql:113` (S02 expects 23). The table has had 27 since `20261020` added four. The result is identical before and after `20261023`. They are point-in-time checkers and are **not** in the 5a checklist. The user should not run them as merge gates (only the friend checker and the Slice 0 checker, which both PASS).
3. **QA5a-3 (information):** a champion can revoke an invite that has already expired (it is unclaimed, so it matches the UPDATE). It changes from Expired to Revoked; its slot was already back. Harmless, and it fits D-6 ("withdrawing is never harmful"). No action.
4. Known and accepted (SA): N-3 (the POST's `createdAt` is the app clock) and N-4 (a 5b switch-on precondition). Both unchanged.

#### Test Outputs / Logs

```text
touched suites        Test Suites: 33 passed, 33 total   Tests: 1006 passed, 1006 total
test:authz-guard      Test Suites: 1 passed, 1 total     Tests: 119 passed, 119 total
test:bos-entitlements Test Suites: 94 passed, 94 total   Tests: 1983 passed, 1983 total
QA probes (scratch)   Test Suites: 2 passed, 2 total     Tests: 40 passed, 40 total
PGlite P-2            TOTAL 45 pass, 0 fail
friend checker        VERDICT PASS 11 pass 0 fail
slice 0 checker       VERDICT PASS 11 pass 0 fail
mutants               16 run: 15 killed by Jest, M4b killed by PGlite only
```

---

#### User step: P-1, the lock under two connections (after `20261023` is applied, BEFORE merge)

**Nothing is kept and no email is sent.** Every write is inside a transaction that rolls back, and it is SQL only. Use the **existing test Founding Partner** for `<FP_ACCOUNT_ID>` and your own Gmail local part for `<you>`, **all lower case** (the table refuses capitals). `'champion'`, `'paid'`, `'basic'`, `5`, `10`, `24` and `30` are the values of `FRIEND_INVITE_POLICY` / `FRIEND_INVITE_LIMITS` / `INVITE_LINK_EXPIRY` today. Open **three** SQL-editor tabs.

**Step 0: pre-flight (read-only, any tab).** Expected: `in_force_champion = 1`, `counted ≤ 4`, `sent_last_24h ≤ 9`. If not, stop and use another test champion.

```sql
SELECT
  (SELECT count(*) FROM public.business_os_account_plans AS plan_row
    WHERE plan_row.user_id = '<FP_ACCOUNT_ID>'::uuid AND plan_row.cohort = 'champion'
      AND (plan_row.cohort_expires_at IS NULL OR plan_row.cohort_expires_at > now())) AS in_force_champion,
  (SELECT count(*) FROM public.business_os_invites AS invite_row
    WHERE invite_row.issuer_kind = 'account' AND invite_row.issuer_account_id = '<FP_ACCOUNT_ID>'::uuid
      AND invite_row.revoked_at IS NULL
      AND (invite_row.redeemed_at IS NOT NULL OR invite_row.claimed_account_id IS NOT NULL OR invite_row.link_expires_at > now())) AS counted,
  (SELECT count(*) FROM public.business_os_invites AS recent_row
    WHERE recent_row.issuer_kind = 'account' AND recent_row.issuer_account_id = '<FP_ACCOUNT_ID>'::uuid
      AND recent_row.created_at > now() - interval '24 hours') AS sent_last_24h;
```

**Tab 1: takes the lock and holds it for 20 seconds.**

```sql
BEGIN;
SET LOCAL ROLE service_role;
SELECT probe.result_outcome AS tab1_outcome
  FROM public.business_os_create_friend_invite('<FP_ACCOUNT_ID>'::uuid, 'champion', 'paid', 'basic', 5, 10, 24, encode(sha256(convert_to('qa5a-p1-tab1-' || clock_timestamp()::text, 'UTF8')), 'hex'), '<you>+probe5a-p1a@gmail.com', 'QA probe', NULL, 'en', NULL, 'Friend invite from a champion account', 30) AS probe;
SELECT pg_sleep(20);
ROLLBACK;
```

**Tab 2: run it within about 5 seconds of pressing Run on tab 1.**

```sql
BEGIN;
SET LOCAL ROLE service_role;
SELECT probe.result_outcome AS tab2_outcome, clock_timestamp() - statement_timestamp() AS waited
  FROM public.business_os_create_friend_invite('<FP_ACCOUNT_ID>'::uuid, 'champion', 'paid', 'basic', 5, 10, 24, encode(sha256(convert_to('qa5a-p1-tab2-' || clock_timestamp()::text, 'UTF8')), 'hex'), '<you>+probe5a-p1b@gmail.com', 'QA probe', NULL, 'en', NULL, 'Friend invite from a champion account', 30) AS probe;
ROLLBACK;
```

**Tab 3: run it while tab 2 is still spinning (read-only).**

```sql
SELECT lock_row.pid, lock_row.granted, activity.wait_event_type, activity.wait_event,
       position('pg_sleep' IN activity.query) > 0 AS is_tab1
  FROM pg_locks AS lock_row
  JOIN pg_stat_activity AS activity ON activity.pid = lock_row.pid
 WHERE lock_row.locktype = 'advisory'
   AND activity.query LIKE '%probe5a-p1%'
 ORDER BY lock_row.granted DESC;
```

| Check | Pass | Fail → do not merge |
|---|---|---|
| Tab 3 while tab 2 waits | **Two rows**: tab 1 `granted = true`; tab 2 `granted = false`, `wait_event_type = Lock`, `wait_event = advisory` | Only one row, or tab 2 granted: the two sends are not serialised |
| Tab 2 finishes | Only **after** tab 1 finishes (about the rest of the 20 s). If the editor shows the row: `tab2_outcome = created`, `waited` about 10–20 s | It answers at once (`waited` ≈ 0), or with anything other than `created` while pre-flight `counted ≤ 4` |
| Tab 1 | Finishes after about 20 s. If shown: `tab1_outcome = created` | An error (for example "permission denied": then `SET LOCAL ROLE` is not working, so send the text to QA) |

(If the editor shows only "Success. No rows returned" because the last statement is `ROLLBACK`, tab 3 and the timing are the evidence. Tab 2 sees the count **without** tab 1's row because tab 1 rolled back. The count after a *committed* competing send is proven by PGlite's sequential P-2 and READ COMMITTED's per-statement snapshot, as SA noted.)

**Step 4: clean-up proof (read-only). It must return `0`.**

```sql
SELECT count(*) AS probe_rows FROM public.business_os_invites WHERE email LIKE '%+probe5a-p1%';
```

---

#### The user's production checklist

**Before merge (SQL editor, in this order):**

| # | Step | Expected |
|---|---|---|
| 1 | Pre-check: `SELECT count(*) AS friend_invite_function FROM pg_proc JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace WHERE pg_namespace.nspname = 'public' AND pg_proc.proname = 'business_os_create_friend_invite';` | `0` |
| 2 | Paste the whole of `supabase/migrations/20261023_business_os_friend_invites.sql` | "Success. No rows returned." |
| 3 | Paste `scripts/check-bos-friend-invites-migration.sql` | `VERDICT PASS`, **11 pass 0 fail** (F01–F09 incl. F04a/b, F06a/b) |
| 4 | Paste the Slice 0 checker `scripts/check-bos-invites-migration.sql` | `VERDICT PASS` (do **not** use the existing-account or signup checkers; see QA5a-2) |
| 5 | P-1 above: pre-flight, tabs 1–3, then the count | Two advisory-lock rows (one waiting), tab 2 finishing after tab 1, final count `0` |
| — | Any FAIL | Stop. Rollback script `supabase/SQL Scripts/20261023_business_os_friend_invites_rollback.sql`, do not merge, send the output to QA |

**After merge, with the switch still OFF (production):**

| # | Step | Expected |
|---|---|---|
| 6 | Sign in as the test Founding Partner and open Business OS settings | **No "Invite friends" row**; "Your plan" unchanged |
| 7 | Browser console on the app origin: `fetch('/api/business-os/friend-invites').then(r=>r.json())` | `{ success: true, data: { eligible: false } }` |
| 8 | `fetch('/api/business-os/friend-invites/00000000-0000-4000-8000-000000000000/revoke',{method:'POST'}).then(r=>r.status)` | **404** (not 500); Vercel logs show no 42703 |
| 9 | `/admin/business-os-invites` | Loads; the issuer filter is there; existing admin rows unchanged. An existing admin champion link still opens `valid` with the form |

**The reduced demo (optional; ONLY a local run or a throwaway preview with the switch on, never committed or merged):**

| # | Step | Expected |
|---|---|---|
| 10 | Local: `npm run dev` with `accountInvitesAvailable: true` in the working copy only. Or a throwaway `preview/bos-friend-5a-switch-on` branch, deleted the same day | — |
| 11 | As the **existing test Founding Partner**, send **at most 2** invites, only to your own `+friend5a…@gmail.com` aliases (B-1 to B-4, B-7 to B-9 in §9) | "N of 5 left", the link shown once, "via AgentPilot" email, the friend page says "opens soon" with no form. On a preview, swap the link's host and keep `#t=…` |
| 12 | Revoke **both** (as the champion, or as an admin) | Each shows Revoked, "slot back" |
| 13 | Read-only: `SELECT count(*) FROM public.business_os_invites WHERE issuer_kind = 'account' AND revoked_at IS NULL AND redeemed_at IS NULL;` | **`0`**. Record it here. The revoked rows stay as history (intended) |

#### Final Status
- [x] All acceptance criteria that can run before production pass. QA recommends commit, subject to the before-merge SQL steps (1–5) above.
- [ ] Issues found — Dev must address before commit *(none blocking; QA5a-1 is an optional test tightening)*

---

## Commit Info

**User approval (2026-09-30, in session):** "I approve committing 5a and opening the PR."

| Field | Value |
|---|---|
| Branch | `feature/bos-invite-friend-5a` (from `origin/main` `fe7f6410`, rebased onto current `origin/main` before push) |
| Commits | docs (requirement), docs (this workplan), feat (code + migration `20261023` + checker + rollback + edits to existing tests), test (new test files); hashes are listed on the PR |
| PR | Opened by RM to `main`. **Do not merge** until the database steps in QA Report 5a pass (pre-check, paste, friend checker 11/11, Slice 0 checker, P-1). |
| Merge | Not merged. Merging needs the user's separate instruction. |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-30 | Created | Slice 5a workplan (Dev) against `origin/main` `fe7f6410`: migration `20261023` (the atomic send function and the partial issuer index), config switch and limits, three issuer-scoped repository methods, customer routes under `/api/business-os/friend-invites/**`, `InviteFriendsSection`, the invite page's `signup_opens_soon` state, admin-list issuer fields and filter, audit events. Questions Q-1 to Q-7 for SA. |
| 2026-09-30 | SA workplan review: approved with conditions | Q-1 rejected (the fallback is "AgentPilot", never the email); Q-2 to Q-7 approved. R-1 to R-7: name fallback, rolled-back SQL race probe replacing the live race (F5a-15 amended) with a reduced and cleaned live demo, Zod before the plan read, a namespaced advisory-lock key (it collides with the held purge function), the public-view branch keyed on `issuer_kind`, `safeDbError` on the new database path, no hard-coded allowance in copy. |
| 2026-09-30 | Implemented (Dev), uncommitted | R-1 to R-7 folded in (§2.2, §4, §5, §9, §11). T-0 to T-13 done; implementation record, deviations and check results in §6.1. PGlite: checker PASS and every P-2 branch. Live no-match revoke: `false`, no 42703. Full Jest: 0 regressions against `origin/main`. |
| 2026-09-30 | SA code review 5a: approved | No blocker, no must-fix; nits N-1 to N-4 (a §5 contract drift, a stale repository comment, the app-clock `createdAt`, and the refusal audit for non-champions once the switch is on, a 5b precondition). Deviations 1–8 accepted. Migration `20261023` approved to paste (the `:` in the lock-key literal is editor-safe). SA re-ran the checks: touched suites 904/904, bos-entitlements 1,983/1,983, authz-guard 119/119, `next build` exit 0; full Jest 27/146 failing, the same suite list as a clean `fe7f6410`. |
| 2026-09-30 | SA code-review nits (Dev) | N-1: §5 no longer promises `remaining` on POST or revoke. N-2: repository header names both writers of `token_hash`. N-3 (return the DB `created_at`) not done: it would change the approved migration's signature. N-4 recorded as a 5b switch-on condition (§6.1). Checker row F09 added (the function source carries the lock-key prefix). |
| 2026-09-30 | QA Report 5a: PASS WITH NOTES | Touched suites 1,006/1,006, authz-guard 119/119, bos-entitlements 1,983/1,983, 40 adversarial probes. PGlite P-2 45/45 (every refusal and slot rule, `anon`/`authenticated` denied, 0 rows after rollback), friend checker 11/11 and Slice 0 checker PASS, rollback verified. 16 mutants: 15 killed by Jest, M4b only by PGlite (QA5a-1, Low test gap). P-1 written as a user step, and the before-merge / after-merge / reduced-demo checklist added. No bug. |
| 2026-09-30 | QA5a-1 test fix (Dev) | The migration text test pins the whole `v_recent` statement; the `revoked_at IS NULL` mutant now fails it (23/23 → 1 failed; the migration was restored and diffs identical to its backup). Migration SQL unchanged (§6.1). |
| 2026-09-30 | Committed (RM) | User approved in session: "I approve committing 5a and opening the PR." RM committed on `feature/bos-invite-friend-5a` in four Conventional Commits, rebased onto `origin/main`, pushed and opened the PR to `main`. Not merged; the database steps gate the merge. |
