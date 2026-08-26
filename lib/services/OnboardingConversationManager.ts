/**
 * Onboarding Conversation Manager
 *
 * Manages the state machine and conversation flow for Business OS onboarding.
 * Uses LLM for deep intent understanding and entity extraction through
 * 3-4 smart open-ended questions that capture the full business context.
 *
 * Flow:
 * 1. Language Selection - auto-detect or confirm
 * 2. Business Story - THE KEY QUESTION - extracts vertical, pain_points, goals, volume
 * 3. Client Workflow - services, pricing, payment timing, booking method
 * 4. Preview & Confirm - show computed configuration, allow adjustments
 */

import { getProviderFactory } from '@/lib/ai/providerFactory';
import { createLogger } from '@/lib/logger';
import {
  OnboardingConfigurationService,
  onboardingConfigurationService,
  ExtractedData,
  BusinessStoryExtraction,
  ClientWorkflowExtraction,
  ClientAcquisitionExtraction,
  ClientTrackingExtraction,
  InferredConfiguration,
  PipelineStage,
  ExtractedService,
} from './OnboardingConfigurationService';

const logger = createLogger({ service: 'OnboardingConversationManager' });

// ============================================================
// TYPES
// ============================================================

export type Language = 'en' | 'he' | 'es';

export type OnboardingStep =
  | 'language_selection'
  | 'business_story'
  | 'client_workflow'
  | 'service_details'  // Follow-up when user didn't provide specific service details
  | 'client_acquisition'  // Q4: How do clients find you? (determines website need)
  | 'client_tracking'     // Q5: How do you track clients? (determines CRM need)
  | 'preview'
  | 'preview_adjustment'
  | 'building'
  | 'complete';

export interface Service {
  id?: string;
  service_name: string;
  duration_minutes: number;
  price: number;
  currency: string;
}

export interface OnboardingState {
  currentStep: OnboardingStep;
  collectedData: {
    // From business_story extraction
    businessStory?: BusinessStoryExtraction;
    // From client_workflow extraction
    clientWorkflow?: ClientWorkflowExtraction;
    // From client_acquisition extraction (Q4: How do clients find you?)
    clientAcquisition?: ClientAcquisitionExtraction;
    // From client_tracking extraction (Q5: How do you track clients?)
    clientTracking?: ClientTrackingExtraction;
    // Merged extracted data
    extractedData?: ExtractedData;
    // Computed configuration (generated at preview step)
    configuration?: InferredConfiguration;
    // Legacy fields for backwards compatibility
    businessProfile?: {
      company_name?: string;
      vertical?: string;
      language?: Language;
    };
    pipelineStages?: PipelineStage[];
    services?: Service[];
    businessDescription?: string;
    wantsWebsite?: boolean;
  };
  language: Language;
  pendingQuestion?: string;
  validationErrors?: string[];
}

// ============================================================
// EXTRACTION PROMPTS
// ============================================================

const BUSINESS_STORY_SYSTEM_PROMPT = `You are analyzing a business owner's description of their business.
Extract ALL relevant information from their natural language response.

From their response, identify:
1. company_name - Business name if mentioned (null if not)
2. vertical - Map to ONE broad category: therapist, coach, consultant, lawyer, wellness, beauty, fitness, photographer, designer, accountant, doctor, dentist, teacher, trainer, other
   - "teacher" is for: schools, tutors, parenting coaches, educational consultants, instructors
   - "coach" is for: life coaches, business coaches, personal development, mentors
   - "therapist" is for: psychologists, counselors, mental health professionals
   - "consultant" is for: business consultants, advisors, professional services
3. sub_vertical - More SPECIFIC type within the vertical:
   - For teacher: tutor, instructor, parenting_coach, school, workshop_leader, course_creator
   - For coach: life_coach, business_coach, career_coach, health_coach, executive_coach
   - For therapist: psychologist, counselor, family_therapist, couples_therapist, child_therapist
   - For consultant: business_consultant, marketing_consultant, it_consultant, hr_consultant
   IMPORTANT: If the business teaches/advises PARENTS about parenting or family, use sub_vertical: "parenting_coach" (not tutor or instructor)
4. description - A brief summary of what they do (capture nuance like "teaches parents AND kids")
5. target_audience - Array of who they serve: individuals, families, businesses, kids, parents, couples, etc.
6. pain_points - Array of codes (empty if none mentioned). Map to: no_shows, manual_reminders, payment_collection, admin_overhead, client_tracking, no_website, scheduling_chaos, follow_up, retention
7. goals - Array of codes (empty if none mentioned). Map to: grow_clients, save_time, automation, professional_image, online_presence, grow_revenue, retain_clients
8. tools - Array of any tools/software mentioned: google_calendar, stripe, venmo, paypal, whatsapp, excel, paper, quickbooks, zoom, etc.
9. clients_per_week - Estimate number if mentioned. Even vague hints: "busy" = 15, "just starting" = 3, "small practice" = 5. Return null if no volume hints.
10. needs_website - true if they explicitly mention wanting a website, needing online presence, or not having a website. false if they say they already have one. null if not mentioned.
11. needs_booking - true if they mention clients booking appointments, scheduling sessions, seeing clients by appointment. null if unclear.

Be GENEROUS in inference:
- "I'm drowning in admin" = pain_points: ["admin_overhead"], goals: ["save_time"]
- "I want to look more professional" = goals: ["professional_image"]
- "I'm tired of texting reminders" = pain_points: ["manual_reminders"], goals: ["automation"]
- "Chasing payments is awkward" = pain_points: ["payment_collection"]
- "I want to grow but can't handle more work" = goals: ["grow_clients", "save_time"]
- "parenting school", "teaches parents" = sub_vertical: "parenting_coach", target_audience: ["parents", "families"]

Return ONLY valid JSON with this exact structure:
{
  "company_name": string | null,
  "vertical": string,
  "sub_vertical": string | null,
  "description": string,
  "target_audience": string[],
  "pain_points": string[],
  "goals": string[],
  "tools": string[],
  "clients_per_week": number | null,
  "needs_website": boolean | null,
  "needs_booking": boolean | null
}`;

