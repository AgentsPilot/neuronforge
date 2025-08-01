'use client'

import React, { useState, useEffect } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  Settings, 
  User, 
  PlugZap, 
  Bell, 
  Shield, 
  Key,
  Download,
  Trash2,
  Search,
  Filter,
  Plus,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Mail,
  Github,
  Slack,
  Calendar,
  Cloud,
  MessageCircle,
  Phone,
  Save,
  Loader2,
  RefreshCw,
  Camera
} from 'lucide-react'

// Types
interface UserProfile {
  id: string
  full_name?: string
  avatar_url?: string
  plan?: string
  company?: string
  job_title?: string
  timezone?: string
  language?: string
  created_at?: string
  updated_at?: string
}

interface UserPreferences {
  user_id: string
  theme: 'light' | 'dark' | 'system'
  sidebar_collapsed: boolean
  compact_mode: boolean
  data_retention_days: number
  analytics_enabled: boolean
  telemetry_enabled: boolean
  default_model: string
  max_tokens: number
  temperature: number
  auto_save_conversations: boolean
  show_timestamps: boolean
  enable_sounds: boolean
  keyboard_shortcuts: boolean
  debug_mode: boolean
  beta_features: boolean
}

interface NotificationSettings {
  user_id: string
  email_enabled: boolean
  email_frequency: 'immediate' | 'daily' | 'weekly' | 'never'
  email_agent_updates: boolean
  email_system_alerts: boolean
  email_security_alerts: boolean
  email_marketing: boolean
  push_enabled: boolean
  push_agent_updates: boolean
  push_system_alerts: boolean
  push_mentions: boolean
  desktop_enabled: boolean
  desktop_agent_updates: boolean
  desktop_system_alerts: boolean
  inapp_enabled: boolean
  inapp_sounds: boolean
  inapp_popups: boolean
  quiet_hours_enabled: boolean
  quiet_hours_start: string
  quiet_hours_end: string
}

interface PluginConnection {
  id: string
  plugin_key: string
  plugin_name: string
  username?: string
  email?: string
  status: 'active' | 'expired' | 'error' | 'disabled'
  connected_at: string
  last_used?: string
  profile_data?: any
}

// Plugin icons mapping
const pluginIcons: Record<string, React.ReactNode> = {
  'google-mail': <Mail className="w-5 h-5 text-red-600" />,
  'gmail': <Mail className="w-5 h-5 text-red-600" />,
  'github': <Github className="w-5 h-5 text-gray-800" />,
  'slack': <Slack className="w-5 h-5 text-purple-600" />,
  'google-calendar': <Calendar className="w-5 h-5 text-blue-500" />,
  'outlook': <Mail className="w-5 h-5 text-blue-600" />,
  'whatsapp': <MessageCircle className="w-5 h-5 text-green-600" />,
  'twilio': <Phone className="w-5 h-5 text-red-500" />,
  'aws': <Cloud className="w-5 h-5 text-orange-500" />,
}

