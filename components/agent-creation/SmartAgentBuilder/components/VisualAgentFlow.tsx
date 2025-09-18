import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  RotateCcw,
  CheckCircle,
  Brain,
  Database,
  MessageSquare,
  Send,
  FileText,
  Mail,
  Globe,
  Settings,
  BarChart3,
  Network,
  Activity,
  Star,
  Clock,
  ArrowRight,
  Users,
  Zap,
  Target,
  TrendingUp,
  Shield,
  Lightbulb,
  Workflow,
  Code,
  Filter,
  Search,
  Cpu,
  Eye,
  Download,
  Upload,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

interface Agent {
  agent_name: string;
  description: string;
  system_prompt: string;
  user_prompt?: string;
  input_schema: Array<{
    name: string;
    type: string;
    description: string;
    required?: boolean;
  }>;
  plugins_required: string[];
}

interface DataFlow {
  id: string;
  from: string;
  to: string;
  data: string;
  color: string;
  delay: number;
}

interface ProcessingNode {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  icon: any;
  color: string;
  bgColor?: string;
  position: { x: number; y: number };
  size: number;
  inputs: string[];
  outputs: string[];
  plugins: string[];
  processingTime: number;
  category: 'input' | 'processing' | 'integration' | 'analysis' | 'output' | 'delivery';
}

