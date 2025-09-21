// lib/plugins/strategies/googleDriveDataStrategy.ts
import type { PluginStrategy } from '../pluginRegistry'

export const googleDriveDataStrategy: PluginStrategy = {
  pluginKey: 'google-drive',
  name: 'Google Drive',
  
  connect: async ({ supabase, popup, userId }) => {
    // Delegate to the OAuth strategy
    const { googleDriveStrategy } = await import('./googleDrivePluginStrategy')
    return googleDriveStrategy.connect({ supabase, popup, userId })
  },

  handleOAuthCallback: async ({ code, state, supabase }) => {
    // Delegate to the OAuth strategy
    const { googleDriveStrategy } = await import('./googleDrivePluginStrategy')
    if (!googleDriveStrategy?.handleOAuthCallback) {
      throw new Error('googleDriveStrategy.handleOAuthCallback is not defined')
    }
    return googleDriveStrategy.handleOAuthCallback({ code, state, supabase })
  },

  // Main plugin functionality for agents
  run: async ({ connection, userId, input_variables }) => {
    console.log('Running Google Drive plugin...', { userId, hasConnection: !!connection })
    
    if (!connection?.access_token) {
      throw new Error('Google Drive connection not available or expired')
    }

    try {
      const action = input_variables.action || 'search'
      
      switch (action) {
        case 'search':
          return await searchFiles(connection.access_token, input_variables)
        
        case 'read':
          return await readFile(connection.access_token, input_variables.fileId)
        
        case 'create':
          return await createFile(connection.access_token, input_variables)
        
        case 'list':
          return await listFolder(connection.access_token, input_variables.folderId)
        
        default:
          throw new Error(`Unknown action: ${action}`)
      }
    } catch (error) {
      console.error('Google Drive plugin error:', error)
      throw error
    }
  }
}

// Helper functions for Drive operations
async function searchFiles(accessToken: string, params: any) {
  const {
    query = '',
    mimeType = '',
    folderId = '',
    limit = 50
  } = params

  let searchQuery = 'trashed=false'
  
  if (query) {
    searchQuery += ` and name contains '${query}'`
  }
  
  if (mimeType) {
    searchQuery += ` and mimeType='${mimeType}'`
  }
  
  if (folderId) {
    searchQuery += ` and '${folderId}' in parents`
  }

  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('q', searchQuery)
  url.searchParams.set('pageSize', limit.toString())
  url.searchParams.set('orderBy', 'modifiedTime desc')
  url.searchParams.set('fields', 'files(id,name,mimeType,size,modifiedTime,createdTime,parents,webViewLink,description)')

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to search files: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return {
    files: data.files || [],
    total: data.files?.length || 0,
    query: searchQuery
  }
}

async function readFile(accessToken: string, fileId: string) {
  // First get file metadata
  const metaResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,modifiedTime,parents`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  })

  if (!metaResponse.ok) {
    throw new Error(`Failed to get file metadata: ${metaResponse.status} ${metaResponse.statusText}`)
  }

  const metadata = await metaResponse.json()

  // Handle Google Workspace files differently
  let content = ''
  
  if (metadata.mimeType?.startsWith('application/vnd.google-apps.')) {
    // Export Google Workspace files
    let exportMimeType = 'text/plain'
    
    if (metadata.mimeType.includes('document')) {
      exportMimeType = 'text/plain'
    } else if (metadata.mimeType.includes('spreadsheet')) {
      exportMimeType = 'text/csv'
    } else if (metadata.mimeType.includes('presentation')) {
      exportMimeType = 'text/plain'
    }
    
    const exportResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMimeType)}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    })
    
    if (exportResponse.ok) {
      content = await exportResponse.text()
    }
  } else {
    // Regular files
    const contentResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    })
    
    if (contentResponse.ok) {
      content = await contentResponse.text()
    }
  }

  return {
    file: metadata,
    content: content || 'Could not read file content',
    contentLength: content.length
  }
}

async function createFile(accessToken: string, params: any) {
  const {
    name,
    content = '',
    mimeType = 'text/plain',
    parents = []
  } = params

  const fileMetadata: any = { name }
  if (parents && parents.length > 0) {
    fileMetadata.parents = parents
  }

  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(fileMetadata)], { type: 'application/json' }))
  form.append('file', new Blob([content], { type: mimeType }))

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
    body: form
  })

  if (!response.ok) {
    throw new Error(`Failed to create file: ${response.status} ${response.statusText}`)
  }

  return await response.json()
}

async function listFolder(accessToken: string, folderId: string) {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  url.searchParams.set('q', `'${folderId}' in parents and trashed=false`)
  url.searchParams.set('orderBy', 'name')
  url.searchParams.set('fields', 'files(id,name,mimeType,size,modifiedTime,webViewLink)')

  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to list folder: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return {
    folderId,
    items: data.files || [],
    total: data.files?.length || 0
  }
}