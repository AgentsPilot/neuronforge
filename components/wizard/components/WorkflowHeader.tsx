import React from 'react';
import { 
  Brain, 
  Sparkles, 
  CheckCircle, 
  ChevronDown, 
  ChevronUp 
} from 'lucide-react';
import type { GeneratedPlan } from '../workflowAnalysis';

interface WorkflowHeaderProps {
  generatedPlan: GeneratedPlan;
  showAnalysisDetails: boolean;
  onToggleAnalysisDetails: () => void;
  userPrompt: string;
}

export function WorkflowHeader({ 
  generatedPlan, 
  showAnalysisDetails, 
  onToggleAnalysisDetails,
  userPrompt 
}: WorkflowHeaderProps) {
  return (
    <>
      {/* Header with AI Confidence */}
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-r from-emerald-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Sparkles className="h-8 w-8 text-white" />
        </div>
        <h3 className="text-2xl font-semibold text-gray-900 mb-2">AI-Generated Workflow</h3>
        <p className="text-gray-600 mb-4">
          ChatGPT designed {generatedPlan.steps.length} workflow steps with {generatedPlan.confidence}% confidence
        </p>
        
        <div className="flex items-center justify-center gap-4 mb-4">
          <div className="inline-flex items-center gap-2 bg-emerald-100 text-emerald-800 px-4 py-2 rounded-full text-sm font-medium">
            <CheckCircle className="h-4 w-4" />
            {generatedPlan.confidence}% AI Confidence
          </div>
        </div>
      </div>

      {/* Analysis Summary Card */}
      <div className="bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center">
              <Brain className="h-5 w-5 text-white" />
            </div>
            <div>
              <h4 className="font-semibold text-gray-900">ChatGPT Analysis Summary</h4>
              <p className="text-sm text-gray-600">
                {generatedPlan.steps.length} steps across {generatedPlan.detectedCategories?.length || 0} categories
              </p>
            </div>
          </div>
          <button
            onClick={onToggleAnalysisDetails}
            className="flex items-center gap-2 text-emerald-700 hover:text-emerald-900 text-sm font-medium transition-colors"
          >
            {showAnalysisDetails ? 'Hide Details' : 'Show Details'}
            {showAnalysisDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>

        {showAnalysisDetails && (
          <div className="bg-white rounded-xl p-4 border border-emerald-200 space-y-4">
            <div>
              <h5 className="font-medium text-gray-900 mb-2">Original Prompt:</h5>
              <div className="bg-gray-50 rounded-lg p-3 border-l-4 border-blue-500 italic text-sm text-gray-700">
                "{userPrompt}"
              </div>
            </div>
            <div>
              <h5 className="font-medium text-gray-900 mb-2">AI Reasoning:</h5>
              <p className="text-sm text-gray-700">{generatedPlan.reasoning}</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}