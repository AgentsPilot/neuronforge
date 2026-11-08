'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { Globe, Loader2, XCircle } from 'lucide-react';
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

/** Which plugin backs each sync provider — the two names differ. */
const PROVIDER_PLUGIN: Record<'google_calendar' | 'outlook', string> = {
  google_calendar: 'google-calendar',
  outlook: 'outlook',
};

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
  /** Which row's ⋯ menu is open. One at a time, by construction. */
  const [openMenu, setOpenMenu] = useState<string | null>(null);

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

        /*
         * ───────────────────────────────────────────────────────────────────
         * CONNECTING IS ENABLING.
         *
         * Connecting a calendar and switching sync on were two separate
         * actions, and the second had no visible home — so an owner connected
         * Google, saw a green dot, and nothing was ever blocked. Measured on a
         * live account: `calendar_sync_enabled` false, provider null, and
         * `calendar_last_synced_at` null, against a healthy `google-calendar`
         * connection with calendar scope.
         *
         * Nobody connects a calendar HERE, in the availability settings, for
         * any purpose other than using it. So the connection turns it on.
         *
         * Only when nothing is syncing yet: a second calendar connected later
         * must not quietly steal the sync from the one already running, since
         * `calendar_sync_provider` holds one provider and the owner would have
         * no idea the first had stopped. That row offers "sync from this one
         * instead", which is the same decision made deliberately.
         *
         * Enabling is awaited inside the route, which also performs the first
         * read — so by the time the panel refreshes, the meetings are already
         * stored and the row can state a real number.
         * ───────────────────────────────────────────────────────────────────
         */
        const provider =
          pluginKey === 'google-calendar'
            ? ('google_calendar' as const)
            : pluginKey === 'outlook'
              ? ('outlook' as const)
              : null;

        if (provider && !syncEnabled) {
          await handleEnableSync(provider);
        }

        setTimeout(async () => {
          setConnectionStatus(null);
          setConnectingPlugin(null);
          await refreshPlugins();
        }, 2000);
      } else {
        setConnectionStatus({
          plugin: pluginKey,
          status: 'error',
          message: result.error || t('scheduling.calendar_sync.cal_connect_failed')
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
      // Turn sync off FIRST when this is the calendar sync runs on. Disconnecting
      // only removes the plugin; the business profile would still say sync is on
      // with a provider that no longer exists, leaving the busy times it imported
      // blocking slots with nothing left to refresh or remove them.
      if (syncEnabled && PROVIDER_PLUGIN[activeProvider ?? 'google_calendar'] === pluginKey) {
        await fetch('/api/scheduling/calendar-sync/disable', { method: 'POST' });
      }

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
          // Drops the imported busy times from the calendar view in the same
          // pass, rather than leaving them on screen until a reload.
          onSyncChanged?.();
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
  /**
   * The connection, drawn: your calendar → AgentsPilot → your booking page.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY A PICTURE AND NOT A STATUS WORD.
   *
   * The thing an owner needs to know is not a setting, it is whether their
   * meetings reach the booking page. A dashed first link says "we cannot see
   * your diary" without a sentence, and it says it the same way the dashboard
   * already says things: stations, a line between them, and the line stopping
   * where the work stops.
   *
   * Each ROW draws its own line, which is what makes two connected calendars
   * legible: one flows, the other is dashed and labelled "blocking nothing".
   * That state — connected, syncing nothing — was invisible before, and it is
   * exactly what sent an owner hunting for a switch that was never pressed.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const renderDiagram = (mode: 'off' | 'live' | 'bad', pluginKey?: string) => {
    const node = (content: ReactNode, cls: string) => (
      <span className={`csd-nd ${cls}`}>{content}</span>
    );

    return (
      <span className="csd" aria-hidden="true">
        {node(
          pluginKey ? <PluginIcon pluginId={pluginKey} className="w-4 h-4" alt="" /> : '?',
          mode === 'live' ? 'on' : mode === 'bad' ? 'bad' : 'off'
        )}
        <span className={`csd-pp ${mode === 'live' ? 'flow' : mode === 'bad' ? 'bad' : 'cut'}`}>
          {mode === 'live' && <i />}
        </span>
        {/*
          * OUR OWN MARK, NOT A LIGHTNING BOLT. `PluginIcon` already maps
          * `business-os` to the app's favicon precisely for this: the platform
          * is not a third party and has no vendor logo, but it does have a
          * face, and the row reads as three real things rather than two logos
          * and a glyph.
          */}
        {node(<PluginIcon pluginId="business-os" className="w-4 h-4" alt="" />, mode === 'live' ? 'on' : '')}
        <span className={`csd-pp ${mode === 'live' ? 'flow' : 'cut'}`}>
          {mode === 'live' && <i />}
        </span>
        {node(<Globe className="w-3.5 h-3.5" />, mode === 'live' ? 'on' : '')}
      </span>
    );
  };

  /** Relative, because "14:32" asks the reader to subtract. */
  const sinceLabel = (iso: string | null) => formatLastSynced(iso);

  /**
   * How long ago the last successful read was, in minutes.
   *
   * The cron runs every five. Thirty minutes means six missed passes, which is
   * not a blip — it is a connection that has stopped answering, and the owner's
   * hours are no longer being blocked by anything new.
   */
  const minutesSinceSync = (() => {
    if (!status?.lastSyncedAt) return null;
    const ms = Date.now() - new Date(status.lastSyncedAt).getTime();
    return Number.isFinite(ms) ? Math.floor(ms / 60000) : null;
  })();

  /** One row per connected calendar. The row IS the control surface. */
  const renderCalendarRow = (provider: 'google_calendar' | 'outlook') => {
    const pluginKey = PROVIDER_PLUGIN[provider];
    const plugin = calendarPlugins.find(p => p.key === pluginKey);
    if (!plugin) return null;

    const name = getPluginDisplayName(pluginKey);
    const isLive = Boolean(syncEnabled) && activeProvider === provider;
    const stale = isLive && minutesSinceSync !== null && minutesSinceSync > 30;
    const busy = enablingProvider === provider || disconnectingPlugin === pluginKey || (disabling && isLive);
    const menuOpen = openMenu === pluginKey;

    return (
      <div
        key={provider}
        className={`csd-row${isLive && !stale ? ' live' : ''}${stale ? ' warn' : ''}`}
      >
        <div className="csd-main">
          {renderDiagram(stale ? 'bad' : isLive ? 'live' : 'off', pluginKey)}

          <div className="csd-say">
            <p className="csd-l1">
              {(stale
                ? t('scheduling.calendar_sync.cal_stale')
                : isLive
                  ? t('scheduling.calendar_sync.cal_blocking')
                  : t('scheduling.calendar_sync.cal_idle')
              ).replace('{name}', name)}
            </p>
            <p className="csd-l2">
              {stale ? (
                t('scheduling.calendar_sync.cal_stale_sub')
              ) : isLive ? (
                <>
                  {plugin.username && <span>{plugin.username}</span>}
                  {plugin.username && <span className="csd-sep">·</span>}
                  <span className="csd-ok">
                    {t('scheduling.calendar_sync.cal_meetings').replace(
                      '{count}',
                      String(status?.stats.total ?? 0)
                    )}
                  </span>
                  <span className="csd-sep">·</span>
                  <span>
                    {t('scheduling.calendar_sync.cal_checked').replace(
                      '{when}',
                      sinceLabel(status?.lastSyncedAt ?? null)
                    )}
                  </span>
                </>
              ) : (
                t('scheduling.calendar_sync.cal_idle_sub')
              )}
            </p>
          </div>
        </div>

        <div className="csd-acts">
          {busy && <Loader2 className="w-4 h-4 animate-spin text-[var(--v2-text-muted)]" />}

          {/*
            * The idle row carries ONE visible action, because it has one
            * obvious thing an owner would want from it. The live row's actions
            * are all rare, so they sit behind the ⋯ rather than competing with
            * the line that actually has to be read.
            */}
          {!isLive && !busy && (
            <button
              onClick={() => handleEnableSync(provider)}
              className="csd-btn"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {t('scheduling.calendar_sync.cal_use_instead')}
            </button>
          )}

          <button
            onClick={() => setOpenMenu(menuOpen ? null : pluginKey)}
            aria-expanded={menuOpen}
            aria-label={name}
            className="csd-kebab"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            ⋯
          </button>

          {menuOpen && (
            <div className="csd-menu" style={{ borderRadius: 'var(--v2-radius-card)' }}>
              {isLive && (
                <button onClick={() => { setOpenMenu(null); handleRefreshExternal(); }}>
                  {t('scheduling.calendar_sync.cal_menu_check')}
                </button>
              )}
              {isLive && (
                <button onClick={() => { setOpenMenu(null); handleDisableSync(); }}>
                  {t('scheduling.calendar_sync.cal_menu_pause')}
                </button>
              )}
              <button
                className="danger"
                onClick={() => { setOpenMenu(null); handleDisconnectPrompt(pluginKey); }}
              >
                {t('scheduling.calendar_sync.cal_menu_disconnect')}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  /** The two calendars we support, minus the ones already connected. */
  const unconnected = (
    [
      ['google_calendar', 'google-calendar'],
      ['outlook', 'outlook'],
    ] as Array<['google_calendar' | 'outlook', string]>
  ).filter(([, key]) => !calendarPlugins.some(p => p.key === key));

  const styles = (
    <style jsx global>{`
      .csd-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        flex-wrap: wrap;
        padding: 11px 14px;
        border: 1px solid var(--v2-border);
        border-radius: var(--v2-radius-card);
        background: var(--v2-surface);
      }
      .csd-row + .csd-row { margin-top: 8px; }
      .csd-row.live { border-color: rgba(20, 184, 166, 0.38); }
      .csd-row.warn { border-color: rgba(240, 167, 66, 0.45); }

      .csd-main { display: flex; align-items: center; gap: 13px; min-width: 0; flex: 1 1 240px; }
      .csd { display: flex; align-items: center; flex-shrink: 0; }

      .csd-nd {
        width: 28px; height: 28px;
        border-radius: 8px;
        display: grid; place-items: center;
        font-size: 13px;
        background: var(--v2-bg);
        border: 1.5px solid var(--v2-border);
        color: var(--v2-text-muted);
      }
      .csd-nd.on { border-color: #14B8A6; box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12); }
      .csd-nd.off { border-style: dashed; }
      .csd-nd.bad { border-color: #F0A742; box-shadow: 0 0 0 3px rgba(240, 167, 66, 0.12); }

      .csd-pp {
        width: 22px; height: 2px;
        margin: 0 3px;
        border-radius: 2px;
        background: var(--v2-border);
        position: relative;
        overflow: hidden;
      }
      .csd-pp.flow { background: rgba(20, 184, 166, 0.3); }
      .csd-pp.flow i {
        position: absolute; top: -2px;
        width: 6px; height: 6px; border-radius: 50%;
        background: #2DD4BF;
        animation: csdDrift 2.2s linear infinite;
      }
      @keyframes csdDrift { from { inset-inline-start: -6px; } to { inset-inline-start: 100%; } }
      .csd-pp.cut { height: 0; background: transparent; border-top: 2px dashed var(--v2-border); }
      .csd-pp.bad { height: 0; background: transparent; border-top: 2px dashed #F0A742; }

      .csd-say { min-width: 0; }
      .csd-l1 { margin: 0; font-size: 13.5px; color: var(--v2-text-primary); line-height: 1.35; }
      .csd-l2 { margin: 1px 0 0; font-size: 12px; color: var(--v2-text-muted); }
      .csd-ok { color: #14B8A6; }
      .csd-sep { margin: 0 5px; opacity: 0.5; }

      .csd-acts { display: flex; align-items: center; gap: 7px; flex-shrink: 0; position: relative; }
      .csd-btn {
        /* Inline-flex, or the mark and its label stack: PluginIcon renders an
           <img>, which is block-level inside a plain button. */
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px; font-weight: 500;
        padding: 6px 11px;
        border: 1px solid var(--v2-border);
        background: var(--v2-bg);
        color: var(--v2-text-primary);
        white-space: nowrap;
        transition: border-color 0.15s, color 0.15s;
      }
      .csd-btn:hover { border-color: #14B8A6; color: #14B8A6; }
      .csd-kebab {
        width: 28px; height: 28px;
        border: 1px solid var(--v2-border);
        background: transparent;
        color: var(--v2-text-muted);
        font-size: 14px;
        display: grid; place-items: center;
      }
      .csd-kebab:hover { border-color: #14B8A6; color: #14B8A6; }

      .csd-menu {
        position: absolute;
        top: 34px;
        inset-inline-end: 0;
        min-width: 168px;
        z-index: 20;
        overflow: hidden;
        background: var(--v2-surface);
        border: 1px solid var(--v2-border);
        box-shadow: 0 12px 28px -12px rgba(0, 0, 0, 0.5);
      }
      .csd-menu button {
        display: block; width: 100%;
        text-align: start;
        padding: 9px 13px;
        font-size: 12.5px;
        background: transparent;
        border: 0;
        color: var(--v2-text-primary);
        cursor: pointer;
      }
      .csd-menu button + button { border-top: 1px solid var(--v2-border); }
      .csd-menu button:hover { background: var(--v2-surface-hover); }
      .csd-menu button.danger { color: #EF4444; }

      .csd-add { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-top: 9px; }
      .csd-add span { font-size: 11.5px; color: var(--v2-text-muted); }

      @media (prefers-reduced-motion: reduce) {
        .csd-pp.flow i { animation: none; inset-inline-start: 42%; }
      }
    `}</style>
  );

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

            {/* Disconnecting the calendar sync runs on costs more than the
                others: it stops sync and drops the imported busy times. Said
                here, before the click, not discovered afterwards. */}
            {(() => {
              const stopsSync =
                syncEnabled &&
                PROVIDER_PLUGIN[activeProvider ?? 'google_calendar'] === disconnectPrompt;

              return (
                <>
                  <p
                    className={`text-sm text-[var(--v2-text-secondary)] text-center ${
                      stopsSync ? 'mb-3' : 'mb-6'
                    }`}
                  >
                    {t('scheduling.calendar_sync.disconnect_desc')}
                  </p>
                  {stopsSync && (
                    <p className="text-sm text-amber-600 dark:text-amber-400 text-center mb-6">
                      {t('scheduling.calendar_sync.disconnect_stops_sync')}
                    </p>
                  )}
                </>
              );
            })()}

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


  /*
   * ───────────────────────────────────────────────────────────────────────────
   * TWO SHAPES, NOT THREE SCREENS.
   *
   * Nothing connected: one row saying what it costs the owner, and the two
   * calendars we support. Anything connected: one row per calendar, each
   * drawing its own line.
   *
   * There is no "connected but not syncing" SCREEN any more, because there is
   * no such step: `handleConnectPlugin` turns sync on as part of connecting.
   * The state still EXISTS — a second calendar, or one the owner paused — and
   * it shows as a dashed row rather than as a different layout.
   * ───────────────────────────────────────────────────────────────────────────
   */
  if (!anyCalendarConnected) {
    return (
      <>
        <div className="csd-row" dir={isRTL ? 'rtl' : 'ltr'}>
          <div className="csd-main">
            {renderDiagram('off')}
            <div className="csd-say">
              <p className="csd-l1">{t('scheduling.calendar_sync.cal_none_title')}</p>
              <p className="csd-l2">{t('scheduling.calendar_sync.cal_none_sub')}</p>
            </div>
          </div>
          <div className="csd-acts">
            {unconnected.map(([provider, key]) => (
              <button
                key={key}
                onClick={() => handleConnectPlugin(key)}
                disabled={connectingPlugin !== null}
                className="csd-btn"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {connectingPlugin === key ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <PluginIcon pluginId={key} className="w-3.5 h-3.5" alt="" />
                )}
                {getPluginDisplayName(key)}
              </button>
            ))}
          </div>
        </div>
        {connectionStatus?.message && connectionStatus.status === 'error' && (
          <p className="mt-2 text-sm text-red-500">{connectionStatus.message}</p>
        )}
        {styles}
        {renderDisconnectModal()}
      </>
    );
  }

  return (
    <>
      <div dir={isRTL ? 'rtl' : 'ltr'}>
        {renderCalendarRow('google_calendar')}
        {renderCalendarRow('outlook')}

        {unconnected.length > 0 && (
          <div className="csd-add">
            <span>{t('scheduling.calendar_sync.cal_add')}</span>
            {unconnected.map(([provider, key]) => (
              <button
                key={key}
                onClick={() => handleConnectPlugin(key)}
                disabled={connectingPlugin !== null}
                className="csd-btn"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {connectingPlugin === key ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <PluginIcon pluginId={key} className="w-3 h-3" alt="" />
                )}
                {getPluginDisplayName(key)}
              </button>
            ))}
          </div>
        )}

        {connectionStatus?.message && (
          <p
            className={`mt-2 text-sm ${
              connectionStatus.status === 'error' ? 'text-red-500' : 'text-[#14B8A6]'
            }`}
          >
            {connectionStatus.message}
          </p>
        )}
      </div>
      {styles}
      {renderDisconnectModal()}
    </>
  );
}
