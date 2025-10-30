'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/UserProvider';
import {
  Search, Filter, Calendar, User, Activity, AlertCircle,
  CheckCircle, Info, AlertTriangle, ChevronDown, ChevronUp,
  Download, RefreshCw, FileText, Database, TrendingUp
} from 'lucide-react';

interface AuditLogEntry {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  resource_name: string;
  details: any;
  changes: any;
  severity: string;
  created_at: string;
  compliance_flags: string[];
  users?: {
    email?: string;
    full_name?: string;
  } | null;
}

interface FilterState {
  action: string;
  severity: string;
  dateFrom: string;
  dateTo: string;
  searchTerm: string;
  entityType: string;
}

export default function AuditTrailPage() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize] = useState(20);
  const [pagination, setPagination] = useState({
    total: 0,
    totalPages: 0,
    hasMore: false,
    showing: 0
  });
  const [filters, setFilters] = useState<FilterState>({
    action: 'all',
    severity: 'all',
    dateFrom: '',
    dateTo: '',
    searchTerm: '',
    entityType: 'all'
  });

  const fetchLogs = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (filters.action !== 'all') params.append('action', filters.action);
      if (filters.severity !== 'all') params.append('severity', filters.severity);
      if (filters.entityType !== 'all') params.append('entity_type', filters.entityType);
      if (filters.dateFrom) params.append('date_from', filters.dateFrom);
      if (filters.dateTo) params.append('date_to', filters.dateTo);
      if (filters.searchTerm) params.append('search', filters.searchTerm);
      params.append('page', currentPage.toString());
      params.append('page_size', pageSize.toString());

      const response = await fetch(`/api/admin/audit-trail?${params.toString()}`);
      const data = await response.json();

      if (data.success) {
        setLogs(data.logs);
        if (data.pagination) {
          setPagination(data.pagination);
        }
      } else {
        setError(data.error || 'Failed to fetch audit logs');
      }
    } catch (err) {
      setError('Failed to fetch audit logs');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [filters, currentPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [filters]);

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical': return <AlertCircle className="w-5 h-5 text-red-500" />;
      case 'warning': return <AlertTriangle className="w-5 h-5 text-yellow-500" />;
      case 'info': return <Info className="w-5 h-5 text-blue-500" />;
      default: return <CheckCircle className="w-5 h-5 text-green-500" />;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500/10 border-red-500/50 text-red-300';
      case 'warning': return 'bg-yellow-500/10 border-yellow-500/50 text-yellow-300';
      case 'info': return 'bg-blue-500/10 border-blue-500/50 text-blue-300';
      default: return 'bg-green-500/10 border-green-500/50 text-green-300';
    }
  };

  const getActionIcon = (action: string) => {
    if (action.includes('NORMALIZATION_REFRESH')) return <Database className="w-5 h-5" />;
    if (action.includes('SCORE')) return <TrendingUp className="w-5 h-5" />;
    return <Activity className="w-5 h-5" />;
  };

  const getActionLabel = (action: string) => {
    return action.replace('AIS_', '').replace(/_/g, ' ').toLowerCase()
      .split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const exportLogs = () => {
    const csv = [
      ['Timestamp', 'Action', 'Entity', 'Resource', 'Severity', 'User'].join(','),
      ...logs.map(log => [
        log.created_at,
        log.action,
        log.entity_type,
        log.resource_name,
        log.severity,
        log.user_id || 'System'
      ].join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ais-audit-trail-${new Date().toISOString()}.csv`;
    a.click();
  };

  if (loading && logs.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-black text-white flex items-center gap-3">
              <FileText className="w-10 h-10" />
              Audit Trail
            </h1>
            <p className="text-slate-400 mt-2">
              Track all system events, user actions, and AIS changes across the platform
            </p>
          </div>
          <button
            onClick={exportLogs}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all duration-200 flex items-center gap-2"
          >
            <Download className="w-5 h-5" />
            Export CSV
          </button>
        </div>

        {/* Filters */}
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-6">
          <div className="flex items-center gap-3 mb-4">
            <Filter className="w-5 h-5 text-blue-400" />
            <h2 className="text-xl font-bold text-white">Filters</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Search */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by agent, user email, or name..."
                  value={filters.searchTerm}
                  onChange={(e) => setFilters({ ...filters, searchTerm: e.target.value })}
                  className="w-full pl-10 pr-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Action Filter */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Action Type</label>
              <select
                value={filters.action}
                onChange={(e) => setFilters({ ...filters, action: e.target.value })}
                className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Actions</option>
                <optgroup label="AIS Events">
                  <option value="AIS_SCORE_CALCULATED">AIS: Score Calculated</option>
                  <option value="AIS_SCORE_UPDATED">AIS: Score Updated</option>
                  <option value="AIS_SCORE_RECALCULATED">AIS: Score Recalculated</option>
                  <option value="AIS_NORMALIZATION_REFRESH_STARTED">AIS: Refresh Started</option>
                  <option value="AIS_NORMALIZATION_REFRESH_COMPLETED">AIS: Refresh Completed</option>
                  <option value="AIS_SCORES_BULK_RECALCULATED">AIS: Bulk Recalculated</option>
                </optgroup>
                <optgroup label="User Events">
                  <option value="USER_LOGIN">User: Login</option>
                  <option value="USER_LOGOUT">User: Logout</option>
                  <option value="USER_CREATED">User: Created</option>
                  <option value="USER_UPDATED">User: Updated</option>
                </optgroup>
                <optgroup label="Agent Events">
                  <option value="AGENT_CREATED">Agent: Created</option>
                  <option value="AGENT_UPDATED">Agent: Updated</option>
                  <option value="AGENT_DELETED">Agent: Deleted</option>
                  <option value="AGENT_EXECUTED">Agent: Executed</option>
                </optgroup>
              </select>
            </div>

            {/* Severity Filter */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Severity</label>
              <select
                value={filters.severity}
                onChange={(e) => setFilters({ ...filters, severity: e.target.value })}
                className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Severities</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>

            {/* Date From */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">From Date</label>
              <input
                type="datetime-local"
                value={filters.dateFrom}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Date To */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">To Date</label>
              <input
                type="datetime-local"
                value={filters.dateTo}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Entity Type */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Entity Type</label>
              <select
                value={filters.entityType}
                onChange={(e) => setFilters({ ...filters, entityType: e.target.value })}
                className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Entities</option>
                <option value="agent">Agent</option>
                <option value="system">System</option>
              </select>
            </div>
          </div>

          {/* Clear Filters */}
          <button
            onClick={() => setFilters({
              action: 'all',
              severity: 'all',
              dateFrom: '',
              dateTo: '',
              searchTerm: '',
              entityType: 'all'
            })}
            className="mt-4 px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
          >
            Clear All Filters
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-400 font-medium">Error</p>
              <p className="text-red-300 text-sm mt-1">{error}</p>
            </div>
          </div>
        )}

        {/* Results Count & Pagination */}
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 p-4">
          <div className="flex items-center justify-between">
            {/* Left: Results Count */}
            <div className="text-sm text-slate-400">
              Showing {pagination.showing} of {pagination.total} audit logs
              {pagination.totalPages > 1 && (
                <span className="ml-2 text-slate-500">
                  (Page {currentPage} of {pagination.totalPages})
                </span>
              )}
            </div>

            {/* Right: Pagination Controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={fetchLogs}
                disabled={loading}
                className="flex items-center gap-2 text-blue-400 hover:text-blue-300 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>

              {pagination.totalPages > 1 && (
                <>
                  <div className="h-4 w-px bg-slate-600" />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1 || loading}
                      className="px-3 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      First
                    </button>
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1 || loading}
                      className="px-3 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      Previous
                    </button>
                    <span className="text-sm text-slate-400 min-w-[100px] text-center">
                      Page {currentPage} of {pagination.totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(pagination.totalPages, prev + 1))}
                      disabled={!pagination.hasMore || loading}
                      className="px-3 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      Next
                    </button>
                    <button
                      onClick={() => setCurrentPage(pagination.totalPages)}
                      disabled={currentPage === pagination.totalPages || loading}
                      className="px-3 py-1 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      Last
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Audit Logs */}
        <div className="space-y-3">
          {logs.length === 0 ? (
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-12 text-center">
              <FileText className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 text-lg">No audit logs found</p>
              <p className="text-slate-500 text-sm mt-2">Try adjusting your filters</p>
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden"
              >
                {/* Header */}
                <div
                  className="p-4 cursor-pointer hover:bg-white/5 transition-colors"
                  onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                >
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div className={`p-2 rounded-lg ${getSeverityColor(log.severity)}`}>
                      {getActionIcon(log.action)}
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-lg font-semibold text-white">
                            {getActionLabel(log.action)}
                          </h3>
                          <p className="text-slate-400 text-sm mt-1">
                            {log.resource_name || log.entity_id}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {getSeverityIcon(log.severity)}
                          <span className="text-xs text-slate-500">
                            {formatDate(log.created_at)}
                          </span>
                          {expandedLog === log.id ? (
                            <ChevronUp className="w-5 h-5 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                      </div>

                      {/* Quick Info */}
                      <div className="flex items-center gap-4 mt-3 text-sm">
                        <span className="text-slate-500">
                          Entity: <span className="text-slate-300">{log.entity_type}</span>
                        </span>
                        {log.user_id && (
                          <span className="text-slate-500">
                            User: <span className="text-slate-300">
                              {log.users?.email || log.users?.full_name || log.user_id}
                            </span>
                          </span>
                        )}
                        {log.compliance_flags && log.compliance_flags.length > 0 && (
                          <span className="text-slate-500">
                            Compliance: <span className="text-blue-300">{log.compliance_flags.join(', ')}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedLog === log.id && (
                  <div className="border-t border-white/10 p-6 bg-slate-900/50 space-y-6">

                    {/* Metadata Section - Always show */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="bg-slate-800/30 rounded-lg p-3">
                        <div className="text-xs text-slate-400 mb-1">Event ID</div>
                        <div className="text-xs font-mono text-slate-300 truncate">{log.id}</div>
                      </div>
                      <div className="bg-slate-800/30 rounded-lg p-3">
                        <div className="text-xs text-slate-400 mb-1">Entity ID</div>
                        <div className="text-xs font-mono text-slate-300 truncate">{log.entity_id}</div>
                      </div>
                      <div className="bg-slate-800/30 rounded-lg p-3">
                        <div className="text-xs text-slate-400 mb-1">Severity</div>
                        <div className="text-sm font-semibold text-slate-200">{log.severity}</div>
                      </div>
                      {log.compliance_flags && log.compliance_flags.length > 0 && (
                        <div className="bg-slate-800/30 rounded-lg p-3">
                          <div className="text-xs text-slate-400 mb-1">Compliance</div>
                          <div className="text-sm font-semibold text-blue-300">{log.compliance_flags.join(', ')}</div>
                        </div>
                      )}
                      {log.user_id && (
                        <div className="bg-slate-800/30 rounded-lg p-3">
                          <div className="text-xs text-slate-400 mb-1">User</div>
                          <div className="text-sm font-semibold text-slate-200 truncate">
                            {log.users?.email || log.users?.full_name || log.user_id}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Score Changes (for AIS_SCORE_UPDATED) */}
                    {log.action === 'AIS_SCORE_UPDATED' && log.changes && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-slate-800/50 rounded-lg p-4">
                          <div className="text-xs text-slate-400 mb-2">Before</div>
                          <div className="text-2xl font-bold text-slate-300">
                            {log.changes.before?.combined_score?.toFixed(2)}
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            Multiplier: {log.changes.before?.combined_multiplier?.toFixed(3)}x
                          </div>
                        </div>
                        <div className="flex items-center justify-center">
                          <div className="text-3xl text-blue-400">→</div>
                        </div>
                        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                          <div className="text-xs text-blue-400 mb-2">After</div>
                          <div className="text-2xl font-bold text-blue-300">
                            {log.changes.after?.combined_score?.toFixed(2)}
                          </div>
                          <div className="text-xs text-blue-400 mt-1">
                            Multiplier: {log.changes.after?.combined_multiplier?.toFixed(3)}x
                          </div>
                          <div className={`text-sm font-semibold mt-2 ${
                            log.changes.delta?.combined_score >= 0 ? 'text-green-400' : 'text-red-400'
                          }`}>
                            {log.changes.delta?.combined_score >= 0 ? '+' : ''}
                            {log.changes.delta?.combined_score?.toFixed(2)} change
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Score Calculated (for AIS_SCORE_CALCULATED) */}
                    {log.action === 'AIS_SCORE_CALCULATED' && log.details && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                          <div className="text-xs text-green-400 mb-1">Creation Score</div>
                          <div className="text-2xl font-bold text-green-300">
                            {log.details.creation_score?.toFixed(2)}
                          </div>
                          <div className="text-xs text-green-400 mt-1">
                            {log.details.creation_multiplier?.toFixed(3)}x multiplier
                          </div>
                        </div>
                        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                          <div className="text-xs text-purple-400 mb-1">Execution Score</div>
                          <div className="text-2xl font-bold text-purple-300">
                            {log.details.execution_score?.toFixed(2)}
                          </div>
                          <div className="text-xs text-purple-400 mt-1">
                            {log.details.execution_multiplier?.toFixed(3)}x multiplier
                          </div>
                        </div>
                        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                          <div className="text-xs text-blue-400 mb-1">Combined Score</div>
                          <div className="text-2xl font-bold text-blue-300">
                            {log.details.combined_score?.toFixed(2)}
                          </div>
                          <div className="text-xs text-blue-400 mt-1">
                            {log.details.combined_multiplier?.toFixed(3)}x multiplier
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Normalization Refresh Started */}
                    {log.action === 'AIS_NORMALIZATION_REFRESH_STARTED' && log.details && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
                            <div className="text-xs text-blue-400 mb-2">Agents Captured</div>
                            <div className="text-3xl font-bold text-blue-300">
                              {log.details.affected_agents_count || log.details.agent_scores_snapshot?.length || 0}
                            </div>
                          </div>
                          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                            <div className="text-xs text-purple-400 mb-2">Ranges Captured</div>
                            <div className="text-3xl font-bold text-purple-300">
                              {log.details.old_ranges?.length || 0}
                            </div>
                          </div>
                        </div>
                        {log.details.reason && (
                          <div className="bg-slate-800/50 rounded-lg p-4">
                            <div className="text-xs text-slate-400 mb-2">Reason</div>
                            <div className="text-sm text-slate-200">{log.details.reason}</div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Normalization Refresh Completed - Show Before/After Changes */}
                    {log.action === 'AIS_NORMALIZATION_REFRESH_COMPLETED' && log.changes && (
                      <div className="space-y-4">
                        <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                          <TrendingUp className="w-4 h-4" />
                          Normalization Ranges Updated
                        </h4>

                        {/* Summary Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-slate-800/50 rounded-lg p-4">
                            <div className="text-xs text-slate-400 mb-2">Old Ranges</div>
                            <div className="text-2xl font-bold text-slate-300">
                              {log.changes.before?.length || 0}
                            </div>
                          </div>
                          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                            <div className="text-xs text-green-400 mb-2">New Ranges</div>
                            <div className="text-2xl font-bold text-green-300">
                              {log.changes.after?.length || 0}
                            </div>
                          </div>
                        </div>

                        {/* Before/After Ranges Comparison */}
                        {log.changes.before && log.changes.after && (
                          <div className="space-y-3">
                            <div className="text-xs text-slate-400 mb-2">Range Changes:</div>
                            <div className="max-h-96 overflow-y-auto space-y-2">
                              {log.changes.after.map((newRange: any, idx: number) => {
                                const oldRange = log.changes.before.find((r: any) => r.range_key === newRange.range_key);
                                const hasChanged = oldRange && (
                                  oldRange.best_practice_min !== newRange.best_practice_min ||
                                  oldRange.best_practice_max !== newRange.best_practice_max
                                );

                                return (
                                  <div
                                    key={newRange.range_key}
                                    className={`grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-lg ${
                                      hasChanged ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-slate-800/30'
                                    }`}
                                  >
                                    <div>
                                      <div className="text-xs text-slate-400 mb-1">Range Key</div>
                                      <div className="text-sm font-mono text-slate-200">{newRange.range_key}</div>
                                      {newRange.category && (
                                        <div className="text-xs text-slate-500 mt-1">{newRange.category}</div>
                                      )}
                                    </div>
                                    <div>
                                      <div className="text-xs text-slate-400 mb-1">Before</div>
                                      <div className="text-sm text-slate-300">
                                        [{oldRange?.best_practice_min ?? 'N/A'} - {oldRange?.best_practice_max ?? 'N/A'}]
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-xs text-green-400 mb-1">After</div>
                                      <div className="text-sm font-semibold text-green-300">
                                        [{newRange.best_practice_min} - {newRange.best_practice_max}]
                                      </div>
                                      {hasChanged && (
                                        <div className="text-xs text-yellow-400 mt-1">✓ Changed</div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Normalization Ranges (if available) */}
                    {log.details?.normalization_ranges && (
                      <div>
                        <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                          <Database className="w-4 h-4" />
                          Normalization Ranges Used
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {Object.entries(log.details.normalization_ranges).slice(0, 6).map(([key, value]: [string, any]) => (
                            <div key={key} className="bg-slate-800/50 rounded-lg p-3">
                              <div className="text-xs text-slate-400 mb-1 font-mono">{key}</div>
                              <div className="text-sm text-slate-200">
                                [{value?.min || 0} - {value?.max || 0}]
                              </div>
                            </div>
                          ))}
                        </div>
                        {Object.keys(log.details.normalization_ranges).length > 6 && (
                          <div className="text-xs text-slate-500 mt-2">
                            + {Object.keys(log.details.normalization_ranges).length - 6} more ranges
                          </div>
                        )}
                      </div>
                    )}

                    {/* Execution Details */}
                    {log.details && (log.details.total_executions || log.details.total_tokens_used) && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {log.details.total_executions && (
                          <div className="bg-slate-800/50 rounded-lg p-3">
                            <div className="text-xs text-slate-400 mb-1">Executions</div>
                            <div className="text-lg font-semibold text-slate-200">
                              {log.details.total_executions}
                            </div>
                          </div>
                        )}
                        {log.details.total_tokens_used && (
                          <div className="bg-slate-800/50 rounded-lg p-3">
                            <div className="text-xs text-slate-400 mb-1">Tokens Used</div>
                            <div className="text-lg font-semibold text-slate-200">
                              {log.details.total_tokens_used.toLocaleString()}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Generic Details (for other event types) */}
                    {log.details && !log.action.startsWith('AIS_') && (
                      <div className="bg-slate-800/50 rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-slate-300 mb-3">Event Details</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {Object.entries(log.details).map(([key, value]: [string, any]) => (
                            <div key={key} className="flex items-start gap-2">
                              <span className="text-xs text-slate-400 font-mono min-w-[120px]">{key}:</span>
                              <span className="text-sm text-slate-200 flex-1">
                                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Generic Changes (for other event types) */}
                    {log.changes && !log.action.startsWith('AIS_') && (
                      <div className="bg-slate-800/50 rounded-lg p-4">
                        <h4 className="text-sm font-semibold text-slate-300 mb-3">Changes Made</h4>
                        <div className="space-y-2">
                          {log.changes.before && (
                            <div>
                              <div className="text-xs text-slate-400 mb-1">Before:</div>
                              <div className="text-sm text-slate-200 bg-slate-900/50 rounded p-2">
                                {JSON.stringify(log.changes.before, null, 2)}
                              </div>
                            </div>
                          )}
                          {log.changes.after && (
                            <div>
                              <div className="text-xs text-slate-400 mb-1">After:</div>
                              <div className="text-sm text-slate-200 bg-slate-900/50 rounded p-2">
                                {JSON.stringify(log.changes.after, null, 2)}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
