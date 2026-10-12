# Workplan: Admin Layout Standard — Slice L-5 (Plans & entitlements)

> **Last Updated**: 2026-10-11

**Developer:** Dev
**Requirement:** [ADMIN_LAYOUT_STANDARD_REQUIREMENT.md](/docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md): §1 (row 10), §3, §4.8, §5.1, §5.3, §5.4 (K-1 to K-10), §5.5 (Refresh-only bar), §5.7, §5.9, §5.10, §5.11, §5.12, §6.1 (S-1, S-3, S-4), §6.2 C-2, C-3, C-4, C-5, C-11, C-12, C-13, C-14, §7.8, §9 F-36, F-37, F-38, F-39, §10 D-3 (a), D-4 (a), D-5 (a); SA rulings Q-3 (one alias line), re-check R-7 (a page slice that builds a shared export runs the full cycle)
**Skills applied:** `business-os-entitlements` (this page sits beside the module; the rules are in §2.8)
**Branch:** `feature/admin-layout-l5`, cut from `feature/admin-layout-l4b` at `0f02f80b` (PR #309, open). The L-5 PR targets `main` and carries L-4b until #309 merges. Worktree `neuronforge-admin-layout`
**Date:** 2026-10-11
**Status:** Committed — 0e40bd0c, PR #310 open (fast-track after SA code review + QA); awaiting checks + user merge. SA workplan review APPROVED WITH CONDITIONS; M-1 and M-2 applied before coding
**Path:** **UI short path by classification** (R-7): L-5 builds **no** shared export. Every shared part it uses already exists on the branch (`AdminPageHeader` with `badge` and `asOf`, `AdminLoading` / `AdminError`, `readAdminResponse` with `sessionEndedCopy`, the Refresh-only `AdminFilterBar`, `KpiStrip` / `KpiTile` in anchor and no-target mode, `StatusChip` tones `neutral` / `info` / `ok` / `warn` / `danger`, the `adminTable` constants, `formatUtc` / `formatCount`). The only edit in the shared folder is the migrated-pages registry entry in its guard test (the L-3 and L-4b precedent). Run as SA workplan review → Dev → SA code review + QA → RM under the user's fast-track (RM commits and opens the PR after SA and QA, without a user diff review). **If SA rules that the Enforcement tile turns green when enforced (§7.8 as written, Q-1 option b), the slice builds the K-4 `green` status and becomes full cycle.** The recommendation below avoids that

## Overview

L-5 moves `/admin/business-os-tiers` (198-line `page.tsx` and five components) onto the standard. The h1 becomes "Plans & entitlements", the sidebar label (D-3 (a), F-36). The header is `AdminPageHeader`, with the "Read-only" badge as the neutral chip and a server "As of" line from the payload's `generatedAt`. A four-tile KPI strip goes above the content, built only from the one `GET /plans` payload (§7.8, K-9). Refresh moves to the Refresh-only bar. Loading and error use the shared states. Both reads (the plans and the account lookup) go through `readAdminResponse`, so a non-JSON body or a network failure no longer shows a raw `SyntaxError` or "Failed to fetch" (F-37). The plan cards stay cards (§5.7: a small set of differently-shaped things). Their state pills become `StatusChip`s (words + icon). The account result's capability table takes the standard table classes. The enforcement banner stays, undismissible and unchanged in words. The account lookup stays a pasted-id field (§7.8; the picker is F-39, the user's). No route, request, payload, permission or write changes, and no import from the entitlements module.

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary-code-verified-at-0f02f80b)
- [2. Scope and decisions](#2-scope-and-decisions)
- [3. Implementation Approach](#3-implementation-approach)
- [4. Files to Create / Modify](#4-files-to-create--modify)
- [5. Guard and registry changes](#5-guard-and-registry-changes)
- [6. Tests](#6-tests)
- [7. Verification](#7-verification)
- [8. Task List](#8-task-list)
- [9. Sizing](#9-sizing)
- [10. Risks](#10-risks)
- [11. Out of scope and found on the way](#11-out-of-scope-and-found-on-the-way)
- [12. Questions for SA](#12-questions-for-sa)

---

## 1. Analysis Summary (code verified at `0f02f80b`)

### 1.1 The page today

Line numbers re-checked against the files at `0f02f80b` (SA S-1; the first draft cited lines past the end of `PlanCard.tsx`, 207 lines, and `AccountLookup.tsx`, 132 lines).

| File / lines | What | Standard item |
|---|---|---|
| `page.tsx:44-64` | One `fetch('/api/admin/business-os/entitlements/plans')` on mount and on Refresh; `response.json()` called directly (`:54`); `err.message` shown (`:60`) | F-37, §5.10 |
| `page.tsx:72-101` | Hand-built header: h1 "Business OS Tiers", purple "Read-only" pill, two-part purpose, Refresh (style B) in the header | F-36, §5.3, §5.5 |
| `page.tsx:103-113` | Error box `page-error` (rose), loading text "Reading the configuration…" | §5.10 |
| `page.tsx:115-195` | Content: `EnforcementBanner`, the no-gate summary (amber id pills), the plans grid (`md:grid-cols-2 xl:grid-cols-4`), `NotBuiltPanel`, `AccountLookup`, "Changing any of this" (slate id pills) | §5.7 |
| `page.tsx:163`, `:85` | Information in `text-slate-500` (matrix version line, the agent-platform note) | T-5 |
| On a failed Refresh | `payload` is kept, so the stale content stays under the error (existing choice, §5.5 keeps it) | §5.5 |
| `EnforcementBanner.tsx` | Amber when not enforced, emerald when enforced; no props for dismissal by construction | Stays (brief); §2.6 |
| `PlanCard.tsx:49-51`, `:56-64`, `:72-81`, `:88-117`, `:155` | Card `rounded-lg` (inactive: `border-dashed border-rose-500/60 opacity-70`, `:50`); five hand-styled pills: kind (blue / slate), shown (sky / slate), buyable (emerald / amber), active (slate / rose, `title` "FYI only…"); "Free" in `text-emerald-400`; `Check` icon emerald | §5.7, §5.9, T-6 |
| `PlanCard.tsx:70`, `:122-149` | Plan id and `dt` / `h4` labels in `text-slate-500` | T-5 |
| `PlanCard.tsx:191-197` | "no gate yet" amber pill with `title` and testid `no-gate-{capability}` | §5.9 |
| `NotBuiltPanel.tsx` | Card `rounded-lg`; capability id `text-slate-500`; category pill slate | §5.7, T-5 |
| `AccountLookup.tsx:58-74` | `fetch` of `/accounts/{id}`; `response.json()` direct (`:62`); `err.message` (`:71`); codes mapped through `ENTITLEMENT_ERROR_COPY`, unknown code → "Could not read that account ({code})." | F-37 |
| `AccountLookup.tsx:94-101` | Plain `<a href="/admin/users">` inside a `text-slate-500` note | F-39 (link half), T-5 |
| `AccountLookup.tsx:104-121` | Raw id input (`aria-label` "Account id"), blue "Look up" submit | §5.5 field style, T-7 |
| `AccountLookup.tsx:123-127` | Error `<p data-testid="account-error">` rose text | §5.10 |
| `EntitlementSnapshot.tsx:45-101` | `<dl>` (labels `text-slate-500`, expiry dates printed as raw ISO) and a small table (`pb-1` / `py-1`, no `scope`, no label) | §5.7, §5.11, T-5 |

### 1.2 The payload (route unchanged)

`GET /api/admin/business-os/entitlements/plans` → `{ success, data: PlansPayload }` (`types.ts:49-60`): `generatedAt`, `mode`, `modeEnvVar`, `modeMeaning`, `enforced`, `matrixVersion`, `withheldWithoutGate[]`, `plans[]` (each with `shownToCustomers`, `availableToBuy`, `active`, `includes[]`, `withholds[]`), `notBuilt[]`, `writeOpsNotOnThisPage[]`. Errors: `requireAdmin` answers `Unauthorized` (401) / `Forbidden` (403); the route answers `Could not read the Business OS plans` (500). Every KPI below is read from these fields; nothing new is fetched (K-9).

`GET /api/admin/business-os/entitlements/accounts/[accountId]` → `{ success, data: AccountPayload }`, or `{ success: false, error: <code> }` for the codes `accountLookup.contract` collects from the route source (every one has copy in `ENTITLEMENT_ERROR_COPY`).

### 1.3 Who else renders this folder's code

| Consumer | What it uses | Effect of L-5 |
|---|---|---|
| `app/admin/users/components/BusinessOsPanel.tsx:28-32` (the Businesses drawer, migrated in L-4) | `EntitlementSnapshot`, `ENTITLEMENT_ERROR_COPY`, `AccountPayload` type | The restyled snapshot (§2.5) shows in the Businesses drawer too. Same testids, same text, same "Capabilities in force (N of M)" line, still no `<details>` inside the snapshot (users `source.guard:186-191`). **A recorded cross-page visual effect, no code edit in `users/`** (Q-4) |
| `app/admin/users/__tests__/businessDetail.render`, `businessOsPanel.render`; `app/api/admin/business-os/entitlements/__tests__/routes.test.ts:717-728` | The recorded fixtures under `__tests__/__fixtures__/` | Fixtures unchanged |
| Health (`lib/admin/health/evaluateHealth.ts:725`, `health.render.test.tsx:108`, `:184`; `health.qa-slice5.render.test.tsx:112`) | The link `/admin/business-os-tiers` | Unchanged: no params, no anchor needed |
| `app/admin/finance/financeCopy.ts:78` | `PLANS_PAGE` constant | Unchanged |
| `AdminSidebar.tsx:143` and `nav.test.ts` | The sidebar entry "Plans & entitlements" | Not touched (§3 rule 9) |

### 1.4 Tests that pin the page

| Test | Pins | L-5 impact |
|---|---|---|
| `source.guard` "imports nothing from outside the screen" (`:57-82`) | Every non-test file: `@/` imports only inside `app/admin/business-os-tiers`; packages allowed | **Gains the one alias line** (§5). `next/link` is a package and already passes |
| `source.guard` "finds the page and its components" (`:50-55`) | `page.tsx`, `EnforcementBanner.tsx`, `types.ts` exist; at least 6 files | Stays green (8 files after L-5) |
| `source.guard` "writes down no plan id, price or capability id" (`:101-111`) | No plan names, no `$79` / `$129`, no quoted tier names, no quoted capability prefixes, in code (comments stripped) | Stays green; the new files carry no such literal (§2.8) |
| `source.guard` console / `any` / guard / no-write rules | — | Stay green; `PlansKpis.tsx` has no fetch |
| `page.render` "has no control that submits a change" (`:317-325`) | Every button's text must not match the words save, assign, apply, reset, launch, grant, revoke (case-insensitive) | Stays green: the buttons after L-5 are "Refresh" (text; its name "Refresh the plans" is an aria-label and the test reads `textContent`), "Try again" (error only), "Look up" / "Reading…", "Withholds (N)". No Clear (no filters) and no Apply (no Custom date). KPI tiles are links or groups, never buttons (K-6) |
| `page.render` other cases | Banner words, card flags, INACTIVE badge `title` and `border-dashed`, `no-gate-*`, the lookup's "not an email" note and link, cannot-be-sold list, the write-ops list, `page-error` | Stay green with no edit (§3.3 keeps every testid, `title` and word) |
| `payload.contract` | Renders the page against the real `buildAdminPlansView` payload; fixture keys | Stays green with no edit |
| `accountLookup.contract` | Renders `AccountLookup` against the two recorded bodies; every GET error code shows a sentence, not the code | Stays green with no edit; stub responses carry `ok`, `status`, `json` (all `readAdminResponse` reads, RC-2) |
| `nav.test` | Sidebar entry, onboarding untouched | No edit |

---

## 2. Scope and decisions

### 2.1 In L-5

| # | Change | Standard |
|---|---|---|
| 1 | Header → `AdminPageHeader`: title "Plans & entitlements", one-sentence purpose (§2.4), `badge={{ label: 'Read-only', testId: 'read-only-badge' }}`, `asOf` = "As of {formatUtc(generatedAt)}." when a payload is loaded | §5.3, D-3 (a), F-36 |
| 2 | `components/PlansKpis.tsx`: four tiles from the payload (§2.2) | §7.8, K-1 to K-10 |
| 3 | Refresh → `AdminFilterBar` with only `onRefresh`, `busy`, `what="the plans"` (plain `<div>`, no Read at, because the header shows the server "As of") | §5.5 part 6; L-3 Q-7 precedent |
| 4 | States: first load → `AdminLoading what="the plans"` in the content area; error → `AdminError testId="page-error" onRetry={load}`; refresh keeps the content mounted with `aria-busy` on the content wrapper; a failed refresh keeps the stale content (existing choice, pinned) | §5.10, §5.5 |
| 5 | Plans read via `readAdminResponse<PlansPayload>(response, { what: 'the plans', sessionEndedCopy: true })`; a rejected fetch → `ADMIN_NETWORK_ERROR` | F-37, §5.10, RC-4 (every migrated page opts in) |
| 6 | `AccountLookup` read via `readAdminResponse<AccountPayload>(response, { what: 'that account', sessionEndedCopy: true })`; the message then goes through `ENTITLEMENT_ERROR_COPY[message] ?? message`; a rejected fetch → `ADMIN_NETWORK_ERROR`; the error renders as `AdminError testId="account-error"` (no retry) | F-37, §5.10 |
| 7 | `AccountLookup`: `<a href="/admin/users">` → `next/link` `Link` (same href, same words) | F-39, link half (Q-5) |
| 8 | `AccountLookup` input on `ADMIN_FIELD_CONTROL` tokens plus `font-mono` and its width; "Look up" on `ADMIN_BUTTON` (was blue `bg-blue-600`, T-7) | §5.5 field style, T-7 |
| 9 | Plan-card pills → `StatusChip` (§2.3); "Free" and the include `Check` lose their green (Q-3) | §5.9, T-6 |
| 10 | Cards (`PlanCard`, `NotBuiltPanel`, `AccountLookup`, the no-gate summary, "Changing any of this") take the §5.7 card shell `rounded-xl border border-slate-700 bg-slate-800/40 p-4` and `text-slate-400` for every information line (T-5) | §5.7, T-5 |
| 11 | `EntitlementSnapshot`: the table on the `adminTable` constants with `aria-label="Capabilities in force"` and `scope="col"`; `dt` labels `text-slate-400`; "Tier ends" / "Cohort ends" through `formatUtc` when set, "no end date" when null | §5.7, §5.11, T-5 |
| 12 | Anchor ids for the tiles: `id="enforcement"` on the banner's `<section>`, `id="plans"`, `id="withheld-without-gate"`, `id="not-built"` | K-6 |
| 13 | `source.guard` alias line; `MIGRATED_PAGES` entry | §5 |

### 2.2 Decision: the KPI strip (§7.8, K-1 to K-10)

Four tiles, all **same-page anchor tiles** (`href="#…"`, K-6), test ids `kpi-*` (L-3 SA M-1), every value from the one plans payload (K-9). The strip shows placeholders while the first read is pending and is hidden while the page shows an error (K-10).

| Tile (label) | Value | Sub-line | Target | Colour |
|---|---|---|---|---|
| Enforcement | The mode in words: "Off" / "Shadow" / "Enforce" (the payload's `mode`, first letter capitalised) | "Not enforced" or "Enforced" (from `enforced`) | `#enforcement` (the banner) | **Neutral in both states** (recommended, Q-1) |
| Available to buy | `formatCount(plans.filter(p => p.availableToBuy).length)` | "of {N} plans" | `#plans` | Neutral |
| Withheld with no gate | `formatCount(withheldWithoutGate.length)` | none | `#withheld-without-gate`; **no target (a `div role="group"`) when the count is 0**, because the summary section is not rendered then | Neutral (D-4 (a)) |
| Cannot be sold | `formatCount(notBuilt.length)` | none | `#not-built` | Neutral (D-4 (a)) |

Why the Enforcement tile is neutral although §7.8 says "amber when not enforced, green when enforced" (Q-1):

- **Health already colours the same fact, and calls it neutral.** Health's "Entitlements mode" tile is amber only for "Enforcement requested but not active" (`lib/admin/health/rules.ts:263-271`); off and shadow are neutral. An amber "Needs a look" here for the normal production state (shadow) would contradict the landing page for the same mode, and the plans payload carries no "refused" flag that could reproduce Health's rule (K-5: no client copy of a server rule).
- **Green needs a shared export.** `KpiTileStatus` is `'red' | 'amber'`; the K-4 `green` status is still deferred. Building it here makes L-5 full cycle (R-7) for a label ("Healthy") that would be wrong for "Enforce".
- **The amber signal is not lost.** The banner, right below the strip and the tile's own anchor target, keeps its amber / emerald tones and its words, unchanged.

Why "Available to buy" rather than §7.8's "Plans on sale" (active **and** available to buy) (Q-2): `active` is an FYI-only marker that "changes nothing about the plan or the accounts on it" (`PlanCard.tsx:103-110`, `types.ts:31`). Combining it with `availableToBuy` would be a definition of "on sale" that no server code holds. The tile counts the one flag the cards already show as a chip with the same words, so tile and chips cannot disagree.

### 2.3 Decision: pill → chip mapping (§5.9; keeps every existing colour meaning)

Each pill keeps its testid, words and `title` by sitting in a wrapper `<span data-testid=… title=…>` around the `StatusChip` (`StatusChip` takes no `title` prop; adding one would be a shared export, R-7). The wrapper's `textContent` is exactly the words, because the chip's icon adds no text.

| Pill (testid) | Words (unchanged) | Tone | Today |
|---|---|---|---|
| kind (no testid) | "tier" / "cohort" | `neutral` / `neutral` | blue / slate. A category, not a status; T-7 forbids a per-page blue accent |
| `plan-{id}-shown` | "shown to customers" / "not shown to customers" | `info` / `neutral` | sky / slate |
| `plan-{id}-buyable` | "available to buy" / "not available to buy" | `ok` / `warn` | emerald / amber |
| `plan-{id}-active` | "active" / "INACTIVE"; `title` "FYI only: …" kept on the wrapper | `neutral` / `warn` (SA M-1; was `danger` in the first draft: an inactive plan is neither "needs action" nor "failed", and its own tooltip says the marker changes nothing) | slate / rose bold |
| `no-gate-{capability}` | "no gate yet"; `title` kept on the wrapper | `warn` | amber |

Not chips (ids, not states; Q-6): the no-gate summary's capability id list and the "Changing any of this" write-operation list stay as monospace id pills. The no-gate pills keep amber because the heading above them states the condition; the write-ops pills stay slate.

### 2.4 Decision: header copy

- **h1:** "Plans & entitlements" (D-3 (a)).
- **Purpose (one sentence, §5.3):** "What each Business OS plan includes and what cannot be sold, read from the configuration the resolver uses; not the agent platform's free tier, which is on the Onboarding page." The separation note is kept (the user asked for this page so the two products are not confused, `nav.test.ts:1-8`), folded into the one sentence.
- **Badge:** "Read-only" as the neutral chip (§5.3; L-3 `badge` prop).
- **As of:** "As of {YYYY-MM-DD HH:mm} UTC." from `generatedAt` (server clock), so the bar has no "Read at" (one clock; L-3 Q-7).

### 2.5 Decision: the shared `EntitlementSnapshot` (Q-4)

The snapshot is this folder's component, and the Businesses drawer renders it on purpose ("the SAME rendering, not a second one that could drift", `EntitlementSnapshot.tsx:7-9`). Restyling it here restyles it there too. Businesses is already migrated (L-4), so the drawer gains the standard table it should have. No edit in `app/admin/users/`; its suites run in V-1 and in `test:bos-entitlements`. Recorded in the PR as a cross-page visual effect of a file in this page's folder (§3 rule 1 is about which files change, and all changed files are in this folder plus the two guard edits).

### 2.6 Decision: what stays as it is

| Item | Why |
|---|---|
| `EnforcementBanner` words, tones and no-dismiss construction | Brief; §7.8. Only `id="enforcement"` is added to its `<section>` (the tile's anchor). Its emerald when enforced is a state, not decoration (T-6), and is the existing signal |
| The banner is the first thing in the **content** area | §5.1 region order puts header → KPI strip → bar before content, so the strip and Refresh now sit above it. The page comment "First, above everything" becomes "first in the content". The Enforcement tile links straight to it |
| `AccountLookup` stays a pasted-id field | §7.8; the picker is F-39 and the user's (§11). The recorded SA note explains the id-only design (a plans screen should not become a way to look people up) |
| Plan grid `md:grid-cols-2 xl:grid-cols-4` | §5.7 suggests `xl:grid-cols-3`; four plans in three columns leaves one orphan card. Recorded deviation (Q-7) |
| "The four plans" heading, every banner and panel sentence, `writeOpsNotOnThisPage` list | Copy, not layout |
| `NotBuiltPanel` `Ban` icon (rose) and category pill (slate) | Decorative icon beside the heading words; a category label |
| F-38 (fetch without `cache: 'no-store'`) | Open, a data item; not a layout change. The fetch keeps exactly its one argument |
| Unknown account error codes | Today "Could not read that account ({code})."; after L-5 the route's string verbatim (§5.10 rule 1). The contract test proves every code the GET handler can return has a sentence, so only a code added later without copy would show; that test would fail first |

### 2.7 Visible changes on `/admin/business-os-tiers` (named in the PR)

1. h1 "Business OS Tiers" → "Plans & entitlements"; one-sentence purpose; "Read-only" is the neutral chip; an "As of … UTC." line.
2. A four-tile strip above the content; each tile jumps to its section.
3. Refresh moves from the header to the Refresh-only bar (style A, name "Refresh the plans", spins and `aria-busy` while reading).
4. Loading shows the spinner line "Reading the plans…"; an error is the standard red box with "Try again".
5. A non-JSON answer reads "Could not read the plans. Try again in a moment." (page) / "Could not read that account. Try again in a moment." (lookup) instead of a parser message; a network failure reads "Could not reach the server. Check your connection and try again."; a 401 / 403 reads "Your admin session has ended. Sign in again."
6. Plan-card pills become chips with icons; "tier" is slate instead of blue; "Free" and the include ticks are no longer green (SA Q-3); the INACTIVE chip and the inactive card's dashed border are amber instead of rose (SA M-1; the word, the dashes and the dimming stay).
7. Card corners `rounded-xl`; grey information text lifted from slate-500 to slate-400.
8. The lookup's "Look up" button is the standard admin button, not blue; the Businesses link navigates client-side.
9. The account result's table has the standard density and header style; set end dates show as "YYYY-MM-DD HH:mm UTC". The same table shows in the Businesses drawer.

### 2.8 Entitlements registration rules (skill `business-os-entitlements`)

| Tripwire | L-5 |
|---|---|
| Import from `lib/business-os/entitlements/**` in product code (type-only included) | **None added.** No file in `app/admin/business-os-tiers` imports the module today (`page.tsx:20-26`), and none will. `payload.contract` and `accountLookup.contract` already import it, and tests are exempt. The shared folder never imports it (S-4) |
| Capability id or tier name as a string literal | **None added.** `PlansKpis.tsx` reads counts and flags, never names. The `source.guard` literal rule and `tierLiteral.forbidden` / `enforcementPoints` scans run in V-1 / V-3 |
| Catalog, tier matrix, cohorts, gates | Not touched |
| Definition of done | `npm run test:bos-entitlements` on the final diff (V-3). It does **not** run this page's own tests, but it does run `app/admin/users/__tests__` (the snapshot's other consumer), the entitlements route tests (which pin the shared fixtures), and the repo-wide literal and importer scans, which do cover this folder |

---

## 3. Implementation Approach

### 3.1 Shared folder (`app/admin/components/layout/`)

No source change. Only `__tests__/layoutFolder.guard.test.ts` gains the `MIGRATED_PAGES` entry and an "Amended by L-5" header note (§5).

### 3.2 Page folder (`app/admin/business-os-tiers/`)

| File | Change |
|---|---|
| `page.tsx` | Imports from the shared folder through the alias only. `load`: `fetch` (one argument, unchanged) inside `try`; `catch` → `ADMIN_NETWORK_ERROR`; otherwise `readAdminResponse`; ok → `setPayload`, else `setError(result.message)`; `payload` not cleared on failure (existing). Render order: `AdminPageHeader` → `PlansKpis` (placeholders while `loading && !payload`, hidden while `error`) → `AdminFilterBar` (Refresh only) → content wrapper `div` with `aria-busy={loading && payload !== null}`: `AdminError` / `AdminLoading` / the existing sections. Section ids per §2.1 row 12. Comment block updated (the h1 and "first, above everything" sentences; the "imports nothing from the entitlements module" paragraph stays and gains "and the shared admin layout folder, which may not import it either (S-4)") |
| `components/PlansKpis.tsx` (new) | `'use client'`; `PlansKpis({ payload, loading })` → `KpiStrip` + four `KpiTile`s per §2.2; imports `KpiStrip`, `KpiTile`, `formatCount` from the alias and the `PlansPayload` type from `../types`. No fetch, no literal plan or capability names |
| `components/EnforcementBanner.tsx` | `id="enforcement"` on the `<section>`; `text-…/70` lines untouched. Nothing else |
| `components/PlanCard.tsx` | Card shell `rounded-xl`; the inactive card becomes `border-dashed border-amber-500/60 opacity-70` (was `border-rose-500/60`), so the border agrees with the `warn` chip (SA M-1); pills → wrapper span + `StatusChip` per §2.3; plan id and `dt` → `text-slate-400`; "Free" → `text-white` and `Check` → `text-slate-300` (Q-3); the Withholds disclosure button gains the A-1 focus ring |
| `components/NotBuiltPanel.tsx` | `id="not-built"` on the section; card shell `rounded-xl`; capability id `text-slate-400` |
| `components/AccountLookup.tsx` | `readAdminResponse` + `ADMIN_NETWORK_ERROR` + code mapping (§2.1 row 6); `Link`; input and button classes; `AdminError testId="account-error"`; card shell `rounded-xl`; note `text-slate-400` |
| `components/EntitlementSnapshot.tsx` | Table on `ADMIN_TABLE_WRAP` / `ADMIN_TABLE` (+ `aria-label`) / `ADMIN_THEAD` / `ADMIN_TH` (+ `scope="col"`) / `ADMIN_TBODY` / `ADMIN_TD` (capability and layer cells add `font-mono`); `dt` `text-slate-400`; expiry via `formatUtc`; the "good for N seconds" line `text-slate-400`. Testid `account-result`, the h3 words and `ENTITLEMENT_ERROR_COPY` unchanged; no `<details>` |
| `types.ts` | No change |

### 3.3 Kept identical (so the existing suites need no edit)

Testids `page-error`, `enforcement-banner`, `enforcement-mode`, `no-gate-summary`, `plan-{id}`, `plan-{id}-shown` / `-buyable` / `-active` / `-credits` / `-ends` / `-withholds`, `no-gate-{capability}`, `not-built-panel`, `not-built-{capability}`, `account-lookup`, `account-error`, `account-result`; every visible word the suites match; the INACTIVE `title`; `border-dashed` on an inactive card; the lookup's `aria-label="Account id"` and its "Look up" text; the one-argument plans `fetch`.

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/admin/business-os-tiers/page.tsx` | modify | Header, strip, bar, states, `readAdminResponse`, anchors |
| `app/admin/business-os-tiers/components/PlansKpis.tsx` | create | §2.2 |
| `app/admin/business-os-tiers/components/PlanCard.tsx` | modify | Chips, card shell, T-5 / T-6 |
| `app/admin/business-os-tiers/components/NotBuiltPanel.tsx` | modify | Anchor, card shell, T-5 |
| `app/admin/business-os-tiers/components/EnforcementBanner.tsx` | modify | `id="enforcement"` only |
| `app/admin/business-os-tiers/components/AccountLookup.tsx` | modify | F-37, `Link`, field and button classes, states |
| `app/admin/business-os-tiers/components/EntitlementSnapshot.tsx` | modify | Table constants, T-5, §5.11 |
| `app/admin/business-os-tiers/__tests__/source.guard.test.ts` | modify | Alias line (+ Q-8 negative control) |
| `app/admin/business-os-tiers/__tests__/page.render.test.tsx` | modify | New cases appended (§6.1); no existing case edited |
| `app/admin/business-os-tiers/__tests__/accountLookup.render.test.tsx` | create | Lookup states, link, snapshot table (§6.1) |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | modify | Registry entry |
| `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md` | modify | §1 row 10, §7.8 as built, §9 F-36 / F-37 / F-39, Change History (after code) |
| `docs/workplans/ADMIN_LAYOUT_L5_WORKPLAN.md` | create | This file |

No file outside `app/admin/business-os-tiers/` changes except the registry test and the docs. No change in `lib/business-os/entitlements/`, its `__tests__`, `app/admin/users/`, the routes, the sidebar or the layout.

---

## 5. Guard and registry changes

| Guard | Edit | Why |
|---|---|---|
| `business-os-tiers/__tests__/source.guard.test.ts` `:71-79` (the `escaping` filter) | **One line** before the `@/` check: `if (specifier.startsWith('@/app/admin/components/layout/')) return false;` | SA Q-3 |
| Same file, negative control `:84-99` | Recommended (Q-8): lift the inline filter into a named `escapes(relative, specifier)` with the same body, used by the `it.each` (behaviour identical), and add three assertions as L-3 did (SA M-5): `escapes(page, '@/app/admin/components/layout/StatusChip')` → `false`; `escapes(page, '@/app/admin/components/AdminHeader')` → `true` (a sibling of the shared folder); `escapes(page, '../components/layout/StatusChip')` → `true` (the relative spelling, S-1). Minimal alternative: the alias line only, plus one assertion on the relative spelling through the existing `resolve` helper | Proves the alias opens exactly the shared folder |
| Same file, every other rule | **No edit**: file count, no plan id / price / capability literal, no `console.*`, no `any`, no own guard, no admin decision, no writing method | — |
| `layoutFolder.guard.test.ts` `MIGRATED_PAGES` | Add `/admin/business-os-tiers (Plans & entitlements)`: `page.tsx`, `components/PlansKpis.tsx`, `components/AccountLookup.tsx`, `components/EntitlementSnapshot.tsx`, `components/PlanCard.tsx`, `components/NotBuiltPanel.tsx`, `components/EnforcementBanner.tsx`. `types.ts` is not listed (untouched, no markup) | Registry: header import, no own h1, no `.json(`, alias only |
| `layoutFolder.guard.test.ts` part (a) | **No edit.** No shared source changes | S-1 to S-10 |
| `nav.test.ts`, `AdminSidebar.nav.test.ts`, Health link tests | **No edit** | §3 rule 9 |

---

## 6. Tests

### 6.1 New

Fixtures use the invented ids, names and prices the render suite already uses (`paid-plan`, "Fixture Paid Plan", 42), never real ones (FR-12, the literal rule).

| Id | File | Asserts |
|---|---|---|
| T-1 | `page.render` | Header: exactly one h1, "Plans & entitlements"; no "Business OS Tiers" text; `read-only-badge` has `data-tone="neutral"` and the words "Read-only"; the purpose mentions the Onboarding page; "As of 2026-09-24 09:00 UTC." from the fixture's `generatedAt` |
| T-2 | `page.render` | Strip: tiles `kpi-enforcement`, `kpi-available`, `kpi-no-gate`, `kpi-not-built`; values "Off" / "0" / "1" / "1" for the base fixture (its plan has `availableToBuy: false`, SA M-2), sub-lines "Not enforced" and "of 1 plan" (singular for one, per Q-9; a two-plan fixture reads "of 2 plans"); hrefs `#enforcement`, `#plans`, `#withheld-without-gate`, `#not-built`, and an element with each id exists |
| T-3 | `page.render` | Colour: every tile `data-status="neutral"` with `enforced: false` **and** with `enforced: true` (Q-1); K-7 name "Enforcement, Off" |
| T-4 | `page.render` | `withheldWithoutGate: []` → `kpi-no-gate` is a `role="group"` with no `href` and value "0"; `availableToBuy: true` on one plan → "1" |
| T-5 | `page.render` | K-10: while the first fetch is pending, `kpi-placeholder` elements and no tiles; on a first-load error, no strip and no placeholders |
| T-6 | `page.render` | States: a body whose `json()` throws `SyntaxError` → `page-error` text exactly "Could not read the plans. Try again in a moment.", and no "Unexpected token" anywhere; a rejected `fetch` → exactly `ADMIN_NETWORK_ERROR`; a 401 → exactly the session-ended sentence; "Try again" re-fetches (2 calls) and renders the banner |
| T-7 | `page.render` | Refresh: the button's name is "Refresh the plans"; while a second read is pending it has `aria-busy="true"`, the banner stays mounted and the content wrapper has `aria-busy="true"`; a failed refresh shows `page-error` **and** keeps `plan-paid-plan` on screen (existing choice, pinned) and hides the strip |
| T-8 | `page.render` | Chips: `plan-paid-plan-shown` contains a `data-tone="info"` chip, `-buyable` `warn` (fixture `availableToBuy: false`), `-active` `neutral`; an inactive plan's `-active` is `warn` (SA M-1) and the wrapper keeps the FYI `title`; `no-gate-chat.access` is `warn`; each wrapper's `textContent` is exactly its words |
| T-9 | `page.render` | Order: the strip and the Refresh button precede the banner in document order; exactly one `role="alert"` on a first-load error |
| T-10 | `accountLookup.render` (new) | A lookup whose body `json()` throws → `account-error` exactly "Could not read that account. Try again in a moment."; a rejected `fetch` → `ADMIN_NETWORK_ERROR`; a 403 `{ error: 'Forbidden' }` → the session-ended sentence; a 404 `not_a_business_os_account` → its `ENTITLEMENT_ERROR_COPY` sentence (the mapping still runs after the helper) |
| T-11 | `accountLookup.render` | The Businesses link: `getByRole('link', { name: /Businesses/ })` has `href="/admin/users"`, and `AccountLookup.tsx` code imports `Link` from `next/link` with no `<a ` left (a source read, comments stripped) |
| T-12 | `accountLookup.render` | Snapshot table (recorded tier body): `getByRole('table', { name: 'Capabilities in force' })`; every `th` has `scope="col"` and the `ADMIN_TH` classes; a body with `tier_expires_at: '2026-12-31T23:30:00.000Z'` shows "2026-12-31 23:30 UTC", and null still shows "no end date" |

### 6.2 Edited deliberately (each named in the PR)

| Test | Edit | Reason |
|---|---|---|
| `source.guard` | The one alias line (+ the Q-8 negative control) | §5 |
| `layoutFolder.guard` | Registry entry + "Amended by L-5" note; no rule change | §5 |
| `page.render` | Cases T-1 to T-9 appended; **no existing case edited** | §6.1 |

### 6.3 Must stay green with no edit

Every existing case in `page.render` (including "has no control that submits a change" and "says so instead of rendering an empty page"), `payload.contract`, `accountLookup.contract`, `nav.test`, every other `source.guard` case; `app/admin/users/__tests__/**` (the snapshot's other consumer); `app/api/admin/business-os/entitlements/__tests__/routes.test.ts` (shared fixtures); the Health suites that link here; every consumer suite of the shared parts L-5 uses.

---

## 7. Verification

| # | Check | Expected |
|---|---|---|
| V-1 | `npx jest app/admin/business-os-tiers app/admin/components/layout app/admin/users app/admin/__tests__ app/admin/components/__tests__ app/api/admin/business-os/entitlements --ci` | All green; counts recorded |
| V-2 | `npx jest lib/business-os/entitlements/__tests__/enforcementPoints.test.ts lib/business-os/entitlements/__tests__/tierLiteral.forbidden.test.ts --ci` (fast first look; V-3 runs them again) | Green: no new importer, no new literal |
| V-3 | `npm run test:bos-entitlements` on the final diff | Green; result recorded (skill definition of done) |
| V-4 | Scoped `tsc`: scratch tsconfig in the session scratchpad (never committed), `extends` the worktree `tsconfig.json`, `incremental: false`; includes `next-env.d.ts`, `app/admin/business-os-tiers/**`, `app/admin/components/layout/**`, `app/admin/users/components/BusinessOsPanel.tsx`. **Run 1** with a canary `const canary: number = 'x';` in `PlansKpis.tsx` → exactly that TS2322. **Run 2** without it → zero errors | Both runs recorded |
| V-5 | `npm run lint:hooks`; `npx eslint` on the touched files | Clean |
| V-6 | Mutation checks (each reverted, md5 compared): (a) drop the alias line → `source.guard` fails on `page.tsx`; (b) call `response.json()` in `AccountLookup.tsx` → T-10 and the registry `.json(` rule fail; (c) `sessionEndedCopy: false` on the page → T-6 fails; (d) give the Enforcement tile `status: 'amber'` when not enforced → T-3 fails; (e) clear `payload` on a failed refresh → T-7 fails; (f) map `no-gate` to `neutral` → T-8 fails; (g) put back `<h1>Business OS Tiers` → T-1 and the registry h1 rule fail; (h) add a button labelled "Apply" → "has no control that submits a change" fails; (i) write a quoted tier name in `PlansKpis.tsx` → the `source.guard` literal rule and `tierLiteral.forbidden` fail; (j) drop `id="not-built"` → T-2 fails; (k) map INACTIVE to `danger` → T-8 fails (SA M-1) | Each fails as stated |
| V-7 | `grep` the folder for `.json(`, `err.message`, `text-slate-500`, `bg-blue-600`, `text-emerald-400`, `<a ` | None (the banner's emerald tone object is the one recorded exception, §2.6) |
| V-8 | `git diff --stat` before reading the diff (truncation hazard) | Insertions and deletions match the plan; no file emptied |

### 7.1 Browser checks for TL / QA (signed-in admin, DevTools Network open, light and dark OS scheme emulation)

| # | Check |
|---|---|
| P-B1 | `/admin/business-os-tiers` loads with one `GET …/entitlements/plans`; header "Plans & entitlements", the Read-only chip, the purpose, "As of … UTC."; no shell title |
| P-B2 | Four tiles; Enforcement says "Shadow" / "Not enforced" (prod today) with no status row; Available to buy matches the cards' "available to buy" chips; Withheld with no gate matches the summary list; Cannot be sold matches the panel; each tile jumps to its section; Tab order header → tiles → Refresh → content |
| P-B3 | Refresh: spinner, `aria-busy`, the cards stay, one new GET, "As of" updates |
| P-B4 | Plan cards: chips with icons and the same words; INACTIVE (if any plan is) still dashed and dimmed with the FYI tooltip; Withholds opens and shows "no gate yet" chips |
| P-B5 | Account lookup: paste a known Business OS account id → the result with the standard table; an agent-platform-only id → the "not a Business OS account" sentence; the Businesses link opens `/admin/users` without a full reload |
| P-B6 | Open the same account's drawer on `/admin/users`: the plan block shows the same restyled table (§2.5) |
| P-B7 | Offline (DevTools) then Refresh: "Could not reach the server…" with Try again; the stale cards stay; the strip hides; back online + Try again restores it |
| P-B8 | The banner is still the first thing in the content, still undismissible, amber in shadow |

---

## 8. Task List

- [x] 1. SA workplan review; apply any must-fix to this file before coding ✅ (M-1, M-2 and the S-1 citations applied)
- [x] 2. `source.guard` alias line (+ Q-8 negative control) ✅
- [x] 3. `PlansKpis.tsx` + T-2 to T-5 ✅
- [x] 4. `page.tsx`: header, strip, bar, states, `readAdminResponse`, anchors, comment block; T-1, T-6, T-7, T-9 ✅
- [x] 5. `PlanCard.tsx`, `NotBuiltPanel.tsx`, `EnforcementBanner.tsx` (id); T-8 ✅
- [x] 6. `AccountLookup.tsx`, `EntitlementSnapshot.tsx`; `accountLookup.render` T-10 to T-12 ✅
- [x] 7. `MIGRATED_PAGES` entry ✅
- [x] 8. V-1 to V-8; record results in Implementation Notes ✅
- [x] 9. Requirement: §1 row 10, §7.8 as built (tile decisions per SA), §9 F-36 / F-37 done, F-39 link half, Change History ✅
- [x] 10. Hand to SA code review + QA (nothing committed by Dev) ✅ (handed back to TL 2026-10-11)

---

## 9. Sizing

| Part | Days |
|---|---|
| Guard edits (steps 2, 7) | 0.1 |
| Strip + page (steps 3-4) | 0.5 |
| Cards and chips (step 5) | 0.25 |
| Lookup + snapshot (step 6) | 0.25 |
| Tests (T-1 to T-12) | 0.5 |
| Verification and docs (steps 8-9) | 0.25 |
| **Total** | **about 2 days** |

One slice; under the "a few days" limit, no split.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| A new word on a button trips the "no submit control" rule | The only new button is the error box's "Try again"; Refresh's visible text stays "Refresh"; mutation (h) proves the rule still bites |
| A literal tier name or capability id slips into `PlansKpis.tsx` (the required entitlements scans and this page's literal rule) | The tile reads counts and booleans only; V-2, V-3 and mutation (i) |
| Restyling `EntitlementSnapshot` breaks the Businesses drawer suites | Testids, words and structure kept (§3.3); `app/admin/users` in V-1 and in V-3; P-B6 |
| `readAdminResponse` maps an account-route code to a different sentence than today | The helper returns the route's string verbatim; the page maps it through the same `ENTITLEMENT_ERROR_COPY`; `accountLookup.contract` (every code) and T-10 |
| Adding a second argument to the plans `fetch` | The call stays `fetch('/api/admin/business-os/entitlements/plans')` (F-38 stays open) |
| The wrapper span around a chip changes a pinned `textContent` | Icons are `aria-hidden` and add no text; T-8 pins exact words; the existing "active" `^active$` match stays |
| Moving the banner below the strip reads as demoting it | It stays first in the content, keeps every word and tone, and the first tile links to it (§2.6, P-B8) |

---

## 11. Out of scope and found on the way

- **F-39, picker half (the user's):** finding an account by business name instead of a pasted id. Adopting `AdminBusinessPicker` would add a second read (`/llm-usage/businesses`) to this page and reverse a recorded SA design note (the plans screen is deliberately not a people search). Left for the user (§12, product question).
- **F-38** (no `cache: 'no-store'`): open, a data item.
- The emerald tone in `EnforcementBanner` when enforced: kept, a state (§2.6).
- Found on the way: **Health colours shadow mode neutral** while §7.8 planned an amber tile here for the same mode (§2.2, Q-1). Recorded so §7.8 is corrected whichever way SA rules.

---

## 12. Questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| Q-1 | Enforcement tile colour: (a) neutral in every mode; (b) §7.8 as written, amber when not enforced and green when enforced (builds the K-4 `green` status, full cycle); (c) amber when not enforced, neutral when enforced? | **(a).** Health's own tile for the same fact is neutral in off and shadow (amber only when enforcement is refused, a flag this payload lacks); a permanent "Needs a look" for the normal production state contradicts it; (b) adds a shared export with a "Healthy" label that is wrong for "Enforce". The banner keeps the amber / emerald signal |
| Q-2 | Second tile: "Available to buy" (`availableToBuy` only) instead of §7.8's "Plans on sale" (active and available to buy)? | Yes. `active` is FYI only and changes nothing; combining it invents a rule no server holds; the tile then matches the cards' own chip words |
| Q-3 | T-6: "Free" (emerald text) and the include `Check` icons (emerald) lose their green? | Yes for both: neither is a proven-clear or succeeded state. The "available to buy" chip keeps green as the `ok` tone (a yes-state the card already showed in emerald) |
| Q-4 | Restyle `EntitlementSnapshot` here, accepting the same change in the Businesses drawer (no `users/` edit)? | Yes. It is one shared rendering by design, Businesses is already migrated, and the alternative leaves a non-standard table on two pages |
| Q-5 | `<a href="/admin/users">` → `next/link` in this slice (F-39's link half), while the picker half stays with the user? | Yes. Same href and words; client-side navigation is the standard for in-admin links |
| Q-6 | The no-gate id list (amber) and the write-ops id list (slate) stay as monospace id pills, not `StatusChip`s? | Yes. They are lists of ids; the condition is stated once in each heading |
| Q-7 | Keep the plan grid at `xl:grid-cols-4` (four plans), not §5.7's `xl:grid-cols-3`? | Yes; recorded deviation (no orphan card) |
| Q-8 | `source.guard`: lift the inline import filter into a named `escapes()` (same body) so the negative control can assert the three L-3 cases, or keep strictly the one alias line? | Lift it. It is a behaviour-identical refactor of the test, and mutation (a) proves the `it.each` still fails on an escaping import |
| Q-9 | The Available to buy sub-line: "of {N} plans" always, or "of 1 plan" for one? | "of {N} plans" with the plural chosen by count (`plan` / `plans`); the real payload has four |
| Q-10 | `sessionEndedCopy: true` on both reads (a 401 / 403 says the session ended instead of "Unauthorized" / "Could not read that account (Unauthorized).")? | Yes; every migrated page opts in (RC-4) |
| Q-11 | Path: UI short path (no shared export) under the user's fast-track? | Yes, unless Q-1 is ruled (b) |

---

## Implementation Notes

**Dev, 2026-10-11.** Built on `feature/admin-layout-l5`, nothing committed. SA M-1 and M-2 applied to this file before the first code edit, together with the S-1 line citations (§1.1).

### Files

| File | Change |
|---|---|
| `app/admin/business-os-tiers/page.tsx` | `AdminPageHeader` (title, purpose, `read-only-badge`, "As of" from `generatedAt`); `PlansKpis`; Refresh-only `AdminFilterBar`; `AdminError` (`page-error`, Try again) and `AdminLoading` ("Reading the plans…"); the read through `readAdminResponse` (`sessionEndedCopy: true`), a rejected fetch → `ADMIN_NETWORK_ERROR`, `payload` kept on failure; content wrapper `plans-content` with `aria-busy`; ids `withheld-without-gate`, `plans`; §5.7 card shell on the no-gate summary and "Changing any of this"; matrix line slate-400; comment block updated |
| `components/PlansKpis.tsx` (new) | Four tiles per §2.2, all neutral; the no-gate tile is a group (no href) at 0 |
| `components/PlanCard.tsx` | Flags as `StatusChip`s in testid / title wrappers (kind neutral, shown info / neutral, buyable ok / warn, active neutral / **warn**, no-gate warn); inactive card `border-dashed border-amber-500/60 opacity-70`; `rounded-xl`; slate-400 id, labels and heading; "Free" white; ticks slate-300; A-1 focus ring on Withholds |
| `components/NotBuiltPanel.tsx` | `id="not-built"`, `rounded-xl`, capability id slate-400 |
| `components/EnforcementBanner.tsx` | `id="enforcement"` (with a comment); nothing else |
| `components/AccountLookup.tsx` | `readAdminResponse` (`what: 'that account'`, `sessionEndedCopy: true`), then `ENTITLEMENT_ERROR_COPY[message] ?? message`; `ADMIN_NETWORK_ERROR` on a rejected fetch; `next/link`; `ADMIN_FIELD_CONTROL` + `min-w-[22rem] flex-1 font-mono`; `ADMIN_BUTTON` + `flex items-center gap-2` (layout classes only, S-4); `AdminError testId="account-error"` (no retry); `rounded-xl`; note slate-400 |
| `components/EntitlementSnapshot.tsx` | `ADMIN_TABLE_WRAP` / `ADMIN_TABLE` (`aria-label="Capabilities in force"`) / `ADMIN_THEAD` / `ADMIN_TH` (`scope="col"`) / `ADMIN_TBODY` / `ADMIN_TD` (+ `font-mono` and colour on cells); labels slate-400; end dates via `formatUtc`, null → "no end date"; still no fold |
| `__tests__/source.guard.test.ts` | Filter lifted into `escapes(relative, specifier)` with the same body plus the alias line (trailing-slash prefix); new case with four negative controls (alias → false; `@/app/admin/components/AdminHeader` → true; `../components/layout/StatusChip` → true; `@/app/admin/components/layoutX/Foo` → true) |
| `__tests__/page.render.test.tsx` | Two imports added (`fireEvent`, `ADMIN_NETWORK_ERROR`); T-1 to T-9 and the S-2 case appended; no existing case edited |
| `__tests__/accountLookup.render.test.tsx` (new) | T-10 to T-12 |
| `app/admin/components/layout/__tests__/layoutFolder.guard.test.ts` | "Amended by L-5" header note; registry entry (seven files) |

### Verification (real output)

| # | Result |
|---|---|
| V-1 | `npx jest app/admin/business-os-tiers app/admin/components/layout app/admin/users app/admin/__tests__ app/api/admin/business-os/entitlements lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` → **51 suites, 1562 tests, all passed**. `app/admin/components/__tests__` separately → 4 suites, 60 tests passed. The tiers folder alone: 6 suites, 123 tests |
| V-2 / V-3 | `npm run test:bos-entitlements` → **239 suites, 6804 tests, all passed** (no new importer, no new literal) |
| V-4 | Scoped `tsc -p` scratch `tsconfig.l5.json` (session scratchpad; `extends` the worktree tsconfig, `noEmit`, `incremental: false`, `plugins: []`; `next-env.d.ts`, `app/admin/business-os-tiers/**`, `app/admin/components/layout/**`, `BusinessOsPanel.tsx`; `--listFilesOnly` confirmed all 8 page files and 4 test files are in scope). **Run 1** with `canary.ts` in the scratchpad only: exit 2, exactly one error, `canary.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` **Run 2** with the canary deleted: exit 0, no output |
| V-5 | `npm run lint:hooks` clean; `npx eslint` on the 12 touched / new code files: exit 0, no output |
| V-6 | All 11 mutations red, each restored with md5 equal before and after: (a) `source.guard` fails on page, PlansKpis, PlanCard, AccountLookup, EntitlementSnapshot and the new negative-control case; (b) T-10 non-JSON case + registry `.json(` rule on AccountLookup; (c) T-6 "a 401 says the session ended"; (d) T-2 and T-3; (e) T-7; (f) T-8 "maps each flag"; (g) T-1 + registry h1 rule on page.tsx; (h) the existing "has no control that submits a change" + both S-2 cases; (i) `source.guard` literal rule on PlansKpis + `tierLiteral.forbidden`; (j) T-2; (k) T-8 "INACTIVE is warn, not danger" |
| V-7 | The grep finds only `EnforcementBanner.tsx` `icon: 'text-emerald-400'` (the recorded banner tone exception, §2.6). No `.json(`, `err.message`, `text-slate-500`, `bg-blue-600` or `<a ` in the folder's code |
| V-8 | `git diff --stat`: 10 tracked files, 567 insertions, 160 deletions (incl. the requirement), plus two new code files and this workplan; no file emptied, no deletion-only file. Line endings kept (CRLF page files, LF guard and docs) |

### Deviations from the plan

| # | Deviation | Why |
|---|---|---|
| 1 | The content wrapper (`data-testid="plans-content"`, `aria-busy={loading}`) holds only the loaded sections and exists only with a payload; `AdminError` and `AdminLoading` sit just above it (the Archiving shape). §3.2 put them inside a wrapper with `aria-busy={loading && payload !== null}` | Same semantics, and it keeps the banner the first child of the content wrapper in every state, including a failed refresh (SA S-5) |
| 2 | The lookup's `AdminError` sits in a `div.mt-3` | Spacing only; `AdminError` takes no class |
| 3 | The Q-8 negative control is a new `it` rather than lines added to the existing "relative-import rule would actually catch one" case | Keeps every existing case unedited |
| 4 | Tests added beyond the plan: a plural sub-line case (Q-9), a buyable / hidden chip case, a lookup "shared alert, no Try again" case, the S-6 "no named section, no region" assertion inside T-9 | Each pins a ruling or a must-not that had no case |
| 5 | V-4 canary in a scratch file, not in `PlansKpis.tsx` | Per TL instruction: no worktree edit for the canary |

### Visible changes (for the PR)

§2.7 items 1 to 9 as written, with item 6 per SA M-1 (INACTIVE chip and the inactive card's dashes amber, not rose). The Businesses drawer shows the restyled snapshot table and UTC end dates too (§2.5, no `users/` edit).

### Out of scope, found on the way (listed, not fixed)

- SA N-3 confirmed: `source.guard`'s `@/` branch still compares with `@/${ROOT}` without a trailing slash, so a sibling folder named `business-os-tiers-x` would pass. Untouched (the `escapes()` body is the old body plus the alias line).
- `layoutFolder.guard` header has no "Amended by L-4a / L-4b" notes although those slices changed the registry; L-5's note is added after L-3's. Doc gap only.
- `AdminStates`' "Try again" still carries the `ADMIN_BUTTON` classes inline (known, L-1d SA Q-7).
- F-38 (no `cache: 'no-store'` on the plans fetch) stays open; the call keeps its one argument.

## SA Review Notes

## SA Workplan Review — 2026-10-11

**Reviewed by SA — 2026-10-11**
**Status:** ✅ Approved with conditions (M-1, M-2 applied to this file before coding; S-1 to S-7 checked at code review)
**Path:** UI short path under the user's fast-track (Dev → SA code review + QA → RM). No shared export is built (Q-1 ruled (a)), so R-7 does not trigger the full cycle.

### What SA verified in code (worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l5`, HEAD `0f02f80b`)

| Claim | Result |
|---|---|
| Health colours the entitlements mode amber only for "refused" (`lib/admin/health/rules.ts:263-271`) | ✅ One rule, `entitlements.refused`, flag `entitlementEnforceRefused`, amber. Off and shadow are neutral |
| The plans payload carries no "refused" fact | ✅ `adminPlansView.ts:219` sets `enforced: mode === 'enforce'`; `mode` and `enforced` can never disagree, so there is nothing in the payload to reproduce Health's rule from (K-5) |
| "No submit control" regex vs every button after L-5 | ✅ The loaded page has "Refresh" (textContent; the name "Refresh the plans" is an `aria-label` the test does not read), "Look up" / "Reading…", "Withholds (N)". The error state adds "Try again". None matches `/save|assign|apply|reset|launch|grant|revoke/i`. Tiles are `<a>` or `div role="group"`, never buttons (`KpiStrip.tsx:146-224`) |
| `source.guard` file count and required files | ✅ 7 files today (page, types, 5 components), 8 after `PlansKpis.tsx`; `page.tsx`, `EnforcementBanner.tsx`, `types.ts` stay; `>= 6` holds |
| `source.guard` alias line placement | ✅ Must sit before the `@/` branch at `:72`, which today refuses any `@/` outside the screen |
| Existing fetch stubs work with `readAdminResponse` | ✅ Stubs carry `ok` and `json` with `success: true` (`page.render:96-99`, `payload.contract:38-41`, `accountLookup.contract:75-80`); a missing `status` only means "not 401/403". The existing "payload cannot be read" case (`ok: false`, route error string) still shows the route string through rule 1 |
| `sessionEndedCopy` cannot swallow an account-route code | ✅ The GET handler answers 400 / 404 / 500 / 503 only (`accounts/[accountId]/route.ts`), never 401/403, so every code still reaches `ENTITLEMENT_ERROR_COPY`. `accountLookup.contract` (every code, 404/500) stays valid unedited |
| Shared fixtures | ✅ No fixture under `__tests__/__fixtures__/` and no `app/api/admin/business-os/entitlements/__tests__` file is edited by the plan |
| `EntitlementSnapshot` also renders in the Businesses drawer (Q-4) | ✅ `businessOsPanel.render.test.tsx:118`, `:156`, `:185`, `:216` read it by `account-result`, `Decided by` and "This answer is good for"; `users/__tests__/source.guard.test.ts:123-124`, `:184`, `:189-191` pin the import path, the `<EntitlementSnapshot` usage, its place inside `<details>`, and no `<details` / `Collapsible` inside the snapshot. The plan changes none of these |
| `StatusChip` takes no `title` | ✅ `StatusChipProps` is `tone`, `children`, `testId`. The wrapper span carrying `data-testid` and `title` is the right way to keep `page.render:126-128` (testid and `title` on the same element) without a shared export |
| Region order and the banner | ✅ §5.1 puts header → strip → bar before content. The banner keeps `role="note"`, has no dismiss path by construction, and is not a named `<section>` (adding `id` creates no landmark, S-8 / A-9) |
| Entitlements tripwires | ✅ No file in the folder imports `lib/business-os/entitlements/**` today, and the plan adds none. `PlansKpis` reads counts and booleans only; the mode is capitalised generically, not mapped from a literal table |
| No data / API / permission change | ✅ No route, request, payload, guard or write change; the plans `fetch` keeps its one argument (F-38 stays open) |

### Rulings on Q-1 to Q-11

| # | Ruling | Reason |
|---|---|---|
| Q-1 | **(a) Neutral in every mode.** Record it as a §7.8 deviation | K-5 (ii) permits amber from the banner but does not require it. A permanent "Needs a look" for the normal production state (shadow) contradicts Health's tile for the same fact, and the "refused" condition that Health colours is not in this payload (verified above). Green needs the K-4 `green` status, a shared export, and "Healthy" is the wrong word for "Enforce". The banner directly below keeps its amber / emerald signal |
| Q-2 | **"Available to buy" (`availableToBuy` only).** Record it as a §7.8 deviation | `active` is FYI only and changes nothing (`types.ts:31`); "active and buyable" is a rule no server code holds. The tile then counts exactly what the cards' chips say |
| Q-3 | **Yes: "Free" and the include ticks lose their green** | Neither is a succeeded / clear state (T-6). The "available to buy" chip keeps green as `ok`, a yes-state that was already emerald |
| Q-4 | **Yes: restyle `EntitlementSnapshot`; the Businesses drawer takes the same change; no edit in `app/admin/users/`** | One shared rendering by design (`EntitlementSnapshot.tsx:7-9`); every Businesses pin survives (verified above). Name it in the PR as a cross-page visual effect |
| Q-5 | **Yes: `next/link`** | Same href and words; the existing `page.render:289` link assertion still holds |
| Q-6 | **Yes: id lists stay monospace id pills** | They are identifiers, not states; each heading states the condition in words |
| Q-7 | **Yes: keep `xl:grid-cols-4`.** Recorded deviation from §5.7 | Four plans; three columns leave an orphan card |
| Q-8 | **Yes: lift the filter into a named `escapes(relative, specifier)` with the same body, plus the three negative-control assertions**, and add a fourth (S-3) | Behaviour-identical test refactor; it turns "no file happens to import X" into a proven rule. Mutation V-6 (a) proves the `it.each` still bites |
| Q-9 | **Plural by count: "of 1 plan" / "of N plans"** | Correct English; the real payload has four, fixtures have one |
| Q-10 | **Yes: `sessionEndedCopy: true` on both reads** | RC-4; the account route never answers 401/403 itself, so no route code is masked (verified above) |
| Q-11 | **UI short path under the fast-track** | No shared source changes; the only shared-folder edit is the registry entry (L-3 / L-4b precedent) |

### Additional ruling: the INACTIVE chip tone

**`warn`, not `danger`.** §5.9 defines `danger` as "Needs action / failed". An inactive plan is neither: its own tooltip says the marker "changes nothing about the plan or the accounts on it". A red chip with `AlertOctagon` would contradict the tooltip next to it. `neutral` would undo the user's 2026-09-29 ask that INACTIVE be unmistakable. `warn` ("needs a look") keeps it prominent without claiming failure; the upper-case word, the dashed border and the dimming stay. The card's dashed border follows the chip so the two agree (M-1). Not a product question: the words, the flag and the dashed / dimmed treatment the user asked for are all kept; only the tone family moves to the standard's meaning.

### Findings

**Must fix (apply to this workplan before coding)**

| # | Item |
|---|---|
| M-1 | §2.3: `plan-{id}-active` maps to `neutral` / **`warn`** (was `danger`). §3.2 `PlanCard.tsx`: the inactive card becomes `border-dashed border-amber-500/60 opacity-70` (was `border-rose-500/60`). T-8: an inactive plan's `-active` chip is `data-tone="warn"`. V-6: add mutation (k) "map INACTIVE to `danger`" → T-8 fails. §2.7 item 6 names the change |
| M-2 | T-2 is wrong for the base fixture: `plan()` has `availableToBuy: false` (`page.render:31`), so `kpi-available` reads **"0"** with "of 1 plan", not "1". Correct the expected values to "Off" / "0" / "1" / "1" |

**Should fix (checked at code review)**

| # | Item |
|---|---|
| S-1 | §1.1 line citations do not match the files at `0f02f80b`: `PlanCard.tsx` has 207 lines (cited `:222-290`, `:295-317`, `:363-371`), `AccountLookup.tsx` has 132 (cited `:247-273`, `:292-299`, `:302-319`, `:321-325`). Use the real lines (for example `AccountLookup.tsx:58-74` fetch, `:94-100` link, `:105-121` form, `:123-127` error; `PlanCard.tsx:50`, `:70-74`, `:88-114`, `:155`, `:192-193`) in the workplan and in the requirement as-built text |
| S-2 | Append one new `page.render` case (do not edit the existing one) that runs the same "no submit control" regex over every button in the **error** state (first-load failure: "Try again") and while a **lookup is pending** ("Reading…"). The existing case only sees the loaded page |
| S-3 | Q-8: the alias check uses the trailing-slash prefix `@/app/admin/components/layout/` exactly, and the negative control adds `escapes(page, '@/app/admin/components/layoutX/Foo')` → `true`, so a look-alike folder cannot ride the alias |
| S-4 | "Look up" on `ADMIN_BUTTON` needs `flex items-center gap-2` for its icon: append layout classes only, never a second colour, padding or border class that relies on `cn()` / class order to win (S-9). Keep the input's `min-w-[22rem] flex-1 font-mono` beside `ADMIN_FIELD_CONTROL` the same way |
| S-5 | The banner stays the **first child of the content wrapper**, full width, `role="note"`, no collapse or close control. T-9 also asserts the banner precedes `no-gate-summary` and `plan-paid-plan` in document order, so "first in the content" is pinned, not only "after the strip" |
| S-6 | No `<section>` the slice touches gains `aria-label` / `aria-labelledby` (that would make it a landmark, S-8 / A-9); anchor ids only |
| S-7 | Record in §7.8 as built: Q-1 (neutral, why), Q-2 ("Available to buy"), Q-7, the INACTIVE tone, and that §7.8's "Refresh and Clear pass it" has no Clear (Refresh-only bar). F-37 done; F-36 done; F-39 link half done, picker half the user's |

**Notes (no action required)**

| # | Item |
|---|---|
| N-1 | On a failed refresh the stale cards stay, the strip hides (K-10) and the header "As of" keeps the stale `generatedAt`. That is truthful (it dates what is on screen); keep it |
| N-2 | The Enforcement tile's sub-line ("Not enforced" / "Enforced") restates the value; acceptable, it is the yes/no a reader looks for |
| N-3 | Pre-existing: the `source.guard` `@/` branch compares with `@/${ROOT}` without a trailing slash, so a sibling folder named `business-os-tiers-x` would pass. Out of scope; do not widen the slice for it |
| N-4 | The "not available to buy" chip stays `warn` for the shipping state. Not re-litigated here: it is an existing colour meaning the user asked to see at a glance |
| N-5 | Unknown account codes now show the route string verbatim instead of "Could not read that account ({code})."; `accountLookup.contract` fails first if a GET code ever lacks copy. Accepted |

### Product question (non-blocking)

F-39 picker half (find an account by business name) stays the user's open item. L-5 keeps the id-only field; the recorded SA design note (a plans screen is not a people search) still stands and nothing in this slice needs it.

### Verdict

**✅ APPROVED WITH CONDITIONS.** Apply M-1 and M-2 to this file, then implement. S-1 to S-7 are checked at code review; V-1 to V-8 (with mutation (k)) and P-B1 to P-B8 as written. Sizing (about 2 days, one slice) accepted.

### Approval
[x] Workplan approved — proceed to implementation after M-1 and M-2

## SA Code Review — 2026-10-11

**Code Review by SA — 2026-10-11**
**Status:** ✅ Code Approved (no must-fix; three Low doc items RM or Dev may fold into the commit, none blocks)
**Scope read:** `git status --short` and `git diff --stat` first (10 tracked files, +567 / -160, no file emptied, no deletion-only file), then the full diff of every tracked file plus the new `PlansKpis.tsx`, `accountLookup.render.test.tsx` and this workplan. Worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l5`, against HEAD `0f02f80b`.

### Verified

| Check | Result |
|---|---|
| M-1 INACTIVE `warn` | ✅ `PlanCard.tsx:112` `neutral` / `warn`; the inactive card is `border-dashed border-amber-500/60 opacity-70`; T-8 pins the tone, the FYI `title`, the dashes and "no rose" |
| M-2 T-2 base values | ✅ "Off" / "0" / "1" / "1", sub-line "of 1 plan"; plural case "of 2 plans" (Q-9) |
| S-1 citations | ✅ §1.1 uses the real lines (one stale cite left in §2.2, comment 3) |
| S-2 no submit control in every state | ✅ Two appended cases (first-load error with "Try again"; pending lookup with "Reading…"), same regex; the existing loaded-page case is unedited |
| S-3 `escapes()` | ✅ `source.guard.test.ts:60`: same body plus the trailing-slash alias line, placed before the `@/` branch; four negative controls including `layoutX` (`:123`); the `it.each` calls it, so mutation (a) still bites |
| S-4 layout classes only | ✅ `AccountLookup.tsx:136`, `:141` append width, flex, gap and `font-mono` only; no second colour, padding or border |
| S-5 banner | ✅ First child of `plans-content`, `role="note"`, `id` only, no dismiss path; T-9 pins first child and precedence over `no-gate-summary` and `plan-paid-plan` |
| S-6 no new landmark | ✅ No `aria-label` / `aria-labelledby` on any section; T-9 asserts zero `region` roles |
| S-7 requirement as built | ✅ §7.8 records Q-1, Q-2, Q-7, the INACTIVE tone and the no-Clear correction; §9 F-36 / F-37 done, F-39 link half done |
| Neutral tiles | ✅ `PlansKpis.tsx` passes no `status`; `KpiStrip` renders `data-status="neutral"`; T-3 covers enforced and not enforced; the no-gate tile is `role="group"` with no href at 0 |
| No green except the banner | ✅ Only the `EnforcementBanner.tsx` emerald tone object (recorded exception); "Free" is white, ticks slate-300; the `ok` tone only on "available to buy" (Q-3) |
| Chip wrappers | ✅ Every flag's wrapper span keeps its `data-testid` and `title`; `textContent` exact per T-8 |
| `EntitlementSnapshot` restyle and the Businesses drawer | ✅ `adminTable` constants, `aria-label="Capabilities in force"`, `scope="col"`, `endDate()` via `formatUtc`; `ADMIN_TD` carries no colour, so the appended text colours do not compete. No edit in `app/admin/users/`; its suites are green (run below) |
| `readAdminResponse` on both reads | ✅ `page.tsx` and `AccountLookup.tsx` with `sessionEndedCopy: true`; only the `fetch` sits inside the network `try`; `setLoading(false)` still runs in `finally` on every early return; the copy table is applied after the helper (T-10) |
| `next/link` | ✅ `AccountLookup.tsx:119`; T-11 checks the href and that no `<a ` remains in code |
| States (deviation 1) | ✅ Accepted. `AdminError` / `AdminLoading` sit above the content wrapper, which exists only with a payload; same semantics, and the banner stays first child in every state. A failed refresh keeps the stale cards and hides the strip (K-10); "As of" dates what is shown (N-1) |
| Deviations 2 to 5 | ✅ Accepted as recorded |
| Entitlements tripwires | ✅ No import from `lib/business-os/entitlements/` in product code (only comment text and the fetch URLs match the grep); `PlansKpis` capitalises the mode generically, no tier or capability literal. The skill's review checklist is not triggered |
| Contract fixtures | ✅ Nothing under `__tests__/__fixtures__/` changed; the new test only reads `recordedAccountBody.json` |
| Accessibility | ✅ One h1; one `role="alert"` on error; Refresh named "Refresh the plans", `aria-busy` and disabled while busy; the Withholds toggle gains the A-1 focus ring; decorative icons `aria-hidden` |
| Logging / types | ✅ No `console.*`, no `any` in the folder |
| Line endings | ✅ The index is LF for every touched file (`git ls-files --eol`), `core.autocrlf=true`; new files are LF. No backslash in the two MDs |
| Tests (SA run) | ✅ `npx jest app/admin/business-os-tiers app/admin/users app/admin/components/layout --ci` → 36 suites, 1053 tests, all passed |

### Code Review Comments

1. `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md:59` (§1 row 10, last column) — still reads "Open for SA: Q-1 … Q-5" and "unless SA rules … Q-1 (b)"; all are ruled. Replace with the ruled outcome when RM records the commit — Priority: Low
2. `docs/requirements/ADMIN_LAYOUT_STANDARD_REQUIREMENT.md:834` (§7.8 original paragraph) — says "JSON reads via `readJsonBody`"; as built it is `readAdminResponse` (which wraps it). One clause in the as-built paragraph would settle it — Priority: Low
3. This workplan §2.2 cites `PlanCard.tsx:278-283`, which does not exist (the file has about 204 lines); the FYI comment is now at `PlanCard.tsx:103-110` — Priority: Low

### Optimisation Suggestions

- `AccountLookup.tsx:89` — `ENTITLEMENT_ERROR_COPY[result.message]` is a plain-object lookup, so a route string equal to an `Object.prototype` key would return a function. Pre-existing (was `[code]`), route strings are server-controlled, and `accountLookup.contract` pins every code; an `Object.hasOwn` guard is a possible later hardening, not this slice.
- `accountLookup.render.test.tsx` imports `fireEvent` from `@testing-library/dom`, while `page.render` uses `@testing-library/react`; both are direct dependencies, so this is cosmetic.

### Code Approved for QA: Yes

Fast-track: on QA PASS, RM may commit and open the PR. Comments 1 to 3 are optional doc touch-ups RM may fold into the commit; none needs another SA pass.

## QA Testing Report

## QA Report — 2026-10-11

**Test mode:** full (TL prompt)
**Strategy used:** A (Jest render and source guards in jsdom, plus a throwaway edge-case suite) and a scoped `tsc`. D (browser) handed to TL as a checklist: Playwright is not installed.
**Focus:** ui, api (read handling), security (session copy, no write control), schema (entitlements tripwires)
**Skipped:** the live browser pass (owed to TL, list below)
**Input source:** prompt keywords (TL), then this workplan §6 / §7 and the SA reviews

### Commands and results (real output; worktree `neuronforge-admin-layout`, branch `feature/admin-layout-l5`, uncommitted)

| # | Command | Result |
|---|---|---|
| 1 | `npx jest app/admin/business-os-tiers app/admin/components/layout app/admin/users app/admin/__tests__ app/admin/components/__tests__ app/api/admin/business-os/entitlements lib/admin/__tests__/admin-authz-surface.guard.test.ts app/__tests__/tailwind-css-escape.guard.test.ts --ci` | **55 suites, 1622 tests, all passed** (96.5 s). One "worker failed to exit gracefully" notice (Jest teardown, not a failure) |
| 2 | `npm run test:bos-entitlements` | **239 suites, 6804 tests, all passed** (105.5 s). Includes `app/admin/users/__tests__` (the snapshot's second consumer) and the importer and literal scans |
| 3 | Scoped `tsc -p` on a QA scratch `tsconfig.qa.json` (session scratchpad `qa-l5/`; `extends` the worktree tsconfig; `noEmit`, `incremental: false`, `plugins: []`; includes `next-env.d.ts`, `app/admin/business-os-tiers/**`, `app/admin/components/layout/**`, `BusinessOsPanel.tsx`; 16 tiers files in scope) | **Run 1 (canary in scratch only):** exit 2, exactly `canary.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` **Run 2 (canary deleted):** exit 0, no output |
| 4 | Throwaway `__tests__/zz.qa-l5.render.test.tsx` (38 cases) | **38 / 38 passed**. File deleted afterwards; `git status --short` identical to the start of the QA run |
| 5 | `npx eslint app/admin/business-os-tiers` | exit 0, no output |
| 6 | grep of the folder's code for `text-slate-500`, `bg-blue-600`, `err.message`, `.json(` | none |

### Edge cases (throwaway suite, jsdom)

| Area | Case | Result |
|---|---|---|
| Modes | `off` / `shadow` / `enforce`: tile value "Off" / "Shadow" / "Enforce", sub-line "Not enforced" / "Not enforced" / "Enforced", `data-status="neutral"`, no amber / emerald / red class on the tile, name "Enforcement, {value}", sub-line is the accessible description | ✅ Pass |
| Modes | Banner words unchanged ("Nothing on this page is enforced…" / "Entitlements are being ENFORCED."); amber border for off and shadow, emerald for enforce; `enforcement-mode` shows the raw mode | ✅ Pass |
| Plan counts | 0 plans → "0" and "of 0 plans", `#plans` still exists; 1 → "of 1 plan" (no "plans"); 4 → "of 4 plans" | ✅ Pass |
| Buyable / shown | All four combinations: shown `info` / hidden `neutral`; buyable `ok` / not `warn`; each wrapper's `textContent` is exactly its words | ✅ Pass |
| Inactive | Chip `warn`, text "INACTIVE", with icon; card `border-dashed border-amber-500/60 opacity-70`, no rose / red; an active card is not dashed; the active chip is neutral with no icon | ✅ Pass |
| Green | "Free" not emerald; include ticks not emerald (only the `ok` chip carries green) | ✅ Pass |
| No-gate tile | `withheldWithoutGate: []` → `div role="group"`, no `href`, name "Withheld with no gate, 0", no `#withheld-without-gate` in the DOM | ✅ Pass |
| Anchors | With a non-empty no-gate list, all four tile hrefs land on **exactly one** element each; `notBuilt: []` → tile "0" and `#not-built` still present | ✅ Pass |
| Plans read failures | 401 / 403 → the session-ended sentence; 500 with the route error → "Could not read the Business OS plans"; 500 empty body, 200 `success: false`, non-JSON → "Could not read the plans. Try again in a moment."; network → `ADMIN_NETWORK_ERROR`. In each: one `role="alert"`, no strip, no placeholders, no "As of", no parser / browser / "Unauthorized" / "Forbidden" text, exactly one fetch with exactly one argument, one h1, no button matching the no-submit regex | ✅ Pass |
| Success → failure → retry | 1 fetch on mount; a failed Refresh → 2 fetches, error shown, **cards kept** (as planned), strip hidden (K-10), stale "As of" kept (SA N-1), banner still the first child of `plans-content`; Try again → 3 fetches, strip back, error gone, "As of" updated | ✅ Pass, matches the plan |
| Refresh pending | Button `aria-busy="true"` and disabled; content `aria-busy="true"`; strip stays; no `role="status"` over loaded content; no submit-word button | ✅ Pass |
| First load pending | 4 `kpi-placeholder`, exactly one `role="status"` reading "Reading the plans…", no content | ✅ Pass |
| Lookup codes | Every `ENTITLEMENT_ERROR_COPY` key (5) worded through the table, inside `role="alert"` | ✅ Pass |
| Lookup failures | Unknown code → verbatim (SA N-5, accepted); 401 / 403 → the session sentence; non-JSON 200 → "Could not read that account. Try again in a moment."; network → `ADMIN_NETWORK_ERROR` | ✅ Pass |
| Lookup input | Whitespace-only id → button disabled and a forced submit sends no fetch; `'  a/b  '` → trimmed and encoded (`…/accounts/a%2Fb`), exactly one fetch | ✅ Pass |
| Lookup result | No plan row → both ends "no end date", named table, no `<details>`; offset date `2026-12-31T23:30:00-05:00` → "2027-01-01 04:30 UTC"; an unparseable end date renders "—" (shared `formatUtc`) | ✅ Pass |
| Lookup pending | A second lookup → "Reading…" disabled, previous error cleared, no submit-word button | ✅ Pass |
| Businesses drawer | `businessOsPanel.render`, `businessDetail.render` and `users/source.guard` green in commands 1 and 2 | ✅ Pass |
| Focus after Look up | Enter in the input keeps focus in the input; a click leaves focus on the Look up button in jsdom (the button disables while reading, so B-6 checks the real browser) | ✅ jsdom; browser owed |
| Focus after Try again | After a successful Try again, focus is on `<body>` (the error box unmounts with its button) | ⚠️ E-1 below |

### Accessibility (jsdom)

| Check | Result |
|---|---|
| Exactly one h1, "Plans & entitlements" (loaded and every error state) | ✅ |
| Tiles: anchor tiles are `<a>` named "{label}, {value}"; the zero no-gate tile is a named `role="group"`; none is a button | ✅ |
| Banner `role="note"`, first child of the content wrapper, after the strip and Refresh in document order | ✅ |
| No `region` landmark and no `search` landmark (the Refresh-only bar is a plain div) | ✅ |
| Chips: words plus icon for the meaning tones; `read-only-badge` and the neutral chips are text only, no svg | ✅ |
| Snapshot table: `aria-label="Capabilities in force"`, every `th` has `scope="col"` | ✅ |
| Refresh: name "Refresh the plans", `aria-busy` false at rest and true while reading | ✅ |
| Errors (`page-error`, `account-error`) inside `role="alert"` | ✅ |
| Tab order: tiles before Refresh | ✅ |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. One plans fetch per read (pinned above); the KPIs are computed from the same payload with no extra request.

#### Edge Cases (nice to fix)

1. **E-1 (recurrence): Try again drops focus to `<body>`.** Low. The shared `AdminError` unmounts with its button. Same classification as L-3 QA E-1 (shared, on every migrated page). Businesses (L-4a, SA Q-14) built a page-local fallback that moves focus to the content area; L-5 did not plan one, so this is not a deviation from the plan. Better fixed once in the shared folder than copied into each page.
2. **"The four plans" heading is fixed text.** Pre-existing copy (§2.6 keeps it). With 0 or 5 plans it would disagree with the tile's "of N plans". Not reachable with today's config; listed only.
3. **An unparseable expiry date shows "—"** instead of the raw string (shared `formatUtc`). Matches the L-3 precedent (shared C-5 behaviour); listed so it is not read as a regression.

### Browser checks for TL (signed-in admin, DevTools Network open; each in light **and** dark `prefers-color-scheme` emulation)

| # | Check |
|---|---|
| B-1 | `/admin/business-os-tiers`: exactly **one** `GET …/entitlements/plans`; h1 "Plans & entitlements", neutral "Read-only" chip, one-sentence purpose, "As of … UTC."; no second title |
| B-2 | Four tiles: Enforcement "Shadow" / "Not enforced", neutral (no status row, no amber border); Available to buy equals the count of "available to buy" chips, "of 4 plans"; Withheld with no gate equals the summary list length; Cannot be sold equals the panel count. Click each tile and confirm it lands on its section; the tile focus ring is visible in both schemes |
| B-3 | Tab order header → tiles → Refresh → banner → cards; the Withholds toggle shows the purple focus ring |
| B-4 | Refresh: spinner and `aria-busy`, the cards stay, exactly one new GET, "As of" updates. Note where focus lands after the button re-enables |
| B-5 | Plan cards: chips with icons and the same words; "tier" slate, "Free" white, ticks grey; INACTIVE (if any plan is) has an amber chip, amber dashes and dimming, with the FYI tooltip on hover; Withholds opens with amber "no gate yet" chips and their tooltip |
| B-6 | Lookup: paste a real Business OS id → result with the standard table (header style, density) and UTC end dates; an agent-platform-only id → the "not a Business OS account" sentence in the red box, with no Try again; after clicking Look up, note where focus lands when the button re-enables; the Businesses link navigates with no document request in Network |
| B-7 | `/admin/users` → open the same account's drawer: the plan block shows the same restyled table, readable in both schemes |
| B-8 | DevTools Offline → Refresh: "Could not reach the server…" and Try again; stale cards stay, strip hidden, "As of" unchanged. Back online → Try again → strip back (expect focus on `<body>`, E-1) |
| B-9 | The banner is first in the content, has no close control, is amber in shadow, and its text is readable in the light scheme |
| B-10 | Lookup field and Look up button match the other admin pages (no blue); placeholder readable in the light scheme |

### Final Status
- [x] All acceptance criteria pass in Jest and tsc. Ready for commit under the fast-track; browser checks B-1 to B-10 owed to TL
- [ ] Issues found — Dev must address before commit

**Verdict: PASS WITH NOTES.** No bugs. Notes: E-1 (Low, shared, known) and two listed edge cases. The live browser pass is still owed.

## Commit Info

| Field | Value |
|---|---|
| Branch | `feature/admin-layout-l5` |
| Commit | `0e40bd0c` feat(admin): admin layout standard L-5 — Plans & entitlements header, KPI strip, chips, shared states |
| Merge from main | None needed — branch already contains origin/main `d1bc95e2` |
| PR | [#310](https://github.com/AgentsPilot/neuronforge/pull/310) (contains #309, L-4b) — open, not merged |
| Tests at commit | 55 suites / 1622 tests (scoped jest), `test:bos-entitlements` 239 / 6804, `lint:hooks` clean |

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-11 | Committed, PR #310 | RM: SA code review Low doc fixes applied (§2.2 PlanCard citation → `:103-110`); commit 0e40bd0c, branch already contained origin/main `d1bc95e2`; scoped jest 55 / 1622, `test:bos-entitlements` 239 / 6804, `lint:hooks` clean. PR #310 opened, not merged |
