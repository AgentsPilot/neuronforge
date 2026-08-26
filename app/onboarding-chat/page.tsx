'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, Loader2, Send, User, Sparkles, Check, Plus, Trash2, X, Building2, Users, Calendar, CreditCard, Globe, Mail, Share2, XCircle, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { V2Logo } from '@/components/v2/V2Header';
import { useV2Theme } from '@/lib/design-system-v2';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { cn } from '@/lib/utils';

interface ServiceInput {
  name: string;
  duration: string;
  price: string;
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
  }>;
  services?: Array<{
    service_name: string;
    duration_minutes: number;
    price: number | null;
    currency?: string;
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

export default function OnboardingChatPage() {
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { mode } = useV2Theme();
  const { setLanguage } = useLanguage();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState<string>('welcome');
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 10 });
  const [conversationId, setConversationId] = useState<string | null>(null);

  // Track the language selected during THIS onboarding session
  // IMPORTANT: Always start in English (LTR) - only switch to Hebrew after user explicitly selects it
  const [selectedLanguage, setSelectedLanguage] = useState<'en' | 'he' | 'es'>('en');

  // Services form modal state
  const [showServicesForm, setShowServicesForm] = useState(false);
  const [servicesInput, setServicesInput] = useState<ServiceInput[]>([
    { name: '', duration: '60', price: '' }
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
          suggestions: ['English', 'עברית (Hebrew)', 'Español (Spanish)']
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
      setProgress(result.progress);

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
    setServicesInput(prev => [...prev, { name: '', duration: '60', price: '' }]);
  };

  const removeServiceRow = (index: number) => {
    if (servicesInput.length > 1) {
      setServicesInput(prev => prev.filter((_, i) => i !== index));
    }
  };

  const updateServiceRow = (index: number, field: keyof ServiceInput, value: string) => {
    setServicesInput(prev => prev.map((service, i) =>
      i === index ? { ...service, [field]: value } : service
    ));
  };

  const submitServices = () => {
    // Filter out empty services and format as text
    const validServices = servicesInput.filter(s => s.name.trim());
    if (validServices.length === 0) return;

    // Format services as a natural language message
    const servicesText = validServices.map(s => {
      const currency = selectedLanguage === 'he' ? '₪' : selectedLanguage === 'es' ? '€' : '$';
      const parts = [s.name];
      if (s.duration) parts.push(`${s.duration} ${selectedLanguage === 'he' ? 'דקות' : selectedLanguage === 'es' ? 'minutos' : 'minutes'}`);
      if (s.price) parts.push(`${currency}${s.price}`);
      return parts.join(' - ');
    }).join('\n');

    // Reset form and close modal
    setShowServicesForm(false);
    setServicesInput([{ name: '', duration: '60', price: '' }]);

    // Send as message
    sendMessage(servicesText);
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <V2Logo />
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Progress Bar */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-[var(--v2-text-secondary)]">
              {selectedLanguage === 'he' ? 'התקדמות' : selectedLanguage === 'es' ? 'Progreso' : 'Progress'}
            </span>
            <span className="text-sm font-medium text-[var(--v2-primary)]">
              {progress.completed}/{progress.total}
            </span>
          </div>
          <div className="w-full bg-[var(--v2-border)] h-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--v2-primary)] transition-all duration-500"
              style={{ width: `${(progress.completed / progress.total) * 100}%` }}
            />
          </div>
        </div>

        {/* Chat Container */}
        <div
          className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg shadow-lg"
          style={{ height: 'calc(100vh - 280px)', minHeight: '500px' }}
        >
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
                  className={cn(
                    'flex gap-3',
                    message.role === 'user'
                      ? isRTL ? 'flex-row' : 'flex-row-reverse'
                      : isRTL ? 'flex-row-reverse' : 'flex-row',
                    message.role === 'user'
                      ? isRTL ? 'justify-start' : 'justify-end'
                      : isRTL ? 'justify-end' : 'justify-start'
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
                        <div className={cn('flex flex-wrap gap-2', isRTL && 'flex-row-reverse')}>
                          {lastMessage.suggestions.map((suggestion, idx) => {
                            const isSelected = multiSelectChoices.has(suggestion);
                            // Detect "none" option by checking for common patterns across languages
                            const isNoneOption = suggestion.toLowerCase().includes('none') ||
                              suggestion.includes('לא צריך') ||
                              suggestion.includes('no necesito');

                            // Map suggestion to icon based on content
                            const getIcon = () => {
                              const lower = suggestion.toLowerCase();
                              if (lower.includes('website') || lower.includes('אתר') || lower.includes('sitio')) {
                                return <Globe className="w-4 h-4" />;
                              }
                              if (lower.includes('email') || lower.includes('campaign') || lower.includes('קמפיין') || lower.includes('campaña')) {
                                return <Mail className="w-4 h-4" />;
                              }
                              if (lower.includes('social') || lower.includes('רשתות') || lower.includes('redes')) {
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
                                  setMultiSelectChoices(prev => {
                                    const next = new Set(prev);
                                    if (isNoneOption) {
                                      // "None" clears all other selections
                                      return isSelected ? new Set() : new Set([suggestion]);
                                    }
                                    // Toggle this option
                                    if (next.has(suggestion)) {
                                      next.delete(suggestion);
                                    } else {
                                      // Remove "none" if selecting something else
                                      for (const item of next) {
                                        const itemLower = item.toLowerCase();
                                        if (itemLower.includes('none') || item.includes('לא צריך') || item.includes('no necesito')) {
                                          next.delete(item);
                                        }
                                      }
                                      next.add(suggestion);
                                    }
                                    return next;
                                  });
                                }}
                                disabled={isSending}
                                className={cn(
                                  'px-4 py-2.5 text-sm font-medium rounded-xl transition-all disabled:opacity-50 flex items-center gap-2',
                                  isSelected
                                    ? 'bg-[var(--v2-primary)] text-white shadow-md scale-[1.02]'
                                    : 'bg-[var(--v2-surface)] text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:border-[var(--v2-primary)] hover:bg-[var(--v2-primary)]/5'
                                )}
                              >
                                {icon}
                                {suggestion}
                              </button>
                            );
                          })}
                        </div>
                        {/* Submit button for multi-select */}
                        {multiSelectChoices.size > 0 && (
                          <button
                            onClick={() => {
                              const selectedItems = Array.from(multiSelectChoices).join(', ');
                              sendMessage(selectedItems);
                              setMultiSelectChoices(new Set());
                            }}
                            disabled={isSending}
                            className="w-full px-4 py-3 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-primary)]/80 text-white font-semibold rounded-xl hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg"
                          >
                            {isSending ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <>
                                <Check className="w-4 h-4" />
                                {selectedLanguage === 'he' ? 'המשך' : selectedLanguage === 'es' ? 'Continuar' : 'Continue'}
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    ) : (
                      // Single-select buttons (original behavior)
                      <div className={cn('flex flex-wrap gap-2', isRTL && 'flex-row-reverse')}>
                        {lastMessage.suggestions.map((suggestion, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleSuggestionClick(suggestion)}
                            disabled={isSending}
                            className="px-4 py-2 text-sm font-medium bg-[var(--v2-surface)] text-[var(--v2-text-primary)] border border-[var(--v2-border)] hover:border-[var(--v2-primary)] hover:bg-[var(--v2-primary)]/5 rounded-lg transition-all disabled:opacity-50"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Preview Section - Modern visual summary */}
              {showPreview && previewData && (currentStep === 'preview' || currentStep === 'building') && (
                <div className="mt-6" dir={isRTL ? 'rtl' : 'ltr'}>
                  {/* Intro text above the card */}
                  <p className="text-sm text-[var(--v2-text-primary)] mb-3">
                    {selectedLanguage === 'he'
                      ? `הנה התוכנית שלי עבור **${previewData.businessProfile?.company_name || 'העסק שלך'}**:`
                      : selectedLanguage === 'es'
                      ? `Aquí está mi plan para **${previewData.businessProfile?.company_name || 'tu negocio'}**:`
                      : `Here's my plan for **${previewData.businessProfile?.company_name || 'your business'}**:`}
                  </p>
                  <div className="bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-2xl shadow-xl overflow-hidden">
                    {/* Header with business name */}
                    <div className="bg-[var(--v2-primary)] px-6 py-5">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center shadow-lg">
                          <Building2 className="w-7 h-7 text-white" />
                        </div>
                        <div>
                          <h3 className="text-xl font-bold text-white">
                            {previewData.businessProfile?.company_name || (selectedLanguage === 'he' ? 'העסק שלך' : selectedLanguage === 'es' ? 'Tu negocio' : 'Your business')}
                          </h3>
                          {previewData.businessProfile?.verticalDisplayName && (
                            <p className="text-sm text-white/80 mt-0.5">{previewData.businessProfile.verticalDisplayName}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Main content grid */}
                    <div className="p-5 space-y-4">

                      {/* Client Journey - Visual pipeline flow */}
                      {previewData.pipelineStages && previewData.pipelineStages.length > 0 && (
                        <div className="bg-[var(--v2-bg)] rounded-xl p-4 border border-[var(--v2-border)]">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <Users className="w-4 h-4 text-[var(--v2-primary)]" />
                              <h4 className="text-sm font-bold text-[var(--v2-text-primary)]">
                                {selectedLanguage === 'he' ? 'מסע הלקוח' : selectedLanguage === 'es' ? 'Recorrido del cliente' : 'Client Journey'}
                              </h4>
                            </div>
                            <button
                              onClick={openPipelineEditor}
                              className="flex items-center gap-1.5 text-xs font-medium text-[var(--v2-primary)] hover:text-[var(--v2-primary)]/80 transition-colors px-2 py-1 rounded-lg hover:bg-[var(--v2-primary)]/10"
                            >
                              <Pencil className="w-3 h-3" />
                              {selectedLanguage === 'he' ? 'ערוך' : selectedLanguage === 'es' ? 'Editar' : 'Edit'}
                            </button>
                          </div>
                          <div className="flex items-center gap-1 overflow-x-auto pb-1">
                            {previewData.pipelineStages.map((stage, idx) => (
                              <React.Fragment key={stage.stage_key}>
                                <div
                                  className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-white shadow-sm"
                                  style={{ backgroundColor: stage.color }}
                                >
                                  {stage.stage_label}
                                </div>
                                {idx < previewData.pipelineStages!.length - 1 && (
                                  <span className="text-[var(--v2-text-muted)] text-lg">{isRTL ? '←' : '→'}</span>
                                )}
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Feature cards grid */}
                      <div className="grid grid-cols-2 gap-3">
                        {/* Digital Presence Card */}
                        <div className="bg-[var(--v2-bg)] rounded-xl p-4 border border-[var(--v2-border)]">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-8 h-8 bg-[var(--v2-primary)]/10 rounded-lg flex items-center justify-center">
                              <Globe className="w-4 h-4 text-[var(--v2-primary)]" />
                            </div>
                            <h4 className="text-xs font-bold text-[var(--v2-text-secondary)] uppercase tracking-wide">
                              {selectedLanguage === 'he' ? 'נוכחות דיגיטלית' : selectedLanguage === 'es' ? 'Presencia' : 'Presence'}
                            </h4>
                          </div>
                          <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                            {previewData.configuration?.online_presence_mode === 'full_website'
                              ? (selectedLanguage === 'he' ? 'אתר + הזמנות' : selectedLanguage === 'es' ? 'Web + Reservas' : 'Website + Booking')
                              : previewData.configuration?.online_presence_mode === 'booking_only'
                              ? (selectedLanguage === 'he' ? 'עמוד הזמנות' : selectedLanguage === 'es' ? 'Reservas' : 'Booking Page')
                              : previewData.configuration?.online_presence_mode === 'website_only'
                              ? (selectedLanguage === 'he' ? 'אתר מקצועי' : selectedLanguage === 'es' ? 'Sitio Web' : 'Website')
                              : (selectedLanguage === 'he' ? 'לא כרגע' : selectedLanguage === 'es' ? 'No por ahora' : 'Not now')}
                          </p>
                          {previewData.configuration?.online_presence_mode && previewData.configuration.online_presence_mode !== 'none' && (
                            <span className="inline-block mt-2 px-2 py-0.5 bg-[var(--v2-primary)]/10 text-[var(--v2-primary)] text-xs font-medium rounded-full">
                              {selectedLanguage === 'he' ? 'ייבנה אוטומטית' : selectedLanguage === 'es' ? 'Se genera' : 'Auto-generated'}
                            </span>
                          )}
                        </div>

                        {/* Payments Card */}
                        <div className="bg-[var(--v2-bg)] rounded-xl p-4 border border-[var(--v2-border)]">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-8 h-8 bg-[var(--v2-primary)]/10 rounded-lg flex items-center justify-center">
                              <CreditCard className="w-4 h-4 text-[var(--v2-primary)]" />
                            </div>
                            <h4 className="text-xs font-bold text-[var(--v2-text-secondary)] uppercase tracking-wide">
                              {selectedLanguage === 'he' ? 'תשלומים' : selectedLanguage === 'es' ? 'Pagos' : 'Payments'}
                            </h4>
                          </div>
                          <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                            {previewData.configuration?.payment_mode === 'upfront'
                              ? (selectedLanguage === 'he' ? 'תשלום מראש' : selectedLanguage === 'es' ? 'Pago anticipado' : 'Pay upfront')
                              : previewData.configuration?.payment_mode === 'invoicing'
                              ? (selectedLanguage === 'he' ? 'חשבוניות' : selectedLanguage === 'es' ? 'Facturación' : 'Invoicing')
                              : previewData.configuration?.payment_mode === 'installments'
                              ? (selectedLanguage === 'he' ? 'תשלומים' : selectedLanguage === 'es' ? 'Cuotas' : 'Installments')
                              : (selectedLanguage === 'he' ? 'שירותים חינמיים' : selectedLanguage === 'es' ? 'Gratis' : 'Free services')}
                          </p>
                        </div>
                      </div>

                      {/* Tools/Capabilities - Visual pills */}
                      <div className="bg-[var(--v2-bg)] rounded-xl p-4 border border-[var(--v2-border)]">
                        <h4 className="text-xs font-bold text-[var(--v2-text-secondary)] uppercase tracking-wide mb-3">
                          {selectedLanguage === 'he' ? 'הכלים שלך' : selectedLanguage === 'es' ? 'Tus herramientas' : 'Your Tools'}
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {previewData.configuration?.capabilities?.map(cap => {
                            const capConfig: Record<string, { icon: React.ReactNode; names: Record<string, string> }> = {
                              crm: { icon: <Users className="w-3 h-3" />, names: { en: 'CRM', he: 'לקוחות', es: 'CRM' } },
                              scheduling: { icon: <Calendar className="w-3 h-3" />, names: { en: 'Scheduling', he: 'יומן', es: 'Calendario' } },
                              payments: { icon: <CreditCard className="w-3 h-3" />, names: { en: 'Payments', he: 'תשלומים', es: 'Pagos' } },
                              website: { icon: <Globe className="w-3 h-3" />, names: { en: 'Website', he: 'אתר', es: 'Web' } },
                              email_automation: { icon: <Mail className="w-3 h-3" />, names: { en: 'Email', he: 'אימייל', es: 'Email' } },
                              campaigns: { icon: <Mail className="w-3 h-3" />, names: { en: 'Campaigns', he: 'קמפיינים', es: 'Campañas' } },
                              reports: { icon: <Calendar className="w-3 h-3" />, names: { en: 'Reports', he: 'דוחות', es: 'Informes' } },
                              insights: { icon: <Sparkles className="w-3 h-3" />, names: { en: 'Insights', he: 'תובנות', es: 'Insights' } },
                              automations: { icon: <Sparkles className="w-3 h-3" />, names: { en: 'Automation', he: 'אוטומציה', es: 'Automatización' } },
                            };
                            const config = capConfig[cap] || { icon: <Check className="w-3 h-3" />, names: { en: cap, he: cap, es: cap } };
                            return (
                              <div
                                key={cap}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--v2-primary)] text-white text-xs font-medium shadow-sm"
                              >
                                {config.icon}
                                {config.names[selectedLanguage] || config.names.en}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Services - if any */}
                      {previewData.services && previewData.services.length > 0 && (
                        <div className="bg-[var(--v2-bg)] rounded-xl p-4 border border-[var(--v2-border)]">
                          <div className="flex items-center gap-2 mb-3">
                            <Calendar className="w-4 h-4 text-[var(--v2-primary)]" />
                            <h4 className="text-xs font-bold text-[var(--v2-text-secondary)] uppercase tracking-wide">
                              {selectedLanguage === 'he' ? 'שירותים' : selectedLanguage === 'es' ? 'Servicios' : 'Services'}
                            </h4>
                          </div>
                          <div className="space-y-2">
                            {previewData.services.map((service, idx) => {
                              const currency = service.currency || (selectedLanguage === 'he' ? '₪' : selectedLanguage === 'es' ? '€' : '$');
                              const priceStr = service.price && service.price > 0
                                ? `${currency}${service.price}`
                                : (selectedLanguage === 'he' ? 'חינם' : selectedLanguage === 'es' ? 'Gratis' : 'Free');
                              return (
                                <div key={idx} className="flex items-center justify-between py-2 border-b border-[var(--v2-border)] last:border-0">
                                  <div>
                                    <p className="text-sm font-medium text-[var(--v2-text-primary)]">{service.service_name}</p>
                                    <p className="text-xs text-[var(--v2-text-muted)]">{service.duration_minutes} {selectedLanguage === 'he' ? 'דקות' : 'min'}</p>
                                  </div>
                                  <span className="text-sm font-bold text-[var(--v2-primary)]">{priceStr}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
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
                          <button
                            onClick={() => {
                              // Focus the input field so user can type what they want to change
                              inputRef.current?.focus();
                            }}
                            disabled={isSending}
                            className="w-full px-4 py-2.5 bg-transparent border border-[var(--v2-border)] text-[var(--v2-text-secondary)] font-medium rounded-xl hover:bg-[var(--v2-surface)] hover:border-[var(--v2-primary)] hover:text-[var(--v2-text-primary)] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                          >
                            <Pencil className="w-4 h-4" />
                            {selectedLanguage === 'he' ? 'אני רוצה לשנות משהו' : selectedLanguage === 'es' ? 'Quiero cambiar algo' : 'I want to change something'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Pipeline Editor Modal */}
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

                              {/* Stage Label Input */}
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
                                disabled={editingPipelineStages.length <= 2}
                                className="p-1.5 text-[var(--v2-text-muted)] hover:text-red-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                <Trash2 className="w-4 h-4" />
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
                </div>
              )}

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
                    <div className="col-span-5">
                      {selectedLanguage === 'he' ? 'שם השירות' : selectedLanguage === 'es' ? 'Nombre del servicio' : 'Service Name'}
                    </div>
                    <div className="col-span-3">
                      {selectedLanguage === 'he' ? 'משך (דקות)' : selectedLanguage === 'es' ? 'Duración (min)' : 'Duration (min)'}
                    </div>
                    <div className="col-span-3">
                      {selectedLanguage === 'he' ? 'מחיר' : selectedLanguage === 'es' ? 'Precio' : 'Price'}
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
                            'col-span-5 px-3 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)]',
                            isRTL && 'text-right'
                          )}
                        />
                        <input
                          type="number"
                          value={service.duration}
                          onChange={(e) => updateServiceRow(index, 'duration', e.target.value)}
                          placeholder="60"
                          className={cn(
                            'col-span-3 px-3 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] text-[var(--v2-text-primary)]',
                            isRTL && 'text-right'
                          )}
                        />
                        <div className="col-span-3 relative">
                          <span className={cn(
                            'absolute top-1/2 -translate-y-1/2 text-sm text-[var(--v2-text-muted)]',
                            isRTL ? 'right-3' : 'left-3'
                          )}>
                            {selectedLanguage === 'he' ? '₪' : selectedLanguage === 'es' ? '€' : '$'}
                          </span>
                          <input
                            type="number"
                            value={service.price}
                            onChange={(e) => updateServiceRow(index, 'price', e.target.value)}
                            placeholder="0"
                            className={cn(
                              'w-full px-3 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)] text-[var(--v2-text-primary)]',
                              isRTL ? 'pr-8 text-right' : 'pl-8'
                            )}
                          />
                        </div>
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

                  {/* Actions */}
                  <div className={cn('flex items-center justify-between mt-4', isRTL && 'flex-row-reverse')}>
                    <button
                      onClick={addServiceRow}
                      className="flex items-center gap-1 text-sm text-[var(--v2-primary)] hover:text-[var(--v2-primary)]/80 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      {selectedLanguage === 'he' ? 'הוסף שירות' : selectedLanguage === 'es' ? 'Agregar servicio' : 'Add Service'}
                    </button>
                    <button
                      onClick={submitServices}
                      disabled={!servicesInput.some(s => s.name.trim())}
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
      </div>
    </div>
  );
}
