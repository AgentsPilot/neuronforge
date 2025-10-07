'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/UserProvider';
import { pluginList as availablePlugins } from '@/lib/plugins/pluginList';
import PluginCard from '@/components/settings/PluginCard';
import { Search, X, Sparkles, CheckCircle, Globe } from 'lucide-react';

interface PluginsStepProps {
  data: any[]; // We'll replace the mock plugin array
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

  // Show popular plugins first, then alphabetical
  const sortedPlugins = filteredPlugins.sort((a, b) => {
    if (a.isPopular && !b.isPopular) return -1;
    if (!a.isPopular && b.isPopular) return 1;
    return a.name.localeCompare(b.name);
  });

  // Get some quick stats
  const popularPlugins = availablePlugins.filter(plugin => plugin.isPopular);
  const connectedCount = connectedPlugins.length;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-sm text-gray-600">Loading your integrations...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <p className="text-sm text-gray-600">
          Connect your favorite tools to supercharge your workflow
        </p>
        <p className="text-xs text-gray-500 mt-1">
          You can always add more integrations later from settings
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-blue-50 p-3 rounded-xl text-center">
          <div className="flex items-center justify-center mb-1">
            <CheckCircle className="h-4 w-4 text-blue-600 mr-1" />
            <span className="text-lg font-bold text-blue-900">{connectedCount}</span>
          </div>
          <p className="text-xs text-blue-700">Connected</p>
        </div>
        
        <div className="bg-purple-50 p-3 rounded-xl text-center">
          <div className="flex items-center justify-center mb-1">
            <Sparkles className="h-4 w-4 text-purple-600 mr-1" />
            <span className="text-lg font-bold text-purple-900">{popularPlugins.length}</span>
          </div>
          <p className="text-xs text-purple-700">Popular</p>
        </div>
        
        <div className="bg-green-50 p-3 rounded-xl text-center">
          <div className="flex items-center justify-center mb-1">
            <Globe className="h-4 w-4 text-green-600 mr-1" />
            <span className="text-lg font-bold text-green-900">{availablePlugins.length}</span>
          </div>
          <p className="text-xs text-green-700">Available</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-4 w-4 text-gray-400" />
        </div>
        <input
          type="text"
          placeholder="Search integrations (e.g. Gmail, Slack, Notion...)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-10 py-3 border border-gray-300 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute inset-y-0 right-0 pr-3 flex items-center"
          >
            <X className="h-4 w-4 text-gray-400 hover:text-gray-600" />
          </button>
        )}
      </div>

      {/* Results Count */}
      <div className="text-center">
        <p className="text-sm text-gray-500">
          {search ? (
            <>Showing <span className="font-medium text-blue-600">{sortedPlugins.length}</span> of {availablePlugins.length} integrations</>
          ) : (
            <>Browse <span className="font-medium text-blue-600">{availablePlugins.length}</span> available integrations</>
          )}
        </p>
      </div>

      {/* Plugin Grid */}
      <div className="space-y-6">
        {sortedPlugins.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-80 overflow-y-auto">
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
          <div className="text-center py-8 bg-gray-50 rounded-xl">
            <Search className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-700 mb-2">No integrations found</h3>
            <p className="text-sm text-gray-500 mb-4">
              No integrations match your search "{search}". Try a different term.
            </p>
            <button
              onClick={() => setSearch('')}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Clear Search
            </button>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="text-center bg-blue-50 p-4 rounded-xl">
        <p className="text-sm text-blue-800 font-medium">
          {connectedCount === 0 ? (
            "No integrations connected yet"
          ) : connectedCount === 1 ? (
            "1 integration connected"
          ) : (
            `${connectedCount} integrations connected`
          )}
        </p>
        <p className="text-xs text-blue-600 mt-1">
          You can connect more integrations anytime from your settings
        </p>
      </div>

      {/* Popular Recommendations */}
      {!search && connectedCount === 0 && (
        <div className="bg-purple-50 p-4 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-4 w-4 text-purple-600" />
            <h4 className="text-sm font-medium text-purple-800">Popular Choices</h4>
          </div>
          <p className="text-xs text-purple-700">
            Most users connect: {popularPlugins.slice(0, 3).map(p => p.name).join(', ')}
          </p>
        </div>
      )}
    </div>
  );
};

export default PluginsStep;