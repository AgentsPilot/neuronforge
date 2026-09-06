/**
 * OnboardingConfigurationService
 *
 * Computes the full Business OS configuration from onboarding chat extracted data.
 * Takes raw LLM extractions and determines:
 * - Which capabilities to activate
 * - Which building blocks within each capability
 * - CRM pipeline stages based on vertical
 * - Online presence mode (full website, booking only, etc.)
 * - Payment mode (upfront, invoicing, installments)
 *
 * This is the "brain" that transforms user conversation into platform configuration.
 */

import { createLogger } from '@/lib/logger';
import { STAGE_TRANSLATIONS } from '@/lib/business-os/stageLabels';
import { getVerticalLabel } from '@/lib/business-os/verticalLabels';

const logger = createLogger({ service: 'OnboardingConfigurationService' });

// ============================================================
// TYPES
// ============================================================

export type PricingModel = 'fixed' | 'custom' | 'free' | 'mixed';
export type PaymentTiming = 'before' | 'after' | 'installments' | 'none';
export type BookingMethod = 'online' | 'manual' | 'both';
export type OnlinePresenceMode = 'full_website' | 'booking_only' | 'website_only' | 'none';
export type PaymentMode = 'none' | 'upfront' | 'invoicing' | 'installments';

export interface ExtractedService {
  name: string;
  duration_minutes?: number | null;
  price?: number | null;
  /**
   * Two facts that decide this service's client journey, and with it what the
   * setup must ask for. Both belong to the service: one business can sell an
   * appointment paid by card and a programme billed against an invoice, and
   * only the first of those needs a card processor connected.
   */
  is_scheduled?: boolean;
  collection?: 'online' | 'invoice' | null;
  /**
   * What they wrote the price in, when they wrote it — never inferred from the
   * language they are speaking. A Hebrew-speaking practice serving clients
   * abroad charges in dollars, and guessing from the interface language put the
   * wrong symbol on every price it had.
   */
  currency?: string | null;
  /**
   * Paid off over time — "3 monthly payments of 200".
   *
   * Defined per service because that is how the platform stores it: a
   * `payment_plans` row hangs off a service and describes the offer. Naming one
   * in the chat is the same act as building one in the service settings, so it
   * should not require going there afterwards to say what was already said.
   */
  payment_plan?: {
    installment_count: number;
    installment_frequency: 'weekly' | 'biweekly' | 'monthly';
  } | null;
}

export interface BusinessStoryExtraction {
  company_name?: string;
  vertical?: string;
  sub_vertical?: string;  // More specific: parenting_coach, life_coach, tutor, etc.
  description?: string;
  pain_points?: string[];
  goals?: string[];
  tools?: string[];
  clients_per_week?: number;
  needs_website?: boolean;
  needs_booking?: boolean;
  target_audience?: string[];  // Who they serve: parents, kids, families, businesses
}

export interface ClientWorkflowExtraction {
  services?: ExtractedService[];
  pricing_model?: PricingModel;
  payment_timing?: PaymentTiming;
  booking_method?: BookingMethod;
  /**
   * How the money physically reaches them — the question `payment_timing` was
   * being made to answer and could not. Null when they did not say, which is
   * respected rather than guessed: a price says nothing about collection, and
   * assuming cards demands a Stripe account from a business taking transfers.
   */
  collection_method?: CollectionMethod | null;
  /**
   * Clients fill in a form before their appointment.
   *
   * One answer for the business rather than one per service, because that is
   * how the platform stores it: a single `user_intake_settings` row with a
   * template. What the form asks is theirs to choose, which is why the build
   * hands it back as work only they can do rather than inventing questions for
   * their clients.
   */
  needs_intake?: boolean;
  needs_more_details?: boolean;
}

/** How the money physically reaches the business. */
export type CollectionMethod = 'card_online' | 'invoice' | 'in_person' | 'mixed' | 'none';

// NEW: Q4 - What digital tools do you need? (multi-select)
export interface ClientAcquisitionExtraction {
  acquisition_channels?: string[];  // website, email_campaigns, social_media
  /** Null when the answer does not say — declining our website is not the
   *  same as having none of their own. */
  has_website?: boolean | null;
  website_quality?: 'good' | 'outdated' | 'basic' | null;
  wants_more_clients_online?: boolean;
  primary_channel?: string;
  needs_website?: boolean;       // User selected "Professional website"
  /**
   * They want the accounts they already have connected — Facebook, Instagram,
   * Google — so the dashboard can report where clients came from.
   *
   * Replaces `needs_campaigns` and `needs_social_media`, which offered to run
   * campaigns and build a social presence. The platform does neither: it reads
   * those channels, it does not write to them.
   */
  needs_channel_insights?: boolean;
}

