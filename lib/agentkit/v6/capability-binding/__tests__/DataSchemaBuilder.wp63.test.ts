/**
 * WP-63 Gap A — DataSchemaBuilder reconciles ai_declared FIELD-PRESERVING transform
 * item schemas to the producer's real field names before they enter the canonical
 * WorkflowDataSchema.
 *
 * AC-2 (re-cased silent), AC-3 (genuinely-absent kept+warned), AC-5/AC-9
 * (synthesizing op untouched), AC-11 (parent-sourced + builtins), AC-10 (collision),
 * AC-7 (determinism), M3 (dotted-input producer lookup).
 */
import { DataSchemaBuilder } from '../DataSchemaBuilder'
import type { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'

const stubPluginManager = { getPluginDefinition: (_k: string) => null } as unknown as PluginManagerV2
const makeBuilder = () => new DataSchemaBuilder(stubPluginManager)

/** Gmail search_emails producer: emails[] with nested attachments[] (native camelCase). */
function gmailEmailsSlotSchema(extraParentProps: Record<string, any> = {}): any {
  return {
    type: 'object',
    source: 'plugin',
    properties: {
      emails: {
        type: 'array',
        source: 'plugin',
        items: {
          type: 'object',
          source: 'plugin',
          properties: {
            subject: { type: 'string' },
            from: { type: 'string' },
            date: { type: 'string' },
            ...extraParentProps,
            attachments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  filename: { type: 'string' },
                  mimeType: { type: 'string' },
                  size: { type: 'number' },
                  attachment_id: { type: 'string' },
                  message_id: { type: 'string' },
                },
              },
            },
          },
        },
      },
      total_found: { type: 'number' },
    },
  }
}

/** An ai_declared flatten output slot with snake_case + optionally extra fields. */
function declaredFlattenSlot(props: Record<string, any>): any {
  return {
    schema: {
      type: 'array',
      source: 'ai_declared',
      items: { type: 'object', source: 'ai_declared', properties: props },
    },
    scope: 'global',
    produced_by: 'flatten_attachments',
  }
}

function flattenStep(op = 'flatten', input = 'expense_emails.emails'): any {
  return { id: 'flatten_attachments', kind: 'transform', output: 'all_attachments', transform: { op, input } }
}

const itemProps = (slots: any) => slots.all_attachments.schema.items.properties

