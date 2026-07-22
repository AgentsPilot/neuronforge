import { buildV6Metadata } from '../buildV6Metadata'

/**
 * A2 Option A telemetry builder. SA rulings: phase_times_ms verbatim; no
 * column-duplicating fields (generated_at/plugins_used); omit null confidences.
 */
describe('buildV6Metadata', () => {
  const full = {
    architecture: 'intent_contract_pipeline_a',
    total_time_ms: 4200,
    phase_times_ms: { vocabulary: 10, intent_generation: 3000, compilation: 900 },
    steps_generated: 7,
    plugins_used: ['google-mail'],
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    grounding_confidence: null as number | null,
  }

  it('captures the core telemetry fields verbatim', () => {
    const m = buildV6Metadata(full)!
    expect(m.architecture).toBe('intent_contract_pipeline_a')
    expect(m.total_time_ms).toBe(4200)
    expect(m.phase_times_ms).toEqual({ vocabulary: 10, intent_generation: 3000, compilation: 900 })
    expect(m.steps_generated).toBe(7)
  })

  it('does NOT store column-duplicating fields (no generated_at, no plugins_used)', () => {
    const m = buildV6Metadata(full)!
    expect(m).not.toHaveProperty('generated_at')
    expect(m).not.toHaveProperty('plugins_used')
    expect(m).not.toHaveProperty('provider') // provenance lives in `models`, not here
  })

  it('omits grounding_confidence when null (pipeline A)', () => {
    const m = buildV6Metadata(full)!
    expect(m).not.toHaveProperty('grounding_confidence')
  })

  it('includes grounding_confidence + formalization_confidence when present', () => {
    const m = buildV6Metadata({ ...full, grounding_confidence: 0.8, formalization_confidence: 0.9 })!
    expect(m.grounding_confidence).toBe(0.8)
    expect(m.formalization_confidence).toBe(0.9)
  })

  it('returns null when there is no metadata (non-V6 path)', () => {
    expect(buildV6Metadata(null)).toBeNull()
    expect(buildV6Metadata(undefined)).toBeNull()
  })
})
