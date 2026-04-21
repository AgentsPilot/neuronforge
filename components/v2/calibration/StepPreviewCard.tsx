'use client';

// components/v2/calibration/StepPreviewCard.tsx
// Individual step preview showing mock output and data flow

import { useState } from 'react';
import { ChevronDown, ChevronRight, ArrowRight } from 'lucide-react';

interface StepPreview {
  stepId: string;
  stepName: string;
  plugin: string;
  action: string;
  mockOutput: any;
  fieldsProduced: string[];
}

interface DataFlow {
  variable: string;
  type: string;
  fields: string[];
  producedBy: {
    stepId: string;
    stepName: string;
    plugin: string;
    action: string;
  };
  consumedBy: Array<{
    stepId: string;
    stepName: string;
    fieldsUsed: string[];
  }>;
  transformations: Array<{
    type: string;
    description: string;
    stepId: string;
    stepName: string;
  }>;
}

interface StepPreviewCardProps {
  step: StepPreview;
  stepNumber: number;
  dataFlows: DataFlow[];
}

export function StepPreviewCard({
  step,
  stepNumber,
  dataFlows
}: StepPreviewCardProps) {
  const [showOutput, setShowOutput] = useState(false);

  return (
    <div className="border rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        {/* Step number badge */}
        <div className="bg-blue-100 text-blue-700 rounded-full w-8 h-8 flex items-center justify-center font-semibold flex-shrink-0">
          {stepNumber}
        </div>

        <div className="flex-1 min-w-0">
          {/* Step name and plugin */}
          <h3 className="font-medium text-gray-900 truncate">
            {step.stepName}
          </h3>
          <div className="text-sm text-gray-600 mt-1">
            <span className="font-medium">{step.plugin}</span>
            {' → '}
            <span>{step.action}</span>
          </div>

          {/* Fields produced */}
          {step.fieldsProduced.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-gray-500 mb-1">Produces:</div>
              <div className="flex flex-wrap gap-1">
                {step.fieldsProduced.map(field => (
                  <code
                    key={field}
                    className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded border border-green-200"
                  >
                    {field}
                  </code>
                ))}
              </div>
            </div>
          )}

          {/* Data flow arrows */}
          {dataFlows.length > 0 && (
            <div className="mt-3 space-y-2">
              {dataFlows.map(flow => (
                <div key={flow.variable} className="bg-blue-50 border border-blue-200 rounded p-2">
                  <div className="text-xs font-medium text-blue-900 mb-1">
                    Variable: <code>{flow.variable}</code>
                    <span className="ml-2 text-blue-600">({flow.type})</span>
                  </div>

                  {flow.consumedBy.length > 0 && (
                    <div className="flex items-center gap-2 text-xs text-blue-700">
                      <ArrowRight className="w-3 h-3 flex-shrink-0" />
                      <span>
                        Used by:{' '}
                        {flow.consumedBy.map((c, idx) => (
                          <span key={c.stepId}>
                            {idx > 0 && ', '}
                            <span className="font-medium">{c.stepName}</span>
                            {c.fieldsUsed.length > 0 && (
                              <span className="text-blue-600">
                                {' '}({c.fieldsUsed.join(', ')})
                              </span>
                            )}
                          </span>
                        ))}
                      </span>
                    </div>
                  )}

                  {flow.transformations.length > 0 && (
                    <div className="mt-1 text-xs text-amber-700">
                      Transformations: {flow.transformations.map(t => t.type).join(' → ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Toggle mock output */}
          <button
            onClick={() => setShowOutput(!showOutput)}
            className="mt-3 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 hover:underline"
          >
            {showOutput ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            {showOutput ? 'Hide' : 'Show'} example output
          </button>

          {/* Mock output (collapsible) */}
          {showOutput && (
            <div className="mt-3 bg-gray-50 border border-gray-200 rounded p-3">
              <div className="text-xs text-gray-500 mb-2 font-medium">
                Example output (mock data):
              </div>
              <pre className="text-xs overflow-x-auto max-h-96 overflow-y-auto bg-white p-2 rounded border border-gray-200">
                {JSON.stringify(step.mockOutput, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
