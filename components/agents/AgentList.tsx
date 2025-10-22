'use client'

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '@/lib/supabaseClient'
import { 
  Bot, Plus, Search, Filter, Play, Pause, Edit, AlertCircle, CheckCircle, Clock,
  FileText, Zap, Calendar, Settings, ArrowUpDown, Sparkles, Rocket, Star, Heart,
  Grid3X3, List, ChevronDown, ChevronUp, TrendingUp, Activity, MoreHorizontal,
  Eye, Copy, Archive, Trash2, ExternalLink, Square, Loader2, StopCircle, Timer,
  PlayCircle, Cpu, BarChart3, Shield, Workflow, History, Globe, X, Info
} from 'lucide-react'
import { formatScheduleDisplay } from '@/lib/utils/scheduleFormatter'

// Add animation styles
const styles = `
  @keyframes slide-in-right {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  .animate-slide-in-right {
    animation: slide-in-right 0.3s ease-out;
  }
`;

// Inject styles
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement("style");
  styleSheet.innerText = styles;
  document.head.appendChild(styleSheet);
}

type Agent = {
  id: string
  agent_name: string
  description?: string
  status: string
  deactivation_reason?: string
  created_at?: string
  mode?: string
  schedule_cron?: string
  timezone?: string
  next_run?: string
}

type FilterType = 'all' | 'active' | 'inactive' | 'draft'
type ViewType = 'grid' | 'list'
type SortType = 'created_desc' | 'created_asc' | 'name_asc' | 'name_desc'

interface ExecutionHistoryItem {
  id: string;
  status: 'completed' | 'failed' | 'running' | 'pending' | 'queued';
  started_at: string;
  completed_at?: string;
  execution_duration_ms?: number;
  error_message?: string;
  progress?: number;
  retry_count?: number;
  execution_type?: 'manual' | 'scheduled';
  scheduled_at?: string;
}

interface AgentExecutionStatus {
  isRunning: boolean;
  latestExecution?: ExecutionHistoryItem;
  runningExecutions: ExecutionHistoryItem[];
}

// Ultra-Modern Modal with Dynamic Sizing
const Modal = ({ isOpen, onClose, children }: { isOpen: boolean; onClose: () => void; children: React.ReactNode }) => {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  if (!mounted || !isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-black/20 backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 max-w-lg w-full mx-auto max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>,
    document.body
  )
}

// Enhanced next run formatting with timezone support
const formatNextRun = (nextRunString: string, timezone?: string) => {
  if (!nextRunString) return null;
  
  try {
    const nextRun = new Date(nextRunString);
    const now = new Date();
    const diffInMs = nextRun.getTime() - now.getTime();
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    // Format time in user's timezone or UTC
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    const timeString = timeFormatter.format(nextRun);

    // Relative time formatting
    if (diffInMinutes < 0) {
      // Calculate how long overdue
      const overdueMins = Math.abs(diffInMinutes);
      const overdueHours = Math.abs(diffInHours);
      const overdueDays = Math.abs(diffInDays);

      let overdueText = 'Overdue';
      if (overdueMins < 60) {
        overdueText = `${overdueMins}m overdue`;
      } else if (overdueHours < 24) {
        overdueText = `${overdueHours}h overdue`;
      } else if (overdueDays < 7) {
        overdueText = `${overdueDays}d overdue`;
      } else {
        overdueText = 'Long overdue';
      }

      return { text: overdueText, time: null, isOverdue: true };
    } else if (diffInMinutes < 5) {
      return { text: 'In < 5min', time: timeString, isImmediate: true };
    } else if (diffInMinutes < 60) {
      return { text: `In ${diffInMinutes}min`, time: timeString, isImmediate: true };
    } else if (diffInHours < 24) {
      return { text: `In ${diffInHours}h`, time: timeString, isToday: true };
    } else if (diffInDays === 1) {
      return { text: 'Tomorrow', time: timeString, isTomorrow: true };
    } else if (diffInDays < 7) {
      return { text: `In ${diffInDays}d`, time: timeString, isThisWeek: true };
    } else {
      const dateFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone || 'UTC',
        month: 'short',
        day: 'numeric'
      });
      return { text: dateFormatter.format(nextRun), time: timeString, isFuture: true };
    }
  } catch (error) {
    console.error('Error formatting next run:', error);
    return null;
  }
};

