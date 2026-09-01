'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Check, X, AlertCircle, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { useChannelConnect } from '@/hooks/useChannelConnect';
import { PluginIcon } from '@/components/PluginIcon';
import type { ChannelProvider } from '@/lib/business-os/channel-insights/providers';

/**
 * Connected channels, and what each one produced.
 *
 * Connection and result belong on one card because they answer the same
 * question — "is this channel working for me?" — and splitting them across two
 * surfaces made neither answerable.
 *
 * It also has to show WHICH account is being monitored. Discovering that the
 * wrong Facebook Page was picked, with no way to change it, was the failure this
 * card exists to prevent.
 */

interface ConnectionRow {
  id: string;
  platform: string;
  /** The account on the platform — the delete path needs it to clear its metrics. */
  account_id: string;
  account_name: string | null;
  insights_enabled: boolean;
  is_backfilling: boolean;
  needs_reconnect: boolean;
  last_sync_error: string | null;
}

/**
 * Brand marks come from public/plugins/, the same assets the rest of the app
 * uses for integrations — a generic lucide glyph reads as "some app", while the
 * real mark is recognised before the label is read.
 *
 * Meta carries two, because connecting the Page connects Instagram with it and
 * the user should see both are covered.
 */
const PROVIDERS: {
  provider: ChannelProvider;
  platforms: string[];
  /** Plugin-icon ids resolved to /plugins/{id}-plugin-v2.svg */
  logos: string[];
  labels: Record<string, string>;
  /**
   * Shown in the three-across tile row, where the full name cannot fit.
   * The brand mark above it carries the recognition, so the label only has to
   * disambiguate — hence "Google" for the listing versus "Analytics".
   */
  short: Record<string, string>;
}[] = [
  {
    provider: 'meta',
    platforms: ['facebook_page', 'instagram'],
    logos: ['facebook', 'instagram'],
    labels: { en: 'Facebook & Instagram', es: 'Facebook e Instagram', he: 'פייסבוק ואינסטגרם' },
    short: { en: 'Facebook', es: 'Facebook', he: 'פייסבוק' },
  },
  {
    provider: 'google_analytics',
    platforms: ['ga4'],
    logos: ['google-analytics'],
    labels: { en: 'Google Analytics', es: 'Google Analytics', he: 'גוגל אנליטיקס' },
    short: { en: 'Analytics', es: 'Analytics', he: 'אנליטיקס' },
  },
  {
    provider: 'google_business_profile',
    platforms: ['google_business_profile'],
    logos: ['google-business-profile'],
    labels: { en: 'Google Business Profile', es: 'Perfil de Empresa', he: 'פרופיל עסקי בגוגל' },
    short: { en: 'Google', es: 'Google', he: 'גוגל' },
  },
];

/** Per-connected-account mark, so a Facebook row and an Instagram row differ. */
const PLATFORM_LOGOS: Record<string, string> = {
  facebook_page: 'facebook',
  instagram: 'instagram',
  ga4: 'google-analytics',
  google_business_profile: 'google-business-profile',
};

