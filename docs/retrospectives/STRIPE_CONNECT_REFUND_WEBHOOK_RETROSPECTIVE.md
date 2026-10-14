# Retrospective: Stripe Connect Refunds Reach the Books (refund webhook fix)

> **Last Updated**: 2026-10-14

## Overview

Retrospective for the `fix/stripe-connect-refund-webhook` cycle (2026-10-14). The cycle covered the RCA, the requirement, SA review, the workplan with its live-schema check, three slices, two rounds of code review and QA. The user approved the diff on 2026-10-14 ("approved, commit and open the PR"). RM commits next, so the commit hash and PR number are not known yet.

**MD links:** [RCA](/docs/investigations/STRIPE_CONNECT_CHARGE_REFUNDED_WEBHOOK_RCA.md) | [BA Requirement](/docs/requirements/STRIPE_CONNECT_REFUND_WEBHOOK_REQUIREMENT.md) | [Dev Workplan](/docs/workplans/STRIPE_CONNECT_REFUND_WEBHOOK_WORKPLAN.md)

---

## What the cycle fixed

A refund made outside the app was never recorded. That covered refunds made in the Stripe dashboard, refunds Stripe makes itself, agent-workflow refunds, and app refunds whose Stripe reply was lost. `handleChargeRefunded` looped over `charge.refunds.data`, a list Stripe stopped sending in 2022. It wrote nothing and still marked the event `completed`. The fix records refunds from `refund.created` / `refund.updated` / `refund.failed` instead. It ships as one PR with three commits:

1. The app's Stripe refund carries `refund_row_id` in its metadata.
2. User-scoped repository reads, an insert and a compare-and-set write, driven by an exhaustive 40-case status table.
3. A refund Stripe reports as still processing stays `pending`, and the caller gets `IN_FLIGHT`.

There is no migration.

**Why the defect survived its tests:** the hand-written `charge-refunded.json` fixture included a `refunds.data` array that Stripe no longer sends. The handler's tests passed against a payload that cannot occur.

---

## What went well

- **The RCA came before the requirement, and BA did not re-diagnose.** The requirement named the RCA as the source of truth, so the diagnosis was written down once.
- **The live-schema check (SA-8) was a gate before any code.** Most of the catalogue was checked read-only. The three items PostgREST cannot reach (U-1..U-3: CHECKs, the partial index, and the `refund_guard_before` SQLSTATE) were closed by the main session with read-only SQL against prod. All of it matched the migrations, so no code rested on an assumption.
- **SA overruled Dev's "flag-only" proposals where scope truly required it.** Slice 3 turned two rare paths into common ones: a `refund.failed` event on `IN_FLIGHT`, and a `refundGroup` cap that ignored a pending leg. SA pulled both into scope as one-condition changes (Q-SA-6 → C-3, Q-SA-7 → C-4) and did not let them ship as known regressions.
- **SA reviewed its own design in code review.** CR-1 was a hole in SA's own A-3 transition table. SA named it as its own and amended A-3, and did not ask Dev to work around it.
- **Code review round 2 checked only the delta.** SA confirmed exactly 2 of the 40 table entries moved, the snapshot file was byte-identical to round 1, and the three slice patches rebuild the tree blob for blob (23/23 files).
- **The commit plan was built and tested before RM touched anything.** Slices 2 and 3 rewrite the same lines, so `git add -p` could not separate them. Dev produced three incremental patches with a temporary index (the real index and `git stash` were never used). Each intermediate state was tested, and SA verified the patches twice in a throwaway worktree.
- **Snapshot movement was accounted for one entry at a time:** 99 identical, 0 changed, 4 removed, 8 added. Nobody ran a blind `-u`.
- **QA found no bugs.** It mapped every automatable acceptance criterion to a passing test. It added the one missing guard (C-3, an automation-block source guard that fails against `HEAD`). It separated unrelated failures (11 quarantined, 5 Windows-local) from this change.
- **Rules held without exceptions:** no new `⟨unscoped-by-design⟩` exemption, no `upsert`, no `.or()`+`.select()` on the update, 0 `console.*` in the touched source, and 5 pre-existing `tsc` errors fixed in a touched test file.

## What did not go well

- **Number of Dev ↔ SA back-and-forths: 1** on code (code review round 1 CHANGES REQUESTED for CR-1 High plus three Low items, then round 2 approved). The workplan was approved on the first pass with conditions C-1..C-9. The requirement also had one SA CHANGES REQUESTED round (A-1..A-12) on the BA side.
- **Number of Dev ↔ QA bug fix cycles: 0.** QA passed with notes.
- **Blocked handshakes:**
  - The requirement fold-in (A-1..A-12) could not be done by BA, which has no Edit tool. It went to a general-purpose agent. This is a known gap, not new, and it cost a hand-off.
  - SA-8 U-1..U-3 could not be reached through PostgREST and waited on the main session running read-only SQL.
