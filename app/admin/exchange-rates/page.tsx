'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  DollarSign,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Globe,
  Edit,
  X,
  Check,
  TrendingUp,
  History,
  Calendar,
  Clock
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { createCurrencyService } from '@/lib/services/CurrencyService';

interface ExchangeRate {
  id: string;
  currency_code: string;
  currency_name: string;
  currency_symbol: string;
  rate_to_usd: number;
  is_enabled: boolean;
  decimal_places: number;
  last_updated_at: string;
  updated_by: string | null;
  created_at: string;
}

interface RateHistory {
  id: string;
  currency_code: string;
  old_rate: number;
  new_rate: number;
  changed_by: string | null;
  changed_at: string;
  change_reason: string | null;
}

export default function ExchangeRatesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [history, setHistory] = useState<RateHistory[]>([]);
  const [editingRate, setEditingRate] = useState<string | null>(null);
  const [editedValue, setEditedValue] = useState<number>(0);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [fetchingRates, setFetchingRates] = useState(false);

  useEffect(() => {
    loadExchangeRates();
    loadHistory();
  }, []);

  const loadExchangeRates = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('exchange_rates')
        .select('*')
        .order('currency_code');

      if (error) throw error;
      setRates(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('exchange_rate_history')
        .select('*')
        .order('changed_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setHistory(data || []);
    } catch (err: any) {
      console.error('Error loading history:', err);
    }
  };

  const handleEditStart = (rate: ExchangeRate) => {
    setEditingRate(rate.id);
    setEditedValue(rate.rate_to_usd);
  };

  const handleEditCancel = () => {
    setEditingRate(null);
    setEditedValue(0);
  };

  const handleEditSave = async (rate: ExchangeRate) => {
    try {
      setSaving(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const currencyService = createCurrencyService(supabase);
      await currencyService.updateRate(
        rate.currency_code,
        editedValue,
        user.id,
        'Manual update from admin panel'
      );

      setSuccess(`Exchange rate for ${rate.currency_code} updated successfully`);
      setEditingRate(null);
      await loadExchangeRates();
      await loadHistory();

      setTimeout(() => setSuccess(null), 5000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (rate: ExchangeRate) => {
    try {
      setSaving(true);
      setError(null);

      const { error: updateError } = await supabase
        .from('exchange_rates')
        .update({ is_enabled: !rate.is_enabled })
        .eq('id', rate.id);

      if (updateError) throw updateError;

      setSuccess(`${rate.currency_code} ${!rate.is_enabled ? 'enabled' : 'disabled'} successfully`);
      await loadExchangeRates();

      setTimeout(() => setSuccess(null), 5000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFetchCurrentRates = async () => {
    try {
      setFetchingRates(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Fetch from exchangerate-api.com (free tier, no API key needed for basic access)
      const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');

      if (!response.ok) {
        throw new Error('Failed to fetch exchange rates from API');
      }

      const data = await response.json();
      const apiRates = data.rates as Record<string, number>;

      let updatedCount = 0;

      // Update rates for all currencies we support
      for (const rate of rates) {
        if (rate.currency_code === 'USD') continue; // Skip USD (always 1.0)

        if (apiRates[rate.currency_code]) {
          const currencyService = createCurrencyService(supabase);
          await currencyService.updateRate(
            rate.currency_code,
            apiRates[rate.currency_code],
            user.id,
            'Auto-fetched from exchangerate-api.com'
          );
          updatedCount++;
        }
      }

      setSuccess(`Successfully updated ${updatedCount} exchange rates from API`);
      await loadExchangeRates();
      await loadHistory();

      setTimeout(() => setSuccess(null), 5000);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch exchange rates');
    } finally {
      setFetchingRates(false);
    }
  };

  const calculateChangePercent = (oldRate: number, newRate: number) => {
    const change = ((newRate - oldRate) / oldRate) * 100;
    return change.toFixed(2);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6 flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Loading exchange rates...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-xl p-6 border border-slate-200"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                <DollarSign className="h-7 w-7 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-slate-900">Exchange Rates</h1>
                <p className="text-slate-600 mt-1">Manage currency exchange rates for international billing</p>
              </div>
            </div>
            <button
              onClick={loadExchangeRates}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </motion.div>

        {/* Alerts */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-red-900 font-medium">Error</p>
              <p className="text-red-700 text-sm mt-1">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {success && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3"
          >
            <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-green-900 font-medium">Success</p>
              <p className="text-green-700 text-sm mt-1">{success}</p>
            </div>
            <button onClick={() => setSuccess(null)} className="text-green-600 hover:text-green-800">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {/* Exchange Rates Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden"
        >
          <div className="p-6 border-b border-slate-200">
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Globe className="w-5 h-5" />
              Currency Exchange Rates
            </h2>
            <p className="text-slate-600 text-sm mt-1">
              All rates are relative to 1 USD. Update rates manually or connect to an API provider.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left py-4 px-6 text-xs font-semibold text-slate-600 uppercase">
                    Currency
                  </th>
                  <th className="text-left py-4 px-6 text-xs font-semibold text-slate-600 uppercase">
                    Symbol
                  </th>
                  <th className="text-right py-4 px-6 text-xs font-semibold text-slate-600 uppercase">
                    Rate to USD
                  </th>
                  <th className="text-center py-4 px-6 text-xs font-semibold text-slate-600 uppercase">
                    Decimals
                  </th>
                  <th className="text-center py-4 px-6 text-xs font-semibold text-slate-600 uppercase">
                    Status
                  </th>
                  <th className="text-left py-4 px-6 text-xs font-semibold text-slate-600 uppercase">
                    Last Updated
                  </th>
                  <th className="text-right py-4 px-6 text-xs font-semibold text-slate-600 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {rates.map((rate) => (
                  <tr key={rate.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">
                          {rate.currency_code}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">{rate.currency_code}</div>
                          <div className="text-xs text-slate-500">{rate.currency_name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <span className="font-mono text-lg text-slate-700">{rate.currency_symbol}</span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      {editingRate === rate.id ? (
                        <input
                          type="number"
                          step="0.000001"
                          value={editedValue}
                          onChange={(e) => setEditedValue(parseFloat(e.target.value))}
                          className="w-32 px-3 py-1.5 border border-blue-300 rounded-lg text-right font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoFocus
                        />
                      ) : (
                        <span className="font-mono font-semibold text-slate-900">
                          {rate.rate_to_usd.toFixed(6)}
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span className="px-2 py-1 bg-slate-100 rounded text-sm font-medium text-slate-700">
                        {rate.decimal_places}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <button
                        onClick={() => handleToggleEnabled(rate)}
                        disabled={saving || rate.currency_code === 'USD'}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          rate.is_enabled
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        } ${rate.currency_code === 'USD' || saving ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {rate.is_enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <Clock className="w-4 h-4" />
                        {new Date(rate.last_updated_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center justify-end gap-2">
                        {editingRate === rate.id ? (
                          <>
                            <button
                              onClick={() => handleEditSave(rate)}
                              disabled={saving}
                              className="p-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              onClick={handleEditCancel}
                              disabled={saving}
                              className="p-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleEditStart(rate)}
                              disabled={saving || rate.currency_code === 'USD'}
                              className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setShowHistory(showHistory === rate.currency_code ? null : rate.currency_code)}
                              className="p-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                            >
                              <History className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* History Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden"
        >
          <div className="p-6 border-b border-slate-200">
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <History className="w-5 h-5" />
              Recent Changes
            </h2>
            <p className="text-slate-600 text-sm mt-1">
              History of exchange rate updates
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left py-4 px-6 text-xs font-semibold text-slate-600 uppercase">
                    Currency
                  </th>
                  <th className="text-right py-4 px-6 text-xs font-semibold text-slate-600 uppercase">
                    Old Rate
                  </th>
                  <th className="text-right py-4 px-6 text-xs font-semibold text-slate-600 uppercase">
                    New Rate
                  </th>
                  <th className="text-right py-4 px-6 text-xs font-semibold text-slate-600 uppercase">
                    Change
                  </th>
                  <th className="text-left py-4 px-6 text-xs font-semibold text-slate-600 uppercase">
                    Date
                  </th>
                  <th className="text-left py-4 px-6 text-xs font-semibold text-slate-600 uppercase">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-500">
                      No history available
                    </td>
                  </tr>
                ) : (
                  history
                    .filter(h => !showHistory || h.currency_code === showHistory)
                    .map((h) => (
                      <tr key={h.id} className="hover:bg-slate-50 transition-colors">
                        <td className="py-4 px-6">
                          <span className="font-mono font-semibold text-slate-900">{h.currency_code}</span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <span className="font-mono text-slate-600">{h.old_rate?.toFixed(6) || 'N/A'}</span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <span className="font-mono font-semibold text-slate-900">{h.new_rate.toFixed(6)}</span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          {h.old_rate && (
                            <span className={`flex items-center gap-1 justify-end font-semibold ${
                              parseFloat(calculateChangePercent(h.old_rate, h.new_rate)) > 0
                                ? 'text-green-600'
                                : 'text-red-600'
                            }`}>
                              <TrendingUp className={`w-4 h-4 ${
                                parseFloat(calculateChangePercent(h.old_rate, h.new_rate)) < 0 ? 'rotate-180' : ''
                              }`} />
                              {calculateChangePercent(h.old_rate, h.new_rate)}%
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-2 text-sm text-slate-600">
                            <Calendar className="w-4 h-4" />
                            {new Date(h.changed_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                        </td>
                        <td className="py-4 px-6">
                          <span className="text-sm text-slate-600">{h.change_reason || 'No reason provided'}</span>
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
