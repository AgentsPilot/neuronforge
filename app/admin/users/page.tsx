'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Search,
  RefreshCw,
  Eye,
  Filter,
  Calendar,
  Clock,
  TrendingUp,
  Users as UsersIcon,
  Activity,
  AlertCircle,
  CheckCircle,
  X,
  Phone,
  Building,
  Shield,
  Ban,
  UserCheck,
  Database,
  Trash2,
  AlertTriangle
} from 'lucide-react';

interface User {
  id: string;
  full_name: string;
  company?: string;
  email: string;
  email_confirmed: boolean;
  phone?: string;
  last_sign_in_at?: string;
  created_at: string;
  updated_at?: string;
  providers: string[];
  role: string;
}

interface UserStats {
  totalUsers: number;
  activeUsers: number;
  newUsersToday: number;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [showTerminateModal, setShowTerminateModal] = useState(false);
  const [userToTerminate, setUserToTerminate] = useState<User | null>(null);
  const [terminateReason, setTerminateReason] = useState('');
  const [isTerminating, setIsTerminating] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, [filter]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchTerm !== '') {
        fetchUsers();
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchTerm]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);

      const queryParams = new URLSearchParams({
        filter,
        search: searchTerm
      });

      console.log('Fetching URL:', `/api/admin/users?${queryParams}`);

      const response = await fetch(`/api/admin/users?${queryParams}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        cache: 'no-store'
      });

      console.log('Response status:', response.status, response.ok);

      if (!response.ok) {
        let errorMessage = 'Failed to fetch users';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (e) {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      console.log('Raw API response:', result);

      if (!result.success) {
        throw new Error(result.error || 'API returned unsuccessful response');
      }

      setUsers(result.data || []);
      setStats(result.stats || null);

      console.log('Successfully processed users data:', {
        totalUsers: result.data?.length || 0
      });

    } catch (error) {
      console.error('Error fetching users:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
      setUsers([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  };

  const getFilteredUsers = () => {
    let filtered = users;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(user =>
        user.email?.toLowerCase().includes(term) ||
        user.full_name?.toLowerCase().includes(term) ||
        user.company?.toLowerCase().includes(term) ||
        user.id.toLowerCase().includes(term)
      );
    }

    return filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  };

  const formatCost = (cost: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4
    }).format(cost);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
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

  const isActiveUser = (user: User) => {
    if (!user.last_sign_in_at) return false;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return new Date(user.last_sign_in_at) > thirtyDaysAgo;
  };

  const handleViewUserDetails = (user: User) => {
    setSelectedUser(user);
  };

  const handleTerminateUser = async () => {
    if (!userToTerminate) return;

    try {
      setIsTerminating(true);

      const response = await fetch(`/api/admin/users/${userToTerminate.id}/terminate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: terminateReason })
      });

      if (!response.ok) {
        throw new Error('Failed to terminate user');
      }

      // Remove user from the list
      setUsers(prev => prev.filter(u => u.id !== userToTerminate.id));

      // Update stats
      if (stats) {
        setStats({
          ...stats,
          totalUsers: stats.totalUsers - 1
        });
      }

      // Close modal and reset
      setShowTerminateModal(false);
      setUserToTerminate(null);
      setTerminateReason('');

      // If the terminated user was selected in details, close that too
      if (selectedUser?.id === userToTerminate.id) {
        setSelectedUser(null);
      }

    } catch (error) {
      console.error('Error terminating user:', error);
      alert('Failed to terminate user. Please try again.');
    } finally {
      setIsTerminating(false);
    }
  };

  const openTerminateModal = (user: User) => {
    setUserToTerminate(user);
    setShowTerminateModal(true);
    setTerminateReason('');
  };

  // Error Display Component
  const ErrorDisplay = ({ error, onRetry }: { error: string; onRetry: () => void }) => (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
        <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-red-100 rounded-full">
          <AlertCircle className="w-6 h-6 text-red-600" />
        </div>
        <h3 className="text-lg font-semibold text-red-800 mb-2">Failed to Load Users</h3>
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-400">Loading users...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorDisplay error={error} onRetry={fetchUsers} />;
  }

  const filteredUsers = getFilteredUsers();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">User Management</h1>
          <div className="flex items-center gap-4">
            <p className="text-slate-400">Manage platform users and their activity</p>
            {stats && (
              <div className="flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1">
                  <UsersIcon className="w-3 h-3 text-blue-400" />
                  <span className="text-blue-300">
                    {stats.totalUsers} total users
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <Activity className="w-3 h-3 text-green-400" />
                  <span className="text-green-300">
                    {stats.activeUsers} active
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className="px-3 py-1 bg-slate-700/50 text-slate-300 rounded text-sm hover:bg-slate-600/50 transition-colors border border-slate-600"
          >
            <Filter className="w-4 h-4 inline mr-1" />
            {showAdvancedFilters ? 'Hide Filters' : 'Advanced Filters'}
          </button>
          <button
            onClick={fetchUsers}
            className="p-2 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-blue-500/20 backdrop-blur-xl rounded-xl p-4 border border-blue-500/20">
            <div className="text-center">
              <UsersIcon className="w-6 h-6 mx-auto mb-2 text-blue-300" />
              <p className="text-2xl font-bold text-blue-300">{formatNumber(stats.totalUsers)}</p>
              <p className="text-xs text-blue-400">Total Users</p>
            </div>
          </div>

          <div className="bg-green-500/20 backdrop-blur-xl rounded-xl p-4 border border-green-500/20">
            <div className="text-center">
              <Activity className="w-6 h-6 mx-auto mb-2 text-green-300" />
              <p className="text-2xl font-bold text-green-300">{formatNumber(stats.activeUsers)}</p>
              <p className="text-xs text-green-400">Active Users (30d)</p>
            </div>
          </div>

          <div className="bg-purple-500/20 backdrop-blur-xl rounded-xl p-4 border border-purple-500/20">
            <div className="text-center">
              <TrendingUp className="w-6 h-6 mx-auto mb-2 text-purple-300" />
              <p className="text-2xl font-bold text-purple-300">{formatNumber(stats.newUsersToday)}</p>
              <p className="text-xs text-purple-400">New Today</p>
            </div>
          </div>
        </div>
      )}

      {/* Filters & Search */}
      <div className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 bg-slate-700/50 rounded-lg px-3 py-2 min-w-[300px]">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search users by name, email, company..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-transparent text-white placeholder-slate-400 text-sm focus:outline-none flex-1"
              />
            </div>

            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              className="bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
            >
              <option value="all">All Users</option>
              <option value="active">Active (30 days)</option>
              <option value="inactive">Inactive (30+ days)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-700/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Last Sign In</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Joined</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    <Database className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                    <p className="text-lg font-medium">No users found</p>
                    <p className="text-sm">Try adjusting your search or filter criteria</p>
                  </td>
                </tr>
              ) : (
                filteredUsers.slice(0, 100).map((user) => (
                  <tr key={user.id} className="hover:bg-slate-700/30 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-white">
                            {user.full_name || 'No name'}
                          </p>
                          {user.email_confirmed && (
                            <CheckCircle className="w-3 h-3 text-green-400" title="Email verified" />
                          )}
                        </div>
                        <p className="text-xs text-slate-400">{user.email}</p>
                        {user.company && (
                          <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                            <Building className="w-3 h-3" />
                            {user.company}
                          </p>
                        )}
                        <p className="text-xs text-slate-500 font-mono">{user.id.slice(0, 8)}...</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full w-fit ${
                          isActiveUser(user)
                            ? 'bg-green-500/20 text-green-300'
                            : 'bg-slate-500/20 text-slate-300'
                        }`}>
                          {isActiveUser(user) ? (
                            <span className="flex items-center gap-1">
                              <UserCheck className="w-3 h-3" />
                              Active
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <Ban className="w-3 h-3" />
                              Inactive
                            </span>
                          )}
                        </span>
                        {user.role && (
                          <span className="px-2 py-1 text-xs font-medium bg-blue-500/20 text-blue-300 rounded-full w-fit flex items-center gap-1">
                            <Shield className="w-3 h-3" />
                            {user.role}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(user.last_sign_in_at || '')}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(user.created_at)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleViewUserDetails(user)}
                          className="text-blue-400 hover:text-blue-300 p-1 rounded hover:bg-blue-500/20 transition-colors"
                          title="View details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => openTerminateModal(user)}
                          className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/20 transition-colors"
                          title="Terminate user"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filteredUsers.length > 100 && (
          <div className="px-6 py-3 bg-slate-700/30 border-t border-slate-600">
            <p className="text-sm text-slate-400">
              Showing first 100 of {filteredUsers.length} users. Use filters to narrow results.
            </p>
          </div>
        )}
      </div>

      {/* User Detail Modal */}
      {selectedUser && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-800/95 backdrop-blur-xl rounded-xl border border-white/10 max-w-4xl w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-semibold text-white">User Details</h2>
                <div className="flex gap-2">
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                    isActiveUser(selectedUser)
                      ? 'bg-green-500/20 text-green-300'
                      : 'bg-slate-500/20 text-slate-300'
                  }`}>
                    {isActiveUser(selectedUser) ? 'Active' : 'Inactive'}
                  </span>
                  {selectedUser.email_confirmed && (
                    <span className="px-2 py-1 text-xs font-medium bg-blue-500/20 text-blue-300 rounded-full">
                      Verified
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedUser(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* User Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-slate-700/30 p-4 rounded-lg">
                  <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <UsersIcon className="w-5 h-5" />
                    User Information
                  </h3>
                  <div className="space-y-2">
                    <div>
                      <span className="text-slate-400 text-sm">Name:</span>
                      <p className="text-white font-medium">{selectedUser.full_name || 'N/A'}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 text-sm">Email:</span>
                      <p className="text-white flex items-center gap-2">
                        {selectedUser.email}
                        {selectedUser.email_confirmed && (
                          <CheckCircle className="w-4 h-4 text-green-400" />
                        )}
                      </p>
                    </div>
                    {selectedUser.phone && (
                      <div>
                        <span className="text-slate-400 text-sm">Phone:</span>
                        <p className="text-white flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {selectedUser.phone}
                        </p>
                      </div>
                    )}
                    {selectedUser.company && (
                      <div>
                        <span className="text-slate-400 text-sm">Company:</span>
                        <p className="text-white flex items-center gap-1">
                          <Building className="w-3 h-3" />
                          {selectedUser.company}
                        </p>
                      </div>
                    )}
                    <div>
                      <span className="text-slate-400 text-sm">User ID:</span>
                      <p className="text-white font-mono text-xs">{selectedUser.id}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 text-sm">Role:</span>
                      <p className="text-white flex items-center gap-1">
                        <Shield className="w-3 h-3" />
                        {selectedUser.role}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-700/30 p-4 rounded-lg">
                  <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Account Settings
                  </h3>
                  <div className="space-y-2">
                    <div>
                      <span className="text-slate-400 text-sm">Account Status:</span>
                      <p className="text-white font-medium">
                        {isActiveUser(selectedUser) ? 'Active' : 'Inactive'}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-400 text-sm">Email Verified:</span>
                      <p className="text-white font-medium">
                        {selectedUser.email_confirmed ? 'Yes' : 'No'}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-400 text-sm">Auth Providers:</span>
                      <p className="text-white font-medium">
                        {selectedUser.providers.length || 'None'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Activity Timeline */}
              <div className="bg-slate-700/30 p-4 rounded-lg">
                <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Activity Timeline
                </h3>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 text-sm">Account Created:</span>
                    <p className="text-white">{new Date(selectedUser.created_at).toLocaleString()}</p>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400 text-sm">Last Sign In:</span>
                    <p className="text-white">
                      {selectedUser.last_sign_in_at
                        ? new Date(selectedUser.last_sign_in_at).toLocaleString()
                        : 'Never'
                      }
                    </p>
                  </div>
                  {selectedUser.updated_at && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 text-sm">Last Updated:</span>
                      <p className="text-white">{new Date(selectedUser.updated_at).toLocaleString()}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Auth Providers */}
              {selectedUser.providers && selectedUser.providers.length > 0 && (
                <div className="bg-slate-700/30 p-4 rounded-lg">
                  <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Authentication Methods
                  </h3>
                  <div className="flex gap-2">
                    {selectedUser.providers.map(provider => (
                      <span key={provider} className="px-3 py-1 text-xs font-medium bg-purple-500/20 text-purple-300 rounded-full">
                        {provider}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Terminate User Confirmation Modal */}
      {showTerminateModal && userToTerminate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-800/95 backdrop-blur-xl rounded-xl border border-red-500/30 max-w-md w-full"
          >
            <div className="p-6 border-b border-red-500/20 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-500/20 rounded-lg">
                  <AlertTriangle className="w-6 h-6 text-red-400" />
                </div>
                <h2 className="text-xl font-semibold text-white">Terminate User</h2>
              </div>
              <button
                onClick={() => {
                  setShowTerminateModal(false);
                  setUserToTerminate(null);
                  setTerminateReason('');
                }}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <p className="text-red-300 text-sm font-medium mb-2">⚠️ Warning: This action cannot be undone!</p>
                <p className="text-slate-300 text-sm">
                  You are about to permanently terminate the account for:
                </p>
                <div className="mt-3 p-3 bg-slate-700/50 rounded-lg">
                  <p className="text-white font-semibold">{userToTerminate.full_name || 'No name'}</p>
                  <p className="text-slate-400 text-sm">{userToTerminate.email}</p>
                  <p className="text-slate-500 text-xs font-mono mt-1">{userToTerminate.id}</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Reason for Termination (Optional)
                </label>
                <textarea
                  value={terminateReason}
                  onChange={(e) => setTerminateReason(e.target.value)}
                  rows={3}
                  placeholder="e.g., Terms of service violation, user request, etc."
                  className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              <div className="flex flex-col gap-2 text-xs text-slate-400">
                <p>This will:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Delete the user's authentication account</li>
                  <li>Remove all associated profile data</li>
                  <li>Revoke all active sessions</li>
                  <li>Log this action in the audit trail</li>
                </ul>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowTerminateModal(false);
                    setUserToTerminate(null);
                    setTerminateReason('');
                  }}
                  disabled={isTerminating}
                  className="px-4 py-2 bg-slate-600/50 text-slate-300 rounded-lg hover:bg-slate-500/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={handleTerminateUser}
                  disabled={isTerminating}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isTerminating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Terminating...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Terminate User
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
