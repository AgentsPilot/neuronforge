/**
 * Insight Correlation Engine
 *
 * Connects individual detector signals into unified, story-driven insights.
 * This is what creates the "WOW" factor - showing business owners
 * how different issues are interconnected.
 *
 * Called after all individual detectors run.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import { createLogger } from '@/lib/logger';
import type { DetectionResult, InsightSeverity } from '../detectors/types';
import type {
  CorrelationPattern,
  PatternMatch,
  CorrelatedInsight,
  CorrelationSummary,
} from './types';
import { CORRELATION_PATTERNS } from './patterns';

const logger = createLogger({ module: 'InsightCorrelationEngine' });

/**
 * Severity order for comparison
 */
const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Engine that correlates individual detection results into unified insights
 */
type SupportedLanguage = 'en' | 'es' | 'he';
type SupportedCurrency = 'USD' | 'EUR' | 'ILS';

interface LocaleConfig {
  language: SupportedLanguage;
  currency: SupportedCurrency;
}

const CURRENCY_SYMBOLS: Record<SupportedCurrency, string> = {
  USD: '$',
  EUR: '€',
  ILS: '₪',
};

/**
 * Engine that correlates individual detection results into unified insights
 */
export class InsightCorrelationEngine {
  private patterns: CorrelationPattern[];
  private locale: LocaleConfig;

  constructor(locale?: Partial<LocaleConfig>) {
    this.patterns = CORRELATION_PATTERNS;
    this.locale = {
      language: locale?.language || 'en',
      currency: locale?.currency || 'USD',
    };
  }

  /**
   * Set locale for generating localized content
   */
  setLocale(locale: Partial<LocaleConfig>): void {
    if (locale.language) this.locale.language = locale.language;
    if (locale.currency) this.locale.currency = locale.currency;
  }

  /**
   * Correlate detection results into unified insights
   *
   * @param detectionResults - Results from individual detectors
   * @returns Summary with correlated and standalone insights
   */
  correlate(detectionResults: DetectionResult[]): CorrelationSummary {
    if (detectionResults.length === 0) {
      return {
        correlatedInsights: [],
        standaloneInsights: [],
        patternsChecked: this.patterns.length,
        patternsMatched: 0,
        totalImpactUsd: 0,
      };
    }

    // Build a set of fired detector IDs
    const firedDetectorIds = new Set(detectionResults.map((r) => r.detectorId));

    // Find matching patterns
    const patternMatches: PatternMatch[] = [];

    for (const pattern of this.patterns) {
      const match = this.checkPattern(pattern, detectionResults, firedDetectorIds);
      if (match) {
        patternMatches.push(match);
      }
    }

    // Sort by priority (higher first)
    patternMatches.sort((a, b) => b.pattern.priority - a.pattern.priority);

    // Track which detector IDs are used in correlations
    const usedDetectorIds = new Set<string>();

    // Convert matches to correlated insights
    const correlatedInsights: CorrelatedInsight[] = patternMatches.map((match) => {
      // Mark detector IDs as used
      match.matchedResults.forEach((r) => usedDetectorIds.add(r.detectorId));

      return this.createCorrelatedInsight(match);
    });

    // Find standalone insights (not part of any correlation)
    const standaloneInsights = detectionResults.filter(
      (r) => !usedDetectorIds.has(r.detectorId)
    );

    // Calculate total impact
    const totalImpactUsd =
      correlatedInsights.reduce((sum, i) => sum + i.totalImpactUsd, 0) +
      standaloneInsights.reduce((sum, r) => sum + (r.estimatedImpactUsd || 0), 0);

    logger.info(
      {
        totalResults: detectionResults.length,
        patternsMatched: patternMatches.length,
        correlatedCount: correlatedInsights.length,
        standaloneCount: standaloneInsights.length,
        totalImpactUsd,
      },
      'Correlation complete'
    );

    return {
      correlatedInsights,
      standaloneInsights,
      patternsChecked: this.patterns.length,
      patternsMatched: patternMatches.length,
      totalImpactUsd,
    };
  }

