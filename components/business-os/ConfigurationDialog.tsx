'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAuth } from '@/components/UserProvider';
import { intakeReachesClient } from '@/lib/business-os/intakeReach';
import { configTabsForShape, shapeFromServices } from '@/lib/business-os/businessShape';
import { X, Settings, Clock, CreditCard, Loader2, Check, AlertTriangle, ClipboardList, Sparkles, Building2, FileText, Link2 } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { SchedulingServicesList } from '@/components/scheduling/SchedulingServicesList';
import { AvailabilityEditor, DEFAULT_AVAILABILITY, parseAvailability, type WeeklyAvailability } from '@/components/scheduling/AvailabilityEditor';
import { TimeOffEditor } from '@/components/scheduling/TimeOffEditor';
import { IntakeSettingsPanel } from '@/components/scheduling/IntakeSettingsPanel';
import { CalendarSyncSettings } from '@/components/scheduling/CalendarSyncSettings';
import { BusinessProfileSection } from '@/components/business-os/settings/BusinessProfileSection';
import { InvoiceSettingsSection } from '@/components/business-os/settings/InvoiceSettingsSection';
import { TabFooter, TabFooterSlot, TabFooterSlotProvider } from '@/components/business-os/settings/TabFooter';
import { StripeConnectWizard } from '@/components/payments/StripeConnectWizard';
import { StripeEmbeddedOnboarding } from '@/components/payments/StripeEmbeddedOnboarding';
import { createLogger } from '@/lib/logger';
import type { SchedulingService } from '@/lib/repositories/SchedulingRepository';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

const logger = createLogger({ module: 'ConfigurationDialog' });

// Configuration theme color: Pink (#D14E97)
const CONFIG_COLOR = '#D14E97';

/*
 * `business` and `invoice` moved here from `/business-os/settings`.
 *
 * That page is the ACCOUNT screen — the person's profile, their password,
 * their data. The business's own name, trade and published contact details,
 * and the details printed on its invoices, are business configuration, and
 * belong beside services, availability and payments.
 *
 * It also removes a split the dashboard had to live with: the readiness chips
 * opened a page for two items and this dialog for the rest, so one list of
 * unfinished work led to two different kinds of screen.
 */
type ConfigTab = 'services' | 'availability' | 'intake' | 'payments' | 'business' | 'invoice';

interface ConfigurationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: ConfigTab;
  serviceToEdit?: string; // Service ID to edit (from chat)
  visibleTabs?: ConfigTab[]; // When set, only show these tabs (hides tab bar if single tab)
  servicePrefill?: Record<string, any>; // Pre-fill values for new service (from chat) - auto-starts add row
  availabilityDaysToAdd?: string[]; // Days to pre-add with default time slot (from chat)
  onServiceCreated?: (service: { name: string; duration: number; price: number; currency: string }) => void; // Callback when service created from chat
  onCloseWithUnpublished?: (serviceName: string) => void; // Callback when user closes with unpublished changes
  onServicePublished?: (serviceName: string) => void; // Callback when any service is published from within the dialog
  /**
   * Any edit to an existing service, saved.
   *
   * Distinct from `onServicePublished`, which fires only when a draft goes
   * live. A caller showing its own copy of the service list — the website
   * wizard does — needs to know about a rename the moment it is saved, not
   * when the dialog eventually closes.
   */
  onServiceEdited?: (serviceId: string) => void;
}

/** One reason cards cannot be switched off yet, as the server reports it. */
interface ExitBlockerView {
  code: string;
  count: number;
}

