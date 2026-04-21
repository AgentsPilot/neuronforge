'use client';

// components/v2/calibration/WorkflowPreview.tsx
// Main preview component showing step-by-step data flow with mock data

import { useState, useEffect } from 'react';
import { Loader, AlertTriangle } from 'lucide-react';
import { StepPreviewCard } from './StepPreviewCard';
import { DataFlowDiagram } from './DataFlowDiagram';

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

interface PreviewData {
  success: boolean;
  preview: StepPreview[];
  dataFlows: {
    flows: DataFlow[];
    orphanedVariables: DataFlow[];
    missingProducers: any[];
  };
  metadata?: {
    agentId: string;
    agentName: string;
    totalSteps: number;
    generatedAt: string;
  };
}

interface WorkflowPreviewProps {
  agentId: string;
}

export function WorkflowPreview({ agentId }: WorkflowPreviewProps) {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDataFlow, setShowDataFlow] = useState(false);

  useEffect(() => {
    loadPreview();
  }, [agentId]);

  async function loadPreview() {
    try {
      setLoading(true);
      setError(null);

      // Generate preview with mock data
      const response = await fetch('/api/v2/calibrate/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ agentId })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate preview');
      }

      const previewData: PreviewData = await response.json();
      setPreview(previewData);

    } catch (err: any) {
      console.error('Preview loading failed:', err);
      setError(err.message || 'Failed to load workflow preview');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="border rounded-lg p-6 bg-gray-50 text-center">
        <Loader className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-600" />
        <h3 className="text-lg font-medium text-gray-900">
          Generating workflow preview...
        </h3>
        <p className="text-sm text-gray-600 mt-2">
          Creating mock data for each step
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-2 border-red-400 rounded-lg p-6 bg-red-50">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-1" />
          <div className="flex-1">
            <h3 className="text-lg font-medium text-red-900">
              Unable to generate preview
            </h3>
            <p className="text-sm text-red-700 mt-2">
              {error}
            </p>
            <button
              onClick={loadPreview}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!preview || !preview.preview || preview.preview.length === 0) {
    return (
      <div className="border rounded-lg p-6 bg-gray-50 text-center">
        <p className="text-gray-600">No workflow steps to preview</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">
            Workflow Preview
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Preview with mock data - no real API calls executed
          </p>
        </div>

        {preview.dataFlows && preview.dataFlows.flows.length > 0 && (
          <button
            onClick={() => setShowDataFlow(!showDataFlow)}
            className="px-4 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            {showDataFlow ? 'Hide' : 'Show'} Data Flow Diagram
          </button>
        )}
      </div>

      {/* Metadata */}
      {preview.metadata && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-gray-600">Agent</div>
              <div className="font-medium text-gray-900">{preview.metadata.agentName}</div>
            </div>
            <div>
              <div className="text-gray-600">Total Steps</div>
              <div className="font-medium text-gray-900">{preview.metadata.totalSteps}</div>
            </div>
            <div>
              <div className="text-gray-600">Data Flows</div>
              <div className="font-medium text-gray-900">{preview.dataFlows.flows.length}</div>
            </div>
            <div>
              <div className="text-gray-600">Generated</div>
              <div className="font-medium text-gray-900">
                {new Date(preview.metadata.generatedAt).toLocaleTimeString()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Warnings */}
      {preview.dataFlows.orphanedVariables.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-amber-900">
                {preview.dataFlows.orphanedVariables.length} orphaned variable
                {preview.dataFlows.orphanedVariables.length === 1 ? '' : 's'} detected
              </div>
              <div className="text-sm text-amber-700 mt-1">
                These variables are produced but never used:
                {' '}
                {preview.dataFlows.orphanedVariables.map(v => v.variable).join(', ')}
              </div>
            </div>
          </div>
        </div>
      )}

      {preview.dataFlows.missingProducers.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-red-900">
                {preview.dataFlows.missingProducers.length} missing producer
                {preview.dataFlows.missingProducers.length === 1 ? '' : 's'} detected
              </div>
              <div className="text-sm text-red-700 mt-1">
                These variables are referenced but not produced
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Data Flow Diagram */}
      {showDataFlow && preview.dataFlows && (
        <DataFlowDiagram dataFlows={preview.dataFlows.flows} />
      )}

      {/* Step-by-step preview */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">
          Step-by-Step Execution
        </h3>

        {preview.preview.map((step, idx) => (
          <StepPreviewCard
            key={step.stepId}
            step={step}
            stepNumber={idx + 1}
            dataFlows={preview.dataFlows.flows.filter(
              f => f.producedBy.stepId === step.stepId
            )}
          />
        ))}
      </div>

      {/* Refresh button */}
      <div className="flex justify-center pt-4">
        <button
          onClick={loadPreview}
          className="px-6 py-2 text-sm border border-gray-300 rounded hover:bg-gray-50"
        >
          Refresh Preview
        </button>
      </div>
    </div>
  );
}
