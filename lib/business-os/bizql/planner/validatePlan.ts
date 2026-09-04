/**
 * Plan validation — catalog-aware, and deliberately verbose.
 *
 * Runs BEFORE anything touches the database. Two jobs:
 *
 *   1. Reject a plan that does not typecheck against the catalog.
 *   2. Produce problem strings precise enough to hand straight back to the model
 *      as a repair instruction. "unknown field 'invoices.total'. Known: amount,
 *      status, …" repairs reliably; "invalid plan" does not.
 *
 * The compiler validates again at execution time — it is the security boundary
 * and must never trust a caller. This layer exists to convert failures into
 * repairs before a round trip is wasted.
 *
 * @module lib/business-os/bizql/planner
 */

import { CATALOG, type ResolvedEntity } from '@/lib/business-os/catalog';
import { VALUELESS_OPS, isSemanticValue, type Predicate, type Query } from '../types';
import type { Plan } from './Planner';
import { relationPredicateProblem } from '../predicateRules';
import { parseGroupBy } from '../groupBy';

/** The four step operations. Anything else is a slip, not a step. */
const KNOWN_OPS_SET = new Set(['find', 'compute', 'mutate', 'for_each']);

const KNOWN_OPS = new Set([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'starts_with',
  'is_null',
  'is_not_null',
  'overlaps',
]);

/**
 * Maths symbols the planner reaches for instead of the named operators.
 *
 * OpenAI does not enforce a JSON-Schema `enum` on tool arguments unless strict
 * structured-output mode is on, so `>` and `>=` arrive regularly. The golden set
 * measured this as the single largest cause of repair passes.
 *
 * Normalising them is safe in a way that guessing never is: the mapping is a
 * closed set with exactly one correct reading each. Be liberal in what you
 * accept, strict in what you execute.
 */
const OPERATOR_ALIASES: Record<string, string> = {
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
  '=': 'eq',
  '==': 'eq',
  '===': 'eq',
  '!=': 'neq',
  '!==': 'neq',
  '<>': 'neq',
  equals: 'eq',
  not_equals: 'neq',
  greater_than: 'gt',
  less_than: 'lt',
  greater_than_or_equal: 'gte',
  less_than_or_equal: 'lte',
  like: 'contains',
  ilike: 'contains',
};

/**
 * Rewrite a plan into canonical form, in place, before validation.
 *
 * Only unambiguous normalisation belongs here — never anything that infers
 * intent. A missing operator alongside a value has exactly one coherent reading
 * (`eq`); a missing operator with no value does not, and is left to fail.
 */
export function normalizePlan(plan: Plan): void {
  const walk = (predicates: unknown[]) => {
    for (const predicate of predicates) {
      if (!predicate || typeof predicate !== 'object') continue;
      const p = predicate as Record<string, unknown>;

      for (const key of ['and', 'or', 'where'] as const) {
        if (Array.isArray(p[key])) walk(p[key] as unknown[]);
      }
      if (p.not) walk([p.not]);

      if (typeof p.op === 'string') {
        const alias = OPERATOR_ALIASES[p.op] ?? OPERATOR_ALIASES[p.op.toLowerCase()];
        if (alias) p.op = alias;
      } else if (p.op === undefined && typeof p.field === 'string') {
        // The operator sometimes arrives as a KEY rather than a value:
        //   {"field":"amount","gt":100}   instead of
        //   {"field":"amount","op":"gt","value":100}
        // Observed repeatedly from gpt-4o-mini, and it reads naturally enough
        // that it is worth accepting. Only a key that IS a known operator is
        // lifted, so nothing is inferred.
        const opKey = Object.keys(p).find(
          (k) => k !== 'field' && (KNOWN_OPS.has(k) || OPERATOR_ALIASES[k])
        );

        if (opKey) {
          p.value = p[opKey];
          p.op = OPERATOR_ALIASES[opKey] ?? opKey;
          delete p[opKey];
        } else if (p.value !== undefined) {
          // A field and a value but no operator has exactly one reading.
          p.op = 'eq';
        }
      }
    }
  };

  inlineStepReferencedLookups(plan);

  for (const step of plan.steps ?? []) {
    const s = step as unknown as Record<string, unknown>;

    // A key the schema declares as an array sometimes arrives as a lone object:
    //   "order_by": {"field":"amount","dir":"desc"}
    // instead of a one-element array. Validation then iterated a plain object and
    // threw `object is not iterable`, which escaped as a 500 — the user got a
    // server error for a plan that was one bracket away from correct.
    //
    // Wrapping has exactly one reading, so it belongs here with the operator
    // aliases rather than being inferred later.
    for (const key of ['where', 'select', 'include', 'order_by'] as const) {
      const value = s[key];
      if (value !== undefined && value !== null && !Array.isArray(value)) {
        s[key] = [value];
      }
    }

    walk((s.where as unknown[]) ?? []);
  }
}

/**
 * Iterate a plan-supplied value that SHOULD be an array.
 *
 * Nothing in a validator may throw: its whole purpose is to convert a bad plan
 * into a repair instruction, and an exception converts it into a 500 instead.
 * normalizePlan wraps stray objects, but validate must hold on its own for any
 * caller that skips normalisation.
 */
function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === undefined || value === null) return [];
  return [value as T];
}

/**
 * Rewrite "the contact step s1 found" into the filter s1 was going to use.
 *
 * Asked "הוסף משימה למשה", the planner reliably emits TWO steps — a find for the
 * contact, then a mutate whose reference points back at it:
 *
 *   s1: find contacts where first_name = "משה"
 *   s2: mutate tasks create data.contact_id = {$find:{where:[{field:"id",
 *                                              op:"eq", value:"$s1.id"}]}}
 *
 * Step references are banned in a write target for good reasons, so this was
 * refused — the user got an error for a request the system fully understood.
 *
 * The rewrite is NORMALISATION, not inference: "the row s1 finds" and "the row
 * matching s1's filter" are the same row, so substituting s1's filter has exactly
 * one correct reading. That is the same test the operator aliases had to pass.
 * The now-unused find step is dropped, but only when the answer sentence does not
 * refer to it — removing a step a placeholder points at would leave a hole in the
 * text the user reads.
 */
