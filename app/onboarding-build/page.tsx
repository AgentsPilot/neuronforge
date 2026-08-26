'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Building2,
  Users,
  Calendar,
  CreditCard,
  Globe,
  CheckCircle2,
  Loader2,
  Sparkles,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { V2Logo } from '@/components/v2/V2Header';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { cn } from '@/lib/utils';

interface PreviewData {
  businessProfile?: {
    company_name?: string;
    vertical?: string;
    verticalDisplayName?: string;
    language?: string;
  };
  pipelineStages?: Array<{
    stage_key: string;
    stage_label: string;
    position: number;
    color: string;
  }>;
  services?: Array<{
    service_name: string;
    duration_minutes: number;
    price: number | null;
    currency?: string;
  }>;
  businessDescription?: string;
  configuration?: {
    company_name?: string;
    vertical?: string;
    description?: string;
    clients_per_week?: number;
    pain_points?: string[];
    goals?: string[];
    tools?: string[];
    services?: Array<{
      name: string;
      duration_minutes?: number | null;
      price?: number;
      is_scheduled?: boolean;
    }>;
    online_presence_mode?: 'full_website' | 'booking_only' | 'website_only' | 'none';
    payment_mode?: 'none' | 'upfront' | 'invoicing' | 'installments';
    needs_stripe_connect?: boolean;
    pipeline_stages?: Array<{
      stage_key: string;
      stage_label: string;
      position: number;
      color: string;
    }>;
    capabilities?: string[];
    building_blocks?: Record<string, string[]>;
    capability_reasons?: Record<string, string>;
  };
}

interface BuildStep {
  id: string;
  label: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  icon: React.ReactNode;
}

// Loading component for Suspense fallback
function BuildPageLoading() {
  return (
    <div className="min-h-screen bg-[var(--v2-bg)] flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-[var(--v2-primary)]" />
        <p className="text-lg text-[var(--v2-text-secondary)]">Loading...</p>
      </div>
    </div>
  );
}

// Main page component that wraps content in Suspense
export default function OnboardingBuildPage() {
  return (
    <Suspense fallback={<BuildPageLoading />}>
      <OnboardingBuildContent />
    </Suspense>
  );
}

