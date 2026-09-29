# Workplan: Admin audit trail — business (account) picker

**Developer:** Dev
**Branch:** `feature/admin-audit-account-picker` (cut from `cf9a66da`, the tip of `fix/admin-audit-account-chip-name` / PR #141 — stacked deliberately: that PR *names* the account chip, this one lets an operator *set* it, and both touch `app/admin/audit-trail/page.tsx`)
**Requirement:** none of its own — a short-path UI change on the audit surface. Related: [BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md) (AC-B13: business names must not be logged)
**Date:** 2026-09-29
**Status:** Code Complete (uncommitted — no commit per standing preference)

## Analysis Summary

`app/api/admin/audit-trail/route.ts:108` applies `.eq('user_id', accountId)` at the **database** level, so the account filter is complete and correct. The page can only ever **clear** it (`page.tsx:530`); the only way to **set** it is to arrive with a GUID in the URL. An operator who wants "everything Acme Dental did" has no path unless they already know the UUID.

Explicitly out of scope: the free-text search (`route.ts:144-173`) filters **in memory** over one window of rows, so teaching it business names would return partial results that look complete. Not touched.

## The reuse-vs-new-endpoint decision

`GET /api/admin/business-os/llm-usage/businesses` already returns exactly `{ userId, companyName }`, admin-gated through `AdminAccessService`, backed by `businessProfileRepository.searchForAdmin`, and logs `searchLength`/`resultCount` — never the search text or the names.

**Decision: reuse it over HTTP. No new endpoint.** Checked, not assumed:

| Concern | Finding |
|---|---|
| "caps at 50" | The 50 is `BUSINESS_SEARCH_MAX_LIMIT` in `lib/repositories/BusinessProfileRepository.ts:37`, and `searchForAdmin` clamps to it **whatever limit a caller passes**. A sibling endpoint would return the same 50. The cap is a repository property, not an endpoint property, so it is not a reason to build anything. It *is* a reason to tell the operator when the list is truncated — the UI does. |
| "documented as *businesses the LLM usage tab can inspect*" | That is the docstring, not the behaviour. The query is `business_profiles` ordered by `company_name` with an optional ILIKE — **unscoped to LLM usage**. It is already a generic admin business search; the doc line undersells it. |
| "returns platform account ids" | Meaningful there (the LLM usage tab must warn before one is selected, because platform rows are checked differently). **Not meaningful here**: the platform account has ordinary audit rows and filtering to them is a legitimate operator action, not a hazard. The field is read and ignored, with a comment saying so. |
| coupling | The page **fetches a URL**. It imports nothing from `lib/business-os/**` — not even `BusinessListResponse`. That is the coupling SA rejected in a recent round (`lib/audit → lib/business-os/usage` via a shared helper), and a new static guard now pins it. The response shape is re-declared locally as the three fields this screen reads. |
| lifecycle risk (the honest cost) | The audit surface now depends on an HTTP contract owned by another surface. Mitigated with a contract guard test that fails if the route file moves/disappears or stops mapping `userId`/`companyName`, turning a silent runtime break into a red test. |

A sibling route would have been ~90 lines + tests to obtain **the same 50 rows from the same repository method**, and its only real gain — `requireAdmin` instead of that route's parked inline gate copy — is a property of the existing route that should be fixed there (admin-authz slice 4), not forked around.

## Implementation Approach

- New colocated client component `app/admin/audit-trail/BusinessAccountPicker.tsx` in the page's own Tailwind idiom (the existing `components/test-business-os/llm-usage/BusinessPicker.tsx` is inline-styled for the harness and imports the Business OS type — copying its look, not its code).
- Debounced (300 ms) typeahead → `?search=`, abortable; keyboard (↑/↓/Enter/Escape); `role="listbox"`.
- Selecting sets `filters.userId`, which already flows to the DB-level filter (`page.tsx:272` sends `user_id`). The existing chip (PR #141) names it once rows load.
- **No profile / no name:** a `company_name: null` row renders as "Unnamed business" + short id and is still selectable; an account with **no `business_profiles` row at all** can never appear — so the picker says so in a permanent hint, and accepts a **pasted UUID** as a list option when the typed text is one. That keeps every account reachable without a hand-built URL.
- **The URL is a record of arrival, not a mirror of the screen.** `?user_id=` still seeds the filter on mount (`filtersFromUrl`, pre-existing); nothing on this page writes to the address bar. An earlier version mirrored `user_id` back with `history.replaceState` — removed on the user’s instruction (SA comment 2 / QA): with only that one parameter live beside six frozen at arrival, a copied link could describe a narrower screen than the sender was looking at.
- **No business name in any log line** (AC-B13): the picker's only log is a fetch failure, with no term and no names.

## Files to Create / Modify
| File | Action | Reason |
|------|--------|--------|
| `app/admin/audit-trail/BusinessAccountPicker.tsx` | create | The picker |
| `app/admin/audit-trail/page.tsx` | modify | Mount it in the filter bar (the only change to this file) |
| `app/admin/audit-trail/__tests__/businessPicker.render.test.tsx` | create | Behaviour: typeahead, select, null name, truncation, paste-id, no names logged |
| `app/admin/audit-trail/__tests__/businessPicker.contract.test.ts` | create | Static: no `lib/business-os` import from the audit surface; the reused route exists and still maps `userId`/`companyName` |

## Task List
- [x] Step 1: Read the audit route, page, chip PR, the LLM-usage businesses route, its repository method and the admin-authz guard
- [x] Step 2: Resolve reuse vs new endpoint (above)
- [x] Step 3: Build `BusinessAccountPicker`
- [x] Step 4: Mount it in the filter bar
- [x] Step 5: Render tests
- [x] Step 6: Contract/boundary guard test
- [x] Step 7: Run the audit-trail suites + `npm run build` + scoped `tsc`

## Verification

```
npx jest app/admin/audit-trail app/api/admin/audit-trail lib/audit lib/admin
Test Suites: 26 passed, 26 total
Tests:       703 passed, 703 total     (includes admin-authz-surface.guard)
                                       was 690 before the SA fixes: +17 guard/clear tests, -4 URL-mirroring tests

npm run build
 ✓ Compiled successfully
 ✓ Generating static pages (307/307)
BUILD EXIT:0

npx tsc --noEmit -p tsconfig.audit-picker.tmp.json   (scoped: app/admin/audit-trail/**)
TSC EXIT:0      # NOT the whole-repo tsconfig, which OOMs silently and reads as a pass

npx eslint app/admin/audit-trail            # 0 errors; 12 pre-existing warnings in page.tsx, none in the new files
```

`git diff --stat` on `app/admin/audit-trail/page.tsx`: **11 insertions, 0 deletions** — additive only (the import plus the mounted picker; 1209 lines, was 1198).

Not verified in a browser: the page is admin-gated, so a live check needs an admin session. QA owns that; the jsdom suites render the real page, and the production build is green.

### One thing worth knowing about the guard test
The AC-B13 "no names in logs" assertion first passed while checking **nothing**: its regex was `/logger\s*\./`, and the call sites are `requestLogger.info` — capital `L`, so it matched zero calls and `for (const context of [])` asserted nothing. It was caught only because the same test also asserts *positively* (`contexts.length > 0`, `some(searchLength)`). Any future source-text guard here should keep a positive assertion for the same reason.

## SA Review Notes

**Code Review by SA — 2026-09-29**
**Status:** 🔄 Fix Required (2 Medium items; everything else approved)

Reviewed the working tree against `cf9a66da` (not `origin/main`). `page.tsx` is +37/−0, additive only — confirmed. No source file was changed by SA.

### Rulings on the six items raised

**1 · Reuse over a sibling endpoint — ✅ correct, ruling upheld.**
Verified independently: `BUSINESS_SEARCH_MAX_LIMIT = 50` is declared at `lib/repositories/BusinessProfileRepository.ts:37` and `searchForAdmin` clamps with `Math.min(Math.max(…), BUSINESS_SEARCH_MAX_LIMIT)` at :610 — the cap is the repository's, so a sibling route would return the same 50 rows from the same method. The query at :612–620 is `business_profiles` → `select('user_id, company_name')` → optional ILIKE → order by name: **unscoped to LLM usage**, so the route's docstring does undersell it. Ignoring `platformAccountIds` is right for the reason given — the LLM-usage warning exists because platform rows are accounted differently there, whereas filtering audit rows to the platform account is an ordinary operator action. Admitting the cap in the UI instead of building an endpoint is the proportionate call.

**2 · The import ban is real, the guard that mechanises it has four holes — 🔄 Fix Required (Medium).**
Confirmed the page imports nothing from `lib/business-os/**` and re-declares the three fields. I mutation-tested `businessPicker.contract.test.ts:67-75` against twelve import forms. CAUGHT: plain, `import type`, inline `{ type A }`, multi-line, relative-path, `import * as`, `await import('@/lib/business-os/…')`. MISSED:
- `import '@/lib/business-os/x';` — side-effect import, no `from`;
- `export type { A } from '@/lib/business-os/x';` — re-export;
- `import('../../../lib/business-os/x')` / `require('../../../lib/business-os/x')` — the dynamic check is alias-only;
- **any import line with a trailing `// comment` or trailing whitespace** — `stripComments` leaves a space before the `['"];?$` anchor, so the statement no longer matches. This is the likely accident.

The guard *is* the mitigation for the architecture decision in item 1, so it should not have known bypasses. One broadened pattern covers all four — match `(?:from|import|require)` followed by an optional `(` and a quoted specifier containing `lib/business-os`, over the comment-stripped source.

**3 · The cross-surface HTTP dependency — ✅ sufficiently mitigated.**
Contract guard + defensive `readBusinesses` + graceful degradation (403 surfaces the route's fixed refusal string, an unexpected shape degrades to "no businesses", and the audit rows still load — pinned at render.test:374-392) is proportionate for two admin screens. No new route is the right answer. Two additions worth making, neither blocking:
- The duplicated `SEARCH_MAX_CHARS = 100` (picker:54) is *not* pinned by the contract test. If the server tightens its limit the client keeps accepting 100 chars and earns 400s. Cheap to add alongside the field-name assertions.
- The dependency is invisible from the owning side: `app/api/admin/business-os/llm-usage/businesses/route.ts:1` still says "Businesses the admin LLM usage tab can inspect". One line naming the second consumer would save the next author a confusing red test in an unrelated suite. Comment-only; TL's call whether to keep this diff server-free.

**4 · URL mirroring — keep the mechanism, but 🔄 Fix Required (Medium): it is half-mirrored.**
`history.replaceState` over `router.replace` is the right choice and the no-`pushState` test is the right thing to pin. The defect is scope, not mechanism: **`user_id` is live while every other filter in the URL is frozen at arrival.** The documented entry point to this page is the Businesses deep link `?action=BUSINESS_AI_ACTION_FAILED&user_id=<id>`, so arriving with other params is the normal path. Sequence: arrive on that link → set Action back to All → pick another account → copy the URL. The recipient opens `?action=BUSINESS_AI_ACTION_FAILED&user_id=<new>` and sees a **narrower** set of rows than the sender was looking at, with nothing to indicate it. The same shape happens with `?search=` cleared in the UI but left in the URL. That is the "partial results that look complete" failure this cycle explicitly rejected the free-text search for, reintroduced in the shareable artifact. `render.test:406` currently pins the behaviour that produces it.

Resolve either way, both acceptable:
- (a) **preferred** — mirror the full set `filtersFromUrl` reads (`action`, `severity`, `entity_type`, `date_from`, `date_to`, `search`, `user_id`) using those same keys, so the URL means one thing: the screen. ~6 lines, same mechanism, and it makes `filtersFromUrl` and the mirror symmetric by construction;
- (b) drop the mirroring entirely and keep deep links read-only, which is what the brief actually asked for.

Not acceptable as-is: one live parameter beside six stale ones.

**5 · The corrected AC-B13 guard — ✅ sound; and no, the flaw is not repeated elsewhere on this surface.**
`[A-Za-z]*[Ll]ogger` matches `logger.`, `requestLogger.` and `this.logger.`; multi-line context objects are captured (`[^}]*` spans newlines); a nested `{ meta: { companyName } }` is still caught because the capture includes the key. Residual gaps, all Low and none of them live on this surface today: the chained form `logger.child({…}).info({…})` is missed; a `log.`-style alias is missed; and the guard inspects only the **first object argument**, never the message, so an interpolated message would pass — that one is covered at runtime by `render.test:341-372`, which stringifies every logger argument.
Checked the other source-text guard on this surface, `filterOptions.guard.test.ts`: every negative assertion there (`:70`, `:75`, `:85`, `:99`) is paired with a positive `toContain` in the same test. That is the same safety net that exposed this bug, and it is already the local habit — worth stating as the rule, which the workplan does.

**6 · The parked admin-authz item — do not convert here, but the parking rationale is now out of date.**
Confirmed `app/api/admin/business-os/llm-usage/businesses/route.ts#GET` in `R1_PARKED` and the file in `R2_PARKED` (`lib/admin/__tests__/admin-authz-surface.guard.test.ts:282` and the R2 block). Not converting it in this cycle is correct: it belongs to slice 4, and touching it re-opens the guard's cap arithmetic inside a short-path UI change. **But the parked entry's stated justification — "Behaviour already correct … hygiene, not risk reduction" — was written when one internal tab depended on it.** It now backs a production admin filter with two consumers, so the blast radius of a defect in the hand-copied gate is wider than the note claims. Ruling: raise this specific route to the top of slice 4 when parked work resumes, and update the entry's `why` to record the second consumer (prose-only; the exemption id set, and therefore the caps, do not change).

### Code Review Comments
1. `app/admin/audit-trail/__tests__/businessPicker.contract.test.ts:67-75` — import-ban guard misses side-effect imports, `export … from`, relative-path dynamic `import()`/`require()`, and any import line with a trailing comment or trailing whitespace — Priority: **Medium**
2. `app/admin/audit-trail/page.tsx:328-352` — only `user_id` is mirrored, so a copied link can reproduce a narrower screen than the sender saw — Priority: **Medium**
3. `app/admin/audit-trail/page.tsx:95` — the `userId` field comment still says "set by a deep link from Businesses"; the picker is now the primary setter — Priority: Low
4. `BusinessAccountPicker.tsx:222-242` — no `aria-activedescendant` and no `id` on the options, so arrow-key movement is invisible to a screen reader; `aria-selected` marks "is the active filter" rather than "is highlighted", which is what AT announces. `Loading…` is not in a live region and the hint is not wired via `aria-describedby` — Priority: Low (internal admin screen)
5. `BusinessAccountPicker.tsx:150-152` — an aborted fetch leaves `loading` stuck at `true` (the `finally` skips the reset when aborted). Not user-visible today because reopening re-enters `load`, but the state is a lie — Priority: Low
6. `BusinessAccountPicker.tsx:126` — `typeof crypto?.randomUUID === 'function'` still evaluates `crypto`, so it throws rather than degrades if the global is absent; `typeof crypto !== 'undefined' && …` matches the comment's intent — Priority: Low
7. `BusinessAccountPicker.tsx:207` — when the search contains `*`, `searchForAdmin` drops rows client-side after the cap, so a capped result can arrive under `limit` and the truncation notice is suppressed — Priority: Low
8. `.gitignore` / `.claude/settings.local.json` — unrelated to this change (a launch-config ignore and 20 local permission entries). Harmless, but RM should decide whether they belong in this PR — Priority: Low

### What was checked and is clean
- **Mandatory rules:** no `console.*` anywhere in the touched or new files; Pino via `createLogger`; no Supabase access added; no new API boundary (the response is nonetheless parsed defensively); three `any` uses, each at the untyped JSON boundary with an eslint-disable and a reason; no secrets; no hardcoded model names.
- **Security:** no new server surface. The page is gated by `app/admin/layout.tsx:40` (`requireAdminPage`), the reused route runs 401 → 403 → 400 with a fail-closed admin check, and the audit route still applies `.eq('user_id', accountId)` at the DB level. The picker cannot widen what an operator may see — it only chooses a value the server already validates (`lib/audit/requestSchemas.ts:155`, `z.string().uuid()`).
- **The pasted-id path:** the picker's `UUID_PATTERN` and zod 3.25's `.uuid()` accept the same strings — checked nil, non-versioned and `deadbeef…` shapes, all agree — so "Use this account id" cannot offer an id the route will 400 on.
- **`company_name: null`:** "Unnamed business" in italic with the short id *beside* the name, still selectable — correctly avoids the mistake PR #141 just fixed, and `render.test:266` asserts the id is not in the name's place. Blank/whitespace names normalise to the same state.
- **No-profile accounts:** permanent hint (not hidden behind an empty result) plus the pasted-id affordance — the right treatment for a limitation that cannot be typed around.
- **Debounce/abort:** correct; the empty term fetches immediately, aborted fetches do not set state, and the page load itself costs no `business_profiles` read (pinned at render.test:154).
- **Spot-check of Dev's verification:** `npx jest` on both new suites — 2 suites / 59 tests green. `npx eslint` on all three new files — 0 problems. The temporary `tsconfig.audit-picker.tmp.json` was cleaned up (not in the tree).

### Dev responses to SA comments 1 and 2

**Comment 2 — URL mirroring: removed, not re-scoped.** User's ruling: drop the URL behaviour. `page.tsx` no longer contains a `history.replaceState` effect (the whole `useEffect` and its comment block are gone), and the four tests that pinned it are gone with them: *leaves a shareable URL behind*, *drops user_id from the URL again when the chip is cleared*, *keeps other query parameters when the account changes*, and the `pushState`-never-called assertion. Clearing the chip lost its only coverage in that deletion, so it is re-pinned at the level it now lives at — *goes back to every account when the chip is cleared* asserts the next audit request drops `user_id`, which is the behaviour, rather than an address-bar side effect. `?user_id=` on arrival is untouched and still pinned (*filters by the id in the URL on arrival and leaves the URL alone*). Net on `page.tsx`: back to 11 insertions, 0 deletions.

**Comment 1 — the four guard bypasses: one broadened pattern, mutation-proven.** The statement matcher (anchored `^import` … `['"];?$`, plus a separate `@/`-only dynamic check) is replaced by `/\b(?:import|export|require)\b[^;]*?['"](?:@\/lib\/business-os|\.\.?\/[^'"]*lib\/business-os)/g` over the stripped source. No anchors, so a trailing comment or trailing whitespace cannot break it; `import|export|require` covers the side-effect import and the re-export; `[^;]*?` spans newlines but never crosses a statement boundary, so unrelated statements cannot splice into a false positive; the relative arm applies to the dynamic forms too.

Proof, both ways round — each form planted at the top of the real `BusinessAccountPicker.tsx`, contract suite run, file restored:

| Planted form | Old pattern | New pattern |
|---|---|---|
| `import '@/lib/business-os/…';` (side-effect) | missed | **1 failed, 49 passed** |
| `export type { … } from '@/lib/business-os/…';` | missed | **1 failed, 49 passed** |
| `import('../../../lib/business-os/…')` | missed | **1 failed, 49 passed** |
| `require('../../../lib/business-os/…')` | missed | **1 failed, 49 passed** |
| `import type { A } from '@/lib/business-os/…'; // TODO` | missed | **1 failed, 49 passed** |
| plain `import … from '@/lib/business-os/…'` (control) | caught | caught |

The failing test is always `BusinessAccountPicker.tsx has no lib/business-os module edge`. All thirteen forms are also pinned as unit cases inside the suite (`the guard above actually catches what it claims to`), with three negative controls so the guard cannot pass by matching nothing — the AC-B13 lesson above. The sample specifiers there are assembled from parts, because this test file sits inside `app/admin/audit-trail` and is scanned by its own guard; a literal sample would make the file its own offender.

**Not fixed here, logged as follow-ups** (SA comments 3–7 and QA's low items): the `userId` field comment at `page.tsx:95`, `aria-activedescendant` on the listbox, the aborted-fetch `loading` flag, the `crypto` typeof guard, the `*`-search truncation notice, the exactly-50 over-warning, the nested-object blind spot in the log guard, and the pre-existing filter-bar unmount during an empty refetch.

### Code Approved for QA: Yes, with comments 1 and 2 to be fixed
QA can test the behaviour as built — comment 2 changes the URL contract, not the filtering, and comment 1 is test-only. Both must be resolved before RM.

## QA Testing Report
_QA to populate._

## Commit Info
_RM to populate. Nothing is committed by Dev._
