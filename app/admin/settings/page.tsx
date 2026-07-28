'use client';

import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  Shield,
  Plus,
  Trash2,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Mail,
  Crown,
  UserPlus,
  X,
  Search,
  User
} from 'lucide-react';

interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'super_admin';
  created_at: string;
  added_by?: string;
}

interface PlatformUser {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
  is_admin: boolean;
}

export default function AdminSettingsPage() {
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Add admin form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminRole, setNewAdminRole] = useState<'admin' | 'super_admin'>('admin');

  // User browser
  const [platformUsers, setPlatformUsers] = useState<PlatformUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  useEffect(() => {
    fetchAdminUsers();
  }, []);

  const fetchAdminUsers = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/settings/admin-users');
      const data = await response.json();

      if (data.success) {
        setAdminUsers(data.users || []);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to fetch admin users' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to load admin users' });
    } finally {
      setLoading(false);
    }
  };

  const fetchPlatformUsers = async (search?: string) => {
    try {
      setLoadingUsers(true);
      const params = new URLSearchParams();
      if (search) params.set('search', search);

      const response = await fetch(`/api/admin/settings/platform-users?${params}`);
      const data = await response.json();

      if (data.success) {
        setPlatformUsers(data.users || []);
      }
    } catch (err) {
      // Silent fail for user browser
    } finally {
      setLoadingUsers(false);
    }
  };

  // Fetch users when add form is opened
  useEffect(() => {
    if (showAddForm) {
      fetchPlatformUsers();
    }
  }, [showAddForm]);

  // Search users with debounce
  useEffect(() => {
    if (!showAddForm) return;

    const timer = setTimeout(() => {
      fetchPlatformUsers(userSearch);
    }, 300);

    return () => clearTimeout(timer);
  }, [userSearch, showAddForm]);

  const handleAddAdmin = async (email?: string) => {
    const emailToAdd = email || newAdminEmail.trim();
    if (!emailToAdd) {
      setMessage({ type: 'error', text: 'Please enter an email address' });
      return;
    }

    try {
      setSaving(true);
      setMessage(null);

      const response = await fetch('/api/admin/settings/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          email: emailToAdd,
          role: newAdminRole
        })
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: `Successfully added ${emailToAdd} as ${newAdminRole.replace('_', ' ')}` });
        setNewAdminEmail('');
        setUserSearch('');
        setShowAddForm(false);
        await fetchAdminUsers();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to add admin user' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to add admin user' });
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAdmin = async (userId: string, email: string) => {
    if (!confirm(`Are you sure you want to remove ${email} from admin users?`)) {
      return;
    }

    try {
      setSaving(true);
      setMessage(null);

      const response = await fetch('/api/admin/settings/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove',
          userId
        })
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: `Successfully removed ${email} from admin users` });
        await fetchAdminUsers();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to remove admin user' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to remove admin user' });
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
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
                <h1 className="text-xl font-semibold text-white">Admin Settings</h1>
                <span className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400">System Config</span>
              </div>
              <p className="text-sm text-slate-400">Manage admin users and system settings</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={fetchAdminUsers}
              disabled={loading}
              className="p-2 rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 text-slate-400 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Message Banner */}
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex items-center gap-3 p-4 rounded-xl border backdrop-blur-xl ${
            message.type === 'success'
              ? 'bg-green-500/20 border-green-500/30 text-green-300'
              : 'bg-red-500/20 border-red-500/30 text-red-300'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
          )}
          <p className="font-medium">{message.text}</p>
          <button
            onClick={() => setMessage(null)}
            className="ml-auto hover:opacity-70"
          >
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      )}

      {/* Admin Users Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800 border border-slate-700 rounded-xl p-6"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-400" />
              Admin Users
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Users with admin access to this console
            </p>
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            Add Admin
          </button>
        </div>

        {/* Add Admin Form with User Browser */}
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-6 p-4 bg-slate-700/50 rounded-xl border border-slate-600"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Add New Admin User</h3>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setNewAdminEmail('');
                  setUserSearch('');
                }}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Role Selection */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-300 mb-2">
                Admin Role
              </label>
              <div className="flex gap-3">
                <button
                  onClick={() => setNewAdminRole('admin')}
                  className={`flex-1 p-3 rounded-lg border transition-colors ${
                    newAdminRole === 'admin'
                      ? 'bg-blue-500/20 border-blue-500/50 text-blue-300'
                      : 'bg-slate-800/50 border-slate-600 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  <Shield className="w-5 h-5 mx-auto mb-1" />
                  <div className="text-sm font-medium">Admin</div>
                  <div className="text-xs opacity-70">Console access</div>
                </button>
                <button
                  onClick={() => setNewAdminRole('super_admin')}
                  className={`flex-1 p-3 rounded-lg border transition-colors ${
                    newAdminRole === 'super_admin'
                      ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300'
                      : 'bg-slate-800/50 border-slate-600 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  <Crown className="w-5 h-5 mx-auto mb-1" />
                  <div className="text-sm font-medium">Super Admin</div>
                  <div className="text-xs opacity-70">Manage admins</div>
                </button>
              </div>
            </div>

            {/* Search Users */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-300 mb-2">
                Search Platform Users
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search by email or name..."
                  className="w-full pl-10 pr-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {loadingUsers && (
                  <RefreshCw className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin" />
                )}
              </div>
            </div>

            {/* User List */}
            <div className="max-h-64 overflow-y-auto space-y-2 mb-4">
              {platformUsers.length === 0 && !loadingUsers ? (
                <div className="text-center py-4 text-slate-400 text-sm">
                  {userSearch ? 'No users found' : 'Loading users...'}
                </div>
              ) : (
                platformUsers.map((pUser) => (
                  <div
                    key={pUser.id}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      pUser.is_admin
                        ? 'bg-slate-800/30 border-slate-700 opacity-50'
                        : 'bg-slate-800/50 border-slate-600 hover:border-blue-500/50 cursor-pointer'
                    }`}
                    onClick={() => !pUser.is_admin && handleAddAdmin(pUser.email)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-slate-600 to-slate-700 rounded-lg flex items-center justify-center">
                        <User className="w-4 h-4 text-slate-300" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-white">
                          {pUser.full_name || pUser.email}
                        </div>
                        <div className="text-xs text-slate-400">{pUser.email}</div>
                      </div>
                    </div>
                    {pUser.is_admin ? (
                      <span className="px-2 py-1 text-xs rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                        Already Admin
                      </span>
                    ) : (
                      <button
                        disabled={saving}
                        className="px-3 py-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50"
                      >
                        {saving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Manual Email Entry */}
            <div className="pt-4 border-t border-slate-600">
              <label className="block text-xs font-medium text-slate-300 mb-2">
                Or enter email manually
              </label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={newAdminEmail}
                  onChange={(e) => setNewAdminEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="flex-1 px-4 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => handleAddAdmin()}
                  disabled={saving || !newAdminEmail.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Add
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Admin Users List */}
        <div className="space-y-3">
          {adminUsers.length === 0 ? (
            <div className="text-center py-8">
              <Users className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No admin users configured</p>
              <p className="text-sm text-slate-500 mt-1">
                Add admin users to restrict access to this console
              </p>
            </div>
          ) : (
            adminUsers.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between p-4 bg-slate-700/30 rounded-xl border border-slate-600/50 hover:border-slate-500/50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                    {user.role === 'super_admin' ? (
                      <Crown className="w-5 h-5 text-yellow-300" />
                    ) : (
                      <Shield className="w-5 h-5 text-white" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{user.full_name || user.email}</span>
                      <span className={`px-2 py-0.5 text-xs rounded-full ${
                        user.role === 'super_admin'
                          ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                          : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                      }`}>
                        {user.role === 'super_admin' ? 'Super Admin' : 'Admin'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-slate-400 mt-1">
                      <span className="flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        {user.email}
                      </span>
                      <span>Added {formatDate(user.created_at)}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveAdmin(user.id, user.email)}
                  disabled={saving}
                  className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
                  title="Remove admin"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Info Note */}
        <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-200">
              <p className="font-medium mb-1">About Admin Roles</p>
              <ul className="list-disc list-inside space-y-1 text-blue-300/80">
                <li><strong>Admin:</strong> Can access and manage all admin console features</li>
                <li><strong>Super Admin:</strong> Can also manage other admin users</li>
              </ul>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
