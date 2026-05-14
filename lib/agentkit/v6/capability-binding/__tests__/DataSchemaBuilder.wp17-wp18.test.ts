/**
 * DataSchemaBuilder — WP-17 + WP-18 fixes (2026-05-08)
 *
 * Unit tests for the four bug fixes shipped together in DataSchemaBuilder.ts:
 *
 * WP-17 Bug A: nested-array unwrap in buildLoopSlots — when a loop's `over`
 *   slot is a wrapper-object containing one nested array (e.g., Gmail
 *   search results `{emails: array, total_found, ...}`), the item_ref slot
 *   should derive its schema from the nested array's `items`, not from
 *   the wrapper itself.
 *
 * WP-17 Bug B: multi-loop item_ref collision — when multiple loops share
 *   the same `item_ref` name (canonical pattern: mark_emails_read +
 *   apply_label_to_emails), the slot should NOT be overwritten. Instead,
 *   produced_by_loops[] tracks all contributing loop step IDs.
 *
 * WP-18 Bug A: honor LLM-declared transform.output_schema on shape-preserving
 *   ops — when the LLM has declared an output_schema, it wins over the
 *   "inherit input schema" heuristic.
 *
 * WP-18 Bug B: unwrap wrapper-object input in shape-preserving inheritance —
 *   when filter/sort/dedupe inherits from a wrapper-object input, walk into
 *   the wrapper to find the nested array (mirroring the Phase 4 compiler's
 *   rows_to_objects auto-inject, but at the schema level).
 *
 * Tests use the public `build()` entry point with crafted BoundStep arrays.
 */

