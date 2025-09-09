import React, { useState } from 'react';
import {
  X,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  ArrowRight,
  Search,
  Filter
} from 'lucide-react';
import { getPluginByKey } from '@/lib/plugins/pluginList';
import type { PluginStep, PluginConnection, PluginCategory } from './types';

interface PluginReplaceModalProps {
  step: PluginStep;
  onReplace: (newPluginKey: string) => void;
  onClose: () => void;
  isConnected: (pluginKey: string) => boolean;
  getPluginConnection: (pluginKey: string) => PluginConnection | null;
  getFilteredPlugins: () => any[];
}

export const PluginReplaceModal: React.FC<PluginReplaceModalProps> = ({
  step,
  onReplace,
  onClose,
  isConnected,
  getPluginConnection,
  getFilteredPlugins
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<PluginCategory | 'all'>('all');

  const currentPlugin = getPluginByKey(step.pluginKey);
  const currentCategory = currentPlugin?.category || 'unknown';
  
  // Get available plugins for replacement
  const availablePlugins = getFilteredPlugins();
  
  // Filter plugins based on search and category
  const filteredPlugins = availablePlugins.filter(plugin => {
    const matchesSearch = searchQuery === '' || 
      plugin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      plugin.description.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = selectedCategory === 'all' || plugin.category === selectedCategory;
    
    // Exclude current plugin
    return plugin.pluginKey !== step.pluginKey && matchesSearch && matchesCategory;
  });

  const categories = [
    { key: 'all' as const, label: 'All Categories' },
    { key: 'communication' as const, label: 'Communication' },
    { key: 'productivity' as const, label: 'Productivity' },
    { key: 'crm' as const, label: 'CRM & Sales' },
    { key: 'marketing' as const, label: 'Marketing' },
    { key: 'project' as const, label: 'Project Management' },
    { key: 'finance' as const, label: 'Finance' },
    { key: 'integration' as const, label: 'Integration' },
    { key: 'ai' as const, label: 'AI Tools' }
  ];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-8 py-6 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">Replace Plugin</h2>
              <p className="text-blue-100 mt-1">
                Currently using: <span className="font-semibold">{step.pluginName}</span>
              </p>
              <p className="text-blue-200 text-sm">
                Category: {currentCategory}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-gray-200 transition-colors p-2"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="p-6 border-b border-gray-200 space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search plugins..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as PluginCategory | 'all')}
              className="px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-[180px]"
            >
              {categories.map(category => (
                <option key={category.key} value={category.key}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Plugin List */}
        <div className="p-6">
          {filteredPlugins.length > 0 ? (
            <>
              <div className="flex items-center gap-2 mb-6">
                <RefreshCw className="w-5 h-5 text-gray-600" />
                <h3 className="font-semibold text-gray-900">
                  Choose a replacement plugin ({filteredPlugins.length} available)
                </h3>
              </div>
              
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {filteredPlugins.map((plugin) => {
                  const pluginConnected = isConnected(plugin.pluginKey);
                  const connection = getPluginConnection(plugin.pluginKey);
                  
                  return (
                    <button
                      key={plugin.pluginKey}
                      onClick={() => onReplace(plugin.pluginKey)}
                      className="w-full flex items-center gap-4 p-4 border-2 rounded-2xl text-left transition-all border-gray-200 hover:border-blue-300 hover:bg-blue-50 group"
                    >
                      <div className="text-2xl group-hover:scale-110 transition-transform">
                        {plugin.icon}
                      </div>
                      
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h4 className="font-bold text-gray-900">{plugin.name}</h4>
                          {pluginConnected ? (
                            <span className="text-xs bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full flex items-center gap-1 font-medium">
                              <CheckCircle className="w-3 h-3" />
                              Connected
                            </span>
                          ) : (
                            <span className="text-xs bg-orange-100 text-orange-700 px-3 py-1 rounded-full flex items-center gap-1 font-medium">
                              <AlertTriangle className="w-3 h-3" />
                              Not Connected
                            </span>
                          )}
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded font-medium capitalize">
                            {plugin.category}
                          </span>
                        </div>
                        
                        <p className="text-sm text-gray-600 mb-2 leading-relaxed">
                          {plugin.description}
                        </p>
                        
                        {connection ? (
                          <p className="text-xs text-gray-500">
                            Connected as: <span className="font-medium">{connection.username || connection.email}</span>
                          </p>
                        ) : (
                          <p className="text-xs text-orange-600">
                            Will need to be connected before workflow can run
                          </p>
                        )}
                      </div>
                      
                      <ArrowRight className="w-5 h-5 text-blue-500 group-hover:translate-x-1 transition-transform" />
                    </button>
                  );
                })}
              </div>
              
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <p className="text-sm text-blue-800">
                  You can replace with any plugin. If it's not connected, you'll need to{' '}
                  <a href="/settings/connections" className="text-blue-900 font-semibold hover:underline">
                    connect it in settings
                  </a>
                  {' '}before running the workflow.
                </p>
              </div>
            </>
          ) : (
            <div className="text-center py-12">
              <Filter className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <h3 className="font-semibold text-gray-900 mb-2">No plugins found</h3>
              <p className="text-gray-600 text-sm mb-4">
                {searchQuery ? 
                  `No plugins match "${searchQuery}"` : 
                  `No plugins available in the ${selectedCategory} category`
                }
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('all');
                }}
                className="text-blue-600 hover:text-blue-800 font-medium text-sm"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-gray-50 px-6 py-4 flex justify-between items-center">
          <div className="text-xs text-gray-500">
            {availablePlugins.filter(p => isConnected(p.pluginKey)).length} connected plugins available
          </div>
          <button
            onClick={onClose}
            className="px-6 py-2 text-gray-700 hover:text-gray-900 font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};