// components/agent-creation/SmartAgentBuilder/components/PluginRequirements.tsx

import React, { useState, useEffect } from 'react';
import { 
  Zap, 
  Mail, 
  Calendar, 
  FileText, 
  Database, 
  Users, 
  BarChart3, 
  Globe, 
  Plus,
  X,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { PluginRequirementsProps } from '../types/agent';
import { useAuth } from '@/components/UserProvider'; // Add this import

interface ConnectedPlugin {
  plugin_key: string;
  plugin_name?: string;
  status?: string;
}

export default function PluginRequirements({
  pluginsRequired,
  isEditing,
  onUpdate
  

}: PluginRequirementsProps) {
console.log('🎯🎯🎯 PluginRequirements MOUNTED', { pluginsRequired, isEditing, userId: useAuth().user?.id });
  const { user } = useAuth(); // Add this to get user
  const [connectedPlugins, setConnectedPlugins] = useState<ConnectedPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch connected plugins
  
// Fetch connected plugins
  useEffect(() => {
    const fetchConnectedPlugins = async () => {
      if (!user?.id) {
        console.log('❌ No user found, skipping plugin fetch');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        console.log('🔍 Fetching connected plugins for user:', user.id);
        
        const response = await fetch('/api/plugin-connections', {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': user.id,
          },
        });
        
        console.log('📡 Response status:', response.status);
        console.log('📡 Response headers:', Object.fromEntries(response.headers.entries()));
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          console.error('❌ Response error:', response.status, errorData);
          
          if (response.status === 401) {
            throw new Error('Authentication failed - please make sure you are logged in');
          }
          
          throw new Error(errorData?.error || `HTTP ${response.status}`);
        }
        
        const data = await response.json();
        console.log('✅ Raw response data:', data);
        console.log('✅ Plugins in response:', data.plugins);
        console.log('✅ Debug info:', data.debug);
        
        // The API returns { plugins: [...], count: N }
        const plugins = data.plugins || [];
        console.log('✅ Setting', plugins.length, 'connected plugins');
        
        setConnectedPlugins(plugins);
        setError(null);
      } catch (err) {
        console.error('❌ Error fetching connected plugins:', err);
        setError(err instanceof Error ? err.message : 'Failed to load plugins');
        setConnectedPlugins([]);
      } finally {
        setLoading(false);
      }
    };

    fetchConnectedPlugins();
  }, [user?.id]);


  const getPluginIcon = (pluginName: string) => {
    const name = pluginName.toLowerCase();
    if (name.includes('gmail') || name.includes('email') || name.includes('mail')) return <Mail className="h-4 w-4" />;
    if (name.includes('calendar')) return <Calendar className="h-4 w-4" />;
    if (name.includes('drive') || name.includes('storage') || name.includes('file')) return <FileText className="h-4 w-4" />;
    if (name.includes('notion') || name.includes('database')) return <Database className="h-4 w-4" />;
    if (name.includes('slack') || name.includes('teams') || name.includes('discord')) return <Users className="h-4 w-4" />;
    if (name.includes('analytics') || name.includes('report')) return <BarChart3 className="h-4 w-4" />;
    if (name.includes('web') || name.includes('http')) return <Globe className="h-4 w-4" />;
    return <Zap className="h-4 w-4" />;
  };

  const formatPluginName = (pluginKey: string) => {
    // First check if we have a display name from the connected plugins
    const connectedPlugin = connectedPlugins.find(p => p.plugin_key === pluginKey);
    if (connectedPlugin?.plugin_name) {
      return connectedPlugin.plugin_name;
    }
    
    // Fallback to formatting the key
    return pluginKey
      .split(/[-_]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const removePlugin = (index: number) => {
    const newPlugins = pluginsRequired.filter((_, i) => i !== index);
    onUpdate(newPlugins);
  };

  const addPlugin = () => {
    // Add the first available connected plugin that's not already required
    const availablePlugin = connectedPlugins.find(
      plugin => !pluginsRequired.includes(plugin.plugin_key)
    );
    
    if (availablePlugin) {
      onUpdate([...pluginsRequired, availablePlugin.plugin_key]);
    }
  };

  const updatePlugin = (index: number, newValue: string) => {
    const newPlugins = [...pluginsRequired];
    newPlugins[index] = newValue;
    onUpdate(newPlugins);
  };

  // Get available plugins (connected but not currently required)
  const availablePlugins = connectedPlugins.filter(
    plugin => !pluginsRequired.includes(plugin.plugin_key)
  );

  const isPluginConnected = (pluginKey: string) => {
    return connectedPlugins.some(p => p.plugin_key === pluginKey);
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-500">Loading connected plugins...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
            <Zap className="h-4 w-4 text-purple-600" />
          </div>
          <h3 className="font-semibold text-gray-900">Required Plugins</h3>
        </div>
        <div className="text-center py-4">
          <AlertCircle className="h-6 w-6 text-red-500 mx-auto mb-2" />
          <p className="text-red-600 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
            <Zap className="h-4 w-4 text-purple-600" />
          </div>
          <h3 className="font-semibold text-gray-900">Required Plugins</h3>
        </div>
        {isEditing && availablePlugins.length > 0 && (
          <button
            onClick={addPlugin}
            className="flex items-center gap-2 text-sm text-purple-600 hover:text-purple-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Plugin
          </button>
        )}
      </div>
      
      <div className="space-y-3">
        {pluginsRequired.length > 0 ? (
          pluginsRequired.map((plugin, index) => {
            const connected = isPluginConnected(plugin);
            return (
              <div key={index} className={`flex items-center gap-3 p-3 border rounded-lg ${
                connected ? 'border-gray-200 bg-white' : 'border-orange-200 bg-orange-50'
              }`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                  connected ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'
                }`}>
                  {getPluginIcon(plugin)}
                </div>
                <div className="flex-1">
                  {isEditing ? (
                    <select
                      value={plugin}
                      onChange={(e) => updatePlugin(index, e.target.value)}
                      className="font-medium text-gray-900 bg-transparent border border-gray-300 rounded px-2 py-1 focus:border-blue-500 outline-none w-full"
                    >
                      <option value={plugin}>{formatPluginName(plugin)}</option>
                      {connectedPlugins
                        .filter(p => p.plugin_key !== plugin && !pluginsRequired.includes(p.plugin_key))
                        .map(connectedPlugin => (
                          <option key={connectedPlugin.plugin_key} value={connectedPlugin.plugin_key}>
                            {formatPluginName(connectedPlugin.plugin_key)}
                          </option>
                        ))
                      }
                    </select>
                  ) : (
                    <>
                      <h4 className="font-medium text-gray-900">{formatPluginName(plugin)}</h4>
                      <p className={`text-xs ${
                        connected ? 'text-green-600' : 'text-orange-600'
                      }`}>
                        {connected ? 'Connected and ready' : 'Not connected - please connect this plugin'}
                      </p>
                    </>
                  )}
                </div>
                {isEditing ? (
                  <button
                    onClick={() => removePlugin(index)}
                    className="text-red-600 hover:text-red-700 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <div className={`w-2 h-2 rounded-full ${
                    connected ? 'bg-green-500' : 'bg-orange-500'
                  }`} />
                )}
              </div>
            );
          })
        ) : (
          <div className="text-center py-8">
            <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="h-6 w-6 text-yellow-600" />
            </div>
            <p className="text-gray-500 text-sm mb-2">No specific plugins required</p>
            <p className="text-xs text-gray-400">
              This agent will use general AI capabilities without external service integrations
            </p>
          </div>
        )}
      </div>
      
      {/* Status Summary */}
      {pluginsRequired.length > 0 && !isEditing && (
        <div className="mt-4">
          {pluginsRequired.every(plugin => isPluginConnected(plugin)) ? (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full" />
                <p className="text-sm text-green-800">
                  All required plugins are connected and ready to use
                </p>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <p className="text-sm text-orange-800">
                  Some required plugins are not connected. Please connect them before using this agent.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Connected Plugins Info */}
      {isEditing && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800 mb-1">
            <strong>Connected Plugins ({connectedPlugins.length}):</strong>
          </p>
          <p className="text-xs text-blue-600">
            {connectedPlugins.length > 0 
              ? connectedPlugins.map(p => formatPluginName(p.plugin_key)).join(', ')
              : 'No plugins connected. Please connect plugins to use with your agents.'
            }
          </p>
        </div>
      )}
    </div>
  );
}