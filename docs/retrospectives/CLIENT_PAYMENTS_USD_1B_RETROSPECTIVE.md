# Retrospective: Client payments in USD, slice 1b (the UI)

> **Last Updated**: 2026-10-27

**Branch:** `feature/client-payments-usd-1b`, worktree `neuronforge-cpu1b` | **Workplan:** [CLIENT_PAYMENTS_USD_1B_WORKPLAN.md](/docs/workplans/CLIENT_PAYMENTS_USD_1B_WORKPLAN.md)

This is the last slice of the client-payments USD stream. Slice 0 merged as #526 and slice 1a as #527.

## Overview

Slice 1b adds the UI for the "≈ $" figure in Finance's Client payments block:
- the "Client payments processed" headline, with the note "Our customers' revenue, not ours" and a Lagging pill;
- the states "At least", "Not converted", "None" and Unknown;
- a stale-rate chip, which is not a link, with the Exchange rates link beside it;
- the counts line;
- the "Converted to $" table, with a ≈ Total row;
- an optional `note` on `BlockKpi`;
- a new sentence on the Exchange rates tab: "…They convert one admin figure only: the approximate-dollar total of client payments on Finance."

When `takings.usd` is absent, the block is byte-identical to today's.

## What went well

- **Both SA reviews approved.** SA-WP-CPU1B approved with B-1 to B-5. B-4 was superseded: at the user's request, CPU1A-FU-1 moved to the follow-ups bundle and 1b reverted it, so the leak guard is byte-identical. SA-CR-CPU1B approved the code, accepting IN-1 to IN-7. These include date and time through `formatUtc`, and render tests at block level.
- **No pin moved:** the `BlockKpi` hash, Pins A to D, AC-145, AC-173, the `financePage` render test, the exchange-rates tab test and the leak guard.
- **QA passed, and both of its Low findings were fixed before commit.**

## What did not go well

- Dev ↔ SA back-and-forths: 0 at code review. Dev ↔ QA bug fix cycles: 1, for two Low findings:
  - B-1: a total under $1 showed "≈ $0". It now shows cents ("≈ $0.30", "At least ≈ $0.30"). A total of exactly $0.00 shows "≈ $0.00", not "None", because payments existed (Dev's call).
  - L-1: "Not usable" rows printed junk rate text. They now show "—".
- Blocked handshakes: none.
- **Observation:** the `exchangeRatesTab` render test is load-flaky. It took 54 s under machine load, and passes alone 20 times out of 20.

## Conclusions & process improvements

- **Rounding to whole dollars needs a small-value rule.** Otherwise a real but tiny total reads as "no money".
- **Owed by the user:** AC-21, the manual browser check of the block. QA's steps are in the workplan.
- **The client-payments USD stream is complete once this merges.** CPU1A-FU-1 stays in the follow-ups bundle.

### Status: APPROVED FOR COMMIT — feature/client-payments-usd-1b — commit pending (RM)

TL approval: APPROVED for RM (commit, PR, auto-merge)