// NEW: Q5 - How do you track clients?
export interface ClientTrackingExtraction {
  current_method?: 'spreadsheet' | 'paper' | 'memory' | 'existing_crm' | 'notes_app' | 'nothing';
  current_tools?: string[];
  tracks_progress?: boolean;
  has_existing_crm?: boolean;
  volume_hint?: number;
  needs_crm?: boolean;      // Computed recommendation
  needs_pipeline?: boolean; // Computed recommendation
}

export interface ExtractedData extends BusinessStoryExtraction, ClientWorkflowExtraction {
  clientAcquisition?: ClientAcquisitionExtraction;
  clientTracking?: ClientTrackingExtraction;
}

export type StageType = 'lead' | 'prospect' | 'client' | 'past_client' | 'lost' | 'archived';

export interface PipelineStage {
  stage_key: string;
  stage_label: string;
  position: number;
  color: string;
  stage_type?: StageType;
  is_primary_client_stage?: boolean;
}

export interface InferredConfiguration {
  // Profile
  company_name: string;
  vertical: string;
  sub_vertical?: string;  // NEW: More specific vertical type
  description?: string;
  clients_per_week: number;

  // Pain points & goals (stored for future re-evaluation)
  pain_points: string[];
  goals: string[];
  tools: string[];

  // Services
  services: ExtractedService[];

  // Online Presence Mode
  online_presence_mode: OnlinePresenceMode;

  // Payment Configuration
  payment_mode: PaymentMode;
  /** How the money reaches them. Decides whether Stripe is ever mentioned. */
  collection_method: CollectionMethod;
  needs_stripe_connect: boolean;
  /** Clients fill in a form before their appointment. */
  needs_intake: boolean;

  // CRM Configuration
  pipeline_stages: PipelineStage[];

  // Computed capabilities to activate
  capabilities: string[];
  building_blocks: Record<string, string[]>;

  // Reasons for each capability (for preview transparency)
  capability_reasons: Record<string, string>;
}

// ============================================================
// VERTICAL NORMALIZATION
// ============================================================

/**
 * Maps LLM-extracted verticals to template-compatible verticals.
 * Templates use specific verticals: therapist, coach, consultant, lawyer,
 * photographer, realtor, trainer, tutor.
 * This ensures the vertical stored in business_profiles matches templates.
 */
const VERTICAL_NORMALIZATION: Record<string, string> = {
  // Teacher-related → tutor (templates use 'tutor')
  teacher: 'tutor',
  educator: 'tutor',
  instructor: 'tutor',

  // Wellness/health-related → therapist
  wellness: 'therapist',
  healthcare: 'therapist',
  mental_health: 'therapist',
  counselor: 'therapist',

  // Beauty → beauty (own vertical with portfolio-focused templates)
  beauty: 'beauty',
  makeup_artist: 'beauty',
  makeup: 'beauty',
  esthetician: 'beauty',
  nail_tech: 'beauty',
  hairdresser: 'beauty',
  hairstylist: 'beauty',
  barber: 'beauty',
  spa: 'beauty',
  salon: 'beauty',
  cosmetologist: 'beauty',

  // Fitness → trainer
  fitness: 'trainer',
  personal_trainer: 'trainer',

  // Design-related → photographer
  designer: 'photographer',
  creative: 'photographer',

  // Finance-related → consultant
  accountant: 'consultant',
  financial_advisor: 'consultant',

  // Real estate
  real_estate: 'realtor',
  real_estate_agent: 'realtor',

  // These are already valid template verticals (no mapping needed):
  // therapist, coach, consultant, lawyer, photographer, realtor, trainer, tutor
};

/**
 * Normalize a vertical to match template-compatible verticals.
 * Returns the original if already valid or no mapping exists.
 */
function normalizeVertical(vertical: string): string {
  const normalized = VERTICAL_NORMALIZATION[vertical.toLowerCase()];
  return normalized || vertical;
}

// ============================================================
// PIPELINE PRESETS BY VERTICAL
// ============================================================

