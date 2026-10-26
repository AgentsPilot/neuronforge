# Retrospective: MK-3a, AI cost page (first half)

> **Last Updated**: 2026-10-26

**Branch:** `feature/admin-money-mk3-ai-cost-page`, worktree `neuronforge-finance-mk3` | **Workplan:** [ADMIN_MONEY_MK3_AI_COST_PAGE_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK3_AI_COST_PAGE_WORKPLAN.md)

## Overview

MK-3a is the first half of the AI cost page. It adds:
- `/admin/ai-cost`, with its legend and the A-K1 to A-K5 strip;
- C-7, which moves the recorded block onto AI cost;
- the Leak block KPI;
- `BlockKpi`, promoted to shared;
- `recordedReads.ts`, shared by both routes;
- redirects and the sidebar entry.

## What went well

- **The split was planned, not forced.** SA-WP-MK3 approved with 7 conditions, all met. The estimate was 4 to 4.5 days, so SA approved splitting the work into MK-3a and MK-3b, one PR each.
- **The figures agree across pages.** For This month, A-K1 equals F-K3 ($5.241), and the recorded figures equal Finance's. QA passed.
- **SA-CR-MK3A approved the code.** DV-4 was ruled correct: A-K3 is a difference, so it shows Unknown. DV-1, DV-2, DV-3, DV-5 and DV-6 were accepted.
- **The pins moved only as ruled.**
  - Pin A: `5f537869` → `4e2a93aa`.
  - Pin C file: `98ea0507` → `e57f2675`.
  - Unchanged: Pin C table (`64a565e9`), AC-145, AC-173, Pin B and Pin D.

## What did not go well

- Dev ↔ SA back-and-forths: 0 at code review. Dev ↔ QA bug fix cycles: 1. Three issues were fixed before commit, each with a test and no pin moved:
  - B-1: an incomplete run that found nothing showed "At least 0". It now shows "Unknown", with "Not every business was checked".
  - B-2: a failed run showed "Not run yet". It now shows "Could not check".
  - L-1: the price-review link pointed at an old address. It now goes direct, and the guard against old addresses was extended.
- Blocked handshakes: none.

## Conclusions & process improvements

- **A KPI box needs an explicit state for "incomplete and found nothing".** Otherwise "At least 0" reads as all clear.
- **Owed to MK-3b:**
  - lift the read out of `CostsTab`;
  - one page spec, plus T-12;
  - remove `leakCheckHref`;
  - add the "Summary & checks" tab label.
- **Follow-ups:**
  - MK3A-FU-1 (SA Low-2): the two-way type check misses an optional field. This is the existing pattern.
  - MK3A-FU-2 (SA Low-3): the sidebar still uses the old icon.

### Status: APPROVED FOR COMMIT — feature/admin-money-mk3-ai-cost-page — commit pending (RM)

TL approval: APPROVED for RM (commit, PR, auto-merge)
