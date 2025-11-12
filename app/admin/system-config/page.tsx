'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Settings,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  DollarSign,
  Zap,
  Sliders,
  Database,
  Edit,
  X,
  Check,
  Download,
  ChevronUp,
  ChevronDown,
  Brain,
  Clock,
  CreditCard,
  Cpu
} from 'lucide-react';

interface SystemSetting {
  id: string;
  key: string;
  value: any;
  category: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

interface ModelPricing {
  id: string;
  provider: string;
  model_name: string;
  input_cost_per_token: number;
  output_cost_per_token: number;
  effective_date: string;
}

export default function SystemConfigPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [pricingModels, setPricingModels] = useState<ModelPricing[]>([]);

  // Pricing editing state
  const [editingPricing, setEditingPricing] = useState<string | null>(null);
  const [editedInputCost, setEditedInputCost] = useState<number>(0);
  const [editedOutputCost, setEditedOutputCost] = useState<number>(0);

  // Collapse state for sections (all collapsed by default)
  const [pricingExpanded, setPricingExpanded] = useState(false);
  const [calcExpanded, setCalcExpanded] = useState(false);
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [billingExpanded, setBillingExpanded] = useState(false);

  // Billing configuration state (loaded from database)
  const [billingConfig, setBillingConfig] = useState({
    paymentGracePeriodDays: 3
  });

  // Boost pack management state
  interface BoostPack {
    id?: string;
    pack_key: string;
    pack_name: string;
    display_name: string;
    description: string;
    price_usd: number;
    bonus_percentage: number;
    credits_amount: number;
    bonus_credits: number;
    badge_text: string | null;
    is_active: boolean;
  }

  const [boostPacks, setBoostPacks] = useState<BoostPack[]>([]);
  const [editingBoostPack, setEditingBoostPack] = useState<string | null>(null);
  const [deletingBoostPack, setDeletingBoostPack] = useState<string | null>(null);
  const [newBoostPack, setNewBoostPack] = useState<BoostPack>({
    pack_key: '',
    pack_name: '',
    display_name: '',
    description: '',
    price_usd: 10,
    bonus_percentage: 0,
    credits_amount: 0,
    bonus_credits: 0,
    badge_text: null,
    is_active: true
  });
  const [showAddBoostPack, setShowAddBoostPack] = useState(false);
  const [pilotCreditCostUsd, setPilotCreditCostUsd] = useState(0.00048);

