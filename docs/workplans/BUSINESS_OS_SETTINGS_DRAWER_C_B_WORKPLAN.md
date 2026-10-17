# Workplan: Settings drawer C-b — Plan drawer opens fast

> **Last Updated**: 2026-10-17

**Developer:** Dev
**Requirement:** [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md) §0.6 (item C-2, with C-1 folded in per R-5) and §0.6.1 (slice plan, rulings R-1..R-7, C-b conditions **B-1..B-4**); SA condition **C-11**; plan payments M-6 / U-5
**Branch:** `feature/settings-drawer-c-b` (created by RM from C-a's head `16242704`; `origin/main` `fcce705a` merged in by fast-forward on 2026-10-16 after PR #442 landed. No later commit touches `page.tsx` (`6593144a`), `PlanSection.tsx` (`24efa45a`) or `useDrawerPrefetch.ts` (`6593144a`))
**Date:** 2026-10-16
**Path:** UI short path, **with SA workplan review first**: it touches the plan purchase surface (SA condition C-11) and is the hook's second user (§0.6.1 "carried into the C-b workplan"). After that: Dev, then SA code review (purchase, checkout return and upgrade unaffected) and QA (checkout return and upgrade, SA condition C-11) in parallel, then RM under the Phase C fast-track.
**Status:** Code Complete (2026-10-17), **not committed**. SA workplan review ✅ approved with conditions SA-CB-1..11, all applied (see [Implementation Notes](#implementation-notes)). Next: SA code review and QA in parallel.
**Status (2026-10-17, RM):** ✅ SA code review APPROVED; ✅ QA PASS WITH NOTES. Committed on `feature/settings-drawer-c-b`, PR opened against `main` with auto-merge (`--merge`) under the user's Phase C fast-track (confirmed 2026-10-16). Manual M-1..M-12 (incl. M-6..M-10 Stripe test-mode buy/upgrade, test account only) are **owed by a human after deploy** — not a merge gate (the user did not ask to hold). This slice completes Phase C (C-a #442, C-c #440, C-b). See [Commit Info](#commit-info).

## Overview

Opening **Your plan** in settings takes 1–2 s (user, 2026-10-15). There is one request, `GET /api/business-os/entitlements/my-plan`, and the drawer shows a spinner until it returns. The cost is the round trip plus a likely cold function, not a slow query (§0.6).

C-b starts that read **before the click**, in the same way C-a does for Marketing permission. It warms when the browser is idle after the page loads, and on hover, focus or press on the Plan row, through the approved `useDrawerPrefetch` hook with no change to the hook. `PlanSection` takes the warmed read **once per mount** for its **first** read. Every other read still fetches, exactly as today: the checkout return, the bounded re-reads after checkout and upgrade, "Check again", and the language re-read. Success is still shown only from a server answer read after the action (M-6, U-5).

C-1 (show the plan name first) is folded in and dropped as a separate item (R-5). The header badge names champions only, and C-2 brings the whole plan before the click.

No route, server, database, translation or hook change. `PlanPurchase`, `PlanUpgrade`, `PlanEmbeddedCheckout`, `checkoutProcessing.ts` and `useLinkOpenedDrawer` are not edited.

> In this workplan "C-1/C-2" are the §0.6 *items*; the SA *conditions* are always written "SA condition C-n". "B-1..B-4" are the C-b conditions in §0.6.1.

---

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Implementation Approach](#implementation-approach)
3. [Purchase, checkout return and upgrade: what must not change](#purchase-checkout-return-and-upgrade-what-must-not-change)
4. [Stale data and refresh rules](#stale-data-and-refresh-rules)
5. [Logging parity](#logging-parity)
6. [Files to Create / Modify](#files-to-create--modify)
7. [Task List](#task-list)
8. [Tests](#tests)
9. [Mutation candidates](#mutation-candidates)
10. [Manual QA](#manual-qa)
11. [Risks](#risks)
12. [Questions for SA](#questions-for-sa)
13. [SA Review Notes](#sa-review-notes)
14. [Implementation Notes](#implementation-notes)
15. [QA Testing Report](#qa-testing-report)
16. [Commit Info](#commit-info)
17. [Change History](#change-history)

---

## Analysis Summary

Read at `fcce705a`.

| Area | As built | Consequence for C-b |
|---|---|---|
| `page.tsx` Plan row | `<button ref={planRowRef} aria-haspopup="dialog" aria-expanded={planDrawer.open} onClick={planDrawer.openFromRow}>`. The drawer is `<SettingsDrawer open={planDrawer.open} onOpenChange={planDrawer.onOpenChange} returnFocusRef={planRowRef}>` around `<PlanSection checkoutMarker={searchParams?.get('checkout') ?? null} />`. `planDrawer = useLinkOpenedDrawer()`. No `isBusy` is passed, so **the Plan drawer can close while a purchase or upgrade is in flight**. | Nothing starts before the click. The close-while-acting fact drives rule 7 below (Q-1). |
| Deep link | The page's effect waits for `!loading`, then on `?section=plan` calls `openPlanFromLink()`. The checkout return is `?section=plan&checkout=<session id>`. Closing a link-opened drawer removes `section` only; `checkout` stays on the URL (C-3, SA condition C-11). | After a checkout return, every later open of the drawer carries a valid marker until the owner navigates away. |
| `useDrawerPrefetch` (C-a) | Page-owned refs; `warm` / `take`; used once; 60 s from start; key; `enabled` (drop on disable); `paused` (no warm while the drawer is open, no drop on the way in, drop on un-pause); idle warm. Header: "approved for settings-page drawers". | Reused as is. Pass `paused: planDrawer.open`, as SA advised in the C-a re-check. |
| `PlanSection.tsx` first read | `useEffect(() => { let cancelled = false; fetchPlan().then(…) … return () => { cancelled = true } }, [language])`. On no data it sets `failed`; a throw logs `error({ err }, 'Could not load the plan section')` and sets `failed`; `finally` clears `loading` unless cancelled. Under StrictMode the first run is cancelled and the second fetches again (2 requests in `next dev`). | B-1: a warmed set taken inside this effect would be spent by the cancelled run. |
| `PlanSection.tsx` other reads | `fetchPlan()` = `fetch('/api/business-os/entitlements/my-plan')` (no `init`), then `json()`, then `body?.success && body?.data ? data : null`. Used by the bounded re-read effect (every 4 s, at most 15, while `processing`; a throw logs `warn({ err }, 'Plan re-read after checkout or upgrade failed')`) and by `onUpgradeCheckAgain` (a throw logs `warn({ err }, 'Plan re-read after an unconfirmed upgrade failed')`). | B-2: these must keep fetching. They never see the warmed read. |
| Success | `marker = isCheckoutReturnMarker(checkoutMarker) ? checkoutMarker : completedSession`; "You're on" after checkout needs `marker !== null` and a renewing tier (M-6). After an upgrade it needs `upgradeTarget` (set in this mount) and the U-5 terms. | At mount, `completedSession` and `upgradeTarget` are `null`. Because the warm read is used only when the marker is not valid, a warm answer can never produce a success line (see §3). |
| `PlanPurchase` | On Stripe's `onComplete`: `onComplete(sessionId)` then `router.replace(settingsPlanReturnPath(sessionId))`. | Untouched. |
| `PlanUpgrade` | Preview, then confirm POSTs. `onUpgrading(tier)` after the answer; no `mounted` guard, so it can resolve after the drawer closed. | Untouched. Shows that an upgrade can land after the close (rule 7). |
| `PlanEmbeddedCheckout` | `redirect_on_completion: 'if_required'`: completion arrives through `onComplete`, and a redirect method returns to the marker URL. | Untouched. Both paths end with a valid marker. |
| `my-plan` route | **GET only, read-only.** `getUser`; `getSnapshot` (in-memory LRU); `findLocale` (session user's row); `readPlanPurchaseView` (`server-only`, imports no Stripe client: "Never a Stripe call (SR-11)", one `findByUser` read); one `info` log. No insert, update, audit or Stripe call. It reads no query string and no body; `route.test.ts` pins that. | A speculative read has no side effect (P-3, confirmed). B-3: it sends no language. |
| Guards | `accountCard.guard` forbids the `my-plan` literal in `page.tsx` (B-4). `settingsDeepLinks.guard` pins the plan row's `onClick={planDrawer.openFromRow}`, `aria-haspopup`, `onOpenChange={planDrawer.onOpenChange}` and the plan deep-link branch. `consentPrefetch.guard` T-G1 asserts **exactly one** `useDrawerPrefetch(` in the page and takes the **first** call as the consent call. | A second hook call breaks T-G1 as written: a planned edit (Q-7). |
| Entitlements | `PlanSection.tsx` imports nothing from `lib/business-os/entitlements/` (it imports `billing/checkoutReturnMarker`, a type from `billing/planPurchaseTypes`, and `planCategoryLine`). It is scanned by `creditFigures.fromConfig.guard` (in `SOURCES`) and `tierLiteral.forbidden`. | C-b adds no entitlements import, so the `KNOWN_NON_GATE_IMPORTERS` checklist does not apply. New files must hold no tier literal or credit figure. `npm run test:bos-entitlements` still runs (B-4, the skill's definition of done). |
| Plan tests | `PlanSection.render`, `PlanPurchase.render` (checkout return with fake timers, `server.planReads` counts), `PlanUpgrade.render`, `PlanPaymentState.render` render `<PlanSection />` with a routed `fetch` mock and never pass a prefetch. | They must stay green **unedited**. The prop is optional, and the re-read request is unchanged. |
| `console.*` in touched files | `PlanSection.tsx` 0, `page.tsx` 0 | Nothing to flag. |

---

## Implementation Approach

### A-1. The read module: `components/business-os/settings/planDrawerReads.ts`

It follows SA's C-a suggestion: one module per drawer, so `page.tsx` never names a route.

```typescript
/** One `my-plan` read. Never rejects: a failure says how it failed. */
export type PlanRead =
  | { kind: 'answered'; status: number; body: unknown }
  | { kind: 'threw'; err: unknown };

/** A read started for the page's language (B-3: the language is NOT sent). */
export interface PlanDrawerRead {
  language: string;
  plan: Promise<PlanRead>;
}

export async function readMyPlan(): Promise<PlanRead>;         // the one copy of the request
export function startPlanDrawerRead(language: string): PlanDrawerRead; // starts it synchronously
```

- **Request parity.** `readMyPlan` sends exactly today's request: `fetch('/api/business-os/entitlements/my-plan')`, with no `init`, no query string and no `cache` option. It then calls `response.json()`. Like today's `fetchPlan`, it does **not** branch on `response.ok`: a 401 or 500 carries `{ success: false }`, which the section judges as "no plan" exactly as now. A network error or a body that is not JSON becomes `{ kind: 'threw', err }`, the same cases in which `fetchPlan` throws today.
- **B-3.** `language` is recorded on the set only for the key check and for `PlanSection`'s same-language check. It is never put on the request: the route's "nothing to read" property stands, and plan names come from the stored preference.
- The module logs nothing, has no `'use client'` (like `marketingDrawerReads.ts`) and has **no import at all**. It holds no module-level state.
- **B-4.** The page imports `startPlanDrawerRead` only.

### A-2. `PlanSection`: one optional prop, a first read taken once (B-1, B-2, B-3)

New optional prop: `takePrefetched?: () => PlanDrawerRead | null`. It is a type-only import from `planDrawerReads`, so there is no cycle: the module imports nothing.

**`planFrom(body: unknown): PlanPayload | null`** is today's judgement, `body?.success && body?.data ? data : null`, written once with a narrow type check (no `any`).

**`fetchPlan()` is kept for the re-reads**, with the same signature and behaviour, built on the one request: `const r = await readMyPlan(); if (r.kind === 'threw') throw r.err; return planFrom(r.body);`. The bounded re-read effect and `onUpgradeCheckAgain` are **not edited**. They still throw into their own `catch` and log their own `warn` (Q-8).

**B-1: the first read is fixed once per mount, outside the cancellable effect.** Two refs, `firstStarted` and `firstRead: { language; read: Promise<PlanRead>; preloaded: boolean } | null`, and **one new mount effect declared immediately before the `[language]` effect**. React runs one component's passive effects in declaration order, so it always runs first:

```typescript
useEffect(() => {
  if (firstStarted.current) return;            // StrictMode's re-run starts and takes nothing
  firstStarted.current = true;
  const offered = takePrefetched?.() ?? null;   // always taken: a set never outlives this mount (rule 1)
  const usable =
    offered !== null &&
    !isCheckoutReturnMarker(checkoutMarker) &&  // B-2: a checkout return always reads fresh
    offered.language === language;              // B-3
  firstRead.current = { language, read: usable ? offered.plan : readMyPlan(), preloaded: usable };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only: the set is taken once (B-1)
}, []);
```

- **Why not in render or in a `useState` initializer.** Under React 18's StrictMode the mount render runs twice, and the first render's hooks are thrown away (a fresh `useRef` / `useState` on the second render). A `take()` there would be spent in the discarded render, and the kept render would get `null`. Effects re-run on the **same** fiber, so refs survive, which is why the guard lives in an effect.
- **The cold read moves into the same guarded effect (Q-2).** With no usable set, `readMyPlan()` starts here too, so the cancelled StrictMode run and the kept run share **one** request. Today `next dev` sends 2. Production has no StrictMode, so one request becomes one request there. This is the same choice C-a made (T-M3, "one pair per open, StrictMode included").
- **`completedSession` needs no check at mount.** It is state that starts `null` and is set only by `PlanPurchase.onComplete` after mount, and the bounded re-reads fetch. B-2's "no `completedSession`" therefore holds by construction, and a test pins it (P-9).

**The `[language]` effect** keeps its shape and its `cancelled` flag:

```typescript
useEffect(() => {
  let cancelled = false;
  const first = firstRead.current;
  const isFirst = first !== null && first.language === language;
  if (!isFirst) firstRead.current = null;              // B-2: a language change always fetches
  void (async () => {
    let answer = isFirst ? await first.read : await readMyPlan();
    if (cancelled) return;                              // StrictMode run 1: the same promise is awaited again by run 2
    if (isFirst && first.preloaded && !usableWarm(answer)) {
      logger.debug(discardContext(answer), 'Prefetched plan read unusable; reading again');
      answer = await readMyPlan();                      // exactly one fresh read; only its answer is judged below
      if (cancelled) return;
    }
    if (isFirst) firstRead.current = null;              // the first read is spent once it is applied
    applyFirst(answer);                                 // today's branches, unchanged: threw → error log + failed; no plan → failed; else setPlan
  })().finally(() => { if (!cancelled) setLoading(false); });
  return () => { cancelled = true; };
}, [language]);
```

- A promise can be awaited any number of times, so StrictMode's cancelled run and its kept run share the one read. The kept run applies it once.
- `usableWarm(answer)` is true only for `kind: 'answered'` whose `planFrom(body)` is a plan with `status === 'ok'`. A warm `unavailable`, `no_plan_record`, `success: false`, 4xx/5xx or throw reads **once more, fresh**, and only that answer reaches `failed` (Q-3, the SA-CA-2 rule carried over).
- A cold first read (`preloaded: false`) is applied as today: no second read.
- `firstRead` is cleared after it is applied, so a later `en → he → en` switch fetches each time.

**Render** is unchanged: the spinner while `loading`, then the plan. A warmed set that has already resolved settles in a microtask after mount. The drawer slides in over ~200 ms, so the spinner shows for at most a frame inside the animation (R-7, Q-6). No synchronous "settled" snapshot is added.

The component header gets a short "OPENING FAST (C-b)" paragraph stating B-1..B-3 and that success never comes from a warmed read.

### A-3. Page wiring (`page.tsx`, additive)

Placed **after** the consent hook call, and kept separate from `loadData` and the deep-link effect:

```typescript
/*
 * Your plan's read, started before the click (settings drawer review C-2, C-b).
 * Warmed only until the drawer has been opened and closed once (Q-1): the
 * drawer can close while a purchase or upgrade is still landing, so a read
 * started after the close may predate it. Every later open reads fresh, as
 * before. The route is named in `planDrawerReads`, not here (B-4).
 */
const [planWarmSpent, setPlanWarmSpent] = useState(false);
const planDrawerWasOpen = useRef(false);
useEffect(() => {
  if (planDrawer.open) {
    planDrawerWasOpen.current = true;
    return;
  }
  if (planDrawerWasOpen.current) setPlanWarmSpent(true);
}, [planDrawer.open]);

const planPrefetch = useDrawerPrefetch({
  start: () => startPlanDrawerRead(language),
  key: user?.id ? `${user.id}:${language}` : null,          // B-3: the language is in the key
  enabled: !loading && !isConfigurationOpen && !planWarmSpent,
  paused: planDrawer.open,                                  // rule 6: nothing warms while it is open
  maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS,
  warmOnIdle: true,
});
```

- On the Plan row button: `onPointerEnter={planPrefetch.warm}`, `onFocus={planPrefetch.warm}`, `onPointerDown={planPrefetch.warm}`. **`onClick={planDrawer.openFromRow}` is unchanged**, so the `settingsDeepLinks.guard` pin holds.
- `<PlanSection checkoutMarker={searchParams?.get('checkout') ?? null} takePrefetched={planPrefetch.take} />`. The `checkoutMarker` expression is byte-identical (SA condition C-11).
- **Why `paused` and not `enabled` for the open drawer:** the same as C-a. The content mounts in a Radix portal one commit after `open`, and a drop on disable would empty the slot before `PlanSection` takes it.
- **Why `planWarmSpent` is set on the close, not the open:** `enabled` turning false drops what is held (rule 4). Set on the open, it would drop the set before the portal mounted. Set on the close, it coincides with the un-pause drop, cancels the re-armed idle warm, and makes the focus-return and hover warms no-ops.
- **`!isConfigurationOpen` is kept (Q-5).** The configuration dialog does not edit the plan, but the same `enabled` as the consent hook keeps the two hooks reviewable side by side, and it keeps idle warms from competing with that dialog. Cost: one fewer warm in a rare window.
- Frozen code is untouched: `loadData`, the deep-link effect, `persistTimezone`, `saveProfile`, `handleLogout`, the Language / Currency / Timezone rows and the `darkModeTokens` rows (SA condition C-9).

### A-4. SA condition C-8 (page-load requests), stated

| Request | When | Through | Reused by |
|---|---|---|---|
| `GET /api/business-os/entitlements/my-plan` | Browser idle after `loadData`, and on Plan-row hover, focus or press; at most once per 60 s while unused; **never after the Plan drawer has been opened and closed once** (Q-1); never while it is open | `startPlanDrawerRead` → `readMyPlan` | `PlanSection`'s first read, when the URL carries no valid checkout marker |

It runs in its own effect (inside the hook), through the existing route, never in `loadData` and never through the browser Supabase client. Together with C-a, a settings visit now makes three read-only idle GETs instead of none.

---

## Purchase, checkout return and upgrade: what must not change

| Path | How it stays as today | Pinned by |
|---|---|---|
| **Checkout return** (`?section=plan&checkout=cs_…`, a reload or a Stripe redirect) | The deep link opens the drawer only after `!loading`, the same commit in which `enabled` turns true. The drawer's open pauses the hook and cancels the pending idle warm. Even if a set is held, `PlanSection` sees a valid marker and starts its own fresh read. "Payment processing" and the bounded re-reads run exactly as today. | P-5, D-7, existing `PlanPurchase.render` "the return from checkout" (unedited) |
| **In-drawer checkout completion** | `onComplete` sets `completedSession` and `router.replace` writes the marker. Both happen after the first read, and the re-reads use `fetchPlan`, never `firstRead`. | P-9, existing `PlanPurchase.render` |
| **Success (M-6)** | "You're on <plan>" needs `marker !== null`. A warm read is used only when the URL marker is not valid, and `completedSession` is `null` at mount, so the success line can only come from a fresh read made after the action. | P-8 |
| **Upgrade (U-5)** | `upgradeTarget` is `null` at mount; `onUpgrading`, the bounded re-reads and "Check again" use `fetchPlan`. `PlanUpgrade` is not edited. | P-10, existing `PlanUpgrade.render` (unedited) |
| **Stale or bookmarked marker** | Unchanged: the first read is fresh, and an already-paying account shows the server's answer with no re-read. | existing "a stale marker…" test |
| **Malformed marker** | `isCheckoutReturnMarker` is false, so it is treated as no marker (today's display rule); the warm read may be used. | P-5b |
| **The `checkout` parameter** (SA condition C-11) | The page passes it exactly as now. Neither the hook, the read module nor the new effect touches the URL. `useLinkOpenedDrawer` is not edited, so a close still removes `section` only. | P-G3, existing `useLinkOpenedDrawer.test` |
| **Close mid-action, then reopen** | After the first close, the page never warms the plan again (Q-1), so a reopen reads fresh exactly as today. | D-3, D-8 |

---

## Stale data and refresh rules

1. **Used once.** `take()` clears the slot, and `PlanSection` calls it once per mount, always, even when it will not use the set.
2. **Maximum age 60 s** from the start of the request (the hook's `DRAWER_PREFETCH_MAX_AGE_MS`).
3. **Same account and language.** Key `${user.id}:${language}`. `PlanSection` also refuses a set whose `language` differs (a mount in the same commit as a switch, as in C-a's T-H5).
4. **Not while the page loads, nor while Configuration is open** (`enabled`).
5. **Never while the Plan drawer is open** (`paused`). The close drops anything left.
6. **Never on a checkout return.** A valid marker always makes the first read fresh.
7. **Only before the first close** (Q-1). The Plan drawer has no busy lock, and a purchase or upgrade can land after it closes (`PlanUpgrade`'s answer can arrive after unmount). A warm started after the close could predate the landing and would make a reopen within 60 s show the old plan, with the Upgrade or Choose button, as current. After the first close every open reads fresh, as today.
8. **An unusable warm answer is never shown.** Anything but an `ok` plan reads once more, fresh (Q-3).
9. **Inside an open drawer nothing changes.** The bounded re-reads, "Check again" (`onUpgradeCheckAgain`; the "taking longer" link is a full navigation) and the language re-read all fetch.
10. **The cross-tab window before the first open** is bounded by rule 2. The server stays the authority on buying: the checkout and upgrade routes refuse on their own predicates, whatever the screen showed (R-2).

---

## Logging parity

| Case | Today | After C-b |
|---|---|---|
| First read throws (network, non-JSON) | `error({ err }, 'Could not load the plan section')` | The same, for the answer acted on (a fresh read, or a cold first read) |
| First read: no plan in the body | no log, `failed` | the same |
| Warm read unusable (discarded) | — | `debug` only, with `{ reason, status }` or `{ reason, err }`: no payload, no plan names |
| Bounded re-read throws | `warn({ err }, 'Plan re-read after checkout or upgrade failed')` | unchanged (`fetchPlan` rethrows) |
| "Check again" throws | `warn({ err }, 'Plan re-read after an unconfirmed upgrade failed')` | unchanged |
| `readMyPlan`, `startPlanDrawerRead` | — | silent |

Logger module stays `BusinessOsPlanSection`. No `console.*`.

---

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `components/business-os/settings/planDrawerReads.ts` | create | A-1: `readMyPlan`, `startPlanDrawerRead`, `PlanRead`, `PlanDrawerRead` |
| `components/business-os/settings/__tests__/planDrawerReads.test.ts` | create | R-1..R-4: request parity, never rejects, synchronous start, no language on the wire |
| `components/business-os/settings/PlanSection.tsx` | modify | A-2: `takePrefetched`, `planFrom`, `fetchPlan` over `readMyPlan`, the guarded first-read effect, the `[language]` effect using it, header paragraph |
| `components/business-os/settings/__tests__/PlanSection.prefetch.render.test.tsx` | create | P-1..P-13 with the real `PlanSection` and a routed, deferred `fetch` |
| `components/business-os/settings/__tests__/PlanDrawer.prefetch.render.test.tsx` | create | D-1..D-8: the hook, the real `SettingsDrawer` (portal) and `PlanSection` together, wired as the page wires them |
| `app/business-os/settings/page.tsx` | modify | A-3: one import, `planWarmSpent` state + ref + effect, one hook call, three warm handlers, one prop |
| `app/business-os/settings/__tests__/planPrefetch.guard.test.ts` | create | P-G1..P-G8 source guard with negative controls |
| `app/business-os/settings/__tests__/consentPrefetch.guard.test.ts` | modify (planned edit, Q-7) | Anchor `prefetchCall` on `const consentPrefetch = useDrawerPrefetch(`; the count becomes "exactly two, one per drawer, named `consentPrefetch` and `planPrefetch`". No other assertion changes |
| `app/business-os/settings/__tests__/accountCard.guard.test.ts` | modify (comment only) | The header names `planDrawerReads` beside `marketingDrawerReads`; the assertion is unchanged |
| `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` | modify | §0.6.1 C-b progress line and a Change History row at each stage |

**Not edited:** `useDrawerPrefetch.ts` (no new option; its scope sentence already covers settings-page drawers), `useLinkOpenedDrawer.ts`, `SettingsDrawer.tsx`, `PlanPurchase.tsx`, `PlanUpgrade.tsx`, `PlanEmbeddedCheckout.tsx`, `checkoutProcessing.ts`, `checkoutReturnMarker.ts`, the `my-plan` route and its tests, and every existing Plan test file. There are no new translation keys, and no server, repository or migration change.

---

## Task List

- ✅ 1. Re-read the touched files at HEAD and record the commits checked against (SA condition C-13 practice): `page.tsx` last changed in `16242704` (C-a's head), `PlanSection.tsx` `24efa45a`, `useDrawerPrefetch.ts` `6593144a`. `origin/main` still `fcce705a` on 2026-10-17 (fetched; nothing to merge).
- ✅ 2. `planDrawerReads.ts` and its test (A-1).
- ✅ 3. `PlanSection`: `planFrom` and `fetchPlan` over `readMyPlan`, with **no behaviour change and no prop yet**. Gate passed: the four Plan render suites green **unedited** (175/175) before step 4.
- ✅ 4. `PlanSection`: `takePrefetched`, the guarded first-read effect and the `[language]` effect (A-2), then `PlanSection.prefetch.render.test.tsx`.
- ✅ 5. Page wiring (A-3, with the render-derived spent flag of SA optimisation 1), `planPrefetch.guard.test.ts`, the planned `consentPrefetch.guard` edit (SA-CB-6) and the `accountCard.guard` comment (plus the optional title, SA optimisation 3).
- ✅ 6. `PlanDrawer.prefetch.render.test.tsx`.
- ✅ 7. Must-stay-green set, `npm run test:bos-entitlements`, `npm run typecheck:bos-llm` (0 new), `npm run lint:hooks`, ESLint on the touched files, `npx tsc --noEmit` filtered to the touched files (0 errors), `console.*` count 0.
- ✅ 8. Mutation run (§9), each mutation restored in `try/finally` and SHA-1 checked from my own scratchpad subfolder (`dev-cb/`); `git diff --numstat` identical before and after.
- ✅ 9. Requirement §0.6.1 progress line and Change History row. Hand to TL for SA code review and QA.

---

## Tests

All new tests are **independent of timing**. They use deferred promises routed by URL and assert which requests exist and which answer is shown, never how long anything took. Fake time is used only to move `Date.now()` for the age rule, and to step the existing 4 s re-read interval where a re-read must be triggered.

### Read module — `planDrawerReads.test.ts`

| # | Test |
|---|---|
| R-1 | `readMyPlan()` calls `fetch` exactly once with **one argument**, `'/api/business-os/entitlements/my-plan'`: no `init`, no query string |
| R-2 | Never rejects: a network error → `{ kind: 'threw' }` with the same `err`; a body that is not JSON → `threw`; a 500 with `{ success: false }` → `{ kind: 'answered', status: 500, body }` |
| R-3 | `startPlanDrawerRead('he')` has called `fetch` before anything is awaited, and returns `{ language: 'he', plan }` |
| R-4 | B-3: the URL contains no `he`, `lang` or `locale` |

### Section — `PlanSection.prefetch.render.test.tsx` (real component, `fetch` routed and deferred, `useLanguage` mocked as in `PlanSection.render`)

The warm payload and the fresh payload carry **different plan names** (`WARM` / `FRESH`), so each test can tell which answer is on screen.

| # | Test |
|---|---|
| P-1 | **Warm open:** `takePrefetched` hands a resolved set → **zero** `fetch` calls; `WARM` is shown |
| P-2 | Warm read still in flight → zero calls; the plan appears when it resolves |
| P-3 | **Cold open** (no prop, and a prop returning `null`) → **exactly one** call |
| P-4 | **StrictMode (B-1):** inside `<React.StrictMode>`, a warm open → `take` called **once**, zero calls, `WARM` shown; a cold open → **exactly one** call |
| P-5 | **Checkout return (B-2):** a valid marker plus a warm set → exactly one fresh call; `FRESH` is shown and `WARM` never is; "Payment processing" as today |
| P-5b | A malformed marker plus a warm set → zero calls (the warm read is used, matching today's display rule) |
| P-6 | **Language (B-3):** a set with `language: 'he'` while the section is `en` → ignored, one call |
| P-7 | **Language re-read (B-2):** warm open in `en`, then rerender in `he` → exactly one new call; then back to `en` → one more (`firstRead` spent) |
| P-8 | **Success only from the server (M-6, U-5):** a warm payload of a renewing paid tier with no marker → no `plan-purchase-done`, no `plan-upgrade-done` |
| P-9 | **Re-reads after a warm open (B-2):** rerender with a valid marker (as `router.replace` does after `onComplete`) → "processing"; step one interval → exactly one new call, whose answer drives "You're on" |
| P-10 | **"Check again" after a warm open (B-2):** with the `PlanUpgrade.render` harness (an upgrade answer left unknown), press Check again → exactly one new call |
| P-11 | **Unusable warm answer:** `it.each` over `threw`, `answered` 500 `{ success: false }`, `answered` 200 with `status: 'unavailable'`, and with `status: 'no_plan_record'` → exactly one fresh call; only its answer is shown; one `debug` log and no `warn` / `error`. Then a fresh failure → the "unavailable" notice and exactly one `error({ err })` (logging parity) |
| P-12 | `take` is called once per mount, including across a language change (the re-run never takes again) |
| P-13 | Unmount before the warm read settles → no update after unmount, and no call |

### Drawer and hook together — `PlanDrawer.prefetch.render.test.tsx`

A harness renders `useDrawerPrefetch` with the page's options (including `paused: open` and the `planWarmSpent` close effect), the real `SettingsDrawer` and `PlanSection`.

| # | Test |
|---|---|
| D-1 | `warm()`, resolve, open → **zero** new calls, `WARM` shown (the portal handover works while paused) |
| D-2 | `warm()` in flight, open → zero new calls |
| D-3 | **Rule 7:** open, close, then hover, focus-return and the idle callback → **no** call; reopen → exactly one fresh call |
| D-4 | Warm, move time +61 s, open → one fresh call |
| D-5 | **Rule 5:** the idle callback fires while the drawer is open → zero calls while open |
| D-6 | `<React.StrictMode>`: warm, then open → zero new calls |
| D-7 | **Checkout return:** a valid marker passed to the section, warm, open → one fresh call; `WARM` never shown |
| D-8 | **Close mid-upgrade:** open (warm used), an upgrade answer resolves after the close → reopen → one fresh call (no warm exists) |

### Page source guard — `planPrefetch.guard.test.ts` (comment-stripped, each pin with a negative control)

| # | Pin |
|---|---|
| P-G1 | `const planPrefetch = useDrawerPrefetch({` with `start: () => startPlanDrawerRead(language)`, a key containing `user.id` and `language`, `enabled` **exactly** `!loading && !isConfigurationOpen && !planWarmSpent,`, `paused` exactly `planDrawer.open,`, `DRAWER_PREFETCH_MAX_AGE_MS`, `warmOnIdle: true` |
| P-G2 | The plan row carries `onPointerEnter`, `onFocus` and `onPointerDown` = `planPrefetch.warm`, and still `onClick={planDrawer.openFromRow}` |
| P-G3 | `<PlanSection` receives `checkoutMarker={searchParams?.get('checkout') ?? null}` **unchanged** and `takePrefetched={planPrefetch.take}` (SA condition C-11) |
| P-G4 | `loadData` and the deep-link effect name neither `planPrefetch` nor `startPlanDrawerRead` (SA condition C-8) |
| P-G5 | B-4: the page imports only `startPlanDrawerRead` from `planDrawerReads`, never `readMyPlan`, and contains no `my-plan` literal |
| P-G6 | `setPlanWarmSpent(true)` sits in an effect on `[planDrawer.open]`, behind the was-open ref (set on the close, not the open) |
| P-G7 | `planDrawerReads.ts`: no **import** from `lib/business-os/entitlements` (the regex matches `from '…'` and `import(…)` only, because the module's URL itself contains `business-os/entitlements`), no Supabase, no repository, no `console.*`, no module-level state (the C-a allow-list) |
| P-G8 | `PlanSection.tsx`: `takePrefetched` is called exactly once, inside the effect guarded by `firstStarted`, and not in the `[language]` effect (B-1 structural) |

### Must stay green

`PlanSection.render`, `PlanPurchase.render`, `PlanUpgrade.render`, `PlanPaymentState.render`, `components/business-os/__tests__/PlanEmbeddedCheckout`, `app/api/business-os/entitlements/my-plan/__tests__/route`, `useDrawerPrefetch`, `useLinkOpenedDrawer`, `SettingsDrawer.*`, `MarketingConsentDrawer.*`, `MarketingConsentPanel.*`, `settingsDeepLinks.guard`, `accountCard.guard`\*, `consentPrefetch.guard`\*, `noBrowserDb.guard`, `timezoneWrite.guard`, `accountProfile.guard`, `planBadge`, and C-a's must-stay-green command (`npx jest components/business-os/settings components/ui/__tests__ app/business-os/settings greetingUsesTheEditedName.guard journeyReadiness planBadge invite-accepted pluginConnectionsBrowserAccess.guard`) plus `themePrepaint.guard`. Then `npm run test:bos-entitlements` (`creditFigures.fromConfig.guard` and `tierLiteral.forbidden` scan `PlanSection.tsx`). \* = the planned edits in Files. All four Plan render suites must pass **unedited**.

---

## Mutation candidates

| # | Mutation | Killed by |
|---|---|---|
| MB-1 | `take()` moved into the `[language]` effect as a local (the B-1 hazard) | P-4 (StrictMode: one call, `take` ×2), P-G8 |
| MB-2 | The `firstStarted` guard removed | P-4, P-12 |
| MB-3 | The marker check removed from `usable` | P-5, D-7 |
| MB-4 | `isCheckoutReturnMarker(checkoutMarker)` replaced by `checkoutMarker !== null` | P-5b |
| MB-5 | The language check removed from `usable` | P-6 |
| MB-6 | `firstRead` not cleared after it is applied | P-7 (back to `en`) |
| MB-7 | A language re-run reuses `firstRead` regardless of language | P-7 |
| MB-8 | An unusable warm answer is applied as is | P-11 |
| MB-9 | A warm `status !== 'ok'` plan is accepted | P-11 (`unavailable`, `no_plan_record`) |
| MB-10 | The bounded re-read or Check again reads `firstRead` instead of fetching | P-9, P-10 |
| MB-11 | The cold read moved back into the cancellable effect (StrictMode cold = 2) | P-4 (cold) |
| MB-12 | The discarded-warm log raised to `warn` / `error`, or given the body | P-11 |
| MB-13 | `readMyPlan` gains an `init`, a `?lang=` or a `cache` option | R-1, R-4 |
| MB-14 | `readMyPlan` rethrows | R-2 |
| MB-15 | Page: `paused: planDrawer.open` removed | P-G1, D-5 |
| MB-16 | Page: the drawer term moved into `enabled` instead of `paused` | D-1, D-2, D-6 (the handover lost) |
| MB-17 | Page: `!planWarmSpent` removed | P-G1, D-3 |
| MB-18 | Page: `planWarmSpent` set on the open instead of the close | D-1 (the drop empties the slot), P-G6 |
| MB-19 | Page: `onFocus` removed from the plan row | P-G2 |
| MB-20 | Page: the key drops the language | P-G1 |

---

## Manual QA

**Account:** the designated test account only. **Stripe test mode only** (test keys and the `4242 4242 4242 4242` test card; never a live key). One account on a free or trial plan (to buy) and one paying test account (to upgrade). English and Hebrew; desktop and phone. Record which database the local build used (the SA-CA-11 practice). Nothing here queries production.

| # | Check |
|---|---|
| M-1 | Load settings and wait 5 s. DevTools Network shows **one** `my-plan` GET (plus C-a's pair). Open Your plan: **no** new `my-plan` request; the plan is there as the drawer slides in |
| M-2 | Reload, then hover the row before idle: one GET. Click: none |
| M-3 | Close, then hover, focus and reopen: **no** warm after the close; the reopen makes one fresh GET (rule 7) |
| M-4 | Switch the language, then open (first open): names in the new language |
| M-5 | Switch the language while the drawer is open: names catch up (one fresh GET) |
| M-6 | **Buy** (free or trial test account): Choose → embedded checkout → test card → "Payment processing" → "You're on <plan>". The URL gains `?section=plan&checkout=cs_test_…`; Network shows the 4 s re-reads |
| M-7 | **Checkout return:** reload that URL. The drawer opens by itself with "Payment processing" or "You're on", and its first read is a fresh GET made **after** the open (none reused) |
| M-8 | Close after M-6: `section` leaves the URL and `checkout` stays (SA condition C-11); the reopen reads fresh |
| M-9 | **Upgrade** (paying test account): Upgrade → confirm → "Upgrading…" → "You're on <plan>". Repeat and close the drawer right after confirming, then reopen within 60 s: a fresh GET, no stale "Upgrade to …" from a pre-close read |
| M-10 | "Check again" (upgrade answer unknown) and the "taking longer than usual" link: each makes a fresh GET |
| M-11 | The Founding Partner pill (`?section=plan`) still opens the drawer |
| M-12 | Phone: open with a tap; Hebrew right to left; focus returns to the row on close |

**Measurement** (optional, SA-CA-12 precedent: structure is the gate, numbers are recorded, not gated): `next build && next start`, warm scenario, T-plan from click to the first frame with the plan name, five runs, before (`origin/main`) and after.

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | One more read-only GET per settings visit (three idle GETs with C-a) | Read-only route; after `loadData`, at idle; at most once per 60 s while unused; none after the first Plan open. It also warms the function and the server's snapshot LRU, which is most of the cold-start saving |
| R-2 | A warm read up to 60 s old when another tab or device bought or upgraded | Rule 2; used once; the checkout and upgrade routes refuse on their own predicates. The screen is never the authority |
| R-3 | A purchase or upgrade landing after the drawer closed, then a reopen showing a pre-landing read | Rule 7 (Q-1): no warm after the first close |
| R-4 | StrictMode double effects spend the set (B-1) | Take in a ref-guarded mount effect; P-4, D-6, MB-1, MB-2 |
| R-5 | `consentPrefetch.guard` assumes one hook call and takes the first | Planned edit (Q-7); the plan call is placed after the consent call regardless |
| R-6 | The entitlements "no import" check matching the route URL | P-G7 matches import statements only |
| R-7 | A spinner frame on a warm open (the resolved promise settles in a microtask) | Inside the drawer's slide-in; no settled snapshot (Q-6) |
| R-8 | A hidden change to the purchase path | Step 3's gate (four Plan suites unedited); `PlanPurchase`, `PlanUpgrade`, `PlanEmbeddedCheckout` and the route are not edited; SA code review and QA M-6..M-10 |
| R-9 | The hook copied to a third surface | No hook change; its header already scopes it (R-7 ruling) |

---

## Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | **Rule 7.** The Plan drawer has no busy lock, and an upgrade answer can land after the close. Option (a): warm after closes too, as C-a does (a reopen within 60 s can show a pre-landing plan as current). Option (b): warm only until the drawer has been opened and closed once, then every open reads fresh, as today (`planWarmSpent`, set on the close). Option (c): `PlanSection` notifies the page on purchase or upgrade (touches the purchase handlers, SA condition C-11). | **(b).** It keeps everything after the first open exactly as today, and touches no purchase code. The user's complaint was the first open |
| Q-2 | Start the **cold** first read in the same guarded effect, so StrictMode sends one request instead of two (a `next dev`-only change; production is one either way)? | Yes, as C-a's T-M3 |
| Q-3 | Use a warm answer only when it is a plan with `status === 'ok'`; anything else (`unavailable`, `no_plan_record`, `success: false`, a throw) reads once more, fresh? | Yes (the SA-CA-2 rule). `no_plan_record` accounts pay one wasted warm per visit |
| Q-4 | Call `take()` once per mount **always**, discarding the set on a checkout return, rather than not calling it? | Always: a set never outlives the mount it was offered to |
| Q-5 | Keep `!isConfigurationOpen` in the plan hook's `enabled`, although Configuration does not edit the plan? | Keep, for parity with the consent hook |
| Q-6 | Accept at most a one-frame spinner on a warm open, inside the slide-in, rather than adding a synchronous "settled" snapshot to the read? | Accept |
| Q-7 | Planned test edit: `consentPrefetch.guard`'s `prefetchCall` is anchored on `const consentPrefetch = useDrawerPrefetch(`, and its count becomes "two, named `consentPrefetch` and `planPrefetch`". No other assertion changes. | Approve |
| Q-8 | `fetchPlan` (the re-reads and Check again) is rebuilt on `readMyPlan`, so there is one copy of the request, with its throw and `warn` behaviour unchanged. | Approve |
| Q-9 | No edit to `useDrawerPrefetch.ts`: its scope sentence already covers settings-page drawers, and C-b needs no new option. | Approve |
| Q-10 | Entitlements: C-b adds no import from the module, so the registration checklist is not triggered. `test:bos-entitlements` still runs because two of its guards scan `PlanSection.tsx`. | Confirm |

---

## SA Review Notes

See [SA Workplan Review (2026-10-16)](#sa-workplan-review-2026-10-16) below.

## SA Workplan Review (2026-10-16)

**Reviewed by SA — 2026-10-16**, on `feature/settings-drawer-c-b` at `fcce705a` (read only, nothing run against production).
**Status:** ✅ **APPROVED WITH CONDITIONS** (SA-CB-1 to SA-CB-11 below). Implementation may start. No condition changes the design; they tighten the request module, the effect order, logging parity, the guard edit and the test gate.

### What was checked against the code

| Area | Finding |
|---|---|
| `PlanSection.tsx` | `fetchPlan` (L173) is `fetch(url)` → `json()` → `body?.success && body?.data`, with no `ok` branch. The first read is the cancellable `[language]` effect (L394–432): `error({ err }, 'Could not load the plan section')`, `failed`, and `finally` clears `loading` unless cancelled. The bounded re-read (L373–392) waits for `!loading` and logs its own `warn`. `onUpgradeCheckAgain` (L355) logs its own `warn`. `marker` is the valid URL marker or `completedSession` (L328). `upgradeTarget` and `completedSession` start `null`. **The workplan's description is accurate.** No import from `lib/business-os/entitlements/` (L58–72). `console.*`: 0. |
| `page.tsx` | The Plan row (L1013–1026), `planDrawer = useLinkOpenedDrawer()` (L127), and the drawer with **no `isBusy`** (L1027–1039) are as stated. `<PlanSection checkoutMarker={searchParams?.get('checkout') ?? null} />` (L1038). The deep-link effect waits for `!loading` (L208). The consent hook call is at L146, before the deep-link effect. `console.*`: 0. |
| `PlanUpgrade` / `PlanPurchase` | `onUpgrading(tier)` is called after the POST answer, with no mounted guard (L179, L257, L290), so **Q-1's finding is real**. `PlanPurchase.onComplete` → `router.replace(settingsPlanReturnPath(...))` (L160–162). Neither file is edited. |
| `my-plan` route | GET only. `getUser`, `getSnapshot` (in-memory LRU touch only, no write), `findLocale`, `readPlanPurchaseView` (`server-only`, "Never a Stripe call (SR-11)"), one `info` log. No insert, update, audit or Stripe call. **A speculative read is side-effect free (P-3 holds).** |
| `useDrawerPrefetch` | `take()` works while paused. Un-pause and disable both drop. The idle effect depends on `enabled` and `paused`. `warm()` reads `latest.current`, which is set during render. The C-b wiring needs **no hook change** (Q-9). |
| `useLinkOpenedDrawer` | A close removes `section` only. `checkout` is never written (pinned by `settingsDeepLinks.guard` L272–276). |
| Guards | `consentPrefetch.guard` T-G1 counts `useDrawerPrefetch(` **=== 1**, and `prefetchCall` takes the first occurrence. `g5`'s import-name check looks only at `marketingDrawerReads` / `useDrawerPrefetch`, so a `planDrawerReads` import does not disturb it. `settingsDeepLinks.guard` pins `onClick={planDrawer.openFromRow}` and `onOpenChange={planDrawer.onOpenChange}`, and **forbids `if (!planDrawer.open)` anywhere in the page** (L144). The planned `if (planDrawer.open) {` does not trip it. `accountCard.guard` forbids the `my-plan` literal in the page. |
| Entitlements | `creditFigures.fromConfig.guard` lists `PlanSection.tsx` in `SOURCES` (L119). `tierLiteral.forbidden` walks every product file, so the new `planDrawerReads.ts` is scanned too. Tier names are allowed only under `components/business-os/settings/__tests__`. The `bos-entitlements` workflow has **no `paths:` filter**, so CI runs it on this PR anyway. |
| Existing Plan suites | `PlanSection.render`'s `serve()` mocks a response with **only `json`** (no `status`, no `ok`). `PlanPurchase.render` routes by URL and counts `server.planReads`. Neither uses StrictMode, so Q-2's dev-only change cannot move their counts. |

### Rulings on Q-1..Q-10

| # | Ruling |
|---|---|
| **Q-1** | ✅ **Option (b), `planWarmSpent`: approved.** The C-a precedent was safe only because the Marketing drawer cannot close while a save runs (`isBusy`). The Plan drawer can: `PlanUpgrade` calls `onUpgrading` after the POST with no mounted guard, and the purchase lands by webhook. Under (a), the un-pause re-arms the idle warm. A GET started then can predate the upgrade or webhook, and a reopen within 60 s would show the old plan **with the Upgrade/Choose button live**. The server would refuse a double buy, but the screen would be wrong on a money surface. (c) edits the purchase handlers, which SA condition C-11 rules out. (b) leaves every open after the first exactly as today, and it fixes the open the user complained about. Setting the flag **on the close, not the open,** is correct: setting it on the open is rule 4's drop before the portal mounts (MB-18). On the transient render between the close commit and the spent re-render, a warm could still start (in practice it cannot: `onCloseAutoFocus` fires at content unmount, after the exit animation). That set is still dropped by `enabled` turning false in the next render, so it can **never be served**. The failure direction is one wasted GET, never stale data. Accepted (see Optimisation 1 for a render-derived variant that closes even that). |
| **Q-2** | ✅ Approved. The cold first read starts in the same ref-guarded mount effect, so StrictMode's cancelled run and the kept run share one request. Production is unchanged (1 → 1). This is the same choice as C-a T-M3. |
| **Q-3** | ✅ Approved. A warm answer is used only when it is `answered` and `planFrom(body)` is a plan with `status === 'ok'`. Anything else is read once more, fresh, and only the fresh answer is judged (the SA-CA-2 rule). Accounts with `no_plan_record` pay one extra GET, which is acceptable. |
| **Q-4** | ✅ Approved. `take()` once per mount, **always**, including on a checkout return, where the set is discarded unread. Add the marker case to P-12 (SA-CB-10). |
| **Q-5** | ✅ Keep `!isConfigurationOpen`. It is not needed for correctness, but parity with the consent hook makes the two calls reviewable side by side, and it costs nothing. |
| **Q-6** | ✅ Accept a spinner of at most one frame, inside the slide-in. A synchronous "settled" snapshot would add state for no visible gain (R-7, SA-CA-12: structure is the gate). |
| **Q-7** | ✅ Approved, with the details in SA-CB-6. |
| **Q-8** | ✅ Approved: one copy of the request. `fetchPlan` keeps its signature, rethrows the **same** error object, and the two re-read call sites are not edited. |
| **Q-9** | ✅ Confirmed: no edit to `useDrawerPrefetch.ts`. C-b is the second settings-page drawer covered by the R-7 approval; its header's scope sentence holds as written. |
| **Q-10** | ✅ Confirmed. No touched or new file imports from `lib/business-os/entitlements/` (`PlanSection.tsx` L58–72 verified; `planDrawerReads.ts` will have no import at all), so the registration checklist is **not** triggered. `npm run test:bos-entitlements` **must** still run locally: `creditFigures.fromConfig.guard` scans `PlanSection.tsx`, and `tierLiteral.forbidden` will scan `planDrawerReads.ts`. CI runs it regardless (no `paths:` filter). |

### B-1..B-4 and SA condition C-11

| Condition | Met by the plan? |
|---|---|
| **B-1** take outside the cancellable effect, tested under StrictMode | ✅ A ref-guarded mount effect, not render and not a `useState` initializer (the reasoning about discarded mount renders is correct). P-4, D-6, MB-1, MB-2. Effect order is pinned by SA-CB-3. |
| **B-2** warm serves only the first read, only without a valid marker or `completedSession`; re-reads always fetch | ✅ `completedSession` is `null` at mount by construction. The bounded re-read, Check again and the language re-read all go through `fetchPlan`. P-5, P-7, P-9, P-10, D-7. |
| **B-3** no language on the wire; key includes it | ✅ R-4, P-6, MB-13, MB-20. |
| **B-4** no `my-plan` literal in the page; entitlements checklist if imported | ✅ P-G5 plus the unchanged `accountCard.guard`. No import, so no checklist (Q-10). |
| **SA condition C-11** `checkout` left alone; purchase, checkout return and upgrade untouched; success only from the server (M-6, U-5) | ✅ The `checkoutMarker` expression is byte-identical (P-G3). `PlanPurchase`, `PlanUpgrade`, `PlanEmbeddedCheckout`, `checkoutProcessing`, `useLinkOpenedDrawer` and the route are not edited. Success needs `marker` or `upgradeTarget`, and neither can exist at mount (P-8). |

### Conditions

1. **SA-CB-1 Rule 7 (Q-1 (b)).** The spent flag must never be true while the drawer is open, and must be true by the first render after the first close. P-G6 pins whichever form is built (the planned effect, or Optimisation 1). D-3 and D-8 are mandatory, as is M-9 in manual QA.
2. **SA-CB-2 `readMyPlan`.** One `try` covers **both** `fetch(...)` and `response.json()`, so a synchronous `fetch` throw becomes `threw` too. It reads only `response.json()` and `response.status`: no `response.ok`, no headers, nothing else. The existing suites mock responses with `json` alone (`PlanSection.render` `serve()`), and branching on `ok` would turn a 500 `{ success: false }` into `threw` and change the logging. The URL is written inline in the call. A top-level string `const` fails the C-a module-state allow-list that P-G7 applies. The "No language on the request, deliberately" rationale (now in the `[language]` effect) moves to the module that sends the request, and `PlanSection` keeps a one-line pointer.
3. **SA-CB-3 Effect order.** The first-read mount effect is declared **immediately before** the `[language]` effect. P-G8 also pins the **order**: the `firstStarted` effect's index is less than the `[language]` effect's. Add **MB-21** (swap the two effects), killed by P-1 (a call appears) and P-G8.
4. **SA-CB-4 Logging parity, exact.** A first read that `threw` logs `logger.error({ err: answer.err }, 'Could not load the plan section')`, with the original error object and a byte-identical message. The two `warn` messages are untouched. The async body in the `[language]` effect cannot reject (`readMyPlan` never rejects, and `planFrom` is a narrow check that does not throw). Keep the `finally` guard `if (!cancelled) setLoading(false)`. The discard log stays `debug` with `{ reason, status }` / `{ reason, err }` and no body (MB-12).
5. **SA-CB-5 The unedited gate covers the whole slice, not only step 3.** `PlanSection.render`, `PlanPurchase.render`, `PlanUpgrade.render` and `PlanPaymentState.render` must pass **unedited** after step 3 **and** at the end of step 6. The same applies to `useLinkOpenedDrawer.test` and `settingsDeepLinks.guard`. If any of them needs an edit, stop and report to SA.
6. **SA-CB-6 `consentPrefetch.guard` edit (Q-7).** `prefetchCall` is anchored on `const consentPrefetch = useDrawerPrefetch(`. T-G1's count becomes: exactly two `useDrawerPrefetch(` occurrences, and the set of `const <name> = useDrawerPrefetch(` names equals `['consentPrefetch', 'planPrefetch']`. The negative controls use `code.replace` (first occurrence only), and the plan call's `enabled` starts with the same `!loading && !isConfigurationOpen`. So each existing control must also assert that the mutated **consent block** (`prefetchCall(mutated)`) differs from the original, proving it hit the consent call and not the plan call. Add one control: renaming `consentPrefetch` makes T-G1 throw. No other assertion changes.
7. **SA-CB-7 Stale comment in `page.tsx`.** The Plan row's block comment says "It shows the title only (C-8): the plan is fetched when the drawer opens, by `PlanSection`". That becomes false. Reword it to the C-b behaviour (warmed before the click until the first close; a checkout return and every later open read fresh). Also update `accountCard.guard`'s header comment, as planned.
8. **SA-CB-8 Entitlements evidence.** In the Implementation Notes, record a grep showing that no touched or new file imports from `lib/business-os/entitlements/` (type-only included), plus the `npm run test:bos-entitlements` result. `planDrawerReads.ts` and every new non-test file hold no tier literal and no credit figure.
9. **SA-CB-9 P-G7 regex.** Match import specifiers only (`from '…lib/business-os/entitlements…'`, `import('…')`, `require('…')`), so the route URL cannot trip it. Include a negative control that adds an `import type { X } from '@/lib/business-os/entitlements/types'` line and expects a failure.
10. **SA-CB-10 Test additions.**
    - P-12 also covers a valid checkout marker: `take` is called once and its set is not used.
    - **MB-22**: `readMyPlan` branches on `response.ok`. Killed by R-2 (500 → `answered`).
    - **MB-23**: `take()` is skipped when a marker is valid. Killed by P-12.
    - Every P and D test asserts on which requests exist and which name (`WARM` / `FRESH`) is shown, never on elapsed time.
    - Fake time only moves `Date.now()` (D-4) or steps the existing 4 s interval (P-9).
11. **SA-CB-11 Manual QA scope.** Stripe **test mode** and the designated test account only. Record which database the local build used. Agents run no query against production. Under the Phase C fast-track, the automated suites (P-5, P-8, P-9, P-10, D-3, D-7, D-8, the four unedited Plan suites) are the code-level gate for SA condition C-11. M-6 to M-10 (buy, checkout return, upgrade, close-mid-upgrade) need a human in a browser; see the user decision below.

### User decision (business terms)

**Should the merge wait for a hands-on test purchase and upgrade in Stripe test mode, or can it follow?** The change does not touch the buy or upgrade code. Automated tests prove that after a payment or an upgrade the screen always asks the server again, and that "You're on…" can only come from that answer. **SA recommends:** do not hold the merge (consistent with the Phase C fast-track), and list M-6 to M-10 in the PR as owed by a human tester soon after deploy. If the user prefers, the PR stays manual until that run is done.

### Optimisation suggestions (not blocking)

1. **A render-derived spent flag** removes the one transient render discussed under Q-1, and with it the extra effect: `const [planDrawerOpened, setPlanDrawerOpened] = useState(false); if (planDrawer.open && !planDrawerOpened) setPlanDrawerOpened(true); const planWarmSpent = planDrawerOpened && !planDrawer.open;`. Setting state during render is the documented React pattern for state derived from earlier renders. With this form, `enabled` and `paused` change in the **same** render on the close, so no warm can start at all after it. Do not write it as `if (!planDrawer.open …)` (`settingsDeepLinks.guard` L144). Dev's choice. P-G6 and MB-18 follow the chosen form.
2. The `my-plan` route's `info` "Customer plan read" will now also fire on idle warms, so it no longer means "the owner opened the plan". Nothing reads it that way today. Say so in `planDrawerReads.ts`'s header so nobody builds on it later.
3. `accountCard.guard`'s test title "(the drawers load it on open)" can become "(only the drawers' read modules name it)". Optional.

### Approval

[x] Workplan approved, proceed to implementation under SA-CB-1 to SA-CB-11. SA code review follows: purchase, checkout return and upgrade unaffected (SA condition C-11), the hook unchanged, and the guard edits exactly as in SA-CB-6.

## Implementation Notes

**Dev, 2026-10-17.** Branch `feature/settings-drawer-c-b`. `origin/main` is still `fcce705a`, unchanged since the workplan (fetched, nothing to merge). **Not committed.**

### What was built

| File | Change |
|---|---|
| `components/business-os/settings/planDrawerReads.ts` | **New.** `readMyPlan`: one `try` over `fetch` and `json()`, reads only `json()` and `status`, URL inline, never rejects. Also `startPlanDrawerRead`, `PlanRead` and `PlanDrawerRead`. No import at all, no module state, no log. The header holds the "no language on the request" rationale (moved from `PlanSection`, SA-CB-2) and notes that the route's `info` line now also fires on warms (SA optimisation 2). |
| `components/business-os/settings/PlanSection.tsx` | `planFrom` (a narrow check that never throws). `fetchPlan` is rebuilt on `readMyPlan` and rethrows the same error object; the re-read and Check again call sites are unedited. Optional `takePrefetched`; refs `firstStarted` and `firstRead`. The guarded first-read mount effect is declared **immediately before** the `[language]` effect (SA-CB-3). The `[language]` effect applies the first read or reads fresh. It re-reads an unusable warm answer once, logging `debug` with only `{ reason, status }` or `{ reason, err }`. It keeps `error({ err: answer.err }, 'Could not load the plan section')` byte-identical, and the `if (!cancelled) setLoading(false)` guard (SA-CB-4). New header paragraph "OPENING FAST (C-b)". Render unchanged. |
| `app/business-os/settings/page.tsx` | One import (`startPlanDrawerRead`). A **render-derived** spent flag (SA optimisation 1): `const [planDrawerOpened, setPlanDrawerOpened] = useState(false); if (planDrawer.open && !planDrawerOpened) setPlanDrawerOpened(true); const planWarmSpent = planDrawerOpened && !planDrawer.open;`. On the close, `enabled` and `paused` change in the same render, so no warm can start after it (SA-CB-1). No `if (!planDrawer.open …)` anywhere. The second `useDrawerPrefetch` call sits after the consent call. Three warm handlers on the Plan row, `onClick` unchanged. `takePrefetched={planPrefetch.take}`, with the `checkoutMarker` expression byte-identical. The Plan-row block comment is reworded (SA-CB-7). `loadData`, the deep-link effect, `handleLogout` and every other row are untouched. |
| `app/business-os/settings/__tests__/consentPrefetch.guard.test.ts` | SA-CB-6 exactly. `prefetchCall` is anchored on `const consentPrefetch = useDrawerPrefetch(`. T-G1 checks exactly two calls, named `['consentPrefetch', 'planPrefetch']`. Every T-G1 negative control now also asserts `prefetchCall(mutated) !== prefetchCall(code)` (`hitsConsent`). One new control: renaming `consentPrefetch` makes T-G1 throw. No other assertion changed. |
| `app/business-os/settings/__tests__/accountCard.guard.test.ts` | The header comment names `planDrawerReads`. The `it.each` title now reads "(only the drawers' read modules name it)" (SA optimisation 3). The assertion is unchanged. |
| `components/business-os/settings/__tests__/planDrawerReads.test.ts` | **New.** R-1..R-4, plus a 401 answered from `json` alone, a synchronous `fetch` throw, and a check that `err` is the same object. |
| `components/business-os/settings/__tests__/PlanSection.prefetch.render.test.tsx` | **New.** P-1..P-13, including P-12's marker case (SA-CB-10). Added **P-7b** (a language switch while the warm read is still in flight) to kill MB-7, and a logging-parity case for a cold failure. Payloads are hand-built in the wire shape, so the file has no entitlements import. |
| `components/business-os/settings/__tests__/PlanDrawer.prefetch.render.test.tsx` | **New.** D-1..D-8 with the real `SettingsDrawer` and `PlanSection`. The harness is wired exactly as the page: render-derived spent flag, `paused: open`, and the idle warm captured and run late by hand. |
| `app/business-os/settings/__tests__/planPrefetch.guard.test.ts` | **New.** P-G1..P-G8, each with negative controls. P-G6 pins the render-derived form. P-G7 (SA-CB-9) matches import statements only (`from`, `import(`, `require(`); a non-vacuity check shows the URL alone does not trip it, a control shows a type-only import does, and the C-a module-state allow-list fails a top-level URL string `const`. P-G8 pins one take, inside the `firstStarted` effect, and checks that the next `useEffect(` after it is the `[language]` effect (SA-CB-3, MB-21). |

**Not edited:** `useDrawerPrefetch.ts`, `useLinkOpenedDrawer.ts`, `SettingsDrawer.tsx`, `PlanPurchase.tsx`, `PlanUpgrade.tsx`, `PlanEmbeddedCheckout.tsx`, `checkoutProcessing.ts`, `checkoutReturnMarker.ts`, and the `my-plan` route and its tests (SA condition C-11, Q-9).

### SA conditions

| Condition | How it was met |
|---|---|
| SA-CB-1 | The render-derived form (optimisation 1). `planWarmSpent = planDrawerOpened && !planDrawer.open` cannot be true while the drawer is open, and is true in the closing render. P-G6 (its controls include MB-18, "set on the open"), D-3 and D-8 are green. |
| SA-CB-2 | One `try` over `fetch` and `json()`. Only `json()` and `status` are read, and the URL is inline. The rationale moved to the module; `PlanSection` keeps a one-line pointer. Covered by R-2 (500 and 401 answered, a synchronous throw, non-JSON) and P-G7 (a string `const` fails). |
| SA-CB-3 | The mount effect sits immediately before `[language]`. P-G8 pins the order; MB-21 is killed. |
| SA-CB-4 | The error message and the `{ err }` object are byte-identical (the P-11 parity case asserts `toBe` on the same error). The warn messages are untouched and the `finally` guard is kept. The discard log stays `debug` with no body (MB-12a and MB-12b killed). |
| SA-CB-5 | `PlanSection.render`, `PlanPurchase.render`, `PlanUpgrade.render`, `PlanPaymentState.render`, `useLinkOpenedDrawer.test` and `settingsDeepLinks.guard` were **never edited**. They were green after step 3 and at the end. |
| SA-CB-6 | As described in the table above. |
| SA-CB-7 | The Plan-row comment is reworded, and the `accountCard.guard` header is updated. |
| SA-CB-8 | See "Entitlements evidence" below. |
| SA-CB-9 | The P-G7 regex and controls, as described above. |
| SA-CB-10 | The P-12 marker case is in. MB-22 (killed by R-2) and MB-23 (killed by P-12 and P-5) were run. The tests assert which requests exist and whether WARM or FRESH is shown, never elapsed time. Fake time only moves `Date.now()` (D-4) or steps the 4 s interval (P-9). |
| SA-CB-11 | Dev ran no production query. Manual M-6..M-10 not run (owed by a human). |

### Verification (2026-10-17)

| Check | Result |
|---|---|
| Step-3 gate (the four Plan suites, unedited) | ✅ 175/175 |
| New suites | ✅ `planDrawerReads` 10, `PlanSection.prefetch` 23, `PlanDrawer.prefetch` 8, `planPrefetch.guard` 23 (counted in the 139 below; corrected from 25 by RM 2026-10-17 per QA) |
| Must-stay-green (`npx jest components/business-os/settings components/ui/__tests__ app/business-os/settings greetingUsesTheEditedName.guard journeyReadiness planBadge invite-accepted pluginConnectionsBrowserAccess.guard themePrepaint.guard components/business-os/__tests__/PlanEmbeddedCheckout app/api/business-os/entitlements/my-plan`) | ✅ 55 suites, 935 tests. This ran before P-7b was added; P-7b's suite was then run on its own: 23/23 |
| `app/business-os/settings` guards (incl. `settingsDeepLinks`, `consentPrefetch`, `accountCard`, `planPrefetch`) | ✅ 7 suites, 139 tests |
| `app/admin/finance/__tests__/accountsTab.render` (also renders `PlanSection`) | ✅ 18/18 |
| `npm run test:bos-entitlements` | ✅ 280 suites, 8459 tests |
| `npm run typecheck:bos-llm` | ✅ passed, 0 new (28 baseline; it reports 1 baseline entry fixed, in an unrelated file) |
| `npx tsc --noEmit` (`NODE_OPTIONS=--max-old-space-size=12288`), filtered to `components/business-os/settings/` and `app/business-os/settings/` | ✅ 0 errors |
| ESLint on the 9 touched and new code files | ✅ 0 errors. 1 warning, **pre-existing**: `react-hooks/exhaustive-deps` on the `page.tsx` `loadData` effect, which is untouched code |
| `npm run lint:hooks` | ✅ clean |
| `console.*` in `planDrawerReads.ts`, `PlanSection.tsx`, `page.tsx` | ✅ 0 |

**Entitlements evidence (SA-CB-8).** A grep for import statements of `business-os/entitlements` (`from`, `import(`, `require(`) over all nine touched and new files matches **only** the four string literals inside `planPrefetch.guard`'s P-G7 negative controls. Those are test data, not imports. No touched or new file imports from `lib/business-os/entitlements/`, type-only included, so the registration checklist does not apply. `planDrawerReads.ts` holds no tier name and no credit figure (a grep for tier names and `n,nnn` figures finds none). The new tests use made-up ids (`plan-low`, `plan-top`) and names (`WARM-PLAN`, `FRESH-PLAN`, `Top plan`).

### Mutations (MB-1..MB-23)

The script `dev-cb/mutate.js` in my scratchpad applies each mutation, runs the suites that should kill it, and restores the file in `finally`, checking its SHA-1 after every mutation. `git diff --numstat` was identical before and after the run.

| # | Mutation | Result | Killed by |
|---|---|---|---|
| MB-1 | take moved into the `[language]` effect | ✅ killed | P-1, P-2, P-G8 |
| MB-2 | `firstStarted` guard removed | ✅ killed | P-4 (warm and cold), P-G8 |
| MB-3 | marker check removed | ✅ killed | P-5, D-7, P-12 |
| MB-4 | `isCheckoutReturnMarker(…)` → `checkoutMarker === null` | ✅ killed | P-5b |
| MB-5 | language check removed | ✅ killed | P-6 |
| MB-6 | `firstRead` not cleared after it is applied | ⚠️ **survived: equivalent mutant** | see below |
| MB-7 | a language re-run reuses `firstRead` regardless of language | ✅ killed once P-7b was added (it survived the first run) | P-7b |
| MB-8 | unusable warm answer applied as is | ✅ killed | P-11 |
| MB-9 | warm `status !== 'ok'` accepted | ✅ killed | P-11 (`unavailable`, `no_plan_record`) |
| MB-10a | the bounded re-read uses the plan in hand instead of fetching | ✅ killed | P-9 |
| MB-10b | Check again does not fetch | ✅ killed | P-10 |
| MB-11 | cold read moved back into the cancellable effect | ✅ killed | P-4 (cold) |
| MB-12a / b | discard log raised to `warn` / given the body | ✅ killed | P-11 |
| MB-13a / b | `readMyPlan` gains `{ cache }` / `?lang=` | ✅ killed | R-1, R-4 |
| MB-14 | `readMyPlan` rethrows | ✅ killed | R-2 |
| MB-15..MB-20 | In the page: no pause; drawer term in `enabled`; no spent term; spent set on the open; no `onFocus`; key drops the language (the plan call's key, the second occurrence) | ✅ all killed | P-G1, P-G2, P-G6 |
| MB-15h..MB-18h | the same four wiring mutations, applied to the D harness | ✅ all killed | D-5; D-1/D-2; D-3/D-8; D-1/D-2 |
| MB-21 | the two effects swapped | ✅ killed | P-G8 (and its swap control) |
| MB-22 | `readMyPlan` branches on `response.ok` | ✅ killed | R-2 (500 and 401 answered) |
| MB-23 | `take()` skipped when a marker is valid | ✅ killed | P-12, P-5 |

**MB-6 is an equivalent mutant under React 18.** The `[language]` effect re-runs only on a language change, or on StrictMode's mount re-run, which must reuse the read. On a language change, the run's own `first === null → firstRead.current = null` already clears a read started in the old language, so the clear-after-apply never decides the outcome. It is kept as a defence for an effect re-run in the same language (Fast Refresh, or a future React that re-runs effects when content is shown again): there it makes the re-run read fresh instead of applying the first answer again. Question 1 below asks SA to confirm.

### Manual QA

M-6..M-10 (buy, checkout return, upgrade, close mid-upgrade, Check again): **NOT RUN.** Owed by a human in a browser after deploy, in Stripe test mode with the designated test account only (SA-CB-11). Dev also did not run M-1..M-5, M-11 or M-12.

### Deviations from the workplan

1. **The spent flag is derived in render** (SA optimisation 1), not set by the planned effect. P-G6 and MB-18 follow this form.
2. **P-7b added** (a language switch while the warm read is in flight). In P-7, the clear-after-apply hid MB-7, so it survived the first mutation run.
3. **The new tests build payloads by hand** in the wire shape instead of calling the entitlements builder, so no new file imports that module (SA-CB-8). The four unedited Plan suites still pin the real builder.
4. `accountCard.guard`'s test **title** was also reworded (SA optimisation 3, optional).
5. P-9 steps the 4 s interval once, then flushes microtasks a fixed five times without moving the clock, instead of using `waitFor`. That way fake timers cannot fire a second re-read.

### Questions for SA

1. **MB-6** survives as an equivalent mutant (see above). Keep the clear-after-apply as defence in depth (Dev recommends keeping it), or drop it as redundant?
2. P-8..P-10 and D-8 hand-build the purchase and upgrade wire shapes instead of using `readPlanPurchaseView`. Is that acceptable, given that the four Plan suites keep the real builders?

## SA Code Review (2026-10-17)

**Code Review by SA, 2026-10-17**, worktree `neuronforge-phase-c`, branch `feature/settings-drawer-c-b` at `fcce705a` + uncommitted diff (read only; nothing run against production).
**Status:** ✅ **Code Approved**. No High or Medium findings. QA's pass is the remaining gate; then RM under the Phase C fast-track. M-6..M-10 stay owed by a human after deploy (SA-CB-11), not a merge gate, unless the user says otherwise.

### What was verified

| Check | Result |
|---|---|
| **SA condition C-11** | `git diff` is empty for `PlanPurchase.tsx`, `PlanUpgrade.tsx`, `PlanEmbeddedCheckout.tsx`, `lib/business-os/billing/**` (incl. `checkoutProcessing`, `checkoutReturnMarker`), `useLinkOpenedDrawer.ts`, `useDrawerPrefetch.ts` and `app/api/**`. The only tracked changes are `page.tsx`, `PlanSection.tsx`, the two guard edits and the requirement MD. `checkoutMarker={searchParams?.get('checkout') ?? null}` is byte-identical (P-G3, with a `\|\|` control). The warm read is used only when `!isCheckoutReturnMarker(checkoutMarker)`; `completedSession` / `upgradeTarget` are `null` at mount; the bounded re-read and Check again still call `fetchPlan` from unedited call sites. "You're on" can only come from a server read after the action (P-8, P-9, P-10, D-7, D-8). |
| **B-1** | `take` sits in a ref-guarded (`firstStarted`) mount effect, not in render or an initializer. StrictMode: P-4 warm (take ×1, 0 requests) and cold (exactly 1 request), D-6. |
| **B-2** | First read only. A language re-run reads fresh (`pending.language !== language` clears it), the first read is cleared once applied, re-reads and Check again fetch. P-5, P-7, P-7b, P-9, P-10. |
| **B-3** | Key `${user.id}:${language}`; `readMyPlan` sends the URL alone (R-1 asserts the call args are exactly `[url]`; R-4 no language). The rationale comment moved to the module; `PlanSection` keeps a pointer. |
| **B-4** | `page.tsx` imports only `startPlanDrawerRead`; no `my-plan` literal (`accountCard.guard` assertion unchanged; P-G5). |
| **SA-CB-1** | Render-derived: `if (planDrawer.open && !planDrawerOpened) setPlanDrawerOpened(true); const planWarmSpent = planDrawerOpened && !planDrawer.open;`. Never true while open; true in the closing render; `enabled` and `paused` flip in the same render. Declared before the hook call and before `if (loading) return`, so hook order is stable. No `if (!planDrawer.open …)` anywhere (P-G6; `settingsDeepLinks.guard` green and unedited). D-3/D-8 run every idle callback ever scheduled, with a no-op `cancelIdleCallback` (worst case), and still see no warm after the close. |
| **SA-CB-2** | One `try` over `fetch` + `json()`; reads only `json()` and `status`; URL inline; no import, no module state, no log. |
| **SA-CB-3** | The mount effect is immediately before `[language]` (P-G8, with swap and interposed-effect controls). |
| **SA-CB-4** | `logger.error({ err: answer.err }, 'Could not load the plan section')` byte-identical, same error object (P-11 `toBe`). Both `warn` lines untouched (unedited call sites). `finally` keeps `if (!cancelled) setLoading(false)`. The discard log is `debug` with `{ reason, status }` / `{ reason, err }` only. `planFrom` is equivalent to the old `body?.success && body?.data` for every body shape (null, primitive, array, object). The async body cannot reject. |
| **SA-CB-5** | `git diff` is empty for `PlanSection.render`, `PlanPurchase.render`, `PlanUpgrade.render`, `PlanPaymentState.render`, `useLinkOpenedDrawer.test` and `settingsDeepLinks.guard`. |
| **SA-CB-6** | `prefetchCall` is anchored on `const consentPrefetch = useDrawerPrefetch(`; T-G1 = exactly two calls named `['consentPrefetch','planPrefetch']`; every T-G1 control is wrapped in `hitsConsent`; the rename control is added. No other assertion changed. |
| **SA-CB-7** | Plan-row comment reworded; `accountCard.guard` header and title updated, assertion unchanged. |
| **SA-CB-8 / 9** | A grep of import statements (`from`, `import(`, `require(`) over every touched and new file finds **no** `lib/business-os/entitlements` import, type-only included, so the registration checklist does not apply. P-G7 matches specifiers only, with a non-vacuity check (the URL does not trip it) and a type-only control. |
| **Frozen code** | `loadData`, the deep-link effect, `handleLogout`, the Language / Currency / Timezone rows: no hunk touches them. |
| **Logging** | `console.*`: 0 in `page.tsx`, `PlanSection.tsx`, `planDrawerReads.ts`. Logger module unchanged. |

### Re-run by SA (2026-10-17)

| Command | Result |
|---|---|
| Must-stay-green set (C-a command + `themePrepaint.guard` + `PlanEmbeddedCheckout` + `my-plan` route + `accountsTab.render`) | ✅ 56 suites, 954 tests (P-7b included) |
| `npm run test:bos-entitlements` | ✅ 280 suites, 8459 tests |
| ESLint on `page.tsx`, `PlanSection.tsx`, `planDrawerReads.ts` | ✅ 0 errors; 1 pre-existing warning on the untouched `loadData` effect |

### Code Review Comments

1. `PlanSection.tsx` `[language]` effect: `if (first !== null) firstRead.current = null;` (MB-6) is an equivalent mutant under today's call sites, as Dev states. Priority: Low (no action; see the Q-1 ruling).
2. `PlanDrawer.prefetch.render.test.tsx` harness: `enabled: !planWarmSpent` omits `!loading && !isConfigurationOpen`. Acceptable: the harness models the drawer and spent-flag interaction, and P-G1 pins the page's full expression exactly. Priority: Low (no action).
3. Dev Q-2 (hand-built payloads): see the ruling. Priority: Low (no action).

No High or Medium findings.

### Rulings on Dev questions

- **Q-1 (MB-6): keep the clear-after-apply line.** It makes "the first read is spent once applied" an explicit invariant, instead of one that holds only because today's re-run triggers are a language change (which clears it anyway) and StrictMode's pre-apply re-run. A same-language re-run after apply (Fast Refresh with refs preserved, or a future React that re-runs effects when content is shown again) would otherwise re-apply a stale first answer; with the line it reads fresh, which is the B-2 direction. One line, no cost. Record MB-6 as an accepted equivalent mutant; no test is required for it.
- **Q-2 (hand-built purchase and upgrade payloads): acceptable.** They are typed against the exported `PlanPayload`, and this repo's Jest runs `ts-jest` with diagnostics on, so a drift in that type fails these suites at compile time. The new tests assert which request is made and which answer (WARM / FRESH) is shown, not how the builder shapes a plan; the four unedited Plan suites keep the real builders for that. It also keeps every new file free of an entitlements import (SA-CB-8).

### Optimisation Suggestions

- None blocking. `useDrawerPrefetch` now has two settings-page users with near-identical options. If a third drawer ever adopts it, consider a small page-local helper for the shared `key` / `enabled` terms. Not for this slice.

### Code Approved for QA: Yes

## QA Testing Report

See [QA Report (2026-10-17)](#qa-report-2026-10-17).

## QA Report (2026-10-17)

**QA — 2026-10-17**, worktree `neuronforge-phase-c`, branch `feature/settings-drawer-c-b` (uncommitted, HEAD `fcce705a`). No production code edited, no production query, no browser.
**Test mode:** full (code level) · **Strategy:** A/B (Jest render + source guards) and mutation testing; D (manual browser) NOT RUN · **Focus:** ui, purchase surface (SA condition C-11) · **Skipped:** the manual M-list (no browser in this session) · **Input source:** TL prompt.

**Verdict: PASS WITH NOTES.** No bug found. Notes: the manual M-list is owed (incl. M-6..M-10 in Stripe test mode); two exploratory mutants survive (test gaps on cancellation guards, Low); one count typo in the Dev table.

### Test runs

| Run | Result |
|---|---|
| New suites: `planDrawerReads` / `PlanSection.prefetch` / `PlanDrawer.prefetch` / `planPrefetch.guard` | ✅ 10 / 23 / 8 / 23 (64/64). Dev's table says `planPrefetch.guard` 25: the suite has **23** tests (its total is correctly inside the 139 below). Doc nit only |
| Four Plan render suites (`PlanSection`, `PlanPurchase`, `PlanUpgrade`, `PlanPaymentState`), unedited | ✅ 175/175 |
| `app/business-os/settings` guards | ✅ 7 suites, 139/139 |
| Must-stay-green (Dev's command, 55 suites) | ✅ 55 suites, **936**/936 (Dev's 935 + P-7b, as Dev noted) |
| `app/admin/finance/__tests__/accountsTab.render` | ✅ 18/18 |
| `npm run test:bos-entitlements` | ✅ 280 suites, 8459/8459 |
| `git diff` on the four Plan suites, `useLinkOpenedDrawer.test.tsx`, `settingsDeepLinks.guard.test.ts` | ✅ empty (SA-CB-5 holds) |

### Code-level paths (SA condition C-11)

| Path | Result | Evidence |
|---|---|---|
| Warm open = zero requests | ✅ | P-1, P-2, D-1, D-2 |
| Cold open = one request | ✅ | P-3 (no prop, and a prop returning `null`) |
| StrictMode = one request, one take | ✅ | P-4 (warm and cold), D-6; QA-12 killed |
| Checkout return (`?section=plan&checkout=cs_…`) never uses the warm read; success needs the server answer | ✅ | P-5, P-12 (marker), D-7, P-9 (the success line comes only from the re-read's FRESH answer), P-8 (a warm renewing plan never shows `plan-purchase-done` / `plan-upgrade-done`); QA-1, QA-9 killed. Code read: `take()` is always called, and the set is discarded when `isCheckoutReturnMarker(checkoutMarker)` |
| Close mid-upgrade, reopen within 60 s = fresh read, never the old plan with Upgrade | ✅ | D-8 (the confirm resolves after the close, +5 s, hover and idle run late → no warm; reopen → one GET, FRESH shown, WARM absent), D-3; QA-3, QA-4 killed |
| Language change re-fetches | ✅ | P-6, P-7, P-7b; QA-2 killed |
| "Check again" fetches | ✅ | P-10; QA-6 killed |
| Bounded re-read fetches | ✅ | P-9; QA-7 killed |

### Mutations (QA, beyond Dev's MB-1..MB-23)

Script `qa-cb/mutate.js` in my scratchpad: each mutation applied (EOL-aware), the named suites run, the file restored in `finally` and SHA-1 checked against the baseline after every mutation. `git diff --numstat` identical before and after; all four SHA-1s match the baseline.

| # | Mutation | Result | Killed by |
|---|---|---|---|
| QA-1 | Warm used despite a valid marker: marker check narrowed to `cs_live_` sessions (a `cs_test_` return uses the warm read) | ✅ killed | P-5, P-12 (marker), D-7 |
| QA-2 | Warm used after a language switch: a preloaded first read applied whatever the language | ✅ killed | P-7b |
| QA-3 | Spent flag set on the open (page and harness) | ✅ killed | P-G6; D-1, D-2, D-3, D-6, D-8 |
| QA-4 | Spent flag never set (page and harness) | ✅ killed | P-G6; D-3, D-8 |
| QA-5 | `paused` inverted (page and harness) | ✅ killed | P-G1; D-1, D-4, D-5, D-6, D-7 |
| QA-6 | "Check again" reuses the warm read | ✅ killed | P-10 |
| QA-7 | Bounded checkout/upgrade re-read reuses the warm read | ✅ killed | P-9 |
| QA-8 | Warm plan accepted unless `status === 'unavailable'` (lets `no_plan_record` and `success: false` through) | ✅ killed | P-11 (500, `no_plan_record`) |
| QA-9 | A usable warm answer marked as a completed purchase (`setCompletedSession`) | ✅ killed | P-8, P-9, P-10 |
| QA-10a | Route URL as a top-level `const` in `page.tsx` | ✅ killed | `accountCard.guard`, P-G5 |
| QA-10b | Route URL as a top-level `const` in `planDrawerReads.ts` | ✅ killed | P-G7 (module-state allow-list) |
| QA-11 | First-read effect declared after the `[language]` effect, run against the **render suite only** (guard excluded) | ✅ killed at runtime, 22/23 fail | P-1..P-4 and others: the order is enforced by behaviour, not only by P-G8 |
| QA-12 | StrictMode double take: `firstStarted` reset in the mount effect's cleanup | ✅ killed | P-4 (warm and cold), D-6 |
| QA-13 | A failed **cold** first read is also re-read (`preloaded` term dropped) | ✅ killed | P-11 cold-failure parity case; existing `PlanPurchase.render` "a failed FIRST read does not hide a later good re-read" |
| QA-14 | `finally` guard dropped (`setLoading(false)` even when cancelled), exploratory | ⚠️ survived | none (Edge case 1) |
| QA-15 | `if (cancelled) return;` after the fresh re-read of an unusable warm answer removed, exploratory | ⚠️ survived | none (Edge case 2) |

13/15 killed. The 2 survivors are exploratory checks of cancellation guards, not of the C-b rules. (A first pass of the script missed anchors because the working copy is CRLF; those mutations were re-run EOL-aware and the table is the valid run.)

### Issues found

#### Bugs (must fix before commit)

None.

#### Performance issues

None. One extra read-only idle GET per visit is the accepted cost (Risk R-1).

#### Edge cases (nice to fix, Low)

1. **QA-14 survives: no test pins the `finally` guard `if (!cancelled) setLoading(false)`.** The guard predates C-b (it was in the original `[language]` effect), SA-CB-4 required keeping it, and the code does. Without it, a cancelled run (StrictMode, or a language switch mid-load) could clear the spinner before the kept run applies. Optional test: switch language while the first read is in flight and assert the spinner stays until the new answer. Not blocking.
2. **QA-15 survives: no test unmounts or switches language while the fresh re-read of an unusable warm answer is in flight.** The guard is present and correct in code. Without it, a switch to `he` during that re-read could let the old `en` answer land after the `he` one (names in the wrong language until the next read). Optional test: P-7b's shape with an unusable warm answer and a deferred fresh reply. Not blocking.
3. **Page mutations are killed only by source guards.** The D harness re-implements the page wiring, so QA-3/4/5 on `page.tsx` alone are caught by P-G1/P-G6, and on the harness by the D tests. Same pattern as C-a; the guards pin the page to the harness form. Recorded for awareness.
4. Doc nit: Implementation Notes "Verification" lists `planPrefetch.guard` as 25 tests; the suite has 23.

### Manual QA — NOT RUN

No browser in this session. Owed by a human: **designated test account only, Stripe test mode only** (test keys, card `4242 4242 4242 4242`), local build against a non-production database (record which). DevTools Network tab open, filtered on `my-plan`.

| # | Steps | Status |
|---|---|---|
| M-1 | Load `/business-os/settings`, wait 5 s: exactly one `my-plan` GET (plus C-a's pair). Click Your plan: no new `my-plan` GET; the plan is visible as the drawer slides in | NOT RUN |
| M-2 | Reload; hover the Plan row before idle: one GET. Click: none | NOT RUN |
| M-3 | Close the drawer; hover, tab focus onto the row, wait 5 s: no GET. Reopen: exactly one GET | NOT RUN |
| M-4 | Reload; switch language (en→he); open: plan names in Hebrew | NOT RUN |
| M-5 | With the drawer open, switch language: one fresh GET; names catch up | NOT RUN |
| M-6 | Free/trial test account: Choose a plan → embedded checkout → `4242…` → "Payment processing" → "You're on <plan>". URL gains `?section=plan&checkout=cs_test_…`; GETs every 4 s until success | NOT RUN |
| M-7 | Reload the M-6 URL: the drawer opens itself; its first `my-plan` GET starts **after** the open (none reused); "Payment processing" or "You're on" | NOT RUN |
| M-8 | Close after M-6: `section` leaves the URL, `checkout` stays; reopen → one fresh GET | NOT RUN |
| M-9 | Paying test account: Upgrade → confirm → "Upgrading…" → "You're on <plan>". Repeat to another tier and close the drawer right after confirming; reopen within 60 s: one fresh GET, no stale "Upgrade to …" | NOT RUN |
| M-10 | Make an upgrade answer unknown (e.g. DevTools: go offline right after the confirm POST): press "Check again" → one fresh GET; the "taking longer than usual" link → a full navigation and a fresh GET | NOT RUN |
| M-11 | Founding Partner pill (`?section=plan`): the drawer opens | NOT RUN |
| M-12 | Phone viewport: tap to open; Hebrew right to left; focus returns to the row on close | NOT RUN |

### Final status

- [x] All automated checks pass, no bug: **PASS WITH NOTES**. Ready for RM under the Phase C fast-track, with M-1..M-12 (M-6..M-10 in Stripe test mode) listed in the PR as owed by a human tester, per SA's recommendation, unless the user chooses to hold the merge for M-6..M-10.
- [ ] Issues found — Dev must address before commit
- [x] **RM (2026-10-17):** committed + PR with auto-merge under the Phase C fast-track. The user did not ask to hold the merge for M-6..M-10, so M-1..M-12 are owed by a human after deploy and listed in the PR body.

## Commit Info

*(RM to populate.)*

| Item | Value |
|---|---|
| Branch | `feature/settings-drawer-c-b` |
| Commit | `perf(settings): load the Plan drawer ahead of the click (C-b)` (hash in the PR) |
| PR | Opened against `main`, auto-merge `--merge` (number recorded in the PR / requirement change history) |
| Gates | SA code review APPROVED; QA PASS WITH NOTES; Phase C fast-track (user, 2026-10-16) |
| Owed after deploy | Manual M-1..M-12 (M-6..M-10 Stripe test mode, test account only) |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Created | Dev workplan for C-b (§0.6 item C-2, C-1 folded in per R-5) on `feature/settings-drawer-c-b`, `origin/main` `fcce705a` merged in (fast-forward, after #442). `planDrawerReads.ts` (one copy of the `my-plan` request, never rejects, no language sent); `PlanSection` takes the warmed read once per mount in a ref-guarded effect outside the cancellable `[language]` effect (B-1), only with no valid checkout marker and the same language (B-2, B-3); re-reads, Check again and the language re-read always fetch; success only from the server (M-6, U-5). Page: second `useDrawerPrefetch` call, `paused: planDrawer.open`, warm handlers on the Plan row, route literal kept out (B-4), and no warm after the first close (rule 7, Q-1). Timing-independent tests (R, P, D, P-G), 20 mutations, manual QA in Stripe test mode, risks, Q-1..Q-10. No code; awaiting SA workplan review |
| 2026-10-16 | SA workplan review | **APPROVED WITH CONDITIONS** SA-CB-1..11. Q-1 option (b) `planWarmSpent` approved (Plan drawer has no busy lock; a warm after close could predate an upgrade/webhook); Q-2..Q-10 approved. Conditions: `readMyPlan` one try over fetch+json, reads only `json`/`status`, URL inline (SA-CB-2); effect order pinned + MB-21 (SA-CB-3); exact logging parity (SA-CB-4); four Plan suites unedited through the whole slice (SA-CB-5); `consentPrefetch.guard` anchor/count/negative-control details (SA-CB-6); stale Plan-row comment in `page.tsx` reworded (SA-CB-7); entitlements evidence + `test:bos-entitlements` (SA-CB-8); P-G7 import-only regex with type-only control (SA-CB-9); P-12 marker case, MB-22, MB-23 (SA-CB-10); manual QA scope (SA-CB-11). User decision: whether merge waits for a hands-on Stripe test-mode buy/upgrade (SA recommends not) |
| 2026-10-17 | Code complete (Dev) | All of SA-CB-1..11 applied; [Implementation Notes](#implementation-notes) added. `planDrawerReads.ts`; `PlanSection` takes the first read once, in a ref-guarded effect declared immediately before `[language]`; page wiring with the **render-derived** spent flag (SA optimisation 1); `consentPrefetch.guard` edited per SA-CB-6; new R, P, D and P-G suites (+ P-7b). The four Plan suites, `useLinkOpenedDrawer.test` and `settingsDeepLinks.guard` unedited and green; must-stay-green 935/935; `test:bos-entitlements` 8459/8459; `typecheck:bos-llm` 0 new; tsc 0 errors in touched files; `lint:hooks` clean. Mutations: all killed except MB-6 (equivalent; question for SA). M-6..M-10 NOT RUN (owed by a human after deploy). Not committed |
| 2026-10-17 | SA code review | **Code Approved**, no High or Medium findings. C-11 verified: the purchase, upgrade, checkout, billing, hook and route diffs are empty; the marker expression is byte-identical; the warm read is never used with a valid marker; success comes only from a server read. B-1..B-4 and SA-CB-1..10 verified; the SA-CB-5 frozen suites have empty diffs; no entitlements import. SA re-ran must-stay-green (56 suites / 954 tests) and `test:bos-entitlements` (280 / 8459): green. Rulings: Q-1 keep the clear-after-apply line (MB-6 accepted as an equivalent mutant); Q-2 hand-built payloads acceptable (typed, ts-jest diagnostics). M-6..M-10 owed by a human after deploy, not a merge gate |
| 2026-10-17 | QA report | **PASS WITH NOTES.** New suites 64/64; four Plan suites 175/175 unedited; settings guards 139/139; must-stay-green 55 suites 936/936; `accountsTab.render` 18/18; `test:bos-entitlements` 8459/8459; `git diff` empty on the four Plan suites, `useLinkOpenedDrawer.test`, `settingsDeepLinks.guard`. 15 QA mutations (QA-1..QA-15): 13 killed; 2 exploratory cancellation-guard survivors (QA-14, QA-15) recorded as Low edge cases. No bugs. Doc nit: `planPrefetch.guard` has 23 tests, not 25. Manual M-1..M-12 NOT RUN (no browser; M-6..M-10 Stripe test mode, test account only) |
| 2026-10-17 | Committed + PR (RM) | SA APPROVED + QA PASS WITH NOTES; committed and PR opened with auto-merge under the Phase C fast-track. Doc nit fixed: `planPrefetch.guard` has 23 tests, not 25. M-1..M-12 owed by a human after deploy, not a merge gate. Completes Phase C |
