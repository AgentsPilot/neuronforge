'use client'

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/UserProvider';
import {
  Shield, Clock, User, Settings, AlertTriangle, CheckCircle,
  Filter, Download, RefreshCw, Search, ChevronDown, FileText,
  Lock, Bell, UserCheck, UserX, Eye, Calendar, MapPin
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

export default function AuditTrailPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalLogs, setTotalLogs] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [filterAction, setFilterAction] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const logsPerPage = 20;

  const fetchAuditLogs = async () => {
    if (!user) return;

    try {
      setLoading(true);
      const offset = (currentPage - 1) * logsPerPage;

      const params = new URLSearchParams({
        limit: logsPerPage.toString(),
        offset: offset.toString(),
      });

      if (filterAction) params.append('action', filterAction);
      if (filterSeverity) params.append('severity', filterSeverity);

      const response = await fetch(`/api/audit/query?${params}`, {
        headers: {
          'x-user-id': user.id
        }
      });

      const data = await response.json();

      if (data.success) {
        setLogs(data.logs || []);
        setTotalLogs(data.total || 0);
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditLogs();
  }, [user, currentPage, filterAction, filterSeverity]);

  const getActionIcon = (action: string) => {
    if (action.includes('LOGIN')) return <UserCheck className="w-4 h-4" />;
    if (action.includes('PASSWORD')) return <Lock className="w-4 h-4" />;
    if (action.includes('SETTINGS')) return <Settings className="w-4 h-4" />;
    if (action.includes('SECURITY')) return <Shield className="w-4 h-4" />;
    if (action.includes('NOTIFICATION')) return <Bell className="w-4 h-4" />;
    if (action.includes('FAILED')) return <UserX className="w-4 h-4" />;
    return <FileText className="w-4 h-4" />;
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'from-red-50 to-rose-50 border-red-200';
      case 'warning': return 'from-orange-50 to-amber-50 border-orange-200';
      default: return 'from-blue-50 to-indigo-50 border-blue-200';
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-700 border-red-200';
      case 'warning': return 'bg-orange-100 text-orange-700 border-orange-200';
      default: return 'bg-blue-100 text-blue-700 border-blue-200';
    }
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

  // Convert technical field names to user-friendly labels
  const formatFieldLabel = (field: string): string => {
    const fieldLabels: Record<string, string> = {
      'email_enabled': 'Email Notifications',
      'email_agent_updates': 'Agent Update Emails',
      'email_system_alerts': 'System Alert Emails',
      'email_marketing': 'Marketing Emails',
      'session_timeout_minutes': 'Session Timeout',
      'two_factor_enabled': 'Two-Factor Authentication',
      'full_name': 'Full Name',
      'company_name': 'Company',
      'job_title': 'Job Title',
      'timezone': 'Timezone',
      'phone_number': 'Phone Number',
    };

    return fieldLabels[field] || field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Format field values to be user-friendly
  const formatFieldValue = (value: any): string => {
    if (value === null || value === undefined) return 'Not set';
    if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
    if (typeof value === 'number') {
      // Handle session timeout specially
      if (value >= 60) {
        const hours = Math.floor(value / 60);
        const mins = value % 60;
        return mins > 0 ? `${hours}h ${mins}m` : `${hours} hour${hours > 1 ? 's' : ''}`;
      }
      return `${value} minutes`;
    }
    if (typeof value === 'string') {
      // Don't show empty strings
      if (value.trim() === '') return 'Not set';
      return value;
    }
    return JSON.stringify(value);
  };

  const exportToCSV = () => {
    const headers = ['Timestamp', 'Action', 'Entity', 'Resource', 'Severity', 'IP Address', 'Details'];
    const rows = logs.map(log => [
      new Date(log.created_at).toLocaleString(),
      log.action,
      log.entity_type,
      log.resource_name || '',
      log.severity,
      log.ip_address || '',
      log.details?.changeSummary || ''
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

  const totalPages = Math.ceil(totalLogs / logsPerPage);

  const stats = {
    total: totalLogs,
    critical: logs.filter(l => l.severity === 'critical').length,
    warning: logs.filter(l => l.severity === 'warning').length,
    info: logs.filter(l => l.severity === 'info').length,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 rounded-3xl shadow-xl mb-4">
          <Shield className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 via-blue-800 to-indigo-800 bg-clip-text text-transparent">
          Audit Trail
        </h1>
        <p className="text-gray-600 font-medium">Complete activity log for compliance and security monitoring</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200/50 rounded-xl p-4 hover:shadow-md transition-all">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-md">
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-blue-700 font-medium">Total Events</p>
              <p className="text-2xl font-bold text-blue-900">{stats.total}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-red-50 to-rose-50 border border-red-200/50 rounded-xl p-4 hover:shadow-md transition-all">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-rose-600 rounded-lg flex items-center justify-center shadow-md">
              <AlertTriangle className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-red-700 font-medium">Critical</p>
              <p className="text-2xl font-bold text-red-900">{stats.critical}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200/50 rounded-xl p-4 hover:shadow-md transition-all">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-amber-600 rounded-lg flex items-center justify-center shadow-md">
              <Eye className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-orange-700 font-medium">Warning</p>
              <p className="text-2xl font-bold text-orange-900">{stats.warning}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200/50 rounded-xl p-4 hover:shadow-md transition-all">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center shadow-md">
              <CheckCircle className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-xs text-green-700 font-medium">Info</p>
              <p className="text-2xl font-bold text-green-900">{stats.info}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-4">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="flex gap-3 flex-1 flex-wrap">
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">All Severities</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>

            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">All Actions</option>
              <option value="USER_LOGIN">Login</option>
              <option value="USER_LOGIN_FAILED">Failed Login</option>
              <option value="USER_PASSWORD_CHANGED">Password Change</option>
              <option value="SETTINGS_PROFILE_UPDATED">Profile Update</option>
              <option value="SETTINGS_SECURITY_UPDATED">Security Update</option>
              <option value="SETTINGS_NOTIFICATIONS_UPDATED">Notifications Update</option>
            </select>

            <button
              onClick={fetchAuditLogs}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>

          <button
            onClick={exportToCSV}
            disabled={logs.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg text-sm font-semibold hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Audit Logs List */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
        {loading ? (
          <div className="text-center py-12">
            <RefreshCw className="w-8 h-8 text-gray-400 animate-spin mx-auto mb-4" />
            <p className="text-gray-600 font-medium">Loading audit logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12">
            <Shield className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600 font-medium">No audit logs found</p>
            <p className="text-sm text-gray-500 mt-2">Your activity will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <div
                key={log.id}
                className={`p-4 rounded-xl border bg-gradient-to-r ${getSeverityColor(log.severity)} hover:shadow-md transition-all`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="mt-1 p-2 bg-white rounded-lg shadow-sm">
                      {getActionIcon(log.action)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold text-gray-900">{formatActionName(log.action)}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${getSeverityBadge(log.severity)}`}>
                          {log.severity.toUpperCase()}
                        </span>
                      </div>
                      <div className="space-y-1 text-sm">
                        {log.resource_name && (
                          <p className="text-gray-700 font-medium">
                            <span className="text-gray-500">Resource:</span> {log.resource_name}
                          </p>
                        )}
                        {log.details?.changeSummary && (
                          <p className="text-gray-600 italic">{log.details.changeSummary}</p>
                        )}
                        <div className="flex flex-wrap gap-3 text-xs text-gray-500 mt-2">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDate(log.created_at)}
                          </span>
                          {log.ip_address && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {log.ip_address}
                            </span>
                          )}
                          {log.compliance_flags && log.compliance_flags.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Shield className="w-3 h-3" />
                              {log.compliance_flags.join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="text-right text-xs text-gray-500 flex-shrink-0">
                    {new Date(log.created_at).toLocaleString()}
                  </div>
                </div>

                {/* Show changes if available */}
                {log.changes && Object.keys(log.changes).length > 0 && (
                  <details className="mt-3 pt-3 border-t border-gray-200">
                    <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900 flex items-center gap-2">
                      <Eye className="w-4 h-4" />
                      View Changes ({Object.keys(log.changes).length} field{Object.keys(log.changes).length > 1 ? 's' : ''})
                    </summary>
                    <div className="mt-3 space-y-2">
                      {Object.entries(log.changes).map(([field, change]: [string, any]) => {
                        const oldValue = change.from || change.before;
                        const newValue = change.to || change.after;

                        return (
                          <div key={field} className="p-3 bg-white rounded-lg border border-gray-200 shadow-sm">
                            <p className="font-semibold text-gray-800 mb-2 text-sm">{formatFieldLabel(field)}</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                              <div className="bg-red-50 border border-red-200 rounded-lg p-2">
                                <p className="text-xs text-red-600 font-medium mb-1">Previous</p>
                                <p className="text-red-700 font-semibold">{formatFieldValue(oldValue)}</p>
                              </div>
                              <div className="bg-green-50 border border-green-200 rounded-lg p-2">
                                <p className="text-xs text-green-600 font-medium mb-1">Updated</p>
                                <p className="text-green-700 font-semibold">{formatFieldValue(newValue)}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-6 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-600 font-medium">
              Showing {((currentPage - 1) * logsPerPage) + 1} to {Math.min(currentPage * logsPerPage, totalLogs)} of {totalLogs} entries
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
