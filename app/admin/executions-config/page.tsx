'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Database,
  Edit,
  X,
  Check,
  Users,
  TrendingUp,
  Zap,
  Plus,
  Trash2
} from 'lucide-react';
// API routes handle admin operations server-side

interface TokenExecutionTier {
  minTokens: number;
  executionsQuota: number | null; // null = unlimited
  configKey: string;
}

interface ExecutionStats {
  totalUsers: number;
  totalExecutionsUsed: number;
  averageExecutionsPerUser: number;
  usersWithQuota: number;
}

interface UserExecutionInfo {
  user_id: string;
  email: string;
  executions_quota: number | null;
  executions_used: number;
  usage_percent: number;
  status: string;
  total_tokens: number;
}

export default function ExecutionsConfigPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [executionTiers, setExecutionTiers] = useState<TokenExecutionTier[]>([]);
  const [editingTier, setEditingTier] = useState<string | null>(null);
  const [editedMinTokens, setEditedMinTokens] = useState<number>(0);
  const [editedExecutionsQuota, setEditedExecutionsQuota] = useState<string>('');

  const [showAddTier, setShowAddTier] = useState(false);
  const [newMinTokens, setNewMinTokens] = useState<number>(0);
  const [newExecutionsQuota, setNewExecutionsQuota] = useState<string>('');

  const [executionStats, setExecutionStats] = useState<ExecutionStats>({
    totalUsers: 0,
    totalExecutionsUsed: 0,
    averageExecutionsPerUser: 0,
    usersWithQuota: 0,
  });

  const [topUsers, setTopUsers] = useState<UserExecutionInfo[]>([]);

  useEffect(() => {
    loadExecutionConfig();
    loadExecutionStats();
  }, []);

  const loadExecutionConfig = async () => {
    try {
      setLoading(true);
      setError(null);

      // Call API route to load tier configurations
      const response = await fetch('/api/admin/execution-tiers');
      const result = await response.json();

      if (!response.ok) throw new Error(result.error);

      if (result.data && result.data.length > 0) {
        const tiers: TokenExecutionTier[] = result.data.map((c: any) => ({
          minTokens: parseInt(c.config_key.replace('executions_tokens_', ''), 10),
          executionsQuota: c.config_value === 'null' ? null : parseInt(c.config_value, 10),
          configKey: c.config_key,
        })).sort((a: TokenExecutionTier, b: TokenExecutionTier) => a.minTokens - b.minTokens);

        setExecutionTiers(tiers);
      }
    } catch (err: any) {
      console.error('Failed to load execution config:', err);
      setError(err.message || 'Failed to load execution config');
    } finally {
      setLoading(false);
    }
  };

  const loadExecutionStats = async () => {
    try {
      // Call API route to get statistics
      const response = await fetch('/api/admin/execution-stats');
      const result = await response.json();

      if (!response.ok) throw new Error(result.error);

      const { subscriptions, profiles } = result;

      if (subscriptions && subscriptions.length > 0) {
        const totalUsers = subscriptions.length;
        const totalExecutionsUsed = subscriptions.reduce((sum: number, s: any) => sum + (s.executions_used || 0), 0);
        const usersWithQuota = subscriptions.filter((s: any) => s.executions_quota !== null).length;
        const averageExecutionsPerUser = totalUsers > 0 ? totalExecutionsUsed / totalUsers : 0;

        setExecutionStats({
          totalUsers,
          totalExecutionsUsed,
          averageExecutionsPerUser,
          usersWithQuota,
        });

        if (profiles) {
          const usersWithUsage: UserExecutionInfo[] = subscriptions
            .map((s: any) => {
              const profile = profiles.find((p: any) => p.id === s.user_id);
              const quota = s.executions_quota;
              const used = s.executions_used || 0;
              const usagePercent = quota !== null && quota > 0 ? (used / quota) * 100 : 0;

              // Convert current balance to pilot credits
              const pilotCredits = Math.floor((s.balance || 0) / 10);

              return {
                user_id: s.user_id,
                email: profile?.email || 'Unknown',
                executions_used: used,
                executions_quota: quota,
                usage_percent: usagePercent,
                total_tokens: pilotCredits, // Current pilot credit balance
                status: s.status,
              };
            })
            .sort((a: UserExecutionInfo, b: UserExecutionInfo) => b.executions_used - a.executions_used);

          setTopUsers(usersWithUsage);
        }
      }
    } catch (err: any) {
      console.error('Failed to load execution stats:', err);
    }
  };

  const handleEditTier = (tier: TokenExecutionTier) => {
    setEditingTier(tier.configKey);
    setEditedMinTokens(tier.minTokens);
    setEditedExecutionsQuota(tier.executionsQuota === null ? 'unlimited' : tier.executionsQuota.toString());
  };

  const handleCancelEdit = () => {
    setEditingTier(null);
    setEditedMinTokens(0);
    setEditedExecutionsQuota('');
  };

  const handleSaveTier = async (tier: TokenExecutionTier) => {
    try {
      setSaving(true);
      setError(null);

      const response = await fetch('/api/admin/execution-tiers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configKey: tier.configKey,
          executionsQuota: editedExecutionsQuota,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error);

      setEditingTier(null);
      await loadExecutionConfig();
      setSuccess('Tier updated successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error('Failed to save tier:', err);
      setError(err.message || 'Failed to save tier');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTier = async (tier: TokenExecutionTier) => {
    if (!confirm(`Delete tier for ${tier.minTokens.toLocaleString()}+ tokens?`)) return;

    try {
      setSaving(true);
      setError(null);

      const response = await fetch(`/api/admin/execution-tiers?configKey=${encodeURIComponent(tier.configKey)}`, {
        method: 'DELETE',
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error);

      setExecutionTiers(prev => prev.filter(t => t.configKey !== tier.configKey));
      setSuccess('Tier deleted successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error('Failed to delete tier:', err);
      setError(err.message || 'Failed to delete tier');
    } finally {
      setSaving(false);
    }
  };

  const handleAddTier = async () => {
    if (!newMinTokens || !newExecutionsQuota) {
      setError('Please enter both minimum tokens and execution quota');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const response = await fetch('/api/admin/execution-tiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minTokens: newMinTokens,
          executionsQuota: newExecutionsQuota,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error);

      setShowAddTier(false);
      setNewMinTokens(0);
      setNewExecutionsQuota('');
      await loadExecutionConfig();
      setSuccess('New tier added successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error('Failed to add tier:', err);
      setError(err.message || 'Failed to add tier');
    } finally {
      setSaving(false);
    }
  };

  const formatQuota = (quota: number | null): string => {
    if (quota === null) return 'Unlimited';
    return quota.toLocaleString();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          <RefreshCw className="w-12 h-12 text-blue-400 animate-spin mx-auto mb-4" />
          <p className="text-slate-300">Loading execution configuration...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Execution Quota Management</h1>
              <p className="text-slate-400 text-sm">Configure execution limits based on LLM tokens purchased</p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={loadExecutionStats}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
            >
              <Activity className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Load Stats
            </button>
            <button
              onClick={loadExecutionConfig}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors border border-slate-700"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh Config
            </button>
          </div>
        </motion.div>

        {/* Alerts */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-red-400 font-medium">Error</h3>
              <p className="text-red-300 text-sm mt-1">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {success && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-green-500/10 border border-green-500/50 rounded-lg p-4 flex items-start gap-3"
          >
            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-green-400 font-medium">Success</h3>
              <p className="text-green-300 text-sm mt-1">{success}</p>
            </div>
          </motion.div>
        )}

        {/* Execution Statistics */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 md:grid-cols-4 gap-4"
        >
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Users className="w-5 h-5 text-blue-400" />
              </div>
              <div>
                <p className="text-slate-400 text-sm">Total Users</p>
                <p className="text-white text-2xl font-bold">{executionStats.totalUsers}</p>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <Zap className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <p className="text-slate-400 text-sm">Total Executions</p>
                <p className="text-white text-2xl font-bold">
                  {executionStats.totalExecutionsUsed.toLocaleString()}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <TrendingUp className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="text-slate-400 text-sm">Avg per User</p>
                <p className="text-white text-2xl font-bold">
                  {Math.round(executionStats.averageExecutionsPerUser)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/20 rounded-lg">
                <Database className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <p className="text-slate-400 text-sm">With Quota</p>
                <p className="text-white text-2xl font-bold">
                  {executionStats.usersWithQuota}
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Token-Based Tier Configuration */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden"
        >
          <div className="p-6 border-b border-slate-700 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Database className="w-5 h-5 text-purple-400" />
                Token-Based Execution Tiers
              </h2>
              <p className="text-slate-400 text-sm mt-1">
                Configure execution limits based on monthly subscription tier (monthly_credits field in user_subscriptions)
              </p>
            </div>
            <button
              onClick={() => setShowAddTier(true)}
              disabled={saving || showAddTier}
              className="flex items-center gap-2 px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded-lg transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              Add Tier
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-900/50">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Minimum LLM Tokens
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Execution Quota
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Config Key
                  </th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {executionTiers.map((tier, index) => (
                  <motion.tr
                    key={tier.configKey}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: index * 0.05 }}
                    className="hover:bg-slate-700/30 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-purple-400 rounded-full" />
                        <span className="text-white font-medium">
                          {tier.minTokens.toLocaleString()}+ tokens
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {editingTier === tier.configKey ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editedExecutionsQuota}
                            onChange={(e) => setEditedExecutionsQuota(e.target.value)}
                            className="bg-slate-900 border border-slate-600 rounded px-3 py-1 text-white w-40"
                            placeholder="unlimited or number"
                          />
                        </div>
                      ) : (
                        <span className={`${tier.executionsQuota === null ? 'text-green-400' : 'text-slate-300'} font-medium`}>
                          {formatQuota(tier.executionsQuota)}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <code className="text-xs text-slate-400 bg-slate-900/50 px-2 py-1 rounded">
                        {tier.configKey}
                      </code>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {editingTier === tier.configKey ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleSaveTier(tier)}
                            disabled={saving}
                            className="p-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-lg transition-colors"
                            title="Save"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            disabled={saving}
                            className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleEditTier(tier)}
                            className="p-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteTier(tier)}
                            className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add New Tier Form */}
          {showAddTier && (
            <div className="p-6 bg-slate-700/50 border-t border-slate-700">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-600">
                <h4 className="text-white font-semibold flex items-center gap-2">
                  <Plus className="w-4 h-4 text-purple-400" />
                  Add New Execution Tier
                </h4>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-slate-400 mb-2 block">
                    Minimum LLM Tokens *
                  </label>
                  <input
                    type="number"
                    value={newMinTokens || ''}
                    onChange={(e) => setNewMinTokens(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-sm"
                    placeholder="e.g., 100000"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Users with this monthly subscription tier will get this execution quota
                  </p>
                </div>

                <div>
                  <label className="text-xs text-slate-400 mb-2 block">
                    Execution Quota *
                  </label>
                  <input
                    type="text"
                    value={newExecutionsQuota}
                    onChange={(e) => setNewExecutionsQuota(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-sm"
                    placeholder="e.g., 1000 or unlimited"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Enter a number or "unlimited" for no limit
                  </p>
                </div>
              </div>

              {newMinTokens > 0 && newExecutionsQuota && (
                <div className="mt-4 p-3 bg-slate-800/50 rounded-lg">
                  <p className="text-xs text-slate-400 mb-1">Preview:</p>
                  <p className="text-white text-sm">
                    Users with <span className="font-semibold text-purple-400">{newMinTokens.toLocaleString()}+</span> LLM tokens
                    will receive {
                      newExecutionsQuota.toLowerCase() === 'unlimited'
                        ? <span className="font-semibold text-green-400">unlimited</span>
                        : <span className="font-semibold text-yellow-400">{parseInt(newExecutionsQuota).toLocaleString()}</span>
                    } executions
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 mt-4">
                <button
                  onClick={() => {
                    setShowAddTier(false);
                    setNewMinTokens(0);
                    setNewExecutionsQuota('');
                  }}
                  disabled={saving}
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddTier}
                  disabled={saving || !newMinTokens || !newExecutionsQuota}
                  className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Add Tier
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </motion.div>

        {/* Top Execution Users */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden"
        >
          <div className="p-6 border-b border-slate-700">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-pink-400" />
              Top Execution Users
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Users with highest execution counts
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-900/50">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    User
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Pilot Tokens
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Used
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Quota
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Usage %
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {topUsers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-slate-400">
                      No users found
                    </td>
                  </tr>
                ) : (
                  topUsers.map((user, index) => (
                    <tr
                      key={user.user_id}
                      className="hover:bg-slate-700/30 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div>
                          <p className="text-white text-sm">{user.email}</p>
                          <p className="text-slate-400 text-xs">{user.user_id.slice(0, 8)}...</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-slate-300">{user.total_tokens.toLocaleString()}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-slate-300">{user.executions_used.toLocaleString()}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={user.executions_quota === null ? 'text-green-400 font-medium' : 'text-slate-300'}>
                          {formatQuota(user.executions_quota)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {user.executions_quota === null ? (
                          <span className="text-green-400 text-sm">No limit</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 bg-slate-700 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${
                                  user.usage_percent >= 90
                                    ? 'bg-red-500'
                                    : user.usage_percent >= 70
                                    ? 'bg-orange-500'
                                    : 'bg-green-500'
                                }`}
                                style={{ width: `${Math.min(user.usage_percent, 100)}%` }}
                              />
                            </div>
                            <span className="text-slate-300 text-sm">
                              {user.usage_percent.toFixed(1)}%
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                            user.status === 'active'
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-slate-500/20 text-slate-400'
                          }`}
                        >
                          {user.status}
                        </span>
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
