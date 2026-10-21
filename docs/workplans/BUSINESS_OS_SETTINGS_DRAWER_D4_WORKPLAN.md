# Workplan: Settings drawer D-4 — no browser database access on the settings page

> **Last Updated**: 2026-10-16

**Developer:** Dev
**Requirement:** [BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md](/docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md) §0.2, §9 (D-4), SA conditions C-13, C-22, C-24
**Branch:** `feature/settings-drawer-d4-no-browser-db` (from `origin/main` `067c4a3e`; `page.tsx` checked against `62c277a8`, D-2)
**Date:** 2026-10-16
**Path:** UI short path + SA code review (C-24). Not committed.
**Status:** Code Complete

## Overview

The last Phase B slice. DE-0a (export), D-1 (timezone) and D-2 (profile card) moved every browser database call off `app/business-os/settings/page.tsx`, which left `import { supabase } from '@/lib/supabaseClient'` unused. D-4 removes that import and adds the C-22 Jest source guard so no direct database access comes back to the page.

## Analysis Summary

- `grep supabase page.tsx` before the change: the import (line 15) and two comments (`supabase-js` in the `persistTimezone` note, `supabase.auth.signOut()` in the `handleLogout` note). No code use.
- Log-out: `handleLogout` calls `signOutUser({ scope: 'global', user, method: 'settings' })` from `@/lib/client/auth-actions`, not the client directly. Nothing to stop for.
- No `.from(` anywhere in the page (not even `Array.from`).
- Existing guards that read `page.tsx` (`settingsDeepLinks`, `timezoneWrite`, `accountProfile`, `accountCard`, `greetingUsesTheEditedName`, `pluginConnectionsBrowserAccess`, `darkModeTokens`): none asserts the import is present. `pluginConnectionsBrowserAccess` still classifies the page as a browser file through `'use client'`.
- The avatar hook's half of the rule is D-3's (C-21); C-22 scopes this guard to `page.tsx` only.

## Files

| File | Action | Reason |
|------|--------|--------|
| `app/business-os/settings/page.tsx` | modify (1 line removed) | Drop the unused browser Supabase import (clears the ESLint `no-unused-vars` warning) |
| `app/business-os/settings/__tests__/noBrowserDb.guard.test.ts` | create | C-22 guard + negative controls |
| `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` | modify | §0.2 D-4 progress line + Change History row |

## Task List

- ✅ Confirm nothing in the page uses `supabase` outside comments; confirm log-out goes through `signOutUser`
- ✅ Remove the import
- ✅ Add the guard: comments stripped with the same pattern as the other settings guards; fails on a `supabaseClient` import (alias or relative), on `.from(` and on `supabase.` / `supabase?.`
- ✅ Negative controls: the import, a relative import, `.from('profiles')`, a multi-line `.from (`, `supabase.storage.from(...)`, `supabase.auth.signOut()`, `supabase?.rpc`; each shape fails for its own reason; comment-only mentions pass
- ✅ Verification and mutations (below)

## Tests

| Run | Result |
|---|---|
| New guard | 11/11 pass |
| Every guard that reads `page.tsx` (8 suites) | 123/123 pass |
| `npx jest app/business-os/settings components/business-os/settings app/api/business-os` + the two lib/ui page guards (47 suites) | 1056/1057 on the full run; the one failure, `MarketingConsentPanel.picker.render.test.tsx`, passed 19/19 when re-run alone (load flake; it does not import `page.tsx`) |
| `npm run typecheck:bos-llm` | passed, 0 new errors (1 baseline entry fixed elsewhere, unrelated) |
| `tsc --noEmit` filtered to `page.tsx` and the new test | 0 errors |
| `eslint` on both touched files | 0 errors; 1 pre-existing warning (`exhaustive-deps` on the `loadData` effect). The `'supabase' is defined but never used` warning is gone |
| `npm run lint:hooks` | exit 0 |

## Mutations

Each applied to `page.tsx`, the guard run, then the file restored from a scratch copy; SHA-1 `aa1150c2…` matched before and after.

| # | Mutation | Expected | Result |
|---|---|---|---|
| M1 | Re-add `import { supabase } from '@/lib/supabaseClient'` | guard fails | Killed (also brings back the ESLint unused warning) |
| M2 | `await supabase.from('x').select('*')` in `handleLogout` | guard fails | Killed |
| M3 | `void supabase.storage` in `handleLogout` | guard fails | Killed |
| M4 | `await db.from('profiles')` (no `supabase` name) | guard fails | Killed |
| M5 | `// supabase.from('profiles')` (comment only) | guard passes | Passed (comment stripping works) |

## Manual QA (owed, human tester)

- [ ] `/business-os/settings` loads (desktop + phone, en + he) with no console error
- [ ] Every row and drawer still opens and saves: profile card (name), timezone, language/theme, plan, payments, marketing consent, invite friends, data export, log out

## SA Review Notes

_SA to populate._

## SA Code Review (2026-10-16)

**Status:** ✅ Code Approved (one Low pre-commit note for RM)

**Verified**
- `page.tsx`: the only change is the removed `@/lib/supabaseClient` import. The remaining `supabase` hits are two comments (`supabase-js`, `supabase.auth.signOut()`); `handleLogout` signs out through `signOutUser` from `@/lib/client/auth-actions`. No `.from(` in the page.
- Guard matches C-22: comments stripped like the sibling guards; client import (alias, relative, `require`, dynamic `import`), `.from(`, `supabase.` / `supabase?.`; each negative control fails for its own reason, and comment-only mentions and a route `fetch` pass. One file read inside the existing Jest job, so no CI time is added.
- Re-run by SA: the new guard plus the 8 page-reading suites, 8 suites / 123 tests pass.
- No `console.*`, no new pattern, no entitlements import, no DB/Zod/RLS surface.

**Rulings on Dev's questions**
- **Q-1 (comment stripper drops text after `//` inside strings):** keep it consistent with the other settings guards. The failure mode is a false negative only on a line that also holds a `//` string (for example a URL), which is narrow, and the page builds URLs through helpers. If it is ever fixed, fix it in one shared helper for every source guard. That is an optional follow-up, not part of D-4.
- **Q-2 (loose `.from(` also blocks a future `Array.from(`):** acceptable. It is what C-22 says, the page has no `Array.from`, spread or `Array.prototype.map` covers the need, and the failure message is explicit. If a real need ever comes up, narrow the matcher to `(?<!Array)\.from\s*\(` and add a negative control in the same change.
- **Q-3 (scope `page.tsx` only):** confirmed. C-22 is the later and more specific SA condition, so it overrides the §9 D-4 row that also lists `useAvatarUpload.ts`. The hook half is covered by D-3's `components/onboarding/hooks/__tests__/useAvatarUpload.guard.test.ts` (on `origin/main`: `.from(`, both client imports, `console.`).

**Findings**
1. `docs/requirements/BUSINESS_OS_SETTINGS_DRAWER_REVIEW.md` — `origin/main` changed this file after the branch base `067c4a3e` (D-3 merged), including the §0.2 progress block and the Change History tail, which are the two places this diff edits. RM: merge `origin/main` before committing, keep both sides of each hunk, and re-run the guard. Priority: Low.

**Optimisation suggestions (non-blocking)**
- Optionally also forbid an `@supabase/` package import in the page, so a client created inline under another name cannot reach `.auth` / `.rpc`. `.from(` would already catch table access. Out of C-22's scope.
- Optionally annotate the §9 D-4 row: "hook half: D-3 guard (C-21), per C-22".

**Code Approved for QA:** Yes

## QA Testing Report

_Short path: SA code review only (C-24)._ See the QA report below.

## QA Report (2026-10-16)

**Test mode:** smoke (proportionate, tiny slice) · **Strategy:** A (Jest source guard + mutation probes) · **Focus:** security (rule 1) · **Skipped:** manual browser check: NOT RUN, the user tests after deploy · **Input source:** prompt.

