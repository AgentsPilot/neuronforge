'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, X, AlertCircle, RefreshCw, Globe, Link2, FileText, MoreHorizontal } from 'lucide-react';
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
  /** Nothing has synced for a while. A fact, not a fault — see the API note. */
  is_stale?: boolean;
  last_synced_at?: string | null;
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

  /*
   * The channels a business owns before it connects anything.
   *
   * This card listed three OAuth providers and called itself "Your channels",
   * so a business with no social accounts opened it to three buttons and no
   * content — while its website and its smart links were the things actually
   * bringing people in. They are channels; they were simply never listed.
   */
  surfaceWebsite: { en: 'Website', es: 'Sitio web', he: 'אתר' },
  surfaceSmartLinks: { en: 'Smart links', es: 'Enlaces inteligentes', he: 'לינקים חכמים' },
  surfaceLanding: { en: 'Landing pages', es: 'Páginas de destino', he: 'דפי נחיתה' },
  createLanding: { en: 'Create', es: 'Crear', he: 'צור' },
  draftWaiting: {
    en: 'Written but not published yet',
    es: 'Escrita pero aún sin publicar',
    he: 'נכתב אבל עדיין לא פורסם',
  },
  published: { en: 'Published', es: 'Publicado', he: 'פורסם' },
  smartLinksActive: { en: 'Active', es: 'Activos', he: 'פעילים' },
  publishWebsite: { en: 'Publish', es: 'Publicar', he: 'פרסם' },
  createSmartLink: { en: 'Create', es: 'Crear', he: 'צור' },

  /** The summary line that replaced the subtitle once something is live. */
  activeCount: { en: 'active', es: 'activos', he: 'פעילים' },
  addableCount: { en: 'can be added', es: 'para añadir', he: 'אפשר להוסיף' },
  addTitle: { en: 'Add a channel', es: 'Añadir un canal', he: 'אפשר להוסיף' },
  reconnect: { en: 'Reconnect', es: 'Reconectar', he: 'התחבר מחדש' },
  manage: { en: 'Manage', es: 'Gestionar', he: 'ניהול' },
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

/** Which OAuth flow reconnects a given platform. Instagram's lives behind Meta. */
function providerOf(platform: string): ChannelProvider {
  return (
    PROVIDERS.find(p => p.platforms.includes(platform))?.provider ?? 'meta'
  );
}

const PLATFORM_LABELS: Record<string, Record<string, string>> = {
  facebook_page: { en: 'Facebook', es: 'Facebook', he: 'פייסבוק' },
  instagram: { en: 'Instagram', es: 'Instagram', he: 'אינסטגרם' },
  ga4: { en: 'Google Analytics', es: 'Google Analytics', he: 'גוגל אנליטיקס' },
  google_business_profile: { en: 'Google listing', es: 'Ficha de Google', he: 'רישום בגוגל' },
};

/**
 * Tint per platform, for the mark behind its logo.
 *
 * A wash of the brand at 12%, never the brand at full strength: the tile has to
 * sit quietly in a list of six, and a saturated Facebook blue beside a
 * saturated Instagram pink turns a settings panel into a toy. Identity comes
 * from the logo; the tint only says which family it belongs to.
 */
const PLATFORM_TINTS: Record<string, string> = {
  facebook_page: '#1877F2',
  instagram: '#E4405F',
  ga4: '#E8710A',
  google_business_profile: '#4285F4',
};

/** A 26px rounded tile holding one logo or status glyph. */
function Mark({ tint, children }: { tint?: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        width: 26,
        height: 26,
        borderRadius: 8,
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        background: tint ? `${tint}1F` : '#F1F3F8',
      }}
    >
      {children}
    </span>
  );
}

