# Workplan: Business OS Settings Drawer, S-5 (Tidy the account card)

> **Last Updated**: 2026-10-15

**Developer:** Dev
**Requirement:** [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md) §5 S-5, SA-3, SA-6, conditions C-2, C-8 (tightened), C-9, C-10, C-12, C-13; items routed here: S-1 SA W-5, S-1 SA finding 4 and S-4 O-2, S-4 SA Q-2 / F-20
**Branch:** `feature/settings-drawer-s5` (created by RM from `feature/settings-drawer-s4` = PR #408, which contains `origin/main` with S-1, S-2, S-3 and F-18)
**Path:** UI short path (SA-5): short workplan, implementation in the same run, then SA code review and QA
**Date:** 2026-10-15
**Status:** Code Complete 2026-10-15 (uncommitted). Awaiting SA code review and QA

## Overview

S-5 is the last Phase A slice. After S-1 to S-4 every opener on the right-hand account card is a drawer row, so S-5 only tidies: the chevrons point the same way in Hebrew on every row, the "S-5 decides" placeholder on the plan anchor is resolved, dead code left in the card's log-out code goes, and every `?section=` link is re-checked against the page. Row values (plan name, consent status) and the champion-email deep link (F-20) were assessed and are **out**, with reasons below. No server, route, database or translation change; **no new request on page load**.

**Code verified against:** `app/business-os/settings/page.tsx` at `402287ea` (head of `feature/settings-drawer-s4`). Locations are by symbol or anchor (C-13).

---

## Scope Decisions

| # | Item | Decision | Why |
|---|---|---|---|
| 1 | **Chevrons** (S-1 SA finding 4, S-4 O-2): only the invite row's chevron is mirrored in Hebrew | **In.** Every chevron on the account card (Plan, Marketing permission, Change password, Export data, Log out, Delete account) gets the invite row's mirror, `isRTL && 'scale-x-[-1]'`, through one `rowChevron` class on the page (Delete keeps its red). `aria-hidden="true"` on each, as on the invite row | In Hebrew the row reads right to left and the chevron sits on the left; an arrow pointing right points back at the label. The action rows (Export, Log out, Delete) are included because they sit in the same list and a mixed list looks broken. The export row's change is the chevron's class only; `handleExportData` is untouched (C-9) |
| 2 | **Plan anchor** `id="settings-section-plan"` (S-1 SA W-5) | **Keep**, with the "S-5 decides" comment replaced by the reason, and pinned by a guard | Senders checked: `git grep` finds no code, email template or test that builds `#settings-section-plan`; `PLAN_SECTION_HREF`, the checkout return (`planCheckout.ts` `settings_plan`) and `SETTINGS_PLAN_PATH` all use `?section=plan`. `git log -S` shows the id was only ever written by the commit that created the section and by S-1. So removing it is safe, but it costs nothing and keeps the convention every other drawer row on the card follows (`settings-section-consent`, `settings-section-invite-friends`), which `scrollToSection` keys off. A hand-shared link (support, a bookmark) still lands on the row |
| 3 | **Remove now-unused state** (§5 S-5) | **In, small.** `expandedSection` was already removed by S-3. What is left is two dead helpers inside the card's log-out code, `withDeadline` and `clearSessionKeys`, unused since log-out moved to `signOutUser` (the 2 `no-unused-vars` warnings every S-slice recorded). Removed with their doc comments. The "Sign out, properly" comment stays on `handleLogout` | Dead code on the card this slice tidies; no caller, no test. The behaviour they described lives in `signOutUser` |
| 4 | **Row value: plan name on the Plan row** (C-8) | **Out** | Needs a new page-load `GET /api/business-os/entitlements/my-plan`. C-8 then requires the drawer to reuse that data, which means threading it into `PlanSection`: its first read, its language re-read, the bounded re-read after checkout and after an upgrade, and "Check again". That is money-path code from P-4.2 / P-7b, not a tidy, and the row would go stale after a purchase made in the drawer unless `PlanSection` reports back up. Not cheap. Follow-up candidate if the user wants it |
| 5 | **Row value: consent status on the Marketing permission row** (C-8) | **Out** | Needs a new page-load `GET /api/business-os/consent-settings`, which runs four queries including two counts. Reuse in the drawer means changing `MarketingConsentPanel`'s `load()`, which carries the F-17 failed-load rules and F-18's picker seeding, both just shipped. Not cheap |
| 6 | **Champion email to `?section=invite-friends`** (S-4 SA Q-2, F-20) | **Out; recommended as its own small slice with an SA workplan review** | It changes a sent-mail contract (`INVITER_ACTION_PATHS.champion`, `invite-accepted.test.ts` pin), adds a page-to-section open request into the component that holds a credential (C-6), and needs link-opened close semantics (C-3) inside `InviteFriendsSection`, which owns its own open state rather than `useLinkOpenedDrawer`. That is a deep-link change with link-safety checks, not a tidy |
| 7 | **Re-check every `?section=` link** (§5 S-5) | **In (audit, no code change)** | Table below |

**New requests on page load: none.**

### `?section=` audit (on `402287ea`)

| Link | Sender(s) | Page behaviour | Status |
|---|---|---|---|
| `?section=plan` (`&checkout=…`) | `PLAN_SECTION_HREF` (`planBadge.ts`) → pill; `planCheckout.ts` `settings_plan`; `SETTINGS_PLAN_PATH` (`planPurchaseCopy.ts`, "Check again") | Opens the plan drawer, link-opened; close removes only `section` | ✅ pinned by `settingsDeepLinks.guard`, `planBadge.test`, `useLinkOpenedDrawer.test` |
| `?section=password` | None in the repo (SA-3 (b)) | Opens the password drawer unless the account signs in with a provider | ✅ pinned by `settingsDeepLinks.guard` |
| `?section=timezone` | `journeyGapFix.ts` | Scrolls to `#settings-section-timezone` | ✅ frozen (C-9), pinned |
| `?section=business`, `?section=invoice` | Dashboard chips, briefing emails | Opens the Configuration window | ✅ unchanged |
| `?section=preferences` | Old mail only | Page opens, nothing expanded | ✅ unchanged, by design |
| `?section=consent`, `?section=invite-friends` | None | Ignored | ✅ no sender; consent and invite use hash anchors |
| `#settings-section-invite-friends` | `INVITER_ACTION_PATHS.champion` | Row anchor; F-20 (scroll on full load) pre-existing | ⚠️ F-20, out of S-5 |
| `?tab=payments\|services\|availability\|integrations` | Stripe Connect return/refresh (3 routes), `OperationalStatusCard`, `ProcessFlowSection` | **Nothing reads `tab` on this page**: they land on the plain account page | ⚠️ pre-existing, not a `?section=` link, not fixed. Proposed **F-22** for SA |

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/business-os/settings/page.tsx` | modify | `rowChevron` class; six chevrons mirrored + `aria-hidden`; plan anchor comment; dead `withDeadline` / `clearSessionKeys` removed |
| `app/business-os/settings/__tests__/accountCard.guard.test.ts` | create | Pins: every `ChevronRight` on the page is mirrored in RTL; plan anchor kept; the page makes no `my-plan` / `consent-settings` request (C-8); the dead helpers stay gone |
| `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` | modify (Edit only) | S-5 progress line, F-22 row, Change History row |

**Not touched (C-9):** `loadData`, `persistTimezone`, `saveProfile`, `handleExportData`, the Language / Currency / Timezone rows, the timezone anchor and its comment, the three guarded option rows, `CRMContactDrawerV2.tsx`. No test from C-12 is edited. No new i18n keys.

## Task List

- [x] Step 1: Workplan (this file)
- [x] Step 2: `rowChevron` + mirror on the six account-card chevrons
- [x] Step 3: Plan anchor comment resolved (keep)
- [x] Step 4: Remove `withDeadline` and `clearSessionKeys`
- [x] Step 5: `accountCard.guard.test.ts`
- [x] Step 6: Verification and mutations (below)
- [x] Step 7: Requirement progress line, F-22, Change History

---

## Test Plan

### New

`app/business-os/settings/__tests__/accountCard.guard.test.ts` (source guard on comment-stripped source, as `settingsDeepLinks.guard` does).

### Must stay green (S-4 set, unchanged)

```bash
npx jest components/business-os/settings app/business-os/settings \
  app/api/business-os/my-day/__tests__/greetingUsesTheEditedName.guard.test.ts \
  lib/business-os/entitlements/__tests__/planBadge.test.ts \
  lib/business-os/entitlements/__tests__/enforcementPoints.test.ts \
  lib/business-os/entitlements/__tests__/tierLiteral.forbidden.test.ts \
  lib/business-os/__tests__/journeyReadiness.test.ts \
  lib/email/templates/__tests__/invite-accepted.test.ts \
  components/ui/__tests__/darkModeTokens.guard.test.ts \
  lib/plugins/__tests__/pluginConnectionsBrowserAccess.guard.test.ts \
  lib/business-os/billing/__tests__/planCheckout.test.ts \
  lib/audit/__tests__/passwordChangeSeverity.guard.test.ts
```

`npm run test:bos-entitlements` is not required: nothing new imports from the entitlements module.

## Manual QA Checklist (C-10, the parts S-5 changes)

Desktop and phone, English and Hebrew:

| # | Check |
|---|---|
| Q1 | English: every chevron on the account card points right |
| Q2 | Hebrew: every chevron on the account card (Plan, Invite friends if shown, Marketing permission, Change password, Export data, Log out, Delete account) points left, toward the row's far edge |
| Q3 | Export data and Log out still swap their chevron for a spinner while working |
| Q4 | Each drawer still opens from its row and returns focus to it; `?section=plan` and `?section=password` still open their drawers |
| Q5 | Log out still signs out (the removed helpers were unused) |
| Q6 | `/business-os/settings#settings-section-plan` lands on the page (scroll is subject to the same full-load limit as F-20) |

---

## Verification Results

| Check | Result |
|---|---|
| New `accountCard.guard.test.ts` | ✅ 8/8 |
| Must-stay-green set (above, incl. the new suite through the folder path) | ✅ 29 suites / 754 tests pass (S-4 recorded 26 / 717 before #406 and F-18 landed; +1 suite / +8 tests is S-5) |
| `npm run typecheck:bos-llm` | ✅ passed, 0 new (28 baseline errors; one baseline entry in `app/api/onboarding/build/route.ts` reported fixed, not this slice's) |
| Full `tsc --noEmit` (12 GB heap), filtered to touched files | ✅ 0 errors in `app/business-os/settings/**`. 1853 repo-wide (S-4 recorded 1855; the 2 F-18 errors are gone since #406) |
| `eslint` on the 2 touched code files | ✅ 0 errors; 1 warning, pre-existing (`loadData` missing from the load effect's deps, frozen by C-9). The `withDeadline` / `clearSessionKeys` warnings every S-slice recorded are gone |
| `npm run lint:hooks` | ✅ clean (`--max-warnings 0`) |
| `console.*` in touched files | 0 |

### Mutations (scratchpad backup, restored in `finally`, SHA-1 verified after each)

| # | Mutation | Result |
|---|---|---|
| M1 | `rowChevron` loses `isRTL && 'scale-x-[-1]'` | ✅ caught, restored (`b6b27086…`) |
| M2 | Plan chevron back to a hand-written class | ✅ caught, restored |
| M3 | Delete chevron loses `aria-hidden` | ✅ caught, restored |
| M4 | `id="settings-section-plan"` removed | ✅ caught, restored |
| M5 | Page gains a `fetch('/api/business-os/consent-settings')` effect | ✅ caught, restored |
| M6 | `withDeadline` comes back | ✅ caught, restored |
| M7 | Invite row chevron loses its mirror (`InviteFriendsSection.tsx`) | ✅ caught, restored (`ab2ebd30…`) |

### Diff (`git diff --stat`, against `402287ea`)

```text
 app/business-os/settings/page.tsx                  | 85 ++++++----------------
 docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md |  3 +
 (new) app/business-os/settings/__tests__/accountCard.guard.test.ts
 (new) docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_S5_WORKPLAN.md
```

**Why `page.tsx` shrinks (22+ / 63−):** 56 of the deleted lines are the two dead helpers `withDeadline` and `clearSessionKeys` with their doc comments (Scope Decision 3). The other 7 are the six chevron lines and the one-line plan-anchor note, each replaced one for one (the note by four lines). Added: the `cn` import and the 11-line `rowChevron` helper with its comment. Nothing in `loadData`, `persistTimezone`, `saveProfile`, `handleExportData`, the Language / Currency / Timezone rows, the timezone anchor or its comment changed (C-9); the export row's only change is its chevron's class.

## Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | Mirror the chevrons on the action rows too (Export, Log out, Delete), not only the four drawer rows? | Yes, as built: same list, same direction rule |
| Q-2 | Removing the two dead log-out helpers: inside S-5's "remove now-unused" or out of scope? | Inside: they sit on the card S-5 tidies, have no caller or test, and their behaviour lives in `signOutUser` |
| Q-3 | Plan and consent row values out (C-8): agree, and should they be logged as a follow-up for the user, or dropped? | Agree out; offer the plan name as a follow-up only if the user asks |
| Q-4 | F-20 (champion email → `?section=invite-friends`) as its own small slice with an SA workplan review | Yes |
| Q-5 | F-22 (`?tab=` links land on the plain page): record only, or route to a slice? | Record; it needs a product decision on each destination |

## SA Review Notes

## SA Code Review (2026-10-15)

**Reviewed by SA, 2026-10-15** (UI short path, the only SA gate before RM)
**Verdict: APPROVED.** No code change required. One new finding (F-23) is recorded in the requirement §7. It does not block S-5.

### What was verified

| Check | Result |
|---|---|
| `rowChevron` helper | ✅ `cn` in `lib/utils.ts` is `filter(Boolean).join(' ')` and does not merge Tailwind classes, so passing the tone as an argument is the right shape: each chevron gets exactly one text colour. Delete passes `'text-red-400'` and stays red; the other five get the muted default. The mirror is `isRTL && 'scale-x-[-1]'`, the same as `InviteFriendsSection` |
| `aria-hidden="true"` | ✅ on all six chevrons. Each sits inside a `<button>` with a visible text label, so hiding the decorative icon is correct. The `Loader2` spinners on Export and Log out are unchanged (pre-existing, not in S-5's scope) |
| Frozen code (C-9, C-13) | ✅ the diff has exactly five hunks: the `cn` import, `rowChevron`, the helper deletion, the plan-anchor comment and the six chevron lines. Nothing changed in `loadData`, `persistTimezone`, `saveProfile`, `handleExportData`, the Language / Currency / Timezone rows (their `ChevronDown`s are untouched), the timezone anchor and its frozen comment, or the three guarded option rows. `darkModeTokens.guard` is green |
| Dead helpers | ✅ after the change, `git grep withDeadline\|clearSessionKeys` finds only docs: no code, test or dynamic reference. `handleLogout` calls only `signOutUser`, so log-out behaviour is unchanged. Finding 1 explains what the helpers really were |
| Plan anchor (W-5) | ✅ kept, with the reason written, and pinned by the guard (the id comes before `planDrawer.openFromRow`) |
| No new page-load fetch (C-8) | ✅ no new effect and no new request. The guard bans the two row-value routes |
| Must-stay-green set | ✅ re-run by SA: **29 suites / 754 tests pass** |
| Logging | ✅ no `console.*` in either touched file |

### Findings

| # | Severity | Finding |
|---|---|---|
| 1 | **Medium** (not S-5's; recorded as **F-23**) | The two helpers were not simply "unused since log-out moved to `signOutUser`". Offir added them in `c1a427e6` (2026-09-22) and **called** them: a 2 s deadline on the audit write, a 5 s deadline on the global sign-out, a `try/finally` so the redirect always ran, and a clear of `sb-*-auth-token` keys matched by shape. That commit was not based on the `31976f13` refactor (2026-09-20, "one sign-out, not three"). The merge kept the refactor's `handleLogout` body and orphaned the helpers. So the fix was lost in a merge; nothing replaced it. Today `signOutUser` has no deadline: a stalled `/api/audit/log` or `auth.signOut` leaves `loggingOut` true, and the dialog cannot close. It also still lists the literal keys `sb-auth-token` / `supabase.auth.token`, which the lost comment says Supabase never writes. And auth-js `_signOut` returns early **without** calling `_removeSession()` on any error other than 401/403/404. So a 5xx on global sign-out leaves this browser's session in place while the page redirects to login. Deleting the dead code in S-5 changes no behaviour and is approved; `c1a427e6` keeps the original for whoever picks up F-23. The fix belongs in `signOutUser` in `lib/client/auth-actions.ts`, which three sign-out controls share. That makes it an auth change, so it takes the full cycle, not the UI short path. Finding 1 supersedes Scope Decision 3's sentence "The behaviour they described lives in `signOutUser`" |
| 2 | Low (optimisation, no action) | The guard's `<ChevronRight\b[^>]*\/>` stops at the first `>`. If a future chevron has an arrow function (`=>`) in its props, the match is cut short and the pin fails with a misleading message. It fails safe (a false failure, never a false pass), so leave it |
| 3 | Low (optimisation, no action) | The inline comment in `handleLogout` says "Nothing it does can trap someone in a session they asked to leave". That is not true for a request that never settles. Correct it in the F-23 slice, where the behaviour changes, not here |

### Rulings on Dev's questions

| # | Ruling |
|---|---|
| Q-1 | **Approved.** Mirror the action-row chevrons too. It is one list with one direction rule, and the helper stops the rows drifting apart again |
| Q-2 | **Approved, in scope.** This is dead code with no caller, on the card S-5 tidies. Subject to finding 1: the deletion stands, the rationale is corrected, and the lost behaviour is tracked as F-23 |
| Q-3 | **Agree, out under C-8.** Each value needs a new page-load request plus a change inside either a money component (`PlanSection`) or a legal one that has just shipped (`MarketingConsentPanel`). Do not schedule either. TL may offer the user the plan name on the row as an optional idea, in one line. Consent status is dropped |
| Q-4 | **Agree.** F-20 is its own small slice with an SA workplan review, because it touches a sent-mail contract, a component that holds a credential, and the C-3 replace semantics. Not urgent: the email still lands on the settings page |
| Q-5 | **Verified, and moved from "record only" to "schedule".** Nothing outside `reports/page.tsx` reads `tab`, and nothing reads `stripe=`. The sender that matters is **Stripe Connect**. `StripeConnectWizard` (rendered in `ConfigurationDialog` and in onboarding at `/onboarding-build`) sends the owner to Stripe. Stripe sends them back to `?tab=payments&stripe=connected` on success, or to `&stripe=refresh` when the link has expired. Either way they land on the plain account page: no confirmation, the Configuration window closed, and on `refresh` no way to retry. An owner who started from onboarding is taken out of it. This is a money setup step on the way to taking payments, so the severity is **Medium**. The `OperationalStatusCard` links matter less: the card is not rendered anywhere today (only a comment in `app/business-os/page.tsx` mentions it). `ProcessFlowSection`'s link is a single link inside a website block. Recommendation: a small scheduled slice, separate from Phases A and B. It points the Stripe Connect return and refresh URLs at a destination that already exists: a `?section=…` link that opens the Configuration window on payments, through the deep-link effect that already handles `?section=business`. On `refresh` it restarts onboarding. Returns that started in onboarding need a product decision. Two questions go to the user, asked in business terms: where should an owner land after Stripe, and should the payments settings open by themselves? |

### Code Approved for QA: Yes

RM may commit and open the PR once QA passes (Phase A pre-authorisation). The only condition for RM is the usual one for a stacked branch. S-5 sits on PR #408, so either merge #408 first, or retarget S-5 to `main` once #408 has merged. Confirm the base before enabling auto-merge.

## QA Testing Report

## QA Report (2026-10-15)

**QA, 2026-10-15**
**Test mode:** full (UI short path)
**Strategy used:** A (Jest source guards and suites), plus 12 new mutations and a code-level audit. D (manual browser check) **not run**: no browser and no account in this session
**Focus:** ui, regression on deep links and log-out
**Skipped:** manual Q1 to Q6 (NOT RUN, see below). `test:bos-entitlements` not required: the diff imports nothing new from the entitlements module
**Input source:** TL prompt
**Verdict: PASS WITH NOTES.** No bug in S-5. Four test gaps (edge cases, Low) and the open SA finding F-23 are noted below. The manual checklist is still owed by a human.

### Baseline and integrity

| Item | Value |
|---|---|
| `page.tsx` SHA-1 (before, after every mutation, at end) | `b6b27086…` throughout |
| `InviteFriendsSection.tsx` SHA-1 | `ab2ebd30…` throughout |
| `git diff --numstat page.tsx` | 22 / 63, before and after QA |
| Requirement numstat | 3 / 0 at QA start, 6 / 1 later. The change came from SA's parallel review (F-20 edit, F-23 row, SA Change History row), not from QA |

### Test Coverage

| Acceptance criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| Must-stay-green set (workplan Test Plan) | ✅ | Pass | Re-run independently: **29 suites / 754 tests pass**, matching Dev and SA |
| Every account-card chevron mirrors in RTL through `rowChevron`, with `aria-hidden` (S-1 SA finding 4, S-4 O-2) | ✅ | Pass | Six `ChevronRight`s on the page, all `className={rowChevron(…)} aria-hidden="true"`. Mutations N1 and N4 caught. Inverting the flip is not caught (gap 1) |
| Plan anchor kept (SA W-5) | ✅ | Pass | N5 (id renamed) caught |
| No new page-load request (C-8) | ✅ | Pass | No new effect in the diff. N6b caught. N6a survives, but it targets a route that does not exist (gap 3) |
| `withDeadline` / `clearSessionKeys` have no callers | ✅ | Pass | `git grep` over tracked files and `grep -r` over `app lib components tests hooks` (untracked included): no code or test references. The only hit is the new guard's own `it.each` list. Docs mention them historically (requirement, S-1/S-2/S-3 workplans). N7 (re-added with a caller) caught |
| Log-out still goes through `signOutUser` | ✅ (code) | Pass | `handleLogout` calls `signOutUser({ scope: 'global', user, method: 'settings' })`. Its body is byte-identical to S-4. Nothing pins it (gap 4) |
| Frozen code byte-identical to `feature/settings-drawer-s4` (C-9, C-13) | ✅ | Pass | A script compared the extracted function bodies with `git show feature/settings-drawer-s4:…/page.tsx`: `loadData`, `persistTimezone`, `saveProfile`, `handleExportData` and `handleLogout` are **IDENTICAL**. The `settings-section-timezone` and `settings-section-consent` anchor counts are unchanged. Diff hunks touch only the import, `rowChevron`, the helper deletion, the plan-anchor comment and the six chevron lines |
| `?section=` deep links (C-2) | ✅ | Pass | The deep-link effect is outside the diff. `plan` → `openPlanFromLink`; `password` → `openPasswordFromLink` unless the account signs in with a provider; `timezone` → `scrollToSection('timezone')`; `business` / `invoice` → `openConfiguration`; `preferences` → ignored by design. All pinned by `settingsDeepLinks.guard` (green). N8 and N9 caught |
| Manual Q1 to Q6 (C-10) | ❌ | NOT RUN | No browser or account. See below |

### Mutations (new, beyond Dev's M1 to M7)

Each mutation was applied by a scratchpad script, ran `npx jest app/business-os/settings` (plus `InviteFriendsSection.render` for N10), and was restored in `finally`. SHA-1 was verified after every one.

| # | Mutation | Result | Failing test |
|---|---|---|---|
| N1 | Password chevron back to a hand-written class | ✅ caught | every ChevronRight takes its class from the helper |
| N2 | `rowChevron` flip inverted: `!isRTL && 'scale-x-[-1]'` | ⚠️ **survived** | (gap 1) |
| N3 | Delete chevron loses its red tone: `rowChevron()` | ⚠️ **survived** | (gap 2) |
| N4 | Log out chevron loses `aria-hidden` | ✅ caught | every ChevronRight … aria-hidden |
| N5 | Plan anchor renamed to `settings-section-plans` | ✅ caught | the plan row keeps id="settings-section-plan" |
| N6a | Effect `fetch('/api/business-os/my-plan')` added | ⚠️ survived | (gap 3: not a real route) |
| N6b | Effect ``fetch(`/api/business-os/entitlements/my-plan`)`` added | ✅ caught | the page does not call …/entitlements/my-plan |
| N7 | `clearSessionKeys` re-added and called in `handleLogout` | ✅ caught | clearSessionKeys is not defined on the page |
| N8 | Frozen timezone anchor id changed to `settings-section-tz` | ✅ caught | C-2: the anchor id is on the page |
| N9 | Frozen `scrollToSection('timezone')` changed to `'tz'` | ✅ caught | C-2: the timezone branch scrolls to it |
| N10 | Invite row flip inverted: `!isRTL &&` | ⚠️ **survived** | (gap 1) |
| N11 | `handleLogout` replaces `signOutUser` with a bare `supabase.auth.signOut()` | ⚠️ **survived** | (gap 4) |

**7 of 12 caught.** Each survivor is a test gap. None is a defect in the S-5 code.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues
None. No new request on page load.

#### Edge Cases (nice to fix; Low, none blocks S-5)
1. **Gap 1: an inverted mirror passes the guard.** `accountCard.guard` matches `isRTL && 'scale-x-[-1]'` as a substring, so `!isRTL && 'scale-x-[-1]'` also matches. The result would be every chevron flipped in English and unflipped in Hebrew, and the guard would stay green. The same applies to the invite-row pin. Fix: anchor the regex with a non-word, non-`!` boundary before `isRTL`, e.g. `(?<![!\w])isRTL && 'scale-x-\[-1\]'`. Manual Q1 would also catch it. Files: `app/business-os/settings/__tests__/accountCard.guard.test.ts`
2. **Gap 2: the Delete chevron's red tone is not pinned.** `rowChevron()` on Delete passes. Cosmetic. Optional pin: the Delete chevron's class is `rowChevron('text-red-400')`
3. **Gap 3: the C-8 ban lists two literal paths.** `/api/business-os/my-plan` (the path in QA's brief) is not a route, so N6a surviving is harmless. The real path is caught. A split-string or a new row-value route would also pass the guard. This is acceptable for a source guard. No action
4. **Gap 4: nothing pins `handleLogout` → `signOutUser`.** No test under `app/business-os/settings` or elsewhere checks that the settings log-out goes through the shared helper. Given **F-23** (SA finding 1: the deadlines and the shape-matched session-key clear were lost in a merge), the F-23 slice should add this pin when it ports the deadlines into `signOutUser`. Not S-5's to fix

#### Noted, already tracked
- **F-23 (Medium, SA):** `signOutUser` has no deadline, and a 5xx on global sign-out can leave the local session in place. Deleting the orphaned helpers changes no behaviour (QA confirmed there are no callers), so S-5 is not affected. The comment in `handleLogout` ("Nothing it does can trap someone…") is inaccurate until F-23 lands (SA finding 3)

### Manual checklist: NOT RUN (a human must check)

Desktop and phone, English and Hebrew, on `/business-os/settings`:

| # | What to check |
|---|---|
| Q1 | English: all account-card chevrons (Plan, Invite friends if shown, Marketing permission, Change password, Export data, Log out, Delete account) point **right**. This would also catch gap 1 |
| Q2 | Hebrew: the same rows' chevrons all point **left**, toward the row's far edge. Delete's chevron is still red |
| Q3 | Export data and Log out swap the chevron for a spinner while working, and it comes back after export |
| Q4 | Plan, Marketing permission and Change password each open their drawer from the row, and focus returns to the row on close. `?section=plan` and `?section=password` open their drawers, and closing removes only `section` from the address |
| Q5 | Log out signs out and lands on the marketing/login destination. Reload: still signed out |
| Q6 | `/business-os/settings#settings-section-plan` loads the page. Scroll is subject to the same full-load limit as F-20 |

### Final Status
- [x] All automated acceptance checks pass. Ready for commit under the Phase A pre-authorisation, on condition that a human runs Q1 to Q6
- [ ] Issues found: Dev must address before commit (none blocking; gaps 1 and 2 are optional guard tightenings)

## Commit Info

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-15 | Workplan and code complete | Dev: scope decisions, `?section=` audit, Q-1 to Q-5, verification and mutations |
| 2026-10-15 | SA code review | APPROVED. 29 suites / 754 tests re-run and passing. Q-1 to Q-4 ruled as Dev recommended (Q-3: plan name may be offered to the user as an optional idea; consent status dropped). Q-5 moved from "record only" to a scheduled slice (Stripe Connect return lands on the plain page, Medium). New finding F-23: the deleted helpers were Offir's log-out deadline and session-key fix from `c1a427e6`, orphaned by a merge with `31976f13`. It is to be ported into `signOutUser` in its own full-cycle slice |
| 2026-10-15 | QA report | PASS WITH NOTES. 29 suites / 754 tests re-run and passing. Frozen bodies are byte-identical to S-4, and the removed helpers have no callers. 12 new mutations: 7 caught, 5 survived. The survivors are test gaps (inverted RTL flip, Delete tone, a non-route fetch, log-out → `signOutUser` unpinned), none a code defect. Manual Q1 to Q6 NOT RUN |
| 2026-10-15 | QA gap closure (TL) | QA gaps 1 and 2 closed in `accountCard.guard.test.ts`: mirror pins now use a `(?<![!\w])isRTL` lookbehind (rejects an inverted `!isRTL`, page and invite row), and a new pin keeps the Delete chevron on `rowChevron('text-red-400')`. Proven: QA mutations N2, N10 and N3 each fail 1 test; page and invite restored to the same SHA-1. Guard now 9 tests. Gaps 3 (fake path) and 4 (log-out via `signOutUser`, goes to F-23) left as QA ruled. |
