// components/agents/CurrentStatusCard.tsx
'use client';

import React from 'react';
import { Pause, Play, Clock, CalendarClock } from 'lucide-react';

interface CurrentStatusCardProps {
  status: 'active' | 'paused' | 'draft';
  lastRunTime?: string;
  nextRunTime?: string;
  onPause?: () => void;
  onResume?: () => void;
  onTest?: () => void;
}

const statusConfig = {
  active: {
    label: 'Running Smoothly',
    icon: '🟢',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    textColor: 'text-green-900',
    badgeColor: 'bg-green-100 text-green-700'
  },
  paused: {
    label: 'Paused',
    icon: '⏸️',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    textColor: 'text-yellow-900',
    badgeColor: 'bg-yellow-100 text-yellow-700'
  },
  draft: {
    label: 'Not Active Yet',
    icon: '📝',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    textColor: 'text-gray-900',
    badgeColor: 'bg-gray-100 text-gray-700'
  }
};

export default function CurrentStatusCard({
  status,
  lastRunTime,
  nextRunTime,
  onPause,
  onResume,
  onTest
}: CurrentStatusCardProps) {
  const config = statusConfig[status];

  return (
    <div className={`${config.bgColor} border ${config.borderColor} rounded-xl p-6 transition-all hover:shadow-lg`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{config.icon}</span>
          <div>
            <h2 className={`text-2xl font-bold ${config.textColor}`}>
              {config.label}
            </h2>
            <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${config.badgeColor} mt-1`}>
              {status === 'active' ? 'Active' : status === 'paused' ? 'Paused' : 'Draft'}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2 mb-4">
        {lastRunTime && (
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <Clock className="w-4 h-4 text-gray-500" />
            <span className="font-medium">Last active:</span>
            <span>{lastRunTime}</span>
          </div>
        )}

        {nextRunTime && status === 'active' && (
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <CalendarClock className="w-4 h-4 text-gray-500" />
            <span className="font-medium">Next run:</span>
            <span>{nextRunTime}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
        {status === 'active' && onPause && (
          <button
            onClick={onPause}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors text-sm font-medium"
          >
            <Pause className="w-4 h-4" />
            Pause
          </button>
        )}

        {status === 'paused' && onResume && (
          <button
            onClick={onResume}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors text-sm font-medium"
          >
            <Play className="w-4 h-4" />
            Resume
          </button>
        )}

        {onTest && (
          <button
            onClick={onTest}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <Play className="w-4 h-4" />
            Try It Now
          </button>
        )}
      </div>
    </div>
  );
}
