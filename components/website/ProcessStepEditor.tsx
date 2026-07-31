'use client';

import { useState } from 'react';
import { Plus, Trash2, GripVertical, CheckCircle, Calendar, CreditCard, Users, Heart, Star, Target, Sparkles, Clock, FileText, Mail, Phone, MessageCircle } from 'lucide-react';
import type { ProcessStep } from './blocks/types';

interface ProcessStepEditorProps {
  steps: ProcessStep[];
  onChange: (steps: ProcessStep[]) => void;
  language: 'en' | 'es' | 'he';
}

// Available icons for process steps
const STEP_ICONS = [
  { key: 'CheckCircle', icon: CheckCircle, label: 'Check' },
  { key: 'Calendar', icon: Calendar, label: 'Calendar' },
  { key: 'CreditCard', icon: CreditCard, label: 'Payment' },
  { key: 'Users', icon: Users, label: 'Users' },
  { key: 'Heart', icon: Heart, label: 'Heart' },
  { key: 'Star', icon: Star, label: 'Star' },
  { key: 'Target', icon: Target, label: 'Target' },
  { key: 'Sparkles', icon: Sparkles, label: 'Sparkles' },
  { key: 'Clock', icon: Clock, label: 'Clock' },
  { key: 'FileText', icon: FileText, label: 'Form' },
  { key: 'Mail', icon: Mail, label: 'Email' },
  { key: 'Phone', icon: Phone, label: 'Phone' },
  { key: 'MessageCircle', icon: MessageCircle, label: 'Chat' },
];

const LABELS = {
  en: {
    add_step: 'Add Step',
    step_title: 'Step Title',
    step_description: 'Description',
    step_icon: 'Icon',
    remove_step: 'Remove',
    no_steps: 'No steps defined yet. Add your first step to show how your service works.',
    placeholder_title: 'e.g., Initial Consultation',
    placeholder_desc: 'e.g., A brief call to understand your needs',
  },
  es: {
    add_step: 'Agregar Paso',
    step_title: 'Título del Paso',
    step_description: 'Descripción',
    step_icon: 'Icono',
    remove_step: 'Eliminar',
    no_steps: 'No hay pasos definidos aún. Agrega tu primer paso para mostrar cómo funciona tu servicio.',
    placeholder_title: 'ej., Consulta Inicial',
    placeholder_desc: 'ej., Una breve llamada para entender tus necesidades',
  },
  he: {
    add_step: 'הוסף שלב',
    step_title: 'כותרת השלב',
    step_description: 'תיאור',
    step_icon: 'אייקון',
    remove_step: 'הסר',
    no_steps: 'עדיין לא הוגדרו שלבים. הוסף את השלב הראשון כדי להראות איך השירות שלך עובד.',
    placeholder_title: 'לדוגמה: ייעוץ ראשוני',
    placeholder_desc: 'לדוגמה: שיחה קצרה להבנת הצרכים שלך',
  },
};

