/**
 * Standalone Booking Page
 * Allows visitors to book services without needing a website subdomain
 * Accessible at /c/[userCode]/book
 *
 * This is for users who:
 * - Have an external website (Wix, WordPress, etc.)
 * - Share booking links via social media, email, WhatsApp
 * - Don't have an AgentPilot website
 */

import { Metadata } from 'next';
import type { PageTheme } from '@/components/website/blocks/types';
import type { ServicePaymentPlan } from '@/lib/business-os/servicePaymentPlan';
import { notFound } from 'next/navigation';
import { StandaloneBookingWidget } from './StandaloneBookingWidget';
import type { CollectionMethod } from '@/lib/business-os/setup/setupGraph';
import type { Locale } from '@/lib/i18n/config';
import { BusinessInfoPanel } from '@/components/public/BusinessInfoPanel';
import { PublicFooter } from '@/components/public/PublicFooter';
import { PublicHeader } from '@/components/public/PublicHeader';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';
import { publicT } from '@/lib/i18n/public-pages';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'StandaloneBookingPage' });

interface PageProps {
  params: Promise<{ userCode: string }>;
  searchParams: Promise<{
    service?: string;    // Single service ID to pre-select
    services?: string;   // Comma-separated service IDs to filter (show only these)
    flow?: string;       // Comma-separated flow steps: scheduling,client_info,payment,intake
  }>;
}

// Flow steps type - matches LandingPageWizard
type ClientFlowStep = 'scheduling' | 'client_info' | 'booking' | 'payment' | 'intake' | 'confirmation';
// The `?flow=` parameter is gone with the widget that read it. The journey now
// comes from the service the client picks, resolved by `journeySteps` inside the
// shared booking modal — a hand-editable URL was never the right place for it.

interface BusinessData {
  success: boolean;
  businessName: string;
  timezone: string;
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    duration_minutes: number;
    price: number | null;
    currency: string;
    /** Whether booking this involves picking a time. */
    is_scheduled?: boolean | null;
    /** How the money arrives, or null where the service is free. */
    collection?: 'online' | 'invoice' | null;
    /**
     * How this service may be paid over time.
     *
     * Declared here because the type was the narrowest point in the chain: the
     * endpoint returned it and the modal renders it, but a service typed
     * without it was passed on as a single price.
     */
    paymentPlan?: ServicePaymentPlan;
  }>;
  config?: {
    logoUrl?: string;
    primaryColor?: string;
    language?: string;
    /** How the business collects, and whether a card can be charged today. */
    collectionMethod?: CollectionMethod | null;
    processorReady?: boolean;
    /**
     * The business's look — colours and fonts.
     *
     * A smart link has no website page, so this comes from the profile rather
     * than from a page's theme. Without it the booking modal rendered in the
     * platform default while the page around it wore the business's colour,
     * which is worse than either alone.
     */
    theme?: PageTheme | null;
  };
}

// The page's own copy of these strings moved into `lib/i18n/public-pages`,
// alongside the rest of what a customer reads on a public page.

async function getBusinessData(userCode: string): Promise<BusinessData | null> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  try {
    // Fetch availability data (includes business info and services)
    // Use no-store to bypass cache during debugging
    const response = await fetch(
      `${baseUrl}/api/conversion/${userCode}/availability`,
      { cache: 'no-store' }
    );

    if (!response.ok) {
      logger.error({ status: response.status, userCode }, 'Availability lookup failed');
      return null;
    }

    const availData = await response.json();

    // Also fetch conversion config for branding
    const configResponse = await fetch(
      `${baseUrl}/api/conversion/${userCode}`,
      { cache: 'no-store' }
    );

    let config = null;
    if (configResponse.ok) {
      const configData = await configResponse.json();
      if (configData.success) {
        config = {
          logoUrl: configData.config?.logoUrl,
          primaryColor: configData.config?.primaryColor,
          // The business's full look — colours AND fonts.
          //
          // The API sends it and this object dropped it on the floor: the
          // config is rebuilt field by field here, and `theme` was never one of
          // the fields, so the page fell back to `primaryColor` and the booking
          // modal opened in platform defaults. Everything downstream already
          // preferred the theme; it simply never arrived.
          theme: configData.config?.theme ?? null,
          language: configData.config?.language,
          collectionMethod: configData.config?.collectionMethod ?? null,
          processorReady: configData.config?.processorReady === true
        };
      }
    }

    return {
      success: availData.success,
      businessName: availData.businessName,
      timezone: availData.timezone,
      services: availData.services || [],
      config: config ?? undefined
    };
  } catch (error) {
    logger.error({ err: error, userCode }, 'Failed to fetch business data');
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { userCode } = await params;
  const data = await getBusinessData(userCode);

  if (!data?.success) {
    return {
      title: 'Book an Appointment',
      description: 'Schedule your appointment online.'
    };
  }

  return {
    title: `Book with ${data.businessName}`,
    description: `Schedule your appointment with ${data.businessName}. Choose from ${data.services.length} services.`
  };
}