  /**
   * Check if a pattern matches the detection results
   */
  private checkPattern(
    pattern: CorrelationPattern,
    results: DetectionResult[],
    firedIds: Set<string>
  ): PatternMatch | null {
    // Check required detectors
    const matchedRequired = pattern.requiredDetectors.filter((id) => firedIds.has(id));

    // Need at least minMatches from required
    if (matchedRequired.length < pattern.minMatches) {
      return null;
    }

    // Check optional detectors
    const matchedOptional = (pattern.optionalDetectors || []).filter((id) => firedIds.has(id));

    // Get the actual detection results
    const matchedResults = results.filter(
      (r) => matchedRequired.includes(r.detectorId) || matchedOptional.includes(r.detectorId)
    );

    // Calculate combined severity
    const combinedSeverity = this.calculateCombinedSeverity(matchedResults, pattern.severityBoost);

    // Calculate total impact
    const totalImpactUsd = matchedResults.reduce(
      (sum, r) => sum + (r.estimatedImpactUsd || 0),
      0
    );

    // Generate story and action
    const story = this.generateStory(pattern, matchedResults);
    const action = pattern.actionTemplate;

    return {
      pattern,
      matchedResults,
      matchedRequired,
      matchedOptional,
      combinedSeverity,
      totalImpactUsd,
      story,
      action,
    };
  }

  /**
   * Calculate combined severity with boost
   */
  private calculateCombinedSeverity(
    results: DetectionResult[],
    boost: number
  ): InsightSeverity {
    if (results.length === 0) return 'low';

    // Get highest severity
    let maxSeverityValue = 0;
    for (const result of results) {
      const severityValue = SEVERITY_ORDER[result.severity] || 1;
      if (severityValue > maxSeverityValue) {
        maxSeverityValue = severityValue;
      }
    }

    // Apply boost (round up)
    const boostedValue = Math.min(4, Math.ceil(maxSeverityValue * boost));

    // Convert back to severity
    const severityByValue = Object.entries(SEVERITY_ORDER).find(
      ([, v]) => v === boostedValue
    );

    return (severityByValue?.[0] as InsightSeverity) || 'high';
  }

  /**
   * Generate the story text from template and results
   */
  private generateStory(pattern: CorrelationPattern, results: DetectionResult[]): string {
    let story = pattern.storyTemplate;

    // Build replacements based on detector results
    const replacements: Record<string, string> = {
      total_impact: this.formatCurrency(
        results.reduce((sum, r) => sum + (r.estimatedImpactUsd || 0), 0)
      ),
    };

    // Add detector-specific context
    results.forEach((result) => {
      const summary = this.getResultSummary(result);

      // Map common detector ID patterns to template variables
      if (result.detectorId.includes('traffic')) {
        replacements.traffic_issue = summary;
      } else if (result.detectorId.includes('conversion')) {
        replacements.conversion_issue = summary;
      } else if (result.detectorId.includes('cold_leads')) {
        replacements.cold_leads_issue = summary;
      } else if (result.detectorId.includes('ar_overdue') || result.detectorId.includes('ar_aging')) {
        replacements.ar_issue = summary;
        replacements.aging_issue = summary;
      } else if (result.detectorId.includes('payment_issues')) {
        replacements.payment_issue = summary;
      } else if (result.detectorId.includes('engagement')) {
        replacements.engagement_issue = summary;
      } else if (result.detectorId.includes('repeat_booking') || result.detectorId.includes('rebooking')) {
        replacements.rebooking_issue = summary;
      } else if (result.detectorId.includes('pipeline_stuck')) {
        replacements.stuck_deals_issue = summary;
      } else if (result.detectorId.includes('utilization')) {
        replacements.utilization_issue = summary;
      } else if (result.detectorId.includes('cancellation_spike')) {
        replacements.cancellation_issue = summary;
      } else if (result.detectorId.includes('last_minute')) {
        replacements.last_minute_issue = summary;
      } else if (result.detectorId.includes('missing_cta')) {
        replacements.cta_issue = summary;
      } else if (result.detectorId.includes('page_underperform')) {
        replacements.page_issue = summary;
      } else if (result.detectorId.includes('cards_expiring')) {
        replacements.cards_issue = summary;
      } else if (result.detectorId.includes('discount')) {
        replacements.discount_issue = summary;
      } else if (result.detectorId.includes('intro_offer')) {
        replacements.intro_issue = summary;
      } else if (result.detectorId.includes('service_performance')) {
        replacements.service_issue = summary;
      } else if (result.detectorId.includes('peak_unutilized')) {
        replacements.peak_issue = summary;
      }
    });

    // Handle optional context
    const optionalContext = results
      .filter((r) => pattern.optionalDetectors?.includes(r.detectorId))
      .map((r) => this.getResultSummary(r))
      .join(' ');

    replacements.optional_context = optionalContext ? `Additionally, ${optionalContext} ` : '';

    // Apply replacements
    for (const [key, value] of Object.entries(replacements)) {
      story = story.replace(`{${key}}`, value);
    }

    // Clean up any remaining placeholders
    story = story.replace(/\{[^}]+\}/g, '');

