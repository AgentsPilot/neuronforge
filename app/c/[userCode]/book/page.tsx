/**
 * Booking, by smart-link code: /c/{userCode}/book
 *
 * For a business that reaches clients by link rather than by website — an
 * external site, social media, WhatsApp, a bio link.
 *
 * The page itself is `components/public/PublicBookingPage`, shared with the
 * business's own address (`joesgym.agentspilot.ai/book`), which previously could
 * not serve this at all.
 */

import { Metadata } from 'next';
import { PublicBookingPage, publicBookingMetadata } from '@/components/public/PublicBookingPage';

interface PageProps {
  params: Promise<{ userCode: string }>;
  searchParams: Promise<{
    service?: string;    // Single service ID to pre-select
    services?: string;   // Comma-separated service IDs to filter (show only these)
    flow?: string;       // Comma-separated flow steps: scheduling,client_info,payment,intake
  }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { userCode } = await params;
  return publicBookingMetadata(userCode);
}

export default async function StandaloneBookingPage({ params, searchParams }: PageProps) {
  const { userCode } = await params;
  const { service: initialServiceId, services: servicesParam } = await searchParams;

  return (
    <PublicBookingPage
      userCode={userCode}
      initialServiceId={initialServiceId}
      servicesParam={servicesParam}
    />
  );
}
