// lib/hooks/useUIVersion.ts
// Hook to determine which UI version to display (V1 or V2)

'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'

export type UIVersion = 'v1' | 'v2'

export function useUIVersion(): UIVersion {
  const [version, setVersion] = useState<UIVersion>('v1')

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const { data, error } = await supabase
          .from('system_settings_config')
          .select('value')
          .eq('key', 'ui_version')
          .single()

        if (error) {
          console.error('Error fetching UI version:', error)
          return
        }

        const versionValue = data?.value as UIVersion
        if (versionValue === 'v1' || versionValue === 'v2') {
          setVersion(versionValue)
        }
      } catch (error) {
        console.error('Error in useUIVersion:', error)
      }
    }

    fetchVersion()
  }, [])

  return version
}

/**
 * Get UI version synchronously from system settings
 * Use this in middleware or server components
 */
export async function getUIVersion(): Promise<UIVersion> {
  try {
    const { data, error } = await supabase
      .from('system_settings_config')
      .select('value')
      .eq('key', 'ui_version')
      .single()

    if (error || !data) {
      return 'v1' // Default to V1 if error
    }

    const version = data.value as UIVersion
    return (version === 'v1' || version === 'v2') ? version : 'v1'
  } catch (error) {
    console.error('Error getting UI version:', error)
    return 'v1'
  }
}

/**
 * Update UI version (admin only)
 */
export async function setUIVersion(version: UIVersion): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('system_settings_config')
      .update({ value: version })
      .eq('key', 'ui_version')

    if (error) {
      console.error('Error setting UI version:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('Error in setUIVersion:', error)
    return false
  }
}
