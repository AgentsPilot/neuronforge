// lib/hooks/useAnalyticsData.ts

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/UserProvider';
import { supabase } from '@/lib/supabaseClient';
import { processAnalyticsData } from '@/lib/utils/analyticsHelpers';
import type { AIUsageData, TimeFilter, ProcessedAnalyticsData } from '@/types/analytics';

export const useAnalyticsData = (timeFilter: TimeFilter) => {
  const [loading, setLoading] = useState(true);
  const [allRawData, setAllRawData] = useState<AIUsageData[]>([]); // Store ALL data
  const [rawData, setRawData] = useState<AIUsageData[]>([]); // Filtered data
  const [processedData, setProcessedData] = useState<ProcessedAnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { user } = useAuth();

  const loadAnalyticsData = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    try {
      console.log(`📊 Analytics Data Load Started - Fetching ALL data for user: ${user.id}`);

      // Load ALL token_usage data (no time filter on initial fetch)
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
      const enrichedUsageData: AIUsageData[] = usageData.map(item => ({
        ...item,
        agent_name: item.agent_id && agentNameMap[item.agent_id]
          ? agentNameMap[item.agent_id]
          : undefined
      }));

      // Store ALL data (unfiltered) along with agents list
      setAllRawData(enrichedUsageData);

      // Store agents list in state for filtering
      (window as any).__allAgentsList = allAgentsList;

      // Debug log to understand data structure
      if (enrichedUsageData.length > 0) {
        console.log('✅ Analytics ALL data loaded:', {
          totalRecords: enrichedUsageData.length,
          recordsWithAgentNames: enrichedUsageData.filter(item => item.agent_name).length,
          sampleAgentName: enrichedUsageData.find(item => item.agent_name)?.agent_name
        });
      }

    } catch (error) {
      console.error('Error in loadAnalyticsData:', error);
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }, [user]); // Only depends on user, not timeFilter!

  // Load data only on mount
  useEffect(() => {
    if (user) {
      loadAnalyticsData();
    }
  }, [user, loadAnalyticsData]);

  // Filter data client-side when timeFilter changes (like Audit Trail)
  useEffect(() => {
    if (allRawData.length === 0) {
      setRawData([]);
      setProcessedData(null);
      return;
    }

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
      case 'last_year':
        cutoffDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        break;
      case 'all':
        cutoffDate = new Date(0);
        break;
    }

    const filtered = timeFilter === 'all'
      ? allRawData
      : allRawData.filter(item => new Date(item.created_at) >= cutoffDate);

    console.log('📊 Analytics Client-Side Filter:', {
      timeFilter,
      cutoffDate: cutoffDate.toISOString(),
      allDataCount: allRawData.length,
      filteredCount: filtered.length
    });

    setRawData(filtered);

    // Process the filtered data
    const allAgentsList = (window as any).__allAgentsList || [];
    const processed = processAnalyticsData(filtered, allAgentsList);
    setProcessedData(processed);

  }, [timeFilter, allRawData]);

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