import { DataSchemaBuilder } from '../DataSchemaBuilder';
import type { BoundStep } from '../CapabilityBinderV2';
import type { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

// Minimal PluginManagerV2 stub — none of the WP-17/WP-18 cases require plugin lookups
// (they all derive schemas from upstream slot inputs, not from plugin definitions).
const stubPluginManager = {
  getPluginDefinition: (_key: string) => null,
} as unknown as PluginManagerV2;

function makeBuilder(): DataSchemaBuilder {
  return new DataSchemaBuilder(stubPluginManager);
}

// ─── Helpers for constructing test fixtures ─────────────────────────────────

/**
 * A wrapper-object schema that mimics Gmail's search_emails output:
 * { emails: array<email>, total_found: number, search_query: string, ... }
 */
function gmailSearchResultsSchema(): any {
  return {
    type: 'object',
    source: 'plugin',
    properties: {
      emails: {
        type: 'array',
        source: 'plugin',
        items: {
          type: 'object',
          source: 'plugin',
          properties: {
            id: { type: 'string', source: 'plugin' },
            subject: { type: 'string', source: 'plugin' },
            from: { type: 'string', source: 'plugin' },
            body: { type: 'string', source: 'plugin' },
          },
        },
      },
      total_found: { type: 'number', source: 'plugin' },
      search_query: { type: 'string', source: 'plugin' },
    },
  };
}

/**
 * A wrapper-object schema that mimics Sheets read_range output:
 * { values: array<array<string>>, row_count: number, range: string, ... }
 */
function sheetsReadRangeSchema(): any {
  return {
    type: 'object',
    source: 'plugin',
    properties: {
      values: {
        type: 'array',
        source: 'plugin',
        items: {
          type: 'array',
          source: 'plugin',
          items: { type: 'string', source: 'plugin' },
        },
      },
      row_count: { type: 'number', source: 'plugin' },
      range: { type: 'string', source: 'plugin' },
    },
  };
}

/**
 * Construct a BoundStep with arbitrary fields (we cast through any to bypass
 * the strict IntentStep discriminator). Tests don't go through the real
 * binder, so plugin_key/action are usually omitted.
 */
function makeStep(partial: any): BoundStep {
  return partial as BoundStep;
}

/**
 * Pre-seed a slot in the builder's output by adding a no-op step that the
 * builder's build() will turn into a slot. We do this by injecting a
 * data_source step with a known schema directly via the builder's internal
 * state — easier path: cast the builder to any and call buildSlotsForStep.
 *
 * For test simplicity, we instead construct full step arrays and rely on
 * build()'s normal flow. The `data_source` step needs plugin info, so we
 * use a workaround: construct a transform step whose input schema is what
 * we want, then check the resulting slot.
 *
 * Simpler approach: directly construct slots and pass to private methods
 * via casts. This is a unit-testing concession that keeps tests focused.
 */

// ─── WP-17 Bug A: nested-array unwrap ──────────────────────────────────────

describe('WP-17 Bug A: loop item_ref nested-array unwrap', () => {
  it('derives item schema from nested array when over-slot is a wrapper-object (Gmail pattern)', () => {
    const builder = makeBuilder();

    // Pre-seed `gmail_results` slot with the wrapper schema (simulating output
    // of a data_source step that returned Gmail search results).
    const slots: any = {
      gmail_results: {
        schema: gmailSearchResultsSchema(),
        scope: 'global',
        produced_by: 'fetch_emails',
      },
    };

    const loopStep = makeStep({
      id: 'process_emails',
      kind: 'loop',
      summary: 'Process each email',
      output: 'processed',
      loop: {
        over: 'gmail_results',
        item_ref: 'email',
      },
    });

    // Call buildLoopSlots directly via the cast — exercises just the unwrap logic.
    (builder as any).buildLoopSlots(loopStep, slots);

    // The item_ref slot should now exist with the per-email schema, NOT the wrapper.
    expect(slots.email).toBeDefined();
    expect(slots.email.scope).toBe('loop');
    expect(slots.email.schema.type).toBe('object');
    // Per-email properties should match the Gmail email shape, not the wrapper.
    expect(slots.email.schema.properties).toHaveProperty('id');
    expect(slots.email.schema.properties).toHaveProperty('subject');
    expect(slots.email.schema.properties).toHaveProperty('from');
    expect(slots.email.schema.properties).toHaveProperty('body');
    // The wrapper's top-level fields should NOT have leaked through.
    expect(slots.email.schema.properties).not.toHaveProperty('emails');
    expect(slots.email.schema.properties).not.toHaveProperty('total_found');
    expect(slots.email.schema.properties).not.toHaveProperty('search_query');
  });

  it('uses array items directly when over-slot is itself an array', () => {
    const builder = makeBuilder();
    const slots: any = {
      already_array: {
        schema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              x: { type: 'string' },
              y: { type: 'number' },
            },
          },
          source: 'inferred',
        },
        scope: 'global',
        produced_by: 'some_step',
      },
    };

    const loopStep = makeStep({
      id: 'iter',
      kind: 'loop',
      summary: '',
      loop: { over: 'already_array', item_ref: 'item' },
    });

    (builder as any).buildLoopSlots(loopStep, slots);

    expect(slots.item.schema.type).toBe('object');
    expect(slots.item.schema.properties).toHaveProperty('x');
    expect(slots.item.schema.properties).toHaveProperty('y');
  });

  it('falls back to "any" when over-slot is missing', () => {
    const builder = makeBuilder();
    const slots: any = {};

    const loopStep = makeStep({
      id: 'iter',
      kind: 'loop',
      summary: '',
      loop: { over: 'nonexistent', item_ref: 'item' },
    });

    (builder as any).buildLoopSlots(loopStep, slots);

    expect(slots.item.schema.type).toBe('any');
  });

  it('returns null from unwrapWrapperToArray when wrapper has multiple arrays (ambiguous)', () => {
    const builder = makeBuilder();
    const ambiguous = {
      type: 'object',
      properties: {
        arr_a: { type: 'array', items: { type: 'string' } },
        arr_b: { type: 'array', items: { type: 'number' } },
      },
    };

    const result = (builder as any).unwrapWrapperToArray(ambiguous);
    expect(result).toBeNull();
  });

  it('returns null from unwrapWrapperToArray when wrapper has zero arrays', () => {
    const builder = makeBuilder();
    const noArrays = {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'number' },
      },
    };

    const result = (builder as any).unwrapWrapperToArray(noArrays);
    expect(result).toBeNull();
  });
});

// ─── WP-17 Bug B: multi-loop item_ref collision ────────────────────────────

