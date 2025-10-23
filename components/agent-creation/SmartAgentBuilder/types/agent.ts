// components/agent-creation/SmartAgentBuilder/types/agent.ts

export interface InputField {
  name: string;
  label?: string; // Human-friendly display name
  type: 'string' | 'text' | 'textarea' | 'select' | 'number' | 'date' | 'time' | 'email' | 'file';
  required: boolean;
  placeholder?: string;
  description?: string;
  value?: any; // Current input value
  enum?: string[];
  question?: string;
}

export interface OutputAction {
  id: string;
  type: 'EmailDraft' | 'Alert' | 'SummaryBlock' | 'PluginAction';
  category: 'human-facing' | 'machine-facing';
  name: string;
  description: string;
  plugin?: string;
  config: {
    subject?: string;
    recipient?: string;
    format?: string;
    destination?: string;
    template?: string;
  };
  required: boolean;
}

export interface OutputInferenceDetails {
  outputs: OutputAction[];
  reasoning: string[];
  confidence: number;
  human_facing_count: number;
  machine_facing_count: number;
}

export interface ExtractionDetails {
  detected_plugins: string[];
  has_schedule: boolean;
  schedule?: string;
  workflow_step_count: number;
  workflow_steps: any[];
  error_handling_enabled: boolean;
  error_notifications?: any;
  output_format?: string;
  output_inference?: OutputInferenceDetails;
}

export interface Agent {
  id: string;
  agent_name: string;
  user_prompt: string;
  system_prompt: string;
  description: string;
  plugins_required: string[];
  input_schema: InputField[];
  output_schema: OutputAction[];
  status: string;
  created_at?: string;
  updated_at?: string;
  extraction_details?: ExtractionDetails;

  // Scheduling fields
  mode?: 'on_demand' | 'scheduled';
  schedule_cron?: string | null;
  timezone?: string;

  // Additional agent fields
  connected_plugins?: string[];
  workflow_steps?: any[];
  trigger_conditions?: any;
  generated_plan?: any;
  detected_categories?: string[];
  ai_reasoning?: string;
  ai_confidence?: number;
}

export interface TestResult {
  success: boolean;
  executionTime?: number;
  output?: any;
  error?: string;
}

export interface SmartAgentBuilderProps {
  prompt: string;
  promptType: 'original' | 'enhanced';
  clarificationAnswers?: Record<string, string>;
  onAgentCreated: (agent: Agent) => void;
  onBack: () => void;
  onCancel?: () => void;
}

export interface AgentPreviewProps {
  agent: Agent | null;
  prompt: string;
  promptType: 'original' | 'enhanced';
  isEditing: boolean;
  onUpdate: (updates: Partial<Agent>) => void;
}

export interface InputSchemaEditorProps {
  inputSchema: InputField[];
  isEditing: boolean;
  onUpdate: (inputSchema: InputField[]) => void;
}

export interface OutputSchemaEditorProps {
  outputSchema: OutputAction[];
  connectedPlugins: string[];
  isEditing: boolean;
  onUpdate: (schema: OutputAction[]) => void;
}

export interface PluginRequirementsProps {
  pluginsRequired: string[];
  isEditing: boolean;
  onUpdate: (plugins: string[]) => void;
}

export interface SystemPromptEditorProps {
  systemPrompt: string;
  userPrompt: string;
  isEditing: boolean;
  onUpdateSystem: (systemPrompt: string) => void;
  onUpdateUser: (userPrompt: string) => void;
}

export interface TestRunnerProps {
  testResults: TestResult | null;
  onClearResults: () => void;
}

export interface AgentActionsProps {
  agent?: Agent | null;
  isEditing: boolean;
  isTesting: boolean;
  promptType: string;
  onBack: () => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onTest: () => void;
  onCreate: () => void;
  onAgentNameChange?: (newName: string) => void;
}