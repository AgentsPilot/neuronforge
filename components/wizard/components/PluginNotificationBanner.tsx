import React, { useState, useEffect } from 'react';
import { Brain, Loader2, X, CheckCircle2, AlertTriangle, Sparkles, RefreshCw } from 'lucide-react';
import type { PluginStep } from '../types';

interface PluginNotification {
  isGenerating: boolean;
  generated: { inputs: number; outputs: number } | null;
  showNotification: boolean;
}

// New interface for replacement notifications
interface PluginReplacementNotification {
  type: 'replacement';
  oldStep: PluginStep;
  newPluginKey: string;
  newPluginName: string;
  status: 'processing' | 'completed' | 'error';
  error?: string;
}

interface PluginNotificationBannerProps {
  pluginKey: string;
  step: PluginStep;
  notification?: PluginNotification;
  replacementNotification?: PluginReplacementNotification;
  onReview?: (pluginKey: string) => void;
  onAccept?: (pluginKey: string) => void;
  onDismiss: (pluginKey: string) => void;
}

export function PluginNotificationBanner({
  pluginKey,
  step,
  notification,
  replacementNotification,
  onReview,
  onAccept,
  onDismiss
}: PluginNotificationBannerProps) {
  const [progress, setProgress] = useState(0);

  // Handle replacement processing animation
  useEffect(() => {
    if (replacementNotification?.status === 'processing') {
      const interval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 95) return prev;
          return prev + Math.random() * 10;
        });
      }, 200);
      return () => clearInterval(interval);
    } else if (replacementNotification?.status === 'completed') {
      setProgress(100);
    }
  }, [replacementNotification?.status]);

  // Don't show if no notifications
  if (!notification?.showNotification && !replacementNotification) {
    return null;
  }

  // Handle replacement notifications
  if (replacementNotification) {
    const getReplacementConfig = () => {
      switch (replacementNotification.status) {
        case 'processing':
          return {
            bgColor: 'bg-gradient-to-r from-blue-50 to-purple-50',
            borderColor: 'border-blue-200',
            iconBg: 'bg-blue-500',
            textColor: 'text-blue-900',
            subtextColor: 'text-blue-700',
            icon: <Brain className="h-5 w-5" />
          };
        case 'completed':
          return {
            bgColor: 'bg-gradient-to-r from-green-50 to-emerald-50',
            borderColor: 'border-green-200',
            iconBg: 'bg-green-500',
            textColor: 'text-green-900',
            subtextColor: 'text-green-700',
            icon: <CheckCircle2 className="h-5 w-5" />
          };
        case 'error':
          return {
            bgColor: 'bg-gradient-to-r from-red-50 to-orange-50',
            borderColor: 'border-red-200',
            iconBg: 'bg-red-500',
            textColor: 'text-red-900',
            subtextColor: 'text-red-700',
            icon: <AlertTriangle className="h-5 w-5" />
          };
      }
    };

    const config = getReplacementConfig();

    const getTitle = () => {
      switch (replacementNotification.status) {
        case 'processing':
          return 'AI Processing Plugin Replacement';
        case 'completed':
          return 'Plugin Replacement Complete';
        case 'error':
          return 'Plugin Replacement Failed';
      }
    };

    const getMessage = () => {
      switch (replacementNotification.status) {
        case 'processing':
          return "AI is analyzing the new plugin's inputs and outputs...";
        case 'completed':
          return `Successfully replaced "${replacementNotification.oldStep.pluginName}" with "${replacementNotification.newPluginName}". The AI has updated inputs and outputs accordingly.`;
        case 'error':
          return replacementNotification.error || 'Failed to process the plugin replacement. Please try again.';
      }
    };

    return (
      <div className={`${config.bgColor} border-2 ${config.borderColor} rounded-2xl p-6 mb-6`}>
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 ${config.iconBg} rounded-xl flex items-center justify-center flex-shrink-0 text-white relative`}>
            {config.icon}
            {replacementNotification.status === 'processing' && (
              <Loader2 className="h-4 w-4 animate-spin absolute -top-1 -right-1 bg-white text-blue-600 rounded-full" />
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between mb-2">
              <h4 className={`font-semibold ${config.textColor} flex items-center gap-2`}>
                {getTitle()}
                {replacementNotification.status === 'processing' && (
                  <Sparkles className="h-4 w-4 text-blue-500 animate-pulse" />
                )}
              </h4>
              
              {replacementNotification.status !== 'processing' && (
                <button
                  onClick={() => onDismiss(pluginKey)}
                  className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-white/50"
                  title="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            
            <p className={`${config.subtextColor} text-sm mb-3`}>
              {getMessage()}
            </p>
            
            <div className="flex items-center gap-4 text-xs mb-3">
              <div className="flex items-center gap-2">
                <span className={`${config.subtextColor} font-medium`}>From:</span>
                <span className="bg-white/60 px-2 py-1 rounded-lg font-medium">
                  {replacementNotification.oldStep.pluginName}
                </span>
              </div>
              <div className="text-gray-400">→</div>
              <div className="flex items-center gap-2">
                <span className={`${config.subtextColor} font-medium`}>To:</span>
                <span className="bg-white/60 px-2 py-1 rounded-lg font-medium">
                  {replacementNotification.newPluginName}
                </span>
              </div>
            </div>
            
            {replacementNotification.status === 'processing' && (
              <div className="space-y-2">
                <div className="bg-white/50 rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-300 ease-out" 
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-xs text-blue-600">
                  Analyzing plugin capabilities and updating workflow configuration...
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Handle regular plugin notifications (existing functionality)
  return (
    <div className="mb-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-blue-600" />
          {notification?.isGenerating ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
              <span className="text-sm text-blue-700">
                Generating configuration for {step.pluginName}...
              </span>
            </div>
          ) : (
            <span className="text-sm text-blue-700">
              Generated {notification?.generated?.inputs || 0} inputs and{' '}
              {notification?.generated?.outputs || 0} outputs for {step.pluginName}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {!notification?.isGenerating && (
            <>
              {onReview && (
                <button 
                  onClick={() => onReview(pluginKey)}
                  className="text-xs px-3 py-1 text-blue-700 hover:bg-blue-100 rounded transition-colors"
                >
                  Review
                </button>
              )}
              {onAccept && (
                <button 
                  onClick={() => onAccept(pluginKey)}
                  className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                >
                  Accept
                </button>
              )}
            </>
          )}
          <button 
            onClick={() => onDismiss(pluginKey)}
            className="text-blue-400 hover:text-blue-600 transition-colors"
            aria-label="Dismiss notification"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// Hook to manage plugin replacement state (add this to the same file)
export const usePluginReplacement = () => {
  const [replacementState, setReplacementState] = useState<{
    [stepId: number]: {
      oldStep: PluginStep;
      newPluginKey: string;
      newPluginName: string;
      status: 'processing' | 'completed' | 'error';
      error?: string;
    }
  }>({});

  const startReplacement = (
    stepId: number, 
    oldStep: PluginStep, 
    newPluginKey: string, 
    newPluginName: string
  ) => {
    setReplacementState(prev => ({
      ...prev,
      [stepId]: {
        oldStep,
        newPluginKey,
        newPluginName,
        status: 'processing'
      }
    }));

    // Simulate AI processing time (2-4 seconds)
    setTimeout(() => {
      setReplacementState(prev => ({
        ...prev,
        [stepId]: {
          ...prev[stepId],
          status: 'completed'
        }
      }));
    }, 2000 + Math.random() * 2000);
  };

  const markError = (stepId: number, error: string) => {
    setReplacementState(prev => ({
      ...prev,
      [stepId]: {
        ...prev[stepId],
        status: 'error',
        error
      }
    }));
  };

  const dismissReplacement = (stepId: number) => {
    setReplacementState(prev => {
      const newState = { ...prev };
      delete newState[stepId];
      return newState;
    });
  };

  return {
    replacementState,
    startReplacement,
    markError,
    dismissReplacement
  };
};