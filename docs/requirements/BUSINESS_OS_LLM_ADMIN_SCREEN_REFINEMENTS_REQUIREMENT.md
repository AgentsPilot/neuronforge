# Requirement: Business OS AI Admin Screen — Refinements from First Use

> **Last Updated**: 2026-09-24

**Created by:** BA
**Date:** 2026-09-24
**Status:** **✅ SA-approved 2026-09-24 (targeted re-check passed) — ready for a Dev workplan.** The first pass was approve-with-changes; this re-issue applied every item, and the re-check leaves four conditions (RC-1…RC-4) plus one pre-implementation check (Q-5), folded in by Dev rather than re-reviewed. Where each required change landed is mapped in [BA re-issue](#ba-re-issue--where-each-required-change-landed); the rulings are in [SA Review Notes](#sa-review-notes).

## Overview

`/admin/business-os-llm` ("Business OS AI") shipped two days ago as slice 2 of the [Model Settings Admin Screen](/docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_REQUIREMENT.md) — a read-only page over the eight `system_settings_config` rows that drive every catalogued Business OS AI call. The user has now looked at the live screen and given direct feedback. This requirement turns that feedback into a scoped round of changes.

The through-line is one idea: **the screen should mark exceptions, not the normal case.** Today it labels every value with where it came from, repeats a constant on every row, warns at length about a control that is not on the page, and shows a verification panel whose only reachable state is a shrug. The result is a screen that is mostly caveat. After this round it shows what each call is set to, marks only the few things an operator has to notice, and says nothing it does not have to.

**Scope after SA review:** eight of the user's nine items (1–8). **Item 9, density, has left this round** (R-F) — the recommendation stands and is recorded in [§7](#7-density--recommendation-stands-out-of-this-round), but it ships as its own slice after these items, because those items take the call row from four value columns to two and make the right layout obvious.

**This is a presentation round with one payload addition.** Items 1–7 touch only `app/admin/business-os-llm/**` and the admin sidebar. Item 8 (surfacing the excluded embedding calls) needs a small, server-sourced addition to the `GET` payload, because the client is forbidden from holding that knowledge itself (FR-6 of the original requirement).

---

## Table of Contents

1. [What is deliberately NOT changing](#1-what-is-deliberately-not-changing)
2. [Findings from the code](#2-findings-from-the-code)
3. [User needs → changes](#3-user-needs--changes)
4. [User Stories](#4-user-stories)
5. [Functional Requirements](#5-functional-requirements)
6. [Collisions with PR #102 review decisions](#6-collisions-with-pr-102-review-decisions)
7. [Density — recommendation stands, out of this round](#7-density--recommendation-stands-out-of-this-round)
8. [Non-Functional Requirements](#8-non-functional-requirements)
9. [Acceptance Criteria](#9-acceptance-criteria)
10. [Out of Scope / Future Roadmap](#10-out-of-scope--future-roadmap)
11. [Open Questions](#11-open-questions)
12. [Notes on Integration Points](#12-notes-on-integration-points)
13. [SA Review Notes](#sa-review-notes)
14. [BA re-issue — where each required change landed](#ba-re-issue--where-each-required-change-landed)
15. [Change History](#change-history)

---

## 1. What is deliberately NOT changing

Written first, because most of this round is subtraction and the boundary matters more than usual.

| Not changing | Why |
|---|---|
| **The page stays read-only.** | It is read-only by design (slice 2). The user has not asked to change that. Every reference to changing a value still points at `npm run bos:llm-settings` and the [runbook](/docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md) §3/§4 — `READ_ONLY_NOTE` stays, verbatim. |
| **The kill switch itself.** | Still fully working, still script-only (runbook §4). Nothing in this round touches `modelSettings.ts`, `modelSettingsPolicy.ts`, the resolver, the gates or the script. Removing the *surface* does not remove the *switch* — and FR-2 keeps both **states** visible. |
| **The fail-open behaviour.** | Unchanged (Layer 2 FR-6). This round changes what the screen says about it, not what the system does. |
| **"Last changed by / actor not recorded".** | Explicitly kept by the user. `LastChangedLine`'s three states are untouched — including the fact that *"actor not recorded"* is the correct state of all eight seeded rows today (workplan §2.2), not a bug. |
| **The provider information itself.** | Relocated, not removed (FR-8) — once per area instead of once per call. |
| **The temperature lock text.** | `LOCK_TEMPERATURE_FIXED` and `LOCK_TEMPERATURE_NOT_APPLICABLE` stay, as **text**, not tooltips. Under FR-6 they become the *only* carrier of "this value is code-owned by policy", which makes them more load-bearing than they were, not less (SA C-6). |
| **`requireAdminPage` inheritance and the guard tests.** | Untouched. `app/admin/layout.tsx`, `source.guard.test.ts`'s first-statement property and the required `Admin authz surface guard` are outside this round entirely. |
| **FR-6 of the original requirement — the client imports no server module and holds no model, temperature or provider literal.** | Binding on every change below. It is why item 8 needs a payload field, why item 6 uses a caption rather than written descriptions, and why FR-8's relocation is derived from the payload rather than written down. |
| **The ledger check route, component and tests.** | Parked, not deleted (FR-3). `GET …/ledger` stays live, gated, tested — and explicitly not dead code. |

---

## 2. Findings from the code

Read 2026-09-24 off `main` at `a34f2572`. **F-7 and F-9 were corrected by SA (R-G, R-F); F-10 and F-11 are new in this re-issue.**

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| **F-1** | **There is exactly one legal provider, and adding a second is deliberately not a configuration change.** `ALLOWED_PROVIDERS_LAYER2 = ['openai']`, and every entry in `BOS_LLM_CALL_POLICY` takes `allowedProviders: OPENAI_ONLY`. The module says adding one is *"a code change, made per call, only after a test proves the provider serves that call's features — never a configuration change."* A stored row naming any other provider is refused (`provider_not_allowed`), so the **resolved** provider cannot differ from it either. | `modelSettingsPolicy.ts:24-31`, `:129-145`, `:216-227` | The `provider` field shows the same word on all 22 calls and can never show another one without a code change. It is a constant repeated 22 times. |
| **F-1b** | **No area is mixed: every call in every area has the same provider.** All 21 token calls are built by `tokenCall()`, which writes `provider: 'openai'` into `default` for every one; the single image call sets it explicitly. **8 areas, 22 calls, one provider — checked entry by entry, and re-verified by SA.** | `modelSettingsPolicy.ts:132-145`, `:166-228` | **The precondition for showing provider once per area holds.** Had any area been mixed, FR-8's relocation would have been wrong. |
| **F-2** | **Chat has six catalogued calls and the page shows two.** Four are in `BOS_LLM_SETTINGS_EXCLUDED_CALLS` and `bosLlmSettingsCallNames()` filters them out, so they never reach the payload. The count chip reads *"2 calls"*. | `callCatalog.ts:51-58`; `modelSettingsPolicy.ts:70-76`, `:289-291` | The page understates what chat does. |
| **F-3** | **The exclusion is about configurability, not secrecy.** The four embeddings keep the shared `helpbot_embedding_model` key because *"changing an embedding model invalidates every stored vector … so it is a data migration, not a setting"*. Chat's area switch still stops them, at route entry. | `modelSettingsPolicy.ts:62-76` | Showing them **read-only** on a **read-only** page cannot create a second door. The reason is already written and should be rendered, not re-worded (see F-11b / FR-14). |
| **F-4** | **The fail-open banner's strings are entirely switch-framed — but the mechanism is not.** All four are about the switch. The same read failure also puts **provider, model and temperature** back on their code defaults — which is what the onboarding card's `LOCK_AREA_FAIL_OPEN` already says. | `copy.ts:24-39`, `:83-97`, `:110-114` | The banner can go with its subject; one quiet line must survive. FR-5. |
| **F-5** | **The ~60-second propagation note lives only inside the ledger panel.** `PROPAGATION_NOTE` is imported by `LedgerCheckPanel` and nothing else. | `copy.ts:157-163`; `LedgerCheckPanel.tsx:48`, `:236-238` | **Parking the panel silently deletes FR-20 from the page.** It must be relocated, from the same constant. FR-5, R-D. |
| **F-6** | **`CallRow` renders issues by field, and anything outside the four named fields falls into a catch-all.** `otherIssues` filters `!['enabled','provider','model','temperature'].includes(issue.field)`. | `components/CallRow.tsx:92-94` | Remove the `enabled` and `provider` fields without fixing this and a `provider_not_allowed` refusal or a `locked` enabled issue **disappears from the page**. FR-1, R-C. |
| **F-7** | ⚠️ **Corrected by SA (R-G).** **Temperature is not merely DB-*configurable* — it is already DB-*resolved* for 20 of 22 calls.** `'free'` is **20** of 22 (chat 1, insights 3, briefing 1, website 8, intake 2, leads 1, onboarding 4), not 16; and per R-E the value comes from the stored row for 20 of 22 calls today (4 call-level + 16 area-level). The seed wrote a temperature for seven of the eight areas. | `modelSettingsPolicy.ts:82-98`, `:166-228`; seed migration `20261003_seed_bos_llm_area_settings.sql` | *"Temperature needs to move to the DB"* is **already done** for every call that can have one. Only two calls are code-owned, by design. §10 says so in those terms. |
| **F-8** | **`planner`'s temperature is locked at 0 on purpose** (*"0.3 recovered only 1 run in 4, and the plan cache relies on a stable plan"*); `images/image_generation` is `'not_applicable'`; the four onboarding extractors send **no** temperature — but their area row stores `temperature: NULL` explicitly, and `readField` uses `hasOwnProperty`, so they resolve at **area** level, not `default`. Seeding a number there would change behaviour. | `modelSettingsPolicy.ts:170-175`, `:208-227`; `modelSettings.ts:455-458` | Two calls are permanently code-owned; the onboarding four are correctly configured **as null**. Both facts drive FR-6's marker scheme. |
| **F-9** | ⚠️ **Corrected by SA (R-F).** **`app/admin/` holds 22 `page.tsx` files, not eleven**, and all of them use raw Tailwind slate tokens rather than the V2 design system. `components/ui/` has `badge.tsx` and **no** `table.tsx`. | SA count at `a34f2572`; audit-trail density proposal §5 | A density rule applied to two pages and not the other ~20 needs to be a written standard. [§7](#7-density--recommendation-stands-out-of-this-round). |
| **F-10** | 🆕 **A call-level "off" state exists, is reachable by the documented emergency procedure, and FR-1 would make it invisible** (SA R-H1). `resolved.enabled` is false per call whenever the row holds `calls.<name>.enabled: false`. Two live paths: the seed copies legacy `bizchat_analysis_enabled` into `calls.analysis.enabled`; and `bos:llm-settings -- set <area> --enabled false --include-calls` writes `enabled: false` into **every** call override, after which a later `--enabled true` restores only the **area** flag and leaves the call flags off. | `modelSettings.ts:713-726`; seed migration `:135-140`; `scripts/bos-llm-settings.ts:294-303` | With the `enabled` field gone and the area reading *on*, the page would present a model and a temperature for a call that is not running. **FR-2 gains a call-level counterpart.** |
| **F-11** | 🆕 **There is no tooltip primitive in this repo.** `components/ui/` has 14 components and no tooltip; there is no `Tooltip*.tsx` anywhere in the tree; and `@radix-ui/react-tooltip` is **not** a dependency (the installed Radix set is checkbox, dialog, icons, label, select, switch, tabs). | `components/ui/*`; `package.json` dependencies | The user's hover request is satisfied with the `title` attribute the approved accessibility rule **already requires** — the enrichment is in the *content*, not a new mechanism. Adding a real tooltip primitive would be a new dependency and a new pattern (CLAUDE.md rule 7). FR-6, §10. |
| **F-11b** | 🆕 **FR-9's reason sentence already exists in the policy module, as a comment** (SA R-H5). | `modelSettingsPolicy.ts:62-69` | Export it as a constant and put *that* on the wire, so the policy's reason and the screen's reason cannot become two sentences. FR-14. |

---

## 3. User needs → changes

The need is recorded before the change in every row, because several of these only make sense against the need.

| # | The need, in the user's terms | The change |
|---|---|---|
| 1 | *"It complicates the screen and nobody is using it from here."* The switch is operated from the script; a read-only mirror of it costs a column, a badge, a per-card caveat and a banner. | Remove the `ENABLED` field, the `switch locked` badge, the `Cannot be switched off` chip, the inline fail-open caveat and the top banner. **FR-1, FR-5** |
| 2 | *"But an area that is switched off must still be visible somehow"* — the page must not present settings for something that is not running. | An exception-only `Configured: off` chip — **at area level and, per SA R-H1, at call level too**. **FR-2** |
| 3 | *"Hide it, but I want it back later."* Every card answers *"Too long ago to check"* on load — eight shrugs. | Unmount the panel; keep the component, the route, the copy module and every test. **FR-3** |
| 4 | Keep the attribution line. | Unchanged. **FR-4** |
| 5 | *"I read `call override` / `code default` as which settings have been migrated to the database."* The badges answered a question the user was not asking. *"Everything ends up configured in the DB, so the DB should be the assumed default."* | Mark on the **database-vs-code** axis, not call-vs-area: no marker for any stored value, `c` only for a genuinely unconfigured field, `*` for the rare per-call override. **FR-6** |
| 5b | *"If we do show some kind of indication, I wonder if we add a tooltip that gives a little bit more colour to what that indication means when hovering over it."* | Each marker's hover text explains the **consequence**, not the label. Enrichment of the approved rule, never a replacement for the legend. **FR-6** |
| 6 | *"`planner` and `analysis` meant nothing to me."* Not a request for invented prose. | A caption: `LLM code call name` before the identifier. **FR-7** |
| 7 | *"Mention the provider on the section level and remove it from each call line … and since this cannot be changed, skip the `c` indicator for now."* | Provider moves to the area header, leaves the call rows, carries no marker. **FR-8** |
| 8 | *"The page implies chat makes 2 calls when it makes 6."* | Surface the four excluded embedding calls, greyed, read-only, with the real reason. **FR-9, FR-14** |
| 9 | *"Too airy."* | **Out of this round** (R-F). Recommendation recorded in [§7](#7-density--recommendation-stands-out-of-this-round); ships as its own slice after 1–8. **FR-10 withdrawn** |

**Added by SA review, not by the user** — each is a thing this round would otherwise leave false or unenforced: the page subtitle (**FR-11**), the sidebar description (**FR-12**), an enforceable rule against a provider literal (**FR-13**), one home for FR-9's reason string (**FR-14**), and the typecheck gate as a workplan step rather than a note (**FR-15**).

---

## 4. User Stories

- As a **platform admin**, I want to open this page and read what every Business OS AI call is set to without first reading three paragraphs about a control that is not on the page, so that the screen is useful in the thirty seconds I actually have.
- As a **platform admin**, I want the page to mark only what I have to act on — a value that is not configured at all, or one pinned to a single call — so that everything unmarked is, correctly, "configured and normal".
- As a **platform admin hovering over a mark I do not recognise**, I want to be told what it means *for me*, not what it is called, so that I learn the consequence rather than the vocabulary.
- As a **platform admin who switched an area off with `--include-calls` and back on again**, I want the page to show me the calls that are still off, so that I am not reading settings for a call that is not running.
- As a **platform admin**, I want to be told the provider once, where it is true for the whole area, rather than twenty-two times in a column that never varies.
- As a **platform admin**, I want to know what kind of identifier `planner` is, so that I can find the same string in the usage ledger and in the code.
- As a **platform admin**, I want to see every AI call chat makes — including the ones I cannot configure here — so that the page does not understate what the platform is doing.

---

## 5. Functional Requirements

### (a) Removing the switch surface

1. **FR-1 — The on/off switch *control* surface is removed from the page.** Specifically: the `enabled` field in `CallRow` (the disabled checkbox, its label, its provenance badge), the `switch locked` chip, the per-call `LOCK_CALL_NOT_SWITCHABLE` reason line, and the `Cannot be switched off` chip on `AreaCard`. `LOCK_AREA_NOT_SWITCHABLE` and `LOCK_CALL_NOT_SWITCHABLE` are deleted from `copy.ts`.
   - **What is removed is the control mirror, not the state.** FR-2 keeps both off-states visible as exception-only chips. The user's *"nobody is using it from here"* is about operating the switch; it is not a licence to hide a call that is not running.
   - **A code comment records the decision** in `AreaCard.tsx` — that the screen deliberately no longer mirrors the switch control, that the switch is unchanged and script-only (runbook §4), and that slice 3 must restore the full FR-17 treatment when a real control lands. **Per R-A condition 3 the comment is not the primary record:** the obligation is written into the approved requirement as well (see FR-16 / §12).
   - ⚠️ **F-6 / R-C is binding, in three parts:**
     1. **Do not hand-narrow the filter to `['model','temperature']`.** That is the same two-lists-must-agree shape that created the bug. Derive the catch-all from the single constant the render uses — one `RENDERED_FIELDS` array, or literally *"issues not consumed by a rendered field"* — so it cannot drift a second time.
     2. **The catch-all must render `issue.field`.** It prints `reason` + gloss today, which was sufficient when it could only hold `calls` / `row`. Once `enabled` and `provider` issues land there, a bare *"this field is owned by the code"* with no field named is not actionable.
     3. The issue kinds it must now carry are real and enumerated: `call_not_switchable` / `area_not_switchable` (`modelSettings.ts:704-712`), `enabled_not_a_boolean` (`:721`) and `provider_not_allowed`.
2. **FR-2 — An off state is visible at both levels, as an exception, honestly.**
   - **Area level.** The state chip renders **only** when `switchable && !configuredEnabled`; `Configured: on` and `Cannot be switched off` are dropped. The surviving chip keeps its wording, `Configured: off`, **verbatim** — FR-16 of the approved requirement forbids the page from asserting that an area *is* off, and that wording was reviewed for exactly that. Beside it, one sentence, on that card only:
     > `"Off" is what the row says. An instance that cannot read these settings on startup starts with every area on (runbook §5).`
   - **Call level (R-H1, binding).** A call row whose `resolved.enabled === false` carries the **same** chip, `Configured: off`, with the same discipline — it describes the row, never the fleet. Its hover/sr text: *"The stored row switches this call off. That is what the row says, not what the fleet is doing (runbook §5)."*
     - **Why this is not a reversal of item 1:** what the user asked to remove is the *control mirror* on all 22 rows — a disabled checkbox, a label and a lock badge on every call, whether or not anything is switched off. This chip appears only when something actually is. F-10 shows the state is reachable by the documented emergency path, and the `--include-calls` trap (area back **on**, calls still **off**) is precisely the case where a page showing a model for a dead call would be lying.
   - **BA addition, for the re-check.** An area card whose calls are all resolving *on* looks identical to one hiding an off call until it is expanded. So the **collapsed** card carries an exception-only roll-up chip — `N calls configured off` — when any call in it is off. It costs nothing when nothing is off, and without it R-H1's fix requires opening eight cards to find the thing it exists to surface.
   - **Rejected alternative:** greying or dimming an off card or row. Grey is spoken for by FR-9 (*catalogued but not configurable here*); one page cannot make grey mean two things.
3. **FR-3 — The Ledger Check panel is parked, not deleted.** Parking means, precisely:
   - `components/LedgerCheckPanel.tsx` stays, unmodified except for a header note. `lib/business-os/llm/ledgerCheckCopy.ts`, `app/api/admin/business-os/llm-settings/ledger/route.ts` and all their tests stay and stay green — `ledgerPanel.render.test.tsx` renders the component directly, so SA F-6's eight-branch table keeps biting.
   - The only change is in `AreaCard.tsx`: the element and its import are removed, replaced by a comment naming the date, the reason (*"every area's only reachable state today is `too_long_ago`; the panel becomes informative again when slice 3 makes this page a writer"*), the fact that re-mounting is one line plus one import, **and (R-D) that slice 3 must not then render `PROPAGATION_NOTE` twice** — the header carries it while the panel is parked.
   - The panel's own header gains a `PARKED` note saying the same, so a reader who opens the file first is not hunting for a caller.
   - **No feature flag.** A flag for one JSX element on an internal read-only page would be a new runtime pattern (CLAUDE.md rule 7); parking is a one-line edit in both directions.
   - **The ledger route is not dead code, and that is recorded where the sweep will look (C-8 condition):** in the route's own file header, as well as here. Slice 3 is its caller.
   - **FR-18, FR-19, AC-17 and AC-18 of the approved requirement become "built, tested, not mounted"** — declared, per the disposition SA required of D-3/D-8 (*"what was wrong was leaving it undeclared"*).
4. **FR-4 — "Last changed by X at Y" is unchanged.** `LastChangedLine`, its three states, `formatInstant`'s null handling and both render sites stay exactly as reviewed. No copy edit.
5. **FR-5 — The fail-open banner is removed, and one quiet line survives in its place.**
   - `FailOpenNotice` (both variants), `FAIL_OPEN_HEADLINE`, `FAIL_OPEN_BODY`, `FAIL_OPEN_ACTION`, `FAIL_OPEN_INLINE` and `LOCK_AREA_FAIL_OPEN` are deleted.
   - **The reasoning, verified and confirmed by SA:** all four strings are switch-framed (F-4), and FR-17's own wording is *"one sentence beside every switch"* — with no switch on the page that obligation is **vacuous, not violated**. This is materially different from the failure `FailOpenNotice` was built against (a warning dismissed while its control stays on screen), so nothing SA F-3/F-7/F-8, QA DEF-S2-3 or SA R-2 protected is weakened.
   - **The replacement line**, muted, under the page header:
     > `These are the stored settings. A running instance picks a change up within about 60 seconds, and one that cannot read these settings on startup falls back to the values in code (runbook §5).`
   - Four things in it are load-bearing and must survive any copy edit: *stored* (not fleet state), *~60 seconds*, *falls back to **code***, and **"on startup"** — which SA F-8 called load-bearing. **The `(runbook §5)` pointer is a binding R-A condition**: the banner was the only surviving route to fleet-level truth, and FR-2's sentence, which also carries it, renders zero times today.
   - **R-D:** the propagation clause is rendered **from `PROPAGATION_NOTE`**, not re-typed. If the header needs a trimmed form (the constant's second clause is ledger-specific), the trim is a **second exported constant**, never an inline string, or the header and the panel will drift the day the panel returns.
   - ~30 words against the banner's ~180, not styled as a warning, and nothing to dismiss. It satisfies FR-20, which would otherwise be lost with the panel.

### (b) Reading the values

6. **FR-6 — Markers are on the database-vs-code axis. ⚠️ Rewritten per SA R-E; the first draft's premise was refuted by the seed data.**

   **Why the first draft was wrong, in one paragraph.** It marked *call vs area*, assuming call-level was the common case. SA resolved this deterministically from `20261003_seed_bos_llm_area_settings.sql` against the resolver: **`area` dominates** — model is 5 call / 17 area / 0 default, temperature 4 call / 16 area / 2 default. The drafted scheme would have marked **33 of 44** fields (11 `i` markers on the website card alone), and its stated payoff was unreachable: both `c` cases (`chat/planner`'s locked 0, `images`' not-applicable) are **permanently code-owned**, so the "migration progress" it advertised could never complete. It would have grown a permanent "not migrated" nag and re-created the user's original misreading in a new costume. The axis the user actually cares about — *"everything ends up configured in the DB"* — is **database vs code**.

   | Case | Count today | Treatment |
   |---|---|---|
   | Resolved from the **stored row**, at either level | **42 of 44** | **No marker.** The page is clean on day one, not after a migration that has already happened. |
   | **Code default on a configurable field** | **0** | **`c`** — the real migration signal, correctly rendering nowhere today. |
   | **Code-owned by policy** — `locks.lockedTemperature !== null` or `locks.temperatureNotApplicable` | **2** | **No `c`.** `LOCK_TEMPERATURE_FIXED` / `LOCK_TEMPERATURE_NOT_APPLICABLE` already say it, as text, and C-6/FR-12 requires that text to stay. Both booleans are already in the payload — no new field, no client-side knowledge. |
   | **Set on this call specifically** | **9** | **`*`** — exception-only, and the one genuinely *actionable* case: an operator who changes the area value via runbook §3 and expects these to move will be wrong. |

   - **Glyph choice (BA's, per SA).** `*` for the call-level case — an asterisk is conventionally *"there is a note about this one"*, and the legend is literally that note. It is neither `i` nor `c`, needs no new import, and sits in the same monospace run as `c`. *Rejected:* the lucide `Pin` icon (semantically good, but mixes an icon vocabulary into a two-glyph run for no gain) and `i` (nothing is being marked as inherited any more). *Noted risk:* an asterisk can read as "required field" — negligible on a page with no inputs, and the legend is adjacent.
   - **Legend, at the point of use** — one muted line directly under the `Calls` heading inside the expanded card:
     > `No marker: set in the stored settings · * set on this call — the area value does not apply to it · c code default, not in the database`
     Only one card expands at a time, so exactly one legend is ever on screen. A page-header legend is rejected: far from the markers, read once, then forgotten. **The call-level label deliberately does not pair a "code" word with a "database" word** (R-E constraint) — that pairing is what produced the user's misreading.
   - **Accessibility (approved, unchanged, binding).** A glyph is never the only carrier: each marker has an `sr-only`/`aria-label` phrase **and** a `title` **and** the legend, and is distinguished by glyph, never by colour alone.
   - **Hover explanation (the user's addition).** The marker's hover text explains the **consequence**, not the label — the legend already carries the label. Exact wording:
     | Marker | Hover / `title` text |
     |---|---|
     | `*` | `This value is set on the call itself. Changing the area's value (runbook §3) will not move it — this call has to be changed on its own.` |
     | `c` | `Nothing is stored for this field, so the call is running on the value written in code. Setting it in the area row (runbook §3) takes precedence from then on.` |
     **Three constraints, and how each is met:**
     1. **Hover alone is not sufficient** — it fails on touch and is inconsistently keyboard-reachable. It is *enrichment*: the legend and the `sr-only` phrase remain independently sufficient, exactly as the approved rule requires, and **the meaning must never live only in the hover**. An AC asserts the legend alone still conveys each marker.
     2. **Content is the consequence, not a restatement.** Both sentences name what the operator would get wrong and what to do instead; neither repeats the legend's words.
     3. **Mechanism is the `title` attribute (F-11).** There is no tooltip primitive in the repo, no `Tooltip*.tsx`, and `@radix-ui/react-tooltip` is not a dependency — adding one is a new dependency **and** a new pattern needing SA review (CLAUDE.md rule 7). `title` is an acceptable v1 **because the approved rule already requires it**: the user's ask is satisfied by making that string explanatory rather than a label echo — richer content through the mechanism already specified, zero new pattern. `Chip.tsx` already takes a `title` prop documented *"never the ONLY place a reason appears"*. A real tooltip primitive is recorded in §10.
   - **Q-2 ruling applied.** `N with a call override` must not survive; `N on code defaults` is **not** shipped (under the real data it reads `0` on six areas and a permanent `1` on `chat` and `images` — an uncleatable nag). The collapsed-card chip keeps counting the **call-level** case with wording that cannot be read as migration status: **`N set per call`**, rendered only when `N > 0`. It is the `*` signal one level up, and it warns before expanding that changing the area value will not move everything.
   - The inline `(code default: <model>)` hint beside a configured model **stays** — the only place an operator can see what *"back to where I started"* is.
7. **FR-7 — Call names carry a caption.** `CallRow`'s header renders a label in the muted style the field labels already use, then the identifier in monospace:
   > `LLM CODE CALL NAME`  `planner`
   - Exact label string: **`LLM code call name`** (uppercased by the existing class) — the user's own phrasing, and accurate: it is a code identifier, the Layer 2 configuration key, and the `component` value in `token_usage`.
   - **No invented per-call descriptions** — beyond the user's preference, a per-call prose table in a `'use client'` file is exactly the hardcoding FR-6 of the approved requirement prevents (the reasoning that deferred D-3/D-8). If descriptions are ever wanted they come from the payload.
   - One clause may be appended to the legend line: *"call names are the identifiers in code, and the `component` value in the usage ledger"* — answering *"what is this string"* once per screen rather than 22 times.
8. **FR-8 — The provider moves to the area header and leaves the call rows. It carries no marker.**
   - **Removed** from `CallRow`: the `provider` field, label, value and badge — 22 repetitions of one word in the page's most expensive space.
   - **Added** to `AreaCard`'s collapsed summary line, beside the model summary already there: `provider openai · model gpt-4o-mini`.
   - **No marker of any kind on it.** Provider is not configurable at any level (F-1); a `c` would invite an operator to try, and would make FR-6's axis mean two things. This is the user's own instruction and it is also the correct reading of the policy.
   - **Precondition checked, not assumed (F-1b):** 8 areas, 22 calls, one provider. Had any area been mixed the relocation would have been wrong.
   - **The area value is derived from the payload and defends itself.** It is the distinct set of `resolved.provider` across the area's calls. One value → render it. **More than one → the precondition has failed for that area, so the header reads `varies by call` and the per-call field returns for that area**, mirroring how `areaModelSummary()` already handles a varying model. **This is what brings the per-call provider back: a second entry in `ALLOWED_PROVIDERS_LAYER2`, i.e. the day two calls in one area genuinely differ.** Automatic, by data — nothing to remember.
   - ⚠️ **The condition must never compare against a provider name:** `providers.size > 1`, never `provider !== 'openai'`. **FR-13 makes that enforceable** — today nothing would catch it.
   - ⚠️ **F-6/R-C again:** an issue whose `field` is `provider` must land in the call-level issue list with its field named. A refused provider stays visible even though the field does not.
9. **FR-9 — The four excluded embedding calls are shown, greyed and non-editable.**
   - `plan_cache_lookup_embedding`, `plan_cache_store_embedding`, `verified_question_embedding` and `verified_question_store_embedding` appear under the chat card's `Calls` section, below the two configurable calls, in a muted (`quiet`) treatment — **not** amber, not an error or warning style. They carry the FR-7 caption, and (C-7 condition) **no value fields and no markers**.
   - Each carries one line stating why, **sourced from the server** (FR-14):
     > `Not configurable here — changing an embedding model invalidates every stored vector, so it is a data migration, not a setting. These calls keep the shared helpbot_embedding_model key, and chat's area switch still stops them.`
   - **This requires a payload change and cannot be done any other way.** The client may not import `modelSettingsPolicy`, so it cannot know which calls are excluded or why. `GET /api/admin/business-os/llm-settings` gains, per area, a list of `{ callName, reason }`, built in `adminSettingsView.ts`. `types.ts` gains the wire type; the compile-time pin keeps the two in step — **and that pin is the gate, not jest (FR-15)**.
   - **The count chip counts every catalogued call of the area** — `6 calls` for chat — because the chip answers *"what does this area do"*. C-7 condition: the `2 calls` → `6 calls` change is checked against the existing render assertions.
   - Safe because the exclusion is about **configurability, not visibility** (F-3), and because the page is read-only: rendering a non-configurable call cannot create a second door. It does change a line of the approved requirement — see C-7.
10. **FR-10 — ❌ WITHDRAWN from this requirement (SA R-F).** Density leaves this round; see [§7](#7-density--recommendation-stands-out-of-this-round) and §10. The number is retired rather than reused, so that R-F's disposition stays legible.

### (c) Requirements added by the SA review

11. **FR-11 — The page subtitle is rewritten (R-H2).** `page.tsx:80-83` currently reads *"Provider, model, temperature and the on/off switch for every catalogued Business OS AI call — showing the value each call will actually use, and where that value came from."* After FR-1, FR-6 and FR-8 every clause is wrong or half-wrong, and **nothing in `page.render.test.tsx` asserts it**, so it would ship stale and green. Replacement:
    > `The model and temperature every catalogued Business OS AI call will actually use, and where each value comes from. Provider is shown per area; the on/off switch is changed with the runbook, not here.`
    The second sentence is deliberate: it answers *"where did the switch go"* for the one reader who remembers it was there.
12. **FR-12 — The sidebar description is corrected (R-H3).** `AdminSidebar.tsx:155` describes the page as `'Models & Switches'`, and `nav.test.ts` pins the href and ordering but **not** the description — so this too ships stale and green. New string: **`'Models & temperatures'`**. `nav.test.ts` gains an assertion on the description so it cannot drift again. §12's integration table is corrected accordingly — `AdminSidebar.tsx` and `nav.test.ts` **do** need edits, contradicting the first issue of this document.
13. **FR-13 — "No provider literal" becomes enforceable (R-H4).** `tests/helpers/bos-llm-literal-rules.ts` has five rules (model ids, `z.enum`, `switch case`, price-index keys, temperature literals) and **none** matches a provider name, so `provider !== 'openai'` would pass `source.guard` silently. A provider-name rule is added to **the screen's own `source.guard` scan**, not to the shared `LITERAL_RULES` (which the route also consumes). It follows that file's `mustMatch` convention — the rule carries a sample it is asserted to match — because two rules in that file were once dead regexes that read as coverage.
14. **FR-14 — FR-9's reason string has exactly one home (R-H5).** The sentence exists today as a comment at `modelSettingsPolicy.ts:62-69`. It is exported as a constant beside `BOS_LLM_SETTINGS_EXCLUDED_CALLS`, and `adminSettingsView.ts` puts **that constant** on the wire. It is not re-typed into the view builder, or the policy's reason and the screen's reason become two sentences that drift.
15. **FR-15 — The typecheck gate is a workplan step, not a note (R-H6).** After touching `types.ts` or `adminSettingsView.ts`, **`npm run typecheck:bos-llm` is the gate and a green `npm test` proves nothing** — ts-jest emits no diagnostics under this config. This bit slice 2 twice (SA F-4, QA DEF-S2-9). The Dev workplan carries it as an explicit task with its output recorded, not as a sentence in an NFR list.
16. **FR-16 — The slice-3 restoration obligation is recorded in the approved requirement (R-A condition 3).** A code comment in `AreaCard.tsx` is a weak carrier, because slice 3 is the change most likely to rewrite that file. An explicit, dated, **unchecked** obligation is added under **FR-17 and AC-16 of [BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_REQUIREMENT.md)**: *"slice 3 restores the banner, the inline sentence and the FR-15 confirmation sentence in the same change that puts a control on the page."* The code comment stays as well; this is in addition, not instead.

---

## 6. Collisions with PR #102 review decisions

Each row removes or changes something a prior review deliberately put there. **SA has now ruled on all eight; the rulings and their conditions are folded in below.**

| # | What PR #102 decided, and who | What this round does | Ruling and conditions |
|---|---|---|---|
| **C-1** | **FR-17 / AC-16 — a standing, undismissible fail-open sentence "beside every switch", plus the banner.** Hardened by SA **F-3**, **F-7**, **F-8**, QA **DEF-S2-3**, SA **R-2**, and the *"reorder, not cut"* length ruling. Undismissible **by construction**. | Removes the banner, the inline notice and all five strings. | ✅ **Approved (R-A), with three binding conditions.** SA re-verified both halves of F-4: FR-17's obligation is *"beside every switch"*, so with no switch it is **vacuous, not violated**. Conditions: (1) the residual non-switch truth survives in FR-5's line, and slice 3 restores the full treatment; (2) **FR-5's line must end with `(runbook §5)`** — the banner was the only remaining route to fleet-level truth and FR-2's sentence renders zero times today; (3) **the slice-3 obligation is recorded in the approved requirement under FR-17/AC-16, dated and unchecked — not only in a code comment** (FR-16), because slice 3 is the change most likely to rewrite that comment. |
| **C-2** | **FR-20 / S2-T11 — the ~60-second propagation statement.** | Would be deleted as a side effect of parking the panel (F-5). | ✅ **Confirmed (R-D).** Not a reversal — an accident this document catches. Conditions: render it **from `PROPAGATION_NOTE`**, never re-typed; if trimmed for the header, the trim is a **second exported constant**; and the FR-3 parking comment must record that slice 3 must not then render it twice. |
| **C-3** | **FR-16 / AC-16 / S2-T8 — the screen never claims an area is off; the chip reads `Configured: off`.** | Keeps the chip and its exact wording; renders it only in the off case; drops `Configured: on` and `Cannot be switched off`; **adds the same chip at call level** (R-H1). | ✅ **Approved.** FR-16 constrains *what the page may say*, not how often. The surviving chips keep the reviewed wording verbatim, at both levels. **S2-T8's page-wide string scan stays** — it costs nothing and it is the only thing stopping a future edit reintroducing "Disabled". |
| **C-4** | **QA DEF-S2-4 — the onboarding card's `LOCK_AREA_NOT_SWITCHABLE` + `LOCK_AREA_FAIL_OPEN` pair.** | Deletes both with the rest of the switch surface. | ✅ **Approved.** The contradiction cannot recur once neither sentence exists, and the still-true half (a read failure reverts provider **and** model) is generalised correctly in FR-5 — it was always true of all eight areas, not only onboarding. |
| **C-5** | **FR-4 / D-2 / AC-4 / S2-T3 — a provenance badge on each of four fields, labelled `call override` · `area` · `code default`.** | Replaces it with FR-6's database-vs-code scheme, on two fields. | 🔄 **Rewording approved in principle (R-B); the first draft's scheme rejected (R-E) and rewritten.** Binding conditions: (1) **AC-4 and S2-T3 are superseded with a dated note naming this document** — *"superseded 2026-09-24 by …REFINEMENTS…, FR-6"* — and the old text stays visible, never silently edited, so PR #102's audit trail stays readable; (2) the replacement is R-E's scheme, not the first draft's; (3) **D-2's distinction survives in R-E's form** — `c` still marks a code-owned value, `*` still marks the per-call case that D-2's operational half is about; (4) **S2-T3's second half (`temperature: undefined` → *"not set — the provider default applies"*) is unaffected and must keep biting.** The `ProvenanceLevel` wire type and the per-field `provenance` record are **not** changed — this is rendering only, so slice 3 can render more without a route change. |
| **C-6** | **FR-12 / AC-12 / S2-T6 — locked controls disabled with their reason **as text**, never tooltip-only.** D-13: a hidden lock reads as *"this does not exist"*. | Removes the `enabled` lock rendering, because the field is gone. | ✅ **Approved as a narrowing, not a withdrawal.** D-13's hazard does not apply to a field the page no longer renders — and FR-8 answers it for the provider by stating the fact once per area. ⚠️ **Under FR-6 the two temperature lock texts become the *only* carrier of "this value is code-owned"**, which makes AC-12 more load-bearing than it looks: it must not be reduced to a tooltip, here or in the density slice. |
| **C-7** | **The screen sketch: "One row per configurable call of the area (embeddings excluded, DEC-3)".** | Shows the four excluded calls, read-only. | ✅ **Approved.** The sketch excluded them from an *editor*; *not configurable here* ≠ *not worth knowing about*, and F-2 shows the second claim is false. Rendering the server's own reason teaches DEC-3 instead of silently enacting it. Conditions: the four rows carry **no value fields and no markers**, and the `2 calls` → `6 calls` change is checked against the existing render assertions. |
| **C-8** | **FR-18 / FR-19 / AC-17 / AC-18 — the ledger panel**, plus SA **F-6**'s eight-branch table and RC-D's neutral refusal state, each mutation-proved. | Unmounts the panel. | ✅ **Approved.** "Built, tested, not mounted" is the declaration SA required of D-3/D-8; no feature flag (a new runtime pattern for one JSX element). Condition: **`GET …/ledger` must not be removed as dead code, and that is recorded in the route's own header** as well as here — the next dead-code sweep reads the route, not the requirement. |

**Also confirmed correct, for the record (SA):** F-1b's precondition check, deriving the area provider from the payload rather than re-adding the field RC-C deliberately removed, the rejection of a per-call prose table in a `'use client'` file, the rejection of greying the whole card in FR-2, and §8's NFRs as written. **Not in collision and untouched:** the `requireAdminPage` first-statement guard, the `source.guard` FR-6 assertions, the wire-type pin, `Chip.tsx`'s measured reason for not using `components/ui/badge.tsx`, and `LastChangedLine` in full.

---

## 7. Density — recommendation stands, out of this round

The user raised the same complaint here and on `/admin/audit-trail`, and agreed density should be **one shared effort**. There is a measured proposal for the audit page ([ADMIN_AUDIT_TRAIL_ROW_DENSITY_PROPOSAL.md](/docs/workplans/ADMIN_AUDIT_TRAIL_ROW_DENSITY_PROPOSAL.md), Option B — a table; 3 rows on a 1080p screen today, a 302px always-expanded filters card).

**SA approved the recommendation and removed it from this requirement (R-F).** FR-10, and the two ACs that went with it, are withdrawn — not a scope cut but the Q-4 answer made structural: *a requirement whose acceptance criterion blocks on SA approval of a document that does not exist yet cannot be handed to Dev.* **Items 1–8 ship first.**

### The recommendation, unchanged: a shared **standard**, applied by each page in **its own slice**

| Reason | Detail |
|---|---|
| **The audit proposal's own argument applies symmetrically.** | It refuses to fold density into Slice A because *"the re-review cost exceeds the cost of a second cycle"* and *"they are different review lenses"*. Folding the audit page into this round is the same mistake with the operands swapped. |
| **There is no shared code to write.** | A flat homogeneous list and a three-level accordion share no component. `components/ui/` has `badge.tsx` and **no `table.tsx`** (SA-confirmed), and adding a table primitive is a new pattern needing SA review. Without shared code, "one slice" is two unrelated edits under one lens. |
| **The page count argues *for* the doc.** | ⚠️ Corrected per R-F: `app/admin/` holds **22** `page.tsx` files, not eleven, all on raw slate tokens. So the standard governs ~20 other pages. Two pages densified in one PR leaves ~20 different with nothing written down; a standard makes them **conformant-when-next-touched** rather than wrong. |
| **A standard is cheap and reusable.** | The rules are already latent in the audit measurements: a type scale, a padding scale, a row-pitch target, *"a homogeneous list is a table, not a stack of cards"*, *"a badge marks the exception, not the norm"* (items 5 and 7, generalised), *"state is never colour-alone"*, and *"the disclosure control is keyboard-reachable"* (a pre-existing defect on both the audit page and `admin/users`). |

**Sequence:** (1) `docs/ADMIN_SURFACE_DENSITY_STANDARD.md` goes to SA on its own — one page, tables of numbers, minimal prose, and it must prescribe **rules, not a layout**, or it will over-fit the audit page; (2) `/admin/audit-trail` implements it in the planned `feature/admin-audit-row-density` slice; (3) `/admin/business-os-llm` implements it in a following slice, where the first application is turning the `Calls` section into a table — `LLM code call name` · `model` · `temperature`, markers inline — which items 1 and 7 make the obvious shape by taking four value columns down to two; (4) the other ~20 pages adopt it when next substantively touched. The measured before/after discipline travels with each table slice.

---

## 8. Non-Functional Requirements

- **Security:** unchanged. No new route, no new write path, no widening of what an admin can do. The page stays read-only; the only payload addition (FR-9) is four call names and one static reason string, all server-derived, none tenant data.
- **Tenant isolation:** unchanged. The one deliberate cross-tenant read in this feature is the ledger aggregate, which this round **stops calling** from the UI.
- **FR-6-of-the-approved-requirement conformance (binding):** the client gains no server import, no model name, no temperature and **no provider name**. `source.guard.test.ts` must still pass — the excluded-call list and its reason come from the payload, and FR-8's condition compares payload values to each other, never to a literal. **FR-13 makes the provider half enforceable**, which it is not today.
- **Type safety:** `npm run typecheck:bos-llm` **0 new** with the baseline unchanged; `npm run check:bos-llm-literals` passes with **no new file exemption and no new inclusion**; `npm run lint:hooks` clean; `next build` passes. **FR-15: after touching `types.ts` or `adminSettingsView.ts` the typecheck gate is the gate — a green `npm test` proves nothing.**
- **Accessibility:** every marker carries an `sr-only`/`aria-label` phrase **and** a `title` **and** an entry in the legend; the glyph is never the sole carrier and colour is never the sole distinction. **The hover text is enrichment and must never be the only place a meaning lives** — the legend alone must remain sufficient, which is asserted. The `Configured: off` chips are words, not colour. The two temperature lock reasons stay **text**, not tooltips (C-6).
- **Logging:** no `console.*` introduced. No file in `app/admin/business-os-llm/` uses it today (workplan §10); if this round touches one that does, it is flagged and converted per CLAUDE.md.
- **Testability:** every removal is proved by a test that fails if the removed thing returns, and every retention by a test that fails if it goes. Load-bearing assertions are mutation-proved, following slice 2's precedent (workplan §5.5) — explicitly including AC-2, whose whole point is that it would have passed before the bug was possible.

---

## 9. Acceptance Criteria

*(Renumbered in this re-issue: the two density ACs are withdrawn, AC-11/12/13 of the first issue are rewritten per R-E, and eight ACs are added for R-H1…R-H6 and the hover text.)*

**Removals**

- [ ] **AC-1** (FR-1): the rendered page contains no `enabled` field, no `switch locked` chip and no `Cannot be switched off` chip, on any of the eight cards, expanded or collapsed. `LOCK_AREA_NOT_SWITCHABLE` and `LOCK_CALL_NOT_SWITCHABLE` are absent from the source.
- [ ] **AC-2** (FR-1, FR-8, R-C): a call whose stored row produces a rejected `provider` **and** a `locked`/non-switchable `enabled` renders **both** reasons on that call, each **naming its field**, with the resolver's own `reason` string. Covers `call_not_switchable`, `area_not_switchable`, `enabled_not_a_boolean` and `provider_not_allowed`. **Mutation-proved:** restoring the hand-written four-name array must turn this assertion red. A source assertion also proves the catch-all is derived from the rendered-field constant rather than a second list.
- [ ] **AC-3** (FR-5): no `FailOpenNotice` renders anywhere and none of the five strings appears in the source; the page header carries the replacement line, muted, containing all four load-bearing elements — *stored*, *~60 seconds*, *falls back to code*, **"on startup"** — and ending with **`(runbook §5)`**. The propagation clause is rendered from `PROPAGATION_NOTE` (or a second exported constant), never an inline string.
- [ ] **AC-4** (FR-3): `AreaCard` does not render `LedgerCheckPanel`; the component, `ledgerCheckCopy.ts`, the ledger route and **every one of their tests still exist and pass**, including SA F-6's eight-branch table and RC-D's neutral-tone assertion. The route header states it is not dead code.

**Provider**

- [ ] **AC-5** (FR-8): no call row renders a `provider` field, and the area header renders the provider **once** beside the model summary, on each of the eight areas.
- [ ] **AC-6** (FR-8): the provider carries **no marker** in either place — not `c`, not `*`, not a word chip.
- [ ] **AC-7** (FR-8): with a fixture area whose calls resolve to two providers, the header reads `varies by call` **and** the per-call field returns **for that area only**.
- [ ] **AC-8** (FR-13): the screen's `source.guard` scan has a provider-name rule, it carries a `mustMatch` sample asserted to match, and a planted `provider !== 'openai'` in a screen file turns it red. *(Today the same line passes silently.)*

**Off states**

- [ ] **AC-9** (FR-2): an area fixture with `configuredEnabled: false` renders `Configured: off` **verbatim** plus the one-sentence caveat; an `on` area and the non-switchable area render **no** area chip. No string anywhere on the page asserts an area *is* off — S2-T8's scan stays green.
- [ ] **AC-10** (FR-2, R-H1): a fixture with `calls.<name>.enabled: false` under an area that is **on** renders the `Configured: off` chip **on that call row**, and the collapsed card renders the `N calls configured off` roll-up. With no call off, neither renders. *(This is the `--include-calls` trap: area back on, call still off.)*

**Retentions**

- [ ] **AC-11** (FR-4): `LastChangedLine`'s three states render unchanged on the collapsed card and in the stored-row panel; `formatInstant` still returns null rather than the epoch. **Slice 2's existing tests should pass with no edits** — if one needs editing, something changed that this round did not intend.
- [ ] **AC-12** (C-6): the planner's locked temperature and the image call's *"not applicable"* still render their reasons **as text, not tooltip-only**. Under FR-6 these are the only carrier of "code-owned by policy", so this assertion is load-bearing, not cosmetic.

**Markers**

- [ ] **AC-13** (FR-6): a `model` or `temperature` resolved from the stored row renders **no marker**, at *either* level — asserted against a fixture built from the real seed. ⚠️ **Arithmetic corrected 2026-09-24 (SA ruling Q-SA-2; the error was in SA's own R-E treatment table, not in the scheme):** the 9 `*` fields are a **subset** of the 42 stored-row fields — a call-level value *is* a stored value — so "42 of 44 **unmarked**" was unsatisfiable. The assertion is **"42 of 44 rendered fields resolve from the stored row and none of them renders a `c`; 35 of 44 carry no marker at all"** (= 42 − 9 call-level + 2 policy-owned). The marker scheme is unchanged.
- [ ] **AC-14** (FR-6): `c` renders **only** for a code default on a **configurable** field — so a seed-derived fixture renders **zero** `c` markers — and **never** where `locks.lockedTemperature !== null` or `locks.temperatureNotApplicable`. A fixture with a genuinely unconfigured configurable field does render one.
- [ ] **AC-15** (FR-6): `*` renders on exactly the **9** call-level fields in a seed-derived fixture, and on nothing else. The glyph is neither `i` nor `c`.
- [ ] **AC-16** (FR-6): each marker exposes its full phrase to assistive technology, appears in the legend, and carries the hover text specified in FR-6. **The legend alone conveys each marker's meaning** (asserted with the `title` attributes stripped), and the hover text is not a restatement of the legend label. The legend's call-level entry pairs no "code" word with a "database" word.
- [ ] **AC-17** (FR-6, Q-2): the collapsed card's chip reads **`N set per call`**, renders only when `N > 0`, and neither `N with a call override` nor `N on code defaults` appears anywhere in the source.

**Additions**

- [ ] **AC-18** (FR-7): every call row is captioned `LLM code call name` before its identifier, and the identifier is still rendered in monospace, verbatim, never prettified.
- [ ] **AC-19** (FR-9, FR-14): the chat card lists **six** calls — two configurable, four muted and non-editable with **no value fields and no markers** — its count chip reads `6 calls`, and each excluded call carries the reason. The four names and the reason arrive **in the payload**; the reason is the **exported policy constant**, asserted equal on both sides, never re-typed.
- [ ] **AC-20** (FR-9): the seven other areas are unaffected — no excluded calls, rendering exactly as before.

**Copy and navigation**

- [ ] **AC-21** (FR-11): the page subtitle is the new string, and a render assertion pins it — it is unasserted today, which is why it would have shipped stale and green.
- [ ] **AC-22** (FR-12): `AdminSidebar.tsx` describes the page as `'Models & temperatures'`, and `nav.test.ts` asserts the **description** as well as the href and ordering.

**Hygiene**

- [ ] **AC-23** (FR-15): `typecheck:bos-llm` 0 new with the baseline unchanged; `check:bos-llm-literals` passes with no new exemption and no new inclusion; `lint:hooks` clean; `next build` passes; `npx eslint` on every touched file exits 0. **The workplan records the typecheck output as a task step**, because a green jest run cannot detect a `types.ts` / `adminSettingsView.ts` divergence. *(eslint is called out because workplan §5.3 claimed it once and was wrong — QA DEF-S2-6.)*

---

## 10. Out of Scope / Future Roadmap

| Item | Why / where |
|---|---|
| **Making the page writable** | Out of scope. Slice 3 of the approved requirement is where that happens — carrying FR-16's obligation to restore the full fail-open treatment in the same change. |
| **Density** | ⚠️ **Moved out of this requirement by SA (R-F).** FR-10, AC-17 and AC-18 of the first issue are withdrawn. The recommendation stands in [§7](#7-density--recommendation-stands-out-of-this-round); `docs/ADMIN_SURFACE_DENSITY_STANDARD.md` goes to SA on its own, and the Calls-table restructure is its own slice after items 1–8. |
| **"Temperature needs to move to the DB"** | ⚠️ **Rewritten per R-G — the answer is "it already has".** The capability was never missing (20 of 22 calls are `temperature: 'free'`), **and the value migration is already complete**: temperature resolves from the stored row for **20 of 22** calls today (4 call-level + 16 area-level), and the seed wrote a temperature for seven of the eight areas. The two exceptions are code-owned **by design**, not pending: `chat/planner` is `{ locked: 0 }` (0.3 recovered only 1 run in 4, and the plan cache relies on a stable plan) and `images/image_generation` is `'not_applicable'`. The only judgement left is the four onboarding extractors, where the area row's deliberate `NULL` — *"send none"* — **is** the correct stored value and seeding a number would change behaviour. **Nothing needs to move.** This is the same misreading FR-6 addresses, one level up, and the two answers agree. |
| **A real tooltip primitive** | F-11: none exists, and `@radix-ui/react-tooltip` is not a dependency. FR-6's v1 is the `title` attribute the approved accessibility rule already requires, with richer content. A styled, touch-capable, keyboard-reachable tooltip is a new dependency **and** a new pattern (CLAUDE.md rule 7) — its own item, with SA review, if hover text ever needs to do more than enrich. |
| **Un-parking the ledger check** | FR-3. It returns when this page can save, which is what makes its 24-hour window reachable. Slice 3 re-mounts the component — and must not then render `PROPAGATION_NOTE` twice. |
| **Restoring the per-call provider field** | FR-8 makes it automatic: the field returns for any area whose calls resolve to more than one provider. The upstream trigger is a second entry in `ALLOWED_PROVIDERS_LAYER2`, a code change with its own test. Nothing has to be remembered. |
| **Making the provider configurable at all** | Not a UI question. The policy forbids it by design, per call, until a test proves the provider serves that call's features. |
| **Showing which model the excluded embeddings use** | FR-9 shows the four calls and why they are not configurable here, not their current model. Reading `helpbot_embedding_model` would add a second settings source for four read-only rows. Deferred. |
| **Per-call prose descriptions** | Rejected in favour of FR-7's caption — user preference, and a per-call copy table in a client file is the hardcoding FR-6 of the approved requirement prevents. If ever wanted, from the payload. |
| **Migrating `/admin` to the V2 design system** | All 22 pages use raw slate tokens; converting one makes it the odd one out. Cross-cutting, separate concern — and out of scope for the density standard too. |

---

## 11. Open Questions

**All four questions from the first issue are closed by SA.** Recorded so the dispositions are not re-litigated:

| Q | Disposition |
|---|---|
| **Q-1** — is `call` the dominant provenance level? | **Closed (R-E).** No — `area` dominates (17/22 model, 16/22 temperature). FR-6 is redesigned on the database-vs-code axis. |
| **Q-2** — invert or remove the collapsed-card chip? | **Closed (R-E).** Neither as drafted: ship **`N set per call`**. `N on code defaults` would read `0` on six areas and a permanent `1` on two. |
| **Q-3** — does FR-2's one sentence survive? | **Closed by SA; no user input needed.** Keep the chip **and** the sentence, on the off card only. A `Configured: off` chip with no qualifier anywhere would be the first unqualified statement about *off* this screen has made. |
| **Q-4** — is the density standard written in this round? | **Closed (R-F).** Items 1–8 ship first; density leaves this document. |

**Two items for the re-check** — neither blocks a workplan:

- [x] **Q-5 — CLOSED 2026-09-24 by measurement. Both chips render zero times today, in production.** (raised by: BA | closed by: Dev, pre-implementation, read-only)
  **Measured on 2026-09-24** against `jgccgkyhpwirgknnceoh.supabase.co` from the repository root. Both are read-only `get` commands; nothing was written.

  | Command | Stored row, verbatim | Answer |
  |---|---|---|
  | `npm run bos:llm-settings -- get chat` | `{"calls":{"planner":{"model":"gpt-4o-mini"},"analysis":{"model":"gpt-4o-mini","enabled":true}},"model":"gpt-4o-mini","enabled":true,"provider":"openai","temperature":0}` — `issues: []` | **`calls.analysis.enabled` is `true`.** The **call-level** chip renders **zero** times today |
  | `npm run bos:llm-settings -- get leads` | `{"model":"gpt-4o-mini","enabled":true,"provider":"openai","temperature":0.2}` — `issues: []` | **`enabled` is `true`.** The **area-level** chip renders **zero** times today |

  Two consequences: "renders zero times today" is now a **measured fact about production** and may go in the PR description; and a day-one render of either chip is a genuine change of state, so **QA should investigate one rather than expect it**. Both rows also took the seed's fallback values, which is what corroborates the seed-derived render fixture for the only two areas whose values could have differed.

  *Original question, for the record:* R-H1's evidence includes the seed copying legacy `bizchat_analysis_enabled` into `calls.analysis.enabled` — and R-E itself notes the seed's four legacy values are **production-dependent**. So whether `chat/analysis` is off *right now* cannot be read from the tree. **Suggested resolution:** `npm run bos:llm-settings -- get chat` before implementation. Nothing in FR-2 changes either way — the chip is correct in both worlds — but if that flag is false the chip renders on day one, and the workplan should expect it rather than treat it as a regression. Also worth a line in the PR description, since "renders zero times today" is part of why this costs the user nothing.
- [ ] **Q-6 — confirm the collapsed-card roll-up (`N calls configured off`) is wanted.** (raised by: BA | status: needs SA re-check ruling)
  A BA addition inside FR-2, not in R-H1 as written. **Suggested resolution:** include it. R-H1's purpose is that an off call must not be invisible; without the roll-up it is merely *less* invisible — an operator still has to expand all eight cards to find it. It is exception-only, so it renders exactly as often as the call chip does. If SA prefers the smaller change, dropping it leaves R-H1 satisfied but weaker, and that should be a deliberate choice rather than an omission.

---

## 12. Notes on Integration Points

| Area | Affected |
|---|---|
| **The page** | `app/admin/business-os-llm/page.tsx` (subtitle, header line) · `components/{AreaCard,CallRow,Chip,LastChangedLine,StoredRowPanel}.tsx` · `copy.ts` · `types.ts`. `components/FailOpenNotice.tsx` is **deleted**; `components/LedgerCheckPanel.tsx` is **kept, unmounted, and marked PARKED**. `format.ts` unchanged. |
| **Navigation** | ⚠️ **Corrected in this re-issue (R-H3).** `app/admin/components/AdminSidebar.tsx` **is** touched — the description changes to `'Models & temperatures'` — and `__tests__/nav.test.ts` gains a description assertion. The first issue of this document said the nav needed no edits; that was wrong. |
| **The read route (FR-9 only)** | `lib/business-os/llm/modelSettingsPolicy.ts` exports the exclusion reason as a constant (FR-14 — the only change to that file, and it is additive). `lib/business-os/llm/adminSettingsView.ts` puts the excluded-call list and that constant on the wire. `app/api/admin/business-os/llm-settings/route.ts` is unchanged in shape. Both remain inside `typecheck:bos-llm`; the route remains the one `LITERAL_SCOPE_INCLUSIONS` entry, unchanged. **No area-level provider field is added** — FR-8 derives it from the calls, so RC-C's deliberate removal stands. |
| **The ledger route** | `app/api/admin/business-os/llm-settings/ledger/route.ts` — **header comment only**, recording that it is parked-not-dead and that slice 3 is its caller (C-8 condition). No behaviour change. |
| **Tests** | `__tests__/page.render.test.tsx` and `__tests__/source.guard.test.ts` (removals, markers, provider relocation, caption, excluded calls, subtitle, the new provider-literal rule) · `__tests__/nav.test.ts` (description) · `lib/business-os/llm/__tests__/adminSettingsView*` (payload) · `lib/business-os/llm/__tests__/modelSettingsPolicy.test.ts` (the exported reason constant). `__tests__/lastChanged.render.test.tsx` and `__tests__/ledgerPanel.render.test.tsx` **should need no edits** — if one does, that is a signal something changed that this round did not intend. |
| **Unchanged, and must stay so** | `modelSettings.ts` · `callCatalog.ts` · `modelOptions.ts` · `switchOffPredicate.ts` · `ledgerCheckCopy.ts` · `scripts/bos-llm-settings.ts` · `SystemConfigRepository.ts` · `TokenUsageRepository.ts` · `AdminUserRepository.ts`. No database change, no migration, no `system_settings_config` row edit. |
| **Documents to update on completion** | [BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_REQUIREMENT.md) — **(a)** the dated, unchecked slice-3 restoration obligation under **FR-17 and AC-16** (FR-16 / R-A condition 3); **(b)** **AC-4 superseded with a dated note naming this document**, old text left visible (R-B condition 1); **(c)** Change-History rows for the C-1, C-3, C-5, C-6, C-7 and C-8 dispositions. [BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md](/docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md) §5 — the slice-2 file table, the parked panel, and **S2-T3 superseded with the same dated note**. The [runbook](/docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md) needs **no** change: §4 already describes the switch as a script operation, which is now also what the screen implies. |

---

## SA Review Notes

**Reviewed by SA — 2026-09-24**
**First-pass status:** 🔄 **Approve with changes (binding).** → **re-checked 2026-09-24: ✅ approved for a Dev workplan** (see the targeted re-check at the end of this section — conditions RC-1…RC-4). The direction is approved and most of the document is unusually well evidenced. **Three requirements must be revised in this document before Dev writes a workplan:** FR-6 (its premise is refuted by the seeded data — R-E), FR-1/FR-2 (a call-level off state would become invisible — R-H1), and FR-10 (moves out of this round — R-F). Six further binding points are in *Findings BA did not raise*. Everything else is approved as written.

Verified against the tree at `a34f2572`, not against the brief: `app/admin/business-os-llm/**`, `lib/business-os/llm/{modelSettings,modelSettingsPolicy,callCatalog}.ts`, `scripts/bos-llm-settings.ts`, `supabase/migrations/20261003_seed_bos_llm_area_settings.sql`, `tests/helpers/bos-llm-literal-rules.ts`, `app/admin/components/AdminSidebar.tsx`.

---

### Rulings on the items referred to SA

#### R-A · C-1 — removing the fail-open banner (FR-17) — ✅ **Approved, with three conditions**

The reasoning holds and I re-verified both halves of F-4. All four strings are switch-framed (`copy.ts:24`, `:33-39`, `:83-90`, `:92-97`), and FR-17's own wording in the approved requirement is *"one sentence **beside every switch**"* — with no switch on the page the obligation is vacuous, not violated. This is materially different from the failure `FailOpenNotice` was built against (a warning dismissed while its control stays on screen), so removing the component does not weaken what SA F-3/F-7/F-8, QA DEF-S2-3 and SA R-2 were each protecting.

`copy.ts:110-114` (`LOCK_AREA_FAIL_OPEN`) is confirmed: a settings-read failure on startup also reverts **provider and model**, which are values this page keeps showing. FR-5's ~30-word line is **sufficient** — it carries the four load-bearing facts (these are *stored* settings, not fleet state; ~60 s propagation; the fallback is to *code*; and **"on startup"**, which SA F-8 called load-bearing and which must survive verbatim in that clause). What it drops is the *evidence path* (`FAIL_OPEN_ACTION`'s runbook §5 pointer), and that half is not switch-specific: an operator whose model looks wrong needs the same door.

Conditions, all binding:

1. BA's (a) and (b) stand as written.
2. **The replacement line must end with the runbook §5 pointer** (`(runbook §5)`) — three words, so that the only remaining route to fleet-level truth is not deleted along with the banner. FR-2's sentence already carries it, but that sentence renders zero times today.
3. **(b) must be recorded in the approved requirement, not only in a code comment.** A comment in `AreaCard.tsx` is a weak carrier — slice 3 is the change most likely to rewrite that file. Add an explicit, dated, unchecked obligation under **FR-17 and AC-16 of `BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_REQUIREMENT.md`** ("slice 3 restores the banner, the inline sentence and the FR-15 confirmation sentence in the same change that puts a control on the page"), in addition to the §12 Change-History row already planned. Keep the code comment as well.

#### R-B · C-5 — rewording an accepted AC — ✅ **Approved in principle; the specific strings in FR-6 are not**

Editing AC-4 and S2-T3 is legitimate: they pin a *rendering* decision, the underlying `ProvenanceLevel` wire type and per-field `provenance` record are untouched, and slice 3 can still render more without a route change. Conditions:

1. AC-4 and S2-T3 are **superseded with a dated note naming this document**, never silently edited. The old text stays visible with a "superseded 2026-09-24 by …REFINEMENTS…, FR-6" marker so PR #102's audit trail stays readable.
2. The **replacement scheme is the one in R-E below, not the one in FR-6 as drafted.**
3. D-2's distinction must survive in the form R-E specifies. S2-T3's second half (`temperature: undefined` → *"not set — the provider default applies"*) is **unaffected and must keep biting**.

#### R-C · The issue-filter hazard (F-6) — ✅ **Confirmed; the remedy is right but not yet sufficient**

`CallRow.tsx:92-94` is exactly as described, and it is a real correctness bug in waiting. Three additions before this is closed:

1. **Do not hand-narrow the array to `['model','temperature']`.** That is the same two-lists-must-agree shape that caused the bug. Derive the catch-all from the single constant the render uses (one `RENDERED_FIELDS` array, or literally "issues not consumed by a rendered field"), so the filter cannot drift from the fields a second time.
2. **The catch-all list must render `issue.field`.** Today it prints `reason` + gloss only, which was fine when the catch-all could only hold `field: 'calls' | 'row'`. Once `enabled` and `provider` issues land there, a bare `ISSUE_GLOSS.locked` ("this field is owned by the code") with no field named is not actionable.
3. **AC-2 is right to exist; broaden it.** It must also cover the `enabled` issue kinds the resolver can actually emit — `call_not_switchable` / `area_not_switchable` (`modelSettings.ts:704-712`) and `enabled_not_a_boolean` (`:721`) — and be mutation-proved (restore the four-name array; the assertion must go red).

#### R-D · C-2 — the accidental deletion of `PROPAGATION_NOTE` — ✅ **Confirmed**

Verified: `PROPAGATION_NOTE` has exactly one caller, `LedgerCheckPanel.tsx:48` / `:237`. Parking the panel deletes FR-20 from the page. BA's relocation is correct and is the right disposition. Two notes:

- **Keep the constant as the single source** and render it in the header; do not re-type the sentence. Its second clause (*"the ledger check only starts counting after that"*) is ledger-specific — if it is trimmed for the header, the trim must be a second exported constant, not an inline string, or the panel and the header will drift.
- Slice 3 must not end up rendering it **twice** when the panel is re-mounted. Record that in the FR-3 parking comment.

#### R-E · Q-1 — resolved from the data: **the premise fails.** FR-6 must be redesigned

I resolved this from `supabase/migrations/20261003_seed_bos_llm_area_settings.sql` (applied to production per the Layer 2 record) against `modelSettings.ts:596-691` (provenance is assigned at the `break` where the value is taken) and `modelSettingsPolicy.ts:166-228`. The seed's only production-dependent values are four legacy model/flag strings, and **none of them can change the *level* a field resolves at** — the keys are written either way — so the distribution below is deterministic, not an estimate.

**Today's 22 calls, for the two fields FR-6 would mark:**

| Field | `call` (no marker under FR-6) | `area` (`i`) | `default` (`c`) |
|---|---|---|---|
| `model` | **5** | **17** | **0** |
| `temperature` | **4** | **16** | **2** |

- `model` at call level: `chat/planner`, `chat/analysis`, `website/full_site`, `website/landing_page`, `intake/question_inference`.
- `temperature` at call level: `insights/correlated_insight`, `insights/health_summary`, `website/testimonial_enhance`, `intake/question_inference`.
- `temperature` at default level: `chat/planner` (`{ locked: 0 }`) and `images/image_generation` (`not_applicable`) — **both permanently code-owned; neither is "not migrated yet".**
- `onboarding`'s area `temperature: NULL` **is** an area-level value (`readField` uses `hasOwnProperty`, `modelSettings.ts:455-458`), so all four extractors resolve at `area`, not `default`.

**Consequences, and they are decisive:**

1. FR-6 as drafted puts a marker on **33 of 44** marked fields (75 %) and leaves 9 unmarked. It does not make the screen cleaner; on the `website` card it would print 11 `i` markers across 16 fields.
2. The `c` markers land on **exactly the two fields that can never move to the database**. FR-6's stated payoff — *"`c` markers disappear one by one … the screen visibly gets cleaner as the migration progresses"* — is unreachable: those two never clear, and there are **zero** genuinely unmigrated fields to clear. Shipped as drafted, the screen grows a permanent "not migrated" nag on `chat` and `images` and re-creates the user's original misreading in a new costume.
3. AC-12 ("a fixture where every marked field resolves at `call`… zero markers") would pass against a fixture that does not and will not exist.

**Ruling — FR-6 is rejected as drafted and must be rewritten to this scheme.** It serves the user's stated intent (*"everything ends up configured in the DB, so the DB should be the assumed default"*) better than the literal instruction does, because the axis the user cares about is **database vs code**, not **call vs area**:

| Case | Today | Treatment |
|---|---|---|
| Resolved from the stored row, **either level** | 42 of 44 | **No marker.** The page is clean immediately — the user's complaint answered on day one rather than after a migration that has already happened. |
| **Code default on a configurable field** | **0** | `c`, with FR-6's legend wording. This is the real migration signal, and it is correct that it currently renders nowhere. |
| **Code-owned by policy** (`locks.lockedTemperature !== null`, `locks.temperatureNotApplicable`) | 2 | **No `c`.** The existing `LOCK_TEMPERATURE_FIXED` / `LOCK_TEMPERATURE_NOT_APPLICABLE` text already says it, as text, and C-6/FR-12 requires that text to stay. Both booleans are already in the payload, so this costs no new field and no client-side knowledge. |
| **Set on this call specifically** | 9 | **A marker, exception-only** — the rare and *actionable* case: an operator who changes the area value via runbook §3 and expects these five models to move will be wrong. Dropping the distinction entirely is a real regression against D-2's operational half. |

Constraints on the rewrite:

- The call-level marker's label **must not pair a "code" word with a "database" word** in the legend — that pairing is what produced the user's misreading. Wording along the lines of *"set on this call — the area value does not apply to it"*. The glyph must not be `i` (nothing is being marked as inherited any more) and must not be `c`. Glyph choice is BA/Dev's; FR-6's accessibility rule (sr-only phrase **and** `title` **and** legend, never colour-alone) applies unchanged and is approved.
- **Q-2 ruling:** do **not** ship `N on code defaults`. Under the real data it reads `0` on six areas and a permanent `1` on `chat` and `images` — a nag that can never be cleared. Either drop the collapsed-card chip, or keep it counting the *call-level* case with wording that cannot be read as migration status (e.g. `N set per call`). `N with a call override` must not survive unchanged.
- **AC-11, AC-12 and AC-13 are rewritten with FR-6.** AC-12's "migration-complete state is visibly empty" becomes an assertion about **today's real distribution**, not a synthetic fixture: a fixture built from the seed must render zero markers other than the per-call ones.

#### R-F · Density (#9) — ✅ **Recommendation approved, with two changes**

The shared-standard-applied-per-page recommendation is correct, and the reasoning is sound: there is no shared code (`components/ui/` has `badge.tsx` and **no** `table.tsx`, confirmed), the two surfaces are structurally different, and the audit proposal's own "different review lenses" argument applies symmetrically. A joint two-page PR would be two unrelated edits under one lens.

1. **F-9's count is wrong, and the error weakens the argument in the wrong direction.** `app/admin/` holds **22** `page.tsx` files, not eleven — so the standard governs ~20 other pages, not nine. Correct F-9 and §7 before this is cited as evidence.
2. **FR-10, AC-17 and AC-18 come out of this requirement.** Not a scope cut — the Q-4 answer made structural: a requirement whose AC blocks on SA approval of a document that does not exist yet cannot be handed to Dev. Move the Calls-table restructure to its own slice, sequenced after items 1–9 (which take four value columns down to two and make the table the obvious shape), and let `docs/ADMIN_SURFACE_DENSITY_STANDARD.md` come to SA on its own. **Q-4 is closed: ship 1–9 first.** The measured before/after discipline (AC-18) travels with the table slice and is approved there. §7's caution — prescribe *rules*, not *a layout*, or the standard over-fits the audit page — is right and should lead that document.

#### R-G · BA's three challenges — ✅ **Confirmed; one number corrected and one strengthened**

1. **Fail-open (R-A):** correct as written.
2. **Issues swallowed by dropped fields (R-C):** correct, and the most valuable finding in the document.
3. **"Temperature needs to move to DB" conflates capability with value:** the *challenge* is right, the *numbers* are wrong, and the true position is much stronger than BA claims.
   - **20 of 22 calls are `temperature: 'free'`, not 16.** Count from `modelSettingsPolicy.ts:166-228`: chat 1, insights 3, briefing 1, website 8, intake 2, leads 1, onboarding 4. The two exceptions are `chat/planner` (`{ locked: 0 }`) and `images/image_generation` (`not_applicable`).
   - **The value migration is already done.** Per R-E, temperature resolves from the stored row for **20 of 22** calls today (4 call-level + 16 area-level); the seed wrote a temperature for seven of the eight areas. So the §10 roadmap item is not "a value migration pending" — it is **already complete for every call that can have one**, and the only remaining judgement is the four onboarding extractors, where the area row's deliberate `NULL` ("send none") is the *correct* stored value and seeding a number would change behaviour.
   - **Rewrite the §10 row accordingly** and answer the user in those terms: nothing needs to move; two calls are code-owned by design. This is the same misreading R-E addresses, so the two answers must agree.

---

### Findings BA did not raise (binding)

- **R-H1 — FR-1 makes a *call-level* off state invisible, and that state is reachable by the documented emergency procedure.** `resolved.enabled` is false per call whenever the row carries `calls.<name>.enabled: false` (`modelSettings.ts:713-726`). Two live paths produce it: (a) the seed copies the legacy `bizchat_analysis_enabled` straight into `calls.analysis.enabled` (migration `:135-140`); (b) `npm run bos:llm-settings -- set <area> --enabled false --include-calls` **writes `enabled: false` into every call-level override** (`scripts/bos-llm-settings.ts:294-303`), and a later `--enabled true` sets only the area flag, leaving those call flags off. In that state FR-2's area chip renders nothing (the area *is* on) and, with the `enabled` field gone, the page presents a model and a temperature for a call that is not running. That is the page misrepresenting reality — the one thing every PR #102 review round protected against.
  **Required:** FR-2 gains a call-level counterpart — an exception-only chip on the call row when `resolved.enabled === false`, with the same wording discipline as `Configured: off` (it describes the row, never the fleet). It renders zero times today, exactly like the area chip, so it costs the user nothing and still satisfies "remove the switch *surface*" (the disabled checkbox, its label and its badge on all 22 rows). Add an AC with an off-call fixture.
- **R-H2 — the page's own subtitle becomes false, and no test pins it.** `page.tsx:80-83` reads *"Provider, model, temperature and the on/off switch for every catalogued Business OS AI call — showing the value each call will actually use, and where that value came from."* After FR-1, FR-6 and FR-8 every clause is wrong or half-wrong. Rewrite it in this round and add an AC — nothing in `page.render.test.tsx` asserts it, so it would ship stale and green.
- **R-H3 — the sidebar advertises the removed surface, and §12 says the nav is untouched.** `app/admin/components/AdminSidebar.tsx:155` describes the page as `'Models & Switches'`. `nav.test.ts` pins the href and the ordering but **not** the description, so this also ships stale and green. Either the description changes — and §12's integration table must then list `AdminSidebar.tsx`, contradicting its current "should need no edits" — or the page keeps advertising a switch surface it no longer has. Ruling: change it, and state the new string in an AC.
- **R-H4 — AC-7's "no comparison against a provider name" has no enforcement today.** `tests/helpers/bos-llm-literal-rules.ts` has five rules — model ids, `z.enum`, `switch case`, price-index keys, temperature literals — and **none** matches a provider name, so `provider !== 'openai'` would pass `source.guard` silently. BA is right that `providers.size > 1` is the only acceptable shape; make it enforceable by adding a screen-scoped rule, with the file's own `mustMatch` sample convention (two rules in that file were once dead regexes). Prefer the screen's `source.guard` scan over the shared `LITERAL_RULES`, which the route also consumes.
- **R-H5 — FR-9's reason string needs one home.** The sentence already exists as the policy's own comment (`modelSettingsPolicy.ts:62-69`). Export it as a constant beside `BOS_LLM_SETTINGS_EXCLUDED_CALLS` and have `adminSettingsView.ts` put it on the wire; do not re-type it into the view builder, or the policy's reason and the screen's reason become two sentences that drift. Otherwise FR-9 is approved as specified, including the payload route (the client genuinely cannot know this) and the count chip going to `6 calls`.
- **R-H6 — the FR-9 payload change is invisible to jest.** Already in §8; restated because it bit slice 2 twice (SA F-4 / QA DEF-S2-9): after touching `types.ts` or `adminSettingsView.ts`, **`npm run typecheck:bos-llm` is the gate and a green `npm test` proves nothing.** The workplan must carry it as a step, not a note.

---

### The remaining collisions — approved as reasoned

| # | Ruling |
|---|---|
| **C-3** | ✅ Approved. FR-16 constrains *what the page may say*, not how often it says it; the surviving chip keeps its reviewed wording verbatim. **S2-T8's page-wide string scan stays** — it is the only thing stopping a future edit reintroducing "Disabled", and it costs nothing. |
| **C-4** | ✅ Approved. The DEF-S2-4 contradiction cannot recur once neither sentence exists, and the still-true half of `LOCK_AREA_FAIL_OPEN` (a read failure reverts provider **and** model) is generalised correctly in FR-5 — it was always true of all eight areas, not only onboarding. |
| **C-6** | ✅ Approved as a narrowing, not a withdrawal. D-13's hazard ("a hidden lock reads as *this does not exist*") genuinely does not apply to a field the page no longer renders. The two temperature locks keep their text-not-tooltip treatment and S2-T6 keeps biting — and under R-E they become the **only** carrier of "this value is code-owned", which makes AC-10 more load-bearing than it looks. It must not be reduced to a tooltip in the FR-10 table slice. |
| **C-7** | ✅ Approved. The distinction is right: the sketch excluded the embeddings from an *editor*, and *not configurable here* ≠ *not worth knowing about*. Rendering the server's own reason teaches DEC-3 instead of silently enacting it. Two conditions: the four rows carry **no** value fields and **no** markers (as FR-9 says), and the `2 calls` → `6 calls` chip change is checked against the existing render assertions. |
| **C-8** | ✅ Approved. Parking is the right disposition and "built, tested, not mounted" is the declaration SA required of D-3/D-8. No feature flag — agreed; a flag for one JSX element on an internal read-only page would be a new runtime pattern under CLAUDE.md rule 7. The `GET …/ledger` route stays gated and tested and **must not be removed as dead code** — record that in the route's own header as well as here, because the next dead-code sweep reads the route, not the requirement. |

**Also correct, for the record:** F-1b's precondition check (8 areas / 22 calls / one provider — re-verified entry by entry), deriving the area provider from the payload rather than re-adding the field RC-C deliberately removed, the rejection of a per-call prose table in a `'use client'` file (FR-6), the rejection of greying the whole card in FR-2 (grey is spoken for by FR-9), and the §8 NFRs as written.

---

### Open questions — SA dispositions

| Q | Disposition |
|---|---|
| **Q-1** | **Closed by R-E.** The premise fails: `area` dominates (17/22 model, 16/22 temperature). FR-6 is redesigned around database-vs-code, with the call-level case as the exception marker. |
| **Q-2** | **Closed by R-E.** Do not ship `N on code defaults`. Drop the chip, or invert its *subject* to the per-call case with non-migration wording. |
| **Q-3** | **Closed by SA; no user input needed.** Keep the chip **and** the one sentence, on the off card only. It renders zero times today, so it costs the user nothing they can currently see, and a `Configured: off` chip with no qualifier anywhere on the page would be the first unqualified statement about *off* this screen has ever made. This is not a fork the user should be asked to arbitrate. |
| **Q-4** | **Closed by R-F.** Items 1–9 ship first; FR-10/AC-17/AC-18 leave this document for their own slice. |

---

### Approval

- [x] **Direction approved.** The subtraction is justified, and the evidence discipline in §2 and §6 is the reason these calls could be made at all.
- [ ] **Not yet approved for a Dev workplan.** BA re-issues with: FR-6 + AC-11/12/13 rewritten per R-E · FR-2 extended per R-H1 · FR-10/AC-17/AC-18 removed per R-F · F-7, F-9 and the §10 temperature row corrected per R-G/R-F · R-H2…R-H6 added as requirements with ACs · the R-A and R-B conditions written into §6 and §12. A targeted SA re-check of those edits is enough; no second full review.
- [x] **Nothing here is fundamentally wrong**, and no item needs TL escalation.

---

### SA targeted re-check — 2026-09-24 (second pass)

**Status: ✅ Approved for a Dev workplan**, subject to four small binding conditions below (RC-1…RC-4). None needs a third SA pass — Dev folds them in and QA asserts them.

**Checklist — every required change landed.** Verified in the document and against the tree, not from §14 alone.

| Required | Landed | SA check |
|---|---|---|
| FR-6 rewritten per R-E | FR-6 | ✅ Correct, including the "why the first draft was wrong" paragraph, which is the right place for it — the refutation is the reason the scheme is what it is. |
| AC-11/12/13 rewritten | AC-13, AC-14, AC-15 (+16, +17) | ✅ And better than asked: asserted against a **seed-derived** fixture with the real 42/0/9 distribution, which is what makes AC-14's "zero `c` today" meaningful. |
| FR-2 extended per R-H1 | FR-2, AC-10, F-10 | ✅ F-10 records the `--include-calls` trap with the line numbers. See RC-4 for the roll-up. |
| FR-10 / AC-17 / AC-18 removed per R-F | FR-10 withdrawn, §7, §10 | ✅ Retiring the number rather than reusing it is the right call. |
| F-7 corrected per R-G | F-7, F-8, §10 | ✅ 20 of 22 `'free'`, 20 of 22 already DB-resolved, §10 now reads *"nothing needs to move"*. |
| F-9 corrected per R-F | F-9, §7, §10 | ✅ 22 pages. |
| R-H2 subtitle | FR-11, AC-21 | ✅ The second sentence (*"the on/off switch is changed with the runbook, not here"*) is a good addition — it answers *"where did it go"* without re-creating the surface. |
| R-H3 sidebar | FR-12, AC-22, §12 | ✅ `'Models & temperatures'` is accurate, and §12 corrects its own earlier "nav untouched" claim explicitly rather than quietly. |
| R-H4 provider literal | FR-13, AC-8 | ✅ Screen-scoped, `mustMatch` convention followed, and AC-8 pins that the same line passes silently today. |
| R-H5 one home | FR-14, F-11b, AC-19, §12 | ✅ Asserted equal on both sides. |
| R-H6 gate is a step | FR-15, AC-23, §8 | ✅ |
| R-A conditions | C-1, FR-5, FR-16, AC-3, §12 | ✅ All three. AC-3 pins the four load-bearing elements **and** `(runbook §5)`. |
| R-B conditions | C-5, §12 | ✅ Dated supersession of AC-4 **and** S2-T3, old text left visible. |
| R-C / R-D | FR-1, AC-2 / FR-5, FR-3, AC-3 | ✅ AC-2 is mutation-proved and also asserts the catch-all is *derived*, which is the part that stops the bug recurring. |
| C-7 / C-8 conditions | FR-9, FR-3, §12 | ✅ Including the route-header record, where the dead-code sweep will actually look. |

**Claims re-verified in the tree:** `components/ui/` holds 14 components with no tooltip, no `Tooltip*.tsx` exists anywhere outside `node_modules`, and `@radix-ui/react-tooltip` is absent from `package.json` (F-11 ✓). `app/admin/` has 22 `page.tsx` (F-9 ✓). `modelSettingsPolicy.ts:62-69` holds the reason sentence as a comment (F-11b ✓).

---

#### Ruling 1 — the `*` glyph, the legend, and `N set per call` — ✅ **Approved**, with two copy/markup conditions

- **The glyph is approved.** An asterisk is the correct convention for *"there is a note about this one"*, the legend is that note, it needs no import, and the "required field" risk is genuinely negligible on a page with no inputs. Rejecting the lucide `Pin` for mixing an icon vocabulary into a two-glyph run is the right instinct.
- **RC-1 (binding, markup).** `*` must attach to the field **label**, never abut the value text. `0.7*` reads as part of a number in a way `call override` never could, and the withdrawn FR-10 wanted markers "inline" in a table — so this constraint must travel into the density slice, not just this one. Also: the glyph carries `aria-hidden="true"` with the meaning in an adjacent `sr-only` span, following the lucide-icon pattern already used on this page; otherwise assistive tech announces "star" *and* the phrase.
- **RC-2 (binding, copy).** The legend uses **two nouns for one thing**: *"set in the stored settings"* and *"not in the database"*. An operator who is already unsure which of these the screen means is exactly the reader this round exists to serve. Pick one noun and use it in both entries — e.g. `No marker: set in the stored settings · * set on this call — the area value does not apply to it · c code default — nothing is stored for this field`. The `*` entry passes the R-E constraint as written (no "code" word paired with a "database" word) and needs no other change.
- **`N set per call` is approved.** It is the `*` signal one level up, it is rare (9 of 44), and its wording carries no migration reading. **Condition:** AC-17 must pin that `N` counts **calls**, not fields — the existing `overrideCount()` semantics — and the chip's `title` must say so, or `2 set per call` on the chat card is ambiguous against its `2 calls` chip sitting beside it.

#### Ruling 2 — `title` as the v1 hover — ✅ **Approved**, with one correctness fix

`title` is the right v1 and BA's reasoning is exactly right: the approved accessibility rule **already** requires a `title`, so enriching that string adds no dependency, no component and no new pattern (CLAUDE.md rule 7), while a real tooltip primitive would be all three. F-11 is verified. §10's deferral naming "touch-capable, keyboard-reachable" as what a real primitive would buy is the correct framing of the limitation. **AC-16 is the right guard** — asserting the legend alone conveys each marker *with the `title` attributes stripped* is precisely the property that stops meaning migrating into the hover, and it is cheap.

**RC-3 (binding, correctness).** The `c` hover text is **false in one reachable case**. It says *"Nothing is stored for this field"* — but provenance falls back to `default` not only when nothing is configured, but also when a configured value was **refused**: a model that fails the price guardrail, or a provider outside the allow-list, leaves `from.model` / `from.provider` at `'default'` while the row very much does hold a value (`modelSettings.ts:623-636`, `:610-621`). In that state the page would render `c` and assert something untrue, which is the one thing this screen has never done. Reword so it is true in both cases — *"No stored value is in force for this field, so the call is running on the value written in code"*, plus a clause pointing at the refusal reason already rendered on that field. The `*` hover is accurate as written and needs no change.

#### Ruling 3 — Q-5 — ✅ **BA is right; my claim was imprecise. Confirmed and extended**

"Renders zero times today" was derived from the seed's literal `true` values and is not a fact about production. BA is correct that `bizchat_analysis_enabled` flows into `calls.analysis.enabled`, so `chat/analysis` may be off right now and the **call** chip may render on day one.

**It applies at area level too, which Q-5 does not yet say:** the seed writes `'bos_llm_area_leads' → 'enabled', stored.leads_enabled` from the legacy `lead_reply_recommender_enabled`, so the **area** chip may also render on day one. The other seven areas are literal `true` and cannot.

**Disposition:** run **`npm run bos:llm-settings -- get chat` *and* `get leads`** before implementation, and record both in the workplan. FR-2 is correct in either world — this only stops a correct day-one render being filed as a regression, and stops "renders zero times today" going into a PR description unchecked. Q-5 is closed by doing it; it does not block the workplan.

#### Ruling 4 — Q-6, the collapsed-card roll-up — ✅ **Keep it**, with one condition

Keep. R-H1 exists so that an off call is not invisible; without the roll-up it is merely *less* invisible, and finding it still means expanding eight cards. It is exception-only, so it costs exactly nothing on a page where nothing is off, and it is the same "mark the exception" principle as everything else in this round. Good practice flagging it as a BA addition rather than absorbing it.

**RC-4 (binding).** The roll-up renders **only when the area itself is on**. When the area is off, every call inherits `enabled: false`, so the roll-up would read `8 calls configured off` next to `Configured: off` — a redundant second claim about the same fact, and noise in the one place the round is trying to quieten. The state it exists to surface is precisely *area on, calls off*. AC-10's fixture already has that shape; make the rule explicit so a future edit does not widen it.

---

#### Verdict

✅ **Approved for a Dev workplan.** The four conditions (RC-1 markup, RC-2 legend vocabulary, RC-3 the `c` hover's truthfulness, RC-4 the roll-up's area-on condition) plus the Q-5 `get chat` / `get leads` check are folded in by Dev and asserted by QA; no further SA review of this requirement is needed before implementation. The Dev workplan still comes to SA for the normal Phase 1 review.

Noted for the record: BA's acceptance of R-C over its own proposal is the right call, and the re-issue's practice of recording *why the first draft was wrong* inside FR-6 — rather than quietly replacing it — is what made this a table lookup rather than a second full review.

---

## BA re-issue — where each required change landed

For the targeted re-check. Every item on SA's re-issue list, and the one user addition that arrived with it.

| Required change | Landed in | Note |
|---|---|---|
| **FR-6 rewritten per R-E** | [FR-6](#5-functional-requirements) | Database-vs-code axis. No marker for a stored value (42/44), `c` only for a code default on a **configurable** field (0 today), **no `c`** where the policy lock text already says it (2), `*` on the 9 call-level fields. Opens with a paragraph recording *why the first draft was wrong*, so the refutation is not lost. |
| **AC-11/12/13 rewritten per R-E** | AC-13, AC-14, AC-15 (+ AC-16, AC-17) | Renumbered. All three are now asserted against a **seed-derived fixture** with the real distribution (42 unmarked / 0 `c` / 9 `*`), not a synthetic one. |
| **Q-2 ruling** | FR-6, AC-17 | `N set per call`. Both `N with a call override` and `N on code defaults` asserted absent from the source. |
| **Glyph choice (BA's, per SA)** | FR-6 | `*`. Rationale and two rejected alternatives recorded; label pairs no "code" word with a "database" word. |
| **FR-2 extended per R-H1** | FR-2, AC-10, F-10 | Call-level `Configured: off` chip, same wording discipline. Evidence recorded as a finding. Plus a **BA addition** — a collapsed-card roll-up — raised as **Q-6** rather than assumed. |
| **FR-10 / AC-17 / AC-18 removed per R-F** | FR-10 (withdrawn), §7, §10 | Number retired rather than reused so R-F's disposition stays legible. §7 keeps the approved recommendation and the sequence. |
| **F-7 corrected per R-G** | F-7, F-8, §10 | 20 of 22 `'free'`; temperature already DB-resolved for 20 of 22. §10 now says **nothing needs to move**. |
| **F-9 corrected per R-F** | F-9, §7 | 22 `page.tsx`, not eleven; "~20 other pages". |
| **R-H2 — page subtitle** | FR-11, AC-21 | Exact replacement string given; a render assertion pins it. |
| **R-H3 — sidebar description** | FR-12, AC-22, §12 | `'Models & temperatures'`; `nav.test.ts` gains a description assertion; §12's "nav untouched" claim corrected explicitly. |
| **R-H4 — provider-literal rule** | FR-13, AC-8 | Screen-scoped `source.guard` rule with a `mustMatch` sample, not the shared `LITERAL_RULES`. |
| **R-H5 — one home for the reason string** | FR-14, F-11b, AC-19, §12 | Exported constant beside `BOS_LLM_SETTINGS_EXCLUDED_CALLS`; asserted equal on both sides. |
| **R-H6 — the gate is a step** | FR-15, AC-23, §8 | Carried as an explicit workplan task with recorded output. |
| **R-A conditions into §6 and §12** | C-1, FR-5, FR-16, §12 | `(runbook §5)` ends the replacement line (AC-3 asserts it); the slice-3 obligation is written into the **approved requirement** under FR-17/AC-16, dated and unchecked, with the code comment kept as well. |
| **R-B conditions into §6 and §12** | C-5, §12 | AC-4 and S2-T3 **superseded with a dated note naming this document**, old text visible; D-2's distinction survives as `c` + `*`; S2-T3's `temperature: undefined` half untouched. |
| **R-C additions** | FR-1, AC-2 | Catch-all derived from one `RENDERED_FIELDS` constant; `issue.field` rendered; AC-2 broadened to the four real issue kinds and mutation-proved. |
| **R-D additions** | FR-5, FR-3, AC-3 | Rendered from `PROPAGATION_NOTE` (or a second exported constant, never inline); the FR-3 parking comment records the don't-render-twice obligation for slice 3. |
| **C-7 / C-8 conditions** | FR-9, FR-3, §12 | No value fields and no markers on the four rows; the `2→6` chip checked against existing assertions; the ledger route's own header records it is not dead code. |
| **🆕 User addition — hover explanation** | FR-6, F-11, §8, AC-16, §10 | Exact wording for both markers, explaining the **consequence**. Mechanism is the `title` the approved rule already requires (**no tooltip primitive exists** — F-11), so it is enrichment, not a new pattern; AC-16 asserts the legend alone still conveys each marker. A real primitive is recorded in §10 as its own SA-reviewed item. |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-24 | **Implemented; Q-5 closed by measurement, AC-13's arithmetic corrected, §12's panel-test claim superseded** | **Q-5 closed:** both production `get` commands run read-only; `chat.calls.analysis.enabled` and `bos_llm_area_leads.enabled` are **both `true`**, so both off-state chips genuinely render **zero** times today — a measured fact, not an inference from the seed. **AC-13 corrected** per SA's Q-SA-2 ruling: 42 of 44 fields resolve from the stored row and none renders a `c`; **35 of 44 carry no marker at all**; the 9 `*` are a subset of the 42. The scheme itself is untouched — the double-count was in SA's R-E treatment table. **§12's claim that `ledgerPanel.render.test.tsx` "needs no edits" is superseded** (SA, deviation 2): that statement predates the FR-5 relocation, and parking the panel would have left `PROPAGATION_NOTE`'s ledger-specific clause with no coverage at all, so **one assertion was ADDED** to that file (R-T19). The rest of it — SA F-6's eight-branch table and RC-D's neutral-tone assertion — is untouched |
| 2026-09-24 | Created | Nine feedback items from the user's first live look at `/admin/business-os-llm`, two days after PR #102. Eight collisions with prior SA/QA decisions recorded in §6; density recommended as a shared standard applied per page rather than a joint slice; temperature-to-database recorded as a future item with its two code-level corrections |
| 2026-09-24 | Item 7 refined by the user | Provider is **relocated to the area header and de-duplicated**, not dropped: the information is retained once per area, the per-call field goes, and it carries **no provenance marker** because it is not configurable at any level. Precondition verified and recorded as **F-1b** — all 22 calls across all 8 areas take `provider: 'openai'`, so no area is mixed. Restoration is automatic and data-driven (`varies by call` → the per-call field returns), triggered by a second entry in `ALLOWED_PROVIDERS_LAYER2` |
| 2026-09-24 | SA review | **Approve with changes (binding).** Rulings on C-1, C-5, the issue-filter hazard, the `PROPAGATION_NOTE` relocation, density and BA's three challenges. **Q-1 resolved from the seed migration: the premise fails** — `area` is the dominant level (17/22 model, 16/22 temperature). Q-2/Q-3/Q-4 closed by SA. Six findings added: the invisible call-level off state, the page subtitle, the sidebar description, the unenforced provider-literal rule, the FR-9 reason's single home, and the typecheck gate |
| 2026-09-24 | **BA re-issue (this version)** | Every item on SA's list applied and mapped in [§14](#ba-re-issue--where-each-required-change-landed). **FR-6 rewritten on the database-vs-code axis** (42 of 44 fields unmarked, `c` for a code default on a configurable field, `*` for the 9 per-call overrides, no `c` where the policy lock text already speaks); **FR-2 gains the call-level off chip** (R-H1) plus a BA-proposed collapsed roll-up raised as Q-6; **density withdrawn** (FR-10 retired, §7 keeps the recommendation); **F-7/F-8/F-9 and the §10 temperature row corrected** — the temperature migration is *already complete* for every call that can have one; **FR-11…FR-16 added** for R-H2…R-H6 and R-A condition 3. **User addition:** hover text on each marker explaining the consequence, delivered through the `title` the approved accessibility rule already requires — **no tooltip primitive exists in this repo** (F-11), so this adds no new pattern. Two items opened for the re-check: **Q-5** (the "renders zero times today" claim depends on a production flag value) and **Q-6** |
| 2026-09-24 | SA targeted re-check | ✅ **Approved for a Dev workplan.** Every re-issue item confirmed landed. Rulings: the `*` glyph and `N set per call` approved (RC-1 — the glyph attaches to the field label, never abutting a value, and is `aria-hidden` with an adjacent `sr-only` phrase; RC-2 — the legend must use one noun, not "stored settings" **and** "the database"); `title` approved as the hover v1 with AC-16 as the right guard (**RC-3 — the `c` hover is false when a stored value was *refused* rather than absent, and must be reworded**); Q-5 confirmed and **extended to `leads`**, whose area `enabled` also comes from a legacy value; Q-6 roll-up kept (RC-4 — only when the area itself is on) |
