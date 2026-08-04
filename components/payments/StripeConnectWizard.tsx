'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle2, Building2, User, CreditCard, AlertCircle, Link2, ArrowLeft } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { useLanguage } from '@/lib/business-os/LanguageContext';

const logger = createLogger({ module: 'StripeConnectWizard' });

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

type Step = 'choice' | 'create-account' | 'processing' | 'success' | 'error';

interface FormData {
  country: string;
  email: string;
  businessType: 'individual' | 'company';
}

const SUPPORTED_COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'IL', name: 'Israel' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'NL', name: 'Netherlands' },
];

/**
 * Stripe Connect Wizard
 * Offers two paths: Create new Stripe account or Connect existing account via OAuth
 */
export function StripeConnectWizard({ onComplete, onCancel }: Props) {
  const { t, isRTL } = useLanguage();
  const [step, setStep] = useState<Step>('choice');
  const [formData, setFormData] = useState<FormData>({
    country: 'US',
    email: '',
    businessType: 'individual',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);

  const updateFormData = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  // Reset processing state when returning to form steps
  useEffect(() => {
    if (step === 'choice' || step === 'create-account') {
      setProcessing(false);
      setErrors({});
      setErrorMessage(null);
    }
  }, [step]);

  const validateCreateAccount = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.country) {
      newErrors.country = t('payments.stripe.wizard.error_country') || 'Country is required';
    }

    if (!formData.email?.trim()) {
      newErrors.email = t('payments.stripe.wizard.error_email') || 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = t('payments.stripe.wizard.error_email_invalid') || 'Invalid email address';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleOAuthConnect = async () => {
    try {
      setProcessing(true);
      logger.info('Initiating Stripe OAuth connection');

      // Call the plugin connection API to initiate OAuth
      const response = await fetch('/api/v2/plugins/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plugin_key: 'stripe' }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'API call failed');
        throw new Error(`API call failed: ${response.status}`);
      }

      const result = await response.json();
      logger.info({ result }, 'API response received');

      if (result.success && result.authUrl) {
        // Open OAuth popup (like other plugins)
        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        logger.info({ authUrl: result.authUrl }, 'Opening OAuth popup');

        const popup = window.open(
          result.authUrl,
          'stripe-oauth',
          `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
        );

        // Check if popup was blocked
        if (!popup || popup.closed) {
          logger.error('Popup was blocked');
          setErrorMessage('Popup was blocked. Please allow popups for this site.');
          setStep('error');
          setProcessing(false);
          return;
        }

        // Listen for success message from popup
        const handleMessage = (event: MessageEvent) => {
          logger.info({ eventData: event.data }, 'Received message from popup');

          if (event.data?.type === 'plugin-connected' && event.data?.plugin === 'stripe') {
            window.removeEventListener('message', handleMessage);

            if (event.data.success) {
              logger.info('OAuth connection successful');
              setStep('success');
              setTimeout(() => onComplete(), 2000);
            } else {
              logger.error({ error: event.data.error }, 'OAuth connection failed');
              setErrorMessage(event.data.error || t('payments.stripe.wizard.error_generic') || 'OAuth failed');
              setStep('error');
            }
            setProcessing(false);
          }
        };

        window.addEventListener('message', handleMessage);

        // Timeout after 5 minutes
        setTimeout(() => {
          if (processing) {
            logger.warn('OAuth timeout - no response from popup');
            window.removeEventListener('message', handleMessage);
            setErrorMessage('Connection timeout. Please try again.');
            setStep('error');
            setProcessing(false);
          }
        }, 300000);

      } else {
        logger.error({ result }, 'Invalid API response');
        setErrorMessage(result.error || t('payments.stripe.wizard.error_generic') || 'Failed to initiate OAuth');
        setStep('error');
        setProcessing(false);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to initiate Stripe OAuth');
      setErrorMessage(t('payments.stripe.wizard.error_generic') || 'Something went wrong');
      setStep('error');
      setProcessing(false);
    }
  };

  const handleCreateAccount = async () => {
    if (!validateCreateAccount()) {
      return;
    }

    setProcessing(true);
    setErrorMessage(null);
    setStep('processing');

    try {
      const response = await fetch('/api/payments/stripe-connect/create-account-custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_type: 'express',
          country: formData.country,
          business_type: formData.businessType,
          email: formData.email,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setAccountId(result.accountId);
        setStep('success');

        // Wait a moment then complete
        setTimeout(() => {
          onComplete();
        }, 2000);
      } else {
        setErrorMessage(result.error || t('payments.stripe.wizard.error_create') || 'Failed to create account');
        setStep('error');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to create Stripe account');
      setErrorMessage(t('payments.stripe.wizard.error_generic') || 'Something went wrong. Please try again.');
      setStep('error');
    } finally {
      setProcessing(false);
    }
  };

  const renderChoice = () => (
    <div className="space-y-4">
      <p className="text-sm text-[var(--v2-text-muted)]">
        {t('payments.stripe.wizard.choose_desc') || 'Connect your Stripe account to start accepting payments'}
      </p>

      <div className="grid grid-cols-1 gap-3">
        {/* Create New Account */}
        <button
          onClick={() => setStep('create-account')}
          className="p-4 text-start rounded-lg border-2 border-[var(--v2-border)] hover:border-[#635BFF] transition-colors bg-[var(--v2-surface)]"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
              <CreditCard className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-[var(--v2-text-primary)]">
                {t('payments.stripe.wizard.new_account') || 'Create New Account'}
              </p>
              <p className="text-sm text-[var(--v2-text-secondary)] mt-0.5">
                {t('payments.stripe.wizard.new_account_desc') || 'New to Stripe? We\'ll help you create an account'}
              </p>
            </div>
          </div>
        </button>

        {/* Connect Existing Account */}
        <button
          onClick={handleOAuthConnect}
          className="p-4 text-start rounded-lg border-2 border-[var(--v2-border)] hover:border-[#635BFF] transition-colors bg-[var(--v2-surface)]"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0">
              <Link2 className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-[var(--v2-text-primary)]">
                {t('payments.stripe.wizard.existing_account') || 'Connect Existing Account'}
              </p>
              <p className="text-sm text-[var(--v2-text-secondary)] mt-0.5">
                {t('payments.stripe.wizard.existing_account_desc') || 'Already have Stripe? Connect in seconds'}
              </p>
            </div>
          </div>
        </button>
      </div>
    </div>
  );

  const renderCreateAccount = () => (
    <div className="space-y-4">
      <p className="text-sm text-[var(--v2-text-muted)]">
        {t('payments.stripe.wizard.create_account_desc') || 'Provide your basic information to create a Stripe account'}
      </p>

      <div className="space-y-4">
        {/* Business Type */}
        <div className="space-y-2">
          <Label htmlFor="businessType">{t('payments.stripe.wizard.business_type') || 'Business Type'}</Label>
          <Select value={formData.businessType} onValueChange={(val: 'individual' | 'company') => updateFormData('businessType', val)}>
            <SelectTrigger id="businessType">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="individual">
                {t('payments.stripe.wizard.individual') || 'Individual / Sole Proprietor'}
              </SelectItem>
              <SelectItem value="company">
                {t('payments.stripe.wizard.company') || 'Company / Corporation'}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Country */}
        <div className="space-y-2">
          <Label htmlFor="country">{t('payments.stripe.wizard.country') || 'Country'} *</Label>
          <Select value={formData.country} onValueChange={(val) => updateFormData('country', val)}>
            <SelectTrigger id="country">
              <SelectValue placeholder={t('payments.stripe.wizard.select_country') || 'Select country'} />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_COUNTRIES.map(country => (
                <SelectItem key={country.code} value={country.code}>
                  {country.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.country && (
            <p className="text-sm text-red-600 dark:text-red-400">{errors.country}</p>
          )}
        </div>

        {/* Email */}
        <div className="space-y-2">
          <Label htmlFor="email">{t('common.email') || 'Email'} *</Label>
          <Input
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => updateFormData('email', e.target.value)}
            placeholder={t('payments.stripe.wizard.email_placeholder') || 'john@example.com'}
          />
          {errors.email && (
            <p className="text-sm text-red-600 dark:text-red-400">{errors.email}</p>
          )}
        </div>

        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-sm text-blue-900 dark:text-blue-100">
            {t('payments.stripe.wizard.next_steps_desc') || "After creating your account, you'll need to complete identity verification and add bank details through your Stripe dashboard to start receiving payments."}
          </p>
        </div>

        <div className="flex justify-end pt-4">
          <Button
            onClick={handleCreateAccount}
            disabled={processing}
            style={{ background: 'linear-gradient(135deg, #635BFF 0%, #4F46E5 100%)' }}
            className="text-white"
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin me-2" />
                {t('payments.stripe.wizard.creating') || 'Creating Account...'}
              </>
            ) : (
              <>
                <CreditCard className="w-4 h-4 me-2" />
                {t('payments.stripe.wizard.create_account') || 'Create Account'}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );

  const renderSuccess = () => (
    <div className="py-8">
      <div className="text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
            {t('payments.stripe.wizard.success_title') || 'Account Created Successfully!'}
          </h3>
          <p className="text-sm text-[var(--v2-text-secondary)] mt-2">
            {t('payments.stripe.wizard.success_desc') || 'Your Stripe payment account has been created. You can now accept payments.'}
          </p>
          {accountId && (
            <p className="text-xs text-[var(--v2-text-muted)] mt-2 font-mono">
              {t('payments.stripe.wizard.account_id') || 'Account ID'}: {accountId}
            </p>
          )}
        </div>
        <div className="animate-pulse">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--v2-text-muted)] mx-auto" />
          <p className="text-sm text-[var(--v2-text-muted)] mt-2">{t('payments.stripe.wizard.finalizing') || 'Finalizing setup...'}</p>
        </div>
      </div>
    </div>
  );

  const renderError = () => (
    <div className="py-8">
      <div className="text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto">
          <AlertCircle className="w-10 h-10 text-red-600 dark:text-red-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
            {t('payments.stripe.wizard.error_title') || 'Setup Error'}
          </h3>
          <p className="text-sm text-[var(--v2-text-secondary)] mt-2">
            {errorMessage || t('payments.stripe.wizard.error_default') || 'Failed to create payment account'}
          </p>
        </div>
        <div className="flex gap-2 justify-center">
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel') || 'Cancel'}
          </Button>
          <Button
            onClick={() => {
              setStep('choice');
              setErrorMessage(null);
              setErrors({});
            }}
            style={{ background: 'linear-gradient(135deg, #635BFF 0%, #4F46E5 100%)' }}
            className="text-white"
          >
            {t('common.try_again') || 'Try Again'}
          </Button>
        </div>
      </div>
    </div>
  );

  const getStepTitle = () => {
    switch (step) {
      case 'choice': return t('payments.stripe.wizard.title_choice') || 'Connect Stripe';
      case 'create-account': return t('payments.stripe.wizard.title_create') || 'Create Account';
      case 'success': return t('payments.stripe.wizard.title_success') || 'Setup Complete';
      case 'error': return t('payments.stripe.wizard.title_error') || 'Setup Error';
      default: return t('payments.stripe.wizard.title_default') || 'Payment Setup';
    }
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header with back button */}
      {(step === 'create-account' || step === 'error') && (
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStep('choice');
              setErrors({});
              setErrorMessage(null);
            }}
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('common.back') || 'Back'}
          </Button>
        </div>
      )}

      {/* Title */}
      <div>
        <h2 className="text-xl font-semibold text-[var(--v2-text-primary)]">
          {getStepTitle()}
        </h2>
      </div>

      {/* Content */}
      <div>
        {step === 'choice' && renderChoice()}
        {step === 'create-account' && renderCreateAccount()}
        {step === 'processing' && renderSuccess()} {/* Show success UI while processing */}
        {step === 'success' && renderSuccess()}
        {step === 'error' && renderError()}
      </div>
    </div>
  );
}
