# Business OS — Insights G2 Minimal Remediation Workplan

> **Last Updated**: 2026-08-10
> **Module**: Insights (#7) — **minimal G2 slice only** (user decision: keep Insights a repository-backed service; do NOT build a plugin now; revisit after Step 3).
> **Status**: 🟢 **Implemented → SA code-review APPROVE (§9.2) → QA PASS-WITH-NOTES (§10), no bugs.** Awaiting user code review before RM. Branch: `docs/business-os-event-driven-architecture`. RM held.
> **RM**: Held (same "hold RM until user reviews code" gate).

## Overview

Per the [Insights assessment](/docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md#insights), Insights stays a **repository-backed service** — no plugin, no Modules-tab surface. This workplan does only the **small, valuable slice of gap G2**: route the **3 foreign-module direct reads** in the insight subsystem through repositories, which **also fixes 2 latent bugs** and clears the overlapping "read-dashboard" items tracked under CRM 1.2.c and Payments.

**Explicitly out of scope:** the ~42 subsystem self-reads (`business_events`, `derived_metrics`, `insight_automations`, kernel tables) — those only matter if Insights becomes a plugin, deferred until after Step 3. No plugin definition, executor, or capability wiring.

## The 3 sites (all read `.from()` a foreign module directly)

| Site | Reads | Problem | Fix |
|---|---|---|---|
| `detectors/catalog/CashArOverdueDetector.ts:87` | `payment_invoices` (`amount`, `due_date`, status in `pending/sent/overdue`, `due_date < now-7d`, `amount>0`) | direct `.from()` (column `amount` is **correct**) | route through a new `PaymentInvoiceRepository.getOverdueInvoices(userId, …)` |
| `metrics/MetricsComputeService.ts:404` | `payment_invoices` sum where `status='overdue'` | **BUG:** selects **`total_amount`** — a **phantom column** (real column is `amount`) → metric `cashflow.ar_overdue_usd` returns **0** today | route through the repo + use `amount` |
| `detectors/catalog/OpsUtilizationLowDetector.ts:104` | `.from('scheduling_availability')` | **BUG:** `scheduling_availability` is a **JSONB column on `business_profiles`**, not a table → the query errors, availability always defaults to 40h | route through `BusinessProfileRepository.findByUserId(userId)` → read `profile.scheduling_availability`; adjust `calculateAvailableHours` to the weekly-availability JSONB shape |

## Step 1 — Repository method (Payments) — GENERALIZE the existing method (M1)

**Correction (M1):** `PaymentInvoiceRepository.getOverdueInvoices(userId)` **already exists** (`lib/repositories/PaymentRepository.ts:705-727`) with narrow semantics (`status='sent'` only, `due_date < today`, no `amount>0`) and **zero callers** (grep-confirmed across `lib/`/`app/`/`scripts/`/`components/`). **Generalize it in place — do NOT add a second implementation** (TS duplicate-function error). Before editing, re-confirm no Payments plugin op maps to it by name.

Generalize to (**`user_id`-scoped**, `{data,error}`, Pino):
- **`getOverdueInvoices(userId, opts?: { asOfDate?: string; statuses?: string[]; minAmount?: number })`** → `PaymentInvoice[]`. Query: `.eq('user_id', userId)`, `.in('status', opts.statuses ?? ['pending','sent','overdue'])`, `.lt('due_date', opts.asOfDate ?? <today ISO>)`, `.gt('amount', opts.minAmount ?? 0)`. Value column is **`amount`**, never `total_amount`.
- **No dedicated `sumOverdueAmount`** — the metric reuses this method (M7) and sums `amount` in-service.

## Step 2 — Route the 3 call sites through repos

- **CashArOverdueDetector** (pure refactor) — replace the `.from('payment_invoices')` block with `getOverdueInvoices(userId, { asOfDate: overdueDate.toISOString(), statuses: ['pending','sent','overdue'], minAmount: 0 })` (**M6:** pass `.toISOString()` — the opt is typed `string`, the detector holds a `Date`). Preserve the detection math (`amount`, `due_date`); `select('*')` returning extra columns is fine. Instantiate `new PaymentInvoiceRepository(this.supabase)` (keep the cron's injected service-role client; not the supabaseServer singleton).
- **MetricsComputeService** (bug fix) — replace the `.from('payment_invoices').select('total_amount')…status='overdue'` block by reusing `getOverdueInvoices(userId, { statuses: ['overdue'] })` — **omit `asOfDate` and leave `minAmount` default** (M7) so the overdue-only sum isn't narrowed by the detector's 7-day/`>0` filters — then sum `amount` in-service. **Keeps `status='overdue'`-only semantics (M4)**, just fixes the phantom column. This changes the metric from always-0 to the real overdue total → **QA note** (below).
- **OpsUtilizationLowDetector** (bug fix) — replace `.from('scheduling_availability')` with `new BusinessProfileRepository(this.supabase)` (**M5:** add a DI constructor arg to `BusinessProfileRepository`, `constructor(supabase: SupabaseClient = supabaseServer)`, singleton export byte-compatible). Read `profile.scheduling_availability` — **type the field explicitly at the read site (M2)**: `scheduling_availability` is absent from the (missing) generated `Database` type, so declare a narrow local type `{ [day: string]: { start: string; end: string }[] }` (no `any`). Then rewrite `calculateAvailableHours` (**M3** — currently a hardcoded `return 40`) to sum `(end − start)` across each day's intervals in the weekly JSONB, with a **40h fallback** when the object is empty `{}` / missing / malformed. This changes availability from always-40h to the real configured hours → **QA note** (below).

## Guardrails

- The new repo method is **`user_id`-scoped** (the detectors already pass the per-user `userId`; keep it).
- **Behavior:** CashArOverdueDetector output must be equivalent (same rows, same math) — pure refactor. MetricsComputeService + OpsUtilizationLowDetector are **intended behavior changes** (bug fixes) — document expected before/after for QA.
- No `console.*` introduced (subsystem is Pino-clean). If a touched file has any, convert (none expected).
- Do **not** touch the ~42 self-read sites, the crons' user-discovery scan, or anything Step-3-related.

## Tests (lean)

- Unit test for the generalized `PaymentInvoiceRepository.getOverdueInvoices` (mocked Supabase builder): `user_id` scope + the `statuses`/`asOfDate`/`minAmount` filters (incl. defaults) + `{data,error}` shape.
- Unit test for `calculateAvailableHours` (M3) — pure function over the weekly JSONB: sums intervals; empty `{}` / missing / malformed → 40h fallback.
- Detector/metric refactors: a focused unit test with a mocked repo asserting each site calls the repo (not `.from()`) where cheap; the before/after data-correctness is **QA-manual**.

**QA oracle — the 2 intended behavior changes (bug fixes):**
- `cashflow.ar_overdue_usd` metric: was **always 0** (phantom `total_amount`) → now the real sum of `amount` for `status='overdue'` invoices. **QA must seed `status='overdue'` rows** (not merely past-due `sent` rows — the metric is overdue-only, and flipping `sent`→`overdue` depends on the separate `markOverdueInvoices` cron, out of scope here).
- OpsUtilizationLow availability: was **always 40h** (phantom table) → now the real configured hours from `business_profiles.scheduling_availability`. QA seeds a profile with a known weekly availability and checks the computed hours.
- CashArOverdueDetector: **no behavior change** — same overdue rows + same math (pure refactor).

## Open issues seeded to the roadmap

- ✅ (this WP) 3 foreign G2 reads routed through repos; `total_amount` + `scheduling_availability` phantom reads fixed.
- ⬜ Remaining G2 (subsystem self-reads: `derived_metrics`, `insight_automations`, kernel) — deferred; only needed if Insights becomes a plugin (post-Step-3).
- ℹ️ Cross-ref: this closes the "Insight G2 direct-DB reads" note under Payments and overlaps CRM 1.2.c.

## Implementation notes (Dev)

**Implemented:** 2026-08-11 on branch `docs/business-os-event-driven-architecture`. All of M1–M7 handled. RM held (no commit).

### Files changed
| File | Change |
|---|---|
| `lib/repositories/PaymentRepository.ts` | ✅ **M1** — generalized existing `PaymentInvoiceRepository.getOverdueInvoices(userId)` in place to `getOverdueInvoices(userId, opts?: { asOfDate?; statuses?; minAmount? })`. Defaults: `statuses=['pending','sent','overdue']`, `asOfDate=now ISO`, `minAmount=0`. Query `.eq('user_id',…).in('status',…).lt('due_date',…).gt('amount',…).order('due_date')`. Value column `amount`. `{data,error}` + Pino preserved. |
| `lib/repositories/BusinessProfileRepository.ts` | ✅ **M5** — added `constructor(supabase: SupabaseClient = supabaseServer)` (imported `SupabaseClient` type), `private supabase` now assigned from arg. Singleton export `new BusinessProfileRepository()` unchanged/byte-compatible. Query logic untouched. |
| `lib/business-os/insight/detectors/catalog/CashArOverdueDetector.ts` | ✅ Step-2 site 1 (pure refactor) — replaced `.from('payment_invoices')` with `new PaymentInvoiceRepository(this.supabase).getOverdueInvoices(userId, { asOfDate: overdueDate.toISOString() (**M6**), statuses:['pending','sent','overdue'], minAmount:0 })`. Math preserved; `parseFloat(inv.amount||'0')` → `Number(inv.amount)||0` (repo now returns typed `amount: number`; behavior-equivalent). |
| `lib/business-os/insight/metrics/MetricsComputeService.ts` | ✅ Step-2 site 2 (bug fix) — replaced `.from('payment_invoices').select('total_amount')…status='overdue'` (phantom column → always 0) with `getOverdueInvoices(userId, { statuses:['overdue'] })` (**M7**: omit `asOfDate`, default `minAmount`), then sum real `amount` in-service. `{ value, unit, sampleSize=rowcount }` shape preserved. `status='overdue'`-only semantics kept (**M4**). |
| `lib/business-os/insight/detectors/catalog/OpsUtilizationLowDetector.ts` | ✅ Step-2 site 3 (bug fix) — replaced `.from('scheduling_availability')` (phantom table → always 40h) with `new BusinessProfileRepository(this.supabase).findByUserId(userId)` reading `profile?.scheduling_availability`. **M2**: typed via local `WeeklyAvailability = Record<string, {start;end}[]>` + narrow cast (no `any`). **M3**: rewrote `calculateAvailableHours` (was hardcoded `return 40`) as an exported pure function summing `(end−start)` across intervals with safe `HH:MM` parsing and 40h fallback for empty/missing/malformed. |
| `lib/repositories/__tests__/PaymentRepository.getOverdueInvoices.test.ts` | ➕ new — mocked Supabase builder: defaults + explicit opts filters, `user_id` scope, `{data,error}` shape (3 tests). |
| `lib/business-os/insight/detectors/catalog/__tests__/OpsUtilizationLowDetector.availability.test.ts` | ➕ new — `calculateAvailableHours` pure-function tests: single/multi intervals, empty/null/undefined/malformed → 40h (6 tests). |

### M1 zero-caller confirmation
`grep -rn "getOverdueInvoices" lib app scripts components` → only the definition itself (PaymentRepository.ts:708). Zero callers. `grep -rin "getOverdueInvoices|get_overdue" lib/plugins` → no Payments plugin op maps to it. Safe to generalize in place (no duplicate-function).

### `calculateAvailableHours` parsing approach
`HH:MM` parsed via `/^(\d{1,2}):(\d{2})$/` → fractional hours (`h + m/60`), rejecting out-of-range (h>23 / m>59). Per interval: skip if either endpoint unparseable or `end <= start`. Sum valid intervals across all day keys; if **no** valid interval was found (empty `{}`, missing, or fully malformed), return the 40h fallback. Non-object input → 40h.

### Verification
- **Typecheck:** `npx tsc --noEmit` — **0 new errors** in touched files. The 4 remaining errors under these paths are **pre-existing baseline** (verified by stashing my changes and re-running: identical errors at shifted line numbers): 3 in OpsUtilizationLowDetector from `BaselineCalculator`/`getBaselineLookbackDays` signature mismatches (untouched code), and 1 `Cannot find module '@/types/database'` in BusinessProfileRepository (the generated Database type is absent — the M2 root cause). The M2 explicit `scheduling_availability` typing compiles cleanly.
- **Tests:** `npx jest` on the 2 new files → **2 suites / 9 tests passing**.
- **console.\*:** none in any touched file (subsystem is Pino-clean, as predicted).

### Deviations
- CashArOverdueDetector math changed `parseFloat(inv.amount||'0')` → `Number(inv.amount)||0`. Necessary because the repo now returns typed `amount: number` (the old direct-`.from()` returned `any`, so `parseFloat` on a number would be a strict-TS error). Behavior-equivalent for numeric amounts; still a pure refactor.
- Detector/metric "calls-the-repo-not-`.from()`" assertion tests were **not** added — they require mocking `BaseDetector` internals / private `computeSnapshotMetric`, which the plan flagged as optional ("where cheap"). Call-site correctness is covered by the typecheck (repo signature) + QA-manual data-correctness oracle in §Tests.

## SA review

**Reviewed by SA — 2026-08-11**
**Status:** 🔄 APPROVE-WITH-CHANGES

Direction, scope, and root-cause targeting are correct. The 2 bugs are real, the pure-refactor site is genuinely pure, and the scope discipline holds. **However there is one High-severity factual error in the workplan (the target repo method already exists) and one typing gap that will break `strict` TS**, both of which must be resolved before/while implementing. Fix M1–M2 and lock the decisions in M3–M5; M6–M7 are implementation notes.

### Decisions (answers to the 5 questions)

1. **Method shape** → single flexible rows method `getOverdueInvoices(userId, opts?)`; metric sums `amount` in-service. **Do NOT add a dedicated `sumOverdueAmount`.** BUT see M1 — this must **generalize the existing method, not add a new one.** Confirmed scoping stays `.eq('user_id', userId)` and value column is `amount`.
2. **Metric semantics** → **keep `status='overdue'`-only**, fix `total_amount`→`amount` only. Do not broaden to the detector's `[pending,sent,overdue]` set — that is a product redefinition beyond this minimal slice. It is still a behavior change (0 → real total) — QA note required (M4). Advisory: overdue-only depends on the `markOverdueInvoices` cron actually running to flip `sent`→`overdue`; out of scope but note it so QA seeds `status='overdue'` rows, not just past-due `sent` rows.
3. **BusinessProfileRepository DI** → **recommend adding a DI constructor arg** `constructor(supabase: SupabaseClient = supabaseServer)` (mirrors the already-refactored `PaymentInvoiceRepository`), so the detector's injected client is used and the read is unit-testable. Option (b) singleton is acceptable in the cron (both are service-role) but is asymmetric with the Payments site and untestable — prefer (a). (M5)
4. **calculateAvailableHours** → **genuine change, not a trivial adapt.** It currently `return 40` hardcoded and does no parsing. It must sum durations across the weekly JSONB `{ monday:[{start,end}], … }` and keep the 40h fallback when the object is empty/`{}` (the column default). Spec the null/empty/malformed handling. (M3)
5. **Bugs** → both **confirmed real.** `total_amount` is phantom on `payment_invoices` (real column `amount`; migration `20260722_create_payment_tables.sql:14` has no `total_amount` — that name only exists on `payment_plans`, migration `20260723_enhance_payments.sql:107`). The select-error path (`if (error || !data) return {value:0}`) is why the metric silently returns **0** today. `scheduling_availability` is a JSONB **column** on `business_profiles` (`20260722_add_scheduling_availability_to_business_profiles.sql`), not a table → `.from('scheduling_availability')` errors, `data` is null, availability **always defaults to 40h**. No third phantom read: CashArOverdueDetector reads real columns (`amount`, `due_date`) and is a pure refactor.

### Change items

- **M1 — HIGH — `lib/repositories/PaymentRepository.ts:708`.** The workplan's core premise is wrong: **`getOverdueInvoices(userId)` already exists** (lines 705–727) with different semantics (`status='sent'` only, `due_date < today`, no `amount>0`). TypeScript will not allow a second implementation of the same name (duplicate-function error). Grep confirms **zero callers** anywhere (`lib/app/scripts/components`, incl. JSON), so it is safe to **generalize it in place** to `getOverdueInvoices(userId, opts?: { asOfDate?; statuses?; minAmount? })`. Update the workplan text at line 29 ("No existing getOverdueInvoices today") — it is factually incorrect. Before editing, Dev must re-confirm no Payments plugin op maps to it by name.
- **M2 — HIGH — `types/database…` (generated `Database` type).** `scheduling_availability` is **not present in the generated `Database` type** (grep of `types/` returns nothing), so `profile.scheduling_availability` will fail under strict mode / `next build` type-check. Resolve by regenerating the Supabase types (preferred) or, if that's out of scope, add an explicit narrow type for the field at the read site with a comment — do not paper over with `any`.
- **M3 — MEDIUM — `OpsUtilizationLowDetector.ts:144` `calculateAvailableHours`.** Replace the hardcoded `return 40` with a real parser over the weekly JSONB shape (sum `(end-start)` across each day's intervals). Keep 40h fallback for empty `{}`/missing/malformed. Add the expected before/after (40h default → real configured hours) to the QA section.
- **M4 — MEDIUM — `MetricsComputeService.ts:404`.** Lock to `status='overdue'`-only + `amount`. Document the 0→real-total behavior change in the QA section; note the `markOverdueInvoices`-cron dependency so QA seeds `overdue` rows.
- **M5 — MEDIUM — `BusinessProfileRepository.ts:32`.** Add the DI constructor arg (default `supabaseServer`) so `new BusinessProfileRepository(this.supabase)` uses the injected client; the singleton export stays byte-compatible. This keeps both foreign-read sites symmetric and unit-testable.
- **M6 — LOW — `CashArOverdueDetector.ts:86`.** Pure refactor preserved, but `opts.asOfDate` is typed `string` while the detector holds a `Date` — pass `overdueDate.toISOString()`. `getOverdueInvoices` returning `select('*')` vs the old `select('id, amount, due_date)` is fine (math uses only those three); order differs but does not affect the sum or id set.
- **M7 — LOW — metric reuse of `getOverdueInvoices`.** When the metric reuses the method with `statuses:['overdue']`, **omit `asOfDate`** (or pass far-future) and keep `minAmount` default so the overdue-only sum is not silently narrowed by the 7-day/`>0` filters the detector wants. Confirm the default `opts` semantics don't change the metric's population vs today's `status='overdue'` select.

### Rationale

The slice is proportional and fixes the right things at the right layer (foreign reads → repositories; self-reads correctly deferred). No RLS/Zod/logging violations — subsystem is Pino-clean and the reads stay `user_id`-scoped. The only blockers are correctness/compile issues (M1 duplicate method, M2 missing type), not design. Once M1–M2 are resolved and M3–M5 decisions are written into the plan, this is approved to implement.

### Approval
- [ ] Workplan approved — proceed to implementation (blocked on M1, M2; lock M3–M5)

### 9.2 SA code review (post-implementation)

**Reviewed by SA — 2026-08-11**
**Status:** ✅ **APPROVE** (one LOW advisory for QA — not a blocker)

Implementation is faithful to the SA-approved plan. All of M1–M7 are correctly implemented, both latent bugs are fixed at the right layer (foreign reads → repositories), the pure-refactor site is genuinely equivalent, and scope discipline holds (only the 3 sites changed; self-reads and crons untouched). Typecheck adds **0 new errors**; the 2 new test suites pass (9/9). No RLS/Zod/Pino violations. Code approved for QA.

#### Verification results

- **Typecheck (`npx tsc --noEmit`):** 4 errors remain under the touched paths — all **confirmed pre-existing baseline** by `git stash`-ing the 5 source changes and re-running (identical errors at shifted line numbers):
  - `OpsUtilizationLowDetector.ts` (78/120/128 baseline → 129/170/178 post-change) — `BaselineCalculator`/`getBaselineLookbackDays` / `PeriodType` signature mismatches in **untouched** code below the changed block.
  - `BusinessProfileRepository.ts:10` — `Cannot find module '@/types/database'` (generated `Database` type absent; the M2 root cause the plan already documents).
  - The M2 explicit `WeeklyAvailability` typing and the DI constructor both compile cleanly. **0 NEW errors introduced.**
- **Tests (`npx jest` on the 2 new files):** `2 suites / 9 tests passing` (3 repo + 6 availability). The error-path test logs a Pino `error` line as expected (asserts `{ data:null, error }`, never throws).

#### Findings (by review priority)

1. **M1 — `PaymentRepository.ts:713-741` — PASS.** Generalized the existing method in place (single implementation, no duplicate-function). Keeps `.eq('user_id', userId)`, uses `amount` via `.gt('amount', minAmount)` (never `total_amount`), defaults `statuses=['pending','sent','overdue']` / `asOfDate=new Date().toISOString()` / `minAmount=0`, returns `{ data: data || [], error: null }` with `logger.error({ err, userId }, …)`. Old method had `status='sent'`-only + zero callers → no possible regression. Defaults are sane.
2. **CashArOverdueDetector — PASS (pure refactor, equivalent).** Same status set, same `due_date < now-7d` via `asOfDate: overdueDate.toISOString()`, same `amount>0` via `minAmount:0`. `select('*')` superset of the old `id, amount, due_date` — `inv.id` (line 128/136) and the reduce still resolve. `parseFloat(inv.amount||'0')` → `Number(inv.amount)||0` is behavior-equivalent: `null→0`, `NaN→0`, numeric passthrough (repo now returns typed `amount:number`, so `parseFloat` on a number would be a strict-TS error — the change is required, not cosmetic).
3. **MetricsComputeService:403-416 — PASS with LOW advisory.** Reuses `getOverdueInvoices(userId, { statuses:['overdue'] })`, sums real `amount` in-service, preserves `{ value, unit, sampleSize: data.length }`, keeps `status='overdue'`-only (M4). **LOW advisory (QA note):** M7's stated goal was that the overdue sum "isn't narrowed," but by relying on the method **defaults** (asOfDate omitted → `now`; minAmount omitted → `0`), the query now applies `.lt('due_date', now)` **and** `.gt('amount', 0)` — filters the old bare `status='overdue'` select did not have. Effective population is now `overdue ∧ due_date<now ∧ amount>0` vs old `overdue`. For real data this is equivalent (overdue rows are past-due with positive amounts, and non-positive amounts contribute 0 to the sum anyway), so the **value** is unaffected; but `sampleSize` can differ and an edge-case overdue row with a future `due_date` or non-positive `amount` would now be excluded. Not a blocker — the plan's own M7 wording carried this latent contradiction (default asOfDate is `now`, not "no filter"). **QA:** seed `status='overdue'` rows with past `due_date` + positive `amount` (as the oracle already implies); if strict parity with the old select is desired, Dev can pass a far-future `asOfDate` — surgical, optional.
4. **OpsUtilizationLowDetector + `calculateAvailableHours` — PASS.** Read routed through `new BusinessProfileRepository(this.supabase).findByUserId(userId)`; `scheduling_availability` typed via local `WeeklyAvailability` + narrow cast (M2, no `any`). `calculateAvailableHours` is now an **exported pure function**: HH:MM via `/^(\d{1,2}):(\d{2})$/`, range-checked (h≤23/m≤59), fractional hours (`h + m/60`), skips `end<=start` and unparseable endpoints, and returns the 40h fallback only when **no** valid interval was found — the `{}` fallback truly triggers (`hasValidInterval` stays false). Non-object input short-circuits to 40h. Tests cover single/multi/empty/null/undefined/all-malformed/mixed. Old private `return 40` stub removed (no dead code).
5. **M5 DI — `BusinessProfileRepository.ts:34-39` — PASS.** `constructor(supabase: SupabaseClient = supabaseServer)`; singleton `export const businessProfileRepository = new BusinessProfileRepository();` (line 427) byte-compatible via default arg. Query logic unchanged, `user_id` scope intact.
6. **Scope discipline — PASS.** Only the 3 foreign-read sites changed. Subsystem self-reads remain untouched (`OpsUtilizationLowDetector.ts:142` `business_events`, `MetricsComputeService.ts:141` `derived_metrics`). No new `.from()` introduced outside repositories (the only `.from(` in CashArOverdueDetector is a comment). Cron user-discovery scan and Step-3 code untouched.
7. **Standards — PASS.** Repository pattern honored, Pino-clean (0 `console.*` in any touched file), TS strict (M2 typing compiles), `user_id` scoping preserved at every site.

#### Optimisation suggestions (non-blocking)
- If exact parity with the pre-fix metric population is ever required, have the metric pass an explicit far-future `asOfDate` (documents intent and removes the implicit `due_date<now` narrowing). Optional — current behavior is correct for real overdue data.

#### Code Approved for QA: **Yes**

## QA report

**QA — 2026-08-11**
**Test mode:** full (small read-refactor + 2 latent bug fixes)
**Strategy used:** A (Jest unit) for the new tests + static/source audit (in-memory reasoning, no dev server, per task) + `tsc` baseline diff via `git stash`
**Focus:** api / repository + insight subsystem correctness + security (user_id scope) + scope-discipline
**Skipped:** integration/e2e (no live DB seed this session — the 2 behavior-change oracles are documented as QA-manual data-correctness; value reasoning done statically)
**Input source:** prompt keywords + workplan §Tests QA-oracle + §9/§9.2 SA reviews

### Verdict: ✅ **PASS-WITH-NOTES**

All acceptance criteria pass. Tests 9/9 green, typecheck adds **0 NEW errors** (4 remaining = confirmed pre-existing baseline), both latent bugs fixed at the right layer, CashArOverdueDetector is a genuine pure refactor, and scope discipline holds. Notes are pre-known edge cases (all already flagged by SA §9.2 or benign) — **no bugs found, nothing for Dev to fix**.

### Test Coverage
| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| `getOverdueInvoices` user_id scope + statuses/asOfDate/minAmount filters + defaults + `{data,error}` | ✅ | Pass | 3 tests: defaults (`user_id`, `in status [pending,sent,overdue]`, `gt amount 0`, `lt due_date <ISO>`), explicit opts (`[overdue]`/`2026-03-01`/`50`), error path returns `{data:null,error}` never throws |
| `calculateAvailableHours` sums intervals + 40h fallback on empty/missing/malformed | ✅ | Pass | 6 tests: single/multi intervals, `{}`, null/undefined, all-malformed, mixed valid+malformed |
| `total_amount` phantom column removed (metric fix) | ✅ | Pass (static) | Only `amount` used via `.gt('amount',…)` + in-service reduce; sole `total_amount` occurrence is a code comment |
| `scheduling_availability` phantom-table read removed (availability fix) | ✅ | Pass (static) | Read routed through `BusinessProfileRepository.findByUserId`; no `.from('scheduling_availability')` remains in the subsystem |
| CashArOverdueDetector = pure refactor (same rows + same math) | ✅ | Pass (reasoning) | See equivalence proof below |
| Typecheck: 5 touched files add 0 NEW errors | ✅ | Pass | Baseline-diff confirmed via `git stash` |
| Scope: only the 3 sites changed; self-reads + crons untouched | ✅ | Pass | See scope check below |
| No `console.*` introduced | ✅ | Pass | 0 in all 5 touched files |

### Test + typecheck results
- **Jest** (`PaymentRepository.getOverdueInvoices.test.ts` + `OpsUtilizationLowDetector.availability.test.ts`): **2 suites / 9 tests passing** (3 repo + 6 availability), 3.6s. The error-path test emits one expected Pino `error` line (`msg:"Failed to get overdue invoices"`) and asserts `{data:null,error}` — does not throw.
- **`npx tsc --noEmit`** filtered to touched paths → **4 errors, all pre-existing baseline**, verified by stashing the 5 source files and re-running: identical errors at shifted line numbers.
  - `OpsUtilizationLowDetector.ts` 129/170/178 (post-change) ⇄ 78/120/128 (baseline) — `BaselineCalculator`/`getBaselineLookbackDays`/`PeriodType` signature mismatches in **untouched** code below the changed block.
  - `BusinessProfileRepository.ts:10` (post) ⇄ `:9` (baseline) — `Cannot find module '@/types/database'` (generated Database type absent; the M2 root cause).
  - **0 NEW errors.** The M2 `WeeklyAvailability` typing, the DI constructor, and the newly-added `asOfDate:'9999-12-31…'` line all compile cleanly (no error emitted for MetricsComputeService).

### CashArOverdueDetector — pure-refactor equivalence (verified)
New call: `getOverdueInvoices(userId, { asOfDate: overdueDate.toISOString(), statuses:['pending','sent','overdue'], minAmount:0 })` compiles to `.eq('user_id',userId).in('status',[pending,sent,overdue]).lt('due_date', overdueDate.toISOString()).gt('amount',0).order('due_date')`.
- **user_id** — repo always applies `.eq('user_id',userId)`; call site passes the per-user id. Scope preserved.
- **status set** — identical `[pending,sent,overdue]`.
- **due_date** — old passed the raw `Date` (Supabase serializes to the same ISO); new passes `.toISOString()` explicitly → identical bound.
- **amount** — old `.gt('amount',0)` == new `minAmount:0`.
- **select** — old `id,amount,due_date` → new `select('*')` is a superset; math uses only `id`/`amount`; added `.order('due_date')` doesn't affect the sum or the id set.
- **amount math** — `Number(x)||0` vs old `parseFloat(x||'0')`: numeric→same, `null`→0 both, `undefined`→0 both, `""`→0 both, `"100"`→100 both. (For a non-numeric string the new `Number()||0`→0 while old `parseFloat`→NaN would poison the sum — the new form is strictly *more* robust, and `amount` is a numeric DB column so neither case arises with real data.) **Behavior-equivalent — genuine pure refactor.**

### Bug-fix before/after confirmations
1. **`cashflow.ar_overdue_usd` metric** (`MetricsComputeService.ts:402-421`): **before** = `.select('total_amount')` on a phantom column → select error → `if (error||!data) return {value:0}` → **always 0**. **after** = `getOverdueInvoices(userId, { statuses:['overdue'], asOfDate:'9999-12-31…' })` summing the real `amount` in-service → **real overdue total**. Far-future `asOfDate` neutralizes the method default `.lt('due_date', now)` for strict parity (SA §9.2 advisory adopted). `{value, unit, sampleSize:data.length}` shape preserved; `status='overdue'`-only semantics kept (M4).
2. **OpsUtilizationLow availability** (`OpsUtilizationLowDetector.ts:153-163`): **before** = `.from('scheduling_availability')` (phantom table) → query error → `data` null → `calculateAvailableHours` was a hardcoded `return 40` → **always 40h**. **after** = read via `BusinessProfileRepository.findByUserId` → `profile.scheduling_availability` (typed, no `any`) → real parser summing `(end−start)` across weekly intervals with 40h fallback → **real configured hours**.

### Scope-discipline check — PASS
`grep .from( lib/business-os/insight/` (excl. tests): every remaining call is a subsystem **self-read/write** (`insights`, `insight_automations`, `derived_metrics`, `business_events`, `kernel_executions`, `kernel_action_log`, `owner_insight_history`) — the ~42 deferred self-reads, untouched. Notably `OpsUtilizationLowDetector.ts:142 .from('business_events')` (avg-booking impact estimate) and `MetricsComputeService.ts:141 .from('derived_metrics')` (upsert) are correctly left in place. `CashArOverdueDetector.ts:82` is a comment. No foreign-module `.from()` remains; no new `.from()` introduced outside repositories. Cron user-discovery scan and Step-3 code untouched.

### Edge cases (PASS/CONCERN — no fix)
1. **Day mapped to `[]`** (0 hours that day) — **PASS.** Empty interval array contributes 0; other valid days still sum. Only falls back to 40h if *no* day has any valid interval.
2. **Malformed time `"9"` (no colon) / `"25:70"`** — **PASS.** `"9"` fails the `HH:MM` regex → null → skipped. `"25:70"` matches the shape but `h>23`/`m>59` range-check → null → skipped.
3. **`getOverdueInvoices(userId, { statuses: [] })`** — **CONCERN (note only, no current caller).** `[] ?? default` keeps `[]` (empty array is not nullish), so `.in('status', [])` matches **zero rows** silently — a latent footgun for a future caller who passes an explicit empty array expecting "all". Defaults protect the two present call sites (both pass non-empty `statuses` or omit the key). Recommend a future guard (`statuses?.length ? statuses : default`) if the method gains external callers. Not a bug today.
4. **Metric when repo errors** — **PASS.** `if (error || !data) return {value:0, sampleSize:0}` — graceful zero, no throw.
5. **Metric parity fine-print (SA §9.2 LOW, re-confirmed)** — **PASS-with-note.** With `asOfDate:'9999-…'` the `.lt('due_date', …)` no longer narrows, but two residual differences vs a bare `status='overdue'` select remain, both benign: (a) `.gt('amount',0)` excludes `amount<=0` rows — they'd contribute 0 to the sum so **value is identical**, though `sampleSize` can differ by such rows; (b) an overdue row with `due_date IS NULL` is excluded by the `.lt` NULL-comparison — theoretically possible but abnormal for an overdue invoice (overdue implies a past due_date). Value correct for all realistic overdue data.

### Issues Found
**Bugs (must fix before commit):** none.
**Performance:** none (reads are indexed single-table `user_id`-scoped selects; no new N+1).
**Edge cases (nice to fix, non-blocking):** empty-`statuses` footgun in `getOverdueInvoices` (edge case #3) — optional hardening for future external callers.

### Final Status
- [x] All acceptance criteria pass — ready for commit (RM still held per the user's code-review gate; QA raises no blocker)
- [ ] Issues found — Dev must address before commit

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-11 | Implemented (Dev) | M1–M7 done: generalized `getOverdueInvoices`, DI on `BusinessProfileRepository`, 3 foreign reads routed through repos (fixing `total_amount` phantom column + `scheduling_availability` phantom table). 2 unit test files (9 tests) added. Typecheck 0 new errors on touched files; RM held. See §Implementation notes. |
| 2026-08-10 | Created | Minimal G2 slice per user decision (Insights stays a service). Route the 3 foreign-module reads through repos; adds `PaymentInvoiceRepository.getOverdueInvoices`; fixes 2 latent bugs (`payment_invoices.total_amount` phantom column → `amount`; `scheduling_availability` phantom table → `business_profiles` JSONB via repo). Subsystem self-reads + any plugin work deferred (post-Step-3). |
