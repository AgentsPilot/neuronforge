// components/agents/TimelineEntry.tsx
'use client';

import React from 'react';
import { CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';

interface TimelineEntryProps {
  timestamp: string;
  status: 'success' | 'failed' | 'running' | 'warning';
  message: string;
  details?: string;
  itemsProcessed?: number;
  duration?: string;
}

const statusConfig = {
  success: {
    icon: CheckCircle2,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    emoji: '🟢'
  },
  failed: {
    icon: XCircle,
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    emoji: '🔴'
  },
  running: {
    icon: Clock,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    emoji: '🔵'
  },
  warning: {
    icon: AlertCircle,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    emoji: '🟡'
  }
};

export default function TimelineEntry({
  timestamp,
  status,
  message,
  details,
  itemsProcessed,
  duration
}: TimelineEntryProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className="flex gap-3 pb-4 last:pb-0">
      {/* Status indicator */}
      <div className="flex flex-col items-center pt-1">
        <div className={`p-1.5 rounded-full ${config.bgColor} border ${config.borderColor}`}>
          <Icon className={`w-3.5 h-3.5 ${config.color}`} />
        </div>
        <div className="w-px h-full bg-gray-200 mt-2 last:hidden" />
      </div>

      {/* Content */}
      <div className="flex-1 pb-4 border-b border-gray-100 last:border-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-medium">{timestamp}</span>
            {duration && (
              <span className="text-xs text-gray-400">• {duration}</span>
            )}
          </div>
        </div>

        <div className="flex items-start gap-2 mb-1">
          <p className="text-sm text-gray-900 font-medium">{message}</p>
          {status === 'success' && <span className="text-green-600">✓</span>}
          {status === 'failed' && <span className="text-red-600">✗</span>}
        </div>

        {details && (
          <p className="text-xs text-gray-600 mt-1">{details}</p>
        )}

        {itemsProcessed !== undefined && itemsProcessed > 0 && (
          <div className="inline-flex items-center gap-1 mt-2 px-2 py-1 rounded-md bg-gray-50 text-xs text-gray-600">
            <span className="font-medium">{itemsProcessed}</span>
            <span>items processed</span>
          </div>
        )}
      </div>
    </div>
  );
}