describe('WP-63 Gap A — reconcileAiDeclaredTransformSchemas', () => {
  it('AC-2 + M3: re-cased flatten field reconciles via a DOTTED input producer lookup', () => {
    const builder = makeBuilder()
    const slots: any = {
      expense_emails: { schema: gmailEmailsSlotSchema(), scope: 'global', produced_by: 'search' },
      all_attachments: declaredFlattenSlot({
        mime_type: { type: 'string' },
        filename: { type: 'string' },
        attachment_id: { type: 'string' },
        message_id: { type: 'string' },
      }),
    }
    ;(builder as any).reconcileAiDeclaredTransformSchemas([{ step: flattenStep(), depth: 0 }], slots)

    // mime_type → mimeType (producer casing); exact matches untouched.
    expect(itemProps(slots)).toHaveProperty('mimeType')
    expect(itemProps(slots)).not.toHaveProperty('mime_type')
    expect(itemProps(slots)).toHaveProperty('filename')
    expect(itemProps(slots)).toHaveProperty('attachment_id')
    expect(itemProps(slots)).toHaveProperty('message_id')
    // The global rename map carries the decision for A2.
    expect((builder as any).fieldRenames.get('mime_type')).toBe('mimeType')
  })

  it('AC-11: a parent-sourced field reconciles; builtins are never flagged', () => {
    const builder = makeBuilder()
    const warnings: string[] = ((builder as any).warnings = [])
    const slots: any = {
      expense_emails: { schema: gmailEmailsSlotSchema(), scope: 'global', produced_by: 'search' },
      // Declared uses `Subject` (parent field, re-cased) + the builtins the runtime adds.
      all_attachments: declaredFlattenSlot({
        Subject: { type: 'string' },
        mimeType: { type: 'string' },
        _parentId: { type: 'string' },
        _parentData: { type: 'object' },
      }),
    }
    ;(builder as any).reconcileAiDeclaredTransformSchemas([{ step: flattenStep(), depth: 0 }], slots)

    expect(itemProps(slots)).toHaveProperty('subject') // parent field reconciled
    expect(itemProps(slots)).not.toHaveProperty('Subject')
    // builtins untouched + never warned.
    expect(itemProps(slots)).toHaveProperty('_parentId')
    expect(itemProps(slots)).toHaveProperty('_parentData')
    expect(warnings.some((w) => /_parent/.test(w))).toBe(false)
  })

  it('AC-3: a genuinely-absent field is KEPT and surfaced (never dropped)', () => {
    const builder = makeBuilder()
    const warnings: string[] = ((builder as any).warnings = [])
    const slots: any = {
      expense_emails: { schema: gmailEmailsSlotSchema(), scope: 'global', produced_by: 'search' },
      all_attachments: declaredFlattenSlot({
        mimeType: { type: 'string' },
        totally_absent_field: { type: 'string' },
      }),
    }
    ;(builder as any).reconcileAiDeclaredTransformSchemas([{ step: flattenStep(), depth: 0 }], slots)

    expect(itemProps(slots)).toHaveProperty('totally_absent_field') // KEPT
    expect(warnings.some((w) => /GapC.*totally_absent_field/.test(w))).toBe(true) // SURFACED
  })

  it('AC-5 + AC-9: a SYNTHESIZING op (map) is NOT reconciled — computed fields survive', () => {
    const builder = makeBuilder()
    const slots: any = {
      expense_emails: { schema: gmailEmailsSlotSchema(), scope: 'global', produced_by: 'search' },
      all_attachments: (() => {
        const s = declaredFlattenSlot({ computed_score: { type: 'number' }, mime_type: { type: 'string' } })
        return s
      })(),
    }
    // op = 'map' (synthesizing) — must be skipped entirely.
    ;(builder as any).reconcileAiDeclaredTransformSchemas([{ step: flattenStep('map'), depth: 0 }], slots)

    expect(itemProps(slots)).toHaveProperty('computed_score')
    expect(itemProps(slots)).toHaveProperty('mime_type') // untouched — map mints its own fields
    expect((builder as any).fieldRenames.size).toBe(0)
  })

  it('AC-10: a normalized COLLISION (message_id + messageId in producer) → no ambiguous rewrite', () => {
    const builder = makeBuilder()
    const warnings: string[] = ((builder as any).warnings = [])
    const slots: any = {
      // Parent adds `messageId`; child has `message_id` → collision on normalize.
      expense_emails: { schema: gmailEmailsSlotSchema({ messageId: { type: 'string' } }), scope: 'global', produced_by: 'search' },
      all_attachments: declaredFlattenSlot({ Message_Id: { type: 'string' }, mimeType: { type: 'string' } }),
    }
    ;(builder as any).reconcileAiDeclaredTransformSchemas([{ step: flattenStep(), depth: 0 }], slots)

    // `Message_Id` (no exact match) hits the ambiguous normalized key → NOT rewritten.
    expect(itemProps(slots)).toHaveProperty('Message_Id')
    expect(itemProps(slots)).not.toHaveProperty('messageId')
    expect(itemProps(slots)).not.toHaveProperty('message_id')
    expect(warnings.some((w) => /ambiguous/i.test(w))).toBe(true)
  })

  it('AC-7: deterministic — reconciling twice yields the same schema', () => {
    const run = () => {
      const builder = makeBuilder()
      const slots: any = {
        expense_emails: { schema: gmailEmailsSlotSchema(), scope: 'global', produced_by: 'search' },
        all_attachments: declaredFlattenSlot({ mime_type: { type: 'string' }, filename: { type: 'string' } }),
      }
      ;(builder as any).reconcileAiDeclaredTransformSchemas([{ step: flattenStep(), depth: 0 }], slots)
      return JSON.stringify(slots.all_attachments.schema.items.properties)
    }
    const first = run()
    for (let i = 0; i < 4; i++) expect(run()).toBe(first)
  })
})