  // Calculator configuration state (loaded from database)
  const [calcConfig, setCalcConfig] = useState({
    // Token estimation
    baseTokens: 0,
    tokensPerPlugin: 0,
    peakMultiplier: 0,
    pluginUsageRate: 0,
    orchestrationOverheadMs: 0,
    estimatedDurationMs: 0,
    estimatedFailureRate: 0,
    estimatedRetryRate: 0,
    ioRatio: 0,
    // Execution parameters
    baseIterations: 0,
    maxIterations: 0,
    // Pricing parameters
    runsPerAgentPerMonth: 0,
    agentCreationCost: 0,
    creditCostUsd: 0,
    minimumMonthlyCostUsd: 0,
    baseCreditsPerRun: 0,
    pluginOverheadPerRun: 0,
    systemOverheadPerRun: 0,
    executionStepMultiplier: 0,
    freeTierCredits: 0
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async (silent = false) => {
    try {
      if (!silent) {
        setLoading(true);
      }
      setError(null);

      // Fetch system settings
      const settingsResponse = await fetch('/api/admin/system-config', {
        method: 'GET',
        cache: 'no-store'
      });

      console.log('[SystemConfig] API response status:', settingsResponse.status);

      if (!settingsResponse.ok) {
        const errorText = await settingsResponse.text();
        console.error('[SystemConfig] API error response:', errorText);
        throw new Error(`Failed to fetch system settings: ${settingsResponse.status} ${errorText}`);
      }

      const settingsResult = await settingsResponse.json();
      console.log('[SystemConfig] Settings result:', settingsResult);

      if (!settingsResult.success) {
        throw new Error(settingsResult.error || 'API returned unsuccessful response');
      }

      // Parse billing settings
      const billingSettings = settingsResult.data.filter((s: SystemSetting) => s.category === 'billing');
      billingSettings.forEach((setting: SystemSetting) => {
        if (setting.key === 'payment_grace_period_days') {
          setBillingConfig({ paymentGracePeriodDays: parseInt(setting.value as string) || 3 });
        }
        if (setting.key === 'pilot_credit_cost_usd') {
          setPilotCreditCostUsd(parseFloat(setting.value as string) || 0.00048);
        }
      });

      // Fetch boost packs
      try {
        const boostPacksResponse = await fetch('/api/admin/boost-packs', {
          method: 'GET',
          cache: 'no-store'
        });

        if (boostPacksResponse.ok) {
          const boostPacksResult = await boostPacksResponse.json();
          if (boostPacksResult.success) {
            setBoostPacks(boostPacksResult.data);
          }
        }
      } catch (boostPacksError) {
        console.error('Failed to fetch boost packs:', boostPacksError);
      }

      // Fetch AI model pricing
      try {
        const pricingResponse = await fetch('/api/admin/system-config/pricing', {
          method: 'GET',
          cache: 'no-store'
        });

        if (!pricingResponse.ok) {
          console.error('Pricing API error:', pricingResponse.status, pricingResponse.statusText);
          const errorText = await pricingResponse.text();
          console.error('Pricing API response:', errorText);
        } else {
          const pricingResult = await pricingResponse.json();
          console.log('Pricing API result:', pricingResult);

          if (pricingResult.success) {
            setPricingModels(pricingResult.data);
            console.log('Loaded pricing models:', pricingResult.data.length);
          } else {
            console.error('Pricing API returned unsuccessful:', pricingResult.error);
          }
        }
      } catch (pricingError) {
        console.error('Failed to fetch pricing:', pricingError);
        // Don't fail the entire page if pricing fails - it's supplementary data
      }

      // Fetch calculator configuration
      try {
        const calcResponse = await fetch('/api/pricing/config', {
          method: 'GET',
          cache: 'no-store'
        });

        if (calcResponse.ok) {
          const calcResult = await calcResponse.json();
          console.log('Calculator config result:', calcResult);

          if (calcResult.success && calcResult.config) {
            const c = calcResult.config;
            setCalcConfig({
              // Token estimation
              baseTokens: c.calculatorEstimation?.baseTokens ?? 0,
              tokensPerPlugin: c.calculatorEstimation?.tokensPerPlugin ?? 0,
              peakMultiplier: c.calculatorEstimation?.peakMultiplier ?? 0,
              pluginUsageRate: c.calculatorEstimation?.pluginUsageRate ?? 0,
              orchestrationOverheadMs: c.calculatorEstimation?.orchestrationOverheadMs ?? 0,
              estimatedDurationMs: c.calculatorEstimation?.estimatedDurationMs ?? 0,
              estimatedFailureRate: c.calculatorEstimation?.estimatedFailureRate ?? 0,
              estimatedRetryRate: c.calculatorEstimation?.estimatedRetryRate ?? 0,
              ioRatio: c.calculatorEstimation?.ioRatio ?? 0,
              // Execution parameters
              baseIterations: c.calculatorEstimation?.baseIterations ?? 0,
              maxIterations: c.calculatorEstimation?.maxIterations ?? 0,
              // Pricing parameters
              runsPerAgentPerMonth: c.runsPerAgentPerMonth ?? 0,
              agentCreationCost: c.agentCreationCost ?? 0,
              creditCostUsd: c.creditCostUsd ?? 0,
              minimumMonthlyCostUsd: c.minimumMonthlyCostUsd ?? 0,
              baseCreditsPerRun: c.baseCreditsPerRun ?? 0,
              pluginOverheadPerRun: c.pluginOverheadPerRun ?? 0,
              systemOverheadPerRun: c.systemOverheadPerRun ?? 0,
              executionStepMultiplier: c.executionStepMultiplier ?? 0,
              freeTierCredits: c.freeTierCredits ?? 0
            });
            console.log('Loaded calculator config:', calcResult.config);
          }
        }
      } catch (calcError) {
        console.error('Failed to fetch calculator config:', calcError);
      }

    } catch (error) {
      console.error('Error fetching data:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const handleEditPricing = (model: ModelPricing) => {
    setEditingPricing(model.id);
    setEditedInputCost(model.input_cost_per_token);
    setEditedOutputCost(model.output_cost_per_token);
  };

  const handleCancelEditPricing = () => {
    setEditingPricing(null);
    setEditedInputCost(0);
    setEditedOutputCost(0);
  };

  const handleSavePricing = async (modelId: string) => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/admin/system-config/pricing', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: modelId,
          input_cost_per_token: editedInputCost,
          output_cost_per_token: editedOutputCost
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update pricing');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to update pricing');
      }

      setSuccess('Pricing updated successfully!');
      setEditingPricing(null);

      // Note: Don't refresh data after save - local state already has updated values

      setTimeout(() => setSuccess(null), 3000);

    } catch (error) {
      console.error('Error updating pricing:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncPricing = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/admin/system-config/pricing/sync', {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error('Failed to sync pricing');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to sync pricing');
      }

      setSuccess(result.message || 'Pricing synced successfully!');

      // Refresh pricing data after sync since it fetches from external API
      await fetchData(true);

      setTimeout(() => setSuccess(null), 5000);

    } catch (error) {
      console.error('Error syncing pricing:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCalculatorConfig = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/admin/calculator-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: calcConfig })
      });

      if (!response.ok) {
        throw new Error('Failed to update calculator configuration');
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || 'Failed to update calculator configuration');
      }

      setSuccess('Calculator configuration saved successfully!');

      // Note: Don't refresh data after save because:
      // 1. Local state already has the updated values
      // 2. Database view (calculator_config) may have caching delays
      // 3. Refreshing would overwrite user's changes with potentially stale view data

      setTimeout(() => setSuccess(null), 3000);
    } catch (error) {
      console.error('Error saving calculator config:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBillingConfig = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const updates = {
        payment_grace_period_days: billingConfig.paymentGracePeriodDays
      };

      const response = await fetch('/api/admin/system-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ updates })
      });

      if (!response.ok) {
        throw new Error('Failed to update billing configuration');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to update billing configuration');
      }

      setSuccess('Billing configuration saved successfully!');

