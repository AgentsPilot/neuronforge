'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Bot, Loader2, Send, User, Sparkles, Globe, Check, Moon, Sun, Users, Calendar, CreditCard, Mail, Zap, Phone, X, ArrowLeftRight, Megaphone } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { V2Logo } from '@/components/v2/V2Header';
import { useV2Theme } from '@/lib/design-system-v2';
import { useLanguage } from '@/lib/business-os/LanguageContext';

type OnboardingStep = 'welcome' | 'processing' | 'discovery' | 'preview' | 'building' | 'success';
type Locale = 'en' | 'es' | 'he';

interface Message {
  role: 'assistant' | 'user' | 'system' | 'typing';
  content: string;
  variant?: 'question' | 'info';
  // For interactive questions with quick-select buttons
  quickOptions?: QuickOption[];
  multiSelect?: boolean; // Allow selecting multiple options
}

interface QuickOption {
  label: string;
  value: string;
  iconName?: 'Globe' | 'Users' | 'ArrowLeftRight' | 'Phone' | 'X' | 'Calendar' | 'CreditCard' | 'Mail' | 'Check';
}

interface BusinessProfile {
  vertical: string;
  sub_vertical?: string;
  company_name?: string;
  services: string[];
  clients_per_week?: number;
  tools: string[];
  website_url?: string;
  profile_completeness: number;
}

const translations = {
  en: {
    welcome: "Welcome!",
    welcomeMsg: "I'm here to help you run your business. Tell me about what you do, and I'll set everything up for you.",
    headerTitle: "Let's Get You Started",
    headerSubtitle: "I'll help you set up everything you need",
    uploadPrompt: "You can type your business info below, or upload a file with your details.",
    typeHere: "Tell me about your business...",
    uploadFile: "Upload Bio",
    processing: "Reading your information...",
    building: "Setting everything up...",
    buildingWebsite: "Building your website...",
    buildingCRM: "Setting up your client list...",
    buildingAutomation: "Activating your assistants...",
    success: "You're all set!",
    successMsg: "Everything is ready. Taking you to your dashboard...",
    previewTitle: "Here's what I learned about your business:",
    previewCapabilities: "I'll set up:",
    websiteCapability: "Your website",
    crmCapability: "Client list",
    bookingCapability: "Booking calendar",
    paymentCapability: "Payment collection",
    emailCapability: "Automated emails",
    aiEmployees: "Your AI Assistants:",
    buildPrompt: "Sound good? Just say 'yes' to get started!",
    send: "Send",
    checking: "Loading...",
    // Discovery questions - ADAPTIVE CONVERSATIONAL APPROACH
    // These are dynamic and build on previous answers
    askCompanyName: "What's the name of your business or practice?",
    askWebsite: "Do clients find you online, or do you get most of your business through referrals?",
    askBooking: "How do people book time with you right now?",
    askBookingManual: "I see. So you're handling everything manually - calls, texts, emails?",
    askTools: "What are you using today to stay organized? Calendar, CRM, anything else?",
    askPainPoint: "What's eating up most of your time or causing the biggest headaches?",
    askNoShows: "Are no-shows or cancellations a problem for you?",
    askLeadResponse: "When someone reaches out for the first time, how quickly can you usually respond?",
    askTimeSpent: "How many hours a week would you say you spend on admin work (scheduling, paperwork, follow-ups)?",
    askGoal: "What would success look like 3 months from now? More clients? More free time? Something else?",
    askGrowthTarget: "Nice! How many clients per week are you aiming for?",
    askTimeSavings: "Great! Roughly how many hours per week do you want to free up?",
  },
  es: {
    welcome: "¡Bienvenido!",
    welcomeMsg: "Estoy aquí para ayudarte a manejar tu negocio. Cuéntame qué haces y lo configuraré todo por ti.",
    headerTitle: "Comencemos",
    headerSubtitle: "Te ayudaré a configurar todo lo que necesitas",
    uploadPrompt: "Puedes escribir la información de tu negocio abajo, o subir un archivo con tus detalles.",
    typeHere: "Cuéntame sobre tu negocio...",
    uploadFile: "Subir Bio",
    processing: "Leyendo tu información...",
    building: "Configurando todo...",
    buildingWebsite: "Creando tu sitio web...",
    buildingCRM: "Configurando tu lista de clientes...",
    buildingAutomation: "Activando tus asistentes...",
    success: "¡Todo listo!",
    successMsg: "Todo está preparado. Llevándote a tu panel...",
    previewTitle: "Esto es lo que aprendí sobre tu negocio:",
    previewCapabilities: "Voy a configurar:",
    websiteCapability: "Tu sitio web",
    crmCapability: "Lista de clientes",
    bookingCapability: "Calendario de reservas",
    paymentCapability: "Cobro de pagos",
    emailCapability: "Emails automáticos",
    aiEmployees: "Tus Asistentes AI:",
    buildPrompt: "¿Suena bien? Solo di 'sí' para empezar!",
    send: "Enviar",
    checking: "Cargando...",
    // Discovery questions - ADAPTIVE CONVERSATIONAL APPROACH
    askCompanyName: "¿Cuál es el nombre de tu negocio o práctica?",
    askWebsite: "¿Los clientes te encuentran online, o la mayoría llega por recomendación?",
    askBooking: "¿Cómo agenda la gente tiempo contigo ahora?",
    askBookingManual: "Ya veo. ¿Entonces manejas todo manualmente - llamadas, mensajes, emails?",
    askTools: "¿Qué estás usando hoy para mantenerte organizado? ¿Calendario, lista de clientes, algo más?",
    askPainPoint: "¿Qué te está quitando más tiempo o causando los mayores dolores de cabeza?",
    askNoShows: "¿Las ausencias o cancelaciones son un problema para ti?",
    askLeadResponse: "Cuando alguien te contacta por primera vez, ¿qué tan rápido puedes responder normalmente?",
    askTimeSpent: "¿Cuántas horas a la semana dirías que pasas en trabajo administrativo (programación, papeleo, seguimientos)?",
    askGoal: "¿Cómo se vería el éxito en 3 meses? ¿Más clientes? ¿Más tiempo libre? ¿Otra cosa?",
    askGrowthTarget: "¡Perfecto! ¿A cuántos clientes por semana apuntas?",
    askTimeSavings: "¡Genial! Aproximadamente, ¿cuántas horas por semana quieres liberar?",
  },
  he: {
    welcome: "ברוכים הבאים!",
    welcomeMsg: "אני כאן לעזור לך לנהל את העסק. ספר לי מה אתה עושה, ואני אגדיר הכל בשבילך.",
    headerTitle: "בואו נתחיל",
    headerSubtitle: "אני אעזור לך להגדיר את כל מה שאתה צריך",
    uploadPrompt: "אתה יכול להקליד את פרטי העסק למטה, או להעלות קובץ עם הפרטים שלך.",
    typeHere: "ספר לי על העסק שלך...",
    uploadFile: "העלה ביוגרפיה",
    processing: "קורא את המידע שלך...",
    building: "מגדיר הכל...",
    buildingWebsite: "בונה את האתר שלך...",
    buildingCRM: "מגדיר את רשימת הלקוחות שלך...",
    buildingAutomation: "מפעיל את העוזרים שלך...",
    success: "!הכל מוכן",
    successMsg: "הכל מוכן. לוקח אותך ללוח הבקרה...",
    previewTitle: "הנה מה שלמדתי על העסק שלך:",
    previewCapabilities: ":אני אגדיר",
    websiteCapability: "האתר שלך",
    crmCapability: "רשימת לקוחות",
    bookingCapability: "יומן פגישות",
    paymentCapability: "גביית תשלומים",
    emailCapability: "אימיילים אוטומטיים",
    aiEmployees: ":העוזרים שלך",
    buildPrompt: "נשמע טוב? פשוט אמר 'כן' כדי להתחיל!",
    send: "שלח",
    checking: "...טוען",
    // Discovery questions - ADAPTIVE CONVERSATIONAL APPROACH
    askCompanyName: "מה שם העסק או המרפאה שלך?",
    askWebsite: "לקוחות מוצאים אותך באינטרנט, או רוב העסקים מגיע מהמלצות?",
    askBooking: "איך אנשים מזמינים אצלך פגישה היום?",
    askBookingManual: "אני רואה. אז אתה מטפל בהכל ידנית - שיחות, הודעות, אימיילים?",
    askTools: "מה אתה משתמש היום כדי להישאר מאורגן? יומן, רשימת לקוחות, משהו אחר?",
    askPainPoint: "מה גוזל לך הכי הרבה זמן או גורם לכאבי ראש הכי גדולים?",
    askNoShows: "האם אי-הגעות או ביטולים הם בעיה עבורך?",
    askLeadResponse: "כשמישהו פונה אליך בפעם הראשונה, כמה מהר אתה יכול להגיב בדרך כלל?",
    askTimeSpent: "כמה שעות בשבוע היית אומר שאתה מבלה בעבודה אדמיניסטרטיבית (תזמון, ניירת, מעקבים)?",
    askGoal: "איך נראה הצלחה בעוד 3 חודשים? עוד לקוחות? יותר זמן פנוי? משהו אחר?",
    askGrowthTarget: "מעולה! לכמה לקוחות בשבוע אתה שואף?",
    askTimeSavings: "נהדר! בערך כמה שעות בשבוע אתה רוצה לפנות?",
  }
};

