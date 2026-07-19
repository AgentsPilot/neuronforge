/**
 * WP-62 regression scenario — Gmail scatter-attachment extract, deterministic-vs-AI routing.
 *
 * Drives the FULL reliable pipeline (CapabilityBinderV2 → IntentToIRConverter) over
 * the folded `95f791ed` intent-contract fixture and asserts BOTH boundaries,
 * REPEATEDLY, to prove the decision is deterministic (the bug was Phase-1
 * non-determinism; this proves reliable code now decides):
 *
 *   AC-1  covered → document-extractor bound (surface fields) + synthesized
 *         downstream generate for the meta/computed residual, identical across runs.
 *   AC-2  uncovered (unsupported file type) → AI branch (ai_processing/llm_extract),
 *         net preserved.
 *
 * Phase A/D/E (live LLM Phase-1 + Gmail + Textract) are NOT run here — no live
 * credentials in the Dev self-test env. See scenario.json phase_e_caveat.
 */
import { CapabilityBinderV2 } from '@/lib/agentkit/v6/capability-binding/CapabilityBinderV2'
import { IntentToIRConverter } from '@/lib/agentkit/v6/compiler/IntentToIRConverter'
import googleMailDef from '@/lib/plugins/definitions/google-mail-plugin-v2.json'
import documentExtractorDef from '@/lib/plugins/definitions/document-extractor-plugin-v2.json'
import intentContract from './intent-contract.json'

const DEFS: Record<string, any> = {
  'google-mail': googleMailDef,
  'document-extractor': documentExtractorDef,
}

function makePluginManager() {
  return {
    getExecutablePlugins: jest.fn().mockResolvedValue({
      'google-mail': { definition: googleMailDef, connection: { plugin_key: 'google-mail', status: 'active' } },
    }),
    getAvailablePlugins: jest.fn().mockReturnValue({ 'document-extractor': documentExtractorDef }),
    getPluginDefinition: jest.fn((key: string) => DEFS[key]),
    getActionDefinition: jest.fn((key: string, action: string) => DEFS[key]?.actions?.[action]),
  } as any
}

/** Deep-clone the fixture so each run starts from a pristine IntentContract. */
function freshIC(mutate?: (ic: any) => void) {
  const ic = JSON.parse(JSON.stringify(intentContract))
  delete ic._note
  ic.steps.forEach((s: any) => delete s._note)
  if (mutate) mutate(ic)
  return ic
}

async function runPipeline(ic: any) {
  const pm = makePluginManager()
  const bound = await new CapabilityBinderV2(pm).bind(ic, 'test-user')
  const result = new IntentToIRConverter(pm).convert(bound)
  const nodes = Object.values(result.ir?.execution_graph?.nodes || {}) as any[]
  return { bound, result, nodes }
}

const extractOf = (bound: any) =>
  bound.steps.find((s: any) => s.kind === 'loop').loop.do.find((s: any) => s.id === 'extract')

describe('WP-62 scenario — gmail-scatter-attachment-extract', () => {
  it('AC-1: covered folded extract → document-extractor deliver (surface) + synthesized generate (residual)', async () => {
    const { bound, nodes } = await runPipeline(freshIC())

    const extract = extractOf(bound)
    expect(extract.plugin_key).toBe('document-extractor')
    expect(extract.extract_coverage.covered).toBe(true)

    // Deterministic deliver node (surface fields only).
    const deliver = nodes.find(
      (n) => n.operation?.operation_type === 'deliver' &&
        n.operation.deliver?.plugin_key === 'document-extractor',
    )
    expect(deliver).toBeDefined()
    const deliverFields = (deliver.operation.deliver.config.fields || []).map((f: any) => f.name)
    expect(deliverFields).toEqual(['date_time', 'vendor', 'amount', 'expense_type'])

    // Synthesized residual generate node (WP-62 split).
    const generate = nodes.find(
      (n) => n.operation?.operation_type === 'ai' &&
        n.operation.ai?.type === 'generate' &&
        /WP-62 split/.test(n.operation.description || ''),
    )
    expect(generate).toBeDefined()
    expect(generate.operation.ai.instruction).toMatch(/UNCHANGED/)

    // No AI llm_extract node — the fold did NOT land on the AI branch.
    const aiExtract = nodes.find((n) => n.operation?.ai?.type === 'llm_extract')
    expect(aiExtract).toBeUndefined()
  })

  it('WP-62 hotfix: compiled file_content resolves to the STRING bytes ref, not the whole object (live agent 2ffcd7bf)', async () => {
    // The fixture's `extract.input` is a WHOLE-OBJECT ref (`attachment_content`) —
    // exactly what live Phase 1 emitted on agent 2ffcd7bf. Reliable code must
    // navigate to the producer's bytes field regardless of Phase-1 ref granularity.
    const { nodes } = await runPipeline(freshIC())
    const deliver = nodes.find((n) => n.operation?.deliver?.plugin_key === 'document-extractor')
    expect(deliver).toBeDefined()
    // Pre-hotfix: "attachment_content" → runtime "file_content should be string, got object".
    expect(deliver.operation.deliver.config.file_content).toBe('attachment_content.data')
    expect(deliver.operation.deliver.config.input).toBeUndefined()
  })

  it('AC-1 determinism: 5 repeated pipeline runs yield an identical routing verdict', async () => {
    const fingerprints: string[] = []
    for (let i = 0; i < 5; i++) {
      const { bound, nodes } = await runPipeline(freshIC())
      const extract = extractOf(bound)
      const deliver = nodes.find((n) => n.operation?.deliver?.plugin_key === 'document-extractor')
      const generate = nodes.find(
        (n) => n.operation?.ai?.type === 'generate' && /WP-62 split/.test(n.operation.description || ''),
      )
      fingerprints.push(
        JSON.stringify({
          plugin: extract.plugin_key,
          covered: extract.extract_coverage.covered,
          surface: extract.extract_coverage.surfaceFields.map((f: any) => f.name),
          residual: extract.extract_coverage.residualFields.map((f: any) => f.name),
          deliverFields: (deliver?.operation.deliver.config.fields || []).map((f: any) => f.name),
          hasGenerate: !!generate,
        }),
      )
    }
    expect(new Set(fingerprints).size).toBe(1)
    expect(fingerprints[0]).toContain('document-extractor')
  })

  it('AC-2: unsupported file type (xlsx) → AI branch (llm_extract), net preserved', async () => {
    const { bound, nodes } = await runPipeline(
      freshIC((ic) => {
        const ex = ic.steps.find((s: any) => s.kind === 'loop').loop.do.find((s: any) => s.id === 'extract')
        ex.extract.content_hints.file_types = ['xlsx']
      }),
    )
    const extract = extractOf(bound)
    expect(extract.plugin_key).toBeUndefined()
    expect(extract.extract_coverage.decidingCriterion).toBe('CC-4')

    const aiExtract = nodes.find((n) => n.operation?.ai?.type === 'llm_extract')
    expect(aiExtract).toBeDefined()
    const deliver = nodes.find((n) => n.operation?.deliver?.plugin_key === 'document-extractor')
    expect(deliver).toBeUndefined()
  })
})
