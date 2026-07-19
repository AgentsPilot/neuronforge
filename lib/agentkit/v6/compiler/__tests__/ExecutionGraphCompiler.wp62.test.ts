/**
 * ExecutionGraphCompiler — WP-62 H3 (SA nit N2): the `x-input-mapping` hint
 * resolution that navigates a whole-object file ref to the producer's bytes field.
 *
 * LAYER COVERED (be precise — this is what N2 asked to close):
 *   This test exercises the COMPILER-SIDE defense-in-depth layer directly:
 *   `ExecutionGraphCompiler.normalizeActionConfigWithSchema`'s `x-input-mapping`
 *   pass (~L6259-6296). It proves that when a `file_content` param is left as a
 *   WHOLE-OBJECT ref (`{{attachment_content}}`) — i.e. the converter (H1) did NOT
 *   pre-navigate — the compiler resolves it to `{{attachment_content.data}}` using
 *   the plugin def's `x-input-mapping` hints matched against the PRODUCING slot's
 *   real fields. This is the layer the H3 plugin-def change (`from_base64_content:
 *   "data"`) added, previously proven only by reasoning.
 *
 *   Dual-producer coverage: Gmail's bytes key is `data` (resolved via
 *   `from_base64_content`), Drive's is `content` (resolved via `from_file_object`) —
 *   one hint cannot serve both, which is exactly why both are declared.
 *
 * WHAT STAYS REASONING-ONLY (honest): this calls the private method directly with a
 * hand-built CompilerContext rather than running a full IR → DSL compile. The
 * end-to-end wiring (that `normalizeActionConfigWithSchema` is actually invoked for
 * an extract action's params during a real compile) is covered by the live Phase E
 * validation (agent 2ffcd7bf, runtime received the real base64 string), not by this
 * unit test. The H1 converter path — the normal case where the ref is pre-navigated
 * before it ever reaches the compiler — is covered by IntentToIRConverter.coverage.test.ts.
 */
import { ExecutionGraphCompiler } from '../ExecutionGraphCompiler'
import documentExtractorDef from '@/lib/plugins/definitions/document-extractor-plugin-v2.json'

const PARAM_SCHEMA = (documentExtractorDef as any).actions.extract_structured_data.parameters.properties

function makeCtx(slotSchema: any): any {
  return {
    logs: [],
    warnings: [],
    variableSources: new Map(),
    ir: { execution_graph: { data_schema: { slots: { attachment_content: { schema: slotSchema } } } } },
  }
}

async function normalize(configValue: string, slotSchema: any) {
  const compiler = new ExecutionGraphCompiler() as any
  const ctx = makeCtx(slotSchema)
  const out = await compiler.normalizeActionConfigWithSchema(
    { file_content: configValue },
    PARAM_SCHEMA,
    new Set(['attachment_content']),
    ctx,
  )
  return out.file_content as string
}

// Gmail get_email_attachment: bytes under `data` (NO `content` key).
const GMAIL_SLOT = {
  type: 'object',
  properties: { filename: {}, mimeType: {}, size: {}, data: {}, extracted_text: {}, is_image: {} },
}
// Google Drive download_file: bytes under `content`.
const DRIVE_SLOT = {
  type: 'object',
  properties: { name: {}, mimeType: {}, content: {} },
}

describe('WP-62 H3 (N2) — compiler resolves a whole-object file ref via x-input-mapping hints', () => {
  it('Gmail producer (bytes key `data`): whole-object `{{attachment_content}}` → `{{attachment_content.data}}` via from_base64_content', async () => {
    // from_file_object:"content" does NOT match the slot (no `content` field) →
    // falls through to from_base64_content:"data", which DOES → navigates to `.data`.
    expect(await normalize('{{attachment_content}}', GMAIL_SLOT)).toBe('{{attachment_content.data}}')
  })

  it('Drive producer (bytes key `content`): whole-object → `{{attachment_content.content}}` via from_file_object (dual-hint serves both)', async () => {
    expect(await normalize('{{attachment_content}}', DRIVE_SLOT)).toBe('{{attachment_content.content}}')
  })

  it('an object with NO bytes field → compiler passes the whole object (no fabricated accessor)', async () => {
    const noBytes = { type: 'object', properties: { id: {}, name: {}, webViewLink: {} } }
    expect(await normalize('{{attachment_content}}', noBytes)).toBe('{{attachment_content}}')
  })
})
