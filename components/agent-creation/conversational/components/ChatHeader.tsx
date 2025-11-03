import React from 'react';
import { Bot, X, HelpCircle } from 'lucide-react';
import { ChatHeaderProps } from '../types';

export default function ChatHeader({ onCancel }: ChatHeaderProps) {
  return (
    <div className="sticky top-0 z-40 backdrop-blur-xl bg-white/80 border-b border-white/20 shadow-sm">
      <div className="max-w-4xl mx-auto px-4 py-3">
        <div className="flex items-center justify-between">
          {/* Left: Logo and Title */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-md">
                <Bot className="h-5 w-5 text-white" />
              </div>
              <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-400 rounded-full border-2 border-white"></div>
            </div>
            <div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                AI Agent Builder
              </h1>
              <p className="text-xs text-gray-500">Conversational Agent Creation</p>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            {/* Help Button */}
            <button
              onClick={() => {
                // TODO: Show help modal or guide
                console.log('Help clicked');
              }}
              className="text-gray-500 hover:text-blue-600 transition-colors p-2 rounded-lg hover:bg-blue-50"
              title="Show guide"
              aria-label="Show help guide"
            >
              <HelpCircle className="h-5 w-5" />
            </button>

            {/* Cancel Button */}
            {onCancel && (
              <button
                onClick={onCancel}
                className="text-gray-500 hover:text-gray-700 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/50 text-sm"
                aria-label="Cancel agent creation"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
