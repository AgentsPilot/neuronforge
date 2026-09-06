/**
 * Vertical-specific configuration for personalized business insights
 *
 * Maps business verticals (therapist, lawyer, coach, etc.) to:
 * - Terminology mappings (replace jargon with plain language)
 * - Tone guidelines for LLM prompts
 * - Translation keys for advisor badges
 */

export interface VerticalConfig {
  vertical: string;
  advisorBadgeKey: string; // Translation key for advisor badge
  toneGuidelines: string; // Instructions for LLM tone
  terminologyMap: Record<string, string>; // Generic term -> Vertical-specific term
}

/**
 * Configuration for each supported vertical
 */
const VERTICAL_CONFIGS: Record<string, VerticalConfig> = {
  therapist: {
    vertical: 'therapist',
    advisorBadgeKey: 'myday.insight.advisor.badge.therapist',
    toneGuidelines: 'Use warm, empathetic language appropriate for a mental health professional. Focus on client relationships and wellbeing.',
    terminologyMap: {
      customer: 'client',
      customers: 'clients',
      lead: 'potential client',
      leads: 'potential clients',
      pipeline: 'client journey',
      'sales pipeline': 'client journey',
      conversion: 'client engagement',
      'conversion rate': 'engagement rate',
      revenue: 'practice income',
      sales: 'client appointments',
      transaction: 'session',
      transactions: 'sessions',
      booking: 'appointment',
      bookings: 'appointments',
      funnel: 'client process',
      ROI: 'return on investment',
    }
  },

  psychologist: {
    vertical: 'psychologist',
    advisorBadgeKey: 'myday.insight.advisor.badge.psychologist',
    toneGuidelines: 'Use warm, empathetic language appropriate for a mental health professional. Focus on client relationships and wellbeing.',
    terminologyMap: {
      customer: 'client',
      customers: 'clients',
      lead: 'potential client',
      leads: 'potential clients',
      pipeline: 'client journey',
      'sales pipeline': 'client journey',
      conversion: 'client engagement',
      'conversion rate': 'engagement rate',
      revenue: 'practice income',
      sales: 'client appointments',
      transaction: 'session',
      transactions: 'sessions',
      booking: 'appointment',
      bookings: 'appointments',
      funnel: 'client process',
      ROI: 'return on investment',
    }
  },

  lawyer: {
    vertical: 'lawyer',
    advisorBadgeKey: 'myday.insight.advisor.badge.lawyer',
    toneGuidelines: 'Use professional but approachable language appropriate for a legal practice. Focus on client service and case management.',
    terminologyMap: {
      customer: 'client',
      customers: 'clients',
      lead: 'potential client',
      leads: 'potential clients',
      pipeline: 'client intake process',
      'sales pipeline': 'case pipeline',
      conversion: 'client onboarding',
      'conversion rate': 'client acceptance rate',
      revenue: 'firm income',
      sales: 'consultations',
      transaction: 'consultation',
      transactions: 'consultations',
      booking: 'consultation',
      bookings: 'consultations',
      funnel: 'intake process',
      ROI: 'return on investment',
    }
  },

  coach: {
    vertical: 'coach',
    advisorBadgeKey: 'myday.insight.advisor.badge.coach',
    toneGuidelines: 'Use motivational, supportive language appropriate for a coaching practice. Focus on client transformation and progress.',
    terminologyMap: {
      customer: 'client',
      customers: 'clients',
      lead: 'potential client',
      leads: 'potential clients',
      pipeline: 'coaching journey',
      'sales pipeline': 'client journey',
      conversion: 'client commitment',
      'conversion rate': 'commitment rate',
      revenue: 'coaching income',
      sales: 'client enrollments',
      transaction: 'session',
      transactions: 'sessions',
      booking: 'session',
      bookings: 'sessions',
      funnel: 'enrollment process',
      ROI: 'return on investment',
    }
  },

  consultant: {
    vertical: 'consultant',
    advisorBadgeKey: 'myday.insight.advisor.badge.consultant',
    toneGuidelines: 'Use strategic, clear language appropriate for a consulting practice. Focus on client value and project delivery.',
    terminologyMap: {
      customer: 'client',
      customers: 'clients',
      lead: 'potential client',
      leads: 'potential clients',
      pipeline: 'client engagement process',
      'sales pipeline': 'client pipeline',
      conversion: 'client acquisition',
      'conversion rate': 'acquisition rate',
      revenue: 'consulting income',
      sales: 'client projects',
      transaction: 'engagement',
      transactions: 'engagements',
      booking: 'meeting',
      bookings: 'meetings',
      funnel: 'engagement process',
      ROI: 'return on investment',
    }
  },

  makeup_artist: {
    vertical: 'makeup_artist',
    advisorBadgeKey: 'myday.insight.advisor.badge.salon',
    toneGuidelines: 'Use friendly, creative language appropriate for a beauty professional. Focus on client satisfaction and bookings.',
    terminologyMap: {
      customer: 'client',
      customers: 'clients',
      lead: 'potential client',
      leads: 'potential clients',
      pipeline: 'booking flow',
      'sales pipeline': 'booking flow',
      conversion: 'booking completion',
      'conversion rate': 'booking rate',
      revenue: 'service income',
      sales: 'bookings',
      transaction: 'service',
      transactions: 'services',
      booking: 'appointment',
      bookings: 'appointments',
      funnel: 'booking process',
      ROI: 'return on investment',
    }
  },

  salon: {
    vertical: 'salon',
    advisorBadgeKey: 'myday.insight.advisor.badge.salon',
    toneGuidelines: 'Use friendly, welcoming language appropriate for a salon. Focus on client satisfaction and appointments.',
    terminologyMap: {
      customer: 'client',
      customers: 'clients',
      lead: 'potential client',
      leads: 'potential clients',
      pipeline: 'booking flow',
      'sales pipeline': 'booking flow',
      conversion: 'booking completion',
      'conversion rate': 'booking rate',
      revenue: 'service income',
      sales: 'bookings',
      transaction: 'service',
      transactions: 'services',
      booking: 'appointment',
      bookings: 'appointments',
      funnel: 'booking process',
      ROI: 'return on investment',
    }
  },
};

