// components/agents/SimplifiedTabs.tsx
'use client';

import React, { useState } from 'react';
import { Play, Calendar, Activity, Settings } from 'lucide-react';

interface Tab {
  id: string;
  label: string;
  icon: React.ReactNode;
  count?: number;
}

interface SimplifiedTabsProps {
  defaultTab?: string;
  children: {
    tryIt?: React.ReactNode;
    schedule?: React.ReactNode;
    activity?: React.ReactNode;
    settings?: React.ReactNode;
  };
}

export default function SimplifiedTabs({ defaultTab = 'tryIt', children }: SimplifiedTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab);

  const tabs: Tab[] = [
    { id: 'tryIt', label: 'Try It', icon: <Play className="w-4 h-4" /> },
    { id: 'schedule', label: 'Schedule', icon: <Calendar className="w-4 h-4" /> },
    { id: 'activity', label: 'Activity', icon: <Activity className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> }
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Tab Navigation */}
      <div className="border-b border-gray-200 bg-gray-50">
        <div className="flex overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center gap-2 px-6 py-3 text-sm font-medium transition-colors whitespace-nowrap
                ${activeTab === tab.id
                  ? 'text-blue-600 border-b-2 border-blue-600 bg-white'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }
              `}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span className={`
                  px-2 py-0.5 rounded-full text-xs font-semibold
                  ${activeTab === tab.id
                    ? 'bg-blue-100 text-blue-600'
                    : 'bg-gray-200 text-gray-600'
                  }
                `}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-6">
        {activeTab === 'tryIt' && (
          <div>{children.tryIt || <EmptyState message="Try It section coming soon" />}</div>
        )}
        {activeTab === 'schedule' && (
          <div>{children.schedule || <EmptyState message="Schedule section coming soon" />}</div>
        )}
        {activeTab === 'activity' && (
          <div>{children.activity || <EmptyState message="Activity section coming soon" />}</div>
        )}
        {activeTab === 'settings' && (
          <div>{children.settings || <EmptyState message="Settings section coming soon" />}</div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12">
      <p className="text-sm text-gray-500">{message}</p>
    </div>
  );
}
