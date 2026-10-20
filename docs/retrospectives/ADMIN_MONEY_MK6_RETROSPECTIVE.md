# Retrospective: MK-6, payment problems where they belong (UI short path)

> **Last Updated**: 2026-10-20

**Branch:** `feature/admin-money-mk6-payment-problems`, worktree `neuronforge-finance-m8`

## Overview

The separate Payment problems section is removed. Boost problems now sit in Revenue, and client problems sit in Client payments, which keeps its "not ours" label. Both blocks render byte-identical; only their place on the page changed. The K-5 red tile now opens Revenue, and no stale links remain. The Exchange rates tab (#486) was not touched.

## What went well

- **The move was proven to change only position.** Both blocks are byte-identical, and no pin moved.
- **SA-CR-MK6 approved the code with no conditions, and QA passed with no bugs.**

## What did not go well

- Dev ↔ SA back-and-forths: 0. Dev ↔ QA bug fix cycles: 0. Blocked handshakes: none.
- **`upgradeModal.guard` fails locally on main as well.** The cause is Windows line endings in the upgrade modal (UM) stream. It is not caused by MK-6; it belongs to that stream.

## Conclusions & process improvements

- **When moving a block, prove it is byte-identical and re-point every link to it in the same slice.**

### Status: COMMITTED — feature/admin-money-mk6-payment-problems — commit `4ee3b61d`, main merged `559a6745`, PR #489 (auto-merge on)

TL approval: APPROVED for RM (commit, PR, auto-merge)