      setTimeout(() => setSuccess(null), 3000);

    } catch (error) {
      console.error('Error saving billing configuration:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  // Boost pack management functions
  const calculateBoostPackCredits = (price_usd: number, bonus_percentage: number) => {
    const baseCredits = Math.round(price_usd / pilotCreditCostUsd);
    const bonusCredits = Math.round(baseCredits * (bonus_percentage / 100));
    return { baseCredits, bonusCredits };
  };

  const handleSaveBoostPack = async (pack: BoostPack) => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      // Calculate credits before saving
      const { baseCredits, bonusCredits } = calculateBoostPackCredits(pack.price_usd, pack.bonus_percentage);

      const packToSave = {
        ...pack,
        credits_amount: baseCredits,
        bonus_credits: bonusCredits
      };

      const response = await fetch('/api/admin/boost-packs', {
        method: pack.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(packToSave)
      });

      if (!response.ok) {
        throw new Error('Failed to save boost pack');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to save boost pack');
      }

      setSuccess(`Boost pack "${pack.pack_name}" saved successfully!`);
      setEditingBoostPack(null);
      setShowAddBoostPack(false);

      // Refresh boost packs
      await fetchData(true);

      setTimeout(() => setSuccess(null), 3000);

    } catch (error) {
      console.error('Error saving boost pack:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteBoostPack = async (packId: string) => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const response = await fetch('/api/admin/boost-packs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: packId })
      });

      if (!response.ok) {
        throw new Error('Failed to delete boost pack');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to delete boost pack');
      }

      setSuccess('Boost pack deleted successfully!');
      setDeletingBoostPack(null);

      // Refresh boost packs
      await fetchData(true);

      setTimeout(() => setSuccess(null), 3000);

    } catch (error) {
      console.error('Error deleting boost pack:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  const formatCost = (cost: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 8,
      maximumFractionDigits: 8
    }).format(cost);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-400">Loading configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-green-400" />
            Pricing & Billing Configuration
          </h1>
          <p className="text-slate-400">Manage AI model pricing, billing settings, boost packs, and cost calculator parameters</p>
        </div>

        <button
          onClick={() => fetchData()}
          disabled={loading}
          className="p-2 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Success/Error Messages */}
      {success && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-green-500/10 border border-green-500/50 rounded-lg p-4 flex items-center gap-3"
        >
          <CheckCircle className="w-5 h-5 text-green-400" />
          <p className="text-green-400">{success}</p>
        </motion.div>
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 flex items-center gap-3"
        >
          <AlertCircle className="w-5 h-5 text-red-400" />
          <p className="text-red-400">{error}</p>
        </motion.div>
      )}

      {/* AI Model Pricing Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-400" />
                AI Model Pricing
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Token costs for all AI models. Sync to get latest pricing from providers.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSyncPricing}
                disabled={saving}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    Sync Latest Pricing
                  </>
                )}
              </button>
              <button
                onClick={() => setPricingExpanded(!pricingExpanded)}
                className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
              >
                {pricingExpanded ? (
                  <ChevronUp className="w-4 h-4 text-slate-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400" />
                )}
              </button>
            </div>
          </div>
        </div>

        {pricingExpanded && (
          <div className="p-6 space-y-4">
            {/* Info Box */}
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <DollarSign className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-3">
                  <p className="text-green-400 font-medium text-sm">About Model Pricing</p>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    This table defines the cost per token for each AI model's input (prompts) and output (responses). These prices directly impact cost calculations, billing, and intelligent routing decisions. Accurate pricing ensures reliable cost estimates and optimal model selection.
                  </p>
                  <div className="space-y-2 text-xs leading-relaxed">
                    <p className="text-slate-300">
                      <strong className="text-green-300">Input Cost:</strong> Price per 1,000 input tokens (prompts, context, memory). Measured in USD. Example: $0.00015 = 15 cents per 1M tokens.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-green-300">Output Cost:</strong> Price per 1,000 output tokens (AI responses, generated content). Typically 2-3x higher than input. Example: $0.0006 = 60 cents per 1M tokens.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-green-300">Sync Latest Pricing:</strong> Automatically fetches current rates from OpenAI and Anthropic APIs. Keeps system aligned with provider pricing changes. Run monthly or when providers announce updates.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-green-300">Manual Edits:</strong> Override prices for custom contracts, volume discounts, or testing. Changes affect cost calculations immediately but don't alter provider billing.
                    </p>
                  </div>
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mt-2">
                    <p className="text-green-300 text-xs font-medium mb-1">Impact on Intelligent Routing</p>
                    <p className="text-slate-300 text-xs leading-relaxed">
                      Lower model costs increase routing priority. If GPT-4o-mini price drops, more agents route there. If Claude Haiku becomes cheaper than GPT-4o-mini, <strong className="text-white">medium complexity agents automatically switch</strong> to maximize savings.
                    </p>
                  </div>
                </div>
              </div>
            </div>

          <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-700/30">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Provider
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Model
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Input Cost/Token
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Output Cost/Token
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Effective Date
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {pricingModels.map((model) => {
                const isEditing = editingPricing === model.id;

                return (
                  <tr key={model.id} className="hover:bg-slate-700/20 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded-full capitalize">
                        {model.provider}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-white font-mono">
                      {model.model_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="text"
                            value={editedInputCost.toFixed(10)}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) setEditedInputCost(val);
                            }}
                            className="w-40 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm font-mono text-right"
                            placeholder="0.00000000"
                          />
                          <div className="flex flex-col">
                            <button
                              onClick={() => setEditedInputCost(editedInputCost + 0.00000001)}
                              className="p-0.5 bg-slate-600 hover:bg-slate-500 text-white rounded-t transition-colors"
                              title="Increase"
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setEditedInputCost(Math.max(0, editedInputCost - 0.00000001))}
                              className="p-0.5 bg-slate-600 hover:bg-slate-500 text-white rounded-b transition-colors"
                              title="Decrease"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span className="font-mono">{formatCost(model.input_cost_per_token)}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-300 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="text"
                            value={editedOutputCost.toFixed(10)}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (!isNaN(val)) setEditedOutputCost(val);
                            }}
                            className="w-40 px-2 py-1 bg-slate-700 border border-slate-600 rounded text-white text-sm font-mono text-right"
                            placeholder="0.00000000"
                          />
                          <div className="flex flex-col">
                            <button
                              onClick={() => setEditedOutputCost(editedOutputCost + 0.00000001)}
                              className="p-0.5 bg-slate-600 hover:bg-slate-500 text-white rounded-t transition-colors"
                              title="Increase"
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setEditedOutputCost(Math.max(0, editedOutputCost - 0.00000001))}
                              className="p-0.5 bg-slate-600 hover:bg-slate-500 text-white rounded-b transition-colors"
                              title="Decrease"
                            >
                              <ChevronDown className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span className="font-mono">{formatCost(model.output_cost_per_token)}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-400 text-right">
                      {new Date(model.effective_date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleSavePricing(model.id)}
                            disabled={saving}
                            className="p-1.5 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white rounded transition-colors"
                            title="Save"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={handleCancelEditPricing}
                            disabled={saving}
                            className="p-1.5 bg-slate-600 hover:bg-slate-700 disabled:bg-slate-700 text-white rounded transition-colors"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleEditPricing(model)}
                          className="p-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                          title="Edit pricing"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
        )}
      </motion.div>

      {/* Billing Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-green-400" />
                Billing Configuration
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Configure billing, payment, and subscription settings for Stripe integration
              </p>
            </div>
            <button
              onClick={() => setBillingExpanded(!billingExpanded)}
              className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
            >
              {billingExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>

        {billingExpanded && (
          <div className="p-6 space-y-6">
            {/* Info Box */}
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <CreditCard className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-3">
                  <p className="text-green-400 font-medium text-sm">About Billing Configuration</p>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    Billing configuration controls payment grace periods, Stripe subscription management, and Pilot Credit boost packs. These settings integrate with Stripe for subscription billing, handle payment failures gracefully, and manage one-time credit purchases.
                  </p>
                  <div className="space-y-2 text-xs leading-relaxed">
                    <p className="text-slate-300">
                      <strong className="text-green-300">Payment Grace Period:</strong> When subscription payment fails, users get X days to update payment method before agents pause. Prevents workflow interruption for temporary card issues. Agents run normally during grace period.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-green-300">Boost Packs:</strong> One-time Pilot Credit purchases via Stripe. Users buy credit bundles (e.g., 10,000 credits for $5) when subscription allowance runs out. Includes bonus percentage incentive (e.g., buy 10K, get 11K).
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-green-300">Pilot Credit Cost:</strong> Conversion rate from USD to Pilot Credits. Example: $0.0005 per credit = $5 buys 10,000 credits. Affects both subscription value and boost pack pricing.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-green-300">Stripe Integration:</strong> All payments processed through Stripe. Subscriptions = recurring monthly credits. Boost packs = one-time payments. Webhook-driven for real-time credit allocation.
                    </p>
                  </div>
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mt-2">
                    <p className="text-green-300 text-xs font-medium mb-1">Grace Period Example</p>
                    <p className="text-slate-300 text-xs leading-relaxed">
                      With <strong className="text-white">3-day grace period</strong>: Payment fails on Monday → user notified immediately → agents keep running → grace expires Thursday morning → agents auto-pause → user updates card → agents resume within minutes.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Payment Grace Period Configuration */}
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-green-400" />
                  <h3 className="text-base font-medium text-white">Payment Grace Period</h3>
                </div>
                <button
                  onClick={handleSaveBillingConfig}
                  disabled={saving}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300">
                    Grace Period (Days)
                  </label>
                  <input
                    type="number"
                    value={billingConfig.paymentGracePeriodDays}
                    onChange={(e) => setBillingConfig({
                      ...billingConfig,
                      paymentGracePeriodDays: parseInt(e.target.value) || 3
                    })}
                    min="0"
                    max="30"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-green-500"
                  />
                  <p className="text-xs text-slate-500">
                    Number of days to wait after a payment failure before pausing agents.
                    Default is 3 days. Set to 0 to pause agents immediately after payment failure.
                    Maximum is 30 days. This applies to all subscription renewals and recurring payments.
                  </p>
                </div>
              </div>

              {/* Grace Period Examples */}
              <div className="bg-slate-700/30 rounded-lg p-4 space-y-3">
                <div className="text-sm font-medium text-slate-300">Example Scenarios:</div>
                <div className="space-y-2 text-xs">
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0 mt-1.5"></div>
                    <div>
                      <span className="text-slate-400">Grace Period = 0 days:</span>
                      <span className="text-slate-300"> Agents pause immediately when payment fails. Strictest setting for critical payment enforcement.</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0 mt-1.5"></div>
                    <div>
                      <span className="text-slate-400">Grace Period = 3 days (default):</span>
                      <span className="text-slate-300"> Agents continue running for 3 days after payment failure. User has 3 days to update payment method before interruption.</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0 mt-1.5"></div>
                    <div>
                      <span className="text-slate-400">Grace Period = 7 days:</span>
                      <span className="text-slate-300"> Extended grace period for more flexible payment management. Agents run for a full week after payment failure.</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Technical Notes */}
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-blue-400 font-medium text-xs">Technical Details</p>
                    <ul className="text-slate-300 text-xs space-y-1 list-disc list-inside">
                      <li>Grace period starts counting from the billing period end date, not the failed payment date</li>
                      <li>Stripe automatically retries failed payments according to your Stripe Dashboard settings</li>
                      <li>Users can update their payment method via the Customer Portal at any time during grace period</li>
                      <li>When payment succeeds during grace period, agents remain active and grace period resets</li>
                      <li>System checks grace period expiration when processing <code className="text-blue-300">invoice.payment_failed</code> webhook events</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Boost Pack Management */}
            <div className="space-y-4 pt-6 border-t border-white/10">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <h3 className="text-base font-medium text-white">Boost Pack Management</h3>
                </div>
                <button
                  onClick={() => setShowAddBoostPack(true)}
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  <Zap className="w-4 h-4" />
                  Add Boost Pack
                </button>
              </div>

              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                  <div className="space-y-2">
                    <p className="text-yellow-400 font-medium text-sm">How Boost Packs Work</p>
                    <p className="text-slate-300 text-sm leading-relaxed">
                      Boost packs are one-time credit purchases. Set the price (USD) and bonus percentage,
                      and the system automatically calculates the Pilot Credits. All calculations are saved
                      to the database - the UI simply reads the pre-calculated values for optimal performance.
                    </p>
                  </div>
                </div>
              </div>

              {/* Boost Pack List */}
              <div className="space-y-3">
                {boostPacks.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">
                    <Zap className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No boost packs configured yet</p>
                    <p className="text-sm mt-1">Click "Add Boost Pack" to create one</p>
                  </div>
                ) : (
                  boostPacks.map((pack) => {
                    const { baseCredits, bonusCredits } = calculateBoostPackCredits(pack.price_usd, pack.bonus_percentage);
                    const isEditing = editingBoostPack === pack.id;

                    return (
                      <div key={pack.id} className="bg-slate-700/30 rounded-lg p-4 space-y-3">
                        {isEditing ? (
                          // Edit Mode
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs text-slate-400">Pack Key</label>
                                <input
                                  type="text"
                                  value={pack.pack_key}
                                  onChange={(e) => setBoostPacks(boostPacks.map(p =>
                                    p.id === pack.id ? { ...p, pack_key: e.target.value } : p
                                  ))}
                                  className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                                  placeholder="boost_quick"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-slate-400">Pack Name</label>
                                <input
                                  type="text"
                                  value={pack.pack_name}
                                  onChange={(e) => setBoostPacks(boostPacks.map(p =>
                                    p.id === pack.id ? { ...p, pack_name: e.target.value } : p
                                  ))}
                                  className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                                  placeholder="Quick Boost"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs text-slate-400">Display Name</label>
                                <input
                                  type="text"
                                  value={pack.display_name}
                                  onChange={(e) => setBoostPacks(boostPacks.map(p =>
                                    p.id === pack.id ? { ...p, display_name: e.target.value } : p
                                  ))}
                                  className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                                  placeholder="Quick Boost"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-slate-400">Badge Text (Optional)</label>
                                <input
                                  type="text"
                                  value={pack.badge_text || ''}
                                  onChange={(e) => setBoostPacks(boostPacks.map(p =>
                                    p.id === pack.id ? { ...p, badge_text: e.target.value || null } : p
                                  ))}
                                  className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                                  placeholder="POPULAR"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="text-xs text-slate-400">Description</label>
                              <input
                                type="text"
                                value={pack.description}
                                onChange={(e) => setBoostPacks(boostPacks.map(p =>
                                  p.id === pack.id ? { ...p, description: e.target.value } : p
                                ))}
                                className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                                placeholder="Perfect for a quick credit refill"
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs text-slate-400">Price (USD)</label>
                                <input
                                  type="number"
                                  value={pack.price_usd}
                                  onChange={(e) => setBoostPacks(boostPacks.map(p =>
                                    p.id === pack.id ? { ...p, price_usd: parseFloat(e.target.value) || 0 } : p
                                  ))}
                                  step="0.01"
                                  min="0"
                                  className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-slate-400">Bonus (%)</label>
                                <input
                                  type="number"
                                  value={pack.bonus_percentage}
                                  onChange={(e) => setBoostPacks(boostPacks.map(p =>
                                    p.id === pack.id ? { ...p, bonus_percentage: parseFloat(e.target.value) || 0 } : p
                                  ))}
                                  step="1"
                                  min="0"
                                  max="100"
                                  className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                                />
                              </div>
                            </div>

                            <div className="bg-slate-800/50 rounded-lg p-3 space-y-2">
                              <div className="text-xs text-slate-400">Calculated Credits (will be saved to database):</div>
                              <div className="flex items-center gap-4 text-sm">
                                <div>
                                  <span className="text-slate-400">Base:</span>
                                  <span className="text-white font-semibold ml-2">{baseCredits.toLocaleString()}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400">Bonus:</span>
                                  <span className="text-green-400 font-semibold ml-2">+{bonusCredits.toLocaleString()}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400">Total:</span>
                                  <span className="text-blue-400 font-semibold ml-2">{(baseCredits + bonusCredits).toLocaleString()}</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-2 text-sm text-slate-300">
                                <input
                                  type="checkbox"
                                  checked={pack.is_active}
                                  onChange={(e) => setBoostPacks(boostPacks.map(p =>
                                    p.id === pack.id ? { ...p, is_active: e.target.checked } : p
                                  ))}
                                  className="rounded"
                                />
                                Active (visible to users)
                              </label>
                            </div>

                            <div className="flex items-center gap-2 pt-2">
                              <button
                                onClick={() => handleSaveBoostPack(pack)}
                                disabled={saving}
                                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                              >
                                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                                Save
                              </button>
                              <button
                                onClick={() => {
                                  setEditingBoostPack(null);
                                  setDeletingBoostPack(null);
                                }}
                                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                              >
                                <X className="w-4 h-4" />
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          // View Mode
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-2">
                                <h4 className="text-white font-semibold">{pack.pack_name}</h4>
                                {pack.badge_text && (
                                  <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs font-semibold rounded">
                                    {pack.badge_text}
                                  </span>
                                )}
                                {!pack.is_active && (
                                  <span className="px-2 py-0.5 bg-slate-500/20 text-slate-400 text-xs font-semibold rounded">
                                    INACTIVE
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-slate-400 mb-2">{pack.description}</p>
                              <div className="flex items-center gap-4 text-sm">
                                <div>
                                  <span className="text-slate-400">Price:</span>
                                  <span className="text-white font-semibold ml-2">${pack.price_usd.toFixed(2)}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400">Credits:</span>
                                  <span className="text-white font-semibold ml-2">{pack.credits_amount.toLocaleString()}</span>
                                </div>
                                {pack.bonus_credits > 0 && (
                                  <div>
                                    <span className="text-slate-400">Bonus:</span>
                                    <span className="text-green-400 font-semibold ml-2">+{pack.bonus_credits.toLocaleString()}</span>
                                  </div>
                                )}
                                <div>
                                  <span className="text-slate-400">Bonus %:</span>
                                  <span className="text-yellow-400 font-semibold ml-2">{pack.bonus_percentage}%</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {deletingBoostPack === pack.id ? (
                                // Delete confirmation buttons
                                <div className="flex items-center gap-2 bg-red-500/10 px-3 py-1 rounded border border-red-500/30">
                                  <span className="text-xs text-red-400 font-medium">Delete?</span>
                                  <button
                                    onClick={() => handleDeleteBoostPack(pack.id!)}
                                    disabled={saving}
                                    className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:bg-red-800 text-white rounded text-xs transition-colors"
                                  >
                                    Yes
                                  </button>
                                  <button
                                    onClick={() => setDeletingBoostPack(null)}
                                    className="px-2 py-1 bg-slate-600 hover:bg-slate-500 text-white rounded text-xs transition-colors"
                                  >
                                    No
                                  </button>
                                </div>
                              ) : (
                                // Normal edit/delete buttons
                                <>
                                  <button
                                    onClick={() => {
                                      setEditingBoostPack(pack.id!);
                                      setDeletingBoostPack(null);
                                    }}
                                    className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                                    title="Edit"
                                  >
                                    <Edit className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => setDeletingBoostPack(pack.id!)}
                                    className="p-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                                    title="Delete"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Add New Boost Pack Modal/Form */}
              {showAddBoostPack && (
                <div className="bg-slate-700/50 rounded-lg p-4 space-y-3 border-2 border-yellow-500/30">
                  <div className="flex items-center justify-between pb-2 border-b border-white/10">
                    <h4 className="text-white font-semibold flex items-center gap-2">
                      <Zap className="w-4 h-4 text-yellow-400" />
                      Add New Boost Pack
                    </h4>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400">Pack Key *</label>
                      <input
                        type="text"
                        value={newBoostPack.pack_key}
                        onChange={(e) => setNewBoostPack({ ...newBoostPack, pack_key: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                        placeholder="boost_quick"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Pack Name *</label>
                      <input
                        type="text"
                        value={newBoostPack.pack_name}
                        onChange={(e) => setNewBoostPack({ ...newBoostPack, pack_name: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                        placeholder="Quick Boost"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400">Display Name *</label>
                      <input
                        type="text"
                        value={newBoostPack.display_name}
                        onChange={(e) => setNewBoostPack({ ...newBoostPack, display_name: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                        placeholder="Quick Boost"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Badge Text (Optional)</label>
                      <input
                        type="text"
                        value={newBoostPack.badge_text || ''}
                        onChange={(e) => setNewBoostPack({ ...newBoostPack, badge_text: e.target.value || null })}
                        className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                        placeholder="POPULAR"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-slate-400">Description *</label>
                    <input
                      type="text"
                      value={newBoostPack.description}
                      onChange={(e) => setNewBoostPack({ ...newBoostPack, description: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                      placeholder="Perfect for a quick credit refill"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400">Price (USD) *</label>
                      <input
                        type="number"
                        value={newBoostPack.price_usd}
                        onChange={(e) => setNewBoostPack({ ...newBoostPack, price_usd: parseFloat(e.target.value) || 0 })}
                        step="0.01"
                        min="0"
                        className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Bonus (%) *</label>
                      <input
                        type="number"
                        value={newBoostPack.bonus_percentage}
                        onChange={(e) => setNewBoostPack({ ...newBoostPack, bonus_percentage: parseFloat(e.target.value) || 0 })}
                        step="1"
                        min="0"
                        max="100"
                        className="w-full px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm"
                      />
                    </div>
                  </div>

                  <div className="bg-slate-800/50 rounded-lg p-3 space-y-2">
                    <div className="text-xs text-slate-400">Calculated Credits (will be saved to database):</div>
                    <div className="flex items-center gap-4 text-sm">
                      {(() => {
                        const { baseCredits, bonusCredits } = calculateBoostPackCredits(newBoostPack.price_usd, newBoostPack.bonus_percentage);
                        return (
                          <>
                            <div>
                              <span className="text-slate-400">Base:</span>
                              <span className="text-white font-semibold ml-2">{baseCredits.toLocaleString()}</span>
                            </div>
                            <div>
                              <span className="text-slate-400">Bonus:</span>
                              <span className="text-green-400 font-semibold ml-2">+{bonusCredits.toLocaleString()}</span>
                            </div>
                            <div>
                              <span className="text-slate-400">Total:</span>
                              <span className="text-blue-400 font-semibold ml-2">{(baseCredits + bonusCredits).toLocaleString()}</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={() => handleSaveBoostPack(newBoostPack)}
                      disabled={saving || !newBoostPack.pack_key || !newBoostPack.pack_name}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                      {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Create Boost Pack
                    </button>
                    <button
                      onClick={() => {
                        setShowAddBoostPack(false);
                        setNewBoostPack({
                          pack_key: '',
                          pack_name: '',
                          display_name: '',
                          description: '',
                          price_usd: 10,
                          bonus_percentage: 0,
                          credits_amount: 0,
                          bonus_credits: 0,
                          badge_text: null,
                          is_active: true
                        });
                      }}
                      className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </motion.div>

      {/* Calculator Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Sliders className="w-5 h-5 text-purple-400" />
                Calculator Configuration
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Estimation parameters for the Pilot Credit usage calculator shown to users
              </p>
            </div>
            <button
              onClick={() => setCalcExpanded(!calcExpanded)}
              className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
            >
              {calcExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>

        {calcExpanded && (
          <div className="p-6 space-y-6">
            {/* Info Box */}
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Sliders className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                <div className="space-y-3">
                  <p className="text-purple-400 font-medium text-sm">About Calculator Configuration</p>
                  <p className="text-slate-300 text-sm leading-relaxed">
                    These parameters power the Pilot Credit calculator that estimates usage costs for users when they design agents. The calculator provides cost transparency during agent creation, helping users understand resource requirements before deployment.
                  </p>
                  <div className="space-y-2 text-xs leading-relaxed">
                    <p className="text-slate-300">
                      <strong className="text-purple-300">Token Parameters:</strong> Estimate AI model token usage based on agent complexity (plugins, workflow steps, iterations). Affects predicted LLM costs.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-purple-300">Execution Parameters:</strong> Estimate runtime behavior (iterations, duration, retry rates). Determines execution complexity multipliers.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-purple-300">Pricing Parameters:</strong> Convert technical estimates into Pilot Credit costs. Includes base fees, plugin overhead, system infrastructure costs.
                    </p>
                  </div>
                  <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 mt-2">
                    <p className="text-purple-300 text-xs font-medium mb-1">Important Note</p>
                    <p className="text-slate-300 text-xs leading-relaxed">
                      These settings only affect the <strong className="text-white">cost estimator shown to users</strong>. Actual billing is calculated from real execution metrics. Adjust these values to match your infrastructure costs and desired pricing model.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Token Estimation */}
            <div className="space-y-4">
              <h3 className="font-medium text-white flex items-center gap-2 pb-2 border-b border-white/10">
                <Database className="w-4 h-4 text-blue-400" />
                Token Estimation
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-blue-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    Base Tokens
                  </label>
                  <input
                    type="number"
                    value={calcConfig.baseTokens}
                    onChange={(e) => setCalcConfig({ ...calcConfig, baseTokens: parseFloat(e.target.value) })}
                    min="0"
                    step="100"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-blue-300 font-medium mb-1">Foundation Tokens (default: 5000)</p>
                    <p className="text-slate-400">Starting token count for basic agent with no plugins. Affects cost estimation baseline for all agent calculations.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-blue-300 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5" />
                    Tokens Per Plugin
                  </label>
                  <input
                    type="number"
                    value={calcConfig.tokensPerPlugin}
                    onChange={(e) => setCalcConfig({ ...calcConfig, tokensPerPlugin: parseFloat(e.target.value) })}
                    min="0"
                    step="50"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-blue-300 font-medium mb-1">Plugin Token Cost (default: 800)</p>
                    <p className="text-slate-400">How many extra tokens each connected plugin adds to the agent's usage. Includes plugin metadata and orchestration overhead.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-purple-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    Peak Multiplier
                  </label>
                  <input
                    type="number"
                    value={calcConfig.peakMultiplier}
                    onChange={(e) => setCalcConfig({ ...calcConfig, peakMultiplier: parseFloat(e.target.value) })}
                    min="1"
                    max="3"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-purple-300 font-medium mb-1">Burst Factor (default: 1.5)</p>
                    <p className="text-slate-400">Maximum usage spike multiplier. 1.5 means peak usage can be 50% higher than average during complex operations.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-green-300 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5" />
                    Plugin Usage Rate
                  </label>
                  <input
                    type="number"
                    value={calcConfig.pluginUsageRate}
                    onChange={(e) => setCalcConfig({ ...calcConfig, pluginUsageRate: parseFloat(e.target.value) })}
                    min="0"
                    max="1"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-green-300 font-medium mb-1">Active Usage Percentage (default: 0.8)</p>
                    <p className="text-slate-400">What percentage of connected plugins actually get used per run. 0.8 = 80% active usage rate across agent executions.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-yellow-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Orchestration Overhead (ms)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.orchestrationOverheadMs}
                    onChange={(e) => setCalcConfig({ ...calcConfig, orchestrationOverheadMs: parseFloat(e.target.value) })}
                    min="0"
                    step="100"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-yellow-300 font-medium mb-1">Coordination Time (default: 500ms)</p>
                    <p className="text-slate-400">Extra time spent coordinating between plugins during execution. Includes API calls and data transformation overhead.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-cyan-300 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Estimated Duration (ms)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.estimatedDurationMs}
                    onChange={(e) => setCalcConfig({ ...calcConfig, estimatedDurationMs: parseFloat(e.target.value) })}
                    min="0"
                    step="1000"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-cyan-300 font-medium mb-1">Average Execution Time (default: 15000ms)</p>
                    <p className="text-slate-400">How long a typical agent execution takes from start to finish. Used for timeout and resource allocation estimates.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-red-300 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Estimated Failure Rate (%)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.estimatedFailureRate}
                    onChange={(e) => setCalcConfig({ ...calcConfig, estimatedFailureRate: parseFloat(e.target.value) })}
                    min="0"
                    max="100"
                    step="1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-red-300 font-medium mb-1">Error Rate (default: 5%)</p>
                    <p className="text-slate-400">Expected percentage of agent runs that fail. Used to calculate retry overhead and reliability margins in cost estimates.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-orange-300 flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" />
                    Estimated Retry Rate
                  </label>
                  <input
                    type="number"
                    value={calcConfig.estimatedRetryRate}
                    onChange={(e) => setCalcConfig({ ...calcConfig, estimatedRetryRate: parseFloat(e.target.value) })}
                    min="0"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-orange-300 font-medium mb-1">Retry Multiplier (default: 0.3)</p>
                    <p className="text-slate-400">How many times agents retry on failure. 0.3 means 30% of failures result in one retry attempt.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-indigo-300 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5" />
                    I/O Ratio
                  </label>
                  <input
                    type="number"
                    value={calcConfig.ioRatio}
                    onChange={(e) => setCalcConfig({ ...calcConfig, ioRatio: parseFloat(e.target.value) })}
                    min="0"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-indigo-300 font-medium mb-1">Output/Input Token Ratio (default: 2.0)</p>
                    <p className="text-slate-400">Ratio of tokens generated vs consumed. 2.0 means agent generates twice as many tokens as it reads from inputs.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Execution Parameters */}
            <div className="space-y-4">
              <h3 className="font-medium text-white flex items-center gap-2 pb-2 border-b border-white/10">
                <Zap className="w-4 h-4 text-yellow-400" />
                Execution Parameters
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-yellow-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    Base Iterations
                  </label>
                  <input
                    type="number"
                    value={calcConfig.baseIterations}
                    onChange={(e) => setCalcConfig({ ...calcConfig, baseIterations: parseFloat(e.target.value) })}
                    min="1"
                    max="20"
                    step="1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-yellow-300 font-medium mb-1">Minimum Cycles (default: 3)</p>
                    <p className="text-slate-400">Fewest loops/cycles a simple agent runs before completing its task. Affects baseline runtime estimation.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-red-300 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Max Iterations
                  </label>
                  <input
                    type="number"
                    value={calcConfig.maxIterations}
                    onChange={(e) => setCalcConfig({ ...calcConfig, maxIterations: parseFloat(e.target.value) })}
                    min="1"
                    max="50"
                    step="1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-red-300 font-medium mb-1">Safety Limit (default: 15)</p>
                    <p className="text-slate-400">Maximum loops/cycles before stopping complex agents. Prevents infinite runs and runaway costs.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Pricing Parameters */}
            <div className="space-y-4">
              <h3 className="font-medium text-white flex items-center gap-2 pb-2 border-b border-white/10">
                <DollarSign className="w-4 h-4 text-green-400" />
                Pricing Parameters
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-blue-300 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5" />
                    Runs Per Agent Per Month
                  </label>
                  <input
                    type="number"
                    value={calcConfig.runsPerAgentPerMonth}
                    onChange={(e) => setCalcConfig({ ...calcConfig, runsPerAgentPerMonth: parseFloat(e.target.value) })}
                    min="1"
                    max="1000"
                    step="1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-blue-300 font-medium mb-1">Average Monthly Usage (default: 30)</p>
                    <p className="text-slate-400">How many times users run each agent per month. Used to calculate monthly cost projections in the calculator.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-purple-300 flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5" />
                    Agent Creation Cost (Pilot Credits)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.agentCreationCost}
                    onChange={(e) => setCalcConfig({ ...calcConfig, agentCreationCost: parseFloat(e.target.value) })}
                    min="0"
                    step="100"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-purple-300 font-medium mb-1">One-Time Creation Fee (default: 1000)</p>
                    <p className="text-slate-400">Pilot Credits charged when user first creates an agent. One-time setup fee to cover AI-assisted agent building.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-green-300 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5" />
                    Credit Cost (USD)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.creditCostUsd}
                    onChange={(e) => setCalcConfig({ ...calcConfig, creditCostUsd: parseFloat(e.target.value) })}
                    min="0"
                    step="0.00001"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-green-300 font-medium mb-1">Real Money Value (default: $0.00048)</p>
                    <p className="text-slate-400">How much 1 Pilot Credit costs in actual USD. Controls the conversion rate for billing calculations.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-amber-300 flex items-center gap-1.5">
                    <DollarSign className="w-3.5 h-3.5" />
                    Minimum Monthly Cost (USD)
                  </label>
                  <input
                    type="number"
                    value={calcConfig.minimumMonthlyCostUsd}
                    onChange={(e) => setCalcConfig({ ...calcConfig, minimumMonthlyCostUsd: parseFloat(e.target.value) })}
                    min="0"
                    step="1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-amber-300 font-medium mb-1">Floor Price (default: $0)</p>
                    <p className="text-slate-400">Minimum USD charged per month regardless of usage. Set to 0 for pure usage-based pricing.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-cyan-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    Base Credits Per Run
                  </label>
                  <input
                    type="number"
                    value={calcConfig.baseCreditsPerRun}
                    onChange={(e) => setCalcConfig({ ...calcConfig, baseCreditsPerRun: parseFloat(e.target.value) })}
                    min="0"
                    step="10"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-cyan-300 font-medium mb-1">Flat Fee Per Run (default: 50)</p>
                    <p className="text-slate-400">Flat Pilot Credit cost for every agent run, before adding plugin overhead. Covers base AI model usage.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-indigo-300 flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5" />
                    Plugin Overhead Per Run
                  </label>
                  <input
                    type="number"
                    value={calcConfig.pluginOverheadPerRun}
                    onChange={(e) => setCalcConfig({ ...calcConfig, pluginOverheadPerRun: parseFloat(e.target.value) })}
                    min="0"
                    step="10"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-indigo-300 font-medium mb-1">Plugin Fee (default: 20)</p>
                    <p className="text-slate-400">Extra Pilot Credits charged for each active plugin used during a run. Covers API calls and data processing.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-300 flex items-center gap-1.5">
                    <Settings className="w-3.5 h-3.5" />
                    System Overhead Per Run
                  </label>
                  <input
                    type="number"
                    value={calcConfig.systemOverheadPerRun}
                    onChange={(e) => setCalcConfig({ ...calcConfig, systemOverheadPerRun: parseFloat(e.target.value) })}
                    min="0"
                    step="5"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-slate-300 font-medium mb-1">Infrastructure Fee (default: 10)</p>
                    <p className="text-slate-400">Platform infrastructure cost per run. Credits for hosting, monitoring, logging, and system resources.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-purple-300 flex items-center gap-1.5">
                    <Sliders className="w-3.5 h-3.5" />
                    Execution Step Multiplier
                  </label>
                  <input
                    type="number"
                    value={calcConfig.executionStepMultiplier}
                    onChange={(e) => setCalcConfig({ ...calcConfig, executionStepMultiplier: parseFloat(e.target.value) })}
                    min="1"
                    step="0.1"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-purple-300 font-medium mb-1">Complexity Multiplier (default: 1.2)</p>
                    <p className="text-slate-400">Increases cost per iteration. 1.2 = 20% more credits per loop to account for increasing complexity.</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-green-300 flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5" />
                    Free Tier Credits
                  </label>
                  <input
                    type="number"
                    value={calcConfig.freeTierCredits}
                    onChange={(e) => setCalcConfig({ ...calcConfig, freeTierCredits: parseFloat(e.target.value) })}
                    min="0"
                    step="100"
                    className="w-full px-4 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                  />
                  <div className="text-xs text-slate-400 leading-relaxed">
                    <p className="text-green-300 font-medium mb-1">Welcome Bonus (default: 1000)</p>
                    <p className="text-slate-400">Pilot Credits given to each new user for free trial. Enables testing before purchasing boost packs.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-4 border-t border-white/10">
              <button
                onClick={handleSaveCalculatorConfig}
                disabled={saving}
                className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Calculator Config
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Advanced System Configuration */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <Database className="w-5 h-5 text-orange-400" />
                Advanced Configuration
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Complete system configuration in JSON format. Use with caution - incorrect values may affect platform stability.
              </p>
            </div>
            <button
              onClick={() => setAdvancedExpanded(!advancedExpanded)}
              className="p-2 bg-slate-700/50 hover:bg-slate-600/50 rounded-lg transition-colors"
            >
              {advancedExpanded ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
          </div>
        </div>
        {advancedExpanded && (
          <div className="p-6">
            <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700">
              <div className="flex items-start gap-3 mb-3">
                <AlertCircle className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-yellow-400 text-sm font-medium">Advanced Settings</p>
                  <p className="text-slate-400 text-xs mt-1">
                    This is a read-only view of all system settings. To modify values, use the specific configuration sections above.
                  </p>
                </div>
              </div>
              <pre className="text-xs text-slate-300 bg-slate-950 p-4 rounded-lg overflow-x-auto border border-slate-800">
                {JSON.stringify({
                  calculator: calcConfig,
                  pricing_models: pricingModels.map(m => ({
                    provider: m.provider,
                    model: m.model_name,
                    input_cost: m.input_cost_per_token,
                    output_cost: m.output_cost_per_token
                  }))
                }, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </motion.div>

    </div>
  );
}
