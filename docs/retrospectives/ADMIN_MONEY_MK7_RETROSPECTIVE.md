# Retrospective: MK-7, history under its KPIs (Page 1 part)

> **Last Updated**: 2026-10-20

**Branch:** `feature/admin-money-mk7-history-under-kpis`, worktree `neuronforge-finance-m8`

## Overview

The History block is removed. The plan-mix trend now sits under Plan mix, and the credits trend sits under Credits. Both trends share one on-demand read, so the page still makes a single request on load. Both render byte-identical to the old block.

## What went well

- **There is still one request on load.** Tests confirm the two trends never fetch twice.
- **The trends' rendering did not change, and no pin moved.**
- **SA-CR-MK7 approved the code with no conditions, and QA passed with no bugs.**

## What did not go well

- Dev ↔ SA back-and-forths: 0. Dev ↔ QA bug fix cycles: 0. Blocked handshakes: none.
- **C-7 is deferred to MK-3.** Moving the recorded AI cost detail to the AI cost page was left out, because the user asked us to stop before Page 2.

## Conclusions & process improvements

- **When splitting one block into several, share its read** so the page's request count stays pinned.

### Status: COMMITTED — feature/admin-money-mk7-history-under-kpis — commit `af030efb`, main merged `340b4764`, PR #491 (auto-merge on)

TL approval: APPROVED for RM (commit, PR, auto-merge)