const CLIENT_WORKFLOW_SYSTEM_PROMPT = `You are analyzing how a business owner works with clients.
Extract structured information about their services, pricing, and workflow.

From their response, extract:
1. services - Array of services mentioned. For each:
   - name: service name as described
   - duration_minutes: session length if mentioned (30, 45, 60, 90, 120 are common). Default to 60 if it's clearly a session/appointment but no duration given.
   - price: numeric price. Use null if NOT mentioned (NOT 0). Only use 0 if user explicitly says "free".
   - is_scheduled: true if it's an appointment/session, false if it's a product/deliverable

IMPORTANT about price:
- If user ONLY provides service name without price (e.g., "ייעוץ אישי", "personal consultation"), set price: null
- ONLY set price: 0 if user explicitly says "free", "חינם", "gratis", etc.
- price: null means "price not provided yet, need to ask"
- price: 0 means "explicitly free service"

2. pricing_model - ONE of:
   - "fixed" - set prices per service (most common)
   - "custom" - quotes/invoices per project
   - "free" - no payment involved (ONLY if user explicitly says services are free)
   - "mixed" - some free, some paid

3. payment_timing - ONE of:
   - "before" - pay to book / upfront payment
   - "after" - invoice after service
   - "installments" - split payments mentioned
   - "none" - free services only

4. booking_method - ONE of:
   - "online" - wants clients to self-book
   - "manual" - prefers to schedule themselves
   - "both" - flexible

5. needs_more_details - boolean: Set to true if:
   - User only mentioned pricing model (e.g., "fixed prices") but no specific services
   - User didn't provide service names or prices
   - User provided service name but NO PRICE (we need to ask for price!)
   - Response was too brief to extract meaningful service information

Examples:
- "I have 3 packages: intro $50, regular $100, intensive $200" = fixed pricing, 3 services, needs_more_details: false
- "Every project is different, I quote after consultation" = custom pricing, needs_more_details: false
- "Fixed prices" or "set prices per service" = needs_more_details: true (no actual services mentioned)
- "ייעוץ אישי" or "Personal consultation" (no price) = needs_more_details: true (has name but missing price)
- "ייעוץ אישי 60 דקות" (no price) = needs_more_details: true (has name+duration but missing price)
- "שירותים עם מחירים קבועים" = needs_more_details: true (only says "fixed price services")

Return ONLY valid JSON:
{
  "services": [{ "name": string, "duration_minutes": number | null, "price": number | null, "is_scheduled": boolean }],
  "pricing_model": "fixed" | "custom" | "free" | "mixed",
  "payment_timing": "before" | "after" | "installments" | "none",
  "booking_method": "online" | "manual" | "both",
  "needs_more_details": boolean
}`;

const CLIENT_ACQUISITION_SYSTEM_PROMPT = `You are analyzing how a business owner currently gets new clients.
This helps determine if they need a website or online presence.

From their response, extract:
1. acquisition_channels - Array of channels mentioned. Map to: referrals, social_media, google_search, existing_website, networking, advertising, other
2. has_website - boolean: Do they currently have a website? true/false/null if not mentioned
3. website_quality - If they have a website, what's its quality? "good", "outdated", "basic", or null
4. wants_more_clients_online - boolean: Do they express interest in getting more clients through online channels?
5. primary_channel - The main way they currently get clients (one of the acquisition_channels)

Based on all the above, determine:
6. needs_website - boolean recommendation:
   - TRUE if: uses social_media (they already invest in online presence, website is logical next step)
   - TRUE if: no website + wants online growth, OR has outdated website
   - TRUE if: mentions wanting professional online presence
   - FALSE if: ONLY referral-based AND explicitly says they don't want to grow online
   - FALSE if: already has a good website they want to keep

IMPORTANT: If user mentions social media (Instagram, Facebook, TikTok, etc.), they are ALREADY investing in online presence.
A website is the natural complement - recommend needs_website: true unless they explicitly say they don't want one.

Examples:
- "Mostly word of mouth and referrals" = referral_based only, no social, needs_website: false
- "Referrals and social networks" / "המלצות, רשתות" = uses social_media, needs_website: TRUE (already online, website helps)
- "I post on Instagram but I don't have a website" = social_media, no website, needs_website: true
- "I want to reach more people online" = wants_more_clients_online: true, needs_website: true
- "I have a website but it's outdated" = has_website: true, website_quality: "outdated", needs_website: true
- "Only referrals, I don't want to be online" = referral_based, explicitly no online, needs_website: false

Return ONLY valid JSON:
{
  "acquisition_channels": string[],
  "has_website": boolean | null,
  "website_quality": "good" | "outdated" | "basic" | null,
  "wants_more_clients_online": boolean,
  "primary_channel": string,
  "needs_website": boolean | null
}`;

const CLIENT_TRACKING_SYSTEM_PROMPT = `You are analyzing how a business owner currently tracks their clients and their progress.
This helps determine if they need a CRM system.

IMPORTANT: The question asks "How do you track clients?" - if they say "I don't track" or "nothing" or "לא עוקב" (Hebrew for "I don't track"),
this means they currently have NO tracking system and NEED CRM help. "I don't track" = needs_crm: TRUE.
The ONLY case where needs_crm is false is when they ALREADY HAVE a CRM system they're happy with.

From their response, extract:
1. current_method - How they currently track clients. ONE of: spreadsheet, paper, memory, existing_crm, notes_app, nothing
2. current_tools - Array of specific tools mentioned: excel, google_sheets, notion, paper, notebook, trello, etc.
3. tracks_progress - boolean: Do they track client progress/journey/stages?
4. has_existing_crm - boolean: Do they already have a dedicated CRM system they use?
5. volume_hint - Any indication of how many clients they have (number or null)

Based on all the above, determine:
6. needs_crm - boolean recommendation:
   - TRUE if: current_method is "nothing", OR using spreadsheet/paper/memory, OR mentions wanting better tracking, OR says "I don't track"
   - FALSE ONLY if: they already have a CRM system they're happy with (has_existing_crm: true)
7. needs_pipeline - boolean: Do they need pipeline stages (tracking where clients are in their journey)?
   - TRUE if: they have ongoing client relationships, or mention follow-ups, stages, or need to track where clients are
   - TRUE if: current_method is "nothing" (they have no system at all, pipeline will help organize)
   - FALSE if: simple one-time transactions with no ongoing relationships

Examples:
- "I use Excel to keep track" = spreadsheet, needs_crm: true
- "Everything is in my head" = memory, needs_crm: true, needs_pipeline: true (they're losing track)
- "I have a CRM I like" = existing_crm, has_existing_crm: true, needs_crm: false
- "I write notes after each session in a notebook" = paper, needs_crm: true
- "I just remember my regulars" = memory, small volume, needs_crm: true (memory is not reliable)
- "I don't track" / "לא עוקב" / "nothing" = nothing, needs_crm: true, needs_pipeline: true (they need help organizing)
- "No system" / "אין לי מערכת" = nothing, needs_crm: true, needs_pipeline: true

Return ONLY valid JSON:
{
  "current_method": "spreadsheet" | "paper" | "memory" | "existing_crm" | "notes_app" | "nothing",
  "current_tools": string[],
  "tracks_progress": boolean,
  "has_existing_crm": boolean,
  "volume_hint": number | null,
  "needs_crm": boolean,
  "needs_pipeline": boolean
}`;

