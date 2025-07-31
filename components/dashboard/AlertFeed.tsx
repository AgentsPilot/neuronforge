'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import { Button } from '@/components/ui/button'
import { motion, AnimatePresence } from 'framer-motion'
import { Switch } from '@/components/ui/switch'
import { 
  AlertTriangle, 
  AlertCircle, 
  Info, 
  X, 
  Check, 
  Clock, 
  Filter,
  SortAsc,
  SortDesc,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle
} from 'lucide-react'

// Define the Alert type
type AlertItem = {
  id: string
  timestamp: string
  title: string
  message: string
  severity: 'high' | 'medium' | 'low'
  agentName: string
  isRead?: boolean
}

const severityConfig = {
  high: {
    icon: AlertTriangle,
    color: 'text-red-600',
    bg: 'bg-red-50',
    border: 'border-red-200',
    badge: 'bg-red-100 text-red-800',
    order: 1
  },
  medium: {
    icon: AlertCircle,
    color: 'text-yellow-600',
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    badge: 'bg-yellow-100 text-yellow-800',
    order: 2
  },
  low: {
    icon: Info,
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    badge: 'bg-blue-100 text-blue-800',
    order: 3
  }
}

type SortOption = 'newest' | 'oldest' | 'severity-high' | 'severity-low' | 'agent'
type FilterOption = 'all' | 'high' | 'medium' | 'low' | 'unread'

