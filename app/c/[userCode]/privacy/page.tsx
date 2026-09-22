/**
 * The privacy notice, at a business's smart-link address.
 *
 * Reached from the consent checkbox on every public form and from the footer of
 * every smart-link page. It has to load without a login, without a cookie and
 * without a website: the whole point of the smart link is that it works for a
 * business that has nothing else.
 *
 * Inherits the branded frame from `app/c/[userCode]/layout.tsx`.
 */

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { PrivacyPolicyPage } from '@/components/public/PrivacyPolicyPage';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';
import { marketingConsentRepository } from '@/lib/repositories/MarketingConsentRepository';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'SmartLinkPrivacyPage' });

interface PageProps {
  params: Promise<{ userCode: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { userCode } = await params;
  const brand = await resolvePublicBranding({ by: 'userCode', userCode }).catch(() => null);

  return {
    title: brand ? `Privacy notice — ${brand.businessName}` : 'Privacy notice',
    // A legal notice is for the people who were sent to it, not for search.
    robots: { index: false, follow: true },
  };
}

export default async function SmartLinkPrivacyPage({ params }: PageProps) {
  const { userCode } = await params;

  const brand = await resolvePublicBranding({ by: 'userCode', userCode }).catch((err) => {
    logger.error({ err, userCode }, 'Could not resolve branding for the privacy page');
    return null;
  });

  if (!brand) notFound();

  const { data: settings } = await marketingConsentRepository.settings(brand.userId);

  /*
   * A business that has switched the notice off does not get an empty page.
   *
   * `resolvePrivacyPolicyUrl` returns null for that case, so the consent
   * checkbox renders without a link — and this route 404ing keeps the two
   * consistent. A generated notice served under a business that said it
   * publishes none would be a statement they never made.
   */
  if (settings?.privacy_policy_mode === 'none') notFound();

  return <PrivacyPolicyPage brand={brand} settings={settings} />;
}