const buildAgentWorkflow = (agent: Agent | null): { nodes: ProcessingNode[], flows: DataFlow[] } => {
  if (!agent) return { nodes: [], flows: [] };

  const nodes: ProcessingNode[] = [];
  const flows: DataFlow[] = [];
  const systemPrompt = agent.system_prompt || '';
  const plugins = agent.plugins_required || [];
  const inputSchema = agent.input_schema || [];

  console.log('Parsing prompt:', systemPrompt);

  // Parse the system prompt to extract workflow steps
  const parseWorkflowSteps = (prompt: string) => {
    const steps = [];
    
    // First try the ** format (structured)
    const sectionMatches = prompt.match(/\*\*([^*]+?)\*\*([^*]+?)(?=\*\*|$)/g);
    
    if (sectionMatches && sectionMatches.length > 0) {
      for (const match of sectionMatches) {
        const titleMatch = match.match(/\*\*([^*]+?)\*\*/);
        if (!titleMatch) continue;
        
        const title = titleMatch[1].trim().replace(':', '');
        const content = match.replace(/\*\*[^*]+?\*\*/, '').trim();
        
        if (!title || !content) continue;
        
        // Extract bullet points
        const bulletPoints = [];
        const bulletMatches = content.match(/•([^•]+?)(?=•|$)/g);
        
        if (bulletMatches) {
          for (const bullet of bulletMatches) {
            const cleanBullet = bullet.replace('•', '').trim();
            if (cleanBullet && !cleanBullet.match(/^\*\*/)) {
              bulletPoints.push(cleanBullet);
            }
          }
        } else {
          bulletPoints.push(content);
        }
        
        steps.push({
          title: title,
          content: content,
          bulletPoints: bulletPoints
        });
      }
    } else {
      // Parse narrative-style prompts by identifying key workflow components
      const text = prompt.toLowerCase();
      const originalPrompt = prompt;
      
      // Identify main workflow steps from narrative
      const workflowSteps = [];
      
      // 1. Input/Source step
      if (text.includes('reads') || text.includes('file') || text.includes('pdf') || text.includes('storage')) {
        const sourceMatch = originalPrompt.match(/(reads?.*?(?:file|pdf|storage).*?)(?:\.|,|;)/i);
        workflowSteps.push({
          title: 'Data Source',
          content: sourceMatch ? sourceMatch[1] : 'Read PDF file from storage',
          bulletPoints: [sourceMatch ? sourceMatch[1] : 'Read PDF file from storage'],
          type: 'input'
        });
      }
      
      // 2. Trigger/Schedule step  
      if (text.includes('daily') || text.includes('time') || text.includes('schedule')) {
        const scheduleMatch = originalPrompt.match(/(daily.*?(?:time|schedule).*?)(?:\.|,|;)/i);
        workflowSteps.push({
          title: 'Trigger Conditions',
          content: scheduleMatch ? scheduleMatch[1] : 'Activate daily at specified time',
          bulletPoints: [scheduleMatch ? scheduleMatch[1] : 'Activate daily at specified time'],
          type: 'input'
        });
      }
      
      // 3. Processing step
      if (text.includes('summariz') || text.includes('process') || text.includes('analyz') || text.includes('gpt') || text.includes('chatgpt')) {
        const processMatch = originalPrompt.match(/(summariz.*?(?:content|using|chatgpt).*?)(?:\.|,|;)/i);
        workflowSteps.push({
          title: 'Processing Steps',
          content: processMatch ? processMatch[1] : 'Summarize content using chatgpt-research',
          bulletPoints: [
            'Load the PDF file',
            processMatch ? processMatch[1] : 'Summarize content using chatgpt-research'
          ],
          type: 'processing'
        });
      }
      
      // 4. Output/Delivery step
      if (text.includes('email') || text.includes('send') || text.includes('deliver')) {
        const emailMatch = originalPrompt.match(/(email.*?summary|send.*?summary|deliver.*?summary)/i);
        workflowSteps.push({
          title: 'Delivery Method',
          content: emailMatch ? emailMatch[1] : 'Send summary via email',
          bulletPoints: [emailMatch ? emailMatch[1] : 'Send summary via email'],
          type: 'delivery'
        });
      }
      
      // 5. Error handling step
      if (text.includes('error') || text.includes('fail') || text.includes('retry') || text.includes('alert')) {
        const errorMatch = originalPrompt.match(/(if.*?(?:error|fail|cannot).*?)(?:\.|$)/i);
        workflowSteps.push({
          title: 'Error Handling',
          content: errorMatch ? errorMatch[1] : 'Handle errors and retry logic',
          bulletPoints: [
            'Send error alert if PDF cannot be loaded',
            'Retry after 10 minutes if email fails'
          ],
          type: 'delivery'
        });
      }
      
      steps.push(...workflowSteps);
    }
    
    return steps;
  };

  const workflowSteps = parseWorkflowSteps(systemPrompt);
  console.log('Parsed workflow nodes:', workflowSteps);
  
  // Helper function to determine node category and properties from step content
  const categorizeStep = (stepTitle: string, content: string, bulletPoints: string[], stepType?: string) => {
    const title = stepTitle.toLowerCase();
    const bullets = bulletPoints.join(' ').toLowerCase();
    
    // Use stepType if provided (from narrative parsing)
    if (stepType) {
      switch (stepType) {
        case 'input':
          return {
            category: 'input' as const,
            icon: bullets.includes('pdf') || title.includes('source') ? FileText :
                  title.includes('trigger') || title.includes('schedule') ? Clock : Database,
            color: title.includes('trigger') ? 'green' : 'blue',
            bgColor: title.includes('trigger') ? 'from-green-400 to-green-600' : 'from-blue-400 to-blue-600',
            size: 60
          };
        case 'processing':
          return {
            category: 'processing' as const,
            icon: Brain,
            color: 'emerald',
            bgColor: 'from-emerald-400 to-emerald-600',
            size: 65
          };
        case 'delivery':
          return {
            category: 'delivery' as const,
            icon: bullets.includes('email') || bullets.includes('mail') ? Mail :
                  title.includes('error') ? AlertCircle : Send,
            color: title.includes('error') ? 'red' : 'purple',
            bgColor: title.includes('error') ? 'from-red-400 to-red-600' : 'from-purple-400 to-purple-600',
            size: title.includes('error') ? 50 : 55
          };
      }
    }
    
    // Original logic for structured prompts
    if (title.includes('data source') || title.includes('source')) {
      return {
        category: 'input' as const,
        icon: bullets.includes('pdf') ? FileText : 
              bullets.includes('database') ? Database :
              bullets.includes('api') ? Network : Upload,
        color: 'blue',
        bgColor: 'from-blue-400 to-blue-600',
        size: 60
      };
    } else if (title.includes('trigger') || title.includes('condition') || title.includes('schedule')) {
      return {
        category: 'input' as const,
        icon: Clock,
        color: 'green',
        bgColor: 'from-green-400 to-green-600',
        size: 55
      };
    } else if (title.includes('processing') || title.includes('step')) {
      const isAI = bullets.includes('gpt') || bullets.includes('ai') || 
                   bullets.includes('summarize') || bullets.includes('analyze') ||
                   bullets.includes('chatgpt') || bullets.includes('openai');
      return {
        category: 'processing' as const,
        icon: isAI ? Brain : Cpu,
        color: 'emerald',
        bgColor: 'from-emerald-400 to-emerald-600',
        size: isAI ? 65 : 60
      };
    } else if (title.includes('output') || title.includes('creation') || title.includes('generat')) {
      return {
        category: 'output' as const,
        icon: bullets.includes('chart') || bullets.includes('visual') ? BarChart3 : 
              bullets.includes('pdf') || bullets.includes('report') ? FileText : Download,
        color: 'orange',
        bgColor: 'from-orange-400 to-orange-600',
        size: 60
      };
    } else if (title.includes('delivery') || title.includes('method') || title.includes('send')) {
      return {
        category: 'delivery' as const,
        icon: bullets.includes('email') || bullets.includes('mail') ? Mail :
              bullets.includes('slack') || bullets.includes('teams') ? MessageSquare : Send,
        color: 'purple',
        bgColor: 'from-purple-400 to-purple-600',
        size: 55
      };
    } else if (title.includes('error') || title.includes('handling') || title.includes('retry')) {
      return {
        category: 'delivery' as const,
        icon: AlertCircle,
        color: 'red',
        bgColor: 'from-red-400 to-red-600',
        size: 50
      };
    }
    
    return {
      category: 'processing' as const,
      icon: Settings,
      color: 'gray',
      bgColor: 'from-gray-400 to-gray-600',
      size: 60
    };
  };

  // Create nodes based on parsed workflow steps - horizontal layout
  const getHorizontalPosition = (index: number, total: number, containerWidth: number) => {
    const availableWidth = containerWidth - 260; // Leave 130px padding on each side
    const nodeSpacing = total > 1 ? availableWidth / (total - 1) : 0;
    const x = 130 + (index * nodeSpacing); // Start at 130px from left
    const y = 80; // Position higher in the taller container
    return { x, y };
  };

  workflowSteps.forEach((step, index) => {
    const stepProps = categorizeStep(step.title, step.content, step.bulletPoints, step.type);
    
    // Simple percentage-based positioning - evenly distribute across width
    const totalSteps = workflowSteps.length;
    const xPercent = totalSteps === 1 ? 50 : (index / (totalSteps - 1)) * 80 + 10; // 10% to 90% width
    const position = { x: xPercent, y: 20 }; // Use percentages, 20% from top
    
    const outputs = step.bulletPoints.length > 0 ? 
      step.bulletPoints.map(bp => bp.length > 50 ? bp.substring(0, 47) + '...' : bp) : 
      [`${step.title} Result`];
    
    const inputs = index === 0 ? ['User Request'] : [`${workflowSteps[index - 1].title} Output`];
    
    const stepPlugins = plugins.filter(plugin => {
      const pluginName = plugin.toLowerCase().replace(/[_-]/g, ' ');
      const stepText = (step.content + ' ' + step.bulletPoints.join(' ')).toLowerCase();
      
      return stepText.includes(pluginName) ||
             stepText.includes(plugin.toLowerCase()) ||
             (plugin.includes('mail') && stepText.includes('email')) ||
             (plugin.includes('gpt') && stepText.includes('chatgpt')) ||
             (plugin.includes('file') && stepText.includes('pdf')) ||
             (plugin.includes('research') && stepText.includes('summarize'));
    });

    nodes.push({
      id: `step-${index}`,
      title: step.title,
      subtitle: `${step.bulletPoints.length} action${step.bulletPoints.length !== 1 ? 's' : ''}`,
      description: step.bulletPoints.length > 0 ? 
        step.bulletPoints.slice(0, 3).join(' • ') : 
        step.content.slice(0, 100) + (step.content.length > 100 ? '...' : ''),
      icon: stepProps.icon,
      color: stepProps.color,
      bgColor: stepProps.bgColor,
      position: position,
      size: stepProps.size,
      inputs: inputs,
      outputs: outputs,
      plugins: stepPlugins,
      processingTime: stepProps.category === 'processing' ? 3000 : 
                     stepProps.category === 'input' ? 1000 :
                     stepProps.category === 'delivery' ? 1500 : 2000,
      category: stepProps.category
    });

    if (index > 0) {
      flows.push({
        id: `step-${index-1}-to-step-${index}`,
        from: `step-${index-1}`,
        to: `step-${index}`,
        data: step.bulletPoints[0] || step.title,
        color: stepProps.color,
        delay: (index * 800) + 300
      });
    }
  });

  // Fallback workflow if no steps found
  if (workflowSteps.length === 0) {
    const inputFields = inputSchema.length > 0 ? inputSchema.map(f => f.name) : ['user_request'];
    
    const fallbackNodes = [
      {
        id: 'input',
        title: 'User Input',
        subtitle: `${inputFields.length} parameters`,
        description: 'Receives and validates user input parameters',
        icon: MessageSquare,
        color: 'blue',
        bgColor: 'from-blue-400 to-blue-600',
        position: { x: 20, y: 20 }, // 20% from left, 20% from top
        size: 60,
        inputs: ['Raw User Request'],
        outputs: inputFields,
        plugins: [],
        processingTime: 500,
        category: 'input' as const
      },
      {
        id: 'processing',
        title: 'AI Processing',
        subtitle: 'Language Model',
        description: 'Processes information using advanced language understanding',
        icon: Brain,
        color: 'emerald',
        bgColor: 'from-emerald-400 to-emerald-600',
        position: { x: 50, y: 20 }, // 50% from left (center), 20% from top
        size: 65,
        inputs: inputFields,
        outputs: ['AI Results', 'Processed Data'],
        plugins: [],
        processingTime: 3000,
        category: 'processing' as const
      },
      {
        id: 'output',
        title: 'Output Generation',
        subtitle: 'Result Formatting',
        description: 'Formats and delivers the final results',
        icon: Send,
        color: 'purple',
        bgColor: 'from-purple-400 to-purple-600',
        position: { x: 80, y: 20 }, // 80% from left, 20% from top
        size: 60,
        inputs: ['AI Results'],
        outputs: ['Final Output'],
        plugins: plugins,
        processingTime: 1500,
        category: 'output' as const
      }
    ];

    nodes.push(...fallbackNodes);

    flows.push(
      {
        id: 'input-processing',
        from: 'input',
        to: 'processing', 
        data: 'Input Data',
        color: 'emerald',
        delay: 600
      },
      {
        id: 'processing-output',
        from: 'processing',
        to: 'output',
        data: 'Processed Results',
        color: 'purple', 
        delay: 3800
      }
    );
  }

  return { nodes, flows };
};

