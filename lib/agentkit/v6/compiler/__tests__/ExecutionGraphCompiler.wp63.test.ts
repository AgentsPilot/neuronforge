/**
 * WP-63 Gap B — ExecutionGraphCompiler O10a, refactored onto the shared helper +
 * extended (belt-and-suspenders net for legacy/cached IR):
 *  - reconciles a transform's declared item fields to upstream casing,
 *  - rewrites the transform's bare `condition.field` literal with the SAME map (B2),
 *  - runs for a DOTTED `config.input` via base-var fallback in buildSchemaMap (B1),
 *  - is collision-safe (M1) and never rewrites to an ambiguous key.
 *
 * AC-6, AC-10 (compiler side).
 */
import { ExecutionGraphCompiler } from '../ExecutionGraphCompiler'

const makeCtx = () => ({ logs: [] as string[], warnings: [] as string[], variableSources: new Map(), ir: {} })

// Upstream producer: emails[].attachments[].mimeType (native camelCase).
const upstreamSchema = {
  type: 'object',
  properties: {
    emails: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject: {},
          attachments: {
            type: 'array',
            items: { type: 'object', properties: { filename: {}, mimeType: {}, message_id: {} } },
          },
        },
      },
    },
  },
}

describe('WP-63 Gap B — reconcileTransformSchemaWithUpstream + condition rewrite', () => {
  it('AC-6: reconciles mime_type → mimeType AND rewrites the bare condition.field literal', () => {
    const compiler = new ExecutionGraphCompiler() as any
    const ctx = makeCtx()
    const step: any = {
      step_id: 'filter1',
      type: 'transform',
      config: {
        type: 'filter',
        input: '{{all_attachments}}',
        condition: { field: 'mime_type', operator: 'in', value: ['pdf'] },
      },
    }
    const props = compiler.reconcileTransformSchemaWithUpstream(
      { mime_type: { type: 'string' }, filename: { type: 'string' } },
      upstreamSchema,
      step,
      ctx,
    )
    expect(props).toHaveProperty('mimeType')
    expect(props).not.toHaveProperty('mime_type')
    // B2: the bare condition.field literal is rewritten with the same rename map.
    expect(step.config.condition.field).toBe('mimeType')
  })

  it('AC-10: collision (message_id + messageId upstream) → declared Message_ID not rewritten', () => {
    const compiler = new ExecutionGraphCompiler() as any
    const ctx = makeCtx()
    const colliding = {
      type: 'object',
      properties: { message_id: {}, messageId: {}, mimeType: {} },
    }
    const step: any = { step_id: 'f', type: 'transform', config: { type: 'filter' } }
    const props = compiler.reconcileTransformSchemaWithUpstream({ Message_ID: { type: 'string' } }, colliding, step, ctx)
    expect(props).toHaveProperty('Message_ID') // ambiguous → left as-is
    expect(props).not.toHaveProperty('message_id')
    expect(props).not.toHaveProperty('messageId')
  })

  it('B1: buildSchemaMap resolves a DOTTED config.input to its base var so O10a runs', () => {
    const compiler = new ExecutionGraphCompiler() as any
    const ctx = makeCtx()
    const schemaMap = new Map()
    const fullSchemaMap = new Map<string, any>()
    // Producer keyed by bare output_variable.
    fullSchemaMap.set('expense_emails', upstreamSchema)
    const steps = [
      {
        step_id: 'flatten1',
        type: 'transform',
        output_variable: 'all_attachments',
        // Dotted input — pre-B1 this missed fullSchemaMap.get and skipped reconciliation.
        config: { type: 'flatten', input: 'expense_emails.emails' },
        output_schema: { type: 'array', items: { type: 'object', properties: { mime_type: { type: 'string' } } } },
      },
    ]
    compiler.buildSchemaMap(steps, schemaMap, ctx, fullSchemaMap)
    // The reconciled schema-map props use the upstream casing.
    const props = schemaMap.get('all_attachments')
    expect(props).toHaveProperty('mimeType')
    expect(props).not.toHaveProperty('mime_type')
  })

  it('Gap C: a preserving-op field with no upstream match emits a warning (not hard-fail)', () => {
    const compiler = new ExecutionGraphCompiler() as any
    const ctx = makeCtx()
    const step: any = { step_id: 'f', type: 'transform', config: { type: 'filter' } }
    compiler.reconcileTransformSchemaWithUpstream({ mimeType: {}, ghost_field: {} }, upstreamSchema, step, ctx)
    expect(ctx.warnings.some((w: string) => /GapC.*ghost_field/.test(w))).toBe(true)
  })
})