function inlineStepReferencedLookups(plan: Plan): void {
  const steps = plan.steps ?? [];
  const byId = new Map(steps.map((step) => [step.id, step]));
  const inlined = new Set<string>();

  const referencedStep = (value: unknown): string | undefined => {
    const raw =
      typeof value === 'string'
        ? value
        : typeof value === 'object' && value !== null && '$item' in value
          ? String((value as { $item: unknown }).$item)
          : undefined;

    // Accepts the bare form and the PLACEHOLDER form. The planner writes both:
    // `$s1.id` in a target, and `{s1.first.id}` — the same syntax it uses in
    // answer text — inside a filter. Only the first was recognised, so "change
    // the about section text" died on a reference the system could plainly read.
    const match = raw?.match(/^\{?\$?(s\d+)\./);
    return match?.[1];
  };

  const rewrite = (described: { where?: unknown[] } | undefined, sameEntityAs?: string): void => {
    const where = described?.where;
    if (!Array.isArray(where)) return;

    for (const predicate of where) {
      const p = predicate as { value?: unknown };
      const stepId = referencedStep(p.value);
      if (!stepId) continue;

      const source = byId.get(stepId);
      const sourceWhere = (source as { where?: unknown[] } | undefined)?.where;

      // Only a find with its own filter can stand in. Anything else and we would
      // be inventing a filter rather than moving one.
      if (!source || source.op !== 'find' || !Array.isArray(sourceWhere) || sourceWhere.length === 0) {
        continue;
      }
      if (sameEntityAs && source.entity !== sameEntityAs) continue;

      described!.where = sourceWhere;
      inlined.add(stepId);
      return;
    }
  };

  for (const step of steps) {
    if (step.op !== 'mutate') continue;
    const mutate = step as unknown as {
      entity: string;
      target?: { find?: { where?: unknown[] } };
      data?: Record<string, unknown>;
    };

    rewrite(mutate.target?.find, mutate.entity);

    for (const value of Object.values(mutate.data ?? {})) {
      if (value && typeof value === 'object' && '$find' in value) {
        rewrite((value as { $find: { where?: unknown[] } }).$find);
      }
    }
  }

  // Read steps: a foreign key compared against a nested lookup. The lookup may
  // itself reference an earlier step, so `rewrite` gets first refusal — exactly
  // as it does for a write target — and only then is the whole thing lifted to
  // the relation predicate that says the same thing properly.
  for (const step of steps) {
    if (step.op === 'mutate') continue;

    for (const predicate of asArray<{ value?: unknown }>((step as { where?: unknown[] }).where)) {
      if (!predicate) continue;

      // A BARE step reference — {"field":"contact_id","op":"eq",
      // "value":{"$item":"s1.id"}} — says the same thing as the nested-lookup
      // form, just more tersely. Normalising it INTO that form means one shape
      // to lift instead of two, and both end up as the relation predicate that
      // expresses it properly.
      const stepId = referencedStep(predicate.value);
      if (stepId) {
        const source = byId.get(stepId);
        const sourceWhere = (source as { where?: unknown[] } | undefined)?.where;
        if (source?.op === 'find' && Array.isArray(sourceWhere) && sourceWhere.length > 0) {
          predicate.value = { $find: { where: sourceWhere } };
          inlined.add(stepId);
        }
      }

      const nested = predicate.value as { $find?: { where?: unknown[] } } | undefined;
      if (nested && typeof nested === 'object' && nested.$find) rewrite(nested.$find);
    }
  }

  // A `where` nested inside `agg` is the STEP's filter, misplaced.
  //
  // Asked "כמה לקוחות יש חשבוניות פתוחות ומה הסך הכל", the planner emitted
  //   {op:'compute', agg:{fn:'count', field:'id', where:[…unpaid…]}}
  // The compiler only reads `step.where`, so the filter was silently DROPPED:
  // the count included cancelled invoices and the sum was ₪550 instead of ₪350,
  // under a sentence that said "unpaid". Validation missed it too — it checks
  // `step.where`, and there wasn't one.
  //
  // Lifting has exactly one reading: an aggregate has no filter of its own in
  // this grammar, so a `where` found there was always meant for the step. The
  // conflict case — both present and different — is left alone and fails
  // validation, because choosing between two filters IS inference.
  for (const step of plan.steps ?? []) {
    const raw = step as unknown as { where?: unknown[]; agg?: { where?: unknown[] } };
    const nested = raw.agg?.where;
    if (!Array.isArray(nested) || nested.length === 0) continue;

    if (!raw.where || (Array.isArray(raw.where) && raw.where.length === 0)) {
      raw.where = nested;
      delete raw.agg!.where;
    }
  }

  // An op that names an ACTION is a mutate that forgot to say so.
  //
  // "I don't work Fridays any more" produced {"op":"update", …}. There is no
  // `update` op — writes are `{"op":"mutate","action":"…"}` — and the request
  // died on a vocabulary slip while the intent was perfectly clear. Two shapes
  // are unambiguous and both are repaired here:
  //
  //   op names a declared action     → that action, as a mutate
  //   unknown op, but `action` set   → a mutate of the action already named
  //
  // Anything else is left to fail. Guessing WHICH write was meant is exactly the
  // inference this normaliser refuses to do.
  for (const step of plan.steps ?? []) {
    const raw = step as unknown as { op?: string; entity?: string; action?: string };
    if (!raw.op || KNOWN_OPS_SET.has(raw.op)) continue;

    const actions = CATALOG.entities[raw.entity ?? '']?.actions ?? {};

    if (actions[raw.op]) {
      raw.action = raw.op;
      raw.op = 'mutate';
    } else if (raw.action && actions[raw.action]) {
      raw.op = 'mutate';
    }
  }

  // "Find them all, then act on them" becomes "describe the one, and confirm it".
  //
  // Asked to "refund the payment from Ofir", the planner finds Ofir's payments
  // and points the mutate at that step — target.id "s1.rows.id". That is refused
  // outright, and rightly: applying a refund to many rows at once is not a thing
  // this system will do.
  //
  // But the refusal was the end of the road for a request that has a perfectly
  // good expression. A DESCRIBED target — the same filter, moved onto the mutate
  // — is resolved server-side to exactly one row, and asks the user to choose
  // when several match. So the filter is moved rather than the plan rejected,
  // and an impossible plan becomes the confirm-one-row flow the design already
  // has. The rewrite only fires when the source step is a find on the SAME
  // entity, so nothing is inferred about what the rows mean.
  for (const step of plan.steps ?? []) {
    if (step.op !== 'mutate') continue;
    const mutate = step as unknown as {
      entity?: string;
      target?: { id?: string; find?: unknown };
    };

    const id = mutate.target?.id;
    if (typeof id !== 'string' || mutate.target?.find) continue;
    if (!/^\$?s\d+\./.test(id) && !/rows/.test(id)) continue;

    const sourceId = id.match(/^\$?(s\d+)\./)?.[1];
    const source = sourceId ? byId.get(sourceId) : undefined;
    const sourceWhere = (source as { where?: unknown[] } | undefined)?.where;

    if (source?.op !== 'find' || !Array.isArray(sourceWhere) || sourceWhere.length === 0) {
      continue;
    }

    if (source.entity === mutate.entity) {
      mutate.target = { find: { where: sourceWhere } };
      inlined.add(sourceId!);
      continue;
    }

    // The lookup found a DIFFERENT entity — "refund the payment from Ofir"
    // finds the CONTACT and points a transaction mutate at it. That is not a
    // target, but it is not nonsense either: it describes the payment BY ITS
    // CONTACT, which a relation predicate says exactly.
    //
    // Only when this entity has a to-one relation to the one that was searched,
    // so the hop is read from the catalog rather than assumed.
    const entity = CATALOG.entities[mutate.entity ?? ''];
    const relationKey = Object.entries(entity?.relations ?? {}).find(
      ([, r]) => r.target === source.entity && r.cardinality === 'one' && r.via.side === 'local'
    )?.[0];

    if (relationKey) {
      mutate.target = {
        find: { where: [{ relation: relationKey, quantifier: 'any', where: sourceWhere }] },
      };
      inlined.add(sourceId!);
    }
  }

  // A fan-out of an action that cannot be fanned out becomes ONE confirmed write.
  //
  // Asked to "refund the payment from Ofir", the planner finds the payments and
  // emits a for_each over them. Refund is not bulk-capable — deliberately, it is
  // the one action that moves money out — so validation refuses it and says:
  // "show the user the matching rows and let them act on one."
  //
  // That is precisely what a DESCRIBED target does. The filter moves onto a
  // single mutate, the server resolves it to one row, and the user is asked to
  // choose when several match. So the advice in the error message is applied
  // rather than printed, and a dead end becomes the flow the design already has.
  //
  // Only for actions the catalog has NOT opted into bulk: a genuine bulk action
  // keeps its fan-out, with its caps and quota intact.
  for (let i = 0; i < (plan.steps ?? []).length; i++) {
    const step = plan.steps[i] as unknown as {
      op?: string;
      entity?: string;
      action?: string;
      over?: string;
      params?: Record<string, unknown>;
    };
    if (step.op !== 'for_each' || !step.action) continue;

    const declared = CATALOG.entities[step.entity ?? '']?.actions?.[step.action];
    if (!declared || declared.allowBulk) continue;

    const source = step.over ? byId.get(step.over) : undefined;
    const sourceWhere = (source as { where?: unknown[] } | undefined)?.where;

    if (
      source?.op === 'find' &&
      source.entity === step.entity &&
      Array.isArray(sourceWhere) &&
      sourceWhere.length > 0
    ) {
      plan.steps[i] = {
        id: (step as { id?: string }).id,
        op: 'mutate',
        entity: step.entity,
        action: step.action,
        target: { find: { where: sourceWhere } },
        // `{"$item":"amount"}` meant "this row's amount" while iterating. There
        // is no iteration now — the target IS the row — so such a param is at
        // best redundant and at worst an unresolvable object handed to a
        // handler. Literal params (a reason, an amount the user named) survive.
        data: Object.fromEntries(
          Object.entries(step.params ?? {}).filter(
            ([, value]) =>
              !(typeof value === 'object' && value !== null && '$item' in value)
          )
        ),
      } as unknown as (typeof plan.steps)[number];
      inlined.add(step.over!);
    }
  }

  // A target on a SINGLETON action is noise, so it is removed rather than
  // rejected.
  //
  // "Change Tuesday to 9-2" made the planner find the business profile and then
  // point the mutate at it — reasonable-looking, and refused, because a step
  // reference is not a legal target. But there is exactly one profile per user,
  // so a target here can carry no information: whatever it names, the row acted
  // on is the caller's own. Dropping it has one correct reading, which is the
  // same bar the operator aliases clear, and it turns a failed request into a
  // working one without a repair round trip.
  for (const step of plan.steps ?? []) {
    if (step.op !== 'mutate') continue;
    const mutate = step as unknown as { entity?: string; action?: string; target?: unknown };
    const declared = CATALOG.entities[mutate.entity ?? '']?.actions?.[mutate.action ?? ''];
    if (declared?.needsTarget === false && mutate.target) delete mutate.target;
  }

  liftForeignKeyLookupsToRelations(plan);

  if (inlined.size === 0) return;

  const answerText = plan.answer?.text ?? '';
  const stillNeeded = new Set(
    [...inlined].filter((id) => answerText.includes(`{${id}.`))
  );

  plan.steps = steps.filter((step) => !inlined.has(step.id ?? '') || stillNeeded.has(step.id ?? ''));
}


/**
 * Rewrite "the invoices whose contact_id is the contact called X" as
 * "the invoices that have a contact called X".
 *
 * Asked "how much does Ofir owe me", the planner reliably writes a foreign key
 * compared against a nested lookup:
 *
 *   {"field":"contact_id","op":"eq","value":{"$find":{"where":[
 *      {"field":"first_name","op":"contains","value":"Ofir"}]}}}
 *
 * BizQL has no sub-queries in filter values, so this used to be handed to
 * PostgREST as an object and came back
 *   invalid input syntax for type uuid: "[object Object]"
 * — a 500 for a question the system understood perfectly well. Rejecting it in
 * validation instead turned the crash into a refusal, which is more honest and
 * no more useful: the user still gets nothing.
 *
 * But BizQL DOES have the thing being asked for. A relation predicate says
 * exactly this, and says it better — one round trip, user-scoped on both sides,
 * and the compiler already reports when the inner lookup matches nobody, so
 * "Ofir owes you 0" cannot come back for an Ofir who does not exist.
 *
 * This is NORMALISATION, not inference. `fk = (the row matching W)` and `has a
 * related row matching W` select the same rows, so there is exactly one correct
 * reading — the same bar the operator aliases had to clear. The rewrite happens
 * only when the field declares what it references, so the relation is read from
 * the catalog rather than guessed from the column name.
 */
function liftForeignKeyLookupsToRelations(plan: Plan): void {
  for (const step of plan.steps ?? []) {
    const entity = CATALOG.entities[(step as { entity?: string }).entity ?? ''];
    const where = (step as { where?: unknown[] }).where;
    if (!entity || !Array.isArray(where)) continue;

    for (let i = 0; i < where.length; i++) {
      const p = where[i] as { field?: string; op?: string; value?: unknown };
      if (!p?.field || (p.op !== 'eq' && p.op !== 'in')) continue;

      const nested = p.value as { $find?: { where?: unknown[] } } | undefined;
      const innerWhere = nested?.$find?.where;
      if (!Array.isArray(innerWhere) || innerWhere.length === 0) continue;

      // `id in (the rows matching W)` is just `W`.
      //
      // Asked for "my five biggest clients by what they've paid", the planner
      // writes contacts filtered by their own id against a nested lookup of
      // contacts. Substituting the inner conditions is exact — "rows whose id is
      // among the rows matching W" and "rows matching W" are the same set — and
      // it costs a round trip less than the sub-query it replaces.
      if (p.field === 'id') {
        where.splice(i, 1, ...innerWhere);
        i += innerWhere.length - 1;
        continue;
      }

      const column = entity.fields[p.field]?.column;
      if (!column) continue;

      // Which declared relation travels this foreign key?
      //
      // Matched on the COLUMN alone. It used to also require the field to
      // declare `references`, but that is only present on WRITABLE foreign keys
      // — it exists to make a writable FK safe. So `transactions.contact_id`,
      // read-only and perfectly related, was skipped, and "refund the payment
      // from Ofir" failed for want of a lift that should have applied.
      const relationKey = Object.entries(entity.relations ?? {}).find(
        ([, r]) => r.via.side === 'local' && r.via.column === column
      )?.[0];

      if (!relationKey) continue;

      where[i] = { relation: relationKey, quantifier: 'any', where: innerWhere };
    }
  }
}

/** Does this field key name a real field or a declared derived field? */
function knownField(entity: ResolvedEntity, key: string): boolean {
  return Boolean(entity.fields[key] || entity.derived?.[key]);
}

function fieldSuggestions(entity: ResolvedEntity): string {
  const names = [
    ...Object.keys(entity.fields).filter((k) => entity.fields[k].readable !== false),
    ...Object.keys(entity.derived ?? {}),
  ];
  return names.join(', ');
}

/**
 * Does this filter point at another step's output instead of standing alone?
 *
 * Both places a row can be DESCRIBED — a write's target, and a described
 * reference in its data — hit this, and the planner reaches for it in both:
 * `{"field":"id","op":"eq","value":"$s1.id"}`. Defined once because the previous
 * time a rule lived in two places, the two drifted and a plan validated in one
 * and failed in the other.
 */
function referencesAnotherStep(where: Predicate[]): boolean {
  return where.some((predicate) => {
    const value = (predicate as { value?: unknown }).value;
    if (typeof value === 'string') return /^\$?s\d+\./.test(value);
    return typeof value === 'object' && value !== null && '$item' in value;
  });
}

function validatePredicate(
  entity: ResolvedEntity,
  predicate: Predicate,
  path: string,
  problems: string[]
): void {
  const p = predicate as unknown as Record<string, unknown>;

  // A predicate is EITHER about a field or about a relation, never both.
  //
  // The planner emitted {"field":"id","relation":"invoices","quantifier":"any"}.
  // This validator checked `relation` first and passed it; the compiler checked
  // `field` first and threw at query time. Two layers disagreeing on precedence
  // is how a plan validates and then fails in production, so the ambiguous shape
  // is rejected rather than silently resolved one way or the other.
  if (typeof p.relation === 'string' && typeof p.field === 'string') {
    problems.push(
      `${path}: a filter has BOTH "field" (${p.field}) and "relation" (${p.relation}). ` +
        `Use "field" to compare a column, or "relation" with a quantifier to ask about ` +
        `related rows — never both in one filter.`
    );
    return;
  }

  // --- relation predicate --------------------------------------------------
  if (typeof p.relation === 'string') {
    const relation = entity.relations?.[p.relation];
    if (!relation) {
      problems.push(
        `${path}: unknown relation '${entity.key}.${p.relation}'. ` +
          `Known relations: ${Object.keys(entity.relations ?? {}).join(', ') || 'none'}.`
      );
      return;
    }
    if (p.quantifier !== 'any' && p.quantifier !== 'none') {
      problems.push(`${path}: relation filter needs quantifier "any" or "none".`);
    }

    // Shared with the compiler on purpose — see predicateRules.ts.
    const shape = relationPredicateProblem(entity, p.relation, p.where);
    if (shape) problems.push(`${path}: ${shape}`);

    const target = CATALOG.entities[relation.target];
    if (target && Array.isArray(p.where)) {
      p.where.forEach((inner, i) =>
        validatePredicate(target, inner as Predicate, `${path}.where[${i}]`, problems)
      );
    }
    return;
  }

  // --- boolean combinators -------------------------------------------------
  for (const key of ['and', 'or'] as const) {
    if (Array.isArray(p[key])) {
      (p[key] as Predicate[]).forEach((inner, i) =>
        validatePredicate(entity, inner, `${path}.${key}[${i}]`, problems)
      );
      return;
    }
  }
  if (p.not) {
    validatePredicate(entity, p.not as Predicate, `${path}.not`, problems);
    return;
  }

  // --- field predicate -----------------------------------------------------
  if (typeof p.field !== 'string') {
    problems.push(`${path}: filter needs a 'field' (or 'relation').`);
    return;
  }

  if (!knownField(entity, p.field)) {
    problems.push(
      `${path}: unknown field '${entity.key}.${p.field}'. ` +
        `Known: ${fieldSuggestions(entity)}.`
    );
    return;
  }

  if (typeof p.op !== 'string' || !KNOWN_OPS.has(p.op)) {
    // Models reach for maths symbols. Name the replacement explicitly rather
    // than just rejecting, so one repair pass is enough.
    const SYMBOL_HINT: Record<string, string> = {
      '>': 'gt',
      '>=': 'gte',
      '<': 'lt',
      '<=': 'lte',
      '=': 'eq',
      '==': 'eq',
      '!=': 'neq',
      '<>': 'neq',
    };
    const hint = SYMBOL_HINT[String(p.op)];

    problems.push(
      `${path}: '${String(p.op)}' is not a valid operator. ` +
        (hint ? `Write "${hint}" instead. ` : '') +
        `Valid operators: ${[...KNOWN_OPS].join(', ')}.`
    );
    return;
  }

  if (!VALUELESS_OPS.has(p.op) && p.value === undefined) {
    problems.push(`${path}: operator '${p.op}' needs a value.`);
    return;
  }

  // A filter value is a literal, an array of literals, {"$semantic":…} or
  // {"$date":…}. Anything else object-shaped is a construct the model invented.
  //
  // The check used to name only {"$item":…}, and so caught only the invention
  // that had already been seen. Asked "how much does Gregory Fenwick owe me",
  // the planner wrote {"$find":{"where":[…]}} — a sub-query — which passed
  // validation, reached PostgREST, and returned
  //   invalid input syntax for type uuid: "[object Object]"
  //
  // Enumerating known-bad shapes is a losing game: there are infinitely many
  // plausible-looking constructs and the model will keep inventing new ones. So
  // the rule is inverted — only the declared forms are allowed — and every
  // future invention is caught by the repair pass on its first appearance
  // instead of taking a request down.
  const KNOWN_CONSTRUCTS = ['$semantic', '$date'];

  const invented = (Array.isArray(p.value) ? p.value : [p.value]).find(
    (v) =>
      typeof v === 'object' &&
      v !== null &&
      !Array.isArray(v) &&
      !KNOWN_CONSTRUCTS.some((key) => key in (v as object))
  );

  if (invented) {
    // {"$item":…} is real, just not here: it reads the current row inside a
    // for_each body, and a filter has no current row. Worth its own sentence,
    // because the fix is different.
    const isItem = '$item' in (invented as object);

    problems.push(
      isItem
        ? `${path}: {"$item":...} may only be used in for_each params, not in a filter. ` +
            `A filter cannot reference another step's rows — find the rows you want directly.`
        : `${path}: value ${JSON.stringify(invented).slice(0, 60)} is not a valid filter ` +
            `value. Use a literal, an array of literals, {"$semantic":"…"} or ` +
            `{"$date":"…"}. A filter cannot contain another query — find the rows you ` +
            `want in an earlier step, or filter this entity's own fields directly.`
    );
    return;
  }

  // A semantic term that isn't declared is the dangerous case: left alone it
  // would filter on a literal and return zero rows, which reads as a truthful
  // "you have none".
  // Semantic values may be bare OR inside an array; both must be checked, or an
  // undeclared term hidden in a list slips through to the compiler.
  const semanticCandidates = (Array.isArray(p.value) ? p.value : [p.value]).filter(
    isSemanticValue
  );

  if (semanticCandidates.length > 0) {
    const field = entity.fields[p.field];

    for (const candidate of semanticCandidates) {
      const term = candidate.$semantic.toLowerCase();

      if (!field) {
        problems.push(
          `${path}: '${p.field}' is a derived field and does not accept $semantic values.`
        );
      } else if (!field.semanticTerms?.[term]) {
        const known = Object.keys(field.semanticTerms ?? {});
        problems.push(
          `${path}: '${candidate.$semantic}' is not a semantic term for ` +
            `'${entity.key}.${p.field}'. ` +
            (known.length
              ? `Known terms: ${known.join(', ')}.`
              : `That field has no semantic terms.`)
        );
      }
    }
    return;
  }

  validateLiteralAgainstEnum(entity, p.field, p.value, path, problems);
  validateDateExpr(p.value, path, problems);
  validateUuidLiterals(entity, p.field, p.value, path, problems);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A uuid-typed field compared against a malformed id.
 *
 * Row ids are shown to the planner in the conversation context so it can refer
 * back to "the first one", and a model copying a 36-character hex string
 * sometimes drops a character. Observed:
 *
 *   b0c683cf-f098-4b-b984-012a577562fc     ("4c4b" became "4b")
 *
 * Postgres then rejects it as invalid syntax mid-query. Catching it here turns
 * an opaque database error into a repair the planner can act on.
 */
function validateUuidLiterals(
  entity: ResolvedEntity,
  fieldKey: string,
  value: unknown,
  path: string,
  problems: string[]
): void {
  const field = entity.fields[fieldKey];
  if (field?.type !== 'uuid') return;

  for (const candidate of Array.isArray(value) ? value : [value]) {
    if (typeof candidate !== 'string') continue;
    if (UUID_RE.test(candidate)) continue;

    problems.push(
      `${path}: '${candidate}' is not a valid id for '${entity.key}.${fieldKey}'. ` +
        `Copy the id EXACTLY as it appears — 8-4-4-4-12 hex characters — or filter ` +
        `on something else instead.`
    );
  }
}

/** Anchors accepted by the date resolver. Kept in sync with dates.ts. */
const DATE_ANCHORS = new Set([
  'now',
  'today',
  'tomorrow',
  'yesterday',
  'start_of_day',
  'end_of_day',
  'start_of_week',
  'end_of_week',
  'start_of_month',
  'end_of_month',
]);

/**
 * Reject an invented date anchor.
 *
 * Observed in testing: given a schema description mentioning "<anchor>", a model
 * emitted `{"$date":"anchor"}` literally. The resolver's switch would fall
 * through to `today`, quietly answering a different question than was asked.
 * Silent fallbacks on unrecognised input are how wrong answers look right.
 */
function validateDateExpr(value: unknown, path: string, problems: string[]): void {
  const candidates = Array.isArray(value) ? value : [value];

  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null || !('$date' in candidate)) continue;

    const anchor = (candidate as { $date: unknown }).$date;
    if (typeof anchor !== 'string' || !DATE_ANCHORS.has(anchor)) {
      problems.push(
        `${path}: '${String(anchor)}' is not a valid $date anchor. ` +
          `Use one of: ${[...DATE_ANCHORS].join(', ')}.`
      );
    }
  }
}

