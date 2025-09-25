'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'

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

  // Fetch user plugins from the enhanced API
  const fetchUserPlugins = async (currentUser: User) => {
    try {
      console.log('UserProvider: Fetching plugins for user:', currentUser.id)
      
      const response = await fetch('/api/user/plugins', {
        headers: {
          'x-user-id': currentUser.id
        }
      })

      if (!response.ok) {
        throw new Error(`Plugin fetch failed: ${response.status}`)
      }

      const data = await response.json()
      
      console.log('UserProvider: Plugin API response received')

      // Extract enhanced plugin data from API response
      if (data._meta && data._meta.connectedPlugins) {
        setConnectedPlugins(data._meta.connectedPlugins)
        
        console.log('UserProvider: Set connectedPlugins with', Object.keys(data._meta.connectedPlugins).length, 'plugins')
      } else {
        console.warn('UserProvider: No enhanced plugin metadata in API response, setting empty object')
        setConnectedPlugins({})
      }

    } catch (error) {
      console.error('UserProvider: Failed to fetch user plugins:', error)
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
          
          // Fetch plugins if user is authenticated
          if (data.session?.user) {
            await fetchUserPlugins(data.session.user)
          } else {
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
      console.log('UserProvider: Auth state change:', _event)
      
      setSession(session)
      setUser(session?.user ?? null)
      
      // Fetch plugins when user signs in
      if (session?.user) {
        await fetchUserPlugins(session.user)
      } else {
        setConnectedPlugins({})
      }
      
      setLoading(false)
    })

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  // Create enhanced user object with connectedPlugins
  const enhancedUser = user ? {
    ...user,
    connectedPlugins
  } : null

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