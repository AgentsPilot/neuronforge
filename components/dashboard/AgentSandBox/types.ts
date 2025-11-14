import {
  Lightbulb, Sparkles, Star, Puzzle, Wand2, Coffee, Heart, Award
} from 'lucide-react'

// Types
export type Field = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'file' | 'email' | 'time' | 'select'
  enum?: string[]
  options?: string[]
  description?: string
  required?: boolean
  placeholder?: string
}

export interface OutputField {
  name: string
  type: string
  description?: string
}

export interface AgentSandboxProps {
  agentId: string
  inputSchema?: Field[]
  outputSchema?: OutputField[]
  userPrompt: string
  pluginsRequired?: string[]
  workflowSteps?: any[]
  connectedPlugins?: Record<string, any>
  initialContext?: 'test' | 'configure'
  locked?: boolean  // When true, prevents mode switching (hides toggle)
  onExecutionComplete?: (executionId: string | null) => void
  onExecutionStart?: (executionId: string) => void
  onFormCompletionChange?: (isComplete: boolean) => void
}

export interface ExecutionLog {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  phase?: string
  execution_id?: string
}

export interface DynamicPhase {
  id: string
  title: string
  icon: any
  color: string
  status: 'pending' | 'active' | 'completed' | 'error'
  startTime?: number
  endTime?: number
  logs: ExecutionLog[]
  progress: number
}

export interface ExecutionMetrics {
  confidence: number
  qualityScore: string
  duration: number
  businessContext: string
  dataProcessed: boolean
  pluginsUsed: string[]
  memoriesLoaded?: number
  memoryTokenCount?: number
}

export interface ExpandedSections {
  inputs: boolean
  outputs: boolean
  plugins: boolean
}

// Database types
export interface AgentExecution {
  id: string
  agent_id: string
  user_id: string
  status: 'configured' | 'running' | 'completed' | 'failed'
  total_logs?: number
  confidence?: number
  quality_score?: string
  duration_ms?: number
  plugins_used?: string[]
  business_context?: string
  data_processed?: boolean
  completed_at?: string
  created_at?: string
  input_values?: Record<string, any>
}

// Constants
export const BLOCKED_FIELDS_BY_PLUGIN: Record<string, string[]> = {
  'google-mail': ['email'],
  'notion': ['workspace', 'workspacename'],
}

export const OPTIONAL_IN_TEST_MODE_FIELDS = [
  // Timing and scheduling fields
  'schedule_cron',
  'cron_schedule',
  'when_to_run',
  'execution_time',
  'schedule_time',
  'run_at',
  'trigger_time',
  'frequency',
  'interval',
  'timezone',
  'schedule',
  'timing',
  // Configuration fields that aren't needed for testing
  'notification_email',
  'notification_settings',
  'retry_settings',
  'error_handling',
  'webhook_url',
  'callback_url',
  'environment',
  'config',
  'settings',
  'metadata',
  // Any field with these keywords
  'cron',
  'schedule',
  'notification',
  'webhook',
  'callback'
]

export const PHASE_PATTERNS = [
  {
    id: 'memory',
    title: 'Getting Ready',
    icon: Coffee,
    color: 'from-amber-400 to-orange-500',
    keywords: ['loading contextual memory', 'phase 1', 'memory', 'contextual memory'],
    friendlyName: 'Setting up workspace'
  },
  {
    id: 'intent',
    title: 'Understanding You',
    icon: Heart,
    color: 'from-pink-400 to-rose-500',
    keywords: ['intent analysis', 'phase 2', 'analyzing intent', 'universal intent', 'primaryIntent'],
    friendlyName: 'Reading your request'
  },
  {
    id: 'strategy',
    title: 'Making a Plan',
    icon: Lightbulb,
    color: 'from-yellow-400 to-amber-500',
    keywords: ['adaptive strategy', 'phase 3', 'strategy generation', 'generating adaptive strategy'],
    friendlyName: 'Planning the approach'
  },
  {
    id: 'plugins',
    title: 'Using Tools',
    icon: Wand2,
    color: 'from-purple-400 to-indigo-500',
    keywords: ['plugin coordination', 'phase 4', 'executing smart plugin', 'chatgpt-research', 'google-mail', 'smart plugin'],
    friendlyName: 'Working with connected apps'
  },
  {
    id: 'documents',
    title: 'Processing Data',
    icon: Puzzle,
    color: 'from-blue-400 to-cyan-500',
    keywords: ['processing documents', 'phase 5', 'document intelligence', 'extracted content'],
    friendlyName: 'Analyzing information'
  },
  {
    id: 'prompt',
    title: 'Crafting Response',
    icon: Sparkles,
    color: 'from-green-400 to-emerald-500',
    keywords: ['prompt generation', 'phase 6', 'universal smart prompt', 'generating universal smart prompt'],
    friendlyName: 'Preparing your answer'
  },
  {
    id: 'llm',
    title: 'AI Magic Happening',
    icon: Star,
    color: 'from-violet-400 to-purple-500',
    keywords: ['executing with gpt-4o', 'phase 7', 'data-aware intelligence', 'llm execution'],
    friendlyName: 'AI is thinking hard'
  },
  {
    id: 'validation',
    title: 'Quality Check',
    icon: Award,
    color: 'from-teal-400 to-green-500',
    keywords: ['quality validation', 'phase 8', 'learning system', 'execution completed', 'ultra-smart execution completed'],
    friendlyName: 'Making sure it\'s perfect'
  }
]