/**
 * Catch a literal that should have been a semantic term.
 *
 * The failure this prevents, seen on the very first Hebrew test run:
 *
 *   {"field":"status","op":"in","value":["open","unpaid","outstanding","owed", …]}
 *
 * Those are the NAMES of semantic terms, not stored values. Postgres matches
 * none of them, the query returns zero rows, and "מי חייב לי כסף?" is answered
 * with "you have no unpaid invoices" — confidently, and wrongly.
 *
 * A filter that cannot possibly match is always a bug, so we refuse it and tell
 * the model exactly how to rewrite it.
 */
function validateLiteralAgainstEnum(
  entity: ResolvedEntity,
  fieldKey: string,
  value: unknown,
  path: string,
  problems: string[]
): void {
  const field = entity.fields[fieldKey];
  if (!field) return;

  const semanticTerms = field.semanticTerms ?? {};
  const literals = (Array.isArray(value) ? value : [value]).filter(
    (v): v is string => typeof v === 'string'
  );
  if (literals.length === 0) return;

  for (const literal of literals) {
    const lower = literal.toLowerCase();
    const isStoredValue = field.enumValues?.includes(literal) ?? false;
    const isSemanticName = Boolean(semanticTerms[lower]);

    // Names a semantic term but is not itself a stored value → certain no-match.
    if (isSemanticName && !isStoredValue) {
      problems.push(
        `${path}: "${literal}" is a semantic term, not a stored value, so this filter ` +
          `would match nothing. Write {"$semantic":"${lower}"} instead.`
      );
      continue;
    }

    // A fixed enum we can check outright.
    if (field.enumValues && !isStoredValue && !isSemanticName) {
      problems.push(
        `${path}: "${literal}" is not a valid value for '${entity.key}.${fieldKey}'. ` +
          `Allowed: ${field.enumValues.join(', ')}. ` +
          (Object.keys(semanticTerms).length
            ? `Or use {"$semantic":"…"} with one of: ${Object.keys(semanticTerms).join(', ')}.`
            : '')
      );
      continue;
    }

    // Values for this field live in another table and vary per user, so whether
    // a literal is valid CANNOT be known without a database read. Deciding here
    // would either reject correct values or demand a semantic term that may not
    // exist — an instruction the planner cannot satisfy. The compiler checks it
    // against the user's real values, where the answer is actually knowable.
    if (field.enumSource) continue;
  }
}

