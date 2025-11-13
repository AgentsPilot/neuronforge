'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Database,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  BarChart3,
  Brain,
  Zap,
  Clock,
  Target,
  ChevronUp,
  ChevronDown
} from 'lucide-react';

interface MemoryConfig {
  injection: {
    max_tokens: number;
    min_recent_runs: number;
    max_recent_runs: number;
    semantic_search_limit: number;
    semantic_threshold: number;
  };
  summarization: {
    model: string;
    temperature: number;
    max_tokens: number;
    async: boolean;
    input_truncate_chars: number;
    output_truncate_chars: number;
    recent_history_count: number;
    recent_history_summary_chars: number;
  };
  embedding: {
    model: string;
    batch_size: number;
    dimensions: number;
  };
  importance: {
    base_score: number;
    error_bonus: number;
    pattern_bonus: number;
    user_feedback_bonus: number;
    first_run_bonus: number;
    milestone_bonus: number;
  };
  retention: {
    run_memories_days: number;
    low_importance_days: number;
    consolidation_threshold: number;
    consolidation_frequency_days: number;
  };
}

export default function MemoryConfigPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Section collapse states
  const [injectionExpanded, setInjectionExpanded] = useState(true);
  const [summarizationExpanded, setSummarizationExpanded] = useState(false);
  const [embeddingExpanded, setEmbeddingExpanded] = useState(false);
  const [importanceExpanded, setImportanceExpanded] = useState(false);
  const [retentionExpanded, setRetentionExpanded] = useState(false);

  const [config, setConfig] = useState<MemoryConfig>({
    injection: {
      max_tokens: 4000,
      min_recent_runs: 2,
      max_recent_runs: 5,
      semantic_search_limit: 10,
      semantic_threshold: 0.7
    },
    summarization: {
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 1000,
      async: true,
      input_truncate_chars: 300,
      output_truncate_chars: 400,
      recent_history_count: 2,
      recent_history_summary_chars: 100
    },
    embedding: {
      model: 'text-embedding-3-small',
      batch_size: 100,
      dimensions: 1536
    },
    importance: {
      base_score: 0.5,
      error_bonus: 0.3,
      pattern_bonus: 0.2,
      user_feedback_bonus: 0.4,
      first_run_bonus: 0.1,
      milestone_bonus: 0.15
    },
    retention: {
      run_memories_days: 90,
      low_importance_days: 30,
      consolidation_threshold: 100,
      consolidation_frequency_days: 7
    }
  });

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/admin/memory-config');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch configuration');
      }

      if (data.success && data.config) {
        setConfig(data.config);
      }
    } catch (err) {
      console.error('Error fetching memory config:', err);
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

      const response = await fetch('/api/admin/memory-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save configuration');
      }

      setSuccess('✅ Memory configuration saved successfully!');
      setTimeout(() => setSuccess(null), 5000);
    } catch (err) {
      console.error('Error saving memory config:', err);
      setError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mx-auto mb-4" />
          <p className="text-slate-300">Loading memory configuration...</p>
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
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center">
              <Database className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">Memory Configuration</h1>
              <p className="text-slate-400">Configure memory system settings and policies</p>
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

        {/* Save Button (Top) */}
        <div className="mb-6 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-600 text-white rounded-xl font-medium hover:shadow-lg hover:shadow-purple-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
          {/* Section 1: Injection Configuration */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden"
          >
            <button
              onClick={() => setInjectionExpanded(!injectionExpanded)}
              className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Zap className="w-6 h-6 text-yellow-400" />
                <div className="text-left">
                  <h3 className="text-xl font-bold text-white">Injection Configuration</h3>
                  <p className="text-sm text-slate-400">Control how memories are injected into prompts</p>
                </div>
              </div>
              {injectionExpanded ? (
                <ChevronUp className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {injectionExpanded && (
              <div className="p-6 border-t border-white/10 space-y-4">
                {/* Info Box */}
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
                  <p className="text-sm text-yellow-300 mb-2">
                    <strong>What is Memory Injection?</strong> Memory injection is the process of retrieving relevant past experiences (previous agent runs, workflow results, user interactions) and adding them to the current prompt context. This enables agents to learn from past successes/failures, avoid repeating mistakes, and provide contextual responses.
                  </p>
                  <p className="text-xs text-yellow-200 mb-2">
                    <strong>How it works:</strong> When an agent starts, the system searches for semantically similar past runs (using embeddings), retrieves the most recent runs, and injects selected memories into the prompt. The injection is controlled by token budgets to balance context quality vs. cost.
                  </p>
                  <p className="text-xs text-yellow-200">
                    💡 <strong>Optimization Strategy:</strong> Higher token limits provide more context but increase costs. Balance semantic search (quality) with recent runs (recency) for optimal results.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-white font-medium mb-2">Max Tokens</label>
                    <input
                      type="number"
                      value={config.injection.max_tokens}
                      onChange={(e) => setConfig({
                        ...config,
                        injection: { ...config.injection, max_tokens: parseInt(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Maximum total tokens to inject from memory system into each agent prompt. Controls the token budget for all memory content (recent runs + semantic search results). Higher values provide more historical context but increase prompt costs and latency. Recommended: 4000 for standard agents (allows 3-5 memory entries), 8000 for context-heavy workflows, 2000 for cost-sensitive simple tasks. If agents frequently lack needed context, increase this limit.</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Semantic Search Limit</label>
                    <input
                      type="number"
                      value={config.injection.semantic_search_limit}
                      onChange={(e) => setConfig({
                        ...config,
                        injection: { ...config.injection, semantic_search_limit: parseInt(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Maximum number of semantically similar memories to retrieve using vector search. System searches embedding database for past runs with similar context/intent. More results = better chance of finding relevant patterns but higher computational cost. Recommended: 10 for standard balance, 20 for comprehensive context, 5 for fast/simple operations. Results are filtered by semantic threshold before injection.</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Min Recent Runs</label>
                    <input
                      type="number"
                      value={config.injection.min_recent_runs}
                      onChange={(e) => setConfig({
                        ...config,
                        injection: { ...config.injection, min_recent_runs: parseInt(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Minimum number of most recent agent runs to always include, regardless of semantic similarity. Ensures agent always has awareness of immediate recent history (last few executions). Prevents "amnesia" where agent forgets very recent context. Recommended: 2 for minimal recency awareness, 3-5 for continuous context, 0 to rely purely on semantic search (not recommended).</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Max Recent Runs</label>
                    <input
                      type="number"
                      value={config.injection.max_recent_runs}
                      onChange={(e) => setConfig({
                        ...config,
                        injection: { ...config.injection, max_recent_runs: parseInt(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Maximum number of recent runs to inject. Caps how many of the most recent executions are included in memory context. Prevents token budget exhaustion on recent runs alone, leaving room for semantic search results. Recommended: 5 for standard workflows (last 5 runs), 10 for highly sequential operations, 3 for cost-efficient operations. Should be >= Min Recent Runs.</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Semantic Threshold</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={config.injection.semantic_threshold}
                      onChange={(e) => setConfig({
                        ...config,
                        injection: { ...config.injection, semantic_threshold: parseFloat(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Minimum cosine similarity score (0.0-1.0) required for a memory to be injected via semantic search. Only memories scoring above this threshold are considered relevant. Higher values = stricter relevance filtering (fewer but more relevant memories). Lower values = more permissive (more memories but some may be tangential). Recommended: 0.7 for balanced relevance, 0.8-0.9 for strict precision, 0.5-0.6 for broad recall. 1.0 = exact match only (too strict), 0.0 = no filtering (not useful).</p>
                  </div>
                </div>
              </div>
            )}
          </motion.div>

          {/* Section 2: Summarization Configuration */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden"
          >
            <button
              onClick={() => setSummarizationExpanded(!summarizationExpanded)}
              className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Brain className="w-6 h-6 text-blue-400" />
                <div className="text-left">
                  <h3 className="text-xl font-bold text-white">Summarization Configuration</h3>
                  <p className="text-sm text-slate-400">Configure memory summarization model and parameters</p>
                </div>
              </div>
              {summarizationExpanded ? (
                <ChevronUp className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {summarizationExpanded && (
              <div className="p-6 border-t border-white/10 space-y-4">
                {/* Info Box */}
                <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                  <p className="text-sm text-blue-300 mb-2">
                    <strong>What is Memory Summarization?</strong> Summarization condenses lengthy agent execution logs (tool calls, outputs, reasoning) into concise summaries before storing in memory. This dramatically reduces storage costs and enables faster retrieval while preserving key information.
                  </p>
                  <p className="text-xs text-blue-200 mb-2">
                    <strong>When it runs:</strong> After each agent execution completes, the full execution log is sent to the summarization model to extract key learnings, outcomes, errors, and patterns. The summary (typically 100-500 tokens) is stored instead of the full log (which could be 10,000+ tokens).
                  </p>
                  <p className="text-xs text-blue-200">
                    💡 <strong>Cost Optimization:</strong> Using gpt-4o-mini for summarization reduces storage/retrieval costs by 80-95% compared to storing full logs. Async mode prevents summarization from blocking agent responses.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-white font-medium mb-2">Model</label>
                    <select
                      value={config.summarization.model}
                      onChange={(e) => setConfig({
                        ...config,
                        summarization: { ...config.summarization, model: e.target.value }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer"
                    >
                      <optgroup label="Claude Models">
                        <option value="claude-3-haiku-20240307">Claude 3 Haiku (Fastest, Good Quality)</option>
                        <option value="claude-3-5-haiku-20241022">Claude 3.5 Haiku (Fast & Smart)</option>
                        <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet (Highest Quality)</option>
                      </optgroup>
                      <optgroup label="OpenAI Models">
                        <option value="gpt-4o-mini">GPT-4o Mini (Best Cost/Quality)</option>
                        <option value="gpt-4o">GPT-4o (Premium Quality)</option>
                        <option value="gpt-3.5-turbo">GPT-3.5 Turbo (Legacy, Cheapest)</option>
                      </optgroup>
                    </select>
                    <p className="text-xs text-slate-400 mt-1">AI model used to generate memory summaries from full execution logs. Needs strong comprehension and conciseness. Recommended: gpt-4o-mini for excellent quality at low cost (80% cheaper than gpt-4o), claude-3-haiku for fastest processing, gpt-4o-mini is the sweet spot. This model processes potentially thousands of summarizations per day, so cost matters significantly.</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Temperature</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={config.summarization.temperature}
                      onChange={(e) => setConfig({
                        ...config,
                        summarization: { ...config.summarization, temperature: parseFloat(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Controls creativity vs determinism in summaries (0.0-2.0). For summarization, lower temperatures produce consistent, fact-focused summaries. Higher temperatures add variation but risk introducing interpretation. Recommended: 0.3 for balanced factual summaries with slight natural language variation, 0.0-0.2 for strict factual extraction (may feel robotic), 0.4-0.6 only if you want more narrative/interpretive summaries. Summarization should be consistent, so keep this low.</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Max Tokens</label>
                    <input
                      type="number"
                      value={config.summarization.max_tokens}
                      onChange={(e) => setConfig({
                        ...config,
                        summarization: { ...config.summarization, max_tokens: parseInt(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Maximum length of generated summary in tokens. Limits how verbose the summary can be. Shorter summaries save storage and retrieval costs but may lose detail. Longer summaries preserve more context but reduce the number of memories that fit within injection token budget. Recommended: 1000 for comprehensive summaries (3-4 paragraphs), 500 for concise summaries (1-2 paragraphs), 2000 for complex workflows requiring detailed context. Balance storage cost vs. information preservation.</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Input Truncate (chars)</label>
                    <input
                      type="number"
                      value={config.summarization.input_truncate_chars}
                      onChange={(e) => setConfig({
                        ...config,
                        summarization: { ...config.summarization, input_truncate_chars: parseInt(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Maximum characters of execution INPUT to include in summarization prompt. Limits how much of the agent's input data (user query, form data, etc.) is sent to the summarization LLM. Lower values reduce token costs but may lose context. Recommended: 300 for concise context (saves tokens), 500 for balanced context, 200 for minimal context. This directly affects memory token usage (1 char ≈ 0.25 tokens).</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Output Truncate (chars)</label>
                    <input
                      type="number"
                      value={config.summarization.output_truncate_chars}
                      onChange={(e) => setConfig({
                        ...config,
                        summarization: { ...config.summarization, output_truncate_chars: parseInt(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Maximum characters of execution OUTPUT to include in summarization prompt. Limits how much of the agent's result data is sent to the summarization LLM. Lower values significantly reduce token costs (output is usually much larger than input). Recommended: 400 for balanced summary quality, 600 for detailed context, 200 for aggressive token savings. Output often contains full email content or large JSON responses, so this is critical for token optimization.</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Recent History Count</label>
                    <input
                      type="number"
                      value={config.summarization.recent_history_count}
                      onChange={(e) => setConfig({
                        ...config,
                        summarization: { ...config.summarization, recent_history_count: parseInt(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      min="0"
                      max="5"
                    />
                    <p className="text-xs text-slate-400 mt-1">Number of recent execution summaries to include in memory prompt for comparison. More history provides better context for pattern detection but significantly increases token usage. Each summary adds ~100-200 tokens. Recommended: 2 for optimal token savings, 3-5 for better pattern detection. Use 0 to disable history (saves ~200-800 tokens).</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">History Summary Truncate (chars)</label>
                    <input
                      type="number"
                      value={config.summarization.recent_history_summary_chars}
                      onChange={(e) => setConfig({
                        ...config,
                        summarization: { ...config.summarization, recent_history_summary_chars: parseInt(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Maximum characters of each historical summary to include. Truncates long summaries to save tokens while preserving key context. Lower values reduce memory token usage proportionally. Recommended: 100 for concise history (saves ~400-600 tokens), 200 for detailed history, 50 for aggressive savings. Works with Recent History Count to control total history token cost.</p>
                  </div>

                  <div className="md:col-span-2">
                    <label className="flex items-center gap-3 p-4 bg-slate-800/50 rounded-xl cursor-pointer hover:bg-slate-800 transition-colors">
                      <input
                        type="checkbox"
                        checked={config.summarization.async}
                        onChange={(e) => setConfig({
                          ...config,
                          summarization: { ...config.summarization, async: e.target.checked }
                        })}
                        className="w-5 h-5 text-blue-500 rounded focus:ring-2 focus:ring-blue-500"
                      />
                      <div>
                        <p className="text-white font-medium">Async Mode</p>
                        <p className="text-xs text-slate-400 mt-1">Process summarization in background without blocking agent response. When enabled, summarization happens after agent completes and user receives response (non-blocking). When disabled, agent waits for summarization to complete before responding (adds 2-5 seconds latency). Recommended: Enabled for production (better UX), disabled only for debugging if you need to verify summaries immediately. Async summarization improves response times significantly.</p>
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </motion.div>

          {/* Section 3: Embedding Configuration */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden"
          >
            <button
              onClick={() => setEmbeddingExpanded(!embeddingExpanded)}
              className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Database className="w-6 h-6 text-green-400" />
                <div className="text-left">
                  <h3 className="text-xl font-bold text-white">Embedding Configuration</h3>
                  <p className="text-sm text-slate-400">Configure embedding model and batch processing</p>
                </div>
              </div>
              {embeddingExpanded ? (
                <ChevronUp className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {embeddingExpanded && (
              <div className="p-6 border-t border-white/10 space-y-4">
                {/* Info Box */}
                <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-xl">
                  <p className="text-sm text-green-300 mb-2">
                    <strong>What are Embeddings?</strong> Embeddings convert text (memory summaries, prompts) into high-dimensional vectors that capture semantic meaning. This enables semantic search: finding memories conceptually similar to the current task, even if they use different words.
                  </p>
                  <p className="text-xs text-green-200 mb-2">
                    <strong>How it works:</strong> Each memory summary is embedded into a 1536-dimensional vector and stored in a vector database (pgvector). When retrieving memories, the current prompt is embedded and vector similarity search finds the most semantically relevant past experiences.
                  </p>
                  <p className="text-xs text-green-200">
                    💡 <strong>Performance Tip:</strong> Batch processing significantly reduces API costs. Process 100 embeddings at once instead of one-by-one to reduce overhead by 90%+.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-white font-medium mb-2">Model</label>
                    <select
                      value={config.embedding.model}
                      onChange={(e) => setConfig({
                        ...config,
                        embedding: { ...config.embedding, model: e.target.value }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent cursor-pointer"
                    >
                      <optgroup label="OpenAI Embeddings (Recommended)">
                        <option value="text-embedding-3-small">text-embedding-3-small (1536 dims, Best Cost/Quality)</option>
                        <option value="text-embedding-3-large">text-embedding-3-large (3072 dims, Highest Quality)</option>
                        <option value="text-embedding-ada-002">text-embedding-ada-002 (1536 dims, Legacy)</option>
                      </optgroup>
                    </select>
                    <p className="text-xs text-slate-400 mt-1">Embedding model used to convert text to vectors for semantic search. Must match across all memories for accurate similarity calculations. Recommended: text-embedding-3-small (1536 dims, excellent quality, 5x cheaper than ada-002), text-embedding-3-large (3072 dims, highest quality but 2x cost), text-embedding-ada-002 (legacy, deprecated). OpenAI's text-embedding-3-small is the industry standard for cost/quality balance.</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Batch Size</label>
                    <input
                      type="number"
                      value={config.embedding.batch_size}
                      onChange={(e) => setConfig({
                        ...config,
                        embedding: { ...config.embedding, batch_size: parseInt(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Number of texts to embed in a single API call. Batching dramatically reduces costs and latency (1 API call for 100 items vs. 100 separate calls). Higher batch sizes improve throughput but increase memory usage and risk timeout on slow connections. Recommended: 100 for standard processing (optimal cost/speed), 50 for rate-limited scenarios, 200+ for bulk operations with good infrastructure. OpenAI supports up to 2048 per batch.</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Dimensions</label>
                    <input
                      type="number"
                      value={config.embedding.dimensions}
                      onChange={(e) => setConfig({
                        ...config,
                        embedding: { ...config.embedding, dimensions: parseInt(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Vector dimensionality for embeddings. Higher dimensions capture more nuance but increase storage/compute costs. Must match the selected embedding model's output size. Common values: 1536 (text-embedding-3-small, text-embedding-ada-002), 3072 (text-embedding-3-large), 768 (older models). CRITICAL: Changing this requires re-embedding ALL existing memories. Don't modify unless migrating embedding models.</p>
                  </div>
                </div>
              </div>
            )}
          </motion.div>

          {/* Section 4: Importance Scoring */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden"
          >
            <button
              onClick={() => setImportanceExpanded(!importanceExpanded)}
              className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Target className="w-6 h-6 text-orange-400" />
                <div className="text-left">
                  <h3 className="text-xl font-bold text-white">Importance Scoring</h3>
                  <p className="text-sm text-slate-400">Configure importance score weights and bonuses</p>
                </div>
              </div>
              {importanceExpanded ? (
                <ChevronUp className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {importanceExpanded && (
              <div className="p-6 border-t border-white/10 space-y-4">
                {/* Info Box */}
                <div className="p-4 bg-orange-500/10 border border-orange-500/30 rounded-xl">
                  <p className="text-sm text-orange-300 mb-2">
                    <strong>What is Importance Scoring?</strong> Importance scoring ranks memories by their value for future learning. Higher-scored memories are prioritized during retention, retrieval, and consolidation. This ensures critical learnings (errors, patterns, breakthroughs) are preserved while routine operations can be cleaned up.
                  </p>
                  <p className="text-xs text-orange-200 mb-2">
                    <strong>How scoring works:</strong> Each memory starts with the Base Score. Bonuses are added for special characteristics: errors (failures to learn from), patterns (repeated behaviors to detect), user feedback (explicitly valuable), first runs (novel discoveries), and milestones (achievements). Final score determines retention priority.
                  </p>
                  <p className="text-xs text-orange-200">
                    💡 <strong>Tuning Strategy:</strong> Higher bonuses emphasize that type of learning. Error Bonus 0.3 means failures get 0.3 added to their importance, making them 60% more likely to be retained (0.5 base + 0.3 = 0.8 total).
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-white font-medium mb-2">Base Score</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={config.importance.base_score}
                      onChange={(e) => setConfig({
                        ...config,
                        importance: { ...config.importance, base_score: parseFloat(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Starting importance score for all memories before bonuses (0.0-1.0). All memories begin at this baseline, then bonuses are added based on characteristics. Lower base = more aggressive filtering (only special memories kept). Higher base = more permissive retention. Recommended: 0.5 for balanced retention (middle importance), 0.3 for aggressive cleanup (only keep valuable memories), 0.7 for permissive retention (keep most things). Scores above 0.7 with bonuses may exceed 1.0 (that's fine, scores can go higher).</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Error Bonus</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={config.importance.error_bonus}
                      onChange={(e) => setConfig({
                        ...config,
                        importance: { ...config.importance, error_bonus: parseFloat(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Importance boost for memories containing errors, failures, or exceptions. Errors are highly valuable for learning (agents should remember what NOT to do). Higher values prioritize error retention more aggressively. Recommended: 0.3 for significant boost (errors are valuable), 0.5 for very high priority (never delete error memories), 0.1 for minimal boost (errors aren't special). Error memories help agents avoid repeating mistakes.</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Pattern Bonus</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={config.importance.pattern_bonus}
                      onChange={(e) => setConfig({
                        ...config,
                        importance: { ...config.importance, pattern_bonus: parseFloat(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Importance boost for memories that match detected patterns (recurring workflows, repeated tool sequences, common user requests). Pattern recognition enables agents to optimize frequently-used behaviors. Recommended: 0.2 for moderate pattern emphasis, 0.4 for strong pattern learning, 0.1 for minimal pattern retention. Higher values help agents become more efficient at repetitive tasks.</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">User Feedback Bonus</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={config.importance.user_feedback_bonus}
                      onChange={(e) => setConfig({
                        ...config,
                        importance: { ...config.importance, user_feedback_bonus: parseFloat(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Importance boost for memories with explicit user feedback (thumbs up/down, ratings, comments). User feedback is the strongest signal of value - if a human said it was good/bad, prioritize that learning. Recommended: 0.4 for high priority (user knows best), 0.6 for very high priority (almost never delete user-marked memories), 0.2 for moderate boost. User feedback directly shapes agent behavior.</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">First Run Bonus</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={config.importance.first_run_bonus}
                      onChange={(e) => setConfig({
                        ...config,
                        importance: { ...config.importance, first_run_bonus: parseFloat(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Importance boost for the first occurrence of a new pattern or workflow type. First-time discoveries are valuable for establishing baselines and detecting new behaviors. Recommended: 0.1 for modest boost (firsts are slightly special), 0.2 for moderate boost, 0.0 to ignore first-time status. Helps track when agents encounter novel situations.</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Milestone Bonus</label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={config.importance.milestone_bonus}
                      onChange={(e) => setConfig({
                        ...config,
                        importance: { ...config.importance, milestone_bonus: parseFloat(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Importance boost for milestone achievements (completing a complex workflow for the first time, handling a large dataset, achieving a performance threshold). Milestones mark significant progress events worth remembering. Recommended: 0.15 for moderate boost, 0.3 for high boost (preserve major achievements), 0.05 for minimal boost. Helps track agent capability evolution over time.</p>
                  </div>
                </div>
              </div>
            )}
          </motion.div>

          {/* Section 5: Retention Policy */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-2xl overflow-hidden"
          >
            <button
              onClick={() => setRetentionExpanded(!retentionExpanded)}
              className="w-full p-6 flex items-center justify-between hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Clock className="w-6 h-6 text-purple-400" />
                <div className="text-left">
                  <h3 className="text-xl font-bold text-white">Retention Policy</h3>
                  <p className="text-sm text-slate-400">Configure memory retention and consolidation</p>
                </div>
              </div>
              {retentionExpanded ? (
                <ChevronUp className="w-5 h-5 text-slate-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-slate-400" />
              )}
            </button>

            {retentionExpanded && (
              <div className="p-6 border-t border-white/10 space-y-4">
                {/* Info Box */}
                <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-xl">
                  <p className="text-sm text-purple-300 mb-2">
                    <strong>What is Memory Retention?</strong> Retention policies control how long memories are kept before cleanup and when similar memories are consolidated. This prevents database bloat while preserving important historical context.
                  </p>
                  <p className="text-xs text-purple-200 mb-2">
                    <strong>How retention works:</strong> Memories are kept for different durations based on importance scores. High-importance memories (errors, user feedback) are retained longer. Low-importance memories are cleaned up aggressively. Consolidation merges similar memories into summaries to save storage while preserving patterns.
                  </p>
                  <p className="text-xs text-purple-200">
                    💡 <strong>Storage Impact:</strong> Longer retention = better historical context but higher storage costs. Weekly consolidation with 90-day retention typically manages 10,000-50,000 memories efficiently.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-white font-medium mb-2">Run Memories Days</label>
                    <input
                      type="number"
                      value={config.retention.run_memories_days}
                      onChange={(e) => setConfig({
                        ...config,
                        retention: { ...config.retention, run_memories_days: parseInt(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Maximum days to retain agent run memories regardless of importance score. After this period, ALL memories (even high-importance) are eligible for deletion or consolidation. Acts as absolute upper bound on memory retention. Recommended: 90 days for balanced retention (3 months of history), 180 days for long-term learning (6 months), 30 days for aggressive cleanup. Longer retention enables agents to learn from seasonal patterns but increases storage costs. Critical memories (errors, user feedback) may be preserved longer via consolidation.</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Low Importance Days</label>
                    <input
                      type="number"
                      value={config.retention.low_importance_days}
                      onChange={(e) => setConfig({
                        ...config,
                        retention: { ...config.retention, low_importance_days: parseInt(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Days to retain memories with low importance scores (typically below 0.5-0.6). Low-importance memories are routine operations without errors, patterns, or user feedback. Aggressive cleanup of these saves storage for valuable memories. Recommended: 30 days for standard cleanup, 7 days for very aggressive cleanup (only keep recent routine operations), 60 days for permissive retention. Much shorter than Run Memories Days because low-value memories don't need long-term preservation.</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Consolidation Threshold</label>
                    <input
                      type="number"
                      value={config.retention.consolidation_threshold}
                      onChange={(e) => setConfig({
                        ...config,
                        retention: { ...config.retention, consolidation_threshold: parseInt(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">Minimum number of semantically similar memories required to trigger consolidation. When this many similar memories accumulate, they're merged into a pattern summary. Prevents premature consolidation (need enough examples to extract meaningful patterns). Recommended: 100 for robust pattern detection (wait for clear patterns), 50 for faster consolidation (more aggressive), 200 for very conservative consolidation (only consolidate well-established patterns). Higher thresholds = better pattern quality but slower consolidation.</p>
                  </div>

                  <div>
                    <label className="block text-white font-medium mb-2">Consolidation Frequency (Days)</label>
                    <input
                      type="number"
                      value={config.retention.consolidation_frequency_days}
                      onChange={(e) => setConfig({
                        ...config,
                        retention: { ...config.retention, consolidation_frequency_days: parseInt(e.target.value) }
                      })}
                      className="w-full px-4 py-2 bg-slate-800 text-white border border-slate-700 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    <p className="text-xs text-slate-400 mt-1">How often (in days) to run the memory consolidation process. Consolidation is computationally expensive (requires embedding similarity search + LLM summarization), so it runs periodically rather than continuously. Recommended: 7 days (weekly) for balanced processing, 1 day (daily) for high-volume systems needing frequent cleanup, 14 days (biweekly) for low-volume systems or to reduce computational costs. More frequent consolidation keeps memory database leaner but increases processing overhead.</p>
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
            className="px-6 py-3 bg-gradient-to-r from-purple-500 to-blue-600 text-white rounded-xl font-medium hover:shadow-lg hover:shadow-purple-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
