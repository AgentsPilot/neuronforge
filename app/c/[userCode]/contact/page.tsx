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
import type { Locale } from '@/lib/i18n/config';
import { BusinessInfoPanel } from '@/components/public/BusinessInfoPanel';
import { PublicFooter } from '@/components/public/PublicFooter';
import { PublicHeader } from '@/components/public/PublicHeader';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';
import { publicT } from '@/lib/i18n/public-pages';
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

// The page's own copy of these strings moved into `lib/i18n/public-pages`.

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

  const [businessData, brand] = await Promise.all([
    getBusinessData(userCode),
    resolvePublicBranding({ by: 'userCode', userCode }),
  ]);

  if (!businessData?.success || !brand) {
    notFound();
  }

  const language = brand.locale as Locale;
  const isRTL = brand.dir === 'rtl';

  return (
    <main
      dir={brand.dir}
      lang={brand.locale}
      className="min-h-screen px-4 py-8"
      style={{ background: 'var(--ap-bg)', color: 'var(--ap-text)' }}
    >
      <div className="mx-auto max-w-4xl">
        <PublicHeader
          brand={brand}
          prefix={publicT(language, 'contactWith')}
          subtitle={publicT(language, 'getInTouch')}
        />

        {/*
          A form beside a way to reach a human.

          The page offered only the form, which is the wrong answer for a client
          who would rather phone — and it is exactly the client who cannot find
          a number who gives up. The panel renders nothing when the business has
          not filled any of it in, so this collapses to a single column on the
          accounts where that is all there is.
        */}
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div>
            <ContactFormBlock
              content={{
                title: undefined, // The header carries it.
                subtitle: undefined,
                fields: [
                  { name: 'name', type: 'text', label: 'Name', required: true },
                  { name: 'email', type: 'email', label: 'Email', required: true },
                  { name: 'phone', type: 'tel', label: 'Phone', required: true },
                  { name: 'message', type: 'textarea', label: 'Message', required: true },
                ],
              }}
              styles={{ padding: 'py-0', background: '' }}
              /*
               * The business's real theme.
               *
               * This was a theme literal built here from `primaryColor` alone,
               * with `#FFFFFF`, `#111827` and `#6B7280` typed in — so unlike its
               * sibling booking page, this one ignored the template the business
               * had chosen for everything except the accent.
               */
              theme={brand.theme}
              locale={language}
              isRTL={isRTL}
              userCode={userCode}
            />
          </div>

          <aside>
            <BusinessInfoPanel
              brand={brand}
              variant="card"
              show={['contact', 'address', 'hours', 'links']}
            />
          </aside>
        </div>

        <PublicFooter brand={brand} showContact={false} />
      </div>
    </main>
  );
}
