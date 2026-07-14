import {
  getAgentAiContextView,
  parseEnhancedPromptData,
  renderEnhancedPrompt,
  type AgentAiContextRow,
} from '../agentAiContextView'

/**
 * Coverage for the canonical ai_context read path (workplan §3 A1 / §7).
 * Pins the two invariants the de-dup relies on:
 *  - column-first, JSONB-fallback → identical output for lean and fat rows
 *  - on disagreement the COLUMN wins (it is the source of truth)
 */

const STRUCTURED = {
  plan_title: 'Weekly expense report',
  plan_description: 'Summarize expense emails into a table.',
  sections: { data: 'Read Gmail', output: 'Write a table' },
  specifics: { resolved_user_inputs: [{ key: 'range', value: 'A1:C10' }] },
}

// A future "lean" row: columns hold the truth; ai_context keeps only the orphans.
function leanRow(): AgentAiContextRow {
  return {
    ai_reasoning: 'Generated via V6.',
    ai_confidence: 0.9,
    created_from_prompt: 'summarize my expenses',
    generated_plan: '',
    user_prompt: JSON.stringify(STRUCTURED),
    agent_config: {
      creation_metadata: { version: '6.0' },
      ai_context: { intent_contract: { intent: 'summarize' }, data_schema: { a: 1 } },
    },
  }
}

// A legacy "fat" row: columns null/absent; everything lived in ai_context.
function fatRow(): AgentAiContextRow {
  return {
    ai_reasoning: null,
    ai_confidence: null,
    created_from_prompt: null,
    generated_plan: null,
    user_prompt: 'summarize my expenses', // raw prompt, not JSON
    agent_config: {
      ai_context: {
        reasoning: 'legacy reasoning',
        confidence: 0.8,
        original_prompt: 'summarize my expenses',
        enhanced_prompt: 'LEGACY FLAT ENHANCED PROMPT',
        generated_plan: 'legacy plan',
        intent_contract: null,
        data_schema: null,
      },
    },
  }
}

