import { buildCreationModels } from '../buildCreationModels'

/**
 * Part B provenance builder (workplan §4). Pins that a known provider/model is
 * recorded and that an unavailable step reads as `null` (not a hollow
 * {provider:null,model:null}).
 */
describe('buildCreationModels', () => {
  it('records both steps when provider/model are known', () => {
    const m = buildCreationModels({
      enhancedPrompt: { provider: 'openai', model: 'gpt-4o' },
      agentGeneration: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    })
    expect(m.enhanced_prompt).toEqual({ provider: 'openai', model: 'gpt-4o' })
    expect(m.agent_generation).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5' })
  })

  it('nulls a step when its provenance is absent (V4 agent_generation)', () => {
    const m = buildCreationModels({
      enhancedPrompt: { provider: 'openai', model: 'gpt-4o' },
      agentGeneration: null,
    })
    expect(m.enhanced_prompt).toEqual({ provider: 'openai', model: 'gpt-4o' })
    expect(m.agent_generation).toBeNull()
  })

  it('nulls a step whose ref is empty/undefined rather than emitting a hollow ref', () => {
    expect(buildCreationModels({}).enhanced_prompt).toBeNull()
    expect(buildCreationModels({ enhancedPrompt: {} }).enhanced_prompt).toBeNull()
    expect(
      buildCreationModels({ enhancedPrompt: { provider: undefined, model: undefined } }).enhanced_prompt
    ).toBeNull()
  })

  it('keeps a partial ref (provider known, model unknown) with the missing side null', () => {
    const m = buildCreationModels({ enhancedPrompt: { provider: 'openai' } })
    expect(m.enhanced_prompt).toEqual({ provider: 'openai', model: null })
  })
})
