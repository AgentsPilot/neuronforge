'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/UserProvider';
import {
  Gift, Zap, Clock, Users, AlertCircle, CheckCircle,
  RefreshCw, Plus, Edit, Trash2, Save, X, Calendar
} from 'lucide-react';

interface RewardConfig {
  id: string;
  reward_key: string;
  reward_name: string;
  display_name: string;
  credits_amount: number;
  max_per_user: number | null;
  max_per_user_per_day: number | null;
  cooldown_hours: number | null;
  description: string | null;
  is_active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
}

export default function RewardConfigPage() {
  const { user } = useAuth();
  const [rewards, setRewards] = useState<RewardConfig[]>([]);
  const [defaultCredits, setDefaultCredits] = useState(100);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<RewardConfig>>({});
  const [showCreateForm, setShowCreateForm] = useState(false);

  const fetchRewards = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/reward-config');
      const data = await response.json();

      if (data.success) {
        setRewards(data.rewards);
        if (data.defaultCredits !== undefined) {
          setDefaultCredits(data.defaultCredits);
        }
      } else {
        setError(data.error || 'Failed to fetch reward config');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch reward config');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRewards();
  }, []);

  const handleEdit = (reward: RewardConfig) => {
    setEditingId(reward.id);
    setEditForm(reward);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleSave = async (rewardId: string) => {
    try {
      setSaving(true);
      const response = await fetch('/api/admin/reward-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          rewardId,
          updates: editForm
        })
      });

      const data = await response.json();

      if (data.success) {
        await fetchRewards();
        setEditingId(null);
        setEditForm({});
      } else {
        setError(data.error || 'Failed to update reward');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update reward');
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    try {
      setSaving(true);
      const response = await fetch('/api/admin/reward-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          updates: editForm
        })
      });

      const data = await response.json();

      if (data.success) {
        await fetchRewards();
        setShowCreateForm(false);
        setEditForm({});
      } else {
        setError(data.error || 'Failed to create reward');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create reward');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (rewardId: string) => {
    if (!confirm('Are you sure you want to delete this reward configuration?')) {
      return;
    }

    try {
      setSaving(true);
      const response = await fetch('/api/admin/reward-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          rewardId
        })
      });

      const data = await response.json();

      if (data.success) {
        await fetchRewards();
      } else {
        setError(data.error || 'Failed to delete reward');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete reward');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (reward: RewardConfig) => {
    try {
      setSaving(true);
      const response = await fetch('/api/admin/reward-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          rewardId: reward.id,
          updates: { is_active: !reward.is_active }
        })
      });

      const data = await response.json();

      if (data.success) {
        await fetchRewards();
      } else {
        setError(data.error || 'Failed to toggle reward status');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to toggle reward status');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Gift className="w-8 h-8 text-purple-400" />
            Reward Configuration
          </h1>
          <p className="text-slate-400 mt-2">
            Manage reward credits and distribution rules
          </p>
        </div>
        <button
          onClick={() => {
            setShowCreateForm(true);
            setEditForm({
              is_active: true,
              cooldown_hours: 0,
              credits_amount: defaultCredits
            });
          }}
          className="px-4 py-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200 flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          Add Reward
        </button>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/50 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <span className="text-red-400">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <div className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-6">
          <h2 className="text-xl font-bold text-white mb-4">Create New Reward</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Reward Key
              </label>
              <input
                type="text"
                value={editForm.reward_key || ''}
                onChange={(e) => setEditForm({ ...editForm, reward_key: e.target.value })}
                className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., daily_login"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Reward Name
              </label>
              <input
                type="text"
                value={editForm.reward_name || ''}
                onChange={(e) => setEditForm({ ...editForm, reward_name: e.target.value })}
                className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Daily Login Bonus"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Display Name
              </label>
              <input
                type="text"
                value={editForm.display_name || ''}
                onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Daily Login"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Credits Amount
              </label>
              <input
                type="number"
                value={editForm.credits_amount || 0}
                onChange={(e) => setEditForm({ ...editForm, credits_amount: parseInt(e.target.value) })}
                className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Max Per User (null = unlimited)
              </label>
              <input
                type="number"
                value={editForm.max_per_user || ''}
                onChange={(e) => setEditForm({ ...editForm, max_per_user: e.target.value ? parseInt(e.target.value) : null })}
                className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Max Per User Per Day (null = unlimited)
              </label>
              <input
                type="number"
                value={editForm.max_per_user_per_day || ''}
                onChange={(e) => setEditForm({ ...editForm, max_per_user_per_day: e.target.value ? parseInt(e.target.value) : null })}
                className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Cooldown Hours
              </label>
              <input
                type="number"
                value={editForm.cooldown_hours || 0}
                onChange={(e) => setEditForm({ ...editForm, cooldown_hours: parseInt(e.target.value) })}
                className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Description
              </label>
              <textarea
                value={editForm.description || ''}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                className="w-full px-4 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
              />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleCreate}
              disabled={saving}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              Create
            </button>
            <button
              onClick={() => {
                setShowCreateForm(false);
                setEditForm({});
              }}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors flex items-center gap-2"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Rewards List */}
      <div className="grid gap-4">
        {rewards.map((reward) => {
          const isEditing = editingId === reward.id;

          return (
            <div
              key={reward.id}
              className="bg-slate-800/50 backdrop-blur-sm border border-white/10 rounded-xl p-6 hover:border-white/20 transition-all duration-200"
            >
              {isEditing ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Display Name
                      </label>
                      <input
                        type="text"
                        value={editForm.display_name || ''}
                        onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Credits Amount
                      </label>
                      <input
                        type="number"
                        value={editForm.credits_amount || 0}
                        onChange={(e) => setEditForm({ ...editForm, credits_amount: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Cooldown Hours
                      </label>
                      <input
                        type="number"
                        value={editForm.cooldown_hours || 0}
                        onChange={(e) => setEditForm({ ...editForm, cooldown_hours: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Max Per User
                      </label>
                      <input
                        type="number"
                        value={editForm.max_per_user || ''}
                        onChange={(e) => setEditForm({ ...editForm, max_per_user: e.target.value ? parseInt(e.target.value) : null })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        placeholder="unlimited"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Max Per User Per Day
                      </label>
                      <input
                        type="number"
                        value={editForm.max_per_user_per_day || ''}
                        onChange={(e) => setEditForm({ ...editForm, max_per_user_per_day: e.target.value ? parseInt(e.target.value) : null })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        placeholder="unlimited"
                      />
                    </div>
                    <div className="md:col-span-3">
                      <label className="block text-sm font-medium text-slate-300 mb-2">
                        Description
                      </label>
                      <textarea
                        value={editForm.description || ''}
                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-white/10 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                        rows={2}
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSave(reward.id)}
                      disabled={saving}
                      className="px-3 py-2 bg-green-500 hover:bg-green-600 rounded-lg transition-colors flex items-center gap-2 text-sm disabled:opacity-50"
                    >
                      <Save className="w-4 h-4" />
                      Save
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors flex items-center gap-2 text-sm"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-3 h-3 rounded-full ${reward.is_active ? 'bg-green-400' : 'bg-slate-500'}`} />
                      <h3 className="text-xl font-bold text-white">{reward.display_name}</h3>
                      <span className="px-2 py-1 bg-slate-700 rounded text-xs text-slate-300 font-mono">
                        {reward.reward_key}
                      </span>
                    </div>

                    {reward.description && (
                      <p className="text-slate-400 text-sm mb-4">{reward.description}</p>
                    )}

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-yellow-400" />
                        <span className="text-sm text-slate-300">
                          <span className="font-bold text-white">{reward.credits_amount}</span> credits
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-blue-400" />
                        <span className="text-sm text-slate-300">
                          {reward.cooldown_hours}h cooldown
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-purple-400" />
                        <span className="text-sm text-slate-300">
                          Max: {reward.max_per_user || '∞'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-green-400" />
                        <span className="text-sm text-slate-300">
                          Daily: {reward.max_per_user_per_day || '∞'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => handleToggleActive(reward)}
                      disabled={saving}
                      className={`p-2 rounded-lg transition-colors ${
                        reward.is_active
                          ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                          : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                      } disabled:opacity-50`}
                      title={reward.is_active ? 'Active' : 'Inactive'}
                    >
                      <CheckCircle className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleEdit(reward)}
                      className="p-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors"
                      title="Edit"
                    >
                      <Edit className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDelete(reward.id)}
                      disabled={saving}
                      className="p-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50"
                      title="Delete"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {rewards.length === 0 && !showCreateForm && (
        <div className="text-center py-12">
          <Gift className="w-16 h-16 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400">No reward configurations found</p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="mt-4 px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
          >
            Create Your First Reward
          </button>
        </div>
      )}
    </div>
  );
}
