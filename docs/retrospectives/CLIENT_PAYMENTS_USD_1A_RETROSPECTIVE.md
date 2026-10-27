# Retrospective: Client payments in USD, slice 1a (server side)

> **Last Updated**: 2026-10-27

**Branch:** `feature/client-payments-usd-1a`, worktree `neuronforge-cpu1a` | **Workplan:** [CLIENT_PAYMENTS_USD_1A_WORKPLAN.md](/docs/workplans/CLIENT_PAYMENTS_USD_1A_WORKPLAN.md)

## Overview

Slice 1a is the server side of the "≈ $" figure in the Client payments block. It adds:
- a pure BigInt converter, `lib/admin/exchangeRates/clientPaymentsUsd.ts`;
- the wiring for the rates read, `clientPaymentRates.ts`;
- `takings.usd`, merged in the finance route the same way MRR is;
- a new source guard with positive pins and a leak scan.

CUR-3 is not loosened.

**The user's decisions (2026-10-26, EX-1 to EX-6).** The figure goes in the Client payments block and uses the current rate from the Exchange rates page. Refunded payments count, and amounts are before fees. A stale rate is still converted, and the figure is flagged. This is the user's explicit, narrow exception to "never sum money across currencies".

## What went well

- **The reviews ran in order, with conditions met.** SA-RR-CPU approved with CPU-1 to CPU-8, SA-WP-CPU1A with W-1 to W-5, and SA-CR-CPU1A approved the code. AC-48 (8 → 9) and AC-66 were ruled re-freezes, and the `takingsUsd` log key was accepted.
- **The conversion is proven exact.** It was checked against an independent BigInt calculation across 4 currencies, rounding edges, very large totals and 400 random windows.
- **The pins moved only as ruled.** AC-145 went `333407…2215` → `aebc22cb…97ca`, and removing `takings.usd` restores it. AC-173, Pins A to D and `BlockKpi` are unchanged.
- **Secrets stayed out of the worktree.** It has no `.env.local`, so CI's Build check serves as the W-5 build proof.

## What did not go well

- Dev ↔ SA back-and-forths: 0 at code review. Dev ↔ QA bug fix cycles: 1. QA's first pass failed on B-1 (Medium, test-only): the leak guard missed five common access forms. It was fixed by treating `FinancePayload` like `FinanceTakingsSection`, adding bracket access and nested or aliased destructuring, and planting 119 controls. The re-test passed.
- Blocked handshakes: the merge waits on slice 0, by design.
- **Follow-up CPU1A-FU-1 (Low):** a typed destructure in a `function` declaration's parameters still slips past the guard. Add one pattern and a control in 1b.

## Conclusions & process improvements

- **Test a leak guard against realistic access forms,** not only the form its author wrote.
- **A worktree without env files cannot finish `next build`.** Plan for CI to be the build proof.
- **Merge gate:** 1a must not merge before slice 0 (the docs and the CLAUDE.md exception) is approved by the user and merged. Auto-merge stays off until then.

### Status: COMMITTED — feature/client-payments-usd-1a — commit `73d5b4a3`, 1a: PR #527; merge gated on slice 0 (#526), auto-merge held off

TL approval: APPROVED for RM (commit, PR, auto-merge) — but RM must wait until the user approves slice 0's CLAUDE.md change
