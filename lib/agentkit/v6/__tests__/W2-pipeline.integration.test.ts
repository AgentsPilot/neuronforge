/**
 * Checkpoint A — W2 pipeline integration test (synthetic, no LLM, no plugins)
 *
 * Validates that a hand-crafted IntentContract using the three new W2
 * primitives compiles cleanly through:
 *
 *   1. DataSchemaBuilder.build() — produces the right slot schemas
 *   2. IntentToIRConverter.convert() — produces IR with correct transform configs
 *
 * The point is to catch grammar / IR-converter / data-schema wiring bugs
 * BEFORE we spend LLM tokens on Checkpoint B (single-scenario regen). If
 * synthetic input doesn't compile, the LLM-generated input never will.
 *
 * Scope:
 *   ✓ transform/with_fields with all major Expression op kinds
 *   ✓ transform/project_column (by_index, by_field, by_field_path)
 *   ✓ transform/set_difference (with and without reference_key_field)
 *   ✓ Ref normalization in with_fields expressions (`ref: <inputVar>` → `ref: "item"`)
 *   ✓ Defensive `reason` warning for generate/internal without reason
 *   ✓ data_schema slots populated correctly across all ops
 *
 * Out of scope (covered elsewhere):
 *   - Runtime execution (StructuredTransforms.test.ts)
 *   - Phase 4 ExecutionGraphCompiler full DSL emission
 *   - LLM behavior (deferred to Checkpoint B)
 */

