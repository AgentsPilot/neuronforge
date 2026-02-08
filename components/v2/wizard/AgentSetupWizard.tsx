// components/v2/wizard/AgentSetupWizard.tsx
// Story-driven wizard to collect input values for calibration testing
// DOES NOT modify agent logic - only collects test input values
// Uses V2 design system components

'use client';

import { useState, useEffect } from 'react';
import { DetectionResult } from '@/lib/pilot/shadow/HardcodeDetector';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/v2/ui/card';
import { CheckCircle, Sparkles, Play, ChevronRight, ChevronLeft, X } from 'lucide-react';
import { AgentInputFields } from '@/components/v2/AgentInputFields';

type WizardStep = 'welcome' | 'selection' | 'ready';

interface AgentSetupWizardProps {
  agentName: string; // Used for wizard title/context
  detectionResult: DetectionResult | null;
  existingInputValues: Record<string, any>;
  inputSchema: any[];
  onComplete: (selectedParams: string[], makeConfigurable: boolean) => void; // Changed signature
  onSkip: () => void;
  isOpen: boolean;
  getDynamicOptions?: (fieldName: string) => {
    plugin: string;
    action: string;
    parameter: string;
    depends_on?: string[];
  } | null;
}

export function AgentSetupWizard({
  detectionResult,
  existingInputValues,
  inputSchema,
  onComplete,
  onSkip,
  isOpen,
  getDynamicOptions,
}: AgentSetupWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('welcome');
  const [selectedParams, setSelectedParams] = useState<Set<string>>(new Set()); // Track selected parameters
  const [generatedSchema, setGeneratedSchema] = useState<any[]>([]);

  // Generate schema from detected values
  useEffect(() => {
    if (detectionResult) {
      // Create schema from detected hardcoded values
      const schema: any[] = [];

      // Add resource IDs
      detectionResult.resource_ids.forEach(item => {
        schema.push({
          id: item.path, // Use path as unique ID (includes step)
          name: item.suggested_param,
          type: item.type,
          label: item.label,
          description: item.reason,
          category: 'resource_ids',
          value: item.value, // Store the actual hardcoded value
        });
      });

      // Add business logic values
      detectionResult.business_logic.forEach(item => {
        schema.push({
          id: item.path,
          name: item.suggested_param,
          type: item.type,
          label: item.label,
          description: item.reason,
          category: 'business_logic',
          value: item.value,
        });
      });

      // Add configuration values
      detectionResult.configuration.forEach(item => {
        schema.push({
          id: item.path,
          name: item.suggested_param,
          type: item.type,
          label: item.label,
          description: item.reason,
          category: 'configuration',
          value: item.value,
        });
      });

      setGeneratedSchema(schema);

      // Initialize all as selected by default (use unique IDs)
      setSelectedParams(new Set(schema.map(s => s.id)));
    }
  }, [detectionResult]);

  if (!isOpen || !detectionResult) return null;

  const handleToggleParam = (paramId: string) => {
    setSelectedParams(prev => {
      const newSet = new Set(prev);
      if (newSet.has(paramId)) {
        newSet.delete(paramId);
      } else {
        newSet.add(paramId);
      }
      return newSet;
    });
  };

  const handleToggleAll = () => {
    if (selectedParams.size === generatedSchema.length) {
      // Deselect all
      setSelectedParams(new Set());
    } else {
      // Select all (use unique IDs)
      setSelectedParams(new Set(generatedSchema.map(s => s.id)));
    }
  };

  const handleComplete = () => {
    onComplete(Array.from(selectedParams), true); // Always make configurable
  };

  const canProceed = () => {
    // At least one parameter must be selected
    return selectedParams.size > 0;
  };

  // Welcome Step
  if (currentStep === 'welcome') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <Card className="w-full max-w-2xl border-[var(--v2-border)] bg-[var(--v2-surface)]">
          <CardHeader className="border-b border-[var(--v2-border)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Sparkles className="w-6 h-6 text-[var(--v2-primary)]" />
                <CardTitle className="text-[var(--v2-text-primary)]">Let's Make It Flexible</CardTitle>
              </div>
              <button
                onClick={onSkip}
                className="text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-[var(--v2-text-secondary)] mt-2">
              We found some hardcoded values in your workflow. Let's convert them to input parameters so you can easily change them.
            </p>
          </CardHeader>

          <CardContent className="pt-6">
            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 border border-[var(--v2-border)] rounded-lg bg-[var(--v2-bg)]">
                <div className="w-6 h-6 border-2 border-[var(--v2-primary)] text-[var(--v2-primary)] rounded flex items-center justify-center flex-shrink-0 font-semibold text-xs">
                  1
                </div>
                <div>
                  <h3 className="font-medium text-sm text-[var(--v2-text-primary)] mb-0.5">Set Default Values</h3>
                  <p className="text-xs text-[var(--v2-text-secondary)]">
                    We found {generatedSchema.length} hardcoded value{generatedSchema.length !== 1 ? 's' : ''}. You'll set default values that can be changed later.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 border border-[var(--v2-border)] rounded-lg bg-[var(--v2-bg)]">
                <div className="w-6 h-6 border-2 border-[var(--v2-border)] text-[var(--v2-text-secondary)] rounded flex items-center justify-center flex-shrink-0 font-semibold text-xs">
                  2
                </div>
                <div>
                  <h3 className="font-medium text-sm text-[var(--v2-text-primary)] mb-0.5">Make Them Flexible</h3>
                  <p className="text-xs text-[var(--v2-text-secondary)]">
                    Your workflow will be updated to use input parameters instead of hardcoded values.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 border border-[var(--v2-border)] rounded-lg bg-[var(--v2-bg)]">
                <div className="w-6 h-6 border-2 border-[var(--v2-border)] text-[var(--v2-text-secondary)] rounded flex items-center justify-center flex-shrink-0 font-semibold text-xs">
                  3
                </div>
                <div>
                  <h3 className="font-medium text-sm text-[var(--v2-text-primary)] mb-0.5">Change Anytime</h3>
                  <p className="text-xs text-[var(--v2-text-secondary)]">
                    Switch values easily (like test vs. production) without editing your workflow.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>

          <CardFooter className="border-t border-[var(--v2-border)] flex items-center justify-between">
            <button
              onClick={onSkip}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-transparent text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors font-medium text-sm"
            >
              Skip for now
            </button>
            <button
              onClick={() => setCurrentStep('selection')}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity font-medium text-sm shadow-sm"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              Let's Get Started
              <ChevronRight className="w-4 h-4 ml-1" />
            </button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Selection Step - Choose which parameters to make configurable
  if (currentStep === 'selection') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <Card className="w-full max-w-3xl max-h-[90vh] flex flex-col border-[var(--v2-border)] bg-[var(--v2-surface)]">
          <CardHeader className="border-b border-[var(--v2-border)] flex-shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Sparkles className="w-6 h-6 text-[var(--v2-primary)]" />
                <CardTitle className="text-[var(--v2-text-primary)]">Select Values to Parameterize</CardTitle>
              </div>
              <button
                onClick={onSkip}
                className="text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-[var(--v2-text-secondary)] mt-2">
              Choose which hardcoded values you want to convert to input parameters
            </p>
          </CardHeader>

          <CardContent className="flex-1 overflow-y-auto pt-6">
            <div className="max-w-2xl mx-auto">
              {/* Select All Toggle */}
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-[var(--v2-border)]">
                <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                  {selectedParams.size} of {generatedSchema.length} selected
                </span>
                <button
                  onClick={handleToggleAll}
                  className="text-sm text-[var(--v2-primary)] hover:opacity-80 font-medium"
                >
                  {selectedParams.size === generatedSchema.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              {/* Parameter List */}
              <div className="space-y-2">
                {generatedSchema.map((param) => {
                  const isSelected = selectedParams.has(param.id);
                  return (
                    <div
                      key={param.id}
                      className="flex items-start gap-3 p-3 border border-[var(--v2-border)] rounded-lg hover:bg-[var(--v2-surface-hover)] transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                              {param.label}
                            </p>
                            <p className="text-xs text-[var(--v2-text-secondary)] mt-1">
                              {param.description}
                            </p>
                            <p className="text-xs text-[var(--v2-text-primary)] mt-2 font-mono bg-[var(--v2-bg)] px-2 py-1 rounded break-all">
                              {String(param.value).length > 60 ? String(param.value).substring(0, 60) + '...' : String(param.value)}
                            </p>
                          </div>
                          <div className="flex flex-col items-end gap-2 flex-shrink-0">
                            <span className="text-xs text-[var(--v2-text-secondary)] bg-[var(--v2-bg)] px-2 py-0.5 rounded-full whitespace-nowrap">
                              {param.category === 'resource_ids' && 'Resource ID'}
                              {param.category === 'business_logic' && 'Business Logic'}
                              {param.category === 'configuration' && 'Configuration'}
                            </span>
                            {/* Toggle Switch */}
                            <button
                              onClick={() => handleToggleParam(param.id)}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] focus:ring-offset-2 ${
                                isSelected ? 'bg-[var(--v2-primary)]' : 'bg-gray-300 dark:bg-gray-600'
                              }`}
                              role="switch"
                              aria-checked={isSelected}
                            >
                              <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                  isSelected ? 'translate-x-6' : 'translate-x-1'
                                }`}
                              />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>

          <CardFooter className="border-t border-[var(--v2-border)] flex items-center justify-between flex-shrink-0">
            <button
              onClick={() => setCurrentStep('welcome')}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-transparent text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors font-medium text-sm"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </button>
            <button
              onClick={() => setCurrentStep('ready')}
              disabled={!canProceed()}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity font-medium text-sm shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              Continue ({selectedParams.size})
              <ChevronRight className="w-4 h-4 ml-1" />
            </button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Ready Step
  if (currentStep === 'ready') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <Card className="w-full max-w-2xl border-[var(--v2-border)] bg-[var(--v2-surface)]">
          <CardHeader className="border-b border-[var(--v2-border)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-6 h-6 text-[var(--v2-success-icon)]" />
                <CardTitle className="text-[var(--v2-text-primary)]">All Set!</CardTitle>
              </div>
            </div>
            <p className="text-sm text-[var(--v2-text-secondary)] mt-2">
              Ready to make your workflow flexible!
            </p>
          </CardHeader>

          <CardContent className="pt-6">
            <div className="mb-6">
              <div className="border border-[var(--v2-border)] rounded-lg p-4 bg-[var(--v2-bg)]">
                <h3 className="text-sm font-medium text-[var(--v2-text-primary)] mb-3">
                  Parameters to be created ({selectedParams.size}):
                </h3>
                <ul className="space-y-2">
                  {generatedSchema
                    .filter(field => selectedParams.has(field.id))
                    .map((field) => (
                      <li key={field.id} className="flex items-start gap-2 text-xs">
                        <span className="text-[var(--v2-text-secondary)] mt-0.5">•</span>
                        <span className="text-[var(--v2-text-primary)]">
                          <strong className="font-medium">{field.label}</strong> - {field.description}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            </div>

            <div className="border-l-2 border-[var(--v2-primary)] pl-3 py-1">
              <p className="text-xs text-[var(--v2-text-secondary)]">
                <strong className="text-[var(--v2-text-primary)]">What happens next:</strong>{' '}
                Your workflow will be updated to use input parameters instead of hardcoded values.
                The current hardcoded values will be used as defaults, and you'll be able to change them anytime.
              </p>
            </div>
          </CardContent>

          <CardFooter className="border-t border-[var(--v2-border)] flex items-center justify-between">
            <button
              onClick={() => setCurrentStep('selection')}
              className="flex items-center justify-center gap-2 px-3 py-2 bg-transparent text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors font-medium text-sm"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back
            </button>
            <button
              onClick={handleComplete}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity font-medium text-sm shadow-sm"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <CheckCircle className="w-4 h-4" />
              Parameterize Workflow
            </button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return null;
}
