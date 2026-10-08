// app/reschedule/[token]/layout.tsx

import type { Metadata } from 'next';

import { PortalShell } from '@/components/public/PortalShell';
import { PublicBrandFrame } from '@/components/public/PublicBrandFrame';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';
import { publicT } from '@/lib/i18n/public-pages';

/**
 * Picking a new time, on a page of its own.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT LEFT THE PORTAL SECTION
 *
 * It lived at `/book/manage/[token]/reschedule`, inside the layout that draws
 * the portal. That layout exists to put a client's whole record in front of
 * them — the appointment, the money, their other meetings, the business's
 * opening hours — and none of it belongs underneath a calendar. Choosing a
 * date is one task, and a task screen is the one place a portal should get out
 * of the way.
 *
 * It keeps the business's bar and footer, because a client who has just been
 * sent here from their booking should not feel handed to a different site. It
 * is the SECTION it left, not the brand.
 *
 * The old URL still works: `/book/manage/[token]/reschedule` redirects here, so
 * every reschedule link already sitting in somebody's inbox keeps landing in
 * the right place.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const brand = await resolvePublicBranding({ by: 'bookingToken', token }, { includeInfo: false });

  return {
    title: brand ? `${publicT(brand.locale, 'reschedule')} · ${brand.businessName}` : 'Reschedule',
    // A booking link identifies a real person's appointment. Never indexed.
    robots: { index: false, follow: false },
  };
}

export default async function RescheduleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const brand = await resolvePublicBranding({ by: 'bookingToken', token });

  // An expired or invalid token still has to render something; the page below
  // shows the branded "link expired" state and this gets out of the way.
  if (!brand) return <>{children}</>;

  return (
    <PublicBrandFrame brand={brand}>
      {/* No `aside`: this screen carries one task and nothing else. */}
      <PortalShell brand={brand}>{children}</PortalShell>
    </PublicBrandFrame>
  );
}
