# Retrospective: Plan payments P-8a.1, the MRR rule and the Subscriptions page

> **Last Updated**: 2026-10-18

## Overview

P-8a.1 adds one pure MRR rule and the admin Subscriptions page at `/admin/subscriptions`. The page reads through a new read-only repository. `past_due` subscriptions count toward MRR and are shown separately (BQ-P8a-4, the user's decision). The MRR rule is written so that Finance 5b can reuse it as is, so the platform has one MRR rule, not two.

**MD links:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md) | [BUSINESS_OS_PLAN_PAYMENTS_P8A_WORKPLAN.md](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8A_WORKPLAN.md)

**Branch:** `feature/bos-plan-payments-p8a`, worktree `neuronforge-finance-health`

---

## What went well

- **Only one business question reached the user.** SA-WP-P8a approved with conditions R1 to R5. Every technical fork was ruled by SA. Only BQ-P8a-4 went to the user, and the answer was that `past_due` counts and is shown separately.
- **The existing guards shaped the design.** The Finance guards required a new read-only repository and its own `/admin/subscriptions` route, instead of adding reads to existing finance files. SA approved D-1, D-2 and D-6.
- **There is one MRR rule.** It is a pure function that Finance 5b will reuse, so the two pages cannot disagree.
- **Code review and QA were clean.** SA-CR-P8a.1 approved the code with no conditions, and QA passed with no bugs.

## What did not go well

- Number of Dev ↔ SA back-and-forths: 1. The workplan was approved with conditions (R1 to R5); the code review passed first time.
- Number of Dev ↔ QA bug fix cycles: 0.
- Any blocked handshake and why: none.
- **The guard constraints surfaced only during the build** (D-1, D-2, D-6), not in the workplan.

## Conclusions & process improvements

- **Read the Finance source guards before a workplan places new reads.** They decide where a repository and route must live.
- **Open before live Stripe keys: Finance R4.** R-c′ errors when an account has both test and live rows. This must be fixed before any live key is used.
- **Next:** P-8a.2 (the drawer's billing panel), then P-8a.3 (audit).

### Status: APPROVED FOR COMMIT — feature/bos-plan-payments-p8a — commit pending (RM)

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-18 | Created (TL) | P-8a.1 retrospective after SA-WP-P8a (R1 to R5; BQ-P8a-4 to the user), D-1, D-2 and D-6 approved, SA-CR-P8a.1 approved with no conditions and a QA pass with no bugs; Finance R4 open before live keys |

TL approval: APPROVED for RM (commit, PR, auto-merge)
