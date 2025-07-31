// lib/utils/interpolatePrompt.ts

import { pluginRegistry } from '@/lib/plugins/pluginRegistry'
import type { PluginConnection } from '@/lib/plugins/types'

export async function interpolatePrompt(
  template: string,
  input_variables: Record<string, any> = {},
  plugins: Record<string, PluginConnection> = {},
  userId?: string,
  allowedPluginKeys: string[] = []
): Promise<string> {
  console.log('🧪 interpolatePrompt.ts: running with template =', template)
  console.log('📥 interpolatePrompt.ts: input_variables =', input_variables)
  console.log('🔌 interpolatePrompt.ts: plugins =', Object.keys(plugins))
  console.log('👤 interpolatePrompt.ts: userId =', userId)
  console.log('✅ allowed plugins =', allowedPluginKeys)

  let output = template

  // ⏬ Inject uploaded file content (if present)
  if (input_variables.__uploaded_file_text) {
    output += `\n\n[Uploaded File Content]:\n${input_variables.__uploaded_file_text}`
  }

  // ⏬ Interpolate plugin content (only if allowed)
  for (const [pluginKey, connection] of Object.entries(plugins)) {
    if (!allowedPluginKeys.includes(pluginKey)) {
      console.log(`⏭️ Skipping plugin '${pluginKey}' (not in agent.plugins_required)`)
      continue
    }

    const strategy = pluginRegistry[pluginKey]
    if (!strategy?.run) continue

    try {
      const result = await strategy.run({
        connection,
        input_variables,
        userId,
      })

      for (const [key, value] of Object.entries(result || {})) {
        output += `\n\n[${pluginKey}] ${key}:\n${value}`
      }
    } catch (err) {
      console.error(`❌ Plugin '${pluginKey}' run failed:`, err)
      output += `\n\n[${pluginKey}] Error: failed to fetch data`
    }
  }

  return output
}