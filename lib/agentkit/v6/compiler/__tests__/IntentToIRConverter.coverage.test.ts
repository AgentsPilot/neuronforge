/**
 * WP-62 — IntentToIRConverter HONORS the binder's coverage verdict (Q1) and
 * auto-synthesizes the meta/computed split (Q3 / CC-3a).
 *
 * Exercises the private `convertExtract` with a minimal ConversionContext (same
 * pattern as IntentToIRConverter.wp33.test.ts) — the honor logic and split
 * synthesis don't need a full BoundIntentContract wired end-to-end.
 */
import { IntentToIRConverter } from '../IntentToIRConverter'
import type { ExtractCoverageVerdict } from '../../capability-binding/ExtractionCoverage'
import documentExtractorDef from '@/lib/plugins/definitions/document-extractor-plugin-v2.json'

function makeCtx(dataSchema?: any): any {
  return {
    nodeCounter: 0,
    nodes: new Map(),
    variableMap: new Map(),
    artifactMetadata: new Map(),
    startNode: null,
    errors: [],
    warnings: [],
    outputProducerPlugin: new Map(),
    loopItemVarStack: [],
    dataSchema,
  }
}

const SURFACE = [
  { name: 'vendor', type: 'string', source: 'document' },
  { name: 'amount', type: 'currency', source: 'document' },
]
const RESIDUAL = [
  { name: 'notes', type: 'string', source: 'computed' },
  { name: 'source_filename', type: 'string', source: 'meta' },
]

function extractStep(coverage: ExtractCoverageVerdict | undefined, plugin?: string) {
  return {
    id: 'extract',
    kind: 'extract',
    output: 'extracted',
    plugin_key: plugin,
    action: plugin ? 'extract_structured_data' : undefined,
    extract: { input: 'attachment_content', fields: [...SURFACE, ...RESIDUAL] },
    extract_coverage: coverage,
  } as any
}

function convert(step: any) {
  const converter = new IntentToIRConverter()
  const ctx = makeCtx()
  const ids: string[] = (converter as any).convertExtract(step, ctx)
  return { ids, nodes: ctx.nodes as Map<string, any> }
}

