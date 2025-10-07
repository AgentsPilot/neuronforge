'use client'

import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  DollarSign, 
  Play, 
  Sparkles,
  TrendingUp,
  Calendar,
  RefreshCw,
  Download,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
  BarChart3,
  Activity,
  Target,
  ArrowUp,
  ArrowDown,
  Users,
  FileText,
  MessageSquare,
  Globe,
  Shield,
  AlertTriangle,
  Filter,
  ChevronDown,
  Eye,
  PieChart,
  Star,
  Rocket,
  Award,
  TrendingDown,
  Percent,
  Timer,
  Settings,
  Layers,
  Workflow,
  Brain
} from 'lucide-react';
import { useAuth } from '@/components/UserProvider';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

interface AIUsageData {
  id: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  model_name: string;
  provider: string;
  created_at: string;
  success: boolean;
  latency_ms?: number;
  metadata?: {
    feature?: string;
    component?: string;
    agent_name?: string;
    agent_id?: string;
    execution_type?: string;
    endpoint?: string;
    activity_type?: string;
    activity_name?: string;
  };
  category: string;
  activity_type?: string;
  activity_name?: string;
  agent_id?: string;
}

interface ActivitySummary {
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  count: number;
  cost: number;
  avgLatency: number;
  successRate: number;
  trend: 'up' | 'down' | 'stable';
  trendValue: number;
}

interface AgentSummary {
  id: string;
  name: string;
  totalCost: number;
  totalRuns: number;
  successRate: number;
  lastUsed: string;
  avgLatency: number;
  creationCost: number;
  usageCost: number;
  efficiency: number;
  status: 'excellent' | 'good' | 'needs_attention';
}

