import { PluginDefinitionContext } from '../lib/types/plugin-definition-context'
import gmailDef from '../lib/plugins/definitions/google-mail-plugin-v2.json'
import sheetsDef from '../lib/plugins/definitions/google-sheets-plugin-v2.json'
import driveDef from '../lib/plugins/definitions/google-drive-plugin-v2.json'

const gmail = new PluginDefinitionContext(gmailDef as any)
const sheets = new PluginDefinitionContext(sheetsDef as any)
const drive = new PluginDefinitionContext(driveDef as any)

console.log('PLUGIN ACTION REFERENCE:')
console.log(gmail.toActionSummaryText())
console.log(sheets.toActionSummaryText())
console.log(drive.toActionSummaryText())

console.log('')
console.log('=== Structured Validation ===')
for (const plugin of [gmail, sheets, drive]) {
  const summary = plugin.toActionSummaryContext()
  console.log(`\n${summary.displayName} (${summary.key}): ${summary.actions.length} actions`)
  for (const a of summary.actions) {
    console.log(`  ${a.action_name} [${a.domain}/${a.capability}] — ${a.key_params.length} params`)
    for (const p of a.key_params) {
      console.log(`    ${p.required ? '*' : ' '} ${p.name}: ${p.type}${p.constraint ? ' — ' + p.constraint : ''}`)
    }
  }
}
