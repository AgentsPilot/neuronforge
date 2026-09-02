// lib/plugins/tester/schema-to-form.test.ts
import * as fs from 'fs';
import * as path from 'path';
import {
  buildFormFields,
  getConfirmation,
  isPresenceCheckCondition,
} from './schema-to-form';
import type { ActionSchema, JsonSchemaObject } from './tester-types';

function actionSchema(
  parameters: JsonSchemaObject,
  overrides: Partial<ActionSchema> = {}
): ActionSchema {
  return {
    name: overrides.name ?? 'test_action',
    parameters,
    required_params: overrides.required_params ?? parameters.required ?? [],
    optional_params: overrides.optional_params ?? [],
    ...overrides,
  };
}

describe('buildFormFields — control mapping (FR3)', () => {
  it('maps a plain string to a text control', () => {
    const [f] = buildFormFields(
      actionSchema({ type: 'object', properties: { title: { type: 'string', description: 'A title' } } })
    );
    expect(f.control).toBe('text');
    expect(f.label).toBe('Title');
    expect(f.description).toBe('A title');
  });

  it('maps an enum string to an enum control with options', () => {
    const [f] = buildFormFields(
      actionSchema({
        type: 'object',
        properties: { mode: { type: 'string', enum: ['a', 'b'], default: 'a' } },
      })
    );
    expect(f.control).toBe('enum');
    expect(f.enumValues).toEqual(['a', 'b']);
    expect(f.defaultValue).toBe('a');
  });

  it('maps number/integer to a number control with min/max', () => {
    const [f] = buildFormFields(
      actionSchema({
        type: 'object',
        properties: { max_results: { type: 'integer', minimum: 1, maximum: 100 } },
      })
    );
    expect(f.control).toBe('number');
    expect(f.min).toBe(1);
    expect(f.max).toBe(100);
  });

  it('maps boolean to a boolean control honoring default', () => {
    const [f] = buildFormFields(
      actionSchema({ type: 'object', properties: { flag: { type: 'boolean', default: true } } })
    );
    expect(f.control).toBe('boolean');
    expect(f.defaultValue).toBe(true);
  });

  it('maps an array of scalars to a scalar-array control', () => {
    const [f] = buildFormFields(
      actionSchema({
        type: 'object',
        properties: { calendar_ids: { type: 'array', items: { type: 'string' } } },
      })
    );
    expect(f.control).toBe('scalar-array');
    expect(f.itemType).toBe('string');
  });

  it('flattens a nested object into an object group with child descriptors (no JSON)', () => {
    const [f] = buildFormFields(
      actionSchema({
        type: 'object',
        properties: {
          content: {
            type: 'object',
            properties: { subject: { type: 'string' }, body: { type: 'string' } },
          },
        },
      })
    );
    expect(f.control).toBe('object');
    expect(f.children?.map((c) => c.name)).toEqual(['subject', 'body']);
    expect(f.children?.[0].path).toEqual(['content', 'subject']);
    expect(f.children?.[0].control).toBe('text');
  });

  it('maps an array-of-objects to an object-array repeater with itemFields', () => {
    const [f] = buildFormFields(
      actionSchema({
        type: 'object',
        properties: {
          overrides: {
            type: 'array',
            items: {
              type: 'object',
              properties: { method: { type: 'string' }, minutes: { type: 'integer' } },
            },
          },
        },
      })
    );
    expect(f.control).toBe('object-array');
    expect(f.itemFields?.map((c) => c.name)).toEqual(['method', 'minutes']);
    expect(f.itemFields?.[1].control).toBe('number');
  });

  it('maps a 2-D array to a scalar-matrix control', () => {
    const [f] = buildFormFields(
      actionSchema({
        type: 'object',
        properties: { values: { type: 'array', items: { type: 'array', items: { type: 'string' } } } },
      })
    );
    expect(f.control).toBe('scalar-matrix');
    expect(f.itemType).toBe('string');
  });

  it('flattens an object containing a scalar-array leaf', () => {
    const [f] = buildFormFields(
      actionSchema({
        type: 'object',
        properties: {
          recipients: {
            type: 'object',
            properties: { to: { type: 'array', items: { type: 'string' } } },
          },
        },
      })
    );
    expect(f.control).toBe('object');
    expect(f.children?.[0].control).toBe('scalar-array');
    expect(f.children?.[0].path).toEqual(['recipients', 'to']);
  });

  it('renders x-dynamic-options fields as labeled free-text (D4)', () => {
    const [f] = buildFormFields(
      actionSchema({
        type: 'object',
        properties: {
          file_id: {
            type: 'string',
            'x-dynamic-options': { source: 'list_files', description: 'pick a file' },
          },
        },
      })
    );
    expect(f.control).toBe('text');
    expect(f.isDynamicOption).toBe(true);
    expect(f.dynamicOptionSource).toBe('list_files');
  });
});

