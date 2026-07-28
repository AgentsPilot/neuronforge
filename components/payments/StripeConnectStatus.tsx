'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createLogger } from '@/lib/logger';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { Sparkles, CreditCard, Loader2, CheckCircle2, AlertCircle, Clock, ExternalLink } from 'lucide-react';

const logger = createLogger({ module: 'StripeConnectStatus' });

interface StripeConnectAccount {
  id: string;
  stripe_account_id: string;
  stripe_account_type: 'express' | 'standard';
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  onboarding_completed: boolean;
  country?: string;
  currency: string;
}

interface Props {
  detailed?: boolean;
  onStatusChange?: () => void;
}

export function StripeConnectStatus({ detailed = false, onStatusChange }: Props) {
  const { t, isRTL } = useLanguage();
  const [account, setAccount] = useState<StripeConnectAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [showOptionsDialog, setShowOptionsDialog] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchStripeAccount();

    // Check URL params for setup status feedback
    const params = new URLSearchParams(window.location.search);
    const setup = params.get('setup');
    if (setup) {
      // Clear the URL params
      window.history.replaceState({}, '', window.location.pathname);
      // Refresh account status
      fetchStripeAccount();
    }
  }, []);

  const fetchStripeAccount = async () => {
    try {
      const response = await fetch('/api/payments/stripe-connect');
      const result = await response.json();

      if (result.success && result.data) {
        setAccount(result.data);
      } else {
        setAccount(null);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch Stripe account');
    } finally {
      setLoading(false);
    }
  };

  const handleNewToPayments = async () => {
    setConnecting(true);
    try {
      const response = await fetch('/api/payments/stripe-connect/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_type: 'express' }),
      });
      const result = await response.json();

      if (result.success && result.onboardingUrl) {
        window.location.href = result.onboardingUrl;
      } else {
        logger.error({ error: result.error }, 'Failed to create Stripe account');
        alert(result.error || 'Failed to start setup. Please try again.');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to create Stripe account');
      alert('Something went wrong. Please try again.');
    } finally {
      setConnecting(false);
      setShowOptionsDialog(false);
    }
  };

  const handleExistingAccount = async () => {
    setConnecting(true);
    try {
      const response = await fetch('/api/payments/stripe-connect/oauth-link');
      const result = await response.json();

      if (result.success && result.oauthUrl) {
        window.location.href = result.oauthUrl;
      } else {
        logger.error({ error: result.error }, 'Failed to generate OAuth link');
        alert(result.error || 'Failed to connect. Please try again.');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to generate OAuth link');
      alert('Something went wrong. Please try again.');
    } finally {
      setConnecting(false);
      setShowOptionsDialog(false);
    }
  };

  const handleContinueSetup = async () => {
    setConnecting(true);
    try {
      const response = await fetch('/api/payments/stripe-connect/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_type: 'express', continue_setup: true }),
      });
      const result = await response.json();

      if (result.success && result.onboardingUrl) {
        window.location.href = result.onboardingUrl;
      } else {
        logger.error({ error: result.error }, 'Failed to continue setup');
        alert(result.error || 'Failed to continue setup. Please try again.');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to continue setup');
      alert('Something went wrong. Please try again.');
    } finally {
      setConnecting(false);
    }
  };

  const handleManageAccount = async () => {
    try {
      const response = await fetch('/api/payments/stripe-connect/dashboard-link');
      const result = await response.json();

      if (result.success && result.dashboardUrl) {
        window.open(result.dashboardUrl, '_blank');
      } else {
        logger.error({ error: result.error }, 'Failed to get dashboard link');
        alert(result.error || 'Failed to open dashboard. Please try again.');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to get dashboard link');
      alert('Something went wrong. Please try again.');
    }
  };

  const handleRefreshStatus = async () => {
    setRefreshing(true);
    try {
      const response = await fetch('/api/payments/stripe-connect/refresh-status', {
        method: 'POST',
      });
      const result = await response.json();

      if (result.success) {
        await fetchStripeAccount();
        onStatusChange?.();
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to refresh status');
    } finally {
      setRefreshing(false);
    }
  };

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

  // Not connected - show setup prompt
  if (!account) {
    return (
      <>
        <div
          className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
          dir={isRTL ? 'rtl' : 'ltr'}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                <h3 className="font-semibold text-amber-900 dark:text-amber-100">
                  {t('payments.stripe.not_connected')}
                </h3>
              </div>
              <p className="text-sm text-amber-800 dark:text-amber-200 mt-1">
                {t('payments.stripe.not_connected_desc')}
              </p>
            </div>
            <Button
              onClick={() => setShowOptionsDialog(true)}
              className="ms-4 text-white"
              style={{ background: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)' }}
            >
              {t('payments.stripe.connect_button')}
            </Button>
          </div>
        </div>

        {/* Connection Options Dialog */}
        <Dialog open={showOptionsDialog} onOpenChange={setShowOptionsDialog}>
          <DialogContent className="sm:max-w-md" dir={isRTL ? 'rtl' : 'ltr'}>
            <DialogHeader>
              <DialogTitle className="text-xl">{t('payments.stripe.setup_title')}</DialogTitle>
              <DialogDescription>{t('payments.stripe.setup_desc')}</DialogDescription>
            </DialogHeader>

            <div className="space-y-3 mt-4">
              {/* Option 1: New to payments - Express (recommended) */}
              <button
                onClick={handleNewToPayments}
                disabled={connecting}
                className="w-full p-4 text-start rounded-lg border-2 border-[var(--v2-border)] hover:border-[#F59E0B] transition-colors bg-[var(--v2-surface)] disabled:opacity-50"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-[var(--v2-text-primary)]">
                      {t('payments.stripe.option_new')}
                    </p>
                    <p className="text-sm text-[var(--v2-text-secondary)] mt-0.5">
                      {t('payments.stripe.option_new_desc')}
                    </p>
                  </div>
                  {connecting && <Loader2 className="w-5 h-5 animate-spin text-[var(--v2-text-muted)]" />}
                </div>
              </button>

              {/* Option 2: Existing Stripe account - OAuth */}
              <button
                onClick={handleExistingAccount}
                disabled={connecting}
                className="w-full p-4 text-start rounded-lg border-2 border-[var(--v2-border)] hover:border-[#F59E0B] transition-colors bg-[var(--v2-surface)] disabled:opacity-50"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                    <CreditCard className="w-5 h-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-[var(--v2-text-primary)]">
                      {t('payments.stripe.option_existing')}
                    </p>
                    <p className="text-sm text-[var(--v2-text-secondary)] mt-0.5">
                      {t('payments.stripe.option_existing_desc')}
                    </p>
                  </div>
                  {connecting && <Loader2 className="w-5 h-5 animate-spin text-[var(--v2-text-muted)]" />}
                </div>
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Connected but not fully onboarded - show continue setup
  if (!account.onboarding_completed) {
    return (
      <div
        className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4"
        style={{ borderRadius: 'var(--v2-radius-card)' }}
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h3 className="font-semibold text-blue-900 dark:text-blue-100">
                {t('payments.stripe.complete_setup')}
              </h3>
            </div>
            <p className="text-sm text-blue-800 dark:text-blue-200 mt-1">
              {t('payments.stripe.complete_setup_desc')}
            </p>
            {detailed && (
              <div className="mt-3 space-y-1 text-sm">
                <div className="flex items-center gap-2">
                  {account.details_submitted ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  ) : (
                    <Clock className="w-4 h-4 text-blue-500" />
                  )}
                  <span className="text-blue-800 dark:text-blue-200">
                    {t('payments.stripe.details_submitted')}: {account.details_submitted ? t('payments.stripe.yes') : t('payments.stripe.no')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {account.charges_enabled ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  ) : (
                    <Clock className="w-4 h-4 text-blue-500" />
                  )}
                  <span className="text-blue-800 dark:text-blue-200">
                    {t('payments.stripe.ready_to_accept')}: {account.charges_enabled ? t('payments.stripe.yes') : t('payments.stripe.pending')}
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshStatus}
              disabled={refreshing}
              className="text-blue-700 dark:text-blue-300"
            >
              {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : t('payments.stripe.refresh')}
            </Button>
            <Button
              onClick={handleContinueSetup}
              disabled={connecting}
              className="text-white"
              style={{ background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)' }}
            >
              {connecting ? <Loader2 className="w-4 h-4 animate-spin me-2" /> : null}
              {t('payments.stripe.continue_button')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Fully connected and onboarded - show success state
  return (
    <div
      className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4"
      style={{ borderRadius: 'var(--v2-radius-card)' }}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
            <h3 className="font-semibold text-green-900 dark:text-green-100">
              {t('payments.stripe.connected')}
            </h3>
          </div>
          {detailed ? (
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-green-800 dark:text-green-200">{t('payments.stripe.ready_to_accept')}:</span>
                <span className="font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" />
                  {t('payments.stripe.yes')}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-green-800 dark:text-green-200">{t('payments.stripe.bank_connected')}:</span>
                <span className={`font-medium flex items-center gap-1 ${account.payouts_enabled ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {account.payouts_enabled ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      {t('payments.stripe.yes')}
                    </>
                  ) : (
                    <>
                      <Clock className="w-4 h-4" />
                      {t('payments.stripe.pending')}
                    </>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-green-800 dark:text-green-200">{t('payments.stripe.currency')}:</span>
                <span className="font-medium text-green-700 dark:text-green-300">{account.currency?.toUpperCase()}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-green-800 dark:text-green-200 mt-1">
              {t('payments.stripe.connected_desc')}
            </p>
          )}
        </div>
        {detailed && (
          <Button
            variant="outline"
            onClick={handleManageAccount}
            className="text-green-700 dark:text-green-300 border-green-300 dark:border-green-700 hover:bg-green-100 dark:hover:bg-green-900/30"
          >
            <ExternalLink className="w-4 h-4 me-2" />
            {t('payments.stripe.manage_button')}
          </Button>
        )}
      </div>
    </div>
  );
}
