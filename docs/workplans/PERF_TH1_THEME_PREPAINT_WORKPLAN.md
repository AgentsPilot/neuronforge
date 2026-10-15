# Workplan: TH-1, Owner Pages Draw Before JavaScript Mounts the Theme (with TH-2 folded in)

> **Last Updated**: 2026-10-15

## Overview

`V2ThemeProvider` returns `null` until its mount effect has run (`lib/design-system-v2/theme-provider.tsx:260-262`, "Prevent SSR flash"). Every hard load of `/business-os/*`, `/onboarding-*` and `/v2/*` therefore paints nothing below the platform shell until all first-load JavaScript has been downloaded, evaluated and hydrated. Measured on a local production build, that blank is about 110 ms warm. Estimated on a cold slow-4G phone, it is about 2.5–3.5 s. TH-1 removes the blank without changing any theme, colour or preference. A static stylesheet carries the default `--v2-*` values. A static pre-paint script puts `.dark` on `<html>` from the same sources the provider reads. **The platform's custom design tokens are read on the server and inlined in the HTML**, so the brand colours an admin set are on screen from the first frame. The provider then renders its children on the server, receives the custom tokens as a prop instead of reading the database from the browser, and keeps its `mounted` guard on the DOM effect, so its first run cannot strip `.dark` or overwrite the inlined values. This is option (a) of the SA analysis, which the user approved as a business-unchanged fix, extended by the user's decision of 2026-10-15 to fold TH-2 (server-read custom tokens) into this slice.