export function ChannelsCard({
  onChanged,
  embedded = false,
  owned,
  onAction,
  onReady,
}: {
  onChanged?: () => void;
  /** Drop the card chrome when this sits inside a shared card. */
  embedded?: boolean;
  /**
   * The surfaces the business owns, which are channels whether or not anything
   * is connected. Both flags come from `/api/business-os/stats` and are already
   * on the dashboard — no query was added to show them here.
   *
   * Counts, not booleans, and that distinction was a bug: `has_live_pages` is
   * true for a website OR a landing page, so a business whose only live page
   * was a landing page got a row labelled "Website" — naming a thing it does
   * not have while hiding the thing it does.
   *
   * Omitted rather than zeroed: "we were not told" and "there is none" are
   * different, and only the second one prints a Publish button.
   */
  owned?: {
    website: number;
    landing: number;
    smartLinks: number;
    websiteDrafts: number;
    landingDrafts: number;
  };
  /** Publish a site, create a link — the dashboard owns what those do. */
  onAction?: (action: string) => void;
  /**
   * Fired once the connections have loaded and this column has something to
   * draw.
   *
   * The card renders nothing at all while it is fetching, and the parent lays
   * out two columns from the first paint — so the half holding this one sat
   * empty and bordered, squeezing the sources column beside it, until the
   * request came back. The parent waits for this before splitting.
   */
  onReady?: () => void;
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
  // Which row has its settings open. Pause and Remove are used once per account
  // and were sitting at the same weight as "connect"; behind a menu they stop
  // competing with the actions a reader actually came for.
  const [menuId, setMenuId] = useState<string | null>(null);
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

  /*
   * Told once, when there is something to show.
   *
   * Through a ref because the parent passes an inline arrow: as a dependency it
   * would be a new function on every render and announce readiness on each one.
   * `loaded` is a boolean, so this fires on the single transition.
   */
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const loaded = connections !== null;
  useEffect(() => {
    if (loaded) onReadyRef.current?.();
  }, [loaded]);

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

  /**
   * What is live, and what could be added — the panel's whole structure.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The card used to lead with three provider tiles, so its height was set by
   * how many integrations EXIST rather than by how many this business has. A
   * business with nothing connected saw three buttons and no content; a
   * business with everything connected saw the tiles, then an account list,
   * then a confirm, then a sync error, then a cadence note — five stacked
   * states in a column this narrow.
   *
   * Now only live channels get a row. Everything else is one chip strip at the
   * foot, so the panel grows with the business instead of starting full.
   *
   * A CONNECTED PROVIDER IS NOT ONE ROW. Connecting Meta selects a Facebook
   * Page and an Instagram account, and each is listed separately with its own
   * name — that is deliberate and load-bearing: discovering that the wrong Page
   * was being monitored, with no way to see which, is the failure this card was
   * built to prevent. The provider's chip disappears once ANY of its platforms
   * is connected, so nothing offers to connect what is already connected.
   * ───────────────────────────────────────────────────────────────────────────
   */
  type LiveRow = {
    id: string;
    icon: React.ReactNode;
    name: string;
    meta: string;
    /** `alert` sorts to the top and is the only state allowed to be loud. */
    state: 'live' | 'alert' | 'paused';
    connection?: ConnectionRow;
    action?: { label: string; run: () => void };
  };

  const liveRows: LiveRow[] = [];

  // Owned surfaces first: they are live without anyone connecting anything, and
  // on a new account they are the only thing this panel can truthfully show.
  if (owned && owned.website > 0) {
    liveRows.push({
      id: 'owned:website',
      icon: <Mark tint="#0F8F60"><Globe className="w-[15px] h-[15px]" style={{ color: '#0F8F60' }} /></Mark>,
      name: t('surfaceWebsite'),
      meta: t('published'),
      state: 'live',
    });
  }
  if (owned && owned.landing > 0) {
    liveRows.push({
      id: 'owned:landing',
      icon: <Mark tint="#2563EB"><FileText className="w-[15px] h-[15px]" style={{ color: '#2563EB' }} /></Mark>,
      name: t('surfaceLanding'),
      // The count IS the fact here: one landing page and nine are different
      // businesses, and the panel has no other place to say which.
      meta: `${owned.landing} ${t('published').toLowerCase()}`,
      state: 'live',
    });
  }
  if (owned && owned.smartLinks > 0) {
    liveRows.push({
      id: 'owned:smart-links',
      icon: <Mark tint="#7C5CD6"><Link2 className="w-[15px] h-[15px]" style={{ color: '#7C5CD6' }} /></Mark>,
      name: t('surfaceSmartLinks'),
      meta: `${owned.smartLinks} ${t('smartLinksActive').toLowerCase()}`,
      state: 'live',
    });
  }

  for (const row of connections) {
    /*
     * A connected account is CONNECTED. That is the first thing the row says.
     *
     * This regressed the moment the row's state was driven by sync health: two
     * healthy accounts, connected and enabled, rendered as "we lost access to
     * this account — reconnect" because a nightly job had not run for a week.
     * The card that replaced them had shown a green tick regardless, and it was
     * right to.
     *
     * Only the platform actually refusing us is an alert. Everything else —
     * quiet for days, still fetching history — is a note beside the account
     * name, never instead of it: the name is how you catch the wrong Facebook
     * Page being read, which is what this card exists for.
     */
    const broken = row.needs_reconnect;
    const identity = row.account_name || row.platform;
    const aside = row.is_backfilling
      ? t('backfilling')
      : !row.insights_enabled
        ? t('paused')
        : null;

    liveRows.push({
      id: row.id,
      icon: PLATFORM_LOGOS[row.platform] ? (
        <Mark tint={PLATFORM_TINTS[row.platform]}>
          <PluginIcon pluginId={PLATFORM_LOGOS[row.platform]} className="w-[15px] h-[15px]" alt="" />
        </Mark>
      ) : null,
      name:
        PLATFORM_LABELS[row.platform]?.[language] ||
        PLATFORM_LABELS[row.platform]?.en ||
        row.platform,
      meta: broken
        ? `${identity} · ${isReconnectable(row.last_sync_error ?? '') ? t('errorReconnect') : t('errorGeneric')}`
        : aside
          ? `${identity} · ${aside}`
          : identity,
      state: broken ? 'alert' : row.insights_enabled ? 'live' : 'paused',
      connection: row,
    });
  }

  // Whatever needs the reader now goes first. That is the whole of option B's
  // idea, without a heading of its own — one row at the top rather than a
  // third group that is empty most days.
  liveRows.sort((a, b) => (a.state === 'alert' ? 0 : 1) - (b.state === 'alert' ? 0 : 1));

  /** One chip per thing that could exist and does not. */
  const addable: {
    key: string;
    logos: string[];
    icon?: React.ReactNode;
    label: string;
    /** The full name, for the chip's tooltip — "Facebook" is really both. */
    title?: string;
    run: () => void;
  }[] = [];

  /*
   * Written but not published is not the same as not written.
   *
   * Offering "create a landing page" to a business that already wrote one and
   * left it in draft is the platform failing to look at what it has. The chip
   * says PUBLISH instead, and either way it goes to the builder — publishing is
   * a decision about content, and it belongs on the page that shows the content.
   */
  if (owned && owned.website === 0) {
    const hasDraft = owned.websiteDrafts > 0;
    addable.push({
      key: 'website',
      logos: [],
      icon: <Globe className="w-3.5 h-3.5" style={{ color: '#8A93A6' }} />,
      label: `${t('surfaceWebsite')} · ${hasDraft ? t('publishWebsite') : t('createLanding')}`,
      title: hasDraft ? t('draftWaiting') : undefined,
      run: () => onAction?.(hasDraft ? 'publish_website' : 'open_website'),
    });
  }
  if (owned && owned.landing === 0) {
    const hasDraft = owned.landingDrafts > 0;
    addable.push({
      key: 'landing',
      logos: [],
      icon: <FileText className="w-3.5 h-3.5" style={{ color: '#8A93A6' }} />,
      label: `${t('surfaceLanding')} · ${hasDraft ? t('publishWebsite') : t('createLanding')}`,
      title: hasDraft ? t('draftWaiting') : undefined,
      // Always the builder, never a direct publish: a landing page is one of
      // several, and the panel does not know which draft was meant.
      run: () => onAction?.('open_website'),
    });
  }
  if (owned && owned.smartLinks === 0) {
    addable.push({
      key: 'smart-links',
      logos: [],
      icon: <Link2 className="w-3.5 h-3.5" style={{ color: '#8A93A6' }} />,
      label: `${t('surfaceSmartLinks')} · ${t('createSmartLink')}`,
      run: () => onAction?.('create_booking_link'),
    });
  }
  for (const { provider, platforms, logos, short, labels } of PROVIDERS) {
    if (rowsFor(platforms).length > 0) continue;
    addable.push({
      key: provider,
      logos,
      label: short[language] || short.en,
      title: labels[language] || labels.en,
      run: () => connect.connect(provider),
    });
  }

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
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
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

      {/* A count where the instruction used to be. "Connect an account to see
          how many people it reaches" was the right sentence when the card had
          nothing else to say; with live rows beneath it, it was telling a
          business to do something it had already done. */}
      {liveRows.length > 0 ? (
        <p style={{ fontSize: '11px', color: '#8A93A6', margin: '3px 0 10px', lineHeight: 1.4 }}>
          <b style={{ color: '#212838', fontWeight: 600 }}>{liveRows.length}</b> {t('activeCount')}
          {addable.length > 0 && (
            <>
              {' · '}
              <b style={{ color: '#212838', fontWeight: 600 }}>{addable.length}</b> {t('addableCount')}
            </>
          )}
        </p>
      ) : (
        <p style={{ fontSize: '11px', color: '#8A93A6', margin: '3px 0 10px', lineHeight: 1.4 }}>
          {t('subtitle')}
        </p>
      )}

      {liveRows.map(row => {
        const busy = row.connection ? busyId === row.connection.id : false;
        const confirming = row.connection ? confirmingId === row.connection.id : false;
        const open = menuId === row.id;

        return (
          <div key={row.id}>
            <div
              className="group"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '9px',
                padding: '7px 8px',
                borderRadius: '10px',
                background: row.state === 'alert' ? '#FEF9F1' : 'transparent',
              }}
            >
              <span style={{ flexShrink: 0, display: 'flex' }}>
                {row.state === 'alert' ? (
                  <Mark tint="#D97706"><AlertCircle className="w-[15px] h-[15px]" style={{ color: '#B45309' }} /></Mark>
                ) : row.connection?.is_backfilling ? (
                  <Mark tint="#8A93A6"><Loader2 className="w-[15px] h-[15px] animate-spin" style={{ color: '#6B7285' }} /></Mark>
                ) : row.state === 'paused' ? (
                  <Mark tint="#8A93A6"><X className="w-[15px] h-[15px]" style={{ color: '#8A93A6' }} /></Mark>
                ) : (
                  row.icon
                )}
              </span>

              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '12px',
                    fontWeight: 500,
                    lineHeight: 1.25,
                    color: row.state === 'paused' ? '#8A93A6' : '#212838',
                  }}
                >
                  {row.state === 'live' && (
                    <i
                      aria-hidden
                      style={{ width: 6, height: 6, borderRadius: '99px', background: '#12A66F', flexShrink: 0 }}
                    />
                  )}
                  {row.name}
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: '10.5px',
                    lineHeight: 1.35,
                    marginTop: '1px',
                    color: row.state === 'alert' ? '#A9700F' : '#8A93A6',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.meta}
                </span>
              </span>

              {/* Reconnecting is the one action urgent enough to stay on the
                  row. Pause and Remove are settings used once and go behind the
                  menu, where they no longer compete with it. */}
              {row.state === 'alert' && row.connection && (
                <button
                  onClick={() => connect.connect(providerOf(row.connection!.platform))}
                  style={{
                    flexShrink: 0,
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#FFFFFF',
                    background: '#B45309',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '4px 10px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t('reconnect')}
                </button>
              )}

              {row.connection && (
                <button
                  onClick={() => {
                    setMenuId(open ? null : row.id);
                    setConfirmingId(null);
                    setRemoveError(null);
                  }}
                  aria-label={t('manage')}
                  aria-expanded={open}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                  style={{
                    flexShrink: 0,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '2px',
                    color: '#A2A9B8',
                    opacity: open ? 1 : undefined,
                    transition: 'opacity 140ms ease',
                  }}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* The menu, and the confirm inside it. Both stay inline: a dialog
                over a column this narrow reads as heavier than the act. */}
            {open && row.connection && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '4px 8px 8px',
                  fontSize: '10.5px',
                }}
              >
                {confirming ? (
                  <>
                    <button
                      onClick={() => remove(row.connection!)}
                      disabled={busy}
                      style={{ fontWeight: 700, color: '#B4442E', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      {busy ? '…' : t('removeYes')}
                    </button>
                    <button
                      onClick={() => { setConfirmingId(null); setRemoveError(null); }}
                      disabled={busy}
                      style={{ fontWeight: 600, color: '#8A93A6', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      {t('removeCancel')}
                    </button>
                    <span style={{ color: '#8A93A6', lineHeight: 1.4 }}>{t('removeNote')}</span>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setEnabled(row.connection!.id, !row.connection!.insights_enabled)}
                      disabled={busy}
                      style={{
                        fontWeight: 600,
                        color: row.connection.insights_enabled ? '#8A93A6' : '#1F7A55',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      {busy ? '…' : row.connection.insights_enabled ? t('pause') : t('resume')}
                    </button>
                    <button
                      onClick={() => setConfirmingId(row.connection!.id)}
                      disabled={busy}
                      style={{ fontWeight: 600, color: '#B4442E', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      {t('remove')}
                    </button>
                  </>
                )}
              </div>
            )}

            {removeError && confirming && (
              <p style={{ padding: '0 8px 6px', fontSize: '10.5px', color: '#B4442E', lineHeight: 1.4 }}>
                {removeError}
              </p>
            )}
          </div>
        );
      })}

      {/* Everything not yet live, as chips. The catalogue no longer sets the
          panel's height — it costs one wrapped strip however many integrations
          the platform grows to. */}
      {addable.length > 0 && (
        <div
          style={{
            marginTop: liveRows.length > 0 ? '10px' : 0,
            paddingTop: liveRows.length > 0 ? '9px' : 0,
            borderTop: liveRows.length > 0 ? '1px solid #F1F3F8' : 'none',
          }}
        >
          <p
            style={{
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '0.07em',
              textTransform: 'uppercase',
              color: '#A2A9B8',
              marginBottom: '6px',
            }}
          >
            {t('addTitle')}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {addable.map(item => {
              const isConnecting = connect.isBusy && connect.provider === item.key;

              return (
                <button
                  key={item.key}
                  onClick={item.run}
                  disabled={isConnecting}
                  title={item.title}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    border: '1px solid #DDE3ED',
                    borderRadius: '99px',
                    padding: '4px 10px',
                    fontSize: '11px',
                    color: '#4A5165',
                    background: '#FFFFFF',
                    cursor: isConnecting ? 'default' : 'pointer',
                    transition: 'border-color 0.15s, color 0.15s',
                  }}
                  onMouseEnter={e => {
                    if (isConnecting) return;
                    e.currentTarget.style.borderColor = '#9EC0FA';
                    e.currentTarget.style.color = '#2563EB';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = '#DDE3ED';
                    e.currentTarget.style.color = '#4A5165';
                  }}
                >
                  {isConnecting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : item.icon ? (
                    item.icon
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                      {item.logos.map(logo => (
                        <PluginIcon key={logo} pluginId={logo} className="w-3.5 h-3.5" alt="" />
                      ))}
                    </span>
                  )}
                  {item.label}
                  <span style={{ color: '#9AA1B0', fontWeight: 700 }} aria-hidden>+</span>
                </button>
              );
            })}
          </div>
        </div>
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

      {connect.phase === 'error' && connect.error && (
        <p style={{ marginTop: '8px', fontSize: '11px', color: '#B4442E', lineHeight: 1.4 }}>
          {connectErrorText(connect.error, connect.provider)}
        </p>
      )}

      {/* One muted footer line where three paragraphs used to be: when the
          numbers refresh, and how the last manual refresh went. */}
      {(connections.length > 0 || syncNote) && (
        <p
          style={{
            marginTop: '10px',
            paddingTop: '8px',
            borderTop: '1px solid #F1F3F8',
            fontSize: '10px',
            color: '#A2A9B8',
            lineHeight: 1.4,
          }}
        >
          {connections.some(c => c.is_backfilling) ? t('backfillNote') : t('cadence')}
          {syncNote && ` · ${syncNote}`}
        </p>
      )}
    </div>
  );
}
