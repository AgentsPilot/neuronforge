# Automated Calibration-Failure RCA in the Admin Alert Email — Retrospective

> **Created**: 2026-07-05
> **Cycle type**: Production LLM feature (augments the IMP-2 admin failure-alert path)

**MD links:** [BA requirement](/docs/requirements/AUTOMATED_CALIBRATION_RCA_EMAIL_REQUIREMENT.md) | [Dev workplan](/docs/workplans/AUTOMATED_CALIBRATION_RCA_EMAIL_WORKPLAN.md)

## Overview

On a failed background calibration, an in-app RCA service now generates a structured
root-cause analysis, folds it into the existing admin failure-alert email (best-effort,
graceful fallback), and persists it. The feature reuses the `calibration-rca` methodology
and augments the existing IMP-2 alert path. Scope: ~24 FRs / 15 ACs, all approved.

---

## What went well

- **SA pre-code gate caught two binding conditions BEFORE any code was written.** The
  workplan review surfaced C1 (metadata-clobber on persistence) and C2 (budget-aware
  timeout) as binding conditions, plus 5 answered questions and an API correction. Both
  conditions were folded inline into the implementation, so they never became rework —
  this is the ideal outcome of the SA workplan-review handshake.
- **The user code review caught 4 real, shippable improvements** the automated flow had
  not: (1) a proper feature-flag accessor, (2) calibration docs + a flag on/off Mermaid
  diagram, (3) persisting RCA attempt-status including failures/skips while preserving the
  AC-9 flag-off no-write guarantee, and (4) a true `AbortController` hard-abort via a
  backward-compatible provider `signal`. Test count grew 85 → 96 as a result.
- **Extensive up-front requirement review paid off.** All open questions (two-dump evidence
  parity, DB-only log policy + correlationId, DB-config-with-defaults model resolution,
  metadata persistence, redaction guardrails, env feature flag, 5-value layer set) were
  resolved with the user before build, which is why the build loops stayed clean.
- **Zero defect churn.** QA passed on the first run and again on the re-run (96/96), all 15
  ACs verified (11 automated, 5 route-level by code-trace / code-trace verification).
- **Graceful degradation held throughout.** SA re-review confirmed the Q4 provider change
  was low blast-radius, introduced no serialization leak, and preserved the never-throw
  guarantee on the alert tail.

## What did not go well

- **Dev ↔ SA re-plan loops: 0** — both SA conditions were folded inline; no workplan
  rejection/re-plan cycle was needed.
- **Dev ↔ QA bug-fix cycles: 0** — QA passed both times with no bugs filed.
- **User-initiated improvement rounds: 1** — the 4-item code-review round after the
  automated flow had already passed QA. Not rework in the defect sense, but it did require
  a full SA re-review + QA re-run. A stronger self-review / accessibility-of-flag pass by
  Dev might have surfaced items (1) and (4) earlier.
- **5 of 15 ACs could only be verified by route-level code-trace**, not by an executing
  test, because the calibration tail is not yet independently unit-testable (see deferred
  follow-up #2). This is a known testability gap, not a defect.
- **No blocked handshakes.** The one process deviation (staying on
  `agent-failure-troubleshooting` rather than cutting a fresh branch) was explicitly
  user-approved because the working tree holds unrelated in-progress work.

## Conclusions & process improvements

- The SA pre-code workplan gate demonstrably prevents rework — C1/C2 would each have been
  a post-implementation fix cycle had they surfaced during code review instead. Keep
  treating binding conditions as fold-inline-before-code, not review comments.
- User code review remains a high-value net even after a clean QA pass; the 4 improvements
  were genuine. Consider adding a lightweight Dev self-review checklist item for
  "flag accessibility / provider-signal plumbing" so mechanical improvements surface before
  the user round.
- Route-level testability should be closed so ACs stop depending on code-trace verification
  (deferred follow-up #2).

### Deferred follow-ups (explicitly captured)

1. **`chore(logging)` ticket** — convert `lib/ai/providers/anthropicProvider.ts` (7
   `console.*`) + `lib/ai/providers/openaiProvider.ts` (4 `console.*`) to Pino. SA + QA
   recommended defer; user agreed. This is shared-infra log-level triage, not a mechanical
   reformat, so it is intentionally out of this commit scope.
2. **Medium fast-follow** — extract the calibration tail into
   `runCalibrationAdminAlertTail(deps)` so the 5 route-level paths become independently
   unit-testable (closes the code-trace-only AC gap above).
3. **Post-deploy live-harness verification** of the 5 route-level paths — AC-9 (flag-off
   no-write), AC-10 (dedup skip), AC-11 (never-throws), AC-13 (correlationId), and
   C2 budget-skip / Q4 abort. Not code-blocking; requires a real background calibration run.

### Status: COMMITTED — agent-failure-troubleshooting (no merge to main; commit hash in git log)
