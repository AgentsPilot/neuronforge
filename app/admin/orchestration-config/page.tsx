'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Settings,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Zap,
  Brain,
  Sliders,
  Database,
  ChevronUp,
  ChevronDown,
  Clock,
  DollarSign,
  Cpu,
  Target,
  BarChart3
} from 'lucide-react';

interface OrchestrationConfig {
  // Master controls
  enabled: boolean;
  compressionEnabled: boolean;
  aisRoutingEnabled: boolean;

  // Model routing (tier configuration)
  modelFast: string;
  modelBalanced: string;
  modelPowerful: string;

  // AIS routing thresholds
  fastTierMaxScore: number;
  balancedTierMaxScore: number;

  // Routing strategy weights
  routingStrategy: {
    aisWeight: number;
    stepWeight: number;
  };

  // AgentKit Core Configuration
  agentkit: {
    defaultModel: string;
    temperature: number;
    maxIterations: number;
    timeoutMs: number;
  };

  // Pilot workflow configuration
  pilot: {
    enabled: boolean;
    maxSteps: number;
    maxExecutionTimeMs: number;
    maxParallelSteps: number;
    retryEnabled: boolean;
    defaultRetryCount: number;
    circuitBreakerThreshold: number;
    checkpointEnabled: boolean;
    retentionDays: number;
    // AgentKit Token Protection
    maxToolResponseChars: number;
    loopDetectionWindow: number;
    maxSameToolRepeats: number;
    maxTokensPerIteration: number;
    maxTotalExecutionTokens: number;
    // Workflow Execution Options
    enableCaching: boolean;
    continueOnError: boolean;
    enableProgressTracking: boolean;
    enableRealTimeUpdates: boolean;
    enableOptimizations: boolean;
    cacheStepResults: boolean;
  };

  // Token budgets per intent
  tokenBudgets: {
    extract: number;
    summarize: number;
    generate: number;
    validate: number;
    send: number;
    transform: number;
    conditional: number;
    aggregate: number;
    filter: number;
    enrich: number;
  };

  // Compression configuration
  compressionTargetRatio: number;
  compressionMinQuality: number;
  compressionAggressiveness: string;

  // Budget configuration
  maxTokensPerStep: number;
  maxTokensPerWorkflow: number;
  budgetOverageAllowed: boolean;
  budgetOverageThreshold: number;
  budgetAllocationStrategy: string;
  criticalStepMultiplier: number;
}

interface ComplexityWeights {
  promptLength: number;
  dataSize: number;
  conditionCount: number;
  contextDepth: number;
  reasoningDepth: number;
  outputComplexity: number;
}

interface ComplexityThresholds {
  low: number;
  medium: number;
  high: number;
}