const COPY: Record<string, Record<string, string>> = {
  title: { en: 'Your channels', es: 'Tus canales', he: 'הערוצים שלך' },
  subtitle: {
    en: 'Connect an account to see how many people it reaches',
    es: 'Conecta una cuenta para ver a cuánta gente llega',
    he: 'חבר חשבון כדי לראות לכמה אנשים הוא מגיע',
  },
  connect: { en: 'Connect', es: 'Conectar', he: 'חבר' },
  connecting: { en: 'Connecting…', es: 'Conectando…', he: 'מתחבר…' },
  backfilling: {
    en: 'Fetching history…',
    es: 'Obteniendo historial…',
    he: 'מושך היסטוריה…',
  },
  pause: { en: 'Pause', es: 'Pausar', he: 'השהה' },
  resume: { en: 'Resume', es: 'Reanudar', he: 'המשך' },
  paused: { en: 'Paused', es: 'Pausado', he: 'מושהה' },

  // Removing is not pausing: pausing stops collection, removing also deletes
  // what was collected. The confirm says so, because there is no undo.
  remove: { en: 'Remove', es: 'Quitar', he: 'הסר' },
  removeConfirm: {
    en: 'Remove this account and delete its collected data?',
    es: '¿Quitar esta cuenta y borrar los datos recopilados?',
    he: 'להסיר את החשבון הזה ולמחוק את הנתונים שנאספו?',
  },
  removeYes: { en: 'Remove', es: 'Quitar', he: 'הסר' },
  removeCancel: { en: 'Cancel', es: 'Cancelar', he: 'ביטול' },
  removeFailed: {
    en: "We couldn't remove this account. Try again.",
    es: 'No pudimos quitar esta cuenta. Inténtalo de nuevo.',
    he: 'לא הצלחנו להסיר את החשבון הזה. נסה שוב.',
  },
  // The plugin itself stays connected on purpose — an agent may be using it.
  removeNote: {
    en: 'The app stays connected — this only stops and clears insights.',
    es: 'La app sigue conectada — esto solo detiene y borra las estadísticas.',
    he: 'האפליקציה נשארת מחוברת — הפעולה עוצרת ומוחקת רק את הנתונים.',
  },
  choose: {
    en: 'Which one should we monitor?',
    es: '¿Cuál debemos analizar?',
    he: 'אחרי איזה לעקוב?',
  },
  // When the numbers arrive. Without this the card looks broken for a day:
  // nothing is fetched on connect, and the first figures land overnight.
  cadence: {
    en: 'Numbers refresh once a day, overnight.',
    es: 'Los números se actualizan una vez al día, de noche.',
    he: 'המספרים מתעדכנים פעם ביום, בלילה.',
  },
  backfillNote: {
    en: 'Fetching the last 90 days. Numbers appear after the first overnight sync.',
    es: 'Obteniendo los últimos 90 días. Los números aparecen tras la primera sincronización nocturna.',
    he: 'מושך את 90 הימים האחרונים. המספרים יופיעו אחרי הסנכרון הראשון בלילה.',
  },
  // A failed connection said "Parameter page_token should be string, got
  // object" at the user. What they need is what broke and what to do.
  errorReconnect: {
    en: 'We lost access to this account. Reconnect it to start collecting again.',
    es: 'Perdimos el acceso a esta cuenta. Vuelve a conectarla para seguir recolectando.',
    he: 'איבדנו גישה לחשבון הזה. חבר אותו מחדש כדי להמשיך לאסוף נתונים.',
  },
  errorGeneric: {
    en: 'We couldn\'t read this account\'s stats. We\'ll try again tonight.',
    es: 'No pudimos leer las estadísticas de esta cuenta. Lo intentaremos de nuevo esta noche.',
    he: 'לא הצלחנו לקרוא את הנתונים של החשבון הזה. ננסה שוב הלילה.',
  },
  syncNow: { en: 'Refresh now', es: 'Actualizar ahora', he: 'רענן עכשיו' },
  syncing: { en: 'Refreshing…', es: 'Actualizando…', he: 'מרענן…' },
  syncDone: {
    en: 'Up to date.',
    es: 'Actualizado.',
    he: 'הנתונים מעודכנים.',
  },
  syncEmpty: {
    en: 'Nothing came back — the platform has no data for this account yet.',
    es: 'No llegó nada — la plataforma aún no tiene datos de esta cuenta.',
    he: 'לא חזרו נתונים — לפלטפורמה עדיין אין מידע על החשבון הזה.',
  },
  syncFailed: {
    en: 'Refresh failed. The details are below.',
    es: 'La actualización falló. Los detalles están abajo.',
    he: 'הרענון נכשל. הפרטים למטה.',
  },

  // Why a connection attempt failed. The server sends the kind, not the
  // sentence, so a Hebrew user reads Hebrew — the reason these live here and
  // not in the API route. Each one says what the person can do; the single
  // case they cannot fix says so plainly instead of implying they broke it.
  'connectError.api_not_enabled': {
    en: "This connection isn't available yet — it needs switching on at our end. Nothing is wrong with your account.",
    es: 'Esta conexión aún no está disponible — falta activarla de nuestro lado. No hay ningún problema con tu cuenta.',
    he: 'החיבור הזה עדיין לא זמין — צריך להפעיל אותו אצלנו. אין שום בעיה בחשבון שלך.',
  },
  'connectError.reauth_required': {
    en: 'Your permission expired. Connect again to continue.',
    es: 'Tu permiso caducó. Vuelve a conectar para continuar.',
    he: 'ההרשאה שלך פגה. חבר מחדש כדי להמשיך.',
  },
  'connectError.not_connected': {
    en: "We couldn't read your account. Try connecting again.",
    es: 'No pudimos leer tu cuenta. Intenta conectarla de nuevo.',
    he: 'לא הצלחנו לקרוא את החשבון שלך. נסה לחבר שוב.',
  },
  'connectError.no_accounts.meta': {
    en: "We couldn't find a Facebook Page on your account. Insights work with a Page, not a personal profile.",
    es: 'No encontramos una página de Facebook en tu cuenta. Las estadísticas funcionan con una página, no con un perfil personal.',
    he: 'לא מצאנו עמוד פייסבוק בחשבון שלך. הנתונים עובדים עם עמוד עסקי, לא עם פרופיל אישי.',
  },
  'connectError.no_accounts.google_analytics': {
    en: "We couldn't find a Google Analytics property on this account. Only GA4 properties can be read — the old Universal Analytics has been shut down.",
    es: 'No encontramos una propiedad de Google Analytics en esta cuenta. Solo se pueden leer propiedades GA4 — el antiguo Universal Analytics ya cerró.',
    he: 'לא מצאנו נכס של Google Analytics בחשבון הזה. אפשר לקרוא רק נכסי GA4 — ה‑Universal Analytics הישן נסגר.',
  },
  'connectError.no_accounts.google_business_profile': {
    en: "We couldn't find a business listing on this Google account. The listing also has to be verified before Google will report on it.",
    es: 'No encontramos una ficha de empresa en esta cuenta de Google. La ficha también debe estar verificada para que Google informe sobre ella.',
    he: 'לא מצאנו רישום עסקי בחשבון הגוגל הזה. הרישום גם צריך להיות מאומת לפני שגוגל תדווח עליו.',
  },
  'connectError.start_failed': {
    en: "We couldn't start the connection. Try again.",
    es: 'No pudimos iniciar la conexión. Inténtalo de nuevo.',
    he: 'לא הצלחנו להתחיל את החיבור. נסה שוב.',
  },
  'connectError.not_completed': {
    en: 'The connection was not completed. Try again.',
    es: 'La conexión no se completó. Inténtalo de nuevo.',
    he: 'החיבור לא הושלם. נסה שוב.',
  },
  'connectError.connect_failed': {
    en: "We couldn't connect. Try again.",
    es: 'No pudimos conectar. Inténtalo de nuevo.',
    he: 'לא הצלחנו להתחבר. נסה שוב.',
  },
};

