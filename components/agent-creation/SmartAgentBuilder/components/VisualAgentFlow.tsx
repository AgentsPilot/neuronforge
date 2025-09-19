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
  AlertCircle,
  Calendar,
  Folder,
  Camera,
  Music,
  Video,
  Image,
  Link,
  BookOpen,
  Layers,
  GitBranch,
  Shuffle
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

  console.log('Parsing enhanced prompt:', systemPrompt);

  // Enhanced parsing function that handles multiple formats
  const parseEnhancedWorkflow = (prompt: string) => {
    const steps = [];
    
    // Method 1: Look for numbered steps (1., 2., etc.)
    const numberedSteps = prompt.match(/(\d+)\.\s*([^\d]+?)(?=\d+\.|$)/gs);
    if (numberedSteps && numberedSteps.length >= 2) {
      console.log('Found numbered steps:', numberedSteps.length);
      
      numberedSteps.forEach((step, index) => {
        const cleanStep = step.replace(/^\d+\.\s*/, '').trim();
        const sentences = cleanStep.split(/[.!?]+/).filter(s => s.trim().length > 10);
        
        steps.push({
          title: `Step ${index + 1}`,
          content: cleanStep,
          bulletPoints: sentences.slice(0, 3).map(s => s.trim()),
          type: categorizeStepByContent(cleanStep, index, numberedSteps.length)
        });
      });
      
      return steps;
    }

    // Method 2: Look for structured sections with **Headers**
    const headerSections = prompt.match(/\*\*([^*]+?)\*\*([^*]+?)(?=\*\*|$)/gs);
    if (headerSections && headerSections.length >= 2) {
      console.log('Found header sections:', headerSections.length);
      
      headerSections.forEach((section, index) => {
        const headerMatch = section.match(/\*\*([^*]+?)\*\*/);
        if (!headerMatch) return;
        
        const title = headerMatch[1].trim().replace(':', '');
        const content = section.replace(/\*\*[^*]+?\*\*/, '').trim();
        
        // Extract bullet points or sub-steps
        const bullets = [];
        const bulletMatches = content.match(/[•\-\*]\s*([^\n•\-\*]+)/g);
        if (bulletMatches) {
          bullets.push(...bulletMatches.map(b => b.replace(/^[•\-\*]\s*/, '').trim()));
        } else {
          const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 5);
          bullets.push(...sentences.slice(0, 2).map(s => s.trim()));
        }
        
        steps.push({
          title: title,
          content: content,
          bulletPoints: bullets,
          type: categorizeStepByContent(content + ' ' + title, index, headerSections.length)
        });
      });
      
      return steps;
    }

    // Method 3: Intelligent paragraph parsing for narrative prompts
    const paragraphs = prompt.split(/\n\s*\n|\.\s+(?=[A-Z])/g)
      .map(p => p.trim())
      .filter(p => p.length > 20);

    if (paragraphs.length >= 2) {
      console.log('Found narrative paragraphs:', paragraphs.length);
      
      // Group related sentences and identify workflow stages
      const workflowStages = identifyWorkflowStages(paragraphs);
      
      workflowStages.forEach((stage, index) => {
        steps.push({
          title: stage.title,
          content: stage.content,
          bulletPoints: stage.actions,
          type: stage.type
        });
      });
      
      return steps;
    }

    // Method 4: Sentence-by-sentence analysis for complex prompts
    const sentences = prompt.split(/[.!?]+/).filter(s => s.trim().length > 15);
    if (sentences.length >= 3) {
      const workflowSentences = groupSentencesIntoWorkflow(sentences);
      
      workflowSentences.forEach((group, index) => {
        steps.push({
          title: group.title,
          content: group.sentences.join('. '),
          bulletPoints: group.sentences,
          type: group.type
        });
      });
      
      return steps;
    }

    return [];
  };

  // Helper function to categorize step content into workflow types
  const categorizeStepByContent = (content: string, index: number, total: number) => {
    const lower = content.toLowerCase();
    
    // Input/Trigger indicators
    if (lower.match(/\b(input|receive|trigger|start|initialize|read|fetch|get|load|upload|import|schedule|time|daily|hourly)\b/) ||
        index === 0) {
      return 'input';
    }
    
    // Processing indicators  
    if (lower.match(/\b(process|analyze|parse|extract|transform|compute|calculate|summarize|generate|create|build|execute|run|apply|use|gpt|ai|model|algorithm)\b/)) {
      return 'processing';
    }
    
    // Delivery/Output indicators
    if (lower.match(/\b(send|email|deliver|output|export|save|write|publish|notify|alert|return|response)\b/) ||
        index === total - 1) {
      return 'delivery';
    }
    
    // Default to processing for middle steps
    return 'processing';
  };

  // Advanced function to identify workflow stages from narrative text
  const identifyWorkflowStages = (paragraphs: string[]) => {
    const stages = [];
    
    paragraphs.forEach((paragraph, index) => {
      const lower = paragraph.toLowerCase();
      let stageType = 'processing';
      let stageTitle = `Process ${index + 1}`;
      
      // Identify stage type and create appropriate title
      if (lower.includes('input') || lower.includes('receive') || lower.includes('start') || 
          lower.includes('read') || lower.includes('load') || lower.includes('fetch') ||
          lower.includes('trigger') || lower.includes('schedule')) {
        stageType = 'input';
        stageTitle = lower.includes('schedule') || lower.includes('trigger') ? 'Trigger Conditions' : 'Data Input';
      } else if (lower.includes('send') || lower.includes('email') || lower.includes('deliver') ||
                 lower.includes('output') || lower.includes('notify') || lower.includes('alert') ||
                 lower.includes('return') || lower.includes('export')) {
        stageType = 'delivery';
        stageTitle = 'Output Delivery';
      } else if (lower.includes('process') || lower.includes('analyze') || lower.includes('parse') ||
                 lower.includes('transform') || lower.includes('summarize') || lower.includes('generate') ||
                 lower.includes('gpt') || lower.includes('ai') || lower.includes('model')) {
        stageType = 'processing';
        stageTitle = lower.includes('gpt') || lower.includes('ai') ? 'AI Processing' : 'Data Processing';
      }
      
      // Extract key actions from the paragraph
      const actions = [];
      const sentences = paragraph.split(/[.!?]+/).filter(s => s.trim().length > 10);
      
      // Look for action verbs and create bullet points
      sentences.forEach(sentence => {
        const trimmed = sentence.trim();
        if (trimmed.length > 5) {
          // Simplify long sentences for bullet points
          if (trimmed.length > 80) {
            const words = trimmed.split(' ');
            actions.push(words.slice(0, 12).join(' ') + '...');
          } else {
            actions.push(trimmed);
          }
        }
      });
      
      stages.push({
        title: stageTitle,
        content: paragraph,
        actions: actions.slice(0, 3), // Limit to 3 actions per stage
        type: stageType
      });
    });
    
    return stages;
  };

  // Group sentences into logical workflow steps
  const groupSentencesIntoWorkflow = (sentences: string[]) => {
    const groups = [];
    const keywordGroups = {
      input: ['input', 'receive', 'read', 'load', 'fetch', 'get', 'start', 'initialize', 'trigger', 'schedule'],
      processing: ['process', 'analyze', 'parse', 'transform', 'compute', 'calculate', 'summarize', 'generate', 'create', 'execute', 'gpt', 'ai'],
      delivery: ['send', 'email', 'deliver', 'output', 'export', 'save', 'notify', 'alert', 'return', 'publish']
    };
    
    let currentGroup = null;
    
    sentences.forEach((sentence, index) => {
      const lower = sentence.toLowerCase();
      let bestMatch = 'processing';
      let bestScore = 0;
      
      // Find best keyword match
      Object.entries(keywordGroups).forEach(([type, keywords]) => {
        const score = keywords.reduce((acc, keyword) => {
          return acc + (lower.includes(keyword) ? 1 : 0);
        }, 0);
        
        if (score > bestScore) {
          bestScore = score;
          bestMatch = type;
        }
      });
      
      // Start new group or add to existing
      if (!currentGroup || currentGroup.type !== bestMatch || currentGroup.sentences.length >= 3) {
        if (currentGroup) groups.push(currentGroup);
        
        currentGroup = {
          type: bestMatch,
          title: bestMatch === 'input' ? 'Input Processing' :
                 bestMatch === 'processing' ? 'Core Processing' : 'Output Delivery',
          sentences: [sentence.trim()]
        };
      } else {
        currentGroup.sentences.push(sentence.trim());
      }
    });
    
    if (currentGroup) groups.push(currentGroup);
    
    return groups;
  };

  // Execute the enhanced parsing
  const workflowSteps = parseEnhancedWorkflow(systemPrompt);
  console.log('Enhanced parsed workflow steps:', workflowSteps);
  
  // Helper function to determine node visual properties
  const getNodeProperties = (stepTitle: string, content: string, bulletPoints: string[], stepType?: string) => {
    const title = stepTitle.toLowerCase();
    const contentLower = content.toLowerCase();
    const bullets = bulletPoints.join(' ').toLowerCase();
    const allText = `${title} ${contentLower} ${bullets}`;
    
    // Determine category and visual properties
    if (stepType === 'input' || title.includes('input') || title.includes('trigger') || 
        contentLower.includes('schedule') || contentLower.includes('daily')) {
      return {
        category: 'input' as const,
        icon: allText.includes('schedule') || allText.includes('time') ? Clock :
              allText.includes('pdf') || allText.includes('file') ? FileText :
              allText.includes('database') || allText.includes('storage') ? Database : Upload,
        color: allText.includes('schedule') ? 'green' : 'blue',
        bgColor: allText.includes('schedule') ? 'from-green-400 to-green-600' : 'from-blue-400 to-blue-600',
        size: 65
      };
    } else if (stepType === 'processing' || title.includes('process') || title.includes('ai') ||
               contentLower.includes('gpt') || contentLower.includes('analyze') || 
               contentLower.includes('summarize')) {
      const isAI = allText.includes('gpt') || allText.includes('ai') || 
                   allText.includes('chatgpt') || allText.includes('model');
      return {
        category: 'processing' as const,
        icon: isAI ? Brain : Cpu,
        color: 'emerald',
        bgColor: 'from-emerald-400 to-emerald-600',
        size: isAI ? 70 : 65
      };
    } else if (stepType === 'delivery' || title.includes('delivery') || title.includes('output') ||
               contentLower.includes('email') || contentLower.includes('send') || 
               contentLower.includes('notify')) {
      return {
        category: 'delivery' as const,
        icon: allText.includes('email') || allText.includes('mail') ? Mail :
              allText.includes('error') || allText.includes('alert') ? AlertCircle : Send,
        color: allText.includes('error') ? 'red' : 'purple',
        bgColor: allText.includes('error') ? 'from-red-400 to-red-600' : 'from-purple-400 to-purple-600',
        size: allText.includes('error') ? 55 : 60
      };
    }
    
    // Default
    return {
      category: 'processing' as const,
      icon: Settings,
      color: 'gray',
      bgColor: 'from-gray-400 to-gray-600',
      size: 60
    };
  };

  // Create nodes from parsed workflow steps
  workflowSteps.forEach((step, index) => {
    const nodeProps = getNodeProperties(step.title, step.content, step.bulletPoints, step.type);
    
    // Calculate horizontal positions (evenly distributed)
    const totalSteps = workflowSteps.length;
    const xPercent = totalSteps === 1 ? 50 : (index / (totalSteps - 1)) * 70 + 15; // 15% to 85% width
    const yPercent = 25; // 25% from top
    
    // Generate realistic outputs based on content
    const generateOutputs = (content: string, bulletPoints: string[]) => {
      const lower = content.toLowerCase();
      
      if (lower.includes('pdf') || lower.includes('file')) {
        return ['Processed Document', 'Extracted Content'];
      } else if (lower.includes('summarize') || lower.includes('gpt')) {
        return ['Generated Summary', 'AI Analysis'];
      } else if (lower.includes('email') || lower.includes('send')) {
        return ['Sent Message', 'Delivery Confirmation'];
      } else if (lower.includes('schedule') || lower.includes('trigger')) {
        return ['Execution Signal', 'Workflow Initiated'];
      }
      
      return bulletPoints.length > 0 ? 
        bulletPoints.slice(0, 2).map(bp => bp.length > 40 ? bp.substring(0, 37) + '...' : bp) :
        [`${step.title} Result`];
    };
    
    const outputs = generateOutputs(step.content, step.bulletPoints);
    const inputs = index === 0 ? ['User Configuration'] : [`Output from ${workflowSteps[index - 1].title}`];
    
    // Match plugins to steps more intelligently
    const stepPlugins = plugins.filter(plugin => {
      const pluginLower = plugin.toLowerCase().replace(/[_-]/g, ' ');
      const stepText = (step.content + ' ' + step.bulletPoints.join(' ')).toLowerCase();
      
      return stepText.includes(pluginLower) ||
             stepText.includes(plugin.toLowerCase()) ||
             (plugin.includes('mail') && stepText.includes('email')) ||
             (plugin.includes('gpt') && (stepText.includes('chatgpt') || stepText.includes('summarize'))) ||
             (plugin.includes('file') && stepText.includes('pdf')) ||
             (plugin.includes('research') && stepText.includes('analyze'));
    });

    nodes.push({
      id: `enhanced-step-${index}`,
      title: step.title,
      subtitle: `${step.bulletPoints.length} operation${step.bulletPoints.length !== 1 ? 's' : ''}`,
      description: step.bulletPoints.length > 0 ? 
        step.bulletPoints.slice(0, 3).join(' • ') : 
        step.content.slice(0, 120) + (step.content.length > 120 ? '...' : ''),
      icon: nodeProps.icon,
      color: nodeProps.color,
      bgColor: nodeProps.bgColor,
      position: { x: xPercent, y: yPercent },
      size: nodeProps.size,
      inputs: inputs,
      outputs: outputs,
      plugins: stepPlugins,
      processingTime: nodeProps.category === 'processing' ? 3500 : 
                     nodeProps.category === 'input' ? 1200 :
                     nodeProps.category === 'delivery' ? 2000 : 2500,
      category: nodeProps.category
    });

    // Create flow connections
    if (index > 0) {
      flows.push({
        id: `enhanced-flow-${index-1}-to-${index}`,
        from: `enhanced-step-${index-1}`,
        to: `enhanced-step-${index}`,
        data: outputs[0] || step.title,
        color: nodeProps.color,
        delay: (index * 1000) + 400
      });
    }
  });

  // Enhanced fallback if no workflow found
  if (workflowSteps.length === 0) {
    console.log('No workflow steps found, creating intelligent fallback');
    
    // Analyze the full prompt for key components
    const promptLower = systemPrompt.toLowerCase();
    const hasFileOperations = promptLower.includes('pdf') || promptLower.includes('file') || promptLower.includes('read');
    const hasAIProcessing = promptLower.includes('gpt') || promptLower.includes('summarize') || promptLower.includes('analyze');
    const hasEmailDelivery = promptLower.includes('email') || promptLower.includes('send') || promptLower.includes('mail');
    const hasScheduling = promptLower.includes('daily') || promptLower.includes('schedule') || promptLower.includes('time');
    
    const intelligentNodes = [];
    
    // Input stage
    if (hasScheduling) {
      intelligentNodes.push({
        id: 'trigger',
        title: 'Scheduled Trigger',
        subtitle: 'Time-based activation',
        description: 'Activates the workflow based on configured schedule',
        icon: Clock,
        color: 'green',
        bgColor: 'from-green-400 to-green-600',
        position: { x: 15, y: 25 },
        size: 60,
        inputs: ['System Clock'],
        outputs: ['Activation Signal'],
        plugins: [],
        processingTime: 800,
        category: 'input' as const
      });
    }
    
    if (hasFileOperations) {
      intelligentNodes.push({
        id: 'file-input',
        title: 'File Processing',
        subtitle: 'Document handling',
        description: 'Loads and processes files from storage',
        icon: FileText,
        color: 'blue',
        bgColor: 'from-blue-400 to-blue-600',
        position: { x: hasScheduling ? 35 : 20, y: 25 },
        size: 65,
        inputs: hasScheduling ? ['Activation Signal'] : ['File Path'],
        outputs: ['File Content'],
        plugins: plugins.filter(p => p.includes('file') || p.includes('pdf')),
        processingTime: 1500,
        category: 'input' as const
      });
    }
    
    // Processing stage
    if (hasAIProcessing) {
      intelligentNodes.push({
        id: 'ai-processing',
        title: 'AI Analysis',
        subtitle: 'Language processing',
        description: 'Processes content using advanced AI capabilities',
        icon: Brain,
        color: 'emerald',
        bgColor: 'from-emerald-400 to-emerald-600',
        position: { x: 50, y: 25 },
        size: 70,
        inputs: hasFileOperations ? ['File Content'] : ['Input Data'],
        outputs: ['Processed Results', 'Analysis Summary'],
        plugins: plugins.filter(p => p.includes('gpt') || p.includes('research') || p.includes('chat')),
        processingTime: 4000,
        category: 'processing' as const
      });
    }
    
    // Output stage
    if (hasEmailDelivery) {
      intelligentNodes.push({
        id: 'email-delivery',
        title: 'Email Delivery',
        subtitle: 'Message sending',
        description: 'Sends processed results via email',
        icon: Mail,
        color: 'purple',
        bgColor: 'from-purple-400 to-purple-600',
        position: { x: 80, y: 25 },
        size: 60,
        inputs: hasAIProcessing ? ['Analysis Summary'] : ['Processed Data'],
        outputs: ['Sent Email', 'Delivery Status'],
        plugins: plugins.filter(p => p.includes('mail') || p.includes('email')),
        processingTime: 2000,
        category: 'delivery' as const
      });
    }
    
    nodes.push(...intelligentNodes);
    
    // Create flows between intelligent nodes
    for (let i = 1; i < intelligentNodes.length; i++) {
      flows.push({
        id: `intelligent-flow-${i-1}-to-${i}`,
        from: intelligentNodes[i-1].id,
        to: intelligentNodes[i].id,
        data: intelligentNodes[i-1].outputs[0] || 'Data',
        color: intelligentNodes[i].color,
        delay: i * 1200 + 600
      });
    }
    
    // If still no nodes, create basic fallback
    if (intelligentNodes.length === 0) {
      const basicNodes = [
        {
          id: 'input',
          title: 'Input Processing',
          subtitle: `${inputSchema.length || 1} parameters`,
          description: 'Receives and processes input parameters',
          icon: MessageSquare,
          color: 'blue',
          bgColor: 'from-blue-400 to-blue-600',
          position: { x: 20, y: 25 },
          size: 60,
          inputs: ['User Request'],
          outputs: inputSchema.length > 0 ? inputSchema.map(f => f.name) : ['Processed Input'],
          plugins: [],
          processingTime: 1000,
          category: 'input' as const
        },
        {
          id: 'processing',
          title: 'Core Processing',
          subtitle: 'Main logic',
          description: 'Executes the main agent functionality',
          icon: Brain,
          color: 'emerald',
          bgColor: 'from-emerald-400 to-emerald-600',
          position: { x: 50, y: 25 },
          size: 70,
          inputs: ['Processed Input'],
          outputs: ['Analysis Results'],
          plugins: plugins.slice(0, 2),
          processingTime: 3000,
          category: 'processing' as const
        },
        {
          id: 'output',
          title: 'Result Delivery',
          subtitle: 'Output generation',
          description: 'Formats and delivers the final results',
          icon: Send,
          color: 'purple',
          bgColor: 'from-purple-400 to-purple-600',
          position: { x: 80, y: 25 },
          size: 60,
          inputs: ['Analysis Results'],
          outputs: ['Final Response'],
          plugins: plugins.slice(2),
          processingTime: 1500,
          category: 'delivery' as const
        }
      ];

      nodes.push(...basicNodes);
      
      flows.push(
        {
          id: 'basic-input-processing',
          from: 'input',
          to: 'processing',
          data: 'Input Data',
          color: 'emerald',
          delay: 1200
        },
        {
          id: 'basic-processing-output',
          from: 'processing',
          to: 'output',
          data: 'Processed Results',
          color: 'purple',
          delay: 4500
        }
      );
    }
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
      className={`absolute z-10 transition-all duration-700 ${
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
        boxShadow: isActive ? '0 0 25px rgba(59, 130, 246, 0.6)' : 'none'
      }}
    />
  );
};

export default function EnhancedVisualAgentFlow({ 
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

  // Enhanced demo agent
  const demoAgent: Agent = {
    agent_name: "Advanced Document Analyzer", 
    description: "Multi-step document processing agent with scheduling, AI analysis, and automated delivery",
    system_prompt: `**Data Source Configuration**
    • Read PDF documents from designated storage location
    • Validate file accessibility and format compatibility
    • Load document content into processing pipeline

    **Trigger Conditions & Scheduling**
    • Activate daily at 9:00 AM EST
    • Monitor for new files in watched directories
    • Execute on-demand processing requests

    **AI Processing Steps**
    • Parse document structure and extract key information
    • Summarize content using advanced language models (ChatGPT-4)
    • Generate insights and identify important themes
    • Create structured analysis reports

    **Output Generation**
    • Format results into professional summary documents
    • Generate visual charts and data representations
    • Prepare executive briefing materials

    **Delivery Methods**
    • Send comprehensive email reports to stakeholders
    • Upload results to shared collaboration platforms
    • Archive processed documents with metadata

    **Error Handling & Recovery**
    • Implement retry logic for failed operations
    • Send error notifications to administrators
    • Log all processing activities for audit trail`,
    input_schema: [
      { name: "document_path", type: "string", description: "Path to PDF document", required: true },
      { name: "recipient_emails", type: "array", description: "Email addresses for delivery", required: true },
      { name: "processing_options", type: "object", description: "Analysis configuration", required: false },
      { name: "schedule_time", type: "string", description: "Daily execution time", required: false }
    ],
    plugins_required: [
      "file_reader_advanced", 
      "chatgpt_research_v4", 
      "document_parser",
      "gmail_enterprise",
      "chart_generator",
      "task_scheduler",
      "error_handler"
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

  // Removed autoPlay functionality

  const handlePlay = async () => {
    if (isPlaying) return;
    
    setIsPlaying(true);
    setActiveNodes([]);
    setCompletedNodes([]);
    setActiveFlows([]);
    setCurrentPhase('Initializing enhanced workflow...');
    setProcessingStats({ processed: 0, total: nodes.length });

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      
      setCurrentPhase(`Executing: ${node.title}`);
      setActiveNodes([node.id]);
      
      const incomingFlows = flows.filter(f => f.to === node.id);
      setActiveFlows(prev => [...prev, ...incomingFlows.map(f => f.id)]);
      
      await new Promise(resolve => setTimeout(resolve, node.processingTime));
      
      setCompletedNodes(prev => [...prev, node.id]);
      setProcessingStats(prev => ({ ...prev, processed: prev.processed + 1 }));
      
      if (i < nodes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 600));
      }
    }

    setCurrentPhase('Enhanced workflow completed successfully!');
    setIsPlaying(false);
    setActiveNodes([]);
  };

  const handleReset = () => {
    setActiveNodes([]);
    setCompletedNodes([]);
    setActiveFlows([]);
    setIsPlaying(false);
    setCurrentPhase('');
    setProcessingStats({ processed: 0, total: nodes.length });
  };

  const getNodeStatus = (nodeId: string) => {
    if (completedNodes.includes(nodeId)) return 'completed';
    if (activeNodes.includes(nodeId)) return 'active';
    return 'dormant';
  };

  if (nodes.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-8">
          <Workflow className="h-12 w-12 text-white" />
        </div>
        <h3 className="text-2xl font-bold text-gray-700 mb-3">Enhanced Parsing Ready</h3>
        <p className="text-gray-500 mb-6 max-w-md mx-auto">
          Provide your agent configuration with detailed workflow steps to see the enhanced visualization
        </p>
        <div className="text-sm text-gray-400">
          Supports: numbered steps, sectioned prompts, narrative workflows, and intelligent fallbacks
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Enhanced Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-gradient-to-br from-blue-500 via-purple-600 to-cyan-500 rounded-2xl flex items-center justify-center shadow-xl">
              <Brain className="h-7 w-7 text-white" />
            </div>
            <div className="text-left">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
                {currentAgent.agent_name}
              </h1>
              <p className="text-sm text-gray-600 max-w-2xl leading-relaxed">{currentAgent.description}</p>
              <div className="flex items-center gap-4 mt-3">
                <div className="flex items-center gap-1 text-xs text-blue-600">
                  <Layers className="h-3 w-3" />
                  {nodes.length} Steps
                </div>
                <div className="flex items-center gap-1 text-xs text-purple-600">
                  <Zap className="h-3 w-3" />
                  {currentAgent.plugins_required.length} Tools
                </div>
                <div className="flex items-center gap-1 text-xs text-green-600">
                  <Target className="h-3 w-3" />
                  {currentAgent.input_schema.length} Inputs
                </div>
              </div>
            </div>
          </div>

          {/* Enhanced Control Panel */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleReset}
              disabled={isPlaying}
              className="bg-gray-100 text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-200 disabled:opacity-50 transition-all duration-200 flex items-center gap-2 text-sm"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
            <button
              onClick={handlePlay}
              disabled={isPlaying}
              className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-6 py-2 rounded-xl hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 transition-all duration-200 flex items-center gap-2 font-semibold text-sm shadow-lg transform hover:scale-105"
            >
              <Play className="h-4 w-4" />
              {isPlaying ? 'Processing...' : 'Start Demo'}
            </button>
          </div>
        </div>

        {/* Enhanced Status Display */}
        {isPlaying && (
          <div className="bg-gradient-to-r from-blue-50 via-purple-50 to-cyan-50 rounded-2xl p-4 mb-6 border border-blue-200 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full animate-pulse shadow-lg" />
                <span className="font-bold text-gray-800 text-lg">{currentPhase}</span>
              </div>
              <div className="text-sm font-medium text-gray-600">
                {processingStats.processed} / {processingStats.total} completed
              </div>
            </div>
            <div className="bg-white rounded-full h-3 overflow-hidden shadow-inner">
              <div 
                className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 transition-all duration-1000 rounded-full shadow-sm"
                style={{ width: `${(processingStats.processed / processingStats.total) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Enhanced Workflow Visualization */}
      <div 
        ref={containerRef}
        className="relative w-full h-[700px] bg-gradient-to-br from-gray-50 to-blue-50 rounded-3xl overflow-hidden border border-gray-200 shadow-2xl"
      >
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0 bg-gradient-to-r from-blue-600/20 to-purple-600/20" />
          <div className="absolute inset-0" style={{
            backgroundImage: `radial-gradient(circle at 20px 20px, #3b82f6 1px, transparent 1px)`,
            backgroundSize: '40px 40px'
          }} />
        </div>

        {/* Enhanced Connection Lines */}
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

        {/* Enhanced Processing Nodes */}
        {nodes.map((node, index) => {
          const Icon = node.icon;
          const status = getNodeStatus(node.id);
          const isActive = status === 'active';
          const isCompleted = status === 'completed';
          
          const pixelX = (node.position.x / 100) * containerSize.width;
          const pixelY = (node.position.y / 100) * containerSize.height;

          return (
            <div key={node.id} className="absolute">
              {/* Enhanced Glow Effect */}
              {isActive && (
                <>
                  <div 
                    className="absolute animate-ping"
                    style={{
                      left: `${pixelX}px`,
                      top: `${pixelY}px`,
                      transform: 'translate(-50%, -50%)',
                      width: `${node.size + 60}px`,
                      height: `${node.size + 60}px`,
                      background: `radial-gradient(circle, rgba(59, 130, 246, 0.6), transparent 70%)`,
                      borderRadius: '50%'
                    }}
                  />
                  <div 
                    className="absolute animate-pulse"
                    style={{
                      left: `${pixelX}px`,
                      top: `${pixelY}px`,
                      transform: 'translate(-50%, -50%)',
                      width: `${node.size + 30}px`,
                      height: `${node.size + 30}px`,
                      background: `radial-gradient(circle, rgba(139, 92, 246, 0.4), transparent 70%)`,
                      borderRadius: '50%'
                    }}
                  />
                </>
              )}

              {/* Enhanced Node Circle */}
              <div
                className={`absolute transition-all duration-700 cursor-pointer group ${
                  isActive ? 'scale-125 z-40' : isCompleted ? 'scale-110 z-30' : 'scale-100 z-20'
                }`}
                style={{
                  left: `${pixelX}px`,
                  top: `${pixelY}px`,
                  transform: 'translate(-50%, -50%)'
                }}
              >
                <div
                  className={`relative rounded-full border-4 flex items-center justify-center transition-all duration-700 ${
                    isActive 
                      ? `bg-gradient-to-br ${node.bgColor || 'from-blue-400 to-blue-600'} border-white shadow-2xl animate-pulse` 
                      : isCompleted
                        ? 'bg-gradient-to-br from-green-400 to-green-600 border-green-200 shadow-xl'
                        : `bg-gradient-to-br from-gray-600 to-gray-800 border-gray-400 shadow-lg`
                  }`}
                  style={{ 
                    width: `${node.size}px`, 
                    height: `${node.size}px`,
                    boxShadow: isActive ? `0 0 40px rgba(59, 130, 246, 0.8), 0 0 80px rgba(139, 92, 246, 0.4)` : 
                               isCompleted ? `0 0 30px rgba(34, 197, 94, 0.5)` : 
                               'none'
                  }}
                >
                  {isCompleted ? (
                    <CheckCircle 
                      className="text-white drop-shadow-xl" 
                      style={{ width: `${node.size * 0.5}px`, height: `${node.size * 0.5}px` }} 
                    />
                  ) : (
                    <Icon 
                      className="text-white drop-shadow-xl" 
                      style={{ width: `${node.size * 0.5}px`, height: `${node.size * 0.5}px` }} 
                    />
                  )}

                  {/* Enhanced Processing Indicator */}
                  {isActive && (
                    <div className="absolute -bottom-3 -right-3 w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center animate-spin shadow-lg">
                      <RefreshCw className="h-4 w-4 text-white" />
                    </div>
                  )}

                  {/* Enhanced Plugin Badge */}
                  {node.plugins.length > 0 && (
                    <div className="absolute -top-3 -right-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white text-xs rounded-full w-8 h-8 flex items-center justify-center font-bold border-3 border-white shadow-lg">
                      {node.plugins.length}
                    </div>
                  )}

                  {/* Category Badge */}
                  <div className={`absolute -top-1 -left-8 px-2 py-1 rounded text-xs font-bold shadow-md ${
                    node.category === 'input' ? 'bg-blue-100 text-blue-700 border border-blue-300' :
                    node.category === 'processing' ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' :
                    node.category === 'delivery' ? 'bg-purple-100 text-purple-700 border border-purple-300' :
                    'bg-gray-100 text-gray-700 border border-gray-300'
                  }`}>
                    {node.category.toUpperCase()}
                  </div>
                </div>

                {/* Enhanced Information Panel */}
                <div 
                  className="absolute text-center pointer-events-none"
                  style={{
                    top: `${node.size + 30}px`,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '240px'
                  }}
                >
                  <div className={`px-4 py-4 rounded-xl text-xs shadow-xl border transition-all duration-500 backdrop-blur-sm ${
                    isActive || isCompleted
                      ? 'bg-white/95 text-gray-800 border-white shadow-2xl transform scale-105' 
                      : 'bg-gray-800/95 text-gray-200 border-gray-600'
                  }`}>
                    <div className="font-bold mb-2 text-sm">{node.title}</div>
                    <div className="text-xs opacity-75 mb-3">{node.subtitle}</div>
                    
                    {/* Enhanced Description */}
                    <div className="text-xs opacity-80 mb-4 text-left leading-relaxed">
                      {node.description}
                    </div>
                    
                    {/* Enhanced Input/Output Display */}
                    {node.inputs.length > 0 && (
                      <div className="mb-3 text-left">
                        <span className="font-semibold text-green-600 text-xs">INPUTS:</span>
                        <div className="text-xs opacity-75 mt-1 space-y-1">
                          {node.inputs.map((input, i) => (
                            <div key={i} className="break-words flex items-start">
                              <ArrowRight className="h-3 w-3 mr-1 mt-0.5 flex-shrink-0 text-green-500" />
                              {input}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {node.outputs.length > 0 && (
                      <div className="mb-3 text-left">
                        <span className="font-semibold text-blue-600 text-xs">OUTPUTS:</span>
                        <div className="text-xs opacity-75 mt-1 space-y-1">
                          {node.outputs.map((output, i) => (
                            <div key={i} className="break-words flex items-start">
                              <ArrowRight className="h-3 w-3 mr-1 mt-0.5 flex-shrink-0 text-blue-500" />
                              {output}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Enhanced Tools Display */}
                    {node.plugins.length > 0 && (
                      <div className="text-left">
                        <span className="font-semibold text-purple-600 text-xs">TOOLS:</span>
                        <div className="text-xs opacity-75 mt-1 space-y-1">
                          {node.plugins.map((plugin, i) => (
                            <div key={i} className="flex items-start">
                              <Zap className="h-3 w-3 mr-1 mt-0.5 flex-shrink-0 text-purple-500" />
                              {plugin}
                            </div>
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

      {/* Enhanced Completion Status */}
      {completedNodes.length === nodes.length && !isPlaying && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl p-6 border border-green-200 shadow-lg">
          <div className="flex items-center justify-center gap-4">
            <div className="w-12 h-12 bg-gradient-to-r from-green-500 to-emerald-600 rounded-full flex items-center justify-center shadow-lg">
              <CheckCircle className="h-6 w-6 text-white" />
            </div>
            <div className="text-center">
              <h3 className="text-xl font-bold text-green-800 mb-1">Demo Complete!</h3>
              <p className="text-green-600">All {nodes.length} processing steps executed successfully</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}