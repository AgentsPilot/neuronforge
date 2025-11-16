/**
 * UrlParserService
 *
 * Extracts IDs and useful values from various service URLs
 * Used by the input help chatbot to convert user-friendly URLs into API-ready values
 */

export class UrlParserService {
  /**
   * Extract Google Sheet ID from various Google Sheets URL formats
   * Examples:
   * - https://docs.google.com/spreadsheets/d/1ABC123/edit#gid=0
   * - https://docs.google.com/spreadsheets/d/1ABC123/edit?usp=sharing
   */
  static extractGoogleSheetId(url: string): string | null {
    try {
      const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)
      return match ? match[1] : null
    } catch {
      return null
    }
  }

  /**
   * Extract Notion database ID from Notion URL
   * Examples:
   * - https://www.notion.so/workspace/DatabaseName-abc123def456?v=xyz
   * - https://notion.so/abc123def456
   */
  static extractNotionDatabaseId(url: string): string | null {
    try {
      // Notion IDs are 32 characters (without hyphens)
      const match = url.match(/notion\.so\/(?:.*-)?([a-f0-9]{32})/)
      if (match) {
        const id = match[1]
        // Format with hyphens: 8-4-4-4-12
        return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Extract Notion page ID from Notion URL
   */
  static extractNotionPageId(url: string): string | null {
    return this.extractNotionDatabaseId(url) // Same format
  }

  /**
   * Extract Google Drive file ID from various Drive URL formats
   * Examples:
   * - https://drive.google.com/file/d/1ABC123/view
   * - https://drive.google.com/open?id=1ABC123
   */
  static extractGoogleDriveFileId(url: string): string | null {
    try {
      // Format 1: /file/d/{ID}/
      let match = url.match(/\/file\/d\/([a-zA-Z0-9-_]+)/)
      if (match) return match[1]

      // Format 2: ?id={ID}
      match = url.match(/[?&]id=([a-zA-Z0-9-_]+)/)
      if (match) return match[1]

      return null
    } catch {
      return null
    }
  }

  /**
   * Extract Google Drive folder ID
   * Example: https://drive.google.com/drive/folders/1ABC123
   */
  static extractGoogleDriveFolderId(url: string): string | null {
    try {
      const match = url.match(/\/folders\/([a-zA-Z0-9-_]+)/)
      return match ? match[1] : null
    } catch {
      return null
    }
  }

  /**
   * Extract Slack channel ID from Slack URL
   * Example: https://app.slack.com/client/T123ABC/C456DEF
   */
  static extractSlackChannelId(url: string): string | null {
    try {
      const match = url.match(/\/client\/[A-Z0-9]+\/([A-Z0-9]+)/)
      return match ? match[1] : null
    } catch {
      return null
    }
  }

  /**
   * Extract Gmail message ID from Gmail URL
   * Example: https://mail.google.com/mail/u/0/#inbox/abc123def456
   */
  static extractGmailMessageId(url: string): string | null {
    try {
      const match = url.match(/#[^\/]+\/([a-f0-9]+)/)
      return match ? match[1] : null
    } catch {
      return null
    }
  }

  /**
   * Extract Trello board ID from Trello URL
   * Example: https://trello.com/b/abc123/board-name
   */
  static extractTrelloBoardId(url: string): string | null {
    try {
      const match = url.match(/\/b\/([a-zA-Z0-9]+)/)
      return match ? match[1] : null
    } catch {
      return null
    }
  }

  /**
   * Extract Airtable base ID and table ID from Airtable URL
   * Example: https://airtable.com/appABC123/tblDEF456/viwGHI789
   */
  static extractAirtableIds(url: string): { baseId: string | null; tableId: string | null } {
    try {
      const baseMatch = url.match(/\/(app[a-zA-Z0-9]+)/)
      const tableMatch = url.match(/\/(tbl[a-zA-Z0-9]+)/)
      return {
        baseId: baseMatch ? baseMatch[1] : null,
        tableId: tableMatch ? tableMatch[1] : null,
      }
    } catch {
      return { baseId: null, tableId: null }
    }
  }

  /**
   * Auto-detect service type and extract ID
   */
  static autoExtract(url: string): { service: string; id: string } | null {
    if (!url || typeof url !== 'string') return null

    const urlLower = url.toLowerCase()

    // Google Sheets
    if (urlLower.includes('docs.google.com/spreadsheets')) {
      const id = this.extractGoogleSheetId(url)
      if (id) return { service: 'google-sheets', id }
    }

    // Notion
    if (urlLower.includes('notion.so')) {
      const id = this.extractNotionDatabaseId(url)
      if (id) return { service: 'notion', id }
    }

    // Google Drive
    if (urlLower.includes('drive.google.com/file')) {
      const id = this.extractGoogleDriveFileId(url)
      if (id) return { service: 'google-drive-file', id }
    }
    if (urlLower.includes('drive.google.com/drive/folders')) {
      const id = this.extractGoogleDriveFolderId(url)
      if (id) return { service: 'google-drive-folder', id }
    }

    // Slack
    if (urlLower.includes('slack.com')) {
      const id = this.extractSlackChannelId(url)
      if (id) return { service: 'slack', id }
    }

    // Gmail
    if (urlLower.includes('mail.google.com')) {
      const id = this.extractGmailMessageId(url)
      if (id) return { service: 'gmail', id }
    }

    // Trello
    if (urlLower.includes('trello.com')) {
      const id = this.extractTrelloBoardId(url)
      if (id) return { service: 'trello', id }
    }

    // Airtable
    if (urlLower.includes('airtable.com')) {
      const { baseId, tableId } = this.extractAirtableIds(url)
      if (baseId) return { service: 'airtable', id: baseId }
    }

    return null
  }

  /**
   * Validate if a string is a valid URL
   */
  static isValidUrl(str: string): boolean {
    try {
      new URL(str)
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if two service names are related (e.g., "google-sheets" and "sheets")
   */
  static areRelatedServices(plugin: string, service: string): boolean {
    const relatedServices: Record<string, string[]> = {
      'google-sheets': ['sheets', 'googlesheets', 'google-sheet'],
      'google-drive': ['drive', 'googledrive'],
      'google-mail': ['gmail', 'googlemail'],
      'notion': ['notion-database', 'notion-page'],
      'slack': ['slack-channel'],
    }

    const pluginLower = plugin.toLowerCase()
    const serviceLower = service.toLowerCase()

    // Check if either is a key and the other is in its values
    for (const [key, values] of Object.entries(relatedServices)) {
      if (
        (pluginLower === key && values.some(v => serviceLower.includes(v))) ||
        (serviceLower === key && values.some(v => pluginLower.includes(v))) ||
        (values.some(v => pluginLower.includes(v)) && serviceLower === key) ||
        (values.some(v => serviceLower.includes(v)) && pluginLower === key)
      ) {
        return true
      }
    }

    return false
  }

  /**
   * Extract and format value based on field type and plugin
   */
  static extractForField(
    userInput: string,
    plugin?: string,
    expectedType?: string,
    fieldName?: string
  ): { success: boolean; value: string | null; error?: string } {
    // Check if input is a URL
    if (!this.isValidUrl(userInput)) {
      return {
        success: false,
        value: null,
        error: 'Please provide a valid URL',
      }
    }

    // Special handling for Google Sheets range field
    // Don't auto-extract, but also don't hard-reject - let AI guide the user
    if (fieldName && fieldName.toLowerCase().includes('range')) {
      return {
        success: false,
        value: null,
        error: 'NEEDS_AI_GUIDANCE', // Special flag for conversational help
      }
    }

    // Auto-detect and extract
    const extracted = this.autoExtract(userInput)

    if (!extracted) {
      return {
        success: false,
        value: null,
        error: 'Could not extract ID from this URL. Please check the URL format.',
      }
    }

    // If plugin is specified, validate it matches (flexible matching)
    if (plugin) {
      const normalizedPlugin = plugin.toLowerCase().replace(/[-_\s]/g, '')
      const normalizedService = extracted.service.toLowerCase().replace(/[-_\s]/g, '')

      // Check if they match (allow partial matches for related services)
      const isMatch =
        normalizedService.includes(normalizedPlugin) ||
        normalizedPlugin.includes(normalizedService) ||
        this.areRelatedServices(plugin, extracted.service)

      if (!isMatch) {
        return {
          success: false,
          value: null,
          error: `This appears to be a ${extracted.service} URL, but this field expects ${plugin}`,
        }
      }
    }

    return {
      success: true,
      value: extracted.id,
    }
  }
}