describe('WP-62 — convertExtract honors coverage verdict + synthesizes split', () => {
  it('covered + residual → deterministic deliver (surface only) THEN synthesized generate (all fields)', () => {
    const coverage: ExtractCoverageVerdict = {
      covered: true,
      decidingCriterion: 'covered',
      reason: 'covered',
      deterministicPlugin: { pluginKey: 'document-extractor', action: 'extract_structured_data' },
      surfaceFields: SURFACE as any,
      residualFields: RESIDUAL as any,
    }
    const { ids, nodes } = convert(extractStep(coverage, 'document-extractor'))

    expect(ids).toHaveLength(2)
    const deliver = nodes.get(ids[0])
    const generate = nodes.get(ids[1])

    // Deterministic deliver: document-extractor, surface fields ONLY, intermediate output.
    expect(deliver.operation.operation_type).toBe('deliver')
    expect(deliver.operation.deliver.plugin_key).toBe('document-extractor')
    expect(deliver.operation.deliver.config.fields.map((f: any) => f.name)).toEqual(['vendor', 'amount'])
    expect(deliver.outputs[0].variable).toBe('extracted__extracted')
    expect(deliver.next).toBe(ids[1])

    // Synthesized generate: AI, produces the FINAL output var with all fields, input = surface output.
    expect(generate.operation.operation_type).toBe('ai')
    expect(generate.operation.ai.type).toBe('generate')
    expect(generate.operation.ai.input).toBe('extracted__extracted')
    expect(generate.outputs[0].variable).toBe('extracted')
    expect(Object.keys(generate.operation.ai.output_schema.properties).sort()).toEqual(
      ['amount', 'notes', 'source_filename', 'vendor'],
    )
    // G2: instruction forbids fabricating/altering surface data; nulls (not placeholders) on unknown.
    expect(generate.operation.ai.instruction).toMatch(/UNCHANGED/)
    expect(generate.operation.ai.instruction).toMatch(/null/)
  })

  it('covered + no residual (G3 already-split) → single deterministic deliver, no synthesis', () => {
    const coverage: ExtractCoverageVerdict = {
      covered: true,
      decidingCriterion: 'covered',
      reason: 'covered',
      deterministicPlugin: { pluginKey: 'document-extractor', action: 'extract_structured_data' },
      surfaceFields: SURFACE as any,
      residualFields: [],
    }
    const step = extractStep(coverage, 'document-extractor')
    step.extract.fields = SURFACE
    const { ids, nodes } = convert(step)
    expect(ids).toHaveLength(1)
    const deliver = nodes.get(ids[0])
    expect(deliver.operation.operation_type).toBe('deliver')
    expect(deliver.outputs[0].variable).toBe('extracted')
  })

  it('AC-6 not covered → AI branch (unchanged), ALL fields, no plugin binding', () => {
    const coverage: ExtractCoverageVerdict = {
      covered: false,
      decidingCriterion: 'CC-2',
      reason: 'no connected extractor',
      deterministicPlugin: null,
      surfaceFields: [],
      residualFields: [...SURFACE, ...RESIDUAL] as any,
    }
    const { ids, nodes } = convert(extractStep(coverage, undefined))
    expect(ids).toHaveLength(1)
    const node = nodes.get(ids[0])
    expect(node.operation.operation_type).toBe('ai')
    expect(node.operation.ai.type).toBe('llm_extract')
    expect(node.operation.ai.output_schema.fields.map((f: any) => f.name)).toEqual([
      'vendor', 'amount', 'notes', 'source_filename',
    ])
  })
})

// ---------------------------------------------------------------------------
// WP-62 HOTFIX — file-object param must receive the producer's BYTES field.
//
// Live validation (agent `2ffcd7bf`, 2026-07-16) failed at runtime with
// "Parameter file_content should be string, got object" because Phase 1 emitted a
// WHOLE-OBJECT `extract.input` and the param mapping copied it verbatim.
//
// HONEST NOTE: the pre-hotfix fixtures only ever exercised the already-navigated
// `.data` ref shape — i.e. the tests encoded the SAME assumption as the code under
// test, which is exactly why 42 green tests missed a live-blocking bug.
// ---------------------------------------------------------------------------

// Real Gmail get_email_attachment output shape: bytes live under `data`.
const GMAIL_ATTACHMENT_SLOT = {
  type: 'object',
  'x-semantic-type': 'file_attachment',
  properties: {
    filename: { type: 'string' },
    mimeType: { type: 'string' },
    size: { type: 'integer' },
    data: { type: 'string' },
    extracted_text: { type: 'string' },
    is_image: { type: 'boolean' },
  },
}

function makeRealPluginManager() {
  return {
    getPluginDefinition: jest.fn((key: string) =>
      key === 'document-extractor' ? documentExtractorDef : undefined,
    ),
    getActionDefinition: jest.fn((key: string, action: string) =>
      key === 'document-extractor' ? (documentExtractorDef as any).actions?.[action] : undefined,
    ),
  } as any
}

const COVERED: ExtractCoverageVerdict = {
  covered: true,
  decidingCriterion: 'covered',
  reason: 'covered',
  deterministicPlugin: { pluginKey: 'document-extractor', action: 'extract_structured_data' },
  surfaceFields: SURFACE as any,
  residualFields: [],
}

