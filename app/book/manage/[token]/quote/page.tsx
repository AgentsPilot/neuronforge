'use client';

/**
 * The client's quote, inside their own portal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS ROUTE EXISTS
 *
 * The quote already had a page at `/proposal/[token]`, and the portal linked to
 * it — so a client answering a quote was sent out of the portal to something
 * that looked like a page from somewhere else: no branded frame, no rail, none
 * of their own meetings beside it. The accept and decline buttons were never
 * missing; the context around them was.
 *
 * Sitting under `/book/manage/[token]`, this inherits that section's layout,
 * which mounts the frame and the rail ONCE for the whole section. The client
 * does not leave the portal to answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO TOKENS, AND THEY ARE NOT THE SAME ONE
 *
 * The URL carries the BOOKING token — this section's key, which the layout has
 * already validated to draw the frame. The quote is addressed by a PROPOSAL
 * token, signed against the client's email.
 *
 * This asks the portal API for it rather than minting one here. That endpoint
 * already proves the caller holds a valid booking token, already finds the
 * standing (non-superseded) quote, and already refuses to sign a draft — work
 * that must not be reimplemented on a second path, because a second path is
 * where the rule that a draft is not sendable gets forgotten.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';

import { ProposalAnswer } from '@/components/public/ProposalAnswer';
import { PublicPageSpinner } from '@/components/public/PublicSpinner';
import { StatusCard } from '@/components/public/StatusCard';
import { useOptionalPublicBrand } from '@/components/public/PublicBrandProvider';
import { createPublicT } from '@/lib/i18n/public-pages';

export default function PortalQuotePage() {
  const { token } = useParams<{ token: string }>();
  const brand = useOptionalPublicBrand();
  const t = createPublicT(brand?.locale || 'en');

  const [proposalToken, setProposalToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/book/manage/${token}`, { cache: 'no-store' });
        const data = await res.json();

        if (!cancelled) setProposalToken(data?.quote?.token ?? null);
      } catch {
        /*
         * Left null, which renders the same "nothing to answer" card as a
         * booking that genuinely has no quote. The distinction between "the
         * request failed" and "there is no quote" is not one a client can act
         * on differently, and inventing a retry button for a page they reached
         * from a link that worked would be noise.
         */
        if (!cancelled) setProposalToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) return <PublicPageSpinner />;

  /*
   * No quote on this booking, or one that cannot be opened — a draft, or a
   * client with no address to sign a token against. Says so rather than
   * rendering an empty frame.
   */
  if (!proposalToken) {
    return (
      <StatusCard
        tone="info"
        icon={AlertTriangle}
        title={t('proposal.state.not_found.title')}
        description={t('proposal.state.not_found.body')}
        inShell
      />
    );
  }

  return <ProposalAnswer token={proposalToken} embedded />;
}
