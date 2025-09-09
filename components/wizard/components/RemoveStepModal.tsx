import React from 'react';
import { AlertTriangle, Database, Download, CheckCircle } from 'lucide-react';
import type { PluginStep, RequiredInput, Output } from '../types';

interface StepToRemove {
  step: PluginStep;
  relatedInputs: RequiredInput[];
  relatedOutputs: Output[];
}

interface RemoveStepModalProps {
  isOpen: boolean;
  stepToRemove: StepToRemove | null;
  onConfirm: (stepData: StepToRemove) => void;
  onCancel: () => void;
}

export function RemoveStepModal({
  isOpen,
  stepToRemove,
  onConfirm,
  onCancel
}: RemoveStepModalProps) {
  if (!isOpen || !stepToRemove) {
    return null;
  }

  const { step, relatedInputs, relatedOutputs } = stepToRemove;
  const hasRelatedItems = relatedInputs.length > 0 || relatedOutputs.length > 0;

  const handleConfirm = () => {
    onConfirm(stepToRemove);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-300">
        {/* Modal Header */}
        <div className="px-6 py-5 bg-gradient-to-r from-red-500 to-rose-600">
          <div className="flex items-center gap-3 text-white">
            <div className="p-2 bg-white/20 rounded-xl">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Remove Plugin Step</h3>
              <p className="text-red-100 text-sm">This action cannot be undone</p>
            </div>
          </div>
        </div>

        {/* Modal Content */}
        <div className="p-6">
          {/* Plugin being removed */}
          <div className="flex items-center gap-4 p-4 bg-red-50 rounded-xl border border-red-200 mb-4">
            <div className="text-2xl">{step.icon}</div>
            <div className="flex-1">
              <h4 className="font-semibold text-red-900">{step.pluginName}</h4>
              <p className="text-red-700 text-sm">{step.action}</p>
            </div>
            <div className="text-red-500">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>

          {/* Related items warning or confirmation */}
          {hasRelatedItems ? (
            <div className="space-y-4">
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                <div className="flex items-start gap-3 mb-3">
                  <AlertTriangle className="w-5 h-5 text-orange-600 mt-0.5" />
                  <div>
                    <h5 className="font-semibold text-orange-900">Related items will also be removed</h5>
                    <p className="text-orange-700 text-sm">The following configurations are connected to this step:</p>
                  </div>
                </div>

                {relatedInputs.length > 0 && (
                  <div className="mb-3">
                    <h6 className="font-medium text-orange-800 text-sm mb-2 flex items-center gap-2">
                      <Database className="w-4 h-4" />
                      {relatedInputs.length} Input Field{relatedInputs.length > 1 ? 's' : ''}
                    </h6>
                    <div className="space-y-1">
                      {relatedInputs.slice(0, 3).map((input, index) => (
                        <div key={index} className="flex items-center gap-2 text-sm text-orange-700">
                          <div className="w-1.5 h-1.5 bg-orange-500 rounded-full"></div>
                          <span className="truncate">{input.name}</span>
                        </div>
                      ))}
                      {relatedInputs.length > 3 && (
                        <div className="text-xs text-orange-600 ml-3">
                          +{relatedInputs.length - 3} more items
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {relatedOutputs.length > 0 && (
                  <div>
                    <h6 className="font-medium text-orange-800 text-sm mb-2 flex items-center gap-2">
                      <Download className="w-4 h-4" />
                      {relatedOutputs.length} Output Definition{relatedOutputs.length > 1 ? 's' : ''}
                    </h6>
                    <div className="space-y-1">
                      {relatedOutputs.slice(0, 3).map((output, index) => (
                        <div key={index} className="flex items-center gap-2 text-sm text-orange-700">
                          <div className="w-1.5 h-1.5 bg-orange-500 rounded-full"></div>
                          <span className="truncate">{output.type || output.name}</span>
                        </div>
                      ))}
                      {relatedOutputs.length > 3 && (
                        <div className="text-xs text-orange-600 ml-3">
                          +{relatedOutputs.length - 3} more items
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-blue-600" />
                <div>
                  <h5 className="font-medium text-blue-900">No related items</h5>
                  <p className="text-blue-700 text-sm">Only this plugin step will be removed.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="bg-gray-50 px-6 py-4 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors font-medium"
          >
            Remove Step
          </button>
        </div>
      </div>
    </div>
  );
}