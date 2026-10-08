/**
 * The link in every quote email, and where it should actually land.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS REDIRECTS
 *
 * `ProposalSendService` builds `${appUrl}/proposal/${token}`, so this is the URL
 * in every quote already sent and every one that will be. It rendered the quote
 * standalone: no portal frame, no rail, none of the client's own meetings — a
 * page that looked like it came from somewhere else, which is exactly what it
 * was.
 *
 * Changing the email would fix the next quote and none of the ones already in
 * people's inboxes. Deciding here fixes both, and it is the honest place for the
 * decision anyway: whether there is a portal to land in is a server-side fact
 * about this proposal, not something the email can know when it is written.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND WHY IT SOMETIMES DOES NOT
 *
 * `proposals.booking_id` is nullable — "null for quotes created before this
 * column existed, and for any raised outside a booking". A cold quote has no
 * appointment, so there is no portal to embed it in and no booking token to
 * sign. Those keep the standalone page, which is why it still exists.
 *
 * A SERVER COMPONENT for the same reason: the lookup and the redirect happen
 * before anything paints, so a client is never shown the standalone quote for a
 * moment and then moved. `ProposalAnswer` is the client half and is mounted
 * below when there is nothing to redirect to.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { redirect } from 'next/navigation';

import { ProposalAnswer } from '@/components/public/ProposalAnswer';
import { generateBookingToken } from '@/lib/services/BookingEmailService';
import { verifyProposalToken } from '@/lib/business-os/proposalToken';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'ProposalPage' });

/**
 * The portal this quote belongs in, or null if it belongs in none.
 *
 * Never throws. A quote that cannot be placed is still a quote the client may
 * read and answer — refusing to render it because a lookup failed would turn a
 * missing frame into a missing page.
 */
async function portalUrlFor(token: string): Promise<string | null> {
  const payload = verifyProposalToken(token);

  // Not ours, tampered with, or expired. The standalone page says which.
  if (!payload) return null;

  try {
    const { data: proposal, error } = await supabaseServer
      .from('proposals')
      .select('booking_id')
      .eq('id', payload.proposalId)
      .maybeSingle();

    if (error) {
      logger.error({ err: error }, 'Could not resolve the quote’s booking; showing it standalone');
      return null;
    }

    const bookingId = proposal?.booking_id as string | null | undefined;
    if (!bookingId) return null;

    /*
     * Signed for the SAME address the proposal token carries, which grants
     * nothing the caller did not already hold: they arrived with a valid link
     * addressed to that client, and this is the same client's own booking.
     */
    return `/book/manage/${generateBookingToken(bookingId, payload.email)}/quote`;
  } catch (err) {
    logger.error({ err }, 'Quote booking lookup threw; showing it standalone');
    return null;
  }
}

export default async function ProposalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const portalUrl = await portalUrlFor(token);

  if (portalUrl) redirect(portalUrl);

  return <ProposalAnswer token={token} />;
}
