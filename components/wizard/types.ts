import { type PluginCategory } from '@/lib/plugins/pluginList';

export interface PluginStep {
  id: number;
  pluginKey: string;
  pluginName: string;
  action: string;
  description: string;
  icon: React.ReactNode;
  order: number;
  phase: 'input' | 'process' | 'output';
  confidence: number;
}

export interface RequiredInput {
  name: string;
  type: string;
  description: string;
  required: boolean;
  placeholder?: string;
  options?: string[];
  label?: string;
}

export interface Output {
  type: string;
  destination: string;
  format: string;
  pluginKey: string;
  label?: string;
}

export interface PluginConnection {
  id: string;
  plugin_key: string;
  plugin_name: string;
  username?: string;
  email?: string;
  status: 'active' | 'expired' | 'error' | 'disabled';
  connected_at: string;
  last_used?: string;
  profile_data?: any;
}

// NEW: Input Schema for schema-driven workflows
export interface InputSchema {
  id: string;
  name: string;
  type: 'text' | 'textarea' | 'dropdown' | 'multiselect' | 'date' | 'number' | 'boolean' | 'slider';
  label: string;
  description?: string;
  required: boolean;
  placeholder?: string;
  options?: string[];  // for dropdown/multiselect
  defaultValue?: any;
  min?: number;       // for number/slider
  max?: number;       // for number/slider
  step?: number;      // for number/slider
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
}

// NEW: Workflow Plan interface (this might need to be added to wherever WorkflowPlan is defined)
export interface WorkflowData {
  steps: PluginStep[];
  inputs: RequiredInput[];
  outputs: Output[];
  inputSchema?: InputSchema[];  // NEW: Optional input schema for schema-driven workflows
  // Keep all existing fields that might be in your current workflow data structure
}

export { type PluginCategory };