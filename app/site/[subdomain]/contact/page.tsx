/**
 * Contact, at the business's own address: joesgym.agentspilot.ai/contact
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS ROUTE DID NOT EXIST.
 *
 * The subdomain tree had a home page, a landing-page route, a booking page and a
 * privacy page. It had no contact page, while `/c/{userCode}/contact` had one —
 * so the address the builder shows a business as *theirs* answered 404 for the
 * one page a client is most likely to look for after "book".
 *
 * Nothing reported it. The owner sees the address, not the routing table.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Resolved by PREFIX, not by subdomain: the prefix belongs to the business, and
 * for a business that never claimed an address it IS `user_code`. Resolving it
 * that way is what lets a business with no published website still answer here.
 */

import { Metadata } from 'next';
import { PublicContactPage, publicContactMetadata } from '@/components/public/PublicContactPage';
import { PublicErrorScreen } from '@/components/public/PublicErrorScreen';
import { resolveBusinessByPrefix } from '@/lib/business-os/resolveBusinessByPrefix';

interface PageProps {
  params: Promise<{ subdomain: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { subdomain } = await params;
  const business = await resolveBusinessByPrefix(subdomain);

  if (!business) {
    return { title: 'Contact Us', description: 'Get in touch with us.' };
  }

  return publicContactMetadata(business.userCode);
}

export default async function SiteContactPage({ params }: PageProps) {
  const { subdomain } = await params;
  const business = await resolveBusinessByPrefix(subdomain);

  /*
   * Rendered, not thrown — the same reason the shared page gives. A visitor who
   * followed an address that no longer resolves should meet a page, and by the
   * time this runs the segment layout may already have flushed the response, so
   * `notFound()` cannot reliably set a status anyway.
   */
  if (!business) {
    return <PublicErrorScreen brand={null} kind="not-found" />;
  }

  return <PublicContactPage userCode={business.userCode} />;
}
