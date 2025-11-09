// components/orchestration/components/configuration/PluginConnectionManager.tsx
import React, { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Globe, AlertCircle } from 'lucide-react'

export interface PluginConnection {
  id: string
  user_id: string
  plugin_key: string
  plugin_name: string
  access_token: string
  refresh_token?: string
  expires_at?: string
  scope?: string
  username?: string
  email?: string
  profile_data: any
  settings: any
  status: 'active' | 'expired' | 'error' | 'disabled'
  last_used?: string
  connected_at: string
  created_at: string
  updated_at: string
}

interface PluginConnectionManagerProps {
  children: (data: {
    pluginConnections: PluginConnection[]
    loading: boolean
    currentUserId: string | null
    refetch: () => Promise<void>
  }) => React.ReactNode
}

// Get the authenticated user ID
const getCurrentUserId = async () => {
  try {
    const { data: { user }, error } = await supabase.auth.getUser()
    
    if (error) {
      console.error('Auth error:', error)
      return null
    }
    
    return user?.id || null
  } catch (error) {
    console.error('Failed to get current user:', error)
    return null
  }
}

// Fetch user's connected plugins from Supabase
const fetchPluginConnections = async (userId: string): Promise<PluginConnection[]> => {
  try {
    console.log('🔍 Fetching plugin connections for user:', userId)
    
    const { data, error } = await supabase
      .from('plugin_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('connected_at', { ascending: false })
    
    if (error) {
      console.error('Supabase error:', error)
      throw error
    }
    
    console.log('🔍 Raw Supabase data:', data)
    return data || []
    
  } catch (error) {
    console.error('Failed to fetch plugin connections:', error)
    return []
  }
}

export const PluginConnectionManager: React.FC<PluginConnectionManagerProps> = ({ children }) => {
  const [pluginConnections, setPluginConnections] = useState<PluginConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  const loadPluginConnections = async () => {
    try {
      setLoading(true)
      
      // Get the current user ID
      const userId = await getCurrentUserId()
      console.log('🔍 Current user ID:', userId)
      
      if (!userId) {
        console.log('❌ No user ID found - user not authenticated')
        
        // FOR TESTING: Add mock data when not authenticated
        // Remove this in production when authentication is properly set up
        const mockConnections = [
          {
            id: 'mock-1',
            user_id: 'mock-user',
            plugin_key: 'google-mail',
            plugin_name: 'Gmail',
            access_token: 'mock-token',
            refresh_token: 'mock-refresh',
            expires_at: new Date(Date.now() + 3600000).toISOString(),
            scope: 'https://www.googleapis.com/auth/gmail.readonly',
            username: null,
            email: 'test@example.com',
            profile_data: {
              id: 'mock-google-id',
              name: 'Test User',
              email: 'test@example.com',
              picture: 'https://example.com/avatar.jpg',
              verified_email: true
            },
            settings: {},
            status: 'active' as const,
            last_used: null,
            connected_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ]
        
        console.log('🔍 DEBUG: Using mock data for testing:', mockConnections)
        setPluginConnections(mockConnections)
        setCurrentUserId('mock-user')
        return
      }
      
      setCurrentUserId(userId)
      
      const connections = await fetchPluginConnections(userId)
      const activeConnections = connections.filter(conn => conn.status === 'active')
      
      // 🔍 DEBUG: Log what we got from Supabase
      console.log('🔍 DEBUG: Raw connections from Supabase:', connections)
      console.log('🔍 DEBUG: Active connections:', activeConnections)
      console.log('🔍 DEBUG: Connected plugin keys:', activeConnections.map(c => c.plugin_key))
      
      setPluginConnections(activeConnections)
    } catch (error) {
      console.error('Failed to load plugin connections:', error)
      setPluginConnections([])
      setCurrentUserId(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPluginConnections()
  }, [])

  return (
    <>
      {children({
        pluginConnections,
        loading,
        currentUserId,
        refetch: loadPluginConnections
      })}
    </>
  )
}