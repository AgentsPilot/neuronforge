# Workplan: Business OS Settings Drawer, S-4 (Invite friends drawer)

> **Last Updated**: 2026-10-15

**Developer:** Dev
**Requirement:** [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md) §4.4, §4.5, §4.7, §5 S-4, Q-5 (a), SA-2 (invite row), SA-3 (invite hash), SA-5, conditions C-1, C-4, C-6, C-8, C-9, C-10, C-12, C-13
**Branch:** `feature/settings-drawer-s4` (created by RM from `origin/main` `eb2b9396`, which contains S-1, S-2 and S-3)
**Path:** UI short path, SA-confirmed, with mandatory link-safety checks (SA-5): short workplan, implementation in the same run, then SA code review and QA
**Date:** 2026-10-15
**Status:** Code Complete 2026-10-15 (uncommitted). Awaiting SA code review, then QA

## Overview

S-4 moves **Invite friends** from an expand-in-place row into the settings drawer that S-1 built. `InviteFriendsSection` keeps owning everything: the page-load fetch (eligibility decides whether the row exists), the form draft, the in-flight flags and the one-time link. Only the panel's markup moves into a `SettingsDrawer` rendered as the section's own child. Radix unmounts the drawer content on close, but the state lives one level up in the section, which stays mounted for the page's life, so the link survives close and reopen until the owner leaves the page (Q-5 (a), C-6). The row stays on the page with the anchor id the champion email links to, and now shows "N of M invites left" (already loaded, C-8). The drawer refuses to close while a send or a revoke is in flight (C-4). Revoke confirmation stays inline. No server, database, route or translation change; `page.tsx` is not touched.

**Code verified against:** `components/business-os/settings/InviteFriendsSection.tsx` and `app/business-os/settings/page.tsx` at `eb2b9396`. Locations are by symbol or anchor (C-13).

---

## Analysis Summary

| Area | As found on `eb2b9396` |
|---|---|
| Ownership | `InviteFriendsSection` is self-contained: fetches `GET /api/business-os/friend-invites` on mount, renders `null` unless `eligible: true`, owns its collapsible row (`open` state), not the page's |
| One-time link | `sent: { link, emailSent } \| null` in section state. Shown in a read-only input with Copy and Dismiss. Never re-fetchable (server stores a hash) |
| Draft | `email`, `note`, `inviteLanguage` in section state, so collapsing the row today keeps the draft |
| In flight | `sending` (POST), `revoking` (revoke POST). The submit button is disabled while sending; nothing stops the row collapsing |
| Logging | `createLogger({ module: 'BusinessOsInviteFriendsSection' })`; three `logger.warn({ err })` calls (load, send, copy). No `console.*`. None carries the link |
| Anchor | `id="settings-section-invite-friends"` on the outer div. The champion "invite accepted" email button ("See your invitations") goes to `/business-os/settings#settings-section-invite-friends` (`INVITER_ACTION_PATHS.champion`, pinned by `invite-accepted.test.ts`) |
| Page | One line, `<InviteFriendsSection />`, between the plan and consent rows. No `?section=` branch targets invites, no hash handling anywhere |
| Copy | `inviteFriendsCopy.ts` (en/he/es). The drawer's close label uses the existing `common.close` key like the other three drawers. **No new keys** |

---

## Implementation Approach

