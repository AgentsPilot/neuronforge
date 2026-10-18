'use client';

// REDUNDANT (BD-34, 2026-10-16): superseded by the Money area; kept, not deleted; do not extend or link.
// No figure on the platform uses an exchange rate (BD-12). Finance requirement §11J.
// FU-M8-1 (FF-1a, BQ-20 answered 2026-10-18): read-only; nothing here writes a rate or calls an
// outside service. Reads stay in the browser. Whether the database still accepts browser writes is
// check 35; closing that is FF-2 (writes only: the settings currency picker needs SELECT).

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  RefreshCw,
  AlertCircle,
  Globe,
  X,
  TrendingUp,
  History,
  Calendar,
  Clock
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'AdminExchangeRates' });

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
  const [error, setError] = useState<string | null>(null);

  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [history, setHistory] = useState<RateHistory[]>([]);
  const [showHistory, setShowHistory] = useState<string | null>(null);

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
      logger.error({ err }, 'Error loading exchange rate history');
    }
  };

  const calculateChangePercent = (oldRate: number, newRate: number) => {
    const change = ((newRate - oldRate) / oldRate) * 100;
    return change.toFixed(2);
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
                <h1 className="text-xl font-semibold text-white">Exchange Rates</h1>
                <span className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400">System Config</span>
              </div>
              <p className="text-sm text-slate-400">Manage currency exchange rates for international billing</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={loadExchangeRates}
              disabled={loading}
              className="p-2 rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 text-slate-400 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

        {/* Alerts */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-red-400 font-medium">Error</p>
              <p className="text-red-300 text-sm mt-1">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {/* Exchange Rates Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden"
        >
          <div className="p-6 border-b border-white/10">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Globe className="w-5 h-5" />
              Currency Exchange Rates
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Read only. All rates are relative to 1 USD; no calculation uses them.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-900/50">
                <tr>
                  <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase">
                    Currency
                  </th>
                  <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase">
                    Symbol
                  </th>
                  <th className="text-right py-4 px-6 text-xs font-semibold text-slate-400 uppercase">
                    Rate to USD
                  </th>
                  <th className="text-center py-4 px-6 text-xs font-semibold text-slate-400 uppercase">
                    Decimals
                  </th>
                  <th className="text-center py-4 px-6 text-xs font-semibold text-slate-400 uppercase">
                    Status
                  </th>
                  <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase">
                    Last Updated
                  </th>
                  <th className="text-right py-4 px-6 text-xs font-semibold text-slate-400 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {rates.map((rate) => (
                  <tr key={rate.id} className="hover:bg-slate-700/30 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold text-xs">
                          {rate.currency_code}
                        </div>
                        <div>
                          <div className="font-semibold text-white">{rate.currency_code}</div>
                          <div className="text-xs text-slate-400">{rate.currency_name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <span className="font-mono text-lg text-slate-300">{rate.currency_symbol}</span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <span className="font-mono font-semibold text-white">
                        {rate.rate_to_usd.toFixed(6)}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span className="px-2 py-1 bg-slate-900/50 rounded text-sm font-medium text-slate-300">
                        {rate.decimal_places}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                          rate.is_enabled
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-slate-900/50 text-slate-400'
                        }`}
                      >
                        {rate.is_enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-2 text-sm text-slate-400">
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
                        <button
                          onClick={() => setShowHistory(showHistory === rate.currency_code ? null : rate.currency_code)}
                          className="p-2 bg-purple-500/20 text-purple-400 rounded-lg hover:bg-purple-500/30 transition-colors"
                        >
                          <History className="w-4 h-4" />
                        </button>
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
          className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden"
        >
          <div className="p-6 border-b border-white/10">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <History className="w-5 h-5" />
              Recent Changes
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              History of exchange rate updates
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-900/50">
                <tr>
                  <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase">
                    Currency
                  </th>
                  <th className="text-right py-4 px-6 text-xs font-semibold text-slate-400 uppercase">
                    Old Rate
                  </th>
                  <th className="text-right py-4 px-6 text-xs font-semibold text-slate-400 uppercase">
                    New Rate
                  </th>
                  <th className="text-right py-4 px-6 text-xs font-semibold text-slate-400 uppercase">
                    Change
                  </th>
                  <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase">
                    Date
                  </th>
                  <th className="text-left py-4 px-6 text-xs font-semibold text-slate-400 uppercase">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      No history available
                    </td>
                  </tr>
                ) : (
                  history
                    .filter(h => !showHistory || h.currency_code === showHistory)
                    .map((h) => (
                      <tr key={h.id} className="hover:bg-slate-700/30 transition-colors">
                        <td className="py-4 px-6">
                          <span className="font-mono font-semibold text-white">{h.currency_code}</span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <span className="font-mono text-slate-400">{h.old_rate?.toFixed(6) || 'N/A'}</span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <span className="font-mono font-semibold text-white">{h.new_rate.toFixed(6)}</span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          {h.old_rate && (
                            <span className={`flex items-center gap-1 justify-end font-semibold ${
                              parseFloat(calculateChangePercent(h.old_rate, h.new_rate)) > 0
                                ? 'text-green-400'
                                : 'text-red-400'
                            }`}>
                              <TrendingUp className={`w-4 h-4 ${
                                parseFloat(calculateChangePercent(h.old_rate, h.new_rate)) < 0 ? 'rotate-180' : ''
                              }`} />
                              {calculateChangePercent(h.old_rate, h.new_rate)}%
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-2 text-sm text-slate-400">
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
                          <span className="text-sm text-slate-400">{h.change_reason || 'No reason provided'}</span>
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
    </div>
  );
}
