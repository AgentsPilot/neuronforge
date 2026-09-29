# Workplan: Business OS Invite-Only Signup, Slice 3 (Sign up with Google, plus the platform-email fix)

> **Last Updated**: 2026-09-29

**Developer:** Dev
**Requirement:** [BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md) (§7.3 FR-11 to FR-13, §8.1, §10 Slice 3, AC-11, BQ-2, BQ-7, §16.3 T-3 to T-6, §16.5 L-1, L-8, L-10)
**Previous slices:** [Slice 1](/docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_1_WORKPLAN.md) (1a #133, 1b #139, 1c #142, CAS hotfix #143), [Slice 2](/docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_2_WORKPLAN.md) (2a #145; 2b and 2c moved to the backlog on 2026-09-29)
**Date:** 2026-09-29
**Branch:** `feature/bos-invite-signup-slice-3`, cut from `origin/main` at bd763222 (the #146 merge) on 2026-09-29, in the `neuronforge-invite-s0` worktree. Upstream tracking is unset, so a plain `git push` cannot reach `main`. Every file reference below was checked against bd763222.
**3a branch:** `feature/bos-invite-signup-slice-3a`, switched from `feature/bos-invite-signup-slice-3` on 2026-09-29 carrying these docs uncommitted; no upstream. 3b is built separately in the `neuronforge-invite-s1` worktree.
**Status:** SA approved with conditions. **3a SA code-approved; QA waived by the user for 3a (2026-09-29); user approved the commit and PR (2026-09-29); RM committing on `feature/bos-invite-signup-slice-3a` and opening the PR (hashes and PR number in Commit Info once they exist).** 3b in progress elsewhere.

## Overview

Slice 3 adds a **"Continue with Google"** button next to the code-and-password form on a valid champion invite. The server verifies the Google ID token, requires Google's verified email to equal the invited email, and then runs **the same claim, create, finalise path as Slice 1b**. Only the proof of mailbox ownership changes: a verified Google ID token replaces the emailed code. The browser then signs in with the same ID token through Supabase (`signInWithIdToken`), which also links the Google identity to the new account. Account creation stays server-side (T-6), so Slice 4 can later switch off public signups. The slice also carries a small email fix the user asked for: HTML developer comments are removed from sent emails, and the AgentPilot logo goes on the two platform emails (the invitation and the sign-up code). **Proposed split: 3a (the email fix, which ships first and needs no ops work) and 3b (Google, which merges inert until its client id is configured).** No migration.

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [How Google sign-in works today](#2-how-google-sign-in-works-today)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [API contract](#5-api-contract)
6. [Ops prerequisites (3b)](#6-ops-prerequisites-3b)
7. [Task List](#7-task-list)
8. [Traceability](#8-traceability)
9. [Test plan](#9-test-plan)
10. [Production manual check](#10-production-manual-check)
11. [Rollback](#11-rollback)
12. [Questions for SA](#12-questions-for-sa)
13. [Logging-standard check (console.*)](#13-logging-standard-check-console)
14. [SA Review Notes](#sa-review-notes)
15. [QA Testing Report](#qa-testing-report)
16. [Commit Info](#commit-info)

---

## 1. Analysis Summary

| Area | What Slice 3 touches | Verified against bd763222 |
|---|---|---|
| Redemption core | `completeSignup` in `lib/business-os/invites/inviteRedemption.ts` runs load → code attempt → claim (`claimForSignup`, CAS with `signup_code_hash = H`) → `createConfirmedUser({ id, email, password })` → `finish` (finalise via `provisionFromInvite`, retried once) or `stopWithClaimKept` (FR-12a record). `loadRedeemableInvite` already does state, live claim (409 `signup_in_progress`), grant and issuance policy, and existing account (409 `existing_account` with the one-time stamp). | `inviteRedemption.ts:188-473` |
| Claim CAS | `claimForSignup` uses `{ count: 'exact' }` + `casWon`, **no `.select()`** (the #143 lesson). It is conditional on the code hash, so the Google path cannot reuse it unchanged. | `BusinessOsInviteRepository.ts:501-540` |
| Auth door | `AuthAccountRepository` has `emailHasAccount`, `createConfirmedUser` (password **required**), `findUserExists`. No delete method (I-1). Importers are pinned by `authAccountRepository.callers.guard.test.ts`. | `AuthAccountRepository.ts` |
| Finalise SQL | `business_os_finalise_invite_redemption` (20261014) is keyed on `(invite id, claimed account id, email)` and does not care how the mailbox was proven. The CHECKs `signup_code_paired` and `claim_paired` are met if the Google claim clears the code hash and expiry together, as the code claim does. **No migration is needed.** | `20261014_business_os_invite_signup.sql:19-27, 96` |
| Routes | `app/api/public/invites/signup/{code,complete}/route.ts` share `redemptionDeps.ts` (wiring, `refusalToHttp`, `no-store` + `no-referrer` headers, audit flush). `complete` exports `maxDuration = 60`, pinned below the 120 s lease by `signupCode.test.ts:47`. | Route sources |
| Invite page | `app/invite/page.tsx` renders `SignupForm` for a signed-out visitor on a `valid` invite. The token is kept in memory and the URL is already reduced to `/invite`. `layout.tsx` sets `referrer: no-referrer`. There is no CSP header anywhere (`next.config`, `middleware.ts`), so loading Google's script needs no header change. | `page.tsx:265`, `layout.tsx` |
| Google libraries | `googleapis` 157 is a direct dependency but is **imported nowhere** in `lib/` or `app/`. `google-auth-library` 10.4.1 is installed (hoisted, via `googleapis`) and has `OAuth2Client.verifyIdToken`. There is no `jose` direct dependency. | `package.json:79`, `node_modules/google-auth-library/package.json` |
| Google client ids | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_ID` exist for the **plugin** OAuth (Gmail, Drive, …). The client used by Supabase's Google **login** provider is configured in the Supabase dashboard, not in this repository. Whether the two are the same client is **unknown** (ops check G-1). | `docs/VERCEL_ENV_SETUP.md:69-78`, plugin definitions |
| Logger | Redaction covers `password`, `token`, `signupCode`, `otp`. **Not** `idToken` or `credential`. | `lib/logger/config.ts:32-55` |
| Email layout | `wrapInBrandedTemplate` (`base-template.ts:190-309`) ships four multi-line `<!-- … -->` design notes in every email, plus one Outlook conditional (`<!--[if mso]>…<![endif]-->`, lines 224-232), which **stays**. Content templates add their own: `booking-confirmation`, `intake-*`, `invoice`, `payment-receipt`, `refund-confirmation`, `consent-confirmation` (`<!-- Greeting -->` and similar). 16 templates plus `bizql/mutate/emailSend.ts` go through the wrapper. | `grep '<!--' lib/email` |
| Logo | The wrapper already renders `<img src="${logoUrl}" alt="${businessName}">` when `logoUrl` is set, but with no width or height. Both platform templates define their own identical `PLATFORM_BRANDING` (`businessName: 'AgentPilot'`, no logo). The brand manifest `lib/brand/logo.ts` names `WORDMARK.light` = `/images/brand/wordmark.png`, **330×60**, transparent, for a light background (the email page ground is `#f5f5f5`). `https://neuronforge-kohl.vercel.app/images/brand/wordmark.png` answers **200, `image/png`, 21,107 bytes, `Access-Control-Allow-Origin: *`** (checked 2026-09-29). `platformUrl()` in `lib/utils/origins.ts` builds absolute URLs from `NEXT_PUBLIC_APP_URL`. | `curl -I`, `lib/brand/logo.ts:63-76` |
| Migrations | Last on `main`: `20261020_business_os_invite_email.sql`. `20261015`–`20261019` are reserved for credit deduction and `20261020`–`20261022` for invite Slice 2. **Slice 3 adds none.** If SA requires one, it takes `20261023` or later. | `ls supabase/migrations` |

**Out of scope:** the reprioritised hardening items (2b resend and cap, 2c delivery status, the code email's sender and fail-closed behaviour, the invite link domain; see the requirement §10), Google One Tap, any other OAuth provider, closing public signup (Slice 4), and paid invites (Slice 5; the Google path refuses a tier grant exactly as 1b does).

---

## 2. How Google sign-in works today

**Supabase OAuth, redirect flow with PKCE, entirely in the browser.** `signInWithGoogle` (`lib/client/auth-actions.ts:142`) calls `supabase.auth.signInWithOAuth({ provider: 'google', redirectTo: <origin>/auth/callback })`. Google redirects back to Supabase, then to `/auth/callback`, where the browser client (`detectSessionInUrl`) exchanges the code and writes the `sb-*` cookies. `app/auth/callback/page.tsx` reads the session, writes the `USER_LOGIN` audit, and routes to `/onboarding-chat` or `/business-os`. The Google client id and secret live in the Supabase dashboard (Auth → Providers → Google). The only in-repo caller is the `/test-business-os` harness (`TestAuthPanel.tsx:71`). The marketing site offers the same button on its own origin.

**Why the invite cannot use it.** `signInWithOAuth` makes Supabase create the user on the first sign-in. That is (a) a public signup, which Slice 4's "disable new signups" switch will refuse (T-6), and (b) a user created **before** the invite's email lock is checked, so a mismatched Google account would leave a stray account that nothing may delete (I-1).

**The handoff (`app/api/auth/handoff/**`, `app/auth/handoff/page.tsx`)** mints a session server-side (`generateLink` magic link + browser `verifyOtp`). It is not used here: 1b's D-6 made "the server mints no session" structural, and a magic-link session would not link the Google identity.

---

## 3. Implementation Approach

### 3.1 Split

| Sub-slice | Scope | Migration | Ops before merge | Demo |
|---|---|---|---|---|
| **3a: "Platform emails look like AgentPilot"** | Strip HTML comments (except MSO conditionals) from every email the wrapper renders; move the layout's design notes into TypeScript comments; one shared platform branding with the AgentPilot wordmark on the invitation and sign-up-code emails; business emails unchanged. | none | none | §10.1 |
| **3b: "Continue with Google"** | GIS button on the invite page, a new public route, Google ID-token verification, a Google claim CAS, a password-less confirmed-user creation, a shared post-claim tail, browser `signInWithIdToken`. | none | **none to merge** (the button is hidden until the client id is configured, D-9). G-1 to G-4 to switch it on. | §10.2 |

3a is about 8 files and is independent. 3b is about 20 files. Each is one PR.

### 3.2 The Google flow (3b)

```
Browser (invite page, valid, signed out)
  1. rawNonce = 32 random bytes (base64url); hashedNonce = SHA-256(rawNonce) hex
  2. GIS button (google.accounts.id, popup, nonce = hashedNonce) → credential (ID token)
  3. POST /api/public/invites/signup/google { token, idToken, nonce: rawNonce }
Server (completeGoogleSignup)
  4. session present → 409 signed_in
  5. loadRedeemableInvite(token, allowStaleClaimWithAccount: true)      [shared with 1b]
       not recognised / used / revoked / expired / signup_in_progress /
       paid_invites_not_available / unavailable / existing_account (stamp + audit once)
  6. verifyGoogleIdToken(idToken, rawNonce):
       signature (Google certs), aud = the configured client id, iss ∈ {accounts.google.com,
       https://accounts.google.com}, exp, iat not older than 10 min, nonce = SHA-256(rawNonce)
       → invalid → 400 google_token_invalid
       email_verified !== true → 409 google_email_unverified
  7. lower(trim(google email)) !== row.email → audit REFUSED {reason: google_email_mismatch}
       → 409 google_email_mismatch  (neither address is logged, audited or returned)
  8. accountId = row.claimed_account_id ?? randomUUID()                 [I-3, I-6]
  9. claimForGoogleSignup CAS (count exact, no select)                  [R-1]
       lost → 409 try_again
 10. createConfirmedUserWithoutPassword({ id: accountId, email: row.email })
 11. createAndFinish tail                                               [shared with 1b]
       id mismatch / find_user uncertainty / email_exists / other → exactly 1b's branches
       finalise (retried once) → audit REDEEMED {method: 'google'} + PLAN_PROVISIONED
 12. 200 { redirectTo: '/onboarding-chat' }
Browser
 13. supabase.auth.signInWithIdToken({ provider: 'google', token: idToken, nonce: rawNonce })
       Supabase verifies the token again, finds the confirmed user by verified email,
       LINKS the Google identity, and writes the session cookies (USER_LOGIN audited)
 14. router.replace('/onboarding-chat')
       sign-in failure → "Your account is ready. Sign in with Google" + the normal sign-in link
```

### 3.3 Key decisions

| # | Decision | Why |
|---|---|---|
| **D-1** | **Session: the browser's `signInWithIdToken` with the same ID token, after the server has redeemed** (recommended for SA). | The server mints no session (1b's D-6 stays structural). Supabase re-verifies the token itself, so the session rests on Google's proof and not on anything our route says. It also **links the Google identity** (Supabase links a verified provider identity to an existing confirmed user with the same email), so "Continue with Google" works later from the marketing site. It needs no second popup. **Rejected:** (b) the `generateLink` + `verifyOtp` handoff (a server-minted session that does not link Google); (c) `signInWithOAuth` after redemption (a second Google round trip; kept as the fallback if SA rejects GIS, see Q-1). |
| **D-2** | **Reuse the 1b path; change only the proof.** Extract 1b's post-claim tail (`createConfirmedUser` result handling, `finish`, `stopWithClaimKept`, release) into one private `createAndFinish(row, accountId, create, deps, now)`. `completeSignup` calls it with the password creator, `completeGoogleSignup` with the password-less one. `loadRedeemableInvite` is shared unchanged. | I-1 to I-6 and FR-12a hold for Google by construction, not by a copy that could drift. 1b's behaviour is unchanged, and its existing tests are the proof. |
| **D-3** | **A separate CAS method, `claimForGoogleSignup`**, and not a nullable `codeHash` on `claimForSignup`. Both public methods delegate to one private builder that takes a discriminated proof: `{ kind: 'code', codeHash }` or `{ kind: 'google' }`. The Google claim has every condition of the code claim (id, not redeemed, not revoked, not expired, no live claim, the observed claimant) **except** the code-hash equality, and it clears `signup_code_hash` and `signup_code_expires_at` together (CHECK `signup_code_paired`), so an outstanding code dies with the claim. `{ count: 'exact' }`, `casWon`, **no `.select()`**. | A `null` meaning "skip the code check" on the password path is one typo away from a bypass. The builder keeps the filters in one place. |
| **D-4** | **A separate `createConfirmedUserWithoutPassword({ id, email })`** on `AuthAccountRepository`: `admin.createUser({ id, email, email_confirm: true })`, no password, no metadata. Same error classes. | 1b's `createConfirmedUser` keeps its required password. No user-supplied value reaches the auth user (L-1). Google's name and picture arrive through Supabase's identity link at step 13, not from us. |
| **D-5** | **The ID token is verified with `google-auth-library`'s `OAuth2Client.verifyIdToken`**, declared as a **direct** dependency at the lockfile's version (`^10.4.1`, already installed). The verifier lives in `lib/business-os/invites/googleIdToken.ts` (server-only) and is injected into `RedemptionDeps` as `verifyGoogleIdToken`, so tests fake it. | Google's own verifier: signature against cached Google certs, `aud`, both `iss` forms, `exp` with skew. Importing `googleapis` would pull every Google API into the route bundle. Relying on a transitive install is fragile. Adding a direct dependency is a new pattern (rule 7), so SA must approve it (Q-2). |
| **D-6** | **Nonce.** The browser gives GIS `SHA-256(rawNonce)`; the server checks the token's `nonce` claim against `SHA-256(rawNonce)`; the browser passes `rawNonce` to `signInWithIdToken` (Supabase's documented contract). **`iat` no older than 10 minutes.** | Binds the token to this page's button press, so a token issued elsewhere for the same client cannot be replayed into a redemption. |
| **D-7** | **The email match is exact and case-insensitive**: `googleEmail.trim().toLowerCase() === row.email` (the invite email is stored normalised). **No Gmail dot or `+alias` folding** (BQ-2). | The lock is to the address the admin typed. Folding aliases would be a new rule nobody decided. Consequence for testing: an invite to `x+tag@gmail.com` can never be redeemed with Google, because Google reports `x@gmail.com` (§10). |
| **D-8** | **Limits.** What applies to Google: expiry, revoke, the issuance policy, the grant check, the existing-account check, the live-claim lease (409 `signup_in_progress`) and the claim CAS. What does not apply: the code send and attempt counters, because no code is issued or compared, and a Google proof cannot be guessed. A mismatch or an invalid token costs the caller nothing and teaches nothing, so it is not counted. **A code-locked invite (5 wrong codes) may still be redeemed with Google** (a stronger proof; SA to confirm, Q-4). Per-IP limiting remains OI-1 (the Vercel Firewall rule). | No new counter means no migration. |
| **D-9** | **Inert until configured.** One accessor `googleSignInClientId()` reads the client id. When it is unset, the page does not load Google's script or show the button, and the route answers 404 `google_signin_not_configured` before doing any work. Which variable it reads is Q-3. | 3b can merge before G-1 to G-4 and is switched on by configuration only. The password path is untouched either way. |
| **D-10** | **The button uses GIS `renderButton` in popup mode only.** No One Tap and no auto-select. The script is loaded with `next/script` only for a signed-out visitor on a `valid` invite. If the script fails (blocked, offline), the button area stays empty and the password form works. **Cancelled popup:** GIS calls nothing, the page makes no request and shows no spinner (the busy state starts only when a credential arrives). | Nobody gets signed up with the wrong Google account by a prompt they did not click. |
| **D-11** | **Audit: no new event names.** `BOS_INVITE_REDEEMED` gains `details.method` (`'password'` or `'google'`), and `BOS_INVITE_REDEMPTION_REFUSED` gains the reasons `google_email_mismatch` and `google_email_unverified`. The browser's `USER_LOGIN` for step 13 goes through a new `signInWithGoogleIdToken` in `lib/client/auth-actions.ts`, with `login_method: 'google_id_token'`. | No change to `AUDIT_EVENTS` or the audience counts. |
| **D-12** | **No new importer of `lib/business-os/entitlements/**`.** The Google orchestration lives in `inviteRedemption.ts` (already registered) and the new route wires it through `redemptionDeps.ts` (already registered). `googleIdToken.ts` imports nothing from entitlements. | Keeps `enforcementPoints.test.ts` and the `business-os-entitlements` skill's registration unchanged. `npm run test:bos-entitlements` is still run before handover. |

### 3.4 Tenant isolation (`tenant-isolation-guard`)

| Step | How 3b meets it |
|---|---|
| Ownership | The invite token hash identifies the row. **Google's verified email must equal the row's email** before anything is written: this is the mailbox proof (T-5) and the email lock (BQ-2) in one check. |
| Allow-list | The body `.strict()` is exactly `{ token, idToken, nonce }`. `createUser` receives `{ id: server-generated, email: row.email, email_confirm: true }`. The email written is the **row's**, never the token's, so even a verifier bug cannot create an account for another address. Finalise parameters are all server-derived. |
| Account id | Generated server-side, recorded by the claim before the user exists, never read from the request or the ID token (L-1, I-3). |
| Session | Created by Supabase from Google's token, for the account whose email Google verified. Our route returns no session material. |

### 3.5 The email fix (3a)

1. **Comments.** A pure `stripHtmlComments(html)` in `lib/email/htmlComments.ts` removes every `<!-- … -->` **except** conditional comments: an opener `<!--[if …]>` through its `<![endif]-->`, and the downlevel-revealed `<!--<![endif]-->` form. `wrapInBrandedTemplate` returns `stripHtmlComments(html)`, which covers the layout **and** every content template it wraps (all 16 plus the BizQL composer's wrapped path). The layout's four design notes move into TypeScript comments above the returned template, so the source keeps its explanations. The MSO block stays: it sets 96 DPI for Outlook on Windows, which otherwise rescales the layout.
2. **Logo.** `lib/email/platformBranding.ts` exports `platformEmailBranding(locale)`: `businessName: 'AgentPilot'` (which is also the alt text), the colours both templates use today, and the flat fields `logoUrl`, `logoWidth: 154`, `logoHeight: 28` (SA R-9). **The URL reads `process.env.NEXT_PUBLIC_APP_URL` directly, not `platformUrl()`** (SA R-3: its fallback host `app.agentspilot.ai` does not answer). The logo fields are set **only when that variable is non-empty and starts with `https://`**. Unset, `http://localhost:3000`, or anything else gives the text wordmark. Both invite templates replace their local `PLATFORM_BRANDING` with it. 154×28 is `widthForHeight(WORDMARK.light, 28)`, the header height in `LOGO_HEIGHT`.
3. **Wrapper.** `BrandingData` gains optional `logoWidth` and `logoHeight`. When both are set, the `<img>` carries `width`/`height` attributes and matching inline sizes, `border:0`, `display:inline-block`, and alt-text styling (heading font, 16px, weight 600, ink colour), so a client that blocks images shows **"AgentPilot" as a styled text wordmark** in the same place. When they are not set, the business path renders **identically apart from the removed comments** (pinned by a test).
4. **Host.** `https://neuronforge-kohl.vercel.app/images/brand/wordmark.png` in production today, that is, the production `NEXT_PUBLIC_APP_URL`. It follows that variable if the domain later moves to `agentspilot.ai` (a backlog item). Emails already sent keep pointing at the vercel.app URL, which must keep serving the file.
5. **Business emails** (bookings, invoices, receipts, intake, proposals, reminders, briefings) keep the business's own `logoUrl` or name. They never receive the platform branding, pinned by test T-3a-5.

---

## 4. Files to Create / Modify

Verified against bd763222.

### 4.1 Slice 3a

| # | File | Action | Reason |
|---|---|---|---|
| a1 | `lib/email/htmlComments.ts` | create | `stripHtmlComments` (keeps conditionals) |
| a2 | `lib/email/__tests__/htmlComments.test.ts` | create | Plain, multi-line, MSO kept, downlevel-revealed kept, no comment → unchanged |
| a3 | `lib/email/platformBranding.ts` | create | Shared platform branding with the wordmark (https only) |
| a4 | `lib/email/__tests__/platformBranding.test.ts` | create | https → logo; http or unset (variable **deleted**) → no logo; dimensions from the manifest; `public/images/brand/wordmark.png` exists (R-3); only the two invite templates import it |
| a5 | `lib/email/templates/base-template.ts` | modify | Notes → TS comments; strip at return; optional `logoWidth`/`logoHeight` |
| a6 | `lib/email/templates/invite-invitation.ts` | modify | Use `platformEmailBranding` |
| a7 | `lib/email/templates/invite-signup-code.ts` | modify | Use `platformEmailBranding`; fix the stale "logs the first 50 characters" header line (Slice 2's D-dev-2a-13, comment only) |
| a8 | `lib/email/templates/__tests__/invite-invitation.test.ts`, `invite-signup-code.test.ts` | modify | Logo present with alt/width/height; no `<!--` except MSO |
| a9 | `lib/email/__tests__/emailBranding.test.ts` | modify | Business templates: no `<!--` except MSO, no platform wordmark URL, business logo markup unchanged |

### 4.2 Slice 3b

| # | File | Action | Reason |
|---|---|---|---|
| b1 | `lib/business-os/invites/googleIdToken.ts` | create | `verifyGoogleIdToken` (D-5, D-6), `googleSignInClientId()` (D-9) |
| b2 | `lib/business-os/invites/__tests__/googleIdToken.test.ts` | create | Mocked `OAuth2Client`: aud, iss, exp, iat age, nonce, `email_verified`, unconfigured |
| b3 | `lib/business-os/invites/inviteRedemption.ts` | modify | `createAndFinish` extraction; `completeGoogleSignup`; `method` in the audit; new refusal codes |
| b4 | `lib/business-os/invites/__tests__/inviteRedemption.test.ts` | modify | Google branches (§9) plus the unchanged 1b suite |
| b5 | `lib/business-os/invites/redemptionDeps.ts` | modify | Wire `verifyGoogleIdToken` |
| b6 | `lib/business-os/invites/__tests__/redemptionDeps.test.ts` | modify | Wiring |
| b7 | `lib/business-os/invites/inviteSchemas.ts` (+ test) | modify | `completeGoogleSignupSchema` `.strict()`: token ≤ 512, `idToken` JWT shape ≤ 4096, `nonce` base64url 43 characters |
| b8 | `app/api/public/invites/signup/google/route.ts` | create | Public route, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 60` |
| b9 | `app/api/public/invites/signup/__tests__/routes.test.ts` | modify | New route: happy path, 400, 409s, 404 unconfigured, signed-in, headers, no email in bodies |
| b10 | `lib/business-os/invites/__tests__/signupCode.test.ts` | modify | Lease pin also covers the Google route's `maxDuration` |
| b11 | `lib/repositories/BusinessOsInviteRepository.ts` (+ test) | modify | `claimForGoogleSignup`; shared private claim builder (D-3) |
| b12 | `lib/repositories/AuthAccountRepository.ts` (+ test) | modify | `createConfirmedUserWithoutPassword` (D-4) |
| b13 | `lib/repositories/__tests__/authAccountRepository.callers.guard.test.ts` | modify | Only if a new importer is unavoidable. Planned: **no change** (b1 does not import the repository) |
| b14 | `lib/logger/config.ts` (+ `lib/logger/__tests__/redaction.*.test.ts`) | modify | Redact `idToken`, `*.idToken`, `credential`, `*.credential`, `nonce`, `*.nonce` |
| b15 | `lib/client/auth-actions.ts` | modify | `signInWithGoogleIdToken(idToken, nonce)`, audited like the others |
| b16 | `app/invite/useGoogleIdentity.ts` | create | Client hook: loads GIS, renders the button, makes and hashes the nonce, exposes the credential; typed minimal `google.accounts.id` surface (no `any`) |
| b17 | `app/invite/GoogleSignupButton.tsx` | create | Button, POST, `signInWithGoogleIdToken`, redirect, error copy |
| b18 | `app/invite/page.tsx` | modify | Render b17 above `SignupForm` when configured ("or" divider) |
| b19 | `app/invite/invitePageCopy.ts` (+ page render test) | modify | en/he/es: button label, divider, mismatch (with the masked email), unverified, token invalid, account-ready fallback |
| b20 | `app/invite/__tests__/GoogleSignupButton.render.test.tsx` | create | No request before a credential; error mapping; fallback link on sign-in failure |
| b21 | `package.json`, `package-lock.json` | modify | `google-auth-library` as a direct dependency (D-5, Q-2) |
| b22 | `docs/requirements/BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md` | modify | Already done in planning: the 2026-09-29 reprioritisation (§10, Change History) |

---

## 5. API contract

`POST /api/public/invites/signup/google`, body `{ token, idToken, nonce }` (`.strict()`). Headers on every answer: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`.

| Status | Body | When |
|---|---|---|
| 200 | `{ success: true, data: { redirectTo: '/onboarding-chat' } }` | Redeemed |
| 200 | `{ success: true, data: { state: 'not_recognised' } }` | Byte-identical to validate (AC-2) |
| 400 | `invalid_request` / `google_token_invalid` | Body shape / signature, aud, iss, exp, iat age or nonce |
| 404 | `google_signin_not_configured` | No client id (D-9) |
| 409 | `signed_in`, `existing_account`, `used`, `revoked`, `expired`, `unavailable`, `paid_invites_not_available`, `signup_in_progress`, `try_again`, `google_email_mismatch`, `google_email_unverified` | As named |
| 503 | `unavailable_try_again` | Lookup error, claim kept after uncertainty, finalise failed twice (FR-12a record written) |

It never returns the invited email or the Google email: the browser already has the token, and the page already shows the masked address.

---

## 6. Ops prerequisites (3b)

None of these gates the **merge** (D-9). All of them gate **switching it on**.

| # | Owner | Action | Record |
|---|---|---|---|
| **G-1** | User (Supabase dashboard) | Auth → Providers → Google: note the **Client ID(s)** in use. Say whether it equals `NEXT_PUBLIC_GOOGLE_CLIENT_ID` on Vercel. Confirm the Google consent screen is **published** (not "Testing"). | Client id (public, not a secret), yes/no |
| **G-2** | Google Cloud console holder | On that OAuth client, **Authorized JavaScript origins**: add `https://neuronforge-kohl.vercel.app`, `http://localhost:3000` and `http://localhost` (GIS needs both localhost forms). | Screenshot or list |
| **G-3** | User (Supabase) | Only if GIS uses a **different** client from Supabase's provider: add it to the provider's comma-separated Client IDs, so `signInWithIdToken` accepts its tokens. | Done / not needed |
| **G-4** | Offir (Vercel admin) | Only if Q-3 chooses a new variable: set it on Production and **redeploy** (a `NEXT_PUBLIC_` value is fixed at build time). | Set + deploy id |

---

## 7. Task List

### Setup
- ✅ S-1: `git fetch`; worktree clean; branch `feature/bos-invite-signup-slice-3` from `origin/main` bd763222; upstream unset.
- ✅ S-2: Requirement §10 and Change History updated with the 2026-09-29 reprioritisation (text only).
- ✅ S-3: SA workplan review (2026-09-29, approved with conditions); R-3 and R-9 folded into §3.5, a4 and T-3a-3.
- ✅ S-4: 3a branch `feature/bos-invite-signup-slice-3a` switched from the slice-3 branch with the docs uncommitted; no upstream.

### Slice 3a (first PR)
- ✅ 3a-1: `stripHtmlComments` + tests (a1, a2). One regex pass: the downlevel-revealed opener `<!--[if …]><!-->` and closer `<!--<![endif]-->` are kept as markers (comments between them are still removed), the hidden `<!--[if …]>…<![endif]-->` block is kept whole, every other terminated `<!--…-->` is removed, and an unterminated `<!--` is left alone.
- ✅ 3a-2: Base template (a5, a9). The four design notes moved into one TS comment above the markup and were **deleted from the markup** (not only stripped). `wrapInBrandedTemplate` returns `stripHtmlComments(html)`, so all wrapped content (the 21 business renders plus the BizQL composed path) loses its comments; the MSO block stays byte for byte. Optional `logoWidth`/`logoHeight`: only with both, the `<img>` gets `width`/`height` attributes, inline sizes, `border: 0` and alt-text styling. Business path pinned in `emailBranding.test.ts` (22 renders: no `<!--` except MSO; with a business logo exactly the old `<img … max-height: 34px; max-width: 180px; display: inline-block;" />`, no `width=`; without one the business name span; never `/images/brand/wordmark` or `alt="AgentPilot"`, with `NEXT_PUBLIC_APP_URL` set to https). One-off check against bd763222's wrapper (scratch, not committed): new output equals `stripHtmlComments(old output)` once whitespace is normalised, for a plain business and a themed RTL business with logo and website; the only difference is the blank lines the removed comments occupied.
- ✅ 3a-3: `platformEmailBranding` + `platformEmailLogoUrl` + tests (a3, a4), per R-3 and R-9. Tests delete the variable for the unset case, and cover `''`, whitespace, `http://localhost:3000`, `http://…`, a bare host and `https://` alone; a trailing slash is trimmed. Guard: `public/images/brand/wordmark.png` exists and has a PNG signature. Guard: only `invite-invitation.ts` and `invite-signup-code.ts` import `platformBranding` (scans `lib`, `app`, `components`).
- ✅ 3a-4: Both invite templates use it; the invitation's button reuses the same branding object; the stale "logs the first 50 characters" header line in `invite-signup-code.ts` corrected (D-dev-2a-13, comment only). Template tests (a8): en/he/es, only the MSO `<!--`, with the variable https and deleted; the `<img>` with alt, width, height and alt-text styling; no image and the text wordmark when deleted or `http://localhost:3000`; the plain-text part identical with and without the logo (T-3a-6: the invite templates build `text` themselves, so it cannot carry comments or the logo).
- ✅ 3a-5: `npx jest lib/email lib/business-os/invites app/api/public/invites lib/brand lib/branding` 32 suites / 532 tests green; `lib/business-os/bizql` 48 / 652 green; every `*guard*` test 35 / 691 green; `npm run test:bos-entitlements` 88 / 1,825 green; `tsc --noEmit -p .` has no error in `lib/email/`; `eslint --max-warnings 0` clean on every touched file except three `no-unused-vars` warnings in `base-template.ts` (`primaryColor`, `onBrand`, `mutedSurface`) that are **identical on bd763222** and left alone (out of scope). No `console.*` and no entitlements import in any touched file. Mutation check: returning the unstripped HTML turns 7 of the new tests red. Preview rendered (en, he, code, and env-unset) and checked: the only `<!--` is the `[if mso]` block. **`npm run build` not run** (not requested for this hand-off; SA/QA may ask for it).
- ✅ 3a-6: SA code review approved (2026-09-29); QA waived by the user for 3a ("skip QA for 3a", 2026-09-29: proportionate effort, email template change, SA code-approved); the user saw the diff and approved the commit and PR (2026-09-29): "I waive QA for 3a and approve committing it and opening the PR"; RM commits and opens the PR (see Commit Info).

**3a Dev notes (for SA code review):**
- **D-dev-3a-1:** `display: inline-block`, not `display: block` as §3.5(3) first said. A block image ignores the cell's `text-align`, so it would sit on the left of a Hebrew email while the text wordmark sits on the right. `vertical-align: middle` avoids the inline gap.
- **D-dev-3a-2:** The logo URL is read at call time, not at import, so a test or a later env change is what takes effect. `NEXT_PUBLIC_*` is inlined at build time in Next, so production uses the build's value, as invite links already do.
- **D-dev-3a-3:** `alt` is the unescaped `businessName`, as on the business path today; for the platform it is the literal `AgentPilot`. Escaping business names in `alt`/`<title>` is a separate, pre-existing item, not changed here.

### Slice 3b (second PR, after 3a or in parallel; the files do not overlap)
- ⬜ 3b-1: SA answers Q-1 to Q-6. If D-5 is approved: `npm i google-auth-library@^10.4.1` (b21).
- ⬜ 3b-2: `googleIdToken.ts` + tests (b1, b2).
- ⬜ 3b-3: Repository: the claim builder, `claimForGoogleSignup` + unit tests (b11). **Verify once against real PostgREST** (§9.3) and record the result here.
- ⬜ 3b-4: `createConfirmedUserWithoutPassword` + test (b12).
- ⬜ 3b-5: `inviteRedemption.ts`: extract `createAndFinish` with **1b's suite green before any Google code**; then `completeGoogleSignup` + tests (b3, b4).
- ⬜ 3b-6: Schema, wiring, route + tests; lease pin (b5–b10).
- ⬜ 3b-7: Logger redaction + test (b14).
- ⬜ 3b-8: `signInWithGoogleIdToken` (b15); hook, button, page, copy + render tests (b16–b20).
- ⬜ 3b-9: Guards: `mutationOrSelect`, `authAccountRepository.callers`, `no-deletion-paths`, `enforcementPoints`, `tierLiteral`, admin authz; `npm run test:bos-entitlements`; `npm run lint:hooks`; `npm run build`.
- ⬜ 3b-10: Local end-to-end on `localhost:3000` against the real Supabase project once G-1/G-2 allow it (a throwaway Gmail; §10.2 steps 1–4), before the PR is marked ready.
- ⬜ 3b-11: SA code review + QA in parallel; the user sees the diff; RM commits and opens the PR. Switch on after merge: G-1 to G-4, then §10.2 on production.

---

## 8. Traceability

| Item | Requirement | Where met |
|---|---|---|
| FR-11 | Google signup; verified email must equal the invited email | §3.2 steps 6–7, D-7 |
| FR-12, T-4 as replaced, R-1 | Same redemption: claim → create → finalise, atomic in effect | D-2, D-3; finalise SQL unchanged |
| FR-12a, AC-5a | A halfway stop is recorded and shown to admins | Shared `createAndFinish` → `stopWithClaimKept` |
| FR-13 | Signed in, lands in onboarding | D-1, step 13–14 |
| FR-8a, BQ-7, AC-6a | Existing account → sign in, invite not used | `loadRedeemableInvite` (shared), 409 `existing_account` |
| BQ-2, §8.1 "Forwarding" | Locked to the invited address | D-7, the email written is the row's (§3.4) |
| AC-5 | Concurrency: one account | The claim CAS; the loser gets `try_again` / `signup_in_progress` |
| AC-6, L-1 | Tampered fields have no effect | `.strict()` body; ids server-generated |
| AC-8, T-5, §8.1 "Mailbox proof" | No confirmed account without mailbox proof | `email_verified === true` from a verified Google token, **before** the claim |
| AC-9, T-7 | No token in logs, audit or referrer | Redaction b14; no-referrer headers and meta; ID token and nonce only in the POST body |
| AC-11 | Google only when the emails match | Tests T-3b-4, T-3b-5; §10.2 steps 5–6 |
| T-3 (as amended by 1b F-2) | Server-side creation; no server-minted session | D-1, D-4 |
| **T-6** | Google invitees created server-side; **verify later Google sign-ins link to that user by verified email** | D-4; identity linked at step 13; **§10.2 step 4** proves a later marketing-site Google sign-in reaches the same account id |
| L-8 | A signed-in visitor is not offered signup | The page hides the button; the route answers 409 `signed_in` |
| L-10 | Slice 4's AC-12 list includes the harness Google sign-in | Carried forward. **Added for Slice 4:** "an invitee's first `signInWithIdToken` still links with public signups disabled" (Q-5) |
| I-1 to I-6, D-4 lease | 1b invariants | Shared tail; the Google claim reuses the lease and the claimant CAS; no delete method added |
| #143 lesson | No `.or` + `.select` on a mutation; a live no-match check | D-3, 3b-3, §9.3 |
| User 2026-09-29 (E-1) | No developer comments in sent email HTML; MSO kept | §3.5 (1) |
| User 2026-09-29 (E-2) | AgentPilot logo on platform emails only, absolute https, alt, size, text fallback | §3.5 (2)–(5) |

---

## 9. Test plan

### 9.1 Slice 3a

| # | Test |
|---|---|
| T-3a-1 | `stripHtmlComments`: removes single-line and multi-line comments; keeps `<!--[if mso]>…<![endif]-->` byte for byte; keeps `<!--[if !mso]><!-->` / `<!--<![endif]-->`; leaves comment-free HTML unchanged. |
| T-3a-2 | Invitation and code emails (en, he, es): the only `<!--` occurrences are MSO conditionals (regex over the rendered HTML). |
| T-3a-3 | Invitation and code emails with `NEXT_PUBLIC_APP_URL=https://neuronforge-kohl.vercel.app`: `<img src="https://neuronforge-kohl.vercel.app/images/brand/wordmark.png"` with `alt="AgentPilot"`, `width="154"`, `height="28"`. With `http://localhost:3000` or the variable **deleted** (not the Jest default): no `<img>`, the text "AgentPilot" wordmark instead, and never `agentspilot.ai` (R-3). Plus: the wordmark file exists at `public/images/brand/wordmark.png` and is a PNG. |
| T-3a-4 | Every business template (booking confirmation, cancellation, reschedule, invoice, receipt, refund, intake request and received, proposal, meeting reminder, new enquiry, daily briefing, insight actions, consent, welcome): no `<!--` except MSO. |
| T-3a-5 | The same business templates, with and without a business `logoUrl`: never contain `/images/brand/wordmark`; with a logo they render `alt="<business name>"` and today's markup (no width/height attributes), which proves the business path is byte-identical apart from the removed comments. |
| T-3a-6 | `htmlToText` output for both invite emails is unchanged (the text part never contained the comments). |

### 9.2 Slice 3b

| # | Test |
|---|---|
| T-3b-1 | `verifyGoogleIdToken` (fake `OAuth2Client`): wrong aud, wrong iss, expired, `iat` older than 10 min, nonce mismatch, a verifier throw → `invalid`; `email_verified` false or missing → `unverified`; valid → `{ email, emailVerified: true }`. No client id → `not_configured`, and no network call. |
| T-3b-2 | Happy path: load → verify → claim (Google CAS, server id) → `createConfirmedUserWithoutPassword` with exactly `{ id, email: row.email }` → finalise → `REDEEMED` with `method: 'google'` + `PLAN_PROVISIONED`. |
| T-3b-3 | 1b regression: the full existing `completeSignup` suite passes unchanged after the `createAndFinish` extraction, with `method: 'password'` added to `REDEEMED`. |
| T-3b-4 | Mismatch (including `x+tag@gmail.com` vs `x@gmail.com`, and a dot variant) → 409 `google_email_mismatch`, no claim, no user; the audit has `reason: 'google_email_mismatch'` and **neither address** (asserted on the audit, the logs and the body). |
| T-3b-5 | Case-insensitive match (`X@Gmail.com` vs `x@gmail.com`) → redeemed. |
| T-3b-6 | Unverified → 409 `google_email_unverified`; no claim. |
| T-3b-7 | Existing account → 409 `existing_account`; the stamp and its audit happen once; no token verification is needed to reach it. |
| T-3b-8 | Live claim → 409 `signup_in_progress` before verification. Stale claim → re-claimed with the recorded id (I-6). |
| T-3b-9 | Lost CAS → 409 `try_again`. `email_exists` + our id exists → finish; not ours → release, 409 `existing_account`. Uncertain `findUserExists` → claim kept, FR-12a `find_user`, 503. Finalise fails twice → FR-12a `finalise`, 503. Id mismatch → FR-12a `create_user_id_mismatch`. |
| T-3b-10 | Paid (tier) invite → 409 `paid_invites_not_available`, before verification. |
| T-3b-11 | Code-locked invite with a valid Google proof → redeemed (D-8, pending Q-4). Outstanding code hash and expiry are cleared by the claim. |
| T-3b-12 | Route: body with an extra key (`email`, `userId`, `cohort`) → 400 and no repository call; signed-in → 409; unconfigured → 404; `no-store` and `no-referrer` on every answer; `maxDuration` 60 < lease 120. |
| T-3b-13 | Repository: `claimForGoogleSignup` sends `{ count: 'exact' }`, never `.select`, filters exactly as the code claim minus the hash, and sets both code columns to null; `casWon` 0/1/other. `mutationOrSelect.guard` green with no new exemption. |
| T-3b-14 | `AuthAccountRepository.createConfirmedUserWithoutPassword`: argument shape, error classes, no email in logs. |
| T-3b-15 | Logger: `idToken`, `credential` and `nonce` are censored at the top level and one level down. |
| T-3b-16 | UI: no fetch until the credential callback; the button is absent when unconfigured, for a signed-in visitor and on non-valid states; each error code maps to its copy in en/he/es; a `signInWithIdToken` failure shows "Your account is ready" with the sign-in link; RTL in Hebrew. |

### 9.3 Live PostgREST check (the #143 lesson)

Before 3b's PR is marked ready, run `claimForGoogleSignup` once against the real project with a **random UUID that matches no invite** (from a local script using the service-role client, never committed). Expected: `{ data: false, error: null }`, meaning count 0 with no 42703. Record the date and the result in §7 (3b-3). 3a adds no repository write.

---

## 10. Production manual check

The tester uses addresses they control. **Important for Google:** Google always reports an account's **base** address, so an invite sent to a `+alias` can never pass the Google email match (D-7, BQ-2). The `+alias` is therefore used for the email check and for the refusal case, and the happy path needs a **second Google account that has no AgentPilot account yet** (for example a throwaway Gmail). No real addresses are written in this repository: `<you>` is the tester's Gmail user name and `<fresh>` the second account.

### 10.1 Slice 3a (after deploy)

| # | Step | Expected |
|---|---|---|
| E1 | Admin creates a champion invite to `<you>+s3a@gmail.com` with the email ticked. | The email arrives. The AgentPilot wordmark is at the top. |
| E2 | Gmail → "Show original". | The only `<!--` is the `[if mso]` block. The image URL is `https://neuronforge-kohl.vercel.app/images/brand/wordmark.png`. |
| E3 | Gmail with images off (Settings → "Ask before displaying external images"), reopen. | "AgentPilot" appears as text in the logo's place. |
| E4 | Open the link, "Send me a code". | The code email also shows the wordmark, and "Show original" shows no developer comments. |
| E5 | Trigger any business email to `<you>+s3biz@gmail.com` (for example a booking confirmation from a test business). | The business's own logo or name is shown, never the AgentPilot wordmark, and there are no developer comments in the source. |

### 10.2 Slice 3b (after G-1 to G-4 and deploy)

| # | Step | Expected |
|---|---|---|
| G1 | Admin creates a champion invite to `<fresh>@gmail.com` (no email needed; copy the link). Open it in a private window. | "Continue with Google" is shown above the code form. |
| G2 | Click it, close the popup without choosing. | Nothing happens, no error, and both options still work. |
| G3 | Click it, choose `<fresh>@gmail.com`. | Lands in `/onboarding-chat`, signed in. The admin list shows Accepted, L1, with the account. Tiers shows a champion. |
| G4 | Sign out. On the marketing sign-in page, "Continue with Google" with `<fresh>`. | Signed in to **the same account** (the same user id in the admin list and in Tiers). This proves T-6's linking. In the Supabase dashboard the user has both an `email` and a `google` identity. |
| G5 | Admin creates an invite to `<you>+s3g@gmail.com`. Open it, Continue with Google as `<you>@gmail.com`. | Refused: "this invitation is for y•••@gmail.com, the Google account you chose uses a different address". No account is created, and the invite stays Pending. |
| G6 | Admin creates an invite to `<you>@gmail.com` (which already has an account). Open it. | "You already have an account", with a link to sign in. There is no Google button (the page never reaches the form), and the invite stays Pending. |
| G7 | Open the G3 link again. | "Already used, sign in". |
| G8 | Server logs for G3 and G5 (Vercel). | No token, ID token, nonce, invited email or Google email in any line. |

**Clean-up:** the feature never deletes accounts (I-1). The `<fresh>` account may be kept, or removed by hand in the Supabase dashboard. Its lineage row stays by design (no foreign key, §16.3 T-1).

---

## 11. Rollback

| Slice | How | Effect |
|---|---|---|
| 3a | Revert the PR. | Emails go back to the text wordmark and ship the comments again. No data involved. |
| 3b (fast) | Unset the client id variable and redeploy (D-9). | The button disappears and the route answers 404. The password path is untouched. |
| 3b (full) | Revert the PR. | The same, and `google-auth-library` goes back to transitive. |
| Accounts already created with Google | Nothing to do. | They are ordinary confirmed accounts with a linked Google identity. They can sign in with Google on the marketing site, or set a password through "Forgot password". Their invites stay redeemed, with lineage and plan rows. |

No migration, so there is no SQL rollback.

---

## 12. Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| **Q-1** | Session creation and the Google Identity Services script: approve D-1 (`signInWithIdToken` after redemption) and loading `accounts.google.com/gsi/client` on the invite page (a new third-party script, rule 7)? | Yes. The fallback, if GIS is refused, is a second round trip through `signInWithOAuth` after redemption, which costs the invitee a second Google screen. |
| **Q-2** | Approve `google-auth-library` as a direct dependency (D-5), instead of `jose` + Google's JWKS, or importing `googleapis`? | `google-auth-library`: Google's own verifier, already in the lockfile. |
| **Q-3** | Which variable holds the Google client id: reuse `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (the plugin client) if G-1 shows it is the same client as Supabase's login provider, or a new `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID`? A new one needs Offir (G-4). | A new, dedicated variable. The login client and the plugin client are different concerns, and one reader (`googleSignInClientId()`) makes a later change a one-line edit. If Offir is the bottleneck, reuse is acceptable **only** when G-1 confirms it is the same client. |
| **Q-4** | May a code-locked invite still be redeemed with Google (D-8)? | Yes. Google is the stronger proof, and the lock exists to stop code guessing, not the real owner. |
| **Q-5** | Slice 4 dependency: Dev's reading of GoTrue is that linking a provider identity to an **existing** user is allowed while "disable new signups" is on (only the create-account decision is refused). Should Slice 4's AC-12 list carry an explicit test of it? | Yes. It is recorded under L-10 above. If it turned out false, Google invitees would still be created (admin API), and only step 13 would fall back to "Your account is ready, sign in". |
| **Q-6** | Is `email_verified: true` enough for non-Gmail Google accounts (Google accounts on a custom address), or should the proof also require a `gmail.com` address or an `hd` claim? | Accept `email_verified: true`. This is what Supabase's own linking trusts. A stricter rule would refuse some real invitees for a marginal gain; they can still use the code path. |
| **Q-7** | 3a strips comments from **every** wrapped email, business ones included. Acceptable, or limit it to platform emails? | All of them. It is the same leak in every email, and the change is invisible to the reader. |

---

## 13. Logging-standard check (console.*)

Every file 3a or 3b touches was checked on bd763222: `base-template.ts`, `invite-invitation.ts`, `invite-signup-code.ts`, `inviteRedemption.ts`, `redemptionDeps.ts`, `inviteSchemas.ts`, `AuthAccountRepository.ts`, `BusinessOsInviteRepository.ts`, `lib/repositories/types.ts`, `app/invite/page.tsx`, `SignupForm.tsx`, `invitePageCopy.ts`, `lib/client/auth-actions.ts`, `lib/logger/config.ts`, `lib/utils/origins.ts`. **None contains a `console.*` call.** (`lib/brand/logo.ts`, read and not modified, mentions "console" only inside a comment.) The new files use `createLogger` on the server and `clientLogger` in the browser.

---

## SA Review Notes

### SA Workplan Review — 2026-09-29

**Reviewed by SA — 2026-09-29**
**Status:** ✅ Approved with conditions. **3a may start now** (conditions R-3 and R-9 only). **3b may start now**. R-1, R-2, R-5 and R-6 must be in the code handed to code review. R-4 is settled at 3b-10.

**Verdict in one line:** the design is sound, and it is the right shape for T-6. Only the mailbox proof changes, and the redemption path is reused rather than copied. The claim stays count-only, the account id is generated by the server, the email written is the row's, and the server mints no session. Two real defects were found. First, `google-auth-library` puts the whole token payload (email, `sub`, name) into its error messages (R-1). Second, the logo falls back to a host that does not answer (R-3). One rule is tightened: the Google proof counts only where Google is authoritative for the address (R-2).

#### What SA verified (against bd763222 in this worktree)

| Claim | Result |
|---|---|
| `completeSignup` / `finish` / `stopWithClaimKept` shape, `loadRedeemableInvite` options | ✅ as described (`inviteRedemption.ts:188-473`) |
| `claimForSignup`: `{ count: 'exact' }`, no `.select`, `.or(noLiveClaim)`, the observed-claimant branch | ✅ (`BusinessOsInviteRepository.ts:501-540`) |
| CHECKs `signup_code_paired`, `claim_paired`, `redeemed_by_claimant`; finalise does not care how the mailbox was proven | ✅ No migration is needed |
| No CSP and no `Cross-Origin-Opener-Policy` in `next.config.js`, `vercel.json` or `middleware.ts`; `/api/*` bypasses the middleware | ✅ The GIS popup and the script load need no header change today |
| The invite layout sets `referrer: 'no-referrer'` | ✅ Relevant to GIS: see R-4 |
| Logger redaction has no `idToken` / `credential` / `nonce` | ✅ b14 is needed |
| `google-auth-library` 10.4.1 installed, transitive only | ✅ **And** its `verifySignedJwtWithCertsAsync` throws `'Token used too late, … : ' + JSON.stringify(payload)` (likewise "too early", "no issue time", "no expiration time", "too far in future"). The payload holds `email`, `sub`, `name` and `picture`. This is R-1 |
| `platformUrl()` falls back to `https://app.agentspilot.ai` whenever `NEXT_PUBLIC_APP_URL` is unset outside development (Jest included) | ✅ **And** `https://app.agentspilot.ai/images/brand/wordmark.png` gave no answer on 2026-09-29, while `https://neuronforge-kohl.vercel.app/images/brand/wordmark.png` returned 200. This is R-3 |
| Email header sits on the page ground (`#f5f5f5` default) | ✅ `WORDMARK.light` is the right variant |
| Every `<!--` under `lib/email` is in a file that goes through `wrapInBrandedTemplate` (except `htmlToText.ts`, which handles them) | ✅ Stripping at the wrapper's return covers all sent HTML |
| Only the two invite templates define `businessName: 'AgentPilot'` | ✅ The business path cannot pick up the platform logo unless someone imports `platformEmailBranding` |
| D-12: no new entitlements importer; `inviteRedemption.ts` and `redemptionDeps.ts` already registered in `enforcementPoints.test.ts` | ✅ No new entitlements symbol is planned. If one appears, it must be registered per the `business-os-entitlements` skill |

#### Rulings on Q-1 to Q-7

| # | Ruling |
|---|---|
| **Q-1** | **Approved: GIS popup plus browser `signInWithIdToken` (D-1, D-10), as a reviewed new pattern (rule 7).** *CSP:* there is none today, so nothing changes. Put a comment in `app/invite/layout.tsx` saying that any future CSP must allow `https://accounts.google.com/gsi/` for script, frame, connect and style, and that any future COOP must be `same-origin-allow-popups`, or the popup breaks. *Two uses of one token:* this is sound. An ID token is a bearer assertion for **one** relying party (our client id), and neither our server nor Supabase consumes it. Both verify the same signature, `aud` and nonce. Our route turns it into "redeem this invite once" (a replay gets `used` / `existing_account`). Supabase turns it into a session for the account Google names. *Replay:* a token stolen from elsewhere does not work here without the raw nonce, which lives only in this page's memory. Our `iat` bound is 10 min, while Supabase's is only `exp` (1 h). A thief who holds a victim's Google token can already call Supabase directly, so 3b adds no new exposure. Conditions: R-1, R-4, R-5. |
| **Q-2** | **Approved: `google-auth-library` as a direct dependency, `^10.4.1`.** It must be imported only from `googleIdToken.ts`. Add `import 'server-only'` there (already used in `lib/branding/*`), so a client import fails the build. Use **one module-level `OAuth2Client`** so Google's certs stay cached across warm invocations. Do not use `googleapis` or `jose`. |
| **Q-3** | **A new, dedicated `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID`; reuse is not allowed.** The deciding reason is not taste. `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is **already set in production**, so reusing it would switch 3b on the moment it deploys, before G-2 has registered the origins, and D-9's "inert until configured" would be false. Its **value** must be a client id that Supabase's Google provider accepts. Use the provider's own login client id (G-1), which makes G-3 unnecessary. The same accessor serves the route (as `aud`) and the page. See R-6. |
| **Q-4** | **Approved: a code-locked invite may be redeemed with Google.** The 5-attempt lock stops code guessing. It says nothing against the mailbox owner, and a verified, authoritative Google proof (R-2) is independent of the code. The Google claim clears the outstanding code hash and expiry (the CHECK pairing holds). T-3b-11 stays. |
| **Q-5** | **Agreed, carried to Slice 4.** GoTrue refuses a *create-account* decision when signups are disabled. Linking a verified provider identity to an existing confirmed user is a separate decision. Slice 4's AC-12 list must contain "an invitee's first `signInWithIdToken` links with public signups disabled". It must be tested live, because this is SA's reading of GoTrue and not a documented guarantee. If it proved false, the fallback is harmless: the account exists, and the "Your account is ready, sign in" branch covers it. |
| **Q-6** | **Not enough on its own. Require an authoritative address (R-2).** Google's OIDC guidance says that Google is authoritative for an address only when it is `@gmail.com`, or when the token carries an `hd` (Workspace) claim for the address's domain. For any other Google account (a consumer Google account registered on a non-Google-hosted address), `email_verified` records that Google once verified the address, not that the person controls it now. A former employee's leftover account is the textbook case, and Google's guidance is to verify such accounts by other means. The requirement's §8.1 "mailbox proof" rule and T-5 make the emailed code that other means. It is already on the same page, so the cost is one refusal branch and its copy, and the invitee still joins. |
| **Q-7** | **Approved: strip comments from every wrapped email, business ones included.** They are developer notes, the same leak in every email and invisible to readers. Conditional comments (`<!--[if …]>…<![endif]-->` and the downlevel-revealed form) are kept byte for byte. Stripping runs on the final HTML, so user or LLM content composed through BizQL loses only its comments, and that is harmless. |

#### R-items (conditions)

| # | Priority | Sub-slice | Item |
|---|---|---|---|
| **R-1** | **High** | 3b | **The verifier never throws and never logs a library error.** `verifyGoogleIdToken` wraps `verifyIdToken` in a `try/catch` and returns a discriminated result (`ok` / `invalid` / `unverified` / `not_authoritative` / `unavailable` / `not_configured`). On failure it keeps **only a fixed reason code**. The caught error object and its `message` must go into no log, audit, response or rethrow, because `google-auth-library` puts the full payload (email, `sub`, name, picture) into messages such as "Token used too late". This also protects the route's catch-all `requestLogger.error({ err })`: nothing Google-derived may be able to reach it. **Test:** make the fake `OAuth2Client` throw an error whose message contains a JSON payload with an email and a `sub`. Assert that no captured log line, audit call or response body contains either value. |
| **R-2** | **High** | 3b | **The authoritative-address rule (Q-6).** Accept the proof only when `email_verified === true` (strict boolean) **and** either the email's domain is `gmail.com`, or `hd` is present and equals the email's domain (case-insensitive). Otherwise return 409 `google_use_code`, audited as `BOS_INVITE_REDEMPTION_REFUSED {reason: 'google_account_not_authoritative'}` with no address, and make no claim and no user. Copy in en/he/es: "For this address, please use the emailed code below." Check the rule **before** the email-match step, so a refusal never reveals whether the addresses matched. Tests: a Workspace account with a matching `hd` passes; a consumer account on `@company.com` without `hd` is refused; a mismatched `hd` is refused. |
| **R-3** | **Medium** | 3a | **The logo URL must not use `platformUrl()`'s fallback.** `platformEmailBranding` reads `process.env.NEXT_PUBLIC_APP_URL` **directly**, and sets the logo only when that value is non-empty and starts with `https://`. Unset, `http://`, or anything else gives the text wordmark. Fix T-3a-3 and a4 to match, and test them with the variable **deleted** (not the Jest default). Also add a guard test that `public/images/brand/wordmark.png` exists at that path: emails already sent point at it forever, so a rename breaks them silently. |
| **R-4** | **Medium** | 3b | **The GIS button under `Referrer-Policy: no-referrer`.** GIS's button iframe checks the embedding origin, which it reads partly from the Referer. Google documents failures when no referrer is sent. At 3b-10, confirm on `localhost:3000` that the button renders and returns a credential with the current layout. **If it does not**, SA pre-approves changing the invite page's policy (layout `metadata.referrer`) to `strict-origin`. That sends only the scheme and host, never a path or a fragment, and the token is in the fragment, which has already been reduced to `/invite`. AC-9 and T-7 still hold. The API routes keep their `no-referrer` response header. Record the result in §7 against 3b-10. |
| **R-5** | **Medium** | 3b | **Fail-closed claim checks.** Treat any of these as `invalid`: a missing `nonce` claim; `SHA-256(rawNonce)` in lowercase hex not equal to it; a missing `iat`, or `iat` more than 600 s old or more than 300 s in the future; a missing or non-string `email`. Pass `audience` as the single configured id. Make the **cert fetch** separately first (`getFederatedSignonCertsAsync`, inside the same `try`) and map its failure to `unavailable` (503 `unavailable_try_again`), not 400: a Google outage is not the invitee's bad token. |
| **R-6** | **Medium** | 3b | **Q-3 as ruled.** There is one accessor, `googleSignInClientId()`, reading `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` only (trimmed, empty means unset). It is used by the page (script and button), the route's 404 gate and the verifier's `aud`. A test pins that the plugin's `NEXT_PUBLIC_GOOGLE_CLIENT_ID` being set does **not** switch 3b on. Add the variable to `docs/feature_flags.md`, stating that its value must be the client id configured in Supabase's Google provider. |
| **R-7** | Medium | 3b | **The shared claim builder touches the #143-hotfixed `claimForSignup`.** The builder is acceptable. If `claimForSignup`'s code changes at all, run the §9.3 live no-match check for **both** `claimForSignup` and `claimForGoogleSignup`, and record both. Keep the builder's discriminant exhaustive: a `switch` with a `never` default, so no third "kind" can silently skip the hash filter. |
| **R-8** | Low | 3b | **Refusals point to the path that works.** The mismatch copy adds "or use the emailed code below". Gmail dots and `+tags` make the same mailbox read as a different address (D-7 is correct, and the invitee needs a way through). The `google_email_unverified` and R-2 copy do the same. |
| **R-9** | Low | 3a | **Wording and field names.** §3.5(2) describes `logo: { url, width, height, alt }`, while §3.5(3) adds flat `logoWidth` / `logoHeight` to `BrandingData`. Use the flat fields (with `logoUrl`), and keep the alt text as `businessName`. Change "byte-identical" in §3.5(3) to "identical apart from the removed comments", as T-3a-5 already says. |
| **R-10** | Low | 3b | **The cross-method stale-claim test (extends T-3b-8).** A lapsed claim left by the **password** path, whose account already exists, is finished by a Google redemption (`email_exists` → `findUserExists` true → finalise). The reverse is covered by 1b's existing I-6 tests. Assert that `REDEEMED` carries `method: 'google'` in that case. |
| **R-11** | Low | 3b | **No Zod issues in logs** on the new route (follow the complete route: return `invalid_request` and log nothing about the body). `sub` is never read into any variable that reaches a log, an audit or a response. The only Google claims the orchestration receives are the email (compared, then dropped) and the result code. |
| **R-12** | Low | both | **Manual-check additions.** G3: the Google consent screen must be **published**, or `<fresh>` must be added as a test user (G-1 records which). G8: also open the audit rows for G3 and G5 in the admin audit view, and confirm no email, `sub` or token appears in `details`. §10.1 (optional): view E1 in Gmail's mobile app in dark mode. The wordmark is dark ink on transparent, so if it is unreadable, record it as a follow-up and do not block. |

#### Tenant isolation (`tenant-isolation-guard` walk)

The caller supplies two things, the invite token and the Google ID token, and both are verified before any write. The invite token is a capability, looked up by its hash. The ID token is verified cryptographically, with a fail-closed authoritative-address check (R-2), and then matched to **the row's** email. The account id is generated by the server (I-3). `createUser` receives an explicit allow-list (`id`, the row's `email`, `email_confirm`). The body is `.strict()`, and T-3b-12 injects `email`, `userId` and `cohort`. There is no upsert, and no trigger fires on the invite update. Finalise is keyed on `(invite id, claimed account id, email)`, all server-derived. §3.4 meets the checklist, with no gap.

#### Audit and the M-1 scrub

No new event names (D-11) is correct. `BOS_INVITE_REDEEMED.details.method`, and the refusal reasons `google_email_mismatch`, `google_email_unverified` and `google_account_not_authoritative` (R-2), carry **no address, no `sub`, no token and no nonce**. That must be asserted on the audit calls, the log lines and the bodies (T-3b-4 extended to R-2 and R-1). `stopWithClaimKept` already scrubs email-shaped text from `createUser` messages (M-1), and the password-less creator returns the same error classes, so it is covered unchanged. `google_token_invalid` is logged with its reason code only, and is not audited (it is noise, not an invite event). That is acceptable.

#### Scope and split

**The split is approved as written.** 3a is small (about 8 files), has no migration, no ops and no file overlap with 3b, and ships first on its own PR. Its only prerequisite is `NEXT_PUBLIC_APP_URL` on production, which is already set, since invite links use it. 3b merges inert (D-9, R-6), so its merge is not held up by ops, and G-1 to G-4 run in parallel with the build. Nothing here should be cut. Do not add One Tap, `hd` domain allow-lists, or alias folding.

#### Ops steps and owners

| # | Owner | When | Action |
|---|---|---|---|
| — | — | 3a | None. |
| G-1 | User (Supabase dashboard) | Before switch-on; can start now | Auth → Providers → Google: record the login client id(s), and whether the Google consent screen is **published** (R-12). |
| G-2 | Holder of the Google Cloud project for that client (**user to name**: themselves or Offir) | Before switch-on | Authorized JavaScript origins: `https://neuronforge-kohl.vercel.app`, `http://localhost:3000`, `http://localhost`. |
| G-3 | User (Supabase) | Only if the GIS client differs from the provider's | Add it to the provider's Client IDs. Expected **not needed** under Q-3's ruling. |
| G-4 | Offir (Vercel admin) | Before switch-on | Set `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` (the G-1 value) on Production, then **redeploy** (the value is fixed at build time). |
| G-5 | User | After G-1 to G-4 and the deploy | Run §10.2, including R-12's audit-row check. |
| G-6 | TL | Backlog, with the "invite link domain" item | If the app domain moves, `neuronforge-kohl.vercel.app/images/brand/wordmark.png` must keep answering, because emails already sent point at it. |
| G-7 | TL | Slice 4 workplan | Carry Q-5's AC-12 test. Also carry this finding: Supabase's automatic identity linking trusts `email_verified` for **any** Google account, so a non-authoritative Google account (R-2's case) can later link itself into an existing account through the marketing site's Google sign-in. That exposure is platform-wide and predates 3b, which neither adds to it nor can close it. Slice 4 is where to look at it. |

#### User decisions

**None required.** For the user's awareness, in business terms: a few invitees will be asked to use the emailed code instead of Google. These are people whose Google account is not Gmail or a company Google Workspace account, and people whose Gmail spelling differs from the invited address (dots, `+tags`). They still join, in about a minute. This keeps the promise that nobody gets an account for an address they do not control today.

#### Optimisation suggestions (non-blocking)

- If Offir's turnaround delays G-4 by more than a few days: a Google client id is a public identifier. A one-line follow-up PR could commit it as the accessor's default, so switching on becomes an ordinary PR. SA pre-approves that, provided R-6's plugin-variable test still passes.
- Type the password-less creator's outcome without `weak_password`, so the shared tail's `weak_password` branch is visibly password-only.
- Consider adding `.eq('email', observedEmail)` to the Google claim CAS, so the claim is literally conditional on the address Google proved. The invite email is never updated today, so this is defence in depth only.

### Approval
[x] Workplan approved with the conditions above. Proceed to implementation (3a now; 3b with R-1, R-2, R-5 and R-6 in the code handed to review).

### SA Code Review 3a — 2026-09-29

**Code Review by SA — 2026-09-29**
**Status:** ✅ Code Approved (the uncommitted diff on `feature/bos-invite-signup-slice-3a`, from origin/main bd763222)

#### Code Review Comments
1. `lib/email/htmlComments.ts`: `stripHtmlComments` is correct. The regex tries the revealed opener first, then the revealed closer, then the whole `[if mso]` block, and returns all three unchanged. It deletes only plain comments, and an unterminated `<!--` is left alone. The invite note cannot contain `<!--`, because the invitation's `escapeHtml` turns `<` into `&lt;`. In chat-composed or other unescaped content, a comment it deletes was already invisible, so nothing visible changes. The one case it could alter is a literal `<!--…-->` inside an attribute value, which no template produces. Not a finding.
2. `lib/email/platformBranding.ts`: the logo URL reads `NEXT_PUBLIC_APP_URL` at call time, trims trailing slashes, and returns the logo only for a non-empty `https://` origin. Otherwise it returns `null`: the text wordmark, never the `agentspilot.ai` fallback host. This meets R-3, and the logo fields are flat (`logoUrl`/`logoWidth`/`logoHeight`), as R-9 asks.
3. `lib/email/templates/base-template.ts`: the business-email path is unchanged apart from the comments. With no width and height, the logo markup is the exact old string. The only other changes are the four comment blocks moved into TypeScript comments, plus blank-line whitespace. The 22-render test pins the old logo markup, the absence of the AgentPilot wordmark and sizing, and the MSO block as the only remaining comment. It is not a full byte-for-byte comparison against the old output; reading the diff confirms nothing else changed.
4. D-dev-3a-1 (`inline-block`): accepted. It is needed so the cell's `text-align` still places the logo on the right in right-to-left (Hebrew) emails.
5. D-dev-3a-3: add a Low backlog note. `businessName` goes into the `alt` attribute and the header span unescaped, so a `"` or `<` in a business name breaks the markup of that business's own emails. Pre-existing, not introduced by this slice. Priority: Low.
6. Verification run by SA: `npx jest lib/email lib/business-os/invites lib/business-os/bizql` passed 71 suites / 1,053 tests; `npx next build` with the CI placeholder env from `.github/workflows/build.yml` exited 0.

#### Code Approved for QA: Yes

---

## QA Testing Report

**QA waived by user for 3a (2026-09-29)** — the user's exact words: **"I waive QA for 3a and approve committing it and opening the PR"** (earlier: "skip QA for 3a" and "3a approved, have RM open the PR") (proportionate effort; email template change, SA code-approved with 1,053 tests and `next build` OK). No QA run for 3a. Post-deploy check owed: send one test invite to a Gmail +alias and confirm the AgentPilot logo shows. 3b still requires QA.

---

## Commit Info

### Slice 3a
- **Branch:** `feature/bos-invite-signup-slice-3a`
- **Approvals:** SA code review ✅ (2026-09-29) · QA waived by user for 3a (2026-09-29) · user approved commit + PR (2026-09-29): "I waive QA for 3a and approve committing it and opening the PR"
- **Commits and PR:** pending (this docs commit precedes the `feat(email)` commit on the same branch; hashes and PR number are added in a follow-up `docs:` commit).

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-29 | Created (Dev) | Slice 3 workplan: Google sign-up through the 1b claim → create → finalise path, with a verified Google ID token as the mailbox proof and a browser `signInWithIdToken` session that links the identity; the folded-in platform-email fix (no HTML developer comments, AgentPilot wordmark on the invitation and code emails). Proposed split 3a/3b, no migration, 3b inert until configured. Questions Q-1 to Q-7 for SA. |
| 2026-09-29 | SA workplan review: approved with conditions | Rulings Q-1 to Q-7 (GIS + `signInWithIdToken` approved; `google-auth-library` direct and server-only; a dedicated `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID`, because the plugin variable is already set and would break D-9; a code-locked invite may use Google; Q-5 carried to Slice 4; `email_verified` plus an authoritative address (Gmail or a matching `hd`); strip comments from all emails). R-1 to R-12 (High: the library's error messages carry the token payload; the authoritative-address rule. Medium: the logo must not use `platformUrl()`'s dead fallback host; GIS under `no-referrer`; fail-closed claims and cert-outage mapping; the dedicated variable; the claim builder and #143). Ops G-1 to G-7 with owners. No user decision. |
| 2026-09-29 | Slice 3a implemented (Dev), uncommitted | On `feature/bos-invite-signup-slice-3a`. `stripHtmlComments` at the wrapper's return (every wrapped email; conditionals kept); `platformEmailBranding` reading `NEXT_PUBLIC_APP_URL` directly (https only, R-3) with flat `logoUrl`/`logoWidth`/`logoHeight` (R-9); both invite templates switched; guards for the wordmark file and the importers; business-path pins over 22 renders. §3.5, a4 and T-3a-3 reworded per R-3/R-9; tasks S-3, S-4, 3a-1 to 3a-5 done; Dev notes D-dev-3a-1 to 3. |
| 2026-09-29 | SA code review 3a: approved | `stripHtmlComments` correct (MSO and downlevel conditionals kept, escaped note cannot produce `<!--`); logo URL per R-3/R-9; business path unchanged apart from comments; D-dev-3a-1 (`inline-block`) accepted; D-dev-3a-3 (unescaped business name in `alt`, pre-existing) to a Low backlog note. Jest 71 suites / 1,053 tests pass; `next build` with the CI env exit 0. Status: awaiting QA. |
| 2026-09-29 | QA waived by user for 3a; user approved 3a (RM) | QA waived by user for 3a (proportionate effort; email template change, SA code-approved). User approved the commit and PR. Status, 3a-6, QA Testing Report and Commit Info updated; RM commits and opens the 3a PR. |