export function ProcessStepEditor({ steps, onChange, language }: ProcessStepEditorProps) {
  const labels = LABELS[language];
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const addStep = () => {
    const newStep: ProcessStep = {
      number: steps.length + 1,
      title: '',
      description: '',
      icon: 'CheckCircle',
      auto_generated: false,
    };
    onChange([...steps, newStep]);
    setExpandedStep(steps.length);
  };

  const updateStep = (index: number, updates: Partial<ProcessStep>) => {
    const newSteps = [...steps];
    newSteps[index] = { ...newSteps[index], ...updates };
    onChange(newSteps);
  };

  const removeStep = (index: number) => {
    const newSteps = steps.filter((_, i) => i !== index);
    // Renumber remaining steps
    const renumberedSteps = newSteps.map((step, i) => ({
      ...step,
      number: i + 1,
    }));
    onChange(renumberedSteps);
    setExpandedStep(null);
  };

  const moveStep = (fromIndex: number, direction: 'up' | 'down') => {
    const toIndex = direction === 'up' ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= steps.length) return;

    const newSteps = [...steps];
    [newSteps[fromIndex], newSteps[toIndex]] = [newSteps[toIndex], newSteps[fromIndex]];
    // Renumber
    const renumberedSteps = newSteps.map((step, i) => ({
      ...step,
      number: i + 1,
    }));
    onChange(renumberedSteps);
  };

  const getIconComponent = (iconKey: string) => {
    const iconDef = STEP_ICONS.find(i => i.key === iconKey);
    return iconDef?.icon || CheckCircle;
  };

  return (
    <div className="space-y-3">
      {steps.length === 0 ? (
        <div className="p-4 bg-[var(--v2-surface)] rounded-lg border border-dashed border-[var(--v2-border)] text-center">
          <p className="text-sm text-[var(--v2-text-secondary)] mb-3">
            {labels.no_steps}
          </p>
          <button
            onClick={addStep}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#4F6EF7] text-white rounded-lg text-sm font-medium hover:bg-[#4F6EF7]/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {labels.add_step}
          </button>
        </div>
      ) : (
        <>
          {steps.map((step, index) => {
            const IconComponent = getIconComponent(step.icon || 'CheckCircle');
            const isExpanded = expandedStep === index;

            return (
              <div
                key={index}
                className="bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)] overflow-hidden"
              >
                {/* Step Header */}
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-[var(--v2-surface-hover)]"
                  onClick={() => setExpandedStep(isExpanded ? null : index)}
                >
                  <div className="flex items-center gap-2 text-[var(--v2-text-secondary)]">
                    <GripVertical className="w-4 h-4" />
                    <div className="w-8 h-8 rounded-full bg-[#4F6EF7] text-white flex items-center justify-center text-sm font-bold">
                      {step.number || index + 1}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-[var(--v2-text-primary)] truncate">
                      {step.title || `Step ${index + 1}`}
                    </p>
                    {step.description && (
                      <p className="text-xs text-[var(--v2-text-secondary)] truncate">
                        {step.description}
                      </p>
                    )}
                  </div>
                  <IconComponent className="w-5 h-5 text-[#4F6EF7]" />
                </div>

                {/* Expanded Editor */}
                {isExpanded && (
                  <div className="p-3 pt-0 space-y-3 border-t border-[var(--v2-border)]">
                    {/* Title */}
                    <div>
                      <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-1">
                        {labels.step_title}
                      </label>
                      <input
                        type="text"
                        value={step.title}
                        onChange={(e) => updateStep(index, { title: e.target.value })}
                        placeholder={labels.placeholder_title}
                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-sm text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                      />
                    </div>

                    {/* Description */}
                    <div>
                      <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-1">
                        {labels.step_description}
                      </label>
                      <textarea
                        value={step.description}
                        onChange={(e) => updateStep(index, { description: e.target.value })}
                        placeholder={labels.placeholder_desc}
                        rows={2}
                        className="w-full px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg text-sm text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[#4F6EF7]"
                      />
                    </div>

                    {/* Icon Selector */}
                    <div>
                      <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-1">
                        {labels.step_icon}
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {STEP_ICONS.map((iconDef) => {
                          const Icon = iconDef.icon;
                          const isSelected = step.icon === iconDef.key;
                          return (
                            <button
                              key={iconDef.key}
                              onClick={() => updateStep(index, { icon: iconDef.key })}
                              className={`p-2 rounded-lg border transition-all ${
                                isSelected
                                  ? 'border-[#4F6EF7] bg-[#4F6EF7]/10 text-[#4F6EF7]'
                                  : 'border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:border-[#4F6EF7]/50'
                              }`}
                              title={iconDef.label}
                            >
                              <Icon className="w-4 h-4" />
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => moveStep(index, 'up')}
                          disabled={index === 0}
                          className="px-2 py-1 text-xs text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] disabled:opacity-30"
                        >
                          {language === 'he' ? '↓ למעלה' : '↑ Move Up'}
                        </button>
                        <button
                          onClick={() => moveStep(index, 'down')}
                          disabled={index === steps.length - 1}
                          className="px-2 py-1 text-xs text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] disabled:opacity-30"
                        >
                          {language === 'he' ? '↑ למטה' : '↓ Move Down'}
                        </button>
                      </div>
                      <button
                        onClick={() => removeStep(index)}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10 rounded"
                      >
                        <Trash2 className="w-3 h-3" />
                        {labels.remove_step}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Add Step Button */}
          <button
            onClick={addStep}
            className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-[var(--v2-border)] rounded-lg text-sm text-[var(--v2-text-secondary)] hover:border-[#4F6EF7] hover:text-[#4F6EF7] transition-colors"
          >
            <Plus className="w-4 h-4" />
            {labels.add_step}
          </button>
        </>
      )}
    </div>
  );
}
