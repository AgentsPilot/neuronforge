'use client';

import React, { useState, useEffect } from 'react';
import { PipelineTemplate, PipelineStage } from './hooks/useOnboarding';
import { Brain, Target, Briefcase, TrendingUp, Zap, ArrowLeft, Plus, Trash2, GripVertical, ChevronRight } from 'lucide-react';
import { DEFAULT_PIPELINE_STAGES } from '@/lib/repositories/CRMPipelineStagesRepository';

interface PipelineStepProps {
  selectedTemplate: PipelineTemplate | null;
  customStages: PipelineStage[];
  onTemplateChange: (template: PipelineTemplate) => void;
  onStagesChange: (stages: PipelineStage[]) => void;
}

interface TemplateOption {
  value: PipelineTemplate;
  title: string;
  description: string;
  icon: React.ReactNode;
  stages: string[];
}

// Convert DEFAULT_PIPELINE_STAGES to frontend format
const getTemplateStages = (template: PipelineTemplate): PipelineStage[] => {
  const stages = DEFAULT_PIPELINE_STAGES[template] || DEFAULT_PIPELINE_STAGES.default;
  return stages.map(s => ({
    key: s.stage_key,
    label: s.stage_label,
    color: s.color || '#94A3B8'
  }));
};

const PipelineStep: React.FC<PipelineStepProps> = ({
  selectedTemplate,
  customStages,
  onTemplateChange,
  onStagesChange
}) => {
  const [view, setView] = useState<'templates' | 'customize'>('templates');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const templateOptions: TemplateOption[] = [
    {
      value: 'therapist',
      title: 'Therapist / Healthcare',
      description: 'Track patients from inquiry to completion',
      icon: <Brain className="w-5 h-5" />,
      stages: ['Inquiry', 'Intake', 'Active', 'Completed', 'Inactive']
    },
    {
      value: 'coach',
      title: 'Coach / Mentor',
      description: 'Guide clients through your program',
      icon: <Target className="w-5 h-5" />,
      stages: ['Lead', 'Discovery', 'Proposal', 'Active', 'Completed']
    },
    {
      value: 'consultant',
      title: 'Consultant',
      description: 'Manage projects from lead to delivery',
      icon: <Briefcase className="w-5 h-5" />,
      stages: ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Active']
    },
    {
      value: 'sales',
      title: 'Sales',
      description: 'Track deals through your sales funnel',
      icon: <TrendingUp className="w-5 h-5" />,
      stages: ['Lead', 'Contacted', 'Meeting', 'Proposal', 'Closed']
    },
    {
      value: 'default',
      title: 'Simple',
      description: 'Basic pipeline for any business',
      icon: <Zap className="w-5 h-5" />,
      stages: ['Lead', 'Client', 'Past Client']
    }
  ];

  // When template is selected, load its stages
  const handleTemplateSelect = (template: PipelineTemplate) => {
    onTemplateChange(template);
    const stages = getTemplateStages(template);
    onStagesChange(stages);
    setView('customize');
  };

  // Stage manipulation functions
  const handleStageUpdate = (index: number, newLabel: string) => {
    const updated = [...customStages];
    updated[index] = {
      ...updated[index],
      label: newLabel,
      key: newLabel.toLowerCase().replace(/\s+/g, '_')
    };
    onStagesChange(updated);
    setEditingIndex(null);
  };

  const handleStageDelete = (index: number) => {
    if (customStages.length <= 2) return; // Minimum 2 stages
    const updated = customStages.filter((_, i) => i !== index);
    onStagesChange(updated);
  };

  const handleStageAdd = () => {
    const colors = ['#94A3B8', '#60A5FA', '#FBBF24', '#F97316', '#A78BFA', '#34D399', '#F87171'];
    const newStage: PipelineStage = {
      key: `stage_${Date.now()}`,
      label: 'New Stage',
      color: colors[customStages.length % colors.length]
    };
    onStagesChange([...customStages, newStage]);
    setEditingIndex(customStages.length);
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const updated = [...customStages];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    onStagesChange(updated);
  };

  const handleMoveDown = (index: number) => {
    if (index === customStages.length - 1) return;
    const updated = [...customStages];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    onStagesChange(updated);
  };

  // Template Selection View
  if (view === 'templates') {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="text-center">
          <h3 className="text-lg font-semibold text-slate-100 mb-1">
            How do you track your clients?
          </h3>
          <p className="text-xs text-slate-400">
            Select a pipeline that matches your workflow
          </p>
        </div>

        {/* Template Options */}
        <div className="space-y-2">
          {templateOptions.map((template) => (
            <button
              key={template.value}
              onClick={() => handleTemplateSelect(template.value)}
              className={`group w-full p-4 border rounded-xl text-left transition-all duration-200 hover:scale-[1.01] ${
                selectedTemplate === template.value
                  ? 'bg-purple-500/20 border-purple-400/50 ring-2 ring-purple-400/30'
                  : 'bg-white/5 border-white/10 hover:bg-purple-500/5 hover:border-purple-500/20'
              }`}
            >
              <div className="flex items-center gap-3">
                {/* Icon */}
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${
                  selectedTemplate === template.value
                    ? 'bg-gradient-to-br from-purple-500/40 to-pink-500/40 text-purple-200'
                    : 'bg-white/10 text-slate-400 group-hover:bg-purple-500/20 group-hover:text-purple-300'
                }`}>
                  {template.icon}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold mb-0.5 transition-colors ${
                    selectedTemplate === template.value ? 'text-purple-100' : 'text-slate-100 group-hover:text-purple-200'
                  }`}>
                    {template.title}
                  </div>
                  <p className={`text-xs transition-colors ${
                    selectedTemplate === template.value ? 'text-slate-300' : 'text-slate-500 group-hover:text-slate-400'
                  }`}>
                    {template.description}
                  </p>

                  {/* Stage Preview */}
                  <div className="flex items-center gap-1 mt-2 overflow-hidden">
                    {template.stages.map((stage, i) => (
                      <React.Fragment key={stage}>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                          selectedTemplate === template.value
                            ? 'bg-purple-500/30 text-purple-200'
                            : 'bg-white/10 text-slate-400'
                        }`}>
                          {stage}
                        </span>
                        {i < template.stages.length - 1 && (
                          <ChevronRight className="w-3 h-3 text-slate-600 flex-shrink-0" />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {/* Arrow */}
                <ChevronRight className={`w-5 h-5 flex-shrink-0 transition-colors ${
                  selectedTemplate === template.value ? 'text-purple-400' : 'text-slate-600 group-hover:text-purple-400'
                }`} />
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Customize View
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center">
        <h3 className="text-lg font-semibold text-slate-100 mb-1">
          Customize your pipeline
        </h3>
        <p className="text-xs text-slate-400">
          Rename, reorder, or add stages to match your workflow
        </p>
      </div>

      {/* Back Button */}
      <button
        onClick={() => setView('templates')}
        className="flex items-center gap-2 text-sm text-slate-400 hover:text-purple-300 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Choose different template</span>
      </button>

      {/* Stages List */}
      <div className="space-y-2 bg-white/5 rounded-xl p-3 border border-white/10">
        {customStages.map((stage, index) => (
          <div
            key={stage.key}
            className="flex items-center gap-2 p-2 bg-white/5 rounded-lg group hover:bg-white/10 transition-colors"
          >
            {/* Drag Handle / Reorder */}
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => handleMoveUp(index)}
                disabled={index === 0}
                className="w-5 h-4 flex items-center justify-center text-slate-500 hover:text-purple-400 disabled:opacity-30 disabled:hover:text-slate-500"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <button
                onClick={() => handleMoveDown(index)}
                disabled={index === customStages.length - 1}
                className="w-5 h-4 flex items-center justify-center text-slate-500 hover:text-purple-400 disabled:opacity-30 disabled:hover:text-slate-500"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {/* Color Dot */}
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: stage.color }}
            />

            {/* Label - Editable */}
            {editingIndex === index ? (
              <input
                type="text"
                defaultValue={stage.label}
                autoFocus
                onBlur={(e) => handleStageUpdate(index, e.target.value || stage.label)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleStageUpdate(index, (e.target as HTMLInputElement).value || stage.label);
                  } else if (e.key === 'Escape') {
                    setEditingIndex(null);
                  }
                }}
                className="flex-1 bg-transparent border-b border-purple-400 text-sm text-slate-100 outline-none px-1"
              />
            ) : (
              <button
                onClick={() => setEditingIndex(index)}
                className="flex-1 text-left text-sm text-slate-100 hover:text-purple-200 transition-colors"
              >
                {stage.label}
              </button>
            )}

            {/* Position indicator */}
            <span className="text-[10px] text-slate-500 px-2">
              {index + 1}
            </span>

            {/* Delete */}
            <button
              onClick={() => handleStageDelete(index)}
              disabled={customStages.length <= 2}
              className="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-red-400 disabled:opacity-30 disabled:hover:text-slate-500 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}

        {/* Add Stage Button */}
        <button
          onClick={handleStageAdd}
          className="w-full flex items-center justify-center gap-2 p-2 border border-dashed border-white/20 rounded-lg text-sm text-slate-400 hover:text-purple-300 hover:border-purple-500/50 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Add Stage</span>
        </button>
      </div>

      {/* Help text */}
      <p className="text-xs text-slate-500 text-center">
        Click on a stage name to edit it. Minimum 2 stages required.
      </p>
    </div>
  );
};

export default PipelineStep;
