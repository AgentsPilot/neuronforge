# Retrospectives

## Gmail `modify_email` Action -- 2026-03-29

**MD links:** [BA Requirement](/docs/requirements/gmail-modify-email-action-2026-03-29.md) | [Dev Workplan](/docs/workplans/gmail-modify-email-action-workplan.md)

### What went well
- Requirement was thorough and included exact API endpoint, schema, and test scenarios -- no clarifying questions needed from BA
- The existing `list_labels` method on the executor validated the label-fetching pattern before implementation
- The `gmail.modify` scope was already present in the plugin's OAuth config, so no auth changes were needed
- Implementation was clean: 4 files changed, all scoped to the plugin boundary with no cross-cutting concerns
- Pre-existing documentation gap (missing `get_email_attachment` from plugin docs) was fixed as part of this work

### What did not go well
- Number of Dev to SA back-and-forths: 0
- Number of Dev to QA bug fix cycles: 0
- Any blocked handshake and why: None

### Conclusions & process improvements
- Well-defined requirements with exact API references and acceptance criteria eliminate BA/Dev back-and-forth entirely
- Naming the helper `resolveLabelNames` + `createLabel` instead of the single `getOrCreateLabel` from the requirement was a better design -- batching the label list fetch for all custom labels in one call rather than per-label
- Consider adding the `get_email_attachment` action to plugin docs at the time it is implemented, not retroactively

### Status: PENDING USER APPROVAL

---

## R1 -- V2 Agent Creation Phase 4 Cleanup -- 2026-05-24

**MD links:** [BA Requirement](/docs/requirements/V2_AGENT_CREATION_R1_PHASE4_CLEANUP_REQUIREMENT.md) | [Dev Workplan](/docs/workplans/v2-agent-creation-r1-phase4-cleanup-workplan.md)

### What went well
- Single Dev implementation pass with zero rework -- workplan was sufficiently detailed to enable a clean one-shot build
- SA workplan review caught two latent blockers before implementation began: the implicit init-thread route flip and a `phase4-schema.ts` consumer that would have broken the rename. This saved a Dev rework cycle.
- Option C (rename instead of delete) was a proportional design choice that prevented R1 scope from expanding into consumer-side refactors
- Test-suite movement was net positive: -2 failures / +2 passes vs the pre-R1 baseline, and 6/6 new repository tests pass on first run
- `tsc --noEmit` clean for all R1-touched files
- BA requirement captured the full Q&A trail (Q1-Q4 plus the versioning + branching FRs added later), which gave Dev and SA an unambiguous specification
- Per-FR verification by SA in code review -- all 13 acceptance criteria PASS
- Merge to `main` completed cleanly with `--no-ff` per FR17 -- zero conflicts; v4/v5 generator files auto-merged with incoming main calibration changes
- Post-merge `tsc --noEmit` confirmed clean for R1 (only the 20 pre-existing archive-file errors remain)

### What did not go well
- Number of Dev to SA back-and-forths: 0 (workplan approved with minor revisions, no implementation rework needed; code review approved on first pass)
- Number of Dev to QA bug fix cycles: 0
- Any blocked handshake and why: None
- Branch creation policy was ambiguous at cycle start -- Dev created the branch under the old policy. Now resolved going forward (RM owns branch creation per the updated `team-leader.md` / `release-manager.md` / `developer.md` definitions); R1 is the one-time transition cycle.
- `next lint` is uninitialised in the repo -- pre-existing project state, surfaced during R1 but deferred to a separate `chore/reinit-next-lint` follow-up
- QA flagged 3 non-blocking caveats indicating coverage gaps that could become first-class acceptance criteria:
  1. Versioning log assertion verified at mock layer only -- no logger-spy assertion in integration tests
  2. Stepper rendering verified by source grep only -- no browser smoke test
  3. Legacy phase4 coercion verified at the mock layer only -- no end-to-end DB integration test
- V4/V5 architecture doc stragglers (mentions of removed/renamed Phase 4 modules in older design docs) were noted by SA and deferred to a follow-up documentation PR
- **Rebase-before-merge policy ambiguity surfaced at merge time:** SA's workplan-review note recommended rebase-before-merge as a default. During the actual merge, the user correctly pointed out that FR17's `--no-ff` produces a merge commit anyway, so rebasing first does not materially improve the history. The rebase step was therefore skipped in favour of a direct `--no-ff` merge. Process change captured under Conclusions below so this isn't relitigated at R2/R3 merge time.

### Conclusions & process improvements
- **Branch ownership going forward:** For R2 and R3, TL must invoke RM first to create the feature branch *before* Dev is invoked. This aligns with the updated team-leader handshake table and prevents the R1 branch-creation ambiguity from recurring.
- **Merge strategy going forward:** For R2 and R3, SA and TL should default to a direct `--no-ff` merge (no preceding rebase) unless there is a specific conflict-resolution reason that makes a rebase materially better than letting `--no-ff` produce the merge commit. Captured here so the R1 merge-time conversation does not repeat.
- **Live-environment verification policy:** Discuss before R2 kickoff whether QA's "live environment verification" steps (browser smoke for UI flow, DB integration test for coercion, logger-spy for versioning) should be promoted to first-class acceptance criteria or remain deferred to manual QA. Recommend deciding the policy once and applying consistently across R2/R3.
- **Follow-up tracking:** Two explicit non-R1 follow-ups recorded so they are not lost:
  - `chore/reinit-next-lint` -- initialise `next lint` config so ESLint runs in CI
  - Documentation PR -- sweep V4/V5 architecture docs for stale Phase 4 references