1. **Row (always rendered when eligible).** The outer `div id="settings-section-invite-friends"` stays. Its button becomes the drawer opener: `aria-haspopup="dialog"`, `aria-expanded={open}`, a ref used as `returnFocusRef`. The chevron no longer rotates; it keeps its RTL mirror. The row shows the current value, `copy.remaining(remaining, allowance)`, from the page-load fetch (C-8: free, no new request).
2. **Drawer.** `<SettingsDrawer>` is rendered inside that div, as the section's own child (not lifted to the page, no `forceMount`). Title `copy.sectionTitle`, `closeLabel={t('common.close')}`, `testId="settings-invite-drawer"`, `isBusy={sending || revoking !== null}`. Its children are today's panel markup, unchanged except for the wrapper div that held `id={panelId}` (no longer controlled by an `aria-controls`).
3. **State stays where it is (C-6).** `sent`, the draft, `load`, `sending`, `revoking` stay in `InviteFriendsSection`. Closing unmounts only markup.
4. **On a close that gets through:** clear the transient bits that would read wrong on reopen: an open revoke confirmation (`confirming`), `copied`, `sendError`, `revokeError`. **`sent` is kept** (Q-5 (a)); Dismiss is still the only way to clear it before leaving the page.
5. **Busy (C-4).** A send or a revoke in flight passes `isBusy`, so X, Escape and outside press are refused by the wrapper. Revoke is included because its failure message is shown in the drawer, the same reason as for send.
6. **isDirty: not used (recommendation).** The draft lives in section state, as it does today, so closing the drawer loses nothing: reopening shows what was typed. A "Discard your changes?" prompt would ask about a loss that does not happen. A friend's email address is not a credential (unlike the S-2 passwords) and today's collapse already keeps it. If SA prefers "closing clears the draft", that is a one-line reset plus an `isDirty` guard; listed as Q-1.
7. **Hash `#settings-section-invite-friends` (proposal, not built).** The id stays on the always-rendered row, so the anchor target is unchanged by S-4. The email's button says "See your invitations", which the drawer now holds, so the natural behaviour would be to open the drawer when the page is reached with that hash. I have **not** built that: it would be the page's first hash-reading code (a new deep-link mechanism, rule 7), a hash cannot be removed with the C-3 `section`-only replace, and a reload would reopen the drawer. Proposed for SA as Q-2 (S-5 or a follow-up). Also F-20 below: the browser's own hash scroll probably does not land today either.

### Rejected

- Holding `sent` at page level or in a ref outside React: forbidden by C-6.
- `forceMount` on the sheet content to keep the panel alive: forbidden by C-6; would also leave the link in hidden DOM.
- A new `InviteFriendsDrawer.tsx` file holding the form state (S-2/S-3 shape): that file's state would unmount with the content and lose the link. The section is the row-owner, so it stays the state owner.

---

## Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `components/business-os/settings/InviteFriendsSection.tsx` | modify | Row becomes the drawer opener with its value; panel moves into `SettingsDrawer`; busy; reset on close; header comment |
| `components/business-os/settings/__tests__/InviteFriendsSection.render.test.tsx` | modify (C-6, C-12) | `openSection` opens the drawer by the row; the Hebrew and P-5b.2 tests open it the same way; entitlements-import test kept unchanged |
| `components/business-os/settings/__tests__/InviteFriendsSection.linkSafety.test.tsx` | create | The mandatory link-safety checks (below) |
| `app/business-os/settings/page.tsx` | **not touched** | The section is still one line on the page |

---

## Task List

- ✅ T1. Read requirement, SA conditions, S-1..S-3 code and tests; verify against `eb2b9396`.
- ✅ T2. Workplan (this file).
- ✅ T3. `InviteFriendsSection`: opener row + row value, `SettingsDrawer` child, `isBusy`, close resets, comment.
- ✅ T4. Update `InviteFriendsSection.render.test.tsx` (opener only; assertions unchanged).
- ✅ T5. New `InviteFriendsSection.linkSafety.test.tsx`.
- ✅ T6. Verification and mutations (Implementation Notes).
- ✅ T7. Requirement: S-4 progress line + Change History row.

---

## Test Plan

### New: `InviteFriendsSection.linkSafety.test.tsx`

Real `SettingsDrawer` and Radix sheet; `fetch` stubbed; the logger mocked to record every call; `console.*` spied.

| # | Check |
|---|---|
| L-1 | Page load: the GET fires without opening anything; the row shows "3 of 7 invites left"; the drawer is closed; the opener has `aria-haspopup="dialog"` and `aria-expanded="false"` |
| L-2 | Anchor: `#settings-section-invite-friends` exists while the drawer is closed, and contains the opener row |
| L-3 | Send, close with the X, reopen from the row: the same link is shown |
| L-4 | Send, close with Escape, reopen: link still shown. Closed drawer: the link is **not in the DOM** (no hidden copy, no `forceMount`) |
| L-5 | Link never in the address: `window.location.href` unchanged, `history.pushState` / `replaceState` never called |
| L-6 | Link never in browser storage: `Storage.prototype.setItem` never called; `localStorage` / `sessionStorage` empty |
| L-7 | Link never logged: across send, copy failure (clipboard rejects) and close, no recorded logger call and no `console.*` call contains the link or its token |
| L-8 | No close while sending: with the POST held, X is disabled, X click / Escape / outside press keep the drawer open; after the answer the X closes it |
| L-9 | No close while revoking (revoke POST held) |
| L-10 | Close resets an open revoke confirmation and a stale error, but not the link |
| L-11 | Dismiss clears the link; reopen shows no link |
| L-12 | Draft survives close (no isDirty prompt): typed email still there on reopen; closing with a draft does not show a discard prompt |
| L-13 | Focus returns to the opener row on close |
| L-14 | Source guard: `InviteFriendsSection.tsx` has no `forceMount`, `localStorage`, `sessionStorage`, `history.`, `useRouter`, `console.`; no logger call names `sent` or `link` |

