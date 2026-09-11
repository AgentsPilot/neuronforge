/**
 * POST /api/onboarding/build
 * Build infrastructure for new business-os users
 * - Creates/updates business profile with intelligent extraction
 * - Seeds CRM pipeline stages based on vertical
 * - Creates services from onboarding data
 * - Activates capabilities based on computed configuration
 * - Triggers AI website generation (async)
 * - Marks onboarding as complete
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { businessProfileRepository, type BusinessProfileInsert } from '@/lib/repositories/BusinessProfileRepository';
import { crmPipelineStagesRepository } from '@/lib/repositories/CRMPipelineStagesRepository';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';
import { smartLinkRepository } from '@/lib/repositories/SmartLinkRepository';
import { resolveBusinessCurrency } from '@/lib/business-os/currency';
import { paymentPlanRepository } from '@/lib/repositories/PaymentPlanRepository';
import { capabilityActivationService } from '@/lib/services/CapabilityActivationService';
import { capabilityConditionEvaluator } from '@/lib/services/CapabilityConditionEvaluator';
import { z } from 'zod';

const logger = createLogger({ module: 'OnboardingBuildAPI' });

/**
 * A gpt-4o call building a whole website from a ~4k-token prompt routinely takes
 * 20-60s. Without this the platform default kills the function mid-flight, the
 * caller's `await response.json()` throws, and it lands in a swallowed catch —
 * indistinguishable from "the AI just doesn't work". Matches the ceiling the
 * other LLM routes in this repo already declare.
 */
export const maxDuration = 60;


// Schema for pipeline stages
const pipelineStageSchema = z.object({
  stage_key: z.string(),
  stage_label: z.string(),
  position: z.number(),
  color: z.string(),
  /**
   * What a stage means, and which one means "this contact is now a client".
   *
   * Zod strips what it does not name, so leaving these out discarded them
   * before the route ever saw them — every account onboarded through the chat
   * got stages with no type and no client stage, and `findClientStage()` had
   * nothing to return. Without it the platform cannot answer the one question
   * a pipeline exists to answer: has this contact become a customer.
   */
  stage_type: z.enum(['lead', 'prospect', 'client', 'past_client', 'lost', 'archived']).optional(),
  is_primary_client_stage: z.boolean().optional(),
});

// Schema for computed configuration from OnboardingConfigurationService
const computedConfigurationSchema = z.object({
  company_name: z.string(),
  vertical: z.string(),
  /** Which pipeline preset was used — a parenting coach is not a generic tutor. */
  sub_vertical: z.string().nullable().optional(),
  description: z.string().optional(),
  clients_per_week: z.number(),
  pain_points: z.array(z.string()),
  goals: z.array(z.string()),
  tools: z.array(z.string()),
  services: z.array(z.object({
    name: z.string(),
    duration_minutes: z.number().nullable().optional(),
    // Null is a real answer here — "the fee is agreed with each client" — and
    // the code below distinguishes it from an absent price and from a zero.
    // The schema rejected it, so a business with one quoted service could not
    // finish the build at all: a 400 on the whole request.
    price: z.number().nullable().optional(),
    // Whatever they wrote the price in. Stripped by the schema before this was
    // here, so a dollar price typed in a Hebrew conversation arrived currencyless.
    currency: z.string().nullable().optional(),
    payment_plan: z.object({
      installment_count: z.number(),
      installment_frequency: z.enum(['weekly', 'biweekly', 'monthly']),
    }).nullable().optional(),
    is_scheduled: z.boolean().optional(),
    sale_mode: z.enum(['direct', 'proposal']).optional(),
    collection: z.enum(['online', 'invoice']).nullable().optional(),
  })),
  online_presence_mode: z.enum(['full_website', 'booking_only', 'website_only', 'none']),
  payment_mode: z.enum(['none', 'upfront', 'invoicing', 'installments']),
  needs_stripe_connect: z.boolean(),
  /** Clients fill in a form before their appointment. */
  needs_intake: z.boolean().optional(),
  pipeline_stages: z.array(pipelineStageSchema),
  capabilities: z.array(z.string()),
  building_blocks: z.record(z.array(z.string())),
  capability_reasons: z.record(z.string()).optional(),
  collection_method: z.enum(['card_online', 'invoice', 'in_person', 'mixed', 'none']).optional(),
});

