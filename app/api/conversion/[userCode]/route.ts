/**
 * Conversion Config API
 * GET - Get user's conversion page configuration (branding, services, journey)
 *
 * This is a PUBLIC endpoint - no authentication required
 * Used by standalone conversion pages to load user's branding and services
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolvePaymentCollectionCapability } from '@/lib/payments/stripeAccountContext';
import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { loadServicePaymentPlans } from '@/lib/business-os/servicePaymentPlan';
import { stripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'ConversionConfigAPI' });

interface RouteParams {
  params: Promise<{ userCode: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { userCode } = await params;
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, userCode });

  try {
    // Validate userCode format (alphanumeric, 6-10 chars)
    if (!userCode || !/^[a-z0-9]{6,10}$/i.test(userCode)) {
      return NextResponse.json(
        { success: false, error: 'Invalid user code format' },
        { status: 400 }
      );
    }

    // Get conversion config from business profile
    const configResult = await businessProfileRepository.getConversionConfig(userCode.toLowerCase());

    if (configResult.error || !configResult.data) {
      requestLogger.warn({ userCode }, 'User code not found');
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const config = configResult.data;

    // Fetch active services for this user
    const { data: services, error: servicesError } = await supabaseServer
      .from('scheduling_services')
      // Both flags, always.
      //
      // `is_active` is the Power toggle and `status` is draft/published — two
      // different questions, and the toggle sets only the first. Filtering on
      // `status` alone left a deactivated service off the website (which checks
      // both) while every smart link went on selling it.
      .select('id, service_name, description, duration_minutes, price, currency, status, is_scheduled, collection')
      .eq('user_id', config.userId)
      .eq('status', 'active')
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (servicesError) {
      requestLogger.warn({ err: servicesError }, 'Failed to fetch services');
    }

    // How each service may be paid over time. A smart link sells the same
    // services the website does, so it has to describe them the same way.
    const plansByService = await loadServicePaymentPlans(config.userId);

    // Format services for the response
    const formattedServices = (services || []).map(s => ({
      id: s.id,
      name: s.service_name,
      description: s.description,
      durationMinutes: s.duration_minutes,
      price: s.price,
      currency: s.currency || 'USD',
      // The two facts that decide this service's journey. Without them the
      // link's widget fell back to a flow stored on the link, which described
      // the same journey for a booked session and a downloadable product.
      is_scheduled: s.is_scheduled !== false,
      collection: s.collection ?? null,
      // How this service may be paid over time. Undefined for most, and the
      // widget then shows a single price as it always has.
      paymentPlan: plansByService[s.id]
    }));

    // Check if user has any paid services (for payment link availability)
    const hasPaidServices = formattedServices.some(s => s.price && s.price > 0);

    /**
     * Whether a card can actually be charged right now.
     *
     * A business can have decided in onboarding that clients pay online and
     * still not have connected Stripe — the connection asks for an ID and a
     * bank account, and it happens after setup. Until charges are enabled the
     * payment step has nothing behind it, so the public pages drop it and the
     * booking completes without one.
     */
    const capability = await resolvePaymentCollectionCapability(supabaseServer, config.userId);
    const processorReady = capability.canCollect;

    requestLogger.info(
      { userCode, companyName: config.companyName, serviceCount: formattedServices.length, processorReady },
      'Conversion config retrieved'
    );

    return NextResponse.json({
      success: true,
      config: {
        userCode: config.userCode,
        companyName: config.companyName,
        logoUrl: config.logoUrl,
        vertical: config.vertical,
        language: config.language || 'en',
        currency: config.currency || 'USD',
        primaryColor: config.primaryColor,
        customerJourney: config.customerJourney || ['scheduling', 'client_info', 'confirmation'],
        collectionMethod: config.collectionMethod,
        processorReady
      },
      services: formattedServices,
      hasPaidServices,
      // Links for this user's conversion pages
      links: {
        booking: `/c/${userCode}/book`,
        contact: `/c/${userCode}/contact`,
        ...(hasPaidServices ? { payment: `/c/${userCode}/pay` } : {})
      }
    });
  } catch (error) {
    requestLogger.error({ err: error, userCode }, 'Failed to get conversion config');
    return NextResponse.json(
      { success: false, error: 'Failed to load configuration' },
      { status: 500 }
    );
  }
}
