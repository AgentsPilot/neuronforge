'use client'

import React, { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Plus, 
  Search,
  MoreVertical,
  Play,
  Pause,
  Edit,
  Copy,
  Trash2,
  Download,
  Upload,
  CheckCircle,
  AlertTriangle,
  Activity,
  Zap,
  Database,
  GitBranch,
  Star,
  StarOff,
  Settings,
  BarChart3,
  TrendingUp,
  Eye,
  FileText,
  Workflow,
  Layers,
  Code
} from 'lucide-react';

interface WorkflowMetrics {
  totalRuns: number;
  successRate: number;
  avgDuration: number;
  lastRun?: string;
}

interface WorkflowData {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'paused' | 'error' | 'archived';
  category: 'data-processing' | 'automation' | 'integration' | 'analytics' | 'custom';
  tags: string[];
  author: string;
  created: string;
  modified: string;
  starred: boolean;
  metrics: WorkflowMetrics;
  stepCount: number;
  connections: number;
}

const mockWorkflows: WorkflowData[] = [
  {
    id: 'wf-1',
    name: 'Customer Data Pipeline',
    description: 'Automated pipeline for processing and enriching customer data from multiple sources',
    status: 'active',
    category: 'data-processing',
    tags: ['customers', 'etl', 'daily'],
    author: 'John Smith',
    created: '2024-01-15',
    modified: '2024-01-20',
    starred: true,
    metrics: { totalRuns: 145, successRate: 98.6, avgDuration: 240, lastRun: '2024-01-20T10:30:00Z' },
    stepCount: 8,
    connections: 3
  },
  {
    id: 'wf-2',
    name: 'Sales Report Generator',
    description: 'Weekly automated sales reporting with data visualization and email distribution',
    status: 'active',
    category: 'analytics',
    tags: ['sales', 'reports', 'weekly'],
    author: 'Sarah Johnson',
    created: '2024-01-10',
    modified: '2024-01-18',
    starred: false,
    metrics: { totalRuns: 52, successRate: 100, avgDuration: 180, lastRun: '2024-01-18T09:00:00Z' },
    stepCount: 12,
    connections: 5
  },
  {
    id: 'wf-3',
    name: 'Inventory Sync',
    description: 'Real-time inventory synchronization between warehouse and e-commerce platforms',
    status: 'paused',
    category: 'integration',
    tags: ['inventory', 'sync', 'real-time'],
    author: 'Mike Chen',
    created: '2024-01-05',
    modified: '2024-01-19',
    starred: true,
    metrics: { totalRuns: 2840, successRate: 95.2, avgDuration: 45, lastRun: '2024-01-19T15:45:00Z' },
    stepCount: 6,
    connections: 4
  },
  {
    id: 'wf-4',
    name: 'Email Campaign Automation',
    description: 'Personalized email campaign workflow with A/B testing and performance tracking',
    status: 'draft',
    category: 'automation',
    tags: ['email', 'marketing', 'campaigns'],
    author: 'Lisa Wang',
    created: '2024-01-22',
    modified: '2024-01-22',
    starred: false,
    metrics: { totalRuns: 0, successRate: 0, avgDuration: 0 },
    stepCount: 15,
    connections: 2
  }
];

const categories = [
  { id: 'all', label: 'All Workflows', icon: Workflow },
  { id: 'data-processing', label: 'Data Processing', icon: Database },
  { id: 'automation', label: 'Automation', icon: Zap },
  { id: 'integration', label: 'Integration', icon: GitBranch },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'custom', label: 'Custom', icon: Code }
];

const statusConfig = {
  draft: { color: 'gray', icon: Edit, label: 'Draft' },
  active: { color: 'green', icon: CheckCircle, label: 'Active' },
  paused: { color: 'yellow', icon: Pause, label: 'Paused' },
  error: { color: 'red', icon: AlertTriangle, label: 'Error' },
  archived: { color: 'gray', icon: FileText, label: 'Archived' }
};