### Test Coverage
| Check | Result | Notes |
|---|---|---|
| `noBrowserDb.guard.test.ts` green | ✅ Pass | 11/11 |
| Settings must-stay-green set (`app/business-os/settings` + `components/business-os/settings`) | ✅ Pass | 23 suites / 480 tests. `MarketingConsentPanel.picker.render` passed first time |
| Other suites that read `page.tsx` (layoutFolder, admin settings render, greetingUsesTheEditedName, darkModeTokens, planBadge, pluginConnectionsBrowserAccess) | ✅ Pass | 6 suites / 441 tests |
| Page has no runtime `supabase` reference | ✅ Pass | grep: the only hits are comments (L326, L491) |
| Log-out uses `signOutUser` | ✅ Pass | import L16, call L529 `signOutUser({ scope: 'global', user, method: 'settings' })` |
| Manual: page loads, rows and drawers work | ⬜ NOT RUN | User checks after deploy |

### Mutations (beyond Dev M1–M5). The page was restored after each one; SHA-1 `aa1150c2…` matched before and after, and `git diff --stat` is unchanged
| # | Mutation inserted in `page.tsx` | Result |
|---|---|---|
| M6 | `import * as sb from '@/lib/supabaseClient'` | ✅ Killed (import) |
| M7 | `import { supabase as db } from '../../../lib/supabaseClient'` | ✅ Killed (import) |
| M8 | `import { createClient } from '@supabase/supabase-js'` + `client.auth.getUser()` | ❌ Survived (gap) |
| M9 | `supabase` + newline + `.from('profiles')` | ✅ Killed (import, `.from(`, `supabase.`, because `\s*` spans the newline) |
| M10 | aliased `db.rpc('x')` via the `@/lib/supabaseClient` import | ✅ Killed (import) |
| M11 | `createClient('u','k').storage` from `@supabase/supabase-js` | ❌ Survived (same gap as M8) |
| M12 | import from `@/lib/supabaseServerAuth` | ❌ Survived (low: a server-cookie client in a `'use client'` page would break the build anyway) |

### Issues Found
- **Bugs:** none.
- **Edge cases (nice to fix, non-blocking):** E-1. A client created inline from `@supabase/supabase-js` (or any `@supabase/*` package) and given another name gets past the guard for `.auth`, `.rpc` and `.storage` (M8, M11). `.from(` table access is still caught. This confirms SA's optional suggestion: also forbid `from '@supabase/` and `@/lib/supabaseServer*` imports. It is outside C-22's literal scope.
- **E-1 closed by TL (2026-10-16):** the guard now also forbids any `@supabase/*` import and any `@/lib/supabaseServer*` import (`from`, `require(` and `import(` forms), with 4 new negative controls (SDK, SDK sub-package, server client, server auth client). Guard is now 15/15. TL proved an SDK import and a server-auth import into the page each fail the guard; page restored, SHA-1 unchanged. M8, M11 and M12 are now killed.

### Final Status
- [x] Acceptance checks pass, with one non-blocking guard gap (E-1). **PASS WITH NOTES.** Ready for commit.

## Commit Info

_RM to populate._

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-16 | Workplan + code complete (Dev) | Import removed, C-22 guard added, all checks green, 4/4 mutations killed + 1 control passed. Not committed; awaiting SA code review |
| 2026-10-16 | SA code review | ✅ Code Approved. Q-1 keep consistent (shared-helper follow-up optional), Q-2 acceptable, Q-3 confirmed (C-22 overrides the §9 row; D-3 guard covers the hook). Low: merge `origin/main` before commit (requirement doc drift) |
| 2026-10-16 | QA report | PASS WITH NOTES. Guard 11/11; settings set 23 suites / 480 tests; 6 other page-reading suites / 441 tests; 7 new mutations: 4 killed, 3 survived (E-1, inline `@supabase/*` or server client, non-blocking); page restored with SHA-1 verified. Manual check NOT RUN (user tests after deploy) |
| 2026-10-16 | QA E-1 closed (TL) | Guard extended to forbid `@supabase/*` and `@/lib/supabaseServer*` imports; 4 new negative controls; 15/15. SDK and server-auth imports into the page proven to fail it; page restored, SHA-1 unchanged |
