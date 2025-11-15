'use client'

import { createContext, useContext, useEffect, useState, useMemo } from 'react'
import { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'
import { getPluginAPIClient } from '@/lib/client/plugin-api-client'

type AuthContextType = {
  user: User | null
  session: Session | null
  loading: boolean
  connectedPlugins: Record<string, any> | null
  refreshPlugins: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  connectedPlugins: null,
  refreshPlugins: async () => {},
})

export const useAuth = () => useContext(AuthContext)

export const UserProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [connectedPlugins, setConnectedPlugins] = useState<Record<string, any> | null>(null)

  // Fetch user plugins from the V2 API (using cookie auth, no userId needed)
  const fetchUserPlugins = async (currentUser: User) => {
    try {
      const apiClient = getPluginAPIClient()

      // Use V2 endpoint with cookie auth (no userId needed - uses session)
      const status = await apiClient.getUserPluginStatus()

      // Transform array format to object format for backward compatibility
      // connected: [{ key: "google-mail", ... }] -> { "google-mail": { ... } }
      const connectedPluginsMap: Record<string, any> = {}

      if (status.connected && status.connected.length > 0) {
        status.connected.forEach((plugin) => {
          connectedPluginsMap[plugin.key] = {
            key: plugin.key,
            name: plugin.name,
            displayName: plugin.name, // V2 API doesn't have displayName, use name
            label: plugin.name,
            isConnected: true,
            capabilities: [], // V2 API has actions instead, could map if needed
            category: 'integration', // Default category
            icon: '', // Not provided by V2 API
            // V2 specific fields
            description: plugin.description,
            actions: plugin.actions,
            action_count: plugin.action_count,
            username: plugin.username,
            email: plugin.email,
            connected_at: plugin.connected_at,
            last_used: plugin.last_used,
          }
        })
      }

      setConnectedPlugins(connectedPluginsMap)

    } catch (error) {
      console.error('Error fetching user plugins:', error)
      // Set empty object on error rather than leaving as null
      setConnectedPlugins({})
    }
  }

  // Refresh plugins function for external use
  const refreshPlugins = async () => {
    if (user) {
      await fetchUserPlugins(user)
    }
  }

  useEffect(() => {
    const getSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()

        if (error) {
          console.error('Error getting session:', error)
          setSession(null)
          setUser(null)
          setConnectedPlugins({})
        } else {
          setSession(data.session)
          setUser(data.session?.user ?? null)

          // Only fetch plugins if user is authenticated AND not on Settings/Connections page
          // Settings page fetches its own data to avoid duplicate API calls
          const isOnSettingsPage = typeof window !== 'undefined' &&
            window.location.pathname.includes('/settings/connections')

          if (data.session?.user && !isOnSettingsPage) {
            await fetchUserPlugins(data.session.user)
          } else if (!data.session?.user) {
            setConnectedPlugins({})
          }
        }
      } catch (error) {
        console.error('Session error:', error)
        setConnectedPlugins({})
      } finally {
        setLoading(false)
      }
    }

    getSession()

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {

      setSession(session)
      setUser(session?.user ?? null)

      // Only fetch plugins when user signs in if not on Settings page
      const isOnSettingsPage = typeof window !== 'undefined' &&
        window.location.pathname.includes('/settings/connections')

      if (session?.user && !isOnSettingsPage) {
        await fetchUserPlugins(session.user)
      } else if (!session?.user) {
        setConnectedPlugins({})
      }

      setLoading(false)
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  // Create enhanced user object with connectedPlugins
  // Use useMemo to prevent unnecessary re-renders when user object reference doesn't actually change
  const enhancedUser = useMemo(() => {
    return user ? {
      ...user,
      connectedPlugins
    } : null
  }, [user, connectedPlugins])

  return (
    <AuthContext.Provider value={{ 
      session, 
      user: enhancedUser, 
      loading, 
      connectedPlugins,
      refreshPlugins 
    }}>
      {children}
    </AuthContext.Provider>
  )
}