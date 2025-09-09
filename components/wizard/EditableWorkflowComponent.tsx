import React from 'react';
import {
  Plus,
  Database,
  Settings,
  FileText,
  Loader2,
  XCircle,
  ExternalLink
} from 'lucide-react';
import { EditableStepCard } from './EditableStepCard';
import { EditableInput } from './EditableInput';
import { EditableOutput } from './EditableOutput';
import type { PluginStep, RequiredInput, Output, PluginConnection } from './types';

interface EditablePhaseProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  color: 'blue' | 'purple' | 'emerald';
  phase: 'input' | 'process' | 'output';
  steps: PluginStep[];
  inputs: RequiredInput[];
  outputs: Output[];
  showAddPlugin: boolean;
  onToggleAddPlugin: () => void;
  onAddStep: (pluginKey: string) => void;
  onRemoveStep: (stepId: number) => void;
  onUpdateStep: (stepId: number, updates: Partial<PluginStep>) => void;
  onOpenReplaceModal: (step: PluginStep) => void;
  isConnected: (pluginKey: string) => boolean;
  getPluginConnection: (pluginKey: string) => PluginConnection | null;
  onAddInput: () => void;
  onRemoveInput: (index: number) => void;
  onUpdateInput: (index: number, updates: Partial<RequiredInput>) => void;
  onAddOutput: () => void;
  onRemoveOutput: (index: number) => void;
  onUpdateOutput: (index: number, updates: Partial<Output>) => void;
  getAvailablePlugins: () => any[];
  missingPlugins: string[];
  allInputs: RequiredInput[];
  allOutputs: Output[];
  loading: boolean;
}

