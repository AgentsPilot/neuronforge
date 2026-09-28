/**
 * Making the plan schema enforceable rather than advisory.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MEASUREMENT THIS EXISTS TO SERVE
 *
 * 14 of 32 validation problems across 19 planner turns were `answer.text is
 * required` — for a field the schema has always listed in `required`. Without
 * `strict: true` a provider treats `required` as a suggestion, so each of those
 * cost a full repair round trip to obtain one sentence already demanded.
 *
 * The transform must change ONLY enforceability. If it also changed an enum, a
 * description or the shape of a member, then measuring strict against loose
 * would be measuring two things and attributing the result to one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { buildPlanTool, toStrictSchema } from '../planner/planTool';

describe('toStrictSchema', () => {
  it('requires every property and forbids extras', () => {
    const out = toStrictSchema({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a'],
    });

    expect(out.required).toEqual(['a', 'b']);
    expect(out.additionalProperties).toBe(false);
  });

  it('makes a newly-required property nullable, so nothing is invented', () => {
    /*
     * The whole reason this is safe. A property the model has nothing to say
     * about is emitted as null, which downstream already treats as absent —
     * rather than as a placeholder value, which is how a task was once created
     * titled "new task".
     */
    const out = toStrictSchema({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a'],
    });
    const props = out.properties as Record<string, { type: unknown }>;

    expect(props.a.type).toBe('string');
    expect(props.b.type).toEqual(['number', 'null']);
  });

  it('leaves an already-nullable property alone', () => {
    const out = toStrictSchema({
      type: 'object',
      properties: { a: { type: ['string', 'null'] } },
    });
    expect((out.properties as Record<string, { type: unknown }>).a.type).toEqual(['string', 'null']);
  });

  it('leaves a deliberately untyped property untyped', () => {
    // `value` is any of a literal, an array, or a {$date} object. There is no
    // single type to union null into, and strict mode accepts an untyped member.
    const out = toStrictSchema({
      type: 'object',
      properties: { value: { description: 'anything' } },
    });
    expect((out.properties as Record<string, object>).value).not.toHaveProperty('type');
    expect(out.required).toEqual(['value']);
  });

  it('reaches nested objects and arrays of objects', () => {
    const out = toStrictSchema({
      type: 'object',
      properties: {
        steps: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } },
      },
    });
    const items = (out.properties as { steps: { items: Record<string, unknown> } }).steps.items;
    expect(items.required).toEqual(['id']);
    expect(items.additionalProperties).toBe(false);
  });

  it('changes nothing semantic', () => {
    const out = toStrictSchema({
      type: 'object',
      properties: { op: { type: 'string', enum: ['find', 'compute'], description: 'keep me' } },
    });
    const op = (out.properties as Record<string, Record<string, unknown>>).op;
    expect(op.enum).toEqual(['find', 'compute']);
    expect(op.description).toBe('keep me');
  });
});

describe('the plan tool', () => {
  it('is advisory by default, so nothing changes until the flag is turned on', () => {
    const tool = buildPlanTool();
    expect(tool.function.strict).toBeUndefined();
    expect((tool.function.parameters as { additionalProperties?: unknown }).additionalProperties)
      .toBeUndefined();
  });

  it('declares strict and an enforceable schema when asked', () => {
    const tool = buildPlanTool(undefined, { strict: true });
    const params = tool.function.parameters as Record<string, unknown>;

    expect(tool.function.strict).toBe(true);
    expect(params.additionalProperties).toBe(false);
    // The field that cost 14 repairs stays required, and now it is enforced.
    expect(params.required).toEqual(expect.arrayContaining(['steps', 'answer']));
  });

  it('keeps the same entity and operator vocabularies under strict', () => {
    // The two shapes must be comparable, or a measurement of one tells you
    // nothing about the other.
    const loose = JSON.stringify(buildPlanTool(['invoices']));
    const strict = JSON.stringify(buildPlanTool(['invoices'], { strict: true }));

    for (const token of ['"invoices"', '"find"', '"compute"', '"emit_plan"']) {
      expect(loose).toContain(token);
      expect(strict).toContain(token);
    }
  });
});
