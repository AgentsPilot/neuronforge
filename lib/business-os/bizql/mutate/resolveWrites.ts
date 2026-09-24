/**
 * Turn a plan's writes into writes that name literal rows.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A FUNCTION AND NOT A LOOP IN THE ROUTE
 *
 * It was a loop in the route, and it had exactly one caller — until a second
 * appeared (the eval runner, which duplicated it) and a third became necessary:
 * resuming a write after the user says WHICH row they meant.
 *
 * That third caller is the point. Resolution has to be re-enterable: the first
 * pass gets as far as the first ambiguous slot and stops, the user picks, and
 * the next pass carries on from there WITHOUT re-resolving anything already
 * pinned and without asking the planner again. So resolution returns a value —
 * `resolved` or `choice` — rather than composing an HTTP response and returning
 * out of the middle of a loop, which is what made it un-resumable.
 *
 * Re-entry is free because a pinned step is invisible to both resolvers:
 * `needsTargetResolution` is false once `target.id` is set, and a described
 * reference stops being described once it holds an id. The only thing that was
 * lost across the gap was the human NAMES, which is why they are passed back in.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/mutate
 */

import { CATALOG } from '@/lib/business-os/catalog';
import { labelForRow } from '../render/AnswerRenderer';
import type { QueryContext, QueryRow } from '../types';
import type { WriteStep } from './ConfirmationStore';
import {
  hasDescribedReferences,
  needsTargetResolution,
  resolveDescribedReferences,
  resolveMutateTarget,
  withResolvedTarget,
} from './resolveTarget';
import type { MutateQuery } from '../types';

/**
 * Which hole in a write a pick fills.
 *
 * Keyed by ARRAY INDEX, not `step.id`: `MutateQuery.id` is optional, so a plan
 * whose mutate steps carry no id would have no slot to name.
 */
export type ChoiceSlot =
  | { kind: 'target'; stepIndex: number }
  | { kind: 'reference'; stepIndex: number; field: string };

/** A write with its row pinned, and the names that row resolved to. */
export interface ResolvedWrite {
  step: WriteStep;
  /** Names, not ids, for the confirmation card the user actually reads. */
  targetName?: string;
  referenceNames?: Record<string, string>;
}

/** The names a step resolved to, carried across a turn rather than re-queried. */
export interface StepNames {
  targetName?: string;
  referenceNames?: Record<string, string>;
}

/** One row the user can pick, already labelled in their language. */
export interface ResolvedCandidate {
  id: string;
  label: string;
  /** 1-based, as rendered. What "the second one" refers to. */
  index: number;
}

export type WriteResolution =
  | { status: 'resolved'; writes: ResolvedWrite[] }
  | {
      status: 'choice';
      kind: 'none' | 'ambiguous';
      /** The entity the candidates belong to — which is NOT always the step's. */
      entity: string;
      total: number;
      rows: QueryRow[];
      candidates: ResolvedCandidate[];
      slot: ChoiceSlot;
      /** Everything before the slot pinned; the slot's own step pinned except for it. */
      steps: WriteStep[];
      names: StepNames[];
    };

/**
 * Resolve every described row a plan's writes name.
 *
 * References are resolved before targets, and that order is a contract: a resume
 * pins one slot at a time and re-enters here, so reversing it would ask the two
 * questions in a different order depending on which pass you were on.
 *
 * Does not catch. A `BizQLValidationError` from either resolver — an unfiltered
 * target, a field that cannot be described, a row with no usable id — is a bad
 * plan, not a question for the user, and belongs in the caller's error handling.
 */
