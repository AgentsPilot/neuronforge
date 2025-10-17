// components/analytics/AnalyticHeader.tsx

import React, { useState } from 'react';
import { 
  Bot, 
  RefreshCw, 
  Download, 
  BarChart3, 
  Activity, 
  Brain,
  ChevronDown 
} from 'lucide-react';
import { getTimeFilterLabel } from '@/lib/utils/analyticsHelpers';
import type { TimeFilter, AnalyticsView, TimeFilterOption } from '@/types/analytics';

interface AnalyticsHeaderProps {
  timeFilter: TimeFilter;
  selectedView: AnalyticsView;
  onTimeFilterChange: (filter: TimeFilter) => void;
  onViewChange: (view: AnalyticsView) => void;
  onRefresh: () => void;
  onExport: () => void;
  hasData: boolean;
}

const timeFilterOptions: TimeFilterOption[] = [
  { value: 'last_24h', label: 'Last 24 hours' },
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'last_90d', label: 'Last 90 days' }
];

const CustomDropdown = ({ 
  value, 
  onChange, 
  options 
}: { 
  value: string; 
  onChange: (value: string) => void; 
  options: { value: string; label: string }[]; 
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find(opt => opt.value === value);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-48 px-4 py-2.5 bg-white/90 backdrop-blur-sm border border-gray-200/60 rounded-xl text-sm font-medium text-gray-700 shadow-sm hover:border-gray-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-200"
      >
        <span>{selectedOption?.label}</span>
        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      {isOpen && (
        <>
          <div className="absolute top-full left-0 mt-2 w-full bg-white border border-gray-200/60 rounded-xl shadow-xl overflow-hidden z-50">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`w-full px-4 py-2.5 text-left text-sm font-medium transition-colors duration-150 hover:bg-gray-50 ${
                  value === option.value ? 'text-blue-600 bg-blue-50' : 'text-gray-700'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div 
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
        </>
      )}
    </div>
  );
};

export const AnalyticsHeader: React.FC<AnalyticsHeaderProps> = ({
  timeFilter,
  selectedView,
  onTimeFilterChange,
  onViewChange,
  onRefresh,
  onExport,
  hasData
}) => {
  return (
    <>
      {/* Header */}
      <div className="text-center">
        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto shadow-xl mb-4">
          <Bot className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
          AI Workflow Analytics
        </h1>
        <p className="text-gray-600 mt-2">
          Your automation insights for the {getTimeFilterLabel(timeFilter)}
        </p>
      </div>

      {/* Controls */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-lg p-6">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Time Filter Buttons */}
            <div className="flex bg-white/90 backdrop-blur-sm border border-gray-200/60 rounded-xl p-1 shadow-sm">
              {[
                { value: 'last_24h', label: '24h' },
                { value: 'last_7d', label: '7d' },
                { value: 'last_30d', label: '30d' },
                { value: 'last_90d', label: '90d' }
              ].map((option) => (
                <button
                  key={option.value}
                  onClick={() => onTimeFilterChange(option.value as TimeFilter)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    timeFilter === option.value
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-sm'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/50'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {/* View Navigation */}
            {hasData && (
              <div className="flex bg-gray-100/80 rounded-xl p-1">
                {[
                  { key: 'overview', label: 'Overview', icon: BarChart3 },
                  { key: 'insights', label: 'Insights', icon: Brain },
                  { key: 'activities', label: 'Activities', icon: Activity },
                  { key: 'agents', label: 'Agents', icon: Bot }
                ].map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => onViewChange(key as AnalyticsView)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                      selectedView === key
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={onRefresh}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all duration-300 text-sm font-medium shadow-lg"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            
            {hasData && (
              <button
                onClick={onExport}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-all duration-300 text-sm font-medium bg-white/80"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};