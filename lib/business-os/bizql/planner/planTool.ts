/**
 * The `emit_plan` tool schema.
 *
 * ONE tool, not several.
 *
 * chat-v3 exposed 33 sibling tools and mapped each tool call to exactly one
 * step, which is why it could never express a dependency between steps — the
 * DAG runtime it shipped with was unreachable dead code. Sibling tool calls have
 * no way to say "step 2 operates on step 1's output".
 *
 * So the model makes a single call carrying the WHOLE plan, with explicit step
 * ids. One call means one parse, one validation, one repair path, one cache key,
 * and a schema block small and stable enough to be worth caching.
 *
 * The schema is generated from the catalog, so adding an entity or a semantic
 * term updates the planner's vocabulary with no edit here.
 *
 * @module lib/business-os/bizql/planner
 */

import { CATALOG } from '@/lib/business-os/catalog';

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const OPERATORS = [
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
];

const DATE_ANCHORS = [
  'now',
  'today',
  'tomorrow',
  'yesterday',
  'start_of_week',
  'end_of_week',
  'start_of_month',
  'end_of_month',
];

/**
 * Build the tool schema.
 *
 * Note the deliberate absence of `required` on most predicate members: marking
 * things required makes models fabricate values to satisfy the schema. That
 * lesson is inherited from the previous stack, where
 * `chat/CapabilityRegistry.ts:1572` carries the same comment. Missing
 * information should surface as a clarifying question, never as an invention.
 */
export function buildPlanTool(entityKeys?: string[]): ToolSchema {
  const entities = entityKeys?.length
    ? entityKeys.filter((k) => CATALOG.entities[k])
    : Object.keys(CATALOG.entities);

  const predicateSchema: Record<string, unknown> = {
    type: 'object',
    description:
      'A filter. Use `field` for a normal or derived field. Use `relation` with ' +
      'quantifier none/any to ask about the ABSENCE or PRESENCE of related rows.',
    properties: {
      field: { type: 'string', description: 'Field or derived-field name from the catalog.' },
      op: { type: 'string', enum: OPERATORS },
      value: {
        description:
          'One of: a literal; an array of literals; {"$semantic":"TERM"} where TERM is one ' +
          `of the {..} terms shown for the field; or {"$date":"ANCHOR"} where ANCHOR is ` +
          `exactly one of ${DATE_ANCHORS.join('|')}, with an optional ` +
          '{"offset":{"days":N}}. ' +
          'If the field shows {..} semantic terms, you MUST use {"$semantic":"..."} — ' +
          'passing the term name as a plain string matches nothing and silently returns ' +
          'zero rows.',
      },
      relation: { type: 'string', description: 'Relation name, when filtering on related rows.' },
      quantifier: { type: 'string', enum: ['any', 'none'] },
      where: { type: 'array', items: { type: 'object' }, description: 'Nested filters.' },
    },
  };

  return {
    type: 'function',
    function: {
      name: 'emit_plan',
      description:
        'Emit the complete plan that answers the user request. Always call this exactly once.',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            description:
              'The MINIMUM steps needed. Almost every question is ONE step. Do not add a ' +
              'second step to count rows you already fetched, and do not restate the same ' +
              'query with different filters "just in case".',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Step id, e.g. "s1".' },
                op: { type: 'string', enum: ['find', 'compute', 'mutate', 'for_each'] },
                entity: { type: 'string', enum: entities },
                where: { type: 'array', items: predicateSchema },
                select: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Fields to return. Omit for sensible defaults.',
                },
                include: {
                  type: 'array',
                  description: 'Attach related rows. Works in both directions.',
                  items: {
                    type: 'object',
                    properties: {
                      relation: { type: 'string' },
                      select: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
                order_by: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      field: { type: 'string' },
                      dir: { type: 'string', enum: ['asc', 'desc'] },
                    },
                  },
                },
                limit: { type: 'number' },
                agg: {
                  type: 'object',
                  description: 'Required for op=compute.',
                  properties: {
                    fn: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] },
                    field: { type: 'string' },
                  },
                },
                group_by: { type: 'string' },
                action: {
                  type: 'string',
                  description:
                    'Required for op=mutate. One of the actions listed for the entity (a:).',
                },
                target: {
                  type: 'object',
                  description:
                    'Required for op=mutate except create. Must be an explicit row id you ' +
                    'already know — never a guess.',
                  properties: { id: { type: 'string' } },
                },
                data: {
                  type: 'object',
                  description: 'Field values for op=mutate. Only writable (*) fields.',
                },
                over: {
                  type: 'string',
                  description:
                    'Required for op=for_each. The id of an earlier find step whose rows to ' +
                    'act on, e.g. "s1".',
                },
                params: {
                  type: 'object',
                  description:
                    'Parameters for op=for_each. Use {"$item":"field"} to read a field from ' +
                    'the current row — e.g. {"to":{"$item":"email"},"subject":"...",' +
                    '"body":"..."}. For action "send", subject and body are required and ' +
                    'you must write them yourself, in the user\'s language.',
                },
                max: {
                  type: 'number',
                  description: 'Optional ceiling on how many rows to act on.',
                },
              },
              required: ['id', 'op', 'entity'],
            },
          },
          answer: {
            type: 'object',
            description:
              'How to phrase the result, in the user language. Use {placeholders} that refer to ' +
              'step output — NEVER write actual numbers or names, since you have not seen the ' +
              'data yet. Available: {sN.count}, {sN.value}, {sN.rows}.',
            properties: {
              text: {
                type: 'string',
                description:
                  'One short sentence with placeholders, in the user language. ' +
                  'Example: "You have {s1.count} unpaid invoices over $100."',
              },
              primary_step: { type: 'string', description: 'Step id whose rows to display.' },
            },
            required: ['text'],
          },
          clarification: {
            type: 'string',
            description:
              'Set INSTEAD of steps when the request is genuinely ambiguous. Ask one short ' +
              'question in the user language. Do not guess missing values.',
          },
        },
        required: ['steps'],
      },
    },
  };
}

