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
  AlertTriangle
} from 'lucide-react';

interface WorkflowStep {
  step?: number;
  type?: string; // Step type: plugin_action, ai_processing, conditional, etc.
  operation: string; // This is the correct field name from your data
  plugin?: string; // Optional for AI processing/conditional steps
  plugin_action?: string; // Optional for AI processing/conditional steps
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
  isConnected: boolean;
  isConditional: boolean; // Track if this is a conditional step
  branchPath?: 'yes' | 'no' | null; // Track which branch path this step is on
  icon: any;
  color: {
    bg: string;
    border: string;
    bgActive: string;
    borderActive: string;
  };
  position: { x: number; y: number };
  processingTime: number;
}

const getPluginIcon = (step: WorkflowStep) => {
  // For AI processing or conditional steps without plugins, use Brain icon
  if (!step.plugin || step.type === 'ai_processing' || step.type === 'conditional') {
    return Brain;
  }

  const plugin = step.plugin;
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

const getPluginColor = (step: WorkflowStep, isConnected: boolean) => {
  // AI processing/conditional steps always use purple color scheme
  if (!step.plugin || step.type === 'ai_processing' || step.type === 'conditional') {
    return {
      bg: 'bg-purple-400',
      border: 'border-purple-300',
      bgActive: 'bg-purple-500',
      borderActive: 'border-purple-300'
    };
  }

  if (!isConnected) {
    return {
      bg: 'bg-gray-400',
      border: 'border-gray-300',
      bgActive: 'bg-gray-500',
      borderActive: 'border-gray-300'
    };
  }

  const hash = step.plugin.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);

  const colorSchemes = [
    { bg: 'bg-blue-400', border: 'border-blue-300', bgActive: 'bg-blue-500', borderActive: 'border-blue-300' },
    { bg: 'bg-green-400', border: 'border-green-300', bgActive: 'bg-green-500', borderActive: 'border-green-300' },
    { bg: 'bg-purple-400', border: 'border-purple-300', bgActive: 'bg-purple-500', borderActive: 'border-purple-300' },
    { bg: 'bg-red-400', border: 'border-red-300', bgActive: 'bg-red-500', borderActive: 'border-red-300' },
    { bg: 'bg-orange-400', border: 'border-orange-300', bgActive: 'bg-orange-500', borderActive: 'border-orange-300' },
    { bg: 'bg-indigo-400', border: 'border-indigo-300', bgActive: 'bg-indigo-500', borderActive: 'border-indigo-300' },
    { bg: 'bg-pink-400', border: 'border-pink-300', bgActive: 'bg-pink-500', borderActive: 'border-pink-300' },
    { bg: 'bg-teal-400', border: 'border-teal-300', bgActive: 'bg-teal-500', borderActive: 'border-teal-300' }
  ];

  return colorSchemes[Math.abs(hash) % colorSchemes.length];
};

const buildWorkflowNodes = (agent: Agent | null): ProcessingNode[] => {
  if (!agent?.workflow_steps) return [];

  const connectedPlugins = agent.connected_plugins || agent.plugins_required || [];

  // First pass: identify conditional steps and calculate positions
  const nodesWithFlags = agent.workflow_steps.map((step, index) => {
    const stepNumber = step.step ?? (index + 1);
    const isDocumentCreation = isDocumentCreationStep(step.operation || '');
    const isAIStep = !step.plugin || step.type === 'ai_processing' || step.type === 'conditional';
    const isConnected = isAIStep || isDocumentCreation || (step.plugin ? connectedPlugins.includes(step.plugin) : false);

    let displayPlugin = '';
    let displayAction = '';
    let isConditional = false;

    if (step.plugin && step.plugin.trim() !== '') {
      displayPlugin = step.plugin;
      displayAction = step.plugin_action || 'unknown';
    } else if (isAIStep) {
      isConditional = step.operation && (
        step.operation.toLowerCase().includes('determine') ||
        step.operation.toLowerCase().includes('check if') ||
        step.operation.toLowerCase().includes('decide') ||
        step.operation.toLowerCase().includes('if ')
      );

      if (isConditional) {
        displayPlugin = 'Condition';
        displayAction = '';
      } else {
        displayPlugin = 'AI Processing';
        displayAction = 'process';
      }
    } else {
      displayPlugin = 'unknown';
      displayAction = 'unknown';
    }

    return {
      step,
      stepNumber,
      isConditional,
      isConnected,
      displayPlugin,
      displayAction,
      isDocumentCreation,
      isAIStep,
    };
  });

  // Second pass: calculate positions with proper branching
  const totalSteps = nodesWithFlags.length;
  const nodes: ProcessingNode[] = [];

  for (let index = 0; index < totalSteps; index++) {
    const { step, stepNumber, isConditional, isConnected, displayPlugin, displayAction } = nodesWithFlags[index];

    // Stretch to use maximum container width (5% to 95%)
    const xPercent = totalSteps === 1 ? 50 : (index / (totalSteps - 1)) * 90 + 5;
    let yPercent = 50; // Center position (use more vertical space)
    let branchPath: 'yes' | 'no' | null = null;

    // Position step after a conditional on the "Yes" path (upper)
    if (index > 0 && nodesWithFlags[index - 1].isConditional) {
      yPercent = 25; // Upper branch for "Yes" (use more vertical space)
      branchPath = 'yes';
    } else if (index > 1 && nodesWithFlags[index - 2].isConditional) {
      // Second step after conditional - return to center (reconverge point)
      yPercent = 50;
      branchPath = null;
    }

    nodes.push({
      id: `step-${stepNumber}-${index}`,
      step: stepNumber,
      title: step.operation || 'Untitled Step',
      plugin: displayPlugin,
      pluginAction: displayAction,
      validated: step.validated ?? false,
      isConnected: isConnected,
      isConditional: Boolean(isConditional),
      branchPath: branchPath,
      icon: getPluginIcon(step),
      color: getPluginColor(step, isConnected),
      position: { x: xPercent, y: yPercent },
      processingTime: 2000 + (index * 500)
    });
  }

  // Add virtual "No" path nodes for conditionals
  const nodesWithBranches: ProcessingNode[] = [];
  for (let i = 0; i < nodes.length; i++) {
    nodesWithBranches.push(nodes[i]);

    // If this is a conditional and there's a next step, create a virtual "No" branch node
    if (nodes[i].isConditional && i < nodes.length - 2) {
      const conditionalNode = nodes[i];
      const skipToNode = nodes[i + 2];

      // Create virtual node for "No" path visualization
      const noBranchNode: ProcessingNode = {
        id: `${conditionalNode.id}-no-branch`,
        step: 0, // Virtual step
        title: 'Skip (No)',
        plugin: '',
        pluginAction: '',
        validated: false,
        isConnected: true,
        isConditional: false,
        branchPath: 'no',
        icon: Brain,
        color: {
          bg: 'bg-gray-300',
          border: 'border-gray-200',
          bgActive: 'bg-gray-400',
          borderActive: 'border-gray-300'
        },
        position: {
          x: (conditionalNode.position.x + skipToNode.position.x) / 2,
          y: 55 // Lower branch for "No"
        },
        processingTime: 0
      };

      nodesWithBranches.push(noBranchNode);
    }
  }

  return nodes; // Return original nodes without virtual branches for now
};