// Next Run Badge Component
const NextRunBadge = ({ agent }: { agent: Agent }) => {
  if (agent.mode !== 'scheduled') {
    return null;
  }

  if (!agent.next_run) {
    return null;
  }

  const nextRunInfo = formatNextRun(agent.next_run, agent.timezone);
  
  if (!nextRunInfo) {
    return null;
  }

  const getStyleConfig = () => {
    if (nextRunInfo.isOverdue) {
      return {
        bg: 'bg-red-50',
        text: 'text-red-700',
        border: 'border-red-200',
        icon: 'text-red-600'
      };
    } else if (nextRunInfo.isImmediate) {
      return {
        bg: 'bg-orange-50',
        text: 'text-orange-700',
        border: 'border-orange-200',
        icon: 'text-orange-600'
      };
    } else if (nextRunInfo.isToday || nextRunInfo.isTomorrow) {
      return {
        bg: 'bg-blue-50',
        text: 'text-blue-700',
        border: 'border-blue-200',
        icon: 'text-blue-600'
      };
    } else {
      return {
        bg: 'bg-gray-50',
        text: 'text-gray-700',
        border: 'border-gray-200',
        icon: 'text-gray-600'
      };
    }
  };

  const styleConfig = getStyleConfig();

  return (
    <div 
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${styleConfig.bg} ${styleConfig.text} border ${styleConfig.border}`}
      style={{ minWidth: '80px' }}
    >
      <Timer className={`w-3 h-3 ${styleConfig.icon} flex-shrink-0`} />
      <span className="whitespace-nowrap">{nextRunInfo.text}</span>
      {nextRunInfo.time && (
        <span className="opacity-75 whitespace-nowrap">at {nextRunInfo.time}</span>
      )}
    </div>
  );
};

// Toast Notification Component
const Toast = ({ 
  message, 
  type = 'success', 
  onClose 
}: { 
  message: string; 
  type?: 'success' | 'error' | 'warning' | 'info'; 
  onClose: () => void;
}) => {
  const config = {
    success: {
      icon: CheckCircle,
      bg: 'bg-emerald-100',
      border: 'border-emerald-300',
      text: 'text-emerald-900',
      iconColor: 'text-emerald-600'
    },
    error: {
      icon: AlertCircle,
      bg: 'bg-red-100',
      border: 'border-red-300',
      text: 'text-red-900',
      iconColor: 'text-red-600'
    },
    warning: {
      icon: AlertCircle,
      bg: 'bg-amber-100',
      border: 'border-amber-300',
      text: 'text-amber-900',
      iconColor: 'text-amber-600'
    },
    info: {
      icon: Clock,
      bg: 'bg-blue-100',
      border: 'border-blue-300',
      text: 'text-blue-900',
      iconColor: 'text-blue-600'
    }
  }[type];

  const Icon = config.icon;

  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border-2 ${config.border} ${config.bg} shadow-xl animate-slide-in-right`}>
      <Icon className={`w-6 h-6 ${config.iconColor} flex-shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${config.text} whitespace-pre-line leading-relaxed`}>{message}</p>
      </div>
      <button
        onClick={(e) => {
          e.preventDefault();
          onClose();
        }}
        className={`${config.text} hover:opacity-70 transition-opacity flex-shrink-0 p-1`}
        aria-label="Close notification"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

// Toast Container Component
const ToastContainer = ({ 
  toasts, 
  removeToast 
}: { 
  toasts: Array<{ id: string; message: string; type: 'success' | 'error' | 'warning' | 'info' }>; 
  removeToast: (id: string) => void;
}) => {
  if (toasts.length === 0) return null;
  
  return (
    <div className="space-y-3 mb-4">
      {toasts.map((toast) => (
        <div key={toast.id}>
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => removeToast(toast.id)}
          />
        </div>
      ))}
    </div>
  );
};