// Discovery state to track what we've learned
interface DiscoveryState {
  companyName?: string;
  hasWebsite?: boolean;
  websiteUrl?: string;
  hasOnlineBooking?: boolean;
  bookingMethod?: string; // 'manual' | 'calendly' | 'google_calendar' | etc
  tools?: string[];
  painPoints?: string[];
  goals?: string[];
  timeSpentAdmin?: number;
  targetClients?: number;
  // Flags for what we've asked
  askedCompanyName?: boolean;
  askedWebsite?: boolean;
  askedBooking?: boolean;
  askedTools?: boolean;
  askedPainPoint?: boolean;
  askedGoal?: boolean;
}

// Capability interface for preview
interface Capability {
  id: string;
  name: string;
  description: string;
  impact: string;
  icon: 'Globe' | 'Users' | 'Calendar' | 'CreditCard' | 'Mail' | 'Bot' | 'Megaphone';
  category: 'system' | 'ai_assistant';
  color: string; // Unique color for each capability
}

// Adaptive question generator - returns next question based on what we know
function getNextDiscoveryQuestion(
  state: DiscoveryState,
  locale: Locale,
  profile?: BusinessProfile | null
): { content: string; quickOptions?: QuickOption[]; multiSelect?: boolean; requiresInput?: boolean } | null {
  const t = translations[locale as Locale];

  // 0. Ask for company name FIRST if missing from bio
  if (!state.askedCompanyName && !profile?.company_name) {
    return {
      content: t.askCompanyName,
      requiresInput: true // This is a text input question, not quick options
    };
  }

  // 1. Ask about online presence first
  if (!state.askedWebsite) {
    return {
      content: t.askWebsite,
      quickOptions: [
        { label: locale === 'en' ? 'Mostly online' : locale === 'es' ? 'Mayormente online' : 'בעיקר אונליין', value: 'online', iconName: 'Globe' },
        { label: locale === 'en' ? 'Mostly referrals' : locale === 'es' ? 'Mayormente referencias' : 'בעיקר המלצות', value: 'referrals', iconName: 'Users' },
        { label: locale === 'en' ? 'Mix of both' : locale === 'es' ? 'Mezcla de ambos' : 'שילוב של שניהם', value: 'both', iconName: 'ArrowLeftRight' },
      ]
    };
  }

  // 2. If they have a website, ask about booking
  if (state.hasWebsite && !state.askedBooking) {
    return {
      content: t.askBooking,
      quickOptions: [
        { label: locale === 'en' ? 'Online (Calendly, website form)' : locale === 'es' ? 'Online (Calendly, formulario web)' : 'אונליין (Calendly, טופס באתר)', value: 'online', iconName: 'Globe' },
        { label: locale === 'en' ? 'Phone/Email (manual)' : locale === 'es' ? 'Teléfono/Email (manual)' : 'טלפון/אימייל (ידני)', value: 'manual', iconName: 'Phone' },
        { label: locale === 'en' ? 'No booking system yet' : locale === 'es' ? 'Sin sistema de reservas aún' : 'אין מערכת פגישות עדיין', value: 'none', iconName: 'X' },
      ]
    };
  }

  // 3. Ask about tools they're using
  if (!state.askedTools) {
    return {
      content: t.askTools,
      quickOptions: [
        { label: 'Google Calendar', value: 'google_calendar', iconName: 'Calendar' },
        { label: 'Calendly', value: 'calendly', iconName: 'Calendar' },
        { label: 'Stripe', value: 'stripe', iconName: 'CreditCard' },
        { label: locale === 'en' ? 'Contact manager' : locale === 'es' ? 'Gestor de contactos' : 'מנהל אנשי קשר', value: 'crm', iconName: 'Users' },
        { label: locale === 'en' ? 'Nothing yet' : locale === 'es' ? 'Nada aún' : 'כלום עדיין', value: 'none', iconName: 'X' },
      ],
      multiSelect: true
    };
  }

  // 4. Ask about pain points
  if (!state.askedPainPoint) {
    return {
      content: t.askPainPoint,
      quickOptions: [
        { label: locale === 'en' ? 'Scheduling chaos' : locale === 'es' ? 'Caos de programación' : 'בלאגן בתזמון', value: 'scheduling', iconName: 'Calendar' },
        { label: locale === 'en' ? 'No-shows & cancellations' : locale === 'es' ? 'Ausencias y cancelaciones' : 'אי-הגעות וביטולים', value: 'noshows', iconName: 'X' },
        { label: locale === 'en' ? 'Slow to respond to leads' : locale === 'es' ? 'Respuesta lenta a consultas' : 'מגיב לאט לפניות', value: 'slow_leads', iconName: 'Phone' },
        { label: locale === 'en' ? 'Payment tracking' : locale === 'es' ? 'Seguimiento de pagos' : 'מעקב תשלומים', value: 'payments', iconName: 'CreditCard' },
        { label: locale === 'en' ? 'Too much paperwork' : locale === 'es' ? 'Mucho papeleo' : 'יותר מדי ניירת', value: 'paperwork', iconName: 'Mail' },
      ],
      multiSelect: true
    };
  }

  // 5. Ask about main goal
  if (!state.askedGoal) {
    return {
      content: t.askGoal,
      quickOptions: [
        { label: locale === 'en' ? 'Get more clients' : locale === 'es' ? 'Conseguir más clientes' : 'לקבל עוד לקוחות', value: 'more_clients', iconName: 'Users' },
        { label: locale === 'en' ? 'Save time on admin' : locale === 'es' ? 'Ahorrar tiempo en admin' : 'לחסוך זמן בניהול', value: 'save_time', iconName: 'Check' },
        { label: locale === 'en' ? 'Increase revenue' : locale === 'es' ? 'Aumentar ingresos' : 'להגדיל הכנסות', value: 'more_revenue', iconName: 'CreditCard' },
        { label: locale === 'en' ? 'Go fully online' : locale === 'es' ? 'Ir completamente online' : 'לעבור לחלוטין לאונליין', value: 'go_online', iconName: 'Globe' },
      ],
      multiSelect: true
    };
  }

  // All questions answered - ready for preview
  return null;
}

