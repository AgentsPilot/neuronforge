'use server'

import { google } from 'googleapis'
import { supabase } from '@/lib/supabaseServer'
import { savePluginConnection } from '@/lib/plugins/savePluginConnection'

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly']
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI
)

export const googleDrivePluginStrategy = {
  key: 'google-drive',
  label: 'Google Drive',
  icon: '/icons/google-drive.svg',

  /**
   * Step 1: Get OAuth URL for Drive connection
   */
  async connect(userId: string) {
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent'
    })

    return url
  },

  /**
   * Step 2: Handle OAuth callback from Google
   */
  async handleOAuthCallback({ code, userId }: { code: string; userId: string }) {
    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    // Get Google Drive profile info
    const drive = google.drive({ version: 'v3', auth: oauth2Client })
    const about = await drive.about.get({ fields: 'user' })
    const email = about.data.user?.emailAddress

    // Save connection to Supabase
    await savePluginConnection({
      userId,
      pluginKey: 'google-drive',
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      metadata: { email }
    })

    return { success: true, email }
  },

  /**
   * Step 3: Refresh access token if expired
   */
  async refreshToken(refreshToken: string) {
    oauth2Client.setCredentials({ refresh_token: refreshToken })
    const { credentials } = await oauth2Client.refreshAccessToken()
    return credentials.access_token
  },

  /**
   * Step 4: Disconnect Google Drive
   */
  async disconnect(userId: string) {
    await supabase
      .from('plugin_connections')
      .delete()
      .eq('user_id', userId)
      .eq('plugin_key', 'google-drive')
  },

  /**
   * Step 5: Fetch latest 10 files from Drive
   */
  async run({ accessToken }: { accessToken: string }) {
    oauth2Client.setCredentials({ access_token: accessToken })
    const drive = google.drive({ version: 'v3', auth: oauth2Client })

    const res = await drive.files.list({
      pageSize: 10,
      fields: 'files(id, name, mimeType, modifiedTime)'
    })

    return {
      files: res.data.files || []
    }
  }
}