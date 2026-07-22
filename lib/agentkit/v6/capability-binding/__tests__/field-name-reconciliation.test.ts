/**
 * WP-63 — shared field-name reconciliation helper (the SINGLE normalizer/matcher
 * used by BOTH Gap A DataSchemaBuilder and Gap B ExecutionGraphCompiler).
 *
 * AC-4 (one shared normalizer, no hardcoding), AC-10 (normalized collision → no
 * ambiguous rewrite), Q2 op-classification.
 */
import {
  normalizeForFuzzy,
  buildNormalizedMap,
  collectRawFieldNames,
  reconcileFieldNames,
  isFieldPreservingOp,
  isFieldSynthesizingOp,
} from '../field-name-reconciliation'

describe('normalizeForFuzzy — the ONE normalizer', () => {
  it('lowercases and strips _ and -', () => {
    expect(normalizeForFuzzy('mime_type')).toBe('mimetype')
    expect(normalizeForFuzzy('mimeType')).toBe('mimetype')
    expect(normalizeForFuzzy('message-id')).toBe('messageid')
    expect(normalizeForFuzzy('message_id')).toBe('messageid')
  })
})

describe('buildNormalizedMap — M1 collision detection', () => {
  it('marks a normalized key AMBIGUOUS when two distinct names collide', () => {
    const { byNormalized, ambiguous } = buildNormalizedMap(['message_id', 'messageId', 'vendor'])
    expect(ambiguous.has('messageid')).toBe(true)
    expect(byNormalized.has('messageid')).toBe(false) // omitted — never rewrite to it
    expect(byNormalized.get('vendor')).toBe('vendor')
  })
  it('keeps unambiguous keys', () => {
    const { byNormalized, ambiguous } = buildNormalizedMap(['mimeType', 'filename'])
    expect(ambiguous.size).toBe(0)
    expect(byNormalized.get('mimetype')).toBe('mimeType')
  })
})

describe('collectRawFieldNames — deep', () => {
  it('collects nested field names (emails[].attachments[].mimeType)', () => {
    const schema = {
      type: 'object',
      properties: {
        emails: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              subject: {},
              attachments: { type: 'array', items: { type: 'object', properties: { mimeType: {}, filename: {} } } },
            },
          },
        },
      },
    }
    const names = collectRawFieldNames(schema)
    expect(names).toEqual(expect.arrayContaining(['emails', 'subject', 'attachments', 'mimeType', 'filename']))
  })
})

describe('reconcileFieldNames', () => {
  const producer = ['mimeType', 'filename', 'size', 'attachment_id', 'message_id', '_parentId', '_parentData']

  it('AC-2: re-cased declared field → rename to producer canonical', () => {
    const r = reconcileFieldNames(['mime_type', 'filename'], producer)
    expect(r.renames.get('mime_type')).toBe('mimeType')
    expect(r.renames.has('filename')).toBe(false) // exact match — no rename
    expect(r.unmatched).toEqual([])
  })

  it('AC-3: genuinely-absent declared field → unmatched (never dropped/renamed)', () => {
    const r = reconcileFieldNames(['foo_bar'], producer)
    expect(r.renames.size).toBe(0)
    expect(r.unmatched).toEqual(['foo_bar'])
  })

  it('AC-10: declared field hitting an ambiguous producer key → reported ambiguous, not renamed', () => {
    const collidingProducer = ['message_id', 'messageId', 'mimeType']
    const r = reconcileFieldNames(['message_ID'], collidingProducer) // no exact match, normalized collides
    expect(r.renames.size).toBe(0)
    expect(r.ambiguous).toEqual(['message_ID'])
  })

  it('AC-11: flatten builtins in the producer universe are never unmatched', () => {
    const r = reconcileFieldNames(['_parentId', '_parentData'], producer)
    expect(r.unmatched).toEqual([])
    expect(r.renames.size).toBe(0)
  })

  it('exact-match declared fields (incl. real child names) are left untouched', () => {
    const r = reconcileFieldNames(['message_id', 'attachment_id'], producer)
    expect(r.renames.size).toBe(0)
    expect(r.unmatched).toEqual([])
  })
})

describe('Q2 op classification', () => {
  it('field-preserving ops', () => {
    for (const op of ['flatten', 'filter', 'sort', 'dedupe', 'project_column', 'set_difference']) {
      expect(isFieldPreservingOp(op)).toBe(true)
      expect(isFieldSynthesizingOp(op)).toBe(false)
    }
  })
  it('field-synthesizing ops', () => {
    for (const op of ['with_fields', 'map', 'group', 'reduce', 'merge', 'select', 'custom']) {
      expect(isFieldSynthesizingOp(op)).toBe(true)
      expect(isFieldPreservingOp(op)).toBe(false)
    }
  })
})