    return story.trim();
  }

  /**
   * Get localized "at risk" text
   */
  private getAtRiskText(): string {
    const texts: Record<SupportedLanguage, string> = {
      en: 'at risk',
      es: 'en riesgo',
      he: 'בסיכון',
    };
    return texts[this.locale.language];
  }

  /**
   * Get a brief summary of a detection result (localized)
   */
  private getResultSummary(result: DetectionResult): string {
    const impact = result.estimatedImpactUsd
      ? ` (${this.formatCurrency(result.estimatedImpactUsd)} ${this.getAtRiskText()})`
      : '';

    const count = result.affectedCount || 0;
    const value = result.currentValue || 0;
    const pctChange = Math.abs(result.percentChange || 0);
    const lang = this.locale.language;

    // Localized summary templates
    const summaries: Record<string, Record<SupportedLanguage, string>> = {
      acq_traffic_drop: {
        en: `website traffic dropped ${pctChange}%${impact}`,
        es: `el tráfico del sitio cayó ${pctChange}%${impact}`,
        he: `התנועה לאתר ירדה ב-${pctChange}%${impact}`,
      },
      acq_low_conversion: {
        en: `form conversion rate is only ${value}%${impact}`,
        es: `tasa de conversión de formularios es solo ${value}%${impact}`,
        he: `שיעור ההמרה של טפסים הוא רק ${value}%${impact}`,
      },
      crm_cold_leads: {
        en: `${count} leads have gone cold${impact}`,
        es: `${count} leads se han enfriado${impact}`,
        he: `${count} לידים הפכו לקרים${impact}`,
      },
      cash_ar_overdue: {
        en: `${count} overdue invoices${impact}`,
        es: `${count} facturas vencidas${impact}`,
        he: `${count} חשבוניות בפיגור${impact}`,
      },
      crm_engagement_decay: {
        en: `${count} clients inactive for 30+ days${impact}`,
        es: `${count} clientes inactivos por 30+ días${impact}`,
        he: `${count} לקוחות לא פעילים מעל 30 יום${impact}`,
      },
      ret_repeat_booking_low: {
        en: `only ${100 - value}% of clients are rebooking${impact}`,
        es: `solo ${100 - value}% de clientes vuelven a reservar${impact}`,
        he: `רק ${100 - value}% מהלקוחות חוזרים להזמין${impact}`,
      },
      conv_pipeline_stuck: {
        en: `${count} contacts stuck in pipeline${impact}`,
        es: `${count} contactos atascados en el embudo${impact}`,
        he: `${count} אנשי קשר תקועים בצנרת${impact}`,
      },
      conv_followup_overdue: {
        en: `${count} overdue follow-up tasks${impact}`,
        es: `${count} tareas de seguimiento vencidas${impact}`,
        he: `${count} משימות מעקב באיחור${impact}`,
      },
      ops_utilization_low: {
        en: `calendar utilization is only ${value}%${impact}`,
        es: `utilización del calendario es solo ${value}%${impact}`,
        he: `ניצולת היומן היא רק ${value}%${impact}`,
      },
      ret_cancellation_spike: {
        en: `cancellations increased ${pctChange}%${impact}`,
        es: `cancelaciones aumentaron ${pctChange}%${impact}`,
        he: `הביטולים עלו ב-${pctChange}%${impact}`,
      },
      ops_last_minute_cancels: {
        en: `${count} last-minute cancellations${impact}`,
        es: `${count} cancelaciones de último momento${impact}`,
        he: `${count} ביטולים ברגע האחרון${impact}`,
      },
      web_missing_cta: {
        en: `${count} pages missing calls-to-action${impact}`,
        es: `${count} páginas sin llamadas a la acción${impact}`,
        he: `${count} עמודים ללא קריאה לפעולה${impact}`,
      },
      web_page_underperform: {
        en: `${count} pages with zero conversions${impact}`,
        es: `${count} páginas sin conversiones${impact}`,
        he: `${count} עמודים ללא המרות${impact}`,
      },
      cash_ar_aging: {
        en: `invoices aging into 60+ day buckets${impact}`,
        es: `facturas envejeciendo a más de 60 días${impact}`,
        he: `חשבוניות מזדקנות מעבר ל-60 יום${impact}`,
      },
      cash_cards_expiring: {
        en: `${count} customer cards expiring soon${impact}`,
        es: `${count} tarjetas de clientes por vencer${impact}`,
        he: `${count} כרטיסי לקוחות פגים בקרוב${impact}`,
      },
      cash_refund_pattern: {
        en: `refund rate is ${value}%${impact}`,
        es: `tasa de reembolso es ${value}%${impact}`,
        he: `שיעור ההחזרים הוא ${value}%${impact}`,
      },
      pricing_discount_abuse: {
        en: `${value}% of transactions are discounted${impact}`,
        es: `${value}% de transacciones con descuento${impact}`,
        he: `${value}% מהעסקאות בהנחה${impact}`,
      },
      pricing_intro_offer_stuck: {
        en: `only ${value}% of intro users convert to full price${impact}`,
        es: `solo ${value}% de usuarios intro convierten a precio completo${impact}`,
        he: `רק ${value}% מלקוחות מבצע ההיכרות עוברים למחיר מלא${impact}`,
      },
      ops_service_performance: {
        en: `${count} services underperforming${impact}`,
        es: `${count} servicios con bajo rendimiento${impact}`,
        he: `${count} שירותים בביצועים נמוכים${impact}`,
      },
      ops_peak_unutilized: {
        en: `peak hours are ${100 - value}% unutilized${impact}`,
        es: `horas pico están ${100 - value}% sin utilizar${impact}`,
        he: `שעות השיא ${100 - value}% ריקות${impact}`,
      },
    };

    // Handle payment issues separately (has sub-types)
    if (result.detectorId === 'cash_payment_issues') {
      const issueType = (result.processParameters?.issue_type as string) || 'failed';
      const labels: Record<string, Record<SupportedLanguage, string>> = {
        failed: { en: 'failed payments', es: 'pagos fallidos', he: 'תשלומים נכשלו' },
        pending: { en: 'pending payments', es: 'pagos pendientes', he: 'תשלומים ממתינים' },
        refunded: { en: 'refunds', es: 'reembolsos', he: 'החזרים' },
      };
      const label = labels[issueType]?.[lang] || labels.failed[lang];
      return `${count} ${label}${impact}`;
    }

    // Return localized summary or default
    const summary = summaries[result.detectorId];
    if (summary) {
      return summary[lang];
    }

    // Default fallback
    const defaults: Record<SupportedLanguage, string> = {
      en: `${count} issues detected${impact}`,
      es: `${count} problemas detectados${impact}`,
      he: `${count} בעיות זוהו${impact}`,
    };
    return defaults[lang];
  }

  /**
   * Create a correlated insight from a pattern match
   */
  private createCorrelatedInsight(match: PatternMatch): CorrelatedInsight {
    return {
      id: `corr_${match.pattern.id}_${Date.now()}`,
      patternId: match.pattern.id,
      patternName: match.pattern.name,
      category: match.pattern.category,
      severity: match.combinedSeverity,
      story: match.story,
      action: match.action,
      totalImpactUsd: match.totalImpactUsd,
      impactDirection: 'loss',
      contributingInsights: match.matchedResults.map((r) => ({
        detectorId: r.detectorId,
        detectorName: r.detectorId.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        severity: r.severity,
        summary: this.getResultSummary(r),
        impactUsd: r.estimatedImpactUsd || 0,
      })),
      detectedAt: new Date(),
      priority: match.pattern.priority + (SEVERITY_ORDER[match.combinedSeverity] * 10),
    };
  }

  /**
   * Format currency for display based on locale
   */
  private formatCurrency(amount: number): string {
    const localeMap: Record<SupportedLanguage, string> = {
      en: 'en-US',
      es: 'es-ES',
      he: 'he-IL',
    };

    return new Intl.NumberFormat(localeMap[this.locale.language], {
      style: 'currency',
      currency: this.locale.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }

  /**
   * Get all available patterns
   */
  getPatterns(): CorrelationPattern[] {
    return this.patterns;
  }

  /**
   * Get a pattern by ID
   */
  getPattern(patternId: string): CorrelationPattern | undefined {
    return this.patterns.find((p) => p.id === patternId);
  }
}

// Singleton instance
let correlationEngineInstance: InsightCorrelationEngine | null = null;

/**
 * Get the correlation engine instance
 */
export function getCorrelationEngine(): InsightCorrelationEngine {
  if (!correlationEngineInstance) {
    correlationEngineInstance = new InsightCorrelationEngine();
  }
  return correlationEngineInstance;
}