export default function SettingsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState('plugins')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  
  // Data states
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [preferences, setPreferences] = useState<UserPreferences | null>(null)
  const [notifications, setNotifications] = useState<NotificationSettings | null>(null)
  const [connections, setConnections] = useState<PluginConnection[]>([])
  
  // Form states
  const [profileForm, setProfileForm] = useState<Partial<UserProfile>>({})
  const [preferencesForm, setPreferencesForm] = useState<Partial<UserPreferences>>({})
  const [notificationsForm, setNotificationsForm] = useState<Partial<NotificationSettings>>({})

  const tabs = [
    { id: 'plugins', label: 'Plugins', icon: <PlugZap className="w-4 h-4" /> },
    { id: 'profile', label: 'Profile', icon: <User className="w-4 h-4" /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" /> },
    { id: 'security', label: 'Security', icon: <Shield className="w-4 h-4" /> },
    { id: 'preferences', label: 'Preferences', icon: <Settings className="w-4 h-4" /> }
  ]

  // Load all settings data
  useEffect(() => {
    if (user) {
      loadUserData()
    }
  }, [user])

  const loadUserData = async () => {
    if (!user) return
    
    try {
      setLoading(true)
      
      // Load profile
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (!profileError && profileData) {
        setProfile(profileData)
        setProfileForm(profileData)
      } else {
        // Create default profile if it doesn't exist
        const defaultProfile = {
          id: user.id,
          full_name: user.user_metadata?.full_name || '',
          avatar_url: user.user_metadata?.avatar_url || ''
        }
        setProfile(defaultProfile)
        setProfileForm(defaultProfile)
      }

      // Load preferences
      const { data: preferencesData, error: preferencesError } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (!preferencesError && preferencesData) {
        setPreferences(preferencesData)
        setPreferencesForm(preferencesData)
      }

      // Load notification settings
      const { data: notificationsData, error: notificationsError } = await supabase
        .from('notification_settings')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (!notificationsError && notificationsData) {
        setNotifications(notificationsData)
        setNotificationsForm(notificationsData)
      }

      // Load plugin connections
      const { data: connectionsData, error: connectionsError } = await supabase
        .from('plugin_connections')
        .select('*')
        .eq('user_id', user.id)
        .order('connected_at', { ascending: false })

      if (!connectionsError && connectionsData) {
        setConnections(connectionsData)
      }

    } catch (error) {
      console.error('Error loading user data:', error)
    } finally {
      setLoading(false)
    }
  }

  const saveProfile = async () => {
    if (!user) return
    
    try {
      setSaving(true)
      
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: user.id,
          ...profileForm,
          updated_at: new Date().toISOString()
        })

      if (error) throw error
      
      setProfile({ ...profile, ...profileForm } as UserProfile)
      alert('Profile updated successfully!')
      
    } catch (error) {
      console.error('Error saving profile:', error)
      alert('Failed to save profile. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const savePreferences = async () => {
    if (!user) return
    
    try {
      setSaving(true)
      
      const { error } = await supabase
        .from('user_preferences')
        .upsert({
          user_id: user.id,
          ...preferencesForm,
          updated_at: new Date().toISOString()
        })

      if (error) throw error
      
      setPreferences({ ...preferences, ...preferencesForm } as UserPreferences)
      alert('Preferences updated successfully!')
      
    } catch (error) {
      console.error('Error saving preferences:', error)
      alert('Failed to save preferences. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const saveNotifications = async () => {
    if (!user) return
    
    try {
      setSaving(true)
      
      const { error } = await supabase
        .from('notification_settings')
        .upsert({
          user_id: user.id,
          ...notificationsForm,
          updated_at: new Date().toISOString()
        })

      if (error) throw error
      
      setNotifications({ ...notifications, ...notificationsForm } as NotificationSettings)
      alert('Notification settings updated successfully!')
      
    } catch (error) {
      console.error('Error saving notification settings:', error)
      alert('Failed to save notification settings. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDisconnectPlugin = async (connectionId: string) => {
    if (!confirm('Are you sure you want to disconnect this plugin? Any agents using this plugin may be affected.')) {
      return
    }

    try {
      const { error } = await supabase
        .from('plugin_connections')
        .delete()
        .eq('id', connectionId)

      if (!error) {
        setConnections(prev => prev.filter(conn => conn.id !== connectionId))
        alert('Plugin disconnected successfully!')
      }
    } catch (error) {
      console.error('Error disconnecting plugin:', error)
      alert('Failed to disconnect plugin. Please try again.')
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString()
  }

  const getStatusBadge = (status: string) => {
    const configs = {
      active: { icon: CheckCircle, color: 'text-green-600 bg-green-50 border-green-200', text: 'Connected' },
      error: { icon: AlertTriangle, color: 'text-amber-600 bg-amber-50 border-amber-200', text: 'Error' },
      expired: { icon: Clock, color: 'text-gray-600 bg-gray-50 border-gray-200', text: 'Expired' },
      disabled: { icon: XCircle, color: 'text-red-600 bg-red-50 border-red-200', text: 'Disconnected' }
    }
    
    const config = configs[status as keyof typeof configs] || configs.disabled
    const Icon = config.icon
    
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full border ${config.color}`}>
        <Icon className="w-3 h-3" />
        {config.text}
      </span>
    )
  }

  const filteredConnections = connections.filter(connection => {
    const matchesSearch = connection.plugin_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         connection.username?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesFilter = filterStatus === 'all' || connection.status === filterStatus
    return matchesSearch && matchesFilter
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        <span className="ml-3 text-gray-600">Loading settings...</span>
      </div>
    )
  }

  const renderPluginsTab = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Plugin Connections</h2>
          <p className="text-gray-600">Manage your connected plugins and integrations</p>
        </div>
        <Link href="/settings/connections">
          <button className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            <Plus className="w-4 h-4" />
            Connect New Plugin
          </button>
        </Link>
      </div>

      {/* Search and Filter */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search plugins..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="relative">
          <Filter className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="pl-10 pr-8 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
          >
            <option value="all">All Status</option>
            <option value="active">Connected</option>
            <option value="error">Error</option>
            <option value="expired">Expired</option>
          </select>
        </div>
      </div>

      {/* Connected Plugins */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">Connected Plugins ({filteredConnections.length})</h3>
        {filteredConnections.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <PlugZap className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>No plugins connected yet</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredConnections.map((connection) => (
              <div key={connection.id} className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="p-2 bg-gray-50 rounded-lg">
                      {pluginIcons[connection.plugin_key] || <PlugZap className="w-5 h-5 text-gray-600" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="text-lg font-semibold text-gray-900">{connection.plugin_name}</h4>
                        {getStatusBadge(connection.status)}
                      </div>
                      <p className="text-sm text-gray-600 mb-1">
                        Connected as <span className="font-medium">{connection.username || connection.email}</span>
                      </p>
                      <p className="text-xs text-gray-500">
                        Last used: {connection.last_used ? formatDate(connection.last_used) : 'Never'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="p-2 text-gray-400 hover:text-gray-600 transition-colors" title="Settings">
                      <Settings className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleDisconnectPlugin(connection.id)}
                      className="p-2 text-gray-400 hover:text-red-600 transition-colors" 
                      title="Disconnect"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                {connection.status === 'error' && (
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-sm text-amber-800">
                      Connection error detected. The plugin may need to be reconnected.
                    </p>
                    <button className="mt-2 text-sm font-medium text-amber-700 hover:text-amber-800">
                      Reconnect Plugin →
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )

  const renderProfileTab = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Profile Settings</h2>
      
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-start gap-6">
          <div className="relative">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white text-2xl font-bold">
              {profileForm.full_name ? profileForm.full_name.charAt(0).toUpperCase() : user?.email?.charAt(0).toUpperCase() || 'U'}
            </div>
            <button className="absolute bottom-0 right-0 p-1 bg-blue-600 text-white rounded-full hover:bg-blue-700">
              <Camera className="w-3 h-3" />
            </button>
          </div>
          
          <div className="flex-1 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
                <input
                  type="text"
                  value={profileForm.full_name || ''}
                  onChange={(e) => setProfileForm(prev => ({ ...prev, full_name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                <input
                  type="email"
                  value={user?.email || ''}
                  disabled
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Company</label>
                <input
                  type="text"
                  value={profileForm.company || ''}
                  onChange={(e) => setProfileForm(prev => ({ ...prev, company: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Job Title</label>
                <input
                  type="text"
                  value={profileForm.job_title || ''}
                  onChange={(e) => setProfileForm(prev => ({ ...prev, job_title: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Timezone</label>
                <select
                  value={profileForm.timezone || 'UTC'}
                  onChange={(e) => setProfileForm(prev => ({ ...prev, timezone: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="UTC">UTC</option>
                  <option value="America/New_York">Eastern Time</option>
                  <option value="America/Chicago">Central Time</option>
                  <option value="America/Denver">Mountain Time</option>
                  <option value="America/Los_Angeles">Pacific Time</option>
                  <option value="Europe/London">London</option>
                  <option value="Europe/Paris">Paris</option>
                  <option value="Asia/Tokyo">Tokyo</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Language</label>
                <select
                  value={profileForm.language || 'en'}
                  onChange={(e) => setProfileForm(prev => ({ ...prev, language: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                  <option value="ja">Japanese</option>
                  <option value="zh">Chinese</option>
                </select>
              </div>
            </div>
            
            <div className="flex items-center gap-4 pt-4">
              <span className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full">
                {profile?.plan || 'Free'} Plan
              </span>
              {profile?.created_at && (
                <span className="text-sm text-gray-500">
                  Member since {new Date(profile.created_at).toLocaleDateString()}
                </span>
              )}
            </div>
            
            <div className="flex gap-3 pt-4">
              <button 
                onClick={saveProfile}
                disabled={saving}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </button>
              <button 
                onClick={() => setProfileForm(profile || {})}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  const renderNotificationsTab = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Notification Settings</h2>
      
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Email Notifications</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Email Notifications</h4>
              <p className="text-sm text-gray-600">Receive notifications via email</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={notificationsForm.email_enabled ?? true}
                onChange={(e) => setNotificationsForm(prev => ({ ...prev, email_enabled: e.target.checked }))}
                className="sr-only"
              />
              <div className={`w-11 h-6 rounded-full transition-colors ${(notificationsForm.email_enabled ?? true) ? 'bg-blue-600' : 'bg-gray-300'}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${(notificationsForm.email_enabled ?? true) ? 'translate-x-5' : 'translate-x-0'} mt-0.5 ml-0.5`} />
              </div>
            </label>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Agent Updates</h4>
              <p className="text-sm text-gray-600">Get notified when your agents complete tasks</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={notificationsForm.email_agent_updates ?? true}
                onChange={(e) => setNotificationsForm(prev => ({ ...prev, email_agent_updates: e.target.checked }))}
                className="sr-only"
              />
              <div className={`w-11 h-6 rounded-full transition-colors ${(notificationsForm.email_agent_updates ?? true) ? 'bg-blue-600' : 'bg-gray-300'}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${(notificationsForm.email_agent_updates ?? true) ? 'translate-x-5' : 'translate-x-0'} mt-0.5 ml-0.5`} />
              </div>
            </label>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">System Alerts</h4>
              <p className="text-sm text-gray-600">Important system notifications and updates</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={notificationsForm.email_system_alerts ?? true}
                onChange={(e) => setNotificationsForm(prev => ({ ...prev, email_system_alerts: e.target.checked }))}
                className="sr-only"
              />
              <div className={`w-11 h-6 rounded-full transition-colors ${(notificationsForm.email_system_alerts ?? true) ? 'bg-blue-600' : 'bg-gray-300'}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${(notificationsForm.email_system_alerts ?? true) ? 'translate-x-5' : 'translate-x-0'} mt-0.5 ml-0.5`} />
              </div>
            </label>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Marketing Updates</h4>
              <p className="text-sm text-gray-600">Product updates and promotional content</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={notificationsForm.email_marketing ?? false}
                onChange={(e) => setNotificationsForm(prev => ({ ...prev, email_marketing: e.target.checked }))}
                className="sr-only"
              />
              <div className={`w-11 h-6 rounded-full transition-colors ${(notificationsForm.email_marketing ?? false) ? 'bg-blue-600' : 'bg-gray-300'}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${(notificationsForm.email_marketing ?? false) ? 'translate-x-5' : 'translate-x-0'} mt-0.5 ml-0.5`} />
              </div>
            </label>
          </div>
        </div>

        <div className="flex gap-3 pt-6">
          <button 
            onClick={saveNotifications}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
          <button 
            onClick={() => setNotificationsForm(notifications || {})}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )

  const renderSecurityTab = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Security Settings</h2>
      
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Password & Authentication</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Change Password</h4>
              <p className="text-sm text-gray-600">Update your account password</p>
            </div>
            <button className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50">
              Change
            </button>
          </div>
          
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Two-Factor Authentication</h4>
              <p className="text-sm text-gray-600">Add an extra layer of security to your account</p>
            </div>
            <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Enable
            </button>
          </div>
        </div>
      </div>
      
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">API Access</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">API Keys</h4>
              <p className="text-sm text-gray-600">Manage your API access keys</p>
            </div>
            <button className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
              <Key className="w-4 h-4" />
              Manage
            </button>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Session Timeout</h4>
              <p className="text-sm text-gray-600">Automatically sign out after inactivity</p>
            </div>
            <select className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="60">1 hour</option>
              <option value="240">4 hours</option>
              <option value="480">8 hours</option>
              <option value="1440">24 hours</option>
              <option value="-1">Never</option>
            </select>
          </div>
        </div>
      </div>

      {/* Account Management */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Account Management</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Export Data</h4>
              <p className="text-sm text-gray-600">Download all your data and settings</p>
            </div>
            <button className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
          
          <div className="flex items-center justify-between p-4 border border-red-200 rounded-lg bg-red-50">
            <div>
              <h4 className="font-medium text-red-900">Delete Account</h4>
              <p className="text-sm text-red-700">Permanently delete your account and all data</p>
            </div>
            <button className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-700 border border-red-300 rounded-lg hover:bg-red-100">
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  const renderPreferencesTab = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Preferences</h2>
      
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Appearance</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Theme</h4>
              <p className="text-sm text-gray-600">Choose your preferred color scheme</p>
            </div>
            <select
              value={preferencesForm.theme || 'light'}
              onChange={(e) => setPreferencesForm(prev => ({ ...prev, theme: e.target.value as any }))}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Compact Mode</h4>
              <p className="text-sm text-gray-600">Use a more compact interface</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={preferencesForm.compact_mode ?? false}
                onChange={(e) => setPreferencesForm(prev => ({ ...prev, compact_mode: e.target.checked }))}
                className="sr-only"
              />
              <div className={`w-11 h-6 rounded-full transition-colors ${(preferencesForm.compact_mode ?? false) ? 'bg-blue-600' : 'bg-gray-300'}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${(preferencesForm.compact_mode ?? false) ? 'translate-x-5' : 'translate-x-0'} mt-0.5 ml-0.5`} />
              </div>
            </label>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Show Timestamps</h4>
              <p className="text-sm text-gray-600">Display timestamps in conversations</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={preferencesForm.show_timestamps ?? true}
                onChange={(e) => setPreferencesForm(prev => ({ ...prev, show_timestamps: e.target.checked }))}
                className="sr-only"
              />
              <div className={`w-11 h-6 rounded-full transition-colors ${(preferencesForm.show_timestamps ?? true) ? 'bg-blue-600' : 'bg-gray-300'}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${(preferencesForm.show_timestamps ?? true) ? 'translate-x-5' : 'translate-x-0'} mt-0.5 ml-0.5`} />
              </div>
            </label>
          </div>
        </div>
      </div>
      
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">AI Settings</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Default Model</h4>
              <p className="text-sm text-gray-600">Default AI model for new agents</p>
            </div>
            <select
              value={preferencesForm.default_model || 'gpt-4'}
              onChange={(e) => setPreferencesForm(prev => ({ ...prev, default_model: e.target.value }))}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="gpt-4">GPT-4</option>
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
              <option value="claude-3">Claude 3</option>
              <option value="gemini-pro">Gemini Pro</option>
            </select>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Max Tokens</h4>
              <p className="text-sm text-gray-600">Maximum tokens per response</p>
            </div>
            <select
              value={preferencesForm.max_tokens || 2000}
              onChange={(e) => setPreferencesForm(prev => ({ ...prev, max_tokens: parseInt(e.target.value) }))}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="1000">1,000</option>
              <option value="2000">2,000</option>
              <option value="4000">4,000</option>
              <option value="8000">8,000</option>
            </select>
          </div>

          <div className="p-4 border border-gray-200 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h4 className="font-medium text-gray-900">Temperature</h4>
                <p className="text-sm text-gray-600">Creativity level (0.0 - 2.0)</p>
              </div>
              <span className="text-sm font-medium text-gray-700">
                {preferencesForm.temperature || 0.7}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={preferencesForm.temperature || 0.7}
              onChange={(e) => setPreferencesForm(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>Focused</span>
              <span>Balanced</span>
              <span>Creative</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Data & Privacy</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Data Retention</h4>
              <p className="text-sm text-gray-600">How long to keep your conversation data</p>
            </div>
            <select
              value={preferencesForm.data_retention_days || 365}
              onChange={(e) => setPreferencesForm(prev => ({ ...prev, data_retention_days: parseInt(e.target.value) }))}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
              <option value="-1">Forever</option>
            </select>
          </div>

          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div>
              <h4 className="font-medium text-gray-900">Analytics</h4>
              <p className="text-sm text-gray-600">Help improve the platform with usage analytics</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={preferencesForm.analytics_enabled ?? true}
                onChange={(e) => setPreferencesForm(prev => ({ ...prev, analytics_enabled: e.target.checked }))}
                className="sr-only"
              />
              <div className={`w-11 h-6 rounded-full transition-colors ${(preferencesForm.analytics_enabled ?? true) ? 'bg-blue-600' : 'bg-gray-300'}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform ${(preferencesForm.analytics_enabled ?? true) ? 'translate-x-5' : 'translate-x-0'} mt-0.5 ml-0.5`} />
              </div>
            </label>
          </div>
        </div>

        <div className="flex gap-3 pt-6">
          <button 
            onClick={savePreferences}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Changes
          </button>
          <button 
            onClick={() => setPreferencesForm(preferences || {})}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Settings className="w-8 h-8 text-gray-700" />
              <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
            </div>
            <p className="text-gray-600">Manage your account, plugins, and preferences</p>
          </div>
          <button 
            onClick={loadUserData}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            title="Refresh settings"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Tab Navigation */}
        <div className="lg:w-64">
          <nav className="bg-white border border-gray-200 rounded-lg p-2 sticky top-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {tab.icon}
                <span className="font-medium">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1">
          {activeTab === 'plugins' && renderPluginsTab()}
          {activeTab === 'profile' && renderProfileTab()}
          {activeTab === 'notifications' && renderNotificationsTab()}
          {activeTab === 'security' && renderSecurityTab()}
          {activeTab === 'preferences' && renderPreferencesTab()}
        </div>
      </div>
    </>
  )
}