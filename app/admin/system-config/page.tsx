'use client';

/**
 * Model pricing: the `ai_model_pricing` table every Business OS credit charge
 * is computed from.
 *
 * ADMIN_BOS_CLEANUP slice 2 (FR-PR1, FR-PR4, FR-PR6; conditions C2-1, C2-2,
 * C2-4, C2-8; SA W2-1, W2-3, W2-8). The AgentsPilot billing settings that
 * used to share this page (grace period, boost packs, the Pilot Credit
 * calculator, the read-only dump) moved to `app/admin/agentspilot-billing/page.tsx`.
 *
 * The only reads are `GET /api/admin/system-config/pricing`. A failed read
 * clears the table and says so (C2-4): the table shows only what the last
 * read returned, never an empty or stale list posing as current.
 *
 * Sync is parked (UC-5) and its handler and button are frozen byte for byte
 * (C2-1). AI_MODEL_PRICE_REVIEW slice 1 (SA 2026-10-08 R-5) rewrote the false
 * info-box and helper text around it; slice 8 retires Sync.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  RefreshCw,
  AlertCircle,
  CheckCircle,
  DollarSign,
  Edit,
  X,
  Check,
  Download,
  ChevronUp,
  ChevronDown
} from 'lucide-react';

import { clientLogger } from '@/lib/logger/client';

const logger = clientLogger.child({ module: 'AdminModelPricingPage' });

interface ModelPricing {
  id: string;
  provider: string;
  model_name: string;
  input_cost_per_token: number;
  output_cost_per_token: number;
  effective_date: string;
}

export default function ModelPricingPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [pricingModels, setPricingModels] = useState<ModelPricing[]>([]);
  // C2-4: true when the last price read failed. The table is not drawn.
  const [pricingReadFailed, setPricingReadFailed] = useState(false);

  // Pricing editing state
  const [editingPricing, setEditingPricing] = useState<string | null>(null);
  const [editedInputCost, setEditedInputCost] = useState<number>(0);
  const [editedOutputCost, setEditedOutputCost] = useState<number>(0);

  // Open by default (SA W2-8): on a page that is the table, a closed card is
  // an extra click and would hide the C2-4 failure line.
  const [pricingExpanded, setPricingExpanded] = useState(true);

  useEffect(() => {
    fetchData();
    // Mount-only load, as on the page before the split; refreshes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // C2-4 / O-5: the table shows only what the last read returned. A failed
  // read (including a refresh after Sync) clears it and any open editor.
  const markPricingReadFailed = () => {
    setPricingReadFailed(true);
    setPricingModels([]);
    setEditingPricing(null);
    setError('Could not load model prices.');
  };

  const fetchData = async (silent = false) => {
    try {
      if (!silent) {
        setLoading(true);
      }
      setError(null);

      const response = await fetch('/api/admin/system-config/pricing', {
        method: 'GET',
        cache: 'no-store'
      });

      if (!response.ok) {
        logger.error({ status: response.status }, 'Model prices read failed');
        markPricingReadFailed();
        return;
      }

      const result = await response.json();

      if (!result.success) {
        logger.error({ status: response.status }, 'Model prices read returned unsuccessful');
        markPricingReadFailed();
        return;
      }

      setPricingModels(result.data);
      setPricingReadFailed(false);
      logger.debug({ count: result.data.length }, 'Model prices loaded');
    } catch (err) {
      logger.error({ err }, 'Model prices read threw');
      markPricingReadFailed();
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

      // SA W2-1: show the saved price. The PUT returns the saved row in the
      // same shape as the GET rows, so it replaces the old row in place.
      const saved = result.data as ModelPricing | undefined;
      if (saved?.id) {
        setPricingModels((rows) => rows.map((row) => (row.id === saved.id ? saved : row)));
      } else {
        // Defensive: if the PUT ever stops returning the row, re-read rather
        // than show a stale price or throw after a save that succeeded.
        await fetchData(true);
      }

      setSuccess('Pricing updated successfully!');
      setEditingPricing(null);

      setTimeout(() => setSuccess(null), 3000);

    } catch (error) {
      logger.error({ err: error, pricingId: modelId }, 'Model price save failed');
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
      logger.error({ err: error }, 'Pricing sync failed');
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setSaving(false);
    }
  };

  // Per token, exact. The 8-digit minimum keeps today's renderings unchanged
  // ($0.00000015); the maximum used to be 8 too, which showed $0.075 per 1M as
  // $0.08 per 1M. 15 = 6 + the 9 decimals per 1M the price review accepts, and
  // stays clear of float noise (around the 17th significant digit).
  const formatCost = (cost: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 8,
      maximumFractionDigits: 15
    }).format(cost);
  };

  // The same price per 1M tokens, the figure providers publish. Display only:
  // the stored value and the editor stay per token.
  const formatCostPerMillion = (cost: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 9
    }).format(cost * 1_000_000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-8 h-8 text-purple-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="border-b border-slate-700">
        <div className="flex items-center justify-between pb-4">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <div className="flex items-center gap-4 mb-1">
                <h1 className="text-xl font-semibold text-white">Model pricing</h1>
              </div>
              <p className="text-sm text-slate-400">AI cost per token for each model. Every Business OS credit charge is computed from these prices.</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => fetchData()}
              disabled={loading}
              aria-label="Refresh"
              className="p-2 rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors"
            >
              <RefreshCw className={`w-5 h-5 text-slate-400 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

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
        className="bg-slate-800 border border-slate-700 rounded-xl"
      >
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-400" />
                AI Model Pricing
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Cost per token for each AI model. Sync copies a built-in price list; it does not fetch prices from providers.
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
                data-testid="pricing-toggle"
                onClick={() => setPricingExpanded(!pricingExpanded)}
                className="p-2 bg-slate-900/50 hover:bg-slate-600/50 rounded-lg transition-colors"
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
                    This table defines the cost per token for each AI model's input (prompts) and output (responses). Business OS credit charges for the models listed here are computed from these prices, so a wrong price here is a wrong charge for every customer who uses that model.
                  </p>
                  <div className="space-y-2 text-xs leading-relaxed">
                    <p className="text-slate-300">
                      <strong className="text-green-300">Input Cost:</strong> Price per single input token (prompts, context, memory), in USD. This is the unit stored and the unit the editor takes; the smaller figure under each price is the same price per 1M tokens. Example: $0.00000015 per token = $0.15 per 1M tokens.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-green-300">Output Cost:</strong> Price per single output token (AI responses, generated content), in USD. Usually higher than input. Example: $0.00000060 per token = $0.60 per 1M tokens.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-green-300">Sync Latest Pricing:</strong> Copies a built-in price list, kept in the code, into this table: it overwrites the price of every model on that list, including manual edits, and adds any listed model that is missing. It does not contact OpenAI, Anthropic or any other provider.
                    </p>
                    <p className="text-slate-300">
                      <strong className="text-green-300">Manual Edits:</strong> Override prices for custom contracts, volume discounts, or testing. Each server keeps its own copy of these prices for up to 1 hour, so a change (an edit or a Sync) is in effect on all servers within 1 hour. Changes don't alter provider billing.
                    </p>
                  </div>
                </div>
              </div>
            </div>

          {/* C2-4: a failed read is said, never drawn as an empty table. */}
          {pricingReadFailed ? (
            <p data-testid="pricing-read-failed" className="text-sm text-red-400">
              Model prices could not be read. Use the refresh button to try again.
            </p>
          ) : (
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
                        <>
                          <span className="font-mono">{formatCost(model.input_cost_per_token)}</span>
                          <span className="block text-xs text-slate-500 font-mono">
                            {formatCostPerMillion(model.input_cost_per_token)} per 1M
                          </span>
                        </>
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
                        <>
                          <span className="font-mono">{formatCost(model.output_cost_per_token)}</span>
                          <span className="block text-xs text-slate-500 font-mono">
                            {formatCostPerMillion(model.output_cost_per_token)} per 1M
                          </span>
                        </>
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
          )}
        </div>
        )}
      </motion.div>
    </div>
  );
}
