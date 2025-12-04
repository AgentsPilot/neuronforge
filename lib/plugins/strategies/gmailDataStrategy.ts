/**
 * @deprecated This entire file is deprecated and should not be used.
 * Please use the v2 plugin system instead.
 */

// lib/plugins/strategies/gmailDataStrategy.ts
import { gmailStrategy } from './gmailPluginStrategy'
import { extractPdfTextFromBase64 } from '@/lib/utils/extractPdfTextFromBase64'

export interface GmailDataStrategy {
  pluginKey: string
  name: string
  connect(params: { supabase: any; popup: Window; userId: string }): Promise<void>
  handleOAuthCallback?(params: { code: string; state: string; supabase?: any }): Promise<any>
  run(params: { connection: any; userId: string; input_variables: Record<string, any> }): Promise<any>
  refreshToken?(connection: any): Promise<any>
  processGenericInputs(input_variables: Record<string, any>): any
  extractEmailBody(payload: any): string
  processAllAttachments(payload: any, messageId: string, accessToken: string): Promise<any[]>
  generateGenericSummary(emails: any[], processedInputs: any, totalAttachments: number): string
  decodeBase64Url(data: string): string
  identifyContentType(filename: string, mimeType: string): string
  extractTextFromAttachment(base64Data: string, mimeType: string, filename: string): Promise<string>
  cleanExtractedText(text: string): string
}