/** Step kinds. Distinct from KNOWN_OPS above, which is the comparison operators. */
const KNOWN_STEP_OPS = new Set(['find', 'compute', 'mutate', 'for_each']);

function validateStep(
  step: Query,
  index: number,
  problems: string[],
  /** The sentence this plan will produce — a count must agree with its noun. */
  answerText = ''
): void {
  const path = `steps[${index}]`;

  // Fail closed on an unrecognised op.
  //
  // This previously fell through: a step with op "create" passed validation and
  // was then filtered out as "not a mutate", so the plan silently became a
  // read-only no-op and the user was told nothing had gone wrong. An op we do
  // not understand must be an error, never an implicit skip.
  if (!KNOWN_STEP_OPS.has((step as { op?: string }).op ?? '')) {
    problems.push(
      `${path}: unknown op '${String((step as { op?: string }).op)}'. ` +
        `Use "find" to read, "compute" to aggregate, or "mutate" with an "action" to write ` +
        `(e.g. {"op":"mutate","action":"create"}).`
    );
    return;
  }

  const entity = CATALOG.entities[step.entity];

  if (!entity) {
    problems.push(
      `${path}: unknown entity '${step.entity}'. ` +
        `Known entities: ${Object.keys(CATALOG.entities).join(', ')}.`
    );
    return;
  }

  // Only reads carry filters. A mutate targets one explicit row, and a for_each
  // iterates rows a previous step already filtered.
  const filters =
    step.op === 'find' || step.op === 'compute'
      ? asArray<Predicate>((step as { where?: Predicate[] }).where)
      : [];
  for (const [i, predicate] of filters.entries()) {
    validatePredicate(entity, predicate, `${path}.where[${i}]`, problems);
  }

  if (step.op === 'find') {
    for (const key of asArray<string>(step.select)) {
      const field = entity.fields[key];
      if (!field) {
        problems.push(
          `${path}.select: unknown field '${entity.key}.${key}'. Known: ${fieldSuggestions(entity)}.`
        );
      } else if (field.readable === false) {
        problems.push(`${path}.select: field '${entity.key}.${key}' is not readable.`);
      }
    }

    for (const include of asArray<{ relation: string; select?: string[] }>(step.include)) {
      const relation = entity.relations?.[include.relation];
      if (!relation) {
        // Name the fix, not just the fault. The planner attaches a contact to
        // anything it reads as being "about people" — including `insights`,
        // which has no relations at all — and a bare "unknown relation" left it
        // guessing at another relation name instead of dropping the include.
        const known = Object.keys(entity.relations ?? {});
        problems.push(
          `${path}.include: '${entity.key}' has no relation '${include.relation}'. ` +
            (known.length
              ? `Its relations are: ${known.join(', ')}. Use one of those or remove the include.`
              : `'${entity.key}' has NO relations — DELETE the include entirely. ` +
                `Its own fields already carry everything it can show.`)
        );
        continue;
      }
      // Both directions are supported: the contact on an invoice (one) and a
      // contact's invoices (many). The compiler emits the right PostgREST embed
      // for each.
      const target = CATALOG.entities[relation.target];
      for (const key of asArray<string>(include.select)) {
        if (target && !target.fields[key]) {
          problems.push(
            `${path}.include.select: unknown field '${relation.target}.${key}'.`
          );
        }
      }
    }

    for (const sort of asArray<{ field: string }>(step.order_by)) {
      if (!entity.fields[sort.field]) {
        problems.push(`${path}.order_by: unknown field '${entity.key}.${sort.field}'.`);
      }
    }
  }

  if (step.op === 'mutate') {
    const mutate = step as unknown as {
      action?: string;
      target?: { id?: string };
      data?: Record<string, unknown>;
    };

    const action = mutate.action ? entity.actions?.[mutate.action] : undefined;

    if (!mutate.action) {
      problems.push(
        `${path}: a mutate step needs an "action". ` +
          `Available for ${entity.key}: ${Object.keys(entity.actions ?? {}).join(', ') || 'none'}.`
      );
    } else if (!action) {
      problems.push(
        `${path}: '${entity.key}' has no action '${mutate.action}'. ` +
          `Available: ${Object.keys(entity.actions ?? {}).join(', ') || 'none'}.`
      );
    }

    // A create has no row to target — it is making one. The planner reached for
    // `target.find` on a create anyway, trying to express "an invoice FOR Ofir",
    // and nothing objected: the invoice would have been created unattached. That
    // relationship belongs in `data` as a described reference.
    if (mutate.action === 'create' && mutate.target) {
      problems.push(
        `${path}: 'create' takes no target — there is no existing row to act on. ` +
          `To link the new record to something, set the reference field in "data", ` +
          `e.g. {"contact_id":{"$find":{"where":[…]}}}.`
      );
    }

    // Everything except create must name the row it touches — either by literal
    // id, or by describing it so the server can resolve it to exactly one row.
    if (mutate.action && mutate.action !== 'create') {
      const target = mutate.target as
        | { id?: string; find?: { where?: Predicate[] } }
        | undefined;
      const id = target?.id;
      const find = target?.find;

      if (id && find) {
        // Both would mean two different answers to "which row", and whichever the
        // executor happened to read first would silently win.
        problems.push(
          `${path}: target has BOTH "id" and "find". Give one: a literal id when you ` +
            `already have it, or "find" to describe the row.`
        );
      } else if (find) {
        const where = asArray<Predicate>(find.where);

        if (referencesAnotherStep(where)) {
          // "update it", with no subject, planned find contacts -> update whose
          // target pointed at "$s1.id". A step reference cannot identify one row
          // here, and the honest output for a request with no subject is a
          // question, not a query aimed at whatever came back first.
          problems.push(
            `${path}: target.find cannot reference another step ('$sN.…'). Describe the ` +
              `row using what the USER said identified it. If the user did not say which ` +
              `row they meant, do not plan at all — set \`clarification\` and ask.`
          );
        } else if (where.length === 0) {
          // Without a filter this matches every row, and the resolver would take
          // whichever came back first — a write landing on an arbitrary row.
          problems.push(
            `${path}: target.find has no filter, so it would match every ` +
              `${entity.key}. Filter it by whatever the user said identified the row.`
          );
        }

        where.forEach((predicate, i) =>
          validatePredicate(entity, predicate, `${path}.target.find.where[${i}]`, problems)
        );
      } else if (!id) {
        // Nested rather than folded into the condition: `!id` is what narrows
        // `id` to a string for the branches below, and `!id && …` does not.
        if (action?.needsTarget !== false) {
          problems.push(
            `${path}: '${mutate.action}' needs a target. Either target.id — a literal id ` +
              `you were actually given — or target.find to describe the row, e.g. ` +
              `{"find":{"where":[{"field":"invoice_number","op":"eq","value":"INV-00002"}]}}.`
          );
        }
      } else if (/^s\d+\./.test(id) || /\{|\$|rows/.test(id)) {
        // Asked to "delete all my contacts", the planner reached for
        // target.id = "s1.rows.id" — a reference to another step's output. There
        // is no such feature: fan-out (for_each) is not implemented, and a
        // fabricated reference would sail through confirmation and then fail, or
        // worse, match something unintended.
        //
        // Refusing here is what actually makes bulk deletion inexpressible,
        // rather than merely awkward.
        problems.push(
          `${path}: target.id must be a literal row id, not a reference to another step ` +
            `('${id}'). Applying an action to many rows at once is not supported — ` +
            `show the user the matching rows and let them choose one.`
        );
      } else if (
        action?.needsTarget !== false &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ) {
        problems.push(
          `${path}: target.id '${id}' is not a row id. Use an id returned by a find step.`
        );
      }
    }

    // A described reference inside `data` gets the SAME scrutiny as any other
    // filter. Without this the planner emitted a redundant find step and then
    // pointed at it — {"contact_id":{"$find":{"where":[{"field":"id","op":"eq",
    // "value":{"$item":"s1.id"}}]}}} — and the unresolvable object reached the
    // database as the literal string "[object Object]". The filter belongs here
    // in the user's own terms ("first_name eq Ofir"), with no find step at all.
    for (const [key, value] of Object.entries(mutate.data ?? {})) {
      if (!value || typeof value !== 'object' || !('$find' in value)) continue;

      const field = entity.fields[key];
      if (field && !field.references) {
        problems.push(
          `${path}.data.${key}: only a reference field can be described with "$find". ` +
            `Give '${entity.key}.${key}' a literal value.`
        );
        continue;
      }

      const targetEntity = field?.references ? CATALOG.entities[field.references] : undefined;
      const described = (value as { $find?: { where?: Predicate[] } }).$find;
      const where = asArray<Predicate>(described?.where);

      if (where.length === 0) {
        problems.push(
          `${path}.data.${key}: "$find" has no filter, so it would match every ` +
            `${field?.references ?? 'row'}. Filter it by what the user actually said.`
        );
      }

      // The planner's instinct is to emit a find step and point this filter at
      // it — {"field":"id","op":"eq","value":{"$item":"s1.id"}}. The generic
      // errors that produced ("not a valid id", "$item may only be used in
      // for_each") describe the fault without naming the fix, and the repair pass
      // failed on both. Leading with the action is what converted the equivalent
      // case for relation filters, so the same applies here.
      if (referencesAnotherStep(where)) {
        problems.push(
          `${path}.data.${key}: DELETE the find step and describe the ` +
            `${field?.references ?? 'row'} directly here, using the words the user ` +
            `actually said — e.g. ` +
            `{"$find":{"where":[{"field":"first_name","op":"eq","value":"NAME"}]}}. ` +
            `This filter runs on its own; it cannot reference another step, and no ` +
            `separate find step is needed.`
        );
        continue;
      }

      if (targetEntity) {
        where.forEach((predicate, i) =>
          validatePredicate(
            targetEntity,
            predicate,
            `${path}.data.${key}.$find.where[${i}]`,
            problems
          )
        );
      }
    }

    // An action declaring PARAMETERS rather than columns carries a message or a
    // set of instructions in `data` — a subject, a weekday, a pair of times.
    // None is a field of anything, and checking them against the table reported
    // "unknown field 'business_profile.day'" for a perfectly formed request.
    //
    // The catalog build and the executor already make this exemption; this was
    // the third place that had to agree, and the one that actually blocked the
    // plan.
    if (action?.writesRow !== false) {
      for (const key of Object.keys(mutate.data ?? {})) {
        const field = entity.fields[key];
        if (!field) {
          problems.push(`${path}.data: unknown field '${entity.key}.${key}'.`);
        } else if (!field.writable) {
          problems.push(`${path}.data: field '${entity.key}.${key}' is not writable.`);
        }
      }
    }
  }

  if (step.op === 'for_each') {
    const fanOut = step as unknown as {
      over?: string;
      action?: string;
      params?: Record<string, unknown>;
      max?: number;
    };

    if (!fanOut.over) {
      problems.push(`${path}: for_each needs "over" — the id of an earlier find step.`);
    }

    const action = fanOut.action ? entity.actions?.[fanOut.action] : undefined;

    if (!fanOut.action) {
      problems.push(`${path}: for_each needs an "action".`);
    } else if (!action) {
      problems.push(
        `${path}: '${entity.key}' has no action '${fanOut.action}'. ` +
          `Available: ${Object.keys(entity.actions ?? {}).join(', ') || 'none'}.`
      );
    } else if (!action.allowBulk) {
      // The single most important check here. Bulk is opt-in per action, so a
      // destructive one can never be fanned out however the request is phrased.
      problems.push(
        `${path}: '${entity.key}.${fanOut.action}' cannot be applied to many rows. ` +
          `Show the user the matching rows and let them act on one.`
      );
    }

    // An {"$item":"…"} reference must name a real field, or the fan-out would
    // send to undefined for every row.
    for (const value of Object.values(fanOut.params ?? {})) {
      if (typeof value === 'object' && value !== null && '$item' in value) {
        const fieldKey = String((value as { $item: unknown }).$item);
        if (!entity.fields[fieldKey]) {
          problems.push(
            `${path}.params: {"$item":"${fieldKey}"} is not a field of '${entity.key}'.`
          );
        }
      }
    }
  }

  if (step.op === 'compute') {
    if (!step.agg?.fn) {
      problems.push(`${path}: compute step needs agg.fn.`);
    } else if (step.agg.fn !== 'count' && !step.agg.field) {
      problems.push(`${path}: agg '${step.agg.fn}' needs agg.field.`);
    }

    /*
     * Some fields are honest per row and ambiguous in a total.
     *
     * A payment's `amount` is what was charged — right on a row, and a trap to
     * sum, because the total means either what was billed or what was kept and
     * those differ by every refund. Rejected here rather than guessed, so the
     * planner names which total it wants and the answer says what it counted.
     */
    const aggregated = step.agg?.field ? entity.fields[step.agg.field] : undefined;

    if (step.agg?.fn && step.agg.fn !== 'count' && aggregated?.aggregateInstead?.length) {
      problems.push(
        `${path}: '${entity.key}.${step.agg.field}' cannot be aggregated — the total is ` +
          `ambiguous. Use ${aggregated.aggregateInstead.map((f) => `'${f}'`).join(' or ')} ` +
          `and say in the answer which one you counted.`
      );
    }

    // Normalisation lifts a misplaced `agg.where` when the step has none. If one
    // survives to here, the step had its OWN filter too — two different filters
    // for one query, and picking either would be a guess about which the user
    // meant.
    if (Array.isArray((step.agg as { where?: unknown[] } | undefined)?.where)) {
      problems.push(
        `${path}.agg: a filter belongs on the step, not inside "agg". This step ` +
          `already has its own "where" — move the conditions into it and remove ` +
          `"agg.where".`
      );
    }

    if (step.agg?.field && !entity.fields[step.agg.field]) {
      problems.push(`${path}.agg: unknown field '${entity.key}.${step.agg.field}'.`);
    }
    // Through the same parser the compiler uses. Validating `group_by` as a
    // plain field key here while the compiler read a grammar would let a plan
    // pass review and mean something else when it ran.
    const subjectProblem = countSubjectProblem(
      entity,
      (step as unknown as { id?: string }).id ?? `s${index + 1}`,
      step as { agg?: { fn?: string; field?: string; distinct?: boolean } },
      answerText
    );
    if (subjectProblem) problems.push(`${path}: ${subjectProblem}`);

    if (step.group_by) {
      const parsed = parseGroupBy(entity, step.group_by);
      if (parsed.problem) {
        problems.push(`${path}.group_by: ${parsed.problem}`);
      }
    }
  }
}


/**
 * Refuse a count whose SENTENCE is about one thing and whose DATA is another.
 *
 * Asked "כמה לקוחות יש חשבוניות פתוחות", the planner counted invoices and wrote
 * "יש לך {s1.value} לקוחות" — two unpaid invoices from one person reported as two
 * clients. Nothing caught it: the plan typechecks, the filter is right, the
 * number is a real count of something. It is simply a count of the wrong noun.
 *
 * This is checkable without understanding language, because the catalog already
 * names every entity in all three: `contacts.labels.many.he` IS "לקוחות". So if
 * the sentence names another entity and never names the one being counted, the
 * two halves disagree and the number will be wrong.
 *
 * Deliberately narrow, because a false positive here blocks a correct plan:
 *   - only `count` — a sum of amounts is not a count of nouns
 *   - only when the queried entity is NOT named, so "2 invoices for 1 client"
 *     is left alone
 *   - only when the named entity is actually reachable, so there is a real
 *     alternative to point at
 *   - never when `distinct` already counts that thing, which is the other
 *     correct way to say it
 */
function countSubjectProblem(
  entity: ResolvedEntity,
  stepId: string,
  step: { agg?: { fn?: string; field?: string; distinct?: boolean } },
  answerText: string
): string | undefined {
  if (step.agg?.fn !== 'count' || !answerText) return undefined;

  // Labels AND aliases. Labels alone are not enough: `contacts` is labelled
  // "אנשי קשר" while every user calls them "לקוחות", so a labels-only match
  // could never fire for the one case this was written for.
  const names = (e: ResolvedEntity) =>
    [
      ...[e.labels.many, e.labels.one].flatMap((l) => [l.en, l.he, l.es]),
      ...(e.aliases ?? []),
    ].filter(Boolean) as string[];

  // WHAT THE NUMBER IS ATTACHED TO, not what the sentence mentions.
  //
  // "יש לך {s1.value} לקוחות עם חשבוניות פתוחות" names both nouns, and an
  // earlier version of this check saw "חשבוניות" and passed it. But the number
  // modifies the word that FOLLOWS it — in Hebrew, English and Spanish alike —
  // and that word is "לקוחות". So only the text after the placeholder is read.
  const placeholder = new RegExp(`\\{${stepId}\\.(value|count)\\}`).exec(answerText);
  if (!placeholder) return undefined;

  const after = answerText
    .slice(placeholder.index + placeholder[0].length)
    .toLowerCase();

  // The FIRST entity named after the number is the one being counted.
  let nearest: { entity: ResolvedEntity; at: number } | undefined;

  for (const candidate of [entity, ...Object.values(entity.relations ?? {})
    .filter((r) => r.cardinality === 'one' && r.via.side === 'local')
    .map((r) => CATALOG.entities[r.target])
    .filter(Boolean)]) {
    for (const name of names(candidate)) {
      const at = after.indexOf(name.toLowerCase());
      if (at !== -1 && (!nearest || at < nearest.at)) {
        nearest = { entity: candidate, at };
      }
    }
  }

  if (!nearest || nearest.entity.key === entity.key) return undefined;

  const relationKey = Object.entries(entity.relations ?? {}).find(
    ([, r]) => r.target === nearest!.entity.key
  )?.[0];

  // Already counting the distinct values of the field that identifies it —
  // which IS counting that thing, correctly.
  const distinctField = step.agg?.distinct ? entity.fields[step.agg.field ?? ''] : undefined;
  const relationColumn = relationKey ? entity.relations![relationKey].via.column : undefined;
  if (distinctField && distinctField.column === relationColumn) return undefined;

  return (
    `answer.text counts '${nearest.entity.key}' but the step counts '${entity.key}' rows. ` +
    `One ${nearest.entity.key} can have several ${entity.key}, so this reports the wrong ` +
    `number. Either query '${nearest.entity.key}' filtered by ` +
    `{"relation":"...","quantifier":"any"}, or count the distinct values that identify ` +
    `it: {"fn":"count","field":"${relationKey ?? 'contact'}_id","distinct":true}.`
  );
}

/**
 * Reject an answer sentence that asserts facts the model could not know.
 *
 * The model writes the sentence BEFORE any data is fetched, so a bare number in
 * it is necessarily invented. Placeholders are the only legitimate way to carry
 * data. This is the guardrail that makes "answer text lives in the plan" safe
 * enough to replace ~120 hand-written response templates.
 */
function validateAnswer(plan: Plan, problems: string[], userMessage?: string): void {
  const text = plan.answer?.text;
  if (!text) return;

  const withoutPlaceholders = text.replace(/\{[^}]*\}/g, '');

  // Echoing a threshold the user themselves supplied is fine and often reads
  // better ("...over $100"). Only numbers the user never mentioned could have
  // been invented, so compare against their message rather than banning digits
  // outright — the strict version rejected a perfectly good answer.
  const userNumbers = new Set((userMessage ?? '').match(/\d+/g) ?? []);
  const invented = (withoutPlaceholders.match(/\d+/g) ?? []).filter(
    (n) => !userNumbers.has(n)
  );

  if (invented.length > 0) {
    problems.push(
      `answer.text contains ${invented.map((n) => `"${n}"`).join(', ')}, which the user did ` +
        `not mention and you cannot know — you have not seen the data. Use a {placeholder} ` +
        `such as {s1.count}. Received: "${text}".`
    );
  }

  const stepIds = new Set(plan.steps.map((s) => (s as unknown as { id?: string }).id ?? ''));

  // Only these paths resolve. Anything else renders as nothing, so it is caught
  // here rather than producing a sentence with a hole — or worse, the row count
  // standing in for a name ("owned by 1 1").
  const KNOWN_PATHS = new Set(['count', 'value', 'rows', 'groups', 'first']);

  for (const match of text.matchAll(/\{(\w+)\.([\w.]+)\}/g)) {
    const [, stepId, path] = match;

    if (!stepIds.has(stepId)) {
      problems.push(
        `answer.text references unknown step '${stepId}'. ` +
          `Known steps: ${[...stepIds].join(', ') || 'none'}.`
      );
      continue;
    }

    if (KNOWN_PATHS.has(path)) continue;

    // `{sN.percent_of.sM}` — one number as a percentage of another.
    const percentMatch = /^percent_of\.(\w+)$/.exec(path);
    if (percentMatch) {
      if (!stepIds.has(percentMatch[1])) {
        problems.push(
          `answer.text uses {${stepId}.percent_of.${percentMatch[1]}}, but ` +
            `'${percentMatch[1]}' is not a step. Known steps: ${[...stepIds].join(', ')}.`
        );
      } else if (percentMatch[1] === stepId) {
        // Always 100%, so the plan does not mean what it says.
        problems.push(
          `answer.text uses {${stepId}.percent_of.${stepId}} — a step as a percentage ` +
            `of itself is always 100%. Name the step holding the total.`
        );
      }
      continue;
    }

    // `{sN.first.<field>}` — one named field of the first row.
    //
    // Every other field reference stays banned, and for a good reason: a bare
    // `{s1.first_name}` used to fall through to the row count and render "owned
    // by 1 1". But naming a field OF THE FIRST ROW is not that. It is filled
    // from the fetched row at render time, exactly like {sN.value}, and the
    // model can no more fabricate it than it can fabricate a total.
    //
    // Banning it outright cost real answers: "your best link is X with N clicks"
    // and "your biggest invoice is INV-0003" are the natural shapes for
    // superlative questions, and both failed validation and burned a repair pass
    // every single time they were asked.
    const fieldMatch = /^first\.(\w+)$/.exec(path);
    if (fieldMatch) {
      const step = plan.steps.find((s) => (s as unknown as { id?: string }).id === stepId);
      const stepEntity = step ? CATALOG.entities[(step as { entity?: string }).entity ?? ''] : undefined;

      /*
       * A GROUPED compute does not return rows of its entity.
       *
       * It returns one row per group — a label and a total — so its first row
       * has no `service_name` or `amount` to name. `{s1.first.key}` is the
       * label the rows were grouped under and `{s1.first.value}` is that
       * group's total, which is how a superlative question says its answer:
       * "your most profitable service is X".
       *
       * Checked before the field lookup below, which would otherwise reject
       * both against the source entity's columns and reject the only correct
       * reference a grouped result has.
       */
      const grouped = (step as { op?: string; group_by?: unknown } | undefined);
      if (grouped?.op === 'compute' && grouped.group_by) {
        if (fieldMatch[1] === 'key' || fieldMatch[1] === 'value') continue;

        problems.push(
          `answer.text uses {${stepId}.first.${fieldMatch[1]}}, but ${stepId} groups its ` +
            `rows — a group has only {${stepId}.first.key} (what it is) and ` +
            `{${stepId}.first.value} (its total).`
        );
        continue;
      }

      const field = stepEntity?.fields[fieldMatch[1]];

      if (!stepEntity) continue; // The step's entity is validated elsewhere.

      if (!field) {
        problems.push(
          `answer.text uses {${stepId}.first.${fieldMatch[1]}}, but '${fieldMatch[1]}' is ` +
            `not a field of '${stepEntity.key}'.`
        );
      } else if (field.readable === false) {
        problems.push(
          `answer.text uses {${stepId}.first.${fieldMatch[1]}}, which is not readable.`
        );
      }
      continue;
    }

    problems.push(
      `answer.text uses {${stepId}.${path}}, which is not available. ` +
        `Use one of: {${stepId}.count}, {${stepId}.value}, {${stepId}.rows}, ` +
        `{${stepId}.first}, or {${stepId}.first.<field>} for one field of the first row.`
    );
  }
}

