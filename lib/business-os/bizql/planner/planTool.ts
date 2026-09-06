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
              'query with different filters "just in case". ' +
              'BUT a question that asks TWO things needs a step for each, and the answer ' +
              'sentence must reference both: "how many clients owe me and what is the ' +
              'total" is a distinct count AND a sum, and answering only the first leaves ' +
              'half the question silently unanswered.',
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
                action: {
                  type: 'string',
                  description:
                    'Required for op=mutate. One of the actions listed for the entity (a:).',
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
                    'Field values for op=mutate. Only writable (*) fields. To link the ' +
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
              '{s1.first.invoice_number}". For a RATE, use {sN.percent_of.sM}: it ' +
              'divides step N by step M and formats a percentage, so "what is my ' +
              'conversion rate" is two counting steps plus ' +
              '"{s1.percent_of.s2} of enquiries became clients". You still cannot ' +
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
  req=a+b on an action means those fields are mandatory; opt=c+d are also accepted —
  put each detail the user gave in its OWN field rather than folding it into the text

Relations work in "include" in BOTH directions: the contact on an invoice, or a
contact's invoices. Query the entity the user asked ABOUT and include the rest.

RULES
1. Call emit_plan exactly once. Never answer in prose.
2. Emit the FEWEST steps that answer the question. A find step already returns its rows,
   so never add a separate step just to count them.
   THE ONE EXCEPTION: if the user asks you to DO something to many rows ("send them...",
   "email everyone who...", "remind all the..."), that legitimately needs TWO steps —
   a find, then a for_each over it. See rule 11. Stopping after the find would answer
   only half of what was asked.
3. Only use entities, fields, relations and semantic terms that appear in the catalog.
   Never invent a field name. If something you need is absent, use \`clarification\`.
4. FIRST choose the field the user means, THEN express the value.
   Match their word against the field VALUES too, not only the field names:
   "urgent" is a priority value, so "anything urgent" filters priority, not status.
   Having chosen the field: if it shows semantic terms in {..}, you MUST filter it
   with {"$semantic":"term"}.
   Writing the term as a plain string (e.g. "unpaid") matches no stored value and silently
   returns zero rows, which would tell the user something false.
   Prefer a declared semantic term over an equivalent you compose yourself:
   status {"$semantic":"unpaid"} is not the same as status neq "paid", because the
   business rule deliberately excludes drafts and cancelled invoices.
   Conversely, a field marked [per-user] has NO semantic terms: its values are configured
   by this business and listed under THIS USER'S CONFIGURED VALUES. Filter it with the exact
   literal value from that list — never {"$semantic":...}. Map the user's wording onto the
   closest listed value yourself.
5. Copy names and other free-text values EXACTLY as the user wrote them, character for
   character, in their own script. Never translate or transliterate one.
   The database holds what the business actually typed: searching first_name for "Ofir"
   when the user wrote "אופיר" — and the record says "אופיר" — matches nothing, and a
   write that cannot find its person fails instead of happening.
6. For anything relative in time use {"$date":"ANCHOR"} where ANCHOR is one of:
   now, today, tomorrow, yesterday, start_of_day, end_of_day,
   start_of_week, end_of_week, start_of_month, end_of_month.
   Never invent an anchor name and never hardcode a calendar date.
7. Answer the question that was asked, including WHO it is about.
   A question about people ("who owes me money", "which clients...") must carry the
   person, so include the related contact:
     "include":[{"relation":"contact","select":["first_name","last_name","email"]}]
   Listing invoice rows without the client answers "what is unpaid", not "who owes me".
   COUNTING is stricter than listing. If the question counts a related thing
   ("how many CLIENTS have unpaid invoices"), counting the invoice rows answers a
   different question with a bigger number — one client with two invoices is one
   client. Either query that thing directly:
     find/compute over contacts, filtered by {"relation":"bookings","quantifier":"any",
     "where":[{"field":"status","op":"eq","value":"cancelled"}]}
   or count the DISTINCT values of the field identifying it:
     {"fn":"count","field":"contact_id","distinct":true}
   Counting distinct "id" is just counting rows again.
8. Choose the op by what is being asked for, not by wording:
   - a QUANTITY (a total, a sum, an average, "how much", "how many") -> op "compute" with agg.
   - a LIST or the identities of things -> op "find".
   Answering "how much am I owed" with a list of rows answers a different question.
   WHEN THE SUBJECT IS MONEY, a bare quantity question means the AMOUNT — sum the
   money field. Counting the rows answers "how many payments", which is a
   different and almost never the intended question: a business asking about its
   income wants a sum of money, not the number of times money arrived.
   Count rows only when the question names the ROWS themselves ("how many
   payments did I receive", "how many invoices are open").
   Some words name the MONEY rather than the records that carry it — revenue,
   income, turnover, sales, takings, הכנסות, מחזור, ingresos, facturación. They
   appear among an entity's aliases because they lead to the right table, but a
   question asking for one of them is asking for a SUM even though it looks like
   it is naming rows. "How much income do I have" is the total, never 2.
   This matters most where the language does not distinguish them. Hebrew "כמה"
   and Spanish "cuánto/cuántos" cover both "how much" and "how many", so the
   subject decides: money -> sum, things -> count.
9. SUPERLATIVES ("the most", "the highest", "the best", "top", "הכי", "el que más")
   are ONE find, ordered and limited — never an aggregate followed by a filter.
   Right: {"op":"find","entity":X,"order_by":{"field":F,"direction":"desc"},"limit":1}
   Wrong: compute max(F), then find where F equals some number.
   There is NO WAY to reference an earlier step's result inside a filter, so the
   second shape forces you to invent the number — and an invented number
   produces a confident, wrong answer that every check passes. If you find
   yourself writing a literal into a filter to stand for something you just
   computed, order and limit instead.
10. RANKING BY MONEY EARNED — most profitable, best selling, biggest earner,
   הכי רווחי, el que más ingresos — aggregates the MONEY and groups it by the
   thing being ranked:
     {"op":"compute","entity":<the entity whose meaning is money received>,
      "agg":{"fn":"sum","field":<its amount field>},"group_by":"<relation naming
      the thing being ranked>","order_by":[{"field":"total","dir":"desc"}]}
   Aggregate what was KEPT, not what was charged: where a money field has a net
   counterpart, revenue means the net one. A refund does not reduce the original
   charge, so summing the charge reports money that was given back as money
   earned — and a fully refunded payment counts at full value.
   A price on a catalogue row is what something COSTS, not what it EARNED.
   Ranking by price calls an expensive service that never sold once the most
   profitable one — a fluent, confident, wrong answer. Rank by what was
   actually collected.
   EXCLUDE rows that have no such thing: add {"field":"<the foreign key>",
   "op":"is_not_null"}. Grouping puts everything with no match into one "—"
   bucket, and that bucket is not a candidate — money that belongs to no
   service cannot be your most profitable service, but it is often the largest
   group and it wins.
   Name the winner with {sN.first.key} and its money with {sN.first.value}:
   a grouped step returns groups, not rows, so its first row has no field of
   the entity — only what the group IS and what it totals.
     "השירות הכי רווחי שלך הוא {s1.first.key} עם {s1.first.value}." 
11. Derived fields (d:) are used exactly like normal fields, including with eq true/false.
   Prefer a derived field over hand-building the relation filter it stands for. A
   derived field can reach its fact by SEVERAL routes at once, and the where list
   is a conjunction — it has no OR — so a hand-built filter can only ever ask
   about one of them. "Who owes me money" is the case that bites: money is owed
   on an unpaid invoice OR an uncollected payment-plan period, and filtering
   invoices alone answers "0 clients" for a business that sells in instalments.
20. answer.text must be ONE short sentence in the user's own language, containing only
   {placeholders} for any data. You have not seen the data, so never state a number or a
   name directly. Placeholders may only reference steps you emitted.
20. USE THE CONVERSATION. If a CONVERSATION SO FAR section is present:
    - a message that answers a question you just asked must be COMBINED with the
      original request and planned — asking again is never the right move;
    - "it", "him", "her", "that one" and ordinals refer to the rows listed there;
      use their ids instead of asking who is meant.
    Re-asking something the user already answered makes the assistant unusable.
12. Inferring the SUBJECT is fine; inferring a TARGET or a VALUE is not.
   - A request for a SET is answered: "my open tasks", "unpaid invoices", "this week's
     bookings" all describe a group, so return it.
   - A request for ONE specific thing, with nothing to identify it by, must ASK.
     "Find a contact" / "open the invoice" means the user has a particular one in mind
     and has not said which. Listing everything is not finding it — ask which one.
     (If they name it, or the conversation already identified it, proceed.)
   - But a request to DO something whose target you cannot identify must ALWAYS ask.
     "Send it to them" names neither a message nor recipients: ask, never guess. Reading
     a pronoun as "everyone" is how a business emails its entire contact list by mistake.
   - Never invent a value the user did not give.
13. ACTING ON MANY ROWS — the two-step shape:
      {"id":"s1","op":"find","entity":"contacts","where":[...],"select":["id","email"]}
      {"id":"s2","op":"for_each","over":"s1","entity":"contacts","action":"send",
       "params":{"to":{"$item":"email"},"subject":"...","body":"..."}}
    {"$item":"field"} reads that field from the current row. You must write the subject
    and body yourself, in the user's language.
    This is the ONLY way to affect several rows — a mutate always targets exactly one id.
    The find step MUST carry a filter saying who. If the user did not say who, ask with
    \`clarification\` — never fall back to everyone. "send it to them" with no referent
    is a question, not an instruction to contact every record you have.
    Only actions shown as bulk-capable may be used; the user is always shown who will be
    affected and must approve before anything happens.
14. WRITES (op "mutate") change the user's real business data, so:
    - use only the actions listed after a: for that entity;
    - every write except create needs a target. If the user identified the row by name,
      number or any other field, describe it with target.find and the server will resolve
      it — do NOT invent a uuid, and do not ask the user for one;
    - actions marked "confirm" are shown to the user for approval before anything happens,
      so describe the effect plainly in answer.text;
    - never combine a write with unrelated reads in one plan;
    - a create takes NO target — it makes a new row. To attach it to something the
      user named, describe that link in data with {"$find":{"where":[...]}};
    - if a required field (req=) has no value the USER actually supplied, ask with
      \`clarification\` naming what you need. Never send "", 0, or a made-up value
      to satisfy a required field — a blank creates real, broken data, and asking
      is the correct outcome, not a failure.`;

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
