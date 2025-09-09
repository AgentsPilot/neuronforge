import React from 'react';
import {
  X,
  Search,
  Filter,
  Grid3X3,
  List,
  Eye,
  EyeOff,
  CheckCircle,
  ArrowRight,
  Loader2,
  Settings,
  RefreshCw,
  AlertTriangle
} from 'lucide-react';
import { categoryMetadata } from '@/lib/plugins/pluginList';
import type { PluginConnection, PluginCategory, PluginStep } from './types';

interface AllPluginsBrowserModalProps {
  onClose: () => void;
  onAddStep: (pluginKey: string, phase: 'input' | 'process' | 'output') => void;
  isConnected: (pluginKey: string) => boolean;
  getPluginConnection: (pluginKey: string) => PluginConnection | null;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedCategory: PluginCategory | 'all' | 'system';
  setSelectedCategory: (category: PluginCategory | 'all' | 'system') => void;
  viewMode: 'grid' | 'list';
  setViewMode: (mode: 'grid' | 'list') => void;
  showConnectedOnly: boolean;
  setShowConnectedOnly: (show: boolean) => void;
  getFilteredPlugins: () => any[];
  loading: boolean;
  // NEW: Props for replacement mode
  isReplacementMode?: boolean;
  replacingStep?: PluginStep | null;
}

