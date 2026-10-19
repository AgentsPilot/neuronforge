# Workplan: Business OS Upgrade Modal, UM-0 "Plan comparison in the plan read"

> **Last Updated**: 2026-10-19

**Developer:** Dev
**Requirement:** [BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md) (§4.0 UM-D1, §7.0; SA Re-review (UM-D1) C-15 to C-28; user decision UM-D2 amending C-17)
**Date:** 2026-10-19
**Status:** Code Complete (awaiting SA code review); uncommitted on the branch for the user's diff
**Branch:** `feature/bos-upgrade-modal-um0` (created by RM off `origin/main` `c60e2f93`; worktree `neuronforge-upgrade-modal`)
**Code base read:** `origin/main` at `4583d21e` (the local checkout is about 300 commits behind and was not used for code)
**Path:** **Full cycle** (workplan → SA → code review → QA → user diff → RM), not fast-tracked (C-15, SA ruling (b)): it changes the body of a money-adjacent customer route

## Overview

UM-0 adds **one read-only field, `comparison`**, to the payload of `GET /api/business-os/entitlements/my-plan`. It is the per-plan comparison the upgrade modal's table renders in UM-1a: section headings, about 15 **short grouped rows** (user decision UM-D2), and for every plan shown to customers a ✓ / ✕ and, for quantity rows, a server-formatted value with the higher one highlighted. It is built **inside the entitlements module**, in `customerPlanView.ts`, by a pure builder called from `buildCustomerPlanView`, from each plan **as defined** (`previewAccountFor` + `resolveEntitlements`), never from the account's own resolution. The grouping, row labels (en / he / es) and order live in a new server config file. There is no UI in this slice, no new route, no new input, no Stripe call, no DB read and no migration (C-16). The `my-plan` route file is not edited, so its non-gate registration is unchanged (C-28).

---

## Table of Contents