**Developer:** Dev
**Requirement:** SA analysis `theme-blank-analysis.md` (session scratchpad, not in the repo) and the §0 row "New candidate measured: blank-until-mount owner pages" in `docs/requirements/PERFORMANCE_IMPROVEMENT_SCOPING.md`. That doc is **uncommitted in the main checkout and stays uncommitted**, because the repo is public. This workplan cites it by name only and copies no figures beyond those above. The TH-2 fold-in is the user's decision of 2026-10-15, relayed by the main session.
**Branch:** `feature/perf-th1-theme-prepaint` (worktree `C:/Users/Barak/My Projects/AgentsPilot/neuronforge-th1`)
**Base commit:** `origin/main` @ `936dfd04` (PR #388, settings drawer S-1). Rebased from `6bb1eda1` on 2026-10-15 with `git reset --hard origin/main`; only this untracked workplan existed, no code had been written.
**Date:** 2026-10-14 (revision 2: 2026-10-15)
**Status:** In Progress. Code and local checks done (T-2 to T-11, branch build). **Browser runs owed by the user** (T-0 baseline, T-12 smoke, T-13 measurements, the 20-pair guard, RC-10(e) and RC-12). Nothing committed.

> ### ⚠️ SA re-review needed (revision 2)
>
> The RC-7 stop condition was hit at T-0(e): production has **one non-empty `v2_custom_tokens` row**. It overrides `colors.primary` and `colors.secondary`, and both differ from the defaults. The values are deliberately not recorded here, because the repo is public. The user decided to **fold TH-2 into TH-1**: read the tokens on the server, inline them in the HTML, and remove the browser database read. Tightening the table's RLS stays out of scope (**TH-2b**). This revision:
> - adds the server read (§2.7), the inlined tokens (§2.8), the `/v2` decision (§2.9) and the admin-save propagation (§2.10);
> - changes the provider (§2.3): no browser fetch, tokens as a prop, isomorphic layout effects (RC-1). RC-6 becomes moot, because the `console.error` is deleted with the fetch;
> - folds RC-1 to RC-9 into §2, §6, §7, §10 and §11, as the first review required before T-2;
> - marks the RC-7 stop **resolved by this design**, subject to one new read-only pre-check, T-0(g) (§4);
> - re-bases the slice on `936dfd04`.
>
> New questions for SA are in §12 (R2-Q1 to R2-Q9). The first review's rulings Q-1 to Q-7 stand, except where §12 says otherwise.

---

## Table of Contents

- [§0 Revision 2: What Changed and Why](#0-revision-2-what-changed-and-why)
- [§1 Analysis Summary](#1-analysis-summary)
- [§2 Implementation Approach](#2-implementation-approach)
- [§3 Files to Create / Modify](#3-files-to-create--modify)
- [§4 Task List](#4-task-list)
- [§5 §6 Filter Answer (Q1–Q5)](#5-6-filter-answer-q1q5)
- [§6 SSR Risk and the Route Smoke Test](#6-ssr-risk-and-the-route-smoke-test)
- [§7 Metrics](#7-metrics)
- [§8 Interaction with BR-1b](#8-interaction-with-br-1b)
- [§9 Side Findings and Follow-ups](#9-side-findings-and-follow-ups)
- [§10 Test Plan](#10-test-plan)
- [§11 Risks](#11-risks)
- [§12 Questions for SA](#12-questions-for-sa)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## §0 Revision 2: What Changed and Why

| Item | Revision 1 (SA-approved with changes) | Revision 2 |
|---|---|---|
| Custom tokens | Browser read in the provider's mount effect, kept byte-for-byte (TH-2 separate) | **Server read** through `SystemConfigRepository`, validated, cached, passed to the provider as a prop and **inlined as CSS** in each segment layout. The browser read is deleted |
| Why it changed | — | With the null provider gone, the HTML paints seconds before the browser read resolves on a slow phone. With a live custom row, that is a default-palette frame followed by a brand-colour swap: a wrong-theme artefact longer than today's. RC-7 stopped the slice on exactly this |
| `console.error` in the provider | Converted to `clientLogger.warn` (RC-6) | **Deleted** with the fetch. The provider logs nothing. Failures are logged once, on the server, by the new reader |
| `/v2` layout | Client layout, ~~statically prerendered~~ already dynamic (IN-6) | **Server layout, `force-dynamic`** (§2.9, R2-Q3) |
| RC-7 | Stop condition | **Resolved by design.** One read-only pre-check replaces it: T-0(g), "every value in the production row passes the new validator unchanged" |
| RLS on `system_settings_config` | Unchanged (TH-2) | Still unchanged. Recorded as **TH-2b**, which needs separate user authorization (§9.2) |
| Base | `6bb1eda1` | `936dfd04` |

---

## §1 Analysis Summary

Read at `936dfd04`. Between `6bb1eda1` and `936dfd04` none of the files this slice touches changed, except `app/v2/settings/page.tsx` (a logging conversion and a removed query, unrelated; it still calls `useSearchParams` at `:26` without a boundary).

| Area | What it is today |
|---|---|
| Provider | `lib/design-system-v2/theme-provider.tsx`. `mounted` starts `false` (`:52`), `mode` starts `'light'` (`:53`), `customTokens` starts `{}` (`:54`). The mount effect (`:56-87`) sets `mounted`, starts a **browser Supabase read** of `system_settings_config.v2_custom_tokens` through `@/lib/supabaseClient` (`:60-76`, the anon client, a CLAUDE.md rule 1 violation), then reads `localStorage['v2-theme-mode']`. **Any truthy value is used as-is**, otherwise it falls back to `matchMedia('(prefers-color-scheme: dark)')` (`:79-86`). The DOM effect (`:89-254`) is guarded by `if (!mounted) return`. It toggles `.dark` on `<html>`, persists the mode, and writes **43** `--v2-*` custom properties inline on `<html>`. When the fetch resolves, `customTokens` changes and the DOM effect re-runs, so a custom value replaces the default **after** the first paint. `:260-262` returns `null` until mounted |
| How custom tokens apply (`:106-253`) | Every override is `custom || default`, and **the same custom value wins in light and in dark**. There is no dark-specific custom value. The overridable keys, each mapped to one variable: `colors.{background, surface, surfaceHover, border, textPrimary, textSecondary, textMuted, primary, primaryDark, secondary, successBg, successBorder, successText, successIcon, errorBg, errorBorder, errorText, errorIcon}` (18), `borderRadius.{panel, card, button, input}` (4), `shadows.{card, cardHover, button}` (3), `spacing.{panel, card, section}` (3), `typography.{fontSizeBase, fontSizeLg, fontSizeXl}` (3). The 12 `--v2-status-*` values are **not** overridable. An empty string falls through to the default (`||`). A non-string value is passed to `setProperty` as-is |
| Exact allow-list | 18 + 4 + 3 + 3 + 3 = **31 keys → 31 variables**. The remaining 12 of the 43 are the status family. The guard (§10.1 T-T2) asserts the number, so a miscount here is caught |
| Who reads the tokens | Only the provider. `customTokens` is exposed on the context, but no consumer reads it (grep: the only `useV2Theme` callers are `BusinessOSHeader.tsx:30`, `DarkModeToggle.tsx:11`, `onboarding-chat/page.tsx:177`, and they destructure `mode`/`toggleMode` only) |
| Who writes the tokens | `app/api/admin/ui-config/route.ts`, admin-gated (`requireAdmin`). `save_tokens` upserts the client's object **with no validation** (`:113-142`). `reset_tokens` deletes the row (`:144-162`). The route uses its own service-role client (not a repository), has no Zod and **8** `console.*` calls. It is not touched by this slice (§2.10, R2-Q6) |
| The admin page | `app/admin/ui-config/page.tsx` reads and writes only through that route (`fetch('/api/admin/ui-config')`). It imports `@/lib/design-system-v2/tokens` directly, not the barrel and not the provider. Its previews use its own state. **It does not depend on the removed browser read** |
| Repository | `lib/repositories/SystemConfigRepository.ts`. Default client `supabaseServer` (service role). `getByKey(key)` (`:154-183`) returns `{ data: null, error: null }` on no row (`PGRST116`), `{ data: null, error }` on failure, never throws, and logs only the key. `getImageGenerationConfig()` (`:556-614`) is the house precedent for a never-throwing typed getter that validates and falls back per key. The table has no `user_id` column (`SystemSettingsConfig` in `lib/repositories/types.ts:513-522`) |
| Server fetch path | `supabaseServer` uses `supabaseFetch` (`lib/supabaseFetch.ts`): bounded concurrency, a timeout, and retries on transient network errors. It calls the global `fetch`, which Next 14 patches. In a `force-dynamic` segment that fetch is uncached. In a **static** segment, Next's Data Cache would cache it (relevant to §2.9) |
| Mounts | Server layouts `app/business-os/layout.tsx:82`, `app/onboarding-build/layout.tsx:41`, `app/onboarding-chat/layout.tsx:40` (all `force-dynamic`). Client layouts `app/business-os/crm/layout.tsx:23` (**nested inside the Business OS one**) and `app/v2/layout.tsx:16` (legacy, **not** force-dynamic, so `/v2` pages are statically prerendered at build). *(Superseded by IN-6: `/v2` was already dynamic at base; `force-dynamic` is kept as a local guarantee.)* `app/v2/layout.tsx` has no hooks; `'use client'` is there only by habit. `V2Footer` is its own `'use client'` component |
| `--v2-*` in stylesheets | Only `app/v2/globals-v2.css` (`:root` at `:8`, `html.dark` at `:68`), imported by `/v2` and `/business-os/crm`. `/business-os` and `/onboarding-*` have **no** stylesheet values, so the variables exist only once the provider's effect has run |
| Consumers of `mode` in render | `BusinessOSHeader.tsx:150-154` (Sun/Moon icon), `components/v2/DarkModeToggle.tsx:22-28,44` (icon, aria-label, hover tooltip), `app/onboarding-chat/page.tsx:177` (destructured, **unused** in render) |
| Other `.dark` writers | `lib/hooks/useTheme.ts` also toggles `.dark`, but nothing imports it (dead code, not touched) |
| Root `<html>` | `app/layout.tsx:55`, `lang="en" dir="ltr" suppressHydrationWarning`, **no `className`**. So adding `.dark` before hydration raises no attribute mismatch |
| Content before the layout's first element | `PlatformChrome` → `PlatformShell` renders `SessionRecheckOnRestore` (renders nothing) and `UserProvider`. Nothing visible precedes the layout, so a script or style placed first in the layout is applied before any visible content is parsed |
| BR-1a precedent | `components/business-os/OwnerDirScript.tsx`, rendered first in each owner layout, outside every provider. `lib/business-os/__tests__/ownerLanguageFirstFrame.guard.test.ts` pins its placement (G-1) and the "start before the payment hold, use after it" ordering of the language read (G-2). **G-2(ii) matches the exact text `await Promise.all([readPlanBadge(), initialLanguagePending])`** and G-2(ii) for onboarding matches `await initialLanguagePending`. §2.7.4 is shaped so those guards stay green unchanged |
| BR-1a/plan-pill caching precedent | `readPlanBadge` is not cached itself. Its input comes from `EntitlementService`, a process-level `Map` with a 30 s TTL (`CACHE_TTL_SECONDS`), stale inputs kept for fail-open surfaces, and an explicit invalidation method. §2.7.3 follows that shape |
| Existing guard | `lib/design-system-v2/__tests__/statusTokensMatchStylesheet.guard.test.ts` pins the 12 `--v2-status-*` values between `globals-v2.css` and the provider by **parsing the provider's source** (it splits on `'      : {'`). This plan leaves the provider's tables untouched for that reason |
| RLS | Migration `supabase/migrations/20260920a_lock_system_settings_and_pricing_rls.sql` keeps `system_settings_config` anon-readable **because** of the browser theme read (`:22`, `:58-63`, `:82-83`). It names two more anon-client readers of the table, `OrchestrationService` and `MemoryCompressor` (`:23-24`, `:62-63`). Removing the theme read does **not** by itself make the table safe to close (§9.2) |
| CSP | No `Content-Security-Policy` header in `next.config.*`, `middleware.ts` or `vercel.json`. Inline `<script>` and `<style>` are therefore allowed today (R-17) |

**What the null hides** (SA §2, confirmed by reading): the header, the tabs and each page's loading state. It never hides business data, which still waits for JavaScript and an API round trip.

**Production fact (T-0(e), main session, read-only):** one non-empty `v2_custom_tokens` row exists. It overrides `colors.primary` and `colors.secondary`, both different from the defaults. **Values deliberately not recorded** (public repo). So today every owner page shows the default primary/secondary from mount until the browser read resolves, then swaps.

**Domain skills checked:**
- `business-os-entitlements`: `app/business-os/layout.tsx` imports `readPlanBadge` and is registered. This slice adds no import from the module and removes none. `npm run test:bos-entitlements` runs before handover anyway.
- `tenant-isolation-guard`: the new read is a **global, non-tenant** key/value read with a constant key. No write, no caller-supplied id, no user data. Not applicable beyond documenting why there is no `user_id` filter (§2.7.2).
- `business-os-schema-check`: the read names only `system_settings_config.key` and `.value`, both already read by the provider, `getByKey` and the admin route. No new column claim. The check is re-run against the live schema at T-2 anyway (`select column_name from information_schema.columns where table_name = 'system_settings_config'`, read-only, main session).
- `new-repository`: no new repository. `getByKey` is reused (§2.7.1, R2-Q1). If SA prefers a dedicated method, the skill is followed for it.
- `durable-queue-drain`, `bos-llm-call-standards`, `new-api-route`: not applicable. No job, no LLM call, no new route.

**`console.*` count in every file this slice touches** (re-counted at `936dfd04`):

| File | `console.*` calls | Action |
|---|---|---|
| `lib/design-system-v2/theme-provider.tsx` | **1** (`:72` `console.error`) | **Flagged.** Deleted together with the browser fetch it belongs to. The file has no logging afterwards (G-5) |
| `components/business-os/BusinessOSHeader.tsx` | 0 | — |
| `components/v2/DarkModeToggle.tsx` | 0 | — |
| `app/business-os/layout.tsx` | 0 | — |
| `app/business-os/crm/layout.tsx` | 0 | — |
| `app/onboarding-build/layout.tsx` | 0 | — |
| `app/onboarding-chat/layout.tsx` | 0 | — |
| `app/v2/layout.tsx` | 0 | — |
| `app/v2/settings/page.tsx` (only if T-1 needs it, §6) | 0 | — |
| `components/business-os/OwnerDirScript.tsx` (comment only) | 0 | — |
| `lib/business-os/LanguageContext.tsx` (comment only) | 0 | — |
| `lib/repositories/SystemConfigRepository.ts` | 0 | **Not modified** if R2-Q1 approves reusing `getByKey`. If SA asks for a dedicated method, it stays at 0 |
| Test files touched for comments (`LanguageContext.initialLanguage.render.test.tsx`, `ownerLanguageFirstFrame.guard.test.ts`) | 0 | — |
| New files | 0 | Use no `console.*` |
| **Read but not modified:** `app/api/admin/ui-config/route.ts` | **8** | **Flagged, not touched** (R2-Q6). It also has no Zod and a direct service-role client (rules 1 and 2). If SA rules that the route must change in this slice, the whole file is converted to Pino in the same change, per CLAUDE.md § Logging |
| **Read but not modified:** `app/admin/ui-config/page.tsx` | **4** | **Flagged, not touched.** No change is needed there (§2.10) |

Any page file that T-1 forces me to touch gets its count recorded in Implementation Notes before it is edited.

---

## §2 Implementation Approach

### §2.1 The default-token stylesheet (part 1)

**New file:** `lib/design-system-v2/v2-theme-tokens.css`. It is imported by every layout that mounts the provider (§2.4). It contains **only custom properties** in exactly two rules:

```css
:root      { /* 43 light values: exactly what the provider writes with no custom tokens */ }
:root.dark { /* the values that differ in dark mode */ }
```

- **Values = the provider's output with empty `customTokens`**, never `globals-v2.css`. The two already differ. For example, the provider writes dark `--v2-success-bg` as `rgba(6, 95, 70, 0.15)` and `globals-v2.css` has no dark value for it. After mount the provider's inline style wins, so the stylesheet must equal the provider exactly. Otherwise the page would change colour at hydration, which is the flash this slice exists to remove.
- **No name the provider does not write.** `globals-v2.css` also declares `--v2-text-tertiary`, `--v2-success`, `--v2-error` and `--v2-warning`, which the provider never sets. On `/business-os` those are undefined today. Defining them would change what renders there. The guard asserts an exact name set.
- **`:root.dark`, not `.dark`** (specificity 0,2,0). It beats the light `:root` (0,1,0) and `globals-v2.css`'s `html.dark` (0,1,1) regardless of load order. Radix portals mount in `body` and inherit from `<html>`.
- **Why not import `globals-v2.css`** (SA): it also carries global rules: `*` transitions, scrollbars, joyride, and date-input `!important`. Those would change `/business-os` and `/onboarding-*`.
- **Why per-layout imports and not an import inside the provider:** the barrel `lib/design-system-v2/index.ts` re-exports the provider and is imported by many `/v2` components for `cn`. A CSS import in the provider would load the sheet wherever the barrel is reached. Per-layout imports keep the sheet exactly where the provider is, and a guard keeps the two sets equal.
- **Where `globals-v2.css` is also loaded** (`/v2`, `/business-os/crm`): RC-2 defines the assertion (§10.1 T-T1(4)).

The custom tokens are **not** in this sheet. They are per-deployment data and go in an inline `<style>` (§2.8).

### §2.2 The pre-paint theme script (part 2)

**New file:** `lib/design-system-v2/V2ThemeScript.tsx`, a sibling of `OwnerDirScript`. It is a plain component (no hooks, no `'use client'`) that renders one inline `<script>`. Its body is a **module-level constant string**: no props, no request data, no interpolation. The only interpolated value is the storage key, `JSON.stringify`'d at module load from a shared constant. It is fixed at build time.

Behaviour, **mirroring the provider exactly** (SA ruling on surprise 2):

```js
(function(){try{
  var m = localStorage.getItem('v2-theme-mode');
  var dark = m ? m === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.classList.toggle('dark', dark);
}catch(e){}})();
```

- `m ? … : …` reproduces the provider's `if (savedMode)` truthiness. A parity test (§10.2 T-S2) pins the script to the provider.
- `try/catch`: if storage throws, the script does nothing, the page paints light, and the provider behaves exactly as today.
- **Placement:** first in each layout's returned tree, directly after `OwnerDirScript` where that exists, and outside every provider. **Segment level only**, never in `app/layout.tsx`, because public pages must never get `.dark` (`globals.css:45-75`). Guard G-3.
- It does not run on client-side navigation. RC-1's layout effects (§2.3) cover that case.
- **A shared constant** `V2_THEME_STORAGE_KEY = 'v2-theme-mode'` goes in `lib/design-system-v2/themeMode.ts`. Both the provider and the script import it.

### §2.3 The provider (part 3)

> **As changed by SA RC-16 (2026-10-15):** the provider takes a second prop, `customTokensKnown` (default `true`). Only when it is `false` (a cold server render whose token read missed its deadline) does it make **one** `fetch('/api/design-system/v2-custom-tokens', { cache: 'no-store' })` in a plain `useEffect`, re-sanitize the answer with `sanitizeV2CustomTokens`, and apply it through the existing `applyTheme` path (it replaces the server prop in state, and the mode effect re-applies). Any failure keeps the defaults silently (client logger `warn` only, no `console.*`); nothing is written after unmount (abort plus a `cancelled` flag). No `supabaseClient` (G-8, T-P5 unchanged).

`lib/design-system-v2/theme-provider.tsx`:

1. **Delete `:260-262`** (`if (!mounted) return null`). The provider always renders `ThemeContext.Provider` + children.
2. **Delete the browser read (`:59-76`), the `supabase` import (`:8`) and the `console.error` with it.** The provider no longer touches the database or logs anything.
3. **New prop `customTokens?: V2CustomTokens`** (default `{}`), the server-validated object (§2.7). The `customTokens` **state is removed**; the DOM effect reads the prop. Its dependency list becomes `[mode, mounted, customTokens]` with `customTokens` now the prop, so the line is textually unchanged. The prop is stable for the life of the layout (a layout is not re-rendered on in-segment client navigation), so the effect does not re-run on navigation. On the first effect run the provider writes **custom values, never defaults first** (T-P7), so it cannot overwrite the inlined `<style>` with defaults.
4. **RC-1: both effects run through a module-scope isomorphic layout effect.** `const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect`. A client-side entry into an owner segment (sign-in through `app/auth/callback/page.tsx:151`, the `(protected)` layout link at `app/(protected)/layout.tsx:534`) then sets `.dark` and every variable, custom ones included, **before paint**. During hydration this changes nothing visible: the HTML is already painted and the re-render happens before the browser regains control. The `if (!mounted) return` guard is unchanged. **As built (Implementation Notes IN-2):** the mount effect writes the DOM directly via `applyTheme(initialMode)` and moves `setMode`/`setMounted` into `startTransition`, because a synchronous context update during hydration forced the Suspense boundary to client-render the page.
5. **Keep `if (!mounted) return` on the DOM effect.** On the first (hydration) commit, `mode` is still `'light'`. Without the guard the effect would remove the `.dark` the script set, persist `'light'` and write light variables, which is a flash and would **overwrite a saved choice**.
6. **The `mode` state still starts at `'light'`** on both server and client. Mode-dependent rendering moves to CSS (§2.5).
7. **RC-5: a fail-soft `<Suspense fallback={null}>` around `children`** inside the provider (Q-2, approved). A code comment states why it exists (§5 Q5) and that it must not be widened to a non-null fallback without SA. It is a net, **not** a pass condition: T-10 counts any server render error and any "switched to client rendering" message as a failure.
8. The context value keeps `customTokens` (now the prop), so the context type is unchanged.
9. **RC-6 is moot.** It asked for `clientLogger.warn` on the fetch failure. There is no fetch any more. The server reader logs instead (§2.7.5).

The provider imports only the **type** `V2CustomTokens` from `customTokens.ts` (§2.7), so no validation code and no server code reaches the client bundle through it.

### §2.4 Layouts

| Layout | Change |
|---|---|
| `app/business-os/layout.tsx` | `import '@/lib/design-system-v2/v2-theme-tokens.css'`. Start `const customTokensPending = readV2CustomTokens();` **next to** `initialLanguagePending`, before `await redirectIfAwaitingPayment()`. Await it after the existing `Promise.all` (§2.7.4). Render `<V2ThemeScript />` and `<V2CustomTokensStyle tokens={customTokens} />` directly after `<OwnerDirScript … />`, outside every provider. Pass `customTokens={customTokens}` to `<V2ThemeProvider>`. Update the RC-2 comment: the reason for placement is now "before any content is parsed", not "the provider renders null" |
| `app/onboarding-build/layout.tsx`, `app/onboarding-chat/layout.tsx` | Same as above |
| `app/v2/layout.tsx` | **Becomes a server layout** (drop `'use client'`) with `export const dynamic = 'force-dynamic'`, the same import, read, script, style and prop. No payment hold exists here, so the read is simply awaited. §2.9 explains the choice |
| `app/business-os/crm/layout.tsx` | **Remove the nested `V2ThemeProvider` and `'use client'`** (Q-1, approved). Keep `import '../../v2/globals-v2.css'`. It needs no token read: the Business OS layout above it already inlines the tokens and mounts the provider |

### §2.5 Mode-dependent JSX: hydration-safe and right from the first frame

CSS-driven icons (Q-3, approved): `<Moon className="… dark:hidden" />` and `<Sun className="… hidden dark:block" />` in `BusinessOSHeader` and in `components/v2/DarkModeToggle.tsx`. `@custom-variant dark (&:where(.dark, .dark *))` (`globals.css:50`) makes them follow the class the script sets. Server and client markup are identical whatever the mode, and the right icon shows from the first frame. `DarkModeToggle`'s `aria-label` and tooltip stay driven by `mode` (R-8, accepted residual).

`app/onboarding-chat/page.tsx:177` keeps its unused `mode` destructure (SA optimisation note: harmless).

### §2.6 Stale comments brought up to date (no behaviour change)

`OwnerDirScript.tsx:16-19`, `LanguageContext.tsx:~536`, `LanguageContext.initialLanguage.render.test.tsx:17-19` and `:277-278`, and the RC-2 comments in the three layouts and in `ownerLanguageFirstFrame.guard.test.ts:46-47` all say the provider "renders nothing on the server". After TH-1 that is false. P-8 ("defensive only … guards the day it starts to") becomes the production path. The comments are reworded. The assertions are unchanged. The migration `20260920a` comments are **not** edited (applied migrations are history); TH-2b's requirement records that the theme read named there is gone.

### §2.7 The server read of custom tokens (TH-2 folded in)

#### §2.7.1 Data access (CLAUDE.md rule 1)

Today the table is read through `SystemConfigRepository` everywhere on the server except the theme provider and the admin route. The reader **reuses `systemConfigRepository.getByKey(V2_CUSTOM_TOKENS_CONFIG_KEY)`**: one `select('*')` by `key`, `.single()`, no row returns `{ data: null, error: null }`, failure returns `{ data: null, error }`, and it never throws. No new repository method, no change to the repository file, which follows the user's "reuse existing infra" preference. `getByKey` selects `*` (a few extra small columns). A dedicated `select('value')` method is the alternative; that is R2-Q1.

The key constant `V2_CUSTOM_TOKENS_CONFIG_KEY = 'v2_custom_tokens'` lives in `lib/design-system-v2/customTokens.ts`. The admin route keeps its own literal, because it is not touched (R2-Q6).

#### §2.7.2 Client and tenant scope (CLAUDE.md rule 4)

- **Client: `supabaseServer` (service role)**, the repository's default. Documented in the reader's header comment: this is an intentional RLS bypass for a **read-only, platform-wide** setting. The service role is chosen, rather than the anon or cookie client, so the read keeps working when TH-2b tightens the table's read policy, and so no browser credential is involved.
- **No `user_id` filter**, documented in the same comment: `system_settings_config` has no `user_id` column. It is a global key/value table of platform settings, and `v2_custom_tokens` is one platform-wide value that every owner sees. The key is a module constant, never caller-supplied. No user data is read, and nothing user-specific is returned or cached.
- `tenant-isolation-guard`: no write, no caller-supplied id. Not applicable beyond this note.

#### §2.7.3 The reader: `lib/design-system-v2/server/readV2CustomTokens.ts`

```ts
import 'server-only';
export async function readV2CustomTokens(): Promise<V2CustomTokens>
```

Its contract, each item asserted in §10.6 T-R:

1. **Never throws, never rejects.** A failed read, a thrown error, no row, a non-object value: all return the last good value if one is cached, otherwise `{}`. `{}` means the defaults, which is exactly today's outcome when the browser read fails. It is safe to leave dangling when the payment hold redirects (the BR-1a contract).
2. **Returns only validated values** (§2.7.6). Unknown groups or keys are dropped. Invalid values are dropped one key at a time, so one bad value does not discard the others. The result is a fresh plain object, **frozen deeply** (the root and each group, RC-13(b)), because the cached object is shared across requests in the process.
3. **Process-level cache, TTL 60 s**, shaped like `EntitlementService`'s: **Superseded in part by SA RC-15 (stale-while-revalidate):** when a last good value exists it is returned **at once**, whether fresh, expired or in back-off; an expired value starts (or joins) the single flight **without** awaiting it. Only a call with **no** value waits. No `waitUntil`/`after`: a refresh outliving its request resumes or times out on the next invocation while the stale value keeps being served.
   - A fresh entry (age ≤ 60 s) is returned without a read.
   - An expired or missing entry triggers one read. **Single-flight:** concurrent callers share the same in-flight promise, so a burst of page loads on a cold instance costs one query.
   - **Stale-on-error:** if the refresh fails and a last good value exists, it is returned, and the failure is retried after a short back-off (10 s), not on every request and not after a full TTL.
   - **Negative back-off (RC-10(b)):** a failure with **no** last good value returns `{}` and is **also** not retried for 10 s, so a database outage on a cold instance costs one query per 10 s, not one per request.
   - **Deadline (RC-10(a)):** every wait for a refresh, cold or expired, is raced against `V2_CUSTOM_TOKENS_DEADLINE_MS = 1000`. If the deadline fires, the caller gets the last good value or `{}`. The shared in-flight read **continues** and fills the cache when it lands. The timer is cleared when the read wins. One `warn` with `{ deadlineMs }` per flight, not per waiting caller.
   - **Logging without double counting (R2-Q9):** on a `{ error }` result `getByKey` has already logged at `error` with the `err`, so the reader logs `warn` with `{ reason: 'read_failed' }` only. It logs `{ err }` only for what it catches itself (a throw, a non-object value); the deadline logs `{ deadlineMs }`.
   - No value-dependent eviction; one key, so no size cap is needed.
   - An exported `__resetV2CustomTokensCacheForTests()` for the tests only (named so, and G-11 checks no production file calls it).
4. **TTL justification (60 s).** The tokens are platform-wide, change only when an admin saves in `/admin/ui-config`, and are cosmetic. Without a cache, every full load of every owner page would add a database read for a value that changes perhaps a few times a year. With a 60 s cache a warm instance reads once a minute at most. 60 s is a staleness bound an admin can be told ("changes appear within a minute"), and it is the same order as `EntitlementService`'s 30 s for the plan pill, which is more consequential. R2-Q2 asks SA whether 30 s for house consistency is preferred; the hit rate is almost the same.
5. **How a change propagates.** On Vercel each warm serverless instance has its own cache. After an admin save or reset, each instance serves the old tokens until its entry is older than 60 s; a cold instance reads fresh at once. So a save shows on the **next full page load** within 60 s at most. An owner already on a page sees it on their next full load, which is the same as today (the browser read also ran only at mount). Client-side navigation inside a segment does not re-render the layout, so it keeps the tokens of the last full load, as today.
6. **Deadline: 1000 ms (RC-10, SA reversed R2-Q4).** `supabaseFetch`'s timeout is 20 s in production and `AbortError` is not retried; with single-flight, one stalled socket on a cache miss would hold every owner page on that instance for up to 20 s. That is a new blocker, which this slice must not add. The deadline bounds it. Its cost: on a read slower than 1000 ms, that page load shows defaults (or the last good value) with no later swap, which equals today's outcome when the browser read fails. Worst-case propagation per instance becomes "TTL plus one page load". If the measured cold-miss p95 (§7.3) exceeds 500 ms, the value goes back to SA before T-12 passes. **As changed by RC-15/RC-16:** the deadline now applies only to a call with no last good value (a cold instance). A missed deadline renders the defaults with `known: false`, and the provider corrects the page from the browser (RC-16), so this path equals today's behaviour instead of falling below it. `readV2CustomTokens()` (the name the layouts' guards pin) now returns `{ tokens, known }`; `readV2CustomTokensWithStatus({ waitMs })` is the same read with a caller wait (`V2_CUSTOM_TOKENS_ROUTE_WAIT_MS = 5000` for the route), on the same single flight.

#### §2.7.4 Where it is read: overlap with the payment hold (BR-1a latency lesson)

> **RC-16:** the three gated layouts now destructure `const { tokens: customTokens, known: customTokensKnown } = await customTokensPending;` and pass `customTokensKnown` to the provider. The start line `const customTokensPending = readV2CustomTokens();` (G-7 and the `paymentHold` guard) is unchanged. `/v2` destructures the same way.

In the three gated layouts the read is **started before** `await redirectIfAwaitingPayment()` and **awaited after** it, exactly like `initialLanguagePending`. The tokens are not user-specific, so starting the read before the hold decides leaks nothing; if the hold redirects, the promise is left dangling, which is safe because it never rejects.

Shape, chosen so the BR-1a G-2 text guards stay green **unchanged**:

```ts
const initialLanguagePending = readInitialLanguage();
const customTokensPending = readV2CustomTokens();   // started, not awaited
await redirectIfAwaitingPayment();
const [planBadge, initialLanguage] = await Promise.all([readPlanBadge(), initialLanguagePending]);  // unchanged line
const customTokens = await customTokensPending;     // already in flight: no serial round trip
```

Onboarding layouts: `const initialLanguage = await initialLanguagePending;` (unchanged line), then `const customTokens = await customTokensPending;`. Two awaits of promises that are both already in flight add no round trip. On a cache hit the read resolves in a microtask.

`/v2`: no hold, so `const customTokens = await readV2CustomTokens();`. It is the only read before render there, so on a cache miss it is one serial round trip on a legacy, unlinked segment (R2-Q4).

The §7.3 document-response gate (20 interleaved pairs, pooled) applies and is now measured **with a cold cache in at least one pair per batch** (§7.3), so the miss path is seen.

#### §2.7.5 Logging (CLAUDE.md § Logging)

`createLogger({ module: 'V2CustomTokensRead' })`. `warn` when the read fails or the value is not an object (`{ err }` only), `warn` with `{ droppedKeys: string[] }` (**key names only**) when values fail validation, **`info` with `{ ms, keys }` (a duration and a count only) on every completed read** (SA CR-1: production logs at `info` only, so this line is the data source for the §7.3 cold-miss gate; at most one per TTL per instance, plus one per back-off while failing). The failure `warn`s also carry `ms`. **Never a token value**: the values are not secret, but this keeps them out of logs by the same rule as `getImageGenerationConfig` ("logs key names and counts, never configuration values"). `getByKey` also logs a failure at `error` with the key name; that is existing behaviour.

#### §2.7.6 Validation: `lib/design-system-v2/customTokens.ts`

A pure module (no `server-only`, no React, no I/O), used by the reader and by the style builder, and imported as a **type only** by the provider.

- `V2_CUSTOM_TOKEN_VARS`: the allow-list, `{ group: { key: '--v2-…' } }` for the **31 keys** in §1, each mapped to the variable the provider writes for it. This is the single source for the style builder. The provider keeps its own code unchanged (the status guard parses its source); T-T2 proves the two agree behaviourally.
- `sanitizeV2CustomTokens(raw: unknown): V2CustomTokens`:
  - `raw` must be a plain object; each group must be a plain object. Arrays, `null`, numbers, strings: dropped.
  - Iterates the **allow-list**, never `raw`'s own keys, so `__proto__`, `constructor` and unknown keys are never read or copied. Uses `Object.prototype.hasOwnProperty.call`.
  - Each value must be a **string**, trimmed length 1–200, and match its group's grammar:

| Group | Grammar (anchored, case-insensitive where noted) | Accepts | Rejects |
|---|---|---|---|
| `colors` | hex `#` + 3, 4, 6 or 8 hex digits; **or** `rgb(`/`rgba(`/`hsl(`/`hsla(` + only `[0-9.,%\s/]` + `)`; **or** a bare keyword `^[a-z]{3,30}$` (named colours, `transparent`, `currentColor`) | `#6366F1`, `rgba(6, 95, 70, 0.15)`, `hsl(240 50% 50% / 0.5)`, `rebeccapurple` | `var(--x)`, `url(…)`, `expression(…)`, `red;}`, `red</style>`, `#12345` |
| `borderRadius`, `spacing`, `typography` | 1 to 4 space-separated lengths, each `0` or a number (≤ 4 integer digits, ≤ 3 decimals) with `px`, `rem`, `em` or `%` | `24px`, `1.125rem`, `0`, `8px 16px` | `calc(…)`, `24px;`, `-1px` |
| `shadows` | `none`; or comma-separated shadows whose characters are only `[0-9a-z#.,%()\s-]`, **and** every alphabetic run (after removing hex colours) is in `{inset, px, rem, em, rgb, rgba, hsl, hsla}` | every `v2Tokens.shadows` value, `0 2px 16px rgba(0, 0, 0, 0.3)`, `none` | anything with `;`, `{`, `}`, `<`, `>`, `\`, quotes, `/`, `*`, `@`, `url`, `var`, `expression` |

  - No grammar admits `;`, `{`, `}`, `<`, `>`, `\`, quotes, `@` or `*`. A value therefore cannot end the declaration, close the rule, open a comment, or close the `<style>` element.
  - An empty string is dropped (it falls through to the default today too, via `||`).
- Every `v2Tokens` default for every allow-listed key passes its grammar (T-C3), so an admin who saves a default value does not have it dropped.
- **Behaviour difference from today, stated:** today the provider applies **any** stored value, valid or not. After this slice a value outside the grammar is ignored and the default shows. That is why T-0(g) checks the live row passes unchanged before T-2.

### §2.8 Inlining the tokens: `lib/design-system-v2/V2CustomTokensStyle.tsx`

A plain component (no hooks, no `'use client'`), a sibling of `V2ThemeScript`. Props: `{ tokens: V2CustomTokens }`. It renders `null` when there is no valid value, otherwise one element:

```html
<style data-v2-custom-tokens="">:root:root:root{--v2-primary:#…;--v2-secondary:#…}</style>
```

- **Built by `buildV2CustomTokenCss(tokens)`** in `customTokens.ts`. It walks the allow-list (never the input's keys), **re-checks each value against its grammar** (defence in depth: the component may be handed an object that skipped the reader), and emits the **trimmed, validated** string (RC-13(a)), never the raw one, as `name:value` pairs joined by `;`. Rendered through `dangerouslySetInnerHTML` with that string only. React does not escape `<style>` content usefully for CSS, which is why safety rests on the grammar and the allow-list, not on escaping. The guard (T-C4) feeds injection payloads straight to the builder.
- **Light and dark, exactly as the provider does today:** every custom value overrides the default **in both modes** with the same value; there is no dark-specific custom value, and the status family is never overridden (§1). So **one** rule that applies in both modes is the faithful translation.
- **Selector `:root:root:root`** (specificity 0,3,0). It beats the default sheet's `:root` (0,1,0) and `:root.dark` (0,2,0), and `globals-v2.css`'s `:root` and `html.dark` (0,1,1), **regardless of load order**. That matters because this `<style>` sits in `<body>` and the sheets in `<head>`, and Next may reorder CSS chunks. Only the provider's inline style on `<html>` beats it, and after mount that inline style holds the same values (T-P7). Guarded: the selector is asserted exactly, and a mutation to `:root` must fail the dark-mode parity test (T-T2).
- **Placement:** in the segment layout, outside every provider, directly after `<V2ThemeScript />` (so after `OwnerDirScript`). **Never in `app/layout.tsx`**: public pages must not carry owner-product tokens. Guards G-1, G-2, G-3.
- **Client-side navigation:** entering a segment client-side inserts the layout's `<style>` with the RSC payload, and RC-1's layout effect writes the same values inline before paint. Leaving to a public page removes the `<style>`; the provider's inline variables on `<html>` stay, which is the pre-existing TH-3 and unchanged.
- **Hydration:** the `<style>` comes from a server component and is identical in the HTML and the RSC payload, so `dangerouslySetInnerHTML` matches (the same mechanism as `OwnerDirScript`).

### §2.9 `/v2`: a server layout, `force-dynamic` (R2-Q3)

> **Superseded in part by IN-6:** the base build shows every `/v2/*` route is already `ƒ` (dynamic): an ancestor already opts the segment out of prerendering. So option B's "bake the tokens in at build" risk was latent, not live, `/v2` does not change rendering mode, and the route table does not change. `force-dynamic` and G-9 are kept as a **local** guarantee (SA code review, focus item 3), so an unrelated ancestor change cannot make `/v2` static and bake the tokens in.

`app/v2/layout.tsx` is a client layout only by habit: it has no hooks, and everything it renders (`V2ThemeProvider`, `V2Footer`) is its own client component. Options considered:

| Option | Result | Verdict |
|---|---|---|
| **(A) Server layout + `force-dynamic`** | Tokens read per request (cached 60 s), inlined, passed as a prop: `/v2` behaves like the owner segments. `/v2` pages stop being prerendered at build (superseded by IN-6: they already were not) | **Recommended** |
| (B) Server layout, still static | The read would run **at build**, and Next's Data Cache would keep the patched `fetch` result: the tokens baked into static HTML until a redeploy. An admin save would never show on `/v2`. A CI build with no database would bake defaults | Rejected |
| (C) Server layout + ISR (`revalidate = 60`) | Works in principle, but relies on the Data Cache semantics of a `fetch` inside `supabase-js`, adds a build-time database read, and is a new pattern in this repo | Rejected (new pattern, more moving parts) |
| (D) Keep the client layout, defaults only, accept no custom tokens on `/v2` | **Changes output**: `/v2` would lose the brand colours it shows today | Rejected (Q1 fails) |
| (E) Keep the client layout and keep a browser fetch for `/v2` only | Keeps the rule-1 violation and the swap | Rejected (defeats the fold-in) |

Why (A) is acceptable: `/v2` is legacy and unlinked (middleware sends nobody there; pages "still resolve if visited directly", `middleware.ts:333-334`). A per-request server render of a client page is cheap, and the token read is cached. Side effects, all checked in T-1/T-10:
- The predicted `/v2/settings` **build** break (§6.2) should disappear, because a dynamic page does not hit the static `useSearchParams` bailout. The Q-2 boundary stays anyway (Q5).
- RC-4 status parity matters more: `/v2/billing`'s `redirect()` runs per request under a boundary. Base vs branch status codes are recorded.
- ~~`next build`'s route table changes `/v2/*` from ○ (static) to ƒ (dynamic).~~ Superseded by IN-6: `/v2/*` is `ƒ` at base and on the branch; the route table is unchanged.

### §2.10 The admin save path (`/admin/ui-config`)

- **The page does not depend on the removed fetch.** It reads and writes through `/api/admin/ui-config`, imports `tokens.ts` directly, and previews from its own state (§1). No change is needed.
- **A save shows on the next owner page load within the TTL** (§2.7.3 item 5). A reset (row deleted) likewise returns to the defaults within the TTL: `getByKey` returns no row, the reader returns `{}`.
- **No invalidation hook in this slice** (R2-Q6). Calling an in-process invalidation from the save route would only clear the instance that handled the POST, not the instance that serves the next page, so it buys little on Vercel. It would also mean touching a route with 8 `console.*` calls, no Zod and a direct service-role client, which pulls a conversion and two rule fixes into a theme slice.
- **Write-side validation is not added** (the route stays as is). The read side is the security boundary: whatever the route stores, only grammar-valid values reach the HTML. The route's missing Zod is recorded as a follow-up (§9.3).
- Manual QA (§10.8): save a synthetic token **in a non-production environment only**, or, where only production exists, **skip the write** and verify propagation through the T-R cache tests plus the read-only production smoke. **Nobody saves tokens in production for testing.**

---

## §3 Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/design-system-v2/v2-theme-tokens.css` | create | Part 1: static default `--v2-*` light/dark values, custom properties only |
| `lib/design-system-v2/themeMode.ts` | create | `V2_THEME_STORAGE_KEY` shared by the provider and the script |
| `lib/design-system-v2/V2ThemeScript.tsx` | create | Part 2: static pre-paint `.dark` script |
| `lib/design-system-v2/customTokens.ts` | create | `V2CustomTokens` type, `V2_CUSTOM_TOKENS_CONFIG_KEY`, the 31-key allow-list → variable map, `sanitizeV2CustomTokens`, `buildV2CustomTokenCss`. Pure |
| `lib/design-system-v2/server/readV2CustomTokens.ts` | create | `server-only`, never-throwing, validated, cached server read via `systemConfigRepository.getByKey` |
| `app/api/design-system/v2-custom-tokens/route.ts` | create (RC-16) | Public GET correction route: `readV2CustomTokensWithStatus({ waitMs: 5000 })`, 200 only when known, else 503, `no-store`, `force-dynamic`, output sanitized |
| `app/api/design-system/v2-custom-tokens/__tests__/route.test.ts` | create (RC-16) | Route integration test: happy path, known reset, 503 unknown, poisoned value |
| `lib/design-system-v2/V2CustomTokensStyle.tsx` | create | Inline `<style>` of the validated custom tokens |
| `lib/design-system-v2/theme-provider.tsx` | modify | Drop the `return null`; delete the browser read, the `supabase` import and the `console.error`; `customTokens` prop; isomorphic layout effects (RC-1); keep the DOM-effect guard; fail-soft boundary (RC-5); shared key |
| `components/business-os/BusinessOSHeader.tsx` | modify | CSS-driven Sun/Moon icon (`:150-154`) |
| `components/v2/DarkModeToggle.tsx` | modify | CSS-driven Sun/Moon icon (`/v2` footer) |
| `app/business-os/layout.tsx` | modify | Sheet import; token read started before the hold, awaited after; script + style; prop; comment |
| `app/onboarding-build/layout.tsx` | modify | Same |
| `app/onboarding-chat/layout.tsx` | modify | Same |
| `app/v2/layout.tsx` | modify | Server layout, `force-dynamic`, sheet import, token read, script + style, prop (§2.9) |
| `app/business-os/crm/layout.tsx` | modify | Remove the nested provider and `'use client'`, keep `globals-v2.css` |
| `app/v2/settings/page.tsx` | modify **only if** T-1 shows a build or render break the boundary does not clear | `<Suspense fallback={null}>` around the `useSearchParams` consumer |
| Other page/component files | modify **only** for defects found by T-1 / T-10 | Each is listed in Implementation Notes with its `console.*` count and the reason |
| `components/business-os/OwnerDirScript.tsx` | modify (comment) | Stale "renders null" rationale |
| `lib/business-os/LanguageContext.tsx` | modify (comment) | Stale "Not in the server HTML" note |
| `lib/business-os/__tests__/LanguageContext.initialLanguage.render.test.tsx` | modify (comments) | P-8 is now the production path |
| `lib/business-os/__tests__/ownerLanguageFirstFrame.guard.test.ts` | modify (comment) | RC-2 rationale. **Assertions unchanged**; §2.7.4 keeps its text matches green |
| `lib/design-system-v2/__tests__/themeStylesheetMatchesProvider.guard.test.tsx` | create | T-T: sheet = provider defaults; custom tokens = provider with tokens, both modes |
| `lib/design-system-v2/__tests__/customTokens.test.ts` | create | T-C: allow-list, grammars, injection payloads, builder |
| `lib/design-system-v2/__tests__/readV2CustomTokens.test.ts` | create | T-R: never throws, validated, cache, single-flight, stale-on-error, logging |
| `lib/design-system-v2/__tests__/V2ThemeScript.test.tsx` | create | T-S |
| `lib/design-system-v2/__tests__/V2ThemeProvider.ssr.test.tsx` | create | T-P |
| `components/business-os/__tests__/BusinessOSHeader.themeIcon.render.test.tsx` | create | T-H |
| `lib/design-system-v2/__tests__/themePrepaint.guard.test.ts` | create | T-G: placement, ordering, set-equality, no browser DB read, barrel unchanged |
| `docs/workplans/PERF_TH1_THEME_PREPAINT_WORKPLAN.md` | create | This file |

**Not modified:** `globals-v2.css`, `globals.css`, `app/layout.tsx`, `lib/design-system-v2/index.ts` (RC-8; the reader, the style and the script are imported by path), `lib/repositories/SystemConfigRepository.ts` (if R2-Q1 approves reuse), `app/api/admin/ui-config/route.ts` and `app/admin/ui-config/page.tsx` (R2-Q6), the `statusTokensMatchStylesheet` guard, and every migration.

---

## §4 Task List

- [x] **T-0(e) Production check of `v2_custom_tokens`** (main session, read-only, 2026-10-15): a non-empty row exists, overriding `colors.primary` and `colors.secondary`, both different from the defaults. **RC-7 stop hit → resolved by this revision's design.** Values not recorded
- [x] **T-0(g) New pre-check, read-only, main session (blocks T-2):** does every value in the production row pass the §2.7.6 grammar unchanged, and does the row contain any key outside the allow-list? **Record yes/no only, never a value.** The main session runs the grammar from this workplan against the row in its own scratch context. If any live value would be dropped, **stop and bring it to SA/BA**: the slice would change a live colour. (An unknown key is fine: the provider ignores it today too.) **Accepted as passed by SA (R2-Q8): both live values are 6-digit hex.**
- [ ] **T-0 Baseline at `936dfd04`** (re-run, because the base moved). Production build from a scratch `git archive` export with the node_modules junction; the local env file is copied in and never committed. Record: (a) SA Step 1 on the 4 BOS routes and both onboarding routes: `hasToggleInMarkup:false`; (b) sampler `blankMs`, `tVars`, `jsKB`, HTML bytes, 5 warm runs × 4 routes, median; (c) document response time on `/business-os`, 20 interleaved pairs; (d) wrong-theme frames for the 5 combinations in §7.2 on `/business-os`; (f) **custom-token swap at base** (§7.4): `customSwap` yes/no and `tCustomMs`, recorded as booleans and times only; (h) HTTP status of every §6.3 route (RC-4)
- [ ] **T-1 Discovery spike** (worktree, not committed as is): delete only `:260-262`, make `app/v2/layout.tsx` a `force-dynamic` server layout, then `next build`. Record every build or prerender error. Then `next start` and walk every route in §6.3 once in light mode, recording status codes, server-log errors and console hydration errors. Verify the §2.3(7) boundary (RC-5(a)): inject a component that throws only on the server and confirm 200, a client render and one logged server error. The output is the defect list for T-9. Revert the spike before T-2
- [x] **T-2** `themeMode.ts`, `v2-theme-tokens.css` and guard T-T1 (written first, red until the sheet is complete)
- [x] **T-3** `customTokens.ts` + T-C (grammar tables first)
- [x] **T-4** `server/readV2CustomTokens.ts` + T-R
- [x] **T-5** `V2ThemeScript.tsx` + T-S; `V2CustomTokensStyle.tsx` + its part of T-C
- [x] **T-6** Provider: remove the null and the browser read, the `customTokens` prop, isomorphic layout effects, keep the guard, shared key, fail-soft boundary + T-P and T-T2
- [x] **T-7** Header and `DarkModeToggle` icons + T-H
- [x] **T-8** Layouts: four sheet imports, token reads (started before the hold, awaited after), scripts, styles, props; `/v2` server layout; CRM dedupe + T-G
- [x] **T-9** Fix every SSR/hydration defect from T-1, each minimal and listed in Implementation Notes with its root cause. **Rule:** a fix may not change the settled UI. If a fix would, stop and bring it to SA/BA. Prefer moving a browser read into an effect over `suppressHydrationWarning` (SA optimisation note)
- [x] **T-10** Stale comments (§2.6)
- [x] **T-11** Local checks: `npx tsc --noEmit`; `npm test -- lib/design-system-v2 lib/business-os/__tests__ components/business-os/__tests__ components/ui/__tests__`; `npm run test:bos-entitlements`; `npm run lint:hooks`; `npm run lint` on touched files; mutation probes (§10.9)
- [ ] **T-12 Branch production build + full route smoke** (§6.3), in light, dark, Hebrew and Spanish. Exit criterion in §6.3
- [ ] **T-13 Re-measure** (§7): blank, wrong-theme frames, custom-token first frame, guards. Base vs branch in Implementation Notes
- [ ] **T-14** Remove the scratch export's junction with `cmd /c rmdir` (never `git worktree remove --force`), update the workplan status to Code Complete. **Do not commit** (RM, after the user has seen the diff)

---

## §5 §6 Filter Answer (Q1–Q5)

The scoping doc's §6 "business unchanged" test. For SA and BA to confirm. Revision 2 changes Q1 and Q5.

| Q | Answer | Why |
|---|---|---|
| **Q1 Output** | **No**, with three notes | Same themes, colours, custom tokens, preference source (localStorage, then the OS) and icon. The settled page is identical: guards prove the default sheet equals the provider's default output, and the inlined custom rule equals the provider's output with the tokens, in both modes. What changes is **when** things appear: chrome and loading state at HTML parse instead of after the JavaScript, and **the custom brand colours from the first frame instead of after a browser read** (today owners see the default primary/secondary first, then a swap). Neither is a different result for the same input. **Notes for the BA:** (a) before hydration the header buttons and tabs are **visible but not yet interactive**; tabs are real links. (b) With JavaScript disabled an owner page now shows chrome and a spinner instead of nothing. (c) **A stored token value outside the grammar is now ignored** (default shown) where today it is applied as-is. T-0(g) confirms the live row is unaffected; a future admin save of, say, a `calc()` radius would not apply. The admin page does not warn about it (§9.3) | **After RC-15/RC-16 (SA ruling IN-11):** every path is equal to or better than today: warm fresh and warm expired caches show the brand colours on the first frame with no wait; a cold read inside 1000 ms likewise; a cold read that misses it shows the defaults and then the brand colours a moment later (exactly today); a database outage shows the defaults (the route answers 503). Q1 answers **No** without qualifier for these paths.
| **Q2 Money** | **No** | Theme only. The plan pill is unchanged. No charge, credit or price path is touched |
| **Q3 Timing** | **No**, one note | Nothing scheduled. An admin's token change now reaches owners **within 60 s** (cache TTL) instead of on the next page load; **worst case TTL plus one page load per instance, if the 1000 ms deadline fired** (RC-10). In practice that is the same moment for anyone not reloading inside the minute after a save; stated for the BA | After RC-15 the propagation bound stays "TTL plus one page load per instance": the first load after expiry still gets the old value and starts the refresh.
| **Q4 Scope** | **No** | No feature removed or degraded. The CRM dedupe removes a provider whose context nothing reads. `/v2` keeps its custom tokens (§2.9 option A) |
| **Q5 Failures and records** | **No**, conditional on the fail-soft boundary and a clean T-12 | Server-render errors under the provider fall back to today's client render (RC-5). A failed or slow token read falls back to the last good value or the defaults, which equals today's failed browser read. **The read can never hold a page for more than 1000 ms** (RC-10 deadline); without it a stalled read could hold every owner page on an instance for up to 20 s, which would make Q5 a Yes. **One change, stated:** the read failure is now logged on the server as a Pino `warn` instead of in the browser console. No audit, usage or charge row is touched | **After RC-15/RC-16:** no page ever waits on an expired value, and a cold page waits at most 1000 ms; the RC-16 route adds a server log line on the correction path only (no audit).

---

## §6 SSR Risk and the Route Smoke Test

### §6.1 What becomes server-rendered for the first time

Everything below the provider in five layouts: about 13.9k lines in `app/business-os`, 4.1k in `app/onboarding-*` and 13.0k in `app/v2`, plus the components they import. Before TH-1 none of it ran on the server or was hydrated. The failure classes:

| Class | Symptom | Pre-scan result (by reading) |
|---|---|---|
| Browser API during render (`window`, `localStorage`, `document`, `matchMedia`) | SSR exception → boundary fallback (counted as a failure, RC-5(b)) | No `useState(() => localStorage…)` in the owner pages or `components/business-os`. `LanguageContext`, `CapabilitiesProvider`, `ConfigurationDialogProvider`, `BusinessOSTabs` and `BusinessOSHeader` touch the browser only in effects. `BoostReturnNotice` reads `window` in an effect |
| `typeof window` branches in render | #418 / #425 hydration mismatch | `components/business-os/LeadCaptureLinks.tsx:35` (`baseUrl` in render; apparently unused, confirm in T-1); `components/v2/UserMenu.tsx:163` (`isBusinessOS` in render, `/v2` header); `app/v2/sandbox/[agentId]/page.tsx:60` (`searchParams` in render) |
| Date, locale or random text in render | #425 text mismatch | 56 `.tsx` files in scope use `toLocale*`, `new Date()`, `Date.now()`, `Math.random` or `randomUUID`, mostly in effects or after data loads. Smoke test only |
| `useSearchParams` without Suspense on a **statically prerendered** page | Build error in Next 14.2 | `/v2/settings` (`app/v2/settings/page.tsx:26`). With `/v2` now `force-dynamic` (§2.9) it should no longer be prerendered. T-1 confirms. *(Superseded by IN-6: `/v2` was already dynamic at base; `force-dynamic` is kept as a local guarantee.)* The build break could never have happened |
| `/v2` now rendered per request | Status code or redirect change | `/v2/billing` server `redirect()` under the boundary (RC-4) |

### §6.2 The `/v2/settings` build break

*(Superseded by IN-6: `/v2` was already dynamic at base; `force-dynamic` is kept as a local guarantee.)* The predicted break did not exist: the page was never prerendered. Original text: Revision 1 predicted it and resolved it with the Q-2 boundary. With `/v2` `force-dynamic`, the page is no longer prerendered, so the bailout check should not apply. The boundary stays (RC-5). A local `<Suspense fallback={null}>` in the page is used only if T-1 shows a break that neither clears.

### §6.3 Routes for the production-build smoke test (T-1 and T-12)

`next build && next start`, signed in as the QA test owner. DevTools console set to "Preserve log", and the `next start` server log captured. For each route, record at **base and branch**: HTTP status (RC-4, must match), server-log errors, console errors (any React #418 / #423 / #425, "Hydration failed" / "did not match", "switched to client rendering", or a recoverable-error message), whether the header marker is in the raw HTML, and **whether a `<style data-v2-custom-tokens>` element is in the raw HTML** (branch: yes on every route below, because the production row is non-empty; base: no). The full set runs in **light** and **dark**. The Business OS set runs again in **Hebrew** (RTL SSR) and **Spanish**.

| # | Route | Notes |
|---|---|---|
| 1 | `/business-os` | Dashboard, plus `?boost=return&session_id=cs_test_…` (effect path) |
| 2 | `/business-os/crm` | Plus `?contact=<id>`. Exactly **one** custom-token `<style>` (no nested provider any more) |
| 3 | `/business-os/email-automation` | Fully static page body: the biggest newly-SSR'd markup |
| 4 | `/business-os/orders` | Plus `?invoice=<id>` |
| 5 | `/business-os/reports` | Plus each `?tab=` value |
| 6 | `/business-os/settings` | Plus each `?section=` value |
| 7 | `/business-os/website` | 9.2k lines. Plus each `?view=` value |
| 8 | `/onboarding-chat` | Account mid-onboarding. A completed account may be redirected by middleware; record that |
| 9 | `/onboarding-build` | Plus `?lang=he` |
| 10 | `/v2/dashboard` | Legacy: nothing links here, but it resolves |
| 11 | `/v2/agent-list` | |
| 12 | `/v2/agents` | |
| 13 | `/v2/agents/new` | Has its own Suspense |
| 14 | `/v2/agents/[id]` | A real agent id of the test owner |
| 15 | `/v2/agents/[id]/run` | |
| 16 | `/v2/sandbox/[agentId]` | Plus `?fresh=true` (render-time `searchParams`) |
| 17 | `/v2/analytics` | |
| 18 | `/v2/billing` | RC-4: if the status changes from base, the landing must still be `/settings?tab=billing` with no flash of `/v2` chrome, and SA is told before T-12 passes |
| 19 | `/v2/monitoring` | Fully static |
| 20 | `/v2/notifications` | |
| 21 | `/v2/settings` | Previously predicted build break (§6.2) |

Also in the smoke test:
- **Client-side entry (RC-1):** sign in through `/auth/callback` into `/business-os`, and enter through the `(protected)` layout link, each with stored `dark` (C-2) and with no stored value and an OS dark preference (C-4). No light frame in a filmstrip. And with the custom row live, no default-primary frame (C-6 in §7.4).
- A client-side navigation between Business OS tabs, and from `/business-os` into `/business-os/crm`. Theme toggle on each segment. A **bfcache** Back/Forward on `/business-os`.
- **RC-12 (names only):** read the raw HTML of `/business-os` on the branch and record the set of custom properties declared in `<style data-v2-custom-tokens>`. It must be exactly `{--v2-primary, --v2-secondary}`. This is the only check that catches a dropped live value. Re-run T-0(g) (yes/no) before handover to RM if the row's `updated_at` changed since 2026-10-15.
- One public page (`/privacy`, a `/book` page) **after** visiting an owner page in dark mode via a full load: no `.dark` on `<html>`, no `--v2-*` sheet and no custom-token `<style>` in its HTML.
- **Admin path, read-only in production:** open `/admin/ui-config` and confirm it loads and shows the current tokens (it never used the removed read). **No save in production** (§2.10).

Exit criterion: **0 build errors, 0 server-log render errors, 0 hydration or client-render-fallback messages, and status-code parity** across the table, even when a page looks fine (RC-5(b)). Every defect is fixed at its root in T-9, or brought to SA if a fix would change the settled UI.

---

## §7 Metrics

### §7.1 Blank time (the gate, RC-9)

- **Deterministic gate:** SA Step 1 flips to `hasToggleInMarkup: true` on the 4 BOS routes, plus the equivalent check on `/onboarding-chat` and `/onboarding-build` (their first provider child is in the server HTML).
- **Corroborating measurement:** SA sampler (`theme-blank-analysis.md` §4 Step 2) with two added fields, `darkAtMarker` (`html.classList.contains('dark')` at the first observer callback that sees the marker) and `bgAtMarker` (`getComputedStyle(marker).backgroundColor`). **blank = `tMarker − max(domInteractive, cssEnd)`**, marker `[aria-label="Toggle dark mode"]`; ≤ 0 reads as 0. Routes `/business-os`, `/business-os/settings`, `/business-os/crm`, `/business-os/email-automation`. Production build, local, warm, 5 runs each, median. Target median ≈ 0 ms (≤ 10 ms).

### §7.2 No wrong-theme frame (the gate)

Five combinations × the 4 routes, OS preference via DevTools "Emulate CSS prefers-color-scheme", stored choice set or cleared before each run.

| # | Stored `v2-theme-mode` | OS | Expected from the first content frame |
|---|---|---|---|
| C-1 | `light` | light | light |
| C-2 | `dark` | light | dark |
| C-3 | `light` | dark | light |
| C-4 | (none) | dark | dark |
| C-5 | (none) | light | light |

Checks: (a) `darkAtMarker` equals the expected mode, and `bgAtMarker` equals the **value the same page shows after hydration** (read again 2 s after `load`), in every run. Comparing with the settled value rather than a hard-coded hex keeps the check right whatever the custom row holds, and records only a boolean; (b) one DevTools Performance filmstrip per combination on `/business-os`, Slow 4G + 4× CPU, cache disabled: no frame shows the other theme and no frame flips at hydration; (c) the header icon is right in the first filmstrip frame; (d) **RC-1:** C-2 and C-4 again, entered **client-side** (§6.3): no light frame.

### §7.3 Guards (not gating unless noted)

| Guard | Method | Threshold |
|---|---|---|
| Document response time, `/business-os` (**gate**) | 20 interleaved base/branch pairs, pooled (the amended BR protocol). Branch runs include the token read: in each batch of 5 pairs, the first branch request follows a server restart, so the **cache-miss path** is measured, not only the hit | ≤ base + max(10%, 30 ms) over the pooled set; the cache-miss subset is also reported separately (not gated) |
| **Cold-miss token read time (RC-10(e))** | Server-side timing of `readV2CustomTokens` on a cache miss (the reader's **`info`** line `Custom tokens read` with `{ ms, keys }`, module `V2CustomTokensRead`, SA CR-1), at least 20 samples | **p95 ≤ 500 ms, else stop and bring to SA before T-12 passes** (the deadline would be firing in normal operation) |
| Document response time, `/v2/dashboard` | 10 pairs, recorded only. ~~Base is a static file, branch is a dynamic render, so it **will** be slower~~ (superseded by IN-6: dynamic at base too, so like-for-like); recorded so SA can judge R2-Q3 | Recorded |
| Provider mounted (`tVars`) | Sampler, the same runs as §7.1 | No worse than base + 10% |
| HTML bytes | Sampler, `/business-os` | Recorded (expected up) |
| First Load JS | `next build` route table | Recorded. Expected flat or slightly **down**: the provider no longer imports `@/lib/supabaseClient` (likely still in the bundle through other modules; recorded either way) |
| Route table | `next build` | `/v2/*` changes from ○ to ƒ; recorded, expected |

### §7.4 Custom tokens on the first frame (the gate, new)

The production row is live, so the local production build (which reads the production database through the local env) shows the real tokens. **Only booleans and times are recorded, never a value.**

- Sampler fields: `primaryAtMarker` = `getComputedStyle(document.documentElement).getPropertyValue('--v2-primary').trim()` at the marker, and `primarySettled` = the same, read 2 s after `load`. Recorded: `customFirstFrame = (primaryAtMarker === primarySettled)` and, at base, `tCustomMs` = time from `domInteractive` to the first observed change of `--v2-primary` (a `MutationObserver` on `<html>`'s `style`).
- **C-6:** each of C-1, C-2 and C-4 on the 4 routes. **Gate:** `customFirstFrame: true` in every run on the branch, and no `--v2-primary` change after the marker (no swap). At base the expected record is `customFirstFrame: false` with a swap.
- One filmstrip on `/business-os`, Slow 4G + 4× CPU: the primary colour is the same in the first content frame and the last.

---

## §8 Interaction with BR-1b

Unchanged from revision 1 and ruled by SA (Q-5): **TH-1 before BR-1b**. `PERFORMANCE_BUSINESS_ROUND_REQUIREMENT.md` §12.6 has the addendum "TH-1 lands first": BR-1b branches from `main` after TH-1 merges and re-bases every measurement there; the preload stays in the server layouts; F-1's "never emitted" premise and D-1 item 7 are restated; criterion 3 (hydration of the gate) becomes live on owner routes; the D-7 filmstrip guard is replaced by a "time to hydrated owner chrome" guard; and a server-side suspend under the RC-5 boundary streams after the shell, still in the same response.

**New for BR-1b from revision 2:** the three owner layouts now start **two** reads before the payment hold (language and tokens). BR-1b's own layout edits must keep `customTokensPending` started before the hold and awaited after it (T-G G-7). The `/v2` layout becoming a server layout does not affect BR-1b (owner routes only).

---

## §9 Side Findings and Follow-ups

### §9.1 The provider's `console.error`

Deleted with the browser read (§2.3(2)). RC-6 is moot. The server reader logs instead (§2.7.5).

### §9.2 TH-2b: tighten `system_settings_config` reads (out of scope, needs user authorization)

After this slice the theme provider no longer reads the table from the browser. **That does not by itself make the anon read policy safe to remove**: migration `20260920a` names two more anon-client readers, `OrchestrationService` and `MemoryCompressor` (`:23-24`, `:62-63`), which "default to the same anon client for their config". **A third, `lib/hooks/useUIVersion.ts`** (SA RC-11), is a `'use client'` module that reads and writes the table through the browser client; it appears unused and is likely a deletion. TH-2b therefore needs: (1) a current inventory of every anon or authenticated reader of the table, (2) moving those to the service-role repository, (3) a production RLS migration on the DB-exposure-lockdown track, applied by the user. **The main session records TH-2b in the scoping doc.** This slice changes no policy and no migration.

### §9.3 Follow-ups recorded, not done here

| # | Finding | Proposed home |
|---|---|---|
| F-1 | `app/api/admin/ui-config/route.ts`: no Zod on `save_tokens`, a direct service-role client instead of `SystemConfigRepository`, 8 `console.*` calls | A small admin-route cleanup slice. It could then reuse `sanitizeV2CustomTokens` to **reject** invalid tokens at save time with a message, closing Q1 note (c) |
| F-2 | `app/admin/ui-config/page.tsx`: 4 `console.*` calls | Same slice |
| F-3 | TH-3 (SA): `.dark` and inline `--v2-*` left on `<html>` after leaving an owner segment client-side | Already recorded by SA |
| F-4 | `lib/hooks/useTheme.ts`: unused second `.dark` writer with a `console.log` | Already recorded by SA (`chore:`) |
| F-5 | If a CSP is ever added, the inline `<style>` and the two inline scripts need a nonce or hashes | Note for the DB/security tracks (R-17) |

---

## §10 Test Plan

### §10.1 T-T `lib/design-system-v2/__tests__/themeStylesheetMatchesProvider.guard.test.tsx` (jsdom)

Behavioural, not a source parse, so it survives any refactor of the provider's tables.

**T-T1 Default sheet = provider defaults.** Render `V2ThemeProvider` with `customTokens={{}}` and localStorage `light`, then `dark`. Flush effects, spy on `document.documentElement.style.setProperty`, collect name → value. Parse `v2-theme-tokens.css` (`:root` for light; `:root` overlaid by `:root.dark` for dark). Assert: (1) exactly equal maps per mode, after whitespace normalisation; (2) 43 names; (3) only these two selectors and only custom-property declarations; (4) **per RC-2:** (a) light: every name declared in both this sheet's `:root` and `globals-v2.css`'s `:root` has an equal value; (b) dark: every name that `globals-v2.css` `html.dark` declares **and** the provider writes is also declared in the new `:root.dark`; (c) the new sheet's dark selector is exactly `:root.dark`. Effective dark values of the two sheets are **not** compared.

**T-T2 Inlined custom rule = provider with tokens (both modes).** Build a synthetic full token set: every one of the 31 allow-listed keys set to a distinct, grammar-valid value that differs from every default (e.g. `#0000A1`, `#0000A2`, …, `11px`, `0 0 1px rgba(1, 2, 3, 0.4)`). Synthetic values only; the production row is never used in a test. For light and dark:
- Render the provider with those tokens, flush, collect the `setProperty` map **P**.
- Compute the **pre-hydration** map **C** with a small cascade resolver over: the default sheet, `buildV2CustomTokenCss(tokens)`, and (in a second pass) `globals-v2.css` too, for `/v2` and CRM. The resolver accepts only the known selectors (`:root`, `:root.dark`, `html.dark`, `:root:root:root`), applies those matching the mode, and picks the highest specificity, then the later rule. It fails on any other selector. **Specificity is computed from the selector text** (count of class and pseudo-class parts, count of type parts), never written out per selector (RC-13, SA T-T2 note), so a selector edit cannot drift together with a table edit.
- Assert **C = P** for all 43 names in both modes and both passes. This pins "custom overrides in light and dark exactly as the provider does", the 12 status values staying default, and the selector's specificity.
- Assert the allow-list has **31** entries and its variable set equals the set of names whose value **P** changed versus T-T1's defaults. A key the provider honours but the allow-list misses, or the reverse, fails here.
- Repeat with a **partial** set (only `colors.primary` and `colors.secondary`, synthetic values): the shape of the production row, without its values.

### §10.2 T-C `lib/design-system-v2/__tests__/customTokens.test.ts` (node)

- **T-C1 Allow-list:** unknown groups and keys dropped; `__proto__`, `constructor`, `prototype` as keys at both levels are never copied and `Object.prototype` is unchanged afterwards; arrays, `null`, numbers, strings as root or group give `{}` or an empty group; non-string values dropped; result is **deep-frozen** (root and each group) and has no inherited keys. **RC-13(d):** an `Object.create(null)` root and group with valid keys **is accepted** (only own properties are read) and pinned so.
- **T-C2 Grammars:** accept/reject tables per group, as in §2.7.6, including the length cap (200) and empty strings.
- **T-C3 Defaults pass:** every `v2Tokens` default for every allow-listed key passes its grammar.
- **T-C4 Injection, straight into the builder** (bypassing the sanitizer, to prove the defence in depth): values `red;}body{display:none`, `red</style><script>alert(1)</script>`, `url(javascript:alert(1))`, `expression(alert(1))`, `var(--x)`, `#fff;--v2-bg:red`, `/* x */`, a 10 000-character string, a value containing a newline, one containing U+2028, `<!--` and `-->` (RC-13(c)). And a valid hex with surrounding whitespace (` #0000A1 `) that must be emitted **trimmed**. Assert the output contains none of them, contains no `<`, `>`, `}` except the one closing brace, no `/*`, and every declaration name is in the allow-list.
- **T-C5 Builder shape:** empty or all-invalid tokens give `''`; otherwise exactly `:root:root:root{…}` with `name:value` pairs in allow-list order. `V2CustomTokensStyle` renders nothing for `''` and exactly one `<style data-v2-custom-tokens>` otherwise (`renderToStaticMarkup`).

### §10.3 T-S `lib/design-system-v2/__tests__/V2ThemeScript.test.tsx` (jsdom)

- **T-S1 behaviour:** stored ∈ {`'dark'`, `'light'`, `'garbage'`, `''`, none} × OS ∈ {dark, light}, `matchMedia` mocked, `new Function(scriptBody)()` (the BR-1a method). Assert `.dark` presence.
- **T-S2 parity with the provider (RC-3):** for each case, run the script, then render the provider and flush effects. A `MutationObserver` on `<html>` with `attributeOldValue: true`: assert that **`dark` presence never differs between `oldValue` and the current value at any record**. (`classList.add` of a present class still queues a record, so "no records" would be wrong.)
- **T-S3 stale `.dark`:** pre-set `.dark` and store `'light'`. The script removes it.
- **T-S4 storage throws:** the script does not throw and sets nothing.
- **T-S5 static:** `renderToStaticMarkup` gives exactly one `<script>…</script>`, byte-identical across renders, containing the key from `themeMode.ts`, setting nothing but the class.

### §10.4 T-P `lib/design-system-v2/__tests__/V2ThemeProvider.ssr.test.tsx` (jsdom)

- **T-P9 (RC-16):** with `customTokensKnown` omitted or `true`, zero `fetch` calls.
- **T-P10 (RC-16):** with `false`: one `fetch` of the correction path with `cache: 'no-store'`, and `--v2-primary` from the response lands on `<html>`; a poisoned response never reaches `setProperty` (client re-sanitize); a 503, a network error, `success: false` and a non-JSON body all leave the defaults with zero `console.error`; nothing is written after unmount.

- **T-P1** `renderToString(<V2ThemeProvider><span id="c"/></V2ThemeProvider>)` contains `id="c"`.
- **T-P2** SSR markup, `.dark` pre-set, stored `'dark'`, `hydrateRoot`, flush. Assert: zero `console.error`, `dark` presence never flips (RC-3 observer semantics), `--v2-bg` inline is `#0F172A`.
- **T-P3** `toggleMode` after mount flips `.dark` and persists.
- **T-P4** A child that throws during `renderToString` does not fail the outer render; hydration recovers by client render (Jest approximation; T-1 is the real proof).
- **T-P5** The provider module does not import `@/lib/supabaseClient` (module mock that throws on import), and no network or Supabase call happens during render or after mount.
- **T-P6** **Replaced** (RC-6 moot): the provider calls no logger and no `console.*` during render, mount or toggle.
- **T-P7 Never defaults first:** render with synthetic tokens (`colors.primary` = `#0000A1`); record every `setProperty('--v2-primary', …)` call. Assert the **first** call already has `#0000A1` and no call ever sets the default. This pins "the client effect does not overwrite the inlined values with defaults".
- **T-P8 RC-1 timing:** on a client-only mount (`createRoot`, no SSR), stored `'dark'`: assert `.dark` and `--v2-bg` are set by the time `act()` returns from the **layout** phase, i.e. within the same commit (asserted from a sibling `useLayoutEffect` that runs after the provider's, reading the DOM). Fails if the effects are passive.

### §10.5 T-H `components/business-os/__tests__/BusinessOSHeader.themeIcon.render.test.tsx` (jsdom)

Header rendered with `next/navigation`, `useLanguage` and the lazy dialog mocked, `useV2Theme` mocked to `'light'` then `'dark'`. Server markup identical in both modes; the toggle holds both icons with `dark:hidden` / `hidden dark:block`. Same identical-markup assertion for `DarkModeToggle`'s icon part (its `aria-label` excluded, R-8).

### §10.6 T-R `lib/design-system-v2/__tests__/readV2CustomTokens.test.ts` (node)

- **T-R10 (RC-15, fake timers with the test's own clock):** an expired value plus a never-resolving read returns the stale value on a microtask flush, not at 1000 ms; ten callers make one repository call; when the read lands, the next call returns the new value. T-R8's expired case is now "at once".
- **T-R11 (RC-16):** known/unknown: a cold read in time is known; a cold read that misses the deadline is unknown `{}` and known once it lands; a cold failure stays unknown through the back-off; a known reset is known; a caller `waitMs` waits longer on the same flight and gives up as unknown at its own limit.
- **Route test** `app/api/design-system/v2-custom-tokens/__tests__/route.test.ts`: happy path (200, `no-store`), a known reset (200 `{}`), unknown (503, never 200 `{}`), a poisoned repository value (only allow-listed valid keys leave).

`server-only` mocked to a no-op, `systemConfigRepository.getByKey` mocked, `Date.now` controlled, logger mocked.
- **T-R1 Never rejects:** repository returns `{ error }`; repository throws; resolves `{ data: null }`; `value` is `null`, an array, a string, a number. Each resolves to `{}` (or the last good value when one is cached).
- **T-R2 Validated only:** a raw value with valid, invalid and unknown keys returns only the valid ones; the logger receives `droppedKeys` with **names only**, and no logged object contains any synthetic value string.
- **T-R3 Cache:** two calls within 60 s → one repository call; after 60 s → a second call; the key passed is `V2_CUSTOM_TOKENS_CONFIG_KEY`.
- **T-R4 Single-flight:** 10 concurrent calls on a cold cache → one repository call, ten equal results.
- **T-R5 Stale-on-error:** good read, then expiry, then a failing read → the old value is returned; a call 5 s later does **not** retry; a call after the 10 s back-off does.
- **T-R6 Reset:** a good read, then expiry, then `{ data: null }` (row deleted by a reset) → `{}`. A reset is not treated as an error and does not serve stale.
- **T-R5b (RC-10(b)) Negative back-off:** a cold failure (no last good value) returns `{}`; a call 5 s later makes **no** repository call; a call after 10 s does.
- **T-R7** The module's first statement is `import 'server-only'`.
- **T-R8 (RC-10(c)) Deadline, fake timers:** a read that never resolves gives `{}` at 1000 ms; with a cached (expired) value it gives that value; ten concurrent callers produce **one** `warn`; when the read later resolves, the next call is served from the cache without a new read. On `{ error }` the reader logs `{ reason: 'read_failed' }` without `err` (R2-Q9).

### §10.7 T-G `lib/design-system-v2/__tests__/themePrepaint.guard.test.ts` (node, source)

- **Amended by RC-16:** G-1 expects `customTokensKnown={customTokensKnown}` on the provider; G-4 allows exactly one plain `useEffect` (the correction, guarded by `if (customTokensKnown) return`); G-9 also registers `app/api/design-system/v2-custom-tokens/route.ts` (force-dynamic); **G-12 amended:** the provider imports `sanitizeV2CustomTokens` as its only value from `customTokens.ts`; **G-13 new:** the four layouts pass `customTokensKnown` from the read, the provider has exactly one `fetch`, to the correction path with `no-store`, defaulting the prop to `true`, and the route is the only `app/api/` reader of the tokens.

Using the BR-1a guard's `walk`/`code` helpers:
- **G-1** The set of production files that render `<V2ThemeProvider` = the set that import `v2-theme-tokens.css` = the set that render `<V2ThemeScript` = the set that render `<V2CustomTokensStyle` = the set that call `readV2CustomTokens()`. After the dedupe: three owner layouts and `app/v2/layout.tsx`. Each passes `customTokens={customTokens}` to the provider and `tokens={customTokens}` to the style.
- **G-2** In each, `<V2ThemeScript` and `<V2CustomTokensStyle` come before every `<V2ThemeProvider`, `<UserProvider` and `<LanguageProvider`.
- **G-3** `app/layout.tsx` and every layout under a public segment (`app/book`, `app/c`, `app/invoice`, `app/go`, `app/proposal`, `app/invite`, `app/payments`, `app/site`, `app/privacy`) render neither component, import neither the sheet nor `readV2CustomTokens`.
- **G-4** The provider has no `return null`, still contains `if (!mounted) return` inside the DOM effect, **and both effects are called through `useIsomorphicLayoutEffect`** (RC-1), defined at module scope as `typeof window === 'undefined' ? useEffect : useLayoutEffect`. Both the provider and the script import `V2_THEME_STORAGE_KEY`; the literal `'v2-theme-mode'` appears only in `themeMode.ts`.
- **G-5** `theme-provider.tsx` contains no `console.`.
- **G-6** The CRM layout does not render `V2ThemeProvider`, has no `'use client'`, and still imports `globals-v2.css`.
- **G-7** In the three gated layouts: `const customTokensPending = readV2CustomTokens();` appears before `await redirectIfAwaitingPayment();`, `readV2CustomTokens()` appears exactly once, and the first use of `customTokensPending` after its declaration comes after the gate (the BR-1a G-2 pattern).
- **G-8 (narrowed, RC-11)** No file under `lib/design-system-v2/**`, `app/business-os/**`, `app/onboarding-build/**`, `app/onboarding-chat/**` or `app/v2/**` that is a client module (`'use client'`) contains `system_settings_config` (comments stripped). The provider imports nothing from `@/lib/supabaseClient`. `lib/hooks/useUIVersion.ts` is outside this scope by design (TH-2b inventory, §9.2) and is **not** edited.
- **G-9** Every importer of `readV2CustomTokens` under `app/` exports `dynamic = 'force-dynamic'` (no static page bakes the tokens in at build; §2.9 option B).
- **G-10** `lib/design-system-v2/index.ts` exports none of `readV2CustomTokens`, `V2CustomTokensStyle`, `V2ThemeScript`, `sanitizeV2CustomTokens` (RC-8).
- **G-11** No production file calls `__resetV2CustomTokensCacheForTests`.
- **G-12** `customTokens.ts` imports nothing from React, `next/*`, Supabase or the logger (pure); `theme-provider.tsx` imports it with `import type` only.

### §10.8 Existing suites that must stay green

`statusTokensMatchStylesheet.guard.test.ts` (unchanged), `ownerLanguageFirstFrame.guard.test.ts` (**unchanged assertions**; §2.7.4 keeps G-2(ii) text matches), `OwnerDirScript.test.tsx`, `LanguageContext.initialLanguage.render.test.tsx`, `readInitialLanguage.test.ts`, `readPlanBadge.test.ts`, `components/ui/__tests__/darkModeTokens.guard.test.ts`, the `SystemConfigRepository` tests, `npm run test:bos-entitlements`, `npm run lint:hooks`, `tsc --noEmit`, and `npm run build`.

### §10.9 Mutation probes (each restored from a backup afterwards, results in Implementation Notes)

| Probe | Must fail |
|---|---|
| Restore `if (!mounted) return null` | T-P1 |
| Remove `if (!mounted) return` from the DOM effect | T-S2, T-P2 |
| Swap `useIsomorphicLayoutEffect` back to `useEffect` (RC-1) | G-4, T-P8 |
| Change one hex in the sheet, or add `--v2-text-tertiary` | T-T1 |
| Change a value in the provider's `darkModeColors` only | T-T1 |
| Custom rule selector `:root:root:root` → `:root` | T-T2 (dark pass) |
| Drop one key from the allow-list (e.g. `colors.textMuted`) | T-T2 (31 count and changed-set equality) |
| Provider: re-introduce `useState({})` for tokens, filled from the prop in an effect (defaults first) | T-P7 |
| Builder iterates the input's keys instead of the allow-list | T-C1, T-C4 |
| Colour grammar loosened to `[^;]+` | T-C2, T-C4 |
| Reader: remove the `try/catch` around the repository call | T-R1 |
| Reader: cache failures for the full TTL | T-R5 |
| Reader: deadline removed (await the read directly) | T-R8 |
| Reader: back-off applied only when a last good value exists | T-R5b |
| Reader: drop single-flight | T-R4 |
| Business OS layout: move `readV2CustomTokens()` after `await redirectIfAwaitingPayment()` | G-7 |
| Add `<V2CustomTokensStyle` or the script to `app/layout.tsx` | G-3 |
| Move `<V2ThemeScript />` inside `<V2ThemeProvider>` | G-2 |
| Script uses `m !== 'light' && m !== 'dark'` (SA sketch) | T-S2 (`'garbage'` case) |
| Header icon back to `mode === 'dark' ? …` | T-H |
| Drop the sheet import from one layout | G-1 |
| Remove `force-dynamic` from `app/v2/layout.tsx` | G-9 |
| Re-add the browser `supabase.from('system_settings_config')` read to the provider | G-8, T-P5 |

### §10.10 Manual QA (production build)

§6.3 route smoke and §7.1–§7.4 measurements. Plus the toggle on each segment, a language switch (BR-1a unchanged), the CRM client-side entry, the RC-1 client-side entries, bfcache Back, the public-page check, and `/admin/ui-config` read-only. **No token save in production.** If a non-production environment exists, one save of a synthetic primary there, then confirm it shows on an owner page within 60 s and a reset returns the default within 60 s.

---

## §11 Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R-1 | **First-time SSR of ~31k lines** surfaces server exceptions or hydration mismatches | High likelihood that something surfaces / medium impact | T-1 discovery before the fix. Full route smoke (§6.3) in 2 themes and 3 languages. Fail-soft boundary, counted as a failure if it fires (RC-5) |
| R-2 | `next build` breaks on a `/v2` page | **Retired by IN-6** (`/v2` was already dynamic; branch build exit 0) | §6.2, T-1 |
| R-3 | The default sheet drifts from the provider | Medium / visible | T-T1 exact equality, behavioural |
| R-4 | The script disagrees with the provider | Low / visible flip | Mirror `if (savedMode)`. T-S2 parity table |
| R-5 | `.dark` or custom tokens leak to public pages | Low / high impact | Segment level only. G-3. Public-page smoke |
| R-6 | ~~Custom tokens: default palette from HTML parse until the fetch resolves~~ | **Resolved by revision 2**: the tokens are in the HTML (§2.8) | §7.4 gate |
| R-7 | The Suspense boundary changes streaming or hydration order | Low | T-P4 + T-1. BR-1b re-checks (§8) |
| R-8 | `DarkModeToggle` `aria-label` says "Switch to dark mode" to a dark owner until mount | Low / not visible, `/v2` only | Accepted residual (SA) |
| R-9 | Pre-hydration taps on visible buttons do nothing | Certain / low | Standard SSR. Noted for the BA (Q1) |
| R-10 | Server render cost raises document response time | Medium / guarded | §7.3 gate |
| R-11 | A stale "renders null" comment misleads BR-1b | Medium | §2.6 |
| R-12 | `.dark` left on `<html>` after leaving an owner segment client-side | Pre-existing, unchanged | Follow-up TH-3 (SA) |
| R-13 | A client-side entry paints a light frame for a dark owner (RC-1) | Was high without the fix | Isomorphic layout effects, G-4, T-P8, the §7.2(d) client-entry runs |
| R-14 | **A live token value fails the new grammar** and silently reverts to the default | Unknown until T-0(g) / visible brand change | T-0(g) blocks T-2. Grammar admits hex, functional colours and named colours. Future saves: F-1 |
| R-15 | **CSS injection** through a stored token value | Low (admin-only write) / high impact (all owner pages) | Allow-list iteration, per-group grammars with no `;{}<>\*@` or quotes, length cap, re-check in the builder, T-C4 payloads, two mutation probes |
| R-16 | Token read slows the page on a cache miss, or a slow database delays every owner page | Low on owner routes (overlapped with the hold, cached 60 s) / medium on `/v2` (serial) | §2.7.4 overlap, single-flight, stale-on-error, negative back-off, **1000 ms deadline (RC-10)**, §7.3 cold-miss read time (p95 ≤ 500 ms or back to SA) | **After RC-15:** expired values are served at once (no wait); only a cold, no-value call waits, bounded at 1000 ms, and a missed deadline is corrected client-side (RC-16).
| R-17 | A future CSP blocks the inline `<style>` and scripts | None today (no CSP) | F-5 |
| R-18 | An admin's change takes up to 60 s per instance to appear | Certain / low | Stated in Q3. Shorter TTL or a cross-instance mechanism only if the business asks (R2-Q2, R2-Q6) |
| R-19 | `/v2` stops being static, so its pages cost a server render per request and its route-table entries change | **Retired by IN-6**: `/v2` was already dynamic, the route table is unchanged | §2.9, §7.3 `/v2/dashboard` record, RC-4 parity |
| R-20 | TH-2b is assumed done because the theme read is gone, and the anon policy is dropped while `OrchestrationService` / `MemoryCompressor` still read through the anon client | Medium / breaks config reads in prod | §9.2 states the other readers; TH-2b starts with an inventory |
| R-21 | Cold-start correction route unavailable (database down, or still unknown after 5000 ms) | Low / defaults for that page view | Equal to today's failed browser read. The route answers 503 and the provider keeps the defaults silently (T-P10) |

**Surprises found while reading (revision 1, still true except the first, superseded by IN-6):** `/v2` pages are statically prerendered; the SA script sketch differed from the provider for unknown values; the provider's dark palette differs from `globals-v2.css`; the nested CRM provider had a toggle race; "light first, swap after mount" for the icon would be a seconds-long wrong-theme artefact; BR-1b's filmstrip guard would stop detecting a broken preload; `system_settings_config` reads are left open for the browser theme read; `lib/hooks/useTheme.ts` is a second, unused `.dark` writer.

**Surprises found in revision 2:**
1. **Custom tokens are not mode-aware.** A custom value wins in light **and** dark (`custom || (isDark ? dark : light)`). A custom `background` or `surface` therefore overrides the dark palette too. The inline rule reproduces that exactly; it is not "fixed" here.
2. **The admin save route validates nothing** (no Zod, the client's object stored as-is), so until this slice anything an admin typed went straight into `style.setProperty` on every owner page. Not exploitable by owners, but it makes the read-side grammar the real boundary.
3. **Removing the theme read does not make the table closable**: two other anon-client readers are named in the same migration (§9.2).
4. **The BR-1a guard pins the exact `Promise.all` text** in the Business OS layout; a natural "add a third element" edit would break it. §2.7.4 avoids that without weakening the overlap.
5. **A static `/v2` server layout would bake the tokens in at build** through Next's patched `fetch` and Data Cache; hence `force-dynamic`, with a guard (G-9).
6. **The admin page does not use the provider or the barrel**: no dependency on the removed read.
7. The `console.error` that RC-6 asked to convert disappears with the read; there is nothing left to convert.
8. **(SA, RC-11) A third browser reader:** `lib/hooks/useUIVersion.ts` is a `'use client'` module that reads **and writes** `system_settings_config` through `@/lib/supabaseClient`, apparently with no importers. Not edited here; added to the TH-2b inventory (§9.2). Its 3 `console.error` calls are flagged for the user with F-1/F-4.

---

## §12 Questions for SA

Revision 1's Q-1 to Q-7 were ruled (see SA Review Notes) and stand. **Q-4 ("separate TH-2") is superseded by the user's decision** to fold TH-2 in; TH-2b replaces it for the RLS half. **Q-6 / RC-6** is moot (§9.1).

| # | Question | Dev recommendation |
|---|---|---|
| R2-Q1 | Reuse `systemConfigRepository.getByKey` (selects `*`, already never-throwing, no repository change), or add a dedicated `select('value')` method per the `new-repository` skill? | **Reuse.** One small row, no new surface, and the user's reuse preference |
| R2-Q2 | Cache TTL 60 s (my proposal) or 30 s to match `EntitlementService`? Stale-on-error with a 10 s back-off? | **60 s**, stale-on-error, 10 s back-off. The tokens are cosmetic and change a few times a year |
| R2-Q3 | `/v2` as a `force-dynamic` server layout (§2.9 option A)? | **Yes.** The alternatives either bake tokens in at build, add a new ISR pattern, change `/v2`'s output, or keep the browser read |
| R2-Q4 | A soft deadline on a cache miss? | ~~No in this slice~~ **SA reversed: 1000 ms deadline required (RC-10)**, folded into §2.7.3 |
| R2-Q5 | Custom rule selector `:root:root:root` (order-independent specificity) rather than relying on `<style>` order after the head sheets? | **`:root:root:root`**, guarded by T-T2 and a probe |
| R2-Q6 | Leave `app/api/admin/ui-config/route.ts` untouched (no invalidation hook, no write-side validation, 8 `console.*` flagged) and record F-1? | **Yes.** In-process invalidation does not reach other Vercel instances, and touching the route pulls a Pino conversion and rules 1 and 2 into a theme slice |
| R2-Q7 | Grammar strictness: are named colours (`^[a-z]{3,30}$`) acceptable in the colour grammar? | **Yes.** Letters only cannot inject, and it keeps today's behaviour for a named colour an admin may have typed |
| R2-Q8 | T-0(g): the main session checks the live row against the grammar and records yes/no only. Enough, or should SA see the check script first? | **Enough**, with the grammar exactly as in §2.7.6 |
| R2-Q9 | Q5 note: the token-read failure moves from a browser `console.error` to a server Pino `warn`. Acceptable as "business unchanged"? | **Yes.** Same event, same fail-soft outcome; only where it is logged changes |

---

## SA Review Notes

**Reviewed by SA — 2026-10-14** (workplan review; code read in this worktree at `6bb1eda1`, Next 14.2.35, React 18.3.1)
**Status:** 🔄 APPROVED WITH CHANGES. Implementation may start once RC-1 to RC-9 are folded into the plan. None of them needs another SA pass before T-1, **except** the RC-7 stop condition.

> **Revision 2 annotation (Dev, 2026-10-15):** RC-1 to RC-9 are now folded into §2, §6, §7, §10 and §11. **RC-7's stop condition was hit** (a non-empty production row) and is **resolved by this revision's design** (§2.7–§2.10), subject to T-0(g). Q-4 is superseded by the user's decision to fold TH-2 in; RC-6 is moot. **SA re-review of revision 2 is needed before T-2** (see the banner at the top and §12 R2-Q1 to R2-Q9). The review below is kept verbatim as the record of the first pass.

### Rulings on §12

| # | Ruling |
|---|---|
| Q-1 | **Approved, both parts.** Remove the nested `V2ThemeProvider` from `app/business-os/crm/layout.tsx` and drop its `'use client'`. Nothing under CRM calls `useV2Theme` (verified by grep), the inner provider doubles the token read, and its stale-`mode` re-run after a late fetch can revert a toggle. Keep `import '../../v2/globals-v2.css'`: BR-1a G-3 pins it, and the layout stays a server component that imports CSS and renders `children` |
| Q-2 | **Approved, with RC-5.** The fail-soft `<Suspense fallback={null}>` goes around `children` inside the provider. On React 18 streaming SSR, an error inside a boundary emits the fallback, marks the boundary for client render, and leaves the response at 200. That is today's behaviour for page code that has never been SSR'd. It also resolves the `/v2/settings` `useSearchParams` bailout (§6.2 option (a)), so no page edit is needed. Its static HTML stays empty under the provider, exactly as today. That is accepted, because `/v2` is legacy and unlinked. Use (b) only if T-1 shows (a) does not clear the build. The boundary is a safety net, **not** a pass condition (RC-5) |
| Q-3 | **CSS-driven icons approved** for `BusinessOSHeader` and `DarkModeToggle`. Server and client markup are identical, and the right icon shows on the first frame. `@custom-variant dark (&:where(.dark, .dark *))` (`globals.css:50`) makes `dark:hidden` / `hidden dark:block` follow the class the script sets. The icons sit in a flex button, so `block` and the default inline `svg` lay out the same. R-8 (`DarkModeToggle` `aria-label`/tooltip driven by `mode`) is accepted as a residual: `/v2` only, not painted, and corrected at mount |
| Q-4 | **Separate TH-2, approved.** The browser read of `system_settings_config` (rule 1, pre-existing) is coupled to the anon-read policy that migration `20260920a` deliberately left open. Closing it needs a prod RLS change on the DB-exposure track and user authorization. TH-1 keeps the read byte-for-byte except the logging line. The main session records TH-2 in the scoping doc |
| Q-5 | **TH-1 before BR-1b. Approved.** `PERFORMANCE_BUSINESS_ROUND_REQUIREMENT.md` §12.6 is amended (addendum "TH-1 lands first", same date): BR-1b branches from `main` after TH-1 merges and re-bases every measurement there. **The preload stays in the server layouts.** It is not co-located with the gate, because the gate is a client component and the P-5 module is `server-only`. F-1's "never emitted" premise and D-1 item 7 are restated. Criterion 3 (hydration of the gate) becomes live on owner routes. The D-7 "first owner content" filmstrip guard is **replaced** by a "time to hydrated owner chrome" guard, because after TH-1 the filmstrip would pass with a broken preload (the Dev's §8 finding is correct) |
| Q-6 | **`warn`.** The outcome is cosmetic and fail-soft: the default palette stays. Note that `.single()` with no row returns an `error` and does not throw, so this line logs only on a thrown or network failure. Use the client logger (RC-6) |
| Q-7 | **`lib/design-system-v2/` approved** for `themeMode.ts`, `V2ThemeScript.tsx` and `v2-theme-tokens.css`: `/v2` uses them and the provider lives there. Import them **by path**. Do not add the script or the CSS to the `index.ts` barrel (RC-8) |

### Rulings on the Dev's surprises (§11)

| # | Surprise | Ruling |
|---|---|---|
| 1 | `/v2/settings` breaks `next build` | **Plausible and handled.** `/v2` has no `dynamic` export and its layout is a client component, so its pages prerender. `/v2/settings/page.tsx:23` calls `useSearchParams` with no boundary. `/v2/agents/new` has its own boundary. Every other `useSearchParams` consumer in scope sits under a `force-dynamic` owner segment. The Q-2 boundary resolves it. T-1 confirms it |
| 2 | Script vs provider for unknown stored values | **The Dev is right, and my analysis sketch was wrong.** The provider uses any truthy stored value as `mode`, so `'garbage'` renders light and is persisted back. The script must be `m ? m === 'dark' : matchMedia(...)`. T-S2 and the mutation probe pin it |
| 3 | The provider palette differs from `globals-v2.css` | **Confirmed.** The sheet follows the provider. The light `:root` values agree with `globals-v2.css` (checked against `tokens.ts`). The dark sets differ: `globals-v2.css` has no dark `--v2-success-*`/`--v2-error-*`, so the T-T overlap assertion as written would fail on main. See **RC-2** |
| 4 | `.dark` never removed on unmount | **Out of scope for TH-1, recorded as follow-up TH-3.** It is pre-existing and TH-1 neither fixes nor worsens it. The provider's inline `--v2-*` on `<html>` also persists, and the new sheet's `:root` rules stay loaded after a client navigation, with values identical to that inline style. So a public page reached by client navigation looks exactly as it does today. Fixing it changes public-page behaviour and needs its own test. After RC-1 it is a small cleanup in the same layout effect. Main session: add TH-3 to the scoping doc |
| 5 | Unused `lib/hooks/useTheme.ts` | **Out of scope, do not touch.** No importer (verified). It is a separate `chore:` deletion, which also removes its `console.log`. Record it beside TH-3 |
| 6 | T-0(e) prod check for a `v2_custom_tokens` row | **Allowed as a read-only check, with RC-7** |

### Verification items requested by TL

| Item | Result |
|---|---|
| Script at segment level only, never in the root layout | ✅ The plan (§2.2, §2.4) and guard G-3 cover it. `app/layout.tsx` has `<html … suppressHydrationWarning>` and no `className`, so the pre-paint class causes no attribute mismatch. The public pages' "never `.dark`" rule (`globals.css:45-75`) holds on a hard load. Client-navigation leakage is the pre-existing TH-3 |
| `mounted` guard kept on the DOM effect | ✅ §2.3(2), G-4, probe "remove the guard → T-S2/T-P2 fail". RC-1 changes the effect **kind**, never the guard |
| Stylesheet guard is behavioural | ✅ T-T collects the provider's real `setProperty` calls with empty custom tokens, independent of the provider's table layout. Fix assertion (4) per **RC-2** |
| 21-route smoke + metric are sound | ✅ The 21 routes are every `page.tsx` under the five mounting layouts (verified by `find`). Add status-code parity (**RC-4**) and the client-entry combinations (**RC-1**). The blank metric is sound. Because the inline scripts are script-blocking behind the head CSS, the CSS is applied by the time the marker is parsed, so `bgAtMarker` is meaningful. Make Step 1 `hasToggleInMarkup:true` the deterministic gate (**RC-9**) |
| Tenant / money / entitlements | ✅ None. No write, no caller-supplied id, no new query, no charge path. No import from `lib/business-os/entitlements/` is added or removed (`readPlanBadge` is unchanged in the business-os layout). The static `/v2` prerender is built with no user, so no account data is baked into shared HTML. Owner segments stay `force-dynamic` |
| Hook rules | ✅ `V2ThemeScript` has no hooks. The header keeps an unconditional `useV2Theme()` (it destructures only `toggleMode`). Removing the early `return null` removes no hook. RC-1's alias is a module-scope `const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect`. That is a real hook, so the `use` prefix is correct (CLAUDE.md feature-flag warning does not apply), and it is called unconditionally. `npm run lint:hooks` is in T-9 |

### Required changes

1. **RC-1 (High): a client-side entry into an owner segment now paints one or more light frames for a dark owner.** Today, a client navigation from a page without `.dark` into `/business-os` paints the blank provider for that frame: for example, every sign-in through `app/auth/callback/page.tsx:151` (`router.push(destination)`), or the `(protected)` layout link at `app/(protected)/layout.tsx:534`. The pre-paint script does **not** run on a client navigation (§2.2). After TH-1, the transition commit paints the children with `mode='light'` and no `.dark`, and the passive mount effect corrects it only after paint. That is a new wrong-theme frame on the most common path into the product. **Fix:** in `theme-provider.tsx`, run the mount (mode-read) effect and the DOM effect through a module-scope isomorphic layout effect, so a client-side mount sets `.dark` and the variables before paint. Keep `if (!mounted) return`. During hydration this changes nothing visible, because the HTML is already painted and the re-render happens before the browser regains control. **Guard:** extend G-4 to assert that both effects use the alias. **QA:** add §7.2 combinations C-2 and C-4 entered **client-side** (sign in through `/auth/callback`, and through the `(protected)` link). Expected: no light frame in the filmstrip. Add a probe: the alias swapped back to `useEffect` must fail G-4. Record it in §11 as R-13
2. **RC-2 (Medium): fix T-T assertion (4). It is cascade-incorrect as written.** `globals-v2.css` dark is `html.dark` (specificity 0,1,1). The new sheet's dark is `:root.dark` (0,2,0), so the new sheet wins in dark mode regardless of load order. The two light `:root` blocks tie (0,1,0), so in light mode order decides. Replace (4) with: (a) **light:** every name declared in both `:root` blocks has an equal value; (b) **dark:** every name that `globals-v2.css` `html.dark` declares **and** the provider writes is also declared in the new `:root.dark`, so the higher-specificity rule always applies; (c) the new sheet's dark selector is exactly `:root.dark`. Do **not** assert per-mode agreement of the two sheets' effective dark values. That fails on main for `--v2-success-*`/`--v2-error-*`, and the cascade makes it irrelevant
3. **RC-3 (Medium): T-S2 must track class flips, not "no records".** `classList.add('dark')` on an element that already has it still sets the attribute and queues a mutation record (DOM spec, which jsdom follows). Observe with `attributeOldValue: true` and assert that `dark` presence never differs between `oldValue` and the current value at any record. The same applies to the MutationObserver in T-P2
4. **RC-4 (Medium): status-code parity in the smoke test.** T-1 and T-10 record each route's HTTP status at **base and branch**, and they must match. `/v2/billing` is a server `redirect()` under the client `/v2` layout. With the new boundary above it, the redirect can be raised inside a Suspense boundary during SSR and become a 200 + client/meta redirect instead of a 307. If the status changes, the landing must still be `/settings?tab=billing` with no flash of `/v2` chrome, and SA is told before T-10 passes
5. **RC-5 (Medium): conditions on the Q-2 boundary.** (a) T-1 proves it on a production build: a server-only throwing child yields 200, a client render, and one logged server error. (b) It is a net, not a pass: the T-10 exit criterion counts **any** server-log render error and **any** console "switched to client rendering" or recoverable-error message as a failure, even when the page looks fine. (c) A code comment says why the boundary exists (§5 Q5) and that it must not be widened to a non-null fallback without SA. (d) Note for BR-1b: a server-side suspend under it (BR-1b's `next/dynamic` gate) streams the subtree after the shell. That is still in the same HTML response and still before JavaScript. Recorded in the §12.6 addendum
6. **RC-6 (Low): logger.** Use `clientLogger.child({ module: 'V2ThemeProvider' })` from `@/lib/logger/client`, the client-side section of `SYSTEM_LOGGING_GUIDELINES.md` and the sibling `LanguageContext.tsx:31`. Call `logger.warn({ err }, 'V2 custom tokens read failed')`. T-P6 mocks that module. G-5 is unchanged
7. **RC-7 (Medium, stop condition): the T-0(e) prod read.** It is read-only, run by the main session through the Supabase connector with the user aware. Use one `select` of the key's existence and whether `value` is empty. **Record only yes/no** in Implementation Notes, never the token values, because the repo is public. **If a non-empty row exists, stop before T-2 and bring it to SA/BA.** TH-1 would then turn today's blank into a default-palette frame lasting seconds on a slow phone before the custom palette swaps in. Whether TH-2 must ship first is then a business call. An empty or absent row means R-6 is not live, so proceed
8. **RC-8 (Low): barrel.** Leave `lib/design-system-v2/index.ts` unchanged. `app/admin/ui-config/page.tsx` imports the barrel, and nothing outside the four layouts should pull the script or the sheet in
9. **RC-9 (Low): §7.1 gate wording.** The deterministic gate is SA Step 1 flipping to `hasToggleInMarkup: true` on the 4 BOS routes, plus an equivalent markup check on `/onboarding-chat` and `/onboarding-build` (their first provider child is in the server HTML). The `blankMs` median ≈ 0 is the corroborating measurement. A value ≤ 0 reads as 0, as the plan says

### Adjusted items (marked by SA)
- §2.3 item 4: approved, with RC-5.
- §2.3: both effects move to the isomorphic layout effect (RC-1). The `mounted` guard is unchanged.
- §2.3 item 5 / §9.1: `clientLogger.child`, `warn` (RC-6).
- §6.3 / T-1 / T-10: status-code parity (RC-4). §7.2: client-entry C-2/C-4 (RC-1).
- §10.1 assertion (4) replaced (RC-2). §10.2 T-S2 and §10.3 T-P2 observer semantics (RC-3). §10.5 G-4 extended (RC-1).
- §11: R-12 becomes follow-up TH-3, `useTheme.ts` is a separate chore, add R-13 (RC-1).
- T-0(e): stop condition (RC-7).

### Optimisation Suggestions (non-blocking)
- `app/onboarding-chat/page.tsx:177`: leave the unused `mode` destructure, as planned. It is harmless.
- When T-1 surfaces SSR defects, prefer moving a browser read into an effect over `suppressHydrationWarning`. Use the latter only for text that legitimately differs (for example a clock), and list each use in Implementation Notes.

### Approval
[x] Workplan approved with the changes above — proceed to T-0. **Hard stop at RC-7** if a non-empty `v2_custom_tokens` row exists. Fold RC-1 to RC-9 into §2, §6, §7, §10 and §11 before T-2.

### Where each RC now lives (revision 2)

| RC | Status | Folded into |
|---|---|---|
| RC-1 | Folded | §2.3(4), §6.3 client-entry, §7.2(d), §10.4 T-P8, §10.7 G-4, §10.9 probe, §11 R-13 |
| RC-2 | Folded | §10.1 T-T1(4) |
| RC-3 | Folded | §10.3 T-S2, §10.4 T-P2 |
| RC-4 | Folded | §4 T-0(h)/T-1, §6.3 (base vs branch status, `/v2/billing` row) |
| RC-5 | Folded | §2.3(7), §4 T-1, §6.3 exit criterion |
| RC-6 | **Moot** | §2.3(9), §9.1: the logged line is deleted with the browser read |
| RC-7 | **Hit, then resolved by design** | §0, §2.7–§2.10, §7.4; replaced by the T-0(g) pre-check |
| RC-8 | Folded and extended | §3 "Not modified", §10.7 G-10 (also covers the reader and the style) |
| RC-9 | Folded | §7.1 |

### SA re-review (revision 2)

**Reviewed by SA — 2026-10-15** (revision 2; code read in this worktree at `936dfd04`)
**Status:** 🔄 **APPROVED WITH CHANGES.** T-2 may start once RC-10 to RC-14 are folded into the plan. None of them needs another SA pass. T-0(g) is accepted as passed (R2-Q8).

#### Rulings on R2-Q1 to R2-Q9

| # | Ruling |
|---|---|
| R2-Q1 | **Reuse `systemConfigRepository.getByKey`. Approved.** Verified (`SystemConfigRepository.ts:154-183`): default client `supabaseServer`, `PGRST116` maps to `{ data: null, error: null }`, any other failure maps to `{ data: null, error }`, and nothing escapes the `try`. `select('*')` on one small row costs nothing measurable. A dedicated method would be new surface for no gain. Rule 1 is satisfied: the read goes through the repository. Note that `getByKey` already logs a failure at `error` with the key, so the reader must not log the same `err` again (see R2-Q9) |
| R2-Q2 | **60 s approved**, as a named constant with a comment giving the reason. Either 30 s or 60 s would do. The read overlaps the hold on owner routes, so the TTL only affects how fast a change propagates, and 60 s is a bound an admin can be told. **Stale-on-error with a 10 s back-off is approved, and the back-off must also apply when there is no last good value** (negative cache: return `{}` and do not retry for 10 s). Otherwise a database outage on a cold instance costs one token query per request. See RC-10 |
| R2-Q3 | **Option (A) approved:** a `/v2` server layout with `force-dynamic`. Verified: `app/v2/layout.tsx` uses no hooks, and nothing under `app/v2` exports `dynamic`, `revalidate` or `generateStaticParams`, so the layout's `force-dynamic` does not conflict with anything. Option (B) would bake tokens in at build. (C) is a new pattern. (D) changes output. (E) keeps the rule-1 violation. G-9 pins this choice. The `/v2/dashboard` response-time number in §7.3 is recorded only, as planned: legacy, unlinked |
| R2-Q4 | **Changed: a deadline is required (RC-10).** The Dev assumed the worst case is "the `supabaseFetch` timeout, overlapped with the hold". That timeout is **20 s in production** (`lib/supabaseFetch.ts:228-233`), and `AbortError` is not retried. With single-flight, one stalled socket on a cache miss holds **every** owner page load on that instance for up to 20 s. Today the theme read runs in the browser and blocks nothing, so without a deadline this is a new failure mode (Q5). The sibling reads (`readInitialLanguage`, `readPlanBadge`) have no deadline, but they are pre-existing and this slice must not add a new blocker. The trade-off the Dev names is a page load that shows defaults with no later swap. That is acceptable: it equals today's outcome when the browser read fails |
| R2-Q5 | **`:root:root:root` approved.** It is valid, with specificity 0,3,0, so it does not depend on load order. Verified that no stylesheet sets a `--v2-*` value with `!important`: the `!important` rules in `globals-v2.css` are element rules, not custom properties, and `globals.css` only mentions `--v2-*` in a comment. Only the provider's inline style on `<html>` outranks it, and T-P7 makes that style carry the same values. The probe that changes the selector to `:root` is approved |
| R2-Q6 | **Approved: the route stays untouched in this slice**, including no invalidation hook and no write-side validation. An in-process invalidation would clear only the instance that served the POST, so it is not worth touching the route for. The read side is the security boundary, and with the allow-list plus grammar it is sufficient (see "CSS injection" below). **Logging rule:** the route (8 `console.*`) and `app/admin/ui-config/page.tsx` (4) are only *read* here. CLAUDE.md § Logging also says "don't reformat files you aren't otherwise working on", so converting them is not part of this diff. The main session must still **surface them to the user** as the logging proposal (RC-14). F-1 is the vehicle: Pino conversion, Zod on `save_tokens` that rejects bad values with a message using `sanitizeV2CustomTokens`, and the repository in place of the route's own client. If the user explicitly asks for the conversion in this slice, it becomes a separate commit, the whole file is converted, and SA reviews it |
| R2-Q7 | **Named colours approved**, case-insensitive (`currentColor`). A run of letters only cannot end a declaration or an element. Note that the CSS-wide keywords `inherit`, `initial`, `unset` and `revert` also match the pattern. That is behaviour parity: today `setProperty` applies them the same way, and they are harmless. No action needed |
| R2-Q8 | **T-0(g) is sufficient, and accepted as passed.** Both live values are `#` followed by 6 characters, with no forbidden characters, so they pass the hex branch. The second half of the question, "any key outside the allow-list?", was not answered explicitly. That does not block, because an unknown key is ignored today too. One gap remains: T-0(g) is a single snapshot, and the §7.4 first-frame gate **cannot** detect a dropped value. If a value is dropped, the provider and the inlined rule both get the sanitized object, so they agree on the default. RC-12 closes that gap at T-12 |
| R2-Q9 | **Approved as business-unchanged.** It is the same event with the same fail-soft outcome, logged in a different place. Logs are not business records. Two conditions apply. (1) **No double logging.** On a `{ error }` result, `getByKey` has already logged `error` with the `err`, so the reader logs `warn` with a reason only (`{ reason: 'read_failed' }`, no `err`). The reader logs `{ err }` only for what it catches itself: a throw, the deadline, or a non-object value. (2) The back-off (R2-Q2) limits the volume during an outage to one line per instance per 10 s |

#### Verification items

| Item | Result |
|---|---|
| CSS injection, end to end | ✅ **with RC-13.** The path is: database (admin route, unvalidated) → `getByKey` → `sanitizeV2CustomTokens` (iterates the allow-list, never the input's keys; own-property check; string only; length cap; anchored per-group grammar with no `;{}<>\*@`, quotes or `/` in shadows) → frozen cache → layout → `buildV2CustomTokenCss`, which iterates the allow-list again and re-checks each value against the grammar → `dangerouslySetInnerHTML`. The same sanitized object is the prop the provider's `setProperty` uses. A value cannot end the declaration, close the rule, open a comment, or produce `</style`, because `<` is never admitted. Property names come only from the constant map, never from data. T-C4 tests the builder directly, and two mutation probes test the guard. That makes the admin route's lack of validation a data-quality issue (F-1), not a security hole. RC-13 tightens two small points |
| Service role, rule 4 | ✅ Justified and documented (§2.7.2). It is a constant key and a read-only, platform-wide value. The table has no `user_id`. Nothing is caller-supplied, nothing is user-specific in the read, the cache or the output. Starting the read before the payment hold leaks nothing, because the value is the same for every visitor. The service role is also the right choice ahead of TH-2b. The header comment must give the rule-4 reason in so many words ("intentional RLS bypass: global platform setting, no `user_id` column") |
| No extra serial round trip (BR-1a lesson) | ✅ **This honours G-2 rather than dodging it.** Verified against `ownerLanguageFirstFrame.guard.test.ts:60-103`. The token promise is started before the hold and awaited after the unchanged `Promise.all`. Because it has been in flight since before the hold, the wait is the maximum of the reads, not their sum. G-2's intent ("the language read overlaps the hold") is unchanged and still enforced. G-7 adds the same three properties for the token read: started before the gate, called exactly once, first use after the gate. Putting the token read inside the `Promise.all` would be equivalent in latency, but it would change G-2's pinned text for no gain. The shape is fine. `/v2` is serial by necessity, because it has no hold, and RC-10's deadline bounds it |
| Cache propagation | ✅ §2.7.3(5) is accurate. Each instance becomes consistent within the TTL, a cold instance reads fresh, client-side navigation inside a segment keeps the layout's tokens, and a reset (no row) returns `{}` without serving stale (T-R6). One addition from RC-10: when the deadline fires, the in-flight read still fills the cache. So the worst case for one instance is "TTL + one page load", which §5 Q3 should say |
| T-T2 behavioural cascade guard | ✅ It is sound. It compares the provider's real `setProperty` output with a resolver over the actual sheets plus the built rule, in both modes and in both passes (with and without `globals-v2.css`). The resolver rejects any unknown selector. It asserts the 31-entry count and checks that the changed-set equals the allow-list, and it repeats with a partial set in the production row's shape. The probes (selector set to `:root`, a dropped key) fail it. Synthetic values only. One requirement: the resolver's specificity table must be **computed** from the selector (count of classes and pseudo-classes, count of types), not written out per selector. Otherwise a selector edit and a table edit could drift together and still pass |
| RC-1 isomorphic layout effect | ✅ §2.3(4), G-4, T-P8 (a sibling layout effect reads the DOM in the same commit), the probe, and the §7.2(d) client-entry runs. With tokens as a prop, the first effect run after `mounted` writes custom values (T-P7), so a client-side entry has no default-primary frame either |
| Segment-only placement | ✅ G-1's five-way set equality means any file that renders the style or the script, or calls the reader, without also mounting the provider fails the guard. That is stronger than G-3's hand-kept list of public segments. G-3 still pins `app/layout.tsx` explicitly. The §6.3 public-page check covers the HTML |
| Smoke test and metrics | ✅ **with RC-12.** §6.3 now records the `<style data-v2-custom-tokens>` element per route, status parity, client entries, and the read-only admin page. §7.3 measures the cold-cache path. §7.4 gates the first frame. What is missing: proof that the live row's values *survive* sanitizing (RC-12), and a `/v2` cold-miss data point under the deadline (RC-10) |
| §5 / §6 answers | ✅ Q2 and Q4 are unchanged. **Q1 note (c)** (a future invalid value is ignored) is accepted as business-unchanged. No live value is affected (T-0(g)), and the alternative, writing unvalidated admin text into a raw `<style>` on every owner page, is a security regression. F-1 turns it into an explicit save-time rejection. **Q3** is accepted. Add "worst case TTL plus one page load per instance, if the deadline fired" (RC-10). **Q5** is accepted with RC-10. Without the deadline, Q5 would be **No → Yes**, because a stalled read could hold every owner page for 20 s |

#### Required changes

10. **RC-10 (High): bound the wait, and back off without a last good value.** (a) Every wait for a refresh in `readV2CustomTokens`, cold or expired, is raced against `V2_CUSTOM_TOKENS_DEADLINE_MS = 1000`, a named constant with a comment explaining the 20 s `supabaseFetch` timeout and single-flight. If the deadline fires, return the last good value if there is one, otherwise `{}`. The shared in-flight read **continues** and fills the cache when it lands. Clear the timer when the read wins. Log `warn` with `{ deadlineMs }` once per flight, not once per waiting caller. (b) A failure with **no** last good value returns `{}` and is not retried for 10 s, the same back-off as stale-on-error. (c) Tests: **T-R8** uses fake timers. A read that never resolves gives `{}` at 1000 ms. With a cached value, it gives that value. Ten callers produce one `warn`. When the read later resolves, the next call is served from the cache without a new read. **T-R5b**: a cold failure followed by a call 5 s later makes no repository call. (d) Probes: the deadline removed must fail T-R8. The back-off limited to the stale case must fail T-R5b. (e) §7.3: report the cold-miss read time. If its p95 is above 500 ms, bring it to SA before T-12 passes, because the deadline would be firing in normal operation. (f) Update §2.7.3(6), §5 Q3/Q5, R-16 and R2-Q4 to match. If 1000 ms looks wrong once measured, the value goes back to SA. The deadline itself does not
11. **RC-11 (Medium): G-8 fails on `main` as written.** `lib/hooks/useUIVersion.ts` is a `'use client'` module that reads, and writes, `system_settings_config` through `@/lib/supabaseClient` (`:7`, `:17-18`, `:49-50`, `:72-73`). It is a **third** browser reader, and the Dev's surprise 3 and §9.2 do not list it. It appears to have no importers (grep). `app/admin/settings/page.tsx` mentions the table only in a comment, and `code()` strips that. Fix: G-8 applies to `lib/design-system-v2/**`, the five mounting layouts and everything under `app/business-os`, `app/onboarding-*` and `app/v2`. Alternatively, keep the wide scan with an explicit exemption list in which each entry carries its reason and the follow-up id (`useUIVersion.ts` → TH-2b). Do not edit `useUIVersion.ts` in this slice. Add it to the §9.2 inventory and to §11's surprises. Its 3 `console.error` calls are flagged for the user with F-1/F-4. It is likely a deletion, like F-4
12. **RC-12 (Medium): prove the live values survive sanitizing, at T-12.** In the branch smoke, read the raw HTML of `/business-os` and record **names only**: the set of custom properties declared in `<style data-v2-custom-tokens>`. It must be exactly `{--v2-primary, --v2-secondary}`. That is the only check that would catch a dropped live value, because §7.4's `customFirstFrame` stays `true` when a value is dropped (the provider and the style share the sanitized object). Also re-run T-0(g) (yes/no) immediately before handover to RM if the row's `updated_at` has changed since 2026-10-15
13. **RC-13 (Low): tighten the sanitizer and the builder.** (a) The builder emits the **trimmed, validated** string, never the raw one. (b) The cached object is frozen **deeply** (the root and each group), because it is shared across requests in the process. (c) Add to T-C4: a value containing `\n`, U+2028, `<!--` or `-->`, and a hex value with surrounding whitespace, which must be emitted trimmed. (d) T-C1 also feeds an object whose prototype is not `Object.prototype` (for example `Object.create(null)` with valid keys). It decides and pins whether that counts as a plain object. Accepting it is fine, because only own properties are read
14. **RC-14 (Low): process.** The main session tells the user about the logging rule for `app/api/admin/ui-config/route.ts` (8), `app/admin/ui-config/page.tsx` (4) and `lib/hooks/useUIVersion.ts` (3), and proposes F-1 as the vehicle. Record the user's answer in Implementation Notes. This slice does not wait for the answer

#### Optimisation suggestions (non-blocking)
- §2.7.3(3): consider serving the stale value immediately when an entry has expired and refreshing in the background (stale-while-revalidate). With RC-10 it is optional. The deadline already bounds the wait. Adopt it only if it keeps the code to one path.
- `getByKey` selects `*`. If F-1 adds a typed getter for the admin route, the reader can move to it later. Do not do it now.

#### Approval
[x] Revision 2 approved with RC-10 to RC-14. Fold them into §2.7.3, §5, §7.3, §9.2, §10.6, §10.7 G-8, §10.9 and §11, then proceed to T-0 and T-1. No further SA pass is needed before T-2. **SA code review** checks RC-10 (timer path and back-off), RC-11 (G-8 scope) and RC-13 against the diff. Q-1 to Q-3 and Q-5 to Q-7 from the first review stand. Q-4 is superseded by the fold-in. RC-6 is moot.

### SA code review

**Code Review by SA — 2026-10-15** (uncommitted diff in this worktree on `936dfd04`: 13 modified files, the new files under `lib/design-system-v2/`, and `components/business-os/__tests__/BusinessOSHeader.themeIcon.render.test.tsx`)
**Status:** 🔄 **APPROVED WITH CHANGES.** No High findings. CR-1 and CR-2 are small code or test edits. CR-3 is a proof that needs no code change. CR-4 is a doc edit. None of them needs another SA pass if done as written. QA may start in parallel. **T-12 cannot pass until CR-1 and CR-3 are done.**

#### Focus items

| # | Item | Result |
|---|---|---|
| 1 | **IN-2: DOM write in the mount layout effect, state in `startTransition`** | ✅ **Correct and complete.** (a) **No flash.** On a hard load, `.dark` comes from `V2ThemeScript`, the defaults from `v2-theme-tokens.css` and the custom values from `:root:root:root`, all before first paint. The mount layout effect then writes the same values inline: `applyTheme` reads the `customTokens` prop, so it never writes defaults first (T-P7), and the mode decision is the script's (T-S2). On a client-side entry the layout effect writes everything before the first paint (T-P8, probe 5). (b) **No hydration mismatch.** Nothing in render depends on `mode` except `DarkModeToggle`'s `aria-label`/tooltip (R-8) and an unused destructure in `onboarding-chat/page.tsx`. Hydration renders with `mode='light'`, which matches the server. The transition update is applied after the boundary hydrates at the higher lane, so it is an ordinary update, not a mismatch. `<html>` gets `.dark` and inline style by DOM mutation only. React never set those props, so it never patches them. (c) **The `mounted` guard is kept** on the mode effect, and that effect still calls `applyTheme(mode)` once `mounted` flips, so toggling is unchanged. (d) **The `useMemo` on `[customTokens, mode]` is right.** In the common light case, `setMode('light')` bails out and `mounted` is not in the value, so no context change reaches the dehydrated boundary at all. In the dark case, the change travels as a transition, which React 18.3 handles by hydrating the boundary first (selective hydration at a higher lane). Probe 4 shows the synchronous version fails. (e) A toggle clicked while the transition is still pending is rebased in insertion order, so the final mode is `toggle(initialMode)`. That is correct. **One test gap: CR-2** |
| 2 | **IN-3: `paymentHold.test.ts`** | ✅ **Guarantee intact.** The guard now accepts only the exact prefix `[LANGUAGE_START, TOKENS_START]`, in that order, and the next statement must be `await redirectIfAwaitingPayment()`. Any other statement, a reordering or an `await` before the gate fails it. `readV2CustomTokens()` is an `async` function wrapped in `try`. It awaits nothing before the gate, renders nothing, reads no account data (a constant global key) and never rejects, so the dangling promise on a redirect cannot surface as an unhandled rejection. The plan read is still after the gate. G-7 adds "called once, first use after the gate". The assertion is not weakened: the old version allowed 0 or 1 leading starts, and the new one allows 0, 1 or 2, as a fixed prefix |
| 3 | **IN-6: `/v2` already dynamic; `force-dynamic` + G-9 kept** | ✅ **OK, keep both.** At base the segment is dynamic only because of a distant ancestor. An unrelated change there would silently make `/v2` static, and the reader would then bake the tokens in at build (option B). A local `force-dynamic` costs nothing, because the rendering mode does not change, and G-9 makes the guarantee local. Doc consequence: **CR-4** |
| 4 | **RC-10 deadline and back-off; RC-13 sanitizer; CSS injection end to end** | ✅ **with CR-1.** *Deadline:* one timer per flight, created when the flight starts and cleared by `flight.then` (the flight never rejects, because `refresh` catches everything and `.finally` keeps that). A caller that joins late waits only for the rest of the same deadline, which is a stricter bound than 1000 ms per caller and acceptable. After the deadline fires, later callers race an already-resolved promise and return at once. The flight keeps running and fills the cache. There is one `warn` per flight. *Back-off:* `retryNotBeforeMs` is set on `{ error }` and on a throw, whether or not a last good value exists, and cleared on success. During the back-off a call returns the stale value or `{}`. A reset (no row) is a success that caches `{}` and serves no stale value (T-R6). A non-object value is logged and cached as `{}`, which is acceptable. *Sanitizer and builder:* both iterate the allow-list only and use `hasOwn` (prototype keys are never read). Values must be strings, trimmed, 1–200 long, and match an anchored grammar. The builder re-validates and emits the trimmed value. Property names come from the constant map. The result is deep-frozen. No grammar admits `<`, `;`, `{`, `}`, `\`, `*`, `@`, quotes or `!`. So `</style`, `/*`, `<!--`, a declaration break and an escape sequence are all impossible, and `dangerouslySetInnerHTML` on `<style>` is safe. The admin save route's lack of validation stays a data-quality issue (F-1), not a hole. *Measurement gap:* **CR-1** |
| 5 | **Service-role use (rule 4)** | ✅ The reader's header states the intentional RLS bypass in so many words: "global platform setting, no `user_id` column". The key is constant and the read goes through `systemConfigRepository.getByKey` (rule 1). Nothing user-specific is read, cached or returned. `import 'server-only'` is the first statement (T-R7), so the module cannot reach a client bundle |
| 6 | **Segment-only placement** | ✅ `app/layout.tsx` is untouched. The script, the style, the sheet import and the reader appear only in the three owner layouts and `app/v2/layout.tsx`, each first in the tree and outside every provider. The CRM layout has none of them, and its parent supplies them. G-1 (five-way set equality), G-2 and G-3 pin this, and probe 22 proves G-3 bites. Leftovers after a client-side exit are the pre-existing TH-3 |
| 7 | **No browser Supabase client in the provider** | ✅ The `@/lib/supabaseClient` import, the fetch and the `console.error` are deleted. The provider imports `V2CustomTokens` with `import type` only (G-12). G-8 (narrowed per RC-11) and T-P5 pin this, and probe 28 proves it |
| 8 | **RC-5(a)** | **Ruled below: a Dev-run curl proof is required (CR-3)** |
| 9 | **Hook rules, `console.*`, entitlements** | ✅ `useIsomorphicLayoutEffect` is a real hook alias at module scope, called unconditionally twice. `useMemo` is unconditional. The early `return null` that sat after the hooks is gone. `lint:hooks` exit 0. **`console.*`:** 0 in every modified and new file. The provider's one call was deleted with the fetch. The three read-only files (`app/api/admin/ui-config/route.ts` 8, `app/admin/ui-config/page.tsx` 4, `lib/hooks/useUIVersion.ts` 3) are flagged and handled under RC-14/F-1. They are not touched in this diff, which is correct under "don't reformat files you aren't otherwise working on". **Entitlements:** the diff adds and removes no import from `lib/business-os/entitlements/`. The only hit is the unchanged `readPlanBadge` import line, which appears as hunk context in `app/business-os/layout.tsx`. `test:bos-entitlements` is green |

#### RC-5(a) ruling

**T-P4 plus a clean 21-route smoke is not enough. A full throwaway spike branch is not needed either. Required: a Dev-run, curl-only proof on a production build in the scratch export (CR-3).**

Why: T-P4 runs `renderToString`, not Next's app-render pipeline. What protects owners is how **Next 14.2 in production** handles a generic error under the boundary: it should log the error with a digest, emit the client-render marker and keep a 200, and it should not use the `error.tsx` path or a 500. The smoke runs one account through 21 routes, so it cannot reach data-dependent SSR throws, such as a field one account has and another lacks. For every path the smoke misses, the boundary's production behaviour is the whole of Q5. That makes the proof worth one build. Next 14.2's own `useSearchParams` CSR bailout relies on the same mechanism, so a pass is expected, but a generic `Error` takes a different branch of Next's `onError`.

It is cheap, and the Dev can run it without signing in. `/onboarding-*` is exempt from the middleware's onboarding check, and `redirectIfAwaitingPayment` returns without redirecting for a signed-out visitor (`paymentHoldGate.ts:64`). So an anonymous `curl` reaches the provider. See CR-3 for the steps.

#### Code Review Comments (required changes)

1. **CR-1 (Medium): `lib/design-system-v2/server/readV2CustomTokens.ts:318`. The RC-10(e) measurement cannot be taken as planned.** The cold-miss read time is logged only at `debug` (`{ keys, ms }`). The live logger, `lib/logger.ts:26`, pins production to `info` and has **no** `LOG_LEVEL` override, deliberately (D-OI8). So under `next start` that line is never emitted, and the §7.3 "p95 ≤ 500 ms, else stop" gate has no data source. **Fix:** log a completed read at `info` with `{ ms, keys }`, and on a failure path add `ms` to the existing `warn`. A completed read happens at most once per TTL per instance, plus one per back-off on failures, so the volume is trivial. Never log a value: the logged fields are a count and a duration. Keep `debug` for nothing else, or drop it. Update §2.7.5 and §7.3 to name the `info` line. Add a T-R assertion that a successful cold read logs `ms` at `info` and that no logged object contains a synthetic token value. Without this, the user's T-13 run would come back with no data
2. **CR-2 (Low): `lib/design-system-v2/__tests__/V2ThemeProvider.ssr.test.tsx`, T-P2 with a real consumer.** T-P2 hydrates a plain `<span>`. IN-2's risk is a context change reaching a dehydrated boundary, and the boundary's real consumers read `mode`: `DarkModeToggle`'s `aria-label`, and the destructure in `onboarding-chat/page.tsx`. **Add a T-P2b case:** stored `'dark'` and `.dark` pre-set. Server-render a child that renders `mode` as text or in an attribute (for example `ToggleProbe`), then `hydrateRoot` and flush. Assert zero real `console.error` (no "switched to client rendering", no mismatch), no `dark` flip, server text `light`, and final text `dark` after the transition. Probe 4 (synchronous setState) must also fail this case
3. **CR-3 (Medium, proof only, no code change in the diff): RC-5(a) curl proof.** In the existing scratch `git archive` export, not this worktree: add a `'use client'` component that throws `new Error('TH1-RC5a')` when `typeof window === 'undefined'`, render it as the first child of `app/onboarding-build/page.tsx`, then run `next build && next start` (with `.env.local` copied in and deleted afterwards, as in IN-6). Run `curl -s -o out.html -w '%{http_code}' http://localhost:3000/onboarding-build` signed out. **Pass:** (a) status `200`; (b) `out.html` contains the layout's `<script>` (V2ThemeScript) and the `<style data-v2-custom-tokens` element, so the shell above the boundary rendered; (c) it contains React's client-render boundary marker `<!--$!-->` and does not contain the `error.tsx` or global-error markup; (d) the `next start` log shows the error exactly once, with a digest. Record (a)–(d) as yes/no in Implementation Notes and delete the export's junction with `cmd /c rmdir`. **If any of them fails, stop and bring it to SA before T-12 passes:** the net would not be a net in production
4. **CR-4 (Low, doc): correct the record IN-6 overturned.** §1 ("statically prerendered at build"), §2.9 (option table and "`/v2` pages stop being prerendered"), §6.1 and §6.2 (the `/v2/settings` build break), §7.3 (the `/v2/dashboard` row, "base is a static file"), R-2 and R-19 still describe `/v2` as static. Add "(superseded by IN-6: `/v2` was already dynamic; `force-dynamic` is kept as a local guarantee)" to each, or rewrite them in place. BR-1b and future readers start from §2.9, not from the Implementation Notes

#### Notes for QA and for the user's T-12 run (no code change)

- **RC-4, `/v2/billing`: expect the status to change.** It is the only server `redirect()` under the wrapped segments (grep: no `redirect`, `notFound` or `permanentRedirect` in any other page under `app/business-os`, `app/onboarding-*` or `app/v2`). It now sits under the provider's Suspense boundary, so Next 14 will most likely answer `200` and redirect on the client (meta refresh or the router), not `307`. RC-4's acceptance applies: the landing is `/settings?tab=billing`, and there is no flash of `/v2` chrome. The fallback is `null`, and the chrome is inside the boundary, so none is expected. Record both statuses. SA accepts a 307 → 200 change on this legacy, unlinked route if the landing passes
- The layout's own payment-hold redirect is still raised **above** the boundary, before render, so its 307 is unchanged on every owner route
- RC-12 (names only) and the RC-10(e) p95 depend on CR-1 being in the build the user measures

#### Optimisation Suggestions (non-blocking)

- `customTokens.ts:91, 96, 98`: `\s` in the functional-colour, length-list and shadow grammars also admits newline, form feed, U+2028/2029, NBSP and U+FEFF. None of these can inject (no `<`, `\`, `;`, `}`). But U+2028 and NBSP are not CSS whitespace, so a value containing them is silently invalid at use time. `[ \t]` (or a plain space) would reject them at sanitize time and leave a `droppedKeys` trace. If changed, add those characters to T-C2 as rejects
- `app/business-os/crm/layout.tsx`: `return <>{children}</>` could be `return children`. Purely cosmetic
- `applyTheme` calls `localStorage.setItem` unguarded inside a layout effect. Storage that throws would now throw during commit rather than in a passive effect. This is pre-existing: the old mount effect's `getItem` was unguarded too, and the script's `try` already covers the pre-paint half. Not for this slice. Note it with TH-3 if anyone touches the provider again

### Code Approved for QA: Yes, with conditions

QA may start now. CR-2 and CR-4 must land before RM. CR-1 must land, and CR-3 must pass, before T-12/T-13 are run or accepted. Neither needs an SA re-review if done as written. Escalate only if CR-3 fails or the CR-1 data shows p95 > 500 ms.

### SA ruling: IN-11

**SA ruling — 2026-10-15** (RC-10(e) stop condition, IN-11 data, TL's concern about the deadline-fired page)
**Status:** 🔄 **FIX REQUIRED (design change, small).** TH-1 does not go to T-12 as built. Two changes, RC-15 and RC-16, then the revised gate below. No user business decision is needed.

#### What the data actually says

1. **IN-11 mixes two different waits, and they need different answers.** Of the six samples, one (1718 ms) is a **cold** read with no last good value. The other five are **TTL-expiry** reads in a warm process. Under the code as built (`readV2CustomTokens.ts:153-158`), an expiry read with a stored value still makes the page **wait** for the refresh, up to the deadline. If the deadline fires there, the page gets the last good value, so the colours are right. But every owner page that lands on an expired entry pays 470–1020 ms of extra server time, once a minute per instance. On `/v2` the read is serial, and on owner routes it is hidden only when the hold is slower. That is a latency regression on a performance slice. It is the larger finding, and TL's p95 concern really points at it.
2. **TL's concern is correct for the cold case.** A cold read with no last good value that misses the deadline renders no custom style, and nothing corrects it for that page view. Today's browser read always lands on the right colours a moment later. So on that path TH-1 is **worse than today**, and the business-unchanged filter (§5 Q1/Q5) does not allow that. The scoping decision of 2026-10-15 (§0) was "no wrong brand colours". Default colours that never correct are exactly wrong brand colours. IN-10 request 1 already shows it in a production build. On Vercel the cold path is a cold function start plus a cold `supabase-js` client, the 1019 ms case, so it would happen after every deploy and idle scale-down. The claim in RC-10 and R2-Q4 that this "equals today's failed browser read" holds only for a **failed** read. It does not hold for a **slow** one. SA's earlier wording was too broad and is corrected here.
3. **The absolute numbers come from this machine, not from the design.** The raw query is 248–299 ms warm from here, and the in-app time adds event-loop contention from the same render. A local run cannot tell us the Vercel number. It can tell us whether the design behaves correctly when the read is slow, and this machine is a good place for that, because it is reliably slow.

#### Options weighed

| Option | Ruling | Why |
|---|---|---|
| (a) Measure on a Vercel preview, accept the residual | **Measure there: yes (as a guard, see the gate). Accept the residual: no** | Even if Vercel's p95 is fine, cold starts happen after every deploy, and the residual is a page that stays on the wrong colours, which is below today. A good p95 does not license a worse cold path |
| (b) Client fallback through a public read-only route | **Adopted (RC-16), cold path only** | It turns the one remaining bad path into **exactly today's behaviour** (defaults, then the right colours a moment later), so every path is now equal to or better than today. It reuses `readV2CustomTokens` (rule 1: no browser DB read) and fires only on the rare unknown-state render |
| (c) Longer deadline | **Rejected** | A cold start is already the slowest page an owner sees. Adding up to 1–2 s to it, to save a colour swap that (b) handles, trades a cosmetic issue for a blocking one. 1000 ms stays as it is (most cold reads land in time, with no swap) |
| (d) Warm at module load or instance start | **Rejected for this slice** | On Vercel the module loads during the same cold request, so there is no head start worth having. `instrumentation.ts` does not exist here, and Next 14.2 needs the experimental `instrumentationHook` flag to add it. That is a new pattern for a few hundred ms on a path (b) already covers |
| (e) Last-known tokens in a cheaper store (Edge Config, KV, a build-time snapshot) | **Rejected** | New infrastructure (CLAUDE.md rule 7, reuse existing infra) for a value changed a few times a year. A build-time snapshot would also show the **old** brand after an admin change until the next deploy, which is a different kind of wrong colour |
| (f) Stale-while-revalidate | **Adopted (RC-15), required** | It was SA's optional suggestion against §2.7.3(3), and the data makes it required. It removes the TTL-expiry wait entirely, so the deadline applies only to the cold, no-value read. It shortens the code path rather than adding to it |

#### Required changes

15. **RC-15 (High): stale-while-revalidate in `readV2CustomTokens`.**
    (a) If a last good value exists, **return it at once**, whether it is fresh, expired or in back-off. If it has expired and no back-off applies, start (or join) the single flight **without awaiting it**. The cache fills when the flight lands, and the next load gets it.
    (b) Only when there is **no** last good value does the caller wait, raced against `V2_CUSTOM_TOKENS_DEADLINE_MS` (1000 ms, unchanged), exactly as now. The one-timer-per-flight rule, the one `warn` per flight, single-flight, the back-off and "never rejects" all stay.
    (c) A dangling refresh must never reject, and it already cannot (`refresh` catches everything). If Vercel freezes the instance after the response, the flight resumes or times out on the next invocation. The stale value keeps being served meanwhile, and the back-off covers a dropped socket. State this in the header comment. Do **not** add `waitUntil` or `after` (Next 14.2 has no stable `after`; that would be a new pattern).
    (d) Update the header (guarantees 3–4), the TTL and deadline constant comments, §2.7.3(3)/(6), §5 Q3 (propagation stays "TTL plus one page load per instance") and R-16.
    (e) **Tests (T-R10, fake timers):** an expired value plus a read that never resolves returns the stale value **without advancing timers** (the call resolves on a microtask flush, not at 1000 ms). It starts exactly one repository call, and ten concurrent callers still make one call. When the read resolves, the next call returns the new value. T-R8's "with a cached (expired) value it gives that value" case changes from "at 1000 ms" to "at once". **Probe:** restore the await on the expired path, and T-R10 must fail.

16. **RC-16 (High): a client correction, for the cold, unknown-state render only.**
    (a) **Reader result.** Tell "known" (a completed read, including a known-empty reset, which is `{}`) apart from "unknown" (no completed read yet: the deadline fired with no value, or a cold back-off). Add an export, for example `readV2CustomTokensWithStatus(): Promise<{ tokens; known: boolean }>`, and have `readV2CustomTokens` delegate to it. Alternatively, change the return type and adjust the four layouts. Choose whichever keeps the pinned text of G-7 and the `paymentHold` placement guard unchanged; do not weaken either guard. "Known" means `state.value !== null`. A reset (no row) is known, and it must **not** trigger a client fetch: showing the defaults is correct there.
    (b) **Layouts and provider.** The four layouts pass `customTokensKnown` to `V2ThemeProvider` as a prop. There is no DOM marker. The provider already receives the server value as a prop, so a boolean beside it adds the least new surface. `V2CustomTokensStyle` is unchanged. On mount, and **only** when `customTokensKnown === false`, the provider makes one `fetch('/api/design-system/v2-custom-tokens', { cache: 'no-store' })`. On `success: true` it runs the result through `sanitizeV2CustomTokens` (defence in depth; `customTokens.ts` is pure, so the client bundle cost is small), puts it into state, and re-applies it through the existing `applyTheme` path. On any failure it stays on the defaults silently, with no `console.*`. If client logging is wanted, it uses `clientLogger` (Q-6). This is today's behaviour, with the same visible swap, on this path only. An unmount before the response must not write (abort or ignore). **Amend G-12:** the provider may import the pure `sanitizeV2CustomTokens` as a value, and nothing else from `customTokens.ts` as a value.
    (c) **Route: `app/api/design-system/v2-custom-tokens/route.ts`.** Build it with the `new-api-route` skill, and record these deliberate deviations in the route's header:
        - It is **GET-only and public** (no `getUser`). The values are cosmetic, global and not secret, and they are already anon-readable today through RLS. Signed-out owner pages (`/onboarding-*`) need the correction too, and the middleware does not gate `/api`.
        - It has no input, because there is no query or body. Zod's place is taken by the **output** check: the response passes through the sanitizer, which is stricter.
        - The skill's "a public route verifies a signature or secret" item is for webhooks that act. This route only reads one constant key, so the item does not apply.

       What it does:
        - It calls `readV2CustomTokensWithStatus` with its own longer wait, a named constant `V2_CUSTOM_TOKENS_ROUTE_WAIT_MS = 5000`. It holds no page, so it can wait longer. Implement this as a per-call deadline option on the same single flight, not as a second reader.
        - It returns `200 { success: true, data: tokens }` only when the tokens are known. Otherwise it returns `503 { success: false, error: 'Theme unavailable' }`, so the client never applies an unknown `{}`.
        - Both responses carry `Cache-Control: no-store`, so no CDN can pin a cold answer.
        - It sets `export const dynamic = 'force-dynamic'` and is registered under G-9.
        - It logs with Pino plus `correlationId`. There is no audit, because this is a cosmetic read.
        - Rule 4: the same documented service-role bypass, through the repository.
    (d) **Guards and tests:**
        - **T-P9:** with `customTokensKnown` true or omitted, there are **zero** `fetch` calls. The prop defaults to `true`, so a layout that forgets it cannot cause a fetch storm. The four layouts must still pass it explicitly (G-13).
        - **T-P10:** with `false` and a mocked route response, `--v2-primary` from the response is applied on `<html>`. A 503 or a network error leaves the defaults, with zero `console.error`.
        - **Route integration test** (CLAUDE.md § Testing): the happy path, the unknown-state 503, and a check that the payload holds only allow-listed keys after a poisoned repository value.
        - **G-13:** the four layouts pass `customTokensKnown`, and the provider's only `fetch` targets that one path.
        - G-8 and T-P5 stay as they are, so there is still no `supabaseClient` in the provider.
        - **Probes:** fetch unconditionally (T-P9 fails); drop the client sanitize (the poisoned case in T-P10 fails); return `{}` with 200 when unknown (the route test fails).
    (e) Update §2.3, §2.7, §3 (one new route, one new test), §5 Q1/Q5 (below), §10 and §11. In §11, update R-16 and add R-21: "cold-start correction route unavailable → defaults for that page view, equal to today's failed read".

#### §5 filter after RC-15 and RC-16

| Path | Today | TH-1 as built | TH-1 after RC-15/16 |
|---|---|---|---|
| Warm, fresh cache | Defaults, then the right colours after a browser read | Right colours on the first frame | Same as built |
| Warm, expired cache | As above | Right colours, but the **page waits** 470–1020 ms (IN-11) | Right colours on the first frame, **no wait** |
| Cold, read lands inside 1000 ms | As above | Right colours on the first frame; the page waits for the read | Same as built |
| Cold, read misses 1000 ms | As above | **Defaults for the whole page view (worse than today)** | Defaults, then the right colours a moment later (**equal to today**) |
| Database down | Defaults (the browser read fails) | Defaults | Defaults (the route returns 503) |

Every row is now equal to or better than today, which is the business-unchanged bar. Q1 and Q5 answer **No** again, without a qualifier. The one change already stated under Q5 stands: a server `warn` instead of a browser `console.error`. The route adds a server log line on the correction path only.

#### Revised gate (replaces RC-10(e) and the §7.3 row)

**Local production build (this machine): functional gates, no absolute latency gate.** This machine is 250–300 ms from the database before any app work, so a latency number taken here measures the network, not the design. It is, however, a good place to prove that the slow path behaves.

| # | Gate | Pass |
|---|---|---|
| L-1 | Expired-cache loads do not wait (RC-15) | T-R10 green. In the running build, a load ≥ 61 s after the previous one is compared with a cache-hit load (≥ 5 pairs). Its document time is **not** higher by the read's `ms`. The `Custom tokens read` line appears **after** that response, not before it |
| L-2 | Cold, deadline-fired correction (RC-16) | Start `next start` fresh and load one owner page as the first request: `/business-os` signed in and `/onboarding-build` signed out. When the `Custom tokens read is slow` warn appears for that load, all four must hold: (1) the HTML has **no** `<style data-v2-custom-tokens>`; (2) the browser makes **exactly one** request to `/api/design-system/v2-custom-tokens` (200); (3) it makes **zero** requests to the Supabase host for `system_settings_config`; (4) afterwards, `getComputedStyle(document.documentElement).getPropertyValue('--v2-primary')` equals the warm-load value. If the deadline does not fire, restart and retry (it fired on the first read of a fresh process in IN-10 and IN-11). If it never fires in 5 restarts, record that, and T-P10 carries the gate |
| L-3 | No fetch when known | A warm load and a reset-to-defaults load (known `{}`) make zero requests to the route |
| L-4 | The deadline still bounds the cold page | Informational: in the L-2 runs, the cold page's document time stays under the hold's own time plus 1000 ms plus render. Record it |

**Vercel: the latency guard.** It is measured from the function logs (the `info` line `Custom tokens read` with `{ ms }`, and the `warn` lines). It is not run from this machine.

| # | Guard | Threshold | When |
|---|---|---|---|
| V-1 | Refresh read time (background, after RC-15) | p95 ≤ 500 ms over ≥ 20 lines. Above that, SA reviews the TTL and the query. **Not** a blocker for the user, because after RC-15 the read no longer delays any page | On the PR's Vercel preview, before merge. RM opens the PR after the user has approved the diff, so this respects "no commit before review". If the project builds no preview for PRs, it becomes a post-deploy check on production, owed by the user within a day of the merge |
| V-2 | Cold first read (deadline relevance) | Record ≥ 5 cold-start first reads (after the deploy, and after ≥ 15 min idle) and how many fired the deadline. **No threshold**, because RC-16 makes a fired deadline equal to today. If most of them fire, file a follow-up to revisit 1000 ms. Do not block on it | Same as V-1 |
| V-3 | Correction route health | Zero 5xx from `/api/design-system/v2-custom-tokens` other than the deliberate 503. The 503 count is no higher than the number of deadline warns with no completed read | Same as V-1 |

**T-12/T-13 sequencing:**
- L-1 to L-4 replace the §7.3 RC-10(e) row and are a **blocking** local gate.
- V-1 to V-3 are recorded in the workplan before merge, or as the named post-deploy check. They are **not** blocking.
- The other T-13 gates (§7.1, §7.2, §7.4) are unchanged. §7.4 ("custom tokens on the first frame") is measured on warm loads. A cold load where the deadline fired is judged by L-2 instead.

#### Sequencing and review

The Dev lands RC-15 and RC-16 as one change, with their tests and probes. Before SA looks again:
- the T-R, T-P, T-G and route suites are green;
- the new probes are caught;
- the branch is rebuilt.

Then SA does a **short code review of the delta only**: the reader diff, the route, the provider fetch, and G-12/G-13. There is no full re-review. QA re-runs T-R, T-P, T-G and the route test, and replaces checklist step 7 with L-1 to L-4. Nothing is committed until the user has seen the diff.

#### For the user (inform, no decision)

In plain terms: right after a release, or after a quiet spell, the first page an owner opens may show the standard colours for a moment before the brand colours appear. Every page does exactly that today; after this change, only that first page does. Every other page shows the brand colours from the first moment, and no page loads slower. No business decision is needed. The user could remove even that brief moment, but the cost is that the first page after a release waits up to about a second longer. SA does not recommend it, and it would be a new decision for BA, not part of this slice.

### SA delta review (RC-15/RC-16)

**Code review by SA, 2026-10-15 (delta only: reader, route, provider correction, layouts, T-R10/T-R11, T-P9/T-P10, G-1/G-4/G-9/G-12 amended, G-13).**
**Status:** ✅ **APPROVED for QA, with one condition (SA-D1).** No blocker.

SA re-ran the suites in the worktree: `lib/design-system-v2` + route test, 8 suites, 649 passed. `lib/__tests__/supabaseFetch.test.ts` also ran, with 1 failure (see SA-D4).

| # | Check | Result |
|---|---|---|
| 1 | SWR, and no await on the expired path | ✅ `readV2CustomTokens.ts:203-207`: `if (state.value)` returns `current()` after `void startFlight()`. This covers fresh, expired and back-off. A frozen `{}` is truthy, so a known reset also takes this path. Only the no-value path awaits. T-R10 and the amended T-R8 expired case resolve after a microtask flush, and the restore-the-await probe is caught (IN-12) |
| 2 | Single flight shared with the route's 5000 ms wait | ✅ The route calls `readV2CustomTokensWithStatus({ waitMs: 5000 })`, which joins `state.inFlight` through `startFlight()`. It does not start a second reader. Its own timer races the same `done` and is cleared afterwards. T-R11 "waits longer on the same flight" asserts one repository call |
| 3 | Known/unknown; a reset is known | ✅ `known = state.value !== null`. `refresh` stores the sanitized `{}` for no row, so a reset is known (T-R6 cold-reset case, route test "known reset → 200 {}"). A cold failure stays unknown through the back-off (T-R11) |
| 4 | Client fetch | ✅ It fires only when `customTokensKnown` is false, and the prop defaults to `true` (T-P9, G-13). There is one fetch, `no-store`, and the result goes through `sanitizeV2CustomTokens` again (T-P10 poisoned case). It is applied through the existing `applyTheme` via state. On unmount it aborts and checks `cancelled` before `setCorrectedTokens` and before each warn (T-P10 unmount case). Failures go through `clientLogger` only, with no `console.*` |
| 5 | Route | ✅ It is GET only and takes no input. It returns 503 plus `no-store` when unknown, and 200 plus `no-store` only when known. It is `force-dynamic` (G-9, G-13), uses Pino `child({ correlationId })` and writes no audit. The header documents why it is public, the output-as-Zod substitution, why the webhook-secret item does not apply, and the service-role bypass through the repository (rule 4). The error format and the dev-only `details` match `new-api-route`. The route test covers happy, reset, unknown and poisoned. There is no auth or invalid-input case, which is justified because the route is public and takes no input |
| 6 | No new browser DB read | ✅ No `supabaseClient` or `@supabase` in the provider, the route or the reader's client surface. The only matches are in the guards that assert their absence (G-8, T-P5 unchanged) |
| 7 | `doNotFake: ['Date']` | ✅ Correct, and needed. The outer `beforeEach` spies `Date.now` onto the test's own `now`. A plain `useFakeTimers()` replaces `Date` and silently drops that spy, so `now += TTL + 1` never expired anything. That made the old T-R8 "expired" case a fresh-cache case. With `Date` left alone, expiry is real, and the probe proves it (3 failures when the await is restored) |

**Comments**

1. **SA-D1 (Low, condition): a background SWR refresh logs a page-deadline warn that no page experienced.** `startFlight()` always arms `makeDeadline`, and the SWR call at `readV2CustomTokens.ts:205` arms it too. So a background refresh slower than 1000 ms logs `Custom tokens read is slow; this page uses the last good value or the defaults`, even though no page waited. That pollutes exactly the lines that L-1, V-2 and V-3 count. A QA reading L-1 would see a "slow" warn on a load that correctly did not wait. **Fix (small):** arm the deadline only when a caller waits on it. One way is to create it lazily in the no-value branch, still once per flight. Keep the one-warn-per-flight rule (T-R8). Add one T-R10 assertion: an expired-value refresh that never resolves, advanced past 1000 ms, logs **no** `deadlineMs` warn. Probe: arm eagerly again, and the assertion must fail. This must land before QA runs L-1. No further SA review is needed if the existing T-R suite and the new assertion are green.
2. **SA-D2 (Low, note only):** after a correction, `correctedTokens` takes priority over the server prop for the provider's lifetime. A later `router.refresh()` that brings fresh server tokens would not replace it. This has no practical effect, because the corrected value is the current value and tokens change a few times a year. No change.
3. **SA-D3 (Low, housekeeping):** `.env.local` is present in the worktree (7466 bytes, gitignored, so there is no commit risk), but IN-12 says it was "copied in and deleted". Delete it, or correct IN-12. It contains live keys.
4. **SA-D4: the `supabaseFetch.test.ts` failure is pre-existing and Windows-specific. It is not caused by TH-1 and does not depend on `NODE_ENV`.**
   - Neither the test file nor `lib/supabaseFetch.ts` differs from `origin/main`. The test imports only `@/lib/supabaseFetch`, and the TH-1 diff touches neither.
   - It fails identically with the shell's `NODE_ENV` unset, `development` or `production`.
   - Cause: the test switches environments with `Object.defineProperty(process.env, 'NODE_ENV', …)`. On Windows, Jest's `process.env` is a case-insensitive Proxy over a separate lookup. A `defineProperty` lands on the target but is not seen by the `get` trap, so `timeoutMs()` still reads Jest's `test` and returns 20000. On Linux CI `process.env` is a plain copy, and the test passes. Under real Node 22 the same call throws `ERR_INVALID_OBJECT_DEFINE_PROPERTY`; SA confirmed this with a scratch probe.
   - Not a TH-1 blocker. It is a separate small follow-up: the test should assign `process.env.NODE_ENV = …` directly. Owner: whoever owns `supabaseFetch` (commit `2c93d1b1`).

**Code Approved for QA:** Yes, on condition SA-D1 lands first, with its assertion and probe. SA-D2 needs no action. SA-D3 is housekeeping. SA-D4 is outside this slice.

---

## Implementation Notes

**Dev, 2026-10-15.** Base `936dfd04`. Nothing committed, nothing stashed.

### IN-1 What was built (T-2 to T-10)

| Task | Result |
|---|---|
| T-2 | `themeMode.ts` (`V2_THEME_STORAGE_KEY`), `v2-theme-tokens.css` (43 light values in `:root`, the 29 that differ in `:root.dark`) |
| T-3 | `customTokens.ts`: 31-key allow-list, per-group grammars, `sanitizeV2CustomTokens(Detailed)` (deep-frozen), `buildV2CustomTokenCss` (re-validates, emits trimmed values, `:root:root:root`). Pure, no imports |
| T-4 | `server/readV2CustomTokens.ts`: `server-only`, `getByKey` (service role, rule-4 reason in the header), TTL 60 s, single-flight, stale-on-error, 10 s back-off with or without a last good value, 1000 ms deadline with one `warn` per flight and the read finishing into the cache, `{ reason: 'read_failed' }` without `err` on an `{ error }` result |
| T-5 | `V2ThemeScript.tsx` (constant body, mirrors `if (savedMode)`), `V2CustomTokensStyle.tsx` |
| T-6 | Provider: no `return null`, no browser read, no `supabase` import, no `console.error`; `customTokens` prop; both effects through `useIsomorphicLayoutEffect`; `if (!mounted) return` kept; `<Suspense fallback={null}>` around children with the RC-5(c) comment; shared key. **See IN-2 for one design change found by T-P2** |
| T-7 | Header and `DarkModeToggle`: both icons, `dark:hidden` / `hidden dark:block`. The header no longer destructures `mode` |
| T-8 | Three gated layouts: `customTokensPending` started next to `initialLanguagePending`, before the hold, awaited after the unchanged `Promise.all` / `await initialLanguagePending`; script and style after `OwnerDirScript`; prop to the provider. `/v2` is a `force-dynamic` server layout. CRM layout: no provider, no `'use client'` |
| T-9 | Defects found locally: IN-2 (fixed). The runtime SSR smoke is the user's (IN-7) |
| T-10 | Stale "renders nothing on the server" comments updated in `OwnerDirScript.tsx`, `LanguageContext.tsx`, `LanguageContext.initialLanguage.render.test.tsx`, `ownerLanguageFirstFrame.guard.test.ts`. No assertion changed |

### IN-2 Defect found by T-P2, fixed: a synchronous context update during hydration would have client-rendered every owner page (for SA code review)

With the Q-2 `<Suspense>` boundary around the children, the provider's mount effect called `setMounted(true)` and `setMode(...)` **synchronously** in the hydration commit. That changes the context value while the boundary is still dehydrated, and React 18 then logs *"This Suspense boundary received an update before it finished hydrating … switched to client rendering"*: the server HTML of the whole page under the provider is thrown away and re-rendered on the client. That would have defeated TH-1 and broken RC-5(b).

**Fix (root cause, in the provider only):**
- The DOM write is moved into a component-local `applyTheme(mode)` (same body, same 4-space indentation, so `statusTokensMatchStylesheet.guard` still parses it). The mount layout effect reads the mode exactly as before and calls `applyTheme(initialMode)` **directly**. So `.dark`, the saved choice and every variable are on `<html>` before the first paint, on hydration and on a client-side entry alike (RC-1 is met more strongly than planned: no second commit is needed).
- The **state** (`setMode`, `setMounted`) follows inside `startTransition`, which lets React hydrate the boundary first. Nothing visible depends on that state any more (the icons follow `.dark`; only `DarkModeToggle`'s `aria-label` reads `mode`, R-8).
- The context value is `useMemo`'d on `[customTokens, mode]`, so `mounted` flipping does not re-render every consumer.
- `if (!mounted) return` stays on the mode effect (G-4), and the mode effect still calls `applyTheme(mode)` after `mounted`, so toggles work as before.

Pinned by T-P2 (zero real `console.error` during hydration) and two new probes: "synchronous setState instead of `startTransition`" and "mount effect no longer writes the DOM" both fail T-P.

### IN-3 Guard changed outside this slice's files: `paymentHold.test.ts` (for SA code review)

`lib/business-os/invites/__tests__/paymentHold.test.ts` pinned "only the language start may precede the gate". SA §2.7.4 / G-7 require the token read to start before the gate too, so the guard now allows **exactly** `initialLanguagePending = readInitialLanguage()` then `customTokensPending = readV2CustomTokens()`, in that order, and still requires the gate as the next statement. Neither start awaits anything. The `test-business-os` assertion is unchanged.

### IN-4 Test results (T-11)

| Check | Result |
|---|---|
| New suites: T-C `customTokens.test.ts` | 110 / 110 |
| T-R `readV2CustomTokens.test.ts` (incl. T-R5b, T-R8) | 23 / 23 |
| T-S `V2ThemeScript.test.tsx` | 23 / 23 |
| T-P `V2ThemeProvider.ssr.test.tsx` (T-P1..T-P8) | 9 / 9 |
| T-T `themeStylesheetMatchesProvider.guard.test.tsx` (T-T1, T-T2, computed specificity) | 21 / 21 |
| T-H `BusinessOSHeader.themeIcon.render.test.tsx` | 4 / 4 |
| T-G `themePrepaint.guard.test.ts` (G-1..G-12, G-8 narrowed per RC-11) | 30 / 30 |
| Affected suites: `lib/design-system-v2`, `lib/business-os/__tests__` (BR-1a guards incl. `ownerLanguageFirstFrame`, `readInitialLanguage`, `LanguageContext.initialLanguage`), `components/business-os/__tests__`, `components/ui/__tests__`, `lib/business-os/invites/__tests__` (paymentHold), `readPlanBadge`, `enforcementPoints`, `app/invite/__tests__` | 101 suites, 2360 tests, all green after IN-3 |
| `statusTokensMatchStylesheet.guard` | green, unchanged |
| `npm run test:bos-entitlements` | 268 suites, 7990 tests, green |
| `npm run lint:hooks` | exit 0 |
| `eslint` on every touched file | 0 errors, 0 warnings |
| Scoped `tsc` (a temporary tsconfig over the 25 touched and new files, deleted afterwards; the full-project `tsc --noEmit` runs out of memory on this machine at 4 GB) | **0 errors in touched files.** 23 errors in transitively loaded files this slice does not touch (`translations/en.ts`/`es.ts` duplicate keys, `<style jsx>` typings, two others); all pre-existing on `936dfd04` |

Jest-only artefact, documented in T-P and T-H: under jsdom `window` exists, so server-rendering in a test picks `useLayoutEffect` and React warns it "does nothing on the server". On a real server the alias is `useEffect`. The tests filter exactly that message and fail on any other `console.error`.

### IN-5 Mutation probes (§10.9 plus new ones), each restored byte-for-byte

All **28** probes made their target suite fail. The working tree was diffed after the run: unchanged.

| # | Probe | Caught by |
|---|---|---|
| 1 | Restore `if (!mounted) return null` | T-G, T-P |
| 2 | Remove `if (!mounted) return` from the mode effect | T-S2, T-P |
| 3 | Alias swapped back to `useEffect` (RC-1) | T-G G-4, T-P8 |
| 4 | Mount effect: synchronous `setState` instead of `startTransition` (IN-2) | T-P2 |
| 5 | Mount effect no longer writes the DOM (IN-2 / RC-1) | T-P8 |
| 6 | One hex changed in the default sheet | T-T |
| 7 | `--v2-text-tertiary` added to the default sheet | T-T |
| 8 | A value in the provider's `darkModeColors` only | T-T |
| 9 | Custom selector `:root:root:root` → `:root` | T-T2 (dark), T-C |
| 10 | `colors.textMuted` dropped from the allow-list | T-T2, T-C |
| 11 | Builder iterates the input's keys | T-C |
| 12 | Builder emits the raw, untrimmed value (RC-13(a)) | T-C |
| 13 | Colour grammar loosened to `[^;]+` | T-C |
| 14 | Shallow freeze only (RC-13(b)) | T-C |
| 15 | Reader without `try/catch` | T-R1 |
| 16 | Reader caches failures for the full TTL | T-R5 |
| 17 | Back-off only when a last good value exists (RC-10(d)) | T-R5b |
| 18 | Deadline removed (RC-10(d)) | T-R8 |
| 19 | Single-flight dropped | T-R4 |
| 20 | `err` logged on an `{ error }` result (double log, R2-Q9) | T-R2 |
| 21 | Business OS layout: token read moved after the hold | T-G G-7 |
| 22 | `V2ThemeScript` added to `app/layout.tsx` | T-G G-1, G-3 |
| 23 | `<V2ThemeScript />` moved inside the provider | T-G G-2 |
| 24 | Script uses the SA sketch for unknown values | T-S |
| 25 | Header icon back to `mode === 'dark' ? …` | T-H |
| 26 | Sheet import dropped from `/v2` | T-G G-1 |
| 27 | `force-dynamic` removed from `/v2` | T-G G-9 |
| 28 | Browser `supabaseClient` import re-added to the provider | T-G G-8, T-P5 |

### IN-6 Production build (branch)

`next build` in the worktree with `.env.local` copied in and **deleted right after** (verified absent). **Exit 0.** No `useSearchParams` / missing-Suspense error: `/v2/settings` builds (it is dynamic now). Every touched route is `ƒ` (dynamic), at base and on the branch.

A base build of `936dfd04` was made the same way in a scratch `git archive` export (session scratchpad, `node_modules` junction, `.env.local` copied in and deleted; exit 0), for comparison and for the user's base-vs-branch runs.

| Route | Base size / First Load | Branch size / First Load |
|---|---|---|
| `/business-os` | 75.2 kB / 476 kB | 75.3 kB / 476 kB |
| `/business-os/crm` | 83.8 kB / 519 kB | 83.8 kB / 519 kB |
| `/business-os/email-automation` | 831 B / 97.8 kB | 829 B / 97.8 kB |
| `/business-os/orders` | 15.1 kB / 397 kB | 15.1 kB / 397 kB |
| `/business-os/reports` | 13.3 kB / 348 kB | 13.3 kB / 348 kB |
| `/business-os/settings` | 28.3 kB / 404 kB | 28.1 kB / 404 kB |
| `/business-os/website` | 112 kB / 536 kB | 112 kB / 536 kB |
| `/onboarding-build` | 32.4 kB / 453 kB | 32.4 kB / 453 kB |
| `/onboarding-chat` | 19.6 kB / 407 kB | 19.4 kB / 407 kB |
| `/v2/agents` | 5.05 kB / 180 kB | 4.83 kB / 180 kB |
| `/v2/agents/[id]` | 39.4 kB / 445 kB | 39.6 kB / 445 kB |
| `/v2/agents/new` | 23.9 kB / 263 kB | 23.7 kB / 263 kB |
| `/v2/notifications` | 6.03 kB / 175 kB | 6.02 kB / 175 kB |
| Other `/v2/*` (agent-list, run, analytics, billing, dashboard, monitoring, sandbox, settings) | identical | identical |
| Shared by all | 88.7 kB | 88.7 kB |

First Load JS is flat on every touched route (±0.2 kB).

**Surprise, corrects §1, §2.9, §6.1/§6.2 and R-2/R-19:** at base, **every `/v2/*` route is already `ƒ` (dynamic)**, not static. Something above `/v2` (the root layout or the platform shell reading the session) already opts the segment out of prerendering. So the predicted `/v2/settings` build break could never have happened, `/v2` does not change rendering mode in this slice, and option B's "bake the tokens in at build" risk was latent rather than live. The explicit `force-dynamic` on `/v2` and guard G-9 are kept anyway: they make the guarantee local instead of depending on a distant ancestor. The `/v2/dashboard` response-time comparison in §7.3 is therefore like-for-like (dynamic vs dynamic).

### IN-7 Owed by the user, in the browser (Dev does not sign in)

T-0 baseline (a)(b)(c)(d)(f)(h), T-1's runtime half (route walk, RC-5(a) throwing-child proof), T-12 smoke (§6.3) including RC-4 status parity and **RC-12 (names only)**, T-13 measurements (§7.1–§7.4), the §7.3 20-pair server guard and **RC-10(e) cold-miss read time (p95 ≤ 500 ms or stop)**. The exact steps and snippets are in the Dev handover to the main session.

### IN-9 Review fixes (SA CR-1, CR-2, CR-4; QA-1), 2026-10-15

| Item | Change | Evidence |
|---|---|---|
| **QA-1** | `customTokens.test.ts`: reject rows per group for `red;`, `#fff;`, `rgb(1;2;3)`, `red;color:blue`, `red:blue`, `24px;`, `24px:`, `0 0 1px red;x`, `none;` and others; a table test that puts every forbidden character (`; : { } < > \ " ' @ * !`) before, after, and as `+'color:blue'` around 10 valid samples across all groups, asserting `validTokenValue` is `null` and the builder emits `''`. **SA optional item taken:** the grammars use `[ \t]` instead of `\s`, with reject rows for newline, U+2028, NBSP and U+FEFF | T-C 495/495. QA probes b1–b4 now **fail** (1, 3, 2 and 9 tests respectively); extra probe b5 (`\s` restored) fails 4 |
| **CR-1** | `readV2CustomTokens.ts`: a completed read logs **`info`** `{ ms, keys }` (`Custom tokens read`); both failure `warn`s carry `ms`; no `debug` left. §2.7.5 and §7.3 name the `info` line | New **T-R9**: a cold read logs exactly one `info` `{ ms: 37, keys: 1 }` and no logged object contains a synthetic value; a cache hit logs nothing. T-R2 checks `ms` on both warns. T-R 25/25. Probes "back to `debug`" and "log the tokens" both fail |
| **CR-2** | `V2ThemeProvider.ssr.test.tsx`: **T-P2b** server-renders `ToggleProbe` (renders `mode`) under the provider, stored `dark`, `.dark` pre-set, `hydrateRoot`, flush | Server HTML `light`; settled text `dark`; the server `<button>` node is the same node after hydration (not client-rendered); zero real `console.error`; no `dark` flip. T-P 10/10. **Probe 4 (synchronous setState) fails T-P2b** |
| **CR-4** | §1 (two places), §2.9 (banner + option A + route-table bullet), §6.1, §6.2, §7.3 `/v2/dashboard` row, R-2, R-19 and the revision-1 surprises marked superseded by IN-6 | Doc only |

### IN-10 CR-3: RC-5(a) production proof (curl, signed out)

Run in a **separate** scratch copy of the worktree (all tracked and untracked files, `node_modules` junction), never in the worktree. A `'use client'` `Th1ServerBomb` that throws `new Error('TH1-RC5a')` only when `typeof window === 'undefined'` was rendered as the first child of `app/onboarding-build/page.tsx`. `next build` exit 0, `next start -p 3917`, `curl` with no cookies.

| Check | Request 1 (cold process) | Request 2 (warm token cache) |
|---|---|---|
| (a) status 200 | **yes** | **yes** |
| (b) HTML has the theme script | **yes** | **yes** |
| (b) HTML has `<style data-v2-custom-tokens` | **no**: the 1000 ms deadline fired on the cold read (1718 ms), so the page got the defaults, by design | **yes** |
| (c) `<!--$!-->` present, no error-page markup | **yes** (one `<!--$!-->` with `data-dgst`; no `error.tsx`/global-error/not-found markup) | **yes** |
| (d) error logged exactly once with a digest | **yes** (one `Error: TH1-RC5a`, one `digest`) | **yes** (one more of each, i.e. once per request) |

**Verdict: the boundary is a real net in production.** A generic server throw under the provider gives 200, the shell above the boundary (scripts, style), the client-render marker, and exactly one logged error with a digest per request. The style missing on request 1 is RC-10's deadline doing its job, not the boundary; request 2 proves the shell carries it. Bonus, **RC-12 (names only) on a signed-out page:** the inlined rule declared exactly `--v2-primary` and `--v2-secondary`, so both live values survive sanitizing.

Cleanup: server stopped (taskkill), `.env.local` deleted, the junction removed with `cmd /c rmdir` **first** (shared `node_modules` verified intact), then the copy deleted.

### IN-11 Early RC-10(e) signal: cold-miss read time from this machine is above 500 ms (for SA)

From the CR-3 server's new `info` lines, signed out, local production build against the production database: **1718** (first read of a fresh process; deadline fired), **846, 758, 632, 1020** (deadline fired)**, 470** ms on TTL-expiry reads in a warm process. Six samples, median ≈ 800 ms; the §7.3 gate (p95 ≤ 500 ms) would **fail** on this machine.

Where the time goes, measured from the same machine (durations only, no data printed): plain HTTPS round trip to the Supabase host 71–112 ms; the reader's exact query through `supabase-js` alone, outside Next: **1019** ms cold, then **248–299** ms warm, including after 65 s idle. So about 250–300 ms is the database round trip from this location, and the rest of the in-app time is in-process (connection reuse through `supabaseFetch`, and the request's own server-render work on the same event loop while the read is in flight).

This is a **local-network** measurement. A Vercel function next to the database will see a much smaller round trip. But as defined, the gate is measured on a local production build, and there it will not pass. **Stop condition reached, for SA:** choose between (a) taking RC-10(e) on a Vercel preview deployment, (b) re-baselining the gate for local runs (for example "p95 ≤ 500 ms above the raw query round trip"), or (c) revisiting the 1000 ms deadline. On this machine the deadline fires on a minority of misses, and each one costs only that page load's custom colours (it shows the defaults, as today's failed browser read does).

### IN-12 SA ruling IN-11 applied: RC-15 (stale-while-revalidate) and RC-16 (client correction), 2026-10-15

| Item | Change |
|---|---|
| RC-15 | `readV2CustomTokensWithStatus`: a last good value is returned at once (fresh, expired or in back-off); an expired value starts or joins the single flight with `void startFlight()`; only a no-value call waits, raced against the 1000 ms per-flight deadline (or the caller's `waitMs` on the same flight). Header, TTL and deadline comments updated; no `waitUntil`/`after` |
| RC-16 reader | `known = state.value !== null` (a reset with no row is known). `readV2CustomTokens()` keeps its name, so G-7 and the `paymentHold` pinned text are **unchanged**, and now returns `{ tokens, known }`. New `V2_CUSTOM_TOKENS_ROUTE_WAIT_MS = 5000` |
| RC-16 layouts | All four destructure `{ tokens: customTokens, known: customTokensKnown }` and pass `customTokensKnown` to the provider |
| RC-16 provider | `customTokensKnown` prop (default `true`); one `no-store` fetch of `V2_CUSTOM_TOKENS_CORRECTION_PATH` only when it is `false`; re-sanitized; applied through the mode effect (`applyTheme`); failures silent (`clientLogger.child({ module: 'V2ThemeProvider' })` `warn`); abort + `cancelled` on unmount |
| RC-16 route | `app/api/design-system/v2-custom-tokens/route.ts`: public GET, no input, output through `sanitizeV2CustomTokens`, shared single flight with a 5000 ms wait, 200 only when known, else 503, `Cache-Control: no-store`, `force-dynamic`, Pino + `correlationId`, no audit; the header documents why it is public and the service-role bypass via the repository |
| Tests | T-R10, T-R11, T-R8 expired case "at once", T-R6 adjusted for SWR (the refresh lands, the next call gets the known `{}`); fake-timer blocks keep `Date` on the test clock (`doNotFake: ['Date']`), which also makes T-R8's expired case really expire; T-P9, T-P10 (6 cases); route test (4); G-1/G-4/G-9/G-12 amended, G-13 new |

**Probes (each restored; working tree identical afterwards):** all 8 new probes fail their target:

| Probe | Result |
|---|---|
| Await the refresh on the expired path (RC-15) | caught by T-R10/T-R8 (3 failures) |
| `known` always `true` | caught by T-R11 + route test (4) |
| Fetch unconditionally | caught by T-P9 + G-4/G-13 (4) |
| Prop defaults to `false` | caught by T-P9 + G-13 (2) |
| Drop the client sanitize | caught by T-P10 poisoned case (1) |
| No `cancelled` check after unmount | caught by T-P10 unmount case (1) |
| Route returns `{}` with 200 when unknown | caught by the route test (1) |
| Route drops `no-store` | caught by the route test (2) |

**Every earlier probe re-run against this code:** the 28 implementation probes (IN-5) and the 8 review probes (IN-9: b1–b5, probe 4 on T-P2b, the two CR-1 probes) all still fail their targets. Seven anchors were updated for the new text (the reader's `ms` fields, `inBackoff`, the provider's new prop); the probes' intent is unchanged. 44/44 caught; working tree identical after each run.

Checks: affected suites green (121 suites incl. the route test and the `lib/admin`, `lib/__tests__`, `scripts/__tests__` guards; the one failure, `lib/__tests__/supabaseFetch.test.ts` "more generous in development", is in a file this slice does not touch and depends on the environment), `test:bos-entitlements` 268/7990, `lint:hooks` exit 0, eslint clean, scoped tsc 0 errors in touched and new files. Branch `next build` exit 0 (`.env.local` copied in and deleted at that build; **SA-D3 correction:** from the SA-D1 rebuild on, `.env.local` is the main session's copy for its browser checks and is deliberately **left in the worktree**; the main session deletes it at cleanup): `/api/design-system/v2-custom-tokens` is `ƒ`; `/business-os` 75.3 kB / 476 kB, `/onboarding-chat` 19.4 / 408 (+1 kB First Load: the provider now carries the sanitizer and the client logger), the rest unchanged.

Gates: the revised local gates L-1 to L-4 and the Vercel guards V-1 to V-3 (SA ruling) replace the §7.3 RC-10(e) row. They are owed by the user (L) and on the preview or post-deploy (V).

### IN-13 SA delta review: SA-D1 applied, 2026-10-15

- **SA-D1 (Low):** `startFlight()` no longer arms the 1000 ms page deadline. A waiting caller (no last good value) arms it through `deadlineOf(flight)`, still at most once per flight. A background stale-while-revalidate refresh has nobody waiting and now logs no "this page uses the last good value or the defaults" warn and leaves no timer.
- **T-R10** now asserts that a background refresh slower than three page deadlines logs no deadline warn and leaves zero timers.
- **Probes** (restored; tree identical after): eager arming restored in `startFlight` → T-R10 fails (1); page deadline removed → fails (2); RC-15 await on the expired path → fails (3).
- **Checks:** `lib/design-system-v2` + the route test + the header-icon suite: 9 suites, 646 tests, green. `lint:hooks` exit 0, eslint clean.
- **Build:** `next build` in the worktree exit 0, `.env.local` left in place; route sizes unchanged from IN-12.
- **SA-D3:** `.env.local` is left in the worktree for the main session's browser checks (IN-12 corrected).

### IN-8 Logging (CLAUDE.md § Logging)

- Changed files: the only `console.*` was in `theme-provider.tsx` (1), deleted with the browser read. All other changed files had 0; new files have 0.
- Read only, flagged, not converted (RC-14, the main session is handling it with the user): `app/api/admin/ui-config/route.ts` (8), `app/admin/ui-config/page.tsx` (4), `lib/hooks/useUIVersion.ts` (3, not edited, TH-2b inventory).

---

## QA Testing Report

**QA — 2026-10-15**
**Test mode:** full (Jest re-run + mutation probes + acceptance-criteria mapping); browser half handed to the main session as a checklist
**Strategy used:** A (Jest unit/guard suites, re-run from the worktree) + targeted mutation probes; D (manual browser check) written as a checklist below, because QA does not sign in
**Focus:** ui, schema, security, performance
**Skipped:** the browser runs (owed by the main session, checklist below); `next build` was not re-run by QA (Dev IN-6 exit 0 accepted; CR-1 will force a rebuild anyway)
**Input source:** prompt keywords (main session brief) + workplan §6.3 / §7 / §10

### Re-run of the Dev's numbers (worktree, `npx jest`)

| Set | QA result | Dev (IN-4) | Match |
|---|---|---|---|
| 7 new suites (T-C, T-R, T-S, T-P, T-T, T-H, T-G) | 7 suites, **220** tests, all pass | 110 + 23 + 23 + 9 + 21 + 4 + 30 = 220 | ✅ |
| `lib/design-system-v2` + `lib/business-os/__tests__` (BR-1a guards) + `paymentHold` + `components/business-os` | 82 suites, 1563 tests, all pass | — | ✅ |
| The Dev's full affected set (adds `components/ui/__tests__`, `readPlanBadge`, `enforcementPoints`, `app/invite/__tests__`, all `invites/__tests__`) | **101 suites, 2360 tests**, all pass | 101 / 2360 | ✅ |
| `paymentHold` suites alone (`paymentHold`, `.adminGrant`, `Batch`) | 3 suites, 66 tests, all pass | — | ✅ |
| `npm run test:bos-entitlements` | **268 suites, 7990 tests**, green | 268 / 7990 | ✅ |

The diff adds and removes no import from `lib/business-os/entitlements/` (the only hit is the unchanged `readPlanBadge` line in `app/business-os/layout.tsx`).

### Mutation probes (QA-run, each restored; SHA-256 of all 27 changed/new files matched the pre-probe snapshot afterwards, except this workplan, which SA was editing in parallel)

| Probe | Variant | Result | Caught by |
|---|---|---|---|
| (a) remove `if (!mounted) return` from the mode effect | — | ✅ caught, 7 failures | T-S2 ×4 (stored `dark`/OS light, `dark`/OS dark, none/OS dark, `""`/OS dark), T-P2, T-P8, G-4 — behavioural, not only the text guard |
| (b) colour grammar accepts `;` | b1: functional colour class `[0-9.,%\s/;]` | ❌ **survives** (154/154 pass) | — |
| | b2: named colour `^[a-z;]{3,30}$` | ❌ **survives** | — |
| | b3: hex with optional trailing `;` | ❌ **survives** | — |
| | b4: named colour `^[a-z;:]{3,30}$` (lets `red;color:blue` through and the builder emits it as a second declaration) | ❌ **survives** | — |
| (c) remove the 1000 ms deadline | c1: `await done` instead of the race | ✅ caught | T-R8 (one test) |
| | c2: deadline constant 1000 → 20000 | ✅ caught | `constants` test |
| (d) move `V2ThemeScript` into `app/layout.tsx` | d1: add to root, remove from the Business OS layout | ✅ caught | G-1, G-2 (business-os), G-3 |
| | d2: add to root, remove from all four segment layouts | ✅ caught | G-1, G-2 ×4, G-3 |

The Dev's own probe 13 (`[^;]+`) is caught because its payloads also carry `}`, `<` or `#`. No test pins **`;` or `:` alone**, so a narrow loosening passes the whole suite (QA-1).

### Test Coverage

| Acceptance criterion | Tested? | Result | Evidence / level |
|---|---|---|---|
| Owner chrome in the server HTML (§7.1 deterministic gate: `hasToggleInMarkup:true`, 4 BOS routes + onboarding equivalent) | ⚠️ | Logic-level pass | T-P1 (children render on the server), G-4, probe (a)/Dev probe 1. **Needs browser:** checklist step 1 |
| Blank time median ≈ 0 (§7.1) | ⚠️ | Not measured | **Needs browser:** step 3 |
| No wrong-theme frame, C-1..C-5 (§7.2) | ⚠️ | Logic-level pass | T-S1 (10 stored × OS cases), T-S2 parity with provider, T-S3, T-P2, T-H icons, probe (a). **Needs browser:** step 4 |
| RC-1 client-side entry (C-2/C-4) | ⚠️ | Logic-level pass | T-P8 + Dev probes 3 and 5. Browser optional (step 9) |
| Custom tokens on the first frame, no swap (§7.4 C-6) | ⚠️ | Logic-level pass | T-T2 cascade C = P in both modes and both passes, T-P7 (never defaults first), Dev probe 9. **Needs browser:** step 3 |
| RC-12: live values survive sanitizing (`{--v2-primary, --v2-secondary}`) | ❌ | Not tested | Browser only, step 1. The only check that catches a dropped live value |
| Default sheet = provider defaults, settled UI unchanged (Q1) | ✅ | Pass | T-T1 (21 tests), Dev probes 6–8 |
| CSS injection blocked (R-15) | ⚠️ | Pass with a test gap | T-C4 payloads pass on the current code; **QA-1**: `;`/`:` loosening is not caught |
| Reader: never throws, cache, single-flight, stale-on-error, back-off, 1000 ms deadline | ✅ | Pass | T-R (23), QA probes c1/c2, Dev probes 15–20 |
| Token read overlaps the payment hold (no serial round trip) | ✅ | Pass (logic) | G-7, `paymentHold.test.ts` (IN-3), `ownerLanguageFirstFrame` G-2 unchanged and green. Response-time gate needs browser: step 8 |
| RC-10(e) cold-miss read p95 ≤ 500 ms | ❌ | Blocked | No data source in a production build (SA CR-1, independently confirmed: `lib/logger.ts:26` pins production to `info`). Step 7 |
| Segment-only placement; public pages get no `.dark`, sheet or token style | ✅ / ⚠️ | Pass (logic) | G-1, G-2, G-3, QA probes d1/d2, Dev probe 22. **Needs browser:** step 5 |
| No browser DB read / no `supabaseClient` in the provider | ✅ | Pass | G-8, T-P5, Dev probe 28 |
| `mounted` guard kept | ✅ | Pass | QA probe (a) |
| 21-route SSR smoke: 0 hydration / client-render messages, 0 server render errors, status parity (RC-4/RC-5(b)) | ❌ | Not tested | **Needs browser:** step 2. `/v2/billing` 307 → 200 is expected (SA note) |
| RC-5(a) boundary is a real net in production | ⚠️ | Logic-level | T-P4 only; SA CR-3 (Dev curl proof) is owed |
| `/admin/ui-config` still loads | ❌ | Not tested | Step 6, read-only |
| No `console.*` in touched files | ✅ | Pass | G-5; grep in SA review item 9 |
| BR-1a guards and entitlements registration unchanged | ✅ | Pass | 101/2360 and 268/7990 above |

### Issues Found

#### Bugs (must fix before commit)

1. **QA-1: the sanitizer's "no `;`" guarantee is not pinned by any test** — File: `lib/design-system-v2/__tests__/customTokens.test.ts` (test gap; `customTokens.ts` itself is correct today) — Severity: **Medium** (the grammar is the declared security boundary for a raw `<style>` on every owner page; SA's review relies on "no grammar admits `;`")
   - Steps to reproduce: change `NAMED_COLOR` in `customTokens.ts` to `/^[a-z;:]{3,30}$/i` and run `npx jest lib/design-system-v2`. The same happens with `;` added to the functional-colour class, to the named-colour class, or as an optional trailing `;` on the hex pattern.
   - Expected: at least T-C2 or T-C4 fails. With b4, `colors.primary = 'red;color:blue'` is emitted by `buildV2CustomTokenCss` as `--v2-primary:red;color:blue`, which is an injected declaration.
   - Actual: 154/154 pass for all four variants. Every existing `;` payload also carries `}`, `(`, `#` or a digit that another rule rejects.
   - Suggested fix (Dev): add reject rows to T-C2 for every group: `red;`, `#fff;`, `rgb(1;2;3)`, `red;color:blue`, `red:blue`, `0 0 1px red;x`, `24px:`. Better, add a table test: for each group, each valid sample `v`, and each forbidden character `c` in `; : { } < > \ " ' @ * !`, assert `validTokenValue(group, v + c)`, `validTokenValue(group, c + v)` and `validTokenValue(group, v + c + 'color:blue')` are all `null`, and that the builder output for them is `''`. Re-run probes b1–b4; each must fail.
2. **SA CR-1 confirmed by QA** — `lib/design-system-v2/server/readV2CustomTokens.ts` logs the read `ms` only at `debug`, and `lib/logger.ts:26` forces `info` under `next start` with no override. The RC-10(e) gate has no data source until CR-1 lands. Already Medium in SA's review. Listed here so the checklist's step 7 is read with it.

#### Performance Issues (should fix)

None found at the logic level. The document-response gate (§7.3) and RC-10(e) are unmeasured (steps 7 and 8).

#### Edge Cases (nice to fix)

1. **The production React build never prints "switched to client rendering" or "Hydration failed".** Those are development strings. In `next start` they arrive as minified errors: `#418`/`#425` (mismatch), `#419` (server error inside a boundary, the RC-5 net firing), `#421` (update before hydration, the IN-2 class), `#422`, `#423`. A smoke that searches only for the English text passes falsely. The checklist below searches for all six.
2. **The deadline-removal probe is caught by a single test (T-R8).** That is adequate, but if T-R8 is ever relaxed, nothing else pins the bound. No action unless T-R8 changes.
3. **OS colour-scheme emulation in a hidden pane.** If DevTools emulation is unavailable, step 4 overrides `matchMedia` on the iframe's window at navigation commit. A run counts only when `installedBeforeBody` is true, which proves the override was in place before the inline script ran.

### Manual checklist for the main session (production builds: base `936dfd04` on port A, branch on port B)

**Rules.** Record only statuses, booleans, times and custom-property **names**. Never print a token value, a computed colour or a cookie. Never copy cookies into curl. Never save or reset on `/admin/ui-config`. Rebuild the branch after CR-1 lands, otherwise step 7 has no data. Cookies on `localhost` are shared across ports. If one port shows signed-out, sign in through its UI.

**Setup.** Open a tab on each origin and paste the helper (`__qa`, below) into each. Re-paste after any navigation of that tab. `R7` = `['/business-os','/business-os/crm','/business-os/email-automation','/business-os/orders','/business-os/reports','/business-os/settings','/business-os/website']`. `R4` = the first four of the §7.1 routes: `/business-os`, `/business-os/settings`, `/business-os/crm`, `/business-os/email-automation`.

Priority: **P0** steps can fail on this diff and gate T-12. **P1** steps corroborate. **P2** steps are optional.

| # | P | Check | How | Pass |
|---|---|---|---|---|
| 1 | P0 | **(a) Markup + RC-12** | On both origins: `const o=[]; for (const p of [...R7,'/onboarding-chat','/onboarding-build']) o.push(await __qa.html(p)); o` | Branch: same `status` as base on every route; `bosToggleInMarkup:true` on all 7 BOS routes (base `false`); onboarding `buttons` and `bytes` higher than base; `themeScript:true`; `customStyleCount:1` on every route **including `/business-os/crm`**; `customTokenNames` exactly `["--v2-primary","--v2-secondary"]`; `htmlTagHasDark:false`. Base: `themeScript:false`, `customStyleCount:0`. **A different names set = RC-12 fail: stop** |
| 2 | P0 | **(d) 21-route smoke** | Status on both origins: `__qa.html(p)` for the 21 §6.3 routes (take one agent id of the test owner from the `/v2/agent-list` UI for routes 14–16). Console on the branch: `await __qa.frame(p,{mode:'light'})`, then the same with `{mode:'dark'}`. Run base `{mode:'light'}` once per route as the pre-existing baseline. Server log: read the branch `next start` log with the preview log tool after the run | Status parity on all 21, except `/v2/billing`: base `redirect`, branch `200` is accepted **only if** `frame('/v2/billing').finalPath` is `/settings?tab=billing`. Branch `errors` contain nothing matching `/#41[89]\|#42[1-5]\|hydrat\|switched to client\|did not match/i` that the base run of the same route does not also show. Server log: no `Error`, no `digest`, no `V2CustomTokensRead` warn. Any hit fails T-12 (RC-5(b)), even if the page looks fine |
| 3 | P1 | **(b) Blank time + custom first frame** | For each of `R4`, on both origins: one discarded warm-up, then 5 × `await __qa.frame(p,{mode:'light'})`. Keep `blankMs`, `darkAtMarker`, `customFirstFrame`, `primaryChangesAfterMarker` | Branch: median `blankMs` ≤ 10; `customFirstFrame:true` and `primaryChangesAfterMarker:0` in **every** run. Base (expected): `blankMs` > 0 and at least one primary change. `tMarker` missing = the marker never appeared: investigate |
| 4 | P1 | **(c) Themes** on `/business-os`, branch | C-1 `{mode:'light',osDark:false}`, C-2 `{mode:'dark',osDark:false}`, C-3 `{mode:'light',osDark:true}` (OS dark, app light), C-4 `{mode:null,osDark:true}`, C-5 `{mode:null,osDark:false}`. 2 runs each | Count a run only if `installedBeforeBody:true`. `darkAtMarker` = `darkSettled` = expected (dark for C-2 and C-4 only); `darkFlipsAfterMarker:0`; `bgMatchesSettled:true`; `iconShown` `["sun"]` when dark, `["moon"]` when light. **Fallback** if `installedBeforeBody` is never true: run C-1/C-2 only (stored value, real OS) and mark C-3..C-5 "logic-level only (T-S1/T-S2)" |
| 5 | P1 | **(e) Public pages after a dark owner visit** | `await __qa.frame('/business-os',{mode:'dark'})`, then `await __qa.html('/privacy')`, `await __qa.frame('/privacy')`, and the same two for the test owner's `/book/<slug>` page. Finish with `__qa.setMode('light')` | Public HTML: `themeScript:false`, `customStyleCount:0`, `htmlTagHasDark:false`. Public frame: `darkSettled:false`, `v2PrimaryDefined:false` (no `--v2-*` sheet), `customStyleInDom:0` |
| 6 | P1 | **(f) `/admin/ui-config`** | Navigate a tab to it on the branch. **Read only: never click Save or Reset** | The page loads and shows the current token editor with no console error. If the test owner is not an admin, record "not admin, skipped": the page does not use the provider or the removed read (§2.10) |
| 7 | P0 | **(g) RC-10(e) cold-miss read time** | Needs the CR-1 build. Every cache miss logs one completed-read line with `ms`. Collect ≥ 20: each branch restart + 1 page load is one sample, and any owner load ≥ 61 s after the previous one is another (TTL expiry). Steps 1–6 already produce several. Read the values with the preview log tool | p95 (the 19th of 20 sorted) ≤ 500 ms, **and zero** "Custom tokens read is slow" warns. Above 500 ms: stop and go to SA. **If CR-1 has not landed:** record "no data", do not pass T-13. A `next dev` run of the branch on a third port (debug is on in dev) can be offered to SA as a substitute; it is not the production path |
| 8 | P0 | **Server-response guard** `/business-os` | Warm-up: `await __qa.doc(3)` on each origin, discarded. Then batches of 5 in the order A B B A A B B A (A = base tab, B = branch tab): `await __qa.doc(5)`. Wait ≥ 61 s of branch idleness before each B batch, so its first request is a cache miss | All `status:200`, `redirected:false`. `median(B[20]) ≤ median(A[20]) + max(0.10·median(A), 30 ms)`. Report the 4 first-of-batch B samples (cache miss) separately, not gated |
| 9 | P2 | Hebrew and Spanish; client-side entry; bfcache | Switch the language in the header, then rerun step 2's branch `frame` over `R7` in light. Client entry (RC-1) is logic-level (T-P8); a browser run is optional | Same pass rule as step 2 |

**Helper** (paste into a tab on each origin):

```js
window.__qa = (() => {
  const SEL = '[aria-label="Toggle dark mode"]';
  const KEY = 'v2-theme-mode';
  const setMode = (m) => (m == null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, m));
  const median = (a) => { const s = [...a].sort((x, y) => x - y), k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

  // Raw server HTML. Returns custom-property NAMES only, never values.
  async function html(path) {
    const r = await fetch(location.origin + path, { cache: 'no-store', redirect: 'manual' });
    if (r.type === 'opaqueredirect') return { path, status: 'redirect' };
    const h = await r.text();
    const styles = h.match(/<style data-v2-custom-tokens[^>]*>[^<]*<\/style>/g) || [];
    return {
      path, status: r.status, bytes: h.length,
      bosToggleInMarkup: h.includes('aria-label="Toggle dark mode"'),
      v2ToggleInMarkup: h.includes('aria-label="Switch to'),
      buttons: (h.match(/<button/g) || []).length,
      themeScript: h.includes('localStorage.getItem("v2-theme-mode")'),
      customStyleCount: styles.length,
      customTokenNames: [...new Set(styles.join('').match(/--v2-[a-z0-9-]+(?=:)/g) || [])].sort(),
      htmlTagHasDark: /<html[^>]*\bclass="[^"]*\bdark\b/.test(h),
    };
  }

  // Same-origin iframe sampler. Observers are installed on the iframe's own
  // document at navigation commit (a MessageChannel poll, not rAF or timers),
  // so it works in a hidden pane. Records booleans and times only.
  function frame(path, { mode, osDark, settleMs = 2500 } = {}) {
    if (mode !== undefined) setMode(mode);
    return new Promise((resolve) => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:800px;opacity:0;pointer-events:none;border:0;z-index:-1';
      const res = { path, mode: mode === undefined ? 'unchanged' : mode, osDark: osDark === undefined ? 'real' : osDark, errors: [] };
      let pAt, bgAt, installed = false, done = false, flips = 0, primChanges = 0, lastPrim;
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        if (installed) return;
        const w = f.contentWindow, d = f.contentDocument;
        if (!d || d.URL === 'about:blank') { ch.port2.postMessage(0); return; }
        installed = true;
        res.installedBeforeBody = !d.body;
        if (osDark !== undefined) {
          const real = w.matchMedia.bind(w);
          w.matchMedia = (q) => (/prefers-color-scheme/.test(q)
            ? { matches: /dark/.test(q) ? osDark : !osDark, media: q, onchange: null,
                addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } }
            : real(q));
        }
        const keep = (s) => String(s).slice(0, 200);
        const oe = w.console.error.bind(w.console);
        w.console.error = (...a) => { res.errors.push(keep(a.map((x) => (x && x.message) || x).join(' '))); oe(...a); };
        w.addEventListener('error', (e) => res.errors.push('onerror: ' + keep(e.message)));
        w.addEventListener('unhandledrejection', (e) => res.errors.push('rejection: ' + keep((e.reason && e.reason.message) || e.reason)));
        const root = d.documentElement;
        const prim = () => w.getComputedStyle(root).getPropertyValue('--v2-primary').trim();
        const rec = () => {
          if (res.tMarker !== undefined) return;
          const m = d.querySelector(SEL);
          if (!m) return;
          res.tMarker = Math.round(w.performance.now());
          res.darkAtMarker = root.classList.contains('dark');
          pAt = prim(); lastPrim = pAt; bgAt = w.getComputedStyle(m).backgroundColor;
        };
        rec();
        new w.MutationObserver(rec).observe(d, { childList: true, subtree: true });
        new w.MutationObserver((recs) => {
          if (res.tMarker === undefined) return;
          for (const r of recs) {
            if (r.attributeName !== 'class') continue;
            const was = /(^|\s)dark(\s|$)/.test(r.oldValue || '');
            if (was !== root.classList.contains('dark')) flips++;
          }
          const p = prim();
          if (p !== lastPrim) { primChanges++; lastPrim = p; res.tPrimaryLastChangeMs = Math.round(w.performance.now()); }
        }).observe(root, { attributes: true, attributeOldValue: true });
      };
      f.addEventListener('load', () => {
        if (done || !f.contentDocument || f.contentDocument.URL === 'about:blank') return;
        done = true;
        setTimeout(() => {
          const w = f.contentWindow, d = f.contentDocument;
          const nav = w.performance.getEntriesByType('navigation')[0] || {};
          const cssEnd = Math.max(0, ...w.performance.getEntriesByType('resource')
            .filter((e) => /\.css(\?|$)/.test(e.name)).map((e) => e.responseEnd));
          const m = d.querySelector(SEL);
          const primNow = w.getComputedStyle(d.documentElement).getPropertyValue('--v2-primary').trim();
          Object.assign(res, {
            status: nav.responseStatus, finalPath: w.location.pathname + w.location.search,
            blankMs: res.tMarker === undefined ? null : Math.max(0, Math.round(res.tMarker - Math.max(nav.domInteractive || 0, cssEnd))),
            darkSettled: d.documentElement.classList.contains('dark'),
            darkFlipsAfterMarker: flips,
            primaryChangesAfterMarker: primChanges,
            customFirstFrame: res.tMarker === undefined ? null : pAt === primNow,
            bgMatchesSettled: m && bgAt !== undefined ? bgAt === w.getComputedStyle(m).backgroundColor : null,
            customStyleInDom: d.querySelectorAll('style[data-v2-custom-tokens]').length,
            v2PrimaryDefined: primNow !== '',
            iconShown: m ? [...m.querySelectorAll('svg')].filter((s) => w.getComputedStyle(s).display !== 'none')
              .map((s) => ((s.getAttribute('class') || '').match(/lucide-(sun|moon)/) || [])[1] || '?') : null,
          });
          f.remove();
          resolve(res);
        }, settleMs);
      });
      f.src = location.origin + path;
      document.body.appendChild(f);
      ch.port2.postMessage(0);
    });
  }

  // Server-response guard: n sequential document fetches of this origin.
  async function doc(n = 5, path = '/business-os') {
    const out = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      const r = await fetch(location.origin + path, { cache: 'no-store' });
      await r.text();
      out.push({ ms: Math.round(performance.now() - t0), status: r.status, redirected: r.redirected });
    }
    return out;
  }

  return { html, frame, doc, median, setMode };
})();
```

Notes on the helper: `blankMs` = `tMarker − max(domInteractive, last CSS responseEnd)`, floored at 0 (§7.1). The marker is the Business OS header toggle, so `blankMs`, `customFirstFrame` and `iconShown` are `null` on `/onboarding-*`, `/v2/*` and public pages; on those routes only `status`, `errors` and the theme booleans are read. The main-thread poll runs only until the iframe commits, so it does not compete with parsing.

### Test Outputs / Logs

```text
7 new suites:            Test Suites: 7 passed, 7 total   Tests: 220 passed, 220 total
Brief's affected set:    Test Suites: 82 passed, 82 total Tests: 1563 passed, 1563 total
Dev's affected set:      Test Suites: 101 passed, 101 total  Tests: 2360 passed, 2360 total
paymentHold (3 suites):  Tests: 66 passed, 66 total
test:bos-entitlements:   Test Suites: 268 passed, 268 total  Tests: 7990 passed, 7990 total
Probe (a):  7 failed  (T-S2 x4, T-P2, T-P8, G-4)
Probe b1-b4: 154 passed, 154 total  (each)   <- QA-1
Probe c1:   1 failed  (T-R8)      Probe c2: 1 failed (constants)
Probe d1:   3 failed  (G-1, G-2 business-os, G-3)   Probe d2: 6 failed (G-1, G-2 x4, G-3)
Restore:    sha256sum -c over all 27 changed/new files -> OK (workplan excluded, edited by SA)
```

### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit: **QA-1** (test gap, Medium), SA **CR-1** (needed for step 7), SA CR-2/CR-3/CR-4. Then the browser checklist: P0 steps 1, 2, 7 and 8 gate T-12/T-13. No High bug is open.

---

## Commit Info

_RM to populate. Nothing is committed until the user has seen the diff. The scoping doc is never committed._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Workplan created | Dev, from the SA analysis and the scoping doc's §0 row. Base `6bb1eda1`. Awaiting SA review |
| 2026-10-14 | SA workplan review | APPROVED WITH CHANGES. Q-1 to Q-7 ruled (all as the Dev recommended; Q-6 uses `clientLogger`). RC-1 (High: isomorphic layout effects so a client-side entry has no light frame), RC-2 to RC-9. TH-3 (`.dark` left after unmount) and the `useTheme.ts` deletion recorded as follow-ups. BR-1b §12.6 addendum written in the master requirement |
| 2026-10-15 | Revision 2: TH-2 folded in, re-based | RC-7 stop hit (non-empty production `v2_custom_tokens` row; values not recorded). User decision: read the tokens on the server and inline them; remove the browser read; RLS stays out of scope (TH-2b). Added §0, §2.7–§2.10, T-0(g), §7.4, T-C, T-R, T-T2, T-P7/T-P8, G-7–G-12, R-14–R-20, R2-Q1 to R2-Q9. Folded RC-1 to RC-9 into the body; RC-6 moot. `/v2` becomes a `force-dynamic` server layout. Branch reset to `origin/main` @ `936dfd04`. **SA re-review needed** |
| 2026-10-15 | SA re-review (revision 2) | APPROVED WITH CHANGES. R2-Q1/2/3/5/6/7/8/9 approved as the Dev recommended (Q2 adds a no-last-good back-off; Q6 adds a user-facing logging proposal; Q9 has no double log). **R2-Q4 reversed:** a 1000 ms deadline is required (RC-10, High), because of the 20 s `supabaseFetch` timeout and single-flight. RC-11: G-8 would fail on `main` (`useUIVersion.ts` is a third browser reader → TH-2b). RC-12: T-12 checks by name that the live values survive sanitizing. RC-13: sanitizer/builder tightening. RC-14: user told about the logging rule via F-1. T-0(g) accepted |
| 2026-10-15 | RC-10 to RC-13 folded; TH-1 implemented (uncommitted) | Dev. Folded RC-10 (1000 ms deadline, negative back-off, T-R5b/T-R8), RC-11 (G-8 narrowed; `useUIVersion.ts` → TH-2b), RC-12 (names-only check at T-12), RC-13 (trimmed output, deep freeze, more T-C4 cases, `Object.create(null)`, computed specificity). Implemented T-2..T-10. **IN-2:** a synchronous context update during hydration would have forced the Suspense boundary to client-render every owner page; fixed by writing the DOM in the mount layout effect and moving the state into `startTransition`. **IN-3:** `paymentHold.test.ts` placement guard now allows the token start. All suites green, 28/28 probes caught, branch build exit 0. Browser runs owed by the user (IN-7) |
| 2026-10-15 | SA code review | APPROVED WITH CHANGES, code approved for QA with conditions. IN-2 (DOM write in the mount layout effect, state in `startTransition`), IN-3 (`paymentHold` guard), IN-6 (keep `force-dynamic` + G-9), RC-10/RC-13, rule 4, segment-only placement and the provider's removed browser client all verified. **CR-1 (Medium):** the cold-miss `ms` is logged at `debug`, which production never emits (`lib/logger.ts:26`), so log it at `info`. **CR-2 (Low):** T-P2b with a `mode` consumer inside the boundary. **CR-3 (Medium, proof):** RC-5(a) is ruled a Dev-run, curl-only production-build proof on `/onboarding-build` signed out; T-P4 plus the smoke is not enough. **CR-4 (Low, doc):** mark the static-`/v2` statements superseded by IN-6. `/v2/billing` 307 → 200 expected under RC-4 |
| 2026-10-15 | SA CR-1/CR-2/CR-4 and QA-1 applied; CR-3 proven | Dev. QA-1: `;`/`:` reject rows plus a forbidden-character table; grammars use `[ \t]` (QA b1–b4 and b5 now fail). CR-1: completed read logged at `info` `{ ms, keys }`, `ms` on failure warns, T-R9. CR-2: T-P2b (probe 4 fails it). CR-4: static-`/v2` statements marked superseded. **CR-3 passed** (200, shell + script, `<!--$!-->`, one error with digest per request; style present once the token cache is warm; RC-12 names exactly primary/secondary). **IN-11: early RC-10(e) data from this machine is above 500 ms (median ≈ 800 ms); stop condition, for SA.** Branch rebuilt |
| 2026-10-15 | SA ruling: IN-11 | FIX REQUIRED (design change, small). The IN-11 data mixes two waits. TTL-expiry reads made pages wait 470–1020 ms even with a last good value, and a cold, deadline-fired read rendered default colours with nothing correcting them, which is below today (TL concern upheld; the RC-10/R2-Q4 "equals a failed browser read" wording corrected: it holds for a failed read, not a slow one). **RC-15 (High):** stale-while-revalidate, so a page never waits when a last good value exists, and the 1000 ms deadline (unchanged) applies only to the cold, no-value read. **RC-16 (High):** a `customTokensKnown` prop, plus a provider fetch on the unknown-state render only, to a public GET-only route `/api/design-system/v2-custom-tokens` (same reader, 5000 ms route wait, 503 when unknown, `no-store`, client re-sanitizes; G-12 amended, G-13 new). Options (c) longer deadline, (d) warm-up and (e) another store rejected. **Gate re-baselined:** RC-10(e) local p95 replaced by blocking functional gates L-1..L-4; latency guards V-1..V-3 measured on the PR Vercel preview (or a post-deploy check), not blocking. Short delta SA review after the fix. No user business decision |
| 2026-10-15 | SA ruling IN-11 applied (RC-15, RC-16) | Dev. RC-15: stale-while-revalidate in the reader (only a no-value call waits, 1000 ms). RC-16: `readV2CustomTokens()` returns `{ tokens, known }` (G-7/`paymentHold` text unchanged); the four layouts pass `customTokensKnown`; the provider corrects an unknown render with one `no-store` fetch of the new public route `app/api/design-system/v2-custom-tokens` (503 unless known, output sanitized, client re-sanitizes). T-R10/T-R11, T-P9/T-P10, route test, G-13; 8 new probes caught. Branch rebuilt |
| 2026-10-15 | SA delta review (RC-15/RC-16) | APPROVED for QA, on one condition: SA-D1 (Low). Arm the page-deadline timer only for a waiting caller, so a background SWR refresh no longer logs a "this page uses…" slow warn. Add a T-R10 assertion and a probe, and land it before QA runs L-1. All seven delta checks pass: SWR has no await, the flight is shared with the 5000 ms route wait, a reset counts as known, the client fetch happens only when the server render was unknown (re-sanitized, no write after unmount), the route is public GET with a 503 plus `no-store`, Pino plus `correlationId` and the documented bypass, there is no browser DB read, and the `doNotFake: ['Date']` fix is correct. SA-D2 is a note only. SA-D3: a stray `.env.local` is still in the worktree. SA-D4: the `supabaseFetch.test.ts` failure is pre-existing and Windows-only (the Jest `process.env` proxy ignores `defineProperty`), it does not depend on `NODE_ENV`, and it is not caused by TH-1 |
| 2026-10-15 | SA delta review (RC-15/RC-16): SA-D1 applied | Dev. The page deadline is armed only by a waiting caller (`deadlineOf`), once per flight, so a background refresh logs no deadline warn. T-R10 assertion added; eager-arming probe caught. Suites green, branch rebuilt with `.env.local` left in place for the main session (SA-D3 note corrected in IN-12) |

### Manual browser checks: main session, 2026-10-15

Production builds: base `936dfd04` on localhost:3011, branch (SA-D1 rebuild) on localhost:3012. Signed in as the user's test owner. Only names, booleans, statuses and times are recorded; no token value or cookie. Nothing was saved on `/admin/ui-config`.

| Check | Result |
|---|---|
| P0-1 markup + RC-12 (9 owner routes) | ✅ Status parity: all 200 on both. Branch: header toggle in the server HTML on all 7 BOS routes, exactly 1 custom-token style per route with names `{--v2-primary, --v2-secondary}`, no `.dark` on `<html>` in the HTML. Base: no toggle, no style |
| P0-2 smoke, 21 routes × light/dark (42 iframe runs) + base light run | ✅ Status parity on all 21 routes (all 200 on both, including `/v2/billing`). BOS routes: `blankMs` 0. `darkSettled` equals the chosen mode on every owner route, 0 dark flips after the marker, icon moon/sun correct, one token style per page. Hydration-pattern errors: only on `/v2/billing` (#419, light and dark). That is the server `redirect()` caught by the boundary and finished as a client render; it still lands on `/settings?tab=billing`, the outcome SA accepted in the code review. The other console errors are "Failed to fetch" (requests aborted when the sampler removes the iframe while the throttled background tab is still fetching) and logger objects that base also logs (base: BOS 1/3/1/0/4/0/1). No product regression identified |
| Custom colours on the first frame (§7.4) | ✅ A direct sampler shows the computed `--v2-primary` at the header marker equals the custom value, and still does after settle. The raw text matches the provider's inline value. QA-helper `customFirstFrame:false` was a sampler artifact |
| P1(e) public pages after a dark owner visit | ✅ `/privacy`, `/site/<sub>` and `/site/<sub>/book`: no `.dark`, no token style, no theme script, `--v2-primary` undefined. The owner page in the same run was dark with the custom style |
| L-3 no correction fetch when known | ✅ 0 `V2CustomTokensAPI` log lines (the route logs every success) across ~45 warm owner loads |
| L-2 cold, deadline fired → correction | Not exercised live: 3 fresh restarts, cold first reads 687 / 393 / 323 ms, all under the 1000 ms deadline. The style was in the first HTML each time and no route call was made. Correction path carried by T-P10 (per the SA ruling) |
| L-1 expired-cache loads don't wait / background read times | ✅ Background refresh reads logged at info: 487, 418, 1383, 248 ms, at ~60 s intervals; no "slow" warns. The response guard below shows no added wait |
| Server-response guard (`/business-os`, 20 interleaved in-page pairs, no cookies leave the browser) | ✅ base median ≈ 217 ms (19 valid samples), branch 215 ms. Δ ≈ −2 ms, within max(10%, 30 ms) |
| Server log (branch) | No `digest`, no `V2CustomTokensRead` warn. One new info-level line from Stripe Connect ("ConnectJS won't load when rendering code in the server … no impact in the UI"), because owner pages now server-render. Follow-up: consider Stripe's `pure` loader |
| Not run | Filmstrips under Slow 4G/4× CPU (the in-app browser has no throttling); Hebrew/Spanish smoke; client-side entry via `/auth/callback`; `/admin/ui-config` (read-only); live L-2 deadline-fired correction |
| Cleanup | Servers stopped; `.env.local` removed from the worktree; base export deleted, junction first (shared node_modules intact, 844 entries); localStorage theme key cleared on both ports; launch entries removed |

**Browser QA status:** ✅ Ready for the user to see the diff.
