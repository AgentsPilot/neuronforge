/**
 * WP-62 — ExtractionCoverage predicate (CC-1..CC-4, Q2 source partition).
 *
 * Proves the coverage judgment is schema-driven and connected-only, uses NO
 * field-name lists (classification is by declared `source`), and is conservative
 * in the safe direction (unknown → not covered → AI fallback).
 */

import documentExtractorDef from '@/lib/plugins/definitions/document-extractor-plugin-v2.json'
import {
  evaluateExtractionCoverage,
  findDeterministicDocumentExtractor,
  partitionFieldsBySource,
  outputSchemaIsFileAttachment,
  pluginSupportsFileTypes,
  baseVarOfRef,
  classifySchemaFileness,
  type ConnectedPluginsMap,
} from '../ExtractionCoverage'

const CONNECTED_WITH_EXTRACTOR: ConnectedPluginsMap = {
  'document-extractor': { definition: documentExtractorDef as any },
}
const CONNECTED_WITHOUT_EXTRACTOR: ConnectedPluginsMap = {
  'google-mail': { definition: { actions: { search_emails: { domain: 'email', capability: 'search' } } } },
}

const SURFACE_FIELDS = [
  { name: 'vendor', type: 'string', source: 'document' as const },
  { name: 'amount', type: 'currency', source: 'document' as const },
  { name: 'date', type: 'date', source: 'document' as const },
]
const META_FIELDS = [
  { name: 'source_filename', type: 'string', source: 'meta' as const },
  { name: 'notes', type: 'string', source: 'computed' as const },
]

describe('findDeterministicDocumentExtractor (CC-2) — schema-driven, connected-only', () => {
  it('discovers the connected document-extraction capability by domain+capability (no plugin key)', () => {
    const found = findDeterministicDocumentExtractor(CONNECTED_WITH_EXTRACTOR)
    expect(found).not.toBeNull()
    expect(found!.pluginKey).toBe('document-extractor')
    expect(found!.action).toBe('extract_structured_data')
  })

  it('returns null when no connected plugin declares document/extract_structured_data', () => {
    expect(findDeterministicDocumentExtractor(CONNECTED_WITHOUT_EXTRACTOR)).toBeNull()
  })
})

describe('partitionFieldsBySource (Q2) — classify by declared source, no name lists', () => {
  it('surface = source "document"; residual = meta/computed', () => {
    const { surfaceFields, residualFields } = partitionFieldsBySource([...SURFACE_FIELDS, ...META_FIELDS])
    expect(surfaceFields.map((f) => f.name)).toEqual(['vendor', 'amount', 'date'])
    expect(residualFields.map((f) => f.name)).toEqual(['source_filename', 'notes'])
  })

  it('absent source is conservatively treated as residual (never fabricates coverage)', () => {
    const { surfaceFields, residualFields } = partitionFieldsBySource([{ name: 'x', type: 'string' }])
    expect(surfaceFields).toHaveLength(0)
    expect(residualFields.map((f) => f.name)).toEqual(['x'])
  })
})

describe('baseVarOfRef (SA Finding #1 — shared ref normalization)', () => {
  it('strips {{ }} and drops the dotted tail to the base variable', () => {
    expect(baseVarOfRef('{{attachment_content.data}}')).toBe('attachment_content')
    expect(baseVarOfRef('attachment_content.data')).toBe('attachment_content')
    expect(baseVarOfRef('{{ attachment_content }}')).toBe('attachment_content')
    expect(baseVarOfRef('attachment_content')).toBe('attachment_content')
  })
})

describe('classifySchemaFileness (SA Finding #1 — shared classifier)', () => {
  it('semantic_type / x-semantic-type file → file', () => {
    expect(classifySchemaFileness({ 'x-semantic-type': 'file_attachment', properties: {} })).toBe('file')
    expect(classifySchemaFileness({ semantic_type: 'file', properties: {} })).toBe('file')
  })
  it('bytes-bearing content field → file (beats text markers)', () => {
    expect(classifySchemaFileness({ properties: { data: {}, subject: {} } })).toBe('file')
  })
  it('file-only markers → file; text-only → text; both → text (text-primary)', () => {
    expect(classifySchemaFileness({ properties: { mimeType: {}, file_url: {} } })).toBe('file')
    expect(classifySchemaFileness({ properties: { subject: {}, body: {} } })).toBe('text')
    expect(classifySchemaFileness({ properties: { mimeType: {}, body: {} } })).toBe('text')
  })
  it('no markers → unknown', () => {
    expect(classifySchemaFileness({ properties: { foo: {}, bar: {} } })).toBe('unknown')
    expect(classifySchemaFileness(null)).toBe('unknown')
  })
})

