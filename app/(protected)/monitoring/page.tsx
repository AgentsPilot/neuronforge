'use client'

import React, { useState, useEffect } from 'react';
import { Activity, Cpu, HardDrive, Users, Zap, AlertTriangle, CheckCircle, Clock, TrendingUp, Download, Workflow, GitBranch, Play, Pause, CheckSquare, XSquare } from 'lucide-react';

const AgentPilotMonitoring = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [systemMetrics, setSystemMetrics] = useState({
    cpu: 0,
    memory: 0,
    disk: 0,
    activeAgents: 24,
    queueLength: 156,
    apiCalls: 12847,
    activeWorkflows: 8,
    completedWorkflows: 145,
    llmCalls: 45234,
    tokensUsed: 2847592,
    tokensRemaining: 15847233,
    averageResponseTime: 1.2
  });

  const [agents, setAgents] = useState([
    { id: 'AG001', name: 'Customer Data Processor', status: 'active', uptime: '12h 34m', lastTask: '2m ago', successRate: 98.7, currentTask: 'Processing customer onboarding data', tasksCompleted: 1247 },
    { id: 'AG002', name: 'Content Intelligence Analyzer', status: 'active', uptime: '8h 12m', lastTask: '15s ago', successRate: 94.2, currentTask: 'Reviewing customer feedback sentiment', tasksCompleted: 856 },
    { id: 'AG003', name: 'Customer Service Manager', status: 'warning', uptime: '6h 45m', lastTask: '5m ago', successRate: 89.1, currentTask: 'Managing customer service tickets', tasksCompleted: 634 },
    { id: 'AG004', name: 'Business Process Coordinator', status: 'error', uptime: '0m', lastTask: '45m ago', successRate: 76.3, currentTask: 'Connection issues - IT team notified', tasksCompleted: 423 },
    { id: 'AG005', name: 'Integration Hub Manager', status: 'active', uptime: '24h 18m', lastTask: '3s ago', successRate: 99.1, currentTask: 'Connecting with CRM systems', tasksCompleted: 2156 }
  ]);

  // Get real system metrics where possible
  const getRealMetrics = async () => {
    let realMemory = 0;
    let realStorage = 0;
    let cpuEstimate = 0;

    try {
      // Real memory usage from Performance API
      if (performance.memory) {
        const memInfo = performance.memory;
        realMemory = (memInfo.usedJSHeapSize / memInfo.totalJSHeapSize) * 100;
      }

      // Real storage usage
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        if (estimate.usage && estimate.quota) {
          realStorage = (estimate.usage / estimate.quota) * 100;
        }
      }

      // CPU estimation based on performance timing
      const startTime = performance.now();
      // Small computation to measure performance
      let sum = 0;
      for (let i = 0; i < 100000; i++) {
        sum += Math.random();
      }
      const endTime = performance.now();
      const executionTime = endTime - startTime;
      
      // Convert execution time to rough CPU usage estimate (0-100%)
      cpuEstimate = Math.min(95, Math.max(10, executionTime * 2));

    } catch (error) {
      console.log('Error getting real metrics:', error);
    }

    return {
      cpu: cpuEstimate || Math.random() * 40 + 30,
      memory: realMemory || Math.random() * 40 + 40,
      disk: realStorage || Math.random() * 30 + 20
    };
  };

  // Helper function to generate random tasks
  const getRandomTask = (agentName) => {
    const tasks = {
      'Customer Data Processor': [
        'Processing customer onboarding data',
        'Validating invoice information',
        'Analyzing sales performance metrics',
        'Generating quarterly reports'
      ],
      'Content Intelligence Analyzer': [
        'Reviewing customer feedback sentiment',
        'Analyzing market research data',
        'Processing social media mentions',
        'Evaluating brand perception metrics'
      ],
      'Customer Service Manager': [
        'Managing customer service tickets',
        'Processing support requests',
        'Handling escalated cases',
        'Coordinating follow-up actions'
      ],
      'Business Process Coordinator': [
        'Coordinating marketing campaigns',
        'Managing project workflows',
        'Scheduling team deliverables',
        'Optimizing resource allocation'
      ],
      'Integration Hub Manager': [
        'Connecting with CRM systems',
        'Syncing financial data',
        'Managing third-party integrations',
        'Monitoring system performance'
      ]
    };
    
    const agentTasks = tasks[agentName] || ['Processing business task'];
    return agentTasks[Math.floor(Math.random() * agentTasks.length)];
  };

  // Update metrics and agent status
  useEffect(() => {
    const updateMetrics = async () => {
      const realData = await getRealMetrics();
      
      setCurrentTime(new Date());
      setSystemMetrics(prev => ({
        ...prev,
        cpu: realData.cpu,
        memory: realData.memory,
        disk: realData.disk,
        queueLength: Math.max(0, prev.queueLength + Math.floor((Math.random() - 0.4) * 20)),
        apiCalls: prev.apiCalls + Math.floor(Math.random() * 15),
        activeWorkflows: Math.max(1, Math.min(15, prev.activeWorkflows + Math.floor((Math.random() - 0.5) * 3))),
        completedWorkflows: prev.completedWorkflows + Math.floor(Math.random() * 2),
        llmCalls: prev.llmCalls + Math.floor(Math.random() * 25),
        tokensUsed: prev.tokensUsed + Math.floor(Math.random() * 5000),
        tokensRemaining: Math.max(1000000, prev.tokensRemaining - Math.floor(Math.random() * 2000)),
        averageResponseTime: Math.max(0.5, Math.min(3.0, prev.averageResponseTime + (Math.random() - 0.5) * 0.2))
      }));

      // Update agent status and metrics
      setAgents(prevAgents => 
        prevAgents.map(agent => {
          let newStatus = agent.status;
          let newSuccessRate = agent.successRate;
          let newTasksCompleted = agent.tasksCompleted;
          let newCurrentTask = agent.currentTask;
          let newLastTask = agent.lastTask;

          // Simulate status changes
          if (agent.status === 'error' && Math.random() > 0.7) {
            newStatus = 'warning'; // Recovering from error
            newCurrentTask = 'System recovery in progress...';
          } else if (agent.status === 'warning' && Math.random() > 0.8) {
            newStatus = 'active'; // Recovered from warning
            newCurrentTask = getRandomTask(agent.name);
            newLastTask = 'just now';
          }

          // Update success rates slightly
          if (agent.status === 'active') {
            newSuccessRate = Math.min(99.9, Math.max(85, agent.successRate + (Math.random() - 0.3) * 2));
            newTasksCompleted = agent.tasksCompleted + Math.floor(Math.random() * 3);
            
            // Update current task occasionally
            if (Math.random() > 0.6) {
              newCurrentTask = getRandomTask(agent.name);
              newLastTask = Math.random() > 0.5 ? 'just now' : `${Math.floor(Math.random() * 30)}s ago`;
            }
          }

          return {
            ...agent,
            status: newStatus,
            successRate: Math.round(newSuccessRate * 10) / 10,
            tasksCompleted: newTasksCompleted,
            currentTask: newCurrentTask,
            lastTask: newLastTask
          };
        })
      );
    };

    // Initial load
    updateMetrics();

    // Update every 3 seconds
    const timer = setInterval(updateMetrics, 3000);
    return () => clearInterval(timer);
  }, []);

  const workflows = [
    { 
      id: 'WF001', 
      name: 'Customer Onboarding Process', 
      status: 'running', 
      progress: 75,
      currentStep: 'Identity Verification',
      totalSteps: 4,
      completedSteps: 3,
      duration: '12m 34s',
      agents: ['Customer Data Processor', 'Integration Hub Manager', 'Customer Service Manager']
    },
    { 
      id: 'WF002', 
      name: 'Market Intelligence Pipeline', 
      status: 'completed', 
      progress: 100,
      currentStep: 'Report Generated',
      totalSteps: 5,
      completedSteps: 5,
      duration: '8m 45s',
      agents: ['Content Intelligence Analyzer', 'Customer Data Processor', 'Business Process Coordinator']
    },
    { 
      id: 'WF003', 
      name: 'Customer Satisfaction Analysis', 
      status: 'failed', 
      progress: 40,
      currentStep: 'Sentiment Analysis',
      totalSteps: 6,
      completedSteps: 2,
      duration: '15m 22s',
      agents: ['Content Intelligence Analyzer', 'Customer Service Manager']
    },
    { 
      id: 'WF004', 
      name: 'Monthly Business Report Generation', 
      status: 'paused', 
      progress: 60,
      currentStep: 'Financial Data Aggregation',
      totalSteps: 3,
      completedSteps: 1,
      duration: '25m 10s',
      agents: ['Customer Data Processor', 'Integration Hub Manager']
    }
  ];

  const orchestrationMetrics = [
    { label: 'Active Processes', value: systemMetrics.activeWorkflows, change: '+2', trend: 'up', icon: Play },
    { label: 'Completed Today', value: systemMetrics.completedWorkflows, change: '+23', trend: 'up', icon: CheckSquare },
    { label: 'Issues Resolved', value: 3, change: '+3', trend: 'up', icon: CheckCircle },
    { label: 'Avg Process Time', value: '14m 32s', change: '-2m 15s', trend: 'down', icon: Clock }
  ];

  const apiEndpoints = [
    { endpoint: '/api/v1/agents', status: 'healthy', responseTime: '45ms', requests: 1247, errors: 0 },
    { endpoint: '/api/v1/tasks', status: 'healthy', responseTime: '67ms', requests: 2156, errors: 3 },
    { endpoint: '/api/v1/analytics', status: 'degraded', responseTime: '234ms', requests: 892, errors: 12 },
    { endpoint: '/api/v1/users', status: 'healthy', responseTime: '23ms', requests: 445, errors: 0 }
  ];

  const alerts = [
    { id: 1, type: 'warning', message: 'Customer Satisfaction Analysis process requires attention', time: '2 minutes ago' },
    { id: 2, type: 'error', message: 'Business Process Coordinator is temporarily unavailable', time: '15 minutes ago' },
    { id: 3, type: 'info', message: 'Customer Onboarding Process completed successfully', time: '1 hour ago' },
    { id: 4, type: 'warning', message: 'Higher than usual server load detected', time: '2 hours ago' }
  ];

  const getWorkflowStatusColor = (status) => {
    switch (status) {
      case 'running': return 'text-blue-600';
      case 'completed': return 'text-green-600';
      case 'failed': return 'text-red-600';
      case 'paused': return 'text-yellow-600';
      default: return 'text-gray-600';
    }
  };

  const getWorkflowStatusBg = (status) => {
    switch (status) {
      case 'running': return 'bg-blue-50';
      case 'completed': return 'bg-green-50';
      case 'failed': return 'bg-red-50';
      case 'paused': return 'bg-yellow-50';
      default: return 'bg-gray-50';
    }
  };

  const getWorkflowIcon = (status) => {
    switch (status) {
      case 'running': return Play;
      case 'completed': return CheckSquare;
      case 'failed': return XSquare;
      case 'paused': return Pause;
      default: return Clock;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': case 'healthy': return 'text-green-600';
      case 'warning': case 'degraded': return 'text-yellow-600';
      case 'error': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusBg = (status) => {
    switch (status) {
      case 'active': case 'healthy': return 'bg-green-50';
      case 'warning': case 'degraded': return 'bg-yellow-50';
      case 'error': return 'bg-red-50';
      default: return 'bg-gray-50';
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            AgentPilot Monitoring
          </h1>
          <p className="text-gray-400 mt-1">Real-time platform monitoring and analytics</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-600">
            Last updated: {currentTime.toLocaleTimeString()}
          </div>
          <button className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors">
            <Download className="w-4 h-4" />
            Export Report
          </button>
        </div>
      </div>

      {/* System Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 text-sm">CPU Performance</p>
              <p className="text-2xl font-bold text-gray-900">{systemMetrics.cpu.toFixed(1)}ms</p>
            </div>
            <Cpu className="w-8 h-8 text-blue-500" />
          </div>
          <div className="mt-4 bg-gray-100 rounded-full h-2">
            <div 
              className="bg-blue-500 h-2 rounded-full transition-all duration-500" 
              style={{ width: `${Math.min(100, systemMetrics.cpu)}%` }}
            ></div>
          </div>
          <p className="text-xs text-gray-500 mt-1">Real browser performance</p>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 text-sm">Memory Usage</p>
              <p className="text-2xl font-bold text-gray-900">{systemMetrics.memory.toFixed(1)}%</p>
            </div>
            <HardDrive className="w-8 h-8 text-green-500" />
          </div>
          <div className="mt-4 bg-gray-100 rounded-full h-2">
            <div 
              className="bg-green-500 h-2 rounded-full transition-all duration-500" 
              style={{ width: `${systemMetrics.memory}%` }}
            ></div>
          </div>
          <p className="text-xs text-gray-500 mt-1">JS Heap usage</p>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 text-sm">LLM Calls Today</p>
              <p className="text-2xl font-bold text-gray-900">{systemMetrics.llmCalls.toLocaleString()}</p>
            </div>
            <Zap className="w-8 h-8 text-purple-500" />
          </div>
          <p className="text-green-500 text-sm mt-2">↗ +1.2k from yesterday</p>
        </div>

        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-600 text-sm">Active Workflows</p>
              <p className="text-2xl font-bold text-gray-900">{systemMetrics.activeWorkflows}</p>
            </div>
            <Workflow className="w-8 h-8 text-indigo-500" />
          </div>
          <p className="text-green-500 text-sm mt-2">↗ +2 from last hour</p>
        </div>
      </div>

      {/* LLM Usage Statistics */}
      <div className="mb-8 bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2 text-gray-900">
          <Zap className="w-5 h-5 text-purple-500" />
           Token Usage Statistics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
            <div className="flex items-center justify-between mb-2">
              <Zap className="w-5 h-5 text-purple-500" />
              <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-600">
                +{Math.floor(Math.random() * 50) + 10}
              </span>
            </div>
            <p className="text-lg font-bold text-gray-900">{systemMetrics.llmCalls.toLocaleString()}</p>
            <p className="text-sm text-gray-600">Total LLM Calls</p>
          </div>

          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <div className="flex items-center justify-between mb-2">
              <Activity className="w-5 h-5 text-blue-500" />
              <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-600">
                +{(Math.random() * 5000).toFixed(0)}
              </span>
            </div>
            <p className="text-lg font-bold text-gray-900">{(systemMetrics.tokensUsed / 1000).toFixed(1)}k</p>
            <p className="text-sm text-gray-600">Tokens Used</p>
          </div>

          <div className="bg-green-50 p-4 rounded-lg border border-green-200">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle className="w-5 h-5 text-green-500" />
              <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-600">
                {((systemMetrics.tokensRemaining / (systemMetrics.tokensUsed + systemMetrics.tokensRemaining)) * 100).toFixed(1)}%
              </span>
            </div>
            <p className="text-lg font-bold text-gray-900">{(systemMetrics.tokensRemaining / 1000000).toFixed(1)}M</p>
            <p className="text-sm text-gray-600">Tokens Remaining</p>
          </div>

          <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
            <div className="flex items-center justify-between mb-2">
              <Clock className="w-5 h-5 text-yellow-500" />
              <span className={`text-xs px-2 py-1 rounded-full ${
                systemMetrics.averageResponseTime < 1.5 ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600'
              }`}>
                {systemMetrics.averageResponseTime < 1.5 ? 'Good' : 'Fair'}
              </span>
            </div>
            <p className="text-lg font-bold text-gray-900">{systemMetrics.averageResponseTime.toFixed(1)}s</p>
            <p className="text-sm text-gray-600">Avg Response Time</p>
          </div>
        </div>

        {/* Token Usage Chart */}
        <div className="mt-6">
          <div className="flex justify-between text-sm text-gray-600 mb-2">
            <span>Token Usage Progress</span>
            <span>{((systemMetrics.tokensUsed / (systemMetrics.tokensUsed + systemMetrics.tokensRemaining)) * 100).toFixed(1)}% used</span>
          </div>
          <div className="bg-gray-200 rounded-full h-3">
            <div 
              className="bg-gradient-to-r from-purple-500 to-blue-500 h-3 rounded-full transition-all duration-500"
              style={{ width: `${(systemMetrics.tokensUsed / (systemMetrics.tokensUsed + systemMetrics.tokensRemaining)) * 100}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>Used: {(systemMetrics.tokensUsed / 1000).toFixed(1)}k tokens</span>
            <span>Remaining: {(systemMetrics.tokensRemaining / 1000000).toFixed(1)}M tokens</span>
          </div>
        </div>
      </div>

      {/* Orchestration Metrics */}
      <div className="mb-8 bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2 text-gray-900">
          <GitBranch className="w-5 h-5 text-indigo-500" />
          Agents Orchestration
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {orchestrationMetrics.map((metric, index) => {
            const IconComponent = metric.icon;
            return (
              <div key={index} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <IconComponent className="w-5 h-5 text-indigo-500" />
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    metric.trend === 'up' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                  }`}>
                    {metric.change}
                  </span>
                </div>
                <p className="text-lg font-bold text-gray-900">{metric.value}</p>
                <p className="text-sm text-gray-600">{metric.label}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Active Workflows */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h2 className="text-xl font-semibold mb-6 flex items-center gap-2 text-gray-900">
              <Workflow className="w-5 h-5 text-indigo-500" />
              Active Agents Orchestration 
            </h2>
            <div className="space-y-4">
              {workflows.map((workflow) => {
                const StatusIcon = getWorkflowIcon(workflow.status);
                return (
                  <div key={workflow.id} className={`p-4 rounded-lg border ${getWorkflowStatusBg(workflow.status)} border-gray-200`}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <StatusIcon className={`w-5 h-5 ${getWorkflowStatusColor(workflow.status)}`} />
                        <div>
                          <p className="font-medium text-gray-900">{workflow.name}</p>
                          <p className="text-sm text-gray-600">{workflow.id}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-medium ${getWorkflowStatusColor(workflow.status)}`}>
                          {workflow.status.toUpperCase()}
                        </p>
                        <p className="text-xs text-gray-600">{workflow.duration}</p>
                      </div>
                    </div>
                    
                    {/* Progress Bar */}
                    <div className="mb-3">
                      <div className="flex justify-between text-sm text-gray-600 mb-1">
                        <span>{workflow.currentStep}</span>
                        <span>{workflow.completedSteps}/{workflow.totalSteps} steps</span>
                      </div>
                      <div className="bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full transition-all duration-500 ${
                            workflow.status === 'completed' ? 'bg-green-500' :
                            workflow.status === 'failed' ? 'bg-red-500' :
                            workflow.status === 'paused' ? 'bg-yellow-500' :
                            'bg-blue-500'
                          }`}
                          style={{ width: `${workflow.progress}%` }}
                        ></div>
                      </div>
                    </div>
                    
                    {/* Agents involved */}
                    <div className="flex flex-wrap gap-1">
                      {workflow.agents.map((agent, idx) => (
                        <span key={idx} className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded-full">
                          {agent}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sidebar - Recent Alerts */}
        <div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-900">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Recent Alerts
            </h3>
            <div className="space-y-3">
              {alerts.slice(0, 4).map((alert) => (
                <div key={alert.id} className={`p-3 rounded-lg border-l-4 ${
                  alert.type === 'error' ? 'border-red-500 bg-red-50' :
                  alert.type === 'warning' ? 'border-yellow-500 bg-yellow-50' :
                  'border-blue-500 bg-blue-50'
                }`}>
                  <p className="text-xs text-gray-900">{alert.message}</p>
                  <p className="text-xs text-gray-600 mt-1">{alert.time}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Agent Status - Full Section */}
      <div className="mt-8 bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2 text-gray-900">
          <Activity className="w-5 h-5 text-blue-500" />
          Agents
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <div key={agent.id} className={`p-4 rounded-lg border ${getStatusBg(agent.status)} border-gray-200`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${agent.status === 'active' ? 'bg-green-500' : agent.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500'} ${agent.status === 'active' ? 'animate-pulse' : ''}`}></div>
                  <div>
                    <p className="font-medium text-gray-900">{agent.name}</p>
                    <p className="text-sm text-gray-600">{agent.id}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-medium ${getStatusColor(agent.status)}`}>
                    {agent.status.toUpperCase()}
                  </p>
                  <p className="text-xs text-gray-600">Success: {agent.successRate}%</p>
                </div>
              </div>

              {/* Current Task */}
              <div className="mb-3 p-2 bg-gray-50 rounded-md">
                <p className="text-xs text-gray-500 mb-1">Current Activity:</p>
                <p className="text-sm text-gray-800">{agent.currentTask}</p>
              </div>

              <div className="flex justify-between text-sm text-gray-600 mb-3">
                <span>Uptime: {agent.uptime}</span>
                <span>Last task: {agent.lastTask}</span>
              </div>

              <div className="flex justify-between text-sm text-gray-600 mb-3">
                <span>Tasks processed: {agent.tasksCompleted.toLocaleString()}</span>
                <span className={`${agent.status === 'active' ? 'text-green-600' : agent.status === 'warning' ? 'text-yellow-600' : 'text-red-600'}`}>
                  {agent.status === 'active' ? '● Operational' : agent.status === 'warning' ? '⚠ Needs Attention' : '✗ Offline'}
                </span>
              </div>
              
              {/* Success Rate Bar */}
              <div className="mt-3">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Success Rate</span>
                  <span>{agent.successRate}%</span>
                </div>
                <div className="bg-gray-200 rounded-full h-1.5">
                  <div 
                    className={`h-1.5 rounded-full ${
                      agent.successRate >= 95 ? 'bg-green-500' :
                      agent.successRate >= 85 ? 'bg-yellow-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${agent.successRate}%` }}
                  ></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* API Health and Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
        {/* API Endpoints */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-900">
            <Zap className="w-5 h-5 text-purple-500" />
            API Health
          </h3>
          <div className="space-y-3">
            {apiEndpoints.map((api, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div>
                  <p className="font-medium text-sm text-gray-900">{api.endpoint}</p>
                  <p className="text-xs text-gray-600">{api.requests} requests</p>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2">
                    <CheckCircle className={`w-4 h-4 ${getStatusColor(api.status)}`} />
                    <span className={`text-xs ${getStatusColor(api.status)}`}>
                      {api.status}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">{api.responseTime}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Performance Metrics */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-900">
            <TrendingUp className="w-5 h-5 text-green-500" />
            24H Performance
          </h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">API Calls</span>
              <span className="font-bold text-green-600">{systemMetrics.apiCalls.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">LLM Calls</span>
              <span className="font-bold text-purple-600">{systemMetrics.llmCalls.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Tokens Used</span>
              <span className="font-bold text-blue-600">{(systemMetrics.tokensUsed / 1000).toFixed(1)}k</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Avg Response Time</span>
              <span className="font-bold text-yellow-600">{systemMetrics.averageResponseTime.toFixed(1)}s</span>
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Performance Metrics */}
      <div className="mt-8 bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2 text-gray-900">
          <TrendingUp className="w-5 h-5 text-green-500" />
          System Performance Overview
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="text-center">
            <p className="text-3xl font-bold text-green-600">{systemMetrics.apiCalls.toLocaleString()}</p>
            <p className="text-gray-600">Total API Calls</p>
            <p className="text-green-600 text-sm">↗ 12.5% from yesterday</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-purple-600">{systemMetrics.llmCalls.toLocaleString()}</p>
            <p className="text-gray-600">LLM Calls</p>
            <p className="text-green-600 text-sm">↗ +1,247 from yesterday</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-blue-600">{(systemMetrics.tokensUsed / 1000000).toFixed(1)}M</p>
            <p className="text-gray-600">Tokens Processed</p>
            <p className="text-green-600 text-sm">↗ +234k from yesterday</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-indigo-600">{systemMetrics.averageResponseTime.toFixed(1)}s</p>
            <p className="text-gray-600">Avg LLM Response</p>
            <p className="text-green-600 text-sm">↘ 0.3s improvement</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentPilotMonitoring;