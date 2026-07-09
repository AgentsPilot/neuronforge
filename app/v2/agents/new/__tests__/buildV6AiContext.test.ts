import { buildV6AiContext } from '../buildV6AiContext'

/**
 * Regression coverage for the WP-55 IntentContract persistence clobber.
 *
 * Root cause (RCA Addendum): the V6 save path built `ai_context` twice and the
 * inline copy — which omitted intent_contract/data_schema — overrode the copy
 * that had them, so every V6 agent persisted `null` for both. These assertions
 * pin the exact property WP-55 requires: when the pipeline emits an
 * IntentContract / data_schema, the persisted ai_context carries them non-null.
 * They fail if the helper is ever reverted to drop those fields.
 */
describe('buildV6AiContext', () => {
  const base = {
    reasoning: 'Generated via V6.',
    confidence: 0.9,
    originalPrompt: 'summarize my expenses',
    enhancedPrompt: 'Summarize the last 10 expense emails…',
  }

  it('persists intent_contract and data_schema when the pipeline emits them (WP-55 happy path)', () => {
    const intentContract = { intent: 'summarize', slots: [{ key: 'range' }] }
    const dataSchema = { properties: { range: { type: 'string' } } }

    const ctx = buildV6AiContext({ ...base, intentContract, dataSchema })

    expect(ctx.intent_contract).toBe(intentContract)
    expect(ctx.data_schema).toBe(dataSchema)
    expect(ctx.intent_contract).not.toBeNull()
    expect(ctx.data_schema).not.toBeNull()
  })

  it('coalesces absent (undefined) artifacts to null without crashing (Pipeline B / edge)', () => {
    const ctx = buildV6AiContext({ ...base }) // intentContract/dataSchema omitted

    expect(ctx.intent_contract).toBeNull()
    expect(ctx.data_schema).toBeNull()
  })

  it('coalesces explicit null artifacts to null', () => {
    const ctx = buildV6AiContext({ ...base, intentContract: null, dataSchema: null })

    expect(ctx.intent_contract).toBeNull()
    expect(ctx.data_schema).toBeNull()
  })

  it('preserves an empty-object contract rather than nulling it', () => {
    // A real-but-empty IntentContract must survive (both `??` and `||` keep a
    // truthy `{}`; this pins that an empty contract is not treated as "absent").
    const ctx = buildV6AiContext({ ...base, intentContract: {}, dataSchema: {} })

    expect(ctx.intent_contract).toEqual({})
    expect(ctx.data_schema).toEqual({})
  })

  it('uses nullish coalescing, not truthiness: a falsy-but-defined artifact is preserved', () => {
    // Guards the exact operator choice — `?? null` keeps a defined-but-falsy
    // value, whereas a regression to `|| null` would drop it to null.
    const ctx = buildV6AiContext({ ...base, intentContract: false, dataSchema: 0 })

    expect(ctx.intent_contract).toBe(false)
    expect(ctx.data_schema).toBe(0)
  })

  it('always emits the five required narrative fields, defaulting empties', () => {
    const ctx = buildV6AiContext({
      reasoning: '',
      confidence: 0,
      originalPrompt: '',
      enhancedPrompt: '',
    })

    expect(ctx).toMatchObject({
      reasoning: '',
      confidence: 0,
      original_prompt: '',
      enhanced_prompt: '',
      generated_plan: '',
      intent_contract: null,
      data_schema: null,
    })
  })

  it('mirrors the save-site merge: the clobber that dropped WP-55 fields is closed', () => {
    // Reproduces `agentData = { ...v6Agent, agent_config: { ai_context } }`.
    // Pre-fix, v6Agent.agent_config.ai_context (with IC) was overwritten by an
    // inline ai_context WITHOUT the IC. Now there is one builder, so the merged
    // result must retain intent_contract.
    const intentContract = { intent: 'summarize' }
    const v6Agent = { agent_name: 'X', agent_config: { ai_context: { intent_contract: intentContract } } }
    const agentConfig = {
      creation_metadata: { version: '6.0' },
      ai_context: buildV6AiContext({ ...base, intentContract, dataSchema: { a: 1 } }),
    }

    const agentData = { ...v6Agent, agent_config: agentConfig }

    expect(agentData.agent_config.ai_context.intent_contract).toBe(intentContract)
    expect(agentData.agent_config.ai_context.data_schema).toEqual({ a: 1 })
  })
})
