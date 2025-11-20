'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  HardDrive,
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
  Activity,
  Plus,
  Trash2
} from 'lucide-react';
// API routes handle admin operations server-side

interface TokenStorageTier {
  minTokens: number;
  storageMB: number;
  configKey: string;
}

interface StorageStats {
  totalUsers: number;
  totalStorageUsedMB: number;
  totalStorageQuotaMB: number;
  averageUsagePercent: number;
}

interface UserStorageInfo {
  user_id: string;
  email: string;
  storage_quota_mb: number;
  storage_used_mb: number;
  usage_percent: number;
  status: string;
  total_tokens: number;
}

export default function StorageConfigPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [storageTiers, setStorageTiers] = useState<TokenStorageTier[]>([]);
  const [editingTier, setEditingTier] = useState<string | null>(null);
  const [editedMinTokens, setEditedMinTokens] = useState<number>(0);
  const [editedStorageMB, setEditedStorageMB] = useState<number>(0);

  const [showAddTier, setShowAddTier] = useState(false);
  const [newMinTokens, setNewMinTokens] = useState<number>(0);
  const [newStorageMB, setNewStorageMB] = useState<number>(0);

  const [storageStats, setStorageStats] = useState<StorageStats>({
    totalUsers: 0,
    totalStorageUsedMB: 0,
    totalStorageQuotaMB: 0,
    averageUsagePercent: 0,
  });

  const [topUsers, setTopUsers] = useState<UserStorageInfo[]>([]);

  useEffect(() => {
    loadStorageConfig();
    loadStorageStats();
  }, []);

  const loadStorageConfig = async () => {
    try {
      setLoading(true);
      setError(null);

      // Call API route to load tier configurations
      const response = await fetch('/api/admin/storage-tiers');
      const result = await response.json();

      if (!response.ok) throw new Error(result.error);

      if (result.data && result.data.length > 0) {
        const tiers: TokenStorageTier[] = result.data.map((c: any) => ({
          minTokens: parseInt(c.config_key.replace('storage_tokens_', ''), 10),
          storageMB: parseInt(c.config_value, 10),
          configKey: c.config_key,
        })).sort((a: TokenStorageTier, b: TokenStorageTier) => a.minTokens - b.minTokens);

        setStorageTiers(tiers);
      }
    } catch (err: any) {
      console.error('Failed to load storage config:', err);
      setError(err.message || 'Failed to load storage config');
    } finally {
      setLoading(false);
    }
  };

  const loadStorageStats = async () => {
    try {
      // Call API route to get statistics
      const response = await fetch('/api/admin/storage-stats');
      const result = await response.json();

      if (!response.ok) throw new Error(result.error);

      const { subscriptions, profiles } = result;

      if (subscriptions && subscriptions.length > 0) {
        const totalUsers = subscriptions.length;
        const totalStorageUsedMB = subscriptions.reduce((sum: number, s: any) => sum + (s.storage_used_mb || 0), 0);
        const totalStorageQuotaMB = subscriptions.reduce((sum: number, s: any) => sum + (s.storage_quota_mb || 0), 0);
        const averageUsagePercent = totalStorageQuotaMB > 0 ? (totalStorageUsedMB / totalStorageQuotaMB) * 100 : 0;

        setStorageStats({
          totalUsers,
          totalStorageUsedMB,
          totalStorageQuotaMB,
          averageUsagePercent,
        });

        if (profiles) {
          const usersWithUsage: UserStorageInfo[] = subscriptions
            .map((s: any) => {
              const profile = profiles.find((p: any) => p.id === s.user_id);
              const usagePercent = s.storage_quota_mb > 0
                ? (s.storage_used_mb / s.storage_quota_mb) * 100
                : 0;

              const totalTokens = (s.balance || 0) + (s.total_spent || 0) + (s.total_earned || 0);
              const pilotCredits = Math.floor(totalTokens / 10);

              return {
                user_id: s.user_id,
                email: profile?.email || 'Unknown',
                storage_used_mb: s.storage_used_mb || 0,
                storage_quota_mb: s.storage_quota_mb || 0,
                usage_percent: usagePercent,
                total_tokens: pilotCredits, // Convert to pilot credits
                status: s.status,
              };
            })
            .sort((a: UserStorageInfo, b: UserStorageInfo) => b.storage_used_mb - a.storage_used_mb);

          setTopUsers(usersWithUsage);
        }
      }
    } catch (err: any) {
      console.error('Failed to load storage stats:', err);
    }
  };

  const handleEditTier = (tier: TokenStorageTier) => {
    setEditingTier(tier.configKey);
    setEditedMinTokens(tier.minTokens);
    setEditedStorageMB(tier.storageMB);
  };

  const handleCancelEdit = () => {
    setEditingTier(null);
    setEditedMinTokens(0);
    setEditedStorageMB(0);
  };

  const handleSaveTier = async (tier: TokenStorageTier) => {
    try {
      setSaving(true);
      setError(null);

      const response = await fetch('/api/admin/storage-tiers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configKey: tier.configKey,
          storageMB: editedStorageMB,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error);

      setEditingTier(null);
      await loadStorageConfig();
      setSuccess('Tier updated successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error('Failed to save tier:', err);
      setError(err.message || 'Failed to save tier');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTier = async (tier: TokenStorageTier) => {
    if (!confirm(`Delete tier for ${tier.minTokens.toLocaleString()}+ tokens?`)) return;

    try {
      setSaving(true);
      setError(null);

      const response = await fetch(`/api/admin/storage-tiers?configKey=${encodeURIComponent(tier.configKey)}`, {
        method: 'DELETE',
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error);

      setStorageTiers(prev => prev.filter(t => t.configKey !== tier.configKey));
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
    if (!newMinTokens || !newStorageMB) {
      setError('Please enter both minimum tokens and storage quota');
      setTimeout(() => setError(null), 3000);
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const response = await fetch('/api/admin/storage-tiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minTokens: newMinTokens,
          storageMB: newStorageMB,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error);

      setShowAddTier(false);
      setNewMinTokens(0);
      setNewStorageMB(0);
      await loadStorageConfig();
      setSuccess('New tier added successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      console.error('Failed to add tier:', err);
      setError(err.message || 'Failed to add tier');
    } finally {
      setSaving(false);
    }
  };

  const formatStorage = (mb: number): string => {
    if (mb >= 1000000) {
      return `${(mb / 1000000).toFixed(1)} TB`;
    } else if (mb >= 1000) {
      return `${(mb / 1000).toFixed(1)} GB`;
    }
    return `${mb} MB`;
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
          <p className="text-slate-300">Loading storage configuration...</p>
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
            <div className="p-3 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl">
              <HardDrive className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Storage Management</h1>
              <p className="text-slate-400 text-sm">Configure storage quotas based on LLM tokens purchased</p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={loadStorageStats}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <Activity className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Load Stats
            </button>
            <button
              onClick={loadStorageConfig}
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

        {/* Storage Statistics */}
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
                <p className="text-white text-2xl font-bold">{storageStats.totalUsers}</p>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <Database className="w-5 h-5 text-purple-400" />
              </div>
              <div>
                <p className="text-slate-400 text-sm">Total Used</p>
                <p className="text-white text-2xl font-bold">
                  {formatStorage(storageStats.totalStorageUsedMB)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <HardDrive className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="text-slate-400 text-sm">Total Quota</p>
                <p className="text-white text-2xl font-bold">
                  {formatStorage(storageStats.totalStorageQuotaMB)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/20 rounded-lg">
                <TrendingUp className="w-5 h-5 text-orange-400" />
              </div>
              <div>
                <p className="text-slate-400 text-sm">Avg Usage</p>
                <p className="text-white text-2xl font-bold">
                  {storageStats.averageUsagePercent.toFixed(1)}%
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
                <Database className="w-5 h-5 text-blue-400" />
                Token-Based Storage Tiers
              </h2>
              <p className="text-slate-400 text-sm mt-1">
                Configure storage limits based on monthly subscription tier (monthly_credits field in user_subscriptions)
              </p>
            </div>
            <button
              onClick={() => setShowAddTier(true)}
              disabled={saving || showAddTier}
              className="flex items-center gap-2 px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg transition-colors disabled:opacity-50"
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
                    Storage Quota
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
                {storageTiers.map((tier, index) => (
                  <motion.tr
                    key={tier.configKey}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: index * 0.05 }}
                    className="hover:bg-slate-700/30 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-blue-400 rounded-full" />
                        <span className="text-white font-medium">
                          {tier.minTokens.toLocaleString()}+ tokens
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {editingTier === tier.configKey ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            value={editedStorageMB}
                            onChange={(e) => setEditedStorageMB(parseInt(e.target.value) || 0)}
                            className="bg-slate-900 border border-slate-600 rounded px-3 py-1 text-white w-32"
                            placeholder="MB"
                          />
                          <span className="text-slate-400 text-sm">MB</span>
                        </div>
                      ) : (
                        <span className="text-slate-300">{formatStorage(tier.storageMB)}</span>
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
                            className="p-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-lg transition-colors"
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
                  <Plus className="w-4 h-4 text-blue-400" />
                  Add New Storage Tier
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
                    Users with this monthly subscription tier will get this storage quota
                  </p>
                </div>

                <div>
                  <label className="text-xs text-slate-400 mb-2 block">
                    Storage Quota (MB) *
                  </label>
                  <input
                    type="number"
                    value={newStorageMB || ''}
                    onChange={(e) => setNewStorageMB(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white text-sm"
                    placeholder="e.g., 5000"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Storage quota in megabytes (1000 MB = 1 GB)
                  </p>
                </div>
              </div>

              {newMinTokens > 0 && newStorageMB > 0 && (
                <div className="mt-4 p-3 bg-slate-800/50 rounded-lg">
                  <p className="text-xs text-slate-400 mb-1">Preview:</p>
                  <p className="text-white text-sm">
                    Users with <span className="font-semibold text-blue-400">{newMinTokens.toLocaleString()}+</span> LLM tokens
                    will receive <span className="font-semibold text-green-400">{formatStorage(newStorageMB)}</span> of storage
                  </p>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 mt-4">
                <button
                  onClick={() => {
                    setShowAddTier(false);
                    setNewMinTokens(0);
                    setNewStorageMB(0);
                  }}
                  disabled={saving}
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddTier}
                  disabled={saving || !newMinTokens || !newStorageMB}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
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

        {/* Top Storage Users */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden"
        >
          <div className="p-6 border-b border-slate-700">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Activity className="w-5 h-5 text-purple-400" />
              Top Storage Users
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Users with highest storage consumption
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
                    <td colSpan={5} className="px-6 py-8 text-center text-slate-400">
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
                        <span className="text-slate-300">{formatStorage(user.storage_used_mb)}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-slate-300">{formatStorage(user.storage_quota_mb)}</span>
                      </td>
                      <td className="px-6 py-4">
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