### Edited (C-12)

`InviteFriendsSection.render.test.tsx`: `openSection` and the two inline openers click the row button (same accessible name). The ineligible cases, the copy tests and "imports nothing from the entitlements module" are unchanged.

### Must stay green

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

The S-3 set unchanged (it already includes the invite tests and `invite-accepted.test.ts`), plus the new suite through the folder path. `npm run test:bos-entitlements` is not required: nothing imports from the entitlements module.

---

## Manual QA Checklist (C-10)

Desktop and phone, English and Hebrew, on an account that is an in-force champion with invites left:

| # | Check |
|---|---|
| Q1 | Row shows "N of M invites left" without opening; chevron mirrored in Hebrew |
| Q2 | Row opens the drawer from the reading end (right in en/es, left in he); full width on a phone |
| Q3 | Native language `<select>` inside the drawer opens above the sheet |
| Q4 | Send an invite: link shown; close (X, Escape, overlay); reopen: same link; Copy works |
| Q5 | While "Sending…": X greyed, Escape and overlay do nothing |
| Q6 | Reload the page: the link is gone (expected, Q-5 (a)); the URL never showed it; DevTools Application tab: nothing in local or session storage |
| Q7 | Revoke → inline confirm → Yes: list refreshes inside the drawer; drawer cannot close while the revoke is in flight |
| Q8 | Focus returns to the row on close; row announces a dialog (`aria-haspopup`) |
| Q9 | Open `/business-os/settings#settings-section-invite-friends` (the email link): note whether the page scrolls to the row (see F-20); the drawer does **not** open (Q-2) |
| Q10 | Non-champion account: no row at all |

---

## Open Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | Should closing the drawer keep the typed draft (no `isDirty`), or clear it and guard with `isDirty`? | **Keep the draft, no guard.** Today's behaviour; nothing is lost so nothing to confirm; a friend's email is not a credential |
| Q-2 | Should `#settings-section-invite-friends` open the drawer? The email button says "See your invitations" | **Yes eventually, not in S-4.** It needs the page's first hash reader (new mechanism, rule 7) and a ruling on reload behaviour. Suggest S-5, where every deep link is re-checked anyway |
| Q-3 | `isBusy` also during a revoke, not only a send? | **Yes**, built. The revoke's failure message shows in the drawer, same reason as C-4 |
| Q-4 | Row shows "N of M invites left" (no new request) | Built per C-8; S-5 aligns the visual style of all row values |

### New finding

- **F-20 (pre-existing, not fixed).** The champion email's hash probably does not land on a full page load today: the page renders a spinner until `loadData` finishes, and the invite row renders only after its own fetch, so the element does not exist when the browser applies the hash. S-4 neither fixes nor worsens this. It belongs with Q-2.

---

## Implementation Notes

### Files changed

| File | Change |
|---|---|
| `components/business-os/settings/InviteFriendsSection.tsx` | +71 / −19. Row button → drawer opener (`ref`, `aria-haspopup="dialog"`, `aria-expanded`, row value, non-rotating chevron with the RTL mirror kept, via `cn()`); panel markup moved, unchanged, into `<SettingsDrawer testId="settings-invite-drawer">` rendered inside the anchored div; `isBusy={sending \|\| revoking !== null}`; `handleOpenChange` resets `confirming`, `copied`, `sendError`, `revokeError` on close, never `sent`; header comment rewritten for C-6 |
| `components/business-os/settings/__tests__/InviteFriendsSection.render.test.tsx` | +17 / −5. Opener only: `findRow(title)` matches the row by the start of its name (the name now ends with "N left"); `openSection` returns the drawer element as `section` (the panel is portalled out of the row). Every assertion unchanged, the entitlements-import test included |
| `components/business-os/settings/__tests__/InviteFriendsSection.linkSafety.test.tsx` | New, 15 tests (L-1 to L-14b + "not lifted to the page") |
| `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` | S-4 progress line + Change History row (Edit / append only) |
| `app/business-os/settings/page.tsx` | Not touched |

