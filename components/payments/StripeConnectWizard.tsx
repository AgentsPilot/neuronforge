'use client';

import { useState, useEffect, useCallback, Fragment, useMemo } from 'react';
import { Combobox, Transition } from '@headlessui/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Loader2, CheckCircle2, Building2, User, CreditCard, AlertCircle,
  Link2, ArrowLeft, ArrowRight, Check, ChevronDown, Search, Globe,
  MapPin, Briefcase, Shield, ChevronRight
} from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { StripeEmbeddedOnboarding } from './StripeEmbeddedOnboarding';

const logger = createLogger({ module: 'StripeConnectWizard' });

interface Props {
  onComplete: () => void;
  onCancel: () => void;
  continueOnboarding?: boolean;
  existingAccount?: {
    stripe_account_id: string;
    stripe_email?: string | null;
    country?: string | null;
    business_type?: string | null;
  };
  /** If true, show embedded onboarding after account creation instead of redirecting */
  useEmbeddedOnboarding?: boolean;
}

type WizardStep = 'choice' | 'country' | 'personal' | 'address' | 'business' | 'review' | 'processing' | 'embedded' | 'success' | 'error';

interface FormData {
  country: string;
  email: string;
  businessType: 'individual' | 'company';
  firstName: string;
  lastName: string;
  phone: string;
  dobDay: string;
  dobMonth: string;
  dobYear: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  ssnLast4: string;
  businessName: string;
  businessUrl: string;
  industry: string;
  tosAccepted: boolean;
}

