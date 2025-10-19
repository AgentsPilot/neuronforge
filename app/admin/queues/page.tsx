// /app/admin/queues/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { 
  CheckCircle, Clock, Loader2, AlertCircle, RefreshCw, BarChart3, 
  TrendingUp, Zap, Eye, Download, Filter, Search, Calendar,
  Server, Database, Activity, Settings, FileText, Terminal
} from 'lucide-react';

interface JobData {
  id: string;
  name: string;
  data: {
    agentId?: string;
    userId?: string;
    executionId?: string;
    inputVariables?: any;
  };
  createdAt?: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
  progress?: number;
  returnvalue?: any;
  stacktrace?: string[];
  logs?: string[];
  delay?: number;
  attempts?: number;
  attemptsMade?: number;
}

interface QueueStats {
  waiting: { count: number; jobs: JobData[] };
  active: { count: number; jobs: JobData[] };
  completed: { count: number; jobs: JobData[] };
  failed: { count: number; jobs: JobData[] };
}

interface SystemMetrics {
  totalProcessed: number;
  avgProcessingTime: number;
  successRate: number;
  throughputPerHour: number;
  memoryUsage?: string;
  redisConnections?: number;
}

export default function AdminQueueDashboard() {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [selectedJob, setSelectedJob] = useState<JobData | null>(null);
  const [filter, setFilter] = useState<'all' | 'waiting' | 'active' | 'completed' | 'failed'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/queue-status');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setStats(data);
      
      // Calculate system metrics
      const allJobs = [...data.completed.jobs, ...data.failed.jobs];
      const completed = data.completed.jobs;
      const failed = data.failed.jobs;
      
      const totalProcessed = completed.length + failed.length;
      const successRate = totalProcessed > 0 ? (completed.length / totalProcessed) * 100 : 0;
      
      const avgProcessingTime = completed.length > 0 
        ? completed.reduce((sum: number, job: JobData) => {
            if (job.processedOn && job.finishedOn) {
              return sum + (job.finishedOn - job.processedOn);
            }
            return sum;
          }, 0) / completed.length / 1000 // Convert to seconds
        : 0;

      setMetrics({
        totalProcessed,
        avgProcessingTime,
        successRate,
        throughputPerHour: 0, // Could be calculated with historical data
      });
      
      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch queue stats');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    if (autoRefresh) {
      const interval = setInterval(fetchStats, 3000); // Refresh every 3 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ${seconds % 60}s`;
  };

  const getJobsByFilter = () => {
    if (!stats) return [];
    
    let jobs: JobData[] = [];
    switch (filter) {
      case 'waiting': jobs = stats.waiting.jobs; break;
      case 'active': jobs = stats.active.jobs; break;
      case 'completed': jobs = stats.completed.jobs; break;
      case 'failed': jobs = stats.failed.jobs; break;
      default: 
        jobs = [...stats.waiting.jobs, ...stats.active.jobs, ...stats.completed.jobs, ...stats.failed.jobs];
    }

    if (searchTerm) {
      jobs = jobs.filter(job => 
        job.id.includes(searchTerm) ||
        job.data?.agentId?.includes(searchTerm) ||
        job.data?.executionId?.includes(searchTerm)
      );
    }

    return jobs;
  };

  const JobDetailsModal = ({ job, onClose }: { job: JobData; onClose: () => void }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-xl font-semibold">Job #{job.id} Details</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          {/* Job Overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 p-3 rounded">
              <p className="text-sm text-gray-600">Job ID</p>
              <p className="font-mono text-sm">{job.id}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded">
              <p className="text-sm text-gray-600">Agent ID</p>
              <p className="font-mono text-sm truncate">{job.data?.agentId || 'N/A'}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded">
              <p className="text-sm text-gray-600">Execution ID</p>
              <p className="font-mono text-sm truncate">{job.data?.executionId || 'N/A'}</p>
            </div>
            <div className="bg-gray-50 p-3 rounded">
              <p className="text-sm text-gray-600">Attempts</p>
              <p className="font-mono text-sm">{job.attemptsMade || 0}/{job.attempts || 1}</p>
            </div>
          </div>

          {/* Timing Information */}
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Timing Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {job.createdAt && (
                <div className="bg-blue-50 p-3 rounded">
                  <p className="text-sm text-blue-600 font-medium">Created</p>
                  <p className="text-sm">{new Date(job.createdAt).toLocaleString()}</p>
                </div>
              )}
              {job.processedOn && (
                <div className="bg-green-50 p-3 rounded">
                  <p className="text-sm text-green-600 font-medium">Started</p>
                  <p className="text-sm">{new Date(job.processedOn).toLocaleString()}</p>
                </div>
              )}
              {job.finishedOn && (
                <div className="bg-purple-50 p-3 rounded">
                  <p className="text-sm text-purple-600 font-medium">Finished</p>
                  <p className="text-sm">{new Date(job.finishedOn).toLocaleString()}</p>
                  {job.processedOn && (
                    <p className="text-xs text-gray-500">
                      Duration: {formatDuration(job.finishedOn - job.processedOn)}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Job Data */}
          <div>
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Database className="w-5 h-5" />
              Job Data
            </h3>
            <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-sm overflow-x-auto">
              <pre>{JSON.stringify(job.data, null, 2)}</pre>
            </div>
          </div>

          {/* Results */}
          {job.returnvalue && (
            <div>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <CheckCircle className="w-5 h-5" />
                Return Value
              </h3>
              <div className="bg-green-900 text-green-100 p-4 rounded font-mono text-sm overflow-x-auto">
                <pre>{JSON.stringify(job.returnvalue, null, 2)}</pre>
              </div>
            </div>
          )}

          {/* Error Information */}
          {job.failedReason && (
            <div>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2 text-red-600">
                <AlertCircle className="w-5 h-5" />
                Error Details
              </h3>
              <div className="bg-red-50 border border-red-200 p-4 rounded">
                <p className="text-red-800 font-medium">Failed Reason:</p>
                <p className="text-red-700 mt-1">{job.failedReason}</p>
              </div>
              
              {job.stacktrace && job.stacktrace.length > 0 && (
                <div className="mt-4">
                  <p className="text-red-800 font-medium mb-2">Stack Trace:</p>
                  <div className="bg-red-900 text-red-100 p-4 rounded font-mono text-sm overflow-x-auto max-h-64 overflow-y-auto">
                    <pre>{job.stacktrace.join('\n')}</pre>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Logs */}
          {job.logs && job.logs.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Terminal className="w-5 h-5" />
                Execution Logs
              </h3>
              <div className="bg-gray-900 text-gray-100 p-4 rounded font-mono text-sm max-h-64 overflow-y-auto">
                {job.logs.map((log, index) => (
                  <div key={index} className="mb-1">
                    <span className="text-gray-400">[{index + 1}]</span> {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-indigo-600" />
          <p className="text-lg text-gray-600">Loading admin dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-red-600" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Dashboard Error</h2>
          <p className="text-red-600 mb-6">{error}</p>
          <button
            onClick={fetchStats}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 flex items-center gap-2 mx-auto"
          >
            <RefreshCw className="w-4 h-4" />
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  const filteredJobs = getJobsByFilter();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                <Server className="w-8 h-8 text-indigo-600" />
                Admin Queue Dashboard
              </h1>
              <p className="text-gray-600 mt-1">Real-time monitoring and management</p>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-green-500' : 'bg-gray-400'}`} />
                <span className="text-sm text-gray-600">
                  {autoRefresh ? 'Live' : 'Paused'}
                </span>
              </div>
              
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
              >
                {autoRefresh ? 'Pause' : 'Resume'}
              </button>
              
              <button
                onClick={fetchStats}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              
              {lastUpdate && (
                <p className="text-sm text-gray-500">
                  Updated: {lastUpdate.toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* System Metrics */}
        {metrics && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-indigo-100 rounded-lg">
                  <BarChart3 className="w-6 h-6 text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Processed</p>
                  <p className="text-2xl font-bold text-gray-900">{metrics.totalProcessed}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-green-100 rounded-lg">
                  <TrendingUp className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Success Rate</p>
                  <p className="text-2xl font-bold text-gray-900">{metrics.successRate.toFixed(1)}%</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <Zap className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Avg Processing</p>
                  <p className="text-2xl font-bold text-gray-900">{metrics.avgProcessingTime.toFixed(1)}s</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-100 rounded-lg">
                  <Activity className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Active Workers</p>
                  <p className="text-2xl font-bold text-gray-900">{stats?.active.count || 0}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Queue Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-yellow-400">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Waiting</p>
                <p className="text-3xl font-bold text-gray-900">{stats?.waiting.count || 0}</p>
              </div>
              <Clock className="w-8 h-8 text-yellow-600" />
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-blue-400">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active</p>
                <p className="text-3xl font-bold text-gray-900">{stats?.active.count || 0}</p>
              </div>
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-green-400">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Completed</p>
                <p className="text-3xl font-bold text-gray-900">{stats?.completed.count || 0}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-red-400">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Failed</p>
                <p className="text-3xl font-bold text-gray-900">{stats?.failed.count || 0}</p>
              </div>
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>
          </div>
        </div>

        {/* Job Management */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">Job Management</h2>
              
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search jobs..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="px-3 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as any)}
                  className="px-3 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">All Jobs</option>
                  <option value="waiting">Waiting</option>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Job ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Agent</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredJobs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                      No jobs found matching your criteria
                    </td>
                  </tr>
                ) : (
                  filteredJobs.slice(0, 50).map((job) => {
                    const getStatusBadge = () => {
                      if (stats?.active.jobs.includes(job)) {
                        return <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">Active</span>;
                      } else if (stats?.waiting.jobs.includes(job)) {
                        return <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">Waiting</span>;
                      } else if (stats?.completed.jobs.includes(job)) {
                        return <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">Completed</span>;
                      } else if (stats?.failed.jobs.includes(job)) {
                        return <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">Failed</span>;
                      }
                      return <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded-full">Unknown</span>;
                    };

                    return (
                      <tr key={job.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="font-mono text-sm text-gray-900">#{job.id}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm text-gray-900 truncate max-w-xs block">
                            {job.data?.agentId || 'N/A'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {getStatusBadge()}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {job.createdAt ? formatTime(job.createdAt) : 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {job.processedOn && job.finishedOn 
                            ? formatDuration(job.finishedOn - job.processedOn)
                            : job.processedOn && !job.finishedOn
                            ? 'Running...'
                            : 'N/A'
                          }
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <button
                            onClick={() => setSelectedJob(job)}
                            className="text-indigo-600 hover:text-indigo-900 flex items-center gap-1"
                          >
                            <Eye className="w-4 h-4" />
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {filteredJobs.length > 50 && (
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
              <p className="text-sm text-gray-600">
                Showing first 50 of {filteredJobs.length} jobs. Use filters to narrow results.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Job Details Modal */}
      {selectedJob && (
        <JobDetailsModal 
          job={selectedJob} 
          onClose={() => setSelectedJob(null)} 
        />
      )}
    </div>
  );
}