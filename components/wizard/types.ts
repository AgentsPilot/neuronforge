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

export { type PluginCategory };