// Countries with flag emoji support
const SUPPORTED_COUNTRIES = [
  { code: 'US', name: 'United States', flag: '🇺🇸', nameHe: 'ארצות הברית', nameEs: 'Estados Unidos' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', nameHe: 'בריטניה', nameEs: 'Reino Unido' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', nameHe: 'קנדה', nameEs: 'Canadá' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', nameHe: 'אוסטרליה', nameEs: 'Australia' },
  { code: 'IL', name: 'Israel', flag: '🇮🇱', nameHe: 'ישראל', nameEs: 'Israel' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', nameHe: 'גרמניה', nameEs: 'Alemania' },
  { code: 'FR', name: 'France', flag: '🇫🇷', nameHe: 'צרפת', nameEs: 'Francia' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸', nameHe: 'ספרד', nameEs: 'España' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹', nameHe: 'איטליה', nameEs: 'Italia' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱', nameHe: 'הולנד', nameEs: 'Países Bajos' },
  { code: 'BE', name: 'Belgium', flag: '🇧🇪', nameHe: 'בלגיה', nameEs: 'Bélgica' },
  { code: 'AT', name: 'Austria', flag: '🇦🇹', nameHe: 'אוסטריה', nameEs: 'Austria' },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭', nameHe: 'שוויץ', nameEs: 'Suiza' },
  { code: 'IE', name: 'Ireland', flag: '🇮🇪', nameHe: 'אירלנד', nameEs: 'Irlanda' },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹', nameHe: 'פורטוגל', nameEs: 'Portugal' },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪', nameHe: 'שוודיה', nameEs: 'Suecia' },
  { code: 'NO', name: 'Norway', flag: '🇳🇴', nameHe: 'נורווגיה', nameEs: 'Noruega' },
  { code: 'DK', name: 'Denmark', flag: '🇩🇰', nameHe: 'דנמרק', nameEs: 'Dinamarca' },
  { code: 'FI', name: 'Finland', flag: '🇫🇮', nameHe: 'פינלנד', nameEs: 'Finlandia' },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿', nameHe: 'ניו זילנד', nameEs: 'Nueva Zelanda' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬', nameHe: 'סינגפור', nameEs: 'Singapur' },
  { code: 'HK', name: 'Hong Kong', flag: '🇭🇰', nameHe: 'הונג קונג', nameEs: 'Hong Kong' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', nameHe: 'יפן', nameEs: 'Japón' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽', nameHe: 'מקסיקו', nameEs: 'México' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷', nameHe: 'ברזיל', nameEs: 'Brasil' },
];

// Industries with translations
const INDUSTRIES = [
  { code: '7392', name: 'Consulting / Business Services', nameHe: 'ייעוץ / שירותים עסקיים', nameEs: 'Consultoría / Servicios Empresariales' },
  { code: '8299', name: 'Education / Training', nameHe: 'חינוך / הדרכה', nameEs: 'Educación / Capacitación' },
  { code: '8099', name: 'Health Services', nameHe: 'שירותי בריאות', nameEs: 'Servicios de Salud' },
  { code: '7311', name: 'Marketing / Advertising', nameHe: 'שיווק / פרסום', nameEs: 'Marketing / Publicidad' },
  { code: '7372', name: 'Software / Technology', nameHe: 'תוכנה / טכנולוגיה', nameEs: 'Software / Tecnología' },
  { code: '5734', name: 'Computer Software Stores', nameHe: 'חנויות תוכנה', nameEs: 'Tiendas de Software' },
  { code: '8111', name: 'Legal Services', nameHe: 'שירותים משפטיים', nameEs: 'Servicios Legales' },
  { code: '8931', name: 'Accounting / Bookkeeping', nameHe: 'הנהלת חשבונות', nameEs: 'Contabilidad' },
  { code: '7999', name: 'Recreation / Entertainment', nameHe: 'בידור / פנאי', nameEs: 'Recreación / Entretenimiento' },
  { code: '7298', name: 'Health and Beauty Spas', nameHe: 'ספא ויופי', nameEs: 'Spa y Belleza' },
  { code: '7941', name: 'Sports / Athletic Services', nameHe: 'ספורט / אתלטיקה', nameEs: 'Deportes / Atletismo' },
  { code: '5999', name: 'Other / General', nameHe: 'אחר / כללי', nameEs: 'Otro / General' },
];

// US States
const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' }, { code: 'DC', name: 'Washington DC' },
];

// Check if text contains Hebrew characters
const containsHebrew = (text: string): boolean => /[\u0590-\u05FF]/.test(text);

// Check if text contains non-ASCII characters (for strict English validation)
const containsNonAscii = (text: string): boolean => /[^\x00-\x7F]/.test(text);

/**
 * Modern Step-by-Step Stripe Connect Wizard
 */
export function StripeConnectWizard({ onComplete, onCancel, continueOnboarding, existingAccount, useEmbeddedOnboarding = true }: Props) {
  const { t, language, isRTL } = useLanguage();

  // Wizard state
  const [step, setStep] = useState<WizardStep>(continueOnboarding ? 'country' : 'choice');
  const [loadingAccountDetails, setLoadingAccountDetails] = useState(!!continueOnboarding);
  const [isContinueMode] = useState(!!continueOnboarding);

  // Form state
  const [formData, setFormData] = useState<FormData>({
    country: existingAccount?.country || '',
    email: existingAccount?.stripe_email || '',
    businessType: (existingAccount?.business_type as 'individual' | 'company') || 'individual',
    firstName: '',
    lastName: '',
    phone: '',
    dobDay: '',
    dobMonth: '',
    dobYear: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    ssnLast4: '',
    businessName: '',
    businessUrl: '',
    industry: '',
    tosAccepted: false,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(existingAccount?.stripe_account_id || null);

  // Search states for comboboxes
  const [countrySearch, setCountrySearch] = useState('');
  const [industrySearch, setIndustrySearch] = useState('');
  const [stateSearch, setStateSearch] = useState('');

  // Check if current country requires English-only input (Israel)
  const requiresEnglishOnly = formData.country === 'IL';

  // Fetch account details when continuing
  useEffect(() => {
    if (continueOnboarding && existingAccount?.stripe_account_id) {
      fetchAccountDetails();
    }
  }, [continueOnboarding, existingAccount?.stripe_account_id]);

  const fetchAccountDetails = async () => {
    try {
      setLoadingAccountDetails(true);
      const response = await fetch('/api/payments/stripe-connect/account-details');
      const result = await response.json();

      if (result.success && result.data) {
        const details = result.data;
        setFormData(prev => ({
          ...prev,
          country: details.country || prev.country,
          email: details.individual?.email || details.email || prev.email,
          businessType: (details.businessType as 'individual' | 'company') || prev.businessType,
          firstName: details.individual?.firstName || '',
          lastName: details.individual?.lastName || '',
          phone: details.individual?.phone || '',
          dobDay: details.individual?.dob?.day?.toString() || '',
          dobMonth: details.individual?.dob?.month?.toString() || '',
          dobYear: details.individual?.dob?.year?.toString() || '',
          addressLine1: details.individual?.address?.line1 || '',
          addressLine2: details.individual?.address?.line2 || '',
          city: details.individual?.address?.city || '',
          state: details.individual?.address?.state || '',
          postalCode: details.individual?.address?.postalCode || '',
          ssnLast4: '',
          businessName: details.businessProfile?.name || '',
          businessUrl: details.businessProfile?.url || '',
          industry: details.businessProfile?.mcc || '',
          tosAccepted: false,
        }));
        logger.info({ hasIndividual: !!details.individual }, 'Pre-filled form with existing Stripe account data');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to fetch account details');
    } finally {
      setLoadingAccountDetails(false);
    }
  };

  // Update form field with English validation for Israel
  const updateField = useCallback((field: keyof FormData, value: string | boolean) => {
    // For Israel, validate text fields for English-only
    if (requiresEnglishOnly && typeof value === 'string') {
      const textFields = ['firstName', 'lastName', 'addressLine1', 'addressLine2', 'city', 'businessName'];
      if (textFields.includes(field) && containsNonAscii(value)) {
        setErrors(prev => ({
          ...prev,
          [field]: t('payments.stripe.wizard.error_english_only') || 'Please use English characters only for Israeli accounts'
        }));
        return;
      }
    }

    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }, [requiresEnglishOnly, errors, t]);

  // Get country name based on current language
  const getCountryName = useCallback((country: typeof SUPPORTED_COUNTRIES[0]) => {
    if (language === 'he') return country.nameHe;
    if (language === 'es') return country.nameEs;
    return country.name;
  }, [language]);

  // Get industry name based on current language
  const getIndustryName = useCallback((industry: typeof INDUSTRIES[0]) => {
    if (language === 'he') return industry.nameHe;
    if (language === 'es') return industry.nameEs;
    return industry.name;
  }, [language]);

  // Filter countries by search
  const filteredCountries = useMemo(() => {
    if (!countrySearch) return SUPPORTED_COUNTRIES;
    const search = countrySearch.toLowerCase();
    return SUPPORTED_COUNTRIES.filter(c =>
      c.name.toLowerCase().includes(search) ||
      c.code.toLowerCase().includes(search) ||
      c.nameHe.includes(search) ||
      c.nameEs.toLowerCase().includes(search)
    );
  }, [countrySearch]);

  // Filter industries by search
  const filteredIndustries = useMemo(() => {
    if (!industrySearch) return INDUSTRIES;
    const search = industrySearch.toLowerCase();
    return INDUSTRIES.filter(i =>
      i.name.toLowerCase().includes(search) ||
      i.nameHe.includes(search) ||
      i.nameEs.toLowerCase().includes(search)
    );
  }, [industrySearch]);

  // Filter states by search
  const filteredStates = useMemo(() => {
    if (!stateSearch) return US_STATES;
    const search = stateSearch.toLowerCase();
    return US_STATES.filter(s =>
      s.name.toLowerCase().includes(search) ||
      s.code.toLowerCase().includes(search)
    );
  }, [stateSearch]);

  // Validate current step
  const validateStep = useCallback((currentStep: WizardStep): boolean => {
    const newErrors: Record<string, string> = {};

    switch (currentStep) {
      case 'country':
        if (!formData.country) {
          newErrors.country = t('payments.stripe.wizard.error_country') || 'Please select a country';
        }
        break;

      case 'personal':
        if (!formData.email?.trim()) {
          newErrors.email = t('payments.stripe.wizard.error_email') || 'Email is required';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
          newErrors.email = t('payments.stripe.wizard.error_email_invalid') || 'Invalid email address';
        }
        if (!formData.firstName?.trim()) {
          newErrors.firstName = t('payments.stripe.wizard.error_first_name') || 'First name is required';
        } else if (requiresEnglishOnly && containsNonAscii(formData.firstName)) {
          newErrors.firstName = t('payments.stripe.wizard.error_english_only') || 'Please use English characters only';
        }
        if (!formData.lastName?.trim()) {
          newErrors.lastName = t('payments.stripe.wizard.error_last_name') || 'Last name is required';
        } else if (requiresEnglishOnly && containsNonAscii(formData.lastName)) {
          newErrors.lastName = t('payments.stripe.wizard.error_english_only') || 'Please use English characters only';
        }
        if (!formData.dobDay || !formData.dobMonth || !formData.dobYear) {
          newErrors.dob = t('payments.stripe.wizard.error_dob') || 'Date of birth is required';
        }
        break;

      case 'address':
        if (!formData.addressLine1?.trim()) {
          newErrors.addressLine1 = t('payments.stripe.wizard.error_address') || 'Street address is required';
        } else if (requiresEnglishOnly && containsNonAscii(formData.addressLine1)) {
          newErrors.addressLine1 = t('payments.stripe.wizard.error_english_only') || 'Please use English characters only';
        }
        if (!formData.city?.trim()) {
          newErrors.city = t('payments.stripe.wizard.error_city') || 'City is required';
        } else if (requiresEnglishOnly && containsNonAscii(formData.city)) {
          newErrors.city = t('payments.stripe.wizard.error_english_only') || 'Please use English characters only';
        }
        if (formData.country === 'US' && !formData.state) {
          newErrors.state = t('payments.stripe.wizard.error_state') || 'State is required';
        }
        if (!formData.postalCode?.trim()) {
          newErrors.postalCode = t('payments.stripe.wizard.error_postal') || 'Postal code is required';
        }
        if (formData.country === 'US' && (!formData.ssnLast4 || formData.ssnLast4.length !== 4)) {
          newErrors.ssnLast4 = t('payments.stripe.wizard.error_ssn') || 'Last 4 digits of SSN required';
        }
        break;

      case 'business':
        if (!formData.industry) {
          newErrors.industry = t('payments.stripe.wizard.error_industry') || 'Please select an industry';
        }
        if (requiresEnglishOnly && formData.businessName && containsNonAscii(formData.businessName)) {
          newErrors.businessName = t('payments.stripe.wizard.error_english_only') || 'Please use English characters only';
        }
        break;

      case 'review':
        if (!formData.tosAccepted) {
          newErrors.tosAccepted = t('payments.stripe.wizard.error_tos') || 'You must accept the terms of service';
        }
        break;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData, t, requiresEnglishOnly]);

  // Navigate to next step
  const nextStep = useCallback(() => {
    if (!validateStep(step)) return;

    const stepOrder: WizardStep[] = ['country', 'personal', 'address', 'business', 'review'];
    const currentIndex = stepOrder.indexOf(step);
    if (currentIndex < stepOrder.length - 1) {
      setStep(stepOrder[currentIndex + 1]);
    }
  }, [step, validateStep]);

  // Navigate to previous step
  const prevStep = useCallback(() => {
    const stepOrder: WizardStep[] = ['country', 'personal', 'address', 'business', 'review'];
    const currentIndex = stepOrder.indexOf(step);
    if (currentIndex > 0) {
      setStep(stepOrder[currentIndex - 1]);
    } else if (!isContinueMode) {
      setStep('choice');
    }
  }, [step, isContinueMode]);

  // Submit form
  const handleSubmit = async () => {
    if (!validateStep('review')) return;

    setProcessing(true);
    setErrorMessage(null);
    setStep('processing');

    try {
      const endpoint = isContinueMode
        ? '/api/payments/stripe-connect/update-account'
        : '/api/payments/stripe-connect/create-account-custom';

      const payload = isContinueMode
        ? {
            business_profile: {
              name: formData.businessName || `${formData.firstName} ${formData.lastName}`,
              url: formData.businessUrl || undefined,
              mcc: formData.industry || undefined,
            },
            individual: {
              first_name: formData.firstName,
              last_name: formData.lastName,
              email: formData.email,
              phone: formData.phone || undefined,
              dob: formData.dobDay && formData.dobMonth && formData.dobYear ? {
                day: parseInt(formData.dobDay),
                month: parseInt(formData.dobMonth),
                year: parseInt(formData.dobYear),
              } : undefined,
              address: {
                line1: formData.addressLine1,
                line2: formData.addressLine2 || undefined,
                city: formData.city,
                state: formData.state || undefined,
                postal_code: formData.postalCode,
                country: formData.country,
              },
              ssn_last_4: formData.country === 'US' ? formData.ssnLast4 : undefined,
            },
            tos_accepted: formData.tosAccepted,
          }
        : {
            account_type: 'express',
            country: formData.country,
            business_type: formData.businessType,
            email: formData.email,
            business_profile: {
              name: formData.businessName || `${formData.firstName} ${formData.lastName}`,
              url: formData.businessUrl || undefined,
              mcc: formData.industry || undefined,
            },
            individual: {
              first_name: formData.firstName,
              last_name: formData.lastName,
              email: formData.email,
              phone: formData.phone || undefined,
              dob: formData.dobDay && formData.dobMonth && formData.dobYear ? {
                day: parseInt(formData.dobDay),
                month: parseInt(formData.dobMonth),
                year: parseInt(formData.dobYear),
              } : undefined,
              address: {
                line1: formData.addressLine1,
                line2: formData.addressLine2 || undefined,
                city: formData.city,
                state: formData.state || undefined,
                postal_code: formData.postalCode,
                country: formData.country,
              },
              ssn_last_4: formData.country === 'US' ? formData.ssnLast4 : undefined,
            },
            tos_accepted: formData.tosAccepted,
          };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (result.success) {
        setAccountId(result.accountId);
        // If embedded onboarding is enabled, show it instead of redirecting
        if (useEmbeddedOnboarding && result.onboardingUrl) {
          // Account created - now show embedded onboarding to complete verification
          setStep('embedded');
          return;
        }
        // Fallback to redirect if embedded is disabled
        if (result.onboardingUrl) {
          window.location.href = result.onboardingUrl;
          return;
        }
        setStep('success');
        setTimeout(() => onComplete(), 2000);
      } else {
        setErrorMessage(result.error || t('payments.stripe.wizard.error_create') || 'Failed to create account');
        setStep('error');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to create Stripe account');
      setErrorMessage(t('payments.stripe.wizard.error_generic') || 'Something went wrong');
      setStep('error');
    } finally {
      setProcessing(false);
    }
  };

  // OAuth connect handler
  const handleOAuthConnect = async () => {
    try {
      setProcessing(true);
      const response = await fetch('/api/v2/plugins/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plugin_key: 'stripe' }),
      });

      const result = await response.json();
      if (result.success && result.authUrl) {
        const width = 600, height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        const popup = window.open(
          result.authUrl,
          'stripe-oauth',
          `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes`
        );

        if (!popup) {
          setErrorMessage(t('payments.stripe.wizard.error_popup') || 'Popup was blocked');
          setStep('error');
          setProcessing(false);
          return;
        }

        const handleMessage = (event: MessageEvent) => {
          if (event.data?.type === 'plugin-connected' && event.data?.plugin === 'stripe') {
            window.removeEventListener('message', handleMessage);
            if (event.data.success) {
              setStep('success');
              setTimeout(() => onComplete(), 2000);
            } else {
              setErrorMessage(event.data.error || 'OAuth failed');
              setStep('error');
            }
            setProcessing(false);
          }
        };

        window.addEventListener('message', handleMessage);
        setTimeout(() => {
          if (processing) {
            window.removeEventListener('message', handleMessage);
            setErrorMessage('Connection timeout');
            setStep('error');
            setProcessing(false);
          }
        }, 300000);
      } else {
        setErrorMessage(result.error || 'Failed to initiate OAuth');
        setStep('error');
        setProcessing(false);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to initiate OAuth');
      setErrorMessage('Something went wrong');
      setStep('error');
      setProcessing(false);
    }
  };

  // Get step progress
  const getStepProgress = () => {
    const steps = ['country', 'personal', 'address', 'business', 'review'];
    const currentIndex = steps.indexOf(step);
    return { current: currentIndex + 1, total: steps.length };
  };

  // Searchable Select Component
  const SearchableSelect = ({
    value,
    onChange,
    options,
    search,
    onSearchChange,
    placeholder,
    renderOption,
    renderValue,
    error
  }: {
    value: string;
    onChange: (value: string) => void;
    options: { code: string; name: string }[];
    search: string;
    onSearchChange: (search: string) => void;
    placeholder: string;
    renderOption: (option: any, active: boolean) => React.ReactNode;
    renderValue: (value: string) => string;
    error?: string;
  }) => (
    <div className="relative">
      <Combobox value={value} onChange={(val) => { onChange(val); onSearchChange(''); }}>
        <div className="relative">
          <div className="relative w-full">
            <Combobox.Input
              className={`w-full h-12 px-4 pe-10 border text-sm bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[#635BFF] transition-all ${
                error ? 'border-red-500' : 'border-[var(--v2-border)]'
              }`}
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              displayValue={() => renderValue(value)}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={placeholder}
            />
            <Combobox.Button className="absolute inset-y-0 end-0 flex items-center pe-3">
              <ChevronDown className="h-5 w-5 text-[var(--v2-text-muted)]" />
            </Combobox.Button>
          </div>

          <Transition
            as={Fragment}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
            afterLeave={() => onSearchChange('')}
          >
            <Combobox.Options
              className="absolute z-50 mt-1 max-h-60 w-full overflow-auto bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-xl focus:outline-none"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              {options.length === 0 ? (
                <div className="px-4 py-3 text-sm text-[var(--v2-text-muted)]">
                  {t('common.no_results') || 'No results found'}
                </div>
              ) : (
                options.map((option) => (
                  <Combobox.Option
                    key={option.code}
                    value={option.code}
                    className={({ active }) =>
                      `cursor-pointer select-none px-4 py-3 ${
                        active ? 'bg-[#635BFF] text-white' : 'text-[var(--v2-text-primary)]'
                      }`
                    }
                  >
                    {({ active, selected }) => (
                      <div className="flex items-center gap-3">
                        {renderOption(option, active)}
                        {selected && <Check className="h-4 w-4 ms-auto flex-shrink-0" />}
                      </div>
                    )}
                  </Combobox.Option>
                ))
              )}
            </Combobox.Options>
          </Transition>
        </div>
      </Combobox>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );

  // Step indicator component
  const StepIndicator = () => {
    const steps = [
      { key: 'country', icon: Globe, label: t('payments.stripe.wizard.step_country') || 'Country' },
      { key: 'personal', icon: User, label: t('payments.stripe.wizard.step_personal') || 'Personal' },
      { key: 'address', icon: MapPin, label: t('payments.stripe.wizard.step_address') || 'Address' },
      { key: 'business', icon: Briefcase, label: t('payments.stripe.wizard.step_business') || 'Business' },
      { key: 'review', icon: Shield, label: t('payments.stripe.wizard.step_review') || 'Review' },
    ];

    const currentIndex = steps.findIndex(s => s.key === step);

    return (
      <div className="flex items-center justify-center gap-2 mb-8">
        {steps.map((s, index) => {
          const Icon = s.icon;
          const isActive = index === currentIndex;
          const isComplete = index < currentIndex;

          return (
            <Fragment key={s.key}>
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                    isActive
                      ? 'bg-[#635BFF] text-white shadow-lg shadow-[#635BFF]/30'
                      : isComplete
                        ? 'bg-green-500 text-white'
                        : 'bg-[var(--v2-bg)] text-[var(--v2-text-muted)] border border-[var(--v2-border)]'
                  }`}
                >
                  {isComplete ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                </div>
                <span className={`text-xs font-medium hidden sm:block ${isActive ? 'text-[#635BFF]' : 'text-[var(--v2-text-muted)]'}`}>
                  {s.label}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div className={`w-8 h-0.5 ${isComplete ? 'bg-green-500' : 'bg-[var(--v2-border)]'}`} />
              )}
            </Fragment>
          );
        })}
      </div>
    );
  };

  // Render choice step
  const renderChoice = () => (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #635BFF 0%, #4F46E5 100%)' }}>
          <CreditCard className="w-8 h-8 text-white" />
        </div>
        <h2 className="text-2xl font-bold text-[var(--v2-text-primary)]">
          {t('payments.stripe.wizard.title_choice') || 'Connect Stripe'}
        </h2>
        <p className="text-[var(--v2-text-muted)] mt-2">
          {t('payments.stripe.wizard.choose_desc') || 'Connect your Stripe account to start accepting payments'}
        </p>
      </div>

      <div className="grid gap-4">
        <button
          onClick={() => setStep('country')}
          className="p-6 text-start rounded-xl border-2 border-[var(--v2-border)] hover:border-[#635BFF] transition-all bg-[var(--v2-surface)] group"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
              <CreditCard className="w-7 h-7 text-[#635BFF]" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-lg text-[var(--v2-text-primary)]">
                {t('payments.stripe.wizard.new_account') || 'Create New Account'}
              </p>
              <p className="text-sm text-[var(--v2-text-muted)] mt-1">
                {t('payments.stripe.wizard.new_account_desc') || "New to Stripe? We'll help you create an account"}
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-[var(--v2-text-muted)] group-hover:text-[#635BFF] transition-colors" />
          </div>
        </button>

        <button
          onClick={handleOAuthConnect}
          disabled={processing}
          className="p-6 text-start rounded-xl border-2 border-[var(--v2-border)] hover:border-[#635BFF] transition-all bg-[var(--v2-surface)] group disabled:opacity-50"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Link2 className="w-7 h-7 text-purple-600" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-lg text-[var(--v2-text-primary)]">
                {t('payments.stripe.wizard.existing_account') || 'Connect Existing Account'}
              </p>
              <p className="text-sm text-[var(--v2-text-muted)] mt-1">
                {t('payments.stripe.wizard.existing_account_desc') || 'Already have Stripe? Connect in seconds'}
              </p>
            </div>
            {processing ? (
              <Loader2 className="w-5 h-5 text-[var(--v2-text-muted)] animate-spin" />
            ) : (
              <ChevronRight className="w-5 h-5 text-[var(--v2-text-muted)] group-hover:text-[#635BFF] transition-colors" />
            )}
          </div>
        </button>
      </div>
    </div>
  );

  // Render country step
  const renderCountryStep = () => (
    <div className="space-y-6">
      <StepIndicator />

      <div className="text-center mb-6">
        <h3 className="text-xl font-semibold text-[var(--v2-text-primary)]">
          {t('payments.stripe.wizard.country_title') || 'Where is your business located?'}
        </h3>
        <p className="text-sm text-[var(--v2-text-muted)] mt-1">
          {t('payments.stripe.wizard.country_desc') || 'Select the country where your business is registered'}
        </p>
      </div>

      <SearchableSelect
        value={formData.country}
        onChange={(val) => updateField('country', val)}
        options={filteredCountries}
        search={countrySearch}
        onSearchChange={setCountrySearch}
        placeholder={t('payments.stripe.wizard.search_country') || 'Search for a country...'}
        error={errors.country}
        renderOption={(country, active) => (
          <>
            <span className="text-xl">{country.flag}</span>
            <span className={`flex-1 ${active ? 'font-medium' : ''}`}>{getCountryName(country)}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${active ? 'bg-white/20' : 'bg-[var(--v2-bg)]'}`}>
              {country.code}
            </span>
          </>
        )}
        renderValue={(code) => {
          const country = SUPPORTED_COUNTRIES.find(c => c.code === code);
          return country ? `${country.flag} ${getCountryName(country)}` : '';
        }}
      />

      {formData.country === 'IL' && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              {t('payments.stripe.wizard.israel_notice_title') || 'English Input Required'}
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              {t('payments.stripe.wizard.israel_notice_desc') || 'Stripe requires all information for Israeli accounts to be in English characters only.'}
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={prevStep} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          {t('common.back') || 'Back'}
        </Button>
        <Button
          onClick={nextStep}
          disabled={!formData.country}
          style={{ background: 'linear-gradient(135deg, #635BFF 0%, #4F46E5 100%)' }}
          className="text-white gap-2"
        >
          {t('common.next') || 'Next'}
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  // Render personal info step
  const renderPersonalStep = () => (
    <div className="space-y-6">
      <StepIndicator />

      <div className="text-center mb-6">
        <h3 className="text-xl font-semibold text-[var(--v2-text-primary)]">
          {t('payments.stripe.wizard.personal_title') || 'Personal Information'}
        </h3>
        <p className="text-sm text-[var(--v2-text-muted)] mt-1">
          {t('payments.stripe.wizard.personal_desc') || 'Your information for account verification'}
        </p>
      </div>

      <div className="grid gap-4">
        {/* Name fields */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="firstName">{t('payments.stripe.wizard.first_name') || 'First Name'} *</Label>
            <Input
              id="firstName"
              value={formData.firstName}
              onChange={(e) => updateField('firstName', e.target.value)}
              placeholder={requiresEnglishOnly ? 'John (English only)' : 'John'}
              className={`h-12 ${errors.firstName ? 'border-red-500' : ''}`}
              dir="ltr"
            />
            {errors.firstName && <p className="text-xs text-red-500">{errors.firstName}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">{t('payments.stripe.wizard.last_name') || 'Last Name'} *</Label>
            <Input
              id="lastName"
              value={formData.lastName}
              onChange={(e) => updateField('lastName', e.target.value)}
              placeholder={requiresEnglishOnly ? 'Doe (English only)' : 'Doe'}
              className={`h-12 ${errors.lastName ? 'border-red-500' : ''}`}
              dir="ltr"
            />
            {errors.lastName && <p className="text-xs text-red-500">{errors.lastName}</p>}
          </div>
        </div>

        {/* Email */}
        <div className="space-y-2">
          <Label htmlFor="email">{t('payments.stripe.wizard.email') || 'Email'} *</Label>
          <Input
            id="email"
            type="email"
            value={formData.email}
            onChange={(e) => updateField('email', e.target.value)}
            placeholder="john@example.com"
            className={`h-12 ${errors.email ? 'border-red-500' : ''}`}
            dir="ltr"
          />
          {errors.email && <p className="text-xs text-red-500">{errors.email}</p>}
        </div>

        {/* Phone */}
        <div className="space-y-2">
          <Label htmlFor="phone">{t('payments.stripe.wizard.phone') || 'Phone'}</Label>
          <Input
            id="phone"
            type="tel"
            value={formData.phone}
            onChange={(e) => updateField('phone', e.target.value)}
            placeholder="+1 555-123-4567"
            className="h-12"
            dir="ltr"
          />
        </div>

        {/* Date of Birth */}
        <div className="space-y-2">
          <Label>{t('payments.stripe.wizard.dob') || 'Date of Birth'} *</Label>
          <div className="grid grid-cols-3 gap-3">
            <Input
              type="number"
              value={formData.dobDay}
              onChange={(e) => updateField('dobDay', e.target.value)}
              placeholder={t('payments.stripe.wizard.day') || 'Day'}
              min="1"
              max="31"
              className={`h-12 ${errors.dob ? 'border-red-500' : ''}`}
            />
            <Input
              type="number"
              value={formData.dobMonth}
              onChange={(e) => updateField('dobMonth', e.target.value)}
              placeholder={t('payments.stripe.wizard.month') || 'Month'}
              min="1"
              max="12"
              className={`h-12 ${errors.dob ? 'border-red-500' : ''}`}
            />
            <Input
              type="number"
              value={formData.dobYear}
              onChange={(e) => updateField('dobYear', e.target.value)}
              placeholder={t('payments.stripe.wizard.year') || 'Year'}
              min="1920"
              max={new Date().getFullYear() - 18}
              className={`h-12 ${errors.dob ? 'border-red-500' : ''}`}
            />
          </div>
          {errors.dob && <p className="text-xs text-red-500">{errors.dob}</p>}
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={prevStep} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          {t('common.back') || 'Back'}
        </Button>
        <Button
          onClick={nextStep}
          style={{ background: 'linear-gradient(135deg, #635BFF 0%, #4F46E5 100%)' }}
          className="text-white gap-2"
        >
          {t('common.next') || 'Next'}
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  // Render address step
  const renderAddressStep = () => (
    <div className="space-y-6">
      <StepIndicator />

      <div className="text-center mb-6">
        <h3 className="text-xl font-semibold text-[var(--v2-text-primary)]">
          {t('payments.stripe.wizard.address_title') || 'Your Address'}
        </h3>
        <p className="text-sm text-[var(--v2-text-muted)] mt-1">
          {t('payments.stripe.wizard.address_desc') || 'Where should we send important documents?'}
        </p>
      </div>

      <div className="grid gap-4">
        {/* Street address */}
        <div className="space-y-2">
          <Label htmlFor="addressLine1">{t('payments.stripe.wizard.street') || 'Street Address'} *</Label>
          <Input
            id="addressLine1"
            value={formData.addressLine1}
            onChange={(e) => updateField('addressLine1', e.target.value)}
            placeholder={requiresEnglishOnly ? '123 Main St (English only)' : '123 Main St'}
            className={`h-12 ${errors.addressLine1 ? 'border-red-500' : ''}`}
            dir="ltr"
          />
          {errors.addressLine1 && <p className="text-xs text-red-500">{errors.addressLine1}</p>}
        </div>

        {/* Apt/Suite */}
        <div className="space-y-2">
          <Label htmlFor="addressLine2">{t('payments.stripe.wizard.apt') || 'Apt / Suite'}</Label>
          <Input
            id="addressLine2"
            value={formData.addressLine2}
            onChange={(e) => updateField('addressLine2', e.target.value)}
            placeholder="Apt 4B"
            className="h-12"
            dir="ltr"
          />
        </div>

        {/* City and State */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="city">{t('payments.stripe.wizard.city') || 'City'} *</Label>
            <Input
              id="city"
              value={formData.city}
              onChange={(e) => updateField('city', e.target.value)}
              placeholder={requiresEnglishOnly ? 'Tel Aviv (English only)' : 'New York'}
              className={`h-12 ${errors.city ? 'border-red-500' : ''}`}
              dir="ltr"
            />
            {errors.city && <p className="text-xs text-red-500">{errors.city}</p>}
          </div>

          {formData.country === 'US' ? (
            <div className="space-y-2">
              <Label>{t('payments.stripe.wizard.state') || 'State'} *</Label>
              <SearchableSelect
                value={formData.state}
                onChange={(val) => updateField('state', val)}
                options={filteredStates}
                search={stateSearch}
                onSearchChange={setStateSearch}
                placeholder={t('payments.stripe.wizard.select_state') || 'Select state'}
                error={errors.state}
                renderOption={(state) => (
                  <span className="flex-1">{state.name}</span>
                )}
                renderValue={(code) => {
                  const state = US_STATES.find(s => s.code === code);
                  return state?.name || '';
                }}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="state">{t('payments.stripe.wizard.state_province') || 'State / Province'}</Label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => updateField('state', e.target.value)}
                className="h-12"
                dir="ltr"
              />
            </div>
          )}
        </div>

        {/* Postal code and SSN */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="postalCode">{t('payments.stripe.wizard.postal') || 'Postal Code'} *</Label>
            <Input
              id="postalCode"
              value={formData.postalCode}
              onChange={(e) => updateField('postalCode', e.target.value)}
              placeholder="10001"
              className={`h-12 ${errors.postalCode ? 'border-red-500' : ''}`}
              dir="ltr"
            />
            {errors.postalCode && <p className="text-xs text-red-500">{errors.postalCode}</p>}
          </div>

          {formData.country === 'US' && (
            <div className="space-y-2">
              <Label htmlFor="ssnLast4">{t('payments.stripe.wizard.ssn') || 'SSN (last 4)'} *</Label>
              <Input
                id="ssnLast4"
                value={formData.ssnLast4}
                onChange={(e) => updateField('ssnLast4', e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="1234"
                maxLength={4}
                className={`h-12 ${errors.ssnLast4 ? 'border-red-500' : ''}`}
                dir="ltr"
              />
              {errors.ssnLast4 && <p className="text-xs text-red-500">{errors.ssnLast4}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={prevStep} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          {t('common.back') || 'Back'}
        </Button>
        <Button
          onClick={nextStep}
          style={{ background: 'linear-gradient(135deg, #635BFF 0%, #4F46E5 100%)' }}
          className="text-white gap-2"
        >
          {t('common.next') || 'Next'}
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  // Render business step
  const renderBusinessStep = () => (
    <div className="space-y-6">
      <StepIndicator />

      <div className="text-center mb-6">
        <h3 className="text-xl font-semibold text-[var(--v2-text-primary)]">
          {t('payments.stripe.wizard.business_title') || 'Business Details'}
        </h3>
        <p className="text-sm text-[var(--v2-text-muted)] mt-1">
          {t('payments.stripe.wizard.business_desc') || 'Tell us about your business'}
        </p>
      </div>

      <div className="grid gap-4">
        {/* Industry */}
        <div className="space-y-2">
          <Label>{t('payments.stripe.wizard.industry') || 'Industry'} *</Label>
          <SearchableSelect
            value={formData.industry}
            onChange={(val) => updateField('industry', val)}
            options={filteredIndustries}
            search={industrySearch}
            onSearchChange={setIndustrySearch}
            placeholder={t('payments.stripe.wizard.select_industry') || 'Select your industry'}
            error={errors.industry}
            renderOption={(industry) => (
              <span className="flex-1">{getIndustryName(industry)}</span>
            )}
            renderValue={(code) => {
              const industry = INDUSTRIES.find(i => i.code === code);
              return industry ? getIndustryName(industry) : '';
            }}
          />
        </div>

        {/* Business name */}
        <div className="space-y-2">
          <Label htmlFor="businessName">{t('payments.stripe.wizard.business_name') || 'Business Name'}</Label>
          <Input
            id="businessName"
            value={formData.businessName}
            onChange={(e) => updateField('businessName', e.target.value)}
            placeholder={requiresEnglishOnly ? 'My Business LLC (English only)' : 'My Business LLC'}
            className={`h-12 ${errors.businessName ? 'border-red-500' : ''}`}
            dir="ltr"
          />
          {errors.businessName && <p className="text-xs text-red-500">{errors.businessName}</p>}
          <p className="text-xs text-[var(--v2-text-muted)]">
            {t('payments.stripe.wizard.business_name_hint') || 'Leave empty to use your full name'}
          </p>
        </div>

        {/* Website */}
        <div className="space-y-2">
          <Label htmlFor="businessUrl">{t('payments.stripe.wizard.website') || 'Website'}</Label>
          <Input
            id="businessUrl"
            value={formData.businessUrl}
            onChange={(e) => updateField('businessUrl', e.target.value)}
            placeholder="https://mybusiness.com"
            className="h-12"
            dir="ltr"
          />
        </div>
      </div>

      <div className="flex justify-between pt-4">
        <Button variant="ghost" onClick={prevStep} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          {t('common.back') || 'Back'}
        </Button>
        <Button
          onClick={nextStep}
          style={{ background: 'linear-gradient(135deg, #635BFF 0%, #4F46E5 100%)' }}
          className="text-white gap-2"
        >
          {t('common.next') || 'Next'}
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );

  // Render review step
  const renderReviewStep = () => {
    const country = SUPPORTED_COUNTRIES.find(c => c.code === formData.country);
    const industry = INDUSTRIES.find(i => i.code === formData.industry);

    return (
      <div className="space-y-6">
        <StepIndicator />

        <div className="text-center mb-6">
          <h3 className="text-xl font-semibold text-[var(--v2-text-primary)]">
            {t('payments.stripe.wizard.review_title') || 'Review & Confirm'}
          </h3>
          <p className="text-sm text-[var(--v2-text-muted)] mt-1">
            {t('payments.stripe.wizard.review_desc') || 'Please verify your information before submitting'}
          </p>
        </div>

        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid gap-3">
            <div className="p-4 rounded-lg bg-[var(--v2-bg)] border border-[var(--v2-border)]">
              <div className="flex items-center gap-3 mb-2">
                <Globe className="w-5 h-5 text-[#635BFF]" />
                <span className="font-medium">{t('payments.stripe.wizard.step_country') || 'Country'}</span>
              </div>
              <p className="text-sm text-[var(--v2-text-secondary)] ps-8">
                {country?.flag} {country ? getCountryName(country) : ''}
              </p>
            </div>

            <div className="p-4 rounded-lg bg-[var(--v2-bg)] border border-[var(--v2-border)]">
              <div className="flex items-center gap-3 mb-2">
                <User className="w-5 h-5 text-[#635BFF]" />
                <span className="font-medium">{t('payments.stripe.wizard.step_personal') || 'Personal'}</span>
              </div>
              <div className="text-sm text-[var(--v2-text-secondary)] ps-8 space-y-1">
                <p>{formData.firstName} {formData.lastName}</p>
                <p>{formData.email}</p>
                {formData.phone && <p>{formData.phone}</p>}
              </div>
            </div>

            <div className="p-4 rounded-lg bg-[var(--v2-bg)] border border-[var(--v2-border)]">
              <div className="flex items-center gap-3 mb-2">
                <MapPin className="w-5 h-5 text-[#635BFF]" />
                <span className="font-medium">{t('payments.stripe.wizard.step_address') || 'Address'}</span>
              </div>
              <div className="text-sm text-[var(--v2-text-secondary)] ps-8">
                <p>{formData.addressLine1}</p>
                {formData.addressLine2 && <p>{formData.addressLine2}</p>}
                <p>{formData.city}{formData.state ? `, ${formData.state}` : ''} {formData.postalCode}</p>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-[var(--v2-bg)] border border-[var(--v2-border)]">
              <div className="flex items-center gap-3 mb-2">
                <Briefcase className="w-5 h-5 text-[#635BFF]" />
                <span className="font-medium">{t('payments.stripe.wizard.step_business') || 'Business'}</span>
              </div>
              <div className="text-sm text-[var(--v2-text-secondary)] ps-8 space-y-1">
                <p>{industry ? getIndustryName(industry) : ''}</p>
                {formData.businessName && <p>{formData.businessName}</p>}
                {formData.businessUrl && <p>{formData.businessUrl}</p>}
              </div>
            </div>
          </div>

          {/* Terms of Service */}
          <div className="p-4 rounded-lg bg-[var(--v2-bg)] border border-[var(--v2-border)]">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.tosAccepted}
                onChange={(e) => updateField('tosAccepted', e.target.checked)}
                className="mt-1 w-5 h-5 rounded border-[var(--v2-border)] text-[#635BFF] focus:ring-[#635BFF]"
              />
              <span className="text-sm text-[var(--v2-text-secondary)]">
                {t('payments.stripe.wizard.tos_text') || 'I agree to the'}{' '}
                <a href="https://stripe.com/connect-account/legal" target="_blank" rel="noopener noreferrer" className="text-[#635BFF] hover:underline">
                  {t('payments.stripe.wizard.tos_link') || 'Stripe Connected Account Agreement'}
                </a>
                {' '}{t('payments.stripe.wizard.tos_and') || 'and'}{' '}
                <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="text-[#635BFF] hover:underline">
                  {t('payments.stripe.wizard.privacy_link') || 'Privacy Policy'}
                </a>
              </span>
            </label>
            {errors.tosAccepted && <p className="text-xs text-red-500 mt-2 ps-8">{errors.tosAccepted}</p>}
          </div>
        </div>

        <div className="flex justify-between pt-4">
          <Button variant="ghost" onClick={prevStep} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            {t('common.back') || 'Back'}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={processing}
            style={{ background: 'linear-gradient(135deg, #635BFF 0%, #4F46E5 100%)' }}
            className="text-white gap-2 px-8"
          >
            {processing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('payments.stripe.wizard.creating') || 'Creating...'}
              </>
            ) : (
              <>
                <Shield className="w-4 h-4" />
                {isContinueMode
                  ? (t('payments.stripe.wizard.continue_setup_btn') || 'Continue Setup')
                  : (t('payments.stripe.wizard.create_account_btn') || 'Create Account')
                }
              </>
            )}
          </Button>
        </div>
      </div>
    );
  };

  // Render success step
  const renderSuccess = () => (
    <div className="py-8">
      <div className="text-center space-y-4">
        <div className="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-12 h-12 text-green-600 dark:text-green-400" />
        </div>
        <div>
          <h3 className="text-2xl font-bold text-[var(--v2-text-primary)]">
            {t('payments.stripe.wizard.success_title') || 'Account Created!'}
          </h3>
          <p className="text-[var(--v2-text-muted)] mt-2">
            {t('payments.stripe.wizard.success_desc') || 'Your Stripe account has been created successfully'}
          </p>
        </div>
        <div className="animate-pulse pt-4">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--v2-text-muted)] mx-auto" />
          <p className="text-sm text-[var(--v2-text-muted)] mt-2">
            {t('payments.stripe.wizard.finalizing') || 'Finalizing...'}
          </p>
        </div>
      </div>
    </div>
  );

  // Render embedded onboarding step
  const renderEmbeddedStep = () => (
    <div className="space-y-4">
      <div className="text-center mb-4">
        <div className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center bg-green-100 dark:bg-green-900/30">
          <CheckCircle2 className="w-7 h-7 text-green-600 dark:text-green-400" />
        </div>
        <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
          {t('payments.stripe.wizard.account_created') || 'Account Created!'}
        </h3>
        <p className="text-sm text-[var(--v2-text-muted)] mt-1">
          {t('payments.stripe.wizard.complete_verification') || 'Complete the final verification steps below to start accepting payments.'}
        </p>
      </div>

      <StripeEmbeddedOnboarding
        onComplete={onComplete}
        onExit={onCancel}
      />
    </div>
  );

  // Render error step
  const renderError = () => (
    <div className="py-8">
      <div className="text-center space-y-4">
        <div className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto">
          <AlertCircle className="w-12 h-12 text-red-600 dark:text-red-400" />
        </div>
        <div>
          <h3 className="text-2xl font-bold text-[var(--v2-text-primary)]">
            {t('payments.stripe.wizard.error_title') || 'Setup Failed'}
          </h3>
          <p className="text-[var(--v2-text-muted)] mt-2">
            {errorMessage || t('payments.stripe.wizard.error_default') || 'Something went wrong'}
          </p>
        </div>
        <div className="flex gap-3 justify-center pt-4">
          <Button variant="outline" onClick={onCancel}>
            {t('common.cancel') || 'Cancel'}
          </Button>
          <Button
            onClick={() => setStep(isContinueMode ? 'country' : 'choice')}
            style={{ background: 'linear-gradient(135deg, #635BFF 0%, #4F46E5 100%)' }}
            className="text-white"
          >
            {t('common.try_again') || 'Try Again'}
          </Button>
        </div>
      </div>
    </div>
  );

  // Loading state
  if (loadingAccountDetails) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <Loader2 className="w-10 h-10 animate-spin text-[#635BFF]" />
        <p className="text-[var(--v2-text-muted)]">
          {t('payments.stripe.wizard.loading_account') || 'Loading your account...'}
        </p>
      </div>
    );
  }

  return (
    <div className={step === 'embedded' ? 'max-w-2xl mx-auto' : 'max-w-lg mx-auto'} dir={isRTL ? 'rtl' : 'ltr'}>
      {step === 'choice' && renderChoice()}
      {step === 'country' && renderCountryStep()}
      {step === 'personal' && renderPersonalStep()}
      {step === 'address' && renderAddressStep()}
      {step === 'business' && renderBusinessStep()}
      {step === 'review' && renderReviewStep()}
      {step === 'embedded' && renderEmbeddedStep()}
      {(step === 'processing' || step === 'success') && renderSuccess()}
      {step === 'error' && renderError()}
    </div>
  );
}