// Agent Execution History Component
const AgentExecutionHistory = ({ agent }: { agent: Agent }) => {
  const [history, setHistory] = useState<ExecutionHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = async () => {
    if (!expanded || loading) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/run-agent?agent_id=${agent.id}&limit=5`);
      const data = await response.json();
      
      if (data.success && data.executions) {
        setHistory(data.executions);
      } else {
        setHistory([]);
        if (data.error) {
          setError(data.error);
        }
      }
    } catch (err) {
      setError('Network error');
      console.error('Error fetching execution history:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (expanded) {
      fetchHistory();
    }
  }, [expanded, agent.id]);

  const formatDuration = (ms: number) => {
    if (!ms) return 'N/A';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m`;
  };

  const formatTimeAgo = (dateString: string | null | undefined) => {
    if (!dateString) return 'N/A';

    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Invalid date';

    const diffInSeconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    if (diffInSeconds < 0) return 'scheduled';
    if (diffInSeconds < 60) return 'now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getUserFriendlyError = (errorMessage: string) => {
    if (!errorMessage) return { message: 'Something went wrong', action: null, icon: AlertCircle, color: 'red' };

    const lowerError = errorMessage.toLowerCase();

    if (lowerError.includes('invalid destination url') || lowerError.includes('destination url')) {
      return { message: 'Setup incomplete', action: 'Your agent needs configuration. Please check Settings.', icon: Settings, color: 'orange' };
    }
    if (lowerError.includes('authenticate') || lowerError.includes('auth') || lowerError.includes('token')) {
      return { message: 'Connection issue', action: 'Please reconnect your integrations in Settings → Integrations.', icon: Shield, color: 'red' };
    }
    if (lowerError.includes('rate limit') || lowerError.includes('429')) {
      return { message: 'Rate limit reached', action: 'Too many requests. We\'ll retry automatically.', icon: Clock, color: 'amber' };
    }
    if (lowerError.includes('timeout') || lowerError.includes('timed out')) {
      return { message: 'Took too long', action: 'Try breaking this into smaller steps.', icon: Timer, color: 'orange' };
    }
    if (lowerError.includes('not found') || lowerError.includes('404')) {
      return { message: 'Resource not found', action: 'Check if the item still exists and you have access.', icon: Search, color: 'gray' };
    }
    if (lowerError.includes('permission') || lowerError.includes('forbidden') || lowerError.includes('403')) {
      return { message: 'Permission denied', action: 'You may need to grant additional permissions.', icon: Shield, color: 'red' };
    }
    if (lowerError.includes('network') || lowerError.includes('connection')) {
      return { message: 'Connection problem', action: 'Check your internet connection and try again.', icon: Globe, color: 'blue' };
    }

    return { message: 'Execution failed', action: 'Please try running the agent again.', icon: AlertCircle, color: 'red' };
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'completed':
        return { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Done' };
      case 'failed':
        return { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', label: 'Failed' };
      case 'running':
        return { icon: Loader2, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Running', pulse: true };
      case 'queued':
        return { icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Queued' };
      default:
        return { icon: Clock, color: 'text-gray-600', bg: 'bg-gray-50', label: 'Pending' };
    }
  };

  const getSuccessRate = () => {
    if (history.length === 0) return 0;
    const successCount = history.filter(h => h.status === 'completed').length;
    return Math.round((successCount / history.length) * 100);
  };

  return (
    <div className="border-t border-gray-100 pt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left hover:bg-gray-50 p-1.5 rounded transition-all duration-200 group"
      >
        <div className="flex items-center gap-2">
          <div className="p-1 bg-purple-50 rounded group-hover:bg-purple-100 transition-colors">
            <History className="w-3 h-3 text-purple-600" />
          </div>
          <div>
            <span className="text-xs font-medium text-gray-800">Recent Activity</span>
            {history.length > 0 && !loading && (
              <div className="text-xs text-emerald-600 font-medium">
                {getSuccessRate()}% success
              </div>
            )}
          </div>
        </div>
        
        <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {loading && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded text-xs">
              <AlertCircle className="w-3 h-3 text-red-600" />
              <span className="text-red-600">{error}</span>
            </div>
          )}

          {!loading && !error && history.length === 0 && (
            <div className="text-center py-3">
              <History className="w-4 h-4 text-gray-400 mx-auto mb-1" />
              <div className="text-xs text-gray-500">No runs yet</div>
            </div>
          )}

          {!loading && !error && history.length > 0 && (
            <>
              <div className="grid grid-cols-3 gap-2 p-2 bg-gray-50 rounded text-center">
                <div>
                  <div className="text-sm font-semibold text-gray-900">{history.length}</div>
                  <div className="text-xs text-gray-600">Runs</div>
                </div>
                <div>
                  <div className="text-sm font-semibold text-emerald-600">{getSuccessRate()}%</div>
                  <div className="text-xs text-gray-600">Success</div>
                </div>
                <div>
                  <div className="text-sm font-semibold text-blue-600">
                    {formatDuration(
                      history
                        .filter(h => h.execution_duration_ms)
                        .reduce((sum, h) => sum + (h.execution_duration_ms || 0), 0) / 
                      (history.filter(h => h.execution_duration_ms).length || 1)
                    )}
                  </div>
                  <div className="text-xs text-gray-600">Avg</div>
                </div>
              </div>

              <div className="space-y-1">
                {history.map((execution) => {
                  const statusConfig = getStatusConfig(execution.status);
                  const StatusIcon = statusConfig.icon;
                  const hasRetries = execution.retry_count && execution.retry_count > 0;
                  const isRetrying = execution.status === 'running' && hasRetries;

                  return (
                    <div key={execution.id} className="flex flex-col gap-1 p-1.5 bg-white border border-gray-200 rounded text-xs hover:border-gray-300 transition-colors">
                      <div className="flex items-center gap-2">
                        <div className={`p-1 rounded ${statusConfig.bg}`}>
                          <StatusIcon className={`w-2.5 h-2.5 ${statusConfig.color} ${statusConfig.pulse ? 'animate-spin' : ''}`} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`font-medium ${statusConfig.color}`}>{statusConfig.label}</span>

                            {/* Retry Badge */}
                            {isRetrying && (
                              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs font-medium border border-orange-200">
                                <div className="w-1 h-1 bg-orange-500 rounded-full animate-pulse" />
                                Retry {execution.retry_count}/3
                              </span>
                            )}

                            {/* Type Badge */}
                            {execution.execution_type && (
                              <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium ${
                                execution.execution_type === 'scheduled'
                                  ? 'bg-blue-100 text-blue-700 border border-blue-200'
                                  : 'bg-purple-100 text-purple-700 border border-purple-200'
                              }`}>
                                {execution.execution_type === 'scheduled' ? (
                                  <>
                                    <Calendar className="w-2.5 h-2.5" />
                                    Auto
                                  </>
                                ) : (
                                  <>
                                    <Play className="w-2.5 h-2.5" />
                                    Manual
                                  </>
                                )}
                              </span>
                            )}

                            {execution.status === 'running' && execution.progress && (
                              <span className="text-blue-600 font-medium">{execution.progress}%</span>
                            )}
                          </div>

                          <div className="text-gray-500 truncate text-xs mt-0.5">
                            {formatTimeAgo(execution.started_at)}
                            {execution.execution_duration_ms && ` • ${formatDuration(execution.execution_duration_ms)}`}
                          </div>
                        </div>

                        {execution.status === 'running' && execution.progress && (
                          <div className="w-6 h-1 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all"
                              style={{ width: `${execution.progress}%` }}
                            />
                          </div>
                        )}
                      </div>

                      {/* Failed Execution Details */}
                      {execution.status === 'failed' && (() => {
                        const friendlyError = getUserFriendlyError(execution.error_message || '');
                        const ErrorIcon = friendlyError.icon;

                        const getColorClasses = (color: string) => {
                          const colors = {
                            red: { bg: 'bg-red-50', border: 'border-red-200', iconBg: 'bg-red-100', iconColor: 'text-red-600', titleColor: 'text-red-900', textColor: 'text-red-700', dotFilled: 'bg-red-500', dotEmpty: 'bg-red-200' },
                            orange: { bg: 'bg-orange-50', border: 'border-orange-200', iconBg: 'bg-orange-100', iconColor: 'text-orange-600', titleColor: 'text-orange-900', textColor: 'text-orange-700', dotFilled: 'bg-orange-500', dotEmpty: 'bg-orange-200' },
                            amber: { bg: 'bg-amber-50', border: 'border-amber-200', iconBg: 'bg-amber-100', iconColor: 'text-amber-600', titleColor: 'text-amber-900', textColor: 'text-amber-700', dotFilled: 'bg-amber-500', dotEmpty: 'bg-amber-200' },
                            gray: { bg: 'bg-gray-50', border: 'border-gray-200', iconBg: 'bg-gray-100', iconColor: 'text-gray-600', titleColor: 'text-gray-900', textColor: 'text-gray-700', dotFilled: 'bg-gray-500', dotEmpty: 'bg-gray-200' },
                            blue: { bg: 'bg-blue-50', border: 'border-blue-200', iconBg: 'bg-blue-100', iconColor: 'text-blue-600', titleColor: 'text-blue-900', textColor: 'text-blue-700', dotFilled: 'bg-blue-500', dotEmpty: 'bg-blue-200' }
                          };
                          return colors[color as keyof typeof colors] || colors.red;
                        };

                        const colorClasses = getColorClasses(friendlyError.color);

                        return (
                          <div className={`ml-7 p-2 ${colorClasses.bg} border ${colorClasses.border} rounded-lg`}>
                            <div className="flex items-start gap-2">
                              <div className={`flex-shrink-0 p-1.5 ${colorClasses.iconBg} rounded-lg`}>
                                <ErrorIcon className={`w-3.5 h-3.5 ${colorClasses.iconColor}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`${colorClasses.titleColor} text-xs font-semibold leading-tight`}>
                                  {friendlyError.message}
                                </p>
                                {friendlyError.action && (
                                  <p className={`${colorClasses.textColor} text-xs mt-1 leading-snug`}>
                                    {friendlyError.action}
                                  </p>
                                )}
                                {hasRetries && (
                                  <div className="flex items-center gap-2 mt-2">
                                    <div className="flex gap-1">
                                      {[1, 2, 3].map((attempt) => (
                                        <div
                                          key={attempt}
                                          className={`w-2 h-2 rounded-full transition-all ${
                                            attempt <= (execution.retry_count || 0)
                                              ? colorClasses.dotFilled
                                              : colorClasses.dotEmpty
                                          }`}
                                        />
                                      ))}
                                    </div>
                                    <span className={`text-xs ${colorClasses.textColor} font-medium`}>
                                      {execution.retry_count || 0}/3 attempts
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// Hook to poll agent execution status
const useAgentExecutionStatus = (agentId: string, agentStatus: string, forceRefresh?: number) => {
  const [executionStatus, setExecutionStatus] = useState<AgentExecutionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasRunningExecution, setHasRunningExecution] = useState(false);

  useEffect(() => {
    let intervalId: NodeJS.Timeout;

    const fetchStatus = async () => {
      try {
        const response = await fetch(`/api/run-agent?agent_id=${agentId}&status_only=true`);
        const data = await response.json();

        if (data.success) {
          const runningExecutions = data.executions?.filter(
            (ex: ExecutionHistoryItem) => ex.status === 'running' || ex.status === 'queued'
          ) || [];
          
          const isRunning = runningExecutions.length > 0;
          setHasRunningExecution(isRunning);
          
          setExecutionStatus({
            isRunning: isRunning,
            latestExecution: data.executions?.[0],
            runningExecutions: runningExecutions
          });
        }
      } catch (error) {
        console.error('Error fetching execution status:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();

    if (agentStatus === 'active' || hasRunningExecution) {
      intervalId = setInterval(fetchStatus, 10000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [agentId, agentStatus, hasRunningExecution, forceRefresh]);

  return { executionStatus, loading };
};

// Execution Status Badge Component
const ExecutionStatusBadge = ({ agent, forceRefresh }: { agent: Agent; forceRefresh?: number }) => {
  const { executionStatus, loading } = useAgentExecutionStatus(agent.id, agent.status, forceRefresh);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs bg-gray-50 text-gray-500 border border-gray-200">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>...</span>
      </div>
    );
  }

  if (!executionStatus?.latestExecution) return null;

  const { latestExecution, isRunning, runningExecutions } = executionStatus;
  const currentProgress = runningExecutions[0]?.progress || 0;

  if (isRunning) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200 font-medium">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Running {currentProgress > 0 ? `${currentProgress}%` : ''}</span>
      </div>
    );
  }

  const statusConfig = {
    completed: { 
      icon: CheckCircle, 
      text: 'Completed', 
      bg: 'bg-emerald-50', 
      text_color: 'text-emerald-700',
      border: 'border-emerald-200'
    },
    failed: { 
      icon: AlertCircle, 
      text: 'Failed', 
      bg: 'bg-red-50', 
      text_color: 'text-red-700',
      border: 'border-red-200'
    },
    queued: { 
      icon: Clock, 
      text: 'Queued', 
      bg: 'bg-amber-50', 
      text_color: 'text-amber-700',
      border: 'border-amber-200'
    },
    pending: { 
      icon: Clock, 
      text: 'Pending', 
      bg: 'bg-gray-50', 
      text_color: 'text-gray-700',
      border: 'border-gray-200'
    }
  }[latestExecution.status] || {
    icon: Clock, 
    text: 'Pending', 
    bg: 'bg-gray-50', 
    text_color: 'text-gray-700',
    border: 'border-gray-200'
  };

  const StatusIcon = statusConfig.icon;

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${statusConfig.bg} ${statusConfig.text_color} border ${statusConfig.border} font-medium`}>
      <StatusIcon className="w-3 h-3" />
      <span>{statusConfig.text}</span>
    </div>
  );
};

export default function AgentList() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<FilterType>('all')
  const [sortBy, setSortBy] = useState<SortType>('created_desc')
  const [viewType, setViewType] = useState<ViewType>('grid')
  const [executingAgents, setExecutingAgents] = useState<Set<string>>(new Set())
  const [pausingAgents, setPausingAgents] = useState<Set<string>>(new Set())
  const [showPauseConfirm, setShowPauseConfirm] = useState<string | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState<Record<string, number>>({})
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'success' | 'error' | 'warning' | 'info' }>>([])

  // Fixed addToast function without dependency on toasts.length
  const addToast = useCallback((message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    
    setToasts(prev => {
      // Prevent adding duplicate messages that are already visible
      const isDuplicate = prev.some(toast => 
        toast.message === message && toast.type === type
      );
      
      if (isDuplicate) {
        return prev;
      }
      
      // Keep maximum 3 toasts visible at once
      const newToasts = [...prev, { id, message, type }];
      if (newToasts.length > 3) {
        newToasts.shift(); // Remove oldest toast
      }
      
      return newToasts;
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const statusFilters = [
    { value: 'all', label: 'All', count: agents.length },
    { value: 'active', label: 'Active', count: agents.filter(a => a.status === 'active').length },
    { value: 'draft', label: 'Draft', count: agents.filter(a => a.status === 'draft').length },
    { value: 'inactive', label: 'Paused', count: agents.filter(a => a.status === 'inactive').length }
  ];

  const sortOptions = [
    { value: 'created_desc', label: 'Newest first', icon: TrendingUp },
    { value: 'created_asc', label: 'Oldest first', icon: TrendingUp },
    { value: 'name_asc', label: 'A to Z', icon: ArrowUpDown },
    { value: 'name_desc', label: 'Z to A', icon: ArrowUpDown }
  ];

  const handleExecuteAgent = async (agentId: string) => {
    if (executingAgents.has(agentId)) {
      return;
    }

    setExecutingAgents(prev => new Set(prev).add(agentId));

    try {
      const response = await fetch('/api/run-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: agentId,
          input_variables: {},
          use_queue: true,
          use_agentkit: true, // Enable OpenAI AgentKit execution
          execution_type: 'manual'
        }),
      });

      if (response.status === 409) {
        const errorData = await response.json();
        
        addToast(
          'Agent Already Running\n\nThis agent is currently executing. Please wait for it to complete.',
          'warning'
        );
        
        setExecutingAgents(prev => {
          const newSet = new Set(prev);
          newSet.delete(agentId);
          return newSet;
        });
        
        return { success: false, error: 'Agent already running' };
      }

      if (!response.ok) {
        const errorText = await response.text();
        
        let errorMessage = 'Failed to start agent';
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error || errorJson.message || errorMessage;
        } catch {
          errorMessage = errorText || errorMessage;
        }
        
        addToast(`Failed to Start Agent\n\n${errorMessage}`, 'error');
        
        setExecutingAgents(prev => {
          const newSet = new Set(prev);
          newSet.delete(agentId);
          return newSet;
        });
        
        return { success: false, error: errorMessage };
      }

      const result = await response.json();

      if (result.success) {
        addToast(
          'Agent Started Successfully!\n\nYour agent has been queued and will start processing shortly.',
          'success'
        );
        
        setRefreshTrigger(prev => ({
          ...prev,
          [agentId]: Date.now()
        }));
        
        setTimeout(() => {
          setExecutingAgents(prev => {
            const newSet = new Set(prev);
            newSet.delete(agentId);
            return newSet;
          });
        }, 2000);
        
        return { 
          success: true, 
          data: result,
          execution_id: result.execution_id,
          job_id: result.job_id
        };
      } else {
        addToast(`Failed to Start Agent\n\n${result.error}`, 'error');
        
        setExecutingAgents(prev => {
          const newSet = new Set(prev);
          newSet.delete(agentId);
          return newSet;
        });
        
        return { success: false, error: result.error };
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Unknown error occurred';
      
      addToast(`Error\n\n${errorMessage}`, 'error');
      
      setExecutingAgents(prev => {
        const newSet = new Set(prev);
        newSet.delete(agentId);
        return newSet;
      });
      
      return { success: false, error: errorMessage };
    }
  };

  const handlePauseAgent = async (agentId: string, agentName: string) => {
    if (pausingAgents.has(agentId)) return;
    
    setPausingAgents(prev => new Set(prev).add(agentId));
    
    try {
      const { error } = await supabase
        .from('agents')
        .update({ status: 'inactive' })
        .eq('id', agentId);
      
      if (error) {
        console.error('Error pausing agent:', error);
        addToast(`Failed to pause ${agentName}`, 'error');
      } else {
        // Update local state immediately for better UX
        setAgents(prev => prev.map(agent => 
          agent.id === agentId 
            ? { ...agent, status: 'inactive' }
            : agent
        ));
        addToast(`${agentName} has been paused`, 'success');
      }
    } catch (error) {
      console.error('Error pausing agent:', error);
      addToast(`Failed to pause ${agentName}`, 'error');
    } finally {
      setPausingAgents(prev => {
        const newSet = new Set(prev);
        newSet.delete(agentId);
        return newSet;
      });
      setShowPauseConfirm(null);
    }
  };

  const handleActivateAgent = async (agentId: string, agentName: string) => {
    try {
      const { error } = await supabase
        .from('agents')
        .update({ status: 'active' })
        .eq('id', agentId);
      
      if (error) {
        console.error('Error activating agent:', error);
        addToast(`Failed to activate ${agentName}`, 'error');
      } else {
        // Update local state immediately for better UX
        setAgents(prev => prev.map(agent => 
          agent.id === agentId 
            ? { ...agent, status: 'active' }
            : agent
        ));
        addToast(`${agentName} is now active`, 'success');
      }
    } catch (error) {
      console.error('Error activating agent:', error);
      addToast(`Failed to activate ${agentName}`, 'error');
    }
  };

  useEffect(() => {
    async function fetchAgents() {
      const { data, error } = await supabase
        .from('agents')
        .select('id, agent_name, description, status, deactivation_reason, created_at, mode, schedule_cron, timezone, next_run')
        .eq('is_archived', false)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching agents:', error)
      } else {
        setAgents(data || [])
      }
      setLoading(false)
    }
    fetchAgents()
  }, [])

  const sortAgents = (agents: Agent[], sortType: SortType) => {
    return [...agents].sort((a, b) => {
      switch (sortType) {
        case 'created_desc':
          return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        case 'created_asc':
          return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
        case 'name_asc':
          return a.agent_name.localeCompare(b.agent_name)
        case 'name_desc':
          return b.agent_name.localeCompare(a.agent_name)
        default:
          return 0
      }
    })
  }

  const filteredAndSortedAgents = sortAgents(
    agents.filter(agent => {
      const matchesSearch = agent.agent_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           agent.description?.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesFilter = statusFilter === 'all' || agent.status === statusFilter
      return matchesSearch && matchesFilter
    }),
    sortBy
  )

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'active':
        return { 
          icon: CheckCircle, 
          color: 'text-emerald-600', 
          bg: 'bg-emerald-50',
          border: 'border-emerald-200',
          dot: 'bg-emerald-500',
          label: 'Active',
          glow: 'shadow-emerald-500/10'
        }
      case 'inactive':
        return { 
          icon: Pause, 
          color: 'text-slate-600', 
          bg: 'bg-slate-50',
          border: 'border-slate-200',
          dot: 'bg-slate-400',
          label: 'Paused',
          glow: 'shadow-slate-500/10'
        }
      case 'draft':
        return { 
          icon: FileText, 
          color: 'text-amber-600', 
          bg: 'bg-amber-50',
          border: 'border-amber-200',
          dot: 'bg-amber-500',
          label: 'Draft',
          glow: 'shadow-amber-500/10'
        }
      default:
        return { 
          icon: Clock, 
          color: 'text-gray-600', 
          bg: 'bg-gray-50',
          border: 'border-gray-200',
          dot: 'bg-gray-400',
          label: status,
          glow: 'shadow-gray-500/10'
        }
    }
  }

  const formatTimeAgo = (dateString: string) => {
    const now = new Date()
    const date = new Date(dateString)
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)
    
    if (diffInSeconds < 60) return 'Just now'
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`
    return new Intl.DateTimeFormat('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    }).format(date)
  }

  // Enhanced AgentActionButtons with pause functionality
  const AgentActionButtons = ({ agent }: { agent: Agent }) => {
    const isCurrentlyExecuting = executingAgents.has(agent.id);
    const isPausing = pausingAgents.has(agent.id);
    const { executionStatus } = useAgentExecutionStatus(agent.id, agent.status);
    
    const isRunningFromAPI = executionStatus?.isRunning || false;
    const isDisabled = isCurrentlyExecuting || isRunningFromAPI || isPausing;
    
    return (
      <div className="flex gap-1.5">
        {agent.status === 'active' && (
          <>
            <button
              onClick={() => handleExecuteAgent(agent.id)}
              disabled={isDisabled}
              className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                isDisabled
                  ? 'bg-gray-400 text-white cursor-not-allowed opacity-60'
                  : 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700 text-white shadow-md hover:shadow-lg hover:scale-105 active:scale-95'
              }`}
            >
              {isRunningFromAPI ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Run
                </>
              ) : isCurrentlyExecuting ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Wait
                </>
              ) : (
                <>
                  <PlayCircle className="h-3 w-3 group-hover:scale-110 transition-transform" />
                  Run
                </>
              )}
            </button>
            
            <button
              onClick={() => setShowPauseConfirm(agent.id)}
              disabled={isPausing}
              className={`group flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                isPausing
                  ? 'bg-gray-400 text-white cursor-not-allowed opacity-60'
                  : 'bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white shadow-md hover:shadow-lg hover:scale-105 active:scale-95'
              }`}
            >
              {isPausing ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Pause
                </>
              ) : (
                <>
                  <Pause className="h-3 w-3 group-hover:scale-110 transition-transform" />
                  Pause
                </>
              )}
            </button>
          </>
        )}
        
        {(agent.status === 'inactive' || agent.status === 'draft') && (
          <button
            onClick={() => handleActivateAgent(agent.id, agent.agent_name)}
            className="group flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-green-500 to-emerald-500 text-white text-xs font-semibold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
          >
            <Play className="h-3 w-3 group-hover:scale-110 transition-transform" />
            Activate
          </button>
        )}
        
        <Link
          href={`/agents/${agent.id}`}
          className="group flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-600 hover:to-slate-700 text-white text-xs font-semibold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
        >
          <Settings className="h-3 w-3 group-hover:rotate-90 transition-transform duration-300" />
          Manage
        </Link>
      </div>
    );
  };

  const ModernAgentCard = ({ agent }: { agent: Agent }) => {
    const statusConfig = getStatusConfig(agent.status)
    const { executionStatus } = useAgentExecutionStatus(agent.id, agent.status);
    const isRunning = executionStatus?.isRunning || false;
    const StatusIcon = statusConfig.icon

    // Helper to get next run info
    const getNextRunInfo = () => {
      if (!agent.next_run) return null;
      return formatNextRun(agent.next_run, agent.timezone);
    };

    const nextRunInfo = getNextRunInfo();

    return (
      <div className="group relative">
        {isRunning && (
          <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-400 via-blue-400 to-purple-400 rounded-lg blur opacity-25 group-hover:opacity-40 transition duration-1000 animate-pulse" />
        )}
        
        <div className="relative bg-white/95 backdrop-blur-sm rounded-lg border border-gray-200/80 hover:border-purple-300/60 transition-all duration-300 overflow-hidden hover:shadow-lg hover:-translate-y-1">
          
          <div className="h-0.5 bg-gradient-to-r from-violet-500 via-purple-500 to-blue-500 opacity-60 group-hover:opacity-100 transition-opacity duration-300" />

          <div className="relative p-4">
            {/* Header */}
            <div className="flex items-start gap-3 mb-3">
              <div className="relative flex-shrink-0">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm transition-all duration-300 group-hover:scale-105 ${
                  isRunning 
                    ? 'bg-gradient-to-br from-emerald-500 via-blue-500 to-purple-500 animate-pulse' 
                    : 'bg-gradient-to-br from-violet-600 via-purple-600 to-blue-600'
                }`}>
                  <Bot className="h-5 w-5 text-white" />
                </div>
                {!isRunning && (
                  <div className={`absolute -bottom-1 -right-1 w-3 h-3 ${statusConfig.dot} rounded-full border-2 border-white shadow-sm`} />
                )}
              </div>
              
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-gray-900 mb-1.5 group-hover:text-purple-700 transition-colors truncate">
                  {agent.agent_name}
                </h3>
                
                {/* Status line */}
                <div className="flex items-center gap-2 flex-wrap">
                  {isRunning ? (
                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200 font-medium">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Running</span>
                    </div>
                  ) : (
                    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${statusConfig.bg} ${statusConfig.color}`}>
                      <StatusIcon className="w-3 h-3" />
                      {statusConfig.label}
                    </div>
                  )}

                  {agent.mode === 'scheduled' && nextRunInfo && (
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Timer className="w-3 h-3" />
                      <span>{nextRunInfo.text}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Description */}
            {agent.description && agent.description.length < 80 && (
              <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                {agent.description}
              </p>
            )}

            {/* Schedule info */}
            {agent.mode === 'scheduled' && agent.schedule_cron && (
              <div className="mb-3">
                <div className="flex items-center gap-2 p-2 bg-blue-50/50 rounded-lg">
                  <Calendar className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <span className="text-sm text-blue-700 font-medium">
                    {formatScheduleDisplay(agent.mode, agent.schedule_cron)}
                  </span>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="mb-3">
              <AgentActionButtons agent={agent} />
            </div>

            {/* Compact Execution History */}
            <AgentExecutionHistory agent={agent} />
          </div>
        </div>
      </div>
    )
  }

  const ModernAgentRow = ({ agent }: { agent: Agent }) => {
    const statusConfig = getStatusConfig(agent.status)

    return (
      <div className="group bg-white rounded-xl border border-gray-200 hover:border-gray-300 shadow-sm hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="relative">
                <div className="w-12 h-12 bg-gradient-to-br from-violet-500 via-purple-500 to-blue-500 rounded-xl flex items-center justify-center shadow-lg">
                  <Bot className="h-6 w-6 text-white" />
                </div>
                <div className={`absolute -bottom-1 -right-1 w-4 h-4 ${statusConfig.dot} rounded-full border-2 border-white shadow-lg`} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1 flex-wrap">
                  <h3 className="font-bold text-gray-900 truncate text-lg group-hover:text-purple-600 transition-colors">
                    {agent.agent_name}
                  </h3>
                  <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${statusConfig.bg} ${statusConfig.color} ${statusConfig.border} border`}>
                    <div className={`w-1.5 h-1.5 ${statusConfig.dot} rounded-full`} />
                    {statusConfig.label}
                  </div>
                  <ExecutionStatusBadge agent={agent} forceRefresh={refreshTrigger[agent.id]} />
                </div>
                <p className="text-sm text-gray-600 truncate mb-1">
                  {agent.description || 'An intelligent assistant ready to automate workflows'}
                </p>
                <div className="flex items-center gap-3 flex-wrap">
                  {agent.mode === 'scheduled' && agent.schedule_cron && (
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3 h-3 text-blue-600" />
                      <p className="text-xs text-blue-600 font-medium">
                        {formatScheduleDisplay(agent.mode, agent.schedule_cron)}
                      </p>
                    </div>
                  )}
                  <NextRunBadge agent={agent} />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right hidden lg:block">
                <p className="text-xs text-gray-500 font-medium">Created</p>
                <p className="text-sm text-gray-700 font-semibold">
                  {agent.created_at ? formatTimeAgo(agent.created_at) : 'Recently'}
                </p>
              </div>

              <AgentActionButtons agent={agent} />
            </div>
          </div>

          {agent.status === 'inactive' && agent.deactivation_reason && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-red-700 leading-snug">{agent.deactivation_reason}</p>
              </div>
            </div>
          )}
        </div>

        {/* Execution History Section */}
        <AgentExecutionHistory agent={agent} />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50/30 to-blue-50">
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="w-20 h-20 bg-gradient-to-br from-violet-600 via-purple-600 to-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl">
              <Bot className="h-10 w-10 text-white animate-pulse" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3">Loading your agents</h3>
            <p className="text-gray-600 text-lg">Gathering your AI assistants...</p>
            <div className="mt-4 flex items-center justify-center gap-1">
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" />
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce delay-100" />
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce delay-200" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-purple-50/30 to-blue-50">
      <div className="max-w-7xl mx-auto p-4 space-y-4">
        {/* Compact Controls */}
        <div className="bg-white/80 backdrop-blur-sm rounded-xl border border-white/50 p-4 shadow-lg">
          <div className="space-y-4">
            
            <div className="flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-lg">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search agents..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500/40 bg-white/70 backdrop-blur-sm transition-all placeholder-gray-400"
                />
              </div>

              <div className="flex bg-gray-100/80 backdrop-blur-sm rounded-lg p-1">
                <button
                  onClick={() => setViewType('grid')}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-all duration-300 ${
                    viewType === 'grid'
                      ? 'bg-white text-purple-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                  }`}
                >
                  <Grid3X3 className="w-3.5 h-3.5" />
                  Cards
                </button>
                <button
                  onClick={() => setViewType('list')}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-all duration-300 ${
                    viewType === 'list'
                      ? 'bg-white text-purple-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                  }`}
                >
                  <List className="w-3.5 h-3.5" />
                  List
                </button>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
              
              <div className="flex items-center bg-gray-100/80 backdrop-blur-sm rounded-lg p-1 gap-1">
                {statusFilters.map((filter) => (
                  <button
                    key={filter.value}
                    onClick={() => setStatusFilter(filter.value as FilterType)}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-all duration-300 flex items-center gap-1.5 ${
                      statusFilter === filter.value
                        ? 'bg-white text-purple-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                    }`}
                  >
                    <span>{filter.label}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                      statusFilter === filter.value
                        ? 'bg-purple-100 text-purple-600'
                        : 'bg-gray-200 text-gray-600'
                    }`}>
                      {filter.count}
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex items-center bg-gray-100/80 backdrop-blur-sm rounded-lg p-1 gap-1">
                {sortOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setSortBy(option.value as SortType)}
                    className={`px-3 py-2 rounded-md text-sm font-medium transition-all duration-300 flex items-center gap-1.5 ${
                      sortBy === option.value
                        ? 'bg-white text-purple-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-white/50'
                    }`}
                  >
                    <option.icon className="w-3.5 h-3.5" />
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3">
          {[
            { 
              label: 'Total', 
              value: agents.length, 
              icon: Bot, 
              gradient: 'from-violet-500 via-purple-500 to-indigo-600',
              bg: 'from-violet-50 to-purple-50'
            },
            { 
              label: 'Active', 
              value: agents.filter(a => a.status === 'active').length, 
              icon: CheckCircle, 
              gradient: 'from-emerald-500 via-green-500 to-teal-600',
              bg: 'from-emerald-50 to-green-50'
            },
            { 
              label: 'Draft', 
              value: agents.filter(a => a.status === 'draft').length, 
              icon: FileText, 
              gradient: 'from-amber-500 via-orange-500 to-red-600',
              bg: 'from-amber-50 to-orange-50'
            },
            { 
              label: 'Paused', 
              value: agents.filter(a => a.status === 'inactive').length, 
              icon: Pause, 
              gradient: 'from-slate-500 via-gray-500 to-zinc-600',
              bg: 'from-slate-50 to-gray-50'
            }
          ].map((stat, index) => (
            <div key={index} className={`group bg-gradient-to-br ${stat.bg} rounded-lg border border-white/50 hover:shadow-lg transition-all duration-300 p-3 hover:-translate-y-0.5`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 bg-gradient-to-br ${stat.gradient} rounded-lg flex items-center justify-center shadow-md group-hover:scale-105 transition-transform`}>
                  <stat.icon className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-0.5">{stat.label}</p>
                  <p className="text-xl font-bold text-gray-900">{stat.value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="text-center">
          <p className="text-sm text-gray-600 bg-white/70 backdrop-blur-sm rounded-lg px-4 py-2 inline-block border border-white/50 shadow-sm">
            <span className="font-semibold text-purple-600">{filteredAndSortedAgents.length}</span> of <span className="font-semibold">{agents.length}</span> agents
          </p>
        </div>

        {/* Toast Container */}
        <ToastContainer toasts={toasts} removeToast={removeToast} />

        {filteredAndSortedAgents.length === 0 ? (
          <div className="text-center py-12 bg-white/80 backdrop-blur-sm rounded-xl border border-white/50 shadow-lg">
            <div className="w-16 h-16 bg-gradient-to-br from-gray-400 via-gray-500 to-slate-600 rounded-xl flex items-center justify-center mx-auto mb-4 opacity-60 shadow-lg">
              <Bot className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              {searchQuery || statusFilter !== 'all' ? 'No agents found' : 'Ready to build?'}
            </h3>
            <p className="text-gray-600 max-w-md mx-auto leading-relaxed">
              {searchQuery || statusFilter !== 'all' 
                ? 'Try adjusting your search terms or filters to find what you\'re looking for.' 
                : 'Create your first AI agent to start automating workflows and boosting productivity.'}
            </p>
          </div>
        ) : (
          <div className={
            viewType === 'grid' 
              ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
              : 'space-y-3'
          }>
            {filteredAndSortedAgents.map((agent) => (
              viewType === 'grid' ? 
                <ModernAgentCard key={agent.id} agent={agent} /> : 
                <ModernAgentRow key={agent.id} agent={agent} />
            ))}
          </div>
        )}
      </div>

      {/* Pause Confirmation Modal */}
      <Modal isOpen={showPauseConfirm !== null} onClose={() => setShowPauseConfirm(null)}>
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-orange-400 to-red-500 rounded-xl flex items-center justify-center">
              <Pause className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900 mb-3 text-lg">
                Pause "{agents.find(a => a.id === showPauseConfirm)?.agent_name}"
              </h3>
              
              <div className="space-y-3 mb-4">
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Pause className="h-4 w-4 text-orange-600" />
                    <span className="font-medium text-orange-800">What happens when paused:</span>
                  </div>
                  <ul className="text-orange-700 text-sm space-y-1">
                    <li>• All automated executions will stop</li>
                    <li>• Scheduled tasks will be disabled</li>
                    <li>• Manual testing will be unavailable</li>
                    <li>• No new execution history will be created</li>
                  </ul>
                </div>
                
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-4 w-4 text-green-600" />
                    <span className="font-medium text-green-800">What stays safe:</span>
                  </div>
                  <ul className="text-green-700 text-sm space-y-1">
                    <li>• All configurations and settings preserved</li>
                    <li>• Execution history and logs remain intact</li>
                    <li>• You can reactivate anytime</li>
                    <li>• No data or setup will be lost</li>
                  </ul>
                </div>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Info className="h-4 w-4 text-blue-600" />
                    <span className="font-medium text-blue-800">Good for:</span>
                  </div>
                  <p className="text-blue-700 text-sm">
                    Temporary breaks, maintenance periods, or when you want to stop automation without losing your setup.
                  </p>
                </div>
              </div>
              
              <div className="flex gap-3">
                <button
                  onClick={() => setShowPauseConfirm(null)}
                  className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors font-medium text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const agent = agents.find(a => a.id === showPauseConfirm);
                    if (agent) {
                      handlePauseAgent(agent.id, agent.agent_name);
                    }
                  }}
                  disabled={pausingAgents.has(showPauseConfirm || '')}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-600 text-white rounded-lg hover:from-orange-600 hover:to-red-700 transition-all duration-200 font-medium text-sm disabled:opacity-50"
                >
                  {pausingAgents.has(showPauseConfirm || '') ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2 inline" />
                      Pausing...
                    </>
                  ) : (
                    'Pause Agent'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}