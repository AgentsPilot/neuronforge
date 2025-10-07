import React from 'react';
import { 
  Brain, 
  Loader2, 
  AlertTriangle, 
  RefreshCw,
  ArrowLeft,
  Sparkles,
  CheckCircle,
  Settings
} from 'lucide-react';

// Loading View Component - Used during agent generation
export const LoadingView = ({ 
  promptType 
}: {
  promptType: string;
}) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white/95 backdrop-blur-2xl rounded-3xl p-8 shadow-2xl border border-white/30 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-400/10 via-purple-400/10 to-indigo-400/10 animate-pulse"></div>
        
        <div className="absolute top-4 left-8 w-2 h-2 bg-blue-400/30 rounded-full animate-bounce delay-75"></div>
        <div className="absolute top-12 right-12 w-1.5 h-1.5 bg-purple-400/40 rounded-full animate-bounce delay-150"></div>
        <div className="absolute bottom-8 left-12 w-1 h-1 bg-indigo-400/30 rounded-full animate-bounce delay-300"></div>
        
        <div className="relative z-10">
          <div className="relative mb-8">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 rounded-3xl flex items-center justify-center mx-auto shadow-2xl animate-pulse">
              <Brain className="h-10 w-10 text-white" />
            </div>
            
            <div className="absolute inset-0 animate-spin" style={{animationDuration: '8s'}}>
              <div className="absolute -top-2 left-1/2 transform -translate-x-1/2 w-4 h-4 bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full shadow-lg flex items-center justify-center">
                <Sparkles className="h-2.5 w-2.5 text-white" />
              </div>
            </div>
            
            <div className="absolute inset-0 animate-spin" style={{animationDuration: '6s', animationDirection: 'reverse'}}>
              <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-gradient-to-r from-orange-400 to-pink-500 rounded-full shadow-lg"></div>
            </div>
          </div>
          
          <div className="mb-8">
            <h3 className="text-2xl font-bold bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 bg-clip-text text-transparent mb-3">
              Building Your Smart Agent
            </h3>
            <p className="text-gray-600 text-base leading-relaxed">
              AI is analyzing your <span className="font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">{promptType}</span> prompt and generating the perfect automation workflow...
            </p>
          </div>
          
          <div className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 backdrop-blur-sm rounded-2xl border border-green-200/60 shadow-sm">
              <div className="w-8 h-8 bg-gradient-to-r from-green-500 to-emerald-500 rounded-xl flex items-center justify-center shadow-md">
                <CheckCircle className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 text-left">
                <span className="text-green-800 font-semibold text-sm">Requirements Extracted</span>
                <div className="text-green-600 text-xs mt-0.5">Workflow structure identified</div>
              </div>
            </div>
            
            <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 backdrop-blur-sm rounded-2xl border border-blue-200/60 shadow-sm">
              <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-md">
                <Loader2 className="h-4 w-4 animate-spin text-white" />
              </div>
              <div className="flex-1 text-left">
                <span className="text-blue-800 font-semibold text-sm">Generating Configuration</span>
                <div className="text-blue-600 text-xs mt-0.5">Creating optimal workflow steps...</div>
              </div>
            </div>
            
            <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-purple-50 to-violet-50 backdrop-blur-sm rounded-2xl border border-purple-200/60 shadow-sm opacity-60">
              <div className="w-8 h-8 bg-gradient-to-r from-purple-400 to-violet-400 rounded-xl flex items-center justify-center shadow-md">
                <Settings className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 text-left">
                <span className="text-purple-700 font-semibold text-sm">Finalizing Setup</span>
                <div className="text-purple-600 text-xs mt-0.5">Almost ready...</div>
              </div>
            </div>
          </div>
          
          <div className="mt-8">
            <div className="w-full bg-gray-200/60 rounded-full h-1.5 shadow-inner">
              <div className="bg-gradient-to-r from-blue-500 to-indigo-500 h-1.5 rounded-full shadow-sm animate-pulse" style={{width: '75%'}}></div>
            </div>
            <p className="text-xs text-gray-500 mt-2">This may take a few moments...</p>
          </div>
        </div>
      </div>
    </div>
  );
};

// Error View Component - Used when agent generation fails
export const ErrorView = ({ 
  error, 
  onRetry, 
  onBack, 
  editMode = false 
}: {
  error: string;
  onRetry: () => void;
  onBack?: () => void;
  editMode?: boolean;
}) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-red-50 to-orange-50 flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white/70 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/20 text-center">
        <div className="w-24 h-24 bg-gradient-to-br from-red-500 to-red-600 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl">
          <AlertTriangle className="h-12 w-12 text-white" />
        </div>
        
        <h3 className="text-2xl font-bold text-gray-900 mb-4">Generation Failed</h3>
        <p className="text-red-600 mb-8 leading-relaxed bg-red-50/80 rounded-2xl p-4 border border-red-200">{error}</p>
        
        <div className="space-y-4">
          <button
            onClick={onRetry}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 rounded-2xl hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 flex items-center justify-center gap-3 font-semibold shadow-lg transform hover:scale-[1.02]"
          >
            <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
              <RefreshCw className="h-4 w-4" />
            </div>
            Try Again
          </button>
          {onBack && !editMode && (
            <button
              onClick={onBack}
              className="w-full bg-white/90 text-gray-700 px-6 py-4 rounded-2xl hover:bg-white transition-all duration-200 flex items-center justify-center gap-3 font-medium shadow-sm border border-gray-200"
            >
              <ArrowLeft className="h-4 w-4" />
              Go Back
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Empty View Component - Used when no agent is generated
export const EmptyView = ({ 
  onRetry, 
  onBack 
}: {
  onRetry: () => void;
  onBack?: () => void;
}) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-blue-50 flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-white/70 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/20 text-center">
        <div className="w-24 h-24 bg-gradient-to-br from-gray-300 to-gray-400 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-lg">
          <Brain className="h-12 w-12 text-white" />
        </div>
        
        <h3 className="text-2xl font-bold text-gray-900 mb-4">No Agent Generated</h3>
        <p className="text-gray-600 mb-8 leading-relaxed">
          Unable to generate agent from the provided prompt. Please try again or go back to refine your prompt.
        </p>
        
        <div className="space-y-4">
          <button
            onClick={onRetry}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 rounded-2xl hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 font-semibold shadow-lg transform hover:scale-[1.02]"
          >
            Retry Generation
          </button>
          {onBack && (
            <button
              onClick={onBack}
              className="w-full bg-white/90 text-gray-700 px-6 py-4 rounded-2xl hover:bg-white transition-all duration-200 font-medium shadow-sm border border-gray-200"
            >
              Go Back
            </button>
          )}
        </div>
      </div>
    </div>
  );
};