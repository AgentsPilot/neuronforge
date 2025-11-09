import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  Plus, 
  Save, 
  Play, 
  Pause,
  Square,
  Settings, 
  Eye,
  Code,
  GitBranch,
  Layers,
  Zap,
  Database,
  Filter,
  Send,
  Clock,
  CheckCircle,
  AlertTriangle,
  Trash2,
  Copy,
  Download,
  Upload,
  RotateCcw,
  Maximize2,
  Minimize2,
  Grid,
  Move,
  Link2,
  Info
} from 'lucide-react';

interface AgentNode {
  id: string;
  name: string;
  type: 'input' | 'transform' | 'filter' | 'output' | 'condition' | 'loop' | 'custom';
  position: { x: number; y: number };
  config: Record<string, any>;
  inputs: { id: string; name: string; type: string; required: boolean }[];
  outputs: { id: string; name: string; type: string }[];
  status: 'idle' | 'running' | 'complete' | 'error' | 'paused';
  data?: any[];
  connections: string[];
}

interface AgentConnection {
  id: string;
  from: { nodeId: string; portId: string };
  to: { nodeId: string; portId: string };
  status: 'idle' | 'active' | 'complete' | 'error';
}

interface CustomAgent {
  id: string;
  name: string;
  description: string;
  version: string;
  nodes: AgentNode[];
  connections: AgentConnection[];
  metadata: {
    created: string;
    modified: string;
    author: string;
    tags: string[];
  };
}

const nodeTemplates = {
  input: {
    name: 'Data Input',
    icon: Database,
    color: 'blue',
    inputs: [],
    outputs: [{ id: 'data', name: 'Data', type: 'any', required: false }],
    config: { source: 'api', endpoint: '', format: 'json' }
  },
  transform: {
    name: 'Transform',
    icon: Zap,
    color: 'purple',
    inputs: [{ id: 'input', name: 'Input', type: 'any', required: true }],
    outputs: [{ id: 'output', name: 'Output', type: 'any', required: false }],
    config: { operation: 'map', field: '', expression: '' }
  },
  filter: {
    name: 'Filter',
    icon: Filter,
    color: 'green',
    inputs: [{ id: 'input', name: 'Input', type: 'array', required: true }],
    outputs: [{ id: 'filtered', name: 'Filtered', type: 'array', required: false }],
    config: { condition: '', operator: 'equals', value: '' }
  },
  output: {
    name: 'Output',
    icon: Send,
    color: 'orange',
    inputs: [{ id: 'data', name: 'Data', type: 'any', required: true }],
    outputs: [],
    config: { destination: 'console', format: 'json', webhook: '' }
  },
  condition: {
    name: 'Condition',
    icon: GitBranch,
    color: 'yellow',
    inputs: [{ id: 'input', name: 'Input', type: 'any', required: true }],
    outputs: [
      { id: 'true', name: 'True', type: 'any', required: false },
      { id: 'false', name: 'False', type: 'any', required: false }
    ],
    config: { condition: '', trueAction: 'continue', falseAction: 'skip' }
  },
  loop: {
    name: 'Loop',
    icon: Clock,
    color: 'pink',
    inputs: [{ id: 'input', name: 'Input', type: 'array', required: true }],
    outputs: [{ id: 'item', name: 'Current Item', type: 'any', required: false }],
    config: { type: 'forEach', maxIterations: 100, breakCondition: '' }
  }
};

