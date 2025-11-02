// components/agents/RecentActivityTimeline.tsx
'use client';

import React from 'react';
import TimelineEntry from './TimelineEntry';
import { formatDistanceToNow } from 'date-fns';

interface ActivityEntry {
  id: string;
  timestamp: Date;
  status: 'success' | 'failed' | 'running' | 'warning';
  message: string;
  details?: string;
  itemsProcessed?: number;
  duration?: number; // in milliseconds
}

interface RecentActivityTimelineProps {
  activities: ActivityEntry[];
  maxEntries?: number;
}

export default function RecentActivityTimeline({
  activities,
  maxEntries = 5
}: RecentActivityTimelineProps) {
  const displayActivities = activities.slice(0, maxEntries);

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatTimestamp = (date: Date): string => {
    try {
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return 'Unknown time';
    }
  };

  if (displayActivities.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">What's Been Happening</h3>
        <div className="text-center py-8">
          <div className="text-gray-400 mb-2">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm text-gray-600 font-medium">No activity yet</p>
          <p className="text-xs text-gray-500 mt-1">Activity will appear here once the agent runs</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">What's Been Happening</h3>
        {activities.length > maxEntries && (
          <button className="text-xs text-blue-600 hover:text-blue-700 font-medium">
            View all {activities.length} activities →
          </button>
        )}
      </div>

      <div className="space-y-0">
        {displayActivities.map((activity) => (
          <TimelineEntry
            key={activity.id}
            timestamp={formatTimestamp(activity.timestamp)}
            status={activity.status}
            message={activity.message}
            details={activity.details}
            itemsProcessed={activity.itemsProcessed}
            duration={activity.duration ? formatDuration(activity.duration) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
