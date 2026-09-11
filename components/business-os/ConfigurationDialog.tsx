'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/UserProvider';
import { intakeReachesClient } from '@/lib/business-os/intakeReach';
import { X, Settings, Clock, CreditCard, Loader2, Check, AlertTriangle, ClipboardList, Sparkles, Building2, FileText } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { SchedulingServicesList } from '@/components/scheduling/SchedulingServicesList';
import { AvailabilityEditor, DEFAULT_AVAILABILITY, parseAvailability, type WeeklyAvailability } from '@/components/scheduling/AvailabilityEditor';
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
  } | null>(null);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
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
        setAvailabilitySaved(true);
        setTimeout(() => setAvailabilitySaved(false), 3000);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to save availability');
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
      const stripeAccountDisconnected = hasStripeAccountData && chargesEnabled === false && !detailsSubmitted;
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

  const handleDisconnectStripe = () => {
    setShowDisconnectConfirm(true);
  };

  const handleDeleteStripe = () => {
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

  if (!isOpen) return null;

  const allTabs = [
    { key: 'business' as ConfigTab, label: t('config.tab.business'), icon: Building2 },
    { key: 'services' as ConfigTab, label: t('config.tab.services') || 'Services', icon: Settings },
    { key: 'availability' as ConfigTab, label: t('config.tab.availability') || 'Availability', icon: Clock },
    { key: 'intake' as ConfigTab, label: t('config.tab.intake') || 'Intake Forms', icon: ClipboardList },
    { key: 'payments' as ConfigTab, label: t('config.tab.payments') || 'Payments', icon: CreditCard },
    { key: 'invoice' as ConfigTab, label: t('config.tab.invoice'), icon: FileText },
  ];

  // Filter tabs if visibleTabs is specified
  const tabs = visibleTabs ? allTabs.filter(tab => visibleTabs.includes(tab.key)) : allTabs;
  const showTabBar = tabs.length > 1;

  // Get the edited service name for the confirmation dialog
  const editedService = editedServiceId ? services.find(s => s.id === editedServiceId) : null;
  const editedServiceName = editedService?.service_name || t('config.service') || 'service';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={handleCloseAttempt}
      />

      {/* Dialog */}
      <div
        className="fixed inset-0 sm:inset-4 md:inset-6 lg:inset-8 z-50 flex items-center justify-center p-2 sm:p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="w-full h-full max-w-7xl max-h-[100vh] sm:max-h-[95vh] md:max-h-[90vh] bg-[var(--v2-surface)] border-0 sm:border border-[var(--v2-border)] flex flex-col overflow-hidden shadow-2xl sm:rounded-[var(--v2-radius-card)]"
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
              activeTab === 'services' ? 'overflow-hidden flex flex-col min-h-0' : 'overflow-y-auto'
            }`}
          >
            {/* Services Tab */}
            {activeTab === 'business' && <BusinessProfileSection />}

            {activeTab === 'invoice' && (
              /*
               * `chrome={false}`: the tab bar already names this, and the
               * component's own accordion header would be a second title for
               * the same panel.
               */
              <InvoiceSettingsSection userId={currentUserId} chrome={false} />
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
                />
                <TabFooter
                  message={availabilitySaved && (
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

      {/* Stripe Disconnect Confirmation Dialog (Soft - keeps Stripe account) */}
      {showDisconnectConfirm && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            onClick={() => setShowDisconnectConfirm(false)}
          />
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
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
                  <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-1">
                    {t('config.stripe.disconnect_title') || 'Disconnect Stripe?'}
                  </h3>
                  <p className="text-sm text-[var(--v2-text-muted)]">
                    {t('config.stripe.disconnect_message') || 'You will no longer be able to accept payments until you reconnect. Your Stripe account will remain active and can be reconnected later.'}
                  </p>
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
                <button
                  onClick={confirmDisconnectStripe}
                  className="px-4 py-2 text-sm font-medium text-white bg-amber-500 hover:bg-amber-600 transition-all"
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
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            onClick={() => setShowDeleteConfirm(false)}
          />
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
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
                  <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-1">
                    {t('config.stripe.delete_title') || 'Delete Stripe Account?'}
                  </h3>
                  <p className="text-sm text-[var(--v2-text-muted)]">
                    {t('config.stripe.delete_message') || 'This will permanently delete your Stripe account. All payment history and settings will be lost. This action cannot be undone.'}
                  </p>
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
                  className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-all"
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
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            onClick={() => setShowCloseConfirm(false)}
          />
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
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
