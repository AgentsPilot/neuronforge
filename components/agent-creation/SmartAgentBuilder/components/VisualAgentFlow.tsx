import React, { useState, useRef, useEffect } from 'react';
import { 
  Play, 
  RotateCcw, 
  CheckCircle, 
  Brain, 
  Mail, 
  FileText, 
  Database, 
  Settings,
  RefreshCw,
  ArrowRight,
  AlertTriangle
} from 'lucide-react';

interface WorkflowStep {
  step?: number;
  operation: string; // This is the correct field name from your data
  plugin: string;
  plugin_action: string;
  error_handling?: string;
  validated?: boolean;
}

interface Agent {
  agent_name: string;
  description: string;
  workflow_steps?: WorkflowStep[];
  plugins_required: string[];
  connected_plugins?: string[];
}

interface ProcessingNode {
  id: string;
  step: number;
  title: string;
  plugin: string;
  pluginAction: string;
  validated: boolean;
  isConnected: boolean; // NEW: Track if plugin is connected
  icon: any;
  color: string;
  position: { x: number; y: number };
  processingTime: number;
}

const getPluginIcon = (plugin: string) => {
  if (plugin.includes('mail') || plugin.includes('gmail')) return Mail;
  if (plugin.includes('drive') || plugin.includes('file')) return FileText;
  if (plugin.includes('research') || plugin.includes('chat')) return Brain;
  if (plugin.includes('database')) return Database;
  if (plugin.includes('pdf')) return FileText;
  return Settings;
};

// NEW: Helper function to detect if a step is document creation (handled by AI)
const isDocumentCreationStep = (operation: string): boolean => {
  const operationLower = operation.toLowerCase();
  const documentPatterns = [
    /create.*pdf|generate.*pdf|pdf.*document/,
    /create.*csv|generate.*csv|csv.*file/,
    /create.*word|generate.*docx|word.*document/,
    /create.*excel|generate.*xlsx|excel.*file/,
    /create.*document|generate.*document/,
    /create.*file|generate.*file/,
    /create.*report|generate.*report/,
    /format.*content|format.*data/,
    /compile.*summary|compile.*report/
  ];
  
  return documentPatterns.some(pattern => pattern.test(operationLower));
};

const getPluginColor = (plugin: string, isConnected: boolean) => {
  if (!isConnected) return 'gray'; // Gray for unconnected plugins
  
  const hash = plugin.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  
  const colors = ['blue', 'green', 'purple', 'red', 'orange', 'indigo', 'pink', 'teal'];
  return colors[Math.abs(hash) % colors.length];
};

const buildWorkflowNodes = (agent: Agent | null): ProcessingNode[] => {
  if (!agent?.workflow_steps) return [];
  
  const connectedPlugins = agent.connected_plugins || agent.plugins_required || [];
  
  return agent.workflow_steps.map((step, index) => {
    const totalSteps = agent.workflow_steps!.length;
    const xPercent = totalSteps === 1 ? 50 : (index / (totalSteps - 1)) * 70 + 15;
    
    // Use index as fallback if step.step is undefined
    const stepNumber = step.step ?? (index + 1);
    
    // Check if this is a document creation step (handled by AI, not a plugin)
    const isDocumentCreation = isDocumentCreationStep(step.operation || '');
    
    // For document creation, it's always "connected" since AI handles it naturally
    // For actual plugins, check if they're in the connected plugins list
    const isConnected = isDocumentCreation || connectedPlugins.includes(step.plugin);
    
    return {
      id: `step-${stepNumber}-${index}`, // Include index to ensure uniqueness
      step: stepNumber,
      title: step.operation || 'Untitled Step', // FIXED: Use step.operation instead of step.action
      plugin: step.plugin || 'unknown',
      pluginAction: step.plugin_action || 'unknown',
      validated: step.validated ?? false,
      isConnected: isConnected,
      icon: getPluginIcon(step.plugin || ''),
      color: getPluginColor(step.plugin || '', isConnected),
      position: { x: xPercent, y: 35 },
      processingTime: 2000 + (index * 500)
    };
  });
};

const ConnectionLine = ({ 
  fromX, 
  toX, 
  isActive, 
  containerWidth 
}: {
  fromX: number;
  toX: number;
  isActive: boolean;
  containerWidth: number;
}) => {
  const startX = (fromX / 100) * containerWidth;
  const endX = (toX / 100) * containerWidth;
  const y = (35 / 100) * 500; // Fixed Y position
  const length = Math.abs(endX - startX);

  return (
    <div
      className={`absolute transition-all duration-500 ${
        isActive ? 'opacity-100' : 'opacity-30'
      }`}
      style={{
        left: `${Math.min(startX, endX)}px`,
        top: `${y}px`,
        width: `${length}px`,
        height: '3px',
        background: isActive 
          ? 'linear-gradient(90deg, #3b82f6, #8b5cf6)' 
          : '#d1d5db',
        borderRadius: '2px',
        transform: 'translateY(-50%)'
      }}
    />
  );
};

