'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/UserProvider';
import {
  Gift, Zap, Clock, Users, AlertCircle, CheckCircle,
  RefreshCw, Plus, Edit, Trash2, Save, X, Calendar,
  Settings, ChevronUp, ChevronDown
} from 'lucide-react';

interface RewardSettings {
  id: string;
  min_executions: number | null;
  min_success_rate: number | null;
  require_description: boolean;
  min_description_length: number | null;
  min_agent_age_hours: number | null;
  max_shares_per_month: number | null;
  max_total_shares: number | null;
}

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
  settings?: RewardSettings | null;
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

  // Settings state
  const [expandedSettings, setExpandedSettings] = useState<string | null>(null);
  const [editingSettings, setEditingSettings] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState<Partial<RewardSettings>>({});
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(Date.now()); // Force re-render key

  const fetchRewards = async () => {
    try {
      setLoading(true);
      // Add cache busting with timestamp and no-store cache policy
      const response = await fetch(`/api/admin/reward-config?t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });
      const data = await response.json();

      console.log('📦 [fetchRewards] Received data:', data);

      if (data.success) {
        setRewards(data.rewards);
        setLastUpdate(Date.now()); // Force component re-render
        console.log('📦 [fetchRewards] Updated rewards state:', data.rewards);
        console.log('📦 [fetchRewards] Set lastUpdate to force re-render');
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

  // Settings handlers
  const handleEditSettings = (reward: RewardConfig) => {
    setEditingSettings(reward.id);
    setSettingsForm(reward.settings || {
      min_executions: 3,
      min_success_rate: 66,
      require_description: true,
      min_description_length: 20,
      min_agent_age_hours: 1,
      max_shares_per_month: 20,
      max_total_shares: 100
    });
  };

  const handleCancelSettingsEdit = () => {
    setEditingSettings(null);
    setSettingsForm({});
  };

  const handleSaveSettings = async (rewardId: string) => {
    console.log('🔥 SAVE BUTTON CLICKED - handleSaveSettings called with rewardId:', rewardId);
    console.log('🔥 Current settingsForm state:', settingsForm);

    try {
      setSaving(true);
      setSettingsError(null);
      setSettingsSuccess(null);

      console.log('💾 Saving settings for reward:', rewardId);
      console.log('📝 Settings form:', settingsForm);

      const response = await fetch('/api/admin/reward-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateSettings',
          rewardId,
          settings: settingsForm
        })
      });

      const data = await response.json();
      console.log('📥 Response:', data);

      if (data.success) {
        console.log('✅ Settings saved successfully');
        console.log('✅ Saved settings data from API:', data.settings);

        // Fetch updated data first
        console.log('🔄 Calling fetchRewards to get fresh data...');
        await fetchRewards();
        console.log('🔄 fetchRewards completed');

        // Then exit edit mode and show success message
        setEditingSettings(null);
        setSettingsForm({});
        setSettingsSuccess('Sharing requirements updated successfully');
        console.log('✅ Success message set, should appear in view mode');

        // Auto-clear success message after 5 seconds
        setTimeout(() => {
          console.log('⏰ Clearing success message');
          setSettingsSuccess(null);
        }, 5000);
      } else {
        console.error('❌ Failed to save settings:', data.error);
        setSettingsError(data.error || 'Failed to update settings');
      }
    } catch (err: any) {
      console.error('❌ Exception while saving settings:', err);
      setSettingsError(err.message || 'Failed to update settings');
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

              {/* Settings Section for agent_sharing reward */}
              {reward.reward_key === 'agent_sharing' && editingId !== reward.id && (
                <div className="mt-4 border-t border-slate-700 pt-4" key={`settings-${reward.id}-${lastUpdate}`}>
                  <button
                    onClick={() => setExpandedSettings(expandedSettings === reward.id ? null : reward.id)}
                    className="flex items-center gap-2 text-slate-300 hover:text-white transition-colors text-sm font-medium"
                  >
                    <Settings className="w-4 h-4" />
                    <span>Sharing Requirements</span>
                    {expandedSettings === reward.id ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>

                  {expandedSettings === reward.id && (
                    <div className="mt-4 bg-slate-800/50 rounded-lg p-4">
                      {(() => {
                        console.log('🎨 [Render] Rendering settings for reward:', reward.id);
                        console.log('🎨 [Render] Current settings:', reward.settings);
                        console.log('🎨 [Render] lastUpdate timestamp:', lastUpdate);
                        return null;
                      })()}
                      {editingSettings === reward.id ? (
                        <div className="space-y-4">
                          <h4 className="text-sm font-semibold text-white mb-3">Edit Sharing Requirements</h4>

                          {/* Agent Quality Thresholds */}
                          <div className="space-y-4">
                            <div>
                              <label className="block text-xs font-medium text-slate-300 mb-1">Min Executions</label>
                              <input
                                type="number"
                                value={settingsForm.min_executions ?? 3}
                                onChange={(e) => setSettingsForm({...settingsForm, min_executions: parseInt(e.target.value)})}
                                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                              />
                              <p className="text-xs text-slate-500 mt-1">Minimum number of successful test runs required before agent can be shared</p>
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-slate-300 mb-1">Min Success Rate (%)</label>
                              <input
                                type="number"
                                value={settingsForm.min_success_rate ?? 66}
                                onChange={(e) => setSettingsForm({...settingsForm, min_success_rate: parseInt(e.target.value)})}
                                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                              />
                              <p className="text-xs text-slate-500 mt-1">Minimum percentage of successful executions (0-100)</p>
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-slate-300 mb-1">Min Description Length</label>
                              <input
                                type="number"
                                value={settingsForm.min_description_length ?? 20}
                                onChange={(e) => setSettingsForm({...settingsForm, min_description_length: parseInt(e.target.value)})}
                                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                              />
                              <p className="text-xs text-slate-500 mt-1">Minimum character length for agent description to ensure quality</p>
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-slate-300 mb-1">Min Agent Age (hours)</label>
                              <input
                                type="number"
                                step="0.1"
                                value={settingsForm.min_agent_age_hours ?? 1}
                                onChange={(e) => setSettingsForm({...settingsForm, min_agent_age_hours: parseFloat(e.target.value)})}
                                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                              />
                              <p className="text-xs text-slate-500 mt-1">How long agent must exist before sharing (prevents spam)</p>
                            </div>
                          </div>

                          {/* User Rate Limits */}
                          <div className="border-t border-slate-700 pt-4 mt-4">
                            <h5 className="text-xs font-semibold text-slate-300 mb-3">User Rate Limits</h5>
                            <p className="text-xs text-slate-400 mb-3">
                              Note: Daily limit is managed in the main reward config (Max Per User Per Day)
                            </p>
                            <div className="space-y-4">
                              <div>
                                <label className="block text-xs font-medium text-slate-300 mb-1">Max Per Month</label>
                                <input
                                  type="number"
                                  value={settingsForm.max_shares_per_month ?? 20}
                                  onChange={(e) => setSettingsForm({...settingsForm, max_shares_per_month: parseInt(e.target.value)})}
                                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                                />
                                <p className="text-xs text-slate-500 mt-1">Maximum agents a user can share in 30 days</p>
                              </div>

                              <div>
                                <label className="block text-xs font-medium text-slate-300 mb-1">Max Total (Lifetime)</label>
                                <input
                                  type="number"
                                  value={settingsForm.max_total_shares ?? 100}
                                  onChange={(e) => setSettingsForm({...settingsForm, max_total_shares: parseInt(e.target.value)})}
                                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm"
                                />
                                <p className="text-xs text-slate-500 mt-1">Maximum total agents a user can share (lifetime limit)</p>
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex gap-2 justify-end pt-4 border-t border-slate-700">
                            <button
                              onClick={handleCancelSettingsEdit}
                              className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors text-sm"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleSaveSettings(reward.id)}
                              disabled={saving}
                              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 text-sm flex items-center gap-2"
                            >
                              {saving ? (
                                <>
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                  Saving...
                                </>
                              ) : (
                                <>
                                  <Save className="w-4 h-4" />
                                  Save Settings
                                </>
                              )}
                            </button>
                          </div>

                          {/* Success/Error Messages */}
                          {settingsSuccess && (
                            <div className="mt-4 bg-green-500/10 border border-green-500/50 rounded-lg p-3 flex items-start gap-2">
                              <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                              <p className="text-green-400 text-sm">{settingsSuccess}</p>
                            </div>
                          )}

                          {settingsError && (
                            <div className="mt-4 bg-red-500/10 border border-red-500/50 rounded-lg p-3 flex items-start gap-2">
                              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                              <p className="text-red-400 text-sm">{settingsError}</p>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-white">Current Requirements</h4>
                            <button
                              onClick={() => handleEditSettings(reward)}
                              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                            >
                              <Edit className="w-3 h-3" />
                              Edit
                            </button>
                          </div>

                          <div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <span className="text-slate-400">Min Executions:</span>
                                <span className="ml-2 text-white font-semibold">{reward.settings?.min_executions ?? '3 (default)'}</span>
                              </div>
                              <div>
                                <span className="text-slate-400">Success Rate:</span>
                                <span className="ml-2 text-white font-semibold">{reward.settings?.min_success_rate ?? '66 (default)'}%</span>
                              </div>
                              <div>
                                <span className="text-slate-400">Description:</span>
                                <span className="ml-2 text-white font-semibold">{reward.settings?.min_description_length ?? '20 (default)'} chars</span>
                              </div>
                              <div>
                                <span className="text-slate-400">Agent Age:</span>
                                <span className="ml-2 text-white font-semibold">{reward.settings?.min_agent_age_hours ?? '1 (default)'}h</span>
                              </div>
                              <div>
                                <span className="text-slate-400">Monthly Limit:</span>
                                <span className="ml-2 text-white font-semibold">{reward.settings?.max_shares_per_month ?? '20 (default)'}</span>
                              </div>
                              <div>
                                <span className="text-slate-400">Lifetime Limit:</span>
                                <span className="ml-2 text-white font-semibold">{reward.settings?.max_total_shares ?? '100 (default)'}</span>
                              </div>
                            </div>
                            <p className="text-xs text-slate-500 mt-3">
                              Daily limit is managed in main reward config (currently: {reward.max_per_user_per_day ?? 'unlimited'})
                            </p>
                          </div>

                          {/* Success Message in View Mode */}
                          {settingsSuccess && (
                            <div className="mt-4 bg-green-500/10 border border-green-500/50 rounded-lg p-3 flex items-start gap-2">
                              <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0 mt-0.5" />
                              <p className="text-green-400 text-sm">{settingsSuccess}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
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
