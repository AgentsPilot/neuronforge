'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Settings,
  Users,
  Save,
  RefreshCw,
  Database,
  HardDrive,
  Zap,
  AlertCircle,
  CheckCircle,
  TrendingUp,
  UserCheck,
  Clock,
  Mail,
  Building,
  Briefcase,
  Target,
  Workflow
} from 'lucide-react';

interface FreeTierConfig {
  free_pilot_tokens: number;
  free_storage_mb: number;
  free_executions: number | null; // null = unlimited
  free_tier_duration_days: number;
}

interface UserWithOnboarding {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
  onboarding_completed: boolean;
  company?: string;
  job_title?: string;
  onboarding_goal?: string;
  onboarding_mode?: string;
  role?: string;
  balance?: number;
  storage_quota_mb?: number;
  executions_quota?: number | null;
}

export default function OnboardingConfigPage() {
  const [activeTab, setActiveTab] = useState<'config' | 'users'>('config');

  // Free tier config state
  const [config, setConfig] = useState<FreeTierConfig>({
    free_pilot_tokens: 20834,
    free_storage_mb: 1000,
    free_executions: null,
    free_tier_duration_days: 30,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  // User list state
  const [users, setUsers] = useState<UserWithOnboarding[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [filterOnboarding, setFilterOnboarding] = useState<'all' | 'completed' | 'incomplete'>('all');

  // Load current config
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const response = await fetch('/api/admin/onboarding-config');
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to load configuration');
      }

      setConfig(result.data);
    } catch (error) {
      console.error('Error loading config:', error);
      setSaveMessage({ type: 'error', text: 'Failed to load configuration' });
    }
  };

  const saveConfig = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const response = await fetch('/api/admin/onboarding-config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          free_pilot_tokens: config.free_pilot_tokens,
          free_storage_mb: config.free_storage_mb,
          free_executions: config.free_executions,
          free_tier_duration_days: config.free_tier_duration_days,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to save configuration');
      }

      setSaveMessage({ type: 'success', text: 'Free tier configuration saved successfully!' });
      setTimeout(() => setSaveMessage(null), 5000);
    } catch (error) {
      console.error('Error saving config:', error);
      setSaveMessage({ type: 'error', text: 'Failed to save configuration. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  const loadUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const response = await fetch(`/api/admin/onboarding-users?filter=${filterOnboarding}`);
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to load users');
      }

      setUsers(result.data || []);
    } catch (error) {
      console.error('Error loading users:', error);
      setUsers([]);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'users') {
      loadUsers();
    }
  }, [activeTab, filterOnboarding]);

  const filteredUsers = users.filter(user => {
    if (filterOnboarding === 'completed') return user.onboarding_completed;
    if (filterOnboarding === 'incomplete') return !user.onboarding_completed;
    return true;
  });

  const stats = {
    total: users.length,
    completed: users.filter(u => u.onboarding_completed).length,
    incomplete: users.filter(u => !u.onboarding_completed).length,
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Onboarding Management</h1>
          <p className="text-slate-400">Configure free tier quotas and monitor user onboarding</p>
        </div>
        <div className="flex items-center gap-3">
          {activeTab === 'users' && (
            <button
              onClick={loadUsers}
              disabled={isLoadingUsers}
              className="p-2 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingUsers ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-2 border border-white/10 inline-flex gap-2">
        <button
          onClick={() => setActiveTab('config')}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
            activeTab === 'config'
              ? 'bg-gradient-to-r from-blue-500/20 to-purple-500/20 text-white border border-blue-400/30'
              : 'text-slate-300 hover:text-white hover:bg-white/5'
          }`}
        >
          <Settings className="w-4 h-4 inline-block mr-2" />
          Free Tier Configuration
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
            activeTab === 'users'
              ? 'bg-gradient-to-r from-blue-500/20 to-purple-500/20 text-white border border-blue-400/30'
              : 'text-slate-300 hover:text-white hover:bg-white/5'
          }`}
        >
          <Users className="w-4 h-4 inline-block mr-2" />
          User List ({users.length})
        </button>
      </div>

      {/* Configuration Tab */}
      {activeTab === 'config' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10">
            <h2 className="text-xl font-bold text-white mb-2">Free Tier Quotas</h2>
            <p className="text-sm text-slate-400 mb-6">
              Configure the default quotas granted to new users upon signup or onboarding completion.
            </p>

            <div className="space-y-6">
              {/* Pilot Tokens */}
              <div className="bg-gradient-to-br from-blue-500/10 to-purple-500/10 rounded-xl p-5 border border-blue-500/20">
                <div className="flex items-center mb-3">
                  <div className="p-2 bg-blue-500/20 rounded-lg mr-3">
                    <Database className="w-5 h-5 text-blue-300" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-white">
                      Free Pilot Tokens
                    </label>
                    <p className="text-xs text-slate-400">
                      1 Pilot Token = 10 raw LLM tokens
                    </p>
                  </div>
                </div>
                <input
                  type="number"
                  value={config.free_pilot_tokens}
                  onChange={(e) => setConfig({ ...config, free_pilot_tokens: parseInt(e.target.value) || 0 })}
                  className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min="0"
                />
                <p className="text-xs text-blue-300 mt-2">
                  = {(config.free_pilot_tokens * 10).toLocaleString()} raw tokens
                </p>
              </div>

              {/* Storage Quota */}
              <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 rounded-xl p-5 border border-green-500/20">
                <div className="flex items-center mb-3">
                  <div className="p-2 bg-green-500/20 rounded-lg mr-3">
                    <HardDrive className="w-5 h-5 text-green-300" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-white">
                      Free Storage Quota (MB)
                    </label>
                    <p className="text-xs text-slate-400">
                      Storage quota in megabytes
                    </p>
                  </div>
                </div>
                <input
                  type="number"
                  value={config.free_storage_mb}
                  onChange={(e) => setConfig({ ...config, free_storage_mb: parseInt(e.target.value) || 0 })}
                  className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-green-500"
                  min="0"
                />
                <p className="text-xs text-green-300 mt-2">
                  = {(config.free_storage_mb / 1024).toFixed(2)} GB
                </p>
              </div>

              {/* Execution Quota */}
              <div className="bg-gradient-to-br from-yellow-500/10 to-orange-500/10 rounded-xl p-5 border border-yellow-500/20">
                <div className="flex items-center mb-3">
                  <div className="p-2 bg-yellow-500/20 rounded-lg mr-3">
                    <Zap className="w-5 h-5 text-yellow-300" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-white">
                      Free Execution Quota
                    </label>
                    <p className="text-xs text-slate-400">
                      Maximum workflow executions per month
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <input
                    type="number"
                    value={config.free_executions || 0}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setConfig({ ...config, free_executions: val === 0 ? null : val });
                    }}
                    disabled={config.free_executions === null}
                    className="flex-1 px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    min="0"
                  />
                  <label className="flex items-center text-sm text-slate-300 bg-slate-700/30 px-4 py-3 rounded-lg cursor-pointer hover:bg-slate-700/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={config.free_executions === null}
                      onChange={(e) => setConfig({ ...config, free_executions: e.target.checked ? null : 100 })}
                      className="mr-2 w-4 h-4 text-blue-600 bg-slate-700 border-slate-500 rounded focus:ring-blue-500"
                    />
                    Unlimited
                  </label>
                </div>
              </div>

              {/* Free Tier Duration */}
              <div className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 rounded-xl p-5 border border-indigo-500/20">
                <div className="flex items-center mb-3">
                  <div className="p-2 bg-indigo-500/20 rounded-lg mr-3">
                    <Clock className="w-5 h-5 text-indigo-300" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-white">
                      Free Tier Duration (Days)
                    </label>
                    <p className="text-xs text-slate-400">
                      Days before free tier expires and account freezes
                    </p>
                  </div>
                </div>
                <input
                  type="number"
                  value={config.free_tier_duration_days}
                  onChange={(e) => setConfig({ ...config, free_tier_duration_days: parseInt(e.target.value) || 30 })}
                  className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  min="1"
                  max="365"
                />
                <p className="text-xs text-indigo-300 mt-2">
                  Users have {config.free_tier_duration_days} days to use their free tokens before purchasing
                </p>
              </div>

              {/* Save Message */}
              {saveMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-4 rounded-lg border ${
                    saveMessage.type === 'success'
                      ? 'bg-green-500/20 border-green-500/30 text-green-300'
                      : 'bg-red-500/20 border-red-500/30 text-red-300'
                  }`}
                >
                  <div className="flex items-center">
                    {saveMessage.type === 'success' ? (
                      <CheckCircle className="w-5 h-5 mr-2" />
                    ) : (
                      <AlertCircle className="w-5 h-5 mr-2" />
                    )}
                    <span className="font-medium">{saveMessage.text}</span>
                  </div>
                </motion.div>
              )}

              {/* Save Button */}
              <div className="flex justify-end pt-4">
                <button
                  onClick={saveConfig}
                  disabled={isSaving}
                  className="flex items-center px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/20"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-5 h-5 mr-2" />
                      Save Configuration
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-6"
        >
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-blue-500/20 backdrop-blur-xl rounded-xl p-5 border border-blue-500/20">
              <div className="text-center">
                <Users className="w-6 h-6 mx-auto mb-2 text-blue-300" />
                <p className="text-2xl font-bold text-blue-300">{stats.total}</p>
                <p className="text-xs text-blue-400">Total Users</p>
              </div>
            </div>

            <div className="bg-green-500/20 backdrop-blur-xl rounded-xl p-5 border border-green-500/20">
              <div className="text-center">
                <CheckCircle className="w-6 h-6 mx-auto mb-2 text-green-300" />
                <p className="text-2xl font-bold text-green-300">{stats.completed}</p>
                <p className="text-xs text-green-400">Onboarding Completed</p>
              </div>
            </div>

            <div className="bg-orange-500/20 backdrop-blur-xl rounded-xl p-5 border border-orange-500/20">
              <div className="text-center">
                <TrendingUp className="w-6 h-6 mx-auto mb-2 text-orange-300" />
                <p className="text-2xl font-bold text-orange-300">{stats.incomplete}</p>
                <p className="text-xs text-orange-400">Onboarding Incomplete</p>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-4 border border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium text-slate-300">Filter:</label>
              <select
                value={filterOnboarding}
                onChange={(e) => setFilterOnboarding(e.target.value as any)}
                className="px-3 py-2 bg-slate-700/50 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Users ({stats.total})</option>
                <option value="completed">Completed ({stats.completed})</option>
                <option value="incomplete">Incomplete ({stats.incomplete})</option>
              </select>
            </div>
          </div>

          {/* Users Table */}
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-700/50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Company</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Onboarding</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Quotas</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {isLoadingUsers ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center">
                        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                        <p className="text-slate-400 text-sm">Loading users...</p>
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center">
                        <Database className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                        <p className="text-lg font-medium text-slate-300">No users found</p>
                        <p className="text-sm text-slate-500">Try adjusting your filter criteria</p>
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user, index) => (
                      <motion.tr
                        key={user.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: index * 0.05 }}
                        className="hover:bg-slate-700/30 transition-all"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
                              {user.full_name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-white">{user.full_name}</div>
                              <div className="text-xs text-slate-400 flex items-center gap-1">
                                <Mail className="w-3 h-3" />
                                {user.email}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-slate-300 flex items-center gap-1">
                            {user.company ? (
                              <>
                                <Building className="w-3 h-3" />
                                {user.company}
                              </>
                            ) : (
                              <span className="text-slate-500">-</span>
                            )}
                          </div>
                          <div className="text-xs text-slate-400 flex items-center gap-1 mt-1">
                            {user.job_title ? (
                              <>
                                <Briefcase className="w-3 h-3" />
                                {user.job_title}
                              </>
                            ) : (
                              <span className="text-slate-500">-</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {user.role ? (
                            <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                              {user.role}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-sm">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {user.onboarding_completed ? (
                            <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-500/20 text-green-300 border border-green-500/30 flex items-center gap-1 w-fit">
                              <CheckCircle className="w-3 h-3" />
                              Completed
                            </span>
                          ) : (
                            <span className="px-2 py-1 text-xs font-medium rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30 flex items-center gap-1 w-fit">
                              <Clock className="w-3 h-3" />
                              Incomplete
                            </span>
                          )}
                          <div className="mt-2 space-y-1">
                            {user.onboarding_goal && (
                              <div className="text-xs text-slate-400 flex items-center gap-1">
                                <Target className="w-3 h-3" />
                                {user.onboarding_goal}
                              </div>
                            )}
                            {user.onboarding_mode && (
                              <div className="text-xs text-slate-400 flex items-center gap-1">
                                <Workflow className="w-3 h-3" />
                                {user.onboarding_mode}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <div className="space-y-1">
                            <div className="text-blue-300">
                              <Database className="w-3 h-3 inline mr-1" />
                              {user.balance ? Math.floor(user.balance / 10).toLocaleString() : '0'} tokens
                            </div>
                            <div className="text-green-300">
                              <HardDrive className="w-3 h-3 inline mr-1" />
                              {user.storage_quota_mb || 0} MB
                            </div>
                            <div className="text-yellow-300">
                              <Zap className="w-3 h-3 inline mr-1" />
                              {user.executions_quota === null ? '∞' : user.executions_quota || 0}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-400">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDate(user.created_at)}
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            {new Date(user.created_at).toLocaleDateString()}
                          </div>
                        </td>
                      </motion.tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