// Pipeline presets are stored as keys with translations applied at render time
// This maps vertical -> array of stage configs
// Each stage includes stage_type for semantic classification and is_primary_client_stage for auto-promotion
const PIPELINE_PRESETS: Record<string, PipelineStage[]> = {
  therapist: [
    { stage_key: 'inquiry', stage_label: 'Inquiry', position: 0, color: '#94a3b8', stage_type: 'lead' },
    { stage_key: 'intake', stage_label: 'Intake', position: 1, color: '#60a5fa', stage_type: 'prospect' },
    { stage_key: 'active_client', stage_label: 'Active Client', position: 2, color: '#10b981', stage_type: 'client', is_primary_client_stage: true },
    { stage_key: 'completed', stage_label: 'Completed', position: 3, color: '#8b5cf6', stage_type: 'past_client' },
    { stage_key: 'inactive', stage_label: 'Inactive', position: 4, color: '#6b7280', stage_type: 'past_client' },
  ],
  coach: [
    { stage_key: 'lead', stage_label: 'Lead', position: 0, color: '#94a3b8', stage_type: 'lead' },
    { stage_key: 'discovery_call', stage_label: 'Discovery Call', position: 1, color: '#60a5fa', stage_type: 'prospect' },
    { stage_key: 'proposal', stage_label: 'Proposal', position: 2, color: '#f59e0b', stage_type: 'prospect' },
    { stage_key: 'active_client', stage_label: 'Active Client', position: 3, color: '#10b981', stage_type: 'client', is_primary_client_stage: true },
    { stage_key: 'completed', stage_label: 'Completed', position: 4, color: '#6b7280', stage_type: 'past_client' },
  ],
  teacher: [
    { stage_key: 'inquiry', stage_label: 'Inquiry', position: 0, color: '#94a3b8', stage_type: 'lead' },
    { stage_key: 'consultation', stage_label: 'Consultation', position: 1, color: '#60a5fa', stage_type: 'prospect' },
    { stage_key: 'enrolled', stage_label: 'Enrolled', position: 2, color: '#10b981', stage_type: 'client', is_primary_client_stage: true },
    { stage_key: 'active_student', stage_label: 'Active Student', position: 3, color: '#f59e0b', stage_type: 'client' },
    { stage_key: 'completed', stage_label: 'Completed', position: 4, color: '#6b7280', stage_type: 'past_client' },
  ],
  consultant: [
    { stage_key: 'lead', stage_label: 'Lead', position: 0, color: '#94a3b8', stage_type: 'lead' },
    { stage_key: 'qualified', stage_label: 'Qualified', position: 1, color: '#60a5fa', stage_type: 'prospect' },
    { stage_key: 'proposal', stage_label: 'Proposal', position: 2, color: '#f59e0b', stage_type: 'prospect' },
    { stage_key: 'negotiation', stage_label: 'Negotiation', position: 3, color: '#f97316', stage_type: 'prospect' },
    { stage_key: 'active_project', stage_label: 'Active Project', position: 4, color: '#10b981', stage_type: 'client', is_primary_client_stage: true },
    { stage_key: 'completed', stage_label: 'Completed', position: 5, color: '#6b7280', stage_type: 'past_client' },
  ],
  lawyer: [
    { stage_key: 'inquiry', stage_label: 'Inquiry', position: 0, color: '#94a3b8', stage_type: 'lead' },
    { stage_key: 'consultation', stage_label: 'Consultation', position: 1, color: '#60a5fa', stage_type: 'prospect' },
    { stage_key: 'retained', stage_label: 'Retained', position: 2, color: '#10b981', stage_type: 'client', is_primary_client_stage: true },
    { stage_key: 'active_case', stage_label: 'Active Case', position: 3, color: '#f59e0b', stage_type: 'client' },
    { stage_key: 'closed', stage_label: 'Closed', position: 4, color: '#6b7280', stage_type: 'past_client' },
  ],
  wellness: [
    { stage_key: 'inquiry', stage_label: 'Inquiry', position: 0, color: '#94a3b8', stage_type: 'lead' },
    { stage_key: 'first_session', stage_label: 'First Session', position: 1, color: '#60a5fa', stage_type: 'prospect' },
    { stage_key: 'regular_client', stage_label: 'Regular Client', position: 2, color: '#10b981', stage_type: 'client', is_primary_client_stage: true },
    { stage_key: 'inactive', stage_label: 'Inactive', position: 3, color: '#6b7280', stage_type: 'past_client' },
  ],
  beauty: [
    { stage_key: 'new_client', stage_label: 'New Client', position: 0, color: '#94a3b8', stage_type: 'lead' },
    { stage_key: 'regular', stage_label: 'Regular', position: 1, color: '#10b981', stage_type: 'client', is_primary_client_stage: true },
    { stage_key: 'vip', stage_label: 'VIP', position: 2, color: '#f59e0b', stage_type: 'client' },
    { stage_key: 'inactive', stage_label: 'Inactive', position: 3, color: '#6b7280', stage_type: 'past_client' },
  ],
  fitness: [
    { stage_key: 'trial', stage_label: 'Trial', position: 0, color: '#94a3b8', stage_type: 'prospect' },
    { stage_key: 'member', stage_label: 'Member', position: 1, color: '#10b981', stage_type: 'client', is_primary_client_stage: true },
    { stage_key: 'premium', stage_label: 'Premium', position: 2, color: '#f59e0b', stage_type: 'client' },
    { stage_key: 'churned', stage_label: 'Churned', position: 3, color: '#6b7280', stage_type: 'past_client' },
  ],
  default: [
    { stage_key: 'lead', stage_label: 'Lead', position: 0, color: '#94a3b8', stage_type: 'lead' },
    { stage_key: 'qualified', stage_label: 'Qualified', position: 1, color: '#60a5fa', stage_type: 'prospect' },
    { stage_key: 'customer', stage_label: 'Customer', position: 2, color: '#10b981', stage_type: 'client', is_primary_client_stage: true },
    { stage_key: 'inactive', stage_label: 'Inactive', position: 3, color: '#6b7280', stage_type: 'past_client' },
  ],
};

