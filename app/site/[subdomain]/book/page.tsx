/**
 * Public Booking Page
 * Allows visitors to book services from a business's website
 * Accessible at /{subdomain}/book or {subdomain}.agentpilot.io/book
 */

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BookingWidget } from './BookingWidget';

interface PageProps {
  params: Promise<{ subdomain: string }>;
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

export default async function PublicBookingPage({ params }: PageProps) {
  const { subdomain } = await params;
  const [businessData, websiteData] = await Promise.all([
    getBusinessData(subdomain),
    getWebsiteData(subdomain)
  ]);

  if (!businessData?.success) {
    notFound();
  }

  const primaryColor = websiteData?.theme?.colors?.primary || '#4F6EF7';
  const language = websiteData?.language || 'en';

  return (
    <>
      {/* Global styles from theme */}
      <style>
        {`
          :root {
            --booking-primary: ${primaryColor};
            --booking-primary-hover: ${primaryColor}dd;
          }
        `}
      </style>

      <main className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 py-6">
          <div className="max-w-3xl mx-auto px-4">
            <h1 className="text-2xl font-bold text-gray-900">
              Book with {businessData.businessName}
            </h1>
            <p className="text-gray-600 mt-1">
              Select a service to get started
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
          />
        </div>

        {/* Footer */}
        <footer className="bg-white border-t border-gray-200 py-6 mt-auto">
          <div className="max-w-3xl mx-auto px-4 text-center text-gray-500 text-sm">
            Powered by AgentPilot
          </div>
        </footer>
      </main>
    </>
  );
}