const ConnectionLine = ({
  fromX,
  fromY,
  toX,
  toY,
  isActive,
  containerWidth,
  containerHeight,
  label,
  isConditionalBranch
}: {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  isActive: boolean;
  containerWidth: number;
  containerHeight: number;
  label?: string;
  isConditionalBranch?: boolean;
}) => {
  const startX = (fromX / 100) * containerWidth;
  const startY = (fromY / 100) * containerHeight;
  const endX = (toX / 100) * containerWidth;
  const endY = (toY / 100) * containerHeight;

  const midX = (startX + endX) / 2;

  // Create SVG path for curved line
  const pathData = `M ${startX} ${startY} Q ${midX} ${startY} ${midX} ${(startY + endY) / 2} Q ${midX} ${endY} ${endX} ${endY}`;

  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none"
      style={{
        width: containerWidth,
        height: containerHeight,
        zIndex: 1
      }}
    >
      <defs>
        <marker
          id="arrowhead"
          markerWidth="10"
          markerHeight="10"
          refX="9"
          refY="3"
          orient="auto"
        >
          <polygon
            points="0 0, 10 3, 0 6"
            fill={isActive ? '#8b5cf6' : '#d1d5db'}
            className="transition-all duration-500"
          />
        </marker>
      </defs>
      <path
        d={pathData}
        stroke={isActive ? (isConditionalBranch ? '#a855f7' : '#3b82f6') : '#d1d5db'}
        strokeWidth="3"
        fill="none"
        markerEnd="url(#arrowhead)"
        className={`transition-all duration-500 ${
          isActive ? 'opacity-100' : 'opacity-30'
        }`}
        strokeDasharray={isConditionalBranch ? '8,4' : 'none'}
      />
      {label && isConditionalBranch && (
        <text
          x={midX}
          y={(startY + endY) / 2 - 10}
          textAnchor="middle"
          className="text-xs font-medium fill-purple-600"
        >
          {label}
        </text>
      )}
    </svg>
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
          const connections = [];

          // For conditional nodes, only draw the "Yes" and "No" branches
          if (node.isConditional) {
            // Draw "Yes" branch to next step (upper path)
            if (index < nodes.length - 1) {
              const yesNode = nodes[index + 1];
              const isActive = completedNodes.includes(node.id) &&
                               (activeNode === yesNode.id || completedNodes.includes(yesNode.id));

              connections.push(
                <ConnectionLine
                  key={`line-${index}-yes`}
                  fromX={node.position.x}
                  fromY={node.position.y}
                  toX={yesNode.position.x}
                  toY={yesNode.position.y}
                  isActive={isActive}
                  containerWidth={containerSize.width}
                  containerHeight={containerSize.height}
                  label="Yes"
                  isConditionalBranch={true}
                />
              );
            }

            // Draw "No" branch that skips next step (lower path)
            if (index < nodes.length - 2) {
              const noNode = nodes[index + 2]; // Skip to step after next
              const midX = (node.position.x + noNode.position.x) / 2;

              connections.push(
                <svg
                  key={`line-${index}-no`}
                  className="absolute top-0 left-0 pointer-events-none"
                  style={{
                    width: containerSize.width,
                    height: containerSize.height,
                    zIndex: 1
                  }}
                >
                  <path
                    d={`M ${(node.position.x / 100) * containerSize.width} ${(node.position.y / 100) * containerSize.height}
                        Q ${(midX / 100) * containerSize.width} ${(75 / 100) * containerSize.height}
                        ${(noNode.position.x / 100) * containerSize.width} ${(noNode.position.y / 100) * containerSize.height}`}
                    stroke="#d1d5db"
                    strokeWidth="3"
                    fill="none"
                    markerEnd="url(#arrowhead)"
                    className="transition-all duration-500 opacity-30"
                    strokeDasharray="8,4"
                  />
                  <text
                    x={(midX / 100) * containerSize.width}
                    y={(75 / 100) * containerSize.height + 20}
                    textAnchor="middle"
                    className="text-xs font-medium fill-gray-500"
                  >
                    No
                  </text>
                </svg>
              );
            }
          }
          // For "Yes" path nodes, connect to reconverge point
          else if (node.branchPath === 'yes' && index < nodes.length - 1) {
            const reconvergeNode = nodes[index + 1];
            const isActive = completedNodes.includes(node.id) &&
                             (activeNode === reconvergeNode.id || completedNodes.includes(reconvergeNode.id));

            connections.push(
              <ConnectionLine
                key={`line-${index}-reconverge`}
                fromX={node.position.x}
                fromY={node.position.y}
                toX={reconvergeNode.position.x}
                toY={reconvergeNode.position.y}
                isActive={isActive}
                containerWidth={containerSize.width}
                containerHeight={containerSize.height}
                label={undefined}
                isConditionalBranch={false}
              />
            );
          }
          // For regular nodes (not conditional, not on yes path), connect to next node
          else if (!node.isConditional && node.branchPath !== 'yes' && index < nodes.length - 1) {
            const nextNode = nodes[index + 1];
            // Skip connection if next node is on "yes" path (already connected from conditional)
            if (nextNode.branchPath !== 'yes') {
              const isActive = completedNodes.includes(node.id) &&
                               (activeNode === nextNode.id || completedNodes.includes(nextNode.id));

              connections.push(
                <ConnectionLine
                  key={`line-${index}-regular`}
                  fromX={node.position.x}
                  fromY={node.position.y}
                  toX={nextNode.position.x}
                  toY={nextNode.position.y}
                  isActive={isActive}
                  containerWidth={containerSize.width}
                  containerHeight={containerSize.height}
                  label={undefined}
                  isConditionalBranch={false}
                />
              );
            }
          }

          return connections;
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
              {/* Node Shape - Diamond for conditionals, Circle for others */}
              <div
                className={`absolute transition-all duration-500 ${
                  isActive ? 'scale-110 z-20' : 'scale-100 z-10'
                }`}
                style={{
                  left: `${pixelX}px`,
                  top: `${pixelY}px`,
                  transform: 'translate(-50%, -50%)',
                  zIndex: 10
                }}
              >
                {node.isConditional ? (
                  // Diamond shape for conditional steps
                  <div
                    className={`w-20 h-20 border-4 flex items-center justify-center transition-all duration-500 ${
                      isCompleted
                        ? 'bg-green-500 border-green-300 shadow-md'
                        : isActive
                          ? `${node.color.bgActive} ${node.color.borderActive} shadow-lg`
                          : `${node.color.bg} ${node.color.border}`
                    }`}
                    style={{
                      transform: 'rotate(45deg)',
                      borderRadius: '8px'
                    }}
                  >
                    <div style={{ transform: 'rotate(-45deg)' }}>
                      {isCompleted ? (
                        <CheckCircle className="h-8 w-8 text-white" />
                      ) : (
                        <Icon className="h-8 w-8 text-white" />
                      )}
                    </div>
                  </div>
                ) : (
                  // Circle for regular steps
                  <div
                    className={`w-16 h-16 rounded-full border-4 flex items-center justify-center transition-all duration-500 ${
                      isCompleted
                        ? 'bg-green-500 border-green-300 shadow-md'
                        : isActive
                          ? `${node.color.bgActive} ${node.color.borderActive} shadow-lg`
                          : `${node.color.bg} ${node.color.border}`
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
                )}

                {/* Step Number */}
                <div
                  className="absolute w-6 h-6 bg-gray-800 text-white text-xs rounded-full flex items-center justify-center font-bold"
                  style={{
                    top: node.isConditional ? '-8px' : '-8px',
                    right: node.isConditional ? '-8px' : '-8px',
                  }}
                >
                  {node.step}
                </div>

                {/* Validation Check */}
                {node.validated && node.isConnected && !node.isConditional && (
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
                  {node.plugin && (
                    <div className="text-xs text-gray-600 mb-2">
                      {node.pluginAction ? `${node.plugin} → ${node.pluginAction}` : node.plugin}
                    </div>
                  )}
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