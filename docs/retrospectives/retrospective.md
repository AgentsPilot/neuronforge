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

### Conclusions & process improvements
- **Branch ownership going forward:** For R2 and R3, TL must invoke RM first to create the feature branch *before* Dev is invoked. This aligns with the updated team-leader handshake table and prevents the R1 branch-creation ambiguity from recurring.
- **Live-environment verification policy:** Discuss before R2 kickoff whether QA's "live environment verification" steps (browser smoke for UI flow, DB integration test for coercion, logger-spy for versioning) should be promoted to first-class acceptance criteria or remain deferred to manual QA. Recommend deciding the policy once and applying consistently across R2/R3.
- **Follow-up tracking:** Two explicit non-R1 follow-ups recorded so they are not lost:
  - `chore/reinit-next-lint` -- initialise `next lint` config so ESLint runs in CI
  - Documentation PR -- sweep V4/V5 architecture docs for stale Phase 4 references
- **Workplan-quality reinforcement:** The Gmail `modify_email` cycle (0 rework) and R1 (0 rework after SA workplan review) both confirm that investing in a thorough workplan up front consistently eliminates Dev/SA back-and-forth during implementation. Continue this pattern.

### Status: PENDING USER APPROVAL -- COMMITTED -- feature/v2-agent-creation-r1-phase4-cleanup -- [hash pending]