describe('getAgentAiContextView', () => {
  it('lean row: reads canonical columns + JSONB-only orphans', () => {
    const v = getAgentAiContextView(leanRow())
    expect(v.reasoning).toBe('Generated via V6.')
    expect(v.confidence).toBe(0.9)
    expect(v.original_prompt).toBe('summarize my expenses')
    expect(v.intent_contract).toEqual({ intent: 'summarize' })
    expect(v.data_schema).toEqual({ a: 1 })
    // enhanced prompt rendered on read from the structured user_prompt
    expect(v.enhanced_prompt_data).toEqual(STRUCTURED)
    expect(v.enhanced_prompt).toContain('Weekly expense report')
    expect(v.enhanced_prompt).toContain('Read Gmail')
  })

  it('legacy fat row: falls back to ai_context when columns are null', () => {
    const v = getAgentAiContextView(fatRow())
    expect(v.reasoning).toBe('legacy reasoning')
    expect(v.confidence).toBe(0.8)
    expect(v.original_prompt).toBe('summarize my expenses')
    expect(v.generated_plan).toBe('legacy plan')
    expect(v.enhanced_prompt).toBe('LEGACY FLAT ENHANCED PROMPT') // stored string preferred
  })

  it('column wins when column and JSONB disagree', () => {
    const row = leanRow()
    ;(row.agent_config as any).ai_context.reasoning = 'STALE JSONB REASONING'
    row.ai_reasoning = 'FRESH COLUMN REASONING'
    expect(getAgentAiContextView(row).reasoning).toBe('FRESH COLUMN REASONING')
  })

  it('raw (non-JSON) user_prompt does not throw; enhanced_prompt_data is null', () => {
    const row = leanRow()
    row.user_prompt = 'just a plain prompt, not JSON'
    ;(row.agent_config as any).ai_context = {} // no stored enhanced_prompt either
    const v = getAgentAiContextView(row)
    expect(v.enhanced_prompt_data).toBeNull()
    expect(v.enhanced_prompt).toBe('') // nothing to render
  })

  it('falls back to creation_metadata.enhanced_prompt_data when user_prompt is not structured', () => {
    const row = fatRow()
    ;(row.agent_config as any).creation_metadata = { enhanced_prompt_data: STRUCTURED }
    expect(getAgentAiContextView(row).enhanced_prompt_data).toEqual(STRUCTURED)
  })

  it('lean and equivalent fat rows produce IDENTICAL output (the core dedup invariant)', () => {
    // The single property A2 depends on: dropping the JSONB copies changes nothing
    // observable, because the accessor resolves both to the same view.
    const lean: AgentAiContextRow = {
      ai_reasoning: 'R',
      ai_confidence: 0.7,
      created_from_prompt: 'do the thing',
      generated_plan: 'PLAN',
      user_prompt: JSON.stringify(STRUCTURED),
      agent_config: { ai_context: { intent_contract: { i: 1 }, data_schema: { d: 2 } } },
    }
    // Same logical agent, pre-dedup: values live in ai_context; columns absent.
    const fat: AgentAiContextRow = {
      ai_reasoning: null,
      ai_confidence: null,
      created_from_prompt: null,
      generated_plan: null,
      user_prompt: JSON.stringify(STRUCTURED),
      agent_config: {
        ai_context: {
          reasoning: 'R',
          confidence: 0.7,
          original_prompt: 'do the thing',
          generated_plan: 'PLAN',
          intent_contract: { i: 1 },
          data_schema: { d: 2 },
        },
      },
    }
    expect(getAgentAiContextView(lean)).toEqual(getAgentAiContextView(fat))
  })

  it('confidence 0 from the column is preserved (?? not ||)', () => {
    const row = fatRow()
    row.ai_confidence = 0
    ;(row.agent_config as any).ai_context.confidence = 0.99 // stale JSONB must NOT win
    expect(getAgentAiContextView(row).confidence).toBe(0)
  })

  it('non-string column generated_plan falls back to the JSONB string', () => {
    const row = fatRow()
    ;(row as any).generated_plan = { some: 'object' } // legacy non-string column value
    ;(row.agent_config as any).ai_context.generated_plan = 'plan-from-jsonb'
    expect(getAgentAiContextView(row).generated_plan).toBe('plan-from-jsonb')
  })

  it('empty stored enhanced_prompt string renders from structured user_prompt (|| not ??)', () => {
    const row = leanRow()
    ;(row.agent_config as any).ai_context.enhanced_prompt = '' // present but empty → should render
    const v = getAgentAiContextView(row)
    expect(v.enhanced_prompt).toContain('Weekly expense report')
  })

  it('empty/missing everything: safe defaults, no throw', () => {
    const v = getAgentAiContextView({
      ai_reasoning: null,
      ai_confidence: null,
      created_from_prompt: null,
      generated_plan: null,
      user_prompt: null,
      agent_config: null,
    })
    expect(v).toMatchObject({
      reasoning: '',
      confidence: 0,
      original_prompt: '',
      enhanced_prompt: '',
      enhanced_prompt_data: null,
      generated_plan: '',
      intent_contract: null,
      data_schema: null,
    })
  })
})

describe('parseEnhancedPromptData', () => {
  it('parses a JSON object string', () => {
    expect(parseEnhancedPromptData(JSON.stringify(STRUCTURED))).toEqual(STRUCTURED)
  })
  it('returns null for a raw prompt, an array, null, and malformed JSON', () => {
    expect(parseEnhancedPromptData('hello world')).toBeNull()
    expect(parseEnhancedPromptData('[1,2,3]')).toBeNull()
    expect(parseEnhancedPromptData(null)).toBeNull()
    expect(parseEnhancedPromptData('{ not valid json')).toBeNull()
  })
})

describe('renderEnhancedPrompt', () => {
  it('joins title, description, and section bodies', () => {
    const out = renderEnhancedPrompt(STRUCTURED)
    expect(out).toContain('Weekly expense report')
    expect(out).toContain('Summarize expense emails into a table.')
    expect(out).toContain('Read Gmail')
  })
  it('returns empty string for null', () => {
    expect(renderEnhancedPrompt(null)).toBe('')
  })
})