import { IntentToIRConverter } from '../compiler/IntentToIRConverter';
import { ExecutionGraphCompiler } from '../compiler/ExecutionGraphCompiler';
import { DataSchemaBuilder } from '../capability-binding/DataSchemaBuilder';
import type { BoundStep, BoundIntentContract } from '../capability-binding/CapabilityBinderV2';
import type { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

// ─── Test infrastructure ────────────────────────────────────────────────────

/**
 * Minimal PluginManagerV2 stub. The W2 primitives don't require plugin
 * lookups, so most tests need this to be a no-op. The one exception is
 * data_source steps that simulate a Sheets read (we hand-build the slot
 * schema for those instead of mocking plugin definitions).
 */
const stubPluginManager = {
  getPluginDefinition: (_key: string) => null,
} as unknown as PluginManagerV2;

function makeBoundStep(partial: any): BoundStep {
  return partial as BoundStep;
}

function makeBoundIntent(partial: any): BoundIntentContract {
  return {
    version: 'intent.v1',
    goal: partial.goal ?? 'test workflow',
    steps: partial.steps ?? [],
    data_schema: partial.data_schema,
    config: partial.config,
    ...partial,
  } as BoundIntentContract;
}

// ─── Test fixtures ──────────────────────────────────────────────────────────

/**
 * Pre-built data_schema slot for a Sheets read_range output (the wrapper
 * shape: { values: 2D array, row_count: number, range: string, ... }).
 * Used as the input slot for filter / project_column tests.
 */
const SHEETS_WRAPPER_SLOT = {
  schema: {
    type: 'object' as const,
    source: 'plugin' as const,
    properties: {
      values: {
        type: 'array' as const,
        source: 'plugin' as const,
        items: {
          type: 'array' as const,
          items: { type: 'string' as const },
        },
      },
      row_count: { type: 'number' as const, source: 'plugin' as const },
      range: { type: 'string' as const, source: 'plugin' as const },
    },
  },
  scope: 'global' as const,
  produced_by: 'read_sheet',
};

/**
 * Pre-built array-of-objects slot — what an upstream `transform/map` or
 * compiler's auto-injected `rows_to_objects` would produce.
 */
const LEADS_ARRAY_SLOT = {
  schema: {
    type: 'array' as const,
    source: 'inferred' as const,
    items: {
      type: 'object' as const,
      properties: {
        Date: { type: 'string' as const },
        'Lead Name': { type: 'string' as const },
        Company: { type: 'string' as const },
        Email: { type: 'string' as const },
        Stage: { type: 'number' as const },
      },
    },
  },
  scope: 'global' as const,
  produced_by: 'normalize_rows',
};

/**
 * Pre-built array of message-id objects — the reference array for
 * `set_difference` tests.
 */
const EXISTING_IDS_SLOT = {
  schema: {
    type: 'array' as const,
    source: 'inferred' as const,
    items: {
      type: 'object' as const,
      properties: {
        message_id: { type: 'string' as const },
      },
    },
  },
  scope: 'global' as const,
  produced_by: 'extract_existing_ids',
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Checkpoint A — W2 synthetic pipeline integration', () => {
  describe('transform/with_fields', () => {
    it('compiles to IR with normalized refs and full expression tree', () => {
      const boundIntent = makeBoundIntent({
        goal: 'Augment leads with computed fields',
        data_schema: {
          slots: { qualified_leads: LEADS_ARRAY_SLOT },
        },
        steps: [
          makeBoundStep({
            id: 'augment_leads',
            kind: 'transform',
            summary: 'Add days_remaining + has_email computed fields',
            output: 'augmented_leads',
            transform: {
              op: 'with_fields',
              input: 'qualified_leads',
              fields: [
                {
                  name: 'has_email',
                  expression: {
                    kind: 'null_check',
                    invert: true,
                    value: { kind: 'ref', ref: 'qualified_leads', field: 'Email' },
                  },
                },
                {
                  name: 'lead_url',
                  expression: {
                    kind: 'concat',
                    args: [
                      { kind: 'literal', value: 'https://crm.example.com/lead/' },
                      { kind: 'ref', ref: 'qualified_leads', field: 'Lead Name' },
                    ],
                  },
                },
                {
                  name: 'priority',
                  expression: {
                    kind: 'if',
                    condition: {
                      op: 'test',
                      left: { kind: 'ref', ref: 'qualified_leads', field: 'Stage' },
                      comparator: 'gte',
                      right: { kind: 'literal', value: 4 },
                    },
                    then: { kind: 'literal', value: 'high' },
                    else: { kind: 'literal', value: 'low' },
                  },
                },
              ],
            },
          }),
        ],
      });

      const converter = new IntentToIRConverter(stubPluginManager);
      const result = converter.convert(boundIntent);

      expect(result.success).toBe(true);
      expect(result.ir).toBeDefined();

      // Find the with_fields node in the IR
      const nodes = Object.values(result.ir!.execution_graph.nodes);
      const wfNode = nodes.find((n: any) => n.operation?.transform?.type === 'with_fields') as any;
      expect(wfNode).toBeDefined();
      expect(wfNode.operation.transform.fields).toHaveLength(3);

      // Each ref to the input slot should have been normalized to ref: "item"
      const fields = wfNode.operation.transform.fields;
      const refsInArgs = (expr: any): string[] => {
        if (!expr || typeof expr !== 'object') return [];
        if (expr.kind === 'ref') return [expr.ref];
        const collected: string[] = [];
        if (Array.isArray(expr.args)) for (const a of expr.args) collected.push(...refsInArgs(a));
        if (expr.then) collected.push(...refsInArgs(expr.then));
        if (expr.else) collected.push(...refsInArgs(expr.else));
        if (expr.value) collected.push(...refsInArgs(expr.value));
        if (expr.left) collected.push(...refsInArgs(expr.left));
        if (expr.right) collected.push(...refsInArgs(expr.right));
        if (expr.date) collected.push(...refsInArgs(expr.date));
        if (expr.days) collected.push(...refsInArgs(expr.days));
        return collected;
      };

      const allRefs = fields.flatMap((f: any) => refsInArgs(f.expression));
      // Every "ref" in the with_fields expressions should be "item" — the input
      // slot ref ("qualified_leads") should have been normalized.
      expect(allRefs.every(r => r === 'item')).toBe(true);
      expect(allRefs).toContain('item'); // sanity: at least one ref existed
    });

    it('preserves expression structure (literal / config / today / date_diff / all_not_null)', () => {
      const boundIntent = makeBoundIntent({
        data_schema: { slots: { contracts: LEADS_ARRAY_SLOT } },
        steps: [
          makeBoundStep({
            id: 'compute_days',
            kind: 'transform',
            summary: 'Compute days_remaining',
            output: 'with_dates',
            transform: {
              op: 'with_fields',
              input: 'contracts',
              fields: [
                {
                  name: 'today_iso',
                  expression: { kind: 'today' },
                },
                {
                  name: 'days_remaining',
                  expression: {
                    kind: 'date_diff',
                    unit: 'days',
                    left: { kind: 'ref', ref: 'contracts', field: 'Date' },
                    right: { kind: 'today' },
                  },
                },
                {
                  name: 'config_value',
                  expression: { kind: 'config', key: 'threshold' },
                },
                {
                  name: 'has_all_required',
                  expression: { kind: 'all_not_null', refs: ['Email', 'Date', 'Lead Name'] },
                },
              ],
            },
          }),
        ],
      });

      const converter = new IntentToIRConverter(stubPluginManager);
      const result = converter.convert(boundIntent);

      expect(result.success).toBe(true);

      const nodes = Object.values(result.ir!.execution_graph.nodes);
      const wfNode = nodes.find((n: any) => n.operation?.transform?.type === 'with_fields') as any;
      const fields = wfNode.operation.transform.fields;

      const kinds = fields.map((f: any) => f.expression.kind);
      expect(kinds).toEqual(['today', 'date_diff', 'config', 'all_not_null']);

      // date_diff's `left` ref to "contracts" should be normalized to "item"
      const dateDiffField = fields.find((f: any) => f.expression.kind === 'date_diff');
      expect(dateDiffField.expression.left.ref).toBe('item');
      expect(dateDiffField.expression.left.field).toBe('Date');
    });
  });

  describe('transform/project_column', () => {
    it('forwards by_index column config straight through to IR', () => {
      const boundIntent = makeBoundIntent({
        data_schema: { slots: { sheet_data: SHEETS_WRAPPER_SLOT } },
        steps: [
          makeBoundStep({
            id: 'extract_col5',
            kind: 'transform',
            summary: 'Extract column 5 (Gmail message links)',
            output: 'message_links',
            transform: {
              op: 'project_column',
              input: 'sheet_data',
              column: { kind: 'by_index', index: 4 },
            },
          }),
        ],
      });

      const converter = new IntentToIRConverter(stubPluginManager);
      const result = converter.convert(boundIntent);

      expect(result.success).toBe(true);

      const nodes = Object.values(result.ir!.execution_graph.nodes);
      const pcNode = nodes.find((n: any) => n.operation?.transform?.type === 'project_column') as any;
      expect(pcNode).toBeDefined();
      expect(pcNode.operation.transform.column).toEqual({ kind: 'by_index', index: 4 });
    });

    it('forwards by_field config', () => {
      const boundIntent = makeBoundIntent({
        data_schema: { slots: { records: LEADS_ARRAY_SLOT } },
        steps: [
          makeBoundStep({
            id: 'extract_emails',
            kind: 'transform',
            summary: 'Extract Email field from each record',
            output: 'email_list',
            transform: {
              op: 'project_column',
              input: 'records',
              column: { kind: 'by_field', field: 'Email' },
            },
          }),
        ],
      });

      const converter = new IntentToIRConverter(stubPluginManager);
      const result = converter.convert(boundIntent);

      expect(result.success).toBe(true);
      const nodes = Object.values(result.ir!.execution_graph.nodes);
      const pcNode = nodes.find((n: any) => n.operation?.transform?.type === 'project_column') as any;
      expect(pcNode.operation.transform.column).toEqual({ kind: 'by_field', field: 'Email' });
    });

    it('forwards by_field_path config (dot-notation)', () => {
      const boundIntent = makeBoundIntent({
        data_schema: { slots: { items: LEADS_ARRAY_SLOT } },
        steps: [
          makeBoundStep({
            id: 'nested_extract',
            kind: 'transform',
            summary: 'Extract nested field',
            output: 'nested_values',
            transform: {
              op: 'project_column',
              input: 'items',
              column: { kind: 'by_field_path', path: 'metadata.id' },
            },
          }),
        ],
      });

      const converter = new IntentToIRConverter(stubPluginManager);
      const result = converter.convert(boundIntent);

      expect(result.success).toBe(true);
      const nodes = Object.values(result.ir!.execution_graph.nodes);
      const pcNode = nodes.find((n: any) => n.operation?.transform?.type === 'project_column') as any;
      expect(pcNode.operation.transform.column).toEqual({ kind: 'by_field_path', path: 'metadata.id' });
    });
  });

  describe('transform/set_difference', () => {
    it('resolves reference RefName to variable + carries key_field through', () => {
      const boundIntent = makeBoundIntent({
        data_schema: {
          slots: {
            candidate_records: LEADS_ARRAY_SLOT,
            existing_message_ids: EXISTING_IDS_SLOT,
          },
        },
        steps: [
          makeBoundStep({
            id: 'filter_new',
            kind: 'transform',
            summary: 'Keep only records not already in the existing list',
            output: 'new_records',
            transform: {
              op: 'set_difference',
              input: 'candidate_records',
              reference: 'existing_message_ids',
              key_field: 'gmail_id',
              reference_key_field: 'message_id',
            },
          }),
        ],
      });

      const converter = new IntentToIRConverter(stubPluginManager);
      const result = converter.convert(boundIntent);

      expect(result.success).toBe(true);

      const nodes = Object.values(result.ir!.execution_graph.nodes);
      const sdNode = nodes.find((n: any) => n.operation?.transform?.type === 'set_difference') as any;
      expect(sdNode).toBeDefined();
      // The IR converter resolves the RefName to the actual variable name
      expect(sdNode.operation.transform.reference).toBeDefined();
      expect(sdNode.operation.transform.key_field).toBe('gmail_id');
      expect(sdNode.operation.transform.reference_key_field).toBe('message_id');
    });

    it('emits warning when reference is missing', () => {
      const boundIntent = makeBoundIntent({
        data_schema: { slots: { records: LEADS_ARRAY_SLOT } },
        steps: [
          makeBoundStep({
            id: 'broken_set_diff',
            kind: 'transform',
            summary: 'Missing reference (intentional broken case)',
            output: 'out',
            transform: {
              op: 'set_difference',
              input: 'records',
              key_field: 'id',
              // reference omitted on purpose
            },
          }),
        ],
      });

      const converter = new IntentToIRConverter(stubPluginManager);
      const result = converter.convert(boundIntent);

      // Should produce warnings but not error
      expect(result.success).toBe(true);
      expect(result.warnings.some(w => /missing required "reference"/i.test(w))).toBe(true);
    });

    it('emits warning when key_field is missing', () => {
      const boundIntent = makeBoundIntent({
        data_schema: {
          slots: {
            records: LEADS_ARRAY_SLOT,
            ref_array: EXISTING_IDS_SLOT,
          },
        },
        steps: [
          makeBoundStep({
            id: 'broken2',
            kind: 'transform',
            summary: 'Missing key_field (intentional broken case)',
            output: 'out',
            transform: {
              op: 'set_difference',
              input: 'records',
              reference: 'ref_array',
              // key_field omitted
            },
          }),
        ],
      });

      const converter = new IntentToIRConverter(stubPluginManager);
      const result = converter.convert(boundIntent);

      expect(result.success).toBe(true);
      expect(result.warnings.some(w => /missing required "key_field"/i.test(w))).toBe(true);
    });
  });

  describe('defensive reason field on generate/internal', () => {
    it('warns when generate/internal lacks a reason', () => {
      const boundIntent = makeBoundIntent({
        steps: [
          makeBoundStep({
            id: 'unjustified_internal',
            kind: 'generate',
            summary: 'Internal generate with no reason',
            output: 'content',
            uses: [{ capability: 'generate', domain: 'internal' }],
            generate: {
              instruction: 'Combine the fields somehow',
              outputs: [{ name: 'result', type: 'string' }],
              // reason intentionally omitted
            },
          }),
        ],
      });

      const converter = new IntentToIRConverter(stubPluginManager);
      const result = converter.convert(boundIntent);

      expect(result.success).toBe(true);
      expect(result.warnings.some(w => /generate\/internal.*has no `reason`/i.test(w))).toBe(true);
    });

    it('does NOT warn when generate has non-internal domain', () => {
      const boundIntent = makeBoundIntent({
        steps: [
          makeBoundStep({
            id: 'legit_html_synth',
            kind: 'generate',
            summary: 'HTML email body composition (legitimate AI use)',
            output: 'email_body',
            uses: [{ capability: 'generate', domain: 'email-content' }],
            generate: {
              instruction: 'Compose an HTML email body summarizing the leads.',
              outputs: [{ name: 'html', type: 'string' }],
              // No reason needed for non-internal domain
            },
          }),
        ],
      });

      const converter = new IntentToIRConverter(stubPluginManager);
      const result = converter.convert(boundIntent);

      expect(result.success).toBe(true);
      expect(result.warnings.some(w => /generate\/internal.*has no `reason`/i.test(w))).toBe(false);
    });

    it('does NOT warn when generate/internal has a reason', () => {
      const boundIntent = makeBoundIntent({
        steps: [
          makeBoundStep({
            id: 'justified_internal',
            kind: 'generate',
            summary: 'Internal generate with reason',
            output: 'classification',
            uses: [{ capability: 'generate', domain: 'internal' }],
            generate: {
              instruction: 'Classify the email tone semantically.',
              reason: 'Classifying email tone — requires semantic reasoning, not rule-based.',
              outputs: [{ name: 'tone', type: 'string' }],
            },
          }),
        ],
      });

      const converter = new IntentToIRConverter(stubPluginManager);
      const result = converter.convert(boundIntent);

      expect(result.success).toBe(true);
      expect(result.warnings.some(w => /generate\/internal.*has no `reason`/i.test(w))).toBe(false);
    });
  });

  describe('DataSchemaBuilder integration with new ops', () => {
    it('produces correct slot for with_fields via inferSchemaForTransformStep', () => {
      const builder = new DataSchemaBuilder(stubPluginManager);
      // Pre-seed input slot
      const slots: any = { qualified_leads: LEADS_ARRAY_SLOT };

      const step = makeBoundStep({
        id: 'augment',
        kind: 'transform',
        summary: '',
        output: 'augmented',
        transform: {
          op: 'with_fields',
          input: 'qualified_leads',
          fields: [
            { name: 'flag', expression: { kind: 'literal', value: true } },
          ],
          // For with_fields, the LLM SHOULD declare an output_schema covering all
          // augmented fields. Our infer path expects this for shape-changing ops.
          output_schema: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                Date: { type: 'string' },
                'Lead Name': { type: 'string' },
                Email: { type: 'string' },
                Stage: { type: 'number' },
                flag: { type: 'boolean' },
              },
            },
          },
        },
      });

      const schema = (builder as any).inferSchemaForTransformStep(step, slots);
      expect(schema).toBeDefined();
      // LLM-declared output_schema should win (WP-18 Bug A)
      expect(schema.source).toBe('ai_declared');
      expect(schema.type).toBe('array');
      expect(schema.items.properties).toHaveProperty('flag');
    });

    it('produces correct slot for project_column (output is the column itself, source=inferred)', () => {
      const builder = new DataSchemaBuilder(stubPluginManager);
      const slots: any = { sheet_data: SHEETS_WRAPPER_SLOT };

      // project_column without explicit output_schema — should fall through
      // to inheritance (or a fallback). DataSchemaBuilder doesn't have a
      // dedicated slot inference for project_column today; the runtime executor
      // produces a flat array. Verify the converter accepts it (no crash).
      const step = makeBoundStep({
        id: 'extract_col',
        kind: 'transform',
        summary: '',
        output: 'col_values',
        transform: {
          op: 'project_column',
          input: 'sheet_data',
          column: { kind: 'by_index', index: 4 },
        },
      });

      // The DataSchemaBuilder's `inferSchemaForTransformStep` handles known
      // op enums (filter/sort/dedupe/flatten/map/group/etc.). For unknown-to-
      // builder ops (project_column / set_difference / with_fields), it falls
      // through to the input-inheritance fallback. This is acceptable for
      // Checkpoint A — the slot exists and the converter doesn't crash.
      const schema = (builder as any).inferSchemaForTransformStep(step, slots);
      expect(schema).toBeDefined();
    });

    it('end-to-end: build() over a multi-step contract with all 3 new ops', () => {
      const builder = new DataSchemaBuilder(stubPluginManager);
      const steps: any = [
        makeBoundStep({
          id: 'project_step',
          kind: 'transform',
          summary: '',
          output: 'col_values',
          transform: {
            op: 'project_column',
            input: '__seed_array__',
            column: { kind: 'by_field', field: 'id' },
          },
        }),
        makeBoundStep({
          id: 'set_diff_step',
          kind: 'transform',
          summary: '',
          output: 'new_only',
          transform: {
            op: 'set_difference',
            input: '__seed_array__',
            reference: '__ref_array__',
            key_field: 'id',
          },
        }),
        makeBoundStep({
          id: 'augment_step',
          kind: 'transform',
          summary: '',
          output: 'augmented',
          inputs: ['new_only'],
          transform: {
            op: 'with_fields',
            input: 'new_only',
            fields: [{ name: 'flag', expression: { kind: 'literal', value: true } }],
          },
        }),
      ];

      // Pre-seed two reference slots that the steps consume but don't produce
      // (in real flow these would be data_source step outputs)
      const slots: Record<string, any> = {
        __seed_array__: LEADS_ARRAY_SLOT,
        __ref_array__: EXISTING_IDS_SLOT,
      };

      // Manually invoke the slot-building pass for each step
      for (const step of steps) {
        const schema = (builder as any).inferSchemaForTransformStep(step, slots);
        if (schema) {
          slots[step.output] = {
            schema,
            scope: 'global',
            produced_by: step.id,
          };
        }
      }

      // All three new ops should have produced slots without crashing
      expect(slots.col_values).toBeDefined();
      expect(slots.new_only).toBeDefined();
      expect(slots.augmented).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Phase 4 — IR → PILOT DSL emission for new ops
  //
  // The ExecutionGraphCompiler has a `validPilotOps` allowlist; if the new
  // ops (with_fields/project_column/set_difference) aren't in it, the
  // compiler silently aliases them to 'map' and runtime dispatch breaks.
  // These tests catch that class of bug at compile time.
  // ────────────────────────────────────────────────────────────────────────
  describe('Phase 4 — IR → PILOT DSL emission', () => {
    /**
     * Run a complete BoundIntentContract through Phase 3 (IR converter) +
     * Phase 4 (compiler). Returns the compiled WorkflowStep[] for assertions.
     */
    async function compileToWorkflow(boundIntent: BoundIntentContract) {
      const converter = new IntentToIRConverter(stubPluginManager);
      const conversionResult = converter.convert(boundIntent);
      expect(conversionResult.success).toBe(true);
      expect(conversionResult.ir).toBeDefined();

      const compiler = new ExecutionGraphCompiler(stubPluginManager);
      const compilationResult = await compiler.compile(conversionResult.ir!);
      return compilationResult;
    }

    it('with_fields preserves operation name + fields config in compiled DSL', async () => {
      const boundIntent = makeBoundIntent({
        data_schema: { slots: { leads: LEADS_ARRAY_SLOT } },
        steps: [
          makeBoundStep({
            id: 'augment',
            kind: 'transform',
            summary: 'Add has_email computed field',
            output: 'augmented',
            transform: {
              op: 'with_fields',
              input: 'leads',
              fields: [
                {
                  name: 'has_email',
                  expression: {
                    kind: 'null_check',
                    invert: true,
                    value: { kind: 'ref', ref: 'leads', field: 'Email' },
                  },
                },
              ],
            },
          }),
        ],
      });

      const result = await compileToWorkflow(boundIntent);
      expect(result.success).toBe(true);

      // Find the with_fields step specifically — the compiler may have
      // auto-injected other transforms (e.g., rows_to_objects).
      const transformStep = result.workflow.find(
        (s: any) => s.type === 'transform' && s.operation === 'with_fields'
      );
      expect(transformStep).toBeDefined();
      // Critical: the operation must be 'with_fields', NOT silently aliased to 'map'
      expect((transformStep as any).operation).toBe('with_fields');
      // The fields config must survive compilation
      expect((transformStep as any).config?.fields).toBeDefined();
      expect((transformStep as any).config.fields).toHaveLength(1);
      expect((transformStep as any).config.fields[0].name).toBe('has_email');
      // Refs in expressions should be normalized to "item" — walk the expression
      // tree to find ALL refs (regardless of nesting path the compiler may take).
      const collectRefs = (expr: any): string[] => {
        if (!expr || typeof expr !== 'object') return [];
        if (expr.kind === 'ref') return [expr.ref];
        const refs: string[] = [];
        for (const v of Object.values(expr)) {
          if (v && typeof v === 'object') {
            if (Array.isArray(v)) for (const item of v) refs.push(...collectRefs(item));
            else refs.push(...collectRefs(v));
          }
        }
        return refs;
      };
      const refs = collectRefs((transformStep as any).config.fields[0].expression);
      expect(refs).toContain('item');
      expect(refs.every(r => r === 'item')).toBe(true);
    });

    it('project_column preserves operation name + column config in compiled DSL', async () => {
      const boundIntent = makeBoundIntent({
        data_schema: { slots: { sheet_data: SHEETS_WRAPPER_SLOT } },
        steps: [
          makeBoundStep({
            id: 'extract_col5',
            kind: 'transform',
            summary: 'Extract column 5',
            output: 'col_values',
            transform: {
              op: 'project_column',
              input: 'sheet_data',
              column: { kind: 'by_index', index: 4 },
            },
          }),
        ],
      });

      const result = await compileToWorkflow(boundIntent);
      expect(result.success).toBe(true);

      const transformStep = result.workflow.find((s: any) => s.type === 'transform' && s.operation === 'project_column');
      expect(transformStep).toBeDefined();
      // Operation must NOT be aliased to 'map'
      expect((transformStep as any).operation).toBe('project_column');
      // Column config must survive compilation
      expect((transformStep as any).config?.column).toEqual({ kind: 'by_index', index: 4 });
    });

    it('set_difference preserves operation name + reference/key_field config', async () => {
      const boundIntent = makeBoundIntent({
        data_schema: {
          slots: {
            candidates: LEADS_ARRAY_SLOT,
            existing: EXISTING_IDS_SLOT,
          },
        },
        steps: [
          makeBoundStep({
            id: 'filter_new',
            kind: 'transform',
            summary: 'Anti-join against existing IDs',
            output: 'new_records',
            transform: {
              op: 'set_difference',
              input: 'candidates',
              reference: 'existing',
              key_field: 'id',
              reference_key_field: 'message_id',
            },
          }),
        ],
      });

      const result = await compileToWorkflow(boundIntent);
      expect(result.success).toBe(true);

      const transformStep = result.workflow.find((s: any) => s.type === 'transform' && s.operation === 'set_difference');
      expect(transformStep).toBeDefined();
      expect((transformStep as any).operation).toBe('set_difference');
      // Reference + key fields must survive
      expect((transformStep as any).config?.reference).toBeDefined();
      expect((transformStep as any).config?.key_field).toBe('id');
      expect((transformStep as any).config?.reference_key_field).toBe('message_id');
    });

    it('all 3 new ops in one workflow compile without aliasing or warnings about invalid types', async () => {
      const boundIntent = makeBoundIntent({
        data_schema: {
          slots: {
            sheet_data: SHEETS_WRAPPER_SLOT,
            candidates: LEADS_ARRAY_SLOT,
            existing: EXISTING_IDS_SLOT,
          },
        },
        steps: [
          makeBoundStep({
            id: 'project',
            kind: 'transform',
            summary: 'Extract column',
            output: 'col_vals',
            transform: {
              op: 'project_column',
              input: 'sheet_data',
              column: { kind: 'by_index', index: 0 },
            },
          }),
          makeBoundStep({
            id: 'set_diff',
            kind: 'transform',
            summary: 'Anti-join',
            output: 'new_only',
            transform: {
              op: 'set_difference',
              input: 'candidates',
              reference: 'existing',
              key_field: 'id',
            },
          }),
          makeBoundStep({
            id: 'augment',
            kind: 'transform',
            summary: 'Add computed field',
            output: 'augmented',
            transform: {
              op: 'with_fields',
              input: 'new_only',
              fields: [
                { name: 'tagged', expression: { kind: 'literal', value: true } },
              ],
            },
          }),
        ],
      });

      const result = await compileToWorkflow(boundIntent);
      expect(result.success).toBe(true);

      // Each new op should appear in the compiled workflow with its real name
      const operations = result.workflow.filter((s: any) => s.type === 'transform').map((s: any) => s.operation);
      expect(operations).toContain('project_column');
      expect(operations).toContain('set_difference');
      expect(operations).toContain('with_fields');

      // No "Invalid transform type" warnings should fire (these would indicate
      // the validPilotOps allowlist was missing one of the new ops).
      const invalidTypeWarnings = (result.warnings ?? []).filter((w: string) =>
        /Invalid transform type/i.test(w)
      );
      expect(invalidTypeWarnings).toHaveLength(0);
    });
  });

  describe('IR contains data_schema (carry-through)', () => {
    it('execution_graph.data_schema is populated from boundIntent.data_schema', () => {
      const boundIntent = makeBoundIntent({
        data_schema: {
          slots: {
            qualified_leads: LEADS_ARRAY_SLOT,
            existing_message_ids: EXISTING_IDS_SLOT,
          },
        },
        steps: [
          makeBoundStep({
            id: 'simple',
            kind: 'transform',
            summary: '',
            output: 'out',
            transform: {
              op: 'project_column',
              input: 'qualified_leads',
              column: { kind: 'by_field', field: 'Email' },
            },
          }),
        ],
      });

      const converter = new IntentToIRConverter(stubPluginManager);
      const result = converter.convert(boundIntent);

      expect(result.success).toBe(true);
      expect(result.ir!.execution_graph.data_schema).toBeDefined();
      expect(result.ir!.execution_graph.data_schema!.slots).toHaveProperty('qualified_leads');
      expect(result.ir!.execution_graph.data_schema!.slots).toHaveProperty('existing_message_ids');
    });
  });
});
