/**
 * Public Booking Page
 * Allows visitors to book services from a business's website
 * Accessible at /{subdomain}/book or {subdomain}.agentpilot.io/book
 */

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BookingWidget } from './BookingWidget';
import { isValidLocale, getDirection, type Locale } from '@/lib/i18n/config';
import { PublicThemeStyle } from '@/components/public/PublicThemeStyle';
import { PublicFontLinks } from '@/components/public/PublicFontLinks';
import { DEFAULT_PUBLIC_THEME } from '@/lib/branding/theme';

// Flow step types - matches the wizard
type ClientFlowStep = 'scheduling' | 'client_info' | 'booking' | 'payment' | 'intake' | 'confirmation';

interface PageProps {
  params: Promise<{ subdomain: string }>;
  searchParams: Promise<{
    service?: string;
    flow?: string;  // Comma-separated flow steps: scheduling,client_info,payment,intake
  }>;
}

// Parse flow query param into array of steps
function parseFlowParam(flow: string | undefined): ClientFlowStep[] | null {
  if (!flow) return null;

  const validSteps = ['scheduling', 'client_info', 'booking', 'payment', 'intake', 'confirmation'];
  const steps = flow.split(',').filter(s => validSteps.includes(s)) as ClientFlowStep[];

  // Ensure confirmation is always at the end
  if (steps.length > 0 && !steps.includes('confirmation')) {
    steps.push('confirmation');
  }

  return steps.length > 0 ? steps : null;
}

interface BusinessData {
  success: boolean;
  businessName: string;
  timezone: string;
  processorReady?: boolean;
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    duration_minutes: number | null;
    price: number | null;
    currency: string;
    is_scheduled?: boolean;
    collection?: 'online' | 'invoice' | null;
  }>;
  theme?: {
    colors?: {
      primary?: string;
      secondary?: string;
    };
  };
}

// Translations for booking page
const LABELS = {
  en: {
    bookWith: 'Book with',
    selectService: 'Select a service to get started',
    poweredBy: 'Powered by AgentPilot'
  },
  es: {
    bookWith: 'Reservar con',
    selectService: 'Selecciona un servicio para comenzar',
    poweredBy: 'Desarrollado por AgentPilot'
  },
  he: {
    bookWith: 'הזמנה אצל',
    selectService: 'בחר שירות להתחלה',
    poweredBy: 'מופעל על ידי AgentPilot'
  }
};

async function getBusinessData(subdomain: string): Promise<BusinessData | null> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  try {
    const response = await fetch(
      `${baseUrl}/api/website/booking/availability?subdomain=${subdomain}`,
      { next: { revalidate: 60 } }
    );

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to fetch business data:', error);
    return null;
  }
}

async function getWebsiteData(subdomain: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  try {
    const response = await fetch(
      `${baseUrl}/api/website/public/${subdomain}`,
      { next: { revalidate: 60 } }
    );

    if (!response.ok) return null;
    const data = await response.json();
    return {
      theme: data.page?.theme || null,
      language: data.page?.language || 'en'
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { subdomain } = await params;
  const data = await getBusinessData(subdomain);

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

export default async function PublicBookingPage({ params, searchParams }: PageProps) {
  const { subdomain } = await params;
  const { service: initialServiceId, flow: flowParam } = await searchParams;
  const [businessData, websiteData] = await Promise.all([
    getBusinessData(subdomain),
    getWebsiteData(subdomain)
  ]);

  // Parse custom flow from query param
  const customFlow = parseFlowParam(flowParam);

  if (!businessData?.success) {
    notFound();
  }

  /*
   * The business's theme, from the same place every other public surface takes
   * it.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS PAGE CHANGED
   *
   * This was the one public surface on none of the platform's theming. It read
   * a single hex off the website row, fell back to a legacy `#4F6EF7`, declared
   * its own `--booking-primary` on `:root`, loaded its own copy of Heebo and
   * forced `body { font-family: Heebo }` — which overrode whatever typeface the
   * business had chosen. Everything else was hardcoded Tailwind greys.
   *
   * So a business on a dark archetype sent a customer from a dark site to a
   * light grey booking page in a different typeface, mid-booking. `--booking-primary`
   * is kept as an alias because the 1,497-line widget below reads it
   * throughout; it now derives from the theme rather than competing with it.
   */
  const theme = websiteData?.theme || DEFAULT_PUBLIC_THEME;
  const primaryColor = theme.colors?.primary || DEFAULT_PUBLIC_THEME.colors.primary;
  const language = (websiteData?.language || 'en') as Locale;
  const isRTL = isValidLocale(language) && getDirection(language) === 'rtl';
  const labels = LABELS[language as keyof typeof LABELS] || LABELS.en;

  return (
    <>
      <PublicFontLinks theme={theme} />
      <PublicThemeStyle theme={theme} locale={language} scope="[data-ap-site]" />

      <style
        dangerouslySetInnerHTML={{
          __html: `
            [data-ap-site] {
              --booking-primary: var(--ap-brand);
              --booking-primary-hover: var(--ap-brand-hover);
            }
            /* Phone input styles */
            .phone-input-booking .PhoneInputInput {
              width: 100%;
              padding: 0.625rem 1rem;
              border: 1px solid var(--ap-border);
              border-radius: var(--ap-radius-md);
              background: var(--ap-surface);
              color: var(--ap-text);
              font-size: 1rem;
              outline: none;
              transition: all 0.2s;
            }
            .phone-input-booking .PhoneInputInput:focus {
              border-color: var(--ap-brand);
              box-shadow: 0 0 0 2px var(--ap-brand-ring);
            }
            .phone-input-booking .PhoneInputCountry {
              display: none;
            }
          `
        }}
      />

      <main
        data-ap-site=""
        className="min-h-screen"
        dir={isRTL ? 'rtl' : 'ltr'}
        style={{ background: 'var(--ap-bg)', color: 'var(--ap-text)' }}
      >
        {/* Header */}
        <header
          className="apc-nav py-6"
          style={{ background: 'var(--ap-surface)', borderBlockEnd: '1px solid var(--ap-border)' }}
        >
          <div className="max-w-3xl mx-auto px-4">
            <h1 className="apc-wm text-2xl font-bold" style={{ color: 'var(--ap-text)' }}>
              {labels.bookWith} {businessData.businessName}
            </h1>
            <p className="mt-1" style={{ color: 'var(--ap-text-muted)' }}>
              {labels.selectService}
            </p>
          </div>
        </header>

        {/* Booking Content */}
        <div className="max-w-3xl mx-auto px-4 py-8">
          <BookingWidget
            subdomain={subdomain}
            services={businessData.services}
            timezone={businessData.timezone}
            primaryColor={primaryColor}
            locale={language}
            initialServiceId={initialServiceId}
            // The journey follows the service now, so no flow is passed.
            processorReady={businessData.processorReady === true}
          />
        </div>

        {/* Footer */}
        <footer className="bg-white border-t border-gray-200 py-6 mt-auto">
          <div className="max-w-3xl mx-auto px-4 text-center text-gray-500 text-sm">
            {labels.poweredBy}
          </div>
        </footer>
      </main>
    </>
  );
}
