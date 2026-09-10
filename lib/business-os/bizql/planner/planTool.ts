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

import { createHash } from 'crypto';
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

/*
 * Kept in step with DATE_ANCHORS in ../types by the drift test — this copy had
 * silently lost start_of_day and end_of_day, so the schema advertised a
 * narrower vocabulary than the resolver accepts.
 */
const DATE_ANCHORS = [
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
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/**
 * The schema members that only a mutate or a for_each can use.
 *
 * Built per turn because the `action` enum spans the offered entities. Kept
 * out of the main literal so the read-only shape is obvious at a glance: what
 * remains there is exactly what a question can express.
 */
function writeProperties(
  entities: string[],
  predicateSchema: Record<string, unknown>
): Record<string, unknown> {
  return {
                  action: {
                    type: 'string',
                    /*
                     * Enumerated, not merely described.
                     *
                     * "Required for op=mutate" in prose was not enough: asked to
                     * change a task's status the model emitted a mutate step with
                     * no `action` at all — roughly a third of the time, and only
                     * once there was conversation history to distract it. The
                     * plan failed validation, the repair round failed the same
                     * way, and the user saw "I didn't understand" for a perfectly
                     * ordinary request that worked on the next attempt.
                     *
                     * A schema enum is a much stronger constraint on generation
                     * than a sentence. The union spans every offered entity, so
                     * it cannot express which action belongs to which entity —
                     * validation still owns that pairing. What it does own is the
                     * failure that actually happened: the field going missing.
                     */
                    enum: [
                      ...new Set(
                        entities.flatMap((key) => Object.keys(CATALOG.entities[key]?.actions ?? {}))
                      ),
                    ].sort(),
                    description:
                      'Required for op=mutate. One of the actions listed for the entity (a:) — ' +
                      'this list spans all offered entities, so pick one shown for YOUR entity.',
                  },
                  target: {
                    type: 'object',
                    description:
                      'Required for op=mutate except create and actions marked no-target. Give ONE of: "id", a literal row ' +
                      'id you were actually given — never a guess; or "find", describing the ' +
                      'row the user named, e.g. ' +
                      '{"find":{"where":[{"field":"invoice_number","op":"eq","value":"INV-00002"}]}}. ' +
                      'Prefer "find" whenever the user identified the row by name, number or ' +
                      'any other field. The server resolves it to exactly one row and asks the ' +
                      'user if several match.',
                    properties: {
                      id: { type: 'string' },
                      find: {
                        type: 'object',
                        properties: { where: { type: 'array', items: predicateSchema } },
                      },
                    },
                  },
                  data: {
                    type: 'object',
                    description:
                      'Field values for op=mutate, and the parameters of an action that ' +
                      'takes them (req=/opt= in the catalog) — a required parameter is not ' +
                      'optional, and omitting it makes the assistant stop and ask. A DATE ' +
                      'parameter takes the same form as a date anywhere else: ' +
                      '{"date":{"$date":"tomorrow"}}, {"date":{"$date":"wednesday"}}. ' +
                      'Only writable (*) fields. To link the ' +
                      'record to another one the user named rather than gave an id for, ' +
                      'describe it: {"contact_id":{"$find":{"where":[{"field":"first_name",' +
                      '"op":"eq","value":"Ofir"}]}}}. The server resolves it to one row and ' +
                      'asks if several match. Never invent an id.',
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
  };
}

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

  /*
   * Can anything offered to this turn be acted on?
   *
   * `action`, `target`, `data`, `over`, `params` and `max` exist only to
   * express a mutate or a for_each, and together they are ~920 tokens of every
   * request. When no offered entity declares an action, a plan using them could
   * not name one — validation would reject it, so the model is being shown a
   * capability it does not have and paying for the privilege on every call.
   *
   * Read from the same catalog the plan is validated against, so this can only
   * remove what was already unusable.
   */
  const canAct = entities.some(
    (key) => Object.keys(CATALOG.entities[key]?.actions ?? {}).length > 0
  );

  const predicateSchema: Record<string, unknown> = {
    type: 'object',
    description:
      'A filter. Use `field` for a normal or derived field. Use `relation` with ' +
      'quantifier none/any to ask about the ABSENCE or PRESENCE of related rows ' +
      'that MATCH a nested `where`. A relation filter with no `where` adds nothing ' +
      'and can silently empty the result — omit it instead.',
    properties: {
      field: { type: 'string', description: 'Field or derived-field name from the catalog.' },
      op: { type: 'string', enum: OPERATORS },
      value: {
        description:
          'One of: a literal; an array of literals; {"$semantic":"TERM"} where TERM is one ' +
          `of the {..} terms shown for the field; or {"$date":"ANCHOR"} where ANCHOR is ` +
          `exactly one of ${DATE_ANCHORS.join('|')}, with an optional ` +
          '{"offset":{"days":N}}; or {"$date":"YYYY-MM-DD"} for a day the user named. ' +
          'If the field shows {..} semantic terms, you MUST use {"$semantic":"..."} — ' +
          'passing the term name as a plain string matches nothing and silently returns ' +
          'zero rows.',
      },
      relation: { type: 'string', description: 'Relation name, when filtering on related rows.' },
      quantifier: { type: 'string', enum: ['any', 'none'] },
      where: { type: 'array', items: { type: 'object' }, description: 'Nested filters.' },
    },
  };

  // Built here rather than above: it embeds `predicateSchema` for target.find.
  const writeMembers = canAct ? writeProperties(entities, predicateSchema) : {};

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
              'query with different filters "just in case". ' +
              'BUT a question that asks TWO things needs a step for each, and the answer ' +
              'sentence must reference both: "how many clients owe me and what is the ' +
              'total" is a distinct count AND a sum, and answering only the first leaves ' +
              'half the question silently unanswered.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Step id, e.g. "s1".' },
                op: {
                  type: 'string',
                  enum: canAct
                    ? ['find', 'compute', 'mutate', 'for_each', 'analyse']
                    : ['find', 'compute', 'analyse'],
                },
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
                    distinct: {
                      type: 'boolean',
                      description:
                        'For count only. Counts how many DIFFERENT values the field has ' +
                        'rather than how many rows. Use it whenever the question counts a ' +
                        'RELATED thing: "how many clients have unpaid invoices" is ' +
                        '{fn:count, field:contact_id, distinct:true} over invoices, because ' +
                        'one client with two invoices is one client. The field must be the ' +
                        'one IDENTIFYING that thing — contact_id for clients, service_id ' +
                        'for services. Counting distinct id is just counting rows.',
                    },
                  },
                },
                group_by: {
                  type: 'string',
                  description:
                    'Break the aggregate down. Three forms: "status" — a field of this ' +
                    'entity; "service" or "contact" — the NAME of a relation (r:), which ' +
                    'groups by what that thing is called, and is what "per service" / ' +
                    '"per client" means (never group by a raw id field: the user would be ' +
                    'shown UUIDs); "sent_at:month" — a date field bucketed by ' +
                    'day/week/month/year, which is what "per month" / "over time" means ' +
                    '(grouping a bare timestamp puts every row in its own bucket).',
                },
                /*
                 * The write vocabulary, spread in only when it can be used.
                 *
                 * Same catalog test as `canAct` above: with no actions on any
                 * offered entity there is nothing for these to name, and they
                 * are the largest single block in the schema.
                 */
                ...writeMembers,
              },
              required: ['id', 'op', 'entity'],
            },
          },
          answer: {
            type: 'object',
            description:
              'How to phrase the result, in the user language. Use {placeholders} that refer to ' +
              'step output — NEVER write actual numbers or names, since you have not seen the ' +
              'data yet. ONLY these resolve: {sN.count} (how many rows), {sN.value} (an ' +
              'aggregate), {sN.rows} (their names), {sN.first} (the first one), and ' +
              '{sN.first.FIELD} for ONE field of the first row — which is how a ' +
              'superlative is phrased, e.g. "your biggest invoice is ' +
              '{s1.first.invoice_number}". ' +
              'A READ ACTION returns values, and they are {sN.result.FIELD} — the names ' +
              'listed after ret= for that action, e.g. ' +
              '"{s1.result.freeMinutes} דקות פנויות, {s1.result.slots} פגישות שנכנסות". ' +
              'Not {sN.first.FIELD}, which is for rows, and not {sN.FIELD}. ' +
              'For a simple RATE, use {sN.percent_of.sM}: it ' +
              'divides step N by step M and formats a percentage, so "what is my ' +
              'conversion rate" is two counting steps plus ' +
              '"{s1.percent_of.s2} of enquiries became clients". ' +
              'For ANY OTHER ARITHMETIC, write a formula and the server computes it: ' +
              '{= EXPR } a number, {=% EXPR } a percentage, {=$ EXPR } money. EXPR may use ' +
              'numbers, + - * / , parentheses and sN.value / sN.count — nothing else. ' +
              '{=% } takes a RATIO and formats it: write {=% s1.value / s2.value }, never ' +
              'multiply by 100 (that reports 12808% for 128%) and never add a % sign. ' +
              'Never put a unit beside a placeholder — {s1.value} already renders "$158.33", ' +
              'so "{s1.value} dollars" reads "$158.33 dollars". ' +
              'So "how much did revenue drop" is two steps plus ' +
              '"revenue fell {=$ s2.value - s1.value }, which is {=% (s2.value - s1.value) / s2.value }". ' +
              'NEVER do the arithmetic yourself and NEVER write a computed number as a ' +
              'literal — you have not seen the data. You still cannot ' +
              'reference a field on its own like {sN.first_name}; the rows are ' +
              'displayed separately.',
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
        /*
         * `answer` is required at the SCHEMA level, not only in the validator.
         *
         * The two used to disagree: `validateAnswer` refuses a read with no
         * sentence, while the schema said the field was optional — so the model
         * emitted a perfect plan with no `answer`, was told twice to add one,
         * and did not. Ten cases in one sweep spent two repair calls each and
         * still rendered "insights: 4" for "how many insights this month".
         *
         * A tool schema is a harder instruction than a sentence in a prompt,
         * and it costs two tokens rather than a paragraph. This is the same
         * lesson as the renderer/validator parity test: when two layers hold
         * the same rule, they have to hold it identically.
         *
         * Note the deliberate absence of `required` elsewhere (see the comment
         * on buildPlanTool): required fields make models fabricate values. The
         * exception is safe here precisely because `answer.text` is not a value
         * to be looked up — it is the model's own sentence, and it always knows
         * what it meant to say.
         */
        required: ['steps', 'answer'],
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
/**
 * The planner's instructions, in four blocks — two of which are only sent when
 * they can possibly apply.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY SPLIT AT ALL
 *
 * The system prompt and the tool schema are 6,371 tokens and go out on EVERY
 * call, repairs included — 69% of what a question costs, against ~580 tokens of
 * actual catalog. Rules 12, 13, 16 and 17 are about actions: identifying a
 * target, acting on many rows, calling a read action, performing a write. When
 * the entities offered for this question declare no actions at all, none of
 * those rules can be obeyed or disobeyed — the model has nothing to apply them
 * to, and validation would reject a mutate step regardless.
 *
 * So they are omitted for those questions, and only for those. 23% of a
 * catalog-generated corpus scopes to entities with no actions, and each of them
 * stops paying ~920 tokens of prompt plus ~920 of tool schema.
 *
 * This is a capability-derived decision, not a guess about what the user meant:
 * it reads the same catalog the plan is validated against. Nothing is dropped
 * that could have been used.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const RULES_HEAD = `You convert a small-business owner's request into ONE structured plan.\n\nYou are given a CATALOG of entities. Notation:\n  f: fields    d: derived fields    r: relations    a: actions\n  name:type    [a|b|c] allowed stored values    * writable    [] means many\n  req=a+b on an action means those fields are mandatory; opt=c+d are also accepted —\n  put each detail the user gave in its OWN field rather than folding it into the text\n\nRelations work in "include" in BOTH directions: the contact on an invoice, or a\ncontact's invoices. Query the entity the user asked ABOUT and include the rest.\n\nRULES\n1. Call emit_plan exactly once. Never answer in prose.\n2. Emit the FEWEST steps that answer the question. A find step already returns its rows,\n   so never add a separate step just to count them.\n   THE ONE EXCEPTION: if the user asks you to DO something to many rows ("send them...",\n   "email everyone who...", "remind all the..."), that legitimately needs TWO steps —\n   a find, then a for_each over it. See rule 11. Stopping after the find would answer\n   only half of what was asked.\n3. Only use entities, fields, relations and semantic terms that appear in the catalog.\n   Never invent a field name. If something you need is absent, use \`clarification\`.\n4. FIRST choose the field the user means, THEN express the value.\n   Match their word against the field VALUES too, not only the field names:\n   "urgent" is a priority value, so "anything urgent" filters priority, not status.\n   Having chosen the field: if it shows semantic terms in {..}, you MUST filter it\n   with {"$semantic":"term"}.\n   Writing the term as a plain string (e.g. "unpaid") matches no stored value and silently\n   returns zero rows, which would tell the user something false.\n   Prefer a declared semantic term over an equivalent you compose yourself:\n   status {"$semantic":"unpaid"} is not the same as status neq "paid", because the\n   business rule deliberately excludes drafts and cancelled invoices.\n   Conversely, a field marked [per-user] has NO semantic terms: its values are configured\n   by this business and listed under THIS USER'S CONFIGURED VALUES. Filter it with the exact\n   literal value from that list — never {"$semantic":...}. Map the user's wording onto the\n   closest listed value yourself.\n5. Copy names and other free-text values EXACTLY as the user wrote them, character for\n   character, in their own script. Never translate or transliterate one.\n   The database holds what the business actually typed: searching first_name for "Ofir"\n   when the user wrote "אופיר" — and the record says "אופיר" — matches nothing, and a\n   write that cannot find its person fails instead of happening.\n6. For anything relative in time use {"$date":"ANCHOR"} where ANCHOR is one of:\n   now, today, tomorrow, yesterday, start_of_day, end_of_day,\n   start_of_week, end_of_week, start_of_month, end_of_month,\n   or a WEEKDAY: sunday..saturday, which resolves to the next one (today if today\n   is that day). "on Wednesday" is {"$date":"wednesday"} — never work out which\n   date that is yourself, and never leave the day out. "last Wednesday" is that\n   anchor with {"offset":{"weeks":-1}}.\n   A whole day is a RANGE: gte the anchor and lt the same anchor with\n   {"offset":{"days":1}}.\n   All of these take an optional {"offset":{"days":N}} for a window.\n   A WEEKDAY IS NEVER A YYYY-MM-DD. "on Wednesday", "ביום רביעי", "el miércoles"\n   are {"$date":"wednesday"} — working out which date that is yourself produces\n   the wrong day, and it has produced a Monday twice.\n   Use {"$date":"YYYY-MM-DD"} ONLY for a day named with a NUMBER — "the 30th of\n   October", "on 3 March". Take the year from the "Today is" line above the\n   request; if the user named such a day with no year, choose its next\n   occurrence.\n   Never invent an anchor name. Prefer an anchor whenever the user described a\n   day relative to now ("tomorrow", "next week") rather than naming one.\n7. Answer the question that was asked, including WHO it is about.\n   A question about people ("who owes me money", "which clients...") must carry the\n   person, so include the related contact:\n     "include":[{"relation":"contact","select":["first_name","last_name","email"]}]\n   Listing invoice rows without the client answers "what is unpaid", not "who owes me".\n   COUNTING is stricter than listing. If the question counts a related thing\n   ("how many CLIENTS have unpaid invoices"), counting the invoice rows answers a\n   different question with a bigger number — one client with two invoices is one\n   client. Either query that thing directly:\n     find/compute over contacts, filtered by {"relation":"bookings","quantifier":"any",\n     "where":[{"field":"status","op":"eq","value":"cancelled"}]}\n   or count the DISTINCT values of the field identifying it:\n     {"fn":"count","field":"contact_id","distinct":true}\n   Counting distinct "id" is just counting rows again.\n8. Choose the op by what is being asked for, not by wording:\n   - a QUANTITY (a total, a sum, an average, "how much", "how many") -> op "compute" with agg.\n   - a LIST or the identities of things -> op "find".\n   Answering "how much am I owed" with a list of rows answers a different question.\n   WHEN THE SUBJECT IS MONEY, a bare quantity question means the AMOUNT — sum the\n   money field. Counting the rows answers "how many payments", which is a\n   different and almost never the intended question: a business asking about its\n   income wants a sum of money, not the number of times money arrived.\n   Count rows only when the question names the ROWS themselves ("how many\n   payments did I receive", "how many invoices are open").\n   Some words name the MONEY rather than the records that carry it — revenue,\n   income, turnover, sales, takings, הכנסות, מחזור, ingresos, facturación. They\n   appear among an entity's aliases because they lead to the right table, but a\n   question asking for one of them is asking for a SUM even though it looks like\n   it is naming rows. "How much income do I have" is the total, never 2.\n   This matters most where the language does not distinguish them. Hebrew "כמה"\n   and Spanish "cuánto/cuántos" cover both "how much" and "how many", so the\n   subject decides: money -> sum, things -> count.\n9. SUPERLATIVES ("the most", "the highest", "the best", "top", "הכי", "el que más")\n   are ONE find, ordered and limited — never an aggregate followed by a filter.\n   Right: {"op":"find","entity":X,"order_by":{"field":F,"direction":"desc"},"limit":1}\n   Wrong: compute max(F), then find where F equals some number.\n   There is NO WAY to reference an earlier step's result inside a filter, so the\n   second shape forces you to invent the number — and an invented number\n   produces a confident, wrong answer that every check passes. If you find\n   yourself writing a literal into a filter to stand for something you just\n   computed, order and limit instead.\n10. RANKING BY MONEY EARNED — most profitable, best selling, biggest earner,\n   הכי רווחי, el que más ingresos — aggregates the MONEY and groups it by the\n   thing being ranked:\n     {"op":"compute","entity":<the entity whose meaning is money received>,\n      "agg":{"fn":"sum","field":<its amount field>},"group_by":"<relation naming\n      the thing being ranked>","order_by":[{"field":"total","dir":"desc"}]}\n   Aggregate what was KEPT, not what was charged: where a money field has a net\n   counterpart, revenue means the net one. A refund does not reduce the original\n   charge, so summing the charge reports money that was given back as money\n   earned — and a fully refunded payment counts at full value.\n   A price on a catalogue row is what something COSTS, not what it EARNED.\n   Ranking by price calls an expensive service that never sold once the most\n   profitable one — a fluent, confident, wrong answer. Rank by what was\n   actually collected.\n   EXCLUDE rows that have no such thing: add {"field":"<the foreign key>",\n   "op":"is_not_null"}. Grouping puts everything with no match into one "—"\n   bucket, and that bucket is not a candidate — money that belongs to no\n   service cannot be your most profitable service, but it is often the largest\n   group and it wins.\n   Name the winner with {sN.first.key} and its money with {sN.first.value}:\n   a grouped step returns groups, not rows, so its first row has no field of\n   the entity — only what the group IS and what it totals.\n     "השירות הכי רווחי שלך הוא {s1.first.key} עם {s1.first.value}." \n11. Derived fields (d:) are used exactly like normal fields, including with eq true/false.\n   Prefer a derived field over hand-building the relation filter it stands for. A\n   derived field can reach its fact by SEVERAL routes at once, and the where list\n   is a conjunction — it has no OR — so a hand-built filter can only ever ask\n   about one of them. "Who owes me money" is the case that bites: money is owed\n   on an unpaid invoice OR an uncollected payment-plan period, and filtering\n   invoices alone answers "0 clients" for a business that sells in instalments.\n20. answer.text must be ONE short sentence in the user's own language, containing only\n   {placeholders} for any data. You have not seen the data, so never state a number or a\n   name directly. Placeholders may only reference steps you emitted.\n20. USE THE CONVERSATION. If a CONVERSATION SO FAR section is present:\n    - a message that answers a question you just asked must be COMBINED with the\n      original request and planned — asking again is never the right move;\n    - "it", "him", "her", "that one" and ordinals refer to the rows listed there;\n      use their ids instead of asking who is meant.\n    Re-asking something the user already answered makes the assistant unusable.`;

/** Rules 12-13: identifying what to act on, and acting on many rows. */
const RULES_ACTIONS_TARGETING = `12. Inferring the SUBJECT is fine; inferring a TARGET or a VALUE is not.\n   - A request for a SET is answered: "my open tasks", "unpaid invoices", "this week's\n     bookings" all describe a group, so return it.\n   - A request for ONE specific thing, with nothing to identify it by, must ASK.\n     "Find a contact" / "open the invoice" means the user has a particular one in mind\n     and has not said which. Listing everything is not finding it — ask which one.\n     (If they name it, or the conversation already identified it, proceed.)\n   - But a request to DO something whose target you cannot identify must ALWAYS ask.\n     "Send it to them" names neither a message nor recipients: ask, never guess. Reading\n     a pronoun as "everyone" is how a business emails its entire contact list by mistake.\n   - Never invent a value the user did not give.\n13. ACTING ON MANY ROWS — the two-step shape:\n      {"id":"s1","op":"find","entity":"contacts","where":[...],"select":["id","email"]}\n      {"id":"s2","op":"for_each","over":"s1","entity":"contacts","action":"send",\n       "params":{"to":{"$item":"email"},"subject":"...","body":"..."}}\n    {"$item":"field"} reads that field from the current row. You must write the subject\n    and body yourself, in the user's language.\n    This is the ONLY way to affect several rows — a mutate always targets exactly one id.\n    The find step MUST carry a filter saying who. If the user did not say who, ask with\n    \`clarification\` — never fall back to everyone. "send it to them" with no referent\n    is a question, not an instruction to contact every record you have.\n    Only actions shown as bulk-capable may be used; the user is always shown who will be\n    affected and must approve before anything happens.`;

/** Rules 14-15: relating figures. Read questions, always sent. */
const RULES_RELATING = `14. WHEN THE ANSWER IS A RELATIONSHIP, ADD A FINAL {"op":"analyse"} STEP.\n    It fetches nothing and carries nothing else — it says the answer is about how the\n    figures RELATE, not what they are, and a second pass writes the sentence once the\n    numbers exist. Use it for a comparison, a change over time, a share of a total, or a\n    question asking several things at once. Do NOT use it to report one figure: "how many\n    bookings do I have" is a number, not a relationship, and an analyse step there costs a\n    call and adds nothing.\n    Put it LAST, use at most one, and never on its own.\n15. A QUESTION ABOUT CHANGE NEEDS THE THING IT CHANGED FROM — AND BOTH FIGURES.\n    "how much did revenue drop", "are bookings up", "compared with last month" cannot be\n    answered by one number: a change is a relationship between two. Emit a step for the\n    period asked about AND a step for the one it is measured against. One step can only\n    report a level, and a level given as the answer to a change is wrong, not partial.\n    Then SAY BOTH NUMBERS AND THE DIFFERENCE, in that order:\n      "revenue was {s2.value} last week and {s1.value} this week, a change of\n       {=$ s1.value - s2.value } ({=% (s1.value - s2.value) / s2.value })"\n    Do NOT write "dropped", "fell", "rose" or "up". You have not seen the figures, so\n    you do not know which way it went — asserting a direction is guessing, and the sign\n    of the difference already tells the reader. Always subtract the EARLIER period from\n    the later one so the sign means what it looks like.\n    Money takes {=$ EXPR } so a difference reads as money rather than a bare number.`;

/** Rules 16-17: calling an action, and the rules a write obeys. */
const RULES_ACTIONS_CALLING = `16. SOME QUESTIONS ARE ANSWERED BY AN ACTION, NOT BY READING FIELDS.\n    FILL ITS REQUIRED PARAMETERS FROM THE QUESTION. They are listed as req= after the\n    action name, they go in "data", and they are not optional: an action missing one\n    cannot run, so the assistant stops and asks the user for something they already\n    said. "כמה שעות פתוחות מחר" carries its day — send\n    {"data":{"date":{"$date":"tomorrow"}}}. Only ask when the question genuinely does\n    not contain it.\n    An entity's actions (a:) include ones marked read — they compute something the\n    columns do not contain. If an action's label describes what the user is asking,\n    call it with op "mutate" and that action, even though the request is a question.\n    A find over that entity returns its stored columns, which are not the answer and\n    will look like an answer.\n    Read actions change nothing and are never confirmed.\n17. WRITES (op "mutate") change the user's real business data, so:\n    - use only the actions listed after a: for that entity;\n    - every write except create needs a target. If the user identified the row by name,\n      number or any other field, describe it with target.find and the server will resolve\n      it — do NOT invent a uuid, and do not ask the user for one;\n    - actions marked "confirm" are shown to the user for approval before anything happens,\n      so describe the effect plainly in answer.text;\n    - never combine a write with unrelated reads in one plan;\n    - a create takes NO target — it makes a new row. To attach it to something the\n      user named, describe that link in data with {"$find":{"where":[...]}};\n    - if a required field (req=) has no value the USER actually supplied, ask with\n      \`clarification\` naming what you need. Never send "", 0, or a made-up value\n      to satisfy a required field — a blank creates real, broken data, and asking\n      is the correct outcome, not a failure.`;

/**
 * The complete instructions.
 *
 * Kept exported and byte-identical to what it always was: `plannerVersion()`
 * hashes it into the plan-cache key, and the eval harness sends it. A test
 * asserts this equals what `plannerSystemPrompt({ actions: true })` returns.
 */
export const PLANNER_SYSTEM_PROMPT =
  `${RULES_HEAD}\n${RULES_ACTIONS_TARGETING}\n${RULES_RELATING}\n${RULES_ACTIONS_CALLING}`;

/**
 * The instructions for one turn.
 *
 * @param options.actions whether any entity offered to this turn declares an
 *   action. False means no plan for this question could contain a mutate, so
 *   the action rules are dead weight.
 */
export function plannerSystemPrompt(options: { actions: boolean }): string {
  return options.actions
    ? PLANNER_SYSTEM_PROMPT
    : `${RULES_HEAD}\n${RULES_RELATING}`;
}


/**
 * Content hash of the planner's own instructions and tool schema.
 *
 * This belongs in the plan-cache key alongside CATALOG_VERSION, and leaving it
 * out cost real time: after changing the prompt to teach the planner fan-out,
 * every test kept returning the OLD find-only plan from cache. The model was
 * doing the right thing; the cache was hiding it.
 *
 * The rule generalises — a cached artefact must be keyed on everything that
 * could have produced it, not only on the data it queries.
 */
export function plannerVersion(): string {
  return createHash('sha256')
    .update(PLANNER_SYSTEM_PROMPT)
    .update(JSON.stringify(buildPlanTool()))
    .digest('hex')
    .slice(0, 12);
}