// Sub-vertical specific pipeline presets (more specific than vertical)
// Each stage includes stage_type for semantic classification
const SUB_VERTICAL_PIPELINES: Record<string, PipelineStage[]> = {
  parenting_coach: [
    { stage_key: 'inquiry', stage_label: 'Inquiry', position: 0, color: '#94a3b8', stage_type: 'lead' },
    { stage_key: 'initial_consultation', stage_label: 'Initial Consultation', position: 1, color: '#60a5fa', stage_type: 'prospect' },
    { stage_key: 'family_enrolled', stage_label: 'Family Enrolled', position: 2, color: '#10b981', stage_type: 'client', is_primary_client_stage: true },
    { stage_key: 'in_progress', stage_label: 'In Progress', position: 3, color: '#f59e0b', stage_type: 'client' },
    { stage_key: 'completed', stage_label: 'Completed', position: 4, color: '#6b7280', stage_type: 'past_client' },
  ],
  life_coach: [
    { stage_key: 'lead', stage_label: 'Lead', position: 0, color: '#94a3b8', stage_type: 'lead' },
    { stage_key: 'discovery_call', stage_label: 'Discovery Call', position: 1, color: '#60a5fa', stage_type: 'prospect' },
    { stage_key: 'proposal', stage_label: 'Proposal', position: 2, color: '#f59e0b', stage_type: 'prospect' },
    { stage_key: 'active_client', stage_label: 'Active Client', position: 3, color: '#10b981', stage_type: 'client', is_primary_client_stage: true },
    { stage_key: 'completed', stage_label: 'Completed', position: 4, color: '#6b7280', stage_type: 'past_client' },
  ],
  business_coach: [
    { stage_key: 'lead', stage_label: 'Lead', position: 0, color: '#94a3b8', stage_type: 'lead' },
    { stage_key: 'consultation', stage_label: 'Consultation', position: 1, color: '#60a5fa', stage_type: 'prospect' },
    { stage_key: 'proposal', stage_label: 'Proposal', position: 2, color: '#f59e0b', stage_type: 'prospect' },
    { stage_key: 'active_engagement', stage_label: 'Active Engagement', position: 3, color: '#10b981', stage_type: 'client', is_primary_client_stage: true },
    { stage_key: 'completed', stage_label: 'Completed', position: 4, color: '#6b7280', stage_type: 'past_client' },
  ],
  tutor: [
    { stage_key: 'inquiry', stage_label: 'Inquiry', position: 0, color: '#94a3b8', stage_type: 'lead' },
    { stage_key: 'assessment', stage_label: 'Assessment', position: 1, color: '#60a5fa', stage_type: 'prospect' },
    { stage_key: 'active_student', stage_label: 'Active Student', position: 2, color: '#10b981', stage_type: 'client', is_primary_client_stage: true },
    { stage_key: 'completed', stage_label: 'Completed', position: 3, color: '#6b7280', stage_type: 'past_client' },
  ],
  workshop_leader: [
    { stage_key: 'interested', stage_label: 'Interested', position: 0, color: '#94a3b8', stage_type: 'lead' },
    { stage_key: 'registered', stage_label: 'Registered', position: 1, color: '#60a5fa', stage_type: 'prospect' },
    { stage_key: 'attended', stage_label: 'Attended', position: 2, color: '#10b981', stage_type: 'client', is_primary_client_stage: true },
    { stage_key: 'follow_up', stage_label: 'Follow Up', position: 3, color: '#f59e0b', stage_type: 'prospect' },
  ],
};

// Stage label translations by stage_key

// ============================================================
// PAIN POINT TO CAPABILITY/BUILDING BLOCK MAPPINGS
// ============================================================

