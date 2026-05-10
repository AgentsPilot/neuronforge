/**
 * DataSchemaBuilder — WP-15 nested NestedFieldSpec walk (2026-05-10)
 *
 * Unit tests for the recursive items/properties walk in
 * `inferSchemaForGenerateStep()` and `inferSchemaForExtractStep()`.
 *
 * Background: the IntentContract grammar at
 * `lib/agentkit/v6/semantic-plan/types/intent-schema-types.ts` was extended
 * (task 0.4) so that `extract.fields[]` and `generate.outputs[]` can declare
 * nested `items` (when type='array') and nested `properties` (when type='object').
 *
 * Without this walk, the builder produced depth-1 SchemaFields like
 * `{rows: {type: "array"}}` with no item shape — forcing the compiler's
 * auto-repair safety net to fire and silently degrade to `items:{type:"any"}`.
 *
 * These tests verify:
 * (a) Generate step with nested array-of-object outputs preserves item shape end-to-end.
 * (b) Extract step with nested array-of-object fields preserves item shape end-to-end.
 * (c) Nested properties (object inside object) walk correctly.
 * (d) Mixed scalars and nested fields coexist in the same outputs[] / fields[].
 * (e) When the LLM declares array WITHOUT items (the WP-15 failure mode), the
 *     builder emits a permissive items:{type:"any"} fallback AND a warning so
 *     the W5 measurement can count residual firings.
 * (f) When the LLM declares object WITHOUT properties, same fallback + warning.
 * (g) `source: "ai_declared"` is propagated through all nested levels.
 *
 * Tests exercise the `inferSchema()` private method directly via cast — the
 * recursive helper has no upstream-slot dependency, so this is a clean test.
 */

