import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  ArrowRight,
  ArrowDown,
  Database,
  Filter,
  Zap,
  CheckCircle,
  Send,
  Clock,
  Settings,
  Eye,
  EyeOff,
  AlertTriangle,
  Info,
  GitBranch,
  Shuffle,
  Play,
  Pause,
  RotateCcw
} from 'lucide-react';

interface DataPoint {
  id: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  value?: any;
  source?: string;
  timestamp?: number;
}

interface DataFlowConnection {
  id: string;
  fromStepId: string;
  toStepId: string;
  fromPort: string;
  toPort: string;
  data: DataPoint[];
  status: 'idle' | 'flowing' | 'complete' | 'error';
  delay?: number;
}

interface DataFlowStepProps {
  id: string;
  name: string;
  type: 'input' | 'transform' | 'filter' | 'output' | 'branch' | 'merge';
  position: { x: number; y: number };
  inputs: string[];
  outputs: string[];
  config?: Record<string, any>;
  status: 'idle' | 'running' | 'complete' | 'error' | 'paused';
  data?: DataPoint[];
  connections?: DataFlowConnection[];
  onConfigChange?: (stepId: string, config: Record<string, any>) => void;
  onConnect?: (fromStep: string, fromPort: string, toStep: string, toPort: string) => void;
  onDataInspect?: (stepId: string, data: DataPoint[]) => void;
  onStatusChange?: (stepId: string, status: string) => void;
  isSelected?: boolean;
  onSelect?: (stepId: string) => void;
}

const stepTypeConfig = {
  input: { icon: Database, color: 'blue', label: 'Data Input' },
  transform: { icon: Zap, color: 'purple', label: 'Transform' },
  filter: { icon: Filter, color: 'green', label: 'Filter' },
  output: { icon: Send, color: 'orange', label: 'Output' },
  branch: { icon: GitBranch, color: 'yellow', label: 'Branch' },
  merge: { icon: Shuffle, color: 'pink', label: 'Merge' }
};

const statusConfig = {
  idle: { color: 'gray', icon: Clock, label: 'Idle' },
  running: { color: 'blue', icon: Play, label: 'Running' },
  complete: { color: 'green', icon: CheckCircle, label: 'Complete' },
  error: { color: 'red', icon: AlertTriangle, label: 'Error' },
  paused: { color: 'yellow', icon: Pause, label: 'Paused' }
};

