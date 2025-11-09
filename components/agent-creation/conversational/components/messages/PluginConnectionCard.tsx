import React from 'react';
import { Info, Loader2 } from 'lucide-react';
import { PluginConnectionCardProps } from '../../types';
import { getPluginDisplayName, getPluginDescription } from '../../utils/messageFormatter';

export default function PluginConnectionCard({
  missingPlugins,
  onConnect,
  onSkip,
  connectingPlugin
}: PluginConnectionCardProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-700 mb-4">
        I see you want to work with these services! To make this work, I'll need you to connect:
      </p>

      {missingPlugins.map((plugin) => (
        <div
          key={plugin}
          className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-500 rounded-lg flex items-center justify-center text-white font-semibold text-sm">
                {plugin.charAt(0).toUpperCase()}
              </div>
              <div>
                <h4 className="font-semibold text-gray-800 text-sm">
                  {getPluginDisplayName(plugin)}
                </h4>
                <p className="text-xs text-gray-600">{getPluginDescription(plugin)}</p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => onSkip?.(plugin)}
                disabled={connectingPlugin === plugin}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-all"
              >
                Skip
              </button>
              <button
                onClick={() => onConnect(plugin)}
                disabled={connectingPlugin === plugin}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-all flex items-center gap-2"
              >
                {connectingPlugin === plugin ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    Connect {getPluginDisplayName(plugin)} →
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      ))}

      <div className="flex items-start gap-2 mt-4 p-3 bg-gray-50 rounded-lg">
        <Info className="h-4 w-4 text-gray-500 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-gray-600">
          These connections are secure and can be removed anytime from your settings.
        </p>
      </div>
    </div>
  );
}
