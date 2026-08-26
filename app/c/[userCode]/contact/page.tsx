/**
 * Standalone Contact Form Page
 * Allows visitors to submit contact inquiries without needing a website subdomain
 * Accessible at /c/[userCode]/contact
 *
 * Uses the same ContactFormBlock component as the AgentPilot website
 */

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ContactFormBlock } from '@/components/website/blocks/ContactFormBlock';
import { isValidLocale, getDirection, type Locale } from '@/lib/i18n/config';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'StandaloneContactPage' });

interface PageProps {
  params: Promise<{ userCode: string }>;
}

interface BusinessData {
  success: boolean;
  config: {
    userCode: string;
    companyName: string | null;
    logoUrl: string | null;
    language: string;
    primaryColor: string | null;
  };
  services: Array<{
    id: string;
    name: string;
  }>;
}

// Translations for contact page
const LABELS = {
  en: {
    contactWith: 'Contact',
    getInTouch: 'Get in touch with us',
    poweredBy: 'Powered by AgentPilot'
  },
  es: {
    contactWith: 'Contactar a',
    getInTouch: 'Ponte en contacto con nosotros',
    poweredBy: 'Desarrollado por AgentPilot'
  },
  he: {
    contactWith: 'יצירת קשר עם',
    getInTouch: 'נשמח לשמוע ממך',
    poweredBy: 'מופעל על ידי AgentPilot'
  }
};

async function getBusinessData(userCode: string): Promise<BusinessData | null> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  try {
    const response = await fetch(
      `${baseUrl}/api/conversion/${userCode}`,
      { next: { revalidate: 60 } }
    );

    if (!response.ok) {
      return null;
    }

    return await response.json();
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
      title: 'Contact Us',
      description: 'Get in touch with us.'
    };
  }

  return {
    title: `Contact ${data.config.companyName || 'Us'}`,
    description: `Get in touch with ${data.config.companyName}. We'd love to hear from you.`
  };
}

export default async function StandaloneContactPage({ params }: PageProps) {
  const { userCode } = await params;
  const businessData = await getBusinessData(userCode);

  if (!businessData?.success) {
    notFound();
  }

  const primaryColor = businessData.config.primaryColor || '#4F6EF7';
  const language = (businessData.config.language || 'en') as Locale;
  const isRTL = isValidLocale(language) && getDirection(language) === 'rtl';
  const labels = LABELS[language as keyof typeof LABELS] || LABELS.en;

  // Build theme object for ContactFormBlock
  const theme = {
    colors: {
      primary: primaryColor,
      secondary: '#6B7280',
      accent: primaryColor,
      background: '#FFFFFF',
      surface: '#F9FAFB',
      text: '#111827',
      textSecondary: '#6B7280'
    },
    fonts: {
      heading: 'Heebo, sans-serif',
      body: 'Heebo, sans-serif'
    },
    borderRadius: '0.5rem',
    spacing: 'normal' as const
  };

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
              --website-font-heading: 'Heebo', sans-serif;
              --website-font-body: 'Heebo', sans-serif;
            }
            body {
              font-family: 'Heebo', sans-serif;
            }
          `
        }}
      />

      <main className="min-h-screen bg-gray-50" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Header */}
        <header className="bg-white border-b border-gray-200 py-6">
          <div className="max-w-4xl mx-auto px-4">
            {businessData.config.logoUrl && (
              <img
                src={businessData.config.logoUrl}
                alt={businessData.config.companyName || 'Business'}
                className="h-12 mb-4"
              />
            )}
            <h1 className="text-2xl font-bold text-gray-900">
              {labels.contactWith} {businessData.config.companyName}
            </h1>
            <p className="text-gray-600 mt-1">
              {labels.getInTouch}
            </p>
          </div>
        </header>

        {/* Contact Form using existing ContactFormBlock */}
        <ContactFormBlock
          content={{
            title: undefined,  // Title is now in header
            subtitle: undefined,
            fields: [
              { name: 'name', type: 'text', label: 'Name', required: true },
              { name: 'email', type: 'email', label: 'Email', required: true },
              { name: 'phone', type: 'tel', label: 'Phone', required: true },
              { name: 'message', type: 'textarea', label: 'Message', required: true }
            ]
          }}
          styles={{
            padding: 'py-12',
            background: 'bg-gray-50'
          }}
          theme={theme}
          locale={language}
          isRTL={isRTL}
          userCode={userCode}
        />

        {/* Footer */}
        <footer className="bg-white border-t border-gray-200 py-6 mt-auto">
          <div className="max-w-4xl mx-auto px-4 text-center text-gray-500 text-sm">
            {labels.poweredBy}
          </div>
        </footer>
      </main>
    </>
  );
}
