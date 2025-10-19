// /app/admin/queues/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, Clock, Loader2, AlertCircle, RefreshCw } from 'lucide-react';

interface QueueStats {
  waiting: { count: number; jobs: any[] };
  active: { count: number; jobs: any[] };
  completed: { count: number; jobs: any[] };
  failed: { count: number; jobs: any[] };
}

export default function QueueDashboard() {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/queue-status');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setStats(data);
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
    const interval = setInterval(fetchStats, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-600" />
          <p>Loading queue status...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-8 h-8 mx-auto mb-4 text-red-600" />
          <p className="text-red-600 mb-4">Error: {error}</p>
          <button
            onClick={fetchStats}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Agent Queue Dashboard</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={fetchStats}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            {lastUpdate && (
              <p className="text-sm text-gray-500">
                Last updated: {lastUpdate.toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>

        {/* Queue Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-3">
              <Clock className="w-8 h-8 text-yellow-600" />
              <div>
                <p className="text-sm font-medium text-gray-600">Waiting</p>
                <p className="text-2xl font-bold text-gray-900">{stats?.waiting.count || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-3">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              <div>
                <p className="text-sm font-medium text-gray-600">Active</p>
                <p className="text-2xl font-bold text-gray-900">{stats?.active.count || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-8 h-8 text-green-600" />
              <div>
                <p className="text-sm font-medium text-gray-600">Completed</p>
                <p className="text-2xl font-bold text-gray-900">{stats?.completed.count || 0}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-8 h-8 text-red-600" />
              <div>
                <p className="text-sm font-medium text-gray-600">Failed</p>
                <p className="text-2xl font-bold text-gray-900">{stats?.failed.count || 0}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Job Details */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Active Jobs */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Active Jobs</h2>
            </div>
            <div className="p-6">
              {stats?.active.jobs.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No active jobs</p>
              ) : (
                <div className="space-y-3">
                  {stats?.active.jobs.map((job) => (
                    <div key={job.id} className="p-3 bg-blue-50 rounded border-l-4 border-blue-400">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-gray-900">Job #{job.id}</p>
                          <p className="text-sm text-gray-600">Agent: {job.data?.agentId}</p>
                          {job.processedOn && (
                            <p className="text-xs text-gray-500">
                              Started: {formatTime(job.processedOn)}
                            </p>
                          )}
                        </div>
                        <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Waiting Jobs */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Waiting Jobs</h2>
            </div>
            <div className="p-6">
              {stats?.waiting.jobs.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No waiting jobs</p>
              ) : (
                <div className="space-y-3">
                  {stats?.waiting.jobs.map((job) => (
                    <div key={job.id} className="p-3 bg-yellow-50 rounded border-l-4 border-yellow-400">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-gray-900">Job #{job.id}</p>
                          <p className="text-sm text-gray-600">Agent: {job.data?.agentId}</p>
                          {job.createdAt && (
                            <p className="text-xs text-gray-500">
                              Created: {formatTime(job.createdAt)}
                            </p>
                          )}
                        </div>
                        <Clock className="w-4 h-4 text-yellow-600" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent Completed Jobs */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Recent Completed</h2>
            </div>
            <div className="p-6">
              {stats?.completed.jobs.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No completed jobs</p>
              ) : (
                <div className="space-y-3">
                  {stats?.completed.jobs.map((job) => (
                    <div key={job.id} className="p-3 bg-green-50 rounded border-l-4 border-green-400">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-gray-900">Job #{job.id}</p>
                          <p className="text-sm text-gray-600">Agent: {job.data?.agentId}</p>
                          {job.finishedOn && (
                            <p className="text-xs text-gray-500">
                              Finished: {formatTime(job.finishedOn)}
                            </p>
                          )}
                        </div>
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Failed Jobs */}
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Failed Jobs</h2>
            </div>
            <div className="p-6">
              {stats?.failed.jobs.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No failed jobs</p>
              ) : (
                <div className="space-y-3">
                  {stats?.failed.jobs.map((job) => (
                    <div key={job.id} className="p-3 bg-red-50 rounded border-l-4 border-red-400">
                      <div>
                        <p className="font-medium text-gray-900">Job #{job.id}</p>
                        <p className="text-sm text-gray-600">Agent: {job.data?.agentId}</p>
                        <p className="text-xs text-red-600 mt-1">{job.failedReason}</p>
                        {job.processedOn && (
                          <p className="text-xs text-gray-500">
                            Failed: {formatTime(job.processedOn)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}