1. [Scope and binding conditions](#1-scope-and-binding-conditions)
2. [Analysis summary](#2-analysis-summary)
3. [Implementation approach](#3-implementation-approach)
4. [The group config](#4-the-group-config)
5. [The payload shape](#5-the-payload-shape)
6. [Cell, row and section rules](#6-cell-row-and-section-rules)
7. [Row labels and section headings (en / he / es)](#7-row-labels-and-section-headings-en--he--es)
8. [Files to create / modify](#8-files-to-create--modify)
9. [Entitlements registration and invariant checks](#9-entitlements-registration-and-invariant-checks)
10. [Task list and estimates](#10-task-list-and-estimates)
11. [Test plan](#11-test-plan)
12. [Logging (CLAUDE.md § Logging)](#12-logging-claudemd--logging)
13. [Risks](#13-risks)
14. [Open questions for SA](#14-open-questions-for-sa)
15. [SA Review Notes](#sa-review-notes)
16. [QA Testing Report](#qa-testing-report)
17. [Commit Info](#commit-info)

---

## 1. Scope and binding conditions

**Approved scope (SA ruling (a), verbatim):**
> **UM-0** "Plan comparison in the plan read" (server only, no UI) … UM-0 **1.5–2 d** (+ about 0.5 d for UM-D2 grouping, per the UM-D2 note).

| Condition | How UM-0 meets it |
|---|---|
| **C-15** Full cycle, not fast-tracked; UM-1a's PR opens only after UM-0 merges | This workplan goes to SA review, then code review, QA, user diff, RM. Recorded in the requirement. UM-1a's workplan states the dependency |
| **C-16** Exactly one field, `comparison`, built in `customerPlanView.ts`, called from `buildCustomerPlanView`; no new route / input / Stripe call / DB read / migration; `null` on `no_plan_record` / `unavailable` | §3, §5. The builder is pure config resolution (two `resolveEntitlements` calls per request, the same work `buildUpgrade` already does once). `comparison: null` on all three non-`ok` returns (`unavailable`, `no_plan_record`, `basis.kind === 'none'`). `my-plan/route.ts` is not edited: it already spreads `view` into `data` |
| **C-17 as amended by UM-D2** Short grouped rows (~12–15); grouping, labels, order in server config; a grouped row is ✓ only if the plan includes **every** member; every customer-visible capability included by some shown plan in exactly one group (guard) | §4 (config), §6 (rules), §11.2 (guards). 15 rows proposed (§7). Each column is the plan as defined (`previewAccountFor`); cells carry `included` (boolean), `value` (string or `null`) and `highlight`, never a list |
| **C-18** Amend `customerPlanView.noExclusions.test.ts`, do not delete | §11.3: header records UM-D1 and SA reasoning (d); `included` / `nextPlanUp` rules unchanged; exact key-set allow-lists for `comparison` at every level; new non-vacuity tests |
| **C-19** New `customerPlanView.test.ts` cases | §11.1: columns in `tierOrder` (shown only); the same comparison for trial / Founding Partner / tier accounts; the highlight rule; labels in all three locales |
| **C-20** Section headings derived server-side from config only, a `section` per `CATEGORY_PRESENTATION` entry plus quantity rows by catalog **shape**; a test that every catalog category maps to a section | §6.3. Fallback to `plan.category.*` headings only if shape does not separate cleanly; on today's catalog it does (§6.3 table) |
| **C-22 / C-23** Cell semantics | The server sends `included` and `value` only; the words "Current plan", "Included", "Not included" are UM-1a copy. No sentence key is added that could match the `noExclusions` phrasing rule; the row labels are checked against it (§11.2) |
| **C-27** Tripwire when more than two plans are shown | §11.4, in `components/business-os/settings/__tests__/` (the only components path where a tier id may appear), naming UM-D1-M |
| **C-28** `npm run test:bos-entitlements` green on the final diff; route's `KNOWN_NON_GATE_IMPORTERS` symbols unchanged | §9. The route still imports exactly `buildCustomerPlanView`, `getEntitlementService`, `resolveAccountId`. Reported at hand-over |

**Not in UM-0:** any UI, the mirrored client type (UM-1a, `planPayloadTypes.ts`), any copy key for cells ("Included" / "Not included" / "Current plan" are UM-1a's), any change to `included`, `nextPlanUp` or `plans`, any matrix or catalog edit.

---

## 2. Analysis summary

| Area | Finding on `origin/main` `4583d21e` |
|---|---|
| `lib/business-os/entitlements/customerPlanView.ts` (901 lines) | `buildCustomerPlanView` returns `CustomerPlanView` (14 keys). Already holds `shownPlanChoices(config, locale)` (columns: `tierOrder` filtered by `shownToCustomers`), `isHiddenFromCustomer` (`lifecycle === 'not_built'`), `comparableAmount` (unit-aware ranking), `CATEGORY_PRESENTATION` (category order + `plan.category.*` keys), `groupByCategory`. Pure, `server-only`, no I/O |
| `planPresentation.ts` | `previewAccountFor(config, planId, now)`, `describePlanCapabilities(resolution, catalog, locale)` → `{ capability, label, category, display, granting }`; `granting` = `isGrantingValue` (the loader's own rule); `planLabel`, `planCommercialFlags` |
| `capabilityDisplay.ts` | `describeCapabilityValue(value, definition, locale)`: one formatter, `Intl.NumberFormat(locale)` cached per locale; phrases per language ("per month", "in total", fair-use note, units) |
| `config/catalog.ts` | 37 capabilities, 10 categories. **29 are customer-visible** (`available`) and every one is granted by `pro`; `basic` withholds the nine `chat.*` and has fewer credits. Shapes: boolean, variant, group, metered, fair_use, quantity, addon |
| `config/tierMatrix.ts` | `TIER_ORDER = ['basic', 'pro']`, both `shownToCustomers: true`. Paid tiers differ ONLY by `chat.*` and `credits.allowance` (file header rule) |
| `my-plan/route.ts` | No input; resolves the session account; spreads `view` into `data` (`{ ...view, endsWhen, purchase }`). So a new view field reaches the wire **with no route edit** |
| `enforcementPoints.test.ts` | Route entry: `symbols: ['buildCustomerPlanView', 'getEntitlementService', 'resolveAccountId']` — equality-checked |
| `customerPlanView.noExclusions.test.ts` | `VIEW_KEYS` exact allow-list (14 keys) — **will fail** on `comparison` until amended (C-18). Origin of the rule: commit `d6250f1f`, WS-2 step 1 |
| `my-plan/__tests__/route.test.ts` | Denylist `['withholds', 'excluded', 'excludes', 'notIncluded']` on `data` keys — `comparison` passes. Not in `test:bos-entitlements`; run separately |
| `planCopy.i18n.test.ts` | `KEYS` list: every `plan.*` key exists once per language; English exclusion-phrasing regex over all three dictionaries |
| `creditFigures.fromConfig.guard.test.ts` | `BUILDERS` includes `buildCustomerPlanView`; scans dictionaries and product files **except** `entitlements/config/**`. A new config file with labels is outside its scan by design; labels must still carry no figure (own test, §11.2) |
| Dictionaries | `lib/business-os/translations/{en,he,es}.ts` |
| Consumers of the view in tests | `PlanSection.render`, `PlanPaymentState.render`, `PlanPurchase.render`, `PlanUpgrade.render`, `creditsRow`, `customerPlanView.test`, `route.test` — they pass the view through as data; an extra field is ignored by the client today. Run them all (Task 9) |
| Architecture doc | `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` has a table of the customer view's fields (`customerPlanView.plans` row) and a Change History — gains a `comparison` row |
| DB / Stripe | Not touched |
| Deprecated patterns | None in the touched files |

---

## 3. Implementation approach

1. **Fresh worktree off `origin/main`** (RM's branch). Never `git stash`, never switch branches in the shared checkout; unlink a shared `node_modules` junction before any `git worktree remove`.
2. **Config first.** A new data-only file `config/planComparison.ts` holds the 15 rows (id, labels in three languages, member capability ids typed as `CapabilityId`, so a typo does not compile). No logic in it, like `catalog.ts`.
3. **One pure builder in `customerPlanView.ts`**, exported for its tests:
   ```typescript
   export function buildPlanComparison(input: {
     config: EntitlementConfig;
     locale: Locale;
     now: Date;
     rows?: ReadonlyArray<PlanComparisonRowConfig>; // default PLAN_COMPARISON_ROWS; injectable for fixture configs
   }): CustomerPlanComparison;
   ```
   It takes **no resolution and no account**: the comparison is a statement about plans as defined, so it cannot be built from the account's own row by mistake (C-17). Columns = `shownPlanChoices(config, locale)`. Per column: `resolveEntitlements({ config, account: previewAccountFor(config, planId, now), overrides: [], addons: [], now })`, then `describePlanCapabilities(…, locale)` for `granting` / `display`, and the resolution's raw values for `comparableAmount`.
4. **`buildCustomerPlanView` calls it once on the `ok` path** (with the `config`, `locale` and `now` it already has) and sets `comparison: null` on the three other returns (C-16). Its `input` does **not** change: fixture-row cases in §11.1 call `buildPlanComparison` directly (Q-4). The route passes nothing new.
5. **Sections from config only (C-20).** `CATEGORY_PRESENTATION` entries gain a `section`; a new `SECTION_PRESENTATION` list in the same file gives the order and heading keys. A row's section is decided by its members' catalog **shape** and **category**, never by an id or a plan (§6.3).
6. **Compact amounts in the one formatter.** `capabilityDisplay.ts` gains `describeCapabilityAmount(value, definition, locale): string | null` — the number alone ("19,750"), through the same cached `Intl.NumberFormat`, for monthly rates and included quantities only; `null` for anything else so the caller falls back to the full `describeCapabilityValue` text (a one-off "2,000 in total" must never sit under "Included each month" as a bare number). See Q-3.
7. **No route edit, no new export used by the route** — registration unchanged (§9).

---

## 4. The group config

**File:** `lib/business-os/entitlements/config/planComparison.ts` (new, data only, imports types only)

```typescript
import type { Labels } from '../types';
import type { CapabilityId } from './catalog';

export interface PlanComparisonRowConfig {
  /** Stable id: React key and test handle. Never shown, never branched on by a client (C-21). */
  id: string;
  /** What the row is called, in three languages. Data, like catalog labels; resolved server-side. */
  labels: Labels;
  /** The capabilities this row stands for. ✓ for a plan only if it includes EVERY one (UM-D2). */
  capabilities: readonly CapabilityId[];
}

/** In display order within each section. The section itself is derived (customerPlanView, C-20). */
export const PLAN_COMPARISON_ROWS: ReadonlyArray<PlanComparisonRowConfig> = [ /* 15 rows, §7 */ ];
```

**Why here, and why this shape:**

| Decision | Reason |
|---|---|
| Under `entitlements/config/` | It is presentation config that names capability ids, like `catalog.ts` and `chatActionMap.ts`. Capability ids inside the module are not "product code" for `enforcementPoints`; tier names never appear in it. A pricing or wording change is a config edit, reviewed like the matrix |
| **Not** inside `EntitlementConfig` / `source.ts` | It decides nothing about access, so it does not belong in the loader, its Zod schema or the drift snapshot. Adding it there would change `entitlements.snapshot.json`, which SA requires to stay unchanged |
| Row lists capabilities, not categories | UM-D2 groups across category lines inside a section (e.g. three `chat.*` groups in one row); a category list could not express "Ask it to schedule, quote and invoice" |
| No `section` on a row | C-20: the section is derived from the members, so a row cannot be filed under the wrong heading by hand. The guard checks members agree |
| Labels as data, not dictionary keys | UM-D2: "row labels (en/he/es) … live in server config". The same pattern as catalog and plan labels (`labelIn`, fall back to `en`, then the id) |
| Header comment | Records UM-D2, the "every member" rule, and the procedure: adding a capability to the catalog that a shown plan grants fails `planComparison.config.test` until it is placed in a row |

**Fallback, so nothing is silently dropped:** a visible capability granted by some shown plan but in no row (a fixture catalog, or a new capability before the config is updated) becomes its **own row**, labelled with its catalog label, at the end of its derived section — ugly on purpose, like `groupByCategory`'s unnamed-category fallback. On the production config the coverage guard makes this unreachable.

---

## 5. The payload shape

Added to `CustomerPlanView` (and to the `noExclusions` allow-lists, §11.3):

```typescript
export interface CustomerPlanComparison {
  /** The columns: exactly `plans.map(p => p.planId)`, same order (tierOrder, shown only). */
  planIds: string[];
  /** Non-empty sections only, in SECTION_PRESENTATION order. */
  sections: CustomerPlanComparisonSection[];
}

export interface CustomerPlanComparisonSection {
  /** 'run_business' | 'ai_assistant' | 'included_monthly' — a config id, not shown. */
  section: string;
  /** Dictionary key for the heading, e.g. 'plan.comparison.section.run_business'. */
  labelKey: string;
  rows: CustomerPlanComparisonRow[];
}

export interface CustomerPlanComparisonRow {
  /** The config row id (or the capability id for a fallback row). */
  row: string;
  /** In the reader's language, from config. */
  label: string;
  /** One per `planIds` entry, same order. */
  cells: CustomerPlanComparisonCell[];
}

export interface CustomerPlanComparisonCell {
  planId: string;
  /** Every member granted by this plan as defined (UM-D2). */
  included: boolean;
  /** Server-formatted amount for quantity rows when included; `null` for feature rows and for ✕. */
  value: string | null;
  /** Strictly greater than every other column, same unit (C-19); single-member amount rows only. */
  highlight: boolean;
}

// CustomerPlanView gains:
//   comparison: CustomerPlanComparison | null;   // null on every non-'ok' status (C-16)
```

Deliberately **absent**: plan names and prices (already in `plans`, joined by `planId` in UM-1a), capability ids on a row (a client must have nothing to branch on, C-21), any "excluded" list, any sentence. The client renders `value` when it is non-null, else ✓ / ✕ from `included`.

---

## 6. Cell, row and section rules

### 6.1 Cells

| Rule | Definition |
|---|---|
| Plan basis | `previewAccountFor(config, planId, now)` resolved with **no overrides, no add-ons**: the plan as defined, the same for every viewer |
| Member granted | `describePlanCapabilities` row's `granting` (`isGrantingValue`, the loader's own rule) |
| `included` | Every **visible** member granted by that plan. Hidden (`not_built`) members are dropped from the row first (they are nobody's); the production guard forbids listing one |
| `value` | Amount rows only (§6.3), and only when `included`. Single member: `describeCapabilityAmount(...) ?? display`. Several members: their amounts joined with `" · "` in config order ("1 · 1") |
| `highlight` | Amount row with **exactly one** member; that plan's `comparableAmount` is non-null, has the same `unit` as every other column's, and is **strictly greater** than every other column's. Otherwise `false` everywhere (equal, unlike units, unrankable, multi-member, ✕) |

### 6.2 Rows

| Rule | Definition |
|---|---|
| Order | Config order within each section; fallback rows after the configured ones |
| A row exists | At least one shown plan grants at least one visible member. The production guard additionally requires that **some** plan includes the whole row (no all-✕ row, C-18 non-vacuity) |
| Label | `labels[locale] ?? labels.en ?? id` (the `labelIn` rule) |

### 6.3 Sections (C-20)

`SECTION_PRESENTATION` (new, `customerPlanView.ts`), in order: `run_business` → `plan.comparison.section.run_business`; `ai_assistant` → `plan.comparison.section.ai_assistant`; `included_monthly` → `plan.comparison.section.included_monthly`.

A row's section:
1. If **every** member's catalog shape is an amount shape (`metered`, `fair_use`, `quantity`) → `included_monthly` (an "amount row": cells carry values).
2. Otherwise → the `section` of the members' category in `CATEGORY_PRESENTATION` (the members must agree; guard).

`CATEGORY_PRESENTATION` gains `section` per entry (order and heading keys of the existing rows unchanged, so `included` / `nextPlanUp` / `/invite` are unaffected):

| Category | `section` | Visible members on today's catalog | Their shapes |
|---|---|---|---|
| `credits` | `included_monthly` | `credits.allowance` | metered → amount row |
| `crm` | `run_business` | `crm.core`, `crm.documents`, `booking.calendar_sync` | boolean |
| `website_intake` | `run_business` | `website.ai_site`, `website.branding`, `intake.forms`, `intake.reminders` | boolean, variant |
| `payments` | `run_business` | the four `payments.*` | boolean |
| `ai_chat` | `ai_assistant` | `chat.access` + eight `chat.*` | boolean, group |
| `marketing` | `run_business` | `marketing.lead_response` | boolean |
| `insights` | `run_business` | the three `insights.*` | boolean |
| `support` | `run_business` | `support.level` | variant |
| `platform` | `run_business` | `email.volume` | fair_use → amount row |
| `addon` | `run_business` | `team.seats`, `business.locations` | quantity → amount row |

Shape separates cleanly on today's catalog: every amount-shaped visible capability lands in `included_monthly`, every other one by category. So the C-20 fallback (plain `plan.category.*` headings) is **not needed**; the guard in §11.2 fails if a future catalog breaks that.

---

## 7. Row labels and section headings (en / he / es)

**The he and es wording is a draft for the user's approval before merge** (precedent P-4.2, P-6a.2). English follows the approved mockup, with two additions marked †. Hebrew uses ׳ / ״, never ASCII quotes.

> **User decisions 2026-10-19:** lead replies keep their **own row** (15 rows); the emails row stays **"Emails"** (no fair-use wording); the third section heading is **"What's included"** (was "Included each month" — seats and locations are not monthly; key renamed `plan.comparison.section.included`); the **he / es drafts in §7.1–7.2 are APPROVED as written** (the new heading's he/es — מה כלול / Qué incluye — was drafted after that approval; show it in the diff). Wherever this workplan says "Included each month", read "What's included".

### 7.1 Rows (config, `PLAN_COMPARISON_ROWS`)

| # | Section (derived) | id | Members | en | he (draft) | es (draft) |
|---|---|---|---|---|---|---|
| 1 | Run your business | `crm` | `crm.core`, `crm.documents` | CRM, contacts and documents | CRM, אנשי קשר ומסמכים | CRM, contactos y documentos |
| 2 | Run your business | `booking` | `booking.calendar_sync` | Online booking with calendar sync | זימון תורים אונליין עם סנכרון יומן | Reservas online con calendario sincronizado |
| 3 | Run your business | `website` | `website.ai_site`, `website.branding` | AI-built website | אתר שנבנה ב-AI | Sitio web creado con IA |
| 4 | Run your business | `intake` | `intake.forms`, `intake.reminders` | Smart intake forms and reminders | טפסי קליטה חכמים ותזכורות | Formularios de admisión inteligentes y recordatorios |
| 5 | Run your business | `payments` | `payments.invoices`, `payments.card`, `payments.reminders`, `payments.multi_currency` | Invoices, card payments, reminders, multi-currency † | חשבוניות, תשלום בכרטיס, תזכורות ומספר מטבעות | Facturas, pagos con tarjeta, recordatorios y varias monedas |
| 6 | Run your business | `leads` | `marketing.lead_response` | Automatic replies to new leads † | מענה אוטומטי לפניות חדשות | Respuesta automática a nuevos contactos |
| 7 | Run your business | `insights` | `insights.checks`, `insights.channels`, `insights.daily_briefing` | Insights and daily briefing | תובנות ותדריך יומי | Análisis y resumen diario |
| 8 | Run your business | `support` | `support.level` | Priority support | תמיכה בעדיפות גבוהה | Soporte prioritario |
| 9 | AI assistant | `chat` | `chat.access` | Chat with your business AI assistant | צ׳אט עם עוזר ה-AI של העסק | Chat con el asistente de IA de tu negocio |
| 10 | AI assistant | `chat_send` | `chat.email`, `chat.marketing` | Ask it to send emails and marketing | לבקש ממנו לשלוח מיילים ודיוור | Pídele que envíe correos y campañas |
| 11 | AI assistant | `chat_work` | `chat.scheduling`, `chat.quotes`, `chat.invoice_control` | Ask it to schedule, quote and invoice | לבקש ממנו לתאם פגישות, להכין הצעות מחיר ולהפיק חשבוניות | Pídele que agende, presupueste y facture |
| 12 | AI assistant | `chat_reports` | `chat.reporting`, `chat.search`, `chat.bulk` | Reports, search and bulk actions by chat | דוחות, חיפוש ופעולות באצווה דרך הצ׳אט | Informes, búsquedas y acciones masivas por chat |
| 13 | Included each month | `credits` | `credits.allowance` | Credits for AI work | קרדיטים לעבודת AI | Créditos para tareas de IA |
| 14 | Included each month | `emails` | `email.volume` | Emails | מיילים | Correos |
| 15 | Included each month | `team` | `team.seats`, `business.locations` | Team seats · locations | מושבי צוות · סניפים | Puestos de equipo · ubicaciones |

† Not in the mockup: the mockup's "Invoices, card payments, multi-currency" left out `payments.reminders`, and no mockup row held `marketing.lead_response`. The coverage guard requires both, so row 5 names reminders and row 6 is new (15 rows, the top of the UM-D2 range). Alternative for the user: fold lead replies into row 4 ("Smart intake forms, reminders and lead replies"), giving 14 rows.

What each column shows on today's config (Essentials / Autopilot): rows 1–8 ✓ / ✓; rows 9–12 ✕ / ✓; row 13 "19,750" / "**32,250**" (highlighted); row 14 "10,000" / "10,000"; row 15 "1 · 1" / "1 · 1". 15 rows, 3 sections, no all-✕ row.

### 7.2 Section headings (dictionary keys, `lib/business-os/translations/{en,he,es}.ts`, "Your plan" block)

| Key | en | he (draft) | es (draft) |
|---|---|---|---|
| `plan.comparison.section.run_business` | Run your business | ניהול העסק | Gestiona tu negocio |
| `plan.comparison.section.ai_assistant` | AI assistant | עוזר AI | Asistente de IA |
| `plan.comparison.section.included` | What's included | מה כלול | Qué incluye |

Added to `planCopy.i18n.test.ts` `KEYS`, so existence in three languages and the exclusion-phrasing check cover them. No figure in any string.

---

## 8. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/entitlements/config/planComparison.ts` | create | The 15 grouped rows, labels, order (UM-D2), data only |
| `lib/business-os/entitlements/customerPlanView.ts` | modify | Comparison types; `section` on `CATEGORY_PRESENTATION`; `SECTION_PRESENTATION`; `buildPlanComparison` (exported); `comparison` on the view, `null` off the `ok` path; header note recording UM-D1 / SA (d) next to rule 1 |
| `lib/business-os/entitlements/capabilityDisplay.ts` | modify | `describeCapabilityAmount` (compact number, same cached formatter) |
| `lib/business-os/translations/en.ts`, `he.ts`, `es.ts` | modify | Three `plan.comparison.section.*` keys |
| `lib/business-os/entitlements/__tests__/planComparison.config.test.ts` | create | Config guards (§11.2) |
| `lib/business-os/entitlements/__tests__/customerPlanView.test.ts` | modify | C-19 cases (§11.1) |
| `lib/business-os/entitlements/__tests__/customerPlanView.noExclusions.test.ts` | modify | C-18 amendment (§11.3) |
| `lib/business-os/entitlements/__tests__/planCopy.i18n.test.ts` | modify | The three keys added to `KEYS` |
| `lib/business-os/entitlements/__tests__/capabilityDisplay.test.ts` (or the existing suite that covers `describeCapabilityValue`) | create / modify | `describeCapabilityAmount` per shape and locale |
| `app/api/business-os/entitlements/my-plan/__tests__/route.test.ts` | modify | `comparison` present on `ok`, `null` on unavailable / no record (§11.5) |
| `components/business-os/settings/__tests__/planComparison.twoPlans.tripwire.test.ts` | create | C-27 |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | modify | `customerPlanView.comparison` row in the customer-view table; Change History row |
| `docs/requirements/BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md` | modify | Record UM-0 workplan, SA ruling, PR and merge (standing preference) |

**Not touched:** `app/api/business-os/entitlements/my-plan/route.ts`, `config/catalog.ts`, `config/tierMatrix.ts`, `config/cohorts.ts`, `source.ts`, `schema.ts`, `config/enforcementPoints.ts`, `__tests__/enforcementPoints.test.ts`, `__tests__/entitlements.snapshot.json`, every client file, every billing file, the DB.

---

## 9. Entitlements registration and invariant checks

Per the `business-os-entitlements` skill (read on `origin/main`). UM-0 works **inside** the module and adds no importer outside it, but every row of the skill's tripwire table is checked explicitly:

| Tripwire / invariant | Affected? | Check |
|---|---|---|
| New import from the module in a file outside it (`enforcementPoints` › backward) | **No** | The only new files outside the module are tests (exempt). The route is not edited |
| Symbols of an existing `KNOWN_NON_GATE_IMPORTERS` entry (route: `buildCustomerPlanView`, `getEntitlementService`, `resolveAccountId`) | **No, by design** | `buildPlanComparison` is exported for tests only; the route never imports it. If review asks the route to call it, that entry's `symbols` change in the same diff (SA (c)) |
| Capability-id literal in product code (`enforcementPoints` › "finds no capability id…") | **No** | Ids appear only in `entitlements/config/planComparison.ts` (inside the module) and in tests |
| Tier-name literal outside `entitlements/config/**` (`tierLiteral.forbidden`) | **No** | Builder reads `tierOrder`; tier ids only in tests and the C-27 tripwire under `components/business-os/settings/__tests__/` (allow-listed) |
| Catalog `lifecycle` flip (`customerPlanView.test` champion parity, `tierMatrix.snapshot`) | **No** | `catalog.ts` untouched |
| Tier matrix change / removal (`tierMatrix.snapshot`, `entitlements.snapshot.json`) | **No — must stay byte-identical** | `git diff --stat origin/main -- lib/business-os/entitlements/config/tierMatrix.ts lib/business-os/entitlements/config/catalog.ts lib/business-os/entitlements/__tests__/entitlements.snapshot.json` empty at hand-over |
| Account id for the service (`accountSeam.guard`) | **No** | The builder resolves synthetic preview accounts only, as `buildUpgrade` does |
| `customerPlanView.noExclusions` | **Yes — amended** (C-18, §11.3) | |
| `customerPlanView.test` | **Yes — new cases** (C-19, §11.1) | |
| `planCopy.i18n` | **Yes — three keys** | §7.2 |
| `creditFigures.fromConfig.guard` | Checked, no edit expected | `buildCustomerPlanView` is in its `BUILDERS`; the new keys carry no figure; config labels are covered by the new config test (no digits) |
| `my-plan` route no-input guard (`route.test`) | Unchanged | Plus the new `comparison` cases |
| Definition of done | — | `npm run test:bos-entitlements` green on the final diff, reported here with the suite count (C-28) |

---

## 10. Task list and estimates

| # | Task | Est. |
|---|---|---|
| ✅ 0 | Worktree baseline: `npm run test:bos-entitlements`, `route.test`, the four settings render suites, `creditsRow` — recorded green | 0.1 d |
| ✅ 1 | `config/planComparison.ts`: types, 15 rows, three-language labels, header | 0.25 d |
| ✅ 2 | `customerPlanView.ts`: comparison types, `section` on `CATEGORY_PRESENTATION`, `SECTION_PRESENTATION` | 0.15 d |
| ✅ 3 | `describeCapabilityAmount` in `capabilityDisplay.ts` + its tests | 0.15 d |
| ✅ 4 | `buildPlanComparison` (§6) and the call from `buildCustomerPlanView`; `null` on the three non-`ok` returns | 0.35 d |
| ✅ 5 | `planComparison.config.test.ts` (§11.2), each guard with a planted-violation self-test | 0.4 d |
| ✅ 6 | `customerPlanView.test.ts` C-19 cases (§11.1) | 0.3 d |
| ✅ 7 | `noExclusions` amendment (§11.3) | 0.2 d |
| ✅ 8 | Three dictionary keys + `planCopy.i18n` `KEYS`; route test cases; C-27 tripwire | 0.15 d |
| ✅ 9 | Full runs: `npm run test:bos-entitlements`, `npx jest app/api/business-os/entitlements/my-plan components/business-os/settings lib/business-os/__tests__/dictionariesStayInStep`, `npx tsc --noEmit -p .`, `npm run lint`; `git diff --stat` (no deletion-only file; snapshot / matrix / catalog / route empty) | 0.15 d |
| ✅ 10 | Architecture doc row + Change History; requirement update; sample `comparison` JSON (en and he) pasted here for the user diff | 0.1 d |
| | **Total** | **≈ 2.3 d** (SA: 1.5–2 d + about 0.5 d for UM-D2 grouping) |

---

## 11. Test plan

### 11.1 `customerPlanView.test.ts` (C-19)

| Case | Assertion |
|---|---|
| Columns | `comparison.planIds` equals `view.plans.map(p => p.planId)` and `tierOrder` filtered by `shownToCustomers`; a fixture config with one tier `shownToCustomers: false` drops that column and every cell for it |
| Same matrix for every account | `comparison` deep-equal across trial, Founding Partner (no end date and dated), `basic`, `pro` views in the same locale |
| Plans as defined, not the account | A `basic` resolution carrying an **override** that grants `chat.access`: the view's `comparison` still has ✕ for `basic` on the `chat` row (proves `previewAccountFor`, not the account's resolution) |
| Null off the `ok` path | `unavailable`, `no_plan_record`, and `basis.kind === 'none'` → `comparison === null` |
| Every-member rule (UM-D2) | Fixture rows grouping a granted and an ungranted capability: `included === false` for that plan; ✓ only where every member is granted |
| Hidden members dropped | Fixture row listing a `not_built` capability: it does not affect `included`; a row of only hidden members does not appear |
| Fallback row | Fixture catalog with a visible, granted capability in no row: it appears as its own row with its catalog label, at the end of its section |
| Highlight | Production: `credits` row → `pro` true, `basic` false; `emails` row → none (equal); `team` row → none (multi-member). Fixtures: equal values → none; unlike units (`{ total }` vs `{ perMonth }`) → none; three columns where the top two tie → none |
| Values | Amount rows carry `value` only when `included`; feature rows always `null`; `credits` value "19,750" / "32,250" in `en`, `es` "19.750" (CLDR), `he` "19,750"; a `{ total }` value falls back to the full "… in total" text |
| Labels in three locales | For `en`, `he`, `es` each row label equals the config label for that locale; section `labelKey`s are `plan.comparison.section.*` |
| Sections | Production: exactly three sections in `SECTION_PRESENTATION` order; amount rows only in `included_monthly`; `chat*` rows only in `ai_assistant` |
| Existing fields unchanged | `included`, `nextPlanUp`, `plans` deep-equal to a build with the comparison stripped (no regression in the existing payload) |

### 11.2 `planComparison.config.test.ts` (UM-D2 guards, production config)

Each guard carries a planted-violation self-test (a mutated copy of the rows must fail it), as `planPrefetch.guard` does.

| Guard | Rule |
|---|---|
| **Coverage (exactly one)** | Every capability that is visible (`!isHiddenFromCustomer`) **and** granted by at least one shown tier appears in **exactly one** row. Message names the capability and says "add it to a row in config/planComparison.ts" |
| Members exist and are visible | Every member is in the catalog and not `not_built` (an unbuilt feature is never named, rule 2 of `noExclusions`) |
| Unique | Row ids unique; no capability listed twice |
| **No all-✕ row** | Every row is wholly included by at least one shown tier |
| **No partial row** | For every shown tier, a row's members are all granted or all not granted. If pricing ever splits a row, this fails and says to split the row (otherwise "✕" would hide what the plan does include). See Q-1 |
| **No hidden difference** | In a feature (non-amount) row, each member's `display` is identical across every shown tier that grants it (a grouped ✓ must not hide e.g. `branded` vs `unbranded`) |
| Variant at its best | A variant member of a feature row is at its **highest** variant in every shown tier that grants it, so a label like "Priority support" or "Smart intake forms" stays true |
| Section agreement (C-20) | A row's members are all amount shapes or all not; non-amount members share one `CATEGORY_PRESENTATION.section` |
| Every category mapped (C-20) | Every category in the catalog has a `CATEGORY_PRESENTATION` entry with a `section` that exists in `SECTION_PRESENTATION` |
| Row count (UM-D2) | Between 12 and 15 rows. Changing the range is a user decision (the comment says so) |
| Labels | `en`, `he`, `es` present and non-empty for every row; no digit in any label (credit figures live in config values only); none matches the `noExclusions` exclusion-phrasing pattern |

### 11.3 `customerPlanView.noExclusions.test.ts` (C-18, amended, not deleted)

- **Header**: a new block "UM-D1 (2026-10-19): the comparison" recording that the user reversed UM-BQ2, and SA re-review (d) in plain words: reason (1) is removed structurally (a row exists only if some shown plan includes it; `not_built` never appears); reason (2) is the shadow-mode trade-off the user accepted; reason (3) still holds where it applies — `comparison` is a statement about **plans as defined, side by side**, not a list attached to "your plan". The original header text stays.
- `VIEW_KEYS` gains `'comparison'`. New exact allow-lists: `COMPARISON_KEYS = ['planIds', 'sections']`, `SECTION_KEYS = ['section', 'labelKey', 'rows']`, `COMPARISON_ROW_KEYS = ['row', 'label', 'cells']`, `CELL_KEYS = ['planId', 'included', 'value', 'highlight']`, swept for all four plan views; `null` asserted on the two no-plan views.
- Negative controls at each new level (a planted `excludedHere: []` on a section, a row and a cell fails the allow-list).
- New non-vacuity tests: no comparison row is ✕ in every column; no capability behind any row (via the config) is `not_built`; at least one ✕ exists (Essentials chat) so the amended rule is exercised, not vacuous.
- Unchanged: `included` lists inclusions only; `nextPlanUp` rules; the sentence-key phrasing test (the comparison adds no sentence).

### 11.4 C-27 tripwire

`components/business-os/settings/__tests__/planComparison.twoPlans.tripwire.test.ts`: `shownPlanChoices(readCodeConfig())` has at most two entries; on failure the message names **UM-D1-M** (the phone layout assumes two plan columns; re-decide M-A / M-B before showing a third).

### 11.5 Route (`my-plan/__tests__/route.test.ts`)

- `ok` read: `body.data.comparison` present, `planIds` equals `body.data.plans.map(p => p.planId)`, labels in the stored language (a `he` preference gives Hebrew row labels).
- `unavailable` and no-record reads: `body.data.comparison === null`.
- No-input guards unchanged; the route's source is byte-identical to `origin/main`.

---

## 12. Logging (CLAUDE.md § Logging)

`console.*` count on `origin/main` in every file this slice touches: `customerPlanView.ts` 0, `capabilityDisplay.ts` 0, `translations/en.ts` 0, `he.ts` 0, `es.ts` 0, `customerPlanView.test.ts` 0, `customerPlanView.noExclusions.test.ts` 0, `my-plan/__tests__/route.test.ts` 0. Nothing to flag. The builder is pure and logs nothing; the route's existing `Customer plan read` line is unchanged.

---

## 13. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | `noExclusions` was a reviewed design rule; amending it reads as weakening it | Amended narrowly with its reasoning in the header (C-18), new allow-lists at every new level, new non-vacuity tests; `included` / `nextPlanUp` untouched |
| R-2 | A grouped ✓ overstates a plan (it has two of three members) | "Every member" rule (UM-D2) plus the no-partial-row and no-hidden-difference guards |
| R-3 | A new capability ships and is missing from the table | Coverage guard fails CI; runtime fallback row shows it rather than dropping it |
| R-4 | The table tells an Essentials owner they lack chat while shadow mode lets them use it | Accepted by the user (UM-BQ2 reversal, §4.2 / §12 of the requirement); header of `noExclusions` records it |
| R-5 | Payload size / cost | 15 rows × 2 cells; two pure resolutions per request (one more than `buildUpgrade` already does). No I/O |
| R-6 | Existing client suites assert exact payload keys and turn red | None found (only `noExclusions`); all view-consuming suites run in Task 9 |
| R-7 | "10,000" for email reads as a hard limit; it is a fair-use alert that never blocks | Q-3; the row label can carry it in config without a new field |
| R-8 | Stale local checkout, shared `node_modules` junction, shared stash list | Fresh worktree only; never `git stash`; unlink the junction before removing a worktree |

---

## 14. Open questions for SA

| # | Question | Dev proposal |
|---|---|---|
| Q-1 | Partial rows: strict guard (a shown tier grants all or none of a row's members), or allow partial rows that simply read ✕? | **Strict.** UM-D2's "✓ only if every member" is honest only if ✕ never hides a partial; if pricing splits a row, the config splits too |
| Q-2 | Sections derived from member shape + `CATEGORY_PRESENTATION.section` (C-20 literal), rather than a `section` written on each config row. Accept? | Accept; the config row carries no section, so it cannot be filed under the wrong heading |
| Q-3 | Cell values: compact number ("19,750", "10,000", "1 · 1") through a new `describeCapabilityAmount`, falling back to the full text for anything not monthly / quantity. The fair-use "(alerts, never blocks)" note is then lost from the email cell — keep the label "Emails", or carry it in the label ("Emails (fair use)")? | Compact values; label "Emails" as in the approved mockup, raised with the user in the diff |
| Q-4 | Fixture-row cases (every-member rule, hidden members, fallback row) call the exported `buildPlanComparison` with injected `rows`, so `buildCustomerPlanView`'s input does not change. Accept, or would SA rather the view take an optional `comparisonRows`? | Accept: no new input on the view |
| Q-5 | Highlight only on single-member amount rows (the "Team seats · locations" row never highlights). Accept? | Accept; a per-member highlight is UM-3 polish if ever wanted |
| Q-6 | Row 6 "Automatic replies to new leads" is not in the mockup but the coverage guard needs `marketing.lead_response` somewhere. Own row (15 rows) or folded into intake (14)? A wording choice, so for the user in the diff | Own row |
| Q-7 | The C-27 tripwire lands in UM-0 (it reads only server config) rather than UM-1a. Accept? | Accept; UM-1a's guards reference it |

---

## Implementation Notes

**Dev, 2026-10-19.** Built on `feature/bos-upgrade-modal-um0` at `c60e2f93` (`origin/main`). Nothing committed: the diff is left for SA code review and the user.

### What was built

| File | Change |
|---|---|
| `lib/business-os/entitlements/config/planComparison.ts` | **New.** `PlanComparisonRowConfig` and the 15 rows of §7.1 (user decisions: lead replies own row, "Emails"). Header records UM-D2, the every-member rule, "highest variant = last entry" (S-3) and the new tripwire (S-2). Types only imported; no logic |
| `lib/business-os/entitlements/customerPlanView.ts` | Header block "UM-D1: the comparison, and why rule 1 still holds". `comparison` on `CustomerPlanView` (`null` in `empty`, so on all three non-`ok` returns); `CustomerPlanComparison` / `…Section` / `…Row` / `…Cell` types; `section` on every `CATEGORY_PRESENTATION` entry; exported `SECTION_PRESENTATION`, `isAmountShape`, `comparisonSectionForCategory`; exported pure `buildPlanComparison({ config, locale, now, rows? })` called once on the `ok` path. `groupByCategory` output is unchanged (it maps explicit fields, so `section` does not leak) |
| `lib/business-os/entitlements/capabilityDisplay.ts` | `describeCapabilityAmount(value, locale)`: bare figure for `perMonth` / `ceilingPerMonth` / `included` through the same cached formatter; `null` for `{ total }` and non-amounts |
| `lib/business-os/translations/{en,he,es}.ts` | `plan.comparison.section.run_business` / `.ai_assistant` / `.included`: Run your business / AI assistant / What's included; ניהול העסק / עוזר AI / מה כלול; Gestiona tu negocio / Asistente de IA / Qué incluye |
| `__tests__/planComparison.config.test.ts` | **New.** The §11.2 guards as functions over `(rows, config)`, each with a planted-violation self-test: coverage (exactly one), members visible, unique, no all-✕, no partial (strict, Q-1), no hidden difference, variant at its best (S-3), section agreement, every category mapped (C-20), 12–15 rows, labels (three languages, no digit, no exclusion phrasing). Shown tiers only (S-5) |
| `__tests__/customerPlanView.test.ts` | `OK_PATH_KEYS` gains `'comparison'` (one line). New `describe` with 17 C-19 cases (§11.1) |
| `__tests__/customerPlanView.noExclusions.test.ts` | C-18 amendment, **additions only** (112 lines added, 0 removed): header block, `VIEW_KEYS` + `'comparison'`, `COMPARISON_KEYS` / `SECTION_KEYS` / `COMPARISON_ROW_KEYS` / `CELL_KEYS` swept for all four plans, negative controls at each new level, `null` on the no-plan views, three non-vacuity tests |
| `__tests__/planCopy.i18n.test.ts` | The three keys added to `KEYS` |
| `__tests__/capabilityDisplay.test.ts` | **New.** `describeCapabilityAmount` per shape and locale |
| `app/api/business-os/entitlements/my-plan/__tests__/route.test.ts` | Three cases (§11.5): `comparison` on `ok` with `planIds` = `plans`; Hebrew labels from the stored preference; `null` on unavailable and on no record |
| `components/business-os/settings/__tests__/planComparison.twoPlans.tripwire.test.ts` | **New.** C-27 tripwire naming UM-D1-M |
| `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` | `customerPlanView.comparison` row; tripwire note under § Adding or changing a tier (S-2); Change History |
| `.claude/skills/business-os-entitlements/SKILL.md` | Lifecycle-flip tripwire row names `planComparison.config.test.ts` and the procedure (S-2); guard list updated |
| `docs/requirements/BUSINESS_OS_UPGRADE_MODAL_REQUIREMENT.md` | C-17 marked amended by UM-D2, SA-confirmed, with replaced and standing clauses (S-1); UM-0 status note; Status line; Change History |

**Not touched (verified `git diff origin/main` empty):** `my-plan/route.ts`, `config/tierMatrix.ts`, `config/catalog.ts`, `config/enforcementPoints.ts`, `__tests__/enforcementPoints.test.ts`, `__tests__/entitlements.snapshot.json`, `entitlements/index.ts`.

### Deviations from the workplan

| # | Deviation | Why |
|---|---|---|
| D-1 | Section id `included_monthly` → **`included`** | Follows the user's heading rename ("What's included", key `plan.comparison.section.included`), so the id and its key agree. Ids are not shown and not branched on by a client |
| D-2 | `describeCapabilityAmount(value, locale)` — no `definition` parameter (§3.6 sketched `(value, definition, locale)`) | The function reads only the value; an unused parameter would be noise. Easy to add back if SA prefers the symmetric signature |
| D-3 | §11.1 "existing fields unchanged" is covered by the **existing** `customerPlanView` / `noExclusions` / render suites staying green unchanged, not by a new "strip and compare" test | The comparison is built from config only and assigned to its own key; a test comparing a view with itself minus that key would be a tautology |
| D-4 | One extra §11.1 case: a row no shown plan grants any member of is dropped | Added after a mutation check: removing the "some shown plan grants a member" filter left every test green on production data, because no production row is all-✕ |

### Conditions S-1 to S-7

| # | Status |
|---|---|
| S-1 | ✅ C-17 amendment recorded in the requirement (replaced clause struck, standing clauses listed), plus a UM-0 status note. PR / merge: not yet |
| S-2 | ✅ Tripwire in the skill's lifecycle-flip row, in the architecture doc (§ Adding or changing a tier) and in the `planComparison.ts` header. `tierMatrix.ts` byte-identical |
| S-3 | ✅ "Highest" = last entry of `variants`, stated in the guard (`variantProblems`) and the config header; planted three-variant self-test |
| S-4 | ✅ `buildPlanComparison` not in `index.ts`; imported outside the module by tests only |
| S-5 | ✅ Every guard and the builder read `shownPlanChoices`, never `TIER_ORDER` raw; the fixture test shows a hidden tier has no column |
| S-6 | ✅ Fallback row tested with injected rows; production unreachable (coverage guard + the `noExclusions` test that every rendered row id is a configured row) |
| S-7 | ✅ he / es approved by the user as written; the new heading's he / es (מה כלול / Qué incluye) are for the user to see in the diff. All labels pass the no-digit and exclusion-phrasing checks |

### Mutation checks (run, then reverted; `customerPlanView.ts` restored byte-for-byte)

| Mutant | Result |
|---|---|
| `included` uses `some` instead of `every` | 1 test red |
| Highlight `>=` instead of `>` | 2 tests red |
| Row filter "some shown plan grants a member" removed | red only after D-4 was added |

### Test results (final diff, worktree)

| Run | Result |
|---|---|
| `npm run test:bos-entitlements` | **299 / 299 suites, 9,052 / 9,052 tests passed** (baseline before the change: 297 suites, 9,002 of 9,004; the 2 failures were 5-second timeouts in `app/admin/users` render suites under load, unrelated, and passed on the final run) |
| `npx jest app/api/business-os/entitlements/my-plan components/business-os/settings lib/business-os/__tests__/dictionariesStayInStep` | **28 / 28 suites, 550 / 550 tests passed** (baseline 27 / 546; +1 tripwire suite, +3 route cases, +1 tripwire case) |
| Targeted: `customerPlanView`, `customerPlanView.noExclusions`, `planComparison.config`, `planCopy.i18n`, `capabilityDisplay`, `my-plan` route | all green (included in the two runs above) |
| `npm run lint:hooks` | exit 0, 0 warnings |
| `npx tsc --noEmit -p .` | Full program (needs `--max-old-space-size=10240`; the default heap OOMs): 1,852 errors repo-wide, the known pre-existing backlog. **None in any new or changed line**: the only hits in touched files are pre-existing TS1117 duplicate keys in `en.ts` / `es.ts` (`crm.task.priority.*`, `config.intake.preview`), far from the three new keys |
| CRLF source-scan failures | none seen |
| `console.*` in touched files | 0 in every file (nothing to flag) |
| Registration (C-28) | No new importer outside the module; the route's `KNOWN_NON_GATE_IMPORTERS` symbols unchanged (`buildCustomerPlanView`, `getEntitlementService`, `resolveAccountId`); `enforcementPoints.test.ts` green inside `test:bos-entitlements` |

### Sample `comparison` (production config, `basic` / `pro` columns; en and he labels)

| Section key | Row | en | he | Essentials | Autopilot |
|---|---|---|---|---|---|
| plan.comparison.section.run_business | `crm` | CRM, contacts and documents | CRM, אנשי קשר ומסמכים | ✓ | ✓ |
| plan.comparison.section.run_business | `booking` | Online booking with calendar sync | זימון תורים אונליין עם סנכרון יומן | ✓ | ✓ |
| plan.comparison.section.run_business | `website` | AI-built website | אתר שנבנה ב-AI | ✓ | ✓ |
| plan.comparison.section.run_business | `intake` | Smart intake forms and reminders | טפסי קליטה חכמים ותזכורות | ✓ | ✓ |
| plan.comparison.section.run_business | `payments` | Invoices, card payments, reminders, multi-currency | חשבוניות, תשלום בכרטיס, תזכורות ומספר מטבעות | ✓ | ✓ |
| plan.comparison.section.run_business | `leads` | Automatic replies to new leads | מענה אוטומטי לפניות חדשות | ✓ | ✓ |
| plan.comparison.section.run_business | `insights` | Insights and daily briefing | תובנות ותדריך יומי | ✓ | ✓ |
| plan.comparison.section.run_business | `support` | Priority support | תמיכה בעדיפות גבוהה | ✓ | ✓ |
| plan.comparison.section.ai_assistant | `chat` | Chat with your business AI assistant | צ׳אט עם עוזר ה-AI של העסק | ✕ | ✓ |
| plan.comparison.section.ai_assistant | `chat_send` | Ask it to send emails and marketing | לבקש ממנו לשלוח מיילים ודיוור | ✕ | ✓ |
| plan.comparison.section.ai_assistant | `chat_work` | Ask it to schedule, quote and invoice | לבקש ממנו לתאם פגישות, להכין הצעות מחיר ולהפיק חשבוניות | ✕ | ✓ |
| plan.comparison.section.ai_assistant | `chat_reports` | Reports, search and bulk actions by chat | דוחות, חיפוש ופעולות באצווה דרך הצ׳אט | ✕ | ✓ |
| plan.comparison.section.included | `credits` | Credits for AI work | קרדיטים לעבודת AI | 19,750 | **32,250** |
| plan.comparison.section.included | `emails` | Emails | מיילים | 10,000 | 10,000 |
| plan.comparison.section.included | `team` | Team seats · locations | מושבי צוות · סניפים | 1 · 1 | 1 · 1 |

Bold = `highlight: true`. A ✓ / ✕ is `value: null` with `included` true / false. Identical for every account (trial, Founding Partner, either tier).

---

## SA Review Notes

**Reviewed by SA — 2026-10-19** (against `origin/main` `4583d21e`, after `git fetch`)
**Status:** APPROVED WITH CONDITIONS (S-1 to S-7 below)

### What was verified on `origin/main`

| Area | Finding |
|---|---|
| UM-D2 coverage | The 15 rows in §7.1 hold exactly the 29 visible capabilities, each once (2+1+2+2+4+1+3+1 run-business, 1+2+3+3 chat, 1+1+2 monthly). The six `not_built` capabilities (`marketing.mass_email`, `marketing.posts`, four `addon.*`, `sms.messages`) are named nowhere |
| Shapes vs §6.3 | `credits.allowance` metered, `email.volume` fair_use, `team.seats` / `business.locations` quantity; all other visible ones boolean / variant / group. The `addon` **shape** is only on `not_built` capabilities, so "amount shape = metered, fair_use, quantity" separates cleanly. C-20 fallback is not needed |
| Partial rows today | `basic` withholds all nine `chat.*` together and every `available` capability is in `BASE` at its highest value (`tierMatrix.ts` header), so no row is partial and no feature row differs in `display` across tiers. Q-1's strict guard passes on today's config |
| Snapshot / matrix | `CATEGORY_PRESENTATION` is a private constant in `customerPlanView.ts`, read only there; it is not in `entitlements.snapshot.json` (written by `scripts/write-entitlements-snapshot.ts` from the loader config) or `tierMatrix.snapshot`. A new `config/planComparison.ts` is not imported by the loader, so neither snapshot moves |
| `enforcementPoints` | Its walk excludes the entitlements module; a file inside `entitlements/config/` is not an importer. No new `KNOWN_NON_GATE_IMPORTERS` entry; route symbols unchanged if the route is not edited (C-28). `index.ts` does not re-export `customerPlanView`, so no barrel exposure |
| `tierLiteral.forbidden` | `ALLOWED_PREFIXES` includes `entitlements/config`, `entitlements/__tests__`, `components/business-os/settings/__tests__`, `my-plan/__tests__` — every place a tier id may appear in this slice |
| `creditFigures.fromConfig.guard` | `productFiles()` excludes `lib/business-os/entitlements/config/` by design; `customerPlanView.ts` and `capabilityDisplay.ts` are already in `SOURCES`. No SOURCES change needed; the new config test's no-digit rule covers the labels |
| Types | `Labels` (`types.ts`) and `CapabilityId` (`catalog.ts`, `keyof typeof CAPABILITIES`) exist, so typed members fail to compile on a typo |
| Test script | `test:bos-entitlements` covers `lib/business-os/entitlements` but **not** `components/business-os/settings` or `my-plan/__tests__`; Task 9 runs them separately — correct |

### UM-D2 confirmation (formal amendment of C-17)

**C-17 is amended by UM-D2, confirmed by SA.** Replaced: "one row per capability (about 29 today)". Now: rows are server-config groups (12–15), a group is ✓ for a plan only if that plan grants **every** visible member, and every visible capability granted by some shown plan is in exactly one group (guard). **Unchanged and still binding:** visible-only (`isHiddenFromCustomer`), a row exists only if some shown plan includes it, columns are plans **as defined** (`previewAccountFor`), cells carry `included` + server-formatted `value` (or `null`), never a list. The workplan satisfies all of it (§4, §6, §11.2).

### Rulings on Q-1 to Q-7

| # | Ruling |
|---|---|
| Q-1 | **Accepted: strict.** A partial row would make ✕ hide something the plan has. If pricing ever splits a row, the config splits it |
| Q-2 | **Accepted.** Derived sections are the C-20 literal; a hand-written `section` on a row is not allowed |
| Q-3 | **Accepted: compact values** through `describeCapabilityAmount`, `null` → full text. Whether "Emails" carries "fair use" is the **user's** wording call (technical constraint below) |
| Q-4 | **Accepted.** `buildCustomerPlanView`'s input does not change; fixture rows go through the exported builder |
| Q-5 | **Accepted.** Highlight only on single-member amount rows |
| Q-6 | **User's wording call** (raise in the diff). Both options pass every guard: 15 or 14 rows is inside 12–15, and folding `marketing.lead_response` into the intake row mixes `website_intake` and `marketing`, which both map to `run_business`, so section agreement holds |
| Q-7 | **Accepted.** The tripwire lands in UM-0; it is outside `test:bos-entitlements` but runs in the required Jest gate |

### Conditions

1. **S-1** Record the C-17 amendment in the requirement: mark C-17 "amended by UM-D2, SA-confirmed in the UM-0 workplan review", with the replaced clause and the clauses that stand (above). Together with the PR / merge record already in §8.
2. **S-2** New tripwire, documented where the next person looks: switching a capability to `available` (or granting a new one in a shown tier) now also fails `planComparison.config.test` until it is placed in a row. Add this to the `business-os-entitlements` skill's tripwire table (the lifecycle-flip row) and to the architecture doc; also in `planComparison.ts`'s header. **Do not** edit `tierMatrix.ts` for it (it must stay byte-identical).
3. **S-3** "Variant at its best" defines "highest" as the **last** entry of the shape's `variants` (today ascending: `branded`→`unbranded`, `manual`→`ai`, `standard`→`priority`), stated in the guard and the config header. If a variant list is ever not ascending, that is a catalog change for SA.
4. **S-4** `buildPlanComparison` stays out of `index.ts` and is imported outside the module by tests only. If anything outside the module ever imports it, that file needs registration in the same diff.
5. **S-5** The guard's "no all-✕ row" and "coverage" read **shown** tiers only (`shownPlanChoices`), never `TIER_ORDER` raw, so a hidden tier cannot satisfy or break them.
6. **S-6** The fallback row (§4) is tested but also logged nowhere (the builder is pure): acceptable. It must not be used by the production config: the coverage guard makes that a CI failure, keep it so.
7. **S-7** The he / es row labels and the three section headings stay marked draft until the user approves them in the diff; any reworded label is re-run through the no-digit and exclusion-phrasing checks.

### For the user (wording, not decided by SA)

- Q-6 lead replies: own row (15) or folded into intake (14). Either is technically fine.
- Q-3 "Emails" or "Emails (fair use)": either fits; the label lives in config, needs no new field, and must carry no digit. The cell shows "10,000" either way.
- Optional: "Team seats · locations" sits under "Included each month" (C-20 files every amount row there), though seats are not monthly. Changing the heading is a copy change; moving the row would be an SA rule change.
- he / es drafts (§7).

### Optimisation Suggestions

- The "same matrix for every account" test should fix one `now` for all four views, so a clock edge cannot flip a `previewAccountFor` result.

### Approval

[x] Workplan approved with conditions S-1 to S-7 — proceed to implementation

### Code Review by SA — 2026-10-19

**Status:** Code Approved (no required fixes)

| Area | Finding |
|---|---|
| Unchanged files | `git diff HEAD` empty for `my-plan/route.ts`, `config/tierMatrix.ts`, `config/catalog.ts`, `entitlements/index.ts`; no snapshot JSON modified (C-28) |
| S-1 to S-7 | All met as reported. S-4: `buildPlanComparison`, `isAmountShape`, `comparisonSectionForCategory`, `SECTION_PRESENTATION` are not in `index.ts`; outside `customerPlanView.ts` they are used only by `__tests__/` (`planComparison.config`, `customerPlanView`, `capabilityDisplay`). Exporting them is justified: the config guards need the same section/shape derivation the builder uses, rather than a copy that could drift. Same precedent as `comparableAmount` / `previewAccountFor` |
| C-17 / C-21 | Columns come from `previewAccountFor` with no overrides or add-ons; the builder takes no resolution. Cells carry `planId`, `included`, `value`, `highlight` only, with no capability ids and no list of what a plan lacks |
| C-18 amendment | `noExclusions` is 112 lines added and 0 removed; no `.skip` / `.only` |
| Deviations D-1 to D-4 | All accepted. D-1: the id now matches its key. D-2: an unused parameter would be noise. D-3: a strip-and-compare test would be a tautology. D-4: added because a mutation check showed the gap, which is a net gain |
| Standards | 0 `console.*`, 0 `any`, no tier literals in product files, `server-only` retained, builder pure |
| Mutation checks (SA, reverted, `cmp` byte-identical) | Row loses `chat.bulk`: config guard red (3 failures). `crm.core` moved into the `chat` row: config guard red (2). Extra `capability` key on a cell: `noExclusions` red (1). `included` forced to `true`: `customerPlanView` red (3) |
| Tests (SA run) | 11 suites, 354 / 354 tests: `customerPlanView`, `noExclusions`, `planComparison.config`, `planCopy.i18n`, `capabilityDisplay`, `tierLiteral.forbidden`, `creditFigures.fromConfig.guard`, `enforcementPoints`, `my-plan` route, C-27 tripwire, `dictionariesStayInStep` |

**Fixed by SA (comment only):** the `CategoryPresentation.section` JSDoc pointed at `comparisonSectionOf`, which does not exist. It now points at `isAmountShape`.

**Optimisation suggestions (non-blocking)**
- Highlight: if a shown plan withholds an amount capability entirely (✕), `comparableAmount(undefined)` is `null`, so the other plan gets no highlight either. Silence is the safe direction, but if the user wants "more" marked against a ✕ column, that is a rule change for a later slice.
- The route's Hebrew case builds its expected value with its own `now`, separate from the route's. Harmless today because the table does not depend on the clock; pin one `now` if it ever does.

**Code Approved for QA: Yes**

---

## QA Testing Report

**QA — 2026-10-19**
**Test mode:** full
**Strategy used:** A (Jest unit, the builder against the real code config) + B (route integration suite, mocked client). A throwaway QA probe test was written, run, and deleted (not left in the diff). D (live HTTP) not run: needs a signed-in session, none available; recorded below as owed.
**Focus:** api, schema
**Skipped:** live `GET /my-plan` (no signed-in session; QA does not sign in or use credentials)
**Input source:** TL prompt + workplan §11

### Suite runs (worktree, uncommitted diff)

| Run | Result |
|---|---|
| `npm run test:bos-entitlements` | **299 / 299 suites, 9,052 / 9,052 tests passed**, exit 0, no timeouts (matches Dev's count) |
| `npx jest app/api/business-os/entitlements/my-plan/__tests__ components/business-os/settings/__tests__` | **27 / 27 suites, 541 / 541 tests passed** (route suite alone: 38 / 38) |
| `npx jest …/my-plan/__tests__ lib/business-os/__tests__/dictionariesStayInStep` | 2 / 2 suites, 47 / 47 tests |
| Untouched files | `git diff --stat` empty for `my-plan/route.ts`, `config/tierMatrix.ts`, `config/catalog.ts`, `entitlements/index.ts`, `entitlements.snapshot.json` |

### Per-account check (QA probe, real config, one fixed `now`, fixtures from `__fixtures__/accounts.ts`)

| Account | `status` | `comparison` | Identical to Essentials' table? |
|---|---|---|---|
| Essentials (`tierAccount(basic)`) | ok | present | — (reference) |
| Autopilot (`tierAccount(pro)`) | ok | present | yes |
| Trial (started 4 days ago) | ok | present | yes |
| Trial (started 2.5 months ago) | ok | present | yes |
| Founding Partner, no end date | ok | present | yes |
| Founding Partner, dated | ok | present | yes |
| Essentials + override granting `chat.access` | ok | present | yes (Essentials column still ✕ on chat: plans as defined) |
| Unreadable (`unavailable: true`) | unavailable | `null` | n/a |
| No plan record (`resolution: null`) | no_plan_record | `null` | n/a |
| Basis `none` (blank account) | no_plan_record | `null` | n/a |

On every `ok` read `comparison.planIds` equals `plans.map(p => p.planId)` = `[basic, pro]`.

### Table vs §7.1 (probe output, en)

3 sections in order `run_business`, `ai_assistant`, `included`; 15 rows. Rows 1–8 ✓ / ✓; rows 9–12 (`chat`, `chat_send`, `chat_work`, `chat_reports`) ✕ / ✓; `credits` 19,750 / **32,250** (highlight on Autopilot only); `emails` 10,000 / 10,000 (no highlight); `team` 1 · 1 / 1 · 1 (no highlight). Every ✕ cell has `value: null`, `highlight: false`. **Exact match to §7.1.**

Locales: `he` figures 19,750 / 32,250; `es` 19.750 / 32.250 (CLDR). Hebrew row labels all contain Hebrew script, no ASCII quote marks (׳ used), no digit, no bidi control characters; the cell values are digits, separators and `·` only, so they need no direction marks. Section keys exist in en / he / es (Run your business / ניהול העסק / Gestiona tu negocio; AI assistant / עוזר AI / Asistente de IA; What's included / מה כלול / Qué incluye), none carries a figure. Latin fragments inside Hebrew labels ("CRM", "AI") are the usual mixed-direction case; how they render is UM-1a's concern (`dir="rtl"` on the table) and is noted for its QA.

### Edge cases

| Case | Finding |
|---|---|
| A capability made available and granted by a shown tier, but in no row | **CI fails**: `planComparison.config.test` coverage guard (its planted self-test removes a member and goes red, naming `config/planComparison.ts`). It runs in `test:bos-entitlements` and the required Jest gate. At runtime the builder does not drop it: the QA probe added one under the chat category and got a 16th row, labelled from the catalog, at the end of "AI assistant" |
| More than two shown plans (C-27) | QA probe: a third tier with `shownToCustomers: true` makes `shownPlanChoices` return three entries and the builder emits three columns, so the tripwire's predicate fires. The tripwire itself has no planted self-test (edge case 1 below) |
| Payload size | `comparison` is about **3.3 KB** of uncompressed JSON (en 3,276 B, he 3,557 B UTF-8, es 3,373 B), against about 4.6–5.2 KB for the rest of the view: the plan read's body grows by roughly **70%**. Absolute size is small, it is mostly repeated keys (compresses well), and the work is two pure resolutions with no I/O. Not a defect; noted under Performance |

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| C-16 one field, `null` on every non-`ok` return, no route edit | ✅ | Pass | 3 null paths; route file byte-identical |
| C-17 / UM-D2 grouped rows, every-member rule, coverage | ✅ | Pass | 15 rows; guards + Dev mutations + QA fallback probe |
| Plans as defined, not the account | ✅ | Pass | Override on Essentials does not change its column |
| C-18 `noExclusions` amended, not weakened | ✅ | Pass | Allow-lists at every level green |
| C-19 columns, same table for every account, highlight, labels | ✅ | Pass | Suite + QA probe across 7 ok account shapes |
| C-20 sections derived, every category mapped | ✅ | Pass | 3 sections in order |
| C-22 / C-23 cells carry `included` / `value` / `highlight` only | ✅ | Pass | |
| C-27 tripwire at most two plans | ✅ | Pass | Green on today's config; predicate confirmed with a 3-plan probe |
| C-28 `test:bos-entitlements` green, registration unchanged | ✅ | Pass | 299 / 9,052 |
| AC-UMD1 server half (comparison on the plan read) | ✅ | Pass | Live HTTP check owed (below) |
| Nothing on screen changes in UM-0 | ⚠️ | Not run live | Settings render suites green (541 / 541); no client file in the diff |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None required. Observation: the `my-plan` body grows by about 3.3 KB (about 70%) per read. Acceptable for one read per settings visit; worth a look only if the plan read is ever polled.

#### Edge Cases (nice to fix)
1. The C-27 tripwire (`planComparison.twoPlans.tripwire.test.ts`) has no planted self-test, unlike the config guards. The predicate was confirmed by the QA probe; a two-line self-test would pin it. Low.
2. SA's two non-blocking notes stand (no highlight against a ✕ column; separate `now` in the route Hebrew case).

### Manual check owed (live, signed-in; nobody has run it)

In the sandbox, signed in as the account itself, open DevTools › Network on Settings › Your plan and read the `GET /api/business-os/entitlements/my-plan` response:

| Account | Look at |
|---|---|
| Essentials | `data.comparison` present; `planIds` = `data.plans` order; chat rows ✕ / ✓; credits 19,750 / 32,250 with `highlight` on the second only |
| Trial | Same `comparison` as Essentials (compare the JSON) |
| Founding Partner | Same `comparison` as Essentials |
| Autopilot (if one exists) | Same `comparison` |
| Any of the above with language set to Hebrew | Hebrew row labels, `plan.comparison.section.*` keys, figures 19,750 / 32,250 |

On every page: **nothing on screen changes** in UM-0 (Your plan panel, upgrade panel, `/invite` unchanged). No `comparison: null` on any of these reads.

### Final Status
- [x] All acceptance criteria that can be tested without a session pass. **Verdict: PASS WITH NOTES** (live HTTP check owed; one Low edge case)
- [ ] Issues found — Dev must address before commit

---

## Commit Info

_To be completed by RM._

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-19 | Created | Dev workplan for UM-0 from `origin/main` `4583d21e`: `comparison` field built in `customerPlanView.ts` from plans as defined; grouped-row config `config/planComparison.ts` (15 rows, en / he / es labels, he / es drafts for user approval); sections derived per C-20; cell / highlight rules; config guards, C-18 amendment, C-19 cases, C-27 tripwire; registration table (no change expected); ≈ 2.3 d; Q-1 to Q-7 for SA. Status: Planning |
| 2026-10-19 | SA workplan review: APPROVED WITH CONDITIONS | Verified on `origin/main` `4583d21e`: 15 rows cover the 29 visible capabilities once each; shapes separate cleanly (C-20 fallback unneeded); no partial row today; `CATEGORY_PRESENTATION` and the new config are in neither snapshot; no new importer, route symbols unchanged (C-28). C-17 formally amended by UM-D2. Q-1, Q-2, Q-3 (compact values), Q-4, Q-5, Q-7 accepted; Q-6 and the "fair use" label go to the user. Conditions S-1 to S-7 (requirement record of C-17, new tripwire documented in skill / doc / config header, variant order, no barrel export, shown tiers only, fallback stays CI-unreachable, drafts stay draft) |
| 2026-10-19 | User copy decisions | Lead replies own row (15 rows); "Emails" unchanged; third heading → "What's included" (key `plan.comparison.section.included`); he/es drafts approved as written (new heading's he/es shown in the diff) |
| 2026-10-19 | Implemented (Dev) | Tasks 0 to 10 done on `feature/bos-upgrade-modal-um0`, uncommitted. § Implementation Notes: files, deviations (D-1 to D-4), S-1 to S-7 status, test counts, sample table. Status: Code Complete |
| 2026-10-19 | SA code review: CODE APPROVED | S-1 to S-7 met; D-1 to D-4 accepted; test-only exports justified (not in `index.ts`); route / tierMatrix / catalog / index / snapshot unchanged; 4 SA mutations all red; 11 targeted suites 354 / 354. SA fixed one stale JSDoc reference. Two non-blocking suggestions (highlight against a ✕ column; one `now` in the route Hebrew case). Approved for QA |
| 2026-10-19 | QA: PASS WITH NOTES | test:bos-entitlements 299/9,052; route + settings 27/541; comparison identical across 7 ok account shapes, null on 3 non-ok; table matches §7.1; tripwires probed; payload +3.3 KB; live HTTP check owed; one Low edge case (C-27 tripwire has no self-test) |
