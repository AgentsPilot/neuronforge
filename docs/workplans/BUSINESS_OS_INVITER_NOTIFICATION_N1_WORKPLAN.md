# Workplan: N-1, email the inviter when their invite is accepted

> **Last Updated**: 2026-10-05

**Developer:** Dev
**Requirement:** [BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md) (FR-15, FR-31, FR-34, FR-35, §8.3), plus the BA scoping note "Tell the inviter when their invitee accepts" (2026-10-04) and the user's decisions N1 to N7 (2026-10-04). The decisions are recorded in the requirement by task T-0.
**Date:** 2026-10-05
**Branch:** `feature/bos-inviter-notification`, cut from `origin/main` at `89dbc568` (the #193 merge) in the `neuronforge-invite-s0` worktree.
**Status:** Code Complete (uncommitted; awaiting SA code review and QA)

## Overview

When someone accepts an invite and their account is created, the person who issued that invite gets one short email. That person is the champion for a friend invite, or the individual admin for an admin invite. The email names only the address the inviter typed, plus a status: "joined", or for a held friend "signed up — payment pending". It goes out from the platform sender. It never blocks or fails the invitee's signup. The invitee is told up front, in one line on the invite page and in the invitation email, that their inviter will hear when they join. "Friend subscribed" is N-2. It ships with payments P-5 and is out of scope here, but the sender module is built so N-2 can add its event.

---

## 1. Analysis Summary

| Area | As built (checked on `origin/main` `89dbc568`) | N-1 impact |
|---|---|---|
| Redemption | `lib/business-os/invites/inviteRedemption.ts`. Both proofs, password (`completeSignup`) and Google (`completeGoogleSignup`), go through the shared `createAndFinish` and then `finish`. `finish` forks into the champion finalise (admin invite, landing `onboarding`) or `finishFriend` (friend invite, landing `awaiting_payment`). The success audits are written there. | **One hook point per fork**, after the success audits. That covers password, Google, friend and admin invites. |
| Wiring | `redemptionDeps.ts` `buildRedemptionDeps`, shared by the `code`, `complete` and `google` routes. Each route awaits `flushRedemptionAudit` before it answers. | Add a `notifyInviter` dependency. The notification audit is flushed by the existing flush. |
| Redemption read | `BUSINESS_OS_INVITE_REDEMPTION_COLUMNS` has `issuer_kind` and `issuer_account_id`, but **not** `issuer_admin_id`. | Add `issuer_admin_id` to the column list and to `BusinessOsInviteRedemptionView`. It is never returned to the browser. |
| Issuer ids | `issuer_admin_id` is the admin's **auth user id** (`gate.user.id` in `app/api/admin/business-os/invites/route.ts`). The CHECK constraint `business_os_invites_one_issuer` guarantees exactly one of the two ids is set. | Recipient = the auth user with that id. |
| Recipient email | `AuthAccountRepository.findUserIdentity(id)` returns `{ id, email, createdAt }` or a definite `null`. It is currently documented as used by the admin delete preview only. `inviter_reply_to` is a creation-time snapshot that no select reads, by design ("never for a screen"). | Use the **live** auth email via `findUserIdentity`. Widen its doc comment. Do not read the snapshot. |
| Admin still an admin? | `AdminAccessService.isAdminById(userId)` (`admin_users`, never `profiles.role`). | An admin invite emails the issuing admin **only while they are still an active admin**. Otherwise skip (reason `recipient_not_admin`). SA Q-3. |
| Recipient language | `lib/business-os/userLanguage.ts` `resolveUserLanguage({ profileLanguage, preferredLanguage })` is the server-side resolver (profile first, then preference, then `en`). `UserPreferencesRepository.findPreferredLanguage` exists. `BusinessProfileRepository` has no language read; `ProposalSendService` reads `business_profiles.language` with a direct Supabase call (rule 1 breach, not ours). | Add `BusinessProfileRepository.findLanguage(userId)`, modelled on `findDefaultCurrency`, and resolve with `resolveUserLanguage`. |
| Sender | `platformSenderAddress()` fails closed (`inviteEmail.ts` R-2, `redemptionDeps.ts` `senderConfigured`, #171). `sendEmail` takes `kind`, `redactRecipientInLogs` and `redactInLogs`, and logs subjects. | Same gate. No `from`, no `replyTo`, no `ownerUserId`. The subject carries no address. |
| Templates | `lib/email/templates/invite-existing-account.ts` is the closest model (platform branding, `COPY` en/he/es, RTL, `emailButton`, a plain-text part). `escapeHtml` is in `lib/email/escapeHtml.ts` (#201). `emailDetailsTable` / `emailDetailRow` rely on callers to escape. | New `invite-accepted.ts` built on the same pattern. |
| Post-response work | Next `^14.2.33`: no `after()`. `@vercel/functions` `waitUntil` is not installed. Nothing in `app/` or `lib/` defers work past the response. | Post-response would be a **new pattern**. Plan: awaited inline, under a hard deadline (§2.2). |
| Lease vs. duration | `INVITE_CLAIM_LEASE_SECONDS = 120`. The signup routes' `maxDuration = 60` (pinned by a test). Finalise sets `redeemed_at` in the same transaction (migrations 20261014:92, 20261024:78). | This is what makes the send exactly-once without a stamp (§2.3). |
| N6 copy | `app/invite/invitePageCopy.ts` (`validHeading: (name) => \`${name} invited you\``, en/he/es) and `lib/email/templates/invite-invitation.ts` (`inviterName: string \| null`, `null` when `isPlatformFallbackName`). | One new line in each, with a named and an unnamed form. |
| Audit | `lib/audit/events.ts`: `BOS_INVITE_*` events plus their severity registry. | Two new events (§2.6). |
| Entitlements | None of the new code imports `lib/business-os/entitlements/**`. `inviteRedemption.ts` and `redemptionDeps.ts` are already registered importers, and their entitlement imports do not change. | `inviterNotification.ts` must **not** import entitlements. `npm run test:bos-entitlements` still runs before handover. |

**Phase / root cause:** not V6 or plugin work. **Deprecated systems:** none touched. The agent-platform `notification_settings` path (browser writes) is deliberately **not** used (BA §4).

**Touched files that still use `console.*`:** to be checked in T-1 for each file opened. Any found are flagged per CLAUDE.md § Logging. The invites module and the email templates are believed to be Pino-only already.

---

## 2. Implementation Approach

### 2.1 Where the trigger hooks

Inside the orchestration, not the routes, so password, Google, friend and admin all reach it by construction:

- `finish` (champion / admin invite): after `BOS_INVITE_PLAN_PROVISIONED` and the "Invite redeemed" log, before `return`.
- `finishFriend` (friend invite): after its `BOS_INVITE_PLAN_PROVISIONED` and log, before `return`. Only on `finalised` / `already_finalised`. `issuer_not_eligible` and every failure path send nothing.

The call is `await notifyInviterSafely(deps, { inviteId, issuerKind, issuerAccountId, issuerAdminId, inviteeEmail: row.email, landing, inviteeAccountId: accountId })`. This is a local wrapper with a `try/catch` that logs `{ inviteId, err }` at `warn` and swallows the error. **The signup outcome is computed before the call and returned unchanged whatever the notification does.** The status line is chosen from `landing` (`awaiting_payment` → held wording), not from the issuer kind. When P-9 lets an admin Paid invitee be held, the right wording then follows with no change here.

### 2.2 Never blocks or fails the signup

- `deps.notifyInviter` never throws (contract plus the wrapper above).
- **One overall deadline** covers the whole notification (recipient lookups, language reads and the send): `INVITER_NOTIFICATION_POLICY.deadlineMs = 8_000`, using the `Promise.race` pattern of `inviteEmail.ts` (QA2a-1). A late send is left to finish and its result is ignored. This keeps the worst case well inside `maxDuration = 60`.
- **Inline-awaited rather than fire-and-forget.** An un-awaited promise on Vercel can be frozen with the instance once the response is sent. `after()` / `waitUntil` would be a new pattern and a new dependency (SA Q-1). Cost: the signup response waits for the send. The typical Resend send takes well under a second, and the cap is 8 s.
- Sender unset → nothing is composed or sent. One `warn` (`reason: 'sender_not_configured'`, no address). The signup succeeds normally.

### 2.3 Exactly-once without a stamp (no migration proposed)

Two concurrent requests can **never** both reach `finish` for one invite:

1. The claim compare-and-swap lets one request at a time past the claim.
2. A claim can only be re-taken after the 120 s lease. Every signup request is dead by 60 s (`maxDuration`, pinned by test), so the first request can no longer send.
3. Finalise writes `redeemed_at` in the same transaction. Any later request loads the invite as `accepted` → `409 used`, before `finish`.
4. `already_finalised` occurs only on the same request's own retry, after a first finalise call whose answer was lost. Notifying on it is correct, because that request did redeem the invite.

So the email goes out **at most once per invite**. It goes out exactly once unless the function dies between finalise and send, or the send itself fails. In those cases it is lost and not retried, and the inviter still sees the status in their list (FR-31) or the admin list.

**Alternative (SA rules):** a stamp column `business_os_invites.inviter_notified_at`, claimed by compare-and-swap before the send. It only adds value with a retry job (a `durable-queue-drain` drain) to recover lost sends, which is out of proportion for at most 5 emails per champion. If SA wants it anyway, the free number is **`20261036`**. `20261025` to `20261029` are payments', `20261030` to `20261034` are reserved by credits-boost / LLM deduction / payments-P2 docs, and `20261035` is taken (audit-trail owner policy). I checked every worktree under `AgentsPilot/` and all docs.

### 2.4 Recipient and content

| Invite | Recipient | Lookup (all keyed on ids from the matched invite row, never from the request; `tenant-isolation-guard`) |
|---|---|---|
| Friend (`issuer_kind = 'account'`) | The champion | `findUserIdentity(issuer_account_id)` → email |
| Admin (`issuer_kind = 'admin'`) | **The admin who issued it** (N4), not all admins | `isAdminById(issuer_admin_id)` must be `true`, then `findUserIdentity(issuer_admin_id)` → email |

No recipient (a definite `null`, an email of `null`, a lookup error, or no longer an admin) means skip, logged with a reason code, audited as not sent.

**Content (N3).** The invitee's address exactly as stored on the invite (= what the inviter typed, normalised at send), plus the status. That is all. No name, Google display name, business, plan price or account id.
- Subject, with no address because the transport logs subjects: en "Your invitation was accepted" / he "ההזמנה שלך התקבלה" / es "Tu invitación fue aceptada".
- Body: heading, "**{email}** accepted your invitation." and a two-row detail table "Invited: {email}" / "Status: Joined" | "Signed up — payment pending". The held version adds "They can start once they finish their payment."
- One button: champion → `platformUrl('/business-os/settings')` ("See your invitations"); admin → `platformUrl('/admin/business-os-invites')` ("Open invites").
- Footer: "You're getting this because you sent this invitation." No unsubscribe (N5).
- `{email}` goes through `escapeHtml` everywhere in the HTML. The plain-text part carries it as-is.

**Sender (FR-15 does not apply: this is a platform message to a customer, not an invitation).** `kind: 'transactional'`, no `from` (the transport uses `RESEND_FROM_EMAIL` as configured, as the code email does), **no `replyTo`** (never the invitee), no `ownerUserId`. Also `redactRecipientInLogs: true` and `redactInLogs: [inviteeEmail]`, so the invitee's address cannot reach a transport error log either.

### 2.5 Language (N7)

Recipient language = `resolveUserLanguage({ profileLanguage: business_profiles.language, preferredLanguage: user_preferences.preferred_language })`. That is the same rule insights use: profile first, because a timezone save defaults the preference row to `en`. Then the preference, then `en`. A failed read counts as absent (never fails the send). The resolution `source` is logged. An admin with no business profile falls to their preference, then `en`.

### 2.6 Audit and logging

- New events `BOS_INVITE_INVITER_NOTIFIED` (info) and `BOS_INVITE_INVITER_NOT_NOTIFIED` (info; the BA suggested info for both, and a skipped courtesy email is not a warning-level event), registered in the severity map with `complianceFlags: ['SOC2']`.
- Entry: `entityType: 'business_os_invite'`, `entityId: inviteId`, `details: { correlationId, recipientKind: 'champion' | 'admin', recipientAccountId, status: 'joined' | 'payment_pending', language, reason? }`. **No email of anyone.** `userId` / `actorId`: proposed `null` (a system event), so the row is not visible in either person's own audit view. SA Q-4.
- Logs: `{ inviteId, recipientKind, outcome, reason, languageSource, provider }`. Never an address, and never the subject plus address together.

### 2.7 N6, the transparency line

The line is a statement in the first person plural, so Hebrew needs no gendered verb. When the inviter has a real name, the line uses it. When the name is the platform fallback (FR-15 / BQ-9: an admin with no name on record → "AgentPilot"), it uses the unnamed form.

| | Named | Unnamed |
|---|---|---|
| en | We'll let {name} know when you join. | We'll let the person who invited you know when you join. |
| he | נעדכן את {name} כשתצטרפו. | נעדכן את מי שהזמין אתכם כשתצטרפו. |
| es | Avisaremos a {name} cuando te unas. | Avisaremos a quien te invitó cuando te unas. |

- Invite page: shown in the signable states (champion and friend), under the form, in small muted text. The page already has the display name. Not shown in the refused or expired states.
- Invitation email: one line above the "Not expecting this?" footer, with the name escaped. It is new copy in an existing template, so the subject is unchanged.
- The user reviews the he/es copy (as for 5a), which is a demo step.

### 2.8 Built so N-2 can hook in

`lib/business-os/invites/inviterNotification.ts` exports `notifyInviter(input, deps)` with `input.event: 'accepted'` as a one-member union. N-2 adds `'subscribed'`, its copy and its call site in P-5's webhook, where `first_paid_at` is stamped once (SR-7). The template takes `event` as well.

---

## 3. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/invites/inviterNotification.ts` | create | `notifyInviter`: recipient resolution, language, sender gate, template, send, deadline, audit and log. Pure over injected deps. Never throws. |
| `lib/business-os/invites/inviteEmailPolicy.ts` | modify | `INVITER_NOTIFICATION_POLICY` (`deadlineMs`), next to the invitation policy. |
| `lib/email/templates/invite-accepted.ts` | create | en/he/es, RTL, plain-text part, platform branding, `escapeHtml`. |
| `lib/business-os/invites/inviteRedemption.ts` | modify | `notifyInviter` in `RedemptionDeps`; `notifyInviterSafely` called from `finish` and `finishFriend`. |
| `lib/business-os/invites/redemptionDeps.ts` | modify | Production wiring (repositories, `AdminAccessService`, `sendEmail`, `platformSenderAddress`, audit). Header comment updated. |
| `lib/repositories/BusinessOsInviteRepository.ts`, `lib/repositories/types.ts` | modify | `issuer_admin_id` added to the redemption columns and view. |
| `lib/repositories/BusinessProfileRepository.ts` | modify | `findLanguage(userId)` (narrow select, `.eq('user_id', userId)`). |
| `lib/repositories/AuthAccountRepository.ts` | modify | Doc comment only: `findUserIdentity` now also has the inviter-notification caller. |
| `lib/audit/events.ts` | modify | Two events plus registry entries. |
| `app/invite/invitePageCopy.ts`, `app/invite/page.tsx` (or the component that renders the form) | modify | N6 line. |
| `lib/email/templates/invite-invitation.ts` | modify | N6 line. |
| Tests (§5) | create / modify | Co-located `__tests__`. |
| `docs/requirements/BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md` | modify (TL applies) | T-0 edit blocks (§7). |

No migration (unless SA rules for the stamp, §2.3). No new route. No new dependency.

---

## 4. Task List

- ✅ **T-0** Requirement edit blocks (§7, revised for SA C-4), handed to TL to apply. No rewrite.
- ✅ **T-1** No `console.*` in any touched file. `findUserIdentity` returns a definite `{ data: null }` only on 404 / `user_not_found` (anything else is an error, which skips with `recipient_lookup_failed`); `isAdminById` returns `false` on any error (fails closed).
- ✅ **T-2** `issuer_admin_id` on the redemption read (column list, view type, column-pin test); `BusinessProfileRepository.findLanguage` plus its unit test.
- ✅ **T-3** Template `invite-accepted.ts` (both statuses × both recipient kinds × en/he/es; RTL; text part; escaping; subject with no address).
- ✅ **T-4** `inviterNotification.ts` plus `INVITER_NOTIFICATION_POLICY` (4 s) and `INVITER_NOT_NOTIFIED_REASONS`, with its own deps type and unit tests.
- ✅ **T-5** Audit events, severity registry and the audience map (`eventAudience.ts`, pin 179 → 181, BOS 34 → 36).
- ✅ **T-6** Hooked into `finish` and `finishFriend` through `notifyInviterSafely`. The `inviteRedemption` tests' fake deps updated.
- ✅ **T-7** Production wiring in `redemptionDeps.ts` (and its test).
- ✅ **T-8** N6 line on the invite page and in the invitation email (named and unnamed, en/he/es), with render tests.
- ✅ **T-9** Previews in the session scratchpad (`n1-previews/`), rendered by a scratchpad-only harness with every I/O mocked.
- ✅ **T-10** Scoped `tsc` on every changed file (clean; the full-project `tsc` runs out of memory here), eslint on changed files (0 errors; 2 pre-existing warnings on untouched lines), the requested Jest set and `npm run test:bos-entitlements` (all green).
- ✅ **T-11** Workplan updated, changes left **uncommitted**.

---

## 5. Tests

| # | Where | Asserts |
|---|---|---|
| 1 | `inviteRedemption.test.ts` | Password and Google × admin and friend: `notifyInviter` is called once with the right `issuerKind`, issuer id and `landing`. Not called on `issuer_not_eligible`, a finalise failure, a create failure or any refusal. |
| 2 | same | `notifyInviter` rejects, throws or hangs → the outcome is still `{ ok: true, … }`, identical to the no-notification outcome. |
| 3 | same | `already_finalised` on the retry still notifies, exactly once per call. |
| 4 | `inviterNotification.test.ts` | Champion → the champion's email. Admin → the issuing admin's email, and **not** called with any other admin. Admin no longer active → not sent, `reason: recipient_not_admin`. Identity `null` or error → not sent, audited. |
| 5 | same | **Sender unset** → `sendEmail` never called; outcome `not_sent / sender_not_configured`; a warning with no address. (Together with #2: the signup still succeeds.) |
| 6 | same | Send params: `kind: 'transactional'`, no `from`, **no `replyTo`**, no `ownerUserId`, `redactRecipientInLogs: true`, `redactInLogs` contains the invitee email. The subject contains no `@`. |
| 7 | same | **Privacy:** the rendered HTML and text contain the invitee email and none of the account id, the Google name, the inviter's name or the plan price (the fixture deps return those values, so a leak would show). The audit details and every log context contain no `@`. |
| 8 | same | Language: profile `he` beats preference `en`; preference `es` used when there is no profile; both missing or failing → `en`; the source is logged. |
| 9 | same | Deadline: a hanging send → resolves at the deadline as `unknown`, never throws. |
| 10 | `invite-accepted.test.ts` | Each locale renders; `he` has `dir="rtl"`; held vs. joined wording; an email containing `<script>` / quotes is escaped in the HTML; the champion and admin button targets. |
| 11 | `invitePageCopy` / page render and `inviteEmail.test.ts` | N6 line present in en/he/es; named form with a real name; unnamed form for `AgentPilot` / blank; the name is escaped in the email. |
| 12 | `redemptionDeps.test.ts` | Wiring builds `notifyInviter`; the audit goes through the same non-blocking `audit` path (flushed by the route). |

---

## 6. Demo plan (nothing written to production)

1. **Rendered previews**, as for #197: a scratch script in the session scratchpad, not committed, writes `invite-accepted` × {champion joined, champion friend held, admin joined} × {en, he, es} to HTML and text files. It also writes the invitation email and invite-page copy with the N6 line, named and unnamed. The user opens them in a browser.
2. **Unit evidence** for the behaviour: tests #2, #5 and #7 are the "never blocks", "fails closed" and privacy proofs.
3. **Live check after merge**: the existing pending prod test (§0.2 row 1: a friend invite to a Gmail +alias) now also shows the champion's email arriving. The same applies to the next real admin invite. This is not an extra prod write, because it reuses a test the user already owes.

---

## 7. T-0: requirement edit blocks (for TL to apply)

**(a) §0.3 "Next, and what blocks it": new row after the 5c row**

> | **N-1: email the inviter when an invite is accepted** (champion for a friend invite, the issuing admin for an admin invite). [Workplan](/docs/workplans/BUSINESS_OS_INVITER_NOTIFICATION_N1_WORKPLAN.md). N-2 ("friend subscribed") ships with payments P-5 | Nothing (in progress) | — |

> **Revised 2026-10-05 for SA C-4:** FR-39 now says "never fails the signup and adds at most a few seconds to it"; FR-40 uses the FR-31 list label "Signed up — not subscribed yet" (SA Q-5). Blocks (a), (c) and (d) are unchanged apart from the status wording in (d).

**(b) New §7.10 after §7.9 (and a ToC line)**

> ### 7.10 Telling the inviter (N-1; N-2 with P-5). Decided by the user 2026-10-04 (N1 to N7)
>
> | ID | Slice | Requirement |
> |---|---|---|
> | **FR-39** | N-1 | **When an invite is accepted** (the account is created, by code or by Google), the person who issued it gets **one email**: the champion for a friend invite; for an admin invite, **the individual admin who issued it** (not all admins), while they are still an admin. **Email only**, since Business OS has no in-app notification area (N2). It is sent at most once per invite. It **never fails the signup and adds at most a few seconds to it** (one 4 s cap over the whole notification). |
> | **FR-40** | N-1 | **Content (N3).** Only the address the inviter typed and the status: **"Joined"**, or for a held friend **"Signed up — not subscribed yet"**, the FR-31 list label, in its existing en/he/es wording (SA Q-5). Never the invitee's name, Google display name, business or anything from their account. Platform sender, `transactional`, **no Reply-To to the invitee**. Not sent if the platform sender is not configured. **No opt-out in v1 (N5).** |
> | **FR-41** | N-1 | **Language (N7).** The **recipient's** own language (business profile, then preference, then English), not the invite's. en/he/es, RTL for Hebrew. |
> | **FR-42** | N-1 | **Transparency (N6).** The invite page and the invitation email say, in one line, that the inviter will be told when the invitee joins: "We'll let {name} know when you join", or "the person who invited you" when the inviter has no name on record. |
> | **FR-43** | N-2 | **When the friend first pays**, the champion gets one email ("{email} has subscribed"), sent where `first_paid_at` is stamped once. Built with P-5. Not in N-1. |

**(c) §8.3 audit table: new row**

> | Inviter notified / not notified (recipient kind, inviter account id, status, reason class; never an email) | System | info |

**(d) Change History row**

> | 2026-10-05 | Inviter notification N1 to N7 recorded (TL) | User decisions 2026-10-04 on the BA scoping note: email the inviter when an invite is accepted (N-1, now) and when a friend first pays (N-2, with P-5); email only; only the typed address and status (a held friend reads "Signed up — not subscribed yet", the FR-31 list label); **both** champion and admin invites, the admin who issued it (the user overrode the BA default of "off" for admins); no opt-out; a transparency line for the invitee; the recipient's language. Added FR-39 to FR-43 (§7.10), an §8.3 row and an §0.3 row. |

---

## 8. Sizing

**S, about 2 days.** About 1 day for the code (one module, one template, two hook calls, the wiring, two small repository changes) and about 1 day for tests, copy and previews. No migration or route. Risk is low: every new path ends in "log and carry on".

---

## 9. Questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | Inline-awaited with an 8 s overall deadline, or post-response (`waitUntil` / an `after()` equivalent, which would be a new pattern and dependency on Next 14)? | Inline-awaited, deadline-capped. |
| Q-2 | Exactly-once: rely on lease (120 s) > `maxDuration` (60 s) plus `redeemed_at` in the finalise transaction (at most once, a rare loss accepted), or add `inviter_notified_at` (migration `20261036`)? | No stamp, no migration. |
| Q-3 | Admin invite whose issuer is **no longer an active admin**: skip (proposed), or send anyway? Also: is the live auth email correct rather than the `inviter_reply_to` snapshot? | Skip; live auth email. |
| Q-4 | Audit `userId` / `actorId` = `null` (a system event, invisible in both owners' audit views) with `recipientAccountId` in the details. Or attribute it to the inviter? | `null`. |
| Q-5 | Status wording "Signed up — payment pending" (the user's words, N3) versus the FR-31 list label "Signed up — not subscribed yet". Align the email to the list? | Use the list's label so the two never disagree; flag to TL if SA agrees. |
| Q-6 | Reusing `findUserIdentity` (currently documented as used by the admin delete preview only) for a second caller, versus a dedicated `findUserEmail`. | Reuse; widen the doc comment. |

---

## Implementation Notes (Dev, 2026-10-05)

**How each SA ruling and condition is met**

| Item | Where |
|---|---|
| Q-1 inline, capped | `notifyInviter` races the whole run (lookups, template, send) against `INVITER_NOTIFICATION_POLICY.deadlineMs`; a late send is left to finish and ignored. `notifyInviterSafely` in `inviteRedemption.ts` also catches any rejection and has a backstop at deadline + 500 ms (`INVITER_NOTIFICATION_BACKSTOP_MS`), so even a broken dependency cannot make the signup wait longer. |
| Q-2 no stamp | No migration. `20261036` stays free. |
| Q-3 | Admin invite: `isAdminById(issuer_admin_id)` (false on error) gates the send; reason `recipient_not_admin`. Live email via `findUserIdentity`; `inviter_reply_to` is not read. |
| Q-4 | The notification audit is written with `userId: null`, `actorId: null`; `recipientAccountId` is in details. Note: `AuditTrailService` substitutes `SYSTEM_ADMIN_USER_ID` for a null owner when that env var is set, exactly as for the existing anonymous redemption audits. |
| Q-5 | Held status = `INVITE_FRIENDS_COPY[locale].status.joined` (imported, not re-translated). A test pins it per locale. |
| Q-6 | `findUserIdentity` reused; file header and method comment widened. `inviterNotification.ts` types the lookup structurally, so the `AuthAccountRepository` callers guard needed no new entry. |
| C-1 | 4 s; the admin check, the identity lookup and both language reads start together (`Promise.all`); a test proves all four start before any resolves. |
| C-2 | Ids only from the matched row; the service-role comment is in `redemptionDeps.ts`; `findLanguage` keeps `.eq('user_id')` and a one-column select; route tests prove `issuer_admin_id` never reaches any of the three routes' JSON, on success or refusal. |
| C-3 | Tests assert no `@`, no invitee address and no inviter address in any log context, log message or audit entry, on sent, not-sent and no-recipient paths, in the module and through the production wiring. |
| C-4 | §7 blocks revised (see the note at the top of §7(b)). |
| C-5 | Page: under the form, `text-xs text-slate-500`, only while the visitor can sign up (signed out, form shown, no Google account created yet). Email: one line above the "Not expecting this?" footer, escaped. |

**Deviations and additions (for SA code review)**

1. **Backstop in `notifyInviterSafely`** (not in the workplan). The workplan relied on the module's own deadline only. A `try/catch` cannot stop a hang, so the wrapper also races a backstop at deadline + 500 ms and logs `abandoned at the backstop`. Test #2 covers reject, throw and hang.
2. **The wrapper logs the error class, not the error.** The workplan said `{ inviteId, err }`. An error's message could carry an address (C-3), so only `errName` is logged.
3. **`deadline_exceeded` is audited as `BOS_INVITE_INVITER_NOT_NOTIFIED` with `outcome: 'unknown'`.** A late send may still land, as with the invitation email's "Unknown". The registry description says "not emailed, or the send was not confirmed in time".
4. **Champion button target** is `/business-os/settings#settings-section-invite-friends` (the section's existing element id), so the link lands on the list.
5. **Audience map.** `lib/audit/eventAudience.ts` tags both new events `bos` and its pinned count moves 179 → 181 (BOS 34 → 36). The workplan's file table missed this file; the `eventAudience` test failed until it was added.
6. **Platform branding allow-list.** `lib/email/__tests__/platformBranding.test.ts` pins which templates may use the AgentPilot wordmark; `invite-accepted.ts` is added to it.
7. **Status code names.** `status` in the audit details is `'joined' | 'not_subscribed_yet'` (the workplan said `payment_pending`), to match Q-5.
8. **Hebrew "Joined"** is `הצטרף`, the same masculine-generic form as the existing list label `נרשם — עדיין ללא מנוי`. The other Hebrew sentences are written so no verb agrees with the invitee. For the user's review with the previews.
9. **Layering.** `lib/email/templates/invite-accepted.ts` imports `INVITE_FRIENDS_COPY` from `components/business-os/settings/inviteFriendsCopy.ts`. That file is pure data with no imports, and Q-5 asks to reuse its strings exactly. If SA prefers, the strings can move to a shared `lib/` copy module in a follow-up.

**Files changed:** see `git status` in the hand-over. Nothing is committed.

## SA Review Notes

**Reviewed by SA — 2026-10-05**
**Status:** ✅ Approved with conditions (C-1 to C-5 below; no re-review needed, verified at code review)

### Rulings on Dev's questions
1. **Q-1** — Inline-awaited, deadline-capped. No `waitUntil` / `after()` (new pattern plus dependency, out of proportion). The cap is tightened (C-1). — SA: resolved
2. **Q-2** — No stamp, no migration. Lease 120 s > `maxDuration` 60 s plus `redeemed_at` in the finalise transaction gives at-most-once; a rare lost courtesy email is accepted (the status stays visible in FR-31 / the admin list). `20261036` stays free. — SA: resolved
3. **Q-3** — Skip when the issuing admin is no longer active (`isAdminById`, which fails closed to `false` and never reads `profiles.role`; its 60 s cache may let a just-removed admin get one email, which is acceptable). Use the **live** auth email via `findUserIdentity`, never the `inviter_reply_to` snapshot. — SA: resolved
4. **Q-4** — `userId` / `actorId` = `null`, with `recipientAccountId` in details. Do not attribute it to the invitee: the existing redemption audits use the invitee as owner, and the inviter's id must not reach the invitee's own audit view. — SA: resolved
5. **Q-5** — Use the FR-31 list label **"Signed up — not subscribed yet"** (already approved, already in `components/business-os/settings/inviteFriendsCopy.ts` in en/he/es). Reuse those exact strings and do not re-translate. This is a consistency call within the user's approved default, so the user does not have to decide; TL tells him in the diff summary. FR-40 in T-0 (b) must say this label, not "payment pending" (C-4). — SA: resolved
6. **Q-6** — Reuse `findUserIdentity` and widen its header and method comment (the file header still says "for the admin-gated deletion preview only"). No new method. — SA: resolved

### Conditions
- **C-1 Latency cap.** `INVITER_NOTIFICATION_POLICY.deadlineMs = 4_000`, not 8 s. Eight seconds of possible extra wait on a signup click is too much for a courtesy email. 4 s still clears Resend's normal sub-second send plus the lookups, and keeps the worst case far inside the 60 s budget, which already has to cover account creation and finalise retries. Run the two language reads and the identity/admin lookups with `Promise.all` where they are independent. Test #9 asserts the 4 s cap.
- **C-2 Tenant isolation.** Every lookup is keyed on ids from the matched invite row (`issuer_account_id` / `issuer_admin_id`), never on request input. `findLanguage` and `findPreferredLanguage` run on the service-role client in `redemptionDeps.ts` (public route, no session). Add a one-line comment there saying why the RLS bypass is intentional, per CLAUDE.md § Security Rules. `findLanguage` keeps `.eq('user_id', userId)` plus a narrow select, modelled on `findDefaultCurrency` (rules 1 and 4 met). `issuer_admin_id` is added to the server view only: add a test that the redemption routes' JSON never contains it.
- **C-3 Privacy.** As planned: only the typed address plus status; no address in the subject or logs; `redactInLogs: [inviteeEmail]`; no `replyTo`. Also, the `findUserIdentity` result (the inviter's email) must not appear in any log context (test #7 covers logs; extend it to the recipient address).
- **C-4 T-0 edits.** FR-40 uses "Signed up — not subscribed yet". FR-39's "never delays a refusal" changes to "never fails the signup and adds at most a few seconds to it". The edits are otherwise fine, and TL applies them before the PR. They do not block the code.
- **C-5 N6 placement.** Approved as planned (signable states only, muted, under the form; one line above the invitation footer, with the name escaped). The Hebrew plural form is gender-neutral and fine. The he/es copy goes to the user in the T-9 previews.

### Approval
[x] Workplan approved — proceed to implementation under C-1 to C-5

**Code Review by SA — 2026-10-05**
**Status:** ✅ Code Approved

### Code Review Comments
1. Q-1/C-1: met. One 4 s race covers lookups, template and send; the four lookups run together; `notifyInviterSafely` adds a backstop at 4.5 s and catches any rejection, swallowing late rejections too. Both `finish` and `finishFriend` call it after the outcome is fixed, so the password and Google paths are both covered. The signup cannot fail, and its worst case is about 4.5 s longer. Deviations 1 and 2 accepted.
2. Q-2/Q-3: met. No stamp. The admin path is gated on `isAdminById`, which fails closed and never reads `profiles.role`. The address comes from the live `findUserIdentity`, and `inviter_reply_to` is not read.
3. C-2: met. Ids come from the matched row only. The service-role comment is present. `findLanguage` uses `.eq('user_id')` with a one-column select. `issuer_admin_id` is on the server view only, and route tests pin that it never appears in any response.
4. C-3: met. The subject has no address. The transport redacts both addresses, there is no `replyTo`, and no address appears in logs or audit (tested). The HTML is escaped through `lib/email/escapeHtml.ts`.
5. Audit: the 2 events are registered in `events.ts`, `EVENT_METADATA` and `eventAudience` (181). Each is written with `null` as owner and is non-blocking. Deviations 3, 5, 6 and 7 accepted.
6. C-5: met. Page placement and the invitation-email line match the plan, with i18n parity across en/he/es.
7. Deviation 9 (lib template imports `components/.../inviteFriendsCopy.ts`): accepted. The file is pure data with no imports, and Q-5 requires these exact strings. Optional follow-up: move it to `lib/`. Priority: Low
8. Deviation 8 (Hebrew `הצטרף`): correct. It matches the list's masculine-generic `נרשם`, so this is not a defect and needs no decision from the user.

### Verification
`npx jest lib/business-os/invites app/invite lib/email app/api/public/invites lib/repositories lib/audit --ci`: 118 suites and 2531 tests passed. `tsc --noEmit`: no errors in touched files.

### Code Approved for QA: Yes

## QA Testing Report

_(QA to populate.)_

## Commit Info

_(RM to populate.)_

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-05 | Created (Dev) | Workplan for N-1 from the BA scoping note and the user's decisions N1 to N7 (N4 overridden: the issuing admin is emailed too). No migration proposed; `20261036` named as the free number if SA wants a stamp. |
| 2026-10-05 | Implemented (Dev) | Code complete under SA conditions C-1 to C-5; Implementation Notes added; §7 T-0 blocks revised for C-4; tasks ticked. Uncommitted. |