/**
 * A for_each must iterate rows of the entity it claims to act on.
 *
 * The failure this catches, seen on "email everyone who owes me money": the
 * planner found INVOICES and then fanned out over `entity: contacts`, reading
 * {"$item":"email"}. Invoice rows have no `email`, so every recipient resolved
 * to undefined. It fails safe at send time — but as a plan it is incoherent, and
 * the user would have been shown a confirmation listing 13 row ids rather than
 * 13 people.
 *
 * Needs the whole plan rather than one step, so it lives outside validateStep.
 */
function validateFanOutSources(plan: Plan, problems: string[]): void {
  const byId = new Map<string, Query>();
  for (const step of plan.steps ?? []) {
    const id = (step as { id?: string }).id;
    if (id) byId.set(id, step);
  }

  plan.steps?.forEach((step, index) => {
    if (step.op !== 'for_each') return;

    const fanOut = step as unknown as { over?: string; entity?: string };
    if (!fanOut.over) return;

    const source = byId.get(fanOut.over);

    if (!source) {
      problems.push(
        `steps[${index}]: for_each over '${fanOut.over}', which is not a step in this plan.`
      );
      return;
    }

    if (source.op !== 'find') {
      problems.push(
        `steps[${index}]: for_each must iterate a find step; '${fanOut.over}' is a ` +
          `'${source.op}' step.`
      );
      return;
    }

    if (source.entity !== fanOut.entity) {
      problems.push(
        `steps[${index}]: for_each acts on '${fanOut.entity}' but iterates '${source.entity}' ` +
          `rows from '${fanOut.over}', so {"$item":...} would read fields that do not exist. ` +
          `Find '${fanOut.entity}' directly — filtered with a relation predicate on ` +
          `'${source.entity}' — and iterate that instead.`
      );
    }
  });
}


