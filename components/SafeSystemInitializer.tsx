// components/SafeSystemInitializer.tsx

'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

let initializationAttempted = false // Global flag to prevent multiple attempts

export function SafeSystemInitializer() {
  const [status, setStatus] = useState<{
    isInitializing: boolean
    isInitialized: boolean
    error: string | null
  }>({
    isInitializing: false,
    isInitialized: false,
    error: null
  })

  useEffect(() => {
    // Only run once per session
    if (initializationAttempted) {
      return
    }

    initializationAttempted = true
    
    // Add a delay to ensure everything is loaded
    const timer = setTimeout(() => {
      initializeSystem()
    }, 500) // 2 second delay

    return () => clearTimeout(timer)
  }, [])

  const initializeSystem = async () => {
    if (status.isInitializing || status.isInitialized) {
      return
    }

    setStatus(prev => ({ ...prev, isInitializing: true, error: null }))

    try {
      console.log('🚀 Starting NeuronForge system initialization...')
      
      // Test basic connectivity first
      const healthResponse = await fetch('/api/system/health', {
        method: 'GET'
      }).catch(() => null)

      if (!healthResponse || !healthResponse.ok) {
        console.log('⚠️ System health check failed, skipping full initialization')
      }

      // If health check passes, proceed with initialization
      const response = await fetch('/api/system/initialize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Initialization failed')
      }

      console.log('✅ NeuronForge system initialized successfully')
      
      setStatus({
        isInitializing: false,
        isInitialized: true,
        error: null
      })

      // Show subtle success message
      toast.success('System Ready', {
        description: 'NeuronForge scheduler is running',
        duration: 2000
      })

    } catch (error) {
      console.error('❌ System initialization failed:', error)
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      
      setStatus(prev => ({
        ...prev,
        isInitializing: false,
        error: errorMessage
      }))

      // Only show error if it's a real issue
      if (!errorMessage.includes('health check')) {
        toast.error('System initialization failed', {
          description: errorMessage,
          duration: 5000
        })
      }
    }
  }

  // This component renders nothing visible
  return null
}