export default async function StandaloneBookingPage({ params, searchParams }: PageProps) {
  const { userCode } = await params;
  const { service: initialServiceId, services: servicesParam } = await searchParams;

  const [businessData, brand] = await Promise.all([
    getBusinessData(userCode),
    resolvePublicBranding({ by: 'userCode', userCode }),
  ]);

  if (!businessData?.success || !brand) {
    notFound();
  }

  // Filter services if `services` param is provided (comma-separated IDs)
  let filteredServices = businessData.services;
  if (servicesParam) {
    const allowedServiceIds = servicesParam.split(',').map(id => id.trim());
    filteredServices = businessData.services.filter(s => allowedServiceIds.includes(s.id));
  }

  const language = brand.locale as Locale;

  return (
    <>
      {/*
        The colours, fonts and direction now come from the segment layout, which
        resolves them once from the business's own theme. What is left here is
        the one thing that is specific to this page: the phone field inside the
        booking modal, which is rendered by a third-party component and can only
        be reached with CSS. It reads the shell's tokens rather than a colour
        inlined per page.
      */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .phone-input-booking .PhoneInputInput {
              width: 100%;
              padding: 0.625rem 1rem;
              border: 1px solid var(--ap-border);
              border-radius: var(--ap-radius-md);
              background: var(--ap-bg);
              color: var(--ap-text);
              font-size: 1rem;
              outline: none;
              transition: all 0.2s;
            }
            .phone-input-booking .PhoneInputInput:focus {
              border-color: var(--ap-brand);
              box-shadow: 0 0 0 2px var(--ap-brand-ring);
            }
            .phone-input-booking .PhoneInputCountry { display: none; }
          `,
        }}
      />

      <main
        dir={brand.dir}
        lang={brand.locale}
        className="min-h-screen px-4 py-8"
        style={{ background: 'var(--ap-bg)', color: 'var(--ap-text)' }}
      >
        <div className="mx-auto max-w-3xl">
          <PublicHeader
            brand={brand}
            prefix={publicT(language, 'bookWith')}
            subtitle={publicT(language, 'selectService')}
          />

          {filteredServices.length === 0 ? (
            <p
              className="py-12 text-center text-sm"
              style={{ color: 'var(--ap-text-muted)' }}
            >
              {publicT(language, 'noServices')}
            </p>
          ) : (
            <StandaloneBookingWidget
              userCode={userCode}
              services={filteredServices}
              timezone={businessData.timezone}
              primaryColor={brand.theme.colors.primary}
              locale={language}
              initialServiceId={initialServiceId}
              theme={businessData.config?.theme ?? (brand.theme as PageTheme)}
              // Two separate reasons a booking may not ask for payment: the
              // business does not collect that way, or it does and Stripe is not
              // connected yet. Either one drops the step — a payment screen with
              // no processor behind it is worse than no payment screen.
              collectionMethod={businessData.config?.collectionMethod ?? null}
              processorReady={businessData.config?.processorReady === true}
            />
          )}

          {/* Hours, phone and address, for the client who would rather call
              than book online. Renders nothing when the business has given us
              none of it. */}
          <BusinessInfoPanel brand={brand} variant="footer" show={['contact', 'address', 'hours']} />

          <PublicFooter brand={brand} showContact={false} />
        </div>
      </main>
    </>
  );
}
