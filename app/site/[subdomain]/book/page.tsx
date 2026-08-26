/**
 * Public Booking Page
 * Allows visitors to book services from a business's website
 * Accessible at /{subdomain}/book or {subdomain}.agentpilot.io/book
 */

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BookingWidget } from './BookingWidget';
import { isValidLocale, getDirection, type Locale } from '@/lib/i18n/config';

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
  services: Array<{
    id: string;
    name: string;
    description: string | null;
    duration_minutes: number;
    price: number | null;
    currency: string;
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

  const primaryColor = websiteData?.theme?.colors?.primary || '#4F6EF7';
  const language = (websiteData?.language || 'en') as Locale;
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
              padding: 0.625rem 1rem;
              border: 1px solid #e5e7eb;
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
          <BookingWidget
            subdomain={subdomain}
            services={businessData.services}
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
