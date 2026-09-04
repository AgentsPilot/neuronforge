# Automation handover — the gate that does not exist yet

> **Last Updated**: 2026-09-03
> **Status**: ⬜ Not started — the timeline node ships without it
> **Area**: `lib/business-os/insight/automation/AutomationManager.ts`, `lib/business-os/insight/kernel/`, `lib/business-os/insight/journeyTimeline.ts`

## Overview

The journey timeline's last node — **"Working on its own"** — is the milestone where the platform starts holding recurring work instead of the owner. It replaced the old `Day 90 · Automated / Takes over` node, which promised a handover on a calendar date that meant nothing.

The node ships now and reports what is true today. **What is missing is the gate**: there is no rule anywhere that decides when a business is ready to let the kernel run unattended. This document is that gap, written down so it does not disappear behind a node that already looks finished.

---

## What exists today

| Piece | Location | What it does |
|---|---|---|
| Per-detector eligibility | `TriggerableProcesses.ts` — `eligibleForAutomation` | Says whether a *process* may ever run unattended. `draft_reply_templates` is advisory only. |
| Standing automations | `insight_automations` table, `AutomationManager.ts` | The owner turns one on from an insight. Records `detector_id`, `trigger_condition`, `max_items_per_run`, quiet hours, `check_interval_minutes`. |
| Guardrails | `COMMON_GUARDRAILS` in `detectors/types.ts` | Per-process limits carried into the config. |
| Consent tier | `ConsentTier = 'observe' \| 'suggest' \| 'automate'` | Declared per detector. |
| Kernel run log | `kernel_action_log`, `KernelTrigger.logAction()` | Every run the kernel performed, one-off or automated. |

The only check before an automation is created is `AutomationManager.ts:95`:

```ts
if (!process || !process.eligibleForAutomation) { … }
```

**That is a property of the process, not of the business.** A brand-new account with one insight can turn on an automation that emails clients on its own, on day one, with no history behind the judgement that produced it.

---

## The gap

Nothing asks whether *this business* is ready. Specifically, nothing checks:

| Question | Why it matters |
|---|---|
| Has the detector behind this automation ever been right for this business? | The insight engine's own vectors exist precisely because a detector reading two data points is guessing. Automating a guess sends real email to real clients. |
| Has the owner ever run this process manually and kept the result? | A run they reversed is evidence against automating it. |
| Is the vector behind it lit? | `VECTOR_THRESHOLDS` already encodes "enough data to trust this" — and the automation path ignores it entirely. |
| How much can it do before a human sees it again? | `max_items_per_run` is set per automation with no ceiling derived from track record. |

---

## Shape of the fix

Three parts, in order of value:

### 1. An eligibility rule, in one place
A function `canAutomate(userId, detectorId)` that returns a decision **and its reason**, so the UI can say *why* rather than hiding the option. Candidate inputs, all already recorded:

- the detector's vector state from `getVectorMaturity` — `lit` before automation is offered
- prior manual runs of the same process from `kernel_action_log`, and whether they succeeded
- prior insights from the same detector that the owner **dismissed** — a detector they keep rejecting must not run unattended

### 2. A graduated ceiling
Rather than a binary gate: a first automation runs with a low `max_items_per_run` and widens as its own log shows clean runs. The column exists; nothing computes a value for it.

### 3. Wire the gate to the node
`buildJourney` takes `automatableNow` — a count the dashboard computes from per-detector eligibility alone. Once `canAutomate` exists, that count comes from it instead, and the handover node's **counting** state narrows from "processes that could in principle" to "jobs this business may actually hand over today". The `waiting` state then gains a real reason to show: *"after your first booking insight"*, not just "nothing yet".

---

## What the node does in the meantime

Honest about the absence, and not misleading:

| State | Condition today | Shown |
|---|---|---|
| reached | `insight_automations` has a row | the date it was turned on, and the day number |
| counting | pending insights whose process is `eligibleForAutomation` | the count, and *"ready to hand over"* |
| waiting | nothing eligible pending | *"when there is work to hand over"* |

No date is ever predicted for it — there is nothing to compute one from, and that is the point.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-03 | Created | Written when the journey timeline replaced the fixed day-1/4/18/60/90 stages. The day-90 "Automated" node had implied a gate that was never built. |
