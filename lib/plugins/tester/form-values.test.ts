// lib/plugins/tester/form-values.test.ts
import {
  assembleParameters,
  canRun,
  computeMissingRequired,
  getByPath,
  parseScalarArray,
  seedInitialValues,
  seedRow,
  setByPath,
} from './form-values';
import { buildFormFields } from './schema-to-form';
import type { ActionSchema, FormFieldDescriptor, JsonSchemaObject } from './tester-types';

function fields(params: JsonSchemaObject, required: string[] = []): FormFieldDescriptor[] {
  const schema: ActionSchema = {
    name: 't',
    parameters: params,
    required_params: required,
    optional_params: [],
  };
  return buildFormFields(schema);
}

describe('parseScalarArray', () => {
  it('splits comma/newline input and trims', () => {
    expect(parseScalarArray('a, b\nc')).toEqual(['a', 'b', 'c']);
  });
  it('coerces number item types', () => {
    expect(parseScalarArray('1, 2, 3', 'number')).toEqual([1, 2, 3]);
  });
  it('passes through arrays', () => {
    expect(parseScalarArray(['x'])).toEqual(['x']);
  });
});

describe('getByPath / setByPath', () => {
  it('reads and immutably sets nested paths incl. array indices', () => {
    const root = { a: { b: [{ c: 1 }] } };
    expect(getByPath(root, ['a', 'b', 0, 'c'])).toBe(1);
    const next = setByPath(root, ['a', 'b', 0, 'c'], 9);
    expect(getByPath(next, ['a', 'b', 0, 'c'])).toBe(9);
    expect(root.a.b[0].c).toBe(1); // original untouched
  });

  it('creates intermediate containers', () => {
    const next = setByPath({}, ['x', 0, 'y'], 'v');
    expect(next).toEqual({ x: [{ y: 'v' }] });
  });
});

describe('required validation (nested)', () => {
  const f = fields(
    {
      type: 'object',
      properties: { name: { type: 'string' }, max: { type: 'number' } },
    },
    ['name']
  );

  it('flags empty required scalar', () => {
    expect(computeMissingRequired(f, { name: '', max: '' })).toEqual(['name']);
  });
  it('passes when required filled', () => {
    expect(canRun(f, { name: 'x', max: '' })).toBe(true);
  });

  it('requires ≥1 row for a required object-array', () => {
    const oa = fields(
      {
        type: 'object',
        properties: {
          rows: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } },
        },
      },
      ['rows']
    );
    expect(computeMissingRequired(oa, { rows: [] })).toEqual(['rows']);
    expect(computeMissingRequired(oa, { rows: [{ a: 'x' }] })).toEqual([]);
  });

  it('validates a required leaf inside a nested object', () => {
    const nested = fields(
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
      ['start']
    );
    // Fully-empty required object → flags the object itself.
    expect(computeMissingRequired(nested, { start: { dateTime: '', timeZone: '' } })).toEqual(['start']);
    // Partially filled → flags the specific required leaf that is missing.
    expect(computeMissingRequired(nested, { start: { dateTime: '', timeZone: 'TZ' } })).toEqual([
      'start.dateTime',
    ]);
    // All required satisfied → nothing missing.
    expect(computeMissingRequired(nested, { start: { dateTime: 'x', timeZone: '' } })).toEqual([]);
  });
});

describe('assembleParameters — reassembles nested payload from flat inputs', () => {
  it('coerces scalars and skips empty optionals', () => {
    const f = fields({
      type: 'object',
      properties: {
        name: { type: 'string' },
        max: { type: 'number' },
        flag: { type: 'boolean' },
        ids: { type: 'array', items: { type: 'string' } },
      },
    });
    expect(assembleParameters(f, { name: 'folder', max: '5', flag: true, ids: 'a, b' })).toEqual({
      name: 'folder',
      max: 5,
      flag: true,
      ids: ['a', 'b'],
    });
  });

  it('reassembles a nested object from flattened leaf values', () => {
    const f = fields({
      type: 'object',
      properties: {
        content: { type: 'object', properties: { subject: { type: 'string' }, body: { type: 'string' } } },
      },
    });
    expect(assembleParameters(f, { content: { subject: 'Hi', body: '' } })).toEqual({
      content: { subject: 'Hi' },
    });
  });

  it('reassembles an object-array from rows (dropping empty rows)', () => {
    const f = fields({
      type: 'object',
      properties: {
        attendees: {
          type: 'array',
          items: { type: 'object', properties: { email: { type: 'string' }, optional: { type: 'boolean' } } },
        },
      },
    });
    const values = { attendees: [{ email: 'a@x.com', optional: true }, { email: '', optional: false }] };
    expect(assembleParameters(f, values)).toEqual({ attendees: [{ email: 'a@x.com', optional: true }] });
  });

  it('reassembles a 2-D matrix from comma-separated rows', () => {
    const f = fields({
      type: 'object',
      properties: { values: { type: 'array', items: { type: 'array', items: { type: 'string' } } } },
    });
    expect(assembleParameters(f, { values: ['a, b', 'c, d', ''] })).toEqual({
      values: [
        ['a', 'b'],
        ['c', 'd'],
      ],
    });
  });

  it('omits empty optional text but includes false booleans', () => {
    const f = fields({ type: 'object', properties: { name: { type: 'string' }, flag: { type: 'boolean' } } });
    expect(assembleParameters(f, { name: '', flag: false })).toEqual({ flag: false });
  });
});

describe('seedInitialValues (SA decision 4)', () => {
  it('seeds nested object with empty leaves (never blank JSON)', () => {
    const f = fields({
      type: 'object',
      properties: { content: { type: 'object', properties: { subject: { type: 'string' } } } },
    });
    expect(seedInitialValues(f)).toEqual({ content: { subject: '' } });
  });

  it('seeds object-array empty (user adds rows)', () => {
    const f = fields({
      type: 'object',
      properties: { rows: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } } },
    });
    expect(seedInitialValues(f)).toEqual({ rows: [] });
  });

  it('prefers schema default, then template, for a leaf', () => {
    const f = fields({ type: 'object', properties: { name: { type: 'string', default: 'D' } } });
    expect(seedInitialValues(f, { name: 'T' })).toEqual({ name: 'D' });
    const f2 = fields({ type: 'object', properties: { name: { type: 'string' } } });
    expect(seedInitialValues(f2, { name: 'T' })).toEqual({ name: 'T' });
  });

  it('seedRow builds an empty row from itemFields', () => {
    const [oa] = fields({
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: { type: 'object', properties: { a: { type: 'string' }, n: { type: 'number' } } },
        },
      },
    });
    expect(seedRow(oa)).toEqual({ a: '', n: '' });
  });
});