const PREVIEW_ADJUSTMENT_PROMPT = `The user is viewing a preview of their Business OS configuration and wants to make changes.
Analyze their request and determine what they want to modify.

Possible adjustments:
- add_capability: They want to add a feature (e.g., "I also want a website")
- remove_capability: They want to remove a feature (e.g., "I don't need payments")
- modify_services: They want to change services (e.g., "Add another service")
- modify_pipeline: They want to change CRM stages
- change_payment_mode: They want different payment setup
- restart: They want to start over
- confirm: They're now happy with the setup

Return JSON:
{
  "intent": "add_capability" | "remove_capability" | "modify_services" | "modify_pipeline" | "change_payment_mode" | "restart" | "confirm",
  "details": string // what specifically they want to change
}`;

// ============================================================
// CURRENCY BY LANGUAGE
// ============================================================

const CURRENCY_BY_LANGUAGE: Record<Language, string> = {
  en: 'USD',
  he: 'ILS',
  es: 'EUR',
};

// ============================================================
// ONBOARDING CONVERSATION MANAGER
// ============================================================

export class OnboardingConversationManager {
  private configService: OnboardingConfigurationService;

  constructor() {
    this.configService = onboardingConfigurationService;
  }

  /**
   * Process a user message and update the onboarding state
   */
  async processUserMessage(
    userId: string,
    message: string,
    currentState: OnboardingState
  ): Promise<{
    response: string;
    suggestions?: string[];
    multiSelect?: boolean;  // If true, suggestions are multi-select toggle buttons
    updatedState: OnboardingState;
    showPreview?: boolean;
  }> {
    logger.debug({ userId, currentStep: currentState.currentStep, message }, 'Processing user message');

    // Update state based on current step
    const updatedState = await this.updateStateFromMessage(currentState, message);

    // Generate next question or response
    const { response, suggestions, showPreview, multiSelect } = await this.getNextResponse(updatedState);

    return {
      response,
      suggestions,
      multiSelect,
      updatedState,
      showPreview,
    };
  }

  /**
   * Valid step names for the enhanced onboarding flow
   */
  private readonly VALID_STEPS = new Set<OnboardingStep>([
    'language_selection',
    'business_story',
    'client_workflow',
    'service_details',
    'client_acquisition',  // Q4: How do clients find you?
    'client_tracking',     // Q5: How do you track clients?
    'preview',
    'preview_adjustment',
    'building',
    'complete',
  ]);

  /**
   * Update state based on user message using deep LLM extraction
   */
  private async updateStateFromMessage(
    state: OnboardingState,
    message: string
  ): Promise<OnboardingState> {
    // Check if we have an old/invalid step name from a previous onboarding flow
    // If so, reset to the beginning of the new flow
    if (!this.VALID_STEPS.has(state.currentStep)) {
      logger.warn(
        { oldStep: state.currentStep },
        'Detected old onboarding step, resetting to language_selection'
      );
      return this.updateStateFromMessage(
        this.getInitialState(state.language || 'en'),
        message
      );
    }

    // Create a deep copy with defensive initialization
    const updatedState: OnboardingState = {
      ...state,
      collectedData: state.collectedData ? { ...state.collectedData } : {},
    };

    switch (state.currentStep) {
      case 'language_selection':
        // Detect language from response
        if (message.toLowerCase().includes('עברית') || message.toLowerCase().includes('hebrew')) {
          updatedState.language = 'he';
        } else if (message.toLowerCase().includes('español') || message.toLowerCase().includes('spanish')) {
          updatedState.language = 'es';
        } else {
          updatedState.language = 'en';
        }
        updatedState.currentStep = 'business_story';
        break;

      case 'business_story':
        // Deep extraction of business context
        logger.info({ message }, 'Extracting business story from message');
        const businessStory = await this.extractBusinessStory(message);
        logger.info({ businessStory }, 'Business story extracted');

        updatedState.collectedData.businessStory = businessStory;

        // Also update legacy fields for backwards compatibility
        updatedState.collectedData.businessProfile = {
          company_name: businessStory.company_name || undefined,
          vertical: businessStory.vertical,
          language: updatedState.language,
        };
        updatedState.collectedData.businessDescription = businessStory.description;

        updatedState.currentStep = 'client_workflow';
        logger.info({ newStep: 'client_workflow' }, 'Transitioning to client_workflow step');
        break;

      case 'client_workflow':
        // Extract services and workflow
        const clientWorkflow = await this.extractClientWorkflow(message);
        updatedState.collectedData.clientWorkflow = clientWorkflow;

        // Check if we need more details (user just said "fixed prices" without specific services)
        const needsMoreDetails = clientWorkflow.needs_more_details === true ||
          (!clientWorkflow.services || clientWorkflow.services.length === 0);

        if (needsMoreDetails && clientWorkflow.pricing_model !== 'custom') {
          // Need to ask for specific service details
          updatedState.currentStep = 'service_details';
          logger.info({ pricingModel: clientWorkflow.pricing_model }, 'Need more service details');
          break;
        }

        // Proceed to client_acquisition (Q4: How do clients find you?)
        updatedState.currentStep = 'client_acquisition';
        break;

      case 'service_details':
        // Handle price response when we asked "מה המחיר של X?"
        if (state.pendingQuestion === 'need_price') {
          const priceResponse = this.extractPriceFromMessage(message);
          if (priceResponse !== null) {
            // Update services that are missing price
            const services = updatedState.collectedData.clientWorkflow?.services || [];
            const updatedServices = services.map(s => {
              if (s.price === null || s.price === undefined) {
                return { ...s, price: priceResponse };
              }
              return s;
            });
            updatedState.collectedData.clientWorkflow = {
              ...updatedState.collectedData.clientWorkflow!,
              services: updatedServices,
            };
            updatedState.pendingQuestion = undefined;
            logger.info({ price: priceResponse, servicesCount: updatedServices.length }, 'Updated services with price');

            // Check if user wants to add more services
            updatedState.pendingQuestion = 'more_services';
            break;
          }
          // If we couldn't extract a price, ask again (fall through to normal flow)
          logger.warn({ message }, 'Could not extract price from message');
        }

        // Check if user just said "that's all" to the "more services?" question
        const isDoneAddingServices = !this.checkIfUserHasMoreServices(message, updatedState.language);
        if (isDoneAddingServices && (updatedState.collectedData.clientWorkflow?.services?.length || 0) > 0) {
          // User said they're done, proceed to next step
          updatedState.pendingQuestion = undefined;
          logger.info({ servicesCount: updatedState.collectedData.clientWorkflow?.services?.length }, 'User done adding services');
          updatedState.currentStep = 'client_acquisition';
          break;
        }

        // Check if user just said "I have more" without providing service details
        const wantsToAddMore = this.checkIfUserWantsToAddMore(message, updatedState.language);
        if (wantsToAddMore && state.pendingQuestion === 'more_services') {
          // User wants to add more - ask for the service details
          updatedState.pendingQuestion = undefined; // Clear the more_services question
          logger.info({}, 'User wants to add more services, asking for details');
          break; // Will show service_details_prompt
        }

        // Extract service details from the follow-up response
        const serviceDetails = await this.extractClientWorkflow(message);

        // Get existing services or start fresh
        const existingServices = updatedState.collectedData.clientWorkflow?.services || [];
        const newServices = serviceDetails.services || [];

        // Merge new services with existing ones, avoiding duplicates by service name
        const existingNames = new Set(existingServices.map(s => s.name?.toLowerCase().trim()));
        const uniqueNewServices = newServices.filter(s => !existingNames.has(s.name?.toLowerCase().trim()));
        const allServices = [...existingServices, ...uniqueNewServices];

        // Merge with previously collected workflow info
        const mergedWorkflow = {
          ...updatedState.collectedData.clientWorkflow,
          services: allServices,
        };
        updatedState.collectedData.clientWorkflow = mergedWorkflow;

        // Check if any services are missing price (price is null, not 0)
        const servicesMissingPrice = allServices.filter(s => s.price === null || s.price === undefined);
        if (servicesMissingPrice.length > 0) {
          // Need to ask for price
          updatedState.pendingQuestion = 'need_price';
          logger.info({ servicesMissingPrice: servicesMissingPrice.map(s => s.name) }, 'Services missing price');
          break;
        }

        // If we just added services, ask if they have more
        if (newServices.length > 0) {
          // Stay in service_details to ask for more services
          updatedState.pendingQuestion = 'more_services';
          logger.info({ servicesCount: allServices.length }, 'Asking for more services');
          break;
        }

        // No new services provided, proceed to next step
        updatedState.currentStep = 'client_acquisition';
        break;

      case 'client_acquisition':
        // Q4: Extract how clients find them (determines website need)
        const clientAcquisition = await this.extractClientAcquisition(message);
        updatedState.collectedData.clientAcquisition = clientAcquisition;
        logger.info({ clientAcquisition }, 'Client acquisition extracted');

        // Proceed to client_tracking (Q5: How do you track clients?)
        updatedState.currentStep = 'client_tracking';
        break;

      case 'client_tracking':
        // Q5: Extract how they track clients (determines CRM need)
        const clientTracking = await this.extractClientTracking(message);
        updatedState.collectedData.clientTracking = clientTracking;
        logger.info({ clientTracking }, 'Client tracking extracted');

        // Now we have all the info - finalize and show preview
        this.finalizeConfiguration(updatedState);
        updatedState.currentStep = 'preview';
        break;

      case 'preview':
        // Check for confirmation
        const isConfirm = this.isConfirmation(message, updatedState.language);

        if (isConfirm) {
          updatedState.currentStep = 'building';
        } else {
          // User wants to change something
          updatedState.currentStep = 'preview_adjustment';
        }
        break;

      case 'preview_adjustment':
        // Handle adjustment request
        const adjustment = await this.extractAdjustmentIntent(message);
        logger.info({ adjustment }, 'Adjustment intent extracted');

        if (adjustment.intent === 'confirm') {
          updatedState.currentStep = 'building';
        } else if (adjustment.intent === 'restart') {
          // Reset to beginning
          return this.getInitialState(updatedState.language);
        } else {
          // Apply the adjustment based on intent
          this.applyAdjustment(updatedState, adjustment);

          // Re-finalize configuration with updated data
          this.finalizeConfiguration(updatedState);

          // Go back to preview with updated configuration
          updatedState.currentStep = 'preview';
        }
        break;

      case 'building':
        updatedState.currentStep = 'complete';
        break;
    }

    return updatedState;
  }