/** Convert an extract whose input ref is `inputRef`, against a real document-extractor schema. */
function convertWithSlot(inputRef: string, slotSchema: any) {
  const converter = new IntentToIRConverter(makeRealPluginManager())
  const ctx = makeCtx({ slots: { attachment_content: { schema: slotSchema } } })
  const step: any = {
    id: 'extract',
    kind: 'extract',
    output: 'extracted',
    plugin_key: 'document-extractor',
    action: 'extract_structured_data',
    extract: { input: inputRef, fields: SURFACE },
    extract_coverage: COVERED,
  }
  const ids: string[] = (converter as any).convertExtract(step, ctx)
  return { ids, nodes: ctx.nodes as Map<string, any>, warnings: ctx.warnings as string[] }
}

describe('WP-62 hotfix — file_content receives the producer bytes field, not the object', () => {
  it('WHOLE-OBJECT input `attachment_content` → file_content: attachment_content.data (the live bug)', () => {
    const { ids, nodes } = convertWithSlot('attachment_content', GMAIL_ATTACHMENT_SLOT)
    const deliver = nodes.get(ids[0])
    expect(deliver.operation.deliver.plugin_key).toBe('document-extractor')
    // Pre-hotfix this was `attachment_content` (whole object) → runtime type error.
    expect(deliver.operation.deliver.config.file_content).toBe('attachment_content.data')
    expect(deliver.operation.deliver.config.input).toBeUndefined()
  })

  it('braced whole-object input `{{attachment_content}}` → attachment_content.data', () => {
    const { ids, nodes } = convertWithSlot('{{attachment_content}}', GMAIL_ATTACHMENT_SLOT)
    expect(nodes.get(ids[0]).operation.deliver.config.file_content).toBe('attachment_content.data')
  })

  it('IDEMPOTENT: already-`.data` input (the 0ee53785 shape) stays `.data` — never `.data.data`', () => {
    const { ids, nodes } = convertWithSlot('attachment_content.data', GMAIL_ATTACHMENT_SLOT)
    expect(nodes.get(ids[0]).operation.deliver.config.file_content).toBe('attachment_content.data')
  })

  it('IDEMPOTENT: braced already-`.data` input stays `.data`', () => {
    const { ids, nodes } = convertWithSlot('{{attachment_content.data}}', GMAIL_ATTACHMENT_SLOT)
    expect(nodes.get(ids[0]).operation.deliver.config.file_content).toBe('attachment_content.data')
  })

  it('schema-driven (not hardcoded): a producer whose bytes key is `content` → .content', () => {
    const driveLike = {
      type: 'object',
      'x-semantic-type': 'file_attachment',
      properties: { name: { type: 'string' }, mimeType: { type: 'string' }, content: { type: 'string' } },
    }
    const { ids, nodes } = convertWithSlot('attachment_content', driveLike)
    expect(nodes.get(ids[0]).operation.deliver.config.file_content).toBe('attachment_content.content')
  })

  it('SAFE DIRECTION: object with NO bytes field → no broken ref emitted; falls back to the AI net', () => {
    const noBytes = {
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' }, webViewLink: { type: 'string' } },
    }
    const { ids, nodes, warnings } = convertWithSlot('attachment_content', noBytes)
    const node = nodes.get(ids[ids.length - 1])
    expect(node.operation.operation_type).toBe('ai')
    expect(node.operation.ai.type).toBe('llm_extract')
    expect(warnings.some((w) => /no bytes field/i.test(w))).toBe(true)
  })

  it('unknown slot (no data_schema entry) keeps the legacy verbatim copy — no behaviour change', () => {
    const converter = new IntentToIRConverter(makeRealPluginManager())
    const ctx = makeCtx({ slots: {} })
    const step: any = {
      id: 'extract', kind: 'extract', output: 'extracted',
      plugin_key: 'document-extractor', action: 'extract_structured_data',
      extract: { input: 'some_download_bytes', fields: SURFACE },
      extract_coverage: COVERED,
    }
    const ids: string[] = (converter as any).convertExtract(step, ctx)
    const deliver = (ctx.nodes as Map<string, any>).get(ids[0])
    expect(deliver.operation.deliver.config.file_content).toBe('some_download_bytes')
  })
})