const PAIN_POINT_CAPABILITIES: Record<string, { capabilities: string[]; blocks: Record<string, string[]> }> = {
  no_shows: {
    capabilities: ['scheduling', 'email_automation'],
    blocks: { scheduling: ['automated_reminders'], email_automation: ['reminder_emails'] },
  },
  manual_reminders: {
    capabilities: ['email_automation', 'automations'],
    blocks: { email_automation: ['automated_reminders'], automations: ['reminder_triggers'] },
  },
  payment_collection: {
    capabilities: ['payments'],
    blocks: { payments: ['online_payments', 'payment_reminders', 'auto_invoicing'] },
  },
  admin_overhead: {
    capabilities: ['automations', 'scheduling'],
    blocks: { scheduling: ['booking_widget'], automations: ['workflow_automation'] },
  },
  client_tracking: {
    capabilities: ['crm'],
    blocks: { crm: ['pipeline_stages', 'activity_log', 'tags_segments'] },
  },
  no_website: {
    capabilities: ['website'],
    blocks: { website: ['homepage', 'seo_optimization'] },
  },
  scheduling_chaos: {
    capabilities: ['scheduling'],
    blocks: { scheduling: ['availability_calendar', 'booking_widget', 'google_calendar_sync'] },
  },
  follow_up: {
    capabilities: ['crm', 'email_automation'],
    blocks: { crm: ['follow_up_tasks'], email_automation: ['follow_up_sequences'] },
  },
  retention: {
    capabilities: ['crm', 'insights'],
    blocks: { crm: ['tags_segments'], insights: ['retention_analytics'] },
  },
};

// ============================================================
// GOAL TO CAPABILITY/BUILDING BLOCK MAPPINGS
// ============================================================

const GOAL_CAPABILITIES: Record<string, { capabilities: string[]; blocks: Record<string, string[]> }> = {
  grow_clients: {
    capabilities: ['website', 'campaigns'],
    blocks: { website: ['lead_capture', 'seo_optimization'], campaigns: ['email_campaigns'] },
  },
  save_time: {
    capabilities: ['automations', 'scheduling'],
    blocks: { scheduling: ['booking_widget', 'automated_reminders'], automations: ['workflow_automation'] },
  },
  automation: {
    capabilities: ['automations', 'email_automation'],
    blocks: { automations: ['workflow_triggers', 'automated_actions'] },
  },
  professional_image: {
    capabilities: ['website', 'payments'],
    blocks: { website: ['custom_theme'], payments: ['branded_invoices'] },
  },
  online_presence: {
    capabilities: ['website'],
    blocks: { website: ['homepage', 'booking_widget', 'seo_optimization'] },
  },
  grow_revenue: {
    capabilities: ['payments', 'reports'],
    blocks: { payments: ['packages', 'upsells'], reports: ['revenue_reports'] },
  },
  retain_clients: {
    capabilities: ['crm', 'email_automation'],
    blocks: { crm: ['tags_segments', 'follow_up_tasks'], email_automation: ['retention_campaigns'] },
  },
};

// ============================================================
// ONBOARDING CONFIGURATION SERVICE
// ============================================================

export class OnboardingConfigurationService {
  /**
   * Compute full Business OS configuration from extracted data
   * @param extracted - Data extracted from onboarding conversation
   * @param language - User's selected language for pipeline stage labels
   */
  computeConfiguration(extracted: ExtractedData, language: 'en' | 'he' | 'es' = 'en'): InferredConfiguration {
    // Normalize the vertical to match template-compatible verticals
    const rawVertical = extracted.vertical || 'default';
    const vertical = normalizeVertical(rawVertical);
    const subVertical = extracted.sub_vertical;

    logger.info(
      {
        company_name: extracted.company_name,
        raw_vertical: rawVertical,
        normalized_vertical: vertical,
        sub_vertical: subVertical,
        language
      },
      'Computing configuration from extracted data'
    );
    const clientsPerWeek = extracted.clients_per_week || 5;
    const painPoints = extracted.pain_points || [];
    const goals = extracted.goals || [];
    const tools = extracted.tools || [];
    const services = extracted.services || [];

    // Compute each aspect
    const onlinePresenceMode = this.computeOnlinePresenceMode(extracted);
    const paymentMode = this.computePaymentMode(extracted);
    const collectionMethod = this.computeCollectionMethod(extracted, paymentMode);
    const { capabilities, buildingBlocks, reasons } = this.computeCapabilitiesAndBlocks(extracted);

    // Check if CRM capability was added (if not, don't include pipeline)
    // CRM is added in computeCapabilitiesAndBlocks based on clientTracking.needs_crm
    const hasCrmCapability = capabilities.includes('crm');

    const config: InferredConfiguration = {
      // Profile
      company_name: extracted.company_name || 'My Business',
      vertical,
      sub_vertical: subVertical,
      description: extracted.description,
      clients_per_week: clientsPerWeek,

      // Pain points & goals
      pain_points: painPoints,
      goals,
      tools,

      // Services
      services,

      // Online Presence
      online_presence_mode: onlinePresenceMode,

      // Payment
      payment_mode: paymentMode,
      collection_method: collectionMethod,
      // A processor is needed only where cards are actually taken. This used to
      // be `paymentMode !== 'none'`, which asked every business that charges
      // anything at all to open a Stripe account — including the ones that
      // invoice and take a bank transfer.
      // Read off the services, never asked. A processor is needed when some
      // service is collected online — a practice that takes a card for a
      // session and invoices for a programme needs one; a consultancy that
      // invoices for everything never does. The business-wide
      // `collection_method` above is kept as a summary for older readers, but
      // it is not what decides this any more.
      needs_stripe_connect: services.some(service => service.collection === 'online'),
      needs_intake: extracted.needs_intake === true,

      // CRM - Only include pipeline if CRM capability is being added
      // Pipeline stages help organize client journey tracking
      pipeline_stages: hasCrmCapability ? this.getTranslatedPipeline(vertical, language, subVertical) : [],

      // Capabilities
      capabilities,
      building_blocks: buildingBlocks,
      capability_reasons: reasons,
    };

    logger.info(
      {
        capabilities: config.capabilities,
        online_presence_mode: config.online_presence_mode,
        payment_mode: config.payment_mode,
        sub_vertical: config.sub_vertical,
      },
      'Configuration computed'
    );

    return config;
  }

