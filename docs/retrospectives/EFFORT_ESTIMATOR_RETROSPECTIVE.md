# Effort Estimator Retrospective

> **Last Updated**: 2026-06-11
> **Cycle Duration**: 2026-06-03 (BA kickoff) → 2026-06-11 (merge to main)
> **Outcome**: Shipped to main as merge commit `16069d1`

## Overview

This cycle delivered the Effort Estimator — a new `lib/effort-estimator/` module that simulates an SMB-owner persona via an LLM call to populate `agent_config.roi_estimate` for newly created agents and on-demand via a v2 API endpoint. The work spanned BA → SA → Dev → SA → QA → RM with the user driving an unusually high number of revision rounds (eight discrete user-initiated revisions across requirements, code review, and integration tooling) before the cycle merged. Headline numbers: 9 calendar days, 7 commits on the feature branch, 32 files changed, ~6,200 lines added, 49 unit/integration tests passing, 4 documentation artifacts produced, and one latent production bug fixed that nobody else would have caught.

---

## What we shipped

Now on main as of `16069d1`:

- `lib/effort-estimator/` — 8 production source files (types, prompt builder, persona resolver, model resolver, retry helper, orchestrator, fire-and-forget dispatcher, barrel) plus 6 co-located test suites.
- `POST /api/v2/agents/[agentId]/estimate-effort` — synchronous API endpoint that awaits the estimator and returns the result, with explicit 401 / 400 / 404 / 503 / 500 failure mapping.
- Latent bug fix: `lib/repositories/UserProfileRepository.ts` — created the repo class that `lib/user-context/builders.ts` had been importing against an undefined symbol since some prior refactor. Production was unaffected only because no production caller used `buildUserContextFromProfile`.
- Deprecation guard for `BusinessInsightGenerator.updateAgentROI`: two co-existing self-guards at lines 901 (pre-existing column null-check) and 916 (new `!existingROI` JSONB gate) prevent the deprecated writer from overwriting fresh estimates during the deprecation window. `@deprecated 2026-06-10` JSDoc applied.
- Integration test CLI under `tests/effort-estimator/scripts/run-on-agent.ts` — live end-to-end runner with `--dry-run` (real LLM call, no DB write), `--log-dir`, self-loading env bootstrap, and JSON-Lines per-run log file output.
- Design document `docs/EFFORT_ESTIMATOR.md` (235 lines, ToC, change history, decision rationale).
- 49 unit + integration tests across 8 suites (40 estimator-module + 6 route + 3 deprecated-guard), all passing.
- `CLAUDE.md` documentation table row pointing at the design doc.

---

## What went well