// Available model options
const AVAILABLE_MODELS = {
  claude: [
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (Most Capable)', tier: 'powerful' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku (Fast & Smart)', tier: 'balanced' },
    { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku (Fastest)', tier: 'fast' },
    { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus (Premium)', tier: 'powerful' },
    { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet', tier: 'balanced' },
  ],
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o (Flagship)', tier: 'powerful' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Efficient)', tier: 'balanced' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo', tier: 'powerful' },
    { value: 'gpt-4', label: 'GPT-4', tier: 'powerful' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (Fast)', tier: 'fast' },
  ],
  google: [
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', tier: 'powerful' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', tier: 'balanced' },
    { value: 'gemini-pro', label: 'Gemini Pro', tier: 'balanced' },
  ]
};

// Flatten all models for easy access
const ALL_MODELS = [
  ...AVAILABLE_MODELS.claude,
  ...AVAILABLE_MODELS.openai,
  ...AVAILABLE_MODELS.google,
];

export default function OrchestrationConfigPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Section collapse states
  const [masterExpanded, setMasterExpanded] = useState(true);
  const [modelExpanded, setModelExpanded] = useState(false);
  const [thresholdsExpanded, setThresholdsExpanded] = useState(false);
  const [strategyExpanded, setStrategyExpanded] = useState(false);
  const [agentkitCoreExpanded, setAgentkitCoreExpanded] = useState(false);
  const [pilotExpanded, setPilotExpanded] = useState(false);
  const [complexityExpanded, setComplexityExpanded] = useState(false);
  const [budgetsExpanded, setBudgetsExpanded] = useState(false);
  const [compressionExpanded, setCompressionExpanded] = useState(false);

  // Configuration state
  const [config, setConfig] = useState<OrchestrationConfig>({
    enabled: false,
    compressionEnabled: false,
    aisRoutingEnabled: false,
    modelFast: 'claude-3-haiku-20240307',
    modelBalanced: 'gpt-4o-mini',
    modelPowerful: 'claude-3-5-sonnet-20241022',
    fastTierMaxScore: 3.0,
    balancedTierMaxScore: 6.5,
    routingStrategy: {
      aisWeight: 0.6,
      stepWeight: 0.4,
    },
    agentkit: {
      defaultModel: 'gpt-4o-mini',
      temperature: 0.1,
      maxIterations: 10,
      timeoutMs: 120000,
    },
    pilot: {
      enabled: false,
      maxSteps: 50,
      maxExecutionTimeMs: 300000,
      maxParallelSteps: 3,
      retryEnabled: true,
      defaultRetryCount: 3,
      circuitBreakerThreshold: 5,
      checkpointEnabled: true,
      retentionDays: 90,
      maxToolResponseChars: 8000,
      loopDetectionWindow: 3,
      maxSameToolRepeats: 3,
      maxTokensPerIteration: 50000,
      maxTotalExecutionTokens: 200000,
      enableCaching: false,
      continueOnError: false,
      enableProgressTracking: true,
      enableRealTimeUpdates: false,
      enableOptimizations: true,
      cacheStepResults: false,
    },
    tokenBudgets: {
      extract: 1000,
      summarize: 2000,
      generate: 3000,
      validate: 1500,
      send: 500,
      transform: 2000,
      conditional: 1000,
      aggregate: 2500,
      filter: 1000,
      enrich: 2000,
    },
    compressionTargetRatio: 0.5,
    compressionMinQuality: 0.8,
    compressionAggressiveness: 'medium',
    maxTokensPerStep: 10000,
    maxTokensPerWorkflow: 50000,
    budgetOverageAllowed: true,
    budgetOverageThreshold: 1.2,
    budgetAllocationStrategy: 'proportional',
    criticalStepMultiplier: 1.5,
  });

  // Complexity weights per intent type
  const [complexityWeights, setComplexityWeights] = useState<Record<string, ComplexityWeights>>({
    generate: {
      promptLength: 0.15,
      dataSize: 0.1,
      conditionCount: 0.15,
      contextDepth: 0.15,
      reasoningDepth: 0.3,
      outputComplexity: 0.15,
    },
    llm_decision: {
      promptLength: 0.15,
      dataSize: 0.1,
      conditionCount: 0.15,
      contextDepth: 0.15,
      reasoningDepth: 0.3,
      outputComplexity: 0.15,
    },
    transform: {
      promptLength: 0.15,
      dataSize: 0.3,
      conditionCount: 0.1,
      contextDepth: 0.15,
      reasoningDepth: 0.15,
      outputComplexity: 0.15,
    },
    conditional: {
      promptLength: 0.15,
      dataSize: 0.1,
      conditionCount: 0.3,
      contextDepth: 0.15,
      reasoningDepth: 0.2,
      outputComplexity: 0.1,
    },
    action: {
      promptLength: 0.2,
      dataSize: 0.15,
      conditionCount: 0.15,
      contextDepth: 0.15,
      reasoningDepth: 0.2,
      outputComplexity: 0.15,
    },
    default: {
      promptLength: 0.2,
      dataSize: 0.15,
      conditionCount: 0.15,
      contextDepth: 0.15,
      reasoningDepth: 0.2,
      outputComplexity: 0.15,
    },
  });

  // Complexity thresholds
  const [complexityThresholds, setComplexityThresholds] = useState<Record<string, ComplexityThresholds>>({
    promptLength: { low: 200, medium: 500, high: 1000 },
    dataSize: { low: 1024, medium: 10240, high: 51200 },
    conditionCount: { low: 2, medium: 5, high: 10 },
    contextDepth: { low: 2, medium: 5, high: 10 },
  });

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/admin/orchestration-config');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch configuration');
      }

      if (data.success && data.config) {
        setConfig(data.config);
        if (data.complexityWeights) setComplexityWeights(data.complexityWeights);
        if (data.complexityThresholds) setComplexityThresholds(data.complexityThresholds);
      }
    } catch (err) {
      console.error('Error fetching orchestration config:', err);
      setError(err instanceof Error ? err.message : 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/admin/orchestration-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config,
          complexityWeights,
          complexityThresholds,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save configuration');
      }

      setSuccess('✅ Orchestration configuration saved successfully!');
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      console.error('Error saving orchestration config:', err);
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const validateWeights = (weights: ComplexityWeights): boolean => {
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    return Math.abs(sum - 1.0) < 0.01; // Allow small floating point errors
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mx-auto mb-4" />
          <p className="text-slate-300">Loading orchestration configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
              <Brain className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">Orchestration Configuration</h1>
              <p className="text-slate-400">Unified routing system with AIS + step complexity analysis</p>
            </div>
          </div>
        </div>

        {/* Alert Messages */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 bg-red-500/10 border border-red-500/50 rounded-xl p-4 flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-400 font-medium">Error</p>
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          </motion.div>
        )}

        {success && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 bg-green-500/10 border border-green-500/50 rounded-xl p-4 flex items-start gap-3"
          >
            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-green-400 font-medium">Success</p>
              <p className="text-green-300 text-sm">{success}</p>
            </div>
          </motion.div>
        )}

        {/* Info Box */}
        <div className="mb-6 bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Brain className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-slate-300">
              <p className="font-medium text-blue-400 mb-1">Unified Routing System</p>
              <p>
                This page controls the <strong>consolidated orchestration routing system</strong> that combines:
              </p>
              <ul className="list-disc list-inside mt-2 space-y-1 text-slate-400">
                <li><strong>Agent-level AIS</strong> (60% weight): Overall agent complexity from agent_intensity_metrics</li>
                <li><strong>Step-level complexity</strong> (40% weight): Real-time analysis of individual step requirements</li>
                <li><strong>Database-driven configuration</strong>: All weights, thresholds, and strategies stored in database</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Save Button (Top) */}
        <div className="mb-6 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl font-medium hover:shadow-lg hover:shadow-blue-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                Save Configuration
              </>
            )}
          </button>
        </div>

        {/* Configuration Sections */}
        <div className="space-y-6">
          {/* Section 1: Master Controls */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden"
          >
            <button
              onClick={() => setMasterExpanded(!masterExpanded)}
              className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Settings className="w-6 h-6 text-blue-400" />
                <div className="text-left">
                  <h3 className="text-xl font-bold text-white">Master Controls</h3>
                  <p className="text-sm text-slate-400">Global toggles for core orchestration features and routing systems</p>
                </div>
              </div>
              {masterExpanded ? (
                <ChevronUp className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {masterExpanded && (
              <div className="p-6 border-t border-white/10 space-y-4">
                {/* Info Box */}
                <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                  <p className="text-sm text-blue-300 mb-2">
                    <strong>What are Master Controls?</strong> These are global on/off switches for the entire orchestration system. They control whether intelligent routing, compression, and AIS-based model selection are active.
                  </p>
                  <p className="text-xs text-blue-200 mb-2">
                    <strong>When to disable:</strong> Turn off Orchestration for debugging (forces manual model selection), disable Compression when context preservation is critical, or disable AIS Routing to use fixed model tiers regardless of complexity.
                  </p>
                  <p className="text-xs text-blue-200">
                    💡 <strong>Production Recommendation:</strong> Keep all three enabled for optimal cost-performance balance. Only disable temporarily for troubleshooting.
                  </p>
                </div>

                {/* Orchestration Enabled */}
                <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
                  <div className="flex-1 mr-4">
                    <p className="text-white font-medium">Orchestration Enabled</p>
                    <p className="text-sm text-slate-400 mt-1">Master switch for the entire intelligent routing system. When enabled, workflows automatically use AIS scores + complexity analysis to select optimal models for each step, apply token budgets, handle compression, and route through Pilot. When disabled, the system falls back to manual model selection without intelligent routing. Recommended: Always enabled for production to maximize cost-performance optimization.</p>
                  </div>
                  <label className="relative inline-block w-14 h-8 flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={config.enabled}
                      onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-full h-full bg-slate-700 peer-checked:bg-green-500 rounded-full peer transition-colors cursor-pointer"></div>
                    <div className="absolute left-1 top-1 w-6 h-6 bg-white rounded-full transition-transform peer-checked:translate-x-6"></div>
                  </label>
                </div>

                {/* Compression Enabled */}
                <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
                  <div className="flex-1 mr-4">
                    <p className="text-white font-medium">Compression Enabled</p>
                    <p className="text-sm text-slate-400 mt-1">Intelligent context compression to reduce token usage while preserving semantic meaning. The system automatically condenses large contexts (conversation history, workflow state, tool outputs) using advanced summarization before sending to AI models. Can reduce token costs by 30-70% on context-heavy workflows. Disable only when exact context preservation is critical (e.g., legal document processing, code generation requiring all details). Recommended: Enabled for most production workflows.</p>
                  </div>
                  <label className="relative inline-block w-14 h-8 flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={config.compressionEnabled}
                      onChange={(e) => setConfig({ ...config, compressionEnabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-full h-full bg-slate-700 peer-checked:bg-green-500 rounded-full peer transition-colors cursor-pointer"></div>
                    <div className="absolute left-1 top-1 w-6 h-6 bg-white rounded-full transition-transform peer-checked:translate-x-6"></div>
                  </label>
                </div>

                {/* AIS Routing Enabled */}
                <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
                  <div className="flex-1 mr-4">
                    <p className="text-white font-medium">AIS Routing Enabled</p>
                    <p className="text-sm text-slate-400 mt-1">Enable adaptive model tier selection based on Agent Intensity Score (AIS) combined with real-time step complexity analysis. When enabled, the system calculates a complexity score for each task using the routing formula (AIS Weight × Agent Score + Step Weight × Task Complexity) and automatically routes to Fast/Balanced/Powerful tiers. When disabled, uses a fixed model tier regardless of task difficulty (less optimal). Recommended: Enabled to ensure complex tasks get powerful models while simple tasks use cost-efficient ones.</p>
                  </div>
                  <label className="relative inline-block w-14 h-8 flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={config.aisRoutingEnabled}
                      onChange={(e) => setConfig({ ...config, aisRoutingEnabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-full h-full bg-slate-700 peer-checked:bg-green-500 rounded-full peer transition-colors cursor-pointer"></div>
                    <div className="absolute left-1 top-1 w-6 h-6 bg-white rounded-full transition-transform peer-checked:translate-x-6"></div>
                  </label>
                </div>
              </div>
            )}
          </motion.div>

          {/* Section 2: Model Tier Configuration */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden"
          >
            <button
              onClick={() => setModelExpanded(!modelExpanded)}
              className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Cpu className="w-6 h-6 text-purple-400" />
                <div className="text-left">
                  <h3 className="text-xl font-bold text-white">Model Tier Configuration</h3>
                  <p className="text-sm text-slate-400">Three-tier routing: Fast (simple tasks), Balanced (moderate complexity), Powerful (advanced reasoning)</p>
                </div>
              </div>
              {modelExpanded ? (
                <ChevronUp className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {modelExpanded && (
              <div className="p-6 border-t border-white/10 space-y-4">
                {/* Info Box */}
                <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-xl">
                  <p className="text-sm text-purple-300 mb-2">
                    <strong>What are Model Tiers?</strong> The orchestration system automatically routes tasks to one of three tier levels based on complexity scores. Fast tier (cheapest, fastest) for simple tasks, Balanced tier (moderate cost/capability) for standard workflows, and Powerful tier (premium, most capable) for complex reasoning.
                  </p>
                  <p className="text-xs text-purple-200 mb-2">
                    <strong>How routing works:</strong> Each task gets a complexity score (0-10). The system compares this score to your AIS Routing Thresholds to select the appropriate tier, then uses the model you've configured for that tier.
                  </p>
                  <p className="text-xs text-purple-200">
                    💡 <strong>Cost Optimization:</strong> Using claude-3-haiku for Fast tier, claude-3-5-haiku for Balanced, and claude-3-5-sonnet for Powerful provides excellent quality at 60-80% cost savings vs. using premium models for everything.
                  </p>
                </div>

                {/* Fast Tier */}
                <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-xl">
                  <label className="block text-green-400 font-medium mb-2">
                    <Zap className="w-4 h-4 inline mr-2" />
                    Fast Tier Model (Score {'<'} 3.0)
                  </label>
                  <select
                    value={config.modelFast}
                    onChange={(e) => setConfig({ ...config, modelFast: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent cursor-pointer"
                  >
                    <optgroup label="Claude Models">
                      {AVAILABLE_MODELS.claude.map(model => (
                        <option key={model.value} value={model.value}>{model.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="OpenAI Models">
                      {AVAILABLE_MODELS.openai.map(model => (
                        <option key={model.value} value={model.value}>{model.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Google Models">
                      {AVAILABLE_MODELS.google.map(model => (
                        <option key={model.value} value={model.value}>{model.label}</option>
                      ))}
                    </optgroup>
                  </select>
                  <p className="text-xs text-slate-400 mt-2">Used for simple, straightforward tasks with complexity scores below the Fast Tier Max threshold. Examples: Basic data retrieval, simple API calls, data validation, format conversion, status checks. These tasks don't require advanced reasoning or extensive context understanding. Recommended models: claude-3-haiku (fastest, cheapest), gpt-4o-mini (good balance), claude-3-5-haiku (newest fast model). Fast tier handles 60-70% of typical workflow tasks at fraction of the cost.</p>
                </div>

                {/* Balanced Tier */}
                <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                  <label className="block text-blue-400 font-medium mb-2">
                    <Sliders className="w-4 h-4 inline mr-2" />
                    Balanced Tier Model (Score 3.0-6.5)
                  </label>
                  <select
                    value={config.modelBalanced}
                    onChange={(e) => setConfig({ ...config, modelBalanced: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer"
                  >
                    <optgroup label="Claude Models">
                      {AVAILABLE_MODELS.claude.map(model => (
                        <option key={model.value} value={model.value}>{model.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="OpenAI Models">
                      {AVAILABLE_MODELS.openai.map(model => (
                        <option key={model.value} value={model.value}>{model.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Google Models">
                      {AVAILABLE_MODELS.google.map(model => (
                        <option key={model.value} value={model.value}>{model.label}</option>
                      ))}
                    </optgroup>
                  </select>
                  <p className="text-xs text-slate-400 mt-2">Used for moderate complexity tasks with scores between Fast Max and Balanced Max thresholds. Examples: Multi-step workflows, data transformation, moderate reasoning, summarization, business logic execution, error handling. These tasks require some reasoning capability but don't need flagship model power. Recommended models: claude-3-5-haiku (excellent capability-to-cost ratio), gpt-4o-mini, claude-3-sonnet. Balanced tier handles 25-30% of tasks and provides sweet spot for cost-performance.</p>
                </div>

                {/* Powerful Tier */}
                <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-xl">
                  <label className="block text-purple-400 font-medium mb-2">
                    <Brain className="w-4 h-4 inline mr-2" />
                    Powerful Tier Model (Score {'>'} 6.5)
                  </label>
                  <select
                    value={config.modelPowerful}
                    onChange={(e) => setConfig({ ...config, modelPowerful: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent cursor-pointer"
                  >
                    <optgroup label="Claude Models">
                      {AVAILABLE_MODELS.claude.map(model => (
                        <option key={model.value} value={model.value}>{model.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="OpenAI Models">
                      {AVAILABLE_MODELS.openai.map(model => (
                        <option key={model.value} value={model.value}>{model.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Google Models">
                      {AVAILABLE_MODELS.google.map(model => (
                        <option key={model.value} value={model.value}>{model.label}</option>
                      ))}
                    </optgroup>
                  </select>
                  <p className="text-xs text-slate-400 mt-2">Used for high complexity tasks scoring above Balanced Max threshold. Examples: Complex reasoning, code generation, advanced data analysis, creative problem-solving, multi-step decision trees, strategic planning. These tasks require flagship model capabilities for quality results. Recommended models: claude-3-5-sonnet (best overall), gpt-4o (strong reasoning), claude-3-opus (maximum capability). Powerful tier handles 5-15% of tasks but ensures critical/complex operations get the best available AI. Most expensive but essential for quality.</p>
                </div>
              </div>
            )}
          </motion.div>

          {/* Section 3: AIS Routing Thresholds */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden"
          >
            <button
              onClick={() => setThresholdsExpanded(!thresholdsExpanded)}
              className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Target className="w-6 h-6 text-yellow-400" />
                <div className="text-left">
                  <h3 className="text-xl font-bold text-white">AIS Routing Thresholds</h3>
                  <p className="text-sm text-slate-400">Configure score boundaries that determine when to escalate from Fast → Balanced → Powerful tiers</p>
                </div>
              </div>
              {thresholdsExpanded ? (
                <ChevronUp className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {thresholdsExpanded && (
              <div className="p-6 border-t border-white/10 space-y-4">
                {/* Info Box */}
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                  <p className="text-sm text-yellow-300 mb-2">
                    <strong>What are AIS Routing Thresholds?</strong> These score boundaries determine when the orchestration system escalates from cheaper models to more powerful (and expensive) ones. Think of them as quality gates: simple tasks stay in Fast tier, moderate complexity moves to Balanced, and complex reasoning escalates to Powerful.
                  </p>
                  <p className="text-xs text-yellow-200 mb-2">
                    <strong>Complexity Scoring (0-10 scale):</strong> The system analyzes task complexity by examining prompt length, data size, reasoning depth, tool usage, and historical patterns. Scores below Fast Max use Fast tier, scores between Fast Max and Balanced Max use Balanced tier, scores above Balanced Max use Powerful tier.
                  </p>
                  <p className="text-xs text-yellow-200">
                    💡 <strong>Tuning Strategy:</strong> Lower thresholds (Fast Max: 2.0, Balanced Max: 5.0) = higher quality but more expensive. Higher thresholds (Fast Max: 4.0, Balanced Max: 7.5) = lower cost but may sacrifice quality on edge cases. Default 3.0/6.5 is well-tested for most workloads.
                  </p>
                </div>

                {/* Fast Tier Max */}
                <div className="p-4 bg-slate-800/50 rounded-xl">
                  <label className="block text-white font-medium mb-2">
                    Fast Tier Max Score
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={config.fastTierMaxScore}
                    onChange={(e) => setConfig({ ...config, fastTierMaxScore: parseFloat(e.target.value) })}
                    className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-slate-400 mt-2">Maximum complexity score for fast tier (0-10 scale). Tasks scoring below this threshold use fast, cost-efficient models. Recommended: 3.0 for simple data retrieval and straightforward operations.</p>
                </div>

                {/* Balanced Tier Max */}
                <div className="p-4 bg-slate-800/50 rounded-xl">
                  <label className="block text-white font-medium mb-2">
                    Balanced Tier Max Score
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={config.balancedTierMaxScore}
                    onChange={(e) => setConfig({ ...config, balancedTierMaxScore: parseFloat(e.target.value) })}
                    className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-slate-400 mt-2">Maximum complexity score for balanced tier (0-10 scale). Tasks scoring between Fast Max and this threshold use balanced models. Recommended: 6.5 for multi-step workflows and moderate reasoning tasks.</p>
                </div>

                <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                  <p className="text-xs text-blue-400">
                    <strong>Routing Logic:</strong> Score {'<'} {config.fastTierMaxScore} = Fast Tier | Score {config.fastTierMaxScore}-{config.balancedTierMaxScore} = Balanced Tier | Score {'>'} {config.balancedTierMaxScore} = Powerful Tier. Adjust thresholds based on your quality vs. cost requirements.
                  </p>
                </div>
              </div>
            )}
          </motion.div>

          {/* Section 4: Routing Strategy Weights */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden"
          >
            <button
              onClick={() => setStrategyExpanded(!strategyExpanded)}
              className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <BarChart3 className="w-6 h-6 text-green-400" />
                <div className="text-left">
                  <h3 className="text-xl font-bold text-white">Routing Strategy Weights</h3>
                  <p className="text-sm text-slate-400">Fine-tune the balance between agent-level intensity (AIS) and individual step complexity in routing decisions</p>
                </div>
              </div>
              {strategyExpanded ? (
                <ChevronUp className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {strategyExpanded && (
              <div className="p-6 border-t border-white/10 space-y-4">
                <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                  <p className="text-sm text-blue-300 mb-2">
                    <strong>Routing Formula:</strong> Effective Complexity = (Agent AIS × AIS Weight) + (Step Complexity × Step Weight)
                  </p>
                  <p className="text-xs text-blue-200">
                    The system calculates a final score by combining the agent's overall intensity with the specific step's complexity. Higher AIS Weight prioritizes agent-level patterns, while higher Step Weight focuses on individual task analysis.
                  </p>
                </div>

                {/* AIS Weight */}
                <div className="p-4 bg-slate-800/50 rounded-xl">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-white font-medium">Agent AIS Weight</label>
                    <span className="text-blue-400 font-mono">{(config.routingStrategy.aisWeight * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={config.routingStrategy.aisWeight}
                    onChange={(e) => {
                      const aisWeight = parseFloat(e.target.value);
                      setConfig({
                        ...config,
                        routingStrategy: {
                          aisWeight,
                          stepWeight: 1 - aisWeight,
                        },
                      });
                    }}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer slider"
                  />
                  <p className="text-xs text-slate-400 mt-2">Weight given to the agent's overall complexity score from agent_intensity_metrics table. Higher values (60-80%) trust historical patterns and agent-level analysis more than individual step analysis. Recommended: 60% for balanced routing.</p>
                </div>

                {/* Step Weight */}
                <div className="p-4 bg-slate-800/50 rounded-xl">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-white font-medium">Step Complexity Weight</label>
                    <span className="text-purple-400 font-mono">{(config.routingStrategy.stepWeight * 100).toFixed(0)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={config.routingStrategy.stepWeight}
                    onChange={(e) => {
                      const stepWeight = parseFloat(e.target.value);
                      setConfig({
                        ...config,
                        routingStrategy: {
                          aisWeight: 1 - stepWeight,
                          stepWeight,
                        },
                      });
                    }}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer slider"
                  />
                  <p className="text-xs text-slate-400 mt-2">Weight given to real-time analysis of each workflow step's complexity (prompt length, data size, reasoning depth, etc.). Higher values (40-60%) prioritize granular step-by-step evaluation. Automatically calculated as 100% - AIS Weight.</p>
                </div>

                <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <p className="text-xs text-yellow-400">
                    <strong>Recommended:</strong> 60% agent AIS, 40% step complexity for balanced routing
                  </p>
                </div>
              </div>
            )}
          </motion.div>

          {/* Section 5: AgentKit Core Configuration */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden"
          >
            <button
              onClick={() => setAgentkitCoreExpanded(!agentkitCoreExpanded)}
              className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Cpu className="w-6 h-6 text-cyan-400" />
                <div className="text-left">
                  <h3 className="text-xl font-bold text-white">AgentKit Core Configuration</h3>
                  <p className="text-sm text-slate-400">Core execution engine settings including model selection, temperature, iteration limits, and token protection mechanisms</p>
                </div>
              </div>
              {agentkitCoreExpanded ? (
                <ChevronUp className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {agentkitCoreExpanded && (
              <div className="p-6 border-t border-white/10 space-y-4">
                {/* Info Box */}
                <div className="p-4 bg-cyan-500/10 border border-cyan-500/30 rounded-xl">
                  <p className="text-sm text-cyan-300 mb-2">
                    <strong>What is AgentKit?</strong> AgentKit is the core agentic execution engine that powers intelligent task completion. It enables AI models to use tools, make decisions, and iteratively solve complex problems through autonomous reasoning loops.
                  </p>
                  <p className="text-xs text-cyan-200 mb-2">
                    <strong>How it works with Orchestration:</strong> The Orchestration System routes requests to AgentKit when tasks require autonomous problem-solving (e.g., multi-step data processing, API integrations, complex decision trees). AgentKit then executes using the model, temperature, and safety limits configured here, while respecting the token budgets set by the orchestration layer.
                  </p>
                  <p className="text-xs text-cyan-200">
                    💡 <strong>Key Features:</strong> Function calling (tools), iterative reasoning, autonomous decision-making, loop detection, token protection, and execution timeouts.
                  </p>
                </div>

                {/* Default Model */}
                <div className="p-4 bg-slate-800/50 rounded-xl">
                  <label className="block text-white font-medium mb-2">Default Model</label>
                  <select
                    value={config.agentkit.defaultModel}
                    onChange={(e) => setConfig({ ...config, agentkit: { ...config.agentkit, defaultModel: e.target.value } })}
                    className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent cursor-pointer"
                  >
                    <optgroup label="Claude Models">
                      {AVAILABLE_MODELS.claude.map(model => (
                        <option key={model.value} value={model.value}>{model.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="OpenAI Models">
                      {AVAILABLE_MODELS.openai.map(model => (
                        <option key={model.value} value={model.value}>{model.label}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Google Models">
                      {AVAILABLE_MODELS.google.map(model => (
                        <option key={model.value} value={model.value}>{model.label}</option>
                      ))}
                    </optgroup>
                  </select>
                  <p className="text-xs text-slate-400 mt-2">The default AI model used for AgentKit agentic execution when orchestration doesn't override with a specific tier selection. This is the fallback model for function calling, tool use, and autonomous reasoning. Recommended: claude-3-5-haiku for best balance of speed, capability, and cost. Use gpt-4o-mini for maximum cost efficiency (80% cheaper than gpt-4o). Use claude-3-5-sonnet for most capable reasoning. Note: This can be overridden by Model Tier Configuration based on task complexity.</p>
                </div>

                {/* Temperature */}
                <div className="p-4 bg-slate-800/50 rounded-xl">
                  <label className="block text-white font-medium mb-2">Temperature (0.0-2.0)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="2"
                    value={config.agentkit.temperature}
                    onChange={(e) => setConfig({ ...config, agentkit: { ...config.agentkit, temperature: parseFloat(e.target.value) } })}
                    className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  />
                  <p className="text-xs text-slate-400 mt-2">Controls randomness and creativity in AI model responses. Temperature affects how the model samples from its probability distribution: Lower values (0.0-0.3) produce deterministic, focused, and consistent outputs (same input = same output). Higher values (0.7-1.5) increase creativity, variation, and exploration but reduce reliability. For agentic execution where deterministic tool calling is critical, use 0.0-0.2. Recommended: 0.1 for production agent reliability, 0.0 for maximum consistency, 0.3-0.5 only if creative problem-solving is needed.</p>
                </div>

                {/* Max Iterations */}
                <div className="p-4 bg-slate-800/50 rounded-xl">
                  <label className="block text-white font-medium mb-2">Max Iterations</label>
                  <input
                    type="number"
                    value={config.agentkit.maxIterations}
                    onChange={(e) => setConfig({ ...config, agentkit: { ...config.agentkit, maxIterations: parseInt(e.target.value) } })}
                    className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  />
                  <p className="text-xs text-slate-400 mt-2">Maximum number of think-act cycles (iterations) the agent can perform before forcibly stopping. Each iteration = AI thinks → calls tools → processes results → decides next action. Prevents infinite loops where the agent never reaches a conclusion. Recommended: 10 for most tasks (allows ~10 tool calls), 5 for simple operations (faster, lower cost), 15-20 for complex multi-step workflows. If agents frequently hit this limit without completing, investigate for logic errors or increase cautiously. More iterations = higher cost and latency.</p>
                </div>

                {/* Timeout */}
                <div className="p-4 bg-slate-800/50 rounded-xl">
                  <label className="block text-white font-medium mb-2">Execution Timeout (ms)</label>
                  <input
                    type="number"
                    value={config.agentkit.timeoutMs}
                    onChange={(e) => setConfig({ ...config, agentkit: { ...config.agentkit, timeoutMs: parseInt(e.target.value) } })}
                    className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  />
                  <p className="text-xs text-slate-400 mt-2">Wall-clock timeout for entire AgentKit execution in milliseconds. Agent is forcibly terminated if execution exceeds this duration, even if max iterations not reached. Protects against slow API calls, network issues, or computationally expensive operations. Recommended: 120000ms (2 minutes) for complex operations with external APIs, 60000ms (1 minute) for standard tasks, 30000ms (30 seconds) for simple operations. Consider that each iteration includes AI inference + tool execution, so multiply iteration time by max iterations.</p>
                </div>

                {/* Token Protection */}
                <div className="p-6 border-t border-white/10 space-y-4">
                <h4 className="text-white font-medium">Token Protection & Loop Detection</h4>
                <p className="text-xs text-slate-400">Safeguards to prevent excessive token consumption, runaway costs, and infinite execution loops during agent operations</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-800/50 rounded-xl">
                    <label className="block text-white font-medium mb-2">Max Tool Response Chars</label>
                    <input
                      type="number"
                      value={config.pilot.maxToolResponseChars}
                      onChange={(e) => setConfig({ ...config, pilot: { ...config.pilot, maxToolResponseChars: parseInt(e.target.value) } })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-2">Maximum number of characters allowed in tool/function call responses before truncation. Prevents extremely large responses (like entire database dumps or massive file reads) from consuming excessive tokens and costs. Responses exceeding this limit are automatically truncated with a warning. Recommended: 10000 for standard operations, 50000 for data analysis tasks, 5000 for cost-sensitive environments. Lower values save tokens but may cut off important data.</p>
                  </div>

                  <div className="p-4 bg-slate-800/50 rounded-xl">
                    <label className="block text-white font-medium mb-2">Loop Detection Window</label>
                    <input
                      type="number"
                      value={config.pilot.loopDetectionWindow}
                      onChange={(e) => setConfig({ ...config, pilot: { ...config.pilot, loopDetectionWindow: parseInt(e.target.value) } })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-2">Number of recent steps to analyze for repeating patterns that indicate infinite loops. The system checks if the agent is calling the same sequence of tools repeatedly with the same arguments (a sign it's stuck). Recommended: 5 steps for quick loop detection, 10 steps for more sophisticated pattern detection. Higher values catch complex loops but use more memory and processing.</p>
                  </div>

                  <div className="p-4 bg-slate-800/50 rounded-xl">
                    <label className="block text-white font-medium mb-2">Max Same Tool Repeats</label>
                    <input
                      type="number"
                      value={config.pilot.maxSameToolRepeats}
                      onChange={(e) => setConfig({ ...config, pilot: { ...config.pilot, maxSameToolRepeats: parseInt(e.target.value) } })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-2">Maximum times the same tool can be called consecutively before the workflow is terminated. Prevents agents from getting stuck calling the same function over and over (e.g., repeatedly searching for something that doesn't exist). Recommended: 3 for strict loop prevention, 5 for moderate flexibility, 10+ for iterative operations that legitimately need repetition (like pagination or retries). Set too low and legitimate iteration breaks; too high and loops waste tokens.</p>
                  </div>

                  <div className="p-4 bg-slate-800/50 rounded-xl">
                    <label className="block text-white font-medium mb-2">Max Tokens Per Iteration</label>
                    <input
                      type="number"
                      value={config.pilot.maxTokensPerIteration}
                      onChange={(e) => setConfig({ ...config, pilot: { ...config.pilot, maxTokensPerIteration: parseInt(e.target.value) } })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-2">Token budget for a single agent iteration (one think-act cycle: receiving context, reasoning, calling tools, getting responses). Prevents individual iterations from becoming too expensive. Recommended: 4000 for standard operations, 8000 for complex reasoning tasks, 2000 for simple tool calls. If iterations frequently exceed this, either increase the limit or simplify the workflow to reduce context size.</p>
                  </div>

                  <div className="p-4 bg-slate-800/50 rounded-xl">
                    <label className="block text-white font-medium mb-2">Max Total Execution Tokens</label>
                    <input
                      type="number"
                      value={config.pilot.maxTotalExecutionTokens}
                      onChange={(e) => setConfig({ ...config, pilot: { ...config.pilot, maxTotalExecutionTokens: parseInt(e.target.value) } })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-2">Absolute maximum total tokens for the entire workflow execution across all iterations. This is the final safety net that prevents runaway costs. Once reached, execution stops immediately regardless of completion status. Recommended: 50000 for standard workflows (covers ~10-15 iterations), 100000 for complex multi-step processes, 20000 for simple operations. This should be higher than Max Tokens Per Iteration × Max Iterations to allow for completion.</p>
                  </div>
                </div>
                </div>
              </div>
            )}
          </motion.div>

          {/* Section 6: Pilot Workflow Configuration */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden"
          >
            <button
              onClick={() => setPilotExpanded(!pilotExpanded)}
              className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Clock className="w-6 h-6 text-orange-400" />
                <div className="text-left">
                  <h3 className="text-xl font-bold text-white">Pilot Workflow Configuration</h3>
                  <p className="text-sm text-slate-400">Advanced workflow engine settings: execution limits, retry logic, checkpoints, loop detection, and error handling</p>
                </div>
              </div>
              {pilotExpanded ? (
                <ChevronUp className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {pilotExpanded && (
              <div className="p-6 border-t border-white/10 space-y-6">
                {/* Info Box */}
                <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                  <p className="text-sm text-blue-300 mb-2">
                    <strong>What is Pilot Workflow Engine?</strong> Pilot is the advanced workflow orchestration system that executes complex multi-step processes. It manages step sequencing, parallel execution, error handling, retry logic, and state persistence.
                  </p>
                  <p className="text-xs text-blue-200 mb-2">
                    <strong>How it works with Orchestration:</strong> When a request comes in, the Orchestration System first classifies the intent and determines the optimal model tier using AIS routing. Then Pilot takes over to execute the workflow: it breaks down complex tasks into steps, applies the token budgets you configured, routes each step to the appropriate model, handles retries and failures, and tracks progress. Think of Orchestration as the "brain" (deciding what to do) and Pilot as the "hands" (actually doing it).
                  </p>
                  <p className="text-xs text-blue-200 mb-2">
                    <strong>When to use:</strong> Enable for production workflows that require reliability, checkpoints, and automatic recovery from failures. Disable for simple single-step tasks to reduce overhead.
                  </p>
                  <p className="text-xs text-blue-200">
                    💡 <strong>Key Features:</strong> Automatic retries, circuit breaker pattern, loop detection, checkpoint/resume, parallel step execution, and real-time progress tracking.
                  </p>
                </div>

                {/* Enable Pilot */}
                <div className="flex items-center justify-between p-4 bg-orange-500/10 border border-orange-500/30 rounded-xl">
                  <div className="flex-1 mr-4">
                    <p className="text-white font-medium">Enable Pilot Workflows</p>
                    <p className="text-xs text-slate-400 mt-1">Master switch for the workflow execution engine. When enabled, complex multi-step workflows can be orchestrated with automatic retry, checkpointing, and error recovery. Disable to reduce overhead for simple single-step operations. Production environments should keep this enabled for reliability.</p>
                  </div>
                  <button
                    onClick={() => setConfig({ ...config, pilot: { ...config.pilot, enabled: !config.pilot.enabled } })}
                    className={`relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ${
                      config.pilot.enabled ? 'bg-orange-500' : 'bg-slate-700'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${
                        config.pilot.enabled ? 'translate-x-7' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Execution Limits */}
                <div className="space-y-4">
                  <h4 className="text-white font-medium">Execution Limits</h4>
                  <p className="text-xs text-slate-400">Safety limits to prevent runaway workflows and infinite loops</p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-white font-medium mb-2">Max Steps</label>
                      <input
                        type="number"
                        value={config.pilot.maxSteps}
                        onChange={(e) => setConfig({ ...config, pilot: { ...config.pilot, maxSteps: parseInt(e.target.value) } })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-1">Maximum number of steps a workflow can execute before being forcibly terminated. Prevents infinite loops and runaway processes. Recommended: 50 for standard workflows, 100-200 for complex data processing pipelines. If workflows frequently hit this limit, investigate for logic errors or increase cautiously.</p>
                    </div>

                    <div>
                      <label className="block text-white font-medium mb-2">Max Execution Time (ms)</label>
                      <input
                        type="number"
                        value={config.pilot.maxExecutionTimeMs}
                        onChange={(e) => setConfig({ ...config, pilot: { ...config.pilot, maxExecutionTimeMs: parseInt(e.target.value) } })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-1">Wall-clock timeout for entire workflow execution in milliseconds. Workflow is terminated if it exceeds this duration, even if max steps not reached. Recommended: 300000ms (5 minutes) for standard workflows. Increase to 600000ms (10 minutes) for long-running data processing. Lower to 60000ms (1 minute) for time-sensitive operations.</p>
                    </div>

                    <div>
                      <label className="block text-white font-medium mb-2">Max Parallel Steps</label>
                      <input
                        type="number"
                        value={config.pilot.maxParallelSteps}
                        onChange={(e) => setConfig({ ...config, pilot: { ...config.pilot, maxParallelSteps: parseInt(e.target.value) } })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-1">Maximum number of workflow steps that can execute simultaneously. Higher values improve throughput but increase resource usage and costs (multiple API calls running at once). Recommended: 3 for balanced performance, 1 for cost-sensitive sequential execution, 5-10 for high-throughput scenarios with good API rate limits.</p>
                    </div>
                  </div>
                </div>

                {/* Retry Configuration */}
                <div className="space-y-4">
                  <h4 className="text-white font-medium">Retry Configuration</h4>
                  <p className="text-xs text-slate-400">Automatic recovery from transient failures (network issues, rate limits, temporary API errors)</p>

                  <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl mb-4">
                    <div className="flex-1 mr-4">
                      <p className="text-white font-medium">Enable Retry</p>
                      <p className="text-xs text-slate-400 mt-1">Automatically retry failed workflow steps before marking them as failed. Essential for production reliability as it handles transient failures (network blips, rate limits, temporary API unavailability). Recommended: Enabled for production, can be disabled for development/testing to fail fast and see errors immediately.</p>
                    </div>
                    <button
                      onClick={() => setConfig({ ...config, pilot: { ...config.pilot, retryEnabled: !config.pilot.retryEnabled } })}
                      className={`relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ${
                        config.pilot.retryEnabled ? 'bg-green-500' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${
                          config.pilot.retryEnabled ? 'translate-x-7' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-white font-medium mb-2">Default Retry Count</label>
                      <input
                        type="number"
                        value={config.pilot.defaultRetryCount}
                        onChange={(e) => setConfig({ ...config, pilot: { ...config.pilot, defaultRetryCount: parseInt(e.target.value) } })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-1">Number of times to retry a failed step before giving up. Each retry uses exponential backoff (wait time doubles each attempt). Recommended: 3 retries for good balance (fails after ~7 seconds total). Use 1-2 for fast failure, 5+ for critical operations that must succeed. More retries = longer wait but higher success rate.</p>
                    </div>

                    <div>
                      <label className="block text-white font-medium mb-2">Circuit Breaker Threshold</label>
                      <input
                        type="number"
                        value={config.pilot.circuitBreakerThreshold}
                        onChange={(e) => setConfig({ ...config, pilot: { ...config.pilot, circuitBreakerThreshold: parseInt(e.target.value) } })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-1">Number of consecutive failures before the circuit breaker "opens" and stops attempting further operations. This fail-fast mechanism prevents cascading failures when external services are down. When circuit opens, requests fail immediately instead of waiting for timeouts. Recommended: 5 for standard resilience, 3 for fast failure detection, 10+ for systems with unreliable external dependencies. After circuit opens, it enters a cooldown period before trying again.</p>
                    </div>
                  </div>
                </div>

                {/* Checkpoint & Retention */}
                <div className="space-y-4">
                  <h4 className="text-white font-medium">Checkpoint Configuration</h4>
                  <p className="text-xs text-slate-400">State persistence for workflow resume capability after failures or system restarts</p>

                  <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl mb-4">
                    <div className="flex-1 mr-4">
                      <p className="text-white font-medium">Enable Checkpoints</p>
                      <p className="text-xs text-slate-400 mt-1">Save workflow state at key points during execution. When enabled, workflows can resume from the last checkpoint if they fail or are interrupted (server restart, crash, timeout). Essential for long-running workflows that process valuable data. Disabling improves performance but means failed workflows must restart from the beginning. Recommended: Enabled for production, especially for workflows longer than 1 minute.</p>
                    </div>
                    <button
                      onClick={() => setConfig({ ...config, pilot: { ...config.pilot, checkpointEnabled: !config.pilot.checkpointEnabled } })}
                      className={`relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ${
                        config.pilot.checkpointEnabled ? 'bg-blue-500' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${
                          config.pilot.checkpointEnabled ? 'translate-x-7' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Retention Days</label>
                    <input
                      type="number"
                      value={config.pilot.retentionDays}
                      onChange={(e) => setConfig({ ...config, pilot: { ...config.pilot, retentionDays: parseInt(e.target.value) } })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Number of days to keep checkpoint data in the database before automatic cleanup. Longer retention allows debugging old workflow failures but increases storage costs. Recommended: 7 days for development, 30 days for production environments where audit trails are important, 3 days for high-volume systems where storage is a concern. After this period, checkpoints are permanently deleted.</p>
                  </div>
                </div>

                {/* Workflow Execution Options */}
                <div className="space-y-4">
                  <h4 className="text-white font-medium">Advanced Execution Options</h4>
                  <p className="text-xs text-slate-400">Performance, monitoring, and reliability features for production workflows</p>

                  {/* Enable Caching */}
                  <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
                    <div className="flex-1 mr-4">
                      <p className="text-white font-medium">Enable Caching</p>
                      <p className="text-xs text-slate-400 mt-1">Enable intelligent caching of workflow step results. When the same step with identical inputs is executed multiple times (across different workflows or retries), the cached result is reused instead of re-executing. Dramatically improves performance and reduces costs for repeated operations. Recommended: Enabled for production. Disable during development/testing if you need to see fresh results every time.</p>
                    </div>
                    <button
                      onClick={() => setConfig({ ...config, pilot: { ...config.pilot, enableCaching: !config.pilot.enableCaching } })}
                      className={`relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ${
                        config.pilot.enableCaching ? 'bg-green-500' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${
                          config.pilot.enableCaching ? 'translate-x-7' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Continue on Error */}
                  <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
                    <div className="flex-1 mr-4">
                      <p className="text-white font-medium">Continue on Error</p>
                      <p className="text-xs text-slate-400 mt-1">When a workflow step fails, continue executing subsequent steps instead of stopping the entire workflow. Useful for workflows where some steps are optional or where partial results are acceptable (e.g., data processing where some records might fail but others should succeed). Recommended: Disabled for critical workflows where any failure is unacceptable. Enable for fault-tolerant batch processing.</p>
                    </div>
                    <button
                      onClick={() => setConfig({ ...config, pilot: { ...config.pilot, continueOnError: !config.pilot.continueOnError } })}
                      className={`relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ${
                        config.pilot.continueOnError ? 'bg-green-500' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${
                          config.pilot.continueOnError ? 'translate-x-7' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Enable Progress Tracking */}
                  <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
                    <div className="flex-1 mr-4">
                      <p className="text-white font-medium">Enable Progress Tracking</p>
                      <p className="text-xs text-slate-400 mt-1">Record detailed progress information for each workflow step (step number, status, timestamps, outputs). Enables progress bars in UI and detailed execution history. Adds small overhead for database writes. Recommended: Enabled for user-facing workflows where progress visibility improves UX. Can disable for background batch jobs where progress isn't monitored.</p>
                    </div>
                    <button
                      onClick={() => setConfig({ ...config, pilot: { ...config.pilot, enableProgressTracking: !config.pilot.enableProgressTracking } })}
                      className={`relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ${
                        config.pilot.enableProgressTracking ? 'bg-green-500' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${
                          config.pilot.enableProgressTracking ? 'translate-x-7' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Enable Real-Time Updates */}
                  <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
                    <div className="flex-1 mr-4">
                      <p className="text-white font-medium">Enable Real-Time Updates</p>
                      <p className="text-xs text-slate-400 mt-1">Push workflow progress updates to clients via WebSocket connections instead of requiring polling. Provides instant feedback in UI as steps complete. Requires WebSocket infrastructure and adds small overhead. Recommended: Enabled for interactive user-facing applications where real-time feedback is important. Disable for API-only or batch processing scenarios where real-time updates aren't needed.</p>
                    </div>
                    <button
                      onClick={() => setConfig({ ...config, pilot: { ...config.pilot, enableRealTimeUpdates: !config.pilot.enableRealTimeUpdates } })}
                      className={`relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ${
                        config.pilot.enableRealTimeUpdates ? 'bg-green-500' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${
                          config.pilot.enableRealTimeUpdates ? 'translate-x-7' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Enable Optimizations */}
                  <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
                    <div className="flex-1 mr-4">
                      <p className="text-white font-medium">Enable Optimizations</p>
                      <p className="text-xs text-slate-400 mt-1">Apply automatic performance optimizations including step reordering (executing independent steps in parallel), dead code elimination (skipping steps whose outputs aren't used), and smart batching (combining similar operations). Can improve execution speed by 20-50% but may make workflows harder to debug. Recommended: Enabled for production after workflows are stable and tested. Disable during development for predictable execution order.</p>
                    </div>
                    <button
                      onClick={() => setConfig({ ...config, pilot: { ...config.pilot, enableOptimizations: !config.pilot.enableOptimizations } })}
                      className={`relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ${
                        config.pilot.enableOptimizations ? 'bg-green-500' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${
                          config.pilot.enableOptimizations ? 'translate-x-7' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Cache Step Results */}
                  <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
                    <div className="flex-1 mr-4">
                      <p className="text-white font-medium">Cache Step Results</p>
                      <p className="text-xs text-slate-400 mt-1">Store the output of each workflow step in cache for potential reuse within the same workflow execution (e.g., if a step is retried or if the workflow branches and rejoins). Different from "Enable Caching" which caches across workflows. This option reduces redundant work during a single workflow run. Recommended: Enabled for workflows with potential retries or branching logic. Minimal overhead with significant benefits for complex workflows.</p>
                    </div>
                    <button
                      onClick={() => setConfig({ ...config, pilot: { ...config.pilot, cacheStepResults: !config.pilot.cacheStepResults } })}
                      className={`relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ${
                        config.pilot.cacheStepResults ? 'bg-green-500' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${
                          config.pilot.cacheStepResults ? 'translate-x-7' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>

          {/* Section 7: Token Budget Configuration */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden"
          >
            <button
              onClick={() => setBudgetsExpanded(!budgetsExpanded)}
              className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <DollarSign className="w-6 h-6 text-green-400" />
                <div className="text-left">
                  <h3 className="text-xl font-bold text-white">Token Budget Configuration</h3>
                  <p className="text-sm text-slate-400">Control token usage per workflow step and intent type. Prevent runaway costs and optimize resource allocation.</p>
                </div>
              </div>
              {budgetsExpanded ? (
                <ChevronUp className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {budgetsExpanded && (
              <div className="p-6 border-t border-white/10 space-y-6">
                {/* Info Box */}
                <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                  <p className="text-sm text-blue-300 mb-2">
                    <strong>Why Token Budgets Matter:</strong> Token budgets prevent runaway costs and ensure predictable pricing. Each workflow step is allocated a maximum number of tokens based on its intent type. The system will stop execution if budgets are exceeded (unless overage is allowed).
                  </p>
                  <p className="text-xs text-blue-200">
                    💡 <strong>Example:</strong> If "Extract" has 1000 tokens and a step needs 1200, it will either fail or use overage (if enabled). This protects against accidentally expensive operations.
                  </p>
                </div>

                {/* Workflow Token Limits */}
                <div className="space-y-4">
                  <h4 className="text-white font-medium">Workflow Token Limits</h4>
                  <p className="text-xs text-slate-400">Global limits that apply across all workflows regardless of intent type</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-800/50 rounded-xl">
                      <label className="block text-white font-medium mb-2">Max Tokens Per Step</label>
                      <input
                        type="number"
                        value={config.maxTokensPerStep}
                        onChange={(e) => setConfig({ ...config, maxTokensPerStep: parseInt(e.target.value) })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-2">Hard limit for any single workflow step. Prevents individual steps from consuming excessive tokens. Recommended: 10,000 for most operations. Increase to 20,000+ only for complex analysis steps that require large context windows.</p>
                    </div>

                    <div className="p-4 bg-slate-800/50 rounded-xl">
                      <label className="block text-white font-medium mb-2">Max Tokens Per Workflow</label>
                      <input
                        type="number"
                        value={config.maxTokensPerWorkflow}
                        onChange={(e) => setConfig({ ...config, maxTokensPerWorkflow: parseInt(e.target.value) })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-2">Total token budget for entire workflow execution (sum of all steps). Prevents workflows from running indefinitely. Recommended: 50,000 for standard workflows. Increase to 100,000+ for complex multi-step processes with large data analysis.</p>
                    </div>

                    <div className="p-4 bg-slate-800/50 rounded-xl">
                      <label className="block text-white font-medium mb-2">Budget Overage Threshold</label>
                      <input
                        type="number"
                        step="0.1"
                        min="1.0"
                        max="2.0"
                        value={config.budgetOverageThreshold}
                        onChange={(e) => setConfig({ ...config, budgetOverageThreshold: parseFloat(e.target.value) })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-2">How much over budget a step can go when "Allow Budget Overage" is enabled. Value of 1.2 = 20% overage (1000 token budget becomes 1200 max). Use 1.1-1.3 for tight control, 1.5+ for flexibility. Higher values increase cost risk but reduce workflow failures.</p>
                    </div>

                    <div className="p-4 bg-slate-800/50 rounded-xl">
                      <label className="block text-white font-medium mb-2">Critical Step Multiplier</label>
                      <input
                        type="number"
                        step="0.1"
                        min="1.0"
                        max="3.0"
                        value={config.criticalStepMultiplier}
                        onChange={(e) => setConfig({ ...config, criticalStepMultiplier: parseFloat(e.target.value) })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-2">Multiplier applied to steps marked as "critical" (first/last steps, error handling). Value of 1.5 gives 50% more budget to critical steps. Use 1.3-1.5 for normal workflows, 2.0+ for critical business processes where failures are costly.</p>
                    </div>
                  </div>

                  {/* Budget Overage Toggle */}
                  <div className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl">
                    <div className="flex-1 mr-4">
                      <p className="text-white font-medium">Allow Budget Overage</p>
                      <p className="text-xs text-slate-400 mt-1">When enabled, steps can exceed their allocated budget up to the overage threshold (e.g., 1.2x = 20% over). This prevents workflow failures when steps need slightly more tokens than budgeted. Disable for strict cost control. Enable for production workflows where completion is more important than exact budget adherence.</p>
                    </div>
                    <button
                      onClick={() => setConfig({ ...config, budgetOverageAllowed: !config.budgetOverageAllowed })}
                      className={`relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ${
                        config.budgetOverageAllowed ? 'bg-green-500' : 'bg-slate-700'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full transition-transform ${
                          config.budgetOverageAllowed ? 'translate-x-7' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Budget Allocation Strategy */}
                  <div className="p-4 bg-slate-800/50 rounded-xl">
                    <label className="block text-white font-medium mb-2">Budget Allocation Strategy</label>
                    <select
                      value={config.budgetAllocationStrategy}
                      onChange={(e) => setConfig({ ...config, budgetAllocationStrategy: e.target.value })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent cursor-pointer"
                    >
                      <option value="equal">Equal - Same budget for all steps</option>
                      <option value="proportional">Proportional - Based on intent complexity</option>
                      <option value="adaptive">Adaptive - Learn from execution history</option>
                      <option value="priority">Priority - More for critical steps</option>
                    </select>
                    <p className="text-xs text-slate-400 mt-2">
                      <strong>How tokens are distributed across workflow steps:</strong><br/>
                      • <strong>Equal:</strong> Every step gets the same budget (simple, predictable, may waste tokens on simple steps)<br/>
                      • <strong>Proportional:</strong> Uses the per-intent budgets below (e.g., "Generate" gets more than "Extract"). Recommended for most workflows.<br/>
                      • <strong>Adaptive:</strong> Learns from past executions and adjusts budgets based on actual usage patterns (advanced, requires execution history)<br/>
                      • <strong>Priority:</strong> Gives more budget to critical steps (first, last, error handlers) using the Critical Step Multiplier
                    </p>
                  </div>
                </div>

                {/* Per-Intent Token Budgets */}
                <div className="space-y-4">
                  <h4 className="text-white font-medium">Per-Intent Token Budgets</h4>
                  <p className="text-xs text-slate-400 mb-2">Base token allocation for each workflow intent type. These budgets are used when "Proportional" allocation strategy is selected. Each intent has different token requirements based on its complexity.</p>

                  <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-xs text-yellow-300">
                      💡 <strong>Tip:</strong> Start with default values and monitor actual usage in Analytics. Increase budgets for intents that frequently hit limits. Decrease budgets for intents that consistently use less than 50% of allocation.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* Extract */}
                    <div className="p-4 bg-slate-800/50 rounded-xl">
                      <label className="block text-white font-medium mb-2">Extract</label>
                      <input
                        type="number"
                        value={config.tokenBudgets.extract}
                        onChange={(e) => setConfig({ ...config, tokenBudgets: { ...config.tokenBudgets, extract: parseInt(e.target.value) } })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-1">For pulling specific data from sources (APIs, databases, documents). Typically needs moderate tokens to parse and identify relevant information. Use 800-1500 tokens.</p>
                    </div>

                    {/* Summarize */}
                    <div className="p-4 bg-slate-800/50 rounded-xl">
                      <label className="block text-white font-medium mb-2">Summarize</label>
                      <input
                        type="number"
                        value={config.tokenBudgets.summarize}
                        onChange={(e) => setConfig({ ...config, tokenBudgets: { ...config.tokenBudgets, summarize: parseInt(e.target.value) } })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-1">For condensing large text into summaries. Needs more tokens to process input context and generate coherent summaries. Use 1500-2500 tokens.</p>
                    </div>

                    {/* Generate */}
                    <div className="p-4 bg-slate-800/50 rounded-xl">
                      <label className="block text-white font-medium mb-2">Generate</label>
                      <input
                        type="number"
                        value={config.tokenBudgets.generate}
                        onChange={(e) => setConfig({ ...config, tokenBudgets: { ...config.tokenBudgets, generate: parseInt(e.target.value) } })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-1">For creating new content (emails, reports, code, articles). Highest token needs for quality output generation. Use 2500-4000 tokens.</p>
                    </div>

                    {/* Validate */}
                    <div className="p-4 bg-slate-800/50 rounded-xl">
                      <label className="block text-white font-medium mb-2">Validate</label>
                      <input
                        type="number"
                        value={config.tokenBudgets.validate}
                        onChange={(e) => setConfig({ ...config, tokenBudgets: { ...config.tokenBudgets, validate: parseInt(e.target.value) } })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-1">For checking data quality, format validation, business rule verification. Moderate token needs for evaluation logic. Use 1000-1800 tokens.</p>
                    </div>

                    {/* Send */}
                    <div className="p-4 bg-slate-800/50 rounded-xl">
                      <label className="block text-white font-medium mb-2">Send</label>
                      <input
                        type="number"
                        value={config.tokenBudgets.send}
                        onChange={(e) => setConfig({ ...config, tokenBudgets: { ...config.tokenBudgets, send: parseInt(e.target.value) } })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-1">For sending data to APIs, emails, messaging platforms. Lowest token needs as it's mostly formatting. Use 500-800 tokens.</p>
                    </div>

                    {/* Transform */}
                    <div className="p-4 bg-slate-800/50 rounded-xl">
                      <label className="block text-white font-medium mb-2">Transform</label>
                      <input
                        type="number"
                        value={config.tokenBudgets.transform}
                        onChange={(e) => setConfig({ ...config, tokenBudgets: { ...config.tokenBudgets, transform: parseInt(e.target.value) } })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-1">For converting data between formats (JSON to CSV, restructuring objects). Moderate to high token needs for complex transformations. Use 1500-2500 tokens.</p>
                    </div>

                    {/* Conditional */}
                    <div className="p-4 bg-slate-800/50 rounded-xl">
                      <label className="block text-white font-medium mb-2">Conditional</label>
                      <input
                        type="number"
                        value={config.tokenBudgets.conditional}
                        onChange={(e) => setConfig({ ...config, tokenBudgets: { ...config.tokenBudgets, conditional: parseInt(e.target.value) } })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-1">For if/else logic, branching decisions, route selection. Low token needs for boolean evaluation. Use 600-1200 tokens.</p>
                    </div>

                    {/* Aggregate */}
                    <div className="p-4 bg-slate-800/50 rounded-xl">
                      <label className="block text-white font-medium mb-2">Aggregate</label>
                      <input
                        type="number"
                        value={config.tokenBudgets.aggregate}
                        onChange={(e) => setConfig({ ...config, tokenBudgets: { ...config.tokenBudgets, aggregate: parseInt(e.target.value) } })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-1">For combining multiple data sources, calculating sums/averages, merging results. Higher token needs to process multiple inputs. Use 2000-3000 tokens.</p>
                    </div>

                    {/* Filter */}
                    <div className="p-4 bg-slate-800/50 rounded-xl">
                      <label className="block text-white font-medium mb-2">Filter</label>
                      <input
                        type="number"
                        value={config.tokenBudgets.filter}
                        onChange={(e) => setConfig({ ...config, tokenBudgets: { ...config.tokenBudgets, filter: parseInt(e.target.value) } })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-1">For removing unwanted items from datasets based on criteria. Low to moderate token needs for evaluation. Use 800-1500 tokens.</p>
                    </div>

                    {/* Enrich */}
                    <div className="p-4 bg-slate-800/50 rounded-xl">
                      <label className="block text-white font-medium mb-2">Enrich</label>
                      <input
                        type="number"
                        value={config.tokenBudgets.enrich}
                        onChange={(e) => setConfig({ ...config, tokenBudgets: { ...config.tokenBudgets, enrich: parseInt(e.target.value) } })}
                        className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      />
                      <p className="text-xs text-slate-400 mt-1">For adding additional data to existing records (lookup APIs, append metadata, enhance with external sources). Moderate to high token needs. Use 1500-2500 tokens.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </div>

        {/* Save Button (Bottom) */}
        <div className="mt-8 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-xl font-medium hover:shadow-lg hover:shadow-blue-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                Save Configuration
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
