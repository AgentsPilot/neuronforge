# Workplan: PAYMENT_PLAN_CANCELLED is a warning, and is registered

**Developer:** Dev
**Requirement:** SA ruling #1 in [audit-severity-normal-operations-workplan.md](/docs/workplans/audit-severity-normal-operations-workplan.md) § Rulings
**Branch:** `fix/payment-plan-cancelled-severity` (cut from `main` at `ce01bc67`)
**Date:** 2026-09-30
**Status:** Code Complete

## Analysis Summary

PR #157 moved `PAYMENT_REFUNDED` from `critical` to `warning` and made
`lib/audit/events.ts` its single owner. `PAYMENT_PLAN_CANCELLED` was deliberately
matched to the refund — the call-site comment says it is "audited at the same level
as money moving" — so that move left the two contradicting each other in code.

Measured on this tree, not assumed:

| Fact | Verified |
|---|---|
| `PAYMENT_PLAN_CANCELLED` is **unregistered** | No hit in `lib/audit/events.ts`; no `AUDIT_EVENTS` constant. Rows record with `getEventMetadata`'s fallback `description: "Unknown event: …"` and `compliance_flags: []` |
| One call site, one write | `app/api/payments/plans/[id]/cancel/route.ts:113` — the file's only `severity:` and only `PAYMENT_PLAN_CANCELLED` |
| Caller beats registration | `AuditTrailService.buildLogEntry` resolves `severity: input.severity \|\| metadata.severity` and `compliance_flags: input.complianceFlags \|\| metadata.complianceFlags \|\| []` |
| Entity type already registered | `payment_plan_subscription` is in `AUDIT_ENTITY_TYPES` — no types.ts change needed |
| `cancelPlan` writes no audit | Severity lives only in the route |
| Pino compliant | 0 `console.*` in the route and in `lib/payments/cancelPlan.ts` |

**Not in the brief, forced by the code:** registering the event adds an `AUDIT_EVENTS`
constant, and `lib/audit/eventAudience.ts` closes with
`satisfies Record<AuditEvent, AuditAudience>` while `eventAudience.test.ts` pins an
exhaustive count. A new constant therefore *must* get an audience entry (`'bos'`,
matching `PAYMENT_REFUNDED`) and the pinned split moves 172→173 / bos 27→28. That
test exists precisely to force this decision, so updating it is the intended path.

## Implementation Approach

Mirror PR #157 exactly: the registration becomes the single owner of the
classification, the call site passes nothing, and a guard pins both halves.

- **`warning`, not `info`** — a plan cancellation stops future charges to a client
  and can reverse collected money; more than a routine read, but it is a business
  owner acting on their own client and needs no platform admin.
- **Compliance flag `['SOC2']`** — what all three Business OS money events carry
  (`PAYMENT_REFUNDED`, `PAYMENT_BLOCK_EXECUTED`, `INVOICE_MARKED_PAID`).
  `FINANCIAL` is used only by AgentsPilot's own platform-billing events, and there
  for stored-row continuity. This is a strict strengthening: the event carried no
  flags at all while unregistered.
- **Future writes only.** Stored rows keep their `critical`, by design — rewriting
  audit rows to flatter a dashboard is the wrong trade on a compliance surface.

## Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `lib/audit/events.ts` | modify | Add the `AUDIT_EVENTS` constant + the `EVENT_METADATA` registration (`warning`, `['SOC2']`, real description) |
| `app/api/payments/plans/[id]/cancel/route.ts` | modify | Delete `severity: 'critical'`; rewrite the comment that justified it by pointing at refunds |
| `lib/audit/eventAudience.ts` | modify | Required audience entry: `'bos'` |
| `lib/audit/__tests__/eventAudience.test.ts` | modify | Pinned split 172→173, bos 27→28 |
| `lib/audit/__tests__/paymentPlanCancelledSeverity.guard.test.ts` | create | Guard the registration and the source-level absence of an override |

## Task List

- [x] Step 1: Read the merged PR #157 diff and mirror its shape
- [x] Step 2: Verify the registration status rather than assume it (unregistered — confirmed)
- [x] Step 3: Register the constant + metadata in `lib/audit/events.ts`
- [x] Step 4: Add the `'bos'` audience entry and update the pinned counts
- [x] Step 5: Remove the call-site severity and rewrite its comment
- [x] Step 6: Add the guard test
- [x] Step 7: Run the audit suites, the scoped typecheck and `npm run build`

## Guard-test decision

**A new dedicated file**, not an extension of `paymentRefundSeverity.guard.test.ts`.
The merged file is refund-specific by name, doc block, `REFUND_ROUTE` constant and
its "both refund paths" assertion (`toHaveLength(2)`); the plan route has exactly
one write, so the assertions genuinely differ. A dedicated file is also greppable by
event name, and leaves the just-merged guard untouched so this change is purely
additive. If a third event joins this class, the right move is to parameterise all
of them into one suite over `(event, route, severity, flags, writeCount)` — noted,
not done here, because the brief is deliberately one event.

## SA Review Notes
[SA will populate this section]

## QA Testing Report
[QA will populate this section]

## Commit Info
[RM will populate this section]