/** @deprecated Use v2 plugin system instead */
export const gmailDataStrategy: GmailDataStrategy = {
  ...gmailStrategy, // Inherit OAuth connection functionality

  // Generic run function that adapts to any agent's input schema
  async run({ connection, userId, input_variables }) {
    console.log('Gmail Data Plugin: Starting generic email fetch...', {
      userId,
      hasAccessToken: !!connection.access_token,
      tokenExpiry: connection.expires_at,
      inputVariables: input_variables
    })

    try {
      // Check if token is expired
      if (connection.expires_at) {
        const expiryDate = new Date(connection.expires_at)
        const now = new Date()
        if (expiryDate.getTime() < now.getTime()) {
          console.log('Token expired, needs refresh')
          throw new Error('Access token expired, refresh needed')
        }
      }

      // Process inputs generically - works with any agent schema
      const processedInputs = this.processGenericInputs(input_variables)
      
      console.log('Processed inputs:', processedInputs)

      // Fetch emails from Gmail API
      const emailsUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
      emailsUrl.searchParams.set('maxResults', processedInputs.maxResults.toString())
      emailsUrl.searchParams.set('q', processedInputs.query)

      const listResponse = await fetch(emailsUrl.toString(), {
        headers: {
          'Authorization': `Bearer ${connection.access_token}`,
          'Accept': 'application/json',
        },
      })

      if (!listResponse.ok) {
        const errorText = await listResponse.text()
        console.error('Gmail API list failed:', {
          status: listResponse.status,
          statusText: listResponse.statusText,
          body: errorText
        })
        throw new Error(`Gmail API error: ${listResponse.status} ${listResponse.statusText}`)
      }

      const listData = await listResponse.json()
      
      console.log('Gmail API response:', {
        messagesFound: listData.messages?.length || 0,
        resultSizeEstimate: listData.resultSizeEstimate,
        searchQuery: processedInputs.query
      })

      if (!listData.messages || listData.messages.length === 0) {
        return {
          summary: `No emails found matching search criteria`,
          totalEmails: 0,
          emails: [],
          searchQuery: processedInputs.query,
          searchCriteria: processedInputs.originalInputs
        }
      }

      // Fetch FULL details for each email - respect the user's requested limit
      const emailsToFetch = listData.messages.slice(0, processedInputs.maxResults)
      const emailDetails = []

      for (const message of emailsToFetch) {
        try {
          console.log(`Fetching FULL details for email: ${message.id}`)
          
          // Get full email content including attachments
          const detailResponse = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=full`,
            {
              headers: {
                'Authorization': `Bearer ${connection.access_token}`,
                'Accept': 'application/json',
              },
            }
          )

          if (detailResponse.ok) {
            const email = await detailResponse.json()
            const headers = email.payload?.headers || []
            
            const getHeader = (name: string) => 
              headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || ''

            // Extract basic email info
            const emailInfo: {
              id: string;
              threadId: string;
              subject: string;
              from: string;
              date: string;
              snippet: string;
              labels: string[];
              body: string;
              attachments: any[];
            } = {
              id: email.id,
              threadId: email.threadId,
              subject: getHeader('Subject'),
              from: getHeader('From'),
              date: getHeader('Date'),
              snippet: email.snippet || '',
              labels: email.labelIds || [],
              body: '',
              attachments: []
            }

            // Extract email body (generic text extraction)
            emailInfo.body = this.extractEmailBody(email.payload)

            // Process ALL attachments generically
            const attachments = await this.processAllAttachments(
              email.payload, 
              email.id, 
              connection.access_token
            )
            
            emailInfo.attachments = attachments

            emailDetails.push(emailInfo)
          } else {
            console.warn(`Failed to fetch email ${message.id}: ${detailResponse.status}`)
          }
        } catch (emailError) {
          console.warn(`Error fetching email ${message.id}:`, emailError)
        }
      }

      // Generate generic summary
      const totalAttachments = emailDetails.reduce((sum, email) => sum + email.attachments.length, 0)
      const summary = this.generateGenericSummary(emailDetails, processedInputs, totalAttachments)

      const result = {
        summary,
        totalEmails: emailDetails.length,
        totalAvailable: listData.resultSizeEstimate || 0,
        emails: emailDetails,
        searchQuery: processedInputs.query,
        searchCriteria: processedInputs.originalInputs,
        userEmail: connection.username,
        fetchedAt: new Date().toISOString()
      }

      console.log('Gmail data fetch successful:', {
        emailsReturned: emailDetails.length,
        attachmentsProcessed: totalAttachments,
        searchQuery: processedInputs.query
      })

      return result

    } catch (error: any) {
      console.error('Gmail data fetch failed:', error)
      
      return {
        summary: "Unable to fetch emails at this time. Please check your Gmail connection.",
        error: error.message,
        totalEmails: 0,
        emails: [],
        errorType: error.constructor.name,
        troubleshooting: [
          "Verify Gmail connection is active",
          "Check if access token needs refresh", 
          "Ensure Gmail API permissions are granted"
        ]
      }
    }
  },

  // Generic input processor - adapts to any agent schema
  processGenericInputs(input_variables: Record<string, any>) {
    const inputs: {
      maxResults: number,
      query: string,
      searchTerms: string[],
      folders: string[],
      originalInputs: Record<string, any>
    } = {
      maxResults: 10,
      query: 'in:inbox',
      searchTerms: [],
      folders: [],
      originalInputs: { ...input_variables }
    }

    // Process all input variables dynamically
    Object.entries(input_variables).forEach(([key, value]) => {
      const lowerKey = key.toLowerCase()
      const stringValue = String(value || '').trim()
      
      if (!stringValue) return // Skip empty values

      // Detect email count fields (various possible names)
      if (lowerKey.includes('number') || 
          lowerKey.includes('count') || 
          lowerKey.includes('max') || 
          lowerKey.includes('limit') ||
          lowerKey.includes('email')) {
        const numValue = parseInt(stringValue)
        if (!isNaN(numValue) && numValue > 0) {
          inputs.maxResults = Math.min(numValue, 50) // Cap at 50 for performance
        }
      }
      
      // Detect folder/label fields (various possible names)
      else if (lowerKey.includes('label') || 
               lowerKey.includes('folder') || 
               lowerKey.includes('mailbox') ||
               lowerKey.includes('location') ||
               lowerKey.includes('box')) {
        const normalizedFolder = stringValue.toLowerCase()
        if (normalizedFolder.includes('inbox')) {
          inputs.folders.push('inbox')
        } else if (normalizedFolder.includes('sent')) {
          inputs.folders.push('sent')
        } else if (normalizedFolder.includes('draft')) {
          inputs.folders.push('drafts')
        } else if (normalizedFolder.includes('spam')) {
          inputs.folders.push('spam')
        } else if (normalizedFolder.includes('trash')) {
          inputs.folders.push('trash')
        } else {
          // Custom label - use as is
          inputs.folders.push(normalizedFolder)
        }
      }
      
      // Detect search term fields (anything else that's a meaningful string)
      else if (typeof value === 'string' && stringValue.length > 0) {
        // Common search term field names
        if (lowerKey.includes('search') || 
            lowerKey.includes('word') || 
            lowerKey.includes('term') || 
            lowerKey.includes('keyword') || 
            lowerKey.includes('alert') ||
            lowerKey.includes('find') ||
            lowerKey.includes('query') ||
            lowerKey.includes('text')) {
          inputs.searchTerms.push(stringValue)
        }
      }
    })

    // Build Gmail search query
    let queryParts = []

    // Add search terms
    if (inputs.searchTerms.length > 0) {
      if (inputs.searchTerms.length === 1) {
        queryParts.push(`"${inputs.searchTerms[0]}"`)
      } else {
        // Search for emails containing any of the terms
        queryParts.push(`(${inputs.searchTerms.map(term => `"${term}"`).join(' OR ')})`)
      }
    }

    // Add folders
    if (inputs.folders.length > 0) {
      if (inputs.folders.length === 1) {
        queryParts.push(`in:${inputs.folders[0]}`)
      } else {
        // Search in any of the specified folders
        queryParts.push(`(${inputs.folders.map(folder => `in:${folder}`).join(' OR ')})`)
      }
    } else {
      // Default to inbox if no folder specified
      queryParts.push('in:inbox')
    }

    inputs.query = queryParts.join(' ')

    return inputs
  },

  // Generate a contextual summary based on search results
  generateGenericSummary(emails: any[], processedInputs: any, totalAttachments: number): string {
    let summary = `Found ${emails.length} emails`
    
    if (processedInputs.searchTerms.length > 0) {
      summary += ` containing: ${processedInputs.searchTerms.join(', ')}`
    }
    
    if (processedInputs.folders.length > 0) {
      summary += ` in ${processedInputs.folders.join(', ')}`
    }
    
    if (totalAttachments > 0) {
      summary += `\n\nAttachments found: ${totalAttachments} files`
      const attachmentTypes = new Set()
      emails.forEach(email => {
        email.attachments.forEach((att: any) => {
          if (att.mimeType) {
            const type = att.mimeType.split('/')[1] || att.mimeType
            attachmentTypes.add(type)
          }
        })
      })
      if (attachmentTypes.size > 0) {
        summary += `\nFile types: ${Array.from(attachmentTypes).join(', ')}`
      }
    }
    
    return summary
  },

  // Extract email body text - universal approach
  extractEmailBody(payload: any): string {
    if (!payload) return ''
    
    // Handle multipart emails
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return this.decodeBase64Url(part.body.data)
        }
        if (part.mimeType === 'text/html' && part.body?.data) {
          // Basic HTML to text conversion
          const html = this.decodeBase64Url(part.body.data)
          return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        }
        // Recursively check nested parts
        if (part.parts) {
          const nestedText = this.extractEmailBody(part)
          if (nestedText) return nestedText
        }
      }
    }
    
    // Handle simple email body
    if (payload.body?.data) {
      return this.decodeBase64Url(payload.body.data)
    }
    
    return ''
  },

  // Generic attachment processing - extract ALL content
  async processAllAttachments(payload: any, messageId: string, accessToken: string): Promise<any[]> {
    const attachments: any[] = []
    
    const processPayload = async (part: any) => {
      if (part.parts) {
        for (const subPart of part.parts) {
          await processPayload(subPart)
        }
      }
      
      // Process ANY attachment, not just specific types
      if (part.filename && part.body?.attachmentId) {
        console.log(`Processing attachment: ${part.filename} (${part.mimeType})`)
        
        try {
          // Download attachment
          const attachmentResponse = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${part.body.attachmentId}`,
            {
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json',
              },
            }
          )
          
          if (attachmentResponse.ok) {
            const attachmentData = await attachmentResponse.json()
            
            const attachment = {
              filename: part.filename,
              mimeType: part.mimeType,
              size: part.body.size || 0,
              data: attachmentData.data, // Raw base64 data
              extractedText: '', // Will contain extracted text if possible
              contentType: this.identifyContentType(part.filename, part.mimeType)
            }
            
            // Try to extract text from various document types
            attachment.extractedText = await this.extractTextFromAttachment(
              attachmentData.data, 
              part.mimeType, 
              part.filename
            )
            
            attachments.push(attachment)
          }
        } catch (attachmentError) {
          console.warn(`Failed to download attachment ${part.filename}:`, attachmentError)
          // Still add attachment info even if download failed
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType,
            size: part.body.size || 0,
            data: '',
            extractedText: `Failed to download: ${attachmentError instanceof Error ? attachmentError.message : String(attachmentError)}`,
            contentType: this.identifyContentType(part.filename, part.mimeType),
            error: attachmentError instanceof Error ? attachmentError.message : String(attachmentError)
          })
        }
      }
    }
    
    await processPayload(payload)
    return attachments
  },

  // Universal text extraction from different file types
  async extractTextFromAttachment(base64Data: string, mimeType: string, filename: string): Promise<string> {
    if (!base64Data) return ''

    try {
      // Convert base64url to base64
      const cleanBase64 = base64Data.replace(/-/g, '+').replace(/_/g, '/')
      const paddedData = cleanBase64 + '='.repeat((4 - cleanBase64.length % 4) % 4)

      // Handle different file types
      if (mimeType === 'application/pdf') {
        try {
          const pdfBase64 = `data:application/pdf;base64,${paddedData}`
          let extractedText = await extractPdfTextFromBase64(pdfBase64)
          
          // Clean extracted text from any corruption
          extractedText = this.cleanExtractedText(extractedText)
          
          console.log(`PDF text extracted from ${filename}: ${extractedText.length} characters`)
          return extractedText
        } catch (pdfError) {
          console.warn(`PDF extraction failed for ${filename}:`, pdfError)
          return `PDF text extraction failed: ${pdfError instanceof Error ? pdfError.message : String(pdfError)}`
        }
      }
      
      // Handle plain text files
      else if (mimeType.startsWith('text/') || mimeType === 'application/json') {
        try {
          let textContent = atob(paddedData)
          textContent = this.cleanExtractedText(textContent)
          console.log(`Text extracted from ${filename}: ${textContent.length} characters`)
          return textContent
        } catch (textError) {
          console.warn(`Text extraction failed for ${filename}:`, textError)
          return `Text extraction failed: ${textError instanceof Error ? textError.message : String(textError)}`
        }
      }
      
      // Handle CSV files
      else if (mimeType === 'text/csv' || filename.toLowerCase().endsWith('.csv')) {
        try {
          let csvContent = atob(paddedData)
          csvContent = this.cleanExtractedText(csvContent)
          console.log(`CSV extracted from ${filename}: ${csvContent.length} characters`)
          return csvContent
        } catch (csvError) {
          console.warn(`CSV extraction failed for ${filename}:`, csvError)
          return `CSV extraction failed: ${csvError instanceof Error ? csvError.message : String(csvError)}`
        }
      }
      
      // For other file types, return metadata
      else {
        return `File type: ${mimeType}, Size: ${base64Data.length} bytes (base64). Text extraction not supported for this file type.`
      }

    } catch (error) {
      console.warn(`General extraction error for ${filename}:`, error)
      return `Content extraction failed: ${error && typeof error === 'object' && 'message' in error ? (error as any).message : String(error)}`
    }
  },

  // Universal text cleaning - removes corruption from any extracted text
  cleanExtractedText(text: string): string {
    if (!text) return ''
    
    return text
      // Remove all control characters that corrupt data (including null bytes)
      .replace(/[\x00-\x1F\x7F]/g, ' ')
      
      // Normalize multiple spaces to single spaces
      .replace(/\s+/g, ' ')
      
      // Clean up line breaks
      .replace(/\n\s+/g, '\n')
      .replace(/\s+\n/g, '\n')
      
      // Trim whitespace
      .trim()
  },

  // Identify content type for better processing
  identifyContentType(filename: string, mimeType: string): string {
    const extension = filename.toLowerCase().split('.').pop() || ''
    
    if (mimeType === 'application/pdf' || extension === 'pdf') return 'document'
    if (mimeType.startsWith('text/') || ['txt', 'md', 'csv'].includes(extension)) return 'text'
    if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif'].includes(extension)) return 'image'
    if (mimeType.includes('spreadsheet') || ['xls', 'xlsx'].includes(extension)) return 'spreadsheet'
    if (mimeType.includes('document') || ['doc', 'docx'].includes(extension)) return 'document'
    if (mimeType.includes('presentation') || ['ppt', 'pptx'].includes(extension)) return 'presentation'
    
    return 'unknown'
  },

  // Decode base64url
  decodeBase64Url(data: string): string {
    try {
      // Add safety check
      if (!data || typeof data !== 'string') {
        console.warn('decodeBase64Url: Invalid data parameter:', data)
        return ''
      }
      
      // Convert base64url to base64
      const base64 = data.replace(/-/g, '+').replace(/_/g, '/')
      // Add padding if necessary
      const padding = '='.repeat((4 - base64.length % 4) % 4)
      return atob(base64 + padding)
    } catch (error) {
      console.warn('Failed to decode base64url:', error)
      return ''
    }
  },

  // Token refresh functionality
  async refreshToken(connection) {
    console.log('Refreshing Gmail access token...')
    
    if (!connection.refresh_token) {
      throw new Error('No refresh token available for Gmail connection')
    }

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      throw new Error('Google OAuth credentials not configured')
    }

    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          refresh_token: connection.refresh_token,
          grant_type: 'refresh_token',
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Token refresh failed:', errorText)
        throw new Error(`Token refresh failed: ${response.status}`)
      }

      const tokens = await response.json()
      
      const expiresAt = new Date()
      expiresAt.setSeconds(expiresAt.getSeconds() + (tokens.expires_in || 3600))

      console.log('Gmail token refreshed successfully')

      return {
        access_token: tokens.access_token,
        expires_at: expiresAt.toISOString(),
        refresh_token: tokens.refresh_token || connection.refresh_token
      }

    } catch (error) {
      console.error('Gmail token refresh error:', error)
      throw error
    }
  }
}