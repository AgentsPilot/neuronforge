/**
 * IntentToIRConverter — P3.2 (EP required-plugin-param cycle, df67bf69 topic-drop RCA)
 *
 * Verifies `bindSearchSubjectToRequiredParam`: a free-text search subject (arriving
 * as `query`) is bound to the bound action's SINGLE unbound required string param
 * when the schema has no `query` property (so schema-mapping would otherwise drop it,
 * yielding `params:{}` → runtime "<param> is required"). Schema-driven + plugin-
 * agnostic; never guesses when the target is ambiguous (Principle 2 / Anti-pattern C).
 *
 * Exercises the private method directly (per the wp33 test's convention) — wiring a
 * full BoundIntentContract buys little for a single-method change.
 */

import { IntentToIRConverter } from '../IntentToIRConverter';

function newCtx(): any {
  return { nodeCounter: 0, nodes: new Map(), variableMap: new Map(), artifactMetadata: new Map(), startNode: null, errors: [], warnings: [] };
}

function bind(finalParams: any, genericParams: any, schema: any) {
  const ctx = newCtx();
  const step: any = { plugin_key: 'p', action: 'a' };
  const converter = new IntentToIRConverter();
  (converter as any).bindSearchSubjectToRequiredParam(finalParams, genericParams, schema, step, ctx);
  return { finalParams, warnings: ctx.warnings };
}

// research_topic-shaped schema: required string `topic`, NO `query` property.
const researchSchema = {
  parameters: {
    properties: { topic: { type: 'string', minLength: 3, maxLength: 500 }, depth: { type: 'string' } },
    required: ['topic'],
  },
};

describe('P3.2 — bindSearchSubjectToRequiredParam', () => {
  it('binds a dropped search subject to the single unbound required string param (the df67bf69 fix)', () => {
    const { finalParams } = bind({}, { query: 'retail solutions in Israel' }, researchSchema);
    expect(finalParams).toEqual({ topic: 'retail solutions in Israel' });
  });

  it('leaves an action that HAS a `query` param untouched (query is used normally)', () => {
    const schema = { parameters: { properties: { query: { type: 'string' } }, required: ['query'] } };
    const { finalParams } = bind({ query: 'x' }, { query: 'x' }, schema);
    expect(finalParams).toEqual({ query: 'x' });
  });

  it('does NOT guess when the target is ambiguous (≥2 unbound required strings)', () => {
    const schema = { parameters: { properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a', 'b'] } };
    const { finalParams, warnings } = bind({}, { query: 'z' }, schema);
    expect(finalParams).toEqual({});
    expect(warnings.join(' ')).toMatch(/Ambiguous/i);
  });

  it('is a no-op when the required param is already bound', () => {
    const { finalParams } = bind({ topic: 'kept' }, { query: 'z' }, researchSchema);
    expect(finalParams).toEqual({ topic: 'kept' });
  });

  it('does not bind a literal shorter than minLength (records a warning)', () => {
    const { finalParams, warnings } = bind({}, { query: 'ab' }, researchSchema);
    expect(finalParams).toEqual({});
    expect(warnings.join(' ')).toMatch(/length bounds/i);
  });

  it('binds a {{ref}} value without applying the literal length gate', () => {
    const { finalParams } = bind({}, { query: '{{input.subject}}' }, researchSchema);
    expect(finalParams).toEqual({ topic: '{{input.subject}}' });
  });

  it('is a no-op when there is no search subject', () => {
    const { finalParams } = bind({}, {}, researchSchema);
    expect(finalParams).toEqual({});
  });

  it('never binds a non-string required param (only string targets)', () => {
    const schema = { parameters: { properties: { count: { type: 'number' } }, required: ['count'] } };
    const { finalParams } = bind({}, { query: 'z' }, schema);
    expect(finalParams).toEqual({});
  });

  // Guards against the schema being modeled wrong: run P3.2 against the ACTUAL
  // chatgpt-research/research_topic definition, not a hand-authored fixture.
  it("binds against the real chatgpt-research/research_topic schema (the df67bf69 shape)", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pluginDef = require('../../../../plugins/definitions/chatgpt-research-plugin-v2.json');
    const realSchema = pluginDef.actions.research_topic; // { parameters: { properties, required:['topic'] } }
    expect(realSchema.parameters.properties.query).toBeUndefined(); // precondition: query is dropped
    const { finalParams } = bind({}, { query: 'retail solutions in Israel' }, realSchema);
    expect(finalParams.topic).toBe('retail solutions in Israel');
  });
});
