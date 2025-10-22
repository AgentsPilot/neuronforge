// lib/hooks/useAnalyticsData.ts

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/UserProvider';
import { supabase } from '@/lib/supabaseClient';
import { processAnalyticsData } from '@/lib/utils/analyticsHelpers';
import type { AIUsageData, TimeFilter, ProcessedAnalyticsData } from '@/types/analytics';

const getTimeFilterDate = (timeFilter: TimeFilter): Date => {
  const now = new Date();
  switch (timeFilter) {
    case 'last_7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'last_30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case 'last_90d':
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case 'last_year':
      return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    default:
      return new Date(0);
  }
};

export const useAnalyticsData = (timeFilter: TimeFilter) => {
  const [loading, setLoading] = useState(true);
  const [rawData, setRawData] = useState<AIUsageData[]>([]);
  const [processedData, setProcessedData] = useState<ProcessedAnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const { user } = useAuth();

  const loadAnalyticsData = async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      console.log(`Loading analytics data for user ${user.id} with filter ${timeFilter}`);

      // Load token_usage data first, then fetch agent names separately
      let query = supabase
        .from('token_usage')
        .select(`
          id,
          cost_usd,
          input_tokens,
          output_tokens,
          total_tokens,
          model_name,
          provider,
          created_at,
          success,
          latency_ms,
          metadata,
          category,
          activity_type,
          activity_name,
          agent_id,
          feature,
          component,
          endpoint,
          session_id
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (timeFilter !== 'all') {
        const filterDate = getTimeFilterDate(timeFilter);
        query = query.gte('created_at', filterDate.toISOString());
      }

      const { data, error: queryError } = await query;

      if (queryError) {
        console.error('Error loading analytics data:', queryError);
        setError('Failed to load analytics data');
        return;
      }

      const usageData = data || [];

      // Fetch ALL user's agents (including archived) to show active/inactive/archived status
      console.log('Fetching all agents for user:', user.id);

      const { data: allAgents, error: agentError } = await supabase
        .from('agents')
        .select('id, agent_name, created_at, is_archived')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      let agentNameMap: Record<string, string> = {};
      let allAgentsList: Array<{ id: string; agent_name: string; created_at: string; is_archived?: boolean }> = [];

      if (agentError) {
        console.error('Error fetching agents:', agentError);
      } else if (allAgents) {
        allAgentsList = allAgents;
        agentNameMap = allAgents.reduce((map, agent) => {
          if (agent.agent_name) {
            map[agent.id] = agent.agent_name;
          }
          return map;
        }, {} as Record<string, string>);

        console.log('All agents fetched:', {
          totalAgents: allAgents.length,
          agentsWithUsage: usageData.filter(item => item.agent_id && agentNameMap[item.agent_id]).length
        });
      }

      // Merge agent names into usage data
      const enrichedUsageData = usageData.map(item => ({
        ...item,
        agent_name: item.agent_id && agentNameMap[item.agent_id] 
          ? agentNameMap[item.agent_id] 
          : null
      }));

      setRawData(enrichedUsageData);
      
      // Debug log to understand data structure
      if (enrichedUsageData.length > 0) {
        console.log('Analytics data loaded:', {
          totalRecords: enrichedUsageData.length,
          recordsWithAgentNames: enrichedUsageData.filter(item => item.agent_name).length,
          sampleAgentName: enrichedUsageData.find(item => item.agent_name)?.agent_name,
          timeFilter: timeFilter
        });
        
        console.log('Sample analytics data with agent names:', enrichedUsageData.slice(0, 3).map(item => ({
          id: item.id,
          agent_id: item.agent_id,
          agent_name: item.agent_name,
          activity_name: item.activity_name,
          category: item.category
        })));
      }

      // Process the data with all agents list
      const processed = processAnalyticsData(enrichedUsageData, allAgentsList);
      setProcessedData(processed);

    } catch (error) {
      console.error('Error in loadAnalyticsData:', error);
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  // Load data when user or timeFilter changes
  useEffect(() => {
    if (user) {
      loadAnalyticsData();
    }
  }, [user, timeFilter]);

  // Helper function to export data
  const exportData = () => {
    if (!processedData?.activities) return;

    const csvContent = [
      ['Activity Type', 'Count', 'Cost USD', 'Success Rate', 'Avg Response Time'],
      ...processedData.activities.map(activity => [
        activity.name.replace(/[🤖⚡✨📝📊🔧👁️⚙️📖🔍🚀🎯▶️🧠]/g, '').trim(),
        activity.count,
        activity.cost.toFixed(4),
        `${activity.successRate.toFixed(1)}%`,
        activity.avgLatency < 1000 ? `${activity.avgLatency.toFixed(0)}ms` : `${(activity.avgLatency/1000).toFixed(1)}s`
      ])
    ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    
    const dataBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ai-usage-report-${timeFilter}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return {
    loading,
    rawData,
    processedData,
    error,
    refetch: loadAnalyticsData,
    exportData
  };
};