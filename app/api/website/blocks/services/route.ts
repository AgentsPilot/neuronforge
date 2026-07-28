/**
 * Website Block Services API
 * GET - Fetch real services for website blocks (Services, Pricing blocks)
 *
 * This endpoint provides live data for website block renderers,
 * ensuring services are always up-to-date with the Scheduling capability.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { SchedulingServiceRepository, type SchedulingService } from '@/lib/repositories/SchedulingRepository';

const logger = createLogger({ module: 'WebsiteBlockServicesAPI' });

// Service icon mapping based on common service keywords
function getServiceIcon(serviceName: string): string {
  const name = serviceName.toLowerCase();

  if (name.includes('consult') || name.includes('session') || name.includes('call')) return 'MessageCircle';
  if (name.includes('coach') || name.includes('mentor')) return 'Target';
  if (name.includes('therapy') || name.includes('counsel')) return 'Heart';
  if (name.includes('class') || name.includes('workshop') || name.includes('course')) return 'GraduationCap';
  if (name.includes('massage') || name.includes('spa') || name.includes('wellness')) return 'Sparkles';
  if (name.includes('fitness') || name.includes('training') || name.includes('workout')) return 'Dumbbell';
  if (name.includes('design') || name.includes('creative')) return 'Palette';
  if (name.includes('photo') || name.includes('video')) return 'Camera';
  if (name.includes('legal') || name.includes('law')) return 'Scale';
  if (name.includes('finance') || name.includes('account') || name.includes('tax')) return 'Calculator';
  if (name.includes('tech') || name.includes('development') || name.includes('code')) return 'Code';
  if (name.includes('marketing') || name.includes('seo') || name.includes('ads')) return 'TrendingUp';

  return 'Star';
}

// Format price for display
function formatPrice(price: number, currency: string = 'USD'): string {
  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
    ILS: '₪',
    GBP: '£'
  };
  const symbol = symbols[currency] || '$';
  return `${symbol}${price.toFixed(0)}`;
}

// Transform database service to block-friendly format
interface BlockService {
  id: string;
  name: string;
  description: string;
  icon: string;
  price?: string;
  priceRaw?: number;
  currency?: string;
  duration?: string;
  durationMinutes?: number;
  isActive: boolean;
}

function transformServiceForBlock(service: SchedulingService): BlockService {
  return {
    id: service.id,
    name: service.service_name,
    description: service.description || '',
    icon: getServiceIcon(service.service_name),
    price: service.price ? formatPrice(service.price, service.currency) : undefined,
    priceRaw: service.price || undefined,
    currency: service.currency,
    duration: service.duration_minutes ? `${service.duration_minutes} min` : undefined,
    durationMinutes: service.duration_minutes,
    isActive: service.is_active
  };
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Parse query params
    const { searchParams } = new URL(request.url);
    const subdomain = searchParams.get('subdomain');
    const activeOnly = searchParams.get('active_only') !== 'false'; // Default true
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const includeRaw = searchParams.get('include_raw') === 'true';

    let userId: string;

    // If subdomain is provided, look up the website owner (public access)
    if (subdomain) {
      const { data: websitePage, error: pageError } = await supabaseServer
        .from('website_pages')
        .select('user_id')
        .eq('subdomain', subdomain)
        .single();

      if (pageError || !websitePage) {
        return NextResponse.json({ success: false, error: 'Website not found' }, { status: 404 });
      }
      userId = websitePage.user_id;
    } else {
      // Authenticated access - use current user
      const user = await getUser();
      if (!user) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      userId = user.id;
    }

    const schedulingRepo = new SchedulingServiceRepository(supabaseServer);
    const servicesResult = await schedulingRepo.listAll(userId, activeOnly);

    if (servicesResult.error || !servicesResult.data) {
      requestLogger.warn({ err: servicesResult.error }, 'Failed to fetch services');
      return NextResponse.json({
        success: true,
        services: [],
        count: 0,
        source: 'database',
        message: 'No services found'
      });
    }

    const services = servicesResult.data.slice(0, limit);
    const blockServices = services.map(transformServiceForBlock);

    requestLogger.info({ userId, serviceCount: blockServices.length }, 'Fetched services for block');

    return NextResponse.json({
      success: true,
      services: blockServices,
      count: blockServices.length,
      source: 'database',
      raw: includeRaw ? services : undefined
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch services for block');
    return NextResponse.json(
      { success: false, error: 'Failed to fetch services' },
      { status: 500 }
    );
  }
}