describe('WP-17 Bug B: multi-loop item_ref collision handling', () => {
  it('does not overwrite the slot when a second loop uses the same item_ref', () => {
    const builder = makeBuilder();
    const slots: any = {
      emails: {
        schema: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, subject: { type: 'string' } },
          },
        },
        scope: 'global',
        produced_by: 'fetch',
      },
    };

    const loop1 = makeStep({
      id: 'mark_read',
      kind: 'loop',
      summary: 'Mark each email as read',
      loop: { over: 'emails', item_ref: 'email' },
    });
    const loop2 = makeStep({
      id: 'apply_label',
      kind: 'loop',
      summary: 'Apply label to each email',
      loop: { over: 'emails', item_ref: 'email' },
    });

    (builder as any).buildLoopSlots(loop1, slots);
    (builder as any).buildLoopSlots(loop2, slots);

    // The original slot's produced_by should remain, AND produced_by_loops should record both.
    expect(slots.email.produced_by).toBe('mark_read');
    expect(slots.email.produced_by_loops).toContain('mark_read');
    expect(slots.email.produced_by_loops).toContain('apply_label');
    expect(slots.email.produced_by_loops).toHaveLength(2);

    // Schema should still be the per-email shape (unchanged).
    expect(slots.email.schema.properties).toHaveProperty('id');
    expect(slots.email.schema.properties).toHaveProperty('subject');
  });

  it('records three loop IDs when three loops share an item_ref (full aliexpress pattern)', () => {
    const builder = makeBuilder();
    const slots: any = {
      aliexpress_emails: {
        schema: gmailSearchResultsSchema(),
        scope: 'global',
        produced_by: 'fetch',
      },
    };

    const loops = ['extract_package_details', 'mark_emails_read', 'move_to_shopping_label'].map(id =>
      makeStep({
        id,
        kind: 'loop',
        summary: '',
        loop: { over: 'aliexpress_emails', item_ref: 'email' },
      })
    );

    for (const l of loops) {
      (builder as any).buildLoopSlots(l, slots);
    }

    expect(slots.email.produced_by).toBe('extract_package_details');
    expect(slots.email.produced_by_loops).toEqual([
      'extract_package_details',
      'mark_emails_read',
      'move_to_shopping_label',
    ]);
  });

  it('promotes a more-specific schema over an "any" placeholder from an earlier loop', () => {
    const builder = makeBuilder();
    const slots: any = {
      // Pre-existing item slot from a previous loop where the over-slot was missing
      shared_item: {
        schema: { type: 'any', source: 'inferred' },
        scope: 'loop',
        produced_by: 'loop1',
      },
      // A different over-source for the second loop, this time with a real shape
      typed_array: {
        schema: {
          type: 'array',
          items: { type: 'object', properties: { name: { type: 'string' } } },
        },
        scope: 'global',
        produced_by: 'fetch',
      },
    };

    const loop2 = makeStep({
      id: 'loop2',
      kind: 'loop',
      summary: '',
      loop: { over: 'typed_array', item_ref: 'shared_item' },
    });

    (builder as any).buildLoopSlots(loop2, slots);

    // The schema should be promoted to the more-specific one
    expect(slots.shared_item.schema.type).toBe('object');
    expect(slots.shared_item.schema.properties).toHaveProperty('name');
    expect(slots.shared_item.produced_by_loops).toContain('loop1');
    expect(slots.shared_item.produced_by_loops).toContain('loop2');
  });

  it('warns but keeps first slot when two loops produce different shapes for same item_ref', () => {
    const builder = makeBuilder();
    const slots: any = {
      arr1: {
        schema: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' } } },
        },
        scope: 'global',
        produced_by: 'fetch1',
      },
      arr2: {
        schema: {
          type: 'array',
          items: { type: 'object', properties: { totally_different_field: { type: 'number' } } },
        },
        scope: 'global',
        produced_by: 'fetch2',
      },
    };

    const loop1 = makeStep({
      id: 'l1',
      kind: 'loop',
      summary: '',
      loop: { over: 'arr1', item_ref: 'shared' },
    });
    const loop2 = makeStep({
      id: 'l2',
      kind: 'loop',
      summary: '',
      loop: { over: 'arr2', item_ref: 'shared' },
    });

    (builder as any).buildLoopSlots(loop1, slots);
    (builder as any).buildLoopSlots(loop2, slots);

    // First loop wins
    expect(slots.shared.produced_by).toBe('l1');
    // Schema is the first one's shape (id, not totally_different_field)
    expect(slots.shared.schema.properties).toHaveProperty('id');
    expect(slots.shared.schema.properties).not.toHaveProperty('totally_different_field');
    // Warnings should record the collision
    expect((builder as any).warnings.some((w: string) => /collision|different schemas/i.test(w))).toBe(true);
  });
});

// ─── WP-18 Bug A: honor LLM-declared transform.output_schema ──────────────

