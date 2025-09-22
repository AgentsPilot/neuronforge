'use client'

import React, { useState, useEffect } from 'react';
import { Activity, Cpu, HardDrive, Users, Zap, AlertTriangle, CheckCircle, Clock, TrendingUp, Download, Workflow, GitBranch, Play, Pause, CheckSquare, XSquare, FileText, Monitor } from 'lucide-react';

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

  // PDF Export Function
  const exportToPDF = () => {
    // Create a simplified report for PDF export
    const reportData = {
      timestamp: currentTime.toLocaleString(),
      systemMetrics,
      agents: agents.filter(a => a.status !== 'error').length,
      activeWorkflows: systemMetrics.activeWorkflows,
      totalTokens: systemMetrics.tokensUsed,
      successRate: agents.reduce((sum, a) => sum + a.successRate, 0) / agents.length
    };

    // Create HTML content for PDF
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>AgentPilot Monitoring Report</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; color: #333; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #3B82F6; padding-bottom: 20px; }
            .metric { display: inline-block; margin: 10px; padding: 15px; border: 1px solid #ddd; border-radius: 8px; min-width: 150px; }
            .metric h3 { margin: 0 0 10px 0; color: #3B82F6; }
            .metric p { margin: 5px 0; font-size: 18px; font-weight: bold; }
            .agents { margin-top: 30px; }
            .agent { margin: 10px 0; padding: 10px; background: #f9f9f9; border-radius: 5px; }
            .status-active { color: #10B981; }
            .status-warning { color: #F59E0B; }
            .status-error { color: #EF4444; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>AgentPilot Monitoring Report</h1>
            <p>Generated: ${reportData.timestamp}</p>
          </div>
          
          <div class="metrics">
            <div class="metric">
              <h3>CPU Performance</h3>
              <p>${systemMetrics.cpu.toFixed(1)}ms</p>
            </div>
            <div class="metric">
              <h3>Memory Usage</h3>
              <p>${systemMetrics.memory.toFixed(1)}%</p>
            </div>
            <div class="metric">
              <h3>LLM Calls</h3>
              <p>${systemMetrics.llmCalls.toLocaleString()}</p>
            </div>
            <div class="metric">
              <h3>Active Workflows</h3>
              <p>${systemMetrics.activeWorkflows}</p>
            </div>
            <div class="metric">
              <h3>Tokens Used</h3>
              <p>${(systemMetrics.tokensUsed / 1000).toFixed(1)}k</p>
            </div>
            <div class="metric">
              <h3>Avg Response Time</h3>
              <p>${systemMetrics.averageResponseTime.toFixed(1)}s</p>
            </div>
          </div>

          <div class="agents">
            <h2>Agent Status Summary</h2>
            ${agents.map(agent => `
              <div class="agent">
                <strong class="status-${agent.status}">${agent.name}</strong> - 
                ${agent.status.toUpperCase()} (${agent.successRate}% success rate)
                <br><small>Uptime: ${agent.uptime} | Tasks: ${agent.tasksCompleted}</small>
              </div>
            `).join('')}
          </div>
        </body>
      </html>
    `;

    // Create and download PDF
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      printWindow.print();
    }
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
            newStatus = 'warning';
            newCurrentTask = 'System recovery in progress...';
          } else if (agent.status === 'warning' && Math.random() > 0.8) {
            newStatus = 'active';
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
      agents: ['Customer Data Processor', 'Integration Hub Manager']
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
      agents: ['Content Intelligence Analyzer', 'Business Process Coordinator']
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
      agents: ['Content Intelligence Analyzer']
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
      case 'running': return 'text-purple-600';
      case 'completed': return 'text-purple-600';
      case 'failed': return 'text-red-600';
      case 'paused': return 'text-indigo-600';
      default: return 'text-gray-600';
    }
  };

  const getWorkflowStatusBg = (status) => {
    switch (status) {
      case 'running': return 'bg-gradient-to-r from-purple-50 to-indigo-50';
      case 'completed': return 'bg-gradient-to-r from-purple-50 to-violet-50';
      case 'failed': return 'bg-gradient-to-r from-red-50 to-rose-50';
      case 'paused': return 'bg-gradient-to-r from-indigo-50 to-purple-50';
      default: return 'bg-gradient-to-r from-gray-50 to-slate-50';
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
      case 'active': case 'healthy': return 'text-purple-600';
      case 'warning': case 'degraded': return 'text-indigo-600';
      case 'error': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusBg = (status) => {
    switch (status) {
      case 'active': case 'healthy': return 'bg-gradient-to-r from-purple-50 to-indigo-50';
      case 'warning': case 'degraded': return 'bg-gradient-to-r from-indigo-50 to-violet-50';
      case 'error': return 'bg-gradient-to-r from-red-50 to-rose-50';
      default: return 'bg-gradient-to-r from-gray-50 to-slate-50';
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Modern Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-3xl shadow-xl mb-4">
          <Monitor className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 via-indigo-800 to-purple-800 bg-clip-text text-transparent">
          System Monitoring
        </h1>
        <p className="text-gray-600 font-medium">Real-time platform monitoring and analytics dashboard</p>
      </div>

      {/* Control Bar */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-purple-500 rounded-full animate-pulse"></div>
              <span className="text-sm font-medium text-gray-700">Live Data</span>
            </div>
            <div className="text-sm text-gray-600 font-medium">
              Updated: {currentTime.toLocaleTimeString()}
            </div>
          </div>
          <button 
            onClick={exportToPDF}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white text-sm font-semibold rounded-xl shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
          >
            <FileText className="w-4 h-4" />
            Export PDF
          </button>
        </div>
      </div>

      {/* Modern Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-indigo-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Cpu className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">CPU Performance</p>
              <p className="text-2xl font-bold text-purple-900">{systemMetrics.cpu.toFixed(1)}ms</p>
            </div>
          </div>
          <div className="mt-4 bg-purple-200 rounded-full h-2">
            <div 
              className="bg-gradient-to-r from-purple-500 to-indigo-500 h-2 rounded-full transition-all duration-500 shadow-sm"
              style={{ width: `${Math.min(100, systemMetrics.cpu)}%` }}
            ></div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-purple-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
              <HardDrive className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">Memory Usage</p>
              <p className="text-2xl font-bold text-indigo-900">{systemMetrics.memory.toFixed(1)}%</p>
            </div>
          </div>
          <div className="mt-4 bg-indigo-200 rounded-full h-2">
            <div 
              className="bg-gradient-to-r from-indigo-500 to-purple-500 h-2 rounded-full transition-all duration-500 shadow-sm"
              style={{ width: `${systemMetrics.memory}%` }}
            ></div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-pink-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Zap className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">LLM Calls</p>
              <p className="text-2xl font-bold text-purple-900">{(systemMetrics.llmCalls / 1000).toFixed(1)}k</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-violet-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-violet-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-violet-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Workflow className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">Active Workflows</p>
              <p className="text-2xl font-bold text-indigo-900">{systemMetrics.activeWorkflows}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Token Usage Section */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl">
            <Zap className="w-6 h-6 text-purple-600" />
          </div>
          AI Token Analytics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <Zap className="w-5 h-5 text-purple-600" />
              <span className="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-600 font-semibold">
                +{Math.floor(Math.random() * 50) + 10}
              </span>
            </div>
            <p className="text-2xl font-bold text-purple-900">{(systemMetrics.llmCalls / 1000).toFixed(1)}k</p>
            <p className="text-sm text-purple-700 font-medium">Total LLM Calls</p>
          </div>

          <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 p-4 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <Activity className="w-5 h-5 text-indigo-600" />
              <span className="text-xs px-2 py-1 rounded-full bg-indigo-100 text-indigo-600 font-semibold">
                +{(Math.random() * 5000).toFixed(0)}
              </span>
            </div>
            <p className="text-2xl font-bold text-indigo-900">{(systemMetrics.tokensUsed / 1000).toFixed(1)}k</p>
            <p className="text-sm text-indigo-700 font-medium">Tokens Used</p>
          </div>

          <div className="bg-gradient-to-br from-purple-50 to-violet-100 p-4 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <CheckCircle className="w-5 h-5 text-purple-600" />
              <span className="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-600 font-semibold">
                {((systemMetrics.tokensRemaining / (systemMetrics.tokensUsed + systemMetrics.tokensRemaining)) * 100).toFixed(1)}%
              </span>
            </div>
            <p className="text-2xl font-bold text-purple-900">{(systemMetrics.tokensRemaining / 1000000).toFixed(1)}M</p>
            <p className="text-sm text-purple-700 font-medium">Tokens Remaining</p>
          </div>

          <div className="bg-gradient-to-br from-indigo-50 to-purple-100 p-4 rounded-2xl shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <Clock className="w-5 h-5 text-indigo-600" />
              <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
                systemMetrics.averageResponseTime < 1.5 ? 'bg-purple-100 text-purple-600' : 'bg-red-100 text-red-600'
              }`}>
                {systemMetrics.averageResponseTime < 1.5 ? 'Good' : 'Fair'}
              </span>
            </div>
            <p className="text-2xl font-bold text-indigo-900">{systemMetrics.averageResponseTime.toFixed(1)}s</p>
            <p className="text-sm text-indigo-700 font-medium">Avg Response</p>
          </div>
        </div>

        {/* Token Progress Bar */}
        <div className="space-y-3">
          <div className="flex justify-between text-sm text-gray-600 font-medium">
            <span>Token Usage Progress</span>
            <span>{((systemMetrics.tokensUsed / (systemMetrics.tokensUsed + systemMetrics.tokensRemaining)) * 100).toFixed(1)}% used</span>
          </div>
          <div className="bg-gray-200 rounded-full h-4 overflow-hidden shadow-inner">
            <div 
              className="bg-gradient-to-r from-purple-500 to-indigo-500 h-4 rounded-full transition-all duration-500 shadow-lg"
              style={{ width: `${(systemMetrics.tokensUsed / (systemMetrics.tokensUsed + systemMetrics.tokensRemaining)) * 100}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Orchestration Metrics */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 rounded-xl">
            <GitBranch className="w-6 h-6 text-indigo-600" />
          </div>
          Process Orchestration
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {orchestrationMetrics.map((metric, index) => {
            const IconComponent = metric.icon;
            return (
              <div key={index} className="bg-gradient-to-br from-gray-50 to-slate-50 p-4 rounded-2xl shadow-sm hover:shadow-md transition-all duration-300">
                <div className="flex items-center justify-between mb-2">
                  <div className="p-2 bg-gradient-to-br from-purple-100 to-indigo-100 rounded-xl">
                    <IconComponent className="w-5 h-5 text-purple-600" />
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-semibold ${
                    metric.trend === 'up' ? 'bg-purple-100 text-purple-600' : 'bg-indigo-100 text-indigo-600'
                  }`}>
                    {metric.change}
                  </span>
                </div>
                <p className="text-2xl font-bold text-gray-900">{metric.value}</p>
                <p className="text-sm text-gray-600 font-medium">{metric.label}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Workflows */}
        <div className="lg:col-span-2">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 rounded-xl">
                <Workflow className="w-6 h-6 text-indigo-600" />
              </div>
              Active Workflows
            </h3>
            <div className="space-y-4">
              {workflows.map((workflow) => {
                const StatusIcon = getWorkflowIcon(workflow.status);
                return (
                  <div key={workflow.id} className={`p-5 rounded-2xl ${getWorkflowStatusBg(workflow.status)} shadow-sm`}>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-white rounded-xl shadow-sm">
                          <StatusIcon className={`w-5 h-5 ${getWorkflowStatusColor(workflow.status)}`} />
                        </div>
                        <div>
                          <p className="font-bold text-gray-900">{workflow.name}</p>
                          <p className="text-sm text-gray-600 font-medium">{workflow.id}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-bold ${getWorkflowStatusColor(workflow.status)}`}>
                          {workflow.status.toUpperCase()}
                        </p>
                        <p className="text-xs text-gray-600 font-medium">{workflow.duration}</p>
                      </div>
                    </div>
                    
                    <div className="mb-4">
                      <div className="flex justify-between text-sm text-gray-700 mb-2 font-medium">
                        <span>{workflow.currentStep}</span>
                        <span>{workflow.completedSteps}/{workflow.totalSteps} steps</span>
                      </div>
                      <div className="bg-white/50 rounded-full h-3 shadow-inner">
                        <div 
                          className={`h-3 rounded-full transition-all duration-500 shadow-sm ${
                            workflow.status === 'completed' ? 'bg-gradient-to-r from-purple-500 to-violet-500' :
                            workflow.status === 'failed' ? 'bg-gradient-to-r from-red-500 to-rose-500' :
                            workflow.status === 'paused' ? 'bg-gradient-to-r from-indigo-500 to-purple-500' :
                            'bg-gradient-to-r from-purple-500 to-indigo-500'
                          }`}
                          style={{ width: `${workflow.progress}%` }}
                        ></div>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap gap-2">
                      {workflow.agents.map((agent, idx) => (
                        <span key={idx} className="text-xs bg-white/70 text-gray-800 px-3 py-1.5 rounded-full font-medium shadow-sm">
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

        {/* Alerts Sidebar */}
        <div>
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl">
                <AlertTriangle className="w-5 h-5 text-purple-600" />
              </div>
              Recent Alerts
            </h3>
            <div className="space-y-3">
              {alerts.slice(0, 4).map((alert) => (
                <div key={alert.id} className={`p-4 rounded-2xl border-l-4 shadow-sm ${
                  alert.type === 'error' ? 'border-red-500 bg-gradient-to-r from-red-50 to-rose-50' :
                  alert.type === 'warning' ? 'border-purple-500 bg-gradient-to-r from-purple-50 to-indigo-50' :
                  'border-indigo-500 bg-gradient-to-r from-indigo-50 to-purple-50'
                }`}>
                  <p className="text-sm font-medium text-gray-900 mb-1">{alert.message}</p>
                  <p className="text-xs text-gray-600 font-medium">{alert.time}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Agents Status Grid */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-purple-500/20 to-indigo-500/20 rounded-xl">
            <Activity className="w-6 h-6 text-purple-600" />
          </div>
          Agent Status Overview
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <div key={agent.id} className={`p-5 rounded-2xl ${getStatusBg(agent.status)} shadow-sm`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full ${
                    agent.status === 'active' ? 'bg-purple-500 animate-pulse' : 
                    agent.status === 'warning' ? 'bg-indigo-500' : 'bg-red-500'
                  } shadow-lg`}></div>
                  <div>
                    <p className="font-bold text-gray-900">{agent.name}</p>
                    <p className="text-sm text-gray-600 font-medium">{agent.id}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold ${getStatusColor(agent.status)}`}>
                    {agent.status.toUpperCase()}
                  </p>
                  <p className="text-xs text-gray-600 font-medium">Success: {agent.successRate}%</p>
                </div>
              </div>

              <div className="mb-4 p-3 bg-white/60 rounded-xl">
                <p className="text-xs text-gray-500 font-medium mb-1">Current Activity:</p>
                <p className="text-sm text-gray-800 font-medium">{agent.currentTask}</p>
              </div>

              <div className="flex justify-between text-sm text-gray-600 mb-4 font-medium">
                <span>Uptime: {agent.uptime}</span>
                <span>Tasks: {agent.tasksCompleted.toLocaleString()}</span>
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-gray-500 font-medium">
                  <span>Success Rate</span>
                  <span>{agent.successRate}%</span>
                </div>
                <div className="bg-white/50 rounded-full h-2 shadow-inner">
                  <div 
                    className={`h-2 rounded-full transition-all duration-500 shadow-sm ${
                      agent.successRate >= 95 ? 'bg-gradient-to-r from-purple-500 to-indigo-500' :
                      agent.successRate >= 85 ? 'bg-gradient-to-r from-indigo-500 to-purple-500' : 
                      'bg-gradient-to-r from-red-500 to-rose-500'
                    }`}
                    style={{ width: `${agent.successRate}%` }}
                  ></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* API Health Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl">
              <Zap className="w-5 h-5 text-purple-600" />
            </div>
            API Health Status
          </h3>
          <div className="space-y-3">
            {apiEndpoints.map((api, index) => (
              <div key={index} className="flex items-center justify-between p-4 bg-gradient-to-r from-gray-50 to-slate-50 rounded-2xl shadow-sm hover:shadow-md transition-all">
                <div>
                  <p className="font-bold text-sm text-gray-900">{api.endpoint}</p>
                  <p className="text-xs text-gray-600 font-medium">{api.requests} requests</p>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className={`w-4 h-4 ${getStatusColor(api.status)}`} />
                    <span className={`text-xs font-bold ${getStatusColor(api.status)}`}>
                      {api.status.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 font-medium">{api.responseTime}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500/20 to-indigo-500/20 rounded-xl">
              <TrendingUp className="w-5 h-5 text-purple-600" />
            </div>
            24H Performance
          </h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-2xl shadow-sm">
              <span className="text-sm text-gray-700 font-medium">API Calls</span>
              <span className="font-bold text-purple-600 text-lg">{systemMetrics.apiCalls.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-2xl shadow-sm">
              <span className="text-sm text-gray-700 font-medium">LLM Calls</span>
              <span className="font-bold text-indigo-600 text-lg">{(systemMetrics.llmCalls / 1000).toFixed(1)}k</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gradient-to-r from-purple-50 to-violet-50 rounded-2xl shadow-sm">
              <span className="text-sm text-gray-700 font-medium">Tokens Used</span>
              <span className="font-bold text-purple-600 text-lg">{(systemMetrics.tokensUsed / 1000).toFixed(1)}k</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-2xl shadow-sm">
              <span className="text-sm text-gray-700 font-medium">Response Time</span>
              <span className="font-bold text-indigo-600 text-lg">{systemMetrics.averageResponseTime.toFixed(1)}s</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentPilotMonitoring;