/**
 * The privacy notice, at a business's own website address.
 *
 * `privacy` is a static segment, so Next matches it before the `[slug]` route
 * next door — the same way `/book` already does.
 *
 * Unlike the smart-link pages there is no shared layout here emitting the
 * theme, so this page brings its own frame, as `/book` does.
 */

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { PrivacyPolicyPage } from '@/components/public/PrivacyPolicyPage';
import { PublicFontLinks } from '@/components/public/PublicFontLinks';
import { PublicThemeStyle } from '@/components/public/PublicThemeStyle';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';
import { marketingConsentRepository } from '@/lib/repositories/MarketingConsentRepository';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'SitePrivacyPage' });

interface PageProps {
  params: Promise<{ subdomain: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { subdomain } = await params;
  const brand = await resolvePublicBranding({ by: 'subdomain', subdomain });

  return {
    title: brand ? `Privacy notice — ${brand.businessName}` : 'Privacy notice',
    // A legal notice is for the people who were sent to it, not for search.
    robots: { index: false, follow: true },
  };
}

export default async function SitePrivacyPage({ params }: PageProps) {
  const { subdomain } = await params;

  const brand = await resolvePublicBranding({ by: 'subdomain', subdomain });
  if (!brand) {
    logger.info({ subdomain }, 'No business behind this subdomain');
    notFound();
  }

  const { data: settings } = await marketingConsentRepository.settings(brand.userId);

  // Switched off means there is nothing to serve. See the smart-link twin.
  if (settings?.privacy_policy_mode === 'none') notFound();

  return (
    <>
      <PublicFontLinks brand={brand} />
      <PublicThemeStyle brand={brand} />
      <PrivacyPolicyPage brand={brand} settings={settings} />
    </>
  );
}