const CustomAgentCreator: React.FC = () => {
  const [agent, setAgent] = useState<CustomAgent>({
    id: `agent-${Date.now()}`,
    name: 'New Agent',
    description: 'Custom agent workflow',
    version: '1.0.0',
    nodes: [],
    connections: [],
    metadata: {
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      author: 'User',
      tags: []
    }
  });

  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState<{ nodeId: string; portId: string; type: 'input' | 'output' } | null>(null);
  const [showNodePalette, setShowNodePalette] = useState(true);
  const [showProperties, setShowProperties] = useState(true);
  const [executionStatus, setExecutionStatus] = useState<'idle' | 'running' | 'paused' | 'complete' | 'error'>('idle');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);

  const addNode = useCallback((type: keyof typeof nodeTemplates, position: { x: number; y: number }) => {
    const template = nodeTemplates[type];
    const newNode: AgentNode = {
      id: `node-${Date.now()}`,
      name: `${template.name} ${agent.nodes.length + 1}`,
      type: type as any,
      position,
      config: { ...template.config },
      inputs: [...template.inputs],
      outputs: [...template.outputs],
      status: 'idle',
      connections: []
    };

    setAgent(prev => ({
      ...prev,
      nodes: [...prev.nodes, newNode],
      metadata: { ...prev.metadata, modified: new Date().toISOString() }
    }));
    setSelectedNode(newNode.id);
  }, [agent.nodes.length]);

  const deleteNode = useCallback((nodeId: string) => {
    setAgent(prev => ({
      ...prev,
      nodes: prev.nodes.filter(n => n.id !== nodeId),
      connections: prev.connections.filter(c => c.from.nodeId !== nodeId && c.to.nodeId !== nodeId),
      metadata: { ...prev.metadata, modified: new Date().toISOString() }
    }));
    setSelectedNode(null);
  }, []);

  const updateNode = useCallback((nodeId: string, updates: Partial<AgentNode>) => {
    setAgent(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, ...updates } : n),
      metadata: { ...prev.metadata, modified: new Date().toISOString() }
    }));
  }, []);

  const createConnection = useCallback((from: { nodeId: string; portId: string }, to: { nodeId: string; portId: string }) => {
    const connectionId = `conn-${Date.now()}`;
    const newConnection: AgentConnection = {
      id: connectionId,
      from,
      to,
      status: 'idle'
    };

    setAgent(prev => ({
      ...prev,
      connections: [...prev.connections, newConnection],
      metadata: { ...prev.metadata, modified: new Date().toISOString() }
    }));
  }, []);

  const executeAgent = useCallback(async () => {
    setExecutionStatus('running');
    
    // Simulate execution
    for (const node of agent.nodes) {
      updateNode(node.id, { status: 'running' });
      await new Promise(resolve => setTimeout(resolve, 1000));
      updateNode(node.id, { status: 'complete' });
    }
    
    setExecutionStatus('complete');
  }, [agent.nodes, updateNode]);

  const stopExecution = useCallback(() => {
    setExecutionStatus('idle');
    agent.nodes.forEach(node => {
      updateNode(node.id, { status: 'idle' });
    });
  }, [agent.nodes, updateNode]);

  const exportAgent = useCallback(() => {
    const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(JSON.stringify(agent, null, 2));
    const exportFileDefaultName = `${agent.name.replace(/\s+/g, '_')}_v${agent.version}.json`;
    
    const linkElement = document.createElement("a");
    linkElement.setAttribute("href", dataUri);
    linkElement.setAttribute("download", exportFileDefaultName);
    linkElement.click();
  }, [agent]);

  const importAgent = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const importedAgent = JSON.parse(e.target?.result as string);
          setAgent(importedAgent);
        } catch (error) {
          console.error('Error importing agent:', error);
        }
      };
      reader.readAsText(file);
    }
  }, []);

  const getNodeColor = (type: string) => {
    const template = nodeTemplates[type as keyof typeof nodeTemplates];
    const colorMap: Record<string, string> = {
      blue: 'border-blue-300 bg-blue-50',
      purple: 'border-purple-300 bg-purple-50',
      green: 'border-green-300 bg-green-50',
      orange: 'border-orange-300 bg-orange-50',
      yellow: 'border-yellow-300 bg-yellow-50',
      pink: 'border-pink-300 bg-pink-50'
    };
    return colorMap[template?.color || 'blue'];
  };

  const getStatusColor = (status: string) => {
    const statusColors: Record<string, string> = {
      idle: 'text-gray-500',
      running: 'text-blue-500 animate-pulse',
      complete: 'text-green-500',
      error: 'text-red-500',
      paused: 'text-yellow-500'
    };
    return statusColors[status] || 'text-gray-500';
  };

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Node Palette */}
      {showNodePalette && (
        <div className="w-64 bg-white border-r border-gray-300 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900 mb-2">Node Palette</h3>
            <p className="text-xs text-gray-600">Drag nodes to canvas</p>
          </div>
          
          <div className="flex-1 p-4 space-y-2">
            {Object.entries(nodeTemplates).map(([type, template]) => {
              const Icon = template.icon;
              return (
                <div
                  key={type}
                  className={`p-3 border rounded-lg cursor-pointer hover:shadow-md transition-all ${getNodeColor(type)}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    const rect = canvasRef.current?.getBoundingClientRect();
                    if (rect) {
                      addNode(type as keyof typeof nodeTemplates, {
                        x: Math.random() * 300 + 100,
                        y: Math.random() * 200 + 100
                      });
                    }
                  }}
                >
                  <div className="flex items-center space-x-2">
                    <Icon className="w-4 h-4" />
                    <span className="text-sm font-medium">{template.name}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Canvas */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="bg-white border-b border-gray-300 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <input
                type="text"
                value={agent.name}
                onChange={(e) => setAgent(prev => ({ ...prev, name: e.target.value }))}
                className="text-lg font-semibold border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none px-2 py-1"
              />
              <span className="text-sm text-gray-500">v{agent.version}</span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowNodePalette(!showNodePalette)}
                className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
                title="Toggle Palette"
              >
                <Layers className="w-4 h-4" />
              </button>

              <button
                onClick={() => setShowProperties(!showProperties)}
                className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
                title="Toggle Properties"
              >
                <Settings className="w-4 h-4" />
              </button>

              <div className="border-l border-gray-300 pl-2 ml-2">
                {executionStatus === 'idle' ? (
                  <button
                    onClick={executeAgent}
                    className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 flex items-center space-x-1"
                  >
                    <Play className="w-4 h-4" />
                    <span>Run</span>
                  </button>
                ) : executionStatus === 'running' ? (
                  <button
                    onClick={stopExecution}
                    className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 flex items-center space-x-1"
                  >
                    <Square className="w-4 h-4" />
                    <span>Stop</span>
                  </button>
                ) : (
                  <button
                    onClick={() => setExecutionStatus('idle')}
                    className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center space-x-1"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Reset</span>
                  </button>
                )}
              </div>

              <div className="border-l border-gray-300 pl-2 ml-2 flex space-x-1">
                <button
                  onClick={exportAgent}
                  className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
                  title="Export Agent"
                >
                  <Download className="w-4 h-4" />
                </button>

                <label className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded cursor-pointer" title="Import Agent">
                  <Upload className="w-4 h-4" />
                  <input
                    type="file"
                    accept=".json"
                    onChange={importAgent}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 relative overflow-hidden">
          <div
            ref={canvasRef}
            className="absolute inset-0 bg-gray-50"
            style={{
              backgroundImage: 'radial-gradient(circle, #d1d5db 1px, transparent 1px)',
              backgroundSize: '20px 20px'
            }}
          >
            {/* Nodes */}
            {agent.nodes.map(node => {
              const template = nodeTemplates[node.type as keyof typeof nodeTemplates];
              const Icon = template?.icon || Database;
              
              return (
                <div
                  key={node.id}
                  className={`absolute bg-white border-2 rounded-lg shadow-lg min-w-48 ${
                    selectedNode === node.id ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-300'
                  } ${getNodeColor(node.type)} hover:shadow-xl transition-all cursor-move`}
                  style={{
                    left: node.position.x,
                    top: node.position.y,
                    transform: `scale(${zoom})`
                  }}
                  onClick={() => setSelectedNode(node.id)}
                >
                  {/* Node Header */}
                  <div className="p-3 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Icon className="w-4 h-4" />
                        <span className="font-medium text-sm">{node.name}</span>
                      </div>
                      <div className="flex items-center space-x-1">
                        {node.status === 'running' && (
                          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                        )}
                        {node.status === 'complete' && (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        )}
                        {node.status === 'error' && (
                          <AlertTriangle className="w-4 h-4 text-red-500" />
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteNode(node.id);
                          }}
                          className="p-1 text-gray-400 hover:text-red-600 rounded"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Input Ports */}
                  {node.inputs.map((input, index) => (
                    <div
                      key={input.id}
                      className="absolute w-3 h-3 bg-gray-400 border-2 border-white rounded-full cursor-pointer hover:bg-blue-500 transition-colors"
                      style={{
                        left: -6,
                        top: 40 + (index * 20)
                      }}
                      title={input.name}
                    />
                  ))}

                  {/* Output Ports */}
                  {node.outputs.map((output, index) => (
                    <div
                      key={output.id}
                      className="absolute w-3 h-3 bg-gray-400 border-2 border-white rounded-full cursor-pointer hover:bg-green-500 transition-colors"
                      style={{
                        right: -6,
                        top: 40 + (index * 20)
                      }}
                      title={output.name}
                    />
                  ))}

                  {/* Node Content */}
                  <div className="p-3">
                    <div className="text-xs text-gray-600 mb-2">
                      {template?.name || node.type}
                    </div>
                    {Object.keys(node.config).length > 0 && (
                      <div className="text-xs text-gray-500">
                        {Object.entries(node.config).slice(0, 2).map(([key, value]) => (
                          <div key={key} className="truncate">
                            {key}: {String(value).slice(0, 20)}...
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Connections */}
            <svg className="absolute inset-0 pointer-events-none overflow-visible">
              <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" 
                        refX="10" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="#6b7280" />
                </marker>
              </defs>
              
              {agent.connections.map(connection => {
                const fromNode = agent.nodes.find(n => n.id === connection.from.nodeId);
                const toNode = agent.nodes.find(n => n.id === connection.to.nodeId);
                
                if (!fromNode || !toNode) return null;
                
                const fromX = fromNode.position.x + 192; // node width
                const fromY = fromNode.position.y + 50;
                const toX = toNode.position.x;
                const toY = toNode.position.y + 50;
                
                return (
                  <line
                    key={connection.id}
                    x1={fromX}
                    y1={fromY}
                    x2={toX}
                    y2={toY}
                    stroke={connection.status === 'active' ? '#3b82f6' : '#6b7280'}
                    strokeWidth={connection.status === 'active' ? 3 : 2}
                    markerEnd="url(#arrowhead)"
                    className={connection.status === 'active' ? 'animate-pulse' : ''}
                  />
                );
              })}
            </svg>
          </div>
        </div>
      </div>

      {/* Properties Panel */}
      {showProperties && selectedNode && (
        <div className="w-80 bg-white border-l border-gray-300 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900">Properties</h3>
          </div>
          
          <div className="flex-1 p-4 space-y-4">
            {(() => {
              const node = agent.nodes.find(n => n.id === selectedNode);
              if (!node) return null;
              
              return (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                    <input
                      type="text"
                      value={node.name}
                      onChange={(e) => updateNode(node.id, { name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                    <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-sm">
                      {nodeTemplates[node.type as keyof typeof nodeTemplates]?.name || node.type}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                    <div className={`px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-sm ${getStatusColor(node.status)}`}>
                      {node.status}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Configuration</label>
                    <div className="space-y-2">
                      {Object.entries(node.config).map(([key, value]) => (
                        <div key={key}>
                          <label className="block text-xs text-gray-600 mb-1">{key}</label>
                          <input
                            type="text"
                            value={String(value)}
                            onChange={(e) => updateNode(node.id, {
                              config: { ...node.config, [key]: e.target.value }
                            })}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {node.inputs.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Inputs</label>
                      <div className="space-y-1">
                        {node.inputs.map(input => (
                          <div key={input.id} className="text-xs bg-blue-50 p-2 rounded border">
                            <div className="font-medium">{input.name}</div>
                            <div className="text-gray-600">{input.type} {input.required && '(required)'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {node.outputs.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Outputs</label>
                      <div className="space-y-1">
                        {node.outputs.map(output => (
                          <div key={output.id} className="text-xs bg-green-50 p-2 rounded border">
                            <div className="font-medium">{output.name}</div>
                            <div className="text-gray-600">{output.type}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomAgentCreator;