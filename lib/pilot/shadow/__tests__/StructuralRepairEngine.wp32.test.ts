/**
 * StructuralRepairEngine — WP-32 (per-item-nested flatten field validation)
 *
 * Background:
 *   WorkflowPilot runs `StructuralRepairEngine.scanWorkflow` at the top of
 *   `execute()` and then persists any auto-fixes back to `agents.pilot_steps`
 *   in the database. The flatten-field validation in scanWorkflow assumed
 *   that `step.input = {{producer}}` is the only valid form and that
 *   `config.field` always names a root-level array key of the producer's
 *   output_schema.
 *
 *   But the LLM (correctly) also emits the per-item-nested form:
 *     `step.input = "{{producer.subArray}}"` + `field = "perItemField"`
 *   meaning "for each item in producer.subArray, extract item.perItemField
 *   and flatten." The validator wrongly flagged this as `invalid_flatten_field`,
 *   then autoFix rewrote `perItemField` → the first root-level array name
 *   (e.g. "attachments" → "emails"). Result: runtime sees `field: "emails"`,
 *   iterates over emails-array items looking for an `emails` sub-field,
 *   finds none, returns []. Phase E succeeds with an empty result.
 *
 *   The fix: when `step.input` navigates via `{{producer.subField}}` and
 *   the producer's output_schema has `properties[subField]` of type array
 *   with `items.properties`, validate `config.field` against the array
 *   items' properties instead of the root-level keys.
 *
 * Encountered as: `expense-invoice-email-scanner` Phase E (2026-05-13).
 */

// PluginManagerV2 has side effects on init; replace with a no-op for tests.
jest.mock('@/lib/server/plugin-manager-v2', () => ({
  __esModule: true,
  default: { getInstance: jest.fn().mockResolvedValue({}) },
  PluginManagerV2: { getInstance: jest.fn().mockResolvedValue({}) },
}));

import { StructuralRepairEngine } from '../StructuralRepairEngine';

// Quiet the engine's console.log noise during tests.
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

// ─── Helpers ───────────────────────────────────────────────────────────────

type AgentLike = {
  id: string;
  pilot_steps: any[];
  [key: string]: any;
};

function makeAgent(steps: any[]): AgentLike {
  return { id: 'test-agent', pilot_steps: steps };
}

function makeProducerStep(opts: {
  step_id: string;
  output_variable: string;
  output_schema: any;
}) {
  return {
    step_id: opts.step_id,
    type: 'action',
    output_variable: opts.output_variable,
    output_schema: opts.output_schema,
    action: 'some.action',
    params: {},
  };
}

function makeFlattenStep(opts: {
  step_id: string;
  input: string;
  field: string;
  output_variable?: string;
}) {
  return {
    step_id: opts.step_id,
    type: 'transform',
    input: opts.input,
    output_variable: opts.output_variable || `${opts.step_id}_out`,
    config: {
      type: 'flatten',
      input: opts.input.replace(/^\{\{|\}\}$/g, ''),
      field: opts.field,
    },
  };
}

async function scanFor(steps: any[], type: string) {
  const engine = new StructuralRepairEngine();
  const issues = await engine.scanWorkflow(makeAgent(steps) as any);
  return issues.filter(i => i.type === type);
}

// ─── WP-32: per-item-nested flatten patterns ───────────────────────────────

