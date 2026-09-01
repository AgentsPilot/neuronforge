'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Loader2, Send, User, Sparkles, Check, Plus, Trash2, X, Building2, Users, Calendar, CreditCard, Globe, Share2, XCircle, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { V2Logo } from '@/components/v2/V2Header';
import { useV2Theme } from '@/lib/design-system-v2';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { OnboardingSetupPanel, type SetupSignals } from '@/components/business-os/setup/OnboardingSetupPanel';
import { SetupFactCard, SetupFactDeck } from '@/components/business-os/setup/SetupFactCard';
import { ClientJourneyStrip } from '@/components/business-os/setup/ClientJourneyStrip';
import { currencySymbol, currencyForLanguage, currencyFromText } from '@/lib/business-os/currency';
import { ServicePaymentOptions } from '@/components/scheduling/ServicePaymentOptions';
import { ServiceCurrencySelect, getCurrencySymbol } from '@/components/scheduling/ServiceCurrencySelect';
import { cn } from '@/lib/utils';

interface ServiceInput {
  name: string;
  duration: string;
  price: string;
  /**
   * What this service is charged in.
   *
   * Chosen, not inferred from the interface language: a practice working in
   * Hebrew and serving clients abroad charges in dollars, and a symbol derived
   * from the reading language put the wrong one on every price it had.
   */
  currency: 'USD' | 'EUR' | 'ILS' | 'GBP';
  /**
   * The two facts that decide this service's client journey, asked here
   * because this is where the person is already typing a duration and a price.
   * Whether the business needs working hours or a card processor is then read
   * off the services rather than asked as a question of its own.
   */
  isScheduled: boolean;
  collection: 'online' | 'invoice';
  /** Mirrors `scheduling_services.payment_type`. */
  paymentType: 'full' | 'installments';
  installmentCount: string;
  installmentFrequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
  /** Mirrors the service settings: when the first instalment falls due. */
  firstPaymentDue: 'on_booking' | 'days_after';
  firstPaymentDays: string;
}

interface Message {
  role: 'assistant' | 'user';
  content: string;
  suggestions?: string[];
  multiSelect?: boolean;  // If true, show checkboxes instead of single-select buttons
}

interface PreviewData {
  businessProfile?: {
    company_name?: string;
    vertical?: string;
    verticalDisplayName?: string; // Translated display name for the vertical
    language?: string;
  };
  pipelineStages?: Array<{
    stage_key: string;
    stage_label: string;
    position: number;
    color: string;
    /** What the stage means. One of them is where a contact becomes a client. */
    stage_type?: 'lead' | 'prospect' | 'client' | 'past_client' | 'lost' | 'archived';
    is_primary_client_stage?: boolean;
  }>;
  services?: Array<{
    service_name: string;
    duration_minutes: number | null;
    price: number | null;
    currency?: string;
    /** Does a client pick a time? Decides the date step in this service's journey. */
    is_scheduled?: boolean;
    /** How the money arrives. Null while the service is free. */
    collection?: 'online' | 'invoice' | null;
    /** Paying over time. Independent of the price: a quoted project can still
        be three monthly payments, agreed once the figure is. */
    payment_plan?: {
      installment_count: number;
      installment_frequency: 'weekly' | 'biweekly' | 'monthly';
    } | null;
  }>;
  businessDescription?: string;
  // Full configuration from OnboardingConfigurationService
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
      currency?: string | null;
      payment_plan?: {
        installment_count: number;
        installment_frequency: 'weekly' | 'biweekly' | 'monthly';
      } | null;
      is_scheduled?: boolean;
    }>;
    online_presence_mode?: 'full_website' | 'booking_only' | 'website_only' | 'none';
    /** How money actually arrives — the answer that decides whether Stripe is needed at all. */
    collection_method?: 'card_online' | 'invoice' | 'in_person' | 'mixed' | 'none';
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