  /**
   * Finalize configuration after collecting all required data
   */
  private finalizeConfiguration(state: OnboardingState): void {
    const clientWorkflow = state.collectedData.clientWorkflow || {};

    // Merge all extracted data including new Q4 and Q5 extractions
    const extractedData: ExtractedData = {
      ...state.collectedData.businessStory,
      ...clientWorkflow,
      // Include Q4: client acquisition data (for website decision)
      clientAcquisition: state.collectedData.clientAcquisition,
      // Include Q5: client tracking data (for CRM decision)
      clientTracking: state.collectedData.clientTracking,
    };
    state.collectedData.extractedData = extractedData;

    // Compute configuration with translated pipeline stages
    const configuration = this.configService.computeConfiguration(extractedData, state.language);
    state.collectedData.configuration = configuration;

    // Use the translated pipeline from configuration (already computed with correct language)
    state.collectedData.pipelineStages = configuration.pipeline_stages;
    state.collectedData.wantsWebsite = configuration.online_presence_mode !== 'none';

    // Convert services to legacy format
    if (clientWorkflow.services && clientWorkflow.services.length > 0) {
      const currency = CURRENCY_BY_LANGUAGE[state.language];
      state.collectedData.services = clientWorkflow.services.map(s => ({
        service_name: s.name,
        duration_minutes: s.duration_minutes || 60,
        price: s.price || 0,
        currency,
      }));
    }

    logger.info({
      vertical: configuration.vertical,
      servicesCount: state.collectedData.services?.length || 0,
      pipelineStages: state.collectedData.pipelineStages?.length || 0,
    }, 'Configuration finalized');
  }

  /**
   * Extract business story using LLM
   */
  private async extractBusinessStory(message: string): Promise<BusinessStoryExtraction> {
    const factory = getProviderFactory();

    try {
      const response = await factory.complete({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: BUSINESS_STORY_SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
        response_format: { type: 'json_object' },
      });

      const extracted = JSON.parse(response.content);
      logger.info({ extracted }, 'Extracted business story');

      return {
        company_name: extracted.company_name || undefined,
        vertical: extracted.vertical || 'other',
        sub_vertical: extracted.sub_vertical || undefined,
        description: extracted.description,
        target_audience: extracted.target_audience || [],
        pain_points: extracted.pain_points || [],
        goals: extracted.goals || [],
        tools: extracted.tools || [],
        clients_per_week: extracted.clients_per_week || undefined,
        needs_website: extracted.needs_website ?? undefined,
        needs_booking: extracted.needs_booking ?? undefined,
      };
    } catch (error) {
      logger.error({ err: error }, 'Business story extraction failed');
      // Return defaults
      return {
        vertical: 'other',
        pain_points: [],
        goals: [],
        tools: [],
        target_audience: [],
      };
    }
  }

  /**
   * Extract client workflow using LLM
   */
  private async extractClientWorkflow(message: string): Promise<ClientWorkflowExtraction> {
    const factory = getProviderFactory();

    try {
      const response = await factory.complete({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: CLIENT_WORKFLOW_SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
        response_format: { type: 'json_object' },
      });

      const extracted = JSON.parse(response.content);
      logger.info({ extracted }, 'Extracted client workflow');

      return {
        services: extracted.services || [],
        pricing_model: extracted.pricing_model || 'fixed',
        payment_timing: extracted.payment_timing || 'before',
        booking_method: extracted.booking_method || 'online',
        needs_more_details: extracted.needs_more_details ?? false,
      };
    } catch (error) {
      logger.error({ err: error }, 'Client workflow extraction failed');
      return {
        services: [],
        pricing_model: 'fixed',
        payment_timing: 'before',
        booking_method: 'online',
        needs_more_details: true,
      };
    }
  }

