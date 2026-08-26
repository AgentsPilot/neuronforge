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

  for (const step of plan.steps ?? []) {
    walk((step as unknown as { where?: unknown[] }).where ?? []);
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

function validatePredicate(
  entity: ResolvedEntity,
  predicate: Predicate,
  path: string,
  problems: string[]
): void {
  const p = predicate as unknown as Record<string, unknown>;

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
}

/** Anchors accepted by the date resolver. Kept in sync with dates.ts. */
const DATE_ANCHORS = new Set([
  'now',
  'today',
  'tomorrow',
  'yesterday',
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

function validateStep(step: Query, index: number, problems: string[]): void {
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
      ? ((step as { where?: Predicate[] }).where ?? [])
      : [];
  for (const [i, predicate] of filters.entries()) {
    validatePredicate(entity, predicate, `${path}.where[${i}]`, problems);
  }

  if (step.op === 'find') {
    for (const key of step.select ?? []) {
      const field = entity.fields[key];
      if (!field) {
        problems.push(
          `${path}.select: unknown field '${entity.key}.${key}'. Known: ${fieldSuggestions(entity)}.`
        );
      } else if (field.readable === false) {
        problems.push(`${path}.select: field '${entity.key}.${key}' is not readable.`);
      }
    }

    for (const include of step.include ?? []) {
      const relation = entity.relations?.[include.relation];
      if (!relation) {
        problems.push(
          `${path}.include: unknown relation '${entity.key}.${include.relation}'.`
        );
        continue;
      }
      // Both directions are supported: the contact on an invoice (one) and a
      // contact's invoices (many). The compiler emits the right PostgREST embed
      // for each.
      const target = CATALOG.entities[relation.target];
      for (const key of include.select ?? []) {
        if (target && !target.fields[key]) {
          problems.push(
            `${path}.include.select: unknown field '${relation.target}.${key}'.`
          );
        }
      }
    }

    for (const sort of step.order_by ?? []) {
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

    // Everything except create must name the row it touches, and the id must be
    // a REAL one.
    if (mutate.action && mutate.action !== 'create') {
      const id = mutate.target?.id;

      if (!id) {
        problems.push(
          `${path}: '${mutate.action}' needs target.id — an id you were given, not invented. ` +
            `Emit a find step to locate the row, then ask the user which one they mean.`
        );
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
      } else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        problems.push(
          `${path}: target.id '${id}' is not a row id. Use an id returned by a find step.`
        );
      }
    }

    for (const key of Object.keys(mutate.data ?? {})) {
      const field = entity.fields[key];
      if (!field) {
        problems.push(`${path}.data: unknown field '${entity.key}.${key}'.`);
      } else if (!field.writable) {
        problems.push(`${path}.data: field '${entity.key}.${key}' is not writable.`);
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

    if (step.agg?.field && !entity.fields[step.agg.field]) {
      problems.push(`${path}.agg: unknown field '${entity.key}.${step.agg.field}'.`);
    }
    if (step.group_by && !entity.fields[step.group_by]) {
      problems.push(`${path}.group_by: unknown field '${entity.key}.${step.group_by}'.`);
    }
  }
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
  for (const match of text.matchAll(/\{(\w+)\./g)) {
    if (!stepIds.has(match[1])) {
      problems.push(
        `answer.text references unknown step '${match[1]}'. ` +
          `Known steps: ${[...stepIds].join(', ') || 'none'}.`
      );
    }
  }
}

/**
 * Validate a plan against the catalog. Empty array means valid.
 *
 * `userMessage` is optional but recommended: it lets the answer-text check tell
 * a number the user supplied from one the model invented.
 */
export function validatePlan(plan: Plan, userMessage?: string): string[] {
  const problems: string[] = [];

  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    problems.push('plan has no steps. Emit at least one find or compute step.');
    return problems;
  }

  if (plan.steps.length > 5) {
    problems.push(`plan has ${plan.steps.length} steps; at most 5 are allowed.`);
  }

  plan.steps.forEach((step, i) => validateStep(step, i, problems));
  validateAnswer(plan, problems, userMessage);

  return problems;
}