- **BA-first scoping prevented scope creep.** The requirement MD was authored after seven clarification turns with the user and locked the output schema, retry budget, failure semantics, and trigger points up front. When the cycle hit eight user-initiated revision rounds later on, every revision was a tightening within the BA scope, never an expansion outside it.
- **SA caught the load-bearing architectural issues twice before the user saw the code.** The workplan-review pass surfaced two BLOCKING issues (the AC-4 deprecated-path guard was on the wrong column; the regen-trigger gate was reading from the post-whitelist `updateData` instead of the request body `agentData`) that would each have silently broken acceptance criteria in production. The code-review pass then verified all 7 of its own non-blocking workplan observations had been addressed at the file:line level.
- **Multi-session pause/resume worked cleanly.** The cycle paused on 2026-06-08 (mid-revision, on the wrong branch, with the workplan untracked) and resumed on 2026-06-10 without losing context. The combination of a SESSION PAUSE STATE block at the top of the workplan, an auto-memory entry, and a paste-ready resume prompt was sufficient redundancy — no handshake was dropped, no decision was re-asked.
- **The integration test script surfaced a latent production bug nobody else would have caught.** Running `run-on-agent.ts --dry-run` against a real agent crashed with `TypeError: UserProfileRepository is not a constructor` — a defect that had been silently present since some prior refactor. No production code path called `buildUserContextFromProfile`, so the bug had no observable effect until this script became the first runtime caller. Creating the missing repository was a clean fix that respected the repository pattern (CLAUDE.md mandatory rule #1).
- **`--no-ff` merge preserved the full cycle audit trail on main.** The feature branch's seven commits — workplan, requirement updates, implementation, two revision passes, integration tooling, and bug fix — are all reachable from main via the merge commit. Future archaeology on "why is the deprecated guard there" lands directly in the original cycle's discussion.

---

## What did not go well

- **SA missed a CLAUDE.md mandatory rule #1 violation on the first code review.** `modelResolver.ts` was originally written with a direct `supabaseServer.from('system_settings_config').select(...)` call, and SA's code-review explicitly *defended* the pattern with "no repo exists — matches `AgentGenerationConfigService`." Both halves of that rationale were wrong: `SystemConfigRepository.getByKey()` already existed in `lib/repositories/index.ts`, and "matches an existing service" is not a recognized exception to rule #1. The user caught this on code review, which triggered a 3-deliverable revision pass (BA descope of the unrelated feature flag, design doc update, Dev refactor to use the repository) before QA could start. Cost: roughly one full session of rework that would not have been needed had SA enumerated `lib/repositories/index.ts` during the review instead of inferring absence.
- **Dev's first dry-run implementation didn't match the BA spec.** The integration test script's `--dry-run` flag was originally implemented as "no side effects, including no LLM call" — overly cautious. The BA spec was explicit: dry-run "runs the estimator and prints the result but does NOT write." The user ran the dry-run, saw a placeholder `"would_have_called": "estimateEffort(input)"` instead of the actual estimate, and (correctly) complained. The fix required adding a `skipPersist` option to the production `estimateEffort` function — a real production surface change that should have landed first time around.
- **Script invocation shape went through three iterations before settling.** The runner was first written with an inline `dotenv.config(...)` call that was hoisted *after* the `@/lib/supabaseServer` import — broken, since `supabaseServer` is constructed eagerly at module load. Fix #1 used `npx tsx --import ./scripts/env-preload.ts ...`, which worked but the user kept forgetting the `--import` flag and hitting the same `Error: supabaseUrl is required.` crash. Fix #2 was a co-located `_load-env.ts` bootstrap file imported as the very first side-effect, so plain `npx tsx tests/effort-estimator/scripts/run-on-agent.ts ...` finally worked. Each iteration was a separate session round-trip.
- **Feature flag was added per BA convention but never user-requested.** `NEXT_PUBLIC_USE_EFFORT_ESTIMATOR` was added by BA on the basis that V6 features in this codebase typically ship behind a flag. The user reviewed the code, noted the flag had never been part of the conversation, and asked for it to be removed. Whole scaffolding had to be ripped out: the helper, the env-var, the `getFeatureFlags()` entry, the dispatch-time gate, two test cases, and the docblock references in the API route. About an hour of cleanup for a 30-line addition.
- **AC numbering drifted across the descope and lingered in multiple places.** When the feature-flag AC was removed on 2026-06-10, AC-7 (flag-off behavior) disappeared and AC-8 (model fallback) was renumbered to AC-7. The renumbering caught the requirement MD on the same day but left stale "AC-8" labels in the workplan's acceptance-criteria table, the `modelResolver.ts` module docblock, the `DEFAULT_MODEL` JSDoc, the inline comment, and the `EffortEstimator.ts` module docblock — five surfaces that QA flagged the next day as a separate cleanup pass.

---

## Surprises / discoveries

- **`UserProfileRepository` had been a phantom import the whole time.** `lib/user-context/builders.ts` had `import { UserProfileRepository } from '@/lib/repositories';` and then `new UserProfileRepository().findById(...)`. The class was never implemented, the barrel never exported it, and production never noticed because every production caller of the `user-context` module uses the fast path `buildUserContextFromAuth(user)` instead of the full profile path. The Effort Estimator's integration script was the first runtime caller of `buildUserContextFromProfile`, and it crashed immediately. Latent for an unknown duration; surfaced only because a new tool exercised the slow path.
- **`pino.multistream` would have double-recorded every log line.** Dev's first take on the per-run log file used `pino.multistream([stdout, fileStream])` for the script's own logger. On read, this would have written each script-level log line twice — once via multistream's direct file write, and once via the stdout-tee that was added to capture the estimator's *child* logger output. Dev caught this on read and pivoted to a single stdout-tee that handles both uniformly.
- **SA explicitly defended a wrong pattern as "matches existing service."** When `AgentGenerationConfigService.ts` was cited as precedent for direct Supabase use in `modelResolver`, SA approved by reference rather than by checking the repository index. The lesson: code-review precedent-citations need to verify the precedent against the current state of the repository index, not against the reviewer's mental model.
- **The Vercel serverless suspension caveat for fire-and-forget IIFEs is a real operational concern.** SA's code-review flagged that the 30-second retry budget sits at the edge of Vercel's default 60-second function timeout, and the estimator's INFO override log lands *after* the API response has already been returned. Not a bug, but a behavior that QA needs to validate on a preview deploy and that may require `waitUntil` semantics in a future iteration.

---

## Patterns to remember

- **When BA adds something "per project convention" that the user didn't request, surface it to the user during requirement review rather than baking it in silently.** The feature-flag rip-out cost real time and was preventable with a single sentence in the BA review handoff.
- **When SA cites "no repo exists" or "pattern matches X service" as a justification for a rule exception, the first verification step is to enumerate `lib/repositories/index.ts`.** SA's self-correction note in this cycle captures the fix discipline; it should become a standing pre-flight check for any code review involving DB access.
- **Integration test scripts that run live (real LLM, real DB) catch latent bugs that mocked tests miss.** The unit tests for `EffortEstimator` were all green; only the live script surfaced the `UserProfileRepository` phantom. New cycles touching new module boundaries should consider a live runner as part of the deliverable, not as a post-hoc nice-to-have.
- **Dry-run flags should match BA spec exactly.** Interpreting them more conservatively than spec'd produces a tool nobody can actually use to see what the production tool would do.
- **For multi-session cycles, the SESSION PAUSE STATE pattern at the top of the workplan + an auto-memory entry + a resume prompt is sufficient redundancy.** None of those three artifacts is individually sufficient, but the combination survived a 2-day pause with branch confusion and zero context loss.

---

## Open follow-ups

These four items were deliberately deferred during the cycle and remain open per `docs/requirements/EFFORT_ESTIMATOR_REQUIREMENT.md` § Open Follow-Ups:

- **#1** — Decide whether to delete or keep the deprecated `updateAgentROI` writer after one release window. (post-release, owner: user)
- **#8** — `AgentRepository.mergeAgentConfig` RPC for atomic JSONB merge — fixes the create-then-quick-edit race window currently accepted as a v1 limitation.
- **#9** — Persist V6 `enhanced_prompt` to `agents.enhanced_prompt` so the estimator's re-trigger paths have higher-quality input than the raw `user_prompt` fallback.
- **#10** — Automatic regeneration trigger on prompt edit — the v2 PUT-handler dispatch that was descoped on 2026-06-10. The dispatcher SSoT helper is already in place for the future caller.

---

## Stats

| Metric | Value |
|---|---|
| Cycle days | 9 |
| User-driven revision rounds | 8 |
| Files changed | 32 |
| Lines added | ~6,200 |
| Unit/integration tests | 49 |
| Commits on feature branch | 7 |
| SA review passes | 3 (workplan, code, code re-review) |
| Bugs surfaced (incl. latent) | 4 (modelResolver rule violation, dry-run semantics, latent UserProfileRepository, script env-load order) |
| Doc artifacts | 4 (requirement, design, workplan, retrospective) |

---

## Acknowledgements

This cycle's outcome was driven by every role on the team carrying its weight where it mattered: BA locked the scope and held the line through multiple revisions; SA caught two acceptance-criteria-breaking issues in the workplan-review pass that would have been expensive to find in QA; Dev shipped a tighter implementation than the workplan implied (the `attempts === 0 | 3` discriminator and the JSDoc-not-prompt-string deprecation comment are both real improvements that weren't in the spec); QA's coverage table mapped every AC to a concrete test and flagged the AC numbering drift before it could ship; and RM handled the pause-and-resume branch state without losing any of the in-flight work. The user's willingness to keep digging at the integration script — running it repeatedly, catching the modelResolver rule violation that SA missed, complaining about the dry-run placeholder until it surfaced the real estimate — is what produced a tool that actually does what the BA spec described instead of a tool that merely passes its own tests.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-06-11 | Initial retrospective | Written by TL after cycle merged to main (commit `16069d1`). Captures shipping summary, lessons, and 4 open follow-ups. |
