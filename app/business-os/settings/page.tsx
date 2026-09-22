'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/UserProvider';
import { supabase } from '@/lib/supabaseClient';
import { signOutUser } from '@/lib/client/auth-actions';
import {
  ArrowLeft,
  Loader2,
  Globe,
  DollarSign,
  Clock,
  Lock,
  Bell,
  Download,
  Trash2,
  ChevronRight,
  ChevronDown,
  Check,
  Eye,
  EyeOff,
  Pencil,
  X,
  CheckCircle,
  AlertCircle,
  Settings,
  LogOut,
  MailCheck,
} from 'lucide-react';
import { LeadNotificationToggles } from '@/components/business-os/settings/LeadNotificationToggles';
import { MarketingConsentPanel } from '@/components/business-os/settings/MarketingConsentPanel';
import { ErasureRequestContent } from '@/components/business-os/purge/DangerZonePanel';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { useConfigurationDialog } from '@/components/business-os/ConfigurationDialogProvider';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'BusinessOSSettings' });

import AvatarUpload from '@/components/ui/AvatarUpload';
import { PAGE_CONTAINER } from '@/lib/business-os/pageContainer';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

function BusinessOSSettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { t, isRTL, language, setLanguage, currencyCode, setCurrency, availableCurrencies } = useLanguage();
  const { openConfiguration } = useConfigurationDialog();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Profile data
  const [profile, setProfile] = useState({
    full_name: '',
    avatar_url: '',
    job_title: '',
    timezone: '',
  });

  // Edit states
  const [editingProfile, setEditingProfile] = useState(false);

  // Expandable sections
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  // Password form
  const [passwordForm, setPasswordForm] = useState({
    current: '',
    new: '',
    confirm: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Delete account dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Dropdown state
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  // Load data
  useEffect(() => {
    if (user?.id) {
      loadData();
    }
  }, [user?.id]);

  /**
   * Open a section directly from a link, so landing here with everything
   * collapsed doesn't leave the reader hunting for the thing they just clicked.
   *
   * Waits for `loading` to clear. While it is true this page renders a spinner
   * instead of the sections, so an earlier version scrolled to an element that
   * did not exist yet and silently did nothing.
   *
   * Only the sections that exist are honoured; anything else is ignored rather
   * than opening a panel that isn't there.
   */
  useEffect(() => {
    if (loading) return;

    const requested = searchParams.get('section');

    /*
     * `?section=business` and `?section=invoice` are in the wild — dashboard
     * chips, briefing emails — and both now live in the configuration dialog.
     * Honour the link by opening the dialog rather than 404-ing the intent:
     * somebody followed it to reach that form, and it still exists.
     */
    if (requested === 'business' || requested === 'invoice') {
      openConfiguration(requested);
      return;
    }

    if (requested !== 'password' && requested !== 'preferences') return;

    setExpandedSection(requested);

    // After paint, so the section has rendered its expanded height and the
    // scroll lands on the open panel rather than where it used to be.
    const timer = setTimeout(() => {
      const target = document.getElementById(`settings-section-${requested}`);
      if (!target) return;

      // Offset by the sticky header, which would otherwise cover the section
      // heading the reader was sent here to find.
      const header = document.querySelector('.sticky');
      const headerHeight = header ? header.getBoundingClientRect().height : 0;
      const top = target.getBoundingClientRect().top + window.scrollY - headerHeight - 12;

      window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
    }, 100);

    return () => clearTimeout(timer);
  }, [searchParams, loading, openConfiguration]);

  const loadData = async () => {
    if (!user) return;

    try {
      setLoading(true);

      const [profileRes, prefsRes] = await Promise.all([
        supabase.from('profiles').select('full_name, avatar_url, job_title').eq('id', user.id).single(),
        supabase.from('user_preferences').select('timezone').eq('user_id', user.id).maybeSingle(),
      ]);

      /*
       * Not gated on the profile row.
       *
       * `.single()` returns nothing when no `profiles` row exists yet, and this
       * used to skip the whole assignment — including the timezone, which comes
       * from a different table entirely. An account with a saved zone and no
       * profile row showed an empty timezone picker, which reads as "never set"
       * and invites someone to set it again.
       */
      setProfile({
        full_name: profileRes.data?.full_name || '',
        avatar_url: profileRes.data?.avatar_url || '',
        job_title: profileRes.data?.job_title || '',
        timezone: prefsRes.data?.timezone || '',
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to load the account settings');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Store the business timezone, in both columns, and PROVE it landed.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The timezone used to be one field among several in a profile upsert, which
   * made three silent failures possible and two of them happened:
   *
   *   - the value was read from state that had not re-rendered yet, so the
   *     write carried the PREVIOUS zone, or none at all;
   *   - `supabase-js` returns `{ error }` rather than throwing, and nobody
   *     destructured it, so a rejected write still showed "saved";
   *   - `if (profile.timezone)` is false for an account that has never set one,
   *     which is exactly the account trying to set one. Nothing was written.
   *
   * So this takes the zone as an argument, writes each table explicitly, checks
   * each error, and READS THE VALUE BACK. A write that silently fails to take
   * is otherwise indistinguishable from success, and this one field governs
   * every time the platform displays.
   */
  const persistTimezone = async (zone: string): Promise<string | null> => {
    if (!user) return null;

    const stamp = new Date().toISOString();

    const { error: prefsError } = await supabase.from('user_preferences').upsert({
      user_id: user.id,
      timezone: zone,
      // Carried even though this save is about the timezone. Without it the
      // upsert CREATES the row, and `preferred_language` lands on its `en`
      // default — which server-side features read as a deliberate choice
      // and used to generate English insights for a Hebrew business.
      preferred_language: language,
      updated_at: stamp,
    }, { onConflict: 'user_id' });

    if (prefsError) {
      logger.error({ err: prefsError, userId: user.id, zone }, 'Failed to store the timezone');
      return null;
    }

    /*
     * A targeted UPDATE, not an upsert: the row exists, and naming the single
     * column cannot clobber a field this screen did not intend to write.
     */
    const { error: mirrorError } = await supabase
      .from('profiles')
      .update({ timezone: zone, updated_at: stamp })
      .eq('id', user.id);

    if (mirrorError) {
      logger.error({ err: mirrorError, userId: user.id, zone }, 'Failed to mirror the timezone onto the profile');
    }

    const { data: prefsRow } = await supabase
      .from('user_preferences').select('timezone').eq('user_id', user.id).maybeSingle();

    if (prefsRow?.timezone !== zone) {
      logger.error(
        { userId: user.id, zone, stored: prefsRow?.timezone },
        'The timezone did not persist: the write reported success but the stored value differs'
      );
      return null;
    }

    return zone;
  };

  const saveProfile = async (overrides?: Partial<typeof profile>) => {
    if (!user) return;

    // Passed in rather than read back out of state, so the save cannot depend
    // on whether React has re-rendered yet.
    const next = { ...profile, ...overrides };

    try {
      setSaving(true);
      setSuccessMessage('');
      setErrorMessage('');

      const { error: profileError } = await supabase.from('profiles').upsert({
        id: user.id,
        full_name: next.full_name,
        avatar_url: next.avatar_url,
        job_title: next.job_title,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

      if (profileError) {
        logger.error({ err: profileError, userId: user.id }, 'Failed to save the profile row');
        setErrorMessage(t('settings.profile.error'));
        return;
      }

      if (next.timezone) {
        const saved = await persistTimezone(next.timezone);
        if (!saved) {
          setErrorMessage(t('settings.profile.error'));
          return;
        }
      }

      setEditingProfile(false);
      setSuccessMessage(t('settings.profile.saved'));
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      logger.error({ err: error }, 'Failed to save the profile');
      setErrorMessage(t('settings.profile.error'));
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!passwordForm.current || !passwordForm.new) {
      setErrorMessage(t('settings.security.password_required'));
      return;
    }
    if (passwordForm.new !== passwordForm.confirm) {
      setErrorMessage(t('settings.security.password_mismatch'));
      return;
    }
    if (passwordForm.new.length < 8) {
      setErrorMessage(t('settings.security.password_short'));
      return;
    }

    try {
      setChangingPassword(true);
      setErrorMessage('');

      const { error } = await supabase.auth.updateUser({ password: passwordForm.new });
      if (error) throw error;

      setSuccessMessage(t('settings.security.password_updated'));
      setPasswordForm({ current: '', new: '', confirm: '' });
      setExpandedSection(null);
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      logger.error({ err: error }, 'Failed to change the password');
      setErrorMessage(t('settings.security.password_error'));
    } finally {
      setChangingPassword(false);
    }
  };

  const handleExportData = async () => {
    if (!user) return;

    try {
      setExporting(true);

      const [profileRes, prefsRes, connectionsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id),
        supabase.from('user_preferences').select('*').eq('user_id', user.id),
        supabase.from('plugin_connections').select('*').eq('user_id', user.id),
      ]);

      const userData = {
        user: { id: user.id, email: user.email },
        profile: profileRes.data?.[0] || null,
        preferences: prefsRes.data?.[0] || null,
        connections: connectionsRes.data || [],
      };

      const blob = new Blob([JSON.stringify(userData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `my-data-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);

      setSuccessMessage(t('settings.security.export_success'));
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (error) {
      logger.error({ err: error }, 'Failed to export the account data');
      setErrorMessage(t('settings.security.export_error'));
    } finally {
      setExporting(false);
    }
  };

  /**
   * Sign out, properly.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * Every `signOut` that existed in settings belonged to DELETE ACCOUNT — so
   * the only way to leave was to destroy the account or close the tab.
   *
   * Three things beyond `supabase.auth.signOut()`, which is why this is more
   * than a one-liner:
   *
   * 1. `scope: 'global'` ends the session on every device, not just this
   *    browser. Somebody signing out of a shared or lost machine means it.
   *
   * 2. Browser storage is cleared. The app keeps onboarding progress, the
   *    cached profile and the chosen language in localStorage keyed by nothing
   *    at all — so without this the NEXT person to sign in on this browser
   *    inherits the previous user's onboarding state and language. Theme is
   *    deliberately kept: it describes the device, not the person, and it
   *    identifies nobody.
   *
   * 3. `window.location.href`, not `router.push`. A client-side navigation
   *    keeps React state, provider caches and in-flight requests alive across
   *    what is supposed to be a boundary between two people. It also has to be
   *    a full page load here, because the destination is a DIFFERENT APP.
   *
   * Where it lands: the marketing site's `/login`. Signing back in is the one
   * thing someone is most likely to want next, and the form is not in this app
   * — it belongs to the marketing site, on its own origin.
   * ─────────────────────────────────────────────────────────────────────────
   */
  /**
   * Give a best-effort network call a deadline it cannot outlive.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * Both calls below were `await`ed inside a try/catch, which catches a
   * REJECTION and does nothing at all about a promise that simply never
   * settles. A stalled request therefore left `loggingOut` true forever — and
   * the dialog refuses to close while that is true — so a person who pressed
   * log out sat on a spinner with no cancel, no escape and no way back.
   *
   * Resolves rather than rejects on timeout: every caller here is best-effort,
   * and the only outcome that matters is that the browser ends up signed out
   * and somewhere else.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const withDeadline = async (work: Promise<unknown>, ms: number, what: string) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), ms);
    });

    try {
      const outcome = await Promise.race([work.then(() => 'done' as const), deadline]);
      if (outcome === 'timeout') {
        logger.warn({ what, ms }, 'Logout step exceeded its deadline; continuing without it');
      }
    } catch (err) {
      logger.warn({ err, what }, 'Logout step failed; continuing without it');
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  /**
   * Every key that holds a SESSION, whoever wrote it.
   *
   * The list below used to name `sb-auth-token` and `supabase.auth.token`, and
   * neither is what Supabase actually writes: the real key carries the project
   * ref (`sb-<ref>-auth-token`) and is chunked into `.0`, `.1`, … when the JWT
   * is large. So a sign-out that failed or timed out left the session sitting
   * in storage while the browser was sent to the login page — signed out in
   * appearance only, and signed straight back in on return.
   *
   * Matched by shape rather than by a literal, so this holds in every
   * environment and survives a project change.
   */
  const clearSessionKeys = (store: Storage) => {
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && /^sb-.*-auth-token/.test(key)) doomed.push(key);
    }
    doomed.forEach((key) => store.removeItem(key));
  };

  const handleLogout = async () => {
    setLoggingOut(true);

    /*
     * Points 1 and 2 above are `signOutUser`, shared with the other sign-out
     * controls in the app. The audit entry (written before the sign-out, while
     * there is still a session to attribute it to), the global scope and the
     * person-scoped storage clearing all live there now — the key list in
     * particular, because a second copy of it here drifts the moment a key is
     * added and silently starts leaking one person's state to the next.
     *
     * Nothing it does can trap someone in a session they asked to leave: a
     * failed audit write or a failed server sign-out is logged inside and the
     * local state is cleared regardless.
     */
    const result = await signOutUser({ scope: 'global', user, method: 'settings' });
    if (!result.ok) {
      logger.error({ err: result.error }, 'Global sign-out failed — cleared locally regardless');
    }

    /*
     * The marketing site is a separate application on its own origin —
     * `localhost:3001` beside this app's 3000 in development, the apex domain
     * in production while the app sits on `app.`.
     *
     * `NEXT_PUBLIC_MARKETING_URL` overrides both, for preview deployments where
     * neither guess is right. All three are inlined at build time, so this is a
     * plain string by the time it runs.
     */
    const marketingUrl =
      process.env.NEXT_PUBLIC_MARKETING_URL ||
      (process.env.NODE_ENV === 'development'
        ? 'http://localhost:3001'
        : 'https://agentspilot.com');

    window.location.href = `${marketingUrl}/login`;
  };

  /*
   * `handleDeleteAccount` removed — it POSTed to `/api/user/delete-account`,
   * which deleted `auth.users` and, for every onboarded user, failed partway
   * through and left a half-destroyed account. That route is now a 410
   * tombstone, so the handler is deleted rather than repointed: leaving it
   * would surface an error toast, which is the broken-delete experience
   * retiring the route was meant to end.
   *
   * The dialog below now shows the shared `ErasureRequestContent` until the
   * Business OS purge flow is un-gated (D9, NEXT_PUBLIC_ENABLE_BUSINESS_DELETE),
   * at which point the full dry-run → gate → typed-confirmation flow lands in
   * its place. The typed-confirmation input went with the handler: asking
   * someone to type DELETE and then not deleting anything would be theatre.
   */

  // Language options
  const languageOptions = [
    { code: 'en', label: 'English', flag: '🇺🇸' },
    { code: 'es', label: 'Español', flag: '🇪🇸' },
    { code: 'he', label: 'עברית', flag: '🇮🇱' },
  ];

  // Currency options
  const currencyOptions = Object.entries(availableCurrencies).map(([code, config]) => ({
    code,
    label: `${code} (${config.symbol})`,
  }));

  // Timezone options (simplified)
  const timezoneOptions = [
    { value: 'America/New_York', label: 'New York' },
    { value: 'America/Los_Angeles', label: 'Los Angeles' },
    { value: 'Europe/London', label: 'London' },
    { value: 'Europe/Paris', label: 'Paris' },
    { value: 'Asia/Tokyo', label: 'Tokyo' },
    { value: 'Asia/Jerusalem', label: 'Jerusalem' },
    { value: 'UTC', label: 'UTC' },
  ];

  const currentLanguage = languageOptions.find(l => l.code === language) || languageOptions[0];
  const currentCurrency = currencyOptions.find(c => c.code === currencyCode) || currencyOptions[0];
  const currentTimezone = timezoneOptions.find(tz => tz.value === profile.timezone);

  // Business dropdown options
  // Job title translations
  const jobTitleLabels: Record<string, string> = {
    software_engineer: t('settings.profile.job_titles.software_engineer'),
    product_manager: t('settings.profile.job_titles.product_manager'),
    designer: t('settings.profile.job_titles.designer'),
    founder: t('settings.profile.job_titles.founder'),
    manager: t('settings.profile.job_titles.manager'),
    ceo: t('settings.profile.job_titles.ceo'),
    freelancer: t('settings.profile.job_titles.freelancer'),
    other: t('settings.profile.job_titles.other'),
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--v2-bg)]" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center space-y-4">
            <div className="w-16 h-16 border-4 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: 'var(--v2-primary)', borderTopColor: 'transparent' }}></div>
            <p className="text-[var(--v2-text-secondary)] font-medium">{t('common.loading')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--v2-bg)]" dir={isRTL ? 'rtl' : 'ltr'}>

      {/* Main Content with max-width like CRM page */}
      <div className={`${PAGE_CONTAINER} py-6 sm:py-8 space-y-8`}>
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center bg-gradient-to-br from-[var(--v2-primary)]/20 to-[var(--v2-secondary)]/20 flex-shrink-0">
              <Settings className="w-5 h-5 sm:w-6 sm:h-6 text-[var(--v2-primary)]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-semibold text-[var(--v2-text-primary)] truncate">{t('settings.title')}</h1>
              <p className="text-xs sm:text-sm text-[var(--v2-text-secondary)] mt-1 hidden sm:block truncate">{t('settings.subtitle')}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Back to Dashboard */}
            <button
              onClick={() => router.push('/business-os')}
              className="p-1.5 sm:p-2 text-[var(--v2-text-secondary)] bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] hover:text-[var(--v2-text-primary)] transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={t('settings.back_to_dashboard')}
            >
              <ArrowLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4 rtl:rotate-180" />
            </button>
          </div>
        </div>

        {/* Messages */}
        {successMessage && (
          <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 flex items-center gap-2" style={{ borderRadius: 'var(--v2-radius-card)' }}>
            <CheckCircle className="w-4 h-4 text-green-600" />
            <p className="text-sm text-green-700 dark:text-green-400">{successMessage}</p>
          </div>
        )}
        {errorMessage && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center gap-2" style={{ borderRadius: 'var(--v2-radius-card)' }}>
            <AlertCircle className="w-4 h-4 text-red-600" />
            <p className="text-sm text-red-700 dark:text-red-400">{errorMessage}</p>
            <button onClick={() => setErrorMessage('')} className="ms-auto">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Two Column Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Profile & Preferences */}
          <div className="space-y-6">
            {/* Profile Card */}
        <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] p-5" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          {!editingProfile ? (
            <div className="flex items-center gap-4">
              <AvatarUpload
                currentAvatarUrl={profile.avatar_url}
                userName={profile.full_name}
                userEmail={user?.email}
                size="lg"
                onAvatarChange={(url) => setProfile(p => ({ ...p, avatar_url: url || '' }))}
              />
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-[var(--v2-text-primary)] truncate">
                  {profile.full_name || user?.email}
                </h2>
                <p className="text-sm text-[var(--v2-text-secondary)] truncate">
                  {user?.email}
                </p>
                {profile.job_title && (
                  <p className="text-sm text-[var(--v2-text-muted)] mt-0.5">
                    {jobTitleLabels[profile.job_title] || profile.job_title}
                  </p>
                )}
              </div>
              <button
                onClick={() => setEditingProfile(true)}
                className="p-2 text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-colors"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Pencil className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <AvatarUpload
                  currentAvatarUrl={profile.avatar_url}
                  userName={profile.full_name}
                  userEmail={user?.email}
                  size="lg"
                  onAvatarChange={(url) => setProfile(p => ({ ...p, avatar_url: url || '' }))}
                />
                <div className="flex-1">
                  <input
                    type="text"
                    value={profile.full_name}
                    onChange={(e) => setProfile(p => ({ ...p, full_name: e.target.value }))}
                    placeholder={t('settings.profile.full_name_placeholder')}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setEditingProfile(false)}
                  className="px-4 py-2 text-sm text-[var(--v2-text-secondary)] hover:bg-[var(--v2-bg)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  // Wrapped, not passed directly: React hands a click event to
                  // the handler, and `saveProfile` would take it as overrides.
                  onClick={() => saveProfile()}
                  disabled={saving}
                  className="px-4 py-2 text-sm bg-[var(--v2-primary)] text-white font-medium disabled:opacity-50"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('common.save')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Preferences */}
        <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] divide-y divide-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          {/* Language */}
          <div className="relative">
            <button
              onClick={() => setOpenDropdown(openDropdown === 'language' ? null : 'language')}
              className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <Globe className="w-5 h-5 text-[var(--v2-text-muted)]" />
                <span className="text-sm text-[var(--v2-text-primary)]">{t('settings.profile.language')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--v2-text-secondary)]">{currentLanguage.flag} {currentLanguage.label}</span>
                <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'language' ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {openDropdown === 'language' && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
                <div className="absolute z-50 top-full left-0 right-0 mt-1 mx-4 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                  {languageOptions.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => { setLanguage(lang.code as 'en' | 'es' | 'he'); setOpenDropdown(null); }}
                      className={`w-full px-4 py-3 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${language === lang.code ? 'bg-[var(--v2-bg)]' : ''}`}
                    >
                      <span>{lang.flag} {lang.label}</span>
                      {language === lang.code && <Check className="w-4 h-4 text-[var(--v2-primary)]" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Currency */}
          <div className="relative">
            <button
              onClick={() => setOpenDropdown(openDropdown === 'currency' ? null : 'currency')}
              className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <DollarSign className="w-5 h-5 text-[var(--v2-text-muted)]" />
                <span className="text-sm text-[var(--v2-text-primary)]">{t('settings.profile.currency')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--v2-text-secondary)]">{currentCurrency.label}</span>
                <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'currency' ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {openDropdown === 'currency' && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
                <div className="absolute z-50 top-full left-0 right-0 mt-1 mx-4 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                  {currencyOptions.map((curr) => (
                    <button
                      key={curr.code}
                      onClick={() => { setCurrency(curr.code as 'USD' | 'EUR' | 'ILS' | 'GBP'); setOpenDropdown(null); }}
                      className={`w-full px-4 py-3 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${currencyCode === curr.code ? 'bg-[var(--v2-bg)]' : ''}`}
                    >
                      <span>{curr.label}</span>
                      {currencyCode === curr.code && <Check className="w-4 h-4 text-[var(--v2-primary)]" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Timezone */}
          <div className="relative">
            <button
              onClick={() => setOpenDropdown(openDropdown === 'timezone' ? null : 'timezone')}
              className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-[var(--v2-text-muted)]" />
                <span className="text-sm text-[var(--v2-text-primary)]">{t('settings.profile.timezone')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--v2-text-secondary)]">{currentTimezone?.label || t('settings.profile.timezone_placeholder')}</span>
                <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${openDropdown === 'timezone' ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {openDropdown === 'timezone' && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
                <div className="absolute z-50 top-full left-0 right-0 mt-1 mx-4 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg max-h-48 overflow-y-auto" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                  {timezoneOptions.map((tz) => (
                    <button
                      key={tz.value}
                      onClick={() => { setProfile(p => ({ ...p, timezone: tz.value })); setOpenDropdown(null); saveProfile({ timezone: tz.value }); }}
                      className={`w-full px-4 py-3 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${profile.timezone === tz.value ? 'bg-[var(--v2-bg)]' : ''}`}
                    >
                      <span>{tz.label}</span>
                      {profile.timezone === tz.value && <Check className="w-4 h-4 text-[var(--v2-primary)]" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
          </div>

          {/* Right Column - Business & Account */}
          <div className="space-y-6">
        {/* Account Actions */}
        <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] divide-y divide-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          {/*
            How this business hears about a new enquiry.
            
            Here rather than on the dashboard card, because the card renders
            only when somebody is waiting — and a business with no open
            enquiries could otherwise never reach the switch that decides what
            happens to the next one.
          */}
          <div id="settings-section-preferences">
            <button
              onClick={() => setExpandedSection(expandedSection === 'preferences' ? null : 'preferences')}
              className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <Bell className="w-5 h-5 text-[var(--v2-text-muted)]" />
                <span className="text-sm text-[var(--v2-text-primary)]">{t('leads.settings_title')}</span>
              </div>
              <ChevronRight className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${expandedSection === 'preferences' ? 'rotate-90' : ''}`} />
            </button>
            {expandedSection === 'preferences' && (
              <div className="px-4 pb-4 space-y-4">
                <LeadNotificationToggles />
              </div>
            )}
          </div>

          {/* Marketing consent */}
          <div id="settings-section-consent">
            <button
              onClick={() => setExpandedSection(expandedSection === 'consent' ? null : 'consent')}
              className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <MailCheck className="w-5 h-5 text-[var(--v2-text-muted)]" />
                <span className="text-sm text-[var(--v2-text-primary)]">Marketing permission</span>
              </div>
              <ChevronRight className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${expandedSection === 'consent' ? 'rotate-90' : ''}`} />
            </button>
            {expandedSection === 'consent' && (
              <div className="px-4 pb-4">
                <MarketingConsentPanel />
              </div>
            )}
          </div>

          {/* Change Password */}
          <div>
            <button
              onClick={() => setExpandedSection(expandedSection === 'password' ? null : 'password')}
              className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <Lock className="w-5 h-5 text-[var(--v2-text-muted)]" />
                <span className="text-sm text-[var(--v2-text-primary)]">{t('settings.security.change_password')}</span>
              </div>
              <ChevronRight className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${expandedSection === 'password' ? 'rotate-90' : ''}`} />
            </button>
            {expandedSection === 'password' && (
              <div className="px-4 pb-4 space-y-3">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={passwordForm.current}
                  onChange={(e) => setPasswordForm(p => ({ ...p, current: e.target.value }))}
                  placeholder={t('settings.security.current_password')}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={passwordForm.new}
                  onChange={(e) => setPasswordForm(p => ({ ...p, new: e.target.value }))}
                  placeholder={t('settings.security.new_password')}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />
                <input
                  type="password"
                  value={passwordForm.confirm}
                  onChange={(e) => setPasswordForm(p => ({ ...p, confirm: e.target.value }))}
                  placeholder={t('settings.security.confirm_password')}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-xs text-[var(--v2-text-secondary)] flex items-center gap-1"
                  >
                    {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    {showPassword ? t('common.hide') : t('common.show')}
                  </button>
                  <button
                    onClick={handlePasswordChange}
                    disabled={changingPassword}
                    className="px-4 py-2 text-sm bg-[var(--v2-primary)] text-white font-medium disabled:opacity-50"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {changingPassword ? <Loader2 className="w-4 h-4 animate-spin" /> : t('settings.security.update_password')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Export Data */}
          <button
            onClick={handleExportData}
            disabled={exporting}
            className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors disabled:opacity-50"
          >
            <div className="flex items-center gap-3">
              <Download className="w-5 h-5 text-[var(--v2-text-muted)]" />
              <span className="text-sm text-[var(--v2-text-primary)]">{t('settings.security.export_data')}</span>
            </div>
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4 text-[var(--v2-text-muted)]" />}
          </button>

          {/* Log out.
              Between "export my data" and "destroy my account": the last
              ordinary thing you can do here, before the one that cannot be
              undone. */}
          <button
            onClick={() => setShowLogoutDialog(true)}
            disabled={loggingOut}
            className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors disabled:opacity-50"
          >
            <div className="flex items-center gap-3">
              <LogOut className="w-5 h-5 text-[var(--v2-text-muted)]" />
              <span className="text-sm text-[var(--v2-text-primary)]">
                {t('settings.security.logout')}
              </span>
            </div>
            {loggingOut ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ChevronRight className="w-4 h-4 text-[var(--v2-text-muted)]" />
            )}
          </button>

          {/* Delete Account */}
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="w-full flex items-center justify-between p-4 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Trash2 className="w-5 h-5 text-red-500" />
              <span className="text-sm text-red-600 dark:text-red-400">{t('settings.security.delete_account')}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-red-400" />
          </button>
            </div>
          </div>
        </div>
      </div>

      {/*
        Log-out confirmation.
        ─────────────────────────────────────────────────────────────────────
        A plain log-out would not deserve a dialog. This one ends the session
        on EVERY device, so it says that in words — being signed out of your
        phone by a tap on your laptop is a surprise nobody should get silently.
      */}
      <Dialog open={showLogoutDialog} onOpenChange={(open) => !loggingOut && setShowLogoutDialog(open)}>
        <DialogContent className="sm:max-w-md" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LogOut className="w-5 h-5 text-[var(--v2-text-muted)]" />
              {t('settings.security.logout')}
            </DialogTitle>
          </DialogHeader>

          <div className="py-4">
            <p className="text-sm text-[var(--v2-text-secondary)]">
              {t('settings.security.logout_confirm')}
            </p>
          </div>

          <div className={`flex gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
            <button
              type="button"
              onClick={() => setShowLogoutDialog(false)}
              disabled={loggingOut}
              className="px-5 py-2.5 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all disabled:opacity-50"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {t('common.cancel') || 'Cancel'}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[var(--v2-primary)] hover:opacity-90 transition-all disabled:opacity-50"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {loggingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
              {t('settings.security.logout')}
            </button>
          </div>
        </DialogContent>
      </Dialog>


      {/* Delete Account Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={(open) => {
        setShowDeleteDialog(open);
        if (!open) {
          setErrorMessage('');
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Trash2 className="w-5 h-5" />
              {t('settings.security.delete_dialog_title')}
            </DialogTitle>
            <DialogDescription className="pt-2">
              {t('settings.security.erasure_request_title')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Warning Box */}
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800" style={{ borderRadius: 'var(--v2-radius-button)' }}>
              <p className="text-sm text-red-700 dark:text-red-400 font-medium">
                {t('settings.security.delete_warning')}
              </p>
            </div>

            {/*
              Shared with /v2/settings — one copy of the copy, and one place the
              erasure contact address lives. See components/business-os/purge/
              DangerZonePanel.tsx.
            */}
            <ErasureRequestContent />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <button
              onClick={() => setShowDeleteDialog(false)}
              className="px-4 py-2 text-sm text-[var(--v2-text-secondary)] hover:bg-[var(--v2-bg)] transition-colors"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {t('common.close')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function BusinessOSSettingsPage() {
  return (
    <Suspense fallback={null}>
      <BusinessOSSettingsContent />
    </Suspense>
  );
}