const DataFlowStep: React.FC<DataFlowStepProps> = ({
  id,
  name,
  type,
  position,
  inputs,
  outputs,
  config = {},
  status,
  data = [],
  connections = [],
  onConfigChange,
  onConnect,
  onDataInspect,
  onStatusChange,
  isSelected = false,
  onSelect
}) => {
  const [showConfig, setShowConfig] = useState(false);
  const [showDataPreview, setShowDataPreview] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const stepRef = useRef<HTMLDivElement>(null);

  const typeConfig = stepTypeConfig[type];
  const currentStatus = statusConfig[status];
  const TypeIcon = typeConfig.icon;
  const StatusIcon = currentStatus.icon;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === stepRef.current || (e.target as HTMLElement).closest('.drag-handle')) {
      setIsDragging(true);
      const rect = stepRef.current?.getBoundingClientRect();
      if (rect) {
        setDragOffset({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        });
      }
      onSelect?.(id);
    }
  }, [id, onSelect]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging && stepRef.current) {
      const newX = e.clientX - dragOffset.x;
      const newY = e.clientY - dragOffset.y;
      stepRef.current.style.transform = `translate(${newX}px, ${newY}px)`;
    }
  }, [isDragging, dragOffset]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const getColorClasses = (colorName: string) => {
    const colorMap: Record<string, string> = {
      blue: 'bg-blue-50 border-blue-200 text-blue-700',
      purple: 'bg-purple-50 border-purple-200 text-purple-700',
      green: 'bg-green-50 border-green-200 text-green-700',
      orange: 'bg-orange-50 border-orange-200 text-orange-700',
      yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
      pink: 'bg-pink-50 border-pink-200 text-pink-700',
      gray: 'bg-gray-50 border-gray-200 text-gray-700',
      red: 'bg-red-50 border-red-200 text-red-700'
    };
    return colorMap[colorName] || colorMap.gray;
  };

  const getStatusIndicator = () => {
    if (status === 'running') {
      return (
        <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-pulse">
          <div className="absolute inset-0 bg-blue-500 rounded-full animate-ping opacity-75"></div>
        </div>
      );
    }
    return null;
  };

  const formatDataPreview = (data: DataPoint[]) => {
    if (data.length === 0) return 'No data';
    if (data.length === 1) {
      const item = data[0];
      return `${item.name}: ${typeof item.value === 'object' ? JSON.stringify(item.value).slice(0, 50) + '...' : item.value}`;
    }
    return `${data.length} data points`;
  };

  return (
    <div
      ref={stepRef}
      className={`absolute select-none transition-all duration-200 ${isDragging ? 'z-50' : 'z-10'}`}
      style={{ 
        transform: `translate(${position.x}px, ${position.y}px)`,
        cursor: isDragging ? 'grabbing' : 'grab'
      }}
      onMouseDown={handleMouseDown}
    >
      <div
        className={`relative bg-white border-2 rounded-lg shadow-lg min-w-48 transition-all ${
          isSelected ? 'border-blue-500 shadow-blue-200' : 'border-gray-300'
        } ${getColorClasses(typeConfig.color)} hover:shadow-xl`}
      >
        {getStatusIndicator()}
        
        {/* Input Ports */}
        {inputs.map((input, index) => (
          <div
            key={`input-${input}`}
            className="absolute w-3 h-3 bg-gray-400 border-2 border-white rounded-full cursor-pointer hover:bg-blue-500 transition-colors"
            style={{
              left: -6,
              top: 20 + (index * 25)
            }}
            title={`Input: ${input}`}
          />
        ))}

        {/* Output Ports */}
        {outputs.map((output, index) => (
          <div
            key={`output-${output}`}
            className="absolute w-3 h-3 bg-gray-400 border-2 border-white rounded-full cursor-pointer hover:bg-green-500 transition-colors"
            style={{
              right: -6,
              top: 20 + (index * 25)
            }}
            title={`Output: ${output}`}
          />
        ))}

        <div className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-2 drag-handle">
            <div className="flex items-center space-x-2">
              <TypeIcon className="w-4 h-4" />
              <span className="text-xs font-medium uppercase tracking-wide opacity-75">
                {typeConfig.label}
              </span>
            </div>
            <div className="flex items-center space-x-1">
              <StatusIcon className={`w-4 h-4 text-${currentStatus.color}-600`} />
              <span className={`text-xs font-medium text-${currentStatus.color}-600`}>
                {currentStatus.label}
              </span>
            </div>
          </div>

          {/* Step Name */}
          <h3 className="font-semibold text-gray-900 mb-2 text-sm">{name}</h3>

          {/* Data Preview */}
          {data.length > 0 && (
            <div className="mb-3 p-2 bg-gray-50 rounded text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-gray-600">Data:</span>
                <button
                  onClick={() => setShowDataPreview(!showDataPreview)}
                  className="text-blue-600 hover:text-blue-700"
                >
                  {showDataPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </div>
              <div className="text-gray-700">
                {showDataPreview ? (
                  <div className="space-y-1 max-h-20 overflow-y-auto">
                    {data.slice(0, 3).map(item => (
                      <div key={item.id} className="truncate">
                        <span className="font-mono text-xs">
                          {item.name}: {typeof item.value === 'string' ? `"${item.value}"` : String(item.value)}
                        </span>
                      </div>
                    ))}
                    {data.length > 3 && (
                      <div className="text-gray-500">...and {data.length - 3} more</div>
                    )}
                  </div>
                ) : (
                  <div className="truncate">{formatDataPreview(data)}</div>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between text-xs">
            <div className="flex space-x-1">
              <button
                onClick={() => setShowConfig(!showConfig)}
                className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                title="Configure"
              >
                <Settings className="w-3 h-3" />
              </button>
              
              {data.length > 0 && (
                <button
                  onClick={() => onDataInspect?.(id, data)}
                  className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                  title="Inspect Data"
                >
                  <Info className="w-3 h-3" />
                </button>
              )}

              {status === 'running' && (
                <button
                  onClick={() => onStatusChange?.(id, 'paused')}
                  className="p-1 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded"
                  title="Pause"
                >
                  <Pause className="w-3 h-3" />
                </button>
              )}

              {(status === 'paused' || status === 'error') && (
                <button
                  onClick={() => onStatusChange?.(id, 'running')}
                  className="p-1 text-green-500 hover:text-green-700 hover:bg-green-50 rounded"
                  title="Resume"
                >
                  <Play className="w-3 h-3" />
                </button>
              )}

              {status === 'complete' && (
                <button
                  onClick={() => onStatusChange?.(id, 'idle')}
                  className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                  title="Reset"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="text-gray-500">
              {inputs.length > 0 && (
                <span className="mr-2">{inputs.length} in</span>
              )}
              {outputs.length > 0 && (
                <span>{outputs.length} out</span>
              )}
            </div>
          </div>
        </div>

        {/* Configuration Panel */}
        {showConfig && (
          <div className="border-t bg-gray-50 p-3 rounded-b-lg">
            <h4 className="text-xs font-medium text-gray-700 mb-2">Configuration</h4>
            <div className="space-y-2 text-xs">
              {Object.keys(config).length === 0 ? (
                <p className="text-gray-500 italic">No configuration options</p>
              ) : (
                Object.entries(config).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span className="font-medium text-gray-600">{key}:</span>
                    <span className="text-gray-800 font-mono">
                      {typeof value === 'string' ? `"${value}"` : String(value)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Connection Flow Indicators */}
        {connections.map(conn => {
          if (conn.fromStepId === id && conn.status === 'flowing') {
            return (
              <div
                key={conn.id}
                className="absolute -right-2 top-1/2 transform -translate-y-1/2"
              >
                <div className="flex items-center text-blue-500">
                  <Zap className="w-3 h-3 animate-pulse" />
                  <ArrowRight className="w-3 h-3 ml-1" />
                </div>
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
};

// Example usage component
const DataFlowCanvas: React.FC = () => {
  const [steps, setSteps] = useState([
    {
      id: 'step1',
      name: 'Data Source',
      type: 'input' as const,
      position: { x: 50, y: 100 },
      inputs: [],
      outputs: ['data'],
      status: 'complete' as const,
      data: [
        { id: 'data1', name: 'users', type: 'array' as const, value: [{ id: 1, name: 'John' }, { id: 2, name: 'Jane' }] }
      ]
    },
    {
      id: 'step2',
      name: 'Filter Active',
      type: 'filter' as const,
      position: { x: 300, y: 100 },
      inputs: ['data'],
      outputs: ['filtered'],
      status: 'running' as const,
      config: { condition: 'active === true' },
      data: [
        { id: 'data2', name: 'active_users', type: 'array' as const, value: [{ id: 1, name: 'John' }] }
      ]
    },
    {
      id: 'step3',
      name: 'Transform Names',
      type: 'transform' as const,
      position: { x: 550, y: 100 },
      inputs: ['filtered'],
      outputs: ['transformed'],
      status: 'idle' as const,
      config: { operation: 'map', field: 'name' }
    },
    {
      id: 'step4',
      name: 'Export Results',
      type: 'output' as const,
      position: { x: 800, y: 100 },
      inputs: ['transformed'],
      outputs: [],
      status: 'idle' as const,
      config: { format: 'json', destination: 'api' }
    }
  ]);

  const [selectedStep, setSelectedStep] = useState<string | null>(null);

  const handleStepSelect = (stepId: string) => {
    setSelectedStep(stepId);
  };

  const handleStatusChange = (stepId: string, newStatus: string) => {
    setSteps(prev => prev.map(step => 
      step.id === stepId ? { ...step, status: newStatus as any } : step
    ));
  };

  const handleDataInspect = (stepId: string, data: any[]) => {
    console.log(`Inspecting data for ${stepId}:`, data);
  };

  return (
    <div className="relative w-full h-96 bg-gray-100 border border-gray-300 rounded-lg overflow-hidden">
      <div className="absolute top-4 left-4 text-sm text-gray-600 bg-white px-3 py-1 rounded shadow">
        DataFlow Canvas - Click and drag steps
      </div>
      
      {steps.map(step => (
        <DataFlowStep
          key={step.id}
          id={step.id}
          name={step.name}
          type={step.type}
          position={step.position}
          inputs={step.inputs}
          outputs={step.outputs}
          status={step.status}
          config={step.config}
          data={step.data}
          isSelected={selectedStep === step.id}
          onSelect={handleStepSelect}
          onStatusChange={handleStatusChange}
          onDataInspect={handleDataInspect}
        />
      ))}

      {/* Connection lines (simplified) */}
      <svg className="absolute inset-0 pointer-events-none">
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" 
                  refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#6b7280" />
          </marker>
        </defs>
        
        {/* Example connections */}
        <line x1="242" y1="125" x2="300" y2="125" 
              stroke="#6b7280" strokeWidth="2" markerEnd="url(#arrowhead)" />
        <line x1="542" y1="125" x2="550" y2="125" 
              stroke="#6b7280" strokeWidth="2" markerEnd="url(#arrowhead)" />
        <line x1="742" y1="125" x2="800" y2="125" 
              stroke="#6b7280" strokeWidth="2" markerEnd="url(#arrowhead)" />
      </svg>
    </div>
  );
};

export default DataFlowCanvas;