**Why lines were deleted (no deletion-only diff):** in `InviteFriendsSection.tsx`, the old header paragraphs (replaced by the C-6 block), the `useState`-only import line (now with `useRef`), the `useLanguage` destructure (now with `t`), `panelId` and `aria-controls` (no in-place panel to control), the toggle `onClick`, the old row class (gained `gap-3`), the rotating chevron (now non-rotating, wrapped with the row value), and `{open && (` / `)}` (replaced by `<SettingsDrawer>` / `</SettingsDrawer>`). In the render test, the old `openSection` body and the two inline `findByRole(..., { name: title })` openers.

### Deviations from the workplan

None in behaviour. L-10 was split into L-10 (revoke confirmation reset, link kept) and L-10b (refusal message reset), and a source test pins that the drawer is rendered by the section and not by `page.tsx`.

### Verification results

| Check | Result |
|---|---|
| New suite `InviteFriendsSection.linkSafety.test.tsx` | 15 / 15 pass |
| `InviteFriendsSection.render.test.tsx` | 23 / 23 pass |
| Must-stay-green set (command above) | **26 suites, 717 tests, all pass** (S-3 set + the new suite) |
| `invite-accepted.test.ts` | Pass (in the set) |
| `npm run typecheck:bos-llm` | Passed: 532 files, 28 errors, **0 new** (the unrelated `app/api/onboarding/build/route.ts` baseline entry reported as fixed, as in S-3) |
| Full `tsc --noEmit` (12 GB heap) | 1855 errors repo-wide, same count as the S-3 record. **0** in any touched file |
| eslint on the three touched code files | 0 errors, 0 warnings |
| `npm run lint:hooks` | Exit 0 |
| `git diff --numstat` | 3 tracked files, +90 / −24; 2 new files (test 381 lines, this workplan) |

### Mutation run

Each mutation: `InviteFriendsSection.tsx` backed up to the scratchpad, mutated by a script that refuses a find string that does not match exactly once, the two invite suites run (38 tests), the backup copied back and its SHA-1 compared with the original (`ab2ebd30…`). All 8 restored with a matching SHA-1. No `git stash`, no `git checkout`. (A first run of the script crashed on a console-encoding error after applying M1 and before restoring; the file was restored by hand from the backup and its SHA-1 checked before the corrected script, now with `try/finally`, ran all eight.)

| # | Mutation | Result | Caught by |
|---|---|---|---|
| M1 | A close also clears `sent` | Caught (3) | L-3, L-4, L-10 |
| M2 | `isBusy` ignores `sending` | Caught (1) | L-8 |
| M3 | `isBusy` ignores `revoking` | Caught (1) | L-9 |
| M4 | Anchor id removed from the row | Caught (1) | L-2 |
| M5 | Link written to `sessionStorage` after a send | Caught (3) | L-3, L-5/6/7, L-14 |
| M6 | Link added to the copy-failure log context | Caught (2) | L-5/6/7, L-14b |
| M7 | A close keeps an open revoke confirmation | Caught (1) | L-10 |
| M8 | Row value removed | Caught (1) | L-1 |

### Observations for SA (not changed)

- **O-1 (pre-existing).** `handleSend` clears `sent` at the start of every send, so sending a second invite replaces the first link, and a second send that is refused still clears the first link. It was like this before S-4 and the owner can still revoke and re-invite. Mentioned because it is the one way the link disappears without Dismiss.
- **O-2.** The row's chevron is mirrored in Hebrew, the other settings rows' chevrons are not. Pre-existing on this row; S-5 aligns rows.

---

## SA Review Notes

## SA Code Review (2026-10-15)

**Reviewed by SA, 2026-10-15.** Diff read in full: `InviteFriendsSection.tsx` (+71/−19, whole file read), the render-test diff, the new `InviteFriendsSection.linkSafety.test.tsx`, the requirement edits. Checked against `SettingsDrawer.tsx` and the three S-1..S-3 openers in `page.tsx`.

