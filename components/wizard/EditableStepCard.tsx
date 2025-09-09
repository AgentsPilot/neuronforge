import React, { useState, useEffect } from 'react';
import {
  Save,
  X,
  Edit3,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  CheckCircle2,
  XCircle,
  User,
  Clock,
  CalendarDays,
  ExternalLink
} from 'lucide-react';
import type { PluginStep, PluginConnection } from './types';

interface EditableStepCardProps {
  step: PluginStep;
  color: 'blue' | 'purple' | 'emerald';
  onRemove: () => void;
  onUpdate: (updates: Partial<PluginStep>) => void;
  onOpenReplaceModal: () => void;
  isConnected: (pluginKey: string) => boolean;
  getPluginConnection: (pluginKey: string) => PluginConnection | null;
  isMissing: boolean;
}

export const EditableStepCard: React.FC<EditableStepCardProps> = ({
  step,
  color,
  onRemove,
  onUpdate,
  onOpenReplaceModal,
  isConnected,
  getPluginConnection,
  isMissing
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localStep, setLocalStep] = useState(step);

  // Sync with prop changes
  useEffect(() => {
    setLocalStep(step);
  }, [step]);

  const colorClasses = {
    blue: { 
      bg: 'bg-blue-50', 
      border: 'border-blue-200', 
      button: 'bg-blue-600', 
      text: 'text-blue-700', 
      badge: 'bg-blue-100' 
    },
    purple: { 
      bg: 'bg-purple-50', 
      border: 'border-purple-200', 
      button: 'bg-purple-600', 
      text: 'text-purple-700', 
      badge: 'bg-purple-100' 
    },
    emerald: { 
      bg: 'bg-emerald-50', 
      border: 'border-emerald-200', 
      button: 'bg-emerald-600', 
      text: 'text-emerald-700', 
      badge: 'bg-emerald-100' 
    }
  };

  const colors = colorClasses[color];

  // FIXED: Enhanced connection status logic with proper missing vs disconnected handling
  const getConnectionStatus = () => {
    // Internal system outputs are always "connected"
    if (['dashboard-alert', 'pdf-report', 'summary-block', 'agent-log'].includes(step.pluginKey)) {
      return { 
        status: 'connected', 
        icon: <CheckCircle2 className="h-4 w-4 text-green-600" />, 
        color: 'text-green-600',
        details: null,
        isTrulyMissing: false
      };
    }
    
    // Check if plugin is connected first
    const pluginConnected = isConnected(step.pluginKey);
    const connection = getPluginConnection(step.pluginKey);
    
    if (pluginConnected && connection) {
      // Transform the connection data
      const transformedDetails = {
        username: connection.username || connection.email,
        email: connection.email,
        connectedAt: connection.connected_at || connection.created_at,
        lastUsed: connection.last_used,
        status: connection.status,
        profileData: connection.profileData,
        ...connection
      };
      
      return { 
        status: 'connected', 
        icon: <CheckCircle2 className="h-4 w-4 text-green-600" />, 
        color: 'text-green-600',
        details: transformedDetails,
        isTrulyMissing: false
      };
    }
    
    // FIXED: Only treat as "missing" if the plugin is actually unavailable in the system
    // If isMissing prop is true AND the plugin is not connected, then it's truly missing
    // Otherwise, it's just disconnected
    const isTrulyMissing = isMissing && !pluginConnected;
    
    if (isTrulyMissing) {
      return { 
        status: 'missing', 
        icon: <XCircle className="h-4 w-4 text-red-600" />, 
        color: 'text-red-600',
        details: null,
        isTrulyMissing: true
      };
    }
    
    // Plugin exists in system but is not connected
    return { 
      status: 'disconnected', 
      icon: <AlertTriangle className="h-4 w-4 text-yellow-600" />, 
      color: 'text-yellow-600',
      details: null,
      isTrulyMissing: false
    };
  };

  const connectionStatus = getConnectionStatus();

  const handleSave = () => {
    if (localStep.action?.trim() && localStep.description?.trim()) {
      onUpdate(localStep);
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setLocalStep(step);
    setIsEditing(false);
  };

  // Helper function to format date
  const formatDate = (dateString: string) => {
    if (!dateString) return 'Unknown';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Unknown';
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return 'Unknown';
    }
  };

  // Helper function to format relative time
  const formatRelativeTime = (dateString: string) => {
    if (!dateString) return 'Never';
    
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Never';
      const now = new Date();
      const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
      
      if (diffInHours < 1) return 'Just now';
      if (diffInHours < 24) return `${diffInHours}h ago`;
      if (diffInHours < 168) return `${Math.floor(diffInHours / 24)}d ago`;
      return formatDate(dateString);
    } catch {
      return 'Unknown';
    }
  };

  return (
    <div className={`bg-white border rounded-2xl p-6 relative shadow-sm hover:shadow-md transition-shadow ${
      connectionStatus.isTrulyMissing ? 'ring-2 ring-red-400' : 'border-gray-200'
    }`}>
      {isEditing ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Action Description</label>
            <input
              value={localStep.action || ''}
              onChange={(e) => setLocalStep(prev => ({...prev, action: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Step action"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Detailed Description</label>
            <textarea
              value={localStep.description || ''}
              onChange={(e) => setLocalStep(prev => ({...prev, description: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-xl text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
              placeholder="Step description"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm hover:bg-emerald-700 transition-colors"
            >
              <Save className="w-4 h-4" />
              Save
            </button>
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-xl text-sm hover:bg-gray-700 transition-colors"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* FIXED: Only show "Plugin Not Available" warning for truly missing plugins */}
          {connectionStatus.isTrulyMissing && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
              <div className="flex items-center gap-2 text-red-700 text-sm font-medium">
                <AlertTriangle className="h-4 w-4" />
                Plugin Not Available
              </div>
              <p className="text-red-600 text-xs mt-1">
                This plugin is not currently available in your system. Consider replacing it with an alternative.
              </p>
            </div>
          )}

          <div className="flex items-start gap-4">
            <div className={`w-10 h-10 ${colors.button} rounded-2xl flex items-center justify-center text-white font-bold`}>
              {step.order}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <div className="text-xl">{step.icon}</div>
                <h5 className="font-bold text-gray-900">{step.pluginName}</h5>
                
                {/* Enhanced connection status indicator */}
                <div className="flex items-center gap-1">
                  {connectionStatus.icon}
                  <span className={`text-xs font-medium ${connectionStatus.color}`}>
                    {connectionStatus.status === 'connected' ? 'Connected' : 
                     connectionStatus.status === 'missing' ? 'Missing' : 'Not Connected'}
                  </span>
                </div>

                <div className="ml-auto flex gap-2">
                  <button
                    onClick={onOpenReplaceModal}
                    className="p-2 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Replace plugin"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                    title="Edit step"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={onRemove}
                    className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove step"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <div className={`${colors.text} ${colors.badge} px-4 py-2 rounded-xl mb-3 inline-block font-medium`}>
                {step.action}
              </div>
              <p className="text-gray-700 leading-relaxed mb-3">{step.description}</p>
              
              {/* Enhanced connection details */}
              {connectionStatus.status === 'connected' && connectionStatus.details && (
                <div className="bg-white rounded-lg p-3 border border-gray-200 space-y-2 mb-3">
                  <div className="flex items-center gap-2 text-xs text-gray-600">
                    <User className="h-3 w-3" />
                    <span className="font-medium">
                      {connectionStatus.details.email || connectionStatus.details.username || 'Connected Account'}
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" />
                      <span>Connected: {
                        connectionStatus.details.connectedAt 
                          ? formatDate(connectionStatus.details.connectedAt)
                          : 'Recently'
                      }</span>
                    </div>
                    
                    {connectionStatus.details.lastUsed && (
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>Used: {formatRelativeTime(connectionStatus.details.lastUsed)}</span>
                      </div>
                    )}
                  </div>

                  {/* Profile picture if available */}
                  {connectionStatus.details.profileData?.picture && (
                    <div className="flex items-center gap-2 pt-1">
                      <img 
                        src={connectionStatus.details.profileData.picture} 
                        alt="Profile" 
                        className="w-5 h-5 rounded-full"
                      />
                      <span className="text-xs text-gray-600">
                        {connectionStatus.details.profileData.name || 'Account Profile'}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Connection warning for unconnected plugins */}
              {connectionStatus.status === 'disconnected' && (
                <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-200">
                  <p className="text-xs text-yellow-800">
                    This plugin needs to be connected to execute this workflow step.
                  </p>
                  <div className="flex items-center gap-3 mt-2">
                    <a 
                      href="/settings/connections" 
                      className="text-xs text-yellow-700 hover:text-yellow-900 underline"
                    >
                      Connect {step.pluginName} →
                    </a>
                    <button
                      onClick={onOpenReplaceModal}
                      className="text-xs text-blue-700 hover:text-blue-900 underline"
                    >
                      Or replace with another plugin
                    </button>
                  </div>
                </div>
              )}

              {/* Missing plugin warning - only shown for truly missing plugins */}
              {connectionStatus.status === 'missing' && (
                <div className="bg-red-50 rounded-lg p-3 border border-red-200">
                  <p className="text-xs text-red-800">
                    This plugin is not available in your system.
                  </p>
                  <button
                    onClick={onOpenReplaceModal}
                    className="text-xs text-red-700 hover:text-red-900 underline mt-1 inline-block"
                  >
                    Replace with available plugin →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};