// Connection line component
const ConnectionLine = ({ 
  fromNode, 
  toNode, 
  isActive, 
  containerWidth, 
  containerHeight 
}: {
  fromNode: ProcessingNode;
  toNode: ProcessingNode;
  isActive: boolean;
  containerWidth: number;
  containerHeight: number;
}) => {
  // Use percentage positioning
  const fromX = (fromNode.position.x / 100) * containerWidth;
  const fromY = (fromNode.position.y / 100) * containerHeight;
  const toX = (toNode.position.x / 100) * containerWidth;
  const toY = (toNode.position.y / 100) * containerHeight;

  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  return (
    <div
      className={`absolute z-10 transition-all duration-500 ${
        isActive ? 'opacity-100' : 'opacity-20'
      }`}
      style={{
        left: `${fromX}px`,
        top: `${fromY}px`,
        width: `${length}px`,
        height: '4px',
        background: isActive 
          ? `linear-gradient(90deg, #3b82f6, #8b5cf6, #06b6d4)` 
          : '#d1d5db',
        transform: `rotate(${angle}deg)`,
        transformOrigin: '0 50%',
        borderRadius: '2px',
        boxShadow: isActive ? '0 0 20px rgba(59, 130, 246, 0.5)' : 'none'
      }}
    />
  );
};