/**
 * The system prompt.
 *
 * Deliberately contains NO example utterances. chat-v3 accumulated 13 hardcoded
 * example→tool mappings here plus 230 canned sentences used as a string-match
 * classifier; that is the pattern this rewrite exists to end. The model is given
 * a vocabulary (the catalog) and rules for using it, never a list of phrasings.
 */
export const PLANNER_SYSTEM_PROMPT = `You convert a small-business owner's request into ONE structured plan.

You are given a CATALOG of entities. Notation:
  f: fields    d: derived fields    r: relations    a: actions
  name:type    [a|b|c] allowed stored values    * writable    [] means many

Relations work in "include" in BOTH directions: the contact on an invoice, or a
contact's invoices. Query the entity the user asked ABOUT and include the rest.

RULES
1. Call emit_plan exactly once. Never answer in prose.
2. Emit the FEWEST steps that answer the question — usually exactly one. A find step already
   returns its rows, so never add a separate step just to count them.
3. Only use entities, fields, relations and semantic terms that appear in the catalog.
   Never invent a field name. If something you need is absent, use \`clarification\`.
4. If a field shows semantic terms in {..}, you MUST filter it with {"$semantic":"term"}.
   Writing the term as a plain string (e.g. "unpaid") matches no stored value and silently
   returns zero rows, which would tell the user something false.
   Prefer a declared semantic term over an equivalent you compose yourself:
   status {"$semantic":"unpaid"} is not the same as status neq "paid", because the
   business rule deliberately excludes drafts and cancelled invoices.
   Conversely, a field marked [per-user] has NO semantic terms: its values are configured
   by this business and listed under THIS USER'S CONFIGURED VALUES. Filter it with the exact
   literal value from that list — never {"$semantic":...}. Map the user's wording onto the
   closest listed value yourself.
5. For anything relative in time use {"$date":"ANCHOR"} where ANCHOR is one of:
   now, today, tomorrow, yesterday, start_of_week, end_of_week, start_of_month, end_of_month.
   Never invent an anchor name and never hardcode a calendar date.
6. Choose the op by what is being asked for, not by wording:
   - a QUANTITY (a total, a sum, an average, "how much", "how many") -> op "compute" with agg.
   - a LIST or the identities of things -> op "find".
   Answering "how much am I owed" with a list of rows answers a different question.
7. Derived fields (d:) are used exactly like normal fields, including with eq true/false.
8. answer.text must be ONE short sentence in the user's own language, containing only
   {placeholders} for any data. You have not seen the data, so never state a number or a
   name directly. Placeholders may only reference steps you emitted.
9. If the request is ambiguous, set \`clarification\` and omit steps. Never guess a value
   the user did not give.
10. To act on MANY rows, emit a find step and then a for_each step over it:
      s1: find the rows      s2: for_each over "s1" with an action and params
    Use {"$item":"field"} in params to read from the current row. This is the ONLY
    way to affect several rows; a mutate always targets exactly one id.
    Only actions the catalog marks bulk-capable can be used this way, the user is
    always shown who will be affected first, and there is a hard cap.
11. WRITES (op "mutate") change the user's real business data, so:
    - use only the actions listed after a: for that entity;
    - every write except create needs target.id — an id you were GIVEN, never invented.
      If you do not have the id, emit a find step or ask with \`clarification\` instead;
    - actions marked "confirm" are shown to the user for approval before anything happens,
      so describe the effect plainly in answer.text;
    - never combine a write with unrelated reads in one plan.`;