export default function OnboardingV2Page() {
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { mode, toggleMode } = useV2Theme();

  const { language: locale, setLanguage: setLocale } = useLanguage();
  const t = translations[locale as Locale];

  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [discoveryState, setDiscoveryState] = useState<DiscoveryState>({}); // Track what we've learned
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]); // For multi-select
  const [buildingProgress, setBuildingProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);
  const languageDropdownRef = useRef<HTMLDivElement>(null);

  // For preview customization
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([]);
  const [previewCapabilities, setPreviewCapabilities] = useState<Capability[]>([]);
  const [totalPilotCredits, setTotalPilotCredits] = useState(0);

  // Initialize welcome messages
  useEffect(() => {
    setMessages([
      { role: 'assistant', content: t.welcome },
      { role: 'assistant', content: t.welcomeMsg }
    ]);
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Update messages when locale changes
  useEffect(() => {
    if (step === 'welcome' && messages.length === 2) {
      setMessages([
        { role: 'assistant', content: t.welcome },
        { role: 'assistant', content: t.welcomeMsg }
      ]);
    }
  }, [locale]);

  // Close language dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (languageDropdownRef.current && !languageDropdownRef.current.contains(event.target as Node)) {
        setIsLanguageOpen(false);
      }
    }

    if (isLanguageOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isLanguageOpen]);

  // Handle auth tokens from URL hash (OAuth callback)
  useEffect(() => {
    async function handleAuthCallback() {
      try {
        // Check if we have tokens in URL hash
        if (window.location.hash) {
          const hashParams = new URLSearchParams(window.location.hash.substring(1));
          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');

          if (accessToken && refreshToken) {
            console.log('Processing auth tokens from URL hash...');

            // Set the session with the tokens
            const { data, error } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken
            });

            if (error) {
              console.error('Failed to set session:', error);
              setError('Authentication failed. Please try logging in again.');
              setIsCheckingAuth(false);
              return;
            }

            console.log('Session established:', !!data.session);

            // Clean up URL hash
            window.history.replaceState(null, '', window.location.pathname);
          }
        }

        // Check if user already completed onboarding
        const { data: { session } } = await supabase.auth.getSession();

        if (session?.user) {
          const { data: businessProfile } = await supabase
            .from('business_profiles')
            .select('onboarding_completed')
            .eq('user_id', session.user.id)
            .single();

          if (businessProfile?.onboarding_completed) {
            console.log('User already completed onboarding, redirecting to Business OS...');
            router.push('/business-os');
            return;
          }
        }

        setIsCheckingAuth(false);
      } catch (err) {
        console.error('Auth check error:', err);
        setIsCheckingAuth(false);
      }
    }

    handleAuthCallback();
  }, [router]);

  const addMessage = (message: Message) => {
    setMessages(prev => [...prev, message]);
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    addMessage({ role: 'user', content: `📎 ${file.name}` });
    addMessage({ role: 'typing', content: t.processing });
    setIsSending(true);

    try {
      const text = await file.text();
      await processBio(text);
    } catch (err) {
      console.error('File processing error:', err);
      setError((err as Error).message);
      setMessages(prev => prev.filter(m => m.role !== 'typing'));
      addMessage({ role: 'assistant', content: `Error: ${(err as Error).message}` });
    } finally {
      setIsSending(false);
    }
  };

  const handleSendBio = async () => {
    if (!inputValue.trim() || isSending) return;

    const bioText = inputValue;
    setInputValue('');
    addMessage({ role: 'user', content: bioText });
    addMessage({ role: 'typing', content: t.processing });
    setIsSending(true);

    try {
      await processBio(bioText);
    } catch (err) {
      console.error('Bio processing error:', err);
      setError((err as Error).message);
      setMessages(prev => prev.filter(m => m.role !== 'typing'));
      addMessage({ role: 'assistant', content: `Error: ${(err as Error).message}` });
    } finally {
      setIsSending(false);
    }
  };

  const processBio = async (bioText: string) => {
    try {
      const response = await fetch('/api/onboarding/process-bio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bio: bioText, locale })
      });

      if (!response.ok) throw new Error('Failed to process bio');

      const result = await response.json();
      setProfile(result.profile);

      // Track pilot credits consumed
      if (result.usage?.pilotCredits) {
        setTotalPilotCredits(prev => prev + result.usage.pilotCredits);
      }

      // Remove typing indicator
      setMessages(prev => prev.filter(m => m.role !== 'typing'));

      // Start adaptive discovery conversation
      setStep('discovery');
      setDiscoveryState({}); // Reset discovery state
      setSelectedOptions([]); // Reset selections

      // Ask first adaptive question
      const nextQuestion = getNextDiscoveryQuestion({}, locale, result.profile);
      if (nextQuestion) {
        addMessage({
          role: 'assistant',
          content: nextQuestion.content,
          variant: 'question',
          quickOptions: nextQuestion.quickOptions,
          multiSelect: nextQuestion.multiSelect
        });
      }
    } catch (err) {
      throw err;
    }
  };

  const handleBuildEverything = async () => {
    if (!profile) return;

    addMessage({ role: 'typing', content: t.building });
    setIsSending(true);
    setStep('building');

    try {
      // Get selected capabilities to show dynamic build messages
      const selectedCaps = previewCapabilities.filter(cap =>
        selectedCapabilities.includes(cap.id)
      );

      // Simulate building progress
      setBuildingProgress(10);
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Remove typing
      setMessages(prev => prev.filter(m => m.role !== 'typing'));

      // Show dynamic build messages based on selected capabilities
      const progressPerCapability = 80 / Math.max(selectedCaps.length, 1);
      let currentProgress = 10;

      for (const cap of selectedCaps) {
        const buildMessage = locale === 'en'
          ? `Setting up ${cap.name.toLowerCase()}...`
          : locale === 'es'
          ? `Configurando ${cap.name.toLowerCase()}...`
          : `מגדיר ${cap.name}...`;

        addMessage({ role: 'system', content: buildMessage });
        currentProgress += progressPerCapability;
        setBuildingProgress(Math.min(currentProgress, 90));
        await new Promise(resolve => setTimeout(resolve, 800));
      }

      // Merge profile with discovery state and selected capabilities
      const enrichedProfile = {
        ...profile,
        // Add discovery answers to profile
        has_website: discoveryState.hasWebsite,
        has_online_booking: discoveryState.hasOnlineBooking,
        booking_method: discoveryState.bookingMethod,
        tools: discoveryState.tools || profile.tools,
        pain_points: discoveryState.painPoints,
        goals: discoveryState.goals,
      };

      // Call build API with enriched profile and selected capabilities
      const response = await fetch('/api/onboarding/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: enrichedProfile,
          capabilities: selectedCaps,
          locale
        })
      });

      if (!response.ok) throw new Error('Failed to build infrastructure');

      setBuildingProgress(100);
      addMessage({ role: 'system', content: t.success });
      setStep('success');

      // Redirect to Business OS dashboard after 2 seconds
      setTimeout(() => {
        router.push('/business-os');
      }, 2000);

    } catch (err) {
      console.error('Build error:', err);
      setError((err as Error).message);
      setMessages(prev => prev.filter(m => m.role !== 'typing'));
      addMessage({ role: 'assistant', content: `Error: ${(err as Error).message}` });
      setStep('preview');
    } finally {
      setIsSending(false);
    }
  };

  const handleSend = () => {
    if (step === 'preview' && (inputValue.toLowerCase().includes('yes') || inputValue.toLowerCase().includes('build') || inputValue.toLowerCase().includes('sí') || inputValue.toLowerCase().includes('כן'))) {
      addMessage({ role: 'user', content: inputValue });
      setInputValue('');
      handleBuildEverything();
    } else if (step === 'discovery') {
      // Handle discovery conversation
      handleDiscoveryAnswer();
    } else if (step === 'welcome') {
      handleSendBio();
    }
  };

  // Handle quick-select button click
  const handleQuickSelect = (value: string, multiSelect?: boolean) => {
    if (multiSelect) {
      // Toggle selection for multi-select
      setSelectedOptions(prev =>
        prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
      );
    } else {
      // Single select - immediately process
      processDiscoveryAnswer([value]);
    }
  };

  // Handle submitting multi-select answers
  const handleDiscoveryAnswer = () => {
    if (selectedOptions.length === 0 && !inputValue.trim()) return;

    const answers = selectedOptions.length > 0 ? selectedOptions : [inputValue];
    processDiscoveryAnswer(answers);
  };

  const processDiscoveryAnswer = (answers: string[]) => {
    if (!profile) return;

    // Get the last message to find the quick options
    const lastMessage = messages[messages.length - 1];

    // Map values to labels for display
    const answerText = answers.map(value => {
      if (lastMessage?.quickOptions) {
        const option = lastMessage.quickOptions.find(opt => opt.value === value);
        return option ? option.label : value;
      }
      return value;
    }).join(', ');

    addMessage({ role: 'user', content: answerText });

    // Update discovery state based on the current question
    const newState = { ...discoveryState };

    // Determine which question was just answered based on what we've asked
    if (!newState.askedCompanyName && !profile.company_name) {
      newState.askedCompanyName = true;
      newState.companyName = answers[0];
      // Also update profile with company name
      setProfile({ ...profile, company_name: answers[0] });
    } else if (!newState.askedWebsite) {
      newState.askedWebsite = true;
      newState.hasWebsite = answers[0] === 'online' || answers[0] === 'both';
    } else if (!newState.askedBooking) {
      newState.askedBooking = true;
      newState.bookingMethod = answers[0];
      newState.hasOnlineBooking = answers[0] === 'online';
    } else if (!newState.askedTools) {
      newState.askedTools = true;
      newState.tools = answers;
    } else if (!newState.askedPainPoint) {
      newState.askedPainPoint = true;
      newState.painPoints = answers;
    } else if (!newState.askedGoal) {
      newState.askedGoal = true;
      newState.goals = answers;
    }

    setDiscoveryState(newState);
    setSelectedOptions([]);
    setInputValue('');

    // Get next question
    const nextQuestion = getNextDiscoveryQuestion(newState, locale, profile);

    if (nextQuestion) {
      // Ask next question
      setTimeout(() => {
        addMessage({
          role: 'assistant',
          content: nextQuestion.content,
          variant: 'question',
          quickOptions: nextQuestion.quickOptions,
          multiSelect: nextQuestion.multiSelect
        });
      }, 500);
    } else {
      // Discovery complete - build preview
      setTimeout(() => {
        buildPreviewFromDiscovery(newState);
      }, 500);
    }
  };

  const buildPreviewFromDiscovery = (state: DiscoveryState) => {
    if (!profile) return;

    // Extract insights from discovery state
    const hasWebsite = state.hasWebsite || false;
    const hasOnlineBooking = state.hasOnlineBooking || false;
    const usesGoogleCalendar = state.tools?.includes('google_calendar') || false;
    const usesStripe = state.tools?.includes('stripe') || false;
    const usesCalendly = state.tools?.includes('calendly') || false;
    const usesCRM = state.tools?.includes('crm') || false;

    // Parse pain points
    const painScheduling = state.painPoints?.includes('scheduling') || false;
    const painNoShows = state.painPoints?.includes('noshows') || false;
    const painLeads = state.painPoints?.includes('slow_leads') || false;
    const painPayments = state.painPoints?.includes('payments') || false;
    const painPaperwork = state.painPoints?.includes('paperwork') || false;

    // Parse goals
    const goalMoreClients = state.goals?.includes('more_clients') || false;
    const goalSaveTime = state.goals?.includes('save_time') || false;
    const goalRevenue = state.goals?.includes('more_revenue') || false;
    const goalOnline = state.goals?.includes('go_online') || false;

    // BUILD STRUCTURED CAPABILITIES
    const capabilities: Capability[] = [];

    // Website (if they don't have one OR want to go fully online)
    if (!hasWebsite || goalOnline) {
      capabilities.push({
        id: 'website',
        name: locale === 'en' ? 'Online Presence' : locale === 'es' ? 'Presencia en Línea' : 'נוכחות אונליין',
        description: locale === 'en'
          ? 'A professional page where clients can learn about you and book time'
          : locale === 'es'
          ? 'Una página profesional donde los clientes pueden conocerte y reservar tiempo'
          : 'דף מקצועי שבו לקוחות יכולים ללמוד עליך ולהזמין זמן',
        impact: !hasWebsite
          ? locale === 'en' ? 'Clients can find you online 24/7' : locale === 'es' ? 'Los clientes te pueden encontrar en línea 24/7' : 'לקוחות יכולים למצוא אותך אונליין 24/7'
          : locale === 'en' ? '30-50% more inquiries' : locale === 'es' ? '30-50% más consultas' : '30-50% יותר פניות',
        icon: 'Globe',
        category: 'system',
        color: '#3B82F6' // Blue
      });
    }

    // CRM (always - everyone needs client tracking)
    capabilities.push({
      id: 'crm',
      name: locale === 'en' ? 'Client Database' : locale === 'es' ? 'Base de Datos de Clientes' : 'מאגר לקוחות',
      description: locale === 'en'
        ? 'Your complete client contact list with notes and history'
        : locale === 'es'
        ? 'Tu lista completa de contactos de clientes con notas e historial'
        : 'רשימת אנשי הקשר המלאה שלך עם הערות והיסטוריה',
      impact: locale === 'en' ? 'All client info in one place' : locale === 'es' ? 'Toda la información del cliente en un solo lugar' : 'כל מידע הלקוח במקום אחד',
      icon: 'Users',
      category: 'system',
      color: '#8B5CF6' // Purple
    });

    // Booking (if scheduling is a pain OR they use Calendly/GCal)
    if (painScheduling || usesGoogleCalendar || usesCalendly || !hasWebsite) {
      capabilities.push({
        id: 'booking',
        name: locale === 'en' ? 'Online Booking' : locale === 'es' ? 'Reservas en Línea' : 'קביעת פגישות',
        description: locale === 'en'
          ? 'Clients pick their own time from your calendar'
          : locale === 'es'
          ? 'Los clientes eligen su propio horario de tu calendario'
          : 'לקוחות בוחרים את הזמן שלהם מהיומן שלך',
        impact: painScheduling
          ? locale === 'en' ? 'No more scheduling back-and-forth' : locale === 'es' ? 'No más ida y vuelta de programación' : 'לא עוד הלוך ושוב בתיאומים'
          : locale === 'en' ? 'Clients book instantly' : locale === 'es' ? 'Los clientes reservan al instante' : 'לקוחות מזמינים מיידית',
        icon: 'Calendar',
        category: 'system',
        color: '#10B981' // Green
      });
    }

    // Payments (always - everyone needs payment tracking)
    capabilities.push({
      id: 'payments',
      name: locale === 'en' ? 'Get Paid' : locale === 'es' ? 'Recibe Pagos' : 'קבל תשלומים',
      description: usesStripe
        ? locale === 'en'
          ? 'Connect your Stripe and automate invoicing and tracking'
          : locale === 'es'
          ? 'Conecta tu Stripe y automatiza facturación y seguimiento'
          : 'חבר את Stripe שלך ואוטומט חשבוניות ומעקב'
        : locale === 'en'
          ? 'Accept credit cards and send invoices automatically'
          : locale === 'es'
          ? 'Acepta tarjetas de crédito y envía facturas automáticamente'
          : 'קבל כרטיסי אשראי ושלח חשבוניות אוטומטית',
      impact: painPayments
        ? locale === 'en' ? 'Stop chasing late payments' : locale === 'es' ? 'Deja de perseguir pagos atrasados' : 'תפסיק לרדוף אחרי תשלומים באיחור'
        : usesStripe
        ? locale === 'en' ? 'Automate what you do manually' : locale === 'es' ? 'Automatiza lo que haces manualmente' : 'אוטומט מה שאתה עושה ידנית'
        : locale === 'en' ? 'Get paid faster' : locale === 'es' ? 'Recibe pagos más rápido' : 'קבל תשלומים מהר יותר',
      icon: 'CreditCard',
      category: 'system',
      color: '#F59E0B' // Amber
    });

    // Email automation (if no-shows OR slow leads OR want to save time)
    if (painNoShows || painLeads || goalSaveTime) {
      capabilities.push({
        id: 'email',
        name: locale === 'en' ? 'Auto Emails' : locale === 'es' ? 'Emails Automáticos' : 'מיילים אוטומטיים',
        description: locale === 'en'
          ? 'Automatic reminders and confirmations to clients'
          : locale === 'es'
          ? 'Recordatorios y confirmaciones automáticas a clientes'
          : 'תזכורות ואישורים אוטומטיים ללקוחות',
        impact: painNoShows
          ? locale === 'en' ? '70% fewer missed appointments' : locale === 'es' ? '70% menos citas perdidas' : '70% פחות פגישות שהוחמצו'
          : painLeads
          ? locale === 'en' ? 'Reply to inquiries instantly' : locale === 'es' ? 'Responde a consultas al instante' : 'הגב לפניות מיידית'
          : locale === 'en' ? 'Emails send themselves' : locale === 'es' ? 'Los emails se envían solos' : 'המיילים נשלחים בעצמם',
        icon: 'Mail',
        category: 'system',
        color: '#EC4899' // Pink
      });
    }

    // Campaigns (if they want more clients OR more revenue)
    if (goalMoreClients || goalRevenue) {
      capabilities.push({
        id: 'campaigns',
        name: locale === 'en' ? 'Run Ads' : locale === 'es' ? 'Publicar Anuncios' : 'הפעל מודעות',
        description: locale === 'en'
          ? 'Get new clients from Google and Facebook ads'
          : locale === 'es'
          ? 'Consigue nuevos clientes de anuncios de Google y Facebook'
          : 'קבל לקוחות חדשים ממודעות גוגל ופייסבוק',
        impact: goalMoreClients
          ? locale === 'en' ? '3-5x more inquiries' : locale === 'es' ? '3-5x más consultas' : '3-5x יותר פניות'
          : locale === 'en' ? 'Track what works' : locale === 'es' ? 'Rastrea qué funciona' : 'עקוב אחרי מה שעובד',
        icon: 'Megaphone',
        category: 'system',
        color: '#F97316' // Orange
      });
    }

    // AI Assistants (based on pain points)
    if (painLeads || goalMoreClients) {
      capabilities.push({
        id: 'ai_intake',
        name: locale === 'en' ? 'Reply to Inquiries' : locale === 'es' ? 'Responder Consultas' : 'הגב לפניות',
        description: locale === 'en'
          ? 'AI replies to people who contact you within minutes'
          : locale === 'es'
          ? 'IA responde a las personas que te contactan en minutos'
          : 'AI עונה לאנשים שפונים אליך תוך דקות',
        impact: locale === 'en' ? 'Never lose a potential client' : locale === 'es' ? 'Nunca pierdas un cliente potencial' : 'לעולם לא תאבד לקוח פוטנציאלי',
        icon: 'Bot',
        category: 'ai_assistant',
        color: '#06B6D4' // Cyan
      });
    }

    if (painNoShows) {
      capabilities.push({
        id: 'ai_reminders',
        name: locale === 'en' ? 'Send Reminders' : locale === 'es' ? 'Enviar Recordatorios' : 'שלח תזכורות',
        description: locale === 'en'
          ? 'AI reminds clients and helps them reschedule if needed'
          : locale === 'es'
          ? 'IA recuerda a clientes y les ayuda a reprogramar si es necesario'
          : 'AI מזכיר ללקוחות ועוזר להם לשנות מועד במידת הצורך',
        impact: locale === 'en' ? '70% fewer missed appointments' : locale === 'es' ? '70% menos citas perdidas' : '70% פחות פגישות שהוחמצו',
        icon: 'Bot',
        category: 'ai_assistant',
        color: '#14B8A6' // Teal
      });
    }

    if (painPayments) {
      capabilities.push({
        id: 'ai_invoice',
        name: locale === 'en' ? 'Chase Payments' : locale === 'es' ? 'Perseguir Pagos' : 'רדוף אחרי תשלומים',
        description: locale === 'en'
          ? 'AI politely reminds clients about late payments'
          : locale === 'es'
          ? 'IA recuerda educadamente a clientes sobre pagos atrasados'
          : 'AI מזכיר באדיבות ללקוחות על תשלומים באיחור',
        impact: locale === 'en' ? 'Get paid on time' : locale === 'es' ? 'Recibe pagos a tiempo' : 'קבל תשלומים בזמן',
        icon: 'Bot',
        category: 'ai_assistant',
        color: '#A855F7' // Purple (different shade)
      });
    }

    // Select all capabilities by default
    const allCapabilityIds = capabilities.map(c => c.id);
    setSelectedCapabilities(allCapabilityIds);
    setPreviewCapabilities(capabilities);

    setTimeout(() => {
      // Show introduction message
      const intro = locale === 'en'
        ? "Perfect! Based on what you've told me, here's what I'll set up for you:"
        : locale === 'es'
        ? "¡Perfecto! Basándome en lo que me has dicho, esto es lo que configuraré para ti:"
        : "מושלם! בהתבסס על מה שסיפרת לי, הנה מה שאגדיר עבורך:";
      addMessage({
        role: 'assistant',
        content: intro,
        variant: 'info'
      });
      setStep('preview');
    }, 1000);
  };

  // Show loading while checking auth
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-[var(--v2-bg)] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-[var(--v2-primary)]" />
          <p className="text-lg text-[var(--v2-text-secondary)]">{t.checking}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--v2-bg)]" dir={locale === 'he' ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="border-b border-[var(--v2-border)] bg-[var(--v2-surface)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <V2Logo />

          {/* Pilot Credits + Dark Mode Toggle + Language Selector */}
          <div className="flex items-center gap-3">
            {/* Pilot Credits Display */}
            {totalPilotCredits > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                <Zap className="w-4 h-4 text-[var(--v2-primary)]" />
                <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                  {totalPilotCredits} {locale === 'en' ? 'credits used' : locale === 'es' ? 'créditos usados' : 'קרדיטים בשימוש'}
                </span>
              </div>
            )}

            {/* Dark Mode Toggle */}
            <button
              onClick={toggleMode}
              className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              aria-label="Toggle dark mode"
            >
              {mode === 'dark' ? (
                <Sun className="w-4 h-4 text-[var(--v2-text-secondary)]" />
              ) : (
                <Moon className="w-4 h-4 text-[var(--v2-text-secondary)]" />
              )}
            </button>

            {/* Modern Language Selector */}
            <div className="relative" ref={languageDropdownRef}>
            <button
              onClick={() => setIsLanguageOpen(!isLanguageOpen)}
              className="flex items-center gap-2 px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <Globe className="w-4 h-4 text-[var(--v2-text-muted)]" />
              <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                {locale === 'en' && '🇺🇸 English'}
                {locale === 'es' && '🇪🇸 Español'}
                {locale === 'he' && '🇮🇱 עברית'}
              </span>
            </button>

            {isLanguageOpen && (
              <div
                className="absolute right-0 mt-2 w-48 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg z-50"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <button
                  onClick={() => { setLocale('en'); setIsLanguageOpen(false); }}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--v2-surface-hover)] transition-colors text-left"
                >
                  <span className="text-sm text-[var(--v2-text-primary)]">🇺🇸 English</span>
                  {locale === 'en' && <Check className="w-4 h-4 text-[var(--v2-primary)]" />}
                </button>
                <button
                  onClick={() => { setLocale('es'); setIsLanguageOpen(false); }}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--v2-surface-hover)] transition-colors text-left"
                >
                  <span className="text-sm text-[var(--v2-text-primary)]">🇪🇸 Español</span>
                  {locale === 'es' && <Check className="w-4 h-4 text-[var(--v2-primary)]" />}
                </button>
                <button
                  onClick={() => { setLocale('he'); setIsLanguageOpen(false); }}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--v2-surface-hover)] transition-colors text-left"
                >
                  <span className="text-sm text-[var(--v2-text-primary)]">🇮🇱 עברית</span>
                  {locale === 'he' && <Check className="w-4 h-4 text-[var(--v2-primary)]" />}
                </button>
              </div>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Chat Container */}
        <div
          className="bg-[var(--v2-surface)] border border-[var(--v2-border)]"
          style={{
            borderRadius: 'var(--v2-radius-card)',
            boxShadow: 'var(--v2-shadow-card)',
            height: 'calc(100vh - 180px)',
            minHeight: '600px',
            maxHeight: '900px'
          }}
        >
          <div className="flex flex-col h-full">
            {/* Chat Header */}
            <div className="px-6 py-5 border-b border-[var(--v2-border)]">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 bg-[var(--v2-primary)] flex items-center justify-center"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-[var(--v2-text-primary)]">{t.headerTitle}</h1>
                  <p className="text-sm text-[var(--v2-text-secondary)]">{t.headerSubtitle}</p>
                </div>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
              {messages.map((message, index) => (
                <div key={index}>
                  {/* System messages (centered) */}
                  {message.role === 'system' ? (
                    <div className="flex justify-center my-3">
                      <div
                        className="bg-[var(--v2-primary)]/10 text-[var(--v2-primary)] text-xs px-3 py-2 font-medium"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        {message.content}
                      </div>
                    </div>
                  ) : message.role === 'typing' ? (
                    /* Typing indicator */
                    <div className="flex gap-3 justify-start">
                      <div
                        className="w-8 h-8 bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center flex-shrink-0"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <Bot className="h-4 w-4 text-[var(--v2-text-secondary)]" />
                      </div>
                      <div
                        className="bg-[var(--v2-surface)] border border-[var(--v2-border)] px-4 py-3"
                        style={{ borderRadius: 'var(--v2-radius-button)', boxShadow: 'var(--v2-shadow-sm)' }}
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex space-x-1">
                            <div
                              className="w-2 h-2 rounded-full animate-bounce bg-[var(--v2-primary)]"
                              style={{ animationDelay: '0ms' }}
                            />
                            <div
                              className="w-2 h-2 rounded-full animate-bounce bg-[var(--v2-primary)]"
                              style={{ animationDelay: '150ms' }}
                            />
                            <div
                              className="w-2 h-2 rounded-full animate-bounce bg-[var(--v2-primary)]"
                              style={{ animationDelay: '300ms' }}
                            />
                          </div>
                          <span className="text-sm text-[var(--v2-text-secondary)]">{message.content}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* User and AI messages */
                    <div className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      {/* AI Avatar */}
                      {message.role === 'assistant' && (
                        <div
                          className="w-8 h-8 bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center flex-shrink-0"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          <Bot className="h-4 w-4 text-[var(--v2-text-secondary)]" />
                        </div>
                      )}

                      {/* Message bubble */}
                      <div className="max-w-[80%]">
                        <div
                          className={`px-4 py-3 ${
                            message.role === 'user'
                              ? 'text-white'
                              : 'bg-[var(--v2-surface)] border border-[var(--v2-border)]'
                          }`}
                          style={
                            message.role === 'user'
                              ? {
                                  background: 'var(--v2-primary)',
                                  borderRadius: 'var(--v2-radius-button)',
                                  boxShadow: 'var(--v2-shadow-sm)'
                                }
                              : message.variant === 'question'
                              ? {
                                  borderRadius: 'var(--v2-radius-button)',
                                  boxShadow: 'var(--v2-shadow-sm)',
                                  borderColor: 'var(--v2-primary)',
                                  borderWidth: '2px'
                                }
                              : message.variant === 'info'
                              ? {
                                  borderRadius: 'var(--v2-radius-button)',
                                  boxShadow: 'var(--v2-shadow-sm)',
                                  background: 'var(--v2-primary-light, var(--v2-surface))',
                                  borderColor: 'var(--v2-border)'
                                }
                              : {
                                  borderRadius: 'var(--v2-radius-button)',
                                  boxShadow: 'var(--v2-shadow-sm)'
                                }
                          }
                        >
                          <p className={`text-sm whitespace-pre-wrap leading-relaxed ${
                            message.role === 'user' ? '' : 'text-[var(--v2-text-primary)]'
                          }`}>
                            {message.content}
                          </p>

                          {/* Quick-select buttons for discovery questions */}
                          {message.role === 'assistant' && message.quickOptions && index === messages.length - 1 && (
                            <div className="mt-4 flex flex-wrap gap-2">
                              {message.quickOptions.map((option, optIndex) => {
                                const OptionIcon = option.iconName === 'Globe' ? Globe
                                  : option.iconName === 'Users' ? Users
                                  : option.iconName === 'ArrowLeftRight' ? ArrowLeftRight
                                  : option.iconName === 'Phone' ? Phone
                                  : option.iconName === 'X' ? X
                                  : option.iconName === 'Calendar' ? Calendar
                                  : option.iconName === 'CreditCard' ? CreditCard
                                  : option.iconName === 'Mail' ? Mail
                                  : option.iconName === 'Check' ? Check
                                  : null;

                                return (
                                  <button
                                    key={optIndex}
                                    onClick={() => handleQuickSelect(option.value, message.multiSelect)}
                                    className={`px-4 py-2 text-sm font-medium border transition-all flex items-center gap-2 ${
                                      selectedOptions.includes(option.value)
                                        ? 'bg-[var(--v2-primary)] text-white border-[var(--v2-primary)]'
                                        : 'bg-[var(--v2-surface)] text-[var(--v2-text-primary)] border-[var(--v2-border)] hover:border-[var(--v2-primary)] hover:bg-[var(--v2-primary)]/5'
                                    }`}
                                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                                  >
                                    {OptionIcon && <OptionIcon className="w-4 h-4" />}
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* Submit button for multi-select */}
                          {message.role === 'assistant' && message.multiSelect && selectedOptions.length > 0 && index === messages.length - 1 && (
                            <div className="mt-3">
                              <button
                                onClick={handleDiscoveryAnswer}
                                className="px-6 py-2 bg-[var(--v2-primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                              >
                                {locale === 'en' ? 'Continue' : locale === 'es' ? 'Continuar' : 'המשך'} ({selectedOptions.length})
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* User Avatar */}
                      {message.role === 'user' && (
                        <div
                          className="w-8 h-8 bg-[var(--v2-primary)] flex items-center justify-center flex-shrink-0"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          <User className="h-4 w-4 text-white" />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Preview Capabilities (Interactive) */}
              {step === 'preview' && previewCapabilities.length > 0 && (
                <div className="space-y-4 my-4">
                  {/* Instruction Text */}
                  <div className="flex items-center justify-center gap-2 pb-3">
                    <Sparkles className="w-5 h-5 text-[var(--v2-primary)]" />
                    <p className="text-base font-medium text-[var(--v2-text-primary)]">
                      {locale === 'en' ? 'Click any item to remove it. We recommend keeping everything.' : locale === 'es' ? 'Haz clic en cualquier elemento para eliminarlo. Recomendamos mantener todo.' : 'לחץ על כל פריט כדי להסיר אותו. אנו ממליצים לשמור הכל.'}
                    </p>
                  </div>

                  {/* Systems Section */}
                  {previewCapabilities.filter(c => c.category === 'system').length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--v2-text-secondary)] mb-3 uppercase tracking-wide">
                        {locale === 'en' ? 'What We\'ll Build' : locale === 'es' ? 'Lo Que Construiremos' : 'מה נבנה'}
                      </h3>
                      <div className="grid gap-3">
                        {previewCapabilities.filter(c => c.category === 'system').map(capability => {
                          const IconComponent = capability.icon === 'Globe' ? Globe
                            : capability.icon === 'Users' ? Users
                            : capability.icon === 'Calendar' ? Calendar
                            : capability.icon === 'CreditCard' ? CreditCard
                            : capability.icon === 'Mail' ? Mail
                            : capability.icon === 'Megaphone' ? Megaphone
                            : Bot;

                          const isSelected = selectedCapabilities.includes(capability.id);

                          // Convert hex to rgba for transparency
                          const hexToRgba = (hex: string, opacity: number) => {
                            const r = parseInt(hex.slice(1, 3), 16);
                            const g = parseInt(hex.slice(3, 5), 16);
                            const b = parseInt(hex.slice(5, 7), 16);
                            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
                          };

                          return (
                            <div
                              key={capability.id}
                              onClick={() => {
                                setSelectedCapabilities(prev =>
                                  prev.includes(capability.id)
                                    ? prev.filter(id => id !== capability.id)
                                    : [...prev, capability.id]
                                );
                              }}
                              className="p-4 border-2 cursor-pointer transition-all"
                              style={{
                                borderRadius: 'var(--v2-radius-card)',
                                borderColor: isSelected ? capability.color : 'var(--v2-border)',
                                backgroundColor: 'var(--v2-surface)'
                              }}
                            >
                              <div className="flex items-start gap-3">
                                {/* Checkbox */}
                                <div
                                  className="w-5 h-5 border-2 flex items-center justify-center flex-shrink-0 mt-0.5"
                                  style={{
                                    borderRadius: 'var(--v2-radius-input)',
                                    borderColor: isSelected ? capability.color : 'var(--v2-border)',
                                    backgroundColor: isSelected ? capability.color : 'transparent'
                                  }}
                                >
                                  {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                                </div>

                                {/* Icon */}
                                <div
                                  className="w-10 h-10 flex items-center justify-center flex-shrink-0"
                                  style={{
                                    borderRadius: 'var(--v2-radius-button)',
                                    backgroundColor: isSelected ? capability.color : hexToRgba(capability.color, 0.2),
                                    border: isSelected ? 'none' : `1px solid ${hexToRgba(capability.color, 0.3)}`
                                  }}
                                >
                                  <IconComponent className="w-5 h-5" style={{ color: isSelected ? 'white' : capability.color }} />
                                </div>

                                {/* Content */}
                                <div className="flex-1">
                                  <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-1">
                                    {capability.name}
                                  </h4>
                                  <p className="text-xs text-[var(--v2-text-secondary)] mb-2">
                                    {capability.description}
                                  </p>
                                  <div className="flex items-center gap-1.5">
                                    <Zap className="w-3.5 h-3.5" style={{ color: capability.color }} />
                                    <span className="text-xs font-medium" style={{ color: capability.color }}>
                                      {capability.impact}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Smart Helpers Section */}
                  {previewCapabilities.filter(c => c.category === 'ai_assistant').length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--v2-text-secondary)] mb-3 uppercase tracking-wide">
                        {locale === 'en' ? 'Smart Helpers' : locale === 'es' ? 'Ayudantes Inteligentes' : 'עוזרים חכמים'}
                      </h3>
                      <div className="grid gap-3">
                        {previewCapabilities.filter(c => c.category === 'ai_assistant').map(capability => {
                          const isSelected = selectedCapabilities.includes(capability.id);

                          // Convert hex to rgba for transparency
                          const hexToRgba = (hex: string, opacity: number) => {
                            const r = parseInt(hex.slice(1, 3), 16);
                            const g = parseInt(hex.slice(3, 5), 16);
                            const b = parseInt(hex.slice(5, 7), 16);
                            return `rgba(${r}, ${g}, ${b}, ${opacity})`;
                          };

                          return (
                            <div
                              key={capability.id}
                              onClick={() => {
                                setSelectedCapabilities(prev =>
                                  prev.includes(capability.id)
                                    ? prev.filter(id => id !== capability.id)
                                    : [...prev, capability.id]
                                );
                              }}
                              className="p-4 border-2 cursor-pointer transition-all"
                              style={{
                                borderRadius: 'var(--v2-radius-card)',
                                borderColor: isSelected ? capability.color : 'var(--v2-border)',
                                backgroundColor: 'var(--v2-surface)'
                              }}
                            >
                              <div className="flex items-start gap-3">
                                {/* Checkbox */}
                                <div
                                  className="w-5 h-5 border-2 flex items-center justify-center flex-shrink-0 mt-0.5"
                                  style={{
                                    borderRadius: 'var(--v2-radius-input)',
                                    borderColor: isSelected ? capability.color : 'var(--v2-border)',
                                    backgroundColor: isSelected ? capability.color : 'transparent'
                                  }}
                                >
                                  {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                                </div>

                                {/* Icon */}
                                <div
                                  className="w-10 h-10 flex items-center justify-center flex-shrink-0"
                                  style={{
                                    borderRadius: 'var(--v2-radius-button)',
                                    backgroundColor: isSelected ? capability.color : hexToRgba(capability.color, 0.2),
                                    border: isSelected ? 'none' : `1px solid ${hexToRgba(capability.color, 0.3)}`
                                  }}
                                >
                                  <Bot className="w-5 h-5" style={{ color: isSelected ? 'white' : capability.color }} />
                                </div>

                                {/* Content */}
                                <div className="flex-1">
                                  <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-1">
                                    {capability.name}
                                  </h4>
                                  <p className="text-xs text-[var(--v2-text-secondary)] mb-2">
                                    {capability.description}
                                  </p>
                                  <div className="flex items-center gap-1.5">
                                    <Zap className="w-3.5 h-3.5" style={{ color: capability.color }} />
                                    <span className="text-xs font-medium" style={{ color: capability.color }}>
                                      {capability.impact}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Build Button */}
                  <div className="flex justify-center pt-2">
                    <button
                      onClick={() => {
                        addMessage({
                          role: 'user',
                          content: locale === 'en' ? 'Build everything!' : locale === 'es' ? '¡Construir todo!' : 'בנה הכל!'
                        });
                        handleBuildEverything();
                      }}
                      disabled={selectedCapabilities.length === 0}
                      className="px-8 py-3 bg-[var(--v2-primary)] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ borderRadius: 'var(--v2-radius-button)', boxShadow: 'var(--v2-shadow-button)' }}
                    >
                      {locale === 'en' ? `Build Selected (${selectedCapabilities.length})` : locale === 'es' ? `Construir Seleccionados (${selectedCapabilities.length})` : `בנה נבחרים (${selectedCapabilities.length})`}
                    </button>
                  </div>
                </div>
              )}

              {/* Building Progress Bar */}
              {step === 'building' && (
                <div className="max-w-md mx-auto mt-6 p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="text-[var(--v2-text-secondary)]">Building...</span>
                    <span className="font-medium text-[var(--v2-primary)]">{buildingProgress}%</span>
                  </div>
                  <div className="w-full bg-[var(--v2-border)] h-2" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                    <div
                      className="h-2 bg-[var(--v2-primary)] transition-all duration-500"
                      style={{
                        width: `${buildingProgress}%`,
                        borderRadius: 'var(--v2-radius-button)'
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Success Checkmark */}
              {step === 'success' && (
                <div className="flex justify-center my-8">
                  <div className="w-16 h-16 bg-[var(--v2-success)] rounded-full flex items-center justify-center">
                    <Check className="w-10 h-10 text-white" strokeWidth={3} />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="px-6 py-4 border-t border-[var(--v2-border)]">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={t.typeHere}
                  disabled={isSending || step === 'building' || step === 'success'}
                  className="flex-1 px-4 py-2.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-sm text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />

                {/* Upload Button (shown in welcome step) */}
                {step === 'welcome' && (
                  <label className="cursor-pointer">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.docx,.txt"
                      onChange={handleUploadFile}
                      className="hidden"
                      disabled={isSending}
                    />
                    <div
                      className="px-4 py-2.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-colors flex items-center gap-2"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <Upload className="w-4 h-4 text-[var(--v2-text-secondary)]" />
                      <span className="hidden sm:inline text-sm text-[var(--v2-text-secondary)]">{t.uploadFile}</span>
                    </div>
                  </label>
                )}

                <button
                  onClick={handleSend}
                  disabled={isSending || !inputValue.trim() || step === 'building' || step === 'success'}
                  className="px-4 py-2 bg-[var(--v2-primary)] text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
