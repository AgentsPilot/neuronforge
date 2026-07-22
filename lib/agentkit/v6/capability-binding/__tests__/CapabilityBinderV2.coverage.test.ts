/**
 * WP-62 — CapabilityBinderV2 Phase 2c authors the deterministic-vs-AI coverage
 * verdict for the proven scatter-attachment shape
 * (search_emails → scatter[get_email_attachment → extract]).
 *
 * AC-1: a covered case binds the deterministic document-extractor deterministically
 *       across repeated binds (the today-bug fixed).
 * AC-2: uncovered cases (unsupported file type / only meta fields / no connected
 *       extractor) leave the extract unbound so the converter's AI net fires.
 */
import { CapabilityBinderV2 } from '../CapabilityBinderV2'
import googleMailDef from '@/lib/plugins/definitions/google-mail-plugin-v2.json'
import documentExtractorDef from '@/lib/plugins/definitions/document-extractor-plugin-v2.json'

const DEFS: Record<string, any> = {
  'google-mail': googleMailDef,
  'document-extractor': documentExtractorDef,
}

function makeBinder(opts: { withSystemExtractor?: boolean } = {}) {
  const { withSystemExtractor = true } = opts
  const pluginManager = {
    getExecutablePlugins: jest.fn().mockResolvedValue({
      'google-mail': { definition: googleMailDef, connection: { plugin_key: 'google-mail', status: 'active' } },
    }),
    getAvailablePlugins: jest.fn().mockReturnValue(
      withSystemExtractor ? { 'document-extractor': documentExtractorDef } : {},
    ),
    getPluginDefinition: jest.fn((key: string) => DEFS[key]),
    getActionDefinition: jest.fn((key: string, action: string) => DEFS[key]?.actions?.[action]),
  } as any
  return new CapabilityBinderV2(pluginManager)
}

function scatterIC(extractOverrides: any) {
  return {
    version: 'intent.v1',
    goal: 'summarize expense attachments',
    steps: [
      {
        id: 'search', kind: 'data_source', summary: 'search emails',
        uses: [{ capability: 'search', domain: 'email' }],
        output: 'expense_emails', source: { domain: 'email', intent: 'search' },
      },
      {
        id: 'loop', kind: 'loop', summary: 'per attachment',
        loop: {
          over: 'expense_emails', item_ref: 'attachment_item',
          do: [
            {
              id: 'fetch', kind: 'data_source', summary: 'download attachment',
              uses: [{ capability: 'download', domain: 'email' }],
              output: 'attachment_content', source: { domain: 'email', intent: 'download' },
            },
            {
              id: 'extract', kind: 'extract', summary: 'extract expense fields',
              uses: [{ capability: 'extract_structured_data', domain: 'document' }],
              output: 'extracted',
              extract: extractOverrides,
            },
          ],
        },
      },
    ],
  } as any
}

const getExtract = (bound: any) =>
  bound.steps.find((s: any) => s.kind === 'loop').loop.do.find((s: any) => s.id === 'extract')

const FOLDED_EXTRACT = {
  input: 'attachment_content',
  content_hints: { file_types: ['pdf', 'jpg', 'png'] },
  fields: [
    { name: 'date_time', type: 'date', source: 'document' },
    { name: 'vendor', type: 'string', source: 'document' },
    { name: 'amount', type: 'currency', source: 'document' },
    { name: 'expense_type', type: 'string', source: 'document' },
    { name: 'notes', type: 'string', source: 'computed' },
    { name: 'source_filename', type: 'string', source: 'meta' },
  ],
}

