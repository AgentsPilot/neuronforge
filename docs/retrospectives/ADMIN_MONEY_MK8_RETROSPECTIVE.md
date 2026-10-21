# Retrospective: MK-8, the Finance drawers

> **Last Updated**: 2026-10-21

**MD links:** [ADMIN_MONEY_MK8_FINANCE_DRAWERS_WORKPLAN.md](/docs/workplans/ADMIN_MONEY_MK8_FINANCE_DRAWERS_WORKPLAN.md) | **Branch:** `feature/admin-money-mk8-finance-drawers`, worktree `neuronforge-finance-m8`

## Overview

MK-8 adds two side drawers to the Finance page.
- **The Business drawer** opens from the Accounts and Subscriptions rows, and also from the AI cost top-10, Credits and Client payments rows. It shows the summary, the business's client payments in its own currency, overdue items and "Open full view". When opened from a subscription row, it also has the Plan billing panel, which stays closed until opened.
- **The Plan drawer** reads from a new read-only route, `GET /api/admin/business-os/billing/plans/[planId]`, built on the Subscriptions builder.

No payload key changed, no pin moved, and the page still makes one request on load. The AI cost and billing-period drawers are Page 2 and wait for the user's review.

## What went well

- **The drawers reuse existing pieces:** the Subscriptions builder, the P-8a billing panel and the existing summary.
- **The page contract held:** one request on load, the same payload and every pin unchanged.
- **QA's randomized probe found a real data-shape bug (CR-1),** and it is now a permanent test.
- **After the fixes, SA approved the code and QA passed.**

## What did not go well

- Dev ↔ SA back-and-forths: 1. SA-CR-MK8 was first Fix Required:
  - CR-1: an account appeared in two Plan drawers because of a stale `bought_tier`. It is fixed with one rule, "billed in this mode", and a 500-case randomized check now passes.
  - CR-2: the drawer openers were missing on the other blocks. They were added.
- Dev ↔ QA bug fix cycles: 0 after the fixes. Blocked handshakes: none.
- **Hand-picked fixtures did not cover a stale `bought_tier`.** Only the randomized probe exposed it.

## Conclusions & process improvements

- **Keep QA's probes as permanent tests,** especially randomized ones over data shapes.
- **Any "which group does this account belong to" view needs one membership rule,** shared by the list and the drawer.
- **When a drawer is added, list every row on the page that should open it** (CR-2).
- **Next:** MK-9, the last Page 1 slice.

### Status: APPROVED FOR COMMIT — feature/admin-money-mk8-finance-drawers — commit pending (RM)

TL approval: APPROVED for RM (commit, PR, auto-merge)