// Validation schema for the build request (supports both old and new formats)
const buildRequestSchema = z.object({
  // NEW: Computed configuration from smart onboarding
  configuration: computedConfigurationSchema.optional(),

  // LEGACY: Old profile-based format (for backwards compatibility)
  profile: z.object({
    vertical: z.string().optional(),
    sub_vertical: z.string().optional(),
    company_name: z.string().optional(),
    language: z.enum(['en', 'he', 'es']).optional(),
    description: z.string().optional(),
    services: z.array(z.string()).optional(),
    clients_per_week: z.number().optional(),
    tools: z.array(z.string()).optional(),
    website_url: z.string().optional(),
    has_website: z.boolean().optional(),
    has_online_booking: z.boolean().optional(),
    booking_method: z.string().optional(),
    pain_points: z.array(z.string()).optional(),
    goals: z.array(z.string()).optional(),
    profile_completeness: z.number().optional(),
  }).optional(),

  // Services from onboarding chat
  services: z.array(z.object({
    service_name: z.string(),
    duration_minutes: z.number(),
    price: z.number().nullable(),
    currency: z.string().optional(),
    // This branch is preferred over `configuration.services`, so a plan absent
    // from the schema here was stripped and the service built without it.
    payment_plan: z.object({
      installment_count: z.number(),
      installment_frequency: z.enum(['weekly', 'biweekly', 'monthly']),
    }).nullable().optional(),
    is_scheduled: z.boolean().optional(),
    sale_mode: z.enum(['direct', 'proposal']).optional(),
    collection: z.enum(['online', 'invoice']).nullable().optional(),
  })).optional(),

  // Pipeline stages
  pipelineStages: z.array(pipelineStageSchema).optional(),

  // Legacy capabilities format
  capabilities: z.array(z.object({
    id: z.string(),
    name: z.string(),
    category: z.string(),
  })).optional(),

  locale: z.string().optional(),
  language: z.enum(['en', 'he', 'es']).optional(),
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Parse and validate request body
    const body = await request.json();
    const validated = buildRequestSchema.parse(body);
    const { configuration, profile, services, pipelineStages, capabilities, language } = validated;

    // Determine if using new computed configuration or legacy format
    const useNewFormat = !!configuration;

    // Extract values from either format
    const vertical = configuration?.vertical || profile?.vertical || 'default';
    const companyName = configuration?.company_name || profile?.company_name;
    const description = configuration?.description || profile?.description;
    const clientsPerWeek = configuration?.clients_per_week || profile?.clients_per_week;
    const painPoints = configuration?.pain_points || profile?.pain_points || [];
    const goals = configuration?.goals || profile?.goals || [];
    const tools = configuration?.tools || profile?.tools || [];
    const lang = language || profile?.language || 'en';

    requestLogger.info(
      { userId: user.id, vertical, useNewFormat },
      'Building onboarding infrastructure'
    );

    /**
     * How much of the profile is actually filled in.
     *
     * This was the constant 70 for every account that ever completed
     * onboarding — a number that measured nothing and was reported to anything
     * that asked. Counted here from the facts the build has in hand, so it
     * means what it says.
     */
    const profileCompleteness = (() => {
      const known = [
        !!companyName,
        !!description,
        !!vertical,
        !!lang,
        (configuration?.services?.length || services?.length || 0) > 0,
        (configuration?.pipeline_stages?.length || pipelineStages?.length || 0) > 0,
        !!configuration?.online_presence_mode,
        (clientsPerWeek || 0) > 0,
        painPoints.length > 0,
        goals.length > 0,
      ];
      return Math.round((known.filter(Boolean).length / known.length) * 100);
    })();

    // 3. Upsert business profile with intelligent data
    const profileData: BusinessProfileInsert = {
      user_id: user.id,
      vertical,
      // The sub-vertical decides which pipeline preset is used — a parenting
      // coach gets different stages from a generic tutor — so it is worth
      // recording rather than reading off the configuration and discarding.
      sub_vertical: configuration?.sub_vertical || profile?.sub_vertical || null,
      company_name: companyName || null,
      language: lang,
      description: description || null,
      // `services` is deliberately not written.
      //
      // It duplicated `scheduling_services`, which is where every part of the
      // platform actually reads them from — and it was left empty even for an
      // account with three services, so anything that trusted it saw a
      // business selling nothing.
      clients_per_week: clientsPerWeek || null,
      // `tools` IS persisted, and that is deliberate.
      //
      // main removed this write (commit eb57f3f) because `business_profiles`
      // had no `tools` column and PostgREST answered PGRST204, failing the whole
      // upsert. That was correct for main's schema. It is not correct here:
      // migration 20260812_add_onboarding_intelligence_columns.sql adds `tools`
      // (with pain_points, goals, payment_mode, online_presence_mode,
      // needs_stripe_connect, extracted_data). Do not remove it again without
      // first checking the migration set.
      // See docs/requirements/BUSINESS_OS_REPORTS_MERGE_REQUIREMENT.md - F2 / D10.
      tools,
      profile_completeness: profileCompleteness,
      onboarding_completed: true,
      // NEW: Intelligent onboarding fields
      pain_points: painPoints,
      goals,
    };

    /*
     * The business's OWN website address, and only when we were actually given one.
     *
     * This used to be `website_url: profile?.website_url || null` — reading the
     * legacy `profile` branch of the request, which the only caller does not
     * send. It sends four keys: company_name, vertical, language, description.
     * So the expression was always null, and every completed onboarding wrote
     * NULL over the column. An upsert that nulls a field no caller populates
     * can only destroy data.
     *
     * It matters most to the business that declines a website here: someone on
     * `booking_only` is the one most likely to HAVE a site of their own and be
     * using this platform for the booking half. The public pages, the email
     * branding and the booking email's "book again" link all reach for it.
     *
     * Onboarding still does not ask for the address — it only learns
     * `has_website` as a boolean — so in practice this key is absent and the
     * column is left alone for Settings to fill.
     */
    if (profile?.website_url) {
      profileData.website_url = profile.website_url;
    }

    // Add new configuration fields if using new format
    if (configuration) {
      profileData.payment_mode = configuration.payment_mode;
      // `collection_method` is deliberately NOT written any more.
      //
      // It answered "how does money reach this business" with one word, and
      // for most businesses there is no such word: this account sells a free
      // service, one paid by card and one billed against an invoice, and the
      // column said "invoice" for all three. Each service now carries its own
      // `collection`, and everything downstream — whether Stripe is needed,
      // what the client journey looks like, which paperwork is owed — is read
      // from those.
      //
      // The column stays for accounts whose services predate it: shapeFromProfile
      // falls back to it when there are no services to count. Writing it now
      // would keep manufacturing stale answers for that fallback to trust.
      profileData.online_presence_mode = configuration.online_presence_mode;
      profileData.needs_stripe_connect = configuration.needs_stripe_connect;
      profileData.extracted_data = configuration; // Store full config for debugging
    }

    const profileResult = await businessProfileRepository.upsert(profileData);

    if (profileResult.error) {
      requestLogger.error({ err: profileResult.error, userId: user.id }, 'Failed to upsert business profile');
      return NextResponse.json(
        { success: false, error: 'Failed to save profile' },
        { status: 500 }
      );
    }

    // 3.5. Activate capabilities based on profile (DATABASE-DRIVEN INTELLIGENCE)
    requestLogger.info({ userId: user.id, vertical }, 'Activating capabilities from profile');

    // Build profile for capability activation
    const activationProfile = {
      vertical,
      clients_per_week: clientsPerWeek,
      tools,
      pain_points: painPoints,
      goals,
      has_website: configuration?.online_presence_mode === 'full_website' ||
                   configuration?.online_presence_mode === 'website_only' ||
                   profile?.has_website
    };

    // If using new format with computed capabilities, create capability objects
    let capabilityObjects = capabilities;
    if (useNewFormat && configuration?.capabilities) {
      capabilityObjects = configuration.capabilities.map(capKey => ({
        id: capKey,
        name: capKey,
        category: 'computed'
      }));
    }

    const capabilityResult = await capabilityActivationService.activateFromProfile(
      user.id,
      activationProfile,
      capabilityObjects,
      'onboarding'
    );

    if (capabilityResult.error) {
      requestLogger.error(
        { err: capabilityResult.error, userId: user.id },
        'Failed to activate capabilities (non-blocking)'
      );
    } else if (capabilityResult.data) {
      requestLogger.info(
        {
          userId: user.id,
          activated: capabilityResult.data.activated,
          skipped: capabilityResult.data.skipped,
          count: capabilityResult.data.activated.length
        },
        'Capabilities activated from profile'
      );
    }

    // 3.6. Activate building blocks based on profile and conditions
    requestLogger.info({ userId: user.id }, 'Activating building blocks from profile');

    const blockResult = await capabilityConditionEvaluator.activateBlocksForProfile(user.id);

    if (blockResult.error) {
      requestLogger.error(
        { err: blockResult.error, userId: user.id },
        'Failed to activate building blocks (non-blocking)'
      );
    } else if (blockResult.data) {
      requestLogger.info(
        {
          userId: user.id,
          activated: blockResult.data.activated,
          skipped: blockResult.data.skipped,
          count: blockResult.data.activated.length
        },
        'Building blocks activated from profile'
      );
    }

    // 4. Seed CRM pipeline stages
    // Priority: configuration.pipeline_stages > pipelineStages > vertical defaults
    let pipelineResult;
    const stagesToUse = configuration?.pipeline_stages || pipelineStages;
    /** Stages the build could not write, reported rather than logged and forgotten. */
    const failedStages: Array<{ name: string; reason: string }> = [];

    // Check if user already has pipeline stages
    const existingStages = await crmPipelineStagesRepository.list(user.id);
    const hasExistingStages = existingStages.data && existingStages.data.length > 0;

    if (hasExistingStages) {
      // User already has pipeline stages, skip creation
      requestLogger.info({ userId: user.id, existingCount: existingStages.data?.length }, 'User already has pipeline stages, skipping');
      pipelineResult = existingStages;
    } else if (stagesToUse && stagesToUse.length > 0) {
      requestLogger.info({ userId: user.id, stageCount: stagesToUse.length }, 'Creating pipeline stages from configuration');
      // Create stages from configuration
      // Every create is checked.
      //
      // This loop used to await each insert, discard the result, and then
      // report success using the array it was given — so a pipeline that never
      // reached the database was indistinguishable from one that did. The user
      // arrived at a CRM with no stages and nothing anywhere said why.
      const createdStages: typeof stagesToUse = [];
      for (const stage of stagesToUse) {
        const stageResult = await crmPipelineStagesRepository.create({
          user_id: user.id,
          vertical,
          stage_key: stage.stage_key,
          stage_label: stage.stage_label,
          position: stage.position,
          color: stage.color,
          stage_type: stage.stage_type,
          is_primary_client_stage: stage.is_primary_client_stage,
        });

        if (stageResult.error) {
          requestLogger.error(
            { err: stageResult.error, userId: user.id, stageKey: stage.stage_key },
            'Failed to create pipeline stage'
          );
          failedStages.push({ name: stage.stage_label, reason: stageResult.error.message });
        } else {
          createdStages.push(stage);
        }
      }

      pipelineResult = { data: createdStages, error: null };
    } else {
      requestLogger.info({ userId: user.id, vertical }, 'Seeding CRM pipeline stages from vertical defaults');
      pipelineResult = await crmPipelineStagesRepository.seedDefaults(user.id, vertical);

      if (pipelineResult.error) {
        requestLogger.warn({ err: pipelineResult.error, userId: user.id, vertical }, 'Failed to seed pipeline stages (non-blocking)');
      } else {
        requestLogger.info({ userId: user.id, stageCount: pipelineResult.data?.length }, 'Pipeline stages seeded');
      }
    }

    // 5. Create services from onboarding data
    // IMPORTANT: Use ONLY ONE source to avoid duplication
    // Priority: services (legacy format with full data) > configuration.services (new format)
    // The legacy format is populated from the same source but has richer data (currency already set)
    const createdServices = [];
    /**
     * Services the build could not write, and why.
     *
     * These were logged as warnings and then reported as a successful build,
     * so an account could arrive at the dashboard with zero services while
     * every screen said everything worked. A failure the user cannot see is a
     * failure they debug by wondering what they did wrong.
     */
    const failedServices: Array<{ name: string; reason: string }> = [];

    // What the business charges in — read from the prices they actually typed,
    // and only falling back to the interface language when nobody said. A
    // Hebrew-speaking practice serving clients in the United States charges in
    // dollars, and deriving currency from language put a shekel sign on every
    // one of its prices.
    const currency = resolveBusinessCurrency(
      [...(services || []), ...(configuration?.services || [])],
      lang
    );

    /**
     * A currency code the services table will accept.
     *
     * The request schema takes any string, because rejecting the whole build
     * over an unrecognised code would lose everything else the conversation
     * collected. Anything outside the four the platform stores falls back to
     * the business's own currency rather than being written through.
     */
    const serviceCurrency = (code: string | null | undefined) =>
      code === 'USD' || code === 'EUR' || code === 'ILS' || code === 'GBP' ? code : currency;

    // Check if user already has services (prevents duplication on page refresh)
    const existingServices = await schedulingServiceRepository.listAll(user.id);
    const hasExistingServices = existingServices.data && existingServices.data.length > 0;

    if (hasExistingServices) {
      // User already has services, skip creation to prevent duplicates
      requestLogger.info({ userId: user.id, existingCount: existingServices.data?.length }, 'User already has services, skipping creation');
    } else if (services && services.length > 0) {
      // Legacy format: use services array directly (preferred - has currency)
      requestLogger.info({ userId: user.id, serviceCount: services.length }, 'Creating services from legacy format');

      for (const service of services) {
        const plan = service.payment_plan;

        const scheduled = service.is_scheduled !== false;

        const serviceResult = await schedulingServiceRepository.create({
          user_id: user.id,
          service_name: service.service_name,
          duration_minutes: service.duration_minutes ?? null,
          price: service.price,
          currency: serviceCurrency(service.currency),
          is_scheduled: scheduled,
          sale_mode: service.sale_mode || 'direct',
          // Only a priced service is collected at all, and never 'online' by
          // default — that is the one value that makes Stripe mandatory.
          collection: (service.price || 0) > 0
            ? (service.collection === 'online' ? 'online' : 'invoice')
            : null,
          // The instalment arrangement rides on the service, as it does on the
          // other branch and in the settings screen — and it is the only place
          // it can live for a service priced per client, where there is no
          // total yet to divide into a plan.
          ...(plan && plan.installment_count >= 2
            ? {
                payment_type: 'installments' as const,
                installment_count: plan.installment_count,
                installment_frequency: plan.installment_frequency,
              }
            : {}),
          is_active: true,
        });

        if (serviceResult.error) {
          requestLogger.error({ err: serviceResult.error, serviceName: service.service_name }, 'Failed to create service');
          failedServices.push({ name: service.service_name, reason: serviceResult.error.message });
        } else if (serviceResult.data) {
          createdServices.push(serviceResult.data);
          requestLogger.info({ serviceId: serviceResult.data.id, serviceName: service.service_name }, 'Service created');
        }
      }
    } else if (configuration?.services && configuration.services.length > 0) {
      // New format (fallback only): convert from configuration.services
      // Only use this if legacy services array is empty
      requestLogger.info({ userId: user.id, serviceCount: configuration.services.length }, 'Creating services from configuration (fallback)');

      // A price quoted per client is stored as null, and null means "on request"
      // from here on. `|| 0` turned every such service into a free one — no
      // payment step at booking, and the word "free" on a public page for work
      // that costs money.
      //
      // Decided per service, not per business: "some fixed, some quoted" is the
      // commonest shape there is, and a rule that needed EVERY price to be
      // absent got that case exactly wrong — the quoted half came out free
      // while the priced half looked fine, which is the hardest kind of wrong
      // to notice.
      for (const service of configuration.services) {
        const quoted = service.price === null || service.price === undefined;
        const plan = service.payment_plan;

        const serviceResult = await schedulingServiceRepository.create({
          user_id: user.id,
          service_name: service.name,
          // Null rather than a made-up hour where no length was given; the
          // length itself is independent of whether a time is booked.
          duration_minutes: service.duration_minutes ?? null,
          is_scheduled: service.is_scheduled !== false,
          /*
           * The chat's own answer, where it gave one.
           *
           * `quoted` above infers the same thing from a missing price, which is
           * what this codebase had to do before the fact existed — and the
           * comment beside it records what that cost: a service priced per
           * client came out looking free. The inference stays as the fallback
           * for a payload written before the chat learned to say so.
           */
          sale_mode: service.sale_mode || (quoted ? 'proposal' : 'direct'),
          collection: !quoted && (service.price || 0) > 0
            ? (service.collection === 'online' ? 'online' : 'invoice')
            : null,
          // Zero only where they actually said zero.
          price: quoted ? null : service.price,
          // The service's own currency where the person named one; the
          // business's otherwise.
          currency: serviceCurrency(service.currency),
          // The instalment arrangement rides on the service itself, which is
          // where the settings screen keeps it too. That matters most for a
          // quoted service: `payment_plans` needs a total to divide, and a
          // project priced per client has none until the quote — but "three
          // monthly payments" is still true, and worth keeping, so the amounts
          // can be worked out when the figure is agreed.
          ...(plan && plan.installment_count >= 2
            ? {
                payment_type: 'installments' as const,
                installment_count: plan.installment_count,
                installment_frequency: plan.installment_frequency,
              }
            : {}),
          is_active: true,
        });

        if (serviceResult.error) {
          requestLogger.error({ err: serviceResult.error, serviceName: service.name }, 'Failed to create service');
          failedServices.push({ name: service.name, reason: serviceResult.error.message });
        } else if (serviceResult.data) {
          createdServices.push(serviceResult.data);
          requestLogger.info({ serviceId: serviceResult.data.id, serviceName: service.name }, 'Service created');
        }
      }
    }

    // 5.5. Payment plans named in the chat
    //
    // "6000₪, or twelve monthly payments" is the same act as building a plan in
    // the service settings, so saying it once should be enough. The plan is a
    // template — an offer attached to a service — and the per-client agreement
    // is created later, when someone actually books it.
    for (const created of createdServices) {
      // Either array can be the one carrying the plan: the legacy list is what
      // the services were built from, and the configuration list is what the
      // extraction wrote. Looking in only one of them meant a plan edited on
      // the plan screen never became a template.
      const described =
        (services || []).find(candidate => candidate.service_name === created.service_name)
        || (configuration?.services || []).find((candidate: any) => candidate.name === created.service_name);
      const plan = described?.payment_plan;
      if (!plan || !plan.installment_count || plan.installment_count < 2) continue;

      // No template without a total. A quoted service keeps its instalment
      // arrangement on the service itself (above); the plan with real figures
      // is created when the client is quoted.
      const total = created.price || 0;
      if (total <= 0) continue;

      const planResult = await paymentPlanRepository.create({
        user_id: user.id,
        service_id: created.id,
        name: `${created.service_name} — ${plan.installment_count}x`,
        total_amount: total,
        currency: created.currency || currency,
        installment_count: plan.installment_count,
        // Rounded to the minor unit; the schedule itself is Stripe's to compute
        // when a client signs up, and this is the shop-window figure.
        installment_amount: Math.round((total / plan.installment_count) * 100) / 100,
        installment_frequency: plan.installment_frequency,
        is_active: true,
      });

      if (planResult.error) {
        requestLogger.warn(
          { err: planResult.error, service: created.service_name },
          'Could not create the payment plan described in the chat (non-blocking)'
        );
      } else {
        requestLogger.info(
          { serviceId: created.id, installments: plan.installment_count },
          'Payment plan created from the conversation'
        );
      }
    }

    /*
     * Write their intake form.
     *
     * AFTER the services exist, because the questions are built from what this
     * business actually sells — a form generated before them would describe the
     * trade in general rather than this business in particular.
     *
     * A DRAFT. It reaches nobody until the owner reads it and publishes, which
     * is the first thing the readiness card will ask them to do.
     *
     * Only for businesses that said they collect intake. Generating one for
     * everybody would put an unread draft and a standing "publish this" prompt
     * in front of businesses that never asked for a form.
     *
     * Never fatal, and never awaited for its answer: a business whose onboarding
     * failed because a model was slow has lost far more than an intake form.
     */
    if (configuration?.needs_intake) {
      try {
        const { intakeGenerationService } = await import('@/lib/services/IntakeGenerationService');
        const intake = await intakeGenerationService.generateIntakeForm(user.id);

        requestLogger.info(
          {
            userId: user.id,
            formId: intake.formId,
            questions: intake.questionCount,
            // 'fallback' means the model was not reachable and the questions
            // are generic. Worth knowing here rather than discovering from a
            // confused owner reading three stock questions.
            contentSource: intake.contentSource,
          },
          intake.success ? 'Intake draft generated during onboarding' : 'Intake generation failed'
        );
      } catch (intakeError) {
        requestLogger.error(
          { err: intakeError, userId: user.id },
          'Intake generation threw during onboarding (non-blocking)'
        );
      }
    }

    // 6. Trigger AI website generation
    // Only trigger if user explicitly wants a website (full_website or website_only mode)
    const shouldGenerateWebsite =
      configuration?.online_presence_mode === 'full_website' ||
      configuration?.online_presence_mode === 'website_only';

    let websiteGenerated = false;
    let websiteError: string | null = null;

    if (shouldGenerateWebsite) {
      requestLogger.info({ userId: user.id, onlinePresenceMode: configuration?.online_presence_mode }, 'Starting AI website generation');

      try {
        // Import and call the service directly instead of making HTTP request
        // This avoids auth cookie issues with internal fetch calls
        const { WebsiteGenerationService } = await import('@/lib/services/WebsiteGenerationService');
        const websiteService = new WebsiteGenerationService();

        // AWAIT the website generation to ensure it completes before returning
        const result = await websiteService.generateWebsite(user.id);

        if (result.success) {
          websiteGenerated = true;
          requestLogger.info(
            { userId: user.id, homepageId: result.homepageId, blocksCreated: result.blocksCreated },
            'Website generation completed successfully'
          );
        } else {
          websiteError = result.error || 'Unknown error';
          requestLogger.warn({ userId: user.id, error: result.error }, 'Website generation failed');
        }
      } catch (err) {
        websiteError = (err as Error).message;
        requestLogger.error({ err, userId: user.id }, 'Website generation error');
      }
    } else {
      requestLogger.info({ userId: user.id, onlinePresenceMode: configuration?.online_presence_mode }, 'Skipping website generation (not requested)');

      // Declining a website is a choice about the shape of an online presence,
      // not about whether clients can reach you. Until now this branch created
      // nothing at all: the business finished onboarding with services, hours
      // and prices, and no address on the internet where anyone could act on
      // them — while the dashboard told it to go and publish a site it had
      // just said it did not want.
      //
      // A booking link needs no site, works in a WhatsApp message, and arrives
      // already done, so one whole step of setup is finished before they see it.
      try {
        const codeResult = await businessProfileRepository.getUserCode(user.id);

        if (codeResult.data) {
          // No flow pinned to the link.
          //
          // It used to carry one derived from the business-wide
          // `collection_method`, which cannot describe a business selling a
          // card-paid session and an invoiced programme — one word had to
          // stand for both, and whichever it picked was wrong for half the
          // catalogue. The booking page already rebuilds its steps from the
          // service the client selects, so the link carries no journey and the
          // service decides.
          // Named in the language the business is being set up in. The
          // repository has no language of its own, so the words come from here.
          const linkNames = lang === 'he'
            ? { booking: 'לינק להזמנות', contact: 'טופס יצירת קשר' }
            : lang === 'es'
              ? { booking: 'Enlace de reserva', contact: 'Formulario de contacto' }
              : { booking: 'Booking Link', contact: 'Contact Form' };

          const linksResult = await smartLinkRepository.getOrCreateDefaultLinks(
            user.id,
            codeResult.data,
            { names: linkNames }
          );
          requestLogger.info(
            { userId: user.id, bookingLink: linksResult.data?.booking?.code ?? null },
            'Created a booking link in place of a website'
          );
        } else {
          requestLogger.warn({ userId: user.id, err: codeResult.error }, 'No user code — skipped booking link');
        }
      } catch (err) {
        // Never fatal: the account is already built, and the dashboard will ask
        // for a way to book rather than the user losing the whole onboarding.
        requestLogger.error({ err, userId: user.id }, 'Could not create a booking link');
      }
    }

    // 7. Return success
    requestLogger.info(
      {
        userId: user.id,
        capabilitiesActivated: capabilityResult.data?.activated?.length || 0,
        servicesCreated: createdServices.length,
        servicesFailed: failedServices.length,
        pipelineStages: pipelineResult.data?.length || 0,
        pipelineStagesFailed: failedStages.length,
        useNewFormat
      },
      failedServices.length > 0 || failedStages.length > 0
        ? 'Onboarding build finished with failures'
        : 'Onboarding build completed successfully'
    );

    return NextResponse.json({
      success: true,
      profile: profileResult.data,
      pipeline_stages: pipelineResult.data || [],
      services: createdServices,
      services_failed: failedServices,
      pipeline_stages_failed: failedStages,
      capabilities_enabled: configuration?.capabilities || capabilities?.map(c => c.id) || [],
      building_blocks: configuration?.building_blocks || {},
      online_presence_mode: configuration?.online_presence_mode || 'none',
      payment_mode: configuration?.payment_mode || 'none',
      website_generated: websiteGenerated,
      website_error: websiteError,
      redirect: '/business-os'
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      requestLogger.warn({ err: error }, 'Validation error');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? error.errors : undefined
        },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error }, 'Build request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
      },
      { status: 500 }
    );
  }
}
