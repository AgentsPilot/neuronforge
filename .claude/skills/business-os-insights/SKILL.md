---
name: business-os-insights
description: Orient before developing anything in the Business OS Insights module — detectors, the correlation engine, metrics/baselines, vectors and maturity, the insight crons, channel insights, or the /business-os insight dashboard. Use when adding or fixing a detector, changing what an insight says or scores, touching lib/business-os/insight/** or app/api/business-os/insights/** or app/api/cron/insight-*, or investigating "why does this insight never fire / show nothing". Prevents the two-systems-named-insight confusion, the silent multi-registry miss when adding a detector, and reasoning from design docs that the 2026-09 rebuild left behind.
---

# business-os-insights

The authoritative map is **[docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md](/docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md)** — the as-built module reference, written from code. **Read it before writing anything.** This skill is the short list of things that go wrong when you don't.

---

## Rule 1 — There are two systems called "insights". Confirm which one before you touch a file.

| | **Business OS Insights** (almost always what is meant) | **Agent shadow insights** |
|---|---|---|
| Code | `lib/business-os/insight/**` | `lib/pilot/insight/**` |
| Repository | `lib/business-os/insight/repository/InsightRepository.ts` | `lib/repositories/InsightRepository.ts` |
| Routes | `/api/business-os/insights`, `/api/cron/insight-*` | `/api/v6/insights`, `/api/v2/insights`, `/api/insights` |
| About | The owner's **business** | An **agent's execution** quality |

Two classes named `InsightRepository` exist. Importing the wrong one compiles cleanly and then misbehaves. The project roadmap made this exact mistake once and had to correct itself.

---

## Rule 2 — Seven archived `INSIGHT_*.md` files are about the other system. Do not read them as requirements.

`INSIGHT_FIX_BALANCED` · `INSIGHT_FIX_PROPOSAL` · `INSIGHT_ID_NULL_FIX` · `INSIGHT_SYSTEM_FIXES_2026-06-01` · `INSIGHT_TABLES_ANALYSIS` · `INSIGHT_TYPE_MISMATCH_FOUND` · `PHASE_1_DEBUGGING_INSIGHT_LINKING`

All dated 2026-06-01 — **before** this module's first commit. Zero references to `business-os/insight` between them. Moved to `docs/archive/` on 2026-09-11 and each given a banner, but they still surface in a `grep docs/ -i insight`, so check the banner before trusting a hit.

`docs/INSIGHT_SYSTEM_PLAN.md` **is** about this module, but it was written pre-build and is the `@see` target in nearly every file header, which makes it look current. Use it for *why* (scoring rationale, detect-and-trigger-don't-rebuild, cost envelope), never for *what exists*.

---

## Rule 3 — Verify columns against the live database, not against a migration file.

Run `npm run schema:check` and load the **`business-os-schema-check`** skill before writing any query. This is not optional caution here: **three detectors in this module query a table or columns that do not exist right now** — `WebMobileIssues` (all four of its queries fail), `WebPageUnderperform` (four of five), `PricingDiscountAbuse` (one half). PostgREST rejects the whole select for one unknown name, the error is destructured away, and the code falls through to a default. No error reaches a log.

58 migrations from the 2026-09 reports merge are **not applied**. A file in `supabase/migrations/` is not evidence.

---

## Rule 4 — A detector is one file plus up to eight registries. Nothing fails loudly when you miss one.

| File | Miss it and… |
|---|---|
| `detectors/DetectorEngine.ts` — import **and** `new XDetector(supabase)` | **It never runs.** This is the real registration point |
| `detectors/catalog/index.ts` | Nothing breaks (the barrel is stale — 7 of 28 exported) |
| `InsightRepository.ts` → `detectorDescriptions` | LLM writes generic prose |
| `kernel/TriggerableProcesses.ts` | No "run it for me" action |
| `projection/ImpactProjector.ts` | No before/after panel |
| `correlation/patterns.ts` | Never joins a correlated story |
| `lib/business-os/LanguageContext.tsx` | Untranslated English for Hebrew/Spanish users |

Never count detectors from `catalog/index.ts`. Count `new *Detector(` in `DetectorEngine.ts`.

---

## Rule 5 — `estimated_impact_usd` does not hold USD.

Detectors write the business's own currency into that column. The repository formats it with that business's symbol on read. Never hardcode a currency symbol, and never assume the number is dollars — an Israeli therapist must not be told they are owed "$5,066.61".

The correlation `storyTemplate` strings currently violate this (hardcoded English, literal `$`). That is a known defect to fix, not a pattern to copy.

---

## Rule 6 — Most detectors compute over an empty table. Check before calling one "broken".

`business_events` has **no emitters**. `BusinessEventService` is imported by exactly one file. Nothing in CRM, Scheduling, Payments or Website emits an event.

So "this detector never fires" is usually **correct behaviour for the current data**, not a bug. Confirm which of the two cases you are in before fixing anything:

- Detector reads `business_events` or `derived_metrics` → **dark by design**, until the event-driven migration (Step 3) lands. That work is designed, signed off, and **HELD** pending a product call. Do not start it.
- Detector reads a module table (`payment_invoices`, `scheduling_bookings`, `crm_*`) → it should fire on real data. Now it is worth debugging.

---

## Rule 7 — The insight crons fail OPEN. Do not copy them; fix them.

`insight-detect`, `insight-metrics` and `insight-automations` all treat a missing `CRON_SECRET` in production as **authorized** (log a warning, return `true`). These are public URLs and the bearer secret is the only thing distinguishing Vercel from an arbitrary caller.

`app/api/cron/payment-reminders/route.ts` has the correct fail-**closed** version with a comment explaining why. Copy that one.

`insight-detect` also loops users **serially with LLM calls inside the loop** — factor timeout risk into any change that adds per-user work.

---

## Rule 8 — Respect the honesty invariants. They were each a bug once.

The 2026-09 rework fixed a class of "the UI stated something it could not know". Preserve these:

- **Vectors light on evidence, not on calendar age.** Thresholds count from the first booking / first client, never from signup — re-running onboarding recreates the profile row and resets account age.
- **The journey timeline has a `waiting` state that offers no date at all.** If there is no anchor event, name the condition and stop. Do not predict.
- **`funnelGap` can return `incomparable`.** Two numbers covering different periods do not get a percentage between them.
- **`minSamples` guards cold-start accounts.** Set it deliberately on every new detector.
- **Localized text is returned as translation keys, not English prose.** There is no reader on the server to have a language.

---

## Before you finish

- `npm run schema:check` clean for anything you touched
- New DB access through `lib/repositories/` with `.eq('user_id', userId)` (CLAUDE.md mandatory rule — the ~42 existing self-reads are a **documented deferral**, not a precedent for new code)
- Pino via `createLogger`, no `console.*`
- Update [BUSINESS_OS_INSIGHTS_MODULE.md](/docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md) — the module map, and the hazard table if you closed or found one
