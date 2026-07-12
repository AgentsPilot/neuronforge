/**
 * Item 11 / WP-58 — AI/processing step inside a scatter must RECEIVE the loop
 * variable it references (not just mention it in prose).
 *
 * Coverage (SA-mandated, because the regression suite is content-blind):
 *  - Detector unit behaviour (structural, generic, no hardcoding).
 *  - CONTENT assertion: an AI-in-scatter step that references the loop var ends
 *    up with that var in its input context, and resolving that input against a
 *    representative scatter item POPULATES the referenced fields (not blank) —
 *    modelled on `0ee53785` step7 (attachment_item.subject/.from/.filename).
 *  - Scoping: a loop var is injected only inside its scatter; a top-level AI
 *    step is unaffected.
 *  - Negative / no-regression: an AI step referencing NO extra variable is left
 *    byte-for-byte unchanged (no spurious inputs).
 *  - Genericity: arbitrary (non-plugin) variable/field names work identically.
 */

import {
  detectReferencedInScopeVariables,
  extractBaseVarName,
} from '../ai-input-context'
import { ExecutionGraphCompiler } from '../ExecutionGraphCompiler'

// compileAIOperation is private + stateless w.r.t. instance — exercise directly.
const compiler = new ExecutionGraphCompiler() as any

/** Minimal CompilerContext with an optional enclosing scatter loop scope. */
function makeCtx(loopItemVars: string[] = []) {
  return {
    stepCounter: 0,
    logs: [] as string[],
    warnings: [] as string[],
    pluginsUsed: new Set<string>(),
    variableMap: new Map(),
    variableSources: new Map(),
    currentScope: loopItemVars.length ? 'loop' : 'global',
    loopDepth: loopItemVars.length,
    loopContextStack: loopItemVars.map(v => ({ itemVariable: v, outputVariables: [] })),
  }
}

function compileAI(
  ai: Record<string, any>,
  ctx: any,
  opts: { inputVariable?: string; allInputs?: any[] } = {}
) {
  return compiler.compileAIOperation(
    'step_7',
    'node_7',
    { operation_type: 'ai', ai, description: ai.instruction },
    { ai: {} },
    opts.inputVariable,
    opts.allInputs ?? [],
    ctx
  )
}

/** Tiny stand-in for the runtime's `{{var}}` resolution (whole-ref only). */
function resolveTemplates(obj: any, store: Record<string, any>): any {
  if (typeof obj === 'string') {
    const m = obj.match(/^\{\{([^}]+)\}\}$/)
    if (!m) return obj
    const path = m[1].split('.')
    let v: any = store[path[0]]
    for (let i = 1; i < path.length; i++) v = v?.[path[i]]
    return v
  }
  if (obj && typeof obj === 'object') {
    const out: Record<string, any> = {}
    for (const [k, val] of Object.entries(obj)) out[k] = resolveTemplates(val, store)
    return out
  }
  return obj
}

describe('extractBaseVarName', () => {
  it('strips braces and dotted / indexed paths to the root variable', () => {
    expect(extractBaseVarName('{{attachment_item.subject}}')).toBe('attachment_item')
    expect(extractBaseVarName('attachment_item')).toBe('attachment_item')
    expect(extractBaseVarName('current_email.attachments[0]')).toBe('current_email')
    expect(extractBaseVarName('{{extracted_fields}}')).toBe('extracted_fields')
    expect(extractBaseVarName('')).toBe('')
  })
})

describe('detectReferencedInScopeVariables', () => {
  it('returns a candidate referenced in the instruction and not already bound', () => {
    const out = detectReferencedInScopeVariables(
      'Put attachment_item.subject into source_email_subject and attachment_item.from into source_email_from.',
      ['attachment_item'],
      ['extracted_fields']
    )
    expect(out).toEqual(['attachment_item'])
  })

  it('does NOT return a candidate that is already bound as the primary input', () => {
    const out = detectReferencedInScopeVariables(
      'Summarize extracted_fields.',
      ['extracted_fields'],
      ['extracted_fields']
    )
    expect(out).toEqual([])
  })

  it('does NOT return a candidate the instruction never mentions (no spurious inputs)', () => {
    const out = detectReferencedInScopeVariables(
      'Build a summary of the provided rows.',
      ['attachment_item'],
      ['extracted_fields']
    )
    expect(out).toEqual([])
  })

  it('matches on word boundaries only (no partial-substring false positives)', () => {
    const out = detectReferencedInScopeVariables(
      'Reference the attachment_items_count metric only.',
      ['attachment_item'],
      []
    )
    expect(out).toEqual([])
  })

  it('is generic — arbitrary non-plugin variable names work identically', () => {
    const out = detectReferencedInScopeVariables(
      'Copy widget_row.color and widget_row.size into the output.',
      ['widget_row', 'unused_var'],
      ['primary_data']
    )
    expect(out).toEqual(['widget_row'])
  })

  it('deduplicates repeated candidates and preserves candidate order', () => {
    const out = detectReferencedInScopeVariables(
      'a references x and y, and x again',
      ['x', 'y', 'x'],
      []
    )
    expect(out).toEqual(['x', 'y'])
  })
})

