import React, { useState, useEffect } from 'react';
import { Brain, Loader2, X, CheckCircle2, AlertTriangle, Sparkles, RefreshCw, Plus, Settings } from 'lucide-react';
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

// Updated interface to handle multiple banner types
interface PluginNotificationBannerProps {
  type: 'ai-generated' | 'plugin-schema' | 'replacement';
  
  // For schema generation banners
  plugin?: { pluginKey: string; name: string };
  isGenerating?: boolean;
  generatedCount?: { inputs?: number; outputs?: number };
  
  // For replacement banners
  oldPlugin?: PluginStep;
  newPlugin?: { pluginKey: string; name: string };
  
  // Common props
  onReview?: () => void;
  onAccept?: () => void;
  onDismiss: () => void;
  
  // Legacy props for backward compatibility
  pluginKey?: string;
  step?: PluginStep;
  notification?: PluginNotification;
  replacementNotification?: PluginReplacementNotification;
}

export function PluginNotificationBanner({
  type,
  plugin,
  isGenerating = false,
  generatedCount,
  oldPlugin,
  newPlugin,
  onReview,
  onAccept,
  onDismiss,
  // Legacy props
  pluginKey,
  step,
  notification,
  replacementNotification
}: PluginNotificationBannerProps) {
  const [progress, setProgress] = useState(0);

  // Handle replacement processing animation
  useEffect(() => {
    if (type === 'replacement' || replacementNotification?.status === 'processing') {
      const interval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 95) return prev;
          return prev + Math.random() * 10;
        });
      }, 200);
      
      // Auto-complete after 2-4 seconds
      const timeout = setTimeout(() => {
        setProgress(100);
      }, 2000 + Math.random() * 2000);
      
      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    }
  }, [type, replacementNotification?.status]);

  // Handle legacy notification format
  if (notification?.showNotification || replacementNotification) {
    return renderLegacyBanner();
  }

  // Handle new format based on type
  switch (type) {
    case 'ai-generated':
      return renderAIGeneratedBanner();
    case 'plugin-schema':
      return renderPluginSchemaBanner();
    case 'replacement':
      return renderReplacementBanner();
    default:
      return null;
  }

  function renderAIGeneratedBanner() {
    return (
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
            {isGenerating ? (
              <Loader2 className="h-5 w-5 text-white animate-spin" />
            ) : (
              <Brain className="h-5 w-5 text-white" />
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between mb-2">
              <h4 className="font-semibold text-blue-900 flex items-center gap-2">
                {isGenerating ? 'AI Generating Configuration' : 'AI Configuration Ready'}
                {isGenerating && <Sparkles className="h-4 w-4 text-blue-500 animate-pulse" />}
              </h4>
              
              {!isGenerating && (
                <button
                  onClick={onDismiss}
                  className="text-blue-400 hover:text-blue-600 transition-colors p-1 rounded-lg hover:bg-white/50"
                  title="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            
            <p className="text-blue-700 text-sm mb-3">
              {isGenerating 
                ? `AI is analyzing ${plugin?.name || 'plugin'} and generating optimal input/output configuration...`
                : `AI generated ${generatedCount?.inputs || 0} inputs and ${generatedCount?.outputs || 0} outputs for ${plugin?.name || 'plugin'}`
              }
            </p>
            
            {isGenerating && (
              <div className="space-y-2">
                <div className="bg-white/50 rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-blue-500 to-indigo-500 h-2 rounded-full transition-all duration-300 ease-out" 
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-xs text-blue-600">
                  Analyzing plugin capabilities and generating configuration...
                </p>
              </div>
            )}
            
            {!isGenerating && (onReview || onAccept) && (
              <div className="flex items-center gap-2 mt-3">
                {onReview && (
                  <button 
                    onClick={onReview}
                    className="px-3 py-1.5 text-sm text-blue-700 hover:bg-blue-100 rounded-lg transition-colors border border-blue-300"
                  >
                    Review Configuration
                  </button>
                )}
                {onAccept && (
                  <button 
                    onClick={onAccept}
                    className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Accept Configuration
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderPluginSchemaBanner() {
    return (
      <div className="bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-200 rounded-xl p-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-purple-500 rounded-lg flex items-center justify-center flex-shrink-0">
            <Settings className="h-5 w-5 text-white" />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between mb-2">
              <h4 className="font-semibold text-purple-900">
                Plugin Schema Available
              </h4>
              
              <button
                onClick={onDismiss}
                className="text-purple-400 hover:text-purple-600 transition-colors p-1 rounded-lg hover:bg-white/50"
                title="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            
            <p className="text-purple-700 text-sm mb-3">
              {plugin?.name || 'Plugin'} has predefined input/output schemas that can be automatically configured.
            </p>
            
            <div className="flex items-center gap-2">
              {onReview && (
                <button 
                  onClick={onReview}
                  className="px-3 py-1.5 text-sm text-purple-700 hover:bg-purple-100 rounded-lg transition-colors border border-purple-300"
                >
                  Review Schema
                </button>
              )}
              {onAccept && (
                <button 
                  onClick={onAccept}
                  className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                >
                  Apply Schema
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderReplacementBanner() {
    const isProcessing = progress < 100;
    
    return (
      <div className={`${isProcessing ? 'bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200' : 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200'} border-2 rounded-xl p-4 mb-4`}>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 ${isProcessing ? 'bg-blue-500' : 'bg-green-500'} rounded-lg flex items-center justify-center flex-shrink-0 text-white relative`}>
            {isProcessing ? (
              <Brain className="h-5 w-5" />
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
            {isProcessing && (
              <Loader2 className="h-3 w-3 animate-spin absolute -top-1 -right-1 bg-white text-blue-600 rounded-full" />
            )}
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between mb-2">
              <h4 className={`font-semibold ${isProcessing ? 'text-blue-900' : 'text-green-900'} flex items-center gap-2`}>
                {isProcessing ? 'AI Processing Plugin Replacement' : 'Plugin Replacement Complete'}
                {isProcessing && <Sparkles className="h-4 w-4 text-blue-500 animate-pulse" />}
              </h4>
              
              {!isProcessing && (
                <button
                  onClick={onDismiss}
                  className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-white/50"
                  title="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            
            <p className={`${isProcessing ? 'text-blue-700' : 'text-green-700'} text-sm mb-3`}>
              {isProcessing 
                ? "AI is analyzing the new plugin's inputs and outputs..."
                : `Successfully replaced "${oldPlugin?.pluginName || 'plugin'}" with "${newPlugin?.name || 'new plugin'}". The AI has updated inputs and outputs accordingly.`
              }
            </p>
            
            <div className="flex items-center gap-4 text-xs mb-3">
              <div className="flex items-center gap-2">
                <span className={`${isProcessing ? 'text-blue-700' : 'text-green-700'} font-medium`}>From:</span>
                <span className="bg-white/60 px-2 py-1 rounded-lg font-medium">
                  {oldPlugin?.pluginName || 'Previous Plugin'}
                </span>
              </div>
              <div className="text-gray-400">→</div>
              <div className="flex items-center gap-2">
                <span className={`${isProcessing ? 'text-blue-700' : 'text-green-700'} font-medium`}>To:</span>
                <span className="bg-white/60 px-2 py-1 rounded-lg font-medium">
                  {newPlugin?.name || 'New Plugin'}
                </span>
              </div>
            </div>
            
            {isProcessing && (
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

  function renderLegacyBanner() {
    // Handle replacement notifications (legacy)
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

      return (
        <div className={`${config.bgColor} border-2 ${config.borderColor} rounded-xl p-4 mb-4`}>
          <div className="flex items-start gap-3">
            <div className={`w-10 h-10 ${config.iconBg} rounded-lg flex items-center justify-center flex-shrink-0 text-white relative`}>
              {config.icon}
              {replacementNotification.status === 'processing' && (
                <Loader2 className="h-3 w-3 animate-spin absolute -top-1 -right-1 bg-white text-blue-600 rounded-full" />
              )}
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between mb-2">
                <h4 className={`font-semibold ${config.textColor}`}>
                  {replacementNotification.status === 'processing' && 'AI Processing Plugin Replacement'}
                  {replacementNotification.status === 'completed' && 'Plugin Replacement Complete'}
                  {replacementNotification.status === 'error' && 'Plugin Replacement Failed'}
                </h4>
                
                {replacementNotification.status !== 'processing' && (
                  <button
                    onClick={() => onDismiss()}
                    className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-white/50"
                    title="Dismiss"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              
              <p className={`${config.subtextColor} text-sm`}>
                {replacementNotification.status === 'processing' && "AI is analyzing the new plugin's inputs and outputs..."}
                {replacementNotification.status === 'completed' && `Successfully replaced "${replacementNotification.oldStep.pluginName}" with "${replacementNotification.newPluginName}".`}
                {replacementNotification.status === 'error' && (replacementNotification.error || 'Failed to process the plugin replacement.')}
              </p>
            </div>
          </div>
        </div>
      );
    }

    // Handle regular plugin notifications (legacy)
    if (notification?.showNotification && step) {
      return (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-blue-600" />
              {notification.isGenerating ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
                  <span className="text-sm text-blue-700">
                    Generating configuration for {step.pluginName}...
                  </span>
                </div>
              ) : (
                <span className="text-sm text-blue-700">
                  Generated {notification.generated?.inputs || 0} inputs and{' '}
                  {notification.generated?.outputs || 0} outputs for {step.pluginName}
                </span>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              {!notification.isGenerating && (
                <>
                  {onReview && (
                    <button 
                      onClick={onReview}
                      className="text-xs px-3 py-1 text-blue-700 hover:bg-blue-100 rounded transition-colors"
                    >
                      Review
                    </button>
                  )}
                  {onAccept && (
                    <button 
                      onClick={onAccept}
                      className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                    >
                      Accept
                    </button>
                  )}
                </>
              )}
              <button 
                onClick={() => onDismiss()}
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

    return null;
  }
}

// Hook to manage plugin replacement state (keeping existing)
export const usePluginReplacement = () => {
  const [replacementState, setReplacementState] = useState<{
    [stepId: string]: {
      oldStep: PluginStep;
      newPluginKey: string;
      newPluginName: string;
      status: 'processing' | 'completed' | 'error';
      error?: string;
    }
  }>({});

  const startReplacement = (
    stepId: number | string, 
    oldStep: PluginStep, 
    newPluginKey: string, 
    newPluginName: string
  ) => {
    const id = String(stepId);
    setReplacementState(prev => ({
      ...prev,
      [id]: {
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
        [id]: {
          ...prev[id],
          status: 'completed'
        }
      }));
    }, 2000 + Math.random() * 2000);
  };

  const markError = (stepId: number | string, error: string) => {
    const id = String(stepId);
    setReplacementState(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        status: 'error',
        error
      }
    }));
  };

  const dismissReplacement = (stepId: number | string) => {
    const id = String(stepId);
    setReplacementState(prev => {
      const newState = { ...prev };
      delete newState[id];
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