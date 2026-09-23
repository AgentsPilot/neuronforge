// lib/business-os/entitlements/planCapabilities.ts
//
// WHAT DOES THIS CHAT PLAN ASK FOR?
//
// Workplan §4.5 / §4.10 (FR-6, RC-6). Pure: a plan in, a list of
// (capability, surface, rule, items) out. No config load beyond the chat map,
// no resolution, no I/O.
//
// ── WHY IT IS SEPARATE FROM shadow.ts ───────────────────────────────────────
// `shadow.ts` is imported by the chat route, so its top-level imports must stay
// at the logger and the mode flag (RC-7). This file imports the chat map, so
// `shadow.ts` loads it lazily, inside the try, when the mode is not `off`.
//
// ── WHY EVERY READ IS RECORDED TWICE ────────────────────────────────────────
// Q-B1 is undecided: does "search via chat" mean *any* look-up, or only one
// that is the answer itself? Both readings are expressible (`ChatReadRule`), and
// the decision should be made with numbers rather than intuition — so a `find`
// step emits ONE observation per reading, tagged with the rule that produced it.
// The report can then total either reading without re-running anything.
//
// Everything else maps identically under both readings and is tagged `both`, so
// a reading's true total is `rule IN ('<that reading>', 'both')`.

import type { Plan } from '@/lib/business-os/bizql/planner/Planner';
import type { Query } from '@/lib/business-os/bizql/types';
import type { ChatReadRule, SurfaceKind } from './types';
import { capabilityForOp, capabilityForPlanOp, isUngated } from './config/chatActionMap';

/** Which reading of the read rule produced an observation. */
export type ObservationRule = ChatReadRule | 'both';

/** One thing a plan asks for. */
export interface PlanCapabilityRequest {
  capability: string;
  surface: SurfaceKind;
  rule: ObservationRule;
  /**
   * The fan-out's PLANNED CAP — an upper bound, not rows processed.
   *
   * `for_each.max` is what the planner asked for and what the catalog clamped
   * it to; the run may touch fewer rows, and in shadow mode it has not run at
   * all. Reported as `plannedItems*` all the way through for that reason: a
   * fair-use ceiling set against "rows sent" when the number is really "rows
   * we were willing to send" would be set too high.
   */
  plannedItems: number;
  /** The step that asked, for the trace. Never sent to the database. */
  step: string;
}

/** Steps that were not classified, with the reason. */
export interface PlanCapabilityGap {
  step: string;
  entity: string;
  op: string;
  reason: 'unmapped_entity' | 'ungated';
  note?: string;
}

export interface PlanCapabilities {
  requests: PlanCapabilityRequest[];
  gaps: PlanCapabilityGap[];
}

/** Both readings, so a look-up can be recorded under each. */
const READINGS: readonly ChatReadRule[] = ['domain_group', 'read_only_plans_need_search'];

/**
 * How one operation maps, tagged with the reading(s) that produced it.
 *
 * Derived by COMPARING the two readings rather than by looking at the op (QA
 * A-1): `both` means "the two readings agree here", which is the only thing the
 * replay's filter can safely treat as reading-independent. The previous version
 * inferred it from `op === 'find'`, which mis-tagged a look-up fanned out inside
 * a `for_each` — resolved under the configured reading, then labelled `both`, so
 * the replay counted it under a reading that had not produced it.
 */
function mappingsFor(entity: string, op: string): Array<{ rule: ObservationRule; mapping: ReturnType<typeof capabilityForOp> }> {
  const [first, second] = READINGS.map((rule) => capabilityForOp(entity, op, rule));

  if (JSON.stringify(first) === JSON.stringify(second)) {
    return [{ rule: 'both', mapping: first }];
  }

  return READINGS.map((rule, index) => ({ rule, mapping: index === 0 ? first : second }));
}

/**
 * The surface kind a chat step runs on.
 *
 * Chat is an owner surface throughout; what varies is whether the step reads,
 * writes, or asks the model to say something — and those differ in grace, where
 * the owner may look but not touch (B-9).
 */
function surfaceFor(op: Query['op']): SurfaceKind {
  if (op === 'mutate' || op === 'for_each') return 'owner_write';
  if (op === 'analyse') return 'owner_ai';
  return 'owner_read';
}

/** A readable step id, for the trace only. */
function stepId(step: Query, index: number): string {
  return step.id ?? `s${index + 1}`;
}

/**
 * Everything one plan would need.
 *
 * Returns requests **and** gaps: an entity nobody classified is a fact worth
 * recording rather than a silent skip, because in enforcement it would decide
 * whether an owner can do something.
 */
export function capabilitiesForPlan(plan: Pick<Plan, 'steps'>): PlanCapabilities {
  const requests: PlanCapabilityRequest[] = [];
  const gaps: PlanCapabilityGap[] = [];

  const add = (capability: string, surface: SurfaceKind, rule: ObservationRule, plannedItems: number, step: string) => {
    requests.push({ capability, surface, rule, plannedItems, step });
  };

  plan.steps.forEach((step, index) => {
    const id = stepId(step, index);
    const surface = surfaceFor(step.op);

    if (step.op === 'analyse') {
      // A plan-level operation: no entity, and the same under both readings.
      add(capabilityForPlanOp('analyse'), surface, 'both', 1, id);
      return;
    }

    if (step.op === 'for_each') {
      // TWO capabilities, on purpose. Fanning out is itself sellable
      // (`chat.bulk`), and the action being fanned out still needs whatever it
      // would need once. The count is the planner's CAP — the most rows this
      // step was willing to touch — which is what a ceiling has to be set
      // against, and is not the same as rows actually processed.
      const plannedItems = Math.max(1, step.max ?? 1);
      add(capabilityForPlanOp('for_each'), surface, 'both', plannedItems, id);

      // QA A-1: the fanned-out action goes through the same reading comparison
      // as any other step. An action that happens to be a look-up is
      // reading-dependent, and tagging it `both` would let the replay count it
      // under a reading that never produced it.
      for (const { rule, mapping } of mappingsFor(step.entity, step.action)) {
        if (mapping === undefined) {
          if (rule !== 'read_only_plans_need_search') {
            gaps.push({ step: id, entity: step.entity, op: step.action, reason: 'unmapped_entity' });
          }
          continue;
        }
        if (isUngated(mapping)) {
          if (rule !== 'read_only_plans_need_search') {
            gaps.push({ step: id, entity: step.entity, op: step.action, reason: 'ungated', note: mapping.ungated });
          }
          continue;
        }
        add(mapping, surface, rule, plannedItems, id);
      }
      return;
    }

    const op = step.op === 'mutate' ? step.action : step.op;
    const mappings = mappingsFor(step.entity, op);

    for (const { rule, mapping } of mappings) {
      if (mapping === undefined) {
        // Once per step, not once per reading.
        if (rule === mappings[0].rule) {
          gaps.push({ step: id, entity: step.entity, op, reason: 'unmapped_entity' });
        }
        continue;
      }

      if (isUngated(mapping)) {
        if (rule === mappings[0].rule) {
          gaps.push({ step: id, entity: step.entity, op, reason: 'ungated', note: mapping.ungated });
        }
        continue;
      }

      add(mapping, surface, rule, 1, id);
    }
  });

  return { requests, gaps };
}