**Verdict: APPROVED WITH CONDITIONS.** No code change required. The single condition is for RM (finding 1). Code approved for QA: **Yes**.

### C-6 and the link-safety checks (SA-5)

| Check | Result |
|---|---|
| Link held in the row-owning `InviteFriendsSection` state only; drawer rendered as its child; not lifted to `page.tsx` | ✅ (`sent` state; source test pins `<SettingsDrawer … testId="settings-invite-drawer">` in the section and its absence from `page.tsx`) |
| No `forceMount`; a closed drawer keeps no copy of the link in the DOM | ✅ (L-4 checks `document.body.innerHTML` for the token; L-14 source guard) |
| Never in the URL, browser storage, logs or console | ✅ No router, no `history.`, no storage, no `console.*`; the three `logger.warn` calls carry only `{ err: error }` (L-5/6/7 runtime, L-14/L-14b source). The copy-failure path, the one log while the link is in hand, logs the clipboard error only |
| `id="settings-section-invite-friends"` on the always-rendered row, not in the drawer | ✅ (L-2, mutation M4) |
| Page-load fetch kept (eligibility decides the row) | ✅ `useEffect` → `refresh()` on mount; L-1 asserts one GET with the drawer closed |
| Revoke confirmation inline | ✅ Unchanged markup inside the drawer |
| `InviteFriendsSection.render.test.tsx` updated for the opener only; the entitlements-import test kept | ✅ Opener helpers only; no assertion changed |
| `isBusy` covers send and revoke (Dev Q-3) | ✅ `sending \|\| revoking !== null`; send stays busy through its post-send reload (cleared in `finally` after `await refresh()`) (L-8, L-9, M2, M3) |
| Close clears revoke-confirm, Copied, send and revoke errors; never the link or the draft | ✅ `handleOpenChange` runs only on a close the wrapper let through (L-10, L-10b, L-12, M1, M7) |
| No `isDirty` (Dev Q-1) | ✅ |
| Focus return, `aria-haspopup="dialog"`, `aria-expanded` | ✅ `returnFocusRef={rowRef}`, same shape as the plan, consent and password rows (L-13, L-1, L-2) |
| C-8: "N of M left" from the page-load answer, no new request | ✅ |
| Hooks order | ✅ `handleOpenChange` (`useCallback`) sits above the `load.kind !== 'ready'` early return |
| Entitlements imports | None (no `business-os-entitlements` checklist needed) |
| Logging standard | File already Pino, 0 `console.*` |

**Re-run:** the must-stay-green set from the Test Plan, 26 suites / 717 tests, all pass (SA run, 2026-10-15). The mutation table (M1 to M8, all caught, file restored by SHA-1) is accepted as evidence that the suite guards the C-6 rules.

### Code Review Comments

1. **Branch predates #406 (RM condition).** `origin/main` has moved to `53aefe89` (#406, F-18), which edits `BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` in the same three places this slice does: the progress lines in the header, the §7 table after F-18 (#406 adds F-19, this review adds F-20 and F-21), and the Change History tail. No code overlap: #406 does not touch any invite file. **RM merges `origin/main` into the branch before opening the PR, keeps both sides (F-19 above F-20), and re-runs the must-stay-green set.** No `git stash`. — Priority: Medium (process; doc-only)
2. **F-21 (pre-existing, recorded in §7, not a condition).** The link can disappear without Dismiss: `handleSend` clears `sent` at the start of every send, so a refused second send wipes the first link (Dev O-1); and if the reload after a successful send fails or answers not eligible, `refresh()` sets `hidden`, so the row and the open drawer unmount with the link inside. Both were true before S-4. Recovery is revoke and re-invite. Fix later, client-only (replace `sent` only when a new link arrives; keep the last summary on a failed reload, the F-17 rule). — Priority: Low
3. **L-9 does not try an outside press during a revoke** (L-8 does during a send). The refusal is the wrapper's single `isBusy` gate, already proven by L-8 and the S-1 wrapper tests, so this is not a gap in behaviour. Optional one-line addition if the file is touched again. — Priority: Low
4. **Revoke releases `isBusy` before its list reload.** `setRevoking(null)` runs before `await refresh()`, so the drawer may close while the reload is in flight. Harmless: the answer lands in section state (the row value updates). Unlike a send, there is nothing to show that would be lost. No change. — Priority: Info