describe('WP-18 Bug A: shape-preserving transform honors LLM-declared output_schema', () => {
  it('uses LLM-declared output_schema for filter when present (overrides inheritance)', () => {
    const builder = makeBuilder();
    const slots: any = {
      raw_leads: {
        schema: sheetsReadRangeSchema(), // Sheets wrapper
        scope: 'global',
        produced_by: 'read_sheet',
      },
    };

    const filterStep = makeStep({
      id: 'filter_leads',
      kind: 'transform',
      summary: 'Filter to high-qualified leads',
      output: 'qualified_leads',
      transform: {
        op: 'filter',
        input: 'raw_leads',
        // LLM declared the actual output shape — array of lead objects, NOT the Sheets wrapper.
        output_schema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              Date: { type: 'string' },
              'Lead Name': { type: 'string' },
              Stage: { type: 'number' },
              'Sales Person': { type: 'string' },
            },
          },
        },
      },
    });

    const result = (builder as any).inferSchemaForTransformStep(filterStep, slots);

    // Should use the LLM declaration, not inherit the Sheets wrapper
    expect(result.type).toBe('array');
    expect(result.source).toBe('ai_declared');
    expect(result.items.properties).toHaveProperty('Date');
    expect(result.items.properties).toHaveProperty('Lead Name');
    expect(result.items.properties).toHaveProperty('Stage');
    // Wrapper fields should NOT appear
    expect(result.properties?.values).toBeUndefined();
    expect(result.properties?.row_count).toBeUndefined();
  });

  it('LLM-declared output_schema also wins for sort / dedupe', () => {
    const builder = makeBuilder();
    const slots: any = {
      input_data: {
        schema: { type: 'array', items: { type: 'object', properties: { x: { type: 'string' } } } },
        scope: 'global',
        produced_by: 's',
      },
    };

    const sortStep = makeStep({
      id: 'sort_step',
      kind: 'transform',
      summary: 'Sort + restructure',
      output: 'sorted',
      transform: {
        op: 'sort',
        input: 'input_data',
        output_schema: {
          type: 'array',
          items: { type: 'object', properties: { y: { type: 'number' } } },
        },
      },
    });

    const result = (builder as any).inferSchemaForTransformStep(sortStep, slots);
    expect(result.source).toBe('ai_declared');
    expect(result.items.properties).toHaveProperty('y');
    expect(result.items.properties).not.toHaveProperty('x');
  });
});

// ─── WP-18 Bug B: unwrap wrapper-object input in shape-preserving inheritance ──

describe('WP-18 Bug B: shape-preserving transform unwraps wrapper-object input', () => {
  it('unwraps Sheets wrapper to row shape when filter has no LLM-declared output_schema', () => {
    const builder = makeBuilder();
    const slots: any = {
      // Pre-seed the input slot as if a previous fixup pass had already
      // built the Sheets values into a typed nested array.
      raw_leads: {
        schema: {
          type: 'object',
          source: 'plugin',
          properties: {
            values: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  Date: { type: 'string' },
                  'Lead Name': { type: 'string' },
                  Stage: { type: 'number' },
                },
              },
            },
            row_count: { type: 'number' },
            range: { type: 'string' },
          },
        },
        scope: 'global',
        produced_by: 'read_sheet',
      },
    };

    const filterStep = makeStep({
      id: 'filter_step',
      kind: 'transform',
      summary: 'Filter rows by Stage',
      output: 'qualified',
      transform: {
        op: 'filter',
        input: 'raw_leads',
        // No output_schema — falls into the Bug B unwrap path
      },
    });

    const result = (builder as any).inferSchemaForTransformStep(filterStep, slots);

    // Should inherit the per-row shape, not the Sheets wrapper
    expect(result.type).toBe('array');
    expect(result.source).toBe('inferred');
    expect(result.items.properties).toHaveProperty('Date');
    expect(result.items.properties).toHaveProperty('Lead Name');
    expect(result.items.properties).toHaveProperty('Stage');
    // Wrapper fields should NOT leak
    expect(result.properties?.row_count).toBeUndefined();
    expect(result.properties?.range).toBeUndefined();
  });

  it('falls through to wrapper inheritance when wrapper has multiple arrays (ambiguous)', () => {
    const builder = makeBuilder();
    const slots: any = {
      multi_array_wrapper: {
        schema: {
          type: 'object',
          properties: {
            arr_a: { type: 'array', items: { type: 'string' } },
            arr_b: { type: 'array', items: { type: 'number' } },
          },
        },
        scope: 'global',
        produced_by: 's',
      },
    };

    const filterStep = makeStep({
      id: 'fs',
      kind: 'transform',
      summary: '',
      output: 'out',
      transform: { op: 'filter', input: 'multi_array_wrapper' },
    });

    const result = (builder as any).inferSchemaForTransformStep(filterStep, slots);

    // Ambiguous wrapper → fall back to copying the wrapper itself
    expect(result.type).toBe('object');
    expect(result.properties).toHaveProperty('arr_a');
    expect(result.properties).toHaveProperty('arr_b');
  });

  it('preserves direct array inheritance when input is already an array (regression guard)', () => {
    const builder = makeBuilder();
    const slots: any = {
      already_array: {
        schema: {
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'string' } } },
        },
        scope: 'global',
        produced_by: 's',
      },
    };

    const filterStep = makeStep({
      id: 'fs',
      kind: 'transform',
      summary: '',
      output: 'out',
      transform: { op: 'filter', input: 'already_array' },
    });

    const result = (builder as any).inferSchemaForTransformStep(filterStep, slots);

    // Existing behavior preserved: array → array, items preserved
    expect(result.type).toBe('array');
    expect(result.source).toBe('inferred');
    expect(result.items.properties).toHaveProperty('id');
  });
});