describe('CapabilityBinderV2 — WP-62 Phase 2c extraction coverage routing', () => {
  it('AC-1 covered: folded scatter-attachment extract binds document-extractor (surface subset) + records residual split', async () => {
    const extract = getExtract(await makeBinder().bind(scatterIC(FOLDED_EXTRACT), 'u1'))
    expect(extract.plugin_key).toBe('document-extractor')
    expect(extract.action).toBe('extract_structured_data')
    expect(extract.extract_coverage.covered).toBe(true)
    expect(extract.extract_coverage.surfaceFields.map((f: any) => f.name)).toEqual([
      'date_time', 'vendor', 'amount', 'expense_type',
    ])
    expect(extract.extract_coverage.residualFields.map((f: any) => f.name)).toEqual(['notes', 'source_filename'])
  })

  it('AC-1 determinism: repeated binds of the same intent yield the same verdict (never the AI-branch outcome)', async () => {
    const verdicts: string[] = []
    for (let i = 0; i < 5; i++) {
      const extract = getExtract(await makeBinder().bind(scatterIC(FOLDED_EXTRACT), 'u1'))
      verdicts.push(
        JSON.stringify({
          plugin: extract.plugin_key,
          action: extract.action,
          covered: extract.extract_coverage.covered,
          surface: extract.extract_coverage.surfaceFields.map((f: any) => f.name),
          residual: extract.extract_coverage.residualFields.map((f: any) => f.name),
        }),
      )
    }
    expect(new Set(verdicts).size).toBe(1)
    expect(verdicts[0]).toContain('document-extractor')
  })

  it('AC-2 CC-4: unsupported file type (xlsx) → unbound → AI net', async () => {
    const extract = getExtract(
      await makeBinder().bind(scatterIC({ ...FOLDED_EXTRACT, content_hints: { file_types: ['xlsx'] } }), 'u1'),
    )
    expect(extract.plugin_key).toBeUndefined()
    expect(extract.binding_method).toBe('unbound')
    expect(extract.extract_coverage.covered).toBe(false)
    expect(extract.extract_coverage.decidingCriterion).toBe('CC-4')
  })

  it('AC-2 CC-3/G1: only meta/computed fields → zero surface → unbound → AI net', async () => {
    const extract = getExtract(
      await makeBinder().bind(
        scatterIC({
          input: 'attachment_content',
          content_hints: { file_types: ['pdf'] },
          fields: [
            { name: 'notes', type: 'string', source: 'computed' },
            { name: 'source_filename', type: 'string', source: 'meta' },
          ],
        }),
        'u1',
      ),
    )
    expect(extract.plugin_key).toBeUndefined()
    expect(extract.extract_coverage.decidingCriterion).toBe('CC-3')
  })

  it('AC-2 CC-2: no connected deterministic extractor → unbound → AI net', async () => {
    const extract = getExtract(
      await makeBinder({ withSystemExtractor: false }).bind(scatterIC(FOLDED_EXTRACT), 'u1'),
    )
    expect(extract.plugin_key).toBeUndefined()
    expect(extract.extract_coverage.decidingCriterion).toBe('CC-2')
  })
})

// ---------------------------------------------------------------------------
// SA review follow-ups (2026-07-13)
// ---------------------------------------------------------------------------

describe('WP-62 — SA Finding #1: authoritative CC-1 normalizes the input ref', () => {
  const SURFACE_ONLY = [
    { name: 'date_time', type: 'date', source: 'document' },
    { name: 'vendor', type: 'string', source: 'document' },
    { name: 'amount', type: 'currency', source: 'document' },
  ]

  it('DOTTED bytes-field input `{{attachment_content.data}}` (the well-phrased B1 shape) → CC-1 true → binds deterministically', async () => {
    const extract = getExtract(
      await makeBinder().bind(
        scatterIC({
          input: '{{attachment_content.data}}',
          content_hints: { file_types: ['pdf'] },
          fields: SURFACE_ONLY,
        }),
        'u1',
      ),
    )
    // Before the fix this resolved to "not a file" → AI fallback (the inversion).
    expect(extract.plugin_key).toBe('document-extractor')
    expect(extract.extract_coverage.covered).toBe(true)
    expect(extract.extract_coverage.decidingCriterion).toBe('covered')
  })

  it('bare dotted input `attachment_content.data` (no braces) also resolves to its producer → binds deterministically', async () => {
    const extract = getExtract(
      await makeBinder().bind(
        scatterIC({ input: 'attachment_content.data', content_hints: { file_types: ['pdf'] }, fields: SURFACE_ONLY }),
        'u1',
      ),
    )
    expect(extract.plugin_key).toBe('document-extractor')
  })
})

