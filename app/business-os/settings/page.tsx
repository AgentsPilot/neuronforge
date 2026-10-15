'use client';

import React, { useState, useEffect, useMemo, useRef, Suspense } from 'react';
// No router here: the only address change this page makes (taking `section` off
// when a link-opened drawer closes, C-3) lives in `useLinkOpenedDrawer`, and it
// replaces, never pushes.
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/UserProvider';
import {
  usesOAuthSignIn,
  hasBothSignInMethods,
  linkedOAuthLabel,
  linkedProviderAccountUrl,
} from '@/lib/authIdentities';
import { supabase } from '@/lib/supabaseClient';
import { downloadUserDataExport } from '@/lib/client/downloadUserDataExport';
import { signOutUser } from '@/lib/client/auth-actions';
import { marketingLogoutUrl } from '@/lib/utils/marketingUrl';
import {
  Loader2,
  Globe,
  DollarSign,
  Clock,
  Lock,
  Download,
  Trash2,
  ChevronRight,
  ChevronDown,
  Check,
  Pencil,
  X,
  CheckCircle,
  AlertCircle,
  Settings,
  LogOut,
  MailCheck,
  CreditCard,
} from 'lucide-react';
import { PlanSection } from '@/components/business-os/settings/PlanSection';
import { SettingsDrawer } from '@/components/business-os/settings/SettingsDrawer';
import { ChangePasswordDrawer } from '@/components/business-os/settings/ChangePasswordDrawer';
import { useLinkOpenedDrawer } from '@/components/business-os/settings/useLinkOpenedDrawer';
import { InviteFriendsSection } from '@/components/business-os/settings/InviteFriendsSection';
import { MarketingConsentDrawer } from '@/components/business-os/settings/MarketingConsentDrawer';
import { ErasureRequestContent } from '@/components/business-os/purge/DangerZonePanel';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { useConfigurationDialog } from '@/components/business-os/ConfigurationDialogProvider';
import { createLogger } from '@/lib/logger';
import { cn } from '@/lib/utils';

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

/** The profile card as `GET /api/business-os/account-profile` returns it (D-2). */
type ProfileCardValues = { full_name: string; avatar_url: string; job_title: string };

/**
 * Scroll a deep-linked settings section into view, clear of the sticky header.
 *
 * Returns the timer so the caller can cancel it on unmount. Shared, because a
 * second copy of this is how the offset drifts out of step and one entry point
 * starts landing under the header.
 */
function scrollToSection(section: string): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    const target = document.getElementById(`settings-section-${section}`);
    if (!target) return;

    // Offset by the sticky header, which would otherwise cover the section
    // heading the reader was sent here to find.
    const header = document.querySelector('.sticky');
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    const top = target.getBoundingClientRect().top + window.scrollY - headerHeight - 12;

    window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' });
  }, 100);
}

