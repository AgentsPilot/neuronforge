'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/UserProvider';
import { pluginList as availablePlugins } from '@/lib/plugins/pluginList';
import PluginCard from '@/components/settings/PluginCard';
import { Search, X, Sparkles, CheckCircle, Globe, Zap } from 'lucide-react';

interface PluginsStepProps {
  data: any[];
  onChange: (plugins: any[]) => void;
}

const PluginsStep: React.FC<PluginsStepProps> = ({ data, onChange }) => {
  const [search, setSearch] = useState('');
  const [connectedPlugins, setConnectedPlugins] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user } = useAuth();

  // Fetch connected plugins on mount
  useEffect(() => {
    const fetchConnectedPlugins = async () => {
      if (!user?.id) {
        setIsLoading(false);
        return;
      }

      const { data: connections, error } = await supabase
        .from('plugin_connections')
        .select('plugin_key')
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (!error && connections) {
        setConnectedPlugins(connections.map(connection => connection.plugin_key));
      }
      setIsLoading(false);
    };

    fetchConnectedPlugins();
  }, [user]);

  const handleConnectionChange = (pluginKey: string, connected: boolean) => {
    if (connected) {
      setConnectedPlugins(prev => [...prev, pluginKey]);
    } else {
      setConnectedPlugins(prev => prev.filter(key => key !== pluginKey));
    }
  };

  // Filter plugins based on search
  const filteredPlugins = availablePlugins.filter((plugin) => {
    const matchesSearch = plugin.name.toLowerCase().includes(search.toLowerCase()) ||
      plugin.description.toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  });

  // Show popular plugins first
  const sortedPlugins = filteredPlugins.sort((a, b) => {
    if (a.isPopular && !b.isPopular) return -1;
    if (!a.isPopular && b.isPopular) return 1;
    return a.name.localeCompare(b.name);
  });

  const popularPlugins = availablePlugins.filter(plugin => plugin.isPopular);
  const connectedCount = connectedPlugins.length;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="w-8 h-8 mx-auto mb-4">
            <div className="absolute rounded-full border-2 border-gray-600 w-8 h-8"></div>
            <div className="absolute rounded-full border-2 border-transparent border-t-blue-500 w-8 h-8 animate-spin"></div>
          </div>
          <p className="text-sm text-gray-400">Loading integrations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <p className="text-gray-300 text-sm mb-1">
          Connect your tools to supercharge your workflows
        </p>
        <p className="text-gray-500 text-xs">
          Choose the integrations that match your daily tools
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20 p-3 rounded-xl text-center">
          <div className="flex items-center justify-center mb-1">
            <CheckCircle className="h-4 w-4 text-green-400 mr-1" />
            <span className="text-lg font-bold text-green-300">{connectedCount}</span>
          </div>
          <p className="text-xs text-green-400">Connected</p>
        </div>
        
        <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20 p-3 rounded-xl text-center">
          <div className="flex items-center justify-center mb-1">
            <Sparkles className="h-4 w-4 text-purple-400 mr-1" />
            <span className="text-lg font-bold text-purple-300">{popularPlugins.length}</span>
          </div>
          <p className="text-xs text-purple-400">Popular</p>
        </div>
        
        <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border border-blue-500/20 p-3 rounded-xl text-center">
          <div className="flex items-center justify-center mb-1">
            <Globe className="h-4 w-4 text-blue-400 mr-1" />
            <span className="text-lg font-bold text-blue-300">{availablePlugins.length}</span>
          </div>
          <p className="text-xs text-blue-400">Available</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-4 w-4 text-gray-500" />
        </div>
        <input
          type="text"
          placeholder="Search integrations (Gmail, Slack, Notion...)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-10 py-3 bg-gray-800/30 border border-gray-700/50 rounded-xl text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 focus:bg-gray-800/50 transition-all duration-200"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Plugin Grid */}
      <div className="space-y-4">
        {sortedPlugins.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 max-h-72 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800/50">
            {sortedPlugins.map((plugin) => (
              <div key={plugin.pluginKey} className="h-fit">
                <PluginCard
                  pluginKey={plugin.pluginKey}
                  pluginName={plugin.name}
                  description={plugin.description}
                  detailedDescription={plugin.detailedDescription}
                  icon={plugin.icon}
                  category={plugin.category}
                  isPopular={plugin.isPopular}
                  onConnectionChange={handleConnectionChange}
                />
              </div>
            ))}
          </div>
        ) : (
          /* No Results */
          <div className="text-center py-8 bg-gray-800/30 rounded-xl border border-gray-700/50">
            <Search className="h-12 w-12 text-gray-500 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-300 mb-2">No integrations found</h3>
            <p className="text-sm text-gray-500 mb-4">
              No integrations match "{search}". Try a different search term.
            </p>
            <button
              onClick={() => setSearch('')}
              className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white text-sm font-medium rounded-lg transition-all duration-200"
            >
              Clear Search
            </button>
          </div>
        )}
      </div>

      {/* Summary Section */}
      <div className="space-y-3">
        {/* Connection Status */}
        <div className="text-center p-4 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-xl">
          <div className="flex items-center justify-center space-x-2 mb-2">
            <Zap className="h-4 w-4 text-blue-400" />
            <p className="text-sm font-medium text-blue-200">
              {connectedCount === 0 ? (
                "No integrations connected yet"
              ) : connectedCount === 1 ? (
                "1 integration ready"
              ) : (
                `${connectedCount} integrations ready`
              )}
            </p>
          </div>
          <p className="text-xs text-blue-300/70">
            Connect more anytime from your settings dashboard
          </p>
        </div>

        {/* Popular Recommendations */}
        {!search && connectedCount === 0 && (
          <div className="p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-xl">
            <div className="flex items-center space-x-2 mb-2">
              <Sparkles className="h-4 w-4 text-purple-400" />
              <h4 className="text-sm font-medium text-purple-200">Most Popular</h4>
            </div>
            <p className="text-xs text-purple-300/80">
              {popularPlugins.slice(0, 3).map(p => p.name).join(', ')} are the most connected integrations
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PluginsStep;