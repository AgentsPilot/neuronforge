/**
 * StepExecutor — Item 8 (Finding 2, runtime slice): plugin→plugin object handoff.
 *
 * The RCA agent 0ee53785 wired `file_content: "{{attachment_content}}"` — the whole
 * attachment OBJECT into a string param — so it was JSON-stringified in transit, the
 * extractor saw `application/octet-stream`, and every extraction failed. The fix:
 * when the consumer param DECLARES it accepts an object (schema-driven — an
 * `x-input-mapping.accepts` entry naming an object form, or an object `type`), the
 * whole object is passed through un-stringified so the executor's object branch can
 * read `.data`/`.mimeType`/`.filename`. Zero plugin-name branches.
 */

const mockPluginDef = {
  actions: {
    extract_structured_data: {
      parameters: {
        type: 'object',
        required: [],
        properties: {
          // Declares object acceptance via x-input-mapping (the generic signal).
          file_content: { type: 'string', 'x-input-mapping': { accepts: ['file_object'], from_file_object: 'content' } },
          // A plain string param with NO object-acceptance → must still stringify.
          note: { type: 'string' },
        },
      },
    },
  },
};

// `uuid` (transitively imported by StepExecutor's module graph) ships ESM-only,
// which ts-jest does not transform by default → mock it to a CJS stub.
jest.mock('uuid', () => ({
  v4: () => '00000000-0000-4000-8000-000000000000',
  v1: () => '00000000-0000-1000-8000-000000000000',
  validate: () => true,
  version: () => 4,
  NIL: '00000000-0000-0000-0000-000000000000',
}));

jest.mock('@/lib/server/plugin-manager-v2', () => ({
  __esModule: true,
  PluginManagerV2: {
    getInstance: jest.fn().mockResolvedValue({
      getPluginDefinition: (_name: string) => mockPluginDef,
    }),
  },
  default: { getInstance: jest.fn() },
}));

import { StepExecutor } from '../StepExecutor';

function makeExecutor(): any {
  return new StepExecutor({} as any) as any;
}

const attachmentObject = { data: 'BASE64==', mimeType: 'application/pdf', filename: 'a.pdf' };

describe('paramAcceptsObject (Item 8 generic signal)', () => {
  const exec = makeExecutor();
  it('recognises an x-input-mapping.accepts object form', () => {
    expect(exec.paramAcceptsObject({ type: 'string', 'x-input-mapping': { accepts: ['file_object'] } })).toBe(true);
  });
  it('recognises an explicit object type / union', () => {
    expect(exec.paramAcceptsObject({ type: 'object' })).toBe(true);
    expect(exec.paramAcceptsObject({ type: ['string', 'object'] })).toBe(true);
  });
  it('returns false for a plain scalar param', () => {
    expect(exec.paramAcceptsObject({ type: 'string' })).toBe(false);
    expect(exec.paramAcceptsObject({ type: 'string', 'x-input-mapping': { accepts: ['url_string'] } })).toBe(false);
  });
});

describe('transformParametersForPlugin — object passthrough (Item 8)', () => {
  it('passes a whole-object value through UN-stringified when the param accepts an object (happy path)', async () => {
    const out = await makeExecutor().transformParametersForPlugin(
      'document-extractor',
      'extract_structured_data',
      { file_content: attachmentObject },
      {} as any
    );
    expect(typeof out.file_content).toBe('object');
    expect(out.file_content.mimeType).toBe('application/pdf');
    expect(out.file_content.data).toBe('BASE64==');
  });

  it('failure path: a plain string param that does NOT accept an object still gets stringified (no behavior change)', async () => {
    const out = await makeExecutor().transformParametersForPlugin(
      'document-extractor',
      'extract_structured_data',
      { note: { a: 1 } },
      {} as any
    );
    expect(typeof out.note).toBe('string');
    expect(out.note).toContain('"a": 1');
  });

  it('a scalar string value on an object-accepting param is untouched (no regression)', async () => {
    const out = await makeExecutor().transformParametersForPlugin(
      'document-extractor',
      'extract_structured_data',
      { file_content: 'BASE64==' },
      {} as any
    );
    expect(out.file_content).toBe('BASE64==');
  });
});
