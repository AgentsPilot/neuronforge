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
  XCircle,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'

type AlertItem = {
  id: string
  timestamp: string
  title: string
  message: string
  severity: 'high' | 'medium' | 'low'
  agentName: string
  isRead?: boolean
  isDismissed?: boolean
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
type PageSizeOption = 10 | 25 | 50 | 100

export default function AlertFeed() {
  const { user } = useAuth()
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [sortBy, setSortBy] = useState<SortOption>('newest')
  const [filterBy, setFilterBy] = useState<FilterOption>('all')
  const [selectedAlerts, setSelectedAlerts] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showDismissed, setShowDismissed] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSizeOption>(10)

  const normalizeSeverity = (val?: string): 'low' | 'medium' | 'high' => {
    const v = val?.toLowerCase()
    if (['high', 'critical', 'error'].includes(v || '')) return 'high'
    if (['medium', 'warn', 'warning'].includes(v || '')) return 'medium'
    return 'low'
  }

  const fetchAlerts = async () => {
    if (!user) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      let query = supabase
        .from('agent_logs')
        .select(`
          id, 
          created_at, 
          full_output,
          dismissed,
          is_read,
          agents!inner(
            agent_name,
            output_schema
          )
        `)
        .eq('user_id', user.id)
        .eq('dismissed', showDismissed)
        .order('created_at', { ascending: false })
        .limit(100)

      const { data, error } = await query

      if (error) {
        setError(`Failed to fetch alerts: ${error.message}`)
        setLoading(false)
        return
      }

      if (!data || data.length === 0) {
        setAlerts([])
        setLoading(false)
        return
      }

      const alertLogs = data.filter(log => {
        const outputSchema = log.agents?.output_schema
        return outputSchema && (
          outputSchema.type === 'Alert' ||
          (Array.isArray(outputSchema) && outputSchema.some((schema: any) => schema.type === 'Alert'))
        )
      })

      const parsedAlerts = alertLogs.map(log => {
        const agentName = log.agents?.agent_name || 'Unknown Agent'
        
        let alertData = null
        if (log.full_output && typeof log.full_output === 'object') {
          const possibleLocations = [
            log.full_output.parsed_output,
            log.full_output.result,
            log.full_output.output,
            log.full_output.alert,
            log.full_output
          ]

          for (const location of possibleLocations) {
            if (location && location.title && location.message) {
              alertData = location
              break
            }
          }

          if (!alertData && log.full_output.message) {
            alertData = {
              title: 'Alert Notification',
              message: log.full_output.message,
              severity: 'medium'
            }
          }
        }

        if (!alertData || !alertData.title || !alertData.message) {
          return null
        }

        const severity = normalizeSeverity(alertData.severity)
        
        return {
          id: log.id,
          timestamp: log.created_at,
          title: alertData.title,
          message: alertData.message,
          severity,
          agentName,
          isRead: !!log.is_read,
          isDismissed: !!log.dismissed
        }
      }).filter(Boolean) as AlertItem[]

      setAlerts(parsedAlerts)
      
    } catch (err: any) {
      setError(`Unexpected error: ${err?.message || String(err)}`)
    }

    setLoading(false)
  }

  const dismissAlert = async (id: string) => {
    try {
      const { error } = await supabase
        .from('agent_logs')
        .update({ dismissed: true })
        .eq('id', id)
      
      if (error) {
        console.error('Error dismissing alert:', error)
        return
      }
      
      setAlerts(prev => prev.filter(a => a.id !== id))
      setSelectedAlerts(prev => {
        const newSet = new Set(prev)
        newSet.delete(id)
        return newSet
      })
    } catch (err) {
      console.error('Error dismissing alert:', err)
    }
  }

  const dismissSelected = async () => {
    if (selectedAlerts.size === 0) return
    
    const ids = Array.from(selectedAlerts)
    
    try {
      await Promise.all(ids.map(id => 
        supabase.from('agent_logs').update({ dismissed: true }).eq('id', id)
      ))
      
      setAlerts(prev => prev.filter(a => !selectedAlerts.has(a.id)))
      setSelectedAlerts(new Set())
    } catch (err) {
      console.error('Error dismissing selected alerts:', err)
    }
  }

  const markSelectedAsRead = async () => {
    if (selectedAlerts.size === 0) return
    
    const ids = Array.from(selectedAlerts)
    
    setAlerts(prev => prev.map(alert => 
      selectedAlerts.has(alert.id) ? { ...alert, isRead: true } : alert
    ))

    try {
      await Promise.all(ids.map(id => 
        supabase.from('agent_logs').update({ is_read: true }).eq('id', id)
      ))
      
      setSelectedAlerts(new Set())
    } catch (err: any) {
      setAlerts(prev => prev.map(alert => 
        selectedAlerts.has(alert.id) ? { ...alert, isRead: false } : alert
      ))
      setError(`Failed to mark alerts as read: ${err.message}`)
    }
  }

  const markSelectedAsUnread = async () => {
    if (selectedAlerts.size === 0) return
    
    const ids = Array.from(selectedAlerts)
    
    setAlerts(prev => prev.map(alert => 
      selectedAlerts.has(alert.id) ? { ...alert, isRead: false } : alert
    ))

    try {
      await Promise.all(ids.map(id => 
        supabase.from('agent_logs').update({ is_read: false }).eq('id', id)
      ))
      
      setSelectedAlerts(new Set())
    } catch (err: any) {
      setAlerts(prev => prev.map(alert => 
        selectedAlerts.has(alert.id) ? { ...alert, isRead: true } : alert
      ))
      setError(`Failed to mark alerts as unread: ${err.message}`)
    }
  }

  const toggleReadStatus = async (id: string, currentIsRead: boolean) => {
    const newReadStatus = !currentIsRead
    
    setAlerts(prev => prev.map(alert => 
      alert.id === id ? { ...alert, isRead: newReadStatus } : alert
    ))

    try {
      const { error } = await supabase
        .from('agent_logs')
        .update({ is_read: newReadStatus })
        .eq('id', id)
      
      if (error) {
        setAlerts(prev => prev.map(alert => 
          alert.id === id ? { ...alert, isRead: currentIsRead } : alert
        ))
        setError(`Failed to update read status: ${error.message}`)
      }
    } catch (err: any) {
      setAlerts(prev => prev.map(alert => 
        alert.id === id ? { ...alert, isRead: currentIsRead } : alert
      ))
      setError(`Failed to update read status: ${err.message}`)
    }
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
    const visibleAlertIds = paginatedAlerts.map(a => a.id)
    setSelectedAlerts(new Set(visibleAlertIds))
  }

  const deselectAll = () => {
    setSelectedAlerts(new Set())
  }

  const filteredAndSortedAlerts = alerts
    .filter(alert => {
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

  const totalAlerts = filteredAndSortedAlerts.length
  const totalPages = Math.ceil(totalAlerts / pageSize)
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = startIndex + pageSize
  const paginatedAlerts = filteredAndSortedAlerts.slice(startIndex, endIndex)

  useEffect(() => {
    setCurrentPage(1)
  }, [filterBy, sortBy, showDismissed])

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)))
  }

  const handlePageSizeChange = (newPageSize: PageSizeOption) => {
    setPageSize(newPageSize)
    setCurrentPage(1)
  }

  useEffect(() => {
    fetchAlerts()
    const interval = setInterval(fetchAlerts, 30000)
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
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-8 text-center">
          <div className="animate-spin h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500">Loading alerts...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
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
          <div className="flex gap-2">
            <Button onClick={fetchAlerts} variant="outline" size="sm">
              <Clock className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
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
        <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
          <div className="flex flex-wrap items-center gap-4">
            {/* Filter */}
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-500" />
              <select 
                value={filterBy} 
                onChange={(e) => setFilterBy(e.target.value as FilterOption)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="severity-high">High Priority First</option>
                <option value="severity-low">Low Priority First</option>
                <option value="agent">By Agent Name</option>
              </select>
            </div>

            {/* Page Size Selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600 whitespace-nowrap">Show:</span>
              <select 
                value={pageSize} 
                onChange={(e) => handlePageSizeChange(Number(e.target.value) as PageSizeOption)}
                className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value={10}>10 per page</option>
                <option value={25}>25 per page</option>
                <option value={50}>50 per page</option>
                <option value={100}>100 per page</option>
              </select>
            </div>

            {/* Show Dismissed Toggle */}
            <div className="flex items-center gap-2">
              <Switch 
                checked={showDismissed} 
                onCheckedChange={setShowDismissed}
              />
              <span className="text-sm text-gray-600 whitespace-nowrap">Show Dismissed Only</span>
            </div>
          </div>

          {/* Bulk Actions */}
          {selectedAlerts.size > 0 && (
            <div className="w-full lg:w-auto">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-blue-50 px-4 py-3 rounded-lg border border-blue-200">
                <span className="text-sm text-blue-700 font-medium whitespace-nowrap">
                  {selectedAlerts.size} selected
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {(() => {
                    const selectedAlertItems = alerts.filter(alert => selectedAlerts.has(alert.id))
                    const hasUnreadAlerts = selectedAlertItems.some(alert => !alert.isRead)
                    const hasReadAlerts = selectedAlertItems.some(alert => alert.isRead)
                    
                    return (
                      <>
                        {hasUnreadAlerts && (
                          <Button onClick={markSelectedAsRead} variant="outline" size="sm" className="h-8">
                            <Eye className="h-4 w-4 mr-1" />
                            Mark as Read
                          </Button>
                        )}
                        {hasReadAlerts && (
                          <Button onClick={markSelectedAsUnread} variant="outline" size="sm" className="h-8">
                            <EyeOff className="h-4 w-4 mr-1" />
                            Mark as Unread
                          </Button>
                        )}
                      </>
                    )
                  })()}
                  <Button onClick={dismissSelected} variant="destructive" size="sm" className="h-8">
                    <X className="h-4 w-4 mr-1" />
                    Dismiss Selected
                  </Button>
                  <Button onClick={deselectAll} variant="outline" size="sm" className="h-8">
                    Clear Selection
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Select All */}
        {paginatedAlerts.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-4 pt-4 border-t border-gray-200">
            <Button onClick={selectAll} variant="outline" size="sm">
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Select All on Page ({paginatedAlerts.length})
            </Button>
            {filteredAndSortedAlerts.length > paginatedAlerts.length && (
              <span className="text-sm text-gray-500">
                Showing {startIndex + 1}-{Math.min(endIndex, totalAlerts)} of {totalAlerts} alerts
              </span>
            )}
          </div>
        )}
      </div>

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
        {totalAlerts === 0 ? (
          <div className="p-12 text-center">
            <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No alerts found</h3>
            <p className="text-gray-600">
              {showDismissed 
                ? "No dismissed alerts to show."
                : filterBy === 'all' 
                  ? "You're all caught up! No alerts to review."
                  : `No ${filterBy} alerts at the moment.`}
            </p>
          </div>
        ) : (
          <>
            <AnimatePresence>
              {paginatedAlerts.map((alert) => {
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
                    className={`p-6 transition-all duration-300 ${
                      isSelected ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                    } ${
                      !alert.isRead 
                        ? 'bg-gradient-to-r from-blue-50/80 to-blue-25/20 border-l-4 border-l-blue-400 hover:bg-blue-50' 
                        : 'bg-gray-50/50 opacity-70 hover:bg-gray-100 border-l-4 border-l-gray-300'
                    }`}
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
                      <div className={`flex-shrink-0 p-2 rounded-full border ${
                        !alert.isRead 
                          ? `${config.bg} ${config.border}` 
                          : 'bg-gray-100 border-gray-300'
                      }`}>
                        {!alert.isRead ? (
                          <IconComponent className={`h-5 w-5 ${config.color}`} />
                        ) : (
                          <Check className="h-5 w-5 text-green-600" />
                        )}
                      </div>

                      {/* Alert Content */}
                      <div className="flex-grow min-w-0">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <h3 
                              className={`text-lg font-semibold cursor-pointer hover:text-blue-600 transition-colors ${
                                !alert.isRead 
                                  ? 'text-gray-900 font-bold' 
                                  : 'text-gray-500 line-through decoration-2 decoration-green-400'
                              }`}
                              onClick={() => toggleReadStatus(alert.id, alert.isRead)}
                            >
                              {alert.title}
                            </h3>
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                              !alert.isRead ? config.badge : 'bg-gray-200 text-gray-600'
                            }`}>
                              {alert.severity.toUpperCase()}
                            </span>
                            {!alert.isRead ? (
                              <div className="flex items-center gap-1">
                                <span className="w-2 h-2 bg-blue-600 rounded-full flex-shrink-0 animate-pulse"></span>
                                <span className="text-xs font-bold text-blue-600 uppercase tracking-wide">NEW</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 px-2 py-1 bg-green-100 rounded-full">
                                <Check className="h-3 w-3 text-green-600 flex-shrink-0" />
                                <span className="text-xs font-medium text-green-700 uppercase">READ</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <p className={`mb-3 leading-relaxed transition-colors ${
                          !alert.isRead 
                            ? 'text-gray-900 font-medium' 
                            : 'text-gray-500 line-through decoration-1'
                        }`}>{alert.message}</p>

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
                            <Button
                              onClick={() => toggleReadStatus(alert.id, alert.isRead)}
                              variant="ghost"
                              size="sm"
                              className={!alert.isRead ? "text-blue-600 hover:text-blue-800" : "text-orange-600 hover:text-orange-800"}
                            >
                              {!alert.isRead ? (
                                <>
                                  <Eye className="h-4 w-4 mr-1" />
                                  Mark Read
                                </>
                              ) : (
                                <>
                                  <EyeOff className="h-4 w-4 mr-1" />
                                  Mark Unread
                                </>
                              )}
                            </Button>
                            
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

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="p-6 border-t border-gray-200 bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    Showing {startIndex + 1}-{Math.min(endIndex, totalAlerts)} of {totalAlerts} alerts
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage === 1}
                      variant="outline"
                      size="sm"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum
                        if (totalPages <= 5) {
                          pageNum = i + 1
                        } else if (currentPage <= 3) {
                          pageNum = i + 1
                        } else if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i
                        } else {
                          pageNum = currentPage - 2 + i
                        }
                        
                        return (
                          <Button
                            key={pageNum}
                            onClick={() => goToPage(pageNum)}
                            variant={currentPage === pageNum ? "default" : "outline"}
                            size="sm"
                            className="w-8 h-8 p-0"
                          >
                            {pageNum}
                          </Button>
                        )
                      })}
                    </div>
                    
                    <Button
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      variant="outline"
                      size="sm"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}