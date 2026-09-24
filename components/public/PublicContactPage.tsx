/**
 * A business's public contact page — the one implementation of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Extracted from `app/c/[userCode]/contact/page.tsx` so that TWO addresses can
 * render it: `/c/{userCode}/contact`, which smart links have always used, and
 * `joesgym.agentspilot.ai/contact`, which did not exist at all — the subdomain
 * tree had a booking page and a privacy page and no contact page, so that
 * address answered 404 while the interface presented it as the business's own.
 *
 * Extracted rather than copied, because a copy is how `/site/` and `/c/` came to
 * have two booking pages that have been drifting apart ever since.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Metadata } from 'next';
import { ContactFormBlock } from '@/components/website/blocks/ContactFormBlock';
import type { Locale } from '@/lib/i18n/config';
import { BusinessInfoPanel, hasBusinessInfo } from '@/components/public/BusinessInfoPanel';
import { PublicErrorScreen } from '@/components/public/PublicErrorScreen';
import { PublicFooter } from '@/components/public/PublicFooter';
import { PublicHeader } from '@/components/public/PublicHeader';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';
import { publicT } from '@/lib/i18n/public-pages';
import { createLogger } from '@/lib/logger';
import { platformOrigin } from '@/lib/utils/origins';

const logger = createLogger({ module: 'PublicContactPage' });

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

async function getBusinessData(userCode: string): Promise<BusinessData | null> {
  // From the one resolver; this read `process.env.NEXT_PUBLIC_APP_URL` directly.
  const baseUrl = platformOrigin();

  try {
    const response = await fetch(`${baseUrl}/api/conversion/${userCode}`, {
      next: { revalidate: 60 },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    logger.error({ err: error, userCode }, 'Failed to fetch business data');
    return null;
  }
}

/** Shared by both routes, so their titles cannot diverge. */
export async function publicContactMetadata(userCode: string): Promise<Metadata> {
  const data = await getBusinessData(userCode);

  if (!data?.success) {
    return {
      title: 'Contact Us',
      description: 'Get in touch with us.',
    };
  }

  return {
    title: `Contact ${data.config.companyName || 'Us'}`,
    description: `Get in touch with ${data.config.companyName}. We'd love to hear from you.`,
  };
}

export async function PublicContactPage({ userCode }: { userCode: string }) {
  const [businessData, brand] = await Promise.all([
    getBusinessData(userCode),
    resolvePublicBranding({ by: 'userCode', userCode }),
  ]);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * RENDERED, NOT THROWN.
   *
   * This was `notFound()`, and it ran AFTER the two awaits above. By then the
   * segment layout — which resolves branding straight from the database — has
   * already finished and Next has flushed the response shell, so the status is
   * committed as 200 and there is no longer a render pass to throw into. Next
   * tries anyway, deferring the not-found boundary onto a timer, and its own
   * `ErrorBoundary` calls `usePathname` outside a render:
   *
   *   TypeError: Cannot read properties of null (reading 'useContext')
   *     at usePathname (next/dist/client/components/navigation.js)
   *     at ErrorBoundary (next/dist/client/components/error-boundary.js)
   *     at Timeout._onTimeout
   *
   * The tell was the status code: a page calling `notFound()` should answer
   * 404, and this one answered 200 — proof the headers were already gone. It
   * was intermittent because it depends on the flush beating the fetches, which
   * on a warm server it usually does and on a cold one often does not.
   *
   * Returning cannot fail that way whatever the stream has already done. It is
   * also the better page: a smart link is handed out on WhatsApp and in bio
   * links, so a visitor who arrives after the service was withdrawn should meet
   * the business's own colours and language, not a bare platform 404.
   */
  if (!businessData?.success || !brand) {
    return <PublicErrorScreen brand={brand} kind="not-found" />;
  }

  const language = brand.locale as Locale;
  const isRTL = brand.dir === 'rtl';
  const showInfo = hasBusinessInfo(brand, ['contact', 'address', 'hours', 'links']);

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
          a number who gives up.

          The column is reserved only when there is something to put in it. The
          panel returning null is not enough on its own: the grid still held a
          20rem track, so a business that had filled none of this in got a form
          two thirds of the width under a full-width header, with empty space
          beside it. `hasBusinessInfo` is the panel's own test, exported so the
          layout and the panel cannot disagree about whether it will draw.
        */}
        <div className={`grid gap-6 ${showInfo ? 'lg:grid-cols-[1fr_20rem]' : 'grid-cols-1'}`}>
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
              /*
                `py-8`, not `py-0`.

                Zero padding put "Get in Touch" hard against the top edge of its
                card and the Send button hard against the bottom, while every
                other edge had room — which reads as a rendering fault rather
                than a tight design.
              */
              styles={{ padding: 'py-8', background: '' }}
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

          {showInfo && (
            <aside>
              <BusinessInfoPanel
                brand={brand}
                variant="card"
                show={['contact', 'address', 'hours', 'links']}
              />
            </aside>
          )}
        </div>

        <PublicFooter brand={brand} showContact={false} />
      </div>
    </main>
  );
}
