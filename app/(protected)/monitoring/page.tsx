'use client'

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/components/UserProvider';
import {
  Shield, Clock, Settings, AlertTriangle, CheckCircle,
  Download, RefreshCw, FileText, XCircle,
  Lock, Bell, UserCheck, UserX, Eye, MapPin,
  Activity, Database, Key, User, GitBranch,
  TrendingUp, TrendingDown, BarChart3, PieChart,
  Zap, Target, Award, Brain, ChevronRight, Edit2, Bot, Star
} from 'lucide-react';

interface AuditLogEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  resource_name: string | null;
  changes: any;
  details: any;
  ip_address: string | null;
  user_agent: string | null;
  session_id: string | null;
  severity: 'info' | 'warning' | 'critical';
  compliance_flags: string[];
  created_at: string;
}

type ViewType = 'overview' | 'logs' | 'insights';
type TimeFilter = 'last_24h' | 'last_7d' | 'last_30d' | 'last_90d';

export default function AuditTrailPage() {
  const { user } = useAuth();
  const [allLogs, setAllLogs] = useState<AuditLogEntry[]>([]);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedView, setSelectedView] = useState<ViewType>('overview');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('last_30d');
  const [filterSeverity, setFilterSeverity] = useState<'all' | 'critical' | 'warning' | 'info'>('all');
  const [complianceFilter, setComplianceFilter] = useState<'all' | 'SOC2' | 'GDPR' | 'HIPAA' | 'ISO27001' | 'CCPA'>('all');
  const [searchFilter, setSearchFilter] = useState<string>(''); // New: search filter for drill-down
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const logsPerPage = 10;

  const fetchAuditLogs = async () => {
    if (!user) return;

    try {
      setLoading(true);

      const response = await fetch(`/api/audit/query?limit=1000&offset=0`, {
        headers: {
          'x-user-id': user.id
        }
      });

      const data = await response.json();

      if (data.success) {
        setAllLogs(data.logs || []);
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditLogs();
  }, [user]);

  // Filter logs by time range
  useEffect(() => {
    const now = new Date();
    let cutoffDate = new Date();

    switch (timeFilter) {
      case 'last_24h':
        cutoffDate.setHours(cutoffDate.getHours() - 24);
        break;
      case 'last_7d':
        cutoffDate.setDate(cutoffDate.getDate() - 7);
        break;
      case 'last_30d':
        cutoffDate.setDate(cutoffDate.getDate() - 30);
        break;
      case 'last_90d':
        cutoffDate.setDate(cutoffDate.getDate() - 90);
        break;
    }

    const filtered = allLogs.filter(log => new Date(log.created_at) >= cutoffDate);
    console.log('📊 Audit Trail Filter Debug:', {
      timeFilter,
      cutoffDate: cutoffDate.toISOString(),
      allLogsCount: allLogs.length,
      filteredCount: filtered.length,
      sample: filtered.slice(0, 2).map(l => ({ action: l.action, date: l.created_at }))
    });
    setLogs(filtered);
    setCurrentPage(1);
  }, [timeFilter, allLogs]);

  // Calculate stats - memoized to update when logs change
  const stats = useMemo(() => {
    const calculatedStats = {
      total: logs.length,
      critical: logs.filter(l => l.severity === 'critical').length,
      warning: logs.filter(l => l.severity === 'warning').length,
      info: logs.filter(l => l.severity === 'info').length,
      last24h: logs.filter(l => {
        const logDate = new Date(l.created_at);
        const yesterday = new Date();
        yesterday.setHours(yesterday.getHours() - 24);
        return logDate > yesterday;
      }).length,
      security: logs.filter(l => l.action.includes('SECURITY') || l.action.includes('PASSWORD')).length,
      settings: logs.filter(l => l.action.includes('SETTINGS')).length,
      auth: logs.filter(l => l.action.includes('LOGIN') || l.action.includes('AUTH')).length,
    };
    console.log('📈 Stats recalculated:', calculatedStats);
    return calculatedStats;
  }, [logs]);

  // Daily activity data (last 5 days) - sorted descending (most recent first)
  const dailyActivity = useMemo(() => Array.from({ length: 5 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - i); // Start from today and go backwards
    date.setHours(0, 0, 0, 0);

    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    const dayLogs = logs.filter(l => {
      const logDate = new Date(l.created_at);
      return logDate >= date && logDate < nextDate;
    });

    return {
      date: date.toISOString(),
      count: dayLogs.length,
      critical: dayLogs.filter(l => l.severity === 'critical').length,
      warning: dayLogs.filter(l => l.severity === 'warning').length,
      security: dayLogs.filter(l => l.action.includes('SECURITY')).length,
    };
  }), [logs]);

  // User-friendly stats for overview cards - memoized to update when logs change
  const userStats = useMemo(() => {
    // Agent stats
    const agentsCreated = logs.filter(l => l.action.includes('AGENT_CREATED') || l.action.includes('CREATE_AGENT')).length;
    const agentsRun = logs.filter(l => l.action.includes('AGENT_RUN') || l.action.includes('RUN_AGENT')).length;
    const agentsFailed = logs.filter(l => l.action.includes('AGENT') && (l.action.includes('FAILED') || l.action.includes('ERROR'))).length;
    const agentsSuccessful = logs.filter(l => l.action.includes('AGENT') && l.action.includes('SUCCESS')).length;
    const allAgentActivities = logs.filter(l => l.action.includes('AGENT')).length;

    // Plugin stats
    const pluginsConnected = logs.filter(l => l.action.includes('PLUGIN_CONNECT')).length;
    const pluginsDisconnected = logs.filter(l => l.action.includes('PLUGIN_DISCONNECT')).length;
    const allPluginActivities = logs.filter(l => l.action.includes('PLUGIN') || l.action.includes('INTEGRATION')).length;

    // Account stats
    const settingsUpdated = logs.filter(l => l.action.includes('SETTINGS')).length;
    const logins = logs.filter(l => l.action.includes('LOGIN') && !l.action.includes('FAILED')).length;
    const failedLogins = logs.filter(l => l.action.includes('LOGIN') && l.action.includes('FAILED')).length;
    const profileUpdates = logs.filter(l => l.action.includes('PROFILE')).length;
    const dataExports = logs.filter(l => l.action.includes('EXPORT') || l.action.includes('DOWNLOAD')).length;

    // Compliance stats - count logs with each compliance flag
    const soc2Events = logs.filter(l => l.compliance_flags && l.compliance_flags.includes('SOC2')).length;
    const gdprEvents = logs.filter(l => l.compliance_flags && l.compliance_flags.includes('GDPR')).length;
    const hipaaEvents = logs.filter(l => l.compliance_flags && l.compliance_flags.includes('HIPAA')).length;
    const iso27001Events = logs.filter(l => l.compliance_flags && l.compliance_flags.includes('ISO27001')).length;
    const ccpaEvents = logs.filter(l => l.compliance_flags && l.compliance_flags.includes('CCPA')).length;

    // Calculate success rate for agents
    const totalAgentExecutions = agentsRun + agentsFailed + agentsSuccessful;
    const successRate = totalAgentExecutions > 0
      ? Math.round(((agentsSuccessful + agentsRun - agentsFailed) / totalAgentExecutions) * 100)
      : 100;

    console.log('📊 User Stats Calculated:', {
      agentsCreated,
      allAgentActivities,
      pluginsConnected,
      allPluginActivities,
      logins,
      failedLogins,
      totalActions: logs.length,
      compliance: { soc2Events, gdprEvents, hipaaEvents, iso27001Events, ccpaEvents }
    });

    return {
      totalActions: logs.length,
      agentsCreated,
      agentsRun,
      agentsFailed,
      agentsSuccessful,
      allAgentActivities,
      successRate,
      pluginsConnected,
      allPluginActivities,
      activePlugins: pluginsConnected - pluginsDisconnected,
      settingsUpdated,
      logins,
      failedLogins,
      profileUpdates,
      dataExports,
      soc2Events,
      gdprEvents,
      hipaaEvents,
      iso27001Events,
      ccpaEvents,
      mostActiveDay: dailyActivity.length > 0
        ? dailyActivity.reduce((max, day) => day.count > max.count ? day : max, dailyActivity[0])
        : null,
    };
  }, [logs, dailyActivity]);

  // Category breakdown by action type - memoized to update when logs change
  const categoryBreakdown = useMemo(() => {
    const getCategoryFromAction = (action: string): string => {
      if (action.includes('LOGIN') || action.includes('AUTH') || action.includes('LOGOUT')) return 'Authentication';
      if (action.includes('PASSWORD') || action.includes('SECURITY') || action.includes('2FA')) return 'Security';
      if (action.includes('SETTINGS') || action.includes('PREFERENCES')) return 'Settings';
      if (action.includes('PROFILE') || action.includes('USER')) return 'Profile';
      if (action.includes('NOTIFICATION')) return 'Notifications';
      if (action.includes('PLUGIN') || action.includes('INTEGRATION')) return 'Integrations';
      if (action.includes('AGENT')) return 'Agents';
      if (action.includes('DATA') || action.includes('EXPORT')) return 'Data Management';
      return 'Other';
    };

    const categoryMap = new Map<string, number>();
    logs.forEach(log => {
      const category = getCategoryFromAction(log.action);
      categoryMap.set(category, (categoryMap.get(category) || 0) + 1);
    });

    const breakdown = Array.from(categoryMap.entries())
      .map(([name, count]) => {
        let color = 'bg-gray-500';
        if (name === 'Authentication') color = 'bg-blue-500';
        else if (name === 'Security') color = 'bg-red-500';
        else if (name === 'Settings') color = 'bg-purple-500';
        else if (name === 'Profile') color = 'bg-emerald-500';
        else if (name === 'Notifications') color = 'bg-orange-500';
        else if (name === 'Integrations') color = 'bg-indigo-500';
        else if (name === 'Agents') color = 'bg-pink-500';
        else if (name === 'Data Management') color = 'bg-teal-500';

        return { name, count, color };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 8); // Show top 8 categories

    console.log('🏷️ Category Breakdown recalculated:', breakdown);
    return breakdown;
  }, [logs]);

  // Security insights - memoized to update when logs, stats, or categoryBreakdown change
  const insights = useMemo(() => {
    const failedLogins = logs.filter(l => l.action.includes('LOGIN') && l.action.includes('FAILED')).length;
    const passwordChanges = logs.filter(l => l.action.includes('PASSWORD')).length;
    const recentActivity = logs.filter(l => {
      const logDate = new Date(l.created_at);
      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);
      return logDate > oneHourAgo;
    }).length;

    const topCategory = categoryBreakdown[0];
    const hasMultipleFailedLogins = failedLogins >= 3;
    const hasRecentPasswordChange = passwordChanges > 0;
    const isQuietPeriod = stats.last24h < 5;
    const hasWarnings = stats.warning > 0;

    return [
    stats.critical === 0 && !hasWarnings && {
      title: 'Excellent Security Posture',
      message: 'No critical security events detected in your audit log. All systems operating normally.',
      icon: 'Shield',
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50/50',
      borderColor: 'border-emerald-200/50',
    },
    stats.critical > 0 && {
      title: 'Critical Events Require Attention',
      message: `${stats.critical} critical security event${stats.critical > 1 ? 's' : ''} detected. Immediate review recommended.`,
      icon: 'AlertTriangle',
      color: 'text-red-600',
      bgColor: 'bg-red-50/50',
      borderColor: 'border-red-200/50',
    },
    hasMultipleFailedLogins && {
      title: 'Multiple Failed Login Attempts',
      message: `${failedLogins} failed login attempts detected. Consider reviewing access logs and enabling rate limiting.`,
      icon: 'UserX',
      color: 'text-orange-600',
      bgColor: 'bg-orange-50/50',
      borderColor: 'border-orange-200/50',
    },
    hasRecentPasswordChange && {
      title: 'Password Security Updates',
      message: `${passwordChanges} password change${passwordChanges > 1 ? 's' : ''} recorded. Ensure strong password policies are enforced.`,
      icon: 'Key',
      color: 'text-purple-600',
      bgColor: 'bg-purple-50/50',
      borderColor: 'border-purple-200/50',
    },
    stats.last24h > 15 && {
      title: 'High Activity Detected',
      message: `${stats.last24h} events in the last 24 hours. ${recentActivity > 0 ? `${recentActivity} in the last hour.` : 'Monitor for unusual patterns.'}`,
      icon: 'TrendingUp',
      color: 'text-blue-600',
      bgColor: 'bg-blue-50/50',
      borderColor: 'border-blue-200/50',
    },
    isQuietPeriod && stats.total > 0 && {
      title: 'Low Activity Period',
      message: `Only ${stats.last24h} events in the last 24 hours. System activity is below normal levels.`,
      icon: 'TrendingDown',
      color: 'text-gray-600',
      bgColor: 'bg-gray-50/50',
      borderColor: 'border-gray-200/50',
    },
    topCategory && topCategory.count > stats.total * 0.4 && {
      title: `${topCategory.name} Activity Spike`,
      message: `${topCategory.name} represents ${((topCategory.count / stats.total) * 100).toFixed(0)}% of all events. This is the dominant activity type.`,
      icon: 'BarChart3',
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50/50',
      borderColor: 'border-indigo-200/50',
    },
    stats.auth > stats.total * 0.5 && !hasMultipleFailedLogins && {
      title: 'Authentication Heavy Period',
      message: 'Most activity is authentication-related. Consider enabling 2FA for enhanced security.',
      icon: 'Lock',
      color: 'text-cyan-600',
      bgColor: 'bg-cyan-50/50',
      borderColor: 'border-cyan-200/50',
    },
    stats.security > 5 && {
      title: 'Active Security Management',
      message: `${stats.security} security-related changes detected. Regular security updates are a good practice.`,
      icon: 'Shield',
      color: 'text-teal-600',
      bgColor: 'bg-teal-50/50',
      borderColor: 'border-teal-200/50',
    },
    logs.length === 0 && {
      title: 'No Activity Recorded',
      message: 'No audit events found for the selected time period. This could indicate a quiet period or data collection issues.',
      icon: 'Activity',
      color: 'text-gray-600',
      bgColor: 'bg-gray-50/50',
      borderColor: 'border-gray-200/50',
    },
  ].filter(Boolean);
  }, [logs, stats, categoryBreakdown]);

  // Helper functions
  const getActionIcon = (action: string) => {
    if (action.includes('LOGIN')) return <UserCheck className="w-5 h-5" />;
    if (action.includes('PASSWORD')) return <Lock className="w-5 h-5" />;
    if (action.includes('SETTINGS')) return <Settings className="w-5 h-5" />;
    if (action.includes('SECURITY')) return <Shield className="w-5 h-5" />;
    if (action.includes('NOTIFICATION')) return <Bell className="w-5 h-5" />;
    if (action.includes('FAILED')) return <UserX className="w-5 h-5" />;
    if (action.includes('PROFILE')) return <User className="w-5 h-5" />;
    if (action.includes('PLUGIN')) return <GitBranch className="w-5 h-5" />;
    return <FileText className="w-5 h-5" />;
  };

  const getSeverityConfig = (severity: 'critical' | 'warning' | 'info') => {
    return {
      critical: {
        iconBg: 'from-red-500 to-rose-600',
        badge: 'bg-red-100 text-red-700 border-red-300'
      },
      warning: {
        iconBg: 'from-orange-500 to-amber-600',
        badge: 'bg-orange-100 text-orange-700 border-orange-300'
      },
      info: {
        iconBg: 'from-blue-500 to-indigo-600',
        badge: 'bg-blue-100 text-blue-700 border-blue-300'
      }
    }[severity];
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const formatActionName = (action: string) => {
    return action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
  };

  const exportToCSV = () => {
    const headers = ['Timestamp', 'Action', 'Entity', 'Resource', 'Severity', 'IP Address'];
    const rows = logs.map(log => [
      new Date(log.created_at).toLocaleString(),
      log.action,
      log.entity_type,
      log.resource_name || '',
      log.severity,
      log.ip_address || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-trail-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  // Filter logs by severity, compliance, and search term
  let filteredLogs = logs;

  // Apply search filter (drill-down from overview cards)
  // Support OR logic with pipe separator (e.g., "LOGIN|PASSWORD|SECURITY")
  if (searchFilter && searchFilter !== 'ALL') {
    if (searchFilter.includes('|')) {
      // Multiple search terms - match if action contains ANY of them
      const searchTerms = searchFilter.split('|').map(t => t.trim().toUpperCase());
      filteredLogs = filteredLogs.filter(l =>
        searchTerms.some(term => l.action.toUpperCase().includes(term))
      );
    } else {
      // Single search term
      filteredLogs = filteredLogs.filter(l =>
        l.action.toUpperCase().includes(searchFilter.toUpperCase())
      );
    }
  }

  // Apply severity filter
  if (filterSeverity !== 'all') {
    filteredLogs = filteredLogs.filter(l => l.severity === filterSeverity);
  }

  // Apply compliance filter
  if (complianceFilter !== 'all') {
    filteredLogs = filteredLogs.filter(l =>
      l.compliance_flags && l.compliance_flags.includes(complianceFilter)
    );
  }

  const totalPages = Math.ceil(filteredLogs.length / logsPerPage);
  const startIndex = (currentPage - 1) * logsPerPage;
  const endIndex = startIndex + logsPerPage;
  const paginatedLogs = filteredLogs.slice(startIndex, endIndex);

  const views = [
    { id: 'overview' as ViewType, label: 'Overview', icon: PieChart },
    { id: 'logs' as ViewType, label: 'Event Log', icon: FileText },
    { id: 'insights' as ViewType, label: 'Insights', icon: Brain },
  ];

  // Helper function to drill down into Event Log with search filter
  const drillDownToLogs = (searchTerm: string) => {
    setSelectedView('logs');
    setFilterSeverity('all');
    setComplianceFilter('all');
    setSearchFilter(searchTerm);
    setCurrentPage(1);
    // Scroll to top to see the filtered results
    window.scrollTo({ top: 0, behavior: 'smooth' });
    console.log(`✅ Drilling down to Event Log with filter: ${searchTerm}`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-3 mb-6">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 rounded-3xl shadow-xl mb-4">
          <Shield className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 via-blue-800 to-indigo-800 bg-clip-text text-transparent">
          Security Audit Trail
        </h1>
        <p className="text-gray-600 font-medium">Complete compliance and security monitoring</p>
      </div>

      {/* Controls - Sticky */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md rounded-2xl border border-gray-200/50 shadow-lg p-6">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Time Filter Buttons - Analytics Style */}
            <div className="flex bg-white/90 backdrop-blur-sm border border-gray-200/60 rounded-xl p-1 shadow-sm">
              {[
                { value: 'last_24h' as TimeFilter, label: '24h' },
                { value: 'last_7d' as TimeFilter, label: '7d' },
                { value: 'last_30d' as TimeFilter, label: '30d' },
                { value: 'last_90d' as TimeFilter, label: '90d' }
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => setTimeFilter(option.value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    timeFilter === option.value
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/50'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {/* View Navigation - Analytics Style */}
            <div className="flex bg-gray-100/80 rounded-xl p-1">
              {[
                { key: 'overview' as ViewType, label: 'Overview', icon: BarChart3 },
                { key: 'insights' as ViewType, label: 'Insights', icon: Brain },
                { key: 'logs' as ViewType, label: 'Event Log', icon: FileText }
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => {
                    setSelectedView(key);
                    setCurrentPage(1);
                  }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    selectedView === key
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={fetchAuditLogs}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all duration-300 text-sm font-medium shadow-lg"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>

            {logs.length > 0 && (
              <button
                onClick={exportToCSV}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-all duration-300 text-sm font-medium bg-white/80"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Overview View */}
      {selectedView === 'overview' && (
        <div className="space-y-6">
          {/* Most Active Day Card - Full Width at Top */}
          {userStats.mostActiveDay && (
            <div className="bg-gradient-to-br from-cyan-50 to-blue-50 border border-cyan-200/50 rounded-xl p-5 hover:shadow-md transition-all duration-200">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center shadow-md">
                  <TrendingUp className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-bold text-cyan-900 mb-1">Most Active Day</h3>
                  <p className="text-sm text-cyan-700">
                    {new Date(userStats.mostActiveDay.date).toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric'
                    })} with <span className="font-bold">{userStats.mostActiveDay.count} actions</span>
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-cyan-900">{userStats.mostActiveDay.count}</div>
                  <div className="text-xs text-cyan-600">actions</div>
                </div>
              </div>
            </div>
          )}

          {/* ROW 1: OVERVIEW - High-level metrics */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">Activity Overview</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Total Activity Card */}
              <button
                onClick={() => drillDownToLogs('ALL')}
                className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-4 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <Activity className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                      {timeFilter === 'last_24h' ? '24h' : timeFilter === 'last_7d' ? '7d' : timeFilter === 'last_30d' ? '30d' : '90d'}
                    </span>
                    <ChevronRight className="w-4 h-4 text-blue-400" />
                  </div>
                </div>
                <h3 className="text-2xl font-bold text-blue-900 mb-1">{userStats.totalActions}</h3>
                <p className="text-sm text-blue-700 font-medium">Total Actions</p>
              </button>

              {/* Success Rate Card */}
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200/50 rounded-xl p-4 transition-all duration-200">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <CheckCircle className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                    Metric
                  </span>
                </div>
                <h3 className="text-2xl font-bold text-green-900 mb-1">{userStats.successRate}%</h3>
                <p className="text-sm text-green-700 font-medium">Success Rate</p>
              </div>

              {/* Security Health Card */}
              <button
                onClick={() => drillDownToLogs('LOGIN|AUTH|LOGOUT|PASSWORD|SECURITY|2FA')}
                className="bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200/50 rounded-xl p-4 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-yellow-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <Shield className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex items-center gap-2">
                    {userStats.failedLogins > 0 && (
                      <span className="text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                        {userStats.failedLogins} Failed
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-amber-400" />
                  </div>
                </div>
                <h3 className="text-2xl font-bold text-amber-900 mb-1">
                  {(categoryBreakdown.find(c => c.name === 'Authentication')?.count || 0) +
                   (categoryBreakdown.find(c => c.name === 'Security')?.count || 0)}
                </h3>
                <p className="text-sm text-amber-700 font-medium">Security Actions</p>
              </button>

              {/* Login Sessions Card */}
              <button
                onClick={() => drillDownToLogs('LOGIN')}
                className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200/50 rounded-xl p-4 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-amber-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <UserCheck className="w-5 h-5 text-white" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-orange-400" />
                </div>
                <h3 className="text-2xl font-bold text-orange-900 mb-1">{userStats.logins}</h3>
                <p className="text-sm text-orange-700 font-medium">Login Sessions</p>
              </button>
            </div>
          </div>

          {/* ROW 2: AUTOMATION WORK - Agents & Integrations */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">Automation Work</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Agents Created Card */}
              <button
                onClick={() => drillDownToLogs('AGENT_CREATED')}
                className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200/50 rounded-xl p-4 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-purple-400" />
                </div>
                <h3 className="text-2xl font-bold text-purple-900 mb-1">{userStats.agentsCreated}</h3>
                <p className="text-sm text-purple-700 font-medium">Agents Created</p>
              </button>

              {/* Agent Activities Card */}
              <button
                onClick={() => drillDownToLogs('AGENT')}
                className="bg-gradient-to-br from-fuchsia-50 to-pink-50 border border-fuchsia-200/50 rounded-xl p-4 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-fuchsia-500 to-pink-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-fuchsia-400" />
                </div>
                <h3 className="text-2xl font-bold text-fuchsia-900 mb-1">
                  {userStats.allAgentActivities}
                </h3>
                <p className="text-sm text-fuchsia-700 font-medium">Agent Activities</p>
              </button>

              {/* Plugins Connected Card */}
              <button
                onClick={() => drillDownToLogs('PLUGIN_CONNECT')}
                className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200/50 rounded-xl p-4 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <GitBranch className="w-5 h-5 text-white" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-indigo-400" />
                </div>
                <h3 className="text-2xl font-bold text-indigo-900 mb-1">{userStats.pluginsConnected}</h3>
                <p className="text-sm text-indigo-700 font-medium">Plugins Connected</p>
              </button>

              {/* Plugin Activities Card */}
              <button
                onClick={() => drillDownToLogs('PLUGIN')}
                className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200/50 rounded-xl p-4 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <Zap className="w-5 h-5 text-white" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-emerald-400" />
                </div>
                <h3 className="text-2xl font-bold text-emerald-900 mb-1">{userStats.allPluginActivities}</h3>
                <p className="text-sm text-emerald-700 font-medium">Plugin Activities</p>
              </button>

              {/* Data Exports Card */}
              <button
                onClick={() => drillDownToLogs('EXPORT')}
                className="bg-gradient-to-br from-sky-50 to-blue-50 border border-sky-200/50 rounded-xl p-4 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-sky-500 to-blue-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <Download className="w-5 h-5 text-white" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-sky-400" />
                </div>
                <h3 className="text-2xl font-bold text-sky-900 mb-1">{userStats.dataExports}</h3>
                <p className="text-sm text-sky-700 font-medium">Data Exports</p>
              </button>
            </div>
          </div>

          {/* ROW 3: USER ACTIVITY - Settings, Profile & Alerts */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">User Activity</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Failed Logins Card */}
              <button
                onClick={() => drillDownToLogs('FAILED')}
                className="bg-gradient-to-br from-red-50 to-rose-50 border border-red-200/50 rounded-xl p-4 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-rose-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex items-center gap-2">
                    {userStats.failedLogins > 0 && (
                      <span className="text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                        Alert
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-red-400" />
                  </div>
                </div>
                <h3 className="text-2xl font-bold text-red-900 mb-1">{userStats.failedLogins}</h3>
                <p className="text-sm text-red-700 font-medium">Failed Logins</p>
              </button>

              {/* Settings Card */}
              <button
                onClick={() => drillDownToLogs('SETTINGS')}
                className="bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-200/50 rounded-xl p-4 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <Settings className="w-5 h-5 text-white" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-violet-400" />
                </div>
                <h3 className="text-2xl font-bold text-violet-900 mb-1">{userStats.settingsUpdated}</h3>
                <p className="text-sm text-violet-700 font-medium">Settings Changed</p>
              </button>

              {/* Profile Updates Card */}
              <button
                onClick={() => drillDownToLogs('PROFILE')}
                className="bg-gradient-to-br from-rose-50 to-pink-50 border border-rose-200/50 rounded-xl p-4 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-rose-500 to-pink-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <User className="w-5 h-5 text-white" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-rose-400" />
                </div>
                <h3 className="text-2xl font-bold text-rose-900 mb-1">{userStats.profileUpdates}</h3>
                <p className="text-sm text-rose-700 font-medium">Profile Updates</p>
              </button>

              {/* Notifications Card */}
              <button
                onClick={() => drillDownToLogs('NOTIFICATION')}
                className="bg-gradient-to-br from-cyan-50 to-teal-50 border border-cyan-200/50 rounded-xl p-4 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-teal-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <Bell className="w-5 h-5 text-white" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-cyan-400" />
                </div>
                <h3 className="text-2xl font-bold text-cyan-900 mb-1">
                  {categoryBreakdown.find(c => c.name === 'Notifications')?.count || 0}
                </h3>
                <p className="text-sm text-cyan-700 font-medium">Notifications</p>
              </button>
            </div>
          </div>

          {/* ROW 4: COMPLIANCE - Security & Regulatory Standards */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">Compliance & Standards</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* SOC2 Card */}
              <button
                onClick={() => {
                  setSelectedView('logs');
                  setComplianceFilter('SOC2');
                  setFilterSeverity('all');
                  setSearchFilter('');
                  setCurrentPage(1);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-4 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <Shield className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                      SOC2
                    </span>
                    <ChevronRight className="w-4 h-4 text-blue-400" />
                  </div>
                </div>
                <h3 className="text-2xl font-bold text-blue-900 mb-1">{userStats.soc2Events}</h3>
                <p className="text-sm text-blue-700 font-medium">SOC 2 Events</p>
              </button>

              {/* GDPR Card */}
              <button
                onClick={() => {
                  setSelectedView('logs');
                  setComplianceFilter('GDPR');
                  setFilterSeverity('all');
                  setSearchFilter('');
                  setCurrentPage(1);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="bg-gradient-to-br from-purple-50 to-violet-50 border border-purple-200/50 rounded-xl p-4 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-violet-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <Lock className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-full">
                      GDPR
                    </span>
                    <ChevronRight className="w-4 h-4 text-purple-400" />
                  </div>
                </div>
                <h3 className="text-2xl font-bold text-purple-900 mb-1">{userStats.gdprEvents}</h3>
                <p className="text-sm text-purple-700 font-medium">GDPR Events</p>
              </button>

              {/* HIPAA Card */}
              <button
                onClick={() => {
                  setSelectedView('logs');
                  setComplianceFilter('HIPAA');
                  setFilterSeverity('all');
                  setSearchFilter('');
                  setCurrentPage(1);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="bg-gradient-to-br from-teal-50 to-emerald-50 border border-teal-200/50 rounded-xl p-4 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <Shield className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-teal-700 bg-teal-100 px-2 py-0.5 rounded-full">
                      HIPAA
                    </span>
                    <ChevronRight className="w-4 h-4 text-teal-400" />
                  </div>
                </div>
                <h3 className="text-2xl font-bold text-teal-900 mb-1">{userStats.hipaaEvents}</h3>
                <p className="text-sm text-teal-700 font-medium">HIPAA Events</p>
              </button>

              {/* ISO27001 Card */}
              <button
                onClick={() => {
                  setSelectedView('logs');
                  setComplianceFilter('ISO27001');
                  setFilterSeverity('all');
                  setSearchFilter('');
                  setCurrentPage(1);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200/50 rounded-xl p-4 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-amber-500 to-orange-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <Target className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                      ISO27001
                    </span>
                    <ChevronRight className="w-4 h-4 text-amber-400" />
                  </div>
                </div>
                <h3 className="text-2xl font-bold text-amber-900 mb-1">{userStats.iso27001Events}</h3>
                <p className="text-sm text-amber-700 font-medium">ISO 27001 Events</p>
              </button>

              {/* CCPA Card */}
              <button
                onClick={() => {
                  setSelectedView('logs');
                  setComplianceFilter('CCPA');
                  setFilterSeverity('all');
                  setSearchFilter('');
                  setCurrentPage(1);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="bg-gradient-to-br from-pink-50 to-rose-50 border border-pink-200/50 rounded-xl p-4 hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-pointer text-left w-full"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-rose-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                    <User className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-pink-700 bg-pink-100 px-2 py-0.5 rounded-full">
                      CCPA
                    </span>
                    <ChevronRight className="w-4 h-4 text-pink-400" />
                  </div>
                </div>
                <h3 className="text-2xl font-bold text-pink-900 mb-1">{userStats.ccpaEvents}</h3>
                <p className="text-sm text-pink-700 font-medium">CCPA Events</p>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Insights View */}
      {selectedView === 'insights' && (
        <div className="space-y-6">
          {/* Summary Cards Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Weekly Activity */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-md">
                  <TrendingUp className="w-5 h-5 text-white" />
                </div>
                <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                  Last 7 days
                </span>
              </div>
              <h3 className="text-3xl font-bold text-blue-900 mb-1">
                {logs.filter(l => {
                  const logDate = new Date(l.created_at);
                  const sevenDaysAgo = new Date();
                  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
                  return logDate >= sevenDaysAgo;
                }).length}
              </h3>
              <p className="text-sm text-blue-700 font-medium mb-2">Weekly Actions</p>
              <p className="text-xs text-blue-600">Avg: {Math.round(stats.total / 7)} actions/day</p>
            </div>

            {/* Critical Events */}
            <div className="bg-gradient-to-br from-red-50 to-rose-50 border border-red-200/50 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-rose-600 rounded-lg flex items-center justify-center shadow-md">
                  <AlertTriangle className="w-5 h-5 text-white" />
                </div>
                <span className="text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                  {stats.critical > 0 ? 'Alert' : 'Clear'}
                </span>
              </div>
              <h3 className="text-3xl font-bold text-red-900 mb-1">{stats.critical}</h3>
              <p className="text-sm text-red-700 font-medium mb-2">Critical Events</p>
              <p className="text-xs text-red-600">
                {stats.critical === 0 ? 'All systems secure' : 'Requires attention'}
              </p>
            </div>

            {/* Top Category */}
            {categoryBreakdown[0] && (
              <div className="bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200/50 rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg flex items-center justify-center shadow-md">
                    <Target className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                    {((categoryBreakdown[0].count / stats.total) * 100).toFixed(0)}%
                  </span>
                </div>
                <h3 className="text-3xl font-bold text-emerald-900 mb-1">{categoryBreakdown[0].count}</h3>
                <p className="text-sm text-emerald-700 font-medium mb-2">Top Category</p>
                <p className="text-xs text-emerald-600 truncate">{categoryBreakdown[0].name}</p>
              </div>
            )}
          </div>

          {/* Main Grid: Daily Activity & Category Breakdown */}
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Daily Activity Trend */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-b border-blue-200/50 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-md">
                      <TrendingUp className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900">Daily Activity Trend</h3>
                      <p className="text-sm text-blue-700">Last 5 days activity pattern</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Visual Graph */}
              <div className="bg-gradient-to-br from-blue-50/50 to-indigo-50/30 rounded-xl p-5 border-b border-blue-200/30 m-5">
                <h4 className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-4">5-Day Activity Trend</h4>
                <div className="flex items-end justify-between gap-2 h-40">
                  {dailyActivity.slice().reverse().map((day) => {
                    const maxCount = Math.max(...dailyActivity.map(d => d.count));
                    const barHeight = maxCount > 0 ? (day.count / maxCount) * 100 : 0;
                    const isHighest = day.count === maxCount && maxCount > 0;

                    return (
                      <div key={day.date} className="flex-1 flex flex-col items-center gap-2 group">
                        {/* Count tooltip */}
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap mb-1">
                          {day.count} actions
                        </div>

                        {/* Bar */}
                        <div className="w-full flex items-end justify-center" style={{ height: '120px' }}>
                          <div
                            className={`w-full rounded-t-lg transition-all duration-500 ${
                              isHighest
                                ? 'bg-gradient-to-t from-blue-600 to-indigo-600 shadow-lg'
                                : 'bg-gradient-to-t from-blue-400 to-indigo-500'
                            } hover:opacity-80 cursor-pointer relative group-hover:shadow-xl`}
                            style={{ height: `${Math.max(barHeight, 5)}%` }}
                          >
                            {isHighest && (
                              <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 text-blue-600">
                                <Star className="w-4 h-4 fill-current" />
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Day label */}
                        <div className={`text-xs font-medium ${isHighest ? 'text-blue-900' : 'text-gray-600'}`}>
                          {new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Content */}
              <div className="p-6">
                <div className="space-y-3">
                  {dailyActivity.slice(0, 3).map((day, index) => {
                    const maxCount = Math.max(...dailyActivity.map(d => d.count));
                    const countWidth = maxCount > 0 ? (day.count / maxCount) * 100 : 0;
                    const isHighest = day.count === maxCount && maxCount > 0;

                    return (
                      <div key={day.date} className={`group hover:bg-gradient-to-r hover:from-blue-50/50 hover:to-indigo-50/30 rounded-xl p-4 transition-all duration-200 border border-transparent hover:border-blue-200/30 ${
                        isHighest ? 'bg-blue-50/30' : ''
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4 text-blue-600" />
                            <span className="text-sm font-semibold text-gray-800">
                              {new Date(day.date).toLocaleDateString('en-US', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric'
                              })}
                            </span>
                            {isHighest && (
                              <span className="text-xs font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                                Peak
                              </span>
                            )}
                          </div>
                          <div className="text-right">
                            <div className={`font-bold ${isHighest ? 'text-blue-900 text-base' : 'text-gray-900'}`}>
                              {day.count}
                            </div>
                            <div className="text-xs text-gray-500">actions</div>
                          </div>
                        </div>
                        <div className="bg-gray-100 rounded-full h-2.5 overflow-hidden">
                          <div
                            className={`h-2.5 rounded-full transition-all duration-500 ${
                              isHighest
                                ? 'bg-gradient-to-r from-blue-600 to-indigo-600'
                                : 'bg-gradient-to-r from-blue-400 to-purple-500'
                            }`}
                            style={{ width: `${Math.max(countWidth, 2)}%` }}
                          ></div>
                        </div>
                        <div className="flex justify-between text-xs text-gray-600 mt-2">
                          <span className="flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-red-500" />
                            {day.critical} critical
                          </span>
                          <span className="flex items-center gap-1">
                            <Shield className="w-3 h-3 text-amber-500" />
                            {day.security} security
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Category Breakdown */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-br from-emerald-50 to-green-50 border-b border-emerald-200/50 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-green-600 rounded-lg flex items-center justify-center shadow-md">
                      <PieChart className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900">Activity Breakdown</h3>
                      <p className="text-sm text-emerald-700">Events by category</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-6">
                {categoryBreakdown.length === 0 ? (
                  <div className="text-center py-8">
                    <PieChart className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 text-sm">No category data available</p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {/* Category Insight */}
                    <div className="bg-amber-50/50 border border-amber-200/50 rounded-xl p-4">
                      <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider mb-2">Category Insight</h4>
                      <p className="text-sm text-amber-800">
                        Top 3 categories account for <span className="font-bold">
                          {((categoryBreakdown.slice(0, 3).reduce((sum, c) => sum + c.count, 0) / stats.total) * 100).toFixed(0)}%
                        </span> of all events.
                      </p>
                    </div>

                    {/* Category List */}
                    <div className="space-y-3">
                      {categoryBreakdown.slice(0, 6).map((item, index) => (
                        <div key={index} className="group hover:bg-gradient-to-r hover:from-emerald-50/50 hover:to-green-50/30 rounded-xl p-3 transition-all duration-200 border border-transparent hover:border-emerald-200/30">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2">
                                <div className={`w-4 h-4 rounded-lg ${item.color} shadow-sm`}></div>
                                <span className="text-sm font-semibold text-gray-800">{item.name}</span>
                              </div>
                              {index === 0 && (
                                <span className="text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">
                                  Highest
                                </span>
                              )}
                            </div>
                            <div className="text-right">
                              <div className="font-bold text-gray-900">{item.count}</div>
                              <div className="text-xs font-semibold text-emerald-600">
                                {((item.count / stats.total) * 100).toFixed(1)}%
                              </div>
                            </div>
                          </div>
                          <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-2 rounded-full transition-all duration-500 ${item.color} shadow-sm`}
                              style={{ width: `${(item.count / stats.total) * 100}%` }}
                            ></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* AI-Powered Insights */}
          {insights.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold text-gray-900">AI-Powered Insights</h3>
              <div className="grid lg:grid-cols-2 gap-4">
                {insights.map((insight: any, index) => {
                  const IconComponent =
                    insight.icon === 'Shield' ? Shield :
                    insight.icon === 'TrendingUp' ? TrendingUp :
                    insight.icon === 'TrendingDown' ? TrendingDown :
                    insight.icon === 'AlertTriangle' ? AlertTriangle :
                    insight.icon === 'Lock' ? Lock :
                    insight.icon === 'UserX' ? UserX :
                    insight.icon === 'Key' ? Key :
                    insight.icon === 'BarChart3' ? BarChart3 :
                    insight.icon === 'Activity' ? Activity :
                    Shield;

                  return (
                    <div key={index} className={`${insight.bgColor} backdrop-blur-sm rounded-2xl border ${insight.borderColor} shadow-lg p-6 hover:shadow-xl transition-all duration-300`}>
                      <div className="flex items-start gap-3">
                        <div className={`w-10 h-10 ${insight.color.replace('text-', 'bg-').replace('600', '100')} rounded-lg flex items-center justify-center ${insight.color}`}>
                          <IconComponent className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                          <h4 className="font-bold text-gray-900 mb-1">{insight.title}</h4>
                          <p className="text-gray-700 text-sm leading-relaxed">{insight.message}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty State */}
          {insights.length === 0 && (
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-12 text-center">
              <Brain className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-gray-900 mb-2">Generating Insights</h3>
              <p className="text-gray-600">More activity is needed to generate security insights</p>
            </div>
          )}
        </div>
      )}

      {/* Logs View */}
      {selectedView === 'logs' && (
        <div className="space-y-4">
          {/* Filter Bar - Sticky */}
          <div className="sticky top-[88px] z-20 bg-white/95 backdrop-blur-md rounded-2xl border border-gray-200/50 shadow-lg p-6">
            <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
              <div className="flex items-center gap-4 flex-wrap">
                {/* Search Filter Indicator */}
                {searchFilter && searchFilter !== 'ALL' && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                    <span className="text-sm font-medium text-blue-700">
                      Filtering: {searchFilter.includes('|') ? 'Security Actions' : searchFilter}
                    </span>
                    <button
                      onClick={() => setSearchFilter('')}
                      className="text-blue-600 hover:text-blue-800 transition-colors"
                      title="Clear filter"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Severity Filters */}
                <div className="flex bg-gray-100/80 rounded-xl p-1">
                  {[
                    { value: 'all' as const, label: 'All', icon: FileText },
                    { value: 'critical' as const, label: 'Critical', icon: AlertTriangle },
                    { value: 'warning' as const, label: 'Warning', icon: Eye },
                    { value: 'info' as const, label: 'Info', icon: CheckCircle }
                  ].map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.value}
                        onClick={() => {
                          setFilterSeverity(option.value);
                          setCurrentPage(1);
                        }}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                          filterSeverity === option.value
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {option.label}
                        <span className={`text-xs font-bold ${
                          filterSeverity === option.value ? 'text-blue-600' : 'text-gray-500'
                        }`}>
                          {option.value === 'all' ? stats.total : stats[option.value as 'critical' | 'warning' | 'info']}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Compliance Filters */}
                <div className="flex bg-gray-100/80 rounded-xl p-1">
                  {[
                    { value: 'all' as const, label: 'All', icon: Shield },
                    { value: 'SOC2' as const, label: 'SOC2', icon: Award },
                    { value: 'GDPR' as const, label: 'GDPR', icon: Lock },
                    { value: 'HIPAA' as const, label: 'HIPAA', icon: Shield },
                    { value: 'ISO27001' as const, label: 'ISO27001', icon: Target },
                    { value: 'CCPA' as const, label: 'CCPA', icon: User }
                  ].map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.value}
                        onClick={() => {
                          setComplianceFilter(option.value);
                          setCurrentPage(1);
                        }}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                          complianceFilter === option.value
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3">
                <button
                  onClick={exportToCSV}
                  disabled={logs.length === 0}
                  className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-all duration-300 text-sm font-medium bg-white/80 disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
              </div>
            </div>
          </div>

          {/* Logs List */}
          {loading ? (
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-sm p-12 text-center">
              <RefreshCw className="w-8 h-8 text-gray-400 animate-spin mx-auto mb-4" />
              <p className="text-gray-600 font-medium">Loading audit logs...</p>
            </div>
          ) : paginatedLogs.length === 0 ? (
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-sm p-12 text-center">
              <Shield className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600 font-medium">No audit logs found</p>
              <p className="text-sm text-gray-500 mt-2">Events will appear here as they occur</p>
            </div>
          ) : (
            <>
              {/* Enterprise Table Design */}
              <div className="bg-white rounded-2xl border border-gray-200/50 shadow-lg overflow-hidden">
                <table className="w-full">
                  {/* Table Header */}
                  <thead>
                    <tr className="bg-gradient-to-r from-gray-50 to-gray-100/50 border-b border-gray-200">
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                        Time
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                        Event
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                        Resource
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                        Type
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                        Severity
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider">
                        Compliance
                      </th>
                      <th className="px-6 py-4 text-center text-xs font-bold text-gray-600 uppercase tracking-wider">
                        Details
                      </th>
                    </tr>
                  </thead>

                  {/* Table Body */}
                  <tbody className="divide-y divide-gray-100">
                    {paginatedLogs.map((log, index) => {
                      const severityConfig = getSeverityConfig(log.severity);
                      const date = new Date(log.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric'
                      });
                      const time = new Date(log.created_at).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                      });

                      return (
                        <React.Fragment key={log.id}>
                          <tr
                            className={`group hover:bg-gradient-to-r hover:from-blue-50/30 hover:to-purple-50/30 transition-all duration-200 ${
                              index % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'
                            }`}
                          >
                            {/* Time Column */}
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex flex-col">
                                <span className="text-sm font-semibold text-gray-900">{time}</span>
                                <span className="text-xs text-gray-500 mt-0.5">{date}</span>
                              </div>
                            </td>

                            {/* Event Column */}
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${severityConfig.iconBg} flex items-center justify-center shadow-sm`}>
                                  <div className="text-white [&>svg]:w-4 [&>svg]:h-4">
                                    {getActionIcon(log.action)}
                                  </div>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-sm font-semibold text-gray-900">
                                    {formatActionName(log.action)}
                                  </span>
                                  {log.entity_id && (
                                    <span className="text-xs text-gray-500 font-mono mt-0.5">
                                      ID: {log.entity_id.substring(0, 8)}...
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Resource Column */}
                            <td className="px-6 py-4">
                              {log.resource_name ? (
                                <span className="text-sm font-medium text-gray-900">{log.resource_name}</span>
                              ) : (
                                <span className="text-sm text-gray-400 italic">—</span>
                              )}
                            </td>

                            {/* Entity Type Column */}
                            <td className="px-6 py-4 whitespace-nowrap">
                              {log.entity_type && (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                                  {log.entity_type}
                                </span>
                              )}
                            </td>

                            {/* Severity Column */}
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold border ${severityConfig.badge} uppercase`}>
                                {log.severity}
                              </span>
                            </td>

                            {/* Compliance Column */}
                            <td className="px-6 py-4">
                              {log.compliance_flags && log.compliance_flags.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {log.compliance_flags.map((flag) => (
                                    <span
                                      key={flag}
                                      className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-100 text-blue-700 border border-blue-200"
                                    >
                                      {flag}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-sm text-gray-400">—</span>
                              )}
                            </td>

                            {/* Details Column */}
                            <td className="px-6 py-4 text-center">
                              <button
                                onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                                className="group relative w-10 h-10 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 hover:from-blue-500 hover:to-indigo-600 transition-all duration-300 shadow-sm hover:shadow-md"
                                title={expandedLog === log.id ? 'Collapse details' : 'Expand details'}
                              >
                                <div className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
                                  expandedLog === log.id ? 'rotate-180' : 'rotate-0'
                                }`}>
                                  <ChevronRight className="w-5 h-5 text-gray-600 group-hover:text-white transition-colors duration-300 transform rotate-90" />
                                </div>
                              </button>
                            </td>
                          </tr>

                          {/* Expanded Details Row */}
                          {expandedLog === log.id && (
                            <tr className="bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/30">
                              <td colSpan={7} className="px-6 py-6">
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                  {/* Event Details Section */}
                                  {log.details && Object.keys(log.details).length > 0 && (
                                    <div className="lg:col-span-2 bg-gradient-to-br from-white to-gray-50/50 rounded-2xl border border-gray-200/60 shadow-sm overflow-hidden">
                                      <div className="bg-gradient-to-r from-blue-500 to-indigo-600 px-5 py-3 flex items-center gap-2">
                                        <FileText className="w-4 h-4 text-white" />
                                        <h5 className="text-sm font-bold text-white tracking-wide">Event Details</h5>
                                      </div>
                                      <div className="p-5">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                          {Object.entries(log.details)
                                            .filter(([key]) => !key.toLowerCase().includes('token') && !key.toLowerCase().includes('password') && !key.toLowerCase().includes('secret'))
                                            .map(([key, value]) => (
                                              <div key={key} className="group bg-white rounded-xl p-4 border border-gray-200/60 hover:border-blue-300 hover:shadow-md transition-all duration-200">
                                                <div className="flex items-start justify-between gap-2 mb-2">
                                                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                                                    {key.replace(/_/g, ' ')}
                                                  </span>
                                                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                                </div>
                                                <div className="text-sm font-semibold text-gray-900 break-words">
                                                  {typeof value === 'object' && value !== null
                                                    ? JSON.stringify(value)
                                                    : String(value)}
                                                </div>
                                              </div>
                                            ))}
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {/* Changes Section */}
                                  {log.changes && Object.keys(log.changes).length > 0 && (
                                    <div className="bg-gradient-to-br from-white to-amber-50/50 rounded-2xl border border-amber-200/60 shadow-sm overflow-hidden">
                                      <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-3 flex items-center gap-2">
                                        <Edit2 className="w-4 h-4 text-white" />
                                        <h5 className="text-sm font-bold text-white tracking-wide">Changes</h5>
                                      </div>
                                      <div className="p-5 space-y-3">
                                        {Object.entries(log.changes)
                                          .filter(([key]) => !key.toLowerCase().includes('token') && !key.toLowerCase().includes('password') && !key.toLowerCase().includes('secret'))
                                          .map(([field, change]: [string, any]) => {
                                            const oldValue = change.from || change.before || change.old;
                                            const newValue = change.to || change.after || change.new;
                                            return (
                                              <div key={field} className="bg-white rounded-xl p-4 border border-amber-200/60 shadow-sm">
                                                <div className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-3 pb-2 border-b border-gray-200">
                                                  {field.replace(/_/g, ' ')}
                                                </div>
                                                <div className="space-y-2">
                                                  <div className="flex items-center gap-2">
                                                    <div className="w-2 h-2 rounded-full bg-red-500"></div>
                                                    <span className="text-xs font-medium text-gray-500">Previous</span>
                                                  </div>
                                                  <div className="pl-4 text-sm text-red-600 font-medium line-through">
                                                    {oldValue !== undefined ? String(oldValue) : '—'}
                                                  </div>

                                                  <div className="flex items-center gap-2 mt-3">
                                                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                                                    <span className="text-xs font-medium text-gray-500">Current</span>
                                                  </div>
                                                  <div className="pl-4 text-sm text-emerald-700 font-bold">
                                                    {newValue !== undefined ? String(newValue) : '—'}
                                                  </div>
                                                </div>
                                              </div>
                                            );
                                          })}
                                      </div>
                                    </div>
                                  )}

                                  {/* Security Metadata Section - Only show if data exists */}
                                  {(log.ip_address || log.session_id || log.user_agent) && (
                                    <div className="lg:col-span-3 bg-gradient-to-br from-white to-slate-50/50 rounded-2xl border border-slate-200/60 shadow-sm overflow-hidden">
                                      <div className="bg-gradient-to-r from-slate-700 to-slate-900 px-5 py-3 flex items-center gap-2">
                                        <Shield className="w-4 h-4 text-white" />
                                        <h5 className="text-sm font-bold text-white tracking-wide">Security Context</h5>
                                      </div>
                                      <div className="p-5">
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                          {log.ip_address && (
                                            <div className="bg-white rounded-xl p-4 border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all duration-200">
                                              <div className="flex items-center gap-2 mb-2">
                                                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center">
                                                  <MapPin className="w-4 h-4 text-blue-600" />
                                                </div>
                                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">IP Address</span>
                                              </div>
                                              <span className="text-sm font-mono font-semibold text-gray-900">{log.ip_address}</span>
                                            </div>
                                          )}
                                          {log.session_id && (
                                            <div className="bg-white rounded-xl p-4 border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all duration-200">
                                              <div className="flex items-center gap-2 mb-2">
                                                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-100 to-pink-100 flex items-center justify-center">
                                                  <Key className="w-4 h-4 text-purple-600" />
                                                </div>
                                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Session</span>
                                              </div>
                                              <span className="text-sm font-mono font-semibold text-gray-900">{log.session_id.substring(0, 16)}...</span>
                                            </div>
                                          )}
                                          {log.user_agent && (
                                            <div className="bg-white rounded-xl p-4 border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all duration-200 md:col-span-3">
                                              <div className="flex items-center gap-2 mb-2">
                                                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center">
                                                  <Activity className="w-4 h-4 text-emerald-600" />
                                                </div>
                                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">User Agent</span>
                                              </div>
                                              <span className="text-xs font-mono text-gray-700 break-all">{log.user_agent}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-sm p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600 font-medium">
                      Showing {startIndex + 1}-{Math.min(endIndex, filteredLogs.length)} of {filteredLogs.length}
                    </p>
                    <div className="flex gap-2 items-center">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      >
                        Previous
                      </button>

                      <div className="flex gap-1">
                        {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                          let pageNum;
                          if (totalPages <= 5) {
                            pageNum = i + 1;
                          } else if (currentPage <= 3) {
                            pageNum = i + 1;
                          } else if (currentPage >= totalPages - 2) {
                            pageNum = totalPages - 4 + i;
                          } else {
                            pageNum = currentPage - 2 + i;
                          }

                          return (
                            <button
                              key={pageNum}
                              onClick={() => setCurrentPage(pageNum)}
                              className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${
                                currentPage === pageNum
                                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md'
                                  : 'border border-gray-300 hover:bg-gray-50 text-gray-700'
                              }`}
                            >
                              {pageNum}
                            </button>
                          );
                        })}
                      </div>

                      <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
