// lib/plugins/detectPluginsFromPrompt.ts

const pluginKeywords: Record<string, string[]> = {
  'google-mail': ['gmail', 'email', 'inbox', 'google mail'],
  'slack': ['slack', 'slack channel'],
  'notion': ['notion', 'notion page'],
  'github': ['github', 'repo', 'pull request', 'issue'],
  'dropbox': ['dropbox', 'file storage', 'shared file'],
  'google-calendar': ['calendar', 'google calendar', 'event'],
  'youtube': ['youtube', 'video upload', 'channel'],
  'shopify': ['shopify', 'store', 'ecommerce'],
  'linkedin': ['linkedin', 'linkedin post', 'profile'],
  'twilio': ['twilio', 'sms', 'text message', 'call'],
}

export function detectPluginsFromPrompt(prompt: string): string[] {
  const lower = prompt.toLowerCase()
  return Object.entries(pluginKeywords)
    .filter(([, keywords]) => keywords.some(kw => lower.includes(kw)))
    .map(([pluginKey]) => pluginKey)
} 