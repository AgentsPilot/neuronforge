'use client'

import React, { useState, useEffect } from 'react';
import { 
  Bot, 
  Play, 
  DollarSign, 
  Calendar,
  RefreshCw,
  Download,
  TrendingUp,
  Clock,
  CheckCircle,
  XCircle,
  Activity,
  BarChart3
} from 'lucide-react';
import { useAuth } from '@/components/UserProvider';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

interface AgentActivity {
  agent_name: string;
  agent_id: string;
  total_cost: number;
  creation_cost: number;
  execution_cost: number;
  total_runs: number;
  successful_runs: number;
  failed_runs: number;
  last_used: string;
  avg_response_time: number;
}

interface DailyStats {
  date: string;
  agents_created: number;
  agents_executed: number;
  total_cost: number;
  total_activities: number;
}

const SimpleAgentDashboard = () => {
  const { user } = useAuth();
  const supabase = createClientComponentClient();
  
  const [timeFilter, setTimeFilter] = useState('last_30d');
  const [loading, setLoading] = useState(true);
  const [rawData, setRawData] = useState<any[]>([]);
  
  // Simple aggregated metrics
  const [totalCost, setTotalCost] = useState(0);
  const [totalAgentsCreated, setTotalAgentsCreated] = useState(0);
  const [totalAgentRuns, setTotalAgentRuns] = useState(0);
  const [successRate, setSuccessRate] = useState(100);
  
  // Agent-focused data
  const [agentActivities, setAgentActivities] = useState<AgentActivity[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, timeFilter]);

  const loadData = async () => {
    if (!user?.id) return;

    setLoading(true);
    try {
      const now = new Date();
      let filterDate = new Date();
      
      switch (timeFilter) {
        case 'last_24h':
          filterDate.setHours(now.getHours() - 24);
          break;
        case 'last_7d':
          filterDate.setDate(now.getDate() - 7);
          break;
        case 'last_30d':
          filterDate.setDate(now.getDate() - 30);
          break;
        case 'last_90d':
          filterDate.setDate(now.getDate() - 90);
          break;
        default:
          filterDate.setFullYear(2020);
          break;
      }

      let query = supabase
        .from('token_usage')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (timeFilter !== 'all') {
        query = query.gte('created_at', filterDate.toISOString());
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error loading token usage data:', error);
        return;
      }

      const filteredData = data || [];
      setRawData(filteredData);

      if (filteredData.length > 0) {
        processSimpleAnalytics(filteredData);
      } else {
        resetAnalytics();
      }

    } catch (error) {
      console.error('Error loading analytics data:', error);
    } finally {
      setLoading(false);
    }
  };

  const processSimpleAnalytics = (data: any[]) => {
    // Calculate simple totals
    const cost = data.reduce((sum, row) => sum + parseFloat(row.cost_usd?.toString() || '0'), 0);
    setTotalCost(cost);

    // Count agent creations and executions
    const agentCreations = data.filter(row => 
      row.metadata?.feature === 'agent_creation' || 
      row.category === 'agent_creation'
    );
    
    const agentExecutions = data.filter(row => 
      row.metadata?.execution_type === 'production' || 
      row.metadata?.execution_type === 'test' ||
      row.metadata?.feature === 'agent_execution'
    );

    setTotalAgentsCreated(agentCreations.length);
    setTotalAgentRuns(agentExecutions.length);

    // Calculate success rate for executions only
    const successfulExecutions = agentExecutions.filter(row => 
      row.metadata?.success !== false && !row.metadata?.error_code
    );
    const execSuccessRate = agentExecutions.length > 0 
      ? (successfulExecutions.length / agentExecutions.length) * 100 
      : 100;
    setSuccessRate(execSuccessRate);

    // Group by agent
    const agentMap = new Map<string, any>();
    
    data.forEach(row => {
      const agentName = row.metadata?.agent_name || 'Unknown Agent';
      const agentId = row.metadata?.agent_id || 'unknown';
      const key = `${agentId}-${agentName}`;
      
      if (!agentMap.has(key)) {
        agentMap.set(key, {
          agent_name: agentName,
          agent_id: agentId,
          total_cost: 0,
          creation_cost: 0,
          execution_cost: 0,
          total_runs: 0,
          successful_runs: 0,
          failed_runs: 0,
          last_used: row.created_at,
          latencies: []
        });
      }

      const agent = agentMap.get(key);
      agent.total_cost += parseFloat(row.cost_usd?.toString() || '0');
      
      // Categorize costs
      if (row.metadata?.feature === 'agent_creation' || row.category === 'agent_creation') {
        agent.creation_cost += parseFloat(row.cost_usd?.toString() || '0');
      } else if (row.metadata?.execution_type === 'production' || row.metadata?.execution_type === 'test') {
        agent.execution_cost += parseFloat(row.cost_usd?.toString() || '0');
        agent.total_runs += 1;
        
        if (row.metadata?.success !== false && !row.metadata?.error_code) {
          agent.successful_runs += 1;
        } else {
          agent.failed_runs += 1;
        }
      }

      // Track latency
      if (row.metadata?.latency_ms) {
        agent.latencies.push(row.metadata.latency_ms);
      }

      // Update last used
      if (new Date(row.created_at) > new Date(agent.last_used)) {
        agent.last_used = row.created_at;
      }
    });

    // Convert to array and calculate averages
    const activities = Array.from(agentMap.values()).map(agent => ({
      ...agent,
      avg_response_time: agent.latencies.length > 0 
        ? agent.latencies.reduce((sum: number, lat: number) => sum + lat, 0) / agent.latencies.length 
        : 0
    })).sort((a, b) => b.total_cost - a.total_cost);

    setAgentActivities(activities);

    // Daily stats
    const dailyMap = new Map<string, DailyStats>();
    
    data.forEach(row => {
      const date = new Date(row.created_at).toISOString().split('T')[0];
      
      if (!dailyMap.has(date)) {
        dailyMap.set(date, {
          date,
          agents_created: 0,
          agents_executed: 0,
          total_cost: 0,
          total_activities: 0
        });
      }

      const day = dailyMap.get(date)!;
      day.total_cost += parseFloat(row.cost_usd?.toString() || '0');
      day.total_activities += 1;

      if (row.metadata?.feature === 'agent_creation' || row.category === 'agent_creation') {
        day.agents_created += 1;
      } else if (row.metadata?.execution_type === 'production' || row.metadata?.execution_type === 'test') {
        day.agents_executed += 1;
      }
    });

    const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    setDailyStats(daily);
  };

  const resetAnalytics = () => {
    setTotalCost(0);
    setTotalAgentsCreated(0);
    setTotalAgentRuns(0);
    setSuccessRate(100);
    setAgentActivities([]);
    setDailyStats([]);
  };

  const formatCost = (cost: number) => `$${cost.toFixed(3)}`;
  const formatTime = (ms: number) => ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms/1000).toFixed(1)}s`;

  const getTimeFilterLabel = () => {
    switch (timeFilter) {
      case 'last_24h': return 'last 24 hours';
      case 'last_7d': return 'last 7 days';
      case 'last_30d': return 'last 30 days';
      case 'last_90d': return 'last 90 days';
      default: return 'all time';
    }
  };

  const exportData = () => {
    const csvContent = [
      ['Agent Name', 'Total Cost', 'Creation Cost', 'Execution Cost', 'Total Runs', 'Success Rate', 'Last Used'],
      ...agentActivities.map(agent => [
        agent.agent_name,
        agent.total_cost.toFixed(4),
        agent.creation_cost.toFixed(4),
        agent.execution_cost.toFixed(4),
        agent.total_runs,
        agent.total_runs > 0 ? `${((agent.successful_runs / agent.total_runs) * 100).toFixed(1)}%` : 'N/A',
        new Date(agent.last_used).toLocaleDateString()
      ])
    ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    
    const dataBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `agent-usage-report-${timeFilter}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto shadow-xl mb-4">
            <Bot className="h-8 w-8 text-white animate-pulse" />
          </div>
          <p className="text-gray-600 font-medium">Loading your agent analytics...</p>
        </div>
      </div>
    );
  }

  if (rawData.length === 0) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-3">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-3xl flex items-center justify-center mx-auto shadow-xl mb-4">
            <Bot className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">
            Agent Usage Dashboard
          </h1>
          <p className="text-gray-600 font-medium">Track your workflow agents and AI spending</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-6">
          <div className="flex items-center justify-between">
            <select
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="last_24h">Last 24 hours</option>
              <option value="last_7d">Last 7 days</option>
              <option value="last_30d">Last 30 days</option>
              <option value="last_90d">Last 90 days</option>
            </select>
            
            <button
              onClick={loadData}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        <div className="text-center py-16 bg-gray-50 rounded-2xl border border-gray-200">
          <Bot className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">No Agent Activity Yet</h3>
          <p className="text-gray-600 max-w-md mx-auto">
            Start creating and running workflow agents to see your usage analytics here
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-3xl flex items-center justify-center mx-auto shadow-xl mb-4">
          <Bot className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900">
          Agent Usage Dashboard
        </h1>
        <p className="text-gray-600 font-medium">Your workflow agents for the {getTimeFilterLabel()}</p>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-6">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="last_24h">Last 24 hours</option>
            <option value="last_7d">Last 7 days</option>
            <option value="last_30d">Last 30 days</option>
            <option value="last_90d">Last 90 days</option>
          </select>

          <div className="flex items-center gap-3">
            <button
              onClick={loadData}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            
            <button
              onClick={exportData}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center">
              <DollarSign className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600 font-medium">Total Spent</p>
              <p className="text-2xl font-bold text-gray-900">{formatCost(totalCost)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-2xl flex items-center justify-center">
              <Bot className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600 font-medium">Agents Created</p>
              <p className="text-2xl font-bold text-gray-900">{totalAgentsCreated}</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-purple-100 rounded-2xl flex items-center justify-center">
              <Play className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600 font-medium">Agent Runs</p>
              <p className="text-2xl font-bold text-gray-900">{totalAgentRuns}</p>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600 font-medium">Success Rate</p>
              <p className="text-2xl font-bold text-gray-900">{successRate.toFixed(1)}%</p>
            </div>
          </div>
        </div>
      </div>

      {/* Agent List */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-6">
        <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-blue-600" />
          Your Workflow Agents
        </h3>
        
        {agentActivities.length === 0 ? (
          <div className="text-center py-8">
            <Bot className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600">No agent data available for this time period</p>
          </div>
        ) : (
          <div className="space-y-4">
            {agentActivities.map((agent, index) => (
              <div key={`${agent.agent_id}-${index}`} className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                      <Bot className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">{agent.agent_name}</h4>
                      <p className="text-sm text-gray-500">ID: {agent.agent_id}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-900">{formatCost(agent.total_cost)}</p>
                    <p className="text-sm text-gray-500">Total Cost</p>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Creation Cost</p>
                    <p className="font-semibold">{formatCost(agent.creation_cost)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Execution Cost</p>
                    <p className="font-semibold">{formatCost(agent.execution_cost)}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Total Runs</p>
                    <p className="font-semibold">{agent.total_runs}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Success Rate</p>
                    <p className="font-semibold flex items-center gap-1">
                      {agent.total_runs > 0 ? (
                        <>
                          {agent.failed_runs > 0 ? (
                            <XCircle className="w-4 h-4 text-red-500" />
                          ) : (
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          )}
                          {((agent.successful_runs / agent.total_runs) * 100).toFixed(1)}%
                        </>
                      ) : (
                        'N/A'
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Last Used</p>
                    <p className="font-semibold">{new Date(agent.last_used).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Daily Activity Chart */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-lg p-6">
        <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-green-600" />
          Daily Activity
        </h3>
        
        {dailyStats.length === 0 ? (
          <div className="text-center py-8">
            <Activity className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600">No daily activity data available</p>
          </div>
        ) : (
          <div className="space-y-4">
            {dailyStats.slice(-14).map((day, index) => {
              const maxCost = Math.max(...dailyStats.map(d => d.total_cost));
              const costWidth = maxCost > 0 ? (day.total_cost / maxCost) * 100 : 0;
              
              return (
                <div key={day.date} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold text-gray-700">
                      {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <div className="text-right">
                      <div className="text-sm font-bold text-gray-900">{formatCost(day.total_cost)}</div>
                    </div>
                  </div>
                  <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(costWidth, 2)}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{day.agents_created} created</span>
                    <span>{day.agents_executed} executed</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default SimpleAgentDashboard;