import React from 'react';
import { Bot, CheckCircle2 } from 'lucide-react';

interface TypingIndicatorProps {
  steps?: string[];
  currentStep?: number;
}

export default function TypingIndicator({ steps, currentStep }: TypingIndicatorProps) {
  // Default simple indicator if no steps provided
  if (!steps || steps.length === 0) {
    return (
      <div className="flex gap-3 justify-start animate-fade-in">
        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
          <Bot className="h-4 w-4 text-white" />
        </div>

        <div className="bg-white/80 backdrop-blur-sm border border-white/30 rounded-xl px-4 py-3 shadow-md">
          <div className="flex items-center gap-3">
            <div className="flex space-x-1">
              <div
                className="w-2 h-2 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full animate-bounce"
                style={{ animationDelay: '0ms' }}
              />
              <div
                className="w-2 h-2 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full animate-bounce"
                style={{ animationDelay: '150ms' }}
              />
              <div
                className="w-2 h-2 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full animate-bounce"
                style={{ animationDelay: '300ms' }}
              />
            </div>
            <span className="text-sm text-gray-600 font-medium">AI thinking...</span>
          </div>
        </div>
      </div>
    );
  }

  // Enhanced indicator with steps
  return (
    <div className="flex gap-3 justify-start animate-fade-in">
      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
        <Bot className="h-4 w-4 text-white" />
      </div>

      <div className="bg-white/80 backdrop-blur-sm border border-white/30 rounded-xl px-4 py-3 shadow-md max-w-md">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex space-x-1">
            <div
              className="w-2 h-2 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full animate-bounce"
              style={{ animationDelay: '0ms' }}
            />
            <div
              className="w-2 h-2 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full animate-bounce"
              style={{ animationDelay: '150ms' }}
            />
            <div
              className="w-2 h-2 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full animate-bounce"
              style={{ animationDelay: '300ms' }}
            />
          </div>
          <span className="text-sm text-gray-600 font-medium">Analyzing...</span>
        </div>

        {/* Steps checklist */}
        <div className="space-y-1.5 pl-1">
          {steps.map((step, index) => {
            const isComplete = currentStep !== undefined && index < currentStep;
            const isCurrent = currentStep !== undefined && index === currentStep;

            return (
              <div
                key={index}
                className={`flex items-center gap-2 text-xs transition-all ${
                  isComplete
                    ? 'text-green-600'
                    : isCurrent
                    ? 'text-blue-600 font-medium'
                    : 'text-gray-400'
                }`}
              >
                {isComplete ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <div className={`w-3 h-3 rounded-full border-2 ${
                    isCurrent ? 'border-blue-500 bg-blue-100' : 'border-gray-300'
                  }`} />
                )}
                <span>{step}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
