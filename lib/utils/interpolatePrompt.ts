// lib/utils/interpolatePrompt.ts

import { pluginRegistry } from '@/lib/plugins/pluginRegistry'
import type { PluginConnection } from '@/lib/plugins/types'

export async function interpolatePrompt(
  template: string,
  input_variables: Record<string, any> = {},
  plugins: Record<string, PluginConnection> = {},
  userId?: string
): Promise<string> {
  console.log('🧪 interpolatePrompt.ts: running with template =', template)
  console.log('📥 interpolatePrompt.ts: input_variables =', input_variables)
  console.log('🔌 interpolatePrompt.ts: plugins =', Object.keys(plugins))
  console.log('👤 interpolatePrompt.ts: userId =', userId)

  let output = template

  // ⏬ Interpolate plugin content
  for (const [pluginKey, connection] of Object.entries(plugins)) {
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