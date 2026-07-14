import { buildV6AiContext } from '../buildV6AiContext'

/**
 * A2 de-dup: ai_context is now LEAN — only the two WP-55 fields with no column
 * (`intent_contract`, `data_schema`). These assertions pin that the WP-55
 * artifacts persist non-null when the pipeline emits them, and that nothing else
 * is written (the narrative fields moved to columns).
 */
describe('buildV6AiContext', () => {
  it('persists intent_contract and data_schema when the pipeline emits them', () => {
    const intentContract = { intent: 'summarize', slots: [{ key: 'range' }] }
    const dataSchema = { properties: { range: { type: 'string' } } }
    const ctx = buildV6AiContext({ intentContract, dataSchema })
    expect(ctx.intent_contract).toBe(intentContract)
    expect(ctx.data_schema).toBe(dataSchema)
  })

  it('coalesces absent (undefined) artifacts to null (Pipeline B / edge)', () => {
    const ctx = buildV6AiContext({})
    expect(ctx.intent_contract).toBeNull()
    expect(ctx.data_schema).toBeNull()
  })

  it('coalesces explicit null to null', () => {
    const ctx = buildV6AiContext({ intentContract: null, dataSchema: null })
    expect(ctx.intent_contract).toBeNull()
    expect(ctx.data_schema).toBeNull()
  })

  it('preserves a falsy-but-defined artifact (?? not ||)', () => {
    const ctx = buildV6AiContext({ intentContract: false, dataSchema: 0 })
    expect(ctx.intent_contract).toBe(false)
    expect(ctx.data_schema).toBe(0)
  })

  it('writes ONLY intent_contract + data_schema — the narrative fields are gone', () => {
    const ctx = buildV6AiContext({ intentContract: { a: 1 }, dataSchema: { b: 2 } })
    expect(Object.keys(ctx).sort()).toEqual(['data_schema', 'intent_contract'])
  })

  it('mirrors the save-site merge: WP-55 fields survive the agent_config assignment', () => {
    const intentContract = { intent: 'summarize' }
    const v6Agent = { agent_name: 'X' }
    const agentConfig = {
      creation_metadata: { version: '6.0' },
      ai_context: buildV6AiContext({ intentContract, dataSchema: { a: 1 } }),
    }
    const agentData = { ...v6Agent, agent_config: agentConfig }
    expect(agentData.agent_config.ai_context.intent_contract).toBe(intentContract)
    expect(agentData.agent_config.ai_context.data_schema).toEqual({ a: 1 })
  })
})