export async function resolveWrites(args: {
  steps: WriteStep[];
  ctx: QueryContext;
  language: string;
  currency: string;
  /** Names already known from an earlier pass, positionally aligned with `steps`. */
  names?: StepNames[];
}): Promise<WriteResolution> {
  const { steps, ctx, language, currency } = args;

  const resolved: ResolvedWrite[] = [];

  /** The plan as it stands right now — pinned prefix, originals after. */
  const stepsSoFar = (openIndex: number, open: WriteStep): WriteStep[] => [
    ...resolved.slice(0, openIndex).map((r) => r.step),
    open,
    ...steps.slice(openIndex + 1),
  ];

  const namesSoFar = (openIndex: number, open: StepNames): StepNames[] => [
    ...resolved.slice(0, openIndex).map((r) => ({
      targetName: r.targetName,
      referenceNames: r.referenceNames,
    })),
    open,
    ...steps.slice(openIndex + 1).map((_, i) => args.names?.[openIndex + 1 + i] ?? {}),
  ];

  const candidatesOf = (entityKey: string, rows: QueryRow[]): ResolvedCandidate[] => {
    const idColumn = CATALOG.entities[entityKey]?.fields.id?.column ?? 'id';

    return rows
      .map((row, i) => ({
        id: String(row[idColumn] ?? ''),
        // An entity with nothing label-worthy falls back to its position rather
        // than to its uuid. The rows themselves are rendered above the chips in
        // the same order, so "#2" is still something the user can act on; a uuid
        // is not.
        label:
          labelForRow(entityKey, row, { language, timezone: ctx.timezone, currency }) ??
          `#${i + 1}`,
        index: i + 1,
      }))
      .filter((c) => c.id !== '');
  };

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // A fan-out names its rows through its `over` find, not through a target,
    // so there is nothing here to resolve.
    if (step.op !== 'mutate') {
      resolved.push({ step });
      continue;
    }

    let current: MutateQuery = step;

    // Seeded from the earlier pass, then overwritten only by an actual
    // resolution. Without this, resuming a write loses the names it already
    // resolved and the confirmation card falls back to raw uuids.
    const targetName: string | undefined = args.names?.[i]?.targetName;
    let referenceNames: Record<string, string> | undefined = args.names?.[i]?.referenceNames;

    // A described foreign key — "an invoice FOR Ofir" — resolves the same way a
    // target does, and for the same reason: the planner has never seen a row id
    // and must not invent one.
    if (hasDescribedReferences(current)) {
      const refs = await resolveDescribedReferences(current, ctx, language);

      if (refs.status !== 'resolved') {
        const rows = refs.status === 'ambiguous' ? refs.rows : [];

        return {
          status: 'choice',
          kind: refs.status,
          entity: refs.entity,
          total: refs.status === 'ambiguous' ? refs.total : 0,
          rows,
          candidates: candidatesOf(refs.entity, rows),
          slot: { kind: 'reference', stepIndex: i, field: refs.field },
          steps: stepsSoFar(i, current),
          names: namesSoFar(i, { targetName, referenceNames }),
        };
      }

      current = { ...current, data: refs.data as MutateQuery['data'] };
      // Merged, not replaced: a step with two described references resolves them
      // over two passes, and the first pass's label must survive the second.
      referenceNames = { ...referenceNames, ...refs.labels };
    }

    if (!needsTargetResolution(current)) {
      resolved.push({ step: current, targetName, referenceNames });
      continue;
    }

    const outcome = await resolveMutateTarget(current, ctx);

    if (outcome.status !== 'resolved') {
      const rows = outcome.status === 'ambiguous' ? outcome.rows : [];

      return {
        status: 'choice',
        kind: outcome.status,
        entity: step.entity,
        total: outcome.status === 'ambiguous' ? outcome.total : 0,
        rows,
        candidates: candidatesOf(step.entity, rows),
        slot: { kind: 'target', stepIndex: i },
        steps: stepsSoFar(i, current),
        names: namesSoFar(i, { targetName, referenceNames }),
      };
    }

    resolved.push({
      step: withResolvedTarget(current, outcome.id),
      targetName: labelForRow(step.entity, outcome.row, {
        language,
        timezone: ctx.timezone,
        currency,
      }),
      referenceNames,
    });
  }

  return { status: 'resolved', writes: resolved };
}

/**
 * Pin a picked row into the slot it belongs to.
 *
 * The counterpart of the `choice` outcome above: take the frozen steps back,
 * write the chosen id into the one open hole, and hand them to `resolveWrites`
 * again. Everything else in the array is untouched.
 */
export function pinChoice(steps: WriteStep[], slot: ChoiceSlot, rowId: string): WriteStep[] {
  return steps.map((step, i) => {
    if (i !== slot.stepIndex || step.op !== 'mutate') return step;

    if (slot.kind === 'target') return withResolvedTarget(step, rowId);

    return { ...step, data: { ...(step.data ?? {}), [slot.field]: rowId } } as MutateQuery;
  });
}