- **The High finding came from the design, not the code.** CR-1: the app's catch path writes `failed` with no Stripe id (a lost reply), and Stripe later sends `refund.created(pending)`. A-3 made that a no-op but still filled the Stripe id. The later `succeeded` then saw `failed` + id, did nothing, and left refunded money reading `failed` and uncounted by the double-refund guard. That is the exact worst case A-4 was written to prevent. The 40-case table was exhaustive for single transitions and still missed it, because the defect needed two events in a row plus a side effect (the id fill) on a "no-op".
- **The caller audit was incomplete.** Slice 3 changed what `refund()` returns, and §5 listed six callers. SA found a seventh (`MutateExecutor.ts:688`, the chat refund) at code review (CR-2). Its behaviour was fine, but the list was assumed complete when it was not.
- **Incident: Dev ran `taskkill //F //IM git.exe`**, which kills every git process on the machine. Other sessions and worktrees share this machine (and a shared `node_modules` junction and stash stack), so this could have killed another session's git mid-write and left a stale `index.lock` or a half-written object. No stale locks were found afterwards, so no damage is known. It was still an unscoped destructive action taken without asking.
- **The original defect was invisible for about two years in production code.** The handler marked the event `completed` after writing zero rows. Nothing distinguished "processed" from "did nothing".

## Conclusions & process improvements

1. **A fixture is evidence only if it is a real payload.** A hand-written fixture asserts what the author believes the provider sends, so a green test against it proves nothing about production. New or rewritten provider fixtures must state their source: a captured event, or the current API reference and SDK types for the pinned API version, as A-9 / F5-c now require. A fixture field the provider no longer sends is a defect in the fixture. Recommended as a standing SA review item for any webhook or provider-integration change.
2. **Test state tables with sequences, not just cells.** Any status table with side effects on "no-op" cells (here, filling an id) needs multi-event characterisation cases for the recovery paths it was written to protect (lost reply → pending → succeeded). A proxy like "has a Stripe id" standing in for "Stripe has given a verdict" is the kind of thing only a sequence test catches.
3. **When a change alters a shared function's return contract, find the callers mechanically.** Grep every call site and put the count in the workplan. Do not list the callers from memory. The CR-2 seventh caller and the Q-SA-6/7 regressions were all the same pattern: slice 3 changed what `IN_FLIGHT` means, and the callers had to be checked.
4. **Never kill processes by image name on this machine.** `taskkill /IM git.exe` (or `pkill git`) reaches every worktree and session. If a git process is hung, identify it by PID and its working directory, and ask the user before killing anything not started by the current agent. Recommended for the Dev agent definition alongside the existing worktree hazards (shared `node_modules` junction, shared stash).
5. **A handler that does nothing should not look like success.** A webhook event marked `completed` after zero writes hid this defect. Where a handler is expected to change rows, logging the applied count (or warning on zero) would have surfaced it long ago. This is a candidate pattern for SA to rule on, not a change made here.

---

## Open follow-ups (not in this PR)

| # | Follow-up | Source | Owner |
|---|---|---|---|
| FU-1 | Clear stale `failure_code` / `failure_message` when a row moves out of `failed` (to `pending` via CR-1, or to `succeeded` via SA-5). The status is right; only a stale reason remains | SA round 2 suggestion; QA Low note | Dev (small fix) |
| FU-2 | A transient `pending` after an app refund whose synchronous reply was `succeeded`, until `refund.updated` arrives | QA Low note | SA to rule whether it needs action |
| FU-3 | Pre-existing `refundGroup` replay-cap gap (replay path vs `maxTotal`) | QA Low note | SA → Dev |
| FU-4 | The C-3 guard is shape-only. The automation-block route's behaviour is not exercised by a test (SA ruled out a new test file) | QA | QA / Dev, if the route gains a test harness |
| FU-5 | Confirm-time client email for a refund that resolves later (deferred under Q2 = a) | Requirement §12 | BA (business follow-up) |
| FU-6 | Reconciler's unsafe upsert, `scripts/reconcile-stripe-payments.ts:320` | A-10, requirement §11 | SA → Dev |
| FU-7 | Post-deploy checklist: A-11 (Stripe dashboard shows the Connect endpoint subscribed to `refund.failed` as well as `refund.created` / `refund.updated`); G-3 (a test-mode dashboard refund lands in the books); G-4 (an app refund gives one `app` row and `refund_row_id` on Stripe); the F2-b trigger effect; one live chat refund with a pending reply (CR-2 rendering) | QA report post-deploy checklist; requirement §0 | User / QA |
| FU-8 | Mark the 5 unmatched test-mode `charge.refunded` events as left (Q1 = leave). Record the decision so they are not re-investigated | RCA; Q1 | User / TL |

---

## Status: APPROVED BY USER 2026-10-14 — PENDING COMMIT — `fix/stripe-connect-refund-webhook` — commit hash and PR to be recorded by RM

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-14 | Created | TL retrospective after user approval of the diff, before the RM commit |
