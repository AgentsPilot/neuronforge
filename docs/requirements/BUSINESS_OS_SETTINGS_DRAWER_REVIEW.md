# Review: Business OS Settings Page and the Drawer Pattern

> **Last Updated**: 2026-10-17

**Created by:** BA
**Date:** 2026-10-14
**Status (2026-10-15):** **Phase A COMPLETE** — S-1 to S-5 and F-18 all merged to `main` (§0). **Phase B (D-1 to D-4): user go-ahead given 2026-10-15 — starting with D-1.** **Phase C (performance improvements) PARKED** (§0.6). Full handover in [§0](#0-current-status-and-handover-2026-10-15). Per-slice history is in each workplan and in the Change History below.
**Page reviewed:** `app/business-os/settings/page.tsx` (1,300 lines, read in full on `main` 2026-10-14) and the components it renders.

---

## 0. Current status and handover (2026-10-15)

### 0.1 Phase A — UI drawers: ✅ COMPLETE

| Slice | What | PR | Merge commit | Workplan |
|---|---|---|---|---|
| S-1 | Shared `SettingsDrawer` + Plan drawer | #388 | `936dfd04` | [S-1](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_S1_WORKPLAN.md) |
| S-2 | Change password drawer + `useLinkOpenedDrawer` hook | #389 | `5d7a0586` | [S-2](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_S2_WORKPLAN.md) |
| S-3 | Marketing permission drawer + discard guard (C-5) + F-17 fix | #397 | `dc9610f2` | [S-3](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_S3_WORKPLAN.md) |
| F-18 | Address picker no longer overwrites the stored marketing postal line (live bug since #229, 2026-10-06) | #406 | `53aefe89` | [F-18](/docs/workplans/BUSINESS_OS_SETTINGS_CONSENT_ADDRESS_PICKER_F18_WORKPLAN.md) |
| S-4 | Invite friends drawer (one-time link safety) | #408 | `14f75c88` | [S-4](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_S4_WORKPLAN.md) |
| S-5 | Account card tidy (RTL chevrons, dead log-out helpers removed) | #409 | `ea2a9bf3` | [S-5](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_S5_WORKPLAN.md) |

Every slice: SA approved, QA PASS WITH NOTES, QA test gaps closed and proven by mutation. Phase A ran under the user's fast-track (RM commits after SA approval; PRs set to `gh pr merge --auto --merge` + Auto-fix). **That fast-track and auto-merge applied to Phase A only — Phase B goes back to the standard flow (user sees the diff before RM commits; user merges) unless the user says otherwise.**

### 0.2 Phase B — direct DB calls to server: 🟡 STARTED 2026-10-15 (user go-ahead; D-1 first)

Order and conditions are in §9 and the SA Review (C-13 to C-26, re-sequencing amendment of C-24). Every D-slice is **full cycle** (Dev workplan → SA workplan review → Dev → SA code review + QA → user diff → RM), one at a time from fresh `main`, never two open PRs on `page.tsx`.

| Slice | What | Unblocked? |
|---|---|---|
| D-1 | Timezone write behind `PATCH /api/business-os/preferences` `{ timezone }` (C-14 to C-16) | ✅ F-13 fix (#387) merged |
| D-2 | `/api/business-os/account-profile` GET + PATCH (C-17, C-18) | ✅ |
| D-3 + L-1 | Avatar upload/delete server-side `/api/user/avatar` + hook logging (C-19 to C-21) | ✅ |
| D-4 | Remove the page's `supabase` import + Jest guard (C-22) | ✅ DE-0a merged (`f7301fad`) |
| L-2 | `CRMContactDrawerV2.tsx` 18 `console.*` → Pino (C-26) | any time |

Note for D-slices: Phase A moved lines in `page.tsx` — find code by symbol, not line number (C-13), and record the `page.tsx` commit checked against.

**D-1 progress (2026-10-15):** Dev workplan written ([D-1 workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_D1_WORKPLAN.md)) on `feature/settings-drawer-d1-timezone` from `origin/main` `70b609f2`, verified against `page.tsx` at `b848e267`. No code yet. **SA workplan review 2026-10-15: APPROVED WITH CONDITIONS** (SA-D1-1 to SA-D1-9 in the workplan). C-14's regex is amended to require a leading letter (`^[A-Za-z][A-Za-z0-9_+\-/]*$`, blocks offset IDs like `+05`); aliases and lowercase are stored verbatim, no canonicalisation. Implementation may start; **merge is gated on the user's read-only live checks** (revised L-1 unique key or index plus duplicate rows, L-2 columns, L-3 triggers, new L-4 stored zones the route would refuse; SQL in the workplan). New finding **F-24** (Medium, pre-existing, fix in D-2): the profile card's Save re-sends the stored zone and stamps `timezone_confirmed_at`, answering the timezone question on the owner's behalf; TL to add it to §7 and the D-2 scope. **Live checks SA-D1-7, 2026-10-15** (read-only, run by TL at the user's request): L-1a, L-1b, L-2, L-3, L-4 all PASS. `user_preferences.user_id` has a unique index; there are no duplicate rows; only `id` and `user_id` are NOT NULL; the one trigger sets only `updated_at`; no stored zone would be refused. **The merge gate is met.** **Code complete 2026-10-15, not committed:** the `{ timezone }` route member, `saveConfirmedTimezone`, `updateTimezoneMirror`, `isValidTimezone`, and on the page `persistTimezone` and the timezone half of `loadData`. Tests are green and all 19 mutations were killed (details in the workplan). Next: SA code review and QA, then the user sees the diff.

**D-2 progress (2026-10-15):** Dev workplan written ([D-2 workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_D2_WORKPLAN.md)) on `feature/settings-drawer-d2-account-profile`, built from the D-1 branch at `06ceab3b` (PR #421, open); `origin/main` is merged in once #421 lands. Verified against `page.tsx` at `e0c49f1f`. No code yet. Plan: `GET` + strict `PATCH { full_name?, job_title? }` on `/api/business-os/account-profile`; `UserProfileRepository.findSettingsCard` / `saveSettingsCard` (allow-list, `id` last, upsert on `id`); CR-1 `safeDbError` across the repository; the page's profile read and Save go through the route. **F-24 fix:** the card's Save never sends a timezone or reaches the preferences route; the timezone row still saves through `persistTimezone` (recommended: the timezone row no longer re-writes the card, which amends one sentence of C-18; SA decides, Q-1). Read-only live checks L-1 to L-5 (longest stored name and job title, column types, accounts without a profile row, triggers, constraints) are owed by the user before merge; the length limits are set from L-1. Questions Q-1 to Q-9 for SA. Next: SA workplan review. **Code complete 2026-10-15, not committed** (on `origin/main` `8c94767b`, after D-1 #421 merged): the route (`GET` + strict `PATCH`, limits 120 / 100 final), `findSettingsCard` / `saveSettingsCard`, CR-1 narrowed to `findById`, `updateTimezoneMirror` and the two new methods (CR-1b, the three admin / export reads, is a Low follow-up), and on the page the profile half of `loadData` and `saveProfile`. **F-24 fixed** with option (b): the card's Save PATCHes `{ full_name }` only and never calls `persistTimezone`; the timezone row calls only `persistTimezone` and returns. `persistTimezone` is unchanged. Tests are green, `typecheck:bos-llm` has 0 new errors, and all 29 mutations were killed (details in the workplan). Next: SA code review and QA, then the user sees the diff.

**D-3 + L-1 progress (2026-10-16):** **Status: code complete, SA code review APPROVED, QA PASS WITH NOTES (test gaps E-1..E-3 closed by Dev the same day). Committed + auto-merge (manual checks waived pre-merge by the user 2026-10-16; user tests after deploy; D-3a applied by TL only after those post-deploy checks incl. Q13 pass). D-3a (bucket hardening, F-26) is not part of the D-3 PR.** Dev workplan written ([D-3 workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_D3_WORKPLAN.md)) on `feature/settings-drawer-d3-avatar`, built from the D-2 branch at `9d0ab074` (PR #425, open); `origin/main` is merged in once #425 lands. Plan: `POST` (multipart, one `file` field) and `DELETE /api/user/avatar`. The type is decided by the file's first bytes (PNG, JPEG, WebP, GIF; SVG refused, F-16), the limit is 4 MB (413), and new files go to `<userId>/<uuid>.<ext>`. Storage lives in a `'server-only'` `AvatarService`, and the table goes through `UserProfileRepository.findAvatarUrl` / `setAvatarUrl` (an upsert, so it works for the account with no `profiles` row, SA-D2-8) / `clearAvatarUrl`. The C-20 ownership check accepts only our origin and bucket plus `<userId>/<uuid>.<ext>` or the legacy `<userId>-<ts>.<ext>`, so Remove now deletes legacy root files (F-8) and never touches external or other-account URLs. The hook keeps its public shape, has no Supabase import, and its 3 `console.*` move to Pino (L-1). The three consumers are unchanged (`AvatarUpload.tsx` changes only if SA allows narrowing `accept`, Q-6). Read-only live checks LC-1 to LC-7 are owed by TL before merge: bucket public / size / MIME settings, storage policies, object layout and types, stored URL shapes and origin, `storage.objects` triggers, and an orphan count. Questions Q-1 to Q-13 for SA; the bucket-hardening migration is proposed as a follow-up (Q-7). Next: SA workplan review. **Code complete 2026-10-16, not committed** (on `origin/main` `067c4a3e`, after D-2 #425 merged; SA-D3-1..SA-D3-12 applied): `POST` / `DELETE /api/user/avatar`, `AvatarService` (the only code naming the bucket, now pinned by a guard), `lib/validation/avatar.ts` (4 MB, four types, `sniffImageType`), `findAvatarUrl` / `setAvatarUrl` (upsert, tested on a no-row account) / `clearAvatarUrl`, the hook through the route with Pino (L-1), and `AvatarUpload.tsx`'s `accept` narrowed to the shared list (the only change in that file). **No migration and no storage-policy change:** the bucket hole F-26 is closed by D-3a after D-3 is deployed. Tests green, `typecheck:bos-llm` 0 new errors, all 33 mutations killed (details in the workplan). SA code review APPROVED (CR-D3-1 is this refresh); QA PASS WITH NOTES, 32 QA mutations, the three survivors (Q-19, Q-21, Q-30) now killed by route tests D-8, D-9, P-4b / D-6b. Next: commit + auto-merge; manual checks waived pre-merge by the user 2026-10-16; user tests after deploy; D-3a applied by TL only after those post-deploy checks incl. Q13 pass.

**D-4 progress (2026-10-16):** UI short path + SA code review (C-24). Dev workplan ([D-4 workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_D4_WORKPLAN.md)) on `feature/settings-drawer-d4-no-browser-db` from `origin/main` `067c4a3e` (D-1 #421, D-2 #425 and DE-0a merged; D-3 does not touch `page.tsx`), verified against `page.tsx` at `62c277a8`. **Code complete, not committed:** the unused `import { supabase } from '@/lib/supabaseClient'` is removed from `page.tsx` (no code use remained; log-out goes through `signOutUser`), and the C-22 guard `app/business-os/settings/__tests__/noBrowserDb.guard.test.ts` fails the page on a `supabaseClient` import, `.from(` or `supabase.` with comments stripped, with negative controls. All settings-page guards and the settings Jest set are green, `typecheck:bos-llm` 0 new, `lint:hooks` clean, 4/4 mutations killed. Next: SA code review, then the user sees the diff.

**D-3a + F-27a applied to production 2026-10-16** (TL, by hand; [workplan](/docs/workplans/STORAGE_BUCKET_LOCKDOWN_D3A_F27A_WORKPLAN.md) → "Applied to production"). Both buckets now have no `storage.objects` policies; avatars limited to 4 MB PNG/JPEG/WebP/GIF, website-images keeps 5 MB without SVG. Closes F-26 and the bucket part of F-27. PR records the migrations (`20261070`, `20261071`), merged by hand, no auto-merge. User app checks F6 / F10 / F11 pending.

### 0.3 Owed by the user / a human tester

| Item | Where |
|---|---|
| ~~Manual browser checks for every slice~~ ✅ **Done by the user (2026-10-16)**; feedback captured in Phase C (§0.6). D-1/D-2 checks also run by TL | Each workplan |
| ~~F-18 exposure check on prod~~ ✅ **Run by TL 2026-10-16: 1 consent row, 0 saved since the bug, 0 exposed** — no stored postal address was overwritten; no repair needed | F-18 workplan |
| 3-D Secure inside the Plan drawer (gates plan payments going live) | `BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` §9.5 row 20 |
| ~~Check he/es wording~~ ✅ **User: fine for now (2026-10-16)** | S-3 workplan |

### 0.4 Open decisions and follow-ups

| Item | Severity | Needs |
|---|---|---|
| **F-22** Stripe Connect return/refresh (`?tab=`/`stripe=`) lands on the plain settings page | Medium | User: where should the owner land after Stripe Connect, and should payments settings open by themselves? Then a small full-cycle slice |
| **F-23** `signOutUser` has no deadline, wrong storage keys, and a 5xx can leave the browser signed in (Offir's fix `c1a427e6` lost in a merge) | Medium | **Moved into Phase C as C-8 (user, 2026-10-15)** — see §0.6 |
| **F-20** Champion email → `?section=invite-friends` (opens the drawer) | Low | Own small slice with SA workplan review |
| **F-21** Invite link lost on a refused resend / failed refresh | Low | Client-only fix later |
| **F-19** Picker delete-confirm has no Escape and sits under the discard prompt | Low | Needs a layer option on the shared dialog (new pattern) |
| Plan name on the Plan row | Optional | Only if the user asks (C-8: needs `PlanSection` data reuse) |
| `typecheck:bos-llm` baseline entry for `app/api/onboarding/build/route.ts` now fixed | Chore | One-line baseline tighten |

### 0.5 Working environment

- Worktree used for Phase A: `../neuronforge-settings-drawers` (its `node_modules` is a **junction to the main checkout's** — unlink the junction before any `git worktree remove`; never `--force`).
- Never `git stash` in this repo (shared stash list across worktrees).

### 0.6 Phase C — improvements: ⏸ PARKED (user, 2026-10-15: "we will come back to them later") → 🟡 PLANNING 2026-10-16 (slice plan in §0.6.1) → ✅ **Phase C complete (C-a #442, C-c #440, C-b this PR); C-6/C-7 deferred** (2026-10-17)

**Origin:** user observation 2026-10-15 — the Plan drawer takes 1–2 s to show the plan, Marketing permission 1–3 s. Read-only investigation on `origin/main` `ba29f058` (estimates from code, nothing measured; server region assumed Vercel default `iad1`, Supabase `us-east-2`).

**Findings:** no slow query and no Stripe call on either open path. The delay is round trips: a likely cold serverless function on low traffic plus fixed per-request cost (Israel → US-East, `getUser`, sequential reads).
- **Plan:** one request, `GET /api/business-os/entitlements/my-plan`, with four sequential steps (`getUser`, entitlement snapshot, `findLocale`, billing read — no Stripe). One spinner until it returns, although the plan name is already on screen (the layout reads it for the header badge via `readPlanBadge`). Est. ≈0.3–0.55 s warm; +0.5–1.5 s cold.
- **Marketing permission:** a waterfall — `GET /api/business-os/consent-settings` (its 4 queries already run in parallel), and only after the form renders does `SavedAddressPicker` fetch `GET /api/business-os/addresses`, which pops in late. Est. ≈0.6–0.9 s warm; up to ≈1.5–3 s with two cold functions.
- **Dev mode** (`npm run dev`) adds on-demand route compilation and StrictMode double fetches (PlanSection, picker) — measure on `next build && next start` or production.

**Candidate slices** (C-8 already allows a page-load prefetch through the existing routes, in its own effect, with the drawer reusing the data):

| # | Improvement | Est. saving | Effort | Cycle |
|---|---|---|---|---|
| C-1 | Plan: show the plan name instantly (from the header badge data), details load underneath; success still only from the server's answer (M-6) | Removes the blank wait for the main fact | ~0.5–1 d | UI short path + SA check that purchase isn't affected |
| C-2 | Plan: prefetch on page idle or row hover, handed to `PlanSection` on mount; checkout-return re-read must still re-fetch | Most of the wait incl. cold start | ~0.5–1 d | UI short path + QA of checkout-return and upgrade |
| C-3 | Marketing: start the address-book request in parallel with consent (optional preloaded-data prop on the shared picker; F-18 "never fills on its own" must hold) | One round trip (~0.3–0.4 s warm, up to a cold start) | ~1 d | UI short path |
| C-4 | Marketing: render the form as soon as consent arrives, fixed-height placeholder for the picker | Perceived speed, no layout jump | ~0.25 d | UI short path |
| C-5 | Marketing: prefetch consent + addresses on page idle or row hover, reused on open | Most of the remainder | ~0.5–1 d | UI short path |
| C-6 | `my-plan`: run snapshot, `findLocale` and the billing read in parallel | ~60–160 ms | ~0.5 d | **Money route: full cycle** — only if measurements justify it |
| C-7 | Measure first: cold-start share and function region in Vercel Observability (add these three routes to the performance stream's R24 / NE-6/NE-7 capture) | Decides whether C-6 is worth it | — | Needs the user's Vercel access |

**C-8 — Log-out hardening (F-23), moved into Phase C by the user 2026-10-15.** `signOutUser` (`lib/client/auth-actions.ts`, shared by the three sign-out controls) has no deadline (a hung request leaves the log-out spinner on forever), clears the wrong literal storage keys (`sb-auth-token`, `supabase.auth.token` instead of `sb-*-auth-token`), and on a 5xx from global sign-out the person is sent to login while this browser stays signed in (auth-js `_signOut` skips the local clear). Offir's original fix is in `c1a427e6` (2 s / 5 s deadlines, `try/finally` redirect, shape-matched key clear); it was lost in a merge with the `31976f13` refactor. Medium. **Full cycle** (auth code, shared by three controls); add a test that log-out goes through `signOutUser` (QA S-5 gap 4) and fix the `handleLogout` comment (SA S-5 finding 3).

Recommended when resumed: C-4 + C-3 (or C-5) for Marketing permission, C-1 + C-2 for Plan — about 2–3 days, all client-side, no server or DB change. No overlap with the performance stream (`PERFORMANCE_IMPROVEMENT_SCOPING.md`, `PERFORMANCE_BUSINESS_ROUND_REQUIREMENT.md` do not cover these routes).

#### 0.6.1 Phase C slice plan (Dev, 2026-10-16) — SA-reviewed 2026-10-16 (rulings at the end of this subsection)

**Status (2026-10-17):** ✅ Phase C complete (C-a #442, C-c #440, C-b this PR); C-6/C-7 deferred.

Planned on `feature/settings-drawer-phase-c` from `origin/main` `447d17a2` (Phases A and B merged; `page.tsx` last changed in `988d714c`). No code yet.

> **Naming.** In this subsection "C-1".."C-8" are the §0.6 *items*. The SA *conditions* C-1..C-26 (SA Review below) are always written "SA condition C-n", because both sets use the same prefix.

**What reading the code changed in the §0.6 picture**

| # | Finding | Effect on the plan |
|---|---|---|
| P-1 | The Marketing form **already** renders as soon as consent arrives: `MarketingConsentPanel` drops its spinner when the consent GET returns. What arrives late is the address book. `SavedAddressPicker` starts its own GET only once it is mounted inside the form, and renders `null` until it returns, so the list pops in above the postal box and pushes it down. | C-4 is only the placeholder. The real saving is C-3 (start the book together with consent) and C-5 (start both before the click). |
| P-2 | `readPlanBadge` returns a label **only for a champion in force**. `planBadgeFor` returns `null` for every paid tier, free plan, trial and anomaly. A server layout also cannot pass props to the client page, because `children` is opaque, so the badge only reaches `BusinessOSHeader`. | C-1 as written ("the plan name from the header badge data") would show a name to champions only. It would also need a new context or a new server read to carry the name to the page. Recommend folding C-1 into C-2 (see C-b below). |
| P-3 | The three GETs are read-only. `consent-settings`, `addresses` and `my-plan` (including `readPlanPurchaseView`) make no insert, update, audit or Stripe call. | A speculative prefetch has no side effect beyond a read. |
| P-4 | `accountCard.guard.test.ts` pins that `page.tsx` never names `/api/business-os/entitlements/my-plan` or `/api/business-os/consent-settings` (SA condition C-8, tightened). | The prefetch keeps the route literals out of `page.tsx`. The reads live in small read modules that the drawers also use. The guard stays green unchanged; only its header comment is updated. |
| P-5 | Business OS has no data-prefetch mechanism today. `lazyDialogs.tsx` prefetches code, not data. `lib/utils/request-deduplication.ts` is a module-level 1 s cache that uses `console.*`. | Any prefetch is a new pattern under rule 7. C-a proposes one hook, with no provider and no module-level cache, for SA to rule on. |

**Slices**

| Slice | Items | Scope | Path | Effort | Depends on | Touches `page.tsx`? |
|---|---|---|---|---|---|---|
| **C-a Marketing permission** | C-3, C-4, C-5 | The panel starts the address-book GET in parallel with the consent GET. It hands the result to the shared picker through a new optional `initialBook` prop. A fixed-height placeholder holds the picker's place until the book is in. The page warms both reads on idle, and on row hover, focus or press, through a new `useDrawerPrefetch` hook. The panel takes the warmed reads on open: each is used once, within a maximum age, and only for the same account and language. F-18's "never fills on its own", S-3's dirty baseline and F-17's failed-load screen are unchanged. [C-a workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_C_A_WORKPLAN.md) | UI short path **with SA workplan review first**, because the new hook falls under rule 7 and the shared picker carries the F-18 fix. Then Dev, then SA code review and QA in parallel, then the user sees the diff, then RM. | ~2–2.5 d | — | Yes: the hook call, three warm handlers on the consent row, and one prop |
| **C-b Plan** | C-2 (C-1 folded in, P-2) | `PlanSection` gains an optional preloaded first read, and the page warms `my-plan` through the same hook. The first read uses the warmed answer only when there is **no** valid `checkoutMarker`. The bounded checkout and upgrade re-reads, "Check again" and the language-change re-read always fetch. Success still comes only from the server's answer (M-6, U-5). C-1 on its own (name before details) is dropped unless SA or the user wants it, because only champions have a plan name on the page today. | UI short path, plus an SA code review that purchase, checkout return and upgrade are unaffected, plus QA of checkout return and upgrade (SA condition C-11) | ~1 d | C-a merged (it reuses the hook and edits the same `page.tsx` block) | Yes |
| **C-c Log-out hardening** | C-8 / F-23 | Port Offir's `c1a427e6` into `signOutUser` (`lib/client/auth-actions.ts`): a 2 s deadline on the audit write and 5 s on the sign-out; `try/finally` so every caller's redirect happens; storage keys cleared by shape (`sb-*-auth-token`, chunked) instead of the two wrong literals; a local sign-out when the global one fails with a 5xx. Tests for each of these, for the three sign-out controls, and a source test that the settings log-out goes through `signOutUser` (QA S-5 gap 4). Fix the `handleLogout` comment (SA S-5 finding 3). | **Full cycle**: auth code shared by three controls | ~1–1.5 d | — | The `handleLogout` comment only (see below) |
| C-6 | `my-plan` steps in parallel | Money route | Full cycle | ~0.5 d | **Deferred until C-7 has measured it** | No |
| C-7 | Measure the cold-start share and the function region | Add the three routes to the performance stream's capture | Needs the user's Vercel access | — | — | No |

**Order and parallelism**

- **C-a first, then C-b.** Both add code to the same block of `page.tsx` (the account-card rows and the hook calls), and C-b reuses C-a's hook. They run one after the other from fresh `main`. The §0.2 rule of never having two open PRs on `page.tsx` holds for Phase C.
- **C-c can run in parallel with C-a.** Its code is `lib/client/auth-actions.ts` and its tests. Its only `page.tsx` change is the `handleLogout` comment. To keep the one-PR rule, either C-c leaves that comment for C-b, or whichever of C-a and C-c opens its PR second merges `origin/main` in first. SA to choose; Dev recommends moving the comment fix into C-b.
- **C-6 and C-7** stay parked until the user can open Vercel Observability. The before-and-after measurements that C-a and C-b record on a production build feed that decision.

**Total:** about 4–5 days for C-a, C-b and C-c. C-a and C-b make no server, route or database change.

**SA rulings on the slice plan (2026-10-16).** Checked against the code on `447d17a2`. The C-a workplan review, with its conditions SA-CA-1..15, is in the [C-a workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_C_A_WORKPLAN.md#sa-workplan-review-2026-10-16).

| # | Ruling |
|---|---|
| R-1 Order | ✅ **C-a, then C-b, one after the other.** They share the `page.tsx` account-card block and the hook. C-b starts from `main` after C-a has merged. |
| R-2 C-c in parallel | ✅ **Approved.** C-c is a full cycle with its own workplan and SA review. It must keep `signOutUser`'s signature and result shape (`page.tsx` reads `result.ok` / `result.error`). If it has to change either, C-c is no longer parallel: it starts after C-a has merged and before C-b opens. |
| R-3 Q-9, the `handleLogout` comment | ❌ **Not moved into C-b.** That comment describes `signOutUser`'s behaviour ("nothing can trap someone… cleared regardless"). It is false today and becomes true only when C-c lands. In C-b it would either have to describe code not yet merged, or land before C-c and stay wrong. **C-c makes the comment-only edit** in the `handleLogout` block. This is a recorded exception to the §0.2 rule of one open PR on `page.tsx`: a comment in a region neither C-a nor C-b touches carries no semantic-conflict risk, and the merge queue re-tests against the latest `main`. Whichever of C-a and C-c opens its PR second merges `origin/main` in first. C-c's source test that the settings log-out goes through `signOutUser` only reads `page.tsx`. |
| R-4 P-1, P-3, P-4, P-5 | ✅ Confirmed in the code. |
| R-5 P-2 / Q-10, C-1 folded into C-2 | ✅ **SA call, not a user decision.** `planBadgeFor` returns `null` for everyone except a champion in force, and the layout can hand the badge only to the header. So C-1 would show a name to champions only, or would need a new context or server read for one line. C-2 brings the whole plan before the click, which gives the owner what C-1 aimed at. Tell the user as information (see the C-a review). |
| R-6 C-6, C-7 | ✅ **Deferred.** C-6 changes a money route for an estimated 60–160 ms and needs C-7's measurement first. C-7 needs the user to open Vercel Observability; that is the only user action Phase C has. |
| R-7 The rule-7 pattern | ✅ `useDrawerPrefetch` is approved for the settings-page drawers (C-a, then C-b), with no CLAUDE.md or skill entry. Any third surface brings it back to SA. |

**C-a progress (2026-10-16):** **Code complete, not committed** on `feature/settings-drawer-phase-c` (`origin/main` `09e2d3ad` merged in). SA conditions SA-CA-1..15 applied; SA-CA-15's gate held (the `deriveSelection` extraction passed `SavedAddressPicker.default`, `.textForm` and `MarketingConsentPanel.picker.render` with no test edits, before the seed). New: `components/ui/addressBookRead.ts`, `components/business-os/settings/marketingDrawerReads.ts`, `components/business-os/settings/useDrawerPrefetch.ts`; changed: `SavedAddressPicker.tsx` (`initialBook`), `MarketingConsentPanel.tsx` (parallel reads, placeholder, `takePrefetched`), `MarketingConsentDrawer.tsx` (pass-through), `page.tsx` (one hook call, three warm handlers, one prop). Must-stay-green set (48 suites, 772 tests) green, D-12 unedited, `typecheck:bos-llm` 0 new, `tsc` 0 in touched files, `lint:hooks` clean, 26/26 mutations killed ([workplan → Implementation Notes](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_C_A_WORKPLAN.md#implementation-notes)). The before/after measurement is left for QA/TL (SA-CA-12: structure is the gate). **SA code review ✅ (CR-CA-1). QA ❌ on QA-CA-B1 (Medium):** an idle or timer warm that fired while the drawer was open started a pair from before a save, and a reopen within 60 s showed the old wording as clean. **Fixed by Dev, 2026-10-16** ([workplan → QA bug fix](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_C_A_WORKPLAN.md#qa-bug-fix-2026-10-16)). The hook gains `paused` (rule 6), and the page passes `paused: consentDrawerOpen`. While the drawer is open nothing warms; closing drops anything held, so the next warm is fresh. QA's suggested `!consentDrawerOpen` in `enabled` would have lost the handover, because the drawer's content mounts one commit after the open, after the drop on disable. `enabled` and stale-data rule 4 are unchanged. Gaps QA-MU-1/4/7 closed; 14/14 mutations killed; must-stay-green 48 suites / 792 green. Next: SA re-check of rule 6 (new hook option, rule 7) and a targeted re-QA, then the user sees the diff.

**C-c progress (2026-10-16):** Dev workplan ([C-c workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_C_C_SIGNOUT_WORKPLAN.md)) on `fix/signout-hardening-c-c` (from `origin/main` `962f1398`, `09e2d3ad` merged in). Finding: the session lives in **cookies** (`@supabase/ssr` browser client), not `localStorage`, so the original storage-only clear would not have signed anyone out. **SA workplan review 2026-10-16: APPROVED WITH CONDITIONS** SA-CC-1..16 (in the workplan). **Code complete 2026-10-16, not committed:** `signOutUser` never rejects and resolves within 9 s (audit 2 s, sign-out 5 s, local fallback 2 s); when the server does not confirm, it expires `sb-*-auth-token*` cookies and storage keys by shape, then runs a network-free local sign-out; `clearedLocally` is measured by re-reading; one sign-out at a time per page; success behaves as today. `SignOutButton` (awaiting payment) proceeds when the browser is cleared locally (SA-CC-7). The `handleLogout` comment fix stays in C-c (SA-CC-1, comment-only change to `page.tsx`); whichever of C-a and C-c opens its PR second merges `origin/main` first. Details, tests and mutation results in the workplan. **Status 2026-10-16: SA code review APPROVED (CR-CC-1..7, all Low), QA PASS WITH NOTES (QA-CC-1/2 closed by Dev the same day, CR-CC-1 hardened), ready to commit.** Manual Q-list owed after deploy.

**Carried into the C-b workplan (SA, in advance).** C-b gets its own SA workplan review, as the second user of the hook.
- **B-1** `PlanSection`'s first-read effect is cancellable (`cancelled` flag, `[language]` dependency). Under StrictMode its first run is cancelled, so a set taken inside that effect would be used up and the second run would fetch. Take the warmed read **once, outside the cancellable effect** (held in a ref), and test it under StrictMode.
- **B-2** The warmed read serves only the first read, and only when there is no valid `checkoutMarker` and no `completedSession`. The `[language]` re-run, the bounded checkout and upgrade re-reads and "Check again" always fetch. Success still comes only from a server answer read after the action (M-6, U-5). QA covers checkout return and upgrade (SA condition C-11).
- **B-3** `my-plan` sends no language: names come from the stored preference. The key still includes the language, so a switch drops the held set.
- **B-4** The `my-plan` literal stays out of `page.tsx` (`accountCard.guard`). If a C-b read module imports anything from `lib/business-os/entitlements/` (type-only included), walk the `business-os-entitlements` checklist.

**C-b progress (2026-10-16):** Dev workplan ([C-b workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_C_B_WORKPLAN.md)) on `feature/settings-drawer-c-b` (from C-a's head `16242704`; `origin/main` `fcce705a` merged in by fast-forward after #442 landed). No code. Plan: a new `planDrawerReads.ts` holds the one copy of the `my-plan` request (never rejects, sends no language). `PlanSection` gains an optional `takePrefetched`. It takes the warmed read once per mount in a ref-guarded effect, outside the cancellable `[language]` effect (B-1), and uses it only with no valid checkout marker and the same language (B-2, B-3). The re-reads, Check again and the language re-read always fetch, and success still comes only from the server (M-6, U-5). The page adds a second `useDrawerPrefetch` call with `paused: planDrawer.open` and warm handlers on the Plan row; the route literal stays out of `page.tsx` (B-4). The hook, `PlanPurchase`, `PlanUpgrade`, `PlanEmbeddedCheckout`, the route and every existing Plan test are unchanged. No entitlements import, so the registration checklist does not apply; `test:bos-entitlements` still runs. New finding: the Plan drawer has no busy lock, and an upgrade can land after it closes, so Dev proposes no warm after the first close (Q-1). Questions Q-1..Q-10 for SA, including a planned edit to `consentPrefetch.guard` (Q-7). Next: SA workplan review.

**SA workplan review of C-b (2026-10-16): APPROVED WITH CONDITIONS** SA-CB-1..11 ([C-b workplan → SA Workplan Review](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_C_B_WORKPLAN.md#sa-workplan-review-2026-10-16)). The rulings:
- **Q-1: option (b).** Plan warms only until the drawer has been opened and closed once. The Plan drawer has no busy lock, and `PlanUpgrade` reports after the POST with no mounted guard. A warm after the close could therefore predate an upgrade or the webhook, and a reopen would show the old plan with a live Upgrade button. (b) keeps every later open exactly as today.
- **Q-2 to Q-10 approved.** No hook edit. No entitlements import, so the registration checklist does not apply, but `test:bos-entitlements` runs. B-1 to B-4 and SA condition C-11 are met by the plan.
- **Conditions:**
  - `readMyPlan` uses one `try` over fetch and json, reads only `json` and `status`, and writes the URL inline.
  - The effect order is pinned.
  - Logging parity is exact.
  - The four Plan render suites stay unedited through the whole slice.
  - The `consentPrefetch.guard` edit gets exact anchor, count and negative controls.
  - The stale Plan-row comment in `page.tsx` is reworded.
  - P-G7 matches import specifiers only.
  - Three added mutations (MB-21 to MB-23).
- **User decision:** should merge wait for a hands-on Stripe test-mode buy and upgrade (M-6 to M-10)? SA recommends not; list them as owed after deploy.

**C-b code complete (Dev, 2026-10-17), not committed.** All of SA-CB-1..11 are applied ([C-b workplan → Implementation Notes](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_C_B_WORKPLAN.md#implementation-notes)). The spent flag is derived in render (SA optimisation 1), so the warm stops in the very render that closes the drawer. The four Plan render suites, `useLinkOpenedDrawer.test` and `settingsDeepLinks.guard` were not edited and pass. Results: must-stay-green 935/935, `test:bos-entitlements` 8459/8459, `typecheck:bos-llm` 0 new, tsc 0 errors in the touched files, `lint:hooks` clean. Every mutation is killed except MB-6, which is equivalent (a question for SA). Manual M-6..M-10 were NOT RUN; a human owes them after deploy. Next: SA code review and QA, in parallel.

**C-b committed + PR (RM, 2026-10-17):** SA code review APPROVED; QA PASS WITH NOTES (QA-14/QA-15 optional test gaps accepted; MB-6 accepted as equivalent). Committed on `feature/settings-drawer-c-b`, PR opened against `main` with auto-merge under the Phase C fast-track. Manual M-1..M-12 (M-6..M-10 Stripe test mode, test account only) owed by a human after deploy, not a merge gate. **Phase C complete (C-a #442, C-c #440, C-b this PR); C-6/C-7 deferred.**

---

## Overview

The user noticed that the Business OS settings page does not use the side-drawer pattern the rest of the product has adopted. This review lists every function on the page, says what the owner does there and how it saves, and recommends for each one whether it should **move into a drawer**, **stay inline**, or be **split** (a short summary row stays on the page and the full content opens in a drawer). It also lists the constraints a move must respect: the timezone deep link used by the publish gate, the currency and timezone authority rules, mobile behaviour, and unsaved changes. Delivery is proposed in small numbered slices that reuse the drawer shell already in the product. Nothing here changes code.

**Short answer:** move the four functions that are long, have their own save, or manage a list (Plan, Marketing permission, Invite friends, Change password). Keep the one-value preferences (Language, Currency, Timezone), the profile card, and the one-click actions (Export, Log out, Delete account) where they are.

---

## Table of Contents

0. [Current status and handover (2026-10-15)](#0-current-status-and-handover-2026-10-15)
1. [The drawer pattern as built](#1-the-drawer-pattern-as-built)
2. [Inventory of the settings page](#2-inventory-of-the-settings-page)
3. [Recommendation per function](#3-recommendation-per-function)
4. [Constraints and risks](#4-constraints-and-risks)
5. [Proposed slicing](#5-proposed-slicing)
6. [Open questions for the user](#6-open-questions-for-the-user)
7. [Found during the review, not in scope](#7-found-during-the-review-not-in-scope)
8. [Notes on integration points](#8-notes-on-integration-points)
9. [Added scope (2026-10-14): direct database calls and logging](#9-added-scope-2026-10-14-direct-database-calls-and-logging)
10. [SA Review (2026-10-14)](#sa-review-2026-10-14)
11. [Change History](#change-history)

---

## 1. The drawer pattern as built

### 1.1 Customer-facing drawers (Business OS)

| Drawer | File | Shell | What it is for |
|---|---|---|---|
| Contact drawer | `components/crm/contact-drawer/CRMContactDrawerV2.tsx` | Radix `Sheet` (`components/ui/sheet.tsx`) | One client: details, notes, bookings, money, files, tabs |
| Money detail | `components/payments/MoneyDetailDrawer.tsx` | Same `Sheet` shell, "class for class" with the contact drawer (`:128-134`) | One booking's money: plan schedule, invoices, refunds |
| Manage categories / goals | `components/v2/analytics/ManageCategoriesDrawer.tsx`, `ManageGoalsDrawer.tsx` | **Hand-built** fixed overlay (`:309-316`), no focus trap, uses `console.*` | Agent-platform list editors. Legacy: **do not copy** |
| "FunnelDrawer" | `components/business-os/insight/FunnelDrawer.tsx` | **Not an overlay.** An in-page panel rendered in the flow (`:84-103`) | Insight detail card. The name says drawer; the behaviour is inline |

The convention the two current Business OS drawers share (Money detail was built to the contact drawer's pattern on purpose):

| Aspect | As built |
|---|---|
| Side | `side={isRTL ? 'left' : 'right'}`: opens from the reading end, so Hebrew opens from the left (`MoneyDetailDrawer.tsx:132`) |
| Width | `w-full sm:max-w-xl`: full screen on a phone, about 576 px on a larger screen (`:133`) |
| Surface | `p-0 bg-[var(--v2-bg)] border-[var(--v2-border)] overflow-hidden flex flex-col`; the Sheet's own X is hidden (`[&>button]:hidden`) and the drawer draws its own (`:133`, `:194-201`) |
| Header | Fixed, not scrolling: coloured round mark, title (`SheetTitle`), a meta line with the key facts, close X at the far end (`:140-204`) |
| Body | One scroll area `flex-1 overflow-y-auto p-6 space-y-3`, content grouped in `CollapsibleSection` cards (`:206-219`) |
| Actions | **Inside the card they act on**, not in a pinned footer. A pinned footer was tried and abandoned because it could not say which item it meant (`:21-31`) |
| Close | Escape, overlay click, or X (Radix behaviour). Focus is trapped while open |
| Nested dialogs | A dialog opened from inside a drawer must not dismiss the drawer. `useConfigurationDialogOpen()` exists for exactly this (`ConfigurationDialogProvider.tsx:50-70`, used by the contact drawer, `CRMContactDrawerV2.tsx:4`) |
| Save model | No shared one. Read-mostly drawers act per item. The closest customer precedent for a long form with Save is the Configuration window's **frozen action bar** (`components/business-os/settings/TabFooter.tsx`), rendered outside the scroll area so Save and its confirmation are always visible |

### 1.2 Admin drawer standard (for the documented rules)

The admin standard (`ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` §5.8, extended by `ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` §3.2) is dark-themed and admin-only, so its classes do not transfer. Its **rules** do, and they are the clearest written statement of when a drawer is used:

| Rule | When | Use |
|---|---|---|
| OR-1 | View a record's details | Right-side drawer |
| OR-2 | Create a record, or edit a record's fields, with a form | Drawer form |
| OR-3 | Confirm one action, even one that asks for one reason or amount | Modal dialog, never the browser's `confirm()` |
| OR-4 | Show more of what is already on a card | Inline disclosure |
| OR-5 | An on-demand tool that is part of the page | Stays inline |
| OR-6 | Never a new page for open or create; never a hand-built modal | — |

Lessons from the admin retrospective that apply here: test "the item disappears while the drawer is open"; decide where focus goes after every action; a drawer form must refuse to close while its save is in flight and must not silently drop a half-filled form (LF-3a rules, followups §3.3).

### 1.3 Decision rule for the settings page

A function **belongs in a drawer** when at least one of these is true:

1. It is a **form of several fields with its own Save** (OR-2).
2. It **manages a list of records** with its own add or remove actions (OR-1 / OR-2).
3. It is **long reading content** that pushes the rest of the page down when expanded (a plan's full contents).

**And** the owner gains from keeping the page behind it: they come back to the same list of settings, and the content gets a fixed header and its own scroll.

A function **stays inline** when any of these is true:

1. It is **one value applied the moment it is picked** (a dropdown that saves itself). A drawer adds two clicks and a close for a single choice.
2. It is a **one-click action** (download, sign out). Its confirmation, if any, is a **dialog** (OR-3), not a drawer.
3. It is a **summary** whose job is to be seen at a glance (the profile card).
4. Another flow **deep-links to the control itself** and a drawer would hide it behind an extra step (timezone, §4.1), unless the drawer opens directly from that link.

**Split** means: a one-line summary row stays on the page (name of the setting plus its current value), and the full content opens in the drawer from that row.

---

## 2. Inventory of the settings page

The page is a header, a message banner, and two columns (`page.tsx:765`). The left column is "Profile & Preferences", the right column a single list card of account functions. Business details and invoice details are **no longer on this page**: they moved to the Configuration window, and `?section=business` / `?section=invoice` now open that window (`page.tsx:156-159`; `ConfigurationDialog.tsx:34-45`).

| # | Function | What the owner does there | How often | Current UI shape | Save model | Code |
|---|---|---|---|---|---|---|
| 1 | Page header | Reads the title | Every visit | Icon, h1, subtitle | — | `page.tsx:724-745` |
| 2 | Message banner | Reads "saved" or an error from any section | After any action | One green or red strip at the top of the page, shared by every section | Success auto-hides after 3 s (6 s for the currency refusal) | `:748-762` |
| 3 | Profile card | Sees avatar, name, email, job title; edits the name; changes the avatar | Rare (setup, then almost never) | Card with a pencil; edit mode swaps in a name field with Cancel / Save. Job title is shown but **has no edit field** | Explicit Save (name, avatar, job title upsert, plus timezone if set) | `:769-842`, `saveProfile :301-344` |
| 4 | Language | Picks English, Spanish or Hebrew | Rare | Row with a dropdown | Applies at once | `:847-878` |
| 5 | Currency | Picks the business's **default currency** (USD, EUR, ILS, GBP) | Once at setup | Row with a dropdown, in the same card as Language | Applies at once; the database can refuse it once money exists in the current currency (`CURRENCY_LOCKED`), and the page then explains why | `:881-934`; `LanguageContext.tsx:67-80` |
| 6 | Timezone | Searches and picks the business's timezone | Once, but **required** before a booking surface can be published | Row with a searchable dropdown of every IANA zone (60 shown at a time); carries the anchor `settings-section-timezone` | Applies at once, writes `user_preferences.timezone` with `timezone_confirmed_at`, mirrors to `profiles`, then **reads the value back** to prove it stored | `:944-995`; `persistTimezone :250-299` |
| 7 | Your plan | Checks which plan the business is on, its price, what it includes, the next plan up | Occasional; the plan pill in the chrome links here | Collapsible row; read-only content loaded from `/api/business-os/entitlements/my-plan` | None (read-only; no buy button on this page today) | `:1012-1028`; `PlanSection.tsx` |
| 8 | Invite friends | (Founding Partners only) sends an invite to a friend, sees invites left, sees sent invites and their status, revokes a pending one, copies a link shown once | Rare, in bursts | Collapsible row that renders **nothing** unless the server says the account is eligible; inside: form (email, note, language), list, inline revoke confirmation, one-time link panel | Send and Revoke each save at once | `:1031`; `InviteFriendsSection.tsx` |
| 9 | Marketing permission (consent) | Sees how many contacts can receive marketing email; turns on asking for permission; edits the permission wording; chooses and edits a privacy notice (10-line text area); sets the postal address; labels emails as advertising | Rare, but the **longest and most legal** content on the page | Collapsible row; the panel is mounted only while open | One explicit Save at the bottom; collapsing the row **discards unsaved edits without warning**; a failed save shows **nothing** | `:1052-1068`; `MarketingConsentPanel.tsx` |
| 10 | Change password | Enters current, new, confirm; shows or hides them | Rare | Collapsible row with a 3-field form; replaced by an explanatory notice for owners who sign in with Google or similar | Explicit "Update password" through the API | `:1075-1145`; `handlePasswordChange :384-428` |
| 11 | Export data | Downloads a file of their data | Rare | One-click row, spinner while building | Immediate download | `:1148-1158`; `handleExportData :430-465` |
| 12 | Log out | Signs out on every device | Occasional | Row that opens a confirmation dialog | Dialog confirm | `:1164-1180`, `:1205-1242` |
| 13 | Delete account | Learns how to request erasure | Very rare | Red row that opens a dialog; the dialog is informational until the purge flow is switched on | None today (contact address only) | `:1183-1192`, `:1246-1289` |

**Deep links the page honours today** (`page.tsx:145-196`): `?section=business` and `?section=invoice` open the Configuration window; `?section=timezone` scrolls to the timezone row; `?section=plan` and `?section=password` expand and scroll to their rows. `?section=preferences` is deliberately ignored.

---

## 3. Recommendation per function

| # | Function | Recommendation | Business reason | Effort |
|---|---|---|---|---|
| 1 | Page header | Stay inline | It is the page | — |
| 2 | Message banner | Stay inline, **for inline functions only** | A banner at the top of the page is hidden behind an open drawer. Each drawer shows its own success and error message inside itself | 🟢 (part of each drawer slice) |
| 3 | Profile card | **Stay inline** | It is mostly a summary of who is signed in, and editing is one name field. A drawer would be heavier than the thing it replaces. Revisit only if job title or more fields become editable (Q-1) | — |
| 4 | Language | **Stay inline** | One choice, applied at once, and the whole screen changes language immediately, which the owner should see happen | — |
| 5 | Currency | **Stay inline** | One choice, applied at once, with a clear refusal message when it cannot change. See Q-3: it is a business setting sitting among personal preferences | — |
| 6 | Timezone | **Stay inline** (now) | One choice, saved at once and proven stored. The publish gate's "Set your timezone" button lands on this exact row, so hiding it behind a drawer would add a step to the one setting that blocks publishing. An optional later slice (S-6) could open the timezone picker **in place** on the page the owner was publishing from, so they never leave it (Q-4) | — (S-6: 🔴) |
| 7 | Your plan | **Split → drawer** | Long, read-only content about what the owner pays for. Today expanding it pushes the rest of the list off screen. A row showing the plan name and price stays on the page; "View plan" opens the full contents in a drawer. The plan pill in the chrome opens the drawer directly. A future "upgrade" action also fits better in a drawer than in an expanded row | 🟢 |
| 8 | Invite friends | **Split → drawer** | A small list manager: a form, a list of sent invites, revoke, and a link that is shown only once. It is the "list of records with actions" case. Row stays visible only for eligible owners, showing "N invites left" | 🟡 |
| 9 | Marketing permission | **Split → drawer** | The longest form on the page, with legal wording and a privacy notice. It needs a Save that is always visible and protection against losing edits; today both are missing. A drawer with a fixed Save bar gives the owner room to read and edit without the page moving. Row shows "N of M contacts can receive marketing email" | 🟡 |
| 10 | Change password | **Drawer** (row stays as the opener) | A three-field form with its own submit (OR-2). In a drawer the fields are cleared when it closes, and the success or error message appears next to the form instead of at the top of the page. The "you sign in with Google" notice stays inline: it is information, not a form | 🟢 |
| 11 | Export data | **Stay inline**, do not touch | One-click download. **Also blocked:** this handler is the browser-side export that writes plugin connection tokens into the file (DE-0 in `BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md`). The data-export stream owns this row | — |
| 12 | Log out | **Stay inline + dialog** | One action, one confirmation (OR-3). Already right | — |
| 13 | Delete account | **Stay inline + dialog** | Informational today; the future purge flow (dry run, gate, typed confirmation) belongs to the purge requirement, which decides its own shape | — |

**After the moves**, the right-hand card becomes a clean list of rows, each with its current value and a chevron: Your plan › · Invite friends › · Marketing permission › · Password › · Export data · Log out · Delete account. The left column is unchanged.

---

## 4. Constraints and risks

### 4.1 Deep links and the publish gate (hard constraint)

| Link | Who sends it | Today | Must be true after the change |
|---|---|---|---|
| `?section=timezone` | `gapFixAction('timezone')` (`lib/business-os/journeyGapFix.ts:75-81`), used by every "Fix" button through `useGapFix` (`components/business-os/setup/useGapFix.ts:51-54`) | Scrolls to the row with id `settings-section-timezone` (`page.tsx:167-170`, `:944`) | Unchanged. The id stays on the timezone row, the row stays on the page, and the scroll still waits for loading to finish (`:146`). Readiness is re-read when the destination mounts, so nothing else depends on the page |
| `?section=plan` | The plan pill in the chrome | Expands and scrolls to the plan row | **Opens the plan drawer.** Otherwise the pill appears to do nothing |
| `?section=password` | Password reset and email links | Expands the password row | **Opens the password drawer**, or for an owner who signs in with a provider, scrolls to the notice (today it expands nothing for them) |
| `?section=business`, `?section=invoice` | Dashboard chips, briefing emails | Opens the Configuration window | Unchanged |
| `?section=preferences` | Old emails | Ignored | Unchanged |

Two decisions for SA: whether closing a drawer opened by a link removes `?section=` from the address (otherwise a reload reopens it, Q-6), and that this cleanup must use replace, never push, so Back is not polluted.

### 4.2 Currency and timezone authority rules (CLAUDE.md)

- **Timezone authority is `user_preferences.timezone`.** `persistTimezone` writes it with `timezone_confirmed_at`, mirrors to `profiles`, and reads it back. Any change must keep all three steps. `business_profiles.timezone` does not exist and must never be named in a select.
- **"Not asked" must stay distinguishable from "chose UTC".** No drawer or picker may pre-select a zone (UTC or the browser's zone) as a saved value: a pre-filled default that gets saved would mark an unasked business as confirmed and silently clear the publish gate. Today the row shows a placeholder for an empty value (`:954`); keep it that way.
- **The Currency row writes the business's default currency** (`businessCurrency`), which is a default for new services and a label for totals, never what a client is charged (`scheduling_services.currency` is). It must not be seeded from `LanguageContext.currencyCode`, which is display-only and browser-stored. The `CURRENCY_LOCKED` refusal message must survive any move.
- Currency does **not** gate publishing; timezone does. Nothing in this review changes either rule.

### 4.3 Mobile and right-to-left

- The shell is full-width on a phone (`w-full`), so a settings drawer becomes a full screen with its own close X. Fine for forms; the plan and consent drawers will be long, so the header must stay fixed and the body scroll.
- Side follows the language: right in English and Spanish, left in Hebrew (`side={isRTL ? 'left' : 'right'}`).
- Popovers inside a drawer (the privacy-notice select, the saved-address picker in the consent form, the invite language select) render into a portal. Each needs checking above the drawer's overlay on desktop and phone.
- The consent panel keeps the switch thumb in a `dir="ltr"` wrapper so it does not slide out of its track in Hebrew (`MarketingConsentPanel.tsx:241-254`). That must survive the move.

### 4.4 Unsaved changes and in-flight saves

- **Marketing permission:** today, collapsing the row unmounts the panel and drops edits silently. In a drawer, Escape and an overlay click would do the same. Proposed behaviour (Q-2): when the form has unsaved edits, closing asks "Discard your changes?"; while a save is in flight, the drawer refuses to close.
- **Change password:** fields are cleared on close (passwords must not linger in memory or on screen). The drawer refuses to close while the update is in flight.
- **Invite friends:** the one-time link is held only in component state, never re-fetchable (`InviteFriendsSection.tsx:27-28`). If the drawer's content is unmounted on close, the link is lost. Either keep it mounted while hidden, or hold the link at page level until the owner leaves the page (Q-5). The link must never be written to the address bar or browser storage, including by any new `?section=` handling.
- There is **no shared customer-side "unsaved changes" guard** today. Building one is a new pattern and needs SA (CLAUDE.md rule 7).

### 4.5 Nested dialogs

The Delete and Log out dialogs stay outside any drawer. Invite friends' revoke confirmation is inline today; if it becomes a dialog inside the drawer, the dialog must not dismiss the drawer underneath (the problem `useConfigurationDialogOpen` was built for). Recommendation: keep the inline revoke confirmation in the first invite slice; changing it is not needed for the move.

### 4.6 Data-access debt on the page

The page reads and writes `profiles` and `user_preferences` directly with the browser Supabase client (`loadData :204-207`, `persistTimezone :255-288`, `saveProfile :313-319`) and the export handler reads three tables the same way (`:436-440`). That is against CLAUDE.md rule 1. The recommended slices **do not move that code**: Plan, Invite friends and Marketing permission already go through API routes, and the password change already uses `changePassword` through the API. If a slice does have to touch the profile or timezone code (S-6 would), SA should rule first whether those writes move behind an API route, as was done for language preferences (`/api/business-os/preferences`). Per the standing review rule, "existing file convention" does not waive rule 1.

### 4.7 Other

- **Shell reuse, not a new drawer.** Reuse `components/ui/sheet.tsx` with the contact or money drawer's classes. A thin shared wrapper for settings drawers (header, scroll body, optional fixed Save bar modelled on `TabFooter`) is a new shared component and needs SA (rule 7). The hand-built `ManageCategoriesDrawer` / `ManageGoalsDrawer` must not be copied (no focus trap, `console.*`).
- **Focus:** focus returns to the row that opened the drawer. The opener rows should announce that they open a panel (`aria-haspopup="dialog"`) instead of today's expand-in-place state.
- **Loading:** Plan and Invite friends fetch when mounted. In a drawer, Plan should fetch on open. Invite friends must still fetch on page load, because its row is shown only when the server says the account is eligible.
- **Tests that exist:** `components/business-os/settings/__tests__/PlanSection.render.test.tsx` and `InviteFriendsSection.render.test.tsx`. Each slice keeps them green; any test that pins the expand-in-place behaviour of the page needs a planned edit, listed in the workplan.
- **Plan payments stream:** the plan-payments work (P-slices) may add a buy or upgrade action to the plan section. The plan drawer slice should check the current state of that work first so the two do not collide.

---

## 5. Proposed slicing

Small numbered slices, a few days each, in the recommended order. Each slice moves one function and nothing else. The first slice runs the full cycle because it introduces the shared settings-drawer wrapper (rule 7); later slices can take the UI short path unless SA rules otherwise.

| Slice | Scope | Why this order | Path | Size |
|---|---|---|---|---|
| S-0 | This review → user answers §6 → SA review (wrapper design, `?section=` cleanup, unsaved-changes guard design) | Decisions first | BA → user → SA | — |
| S-1 | **Shared settings drawer wrapper + Plan drawer (pilot).** Wrapper on `Sheet` with the money or contact drawer's shell (side by language, full width on phone, own X, fixed header, scroll body). Plan row shows name and price; `?section=plan` opens the drawer; plan fetched on open | Read-only, no save, lowest risk: proves the shell, the deep link, right-to-left and mobile | Full cycle (new shared component) | 🟢 about 2 days |
| S-2 | **Change password drawer.** Messages inside the drawer; fields cleared on close; no close while updating; `?section=password` opens it; provider notice stays inline | First form; small | UI short path | 🟢 1 to 2 days |
| S-3 | **Marketing permission drawer.** Fixed Save bar (the `TabFooter` idea, reused not copied); unsaved-changes guard per Q-2; save success and failure shown inside the drawer; popover layering checked | Biggest owner benefit; builds the unsaved-changes guard (new pattern, SA) | Full cycle if the guard is new shared code | 🟡 about 3 days |
| S-4 | **Invite friends drawer.** Row shows invites left; one-time link survives close per Q-5; no close while sending; revoke stays inline | Needs the S-3 guard thinking for in-flight sends; link-safety rules | UI short path (SA confirms) | 🟡 2 to 3 days |
| S-5 | **Tidy the account card.** Every row shows its current value and a consistent chevron; remove the now-unused expand state; re-check every `?section=` link | Clean-up once the moves are in | UI short path | 🟢 about 1 day |
| S-6 | **Optional, only if the user asks (Q-4): set the timezone in place.** The "Set your timezone" fix opens a small timezone panel over the page the owner is on, instead of sending them to Settings. Needs a page-independent opener (like the Configuration window's provider) and the timezone write moved behind an API route (§4.6) | Bigger, touches the publish gate and data access | Full cycle | 🔴 4 to 5 days, may split |

Every slice: user sees the diff before any commit; the main requirement (this document, or the requirement it becomes) records every SA ruling, PR and merge.

---

## 6. Open questions for the user

Each question has a recommended answer. These are business choices; technical choices go to SA.

> **User decision (2026-10-14):** "Go with the recommendations." All seven are answered as recommended: Q-1 (a), Q-2 (a), Q-3 (a), Q-4 (b, S-6 not scheduled), Q-5 (a), Q-6 (a), Q-7 (a).

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q-1 | Should **every** setting open in a side panel for consistency, or only the long ones? | (a) Only the long or list-like ones: Plan, Marketing permission, Invite friends, Password (b) Also the profile name and the preferences | **(a).** One-choice settings are faster as they are; a panel adds clicks for no gain |
| Q-2 | An owner edits the marketing-permission wording, then closes the panel without saving. What should happen? | (a) Ask "Discard your changes?" (b) Keep the draft quietly until they leave the page (c) Close and lose it, as today | **(a).** This is legal wording; losing it silently is the worst outcome, and keeping a hidden draft can surprise them later |
| Q-3 | The **Currency** row sets the business's default currency for new services, but it sits under personal preferences next to Language. Keep it there? | (a) Keep it, add one line explaining what it affects (b) Move it beside the business details in the Configuration window (c) Leave as is | **(a)** now; (b) is a separate placement decision, not part of the drawer work |
| Q-4 | When an owner publishing a website or booking page presses "Set your timezone", they are taken away to Settings. Should it open in place instead? | (a) Yes, as an extra slice later (S-6) (b) No, the current jump is fine | **(b) for now.** It works and is rare; revisit if owners report losing their place |
| Q-5 | After a friend's invite link is shown once, if the owner closes the panel, should the link still be there when they reopen it during the same visit? | (a) Yes, until they leave the page (b) No, closing dismisses it | **(a).** The link cannot be recovered, so closing the panel by accident should not lose it |
| Q-6 | If an owner reloads the page while a panel is open, should it reopen? | (a) No, only links from emails or the plan pill open a panel (b) Yes | **(a).** A reload should show the settings page as normal |
| Q-7 | Is the order Plan → Password → Marketing permission → Invite friends acceptable? | (a) Yes (b) Different order | **(a).** Safest first, biggest benefit third, once the shell is proven |

---

## 7. Found during the review, not in scope

Recorded so they are not lost. None is fixed by the drawer work unless the user asks.

| # | Finding | Where |
|---|---|---|
| F-1 | The profile card shows a job title but the edit mode has **no field to change it** | `page.tsx:786-790`, `:801-840` |
| F-2 | Marketing permission: a **failed save shows nothing** (only success shows a message) | `MarketingConsentPanel.tsx:181-200` |
| F-3 | Marketing permission: collapsing the row **drops unsaved edits** without warning (fixed by S-3 if Q-2 (a)) | `page.tsx:1063-1067` |
| F-4 | The page reads and writes `profiles` and `user_preferences` with the browser Supabase client (CLAUDE.md rule 1) | §4.6 |
| F-5 | Export data builds the file in the browser with `select('*')` on `plugin_connections` (owned by the data-export stream, DE-0) | `page.tsx:436-440` |
| F-6 | Avatar: in view mode a new avatar updates the screen; whether it is stored without pressing Save depends on `AvatarUpload` itself. Needs a quick check | `page.tsx:772-778` |
| F-7 | `FunnelDrawer` is named a drawer but renders as an in-page panel; the name may confuse future work | `FunnelDrawer.tsx:84-103` |
| F-17 | *(S-3 workplan, 2026-10-15)* Marketing permission: when the settings fail to load, the form still renders, seeded with empty values, and Save is still enabled. One press would overwrite the stored wording and postal address with nothing. **User decision 2026-10-15: fixed inside S-3.** SA ruling (S-3 workplan review, C-2): a client-only safety fix, no server change, no extra gate. On a failed first load, show an alert and Try again, with no fields and no Save. A failed reload after a *successful* save is not a load failure: the form stays, "Saved" shows, and the drawer is clean | `MarketingConsentPanel.tsx` `load()` |
| F-18 | *(S-3 workplan, 2026-10-15)* Marketing permission passes props that `SavedAddressPicker` no longer has (`selected`, `type AddressSource`) and omits its required `use`. These are the 2 pre-existing type errors in that file, and `use` is `undefined` at runtime. **User decision 2026-10-15: a separate task, not S-3.** SA finding (S-3 workplan review, ruling 3): the runtime impact is larger than drift. With no `selectedId` and no `current`, the picker takes its "empty form, fill the default" branch, so **for any business with a saved address, every open replaces the stored marketing postal address in the form with the book's default**, and Save writes it. A delete inside the picker re-runs the fill over typed text. Once S-3 lands, this also makes the consent drawer dirty on an untouched open, so it asks "Discard your changes?". S-3 must not work around this. F-18 is to be scheduled right after S-3: a panel-first fix, the `use` value decided through a shared-picker change under SA review, and a small full cycle | `MarketingConsentPanel.tsx`, the `SavedAddressPicker` call |
| F-19 | *(F-18 workplan, SA review 2026-10-15)* The delete confirmation in `SavedAddressPicker` is a hand-built `fixed z-[70]` overlay with no Escape handling. In the Marketing permission drawer, Escape with a dirty drawer opens "Discard your changes?" *under* that overlay; a second Escape recovers, and nothing is deleted or lost (S-3 R-4 / C-7, QA K15). It cannot simply move to `components/ui/dialog`: that primitive renders at a fixed `z-[60]` and `cn` does not merge classes, while the profile and invoice pickers render inside `ConfigurationDialog` at `z-[70]`, so the confirmation would open behind those two screens. A fix needs a layer option on the shared dialog primitive, or an Escape handler local to the picker. Each is a shared-component decision for SA. Low priority, safe and recoverable. Not in F-18 | `components/ui/SavedAddressPicker.tsx` (confirmation), `components/ui/dialog.tsx`, `ConfigurationDialog.tsx` |
| F-20 | *(S-4, SA code review 2026-10-15; Dev's draft label "F-19", renumbered because F-19 is the picker delete-confirm finding from the F-18 cycle)* The champion "invite accepted" email links to `/business-os/settings#settings-section-invite-friends`, but on a full page load the browser most likely finds no element to scroll to: the page shows a spinner until `loadData` finishes, and the invite row renders only after its own fetch. Pre-existing; S-4 neither fixes nor worsens it (QA Q9 records what actually happens). The email's button says "See your invitations", which since S-4 live in the drawer. **SA ruling (Q-2):** not in S-4, and not as a page-level hash reader (that would be a new deep-link mechanism, rule 7, and a hash is not removed by the C-3 `section`-only replace, so a reload would reopen the drawer). Preferred direction: point the email at `?section=invite-friends`, handled by the existing deep-link effect with the C-3 replace, the page passing an open request down to `InviteFriendsSection`, which honours it once its own fetch says eligible; keep the hash id on the row so emails already sent still land on the page. Touches `INVITER_ACTION_PATHS.champion` and the `invite-accepted.test.ts` pin, so it is its own small slice with an SA workplan review, or S-5 only if the S-5 workplan lists it explicitly. **SA ruling (S-5 code review, 2026-10-15, Q-4):** not in S-5. It is its own small slice with an SA workplan review. Not urgent, because the email still lands on the settings page | `lib/business-os/invites/inviterNotification.ts` (`INVITER_ACTION_PATHS.champion`), `app/business-os/settings/page.tsx` deep-link effect, `InviteFriendsSection.tsx` |
| F-21 | *(S-4, SA code review 2026-10-15; Dev observation O-1, extended)* The one-time invite link can disappear without Dismiss, with no way to get it back (the server stores a hash): (a) `handleSend` clears `sent` at the start of every send, so a second send replaces the first link, and a second send that is **refused** still wipes it; (b) after a successful send, if the list reload fails or comes back not eligible, `refresh()` sets the section to hidden, so the whole row and the open drawer vanish with the link inside. Both pre-existing (before S-4 the panel vanished the same way). The owner can revoke and re-invite, so nothing is lost for good. Suggested fix, client-only: replace `sent` only when a new link arrives; once the section has loaded, keep the last summary on a failed reload instead of hiding it (the F-17 rule: a failed reload is not a failed load). Low priority | `InviteFriendsSection.tsx` `handleSend`, `refresh` |
| F-22 | *(S-5 workplan, 2026-10-15; `?section=` audit)* Several senders link to `/business-os/settings?tab=…`: the Stripe Connect return and refresh URLs in three routes (`tab=payments&stripe=…`), `OperationalStatusCard` (`services`, `availability`, `payments`, `integrations`) and `ProcessFlowSection` (`availability`), but nothing on the settings page, or in Business OS outside Reports, reads `tab`. The owner lands on the plain account page. Pre-existing (those tabs moved out of this page earlier); not a `?section=` link, so not fixed in S-5. Needs a decision on where each should land (probably the Configuration window, as `?section=business` does). **SA ruling (S-5 code review, 2026-10-15, Q-5): Medium, schedule a small slice rather than only recording it.** Nothing reads `stripe=` either. The sender that matters is Stripe Connect: `StripeConnectWizard`, rendered in `ConfigurationDialog` and in onboarding (`/onboarding-build`), returns the owner from Stripe to the plain account page with no confirmation and the Configuration window closed. On `stripe=refresh` (an expired onboarding link) there is no way to retry, and an owner who started in onboarding is taken out of it. This is a money setup step. `OperationalStatusCard` is not rendered anywhere today, and `ProcessFlowSection` is one link, so both are low. Direction: point the three routes' return and refresh URLs at an existing `?section=…` deep link that opens the Configuration window on payments (the effect that already handles `?section=business`), with `refresh` restarting onboarding. Separate from Phases A and B. Before the workplan, the user answers two business questions: where should an owner land after Stripe (including when they started in onboarding), and should the payments settings open by themselves? | `app/api/payments/stripe-connect/*/route.ts`, `components/payments/StripeConnectWizard.tsx`, `components/business-os/insight/OperationalStatusCard.tsx`, `components/website/blocks/ProcessFlowSection.tsx` |
| F-23 | *(S-5, SA code review 2026-10-15)* **A log-out hardening fix was lost in a merge.** `c1a427e6` (Offir, 2026-09-22) gave the settings log-out a 2 s deadline on the audit write, a 5 s deadline on the global sign-out, a `try/finally` so the redirect always runs, and a clear of `sb-*-auth-token` storage keys matched by shape. It was not based on `31976f13` (2026-09-20), which moved log-out into the shared `signOutUser`. The merge kept the refactor's body and left the helpers orphaned (S-5 deleted them as dead code; behaviour unchanged). Effects today, for all three sign-out controls: (a) a request that never settles leaves the log-out spinner on forever, and the dialog cannot close; (b) `PERSON_SCOPED_STORAGE_KEYS` still names `sb-auth-token` / `supabase.auth.token`, which Supabase does not write; (c) auth-js `signOut` skips its local session removal on any error other than 401/403/404, so a 5xx on global sign-out sends the person to login while this browser stays signed in. Fix in `signOutUser`: port the deadlines, and make sure the local session is cleared whatever the server says (for example a `scope: 'local'` sign-out as a fallback). Correct the "nothing can trap someone" comment in `handleLogout`. This is an auth and security change shared by three controls, so it takes the full cycle, not the UI short path. Medium | `lib/client/auth-actions.ts` (`signOutUser`, `PERSON_SCOPED_STORAGE_KEYS`), `app/business-os/settings/page.tsx` `handleLogout` comment; original in `c1a427e6` |
| F-24 | *(D-1 SA workplan review, 2026-10-15; on `main`, pre-existing)* **The profile card's Save confirms the timezone for the owner.** `saveProfile()` with no overrides calls `persistTimezone(profile.timezone)`, which stamps `timezone_confirmed_at`. Editing a name therefore silently "answers" the timezone question with whatever is stored — the legacy default `'UTC'` or the IP-guessed onboarding zone — which is exactly what migration `20261007` exists to prevent. Medium. `saveProfile` is frozen for D-1 (C-13), so **the fix is added to D-2's scope**: the profile save must not re-send or re-confirm the timezone. D-1 Manual QA Q14 records today's behaviour. | `app/business-os/settings/page.tsx` `saveProfile` |
| F-25 | *(D-2 SA workplan review, 2026-10-15; pre-existing)* The profile card's **Cancel does not restore the edited name in page state**, so the unsaved name stays on screen (and, before D-2's F-24 split, the next timezone pick would have saved it). D-2 option (b) removes the save risk; the stale display remains. Low. The markup is frozen (C-13); fix when the card is next opened (e.g. D-4 or a UI follow-up). Also for **D-3 scope (SA-D2-8 / RK-2):** C-19's `setAvatarUrl` must work for an account with no `profiles` row (L-3 found 1 such account), with a test. | `app/business-os/settings/page.tsx` profile card |
| F-26 | **✅ CLOSED 2026-10-16 by D-3a (`20261070`, applied to production 2026-10-16).** *(D-3 SA workplan review, 2026-10-16; live check LC-2, pre-existing)* **Any signed-in account can delete, overwrite or upload any file in the `avatars` bucket directly through the Storage API.** Production has owner-scoped INSERT / UPDATE / DELETE policies **and** broad ones ("Users can upload / update / delete avatars": `bucket_id='avatars' AND auth.uid() IS NOT NULL`, role `public`). Permissive policies are OR'd, so the broad ones win. Two duplicate public SELECT policies also allow `list()`, and every legacy object name starts with its owner's user id. The bucket has no `file_size_limit` and no `allowed_mime_types` (LC-1), so any type and size can be stored. **High in kind, low exposure today** (4 profile pictures, before launch). (a) **It cannot be closed before D-3 is deployed:** today's hook uploads at the bucket root, which the owner-scoped INSERT rejects, so it depends on the broad INSERT. (b) **Fix = slice D-3a, right after D-3 is deployed:** drop all eight `avatars` policies (the bucket becomes service-role write only; public URLs keep working), set `file_size_limit 4194304` and the four image types, check LC-8 (owner of `storage.objects`; policy drops may have to go through the dashboard), capture the policies for rollback, checker on `pg_policies`. The user applies it by hand; no auto-merge. An optional stopgap now drops only the broad DELETE (user decision U-2). (c) Cleanup, not urgent: one public SVG under `website-logos/` (no writer in any commit; likely pre-commit dev code through F-27, or a manual upload), one `.ico` legacy avatar, 2 unreferenced objects. They go to the F-15 sweep, after a read-only "is it referenced" check; the user decides (U-4). Full ruling in the D-3 workplan | Supabase `storage.objects` policies and `storage.buckets` row for `avatars` (dashboard-created, not in the repo) |
| F-27 | **✅ Bucket part CLOSED 2026-10-16 by F-27a (`20261071`, applied to production 2026-10-16): no `website-images` policies, SVG removed, 5 MB kept.** *(D-3 SA workplan review, 2026-10-16; pre-existing)* **`POST /api/website/upload` lets the caller choose the storage bucket and folder, and writes with the service role.** `bucket` and `folder` come straight from the form (`formData.get('bucket')` / `'folder'`), so any signed-in account can put a file into **any bucket** whose type list accepts it (including the private `contact-documents` and `avatars`) under **any folder**, including another account's `<userId>/`. Storage RLS is bypassed. It cannot overwrite (`upsert: false`). The type check trusts the browser's claimed MIME and allows SVG, the extension comes from the file name, and `uploadError.message` / `deleteError.message` reach the client. DELETE takes `bucket` from the query (restricted to the caller's own `<userId>/` prefix, so it is not cross-account). No current caller passes a bucket other than the default `website-images`. `WebsiteSetupWizard` passes `folder="logos"`, which puts files outside the owner's folder, so the route's own DELETE then refuses them. **High (`tenant-isolation-guard` class: caller-supplied target on a service-role write).** Fix, a small server-only `fix/` slice outside this feature: accept only `website-images`, force the path under `<user.id>/` (keep a sanitised sub-folder), and stop returning storage messages. Byte-sniffing and SVG are a product decision for the website team. User decision U-3 on priority | `app/api/website/upload/route.ts`, `components/website/MediaUploader.tsx`, `components/business-os/WebsiteSetupWizard.tsx` |
| F-28 | *(D-3 workplan "also found", confirmed by SA 2026-10-16; pre-existing)* `profiles.avatar_url` is written with **any string** by `PUT /api/user/profile` (`route.ts:113`, `:166`; no Zod, F-9) and by the `ProfileTab` / `ProfileTabV2` browser upserts (F-14). The `/settings` and `/v2/settings` pages also seed the form with `user_metadata.avatar_url` (the Google photo) and a Save stores it (product behaviour). D-3's C-20 check makes these harmless to storage (an external or foreign URL is never deleted). A person can still point their own picture at any URL. Fix with F-9 / F-14: accept only `null` or a URL that passes the C-20 shape for the caller, plus an explicit external-photo rule if the Google photo is to stay. Low | `app/api/user/profile/route.ts`, `components/settings/ProfileTab.tsx`, `components/v2/settings/ProfileTabV2.tsx`, `app/(protected)/settings/page.tsx:125`, `app/v2/settings/page.tsx:105` |
| F-29 | *(D-3 workplan "also found", confirmed by SA 2026-10-16; pre-existing)* `ProfileTabV2` sends `role` in its browser `profiles` upsert (`:205`), and its UI offers a role picker. The `profiles_role_privilege_guard` trigger (`20261002`) silently keeps the old role and raises a `WARNING` on each such save, so it is **not exploitable**. It is log noise and a control that does nothing. Fix with F-14 (remove `role` from the payload and the picker). Low | `components/v2/settings/ProfileTabV2.tsx` |
| F-30 | *(C-c SA workplan review, 2026-10-16; Dev observation; pre-existing)* `middleware.ts:273` builds the auth cookie name from the **hard-coded** production project ref (`sb-jgccgkyhpwirgknnceoh-auth-token`) and reads only the chunks `.0`, `.1`, …. (a) In any other Supabase project (a local stack, or the planned Preview/staging environment) the onboarding redirect never fires; (b) a session small enough to be stored **unchunked** is not found either. Both fail **open** on the onboarding redirect only; access control is unaffected (the token is verified by `auth.getUser` in `onboardingVerdict`, and pages and routes authenticate on their own). `app/invite/__tests__/middleware.invite.test.ts` also hard-codes the ref. Fix: derive the key from `NEXT_PUBLIC_SUPABASE_URL` as supabase-js does, and read the whole cookie or its chunks. Low. **Not in C-c**; best done with the environment-readiness work | `middleware.ts` onboarding check, `app/invite/__tests__/middleware.invite.test.ts` |

---

## 8. Notes on integration points

| Area | Files |
|---|---|
| Page | `app/business-os/settings/page.tsx` |
| Settings components | `components/business-os/settings/PlanSection.tsx`, `InviteFriendsSection.tsx`, `MarketingConsentPanel.tsx`, `TabFooter.tsx` (pattern to reuse) |
| Drawer shell | `components/ui/sheet.tsx`; reference shells `components/payments/MoneyDetailDrawer.tsx`, `components/crm/contact-drawer/CRMContactDrawerV2.tsx` |
| Deep links | `lib/business-os/journeyGapFix.ts`, `components/business-os/setup/useGapFix.ts`, `components/business-os/setup/JourneyGapNotice.tsx`, the plan pill (`components/business-os/PlanBadgePill.tsx`) |
| Publish gate | `lib/business-os/journeyReadiness.ts` (`timezone` gap reads `user_preferences.timezone` and `timezone_confirmed_at`) |
| Configuration window | `components/business-os/ConfigurationDialogProvider.tsx`, `ConfigurationDialog.tsx` (business and invoice details live here) |
| APIs used (unchanged) | `/api/business-os/entitlements/my-plan`, `/api/business-os/friend-invites`, `/api/business-os/consent-settings`, the password change route via `lib/client/change-password` |
| Tables (unchanged) | `profiles`, `user_preferences`; business currency via `LanguageContext.setCurrency` |
| Related requirements | `ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` §5.8, `ADMIN_LAYOUT_FOLLOWUPS_REQUIREMENT.md` §3, `BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` (DE-0), the purge requirement (Delete account) |

---

## 9. Added scope (2026-10-14): direct database calls and logging

> **User instruction (2026-10-14):** "Align logging where it's needed. Include slices to fix direct database calls."

This section adds two slice groups to the drawer work: **D-slices** move every browser database call on the settings page behind server routes and repositories (CLAUDE.md rule 1), and **L-slices** convert the `console.*` calls in files this feature touches or depends on (CLAUDE.md § Logging). It answers F-4 (§7) and leaves F-5 to the data-export stream. Every count below was taken on `main` on 2026-10-14 with grep. Nothing here changes code.

### 9.1 Inventory: every direct database call

**On the page** (`app/business-os/settings/page.tsx`, browser client `supabase` from `@/lib/supabaseClient`, imported at `:16`):

| # | Function | Table | Operation | Reads / writes | Line |
|---|---|---|---|---|---|
| P-1 | `loadData` | `profiles` | select `.single()` by `id` | Reads `full_name, avatar_url, job_title` for the profile card | `:205` |
| P-2 | `loadData` | `user_preferences` | select `.maybeSingle()` by `user_id` | Reads `timezone` for the Timezone row | `:206` |
| P-3 | `persistTimezone` | `user_preferences` | upsert on `user_id` | Writes `timezone`, `timezone_confirmed_at`, `preferred_language` (carried so a newly created row does not land on the `en` default), `updated_at` | `:255-266` |
| P-4 | `persistTimezone` | `profiles` | update by `id` | Mirrors `timezone`, `updated_at`; a failure is logged, not fatal | `:278-281` |
| P-5 | `persistTimezone` | `user_preferences` | select `.maybeSingle()` | **Read-back**: proves the zone stored; a mismatch fails the save | `:287-288` |
| P-6 | `saveProfile` | `profiles` | upsert on `id` | Writes `full_name, avatar_url, job_title, updated_at`; then calls `persistTimezone` when a zone is set | `:313-319` |
| P-7 | `handleExportData` | `profiles` | select `*` | Whole profile row into the downloaded file | `:437` |
| P-8 | `handleExportData` | `user_preferences` | select `*` | Whole preferences row into the file | `:438` |
| P-9 | `handleExportData` | `plugin_connections` | select `*` | **Every column, including OAuth tokens**, into the file (DE-0) | `:439` |

The page's other `supabase` mentions (`:240`, `:403`, `:474`, `:534`) are comments. Sign-out goes through `signOutUser` (`lib/client/auth-actions.ts`) and the password through `changePassword` → `/api/user/change-password`. Neither is table access.

**In the components the page renders** (one level deep, plus what they import from `components/business-os/` or `components/settings/`):

| Component | Direct DB calls | Notes |
|---|---|---|
| `PlanSection.tsx` | None | `fetch('/api/business-os/entitlements/my-plan')` |
| `InviteFriendsSection.tsx` | None | `fetch('/api/business-os/friend-invites…')` |
| `MarketingConsentPanel.tsx` (+ `SavedAddressPicker`, `Switch`) | None | `fetch('/api/business-os/consent-settings')` |
| `DangerZonePanel.tsx` (`ErasureRequestContent`) | None | — |
| `ConfigurationDialogProvider.tsx` / `ConfigurationDialog.tsx` | None in these two files | The window's own sections are outside this feature (it is opened, not changed) |
| `LanguageContext.tsx` | None for tables since PR #156 | Only `supabase.auth.getUser()` (`:225`); data goes through `/api/business-os/preferences` |
| `UserProvider.tsx` | None | Auth session only |
| **`components/ui/AvatarUpload.tsx` → `components/onboarding/hooks/useAvatarUpload.ts`** | **Yes, 7** | See below |

**`useAvatarUpload.ts`** (rendered on the page by `AvatarUpload`, `page.tsx:772-778`; the same hook also serves `components/settings/ProfileTab.tsx` and `components/v2/settings/ProfileTabV2.tsx`):

| # | Function | Target | Operation | What it does | Line |
|---|---|---|---|---|---|
| A-1 | `uploadAvatar` | `profiles` | select `.single()` | Reads the old `avatar_url` | `:46-50` |
| A-2 | `uploadAvatar` | storage `avatars` | remove | Deletes the old file (root path) | `:56-58` |
| A-3 | `uploadAvatar` | storage `avatars` | upload, then `getPublicUrl` | Stores the new picture publicly | `:63-79` |
| A-4 | `uploadAvatar` | `profiles` | update by `id` | Writes `avatar_url` **immediately** | `:84-90` |
| A-5 | `deleteAvatar` | `profiles` | select `.single()` | Reads `avatar_url` | `:128-132` |
| A-6 | `deleteAvatar` | storage `avatars` | remove | Removes `avatars/${fileName}`, a **different path** from the one upload uses (F-8) | `:138-140` |
| A-7 | `deleteAvatar` | `profiles` | update by `id` | Clears `avatar_url` | `:145-151` |

This answers **F-6**: a new avatar is stored the moment it is picked (A-4), before the owner presses Save; `saveProfile` then writes the same URL again.

### 9.2 Existing infrastructure to reuse

| Need | Existing | Covers today | Gap |
|---|---|---|---|
| Read the timezone (P-2) | `GET /api/business-os/preferences` → `userPreferencesRepository.findLocale` | **Yes.** Returns `locale.timezone` raw, `null` when unset, and a `null` half when the read fails | None. `LanguageContext` already calls it, so the page can reuse the same response |
| Write the timezone (P-3, P-4, P-5) | `PATCH /api/business-os/preferences` (`{ language }` or `{ currency }`, one per request, Zod `.strict()`, Pino + `correlationId`, non-blocking audit) | **No.** No `{ timezone }` variant; `UserPreferencesRepository` has no timezone write and `UserProfileRepository` no timezone mirror | Add a third variant to the existing union plus two repository methods (D-1). The route's one-setting-per-request shape already fits |
| Keep a new `user_preferences` row off the `en` default | `businessProfileRepository.findLanguage(userId)` exists (`BusinessProfileRepository.ts:1314`), and language is always dual-written (`lib/business-os/userLanguage.ts`) | Partly | The server can carry the stored language into a new row instead of trusting the browser. SA chooses the mechanism (D-1) |
| Read and save the profile card (P-1, P-6) | `userProfileRepository` (server-side, service role): `findById` reads `id, full_name, role, company, timezone`; no `avatar_url` / `job_title` read; no write method | **No** | New read and write methods (D-2) |
| A profile route | `GET/PUT /api/user/profile` | **Not reusable as is.** Agent-platform route; uses a cookie client with direct `.from('profiles')` calls (no repository), no Zod, returns `error.message` to the client, and its timezone mirror omits `preferred_language`. Used by the agent-platform settings | Do not extend it for Business OS (F-9). A small Business OS route is proposed (D-2); SA rules on name and placement |
| — | `GET /api/business-os/profile` | Reads **`business_profiles`** (business details), not `profiles`; it also calls `supabaseServer` directly (F-10) | Different table. Not reused |
| Export (P-7 to P-9) | `GET /api/user/data-export`: every read through a repository, named columns, no plugin tokens | **Yes** | Owned by **DE-0a** (`BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md` §0.1, §5): the three Export buttons, this page's included, download from that route and the browser builders are deleted. **No D-slice duplicates it** |

**Rules any timezone change must keep** (§4.2, CLAUDE.md § Currency & Timezone): `user_preferences.timezone` is the authority; `timezone_confirmed_at` is written on every human answer; the stored value is **read back** and a mismatch is a failure, not a success; `NULL` ("not asked") and `'UTC'` ("chose UTC") stay distinguishable. So the route never substitutes a default, and an empty or unknown zone is a 400, not a write. `business_profiles.timezone` is never named.

### 9.3 D-slices: direct database calls

**C-9 is lifted for the D-slices only, and only as stated here (SA to confirm).** D-1 may change `persistTimezone` and the timezone half of `loadData`; D-2 may change `saveProfile` and the profile half of `loadData`; D-3 may change `useAvatarUpload`. `handleExportData` stays untouched (DE-0a owns it). The Language, Currency and Timezone **rows** keep their markup; only the handlers they call change. S-1 to S-5 stay bound by C-9 as written.

| Slice | Scope | Reuse | Tests affected | Effort | Path |
|---|---|---|---|---|---|
| **D-1 — Timezone behind the preferences route** | Add `{ timezone }` to `PATCH /api/business-os/preferences`: validated as a real IANA zone, never defaulted. The route writes `user_preferences` (`timezone`, `timezone_confirmed_at`, `updated_at`, and the stored language when the row is new), mirrors `profiles.timezone` (failure logged, not fatal, as today), then **reads back** through `findLocale` and returns success only if the stored value matches. Audit with the existing `SETTINGS_PREFERENCES_UPDATED`. On the page, `persistTimezone` becomes a call to that route (keeping its "return the zone or null" contract) and the timezone read in `loadData` uses `GET /api/business-os/preferences`. Removes P-2 to P-5 | The route, its Zod union, `findLocale`, `findLanguage`; two new repository methods (`UserPreferencesRepository` timezone save, `UserProfileRepository` timezone mirror) | `app/api/business-os/preferences/__tests__/route.test.ts` extended: happy path, 401, invalid zone 400, read-back mismatch is a failure, mirror failure is not; unit test per new repository method. `journeyReadiness.test.ts` and the C-2 timezone guard stay green | 🟡 ~2 d | **Full cycle** (data write that governs the publish gate) |
| **D-2 — Profile card behind a Business OS route** | A small route (`GET` + `PATCH`; SA names it) for `full_name`, `avatar_url`, `job_title`, built with the `new-api-route` pattern: `getUser()` (user id never from the body), Zod `.strict()` (so `role` or any other column is rejected), repository access scoped to the caller's id, Pino + `correlationId`, non-blocking audit (`PROFILE_UPDATED`), standard error format. `saveProfile` calls it, then D-1's route when a zone is set; the profile half of `loadData` reads it. Removes P-1 and P-6 | `userProfileRepository` (two new methods: settings-card read, settings-card write); the `PROFILE_UPDATED` audit event | `greetingUsesTheEditedName.guard.test.ts` **must change**: it pins `from('profiles').upsert({` and `full_name: next.full_name` in `page.tsx`. It should instead pin that the page sends `full_name` to the new route and the route writes `profiles.full_name` through the repository, while My Day still reads it through `findById`. New route integration test (happy, 401, invalid input, `role` rejected); unit tests per repository method. `lib/admin/__tests__/admin-authz-surface.guard.test.ts` stays green | 🟡 ~2 d | **Full cycle** (new route, personal data) |
| **D-3 — Avatar hook behind the profile route (+ L-1)** | `useAvatarUpload` stops reading and writing `profiles` from the browser (A-1, A-4, A-5, A-7): the old URL and the new one go through D-2's route. SA rules whether the storage upload and removal (A-2, A-3, A-6) also move server-side or stay in the browser under the bucket's policies (storage is not a table, but the old-file removal depends on a profile read). Fixes **F-8** so a removed photo's file is actually deleted. Folds in **L-1** (3 `console.error` → Pino). The hook is shared: QA checks all three surfaces (this page, `ProfileTab`, `ProfileTabV2`) | D-2's route; the client `createLogger` pattern (§9.4) | No existing test pins the hook (none found). New source guard: the hook has no `.from('profiles')` and no `console.*` | 🟢–🟡 ~1–1.5 d | **Full cycle** (shared hook, personal data, public files) |
| **D-4 — Rule-1 guard for the settings page** | Once D-1, D-2 and **DE-0a** are merged, the page has no table access left: remove the `supabase` import from `page.tsx` and add a Jest source guard that `page.tsx` and `useAvatarUpload.ts` contain no `.from(` and that `page.tsx` does not import `@/lib/supabaseClient`, with a negative control | — | New guard only | 🟢 ~0.5 d | UI short path (test only), SA-confirmed |
| *(no D-slice)* **Export** | P-7 to P-9 are DE-0a's. **Dependency:** D-4 cannot land until DE-0a is merged; until then the page keeps its export handler and F-5 stands | `GET /api/user/data-export` | DE-0a's own guard | — | Data-export stream |

**S-6 interaction.** S-6 (timezone set in place) was blocked on the timezone write moving behind an API route (§4.6, SA-4). D-1 removes that blocker. **S-6 stays unscheduled** (Q-4 (b)); if the user asks for it later, it calls D-1's route and needs no data-access work of its own.

### 9.4 Logging inventory

`console.*` counts on `main`, 2026-10-14 (grep `console\.`; two hits in purge files that are only the words "debug console" in comments are excluded):

| File | Role in this feature | `console.*` | Pino (`createLogger`) | Verdict |
|---|---|---|---|---|
| `app/business-os/settings/page.tsx` | Touched (S-, D-slices) | 0 | Yes | Compliant |
| `components/business-os/settings/PlanSection.tsx`, `InviteFriendsSection.tsx`, `MarketingConsentPanel.tsx` | Touched (S-1, S-3, S-4) | 0 each | Yes | Compliant |
| `components/business-os/settings/TabFooter.tsx`, `components/business-os/purge/DangerZonePanel.tsx`, `components/ui/AvatarUpload.tsx`, `components/ui/SavedAddressPicker.tsx`, `components/ui/sheet.tsx`, `components/ui/dialog.tsx` | Rendered / reused | 0 each | No logger (none needed: nothing to log) | Compliant |
| **`components/onboarding/hooks/useAvatarUpload.ts`** | Rendered via `AvatarUpload`; touched by D-3 | **3** (`:101`, `:102` dumps the whole error with `JSON.stringify`, `:161`) | No | **Non-compliant → L-1, folded into D-3** |
| `components/business-os/ConfigurationDialogProvider.tsx`, `ConfigurationDialog.tsx` | Opened from the page, not changed | 0 | Dialog: yes | Compliant |
| `lib/business-os/LanguageContext.tsx`, `components/UserProvider.tsx`, `lib/client/change-password.ts`, `lib/client/auth-actions.ts`, `lib/authIdentities.ts` | Depended on | 0 each | — | Compliant |
| `app/api/business-os/preferences/route.ts` | Reused and extended (D-1) | 0 | Yes: `logger.child({ correlationId })`, context first, `{ err }` | Compliant. D-1 keeps the pattern |
| `lib/repositories/UserPreferencesRepository.ts` | Extended (D-1) | 0 | Yes; errors logged as `{ dbError: safeDbError(…) }`, the repositories' established redacted variant | Compliant. New methods follow the same shape |
| `lib/repositories/UserProfileRepository.ts` | Extended (D-1, D-2) | 0 | Yes; `{ err }` | Compliant |
| `lib/repositories/BusinessProfileRepository.ts` | Reused (`findLanguage`) | 0 | Yes | Compliant |
| `app/api/user/data-export/route.ts` | Reused by DE-0a | 0 | Yes | Compliant |
| `app/api/user/profile/route.ts`, `app/api/business-os/profile/route.ts` | **Not** reused (§9.2) | 0 each | Yes, with `correlationId` | Logging compliant; data access is not (F-9, F-10) |
| `components/payments/MoneyDetailDrawer.tsx` | Drawer reference | 0 | — | Compliant |
| **`components/crm/contact-drawer/CRMContactDrawerV2.tsx`** | Drawer reference only, **not touched** (C-9) | **18** | Yes (it has a logger, but not everywhere) | **Non-compliant → L-2, separate** |
| `components/business-os/settings/InvoiceSettingsSection.tsx`, `BusinessTab.tsx` | Same folder, but **not** rendered by the page and not touched (the invoice section lives in the Configuration window) | 2 each | No | Out of scope (F-11) |

**Client-side pattern to follow.** `'use client'` files in this feature already use the server logger module directly: a module-level `const logger = createLogger({ module: '…' })` from `@/lib/logger` (`page.tsx:47-49`, `PlanSection.tsx:44-46`, `InviteFriendsSection.tsx:36-46`, `MarketingConsentPanel.tsx:42-44`), then `logger.error({ err }, 'message')`. L-1 copies that; no new client logging pattern is introduced. Error objects go in as `{ err }`, never `JSON.stringify(error)`, and no file names, URLs or personal values are added to log context beyond the user id the page already logs.

### 9.5 L-slices: logging

| Slice | Scope | Effort | Path |
|---|---|---|---|
| **L-1 — Avatar hook to Pino** | 3 `console.error` in `useAvatarUpload.ts` → `createLogger({ module: … })`, `{ err }`; drop the `JSON.stringify(error)` dump. **Folded into D-3**, which already rewrites the hook | 🟢 (inside D-3) | With D-3 |
| **L-2 — Contact drawer to Pino** | 18 `console.*` in `CRMContactDrawerV2.tsx` → its existing logger. **Not part of this feature:** the file is a reference shell and C-9 forbids changing it here. Recommended as its own small slice or a separate task, run whenever convenient; no dependency on S-, D- or L-1 | 🟢 ~0.5 d | UI short path (logging only, no behaviour change), SA code review |

No other file this feature touches or depends on needs a logging change. New code in D-1 and D-2 must ship compliant (Pino, `correlationId`, `{ err }`, no `console.*`).

### 9.6 New findings

| # | Finding | Where | Handled by |
|---|---|---|---|
| F-6 | **Answered:** a new avatar is stored immediately on pick, not on Save | `useAvatarUpload.ts:84-90` | Recorded; D-3 keeps or changes it only if SA rules |
| F-8 | Removing an avatar deletes `avatars/<file>` but uploads are stored at the bucket root, so the **old picture file is never deleted** and stays reachable at its public address | `useAvatarUpload.ts:63-66` vs `:138-140` | D-3 |
| F-9 | `/api/user/profile` (agent platform) reads and writes `profiles` and `user_preferences` with direct calls, has no Zod, returns `error.message` to the client, and its timezone mirror omits `preferred_language` | `app/api/user/profile/route.ts` | Not this feature; candidate for a separate task |
| F-10 | `GET /api/business-os/profile` reads `business_profiles` with a direct `supabaseServer` call although `businessProfileRepository` exists | `app/api/business-os/profile/route.ts:24-28` | Not this feature; candidate for a separate task |
| F-11 | `InvoiceSettingsSection.tsx` and `BusinessTab.tsx` use `console.error` (2 each) | `components/business-os/settings/` | Not this feature; flag when the Configuration window is next touched |
| F-12 | `PATCH /api/business-os/preferences` returns Zod's `error.flatten()` as `details` in every environment, not only in development | `preferences/route.ts` (catch block) | Validation detail only, not an internal error; SA to say whether D-1 aligns it while it is open |

### 9.7 Updated slice order

Only real dependencies are hard; everything else is a recommendation. D- and S-slices are independent in behaviour but **both edit `page.tsx`**, so they run one at a time, each from fresh `main` (no stacked PRs).

> **Superseded 2026-10-14 (user re-sequencing, SA-approved with changes):** UI first. The table below this one is kept as the original BA order. The order in force is C-24 as amended; see "Re-sequencing (2026-10-14): UI first" at the end of the §9 SA review.

| Step | Slice | Hard dependency |
|---|---|---|
| parallel, now | **F-13 hotfix** (`fix/`, outside this feature) | None. Does not touch `page.tsx` |
| A1 | S-1 Wrapper + Plan drawer | SA approval (given) |
| A2 | S-2 Password drawer | S-1 |
| A3 | S-3 Marketing permission drawer | S-1 |
| A4 | S-4 Invite friends drawer | S-1 |
| A5 | S-5 Tidy the account card | S-2, S-3, S-4 |
| B1 | **D-1** Timezone behind the preferences route | F-13 merged (C-25) |
| B2 | **D-2** Profile card behind a Business OS route | D-1 (simpler, not hard) |
| B3 | **D-3** Avatar hook (+ L-1) | D-2 |
| B4 | **D-4** Rule-1 guard | D-1, D-2, D-3 **and DE-0a** |
| any | **L-2** Contact drawer logging | None (separate) |

*Original BA order (superseded):*

| Step | Slice | Hard dependency |
|---|---|---|
| 1 | S-1 Wrapper + Plan drawer | SA approval (given) |
| 2 | **D-1** Timezone behind the preferences route | SA approval of §9 |
| 3 | **D-2** Profile card behind a Business OS route | SA approval of §9 (independent of D-1 in code; `saveProfile` calls both, so D-1 first is simpler) |
| 4 | S-2 Password drawer | S-1 |
| 5 | S-3 Marketing permission drawer | S-1 |
| 6 | S-4 Invite friends drawer | S-1 |
| 7 | **D-3** Avatar hook (+ L-1) | D-2 |
| 8 | S-5 Tidy the account card | S-2, S-3, S-4 |
| 9 | **D-4** Rule-1 guard | D-1, D-2, D-3 **and DE-0a** (data-export stream) |
| any | **L-2** Contact drawer logging | None (separate) |
| — | S-6 (unscheduled) | D-1 (now its only data prerequisite) |

D-1 and D-2 are placed early because they are full-cycle data work and remove the page's last reason to talk to the database from the browser before the drawer slices reshape the file. If the user prefers the drawer moves first, D-1 to D-3 can follow S-5 with no change to their scope.

### 9.8 Questions for the user

None. Every choice in §9 is either a coding standard the user has already set or a technical decision for SA (route naming, whether avatar storage moves server-side, how a new preferences row gets its language, F-12).

---

## SA Review (2026-10-14)

**Reviewed by:** SA
**Verdict:** APPROVED WITH CONDITIONS. The drawer moves, the order, and the S-1 wrapper are approved. Dev may write the S-1 workplan now. Conditions C-1 to C-12 below are binding on the workplans. Every claim below was checked against `main` with `git grep`.

### SA-1. Architectural fit

- **No existing wrapper to reuse.** A search for a shared drawer component (`*Drawer*`, `DrawerShell`, settings or admin drawer wrappers) found nothing. The two Business OS drawers each put their own shell on `components/ui/sheet.tsx`. The admin drawers are dark-themed and admin-only (BA §1.2). Building the S-1 wrapper on `Sheet` with `MoneyDetailDrawer`'s classes is the right reuse. `ManageCategoriesDrawer` / `ManageGoalsDrawer` must not be used or copied.
- **Rule 7, wrapper:** approved as a new shared component with a narrow scope (C-1). It is a settings-only component, not a product-wide drawer. If it is later used outside `components/business-os/settings/`, that needs its own SA ruling.
- **Rule 7, unsaved-changes guard (S-3):** this is confirmed to be a new pattern. No customer-side dirty or discard guard exists today. The only hits are V1 agent-builder screens, and the Configuration window and `TabFooter` have none. The guard is approved here with a deliberately small shape (C-5). It is an opt-in prop on the settings wrapper, not a global hook, provider, `beforeunload` handler or router interceptor.

### SA-2. Rulings on the §4 decisions

| Decision | Ruling |
|---|---|
| `?section=` cleanup on close (Q-6 (a)) | Only when the drawer was opened **by the link**. Use `router.replace(pathname + remaining query, { scroll: false })` and delete **only** `section`. Every other parameter must survive, notably `checkout` (plan checkout return, C-11) and `tab`. Never use `push`. Opening a drawer from its row never writes the URL. The deep-link effect re-runs on the replaced params and finds no `section`, so it does nothing. That is correct. |
| Nested dialogs and popovers inside a Sheet | Layering is already correct on paper: Sheet overlay and content `z-50`, `Dialog` `z-[60]`, `Select` content `z-[100]` (portalled), `SavedAddressPicker` `fixed z-[70]` rendered in-tree. A confirmation dialog (discard, S-3) must be rendered **inside the SheetContent's React tree**, so Radix treats it as a nested layer and does not dismiss the sheet. The `useConfigurationDialogOpen` / `modal={!configurationOpen}` workaround in `CRMContactDrawerV2.tsx:3409-3434` is for a dialog mounted in a *different* tree (the provider). None of the four settings drawers opens the Configuration window, so **do not copy that workaround**. |
| Invite one-time link (Q-5 (a)) | Hold it in the component that renders the **row**. `InviteFriendsSection` stays mounted for the life of the page and already owns `sent` state (`:96`). The drawer content is its child, so unmounting the drawer content on close keeps the link. **Do not** use Radix `forceMount` to keep hidden DOM containing the link. **Do not** lift it to `page.tsx`. Never write it to the URL, `sessionStorage`/`localStorage`, or a log line. |
| In-flight save close refusal | Built into the S-1 wrapper as an `isBusy` prop, so S-2 and S-4 get it for free. While busy: ignore `onOpenChange(false)`, `preventDefault` on `onEscapeKeyDown` and `onInteractOutside`, and disable the drawer's own X. |

### SA-3. Deep links and the readiness gate

- **`?section=timezone`** is untouched by S-1 to S-5. The sender is `journeyGapFix.ts:78`, and its href is pinned by `lib/business-os/__tests__/journeyReadiness.test.ts:199`. The handler is `page.tsx:167-170` and the anchor is `page.tsx:944`. **No test pins the `settings-section-timezone` id or the timezone branch**, so C-2 adds one.
- **(a) Who sends `?section=plan`:** the BA was right about the pill, but the href is not written in the pill. It is the constant `PLAN_SECTION_HREF` in `lib/business-os/entitlements/planBadge.ts:48`, delivered through `readPlanBadge.ts` to `BusinessOSHeader` and then `PlanBadgePill.tsx`, which renders the `href` prop. **There is a second sender the BA missed:** the plan checkout return path `settings_plan: '/business-os/settings?section=plan'` (`lib/business-os/billing/planCheckout.ts:94`). Stripe appends `&checkout={CHECKOUT_SESSION_ID}` (`planCheckout.test.ts:345`). No settings surface starts that checkout today, but the plan-payments stream has reserved it (C-11).
- **(b) Who sends `?section=password`:** **nobody in the repo.** No code, email template or test builds it. Password reset goes to `/reset-password` (`lib/client/auth-actions.ts:206-209`), not to Settings. §4.1's "Password reset and email links" is therefore unverified and probably wrong. Keep honouring the link because it is cheap and old mail may exist, but nothing should be built on its behalf.
- **(c) Tests that pin the page or the expand behaviour:**
  - `lib/business-os/entitlements/__tests__/planBadge.test.ts:139-146` reads `page.tsx` source and requires `requested !== 'plan'` or `requested === 'plan'`.
  - `components/business-os/settings/__tests__/InviteFriendsSection.render.test.tsx:74,245` opens the section by its header **button**. This is the in-component expand that S-4 replaces.
  - `app/api/business-os/my-day/__tests__/greetingUsesTheEditedName.guard.test.ts` pins the `profiles` upsert in `page.tsx`.
  - `components/ui/__tests__/darkModeTokens.guard.test.ts:118-133` requires **exactly three** dropdown option rows with a specific class string in `page.tsx`.
  - No test pins the page-level expand-in-place for plan, password or consent.
- **A deep link the BA missed:** the champion "invite accepted" email links to `/business-os/settings#settings-section-invite-friends` (`lib/business-os/invites/inviterNotification.ts:119`, pinned by `lib/email/templates/__tests__/invite-accepted.test.ts:13`). It is a hash anchor, not `?section=`. S-4 must keep that id on the row (C-6).

### SA-4. Rule 1 (F-4)

Confirmed: S-1 to S-5 do not need `loadData`, `persistTimezone`, `saveProfile` or `handleExportData` (`page.tsx:204-207`, `:255-288`, `:313-319`, `:437-439`). Plan, Invite and Consent go through API routes. Password goes through `changePassword` (`lib/client/change-password`), and the code says so (`page.tsx:403`). **No slice is blocked on F-4.** Because S-1 to S-5 do not touch that code, they do not extend it, and the standing rule is satisfied. Any slice whose diff touches one of those four functions must stop and come back to SA. S-6, which is not scheduled, would be blocked on moving the timezone write behind an API route first.

### SA-5. Path per slice, and `console.*` counts

| Slice | Path | Reason |
|---|---|---|
| S-1 Wrapper + Plan | **Full cycle** | New shared component (rule 7), deep-link handler change, plan-checkout return path |
| S-2 Password | **UI short path** | Moves an existing form that already uses the API. SA code review checks that fields clear on close, nothing logs field values, and the busy refusal works |
| S-3 Marketing permission | **Full cycle** | New pattern (discard guard), legal content, and it fixes F-2 (failed save silent) |
| S-4 Invite friends | **UI short path, SA-confirmed**, with mandatory link-safety checks | The one-time link is a credential. SA code review and QA must both verify C-6 explicitly: link survives close and reopen, not in URL, storage or logs, anchor kept |
| S-5 Tidy | **UI short path** | Clean-up only (subject to C-8 on row values) |

**`console.*` counts (on `main`, 2026-10-14):** 0 in each of `app/business-os/settings/page.tsx` (it already uses `createLogger`), `PlanSection.tsx`, `InviteFriendsSection.tsx`, `MarketingConsentPanel.tsx`, `TabFooter.tsx`, `components/ui/sheet.tsx`, `components/ui/dialog.tsx`, `components/ui/SavedAddressPicker.tsx`, `MoneyDetailDrawer.tsx`, `PlanBadgePill.tsx`, `BusinessOSHeader.tsx`, `lib/client/change-password.ts`, `ConfigurationDialogProvider.tsx` / `ConfigurationDialog.tsx` and `planBadge.ts`. **`components/crm/contact-drawer/CRMContactDrawerV2.tsx` has 18.** It is a reference shell only. No slice may modify it. If one does, the Logging rule's flag → propose → convert applies.

### SA-6. Slice sizing and order

Sizing and order are sound (Q-7 (a)). There are two adjustments. First, the busy refusal moves into S-1, so S-4 no longer depends on S-3 and S-3 and S-4 are independent after S-2. Second, S-5's "every row shows its current value" can add page-load fetches (plan, consent counts) that do not exist today, so it is bounded by C-8.

### Conditions

1. **C-1 Wrapper scope.** One component in `components/business-os/settings/` on `components/ui/sheet.tsx`, using `MoneyDetailDrawer`'s shell classes:
   - `side={isRTL ? 'left' : 'right'}` and `dir` set
   - `w-full sm:max-w-xl`
   - `[&>button]:hidden` with its own X
   - a fixed header with `SheetTitle`
   - a single scroll body
   - an optional fixed footer slot modelled on `TabFooter`, reused and not copied

   Its props are `open`, `onOpenChange`, `title`, an optional meta line, `isBusy`, and (from S-3) `isDirty`. It has no context and no provider, and it imports nothing from `lib/business-os/entitlements/` (type-only included).
2. **C-2 Deep-link handler.** Change only the `plan` / `password` branch of the existing effect (`page.tsx:144-196`) so that it opens the drawer instead of `setExpandedSection`.
   - Keep a literal `requested === 'plan'` (or `!==`) comparison, or edit `planBadge.test.ts:139-146` in the same slice.
   - The `timezone`, `business` / `invoice` and `preferences` branches stay byte-for-byte.
   - S-1 adds a source-level Jest guard that `page.tsx` still contains `id="settings-section-timezone"` and the `requested === 'timezone'` → `scrollToSection('timezone')` branch.
3. **C-3 URL cleanup** exactly as ruled in SA-2: replace, link-opened only, delete only `section`, keep every other param.
4. **C-4 Busy refusal** in the wrapper from S-1, as ruled in SA-2.
5. **C-5 Discard guard (S-3).**
   - Opt-in `isDirty` on the wrapper. Closing while dirty opens a `components/ui/dialog` confirmation ("Discard your changes?") rendered inside the SheetContent tree. Confirm closes and drops the draft. Cancel keeps the drawer.
   - Not allowed: `window.confirm`, `beforeunload`, router interception, or a shared hook/provider.
   - The failed-save message (F-2) is shown inside the drawer.
   - The `dir="ltr"` switch wrapper (`MarketingConsentPanel.tsx:241-254`) survives.
6. **C-6 Invite (S-4).**
   - The one-time link stays in the row-owning `InviteFriendsSection` state, with no `forceMount` and nothing in the URL, storage or logs.
   - `id="settings-section-invite-friends"` stays on the always-rendered row, because the champion email links to it.
   - Fetch on page load stays, because eligibility decides whether the row renders.
   - Revoke confirmation stays inline.
   - `InviteFriendsSection.render.test.tsx` is updated for the drawer opener, and its "imports nothing from the entitlements module" test stays.
7. **C-7 Password (S-2).**
   - `passwordForm`, `showPassword` and `changingPassword` move out of `page.tsx` into the drawer content component, so unmounting clears them.
   - Field values are never logged.
   - The provider notice stays inline.
   - `?section=password` stays honoured (SA-3 (b)).
8. **C-8 Row values.**
   - S-1's plan row shows the title only, as today. The plan is fetched when the drawer content mounts on open, through the existing `PlanSection`.
   - Any row value that needs a **new** page-load request (plan name and price, consent counts) must be listed in the S-5 workplan with its request. If it is done, the drawer reuses the row's data instead of fetching twice.
   - Invite "N left" already loads on page load and is free.
9. **C-9 Untouchables.**
   - No slice modifies `loadData`, `persistTimezone`, `saveProfile`, `handleExportData`, the Language, Currency and Timezone rows, or `CRMContactDrawerV2.tsx`.
   - No new dropdown option rows with the guarded class string go into `page.tsx` (`darkModeTokens.guard.test.ts` counts exactly three).
10. **C-10 QA layering checklist** for each drawer slice, on desktop and phone, in English and Hebrew:
    - `Select` popover above the sheet
    - `SavedAddressPicker` (fixed, in-tree, z-70) positioned correctly inside the sliding sheet
    - invite native `<select>`
    - focus returns to the opener row
    - opener rows carry `aria-haspopup="dialog"`
11. **C-11 Plan-payments coordination.**
    - After S-1, the checkout return `?section=plan&checkout=…` opens the plan drawer.
    - S-1 must leave `checkout` in place and must not interpret it.
    - Putting the Stripe embedded checkout (iframe) inside the sheet's focus trap is a plan-payments decision for its own P-slice and needs SA there.
    - The S-1 workplan records the current P-slice state, as BA §4.7 asks.
12. **C-12 Test edits are planned.** Each workplan lists the tests it edits, from SA-3 (c), and keeps `PlanSection.render.test.tsx`, `InviteFriendsSection.render.test.tsx`, `journeyReadiness.test.ts`, `planBadge.test.ts`, `invite-accepted.test.ts`, `greetingUsesTheEditedName.guard.test.ts` and `darkModeTokens.guard.test.ts` green.

### SA Review of §9 (2026-10-14)

**Reviewed by:** SA, against `origin/main` `858f037d`.
**Verdict:** APPROVED WITH CONDITIONS. D-1, D-2, D-3, D-4 and L-2 are approved as slices, with three changes from §9: the avatar storage moves server-side to its own route (not through D-2's route), D-2's PATCH does **not** accept `avatar_url`, and F-12 is closed with no change. Conditions C-13 to C-26 below bind the D- and L-slice workplans. Each D-slice still needs its own Dev workplan and SA workplan review (full cycle).

#### Facts checked (grep on `main`)

| BA claim | Result |
|---|---|
| P-1 to P-9: page `.from(` calls at `:205`, `:206`, `:255`, `:278-279`, `:287-288`, `:313`, `:437-439`; other `supabase` mentions are comments (`:240`, `:403`, `:474`, `:534`) | ✅ Confirmed. **9 calls, not 11** as the §9 Change History row says. The table in §9.1 is right; the history row is wrong |
| A-1 to A-7 in `useAvatarUpload.ts`; 3 `console.error` (`:101`, `:102` with `JSON.stringify`, `:161`) | ✅ Confirmed |
| F-8: upload and replace act on the bucket root, remove acts on `avatars/<file>` | ✅ Confirmed (`:43`, `:56-58` vs `:138-140`). The *replace* path does delete the old root file. Only **Remove** leaves an orphan |
| F-6: avatar stored at pick, before Save | ✅ Confirmed (`:84-90`) |
| Three hook consumers | ✅ `AvatarUpload.tsx` is used by the BOS settings page, `components/settings/ProfileTab.tsx` (`app/(protected)/settings`) and `components/v2/settings/ProfileTabV2.tsx` (`app/v2/settings`) |
| `PATCH /api/business-os/preferences`: `{ language }` / `{ currency }` union, strict, Pino + `correlationId`, non-blocking audit | ✅ Confirmed (`route.ts:54-57`) |
| `findLocale` returns raw timezone; no timezone writer in `UserPreferencesRepository`; `UserProfileRepository` read-only (`findById` selects `id, full_name, role, company, timezone`) | ✅ Confirmed. The repository header says "intentionally read-only", so D-1/D-2 must rewrite that header |
| `businessProfileRepository.findLanguage` exists | ✅ `BusinessProfileRepository.ts:1314`, raw value, no try/catch (a rejected query reaches the caller) |
| F-9 `/api/user/profile`: direct `.from('profiles')` / `.from('user_preferences')`, `error.message` to client | ✅ Confirmed (`:47`, `:55`, `:71`, `:146`, `:173`, `:212`, `:272`). Not reusable |
| F-10 `/api/business-os/profile` reads `business_profiles` via `supabaseServer` | ✅ Confirmed (`:24-28`). Different table. Not reusable. Note there is also `/api/business-os/business-profile`, so a third "profile" name there would be ambiguous (C-17) |
| `console.*`: hook 3, `CRMContactDrawerV2.tsx` 18 (has a logger at `:1625`), `InvoiceSettingsSection.tsx` 2, `BusinessTab.tsx` 2; 0 in the route and both repositories | ✅ Confirmed |
| Page uses `createLogger({ module })` in a `'use client'` file | ✅ `page.tsx:47-49` |
| Timezone row saves through `saveProfile({ timezone })` | ✅ `page.tsx:983`. So a timezone pick also re-writes the profile card first. That matters for D-2 (C-18) |

**Not found by the BA, found here:**

- **F-13 (urgent, outside this feature).** `lib/services/ProposalAcceptanceService.ts:560` calls `userPreferencesRepository.findTimezone(...)`, and **that method does not exist on `main`**. It was added in `28f284e8` (session packages) and dropped by the merge `f66cae67` (2026-10-05). The unit test mocks it (`packageAcceptance.test.ts:39`), so Jest stays green. At runtime, accepting a session package would throw `findTimezone is not a function`. This is a TS2339 error, so TL should also check why the type-check did not catch it. **Escalated to TL as a separate `fix/` slice ahead of D-1. D-1 must not fold it in** (C-25).
- **F-14.** `ProfileTab.tsx` (`:244-255`, 2 `console.*` at `:307`, `:313`) and `ProfileTabV2.tsx` (`:192-203`) write `profiles` (including `avatar_url`) from the browser. These are agent-platform settings and outside this feature. Candidate task alongside F-9.
- **F-15.** No purge or cleanup code removes avatar files (`grep avatar` in `BusinessPurgeRepository` / purge: none). `TestAccountCleanupRepository`'s test assumes `avatars/<userId>/…`, but every avatar so far sits at the root as `<userId>-<ts>.<ext>`. Belongs to the purge / account-deletion stream. D-3's new path layout (C-19) makes a prefix sweep possible later.
- **F-16.** The hook accepts any `image/*`, so `image/svg+xml` goes into a **public** bucket today. D-3 closes it (C-19).

#### Rulings

**1. C-9 lift: confirmed, narrowed (C-13).**

**2. D-1 timezone write.**
- **Atomicity.** No transaction and no new RPC. A two-table write in one SQL function would be a new migration that the user applies by hand, for a mirror that is already best-effort today. The authority is `user_preferences`, and success is defined by the **read-back of the authority**, not by the mirror. The order is fixed: authority write, then mirror (only if the authority write succeeded), then read-back. A mirror failure is logged and is not fatal, as today.
- **New row's language.** It comes from the **server**, never the body. The route reads `businessProfileRepository.findLanguage(user.id)` and passes `normalizeLanguage(value)` (or `null`) to the repository. The insert sets `preferred_language` only when that value is non-null. When it is null or the read fails, the column default applies (today's worst case, F-3 in `userLanguage.ts`). That is logged at warn and does not fail the save. `findLanguage` can reject, so the route wraps it.
- **Repository shape.** `UserPreferencesRepository.saveConfirmedTimezone(userId, zone, { languageForNewRow }): RepositoryResult<true>` works in three steps. First it runs an UPDATE of `timezone`, `timezone_confirmed_at`, `updated_at` with `.eq('user_id', userId)` and `{ count: 'exact' }`, and no `.select()` (see the PostgREST update + select hazard). If the count is 0, it INSERTs `{ user_id, timezone, timezone_confirmed_at, updated_at, preferred_language? }`. On `23505` (a concurrent insert) it retries the UPDATE once. An upsert is **not** used: an upsert would overwrite `preferred_language` on existing rows if it is sent, and lands on `en` for new ones if it is not. Errors are reduced with `safeDbError`, like the file's other methods.
- The mirror is `UserProfileRepository.updateTimezoneMirror(userId, zone, stamp)`. It is a targeted UPDATE `.eq('id', userId)` and never creates a `profiles` row.
- The read-back reuses `findLocale`.

**3. D-2 route.**
- **Name:** `/api/business-os/account-profile` (GET + PATCH). `profile` and `business-profile` are both taken by `business_profiles` routes.
- **PATCH accepts:** `{ full_name?, job_title? }`, `.strict()`, at least one key. `role`, `avatar_url`, `id`, `timezone` and any other key are a 400.
- **Repository methods:** `findSettingsCard(userId)` selects exactly `full_name, avatar_url, job_title` with `.maybeSingle()`. `saveSettingsCard(userId, patch)` builds an allow-list payload with `id: userId` set last, then upserts `onConflict: 'id'`, matching today's behaviour for accounts with no row.
- **Non-reusable routes:** F-9 and F-10 are correctly judged non-reusable (facts above).

**4. D-3 avatar.**
- **Storage moves server-side** to `POST` / `DELETE /api/user/avatar`. That is a user-level route because two of the three consumers are agent-platform screens, and a `business-os` path would be wrong for them.
- **Why it moves:** the `avatars` bucket policies are not in the repo and cannot be verified, and the server-upload pattern already exists (`app/api/book/manage/[token]/intake/upload/route.ts`). There is also a security reason. The old-file delete is driven by `profiles.avatar_url`, which the browser can still write (F-14). If deletion runs as the service role, that value is a caller-supplied id, so it needs an ownership check (C-20).
- **F-8 is fixed inside D-3.** D-3 rewrites exactly that code, so a separate slice would touch the same lines twice.
- **QA scope:** all three surfaces (C-21).

**5. D-4 guard.** Approved as a Jest source guard (C-22). It reads two files with `fs` inside the existing required Jest job, which costs milliseconds and adds no job and no critical-path time, so it is compliant with the "no added CI time" rule. **D-4 waits for DE-0a.** No D-slice touches `handleExportData`.

**6. F-12: closed, no change.** The `new-api-route` skill (`SKILL.md:93-95`) itself returns `details: error.flatten()` for a `ZodError` in every environment. It is input-validation feedback about the client's own payload, not an internal error. D-1 must not "fix" it, and D-2 follows the skill the same way. If the user wants that changed, it is a skill-level change for every route, not a D-1 edit.

**7. Logging.** Counts confirmed. L-1 inside D-3 is right, and so is L-2 as its own slice. The client `createLogger({ module })` pattern is confirmed (`page.tsx`, `PlanSection`, `InviteFriendsSection`, `MarketingConsentPanel`). No new pattern.

**8. Order and paths.** See C-24.

**9. Security.**
- **Tenant isolation:** every new route takes the user id from `getUser()` only. Each repository method takes `userId` from the route and filters on it (`.eq('user_id')` for `user_preferences`, `.eq('id')` for `profiles`, equivalent per the repository header). Service-role use is documented in each repository header.
- **The one real cross-tenant vector** is the avatar delete path (C-20). D-2's allow-list (no `role`, no `avatar_url`) is the field-level half of `tenant-isolation-guard`.

#### Conditions (continued)

13. **C-13 C-9 lift, narrowed.**
    - D-1 may change only the body of `persistTimezone` (keeping its signature and its "zone or null" contract) and the timezone half of `loadData`.
    - D-2 may change only the profile write in `saveProfile` and the profile half of `loadData`.
    - D-3 may change `useAvatarUpload.ts`, plus `AvatarUpload.tsx` **only** for the size limit and its message. *Amended by SA, D-3 workplan review 2026-10-16 (Q-6):* D-3 may also change `AvatarUpload.tsx`'s `accept` attribute to `AVATAR_MIME_TYPES.join(',')` (imported from `lib/validation/avatar.ts`), and nothing else in that file.
    - D-4 may only remove the `supabase` import and add the guard.
    - Still frozen for every D-slice:
      - the Language, Currency and Timezone **rows**, byte for byte, including the `saveProfile({ timezone })` click at `:983`, the `settings-section-timezone` anchor, and the three guarded option rows
      - `handleExportData`
      - `ProfileTab.tsx` / `ProfileTabV2.tsx`
      - `CRMContactDrawerV2.tsx`, which only L-2 touches, for logging only
    - S-1 to S-5 stay bound by C-9 unchanged.
    - `loadData` keeps its "not gated on the profile row" behaviour. The two reads run in parallel, and a failure of one must not blank the other.
14. **C-14 D-1 route contract.**
    - Add a third union member, `z.object({ timezone: … }).strict()`.
    - The value must be a string of 1 to 64 characters matching `^[A-Za-z0-9_+\-/]+$` (no trimming: the stored value is exactly what was picked), **and** `new Intl.DateTimeFormat('en-US', { timeZone })` must not throw.
    - Use the constructor check, **not** membership in the server's `Intl.supportedValuesOf`. The browser's list and Node's list differ, `UTC` is not always in it, and the picker offers `UTC` (`page.tsx:663-669`). Put the check in `lib/scheduling/businessTime.ts` as a pure `isValidTimezone`, with a unit test. `safeTimezone` stays as it is.
    - No `null`, no default, no "unset" variant.
    - Order: write the authority, then the mirror, then the read-back. Success requires `findLocale(...).data.timezone === zone`. A read error or mismatch returns 500 "Failed to save the timezone" and logs at error level.
    - Audit `SETTINGS_PREFERENCES_UPDATED` with `changes.after = { timezone }`, non-blocking.
    - `business_profiles.timezone` is never named.
15. **C-15 D-1 repositories.**
    - `saveConfirmedTimezone` and `updateTimezoneMirror` exactly as ruled in item 2. The insert branch sets `preferred_language` only from the server-resolved language.
    - Update both repository headers: the "one writer" note in `UserPreferencesRepository` and the "intentionally read-only" note in `UserProfileRepository`.
    - One unit test per new method, covering: update hit; zero rows then insert, with and without a language; 23505 then retry; and error.
    - Route tests:
      - happy path
      - 401
      - empty, whitespace, unknown and `null` zone each give 400
      - `UTC` is accepted
      - read-back mismatch gives 500
      - mirror failure still gives 200
      - a new row carries the business language, not `en`
      - a body carrying `user_id` gives 400 (strict)
    - `journeyReadiness.test.ts` and the C-2 timezone guard stay green.
16. **C-16 D-1 page side.**
    - `persistTimezone` becomes one `fetch('/api/business-os/preferences', { method: 'PATCH', body: { timezone } })` and returns `zone` only on `success: true`.
    - The browser no longer sends a language.
    - The timezone read uses the GET's `locale.timezone`. A `null` half is logged and treated as unknown, as today.
    - `LanguageContext` is not changed.
17. **C-17 D-2 route.**
    - Location: `app/api/business-os/account-profile/route.ts`, built to the `new-api-route` skill's final checklist.
    - GET returns `{ full_name, avatar_url, job_title }`, using empty strings when no row exists (not 404). PATCH follows ruling 3.
    - Strings are trimmed. `full_name` is at most 120 characters, `job_title` at most 100, and empty is allowed.
    - Audit is `SETTINGS_PROFILE_UPDATED`, which has a metadata entry (`events.ts:733`); `PROFILE_UPDATED` has none. Record the changed **field names** only, never the name values.
    - Errors use the standard format, with no `error.message` to the client.
    - Tests:
      - happy GET and PATCH
      - 401
      - invalid type or length gives 400
      - `role` gives 400
      - `avatar_url` gives 400
      - an unknown key gives 400
      - an empty body gives 400
    - One unit test per repository method.
18. **C-18 D-2 page side and guard.**
    - ~~`saveProfile` PATCHes `{ full_name, job_title }`, no longer sends `avatar_url` (the hook already stored it, F-6), then calls D-1's route when a zone is set.~~ *Amended by SA, D-2 workplan review 2026-10-15 (Q-1, Q-2; F-24):* the card's Save (`saveProfile()`) PATCHes `{ full_name }` only. It sends no `avatar_url` (the hook already stored it, F-6), no `job_title` (the card has no field for it, F-1, and a failed read would blank it; the route still accepts it) and **no timezone**: it never calls `persistTimezone`, so a name save cannot stamp `timezone_confirmed_at` (F-24).
    - ~~Because the timezone row goes through `saveProfile`, a profile PATCH failure still blocks the timezone save, as today.~~ *Amended 2026-10-15:* the timezone row (`saveProfile({ timezone })`) calls only `persistTimezone(zone)`. It no longer re-writes the profile card, so a profile-route failure cannot block the timezone save, and a pick cannot save a half-typed or cancelled name. D-2 must still not make the PATCH stricter than today's upsert for existing data: existing names over 120 characters must still save. Dev checks the live maximum length with the `business-os-schema-check` skill and sets the limit at or above it (live check 2026-10-15: longest stored name 11 characters, job title 17).
    - `greetingUsesTheEditedName.guard.test.ts`, test "Settings writes the profile row", is rewritten to pin three things:
      - (a) `page.tsx` sends `full_name: next.full_name` to `'/api/business-os/account-profile'`
      - (b) the route calls `userProfileRepository.saveSettingsCard(user.id`
      - (c) `saveSettingsCard` writes `.from('profiles')` with `full_name`
    - The My Day assertions and the header tests are untouched.
19. **C-19 D-3 avatar route.**
    - `POST /api/user/avatar` (multipart field `file`) and `DELETE /api/user/avatar`, built to the `new-api-route` skill.
    - Accepted types, by server-checked MIME, are png, jpeg, webp and gif. **SVG is rejected** (F-16).
    - The extension is derived from the MIME type, never from the file name.
    - Maximum size is **4 MB**, a shared constant used by the client pre-check too. The Vercel request body limit is 4.5 MB, so today's 5 MB cannot arrive. Update the `AvatarUpload` message.
    - New object path: `<userId>/<randomUUID>.<ext>`.
    - The table read and write go through `UserProfileRepository` (`findAvatarUrl`, `setAvatarUrl`). Storage calls live in one server-only module (for example `lib/services/AvatarService.ts`) with the service-role reason documented, not inline in the route.
    - Upload order: upload new, then set `avatar_url`. If the set fails, remove the new file (as the intake route does). Then delete the old file under C-20. An old-file delete failure is logged, not fatal.
    - DELETE: clear `avatar_url`, then delete the file under C-20.
    - Errors to the client are user-friendly, never the storage message. Uploads are audited as `SETTINGS_PROFILE_UPDATED` with `fields: ['avatar_url']`, non-blocking. *Amended by SA, D-3 workplan review 2026-10-16 (Q-5):* removals are audited too, and both carry `change: 'uploaded' | 'removed'` (no URL or path).
    - F-6 behaviour (stored at pick) is kept.
20. **C-20 D-3 ownership check before any storage delete (fixes F-8, `tenant-isolation-guard`).**
    - Derive the object path from the stored URL only if it starts with this project's `…/storage/v1/object/public/avatars/` prefix.
    - Delete only if the path is `<userId>/…` or the legacy root form `^<userId>-\d+\.[A-Za-z0-9]+$`.
    - Anything else is skipped and logged at info, never deleted: an external URL such as a Google photo, another user's file, or an odd path.
    - Route tests include: a stored URL pointing at another user's file is **not** removed; a legacy root file **is** removed on Remove (the F-8 regression); a Google URL is not touched.
    - Past orphaned files are not swept (F-15).
21. **C-21 D-3 hook, L-1, QA.**
    - The hook keeps its public shape (`uploadAvatar(file) → url | null`, `deleteAvatar() → boolean`, `uploading`/`error`/`progress`) and calls the route.
    - It imports no `@/lib/supabaseClient`.
    - L-1: `const logger = createLogger({ module: 'useAvatarUpload' })`, `logger.error({ err }, '…')`, no `JSON.stringify`, no file name or URL in the log context.
    - D-3 ships the hook's source guard: no `supabaseClient` import, no `.from(`, no `.storage`, no `console.`.
    - The QA report records manual checks on **all three** surfaces (`/business-os/settings`, `/settings`, `/v2/settings`):
      - upload
      - replace, with the old public URL no longer served
      - remove, with the file gone
      - over 4 MB rejected
      - SVG and non-image rejected
      - signed-out 401
      - replacing a legacy root avatar
      - replacing a Google-photo avatar, with no delete attempted
22. **C-22 D-4 guard.**
    - One Jest file. With comments stripped (as `greetingUsesTheEditedName` does), it asserts that `app/business-os/settings/page.tsx` has no `@/lib/supabaseClient` import, no `.from(` and no `supabase.`.
    - It has a negative control: the same matcher run on a synthetic snippet must fail.
    - The hook half already exists from D-3 (C-21).
    - File reads only, inside the existing required Jest job. No new job, script or workflow step.
    - **Lands only after DE-0a is merged.** Before then the page still has `handleExportData`.
23. **C-23 Tenant isolation, all D-routes.**
    - The user id comes from `getUser()` only. No route accepts `user_id`, `id` or `userId` in the body or query; strict schemas make it a 400.
    - Repositories scope every query to the passed id.
    - No route returns another account's data. None of them takes an id, so there is nothing to pre-check except C-20.
24. **C-24 Order and paths.** *Amended 2026-10-14 (UI first, user request; SA re-check in "Re-sequencing (2026-10-14): UI first").* The order in force:
    - **In parallel, starting now:** F-13 hotfix (`fix/`, outside this feature, TL routes it). It does not gate Phase A.
    - **Phase A (UI):**
      1. S-1 (full cycle).
      2. S-2 (UI short path).
      3. S-3 (full cycle).
      4. S-4 (UI short path, SA-confirmed).
      5. S-5 (UI short path).
    - **Phase B (data/server):**
      6. D-1 (full cycle), only once F-13 has merged (C-25).
      7. D-2 (full cycle).
      8. D-3 + L-1 (full cycle).
      9. D-4 (UI short path; test-only plus one import removal; SA code review), after DE-0a.
    - Paths per slice are unchanged. The sequencing rules below still apply.

    ~~Superseded 2026-10-14, original order:~~
    1. ~~**F-13 hotfix** (`fix/`, outside this feature, TL routes it).~~
    2. ~~S-1 (full cycle).~~
    3. ~~D-1 (full cycle).~~
    4. ~~D-2 (full cycle).~~
    5. ~~S-2 (UI short path).~~
    6. ~~S-3 (full cycle).~~
    7. ~~S-4 (UI short path, SA-confirmed).~~
    8. ~~D-3 + L-1 (full cycle).~~
    9. ~~S-5 (UI short path).~~
    10. ~~D-4 (UI short path; test-only plus one import removal; SA code review), after DE-0a.~~

    Rules for the sequence:
    - L-2 can run at any time (C-26).
    - Every slice branches from fresh `main` after the previous one merges. No stacking, and no two open PRs that both edit `page.tsx`.
    - **DE-0a does not wait for any D- or S-slice.** It is a token leak and outranks this feature. Whichever of DE-0a and the current slice merges second rebases.
25. **C-25 F-13 is not D-1's.**
    - D-1 adds new timezone methods to `UserPreferencesRepository` but must not re-add `findTimezone` as a side effect.
    - If the hotfix has not merged when D-1 starts, D-1 stops and asks TL. This keeps the production fix reviewable on its own.
26. **C-26 L-2.**
    - `CRMContactDrawerV2.tsx`: all 18 `console.*` move to the existing `logger` (`:1625`), context first, errors as `{ err }`, with no behaviour change. No personal values (client names, emails, notes) are added to log context.
    - Path: UI short path with SA code review. Branch `fix/crm-contact-drawer-logging`.
    - Not part of the drawer feature's PRs.

#### Re-sequencing (2026-10-14): UI first

**Requested by:** the user, through TL. **Checked by:** SA, against `origin/main` `5946145d`.
**Verdict:** OK WITH CHANGES. Phase A (S-1 → S-5) then Phase B (D-1 → D-4) works. No S-slice depends on a D-slice or the reverse. Two conditions are tightened (C-8, C-13), C-24 and C-25 are amended, and one S-1 conflict that exists in **either** order is recorded (C-3 / C-12 note below). C-24 above holds the order in force.

**Dependency check (grep on `main`):**

| Concern | Result |
|---|---|
| S-5 vs D-2 / D-3 (profile card, avatar) | **No overlap.** S-5's "account card" is the **right** column (`page.tsx:988` onwards: Plan, Invite, Consent, Password, Export, Log out, Delete) plus the `expandedSection` state (`:108`) and its deep-link branch (`:191`). D-2 changes `saveProfile` (`:302-344`) and the profile half of `loadData` (`:199-207`), both in the **left** column's code. D-3 changes `useAvatarUpload.ts` and `AvatarUpload.tsx` only; the two `<AvatarUpload` usages in `page.tsx` (`:761`, `:792`) do not change. No right-card row shows a profile or avatar value. **S-5 stays in Phase A**, with the C-8 constraint below |
| C-8 row values and browser DB reads | A risk only if S-5 put its new row-value requests into `loadData` or used the browser client: D-1/D-2 would then rewrite them and D-4's guard would fail. C-9 already freezes `loadData`; C-8 now says so explicitly |
| `greetingUsesTheEditedName.guard.test.ts` | Pins `from('profiles').upsert({` and `full_name: next.full_name` in `page.tsx` (`:48-49`). S-slices do not touch `saveProfile` (C-9), so the pins stay green through Phase A unchanged; D-2 rewrites them as C-18 says. Order-neutral |
| `darkModeTokens.guard.test.ts` | Counts exactly three option rows (`:121-127`). S-slices add none (C-9), D-slices freeze the rows (C-13). Order-neutral |
| Wrapper `isBusy` / `isDirty` | Built in S-1 and S-3, used by S-2 to S-4. No D-slice renders the wrapper. Phase A completes the wrapper before Phase B starts, which is simpler than the old interleave |
| D-slice line references | C-13, C-14 and C-16 cite `page.tsx` lines that Phase A will move (the timezone click is already at `:972`, not `:983`). D-workplans locate code **by symbol and anchor**, not line, and re-verify against the post-S-5 `page.tsx` |
| F-13 | Still live on `main`: `ProposalAcceptanceService.ts:560` calls `findTimezone`, which `UserPreferencesRepository` does not define (only its header comment `:25` mentions it). The fix touches those two files, not `page.tsx` or any S-slice file. **It runs in parallel now.** The only shared file is `UserPreferencesRepository.ts`, which only D-1 extends, and D-1 is now later, so they cannot collide |

**Found while checking (affects S-1 in either order):** C-3 rules `router.replace(...)`, but `greetingUsesTheEditedName.guard.test.ts:87-90` asserts that `page.tsx` contains no `useRouter` at all (the router was removed with the back button). The S-1 workplan must choose one, listed under C-12:
- (preferred) edit that test in S-1 to drop only the blanket `useRouter` ban, keeping the `ArrowLeft` and `router.push('/business-os')` bans and adding one that `page.tsx` never calls `router.push(`; or
- do the cleanup outside `page.tsx`, in the settings drawer opener, with the same replace-only, `section`-only rules.

Either way C-3's behaviour is unchanged. `window.history` hand-edits are not a substitute (new pattern).

**Amended conditions:**
- **C-8 (tightened):** any row value S-5 adds is read through an **existing API route** (`/api/business-os/entitlements/my-plan`, `/api/business-os/consent-settings`) in its own effect or in the row's component, **never** inside `loadData`, and never through `supabase.` / `@/lib/supabaseClient`. The drawer reuses that data instead of fetching twice (unchanged).
- **C-13 (addition):** D-slice workplans locate frozen and editable code by symbol and anchor (`persistTimezone`, `saveProfile`, `loadData`, `id="settings-section-timezone"`, the three guarded option rows), not by the line numbers in C-13 to C-18, and record the `page.tsx` commit they verified against.
- **C-24:** amended in place (above).
- **C-25 (addition):** the F-13 hotfix starts now and does not wait for, or gate, Phase A. D-1's "stop and ask TL if F-13 has not merged" rule stands and is now expected to be moot.
- **C-3 / C-12 (note):** the `useRouter` conflict above is a planned S-1 test edit or placement choice, recorded in the S-1 workplan.
- **Unchanged:** C-1, C-2, C-4 to C-7, C-9 to C-11, C-14 to C-23, C-26. C-9 still binds S-1 to S-5; C-13's freezes still bind D-1 to D-4.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created | BA review of every function on the settings page against the product's drawer pattern; recommendation per function, constraints, slices S-0 to S-6, questions Q-1 to Q-7, findings F-1 to F-7 |
| 2026-10-14 | User answers recorded | All Q-1 to Q-7 recommendations accepted; S-6 not scheduled; sent to SA review |
| 2026-10-14 | SA review | APPROVED WITH CONDITIONS (C-1 to C-12). The wrapper and the scoped discard guard are approved under rule 7. Rulings on URL cleanup, nested layers, invite link holding and busy refusal. Deep links verified: `?section=plan` comes from `PLAN_SECTION_HREF` and the plan-checkout return; `?section=password` has no in-repo sender; the invite hash anchor was missed and is now a condition. Path per slice set; `console.*` is 0 in every touched file |
| 2026-10-14 | Scope extended (§9) | User instruction: "Align logging where it's needed. Include slices to fix direct database calls." Inventory of every browser database call on the page and its components (11 on the page, 7 in the avatar hook); reuse found (`/api/business-os/preferences`, both repositories, `/api/user/data-export`); slices D-1 to D-4 (export left to DE-0a); logging counts per file; slices L-1 (folded into D-3) and L-2 (contact drawer, separate); new findings F-8 to F-12 (F-6 answered). C-9 lifted for D-slices only, pending SA. Sent to SA review of §9 |
| 2026-10-14 | SA review of §9 | APPROVED WITH CONDITIONS (C-13 to C-26). C-9 lift confirmed and narrowed. D-1: `{ timezone }` on the preferences PATCH, validated with the `Intl.DateTimeFormat` constructor (not `supportedValuesOf`), no transaction, read-back of the authority defines success, new-row language from `business_profiles` server-side via `saveConfirmedTimezone` (update, then insert on zero rows). D-2: `/api/business-os/account-profile`, PATCH `{ full_name, job_title }` only (no `avatar_url`), audit `SETTINGS_PROFILE_UPDATED`. D-3: avatar storage moves server-side to `/api/user/avatar` (4 MB, no SVG, `<userId>/` paths, ownership check before any delete; F-8 fixed there). D-4 after DE-0a, inside the existing Jest job. F-12 closed (the skill's own pattern). Page DB-call count corrected to 9. New findings: F-13 (`findTimezone` missing on main, package acceptance throws; separate hotfix first), F-14, F-15, F-16 |
| 2026-10-14 | Re-sequenced: UI first | User request. SA check: OK with changes. Order now Phase A S-1 → S-5, then Phase B D-1 → D-4 (D-4 after DE-0a); F-13 hotfix in parallel now, not gating Phase A; L-2 any time. S-5 stays in Phase A (right-hand card only; no overlap with D-2/D-3). C-24 amended in place (old order struck through); C-8 tightened (S-5 row values via existing API routes, never in `loadData` or the browser client); C-13 and C-25 additions; §9.7 table updated. Found: C-3's `router.replace` conflicts with the `useRouter` ban in `greetingUsesTheEditedName.guard.test.ts`, a planned S-1 test edit |
| 2026-10-14 | S-1 workplan, SA review | Dev workplan written; SA APPROVED WITH CONDITIONS W-1 to W-8. Q-1: embedded checkout in the drawer cleared on the Boost precedent, no `isBusy` in S-1; `PlanUpgrade`'s 3-D Secure not covered, so a QA step and a conditional plan-payments go-live row (W-2). Q-2 accepted (link flag set on every `?section=plan`). Q-3: extra wrapper props accepted; the existing `TabFooterSlotProvider` is not a C-1 provider. Q-4: keep `id="settings-section-plan"` |
| 2026-10-15 | S-1 code complete | `SettingsDrawer` + `settingsUrlWithoutSection` created; plan row opens the drawer; `?section=plan` opens it and closing a link-opened drawer removes only `section` via `router.replace(…, { scroll: false })`. Greeting guard's router test now bans `router.push(` only; new C-2 / C-3 deep-link guard. Must-stay-green set green (17 suites, 542 tests); `test:bos-entitlements` green; `typecheck:bos-llm` 0 new. Uncommitted, awaiting SA code review and QA |
| 2026-10-15 | S-1 merge pending | PR #388 opened 2026-10-15 (SA APPROVED, QA PASS WITH NOTES); committed by RM under the user's Phase A pre-authorisation (2026-10-14: after SA approval, RM commits + opens PR without waiting for the user). W-2 go-live row 20 added to the plan-payments requirement §9.5. Manual QA Q1–Q13 owed |
| 2026-10-15 | S-2 code complete | Password drawer on `feature/settings-drawer-s2` (stacked on S-1's branch until #388 merges). Password form state moved out of `page.tsx` into `ChangePasswordDrawer` (C-7); the "link flag + replace on close" pair extracted into `useLinkOpenedDrawer` with its own unit test (SA S-1 finding 2) and used by both the plan and the password drawers; `?section=password` opens the drawer for password accounts, nothing for provider-only accounts (as today); provider notice stays inline. No new translation keys, no server change. Uncommitted, awaiting SA code review and QA |
| 2026-10-15 | S-3 workplan | Dev workplan for the Marketing permission drawer (full cycle), verified against `page.tsx` at `e9f0d103`. No deep link targets consent, so the deep-link effect is unchanged. The guard is an opt-in `isDirty` with typed prompt copy on `SettingsDrawer`. One close gate ordered busy, then dirty, then close; "Discard your changes?" is a `components/ui/dialog` inside the sheet's tree; Keep editing and every dismissive gesture keep the edits; Discard closes and the draft unmounts with the content. Fixed Save bar through the existing `TabFooterSlotProvider` (S-1 W-4). Save success and failure shown inside the drawer (F-2). Six new keys in en, he and es. New findings F-17 (a failed load still offers Save) and F-18 (`SavedAddressPicker` prop drift). Eight questions for SA. Awaiting SA workplan review |
| 2026-10-15 | S-3 SA workplan review | APPROVED WITH CONDITIONS (C-1 to C-9 in the S-3 workplan). User decisions recorded: F-17 fixed in S-3; F-18 a separate task. F-18's runtime impact is recorded in the F-18 row: the stored postal address is overwritten in the form on open, and the S-3 drawer opens dirty for businesses with a saved address, until F-18 ships |
| 2026-10-15 | S-3 code complete | Marketing permission drawer on `feature/settings-drawer-s3`, uncommitted. `SettingsDrawer` gains the fixed footer slot (the existing `TabFooterSlotProvider`, W-4) and the opt-in discard guard (`isDirty` + typed `discardCopy`, prompt inside `SheetContent`, gate busy then dirty then close). New `MarketingConsentDrawer`; the panel reports dirty and busy, shows save success and failure in the bar (F-2), and shows a load-failed screen with Try again and no Save before anything has loaded (F-17). `expandedSection` removed from the page; the C-2 timezone comment kept byte for byte. Six new keys in en, he and es; Hebrew "Discard" reworded per SA C-9. No server change. F-18 untouched (separate task) |
| 2026-10-15 | F-18 workplan | Dev workplan for F-18 (full cycle) on `fix/settings-consent-address-picker`, built on S-3 (`f7495ca6`, PR #397). The bug has been live since PR #229 (`800ce17f`, 2026-10-06); only owners who pressed Save on Marketing permission with a saved address could have had a stored postal address replaced. `use` decision: a new `AddressForm = AddressUse | 'marketing'` for the prop, with `AddressUse` (the pointer type behind `usedBy`) unchanged. The picker gains optional `matchCurrent` (mark the entry the text matches, never fill) and `otherLabel` (reuses the existing `settings.address.reuse_other`), and shows every other use in the hint. The panel drops `selected` and `AddressSource` (both `tsc` errors) and keeps edits typed during a save (SA finding 1). The picker's delete confirmation stays as it is: `components/ui/dialog` (z-60) would open under `ConfigurationDialog` (z-70). Proposed F-19. Read-only exposure SQL for the user (not run). Eight questions for SA |
| 2026-10-15 | F-18 SA workplan review | APPROVED WITH CONDITIONS (C-1 to C-10 in the F-18 workplan). `matchCurrent` approved over `fillEmpty`; `AddressForm` for `use` only; hint and label items in; keep-if-changed for edits typed during a save. No auto-fill in the marketing panel; the user is told as information. Exposure SQL verified and relayed unchanged; any repair is a separate user-approved task. Changes stay uncommitted until user approval, then `origin/main` is merged in (not rebased) after #397 merges. New finding F-19 (the picker's delete confirmation has no Escape handling and cannot move to `components/ui/dialog`, which sits at z-60 under `ConfigurationDialog`'s z-70) |
| 2026-10-15 | F-18 code complete | Dev, uncommitted on `fix/settings-consent-address-picker`. The shared picker gains optional props only (`AddressForm` for `use`, `matchCurrent` that marks and never fills, `otherLabel`, every other use in the hint); the profile and invoice callers pass none and are unchanged (their pin file untouched and green). Marketing permission now keeps its stored or profile-seeded postal line on open, marks the entry it matches, and keeps text typed during a save. The panel's 2 `tsc` errors are gone. 28 new tests, 14/14 mutations caught. Awaiting SA code review and QA (manual M1 to M11 on a test account) |
| 2026-10-15 | F-18 user test + decision | User reproduced the false "Discard your changes?" on an untouched open (test business with a saved address) and saw "Add a new address" selected. Diagnosis: sole cause is the S-3 picker auto-fill (F-18); nothing survives F-18. Post-QA tweak: postal line recognised in en/he/es one-line forms. **User decision:** when saved addresses exist but the marketing postal address is empty, the field stays empty with "Enter a different address" selected; the owner picks an address (no auto-fill, no pre-marking). |
| 2026-10-15 | S-4 code complete | Invite friends drawer on `feature/settings-drawer-s4` (from `origin/main` `eb2b9396`), uncommitted, UI short path. `InviteFriendsSection` keeps the page-load fetch, the draft, the in-flight flags and the one-time link; only its panel moved into a `SettingsDrawer` rendered as its own child, so the link survives close and reopen (Q-5 (a), C-6) and a closed drawer holds no hidden copy. Row: `aria-haspopup="dialog"`, "N of M invites left" (C-8), anchor `settings-section-invite-friends` kept. `isBusy` while a send or a revoke is in flight (C-4). A close clears a half-answered revoke confirmation, "Copied" and stale errors, never the link. No `isDirty` (the draft survives a close; Q-1 for SA). New `InviteFriendsSection.linkSafety.test.tsx` (15); `InviteFriendsSection.render.test.tsx` opener updated only. `page.tsx` untouched; no new keys; no server change. Open: Q-2 (hash opens the drawer?), F-19 (hash scroll on a full load, pre-existing) |
| 2026-10-15 | S-4 SA code review | APPROVED WITH CONDITIONS (S-4 workplan, SA Code Review). C-6, C-4, C-8, C-10 (code side) and C-12 verified; must-stay-green set re-run, 26 suites / 717 tests pass. Rulings: Q-1 keep the draft, no `isDirty`; Q-2 the hash does not open the drawer in S-4 and no page-level hash reader, preferred direction `?section=invite-friends` through the existing deep-link effect (F-20); Q-3 `isBusy` on revoke approved; Q-4 approved. Dev's "F-19" in the row above is renumbered **F-20** (F-19 is the picker delete-confirm finding from the F-18 cycle). New §7 rows F-20 (email hash) and F-21 (the link can disappear without Dismiss: a second or refused send, or a failed reload after a send). Condition for RM only: the branch predates #406, which edits this file, so merge `origin/main` and keep both sides (F-19 before F-20) |
| 2026-10-15 | S-5 code complete | Tidy the account card on `feature/settings-drawer-s5` (from `feature/settings-drawer-s4`), uncommitted, UI short path. `page.tsx` only: `rowChevron(tone)` mirrors every account-card chevron in Hebrew and marks it `aria-hidden` (Delete keeps its red as a tone, since `cn` does not merge classes); plan anchor kept with its reason (W-5); dead `withDeadline` and `clearSessionKeys` removed. Frozen code (C-9) untouched. Out, with reasons in the workplan: plan and consent row values (C-8), champion email `?section=invite-friends` (F-20). New `accountCard.guard.test.ts` (8); must-stay-green set 29 suites / 754 tests pass; 7/7 mutations caught. New finding F-22 |
| 2026-10-15 | S-5 SA code review | APPROVED (S-5 workplan, SA Code Review). SA re-ran the must-stay-green set: 29 suites / 754 tests pass. Frozen code is untouched, and `rowChevron` passes the tone as an argument, which is correct because `cn` does not merge classes. Rulings: Q-1 and Q-2 approved. Q-3: row values out, the plan name may be offered as an optional idea, consent status dropped. Q-4: F-20 is its own slice. Q-5: F-22 moved to Medium, schedule a slice (the Stripe Connect return lands on the plain page), with two business questions for the user. New §7 row F-23: Offir's log-out deadline and session-clear fix (`c1a427e6`) was lost in a merge with `31976f13`; it is to be ported into `signOutUser` in a full cycle |
| 2026-10-15 | Phase A complete; handover | §0 added: Phase A slices with PRs and merge commits, Phase B status and order, user-owed checks, open decisions (F-22, F-23) and follow-ups. The per-slice progress lines (S-1..S-5, F-18) and the old Status line were replaced by §0; their content lives in each workplan and in the rows above. |
| 2026-10-15 | Phase C parked; Phase B go-ahead | §0.6 added: Plan and Marketing permission drawer load-time investigation (user observation: 1–2 s / 1–3 s), findings and candidate slices C-1..C-7, parked by the user. User gave the go-ahead for Phase B (D-1 first); standard flow (user sees each diff, user merges). |
| 2026-10-15 | D-1 workplan | Dev workplan for the timezone write behind `PATCH /api/business-os/preferences` `{ timezone }` (full cycle), verified against `page.tsx` at `b848e267`. Strict 1–64 char member validated by a new `isValidTimezone` (constructor check); order authority write → best-effort mirror → read-back, success only on a matching read-back; `saveConfirmedTimezone` (update with exact count, insert on zero rows with the server-resolved business language, one retry on `23505`, no upsert) and `updateTimezoneMirror` (update only); `persistTimezone` becomes one PATCH and the `loadData` timezone read uses the GET. Found: Node 22 `Intl` accepts offset IDs (`+05`) that the C-14 regex lets through (Q-1). Live checks L-1 to L-3 owed by the user. Questions Q-1 to Q-8 for SA |
| 2026-10-15 | D-1 SA workplan review recorded (TL) | SA APPROVED WITH CONDITIONS SA-D1-1..SA-D1-9. **C-14 amended:** the timezone pattern is now `^[A-Za-z][A-Za-z0-9_+\-/]*$` (leading letter; blocks offset IDs such as `+05`), aliases and lowercase stored verbatim, no canonicalisation; `isValidTimezone` short-circuits over 64 chars and never throws. **F-24 added to §7 and to D-2's scope.** Merge of D-1 gated on the user's read-only live checks L-1..L-4 (SA-D1-7). |
| 2026-10-15 | F-23 moved into Phase C | User decision: the log-out hardening (F-23) is parked in Phase C as C-8 (§0.6), not scheduled before or inside Phase B. |
| 2026-10-15 | D-1 live checks and code complete | Live checks L-1a..L-4 (SA-D1-7) all PASS, run read-only by TL. Dev implemented D-1 per SA-D1-1..SA-D1-9; not committed. Covers the route's `{ timezone }` member and handler, two repository methods, `isValidTimezone` (shares `TIMEZONE_SHAPE` with the route), and on the page `persistTimezone` and the timezone half of `loadData`. Tests, type checks, lint and 19/19 mutations recorded in the D-1 workplan. Awaiting SA code review and QA |
| 2026-10-15 | D-2 workplan | Dev workplan for the profile card behind `/api/business-os/account-profile` plus F-24 (full cycle), on `feature/settings-drawer-d2-account-profile` from the D-1 branch (`06ceab3b`), verified against `page.tsx` at `e0c49f1f`. Strict PATCH `{ full_name?, job_title? }`; `findSettingsCard` / `saveSettingsCard`; CR-1 `safeDbError` across `UserProfileRepository`; F-24: the card's Save never sends a timezone. Live checks L-1 to L-5 owed by the user. Questions Q-1 to Q-9 for SA (incl. the C-18 amendment in Q-1 and sending `full_name` only in Q-2). No code |
| 2026-10-15 | D-2 SA workplan review; C-18 amended | SA APPROVED WITH CONDITIONS SA-D2-1..SA-D2-11 (in the D-2 workplan). **C-18 amended** (first two bullets): the card's Save PATCHes `{ full_name }` only and never sends a timezone (F-24); the timezone row calls only `persistTimezone` and no longer re-writes the card. CR-1 narrowed to `findById`, `updateTimezoneMirror` and the two new methods; the other three `UserProfileRepository` methods are follow-up CR-1b (Low). RK-2 (avatar lost for the one account with no `profiles` row) handed to D-3: `setAvatarUrl` (C-19) must work on a no-row account. Live checks L-1..L-5 all PASS |
| 2026-10-15 | F-25 + D-3 note (TL) | F-25 (Cancel does not restore the name) recorded in §7; RK-2 handed to D-3: `setAvatarUrl` must handle an account with no `profiles` row. |
| 2026-10-15 | D-2 code complete (Dev) | `/api/business-os/account-profile` `GET` + `PATCH`, `UserProfileRepository.findSettingsCard` / `saveSettingsCard`, CR-1 narrowed (CR-1b follow-up), page profile read and Save through the route, F-24 fixed (option (b)). Tests green, 29/29 mutations killed. Not committed; awaiting SA code review and QA. |
| 2026-10-16 | D-3 SA workplan review; C-13 and C-19 amended; F-26..F-29 | SA APPROVED WITH CONDITIONS SA-D3-1..SA-D3-12 (in the D-3 workplan); live checks LC-1..LC-7 (TL, read-only) recorded there. **C-13 amended:** `AvatarUpload.tsx` may also narrow `accept` to the shared type list. **C-19 amended:** removals are audited too (`change: 'uploaded' \| 'removed'`). New §7 rows: **F-26** (High, pre-existing: broad `avatars` storage policies let any signed-in account delete, overwrite or upload any file; fixed by a new slice **D-3a** after D-3 is deployed, because today's hook depends on the broad INSERT), **F-27** (High, pre-existing: `/api/website/upload` takes the bucket and folder from the caller and writes with the service role), F-28, F-29 (Low). User decisions U-1..U-5 listed in the workplan |
| 2026-10-16 | User decisions on D-3 (U-1..U-5) | **U-1:** D-3a approved — and **TL applies it** to production (user instruction), after D-3 is deployed, with the LC-8 owner pre-check, the eight policy rows saved for rollback, the checker and the functional check. **U-2:** no stopgap. **U-3:** F-27 is urgent — its own full-cycle slice, run alongside D-3/D-3a. **U-4:** ask Offir whether any unmerged work writes logos to `avatars`; leave the stray SVG for the F-15 sweep. **U-5:** manual QA on `/business-os/settings` only (TL runs it); D-3 auto-merges only after those checks pass. |
| 2026-10-16 | Owed items closed | User completed the browser checks (feedback in Phase C) and accepted the he/es wording; TL ran the F-18 exposure query on prod: 1 consent row, 0 saved since 2026-10-06 → nothing to repair. |
| 2026-10-16 | D-3 + L-1 code complete (Dev) | `POST` / `DELETE /api/user/avatar`, `AvatarService`, `lib/validation/avatar.ts`, `UserProfileRepository.findAvatarUrl` / `setAvatarUrl` / `clearAvatarUrl`, the hook through the route (L-1), `AvatarUpload.tsx` `accept` only. SA-D3-1..12 applied; no migration, no storage-policy change (D-3a follows deployment). Tests green, 33/33 mutations killed. Not committed; awaiting SA code review and QA. |
| 2026-10-16 | D-4 workplan + code complete (Dev) | UI short path (C-24). Unused browser `supabase` import removed from `page.tsx`; C-22 Jest source guard `noBrowserDb.guard.test.ts` added (no `supabaseClient` import, no `.from(`, no `supabase.`, comments stripped, negative controls). Checks green, 4/4 mutations killed ([D-4 workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_D4_WORKPLAN.md)). Not committed; awaiting SA code review |
| 2026-10-16 | D-3a + F-27a applied to production | TL applied `20261070` (avatars) and `20261071` (website-images) after the user removed the 8 + 4 policies in the Dashboard; checkers, probes and gates passed (0 policies on `storage.objects`; anon upload 403; public URLs 200). F-26 and the bucket part of F-27 closed. Recorded in the [lockdown workplan](/docs/workplans/STORAGE_BUCKET_LOCKDOWN_D3A_F27A_WORKPLAN.md); PR without auto-merge. User app checks F6 / F10 / F11 pending |
| 2026-10-16 | Phase C slice plan (Dev) | §0.6.1 added: findings P-1..P-5 from reading the code (the form already renders on consent, and the late part is the picker's own GET; the header badge names champions only, so C-1 folds into C-2; the three GETs are read-only; the C-8 route-literal guard stays green; no data-prefetch precedent, so rule 7 applies). Slices **C-a** Marketing permission (C-3, C-4, C-5; [workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_C_A_WORKPLAN.md)), **C-b** Plan (C-2, after C-a), **C-c** log-out hardening (C-8 / F-23, full cycle, can run alongside C-a); C-6 and C-7 deferred until measured. No code; awaiting SA review |
| 2026-10-16 | Phase C slice plan + C-a workplan SA review | §0.6.1 rulings R-1..R-7. C-a then C-b approved, one after the other. C-c approved in parallel if `signOutUser`'s shape is unchanged. Q-9 **not** moved: the `handleLogout` comment stays in C-c, as a recorded comment-only exception to the one-PR-on-`page.tsx` rule. C-1 folded into C-2 as an SA call (the header badge names champions only). C-6 and C-7 deferred. `useDrawerPrefetch` approved under rule 7 for the settings-page drawers, with no CLAUDE.md entry. C-b notes B-1..B-4 recorded in advance (StrictMode take outside the cancellable effect; checkout and upgrade re-reads always fetch). C-a workplan ✅ approved with conditions SA-CA-1..15 |
| 2026-10-16 | C-a code complete (Dev) | Marketing permission: address book read in parallel with consent and handed to the picker (`initialBook`), fixed-height placeholder, page-owned `useDrawerPrefetch` (idle + hover/focus/press, used once, 60 s, account + language key, off while loading or while Configuration is open). SA-CA-1..15 applied; F-18, S-3 and F-17 pinned with preloaded data. 26/26 mutations killed; must-stay-green set green. Measurement left for QA/TL. Not committed; awaiting SA code review and QA ([C-a workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_C_A_WORKPLAN.md)) |
| 2026-10-16 | C-a QA bug fix (Dev) | QA-CA-B1 (Medium) fixed with a `paused` hook option (rule 6, `paused: consentDrawerOpen`), not `!consentDrawerOpen` in `enabled` (that lost the handover: the drawer content mounts one commit after the drop on disable). Gaps QA-MU-1/4/7 closed; 14/14 mutations killed; must-stay-green 48 suites / 792. Awaiting SA re-check of rule 6 and a targeted re-QA. Not committed |
| 2026-10-16 | C-c workplan (Dev) | Log-out hardening (C-8 / F-23) planned on `fix/signout-hardening-c-c`: deadlines, cookie + storage clear by shape, network-free local fallback, never-rejecting `signOutUser`; callers unchanged; `handleLogout` comment fix in C-c (corrected by SA-CC-1) ([C-c workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_C_C_SIGNOUT_WORKPLAN.md)). Awaiting SA workplan review |
| 2026-10-16 | C-c SA workplan review + code complete (Dev) | SA approved with conditions SA-CC-1..16; applied. `signOutUser` hardened (deadlines, cookie and storage clear by shape, network-free local fallback, measured `clearedLocally`, single flight); `SignOutButton` proceeds when cleared locally; settings `handleLogout` comment only. New tests: unit, caller guard, `AdminHeader` 9 s deadline, two awaiting-payment cases. New §7 row **F-30** (Low, middleware hard-coded project ref, not in C-c). Not committed; awaiting SA code review and QA |
| 2026-10-16 | C-c reviewed (SA, QA, Dev) | SA code review APPROVED (CR-CC-1..7, all Low). QA PASS WITH NOTES; test gaps QA-CC-1 (cookie expiry attributes, nested path) and QA-CC-2 (unexpected-throw log) closed by Dev, CR-CC-1 hardened (a throwing logger cannot make `signOutUser` reject). QA mutations QM-2, QM-3, QM-8b now killed. **Ready to commit** |
| 2026-10-16 | C-a committed + PR (RM) | SA APPROVED + re-check APPROVED; QA PASS WITH NOTES (QA-B1-3 Low gap accepted). Committed on `feature/settings-drawer-phase-c`, `origin/main` merged in (C-c #440 already on `main`; the C-c progress paragraph moved under §0.6.1), PR opened with auto-merge under the user's Phase C fast-track. CR-CA-1 (placeholder height) and the manual M-list deferred to the user after deploy |
| 2026-10-16 | C-b workplan (Dev) | Plan drawer prefetch (C-2, C-1 folded in) planned on `feature/settings-drawer-c-b` ([C-b workplan](/docs/workplans/BUSINESS_OS_SETTINGS_DRAWER_C_B_WORKPLAN.md)): `planDrawerReads.ts`, a once-per-mount first read in `PlanSection` (B-1..B-3), page wiring through the existing hook with `paused: planDrawer.open` (B-4). The checkout return, re-reads, Check again and the language re-read always fetch. Proposed: no warm after the first close (Q-1). Q-1..Q-10. No code; awaiting SA workplan review |
| 2026-10-16 | C-b SA workplan review | APPROVED WITH CONDITIONS SA-CB-1..11 (in the C-b workplan). Q-1 option (b) approved: no Plan warm after the first close (no busy lock; an upgrade can land after close). Q-2..Q-10 approved; no hook edit; no entitlements import, `test:bos-entitlements` still runs. User decision surfaced: merge does not wait for a hands-on Stripe test-mode buy/upgrade (SA recommendation), M-6..M-10 owed after deploy |
| 2026-10-17 | C-b code complete (Dev) | SA-CB-1..11 applied, not committed. New `planDrawerReads.ts`. `PlanSection` takes the first read once, in a ref-guarded effect declared before `[language]`. Page wiring uses a render-derived spent flag (SA optimisation 1). `consentPrefetch.guard` edited per SA-CB-6. New R, P, D and P-G suites. The four Plan suites, `useLinkOpenedDrawer.test` and `settingsDeepLinks.guard` were not edited. Must-stay-green 935/935; `test:bos-entitlements` 8459/8459; `typecheck:bos-llm` 0 new; `lint:hooks` clean. Mutations: all killed except MB-6 (equivalent). M-6..M-10 NOT RUN (owed after deploy). Next: SA code review and QA |
| 2026-10-17 | C-b committed + PR (RM); Phase C complete | SA APPROVED; QA PASS WITH NOTES. Committed on `feature/settings-drawer-c-b`, PR with auto-merge under the Phase C fast-track. §0.6 / §0.6.1 status: Phase C complete (C-a #442, C-c #440, C-b this PR); C-6/C-7 deferred. M-1..M-12 owed after deploy |