/**
 * Validate a plan against the catalog. Empty array means valid.
 *
 * `userMessage` is optional but recommended: it lets the answer-text check tell
 * a number the user supplied from one the model invented.
 */
/**
 * Reject a plan that lists several entire tables.
 *
 * Asked "update it" — a sentence with no subject — the planner emitted find
 * contacts, find invoices, find bookings, find tasks, every one unfiltered. It is
 * read-only so nothing is damaged, but it answers nothing, fetches the user's
 * whole business, and reads as a system that did not understand and would not say
 * so. The correct output for a request with no content is a question.
 *
 * The signal is structural, so it needs no language knowledge: THREE or more
 * unfiltered reads across different entities is flailing, not a query. Two is
 * left alone deliberately — "show me my contacts and my invoices" is a real
 * request, and a guard that blocks real requests gets removed.
 */
function validateNotAScattergun(plan: Plan, problems: string[]): void {
  const unfiltered = (plan.steps ?? []).filter((step) => {
    if (step.op !== 'find') return false;
    const where = (step as { where?: unknown[] }).where;
    return !Array.isArray(where) || where.length === 0;
  });

  const entities = new Set(unfiltered.map((step) => step.entity));

  if (entities.size >= 3) {
    problems.push(
      `this plan lists ${entities.size} entire tables (${[...entities].join(', ')}) with no ` +
        `filters, which answers nothing. If you could not tell what the user meant, ` +
        `set \`clarification\` and ask — do not fetch everything instead.`
    );
  }
}