describe('WP-32 — StructuralRepairEngine flatten-field validation respects navigation in step.input', () => {
  describe('Canonical per-item-nested pattern (expense-invoice-email-scanner)', () => {
    it('does NOT flag "attachments" when input navigates to "emails" sub-array with per-item attachments', async () => {
      const steps = [
        makeProducerStep({
          step_id: 'step1',
          output_variable: 'matching_emails',
          output_schema: {
            type: 'object',
            properties: {
              emails: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    subject: { type: 'string' },
                    attachments: {
                      type: 'array',
                      items: { type: 'object', properties: { filename: { type: 'string' } } },
                    },
                  },
                },
              },
              total_found: { type: 'number' },
            },
          },
        }),
        makeFlattenStep({
          step_id: 'step2',
          input: '{{matching_emails.emails}}',
          field: 'attachments',
        }),
      ];

      const issues = await scanFor(steps, 'invalid_flatten_field');
      expect(issues).toHaveLength(0);
    });

    it('does NOT flag valid per-item sub-array fields with arbitrary names', async () => {
      const steps = [
        makeProducerStep({
          step_id: 'step1',
          output_variable: 'sheets_result',
          output_schema: {
            type: 'object',
            properties: {
              rows: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    tags: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          },
        }),
        makeFlattenStep({
          step_id: 'step2',
          input: '{{sheets_result.rows}}',
          field: 'tags',
        }),
      ];

      const issues = await scanFor(steps, 'invalid_flatten_field');
      expect(issues).toHaveLength(0);
    });
  });

  describe('Wrong field under per-item-nested navigation', () => {
    it('flags a non-existent per-item sub-field and suggests from available per-item fields', async () => {
      const steps = [
        makeProducerStep({
          step_id: 'step1',
          output_variable: 'matching_emails',
          output_schema: {
            type: 'object',
            properties: {
              emails: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    attachments: { type: 'array', items: {} },
                    files: { type: 'array', items: {} },
                    subject: { type: 'string' }, // not an array — should not appear in suggestion
                  },
                },
              },
            },
          },
        }),
        makeFlattenStep({
          step_id: 'step2',
          input: '{{matching_emails.emails}}',
          field: 'nonexistent_field',
        }),
      ];

      const issues = await scanFor(steps, 'invalid_flatten_field');
      expect(issues).toHaveLength(1);
      expect(issues[0].description).toContain('per-item array sub-field');
      expect(issues[0].description).toContain('attachments');
      expect(issues[0].description).toContain('files');
      expect(issues[0].description).not.toContain('subject'); // scalar fields excluded
      expect(issues[0].autoFixable).toBe(true);
    });

    it('does NOT flag when sub-array items have no array sub-fields (cannot validate meaningfully)', async () => {
      const steps = [
        makeProducerStep({
          step_id: 'step1',
          output_variable: 'plain_emails',
          output_schema: {
            type: 'object',
            properties: {
              emails: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    subject: { type: 'string' },
                  },
                },
              },
            },
          },
        }),
        makeFlattenStep({
          step_id: 'step2',
          input: '{{plain_emails.emails}}',
          field: 'something',
        }),
      ];

      const issues = await scanFor(steps, 'invalid_flatten_field');
      expect(issues).toHaveLength(0);
    });

    it('does NOT flag when sub-array has no items.properties shape', async () => {
      const steps = [
        makeProducerStep({
          step_id: 'step1',
          output_variable: 'raw_list',
          output_schema: {
            type: 'object',
            properties: {
              items: { type: 'array' }, // no items.properties
            },
          },
        }),
        makeFlattenStep({
          step_id: 'step2',
          input: '{{raw_list.items}}',
          field: 'whatever',
        }),
      ];

      const issues = await scanFor(steps, 'invalid_flatten_field');
      expect(issues).toHaveLength(0);
    });
  });

  describe('Root-level pattern (regression guard — pre-WP-32 behavior preserved)', () => {
    it('flags invalid root-level field when input does NOT navigate into a sub-array', async () => {
      const steps = [
        makeProducerStep({
          step_id: 'step1',
          output_variable: 'producer',
          output_schema: {
            type: 'object',
            properties: {
              emails: { type: 'array', items: {} },
              files: { type: 'array', items: {} },
              total: { type: 'number' },
            },
          },
        }),
        makeFlattenStep({
          step_id: 'step2',
          input: '{{producer}}',
          field: 'attachments', // not at root
        }),
      ];

      const issues = await scanFor(steps, 'invalid_flatten_field');
      expect(issues).toHaveLength(1);
      expect(issues[0].description).toContain('root-level array');
      expect(issues[0].description).toContain('emails');
      expect(issues[0].description).toContain('files');
    });

    it('does NOT flag when root-level field is correct', async () => {
      const steps = [
        makeProducerStep({
          step_id: 'step1',
          output_variable: 'producer',
          output_schema: {
            type: 'object',
            properties: {
              emails: { type: 'array', items: {} },
            },
          },
        }),
        makeFlattenStep({
          step_id: 'step2',
          input: '{{producer}}',
          field: 'emails',
        }),
      ];

      const issues = await scanFor(steps, 'invalid_flatten_field');
      expect(issues).toHaveLength(0);
    });
  });

  describe('autoFix proposal for per-item-nested issues', () => {
    it('proposes a per-item fix using the nested priority list (attachments first)', async () => {
      const steps = [
        makeProducerStep({
          step_id: 'step1',
          output_variable: 'matching_emails',
          output_schema: {
            type: 'object',
            properties: {
              emails: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    attachments: { type: 'array', items: {} },
                    files: { type: 'array', items: {} },
                    data: { type: 'array', items: {} },
                  },
                },
              },
            },
          },
        }),
        makeFlattenStep({
          step_id: 'step2',
          input: '{{matching_emails.emails}}',
          field: 'bogus',
        }),
      ];

      const engine = new StructuralRepairEngine();
      const agent = makeAgent(steps);
      const issues = await engine.scanWorkflow(agent as any);
      const flatIssue = issues.find(i => i.type === 'invalid_flatten_field');
      expect(flatIssue).toBeDefined();

      // proposeFix is private — exercise via autoFixWorkflow side effect.
      const repairs = await engine.autoFixWorkflow(agent as any);
      const flatRepair = repairs.find(r => r.fixApplied?.action === 'fix_flatten_field');
      expect(flatRepair?.fixed).toBe(true);
      expect(flatRepair?.fixApplied?.fix?.newField).toBe('attachments');
    });

    it('proposes a root-level fix using the root priority list (emails first) for non-navigated input', async () => {
      const steps = [
        makeProducerStep({
          step_id: 'step1',
          output_variable: 'producer',
          output_schema: {
            type: 'object',
            properties: {
              emails: { type: 'array', items: {} },
              files: { type: 'array', items: {} },
              records: { type: 'array', items: {} },
            },
          },
        }),
        makeFlattenStep({
          step_id: 'step2',
          input: '{{producer}}',
          field: 'bogus',
        }),
      ];

      const engine = new StructuralRepairEngine();
      const agent = makeAgent(steps);
      const repairs = await engine.autoFixWorkflow(agent as any);
      const flatRepair = repairs.find(r => r.fixApplied?.action === 'fix_flatten_field');
      expect(flatRepair?.fixed).toBe(true);
      expect(flatRepair?.fixApplied?.fix?.newField).toBe('emails');
    });
  });

  describe('Edge cases', () => {
    it('skips validation when no source step is found', async () => {
      const steps = [
        makeFlattenStep({
          step_id: 'step1',
          input: '{{missing_producer.emails}}',
          field: 'attachments',
        }),
      ];

      const issues = await scanFor(steps, 'invalid_flatten_field');
      expect(issues).toHaveLength(0);
    });

    it('skips validation when source has no output_schema', async () => {
      const steps = [
        {
          step_id: 'step1',
          type: 'action',
          output_variable: 'producer',
          action: 'some.action',
          params: {},
          // no output_schema
        },
        makeFlattenStep({
          step_id: 'step2',
          input: '{{producer.emails}}',
          field: 'attachments',
        }),
      ];

      const issues = await scanFor(steps, 'invalid_flatten_field');
      expect(issues).toHaveLength(0);
    });
  });
});