- **Workplan-quality reinforcement:** The Gmail `modify_email` cycle (0 rework) and R1 (0 rework after SA workplan review) both confirm that investing in a thorough workplan up front consistently eliminates Dev/SA back-and-forth during implementation. Continue this pattern.

**Status:** COMMITTED -- `feature/v2-agent-creation-r1-phase4-cleanup` -- merge commit `ed79428` on `main` -- feature commits `b18f939` + `0f4c04f` + `568d288` -- merged 2026-05-24

---

## R2 -- V2 Agent Creation Tone Down Enhanced-Prompt System Prompt (prompt v16) -- 2026-05-24

**MD links:** [BA Requirement](/docs/requirements/V2_AGENT_CREATION_R2_PROMPT_TONE_DOWN_REQUIREMENT.md) | [Dev Workplan](/docs/workplans/v2-agent-creation-r2-prompt-tone-down-workplan.md)

### What went well
- **First cycle under the new RM-creates-branch policy ran cleanly.** RM created `feature/v2-agent-creation-r2-prompt-tone-down` from latest `origin/main` (`a5a7971`) before Dev was invoked. Zero confusion, ~30-second hand-off, instant TL -> RM -> Dev sequence. The R1 transition lesson is now bedded in.
- **Single Dev implementation pass.** No SA-driven rework during code review, and only one trivial QA-driven 1-line fix (a pre-documented fallback that needed execution). Workplan quality continues to predict zero-rework cycles.
- **SA independently verified the test-drift narrative.** SA stashed R2, reran Jest on bare branch state, and got byte-identical 21/128/1088 counts -- cleanly separating "+30 environmental flake from TokenBudgetManager 5000ms timeouts" from "R2 regression". This avoided an unjust witch-hunt on the failure delta and is a pattern worth repeating any time a cycle's test counts move.
- **SA verified Dev's re-mapping of stale BA line numbers at workplan-review time** (224/241/264/317 vs BA's 249-258/289-295/266). High-leverage check caught a real risk before implementation began.
- **`--no-ff` direct merge plan locked in from cycle start** (R1 retrospective lesson applied with zero relitigation).
- **v15 untouched on this branch and in main** -- R2's baseline is preserved as a rollback point. v16 lands at 670 lines (within the BA-specified 615-751 band).
- Pino telemetry block added with correctly typed `Record<string, boolean>` for `carveOutFired` (per SA's workplan-review revision).
- Per-FR verification by SA -- 12/12 FRs PASS (FR11 with one minor caveat: TRIGGER/RESOURCE share a Priority Cap reminder rather than independent pins, accepted by SA).

### What did not go well
- Number of Dev to SA back-and-forths: 0 (workplan approved with 4 minor revisions, no implementation rework; code review APPROVED FOR QA on first pass)
- Number of Dev to QA bug fix cycles: 1 (Step 6 fallback -- 4 empty `{_skip: true}` sibling JSON files for the new regression scenario)
- Any blocked handshake and why: None
- **BA requirement MD quoted stale prompt line numbers** (249-258, 289-295, 266) that did not match v15's actual layout (224, 241, 264, 317). Dev had to re-map at workplan time; SA had to verify the re-mapping at workplan-review time. Two agents' time spent on a recoverable BA freshness issue.
- **Dev pre-documented the Step 6 fallback (sibling files) but didn't execute it at implementation time.** QA caught it via harness load failure. Trivially fixed but should not have surfaced post-implementation.
- **Regression harness has no `scope: "phase-2-only"` honoring AND no downstream `_skip`-aware branch.** R2's lean scenario now fails at FAIL@Compile instead of the original FAIL@Load -- different failure mode, not an R2 bug, but the harness limitation means R2's scenario can't actually validate green until the harness is extended. User accepted as known follow-up.

### Conclusions & process improvements
- **BA requirement MDs that reference prompt-file content must use section-heading references over hard-coded line numbers** -- or, if line numbers are kept, BA must pull them from the actual current prompt file at requirement-write time. The R2 BA artefact's stale line numbers cost Dev + SA cycles that were entirely avoidable.
- **Pre-documented fallbacks must be executed proactively by Dev, OR explicitly flagged in the workplan as "deferred to QA validation"** -- never left as silent conditionals. The Step 6 fallback was a known known; it should have shipped with the implementation.
- **Continue SA's independent test-drift verification pattern.** The "stash + rerun on bare branch" approach to confirm flake vs regression should be the SA default any time test counts move by more than a handful between cycles.
- **Reinforce R1's process decisions, now twice-validated:** (a) RM creates the branch at cycle kickoff, (b) `--no-ff` direct merge with no preceding rebase. Both ran clean in R2; carry forward unchanged into R3.

### Follow-ups
- **Regression harness `_skip` / `scope` awareness** (new -- surfaced by R2): the harness needs to honor `scope: "phase-2-only"` on scenario manifests and skip downstream Phase 3/4/compile stages when sibling files are marked `_skip: true`. R2's lean scenario is blocked from green until this lands. Separate workplan needed.
- **BA line-number reference process change** (new -- surfaced by R2): update BA agent guidance to reference prompt-file content by section heading, not by line number. One-line change to the BA agent definition.
- **`chore/reinit-next-lint`** (carried from R1): initialise `next lint` config so ESLint runs in CI.
- **V4/V5 architecture documentation sweep PR** (carried from R1): clean up stale Phase 4 module references in older V4/V5 design docs.

**Status:** PENDING USER APPROVAL -- `feature/v2-agent-creation-r2-prompt-tone-down` -- [hash pending]