export default function OnboardingChatPage() {
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { mode } = useV2Theme();
  // `t` is pulled in so the payment dialog can use the very same strings the
  // service settings dialog does, rather than a second translation of the same
  // three controls.
  const { setLanguage, t } = useLanguage();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState<string>('welcome');
  /**
   * What the conversation knows so far, in the shape the setup chain reads.
   *
   * Arrives on every turn, not only at the preview: the panel beside the chat
   * is the point — the user watches their setup assemble while they answer,
   * and watches steps come off the board when an answer removes them.
   */
  const [setupSignals, setSetupSignals] = useState<SetupSignals | null>(null);
  /** Which service row has its payment options open, if any. */
  const [paymentDialogIndex, setPaymentDialogIndex] = useState<number | null>(null);
  /**
   * Clients fill in a form before their appointment.
   *
   * One answer for the business rather than a column per service, because the
   * platform stores a single form. Asked here, in the form they are already
   * filling in, rather than as a question of its own — it is a yes or no, and
   * a whole conversational turn is too much to spend on one.
   */
  const [needsIntake, setNeedsIntake] = useState(false);
  /**
   * The plan is a screen, not the last message in a thread.
   *
   * It is the moment the user decides whether to build a business on this, and
   * reading it at the bottom of a conversation — under the scroll, beside the
   * composer, competing with the transcript — made a decision look like a
   * remark. The chat gives way to it, and comes back the moment they say
   * something needs changing.
   */
  const [adjustingPlan, setAdjustingPlan] = useState(false);
  /**
   * The business name, being corrected on the plan.
   *
   * It is never asked for: it is inferred from whatever they wrote about their
   * business, and falls back to "your business" when they never said it. There
   * was then nowhere to fix it — the adjustment flow understands services,
   * pipeline and payments, and nothing about a name — so a business could be
   * built under the wrong one, and every invoice and email would carry it.
   *
   * A name is a text field, not a sentence to be interpreted.
   */
  const [editingName, setEditingName] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Track the language selected during THIS onboarding session
  // IMPORTANT: Always start in English (LTR) - only switch to Hebrew after user explicitly selects it
  const [selectedLanguage, setSelectedLanguage] = useState<'en' | 'he' | 'es'>('en');

  // Services form modal state
  const [showServicesForm, setShowServicesForm] = useState(false);
  const [servicesInput, setServicesInput] = useState<ServiceInput[]>([
    {
      name: '',
      duration: '60',
      price: '',
      currency: currencyForLanguage(selectedLanguage),
      isScheduled: true,
      collection: 'invoice',
      paymentType: 'full',
      installmentCount: '3',
      installmentFrequency: 'monthly',
      firstPaymentDue: 'on_booking',
      firstPaymentDays: '7',
    },
  ]);

  // Multi-select state for Q4 (digital tools selection)
  const [multiSelectChoices, setMultiSelectChoices] = useState<Set<string>>(new Set());

  // Pipeline stages editor state
  const [showPipelineEditor, setShowPipelineEditor] = useState(false);
  const [editingPipelineStages, setEditingPipelineStages] = useState<Array<{
    stage_key: string;
    stage_label: string;
    position: number;
    color: string;
    stage_type?: 'lead' | 'prospect' | 'client' | 'past_client' | 'lost' | 'archived';
    is_primary_client_stage?: boolean;
  }>>([]);

  const isRTL = selectedLanguage === 'he';

  // Initialize - check auth and start conversation
  useEffect(() => {
    async function initialize() {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (session?.user) {
          // Check if already completed onboarding
          // Allow access via ?reset=true query param for testing/reconfiguration
          const urlParams = new URLSearchParams(window.location.search);
          const allowReset = urlParams.get('reset') === 'true';

          if (!allowReset) {
            const { data: businessProfile } = await supabase
              .from('business_profiles')
              .select('onboarding_completed')
              .eq('user_id', session.user.id)
              .single();

            if (businessProfile?.onboarding_completed) {
              router.push('/business-os');
              return;
            }
          }

          // ALWAYS clear old conversation data when starting fresh onboarding
          // This prevents stale data from old onboarding flows causing issues
          // The delete is done via API to ensure proper auth
          try {
            await fetch('/api/onboarding/chat/reset', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            });
          } catch {
            // Non-blocking - continue even if reset fails
            console.warn('Failed to reset old conversation data');
          }
        }

        // Start conversation - ALWAYS in English
        // The first question is always in English with LTR direction
        // Only after user selects their language will we switch
        const welcomeMessage: Message = {
          role: 'assistant',
          content: 'Welcome to AgentsPilot! Let\'s set up your Business OS. What language would you like to use?',
          suggestions: ['🇺🇸 English', '🇮🇱 עברית (Hebrew)', '🇪🇸 Español (Spanish)']
        };

        setMessages([welcomeMessage]);
        setIsLoading(false);
      } catch (err) {
        console.error('Initialization error:', err);
        setIsLoading(false);
      }
    }

    initialize();
  }, [router]);

  // Auto-scroll to bottom and maintain focus
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    // Keep input focused after new messages
    if (!isSending && !showPreview && !showServicesForm) {
      inputRef.current?.focus();
    }
  }, [messages, isSending, showPreview, showServicesForm]);

  // Show services form when entering service_details step, hide when leaving
  useEffect(() => {
    if (currentStep === 'service_details') {
      // Small delay to let the assistant message appear first
      setTimeout(() => setShowServicesForm(true), 500);
    } else {
      // Close the form when moving away from service_details
      setShowServicesForm(false);
    }
  }, [currentStep]);

  const sendMessage = async (message: string) => {
    if (!message.trim() || isSending) return;

    // Add user message
    const userMessage: Message = { role: 'user', content: message };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsSending(true);

    try {
      const requestBody: { message: string; language: string; conversationId?: string } = {
        message,
        language: selectedLanguage,
      };
      // Only include conversationId if we have one
      if (conversationId) {
        requestBody.conversationId = conversationId;
      }

      const response = await fetch('/api/onboarding/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) throw new Error('Failed to process message');

      const result = await response.json();

      // Store conversationId for subsequent messages
      if (result.conversationId && !conversationId) {
        setConversationId(result.conversationId);
      }

      // Update language if changed (during language selection step)
      if (message.toLowerCase().includes('עברית') || message.toLowerCase().includes('hebrew')) {
        setSelectedLanguage('he');
        setLanguage('he'); // Also update global context for rest of app
      } else if (message.toLowerCase().includes('español') || message.toLowerCase().includes('spanish')) {
        setSelectedLanguage('es');
        setLanguage('es');
      } else if (message.toLowerCase().includes('english')) {
        setSelectedLanguage('en');
        setLanguage('en');
      }

      // Add assistant response
      const assistantMessage: Message = {
        role: 'assistant',
        content: result.response,
        suggestions: result.suggestions,
        multiSelect: result.multiSelect  // Include multi-select flag from API
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Reset multi-select choices when entering a new step
      setMultiSelectChoices(new Set());

      // Update state
      setCurrentStep(result.currentStep);

      if (result.setup) {
        setSetupSignals(result.setup);
      }

      // A fresh plan means the adjustment they asked for has been made.
      if (result.showPreview) setAdjustingPlan(false);

      // Handle preview
      if (result.showPreview && result.previewData) {
        setShowPreview(true);
        setPreviewData(result.previewData);
      }

    } catch (error) {
      console.error('Message send error:', error);
      const errorMessage: Message = {
        role: 'assistant',
        content: selectedLanguage === 'he'
          ? 'מצטער, היתה שגיאה. אנא נסה שוב.'
          : selectedLanguage === 'es'
          ? 'Lo siento, hubo un error. Por favor, inténtalo de nuevo.'
          : 'Sorry, there was an error. Please try again.'
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsSending(false);
      // Keep focus in the input field after sending
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion);
    // Keep focus in input after suggestion click
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // Services form handlers
  const addServiceRow = () => {
    // A new row inherits the currency already chosen: a business charges in one
    // currency far more often than in two, and re-picking it per service is
    // work with no decision in it.
    setServicesInput(prev => [
      ...prev,
      {
        name: '',
        duration: '60',
        price: '',
        currency: prev[prev.length - 1]?.currency || currencyForLanguage(selectedLanguage),
        isScheduled: true,
        collection: 'invoice',
        paymentType: 'full',
        installmentCount: '3',
        installmentFrequency: 'monthly',
        firstPaymentDue: 'on_booking',
        firstPaymentDays: '7',
      },
    ]);
  };

  const removeServiceRow = (index: number) => {
    if (servicesInput.length > 1) {
      setServicesInput(prev => prev.filter((_, i) => i !== index));
    }
  };

  // `isScheduled` is a boolean, so the setter can no longer take strings only.
  const updateServiceRow = (index: number, field: keyof ServiceInput, value: string | boolean) => {
    setServicesInput(prev => prev.map((service, i) =>
      i === index ? { ...service, [field]: value } : service
    ));
  };

  const submitServices = () => {
    // Filter out empty services and format as text
    const validServices = servicesInput.filter(s => (s.name ?? '').trim());
    if (validServices.length === 0) return;

    // Format services as a natural language message
    const intakeNote = needsIntake
      ? (selectedLanguage === 'he'
          ? ' לקוחות ממלאים טופס לפני הפגישה.'
          : selectedLanguage === 'es'
            ? ' Los clientes rellenan un formulario antes de la cita.'
            : ' Clients fill in a form before the appointment.')
      : '';

    const servicesText = validServices.map(s => {
      const parts = [s.name];
      // Said in words, because the extraction reads words rather than the form.
      // A product with no duration would otherwise arrive looking like a
      // service somebody forgot to time.
      if (s.duration) {
        parts.push(`${s.duration} ${selectedLanguage === 'he' ? 'דקות' : selectedLanguage === 'es' ? 'minutos' : 'minutes'}`);
      }
      if (!s.isScheduled) {
        parts.push(selectedLanguage === 'he' ? 'ללא קביעת תור' : selectedLanguage === 'es' ? 'sin cita' : 'no appointment needed');
      }
      if (s.price) {
        // If they wrote a currency into the price box — "$80", "150 ש"ח" —
        // keep it exactly as typed. Otherwise use the one they picked for the
        // row, which is the whole point of the selector.
        const wroteCurrency = currencyFromText(s.price) !== null;
        parts.push(wroteCurrency ? s.price : `${currencySymbol(s.currency)}${s.price}`);
      }

      // How this one is collected, in words too — so a business that takes a
      // card for one service and invoices for another is not flattened into a
      // single answer on the way through.
      const priced = s.price.trim() !== '' && parseFloat(s.price) > 0;
      if (priced) {
        parts.push(
          s.collection === 'online'
            ? (selectedLanguage === 'he' ? 'תשלום בכרטיס אונליין' : selectedLanguage === 'es' ? 'pago con tarjeta en línea' : 'paid by card online')
            : (selectedLanguage === 'he' ? 'תשלום בחשבונית' : selectedLanguage === 'es' ? 'pago con factura' : 'paid against an invoice')
        );
      }

      // Said in words, because the extraction reads words. "12 תשלומים
      // חודשיים" is the sentence a person would type, and it lands in
      // payment_plan with its frequency intact.
      const installments = parseInt(s.installmentCount, 10);
      if (s.paymentType === 'installments' && installments > 1) {
        const frequency = {
          weekly: { he: 'שבועיים', es: 'semanales', en: 'weekly' },
          biweekly: { he: 'דו-שבועיים', es: 'quincenales', en: 'biweekly' },
          monthly: { he: 'חודשיים', es: 'mensuales', en: 'monthly' },
          quarterly: { he: 'רבעוניים', es: 'trimestrales', en: 'quarterly' },
        }[s.installmentFrequency];

        parts.push(
          selectedLanguage === 'he'
            ? `${installments} תשלומים ${frequency.he}`
            : selectedLanguage === 'es'
              ? `${installments} pagos ${frequency.es}`
              : `${installments} ${frequency.en} payments`
        );
      }
      return parts.join(' - ');
    }).join('\n');

    // Reset form and close modal
    setShowServicesForm(false);
    setServicesInput([{
      name: '',
      duration: '60',
      price: '',
      currency: currencyForLanguage(selectedLanguage),
      isScheduled: true,
      collection: 'invoice',
      paymentType: 'full',
      installmentCount: '3',
      installmentFrequency: 'monthly',
      firstPaymentDue: 'on_booking',
      firstPaymentDays: '7',
    }]);

    // Send as message, with the one business-wide answer appended so the
    // extraction sees it in the same turn as the services it applies to.
    sendMessage(servicesText + intakeNote);
  };

  // Pipeline stages editor handlers
  const openPipelineEditor = () => {
    if (previewData?.pipelineStages) {
      setEditingPipelineStages([...previewData.pipelineStages]);
      setShowPipelineEditor(true);
    }
  };

  const updatePipelineStageLabel = (index: number, newLabel: string) => {
    setEditingPipelineStages(prev => prev.map((stage, i) =>
      i === index ? { ...stage, stage_label: newLabel } : stage
    ));
  };

  const addPipelineStage = () => {
    const newPosition = editingPipelineStages.length;
    const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#22c55e', '#06b6d4'];
    const newStage = {
      stage_key: `stage_${Date.now()}`,
      stage_label: selectedLanguage === 'he' ? 'שלב חדש' : selectedLanguage === 'es' ? 'Nueva etapa' : 'New Stage',
      position: newPosition,
      color: colors[newPosition % colors.length]
    };
    setEditingPipelineStages(prev => [...prev, newStage]);
  };

  const removePipelineStage = (index: number) => {
    // The client stage is the one the platform reads to know a contact became
    // a customer — auto-promotion after payment, the funnel's paying station,
    // every "how many clients" figure. Guarded here as well as on the button,
    // because a disabled button is a hint and this is a rule.
    if (editingPipelineStages[index]?.is_primary_client_stage) return;

    if (editingPipelineStages.length > 2) {
      setEditingPipelineStages(prev =>
        prev.filter((_, i) => i !== index).map((stage, i) => ({ ...stage, position: i }))
      );
    }
  };

  const movePipelineStage = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= editingPipelineStages.length) return;

    setEditingPipelineStages(prev => {
      const newStages = [...prev];
      [newStages[index], newStages[newIndex]] = [newStages[newIndex], newStages[index]];
      return newStages.map((stage, i) => ({ ...stage, position: i }));
    });
  };

  const savePipelineChanges = () => {
    if (previewData) {
      const updatedPreviewData = {
        ...previewData,
        pipelineStages: editingPipelineStages,
        configuration: previewData.configuration ? {
          ...previewData.configuration,
          pipeline_stages: editingPipelineStages
        } : undefined
      };
      setPreviewData(updatedPreviewData);
    }
    setShowPipelineEditor(false);
  };

/**
   * The plan, in sentences.
   *
   * Each card states a consequence rather than a setting: "you invoice, they
   * transfer — no card processor" is something a person can check, while
   * "payment_mode: invoicing" and a tile reading "Payments ✓" are not.
   */
  const configuration = previewData?.configuration as any;
  const changeLabel = selectedLanguage === 'he' ? 'שנה' : selectedLanguage === 'es' ? 'cambiar' : 'change';

  /**
   * Changing a fact, where the fact is.
   *
   * Every card's change link used to drop the user back into the conversation
   * to re-describe something they were already looking at — so correcting one
   * price meant a paragraph, another extraction pass, and a new plan in which
   * something else might have moved. A card states one decision; its change
   * link edits that decision and nothing else. The conversation stays for what
   * no card covers.
   */
  const [planEditor, setPlanEditor] = useState<'services' | 'presence' | null>(null);
  /** A working copy, so closing without saving leaves the plan as it was. */
  const [draftServices, setDraftServices] = useState<NonNullable<PreviewData['services']>>([]);
  /** Which draft row has its payment options open, if any. */
  const [draftPaymentIndex, setDraftPaymentIndex] = useState<number | null>(null);

  const openServicesEditor = () => {
    setDraftServices((previewData?.services || []).map(service => ({ ...service })));
    setDraftPaymentIndex(null);
    setPlanEditor('services');
  };

  /** How this row is paid for — the same arrangement the settings dialog holds. */
  const setDraftPaymentPlan = (
    index: number,
    plan: NonNullable<PreviewData['services']>[number]['payment_plan']
  ) => {
    setDraftServices(rows => rows.map((row, i) => (i === index ? { ...row, payment_plan: plan } : row)));
  };

  const updateDraftService = (
    index: number,
    field: 'service_name' | 'duration_minutes' | 'price' | 'currency' | 'is_scheduled' | 'collection',
    value: string | boolean
  ) => {
    setDraftServices(rows => rows.map((row, i) => {
      if (i !== index) return row;
      if (field === 'is_scheduled') return { ...row, is_scheduled: value as boolean };
      if (field === 'collection') return { ...row, collection: value as 'online' | 'invoice' };
      if (field === 'service_name') return { ...row, service_name: value as string };
      if (field === 'currency') return { ...row, currency: value as string };
      const text = value as string;
      if (field === 'duration_minutes') {
        return { ...row, duration_minutes: text.trim() === '' ? null : (parseInt(text, 10) || null) };
      }
      // Empty is not zero. A blank price means the fee is agreed per client;
      // a 0 means the service is free, and publishing one as the other is how
      // a consultancy advertises its work for nothing.
      return { ...row, price: text.trim() === '' ? null : Number(text) };
    }));
  };

  const saveServicesEditor = () => {
    if (!previewData) return;
    const kept = draftServices.filter(service => service.service_name.trim());

    // Whether a processor is needed follows from the services, so it is
    // recomputed here rather than left at whatever the extraction guessed.
    const wantsProcessor = kept.some(
      service => (service.price || 0) > 0 && (service.collection ?? 'invoice') === 'online'
    );

    setPreviewData({
      ...previewData,
      services: kept,
      // Both arrays, because the build prefers this one but falls back to the
      // other — an edit written to only one of them survives or vanishes
      // depending on whether the user deleted every row.
      configuration: previewData.configuration
        ? {
          ...previewData.configuration,
          needs_stripe_connect: wantsProcessor,
          services: kept.map(service => ({
            name: service.service_name,
            duration_minutes: service.duration_minutes,
            price: service.price ?? undefined,
            currency: service.currency,
            payment_plan: service.payment_plan ?? null,
            is_scheduled: service.is_scheduled !== false,
            collection: (service.price || 0) > 0 ? (service.collection ?? 'invoice') : null,
          })),
        }
        : previewData.configuration,
    });
    setPlanEditor(null);
  };

  const setPresenceMode = (mode: NonNullable<NonNullable<PreviewData['configuration']>['online_presence_mode']>) => {
    if (!previewData?.configuration) return;
    setPreviewData({
      ...previewData,
      configuration: { ...previewData.configuration, online_presence_mode: mode },
    });
    setPlanEditor(null);
  };

  const saveBusinessName = () => {
    const name = (editingName || '').trim();
    setEditingName(null);
    if (!name || !previewData) return;

    setPreviewData({
      ...previewData,
      businessProfile: { ...previewData.businessProfile, company_name: name },
      // The build reads `configuration.company_name` first and falls back to
      // the profile, so both have to change or the correction is lost.
      configuration: previewData.configuration
        ? { ...previewData.configuration, company_name: name }
        : previewData.configuration,
    });
  };

  /**
   * The plan has the page, unless they have asked to change something — then
   * the conversation comes back so they can say what.
   */
  const showPlanScreen =
    showPreview && !!previewData && !adjustingPlan &&
    (currentStep === 'preview' || currentStep === 'building');

  /**
   * How money reaches this business, read off its services.
   *
   * The old business-wide `collection_method` could not describe what people
   * actually sell: this account has a free service, one billed against an
   * invoice and one taking a card, and a single answer called the whole thing
   * "invoice". Whatever the services say is the truth, because the services are
   * what a client walks through.
   */
  const collectionShape = (() => {
    const priced = (previewData?.services || []).filter(service => (service.price || 0) > 0);
    return {
      online: priced.some(service => service.collection === 'online'),
      invoiced: priced.some(service => service.collection !== 'online'),
      anyPriced: priced.length > 0,
    };
  })();

  const collectionSummary = (() => {
    const { online, invoiced, anyPriced } = collectionShape;

    if (online && invoiced) {
      return selectedLanguage === 'he'
        ? 'חלק מהשירותים נגבים בכרטיס בזמן ההזמנה, וחלק בחשבונית אחרי — לפי מה שהגדרת לכל שירות.'
        : selectedLanguage === 'es'
          ? 'Algunos servicios se cobran con tarjeta al reservar y otros por factura — según lo que definiste en cada uno.'
          : 'Some services are paid by card at booking and some are invoiced after — per what you set on each one.';
    }
    if (online) {
      return selectedLanguage === 'he'
        ? 'לקוחות משלמים בכרטיס בזמן ההזמנה.'
        : selectedLanguage === 'es'
          ? 'Los clientes pagan con tarjeta al reservar.'
          : 'Clients pay by card when booking.';
    }
    if (invoiced) {
      return selectedLanguage === 'he'
        ? 'אתה שולח חשבונית והם מעבירים. בלי מנפיק תשלומים — פרטי הבנק שלך יופיעו בחשבונית.'
        : selectedLanguage === 'es'
          ? 'Tú facturas y ellos transfieren. Sin procesador — tus datos bancarios van en la factura.'
          : 'You invoice, they transfer. No card processor — your bank details go on the invoice.';
    }
    if (anyPriced) {
      return selectedLanguage === 'he'
        ? 'משלמים לך ישירות. אין מה להגדיר.'
        : selectedLanguage === 'es'
          ? 'Te pagan directamente. Nada que configurar.'
          : 'They pay you directly. Nothing to set up.';
    }
    return selectedLanguage === 'he'
      ? 'אין גבייה כרגע.'
      : selectedLanguage === 'es'
        ? 'No se cobra nada por ahora.'
        : 'Nothing is charged.';
  })();

  const presenceSummary = (() => {
    const mode = configuration?.online_presence_mode;
    if (mode === 'full_website' || mode === 'website_only') {
      return selectedLanguage === 'he'
        ? 'אבנה ואפרסם את האתר שלך — משם לקוחות מזמינים.'
        : selectedLanguage === 'es'
          ? 'Construiré y publicaré tu sitio — es donde reservan.'
          : "I'll build and publish your site — that is where clients book you.";
    }
    return selectedLanguage === 'he'
      ? 'לינק להזמנות שאפשר לשלוח בוואטסאפ. בלי אתר.'
      : selectedLanguage === 'es'
        ? 'Un enlace de reserva para WhatsApp. Sin sitio web.'
        : 'A booking link you can paste into WhatsApp. No website.';
  })();

  /**
   * The one card the platform cannot fill in.
   *
   * Named here, on the plan, with a time estimate — so the user decides with
   * the cost in view and can still change their mind about how they collect.
   */
  /** How many of the cards below are the platform's own work. */
  const planBuildCount = 2 // the business, and how clients reach them
    + ((previewData?.services?.length || 0) > 0 ? 1 : 0)
    + ((previewData?.pipelineStages?.length || 0) > 0 ? 1 : 0)
    + 1; // how they get paid

  /**
   * Everything only this person can do — which can be more than one thing.
   *
   * A single card assumed the business collected exactly one way. A practice
   * with a card-paid session and an invoiced programme owes both a processor
   * and its bank details, and naming only the first left the other to be
   * discovered from a client's confused email.
   */
  const yoursCards = (() => {
    const cards: Array<{ key: string; icon: React.ReactNode; title: string; value: string; note: string }> = [];

    if (collectionShape.online) {
      cards.push({
        key: 'stripe',
        icon: <CreditCard className="w-3.5 h-3.5" />,
        title: selectedLanguage === 'he' ? 'חיבור תשלומים' : selectedLanguage === 'es' ? 'Conectar pagos' : 'Connect payments',
        value: selectedLanguage === 'he'
          ? 'סטרייפ מבקשת תעודת זהות וחשבון בנק, אז את זה רק אתה יכול לעשות.'
          : selectedLanguage === 'es'
            ? 'Stripe pide tu identificación y una cuenta bancaria, así que esto solo lo puedes hacer tú.'
            : 'Stripe asks for your ID and a bank account, so this one only you can do.',
        note: selectedLanguage === 'he' ? 'בערך 5 דקות · אחרי ההקמה' : selectedLanguage === 'es' ? 'unos 5 minutos · después' : 'about 5 minutes · after setup',
      });
    }

    if (collectionShape.invoiced) {
      cards.push({
        key: 'bank',
        icon: <Building2 className="w-3.5 h-3.5" />,
        title: selectedLanguage === 'he' ? 'פרטי הבנק שלך' : selectedLanguage === 'es' ? 'Tus datos bancarios' : 'Your bank details',
        value: selectedLanguage === 'he'
          ? 'הם מופיעים בכל חשבונית — משם הלקוח יודע לאן להעביר. אף אחד לא יכול להקליד אותם חוץ ממך.'
          : selectedLanguage === 'es'
            ? 'Van en cada factura — es donde tu cliente aprende a dónde enviar el dinero. Nadie puede escribirlos salvo tú.'
            : 'They go on every invoice — it is where your client learns to send the money. Nobody can type them but you.',
        note: selectedLanguage === 'he' ? 'בערך 2 דקות · אחרי ההקמה' : selectedLanguage === 'es' ? 'unos 2 minutos · después' : 'about 2 minutes · after setup',
      });
    }

    return cards;
  })();

  const handleBuild = async () => {
    if (!previewData) return;

    // Store preview data in session storage for the build page
    sessionStorage.setItem('onboarding_preview_data', JSON.stringify(previewData));

    // Redirect to the dedicated build page
    router.push(`/onboarding-build?lang=${selectedLanguage}`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[var(--v2-bg)] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-[var(--v2-primary)]" />
          <p className="text-lg text-[var(--v2-text-secondary)]">
            Loading...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--v2-bg)]" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="border-b border-[var(--v2-border)] bg-[var(--v2-surface)]">
        {/* Pinned to LTR on purpose.
            Where the logo sits is a layout decision, not a reading direction:
            it belongs on the left in every language, with the account's name
            opposite it. Letting `dir` order this row put the logo on the right
            in Hebrew, which moves the one fixed landmark on the page. The name
            inside still renders in its own direction. */}
        <div dir="ltr" className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <V2Logo />
          {/* Whose account this is, once they have said.
              In the header rather than on the plan: it is true of every screen
              from here on, not a line belonging to one of them. */}
          {previewData?.businessProfile?.company_name && (
            <span
              dir={isRTL ? 'rtl' : 'ltr'}
              className="text-sm font-semibold text-[var(--v2-text-primary)] truncate min-w-0"
            >
              {previewData.businessProfile.company_name}
            </span>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* The conversation fills whatever is left after the panel below it,
            rather than a fixed height tuned to the chrome above.
            `calc(100vh - 280px)` was measured against a progress bar that no
            longer exists, which left the composer floating short of the bottom
            — and would have gone wrong again the next time anything above it
            changed. One number for the header, and flex does the rest. */}
        {/* The plan — a screen, not a message.
            Rendered instead of the conversation, so the thing the user is
            deciding on has the page to itself. */}
        {showPlanScreen && previewData && (
          <div dir={isRTL ? 'rtl' : 'ltr'}>
                {/* The business, as the heading of its own plan.
                    This was a sentence with `**asterisks**` around the name,
                    written for a markdown renderer that never ran — so the
                    plan opened with literal stars around the business. The
                    name is the title of what follows, and it inherits the
                    page's direction rather than being wrapped in a sentence
                    whose punctuation has to be flipped by hand. */}
                <div className="mb-4">
                  <p className="text-xs text-[var(--v2-text-muted)]">
                    {selectedLanguage === 'he' ? 'התוכנית שלי עבור' : selectedLanguage === 'es' ? 'Mi plan para' : 'My plan for'}
                  </p>
                  <h2 className="text-xl font-bold text-[var(--v2-text-primary)] mt-0.5 break-words">
                    {previewData.businessProfile?.company_name
                      || (selectedLanguage === 'he' ? 'העסק שלך' : selectedLanguage === 'es' ? 'tu negocio' : 'your business')}
                  </h2>
                </div>
                <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl shadow-xl overflow-hidden">
                  {/* The promise, as a number.
                      A coloured banner repeating the business name was the
                      receipt talking: the name is already in the sentence
                      above and on the first card. What belongs here is the
                      only figure that matters before anything is built —
                      how much of this the platform does, and how much is
                      left for them. */}
                  <div className="px-5 pt-5 flex items-baseline justify-between gap-3 flex-wrap">
                    <h3 className="text-base font-bold text-[var(--v2-text-primary)]">
                      {selectedLanguage === 'he' ? 'הנה ההגדרות שלך' : selectedLanguage === 'es' ? 'Aquí está tu configuración' : 'Here is your setup'}
                    </h3>
                    <span className="text-xs text-[var(--v2-text-muted)] flex items-center gap-3">
                      <span>
                        <strong className="text-[15px] text-[var(--v2-text-primary)]">{planBuildCount}</strong>{' '}
                        {selectedLanguage === 'he' ? 'אני בונה' : selectedLanguage === 'es' ? 'lo construyo yo' : 'I build'}
                      </span>
                      {yoursCards.length > 0 && (
                        <span>
                          <strong className="text-[15px]" style={{ color: '#C2410C' }}>{yoursCards.length}</strong>{' '}
                          {selectedLanguage === 'he' ? 'דורש אותך' : selectedLanguage === 'es' ? 'te necesita' : 'needs you'}
                        </span>
                      )}
                    </span>
                  </div>

                  {/* One card per fact, each changeable.
                      This was one tall summary — a header, a pipeline strip,
                      feature tiles, a service list — which read as a receipt
                      of what the user had said. What they need at this moment
                      is a set of decisions they can still touch, so each fact
                      gets its own card, states what will happen in a sentence,
                      and carries the same quiet change affordance in the same
                      corner. The one thing only they can do looks different
                      and offers no change link, because there is nothing to
                      change — only something to do. */}
                  <div className="p-5">
                    <SetupFactDeck>
                      <SetupFactCard
                        color="#8B5CF6"
                        icon={<Building2 className="w-3.5 h-3.5" />}
                        title={selectedLanguage === 'he' ? 'העסק שלך' : selectedLanguage === 'es' ? 'Tu negocio' : 'Your business'}
                        value={
                          editingName !== null ? (
                            <span className="flex items-center gap-2">
                              <input
                                autoFocus
                                value={editingName}
                                onChange={e => setEditingName(e.target.value)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') saveBusinessName();
                                  if (e.key === 'Escape') setEditingName(null);
                                }}
                                placeholder={selectedLanguage === 'he' ? 'שם העסק' : selectedLanguage === 'es' ? 'Nombre del negocio' : 'Business name'}
                                className={cn(
                                  'flex-1 min-w-0 px-2 py-1 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-md text-[var(--v2-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)]',
                                  isRTL && 'text-right'
                                )}
                              />
                              <button
                                onClick={saveBusinessName}
                                className="text-[var(--v2-primary)] hover:opacity-80 flex-shrink-0"
                                aria-label={selectedLanguage === 'he' ? 'שמור' : selectedLanguage === 'es' ? 'Guardar' : 'Save'}
                              >
                                <Check className="w-4 h-4" />
                              </button>
                            </span>
                          ) : (
                            [
                              previewData.businessProfile?.company_name,
                              previewData.businessProfile?.verticalDisplayName,
                            ].filter(Boolean).join(' · ')
                          )
                        }
                        // Corrected here rather than by describing it to the
                        // chat: it is a name, and the extraction that guessed
                        // it wrong once would only be guessing again.
                        onChange={() => setEditingName(previewData.businessProfile?.company_name || '')}
                        changeLabel={changeLabel}
                      />

                      {/* Every service, with the journey each one produces.
                          Three chips reading "name · price" said nothing about
                          what a client would actually walk through, and hid the
                          rest of the list behind a count. The differences
                          between services are the point — one takes a card at
                          booking, one is invoiced after, one is free — so they
                          are shown side by side. */}
                      {previewData.services && previewData.services.length > 0 && (
                        <div style={{ gridColumn: '1/-1' }}>
                          <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[14px] p-4">
                            <div className="flex items-center justify-between gap-3 mb-3">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span
                                  className="w-[27px] h-[27px] rounded-[9px] grid place-items-center flex-shrink-0"
                                  style={{ background: 'rgba(209, 78, 151, 0.12)', color: '#D14E97' }}
                                >
                                  <Calendar className="w-3.5 h-3.5" />
                                </span>
                                <h4 className="text-[13.5px] font-semibold text-[var(--v2-text-primary)] m-0">
                                  {selectedLanguage === 'he' ? 'מה שאתה מוכר' : selectedLanguage === 'es' ? 'Lo que vendes' : 'What you sell'}
                                </h4>
                              </div>
                              <button
                                onClick={openServicesEditor}
                                className="text-[10.5px] text-[var(--v2-text-muted)] border border-[var(--v2-border)] rounded-full px-2.5 py-0.5 bg-[var(--v2-surface)] flex-shrink-0"
                              >
                                {changeLabel}
                              </button>
                            </div>

                            <div className="flex flex-col">
                              {previewData.services.map((service, idx) => {
                                const currency = currencySymbol(service.currency) || currencySymbol(currencyForLanguage(selectedLanguage));
                                // Null is "we agree it together", zero is free.
                                // Showing a quote-based service as free is how a
                                // consultancy ends up advertising work for
                                // nothing on its own booking page.
                                const price = service.price === null || service.price === undefined
                                  ? (selectedLanguage === 'he' ? 'לפי הצעת מחיר' : selectedLanguage === 'es' ? 'A convenir' : 'On request')
                                  : service.price > 0
                                    ? `${currency}${service.price}`
                                    : (selectedLanguage === 'he' ? 'חינם' : selectedLanguage === 'es' ? 'Gratis' : 'Free');
                                const scheduled = service.is_scheduled !== false;
                                return (
                                  <div
                                    key={idx}
                                    className={cn(
                                      'flex flex-col gap-1.5 py-2.5',
                                      idx > 0 && 'border-t border-[var(--v2-border)]'
                                    )}
                                  >
                                    <div className="flex items-baseline gap-2 flex-wrap">
                                      <span className="text-[13px] font-semibold text-[var(--v2-text-primary)]">
                                        {service.service_name}
                                      </span>
                                      <span className="text-[11.5px] text-[var(--v2-text-muted)]">
                                        {[
                                          service.duration_minutes
                                            ? `${service.duration_minutes} ${selectedLanguage === 'he' ? 'דק' : 'min'}`
                                            : null,
                                          !scheduled
                                            ? (selectedLanguage === 'he' ? 'ללא תור' : selectedLanguage === 'es' ? 'sin cita' : 'no appointment')
                                            : null,
                                          price,
                                        ].filter(Boolean).join(' · ')}
                                      </span>
                                    </div>
                                    <ClientJourneyStrip
                                      compact
                                      intakeEnabled={(configuration as any)?.needs_intake === true}
                                      service={{
                                        scheduled,
                                        collection: service.collection ?? 'invoice',
                                        price: service.price,
                                      }}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* The pipeline drawn as a pipeline.
                          A row of coloured pills is a set, and a client journey
                          is a sequence — the one thing pills cannot show is
                          that a contact moves from each stage to the next,
                          which is the entire idea. Numbered, connected, and in
                          the reading direction. */}
                      {previewData.pipelineStages && previewData.pipelineStages.length > 0 && (
                        <div style={{ gridColumn: '1/-1' }}>
                          <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-[14px] p-4">
                            <div className="flex items-center justify-between gap-3 mb-4">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span
                                  className="w-[27px] h-[27px] rounded-[9px] grid place-items-center flex-shrink-0"
                                  style={{ background: 'rgba(139, 92, 246, 0.12)', color: '#8B5CF6' }}
                                >
                                  <Users className="w-3.5 h-3.5" />
                                </span>
                                <h4 className="text-[13.5px] font-semibold text-[var(--v2-text-primary)] m-0">
                                  {selectedLanguage === 'he' ? 'מסע הלקוח שלך' : selectedLanguage === 'es' ? 'Tu recorrido de cliente' : 'Your client journey'}
                                </h4>
                              </div>
                              <button
                                onClick={openPipelineEditor}
                                className="text-[10.5px] text-[var(--v2-text-muted)] border border-[var(--v2-border)] rounded-full px-2.5 py-0.5 bg-[var(--v2-surface)] flex-shrink-0"
                              >
                                {changeLabel}
                              </button>
                            </div>

                            <div className="flex items-stretch gap-0 overflow-x-auto pb-1">
                              {previewData.pipelineStages.map((stage, idx) => (
                                <div key={stage.stage_key} className="flex items-center flex-shrink-0">
                                  {idx > 0 && (
                                    <span
                                      className="w-5 h-[2px] flex-shrink-0"
                                      style={{
                                        background: `linear-gradient(${isRTL ? 'to left' : 'to right'}, ${previewData.pipelineStages![idx - 1].color}, ${stage.color})`,
                                      }}
                                    />
                                  )}
                                  <div
                                    className="flex flex-col gap-1.5 px-3 py-2.5 rounded-xl border min-w-[104px]"
                                    style={{
                                      borderColor: `${stage.color}55`,
                                      background: `${stage.color}0F`,
                                    }}
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className="w-[18px] h-[18px] rounded-full grid place-items-center text-[10px] font-bold text-white flex-shrink-0"
                                        style={{ background: stage.color }}
                                      >
                                        {idx + 1}
                                      </span>
                                      <span
                                        className="text-[12px] font-semibold truncate"
                                        style={{ color: stage.color }}
                                      >
                                        {stage.stage_label}
                                      </span>
                                    </div>
                                    <span className="text-[10.5px] text-[var(--v2-text-muted)]">
                                      {idx === 0
                                        ? (selectedLanguage === 'he' ? 'נכנס לכאן' : selectedLanguage === 'es' ? 'entra aquí' : 'enters here')
                                        : idx === previewData.pipelineStages!.length - 1
                                          ? (selectedLanguage === 'he' ? 'סיום' : selectedLanguage === 'es' ? 'final' : 'done')
                                          : (selectedLanguage === 'he' ? 'בתהליך' : selectedLanguage === 'es' ? 'en curso' : 'in progress')}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>

                            <p className="text-[11px] text-[var(--v2-text-muted)] mt-3 mb-0 leading-relaxed">
                              {selectedLanguage === 'he'
                                ? 'כל פנייה נכנסת לשלב הראשון, ואתה מזיז אותה קדימה. כך תדע תמיד מי ממתין לך.'
                                : selectedLanguage === 'es'
                                  ? 'Cada consulta entra en la primera etapa y tú la mueves hacia adelante. Así siempre sabes quién te espera.'
                                  : 'Every enquiry lands in the first stage and you move it along. That is how you always know who is waiting on you.'}
                            </p>
                          </div>
                        </div>
                      )}

                      <SetupFactCard
                        color="#22C58B"
                        icon={<CreditCard className="w-3.5 h-3.5" />}
                        title={selectedLanguage === 'he' ? 'איך מקבלים תשלום' : selectedLanguage === 'es' ? 'Cómo cobras' : 'How you get paid'}
                        value={collectionSummary}
                        // Opens the services, because that is where the answer
                        // lives now. A business-wide chooser here would offer
                        // to overwrite per-service answers with one of them.
                        onChange={openServicesEditor}
                        changeLabel={changeLabel}
                      />

                      <SetupFactCard
                        color="#4F6EF7"
                        icon={<Globe className="w-3.5 h-3.5" />}
                        title={selectedLanguage === 'he' ? 'איך לקוחות מגיעים אליך' : selectedLanguage === 'es' ? 'Cómo te encuentran' : 'How clients reach you'}
                        value={presenceSummary}
                        onChange={() => setPlanEditor('presence')}
                        changeLabel={changeLabel}
                      />

                      {yoursCards.map(card => (
                        <SetupFactCard
                          key={card.key}
                          color="#C2410C"
                          yours
                          icon={card.icon}
                          title={card.title}
                          value={card.value}
                          note={card.note}
                        />
                      ))}
                    </SetupFactDeck>
                  </div>

                  {/* CTA Section */}
                  <div className="px-5 pb-5">
                    <div className="bg-[var(--v2-primary)]/10 rounded-xl p-4 border border-[var(--v2-primary)]/20">
                      <p className="text-sm text-[var(--v2-text-secondary)] mb-3">
                        {selectedLanguage === 'he'
                          ? 'הכל נראה טוב?'
                          : selectedLanguage === 'es'
                          ? '¿Todo bien?'
                          : 'All good?'}
                      </p>
                      {/* One action. There used to be a second — a return to
                          the conversation — which named a destination nobody
                          could picture: the plan is the screen, and "back to
                          the chat" read as undoing it. Every card carries its
                          own change link now, so there is nothing left for a
                          general escape hatch to do. */}
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={handleBuild}
                          disabled={isSending}
                          className="w-full px-6 py-3.5 bg-[var(--v2-primary)] text-white font-bold rounded-xl hover:opacity-90 transition-all shadow-lg hover:shadow-xl hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
                        >
                          {isSending ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : (
                            <>
                              <Sparkles className="w-5 h-5" />
                              {selectedLanguage === 'he' ? 'בנה את המערכת שלי!' : selectedLanguage === 'es' ? '¡Construir mi sistema!' : 'Build My System!'}
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
          </div>
        )}

        <div
          className={cn('flex flex-col gap-4', showPlanScreen && 'hidden')}
          style={{ height: 'calc(100vh - 150px)', minHeight: '560px' }}
        >
        <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg shadow-lg flex-1 min-h-0">
          <div className="flex flex-col h-full">
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
              {messages.map((message, index) => {
                // Skip rendering empty assistant messages (visual preview handles the display)
                if (message.role === 'assistant' && !message.content?.trim() && !message.suggestions?.length) {
                  return null;
                }
                return (
                <div
                  key={index}
                  // No direction conditionals here on purpose.
                  //
                  // The page root already carries dir="rtl" for Hebrew, which
                  // reverses flex order and makes justify-start/end resolve to
                  // the inline start and end. Adding `isRTL ? 'flex-row-reverse'`
                  // on top flipped it a second time, so the assistant's avatar
                  // came back to the left in Hebrew — the direction cancelled
                  // itself out. Logical properties already do this correctly.
                  className={cn(
                    'flex gap-3',
                    message.role === 'user' ? 'flex-row-reverse justify-end' : 'flex-row justify-start'
                  )}
                >
                  {/* Avatar */}
                  {message.role === 'assistant' && (
                    <div
                      className="w-8 h-8 bg-[var(--v2-primary)] flex items-center justify-center flex-shrink-0 rounded-lg"
                    >
                      <Bot className="h-4 w-4 text-white" />
                    </div>
                  )}

                  {/* Message Content */}
                  <div className="max-w-[75%]">
                    <div
                      className={cn(
                        'px-4 py-3 rounded-lg',
                        message.role === 'user'
                          ? 'bg-[var(--v2-primary)] text-white'
                          : 'bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)]',
                        isRTL ? 'text-right' : 'text-left'
                      )}
                    >
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">
                        {message.content}
                      </p>

{/* Suggestions are now rendered outside the message card - see below */}
                    </div>
                  </div>

                  {/* User Avatar */}
                  {message.role === 'user' && (
                    <div
                      className="w-8 h-8 bg-[var(--v2-primary)] flex items-center justify-center flex-shrink-0 rounded-lg"
                    >
                      <User className="h-4 w-4 text-white" />
                    </div>
                  )}
                </div>
              );
              })}

              {/* Standalone Suggestions - rendered outside message cards, no wrapper/icon */}
              {messages.length > 0 && (() => {
                const lastMessage = messages[messages.length - 1];
                if (lastMessage.role !== 'assistant' || !lastMessage.suggestions || showPreview) {
                  return null;
                }
                return (
                  <div className={cn('mt-4', isRTL ? 'text-right' : 'text-left')}>
                    {lastMessage.multiSelect ? (
                      // Multi-select with toggle buttons and platform icons
                      <div className="space-y-3">
                        {/* One answer per row.
                            Wrapped chips give each option a different width and
                            a different line depending on how long its text is,
                            so they read as a paragraph of buttons rather than a
                            list of choices — and the answers now carry their
                            consequence in the label ("— בלי סליקה"), which
                            makes them far too long to sit side by side. */}
                        <div className="flex flex-col gap-2">
                          {(() => {
                            // "Not now" and the rest cannot both be true, and
                            // the rule is worth showing rather than enforcing
                            // silently: picking a website used to make the
                            // "not now" chip quietly deselect itself, which
                            // reads as the interface changing its mind.
                            const isNone = (option: string) =>
                              option.toLowerCase().includes('none') ||
                              option.includes('לא צריך') ||
                              option.includes('no necesito') ||
                              option.toLowerCase().includes("don't need");

                            return lastMessage.suggestions!.map((suggestion, idx) => {
                            const isSelected = multiSelectChoices.has(suggestion);
                            // Detect "none" option by checking for common patterns across languages
                            // One definition, shared with the disabled state
                            // above — the English option reads "Don't need it
                            // now" and contains no "none" at all, so a second
                            // copy of this test would have disagreed with the
                            // first about which chip is the exclusive one.
                            const isNoneOption = isNone(suggestion);

                            // Map suggestion to icon based on content
                            const getIcon = () => {
                              const lower = suggestion.toLowerCase();
                              if (lower.includes('website') || lower.includes('אתר') || lower.includes('sitio')) {
                                return <Globe className="w-4 h-4" />;
                              }
                              if (lower.includes('facebook') || lower.includes('instagram') || lower.includes('google') ||
                                  lower.includes('פייסבוק') || lower.includes('אינסטגרם') || lower.includes('גוגל')) {
                                return <Share2 className="w-4 h-4" />;
                              }
                              if (isNoneOption) {
                                return <XCircle className="w-4 h-4" />;
                              }
                              return null;
                            };

                            const icon = getIcon();

                            return (
                              <button
                                key={idx}
                                onClick={() => {
                                  // Every option toggles on its own.
                                  //
                                  // Declining a website says nothing about
                                  // whether someone wants their Facebook and
                                  // Google connected — those are separate
                                  // questions, and the old "not now" chip
                                  // answered both at once. Making that chip
                                  // exclusive only moved the problem: picking
                                  // it then cleared the channels the user did
                                  // want. Nothing blocks anything now, and the
                                  // parser ignores a stray "not now" whenever a
                                  // real option was chosen with it.
                                  setMultiSelectChoices(prev => {
                                    const next = new Set(prev);
                                    if (next.has(suggestion)) next.delete(suggestion);
                                    else next.add(suggestion);
                                    return next;
                                  });
                                }}
                                disabled={isSending}
                                className={cn(
                                  // Identical to the single-select options —
                                  // same padding, radius and border — because
                                  // they are the same kind of thing. A shadow
                                  // and a scale on the chosen one made picking
                                  // an answer look like a different mechanism
                                  // in a different question.
                                  'w-full px-4 py-2.5 text-sm font-medium rounded-lg border transition-all disabled:opacity-50 flex items-center gap-2',
                                  isRTL ? 'text-right' : 'text-left',
                                  isSelected
                                    // The same tint-and-border the service
                                    // settings use for a chosen option, and
                                    // one step further than the hover state a
                                    // single-select chip already shows.
                                    ? 'bg-[var(--v2-primary)]/10 text-[var(--v2-primary)] border-[var(--v2-primary)]'
                                    : 'bg-[var(--v2-surface)] text-[var(--v2-text-primary)] border-[var(--v2-border)] hover:border-[var(--v2-primary)] hover:bg-[var(--v2-primary)]/5'
                                )}
                              >
                                {icon}
                                {suggestion}
                              </button>
                            );
                            });
                          })()}
                        </div>
                        {/* Always offered, including with nothing ticked.
                            The blanket "not now" chip used to carry that
                            answer, but it made declining a website and
                            declining channel tracking the same act — they are
                            not. Wanting neither is simply choosing nothing and
                            carrying on. */}
                        {(
                          <button
                            onClick={() => {
                              const chosen = Array.from(multiSelectChoices);
                              sendMessage(
                                chosen.length > 0
                                  ? chosen.join(', ')
                                  // Said in the words the parser reads, so an
                                  // empty selection records both as declined
                                  // rather than arriving as an empty message.
                                  : selectedLanguage === 'he'
                                    ? 'לא צריך כרגע'
                                    : selectedLanguage === 'es'
                                      ? 'No necesito por ahora'
                                      : "Don't need it now"
                              );
                              setMultiSelectChoices(new Set());
                            }}
                            disabled={isSending}
                            className={cn(
                              // Same shape as the options above it — a row of
                              // the same width, height and radius. A gradient
                              // pill with a shadow read as a different kind of
                              // thing entirely, which is how it ends up looking
                              // like an advert rather than the next step.
                              'w-full px-4 py-2.5 text-sm font-semibold rounded-lg border border-[var(--v2-primary)] transition-all disabled:opacity-50',
                              'bg-[var(--v2-primary)] text-white hover:opacity-90',
                              'flex items-center gap-2',
                              'justify-center'
                            )}
                          >
                            {isSending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                <Check className="w-4 h-4" />
                                {multiSelectChoices.size > 0
                                  ? (selectedLanguage === 'he' ? 'המשך' : selectedLanguage === 'es' ? 'Continuar' : 'Continue')
                                  : (selectedLanguage === 'he' ? 'המשך בלי אלה' : selectedLanguage === 'es' ? 'Continuar sin esto' : 'Continue without these')}
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    ) : (
                      // Single-select buttons (original behavior)
                      <div className="flex flex-col gap-2">
                        {lastMessage.suggestions.map((suggestion, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleSuggestionClick(suggestion)}
                            disabled={isSending}
                            className={cn(
                              'w-full px-4 py-2.5 text-sm font-medium bg-[var(--v2-surface)] text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:border-[var(--v2-primary)] hover:bg-[var(--v2-primary)]/5 rounded-lg transition-all disabled:opacity-50',
                              isRTL ? 'text-right' : 'text-left'
                            )}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}


              <div ref={messagesEndRef} />
            </div>

            {/* Services Form Modal */}
            {showServicesForm && (
              <div className="px-6 py-4 border-t border-[var(--v2-border)] bg-[var(--v2-surface)]">
                <div className="bg-[var(--v2-primary)]/5 border border-[var(--v2-primary)]/20 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
                      {selectedLanguage === 'he' ? 'הוסף שירותים' : selectedLanguage === 'es' ? 'Agregar servicios' : 'Add Services'}
                    </h3>
                    <button
                      onClick={() => setShowServicesForm(false)}
                      className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Header Row */}
                  <div className={cn('grid grid-cols-12 gap-2 mb-2 text-xs font-medium text-[var(--v2-text-secondary)]', isRTL && 'text-right')}>
                    <div className="col-span-3">
                      {selectedLanguage === 'he' ? 'שם השירות' : selectedLanguage === 'es' ? 'Nombre del servicio' : 'Service Name'}
                    </div>
                    <div className="col-span-2">
                      {selectedLanguage === 'he' ? 'דורש תור?' : selectedLanguage === 'es' ? '¿Cita?' : 'Appointment?'}
                    </div>
                    <div className="col-span-1">
                      {selectedLanguage === 'he' ? 'משך' : selectedLanguage === 'es' ? 'Duración' : 'Duration'}
                    </div>
                    <div className="col-span-2">
                      {selectedLanguage === 'he' ? 'מחיר' : selectedLanguage === 'es' ? 'Precio' : 'Price'}
                      {/* Says out loud that the box can be left empty. A price
                          field with a 0 in it reads as required, so a business
                          that quotes per client types a number it does not
                          mean — and that number goes on a public page. */}
                      <span className="block text-[10px] font-normal text-[var(--v2-text-muted)] leading-tight">
                        {selectedLanguage === 'he'
                          ? 'ריק = לפי הצעת מחיר'
                          : selectedLanguage === 'es'
                            ? 'vacío = a convenir'
                            : 'empty = on request'}
                      </span>
                    </div>
                    <div className="col-span-2">
                      {selectedLanguage === 'he' ? 'איך משלמים?' : selectedLanguage === 'es' ? '¿Cómo se paga?' : 'How paid?'}
                    </div>
                    <div className="col-span-1">
                      {selectedLanguage === 'he' ? 'תשלומים' : selectedLanguage === 'es' ? 'Cuotas' : 'Plan'}
                    </div>
                    <div className="col-span-1"></div>
                  </div>

                  {/* Service Rows */}
                  <div className="space-y-2">
                    {servicesInput.map((service, index) => (
                      <div key={index} className="grid grid-cols-12 gap-2">
                        <input
                          type="text"
                          value={service.name}
                          onChange={(e) => updateServiceRow(index, 'name', e.target.value)}
                          placeholder={selectedLanguage === 'he' ? 'לדוגמה: ייעוץ אישי' : selectedLanguage === 'es' ? 'Ej: Consulta personal' : 'e.g. Personal Consultation'}
                          className={cn(
                            'col-span-3 px-3 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)]',
                            isRTL && 'text-right'
                          )}
                        />

                        {/* Does a client pick a time for this? A product does
                            not, and saying so here is what keeps the platform
                            from asking this business for working hours it will
                            never use. */}
                        <div className="col-span-2 flex gap-1">
                          {([true, false] as const).map(value => (
                            <button
                              key={String(value)}
                              type="button"
                              onClick={() => updateServiceRow(index, 'isScheduled', value)}
                              className={cn(
                                'flex-1 px-1 py-2 text-[11px] rounded-lg border transition-colors',
                                service.isScheduled === value
                                  ? 'border-[#14B8A6] bg-[#14B8A6]/10 text-[#14B8A6] font-semibold'
                                  : 'border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                              )}
                            >
                              {value
                                ? (selectedLanguage === 'he' ? 'כן' : selectedLanguage === 'es' ? 'Sí' : 'Yes')
                                : (selectedLanguage === 'he' ? 'לא' : selectedLanguage === 'es' ? 'No' : 'No')}
                            </button>
                          ))}
                        </div>

                        {/* Kept whatever the answer above was. A service can
                            take two hours and still not be booked against a
                            time — a workshop sold as a product, a recorded
                            course. The duration describes the thing; the
                            toggle describes how a client gets it. */}
                        <input
                          type="number"
                          value={service.duration}
                          onChange={(e) => updateServiceRow(index, 'duration', e.target.value)}
                          placeholder="60"
                          className={cn(
                            'col-span-1 px-2 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] text-[var(--v2-text-primary)]',
                            isRTL && 'text-right'
                          )}
                        />
                        <div className="col-span-2 relative">
                          {/* The currency is picked here, in the row, where
                              the price is typed — not behind the payment
                              dialog, which is about how a price is split, not
                              what it is denominated in. Same dropdown the
                              service settings use, with a trigger small enough
                              to sit inside the field. */}
                          <div className={cn(
                            'absolute top-1/2 -translate-y-1/2 z-10',
                            isRTL ? 'right-2.5' : 'left-2.5'
                          )}>
                            <ServiceCurrencySelect
                              value={service.currency}
                              onChange={code => updateServiceRow(index, 'currency', code)}
                              compact
                            />
                          </div>
                          <input
                            type="number"
                            value={service.price}
                            onChange={(e) => updateServiceRow(index, 'price', e.target.value)}
                            placeholder="—"
                            className={cn(
                              'w-full px-3 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] text-[var(--v2-text-primary)]',
                              isRTL ? 'pr-11 text-right' : 'pl-11'
                            )}
                          />
                        </div>

                        {/* Opens the same payment options the service
                            settings dialog offers. A row this narrow cannot
                            hold a payment type, a count and a frequency, and
                            splitting them across two different shapes would
                            mean learning the feature twice. */}
                        {/* How the money arrives — replacing the question the
                            chat used to ask the business once, which could not
                            describe a practice that takes a card for a session
                            and invoices for a programme. */}
                        <div className="col-span-2 flex gap-1">
                          {(['online', 'invoice'] as const).map(value => {
                            // `?? ''` because a row reaching here without a
                            // price throws inside render, and a thrown render
                            // takes the whole form down — every button in it
                            // stops responding, which reads as "the send is
                            // disabled" rather than as a crash.
                            const priceText = service.price ?? '';
                            const priced = priceText.trim() !== '' && parseFloat(priceText) > 0;
                            return (
                              <button
                                key={value}
                                type="button"
                                disabled={!priced}
                                onClick={() => updateServiceRow(index, 'collection', value)}
                                className={cn(
                                  'flex-1 px-1 py-2 text-[11px] rounded-lg border transition-colors truncate',
                                  !priced
                                    ? 'border-[var(--v2-border)] text-[var(--v2-text-muted)] opacity-40'
                                    : service.collection === value
                                      ? 'border-[#22C58B] bg-[#22C58B]/10 text-[#22C58B] font-semibold'
                                      : 'border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                                )}
                              >
                                {value === 'online'
                                  ? (selectedLanguage === 'he' ? 'כרטיס' : selectedLanguage === 'es' ? 'Tarjeta' : 'Card')
                                  : (selectedLanguage === 'he' ? 'חשבונית' : selectedLanguage === 'es' ? 'Factura' : 'Invoice')}
                              </button>
                            );
                          })}
                        </div>

                        <button
                          type="button"
                          onClick={() => setPaymentDialogIndex(index)}
                          className={cn(
                            'col-span-1 px-1 py-2 text-xs rounded-lg border transition-colors truncate',
                            service.paymentType === 'installments'
                              ? 'border-[#14B8A6] text-[#14B8A6] bg-[#14B8A6]/10'
                              : 'border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                          )}
                        >
                          {service.paymentType === 'installments'
                            ? `${service.installmentCount}×`
                            : (selectedLanguage === 'he' ? 'תשלום מלא' : selectedLanguage === 'es' ? 'Pago único' : 'Full')}
                        </button>

                        <button
                          onClick={() => removeServiceRow(index)}
                          disabled={servicesInput.length === 1}
                          className="col-span-1 flex items-center justify-center text-[var(--v2-text-muted)] hover:text-red-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* One question about the business, under the services it
                      applies to. A switch rather than a tick because it is a
                      setting being turned on, not an item being selected. */}
                  <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-[var(--v2-border)]">
                    <div className="min-w-0">
                      <span className="block text-sm text-[var(--v2-text-primary)]">
                        {selectedLanguage === 'he'
                          ? 'לקוחות ממלאים טופס לפני הפגישה?'
                          : selectedLanguage === 'es'
                            ? '¿Los clientes rellenan un formulario antes de la cita?'
                            : 'Do clients fill in a form before the appointment?'}
                      </span>
                      <span className="block text-[11px] text-[var(--v2-text-muted)] mt-0.5 leading-snug">
                        {selectedLanguage === 'he'
                          ? 'את השאלות עצמן תבחר אחר כך — אני רק צריך לדעת אם צריך.'
                          : selectedLanguage === 'es'
                            ? 'Las preguntas las eliges después — solo necesito saber si hace falta.'
                            : 'You pick the questions later — I just need to know whether to set one up.'}
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={needsIntake}
                      onClick={() => setNeedsIntake(v => !v)}
                      className={cn(
                        'relative w-11 h-6 rounded-full transition-colors flex-shrink-0',
                        needsIntake ? 'bg-[#8B5CF6]' : 'bg-[var(--v2-border)]'
                      )}
                    >
                      <span
                        className={cn(
                          'absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all',
                          needsIntake
                            ? (isRTL ? 'left-0.5' : 'right-0.5')
                            : (isRTL ? 'right-0.5' : 'left-0.5')
                        )}
                      />
                    </button>
                  </div>

                  {/* Actions */}
                  {/* justify-between already resolves against dir; reversing
                      on top of it put "add service" back on the wrong side. */}
                  <div className="flex items-center justify-between mt-4">
                    <button
                      onClick={addServiceRow}
                      className="flex items-center gap-1 text-sm text-[var(--v2-primary)] hover:text-[var(--v2-primary)]/80 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      {selectedLanguage === 'he' ? 'הוסף שירות' : selectedLanguage === 'es' ? 'Agregar servicio' : 'Add Service'}
                    </button>
                    <button
                      onClick={submitServices}
                      disabled={!servicesInput.some(s => (s.name ?? '').trim())}
                      className="px-4 py-2 text-sm font-medium bg-[var(--v2-primary)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {selectedLanguage === 'he' ? 'שלח' : selectedLanguage === 'es' ? 'Enviar' : 'Submit'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Input Area - hide when services form is shown */}
            {!showServicesForm && (
              <div className="px-6 py-4 border-t border-[var(--v2-border)]">
                <div className={cn('flex gap-2', isRTL && 'flex-row-reverse')}>
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage(inputValue);
                      }
                    }}
                    placeholder={
                      selectedLanguage === 'he' ? 'הקלד את התשובה שלך...'
                      : selectedLanguage === 'es' ? 'Escribe tu respuesta...'
                      : 'Type your answer...'
                    }
                    disabled={isSending || (showPreview && currentStep !== 'preview_adjustment' && currentStep !== 'preview')}
                    className={cn(
                      'flex-1 px-4 py-2.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-sm text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] disabled:opacity-50',
                      isRTL && 'text-right'
                    )}
                  />

                  <button
                    onClick={() => sendMessage(inputValue)}
                    disabled={isSending || !inputValue.trim() || (showPreview && currentStep !== 'preview_adjustment' && currentStep !== 'preview')}
                    className="px-4 py-2 bg-[var(--v2-primary)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

      {/* The setup, assembling — under the conversation, which leads.
            Same chain, same colours and same labels the dashboard will show
            once they are through, so the picture learned here is the picture
            they keep. It replaces the progress bar that used to sit above:
            "3 of 5 questions" measures the interview, this measures the thing
            the interview is for.

            Held back until the language is chosen: before that the screen is a
            single welcome question, and a setup panel under it would be
            answering something nobody has asked yet — in a language we have
            not been told to use. */}
        {currentStep !== 'welcome' && currentStep !== 'language_selection' && (
          <div className="flex-none">
            <OnboardingSetupPanel signals={setupSignals} />
          </div>
        )}
        </div>

{/* Pipeline Editor Modal.
    At page level because its trigger is the "change" link on the plan
    screen, and the plan screen replaces the conversation — a modal
    living inside the hidden chat would have opened where nobody
    could see it. It is fixed-position anyway, so it belongs to
    neither. */}
{showPipelineEditor && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    <div className="bg-[var(--v2-surface)] rounded-2xl shadow-2xl max-w-md w-full max-h-[80vh] overflow-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-[var(--v2-border)]">
        <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
          {selectedLanguage === 'he' ? 'עריכת שלבי צינור' : selectedLanguage === 'es' ? 'Editar etapas' : 'Edit Pipeline Stages'}
        </h3>
        <button
          onClick={() => setShowPipelineEditor(false)}
          className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Stages List */}
      <div className="p-4 space-y-2 overflow-y-auto max-h-[50vh]">
        {editingPipelineStages.map((stage, index) => (
          <div
            key={stage.stage_key}
            className="flex items-center gap-2 p-3 bg-[var(--v2-bg)] rounded-lg border border-[var(--v2-border)]"
          >
            {/* Drag Handle / Position Controls */}
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => movePipelineStage(index, 'up')}
                disabled={index === 0}
                className="p-0.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              </button>
              <button
                onClick={() => movePipelineStage(index, 'down')}
                disabled={index === editingPipelineStages.length - 1}
                className="p-0.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-primary)] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {/* Color Indicator */}
            <div
              className="w-3 h-8 rounded-full flex-shrink-0"
              style={{ backgroundColor: stage.color }}
            />

            {/* Stage Label Input.
                Renaming is theirs — a clinic says "Active Client", a school
                "Enrolled", a gym "Member". What cannot go is the stage itself:
                it is what the platform reads to answer whether a contact became
                a customer, so the name travels and the meaning stays. */}
            <input
              type="text"
              value={stage.stage_label}
              onChange={(e) => updatePipelineStageLabel(index, e.target.value)}
              className={cn(
                'flex-1 px-3 py-1.5 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] text-[var(--v2-text-primary)]',
                isRTL && 'text-right'
              )}
            />

            {/* Delete Button */}
            <button
              onClick={() => removePipelineStage(index)}
              disabled={editingPipelineStages.length <= 2 || stage.is_primary_client_stage}
              title={stage.is_primary_client_stage
                ? (selectedLanguage === 'he'
                    ? 'אי אפשר למחוק את שלב הלקוח.'
                    : selectedLanguage === 'es'
                      ? 'La etapa de cliente no se puede eliminar.'
                      : 'The client stage cannot be deleted.')
                : undefined}
              className="p-1.5 text-[var(--v2-text-muted)] hover:text-red-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {stage.is_primary_client_stage ? <Lock className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
            </button>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-[var(--v2-border)] space-y-3">
        <button
          onClick={addPipelineStage}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-[var(--v2-primary)] bg-[var(--v2-primary)]/10 rounded-lg hover:bg-[var(--v2-primary)]/20 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {selectedLanguage === 'he' ? 'הוסף שלב' : selectedLanguage === 'es' ? 'Agregar etapa' : 'Add Stage'}
        </button>
        <button
          onClick={savePipelineChanges}
          className="w-full px-4 py-2.5 bg-[var(--v2-primary)] text-white font-medium rounded-lg hover:opacity-90 transition-opacity"
        >
          {selectedLanguage === 'he' ? 'שמור שינויים' : selectedLanguage === 'es' ? 'Guardar cambios' : 'Save Changes'}
        </button>
      </div>
    </div>
  </div>
)}

        {/* Payment options for one service.
          The same three controls the service settings dialog offers — payment
          type, how many instalments, how often — using the same wording, so a
          plan built during onboarding and one built later are the same feature
          rather than two that resemble each other. */}
      {paymentDialogIndex !== null && servicesInput[paymentDialogIndex] && (() => {
        const index = paymentDialogIndex;
        const service = servicesInput[index];
        const price = parseFloat(service.price) || 0;
        const count = Math.max(2, parseInt(service.installmentCount, 10) || 2);

        return (
          <>
            <div className="fixed inset-0 bg-black/50 z-50" onClick={() => setPaymentDialogIndex(null)} />
            <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(420px,92vw)]">
              <div
                className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl shadow-2xl p-5 space-y-4"
                dir={isRTL ? 'rtl' : 'ltr'}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    {t('scheduling.modal.payment_options')}
                  </h3>
                  <button onClick={() => setPaymentDialogIndex(null)} className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-sm text-[var(--v2-text-primary)] font-medium truncate">
                  {service.name || (selectedLanguage === 'he' ? 'שירות ללא שם' : selectedLanguage === 'es' ? 'Servicio sin nombre' : 'Unnamed service')}
                </p>

                {/* Literally the settings dialog's own payment section, not a
                    copy of it: same component, same controls, same wording. A
                    plan built here and one built later in the service settings
                    cannot drift apart, because there is only one of them. */}
                <ServicePaymentOptions
                  formData={{
                    price,
                    currency: service.currency,
                    payment_type: service.paymentType,
                    installment_count: count,
                    installment_frequency: service.installmentFrequency,
                    first_payment_due: service.firstPaymentDue,
                    first_payment_days: parseInt(service.firstPaymentDays, 10) || 7,
                  }}
                  setFormData={updater => {
                    const next = updater({
                      price,
                      currency: service.currency,
                      payment_type: service.paymentType,
                      installment_count: count,
                      installment_frequency: service.installmentFrequency,
                      first_payment_due: service.firstPaymentDue,
                      first_payment_days: parseInt(service.firstPaymentDays, 10) || 7,
                    });
                    updateServiceRow(index, 'paymentType', next.payment_type);
                    updateServiceRow(index, 'installmentCount', String(next.installment_count));
                    updateServiceRow(index, 'installmentFrequency', next.installment_frequency);
                    updateServiceRow(index, 'firstPaymentDue', next.first_payment_due);
                    updateServiceRow(index, 'firstPaymentDays', String(next.first_payment_days));
                  }}
                  getCurrencySymbol={getCurrencySymbol}
                  // No price typed means it is agreed with each client, not
                  // that the work is free — and a quoted project is exactly the
                  // kind that gets paid in instalments.
                  quoted={(service.price ?? '').trim() === ''}
                />

                <button
                  onClick={() => setPaymentDialogIndex(null)}
                  className="w-full px-4 py-2.5 bg-[var(--v2-primary)] text-white text-sm font-medium rounded-lg hover:opacity-90"
                >
                  {selectedLanguage === 'he' ? 'סיום' : selectedLanguage === 'es' ? 'Listo' : 'Done'}
                </button>
              </div>
            </div>
          </>
        );
      })()}

{/* Editing one fact from the plan.
    Each of these opens from the change link on the card it belongs to and
    changes only what that card states. They sit at page level for the same
    reason the two above do: the plan screen replaces the conversation, and
    a modal rendered inside it would open unseen. */}
{planEditor === 'services' && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
    {/* Wide enough to read a service name.
        Five columns of content in a 32rem dialog left the name field about
        160px, so anything longer than two words scrolled inside its own box —
        and the whole point of the editor is checking what it says. */}
    <div className="bg-[var(--v2-surface)] rounded-2xl shadow-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between p-4 border-b border-[var(--v2-border)]">
        <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
          {selectedLanguage === 'he' ? 'מה שאתה מוכר' : selectedLanguage === 'es' ? 'Lo que vendes' : 'What you sell'}
        </h3>
        <button onClick={() => setPlanEditor(null)} className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 overflow-y-auto space-y-2">
        {/* Same three columns and the same currency control as the service
            settings, so a price is typed the one way it is typed everywhere. */}
        <div className={cn('grid grid-cols-12 gap-2 text-xs font-medium text-[var(--v2-text-secondary)]', isRTL && 'text-right')}>
          <div className="col-span-3">
            {selectedLanguage === 'he' ? 'שם השירות' : selectedLanguage === 'es' ? 'Nombre' : 'Service'}
          </div>
          <div className="col-span-2">
            {selectedLanguage === 'he' ? 'דורש תור?' : selectedLanguage === 'es' ? '¿Cita?' : 'Appointment?'}
          </div>
          <div className="col-span-1">
            {selectedLanguage === 'he' ? 'משך' : selectedLanguage === 'es' ? 'Duración' : 'Duration'}
          </div>
          <div className="col-span-2">
            {selectedLanguage === 'he' ? 'מחיר' : selectedLanguage === 'es' ? 'Precio' : 'Price'}
            <span className="block text-[10px] font-normal text-[var(--v2-text-muted)] leading-tight">
              {selectedLanguage === 'he' ? 'ריק = הצעת מחיר' : selectedLanguage === 'es' ? 'vacío = a convenir' : 'empty = on request'}
            </span>
          </div>
          <div className="col-span-2">
            {selectedLanguage === 'he' ? 'איך משלמים?' : selectedLanguage === 'es' ? '¿Cómo se paga?' : 'How paid?'}
          </div>
          <div className="col-span-1">
            {selectedLanguage === 'he' ? 'תשלומים' : selectedLanguage === 'es' ? 'Cuotas' : 'Plan'}
          </div>
          <div className="col-span-1" />
        </div>

        {draftServices.map((service, index) => (
          <div key={index} className="grid grid-cols-12 gap-2 items-center">
            <input
              type="text"
              value={service.service_name}
              onChange={e => updateDraftService(index, 'service_name', e.target.value)}
              className={cn(
                'col-span-3 px-3 py-2 text-sm bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] text-[var(--v2-text-primary)]',
                isRTL && 'text-right'
              )}
            />

            <div className="col-span-2 flex gap-1">
              {([true, false] as const).map(value => (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => updateDraftService(index, 'is_scheduled', value)}
                  className={cn(
                    'flex-1 px-1 py-2 text-[11px] rounded-lg border transition-colors',
                    (service.is_scheduled !== false) === value
                      ? 'border-[#14B8A6] bg-[#14B8A6]/10 text-[#14B8A6] font-semibold'
                      : 'border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                  )}
                >
                  {value
                    ? (selectedLanguage === 'he' ? 'כן' : selectedLanguage === 'es' ? 'Sí' : 'Yes')
                    : 'No'}
                </button>
              ))}
            </div>

            <input
              type="number"
              value={service.duration_minutes || ''}
              onChange={e => updateDraftService(index, 'duration_minutes', e.target.value)}
              placeholder="60"
              className={cn(
                'col-span-1 px-2 py-2 text-sm bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] text-[var(--v2-text-primary)]',
                isRTL && 'text-right'
              )}
            />
            <div className="col-span-2 relative">
              <div className={cn('absolute top-1/2 -translate-y-1/2 z-10', isRTL ? 'right-2.5' : 'left-2.5')}>
                <ServiceCurrencySelect
                  value={(service.currency as 'USD' | 'EUR' | 'ILS' | 'GBP') || currencyForLanguage(selectedLanguage)}
                  onChange={code => updateDraftService(index, 'currency', code)}
                  compact
                  align={isRTL ? 'end' : 'start'}
                />
              </div>
              <input
                type="number"
                value={service.price === null || service.price === undefined ? '' : service.price}
                onChange={e => updateDraftService(index, 'price', e.target.value)}
                placeholder="—"
                className={cn(
                  'w-full px-3 py-2 text-sm bg-[var(--v2-bg)] border border-[var(--v2-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] text-[var(--v2-text-primary)]',
                  isRTL ? 'pr-11 text-right' : 'pl-11'
                )}
              />
            </div>
            {/* How this one is collected. Per service, because a practice can
                take a card for a session and invoice for a programme — and
                whether this business is ever asked to connect a processor is
                read off exactly these answers. */}
            <div className="col-span-2 flex gap-1">
              {(['online', 'invoice'] as const).map(value => {
                const priced = (service.price || 0) > 0;
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={!priced}
                    onClick={() => updateDraftService(index, 'collection', value)}
                    className={cn(
                      'flex-1 px-1 py-2 text-[11px] rounded-lg border transition-colors truncate',
                      !priced
                        ? 'border-[var(--v2-border)] text-[var(--v2-text-muted)] opacity-40'
                        : (service.collection ?? 'invoice') === value
                          ? 'border-[#22C58B] bg-[#22C58B]/10 text-[#22C58B] font-semibold'
                          : 'border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                    )}
                  >
                    {value === 'online'
                      ? (selectedLanguage === 'he' ? 'כרטיס' : selectedLanguage === 'es' ? 'Tarjeta' : 'Card')
                      : (selectedLanguage === 'he' ? 'חשבונית' : selectedLanguage === 'es' ? 'Factura' : 'Invoice')}
                  </button>
                );
              })}
            </div>

            {/* The same arrangement the settings dialog holds. */}
            <button
              type="button"
              onClick={() => setDraftPaymentIndex(index)}
              className={cn(
                'col-span-1 px-1 py-2 text-xs rounded-lg border transition-colors truncate',
                service.payment_plan
                  ? 'border-[#14B8A6] text-[#14B8A6] bg-[#14B8A6]/10'
                  : 'border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
              )}
            >
              {service.payment_plan
                ? `${service.payment_plan.installment_count}×`
                : (selectedLanguage === 'he' ? 'תשלום מלא' : selectedLanguage === 'es' ? 'Pago único' : 'Full')}
            </button>

            <button
              onClick={() => setDraftServices(rows => rows.filter((_, i) => i !== index))}
              className="col-span-1 flex items-center justify-center text-[var(--v2-text-muted)] hover:text-red-500 transition-colors"
              aria-label={selectedLanguage === 'he' ? 'מחק' : selectedLanguage === 'es' ? 'Eliminar' : 'Remove'}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        <button
          onClick={() => setDraftServices(rows => [...rows, {
            service_name: '',
            duration_minutes: 60,
            price: null,
            currency: currencyForLanguage(selectedLanguage),
            is_scheduled: true,
            collection: 'invoice',
            payment_plan: null,
          }])}
          className="flex items-center gap-1 text-sm text-[var(--v2-primary)] hover:opacity-80 transition-opacity pt-1"
        >
          <Plus className="w-4 h-4" />
          {selectedLanguage === 'he' ? 'הוסף שירות' : selectedLanguage === 'es' ? 'Agregar servicio' : 'Add service'}
        </button>
      </div>

      <div className="flex items-center justify-end gap-2 p-4 border-t border-[var(--v2-border)]">
        <button
          onClick={() => setPlanEditor(null)}
          className="px-4 py-2 text-sm text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-colors"
        >
          {selectedLanguage === 'he' ? 'ביטול' : selectedLanguage === 'es' ? 'Cancelar' : 'Cancel'}
        </button>
        <button
          onClick={saveServicesEditor}
          className="px-4 py-2 text-sm font-medium bg-[var(--v2-primary)] text-white rounded-lg hover:opacity-90 transition-opacity"
        >
          {selectedLanguage === 'he' ? 'שמור שינויים' : selectedLanguage === 'es' ? 'Guardar cambios' : 'Save changes'}
        </button>
      </div>
    </div>
  </div>
)}

{/* Paying over time, for a service on the plan.
    Above the services editor rather than inside it, so the two do not fight
    over the same stacking context — and it is the very component the service
    settings use, so a plan agreed here is the plan the settings will show. */}
{planEditor === 'services' && draftPaymentIndex !== null && draftServices[draftPaymentIndex] && (() => {
  const index = draftPaymentIndex;
  const service = draftServices[index];
  const plan = service.payment_plan;
  const values = {
    price: service.price ?? 0,
    currency: (service.currency as 'USD' | 'EUR' | 'ILS' | 'GBP') || currencyForLanguage(selectedLanguage),
    payment_type: (plan ? 'installments' : 'full') as 'full' | 'installments',
    installment_count: plan?.installment_count ?? 2,
    installment_frequency: (plan?.installment_frequency ?? 'monthly') as 'weekly' | 'biweekly' | 'monthly',
    first_payment_due: 'on_booking' as const,
    first_payment_days: 7,
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60]" onClick={() => setDraftPaymentIndex(null)} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] w-[min(420px,92vw)]">
        <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl shadow-2xl p-5 space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              {t('scheduling.modal.payment_options')}
            </h3>
            <button onClick={() => setDraftPaymentIndex(null)} className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]">
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-sm text-[var(--v2-text-primary)] font-medium truncate">
            {service.service_name || (selectedLanguage === 'he' ? 'שירות ללא שם' : selectedLanguage === 'es' ? 'Servicio sin nombre' : 'Unnamed service')}
          </p>

          <ServicePaymentOptions
            formData={values}
            setFormData={updater => {
              const next = updater(values);
              setDraftPaymentPlan(
                index,
                next.payment_type === 'installments' && next.installment_count >= 2
                  ? {
                    installment_count: next.installment_count,
                    // The plan stores the three frequencies the build accepts;
                    // quarterly is a settings-only option and would be dropped
                    // by the schema on the way through, so it falls back to
                    // the nearest thing that survives.
                    installment_frequency: next.installment_frequency === 'quarterly' ? 'monthly' : next.installment_frequency,
                  }
                  : null
              );
            }}
            getCurrencySymbol={getCurrencySymbol}
            // A blank price is agreed per client, not free — and a quoted
            // project is exactly the kind paid in instalments.
            quoted={service.price === null || service.price === undefined}
          />

          <button
            onClick={() => setDraftPaymentIndex(null)}
            className="w-full px-4 py-2.5 bg-[var(--v2-primary)] text-white text-sm font-medium rounded-lg hover:opacity-90"
          >
            {selectedLanguage === 'he' ? 'סיום' : selectedLanguage === 'es' ? 'Listo' : 'Done'}
          </button>
        </div>
      </div>
    </>
  );
})()}

{/* Only presence is still a business-wide question. How money is collected
    moved onto each service, so its chooser is gone rather than left to
    overwrite three per-service answers with one. */}
{planEditor === 'presence' && (() => {
  const options: Array<{ key: string; title: string; body: string; selected: boolean; apply: () => void }> = [
      {
        key: 'full_website',
        title: selectedLanguage === 'he' ? 'אתר מלא' : selectedLanguage === 'es' ? 'Un sitio completo' : 'A full website',
        body: selectedLanguage === 'he'
          ? 'אבנה ואפרסם אתר עם השירותים שלך, ומשם מזמינים.'
          : selectedLanguage === 'es'
            ? 'Construyo y publico un sitio con tus servicios, y ahí reservan.'
            : "I build and publish a site with your services, and that is where clients book.",
        selected: configuration?.online_presence_mode === 'full_website' || configuration?.online_presence_mode === 'website_only',
        apply: () => setPresenceMode('full_website'),
      },
      {
        key: 'booking_only',
        title: selectedLanguage === 'he' ? 'לינק להזמנות בלבד' : selectedLanguage === 'es' ? 'Solo un enlace de reserva' : 'A booking link only',
        body: selectedLanguage === 'he'
          ? 'לינק שאפשר לשלוח בוואטסאפ או להוסיף לאתר שכבר יש לך.'
          : selectedLanguage === 'es'
            ? 'Un enlace para WhatsApp o para el sitio que ya tienes.'
            : 'A link to paste into WhatsApp, or into the site you already have.',
        selected: configuration?.online_presence_mode === 'booking_only' || configuration?.online_presence_mode === 'none',
        apply: () => setPresenceMode('booking_only'),
      },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--v2-surface)] rounded-2xl shadow-2xl max-w-md w-full overflow-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="flex items-center justify-between p-4 border-b border-[var(--v2-border)]">
          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
            {selectedLanguage === 'he' ? 'איך לקוחות מגיעים אליך' : selectedLanguage === 'es' ? 'Cómo te encuentran' : 'How clients reach you'}
          </h3>
          <button onClick={() => setPlanEditor(null)} className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-2">
          {options.map(option => (
            <button
              key={option.key}
              onClick={option.apply}
              className={cn(
                'w-full p-3 rounded-xl border transition-colors',
                isRTL ? 'text-right' : 'text-left',
                option.selected
                  ? 'border-[var(--v2-primary)] bg-[var(--v2-primary)]/10'
                  : 'border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)]'
              )}
            >
              <span className="flex items-center gap-2">
                <span className="text-sm font-semibold text-[var(--v2-text-primary)]">{option.title}</span>
                {option.selected && <Check className="w-4 h-4 text-[var(--v2-primary)] flex-shrink-0" />}
              </span>
              <span className="block text-xs text-[var(--v2-text-secondary)] mt-1 leading-relaxed">{option.body}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
})()}

      </div>
    </div>
  );
}