export const EditablePhase: React.FC<EditablePhaseProps> = ({
  title,
  description,
  icon,
  color,
  phase,
  steps,
  inputs,
  outputs,
  showAddPlugin,
  onToggleAddPlugin,
  onAddStep,
  onRemoveStep,
  onUpdateStep,
  onOpenReplaceModal,
  isConnected,
  getPluginConnection,
  onAddInput,
  onRemoveInput,
  onUpdateInput,
  onAddOutput,
  onRemoveOutput,
  onUpdateOutput,
  getAvailablePlugins,
  missingPlugins,
  allInputs,
  allOutputs,
  loading
}) => {
  const colorClasses = {
    blue: {
      gradient: 'from-blue-500 to-blue-600',
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      stepBg: 'bg-blue-50/50',
      stepBorder: 'border-blue-200',
      buttonBg: 'bg-blue-600 hover:bg-blue-700',
      text: 'text-blue-700',
      accent: 'bg-blue-100'
    },
    purple: {
      gradient: 'from-purple-500 to-purple-600',
      bg: 'bg-purple-50',
      border: 'border-purple-200',
      stepBg: 'bg-purple-50/50',
      stepBorder: 'border-purple-200',
      buttonBg: 'bg-purple-600 hover:bg-purple-700',
      text: 'text-purple-700',
      accent: 'bg-purple-100'
    },
    emerald: {
      gradient: 'from-emerald-500 to-emerald-600',
      bg: 'bg-emerald-50',
      border: 'border-emerald-200',
      stepBg: 'bg-emerald-50/50',
      stepBorder: 'border-emerald-200',
      buttonBg: 'bg-emerald-600 hover:bg-emerald-700',
      text: 'text-emerald-700',
      accent: 'bg-emerald-100'
    }
  };

  const colors = colorClasses[color];
  const availablePlugins = getAvailablePlugins();

  return (
    <div className="bg-white/80 backdrop-blur-sm border border-white/20 rounded-3xl overflow-hidden shadow-xl">
      <div className={`bg-gradient-to-r ${colors.gradient} px-8 py-6`}>
        <div className="flex items-center justify-between text-white">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/20 rounded-2xl">
              {icon}
            </div>
            <div>
              <h3 className="text-xl font-bold">{title}</h3>
              <p className="text-white/90">
                {description} • {steps.length} steps, {inputs.length} inputs, {outputs.length} outputs
              </p>
            </div>
          </div>
          <button
            onClick={onToggleAddPlugin}
            className="bg-white/20 hover:bg-white/30 p-3 rounded-2xl transition-colors disabled:opacity-50"
            disabled={loading}
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>
      </div>

      <div className="p-8 space-y-8">
        {/* Steps Section */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h4 className="text-lg font-semibold text-gray-900 flex items-center gap-3">
              <Database className="w-5 h-5" />
              Workflow Steps ({steps.length})
            </h4>
          </div>
          
          {steps.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {steps.map((step) => (
                <EditableStepCard
                  key={step.id}
                  step={step}
                  color={color}
                  onRemove={() => onRemoveStep(step.id)}
                  onUpdate={(updates) => onUpdateStep(step.id, updates)}
                  onOpenReplaceModal={() => onOpenReplaceModal(step)}
                  isConnected={isConnected}
                  getPluginConnection={getPluginConnection}
                  isMissing={missingPlugins.includes(step.pluginKey)}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-2xl">
              <div className="p-4 bg-gray-50 rounded-2xl w-fit mx-auto mb-4">
                {icon}
              </div>
              <p className="text-gray-600 mb-4">No {title.toLowerCase()} steps defined</p>
              <button
                onClick={onToggleAddPlugin}
                className={`${colors.buttonBg} text-white px-6 py-3 rounded-xl transition-all font-medium`}
                disabled={loading}
              >
                Add First Step
              </button>
            </div>
          )}

          {showAddPlugin && (
            <div className="mt-6 p-6 bg-gray-50 rounded-2xl border-t">
              <h5 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                Add Plugin from Available Plugins
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              </h5>
              {loading ? (
                <div className="text-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto mb-3" />
                  <p className="text-gray-500">Loading plugin connections...</p>
                </div>
              ) : availablePlugins.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {availablePlugins.slice(0, 8).map((plugin) => (
                    <button
                      key={plugin.pluginKey}
                      onClick={() => onAddStep(plugin.pluginKey)}
                      className="flex items-center gap-3 p-3 border border-gray-200 rounded-xl hover:bg-white hover:shadow-md text-left transition-all group"
                    >
                      <div className="text-lg group-hover:scale-110 transition-transform">
                        {plugin.icon}
                      </div>
                      <span className="font-medium truncate text-sm">{plugin.name}</span>
                    </button>
                  ))}
                  
                  {availablePlugins.length > 8 && (
                    <button
                      className="flex items-center gap-3 p-3 border-2 border-dashed border-gray-300 rounded-xl hover:bg-gray-50 text-left transition-all text-gray-600"
                    >
                      <Plus className="w-5 h-5" />
                      <span className="font-medium text-sm">+{availablePlugins.length - 8} more</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <XCircle className="w-8 h-8 mx-auto mb-3 text-gray-400" />
                  <p className="text-gray-600 mb-3">No connected plugins available</p>
                  <p className="text-sm text-gray-500 mb-4">
                    Connect plugins to expand your workflow capabilities
                  </p>
                  <a 
                    href="/settings/connections"
                    className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Connect plugins in settings
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Configuration Inputs Section */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h4 className="text-lg font-semibold text-gray-900 flex items-center gap-3">
              <Settings className="w-5 h-5" />
              Configuration Inputs ({inputs.length})
            </h4>
            <button
              onClick={onAddInput}
              className={`${colors.buttonBg} text-white p-2 rounded-xl transition-all`}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {inputs.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {inputs.map((input, index) => {
                const globalIndex = allInputs.findIndex(i => i === input);
                return (
                  <EditableInput
                    key={globalIndex}
                    input={input}
                    index={globalIndex}
                    onUpdate={(updates) => onUpdateInput(globalIndex, updates)}
                    onRemove={() => onRemoveInput(globalIndex)}
                  />
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-2xl">
              <Settings className="w-8 h-8 mx-auto mb-3 text-gray-400" />
              <p className="text-gray-600 mb-3">No configuration inputs for this phase</p>
              <button
                onClick={onAddInput}
                className="text-blue-600 hover:text-blue-800 font-medium"
              >
                Add configuration input
              </button>
            </div>
          )}
        </div>

        {/* Expected Outputs Section */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h4 className="text-lg font-semibold text-gray-900 flex items-center gap-3">
              <FileText className="w-5 h-5" />
              Expected Outputs ({outputs.length})
            </h4>
            <button
              onClick={onAddOutput}
              className={`${colors.buttonBg} text-white p-2 rounded-xl transition-all`}
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {outputs.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {outputs.map((output, index) => {
                const globalIndex = allOutputs.findIndex(o => o === output);
                return (
                  <EditableOutput
                    key={globalIndex}
                    output={output}
                    index={globalIndex}
                    onUpdate={(updates) => onUpdateOutput(globalIndex, updates)}
                    onRemove={() => onRemoveOutput(globalIndex)}
                  />
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-2xl">
              <FileText className="w-8 h-8 mx-auto mb-3 text-gray-400" />
              <p className="text-gray-600 mb-3">No outputs defined for this phase</p>
              <button
                onClick={onAddOutput}
                className="text-emerald-600 hover:text-emerald-800 font-medium"
              >
                Add expected output
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};