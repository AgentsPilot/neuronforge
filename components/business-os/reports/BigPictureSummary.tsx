'use client';

import { Sparkles } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { OverallHealth } from '@/lib/business-os/insights/StaticHealthRules';

interface BigPictureSummaryProps {
  narrative: string;
  healthStatus: OverallHealth;
  loading?: boolean;
  onGenerateInsights?: () => void;
  hasGeneratedStory?: boolean;
}

// Health status styling
const healthConfig: Record<OverallHealth, { gradient: string; dot: string; label: string }> = {
  thriving: {
    gradient: 'from-green-500/10 to-emerald-500/10 dark:from-green-500/20 dark:to-emerald-500/20',
    dot: 'bg-green-500',
    label: 'Thriving'
  },
  healthy: {
    gradient: 'from-blue-500/10 to-cyan-500/10 dark:from-blue-500/20 dark:to-cyan-500/20',
    dot: 'bg-blue-500',
    label: 'Healthy'
  },
  watch: {
    gradient: 'from-amber-500/10 to-yellow-500/10 dark:from-amber-500/20 dark:to-yellow-500/20',
    dot: 'bg-amber-500',
    label: 'Needs attention'
  },
  starting: {
    gradient: 'from-purple-500/10 to-indigo-500/10 dark:from-purple-500/20 dark:to-indigo-500/20',
    dot: 'bg-purple-500',
    label: 'Getting started'
  }
};

// Default narratives based on health status (no LLM)
const defaultNarratives: Record<OverallHealth, Record<string, string>> = {
  thriving: {
    en: 'Your business is doing great. Revenue is flowing, clients are coming in, and your calendar is filling up.',
    es: 'Tu negocio va muy bien. Los ingresos fluyen, los clientes llegan y tu calendario se llena.',
    he: 'העסק שלך מצליח. הכנסות זורמות, לקוחות מגיעים, והיומן מתמלא.'
  },
  healthy: {
    en: 'Things are running smoothly. Your business is in good shape overall.',
    es: 'Las cosas van bien. Tu negocio está en buena forma en general.',
    he: 'הדברים מתנהלים בצורה חלקה. העסק שלך במצב טוב באופן כללי.'
  },
  watch: {
    en: 'A few things could use your attention. Check the cards below for details.',
    es: 'Algunas cosas necesitan tu atención. Revisa las tarjetas abajo para más detalles.',
    he: 'כמה דברים דורשים את תשומת הלב שלך. בדוק את הכרטיסים למטה לפרטים.'
  },
  starting: {
    en: "Your business is just getting started. Let's see how things develop.",
    es: 'Tu negocio recién comienza. Veamos cómo se desarrollan las cosas.',
    he: 'העסק שלך רק מתחיל. בוא נראה איך הדברים מתפתחים.'
  }
};

export function BigPictureSummary({
  narrative,
  healthStatus,
  loading,
  onGenerateInsights,
  hasGeneratedStory
}: BigPictureSummaryProps) {
  const { language } = useLanguage();
  const config = healthConfig[healthStatus];
  const isRTL = language === 'he';

  // Use default narrative if no LLM narrative provided
  const displayNarrative = narrative || defaultNarratives[healthStatus][language] || defaultNarratives[healthStatus].en;

  // Translate health labels
  const healthLabels: Record<OverallHealth, Record<string, string>> = {
    thriving: { en: 'Thriving', es: 'Prosperando', he: 'משגשג' },
    healthy: { en: 'Healthy', es: 'Saludable', he: 'בריא' },
    watch: { en: 'Needs attention', es: 'Necesita atención', he: 'דורש תשומת לב' },
    starting: { en: 'Getting started', es: 'Comenzando', he: 'מתחילים' }
  };

  const titleText: Record<string, string> = {
    en: 'The Big Picture',
    es: 'El Panorama General',
    he: 'התמונה הגדולה'
  };

  const generateButtonText: Record<string, string> = {
    en: 'Generate AI Insights',
    es: 'Generar Análisis con IA',
    he: 'צור תובנות AI'
  };

  const generatingText: Record<string, string> = {
    en: 'Generating insights...',
    es: 'Generando análisis...',
    he: 'יוצר תובנות...'
  };

  return (
    <div
      className={`bg-gradient-to-br ${config.gradient} border border-[var(--v2-border)] p-4 relative overflow-hidden`}
      style={{ borderRadius: 'var(--v2-radius-card)' }}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Decorative sparkle */}
      <div className="absolute top-3 end-3 opacity-20">
        <Sparkles className="w-6 h-6 text-[var(--v2-text-muted)]" />
      </div>

      {/* Header with title, health badge, and AI button */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[var(--v2-primary)]" />
          <h2 className="text-base font-semibold text-[var(--v2-text-primary)]">
            {titleText[language] || titleText.en}
          </h2>
          {/* Health badge - inline with title */}
          <div className="flex items-center gap-1.5 ms-1">
            <div className={`w-2 h-2 rounded-full ${config.dot}`} />
            <span className="text-xs font-medium text-[var(--v2-text-secondary)]">
              {healthLabels[healthStatus][language] || healthLabels[healthStatus].en}
            </span>
          </div>
        </div>
        {/* Generate Insights button - on the right */}
        {onGenerateInsights && !hasGeneratedStory && !loading && (
          <button
            onClick={onGenerateInsights}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--v2-primary)] text-white text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <Sparkles className="w-3 h-3" />
            {loading
              ? (generatingText[language] || generatingText.en)
              : (generateButtonText[language] || generateButtonText.en)
            }
          </button>
        )}
      </div>

      {/* Narrative */}
      {loading ? (
        <div className="space-y-1.5 animate-pulse">
          <div className="h-4 bg-[var(--v2-border)] rounded w-full" />
          <div className="h-4 bg-[var(--v2-border)] rounded w-3/4" />
        </div>
      ) : (
        <p className="text-sm text-[var(--v2-text-primary)] leading-relaxed">
          {displayNarrative}
        </p>
      )}
    </div>
  );
}
