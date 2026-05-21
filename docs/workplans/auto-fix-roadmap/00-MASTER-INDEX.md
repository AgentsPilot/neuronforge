# Auto-Fix Roadmap — Master Index

> **Last Updated**: 2026-05-13
> **Status**: 📋 ROADMAP — 7 sub-workplans, deliberately split for focused sessions
> **Author**: Dev agent

## Purpose

This is the master index for the **auto-fix roadmap** — seven workplans that together push AgentPilot's calibration system from "detect issues" to "silently fix or one-click resolve" for the largest possible share of failure modes.

These were carved out of a longer session that already shipped:
- 12 Tier 1–3 execution-layer fixes (field-ref validation, strict resolution, scope refactor, loop namespacing, conditional coercion, scatter shape, runMode in scatter, output validation, idempotency plumbing, structural validator rename, structural-repair persistence flag, plus an eval audit)
- Post-execution-audit cleanups (G1–G4)
- Calibration audit fixes (G-CAL-1 → G-CAL-4 + repair-engine docs)
- User-facing translator (`lib/pilot/shadow/userFacing.ts`)

What remains is the **next level of ambition**: make calibration auto-fix categories of issues that today produce technical errors or silent failures.

## Honest scope statement

These 7 workplans total roughly **30–50 hours of careful work**. Each is sized for ONE focused session. Attempting them in parallel or in a single sprint will cut corners — these touch DB schemas, per-plugin executor code, and runtime hot paths.

**Sequence recommendation:** ship in the order below. Earlier items have fewer dependencies and unblock later ones.

## The 7 workplans

| # | Workplan | Effort | File |
|---|---|---|---|
| 1 | **Rate-limit / quota auto-remediation** — when `FailureClassifier` returns `rate_limit`, auto-inject per-step retry policy with backoff | ~2h | [01-rate-limit-auto-remediation.md](./01-rate-limit-auto-remediation.md) |
| 2 | **AI step nondeterminism narrowing** — auto-enforce `temperature=0`, structured outputs, retry-on-shape-mismatch | ~1.5h | [02-ai-step-determinism.md](./02-ai-step-determinism.md) |
| 3 | **Idempotency-key adoption per plugin** — wire `params._idempotency_key` into each plugin executor that supports it | ~2–3h per plugin × 4 plugins | [03-idempotency-per-plugin.md](./03-idempotency-per-plugin.md) |
| 4 | **Empty-result auto-diagnosis** — when dry-run returns empty, walk backward to find root cause; auto-relax filter or surface source issue | ~5–6h | [04-empty-result-auto-diagnosis.md](./04-empty-result-auto-diagnosis.md) |
| 5 | **Plugin output schema drift detection** — cache schema at agent-save, compare at run, auto-trigger re-calibration on drift | ~4–5h | [05-plugin-schema-drift-detection.md](./05-plugin-schema-drift-detection.md) |
| 6 | **Distribution-aware multi-sample testing** — replace single-sample `DryRunValidator` with 3–5 representative samples per source | ~6–8h | [06-multi-sample-distribution-testing.md](./06-multi-sample-distribution-testing.md) |
| 7 | **Schema-driven auto-coercion at step boundaries** — make today's fuzzy resolution explicit by inserting transform steps at compile time | ~5–6h | [07-schema-driven-coercion.md](./07-schema-driven-coercion.md) |

## Projected impact

The current calibration system catches and auto-fixes roughly **40–50% of issues** that surface during a calibration run.

After this roadmap completes, the projected split is:

| Category | Today | After roadmap |
|---|---|---|
| Silently auto-fixed | ~40% | ~65–70% |
| One-click user decision | ~10% | ~20–25% |
| User must debug | ~50% | ~5–10% |
| Unfixable in principle (semantic correctness, future drift) | ~5–10% | ~5–10% |

The irreducible 5–10% (semantic correctness, future external system drift, time-dependent state) is honest: no automated system can resolve these without ground truth the system doesn't have. The roadmap explicitly does NOT claim to fix them.

## Dependencies between workplans

Most workplans are independent. The constraints are:

- **#3 (idempotency-per-plugin)** depends on the idempotency-key plumbing already shipped in Tier 3 Fix #10 (`StepExecutor.deriveIdempotencyKey`).
- **#5 (schema drift detection)** introduces a new DB table (`plugin_schema_cache`); design must be reviewed with SA before implementation.
- **#6 (multi-sample testing)** modifies `DryRunValidator` — best done after #4 (which also touches this file), to avoid merge friction.

No workplan blocks the others. They can ship in any order, but the sequence above maximizes early wins.

## What this roadmap explicitly does NOT cover

- **Production observability layer.** Real failures in production should feed back into calibration as new test cases. This is its own architectural workstream (would be roadmap item #8). Not in scope here.
- **Semantic correctness validation.** "Does the workflow do what the user MEANT?" is irreducible without external ground truth. Best partial answer is an LLM judge on the IR + the user's original prompt — a separate workplan.
- **UI changes to the calibration page.** Each of these workplans assumes the existing UI continues to render `UserFacingIssue` objects from the translator. No UI work is in scope.

## Change history

| Date | Change | Details |
|------|--------|---------|
| 2026-05-13 | Roadmap initial draft | Dev agent — captured from session discussion on calibration's auto-fix ambition |