  /**
   * Extract client acquisition info from multi-select response (Q4: What digital tools do you need?)
   * Parses explicit text selections - no emojis
   */
  private extractClientAcquisition(message: string): ClientAcquisitionExtraction {
    const lowerMsg = message.toLowerCase();

    // Check for website selection (Professional website / אתר מקצועי / Sitio web)
    const needsWebsite =
      lowerMsg.includes('website') ||
      lowerMsg.includes('professional') ||
      lowerMsg.includes('אתר') ||
      lowerMsg.includes('מקצועי') ||
      lowerMsg.includes('sitio') ||
      lowerMsg.includes('profesional');

    // Check for email campaigns selection (Email campaigns / קמפיינים / Campañas)
    const needsCampaigns =
      lowerMsg.includes('campaign') ||
      lowerMsg.includes('email') ||
      lowerMsg.includes('reminder') ||
      lowerMsg.includes('קמפיין') ||
      lowerMsg.includes('תזכורות') ||
      lowerMsg.includes('מייל') ||
      lowerMsg.includes('campaña') ||
      lowerMsg.includes('recordatorio');

    // Check for social media selection (Social media / רשתות חברתיות / redes sociales)
    const needsSocialMedia =
      lowerMsg.includes('social') ||
      lowerMsg.includes('רשתות') ||
      lowerMsg.includes('חברתיות') ||
      lowerMsg.includes('redes');

    // Check for "none" selection (None / לא צריך / No necesito)
    const needsNone =
      lowerMsg.includes('none') ||
      lowerMsg.includes('לא צריך כרגע') ||
      lowerMsg.includes('no necesito');

    // Build acquisition channels array
    const channels: string[] = [];
    if (needsWebsite) channels.push('website');
    if (needsCampaigns) channels.push('email_campaigns');
    if (needsSocialMedia) channels.push('social_media');

    const result: ClientAcquisitionExtraction = {
      acquisition_channels: channels,
      has_website: false,  // They don't have one yet (if they did, why would they need one?)
      wants_more_clients_online: needsWebsite || needsCampaigns || needsSocialMedia,
      primary_channel: needsWebsite ? 'website' : needsSocialMedia ? 'social_media' : 'referrals',
      needs_website: needsWebsite && !needsNone,
      needs_campaigns: needsCampaigns && !needsNone,
      needs_social_media: needsSocialMedia && !needsNone,
    };

    logger.info({ message, result }, 'Extracted client acquisition from multi-select');
    return result;
  }

  /**
   * Extract client tracking info using LLM (Q5: How do you track clients?)
   */
  private async extractClientTracking(message: string): Promise<ClientTrackingExtraction> {
    const factory = getProviderFactory();

    try {
      const response = await factory.complete({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: CLIENT_TRACKING_SYSTEM_PROMPT },
          { role: 'user', content: message },
        ],
        response_format: { type: 'json_object' },
      });

      const extracted = JSON.parse(response.content);
      logger.info({ extracted }, 'Extracted client tracking');