// Inner component that uses useSearchParams
function OnboardingBuildContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { language: contextLanguage } = useLanguage();

  // Get language from URL params or context
  const languageParam = searchParams.get('lang') as 'en' | 'he' | 'es' | null;
  const selectedLanguage = languageParam || contextLanguage || 'en';
  const isRTL = selectedLanguage === 'he';

  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildComplete, setBuildComplete] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildSteps, setBuildSteps] = useState<BuildStep[]>([]);

  // Ref to prevent double build calls in StrictMode
  const buildStartedRef = React.useRef(false);

  const initializeBuildSteps = useCallback((data: PreviewData): BuildStep[] => {
    const hasWebsite = data.configuration?.online_presence_mode === 'full_website' ||
                       data.configuration?.online_presence_mode === 'website_only';
    const hasServices = (data.services?.length || 0) > 0 ||
                        (data.configuration?.services?.length || 0) > 0;
    const hasPipeline = (data.pipelineStages?.length || 0) > 0 ||
                        (data.configuration?.pipeline_stages?.length || 0) > 0;
    const hasPayments = data.configuration?.payment_mode !== 'none';

    const steps: BuildStep[] = [
      {
        id: 'profile',
        label: selectedLanguage === 'he' ? 'יצירת פרופיל עסקי' : selectedLanguage === 'es' ? 'Creando perfil de negocio' : 'Creating business profile',
        status: 'pending',
        icon: <Building2 className="w-5 h-5" />
      }
    ];

    if (hasPipeline) {
      steps.push({
        id: 'pipeline',
        label: selectedLanguage === 'he' ? 'הגדרת צינור לקוחות' : selectedLanguage === 'es' ? 'Configurando pipeline' : 'Setting up client pipeline',
        status: 'pending',
        icon: <Users className="w-5 h-5" />
      });
    }

    if (hasServices) {
      steps.push({
        id: 'services',
        label: selectedLanguage === 'he' ? 'יצירת שירותים' : selectedLanguage === 'es' ? 'Creando servicios' : 'Creating services',
        status: 'pending',
        icon: <Calendar className="w-5 h-5" />
      });
    }

    if (hasPayments) {
      steps.push({
        id: 'payments',
        label: selectedLanguage === 'he' ? 'הגדרת תשלומים' : selectedLanguage === 'es' ? 'Configurando pagos' : 'Setting up payments',
        status: 'pending',
        icon: <CreditCard className="w-5 h-5" />
      });
    }

    if (hasWebsite) {
      steps.push({
        id: 'website',
        label: selectedLanguage === 'he' ? 'יצירת אתר' : selectedLanguage === 'es' ? 'Generando sitio web' : 'Generating website',
        status: 'pending',
        icon: <Globe className="w-5 h-5" />
      });
    }

    return steps;
  }, [selectedLanguage]);

  const startBuild = useCallback(async (data: PreviewData) => {
    setIsBuilding(true);
    setBuildError(null);

    const steps = initializeBuildSteps(data);
    setBuildSteps(steps);

    // Helper to update step status
    const updateStep = (stepId: string, status: 'pending' | 'in_progress' | 'completed' | 'error') => {
      setBuildSteps(prev => prev.map(s => s.id === stepId ? { ...s, status } : s));
    };

    // Simulate step-by-step progress with the actual API call
    const simulateProgress = async () => {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        updateStep(step.id, 'in_progress');
        await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 600));
        updateStep(step.id, 'completed');
      }
    };

    try {
      // Start progress simulation
      const progressPromise = simulateProgress();

      const response = await fetch('/api/onboarding/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configuration: data.configuration,
          profile: {
            company_name: data.businessProfile?.company_name,
            vertical: data.businessProfile?.vertical,
            language: data.businessProfile?.language || selectedLanguage,
            description: data.businessDescription
          },
          services: data.services,
          pipelineStages: data.pipelineStages,
          language: selectedLanguage
        })
      });

      if (!response.ok) {
        throw new Error('Build failed');
      }

      const result = await response.json();

      // Wait for progress animation to complete
      await progressPromise;

      // Clear session storage
      sessionStorage.removeItem('onboarding_preview_data');

      // Mark as complete
      setBuildComplete(true);

      // Redirect after a short delay
      setTimeout(() => {
        router.push(result.redirect || '/business-os');
      }, 2000);

    } catch (error) {
      console.error('Build error:', error);
      setBuildError(
        selectedLanguage === 'he'
          ? 'אירעה שגיאה בבניית המערכת. אנא נסה שוב.'
          : selectedLanguage === 'es'
          ? 'Hubo un error al construir el sistema. Por favor, inténtalo de nuevo.'
          : 'There was an error building the system. Please try again.'
      );
      setIsBuilding(false);
    }
  }, [router, selectedLanguage, initializeBuildSteps]);

  // Load preview data from session storage
  useEffect(() => {
    let cancelled = false;

    const loadPreviewData = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          router.push('/login');
          return;
        }

        const storedData = sessionStorage.getItem('onboarding_preview_data');
        if (storedData && !cancelled) {
          const parsed = JSON.parse(storedData) as PreviewData;
          setPreviewData(parsed);
          setIsLoading(false);
        } else if (!cancelled) {
          router.push('/onboarding-chat');
        }
      } catch (error) {
        console.error('Error loading preview data:', error);
        if (!cancelled) {
          router.push('/onboarding-chat');
        }
      }
    };

    loadPreviewData();
    return () => { cancelled = true; };
  }, [router]);

  // Auto-start build when preview data is loaded (with StrictMode protection)
  useEffect(() => {
    if (previewData && !buildStartedRef.current && !isBuilding && !buildComplete) {
      const hasData = previewData.configuration || previewData.businessProfile;
      if (hasData) {
        buildStartedRef.current = true; // Mark synchronously to prevent double-calls
        const timeoutId = setTimeout(() => startBuild(previewData), 500);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [previewData, isBuilding, buildComplete, startBuild]);

  const handleRetry = () => {
    if (previewData) {
      startBuild(previewData);
    }
  };

  const handleGoBack = () => {
    router.push('/onboarding-chat');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--v2-bg)] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-[var(--v2-primary)]" />
          <p className="text-lg text-[var(--v2-text-secondary)]">
            {selectedLanguage === 'he' ? 'טוען...' : selectedLanguage === 'es' ? 'Cargando...' : 'Loading...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--v2-bg)]" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="border-b border-[var(--v2-border)] bg-[var(--v2-surface)]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <V2Logo />
        </div>
      </div>

      {/* Main Content - Compact */}
      <div className="max-w-md mx-auto px-4 sm:px-6 py-8">
        <div className="relative">
          {/* Compact Card */}
          <div className="relative bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl p-6 shadow-lg">
            {/* Header Section - Compact */}
            <div className="relative text-center mb-6">
              <div className="w-14 h-14 mx-auto mb-4 bg-gradient-to-br from-[var(--v2-primary)] to-[var(--v2-primary)]/70 rounded-xl flex items-center justify-center shadow-md">
                {buildComplete ? (
                  <CheckCircle2 className="w-7 h-7 text-white" />
                ) : buildError ? (
                  <AlertCircle className="w-7 h-7 text-white" />
                ) : (
                  <Sparkles className="w-7 h-7 text-white animate-pulse" />
                )}
              </div>

              <h1 className="text-xl font-bold text-[var(--v2-text-primary)] mb-1">
                {buildComplete
                  ? (selectedLanguage === 'he' ? 'המערכת מוכנה!' : selectedLanguage === 'es' ? '¡Sistema listo!' : 'System Ready!')
                  : buildError
                  ? (selectedLanguage === 'he' ? 'אירעה שגיאה' : selectedLanguage === 'es' ? 'Ocurrió un error' : 'An Error Occurred')
                  : (selectedLanguage === 'he' ? 'בונה את המערכת שלך' : selectedLanguage === 'es' ? 'Construyendo tu sistema' : 'Building Your System')}
              </h1>

              <p className="text-sm text-[var(--v2-text-secondary)]">
                {buildComplete
                  ? (selectedLanguage === 'he' ? 'הכל מוכן! מעביר אותך לדשבורד...' : selectedLanguage === 'es' ? '¡Todo listo! Redirigiendo al dashboard...' : 'All set! Redirecting to dashboard...')
                  : buildError
                  ? buildError
                  : (selectedLanguage === 'he' ? 'רק עוד רגע...' : selectedLanguage === 'es' ? 'Solo un momento...' : 'Just a moment...')}
              </p>
            </div>

            {/* Business Summary - Compact inline */}
            {previewData?.businessProfile?.company_name && !buildComplete && (
              <div className="relative mb-5 p-3 bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-[var(--v2-primary)]/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Building2 className="w-4 h-4 text-[var(--v2-primary)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-[var(--v2-text-primary)] truncate">
                      {previewData.businessProfile.company_name}
                    </p>
                  </div>
                  {previewData.businessProfile.verticalDisplayName && (
                    <span className="text-[10px] font-medium text-[var(--v2-primary)] bg-[var(--v2-primary)]/10 px-2 py-1 rounded-full flex-shrink-0">
                      {previewData.businessProfile.verticalDisplayName}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Progress Steps - Compact */}
            {isBuilding && !buildError && (
              <div className="relative space-y-2">
                {buildSteps.map((step) => (
                  <div
                    key={step.id}
                    className={cn(
                      'flex items-center gap-3 p-2.5 rounded-lg transition-all duration-300',
                      step.status === 'completed' && 'bg-emerald-50',
                      step.status === 'in_progress' && 'bg-[#4F6EF7]/5',
                      step.status === 'pending' && 'opacity-40'
                    )}
                  >
                    {/* Icon */}
                    <div
                      className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 flex-shrink-0',
                        step.status === 'completed' && 'bg-emerald-500 text-white',
                        step.status === 'in_progress' && 'bg-[#4F6EF7] text-white',
                        step.status === 'pending' && 'bg-gray-200 text-gray-400'
                      )}
                    >
                      {step.status === 'completed' ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : step.status === 'in_progress' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <span className="[&>svg]:w-4 [&>svg]:h-4">{step.icon}</span>
                      )}
                    </div>

                    {/* Label */}
                    <span
                      className={cn(
                        'flex-1 text-sm font-medium transition-all duration-300',
                        step.status === 'completed' && 'text-emerald-600',
                        step.status === 'in_progress' && 'text-[#4F6EF7]',
                        step.status === 'pending' && 'text-gray-400'
                      )}
                    >
                      {step.label}
                    </span>

                    {/* Checkmark for completed */}
                    {step.status === 'completed' && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Overall Progress Bar - Compact */}
            {isBuilding && !buildError && buildSteps.length > 0 && (
              <div className="mt-5">
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#4F6EF7] transition-all duration-500 ease-out"
                    style={{
                      width: `${(buildSteps.filter(s => s.status === 'completed').length / buildSteps.length) * 100}%`
                    }}
                  />
                </div>
                <p className="text-center text-xs text-[var(--v2-text-muted)] mt-2">
                  {buildSteps.filter(s => s.status === 'completed').length} / {buildSteps.length}{' '}
                  {selectedLanguage === 'he' ? 'שלבים' : selectedLanguage === 'es' ? 'pasos' : 'steps'}
                </p>
              </div>
            )}

            {/* Success State - Compact */}
            {buildComplete && (
              <div className="text-center mt-5">
                <div className="inline-flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full mb-4 text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="font-medium">
                    {selectedLanguage === 'he' ? 'הושלם!' : selectedLanguage === 'es' ? '¡Completado!' : 'Complete!'}
                  </span>
                </div>

                <button
                  onClick={() => router.push('/business-os')}
                  className="w-full px-4 py-3 bg-[#4F6EF7] text-white text-sm font-semibold rounded-lg hover:bg-[#3B5AE5] transition-all flex items-center justify-center gap-2"
                >
                  {selectedLanguage === 'he' ? 'עבור לדשבורד' : selectedLanguage === 'es' ? 'Ir al dashboard' : 'Go to Dashboard'}
                  <ArrowRight className={cn('w-4 h-4', isRTL && 'rotate-180')} />
                </button>
              </div>
            )}

            {/* Error State - Compact */}
            {buildError && (
              <div className="mt-5 space-y-2">
                <button
                  onClick={handleRetry}
                  className="w-full px-4 py-3 bg-[#4F6EF7] text-white text-sm font-semibold rounded-lg hover:bg-[#3B5AE5] transition-all"
                >
                  {selectedLanguage === 'he' ? 'נסה שוב' : selectedLanguage === 'es' ? 'Intentar de nuevo' : 'Try Again'}
                </button>

                <button
                  onClick={handleGoBack}
                  className="w-full px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] text-sm font-medium border border-[var(--v2-border)] rounded-lg hover:bg-gray-50 transition-all"
                >
                  {selectedLanguage === 'he' ? 'חזור לצ\'אט' : selectedLanguage === 'es' ? 'Volver al chat' : 'Go Back to Chat'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
