'use client';

// components/v2/calibration/DataFlowDiagram.tsx
// Visual diagram showing data flow through workflow

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

interface DataFlowDiagramProps {
  dataFlows: DataFlow[];
}

export function DataFlowDiagram({ dataFlows }: DataFlowDiagramProps) {
  if (dataFlows.length === 0) {
    return (
      <div className="border rounded-lg p-6 bg-gray-50 text-center">
        <p className="text-gray-600">No data flows to visualize</p>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-6 bg-white shadow-sm">
      <h3 className="font-semibold text-gray-900 mb-4">Data Flow Diagram</h3>

      <div className="space-y-6">
        {dataFlows.map(flow => (
          <div key={flow.variable} className="border-l-4 border-blue-500 pl-4">
            {/* Variable header */}
            <div className="font-medium text-sm mb-3">
              <code className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                {flow.variable}
              </code>
              <span className="ml-2 text-gray-500">({flow.type})</span>
            </div>

            {/* Fields in this variable */}
            {flow.fields.length > 0 && (
              <div className="mb-3 text-xs text-gray-600">
                <span className="font-medium">Fields:</span>
                {' '}
                {flow.fields.map((field, idx) => (
                  <span key={field}>
                    {idx > 0 && ', '}
                    <code className="bg-gray-100 px-1 py-0.5 rounded">{field}</code>
                  </span>
                ))}
              </div>
            )}

            {/* Producer */}
            <div className="mb-3">
              <div className="text-xs text-gray-600 mb-1 font-medium">Produced by:</div>
              <div className="bg-green-50 border border-green-200 rounded px-3 py-2">
                <div className="text-sm font-medium text-green-900">
                  {flow.producedBy.stepName}
                </div>
                <div className="text-xs text-green-700 mt-1">
                  {flow.producedBy.plugin} → {flow.producedBy.action}
                </div>
              </div>
            </div>

            {/* Transformations */}
            {flow.transformations.length > 0 && (
              <div className="mb-3">
                <div className="text-xs text-gray-600 mb-1 font-medium">Transformations:</div>
                <div className="space-y-1">
                  {flow.transformations.map((transform, idx) => (
                    <div
                      key={idx}
                      className="bg-amber-50 border border-amber-200 rounded px-3 py-2"
                    >
                      <div className="text-sm font-medium text-amber-900">
                        {transform.type}
                      </div>
                      <div className="text-xs text-amber-700 mt-1">
                        {transform.description}
                      </div>
                      <div className="text-xs text-amber-600 mt-1">
                        At step: {transform.stepName}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Consumers */}
            {flow.consumedBy.length > 0 ? (
              <div>
                <div className="text-xs text-gray-600 mb-1 font-medium">Consumed by:</div>
                <div className="space-y-1">
                  {flow.consumedBy.map(consumer => (
                    <div
                      key={consumer.stepId}
                      className="bg-blue-50 border border-blue-200 rounded px-3 py-2"
                    >
                      <div className="text-sm font-medium text-blue-900">
                        {consumer.stepName}
                      </div>
                      {consumer.fieldsUsed.length > 0 && (
                        <div className="text-xs text-blue-700 mt-1">
                          Uses fields: {consumer.fieldsUsed.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2">
                <div className="text-sm text-amber-900">
                  ⚠️ Not consumed by any step (orphaned variable)
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
