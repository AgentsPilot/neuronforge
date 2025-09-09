import React from 'react';
import { Brain, Loader2, X } from 'lucide-react';
import type { PluginStep } from '../types';

interface PluginNotification {
  isGenerating: boolean;
  generated: { inputs: number; outputs: number } | null;
  showNotification: boolean;
}

interface PluginNotificationBannerProps {
  pluginKey: string;
  step: PluginStep;
  notification: PluginNotification;
  onReview: (pluginKey: string) => void;
  onAccept: (pluginKey: string) => void;
  onDismiss: (pluginKey: string) => void;
}

export function PluginNotificationBanner({
  pluginKey,
  step,
  notification,
  onReview,
  onAccept,
  onDismiss
}: PluginNotificationBannerProps) {
  if (!notification?.showNotification) {
    return null;
  }

  return (
    <div className="mb-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
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
              <button 
                onClick={() => onReview(pluginKey)}
                className="text-xs px-3 py-1 text-blue-700 hover:bg-blue-100 rounded transition-colors"
              >
                Review
              </button>
              <button 
                onClick={() => onAccept(pluginKey)}
                className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Accept
              </button>
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