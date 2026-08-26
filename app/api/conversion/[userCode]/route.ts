/**
 * Conversion Config API
 * GET - Get user's conversion page configuration (branding, services, journey)
 *
 * This is a PUBLIC endpoint - no authentication required
 * Used by standalone conversion pages to load user's branding and services
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
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
      .select('id, service_name, description, duration_minutes, price, currency, status')
      .eq('user_id', config.userId)
      .eq('status', 'active')
      .order('created_at', { ascending: true });

    if (servicesError) {
      requestLogger.warn({ err: servicesError }, 'Failed to fetch services');
    }

    // Format services for the response
    const formattedServices = (services || []).map(s => ({
      id: s.id,
      name: s.service_name,
      description: s.description,
      durationMinutes: s.duration_minutes,
      price: s.price,
      currency: s.currency || 'USD'
    }));

    // Check if user has any paid services (for payment link availability)
    const hasPaidServices = formattedServices.some(s => s.price && s.price > 0);

    requestLogger.info(
      { userCode, companyName: config.companyName, serviceCount: formattedServices.length },
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
        customerJourney: config.customerJourney || ['scheduling', 'client_info', 'confirmation']
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
