import React from 'react';
import { 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  Loader2, 
  Pause, 
  Calendar,
  PlayCircle,
  StopCircle
} from 'lucide-react';
import { AgentExecution } from '@/lib/database/executionHelpers';
import { formatLastRun, formatDuration } from '@/lib/utils/scheduleFormatter';

interface ExecutionStatusBadgeProps {
  status: AgentExecution['status'];
  isRunning?: boolean;
  progress?: number;
  lastExecution?: AgentExecution | null;
  nextRunFormatted?: string;
  compact?: boolean;
}

export function ExecutionStatusBadge({ 
  status, 
  isRunning, 
  progress, 
  lastExecution,
  nextRunFormatted,
  compact = false 
}: ExecutionStatusBadgeProps) {
  const getStatusConfig = (status: AgentExecution['status'], isRunning: boolean) => {
    if (isRunning) {
      return {
        icon: Loader2,
        color: 'text-blue-600',
        bg: 'bg-blue-50',
        border: 'border-blue-200',
        label: 'Running',
        animate: true
      };
    }

    switch (status) {
      case 'completed':
        return {
          icon: CheckCircle,
          color: 'text-emerald-600',
          bg: 'bg-emerald-50',
          border: 'border-emerald-200',
          label: 'Success'
        };
      case 'failed':
        return {
          icon: AlertCircle,
          color: 'text-red-600',
          bg: 'bg-red-50',
          border: 'border-red-200',
          label: 'Failed'
        };
      case 'pending':
      case 'queued':
        return {
          icon: Clock,
          color: 'text-amber-600',
          bg: 'bg-amber-50',
          border: 'border-amber-200',
          label: 'Queued'
        };
      default:
        return {
          icon: Calendar,
          color: 'text-gray-600',
          bg: 'bg-gray-50',
          border: 'border-gray-200',
          label: 'Ready'
        };
    }
  };

  const config = getStatusConfig(status, isRunning || false);
  const Icon = config.icon;

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${config.bg} ${config.color} ${config.border} border`}>
        <Icon className={`w-3 h-3 ${config.animate ? 'animate-spin' : ''}`} />
        <span>{config.label}</span>
        {isRunning && progress !== undefined && (
          <span className="text-xs opacity-75">({progress}%)</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Main Status */}
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${config.bg} ${config.color} ${config.border} border`}>
        <Icon className={`w-4 h-4 ${config.animate ? 'animate-spin' : ''}`} />
        <span>{config.label}</span>
        {isRunning && progress !== undefined && (
          <span className="text-xs opacity-75">({progress}%)</span>
        )}
      </div>

      {/* Progress Bar for Running */}
      {isRunning && progress !== undefined && (
        <div className="w-full bg-gray-200 rounded-full h-1.5">
          <div 
            className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Additional Info */}
      <div className="text-xs text-gray-500 space-y-1">
        {lastExecution && (
          <div className="flex items-center justify-between">
            <span>Last run:</span>
            <span>{formatLastRun(lastExecution.completed_at || lastExecution.created_at)}</span>
          </div>
        )}
        
        {lastExecution?.execution_duration_ms && (
          <div className="flex items-center justify-between">
            <span>Duration:</span>
            <span>{formatDuration(lastExecution.execution_duration_ms)}</span>
          </div>
        )}

        {nextRunFormatted && nextRunFormatted !== 'On demand' && (
          <div className="flex items-center justify-between">
            <span>Next run:</span>
            <span>{nextRunFormatted}</span>
          </div>
        )}
      </div>
    </div>
  );
}