const UserFriendlyAgentAnalytics = () => {
  const { user } = useAuth();
  const supabase = createClientComponentClient();
  
  const [timeFilter, setTimeFilter] = useState('last_30d');
  const [loading, setLoading] = useState(true);
  const [rawData, setRawData] = useState<AIUsageData[]>([]);
  const [selectedView, setSelectedView] = useState<'overview' | 'agents' | 'activities' | 'insights'>('overview');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  
  // Enhanced metrics
  const [totalCost, setTotalCost] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);
  const [totalActivities, setTotalActivities] = useState(0);
  const [avgResponseTime, setAvgResponseTime] = useState(0);
  const [overallSuccessRate, setOverallSuccessRate] = useState(0);
  const [efficiency, setEfficiency] = useState(0);
  const [costTrend, setCostTrend] = useState<'up' | 'down' | 'stable'>('stable');
  const [usageTrend, setUsageTrend] = useState<'up' | 'down' | 'stable'>('stable');
  
  // Organized data
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [dailyUsage, setDailyUsage] = useState<any[]>([]);
  const [costBreakdown, setCostBreakdown] = useState<any[]>([]);
  const [insights, setInsights] = useState<any[]>([]);

  const timeFilterOptions = [
    { value: 'last_24h', label: 'Last 24 hours' },
    { value: 'last_7d', label: 'Last 7 days' },
    { value: 'last_30d', label: 'Last 30 days' },
    { value: 'last_90d', label: 'Last 90 days' }
  ];

  const CustomDropdown = ({ value, onChange, options }: { value: string, onChange: (value: string) => void, options: { value: string, label: string }[] }) => {
    const [isOpen, setIsOpen] = useState(false);
    const selectedOption = options.find(opt => opt.value === value);

    return (
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center justify-between w-48 px-4 py-2.5 bg-white/90 backdrop-blur-sm border border-gray-200/60 rounded-xl text-sm font-medium text-gray-700 shadow-sm hover:border-gray-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200"
        >
          <span>{selectedOption?.label}</span>
          <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        
        {isOpen && (
          <>
            <div className="absolute top-full left-0 mt-2 w-full bg-white border border-gray-200/60 rounded-xl shadow-xl overflow-hidden" style={{ position: 'absolute', zIndex: 99999 }}>
              {options.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`w-full px-4 py-2.5 text-left text-sm font-medium transition-colors duration-150 hover:bg-gray-50 ${
                    value === option.value ? 'text-blue-600 bg-blue-50' : 'text-gray-700'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div 
              className="fixed inset-0"
              style={{ zIndex: 99998 }}
              onClick={() => setIsOpen(false)}
            />
          </>
        )}
      </div>
    );
  };

  useEffect(() => {
    if (user) {
      loadAnalyticsData();
    }
  }, [user, timeFilter]);

  const getTimeFilterDate = () => {
    const now = new Date();
    const filterDate = new Date();
    
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
    return filterDate;
  };

  const loadAnalyticsData = async () => {
    if (!user?.id) return;

    setLoading(true);
    try {
      let query = supabase
        .from('token_usage')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (timeFilter !== 'all') {
        const filterDate = getTimeFilterDate();
        query = query.gte('created_at', filterDate.toISOString());
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error loading analytics data:', error);
        return;
      }

      const usageData = data || [];
      setRawData(usageData);
      
      if (usageData.length > 0) {
        processAnalyticsData(usageData);
      } else {
        resetData();
      }

    } catch (error) {
      console.error('Error in loadAnalyticsData:', error);
    } finally {
      setLoading(false);
    }
  };

  const translateTechnicalActivity = (item: AIUsageData) => {
    const feature = item.metadata?.feature || item.category;
    const component = item.metadata?.component;
    const endpoint = item.metadata?.endpoint;
    const activityType = item.activity_type || item.metadata?.activity_type;
    const activityName = item.activity_name || item.metadata?.activity_name;

    if (activityName) {
      return {
        name: activityName,
        type: 'custom_activity'
      };
    }

    if (feature) {
      switch (feature.toLowerCase()) {
        case 'agent_creation':
        case 'agent_builder':
          return { name: 'Creating Smart Agents', type: 'agent_creation' };
        case 'agent_execution':
        case 'agent_run':
          return { name: 'Running Workflows', type: 'agent_execution' };
        case 'prompt_enhancement':
        case 'prompt_clarity':
          return { name: 'Optimizing Prompts', type: 'prompt_enhancement' };
        case 'input_generation':
          return { name: 'Building Input Forms', type: 'input_generation' };
        case 'workflow_analysis':
          return { name: 'Analyzing Performance', type: 'workflow_analysis' };
        default:
          return { name: feature.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), type: 'other' };
      }
    }

    if (component) {
      switch (component.toLowerCase()) {
        case 'smartagentbuilder':
          return { name: 'Building Agents', type: 'agent_creation' };
        case 'agentpreview':
          return { name: 'Previewing Agents', type: 'agent_preview' };
        case 'inputschemaeditor':
          return { name: 'Setting Up Inputs', type: 'input_setup' };
        case 'systemprompteditor':
          return { name: 'Writing Instructions', type: 'prompt_editing' };
        default:
          return { name: component.replace(/([A-Z])/g, ' $1').trim(), type: 'component' };
      }
    }

    if (endpoint) {
      switch (endpoint.toLowerCase()) {
        case 'analyze-prompt-clarity':
          return { name: 'Quality Analysis', type: 'prompt_analysis' };
        case 'enhance-prompt':
          return { name: 'Prompt Enhancement', type: 'prompt_enhancement' };
        case 'generate-input-schema':
          return { name: 'Creating Forms', type: 'input_generation' };
        case 'execute-agent':
          return { name: 'Running Automation', type: 'agent_execution' };
        default:
          return { name: endpoint.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), type: 'api' };
      }
    }

    switch (item.category.toLowerCase()) {
      case 'agent_creation':
        return { name: 'Creating Agents', type: 'agent_creation' };
      case 'agent_execution':
        return { name: 'Running Agents', type: 'agent_execution' };
      case 'general':
        return { name: 'General AI Tasks', type: 'general' };
      default:
        return { name: item.category.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), type: 'other' };
    }
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'agent_creation':
        return <Bot className="w-4 h-4" />;
      case 'agent_execution':
        return <Rocket className="w-4 h-4" />;
      case 'prompt_enhancement':
      case 'prompt_analysis':
        return <Sparkles className="w-4 h-4" />;
      case 'input_generation':
      case 'input_setup':
        return <FileText className="w-4 h-4" />;
      case 'workflow_analysis':
        return <BarChart3 className="w-4 h-4" />;
      case 'prompt_editing':
        return <MessageSquare className="w-4 h-4" />;
      default:
        return <Zap className="w-4 h-4" />;
    }
  };

  const getActivityColors = (type: string) => {
    switch (type) {
      case 'agent_creation':
        return { color: 'text-blue-600', bgColor: 'bg-blue-50/80', borderColor: 'border-blue-200/50' };
      case 'agent_execution':
        return { color: 'text-emerald-600', bgColor: 'bg-emerald-50/80', borderColor: 'border-emerald-200/50' };
      case 'prompt_enhancement':
      case 'prompt_analysis':
        return { color: 'text-purple-600', bgColor: 'bg-purple-50/80', borderColor: 'border-purple-200/50' };
      case 'input_generation':
      case 'input_setup':
        return { color: 'text-orange-600', bgColor: 'bg-orange-50/80', borderColor: 'border-orange-200/50' };
      case 'workflow_analysis':
        return { color: 'text-teal-600', bgColor: 'bg-teal-50/80', borderColor: 'border-teal-200/50' };
      case 'prompt_editing':
        return { color: 'text-pink-600', bgColor: 'bg-pink-50/80', borderColor: 'border-pink-200/50' };
      default:
        return { color: 'text-gray-600', bgColor: 'bg-gray-50/80', borderColor: 'border-gray-200/50' };
    }
  };

  const calculateTrend = (current: number, previous: number): { trend: 'up' | 'down' | 'stable', value: number } => {
    if (previous === 0) return { trend: 'stable', value: 0 };
    const change = ((current - previous) / previous) * 100;
    if (Math.abs(change) < 5) return { trend: 'stable', value: change };
    return { trend: change > 0 ? 'up' : 'down', value: Math.abs(change) };
  };

  const processAnalyticsData = (data: AIUsageData[]) => {
    // Calculate totals
    const cost = data.reduce((sum, item) => sum + parseFloat(item.cost_usd?.toString() || '0'), 0);
    const tokens = data.reduce((sum, item) => sum + (item.total_tokens || 0), 0);
    const activities = data.length;
    
    setTotalCost(cost);
    setTotalTokens(tokens);
    setTotalActivities(activities);

    // Calculate efficiency (success rate weighted by speed)
    const latencies = data.filter(item => item.latency_ms).map(item => item.latency_ms!);
    const avgLatency = latencies.length > 0 ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length : 0;
    setAvgResponseTime(avgLatency);

    const successfulItems = data.filter(item => item.success !== false);
    const successRate = activities > 0 ? (successfulItems.length / activities) * 100 : 100;
    setOverallSuccessRate(successRate);

    // Calculate efficiency score (0-100)
    const speedScore = avgLatency > 0 ? Math.max(0, 100 - (avgLatency / 100)) : 100;
    const efficiencyScore = (successRate * 0.7) + (speedScore * 0.3);
    setEfficiency(efficiencyScore);

    // Calculate trends (comparing current period vs previous period)
    const midpoint = Math.floor(data.length / 2);
    const recentData = data.slice(0, midpoint);
    const previousData = data.slice(midpoint);
    
    const recentCost = recentData.reduce((sum, item) => sum + parseFloat(item.cost_usd?.toString() || '0'), 0);
    const previousCost = previousData.reduce((sum, item) => sum + parseFloat(item.cost_usd?.toString() || '0'), 0);
    const costTrendData = calculateTrend(recentCost, previousCost);
    setCostTrend(costTrendData.trend);

    const usageTrendData = calculateTrend(recentData.length, previousData.length);
    setUsageTrend(usageTrendData.trend);

    // Group by activities with enhanced data
    const activityMap = new Map<string, any>();
    
    data.forEach(item => {
      const activity = translateTechnicalActivity(item);
      const key = activity.name;
      
      if (!activityMap.has(key)) {
        activityMap.set(key, {
          name: activity.name,
          type: activity.type,
          count: 0,
          cost: 0,
          latencies: [],
          successes: 0,
          total: 0
        });
      }

      const activityData = activityMap.get(key);
      activityData.count += 1;
      activityData.cost += parseFloat(item.cost_usd?.toString() || '0');
      activityData.total += 1;
      
      if (item.success !== false) {
        activityData.successes += 1;
      }
      
      if (item.latency_ms) {
        activityData.latencies.push(item.latency_ms);
      }
    });

    // Convert to enhanced ActivitySummary array
    const activitiesSummary = Array.from(activityMap.values()).map(activity => {
      const colors = getActivityColors(activity.type);
      const successRate = activity.total > 0 ? (activity.successes / activity.total) * 100 : 100;
      const avgLatency = activity.latencies.length > 0 
        ? activity.latencies.reduce((sum: number, l: number) => sum + l, 0) / activity.latencies.length 
        : 0;
      
      return {
        name: activity.name,
        description: `${activity.count} operations • ${successRate.toFixed(1)}% success`,
        icon: getActivityIcon(activity.type),
        color: colors.color,
        bgColor: colors.bgColor,
        count: activity.count,
        cost: activity.cost,
        avgLatency,
        successRate,
        trend: 'stable' as const,
        trendValue: 0
      };
    }).sort((a, b) => b.cost - a.cost);

    setActivities(activitiesSummary);

    // Enhanced agent analysis
    const agentMap = new Map<string, any>();
    
    data.forEach(item => {
      const agentName = item.metadata?.agent_name || 'Unknown Agent';
      const agentId = item.metadata?.agent_id || item.agent_id || 'unknown';
      
      if (!agentMap.has(agentId)) {
        agentMap.set(agentId, {
          id: agentId,
          name: agentName,
          totalCost: 0,
          totalRuns: 0,
          successes: 0,
          lastUsed: item.created_at,
          latencies: [],
          creationCost: 0,
          usageCost: 0
        });
      }

      const agent = agentMap.get(agentId);
      agent.totalCost += parseFloat(item.cost_usd?.toString() || '0');
      
      const activity = translateTechnicalActivity(item);
      if (activity.type === 'agent_creation') {
        agent.creationCost += parseFloat(item.cost_usd?.toString() || '0');
      } else if (activity.type === 'agent_execution') {
        agent.usageCost += parseFloat(item.cost_usd?.toString() || '0');
        agent.totalRuns += 1;
        
        if (item.success !== false) {
          agent.successes += 1;
        }
      }

      if (item.latency_ms) {
        agent.latencies.push(item.latency_ms);
      }

      if (new Date(item.created_at) > new Date(agent.lastUsed)) {
        agent.lastUsed = item.created_at;
      }
    });

    const agentsSummary = Array.from(agentMap.values()).map(agent => {
      const successRate = agent.totalRuns > 0 ? (agent.successes / agent.totalRuns) * 100 : 100;
      const avgLatency = agent.latencies.length > 0 
        ? agent.latencies.reduce((sum: number, l: number) => sum + l, 0) / agent.latencies.length 
        : 0;
      
      // Calculate efficiency based on success rate and cost efficiency
      const costEfficiency = agent.totalRuns > 0 ? agent.usageCost / agent.totalRuns : 0;
      const efficiency = successRate * 0.6 + (costEfficiency > 0 ? Math.max(0, 100 - costEfficiency * 1000) : 50) * 0.4;
      
      let status: 'excellent' | 'good' | 'needs_attention' = 'good';
      if (efficiency >= 80) status = 'excellent';
      else if (efficiency < 60) status = 'needs_attention';
      
      return {
        ...agent,
        successRate,
        avgLatency,
        efficiency,
        status
      };
    }).sort((a, b) => b.totalCost - a.totalCost);

    setAgents(agentsSummary);

    // Enhanced daily usage analysis
    const dailyMap = new Map<string, any>();
    
    data.forEach(item => {
      const date = new Date(item.created_at).toISOString().split('T')[0];
      
      if (!dailyMap.has(date)) {
        dailyMap.set(date, {
          date,
          cost: 0,
          activities: 0,
          agents_created: 0,
          agents_run: 0,
          tokens: 0
        });
      }

      const day = dailyMap.get(date);
      day.cost += parseFloat(item.cost_usd?.toString() || '0');
      day.activities += 1;
      day.tokens += item.total_tokens || 0;

      const activity = translateTechnicalActivity(item);
      if (activity.type === 'agent_creation') {
        day.agents_created += 1;
      } else if (activity.type === 'agent_execution') {
        day.agents_run += 1;
      }
    });

    const dailyData = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    setDailyUsage(dailyData);

    // Enhanced cost breakdown
    const costData = activitiesSummary.map(activity => ({
      name: activity.name.replace(/[🤖⚡✨📝📊🔧👁️⚙️📖🔍🚀🎯▶️🧠]/g, '').trim(),
      cost: activity.cost,
      percentage: cost > 0 ? (activity.cost / cost) * 100 : 0,
      color: activity.color,
      bgColor: activity.bgColor
    }));
    setCostBreakdown(costData);

    // Generate insights
    const generatedInsights = generateInsights(activitiesSummary, agentsSummary, dailyData, cost, successRate);
    setInsights(generatedInsights);
  };

  const generateInsights = (activities: any[], agents: any[], daily: any[], totalCost: number, successRate: number) => {
    const insights = [];

    // Cost efficiency insight
    if (totalCost > 0) {
      const avgCostPerActivity = totalCost / activities.reduce((sum, a) => sum + a.count, 0);
      if (avgCostPerActivity < 0.01) {
        insights.push({
          type: 'positive',
          icon: <Award className="w-4 h-4" />,
          title: 'Excellent Cost Efficiency',
          message: `You're spending only $${avgCostPerActivity.toFixed(4)} per AI operation. That's very efficient!`,
          color: 'text-green-600',
          bgColor: 'bg-green-50/80',
          borderColor: 'border-green-200/50'
        });
      }
    }

    // Success rate insight
    if (successRate >= 95) {
      insights.push({
        type: 'positive',
        icon: <Star className="w-4 h-4" />,
        title: 'Outstanding Performance',
        message: `Your agents have a ${successRate.toFixed(1)}% success rate. Excellent work!`,
        color: 'text-blue-600',
        bgColor: 'bg-blue-50/80',
        borderColor: 'border-blue-200/50'
      });
    } else if (successRate < 80) {
      insights.push({
        type: 'warning',
        icon: <AlertTriangle className="w-4 h-4" />,
        title: 'Performance Opportunity',
        message: `Your success rate is ${successRate.toFixed(1)}%. Consider reviewing failed operations for improvements.`,
        color: 'text-orange-600',
        bgColor: 'bg-orange-50/80',
        borderColor: 'border-orange-200/50'
      });
    }

    // Most expensive activity
    if (activities.length > 0) {
      const mostExpensive = activities[0];
      insights.push({
        type: 'info',
        icon: <TrendingUp className="w-4 h-4" />,
        title: 'Top Spending Category',
        message: `${mostExpensive.name.replace(/[🤖⚡✨📝📊🔧👁️⚙️📖🔍🚀🎯▶️🧠]/g, '').trim()} accounts for $${mostExpensive.cost.toFixed(3)} of your AI spending.`,
        color: 'text-purple-600',
        bgColor: 'bg-purple-50/80',
        borderColor: 'border-purple-200/50'
      });
    }

    // Best performing agent
    if (agents.length > 0) {
      const bestAgent = agents.reduce((best, agent) => 
        agent.efficiency > best.efficiency ? agent : best, agents[0]);
      
      if (bestAgent.efficiency >= 80) {
        insights.push({
          type: 'positive',
          icon: <Rocket className="w-4 h-4" />,
          title: 'Top Performing Agent',
          message: `"${bestAgent.name}" is your most efficient agent with ${bestAgent.efficiency.toFixed(1)}% efficiency score.`,
          color: 'text-emerald-600',
          bgColor: 'bg-emerald-50/80',
          borderColor: 'border-emerald-200/50'
        });
      }
    }

    return insights;
  };

  const resetData = () => {
    setTotalCost(0);
    setTotalTokens(0);
    setTotalActivities(0);
    setAvgResponseTime(0);
    setOverallSuccessRate(100);
    setEfficiency(0);
    setActivities([]);
    setAgents([]);
    setDailyUsage([]);
    setCostBreakdown([]);
    setInsights([]);
  };

  const formatCost = (cost: number) => cost >= 1 ? `$${cost.toFixed(2)}` : `$${cost.toFixed(3)}`;
  const formatTokens = (tokens: number) => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return tokens.toLocaleString();
  };
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
      ['Activity Type', 'Count', 'Cost USD', 'Success Rate', 'Avg Response Time'],
      ...activities.map(activity => [
        activity.name.replace(/[🤖⚡✨📝📊🔧👁️⚙️📖🔍🚀🎯▶️🧠]/g, '').trim(),
        activity.count,
        activity.cost.toFixed(4),
        `${activity.successRate.toFixed(1)}%`,
        formatTime(activity.avgLatency)
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto shadow-xl mb-4">
            <Bot className="h-8 w-8 text-white animate-pulse" />
          </div>
          <h3 className="text-lg font-bold text-gray-900 mb-2">Loading Analytics</h3>
          <p className="text-gray-600 text-sm">Analyzing your AI workflow data...</p>
        </div>
      </div>
    );
  }

  if (rawData.length === 0) {
    return (
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto shadow-xl mb-4">
            <Bot className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
            AI Workflow Analytics
          </h1>
          <p className="text-gray-600 mt-2">Your intelligent automation dashboard</p>
        </div>

        {/* Controls */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6">
          <div className="flex items-center justify-between">
            <div className="flex bg-white/90 backdrop-blur-sm border border-gray-200/60 rounded-xl p-1 shadow-sm">
              {[
                { value: 'last_24h', label: '24h' },
                { value: 'last_7d', label: '7d' },
                { value: 'last_30d', label: '30d' },
                { value: 'last_90d', label: '90d' }
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
            
            <button
              onClick={loadAnalyticsData}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all duration-300 font-medium shadow-lg"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Empty State */}
        <div className="text-center py-16 bg-gray-50/80 backdrop-blur-sm rounded-2xl border border-gray-200/50">
          <Bot className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">Ready to Start</h3>
          <p className="text-gray-600 max-w-md mx-auto">
            Create your first workflow agent to unlock powerful AI analytics
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto shadow-xl mb-4">
          <Bot className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
          AI Workflow Analytics
        </h1>
        <p className="text-gray-600 mt-2">Your automation insights for the {getTimeFilterLabel()}</p>
      </div>

      {/* Controls */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex bg-white/90 backdrop-blur-sm border border-gray-200/60 rounded-xl p-1 shadow-sm">
              {[
                { value: 'last_24h', label: '24h' },
                { value: 'last_7d', label: '7d' },
                { value: 'last_30d', label: '30d' },
                { value: 'last_90d', label: '90d' }
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

            <div className="flex bg-gray-100/80 rounded-xl p-1">
              {[
                { key: 'overview', label: 'Overview', icon: BarChart3 },
                { key: 'insights', label: 'Insights', icon: Brain },
                { key: 'activities', label: 'Activities', icon: Activity },
                { key: 'agents', label: 'Agents', icon: Bot }
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setSelectedView(key as any)}
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

          <div className="flex items-center gap-3">
            <button
              onClick={loadAnalyticsData}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all duration-300 text-sm font-medium shadow-lg"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            
            <button
              onClick={exportData}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-all duration-300 text-sm font-medium bg-white/80"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-1 bg-white/80 backdrop-blur-sm p-5 rounded-2xl border border-gray-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center shadow-lg">
              <DollarSign className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-xs text-gray-600 font-medium mb-1">AI Investment</p>
              <p className="text-xl font-bold text-gray-900">{formatCost(totalCost)}</p>
              <div className="flex items-center gap-1">
                {costTrend === 'up' ? (
                  <ArrowUp className="w-3 h-3 text-red-500" />
                ) : costTrend === 'down' ? (
                  <ArrowDown className="w-3 h-3 text-green-500" />
                ) : null}
                <span className="text-xs text-gray-500">vs previous</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-sm p-5 rounded-2xl border border-gray-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="text-center">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center mx-auto mb-3 shadow-lg">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <p className="text-xs text-gray-600 font-medium mb-1">Tokens</p>
            <p className="text-lg font-bold text-gray-900">{formatTokens(totalTokens)}</p>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-sm p-5 rounded-2xl border border-gray-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="text-center">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center mx-auto mb-3 shadow-lg">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <p className="text-xs text-gray-600 font-medium mb-1">Operations</p>
            <p className="text-lg font-bold text-gray-900">{totalActivities}</p>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-sm p-5 rounded-2xl border border-gray-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="text-center">
            <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center mx-auto mb-3 shadow-lg">
              <Timer className="h-5 w-5 text-white" />
            </div>
            <p className="text-xs text-gray-600 font-medium mb-1">Speed</p>
            <p className="text-lg font-bold text-gray-900">{formatTime(avgResponseTime)}</p>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-sm p-5 rounded-2xl border border-gray-200/50 shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="text-center">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center mx-auto mb-3 shadow-lg">
              <CheckCircle className="h-5 w-5 text-white" />
            </div>
            <p className="text-xs text-gray-600 font-medium mb-1">Success</p>
            <p className="text-lg font-bold text-gray-900">{overallSuccessRate.toFixed(1)}%</p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      {selectedView === 'overview' && (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Daily Activity */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Daily Activity</h3>
                <p className="text-sm text-gray-600">AI usage trends</p>
              </div>
            </div>
            
            {dailyUsage.length === 0 ? (
              <div className="text-center py-8">
                <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">No daily data available</p>
              </div>
            ) : (
              <div className="space-y-4">
                {dailyUsage.slice(-7).map((day, index) => {
                  const maxCost = Math.max(...dailyUsage.map(d => d.cost));
                  const costWidth = maxCost > 0 ? (day.cost / maxCost) * 100 : 0;
                  
                  return (
                    <div key={day.date} className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium text-gray-700">
                          {new Date(day.date).toLocaleDateString('en-US', { 
                            weekday: 'short', 
                            month: 'short', 
                            day: 'numeric' 
                          })}
                        </span>
                        <div className="text-right">
                          <div className="font-bold text-gray-900">{formatCost(day.cost)}</div>
                          <div className="text-xs text-gray-500">{formatTokens(day.tokens)} tokens</div>
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
                        <span>{day.agents_run} executed</span>
                        <span>{day.activities} total</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cost Breakdown */}
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center">
                <PieChart className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900">Spending Analysis</h3>
                <p className="text-sm text-gray-600">Where your budget goes</p>
              </div>
            </div>
            
            {costBreakdown.length === 0 ? (
              <div className="text-center py-8">
                <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">No cost data available</p>
              </div>
            ) : (
              <div className="space-y-3">
                {costBreakdown.slice(0, 5).map((item, index) => (
                  <div key={index} className="group hover:bg-gray-50/50 rounded-xl p-3 transition-all duration-200">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded ${item.bgColor}`}></div>
                        <span className="text-sm font-medium text-gray-700">{item.name}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-gray-900">{formatCost(item.cost)}</div>
                        <div className="text-xs text-gray-500">{item.percentage.toFixed(1)}%</div>
                      </div>
                    </div>
                    <div className="bg-gray-100 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className={`h-1.5 rounded-full transition-all duration-500 ${item.bgColor}`}
                        style={{ width: `${item.percentage}%` }}
                      ></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {selectedView === 'insights' && (
        <div className="space-y-6">
          {insights.length === 0 ? (
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-12 text-center">
              <Brain className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-gray-900 mb-2">Generating Insights</h3>
              <p className="text-gray-600">Create more agents to unlock AI-powered insights</p>
            </div>
          ) : (
            <div className="grid lg:grid-cols-2 gap-4">
              {insights.map((insight, index) => (
                <div key={index} className={`${insight.bgColor} backdrop-blur-sm rounded-2xl border ${insight.borderColor} shadow-lg p-6 hover:shadow-xl transition-all duration-300`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 ${insight.color.replace('text-', 'bg-').replace('600', '100')} rounded-lg flex items-center justify-center ${insight.color}`}>
                      {insight.icon}
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold text-gray-900 mb-1">{insight.title}</h4>
                      <p className="text-gray-700 text-sm leading-relaxed">{insight.message}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedView === 'activities' && (
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900">AI Activities</h3>
              <p className="text-gray-600">Breakdown of your AI operations</p>
            </div>
          </div>
          
          {activities.length === 0 ? (
            <div className="text-center py-12">
              <Activity className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h4 className="text-lg font-bold text-gray-900 mb-2">No Activities Yet</h4>
              <p className="text-gray-600">Start using AI features to see analytics</p>
            </div>
          ) : (
            <div className="space-y-4">
              {activities.map((activity, index) => (
                <div key={index} className="border border-gray-200/50 rounded-xl p-4 hover:shadow-md transition-all duration-200">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 ${activity.color.replace('text-', 'bg-').replace('600', '100')} rounded-lg flex items-center justify-center ${activity.color}`}>
                        {activity.icon}
                      </div>
                      <div>
                        <h4 className="font-bold text-gray-900">{activity.name}</h4>
                        <p className="text-sm text-gray-600">{activity.description}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-gray-900">{formatCost(activity.cost)}</p>
                      <p className="text-sm text-gray-600">{activity.count} operations</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="text-center">
                      <p className="text-xs text-gray-500 mb-1">Success Rate</p>
                      <div className="flex items-center justify-center gap-1">
                        {activity.successRate >= 95 ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : activity.successRate >= 80 ? (
                          <AlertTriangle className="w-4 h-4 text-yellow-500" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500" />
                        )}
                        <span className="font-bold text-gray-900">{activity.successRate.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-500 mb-1">Avg Response</p>
                      <p className="font-bold text-gray-900">{formatTime(activity.avgLatency)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-500 mb-1">Cost/Operation</p>
                      <p className="font-bold text-gray-900">{formatCost(activity.cost / activity.count)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedView === 'agents' && (
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900">Workflow Agents</h3>
              <p className="text-gray-600">Performance analytics for your AI agents</p>
            </div>
          </div>
          
          {agents.length === 0 ? (
            <div className="text-center py-12">
              <Bot className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h4 className="text-lg font-bold text-gray-900 mb-2">No Agents Created Yet</h4>
              <p className="text-gray-600">Build your first workflow agent to see metrics</p>
            </div>
          ) : (
            <div className="space-y-4">
              {agents.map((agent, index) => (
                <div key={agent.id || index} className="border border-gray-200/50 rounded-xl p-4 hover:shadow-md transition-all duration-200">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-lg ${
                        agent.status === 'excellent' ? 'bg-gradient-to-br from-green-500 to-emerald-600' :
                        agent.status === 'good' ? 'bg-gradient-to-br from-blue-500 to-indigo-600' :
                        'bg-gradient-to-br from-orange-500 to-red-600'
                      }`}>
                        <Bot className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h4 className="font-bold text-gray-900">{agent.name}</h4>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-500">ID: {agent.id}</span>
                          <div className={`px-2 py-1 rounded-lg text-xs font-bold ${
                            agent.status === 'excellent' ? 'bg-green-100 text-green-700' :
                            agent.status === 'good' ? 'bg-blue-100 text-blue-700' :
                            'bg-orange-100 text-orange-700'
                          }`}>
                            {agent.status === 'excellent' ? 'Excellent' :
                             agent.status === 'good' ? 'Good' : 'Needs Attention'}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-gray-900">{formatCost(agent.totalCost)}</p>
                      <p className="text-sm text-gray-500">Total Investment</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                    <div className="text-center">
                      <p className="text-xs text-gray-500 mb-1">Creation</p>
                      <p className="font-bold text-gray-900">{formatCost(agent.creationCost)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-500 mb-1">Usage</p>
                      <p className="font-bold text-gray-900">{formatCost(agent.usageCost)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-500 mb-1">Runs</p>
                      <p className="font-bold text-gray-900">{agent.totalRuns}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-500 mb-1">Success</p>
                      <div className="flex items-center justify-center gap-1">
                        {agent.totalRuns > 0 ? (
                          <>
                            {agent.successRate >= 95 ? (
                              <CheckCircle className="w-3 h-3 text-green-500" />
                            ) : agent.successRate >= 80 ? (
                              <AlertTriangle className="w-3 h-3 text-yellow-500" />
                            ) : (
                              <XCircle className="w-3 h-3 text-red-500" />
                            )}
                            <span className="font-bold text-gray-900">{agent.successRate.toFixed(1)}%</span>
                          </>
                        ) : (
                          <span className="font-bold text-gray-500">N/A</span>
                        )}
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-500 mb-1">Efficiency</p>
                      <p className="font-bold text-gray-900">{agent.efficiency.toFixed(0)}%</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-gray-500 mb-1">Last Used</p>
                      <p className="font-bold text-gray-900">{new Date(agent.lastUsed).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default UserFriendlyAgentAnalytics;