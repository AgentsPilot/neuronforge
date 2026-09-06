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
  ClipboardList,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { V2Logo } from '@/components/v2/V2Header';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { SetupFactCard, SetupFactDeck } from '@/components/business-os/setup/SetupFactCard';
import { ClientJourneyStrip } from '@/components/business-os/setup/ClientJourneyStrip';
import { ConfigurationDialog } from '@/components/business-os/ConfigurationDialog';
import { StripeConnectWizard } from '@/components/payments/StripeConnectWizard';
import { InvoiceSettingsSection } from '@/components/business-os/settings/InvoiceSettingsSection';
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
    duration_minutes: number | null;
    price: number | null;
    currency?: string;
    /** Does a client pick a time? Decides the date step, and whether hours are owed. */
    is_scheduled?: boolean;
    /** How the money arrives. Decides whether a processor or bank details are owed. */
    collection?: 'online' | 'invoice' | null;
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
    /** Clients fill in a form before their appointment. */
    needs_intake?: boolean;
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
  /** What the card reports once the work is finished — a result, not "completed". */
  result?: string;
  /** The colour of the part of the platform this belongs to. */
  color?: string;
  /**
   * Work only this person can do. Never turned green by the build, because the
   * build cannot do it — it stays open so the next action is obvious without a
   * screen announcing it.
   */
  yours?: boolean;
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
  const { language: contextLanguage, t } = useLanguage();

  // Get language from URL params or context
  const languageParam = searchParams.get('lang') as 'en' | 'he' | 'es' | null;
  const selectedLanguage = languageParam || contextLanguage || 'en';
  const isRTL = selectedLanguage === 'he';

  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildComplete, setBuildComplete] = useState(false);
  /**
   * The owner-only steps still open, and the doors they open.
   *
   * Each is settled in place rather than navigated to: the configuration
   * dialogs are self-contained and already fetch their own data, so mounting
   * one here keeps the user on the screen that is telling them why it matters.
   */
  const [settled, setSettled] = useState<Record<string, boolean>>({});
  const [openStep, setOpenStep] = useState<'availability' | 'stripe' | 'bank' | 'intake' | null>(null);
  /** Needed to mount the invoice settings in place rather than navigating to them. */
  const [userId, setUserId] = useState<string | null>(null);
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
        label: selectedLanguage === 'he' ? 'העסק שלך' : selectedLanguage === 'es' ? 'Tu negocio' : 'Your business',
        status: 'pending',
        icon: <Building2 className="w-4 h-4" />,
        color: '#8B5CF6',
        result: selectedLanguage === 'he' ? 'הפרופיל נוצר' : selectedLanguage === 'es' ? 'Perfil creado' : 'Profile created',
      }
    ];

    if (hasPipeline) {
      steps.push({
        id: 'pipeline',
        label: selectedLanguage === 'he' ? 'מסע הלקוח שלך' : selectedLanguage === 'es' ? 'Tu recorrido de cliente' : 'Your client journey',
        status: 'pending',
        icon: <Users className="w-4 h-4" />,
        color: '#8B5CF6',
        result: `${(data.pipelineStages?.length || data.configuration?.pipeline_stages?.length || 0)} ${
          selectedLanguage === 'he' ? 'שלבים נוצרו' : selectedLanguage === 'es' ? 'etapas creadas' : 'stages created'
        }`,
      });
    }

    if (hasServices) {
      steps.push({
        id: 'services',
        label: selectedLanguage === 'he' ? 'מה שאתה מוכר' : selectedLanguage === 'es' ? 'Lo que vendes' : 'What you sell',
        status: 'pending',
        icon: <Calendar className="w-4 h-4" />,
        color: '#D14E97',
        result: `${(data.services?.length || data.configuration?.services?.length || 0)} ${
          selectedLanguage === 'he' ? 'שירותים נוצרו, עם מחירים ומשך' : selectedLanguage === 'es' ? 'servicios creados, con precios y duración' : 'services created, prices and durations set'
        }`,
      });
    }

    if (hasPayments) {
      steps.push({
        id: 'payments',
        label: selectedLanguage === 'he' ? 'מספור חשבוניות' : selectedLanguage === 'es' ? 'Numeración de facturas' : 'Invoice numbering',
        status: 'pending',
        icon: <CreditCard className="w-4 h-4" />,
        color: '#22C58B',
        result: selectedLanguage === 'he' ? 'מוכן להוציא חשבוניות' : selectedLanguage === 'es' ? 'Listo para facturar' : 'Ready to invoice',
      });
    }

    {
      steps.push({
        id: 'website',
        label: selectedLanguage === 'he' ? 'איך לקוחות מגיעים אליך' : selectedLanguage === 'es' ? 'Cómo te encuentran' : 'How clients reach you',
        status: 'pending',
        icon: <Globe className="w-4 h-4" />,
        color: '#4F6EF7',
        result: hasWebsite
          ? (selectedLanguage === 'he' ? 'האתר שלך פורסם' : selectedLanguage === 'es' ? 'Tu sitio está publicado' : 'Your site is published')
          : (selectedLanguage === 'he' ? 'הלינק להזמנות מוכן' : selectedLanguage === 'es' ? 'Tu enlace de reserva está listo' : 'Your booking link is ready'),
      });
    }

    // The cards the build never turns green.
    //
    // Read off the services, not off one business-wide answer: a practice that
    // takes a card for a session and invoices for a programme owes both, and a
    // consultancy that invoices for everything owes neither a processor nor an
    // explanation of why it was asked for one.
    const services = data.services || [];
    const priced = services.filter(service => (service.price || 0) > 0);
    const wantsHours = services.some(service => service.is_scheduled !== false);
    const collectsOnline = priced.some(service => service.collection === 'online');
    const invoicesSome = priced.some(service => service.collection !== 'online');

    // Hours are the platform's kind of work, but only this person knows when
    // they work — and a booking link with no hours behind it is the single
    // most common way a business arrives at the dashboard unable to trade.
    if (wantsHours) {
      steps.push({
        id: 'availability',
        label: selectedLanguage === 'he' ? 'שעות הפעילות שלך' : selectedLanguage === 'es' ? 'Tu horario' : 'Your working hours',
        status: 'pending',
        icon: <Calendar className="w-4 h-4" />,
        yours: true,
        result: selectedLanguage === 'he'
          ? 'רק את/ה יודע/ת מתי את/ה עובד/ת. בלי זה אין מה להזמין. בערך 2 דקות.'
          : selectedLanguage === 'es'
            ? 'Solo tú sabes cuándo trabajas. Sin esto no hay nada que reservar. Unos 2 minutos.'
            : 'Only you know when you work. Without it there is nothing to book. About 2 minutes.',
      });
    }

    if (collectsOnline) {
      steps.push({
        id: 'stripe',
        label: selectedLanguage === 'he' ? 'חיבור תשלומים' : selectedLanguage === 'es' ? 'Conectar pagos' : 'Connect payments',
        status: 'pending',
        icon: <CreditCard className="w-4 h-4" />,
        yours: true,
        result: selectedLanguage === 'he'
          ? 'דורש אותך — סטרייפ מבקשת תעודת זהות וחשבון בנק. בערך 5 דקות.'
          : selectedLanguage === 'es'
            ? 'Te necesita — Stripe pide tu identificación y una cuenta bancaria. Unos 5 minutos.'
            : 'Needs you — Stripe asks for your ID and a bank account. About 5 minutes.',
      });
    }

    // The one piece of configuration whose content only the business can
    // supply. We can create the form; what it asks their clients is theirs,
    // and guessing would put invented questions in front of real people.
    if ((data.configuration as any)?.needs_intake) {
      steps.push({
        id: 'intake',
        label: selectedLanguage === 'he' ? 'טופס הפנייה שלך' : selectedLanguage === 'es' ? 'Tu formulario de admisión' : 'Your intake form',
        status: 'pending',
        icon: <ClipboardList className="w-4 h-4" />,
        yours: true,
        result: selectedLanguage === 'he'
          ? 'בחר תבנית או הרכב את השאלות — רק את/ה יודע/ת מה צריך לדעת על לקוח לפני הפגישה. בערך 3 דקות.'
          : selectedLanguage === 'es'
            ? 'Elige una plantilla o arma las preguntas — solo tú sabes qué necesitas saber antes de la cita. Unos 3 minutos.'
            : 'Pick a template or build the questions — only you know what you need to know before an appointment. About 3 minutes.',
      });
    }

    if (invoicesSome) {
      steps.push({
        id: 'bank',
        label: selectedLanguage === 'he' ? 'פרטי הבנק שלך' : selectedLanguage === 'es' ? 'Tus datos bancarios' : 'Your bank details',
        status: 'pending',
        icon: <Building2 className="w-4 h-4" />,
        yours: true,
        result: selectedLanguage === 'he'
          ? 'דורש אותך — זה מה שמופיע בחשבונית כדי שהלקוח ידע לאן להעביר. בערך 2 דקות.'
          : selectedLanguage === 'es'
            ? 'Te necesita — es lo que aparece en la factura para que tu cliente sepa dónde transferir. Unos 2 minutos.'
            : 'Needs you — it goes on the invoice so your client knows where to send it. About 2 minutes.',
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

      // What actually got written, said out loud.
      //
      // The progress animation marked every step green on a timer, so a build
      // that created no services still ended with a row of ticks. A step now
      // reports what the server did with it, and a failure says which service
      // and why rather than leaving the user to find an empty table later.
      const failed: Array<{ name: string; reason: string }> = result.services_failed || [];
      const created: unknown[] = result.services || [];
      const stagesFailed: Array<{ name: string; reason: string }> = result.pipeline_stages_failed || [];

      if (stagesFailed.length > 0) {
        setBuildSteps(prev => prev.map(step => step.id !== 'pipeline' ? step : {
          ...step,
          status: 'error' as const,
          result: selectedLanguage === 'he'
            ? `${stagesFailed.length} שלבים לא נשמרו: ${stagesFailed.map(f => f.name).join(', ')}`
            : selectedLanguage === 'es'
              ? `${stagesFailed.length} etapas no se guardaron: ${stagesFailed.map(f => f.name).join(', ')}`
              : `${stagesFailed.length} stages could not be saved: ${stagesFailed.map(f => f.name).join(', ')}`,
        }));
      }

      if (failed.length > 0) {
        setBuildSteps(prev => prev.map(step => step.id !== 'services' ? step : {
          ...step,
          status: 'error' as const,
          result: selectedLanguage === 'he'
            ? `${failed.length} שירותים לא נשמרו: ${failed.map(f => f.name).join(', ')}`
            : selectedLanguage === 'es'
              ? `${failed.length} servicios no se guardaron: ${failed.map(f => f.name).join(', ')}`
              : `${failed.length} services could not be saved: ${failed.map(f => f.name).join(', ')}`,
        }));
      } else if (created.length > 0) {
        setBuildSteps(prev => prev.map(step => step.id !== 'services' ? step : {
          ...step,
          status: 'completed' as const,
          result: selectedLanguage === 'he'
            ? `${created.length} שירותים נוצרו`
            : selectedLanguage === 'es'
              ? `${created.length} servicios creados`
              : `${created.length} services created`,
        }));
      }

      // Kept, not cleared.
      //
      // Clearing here meant a refresh on the last mile found nothing and
      // bounced the user out — losing a screen that was in the middle of
      // telling them what they still owed. The data is thrown away when they
      // deliberately leave, and not before.
      sessionStorage.setItem('onboarding_build_complete', '1');

      // Mark as complete
      setBuildComplete(true);

      // No redirect.
      //
      // This is where the build used to print "הושלם!" and leave for the
      // dashboard two seconds later — while the orange cards on this same
      // screen, the work only the owner can do, were still open. The business
      // arrived at a dashboard that congratulated it over a booking link
      // leading to an empty calendar.
      //
      // Setup ends when the business can trade, not when the rows are written,
      // so the screen stays and the remaining work becomes actionable.

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
        if (!cancelled) setUserId(session.user.id);

        const storedData = sessionStorage.getItem('onboarding_preview_data');
        if (storedData && !cancelled) {
          const parsed = JSON.parse(storedData) as PreviewData;
          setPreviewData(parsed);

          // Came back to a build that already ran: show the last mile again
          // rather than building everything a second time. The owner-only
          // steps that were settled before the refresh are remembered too, so
          // connecting Stripe and then reloading does not ask for it again.
          if (sessionStorage.getItem('onboarding_build_complete') === '1') {
            buildStartedRef.current = true;
            setBuildSteps(initializeBuildSteps(parsed).map((step: BuildStep) =>
              step.yours ? step : { ...step, status: 'completed' as const }
            ));
            try {
              setSettled(JSON.parse(sessionStorage.getItem('onboarding_build_settled') || '{}'));
            } catch {
              setSettled({});
            }
            setBuildComplete(true);
          }

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
    // `initializeBuildSteps` is needed to restore a finished build on refresh.
  }, [router, initializeBuildSteps]);

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

  /** Mandatory work this business still owes, in the order the build named it. */
  const outstanding = buildSteps.filter(step => step.yours && !settled[step.id]);

  /**
   * What stopping here costs, named for the first thing outstanding.
   *
   * Hours come first because without them nothing can be booked at all; the
   * others narrow what works rather than stopping it.
   */
  const outstandingCost = (() => {
    const first = outstanding[0]?.id;
    if (first === 'availability') {
      return selectedLanguage === 'he'
        ? 'בלי שעות פעילות אף אחד לא יוכל להזמין תור.'
        : selectedLanguage === 'es'
          ? 'Sin horario nadie podrá reservar.'
          : 'Without working hours nobody will be able to book.';
    }
    if (first === 'stripe') {
      return selectedLanguage === 'he'
        ? 'שירותים שנגבים בכרטיס לא יוכלו לקבל תשלום עד שתחבר את סטרייפ.'
        : selectedLanguage === 'es'
          ? 'Los servicios cobrados con tarjeta no podrán cobrar hasta conectar Stripe.'
          : 'Services collected by card cannot charge until Stripe is connected.';
    }
    if (first === 'intake') {
      return selectedLanguage === 'he'
        ? 'לקוחות יזמינו בלי למלא טופס, ותצטרך לשאול אותם בעצמך.'
        : selectedLanguage === 'es'
          ? 'Los clientes reservarán sin rellenar un formulario y tendrás que preguntarles tú.'
          : 'Clients will book without filling anything in, and you will have to ask them yourself.';
    }
    return selectedLanguage === 'he'
      ? 'החשבוניות יצאו בלי פרטי החברה שלך, והלקוח לא יידע לאן להעביר.'
      : selectedLanguage === 'es'
        ? 'Las facturas saldrán sin tus datos y el cliente no sabrá dónde transferir.'
        : 'Invoices will go out without your details, so clients will not know where to send the money.';
  })();

  const openOwnerStep = (id: string) => {
    if (id === 'availability' || id === 'stripe' || id === 'bank' || id === 'intake') setOpenStep(id);
  };

  /** Marks a step done and closes whatever was open for it. */
  const settleOwnerStep = (id: string) => {
    setSettled(prev => {
      const next = { ...prev, [id]: true };
      // Survives a reload: connecting Stripe and then refreshing must not ask
      // for Stripe again.
      sessionStorage.setItem('onboarding_build_settled', JSON.stringify(next));
      return next;
    });
    setOpenStep(null);
  };

  /**
   * The only way out of this screen, and the only thing that throws the
   * onboarding data away. Everything else — a refresh, an OAuth round trip
   * through Stripe — comes back to the last mile where it left off.
   */
  const leaveForDashboard = () => {
    sessionStorage.removeItem('onboarding_preview_data');
    sessionStorage.removeItem('onboarding_build_complete');
    sessionStorage.removeItem('onboarding_build_settled');
    router.push('/business-os');
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

      {/* Main Content.
          Wide enough for the deck to be a deck. The cards lay themselves out
          at a 220px minimum, so inside a 28rem column exactly one fitted and
          six facts became a column tall enough to scroll — the build reads as
          a queue rather than as the plan filling in. Three across keeps the
          whole thing on one screen, which is the only way the user can watch
          it happen. */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
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
                  ? outstanding.length > 0
                    ? (selectedLanguage === 'he' ? 'כמעט שם' : selectedLanguage === 'es' ? 'Casi listo' : 'Almost there')
                    : (selectedLanguage === 'he' ? 'המערכת מוכנה!' : selectedLanguage === 'es' ? '¡Sistema listo!' : 'System Ready!')
                  : buildError
                  ? (selectedLanguage === 'he' ? 'אירעה שגיאה' : selectedLanguage === 'es' ? 'Ocurrió un error' : 'An Error Occurred')
                  : (selectedLanguage === 'he' ? 'בונה את המערכת שלך' : selectedLanguage === 'es' ? 'Construyendo tu sistema' : 'Building Your System')}
              </h1>

              <p className="text-sm text-[var(--v2-text-secondary)]">
                {buildComplete
                  ? outstanding.length > 0
                    // Says how much is left and whose it is. "Redirecting to
                    // dashboard" was the sentence that walked away from an
                    // unfinished setup.
                    ? (selectedLanguage === 'he'
                        ? `בניתי את כל מה שיכולתי. ${outstanding.length === 1 ? 'נשאר דבר אחד שרק את/ה יכול/ה לעשות.' : `נשארו ${outstanding.length} דברים שרק את/ה יכול/ה לעשות.`}`
                        : selectedLanguage === 'es'
                          ? `Construí todo lo que pude. ${outstanding.length === 1 ? 'Queda una cosa que solo tú puedes hacer.' : `Quedan ${outstanding.length} cosas que solo tú puedes hacer.`}`
                          : `I built everything I could. ${outstanding.length === 1 ? 'One thing is left that only you can do.' : `${outstanding.length} things are left that only you can do.`}`)
                    : (selectedLanguage === 'he' ? 'הכל מוכן — אפשר להתחיל.' : selectedLanguage === 'es' ? 'Todo listo — puedes empezar.' : 'All set — you can start.')
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
                    {/* No text-align of its own: the page carries dir, so the
                        name sits on the reading-start side in Hebrew and in
                        English without a rule for each. */}
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

            {/* The cards from the plan, filling in.
                The build used to be a list of rows ticking off — a progress
                log, which threw away the screen the user had just studied.
                These are the same facts in the same order, each reporting what
                actually happened rather than the word "completed". */}
            {isBuilding && !buildError && (
              <SetupFactDeck>
                {buildSteps.map(step => (
                  <SetupFactCard
                    key={step.id}
                    color={step.color || '#4F6EF7'}
                    icon={step.icon}
                    title={step.label}
                    yours={step.yours}
                    // Work only the user can do is never claimed as built, and
                    // never dimmed as "waiting" either: it is not queued behind
                    // anything, it is simply theirs.
                    state={
                      step.yours ? 'plan'
                        : step.status === 'completed' ? 'done'
                          : step.status === 'in_progress' ? 'busy'
                            : step.status === 'error' ? 'error'
                              : 'pending'
                    }
                    value={step.status === 'completed' || step.yours ? step.result : undefined}
                    note={
                      step.status === 'in_progress'
                        ? (selectedLanguage === 'he' ? 'בונה…' : selectedLanguage === 'es' ? 'Construyendo…' : 'Building…')
                        : step.status === 'error'
                          ? (selectedLanguage === 'he' ? 'לא הצלחנו — אפשר לנסות שוב אחר כך' : selectedLanguage === 'es' ? 'No se pudo — puedes reintentarlo luego' : 'Could not finish — you can retry later')
                          : step.status === 'pending' && !step.yours
                            ? (selectedLanguage === 'he' ? 'ממתין' : selectedLanguage === 'es' ? 'En espera' : 'Waiting')
                            : undefined
                    }
                  />
                ))}
              </SetupFactDeck>
            )}

            {/* Overall Progress Bar - Compact */}
            {isBuilding && !buildError && buildSteps.length > 0 && (
              <div className="mt-5">
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#4F6EF7] transition-all duration-500 ease-out"
                    style={{
                      // Only the platform's own work counts: including a step
                      // it cannot do would leave the bar permanently short of
                      // full through no fault of the user's.
                      width: `${
                        (buildSteps.filter(s => !s.yours && s.status === 'completed').length /
                          Math.max(1, buildSteps.filter(s => !s.yours).length)) * 100
                      }%`
                    }}
                  />
                </div>
                <p className="text-center text-xs text-[var(--v2-text-muted)] mt-2">
                  {buildSteps.filter(s => !s.yours && s.status === 'completed').length} / {buildSteps.filter(s => !s.yours).length}{' '}
                  {selectedLanguage === 'he' ? 'שלבים' : selectedLanguage === 'es' ? 'pasos' : 'steps'}
                </p>
              </div>
            )}

            {/* The last mile.
                Only what is mandatory for THIS business, which the services
                above already decided — hours where something is booked, a
                processor where something takes a card, bank details where
                something is invoiced. A business needing none of them sees
                none of this and goes straight through. */}
            {buildComplete && (
              <div className="mt-5">
                {outstanding.length > 0 ? (
                  <>
                    {/* What the client will walk through, as it stands right
                        now. A dashed step is one that will not happen yet, and
                        each card below is the reason. This is the whole idea:
                        the consequence sits beside the setting. */}
                    {(previewData?.services || []).length > 0 && (
                      <div className="mb-4 p-3 rounded-[12px] bg-[var(--v2-bg)] border border-[var(--v2-border)]">
                        <span className="block text-[10.5px] font-semibold tracking-wide text-[var(--v2-text-muted)] mb-2.5">
                          {outstanding.length > 0 ? t('journey.label.pending') : t('journey.label')}
                        </span>
                        <div className="flex flex-col gap-2.5">
                          {(previewData?.services || []).map((service, idx) => (
                            <div key={idx} className="flex flex-col gap-1">
                              <span className="text-[11px] text-[var(--v2-text-muted)]">{service.service_name}</span>
                              <ClientJourneyStrip
                                compact
                                intakeEnabled={(previewData?.configuration as any)?.needs_intake === true}
                                service={{
                                  scheduled: service.is_scheduled !== false,
                                  collection: service.collection ?? 'invoice',
                                  price: service.price,
                                }}
                                hoursReady={!!settled['availability'] || !outstanding.some(step => step.id === 'availability')}
                                processorReady={!!settled['stripe'] || !outstanding.some(step => step.id === 'stripe')}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex flex-col gap-2.5 mb-4">
                      {outstanding.map(step => (
                        <div
                          key={step.id}
                          className="rounded-[14px] border p-3.5 flex flex-col gap-2"
                          style={{
                            background: 'rgba(194, 65, 12, 0.05)',
                            borderColor: 'rgba(194, 65, 12, 0.4)',
                          }}
                        >
                          <div className="flex items-center gap-2.5">
                            <span
                              className="w-[27px] h-[27px] rounded-[9px] grid place-items-center flex-shrink-0"
                              style={{ background: 'rgba(194, 65, 12, 0.12)', color: '#C2410C' }}
                            >
                              {step.icon}
                            </span>
                            <h4 className="text-[13.5px] font-semibold text-[var(--v2-text-primary)] m-0">
                              {step.label}
                            </h4>
                          </div>
                          <p className="text-[12.5px] leading-snug text-[var(--v2-text-secondary)] m-0">
                            {step.result}
                          </p>
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <span className="text-[11px]" style={{ color: '#C2410C' }}>
                              {selectedLanguage === 'he' ? 'דורש אותך' : selectedLanguage === 'es' ? 'Te necesita' : 'Needs you'}
                            </span>
                            <button
                              onClick={() => openOwnerStep(step.id)}
                              className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg"
                              style={{ background: '#C2410C' }}
                            >
                              {step.id === 'availability'
                                ? (selectedLanguage === 'he' ? 'הגדר שעות' : selectedLanguage === 'es' ? 'Definir horario' : 'Set hours')
                                : step.id === 'intake'
                                  ? (selectedLanguage === 'he' ? 'בחר טופס' : selectedLanguage === 'es' ? 'Elegir formulario' : 'Choose a form')
                                : step.id === 'stripe'
                                  ? (selectedLanguage === 'he' ? 'חבר את סטרייפ' : selectedLanguage === 'es' ? 'Conectar Stripe' : 'Connect Stripe')
                                  : (selectedLanguage === 'he' ? 'מלא פרטים' : selectedLanguage === 'es' ? 'Completar datos' : 'Fill in details')}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* The consequence of stopping here, said plainly. The
                        platform states the cost and then respects the choice,
                        which is the opposite of both nagging and deciding. */}
                    <button
                      onClick={leaveForDashboard}
                      className="w-full px-4 py-2.5 text-sm text-[var(--v2-text-secondary)] border border-[var(--v2-border)] rounded-lg hover:bg-[var(--v2-surface)] transition-all"
                    >
                      {selectedLanguage === 'he' ? 'אעשה את זה מאוחר יותר' : selectedLanguage === 'es' ? 'Lo haré más tarde' : "I'll do this later"}
                    </button>
                    <p className="text-[11px] text-[var(--v2-text-muted)] text-center mt-2 mb-0 leading-snug">
                      {outstandingCost}
                    </p>
                  </>
                ) : (
                  <div className="text-center">
                    <div className="inline-flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full mb-4 text-sm">
                      <CheckCircle2 className="w-4 h-4" />
                      <span className="font-medium">
                        {selectedLanguage === 'he' ? 'הכול מוכן' : selectedLanguage === 'es' ? 'Todo listo' : 'All set'}
                      </span>
                    </div>
                    <button
                      onClick={leaveForDashboard}
                      className="w-full px-4 py-3 bg-[#4F6EF7] text-white text-sm font-semibold rounded-lg hover:bg-[#3B5AE5] transition-all flex items-center justify-center gap-2"
                    >
                      {selectedLanguage === 'he' ? 'עבור לדשבורד' : selectedLanguage === 'es' ? 'Ir al dashboard' : 'Go to Dashboard'}
                      <ArrowRight className={cn('w-4 h-4', isRTL && 'rotate-180')} />
                    </button>
                  </div>
                )}
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

      {/* The work only the owner can do, opened where they are.
          These are the dialogs the dashboard uses — self-contained, fetching
          their own data — so mounting one here costs nothing and keeps the
          user on the screen that is telling them why it matters. */}
      {openStep === 'availability' && (
        <ConfigurationDialog
          isOpen
          initialTab="availability"
          visibleTabs={['availability']}
          onClose={() => settleOwnerStep('availability')}
        />
      )}

      {openStep === 'intake' && (
        <ConfigurationDialog
          isOpen
          initialTab="intake"
          visibleTabs={['intake']}
          onClose={() => settleOwnerStep('intake')}
        />
      )}

      {/* The wizard renders as a bare `max-w-lg mx-auto` with no ground of its
          own — inside the configuration dialog it sits on that dialog's
          surface. Dropped straight onto a scrim it was transparent, so the
          surface has to come from here. */}
      {openStep === 'stripe' && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-3 overflow-y-auto">
          {/* The wizard's own root is max-w-lg, so a wider shell only added
              empty margin around it. */}
          <div
            className="w-full max-w-lg my-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl shadow-2xl p-4"
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            <div className="flex items-center justify-between gap-3 mb-2.5">
              <h3 className="text-[14px] font-bold text-[var(--v2-text-primary)] m-0">
                {selectedLanguage === 'he' ? 'חיבור תשלומים' : selectedLanguage === 'es' ? 'Conectar pagos' : 'Connect payments'}
              </h3>
              <button
                onClick={() => setOpenStep(null)}
                className="p-0.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
                aria-label={selectedLanguage === 'he' ? 'סגור' : selectedLanguage === 'es' ? 'Cerrar' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <StripeConnectWizard
              onComplete={() => settleOwnerStep('stripe')}
              onCancel={() => setOpenStep(null)}
            />
          </div>
        </div>
      )}

      {/* Bank and company details, in place.
          These used to send the user to the settings page, which walked away
          from the last mile with every other open item still on it — the exact
          failure this screen exists to prevent, reintroduced for one card. The
          settings section is a component, so it can be mounted here like the
          rest. */}
      {openStep === 'bank' && userId && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-3 overflow-y-auto">
          <div
            className="w-full max-w-2xl my-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl shadow-2xl p-4"
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            <div className="flex items-center justify-between gap-3 mb-2.5">
              <h3 className="text-[14px] font-bold text-[var(--v2-text-primary)] m-0">
                {selectedLanguage === 'he' ? 'פרטי החברה והבנק' : selectedLanguage === 'es' ? 'Datos de empresa y banco' : 'Company and bank details'}
              </h3>
              <button
                onClick={() => setOpenStep(null)}
                className="p-0.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
                aria-label={selectedLanguage === 'he' ? 'סגור' : selectedLanguage === 'es' ? 'Cerrar' : 'Close'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <InvoiceSettingsSection userId={userId} expanded onToggle={() => {}} />

            <button
              onClick={() => settleOwnerStep('bank')}
              className="w-full mt-3 px-4 py-2.5 text-sm font-semibold text-white rounded-lg"
              style={{ background: '#C2410C' }}
            >
              {selectedLanguage === 'he' ? 'סיימתי' : selectedLanguage === 'es' ? 'Listo' : 'Done'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