export const AllPluginsBrowserModal: React.FC<AllPluginsBrowserModalProps> = ({
  onClose,
  onAddStep,
  isConnected,
  getPluginConnection,
  searchQuery,
  setSearchQuery,
  selectedCategory,
  setSelectedCategory,
  viewMode,
  setViewMode,
  showConnectedOnly,
  setShowConnectedOnly,
  getFilteredPlugins,
  loading,
  // NEW: Replacement mode props
  isReplacementMode = false,
  replacingStep = null
}) => {
  const [selectedPhase, setSelectedPhase] = React.useState<'input' | 'process' | 'output'>('input');
  const filteredPlugins = getFilteredPlugins();

  // Filter out the current plugin being replaced
  const availablePlugins = isReplacementMode && replacingStep 
    ? filteredPlugins.filter(plugin => plugin.pluginKey !== replacingStep.pluginKey)
    : filteredPlugins;

  const categories = [
    { key: 'all' as const, label: 'All Categories', icon: <Grid3X3 className="w-4 h-4" /> },
    { key: 'system' as const, label: 'System Outputs', icon: <Settings className="w-4 h-4" /> },
    ...Object.entries(categoryMetadata).map(([key, meta]) => ({
      key: key as PluginCategory,
      label: meta.label,
      icon: meta.icon
    }))
  ];

  const handlePluginSelect = (pluginKey: string) => {
    if (isReplacementMode) {
      // In replacement mode, we don't need to specify phase since we're replacing an existing step
      onAddStep(pluginKey, selectedPhase);
    } else {
      // In add mode, use the selected phase
      onAddStep(pluginKey, selectedPhase);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className={`px-8 py-6 text-white ${
          isReplacementMode 
            ? 'bg-gradient-to-r from-orange-600 to-red-600' 
            : 'bg-gradient-to-r from-blue-600 to-purple-600'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                {isReplacementMode && <RefreshCw className="w-6 h-6" />}
                <h2 className="text-2xl font-bold">
                  {isReplacementMode ? 'Replace Plugin' : 'Browse All Plugins'}
                </h2>
              </div>
              {isReplacementMode && replacingStep ? (
                <div className="mt-2 space-y-1">
                  <p className="text-orange-100">
                    Replacing: <span className="font-semibold">{replacingStep.pluginName}</span>
                  </p>
                  <p className="text-orange-100 text-sm">
                    Choose from {availablePlugins.length} alternative plugins
                  </p>
                </div>
              ) : (
                <p className="text-blue-100">
                  Choose from {availablePlugins.length} available plugins
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-gray-200 transition-colors p-2"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Current Plugin Being Replaced (if in replacement mode) */}
        {isReplacementMode && replacingStep && (
          <div className="p-4 bg-orange-50 border-b border-orange-200">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-orange-100 rounded-xl">
                {replacingStep.icon}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-orange-900">Currently Using: {replacingStep.pluginName}</h3>
                <p className="text-orange-700 text-sm">{replacingStep.action}</p>
              </div>
              <div className="flex items-center gap-2 text-orange-700">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-medium">Will be replaced</span>
              </div>
            </div>
          </div>
        )}

        {/* Filters and Controls */}
        <div className="p-6 border-b border-gray-200 space-y-4">
          {/* Search and View Controls */}
          <div className="flex items-center gap-4">
            <div className="flex-1 relative">
              <Search className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder={isReplacementMode ? "Search alternative plugins..." : "Search plugins..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-3 rounded-xl transition-colors ${
                  viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                }`}
                title="Grid view"
              >
                <Grid3X3 className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-3 rounded-xl transition-colors ${
                  viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                }`}
                title="List view"
              >
                <List className="w-5 h-5" />
              </button>
            </div>

            <button
              onClick={() => setShowConnectedOnly(!showConnectedOnly)}
              className={`flex items-center gap-2 px-4 py-3 rounded-xl transition-colors ${
                showConnectedOnly ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
              title={showConnectedOnly ? "Show all plugins" : "Show connected only"}
            >
              {showConnectedOnly ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
              Connected Only
            </button>
          </div>

          {/* Category Filter */}
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <button
                key={category.key}
                onClick={() => setSelectedCategory(category.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  selectedCategory === category.key
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {category.icon}
                {category.label}
              </button>
            ))}
          </div>

          {/* Phase Selection - Only show if not in replacement mode */}
          {!isReplacementMode && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Add to phase:</span>
              {(['input', 'process', 'output'] as const).map((phase) => (
                <button
                  key={phase}
                  onClick={() => setSelectedPhase(phase)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors capitalize ${
                    selectedPhase === phase
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {phase}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Plugin Grid/List */}
        <div className="p-6 overflow-y-auto max-h-96">
          {loading ? (
            <div className="text-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">Loading plugins...</p>
            </div>
          ) : availablePlugins.length > 0 ? (
            <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-3'}>
              {availablePlugins.map((plugin) => {
                const pluginConnected = isConnected(plugin.pluginKey);
                const connection = getPluginConnection(plugin.pluginKey);
                
                return (
                  <button
                    key={plugin.pluginKey}
                    onClick={() => handlePluginSelect(plugin.pluginKey)}
                    className={`${
                      viewMode === 'grid' ? 'p-4' : 'p-3 flex items-center gap-4'
                    } border rounded-2xl text-left transition-all hover:shadow-md ${
                      isReplacementMode 
                        ? 'hover:border-orange-300 border-gray-200 bg-white hover:bg-orange-50' 
                        : 'hover:border-blue-300'
                    } ${
                      pluginConnected ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div className={viewMode === 'grid' ? 'text-center space-y-3' : 'flex items-center gap-4 flex-1'}>
                      <div className={viewMode === 'grid' ? 'text-3xl' : 'text-2xl'}>
                        {plugin.icon}
                      </div>
                      <div className={viewMode === 'grid' ? 'space-y-2' : 'flex-1'}>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-900">{plugin.name}</h3>
                          {pluginConnected && (
                            <CheckCircle className="w-4 h-4 text-emerald-600" />
                          )}
                        </div>
                        <p className={`text-gray-600 ${viewMode === 'grid' ? 'text-sm' : 'text-xs'}`}>
                          {plugin.description}
                        </p>
                        {connection && viewMode === 'list' && (
                          <p className="text-xs text-gray-500">
                            Connected as: {connection.username || connection.email}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded capitalize font-medium">
                            {plugin.category}
                          </span>
                          {plugin.isPopular && (
                            <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded font-medium">
                              Popular
                            </span>
                          )}
                          {isReplacementMode && (
                            <span className="text-xs bg-orange-100 text-orange-600 px-2 py-1 rounded font-medium">
                              Alternative
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {viewMode === 'list' && (
                          <>
                            {isReplacementMode ? (
                              <RefreshCw className="w-5 h-5 text-orange-500" />
                            ) : (
                              <ArrowRight className="w-5 h-5 text-gray-400" />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <Filter className="w-8 h-8 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-2">No plugins found</p>
              <p className="text-sm text-gray-500">
                {isReplacementMode 
                  ? "Try adjusting your filters to find alternative plugins"
                  : "Try adjusting your filters or search terms"
                }
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-gray-50 px-6 py-4 flex justify-between items-center">
          <div className="text-sm text-gray-500">
            {availablePlugins.filter(p => isConnected(p.pluginKey)).length} connected • {availablePlugins.length} total
            {isReplacementMode && (
              <span className="ml-2 text-orange-600">• Replacement mode</span>
            )}
          </div>
          <div className="flex gap-3">
            {isReplacementMode && (
              <span className="text-sm text-gray-600 py-2">
                Select a plugin to replace {replacingStep?.pluginName}
              </span>
            )}
            <button
              onClick={onClose}
              className="px-6 py-2 text-gray-700 hover:text-gray-900 font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};