/**
 * Default configuration for unknown or generic verticals
 */
const DEFAULT_CONFIG: VerticalConfig = {
  vertical: 'generic',
  advisorBadgeKey: 'myday.insight.advisor.badge.default',
  toneGuidelines: 'Use clear, professional language appropriate for a solo business owner.',
  terminologyMap: {}
};

/**
 * Get configuration for a specific vertical
 * Returns default config if vertical is unknown
 */
export function getVerticalConfig(vertical: string | null | undefined): VerticalConfig {
  if (!vertical) return DEFAULT_CONFIG;
  return VERTICAL_CONFIGS[vertical] || DEFAULT_CONFIG;
}

/**
 * Build terminology instruction for LLM prompt
 * Creates a string explaining what terms to replace for the given vertical
 */
export function buildTerminologyInstruction(vertical: string | null | undefined, language: string): string {
  const config = getVerticalConfig(vertical);

  if (Object.keys(config.terminologyMap).length === 0) {
    return '';
  }

  const replacements = Object.entries(config.terminologyMap)
    .slice(0, 8) // Limit to most important replacements to keep prompt concise
    .map(([generic, specific]) => `"${generic}" → "${specific}"`)
    .join(', ');

  if (language === 'he') {
    return `CRITICAL: NO business jargon. Use everyday Hebrew like talking to a friend over coffee. Replace technical terms with simple language: ${replacements}. Speak conversationally, not formally.`;
  }

  return `IMPORTANT: Use plain language for solo business owners. Replace technical terms: ${replacements}.`;
}

/**
 * Get vertical-appropriate descriptor for business owner
 * E.g., "therapist" → "solo practitioner", "lawyer" → "solo attorney"
 */
export function getVerticalDescriptor(vertical: string | null | undefined, companySize: string | null | undefined): string {
  if (!vertical) return 'solo business owner';

  const isSolo = !companySize || companySize === 'solo';

  const descriptors: Record<string, { solo: string; team: string }> = {
    therapist: { solo: 'solo therapist', team: 'therapy practice owner' },
    psychologist: { solo: 'solo psychologist', team: 'psychology practice owner' },
    lawyer: { solo: 'solo attorney', team: 'law firm owner' },
    coach: { solo: 'solo coach', team: 'coaching practice owner' },
    consultant: { solo: 'solo consultant', team: 'consulting firm owner' },
    makeup_artist: { solo: 'solo makeup artist', team: 'beauty business owner' },
    salon: { solo: 'salon owner', team: 'salon owner' },
  };

  const descriptor = descriptors[vertical];
  if (!descriptor) return 'solo business owner';

  return isSolo ? descriptor.solo : descriptor.team;
}