function BusinessOSSettingsContent() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { t, isRTL, language, setLanguage, currencyCode, setCurrency, availableCurrencies } = useLanguage();
  const { openConfiguration } = useConfigurationDialog();

  /*
   * The chevron on every account-card row (settings drawer S-5). Mirrored in
   * Hebrew, as the invite row's already was: the row reads right to left and
   * the chevron sits on its left edge, so an unmirrored one points back at the
   * label. One helper so the rows cannot drift apart again. The tone is a
   * parameter rather than a second class on top: `cn` does not merge Tailwind
   * classes, so two text colours would be decided by stylesheet order.
   */
  const rowChevron = (tone = 'text-[var(--v2-text-muted)]') => cn('w-4 h-4', tone, isRTL && 'scale-x-[-1]');

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

  // The plan drawer (settings drawer S-1) and the password drawer (S-2). Each
  // remembers whether a `?section=` link opened it, so closing takes `section`
  // back off the address (C-3). The typed passwords are NOT here: they live in
  // the password drawer's own form and go when it closes (C-7).
  const planDrawer = useLinkOpenedDrawer();
  const passwordDrawer = useLinkOpenedDrawer();
  const { openFromLink: openPlanFromLink } = planDrawer;
  const { openFromLink: openPasswordFromLink } = passwordDrawer;
  const planRowRef = useRef<HTMLButtonElement>(null);
  const passwordRowRef = useRef<HTMLButtonElement>(null);
  // The marketing permission drawer (S-3). Plain state, not the link hook: no
  // link anywhere opens it. Its form lives inside the drawer and goes on close.
  const [consentDrawerOpen, setConsentDrawerOpen] = useState(false);
  const consentRowRef = useRef<HTMLButtonElement>(null);

  const [exporting, setExporting] = useState(false);

  // Delete account dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Dropdown state
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  /*
   * Anyone who signs in with a provider gets an explanation instead of the form.
   * See `usesOAuthSignIn` for why that includes an account which also has a
   * password: the form cannot change the credential they actually use, and
   * "forgot password" still reaches the one it can.
   *
   * `hasBothSignInMethods` only decides which wording the explanation gets.
   *
   * Up here, before the deep-link effect, because `?section=password` opens the
   * password drawer only for an account that has the form.
   */
  const signsInWithProvider = usesOAuthSignIn(user);
  const signsInWithBoth = hasBothSignInMethods(user);
  const providerName = linkedOAuthLabel(user);
  const providerSecurityUrl = linkedProviderAccountUrl(user);

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

    /*
     * `timezone` scrolls but expands nothing: the picker is not inside a
     * collapsible section, it sits in the profile block above them. Calling
     * `setExpandedSection('timezone')` would collapse whichever section was
     * open and match nothing, so it is handled before that.
     */
    if (requested === 'timezone') {
      scrollToSection('timezone');
      return;
    }

    /*
     * `preferences` was accepted here too, for the notification section. That
     * section is gone, so expanding it would collapse whichever section the owner
     * had open and scroll to an anchor that no longer exists. An old email link
     * to `?section=preferences` now just opens this page, unchanged.
     */
    /*
     * `plan` is main's, and kept: it is where the Founding Partner pill in the
     * chrome points, and where the plan checkout returns (`?section=plan&checkout=…`),
     * so without it the pill lands somebody on settings with nothing open — a
     * link that appears to do nothing. Since settings drawer S-1 it opens the
     * plan drawer rather than expanding a row.
     *
     * `openPlanFromLink` sets the link flag EVERY time, even when the drawer is
     * already open (SA Q-2 / W-3; see `useLinkOpenedDrawer`): when `PlanPurchase`
     * writes `?section=plan&checkout=…` into a drawer opened from the row, the
     * address now carries `section`, and closing must take it off or a reload
     * would reopen the drawer. `checkout` is left alone; only `PlanSection`
     * reads it (C-11).
     *
     * `preferences` is NOT kept, though main accepted it. The section it expands
     * is the enquiry-notification one removed above, so accepting it would
     * collapse whatever the owner had open and scroll to an anchor that no longer
     * exists. Both sides of this merge said as much in their own comments.
     */
    if (requested === 'plan') {
      openPlanFromLink();
      return;
    }

    /*
     * `password` opens the password drawer (settings drawer S-2). Nothing in the
     * repo sends it (SA-3 (b)); it is kept because old mail may. An account that
     * signs in with a provider has no form, so for them the page is shown
     * unchanged, as it always was (the old expand found nothing to open).
     */
    if (requested === 'password') {
      if (!signsInWithProvider) openPasswordFromLink();
      return;
    }
  }, [searchParams, loading, openConfiguration, openPlanFromLink, openPasswordFromLink, signsInWithProvider]);

  const loadData = async () => {
    if (!user) return;

    try {
      setLoading(true);

      /*
       * Two independent halves (settings drawer D-1): a failed profile read
       * cannot blank the timezone, and a failed timezone read cannot blank the
       * profile. The timezone comes from the preferences route, RAW: `null`
       * ("not asked") shows the placeholder, never 'UTC'. `LanguageContext`'s
       * timezone cannot be reused, because it falls back to 'UTC'.
       */
      const [profileSettled, timezoneSettled] = await Promise.allSettled([
        // The card comes from the account-profile route (settings drawer D-2):
        // each field a string, '' when unset or when there is no row.
        (async (): Promise<ProfileCardValues | null> => {
          const res = await fetch('/api/business-os/account-profile', { method: 'GET' });
          const payload = await res.json().catch(() => null);
          if (!res.ok || payload?.success !== true || !payload.data) {
            logger.error({ userId: user.id, status: res.status }, 'Failed to load the profile card');
            return null;
          }
          const card = payload.data as Record<string, unknown>;
          const text = (v: unknown) => (typeof v === 'string' ? v : '');
          return { full_name: text(card.full_name), avatar_url: text(card.avatar_url), job_title: text(card.job_title) };
        })(),
        (async (): Promise<string> => {
          const res = await fetch('/api/business-os/preferences', { method: 'GET' });
          const payload = await res.json().catch(() => null);
          const locale = res.ok && payload?.success === true ? payload.data?.locale : null;
          if (!locale) {
            logger.warn({ userId: user.id, status: res.status }, 'Could not read the stored timezone');
            return '';
          }
          return typeof locale.timezone === 'string' ? locale.timezone : '';
        })(),
      ]);
      if (profileSettled.status === 'rejected') {
        logger.error({ err: profileSettled.reason, userId: user.id }, 'Failed to load the profile row');
      }
      if (timezoneSettled.status === 'rejected') {
        logger.warn({ err: timezoneSettled.reason, userId: user.id }, 'Could not read the stored timezone');
      }
      const card = profileSettled.status === 'fulfilled' ? profileSettled.value : null;
      const storedTimezone = timezoneSettled.status === 'fulfilled' ? timezoneSettled.value : '';

      /*
       * Not gated on the profile row.
       *
       * A missing `profiles` row used to skip the whole assignment — including
       * the timezone, which comes from a different table entirely. An account
       * with a saved zone and no profile row showed an empty timezone picker,
       * which reads as "never set" and invites someone to set it again.
       */
      setProfile({
        full_name: card?.full_name || '',
        avatar_url: card?.avatar_url || '',
        job_title: card?.job_title || '',
        timezone: storedTimezone,
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
   *
   * Since settings drawer D-1 the write, the `profiles` mirror and the
   * read-back all run on the server, behind `PATCH /api/business-os/preferences`
   * (CLAUDE.md rule 1). `success: true` means the server read the value back
   * and it matched. No language is sent: a new preferences row takes the
   * business's language on the server, and an existing row keeps its own.
   * Returns the zone, or `null` on any failure. Never throws.
   */
  const persistTimezone = async (zone: string): Promise<string | null> => {
    if (!user) return null;

    try {
      const res = await fetch('/api/business-os/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: zone }),
      });
      const payload = await res.json().catch(() => null);

      if (res.ok && payload?.success === true && payload?.data?.timezone === zone) {
        return zone;
      }

      logger.error({ userId: user.id, zone, status: res.status }, 'The server did not confirm the timezone');
      return null;
    } catch (err) {
      logger.error({ err, userId: user.id, zone }, 'Failed to save the timezone');
      return null;
    }
  };

  const saveProfile = async (overrides?: Partial<typeof profile>) => {
    if (!user) return;

    // The timezone row passes { timezone } and must save ONLY the timezone.
    // The card's Save passes nothing and must NEVER touch the timezone:
    // re-sending it stamped timezone_confirmed_at and answered the publish
    // gate's question on the owner's behalf (F-24). The pick does not re-write
    // the card either, so it cannot save a half-typed or cancelled name, and
    // it leaves the editor as it was (settings drawer D-2, SA ruling Q-1 (b)).
    if (overrides?.timezone !== undefined) {
      const zone = overrides.timezone;
      try {
        setSaving(true);
        setSuccessMessage('');
        setErrorMessage('');
        const saved = zone ? await persistTimezone(zone) : null;
        if (!saved) {
          setErrorMessage(t('settings.profile.error'));
          return;
        }
        setSuccessMessage(t('settings.profile.saved'));
        setTimeout(() => setSuccessMessage(''), 3000);
      } finally {
        setSaving(false);
      }
      return;
    }

    // Passed in rather than read back out of state, so the save cannot depend
    // on whether React has re-rendered yet.
    const next = { ...profile, ...overrides };

    try {
      setSaving(true);
      setSuccessMessage('');
      setErrorMessage('');

      // The name only. No avatar_url (the avatar hook stored it at pick time,
      // F-6), no job_title (the card has no field for it, F-1, and a failed
      // read would blank it), and no timezone (F-24).
      const res = await fetch('/api/business-os/account-profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: next.full_name }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || payload?.success !== true) {
        logger.error({ userId: user.id, status: res.status }, 'Failed to save the profile card');
        setErrorMessage(t('settings.profile.error'));
        return;
      }
      // Show what was stored (the route trims).
      const storedName: unknown = payload.data?.full_name;
      if (typeof storedName === 'string') {
        setProfile(p => ({ ...p, full_name: storedName }));
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

  /** The "you sign in with Google" block, worded by whichever state we are in. */
  const providerNotice = (titleKey: string, descKey: string) => (
    <div className="p-4 flex items-start gap-3">
      <Lock className="w-5 h-5 text-[var(--v2-text-muted)] shrink-0 mt-0.5" />
      <div className="space-y-1">
        <p className="text-sm text-[var(--v2-text-primary)]">
          {t(titleKey, { provider: providerName ?? '' })}
        </p>
        <p className="text-xs text-[var(--v2-text-secondary)]">
          {t(descKey, { provider: providerName ?? '' })}
        </p>
        {providerSecurityUrl && (
          <a
            href={providerSecurityUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-xs text-[var(--v2-primary)] underline pt-1"
          >
            {t('settings.security.provider_manage', { provider: providerName ?? '' })}
          </a>
        )}
      </div>
    </div>
  );

  const handleExportData = async () => {
    if (!user) return;

    try {
      setExporting(true);

      // The server export, not a client read (DE-0a): reading the tables here
      // with `select('*')` put every plugin's OAuth tokens in the file.
      const result = await downloadUserDataExport();
      if (!result.success) {
        logger.error({ code: result.code, status: result.status }, 'Failed to export the account data');
        setErrorMessage(t('settings.security.export_error'));
        return;
      }

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
     * Through the shared helper, not a second copy of the same resolution.
     *
     * This used to inline its own `NEXT_PUBLIC_MARKETING_URL ?? localhost ??
     * apex` chain, and it drifted exactly as a duplicated constant does: when
     * the production fallback was corrected away from `agentspilot.com` — an
     * apex with an expired certificate, so signing out from here hit a browser
     * security interstitial — every other sign-out in the app was fixed by that
     * one edit and this one alone kept the broken domain.
     */
    /*
     * `replace`, not `href`.
     *
     * `href` PUSHES, which leaves the page they just signed out of sitting in
     * history immediately behind the login page — so one tap of Back returned
     * them to it. `replace` overwrites that entry, so Back goes to whatever
     * preceded the app, not into it.
     *
     * This alone is not enough: any EARLIER platform entry is still reachable,
     * which is what `SessionRecheckOnRestore` covers.
     */
    window.location.replace(marketingLogoutUrl());
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

  /*
   * Every zone the runtime knows, not a list of seven cities.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * This was seven options. An owner in Madrid, Sydney or São Paulo could not
   * express where they are — and worse, `currentTimezone` below resolves to
   * `undefined` for any stored zone outside the list, so the field renders its
   * placeholder. A business that HAD set a timezone looked, on this screen,
   * exactly like one that never had, and re-saving from here would have
   * narrowed them to one of seven.
   *
   * That matters more now that a missing timezone blocks publishing a booking
   * page: a short list would have the readiness card nagging people who
   * already answered.
   *
   * `supportedValuesOf` is the runtime's own IANA list and needs no
   * maintenance. It is missing in older engines, so the seven stay as a
   * fallback rather than leaving an owner with an empty dropdown.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const timezoneOptions = useMemo(() => {
    const labelFor = (zone: string) => zone.split('/').pop()?.replace(/_/g, ' ') ?? zone;

    const supported =
      typeof Intl.supportedValuesOf === 'function'
        ? Intl.supportedValuesOf('timeZone')
        : [];

    if (supported.length === 0) {
      return [
        { value: 'America/New_York', label: 'New York' },
        { value: 'America/Los_Angeles', label: 'Los Angeles' },
        { value: 'Europe/London', label: 'London' },
        { value: 'Europe/Paris', label: 'Paris' },
        { value: 'Asia/Tokyo', label: 'Tokyo' },
        { value: 'Asia/Jerusalem', label: 'Jerusalem' },
        { value: 'UTC', label: 'UTC' },
      ];
    }

    // UTC first: it is a legitimate answer for a business that genuinely works
    // to it, and `supportedValuesOf` does not always include it.
    return [
      { value: 'UTC', label: 'UTC' },
      ...supported
        .filter(zone => zone !== 'UTC')
        .map(zone => ({ value: zone, label: `${labelFor(zone)} — ${zone}` })),
    ];
  }, []);

  const [timezoneQuery, setTimezoneQuery] = useState('');

  /*
   * Capped at 60 rows. Nobody reads past that; what they do is type. The cap
   * keeps the first render cheap with several hundred zones in the list.
   */
  const visibleTimezones = useMemo(() => {
    const query = timezoneQuery.trim().toLowerCase();
    const matches = query
      ? timezoneOptions.filter(tz => tz.label.toLowerCase().includes(query))
      : timezoneOptions;
    return matches.slice(0, 60);
  }, [timezoneOptions, timezoneQuery]);

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

          {/*
            No "back to dashboard" control.

            The platform's own navigation is always on screen, so a second way
            back was one more thing in a header that has to fit on a phone — and
            it pointed at one fixed destination regardless of where the reader
            had come from, which is the part that made it misleading rather than
            merely redundant.
          */}
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
                      className={`w-full px-4 py-3 text-sm flex items-center justify-between text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] ${language === lang.code ? 'bg-[var(--v2-bg)]' : ''}`}
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
                      onClick={async () => {
                        setOpenDropdown(null);
                        const result = await setCurrency(curr.code as 'USD' | 'EUR' | 'ILS' | 'GBP');
                        /*
                         * The database refuses a change once money exists in
                         * the current currency — changing it would relabel
                         * history, not convert it. `setCurrency` has already
                         * put the old value back; this says why, rather than
                         * leaving the picker to snap back unexplained.
                         *
                         * Only for that refusal. Any other failure (network,
                         * server) is worth retrying, so it must not claim the
                         * owner has invoices in this currency.
                         */
                        if (!result.ok) {
                          setErrorMessage(
                            result.code === 'CURRENCY_LOCKED'
                              ? t('settings.profile.currency_locked')
                              : t('settings.business.error')
                          );
                          setTimeout(() => setErrorMessage(''), 6000);
                        }
                      }}
                      className={`w-full px-4 py-3 text-sm flex items-center justify-between text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] ${currencyCode === curr.code ? 'bg-[var(--v2-bg)]' : ''}`}
                    >
                      <span>{curr.label}</span>
                      {currencyCode === curr.code && <Check className="w-4 h-4 text-[var(--v2-primary)]" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/*
            Timezone.

            Carries an id because the readiness gate links straight here: a
            missing timezone blocks publishing a booking surface, and the Fix
            button has to land on the control that clears it rather than on a
            page the owner then has to search.
          */}
          <div className="relative" id="settings-section-timezone">
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
                <div className="fixed inset-0 z-40" onClick={() => { setOpenDropdown(null); setTimezoneQuery(''); }} />
                <div className="absolute z-50 top-full left-0 right-0 mt-1 mx-4 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-lg" style={{ borderRadius: 'var(--v2-radius-card)' }}>
                  {/*
                    Typed, not scrolled. The list is now every zone the runtime
                    knows rather than seven cities, and several hundred options
                    in a short scroller is a worse answer than the seven were.
                  */}
                  <input
                    value={timezoneQuery}
                    onChange={(e) => setTimezoneQuery(e.target.value)}
                    autoFocus
                    placeholder={t('settings.profile.timezone_search')}
                    className="w-full px-4 py-2.5 text-sm bg-transparent border-b border-[var(--v2-border)] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none"
                  />
                  <div className="max-h-48 overflow-y-auto">
                    {visibleTimezones.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-[var(--v2-text-muted)]">
                        {t('settings.profile.timezone_none')}
                      </p>
                    ) : (
                      visibleTimezones.map((tz) => (
                        <button
                          key={tz.value}
                          onClick={() => { setProfile(p => ({ ...p, timezone: tz.value })); setOpenDropdown(null); setTimezoneQuery(''); saveProfile({ timezone: tz.value }); }}
                          className={`w-full px-4 py-3 text-sm flex items-center justify-between text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] ${profile.timezone === tz.value ? 'bg-[var(--v2-bg)]' : ''}`}
                        >
                          <span className="text-start">{tz.label}</span>
                          {profile.timezone === tz.value && <Check className="w-4 h-4 text-[var(--v2-primary)] flex-shrink-0" />}
                        </button>
                      ))
                    )}
                  </div>
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
            Your plan — what this business is on and what it includes.

            First in the list because it is the thing somebody opens settings to
            check, and because a customer who cannot find what they are paying
            for assumes the worst. Since plan payments P-4.2 the section also
            offers Choose for exactly the plans the server would sell
            (`purchase.offer`), with the embedded checkout; where nothing is on
            sale it stays read-only and shows no button that does nothing.

            Since settings drawer S-1 the row opens a drawer instead of expanding
            in place. It shows the title only (C-8): the plan is fetched when the
            drawer opens, by `PlanSection`, as it was when the row expanded.
          */}
          {/* Id kept (S-5, SA W-5). Nothing in the repo links to it any more (every
              sender uses `?section=plan`), but it costs nothing, matches the
              consent and invite rows, and a hand-shared or bookmarked
              `#settings-section-plan` still lands on the row. */}
          <div id="settings-section-plan">
            <button
              ref={planRowRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={planDrawer.open}
              onClick={planDrawer.openFromRow}
              className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <CreditCard className="w-5 h-5 text-[var(--v2-text-muted)]" />
                <span className="text-sm text-[var(--v2-text-primary)]">{t('plan.section_title')}</span>
              </div>
              <ChevronRight className={rowChevron()} aria-hidden="true" />
            </button>
            <SettingsDrawer
              open={planDrawer.open}
              onOpenChange={planDrawer.onOpenChange}
              title={t('plan.section_title')}
              isRTL={isRTL}
              closeLabel={t('common.close')}
              returnFocusRef={planRowRef}
              testId="settings-plan-drawer"
            >
              {/* P-4.2: the checkout return marker (display only; the section
                  pattern-checks it and only the server re-read shows a plan). */}
              <PlanSection checkoutMarker={searchParams?.get('checkout') ?? null} />
            </SettingsDrawer>
          </div>

          {/* Slice 5a: renders nothing unless the server says this account may invite friends. */}
          <InviteFriendsSection />

          {/*
            The enquiry notification section used to be here.

            Both of its switches now live next to the thing they are about: the
            owner alert on the "reply to new enquiries" advisor card, and the
            morning briefing on the briefing card. The reasoning that put them
            here was that a dashboard card renders only when somebody is waiting:
            true of the briefing card, but NOT of the enquiries automation, which
            has no `requires` and is offered with zero waiting, so it is always
            reachable.

            No signpost is left at `#settings-section-preferences`. New mail points
            at the dashboard instead (see `LeadAlertService` and
            `DailyBriefingDispatchService`); mail already delivered still links to
            `?section=preferences`, which now lands on this page with nothing
            expanded rather than on a row explaining where the switch went.
          */}

          {/* Marketing consent. Since settings drawer S-3 the row opens a drawer
              instead of expanding in place; the id stays so an old
              `#settings-section-consent` still lands on the row. */}
          <div id="settings-section-consent">
            <button
              ref={consentRowRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={consentDrawerOpen}
              onClick={() => setConsentDrawerOpen(true)}
              className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <MailCheck className="w-5 h-5 text-[var(--v2-text-muted)]" />
                <span className="text-sm text-[var(--v2-text-primary)]">{t('consent.title')}</span>
              </div>
              <ChevronRight className={rowChevron()} aria-hidden="true" />
            </button>
            <MarketingConsentDrawer
              open={consentDrawerOpen}
              onOpenChange={setConsentDrawerOpen}
              returnFocusRef={consentRowRef}
            />
          </div>

          {/*
            A provider linked at all → the notice, no form. The wording differs
            by whether a password also exists, so an owner who has one is told
            how to reset it rather than left to wonder where the form went.
          */}
          {signsInWithProvider ? (
            signsInWithBoth
              ? providerNotice(
                  'settings.security.provider_also_signin',
                  'settings.security.provider_also_desc'
                )
              : providerNotice(
                  'settings.security.provider_signin',
                  'settings.security.provider_signin_desc'
                )
          ) : (
          <div>
            {/*
              Since settings drawer S-2 the row opens a drawer instead of
              expanding in place. The form, its state and its messages live in
              `ChangePasswordDrawer`, so closing the drawer clears the fields (C-7).
            */}
            <button
              ref={passwordRowRef}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={passwordDrawer.open}
              onClick={passwordDrawer.openFromRow}
              className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-bg)] transition-colors"
            >
              <div className="flex items-center gap-3">
                <Lock className="w-5 h-5 text-[var(--v2-text-muted)]" />
                <span className="text-sm text-[var(--v2-text-primary)]">{t('settings.security.change_password')}</span>
              </div>
              <ChevronRight className={rowChevron()} aria-hidden="true" />
            </button>
            <ChangePasswordDrawer
              open={passwordDrawer.open}
              onOpenChange={passwordDrawer.onOpenChange}
              returnFocusRef={passwordRowRef}
            />
          </div>
          )}

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
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className={rowChevron()} aria-hidden="true" />}
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
              <ChevronRight className={rowChevron()} aria-hidden="true" />
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
            <ChevronRight className={rowChevron('text-red-400')} aria-hidden="true" />
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
