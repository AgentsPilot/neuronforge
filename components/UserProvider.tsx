'use client'

import { createContext, useContext, useEffect, useState, useMemo } from 'react'
import { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'
import { getPluginAPIClient } from '@/lib/client/plugin-api-client'
import { clientLogger } from '@/lib/logger/client'
import { requestDeduplicator } from '@/lib/utils/request-deduplication'

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

  // Fetch user plugins from the V2 API
  const fetchUserPlugins = async (currentUser: User) => {
    try {
      clientLogger.debug({ userId: currentUser.id }, 'Fetching plugins for user')
      const apiClient = getPluginAPIClient()

      // Pass userId explicitly so the request is unambiguous. Identity is derived from
      // the session server-side; passing your OWN id is a self-target and always allowed
      // (see lib/server/route-identity.ts).
      //
      // The session cookie may not be readable yet immediately after sign-in. That used
      // to be masked by the route's caller-supplied-userId fallback, which has been
      // removed as a security fix — so a first call landing inside that window now gets
      // a clean 401. Retry once rather than rendering "no plugins connected".
      let status
      try {
        status = await apiClient.getUserPluginStatus(currentUser.id)
      } catch (firstError) {
        clientLogger.warn({ err: firstError }, 'Plugin status failed — retrying once (post-login cookie race)')
        // The client wraps this call in requestDeduplicator, which caches the REJECTED
        // promise until settle + TTL. Without clearing the key first, the retry replays
        // the same rejection instead of issuing a new request.
        requestDeduplicator.clear(`plugin-status-${currentUser.id}`)
        await new Promise(resolve => setTimeout(resolve, 750))
        status = await apiClient.getUserPluginStatus(currentUser.id)
      }
      clientLogger.debug({ connectedCount: status?.connected?.length ?? 0 }, 'Plugin status response received')

      // Transform array format to object format for backward compatibility
      // connected: [{ key: "google-mail", ... }] -> { "google-mail": { ... } }
      const connectedPluginsMap: Record<string, any> = {}

      // Add connected plugins (with valid tokens)
      if (status.connected && status.connected.length > 0) {
        status.connected.forEach((plugin) => {
          connectedPluginsMap[plugin.key] = {
            key: plugin.key,
            name: plugin.name,
            displayName: plugin.name, // V2 API doesn't have displayName, use name
            label: plugin.name,
            isConnected: true,
            is_expired: false,
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

      // Add active but expired plugins (need to reconnect)
      if (status.active_expired && status.active_expired.length > 0) {
        status.active_expired.forEach((pluginKey: string) => {
          // Only add if not already in the map (connected takes precedence)
          if (!connectedPluginsMap[pluginKey]) {
            connectedPluginsMap[pluginKey] = {
              key: pluginKey,
              name: pluginKey, // Use key as name for expired plugins
              displayName: pluginKey,
              label: pluginKey,
              isConnected: true,
              is_expired: true, // Mark as expired
              capabilities: [],
              category: 'integration',
              icon: '',
            }
          }
        })
      }

      clientLogger.debug({ pluginKeys: Object.keys(connectedPluginsMap) }, 'Setting connected plugins')
      clientLogger.debug({ count: Object.keys(connectedPluginsMap).length }, 'Connected plugin count')
      setConnectedPlugins(connectedPluginsMap)

    } catch (error) {
      clientLogger.error({ err: error }, 'Error fetching user plugins')
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
          clientLogger.error({ err: error }, 'Error getting session')
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
        clientLogger.error({ err: error }, 'Session error')
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