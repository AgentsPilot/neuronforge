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
import { notFound } from 'next/navigation';
import { StandaloneBookingWidget } from './StandaloneBookingWidget';
import { isValidLocale, getDirection, type Locale } from '@/lib/i18n/config';

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
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    duration_minutes: number;
    price: number | null;
    currency: string;
  }>;
  config?: {
    logoUrl?: string;
    primaryColor?: string;
    language?: string;
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
      console.error(`Availability API returned ${response.status} for userCode: ${userCode}`);
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
          language: configData.config?.language
        };
      }
    }

    return {
      success: availData.success,
      businessName: availData.businessName,
      timezone: availData.timezone,
      services: availData.services || [],
      config
    };
  } catch (error) {
    console.error('Failed to fetch business data:', error);
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
  const { service: initialServiceId, services: servicesParam, flow: flowParam } = await searchParams;
  const businessData = await getBusinessData(userCode);

  // Parse custom flow from query param
  const customFlow = parseFlowParam(flowParam);

  if (!businessData?.success) {
    notFound();
  }

  // Filter services if `services` param is provided (comma-separated IDs)
  let filteredServices = businessData.services;
  if (servicesParam) {
    const allowedServiceIds = servicesParam.split(',').map(id => id.trim());
    filteredServices = businessData.services.filter(s => allowedServiceIds.includes(s.id));
  }

  const primaryColor = businessData.config?.primaryColor || '#4F6EF7';
  const language = (businessData.config?.language || 'en') as Locale;
  const isRTL = isValidLocale(language) && getDirection(language) === 'rtl';
  const labels = LABELS[language as keyof typeof LABELS] || LABELS.en;

  // Always use Heebo font (platform standard)
  const heeboFontLink = 'https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&subset=hebrew,latin&display=swap';

  return (
    <>
      {/* Google Fonts - Heebo (platform standard) */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href={heeboFontLink} />

      {/* Global styles from theme */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            :root {
              --booking-primary: ${primaryColor};
              --booking-primary-hover: ${primaryColor}dd;
            }
            body {
              font-family: 'Heebo', sans-serif;
            }
            /* Phone input styles */
            .phone-input-booking .PhoneInputInput {
              width: 100%;
              padding: 0.5rem 1rem;
              border: 1px solid #d1d5db;
              border-radius: 0.5rem;
              font-size: 1rem;
              outline: none;
              transition: all 0.2s;
            }
            .phone-input-booking .PhoneInputInput:focus {
              border-color: ${primaryColor};
              box-shadow: 0 0 0 2px ${primaryColor}33;
            }
            .phone-input-booking .PhoneInputCountry {
              display: none;
            }
          `
        }}
      />

      <main className="min-h-screen bg-gray-50" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Header */}
        <header className="bg-white border-b border-gray-200 py-6">
          <div className="max-w-3xl mx-auto px-4">
            {businessData.config?.logoUrl && (
              <img
                src={businessData.config.logoUrl}
                alt={businessData.businessName}
                className="h-12 mb-4"
              />
            )}
            <h1 className="text-2xl font-bold text-gray-900">
              {labels.bookWith} {businessData.businessName}
            </h1>
            <p className="text-gray-600 mt-1">
              {labels.selectService}
            </p>
          </div>
        </header>

        {/* Booking Content */}
        <div className="max-w-3xl mx-auto px-4 py-8">
          <StandaloneBookingWidget
            userCode={userCode}
            services={filteredServices}
            timezone={businessData.timezone}
            primaryColor={primaryColor}
            locale={language}
            initialServiceId={initialServiceId}
            clientFlow={customFlow}
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
