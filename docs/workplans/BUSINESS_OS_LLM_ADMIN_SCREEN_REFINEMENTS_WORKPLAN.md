# Workplan: Business OS AI Admin Screen — Refinements from First Use

> **Last Updated**: 2026-09-24

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_ADMIN_SCREEN_REFINEMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_ADMIN_SCREEN_REFINEMENTS_REQUIREMENT.md) — 15 FRs (FR-10 withdrawn), 23 ACs. **SA-approved for a Dev workplan** after a full review and a targeted re-check, subject to **RC-1 … RC-4** plus the **Q-5** pre-implementation check, all of which this workplan folds in.
**Context (read, not re-derived):** [BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md](/docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md) §5 (slice 2 — this screen, built two days ago: its file table, its tests S2-T1…S2-T11, its five mutation proofs, its gate measurements and its rejected-wording history) · [BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_REQUIREMENT.md) (FR-6, FR-16, FR-17, AC-4, AC-16) · [runbook](/docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md) §3/§4/§5 · `.claude/skills/bos-llm-call-standards/SKILL.md`.
**Branch:** **`feature/business-os-llm-admin-screen-refinements`** (cut by RM off `main` `a34f2572`; confirmed with `git branch --show-current` before the first edit — T1).
**Original branch note:** **RM creates `feature/business-os-llm-admin-screen-refinements` off `main` `a34f2572`.** This workplan was written on `main` with **no code written and nothing committed** — Dev confirmed `git branch --show-current` → `main` and stopped at the plan, per the instruction that RM creates the branch after SA approves this document.
**Date:** 2026-09-24
**Status:** **✅ SA-approved code · ✅ QA PASS · ✅ CR-1, CR-2, QA BUG-1 and QA EDGE-1 all closed 2026-09-24 ([§15](#15-the-final-fix-pass--cr-1-cr-2-bug-1-edge-1)).** Mutation matrix re-run in full: **12 of 12 red** — and the re-run found **M7 surviving** for CR-1's exact reason, now fixed ([§15.2](#152--new-finding--m7-was-surviving-too-for-cr-1s-exact-reason)). **Nothing is committed.** Next: the user's own view of the screen, then RM. Prior status: SA code-reviewed 2026-09-24 — approved for QA, conditional on CR-1 (one test edit) and CR-2 (one doc correction); see [§14](#14-sa-review-notes--phase-2-code). SA approved the plan with changes on 2026-09-24; **RC-5 … RC-11 are folded in and each is evidenced in [§13](#13-how-rc-5--rc-11-were-satisfied)**. All gates measured in [§8](#8-gates-and-verification); the mutation matrix ran at ten rows and **all ten turned a named test red**. Nothing is committed — the commit is the user's gate and RM's job.

---

## Overview

One subtractive round over `app/admin/business-os-llm/**`: the on/off switch surface and its ~180-word fail-open banner go, the Ledger Check panel is parked, the provider moves from 22 call rows to 8 area headers, the four excluded chat embedding calls become visible-but-greyed, and the provenance badges are re-based from a **call-vs-area** axis onto a **database-vs-code** one. Two things are deliberately kept: the "Last changed / actor" line, and a way to see that an area — or a single call — is switched off.

**Shape of the change.** Items 1–7 are presentation only and touch no server module. Item 8 (FR-9) is the one payload addition: the client is forbidden from knowing which calls are excluded or why (FR-6 of the approved requirement), so the excluded-call list and its reason travel on the wire from an exported policy constant.

**The three things most likely to go wrong, and where this plan handles them:**

| Hazard | Handled in |
|---|---|
| Removing the `enabled` and `provider` **fields** silently deletes their **issues** from the page (F-6 / R-C) | [D-1](#d-1--one-constant-drives-both-the-render-and-the-catch-all-r-c), [R-T2](#7-tests) |
| Parking the ledger panel silently deletes the ~60-second propagation statement (F-5 / R-D) | [D-7](#d-7--propagation_note-keeps-one-source-r-d) |
| A `types.ts` / `adminSettingsView.ts` divergence is **invisible to jest** (FR-15 / R-H6) | [T11](#6-task-list), [§8](#8-gates-and-verification) |

---

## Table of Contents

1. [Pre-implementation check — Q-5, run and recorded](#1-pre-implementation-check--q-5-run-and-recorded)
2. [Code-reality check (W-1 … W-9)](#2-code-reality-check-w-1--w-9)
3. [Design decisions (D-1 … D-13)](#3-design-decisions-d-1--d-13)
4. [Traceability — FR → task, AC → test](#4-traceability--fr--task-ac--test)
5. [Files to create / modify / delete](#5-files-to-create--modify--delete)
6. [Task list](#6-task-list)
7. [Tests](#7-tests)
8. [Gates and verification](#8-gates-and-verification)
9. [Documents to update on completion](#9-documents-to-update-on-completion)
10. [`console.*` in touched files](#10-console-in-touched-files)
11. [Risks](#11-risks)
12. [Questions for SA](#12-questions-for-sa)
13. [SA Review Notes](#sa-review-notes)
14. [How RC-5 … RC-11 were satisfied](#13-how-rc-5--rc-11-were-satisfied)
15. [SA Review Notes — Phase 2 (code)](#14-sa-review-notes--phase-2-code)
16. [QA Testing Report](#qa-testing-report)
17. [The final fix pass — CR-1, CR-2, BUG-1, EDGE-1](#15-the-final-fix-pass--cr-1-cr-2-bug-1-edge-1)
18. [Commit Info](#commit-info)
19. [Change History](#change-history)

---

## 1. Pre-implementation check — Q-5, run and recorded

SA required `npm run bos:llm-settings -- get chat` **and** `get leads` before implementation, because the requirement's claim that the off-state indicators "render zero times today" was derived from the seed's literal values, not from production: the seed copies the legacy `bizchat_analysis_enabled` into `calls.analysis.enabled`, and the legacy `lead_reply_recommender_enabled` into `bos_llm_area_leads.enabled`.

**Both commands ran successfully against production** (`jgccgkyhpwirgknnceoh.supabase.co`) from the repository root on **2026-09-24**. They are read-only `get` commands; nothing was written.

| Command | Stored row, verbatim from the script's output | Answer |
|---|---|---|
| `npm run bos:llm-settings -- get chat` | `{"calls":{"planner":{"model":"gpt-4o-mini"},"analysis":{"model":"gpt-4o-mini","enabled":true}},"model":"gpt-4o-mini","enabled":true,"provider":"openai","temperature":0}` — `resolved.analysis.enabled: true`, `areaEnabled: true`, `issues: []` | **`calls.analysis.enabled` is `true`.** The **call-level** `Configured: off` chip renders **zero** times today. |
| `npm run bos:llm-settings -- get leads` | `{"model":"gpt-4o-mini","enabled":true,"provider":"openai","temperature":0.2}` — `areaEnabled: true`, `issues: []` | **`enabled` is `true`.** The **area-level** `Configured: off` chip renders **zero** times today. |

**Disposition — Q-5 is closed.** The requirement's "renders zero times today" claim is now a **measured fact about production**, not an inference from the seed, for both of the two production-dependent flags. It is safe to put that sentence in the PR description. Two further consequences:

1. **A day-one render of either chip would be a genuine change of state, not a day-one surprise** — so QA may treat an off chip on the live screen as something to investigate rather than as expected noise.
2. Both rows also confirm the seed's own fallback values were taken for chat (`planner`/`analysis` both `gpt-4o-mini`) and for leads (`gpt-4o-mini`), so the **seed-derived test fixture** in [§7](#7-tests) matches production for the two areas whose values could have differed. `rowUpdatedAt` on both is `2026-09-21T10:14:08`, and `updated_by` is unrecorded — so AC-11's "actor not recorded" state is still every card's state, as slice 2 measured.

---

## 2. Code-reality check (W-1 … W-9)

Read on `main` at `a34f2572`. Every requirement citation I depended on was re-verified; the ones that hold are not restated. **W-1 is a correction the requirement needs; W-2 and W-3 are decisions the requirement leaves open; the rest are implementation facts that shape the plan.**

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| **W-1** | ⚠️ **AC-13's arithmetic does not close, and as written it is unsatisfiable.** FR-6's table counts "resolved from the stored row, at either level" as **42 of 44** and, separately, "set on this call specifically" as **9** — but the 9 are a **subset** of the 42 (a call-level value *is* a stored value). So "42 of 44 **unmarked** fields" cannot be asserted: 9 of those 42 carry `*`. The true distribution is **35 unmarked** (33 area-level + 2 code-owned-by-policy), **9 `*`**, **0 `c`**. Derived field by field from the seed against `modelSettingsPolicy.ts:166-228` and the resolver's provenance assignment. | seed `20261003_…sql`; `modelSettingsPolicy.ts:166-228`; `modelSettings.ts:596-691` | **AC-13 is asserted as "42 of 44 fields resolve from the stored row, of which 33 are unmarked; 35 of 44 carry no marker at all".** The *scheme* is unchanged — this is an arithmetic correction to the AC, not to FR-6. Raised as [Q-SA-2](#12-questions-for-sa). |
| **W-2** | **`overrideCount()` counts a call as overridden on any of the four fields — including `enabled` and `provider`, which will no longer render a marker.** `provenance` is a 4-field record, and `chat/analysis`'s row sets `enabled` at call level (confirmed in §1), so its provenance is `enabled: 'call'`. | `AreaCard.tsx:38-42`; `modelSettings.ts:713-726`; §1 | Left as-is, the `N set per call` chip could claim a per-call value on a card that shows **no `*` anywhere** — a count with no visible referent, on the page this round exists to quieten. [D-4](#d-4--n-set-per-call-counts-calls-that-carry-a-visible-marker-rc-2) narrows the **fields** while keeping SA's pinned **calls** semantics. **Today the narrowing changes no number on any of the eight cards** (chat 2, insights 2, website 3, intake 1, rest 0 either way). |
| **W-3** | **RC-2's suggested legend wording and RC-3's correctness fix disagree.** RC-2 proposes `c code default — nothing is stored for this field`; RC-3 rules that exact phrase **false in a reachable state** (a refused value leaves provenance at `default` while the row does hold a value). | `modelSettings.ts:610-621`, `:623-636`; RC-2 vs RC-3 | The legend takes RC-3's truthful form while keeping RC-2's one-noun rule: **`c code default — no stored value is in force for this field`**. Both conditions met with one string. [D-13](#d-13--legend-and-hover-copy-rc-2--rc-3), [Q-SA-3](#12-questions-for-sa). |
| **W-4** | **RC-3 is confirmed in the code, and it is wider than the `c` marker.** `from.model`/`from.provider` stay `'default'` when a configured value is refused (`continue`, not `break`) — and S1-8 additionally **forces** `from.provider = 'default'` whenever the model fell back, so a provider that *was* accepted can still read `default`. | `modelSettings.ts:608-621`, `:623-636`, `:641-650` | The `c` hover must be true in **both** states, and must point at the refusal reason rendered on the same field. Provider carries no marker at all (FR-8), so the S1-8 half is moot on the page — but it is the reason the hover may not say "nothing is stored". |
| **W-5** | **The exclusion list is typed to chat but the derivation need not be.** `BOS_LLM_SETTINGS_EXCLUDED_CALLS` is `satisfies readonly BosLlmCallName<'chat'>[]`, and `bosLlmSettingsCallNames()` already filters by `isExcludedFromBosLlmSettings(name)` — a per-name predicate, not a per-area one. | `modelSettingsPolicy.ts:62-76`, `:289-291` | FR-9's payload field is built **generically** — `BOS_LLM_CALLS[area].filter(isExcludedFromBosLlmSettings)` — so it is empty for the other seven areas by data, not by an `if (area === 'chat')`. No plugin-style special case enters the view builder. |
| **W-6** | **Nothing currently asserts the `N calls` chip text, so C-7's "check the `2 calls` → `6 calls` change against the existing render assertions" finds nothing to break.** `page.render.test.tsx` has no assertion on the count chip; the chip has no `testId`. | `AreaCard.tsx:96-98`; `page.render.test.tsx` (no match) | C-7's condition is discharged by **adding** the assertion (AC-19) rather than by repairing one. The chip gains a `testId` so the assertion is not a page-wide text match. |
| **W-7** | **`PROPAGATION_NOTE` has exactly one *rendered* assertion, and it is on the page, not the panel.** `ledgerPanel.render.test.tsx` never mentions it; S2-T11 asserts it via `getByTestId('ledger-panel')`. | `page.render.test.tsx:310-322`; `ledgerPanel.render.test.tsx` (no match) | Parking the panel makes S2-T11 fail, as expected — it is re-pointed at the header line. But that would leave the panel's own second clause (*"the ledger check only starts counting after that"*) with **no test at all** while parked, so a **new** assertion is added inside `ledgerPanel.render.test.tsx`. §12's "should need no edits" holds for `lastChanged.render.test.tsx`; for the panel test it is an **addition**, declared here. |
| **W-8** | **The screen's compile-time safety is weaker than it looks.** `next.config.js` ignores TypeScript errors, and ts-jest emits no diagnostics under this repo's jest config (SA F-4), so **no TS error in `app/admin/business-os-llm/` fails any gate** — the screen is outside `typecheck:bos-llm`'s scope by design (FR-6). | `next.config.js`; `adminSettingsView.wireTypes.test.ts` header; `source.guard.test.ts` header | A type-level pairing (e.g. `Record<RenderedField, …>`) is **documentation, not enforcement**, inside the screen. R-C's "cannot drift a second time" therefore has to be carried by a **source assertion plus a mutation proof** ([D-1](#d-1--one-constant-drives-both-the-render-and-the-catch-all-r-c), R-T2), not by the type system. The one place types *are* enforced is `types.ts` ↔ `adminSettingsView.ts`, via `typecheck:bos-llm` — which is exactly FR-15. |
| **W-9** | **`npm run lint` is broken repo-wide and must not be run.** `"lint": "next lint"` under Next 14 does not read the flat config (`eslint.config.mjs` — note the extension; CLAUDE.md's memory line says `.js`) and drops into an interactive setup prompt. | `package.json:17`; `eslint.config.mjs`; slice 2 §5.3 | Verification uses **`npx eslint <touched files>`**, as slice 2 did after QA DEF-S2-6 corrected a false claim on that same row. `npm run lint` is not in this plan's gate table. |

---

## 3. Design decisions (D-1 … D-13)

### D-1 — One constant drives both the render and the catch-all (R-C)

`CallRow.tsx:93` filters `otherIssues` against a hand-written `['enabled','provider','model','temperature']`. Removing two of those fields without touching the filter deletes `provider_not_allowed` and the `enabled` lock reasons from the page (F-6).

**Shape.** A new `app/admin/business-os-llm/markers.ts` exports

```typescript
export const RENDERED_FIELDS = ['model', 'temperature'] as const;
export type RenderedField = (typeof RENDERED_FIELDS)[number];
```

`CallRow` computes **one** list per render and uses it for **both** purposes:

```typescript
const renderedFields: readonly SettingField[] = showProvider
  ? [...RENDERED_FIELDS, 'provider']
  : RENDERED_FIELDS;
// render:    renderedFields.map(…)
// catch-all: call.issues.filter((i) => !renderedFields.includes(i.field as SettingField))
```

Three consequences, all deliberate:

- The field **bodies** are supplied by a `Record<RenderedField | 'provider', (call: CallView) => ReactNode>`, so a field added to the constant without a body is a type error *in an editor* — but per **W-8** that is not enforced by any gate, so the property is carried by **R-T2's source assertion** (the filter expression must reference `renderedFields`, and `CallRow.tsx` must contain **no second array literal of field names**) and by a **mutation proof**.
- **The catch-all renders `issue.field`** (R-C condition 2), in the same muted style the reason already uses: `provider` · `provider_not_allowed — This value was refused…`.
- FR-8's `varies by call` path ([D-6](#d-6--provider-moves-to-the-area-header-and-defends-itself-fr-8)) re-adds `provider` to **the same list**, so the per-call provider field and its issues return together. This is the one place where a second list would silently re-create the bug in a new costume.

### D-2 — The marker is its own component, and the glyph is never the carrier (RC-1)

New `components/Marker.tsx`. Markup, following the lucide-icon pattern already used on this page:

```tsx
<span title={MARKER_TITLE[kind]} data-testid={`marker-${kind}`}>
  <span aria-hidden="true" className="font-mono …">{MARKER_GLYPH[kind]}</span>
  <span className="sr-only">{MARKER_SR[kind]}</span>
</span>
```

- **RC-1, binding:** it is rendered **inside the field label row**, immediately after the label text, and **never** adjacent to the value. `0.7*` reading as part of a number is the failure mode; `TEMPERATURE *` is not. The `Field` wrapper takes the marker as a prop of the *label*, which means the density slice (which wanted markers "inline" in a table) inherits the constraint structurally rather than by memory.
- `aria-hidden` on the glyph plus an adjacent `sr-only` phrase, so assistive tech announces the meaning once and not "star".
- Not a `Chip`: chips are word labels with a tone; a marker is a single monospace glyph in the label run, and giving it a chip's border and background would make the "exception" louder than the value.

### D-3 — One predicate decides every marker

Also in `markers.ts`:

```typescript
export function markerFor(call: CallView, field: RenderedField): 'call' | 'code' | null
```

Order is load-bearing:

1. **Policy-owned first** — `field === 'temperature' && (locks.lockedTemperature !== null || locks.temperatureNotApplicable)` → `null`. `LOCK_TEMPERATURE_FIXED` / `LOCK_TEMPERATURE_NOT_APPLICABLE` already say it **as text**, and C-6 makes that text load-bearing. A `c` here would be the permanent, uncleanable nag R-E rejected.
2. `provenance[field] === 'call'` → `'call'` (`*`).
3. `provenance[field] === 'default'` → `'code'` (`c`).
4. otherwise `null`.

One function, used by the row and by the collapsed-card roll-up, so the chip and the markers cannot disagree.

### D-4 — `N set per call` counts calls that carry a visible marker (RC-2)

`overrideCount()` is replaced by `callsSetPerCall(area)` in `markers.ts`: the number of **calls** for which `RENDERED_FIELDS.some((f) => markerFor(call, f) === 'call')`.

- **SA's pinned semantics are kept:** `N` counts **calls**, not fields (RC-2), and the chip's `title` says so — *"N calls have a value set on the call itself. One call can have more than one."* — because `2 set per call` sits beside `2 calls` on the chat card.
- **The deviation, declared:** RC-2 says "existing `overrideCount()` semantics", and the existing function also counts `enabled` and `provider` provenance (**W-2**). Narrowing to the two fields that can show a `*` makes the chip exactly the roll-up of the visible markers. **It changes no number on any card today** (chat 2, insights 2, website 3, intake 1, others 0, under either definition). Raised as [Q-SA-1](#12-questions-for-sa) — if SA prefers the literal reading, the change is one line and the fixture assertion moves with it.
- Excluded calls (FR-9) are not in `area.calls`, carry no markers and cannot be counted.
- `N with a call override` and `N on code defaults` are asserted **absent from the source** (AC-17).

### D-5 — Two off chips and one roll-up, each rendering only in its exception (FR-2, R-H1, RC-4)

| Chip | Condition | Wording |
|---|---|---|
| Area | `area.switchable && !area.configuredEnabled` | `Configured: off`, **verbatim**, plus the one-sentence caveat on that card only |
| Call | `!call.resolved.enabled` | `Configured: off`, same chip, `title` = *"The stored row switches this call off. That is what the row says, not what the fleet is doing (runbook §5)."* |
| Collapsed roll-up | `!areaShowsOff && offCalls > 0` | `N calls configured off` |

`const areaShowsOff = area.switchable && !area.configuredEnabled;` — **RC-4** expressed as one guard rather than as a second copy of the area condition. With the area off, every call inherits `enabled: false` and the roll-up would read `8 calls configured off` beside `Configured: off`; the state it exists to surface is *area on, calls off*. A non-switchable area (onboarding) resolves every call `enabled: true`, so the roll-up is vacuously zero there without a special case.

`Configured: on` and `Cannot be switched off` are dropped. **S2-T8's page-wide scan for any string asserting an area *is* off stays** (C-3) and is extended over the new call-level chip.

### D-6 — Provider moves to the area header and defends itself (FR-8)

`areaProviderSummary(area)` in `AreaCard`, mirroring the existing `areaModelSummary()`:

```typescript
const providers = new Set(area.calls.map((c) => c.resolved.provider));
```

- `size === 1` → the value, in the collapsed summary line: `provider openai · model gpt-4o-mini`. No marker of any kind (AC-6).
- `size > 1` → the header reads **`varies by call`** and `showProvider` is passed to every `CallRow` **for that area only**, which returns the field *and* its issues through [D-1](#d-1--one-constant-drives-both-the-render-and-the-catch-all-r-c)'s single list.
- `size === 0` (no configurable calls) → falls in with the existing `no configurable calls` string.
- ⚠️ **The condition is `providers.size > 1` and never a comparison against a provider name** — enforced, not merely intended, by [D-10](#d-10--the-provider-literal-rule-becomes-real-fr-13-r-h4).

### D-7 — `PROPAGATION_NOTE` keeps one source (R-D)

The constant has exactly one caller today (`LedgerCheckPanel.tsx:48`, `:237`), so parking the panel deletes FR-20 from the page.

```typescript
const PROPAGATION_CLAUSE = 'Running instances pick a change up within about 60 seconds';

/** Unchanged, byte for byte: the panel renders this and its tests still pass. */
export const PROPAGATION_NOTE =
  `${PROPAGATION_CLAUSE}. The ledger check only starts counting after that, so a check run ` +
  `sooner has nothing to count yet.`;

/** R-D: the header's trimmed form — a second EXPORT, never an inline string. */
export const PAGE_STANDING_NOTE =
  `${PROPAGATION_CLAUSE}, and one that cannot read these settings on startup falls back to the ` +
  `values in code. These are the stored settings, not what the fleet is doing (runbook §5).`;
```

- The propagation fact lives in **one** fragment that both constants compose, so the header and the panel cannot drift when slice 3 re-mounts the panel.
- `PROPAGATION_NOTE`'s **rendered text is identical to today's**, so `LedgerCheckPanel` is untouched and its tests keep passing.
- **Deviation from FR-5's quoted sentence, declared:** FR-5 quotes *"These are the stored settings. A running instance picks a change up within about 60 seconds, and one that cannot read these settings on startup falls back to the values in code (runbook §5)."* Re-using the clause verbatim forces the plural (*"Running instances pick"*) and therefore a re-ordering. FR-5 anticipates copy edits and names what must survive them; all four load-bearing elements are present — ***stored***, ***about 60 seconds***, ***falls back to … code***, ***on startup*** — and the line still **ends with `(runbook §5)`** (R-A condition 2, AC-3). ~33 words against the banner's ~180. Raised as [Q-SA-4](#12-questions-for-sa).
- Rendered muted under the page header, **not** styled as a warning, with nothing to dismiss.

### D-8 — Parking the Ledger Check so that returning it is one line (FR-3, C-8)

| Where | Change |
|---|---|
| `AreaCard.tsx` | Delete the `<LedgerCheckPanel …/>` element **and its import**; replace with a comment carrying the date, the reason (*every area's only reachable state today is `too_long_ago`*), the fact that re-mounting is **one import plus one line**, and **R-D's obligation that slice 3 must not then render `PROPAGATION_NOTE` twice** — the header carries it while the panel is parked. |
| `LedgerCheckPanel.tsx` | Header gains a **`PARKED`** note saying the same, so a reader who opens the file first is not hunting for a caller. **No other change** — the component stays byte-identical below the header. |
| `ledger/route.ts` | Header gains the **"not dead code"** note naming slice 3 as its caller (C-8 condition — the next dead-code sweep reads the route, not the requirement). No behaviour change. |
| `ledgerCheckCopy.ts`, `ledgerPanel.render.test.tsx`, the route's tests | Unchanged and still green, including SA F-6's eight-branch table and RC-D's neutral-tone assertion — the panel test renders the component **directly**, so parking does not reach it. One assertion is **added** (W-7). |

**No feature flag** — a flag for one JSX element on an internal read-only page is a new runtime pattern (CLAUDE.md rule 7), and parking is a one-line edit in both directions.

### D-9 — The one payload addition (FR-9, FR-14, R-H5)

| File | Addition |
|---|---|
| `modelSettingsPolicy.ts` | `export const BOS_LLM_SETTINGS_EXCLUSION_REASON` — the sentence that exists today as the comment at `:62-69`, promoted to a constant beside `BOS_LLM_SETTINGS_EXCLUDED_CALLS`. Plus `export function bosLlmExcludedCallNames(area)`, the mirror of `bosLlmSettingsCallNames`, derived from the catalog via the existing per-name predicate (**W-5**) — no `if (area === 'chat')`. **Both additive; nothing else in the file changes.** |
| `adminSettingsView.ts` | `AreaView.excludedCalls: { callName: string; reason: string }[]`, built from those two exports. The reason is **referenced, never re-typed** (R-H5), and asserted equal on both sides. |
| `types.ts` | The mirrored wire type. The pin is `adminSettingsView.wireTypes.test.ts` **as evaluated by `typecheck:bos-llm`** — jest cannot see a divergence (W-8, FR-15). |

The four rows render under the chat card's `Calls` heading, below the two configurable calls, in the `quiet` tone — **not** amber, not an error style — carrying the FR-7 caption, **no value fields and no markers** (C-7 condition), and the server's reason line. The count chip becomes `area.calls.length + area.excludedCalls.length` → `6 calls` for chat, unchanged for the other seven.

### D-10 — The provider-literal rule becomes real (FR-13, R-H4)

Added to **the screen's own `source.guard` scan**, not to the shared `LITERAL_RULES` (which `route.test.ts` also consumes):

```typescript
const PROVIDER_LITERAL_RULE = {
  name: 'a quoted provider name in a screen file',
  pattern: /['"](openai|anthropic|groq|mistral|kimi|google|azure)['"]/i,
  mustMatch: `if (provider !== 'openai') {`,
};
```

It follows the file's `mustMatch` convention — the rule carries a sample it is **asserted to match** — because two rules in `bos-llm-literal-rules.ts` were once dead regexes that read as coverage. `codeOf()` strips comments first, so prose about a provider is not a violation. AC-8 also pins that **the same line passes silently today**.

### D-11 — The call-name caption (FR-7)

`LLM code call name` in the muted uppercase class the field labels already use, then the identifier in monospace, verbatim, never prettified. The class uppercases via CSS only, so the DOM's `textContent` is the authored sentence case and AC-18 asserts that string directly. **No per-call prose descriptions** — a copy table in a `'use client'` file is the hardcoding FR-6 of the approved requirement prevents.

### D-12 — Subtitle and sidebar (FR-11, FR-12)

Both are stale-and-green today (nothing asserts either), so both changes ship **with** their first assertion.

- `page.tsx` subtitle → *"The model and temperature every catalogued Business OS AI call will actually use, and where each value comes from. Provider is shown per area; the on/off switch is changed with the runbook, not here."*
- `AdminSidebar.tsx:155` description `'Models & Switches'` → **`'Models & temperatures'`**; `nav.test.ts` gains a **description** assertion beside its href and ordering ones.

### D-13 — Legend and hover copy (RC-2 + RC-3)

One muted line directly under the `Calls` heading **inside the expanded card** (only one card expands at a time, so exactly one legend is ever on screen):

> `No marker: set in the stored settings · * set on this call — the area value does not apply to it · c code default — no stored value is in force for this field · Call names are the identifiers in code, and the component value in the usage ledger.`

- **RC-2 met:** one noun for one thing — *stored* in both entries; *"not in the database"* is gone.
- **RC-3 met in the legend too:** *"no stored value is **in force**"* is true both when nothing is configured and when a configured value was **refused** (**W-3**, **W-4**). This is the reconciliation of RC-2's suggested string with RC-3 — see [Q-SA-3](#12-questions-for-sa).
- **R-E constraint met:** the `*` entry pairs no "code" word with a "database" word.
- The FR-7 clause is appended here rather than repeated on 22 rows.

Hover (`title`) text — the **consequence**, never the label:

| Marker | `title` |
|---|---|
| `*` | `This value is set on the call itself. Changing the area's value (runbook §3) will not move it — this call has to be changed on its own.` *(accurate as drafted; unchanged)* |
| `c` | `No stored value is in force for this field, so the call is running on the value written in code. If the row does set it, the reason it was refused is shown on this field. Setting it in the area row (runbook §3) takes precedence from then on.` *(**RC-3**: reworded, with the clause pointing at the refusal reason already rendered on the field)* |

**Mechanism is the `title` attribute** — there is no tooltip primitive in this repo and `@radix-ui/react-tooltip` is not a dependency (F-11, re-verified). The approved accessibility rule already requires a `title`, so this is richer content through an existing mechanism, not a new pattern. AC-16 asserts the **legend alone** still conveys each marker with the `title` attributes stripped.

---

## 4. Traceability — FR → task, AC → test

| FR | Task | AC | Test |
|---|---|---|---|
| FR-1 removals + R-C filter | T4, T5 | AC-1, AC-2 | R-T1, R-T2 |
| FR-2 off states (area, call, roll-up) | T6 | AC-9, AC-10 | R-T7 |
| FR-3 park the ledger panel | T8 | AC-4 | R-T4 |
| FR-4 attribution unchanged | — | AC-11 | existing `lastChanged.render.test.tsx`, unedited |
| FR-5 banner → one line | T3, T7 | AC-3 | R-T3 |
| FR-6 markers | T4, T5, T6 | AC-13 … AC-17 | R-T8, R-T9, R-T10, R-T11 |
| FR-7 caption | T5 | AC-18 | R-T12 |
| FR-8 provider relocation | T5, T6 | AC-5, AC-6, AC-7 | R-T5, R-T6 |
| FR-9 + FR-14 excluded calls | T9, T10, T11 | AC-19, AC-20 | R-T13, R-T14 |
| FR-11 subtitle | T7 | AC-21 | R-T15 |
| FR-12 sidebar | T12 | AC-22 | R-T16 |
| FR-13 provider-literal rule | T13 | AC-8 | R-T17 |
| FR-15 typecheck gate | T11, T14 | AC-23 | §8 (gate output recorded) |
| FR-16 slice-3 obligation recorded | T15 | — | §9 |
| C-6 lock text stays as text | — | AC-12 | existing S2-T6, extended (R-T18) |

---

## 5. Files to create / modify / delete

| File | Action | Reason |
|---|---|---|
| `app/admin/business-os-llm/markers.ts` | **create** | `RENDERED_FIELDS`, `markerFor`, `callsSetPerCall` — the one source for D-1, D-3, D-4 |
| `app/admin/business-os-llm/components/Marker.tsx` | **create** | RC-1 markup: glyph `aria-hidden`, adjacent `sr-only`, `title`, attached to the **label** |
| `app/admin/business-os-llm/components/ExcludedCallRow.tsx` | **create** | FR-9's muted row: caption, identifier, the server's reason. No value fields, no markers |
| `app/admin/business-os-llm/components/CallRow.tsx` | modify | Remove the `enabled` and `provider` fields and the `switch locked` chip; D-1's single list; FR-7 caption; markers; call-level off chip; catch-all renders `issue.field` |
| `app/admin/business-os-llm/components/AreaCard.tsx` | modify | Drop the switch chips and the inline fail-open notice; provider in the summary; legend; roll-up; excluded rows; unmount the ledger panel with D-8's comment |
| `app/admin/business-os-llm/components/FailOpenNotice.tsx` | **delete** | FR-5. Both variants go with the banner |
| `app/admin/business-os-llm/components/LedgerCheckPanel.tsx` | modify | **Header `PARKED` note only** — the component is otherwise untouched |
| `app/admin/business-os-llm/copy.ts` | modify | Delete seven strings (`FAIL_OPEN_*` ×4, `LOCK_AREA_FAIL_OPEN`, `LOCK_AREA_NOT_SWITCHABLE`, `LOCK_CALL_NOT_SWITCHABLE`) plus `PROVENANCE_LABEL`/`PROVENANCE_TITLE`; add `PAGE_STANDING_NOTE`, the marker legend/`sr-only`/`title` strings, the off-chip title, the FR-7 caption |
| `app/admin/business-os-llm/types.ts` | modify | `AreaView.excludedCalls` |
| `app/admin/business-os-llm/page.tsx` | modify | New subtitle; `FailOpenNotice` banner → `PAGE_STANDING_NOTE`, muted |
| `app/admin/business-os-llm/format.ts`, `components/{Chip,LastChangedLine,StoredRowPanel}.tsx` | **unchanged** | FR-4 and C-6 both depend on them staying exactly as reviewed |
| `lib/business-os/llm/modelSettingsPolicy.ts` | modify (additive) | `BOS_LLM_SETTINGS_EXCLUSION_REASON` + `bosLlmExcludedCallNames()` (FR-14) |
| `lib/business-os/llm/adminSettingsView.ts` | modify | `excludedCalls` on the wire |
| `app/api/admin/business-os/llm-settings/ledger/route.ts` | modify | **Header note only** — not dead code, slice 3 is its caller (C-8) |
| `app/admin/components/AdminSidebar.tsx` | modify | `'Models & Switches'` → `'Models & temperatures'` |
| `app/admin/business-os-llm/__tests__/page.render.test.tsx` | modify | The bulk of the new ACs; S2-T3/T6/T8/T11 updated per C-5/C-6/C-3/R-D |
| `app/admin/business-os-llm/__tests__/source.guard.test.ts` | modify | Removed strings absent; D-1's derivation; FR-13's rule |
| `app/admin/business-os-llm/__tests__/nav.test.ts` | modify | Description assertion (FR-12) |
| `app/admin/business-os-llm/__tests__/ledgerPanel.render.test.tsx` | modify (**addition only**) | W-7: keep `PROPAGATION_NOTE`'s ledger clause under test while the panel is parked |
| `app/admin/business-os-llm/__tests__/lastChanged.render.test.tsx` | **unchanged** | AC-11: if this needs an edit, something changed that this round did not intend |
| `tests/helpers/bos-llm-admin-fixtures.ts` | modify | The **seed-derived** 8-area / 22-call fixture and its self-check |
| `lib/business-os/llm/__tests__/adminSettingsView.test.ts` | modify | `excludedCalls` payload + reason equality |
| `lib/business-os/llm/__tests__/modelSettingsPolicy.test.ts` | modify | The exported reason constant and the derivation helper |
| `supabase/migrations/**`, `modelSettings.ts`, `callCatalog.ts`, `modelOptions.ts`, `switchOffPredicate.ts`, `ledgerCheckCopy.ts`, `scripts/bos-llm-settings.ts`, every repository | **untouched** | No DB change, no migration, no row edit, no resolver change |

---

## 6. Task list

- ✅ **T1** Confirm the branch is `feature/business-os-llm-admin-screen-refinements` (created by RM) before the first edit; record it in this header. **If the branch does not exist, stop and escalate to TL — Dev does not create it.**
- ✅ **T2** Re-read `## SA Review Notes` and `## SA targeted re-check` in the requirement, and slice 2's §5.3b / §5.3c / §5.3d, so no rejected wording is reintroduced.
- ✅ **T3** `copy.ts`: delete the seven switch/fail-open strings and the two provenance-label maps; add `PROPAGATION_CLAUSE` (private), `PAGE_STANDING_NOTE`, the marker legend / `sr-only` / `title` strings, the call-level off-chip title, the FR-7 caption. ([D-7](#d-7--propagation_note-keeps-one-source-r-d), [D-13](#d-13--legend-and-hover-copy-rc-2--rc-3))
- ✅ **T4** `markers.ts` + `Marker.tsx`. ([D-1](#d-1--one-constant-drives-both-the-render-and-the-catch-all-r-c), [D-2](#d-2--the-marker-is-its-own-component-and-the-glyph-is-never-the-carrier-rc-1), [D-3](#d-3--one-predicate-decides-every-marker), [D-4](#d-4--n-set-per-call-counts-calls-that-carry-a-visible-marker-rc-2))
- ✅ **T5** `CallRow.tsx`: remove the `enabled` and `provider` fields and the `switch locked` chip; single `renderedFields` list driving render **and** catch-all; catch-all renders `issue.field`; FR-7 caption; markers on labels; call-level `Configured: off`.
- ✅ **T6** `AreaCard.tsx`: state chip narrowed to the off case; provider in the summary line with the `varies by call` fallback; `N set per call`; the RC-4-guarded roll-up; the legend under `Calls`; excluded rows; `Configured: on` / `Cannot be switched off` / the inline notice removed.
- ✅ **T7** `page.tsx`: new subtitle; banner replaced by `PAGE_STANDING_NOTE`; delete `FailOpenNotice.tsx`.
- ✅ **T8** Park the ledger panel: unmount plus the D-8 comment in `AreaCard`, the `PARKED` header in the panel, the "not dead code" header in the route.
- ✅ **T9** `modelSettingsPolicy.ts`: the two additive exports (FR-14).
- ✅ **T10** `adminSettingsView.ts` + `types.ts`: `excludedCalls` on the wire; `ExcludedCallRow` mounted under the chat card.
- ✅ **T11** ⚠️ **Run `npm run typecheck:bos-llm` immediately after T10 and record its output verbatim in §8.** This is the gate for the `types.ts` ↔ `adminSettingsView.ts` pin; **a green `npm test` proves nothing** (FR-15, R-H6 — it bit slice 2 twice). Do not proceed to T12 on a jest-only signal.
- ✅ **T12** `AdminSidebar.tsx` description (FR-12).
- ✅ **T13** Tests R-T1 … R-T19, including the seed-derived fixture and its self-check, and FR-13's `source.guard` rule.
- ✅ **T14** Gates (§8) measured verbatim, plus the mutation matrix run and reverted.
- ✅ **T15** Documentation updates (§9), including FR-16's dated, unchecked slice-3 obligation and the two dated supersessions.
- ⬜ **T16** SA code review → QA → the user's own view of the screen → RM. *(Dev is done; this task is not Dev's to tick.)*

---

## 7. Tests

**Conventions carried from slice 2:** assertions live beside the property they protect; every load-bearing one is **mutation-proved**; the fixtures deliberately name models and temperatures (tests are outside the literal gate); source-level properties that no render can reach go in `source.guard.test.ts`.

### The seed-derived fixture

`tests/helpers/bos-llm-admin-fixtures.ts` gains `seedDerivedAreas()` — all **8 areas / 22 calls**, built by hand from `supabase/migrations/20261003_seed_bos_llm_area_settings.sql` read against `modelSettingsPolicy.ts:166-228` and the resolver's provenance rules, with a comment recording the derivation line by line. Verified distribution (**W-1**):

| Field | `call` | `area` | `default` |
|---|---|---|---|
| `model` | 5 — `chat/planner`, `chat/analysis`, `website/full_site`, `website/landing_page`, `intake/question_inference` | 17 | 0 |
| `temperature` | 4 — `insights/correlated_insight`, `insights/health_summary`, `website/testimonial_enhance`, `intake/question_inference` | 16 | 2 — `chat/planner` (locked 0), `images/image_generation` (not applicable) |

→ **42 of 44 resolve from the stored row · 9 carry `*` · 0 carry `c` · 35 carry no marker at all.** Per-card `N set per call`: chat 2, insights 2, website 3, intake 1, others 0.

**The fixture asserts its own shape first** (22 calls, 9 call-level rendered fields, 2 policy-locked temperatures, 0 configurable code defaults), so a mis-built fixture fails loudly instead of making AC-13 … AC-15 vacuous.

### The tests

| ID | Asserts | AC |
|---|---|---|
| **R-T1** | No `enabled` field, no `switch locked` chip, no `Cannot be switched off` chip on any of the eight cards, collapsed or expanded; `LOCK_AREA_NOT_SWITCHABLE` / `LOCK_CALL_NOT_SWITCHABLE` absent from the source | AC-1 |
| **R-T2** | A call with a rejected `provider` **and** a locked/non-switchable `enabled` renders **both** reasons, each **naming its field**, with the resolver's own `reason`. Parameterised over `provider_not_allowed`, `call_not_switchable`, `area_not_switchable`, `enabled_not_a_boolean`. A second case gives one issue on each of the five possible `field` values and asserts each renders **exactly once** — neither dropped nor doubled. Source half: the catch-all references `renderedFields`, and `CallRow.tsx` holds **no second array literal of field names** | AC-2 |
| **R-T3** | No `FailOpenNotice` renders and none of the five strings is in the source; the header carries the muted line with ***stored***, ***about 60 seconds***, ***falls back to … code***, ***on startup***, **ending `(runbook §5)`**; source half: the line is composed from the exported constant, with no inline propagation string anywhere in the screen | AC-3 |
| **R-T4** | `AreaCard` renders no `LedgerCheckPanel` (and does not import it); the component, `ledgerCheckCopy.ts`, the route and **all their tests** still exist and pass, including the eight-branch table and RC-D's neutral tone; the route header states it is not dead code | AC-4 |
| **R-T5** | No call row renders a `provider` field; the area header renders the provider **once**, on each of the eight areas | AC-5 |
| **R-T6** | Provider carries **no** marker in either place; and with a two-provider fixture area the header reads `varies by call` **and** the per-call field (with its issues) returns **for that area only** | AC-6, AC-7 |
| **R-T7** | `configuredEnabled: false` → `Configured: off` **verbatim** plus the caveat; an `on` area and the non-switchable area render no area chip. `calls.<n>.enabled: false` under an **on** area → the call chip **and** the roll-up; with nothing off, neither. **RC-4:** with the **area** off, the roll-up does **not** render. S2-T8's page-wide "never says an area is off" scan stays green over both chips | AC-9, AC-10 |
| **R-T8** | Against `seedDerivedAreas()`: **35 of 44** rendered fields carry no marker, and every one of the **42** stored-row fields renders its value without a `c` | AC-13 (as corrected, **W-1**) |
| **R-T9** | `c` renders **zero** times on the seed fixture; **never** where `lockedTemperature !== null` or `temperatureNotApplicable`; **does** render for a genuinely unconfigured configurable field; and **does** render — with the refusal reason beside it — for a *refused* configured value (RC-3's reachable state) | AC-14 |
| **R-T10** | `*` renders on exactly the **9** call-level fields of the seed fixture and on nothing else; the glyph is neither `i` nor `c`; **RC-1:** it is inside the label element and never adjacent to the value node | AC-15 |
| **R-T11** | Each marker exposes its full phrase to assistive tech (`sr-only`, glyph `aria-hidden`), appears in the legend, and carries the FR-6 `title`. **With every `title` stripped, the legend alone still conveys each marker.** The hover text is not a restatement of the legend label. The legend's `*` entry pairs no "code" word with a "database" word. The chip reads `N set per call`, renders only when `N > 0`, its `title` says `N` counts **calls**, and neither `N with a call override` nor `N on code defaults` appears in the source | AC-16, AC-17 |
| **R-T12** | Every call row is captioned `LLM code call name`; the identifier is still monospace and verbatim | AC-18 |
| **R-T13** | The chat card lists **six** calls — two configurable, four muted, non-editable, with **no value fields and no markers** — the count chip reads `6 calls`, and each excluded call carries the reason. The four names and the reason arrive **in the payload**; the reason equals the exported policy constant on both sides | AC-19 |
| **R-T14** | The other seven areas carry no excluded calls and render exactly as before (count chips unchanged) | AC-20 |
| **R-T15** | The subtitle is the new string (pinned for the first time) | AC-21 |
| **R-T16** | `AdminSidebar` describes the page as `'Models & temperatures'`, asserted alongside href and ordering | AC-22 |
| **R-T17** | The screen's `source.guard` has a provider-name rule; it carries a `mustMatch` sample **asserted to match**; a planted `provider !== 'openai'` in a screen file turns it red | AC-8 |
| **R-T18** | **C-6, unchanged:** the planner's locked temperature and the image call's "not applicable" still render their reasons **as text**, not tooltip-only — now the only carrier of "code-owned by policy" | AC-12 |
| **R-T19** | **W-7:** the parked panel still renders `PROPAGATION_NOTE` in full, so its ledger-specific clause stays under test while unmounted | FR-20 / C-2 |

### Mutations to run (each reverted; suite green at rest)

| Mutation | Must fail |
|---|---|
| Restore the hand-written `['enabled','provider','model','temperature']` in `CallRow` | R-T2 |
| Drop `aria-hidden` (or the `sr-only` span) from `Marker` | R-T11 |
| Widen the roll-up to render when the area is off | R-T7 (RC-4) |
| `providers.size > 1` → `provider !== 'openai'` | R-T17 **and** R-T6 |
| Re-type the propagation clause inline in `page.tsx` | R-T3 (source half) |
| Render `c` for a policy-locked temperature | R-T9 |
| Re-type the exclusion reason in `adminSettingsView.ts` instead of importing it | R-T13 |
| Move the `*` from the label to the value | R-T10 (RC-1) |

---

## 8. Gates and verification

**Measured verbatim on the feature branch, 2026-09-24.** Every row below was run after the last code change and with the mutation matrix fully reverted.

| Gate | Baseline (`main` @ `a34f2572`) | After | Verdict |
|---|---|---|---|
| `npm run typecheck:bos-llm` | `234 files in scope, 28 errors, 0 new` | `234 files in scope, 28 errors, 0 new` | ✅ **0 new, baseline untouched.** Run at **T11**, before T12, exactly as FR-15 requires |
| `npm run check:bos-llm-literals -- --list` | `43 files in scope, 2 exempt, 1 included by name` | `43 files in scope, 2 exempt, 1 included by name` | ✅ **Identical.** No new exemption, no new inclusion — the three new screen files import nothing from the catalog |
| `npm run lint:hooks` | clean | clean | ✅ exit 0 |
| `npm run build` | ✓ Compiled successfully | ✓ Compiled successfully; `ƒ /admin/business-os-llm 5.44 kB / 93.3 kB` | ✅ exit 0, still **dynamic** in the route table |
| `npx eslint <touched files>` | 3 errors / 6 warnings, **all pre-existing** (two `require()`-style imports in the two route test files; 3 unused-import/`any` warnings in `AdminSidebar.tsx`; 2 unused `eslint-disable` directives in `modelSettingsPolicy.test.ts`) | **0 errors**, 5 warnings — **every one of them pre-existing**, verified line-for-line against `git show HEAD:` | ✅ exit 0, nothing new introduced |
| jest — `app/admin/business-os-llm`, `app/admin/components`, `app/api/admin/business-os/llm-settings`, `lib/business-os/llm/__tests__` | 25 suites / **547 tests** | 25 suites / **639 tests** (+92) | ✅ all green |
| jest — the required `admin-authz-surface` guard | 74 tests | 74 tests | ✅ untouched and green |
| **All of the above in one run** | — | **26 suites / 713 tests, 0 failures** | ✅ green at rest |
| Mutation matrix | — | **10 of 10 turned a named test red** (§8.2) | ✅ |

**⚠️ `npm run lint` was NOT run** (W-9: `"lint": "next lint"` under Next 14 does not read the flat config at `eslint.config.mjs` and drops into an interactive setup prompt). `npx eslint` was used instead, and the baseline was taken from `git show HEAD:` rather than asserted — this row was claimed wrongly once before (QA DEF-S2-6).

### 8.1 The typecheck gate, proved rather than asserted (FR-15 / AC-23)

§ FR-15 says *"a green `npm test` proves nothing"*. That was verified, not taken on trust, by running two mutations against the `types.ts` ↔ `adminSettingsView.ts` pin:

| Mutation | `npm run typecheck:bos-llm` | jest on the **same** file |
|---|---|---|
| Drop `excludedCalls` from the **client** `AreaView` | exit **0**, `0 new` | PASS 2/2 |
| Drop `excludedCalls` from the **server** `AreaView` | exit **1** — `35 errors, 7 new`, `adminSettingsView.wireTypes.test.ts(39,64): error TS2344` | **PASS 2/2** |

Two findings, both worth carrying forward:

1. **The gate does bite, and jest cannot see it.** The second row is FR-15 demonstrated: the gate names the file and the line while the suite over that very file stays green.
2. ⚠️ **The `AreaView` pin is one-directional, and that is a real (small) gap.** `Satisfies<ClientAreaView, ServerAreaView>` asserts the server type is assignable to the client's, so **removing** a field from the *client* type leaves the server with a harmless extra property and the gate stays green (row 1). Only `LastChangedBy` is pinned in both directions. The consequence is bounded — a client-side deletion cannot break the payload, only the screen's own typing, and the render tests would notice anything that mattered — but it is not what the header claims. **Raised for SA rather than fixed here.**

> #### ⚠️ Correction — CR-2, 2026-09-24 (SA ruling; the sentence above this box is superseded)
>
> **The claim that "adding the reverse `Satisfies<ServerAreaView, ClientAreaView>` is one line" was wrong, and the cost analysis attached to it was not the binding objection.**
>
> | Claimed | Actually |
> |---|---|
> | It is one line, declined because it would make every future server-only field a gate failure | **It is a line that does not compile today**, for a reason that has nothing to do with `excludedCalls`: the two `AreaView`s have identical *key sets* and deliberately different *types*. The client widens `area: string` against the server's `BosLlmArea`, and `SettingIssue[]` against `BosLlmSettingIssue[]`, precisely because FR-6 forbids it importing the union. `string` is not assignable to `BosLlmArea`, so the reverse assertion errors on arrival. **Mutual assignability is unavailable here by design.** A future reader who took the suggestion at face value would have hit a failure this document did not predict. |
>
> **The ruling, recorded (SA §14 item 1):**
>
> 1. **Keep the pin as it is. Do not add the reverse `Satisfies`.**
> 2. **The gap is smaller than the paragraph above implies.** Per **W-8** the screen's own types gate nothing anyway, so a field deleted from the *client* type is not even a build failure — the payload still carries it and the page still renders it. It is a **documentation** defect, not a data-path one.
> 3. **`types.ts`'s header does not overclaim** — it names the direction that exists (*"fails with `TS2344` when the **server's** `AreaView` stops satisfying the type below"*). The loose claim is the **test's own name**, `'AreaView is assignable, field for field'`, in `adminSettingsView.wireTypes.test.ts` — a file **outside this diff**, left alone deliberately.
> 4. **If a two-way pin is ever wanted it is a key-set pin, not an assignability pin** — something of the shape `[keyof Client, keyof Server] extends [keyof Server, keyof Client]`, which catches a deletion on either side without forcing the client to narrow the two fields it widens on purpose. That belongs in the workplan of whichever slice next touches `types.ts` (the density slice, or slice 3), **not** in this one.
>
> **One consequence did land in code this round.** QA turned the same gap into a concrete render path (**EDGE-1**): a payload without `excludedCalls` blanked the whole page. `AreaCard` now reads it through one tolerant binding, and a render test deletes the field at runtime — because the gate, the build and jest are all blind to it (see [§15](#15-the-final-fix-pass--cr-1-cr-2-bug-1-edge-1)).

### 8.2 The mutation matrix — run and reverted, each naming the test it turned red

| # | Mutation | Test that failed |
|---|---|---|
| M1 | Restore the hand-written `['enabled','provider','model','temperature']` in `CallRow` | **8 red**, incl. `RC-9 › CallRow.tsx holds no array literal of field names`, `RC-9 › the catch-all is derived from the rendered-field list`, and `R-T2 › renders provider_not_allowed, naming its field` |
| M2 | Drop `aria-hidden` and the `sr-only` span from `Marker` | `R-T11 › exposes the whole phrase to assistive technology and hides the glyph from it` |
| M3a | Widen the roll-up to render when the area is off (**RC-4**) | `R-T7 › says it once, at area level, when the area itself is off` |
| M3b | Drop the `areaShowsOff` guard from the **per-call** chip (**RC-6**) | `R-T7 › says it once, at area level, when the area itself is off` |
| M4 | `providers.size > 1` → `provider !== 'openai'` (**FR-13**) | `R-T17 › AreaCard.tsx names no provider` |
| M5 | Re-type the propagation clause inline in `page.tsx` (**R-D**) | `R-T3 (source half) › the propagation clause is composed, never re-typed` — `occurrences: 1` where 0 is required |
| M6 | Render `c` for a policy-locked temperature (**R-E**) | `R-T9 › never renders on a policy-locked or not-applicable temperature` |
| M7 | Re-type the exclusion reason in `adminSettingsView.ts` (**FR-14**) | `R-T13 › puts the POLICY's constant on the wire, not a copy of it` |
| M8 | Move the `*` from the label to the value (**RC-1**) | `R-T10 › sits inside the field LABEL and never beside the value` |
| **M9** | **A third entry in `MARKED_FIELDS` with no matching body (RC-9's ninth)** | **2 red** — a `TypeError` from `FIELD_BODIES[field](call)`, failing `R-T8 › leaves 35 of 44 rendered fields unmarked` and `S2-T5 › says an area with no stored row runs on code defaults`. **The body `Record` is a loud runtime throw, exactly as SA said** |

Every mutation was reverted from an in-memory backup (never `git checkout` — the whole feature is uncommitted), and the suite is green at rest afterwards.

**One harness change, recorded because it is in the diff:** three of the tests that walk all **eight** cards exceeded jest's 5 s default timeout under a parallel run (so did an unrelated `app/admin/audit-trail` suite in the same run — it is a load flake on this machine, not a property of the page). `expandCard` now uses `fireEvent.click` rather than `userEvent.click` — the toggle is a plain `onClick`, so the pointer sequence bought nothing — and the twelve tests that open every card carry an explicit `EIGHT_CARDS` (30 s) timeout. **The mutation matrix was re-run afterwards and is still all-red**, so the speed-up did not soften anything.

**M5, recorded honestly:** the first attempt wrapped the re-typed sentence across two source lines, so the rule's regex could not see it and the mutation survived. **That was a malformed mutation, not a weak rule** — re-run as a single-line inline string it turned the assertion red immediately. Noted because "the mutation survived" and "the rule is dead" look identical in a summary table, which is the failure mode this file's own history is about.

> ### ⚠️ Superseded — CR-1, 2026-09-24 (SA overturned this conclusion)
>
> **The wrapped mutation was the realistic one, and the rule had a genuine hole.** Every multi-clause string in `copy.ts` — `PAGE_STANDING_NOTE`, `AREA_OFF_CAVEAT`, `CALL_OFF_TITLE`, `READ_ONLY_NOTE` and `PROPAGATION_NOTE` itself — is authored as wrapped `'…' + '…'`, so a developer re-typing that prose would wrap it exactly as the first attempt did. The disclosure was right; **the conclusion drawn from it was wrong**.
>
> SA's decisive point: of the three rules in `source.guard.test.ts`, the propagation rule was **the only one with neither a `mustMatch` sample nor a planted rejection** — which contradicts the doctrine stated at the top of that same file in this same diff. Fixed under CR-1, and **it was not the only rule with that hole**: re-running the matrix afterwards found **M7 surviving for the same reason**. See [§15](#15-the-final-fix-pass--cr-1-cr-2-bug-1-edge-1).
>
> **The reporting convention stands and should continue** (SA, explicitly): writing down that a mutation survived, and why, is the behaviour this file's history asks for.

#### The original gate table, for reference

| Gate | Requirement |
|---|---|
| `npm run typecheck:bos-llm` | **0 new**, baseline unchanged. **Run at T11, before anything else** — this is the only gate that can see a `types.ts` ↔ `adminSettingsView.ts` divergence (FR-15) |
| `npm run check:bos-llm-literals` | passes, **no new exemption and no new inclusion**; `--list` output recorded and compared against slice 2's (`43 in scope, 2 exempt, 1 included by name`) |
| `npm run lint:hooks` | clean, exit 0 |
| `npm run build` | `✓ Compiled successfully`, exit 0; `/admin/business-os-llm` still dynamic in the route table |
| `npx eslint <every touched file>` | exit 0. **Not `npm run lint`** — broken repo-wide (**W-9**), and this row was claimed wrongly once before (QA DEF-S2-6) |
| jest, touched paths | `app/admin/business-os-llm`, `app/admin/components`, `app/api/admin/business-os/llm-settings`, `lib/business-os/llm/__tests__`, **plus** the required `admin-authz-surface.guard` suite |
| Mutation matrix | All eight run and reverted, each naming the test that failed |

**Not run, deliberately:** `npm run lint` (W-9), any `bos:llm-settings set` command, and any migration. The two `get` commands in §1 were the only script invocations of this cycle.

---

## 9. Documents to update on completion

| Document | Change |
|---|---|
| [BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_REQUIREMENT.md) | **(a)** FR-16 / R-A condition 3 — a dated, **unchecked** obligation under **FR-17 (`:167`) and AC-16 (`:247`)**: *"slice 3 restores the banner, the inline sentence and the FR-15 confirmation sentence in the same change that puts a control on the page."* **(b)** **AC-4 (`:231`) superseded** with a dated note naming this round — old text left visible, never silently edited (R-B condition 1). **(c)** Change-History rows for C-1, C-3, C-5, C-6, C-7, C-8 |
| [BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md](/docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md) §5 | The slice-2 file table (deleted / parked files), the parked panel, and **S2-T3 (`:647`) superseded** with the same dated note. S2-T3's second half (`temperature: undefined` → *"not set — the provider default applies"*) is **unaffected and keeps biting** |
| [BUSINESS_OS_LLM_ADMIN_SCREEN_REFINEMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_ADMIN_SCREEN_REFINEMENTS_REQUIREMENT.md) | Q-5 closed with §1's two measured results |
| [runbook](/docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md) | **No change** — §4 already describes the switch as a script operation, which is now also what the screen implies |
| `CLAUDE.md`, the memory file | **No change by Dev.** Any memory update is the user's or TL's |

---

## 10. `console.*` in touched files

CLAUDE.md's logging rule binds every file this round opens. **Measured on `main` at `a34f2572`:**

| File | `console.*` |
|---|---|
| Every file under `app/admin/business-os-llm/` | **0** (and `source.guard` asserts it, per file, on a walked list) |
| `lib/business-os/llm/modelSettingsPolicy.ts` | **0** |
| `lib/business-os/llm/adminSettingsView.ts` | **0** (Pino via `createLogger`) |
| `app/api/admin/business-os/llm-settings/ledger/route.ts` | **0** |
| `app/admin/components/AdminSidebar.tsx` | **0** |

**Nothing to flag and nothing to convert.** `app/admin/system-config/page.tsx` (20 `console.*`) is **not** touched — D-U1 from slice 2 stands, and `nav.test.ts` asserts it carries no link to this screen.

---

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| **R-1** | **The issue-filter fix is the one change that can silently lose information.** A subtle slip re-creates F-6 somewhere new. | One list, used twice, in one expression ([D-1](#d-1--one-constant-drives-both-the-render-and-the-catch-all-r-c)); a source assertion that there is no second array literal; a render test that every issue field appears exactly once; a mutation proof. **W-8** is why this is not left to the type system. |
| **R-2** | **The seed-derived fixture is hand-built, so a wrong number would make AC-13 … AC-15 vacuously green.** | The fixture asserts its **own** distribution before any AC uses it, and §1's production reads confirm the two production-dependent rows match the seed. |
| **R-3** | **Parking the panel breaks S2-T11 in a way that looks like a regression.** | Declared in **W-7**: S2-T11 is re-pointed at the header and a new panel-level assertion (R-T19) keeps the ledger clause under test. |
| **R-4** | **`next build` and jest both ignore TypeScript errors in the screen** (W-8), so a broken `Record` or union in `CallRow` ships green. | The only cross-boundary type is pinned by `typecheck:bos-llm` (T11); everything inside the screen is pinned by render tests rather than by types. |
| **R-5** | **Deleting `FailOpenNotice.tsx` removes a component three review rounds hardened.** | FR-17's obligation is *"beside every switch"* and there is no switch — SA ruled it **vacuous, not violated**. The residual truth survives in `PAGE_STANDING_NOTE`, and FR-16 records the slice-3 restoration **in the approved requirement**, not only in a code comment. |
| **R-6** | **FR-9's reason sentence names "chat's area switch" inside a generic server constant.** All four excluded calls are chat's today, but the sentence would be wrong if another area ever excluded one. | Flagged, not changed — the wording is requirement-specified. The *derivation* is already generic (**W-5**), so only the sentence would need an edit. Noted in case SA prefers "the area's switch". |

---

## 12. Questions for SA

None of these blocks implementation; each has a recommended answer I will take if SA does not rule otherwise.

| # | Question | Recommendation |
|---|---|---|
| **Q-SA-1** | **RC-2 pins "existing `overrideCount()` semantics", but that function also counts `enabled` and `provider` provenance — fields that will no longer show a marker (W-2).** Keep the literal semantics, or narrow the fields while keeping the *calls* semantics? | **Narrow** ([D-4](#d-4--n-set-per-call-counts-calls-that-carry-a-visible-marker-rc-2)). RC-2's concern was calls-vs-fields, which is preserved; the narrowing makes the chip exactly the roll-up of the visible `*`s and **changes no number on any card today**. |
| **Q-SA-2** | **AC-13's "42 of 44 unmarked" double-counts: the 9 `*` fields are a subset of the 42 stored-row fields (W-1).** | Assert **"42 of 44 resolve from the stored row; 35 of 44 carry no marker"**. Scheme unchanged; arithmetic corrected. |
| **Q-SA-3** | **RC-2's suggested `c` legend string (`nothing is stored for this field`) is the exact phrase RC-3 rules false (W-3).** | Use **`c code default — no stored value is in force for this field`**: one noun (RC-2) **and** true in the refusal state (RC-3). |
| **Q-SA-4** | **Re-using `PROPAGATION_CLAUSE` verbatim (R-D) forces the plural and therefore re-orders FR-5's quoted sentence** ([D-7](#d-7--propagation_note-keeps-one-source-r-d)). | Take the re-ordered line: all four load-bearing elements survive, it still ends `(runbook §5)`, and R-D's single-source property is kept without re-typing the clause. |
| **Q-SA-5** | **Does the `varies by call` path also keep the area's provider line, or show only the per-call fields?** | Show both — the header states `provider varies by call` and each row carries its own, mirroring how `areaModelSummary()` already handles a varying model. |

---

## SA Review Notes

**Reviewed by SA — 2026-09-24 (Phase 1, workplan)**
**Status:** 🔄 **Approve with changes (binding).** The plan is correct, the nine code-reality findings hold, and all three questions referred to me are answered in Dev's favour. Seven conditions (**RC-5 … RC-11**) fold in the same way RC-1…RC-4 did — Dev applies them, QA asserts them, **no second SA workplan pass**. Implementation may start on T1 as soon as RM has cut the branch; RC-5…RC-11 are verified at code review.

**Verified against the tree at `a34f2572`, not against the workplan's summary.** Files read: `app/admin/business-os-llm/{page,copy,types,format}.ts(x)`, `components/{AreaCard,CallRow,LedgerCheckPanel,Chip,StoredRowPanel}.tsx`, all five `__tests__/`, `tests/helpers/{bos-llm-admin-fixtures,bos-llm-literal-rules}.ts`, `lib/business-os/llm/{modelSettings,modelSettingsPolicy,adminSettingsView}.ts`, `supabase/migrations/20261003_seed_bos_llm_area_settings.sql`, `scripts/typecheck-bos-llm.ts`, `app/admin/components/AdminSidebar.tsx`, `next.config.js`, `package.json`.

**W-1 … W-9 all confirmed in the tree**, including the three I had not previously checked myself: the count chip carries no `testId` and nothing asserts its text (W-6 ✓); `PROPAGATION_NOTE` has exactly two references, both in `LedgerCheckPanel.tsx`, and `ledgerPanel.render.test.tsx` never mentions it (W-7 ✓); `"lint": "next lint"` with a flat config at `eslint.config.mjs` (W-9 ✓ — and the CLAUDE.md line saying `.js` is indeed wrong; do not "fix" CLAUDE.md in this round, it is the user's file).

---

### Q-5 — pre-implementation check: ✅ **closed, condition discharged**

Both `get` commands ran against production, both flags are `true`, both off-state chips render zero times today, and both rows took the seed's fallback values. That is exactly what I asked for and it closes the condition in full. Two consequences I confirm:

1. "Renders zero times today" is now a **measured fact** and may go in the PR description.
2. The seed-derived fixture is now **corroborated against production for the only two areas whose values could have differed** (`chat`, `leads`) — which is what makes R-2's mitigation real rather than circular. Note the corroboration covers the *values*; the **levels** (which is all the marker scheme depends on) were already deterministic from the key structure, as R-E established. Both halves now hold.

---

### Rulings on the three questions

#### Q-SA-2 / W-1 — AC-13's arithmetic — ✅ **Dev is right. AC-13 is corrected as proposed.**

I re-derived the distribution independently, field by field, from the seed against `modelSettingsPolicy.ts:166-228` and `modelSettings.ts:596-691`. I get the same numbers:

| | `call` | `area` | `default` |
|---|---|---|---|
| `model` | 5 — `chat/planner`, `chat/analysis`, `website/full_site`, `website/landing_page`, `intake/question_inference` | 17 | 0 |
| `temperature` | 4 — `insights/correlated_insight`, `insights/health_summary`, `website/testimonial_enhance`, `intake/question_inference` | 16 | 2 (`chat/planner` locked 0, `images/image_generation` not applicable) |

22 calls × 2 rendered fields = **44**. Stored-row = 22 + 20 = **42**. `*` = 5 + 4 = **9**, and those 9 are a **subset** of the 42. `c` = **0**. Unmarked = (42 − 9) + 2 = **35**.

**The error is mine, not BA's and not the scheme's.** My R-E table listed "42 of 44" and "9" in adjacent rows of a *treatment* table, and the AC then read them as disjoint populations. The marker scheme is unchanged and correct.

**Ruling:** AC-13 is restated as **"42 of 44 rendered fields resolve from the stored row and none of them renders a `c`; 35 of 44 carry no marker at all"**. R-T8 as drafted asserts exactly that and is approved. Record the correction in the requirement's Change History when §9 is updated (it is a correction to *my* AC, so it is not a silent BA edit).

#### Q-SA-1 / W-2 — `overrideCount()`'s field scope — ✅ **Narrow it. I am overruling my own literal wording in RC-2.**

RC-2's phrase *"the existing `overrideCount()` semantics"* was shorthand for **calls, not fields**, which is the ambiguity the chip sits next to (`2 set per call` beside `2 calls`). It was not an instruction to keep counting `enabled` and `provider` provenance, and W-2 is right that doing so would produce a count with no visible referent.

I checked that the divergence is not merely theoretical. Today it changes nothing (chat 2, insights 2, website 3, intake 1, rest 0 under either definition — I verified `chat/analysis` is the only call with `enabled: 'call'`, and no call anywhere carries a call-level `provider`). But the divergence is **reachable by the documented emergency path**: `set <area> --enabled false --include-calls` writes `enabled: false` into *every* call override (`scripts/bos-llm-settings.ts:294-303`), after which the literal definition would report `8 set per call` on the website card with **zero `*` markers on screen**. On the one page whose entire purpose this round is to stop it saying things it cannot show, that is disqualifying.

**Ruling:** D-4 is approved. `callsSetPerCall` counts **calls** for which any **marker-bearing** field carries `provenance === 'call'`. See **RC-9** for the one naming constraint on the constant it reads.

#### Q-SA-3 / W-3 — RC-2 vs RC-3 — ✅ **Dev's single string satisfies both. Approved.**

`c code default — no stored value is in force for this field` uses *stored* in both legend entries (RC-2 met: one noun), and *"in force"* is true both when nothing is configured and when a configured value was refused (RC-3 met). W-4's observation is also correct and I confirm the S1-8 half (`modelSettings.ts:641-650`) — moot on the page since provider carries no marker, but it is the right reason not to say "nothing is stored".

**But the hover text Dev drafted is not yet true.** See **RC-5** — there is a third reachable path to `provenance === 'default'` with a stored value, and in that one the value was not *refused*.

---

### Rulings on the two declared deviations

#### Deviation 1 — FR-5's line re-ordered (Q-SA-4) — 🔄 **Substance approved; the ordering is not. One change.**

I checked this against R-A rather than taking it on trust, because I hardened that line myself.

Dev's line carries all four load-bearing elements — ***stored*** ("These are the stored settings"), ***about 60 seconds***, ***falls back to … in code***, ***on startup*** — and ends `(runbook §5)`. R-A condition 2 and AC-3 are therefore satisfied **literally**. The addition *"not what the fleet is doing"* is not in FR-5's quote and is an improvement: it makes the stored-vs-fleet distinction explicit, which is the thing R-A was protecting.

**But the stated reason for the re-ordering is wrong, and the re-ordering is not forced.** `PROPAGATION_NOTE` already reads *"Running instances pick a change up within about 60 seconds."* — the plural is in the existing constant (`copy.ts:161-163`), and S2-T11 already asserts it verbatim. The plural constrains the clause's **neighbours**, not the sentence **order**. This composes, reuses `PROPAGATION_CLAUSE` byte-for-byte, keeps FR-5's lead, and still ends with the pointer:

> `These are the stored settings, not what the fleet is doing. ${PROPAGATION_CLAUSE}, and an instance that cannot read them on startup falls back to the values in code (runbook §5).`

(It also removes the number-agreement wobble in *"Running instances pick … and **one** that cannot read …"*.)

**Ruling — RC-10 (binding):** keep the stored-first ordering. *"These are the stored settings"* is the sentence's topic and the single claim the whole line exists to make; buried behind two clauses of propagation mechanics it is the clause the next copy edit trims. `PROPAGATION_CLAUSE` is still reused verbatim, so R-D's single-source property is untouched. Everything else in D-7 — the private clause constant, `PAGE_STANDING_NOTE` as a second **export**, `PROPAGATION_NOTE` byte-identical — is approved as drafted.

#### Deviation 2 — one assertion added to `ledgerPanel.render.test.tsx` — ✅ **Approved, and correctly reasoned.**

W-7 is right and I verified it: `PROPAGATION_NOTE`'s only rendered assertion is S2-T11 in `page.render.test.tsx:310-322`, reached through `getByTestId('ledger-panel')`. Parking the panel would leave the ledger-specific clause (*"The ledger check only starts counting after that"*) with no coverage at all — precisely the accident C-2/R-D exists to catch, one layer down. §12 of the requirement said the panel test "needs no edits"; that statement was made before the relocation was designed and is superseded by this finding.

**Approved as an addition only.** The rest of `ledgerPanel.render.test.tsx` — F-6's eight-branch table, RC-D's neutral-tone assertion — must be untouched, and R-T4 already asserts it still passes. §12's claim is corrected in the requirement's Change History when §9 is updated.

#### Q-SA-5 — the `varies by call` path — ✅ **Show both, as recommended.**

Mirrors `areaModelSummary()` and keeps the header answering "what does this area use" on every card. One consistency point: `areaModelSummary()` renders `varies by call (2)` with the count. Match that shape for the provider or deliberately do not, but say which in the code — R-T6's assertion should be a `toHaveTextContent('varies by call')` either way so it does not over-pin.

---

### New binding conditions (RC-5 … RC-11)

**RC-5 (correctness — the same class of defect RC-3 caught, one path further).**
There is a **third** reachable route to `provenance.temperature === 'default'` with a value in the row, and in it the value was neither absent nor refused. `modelSettings.ts:730-739`: after resolution, `if (temperature !== undefined && rejectsSamplingParameters(model))` drops the temperature and **forces `from.temperature = 'default'`**, pushing an issue of kind **`adjusted`** with reason `model_rejects_sampling_parameters`. It is reachable — `checkModel` only refuses a reasoning model when `policy.sendsSamplingPenalty || sendsLockedTemperature` (`:294`), so an o-series model configured for e.g. `insights/insight_content` is *accepted*, and its area temperature is then dropped.

- The **legend** string is already safe: *"no stored value is **in force**"* is true here too. No change.
- The **hover** is not. Dev's draft ends *"…the reason it was **refused** is shown on this field"*, which is false in this state. Reword the clause so it does not assert a mechanism — e.g. *"If the row does set one, the reason it is not in force is shown on this field."*
- **R-T9 gains a third case**: `provenance.temperature: 'default'` + an `adjusted` / `model_rejects_sampling_parameters` issue → `c` renders and the reason renders beside it.

**RC-6 (honesty — the per-call off chip inside an off area).**
D-5 guards the **roll-up** with `areaShowsOff` (RC-4) but leaves the **call chip** on the bare `!call.resolved.enabled`. Inside an off area that is not symmetric: a **locked** call always resolves `enabled: true` (`modelSettings.ts:703-707`), so with chat configured off the card would say `Configured: off` at area level, show an off chip on `analysis`, and show **none on `planner`** — reading as "planner is still running", which is false (the gate gets it at route entry). The mirror case is worse: a row with `calls.X.enabled: true` under an off area resolves that call `true`, so the card could show `Configured: off` beside a call with no off marker at all.

**Ruling:** when the area chip is showing off, it is the **only** off statement on the card — suppress the per-call chips *and* the roll-up under the same `areaShowsOff` guard. This is RC-4's own rationale applied to the sibling element, and it preserves in full the state R-H1 exists for (*area on, calls off*). R-T7 gains a case: an **off** area containing one locked and one switchable call renders **exactly one** off statement, at area level.

**RC-7 (FR-14 — one home means one *wording*, not two).**
Unflagged conflict: FR-9 quotes one sentence (*"Not configurable here — changing an embedding model invalidates every stored vector, so it is a data migration, not a setting. These calls keep the shared helpbot_embedding_model key, and chat's area switch still stops them."*) and the comment at `modelSettingsPolicy.ts:62-69` is a **different** sentence (*"The four chat embeddings keep the shared `helpbot_embedding_model` key: changing an embedding model invalidates every stored vector (the plan cache and the verified questions), so it is a data migration, not a setting. Chat's area switch still stops them, because the gate runs at chat route entry."*). D-9 says "the comment, promoted"; FR-14 says "the sentence, exported". Promoting one while leaving the other in place re-creates the drift FR-14 exists to prevent — in the same file.

**Ruling:** author the constant **once**, lead with FR-9's *"Not configurable here — "* (the screen needs that opening clause), and **replace** the prose of the `:62-69` comment with a pointer to the constant rather than leaving a second wording beside it. The constant's own doc block records that its text names *chat* specifically and must be revisited if a non-chat call is ever excluded — that is the durable form of R-6, which is otherwise only recorded in a risk table nobody will read.

**RC-8 (`READ_ONLY_NOTE` — stale-and-green, third instance).**
`READ_ONLY_NOTE` is in the requirement's §1 "not changing, verbatim" list, it is rendered at `AreaCard.tsx:154` **inside the same `<div className="space-y-2">` wrapper as `FailOpenNotice`/`area-lock-reason`** — both of which this round deletes — and **no test asserts it**. That is the same shape as the subtitle (FR-11) and the sidebar (FR-12), which Dev correctly caught. It must not be the one that gets emptied out with the wrapper.

**Ruling:** `READ_ONLY_NOTE` survives verbatim and ships **with its first assertion** in `page.render.test.tsx`, in the same style as R-T15.

**RC-9 (the R-C fix — the two things that make it real).**
D-1 is the right shape and I confirm it satisfies my "derive from one constant, no second list" ruling, including on the FR-8 `varies by call` path — because `renderedFields` is computed once and consumed twice in the same scope, so provider's field and provider's issues can only appear or disappear together. Two constraints on how it is proved:

1. **The source assertion must be proved against a planted violation, not only asserted on today's clean file.** `source.guard.test.ts`'s own history is exactly this failure — a rule that cannot match looks identical to a rule that found nothing (F-1, DEF-S2-1/2, and the two dead regexes in `bos-llm-literal-rules.ts`). The "no second array literal of field names in `CallRow.tsx`" assertion must be exercised against a synthetic source containing one, in the file, the way `firstStatementOfAdminLayout` is exercised against its four disabled layouts.
2. **The mutation matrix gains a ninth row:** add a third entry to `RENDERED_FIELDS` with no matching body → a render test must fail. This is what proves the **render** side is genuinely list-driven and not merely adjacent to the list. (Dev undersells the body `Record` in D-1's first bullet: a missing body is not "unenforced documentation" — it is a loud runtime throw in any test that exercises the field. That is a *better* guarantee than a type here, given `next.config.js` sets `ignoreBuildErrors: true` repo-wide and would not gate a type error even if the screen were in `typecheck:bos-llm`'s scope. Keep the `Record`; correct the framing.)

**Naming constraint (from Q-SA-1):** `RENDERED_FIELDS` now carries two jobs — the marker-bearing set (`callsSetPerCall`, `markerFor`) and the base of the per-render field list (which may gain `provider`, a field that must **never** take a marker, AC-6). Name it for the stronger property and document the provider exception **once**, at the constant, so the next person to add a rendered-but-unmarkable field does not add it to the constant and silently grant it a marker.

**RC-10 (FR-5's ordering).** As ruled above.

**RC-11 (`nav.test.ts` — scope the new assertion).** `nav.test.ts` is a source scan over the whole `AdminSidebar.tsx` string. A bare `toContain("'Models & temperatures'")` would pass if the string appeared on any of the other ~20 entries. Assert the description **in proximity to** `href: '/admin/business-os-llm'` (the file's existing `indexOf` + `slice` idiom already does this for ordering), and assert the old `'Models & Switches'` is **absent**.

---

### Assessment of the rest, as planned

| Item | Ruling |
|---|---|
| **W-8 / "types enforce nothing here"** | ✅ **Honest, correct, and sufficient — and Dev is right to have raised it.** I verified `next.config.js` sets both `ignoreBuildErrors` and `ignoreDuringBuilds`, so no type in this screen would gate anything even if `typecheck:bos-llm`'s import-graph scope reached it (it does not, by FR-6's design, and must not start to). The available *gating* mechanisms are jest assertions, the source scan and a runtime throw — all three are used. Given this is the second two-list drift in `CallRow.tsx`, the bar is **RC-9**: a negative case for the source rule and a ninth mutation. With those, I am satisfied; without them the property is asserted, not proved. |
| **R-C / D-1** | ✅ Satisfies the ruling, including the `varies by call` path. Subject to RC-9. |
| **RC-1 (D-2)** | ✅ Marker on the label, glyph `aria-hidden`, adjacent `sr-only`, not a `Chip`. The `Field` wrapper taking the marker as a **label** prop is the right structural carry into the density slice — that was the point of RC-1 and Dev has made it structural rather than remembered. |
| **RC-4 (D-5)** | ✅ One `areaShowsOff` guard, not a second copy of the condition. Now extended by **RC-6**. |
| **Parking the Ledger Check (D-8)** | ✅ All of C-8's conditions land: route header note where the sweep looks, `PARKED` header on the component, R-D's don't-render-it-twice obligation inside the `AreaCard` comment, no feature flag. |
| **`PROPAGATION_NOTE` relocation (D-7)** | ✅ Subject to RC-10. The private-clause + two-exports shape is exactly R-D. |
| **FR-9 / FR-14 payload (D-9)** | ✅ W-5 is the right finding and the generic derivation (`filter(isExcludedFromBosLlmSettings)`) is the correct shape — no `if (area === 'chat')` anywhere. Subject to RC-7. |
| **FR-11 / FR-12 (D-12)** | ✅ Both ship with their first assertion, which is the whole point. Subject to RC-11. |
| **FR-13 (D-10)** | ✅ Screen-scoped, `mustMatch` convention, `codeOf()` strips comments first. I checked the pattern against the tree: **no screen source file contains a quoted provider name today** (the only two are in `page.render.test.tsx`, which the walker excludes), so the rule is green on arrival and AC-8's "the same line passes silently today" is about the rule's absence, correctly. |
| **FR-15 / T11** | ✅ Correctly placed as a task with recorded output, immediately after T10 and before T12. This is the item that bit slice 2 twice; do not batch it into T14. |
| **The seed-derived fixture** | ✅ Numbers independently re-derived and correct (see Q-SA-2). The self-check-before-use discipline is the right answer to R-2 and is the reason AC-14's "zero `c`" is not vacuous. |
| **Test plan R-T1 … R-T19** | ✅ Covers every AC, plus the two additions. Gains three cases: RC-5 (R-T9), RC-6 (R-T7), RC-8. |
| **Mutation matrix** | ✅ Eight well-chosen mutations; each names the test it must turn red. Gains a ninth (RC-9). |
| **Gates (§8)** | ✅ Correct, including `npx eslint` over `npm run lint` (W-9 verified: `"lint": "next lint"`, flat config at `eslint.config.mjs`). Do **not** edit CLAUDE.md's wrong `.js` reference in this round — it is the user's file and a doc fix is not this diff's business; note it for TL instead. |
| **§9 documentation updates** | ✅ Dated supersessions with old text left visible (R-B condition 1), FR-16's unchecked obligation in the *approved requirement* (R-A condition 3), route header (C-8). Add two rows: the AC-13 arithmetic correction (Q-SA-2) and §12's superseded "panel test needs no edits" claim. |
| **§10 `console.*`** | ✅ Measured per file, zero everywhere, and the `system-config` D-U1 boundary is held. Nothing to convert; CLAUDE.md's logging rule is satisfied. |
| **Over-engineering** | None found. The body `Record`, the private clause constant and the `markers.ts` module each earn their place (see RC-9). No feature flag, no new dependency, no tooltip primitive, no new runtime pattern — CLAUDE.md rule 7 is respected. |
| **Anything unsanctioned** | Nothing. The three items not named in the requirement — the count chip's `testId`, `bosLlmExcludedCallNames()`, `PAGE_STANDING_NOTE` — are each *required* by a condition already ruled (C-7, FR-9/W-5, R-D) and are approved. |

---

### Points for the implementation (no new conditions; things the plan under-describes)

1. **`app/admin/business-os-llm/components/CallRow.tsx`** — deleting `PROVENANCE_LABEL`/`PROVENANCE_TITLE` also deletes the local `ProvenanceChip`, its `testId="provenance"` and the `ProvenanceLevel` import. The component is used nowhere else (I checked — `StoredRowPanel.tsx` does not use it), so nothing breaks. **Rewrite CallRow's file header doc block**: its first and third paragraphs describe the provenance chip and the disabled `enabled` checkbox as the design, and a stale header on the file at the centre of this round is how the next reader re-introduces both.
2. **`__tests__/page.render.test.tsx` § S2-T6** — the plan says "updated"; be explicit about what goes. Three of its four tests are invalidated, not edited: the `getByLabelText('planner enabled')).toBeDisabled()` assertion, the `LOCK_CALL_NOT_SWITCHABLE` lock-reason, the `Cannot be switched off` chip, the whole `area-lock-reason` block (both DEF-S2-4 tests) and the `fail-open-inline` test. What survives as R-T18 is **only** the two temperature lock texts — which under FR-6 are now the sole carrier of "code-owned by policy" (C-6), so state that in the test's own comment, not just in the workplan.
3. **`tests/helpers/bos-llm-admin-fixtures.ts`** — the `area()` factory needs `excludedCalls: []` in its defaults. TypeScript will not tell you; every existing render test will throw on `area.excludedCalls.length` instead. Loud, but avoidable.
4. **`AreaCard.tsx` count chip** — `area.calls.length + area.excludedCalls.length` must carry the singular/plural branch with it, and AC-20's "seven areas unchanged" is the assertion that catches an off-by-one there.
5. **`AreaCard.tsx` expanded wrapper** — the `<div className="space-y-2">` at `:143-155` loses both of its first two children. Do not let `READ_ONLY_NOTE` go with the wrapper (RC-8).
6. **The legend is one string with `·` separators in one element** — assert it with substring matching, not `getByText` on a fragment.
7. **`check:bos-llm-literals --list`** — compare against slice 2's recorded `43 in scope, 2 exempt, 1 included by name` **before** and **after**, and record both. The three new screen files import nothing from the catalog, so the number should not move; if it does, something imported a server module and the source guard's `FORBIDDEN_MODULES` assertion should have caught it first.
8. **R-6 / the exclusion reason naming chat** — RC-7 turns this from a risk-table line into a code-level obligation. Nothing else to change.

---

### Approval

- [x] **Workplan approved to proceed to implementation**, subject to RC-5 … RC-11 being folded in by Dev and asserted by QA.
- [x] **No second SA workplan pass.** These conditions are verified at the Phase 2 code review, in the same way RC-1…RC-4 are.
- [x] **Nothing here needs TL escalation.** The approach is sound; all three questions were correctly identified and correctly answered, and two of the three were errors in my own prior rulings rather than in Dev's plan.
- [ ] RC-5 — the `c` hover must not say "refused"; R-T9 gains the `model_rejects_sampling_parameters` case
- [ ] RC-6 — per-call off chips suppressed when the area chip is showing off; R-T7 gains the case
- [ ] RC-7 — the exclusion reason is authored once; the `:62-69` comment becomes a pointer, not a second wording
- [ ] RC-8 — `READ_ONLY_NOTE` survives verbatim and gains its first assertion
- [ ] RC-9 — the source rule is proved against a planted violation; a ninth mutation proves the render side is list-driven; the constant is named and documented for its marker role
- [ ] RC-10 — `PAGE_STANDING_NOTE` keeps FR-5's stored-first ordering while still composing `PROPAGATION_CLAUSE` verbatim
- [ ] RC-11 — `nav.test.ts`'s description assertion is scoped to this entry, and asserts the old string is gone

---

## 13. How RC-5 … RC-11 were satisfied

Each condition, where it landed, and what would turn red if it were undone.

| # | Condition | Where it landed | What proves it |
|---|---|---|---|
| **RC-5** | The `c` hover must be true on the **third** path to `provenance === 'default'` — a temperature dropped by `rejectsSamplingParameters` (`modelSettings.ts:730-739`), pushed as **`adjusted`**, which is *not* a refusal | `copy.ts` → `MARKER_TITLE.code`. The clause now reads **"If the row does set one, the reason it is **not in force** is shown on this field"**, and the third sentence was also softened to *"A value the guardrails **accept**, set in the area row (runbook §3), takes precedence"* — because "setting it takes precedence" is equally false in the refused and adjusted states. The doc block above the constant enumerates all three paths with line references | **R-T9 gained the third case**: a `provenance.temperature: 'default'` + `model_rejects_sampling_parameters` / `adjusted` fixture renders `c` **and** the reason beside it, and the test asserts the `title` **does not match `/refus/i`** and **does contain `not in force`**. The legend needed no change — *"no stored value is in force"* was already true here |
| **RC-6** | An off **area** must be the card's **only** off statement — a locked call always resolves `enabled: true` (`:703-707`), so an unguarded card marks `analysis` and leaves `planner` bare, reading as "planner is still running" | The **same** `areaShowsOff` guard now reaches both siblings: `AreaCard` computes it once, uses it for the roll-up (`offCalls = areaShowsOff ? 0 : …`) **and passes it to every `CallRow`**, where `showOffChip = !areaShowsOff && !call.resolved.enabled`. It is one binding, not two copies of one condition | **R-T7 gained the case SA specified**: an **off** chat area containing one locked (`planner`, `enabled: true`) and one switchable (`analysis`, `enabled: false`) call renders **exactly one** off statement — `state-chip` ×1, `call-state-chip` ×0, `calls-off-chip` absent. **Two** mutations prove it: M3a (widen the roll-up) and **M3b** (drop the guard from the chip), and both turn that one test red |
| **RC-7** | FR-9's quote and the `modelSettingsPolicy.ts:62-69` comment are two sentences for one fact. One home, one wording | `BOS_LLM_SETTINGS_EXCLUSION_REASON` is authored **once**, leads with FR-9's *"Not configurable here — "*, and carries the mechanism from the old comment. **The comment's prose is replaced by a pointer** (*"The reason is `BOS_LLM_SETTINGS_EXCLUSION_REASON` above — stated once, there, and never restated here"*). The constant's own doc block records that the text names **chat** specifically and **must be revisited if a non-chat call is ever excluded** — the durable form of R-6 | Three assertions in `modelSettingsPolicy.test.ts`: the constant's opening clause and four mechanism phrases; **`invalidates every stored vector` occurs exactly ONCE in the whole file**, and `The four chat embeddings keep the shared` is gone; and the R-6 note is present. On the wire, **M7** proves the view builder imports rather than re-types |
| **RC-8** | `READ_ONLY_NOTE` is unasserted and shares the `<div className="space-y-2">` being emptied at `AreaCard.tsx:143-155` | The wrapper is gone (both of its first two children were deleted). `READ_ONLY_NOTE` is rendered **directly**, verbatim, with a new `data-testid="read-only-note"` | **R-T15 ships its first assertion**, in the same style as the subtitle's: the note renders on **every one of the eight** expanded seed-derived cards, matched against the exported constant |
| **RC-9** | Prove the no-second-array rule **against a planted violation**, and add a ninth mutation | (a) `source.guard.test.ts` asserts the rule's regex matches **three** planted shapes before ever scanning the file: the original four-name array, the narrowed `['model','temperature']` the R-C ruling explicitly forbids, and `[...MARKED_FIELDS, 'provider']` — the form that would sneak it back in beside the constant. `CallRow.tsx` is then asserted clean, and the catch-all is asserted to reference `renderedFields` in the same scope. (b) **Naming constraint applied:** the constant is `MARKED_FIELDS`, named for the stronger property, and `UNMARKED_RENDERED_FIELD = 'provider'` sits beside it with the AC-6 exception documented **at the constant**; a source assertion reads the array literal and fails if `provider` or `enabled` appears inside it | **M9**: a third entry with no body is a `TypeError` from `FIELD_BODIES[field](call)` and turns two render tests red. **M1**: restoring the hand-written array turns **8** tests red across both halves. The framing in D-1 is corrected in the code comment — the `Record` is a **loud runtime throw**, not unenforced documentation |
| **RC-10** | Keep FR-5's stored-first ordering while still composing `PROPAGATION_CLAUSE` verbatim | `PAGE_STANDING_NOTE` = `'These are the stored settings, not what the fleet is doing. '` + `PROPAGATION_CLAUSE` + `', and an instance that cannot read them on startup falls back to the values in code (runbook §5).'` — SA's exact composition. `PROPAGATION_CLAUSE` stays **private**; `PROPAGATION_NOTE`'s rendered text is byte-identical to today's, so `LedgerCheckPanel` and its tests are untouched | **R-T3 asserts `text.indexOf('These are the stored settings') === 0`**, all four load-bearing elements, and that the line **ends** `(runbook §5).`. The source half asserts `PROPAGATION_CLAUSE` is declared and **not exported**, and that the clause's text occurs **exactly once** in `copy.ts` and **zero** times in every other screen file. **M5** proves it |
| **RC-11** | `nav.test.ts`'s description assertion must be proximity-scoped | The new test slices the sidebar from `href: '/admin/business-os-llm'` to the **next** `href: '` and asserts `description: 'Models & temperatures'` inside that slice — the file's own `indexOf` + `slice` idiom. It also asserts the old string is absent from the whole file, which is why `AdminSidebar.tsx`'s explanatory comment deliberately does **not** quote it | A bare `toContain` would pass if the string appeared on any of the ~20 other entries; this one cannot. `nav.test.ts` is green |

**SA's eight implementation points, all taken:** `CallRow`'s file header is rewritten (its first and third paragraphs described the provenance chip and the disabled checkbox as *the design*); `page.render.test.tsx`'s superseded S2-T6 assertions are **invalidated, not edited**, with only the two temperature lock texts surviving as **R-T18**, whose own comment states why C-6 now makes them load-bearing; the `area()` fixture factory gained `excludedCalls: []` with a comment explaining that TypeScript would *not* have told us; the count chip carries its singular/plural branch and AC-20 pins all seven other areas; `READ_ONLY_NOTE` did not go with the wrapper; the legend is asserted by substring, not `getByText`; `check:bos-llm-literals --list` is recorded **before and after** and did not move; and R-6 became a code-level obligation under RC-7.

**One deliberate deviation, declared:** the roll-up chip carries a singular branch (`1 call configured off`), not the literal `N calls configured off` for every N. SA required the **count** chip to carry its singular/plural branch, and rendering `1 calls` beside `1 call` on the same card would be the kind of small wrongness this round exists to remove. The wording is otherwise verbatim.

---

## 14. SA Review Notes — Phase 2 (code)

**Code Review by SA — 2026-09-24**
**Status:** ✅ **Code Approved for QA — conditional on CR-1 and CR-2 below, which are one test edit and one doc correction.** Neither re-opens a cycle and neither needs a second SA pass; QA asserts them.

**Reviewed against the working tree on `feature/business-os-llm-admin-screen-refinements`, diffed against `a34f2572`, not against §13's narrative.** Files read in full: `markers.ts`, `components/{Marker,ExcludedCallRow,CallRow,AreaCard}.tsx`, `copy.ts`, `types.ts`, `page.tsx`, `components/LedgerCheckPanel.tsx` (header), `app/api/admin/business-os/llm-settings/ledger/route.ts` (header), `AdminSidebar.tsx`, `lib/business-os/llm/{modelSettingsPolicy,adminSettingsView}.ts`, `lib/business-os/llm/__tests__/{adminSettingsView,modelSettingsPolicy,adminSettingsView.wireTypes}.test.ts`, all five screen `__tests__/`, `tests/helpers/bos-llm-admin-fixtures.ts`, and `modelSettings.ts:580-745` for the RC-5 path.

**I made no code changes.** Everything in this diff is Dev's, plus whatever CR-1/CR-2 add.

### Gates re-measured by SA, independently

| Gate | SA's own run | Dev's claim | Verdict |
|---|---|---|---|
| `npm run typecheck:bos-llm` | `234 files in scope, 28 errors, 0 new (118.2s)` · `passed` | 234 / 28 / 0 new | ✅ matches |
| `npm run check:bos-llm-literals -- --list` | `43 files in scope, 2 exempt, 1 included by name` | identical to baseline | ✅ matches. The new `BOS_LLM_SETTINGS_EXCLUSION_REASON` puts `helpbot_embedding_model` into a **string** where it was a comment, and it does not trip a rule — checked, because `codeOf()` previously hid it |
| `npm run lint:hooks` | exit 0 | clean | ✅ matches |
| `npx eslint` over every touched file | **0 errors, 5 warnings** (2 unused icons + 1 `icon: any` in `AdminSidebar.tsx`, 2 unused disable directives in `modelSettingsPolicy.test.ts`) | 0 errors / 5 pre-existing | ✅ matches, and all five are pre-existing |
| jest — the four touched paths | **25 suites / 639 tests / 0 failures** (62s) | 25 / 639 (+92 from 547) | ✅ matches |
| `npm run build` | **not re-run by SA** — typecheck, lint and the suite all pass, and `next.config.js` ignores TS errors, so the build adds no signal I do not already have | ✓ Compiled | ⬜ accepted on Dev's measurement |

`typecheck:bos-llm` also prints *"1 baseline entry is fixed; consider --update-baseline"* against `app/api/onboarding/build/route.ts` — an unrelated file, not in this diff, pre-existing. **Do not fold a `--update-baseline` into this commit**; it is a separate chore.

---

### Rulings on the seven items referred to me

#### 1 · The one-directional `AreaView` pin (§8.1) — ✅ **Finding accepted and correct; the proposed fix is rejected because it cannot compile. Do not add it.**

The diagnosis is right and the evidence is the right kind: `adminSettingsView.wireTypes.test.ts:39` is `Satisfies<ClientAreaView, ServerAreaView>` and nothing else, while `LastChangedBy` carries both directions at `:40-42`. A field deleted from the **client** type leaves the server with a harmless excess property and the gate stays green. Confirmed by reading the file, not by re-running the mutation.

**But `Satisfies<ServerAreaView, ClientAreaView>` is not "one line" — it is a line that fails today, for a reason that has nothing to do with `excludedCalls`.** The two `AreaView`s have identical *key sets* and deliberately different *types*: the server has `area: BosLlmArea` and `areaIssues: BosLlmSettingIssue[]`; the client widens both (`area: string`, `areaIssues: SettingIssue[]`) precisely because FR-6 forbids it importing the union. `string` is not assignable to `BosLlmArea`, so the reverse assertion errors on arrival and a future reader who takes §8.1's suggestion hits a failure the workplan did not predict.

So Dev's cost analysis ("every future server-only field becomes a gate failure") is not the binding objection; the binding objection is that mutual assignability is **unavailable by design** here.

**Ruling:**
- **Keep the pin as it is.** The consequence really is bounded, and it is smaller than §8.1 claims: per W-8 the screen's own types gate nothing anyway, so a client-side deletion is not even a build failure — the payload still carries the field and the page still renders it. It is a documentation defect, not a data-path one.
- **`types.ts`'s header does not overclaim** — it says the gate *"fails with `TS2344` when the **server's** `AreaView` stops satisfying the type below"*, which is exactly and only the direction that exists. The loose claim is the **test's own name**, `'AreaView is assignable, field for field'`, which reads as exhaustive. `wireTypes.test.ts` is **not in this diff** and I am not asking Dev to open it for a title.
- **If a two-way pin is ever wanted, it is a key-set pin, not an assignability pin** — something of the shape `[keyof Client, keyof Server] extends [keyof Server, keyof Client]` — which catches a deletion on either side without forcing the client to narrow the two fields it widens on purpose. That is a decision for the slice that next touches `types.ts` (the density slice or slice 3), and it belongs in that workplan, not this one. **CR-2** records it.

#### 2 · M5, and whether a multi-line re-type is a real hole — 🔄 **It is a real hole. The rule is sound for the mutation Dev eventually ran and unsound for the one a developer would actually write. Fix it (CR-1).**

The rule is `source.guard.test.ts` → *"the propagation clause is composed, never re-typed"*: it counts `/pick a change up within about 60 seconds/g` over the **raw** source of every screen file and requires exactly 1 in `copy.ts`, 0 elsewhere. A single-line inline copy is caught. A copy wrapped across two concatenated string literals — which is **the dominant style in the very file the clause lives in**; `PAGE_STANDING_NOTE`, `AREA_OFF_CAVEAT`, `CALL_OFF_TITLE`, `READ_ONLY_NOTE` and `PROPAGATION_NOTE` are every one of them written as wrapped `'…' + '…'` — is invisible to it. Dev's first mutation was not malformed; it was the realistic one.

Two things make this **Medium and not High**:
1. There is a detective backstop. R-T3's render half asserts `toHaveTextContent(PAGE_STANDING_NOTE)`, so an inline copy that has **drifted** in wording turns that test red at the moment it drifts. What the source rule uniquely prevents is the *byte-identical* inline copy — the state in which the drift is merely scheduled.
2. Nothing today is broken.

But the reason to fix it is this file's own doctrine, which Dev wrote at the top of it in this diff: *"each rule below carries a sample it is asserted to match, or a synthetic source it is asserted to reject."* **Of the three rules in that file, this is the only one with neither.** `PROVIDER_LITERAL_RULE` has `mustMatch`; `FIELD_LIST_RULE` has three planted shapes; the propagation rule has a bare scan. RC-9 exists because a rule that cannot match looks exactly like a rule that found nothing — and this rule has now demonstrated, once, that it cannot match.

**CR-1 (required, test-only, no source file touched):**
- Normalise before scanning: strip string-concatenation seams and collapse whitespace, e.g. `read(relative).replace(/['"]\s*\+\s*['"]/g, '').replace(/\s+/g, ' ')`, then count.
- Add the planted sample the file's convention requires, and make it the **wrapped** form — a two-line concatenated re-type the rule must reject before it is allowed to report 0 against the real files.
- Apply the same normalisation to `FIELD_LIST_RULE`, whose `[^\]\n]*` has the identical newline blindness against a wrapped array literal. Lower risk there (the render half of R-T2 catches a dropped issue independently, which is why M1 turned 8 tests red), but it is the same one-line change and the same doctrine.
- Re-run M5 in its **original wrapped form**. It must go red.

**On the reporting, separately: Dev did the right thing and should keep doing it.** Writing down that a mutation survived, why, and that the two look identical in a summary table is the behaviour this file's history asks for. The only correction is the conclusion drawn, not the disclosure.

#### 3 · RC-5's new `c` hover — ✅ **Confirmed against all three paths. The sentence SA rejected is gone and no new false mechanism replaced it. Two residual imprecisions, both Low, neither worth another edit.**

Verified against `modelSettings.ts` directly: path 1 is "no value at any level" (`from.temperature` never leaves `'default'`); path 2 is the refusal loop, where `checkTemperature` fails and the loop `continue`s, leaving the provenance at `default` with the row still holding the value; path 3 is `:733-739`, `if (temperature !== undefined && rejectsSamplingParameters(model))` → an `adjusted` issue with reason `model_rejects_sampling_parameters`, `temperature = undefined`, and `from.temperature = 'default'` forced. All three reach the `c`.

Sentence by sentence:

| Clause | Path 1 | Path 2 (refused) | Path 3 (adjusted) |
|---|---|---|---|
| *"No stored value is in force for this field"* | true | true | true |
| *"…so the call is running on the value written in code"* | true | true | ⚠️ **imprecise** — the call sends **no temperature at all**; the code default may be a number it is not using |
| *"If the row does set one, the reason it is not in force is shown on this field"* | vacuous, true | true — the `rejected` issue renders on the field | true — the `adjusted` issue renders on the field. **R-T9's third case asserts exactly this**, and asserts the `title` does not match `/refus/i` |
| *"A value the guardrails accept, set in the area row, takes precedence from then on"* | true | true | ⚠️ **true only if "the guardrails" is read to include the sampling-parameter rule.** Under the narrow reading (`checkTemperature`) the value *was* accepted and still does not take precedence |

**Dev's second catch is correct and I had not made it:** the draft's final sentence was false in the refused state as well, not only the adjusted one, and the softening to *"a value the guardrails accept"* is the right repair for path 2. The two residuals above are hover enrichment on a state that is **unreachable on today's data** (no reasoning model is configured anywhere), the legend is independently sufficient and untouched by them, and the field itself renders `model_rejects_sampling_parameters` beside the marker. **No change required.** If the sentence is ever revisited, the tightening is to end at the second one.

*Noted, not raised as a defect:* `ISSUE_GLOSS.adjusted` — *"The value was accepted after being corrected to a legal one"* — reads oddly beside a temperature that was **dropped**, not corrected. It is unchanged from `a34f2572` and outside this round's scope. Recorded for whoever next opens `copy.ts`.

#### 4 · RC-6 — ✅ **The guard holds, in the code and in the test, for exactly the case I described.**

`AreaCard.tsx:98` computes `areaShowsOff` **once** and feeds three consumers: the area chip and caveat (`:132`, `:166`), the roll-up (`offCalls = areaShowsOff ? 0 : …`, `:100-102`) and every `CallRow` (`:221`), where `CallRow.tsx:171` is `const showOffChip = !areaShowsOff && !call.resolved.enabled;`. One binding, three uses, no second copy of the condition — which is RC-4's shape carried to its sibling, as ruled.

The locked-call case is covered at source and in the test: `modelSettings.ts:703-707` resolves a locked call `enabled: true` even inside an off area, and R-T7 → *"says it once, at area level, when the area itself is off"* builds precisely that card (locked `planner` resolving `true`, switchable `analysis` resolving `false`, area `configuredEnabled: false`) and asserts `call-state-chip` ×0, `calls-off-chip` absent, `state-chip` ×1. The mirror case I raised (a `calls.X.enabled: true` override under an off area) is covered by the same suppression. M3a and M3b both point at that one test, which is correct — two independent ways to break the property, one assertion that catches either.

`CallRow`'s `areaShowsOff` is a **required** prop and `AreaCard` is its only caller, so the guard cannot be forgotten at a new call site without a type error.

#### 5 · `1 call configured off` — ✅ **Confirmed. Ship the singular branch.**

The deviation is from BA's `N calls configured off`, and it is the right call. The count chip beside it already branches (`1 call` / `6 calls`) on my own implementation point 4, and two chips on one card disagreeing about English is the exact class of small wrongness this round exists to remove. What FR-2/FR-16 protect is the **claim** — *configured* off, never *is* off — and that is verbatim in both branches; S2-T8's page-wide scan still passes over both chips. Nothing load-bearing moved.

#### 6 · RC-7 — ✅ **Confirmed, and the outcome is better than my ruling asked for.**

`modelSettingsPolicy.ts:84-88` authors the sentence once, opening with FR-9's *"Not configurable here — "*, carrying the mechanism from the old comment, and the doc block above it carries the R-6 obligation (*"if a non-chat call is ever excluded, this sentence is wrong"*) as a code-level note rather than a risk-table line. The `:90-94` comment is now a pointer. `modelSettingsPolicy.test.ts:156` counts `/invalidates every stored vector/g` over the file and requires exactly 1 — I verified independently: `grep -c` returns 1. Dev is right that promoting the comment naively would have left the same prose twice in one file; a pointer plus a uniqueness assertion is the correct resolution.

The wire half is genuinely referenced, not copied (`adminSettingsView.ts:309`), asserted equal at `adminSettingsView.test.ts:373`, **and** the render fixture's copy is pinned to the constant at `:391` (`SEED_EXCLUDED_REASON` `toBe` the policy's) — without that pin the two halves of AC-19 could both pass while the page rendered a sentence nobody wrote. That pin is the detail that makes this hold; it is not in §13 and it should have been.

⚠️ **One Low left open:** `components/ExcludedCallRow.tsx:8-10` paraphrases the mechanism a third time in its doc block (*"changing an embedding model invalidates every stored vector, which makes it a data migration rather than a setting"*). It cannot render and the uniqueness test is file-scoped to the policy module, so nothing is broken — but it is the file a future reader edits, and "one home means one wording" applies to the prose as much as to the string. Trim it to a pointer when that file is next opened.

#### 7 · `MARKED_FIELDS`, and the "no array literal" claim — ✅ **Verified true by reading the file, not the summary.**

`CallRow.tsx` contains **no array literal at all**. The rendered set comes from `renderedFieldsFor(showProvider)` in `markers.ts`; the bodies are a `Record<RenderedField, …>` keyed by type; the only field-name strings in the file are object keys in that `Record` and the `field === 'temperature'` comparisons inside the temperature body, neither of which is a list. So the source rule is a flat absence and not a judgement, as claimed, and the catch-all at `:167-169` filters against the same `renderedFields` binding the map at `:194` consumes, in one scope.

The naming constraint landed as asked: `MARKED_FIELDS` is named for the marker-bearing property, `UNMARKED_RENDERED_FIELD = 'provider'` sits beside it, and the AC-6 exception is documented **at the constant** (`markers.ts:27-42`) with the instruction for the next person adding a rendered-but-unmarkable field. `markerFor` returns `null` for `provider` on its **first** branch, so provider cannot take a marker even if someone puts it in the array — belt and braces, correct order.

The planted-violation test covers three shapes including `[...MARKED_FIELDS, 'provider']`, which is the one that would have sneaked the second list back in beside the constant. That is the right third shape. Its only weakness is the newline blindness folded into **CR-1**.

*Low:* `markers.ts:92` — `call.provenance[field as SettingField]` — the cast is redundant. After the `field === UNMARKED_RENDERED_FIELD` early return, `field` is narrowed to `'model' | 'temperature'`, which is already assignable to `SettingField`. Drop it when next in the file; a cast that is not needed is a cast the next reader assumes *is*.

---

### The rest, assessed normally

| Area | Finding |
|---|---|
| **RC-1 … RC-4, RC-8, RC-10, RC-11 in the code** | ✅ All verified at source, not from §13. **RC-1:** `Marker` is rendered inside `field-label-*` and R-T10 asserts it is in the label element and **not** in `field-value-*`. **RC-8:** the `space-y-2` wrapper is gone, `READ_ONLY_NOTE` renders directly with `data-testid="read-only-note"`, and R-T15 asserts it on all eight expanded cards against the exported constant. **RC-10:** `PAGE_STANDING_NOTE` is my exact composition, `PROPAGATION_CLAUSE` is private (asserted not exported), and R-T3 asserts `indexOf('These are the stored settings') === 0` plus the four elements plus the terminal `(runbook §5).`. **RC-11:** `nav.test.ts` slices from `href: '/admin/business-os-llm'` to the next `href: '` and asserts the description inside that slice, plus the old string absent file-wide. |
| **FR-1 … FR-16 in the code rather than in §13** | ✅ Walked one by one. The two I checked hardest because they are the easiest to assert loosely: **FR-9's count chip** is `area.calls.length + area.excludedCalls.length` with its own plural branch, R-T13 pins `6 calls` and the **order** (configurable rows first, excluded below, not interleaved), and R-T14 pins all seven other chips (`3/1/8/2/1/4/1`) so an off-by-one cannot hide; **FR-8's `varies by call`** is `providers.size > 1` in `AreaCard` and nowhere a provider name, with R-T6 asserting the header **and** the returned per-call field **and** that the returned field brings its `provider_not_allowed` issue with it, for that area only. |
| **The nine deleted `copy.ts` exports** | ✅ All nine gone; `grep` across `app`, `lib`, `tests`, `components`, `hooks` finds **no live reference** — the only hits are the absence assertions in `source.guard.test.ts:238-246`. `ProvenanceChip`, its `testId="provenance"` and the `ProvenanceLevel` import went with them, as I predicted in implementation point 1, and `CallRow`'s header was rewritten rather than left describing a design that no longer exists. **No load-bearing sentence was lost:** `LOCK_AREA_FAIL_OPEN`'s still-true half (a read failure reverts model and provider too, not just the switch) is generalised into `PAGE_STANDING_NOTE`'s *"falls back to the values in code"*, which is now true of all eight areas rather than of onboarding only; the four `FAIL_OPEN_*` strings were switch-framed and the switch is not on the page; `PROVENANCE_LABEL`/`TITLE` are replaced by the marker scheme that superseded them. |
| **The parked `LedgerCheckPanel` and the route header** | ✅ C-8 discharged where the sweep looks. The route header says **NOT DEAD CODE**, names slice 3 as its caller, and `source.guard` asserts both that string and `Slice 3 is this route's caller`. The component is byte-identical below its new `PARKED` header. `AreaCard`'s comment carries the date, the reason, "one import plus one line" and R-D's don't-render-it-twice obligation, and `source.guard` asserts `codeOf(AreaCard)` does **not** contain `LedgerCheckPanel` while the raw source does — the right pair of assertions. R-T4 additionally asserts **no `/ledger` fetch is issued**, which is the property that actually matters for the cross-tenant read: the panel is not merely hidden, it is not called. |
| **The excluded-call rendering** | ✅ `ExcludedCallRow` carries the caption, the identifier and the server's `reason` — no value fields, no markers, `quiet` tone, not amber (C-7). R-T13 asserts the absences explicitly rather than trusting the component, and the second test renders `'A SERVER SENTENCE.'` from a fixture to prove the string is never written client-side. `bosLlmExcludedCallNames()` is `filter(isExcludedFromBosLlmSettings)` — generic by data, with no `if (area === 'chat')` anywhere, and `adminSettingsView.test.ts` asserts the other seven areas get `[]` and that excluded never overlaps configurable. |
| **Mandatory-rule conformance** | ✅ Clean. **Logging:** zero `console.*` added anywhere in the diff (scanned the added lines directly); the five files §10 measured are still at zero, so there is nothing to flag or convert under CLAUDE.md's rule 3. **Repository pattern / RLS:** no query, no Supabase call, no migration, no route behaviour changed — the only route edit is a comment. **Zod:** no input boundary moved. **TypeScript:** no `any`, no `@ts-ignore`, no new `eslint-disable` in the diff; the one cast is the redundant `as SettingField` above. **Rule 7 (no new patterns):** nothing new — no flag, no dependency, no tooltip primitive. `markers.ts` is a module of two pure functions and two constants over an existing shape. |
| **The test-timeout / `fireEvent` change** | ✅ **Nothing weakened, and the reasoning holds independently of the re-run.** A `timeout` argument raises the ceiling on how long a test may take; it removes no assertion and changes no expectation, so it cannot convert a red test to green — only a timed-out test into a completed one that then passes or fails on its merits. `fireEvent.click` versus `userEvent.click` on `getAllByRole('button')[0]` is like-for-like here because the toggle is a plain `onClick` with no pointer-capture, no `pointer-events` gating and no disabled state; the assertions that follow are on rendered output, not on event sequencing. Dev's re-run of the matrix afterwards is confirmation, not the argument. ⚠️ *Low:* a 30 s budget on twelve tests will also absorb a genuine render regression silently. If the eight-card walk ever gets slow for a real reason, nothing will say so. Acceptable for a jsdom load flake; not a pattern to widen. |
| **Test coverage and testability** | ✅ The strongest part of the diff. The fixture's `seedDerivedShape()` is **computed from the fixture**, not hand-written, so the self-check is not circular, and it is asserted before any AC consumes it. The marker counts are asserted per area **and** in total (9), so a fixture error cannot cancel out. R-T9 now has four cases across all three `default` paths plus the policy-locked negative. The one coverage gap is CR-1. |
| **Documentation (§9)** | ✅ Both supersessions are dated, name this document, and leave the old text visible and struck rather than edited away (`…ADMIN_UI_REQUIREMENT.md:233`, `…ADMIN_UI_WORKPLAN.md:647`); S2-T3's second half is explicitly marked unaffected; FR-17 carries the dated, **unchecked** slice-3 obligation at `:168`; S2-T6, S2-T8 and S2-T11 each record what narrowed, what was superseded and what was re-pointed. Change-History rows are present in both. This is the R-A/R-B condition discharged properly. |
| **Over-engineering** | None. `markers.ts` earns its place three times over; the `Record` is a runtime throw rather than decoration and M9 proves it; the private clause constant is R-D's shape. Nothing here is bigger than the requirement. |

### Code Review Comments

1. `app/admin/business-os-llm/__tests__/source.guard.test.ts` — **CR-1 (required):** the propagation-clause rule is the only rule in the file with neither a `mustMatch` sample nor a planted rejection, and it is blind to a wrapped re-type — the style every other multi-clause string in `copy.ts` is written in. Normalise concat seams and whitespace before counting, add the **wrapped** planted sample, extend the same normalisation to `FIELD_LIST_RULE`, and re-run M5 in its original two-line form until it is red. — Priority: **Medium**
2. `docs/workplans/…REFINEMENTS_WORKPLAN.md` §8.1 — **CR-2 (required, doc only):** correct *"adding the reverse `Satisfies<ServerAreaView, ClientAreaView>` is one line"*. It is a line that **does not compile today**, because the client deliberately widens `area: string` against the server's `BosLlmArea` (and `SettingIssue[]` against `BosLlmSettingIssue[]`). Record the ruling: the pin stays one-directional, the gap is accepted and bounded, and the two-way option — if ever wanted — is a **key-set** pin, raised in the workplan of whichever slice next touches `types.ts`. — Priority: **Medium**
3. `app/admin/business-os-llm/components/ExcludedCallRow.tsx:8-10` — a third paraphrase of the exclusion mechanism in a doc block. Cannot render; trim to a pointer when next in the file. — Priority: **Low**
4. `app/admin/business-os-llm/markers.ts:92` — `field as SettingField` is redundant after the narrowing return above it. — Priority: **Low**
5. `app/admin/business-os-llm/copy.ts:151-154` — the `c` hover's *"running on the value written in code"* and *"a value the guardrails accept … takes precedence"* are both slightly loose on the `model_rejects_sampling_parameters` path, where the call sends no temperature at all. Unreachable on today's data, the field's own reason line carries the truth, and the legend is unaffected. Recorded, not required. — Priority: **Low**
6. `app/admin/business-os-llm/copy.ts:204-209` — `ISSUE_GLOSS.adjusted` ("corrected to a legal one") reads oddly beside a **dropped** temperature. **Pre-existing at `a34f2572`, out of this round's scope.** — Priority: **Low**
7. Working-tree hygiene — `.claude/settings.local.json` and `.gitignore` are **staged** in the index while the whole feature is unstaged, and six unrelated docs are untracked. RM must stage this round's files deliberately rather than commit the index as it stands. — Priority: **Low (RM)**

### Optimisation Suggestions

- `AreaCard.tsx:106-107` derives `showPerCallProvider` from its own `new Set(...).size > 1` while `areaProviderSummary()` independently derives the same predicate fifteen lines above. It is two computations of one fact — the family of shape this round exists to eliminate — though both live in one file and R-T6 asserts the header and the returned field **together**, so a divergence would turn that test red. Compute the set once and hand both consumers the same value when the density slice restructures this component.
- The `c` hover is now three sentences. If it grows again it stops being a hover and becomes a paragraph nobody reads on touch. Two is the ceiling.

### Code Approved for QA: **Yes**, with CR-1 and CR-2 to land first

- [x] Everything referred to me is ruled on, and five of the seven are confirmed as implemented
- [x] Gates independently re-measured by SA and matching Dev's report on every row I ran
- [x] **No SA code changes.** The diff is Dev's work plus CR-1 and CR-2
- [ ] **CR-1** — the propagation rule gets the normalisation and the planted wrapped sample the file's own convention requires; M5 re-run in its original form
- [ ] **CR-2** — §8.1's "one line" claim corrected, with the ruling recorded
- [x] No second SA pass. QA asserts CR-1 by re-running M5 wrapped, and reads CR-2

---

## QA Testing Report

**QA — 2026-09-24**
**Test mode:** full
**Strategy used:** **A + B + E** — Jest unit/render over the screen and the view builder (the only executable surface; the page is a `'use client'` component with a stubbed payload), plus **independent probe tests written by QA** for the states Dev's suite does not reach, plus **read-only production reads** of all eight `system_settings_config` rows. **No E2E** (Playwright is not installed — CLAUDE.md § Testing), so the browser-session checks are listed under [Needs a human](#needs-a-human-with-an-admin-session).
**Focus:** ui + schema + copy accuracy, with a repo-wide regression sweep
**Skipped:** E2E (not set up); the live mutation matrix re-run (**blocked by the sandbox — see BLOCKED-1**); `npm run lint` (W-9, broken repo-wide)
**Input source:** prompt keywords + the workplan's §8 gate table
**Tree tested:** working tree on `feature/business-os-llm-admin-screen-refinements`, nothing committed. **QA modified no source file.** One temporary probe test (`tests/zz-qa-probe.test.tsx`) and one baseline worktree were created and **removed**; `git status` at the end is byte-identical to the start, verified by `md5sum` on the three files QA touched during the blocked mutation attempt.

---

### 1. Dev's numbers, re-measured

Every row was re-run by QA. **All eight of Dev's claims reproduce.**

| Gate | Dev claimed | QA measured | Verdict |
|---|---|---|---|
| `npm run typecheck:bos-llm` | `234 files in scope, 28 errors, 0 new` | `234 files in scope, 28 errors, 0 new (175.7s)` → `typecheck-bos-llm: passed`, exit 0 | ✅ identical |
| `npm run check:bos-llm-literals -- --list` | `43 files in scope, 2 exempt, 1 included by name` | `43 files in scope, 2 exempt, 1 included by name`, exit 0 | ✅ identical |
| `npm run lint:hooks` | clean | exit 0, no output | ✅ |
| `npm run build` | ✓ Compiled successfully | exit 0, full route manifest emitted | ✅ (QA's own `tail` truncated the `/admin/business-os-llm` size row — **not re-measured**, see OBS-4) |
| `npx eslint` on every touched file | 0 errors / 5 warnings, all pre-existing | **0 errors, 5 warnings** — and QA re-ran the same rule set **on a clean `a34f2572` worktree** and got the **same 5 warnings at the same sites** (`AdminSidebar.tsx` 17:3, 21:3, 39:9; `modelSettingsPolicy.test.ts` ×2 unused-disable) | ✅ **pre-existence proved, not asserted** |
| jest, the four touched paths | 25 suites / 639 tests (baseline 547, +92) | **25 suites / 639 tests / 23 snapshots, 0 failures** — reproduced 5× | ✅ |
| jest, `admin-authz-surface` guard | 74 tests | **74 passed** | ✅ untouched |
| Mutation matrix | 10 of 10 turned a named test red | **not re-run — BLOCKED-1.** Substitute evidence in [§4](#4-mutation-matrix--spot-check-blocked-substitute-evidence) | ⚠️ partial |

#### Repo-wide sweep, against a real `main` baseline

Dev did not run one. QA built a detached worktree at `a34f2572` with `node_modules` junctioned in, and ran the **full** suite on both trees, twice each (once idle, once under contention):

| | `main` @ `a34f2572` | working tree | Delta |
|---|---|---|---|
| Test Suites | 24 failed, 8 skipped, 480 passed, 504/512 | 24 failed, 8 skipped, 480 passed, 504/512 | **0** |
| Tests | 143 failed, 64 skipped, **7691** passed, 7898 total | 143 failed, 64 skipped, **7783** passed, 7990 total | **+92 passed, +92 total, +0 failed** |
| Failing suite *names* | 24 | 24 | **identical list** |

**The 24 red suites are all pre-existing on `main`** and none is in a touched path (`DeclarativeCompiler-*`, `v6-*`, `pilot/*`, `orchestration/*`, `website-builder/*`, `featureFlags`, `v4-generator`, `chat-v4/route.audit`, `tokenUsageRepository.contract`). The two that *look* Business-OS-adjacent were inspected verbatim and are unrelated:

- `tokenUsageRepository.contract` — `summariseFeatureAllAccountsInWindow` is present on the prototype and missing from `EXPECTED_ARITY`. Fails identically on `main`.
- `chat-v4/route.audit` — `Error: profile read failed for OWNER-TEXT-MARKER-c1 cancel`, a worker-killing throw. Fails identically on `main`.

**+92 / -0 is exactly the claimed delta. This round introduces no new red anywhere in the repo.**

---

### 2. The flake — is it gone, or just less likely?

**Gone.** Not "less likely".

| Evidence | Measurement |
|---|---|
| Clean runs of `page.render.test.tsx` | **11**, zero failures — 1 scoped, 3 scoped **while a second full-repo jest run was saturating the machine**, 4 solo **while TWO full-repo jest runs were saturating the machine**, 1 verbose, 2 inside full-repo runs |
| Slowest **individual** test, under double load | **882 ms**. Next slowest: 365 ms. | 
| Headroom against the 30 s `EIGHT_CARDS` timeout | **~34×** |
| Suite wall-clock spread under load | 14.9 s – 46.7 s (transform/compile dominated, not test-body dominated) |

The root cause is consistent with Dev's diagnosis and the fix is **structural, not probabilistic**: `userEvent.click` runs an async pointer-event sequence with an internal delay per interaction, so a test that opens eight cards pays it eight times and its cost scales with CPU contention; `fireEvent.click` is one synchronous dispatch. With the worst test now at 0.9 s against a 30 s budget, the timeouts are belt-and-braces rather than the thing holding the suite up.

⚠️ **One caveat, stated plainly:** QA could not *reproduce the original failure* (that would mean re-introducing `userEvent` into a source-controlled test file). So "the fix removes the mechanism" is argued from the code and from the 34× headroom, not from a before/after red run.

---

### 3. Per-AC status

Legend: ✅ verified by QA (test read **and** independently exercised) · ☑️ verified by reading the assertion + a source/render check · ⚠️ passes with a finding.

| AC | Tested? | Result | Evidence |
|---|---|---|---|
| **AC-1** no `enabled` field / `switch locked` / `Cannot be switched off` | ✅ | Pass | `R-T1` green over all 8 cards; QA grep: the only surviving `enabled` references in the screen are the **wire type**, the roll-up count and `showOffChip`. No render of the field anywhere. |
| **AC-2** both reasons render, each naming its field | ✅ | Pass | QA probe "include-calls trap": planner's row renders `enabled · call_not_switchable — This field is owned by the code and cannot be set in the row.` The catch-all is derived from `renderedFields` in one scope (`CallRow.tsx:164-167`); `source.guard` proves the file holds **no** array literal of field names, and proves the rule matches three planted violations including `[...MARKED_FIELDS, 'provider']`. |
| **AC-3** banner gone, one line survives, ends `(runbook §5)` | ✅ | Pass | QA probe printed it verbatim: *"These are the stored settings, not what the fleet is doing. Running instances pick a change up within about 60 seconds, and an instance that cannot read them on startup falls back to the values in code (runbook §5)."* All four load-bearing elements present; ends with the pointer. `source.guard` counts the propagation clause **exactly once in the whole screen** (in `copy.ts`) and asserts `PROPAGATION_CLAUSE` is not exported. |
| **AC-4** ledger panel parked, not deleted | ✅ | Pass | `AreaCard` neither imports nor renders it; component + `ledgerCheckCopy.ts` + route + all tests present and green (25/25 suites include `ledgerPanel.render.test.tsx` and the route tests). Route header carries the "NOT DEAD CODE" note naming slice 3. |
| **AC-5** provider once per area, never per call | ✅ | Pass | `area-summary` renders `provider <x> · model <y>` on all 8; no `field-provider` in the single-provider path (QA probe). |
| **AC-6** provider carries no marker | ✅ | Pass | `markerFor` returns `null` for `UNMARKED_RENDERED_FIELD` **first**, before any provenance read. QA probe: the two provider fields on a mixed area render `provideropenai` / `provideranthropic` with no glyph and no `sr-only` phrase. |
| **AC-7** `varies by call` + per-call field returns for that area only | ⚠️ | **Pass, with a wording note** | QA probe with a 2-provider area: header reads **`provider varies by call (2)`** and both `field-provider` cells return. The AC quotes `varies by call`; the shipped string appends `(2)`, mirroring `areaModelSummary()`. See **OBS-1**. |
| **AC-8** provider-literal rule, with a `mustMatch` sample | ✅ | Pass | `source.guard.test.ts:131-153`. The rule is asserted to match `if (provider !== 'openai') {`, asserted **not** to match the same words in a comment, and run over every walked screen file. |
| **AC-9** area `Configured: off` verbatim + caveat; nothing on an `on` or non-switchable area | ✅ | Pass | QA probe: `["Configured: off"]`, caveat count `1`, roll-up `[]`, call chips `[]`. |
| **AC-10** call chip + roll-up under an area that is on; neither when nothing is off | ✅ | Pass | QA probe: roll-up `["1 call configured off"]`, call chip `["Configured: off"]` on `analysis`, and `planner` (locked → resolves `enabled: true`) correctly bare **but carrying its `call_not_switchable` refusal**. |
| **AC-11** `LastChangedLine` unchanged | ✅ | Pass | `lastChanged.render.test.tsx` and `LastChangedLine.tsx` are **absent from `git status`** — untouched, and green. Production confirms all 8 rows are still `updated_by = null` → "actor not recorded" is every card's state. |
| **AC-12** the two temperature lock texts stay as TEXT | ✅ | Pass | QA probe: the locked planner row renders *"Temperature is fixed in code for this call. It is fixed at 0."* as body text, and **no `c` marker on that field** despite `provenance.temperature === 'default'` — which is the M6 property, demonstrated by render rather than by mutation. |
| **AC-13** 42/44 from the stored row, 35/44 unmarked | ✅ | Pass | QA **re-derived the whole distribution independently** from `20261003_seed_bos_llm_area_settings.sql` against `modelSettingsPolicy.ts:166-228` and `modelSettings.ts:596-691`, field by field, and got Dev's and SA's numbers exactly: model 5/17/0, temperature 4/16/2 → 42 stored, 9 `*`, 0 `c`, 35 unmarked. The fixture's `seedDerivedShape()` self-check is real and non-vacuous. |
| **AC-14** `c` only on a configurable code default | ✅ | Pass | Zero on the seed fixture; never on a policy-locked/not-applicable temperature (QA-rendered, above); **does** render for a genuinely unconfigured field and for a refused one (QA probe states 1 and 2). ⚠️ See **BUG-1** for the third state. |
| **AC-15** `*` on exactly the 9 call-level fields, in the label | ☑️ | Pass | `R-T10` asserts per-area `{chat 2, insights 2, briefing 0, website 3, intake 2, leads 0, onboarding 0, images 0}` = 9, and that the marker node is inside `field-label-*`. QA's independent derivation agrees on all eight numbers. |
| **AC-16** sr phrase + legend + hover; legend alone sufficient | ⚠️ | **Pass, with a caveat** | `Marker.tsx` hides the glyph from AT and carries the phrase in `sr-only`; the legend is composed **from the same `MARKER_SR` constants**, which makes "the legend alone conveys it" true but **tautological** — see **OBS-2**. Hover text is the consequence, not the label, and is not a restatement. |
| **AC-17** `N set per call`, only when `N > 0` | ✅ | Pass | `callsSetPerCall` counts **calls** over `MARKED_FIELDS` only; the chip's `title` says so. `source.guard` proves `with a call override`, `on code defaults`, `Configured: on` and `Cannot be switched off` appear **nowhere as code** in the screen. |
| **AC-18** `LLM code call name` caption, identifier in monospace | ✅ | Pass | QA probe read the row text: `LLM code call nameplanner…`. Identifier verbatim, `font-mono`. |
| **AC-19** chat lists six, chip reads `6 calls`, reason from the payload | ✅ | Pass | `callCount = area.calls.length + area.excludedCalls.length`. The reason is pinned **three ways**: `ExcludedCallView.reason = BOS_LLM_SETTINGS_EXCLUSION_REASON` in the view builder, `adminSettingsView.test.ts:373` asserts equality on the wire, and `:391` pins the render fixture's copy to the same constant. Excluded rows carry no `field-model`, no `field-temperature`, no markers. |
| **AC-20** the other seven areas unaffected | ✅ | Pass | `bosLlmExcludedCallNames(area)` is the per-**name** predicate (`W-5`), so the list is empty for the other seven **by data**. QA confirmed there is no `if (area === 'chat')` anywhere in the view builder. |
| **AC-21** new subtitle, pinned | ✅ | Pass | `PAGE_SUBTITLE` rendered under `data-testid="page-subtitle"`; `R-T15` pins it. |
| **AC-22** sidebar `'Models & temperatures'`, description asserted | ✅ | Pass | And the assertion is **scoped to the entry** (indexOf-to-next-href slice), not a page-wide `toContain` — which is the difference between an assertion and a coincidence. `'Models & Switches'` asserted absent from the file. |
| **AC-23** hygiene gates | ✅ | Pass | §1 above. Also: **0 `console.*`** in all 16 touched/adjacent files, measured. |

---

### 4. Mutation matrix — spot-check BLOCKED, substitute evidence

**BLOCKED-1 (not a defect in the work).** QA attempted to re-run mutations M1, M4 and M6 against the working tree. The sandbox's auto-mode classifier refused both the file write **and**, once a mutation was in place, the jest run itself (*"Modify Shared Resources"*). The mutation was reverted immediately and `markers.ts` was verified byte-identical by `md5sum` (`717459ee32fdf6782189336ceb1f7c71` before and after). **Dev's "10 of 10" is therefore taken on trust, not independently reproduced.**

What QA *could* establish without mutating source, and did:

| Matrix row | Substitute evidence |
|---|---|
| **M1** (hand-written field array returns) | The guard is **self-proving in-memory**: `FIELD_LIST_RULE` is asserted to match three planted violations — the four-name array, the narrowed `['model','temperature']` form the R-C ruling forbids, **and** `[...MARKED_FIELDS, 'provider']` — before being asserted not to match `CallRow.tsx`. A dead regex is ruled out by construction. |
| **M4** (`providers.size > 1` → `provider !== 'openai'`) | Same shape: `PROVIDER_LITERAL_RULE.mustMatch` is literally `if (provider !== 'openai') {` and is asserted to match. Plus the comment-only case is asserted **not** to match, so the rule is not trivially true. |
| **M6** (`c` on a policy-locked temperature) | **Demonstrated by render**, not by mutation: QA's locked-planner probe shows `provenance.temperature === 'default'` producing *no* marker while the lock text renders. That is exactly the branch M6 deletes. |
| **M2, M3a/b, M5, M7, M8, M9** | Assertions read and judged non-vacuous; not independently exercised. |

**If SA or the user want the matrix re-proved, it needs a session where a test-only file write is permitted.** It is the one claim in §8 QA did not verify.

---

### 5. The seven user-feedback items — genuinely delivered?

This is what the user will check when they read the diff.

| # | The feedback | Delivered? | What QA actually saw |
|---|---|---|---|
| **1** | On/off switch surface gone; switch still works via script | ✅ **Yes** | `FailOpenNotice.tsx` **deleted**. Nine `copy.ts` exports removed: `FAIL_OPEN_HEADLINE/BODY/ACTION/INLINE`, `LOCK_AREA_FAIL_OPEN`, `LOCK_AREA_NOT_SWITCHABLE`, `LOCK_CALL_NOT_SWITCHABLE`, `PROVENANCE_LABEL`, `PROVENANCE_TITLE` — exactly nine, counted against `git show HEAD:`. No `enabled` field renders; no `switch locked` chip; no per-card off caveat except in the off exception. `modelSettings.ts`, `modelSettingsPolicy.ts`, the resolver and `scripts/bos-llm-settings.ts` are **not in the diff** — and QA drove the script against production nine times during this pass, so the switch's door is demonstrably still open. |
| **2** | An area or call that IS off is still visible | ✅ **Yes**, and the guard is right | Three exception-only surfaces, none of which renders on today's data. The `--include-calls` trap works: area back on, `analysis` chipped off, `planner` (locked, resolves `true`) left bare **but carrying its refusal reason** — so the page does not silently present a model for a dead call, and does not falsely mark a live one. |
| **3** | Ledger Check panel gone, parked not deleted | ✅ **Yes** | Unmounted with a dated comment that names the reason, the one-import-one-line restore, and the R-D double-render trap. Component, copy module, route and every test still present and green — plus **a new assertion** (`R-T19`) that keeps the panel's ledger-specific clause under test *while it is unmounted*, which is the thing that would otherwise have rotted. |
| **4** | "Last changed / actor" line kept | ✅ **Yes** | `LastChangedLine.tsx` and `lastChanged.render.test.tsx` are **not in the diff at all**. Production confirms `updated_by` is null on all eight rows, so *"actor not recorded"* remains the correct state, not a bug. |
| **5** | Markers make sense; old badges gone, including the header chip | ✅ **Yes** | Nothing on a stored value, `c` for a code default, `*` for a call-level value. `call override` / `area` / `code default` badges gone from the source; `N with a call override` → **`N set per call`**, and both superseded chip strings are asserted absent. The chip counts **calls** while the markers count **fields**, and the chip's hover says so — which matters on `intake`, the one area where the two numbers differ (1 call, 2 fields). |
| **6** | Call names captioned | ✅ **Yes** | `LLM code call name` before every identifier, plus one legend clause per screen explaining that the identifier is also the `component` value in the usage ledger. No invented per-call prose, correctly. |
| **7** | Provider once per area, `varies by call` if mixed | ✅ **Yes** | Removed from 22 rows, added once to each of 8 headers, no marker. The fallback is data-driven (`size > 1`) and returns the per-call field **with its issues** through the same single list — QA exercised it and both came back. Header reads `varies by call (2)`; see **OBS-1**. |
| **+** | Four embeddings greyed, non-editable, with their reason | ✅ **Yes** | Quiet tone (not amber), no value fields, no markers, reason sourced from the exported policy constant and equality-pinned on both sides and in the fixture. Chat's chip reads `6 calls`. |
| **+** | Markers carry explanatory hover text | ⚠️ **Yes, with one false clause** | See **BUG-1**. |

---

### 6. Production reality

QA re-ran Dev's Q-5 reads **and extended them from two areas to all eight** (read-only `get`, nothing written, `jgccgkyhpwirgknnceoh.supabase.co`, 2026-09-24):

| Area | `areaEnabled` | row `enabled` | calls switched off | resolver issues |
|---|---|---|---|---|
| chat | true | true | none (`calls.analysis.enabled: true`) | 0 |
| insights, briefing, website, intake, leads, onboarding, images | true | true | none | 0 |

**Every one of the eight stored rows is byte-for-byte the seed.** Three consequences:

1. Dev's "the off chips render zero times today" is confirmed — **for all eight areas, not just the two SA asked for.**
2. The seed-derived fixture is now corroborated against production **for every area**, not only `chat` and `leads`. `R-2`'s mitigation is stronger than the workplan claims.
3. **Zero resolver issues in production**, so the `c` marker, the issue lines and the catch-all all render nowhere today — including the state in **BUG-1**, which is why it is not a blocker.

---

### 7. Issues found

#### Bugs

**BUG-1 — the `c` hover states a consequence that is false in the third state it was rewritten for. Severity: Low.** *(Copy accuracy. Not reachable on today's production data.)*

- **File:** `app/admin/business-os-llm/copy.ts` — `MARKER_TITLE.code`
- **The claim under test:** §D-13 and `copy.ts`'s own doc block say the sentence is worded to be true in **three** states, the third being `modelSettings.ts:729-739` — a temperature dropped *after* resolution because the resolved model rejects sampling parameters, pushed as `adjusted`, with `from.temperature` forced to `'default'`.
- **Reproduce:** render a call with `resolved.temperature: null`, `provenance.temperature: 'default'`, `defaults.temperature: 0.3`, and an `adjusted` / `model_rejects_sampling_parameters` issue on `temperature` — i.e. exactly Dev's own R-T9 fixture. QA did this and read the DOM.
- **Expected:** every clause of the hover is true.
- **Actual:** the field renders **`temperature  c  not set — the provider default applies`** while the hover says *"…so the call is running on **the value written in code**."* In this state the call is running on **no temperature at all**; the value written in code for that call is `0.3`. The second clause is false. A reader also gets *"the **provider** default applies"* (the value) and *"**code** default"* (the marker) on the same field, which are two different answers.
- **Why Dev's test did not catch it:** R-T9 asserts the title does **not** match `/refus/i` and **does** contain `not in force` — both true. It asserts nothing about the "running on the value written in code" clause, which is the one that breaks.
- **First clause is fine.** *"No stored value is in force for this field"* is true in all three states; only the consequence clause over-reaches.
- **Suggested shape (Dev's call, not QA's):** drop the code-value promise from the second clause, e.g. *"…so the value the call uses is not coming from the stored row. Where the row does set one, the reason it is not in force is shown on this field."* Whatever the wording, it should not simultaneously say "provider default" and "code default" about one field.
- **Not a blocker:** production has zero issues on all eight areas, no call resolves to a reasoning model, and the state cannot occur until someone sets a `gpt-5*` / `o3*` / `o4*` model on a `temperature: 'free'` call with `sendsSamplingPenalty: false`.

#### Performance

None. The change is subtractive on the client (22 provider fields and a 180-word banner removed, one panel and its per-card `fetch` unmounted — **eight fewer `GET …/ledger` requests per page view**, and eight fewer cross-tenant ledger aggregates on the server). The one payload addition is four strings on one area. `next build` still marks the route dynamic.

#### Edge cases

**EDGE-1 — a payload without `excludedCalls` blanks the page rather than degrading. Severity: Low.**
`AreaCard` reads `area.excludedCalls.length` and `.map()` unguarded. QA deleted the field from a fixture and the page rendered **nothing at all** (the area heading never appeared). Client and server ship in one Vercel deployment, so this is not reachable in normal operation — but §8.1 already records that the `AreaView` pin is **one-directional** (`Satisfies<Client, Server>`), so a *client*-side field drop is invisible to `typecheck:bos-llm`, and `next.config.js` ignores TS errors, and jest cannot see it either. Three gates, none of which would catch it. `?? []` would cost one character per site. Dev's own §8.1 note anticipated this class; QA is recording that it is now **reachable in one concrete render path**, not merely theoretical.

**EDGE-2 — `ISSUE_GLOSS.adjusted` reads oddly in the RC-11 drop. Severity: Low, pre-existing, not introduced here.**
*"The value was accepted after being corrected to a legal one"* is rendered beside `model_rejects_sampling_parameters`, where the value was **dropped**, not corrected. Unchanged from slice 2 (`git show HEAD:copy.ts` is byte-identical on this constant), but it is now the *only* prose beside the `c` marker in that state, so it compounds BUG-1. Flagged for whoever fixes BUG-1 to look at both together.

#### Observations (no action required)

- **OBS-1 — `varies by call (2)` vs AC-7's `varies by call`.** The count suffix is deliberate (mirrors `areaModelSummary`) and the AC's string is a substring of it. Recording it so nobody reads the AC literally later and "fixes" it.
- **OBS-2 — AC-16's "legend alone is sufficient" is tautological.** `MARKER_LEGEND` is composed from `MARKER_SR`, so the assertion that the legend conveys what the `sr-only` text conveys cannot fail. That is arguably the *right* design (one source, no drift) — but it means the AC proves single-sourcing, not sufficiency. No change wanted; just don't count it as evidence of comprehensibility. Real comprehensibility is the user's own look at the screen.
- **OBS-3 — the `(runbook §5)` pointer is plain text, not a link.** Consistent with the rest of the page; the runbook path is only spelled out in `READ_ONLY_NOTE`'s sibling. An operator who has never opened the runbook has to search for it. Pre-existing convention.
- **OBS-4 — the build's route-size row was not captured.** QA's own `tail` truncated it. `npm run build` exited 0 with a complete route manifest, so "compiles" is verified; Dev's specific `5.44 kB / 93.3 kB` figure is not re-measured.
- **OBS-5 — the marker legend renders on every expanded card, including the five that show no markers at all** (briefing, leads, onboarding, images, and any card whose calls are all area-level). On a round whose thesis is *"mark the exception, not the norm"*, a legend for marks that are not present is itself a standing caveat. It is one muted line and it is at the point of use, so QA is **not** calling it a defect — but it is the kind of thing the density slice should revisit.
- **OBS-6 — `typecheck:bos-llm` also reports `1 baseline entry is fixed; consider --update-baseline`** (`app/api/onboarding/build/route.ts` TS18047). Identical on `main`; unrelated to this round. Noted only so the next person does not read it as new.

---

### 8. Needs a human with an admin session

Nothing here is a finding — these are the checks Jest structurally cannot make, and Playwright does not exist in this repo (CLAUDE.md § Testing).

1. **Open `/admin/business-os-llm` signed in as a platform admin.** The whole round exists because the screen did not read well; only the user can close that. Specifically worth a look: whether the screen now reads as "what each call is set to" rather than "a page of caveats".
2. **Confirm nothing renders an off state.** Production says all eight areas and all 22 calls are on. **A `Configured: off` chip or an `N calls configured off` roll-up appearing on the live screen is a genuine change of state and should be investigated, not dismissed as noise** (Q-5's disposition, now measured across all eight areas rather than two).
3. **Hover the `*` and `c` markers.** `title` is not keyboard-reachable and does not fire on touch — that is the accepted v1 (F-11), but the user asked for the hover and should see what it actually feels like. On today's data **only `*` will be hoverable** — `c` renders nowhere.
4. **Expand the chat card** and confirm the four greyed embedding rows read as *"catalogued, not configurable here"* rather than as *"broken"*, and that `6 calls` does not read as a regression from `2 calls`.
5. **Sidebar:** `'Models & temperatures'`.

---

### 9. Test outputs, verbatim

```
# working tree — the four touched paths (reproduced 5×, incl. 3× under a saturated machine)
Test Suites: 25 passed, 25 total
Tests:       639 passed, 639 total
Snapshots:   23 passed, 23 total

# required admin gate, untouched
PASS lib/admin/__tests__/admin-authz-surface.guard.test.ts (15.038 s)
Tests:       74 passed, 74 total

# FULL repo suite — main @ a34f2572 (detached worktree, node_modules junctioned)
Test Suites: 24 failed, 8 skipped, 480 passed, 504 of 512 total
Tests:       143 failed, 64 skipped, 7691 passed, 7898 total

# FULL repo suite — working tree
Test Suites: 24 failed, 8 skipped, 480 passed, 504 of 512 total
Tests:       143 failed, 64 skipped, 7783 passed, 7990 total
#   -> identical failing-suite list; +92 passed, +92 total, +0 failed

typecheck-bos-llm: 234 files in scope, 28 errors, 0 new (175.7s)
typecheck-bos-llm: passed

check-bos-llm-literals: 43 files in scope, 2 exempt, 1 included by name      (exit 0)
npm run lint:hooks                                                           (exit 0, silent)
npm run build                                                                (exit 0)

npx eslint <20 touched files>   ->  0 errors, 5 warnings
npx eslint <same rules, a34f2572 worktree>  ->  0 errors, 5 warnings, SAME SITES

# page.render.test.tsx, slowest individual tests under double full-suite load (ms)
249  272  323  341  348  349  365  882          <- 30 000 ms budget

# QA probe, RC-11 "adjusted" state (BUG-1)
field text: temperature c "code default — no stored value is in force for this field"
            not set — the provider default applies
            model_rejects_sampling_parameters — The value was accepted after being corrected to a legal one.
hover     : "No stored value is in force for this field, so the call is running on the value
             written in code. ..."      <- the call is running on NO temperature; code says 0.3

# QA probe, off-state discipline
AREA OFF          state-chip ["Configured: off"] | caveat 1 | roll-up [] | call chips []
AREA ON/CALLS OFF roll-up ["1 call configured off"] | call chips ["Configured: off"]
                  planner row: "... enabled · call_not_switchable — This field is owned by the code ..."

# production, read-only, all eight areas, 2026-09-24
chat/insights/briefing/website/intake/leads/onboarding/images
  areaEnabled=True  row.enabled=True  callsOff=[]  issues=0    (every row = the seed, verbatim)
```

---

### 10. Final status

- [x] **All 23 acceptance criteria pass.** AC-7 and AC-16 pass with a recorded observation rather than a defect.
- [x] **All eight of Dev's §8 numbers reproduce**, and the +92 / −0 delta is confirmed against a real `main` baseline rather than asserted.
- [x] **The flake is gone**, with 34× headroom and 11 clean runs including under double load.
- [x] **All seven user-feedback items are genuinely delivered**, plus both extras.
- [ ] **One Low-severity copy bug (BUG-1) and two Low edge cases (EDGE-1, EDGE-2) are open.** None blocks: BUG-1 and EDGE-2 are unreachable on production data, EDGE-1 is unreachable in a single-deployment topology.
- [ ] **Not verified by QA:** the mutation matrix (BLOCKED-1 — sandbox refused the file write *and* the subsequent test run), and the build's route-size row (OBS-4).

**QA verdict: PASS — safe to proceed to the user's own view of the screen and then RM, with BUG-1 and EDGE-1 recorded.** No High or Medium severity issue is open. Dev may fix BUG-1 in this round (it is a one-constant copy edit in `copy.ts` plus one assertion in `R-T9`) or defer it to the density slice; QA's recommendation is **fix it now**, because it is the one place where this round's own new copy is less true than the copy it replaced, and the round's whole premise is that the screen should not say things that are not so.

---

## 15. The final fix pass — CR-1, CR-2, BUG-1, EDGE-1

**Dev, 2026-09-24.** Four items closed on `feature/business-os-llm-admin-screen-refinements`. **Nothing committed** — the commit is the user's gate and RM's job. **One new finding came out of re-running the matrix: M7 was surviving, for exactly the reason M5 was.**

### 15.1 What changed, item by item

| Item | File | Change |
|---|---|---|
| **CR-1** | `tests/helpers/bos-llm-literal-rules.ts` | **`flattened()`** — strips `'…' + '…'` concat seams, then collapses whitespace, so a wrapped re-type is one logical line before any phrase or list rule scans it. Put **beside `codeOf()`** rather than in the screen's test file, because it is now the normalisation **three** rules in **two** suites depend on — and a second copy of it would be the same defect class one level up. |
| **CR-1** | `app/admin/business-os-llm/__tests__/source.guard.test.ts` | The propagation rule gains the `mustMatch` samples the file's own doctrine requires — **three** shapes: single-line, wrapped across two concatenated literals (`copy.ts`'s house style), and wrapped inside one template literal. Counting now runs over `flattened()` source. `FIELD_LIST_RULE` gets the same treatment plus a wrapped four-line planted sample, and `CallRow.tsx` is asserted clean **both raw and flattened**. |
| **CR-1** | same | ⚠️ **Each rule also asserts that its wrapped sample ESCAPES without the normalisation.** That is what stops `flattened()` being deleted later as decoration: the test that proves the hole exists is the test that fails when the fix is removed. |
| **CR-2** | this workplan, [§8.1](#81-the-typecheck-gate-proved-rather-than-asserted-fr-15--ac-23) | The "one line" claim corrected and SA's four-part ruling recorded in a superseding box. The old text is left visible, not edited away (R-B condition 1). |
| **BUG-1** | `app/admin/business-os-llm/copy.ts` | `MARKER_TITLE.code` — both clauses SA and QA flagged. The hover now promises **no value**, only a provenance. |
| **BUG-1** | `app/admin/business-os-llm/__tests__/page.render.test.tsx` | R-T9's `adjusted` case pins the new wording **as two properties, not a string compare**. |
| **EDGE-1** | `app/admin/business-os-llm/components/AreaCard.tsx` | `const excludedCalls = area.excludedCalls ?? [];` — **one tolerant binding feeding both sites**, not a `?? []` at each, so the two cannot diverge. |
| **EDGE-1** | `app/admin/business-os-llm/__tests__/page.render.test.tsx` | A render test that **deletes the field at runtime** — the only gate that can see it. |
| **NEW — M7** | `lib/business-os/llm/__tests__/adminSettingsView.test.ts` | The source half of FR-14 (below). |

**The `c` hover, before and after:**

| | Text |
|---|---|
| Before | *"No stored value is in force for this field, so **the call is running on the value written in code**. If the row does set one, the reason it is not in force is shown on this field. **A value the guardrails accept**, set in the area row (runbook §3), takes precedence from then on."* |
| After | *"No stored value is in force for this field, so **the value this call uses does not come from the stored row**. If the row does set one, the reason it is not in force is shown on this field. **A value set in the area row (runbook §3) takes precedence as soon as it is in force**."* |

Both of SA's flagged clauses are addressed, and the wording now holds in all three `provenance === 'default'` states:

| Clause | Path 1 (nothing set) | Path 2 (refused) | Path 3 (`model_rejects_sampling_parameters`) |
|---|---|---|---|
| *"No stored value is in force…"* | true | true | true |
| *"…the value this call uses does not come from the stored row"* | true | true | **true** — the call sends no temperature at all, which is certainly not the row's |
| *"…takes precedence as soon as it is in force"* | true | true | **true** — in path 3 the value never becomes in force, and the sentence promises nothing else |

Two further things the new wording fixes, both QA's:

- It no longer gives **two different answers about one field**. The value line beside the marker says *"not set — the provider default applies"*; a hover claiming a **code** value was a second, contradicting answer. The hover now leaves the value to the value line.
- **Sentence count is unchanged at three, and it got shorter.** SA's note that "two is the ceiling" is respected in spirit; the third sentence survives only because **R-T11 asserts both hovers contain `runbook §3`** — dropping it, which was SA's suggested tightening, would delete the one actionable pointer the marker has.

⚠️ **Deliberately not changed:** `MARKER_SR.code` / `MARKER_LEGEND` still read *"code default — no stored value is in force for this field"*. `code default` there is the marker's **name**, not a claim about what the call sent, and the wording is the RC-2 + RC-3 reconciliation SA approved. **`TEMPERATURE_NOT_SET` ("not set — the provider default applies") is also untouched** — it is pre-existing, and S2-T3's surviving half pins it. QA's **EDGE-2** (`ISSUE_GLOSS.adjusted`, "corrected to a legal one" beside a *dropped* value) is likewise pre-existing at `a34f2572` and out of scope; it is recorded for whoever next opens `copy.ts`, as both SA (CR-6) and QA asked.

### 15.2 ⚠️ New finding — **M7 was surviving too, for CR-1's exact reason**

Re-running the matrix after CR-1 turned up a **second** rule with the same hole. It is recorded here in full because it is the thing that changed about "10 of 10".

| | |
|---|---|
| **What was claimed** | §8.2 M7: *"Re-type the exclusion reason in `adminSettingsView.ts`"* → red on `R-T13 › puts the POLICY's constant on the wire, not a copy of it`. |
| **What actually happens** | **Re-run in its realistic form — the sentence re-typed byte-for-byte, wrapped across four concatenated literals — the whole 25-suite scope stayed GREEN: 643 passed, 0 failed.** |
| **Why** | That test is `expect(excluded.reason).toBe(BOS_LLM_SETTINGS_EXCLUSION_REASON)`. It is a **value** comparison. A byte-identical copy still compares equal, so it catches **drift**, not **duplication** — and FR-14 / R-H5's property is *"referenced, never re-typed"*, which is duplication. The original M7 must have been run with a re-type that also drifted. |
| **Why it matters** | This is the R-D/R-C failure mode one file over. A second identical copy is how two wordings start out agreeing and then stop — and the drift test only fires **after** the damage, at the moment someone edits one of them. |
| **Fix** | `adminSettingsView.test.ts` gains the **source half**: the distinctive clause `invalidates every stored vector` appears **zero** times in `adminSettingsView.ts`, which must instead contain `BOS_LLM_SETTINGS_EXCLUSION_REASON`. Scanned through `flattened()`, and **proved against a planted wrapped re-type**, per the doctrine. It mirrors `modelSettingsPolicy.test.ts`'s existing `occurrences === 1` rule for the same sentence one file back — so the sentence is now pinned to exactly one home on **both** sides of the boundary. The drift test keeps its doc block, rewritten to say what it does and does **not** catch. |
| **Result** | M7 re-run unchanged → **red**, on the new source rule. |

**The generalisation, for the next person:** *an equality assertion against a shared constant never proves that the constant was used.* Both halves are needed — the value test for drift, a source test for duplication.

### 15.3 The mutation matrix, re-run in full — **12 of 12 turned a named test red**

Ten rows re-run from scratch, **M5 in its original wrapped form**, plus two new rows that prove this round's own two code fixes. Every mutation applied to a clean tree, the whole 25-suite scope run, then restored from an in-memory copy of the original file (never `git checkout` — the feature is uncommitted). Suite green at rest afterwards, verified.

| # | Mutation | Result | Test(s) that failed |
|---|---|---|---|
| M1 | Restore the hand-written `['enabled','provider','model','temperature']` filter in `CallRow` | 🔴 **8 red** | `RC-9 › CallRow.tsx holds no array literal of field names, wrapped or not`; `RC-9 › the catch-all is derived from the rendered-field list`; all **six** `R-T2 / AC-2` cases |
| M2 | Drop `aria-hidden` and the `sr-only` span from `Marker` | 🔴 1 red | `R-T11 › exposes the whole phrase to assistive technology and hides the glyph from it` |
| M3a | Widen the roll-up to render when the area is off (**RC-4**) | 🔴 1 red | `R-T7 › says it once, at area level, when the area itself is off` |
| M3b | Drop the `areaShowsOff` guard from the per-call chip (**RC-6**) | 🔴 1 red | `R-T7 › says it once, at area level, when the area itself is off` |
| M4 | `providers.size > 1` → `provider !== 'openai'` (**FR-13**) | 🔴 1 red | `R-T17 › AreaCard.tsx names no provider` |
| **M5** | **Re-type the propagation clause inline in `page.tsx` — WRAPPED across two concatenated literals, the form that survived before (CR-1)** | 🔴 **1 red — the status that changed** | `R-T3 (source half) › the propagation clause is composed, never re-typed` |
| M6 | Render `c` for a policy-locked temperature (**R-E**) | 🔴 3 red | `R-T9 › renders zero times against the real seed`; `R-T9 › never renders on a policy-locked or not-applicable temperature`; `R-T8 › leaves 35 of 44 rendered fields unmarked` |
| **M7** | **Re-type the exclusion reason in `adminSettingsView.ts` — byte-identical, wrapped (§15.2)** | 🔴 **1 red — was GREEN before this pass** | `R-T13 › does not re-type the sentence in its own source — it imports it` |
| M8 | Move the `*` from the label to the value (**RC-1**) | 🔴 2 red | `R-T10 › sits inside the field LABEL and never beside the value`; `R-T9 › DOES render for a genuinely unconfigured configurable field` |
| M9 | A third `MARKED_FIELDS` entry with no matching body (**RC-9**) | 🔴 **40 red** | A `TypeError` from `FIELD_BODIES[field](call)` — the body `Record` is a loud runtime throw, as SA said |
| **M10** | **Restore the old `c` hover, which promised the code value (QA BUG-1)** | 🔴 1 red | `R-T9 › DOES render when a resolved model dropped the temperature (adjusted, not refused)` |
| **M11** | **Drop the `?? []` tolerance on `excludedCalls` (QA EDGE-1)** | 🔴 1 red | `R-T14 › renders the card, not a blank page, when the payload omits excludedCalls` |

Two rules also carry their planted rejections **inside the suite**, so they are proved on every run rather than only when someone runs a matrix by hand: `FIELD_LIST_RULE` and the propagation rule each assert that their wrapped sample **escapes** the raw pattern and is **caught** after `flattened()`, and the new FR-14 rule asserts its planted wrapped re-type is caught.

### 15.4 Gates, re-measured after the fix pass

| Gate | Before this pass (SA's run) | After | Verdict |
|---|---|---|---|
| jest — the four touched paths | 25 suites / **639** tests / 0 failures | **25 suites / 644 tests / 0 failures** (21.9 s), 23 snapshots | ✅ **+5, −0.** Three in `source.guard`, one in `page.render` (EDGE-1), one in `adminSettingsView` (M7's source half) |
| `npm run typecheck:bos-llm` | `234 files in scope, 28 errors, 0 new` | **`234 files in scope, 28 errors, 0 new (102.6s)` · `passed`** | ✅ baseline untouched |
| `npm run check:bos-llm-literals -- --list` | `43 files in scope, 2 exempt, 1 included by name` | **identical**, exit 0 | ✅ no new exemption, no new inclusion |
| `npm run lint:hooks` | exit 0 | **exit 0**, silent | ✅ |
| `npx eslint` over 21 touched files | 0 errors / 5 warnings | **0 errors / 5 warnings — the same five sites** (2 unused icons + 1 `icon: any` in `AdminSidebar.tsx`; 2 unused disable directives in `modelSettingsPolicy.test.ts`), all pre-existing | ✅ nothing new |
| `npm run build` | `✓ Compiled successfully`; `ƒ /admin/business-os-llm 5.44 kB / 93.3 kB` | **`✓ Compiled successfully`, exit 0; `ƒ /admin/business-os-llm 5.48 kB / 93.3 kB`** | ✅ still **dynamic** (`ƒ`) in the route table. **+0.04 kB** — the `c` hover is four words shorter and the `?? []` is three characters; shared First Load JS unmoved. **This also closes QA's OBS-4**, whose `tail` had truncated the route row |
| jest — the required `admin-authz-surface` guard | 74 tests | **74 tests, 1 suite passed** (18.1 s) | ✅ untouched and green |
| Mutation matrix | 10 of 10 claimed (M5 wrongly) | **12 of 12 red** | ✅ |

**Still not run, deliberately:** `npm run lint` (**W-9** — broken repo-wide), any `bos:llm-settings set`, any migration, and **`typecheck:bos-llm --update-baseline`** (it would report the unrelated `app/api/onboarding/build/route.ts` entry as fixed; SA ruled that a separate chore, and it stays out of this commit).

### 15.5 Three things left open, on purpose

| # | Item | Disposition |
|---|---|---|
| 1 | SA CR-3 — `ExcludedCallRow.tsx:8-10` paraphrases the exclusion mechanism a third time in a doc block | **Left.** SA said *"trim it to a pointer when that file is next opened"*; opening it to trim a comment on a final fix pass would put an unreviewed edit in the diff for no behavioural gain. ⚠️ It is worth noting that **§15.2's new rule does not cover it** — the rule is scoped to `adminSettingsView.ts`, and this is prose in a third file that cannot render. |
| 2 | SA CR-4 — `markers.ts:92`'s redundant `field as SettingField` | **Left**, same reasoning: SA said "when next in the file", and `markers.ts` needed no change this pass. |
| 3 | QA EDGE-2 / SA CR-6 — `ISSUE_GLOSS.adjusted` | **Left.** Pre-existing at `a34f2572`, byte-identical, outside this round's scope. Both reviewers recorded it for the next `copy.ts` edit rather than asking for it here. |

---

## Commit Info

*[RM will populate this section]*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-24 | **Final fix pass — CR-1, CR-2, QA BUG-1, QA EDGE-1 all closed; matrix re-run 12/12 red (§15)** | **CR-1:** `flattened()` (concat seams stripped, whitespace collapsed) added **beside `codeOf()` in the shared helper**, not in the screen's test file, because it is now the normalisation three rules in two suites depend on. The propagation rule gains three `mustMatch` samples (single-line, concat-wrapped, template-wrapped); `FIELD_LIST_RULE` gains a wrapped planted sample and is asserted clean raw **and** flattened; both rules also assert their wrapped sample **escapes without** the normalisation, so deleting it turns a test red. **M5 re-run in its original wrapped form → red.** **CR-2:** §8.1's "one line" claim corrected in a superseding box — the reverse `Satisfies` **does not compile** (the client widens `area: string` against `BosLlmArea` by design), the pin stays one-directional, and a two-way option is a **key-set** pin for a later slice. **QA BUG-1:** `MARKER_TITLE.code` no longer promises a value — *"the value this call uses does not come from the stored row"* and *"takes precedence as soon as it is in force"* replace the two clauses SA and QA flagged; true in all three `default` paths, and it no longer contradicts the value line's "provider default". R-T9's `adjusted` case pins it as **two properties, not a string compare**. **QA EDGE-1:** `AreaCard` reads `excludedCalls` through **one tolerant binding** feeding both sites, with a render test that deletes the field at runtime. ⚠️ **NEW FINDING (§15.2): M7 was surviving too** — a byte-identical wrapped re-type of the exclusion reason left all 25 suites green, because the FR-14 assertion is a **value** comparison and catches drift, not duplication. `adminSettingsView.test.ts` gains the source half (clause count 0, constant referenced, flattened, proved against a planted wrapped re-type); M7 now red. **Gates:** jest **25 suites / 644 tests / 0 failures** (+5, −0 from 639); `typecheck:bos-llm` **234 / 28 / 0 new, passed**; literals `43 / 2 exempt / 1 included` **unmoved**; `lint:hooks` exit 0; `npx eslint` over 21 files **0 errors / 5 pre-existing warnings**; `npm run build` exit 0. **Left open on purpose, all Low and all "when next in that file" per the reviewers:** SA CR-3 (`ExcludedCallRow` doc block), CR-4 (`markers.ts:92` redundant cast), EDGE-2 / CR-6 (`ISSUE_GLOSS.adjusted`, pre-existing). **`--update-baseline` deliberately NOT folded in.** Nothing committed. |
| 2026-09-24 | **SA Phase 2 (code) review — ✅ Approved for QA, conditional on CR-1 + CR-2** | Reviewed against the working tree, not §13's narrative. Gates re-measured independently by SA and matching on every row run: `typecheck:bos-llm` **234 / 28 / 0 new**; literals `43 / 2 exempt / 1 included` **unmoved**; `lint:hooks` exit 0; `npx eslint` **0 errors / 5 pre-existing warnings**; jest **25 suites / 639 tests / 0 failures** over the touched paths (`build` accepted on Dev's measurement, not re-run). **Rulings on the seven referred items:** (1) the one-directional `AreaView` pin is a real, bounded gap and the finding is correct — but the proposed reverse `Satisfies` is **rejected**: it does not compile, because the client deliberately widens `area: string` against `BosLlmArea`. Pin stays as-is; a two-way option is a **key-set** pin for a later slice. (2) **M5 is a real hole, not a malformed mutation** — the propagation rule scans raw source for a single-line clause while every multi-clause string in `copy.ts` is written wrapped, and it is the only rule in that file with neither a `mustMatch` nor a planted rejection → **CR-1**. (3) RC-5's new hover **confirmed true on all three paths**, with two Low imprecisions on the unreachable `adjusted` path; Dev's second false-sentence catch was correct and SA had missed it. (4) RC-6 verified at source and in R-T7 — one `areaShowsOff` binding, three consumers, exactly one off statement on an off card. (5) the singular `1 call configured off` deviation **confirmed**. (6) RC-7 **confirmed**, and better than the ruling asked — pointer comment, file-wide uniqueness assertion, plus the fixture pinned to the policy constant. (7) `CallRow.tsx` **genuinely holds no array literal of field names** — verified by reading the file. **Also verified:** nine deleted `copy.ts` exports have no live reference and no load-bearing sentence was lost; the ledger route and panel are declared parked where the sweep looks and **no `/ledger` fetch is issued**; excluded rows carry no values and no markers; zero `console.*`, no `any`, no new pattern, no RLS/Zod/repository surface touched; the `fireEvent` + 30 s change removes no assertion and cannot turn a red test green. **Two conditions before RM: CR-1** (normalise the two source regexes, add the wrapped planted sample, re-run M5 in its original form) and **CR-2** (correct §8.1's "one line" claim). **No second SA pass; SA made no code changes.** |
| 2026-09-24 | **Implemented (uncommitted)** | T1–T15 done on `feature/business-os-llm-admin-screen-refinements`. **RC-5…RC-11 folded in and evidenced in §13.** Created `markers.ts`, `components/Marker.tsx`, `components/ExcludedCallRow.tsx`; deleted `components/FailOpenNotice.tsx` and nine copy exports; parked `LedgerCheckPanel` with dated notes in the component, the caller and the route. One payload addition (`AreaView.excludedCalls`, from two additive policy exports). **Gates (§8):** `typecheck:bos-llm` 234/28/**0 new**; literals `43 / 2 exempt / 1 included` — **unmoved**; `lint:hooks` clean; `next build` exit 0 with the route still dynamic; `npx eslint` **0 errors** and no new warnings against a `git show HEAD:` baseline; jest **26 suites / 713 tests, 0 failures** (from 547). **Mutation matrix: 10 of 10 red**, including RC-9's ninth (a body-less `MARKED_FIELDS` entry is a runtime `TypeError`) and RC-6's per-call chip. **FR-15 proved, not asserted:** dropping the field from the SERVER type fails the gate with `TS2344` while jest over that very file passes 2/2. **New finding raised for SA:** the `AreaView` wire pin is **one-directional**, so a field removed from the CLIENT type is invisible to the gate (§8.1) |
| 2026-09-24 | Created | Workplan for the SA-approved refinements requirement. Carries RC-1 … RC-4 as design decisions (D-2, D-13, D-13, D-5), closes **Q-5 by running both `get` commands against production** — `chat.calls.analysis.enabled` and `bos_llm_area_leads.enabled` are **both `true`**, so both off-state chips genuinely render zero times today — and records nine code-reality findings, three of which need an SA ruling: AC-13's arithmetic (W-1), `overrideCount()`'s field scope (W-2), and the RC-2 / RC-3 legend-wording conflict (W-3) |
| 2026-09-24 | SA Phase 1 review | 🔄 **Approve with changes.** Q-5 closed by the two production reads. Rulings: **W-1 confirmed** — AC-13 corrected to "42 of 44 resolve from the stored row; 35 of 44 carry no marker" (the arithmetic error was SA's own R-E table, not the scheme); **W-2 — narrow `overrideCount()`**, overruling RC-2's literal wording, because `--include-calls` makes the divergence reachable; **W-3 — Dev's single legend string is accepted**. Both declared deviations approved, FR-5's subject to **RC-10** (keep the stored-first ordering — the plural is already in `PROPAGATION_NOTE` and does not force a re-order). Seven new binding conditions **RC-5 … RC-11**, chief of which are **RC-5** (a third reachable `c`-with-a-stored-value path, `model_rejects_sampling_parameters`, where the hover's word "refused" is false) and **RC-6** (an off area must be the card's only off statement — a locked call resolves `enabled: true` even there) |
