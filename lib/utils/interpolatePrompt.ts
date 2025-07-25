import { readInbox } from '@/lib/plugins/actions/gmail/readInbox'
import { supabase } from '@/lib/supabaseClient'

export async function interpolatePrompt(
  template: string,
  variables: Record<string, any>,
  plugins?: Record<string, any>,
  userId?: string // ✅ new parameter
): Promise<string> {
  let output = template

  // 🔄 Replace {{input.xyz}} variables
  output = output.replace(/{{\s*input\.([a-zA-Z0-9_]+)\s*}}/g, (_, key) => {
    const value = variables?.[key]
    return typeof value !== 'undefined' ? String(value) : ''
  })

  // 📩 Replace {{gmail.readInbox}} with real inbox data
  if (output.includes('{{gmail.readInbox}}')) {
    if (!userId) {
      console.warn('⚠️ Missing userId for Gmail plugin resolution.')
      output = output.replaceAll('{{gmail.readInbox}}', '[Missing user ID]')
    } else {
      try {
        const emails = await readInbox(userId) // ✅ use userId
        output = output.replaceAll('{{gmail.readInbox}}', JSON.stringify(emails, null, 2))
      } catch (err) {
        console.error('❌ Failed to fetch Gmail inbox:', err)
        output = output.replaceAll('{{gmail.readInbox}}', '[Error reading inbox]')
      }
    }
  }

  return output
}