export default function AlertFeed() {
  const { user } = useAuth()
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const [filterBy, setFilterBy] = useState<FilterOption>('all')
  const [selectedAlerts, setSelectedAlerts] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showDismissed, setShowDismissed] = useState(false)
  const [showDebugPanel, setShowDebugPanel] = useState(false) // Start with debug panel closed
  const [debugData, setDebugData] = useState<any>(null)

  const normalizeSeverity = (val?: string): 'low' | 'medium' | 'high' | null => {
    const v = val?.toLowerCase()
    if (['low', 'info'].includes(v)) return 'low'
    if (['medium', 'warn', 'warning'].includes(v)) return 'medium'
    if (['high', 'critical', 'error'].includes(v)) return 'high'
    return null
  }

  const fetchAlerts = async () => {
    if (!user) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      console.log('🔍 Fetching alerts for user:', user.id)
      console.log('🔍 Show dismissed:', showDismissed)

      const { data, error } = await supabase
        .from('agent_logs')
        .select(`
          id, 
          created_at, 
          full_output,
          dismissed,
          agents!inner(
            agent_name,
            output_schema
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      console.log('🔍 Raw database response:', data)
      console.log('🔍 Database error:', error)

      if (error) {
        setError(`Failed to fetch alerts: ${error.message}`)
        setLoading(false)
        return
      }

      if (!data || data.length === 0) {
        console.log('🔍 No data found in agent_logs')
        setAlerts([])
        setLoading(false)
        return
      }

      console.log(`🔍 Found ${data.length} total logs`)

      const parsed = []
      const debugInfo = {
        totalLogs: data.length,
        alertAgents: 0,
        dismissedLogs: 0,
        validAlerts: 0,
        skippedReasons: []
      }

      for (const log of data) {
        try {
          console.log(`🔍 Processing log ${log.id}:`)
          console.log('  - Agent:', log.agents?.agent_name)
          console.log('  - Output Schema:', log.agents?.output_schema)
          console.log('  - Dismissed:', log.dismissed)
          console.log('  - Full Output:', log.full_output)

          const outputSchema = log.agents?.output_schema
          
          // Check if this agent is configured to produce alerts
          const isAlertAgent = outputSchema && 
            (outputSchema.type === 'Alert' || 
             (Array.isArray(outputSchema) && outputSchema.some(schema => schema.type === 'Alert')))

          if (!isAlertAgent) {
            console.log('  ❌ Skipped: Not an alert agent (output_schema.type is not "Alert")')
            debugInfo.skippedReasons.push(`Log ${log.id}: Not an alert agent`)
            continue
          }

          console.log('  ✅ This is an alert agent')
          debugInfo.alertAgents++

          // Track dismissed status for debugging
          if (log.dismissed) {
            debugInfo.dismissedLogs++
            console.log('  ⚠️ This log is dismissed')
          }
          
          const agentName = log.agents?.agent_name || 'Unknown Agent'
          
          // Extract the actual alert data from full_output
          let alertData = null
          if (log.full_output && typeof log.full_output === 'object') {
            console.log('  🔍 Checking full_output structure...')
            console.log('  🔍 Full output keys:', Object.keys(log.full_output))
            
            // Try multiple possible locations for the alert data
            const possiblePaths = [
              { path: 'parsed_output', data: log.full_output.parsed_output },
              { path: 'result', data: log.full_output.result },
              { path: 'output', data: log.full_output.output },
              { path: 'alert', data: log.full_output.alert },
              { path: 'root level', data: log.full_output }
            ]

            for (const { path, data } of possiblePaths) {
              if (data && data.title && data.message) {
                alertData = data
                console.log(`  ✅ Found complete alert data in ${path}:`, alertData)
                break
              } else if (data) {
                console.log(`  🔍 Checked ${path} but missing title/message:`, data)
              }
            }

            // Special handling for alert agents: if we have a message but no title,
            // create an alert using the output_schema as a template
            if (!alertData && log.full_output.message && isAlertAgent) {
              console.log('  🔄 Alert agent with message only - creating alert from schema template')
              
              // Use the output_schema as a template and the actual message
              const schemaTemplate = outputSchema
              alertData = {
                title: schemaTemplate.title || 'Alert Notification',
                message: log.full_output.message,
                severity: schemaTemplate.severity || 'medium'
              }
              console.log(`  ✅ Created alert from template:`, alertData)
            }

            if (!alertData) {
              console.log('  ❌ No valid alert data found in any location')
              console.log('  🔍 Raw full_output:', JSON.stringify(log.full_output, null, 2))
            }
          } else {
            console.log('  ❌ full_output is not an object:', typeof log.full_output, log.full_output)
          }

          if (alertData && alertData.title && alertData.message) {
            const severity = normalizeSeverity(alertData.severity) || 'low'
            
            const alert = {
              id: log.id,
              timestamp: log.created_at,
              title: alertData.title,
              message: alertData.message,
              severity,
              agentName,
              isRead: false,
              isDismissed: !!log.dismissed
            }
            
            parsed.push(alert)
            debugInfo.validAlerts++
            console.log('  ✅ Successfully parsed alert:', alert.title)
          } else {
            console.log('  ❌ Missing required fields:')
            console.log('    - Has title:', !!(alertData?.title))
            console.log('    - Has message:', !!(alertData?.message))
            console.log('    - Alert data:', alertData)
            debugInfo.skippedReasons.push(`Log ${log.id}: Missing title or message`)
          }
        } catch (err) {
          console.warn('Failed to process log:', err)
          debugInfo.skippedReasons.push(`Log ${log.id}: Processing error - ${err.message}`)
        }
      }

      console.log('🔍 Final debug info:', debugInfo)
      console.log('🔍 Parsed alerts:', parsed)

      // Store debug data for UI display
      setDebugData({
        ...debugInfo,
        rawLogs: data.slice(0, 3), // Show first 3 logs for inspection
        parsedAlerts: parsed
      })

      console.log('🔍 Setting alerts in state:', parsed)
      setAlerts(parsed)
      
      // Debug: Track alerts state changes
      console.log('🔍 Alerts state before setting:', alerts.length)
      
      // Debug: Check if alerts disappear after setting
      setTimeout(() => {
        console.log('🔍 Alerts state after 1 second - checking if they disappeared')
      }, 1000)
    } catch (err) {
      console.error('❌ Unexpected error:', err)
      setError(`Unexpected error: ${err?.message || String(err)}`)
    }

    setLoading(false)
  }

  const dismissAlert = async (id: string) => {
    console.log('🗑️ Dismissing alert:', id)
    try {
      const { error } = await supabase.from('agent_logs').update({ dismissed: true }).eq('id', id)
      if (error) {
        console.error('❌ Error dismissing alert:', error)
        return
      }
      console.log('✅ Alert dismissed successfully')
      setAlerts((prev) => {
        const newAlerts = prev.filter((a) => a.id !== id)
        console.log('🔍 Alerts after dismissing:', newAlerts)
        return newAlerts
      })
      setSelectedAlerts(prev => {
        const newSet = new Set(prev)
        newSet.delete(id)
        return newSet
      })
    } catch (err) {
      console.error('❌ Unexpected error dismissing alert:', err)
    }
  }

  const dismissSelected = async () => {
    if (selectedAlerts.size === 0) return
    
    const ids = Array.from(selectedAlerts)
    await Promise.all(ids.map(id => 
      supabase.from('agent_logs').update({ dismissed: true }).eq('id', id)
    ))
    
    setAlerts(prev => prev.filter(a => !selectedAlerts.has(a.id)))
    setSelectedAlerts(new Set())
  }

  const markAsRead = (id: string) => {
    setAlerts(prev => prev.map(alert => 
      alert.id === id ? { ...alert, isRead: true } : alert
    ))
  }

  const toggleSelectAlert = (id: string) => {
    setSelectedAlerts(prev => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  const selectAll = () => {
    const visibleAlertIds = filteredAndSortedAlerts.map(a => a.id)
    setSelectedAlerts(new Set(visibleAlertIds))
  }

  const deselectAll = () => {
    setSelectedAlerts(new Set())
  }

  // Apply filters and sorting
  const filteredAndSortedAlerts = alerts
    .filter(alert => {
      // Apply dismiss filter first
      if (showDismissed) {
        // When "Show Dismissed" is ON, only show dismissed alerts
        if (!alert.isDismissed) return false
      } else {
        // When "Show Dismissed" is OFF, only show non-dismissed alerts  
        if (alert.isDismissed) return false
      }
      
      // Then apply other filters
      if (filterBy === 'all') return true
      if (filterBy === 'unread') return !alert.isRead
      return alert.severity === filterBy
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        case 'oldest':
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        case 'severity-high':
          return severityConfig[a.severity].order - severityConfig[b.severity].order
        case 'severity-low':
          return severityConfig[b.severity].order - severityConfig[a.severity].order
        case 'agent':
          return a.agentName.localeCompare(b.agentName)
        default:
          return 0
      }
    })

  useEffect(() => {
    fetchAlerts()
    const interval = setInterval(fetchAlerts, 30000) // Refresh every 30 seconds
    return () => clearInterval(interval)
  }, [user, showDismissed])

  const stats = {
    total: alerts.length,
    high: alerts.filter(a => a.severity === 'high').length,
    medium: alerts.filter(a => a.severity === 'medium').length,
    low: alerts.filter(a => a.severity === 'low').length,
    unread: alerts.filter(a => !a.isRead).length
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border shadow-sm">
        <div className="p-8 text-center">
          <div className="animate-spin h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500">Loading alerts...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm">
      {/* Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-red-600" />
              Alert Center
            </h2>
            <p className="text-gray-600 mt-1">Monitor and manage system alerts</p>
          </div>
          <Button onClick={fetchAlerts} variant="outline" size="sm">
            <Clock className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-gray-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            <div className="text-sm text-gray-600">Total</div>
          </div>
          <div className="bg-red-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-red-600">{stats.high}</div>
            <div className="text-sm text-red-600">High</div>
          </div>
          <div className="bg-yellow-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-yellow-600">{stats.medium}</div>
            <div className="text-sm text-yellow-600">Medium</div>
          </div>
          <div className="bg-blue-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-blue-600">{stats.low}</div>
            <div className="text-sm text-blue-600">Low</div>
          </div>
          <div className="bg-purple-50 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-purple-600">{stats.unread}</div>
            <div className="text-sm text-purple-600">Unread</div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Filter */}
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-500" />
              <select 
                value={filterBy} 
                onChange={(e) => setFilterBy(e.target.value as FilterOption)}
                className="border rounded-lg px-3 py-2 text-sm"
              >
                <option value="all">All Alerts</option>
                <option value="high">High Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="low">Low Priority</option>
                <option value="unread">Unread Only</option>
              </select>
            </div>

            {/* Sort */}
            <div className="flex items-center gap-2">
              <SortDesc className="h-4 w-4 text-gray-500" />
              <select 
                value={sortBy} 
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="border rounded-lg px-3 py-2 text-sm"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="severity-high">High Priority First</option>
                <option value="severity-low">Low Priority First</option>
                <option value="agent">By Agent Name</option>
              </select>
            </div>

            {/* Show Dismissed Toggle */}
            <div className="flex items-center gap-2">
              <Switch 
                checked={showDismissed} 
                onCheckedChange={setShowDismissed}
              />
              <span className="text-sm text-gray-600">Show Dismissed Only</span>
            </div>
          </div>

          {/* Bulk Actions */}
          {selectedAlerts.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">
                {selectedAlerts.size} selected
              </span>
              <Button onClick={dismissSelected} variant="destructive" size="sm">
                <X className="h-4 w-4 mr-1" />
                Dismiss Selected
              </Button>
              <Button onClick={deselectAll} variant="outline" size="sm">
                Clear Selection
              </Button>
            </div>
          )}
        </div>

        {/* Select All */}
        {filteredAndSortedAlerts.length > 0 && (
          <div className="flex items-center gap-2 mt-4">
            <Button onClick={selectAll} variant="outline" size="sm">
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Select All ({filteredAndSortedAlerts.length})
            </Button>
          </div>
        )}
      </div>

      {/* Debug Panel - Temporary for troubleshooting */}
      {showDebugPanel && debugData && (
        <div className="mx-6 mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-yellow-800">🔧 Debug Information</h3>
            <Button 
              onClick={() => setShowDebugPanel(false)} 
              variant="ghost" 
              size="sm"
            >
              Hide Debug
            </Button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="space-y-2">
              <div className="text-sm">
                <strong>Total Logs:</strong> {debugData.totalLogs}
              </div>
              <div className="text-sm">
                <strong>Alert Agents:</strong> {debugData.alertAgents}
              </div>
              <div className="text-sm">
                <strong>Dismissed Logs:</strong> {debugData.dismissedLogs}
              </div>
              <div className="text-sm">
                <strong>Valid Alerts:</strong> {debugData.validAlerts}
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="text-sm">
                <strong>Show Dismissed:</strong> {showDismissed ? 'Yes' : 'No'}
              </div>
              <div className="text-sm">
                <strong>Final Alert Count:</strong> {alerts.length}
              </div>
            </div>
          </div>

          {debugData.skippedReasons.length > 0 && (
            <div className="mb-4">
              <strong className="text-sm">Skipped Reasons:</strong>
              <ul className="text-xs mt-1 space-y-1">
                {debugData.skippedReasons.slice(0, 5).map((reason, idx) => (
                  <li key={idx} className="text-red-600">• {reason}</li>
                ))}
              </ul>
            </div>
          )}

          <details className="text-xs">
            <summary className="cursor-pointer font-medium mb-2">Raw Log Data (First 3)</summary>
            <pre className="bg-white p-2 rounded overflow-auto max-h-60 text-xs">
              {JSON.stringify(debugData.rawLogs, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mx-6 mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-600" />
            <p className="text-red-700 font-medium">Error: {error}</p>
          </div>
        </div>
      )}

      {/* Alerts List */}
      <div className="divide-y divide-gray-200">
        {filteredAndSortedAlerts.length === 0 ? (
          <div className="p-12 text-center">
            <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No alerts found</h3>
            <p className="text-gray-600">
              {filterBy === 'all' 
                ? "You're all caught up! No alerts to review."
                : `No ${filterBy} alerts at the moment.`}
            </p>
          </div>
        ) : (
          <AnimatePresence>
            {filteredAndSortedAlerts.map((alert) => {
              const config = severityConfig[alert.severity]
              const IconComponent = config.icon
              const isSelected = selectedAlerts.has(alert.id)
              
              return (
                <motion.div
                  key={alert.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.2 }}
                  className={`p-6 hover:bg-gray-50 transition-colors ${
                    isSelected ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                  } ${!alert.isRead ? 'bg-gradient-to-r from-blue-50/30 to-transparent' : ''}`}
                >
                  <div className="flex items-start gap-4">
                    {/* Selection Checkbox */}
                    <div className="flex items-center pt-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectAlert(alert.id)}
                        className="h-4 w-4 text-blue-600 rounded border-gray-300"
                      />
                    </div>

                    {/* Severity Icon */}
                    <div className={`flex-shrink-0 p-2 rounded-full ${config.bg} ${config.border} border`}>
                      <IconComponent className={`h-5 w-5 ${config.color}`} />
                    </div>

                    {/* Alert Content */}
                    <div className="flex-grow min-w-0">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <h3 
                            className={`text-lg font-semibold text-gray-900 cursor-pointer hover:text-blue-600 ${
                              !alert.isRead ? 'font-bold' : ''
                            }`}
                            onClick={() => markAsRead(alert.id)}
                          >
                            {alert.title}
                          </h3>
                          <span className={`px-2 py-1 text-xs font-medium rounded-full ${config.badge}`}>
                            {alert.severity.toUpperCase()}
                          </span>
                          {!alert.isRead && (
                            <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
                          )}
                        </div>
                      </div>

                      <p className="text-gray-700 mb-3 leading-relaxed">{alert.message}</p>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4 text-sm text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            {new Date(alert.timestamp).toLocaleString()}
                          </span>
                          <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium">
                            {alert.agentName}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {!alert.isRead && (
                            <Button
                              onClick={() => markAsRead(alert.id)}
                              variant="ghost"
                              size="sm"
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              Mark Read
                            </Button>
                          )}
                          {!alert.isDismissed ? (
                            <Button
                              onClick={() => dismissAlert(alert.id)}
                              variant="ghost"
                              size="sm"
                              className="text-gray-600 hover:text-red-600"
                            >
                              <X className="h-4 w-4 mr-1" />
                              Dismiss
                            </Button>
                          ) : (
                            <span className="text-xs text-gray-500 italic">
                              Dismissed
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}