export function ConfigurationDialog({ isOpen, onClose, initialTab, serviceToEdit, visibleTabs, servicePrefill, availabilityDaysToAdd, onServiceCreated, onCloseWithUnpublished, onServicePublished, onServiceEdited }: ConfigurationDialogProps) {
  const { t, isRTL } = useLanguage();
  // The invoice panel is user-scoped and this dialog had no user of its own.
  const { user } = useAuth();
  const currentUserId = user?.id || '';

  const [activeTab, setActiveTab] = useState<ConfigTab>(initialTab || 'services');

  /**
   * Whether an intake form is collected after a booking.
   *
   * Held here rather than in the services list, because this dialog already
   * owns the intake tab and the list only needs it to draw a row honestly.
   */
  const [intakeEnabled, setIntakeEnabled] = useState(false);

  /**
   * Whether this business collects intake.
   *
   * Read once on open and again whenever the Intake tab saves. Without the
   * second read, toggling intake left every service's journey strip on the
   * Services tab showing the state from before the toggle — two tabs of one
   * dialog disagreeing about the same setting, until it was closed and
   * reopened.
   */
  const refreshIntakeEnabled = useCallback(async () => {
    try {
      /*
       * `no-store`, because this is a REFETCH of a URL already fetched on open.
       * Without it the browser answers from its own cache and this reports the
       * state from before the change that triggered it — the dialog saying
       * intake does not reach clients seconds after the owner published it.
       */
      const response = await fetch('/api/intake/settings', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      // "Does a form reach the client", not "is a setting on". Reading
      // `is_enabled` alone drew an intake step on every service for a business
      // whose email toggle was off, or which had no form chosen.
      setIntakeEnabled(intakeReachesClient(data?.settings));
    } catch {
      // Never fatal: without the flag the journey omits a step it cannot
      // confirm, which is the safer of the two mistakes.
    }
  }, []);

  // Closed instances are mounted as warm-ups (the provider, `/onboarding-build`, PERF-1): keep every side effect gated on `isOpen`.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    fetch('/api/intake/settings', { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        if (!cancelled) setIntakeEnabled(intakeReachesClient(data?.settings));
      })
      .catch(() => {
        // Never fatal: without the flag the journey omits a step it cannot
        // confirm, which is the safer of the two mistakes.
      });

    return () => { cancelled = true; };
  }, [isOpen]);

  // Services state
  const [services, setServices] = useState<SchedulingService[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [shouldAutoStartNewRow, setShouldAutoStartNewRow] = useState(false);
  const [autoStartTriggered, setAutoStartTriggered] = useState(false); // Prevents re-triggering after save
  const [activeServiceToEdit, setActiveServiceToEdit] = useState<string | undefined>(undefined); // Service ID to auto-edit
  const [editedServiceId, setEditedServiceId] = useState<string | undefined>(undefined); // Track which service was edited (becomes draft)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false); // Show confirmation dialog on close

  // Availability state
  const [availability, setAvailability] = useState<WeeklyAvailability>(DEFAULT_AVAILABILITY);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [availabilitySaved, setAvailabilitySaved] = useState(false);
  /** Why the last availability save did not take. See `saveAvailability`. */
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  /**
   * The time-off section, so the working-days row can point at it.
   *
   * Time off saves its own rows and therefore sits as a separate component below
   * the weekly hours — correct, but below the fold, where owners never found it.
   * The link is rendered by `AvailabilityEditor` and the scrolling happens here,
   * because this is the component that decided the two sit one above the other.
   */
  const timeOffRef = useRef<HTMLDivElement>(null);

  // Stripe state
  const [stripeConnected, setStripeConnected] = useState(false);
  const [stripeOnboardingPending, setStripeOnboardingPending] = useState(false); // Has account but onboarding incomplete
  const [stripeDisconnected, setStripeDisconnected] = useState(false); // Account exists but is disconnected (charges_enabled=false)
  const [stripeLoading, setStripeLoading] = useState(true);
  /*
   * The element tab action bars are rendered into.
   *
   * State, not a ref: on the render that mounts a tab the ref would still be
   * null and the bar would never appear.
   */
  const [footerSlot, setFooterSlot] = useState<HTMLElement | null>(null);

  const [showStripeWizard, setShowStripeWizard] = useState(false);
  const [showEmbeddedOnboarding, setShowEmbeddedOnboarding] = useState(false); // Embedded onboarding for continue flow
  const [stripeContinueMode, setStripeContinueMode] = useState(false); // Whether wizard is in continue mode
  const [stripeAccountData, setStripeAccountData] = useState<{
    stripe_account_id: string;
    stripe_email?: string | null;
    country?: string | null;
    business_type?: string | null;
    /* The three facts a support request actually turns on: can it charge, can
       it pay out, and did the owner switch cards off themselves. Carried so the
       details card reports what the row says rather than what the UI inferred. */
    charges_enabled?: boolean | null;
    payouts_enabled?: boolean | null;
    paused_at?: string | null;
    /** standard / express / custom. They behave differently and fail differently. */
    stripe_account_type?: string | null;
    /** Did onboarding ever finish. Separates "never set up" from "Stripe turned it off". */
    details_submitted?: boolean | null;
    /** When we last heard from Stripe. A stale row explains a confusing screen. */
    updated_at?: string | null;
    /**
     * Does this business ALSO hold an OAuth connection?
     *
     * The documented drift: an account id lives in `stripe_connect_accounts`
     * and in `plugin_connections.profile_data`, routes read them in different
     * orders, and a business holding both can be charged on one account and
     * refunded against the other. Nothing surfaced it, so a support request
     * about a failing refund looked like a Stripe problem.
     */
    has_oauth_connection?: boolean;
  } | null>(null);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  /*
   * Why cards could not be switched off, straight from the server.
   *
   * `null` means nothing is blocking. A non-empty array opens the dialog below;
   * an EMPTY array means the check itself failed, which is a different message
   * — "we could not look" is not "you are clear".
   */
  const [exitBlockers, setExitBlockers] = useState<ExitBlockerView[] | null>(null);
  /** Momentary "Copied" on the support card. Resets itself after two seconds. */
  const [supportCopied, setSupportCopied] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Set initial tab when dialog opens
  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Trigger auto-start new row when servicePrefill is provided (from chat) - only once per dialog open
  useEffect(() => {
    if (isOpen && servicePrefill && !loadingServices && !autoStartTriggered) {
      setShouldAutoStartNewRow(true);
      setAutoStartTriggered(true); // Prevent re-triggering after save
    }
  }, [isOpen, servicePrefill, loadingServices, autoStartTriggered]);

  // Set service to auto-edit when serviceToEdit prop is provided and services are loaded
  useEffect(() => {
    if (isOpen && serviceToEdit && !loadingServices && services.length > 0) {
      setActiveServiceToEdit(serviceToEdit);
    }
  }, [isOpen, serviceToEdit, loadingServices, services.length]);

  useEffect(() => {
    if (isOpen) {
      fetchServices();
      fetchAvailability();
      checkStripeConnection(true); // Refresh from Stripe API to get latest status
    } else {
      // Reset state when dialog closes
      setShouldAutoStartNewRow(false);
      setAutoStartTriggered(false);
      setActiveServiceToEdit(undefined);
      setEditedServiceId(undefined);
      setShowCloseConfirm(false);
    }
  }, [isOpen]);

  // Handle close with confirmation if edited service is unpublished
  const handleCloseAttempt = useCallback(() => {
    // Check if the edited service is still a draft
    if (editedServiceId) {
      const editedService = services.find(s => s.id === editedServiceId);
      if (editedService && editedService.status === 'draft') {
        setShowCloseConfirm(true);
        return;
      }
    }
    onClose();
  }, [editedServiceId, services, onClose]);

  // Force close without confirmation
  const handleForceClose = useCallback(() => {
    // Notify parent about closing with unpublished changes
    if (editedServiceId && onCloseWithUnpublished) {
      const editedService = services.find(s => s.id === editedServiceId);
      if (editedService) {
        onCloseWithUnpublished(editedService.service_name);
      }
    }
    setShowCloseConfirm(false);
    onClose();
  }, [editedServiceId, services, onCloseWithUnpublished, onClose]);

  // Track when a service was edited (saved as draft)
  const handleServiceEdited = useCallback((serviceId: string) => {
    setEditedServiceId(serviceId);
    onServiceEdited?.(serviceId);
  }, [onServiceEdited]);

  // Track when a service was published - clear the edited state and notify parent
  const handleServicePublishedWithId = useCallback((serviceId: string) => {
    // Find the service name to notify parent (for chat integration)
    const publishedService = services.find(s => s.id === serviceId);
    if (publishedService && onServicePublished) {
      onServicePublished(publishedService.service_name);
    }

    if (editedServiceId === serviceId) {
      setEditedServiceId(undefined);
    }
    /*
     * Silent. `fetchServices` sets `loadingServices`, which replaces the whole
     * tab with a spinner — so publishing one service tore down the list, the
     * panel and the owner's place in it, to change one word in one row. The
     * silent variant reads the same endpoint and swaps the data underneath.
     */
    silentRefreshServices();
  }, [editedServiceId, services, onServicePublished]);

  const fetchServices = async () => {
    try {
      setLoadingServices(true);
      const response = await fetch('/api/scheduling/services');
      const data = await response.json();
      if (data.success) {
        setServices(data.services || []);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch services');
    } finally {
      setLoadingServices(false);
    }
  };

  // Silent refresh - no loading spinner
  const silentRefreshServices = async () => {
    try {
      const response = await fetch('/api/scheduling/services');
      const data = await response.json();
      if (data.success) {
        setServices(data.services || []);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to silent refresh services');
    }
  };

  const fetchAvailability = async () => {
    try {
      const response = await fetch('/api/scheduling/availability');
      const data = await response.json();
      if (data.success && data.availability) {
        setAvailability(parseAvailability(data.availability));
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch availability');
    }
  };

  const saveAvailability = async () => {
    try {
      setSavingAvailability(true);
      setAvailabilitySaved(false);
      const response = await fetch('/api/scheduling/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availability })
      });
      const data = await response.json();
      if (data.success) {
        setAvailabilityError(null);
        setAvailabilitySaved(true);
        setTimeout(() => setAvailabilitySaved(false), 3000);
        return;
      }

      /*
       * A refused save was silent.
       *
       * Only the success branch did anything, so a save that failed looked
       * exactly like one that worked minus a brief "Saved" flash — and the
       * hours the owner had just cleared or entered were still on screen,
       * which reads as saved. They would leave believing it was done, and
       * every gate downstream would disagree with them.
       */
      logger.warn({ error: data.error }, 'Availability save refused');
      setAvailabilityError(data.error || t('common.error') || 'Could not save');
    } catch (error) {
      logger.error({ err: error }, 'Failed to save availability');
      setAvailabilityError(t('common.error') || 'Could not save');
    } finally {
      setSavingAvailability(false);
    }
  };

  const checkStripeConnection = async (refreshFromStripe = false) => {
    try {
      setStripeLoading(true);

      // If refreshFromStripe is true, first sync the latest status from Stripe API
      if (refreshFromStripe) {
        try {
          await fetch('/api/payments/stripe-connect/refresh-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (err) {
          // Continue even if refresh fails - we'll use cached data
          logger.warn({ err }, 'Failed to refresh status from Stripe');
        }
      }

      // Check both stripe_connect_accounts AND plugin_connections
      // User might be connected via OAuth (plugin_connections) or Express account (stripe_connect_accounts)
      const [stripeResponse, pluginResponse] = await Promise.all([
        fetch('/api/payments/stripe-connect'),
        fetch('/api/plugin-connections')
      ]);

      const stripeData = await stripeResponse.json();
      const pluginData = await pluginResponse.json();

      // Check stripe_connect_accounts status
      const hasStripeAccountData = stripeData.success && stripeData.data;

      // State detection:
      // - Connected: charges_enabled is true (can accept payments)
      // - Disconnected: charges_enabled is explicitly false AND details_submitted is false (was soft-disconnected)
      // - Pending: has account but onboarding not complete yet
      const chargesEnabled = stripeData.data?.charges_enabled;
      const detailsSubmitted = stripeData.data?.details_submitted;

      // Consider connected if charges enabled OR (details submitted and not explicitly disconnected)
      const stripeOnboardingComplete = hasStripeAccountData && chargesEnabled === true;
      // Only disconnected if charges_enabled is false AND details not submitted (genuine disconnect, not pending)
      /*
       * The OWNER's decision, not Stripe's status.
       *
       * This inferred "disconnected" from `chargesEnabled === false &&
       * !detailsSubmitted` — two flags STRIPE also writes, which
       * `refresh-status` rewrites from Stripe every time this dialog opens.
       * Stripe is never told about a disconnect, so it kept answering
       * "enabled" and the account silently reconnected.
       *
       * `paused_at` is written only by `disconnect` and cleared only by the
       * onboarding callback, so it survives a refresh. The old inference stays
       * as the fallback for rows that predate the column.
       */
      const pausedAt = stripeData.data?.paused_at ?? null;
      const stripeAccountDisconnected = hasStripeAccountData
        && (Boolean(pausedAt) || (chargesEnabled === false && !detailsSubmitted));
      const stripeAccountPending = hasStripeAccountData && !stripeOnboardingComplete && !stripeAccountDisconnected;

      // Check plugin_connections for OAuth connection
      const hasPluginConnection = pluginData.plugins?.some((conn: any) =>
        conn.plugin_key === 'stripe' && conn.status === 'active'
      );

      // Store the account data for use in the wizard
      if (hasStripeAccountData) {
        setStripeAccountData({
          stripe_account_id: stripeData.data.stripe_account_id,
          stripe_email: stripeData.data.stripe_email,
          country: stripeData.data.country,
          business_type: stripeData.data.business_type,
          charges_enabled: stripeData.data.charges_enabled,
          payouts_enabled: stripeData.data.payouts_enabled,
          paused_at: stripeData.data.paused_at ?? null,
          stripe_account_type: stripeData.data.stripe_account_type,
          details_submitted: stripeData.data.details_submitted,
          updated_at: stripeData.data.updated_at,
          has_oauth_connection: Boolean(hasPluginConnection),
        });
      } else {
        setStripeAccountData(null);
      }

      // Set states:
      // - Connected: onboarding complete OR has active plugin connection
      // - Pending: has stripe_connect_accounts record but onboarding not complete (and not disconnected)
      // - Disconnected: has account but was soft-disconnected
      setStripeConnected(stripeOnboardingComplete || hasPluginConnection);
      setStripeOnboardingPending(stripeAccountPending && !stripeAccountDisconnected && !hasPluginConnection);
      setStripeDisconnected(stripeAccountDisconnected);

      logger.info({
        chargesEnabled,
        detailsSubmitted,
        stripeOnboardingComplete,
        stripeAccountDisconnected,
        stripeAccountPending
      }, 'Stripe connection status checked');
    } catch (error) {
      logger.error({ err: error }, 'Failed to check Stripe status');
      setStripeConnected(false);
      setStripeOnboardingPending(false);
    } finally {
      setStripeLoading(false);
    }
  };

  const handleConnectStripe = async () => {
    // Simplified flow: Create minimal account and show embedded onboarding directly
    if (!stripeConnected) {
      try {
        setStripeLoading(true);

        // Create minimal account - Stripe's embedded onboarding will collect everything
        const response = await fetch('/api/payments/stripe-connect/create-minimal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ country: 'US' }), // Default to US, can be changed in Stripe's form
        });

        const result = await response.json();

        if (result.success) {
          // Account created (or exists) - show embedded onboarding
          if (result.accountId) {
            setStripeAccountData({
              stripe_account_id: result.accountId,
              stripe_email: null,
              country: 'US',
              business_type: 'individual',
            });
          }
          setShowEmbeddedOnboarding(true);
        } else {
          logger.error({ error: result.error }, 'Failed to create Stripe account');
        }
      } catch (error) {
        logger.error({ err: error }, 'Failed to initiate Stripe connection');
      } finally {
        setStripeLoading(false);
      }
    }
  };

  const handleContinueOnboarding = async () => {
    // For pending/disconnected accounts, just show embedded onboarding directly
    // The account already exists, so no need to create one
    setShowEmbeddedOnboarding(true);
  };

  const handleEmbeddedOnboardingComplete = () => {
    setShowEmbeddedOnboarding(false);
    setStripeOnboardingPending(false);
    setStripeDisconnected(false);
    setStripeConnected(true);
    checkStripeConnection(true); // Refresh from Stripe API to get latest status
  };

  const handleEmbeddedOnboardingExit = () => {
    setShowEmbeddedOnboarding(false);
    checkStripeConnection(true); // Refresh from Stripe API in case partial progress was made
  };

  /*
   * ONE PRESS, ONE ANSWER.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * This opened the confirmation straight away, so an owner with running plans
   * read a confident explanation of what disconnecting would do, pressed it,
   * and only then learned the server refuses. Two actions to find out one fact,
   * and the first was a promise the product could not keep.
   *
   * The check runs first now. Either the owner sees what is outstanding, with
   * no disconnect button to press, or they see a confirmation that is true.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /*
   * What is stopping a disconnect, asked when the dialog opens.
   *
   * `null` while checking and when nothing is blocking — the button reads
   * `checkingExit` for the first and `exitBlockers` for the second, so "still
   * looking" and "clear" never look the same.
   */
  const [checkingExit, setCheckingExit] = useState(false);

  useEffect(() => {
    /*
     * BOTH EXITS ASK THE SAME QUESTION.
     *
     * Disconnect and Remove connection answer to one rule server-side
     * (`checkConnectExitBlockers`), so they must answer to one here too. The
     * delete route was already refusing a blocked removal with a 409 that the
     * dialog only logged — the owner pressed it, the dialog closed, and nothing
     * said why. The two cannot be open at once, so one piece of state serves
     * both.
     */
    if (!showDisconnectConfirm && !showDeleteConfirm) return;

    let cancelled = false;
    setCheckingExit(true);
    setExitBlockers(null);

    fetch('/api/payments/stripe-connect/disconnect')
      .then(r => r.json())
      .then(result => {
        if (cancelled) return;
        // An empty array is "we could not look", which the dialog words
        // differently from "these are in the way".
        if (!result.canDisconnect) setExitBlockers(result.blockers ?? []);
      })
      .catch(err => {
        /*
         * The check is a courtesy, not the control: the POST applies the same
         * rule and refuses on its own. A network blip leaves the button live
         * rather than stranding the owner behind a failed fetch.
         */
        logger.error({ err }, 'Disconnect pre-check failed; leaving the action enabled');
      })
      .finally(() => {
        if (!cancelled) setCheckingExit(false);
      });

    return () => { cancelled = true; };
  }, [showDisconnectConfirm, showDeleteConfirm]);

  const handleDisconnectStripe = () => {
    /*
     * Opens the dialog; the DIALOG does the checking.
     *
     * Checking out here meant the owner pressed a button and waited with no
     * surface to wait on, then got one of two different dialogs depending on
     * the answer. One dialog that explains itself is less to understand: it
     * opens, says it is looking, and then either offers the action or shows
     * what is in the way with the action disabled.
     */
    setExitBlockers(null);
    setShowDisconnectConfirm(true);
  };

  const handleDeleteStripe = () => {
    // Clear any verdict left by a previous open, so the dialog cannot show a
    // stale answer while the fresh one is still in flight.
    setExitBlockers(null);
    setShowDeleteConfirm(true);
  };

  // Disconnect: Just removes from our database, keeps Stripe account
  const confirmDisconnectStripe = async () => {
    setShowDisconnectConfirm(false);
    try {
      setStripeLoading(true);

      // Only delete from our stripe_connect_accounts table (soft disconnect)
      const response = await fetch('/api/payments/stripe-connect/disconnect', {
        method: 'POST'
      });

      const result = await response.json();

      if (result.success) {
        setStripeConnected(false);
        setStripeOnboardingPending(false);
        setStripeDisconnected(true);
        // Keep stripeAccountData so we can still delete or reconnect
        logger.info('Stripe account disconnected from app');
      } else if (result.error === 'exit_blocked' || result.error === 'check_failed') {
        /*
         * Refused, and the owner is told why in the platform's own dialog
         * rather than left with a button that did nothing. `check_failed`
         * carries no blockers, which is how the dialog tells the two apart.
         */
        setExitBlockers(result.blockers ?? []);
        logger.info({ error: result.error, blockers: result.blockers }, 'Stripe disconnect refused');
      } else {
        logger.error({ error: result.error }, 'Failed to disconnect Stripe');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to disconnect Stripe');
    } finally {
      setStripeLoading(false);
    }
  };

  // Delete: Permanently deletes from Stripe AND our database
  const confirmDeleteStripe = async () => {
    setShowDeleteConfirm(false);
    try {
      setStripeLoading(true);

      // Delete from both Stripe and our database
      const response = await fetch('/api/payments/stripe-connect/delete', {
        method: 'DELETE'
      });

      const result = await response.json();

      if (result.success) {
        setStripeConnected(false);
        setStripeOnboardingPending(false);
        setStripeAccountData(null);
        logger.info('Stripe account permanently deleted');
      } else {
        logger.error({ error: result.error }, 'Failed to delete Stripe account');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to delete Stripe account');
    } finally {
      setStripeLoading(false);
    }
  };

  const handleWizardComplete = () => {
    setShowStripeWizard(false);
    setStripeContinueMode(false);
    checkStripeConnection(); // Refresh connection status
  };

  const handleWizardCancel = () => {
    setShowStripeWizard(false);
    setStripeContinueMode(false);
  };

  /*
   * What this business actually is, read off its own catalogue.
   *
   * The services are already loaded here for the Services tab, so this costs no
   * request — the same rules the readiness card resolves on the server,
   * resolved in the browser from rows already in hand.
   */
  const businessShape = useMemo(() => shapeFromServices(services), [services]);

  /**
   * The tabs this business has any use for.
   *
   * A consultancy that invoices for everything was being shown the Stripe tab
   * and asked to hand over an ID for an account it will never open, while its
   * own readiness card — resolving these very predicates — correctly never
   * mentioned Stripe. One rule now answers both.
   *
   * `hasProcessorAccount` keeps the tab reachable for a business that connected
   * Stripe and has since moved its whole catalogue onto invoices: the tab
   * carrying the disconnect button must not vanish at the moment it becomes the
   * one thing they want it for.
   */
  const shapeTabs = useMemo(
    () =>
      configTabsForShape(businessShape, {
        hasProcessorAccount: stripeConnected || stripeOnboardingPending || stripeDisconnected,
      }),
    [businessShape, stripeConnected, stripeOnboardingPending, stripeDisconnected]
  );

  if (!isOpen) return null;

  const allTabs = [
    { key: 'business' as ConfigTab, label: t('config.tab.business'), icon: Building2 },
    { key: 'services' as ConfigTab, label: t('config.tab.services') || 'Services', icon: Settings },
    { key: 'availability' as ConfigTab, label: t('config.tab.availability') || 'Availability', icon: Clock },
    { key: 'intake' as ConfigTab, label: t('config.tab.intake') || 'Intake Forms', icon: ClipboardList },
    { key: 'payments' as ConfigTab, label: t('config.tab.payments') || 'Payments', icon: CreditCard },
    { key: 'invoice' as ConfigTab, label: t('config.tab.invoice'), icon: FileText },
  ];

  /*
   * `visibleTabs` still wins.
   *
   * It is how a readiness step or a chat command opens ONE tab, and it has to
   * be able to open a tab the shape would otherwise hide — "connect Stripe" is
   * exactly such a step, and it is offered before there is a catalogue to read
   * it off.
   *
   * Otherwise: what the shape says, plus the tab that is open. A tab must never
   * be pulled out from under someone who is standing on it — publishing a
   * product from the Services tab changes the shape, and the tab you are
   * reading should not disappear as a result.
   */
  const tabs = visibleTabs
    ? allTabs.filter(tab => visibleTabs.includes(tab.key))
    : allTabs.filter(
        tab => shapeTabs.includes(tab.key) || tab.key === activeTab || tab.key === initialTab
      );
  const showTabBar = tabs.length > 1;

  // Get the edited service name for the confirmation dialog
  const editedService = editedServiceId ? services.find(s => s.id === editedServiceId) : null;
  /*
   * What the support card says about cards, in one place.
   *
   * Three states, not two: an owner who paused is in a different situation from
   * one Stripe has disabled, and that difference is usually the whole content of
   * the support request. Derived once so the line shown and the line copied
   * cannot drift apart.
   */
  const stripeCardsLabel = stripeAccountData?.paused_at
    ? t('config.stripe.support_paused')
    : stripeAccountData?.charges_enabled
      ? t('config.stripe.support_on')
      : t('config.stripe.support_off');

  const editedServiceName = editedService?.service_name || t('config.service') || 'service';

  return (
    <>
      {/*
        ABOVE the Radix dialog primitive, deliberately.

        This sat at z-50 while `components/ui/dialog` — every Radix dialog in
        the app — sits at z-[60], so configuration opened UNDERNEATH anything
        that had opened it. The invoice gate is where it showed up: press
        "Complete invoice details" and the settings appear behind the very
        dialog that sent you there, with its backdrop over them.

        Not specific to that one caller. Configuration is opened from inside
        dialogs and drawers in several places, and it lost to all of them.

        z-[70] rather than raising the primitive: this is the deeper screen in
        every case — it is only ever reached from something else, never the
        other way round — so it belongs on top, and moving the shared primitive
        instead would drag every unrelated dialog up with it.
      */}
      {/*
        ── SURVIVING A RADIX MODAL ABOVE US ──────────────────────────────────

        This dialog is opened from inside Radix dialogs — the invoice composer,
        the booking modal, the CRM drawer, sometimes two of them nested — and it
        renders OUTSIDE their portals. That costs it two things, and both have to
        be taken back explicitly.

        `pointerEvents: 'auto'`
          A modal Radix dialog has react-remove-scroll put `pointer-events: none`
          on <body>, and this dialog inherits it. Every click was landing on
          nothing: the close button needed pressing twice, then not at all once a
          second modal was in the stack. Raising z-index earlier fixed what could
          be SEEN and not what could be PRESSED, which is why it looked solved.
          This is the line that actually makes it clickable, and it holds however
          many modals are stacked above.

        `onPointerDown` stopping propagation — IN THE BUBBLE PHASE
          Radix listens on the document for a pointer-down outside its content,
          and everything in here is outside every one of them. Without this, one
          click on a settings field dismisses the booking form and the drawer
          behind it — taking the half-typed booking with them.

          This was written as `onPointerDownCapture` and that broke every input
          in the dialog. Capture runs OUTSIDE-IN: a capture handler on this
          container fires before the event reaches whatever was clicked, so
          stopping it here meant no field ever saw its own pointerdown. Buttons
          still worked — `onClick` fires on `click`, not `pointerdown` — so the
          damage showed up only where focus matters: the country combobox in the
          connect wizard rendered its placeholder and could not be typed into.

          Bubble runs inside-out, so the field handles its own event first and
          this stops it on the way past, before it reaches the document. Same
          protection, without taking the dialog's own controls down with it.

        `onWheelCapture` / `onTouchMoveCapture` stopping propagation
          The same library also cancels SCROLLING. It listens for `wheel` and
          `touchmove` on the document and calls preventDefault for anything
          outside the locked subtree — which is everything in here, so the
          invoice tab would not scroll with a mouse at all. Those listeners are
          registered `{ passive: false }` with NO capture, so stopping the event
          before it bubbles to the document is enough: nothing calls
          preventDefault and the browser scrolls this dialog normally.
        ────────────────────────────────────────────────────────────────────── */}
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm"
        style={{ pointerEvents: 'auto' }}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onClick={handleCloseAttempt}
      />

      {/* Dialog */}
      {/*
        ─────────────────────────────────────────────────────────────────────────
        THE BOX THE PANEL IS MEASURED AND CENTRED AGAINST.

        This was `fixed inset-0 … flex items-center justify-center`, and on a
        phone an owner could not reach the fields of any tab — Services is where
        it was reported, because that is the tab you have to type in.

        Every piece was individually right, which is why it took finding. A
        `position: fixed` box with `inset-0` is sized to the LARGE viewport: the
        height the page would have with the address bar collapsed. The panel
        below is correctly capped at `max-h-[100dvh]` — the DYNAMIC viewport,
        what is actually visible. So a correctly-sized panel was being CENTRED
        inside a box taller than the screen, and ended up offset by
        `(100vh - 100dvh) / 2`: the header and the first fields above the top
        edge, the footer below the bottom one.

        Nothing could bring either back. The panel is `overflow-hidden`, this
        container does not scroll, and the only scroll on the services tab
        belongs to the list — which sits inside the region already clipped away.

        Two changes, both mobile-only:

        `inset-x-0 top-0 h-[100dvh]` rather than `inset-0` plus a height. A
        fixed box given `top`, `bottom` AND a height is over-constrained and the
        browser drops one of the three; naming the edges explicitly leaves no
        question about which box the panel resolves against.

        `items-stretch` so the panel fills that box rather than being centred in
        it. The panel already asks for `h-full`, and this dialog is already
        dressed as an edge-to-edge sheet on a phone — `border-0 sm:border`,
        `sm:rounded-…`. Centring something that fills its container achieves
        nothing except leaving room for the offset above.

        From `sm:` up everything is as it was: inset, centred, capped at 95dvh.
        The public booking dialog solved its own version of this; see the note in
        components/website/blocks/BookingModal.tsx about `inset-0` with padding
        keeping a promise that `inset-4` cannot.
        ─────────────────────────────────────────────────────────────────────────
      */}
      <div
        className="fixed inset-x-0 top-0 h-[100dvh] sm:inset-4 sm:top-auto sm:h-auto md:inset-6 lg:inset-8 z-[70] flex items-stretch sm:items-center justify-center p-2 sm:p-0"
        style={{ pointerEvents: 'auto' }}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="w-full h-full max-w-7xl max-h-[100dvh] sm:max-h-[95dvh] md:max-h-[90dvh] bg-[var(--v2-surface)] border-0 sm:border border-[var(--v2-border)] flex flex-col overflow-hidden shadow-2xl sm:rounded-[var(--v2-radius-card)]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 sm:px-4 md:px-6 py-3 sm:py-4 border-b border-[var(--v2-border)]">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div
                className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: `${CONFIG_COLOR}20` }}
              >
                <Settings className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: CONFIG_COLOR }} />
              </div>
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-semibold text-[var(--v2-text-primary)] truncate">
                  {t('config.title') || 'Configuration'}
                </h2>
                <p className="text-xs sm:text-sm text-[var(--v2-text-muted)] hidden sm:block">
                  {t('config.subtitle') || 'Manage your services, availability, and payments'}
                </p>
              </div>
            </div>
            <button
              onClick={handleCloseAttempt}
              className="p-2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-all flex-shrink-0"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Tabs - hidden when only one tab is visible */}
          {showTabBar && (
            <div className="flex items-center gap-1 px-3 sm:px-4 md:px-6 py-2 sm:py-3 border-b border-[var(--v2-border)] bg-[var(--v2-bg)] overflow-x-auto">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-all border whitespace-nowrap ${
                      isActive
                        ? 'border-[#D14E97] bg-[#D14E97]/10'
                        : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)]'
                    }`}
                    style={{
                      borderRadius: 'var(--v2-radius-button)',
                      color: isActive ? CONFIG_COLOR : undefined
                    }}
                  >
                    <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Content.
              `overflow-hidden` for services: that tab manages its own scroll so
              the new-service line can stay pinned below the list. Every other
              tab keeps scrolling here as before. */}
          <TabFooterSlotProvider value={footerSlot}>
          <div
            className={`flex-1 p-3 sm:p-4 md:p-6 ${
              activeTab === 'services'
                ? 'overflow-hidden flex flex-col min-h-0'
                : 'overflow-y-auto scrollbar-thin'
            }`}
          >
            {/* Services Tab */}
            {activeTab === 'business' && <BusinessProfileSection />}

            {activeTab === 'invoice' && (
              /*
               * `chrome={false}`: the tab bar already names this, and the
               * component's own accordion header would be a second title for
               * the same panel.
               *
               * No processor PANEL on the invoice tab.
               *
               * This tab is company and bank details — what goes at the top of
               * an invoice and where the client sends the money. A "Payment
               * Setup Required" notice inside it announced a requirement for
               * the opposite arrangement, on the one screen a business that
               * invoices actually needs. Connecting a card processor is the
               * Payments tab's job, and the shape decides whether that tab is
               * anything to this business at all.
               *
               * The suggestion survives, as one line with a plain no. Taking it
               * moves to the Payments tab — which the tab filter keeps visible
               * for the open tab, so it appears even where the shape would
               * otherwise hide it. Dropped once Stripe is connected: there is
               * nothing left to suggest.
               */
              <InvoiceSettingsSection
                userId={currentUserId}
                chrome={false}
                showProcessor={false}
                onConnectProcessor={stripeConnected ? undefined : () => setActiveTab('payments')}
              />
            )}

            {activeTab === 'services' && (
              loadingServices ? (
                <div className="flex items-center justify-center py-16">
                  <div className="text-center space-y-4">
                    <Loader2
                      className="w-10 h-10 animate-spin mx-auto"
                      style={{ color: CONFIG_COLOR }}
                    />
                    <p className="text-[var(--v2-text-muted)]">{t('common.loading') || 'Loading...'}</p>
                  </div>
                </div>
              ) : (
                <SchedulingServicesList
                  intakeEnabled={intakeEnabled}
                  // This dialog already resolves it for its own Payments tab,
                  // so the services list does not need a second network call to
                  // draw a journey that matches reality.
                  processorReady={stripeConnected}
                  services={services}
                  onServicePublished={silentRefreshServices}
                  onServicePublishedWithId={handleServicePublishedWithId}
                  onSilentRefresh={silentRefreshServices}
                  showAddButton={true}
                  autoStartNewRow={shouldAutoStartNewRow}
                  newRowPrefill={servicePrefill}
                  onAutoStartConsumed={() => setShouldAutoStartNewRow(false)}
                  onServiceCreatedFromChat={servicePrefill ? (service) => {
                    // Call parent callback immediately when service is saved
                    onServiceCreated?.(service);
                  } : undefined}
                  autoEditServiceId={activeServiceToEdit}
                  onAutoEditConsumed={() => setActiveServiceToEdit(undefined)}
                  onServiceEdited={handleServiceEdited}
                />
              )
            )}

            {/* Availability Tab */}
            {activeTab === 'availability' && (
              <div className="space-y-6">
                {/* Calendar Sync Settings */}
                <CalendarSyncSettings />

                {/* Divider */}
                <div className="border-t border-[var(--v2-border)]" />

                {/* Working Hours */}
                <AvailabilityEditor
                  availability={availability}
                  onChange={setAvailability}
                  daysToAdd={availabilityDaysToAdd}
                  /*
                   * The scroll lives here because the layout does.
                   *
                   * `AvailabilityEditor` renders the link only when given this,
                   * so it never points at a section that is not on screen — it
                   * is used in one place today, and a hardcoded element lookup
                   * inside it would become a link to nothing the moment it is
                   * used in another.
                   *
                   * `block: 'nearest'` rather than `'start'`: the tab body is
                   * the scrolling element, and `'start'` drags the section to
                   * the very top, pushing the working hours the owner was just
                   * editing out of view entirely. `'nearest'` brings it just
                   * into frame, so both halves stay visible and the relationship
                   * between them is still legible.
                   */
                  onJumpToTimeOff={() =>
                    timeOffRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                  }
                />

                {/* Divider */}
                <div className="border-t border-[var(--v2-border)]" />

                {/*
                  Time off: the exceptions to the week above.
                  Its own component because it saves its own rows — the weekly
                  hours are one JSON column with one Save button below, and the
                  closed days are rows in their own table with their own create
                  and delete. Sharing a save button would mean one of them saving
                  when the owner pressed the other.
                */}
                {/* Wrapped only to give the link above somewhere to scroll to. */}
                <div ref={timeOffRef} className="scroll-mt-4">
                  <TimeOffEditor />
                </div>
                <TabFooter
                  message={availabilityError ? (
                    <span className="text-sm font-medium text-red-600 dark:text-red-400">
                      {availabilityError}
                    </span>
                  ) : availabilitySaved && (
                    <span className="text-sm font-medium flex items-center gap-1.5" style={{ color: CONFIG_COLOR }}>
                      <Check className="h-4 w-4" />
                      {t('scheduling.availability.saved') || 'Saved'}
                    </span>
                  )}
                >
                  <button
                    onClick={saveAvailability}
                    disabled={savingAvailability}
                    className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium border transition-all disabled:opacity-50"
                    style={{
                      borderRadius: 'var(--v2-radius-button)',
                      color: CONFIG_COLOR,
                      borderColor: CONFIG_COLOR,
                      backgroundColor: `${CONFIG_COLOR}10`
                    }}
                  >
                    {savingAvailability ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('scheduling.availability.saving') || 'Saving...'}
                      </>
                    ) : (
                      t('scheduling.availability.save') || 'Save Availability'
                    )}
                  </button>
                </TabFooter>
              </div>
            )}

            {/* Intake Tab */}
            {activeTab === 'intake' && (
              <IntakeSettingsPanel onSaved={refreshIntakeEnabled} />
            )}

            {/* Payments Tab */}
            {activeTab === 'payments' && (
              <div className="space-y-6">
                {/* Show embedded onboarding for continue flow */}
                {showEmbeddedOnboarding ? (
                  <div
                    className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-6"
                    style={{ borderRadius: 'var(--v2-radius-card)' }}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                        {t('payments.stripe.embedded.title') || 'Complete Payment Setup'}
                      </h3>
                      <button
                        onClick={handleEmbeddedOnboardingExit}
                        className="text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <StripeEmbeddedOnboarding
                      onComplete={handleEmbeddedOnboardingComplete}
                      onExit={handleEmbeddedOnboardingExit}
                    />
                  </div>
                ) : showStripeWizard ? (
                  <StripeConnectWizard
                    onComplete={handleWizardComplete}
                    onCancel={handleWizardCancel}
                    continueOnboarding={stripeContinueMode}
                    existingAccount={stripeAccountData || undefined}
                  />
                ) : (
                  <>
                    {/* Stripe Connection Card */}
                    <div
                      className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-6"
                      style={{ borderRadius: 'var(--v2-radius-card)' }}
                      dir={isRTL ? 'rtl' : 'ltr'}
                    >
                      <div className="flex items-start gap-4">
                        <div
                          className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${CONFIG_COLOR}20` }}
                        >
                          <CreditCard
                            className="w-6 h-6"
                            style={{ color: CONFIG_COLOR }}
                          />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">
                            {t('config.stripe.title') || 'Stripe Payments'}
                          </h3>
                          <p className="text-sm text-[var(--v2-text-muted)] mt-1">
                            {stripeConnected
                              ? (t('config.stripe.connected_desc') || 'Your Stripe account is connected. You can accept payments for your services.')
                              : stripeOnboardingPending
                                ? (t('config.stripe.setup_incomplete_desc') || 'Your Stripe account was created but setup is incomplete. Complete the setup to start accepting payments.')
                                : stripeDisconnected
                                  ? (t('config.stripe.disconnected_desc') || 'Your Stripe account is disconnected. Reconnect to resume accepting payments, or delete the account to start fresh.')
                                  : (t('config.stripe.not_connected_desc') || 'Connect your Stripe account to accept payments for bookings and services.')
                            }
                          </p>

                          {stripeLoading ? (
                            <div className="flex items-center gap-2 mt-4">
                              <Loader2 className="h-4 w-4 animate-spin text-[var(--v2-text-muted)]" />
                              <span className="text-sm text-[var(--v2-text-muted)]">
                                {t('common.loading') || 'Checking status...'}
                              </span>
                            </div>
                          ) : stripeConnected ? (
                            <div className="flex items-center gap-3 mt-4 flex-wrap">
                              <span
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full"
                                style={{ backgroundColor: `${CONFIG_COLOR}20`, color: CONFIG_COLOR }}
                              >
                                <Check className="h-4 w-4" />
                                {t('config.stripe.connected') || 'Connected'}
                              </span>
                              <button
                                onClick={handleDisconnectStripe}
                                className="text-sm text-[var(--v2-text-muted)] hover:text-amber-500 transition-colors"
                              >
                                {t('config.stripe.disconnect') || 'Disconnect'}
                              </button>
                              <button
                                onClick={handleDeleteStripe}
                                className="text-sm text-[var(--v2-text-muted)] hover:text-red-500 transition-colors"
                              >
                                {t('config.stripe.delete_account') || 'Delete Account'}
                              </button>
                            </div>
                          ) : stripeOnboardingPending ? (
                            <div className="flex items-center gap-3 mt-4 flex-wrap">
                              <span
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full"
                                style={{ backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#3B82F6' }}
                              >
                                <Clock className="h-4 w-4" />
                                {t('config.stripe.setup_incomplete') || 'Setup Incomplete'}
                              </span>
                              <button
                                onClick={handleContinueOnboarding}
                                disabled={stripeLoading}
                                className={`inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium text-white transition-all hover:opacity-90 disabled:opacity-50 ${isRTL ? 'flex-row-reverse' : ''}`}
                                style={{
                                  borderRadius: 'var(--v2-radius-button)',
                                  backgroundColor: '#3B82F6'
                                }}
                                dir={isRTL ? 'rtl' : 'ltr'}
                              >
                                {stripeLoading ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <CreditCard className="h-4 w-4" />
                                )}
                                {t('config.stripe.continue_setup') || 'Continue Setup'}
                              </button>
                              <button
                                onClick={handleDisconnectStripe}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-600 border border-amber-200 hover:bg-amber-50 dark:border-amber-800 dark:hover:bg-amber-900/20 transition-colors"
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                              >
                                {t('config.stripe.disconnect') || 'Disconnect'}
                              </button>
                              <button
                                onClick={handleDeleteStripe}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-500 border border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20 transition-colors"
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                              >
                                {t('config.stripe.delete_account') || 'Delete Account'}
                              </button>
                            </div>
                          ) : stripeDisconnected ? (
                            <div className="flex items-center gap-3 mt-4 flex-wrap">
                              <span
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full"
                                style={{ backgroundColor: 'rgba(107, 114, 128, 0.15)', color: '#6B7280' }}
                              >
                                <CreditCard className="h-4 w-4" />
                                {t('config.stripe.disconnected') || 'Disconnected'}
                              </span>
                              <button
                                onClick={handleContinueOnboarding}
                                disabled={stripeLoading}
                                className={`inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium text-white transition-all hover:opacity-90 disabled:opacity-50 ${isRTL ? 'flex-row-reverse' : ''}`}
                                style={{
                                  borderRadius: 'var(--v2-radius-button)',
                                  backgroundColor: CONFIG_COLOR
                                }}
                                dir={isRTL ? 'rtl' : 'ltr'}
                              >
                                {stripeLoading ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <CreditCard className="h-4 w-4" />
                                )}
                                {t('config.stripe.reconnect') || 'Reconnect'}
                              </button>
                              <button
                                onClick={handleDeleteStripe}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-500 border border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20 transition-colors"
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                              >
                                {t('config.stripe.delete_account') || 'Delete Account'}
                              </button>
                            </div>
                          ) : (
                            <div className="mt-4 flex flex-wrap gap-3" dir="ltr">
                              <button
                                onClick={handleConnectStripe}
                                className={`inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white transition-all hover:opacity-90 ${isRTL ? 'flex-row-reverse' : ''}`}
                                style={{
                                  borderRadius: 'var(--v2-radius-button)',
                                  backgroundColor: CONFIG_COLOR
                                }}
                                dir={isRTL ? 'rtl' : 'ltr'}
                              >
                                <CreditCard className="h-4 w-4" />
                                {t('config.stripe.connect') || 'Connect Stripe'}
                              </button>
                              {/* Show Delete if we have account data but no active state */}
                              {stripeAccountData && (
                                <button
                                  onClick={handleDeleteStripe}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-500 border border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20 transition-colors"
                                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                                >
                                  {t('config.stripe.delete_account') || 'Delete Account'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/*
                      CONNECTION DETAILS, FOR WHEN IT IS NOT WORKING.
                      ───────────────────────────────────────────────────────
                      An owner whose payments have stopped has no way to tell us
                      WHICH connection is broken: the account id lives in a table
                      they cannot see, and "Stripe isn't working" is the whole of
                      what support receives. This is the four facts that actually
                      identify the problem, in one copyable block.

                      NOTHING SENSITIVE. The account id, the email on the Stripe
                      account, the country, and three booleans. No keys, no card
                      data, no bank details — a support request is forwarded and
                      pasted, so it must stay safe to paste.

                      Shown whenever an account exists, including a paused one:
                      paused is exactly the state somebody writes in about.
                    */}
                    {stripeAccountData && (
                      <div
                        className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-6"
                        style={{ borderRadius: 'var(--v2-radius-card)' }}
                        dir={isRTL ? 'rtl' : 'ltr'}
                      >
                        {/*
                          The wrapping was the 65ch cap, not the button.
                          ───────────────────────────────────────────────────
                          `max-w-prose` is about 65 characters, and Hebrew
                          characters are narrower than the `0` that unit is
                          measured from — so inside a column the Copy button had
                          already narrowed, a sentence that fits on two lines
                          broke into four. The cap is gone; the button stays
                          beside the heading where it was, shrink-proof, and the
                          text now uses whatever width is left.
                        */}
                        {/* Headed like its siblings in this tab: the same icon
                            circle, the same `h3` at `text-base`, the same muted
                            paragraph. It read as a lesser thing with its own
                            smaller heading, which is not what it is. */}
                        <div className="flex items-start gap-4 mb-3">
                          <div
                            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: `${CONFIG_COLOR}20` }}
                          >
                            {/* The connection itself, not a help desk. The card
                                is this account's identity: its id, its type, and
                                whether it can charge. `LifeBuoy` said "support",
                                which is where the details go, not what they are. */}
                            <Link2 className="w-5 h-5" style={{ color: CONFIG_COLOR }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-2">
                              {t('config.stripe.support_title')}
                            </h3>
                            <p className="text-sm text-[var(--v2-text-muted)]">
                              {t('config.stripe.support_help')}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              const lines = [
                                `${t('config.stripe.support_account')}: ${stripeAccountData.stripe_account_id}`,
                                stripeAccountData.stripe_email ? `Email: ${stripeAccountData.stripe_email}` : null,
                                stripeAccountData.country ? `Country: ${stripeAccountData.country}` : null,
                                `${t('config.stripe.support_cards')}: ${stripeCardsLabel}`,
                                `${t('config.stripe.support_payouts')}: ${stripeAccountData.payouts_enabled ? t('config.stripe.support_on') : t('config.stripe.support_off')}`,
                                stripeAccountData.stripe_account_type ? `${t('config.stripe.support_type')}: ${stripeAccountData.stripe_account_type}` : null,
                                stripeAccountData.details_submitted === false ? t('config.stripe.support_setup') : null,
                                stripeAccountData.updated_at ? `${t('config.stripe.support_checked')}: ${String(stripeAccountData.updated_at).slice(0, 16).replace('T', ' ')}` : null,
                                // The finding goes in the copied text too, or it
                                // never reaches the person who needs it.
                                stripeAccountData.has_oauth_connection ? t('config.stripe.support_two_links') : null,
                              ].filter(Boolean);
                              navigator.clipboard?.writeText(lines.join('\n'));
                              setSupportCopied(true);
                              window.setTimeout(() => setSupportCopied(false), 2000);
                            }}
                            className="flex-shrink-0 px-3 py-1.5 text-xs font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)] transition-all"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            {supportCopied ? t('config.stripe.support_copied') : t('config.stripe.support_copy')}
                          </button>
                        </div>

                        {/* `ms-14` clears the icon gutter (w-10 + gap-4), so
                            the details line up under the heading rather than
                            starting back at the card edge. Logical margin, so
                            it holds in both directions. */}
                        <dl className="ms-14 flex flex-col gap-1.5 text-xs">
                          <div className="flex items-baseline gap-2">
                            <dt className="text-[var(--v2-text-muted)] min-w-[7rem]">
                              {t('config.stripe.support_account')}
                            </dt>
                            {/* `bdi` and `ltr`: an id like acct_1SM… is Latin text
                                inside a Hebrew panel, and bidi would otherwise
                                reorder it into something uncopyable. */}
                            <dd className="font-mono text-[var(--v2-text-primary)] break-all">
                              <bdi dir="ltr">{stripeAccountData.stripe_account_id}</bdi>
                            </dd>
                          </div>
                          {stripeAccountData.stripe_email && (
                            <div className="flex items-baseline gap-2">
                              <dt className="text-[var(--v2-text-muted)] min-w-[7rem]">Email</dt>
                              <dd className="text-[var(--v2-text-primary)] break-all">
                                <bdi dir="ltr">{stripeAccountData.stripe_email}</bdi>
                              </dd>
                            </div>
                          )}
                          <div className="flex items-baseline gap-2">
                            <dt className="text-[var(--v2-text-muted)] min-w-[7rem]">
                              {t('config.stripe.support_cards')}
                            </dt>
                            <dd className="text-[var(--v2-text-primary)]">{stripeCardsLabel}</dd>
                          </div>
                          <div className="flex items-baseline gap-2">
                            <dt className="text-[var(--v2-text-muted)] min-w-[7rem]">
                              {t('config.stripe.support_payouts')}
                            </dt>
                            <dd className="text-[var(--v2-text-primary)]">
                              {stripeAccountData.payouts_enabled
                                ? t('config.stripe.support_on')
                                : t('config.stripe.support_off')}
                            </dd>
                          </div>
                          {stripeAccountData.stripe_account_type && (
                            <div className="flex items-baseline gap-2">
                              <dt className="text-[var(--v2-text-muted)] min-w-[7rem]">
                                {t('config.stripe.support_type')}
                              </dt>
                              <dd className="text-[var(--v2-text-primary)]">
                                <bdi dir="ltr">{stripeAccountData.stripe_account_type}</bdi>
                              </dd>
                            </div>
                          )}
                          {/* Only when it explains something. A finished account
                              does not need a line saying setup is finished. */}
                          {stripeAccountData.details_submitted === false && (
                            <div className="flex items-baseline gap-2">
                              <dt className="text-[var(--v2-text-muted)] min-w-[7rem]" />
                              <dd className="text-amber-600 dark:text-amber-400">
                                {t('config.stripe.support_setup')}
                              </dd>
                            </div>
                          )}
                          {stripeAccountData.updated_at && (
                            <div className="flex items-baseline gap-2">
                              <dt className="text-[var(--v2-text-muted)] min-w-[7rem]">
                                {t('config.stripe.support_checked')}
                              </dt>
                              <dd className="text-[var(--v2-text-muted)] tabular-nums">
                                <bdi dir="ltr">{String(stripeAccountData.updated_at).slice(0, 16).replace('T', ' ')}</bdi>
                              </dd>
                            </div>
                          )}
                        </dl>

                        {/*
                          LINKED TWICE. The one line here that is a finding
                          rather than a fact: payments and refunds can land on
                          different accounts, and nothing else in the product
                          says so. Amber, because it is worth reading before
                          anyone writes to support about a failing refund.
                        */}
                        {stripeAccountData.has_oauth_connection && (
                          <p
                            className="ms-14 mt-3 px-3 py-2 text-xs leading-relaxed"
                            style={{ borderRadius: '10px', background: 'rgba(217,119,6,0.08)', color: '#8A5B12' }}
                          >
                            {t('config.stripe.support_two_links')}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Payment Settings Info */}
                    {stripeConnected && (
                      <div
                        className="bg-[var(--v2-bg)] border border-[var(--v2-border)] p-6"
                        style={{ borderRadius: 'var(--v2-radius-card)' }}
                        dir={isRTL ? 'rtl' : 'ltr'}
                      >
                        <div className="flex items-start gap-4">
                          <div
                            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: `${CONFIG_COLOR}20` }}
                          >
                            <Settings className="w-5 h-5" style={{ color: CONFIG_COLOR }} />
                          </div>
                          <div className="flex-1">
                            <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-2">
                              {t('config.payments.settings_title') || 'Payment Settings'}
                            </h3>
                            <p className="text-sm text-[var(--v2-text-muted)]">
                              {t('config.payments.settings_desc') || 'Payment options are configured per service. Edit a service to set its price and payment plan options.'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <TabFooterSlot hostRef={setFooterSlot} />
          </TabFooterSlotProvider>

        </div>
      </div>

      {/*
        z-[80], above this dialog's own z-[70].

        These three confirmations are rendered BY the configuration dialog and
        sit on top of it. They were z-[60] back when their parent was z-50;
        raising the parent above the Radix primitive without bringing them along
        would have put each one behind the screen that opened it — including the
        close confirmation, which would have been unreachable.
      */}
      {/* Stripe Disconnect Confirmation Dialog (Soft - keeps Stripe account) */}
      {showDisconnectConfirm && (
        <>
          <div
            className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm"
            style={{ pointerEvents: 'auto' }}
            onClick={() => setShowDisconnectConfirm(false)}
          />
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center p-4"
            style={{ pointerEvents: 'auto' }}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            <div
              className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6 max-w-md w-full shadow-2xl"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
              onClick={(e) => e.stopPropagation()}
              dir={isRTL ? 'rtl' : 'ltr'}
            >
              <div className="flex items-start gap-4">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)' }}
                >
                  <CreditCard className="w-5 h-5 text-amber-500" />
                </div>
                <div className="flex-1">
                  {/* The heading follows the state. "Disconnect Stripe?" is a
                      question, and a blocked screen is not asking one: it is
                      telling the owner the answer is no, and why. */}
                  <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-1">
                    {exitBlockers && exitBlockers.length > 0
                      ? t('config.stripe.blocked_title')
                      : t('config.stripe.disconnect_title') || 'Disconnect Stripe?'}
                  </h3>
                  {/*
                    THE DIALOG ANSWERS ITS OWN QUESTION.
                    ─────────────────────────────────────────────────────────
                    Three states, and each needs different words:

                      checking   we are asking. The action waits.
                      blocked    these are in the way; the action is disabled
                                 and the owner is told what to do first.
                      clear      what disconnecting will actually do.

                    "We could not look" is an empty blockers array, which is NOT
                    the same as "nothing is blocking" — it gets its own line and
                    leaves the action enabled, because the POST applies the same
                    rule and will refuse on its own if it has to.
                  */}
                  {checkingExit ? (
                    <p className="text-sm text-[var(--v2-text-muted)]">
                      {t('common.loading') || '…'}
                    </p>
                  ) : exitBlockers && exitBlockers.length > 0 ? (
                    <>
                      <p className="text-sm text-[var(--v2-text-muted)]">
                        {t('config.stripe.blocked_intro')}
                      </p>
                      <ul className="mt-3 flex flex-col gap-1.5">
                        {exitBlockers.map(blocker => (
                          <li
                            key={blocker.code}
                            className="flex items-center gap-2 text-sm text-[var(--v2-text-primary)]"
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                            <bdi>
                              {t(
                                blocker.code === 'client_plans_running'
                                  ? 'config.stripe.blocked_plans'
                                  : 'config.stripe.blocked_invoices'
                              ).replace('{n}', String(blocker.count))}
                            </bdi>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : exitBlockers && exitBlockers.length === 0 ? (
                    <p className="text-sm text-[var(--v2-text-muted)]">
                      {t('config.stripe.blocked_check_failed')}
                    </p>
                  ) : (
                    <p className="text-sm text-[var(--v2-text-muted)]">
                      {t('config.stripe.disconnect_message')}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 mt-6 justify-end">
                <button
                  onClick={() => setShowDisconnectConfirm(false)}
                  className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-all"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {t('common.cancel') || 'Cancel'}
                </button>
                {/* Disabled while we are still asking, and whenever something
                    is in the way. Never offered as a press that will fail. */}
                <button
                  onClick={confirmDisconnectStripe}
                  disabled={checkingExit || Boolean(exitBlockers && exitBlockers.length > 0)}
                  className="px-4 py-2 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-amber-500"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {t('config.stripe.disconnect') || 'Disconnect'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Stripe Delete Confirmation Dialog (Permanent - deletes Stripe account) */}
      {showDeleteConfirm && (
        <>
          <div
            className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm"
            style={{ pointerEvents: 'auto' }}
            onClick={() => setShowDeleteConfirm(false)}
          />
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center p-4"
            style={{ pointerEvents: 'auto' }}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            <div
              className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6 max-w-md w-full shadow-2xl"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
              onClick={(e) => e.stopPropagation()}
              dir={isRTL ? 'rtl' : 'ltr'}
            >
              <div className="flex items-start gap-4">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)' }}
                >
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                </div>
                <div className="flex-1">
                  {/* Same three states as the disconnect dialog, and for the
                      stronger reason: after a removal the account is gone from
                      us, so a plan still charging on it becomes money arriving
                      with nothing on our side to reconcile it against. */}
                  <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-1">
                    {exitBlockers && exitBlockers.length > 0
                      ? t('config.stripe.blocked_title')
                      : t('config.stripe.delete_title') || 'Delete Stripe Account?'}
                  </h3>
                  {checkingExit ? (
                    <p className="text-sm text-[var(--v2-text-muted)]">
                      {t('common.loading') || '…'}
                    </p>
                  ) : exitBlockers && exitBlockers.length > 0 ? (
                    <>
                      <p className="text-sm text-[var(--v2-text-muted)]">
                        {t('config.stripe.blocked_intro')}
                      </p>
                      <ul className="mt-3 flex flex-col gap-1.5">
                        {exitBlockers.map(blocker => (
                          <li
                            key={blocker.code}
                            className="flex items-center gap-2 text-sm text-[var(--v2-text-primary)]"
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                            <bdi>
                              {t(
                                blocker.code === 'client_plans_running'
                                  ? 'config.stripe.blocked_plans'
                                  : 'config.stripe.blocked_invoices'
                              ).replace('{n}', String(blocker.count))}
                            </bdi>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : exitBlockers && exitBlockers.length === 0 ? (
                    <p className="text-sm text-[var(--v2-text-muted)]">
                      {t('config.stripe.blocked_check_failed')}
                    </p>
                  ) : (
                    <p className="text-sm text-[var(--v2-text-muted)]">
                      {t('config.stripe.delete_message') || 'This will permanently delete your Stripe account. All payment history and settings will be lost. This action cannot be undone.'}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 mt-6 justify-end">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-all"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {t('common.cancel') || 'Cancel'}
                </button>
                <button
                  onClick={confirmDeleteStripe}
                  disabled={checkingExit || Boolean(exitBlockers && exitBlockers.length > 0)}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-500"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {t('config.stripe.delete_account') || 'Delete Account'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Close Confirmation Dialog */}
      {showCloseConfirm && (
        <>
          <div
            className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm"
            style={{ pointerEvents: 'auto' }}
            onClick={() => setShowCloseConfirm(false)}
          />
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center p-4"
            style={{ pointerEvents: 'auto' }}
            onPointerDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            <div
              className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6 max-w-md w-full shadow-2xl"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
              onClick={(e) => e.stopPropagation()}
              dir={isRTL ? 'rtl' : 'ltr'}
            >
              <div className="flex items-start gap-4">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)' }}
                >
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-1">
                    {t('config.close.unpublished_title') || 'Unpublished Changes'}
                  </h3>
                  <p className="text-sm text-[var(--v2-text-muted)]">
                    {t('config.close.unpublished_message', { name: editedServiceName }) ||
                      `"${editedServiceName}" was edited but not published. Your changes won't be visible to clients until you publish.`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-6 justify-end">
                <button
                  onClick={() => setShowCloseConfirm(false)}
                  className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-all"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {t('config.close.back') || 'Go Back'}
                </button>
                <button
                  onClick={handleForceClose}
                  className="px-4 py-2 text-sm font-medium text-white transition-all"
                  style={{
                    borderRadius: 'var(--v2-radius-button)',
                    backgroundColor: CONFIG_COLOR
                  }}
                >
                  {t('config.close.anyway') || 'Close Anyway'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