export default function VisualAgentFlow({ 
  agent, 
  autoPlay = false 
}: { 
  agent: Agent | null; 
  autoPlay?: boolean;
}) {
  const [activeNodes, setActiveNodes] = useState<string[]>([]);
  const [completedNodes, setCompletedNodes] = useState<string[]>([]);
  const [activeFlows, setActiveFlows] = useState<string[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPhase, setCurrentPhase] = useState('');
  const [containerSize, setContainerSize] = useState({ width: 1000, height: 600 });
  const [processingStats, setProcessingStats] = useState({ processed: 0, total: 0 });
  
  const containerRef = useRef<HTMLDivElement>(null);

  // Demo agent with your actual prompt format
  const demoAgent: Agent = {
    agent_name: "Daily PDF Summary Agent", 
    description: "This agent reads a specific PDF file from storage daily at a specified time, summarizes the content using chatgpt-research, and emails the summary",
    system_prompt: "This agent reads a specific PDF file from storage daily at a specified time, summarizes the content using chatgpt-research, and emails the summary. If the PDF cannot be loaded, an error alert is sent. If the email fails, it retries after 10 minutes.",
    input_schema: [
      { name: "pdf_file_path", type: "string", description: "Path to the PDF file to analyze", required: true },
      { name: "email_address", type: "string", description: "Email address for delivery", required: true },
      { name: "schedule_time", type: "string", description: "Daily activation time", required: false }
    ],
    plugins_required: [
      "file_reader", 
      "chatgpt_research", 
      "google_mail"
    ]
  };

  const currentAgent = agent || demoAgent;
  const { nodes, flows } = buildAgentWorkflow(currentAgent);

  // Update container size
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

  useEffect(() => {
    if (autoPlay && nodes.length > 0) {
      const timer = setTimeout(handlePlay, 1000);
      return () => clearTimeout(timer);
    }
  }, [autoPlay, nodes.length]);

  const handlePlay = async () => {
    if (isPlaying) return;
    
    setIsPlaying(true);
    setActiveNodes([]);
    setCompletedNodes([]);
    setActiveFlows([]);
    setCurrentPhase('Initializing workflow...');
    setProcessingStats({ processed: 0, total: nodes.length });

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      
      setCurrentPhase(`Processing ${node.title}`);
      setActiveNodes([node.id]);
      
      const incomingFlows = flows.filter(f => f.to === node.id);
      setActiveFlows(prev => [...prev, ...incomingFlows.map(f => f.id)]);
      
      await new Promise(resolve => setTimeout(resolve, node.processingTime));
      
      setCompletedNodes(prev => [...prev, node.id]);
      setProcessingStats(prev => ({ ...prev, processed: prev.processed + 1 }));
      
      if (i < nodes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setCurrentPhase('Workflow Complete!');
    setIsPlaying(false);
    setActiveNodes([]);
  };

  const getNodeStatus = (nodeId: string) => {
    if (completedNodes.includes(nodeId)) return 'completed';
    if (activeNodes.includes(nodeId)) return 'active';
    return 'dormant';
  };

  if (nodes.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-20 h-20 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-6">
          <Workflow className="h-10 w-10 text-gray-400" />
        </div>
        <h3 className="text-xl font-semibold text-gray-600 mb-2">No Workflow Steps Found</h3>
        <p className="text-gray-500 mb-4">
          Configure your agent to see its workflow visualization
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 via-purple-600 to-cyan-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Brain className="h-6 w-6 text-white" />
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-1">
                {currentAgent.agent_name}
              </h1>
              <p className="text-sm text-gray-600 max-w-xl">{currentAgent.description}</p>
            </div>
          </div>

          {/* Run Demo Button - Right Side */}
          <button
            onClick={handlePlay}
            disabled={isPlaying}
            className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-2 rounded-xl hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 transition-all duration-200 flex items-center gap-2 font-semibold text-sm shadow-lg transform hover:scale-105"
          >
            <Play className="h-4 w-4" />
            {isPlaying ? 'Running...' : 'Run Demo'}
          </button>
        </div>

        {/* Status Bar */}
        {isPlaying && (
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-3 mb-4 border border-blue-200 max-w-lg">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-4 h-4 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full animate-pulse" />
              <span className="text-sm font-bold text-gray-800">{currentPhase}</span>
            </div>
            <div className="bg-white rounded-full h-2 overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 to-purple-600 transition-all duration-1000 rounded-full"
                style={{ width: `${(processingStats.processed / processingStats.total) * 100}%` }}
              />
            </div>
            <div className="text-xs text-gray-600 mt-1">
              Processing: {processingStats.processed} / {processingStats.total} steps
            </div>
          </div>
        )}
      </div>

      {/* Main Workflow Visualization */}
      <div 
        ref={containerRef}
        className="relative w-full h-[600px] bg-gray-50 rounded-2xl overflow-hidden border border-gray-300 shadow-lg"
      >
        {/* Connection Lines */}
        {flows.map(flow => {
          const fromNode = nodes.find(n => n.id === flow.from);
          const toNode = nodes.find(n => n.id === flow.to);
          if (!fromNode || !toNode) return null;
          
          return (
            <ConnectionLine
              key={`${flow.from}-${flow.to}`}
              fromNode={fromNode}
              toNode={toNode}
              isActive={activeFlows.includes(flow.id)}
              containerWidth={containerSize.width}
              containerHeight={containerSize.height}
            />
          );
        })}

        {/* Processing Nodes */}
        {nodes.map((node, index) => {
          const Icon = node.icon;
          const status = getNodeStatus(node.id);
          const isActive = status === 'active';
          const isCompleted = status === 'completed';
          
          // Use percentage positioning
          const pixelX = (node.position.x / 100) * containerSize.width;
          const pixelY = (node.position.y / 100) * containerSize.height;

          return (
            <div key={node.id} className="absolute">
              {/* Glow effect for active nodes */}
              {isActive && (
                <div 
                  className="absolute animate-ping"
                  style={{
                    left: `${pixelX}px`,
                    top: `${pixelY}px`,
                    transform: 'translate(-50%, -50%)',
                    width: `${node.size + 40}px`,
                    height: `${node.size + 40}px`,
                    background: `radial-gradient(circle, rgba(59, 130, 246, 0.4), transparent 70%)`,
                    borderRadius: '50%'
                  }}
                />
              )}

              {/* Main Node */}
              <div
                className={`absolute transition-all duration-500 cursor-pointer ${
                  isActive ? 'scale-110 z-30' : isCompleted ? 'scale-105 z-20' : 'scale-100 z-10'
                }`}
                style={{
                  left: `${pixelX}px`,
                  top: `${pixelY}px`,
                  transform: 'translate(-50%, -50%)'
                }}
              >
                {/* Node Circle */}
                <div
                  className={`relative rounded-full border-4 flex items-center justify-center transition-all duration-500 ${
                    isActive 
                      ? `bg-gradient-to-br ${node.bgColor || 'from-blue-400 to-blue-600'} border-white shadow-2xl animate-pulse` 
                      : isCompleted
                        ? 'bg-gradient-to-br from-green-400 to-green-600 border-green-200'
                        : `bg-gradient-to-br from-gray-600 to-gray-800 border-gray-500`
                  }`}
                  style={{ 
                    width: `${node.size}px`, 
                    height: `${node.size}px`,
                    boxShadow: isActive ? `0 0 30px rgba(59, 130, 246, 0.6)` : 
                               isCompleted ? `0 0 20px rgba(34, 197, 94, 0.4)` : 'none'
                  }}
                >
                  {isCompleted ? (
                    <CheckCircle 
                      className="text-white drop-shadow-lg" 
                      style={{ width: `${node.size * 0.5}px`, height: `${node.size * 0.5}px` }} 
                    />
                  ) : (
                    <Icon 
                      className="text-white drop-shadow-lg" 
                      style={{ width: `${node.size * 0.5}px`, height: `${node.size * 0.5}px` }} 
                    />
                  )}

                  {/* Processing indicator */}
                  {isActive && (
                    <div className="absolute -bottom-2 -right-2 w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center animate-spin">
                      <RefreshCw className="h-3 w-3 text-white" />
                    </div>
                  )}

                  {/* Plugin count badge */}
                  {node.plugins.length > 0 && (
                    <div className="absolute -top-2 -right-2 bg-purple-600 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center font-bold border-2 border-white">
                      {node.plugins.length}
                    </div>
                  )}
                </div>

                {/* Node Label with Full Information */}
                <div 
                  className="absolute text-center pointer-events-none"
                  style={{
                    top: `${node.size + 20}px`,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '200px'
                  }}
                >
                  <div className={`px-3 py-3 rounded-lg text-xs shadow-lg border transition-all duration-300 ${
                    isActive || isCompleted
                      ? 'bg-white text-gray-800 border-white shadow-xl' 
                      : 'bg-gray-800/90 text-gray-200 border-gray-600'
                  }`}>
                    <div className="font-bold mb-2 text-sm">{node.title}</div>
                    
                    {/* Category Badge */}
                    <div className={`inline-block px-2 py-1 rounded text-xs mb-3 ${
                      node.category === 'input' ? 'bg-blue-100 text-blue-700' :
                      node.category === 'processing' ? 'bg-emerald-100 text-emerald-700' :
                      node.category === 'delivery' ? 'bg-purple-100 text-purple-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {node.category.toUpperCase()}
                    </div>
                    
                    {/* Full Description */}
                    <div className="text-xs opacity-75 mb-3 text-left leading-relaxed">
                      {node.description}
                    </div>
                    
                    {/* Inputs - No truncation */}
                    {node.inputs.length > 0 && (
                      <div className="mb-3 text-left">
                        <span className="font-semibold text-green-600">INPUTS:</span>
                        <div className="text-xs opacity-70 mt-1 space-y-1">
                          {node.inputs.map((input, i) => (
                            <div key={i} className="break-words">• {input}</div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Outputs - No truncation */}
                    {node.outputs.length > 0 && (
                      <div className="mb-3 text-left">
                        <span className="font-semibold text-blue-600">OUTPUTS:</span>
                        <div className="text-xs opacity-70 mt-1 space-y-1">
                          {node.outputs.map((output, i) => (
                            <div key={i} className="break-words">• {output}</div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Tools - Complete list */}
                    {node.plugins.length > 0 && (
                      <div className="text-left">
                        <span className="font-semibold text-purple-600">TOOLS:</span>
                        <div className="text-xs opacity-70 mt-1 space-y-1">
                          {node.plugins.map((plugin, i) => (
                            <div key={i}>• {plugin}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Completion Message */}
      {/* Removed completion message */}
    </div>
  );
}