export default function SimpleDynamicWorkflow({ agent }: { agent: Agent | null }) {
  const [activeNode, setActiveNode] = useState<string | null>(null);
  const [completedNodes, setCompletedNodes] = useState<string[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPhase, setCurrentPhase] = useState('');
  const [containerSize, setContainerSize] = useState({ width: 1000, height: 500 });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const nodes = buildWorkflowNodes(agent);
  const unconnectedPlugins = nodes.filter(node => !node.isConnected);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };
    
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const handlePlay = async () => {
    if (isPlaying || nodes.length === 0) return;
    
    setIsPlaying(true);
    setActiveNode(null);
    setCompletedNodes([]);
    setCurrentPhase('Starting workflow...');

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      
      setCurrentPhase(`Step ${node.step}: ${node.title}`);
      setActiveNode(node.id);
      
      await new Promise(resolve => setTimeout(resolve, node.processingTime));
      
      setCompletedNodes(prev => [...prev, node.id]);
      setActiveNode(null);
      
      if (i < nodes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    setCurrentPhase('Workflow completed!');
    setIsPlaying(false);
  };

  const handleReset = () => {
    setActiveNode(null);
    setCompletedNodes([]);
    setIsPlaying(false);
    setCurrentPhase('');
  };

  if (nodes.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
          <Settings className="h-8 w-8 text-gray-500" />
        </div>
        <p className="text-gray-500">No workflow steps found in agent data</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{agent?.agent_name}</h2>
          <p className="text-gray-600">{nodes.length} workflow steps</p>
        </div>
        
        <div className="flex gap-3">
          <button
            onClick={handleReset}
            disabled={isPlaying}
            className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 disabled:opacity-50 flex items-center gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
          <button
            onClick={handlePlay}
            disabled={isPlaying}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            <Play className="h-4 w-4" />
            {isPlaying ? 'Running...' : 'Start'}
          </button>
        </div>
      </div>

      {/* Warning for unconnected plugins */}
      {unconnectedPlugins.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="font-medium text-orange-900">Plugin Connection Required</h4>
              <p className="text-orange-700 text-sm mt-1">
                This workflow requires plugins that aren't connected: {' '}
                <span className="font-medium">
                  {unconnectedPlugins.map(node => node.plugin).join(', ')}
                </span>
              </p>
              <p className="text-orange-600 text-xs mt-2">
                Connect these plugins to enable full workflow execution.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Status */}
      {isPlaying && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <RefreshCw className="h-5 w-5 text-blue-600 animate-spin" />
            <span className="font-medium text-blue-900">{currentPhase}</span>
          </div>
        </div>
      )}

      {/* Workflow Visualization */}
      <div 
        ref={containerRef}
        className="relative w-full h-[500px] bg-gray-50 rounded-xl border border-gray-200"
      >
        {/* Connection Lines */}
        {nodes.map((node, index) => {
          if (index === nodes.length - 1) return null;
          const nextNode = nodes[index + 1];
          const isActive = completedNodes.includes(node.id) && 
                           (activeNode === nextNode.id || completedNodes.includes(nextNode.id));
          
          return (
            <ConnectionLine
              key={`line-${index}`}
              fromX={node.position.x}
              toX={nextNode.position.x}
              isActive={isActive}
              containerWidth={containerSize.width}
            />
          );
        })}

        {/* Workflow Nodes */}
        {nodes.map((node) => {
          const Icon = node.icon;
          const isActive = activeNode === node.id;
          const isCompleted = completedNodes.includes(node.id);
          
          const pixelX = (node.position.x / 100) * containerSize.width;
          const pixelY = (node.position.y / 100) * containerSize.height;

          return (
            <div key={node.id} className="absolute">
              {/* Node Circle */}
              <div
                className={`absolute transition-all duration-500 ${
                  isActive ? 'scale-110 z-20' : 'scale-100 z-10'
                }`}
                style={{
                  left: `${pixelX}px`,
                  top: `${pixelY}px`,
                  transform: 'translate(-50%, -50%)'
                }}
              >
                <div
                  className={`w-16 h-16 rounded-full border-4 flex items-center justify-center transition-all duration-500 ${
                    !node.isConnected
                      ? 'bg-gray-400 border-gray-300' // Gray for unconnected
                      : isActive 
                        ? `bg-${node.color}-500 border-${node.color}-300 shadow-lg` 
                        : isCompleted
                          ? 'bg-green-500 border-green-300 shadow-md'
                          : `bg-${node.color}-400 border-${node.color}-300`
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle className="h-8 w-8 text-white" />
                  ) : !node.isConnected ? (
                    <AlertTriangle className="h-8 w-8 text-white" />
                  ) : (
                    <Icon className="h-8 w-8 text-white" />
                  )}
                </div>

                {/* Step Number */}
                <div className="absolute -top-2 -right-2 w-6 h-6 bg-gray-800 text-white text-xs rounded-full flex items-center justify-center font-bold">
                  {node.step}
                </div>

                {/* Validation Check */}
                {node.validated && node.isConnected && (
                  <div className="absolute -top-1 -left-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center">
                    <CheckCircle className="h-3 w-3 text-white" />
                  </div>
                )}
              </div>

              {/* Node Info */}
              <div 
                className="absolute text-center"
                style={{
                  left: `${pixelX}px`,
                  top: `${pixelY + 50}px`,
                  transform: 'translateX(-50%)',
                  width: '200px'
                }}
              >
                <div className={`p-3 rounded-lg border transition-all duration-300 ${
                  isActive || isCompleted
                    ? 'bg-white border-gray-300 shadow-lg' 
                    : 'bg-gray-100 border-gray-200'
                }`}>
                  <div className="font-semibold text-sm text-gray-900 mb-1">
                    {node.title}
                  </div>
                  <div className="text-xs text-gray-600 mb-2">
                    {node.plugin} → {node.pluginAction}
                  </div>
                  {node.isConnected ? (
                    node.validated && (
                      <div className="text-xs text-green-600 font-medium">
                        ✓ Validated
                      </div>
                    )
                  ) : (
                    <div className="text-xs text-orange-600 font-medium">
                      ⚠ Plugin not connected
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Completion Status */}
      {completedNodes.length === nodes.length && !isPlaying && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-6 w-6 text-green-600" />
            <div>
              <h3 className="font-semibold text-green-900">Workflow Complete!</h3>
              <p className="text-green-700">All {nodes.length} steps executed successfully</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}