      return {
        current_method: extracted.current_method || 'nothing',
        current_tools: extracted.current_tools || [],
        tracks_progress: extracted.tracks_progress ?? false,
        has_existing_crm: extracted.has_existing_crm ?? false,
        volume_hint: extracted.volume_hint ?? undefined,
        needs_crm: extracted.needs_crm ?? true,
        needs_pipeline: extracted.needs_pipeline ?? false,
      };
    } catch (error) {
      logger.error({ err: error }, 'Client tracking extraction failed');
      return {
        current_method: 'nothing',
        current_tools: [],
        tracks_progress: false,
        has_existing_crm: false,
        needs_crm: true,
        needs_pipeline: false,
      };
    }
  }

  /**
   * Check if user indicated they have more services to add
   * Returns true by default to ask for more services, unless user explicitly says they're done
   */
  private checkIfUserHasMoreServices(message: string, language: Language): boolean {
    const lowerMsg = message.toLowerCase();

    // Patterns indicating "that's all" / "no more"
    const donePatterns: Record<Language, string[]> = {
      en: ["that's all", "that's it", "no more", "only one", "just one", "done", "nothing else", "that is all", "no", "nope"],
      he: ['זה הכל', 'אין עוד', 'רק זה', 'סיימתי', 'אין יותר', 'זהו', 'לא', 'אין'],
      es: ['eso es todo', 'no más', 'solo uno', 'terminado', 'nada más', 'no'],
    };

    const patterns = donePatterns[language] || donePatterns.en;

    // If user explicitly said they're done, don't ask for more
    if (patterns.some(p => lowerMsg.includes(p))) {
      return false;
    }

    // By default, ask if they have more services (they can say no)
    return true;
  }

  /**
   * Check if user said "I have more" to add another service
   * This is used when the pendingQuestion is 'more_services' to detect affirmative responses
   */
  private checkIfUserWantsToAddMore(message: string, language: Language): boolean {
    const lowerMsg = message.toLowerCase();

    // Patterns indicating "yes I have more"
    const morePatterns: Record<Language, string[]> = {
      en: ['i have more', 'yes', 'yeah', 'yep', 'more', 'another', 'add more', 'one more'],
      he: ['יש לי עוד', 'כן', 'עוד', 'יש עוד', 'עוד אחד', 'להוסיף'],
      es: ['tengo más', 'sí', 'si', 'más', 'otro', 'agregar más'],
    };

    const patterns = morePatterns[language] || morePatterns.en;
    return patterns.some(p => lowerMsg.includes(p));
  }

  /**
   * Extract numeric price from user's response message.
   * Handles formats like: "100", "₪100", "100 שקל", "$50", "50 dollars", etc.
   * Returns the numeric price or null if extraction fails.
   */
  private extractPriceFromMessage(message: string): number | null {
    const trimmed = message.trim();

    // Check for explicit "free" indicators
    const freePatterns = ['free', 'חינם', 'gratis', '0', 'nothing', 'no charge', 'בחינם', 'ללא תשלום'];
    if (freePatterns.some(p => trimmed.toLowerCase() === p || trimmed.toLowerCase().includes(p))) {
      return 0;
    }

    // Remove currency symbols and common currency words to extract the number
    // Supports: ₪, $, €, שקל, שקלים, dollar, dollars, euro, euros, NIS, ILS, USD, EUR
    const cleanedMessage = trimmed
      .replace(/[₪$€]/g, '')
      .replace(/\b(שקל|שקלים|ש"ח|שח|nis|ils|usd|eur|dollar|dollars|euro|euros)\b/gi, '')
      .trim();

    // Try to find a number in the cleaned message
    // Match integers or decimals (e.g., 100, 99.99, 1,500)
    const numberMatch = cleanedMessage.match(/[\d,]+(?:\.\d+)?/);
    if (numberMatch) {
      // Remove commas and parse as float
      const parsed = parseFloat(numberMatch[0].replace(/,/g, ''));
      if (!isNaN(parsed) && parsed >= 0) {
        logger.info({ message, extracted: parsed }, 'Extracted price from message');
        return parsed;
      }
    }

    logger.warn({ message }, 'Could not extract numeric price from message');
    return null;
  }

  /**
   * Extract adjustment intent from user message
   */
  private async extractAdjustmentIntent(message: string): Promise<{ intent: string; details: string }> {
    const factory = getProviderFactory();

    try {
      const response = await factory.complete({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: PREVIEW_ADJUSTMENT_PROMPT },
          { role: 'user', content: message },
        ],
        response_format: { type: 'json_object' },
      });

      const extracted = JSON.parse(response.content);
      return extracted;
    } catch (error) {
      logger.error({ err: error }, 'Adjustment intent extraction failed');
      return { intent: 'confirm', details: '' };
    }
  }

  /**
   * Apply user's adjustment to the collected data
   */
  private applyAdjustment(
    state: OnboardingState,
    adjustment: { intent: string; details: string }
  ): void {
    const details = adjustment.details.toLowerCase();

    switch (adjustment.intent) {
      case 'add_capability':
        // Check what capability they want to add
        if (this.mentionsWebsite(details)) {
          // User wants to add website
          if (!state.collectedData.clientAcquisition) {
            state.collectedData.clientAcquisition = {
              acquisition_channels: [],
              has_website: false,
              wants_more_clients_online: true,
              primary_channel: 'referrals',
              needs_website: true,
            };
          } else {
            state.collectedData.clientAcquisition.needs_website = true;
            state.collectedData.clientAcquisition.wants_more_clients_online = true;
          }
          logger.info('Applied adjustment: add website');
        }

        if (this.mentionsCRM(details)) {
          // User wants to add CRM
          if (!state.collectedData.clientTracking) {
            state.collectedData.clientTracking = {
              current_method: 'nothing',
              current_tools: [],
              tracks_progress: false,
              has_existing_crm: false,
              needs_crm: true,
              needs_pipeline: true,
            };
          } else {
            state.collectedData.clientTracking.needs_crm = true;
            state.collectedData.clientTracking.needs_pipeline = true;
          }
          logger.info('Applied adjustment: add CRM');
        }

        if (this.mentionsPayments(details)) {
          // User wants to add payments
          if (state.collectedData.clientWorkflow) {
            state.collectedData.clientWorkflow.pricing_model = 'fixed';
            state.collectedData.clientWorkflow.payment_timing = 'before';
          }
          logger.info('Applied adjustment: add payments');
        }
        break;

      case 'remove_capability':
        // Check what capability they want to remove
        if (this.mentionsWebsite(details)) {
          if (state.collectedData.clientAcquisition) {
            state.collectedData.clientAcquisition.needs_website = false;
          }
          logger.info('Applied adjustment: remove website');
        }

        if (this.mentionsCRM(details)) {
          if (state.collectedData.clientTracking) {
            state.collectedData.clientTracking.needs_crm = false;
            state.collectedData.clientTracking.needs_pipeline = false;
          }
          logger.info('Applied adjustment: remove CRM');
        }

        if (this.mentionsPayments(details)) {
          if (state.collectedData.clientWorkflow) {
            state.collectedData.clientWorkflow.pricing_model = 'free';
            state.collectedData.clientWorkflow.payment_timing = 'none';
          }
          logger.info('Applied adjustment: remove payments');
        }
        break;

      case 'modify_services':
        // For now, just log - future: allow adding/editing services
        logger.info({ details }, 'Service modification requested (not yet implemented)');
        break;

      case 'modify_pipeline':
        // For now, just log - future: allow editing pipeline stages
        logger.info({ details }, 'Pipeline modification requested (not yet implemented)');
        break;

      case 'change_payment_mode':
        // For now, just log - future: allow changing payment mode
        logger.info({ details }, 'Payment mode change requested (not yet implemented)');
        break;

      default:
        logger.info({ intent: adjustment.intent, details }, 'Unknown adjustment intent');
    }
  }

  /**
   * Check if text mentions website
   */
  private mentionsWebsite(text: string): boolean {
    const websiteKeywords = [
      'website', 'site', 'web', 'online presence', 'landing page',
      'אתר', 'דף נחיתה', 'נוכחות אונליין',
      'sitio', 'web', 'página'
    ];
    return websiteKeywords.some(k => text.includes(k));
  }

  /**
   * Check if text mentions CRM
   */
  private mentionsCRM(text: string): boolean {
    const crmKeywords = [
      'crm', 'client management', 'contact', 'tracking', 'pipeline',
      'ניהול לקוחות', 'מעקב', 'קשר',
      'gestión de clientes', 'seguimiento'
    ];
    return crmKeywords.some(k => text.includes(k));
  }

  /**
   * Check if text mentions payments
   */
  private mentionsPayments(text: string): boolean {
    const paymentKeywords = [
      'payment', 'pay', 'invoice', 'billing', 'charge', 'stripe',
      'תשלום', 'חשבונית', 'גבייה',
      'pago', 'factura', 'cobro'
    ];
    return paymentKeywords.some(k => text.includes(k));
  }

  /**
   * Check if message is a confirmation
   */
  private isConfirmation(message: string, language: Language): boolean {
    const lowerMsg = message.toLowerCase();

    const confirmPatterns: Record<Language, string[]> = {
      en: ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'looks good', 'perfect', 'great', "let's go", 'start', 'confirm'],
      he: ['כן', 'יופי', 'מושלם', 'בסדר', 'אוקיי', 'נשמע טוב', 'בואו', 'מעולה', 'אישור'],
      es: ['sí', 'si', 'perfecto', 'bien', 'vale', 'ok', 'genial', 'vamos', 'confirmar'],
    };

    const patterns = confirmPatterns[language] || confirmPatterns.en;
    return patterns.some(p => lowerMsg.includes(p));
  }

  /**
   * Get next response based on current state
   */
  private async getNextResponse(
    state: OnboardingState
  ): Promise<{
    response: string;
    suggestions?: string[];
    multiSelect?: boolean;  // If true, frontend shows toggle buttons instead of single-select
    showPreview?: boolean;
  }> {
    const language = state.language;
    const responses = this.getResponseTemplates(language);

    switch (state.currentStep) {
      case 'language_selection':
        // IMPORTANT: Language selection is ALWAYS shown in English with LTR direction
        // Only after user selects their language will subsequent messages use that language
        return {
          response: 'What language would you like to use?',
          suggestions: ['English', 'עברית (Hebrew)', 'Español (Spanish)'],
        };

      case 'business_story':
        return {
          response: responses.business_story_prompt,
        };

      case 'client_workflow':
        const companyName = state.collectedData.businessStory?.company_name || responses.default_company;
        return {
          response: responses.client_workflow_prompt.replace('{company}', companyName),
          suggestions: responses.client_workflow_options,
        };

      case 'service_details':
        // Check if we need to ask for price specifically
        if (state.pendingQuestion === 'need_price') {
          const servicesMissingPrice = state.collectedData.clientWorkflow?.services?.filter(
            s => s.price === null || s.price === undefined
          ) || [];
          const serviceNames = servicesMissingPrice.map(s => s.name).join(', ');
          return {
            response: responses.need_price_prompt.replace('{services}', serviceNames),
          };
        }
        // Check if we should ask for more services
        if (state.pendingQuestion === 'more_services') {
          const currentCount = state.collectedData.clientWorkflow?.services?.length || 0;
          return {
            response: responses.more_services_prompt.replace('{count}', currentCount.toString()),
            suggestions: responses.more_services_options,
          };
        }
        // Follow-up question to get specific service details
        return {
          response: responses.service_details_prompt,
        };

      case 'client_acquisition':
        // Q4: What digital tools do you need? (multi-select)
        return {
          response: responses.client_acquisition_prompt,
          suggestions: responses.client_acquisition_options,
          multiSelect: true,  // Signal to frontend that this is multi-select
        };

      case 'client_tracking':
        // Q5: How do you track clients? (determines CRM need)
        return {
          response: responses.client_tracking_prompt,
        };

      case 'preview':
        // Visual preview card handles the display - just return minimal message
        // The UI shows the visual preview card with all details
        return {
          response: '', // Empty - visual card shows everything
          suggestions: responses.preview_options,
          showPreview: true,
        };

      case 'preview_adjustment':
        return {
          response: responses.adjustment_prompt,
        };

      case 'building':
        return {
          response: responses.building_message,
        };

      case 'complete':
        return {
          response: responses.complete_message,
        };

      default:
        return {
          response: responses.default_prompt,
        };
    }
  }

  /**
   * Generate preview message showing computed configuration
   * Clean text-based design without emojis for cross-platform compatibility
   */
  private generatePreviewMessage(state: OnboardingState): string {
    const config = state.collectedData.configuration;
    const language = state.language;

    if (!config) {
      return this.getResponseTemplates(language).preview_error;
    }

    const t = this.getPreviewTemplates(language);
    const isRTL = language === 'he';

    const lines: string[] = [];

    // Header with greeting
    lines.push(`${t.header.replace('{company}', `**${config.company_name}**`)}`);
    lines.push('');
    lines.push('───────────────────');
    lines.push('');

    // Client Journey - visual pipeline
    const pipelineStages = state.collectedData.pipelineStages || config.pipeline_stages;
    const stageLabels = pipelineStages.map(s => s.stage_label);
    lines.push(`**${t.journey_title}**`);
    lines.push('');
    // Create visual pipeline with arrows
    const pipelineArrow = isRTL ? ' < ' : ' > ';
    lines.push(`\`${stageLabels.join(pipelineArrow)}\``);
    lines.push('');

    // Online Presence
    lines.push(`**${t.presence_title}**`);
    if (config.online_presence_mode === 'full_website') {
      lines.push(`   [+] ${t.presence_website}`);
    } else if (config.online_presence_mode === 'booking_only') {
      lines.push(`   [+] ${t.presence_booking}`);
    } else if (config.online_presence_mode === 'website_only') {
      lines.push(`   [+] ${t.presence_website_only}`);
    } else {
      lines.push(`   [-] ${t.presence_none}`);
    }
    lines.push('');

    // Capabilities - clean list
    lines.push(`**${t.capabilities_title}**`);
    config.capabilities.forEach(cap => {
      const name = this.configService.getCapabilityDisplayName(cap, language);
      lines.push(`   [+] ${name}`);
    });
    lines.push('');

    // Services - clean list with pricing
    const services = state.collectedData.services;
    if (services && services.length > 0) {
      lines.push(`**${t.services_title}**`);
      services.forEach(s => {
        const priceStr = s.price > 0
          ? `**${s.currency} ${s.price}**`
          : `_${t.free}_`;
        const durationStr = t.minutes_abbrev
          ? `${s.duration_minutes}${t.minutes_abbrev}`
          : `${s.duration_minutes} min`;
        lines.push(`   - ${s.service_name} | ${durationStr} | ${priceStr}`);
      });
      lines.push('');
    }

    // Payment mode
    lines.push(`**${t.payment_title}**`);
    if (config.payment_mode === 'none') {
      lines.push(`   ${t.payment_none}`);
    } else if (config.payment_mode === 'upfront') {
      lines.push(`   ${t.payment_upfront}`);
    } else if (config.payment_mode === 'invoicing') {
      lines.push(`   ${t.payment_invoicing}`);
    } else if (config.payment_mode === 'installments') {
      lines.push(`   ${t.payment_installments}`);
    }
    lines.push('');
    lines.push('───────────────────');
    lines.push('');

    // CTA - friendly prompt
    lines.push(t.cta);

    return lines.join('\n');
  }

  /**
   * Get preview templates by language
   */
  private getPreviewTemplates(language: Language): Record<string, string> {
    if (language === 'he') {
      return {
        header: 'הנה התוכנית שלי עבור {company}:',
        journey_title: 'מסע הלקוח',
        presence_title: 'נוכחות דיגיטלית',
        presence_website: 'אתר מקצועי + הזמנות אונליין',
        presence_booking: 'עמוד הזמנות ייעודי',
        presence_website_only: 'אתר מקצועי',
        presence_none: 'ללא אתר (אפשר להוסיף בהמשך)',
        capabilities_title: 'הכלים שלך',
        services_title: 'שירותים',
        free: 'חינם',
        minutes_abbrev: ' דק׳',
        payment_title: 'תשלומים',
        payment_none: 'שירותים חינמיים',
        payment_upfront: 'תשלום בזמן ההזמנה',
        payment_invoicing: 'חשבוניות אחרי השירות',
        payment_installments: 'תשלום בתשלומים',
        cta: 'הכל נראה טוב? אמור **"כן"** להמשיך, או ספר לי מה לשנות.',
      };
    }

    if (language === 'es') {
      return {
        header: 'Este es mi plan para {company}:',
        journey_title: 'Recorrido del cliente',
        presence_title: 'Presencia digital',
        presence_website: 'Sitio web profesional + reservas en línea',
        presence_booking: 'Página de reservas dedicada',
        presence_website_only: 'Sitio web profesional',
        presence_none: 'Sin sitio web (puedes agregar después)',
        capabilities_title: 'Tus herramientas',
        services_title: 'Servicios',
        free: 'Gratis',
        minutes_abbrev: ' min',
        payment_title: 'Pagos',
        payment_none: 'Servicios gratuitos',
        payment_upfront: 'Pago al reservar',
        payment_invoicing: 'Facturas después del servicio',
        payment_installments: 'Pagos en cuotas',
        cta: '¿Todo bien? Di **"sí"** para continuar, o dime qué cambiar.',
      };
    }

    // English (default)
    return {
      header: "Here's my plan for {company}:",
      journey_title: 'Client Journey',
      presence_title: 'Digital Presence',
      presence_website: 'Professional website + online booking',
      presence_booking: 'Dedicated booking page',
      presence_website_only: 'Professional website',
      presence_none: 'No website (can add later)',
      capabilities_title: 'Your Tools',
      services_title: 'Services',
      free: 'Free',
      minutes_abbrev: ' min',
      payment_title: 'Payments',
      payment_none: 'Free services',
      payment_upfront: 'Pay when booking',
      payment_invoicing: 'Invoices after service',
      payment_installments: 'Installment payments',
      cta: 'All good? Say **"yes"** to continue, or tell me what to change.',
    };
  }

  /**
   * Get response templates by language
   * Note: No emojis used - platform icons are rendered in the UI layer
   */
  private getResponseTemplates(language: Language): Record<string, any> {
    if (language === 'he') {
      return {
        language_prompt: 'באיזו שפה תרצו להשתמש?',
        business_story_prompt: 'מעולה! ספרו לי על העסק שלכם - מה אתם עושים ומה הביא אתכם לכאן היום?',
        client_workflow_prompt: 'תודה! איך אתם עובדים עם לקוחות? יש לכם שירותים עם מחירים קבועים, או שזה יותר מותאם אישית ללקוח?',
        client_workflow_options: ['שירותים עם מחירים קבועים', 'מותאם אישית ללקוח', 'שילוב של שניהם'],
        service_details_prompt: 'מצוין! אפשר לספר לי קצת יותר על השירותים שלכם? לדוגמה: שם השירות, משך (בדקות), ומחיר.',
        need_price_prompt: 'מה המחיר של {services}?',
        more_services_prompt: 'נהדר! הוספתי {count} שירות(ים). יש לך עוד שירותים להוסיף?',
        more_services_options: ['יש לי עוד', 'זה הכל'],
        client_acquisition_prompt: 'מה מהדברים הבאים היית רוצה? (בחר את כל מה שמתאים)',
        client_acquisition_options: [
          'אתר מקצועי',
          'קמפיינים ותזכורות במייל',
          'נוכחות ברשתות חברתיות',
          'לא צריך כרגע',
        ],
        client_tracking_prompt: 'איך את/ה עוקב/ת אחרי הלקוחות שלך והתקדמותם? יש לך כלי מסוים או שהכל בראש?',
        default_company: 'העסק שלך',
        preview_options: ['כן, בואו נתחיל!', 'אני רוצה לשנות משהו'],
        adjustment_prompt: 'מה תרצה לשנות?',
        building_message: 'מעולה! אני בונה את המערכת שלך...',
        complete_message: 'הכל מוכן! ברוך הבא ל-Business OS שלך.',
        default_prompt: 'אני כאן לעזור לך להגדיר את המערכת.',
        preview_error: 'משהו השתבש. בוא ננסה שוב.',
      };
    }

    if (language === 'es') {
      return {
        language_prompt: '¿Qué idioma te gustaría usar?',
        business_story_prompt: '¡Genial! Cuéntame sobre tu negocio - ¿qué haces y qué te trajo aquí hoy?',
        client_workflow_prompt: '¡Gracias! ¿Cómo trabajas con tus clientes? ¿Tienes servicios con precios fijos, o es más personalizado por cliente?',
        client_workflow_options: ['Servicios con precios fijos', 'Personalizado por cliente', 'Combinación de ambos'],
        service_details_prompt: '¡Perfecto! ¿Puedes contarme más sobre tus servicios? Por ejemplo: nombre del servicio, duración (en minutos) y precio.',
        need_price_prompt: '¿Cuál es el precio de {services}?',
        more_services_prompt: '¡Genial! Agregué {count} servicio(s). ¿Tienes más servicios para agregar?',
        more_services_options: ['Tengo más', 'Eso es todo'],
        client_acquisition_prompt: '¿Cuáles de las siguientes cosas te gustaría tener? (selecciona todas las que apliquen)',
        client_acquisition_options: [
          'Sitio web profesional',
          'Campañas y recordatorios por email',
          'Presencia en redes sociales',
          'No necesito por ahora',
        ],
        client_tracking_prompt: '¿Cómo llevas el seguimiento de tus clientes y su progreso? ¿Usas alguna herramienta o está todo en tu cabeza?',
        default_company: 'tu negocio',
        preview_options: ['Sí, ¡comencemos!', 'Quiero cambiar algo'],
        adjustment_prompt: '¿Qué te gustaría cambiar?',
        building_message: '¡Excelente! Estoy construyendo tu sistema...',
        complete_message: '¡Todo listo! Bienvenido a tu Business OS.',
        default_prompt: 'Estoy aquí para ayudarte a configurar tu sistema.',
        preview_error: 'Algo salió mal. Intentemos de nuevo.',
      };
    }

    // English (default)
    return {
      language_prompt: 'What language would you like to use?',
      business_story_prompt: "Great! Tell me about your business - what do you do and what brought you here today?",
      client_workflow_prompt: "Thanks! How do you typically work with clients? Do you have set services and prices, or is it more custom per client?",
      client_workflow_options: ['Fixed services and prices', 'Custom per client', 'A mix of both'],
      service_details_prompt: "Perfect! Can you tell me more about your services? For example: service name, duration (in minutes), and price.",
      need_price_prompt: "What is the price for {services}?",
      more_services_prompt: "Great! I've added {count} service(s). Do you have more services to add?",
      more_services_options: ['I have more', "That's all"],
      client_acquisition_prompt: "Which of the following would you like to have? (select all that apply)",
      client_acquisition_options: [
        'Professional website',
        'Email campaigns & reminders',
        'Social media presence',
        'None of these for now',
      ],
      client_tracking_prompt: "How do you currently keep track of your clients and their progress? Do you use any tools or is it mostly in your head?",
      default_company: 'your business',
      preview_options: ["Yes, let's get started!", 'I want to change something'],
      adjustment_prompt: "What would you like to change?",
      building_message: "Excellent! I'm building your system...",
      complete_message: 'All done! Welcome to your Business OS.',
      default_prompt: "I'm here to help you set up your system.",
      preview_error: 'Something went wrong. Let\'s try again.',
    };
  }

  /**
   * Get initial state for a new conversation
   */
  getInitialState(language: Language = 'en'): OnboardingState {
    return {
      currentStep: 'language_selection',
      collectedData: {},
      language,
    };
  }

  /**
   * Validate collected data before building
   */
  validateState(state: OnboardingState): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!state.collectedData.configuration) {
      errors.push('Configuration not computed');
      return { valid: false, errors };
    }

    const config = state.collectedData.configuration;

    if (!config.company_name) {
      errors.push('Company name is required');
    }

    if (!config.vertical) {
      errors.push('Business vertical is required');
    }

    if (config.capabilities.length === 0) {
      errors.push('At least one capability is required');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