describe('outputSchemaIsFileAttachment (CC-1 signal)', () => {
  it('true on x-semantic-type: file_attachment', () => {
    expect(outputSchemaIsFileAttachment({ 'x-semantic-type': 'file_attachment', properties: {} })).toBe(true)
  })
  it('true on a bytes-bearing content field', () => {
    expect(outputSchemaIsFileAttachment({ properties: { data: { type: 'string' } } })).toBe(true)
  })
  it('false on a pure text object', () => {
    expect(outputSchemaIsFileAttachment({ properties: { subject: {}, body: {} } })).toBe(false)
  })
})

describe('pluginSupportsFileTypes (CC-4) — derived from must_support flags', () => {
  const action = (documentExtractorDef as any).actions.extract_structured_data
  it('supports pdf/jpg/png (declared via must_support)', () => {
    expect(pluginSupportsFileTypes(action, ['pdf', 'jpg', 'png'])).toBe(true)
  })
  it('rejects an unsupported type (xlsx)', () => {
    expect(pluginSupportsFileTypes(action, ['xlsx'])).toBe(false)
  })
  it('passes when no file types are declared (defer to extractor)', () => {
    expect(pluginSupportsFileTypes(action, undefined)).toBe(true)
  })
})

describe('evaluateExtractionCoverage — ordered CC-1..CC-4 decision', () => {
  it('AC-1 covered: file input + connected extractor + surface fields → covered + split', () => {
    const v = evaluateExtractionCoverage({
      fields: [...SURFACE_FIELDS, ...META_FIELDS],
      fileTypes: ['pdf', 'jpg', 'png'],
      inputIsFile: true,
      connectedPlugins: CONNECTED_WITH_EXTRACTOR,
    })
    expect(v.covered).toBe(true)
    expect(v.decidingCriterion).toBe('covered')
    expect(v.deterministicPlugin).toEqual({ pluginKey: 'document-extractor', action: 'extract_structured_data' })
    expect(v.surfaceFields.map((f) => f.name)).toEqual(['vendor', 'amount', 'date'])
    expect(v.residualFields.map((f) => f.name)).toEqual(['source_filename', 'notes'])
  })

  it('covered, no split when all fields are surface (G3 residual empty)', () => {
    const v = evaluateExtractionCoverage({
      fields: SURFACE_FIELDS,
      inputIsFile: true,
      connectedPlugins: CONNECTED_WITH_EXTRACTOR,
    })
    expect(v.covered).toBe(true)
    expect(v.residualFields).toHaveLength(0)
  })

  it('AC-2 CC-1 fail: text input → not covered', () => {
    const v = evaluateExtractionCoverage({
      fields: SURFACE_FIELDS,
      inputIsFile: false,
      connectedPlugins: CONNECTED_WITH_EXTRACTOR,
    })
    expect(v.covered).toBe(false)
    expect(v.decidingCriterion).toBe('CC-1')
  })

  it('AC-2 CC-2 fail: no connected extractor → not covered', () => {
    const v = evaluateExtractionCoverage({
      fields: SURFACE_FIELDS,
      inputIsFile: true,
      connectedPlugins: CONNECTED_WITHOUT_EXTRACTOR,
    })
    expect(v.covered).toBe(false)
    expect(v.decidingCriterion).toBe('CC-2')
  })

  it('AC-2 CC-4 fail: unsupported file type → not covered', () => {
    const v = evaluateExtractionCoverage({
      fields: SURFACE_FIELDS,
      fileTypes: ['xlsx'],
      inputIsFile: true,
      connectedPlugins: CONNECTED_WITH_EXTRACTOR,
    })
    expect(v.covered).toBe(false)
    expect(v.decidingCriterion).toBe('CC-4')
  })

  it('AC-2 CC-3 fail (G1): only meta/computed fields → zero surface → not covered', () => {
    const v = evaluateExtractionCoverage({
      fields: META_FIELDS,
      inputIsFile: true,
      connectedPlugins: CONNECTED_WITH_EXTRACTOR,
    })
    expect(v.covered).toBe(false)
    expect(v.decidingCriterion).toBe('CC-3')
  })

  it('AC-3 determinism: identical inputs yield an identical verdict across repeated calls', () => {
    const run = () =>
      evaluateExtractionCoverage({
        fields: [...SURFACE_FIELDS, ...META_FIELDS],
        fileTypes: ['pdf'],
        inputIsFile: true,
        connectedPlugins: CONNECTED_WITH_EXTRACTOR,
      })
    const first = JSON.stringify(run())
    for (let i = 0; i < 5; i++) expect(JSON.stringify(run())).toBe(first)
  })
})
