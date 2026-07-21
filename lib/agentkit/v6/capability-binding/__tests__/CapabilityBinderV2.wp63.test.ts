/**
 * WP-63 A2 (M4) — CapabilityBinderV2.applyTransformFieldRenames rewrites ALL
 * downstream reference shapes from the ONE rename map Gap A emits, scoped by the
 * reconciled data_schema (no second fuzzy match).
 *
 * AC-1 (filter condition + scatter itemVariable refs match the reconciled camelCase),
 * covering `{kind:"ref"}`, `{{var.field}}` templates, and bare `key_field` literals.
 */
import { CapabilityBinderV2 } from '../CapabilityBinderV2'
import type { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'

const stubPM = { getPluginDefinition: (_k: string) => null } as unknown as PluginManagerV2
const makeBinder = () => new CapabilityBinderV2(stubPM)

// Reconciled data_schema: producer slots carry the canonical camelCase names.
const dataSchema = {
  slots: {
    all_attachments: {
      schema: { type: 'array', items: { type: 'object', properties: { mimeType: {}, filename: {}, attachment_id: {} } } },
    },
    eligible_attachments: {
      schema: { type: 'array', items: { type: 'object', properties: { mimeType: {}, filename: {}, attachment_id: {} } } },
    },
    attachment_item: {
      schema: { type: 'object', properties: { mimeType: {}, filename: {}, attachment_id: {} } },
    },
  },
}

// Gap A's emitted rename map.
const renames = new Map<string, string>([['mime_type', 'mimeType']])

function apply(steps: any[]): number {
  return (makeBinder() as any).applyTransformFieldRenames(steps, renames, dataSchema)
}

describe('WP-63 A2 — applyTransformFieldRenames (M4: all ref shapes, one map)', () => {
  it('rewrites a structured {kind:"ref"} filter condition field', () => {
    const steps = [
      {
        id: 'filter',
        kind: 'transform',
        transform: {
          op: 'filter',
          input: 'all_attachments',
          where: { op: 'test', left: { kind: 'ref', ref: 'all_attachments', field: 'mime_type' }, comparator: 'in' },
        },
      },
    ]
    const n = apply(steps)
    expect(steps[0].transform.where.left.field).toBe('mimeType')
    expect(n).toBeGreaterThanOrEqual(1)
  })

  it('rewrites {{itemVariable.field}} template refs in scatter sub-steps', () => {
    const steps = [
      {
        id: 'scatter',
        kind: 'loop',
        loop: {
          over: 'eligible_attachments',
          item_ref: 'attachment_item',
          do: [
            {
              id: 'row',
              kind: 'generate',
              generate: { instruction: 'Use {{attachment_item.mime_type}} and {{attachment_item.filename}}' },
            },
          ],
        },
      },
    ]
    apply(steps)
    expect(steps[0].loop.do[0].generate.instruction).toContain('{{attachment_item.mimeType}}')
    expect(steps[0].loop.do[0].generate.instruction).toContain('{{attachment_item.filename}}') // untouched
    expect(steps[0].loop.do[0].generate.instruction).not.toContain('mime_type')
  })

  it('rewrites a bare key_field literal', () => {
    const steps = [
      { id: 'diff', kind: 'transform', transform: { op: 'set_difference', input: 'all_attachments', key_field: 'mime_type' } },
    ]
    apply(steps)
    expect(steps[0].transform.key_field).toBe('mimeType')
  })

  it('scoped: does NOT rewrite a ref whose slot genuinely has the old snake_case name', () => {
    const localSchema = { slots: { other: { schema: { type: 'object', properties: { mime_type: {} } } } } }
    const steps = [{ id: 's', kind: 'transform', transform: { op: 'filter', input: 'other', where: { op: 'test', left: { kind: 'ref', ref: 'other', field: 'mime_type' } } } }]
    ;(makeBinder() as any).applyTransformFieldRenames(steps, renames, localSchema)
    expect(steps[0].transform.where.left.field).toBe('mime_type') // slot really has mime_type → left alone
  })
})
