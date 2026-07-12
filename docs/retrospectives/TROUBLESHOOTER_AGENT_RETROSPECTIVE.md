# Retrospective: Troubleshooter (TS) Agent

> **Last Updated**: 2026-07-05

**MD links:** [BA Requirement](/docs/requirements/TROUBLESHOOTER_AGENT_REQUIREMENT.md) | [Dev Workplan](/docs/workplans/TROUBLESHOOTER_AGENT_WORKPLAN.md)

## What went well

- **All 5 open questions resolved with the user up front, before any build began.** BA closed every ambiguity in the requirement (22 FRs, 12 ACs) before Dev started, so the workplan and implementation had an unambiguous spec. This "resolve all open questions before build" practice is the single biggest reason the cycle ran clean with zero rework loops.
- Meta-feature scoped tightly: 3 files (1 new agent definition + 2 edits), zero runtime code, no cross-cutting concerns.
- SA workplan review added value before implementation: 2 inline conditions (team-leader.md must use `Write` not `Edit` for its documentation tool claim; runtime path (d) execution-ID→agent resolution) + 1 refinement (template the TS agent def off the existing SA/QA files). Dev folded all three in during implementation without needing a re-plan loop.
- SA code review approved for QA on first pass with only 2 low-priority non-blocking notes (path (c) symmetric resolution gap; RM commit-hygiene reminder).
- QA passed all 12 ACs on the first pass with zero bugs.
- **Branch-deviation decision was made explicitly and with user approval.** Rather than cut a `feature/` branch, the cycle stayed on the existing `agent-failure-troubleshooting` branch because the working tree holds unrelated in-progress work. Making this an explicit, user-approved deviation (rather than a silent one) kept the trail clean and set up the tight commit-scope discipline below.
- TS role boundary is clean by design: strictly diagnostic (recommends, never fixes, never triggers downstream agents), with the routing decision handed back to TL — no overlap with the standard build cycle.

## What did not go well

- Number of Dev to SA back-and-forths: 0 re-plan loops. The 2 SA workplan conditions were folded into the first implementation pass, plus 1 follow-up one-clause fix from code review (path (c): calibration session ID → agent_id via `calibration_sessions`). No rework iteration was needed.
- Number of Dev to QA bug fix cycles: 0 (QA passed first pass, no bugs).
- Any blocked handshake and why: None.
- Commit-hygiene risk (non-blocking, flagged by SA): the working tree contains substantial unrelated pre-existing changes. RM must stage ONLY the 5 TS-cycle files and must not sweep in the unrelated in-progress work. Captured explicitly in the commit-scope section below so this cannot be missed at commit time.

## Conclusions & process improvements

- **"Resolve all open questions up front" is now a demonstrated best practice, not just an aspiration.** Three consecutive clean cycles (Gmail `modify_email`, R1, TS) confirm that closing every requirement ambiguity with the user before build eliminates Dev/SA/QA rework. Continue making this an explicit BA gate.
- **Explicit, user-approved branch deviations are healthy.** Staying on `agent-failure-troubleshooting` was the right call given the dirty working tree, and recording it as a deliberate deviation (not an accident) is the pattern to repeat whenever the standard `feature/` convention doesn't fit the working-tree reality.
- **Tight commit scope must be enforced at RM time.** When a cycle lands on a shared/dirty branch, the retrospective must spell out the exact file allowlist for RM. Done here — see Status/commit-scope note.
- Meta-features (agent-team/process changes with zero runtime code) still warrant the full cycle including QA against acceptance criteria. The full-cycle discipline caught the `Write`-vs-`Edit` tool-claim condition and the path (c)/(d) resolution gaps that a lighter review would have missed.

### Status: COMMITTED (feature) — agent-failure-troubleshooting — 17b1471

- The 5 TS feature files were committed in `17b14719fac62c2beda6d84d6e1de21e4a74c8fc` (short `17b1471`) on branch `agent-failure-troubleshooting`.
- **This cycle intentionally did NOT merge to `main`**, per the user's explicit decision — feature-branch commit only, no merge, no push.
- **Committed files (5):**
  - `.claude/agents/troubleshooter.md` (new)
  - `CLAUDE.md` (Agent Team table row)
  - `.claude/agents/team-leader.md` (TS routing)
  - `docs/requirements/TROUBLESHOOTER_AGENT_REQUIREMENT.md`
  - `docs/workplans/TROUBLESHOOTER_AGENT_WORKPLAN.md`