describe('compileAIOperation — Item 11 loop-variable injection', () => {
  it('CONTENT: injects the referenced loop var and its fields POPULATE on resolution', () => {
    const ctx = makeCtx(['attachment_item'])
    const step = compileAI(
      {
        type: 'generate',
        instruction:
          'For each row, set source_email_subject from attachment_item.subject, ' +
          'source_email_from from attachment_item.from, and attachment_filename ' +
          'from attachment_item.filename. Use vendor/amount/date from extracted_fields.',
        input: 'extracted_fields',
      },
      ctx
    )

    // Structural: input promoted to a labelled object carrying BOTH sources.
    expect(typeof step.input).toBe('object')
    expect(step.input).toEqual({
      extracted_fields: '{{extracted_fields}}',
      attachment_item: '{{attachment_item}}',
    })

    // CONTENT: resolving against a representative scatter item populates the
    // previously-blank columns — proving the model RECEIVES the values, not just
    // the prose reference. (This is the P8/WP-43 lesson: assert semantics.)
    const resolved = resolveTemplates(step.input, {
      extracted_fields: { vendor: 'Wolt', amount: 'ILS 99.90', date: '2026-07-01' },
      attachment_item: {
        subject: 'Your Wolt receipt',
        from: 'receipts@wolt.com',
        filename: 'wolt-receipt.pdf',
      },
    })
    expect(resolved.attachment_item.subject).toBe('Your Wolt receipt')
    expect(resolved.attachment_item.from).toBe('receipts@wolt.com')
    expect(resolved.attachment_item.filename).toBe('wolt-receipt.pdf')
    expect(resolved.extracted_fields.vendor).toBe('Wolt')
  })

  it('consumes IR-declared additional_inputs (root-cause converter output)', () => {
    const ctx = makeCtx(['attachment_item'])
    const step = compileAI(
      {
        type: 'generate',
        instruction: 'Build the report row.', // prose does not mention it...
        input: 'extracted_fields',
        additional_inputs: ['attachment_item'], // ...but the IR declared it.
      },
      ctx
    )
    expect(step.input).toEqual({
      extracted_fields: '{{extracted_fields}}',
      attachment_item: '{{attachment_item}}',
    })
  })

  it('SCOPING: a top-level AI step is unaffected even if it names the variable', () => {
    const ctx = makeCtx([]) // no enclosing scatter
    const step = compileAI(
      {
        type: 'generate',
        instruction: 'Include attachment_item.subject if available.',
        input: 'extracted_fields',
      },
      ctx
    )
    // No loop scope → nothing injected → input left as the plain string.
    expect(step.input).toBe('extracted_fields')
  })

  it('NEGATIVE / no-regression: an AI step referencing no extra var is unchanged', () => {
    const ctx = makeCtx(['attachment_item'])
    const step = compileAI(
      {
        type: 'generate',
        instruction: 'Produce an HTML table from the provided rows.',
        input: 'extracted_fields',
      },
      ctx
    )
    expect(step.input).toBe('extracted_fields')
  })

  it('does not re-inject a variable already bound via the primary input', () => {
    const ctx = makeCtx(['attachment_item'])
    const step = compileAI(
      {
        type: 'generate',
        instruction: 'Use attachment_item.subject.',
        input: 'attachment_item', // already the primary input
      },
      ctx
    )
    // Referenced var IS the bound var → no promotion, no duplication.
    expect(step.input).toBe('attachment_item')
  })

  it('GENERIC: arbitrary non-plugin loop/field names inject identically', () => {
    const ctx = makeCtx(['gizmo_item'])
    const step = compileAI(
      {
        type: 'generate',
        instruction: 'Copy gizmo_item.color into the summary.',
        input: 'primary_data',
      },
      ctx
    )
    expect(step.input).toEqual({
      primary_data: '{{primary_data}}',
      gizmo_item: '{{gizmo_item}}',
    })
  })
})