const OrchestrationLandingPage: React.FC = () => {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowData[]>(mockWorkflows);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'modified' | 'status' | 'runs'>('modified');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const filteredWorkflows = workflows.filter(workflow => {
    const matchesCategory = selectedCategory === 'all' || workflow.category === selectedCategory;
    const matchesSearch = workflow.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         workflow.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         workflow.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  }).sort((a, b) => {
    switch (sortBy) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'modified':
        return new Date(b.modified).getTime() - new Date(a.modified).getTime();
      case 'status':
        return a.status.localeCompare(b.status);
      case 'runs':
        return b.metrics.totalRuns - a.metrics.totalRuns;
      default:
        return 0;
    }
  });

  // Navigation handlers
  const handleCreateWorkflow = useCallback(() => {
    router.push('/orchestration/new');
  }, [router]);

  const handleEditWorkflow = useCallback((workflowId: string) => {
    router.push(`/orchestration/new?edit=${workflowId}`);
  }, [router]);

  const handleViewWorkflow = useCallback((workflowId: string) => {
    router.push(`/orchestration/new?view=${workflowId}`);
  }, [router]);

  // Workflow management
  const toggleWorkflowStar = useCallback((workflowId: string) => {
    setWorkflows(prev => prev.map(wf => 
      wf.id === workflowId ? { ...wf, starred: !wf.starred } : wf
    ));
  }, []);

  const updateWorkflowStatus = useCallback((workflowId: string, newStatus: WorkflowData['status']) => {
    setWorkflows(prev => prev.map(wf => 
      wf.id === workflowId ? { ...wf, status: newStatus, modified: new Date().toISOString() } : wf
    ));
  }, []);

  const deleteWorkflow = useCallback((workflowId: string) => {
    if (confirm('Are you sure you want to delete this workflow?')) {
      setWorkflows(prev => prev.filter(wf => wf.id !== workflowId));
    }
  }, []);

  const duplicateWorkflow = useCallback((workflowId: string) => {
    const workflow = workflows.find(wf => wf.id === workflowId);
    if (workflow) {
      const newWorkflow: WorkflowData = {
        ...workflow,
        id: `wf-${Date.now()}`,
        name: `${workflow.name} (Copy)`,
        status: 'draft',
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        starred: false,
        metrics: { totalRuns: 0, successRate: 0, avgDuration: 0 }
      };
      setWorkflows(prev => [newWorkflow, ...prev]);
    }
  }, [workflows]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setOpenMenuId(null);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const getStatusColor = (status: WorkflowData['status']) => {
    const config = statusConfig[status];
    const colorMap: Record<string, string> = {
      gray: 'bg-gray-100 text-gray-700 border-gray-200',
      green: 'bg-green-100 text-green-700 border-green-200',
      yellow: 'bg-yellow-100 text-yellow-700 border-yellow-200',
      red: 'bg-red-100 text-red-700 border-red-200'
    };
    return colorMap[config.color];
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  const renderWorkflowCard = (workflow: WorkflowData) => {
    const StatusIcon = statusConfig[workflow.status].icon;
    const CategoryIcon = categories.find(c => c.id === workflow.category)?.icon || Workflow;

    return (
      <div
        key={workflow.id}
        onClick={() => handleViewWorkflow(workflow.id)}
        className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group cursor-pointer"
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-start justify-between">
            <div className="flex items-start space-x-3 flex-1">
              <div className="p-2 bg-blue-50 rounded-lg">
                <CategoryIcon className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900 truncate">{workflow.name}</h3>
                <p className="text-sm text-gray-600 mt-1 line-clamp-2">{workflow.description}</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-1 ml-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleWorkflowStar(workflow.id);
                }}
                className="p-1 text-gray-400 hover:text-yellow-500 transition-colors"
              >
                {workflow.starred ? (
                  <Star className="w-4 h-4 fill-current text-yellow-500" />
                ) : (
                  <StarOff className="w-4 h-4" />
                )}
              </button>
              
              <div className="relative">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId(openMenuId === workflow.id ? null : workflow.id);
                  }}
                  className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
                
                {openMenuId === workflow.id && (
                  <div className="absolute right-0 top-8 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewWorkflow(workflow.id);
                        setOpenMenuId(null);
                      }}
                      className="w-full px-4 py-2 text-sm text-left hover:bg-gray-50 flex items-center space-x-2 first:rounded-t-lg"
                    >
                      <Eye className="w-4 h-4" />
                      <span>View Workflow</span>
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditWorkflow(workflow.id);
                        setOpenMenuId(null);
                      }}
                      className="w-full px-4 py-2 text-sm text-left hover:bg-gray-50 flex items-center space-x-2"
                    >
                      <Edit className="w-4 h-4" />
                      <span>Edit Workflow</span>
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicateWorkflow(workflow.id);
                        setOpenMenuId(null);
                      }}
                      className="w-full px-4 py-2 text-sm text-left hover:bg-gray-50 flex items-center space-x-2"
                    >
                      <Copy className="w-4 h-4" />
                      <span>Duplicate</span>
                    </button>
                    <hr className="my-1" />
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteWorkflow(workflow.id);
                        setOpenMenuId(null);
                      }}
                      className="w-full px-4 py-2 text-sm text-left hover:bg-red-50 text-red-600 flex items-center space-x-2 last:rounded-b-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Delete</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Status and Category */}
          <div className="flex items-center justify-between mt-3">
            <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(workflow.status)}`}>
              <StatusIcon className="w-3 h-3 mr-1" />
              {statusConfig[workflow.status].label}
            </div>
            
            <div className="flex items-center space-x-4 text-xs text-gray-500">
              <span>{workflow.stepCount} steps</span>
              <span>{workflow.connections} connections</span>
            </div>
          </div>
        </div>

        {/* Metrics */}
        <div className="p-4">
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <div className="text-xs text-gray-500">Total Runs</div>
              <div className="font-semibold text-gray-900">{workflow.metrics.totalRuns.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Success Rate</div>
              <div className="font-semibold text-gray-900">{workflow.metrics.successRate}%</div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <div className="text-xs text-gray-500">Avg Duration</div>
              <div className="font-semibold text-gray-900">{formatDuration(workflow.metrics.avgDuration)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Last Run</div>
              <div className="font-semibold text-gray-900">
                {workflow.metrics.lastRun ? new Date(workflow.metrics.lastRun).toLocaleDateString() : 'Never'}
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-1 mb-4">
            {workflow.tags.slice(0, 3).map(tag => (
              <span key={tag} className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">
                {tag}
              </span>
            ))}
            {workflow.tags.length > 3 && (
              <span className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded">
                +{workflow.tags.length - 3}
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex space-x-2">
            {workflow.status === 'active' ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updateWorkflowStatus(workflow.id, 'paused');
                }}
                className="flex-1 px-3 py-2 bg-yellow-600 text-white text-sm rounded hover:bg-yellow-700 flex items-center justify-center space-x-1"
              >
                <Pause className="w-4 h-4" />
                <span>Pause</span>
              </button>
            ) : workflow.status === 'paused' ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updateWorkflowStatus(workflow.id, 'active');
                }}
                className="flex-1 px-3 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700 flex items-center justify-center space-x-1"
              >
                <Play className="w-4 h-4" />
                <span>Resume</span>
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updateWorkflowStatus(workflow.id, 'active');
                }}
                className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 flex items-center justify-center space-x-1"
              >
                <Play className="w-4 h-4" />
                <span>Run</span>
              </button>
            )}
            
            <button 
              onClick={(e) => {
                e.stopPropagation();
                handleEditWorkflow(workflow.id);
              }}
              className="px-3 py-2 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50 flex items-center justify-center"
            >
              <Edit className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>By {workflow.author}</span>
            <span>Modified {new Date(workflow.modified).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <h1 className="text-2xl font-bold text-gray-900">Workflow Orchestration</h1>
              <div className="hidden sm:flex items-center space-x-2 text-sm text-gray-500">
                <span>{filteredWorkflows.length} workflows</span>
                <span>•</span>
                <span>{workflows.filter(w => w.status === 'active').length} active</span>
              </div>
            </div>
            
            <div className="flex items-center space-x-3">
              <button className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 flex items-center space-x-2">
                <Upload className="w-4 h-4" />
                <span>Import</span>
              </button>
              
              <button 
                onClick={handleCreateWorkflow}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center space-x-2"
              >
                <Plus className="w-4 h-4" />
                <span>Create Workflow</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Workflows</p>
                <p className="text-3xl font-bold text-gray-900">{workflows.length}</p>
              </div>
              <Workflow className="w-8 h-8 text-blue-600" />
            </div>
            <div className="mt-2 flex items-center text-sm text-green-600">
              <TrendingUp className="w-4 h-4 mr-1" />
              +12% from last month
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Workflows</p>
                <p className="text-3xl font-bold text-gray-900">{workflows.filter(w => w.status === 'active').length}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <div className="mt-2 flex items-center text-sm text-green-600">
              <TrendingUp className="w-4 h-4 mr-1" />
              +5% from last week
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Runs</p>
                <p className="text-3xl font-bold text-gray-900">
                  {workflows.reduce((sum, w) => sum + w.metrics.totalRuns, 0).toLocaleString()}
                </p>
              </div>
              <Activity className="w-8 h-8 text-purple-600" />
            </div>
            <div className="mt-2 flex items-center text-sm text-green-600">
              <TrendingUp className="w-4 h-4 mr-1" />
              +28% from last month
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Avg Success Rate</p>
                <p className="text-3xl font-bold text-gray-900">
                  {(workflows.reduce((sum, w) => sum + w.metrics.successRate, 0) / workflows.length).toFixed(1)}%
                </p>
              </div>
              <BarChart3 className="w-8 h-8 text-orange-600" />
            </div>
            <div className="mt-2 flex items-center text-sm text-green-600">
              <TrendingUp className="w-4 h-4 mr-1" />
              +2.3% from last month
            </div>
          </div>
        </div>

        {/* Filters and Search */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
            {/* Search */}
            <div className="flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search workflows..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Category Filter */}
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <label className="text-sm font-medium text-gray-700">Category:</label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {categories.map(category => (
                    <option key={category.id} value={category.id}>{category.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <label className="text-sm font-medium text-gray-700">Sort by:</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="modified">Last Modified</option>
                  <option value="name">Name</option>
                  <option value="status">Status</option>
                  <option value="runs">Total Runs</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Workflows Grid */}
        {filteredWorkflows.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <Workflow className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No workflows found</h3>
            <p className="text-gray-600 mb-6">
              {searchQuery ? 'Try adjusting your search terms' : 'Get started by creating your first workflow'}
            </p>
            <button 
              onClick={handleCreateWorkflow}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center space-x-2 mx-auto"
            >
              <Plus className="w-4 h-4" />
              <span>Create Workflow</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredWorkflows.map(renderWorkflowCard)}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrchestrationLandingPage;