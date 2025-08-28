// lib/plugins/strategies/gmailDataStrategy.ts
import { gmailStrategy } from './gmailPluginStrategy'

export interface GmailDataStrategy {
  pluginKey: string
  name: string
  connect(params: { supabase: any; popup: Window; userId: string }): Promise<void>
  handleOAuthCallback?(params: { code: string; state: string; supabase?: any }): Promise<any>
  run(params: { connection: any; userId: string; input_variables: Record<string, any> }): Promise<any>
  refreshToken?(connection: any): Promise<any>
}

export const gmailDataStrategy: GmailDataStrategy = {
  ...gmailStrategy, // Inherit OAuth connection functionality

  // Add the run function to fetch emails
  async run({ connection, userId, input_variables }) {
    console.log('Gmail Data Plugin: Starting email fetch...', {
      userId,
      hasAccessToken: !!connection.access_token,
      tokenExpiry: connection.expires_at
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

      // Determine search parameters from input variables
      const maxResults = input_variables.maxEmails || 10
      const query = input_variables.emailQuery || 'in:inbox'
      
      console.log('Fetching emails with params:', {
        maxResults,
        query,
        userEmail: connection.username
      })

      // Fetch emails from Gmail API
      const emailsUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
      emailsUrl.searchParams.set('maxResults', maxResults.toString())
      emailsUrl.searchParams.set('q', query)

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
        resultSizeEstimate: listData.resultSizeEstimate
      })

      if (!listData.messages || listData.messages.length === 0) {
        return {
          summary: `No emails found matching query: "${query}"`,
          totalEmails: 0,
          emails: [],
          searchQuery: query
        }
      }

      // Fetch details for each email (limit to prevent overwhelming)
      const emailsToFetch = listData.messages.slice(0, Math.min(5, maxResults))
      const emailDetails = []

      for (const message of emailsToFetch) {
        try {
          console.log(`Fetching details for email: ${message.id}`)
          
          const detailResponse = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
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

            emailDetails.push({
              id: email.id,
              threadId: email.threadId,
              subject: getHeader('Subject'),
              from: getHeader('From'),
              date: getHeader('Date'),
              snippet: email.snippet || '',
              labels: email.labelIds || []
            })
          } else {
            console.warn(`Failed to fetch email ${message.id}: ${detailResponse.status}`)
          }
        } catch (emailError) {
          console.warn(`Error fetching email ${message.id}:`, emailError)
        }
      }

      // Create summary
      const summary = `Found ${emailDetails.length} emails from Gmail inbox:
${emailDetails.map((email, idx) => 
  `${idx + 1}. From: ${email.from}
     Subject: ${email.subject}
     Date: ${email.date}
     Preview: ${email.snippet.substring(0, 100)}...`
).join('\n\n')}`

      const result = {
        summary,
        totalEmails: emailDetails.length,
        totalAvailable: listData.resultSizeEstimate || 0,
        emails: emailDetails,
        searchQuery: query,
        userEmail: connection.username,
        fetchedAt: new Date().toISOString()
      }

      console.log('Gmail data fetch successful:', {
        emailsReturned: emailDetails.length,
        summaryLength: summary.length
      })

      return result

    } catch (error: any) {
      console.error('Gmail data fetch failed:', error)
      
      // Return structured error that won't break the agent
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

  // Add token refresh functionality
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
      
      // Calculate new expiration
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