/**
 * WP-63 AC-1 / AC-8 — end-to-end (Gap A build + A2 rewrite) over the PROVEN Gmail
 * scatter-attachment shape (search_emails → flatten attachments → filter mime_type →
 * scatter[...]), against the REAL google-mail plugin schema.
 *
 * Proves: the flatten's data_schema item slot ends up camelCase (`mimeType`), and the
 * filter's `{kind:"ref"}` condition + scatter `{{attachment_item.*}}` refs are rewritten
 * to match — so the filter/scatter would populate on real data instead of emptying.
 */
import { DataSchemaBuilder } from '../DataSchemaBuilder'
import { CapabilityBinderV2 } from '../CapabilityBinderV2'
import googleMailDef from '@/lib/plugins/definitions/google-mail-plugin-v2.json'
import type { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'

const pm = {
  getPluginDefinition: (k: string) => (k === 'google-mail' ? googleMailDef : null),
} as unknown as PluginManagerV2

/** search_emails → flatten(attachments, snake_case) → filter(mime_type) → scatter[gen ref] */
function boundSteps(): any[] {
  return [
    {
      id: 'search',
      kind: 'data_source',
      output: 'expense_emails',
      plugin_key: 'google-mail',
      action: 'search_emails',
      binding_method: 'exact_match',
      uses: [{ capability: 'search', domain: 'email' }],
    },
    {
      id: 'flatten',
      kind: 'transform',
      output: 'all_attachments',
      transform: {
        op: 'flatten',
        input: 'expense_emails.emails',
        // The AI-declared snake_case shape (the WP-63 bug).
        output_schema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              mime_type: { type: 'string' },
              filename: { type: 'string' },
              attachment_id: { type: 'string' },
              message_id: { type: 'string' },
            },
          },
        },
      },
    },
    {
      id: 'filter',
      kind: 'transform',
      output: 'eligible_attachments',
      transform: {
        op: 'filter',
        input: 'all_attachments',
        where: { op: 'test', left: { kind: 'ref', ref: 'all_attachments', field: 'mime_type' }, comparator: 'in' },
      },
    },
    {
      id: 'scatter',
      kind: 'loop',
      output: 'rows',
      loop: {
        over: 'eligible_attachments',
        item_ref: 'attachment_item',
        do: [
          {
            id: 'row',
            kind: 'generate',
            output: 'row_out',
            generate: { instruction: 'File {{attachment_item.mime_type}} named {{attachment_item.filename}}' },
          },
        ],
      },
    },
  ]
}

describe('WP-63 AC-1/AC-8 — Gmail scatter-attachment shape reconciles camelCase end-to-end', () => {
  it('schema slot uses mimeType, and filter/scatter refs are rewritten to match', () => {
    const steps = boundSteps()
    const { schema, fieldRenames } = new DataSchemaBuilder(pm).build(steps)

    // Gap A: the flatten output slot item schema is now camelCase.
    const flattenItems = (schema.slots['all_attachments'].schema as any).items.properties
    expect(flattenItems).toHaveProperty('mimeType')
    expect(flattenItems).not.toHaveProperty('mime_type')
    expect(fieldRenames.get('mime_type')).toBe('mimeType')

    // A2: apply the rename map to downstream references.
    ;(new CapabilityBinderV2(pm) as any).applyTransformFieldRenames(steps, fieldRenames, schema)

    // Filter condition ref reconciled.
    expect(steps[2].transform.where.left.field).toBe('mimeType')
    // Scatter sub-step template ref reconciled; untouched fields preserved.
    expect(steps[3].loop.do[0].generate.instruction).toContain('{{attachment_item.mimeType}}')
    expect(steps[3].loop.do[0].generate.instruction).not.toContain('mime_type')
    expect(steps[3].loop.do[0].generate.instruction).toContain('{{attachment_item.filename}}')
  })

  it('AC-7 determinism: the same bound IC yields the same reconciled schema + renames across runs', () => {
    const fingerprint = () => {
      const steps = boundSteps()
      const { schema, fieldRenames } = new DataSchemaBuilder(pm).build(steps)
      return JSON.stringify({
        items: (schema.slots['all_attachments'].schema as any).items.properties,
        renames: [...fieldRenames.entries()].sort(),
      })
    }
    const first = fingerprint()
    for (let i = 0; i < 4; i++) expect(fingerprint()).toBe(first)
  })
})