describe('buildFormFields — required-ness keys off required_params (SA Q5)', () => {
  it('marks required from required_params, not from templates', () => {
    const fields = buildFormFields(
      actionSchema(
        {
          type: 'object',
          properties: { a: { type: 'string' }, b: { type: 'string' } },
        },
        { required_params: ['a'] }
      )
    );
    expect(fields.find((f) => f.name === 'a')?.required).toBe(true);
    expect(fields.find((f) => f.name === 'b')?.required).toBe(false);
  });

  it('falls back to schema-level required when required_params is absent', () => {
    const schema = actionSchema({
      type: 'object',
      required: ['x'],
      properties: { x: { type: 'string' }, y: { type: 'string' } },
    });
    // Simulate absence of required_params projection.
    delete (schema as any).required_params;
    const fields = buildFormFields(schema);
    expect(fields.find((f) => f.name === 'x')?.required).toBe(true);
    expect(fields.find((f) => f.name === 'y')?.required).toBe(false);
  });

  it('marks a nested leaf required only when its object schema requires it', () => {
    const [group] = buildFormFields(
      actionSchema(
        {
          type: 'object',
          properties: {
            start: {
              type: 'object',
              required: ['dateTime'],
              properties: { dateTime: { type: 'string' }, timeZone: { type: 'string' } },
            },
          },
        },
        { required_params: [] }
      )
    );
    expect(group.control).toBe('object');
    expect(group.children?.find((c) => c.name === 'dateTime')?.required).toBe(true);
    expect(group.children?.find((c) => c.name === 'timeZone')?.required).toBe(false);
  });
});

describe('isPresenceCheckCondition — CR1 condition-shape classifier', () => {
  it.each([
    ['file_id != null', true],
    ['event_id != null', true],
    ['spreadsheet_id != null', true],
    ['label_id != null', true],
    ['file_id == null', true],
  ])('presence-check %s → %s', (cond, expected) => {
    expect(isPresenceCheckCondition(cond)).toBe(expected);
  });

  it.each([
    ['max_results > 50', false],
    ['estimated_cells > 1000', false],
    ['text_length > 5000', false],
    ['send_notifications == true', false],
    ['has_external_recipients == true', false],
    ['max_size_mb > 5', false],
  ])('threshold/boolean %s → %s', (cond, expected) => {
    expect(isPresenceCheckCondition(cond)).toBe(expected);
  });
});

// ── CR1 authoritative proof against the REAL plugin definitions ──────────────
// The classifier must resolve the blocking confirm gate to exactly the destructive
// (presence-check) actions, and must NOT block threshold-carrying reads/sends.

const DEFS_DIR = path.join(process.cwd(), 'lib', 'plugins', 'definitions');

function loadAction(pluginFile: string, actionName: string): ActionSchema {
  const raw = JSON.parse(fs.readFileSync(path.join(DEFS_DIR, pluginFile), 'utf8'));
  const def = raw.actions[actionName];
  if (!def) throw new Error(`Action ${actionName} not found in ${pluginFile}`);
  return {
    name: actionName,
    parameters: def.parameters,
    required_params: def.required_params ?? def.parameters?.required ?? [],
    optional_params: def.optional_params ?? [],
    capability: def.capability,
    idempotent: def.idempotent,
    rules: def.rules,
    output_schema: def.output_schema,
  };
}

describe('getConfirmation — CR1: destructive actions BLOCK', () => {
  const destructive: Array<[string, string]> = [
    ['google-drive-plugin-v2.json', 'delete_file'],
    ['google-drive-plugin-v2.json', 'revoke_access'],
    ['google-sheets-plugin-v2.json', 'clear_range'],
    ['google-sheets-plugin-v2.json', 'delete_rows'],
    ['google-mail-plugin-v2.json', 'delete_label'],
    // NOTE: calendar delete_event also carries `event_id != null` — a 6th presence-check
    // destructive action. The SA's "exactly 5" enumeration omitted it; the generic
    // classifier correctly blocks it (it is genuinely destructive/irreversible).
    ['google-calendar-plugin-v2.json', 'delete_event'],
  ];

  it.each(destructive)('%s %s requires a blocking confirm', (file, action) => {
    const decision = getConfirmation(loadAction(file, action));
    expect(decision.requiresConfirm).toBe(true);
    expect(typeof decision.message).toBe('string');
    expect(decision.message!.length).toBeGreaterThan(0);
  });
});

describe('getConfirmation — CR1: threshold actions do NOT block', () => {
  const nonBlocking: Array<[string, string]> = [
    ['google-drive-plugin-v2.json', 'list_files'],
    ['google-drive-plugin-v2.json', 'read_file_content'],
    ['google-sheets-plugin-v2.json', 'read_range'],
    ['google-mail-plugin-v2.json', 'send_email'],
    ['google-calendar-plugin-v2.json', 'list_events'],
  ];

  it.each(nonBlocking)('%s %s does NOT require a blocking confirm', (file, action) => {
    const decision = getConfirmation(loadAction(file, action));
    expect(decision.requiresConfirm).toBe(false);
  });

  it('send_email still surfaces its threshold confirms as advisories', () => {
    const decision = getConfirmation(loadAction('google-mail-plugin-v2.json', 'send_email'));
    expect(decision.requiresConfirm).toBe(false);
    expect(decision.advisories.length).toBeGreaterThan(0);
  });
});

describe('getConfirmation — destructive styling', () => {
  it('flags delete capability with destructive style', () => {
    const decision = getConfirmation(loadAction('google-drive-plugin-v2.json', 'delete_file'));
    expect(decision.isDestructiveStyle).toBe(true);
  });
});
