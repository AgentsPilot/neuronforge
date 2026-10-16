# Workplan: Settings drawer C-a — Marketing permission opens fast

> **Last Updated**: 2026-10-16

**Developer:** Dev
**Requirement:** [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md) §0.6 (items C-3, C-4, C-5) and §0.6.1 (slice plan); SA conditions C-1, C-5, C-8, C-10, C-12; F-17, F-18
**Branch:** `feature/settings-drawer-phase-c` (from `origin/main` `447d17a2`, fast-forwarded to `origin/main` `09e2d3ad` before coding; `page.tsx` checked against `988d714c`, unchanged since)
**Date:** 2026-10-16
**Path:** UI short path **with SA workplan review first**. The new prefetch hook is a new pattern (rule 7), and the shared picker carries the F-18 fix. After that: Dev, then SA code review and QA in parallel, then the user sees the diff, then RM.
**Status:** Code complete 2026-10-16, **not committed**. SA code review ✅ (CR-CA-1); QA ❌ on QA-CA-B1, **fixed by Dev the same day** with gaps QA-MU-1/4/7 closed (see [QA bug fix](#qa-bug-fix-2026-10-16)). The fix adds a `paused` option to the hook (rule 6). Next: SA re-check of rule 6 and a targeted re-QA (T-D5 / S-7 plus the four prefetch suites), then the user sees the diff.
**Status (2026-10-16, RM):** SA re-check ✅, QA re-check ✅ PASS WITH NOTES. Committed and PR opened with auto-merge under the user's standing Phase C fast-track. **CR-CA-1 (placeholder height) and the manual M-list are deferred to the user after deploy.**

## Overview

Opening **Marketing permission** in settings takes 1–3 s (user, 2026-10-15). The form already appears as soon as the consent read returns. The address list then pops in late, because the shared `SavedAddressPicker` starts its own request only once the form has rendered. C-a removes the waterfall and most of the wait:

1. **C-3:** the panel starts the address-book read **at the same time as** the consent read and hands the result to the picker through a new optional `initialBook` prop.
2. **C-4:** until the book is in, a fixed-height placeholder holds the picker's place, so nothing jumps.
3. **C-5:** the settings page starts both reads early, when the browser is idle after the page loads and again on row hover, focus or press, through a new `useDrawerPrefetch` hook. The drawer **takes** those reads when it opens instead of asking again.

No route, server, database or translation change. F-18's rule that the picker never fills on its own, S-3's dirty baseline and discard guard, and F-17's failed-load screen are kept exactly. Each rule has a test that runs with preloaded data.

> In this workplan "C-3/C-4/C-5" are the §0.6 *items*; the SA *conditions* are always written "SA condition C-n".

---

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Implementation Approach](#implementation-approach)
3. [Correctness rules kept with preloaded data](#correctness-rules-kept-with-preloaded-data)
4. [Stale data and refresh rules](#stale-data-and-refresh-rules)
5. [Files to Create / Modify](#files-to-create--modify)
6. [Task List](#task-list)
7. [Tests](#tests)
8. [Mutation candidates](#mutation-candidates)
9. [Manual QA and measurement](#manual-qa-and-measurement)
10. [Risks](#risks)
11. [Questions for SA](#questions-for-sa)
    - [Implementation Notes](#implementation-notes)
12. [SA Review Notes](#sa-review-notes)
    - [SA Workplan Review (2026-10-16)](#sa-workplan-review-2026-10-16)
13. [QA Testing Report](#qa-testing-report)
    - [QA bug fix (2026-10-16)](#qa-bug-fix-2026-10-16)
14. [Commit Info](#commit-info)
15. [Change History](#change-history)

---

## Analysis Summary

Read on `447d17a2`.

| Area | As built | Consequence |
|---|---|---|
| `app/business-os/settings/page.tsx` | The consent row is a button with `onClick={() => setConsentDrawerOpen(true)}`. It renders `<MarketingConsentDrawer open onOpenChange returnFocusRef />` and makes no consent or address request. `loading` is true while `loadData` runs. `useConfigurationDialog()` is already called (for `openConfiguration`). | Nothing starts before the click. |
| `MarketingConsentDrawer.tsx` | A `SettingsDrawer` wrapper that holds `isDirty` / `isSaving` for the guard (SA condition C-5) and renders `<MarketingConsentPanel onDirtyChange onBusyChange />`. Radix unmounts the content on close. | Every open mounts a fresh panel. |
| `MarketingConsentPanel.tsx` | On mount, `load()` → `GET /api/business-os/consent-settings?locale=…`. It shows a spinner until that returns, then the form. `loadInFlight` and `hasLoaded` refs; F-17 `loadFailed` only before the first success; `load(sentForm)` reloads after a save and keeps text typed during the save; `baseline` drives `isDirty`. The picker is rendered inside the form. | The book request starts only after consent has returned: **waterfall**. |
| `components/ui/SavedAddressPicker.tsx` | Fetches `GET /api/business-os/addresses?locale=…` (`no-store`) in an effect on `[locale, refreshKey, localVersion]`. Renders `null` until loaded and `null` for an empty book. Derives the selection after the fetch. In the text form (`matchCurrent`), it marks and never fills (F-18). Otherwise it marks the matching entry, or takes the default for an empty form. Other callers: `BusinessProfileSection`, `InvoiceSettingsSection` (no `matchCurrent`). | The list pops in late and pushes the postal box down (layout jump). |
| Routes | `consent-settings` GET: `getUser` plus 4 parallel reads. `addresses` GET: `getUser` plus 2 parallel reads. **Both read-only:** no insert, audit or external call. | A speculative read has no side effect. |
| Guards | `accountCard.guard` forbids the consent route literal in `page.tsx` (SA condition C-8). `settingsDeepLinks.guard` pins the consent row's `onClick` and the drawer's three props. `MarketingConsentPanel.pickerCall.guard` slices the picker call up to `'\n          />'` (fixed indent), and G-4 keeps the real picker in `MarketingConsentPanel.picker.render.test.tsx`. | Plan around them (see Tests). |
| Test mocks | `MarketingConsentDrawer.render.test.tsx` queues `fetch` replies **by call order** (`mockImplementationOnce`) and reads request bodies by call index. | A new address GET at mount would shift every queued reply. Handled by mocking the new read module there (Q-7). |
| Precedent | No data prefetch exists in Business OS. `lazyDialogs.tsx` prefetches code. `lib/utils/request-deduplication.ts` is a module-level singleton with a 1 s TTL that uses `console.*`. `theme-provider.tsx` has the local `useIsomorphicLayoutEffect` const. | A prefetch hook is new (rule 7). |
| `console.*` in touched files | `page.tsx` 0, `MarketingConsentDrawer.tsx` 0, `MarketingConsentPanel.tsx` 0, `SavedAddressPicker.tsx` 0 | Nothing to flag. |

---

## Implementation Approach

### A-1. Two small read modules (one copy of each request)

- **`components/ui/addressBookRead.ts`** has `readAddressBook(locale): Promise<AddressBookRead>`. It runs `fetch('/api/business-os/addresses?locale=…', { cache: 'no-store' })` and parses `data.addresses` exactly as the picker does today. **It never rejects.** It returns `{ ok: true, locale, addresses } | { ok: false, status }`, where `status` is `null` on a network error. The picker's own fetch switches to it, so the panel's read and the picker's read cannot drift. `KnownAddress` stays exported from `SavedAddressPicker.tsx`; the read module imports it type-only.
- **`components/business-os/settings/marketingDrawerReads.ts`** has three exports:
  - `readConsentSettings(locale): Promise<ConsentRead>`, the panel's existing GET. It never rejects and returns `{ ok: true, status, body } | { ok: false, status }`.
  - `startMarketingDrawerReads(locale): MarketingDrawerReads`, which starts **both** reads synchronously and returns `{ locale, consent: Promise<ConsentRead>, book: Promise<AddressBookRead> }`.
  - The two types.

  The page imports `startMarketingDrawerReads` only, so `page.tsx` still never names the route (`accountCard.guard` unchanged).

Neither module logs payload values. They log nothing at all: the panel already logs statuses, and it keeps doing so.

### A-2. Parallel book read in the panel (C-3) and the placeholder (C-4)

`MarketingConsentPanel` gains one optional prop, `takePrefetched?: () => MarketingDrawerReads | null`.

- **One mount effect replaces `useEffect(() => { void load(); }, [load])`.** It is guarded by a `started` ref, so a StrictMode re-run starts nothing twice; refs survive React 18's simulated remount. It runs in this order:
  1. `const pre = takePrefetched?.() ?? null`. It is used only if `pre.locale === languageRef.current`.
  2. **Starts the book first**: `pre?.book ?? readAddressBook(lang)`. A prefetched book that came back `ok: false` falls back to **one** fresh read.
  3. Calls `load({ preloaded: pre?.consent })`.

  Both requests are in flight before either is awaited.
- **`load(options?: { sentForm?: Settings; preloaded?: Promise<ConsentRead> })`.** It changes from a positional to an options object, and the two callers (`save`, `retry`) are updated. The only new behaviour: when `preloaded` is given, it awaits that instead of reading. If the preloaded read is `ok: false`, it reads **once more, fresh**, before deciding anything. Everything after that is unchanged: the status check, the `success`/`isPayload` check, `seeded()`, the keep-typed-text rule, `setBaseline`, the F-17 branch, `hasLoaded`, `loadInFlight`. `retry()` and the reload after a save never pass `preloaded`, so they always read fresh.
- **Book state** is `'pending' | { ready: { locale, addresses } } | 'failed'` and is held in the panel.
  - **Pending:** the postal block renders a placeholder `<div data-testid="consent-address-book-placeholder" aria-hidden="true">` at a fixed height. The height is about one entry plus the "Enter a different address" row plus the title (~8.5 rem; the exact value is set against the real picker during implementation). It carries a muted pulse in V2 tokens.
  - **Ready:** `<SavedAddressPicker … initialBook={{ locale, addresses }} />`, with every existing prop unchanged.
  - **Failed:** no picker. Today a failed book read also shows nothing (the picker returns `null`); SA to confirm, Q-5.
  - **An empty book:** the picker returns `null` as it does today, so the placeholder collapses. That is the one remaining layout change, and only for a business with no saved address (accepted, R-7).
- The form still renders the moment consent arrives, whether or not the book is in. The book never touches `form` or `baseline`.

### A-3. `initialBook` on the shared picker

The picker gets a new optional prop, `initialBook?: { locale: string; addresses: KnownAddress[] }`. Its doc comment says: "The book, already read by the caller for `locale`. The first render shows it, with no request and no empty frame. It is read once, at mount. A delete, a `refreshKey` change or a different `locale` reads the book again, exactly as without it. The selection is derived from it exactly as from a fetched book."

- The seed is accepted only when `initialBook.locale === locale` at mount. Otherwise it is ignored and the picker fetches as today.
- `options` and `loaded` are initialised from the seed, so the first render already shows the list. There is no `null` frame.
- **One derivation function.** The selection block inside today's effect is extracted unchanged into `deriveSelection(book)`. It reads the same refs (`selectedRef`, `matchCurrentRef`, `currentRef`). In the text form it marks and never calls `onSelect`. Otherwise it keeps today's structured behaviour. Both the fetched path and the seeded path call this one function, so they cannot diverge.
- **The seeded derivation runs in a `useIsomorphicLayoutEffect`.** This is the local-const pattern already in `lib/design-system-v2/theme-provider.tsx`. The mark lands before paint, so the "Enter a different address" radio never flashes for one frame. The fetch effect keeps its dependencies `[locale, refreshKey, localVersion]`. It **skips the request** when the seed is in force (`localVersion === 0`, `refreshKey` equals its value at mount, `locale` equals the seed's). This condition is deterministic, so a StrictMode re-run does not fetch either. A delete (`localVersion` bump), a new `refreshKey` or a language switch fetches, as today.
- The fetched path calls `readAddressBook` (A-1). Its behaviour is unchanged: on failure `loaded` becomes true with no options, so the picker renders nothing.
- The profile and invoice callers pass nothing new and are not edited. Their pin tests (`SavedAddressPicker.default.test.tsx`, `InvoiceSettingsSection.render.test.tsx`) stay green unchanged.

### A-4. The prefetch hook (C-5): `useDrawerPrefetch`

**File:** `components/business-os/settings/useDrawerPrefetch.ts`. It is a hook in a dedicated file, like `useLinkOpenedDrawer`.

```typescript
export interface DrawerPrefetch<T> {
  /** Start the reads now, unless a usable set is already held. Stable identity. */
  warm: () => void;
  /** Hand over the held set if it is usable now, and forget it. Stable identity. */
  take: () => T | null;
}

export function useDrawerPrefetch<T>(options: {
  /** Starts the reads. Must not throw; its promises must never reject. */
  start: () => T;
  /** Who and in what language, e.g. `${userId}:${language}`. `null` = never prefetch. */
  key: string | null;
  /** False while the page is still loading, or while something that can change the data is open. */
  enabled: boolean;
  /** How long a started set stays usable, measured from its start. */
  maxAgeMs: number;
  /** Also warm once the browser is idle after `enabled` turns true. */
  warmOnIdle: boolean;
}): DrawerPrefetch<T>;
```

- **State lives in a `useRef` inside the page's own component.** There is no provider, no context and no module-level cache, so nothing survives the page unmounting (a sign-out, a navigation). Holding `key` inside the entry means a different account or language can never be handed someone else's read.
- `warm()` is a no-op when `!enabled`, when `key === null`, or when a set is already held for the same key and is still within `maxAgeMs`. Otherwise it calls `start()` and holds `{ value, key, startedAt: Date.now() }`.
- `take()` returns the held value only if its key equals the current key and its age is ≤ `maxAgeMs`. **It always clears the held entry** (consume-once), whether or not it was usable.
- An effect drops the held entry whenever `enabled` turns false or `key` changes.
- **Idle warming.** An effect on `[enabled, key, warmOnIdle]` schedules `warm` with `requestIdleCallback(…, { timeout: 2000 })`, or `setTimeout(…, 1500)` where `requestIdleCallback` does not exist (Safari). Cleanup cancels it.
- The latest `options` are read through a ref, so `warm` and `take` keep stable identities and can be passed as props and event handlers without re-renders.
- `DRAWER_PREFETCH_MAX_AGE_MS = 60_000` is exported from the hook file (Q-3).

**Why not the alternatives (rule 7):**

| Option | Why not |
|---|---|
| React context / provider around the settings page | SA condition C-1 set the drawer family as "no context, no provider". A provider is a wider pattern than one page needs. |
| Module-level cache, or `lib/utils/request-deduplication.ts` | The state outlives the page: a sign-out and sign-in in the same tab could reuse the previous account's read. The util is global, has a 1 s TTL and uses `console.*`. |
| SWR / React Query | A new dependency and a new data layer for two reads. |
| A Next.js router prefetch | Prefetches routes and code, not API data. |

### A-5. Page wiring (`page.tsx`, additive)

- `const { openConfiguration, isConfigurationOpen } = useConfigurationDialog();`. The page already calls this hook; one more field is destructured.
- One hook call, kept separate from `loadData` and the deep-link effect:
  ```typescript
  const consentPrefetch = useDrawerPrefetch({
    start: () => startMarketingDrawerReads(language),
    key: user?.id ? `${user.id}:${language}` : null,
    // Not while the page's own reads run; never while the configuration dialog
    // is open, because that is where the address book is edited.
    enabled: !loading && !isConfigurationOpen,
    maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS,
    warmOnIdle: true,
  });
  ```
- On the consent row button: `onPointerEnter={consentPrefetch.warm}`, `onFocus={consentPrefetch.warm}`, `onPointerDown={consentPrefetch.warm}`. The last one covers touch, where there is no hover. **`onClick` is unchanged**, so the pin in `settingsDeepLinks.guard` holds.
- `<MarketingConsentDrawer … takePrefetched={consentPrefetch.take} />`, and the drawer passes it to the panel.
- Frozen code is untouched: `loadData`, `persistTimezone`, `saveProfile`, `handleExportData`, the Language, Currency and Timezone rows, the deep-link effect, and the three `darkModeTokens` dropdown rows (SA condition C-9).

### A-6. SA condition C-8 (page-load requests), stated

C-a adds one new page-load request pair. It is listed here as SA condition C-8 requires:

| Request | When | Through | Reused by |
|---|---|---|---|
| `GET /api/business-os/consent-settings?locale=<language>` | Browser idle after `loadData` finishes, and on consent-row hover, focus or press; at most once per 60 s window while unused | `startMarketingDrawerReads` → `readConsentSettings` | The panel's first `load()` on open |
| `GET /api/business-os/addresses?locale=<language>` | Same moment, same call | `startMarketingDrawerReads` → `readAddressBook` | The panel's book state → the picker's `initialBook` |

It runs in its own effect (inside the hook), through existing routes, never in `loadData` and never through the browser Supabase client. The drawer reuses the result instead of fetching twice.

---

## Correctness rules kept with preloaded data

| Rule | How it holds | Pinned by |
|---|---|---|
| **F-18: the picker never fills on its own** (text form) | The seeded path calls the same `deriveSelection`, which in the text form calls only `onSelectedChange(id, 'derived')` and never `onSelect`. The panel still passes `matchCurrent` and `otherLabel`. The order of arrival does not matter: the picker mounts only once **both** the form is seeded (the consent `load` set `form` before the postal block exists) and the book is ready, so `matchCurrent` always sees the seeded text. | T-P1..T-P4, T-M6, T-M7 (real picker) |
| **User decision 2026-10-15:** saved addresses exist but the stored postal line is empty → the field stays empty, "Enter a different address" selected, nothing pre-marked | Same path: no match, so nothing is reported. | T-M7 |
| **S-3 dirty baseline** | `form` and `baseline` are set only from a consent read (preloaded or fresh), through the same `seeded()`. The book never writes either, so an untouched open is clean and the X closes at once. | T-M8, existing D-2, D-5, D-14 |
| **S-3 reopen is fresh** | `take()` is consume-once. A reopen uses either a set warmed **after** the close (the focus return or a hover, which is a fresh server read) or a fresh read by the panel. A discarded draft can never come back, because the drawer never holds data across a close. | T-H3, T-M10, existing D-3 |
| **F-17: no form and no Save until something has loaded** | A failed preloaded consent read is never shown: `load` reads once more, fresh, and the F-17 branch decides on that answer only. The book's success or failure has no effect on F-17. | T-M4, T-M5 |
| **Keep text typed during a save** | The reload after a save is `load({ sentForm })`: always fresh, never preloaded. | T-M9, existing D-7 |
| **One load at a time** | `loadInFlight` is unchanged. The mount effect is `started`-ref guarded. | T-M3 (StrictMode) |
| **SA condition C-5 discard guard / C-4 busy refusal** | `MarketingConsentDrawer` changes only by passing a prop through. | existing `SettingsDrawer.discard`, `MarketingConsentDrawer.*` |
| **SA condition C-10 layering** | The picker's DOM and z-index are unchanged; the placeholder is a plain block in the scroll body. | Manual QA M-9 |

---

## Stale data and refresh rules

1. **Used once.** A warmed set serves at most one open (`take` clears it).
2. **Maximum age 60 s** from the start of the request (Q-3). An older set is dropped, and the panel reads fresh.
3. **Same account and language only.** The key is `${userId}:${language}`. A language switch drops the held set, and the idle effect warms again in the new language.
4. **Never while the configuration dialog is open.** The business profile and invoice address forms live there and edit the address book. Opening it drops the held set and blocks warming. When it closes, the idle effect warms again, fresh.
5. **Never while the page is loading** (`!loading`), so the warm reads do not compete with `loadData`.
6. **A failed warm read is never shown.** The panel reads once more, fresh: consent through `load`, the book through its own fallback.
7. **Inside an open drawer nothing changes.** Try again, the reload after a save, and a delete or language change in the picker all read fresh, as today.
8. **The cross-device / other-tab window** is bounded by rule 2 and is no worse than a drawer left open today. Save is unchanged; the last write wins, as now (R-2).
9. **Never while the drawer itself is open** (added by the QA-CA-B1 fix, 2026-10-16; the hook's rule 6, `paused`). A save happens in the drawer, so nothing may start a pair while it is open. The set it opened with is still handed over, and the close drops anything left, so the first warm after a save is fresh. See [QA bug fix](#qa-bug-fix-2026-10-16).

---

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `components/business-os/settings/useDrawerPrefetch.ts` | create | A-4: the prefetch hook (consume-once, max age, key, enabled, idle) |
| `components/business-os/settings/__tests__/useDrawerPrefetch.test.tsx` | create | Hook unit tests T-H1..T-H9 |
| `components/business-os/settings/marketingDrawerReads.ts` | create | A-1: `readConsentSettings`, `startMarketingDrawerReads`, types |
| `components/ui/addressBookRead.ts` | create | A-1: `readAddressBook`, shared by the picker and the panel |
| `components/ui/__tests__/addressBookRead.test.ts` | create | Never rejects; parse parity; `no-store` |
| `components/ui/SavedAddressPicker.tsx` | modify | A-3: `initialBook` prop, extracted `deriveSelection`, fetch through `readAddressBook` |
| `components/ui/__tests__/SavedAddressPicker.initialBook.test.tsx` | create | T-P1..T-P9 (real picker) |
| `components/business-os/settings/MarketingConsentPanel.tsx` | modify | A-2: parallel reads, placeholder, `takePrefetched`, `load(options)` |
| `components/business-os/settings/MarketingConsentDrawer.tsx` | modify | Pass `takePrefetched` through (optional prop) |
| `components/business-os/settings/__tests__/MarketingConsentPanel.parallel.render.test.tsx` | create | T-M1..T-M12 with the **real** picker, fetch routed by URL with deferred replies |
| `components/business-os/settings/__tests__/MarketingConsentDrawer.prefetch.render.test.tsx` | create | T-D1..T-D4: hook plus drawer together (warm → open → zero new requests, and so on) |
| `app/business-os/settings/page.tsx` | modify | A-5: hook call, three warm handlers, one prop, one destructured field |
| `app/business-os/settings/__tests__/consentPrefetch.guard.test.ts` | create | T-G1..T-G5 source guard (wiring, `onClick` unchanged, not in `loadData`) |
| `components/business-os/settings/__tests__/MarketingConsentPanel.pickerCall.guard.test.ts` | modify (planned edit) | Make `pickerCall()` independent of indentation (the call moves inside the ready branch); add G-5 `initialBook={` |
| `components/business-os/settings/__tests__/MarketingConsentDrawer.render.test.tsx` | modify (planned edit) | `jest.mock('@/components/ui/addressBookRead')` resolving `{ ok: true, addresses: [] }`, so the call-indexed consent replies do not shift (Q-7) |
| `components/business-os/settings/__tests__/MarketingConsentDrawer.owner.test.tsx` | modify (planned edit, if it reaches the panel's fetch) | Same mock |
| `app/business-os/settings/__tests__/accountCard.guard.test.ts` | modify (comment only) | The header now says page-load reads go through the prefetch hook and read modules; the assertion is unchanged |
| `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` | modify | §0.6.1 progress line plus a Change History row at each stage |

No new translation keys: the placeholder has no text. No server, route, repository or migration change.

---

## Task List

- ✅ 1. Record the `page.tsx` commit checked against (C-13 practice) and re-read the four touched files at HEAD. (`origin/main` merged in first: fast-forward `447d17a2` → `09e2d3ad`; none of the four touched files changed.)
- ⏭ 2. **Skipped for now (TL, 2026-10-16):** the **before** measurement. Structure checks are the gate (SA-CA-12); the measurement is left ready for QA/TL in the QA section.
- ✅ 3. `addressBookRead.ts` and its test (A-1).
- ✅ 4. Picker: extract `deriveSelection` with **no behaviour change** and switch the fetch to `readAddressBook`. **SA-CA-15 gate met:** `SavedAddressPicker.default`, `.textForm` and `MarketingConsentPanel.picker.render` 44/44 green with **no test edits**, before the seed existed.
- ✅ 5. Picker: `initialBook` seed, the isomorphic layout-effect derivation and the skip condition (A-3, with SA-CA-3 / SA-CA-4), plus `SavedAddressPicker.initialBook.test.tsx` (T-P1..T-P10).
- ✅ 6. `marketingDrawerReads.ts` (A-1, SA-CA-1 / SA-CA-6) plus `marketingDrawerReads.test.ts`.
- ✅ 7. Panel: `load(options)`, the mount effect, book state, placeholder and `takePrefetched` (A-2). Planned edits per SA-CA-7: `MarketingConsentDrawer.render` gets only the `addressBookRead` mock; `owner` **not** edited; `pickerCall` guard made indentation-independent with G-5 / G-6 (SA-CA-5). Added `MarketingConsentPanel.parallel.render.test.tsx`.
- ✅ 8. Drawer pass-through.
- ✅ 9. `useDrawerPrefetch.ts` and its unit test (A-4, SA-CA-8).
- ✅ 10. Page wiring (A-5), `consentPrefetch.guard.test.ts`, the `accountCard.guard` comment, and `MarketingConsentDrawer.prefetch.render.test.tsx`.
- ✅ 11. Must-stay-green set, `npm run test:bos-entitlements`, `npm run typecheck:bos-llm` (0 new), `npm run lint:hooks`, `npx tsc --noEmit` filtered to the touched files (0 errors). Results in Implementation Notes.
- ✅ 12. Mutation run (§8 plus SA-CA-14). Results in Implementation Notes.
- ⏭ 13. **Left for QA/TL:** the **after** measurement (§9). The protocol and the empty results table are in the QA section.
- ✅ 14. Requirement §0.6.1 progress line and Change History row. Hand to TL for SA code review and QA.

---

## Tests

All new tests are **independent of timing**. They use deferred promises routed by URL and assert **which requests exist and in what order they were started**, never how long anything took. Fake time is used only to move `Date.now()` for the max-age rule.

### Hook — `useDrawerPrefetch.test.tsx`

| # | Test |
|---|---|
| T-H1 | `warm()` calls `start` once; a second `warm()` while the set is held calls nothing (no double fetch on repeated hover) |
| T-H2 | `take()` returns the held value, then `null` (used once) |
| T-H3 | `take()` with nothing warmed returns `null`; `start` is never called by `take` |
| T-H4 | Older than `maxAgeMs` (system time moved +60 001 ms): `take()` → `null`, and the next `warm()` starts again. At exactly `maxAgeMs` it is still usable (boundary) |
| T-H5 | The key changes (language or user): the held set is dropped; `take()` → `null` |
| T-H6 | `enabled: false`: `warm()` is a no-op; turning `enabled` false drops a held set |
| T-H7 | `key: null`: never starts |
| T-H8 | Idle: with `requestIdleCallback` stubbed, `warm` runs once after `enabled` turns true. With it absent, the `setTimeout` fallback runs. Unmounting before idle cancels it, and `start` is never called |
| T-H9 | `warm` and `take` keep the same identity across re-renders |

### Picker — `SavedAddressPicker.initialBook.test.tsx` (real component)

| # | Test |
|---|---|
| T-P1 | With `initialBook` for the same locale: **no** addresses request on mount, and the list is in the **first** render (asserted synchronously after `render`, with no `waitFor`) |
| T-P2 | Text form (`matchCurrent`), with a default entry in the seed and no match: `onSelect` is never called and `onSelectedChange` is never called (F-18) |
| T-P3 | Text form with a match: `onSelectedChange(id, 'derived')` exactly once per derivation, and `onSelect` never |
| T-P4 | Parity: the same book seeded and fetched produces identical `onSelect` / `onSelectedChange` calls, for the text form **and** the structured form (an empty `current` takes the default in both) |
| T-P5 | A delete refetches once (`localVersion`), with or without a seed |
| T-P6 | A `refreshKey` change refetches; a `locale` change refetches |
| T-P7 | A seed whose locale does not match the prop is ignored: one fetch, as today |
| T-P8 | Wrapped in `<React.StrictMode>` with a seed: zero fetches |
| T-P9 | An empty seed renders nothing (same as an empty fetched book) |

### Panel — `MarketingConsentPanel.parallel.render.test.tsx` (real picker, fetch routed by URL, deferred replies)

| # | Test |
|---|---|
| T-M1 | **Parallel:** after mount, with neither reply resolved, both the consent GET and the addresses GET have already been requested (the order of `fetch` calls is asserted; no timers) |
| T-M2 | Consent resolves, book still pending: the form is rendered, the placeholder is present and no picker exists. Then the book resolves: the placeholder is gone and the list is shown |
| T-M3 | Exactly one consent GET and one addresses GET per open, including under `<React.StrictMode>` |
| T-M4 | A preloaded consent read with `ok: false` → exactly **one** fresh consent GET → form shown. No F-17 screen, no extra book GET |
| T-M5 | A preloaded failure followed by a fresh failure → F-17 screen, no Save button; the drawer closes at once (clean) |
| T-M6 | **Order permutations:** the book resolves **before** consent, and the book resolves **after** consent. In both, a stored postal line equal to entry Z marks Z, writes nothing, and leaves the drawer clean |
| T-M7 | User decision 2026-10-15 with a preloaded book: default entry Y present, stored postal empty → the textarea is empty, "Enter a different address" is checked, nothing is marked, and the drawer is clean |
| T-M8 | A preloaded untouched open is clean: the X closes with no prompt. Then an edit makes it dirty and the X prompts (S-3) |
| T-M9 | Save → the reload is a **fresh** consent GET (the preloaded promise is not reused); text typed during the save is kept |
| T-M10 | Try again after F-17 → a fresh GET; the preloaded promise is not reused |
| T-M11 | A book failure → no picker and no placeholder; the form and the postal textarea still work |
| T-M12 | A preloaded set for another language (`pre.locale !== language`) is ignored: fresh reads |

### Drawer and hook together — `MarketingConsentDrawer.prefetch.render.test.tsx`

A small harness renders `useDrawerPrefetch` together with `MarketingConsentDrawer`.

| # | Test |
|---|---|
| T-D1 | `warm()`, let it resolve, then open → **zero** new requests and the warmed wording shows (reused on open) |
| T-D2 | `warm()` still in flight, then open → zero new requests; the form appears when the in-flight read resolves |
| T-D3 | Open, close, then reopen with no new warm → one fresh pair of reads (used once) |
| T-D4 | Warm, move system time +61 s, then open → one fresh pair; the old set is unused |

### Page source guard — `consentPrefetch.guard.test.ts` (comment-stripped source, with negative controls)

| # | Test |
|---|---|
| T-G1 | `useDrawerPrefetch(` is called with `startMarketingDrawerReads`, a key containing `user.id` and `language`, and `enabled` containing `!loading` and `!isConfigurationOpen` |
| T-G2 | The consent row carries `onPointerEnter`, `onFocus` and `onPointerDown` = `consentPrefetch.warm`, and still `onClick={() => setConsentDrawerOpen(true)}` |
| T-G3 | `<MarketingConsentDrawer` receives `takePrefetched={consentPrefetch.take}` |
| T-G4 | The `loadData` body names neither `consentPrefetch` nor `startMarketingDrawerReads` (SA condition C-8: own effect, not `loadData`) |
| T-G5 | `page.tsx` imports neither `readConsentSettings` nor `readAddressBook` directly (only the starter) |

### Must stay green (SA condition C-12 plus this slice)

`SettingsDrawer.render`, `SettingsDrawer.discard.render`, `SettingsDrawer.layers`, `MarketingConsentDrawer.render`*, `MarketingConsentDrawer.owner`*, `MarketingConsentPanel.picker.render` (real picker, **unedited**), `MarketingConsentPanel.pickerCall.guard`*, `SavedAddressPicker.default`, `SavedAddressPicker.textForm`, `InvoiceSettingsSection.render`, `PlanSection.render`, `InviteFriendsSection.render`, `InviteFriendsSection.linkSafety`, `journeyReadiness`, `planBadge`, `invite-accepted`, `greetingUsesTheEditedName.guard`, `darkModeTokens.guard`, `settingsDeepLinks.guard`, `accountCard.guard`*, `accountProfile.guard`, `timezoneWrite.guard`, `noBrowserDb.guard`, `useLinkOpenedDrawer`. Files marked * carry the planned edits listed in Files. If `MarketingConsentPanel.picker.render` has an assertion that encodes the old waterfall (a call count or order), it is reported to SA before any edit, not changed silently.

---

## Mutation candidates

| # | Mutation | Killed by |
|---|---|---|
| MU-1 | `take()` does not clear the held set | T-H2, T-D3 |
| MU-2 | The max-age check is removed, or `<=` becomes `<` / `>=` | T-H4, T-D4 |
| MU-3 | The key comparison is removed from `take()` | T-H5, T-M12 |
| MU-4 | `warm()` ignores `enabled` | T-H6 |
| MU-5 | `warm()` always calls `start` | T-H1 |
| MU-6 | Idle cleanup does not cancel | T-H8 |
| MU-7 | The panel awaits consent before starting the book (back to the waterfall) | T-M1 |
| MU-8 | A preloaded failed consent read is used as-is (no fresh read) | T-M4 |
| MU-9 | `retry()` or the save reload passes the preloaded promise | T-M9, T-M10 |
| MU-10 | The placeholder is removed (picker rendered with `initialBook` undefined while pending) | T-M2 |
| MU-11 | The seeded derivation in the text form calls `onSelect(fallback)` | T-P2, T-M7 |
| MU-12 | The picker ignores `initialBook` and always fetches | T-P1, T-D1 |
| MU-13 | The skip condition ignores `localVersion` (a delete does not refetch) | T-P5 |
| MU-14 | The seed locale check is removed | T-P7 |
| MU-15 | The `started` ref guard is removed | T-M3 |
| MU-16 | The page drops `!isConfigurationOpen` from `enabled` | T-G1 |
| MU-17 | `onFocus` is removed from the row | T-G2 |
| MU-18 | `readAddressBook` rethrows on a network error | `addressBookRead.test` (never rejects) |

---

## Manual QA and measurement

**Account:** a test business with **two or more** saved addresses, a stored marketing postal line equal to one of them, and a second business with none. English and Hebrew, desktop and phone (SA condition C-10).

| # | Check |
|---|---|
| M-1 | Open Marketing permission untouched and close it: no "Discard your changes?" prompt; the stored postal line is unchanged and its entry is marked (F-18) |
| M-2 | A business with addresses but an empty marketing postal line: the field stays empty and "Enter a different address" is selected (user decision 2026-10-15) |
| M-3 | A business with no saved addresses: the placeholder appears only briefly (if at all) and no picker is shown |
| M-4 | Open Configuration → Business, add an address, close the dialog, open Marketing permission: the new address is listed |
| M-5 | Switch the language, then open: wording and address labels are in the new language |
| M-6 | Delete an address from the picker inside the drawer: the list refreshes |
| M-7 | DevTools Network: after the page loads and goes idle, **one** consent GET and **one** addresses GET; hovering the row adds none; opening adds none; closing and reopening after more than 60 s with no hover reads fresh |
| M-8 | Phone, touch: open with a tap; no visual jump of the postal box |
| M-9 | SA condition C-10 layering checklist: the `Select` popover sits above the sheet; the picker and its delete confirmation sit correctly inside the sliding sheet; focus returns to the row; `aria-haspopup="dialog"` is on the row |
| M-10 | Save, close, reopen: the saved wording shows (a fresh read after the close) |

**Measurement (production build, not `next dev`).** `next dev` compiles routes on demand and StrictMode doubles effects, so its numbers say nothing about this change.

- **M-0 before:** on an `origin/main` checkout of this worktree, run `npm run build && npm run start` (port 3000) and sign in as the test account.
- **After:** the same on the C-a branch, on the same machine, the same network, the same account, and the same browser profile with an empty cache at the start.
- **Measured from Chrome DevTools Performance**, with screenshots on and timings read from the trace:
  - **T-form:** from the click to the first frame with the consent form.
  - **T-list:** from the click to the first frame with the address list.
  - **Jump:** whether the postal textarea moves after first paint (yes/no).
- **Two scenarios, five runs each; record the median and the range:**
  - (a) **Warm:** page loaded and idle for 5 s or more, then click.
  - (b) **Immediate:** reload, then click as soon as the row is visible (before idle; the press warm only).
- From the Network panel, also record whether the addresses request starts **before** the consent response ends. Before: no (waterfall). After: yes.
- Results go into the QA Testing Report as a table (scenario × T-form / T-list / jump, before and after).
- **Caveat:** local `next start` has no serverless cold start and does not cross the Israel → US-East edge the way Vercel does. Repeating scenario (a) on the PR's **Vercel preview** gives the number closest to what the user saw (Q-11).
- Measurement runs **only open and close**. No Save, so nothing is written.

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Two extra GETs (six database reads) on every settings visit, even when Marketing is never opened | Read-only routes; only after `loadData` and at idle; at most once per 60 s while unused. SA decides between idle and interaction-only (Q-2) |
| R-2 | Data up to 60 s old when another tab or device changed it | Bounded age; used once; same as a drawer left open today; Save semantics unchanged |
| R-3 | F-18 regression in the shared picker (live bug class) | One derivation function for both paths; the real-picker tests T-P2..T-P4 and T-M6/T-M7; the existing real-picker suite runs unedited; the `pickerCall` guard is extended |
| R-4 | One account's read reused for another | State lives in the page component's ref (dropped on unmount); the key includes the user id |
| R-5 | An unhandled rejection from a speculative read | The read modules never reject (tested) |
| R-6 | `useLayoutEffect` warning in a server render | The local `useIsomorphicLayoutEffect` const, as in `theme-provider.tsx` |
| R-7 | The placeholder height differs from the real list (2+ entries, or none) | A small jump remains in those cases only; with C-5 the book is usually in before the form |
| R-8 | Churn in tests that queue `fetch` replies by call order | Mock the read module in those two files (Q-7); the real-picker suite keeps real reads |
| R-9 | The hook becomes a template other drawers copy without thought | Its header comment states the five rules; C-b is the only planned second user, and SA reviews it there |

---

## Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | Rule 7: approve `useDrawerPrefetch` (a page-owned ref, used once, max age, account and language key, `enabled`, idle) as the Phase C prefetch mechanism, given the alternatives in A-4? | Approve; C-b reuses it |
| Q-2 | Warm on idle on every settings visit (cost R-1), or only on hover, focus and press? | Idle plus interactions. Interaction-only leaves phone and keyboard users with almost no saving |
| Q-3 | Maximum age of a warmed set: 60 s? | 60 s |
| Q-4 | `onFocus` as a trigger includes the programmatic focus return when the drawer closes, which is one warm per close. Acceptable? | Yes: it is a fresh read for the likely reopen, and a no-op while a set is held |
| Q-5 | When the book read fails (prefetched and fresh), show no picker (today's visible result) or mount the picker without `initialBook` so it tries once more itself? | No picker |
| Q-6 | Seeded derivation in an isomorphic layout effect, so the "Enter a different address" radio never flashes. OK? | Yes |
| Q-7 | Planned test edits: mock `@/components/ui/addressBookRead` in `MarketingConsentDrawer.render` and `owner`, which keeps their call-ordered `fetch` queues. The real-picker suite stays unmocked. OK? | Yes |
| Q-8 | `initialBook` is a generic optional prop on the shared picker, passed only by Marketing for now. The profile and invoice callers are untouched. OK? | Yes |
| Q-9 | C-c's `handleLogout` comment fix: move it into C-b, or allow C-c to touch `page.tsx` alongside C-a? (§0.6.1) | Move it into C-b |
| Q-10 | C-1 folded into C-2, because the header badge names champions only (§0.6.1 P-2). Confirm, or does the user need to be asked? | Fold; mention to the user as information |
| Q-11 | Measurement environment: local `next start` uses the database in `.env.local`. Confirm a read-only run on the test account is acceptable, or require the Vercel preview only | Both: local before and after, plus preview scenario (a) |
| Q-12 | SA condition C-8: confirm A-6 satisfies it (a page-load request in its own effect, through existing routes, reused by the drawer, route literals still absent from `page.tsx`) | Satisfies it |

---

## Implementation Notes

**Dev, 2026-10-16.** Built on `origin/main` `09e2d3ad` (merged in, fast-forward). Not committed.

### How each SA condition was applied

| Condition | Where | Pinned by |
|---|---|---|
| SA-CA-1 log parity | `ConsentRead` = `{ ok, status, body } \| { ok: false, kind: 'refused', status } \| { ok: false, kind: 'threw', err }` (non-JSON body = `threw`). The panel's `judgeConsent` turns it into a verdict; the answer acted on logs `warn({ status })` / `error({ err })` exactly as before. A discarded prefetched failure logs `debug` with `{ status }` or `{ err }` only. `readAddressBook` is silent | D-12 **unedited** (green); T-M4 (debug only, one key), T-M5 (one `warn` `{ status: 500 }`; one `error` `['err']`); MU-21a/b |
| SA-CA-2 any unusable preload reads again | `load({ preloaded })` judges the preload with the same `judgeConsent` as a fresh read (status, throw, `success !== true`, `!isPayload`, `seeded` throwing). Unusable → one fresh `readConsentSettings`; only that answer reaches F-17 | T-M4 `it.each` over refusal / throw / `success:false` / malformed; T-M5; MU-8, MU-22 |
| SA-CA-3 seed once, mount only | `seedStands` ref: true only while the fetch effect sees the mount's `(locale, refreshKey, localVersion = 0)`; the first other run turns it off for good | T-P10 (he → en → he = 2 fetches, labels follow); MU-19 |
| SA-CA-4 seeded derivation once per mount | `seedDerived` ref guard inside the local `useIsomorphicLayoutEffect` | T-P8 extended (StrictMode, text and structured form; same counts as the fetched path under StrictMode); MU-20 |
| SA-CA-5 exactly one picker | One `<SavedAddressPicker` (ready branch) with `matchCurrent`; `pickerCall()` now finds the element's own `/>` by brace depth, with negative controls | G-5, G-6, pickerCall negative controls |
| SA-CA-6 request parity | `readConsentSettings`: URL only, no `init`. `readAddressBook`: URL + `{ cache: 'no-store' }` | `marketingDrawerReads.test.ts` (new), `addressBookRead.test.ts`, T-M1 |
| SA-CA-7 test edits | `MarketingConsentDrawer.render`: only the `addressBookRead` mock (resolves `{ ok: true, locale, addresses: [] }`). `owner`: **not edited**. `MarketingConsentPanel.picker.render`: **not edited** | — |
| SA-CA-8 hook header, no module state | Header states the five rules and "Approved for settings-page drawers; another surface needs SA review." State is two `useRef`s; module level has only constants, types and a pure `usable()` helper | `consentPrefetch.guard` (scope text, no top-level `let`/`var`/object/array/`new`) |
| SA-CA-9 take once | `takePrefetched` called inside the `started` guard | T-M3 (StrictMode, with and without handed-over reads: one call); MU-15 |
| SA-CA-10 imports | No entitlements, browser Supabase, repository or `console.*` in any new or edited file; the page imports only `useDrawerPrefetch`, `DRAWER_PREFETCH_MAX_AGE_MS`, `startMarketingDrawerReads` | T-G5, `consentPrefetch.guard` module-limits block |
| SA-CA-13 placeholder | Inside the same `mb-2` wrapper; `aria-hidden`, no text, `h-[8.5rem]`, V2 border / radius / surface tokens, `motion-safe:animate-pulse` | T-M2 (attributes, class, wrapper); T-M11 (textarea accepts input when the book fails) |
| SA-CA-14 mutations | All 22 (26 with variants) killed | Table below |
| SA-CA-15 order | `deriveSelection` extracted and the fetch moved to `readAddressBook` first; `SavedAddressPicker.default`, `.textForm`, `MarketingConsentPanel.picker.render` 44/44 green **with no test edits**, before any seed code | — |
| Q-6 | Local `const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect` in the picker; nothing imported from or exported to `theme-provider.tsx` | `themePrepaint.guard` green |

### Verification

| Check | Result |
|---|---|
| New tests | `addressBookRead` 8, `SavedAddressPicker.initialBook` 19, `marketingDrawerReads` 7, `MarketingConsentPanel.parallel.render` 21, `useDrawerPrefetch` 20, `MarketingConsentDrawer.prefetch.render` 5, `consentPrefetch.guard` 16 (incl. negative controls), `pickerCall.guard` 8 (was 4: + 2 negative controls, G-5, G-6) — all green |
| Must-stay-green set | `npx jest components/business-os/settings components/ui/__tests__ app/business-os/settings greetingUsesTheEditedName.guard journeyReadiness planBadge invite-accepted pluginConnectionsBrowserAccess.guard`: **48 suites, 772 tests, all green** (covers SA condition C-12's set, every settings guard, the F-18 suites `MarketingConsentPanel.picker.render` / `pickerCall.guard` / `SavedAddressPicker.textForm`, and the S-3 suites `MarketingConsentDrawer.*` / `SettingsDrawer.*`). `themePrepaint.guard` green |
| `npm run test:bos-entitlements` | 280 suites, 8 409 tests, green (no entitlements import anywhere in C-a) |
| `npm run typecheck:bos-llm` | 547 files, 28 errors, **0 new** (one baseline entry reported fixed, unrelated: `app/api/onboarding/build/route.ts`) |
| `npx tsc --noEmit` (`NODE_OPTIONS=--max-old-space-size=12288`) | 1 852 errors repo-wide, **0 in any touched or new file** |
| ESLint on the touched files | 0 errors. 1 warning, pre-existing: `page.tsx` `useEffect` missing `loadData` (frozen code) |
| `npm run lint:hooks` | clean |
| `console.*` in touched files | 0 |

### Mutations (own scratchpad folder; each restored in `try/finally` and SHA-1 verified; `git status` identical before and after)

| # | Mutation | Result | Killed by |
|---|---|---|---|
| MU-1 | `take()` does not clear | ✅ killed | T-H2, T-D3 |
| MU-2a/b/c | max age `<`, `>=`, removed | ✅ killed (3/3) | T-H4, T-D4 |
| MU-3 | key comparison removed from `take()` | ✅ killed | T-H5 (child effect in the same commit, before the drop effect) |
| MU-4 | `warm()` ignores `enabled` | ✅ killed | T-H6 |
| MU-5 | `warm()` always starts | ✅ killed | T-H1 |
| MU-6 | idle cleanup does not cancel | ✅ killed | T-H8 |
| MU-7 | book started after consent (waterfall) | ✅ killed | T-M1 |
| MU-8 | failed preload used as-is | ✅ killed | T-M4, T-M8 |
| MU-9a/b | Try again / save reload pass the preload | ✅ killed (2/2) | T-M10 (debug count), T-M9 |
| MU-10 | no placeholder; picker without `initialBook` while pending | ✅ killed | T-M2, T-M6 |
| MU-11 | seeded text form calls `onSelect(fallback)` | ✅ killed | T-P2, T-P4, T-M7 |
| MU-12 | `initialBook` ignored | ✅ killed | T-P1, T-D1 |
| MU-13 | skip ignores `localVersion` | ✅ killed | T-P5 |
| MU-14 | seed locale check removed | ✅ killed | T-P7 |
| MU-15 | `started` guard removed | ✅ killed | T-M3 |
| MU-16 | `!isConfigurationOpen` dropped | ✅ killed | T-G1 |
| MU-17 | `onFocus` removed | ✅ killed | T-G2 |
| MU-18 | `readAddressBook` rethrows | ✅ killed | `addressBookRead.test` |
| MU-19 | seed stays on after a locale change | ✅ killed | T-P10 |
| MU-20 | StrictMode derivation guard removed | ✅ killed | T-P8 |
| MU-21a/b | `threw` logged as `warn` / loses `err` | ✅ killed (2/2) | D-12 (unedited), T-M5 |
| MU-22 | preloaded `success:false` shown without a fresh read | ✅ killed | T-M4 |

**26 / 26 killed.** No mutation was killed by a type error (the runner flags `TS####` diagnostics as invalid; none were).

### Deviations and additions (for SA)

1. **Added `marketingDrawerReads.test.ts`** (not in the file table): SA-CA-6 asks for a test pinning the consent request.
2. **Two tests added beyond the plan to make two mutations killable.** T-H5 now includes a child-effect case: a drawer that mounts in the same commit as a key change calls `take()` before the page's drop effect runs, so `take()`'s own key check is load-bearing (MU-3 survived without it). T-M10 also asserts one `debug` log, because a retry that reused an unusable preload would read fresh anyway, so the request count alone could not tell (MU-9a).
3. **Two `eslint-disable-next-line react-hooks/exhaustive-deps`**, each with a reason: the picker's fetch effect (it now calls `deriveSelection`, which reads refs; the deps stay `[locale, refreshKey, localVersion]` as before) and the panel's mount-only effect (`takePrefetched` is consumed once).
4. **The fallback book read after a failed prefetched book starts when that promise settles**, not at the same moment as consent. Only on that failure path; the normal path starts both before either is awaited (T-M1).
5. **The picker renders for an empty ready book** (and returns `null` itself), so the placeholder collapses for a business with no saved address (R-7). This also keeps the drawer tests' stub picker reachable with the empty-book mock.
6. **`addressBookRead.ts` imports `KnownAddress` type-only** from the picker, which imports `readAddressBook`: a type-only cycle, erased at compile time.
7. **Placeholder height `8.5rem`** was set from the picker's classes (padding, title, one row, the "different address" row), **not** against a rendered browser picker. M-8 / the jump check should confirm it.
8. **No measurement** (tasks 2 and 13) per TL; SA-CA-12's structural criteria are covered by T-M1 (book before consent ends), T-D1 / T-D2 (zero requests on open after a warm) and T-M2 (placeholder holds the place).

### Questions for SA

- **QS-1** Placeholder height: keep `8.5rem` (about one saved entry), or set it from a measurement in QA?
- **QS-2** Deviation 4: acceptable that a failed prefetched book's retry starts only once that promise settles, or should the panel start a fresh book read in parallel whenever a prefetched set is used?

## SA Review Notes

The workplan review is the next section.

## SA Workplan Review (2026-10-16)

**Reviewed by SA, 2026-10-16**, on `feature/settings-drawer-phase-c` at `447d17a2`, against the code. Nothing was run against production.
**Status:** ✅ **Approved with conditions.** Dev may start. The conditions SA-CA-1..SA-CA-15 are part of the plan, and SA code review checks each one.

### What was checked against the code

| Claim in the workplan | Verified |
|---|---|
| The form renders as soon as consent returns; the picker mounts inside it and fetches only then (P-1, waterfall) | ✅ `MarketingConsentPanel.tsx` `load()` → `setLoading(false)`; the picker sits in the form branch; `SavedAddressPicker.tsx` fetches in an effect on `[locale, refreshKey, localVersion]` and renders `null` until `loaded` |
| F-18 text mode: marks, never fills; profile and invoice keep the structured path | ✅ The `matchCurrentRef` branch calls only `onSelectedChange(match.id, 'derived')`; `onSelect` only in the structured empty-form fallback |
| The picker always mounts after `form` is seeded | ✅ `setForm` / `setBaseline` / `setLoading(false)` are batched in one tick after the awaited JSON, and the picker exists only in the form branch. With the book state gating it as well, `matchCurrent` always sees the seeded text, in either order of arrival |
| Radix unmounts the panel on close; focus returns to the row | ✅ `MarketingConsentDrawer` header comment; `SettingsDrawer` `onCloseAutoFocus` focuses `returnFocusRef`, so Q-4's focus-return warm is real |
| `isConfigurationOpen` exists and covers the close animation | ✅ `ConfigurationDialogProvider`: `isOpen || closingGrace` (350 ms) |
| `loading` starts true and `loadData` runs on `user?.id` | ✅ `page.tsx` |
| The three GETs are read-only (P-3) | ✅ consent: `getUser` and 4 parallel repository reads; addresses: `getUser` and 2 reads; my-plan: snapshot (an in-memory LRU only), `findLocale`, `readPlanPurchaseView`. No insert, audit or Stripe call |
| `readPlanBadge` labels champions only, and the layout cannot hand it to the page (P-2) | ✅ `planBadgeFor` returns `null` unless `basis.kind === 'cohort'` and `state === 'champion'`; `app/business-os/layout.tsx` passes it to the header only |
| `accountCard.guard` forbids the two route literals in `page.tsx` (P-4) | ✅ Unchanged by this plan |
| `pickerCall()` slices to a fixed indentation | ✅ `'\n          />'`; it breaks when the call moves into a branch, as planned |
| `MarketingConsentDrawer.render` queues `fetch` replies by call order and mocks the picker | ✅ So the panel's own book read would consume a queued consent reply. Q-7's mock is the right fix |
| `MarketingConsentDrawer.owner` reaches the panel's fetch | ❌ It mocks `MarketingConsentPanel` outright (line 31). **No edit is needed there** (SA-CA-7) |
| D-12 pins the failure logs: thrown request and non-JSON body → `error` with `{ err }`; refusals → `warn` with `{ status }` | ✅ `MarketingConsentDrawer.render.test.tsx:540-563`. A read module that never rejects and returns only a status would lose `err` and break D-12 (SA-CA-1) |
| Local `useIsomorphicLayoutEffect` const precedent | ✅ `theme-provider.tsx:20`. `themePrepaint.guard` counts uses in that file only, so a local copy in the picker does not disturb it |
| `console.*` in the touched files | ✅ 0 in all four |

### Rulings on Q-1..Q-12

| # | Ruling |
|---|---|
| **Q-1 (rule 7)** | **Approved:** `useDrawerPrefetch` as specified, with a ref owned by the page, used once, 60 s age, a user-and-language key, `enabled`, and idle plus interaction warming. The alternatives are correctly rejected. A provider contradicts SA condition C-1's "no context, no provider" family rule. A module cache, or `request-deduplication.ts`, outlives the page and so crosses a sign-out in the same tab (and the util logs through `console.*`). SWR adds a data layer for two reads. **No CLAUDE.md or skill change.** CLAUDE.md holds project-wide rules, and this is a pattern scoped to one page with two planned users. Its rules live in the hook's header and in this review (SA-CA-8). If a third surface wants it, that slice brings it to SA, and SA decides then whether it becomes a documented pattern. |
| **Q-2** | **Approved: warm on idle on every visit.** That is two read-only GETs (6 indexed reads plus 2 `getUser`) per settings visit, after `loadData`, at most once per 60 s while unused. The cost is negligible, and it also warms the two functions, which is most of the cold-start saving. Interaction-only would give phone and keyboard users almost nothing. |
| **Q-3** | **Approved: 60 s**, measured from the start of the request. |
| **Q-4** | **Approved.** The focus return warms one fresh pair after each close. That pair is started after any save has finished, because the drawer refuses to close mid-save (SA condition C-4), so it is the right data for a reopen. Residual: an address deleted in the picker and the drawer closed before the DELETE returns can race the warm read and show the deleted entry on a reopen within 60 s. Accepted as R-10, bounded by rule 2. No code. |
| **Q-5** | **Approved: no picker** when the book read fails (prefetched, then one fresh). That is today's visible result; the textarea is the whole form without it. |
| **Q-6** | **Approved**, with a local `useIsomorphicLayoutEffect` const in the picker; do not import or export it from `theme-provider.tsx`. The seeded derivation must run exactly once per mount (SA-CA-4). |
| **Q-7** | **Approved** for `MarketingConsentDrawer.render` only (SA-CA-7). The real-picker suite stays unmocked and unedited. |
| **Q-8** | **Approved.** `initialBook` is a generic optional prop; the profile and invoice callers are untouched. The seed rules in SA-CA-3 and SA-CA-4 make "exactly as without it" true. |
| **Q-9** | See §0.6.1 rulings: **not moved into C-b.** The comment stays with C-c. |
| **Q-10** | **SA call, not a user decision.** C-1 folds into C-2 (see §0.6.1). Tell the user as information. |
| **Q-11** | **Approved: both.** Local `next start` against the database in `.env.local` is the same access the app's own routes give the signed-in test account. It is the normal local-development setup here. Constraints are in SA-CA-11. The preview run is best-effort. |
| **Q-12** | **Yes, A-6 satisfies SA condition C-8.** C-8 was written for row values, and its rule carries over unchanged: the request is listed, it runs in its own effect through an existing route, never in `loadData` and never through the browser Supabase client, and the drawer reuses it. T-G4 and T-G5 pin it, and the route literals stay out of `page.tsx`. |

### The correctness table and the stale-data rules

The F-18, user empty-postal decision, S-3 baseline, F-17, keep-typed-text and one-load-at-a-time rows hold as written, with the three gaps closed by SA-CA-2, SA-CA-3 and SA-CA-4. Stale-data rules 1–8 are accepted. Rule 6 ("a failed warm read is never shown") was true only for HTTP and network failures: a preloaded 200 with `success: false` or a malformed payload would have gone straight to the F-17 screen. SA-CA-2 closes that. One-copy-of-each-request is approved, with request parity pinned (SA-CA-6). The test plan (42 tests, independent of timing) and the 18 mutations are approved, with the additions below.

### Conditions

1. **SA-CA-1 Logging parity; D-12 stays green unedited.** A consent read failure carries its kind: `{ ok: false, kind: 'refused', status }` or `{ ok: false, kind: 'threw', err }`. A body that is not JSON counts as `threw`. The panel logs exactly as today: `warn({ status }, 'Consent settings load refused')` and `error({ err }, 'Could not load consent settings')`, for the read whose answer it acts on. A discarded **prefetched** failure is logged at most at `debug`, with `{ status }` or `{ err }` only and no payload. `readAddressBook` may stay silent, as the picker is today.
2. **SA-CA-2 Any unusable preloaded consent result reads once more, fresh.** That covers a non-OK status, a throw, `success !== true` and `!isPayload`, not only `ok: false`. Only the fresh answer reaches the F-17 decision. T-M4 becomes an `it.each` over the four kinds; T-M5 asserts the log count.
3. **SA-CA-3 The seed is used once, on the mount render only.** The workplan's skip condition (`localVersion === 0`, `refreshKey` and `locale` equal to their mount values) skips the fetch again after a he → en → he switch, and the picker would then show the English labels under Hebrew. Hold a ref that turns off the seed the first time the effect runs with any other `(locale, refreshKey, localVersion)`; after that, every run fetches. This stays deterministic under StrictMode. Add **T-P10**: with a seed for `he`, rerender with `en` and then `he` → 2 fetches, and the labels follow.
4. **SA-CA-4 The seeded derivation runs exactly once per mount, including under StrictMode.** Guard it with a ref. This keeps parity with the fetched path, whose cancelled first run derives nothing. Extend T-P8 to assert the `onSelectedChange` and `onSelect` call counts under StrictMode, for the text form and the structured form.
5. **SA-CA-5 Exactly one picker in the panel.** Rewrite `pickerCall()` to find the element's own closing `/>` independently of indentation, with a negative control. Add **G-5** `initialBook={`, and **G-6**: `<SavedAddressPicker` occurs exactly once in the panel and still carries `matchCurrent`. This stops a second, fallback picker without `matchCurrent` from appearing in a branch, which would bring F-18 back.
6. **SA-CA-6 Request parity.** `readConsentSettings` sends exactly today's request: the same URL, with no new `init`, so no `cache` option is added. `readAddressBook` sends today's URL with `{ cache: 'no-store' }`. `addressBookRead.test` pins its request, and a `marketingDrawerReads` test pins the consent one. Both modules never reject (MU-18 stays).
7. **SA-CA-7 Planned test edits, corrected.** `MarketingConsentDrawer.owner.test.tsx` is **not** edited; it mocks the panel. In `MarketingConsentDrawer.render.test.tsx`, add only the `addressBookRead` mock, resolving `{ ok: true, locale, addresses: [] }`. Any further assertion change there, or in `MarketingConsentPanel.picker.render`, goes to SA before it is made.
8. **SA-CA-8 The hook's scope is written in its header.** The header states the five rules (used once, maximum age, key, `enabled`, idle) and says: "approved for settings-page drawers; another surface needs SA review". No module-level state, no export of a store, no CLAUDE.md change.
9. **SA-CA-9 `takePrefetched` is called once per panel mount,** inside the `started` guard. T-M3 asserts one call under StrictMode as well.
10. **SA-CA-10 Imports.** No new or edited file imports from `lib/business-os/entitlements/` (type-only included), the browser Supabase client or a repository, and none uses `console.*`. `page.tsx` imports only `useDrawerPrefetch`, `DRAWER_PREFETCH_MAX_AGE_MS` and `startMarketingDrawerReads` (T-G5).
11. **SA-CA-11 Measurement and manual QA on the live database (Q-11).** Use the designated test account only. Measurement runs open and close **only**: no Save, no delete, no address added. Manual QA's writes (M-4 add, M-6 delete, M-10 save) are made only on the test account, and the address book is put back as it was afterwards. Record in the QA report which database the local build used. The preview scenario (a) is best-effort; if sign-in on the preview is not possible, record that.
12. **SA-CA-12 The pass criteria are structural, and the numbers are recorded, not gated.** QA passes on: the addresses request starts before the consent response ends; opening after a warm makes zero requests (M-7); no jump of the postal box with one or more saved entries. The before and after timings are recorded for C-6/C-7, but no threshold blocks the slice.
13. **SA-CA-13 The placeholder.** It sits inside the same `mb-2` wrapper as the picker. It is `aria-hidden`, has no text, uses V2 tokens only, and pulses with `motion-safe:` so reduced-motion users get a static block. T-M11 also asserts that the textarea still accepts input when the book fails.
14. **SA-CA-14 Mutations added.** MU-19: the seed stays on after the locale has changed (T-P10). MU-20: the StrictMode derivation guard is removed (T-P8). MU-21: `threw` is logged as `warn`, or loses `err` (D-12). MU-22: a preloaded `success: false` is shown without a fresh read (T-M4). All 22 must be killed, and the results recorded.
15. **SA-CA-15 Order inside the slice.** Task 4, the `deriveSelection` extraction with no behaviour change, lands as its own green step: `SavedAddressPicker.default`, `.textForm` and `MarketingConsentPanel.picker.render` must pass before the seed exists. If any of them needed an edit at that step, stop and report it to SA.

### Optimisation suggestions (not blocking)

- `startMarketingDrawerReads` could take `language` from its caller only, as planned, so the hook's `start` closure and the key always agree. Keep `start: () => startMarketingDrawerReads(language)` in the same render as the `key`.
- R-7, the placeholder collapsing for a business with no saved address, is accepted. Do not add a second request to find out the count in advance.

### Approval

[x] Workplan approved, with conditions SA-CA-1..SA-CA-15. Proceed to implementation.

## SA Code Review (2026-10-16)

**Code Review by SA, 2026-10-16**, on `feature/settings-drawer-phase-c` (base `origin/main` `09e2d3ad`, uncommitted). Read in full: `addressBookRead.ts`, `marketingDrawerReads.ts`, `useDrawerPrefetch.ts`, all 7 new test files; diffs of `SavedAddressPicker.tsx`, `MarketingConsentPanel.tsx`, `MarketingConsentDrawer.tsx`, `page.tsx`, `accountCard.guard`, `MarketingConsentDrawer.render`, `pickerCall.guard`. Nothing was run against production.
**Status:** ✅ **APPROVED WITH CONDITIONS.** One condition (CR-CA-1), and it is already part of QA's gate. No code change is required before QA.

### Re-run by SA

| Check | Result |
|---|---|
| Must-stay-green set (Dev's command plus `themePrepaint`) | **49 suites, 809 tests, all green** (Dev's 48 / 772 plus `themePrepaint.guard`) |
| ESLint on the 7 touched source files, `--report-unused-disable-directives` | 0 errors; 1 pre-existing warning (`page.tsx` `loadData` dependency, frozen code). Both new `eslint-disable-next-line` directives suppress a real finding (neither is unused) |
| Files that must stay unedited | `git diff` empty for `SavedAddressPicker.default`, `SavedAddressPicker.textForm`, `MarketingConsentPanel.picker.render`, `MarketingConsentDrawer.owner` |
| `handleLogout` block | Untouched (no hunk in the `page.tsx` diff). C-c owns that comment (§0.6.1 R-3) |
| `console.*` in touched or new files | 0 |

### SA conditions, verified against the code

| Condition | Verdict | Evidence |
|---|---|---|
| SA-CA-1 log parity | ✅ | Every old path maps to the same level, message and context: non-OK and `success !== true` / `!isPayload` → `warn({ status }, 'Consent settings load refused')`; network error and non-JSON body (now caught in `readConsentSettings` as `threw`) → `error({ err }, 'Could not load consent settings')`; `seeded` throwing (old outer catch) → `judgeConsent` returns `{ err }` → the same `error`. A discarded preload logs `debug` with one key. D-12's assertions are unedited (only the `addressBookRead` mock was added to that file) and green |
| SA-CA-2 unusable preload → one fresh read | ✅ | `load({ preloaded })` judges the preload with the same `judgeConsent`; anything not `usable` falls through to exactly one `readConsentSettings`, and only that verdict reaches `failed()`. T-M4 `it.each` covers all four kinds and asserts no warn/error and one debug |
| SA-CA-3 seed off after the first non-matching run | ✅ | `seedStands` turns false on the first effect run whose `(locale, refreshKey, localVersion)` differs from the mount's, and never turns back. T-P10 (he → en → he = 2 fetches, labels follow) |
| SA-CA-4 / SA-CA-9 once per mount, StrictMode included | ✅ | Picker: `seedDerived` ref guards the layout-effect derivation; T-P8 asserts the same `onSelectedChange` / `onSelect` counts as the fetched path under StrictMode. Panel: `takePrefetched` and both reads sit inside the `started` guard; T-M3 asserts one `take` call and one request pair (or zero, with handed-over reads) under StrictMode |
| SA-CA-5 exactly one picker with `matchCurrent` | ✅ | One `<SavedAddressPicker` in the panel, in the ready branch, every prop unchanged plus `initialBook={book}`. `pickerCall()` now finds the element's own `/>` by brace depth, with two negative controls; G-5 and G-6 added. F-18 with preloaded data: T-P2, T-P3, T-M6 (both arrival orders and handed over), T-M7 |
| SA-CA-6 request parity | ✅ | `readConsentSettings`: URL only, no `init`. `readAddressBook`: URL plus `{ cache: 'no-store' }`. Pinned in `marketingDrawerReads.test`, `addressBookRead.test` and T-M1 |
| SA-CA-7 test-edit limits | ✅ | `MarketingConsentDrawer.render`: one `jest.mock` block, no assertion change. `owner` and the real-picker suite: no diff. `pickerCall.guard`: helper rewritten as planned (SA-CA-5); G-1..G-4 assertions unchanged |
| SA-CA-8 hook header, no module state | ✅ | Header states the scope sentence verbatim and the five rules. Module level holds two numeric constants, types and the pure `usable()` helper; state is two `useRef`s. Pinned by `consentPrefetch.guard` |
| SA-CA-10 imports | ✅ | No entitlements (type-only included), browser Supabase client or repository import in any new or edited file. `page.tsx` imports exactly `startMarketingDrawerReads`, `useDrawerPrefetch`, `DRAWER_PREFETCH_MAX_AGE_MS` (T-G5); neither route literal is in the page |
| SA-CA-13 placeholder | ✅ | Inside the same `mb-2` wrapper; `aria-hidden`, no text, `motion-safe:animate-pulse` only; V2 tokens `--v2-border`, `--v2-radius-card`, `--v2-surface` (all defined in `v2-theme-tokens.css`). T-M2, T-M11 |
| SA-CA-14 mutations | ✅ | 26 / 26 killed as recorded; the two test additions in deviation 2 are the right way to make MU-3 and MU-9a killable |
| SA-CA-15 extraction behaviour-neutral | ✅ | Read line by line. `readAddressBook` returns `ok: false` on exactly the old early returns (non-OK, `!success`, a throw in `fetch` or `json()`), and the fetched path still sets `loaded` in `finally` unless cancelled. `deriveSelection` is the old block moved verbatim, with `selectedRef.current !== null` as an early return. The three named suites are unedited and green |

### Stale-data rules

Rules 1–8 hold in the code. Used once: `take()` clears before judging. Age: `usable()` compares against `startedAt` with `<=`, the boundary pinned by T-H4. Key: checked inside `take()` itself as well as by the drop effect, so a drawer mounting in the same commit as a language switch cannot receive the old language (deviation 2, T-H5). `enabled = !loading && !isConfigurationOpen`, so the configuration dialog (where the book is edited) drops and blocks. A failed warm read is never shown: consent through SA-CA-2, the book through the one fresh fallback. Inside an open drawer every refresh is fresh, because the picker's seed turns off on the first non-mount run.

### Specific items the TL asked about

| Item | Ruling |
|---|---|
| The two `eslint-disable-next-line react-hooks/exhaustive-deps` | **Justified, both.** Panel: a mount-only effect whose one non-ref input (`takePrefetched`) must be consumed exactly once; adding it to the dependencies would re-take on every identity change. Picker: the dependencies stay `[locale, refreshKey, localVersion]` as before; `deriveSelection` is a per-render function and must not trigger a refetch. See CR-CA-2 for one comment wording point |
| Deviation 6, the type-only import cycle | **Accepted.** `addressBookRead.ts` → `SavedAddressPicker.tsx` is `import type`, erased at compile time, so there is no runtime cycle and no module-initialisation order risk. `KnownAddress` stays the picker's public type. Do not move it for this slice |
| Deviation 5, the picker renders for an empty ready book | **Accepted.** The picker returns `null` itself, which is today's result, and R-7 already accepts the collapse |
| Deviations 1, 2, 3, 7, 8 | Accepted as recorded |

### Rulings on QS-1 and QS-2

- **QS-1 (placeholder height): keep `8.5rem` for now, confirm it in QA (CR-CA-1).** SA's reading of the picker's classes (`p-3`, the `text-xs` title, `space-y-2`, one entry row at `py-2.5` with a `text-sm` label, an address line and possibly a "used by" line, then the "different address" row) suggests the rendered height with one entry is nearer 9.5–10.5 rem than 8.5 rem, so a small downward jump is plausible. That is a value, not a design question.
- **QS-2 (deviation 4, the failure-path sequencing): accepted as built.** Starting a fresh book read in parallel whenever a prefetched set is used would add a request to every warmed open, which is the case C-5 exists to make request-free (T-D1 / M-7). The sequential fallback costs one round trip only when the prefetched book failed, a rare path. The form is never blocked by it, and the placeholder holds the place meanwhile.

### Code Review Comments

1. **CR-CA-1 (condition, Medium)** `MarketingConsentPanel.tsx`, the placeholder `h-[8.5rem]`. QA measures the picker's rendered height with **exactly one** saved entry (DevTools, computed height of the element inside the `mb-2` wrapper), in English and Hebrew, desktop and phone, and records it in the QA report. If it differs from 8.5 rem by more than 0.5 rem, Dev changes that one class value to the measured height (rounded to 0.25 rem) before commit. That one-token change needs no further SA review; QA re-checks the jump. Clarifying SA-CA-12's "no jump with one or more saved entries": the gate is **one** entry; with two or more, a downward shift of one row's height is the residual already accepted under R-7.
2. **CR-CA-2 (Low, optional)** `SavedAddressPicker.tsx`, the comment above the fetch effect's `eslint-disable`. It says `deriveSelection` reads the caller's latest choice through refs. That is true for `selectedRef`, `matchCurrentRef` and `currentRef`, but `onSelect` and `onSelectedChange` are called from the closure of the render that started the effect, exactly as before the extraction (no behaviour change). If touched again, say so; not required for this slice.
3. **CR-CA-3 (Info)** `useDrawerPrefetch.ts` writes `latest.current = options` during render. Same pattern as the picker's `matchCurrentRef.current = matchCurrent`, safe here because the ref is read only in event handlers, effects and `take()`. Accepted.
4. **CR-CA-4 (Info)** The panel's mount effect does not cancel on unmount, so a late `setBook` can land on an unmounted panel. That is a no-op in React 18 and is the documented choice (a StrictMode cleanup must not drop the one read). Accepted.

### Optimisation Suggestions

- When C-b reuses `useDrawerPrefetch`, keep its read starter in its own `…DrawerReads.ts` module, as here, so `page.tsx` never names a route and the `accountCard.guard` rule keeps holding without edits.

### Code Approved for QA: Yes

Approved with CR-CA-1, which QA's no-jump check already covers. After QA passes, and CR-CA-1 is recorded (with the one-value change, if it is needed), RM may commit and open the PR with auto-merge, per the user's standing rule for this stream.

### SA re-check of QA bug fix (2026-10-16)

**Status:** ✅ Approved, no new conditions. CR-CA-1 still stands. Next step: the targeted re-QA (S-7 / T-D5 and the four prefetch suites).

**Rule 7 ruling on `paused`.** It is an acceptable extension of the hook approved under Q-1, and it stays inside that approval: one optional boolean prop (default `false`, so the shape is unchanged for any later caller), still props-only, and nothing held outside the page's `useRef`s. No provider, no context, no module state. The module-state guard is now an allow-list (column-0 `const` declarations may only be numeric constants, no `let`/`var`), and it covers the hook file. That closes QA-MU-1 for good. A later drawer (C-b) that reuses the hook should pass `paused: <its own open state>` too. This is not a condition here.

**Why the suggested fix was rejected: confirmed.** `SettingsDrawer` puts the panel inside a Radix portal, and the portal only mounts after the commit that set `open` to true. With `!consentDrawerOpen` added to `enabled`, rule 4 would drop the held set in that commit, before the panel could take it. Mutation B1-b2 shows this happening (5 tests lose the handover). The other option, a single flag that drops on re-enable, is also rightly rejected: during the configuration dialog's 350 ms closing grace `enabled` is still false, so a row click in that window would open the drawer with a set taken before an address-book edit. That would weaken rule 4, which was already approved. Keeping two separate concepts is the correct design: disable drops on the way in, pause drops on the way out.

**Trigger analysis: checked against the code.**

| Path | Result |
|---|---|
| Idle callback or Safari timer pending when the drawer opens | `paused` is a dependency of the idle effect, so the effect's cleanup cancels the callback. If a browser runs it anyway, `warm()` reads `latest.current.paused` (set during render) and returns. T-H6c, T-D5 |
| Hover, focus or press on the row while open | The row is under the modal overlay, and `warm()` refuses anyway |
| Close while saving | `SettingsDrawer` ignores `onOpenChange(false)` and Escape/outside clicks while `isBusy`. `isBusy = isSaving`, and the panel's `saving` covers the PUT and the `await load()` after it (`finally`). So the drawer closes only once the save has fully finished, and any warm after that answers with post-save data |
| Focus return / hover during the close animation | `paused` is already false in that render, so the warm starts post-save. Info: `onCloseAutoFocus` fires when the content unmounts, which is after the commit where the un-pause drop runs, so the focus warm survives. If the order were ever reversed, the drop would discard a *fresh* pair and the reopen would read for itself. That costs one extra request and can never show stale data |
| A set held at open but not taken | Dropped on un-pause (T-H6b) |
| Take during the close animation | The panel takes once per mount (SA-CA-9), and its mount happened at open. Nothing to re-take |

**Other stale-data paths.** I found none. Rules 1–9 hold: no pair can start between a save and the close, and the first warm after the close always starts after the PUT and the reload have both finished. Address-book edits outside the drawer still go through the configuration dialog (rule 4, unchanged, T-H6 pins the immediate drop).

**Re-run by SA:** the 4 prefetch suites (`useDrawerPrefetch`, `MarketingConsentDrawer.prefetch.render`, `consentPrefetch.guard`, `MarketingConsentPanel.parallel.render`): **81 / 81 passed**, the same as Dev's count. The page diff only adds `paused: consentDrawerOpen` and its comment to the approved wiring. `enabled` is byte-identical to what was approved, and T-G1 pins it exactly.

**Findings:** none blocking. One Info item, the focus-return ordering in the table above. Its failure direction is safe, so no change is needed.

---

## QA Testing Report

*(QA to populate; include the before and after measurement table from §9.)*

**Measurement (SA-CA-11 / SA-CA-12), ready for QA/TL.** Dev skipped tasks 2 and 13 at TL's instruction. Protocol: [Manual QA and measurement](#manual-qa-and-measurement). Test account only; open and close only (no Save, no delete, no address added). Record the database the local build used.

Database used by the local build: _____ · Preview sign-in possible: yes / no

| Scenario | Build | T-form median (range) | T-list median (range) | Jump (yes/no) | Addresses GET starts before consent ends (yes/no) |
|---|---|---|---|---|---|
| (a) warm | before (`origin/main`) | | | | |
| (a) warm | after (C-a) | | | | |
| (b) immediate | before (`origin/main`) | | | | |
| (b) immediate | after (C-a) | | | | |
| (a) warm | Vercel preview (best-effort) | | | | |

Structural pass criteria (SA-CA-12): ⬜ the addresses request starts before the consent response ends · ⬜ opening after a warm makes zero requests (M-7) · ⬜ no jump of the postal box with one or more saved entries.

## QA Report (2026-10-16)

**QA — 2026-10-16**, on `feature/settings-drawer-phase-c` (uncommitted) in the `neuronforge-phase-c` worktree. No production code changed; nothing run against production or any database.
**Test mode:** full · **Strategy:** A/B (Jest, real panel and real picker, `fetch` routed by URL) plus code-level structure probes; D (browser) and the measurement NOT RUN (no browser in this session).
**Focus:** ui, performance (structure only, per SA-CA-12) · **Input source:** TL prompt plus SA-CA-12 and SA code review CR-CA-1.

### Verdict: ❌ FAIL — one Medium bug (QA-CA-B1) must be fixed before commit

The design works as specified on every structure check, and Dev's suites are green. One path breaks the "reopen is fresh" rule (S-3). It can show the wording from before the last save, and then save it again. The fix is small (see B1). After it, a targeted re-QA is enough: probe S-7 plus the four prefetch suites.

### Test runs

| Run | Result |
|---|---|
| The 8 new or edited suites (`useDrawerPrefetch`, `marketingDrawerReads`, `addressBookRead`, `SavedAddressPicker.initialBook`, `MarketingConsentPanel.parallel.render`, `MarketingConsentDrawer.prefetch.render`, `consentPrefetch.guard`, `pickerCall.guard`) | ✅ 8 suites, **104 / 104** (matches Dev's per-file counts) |
| Dev's must-stay-green command (identical arguments) | ✅ **48 suites, 773 / 773** (Dev recorded 772: one more test than recorded, nothing failing) |
| The same plus `themePrepaint.guard` | ✅ 49 suites, 809 / 809 (matches SA's re-run) |
| Entitlements | No new or edited file imports `lib/business-os/entitlements/` (grep), so `test:bos-entitlements` was not re-run; Dev's green run stands |
| `console.*` in new or touched files | 0 |

### Structure checks (SA-CA-12), code level — QA probe, 7 tests (temporary file, removed after the run)

| # | Check | Result |
|---|---|---|
| S-1 | Cold open: the addresses request starts **before** the consent answer ends (order `book:start`, `consent:start`, then `consent:end`) | ✅ |
| S-1b | Warm path: the starter issues both requests before either answers | ✅ |
| S-2/S-3 | Under `<React.StrictMode>`: warm, then open → **zero** new requests; `takePrefetched` called once | ✅ |
| S-4 | Under `<React.StrictMode>`, no warm: exactly **one** consent GET and **one** addresses GET | ✅ |
| S-5 | Untouched open with preloaded consent, book arriving after it → close shows no "Discard your changes?" and the sheet closes | ✅ |
| S-6 | Open, close, focus-return warm, reopen within 60 s → each set used once; the second open shows the fresh read; 2 pairs in total | ✅ |
| S-7 | An idle warm that fires **while the drawer is open** | ❌ **B1** (`startedWhileOpen=2 reopenShows=BEFORE`) |

### Issues Found

#### Bugs (must fix before commit)

1. **QA-CA-B1 — A warm that fires while the drawer is open starts a pre-save read that a reopen then shows.** File: `app/business-os/settings/page.tsx` (the `enabled` passed to `useDrawerPrefetch`). Severity: **Medium**.
   - Cause: `enabled` is `!loading && !isConfigurationOpen` and does not include the drawer being open. `take()` empties the held slot on open, so the idle callback still pending from page load finds nothing held when it fires. The same applies to the Safari `setTimeout` fallback (1.5 s). It starts a new pair while the drawer is open, and that pair answers with the data from **before** any save made in the drawer. On close, the focus-return warm is a no-op because a usable set is held. A reopen within 60 s therefore takes the pre-save set.
   - Steps (reproduced in the probe with the real panel, picker and hook): page loaded, idle not yet fired → press the row (warm) → open → idle fires → edit the wording and Save (PUT, then the fresh reload shows `SAVED`) → close → focus-return warm → reopen.
   - Expected: no request while the drawer is open; the reopen shows `SAVED`.
   - Actual: 2 requests while the drawer is open, and the reopen shows `BEFORE`. The form's baseline is the old wording, so it opens clean. One more Save then writes the old wording back over the save the owner just made.
   - Likelihood: it needs a click before the idle warm has fired. On browsers without `requestIdleCallback` (Safari, all iOS browsers), that is any tap within 1.5 s after the settings page finishes loading. In Chrome the window is short but not zero: up to the 2 s idle timeout on a busy page.
   - Suggested fix (Dev to decide): add `!consentDrawerOpen` to `enabled`. The panel's `take()` runs in the child's mount effect, before the page's drop effect, so the take still works. On close, `enabled` turns true again and the idle effect warms a fresh pair after the save. Pin it in `consentPrefetch.guard` (T-G1) and with a behavioural test like S-7.

#### Test gaps (should fix; each one is a surviving mutation)

1. **QA-MU-4 survives: a warm on a held set could refresh its age.** No test pins rule 2's "measured from its **start**" against repeated warms. Suggested test: warm at t=0, warm again at t=50 s, take at t=61 s → `null`.
2. **QA-MU-7 survives: `enabled: !loading || !isConfigurationOpen` passes T-G1.** The guard checks that both terms are present, not that `&&` joins them. Suggested: match the whole expression, with a negative control for `||`.
3. **QA-MU-1 survives: a module-level cache passes the module-state guard.** The regex `const\s+\w+\s*=\s*(?:new\s|\[|\{)` misses a type annotation (`const X: T = { current: null }`). No behavioural test shows that a held set is gone once the page unmounts and remounts (R-4: sign-out, then sign-in, in the same tab). Suggested: a hook test that warms, unmounts, remounts with the same key and expects `take()` → `null`; and widen the regex to allow `:\s*[^=]+`.

#### Edge cases (nice to fix)

1. **QA-MU-14 (the placeholder kept for an empty ready book)** is killed only incidentally, by D-6 in `MarketingConsentDrawer.render`, whose empty-book mock needs the stub picker. No test states R-7 directly ("an empty ready book collapses the placeholder").
2. **QA-MU-19 is equivalent, not a gap:** making the prefetched book wait for the prefetched consent survives. Both requests are already in flight, and the picker cannot render before the form, so nothing visible changes. Recorded so nobody chases it.

### QA mutations (19, in QA's own scratch folder; each restored in `try/finally` and SHA-1 checked; `git diff --numstat` identical before and after)

| # | Mutation | Result | Killed by |
|---|---|---|---|
| QA-MU-1 | Prefetch cache at module level (survives unmount) | ❌ survived | — (gap 3) |
| QA-MU-2 | 60 s → 600 s | ✅ killed | T-H4 (60 s pin), T-D4 |
| QA-MU-3 | Age in seconds, not ms (off by 1000×) | ✅ killed | T-H4, T-D4 |
| QA-MU-4 | A warm on a held set refreshes its age | ❌ survived | — (gap 1). The full-tree run failed only in unrelated suites (a load flake); a targeted re-run gave 62 / 62 green |
| QA-MU-5 | Result reused twice (the drawer caches the first take across opens) | ✅ killed | T-D3 |
| QA-MU-6 | Key ignores language | ✅ killed | T-G1 |
| QA-MU-7 | `enabled: !loading \|\| !isConfigurationOpen` (warms while Configuration is open) | ❌ survived | — (gap 2) |
| QA-MU-8 | Drop-on-disable effect removed | ✅ killed | T-H6 |
| QA-MU-9 | F-18: the seeded derivation ignores `matchCurrent` (fills the default into the postal field) | ✅ killed | 28 tests: T-P*, T-M*, `picker.render` R-1 and others |
| QA-MU-10 | Book arrival nulls the baseline postal line (false "Discard?") | ✅ killed | T-M6, T-D3 |
| QA-MU-11 | F-17 screen suppressed when a preload was used | ✅ killed | T-M5 |
| QA-MU-12 | Consent read gains `cache: 'no-store'` | ✅ killed | the `marketingDrawerReads` request pin, T-M1 |
| QA-MU-13 | Address read loses `no-store` | ✅ killed | the `addressBookRead` request pin, T-M1 |
| QA-MU-14 | Placeholder kept for an empty ready book | ✅ killed (incidental) | D-6 only (edge case 1) |
| QA-MU-15 | Panel ignores the prefetched locale | ✅ killed | T-M12 |
| QA-MU-16 | Picker fetches despite a standing seed (double fetch) | ✅ killed | T-M3 (StrictMode), T-P1, T-D1 |
| QA-MU-17 | Safari timer fallback removed | ✅ killed | T-H8 |
| QA-MU-18 | Failed prefetched book used as-is (no fresh read) | ✅ killed | T-M11 |
| QA-MU-19 | Prefetched book waits for prefetched consent | equivalent | — (edge case 2) |

**15 killed, 3 survived (gaps 1–3), 1 equivalent.** No kill came from a type error.

### NOT RUN (no browser in this session; TL or the user runs these)

Use the test account only, and record which database `.env.local` points at. The measurement only opens and closes the drawer: no Save, no delete, no address added (SA-CA-11). The manual writes (M-4, M-6, M-10) happen only on the test account, and the address book is put back afterwards.

| # | Exact steps | Pass when |
|---|---|---|
| Setup | Run `npm run build && npm run start` (port 3000) in this worktree, **not** `next dev`. Sign in as the test business: 2+ saved addresses, and a stored marketing postal line equal to one of them. Keep a second business with **no** saved addresses. DevTools open, Network filtered to `business-os` | — |
| CR-CA-1 | Business with **exactly one** saved address → open the drawer → DevTools: the computed height of the picker element inside the `mb-2` wrapper, in EN and HE, desktop and phone | Record it. If it differs from 8.5 rem by more than 0.5 rem, Dev sets the class to the measured value (rounded to 0.25 rem) and QA re-checks the jump |
| M-1 | Settings → wait 5 s → click Marketing permission → touch nothing → X | Closes at once with no "Discard your changes?"; the postal line is unchanged and its entry is marked |
| M-2 | Clear the stored marketing postal line (or use a business whose line is empty) → reopen | The field is empty; "Enter a different address" is selected; nothing is pre-marked |
| M-3 | Sign in as the no-address business → open the drawer | No picker; the placeholder only flashes, if at all |
| M-4 | Configuration → Business → add an address → close the dialog → open Marketing permission | The new address is listed. Delete it again afterwards |
| M-5 | Switch the language (EN → HE) → open | Wording and address labels are in Hebrew, RTL |
| M-6 | Inside the drawer, delete an address from the picker | The list refreshes. Re-add the address afterwards |
| M-7 | Reload → wait 5 s idle | Exactly **one** `consent-settings` GET and **one** `addresses` GET. Hovering the row adds none, and neither does clicking. Close, wait over 60 s, move focus away and back with no hover, reopen: one fresh pair |
| M-7b (B1) | **After B1 is fixed.** Reload → click the row within 1 s of the page appearing (Safari, or Chrome with DevTools CPU 6× slowdown) → change the wording → Save → close → reopen at once | No GET while the drawer is open except the reload after Save; the reopen shows the saved wording |
| M-8 | Phone viewport (DevTools device mode, touch) → tap the row | It opens, and the postal box does not move when the list appears (one entry) |
| M-9 | SA C-10 layering: open the privacy `Select` inside the sheet; open the picker's delete confirmation; close the sheet | The popover sits above the sheet; the confirmation sits inside it; focus returns to the row; the row has `aria-haspopup="dialog"` |
| M-10 | Change the wording → Save → close → reopen | The saved wording shows |
| Measure | Fill the table above, for scenarios (a) warm (idle 5 s, then click) and (b) immediate (reload, click as soon as the row shows). Run each 5 times, before (`origin/main`) and after, and read a Chrome Performance trace with screenshots: T-form, T-list and jump (yes/no). From Network, record whether the `addresses` GET starts before the `consent-settings` response ends. Timings are recorded, not gated (SA-CA-12) | Structural: the addresses GET starts before the consent response ends; zero requests on open after a warm; no jump with one entry |

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must fix B1 before commit (gaps 1–3 recommended in the same pass). Then a targeted re-QA, and the NOT RUN list (including CR-CA-1) by TL or the user

### QA re-check after B1 fix (2026-10-16)

**QA, 2026-10-16**, same worktree and branch, uncommitted. No production code changed; nothing run against production or any database. Mode: targeted regression (prompt). Scope: the `paused` fix (hook rule 6 and the page wiring), QA's S-7 probe, and every QA mutation.

#### Verdict: ✅ PASS WITH NOTES — QA-CA-B1 is fixed; no bug open

QA's suggested fix (`!consentDrawerOpen` in `enabled`) was wrong: it would have lost the handover. Dev's reasoning about the Radix portal holds, and QA-B1-2 below confirms it independently. The notes are one Low test gap and the NOT RUN browser list, which is unchanged.

#### Runs

| Run | Result |
|---|---|
| S-7 probe (temporary file, removed afterwards), wired as the page is (`paused: open`) | ✅ `startedWhileOpen=0 reopenShows=SAVED` |
| S-7 control: the same probe with no `paused` (shows the probe still detects the bug) | `startedWhileOpen=2 reopenShows=BEFORE`. B1 reproduces without the fix, so the probe can tell the two apart |
| S-1..S-6 re-run with the paused wiring | ✅ all 6 pass (book starts before consent ends, zero requests after a warm, StrictMode clean, no false Discard, each set used once) |
| S-8 (new): un-pause re-arms the idle warm | ✅ the idle callback is re-armed on close (1 → 2 registered), and the next warm is fresh |
| S-9 (new): close with real focus return (`returnFocusRef` row with `onFocus=warm`) plus the re-armed idle firing | ✅ **exactly one** fresh pair after the close, and the reopen uses it. Radix returns focus after the un-pause drop has run, so the focus-return warm is not thrown away. That agrees with SA's Info item |
| The 4 prefetch suites | ✅ 4 suites, **81 / 81** (matches Dev) |
| Must-stay-green (the same command) | ✅ **48 suites, 792 / 792** (matches Dev) |
| Before and after | `git diff --numstat` identical; SHA-1 of every code and test file identical. Only the workplan's hash changed, from the parallel SA edit plus this section |

#### Mutations (26, own scratch folder `qa-ca-b1/`; QA's runner against its three default test folders; each restored in `try/finally` and SHA-1 checked)

| # | Mutation | Result | Killed by |
|---|---|---|---|
| QA-MU-1 | Typed module-level cache | ✅ killed (was survived) | T-H10, module-state guard |
| QA-MU-2, -3 | 60 s → 600 s; age in seconds | ✅ killed | T-H4, T-H4b, T-D4 |
| QA-MU-4 | A warm on a held set refreshes its age | ✅ killed (was survived) | T-H4b |
| QA-MU-5, -6, -8 | Result reused; key ignores language; drop on disable removed | ✅ killed | T-D3; T-G1; T-H6 ×2 |
| QA-MU-7 | `enabled: !loading \|\| !isConfigurationOpen` | ✅ killed (was survived) | T-G1 |
| QA-MU-9..18 | Panel, picker and reads (unchanged by the fix) | ✅ 10 / 10 killed | as in the first report |
| QA-MU-19 | Prefetched book waits for prefetched consent | equivalent (as before) | — |
| QA-B1-1 | `paused` taken out of the idle effect's deps (no cancel at pause, no re-arm at un-pause) | ✅ killed | T-D5, T-H6c |
| QA-B1-2 | Pausing also drops the held set (the handover breaks) | ✅ killed | T-H6b, T-D1..T-D3 (paused), T-D5, T-D6: 7 tests |
| QA-B1-3 | `warm()` allowed while paused when it gets an event argument (hover, focus or press); idle still blocked | ⚠️ **survived** | — (note 1) |
| QA-B1-4 | `paused` only sampled when `enabled` flips (a stale `paused` inside `warm`) | ✅ killed | T-D5, T-H6b |
| QA-B1-5 | `take()` refuses while paused | ✅ killed | T-H6b, T-D1..T-D3 (paused): 7 tests |
| QA-B1-6 | Page: `paused: !consentDrawerOpen` | ✅ killed | T-G1 |
| QA-B1-7 | The idle callback starts a pair itself, ignoring `paused` (`warm()` untouched) | ✅ killed | T-D5, T-H6c |

**24 killed, 1 survived, 1 equivalent.** No kill came from a type error. One unrelated `PlanUpgrade.render` failure appeared once alongside a genuine kill, under load.

#### Notes

1. **Test gap (Low): QA-B1-3 survives.** Every test calls `warm()` with no arguments, so nothing pins rule 6 for the page's real event handlers, which pass the event. In the browser the row cannot be reached while the modal is open (overlay, focus trap, `aria-hidden`), so it does no harm today. A test that fires `pointerEnter` or `focus` on the row while the drawer is open would close it. Optional; it does not block the commit.
2. The NOT RUN browser list above is unchanged. M-7b (the B1 manual check) can now be run.

#### Final Status (re-check)
- [x] QA-CA-B1 fixed and verified; gaps QA-MU-1, -4 and -7 closed. Ready for commit as far as the automated scope goes. The NOT RUN list (M-1..M-10, M-7b, CR-CA-1 and the measurement) still goes to TL or the user
- [ ] Issues found
- [x] RM, 2026-10-16: accepted for commit under the user's standing Phase C fast-track (SA + QA approve, then commit + PR + auto-merge). **CR-CA-1 (the one-entry placeholder height measurement) and the NOT RUN manual list (M-1..M-10, M-7b) are deferred to the user, who checks them after deploy.** If CR-CA-1 measures off by more than 0.5 rem, the one-value change ships as a follow-up

---

## QA bug fix (2026-10-16)

**Dev, 2026-10-16**, same branch, not committed. Fixes QA-CA-B1 and closes gaps QA-MU-4, QA-MU-7 and QA-MU-1. **The fix adds one optional hook option (`paused`, rule 6), so SA should re-check it under rule 7 before the targeted re-QA.**

### QA-CA-B1: fixed, but not with the suggested `!consentDrawerOpen` in `enabled`

Fixed by Dev: the hook gains `paused` (rule 6), and the page passes `paused: consentDrawerOpen`. While paused, `warm()` starts nothing, and the idle callback or Safari timer is cancelled (and if a browser runs it anyway, it still starts nothing). Un-pausing (the close) drops whatever is held, and the idle effect re-arms, so the next warm after a save is fresh. `enabled` is unchanged: `!loading && !isConfigurationOpen`.

**Why not the suggested fix.** The handover was checked before choosing, as the TL asked: *"verify the panel still takes its reads before the drop runs"*. It does not. `SettingsDrawer` renders its content in a Radix `Dialog` portal (`@radix-ui/react-portal` 1.1.9). The portal sets `mounted` in a layout effect, so the panel mounts **one commit after** `open` turns true. By then the page's effects for the commit that opened the drawer have run, including rule 4's drop on disable. With `!consentDrawerOpen` in `enabled`, the panel's `take()` found the slot empty, and every warm was thrown away: 3 of the 5 `MarketingConsentDrawer.prefetch.render` tests failed (T-D1, T-D2, T-D3: the drawer read again on open). Mutation B1-b2 below repeats that check.

Two ways out were considered:

| Option | Effect | Taken? |
|---|---|---|
| Move rule 4's drop from turning off to turning back on (one flag) | It fixes the handover, but the configuration dialog would then stop dropping on open. Its 350 ms closing grace keeps `enabled` false, so a click on the row in that window would open the drawer while it is still off. The drawer would then take a set from before an address-book edit. That weakens the approved stale-data rule 4 | No |
| **A separate `paused` state** for "the drawer this hook serves is open": no warm, no idle, no drop on the way in (the handover), drop on the way out | Rule 4 and its drop on disable stay exactly as approved. Pausing covers only what B1 needs | **Yes** |

**Other triggers checked:**

- **The idle warm or Safari timer firing late:** cancelled when the pause starts. `warm()` refuses while paused anyway (T-H6c, T-D5).
- **Hover, focus or press on the row while open:** the row sits under the modal overlay, and `warm()` refuses while paused in any case.
- **Focus returning to the row on close, or a hover during the close animation:** `paused` is already false in that render, and the drawer refuses to close mid-save (`isBusy` covers the PUT and the reload after it). So any pair started then answers with data from after the save. That is the fresh warm the fix wants.
- **A set held when the drawer opened but never taken:** dropped on un-pause (T-H6b).

### Tests added or changed

| Test | File | Pins |
|---|---|---|
| T-G1 (tightened) | `consentPrefetch.guard.test.ts` | Exact `enabled` (`!loading && !isConfigurationOpen,`) and exact `paused` (`consentDrawerOpen,`), not just their terms. Negative controls: `&&` → `\|\|` (QA-MU-7); pause removed, `false`, or negated; the drawer term moved into `enabled` (QA's suggestion, which breaks the handover) |
| Module-state guard (tightened) | `consentPrefetch.guard.test.ts` | An allow-list: a top-level `const` may only be a numeric constant (`const NAME = 60_000;`), and there may be no `let` or `var`. Negative controls: a typed `{ current: null }` (QA-MU-1), `new Map()`, a factory call, an array, `let`, `export let`, `var` |
| T-H6 (immediate drop) | `useDrawerPrefetch.test.tsx` | Turning `enabled` false drops at once: `take()` while off → `null` (rule 4 unchanged) |
| T-H6b ×3 | same | A child mounting one commit after the parent paused (a stand-in for the Radix portal) still takes the set. While paused, `warm()` starts nothing. Un-pausing drops a set that was never taken, and the next warm is fresh |
| T-H6c ×2 | same | An idle callback pending at pause is cancelled, starts nothing if run anyway, and is re-armed on un-pause. The Safari timer pending at pause never starts |
| T-H4b | same | QA-MU-4: warms at 0, 30 s and 50 s start one set, and `take()` at 61 s → `null` (the age runs from the start) |
| T-H10 | same | QA-MU-1 / R-4: warm, unmount, remount with the same key; a child taking in its mount effect gets `null` |
| T-D1..T-D4 ×2 | `MarketingConsentDrawer.prefetch.render.test.tsx` | Now `describe.each`: always-on, and paused while open as the page wires it. The handover still works with the real drawer, portal included |
| T-D5 | same | QA's S-7 with the real drawer, panel and picker: press-warm → open → idle fires (cancel is a no-op, the worst case) → **0 requests while open** → edit + Save → close → focus-return warm → reopen **shows the saved wording**, 3 consent GETs |
| T-D6 | same | QA's S-2/S-3 under `<React.StrictMode>` with the paused wiring: warm, then open → zero new requests |

### Mutations (own scratch folder `dev-ca-b1/`; each restored in `try/finally` and SHA-1 checked; `git diff --numstat` identical before and after)

| # | Mutation | Result | Killed by |
|---|---|---|---|
| B1-a | Page: `paused: consentDrawerOpen` removed (the bug) | ✅ killed | T-G1 |
| B1-a2 | Page: the drawer term put in `enabled` instead (QA's suggestion as written) | ✅ killed | T-G1 and its negative control |
| B1-b | T-D5's harness not paused while open (the bug, behaviourally) | ✅ killed | T-D5 |
| B1-b2 | Harness: the drawer term in `enabled`, not `paused` (QA's suggestion, behaviourally) | ✅ killed | T-D1, T-D2, T-D3 (paused variant), T-D5, T-D6: 5 tests, the handover lost |
| B1-c | Hook: pausing also drops on the way in | ✅ killed | T-H6b ×2, T-D1/T-D2/T-D3 (paused), T-D5, T-D6: 7 tests |
| B1-d | Hook: `warm()` ignores `paused` | ✅ killed | T-H6b, T-H6c, T-D5 |
| B1-e | Hook: the idle effect ignores `paused` (no cancel) | ✅ killed | T-H6c |
| B1-f | Hook: the drop on un-pause removed | ✅ killed | T-H6b (un-pause) |
| B1-g | Hook: rule 4's drop moved from turning off to turning back on | ✅ killed | T-H6 (immediate) |
| QA-MU-8 | Hook: the drop on disable removed | ✅ killed | T-H6 ×2 |
| QA-MU-4 | A warm on a held set refreshes its age | ✅ killed | T-H4b |
| QA-MU-7 | `enabled: !loading || !isConfigurationOpen` | ✅ killed | T-G1 and its negative control |
| QA-MU-1 (guard) | Typed module-level cache, run against the guard only | ✅ killed | Module-state guard (allow-list) |
| QA-MU-1 (behaviour) | The same mutation, run against the hook tests only | ✅ killed | T-H10 |

**14 / 14 killed.** No kill came from a type error. QA's own runner was then re-run, unchanged, for the nine QA mutations on the hook, the page and the drawer (QA-MU-1..8, QA-MU-17), against its default three test folders: **9 / 9 killed** (QA-MU-1 now by T-H10 and the module-state guard; QA-MU-4 by T-H4b; QA-MU-7 by T-G1; QA-MU-8 by T-H6 ×2; the other five as before). The page and drawer mutations QA-MU-9..16, 18 and 19 were not re-run: they touch the panel and the picker, which this fix does not change, and no test was removed.

### Verification

| Check | Result |
|---|---|
| The 4 prefetch suites (`useDrawerPrefetch` 28, `MarketingConsentDrawer.prefetch.render` 12, `consentPrefetch.guard` 20, `MarketingConsentPanel.parallel.render` 21) | ✅ 4 suites, **81 / 81** |
| Must-stay-green (the same command as before) | ✅ **48 suites, 792 / 792** (QA's 773 plus 19 new tests) |
| ESLint on the touched files | 0 errors. 1 warning, pre-existing (`page.tsx` `useEffect` missing `loadData`) |
| `npm run lint:hooks` | clean |
| `npx tsc --noEmit` | 1 852 errors repo-wide (unchanged), **0 in any touched or new file** |
| `console.*` in touched files | 0 |
| Entitlements | No touched file imports `lib/business-os/entitlements/`; `test:bos-entitlements` not re-run |
| `handleLogout` block | untouched |

**Re-QA asked for:** S-7 (now T-D5) and the four prefetch suites, plus SA's check of rule 6 (`paused`). The NOT RUN list is unchanged; M-7b stands as written.

---

## Commit Info

*(RM to populate.)*

**Branch:** `feature/settings-drawer-phase-c` · **Commit:** `perf(settings): load Marketing permission ahead of the click (C-a)` · PR against `main` with auto-merge (`--merge`). Commit hash and PR number: see the PR and the requirement §0. CR-CA-1 and the manual M-list are deferred to the user after deploy.

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Created | Dev workplan for C-a (§0.6 items C-3, C-4, C-5) on `feature/settings-drawer-phase-c` from `447d17a2`. Parallel book read plus `initialBook` on the shared picker; fixed-height placeholder; page-owned `useDrawerPrefetch` (used once, 60 s, account and language key, disabled while loading or while the configuration dialog is open, idle and hover/focus/press). F-18, S-3 and F-17 rules restated with tests that use preloaded data. Timing-independent tests, mutation list, production-build measurement protocol, risks, questions Q-1..Q-12. No code; awaiting SA workplan review |
| 2026-10-16 | SA workplan review | ✅ Approved with conditions SA-CA-1..15. Verified against the code on `447d17a2`. Q-1: `useDrawerPrefetch` approved under rule 7, scoped to the settings-page drawers, with no CLAUDE.md or skill change. Q-2..Q-8, Q-11 and Q-12 approved; Q-9 not moved (the comment stays with C-c); Q-10 is an SA call. Gaps closed: D-12 log parity (`err` kept), every unusable preloaded consent result reads once more fresh, the seed turns off after the first locale change (he → en → he bug), the seeded derivation runs once under StrictMode, exactly one picker in the panel. The `owner` test is not edited (it mocks the panel). Mutations MU-19..22 added; pass criteria structural, timings recorded |
| 2026-10-16 | Code complete (Dev) | Built on `origin/main` `09e2d3ad`. New: `addressBookRead.ts`, `marketingDrawerReads.ts`, `useDrawerPrefetch.ts`; changed: `SavedAddressPicker.tsx` (`deriveSelection` extracted first, SA-CA-15 gate green with no test edits; then `initialBook`), `MarketingConsentPanel.tsx`, `MarketingConsentDrawer.tsx`, `page.tsx`. SA-CA-1..15 applied. 7 new test files; `MarketingConsentDrawer.render` gets only the read mock, `owner` and the real-picker suite untouched. Must-stay-green 48 suites / 772 tests green, `test:bos-entitlements` green, `typecheck:bos-llm` 0 new, `tsc` 0 in touched files, `lint:hooks` clean, 26/26 mutations killed. Measurement left for QA/TL. Not committed; awaiting SA code review and QA |
| 2026-10-16 | SA code review | ✅ Approved with conditions. SA-CA-1..15 verified against the code; SA re-run of the must-stay-green set: 49 suites / 809 tests green; ESLint 0 errors, both `exhaustive-deps` disables justified; `handleLogout` untouched; the type-only cycle accepted. QS-1: keep `8.5rem`, QA measures the one-entry picker and Dev adjusts the one value if it is off by more than 0.5 rem (CR-CA-1; the no-jump gate is one entry, 2+ is R-7). QS-2: the sequential failure-path book read is accepted. CR-CA-2..4 Low/Info, no change required |
| 2026-10-16 | QA report | ❌ FAIL on one Medium bug. QA-CA-B1: an idle or timer warm that fires while the drawer is open starts a pair from before the save, and a reopen within 60 s shows it (reproduced: 2 requests while open, the reopen shows the old wording). Suggested fix: `!consentDrawerOpen` in `enabled`. New suites 104/104; must-stay-green 48 suites / 773 tests, green. Structure checks S-1..S-6 pass at code level: the book starts before consent ends, zero requests after a warm, one copy of each, StrictMode clean, no false Discard, each set used once. 19 QA mutations: 15 killed, 3 survived (the age refreshed by a warm, `\|\|` in `enabled`, a typed module-level cache), 1 equivalent. M-1..M-10, CR-CA-1 and the measurement NOT RUN (no browser); the steps are recorded |
| 2026-10-16 | QA bug fix (Dev) | QA-CA-B1 fixed: the hook gains `paused` (rule 6) and the page passes `paused: consentDrawerOpen`. While paused, nothing warms and the idle callback or timer is cancelled; un-pausing (the close) drops anything held, so the next warm is fresh. Not QA's `!consentDrawerOpen` in `enabled`: the drawer content mounts one commit later (a Radix portal), after rule 4's drop on disable, so the handover was lost (T-D1..T-D3 failed). `enabled` and rule 4 unchanged. Gaps closed: QA-MU-4 (T-H4b), QA-MU-7 (exact `enabled` and `paused` pinned), QA-MU-1 (module-state guard now an allow-list, plus T-H10 for unmount/remount). New T-D5 (S-7: 0 requests while open, the reopen shows the saved wording) and T-D6 (StrictMode handover). 14/14 Dev mutations killed, and QA's runner re-run for QA-MU-1..8 and QA-MU-17: 9/9 killed. Prefetch suites 81/81; must-stay-green 48 suites / 792; ESLint 0 errors; `lint:hooks` clean; `tsc` 0 in touched files. Not committed |
| 2026-10-16 | SA re-check of QA bug fix | ✅ Approved, no new conditions. `paused` accepted under rule 7: an optional prop on the already-approved hook, still props-only, no module state, and the guard is now an allow-list. Rejecting `!consentDrawerOpen` in `enabled` is confirmed correct (the Radix portal mounts one commit late, so rule 4 would drop the set first). Rejecting the single flag is also confirmed (the 350 ms closing grace would weaken rule 4). Trigger analysis verified against the code: the idle warm is cancelled and `warm()` refuses while paused; `isBusy` covers the PUT and the reload, so any warm after the close is post-save. No other stale-data path. One Info item: focus-return ordering fails safe. SA re-run of the 4 prefetch suites: 81/81. Next: targeted re-QA |
| 2026-10-16 | QA re-check after B1 fix | ✅ PASS WITH NOTES. S-7 probe with the page's wiring: `startedWhileOpen=0`, the reopen shows `SAVED`; the control without `paused` still reproduces B1. New probes: S-8 (un-pause re-arms the idle warm) and S-9 (real focus return plus the idle warm: exactly one fresh pair). Prefetch suites 81/81; must-stay-green 48 suites / 792. 26 mutations: 24 killed (QA-MU-1, -4 and -7 now killed; 6 of 7 new `paused` mutations killed), 1 survived (QA-B1-3: a hover, focus or press while paused, a Low test gap that cannot be reached behind the modal), 1 equivalent (QA-MU-19). QA's original suggested fix confirmed wrong (it loses the handover). The NOT RUN browser list is unchanged |
| 2026-10-16 | Committed (RM) | SA APPROVED + re-check APPROVED, QA PASS WITH NOTES (QA-B1-3 Low gap accepted). Committed on `feature/settings-drawer-phase-c` and PR opened against `main` with auto-merge (`--merge`), under the user's standing fast-track rule (confirmed for Phase C on 2026-10-16). CR-CA-1 (placeholder height measurement) and the manual M-list (M-1..M-10, M-7b) deferred to the user after deploy |