/**
 * An email must be addressed to something that can receive email.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "Call David urgently" has no calling capability behind it, so the planner
 * reached for the nearest thing it had — `contacts.send`, an action labelled
 * "send an email" — and addressed it to `{"$item":"phone"}`.
 *
 * The executor refused it correctly ("no email address") and reported one
 * failure. But by then the user had already been shown "1 recipient —
 * 2013643030" and asked to APPROVE it. Someone confirmed a send that could
 * never have worked, and learned it had failed only afterwards.
 *
 * Caught here instead, where the planner can repair it: a validation problem is
 * fed back and re-planned, so the model either addresses the email properly or
 * picks a different action — before anyone is asked to say yes.
 *
 * Driven by the field's declared FORMAT, not by a list of field names, so an
 * entity that calls its address something other than `email` works unchanged.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function validateSendAddress(plan: Plan, problems: string[]): void {
  for (const raw of plan.steps ?? []) {
    const step = raw as unknown as {
      op?: string;
      entity?: string;
      action?: string;
      params?: Record<string, unknown>;
    };

    if (step.action !== 'send' || !step.entity) continue;

    const entity = CATALOG.entities[step.entity];
    if (!entity) continue;

    const to = step.params?.to;
    const referenced =
      to && typeof to === 'object' && '$item' in (to as Record<string, unknown>)
        ? String((to as Record<string, unknown>).$item)
        : undefined;

    if (!referenced) continue;

    // `format`, not `type`: an address is a string whose FORMAT says what it is.
    // `contacts.email` is `{ type: 'string', format: 'email' }`, and there is no
    // 'email' member of FieldType to compare against.
    const field = entity.fields[referenced];
    const looksLikeAddress = field?.format === 'email';

    if (!looksLikeAddress) {
      problems.push(
        `${step.entity}.send is addressed to {"$item":"${referenced}"}, which is not ` +
          `an email address. A send delivers email — address it to the entity's ` +
          `email field, or choose an action that matches what was asked for.`
      );
    }
  }
}

/**
 * A literal standing in for a value the plan just computed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Asked for the most profitable service, the planner emitted:
 *
 *   s1: compute services max(price)
 *   s2: find services where price = 0        ← invented
 *   answer: "your most profitable service is {s2.first.service_name}"
 *
 * There is no way to reference `s1`'s result inside `s2`'s filter, so the model
 * had to write SOME number and wrote zero. The plan is structurally perfect and
 * every other check passes; it simply names the cheapest service as the most
 * profitable, with complete confidence.
 *
 * This is the worst failure shape in the system — not an error, an answer. A
 * wrong number is recoverable when it looks wrong; this one does not.
 *
 * Detected by its signature rather than by guessing intent: an earlier step
 * aggregates a field with min/max, and a later step filters THAT SAME FIELD on
 * the same entity against a plain literal. Nothing legitimate has that shape —
 * if you already know the value you want, you do not need to compute it first.
 * The fix is `order_by` + `limit`, which the grammar has and the prompt now
 * teaches, so this is reported as a problem the planner can repair.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function validateNoFabricatedThreshold(plan: Plan, problems: string[]): void {
  const steps = (plan.steps ?? []) as unknown as Array<Record<string, unknown>>;

  /** Fields an earlier step reduced to a single number, per entity. */
  const reduced = new Map<string, Set<string>>();

  for (const step of steps) {
    const entity = typeof step.entity === 'string' ? step.entity : '';
    if (!entity) continue;

    if (step.op === 'compute') {
      const agg = step.agg as { fn?: string; field?: string } | undefined;
      // Only min/max: a sum or a count is not a value any row equals.
      if (agg?.field && (agg.fn === 'max' || agg.fn === 'min')) {
        if (!reduced.has(entity)) reduced.set(entity, new Set());
        reduced.get(entity)!.add(agg.field);
      }
      continue;
    }

    const suspect = reduced.get(entity);
    if (!suspect?.size) continue;

    for (const predicate of (step.where ?? []) as Array<Record<string, unknown>>) {
      const field = typeof predicate.field === 'string' ? predicate.field : '';
      if (!field || !suspect.has(field)) continue;

      // A `$semantic` or any object value is not a fabricated literal.
      const value = predicate.value;
      if (value === null || typeof value === 'object') continue;

      problems.push(
        `${entity}.${field} is filtered against the literal ${JSON.stringify(value)} ` +
          `after an earlier step computed its ${[...suspect].includes(field) ? 'min/max' : 'value'}. ` +
          `A filter cannot reference another step's result, so that number is invented. ` +
          `Ask for the top row directly instead: one "find" with ` +
          `"order_by":{"field":"${field}","direction":"desc"} and "limit":1.`
      );
    }
  }
}

export function validatePlan(plan: Plan, userMessage?: string): string[] {
  const problems: string[] = [];

  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    problems.push('plan has no steps. Emit at least one find or compute step.');
    return problems;
  }

  if (plan.steps.length > 5) {
    problems.push(`plan has ${plan.steps.length} steps; at most 5 are allowed.`);
  }

  plan.steps.forEach((step, i) => validateStep(step, i, problems, plan.answer?.text ?? ''));
  validateFanOutSources(plan, problems);
  validateSendAddress(plan, problems);
  validateNoFabricatedThreshold(plan, problems);
  validateNotAScattergun(plan, problems);
  validateAnswer(plan, problems, userMessage);

  return problems;
}
