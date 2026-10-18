# Retrospective: Finance R4, billing status read in the current Stripe mode only

> **Last Updated**: 2026-10-18

## Overview

R4 fixes the open item that blocked live Stripe keys: R-c′ errored when an account had both test and live billing rows. Under BD-37 (the user, 2026-10-18), billing **status** now reads the current Stripe mode only, and **revenue** still counts both modes, as before (BD-14 / BD-20). The new adapter lives in `lib/admin/billing`. There is no migration, and every frozen pin is unchanged.

**MD links:** [BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_FINANCE_HEALTH_REQUIREMENT.md)

**Branch:** `fix/bos-finance-r4-billing-mode`, worktree `neuronforge-finance-m8`

---

## What went well

- **The user decided the business rule, in business terms (BD-37).** SA and Dev only implemented it.
- **The placement guard caught a real violation, and the fix needed no exception.** The adapter moved unchanged to `lib/admin/billing`, and the allow-list was not touched.
- **After the fix, SA approved the code and QA passed with no bugs.** SA's other two items were recorded: C2 (BD-37 written into the requirement) and C3 (R4-FU-1 listed).

## What did not go well

- Number of Dev ↔ SA back-and-forths: 1. SA-R4 came back Fix Required with one High finding, R4-C1: the adapter was placed in `lib/business-os/billing`, which broke the billing placement guard.
- Number of Dev ↔ QA bug fix cycles: 0.
- Any blocked handshake and why: none.
- **The workplan said "no guard change" without running the full suite.** The guard that failed was outside the suites Dev ran.
- **140 `npm test` failures on the local Windows machine predate R4.** Their causes are path separators, a pilot mock mismatch, orchestration and agentkit. None touch R4, and CI on Linux is authoritative. Even so, they make a local full run noisy.

## Conclusions & process improvements

- **Run the full `npm test`, or the CI gate set, before claiming that guards are unaffected.** Compare it against a baseline run on main so that the known Windows failures can be told apart.
- **Follow-up R4-FU-1:** remove the reads that are no longer wired.
- **Live Stripe keys are no longer blocked by R4.**
- **Next:** Finance 5b (MRR, importing `lib/business-os/billing/planMrr.ts`), then FF-2.

### Status: APPROVED FOR COMMIT — fix/bos-finance-r4-billing-mode — commit pending (RM)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-18 | Created (TL) | R4 retrospective after SA-R4 Fix Required (R4-C1, guard placement) then Code Approved, and a QA pass with no bugs; BD-37; no migration, pins unchanged |

TL approval: APPROVED for RM (commit, PR, auto-merge)