### Rulings

- **Dev Q-1 (draft and `isDirty`): approved as built.** The draft lives in section state, so a close loses nothing, and a friend's email is not a credential. Do not add `isDirty`.
- **Dev Q-2 (should the hash open the drawer): not in S-4.** A page-level hash reader would be a new deep-link mechanism (rule 7), and a hash is not removed by the C-3 `section`-only replace, so a reload would reopen the drawer. Preferred direction, recorded as F-20: point the email at `?section=invite-friends`, handled by the existing deep-link effect with the C-3 replace; the page passes an open request down to `InviteFriendsSection`, which honours it once its own fetch says eligible; the hash id stays on the row so emails already sent still land on the page. It changes `INVITER_ACTION_PATHS.champion` and the `invite-accepted.test.ts` pin, so it is its own small slice with an SA workplan review, or part of S-5 only if the S-5 workplan lists it explicitly.
- **Dev Q-3 (`isBusy` during revoke): approved.**
- **Dev Q-4 (row value): approved.** Visual alignment of row values and chevrons (O-2) belongs to S-5.
- **Item 4 / hash scroll: real, recorded as F-20** (renumbered from the Dev's "F-19", which is already the picker delete-confirm finding from the F-18 cycle; this workplan's references updated). Plausible from the code (spinner until `loadData`, then the section's own fetch); QA Q9 records the actual browser behaviour.
- **Dev O-1: recorded as F-21**, extended with the failed-reload path (comment 2).

### Optimisation Suggestions

- O-2 (the invite chevron is the only mirrored one in Hebrew): settle in S-5 when the rows are aligned.

### Code Approved for QA: Yes

## QA Report (2026-10-15)

**QA — 2026-10-15**
**Test mode:** full (code level); manual browser checks NOT RUN
**Strategy used:** A (Jest, real `SettingsDrawer` + Radix sheet) + mutation testing. D (manual browser) was not possible in this session: no browser and no champion account
**Focus:** ui, security (the one-time link)
**Skipped:** Q1–Q10 manual checks (see NOT RUN below)
**Input source:** prompt keywords (TL trigger)

**Verdict: PASS WITH NOTES.** No bug in the S-4 code. One test gap (TG-1: a module-level copy of the link is not caught by the suite) and the pre-existing F-21 confirmed by a probe. The manual checks Q1–Q10 are still owed.

### Test Coverage

| Acceptance criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| Must-stay-green set (workplan command), incl. `invite-accepted.test.ts` | ✅ | Pass | Re-run independently: **26 suites, 717 tests, all pass** |
| Happy path: open → send → link → close → reopen → link still there → Dismiss → reopen shows no link (Q-5 (a), C-6) | ✅ | Pass | L-3, L-11, plus QA probe P1 |
| A fresh mount (leaving the page and coming back) shows no link | ✅ | Pass | QA probe P2. Not pinned in the committed suite, see TG-1 |
| Send fails (refused, or a network error) → error shown inside the drawer, drawer stays open | ✅ | Pass | QA probes P3, P3b; L-10b covers the reset on close |
| Revoke confirmation reset by a close; the link kept | ✅ | Pass | L-10 |
| C-4: while sending, X / Escape / outside press refused | ✅ | Pass | L-8 |
| C-4: while revoking, X / Escape / outside press refused | ✅ | Pass | L-9 (X, Escape); outside press during a revoke checked by QA probe P4 (closes SA comment 3 at code level) |
| Link never in the address, storage, a log or the console | ✅ | Pass | L-5/6/7, L-14, L-14b; mutations N2, N12 caught |
| Closed drawer keeps no hidden copy in the DOM (no `forceMount`) | ✅ | Pass | L-4; mutation N3 caught |
| Champion email anchor `#settings-section-invite-friends` on the always-rendered row | ✅ | Pass | L-2; mutation N11 caught. `INVITER_ACTION_PATHS.champion` unchanged (`lib/business-os/invites/inviterNotification.ts`), `invite-accepted.test.ts` green |
| The hash does NOT open the drawer (Q-2 / F-20, not expected in S-4) | ✅ | Pass (as designed) | QA probe P5: with `location.hash` set to the anchor, the row renders and the drawer stays closed |
| C-8: row value from the page-load fetch; no extra GET on open/close | ✅ | Pass | L-1; QA probe P6 (1 GET across open, close, reopen); mutation N10 caught |
| Focus returns to the row; `aria-haspopup="dialog"`, `aria-expanded` | ✅ | Pass | L-1, L-2, L-13; mutations N6, N6b, N7, N8 caught |
| Draft kept on close, no discard prompt (Q-1) | ✅ | Pass | L-12; mutation N5 caught |
| Q1–Q10 manual browser checks (desktop + phone, en + he) | ❌ | NOT RUN | No browser or champion account in this session |

### Mutation run (QA, beyond Dev's M1–M8)

Method: both target files backed up to the QA scratchpad; a Node script (ASCII-only output, so no console-encoding crash) applied each mutation with exact-once find strings, ran the two invite suites (38 tests; plus the three `SettingsDrawer` suites, 98 tests in total, for mutations in the wrapper), and restored from the backup in `finally`, checking SHA-1 each time. Baselines: `InviteFriendsSection.tsx` `ab2ebd30…`, `SettingsDrawer.tsx` `9e98cc46…`. All 14 restored with matching SHA-1; `git diff --numstat` for the code files identical before and after. No `git stash`, no `git checkout`.

| # | Mutation | Result | Caught by |
|---|---|---|---|
| N1 | Link also kept in a module-level variable that seeds the next mount (survives unmount) | **SURVIVED** | nothing (TG-1) |
| N2 | Link written to `window.location.hash` on send | Caught (2) | L-3, L-5/6/7 |
| N3 | Hidden `<input>` holding the link on the always-mounted row (the effect of `forceMount`) | Caught (2) | L-4, L-10 |
| N4 | Dismiss no longer clears the link | Caught (2) | L-11, render "sending" test |
| N5 | Draft cleared on close | Caught (1) | L-12 |
| N6 | `returnFocusRef` removed | Caught (1) | L-13 |
| N6b | Wrapper blurs instead of focusing the return target | Caught (4) | L-13 + 3 `SettingsDrawer` tests |
| N7 | `aria-haspopup` removed | Caught (1) | L-1 |
| N8 | `aria-expanded` hard-coded `false` | Caught (1) | L-2 |
| N9 | Busy refusal only on the X (gate + Escape + outside guards removed in the wrapper) | Caught (8) | L-8, L-9 + 6 wrapper tests |
| N10 | List re-fetched on every drawer open | Caught (3) | render tests' GET counts (not L-1) |
| N11 | Anchor id moved inside the drawer | Caught (1) | L-2 |
| N12 | Link put in the copy-failure log **message** string (not the context object) | Caught (1) | L-5/6/7 (runtime) |
| N13 | Outside press let through while busy (wrapper) | Caught (5) | L-8 + 4 wrapper tests |

13 of 14 caught. Dev's M1–M8 not re-run (SA accepted them as evidence).

### Issues Found

#### Bugs (must fix before commit)

None.

#### Test gaps (should fix)

1. **TG-1: nothing pins "a fresh mount starts with no link"** — File: `components/business-os/settings/__tests__/InviteFriendsSection.linkSafety.test.tsx` — Severity: Medium (test only; the code is correct today, QA probe P2 passes)
   - Mutation N1 (a module-level `let` holding the link, used as the initial `sent` state) passes all 38 tests. That is the "outside React state" storage C-6 forbids, and it would let the link survive a client-side navigation away and back, against Q-5 (a).
   - Suggested: a test that sends, `unmount()`s, renders a new `<InviteFriendsSection />`, opens it and expects no link. Optionally extend L-14 to forbid a module-level `let` in the file.

#### Edge cases (nice to fix)

1. **F-21 confirmed by probe (pre-existing, present at `eb2b9396`; already recorded by SA).** QA probe P7: send succeeds (POST 201 with the link), the follow-up GET answers 500 → the section renders `null`: `linkVisible=false drawer=false row=false`. The drawer goes away while `sending` is still true, so the C-4 refusal is sidestepped by the unmount. Severity Low/Medium; recovery is revoke and re-invite. S-4 neither causes nor worsens it.
2. **O-1 / F-21 (Dev, SA):** a second send clears the first link at its start, even if refused. Pre-existing.

### NOT RUN (a human must check in a browser, on an in-force champion account with invites left; desktop and phone; English and Hebrew)

| # | What to check |
|---|---|
| Q1 | Row shows "N of M invites left" without opening; chevron mirrored in Hebrew |
| Q2 | Drawer opens from the reading end (right in en, left in he); full width on a phone |
| Q3 | The native language `<select>` opens above the sheet |
| Q4 | Send: link shown; close with X, Escape and the overlay; reopen each time: same link; Copy works |
| Q5 | During "Sending…": X greyed, Escape and overlay do nothing |
| Q6 | Reload: link gone; the URL never showed it; DevTools Application tab: nothing in local/session storage |
| Q7 | Revoke → inline confirm → Yes: list refreshes inside the drawer; drawer cannot close while in flight |
| Q8 | Focus returns to the row on close; a screen reader announces the row as opening a dialog |
| Q9 | Open `/business-os/settings#settings-section-invite-friends`: record whether it scrolls to the row (F-20); the drawer must NOT open |
| Q10 | Non-champion account: no row at all |

### Test Outputs / Logs

```text
Must-stay-green: Test Suites: 26 passed, 26 total / Tests: 717 passed, 717 total
QA probe (temporary test file in the worktree, deleted right after the run; git status unchanged):
  P1 happy path ............................ pass
  P2 fresh mount shows no link ............. pass
  P3 send refused -> error in drawer ....... pass
  P3b network error -> error in drawer ..... pass
  P4 outside press refused while revoking .. pass
  P5 hash does not open the drawer ......... pass (as designed for S-4)
  P6 no extra GET on open/close ............ pass
  P7 send ok, refresh fails ................ P7RESULT linkVisible=false drawer=false row=false  (F-21)
Mutations: 13/14 caught (N1 survived); every restore SHA-1 OK
```

### Final Status

- [x] All automated acceptance checks pass; no bug in the S-4 code
- [ ] TG-1 test should be added (Dev, small); F-21 stays a recorded follow-up
- [ ] Manual checks Q1–Q10 owed by a human before the slice is called verified

### QA gap closure (2026-10-15)

TG-1 closed, test files only (no production code touched; `InviteFriendsSection.tsx` SHA-1 `ab2ebd30c709c7be3dbfb216adb0d3abcda83a94` and numstat +71/−19 before and after).

| Added to `InviteFriendsSection.linkSafety.test.tsx` | What it pins |
|---|---|
| L-15 | Send → link shown → `unmount()` → a new `<InviteFriendsSection />` with fresh fetch answers → open the drawer → no link, token absent from the DOM, no POST made |
| L-14c | Comment-stripped source: no top-level `let`/`var`, and no top-level `const` bound to an object, array, `new …` or `createRef` (a module-level holder the link could outlive a mount in) |

| Check | Result |
|---|---|
| Mutation N1 (QA script `mutate.js N1`) | **CAUGHT** by both L-15 and L-14c (2 failed / 40); restore SHA-1 OK |
| `InviteFriendsSection.linkSafety.test.tsx` | 17 / 17 pass |
| Must-stay-green set | **26 suites, 719 tests, all pass** (717 + the two new tests) |
| eslint on the test file | Clean |

## Commit Info

_(RM)_

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-15 | Created | S-4 short workplan; implementation in the same run |
| 2026-10-15 | SA code review | APPROVED WITH CONDITIONS (RM merges `origin/main` #406 and resolves the requirement's doc-only conflicts). C-6 link-safety verified; 26 suites / 717 tests re-run green. Q-1 to Q-4 ruled. Dev's "F-19" renumbered F-20 throughout; F-20 and F-21 (from O-1) recorded in the requirement §7 |
| 2026-10-15 | QA report | PASS WITH NOTES: 26 suites / 717 tests re-run green; 13/14 new mutations caught (N1, a module-level copy of the link, survives: test gap TG-1); F-21 confirmed by probe; Q1–Q10 manual NOT RUN |
| 2026-10-15 | QA gap closure | TG-1 closed (tests only): L-15 (fresh mount shows no link) + L-14c (no module-level holder); N1 now caught by both; 26 suites / 719 tests green |