  /**
   * Compute online presence mode based on extracted data
   * UPDATED: Now uses clientAcquisition extraction (Q4) instead of assuming from services
   */
  private computeOnlinePresenceMode(data: ExtractedData): OnlinePresenceMode {
    const hasScheduledServices = data.services?.some(s => s.is_scheduled !== false && s.duration_minutes);
    const needsBooking = data.needs_booking === true || hasScheduledServices;

    // PRIORITY 1: Use explicit clientAcquisition extraction (Q4) if available
    if (data.clientAcquisition?.needs_website !== undefined) {
      if (data.clientAcquisition.needs_website === true) {
        return needsBooking ? 'full_website' : 'website_only';
      } else {
        // User explicitly doesn't need website
        return needsBooking ? 'booking_only' : 'none';
      }
    }

    // PRIORITY 2: Fall back to legacy signals (from business_story)
    const explicitlyNeedsWebsite =
      data.needs_website === true ||
      data.pain_points?.includes('no_website') ||
      data.goals?.includes('online_presence') ||
      data.goals?.includes('professional_image');

    const explicitlyNoWebsite = data.needs_website === false;

    if (explicitlyNeedsWebsite && needsBooking) {
      return 'full_website';
    }

    if (explicitlyNeedsWebsite && !needsBooking) {
      return 'website_only';
    }

    if (explicitlyNoWebsite && needsBooking) {
      return 'booking_only';
    }

    // PRIORITY 3: Default to none if we don't have explicit info
    // This is different from before - we don't assume website just because they have services
    return needsBooking ? 'booking_only' : 'none';
  }

  /**
   * Compute payment mode based on extracted data
   */
  private computePaymentMode(data: ExtractedData): PaymentMode {
    // Check if all services are free
    const hasPaidServices = data.services?.some(s => s.price && s.price > 0);

    if (!hasPaidServices) {
      return 'none';
    }

    // Check pricing model and payment timing
    if (data.pricing_model === 'custom') {
      return 'invoicing';
    }

    if (data.payment_timing === 'installments') {
      return 'installments';
    }

    if (data.payment_timing === 'after') {
      return 'invoicing';
    }

    // Default for paid services: upfront
    return 'upfront';
  }

  /**
   * How the money reaches the business.
   *
   * Prefers what they actually said. Falls back on payment timing only as a
   * reading-across for older conversations — "pay to book" almost always meant
   * a card, "invoice after" almost always meant a transfer — and never invents
   * a card processor for a business that simply named a price.
   */
  private computeCollectionMethod(data: ExtractedData, paymentMode: PaymentMode): CollectionMethod {
    if (data.collection_method) return data.collection_method;

    if (paymentMode === 'none') return 'none';

    switch (data.payment_timing) {
      case 'before': return 'card_online';
      case 'after':
      case 'installments': return 'invoice';
      default:
        // Priced, and they never said how. An invoice is the safe assumption:
        // it asks for bank details they already have, rather than sending them
        // through a Stripe identity check they may not need at all.
        return 'invoice';
    }
  }

  /**
   * Get CRM pipeline stages for a vertical/sub-vertical
   * Priority: sub_vertical > vertical > default
   */
  private getPipelineForVertical(vertical: string, subVertical?: string): PipelineStage[] {
    // Check sub-vertical first (more specific)
    if (subVertical && SUB_VERTICAL_PIPELINES[subVertical]) {
      return SUB_VERTICAL_PIPELINES[subVertical];
    }
    // Fall back to vertical
    return PIPELINE_PRESETS[vertical] || PIPELINE_PRESETS.default;
  }

  /**
   * Get translated pipeline stages for a vertical/sub-vertical and language
   */
  getTranslatedPipeline(vertical: string, language: 'en' | 'he' | 'es' = 'en', subVertical?: string): PipelineStage[] {
    // Check sub-vertical first (more specific)
    let stages: PipelineStage[];
    if (subVertical && SUB_VERTICAL_PIPELINES[subVertical]) {
      stages = SUB_VERTICAL_PIPELINES[subVertical];
    } else {
      stages = PIPELINE_PRESETS[vertical] || PIPELINE_PRESETS.default;
    }

    return stages.map(stage => ({
      ...stage,
      stage_label: STAGE_TRANSLATIONS[stage.stage_key]?.[language] || stage.stage_label,
    }));
  }

  /**
   * Compute capabilities, building blocks, and reasons
   */
  private computeCapabilitiesAndBlocks(data: ExtractedData): {
    capabilities: string[];
    buildingBlocks: Record<string, string[]>;
    reasons: Record<string, string>;
  } {
    const caps = new Set<string>();
    const blocks: Record<string, Set<string>> = {};
    const reasons: Record<string, string> = {};

    const addCapability = (cap: string, reason: string) => {
      caps.add(cap);
      if (!reasons[cap]) {
        reasons[cap] = reason;
      }
    };

    const addBlock = (cap: string, block: string) => {
      if (!blocks[cap]) {
        blocks[cap] = new Set();
      }
      blocks[cap].add(block);
    };

    // 1. CRM - Now based on clientTracking extraction (Q5) instead of always adding
    if (data.clientTracking?.needs_crm !== undefined) {
      // Use explicit extraction from Q5
      if (data.clientTracking.needs_crm === true) {
        addCapability('crm', 'You need better client tracking');
        addBlock('crm', 'contact_database');
        addBlock('crm', 'activity_log');

        if (data.clientTracking.needs_pipeline) {
          addBlock('crm', 'pipeline_stages');
        }
      }
      // If needs_crm is false, we skip adding CRM entirely
    } else {
      // Fallback: Add CRM if they have services or clients_per_week info
      const hasServices = data.services && data.services.length > 0;
      const hasClients = data.clients_per_week && data.clients_per_week > 0;

      if (hasServices || hasClients) {
        addCapability('crm', 'Core client management');
        addBlock('crm', 'contact_database');
        addBlock('crm', 'activity_log');
      }
    }

    // 2. Add based on services
    if (data.services && data.services.length > 0) {
      addCapability('scheduling', 'You have services to schedule');
      addBlock('scheduling', 'service_menu');
      addBlock('scheduling', 'availability_calendar');

      if (data.booking_method !== 'manual') {
        addBlock('scheduling', 'booking_widget');
      }
    }

    // 3. Add based on payment needs
    // What gets switched on is read off the services, not guessed from a
    // business-wide timing answer.
    //
    // `payment_timing === 'after' || pricing_model === 'custom'` was standing
    // in for "this business invoices". It got that wrong in both directions: a
    // practice taking cards at booking AND billing a programme afterwards
    // matched only the first branch, so invoicing was never switched on for
    // the half of its catalogue that needs it — and the user was later asked
    // to configure invoices for a capability nothing had enabled.
    const pricedServices = (data.services || []).filter(s => s.price && s.price > 0);

    if (pricedServices.length > 0) {
      addCapability('payments', 'You have paid services');

      if (pricedServices.some(s => s.collection === 'online')) {
        addBlock('payments', 'online_payments');
      }
      if (pricedServices.some(s => s.collection === 'invoice')) {
        addBlock('payments', 'invoicing');
      }
      if (pricedServices.some(s => s.payment_plan && s.payment_plan.installment_count >= 2)) {
        addBlock('payments', 'installments');
      }
    }

    // 4. Add based on pain points
    (data.pain_points || []).forEach(pain => {
      const mapping = PAIN_POINT_CAPABILITIES[pain];
      if (mapping) {
        mapping.capabilities.forEach(cap => {
          const readablePain = pain.replace(/_/g, ' ');
          addCapability(cap, `You mentioned "${readablePain}"`);
        });

        Object.entries(mapping.blocks).forEach(([cap, capBlocks]) => {
          capBlocks.forEach(block => addBlock(cap, block));
        });
      }
    });

    // 5. Add based on goals
    (data.goals || []).forEach(goal => {
      const mapping = GOAL_CAPABILITIES[goal];
      if (mapping) {
        const readableGoal = goal.replace(/_/g, ' ');
        mapping.capabilities.forEach(cap => {
          addCapability(cap, `You want to "${readableGoal}"`);
        });

        Object.entries(mapping.blocks).forEach(([cap, capBlocks]) => {
          capBlocks.forEach(block => addBlock(cap, block));
        });
      }
    });

    // 6. Add based on Q4 multi-select (explicit digital tools selection)
    if (data.clientAcquisition?.needs_channel_insights) {
      addCapability('insights', 'You want to see where your clients come from');
      // And the precise one. `insights` is also granted for seeing 5+ clients a
      // week, for a data-analysis goal and by a pain-point mapping, so it can
      // never answer "did this person ask for their accounts to be connected?"
      // — which is the only question the channels card needs answered.
      addCapability('channel_insights', 'You want to connect Facebook, Instagram or Google');
    }

    // 7. Volume-based additions
    const clientsPerWeek = data.clients_per_week || 0;

    if (clientsPerWeek >= 5) {
      addBlock('crm', 'pipeline_stages');
      addCapability('email_automation', `You see ${clientsPerWeek}+ clients/week`);
    }

    if (clientsPerWeek >= 10) {
      addBlock('crm', 'tags_segments');
      addCapability('reports', `You see ${clientsPerWeek}+ clients/week`);
      addCapability('automations', `You see ${clientsPerWeek}+ clients/week`);
    }

    if (clientsPerWeek >= 20) {
      addBlock('scheduling', 'waitlist');
      addCapability('insights', `You see ${clientsPerWeek}+ clients/week`);
    }

    // 8. Dependency-based additions
    if (caps.has('payments')) {
      addCapability('reports', 'Track your revenue');
    }

    if (caps.has('scheduling') || caps.has('payments')) {
      addCapability('insights', 'Analyze your business data');
    }

    // 9. Tool-based additions
    if (data.tools && data.tools.length > 0) {
      if (data.tools.includes('google_calendar')) {
        addBlock('scheduling', 'google_calendar_sync');
      }
      addCapability('integrations', 'Connect your existing tools');
    }

    // Convert Sets to arrays
    const buildingBlocks: Record<string, string[]> = {};
    Object.entries(blocks).forEach(([cap, blockSet]) => {
      buildingBlocks[cap] = Array.from(blockSet);
    });

    return {
      capabilities: Array.from(caps),
      buildingBlocks,
      reasons,
    };
  }

