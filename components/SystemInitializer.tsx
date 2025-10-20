// components/SystemInitializer.tsx

'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'

interface InitializationStatus {
  isInitializing: boolean
  isInitialized: boolean
  error: string | null
  steps: {
    database: boolean
    cleanup: boolean
    scheduler: boolean
  }
}

export function SystemInitializer() {
  const [status, setStatus] = useState<InitializationStatus>({
    isInitializing: false,
    isInitialized: false,
    error: null,
    steps: { database: false, cleanup: false, scheduler: false }
  })

  useEffect(() => {
    initializeSystem()
  }, [])

  const initializeSystem = async () => {
    // Only run on client side and only once
    if (typeof window === 'undefined' || status.isInitializing || status.isInitialized) {
      return
    }

    setStatus(prev => ({ ...prev, isInitializing: true, error: null }))

    try {
      console.log('🚀 Starting NeuronForge system initialization...')
      
      // Call the initialization API endpoint
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
        error: null,
        steps: result.steps
      })

      // Show success toast (optional - you can remove this if you don't want notifications)
      toast.success('NeuronForge system is ready!', {
        description: 'Scheduler is running and monitoring your agents',
        duration: 3000
      })

    } catch (error) {
      console.error('❌ NeuronForge system initialization failed:', error)
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      
      setStatus(prev => ({
        ...prev,
        isInitializing: false,
        error: errorMessage
      }))

      // Show error toast
      toast.error('System initialization failed', {
        description: errorMessage,
        duration: 5000,
        action: {
          label: 'Retry',
          onClick: () => {
            setStatus({
              isInitializing: false,
              isInitialized: false,
              error: null,
              steps: { database: false, cleanup: false, scheduler: false }
            })
            initializeSystem()
          }
        }
      })
    }
  }

  // This component doesn't render anything visible
  // It just handles the initialization in the background
  return null
}

// Optional: Create a debug component to show initialization status
export function SystemStatus() {
  const [systemStatus, setSystemStatus] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchSystemStatus()
    
    // Refresh status every 30 seconds
    const interval = setInterval(fetchSystemStatus, 30000)
    return () => clearInterval(interval)
  }, [])

  const fetchSystemStatus = async () => {
    try {
      const response = await fetch('/api/system/status')
      const data = await response.json()
      
      if (data.success) {
        setSystemStatus(data.system)
      }
    } catch (error) {
      console.error('Failed to fetch system status:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 bg-gray-50 rounded-lg">
        <div className="animate-pulse">Loading system status...</div>
      </div>
    )
  }

  if (!systemStatus) {
    return (
      <div className="p-4 bg-red-50 rounded-lg">
        <div className="text-red-600">Unable to load system status</div>
      </div>
    )
  }

  return (
    <div className="p-4 bg-green-50 rounded-lg">
      <h3 className="font-semibold text-green-800 mb-2">System Status</h3>
      <div className="space-y-1 text-sm text-green-700">
        <div>
          Scheduler: {systemStatus.scheduler.isRunning ? 
            <span className="text-green-600 font-medium">Running</span> : 
            <span className="text-red-600 font-medium">Stopped</span>
          }
        </div>
        <div>Scheduled Agents: {systemStatus.scheduler.scheduledAgentsCount}</div>
        <div>Active Agents: {systemStatus.totalActiveAgents}</div>
        <div>Total Executions: {systemStatus.totalExecutions}</div>
        <div className="text-xs text-gray-500">
          Last updated: {new Date(systemStatus.timestamp).toLocaleTimeString()}
        </div>
      </div>
    </div>
  )
}