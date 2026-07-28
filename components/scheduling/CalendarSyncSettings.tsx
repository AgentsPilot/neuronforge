'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, AlertCircle, Loader2, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { PluginIcon } from '@/components/PluginIcon';
import { useAuth } from '@/components/UserProvider';
import { getPluginAPIClient } from '@/lib/client/plugin-api-client';

interface CalendarSyncStatus {
  enabled: boolean;
  provider: 'google_calendar' | 'outlook' | null;
  lastSyncedAt: string | null;
  stats: {
    total: number;
    synced: number;
    failed: number;
  };
}

interface ConnectedPlugin {
  key: string;
  name?: string;
  is_expired?: boolean;
  username?: string;
}

interface CalendarSyncSettingsProps {
  onSyncChanged?: () => void;
}

export function CalendarSyncSettings({ onSyncChanged }: CalendarSyncSettingsProps) {
  const { t, isRTL } = useLanguage();
  const { user, connectedPlugins, refreshPlugins } = useAuth();
  const [status, setStatus] = useState<CalendarSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshingCalendar, setRefreshingCalendar] = useState(false);
  const [enablingProvider, setEnablingProvider] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);

  // Plugin connection states (same as Footer)
  const [connectingPlugin, setConnectingPlugin] = useState<string | null>(null);
  const [refreshingToken, setRefreshingToken] = useState<string | null>(null);
  const [disconnectingPlugin, setDisconnectingPlugin] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<{
    plugin: string;
    status: 'success' | 'error';
    message?: string;
  } | null>(null);

  // Disconnect confirmation dialog (same as Footer)
  const [disconnectPrompt, setDisconnectPrompt] = useState<string | null>(null);

  // Get calendar plugins from connected plugins
  const calendarPlugins: ConnectedPlugin[] = connectedPlugins
    ? Object.values(connectedPlugins)
        .filter((p: any) => p.key === 'google-calendar' || p.key === 'outlook')
        .map((p: any) => ({
          key: p.key,
          name: p.name || p.displayName,
          is_expired: p.is_expired || false,
          username: p.username
        }))
    : [];

  const googlePlugin = calendarPlugins.find(p => p.key === 'google-calendar');
  const outlookPlugin = calendarPlugins.find(p => p.key === 'outlook');
  const googleConnected = !!googlePlugin;
  const outlookConnected = !!outlookPlugin;
  const anyCalendarConnected = googleConnected || outlookConnected;

  useEffect(() => {
    fetchSyncStatus();
  }, []);

  const fetchSyncStatus = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/scheduling/calendar-sync/status');
      const data = await response.json();

      if (data.success) {
        setStatus({
          enabled: data.enabled,
          provider: data.provider,
          lastSyncedAt: data.lastSyncedAt,
          stats: data.stats
        });
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  };

  // Connect plugin using same mechanism as Footer
  const handleConnectPlugin = async (pluginKey: string) => {
    if (!user) return;

    setConnectingPlugin(pluginKey);
    setConnectionStatus(null);

    try {
      const pluginAPIClient = getPluginAPIClient();
      const result = await pluginAPIClient.connectPlugin(user.id, pluginKey);

      if (result.success) {
        setConnectionStatus({ plugin: pluginKey, status: 'success' });

        setTimeout(async () => {
          setConnectionStatus(null);
          setConnectingPlugin(null);
          await refreshPlugins();
        }, 2000);
      } else {
        setConnectionStatus({
          plugin: pluginKey,
          status: 'error',
          message: result.error || 'Connection failed'
        });

        setTimeout(() => {
          setConnectionStatus(null);
          setConnectingPlugin(null);
        }, 3000);
      }
    } catch (error: any) {
      setConnectionStatus({
        plugin: pluginKey,
        status: 'error',
        message: error.message || 'Failed to connect'
      });

      setTimeout(() => {
        setConnectionStatus(null);
        setConnectingPlugin(null);
      }, 3000);
    }
  };

  // Show disconnect confirmation dialog (same as Footer)
  const handleDisconnectPrompt = (pluginKey: string) => {
    setDisconnectPrompt(pluginKey);
  };

  // Cancel disconnect
  const handleCancelDisconnect = () => {
    setDisconnectPrompt(null);
  };

  // Confirm and disconnect plugin (same as Footer)
  const handleConfirmDisconnect = async (pluginKey: string) => {
    if (!user) return;

    setDisconnectPrompt(null);
    setDisconnectingPlugin(pluginKey);
    setConnectionStatus(null);

    try {
      const pluginAPIClient = getPluginAPIClient();
      const result = await pluginAPIClient.disconnectPlugin(user.id, pluginKey);

      if (result.success) {
        setConnectionStatus({ plugin: pluginKey, status: 'success' });

        setTimeout(async () => {
          setConnectionStatus(null);
          setDisconnectingPlugin(null);
          await refreshPlugins();
          // Also refresh sync status in case the disconnected plugin was being used for sync
          await fetchSyncStatus();
        }, 2000);
      } else {
        setConnectionStatus({
          plugin: pluginKey,
          status: 'error',
          message: result.error || 'Disconnect failed'
        });

        setTimeout(() => {
          setConnectionStatus(null);
          setDisconnectingPlugin(null);
        }, 3000);
      }
    } catch (error: any) {
      setConnectionStatus({
        plugin: pluginKey,
        status: 'error',
        message: error.message || 'Failed to disconnect'
      });

      setTimeout(() => {
        setConnectionStatus(null);
        setDisconnectingPlugin(null);
      }, 3000);
    }
  };

  // Get plugin display name
  const getPluginDisplayName = (pluginKey: string) => {
    if (pluginKey === 'google-calendar') return 'Google Calendar';
    if (pluginKey === 'outlook') return 'Outlook';
    return pluginKey;
  };

  // Refresh expired token using same mechanism as Footer
  const handleRefreshToken = async (pluginKey: string) => {
    if (!user) return;

    setRefreshingToken(pluginKey);
    setConnectionStatus(null);

    try {
      const response = await fetch('/api/plugins/refresh-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginKeys: [pluginKey] })
      });

      const result = await response.json();

      if (result.success && result.refreshed?.includes(pluginKey)) {
        setConnectionStatus({ plugin: pluginKey, status: 'success' });

        setTimeout(async () => {
          setConnectionStatus(null);
          setRefreshingToken(null);
          await refreshPlugins();
        }, 2000);
      } else if (result.failed?.includes(pluginKey)) {
        // Token refresh failed - need to reconnect via OAuth
        setRefreshingToken(null);
        handleConnectPlugin(pluginKey);
      } else {
        setConnectionStatus({
          plugin: pluginKey,
          status: 'error',
          message: result.message || 'Refresh failed'
        });

        setTimeout(() => {
          setConnectionStatus(null);
          setRefreshingToken(null);
        }, 3000);
      }
    } catch {
      setRefreshingToken(null);
      handleConnectPlugin(pluginKey);
    }
  };

  const handleEnableSync = async (provider: 'google_calendar' | 'outlook') => {
    try {
      setEnablingProvider(provider);
      const response = await fetch('/api/scheduling/calendar-sync/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider })
      });

      const data = await response.json();
      if (data.success) {
        fetchSyncStatus();
        // Trigger calendar refresh to show external events
        onSyncChanged?.();
      }
    } catch {
      // Silent fail
    } finally {
      setEnablingProvider(null);
    }
  };

  const handleDisableSync = async () => {
    try {
      setDisabling(true);
      const response = await fetch('/api/scheduling/calendar-sync/disable', {
        method: 'POST'
      });

      const data = await response.json();
      if (data.success) {
        fetchSyncStatus();
        // Trigger calendar refresh to remove external events from view
        onSyncChanged?.();
      }
    } catch {
      // Silent fail
    } finally {
      setDisabling(false);
    }
  };

  const handleRefreshExternal = async () => {
    try {
      setRefreshingCalendar(true);
      const response = await fetch('/api/scheduling/calendar-sync/refresh-external', {
        method: 'POST'
      });

      const data = await response.json();
      if (data.success) {
        fetchSyncStatus();
        // Trigger calendar refresh to show updated external events
        onSyncChanged?.();
      }
    } catch {
      // Silent fail
    } finally {
      setRefreshingCalendar(false);
    }
  };

  const formatLastSynced = (dateStr: string | null) => {
    if (!dateStr) return t('scheduling.calendar_sync.never');
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return t('scheduling.calendar_sync.just_now');
    if (diffMins < 60) return t('scheduling.calendar_sync.minutes_ago', { minutes: diffMins });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return t('scheduling.calendar_sync.hours_ago', { hours: diffHours });
    return date.toLocaleDateString();
  };

  const syncEnabled = status?.enabled;
  const activeProvider = status?.provider;

  if (loading) {
    return (
      <div
        className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4 animate-pulse"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
      >
        <div className="h-6 bg-[var(--v2-border)] rounded w-1/3"></div>
      </div>
    );
  }

  // Render a plugin icon button (same style as Footer)
  const renderPluginButton = (pluginKey: string, plugin: ConnectedPlugin | undefined, isConnected: boolean, showDisconnect: boolean = false) => {
    const isLoading = connectingPlugin === pluginKey || refreshingToken === pluginKey || disconnectingPlugin === pluginKey;
    const hasSuccess = connectionStatus?.plugin === pluginKey && connectionStatus.status === 'success';
    const hasError = connectionStatus?.plugin === pluginKey && connectionStatus.status === 'error';
    const isExpired = plugin?.is_expired;
    const hasDisconnectPrompt = disconnectPrompt === pluginKey;

    const handleClick = () => {
      if (isLoading) return;
      if (!isConnected) {
        handleConnectPlugin(pluginKey);
      } else if (isExpired) {
        handleRefreshToken(pluginKey);
      } else if (showDisconnect) {
        handleDisconnectPrompt(pluginKey);
      }
    };

    const getTitle = () => {
      if (isConnected) {
        if (isExpired) {
          return `${getPluginDisplayName(pluginKey)} - Token expired. Click to refresh`;
        }
        if (showDisconnect) {
          return `${getPluginDisplayName(pluginKey)} - Click to disconnect`;
        }
        return `${getPluginDisplayName(pluginKey)} - Connected${plugin?.username ? ` as ${plugin.username}` : ''}`;
      }
      return `Connect ${getPluginDisplayName(pluginKey)}`;
    };

    return (
      <div
        key={pluginKey}
        className={`relative w-12 h-12 bg-[var(--v2-surface)] flex items-center justify-center flex-shrink-0 transition-all duration-200 border ${
          isConnected
            ? isExpired
              ? 'border-orange-300 dark:border-orange-700'
              : 'border-green-300 dark:border-green-700'
            : 'border-[var(--v2-border)]'
        } ${!isLoading ? 'cursor-pointer hover:border-[var(--v2-primary)] hover:shadow-lg' : 'cursor-default'}`}
        style={{ borderRadius: 'var(--v2-radius-button)', boxShadow: 'var(--v2-shadow-card)' }}
        onClick={handleClick}
        title={getTitle()}
      >
        <PluginIcon pluginId={pluginKey} className="w-6 h-6" alt={pluginKey === 'google-calendar' ? 'Google Calendar' : 'Outlook'} />

        {/* Status indicator */}
        {isConnected && !isLoading && !hasSuccess && !hasError && (
          isExpired ? (
            <div
              className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full border-2 shadow-sm overflow-hidden animate-pulse"
              style={{ borderColor: 'var(--v2-bg)' }}
            >
              <div className="absolute inset-0 flex">
                <div className="w-1/2 bg-green-500"></div>
                <div className="w-1/2 bg-orange-500"></div>
              </div>
            </div>
          ) : (
            <div
              className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-green-500 rounded-full border-2 shadow-sm"
              style={{ borderColor: 'var(--v2-bg)' }}
            />
          )
        )}

        {/* Loading overlay */}
        {isLoading && (
          <div
            className="absolute inset-0 bg-[var(--v2-surface)]/95 flex items-center justify-center backdrop-blur-sm"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <Loader2 className="w-5 h-5 text-[var(--v2-primary)] animate-spin" />
          </div>
        )}

        {/* Success overlay */}
        {hasSuccess && (
          <div
            className="absolute inset-0 bg-green-500/95 flex items-center justify-center animate-fade-in"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <CheckCircle2 className="w-6 h-6 text-white" />
          </div>
        )}

        {/* Error overlay */}
        {hasError && (
          <div
            className="absolute inset-0 bg-red-500/95 flex items-center justify-center animate-fade-in"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <AlertCircle className="w-6 h-6 text-white" />
          </div>
        )}

        {/* Disconnect prompt indicator (pulsing red) */}
        {hasDisconnectPrompt && (
          <div
            className="absolute inset-0 bg-red-500/20 flex items-center justify-center animate-pulse"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <XCircle className="w-5 h-5 text-red-500" />
          </div>
        )}
      </div>
    );
  };

  // Disconnect Confirmation Modal (same as Footer)
  const renderDisconnectModal = () => {
    if (!disconnectPrompt) return null;

    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/50 z-50 animate-fade-in"
          onClick={handleCancelDisconnect}
        />

        {/* Modal */}
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 animate-fade-in">
          <div
            className="bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-2xl p-6 min-w-[320px] max-w-[400px]"
            style={{
              borderRadius: 'var(--v2-radius-card)',
              boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)'
            }}
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            {/* Icon */}
            <div className="flex justify-center mb-4">
              <div
                className="w-14 h-14 bg-red-500/10 flex items-center justify-center"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <XCircle className="w-8 h-8 text-red-500" />
              </div>
            </div>

            {/* Title */}
            <h3 className="text-lg font-semibold text-[var(--v2-text-primary)] text-center mb-2">
              {t('scheduling.calendar_sync.disconnect_title')}
            </h3>

            {/* Plugin Name */}
            <p className="text-sm text-[var(--v2-text-secondary)] text-center mb-4">
              {getPluginDisplayName(disconnectPrompt)}
            </p>

            {/* Description */}
            <p className="text-sm text-[var(--v2-text-secondary)] text-center mb-6">
              {t('scheduling.calendar_sync.disconnect_desc')}
            </p>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleCancelDisconnect}
                className="flex-1 px-4 py-2.5 text-sm font-medium bg-[var(--v2-background)] border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface)] transition-colors"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {t('button.cancel')}
              </button>
              <button
                onClick={() => handleConfirmDisconnect(disconnectPrompt)}
                className="flex-1 px-4 py-2.5 text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <XCircle className="w-4 h-4" />
                {t('scheduling.calendar_sync.disconnect_button')}
              </button>
            </div>
          </div>
        </div>

        {/* CSS Animation */}
        <style jsx>{`
          @keyframes fade-in {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          .animate-fade-in {
            animation: fade-in 0.2s ease-in-out;
          }
        `}</style>
      </>
    );
  };

  // State 1: No calendar connected - neutral banner
  if (!anyCalendarConnected) {
    return (
      <>
        <div
          className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-[var(--v2-text-secondary)]" />
                <h3 className="font-semibold text-[var(--v2-text-primary)]">
                  {t('scheduling.calendar_sync.not_connected')}
                </h3>
              </div>
              <p className="text-sm text-[var(--v2-text-secondary)] mt-1">
                {t('scheduling.calendar_sync.connect_desc')}
              </p>
            </div>
            <div className="flex gap-3">
              {renderPluginButton('google-calendar', googlePlugin, false)}
              {renderPluginButton('outlook', outlookPlugin, false)}
            </div>
          </div>
        </div>
        {renderDisconnectModal()}
      </>
    );
  }

  // State 2: Calendar connected but sync not enabled - light green banner
  // Note: User can only sync with ONE calendar - show both connected icons but only enable buttons for each
  if (anyCalendarConnected && !syncEnabled) {
    return (
      <>
        <div
          className="bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 p-4"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              {/* Show all calendar icons - connected ones with green dot, not connected without */}
              <div className="flex gap-2">
                {renderPluginButton('google-calendar', googlePlugin, googleConnected, googleConnected)}
                {renderPluginButton('outlook', outlookPlugin, outlookConnected, outlookConnected)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-teal-600 dark:text-teal-400" />
                  <h3 className="font-semibold text-teal-900 dark:text-teal-100">
                    {t('scheduling.calendar_sync.enable_sync')}
                  </h3>
                </div>
                <p className="text-sm text-teal-700 dark:text-teal-300 mt-1">
                  {t('scheduling.calendar_sync.enable_sync_desc')}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {googleConnected && !googlePlugin?.is_expired && (
                <button
                  onClick={() => handleEnableSync('google_calendar')}
                  disabled={enablingProvider !== null}
                  className="flex items-center gap-2 px-4 py-2 border border-[#14B8A6] text-[#14B8A6] bg-[#14B8A6]/10 hover:bg-[#14B8A6]/20 text-sm font-medium transition-all disabled:opacity-50"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {enablingProvider === 'google_calendar' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <PluginIcon pluginId="google-calendar" className="w-4 h-4" alt="Google Calendar" />
                  )}
                  {t('scheduling.calendar_sync.enable_google')}
                </button>
              )}
              {outlookConnected && !outlookPlugin?.is_expired && (
                <button
                  onClick={() => handleEnableSync('outlook')}
                  disabled={enablingProvider !== null}
                  className="flex items-center gap-2 px-4 py-2 border border-[#14B8A6] text-[#14B8A6] bg-[#14B8A6]/10 hover:bg-[#14B8A6]/20 text-sm font-medium transition-all disabled:opacity-50"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {enablingProvider === 'outlook' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <PluginIcon pluginId="outlook" className="w-4 h-4" alt="Outlook" />
                  )}
                  {t('scheduling.calendar_sync.enable_outlook')}
                </button>
              )}
            </div>
          </div>
        </div>
        {renderDisconnectModal()}
      </>
    );
  }

  // State 3: Sync enabled - green banner
  // Show both icons, active one with green highlight, other as normal connected
  const activePlugin = activeProvider === 'google_calendar' ? googlePlugin : outlookPlugin;
  const activePluginKey = activeProvider === 'google_calendar' ? 'google-calendar' : 'outlook';
  const inactivePluginKey = activeProvider === 'google_calendar' ? 'outlook' : 'google-calendar';
  const inactivePlugin = activeProvider === 'google_calendar' ? outlookPlugin : googlePlugin;
  const inactiveConnected = activeProvider === 'google_calendar' ? outlookConnected : googleConnected;

  return (
    <>
      <div
        className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            {/* Show both calendar icons - active with green, other as connected/not connected */}
            <div className="flex gap-2">
              {renderPluginButton('google-calendar', googlePlugin, googleConnected, googleConnected)}
              {renderPluginButton('outlook', outlookPlugin, outlookConnected, outlookConnected)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                <h3 className="font-semibold text-green-900 dark:text-green-100">
                  {activeProvider === 'google_calendar'
                    ? t('scheduling.calendar_sync.synced_google')
                    : t('scheduling.calendar_sync.synced_outlook')
                  }
                </h3>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-4 text-sm">
                <span className="text-green-700 dark:text-green-300">
                  {status?.stats.synced}/{status?.stats.total} {t('scheduling.calendar_sync.bookings_synced')}
                </span>
                {status?.stats.failed !== undefined && status.stats.failed > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    {status.stats.failed} {t('scheduling.calendar_sync.failed')}
                  </span>
                )}
                <span className="text-green-600 dark:text-green-400">
                  {t('scheduling.calendar_sync.last_synced')}: {formatLastSynced(status?.lastSyncedAt || null)}
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleRefreshExternal}
              disabled={refreshingCalendar}
              className="flex items-center px-3 py-1.5 text-sm font-medium text-[#14B8A6] border border-[#14B8A6] bg-[#14B8A6]/10 hover:bg-[#14B8A6]/20 transition-all disabled:opacity-50"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={t('scheduling.calendar_sync.refresh_tooltip')}
            >
              {refreshingCalendar ? (
                <Loader2 className="w-4 h-4 animate-spin me-2" />
              ) : (
                <RefreshCw className="w-4 h-4 me-2" />
              )}
              {t('scheduling.calendar_sync.refresh_button')}
            </button>
            <button
              onClick={handleDisableSync}
              disabled={disabling}
              className="flex items-center px-3 py-1.5 text-sm font-medium text-red-500 border border-red-500 bg-red-500/10 hover:bg-red-500/20 transition-all disabled:opacity-50"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {disabling ? <Loader2 className="w-4 h-4 animate-spin" /> : t('scheduling.calendar_sync.disable')}
            </button>
          </div>
        </div>
      </div>
      {renderDisconnectModal()}
    </>
  );
}