/**
 * What a sync failure means to the person reading it.
 *
 * The stored message is whatever the platform or the plugin validator said —
 * "(#100) The value must be a valid insights metric", "Parameter page_token
 * should be string, got object". Useful in a log, meaningless on a dashboard.
 * Anything token-shaped is actionable (reconnect); everything else is ours to
 * fix, so the card says it will retry rather than asking the user to do
 * something that would not help.
 */
function isReconnectable(message: string): boolean {
  return /token|expired|permission|oauth|access|session/i.test(message);
}

const PLATFORM_LABELS: Record<string, Record<string, string>> = {
  facebook_page: { en: 'Facebook', es: 'Facebook', he: 'פייסבוק' },
  instagram: { en: 'Instagram', es: 'Instagram', he: 'אינסטגרם' },
  ga4: { en: 'Website', es: 'Sitio web', he: 'אתר' },
  google_business_profile: { en: 'Google listing', es: 'Ficha de Google', he: 'רישום בגוגל' },
};

export function ChannelsCard({
  onChanged,
  embedded = false,
}: {
  onChanged?: () => void;
  /** Drop the card chrome when this sits inside a shared card. */
  embedded?: boolean;
}) {
  const { language, isRTL } = useLanguage();
  const t = (key: string) => COPY[key]?.[language] || COPY[key]?.en || key;

  /**
   * Turns a failure code into a sentence in the reader's language.
   *
   * 'no_accounts' reads differently per provider — a missing Facebook Page and
   * a missing GA4 property need different next steps. Anything unrecognised
   * (an auth slip, a 500) falls back to the generic line rather than putting a
   * bare code like `not_connected` on screen.
   */
  const connectErrorText = (code: string, provider: ChannelProvider | null) => {
    const key =
      code === 'no_accounts' && provider
        ? `connectError.no_accounts.${provider}`
        : `connectError.${code}`;
    return COPY[key] ? t(key) : t('connectError.connect_failed');
  };

  const [connections, setConnections] = useState<ConnectionRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Which row is asking "are you sure?" — the confirm replaces that row's
  // actions rather than opening a dialog over a card this small.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  // Outcome of a manual refresh, shown until the next one. Null while idle.
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/business-os/channel-insights/connections', {
        cache: 'no-store',
      });
      const json = await res.json();
      setConnections(json.success ? json.data.connections : []);
    } catch {
      setConnections([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const connect = useChannelConnect(() => {
    load();
    onChanged?.();
  });

  /**
   * Pull now rather than waiting for tonight.
   *
   * The route rate-limits to one call an hour and says how long is left, so the
   * button surfaces that answer instead of silently doing nothing.
   */
  const syncNow = async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
      const res = await fetch('/api/business-os/channel-insights/sync', { method: 'POST' });
      const json = await res.json();

      if (!json.success) {
        setSyncNote(json.message || t('syncFailed'));
      } else if (json.data?.failures?.length) {
        setSyncNote(t('syncFailed'));
      } else if (!json.data?.daysWritten) {
        setSyncNote(t('syncEmpty'));
      } else {
        setSyncNote(t('syncDone'));
      }

      await load();
      onChanged?.();
    } catch {
      setSyncNote(t('syncFailed'));
    } finally {
      setSyncing(false);
    }
  };

  const setEnabled = async (id: string, enabled: boolean) => {
    setBusyId(id);
    try {
      await fetch('/api/business-os/channel-insights/connections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, insights_enabled: enabled }),
      });
      await load();
      onChanged?.();
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Disconnect one account and delete its history.
   *
   * Pausing was the only exit, which left the wrong Facebook Page listed on the
   * card forever — visible, unusable, and impossible to replace, since the
   * chooser only appears when a provider has an account the user hasn't picked
   * yet. Removing frees that slot.
   */
  const remove = async (row: ConnectionRow) => {
    setBusyId(row.id);
    setRemoveError(null);
    try {
      const res = await fetch('/api/business-os/channel-insights/connections', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: row.id,
          platform: row.platform,
          account_id: row.account_id,
        }),
      });
      const json = await res.json().catch(() => ({ success: false }));

      if (!json.success) {
        setRemoveError(t('removeFailed'));
        return;
      }

      setConfirmingId(null);
      await load();
      onChanged?.();
    } catch {
      setRemoveError(t('removeFailed'));
    } finally {
      setBusyId(null);
    }
  };

  if (connections === null) return null;

  const rowsFor = (platforms: string[]) =>
    connections.filter(c => platforms.includes(c.platform));

  return (
    <div
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        height: '100%',
        ...(embedded
          ? {}
          : {
              padding: '13px',
              borderRadius: '14px',
              background: '#FFFFFF',
              border: '1px solid #E7E9F1',
            }),
      }}
    >
      <div style={{ marginBottom: '2px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span
          style={{
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
            fontSize: '13.5px',
            fontWeight: 600,
            color: '#131A2B',
          }}
        >
          {t('title')}
        </span>
        {connections.length > 0 && (
          <button
            onClick={syncNow}
            disabled={syncing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '10.5px',
              fontWeight: 600,
              color: '#8A93A6',
              background: 'none',
              border: 'none',
              cursor: syncing ? 'default' : 'pointer',
              padding: 0,
            }}
          >
            <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? t('syncing') : t('syncNow')}
          </button>
        )}
      </div>
      <p style={{ fontSize: '11px', color: '#8A93A6', marginBottom: syncNote ? '4px' : '10px', lineHeight: 1.4 }}>
        {t('subtitle')}
      </p>
      {syncNote && (
        <p style={{ fontSize: '10.5px', color: '#4B5468', marginBottom: '10px', lineHeight: 1.4 }}>
          {syncNote}
        </p>
      )}

      {/* Three tiles across: a compact status row, not a settings list. Each is
          the whole control — press an unconnected one to connect it. */}
      <div className="grid grid-cols-3 gap-1.5">
        {PROVIDERS.map(({ provider, platforms, logos, short }) => {
          const rows = rowsFor(platforms);
          const connected = rows.length > 0;
          const isConnecting = connect.isBusy && connect.provider === provider;
          const label = short[language] || short.en;

          return (
            <button
              key={provider}
              onClick={() => connect.connect(provider)}
              disabled={isConnecting}
              title={connected ? rows.map(r => r.account_name).filter(Boolean).join(', ') : undefined}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                padding: '8px 4px',
                borderRadius: '10px',
                // Dashed and pale reads as "nothing here yet" before a word is
                // read; a connected tile is solid and settled.
                border: connected ? '1px solid #D5EEE2' : '1px dashed #CBD3E1',
                background: connected ? '#F7FCFA' : '#FBFCFE',
                cursor: isConnecting ? 'default' : 'pointer',
                transition: 'border-color 0.15s, background 0.15s',
              }}
              onMouseEnter={e => {
                if (isConnecting) return;
                e.currentTarget.style.borderColor = connected ? '#A9DCC4' : '#9AA7BE';
              }}
              onMouseLeave={e => {
                if (isConnecting) return;
                e.currentTarget.style.borderColor = connected ? '#D5EEE2' : '#CBD3E1';
              }}
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                  // Desaturated until connected, so the eye lands on the
                  // channels that are actually reporting.
                  filter: connected ? 'none' : 'grayscale(1)',
                  opacity: connected ? 1 : 0.5,
                }}
              >
                {logos.map(logo => (
                  <PluginIcon key={logo} pluginId={logo} className="w-4 h-4" alt="" />
                ))}
              </span>

              <span
                style={{
                  fontSize: '10.5px',
                  fontWeight: 500,
                  lineHeight: 1.2,
                  color: connected ? '#1F7A55' : '#6B7385',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '100%',
                }}
              >
                {label}
              </span>

              <span style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '13px' }}>
                {isConnecting ? (
                  <Loader2 className="w-3 h-3 animate-spin" style={{ color: '#8A93A6' }} />
                ) : connected ? (
                  <Check className="w-3 h-3" style={{ color: '#10B981', strokeWidth: 3.5 }} />
                ) : (
                  <span style={{ fontSize: '9.5px', fontWeight: 600, color: '#131A2B' }}>
                    {t('connect')}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Connected accounts, listed once beneath the tiles rather than inside
          them. Names like "בית הספר הבינלאומי להורות" need the full width, and
          this is also where the wrong Page gets switched off. */}
      {connections.length > 0 && (
        <div style={{ marginTop: '9px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {connections.map(row => (
            <div
              key={row.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                padding: '5px 8px',
                borderRadius: '7px',
                background: row.insights_enabled ? '#F4FBF8' : '#F7F8FB',
                border: `1px solid ${row.insights_enabled ? '#D5EEE2' : '#E7E9F1'}`,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                {PLATFORM_LOGOS[row.platform] && (
                  <PluginIcon
                    pluginId={PLATFORM_LOGOS[row.platform]}
                    className="w-3.5 h-3.5 shrink-0"
                    alt=""
                  />
                )}
                {row.needs_reconnect ? (
                  <AlertCircle className="w-3 h-3 shrink-0" style={{ color: '#FB923C' }} />
                ) : row.is_backfilling ? (
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" style={{ color: '#8A93A6' }} />
                ) : !row.insights_enabled ? (
                  <X className="w-3 h-3 shrink-0" style={{ color: '#8A93A6' }} />
                ) : null}
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: '11.5px',
                      lineHeight: 1.3,
                      color: row.insights_enabled ? '#131A2B' : '#8A93A6',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.account_name || row.platform}
                  </span>
                  <span style={{ display: 'block', fontSize: '9.5px', lineHeight: 1.3, color: '#8A93A6' }}>
                    {PLATFORM_LABELS[row.platform]?.[language] ||
                      PLATFORM_LABELS[row.platform]?.en ||
                      row.platform}
                    {row.is_backfilling && ` · ${t('backfilling')}`}
                    {!row.insights_enabled && ` · ${t('paused')}`}
                  </span>
                </span>
              </span>

              {/* The confirm takes the actions' place: at this width a second
                  row of buttons would push the account name out of view, and a
                  dialog over a card this small reads as heavier than the act. */}
              {confirmingId === row.id ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <button
                    onClick={() => remove(row)}
                    disabled={busyId === row.id}
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 700,
                      color: '#B4442E',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {busyId === row.id ? '…' : t('removeYes')}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmingId(null);
                      setRemoveError(null);
                    }}
                    disabled={busyId === row.id}
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 600,
                      color: '#8A93A6',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('removeCancel')}
                  </button>
                </span>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <button
                    onClick={() => setEnabled(row.id, !row.insights_enabled)}
                    disabled={busyId === row.id}
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 600,
                      color: row.insights_enabled ? '#8A93A6' : '#1F7A55',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {busyId === row.id ? '…' : row.insights_enabled ? t('pause') : t('resume')}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmingId(row.id);
                      setRemoveError(null);
                    }}
                    disabled={busyId === row.id}
                    style={{
                      fontSize: '10.5px',
                      fontWeight: 600,
                      color: '#B4442E',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('remove')}
                  </button>
                </span>
              )}
            </div>
          ))}

          {/* What "remove" costs, said before it is clicked — and what it does
              not touch, since the plugin stays connected for agents to use. */}
          {confirmingId && (
            <p style={{ fontSize: '10px', color: '#8A93A6', lineHeight: 1.4 }}>
              {t('removeConfirm')} {t('removeNote')}
            </p>
          )}

          {removeError && (
            <p style={{ fontSize: '10.5px', color: '#B4442E', lineHeight: 1.4 }}>{removeError}</p>
          )}
        </div>
      )}

      {/* A failed sync is named here rather than left as silent zeros. The raw
          provider message stays in the server logs; the card says what it means
          and what to do about it. */}
      {(() => {
        const failed = connections.find(c => c.last_sync_error);
        if (!failed?.last_sync_error) return null;

        return (
          <p style={{ marginTop: '6px', fontSize: '10.5px', color: '#B4442E', lineHeight: 1.4 }}>
            {isReconnectable(failed.last_sync_error) ? t('errorReconnect') : t('errorGeneric')}
          </p>
        );
      })()}

      {/* When the numbers arrive. Only once something is connected — before
          that the subtitle already explains what connecting is for. */}
      {connections.length > 0 && (
        <p style={{ marginTop: '6px', fontSize: '10px', color: '#8A93A6', lineHeight: 1.4 }}>
          {connections.some(c => c.is_backfilling) ? t('backfillNote') : t('cadence')}
        </p>
      )}

      {/* The multi-account chooser, when the provider returns more than one. */}
      {connect.phase === 'selecting' && connect.accounts.length > 0 && (
        <div style={{ marginTop: '9px', borderTop: '1px solid #E7E9F1', paddingTop: '9px' }}>
          <p style={{ fontSize: '11px', fontWeight: 600, color: '#131A2B', marginBottom: '6px' }}>
            {t('choose')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {connect.accounts.map(account => (
              <button
                key={account.id}
                onClick={() => connect.selectAccount(account.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                  padding: '6px 8px',
                  borderRadius: '8px',
                  border: '1px solid #E7E9F1',
                  background: '#FFFFFF',
                  cursor: 'pointer',
                  textAlign: isRTL ? 'right' : 'left',
                }}
              >
                {account.picture_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={account.picture_url} alt="" style={{ width: 22, height: 22, borderRadius: '99px' }} />
                ) : (
                  <span style={{ width: 22, height: 22, borderRadius: '99px', background: '#EDF0F7' }} />
                )}
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '11.5px', lineHeight: 1.3, color: '#131A2B' }}>
                    {account.name}
                  </span>
                  {account.detail && (
                    <span style={{ display: 'block', fontSize: '9.5px', lineHeight: 1.3, color: '#8A93A6' }}>
                      {account.detail}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Same shape as the sync failure above: a sentence the reader can act
          on, and the provider's own words one disclosure away for whoever has
          to fix it. Google's version of "this API is switched off" names a
          Cloud project number, which tells a business owner nothing except
          that something is broken and it might be their fault. */}
      {connect.phase === 'error' && connect.error && (
        <p style={{ marginTop: '8px', fontSize: '11px', color: '#B4442E', lineHeight: 1.4 }}>
          {connectErrorText(connect.error, connect.provider)}
        </p>
      )}
    </div>
  );
}
