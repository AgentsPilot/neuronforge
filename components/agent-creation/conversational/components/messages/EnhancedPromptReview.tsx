import React, { useState } from 'react';
import { Sparkles, CheckCircle, Edit, ChevronDown, ChevronUp, Plug, AlertCircle } from 'lucide-react';
import { EnhancedPromptReviewProps } from '../../types';

export default function EnhancedPromptReview({
  enhancedPrompt,
  requiredServices,
  connectedPlugins,
  onAccept,
  onRevise
}: EnhancedPromptReviewProps) {
  const [isStepsExpanded, setIsStepsExpanded] = useState(false);

  // Helper to check if a service is connected
  const isServiceConnected = (serviceName: string) => {
    return connectedPlugins.includes(serviceName);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-6 h-6 bg-purple-500 rounded-lg flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <h4 className="font-semibold text-gray-800">Your Agent Plan</h4>
      </div>

      <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200 rounded-lg p-5 space-y-4">

        {/* Title */}
        <div className="pb-3 border-b border-purple-200">
          <h3 className="text-lg font-bold text-gray-900">
            📋 {enhancedPrompt.plan_title}
          </h3>
        </div>

        {/* Description */}
        <div>
          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
            📝 Description
          </h4>
          <p className="text-sm text-gray-700 leading-relaxed">
            {enhancedPrompt.plan_description}
          </p>
        </div>

        {/* How it works - Expandable */}
        <div>
          <button
            onClick={() => setIsStepsExpanded(!isStepsExpanded)}
            className="w-full flex items-center justify-between py-2 px-3 bg-white/50 rounded-lg hover:bg-white/70 transition-colors"
          >
            <span className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              {isStepsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              How it works ({enhancedPrompt.sections.processing_steps.length} steps)
            </span>
          </button>

          {isStepsExpanded && (
            <div className="mt-3 space-y-3 bg-white/60 rounded-lg p-4">
              {enhancedPrompt.sections.processing_steps.map((step, index) => (
                <div key={index} className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-gray-700 leading-relaxed">{step}</p>
                  </div>
                </div>
              ))}

              {/* Additional sections */}
              {enhancedPrompt.sections.data && (
                <div className="mt-4 pt-3 border-t border-gray-200">
                  <p className="text-xs font-semibold text-gray-600 mb-1">📊 Data Source</p>
                  <p className="text-sm text-gray-700">{enhancedPrompt.sections.data}</p>
                </div>
              )}

              {enhancedPrompt.sections.output && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-gray-600 mb-1">📤 Output</p>
                  <p className="text-sm text-gray-700">{enhancedPrompt.sections.output}</p>
                </div>
              )}

              {enhancedPrompt.sections.delivery && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-gray-600 mb-1">📬 Delivery</p>
                  <p className="text-sm text-gray-700">{enhancedPrompt.sections.delivery}</p>
                </div>
              )}

              {enhancedPrompt.sections.error_handling && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-gray-600 mb-1">🛡️ Error Handling</p>
                  <p className="text-sm text-gray-700">{enhancedPrompt.sections.error_handling}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Required Services */}
        <div>
          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 flex items-center gap-1">
            <Plug className="h-3 w-3" />
            Required Services
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {requiredServices.map((service) => {
              const connected = isServiceConnected(service);
              return (
                <div
                  key={service}
                  className={`
                    flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
                    ${connected
                      ? 'bg-green-100 text-green-800 border border-green-300'
                      : 'bg-orange-100 text-orange-800 border border-orange-300'
                    }
                  `}
                >
                  {connected ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <span className="capitalize">{service.replace(/-/g, ' ')}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Trigger Scope (if available) */}
        {enhancedPrompt.specifics.trigger_scope && (
          <div className="pt-3 border-t border-purple-200">
            <p className="text-xs text-gray-600">
              <span className="font-semibold">⏰ Trigger:</span> {enhancedPrompt.specifics.trigger_scope}
            </p>
          </div>
        )}
      </div>

      {/* Confirmation */}
      <p className="text-sm text-gray-600 mt-4">Does this look right?</p>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <button
          onClick={onAccept}
          className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-green-600 text-white rounded-lg hover:from-emerald-600 hover:to-green-700 font-semibold flex items-center justify-center gap-2 transition-all shadow-md hover:shadow-lg"
        >
          <CheckCircle className="h-5 w-5" />
          Yes, perfect!
        </button>

        <button
          onClick={onRevise}
          className="px-6 py-3 bg-white border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 hover:bg-gray-50 font-semibold flex items-center justify-center gap-2 transition-all"
        >
          <Edit className="h-5 w-5" />
          Need changes
        </button>
      </div>
    </div>
  );
}