  /**
   * Get human-readable capability names
   */
  getCapabilityDisplayName(capabilityKey: string, language: 'en' | 'he' | 'es' = 'en'): string {
    const names: Record<string, Record<string, string>> = {
      crm: { en: 'Client Management', he: 'ניהול לקוחות', es: 'Gestión de Clientes' },
      scheduling: { en: 'Scheduling & Booking', he: 'יומן והזמנות', es: 'Calendario y Reservas' },
      payments: { en: 'Payments & Invoicing', he: 'תשלומים וחשבוניות', es: 'Pagos y Facturación' },
      website: { en: 'Professional Website', he: 'אתר מקצועי', es: 'Sitio Web Profesional' },
      email_automation: { en: 'Email Automation', he: 'אוטומציה לאימיילים', es: 'Automatización de Emails' },
      reports: { en: 'Reports & Analytics', he: 'דוחות וניתוחים', es: 'Informes y Análisis' },
      insights: { en: 'Business Insights', he: 'תובנות עסקיות', es: 'Perspectivas de Negocio' },
      automations: { en: 'Workflow Automations', he: 'אוטומציות תהליכים', es: 'Automatizaciones de Flujo' },
      campaigns: { en: 'Marketing Campaigns', he: 'קמפיינים שיווקיים', es: 'Campañas de Marketing' },
      integrations: { en: 'Integrations', he: 'אינטגרציות', es: 'Integraciones' },
    };

    return names[capabilityKey]?.[language] || capabilityKey;
  }

  /**
   * Get human-readable vertical names
   * Supports both raw verticals (teacher, wellness) and normalized verticals (tutor, therapist)
   */
  getVerticalDisplayName(vertical: string, language: 'en' | 'he' | 'es' = 'en'): string {
    // The table moved to lib/business-os/verticalLabels so the interface can
    // read it too — the settings page was printing the raw key.
    return getVerticalLabel(vertical, language);
  }
}

// Singleton export
export const onboardingConfigurationService = new OnboardingConfigurationService();