import { DataSchemaBuilder } from '../DataSchemaBuilder';
import type { BoundStep } from '../CapabilityBinderV2';
import type { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

const stubPluginManager = {
  getPluginDefinition: (_key: string) => null,
} as unknown as PluginManagerV2;

function makeBuilder(): DataSchemaBuilder {
  return new DataSchemaBuilder(stubPluginManager);
}

function makeStep(partial: any): BoundStep {
  return partial as BoundStep;
}

// Walks the builder's internal warnings array (private). Tests use this to
// assert that the LLM-misuse fallback emits the expected diagnostic.
function getWarnings(builder: DataSchemaBuilder): string[] {
  return (builder as any).warnings as string[];
}

// ─── Generate step: nested array of objects ─────────────────────────────────

describe('WP-15 generate step — nested array-of-object outputs', () => {
  it('preserves array item shape (canonical complaint-logger pattern)', () => {
    const builder = makeBuilder();
    const step = makeStep({
      id: 'build_rows',
      kind: 'generate',
      summary: 'Build candidate rows from complaint emails',
      output: 'candidate_rows',
      generate: {
        instruction: 'For each complaint email, build a row...',
        outputs: [
          {
            name: 'rows',
            type: 'array',
            description: 'One row per complaint email',
            items: {
              type: 'object',
              properties: {
                sender_email: { type: 'string', description: 'Email of the complainer' },
                subject: { type: 'string' },
                date: { type: 'date' },
                full_email_text: { type: 'string' },
                gmail_message_link_id: { type: 'string' },
              },
            },
          },
        ],
      },
    });

    const schema = (builder as any).inferSchemaForGenerateStep(step);

    expect(schema).toBeDefined();
    expect(schema.type).toBe('object');
    expect(schema.source).toBe('ai_declared');
    expect(schema.properties).toBeDefined();

    const rowsField = schema.properties.rows;
    expect(rowsField.type).toBe('array');
    expect(rowsField.source).toBe('ai_declared');
    expect(rowsField.description).toBe('One row per complaint email');
    expect(rowsField.items).toBeDefined();
    expect(rowsField.items.type).toBe('object');
    expect(rowsField.items.source).toBe('ai_declared');

    // All 5 fields should be in the items.properties.
    expect(rowsField.items.properties).toBeDefined();
    expect(rowsField.items.properties).toHaveProperty('sender_email');
    expect(rowsField.items.properties).toHaveProperty('subject');
    expect(rowsField.items.properties).toHaveProperty('date');
    expect(rowsField.items.properties).toHaveProperty('full_email_text');
    expect(rowsField.items.properties).toHaveProperty('gmail_message_link_id');

    // sender_email keeps its description and ai_declared source.
    expect(rowsField.items.properties.sender_email.type).toBe('string');
    expect(rowsField.items.properties.sender_email.description).toBe('Email of the complainer');
    expect(rowsField.items.properties.sender_email.source).toBe('ai_declared');

    // date type maps from "date" → "string" (mapExtractType behavior).
    expect(rowsField.items.properties.date.type).toBe('string');
  });

  it('preserves source="ai_declared" through all nesting levels', () => {
    const builder = makeBuilder();
    const step = makeStep({
      id: 'gen',
      kind: 'generate',
      output: 'out',
      generate: {
        instruction: 't',
        outputs: [
          {
            name: 'matrix',
            type: 'array',
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: { val: { type: 'number' } },
              },
            },
          },
        ],
      },
    });

    const schema = (builder as any).inferSchemaForGenerateStep(step);
    expect(schema.source).toBe('ai_declared');
    expect(schema.properties.matrix.source).toBe('ai_declared');
    expect(schema.properties.matrix.items.source).toBe('ai_declared');
    expect(schema.properties.matrix.items.items.source).toBe('ai_declared');
    expect(schema.properties.matrix.items.items.properties.val.source).toBe('ai_declared');
  });

  it('mixes scalar and nested outputs in the same outputs[]', () => {
    const builder = makeBuilder();
    const step = makeStep({
      id: 'gen',
      kind: 'generate',
      output: 'out',
      generate: {
        instruction: 't',
        outputs: [
          { name: 'title', type: 'string', description: 'just a string' },
          {
            name: 'rows',
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' } },
            },
          },
          { name: 'count', type: 'number' },
        ],
      },
    });

    const schema = (builder as any).inferSchemaForGenerateStep(step);
    expect(schema.properties.title.type).toBe('string');
    expect(schema.properties.title.description).toBe('just a string');
    expect(schema.properties.rows.type).toBe('array');
    expect(schema.properties.rows.items.properties.id.type).toBe('string');
    expect(schema.properties.count.type).toBe('number');
  });

  it('walks nested object (object inside object) via properties', () => {
    const builder = makeBuilder();
    const step = makeStep({
      id: 'gen',
      kind: 'generate',
      output: 'out',
      generate: {
        instruction: 't',
        outputs: [
          {
            name: 'envelope',
            type: 'object',
            properties: {
              meta: {
                type: 'object',
                properties: {
                  source: { type: 'string' },
                  timestamp: { type: 'string' },
                },
              },
              payload: { type: 'string' },
            },
          },
        ],
      },
    });

    const schema = (builder as any).inferSchemaForGenerateStep(step);
    const envelope = schema.properties.envelope;
    expect(envelope.type).toBe('object');
    expect(envelope.properties.meta.type).toBe('object');
    expect(envelope.properties.meta.properties.source.type).toBe('string');
    expect(envelope.properties.meta.properties.timestamp.type).toBe('string');
    expect(envelope.properties.payload.type).toBe('string');
  });

  it('returns string schema when generate has no outputs (freeform text)', () => {
    const builder = makeBuilder();
    const step = makeStep({
      id: 'gen',
      kind: 'generate',
      output: 'out',
      generate: { instruction: 'compose an email body' },
    });
    const schema = (builder as any).inferSchemaForGenerateStep(step);
    expect(schema.type).toBe('string');
    expect(schema.source).toBe('ai_declared');
  });
});

// ─── Extract step: nested array of objects ──────────────────────────────────

describe('WP-15 extract step — nested array-of-object fields', () => {
  it('preserves nested item shape on extract.fields[] (invoice line items pattern)', () => {
    const builder = makeBuilder();
    const step = makeStep({
      id: 'extract_invoice',
      kind: 'extract',
      output: 'invoice_data',
      extract: {
        input: 'invoice_pdf',
        fields: [
          { name: 'invoice_number', type: 'string', required: true },
          { name: 'total_amount', type: 'currency', required: true },
          {
            name: 'line_items',
            type: 'array',
            required: false,
            description: 'Each line on the invoice',
            items: {
              type: 'object',
              properties: {
                sku: { type: 'string' },
                qty: { type: 'number' },
                unit_price: { type: 'currency' },
                subtotal: { type: 'currency' },
              },
            },
          },
        ],
      },
    });

    const schema = (builder as any).inferSchemaForExtractStep(step);
    expect(schema.type).toBe('object');
    expect(schema.source).toBe('ai_declared');

    expect(schema.properties.invoice_number.type).toBe('string');
    expect(schema.properties.invoice_number.required).toBe(true);
    expect(schema.properties.total_amount.type).toBe('string');     // currency → string
    expect(schema.properties.total_amount.required).toBe(true);

    const lineItems = schema.properties.line_items;
    expect(lineItems.type).toBe('array');
    expect(lineItems.required).toBe(false);
    expect(lineItems.description).toBe('Each line on the invoice');
    expect(lineItems.items).toBeDefined();
    expect(lineItems.items.type).toBe('object');
    expect(lineItems.items.properties.sku.type).toBe('string');
    expect(lineItems.items.properties.qty.type).toBe('number');
    expect(lineItems.items.properties.unit_price.type).toBe('string'); // currency → string
    expect(lineItems.items.properties.subtotal.type).toBe('string');
  });

  it('returns null with warning when extract has no fields', () => {
    const builder = makeBuilder();
    const step = makeStep({
      id: 'extract',
      kind: 'extract',
      output: 'out',
      extract: { input: 'doc', fields: [] },
    });
    const schema = (builder as any).inferSchemaForExtractStep(step);
    expect(schema).toBeNull();
    expect(getWarnings(builder).some(w => w.includes('extract step has no fields declared'))).toBe(true);
  });
});

// ─── Failure-mode: shallow LLM declarations now THROW (RETIRE-1, 2026-05-10) ───
//
// Behavior changed from warn-and-fallback to throw-on-violation after CP-D
// verified 0/10 firings of the safety net across the regression suite. The
// old `items:{type:"any"}` / `properties:{}` auto-fill is gone. To revert,
// restore the warn-and-fallback branches in
// `DataSchemaBuilder.buildSchemaFromNestedFieldSpec`.

describe('WP-15 RETIRE-1: shallow LLM declarations throw at the builder', () => {
  it('throws when generate.outputs[] has type:"array" without items', () => {
    const builder = makeBuilder();
    const step = makeStep({
      id: 'gen',
      kind: 'generate',
      output: 'out',
      generate: {
        instruction: 'build rows',
        outputs: [
          { name: 'rows', type: 'array', description: 'shallow' }, // <-- missing items
        ],
      },
    });

    expect(() => (builder as any).inferSchemaForGenerateStep(step))
      .toThrow(/field "rows" declared as array without "items"/);
    expect(() => (builder as any).inferSchemaForGenerateStep(step))
      .toThrow(/RETIRE-1/);
  });

  it('throws when generate.outputs[] has type:"object" without properties', () => {
    const builder = makeBuilder();
    const step = makeStep({
      id: 'gen',
      kind: 'generate',
      output: 'out',
      generate: {
        instruction: 'build envelope',
        outputs: [
          { name: 'envelope', type: 'object', description: 'shallow obj' }, // <-- missing properties
        ],
      },
    });

    expect(() => (builder as any).inferSchemaForGenerateStep(step))
      .toThrow(/field "envelope" declared as object without "properties"/);
  });

  it('throws on extract.fields[] with type:"array" without items', () => {
    const builder = makeBuilder();
    const step = makeStep({
      id: 'extract',
      kind: 'extract',
      output: 'out',
      extract: {
        input: 'doc',
        fields: [
          { name: 'tags', type: 'array' }, // missing items
        ],
      },
    });

    expect(() => (builder as any).inferSchemaForExtractStep(step))
      .toThrow(/field "tags" declared as array without "items"/);
  });

  it('throws with dotted path for nested shallow fields', () => {
    const builder = makeBuilder();
    const step = makeStep({
      id: 'gen',
      kind: 'generate',
      output: 'out',
      generate: {
        instruction: 't',
        outputs: [
          {
            name: 'envelope',
            type: 'object',
            properties: {
              tags: { type: 'array' }, // <-- nested shallow array
            },
          },
        ],
      },
    });

    expect(() => (builder as any).inferSchemaForGenerateStep(step))
      .toThrow(/field "envelope\.tags" declared as array without "items"/);
  });
});
