'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Settings, Clock, CreditCard, Loader2, Check, AlertTriangle, ClipboardList } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { SchedulingServicesList } from '@/components/scheduling/SchedulingServicesList';
import { AvailabilityEditor, DEFAULT_AVAILABILITY, parseAvailability, type WeeklyAvailability } from '@/components/scheduling/AvailabilityEditor';
import { IntakeSettingsPanel } from '@/components/scheduling/IntakeSettingsPanel';
import { CalendarSyncSettings } from '@/components/scheduling/CalendarSyncSettings';
import { createLogger } from '@/lib/logger';
import type { SchedulingService } from '@/lib/repositories/SchedulingRepository';

const logger = createLogger({ module: 'ConfigurationDialog' });

// Configuration theme color: Pink (#D14E97)
const CONFIG_COLOR = '#D14E97';

type ConfigTab = 'services' | 'availability' | 'intake' | 'payments';

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
}

export function ConfigurationDialog({ isOpen, onClose, initialTab, serviceToEdit, visibleTabs, servicePrefill, availabilityDaysToAdd, onServiceCreated, onCloseWithUnpublished, onServicePublished }: ConfigurationDialogProps) {
  const { t, isRTL } = useLanguage();
  const [activeTab, setActiveTab] = useState<ConfigTab>(initialTab || 'services');

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
  const [stripeLoading, setStripeLoading] = useState(true);

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
      checkStripeConnection();
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
  }, []);

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
    // Refresh services list to get updated status
    fetchServices();
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

  const checkStripeConnection = async () => {
    try {
      setStripeLoading(true);
      const response = await fetch('/api/payments/stripe/status');
      const data = await response.json();
      setStripeConnected(data.connected || false);
    } catch (error) {
      logger.error({ err: error }, 'Failed to check Stripe status');
      setStripeConnected(false);
    } finally {
      setStripeLoading(false);
    }
  };

  const handleConnectStripe = async () => {
    try {
      const response = await fetch('/api/payments/stripe/connect', {
        method: 'POST'
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to initiate Stripe connection');
    }
  };

  if (!isOpen) return null;

  const allTabs = [
    { key: 'services' as ConfigTab, label: t('config.tab.services') || 'Services', icon: Settings },
    { key: 'availability' as ConfigTab, label: t('config.tab.availability') || 'Availability', icon: Clock },
    { key: 'intake' as ConfigTab, label: t('config.tab.intake') || 'Intake Forms', icon: ClipboardList },
    { key: 'payments' as ConfigTab, label: t('config.tab.payments') || 'Payments', icon: CreditCard },
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
        className="fixed inset-4 sm:inset-6 md:inset-8 z-50 flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="w-full h-full max-w-7xl max-h-[90vh] bg-[var(--v2-surface)] border border-[var(--v2-border)] flex flex-col overflow-hidden shadow-2xl"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--v2-border)]">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${CONFIG_COLOR}20` }}
              >
                <Settings className="w-5 h-5" style={{ color: CONFIG_COLOR }} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                  {t('config.title') || 'Configuration'}
                </h2>
                <p className="text-sm text-[var(--v2-text-muted)]">
                  {t('config.subtitle') || 'Manage your services, availability, and payments'}
                </p>
              </div>
            </div>
            <button
              onClick={handleCloseAttempt}
              className="p-2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Tabs - hidden when only one tab is visible */}
          {showTabBar && (
            <div className="flex items-center gap-1 px-6 py-3 border-b border-[var(--v2-border)] bg-[var(--v2-bg)]">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all border ${
                      isActive
                        ? 'border-[#D14E97] bg-[#D14E97]/10'
                        : 'text-[var(--v2-text-secondary)] border-transparent hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-surface)]'
                    }`}
                    style={{
                      borderRadius: 'var(--v2-radius-button)',
                      color: isActive ? CONFIG_COLOR : undefined
                    }}
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Services Tab */}
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
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--v2-border)]">
                  {availabilitySaved && (
                    <span className="text-sm font-medium flex items-center gap-1.5" style={{ color: CONFIG_COLOR }}>
                      <Check className="h-4 w-4" />
                      {t('scheduling.availability.saved') || 'Saved'}
                    </span>
                  )}
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
                </div>
              </div>
            )}

            {/* Intake Tab */}
            {activeTab === 'intake' && (
              <IntakeSettingsPanel />
            )}

            {/* Payments Tab */}
            {activeTab === 'payments' && (
              <div className="space-y-6">
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
                        <div className="flex items-center gap-3 mt-4">
                          <span
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-full"
                            style={{ backgroundColor: `${CONFIG_COLOR}20`, color: CONFIG_COLOR }}
                          >
                            <Check className="h-4 w-4" />
                            {t('config.stripe.connected') || 'Connected'}
                          </span>
                          <button
                            onClick={handleConnectStripe}
                            className="text-sm hover:opacity-80 underline"
                            style={{ color: CONFIG_COLOR }}
                          >
                            {t('config.stripe.manage') || 'Manage account'}
                          </button>
                        </div>
                      ) : (
                        <div className="mt-4 flex" dir="ltr">
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
              </div>
            )}
          </div>
        </div>
      </div>

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