describe('WP-62 — SA Finding #2 (AC-3): verdict is invariant to Phase-1 PHRASING', () => {
  const SURFACE = [
    { name: 'date_time', type: 'date', source: 'document' },
    { name: 'vendor', type: 'string', source: 'document' },
    { name: 'amount', type: 'currency', source: 'document' },
    { name: 'expense_type', type: 'string', source: 'document' },
  ]
  const META = [
    { name: 'notes', type: 'string', source: 'computed' },
    { name: 'source_filename', type: 'string', source: 'meta' },
  ]

  // Four phrasings of the SAME covered file extraction — must all bind deterministic.
  const PHRASINGS: Array<[string, any]> = [
    ['whole-object input, folded fields', { input: 'attachment_content', content_hints: { file_types: ['pdf'] }, fields: [...SURFACE, ...META] }],
    ['dotted bytes input, folded fields', { input: '{{attachment_content.data}}', content_hints: { file_types: ['pdf'] }, fields: [...SURFACE, ...META] }],
    ['whole-object input, already-split (surface only)', { input: 'attachment_content', content_hints: { file_types: ['pdf'] }, fields: SURFACE }],
    ['dotted bytes input, already-split (surface only)', { input: 'attachment_content.data', content_hints: { file_types: ['pdf'] }, fields: SURFACE }],
  ]

  it.each(PHRASINGS)('%s → binds document-extractor for the surface subset', async (_label, extractCfg) => {
    const extract = getExtract(await makeBinder().bind(scatterIC(extractCfg), 'u1'))
    expect(extract.plugin_key).toBe('document-extractor')
    expect(extract.extract_coverage.covered).toBe(true)
    expect(extract.extract_coverage.surfaceFields.map((f: any) => f.name)).toEqual([
      'date_time', 'vendor', 'amount', 'expense_type',
    ])
  })

  it('all four phrasings converge to the SAME covered/plugin verdict (phrasing-invariance)', async () => {
    const verdicts = new Set<string>()
    for (const [, extractCfg] of PHRASINGS) {
      const extract = getExtract(await makeBinder().bind(scatterIC(extractCfg), 'u1'))
      verdicts.add(JSON.stringify({
        plugin: extract.plugin_key,
        covered: extract.extract_coverage.covered,
        surface: extract.extract_coverage.surfaceFields.map((f: any) => f.name),
      }))
    }
    expect(verdicts.size).toBe(1)
  })
})

describe('WP-62 — SA Finding #3 (R1): absent `source` degrades to the SAFE direction', () => {
  it('fields omit `source` (legacy/uncompliant LLM output) → unbound → AI net, never a force-bind', async () => {
    const extract = getExtract(
      await makeBinder().bind(
        scatterIC({
          input: 'attachment_content',
          content_hints: { file_types: ['pdf'] },
          // No `source` on any field — the R1 conservative default treats them all
          // as non-surface → zero surface → G1 → not covered → AI branch.
          fields: [
            { name: 'date_time', type: 'date' },
            { name: 'vendor', type: 'string' },
            { name: 'amount', type: 'currency' },
          ],
        }),
        'u1',
      ),
    )
    expect(extract.plugin_key).toBeUndefined()
    expect(extract.binding_method).toBe('unbound')
    expect(extract.extract_coverage.covered).toBe(false)
    expect(extract.extract_coverage.decidingCriterion).toBe('CC-3')
    // Safety: no surface fields fabricated as covered.
    expect(extract.extract_coverage.surfaceFields).toHaveLength(0)
  })

  it('partial `source` (only some fields annotated) binds ONLY the annotated surface fields (no over-reach)', async () => {
    const extract = getExtract(
      await makeBinder().bind(
        scatterIC({
          input: 'attachment_content',
          content_hints: { file_types: ['pdf'] },
          fields: [
            { name: 'vendor', type: 'string', source: 'document' },
            { name: 'amount', type: 'currency' }, // unannotated → residual (safe)
          ],
        }),
        'u1',
      ),
    )
    expect(extract.plugin_key).toBe('document-extractor')
    expect(extract.extract_coverage.surfaceFields.map((f: any) => f.name)).toEqual(['vendor'])
    expect(extract.extract_coverage.residualFields.map((f: any) => f.name)).toEqual(['amount'])
  })
})
