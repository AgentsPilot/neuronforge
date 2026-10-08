'use client';

import { useParams } from 'next/navigation';

import { IntakePanel } from '@/components/public/IntakePanel';

/**
 * The intake form, reached from the link in a client's email.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A MOUNT POINT, NOT A PAGE.
 *
 * This was 360 lines that drew their own heading band, their own back link and
 * their own column, with the portal's cards stranded below. It was the screen
 * that most obviously did not belong to the section it lived in — and keeping
 * a separate page looking like the portal is work that never finishes, because
 * the two are maintained apart.
 *
 * The form is `IntakePanel` now, and the portal index renders the same
 * component in place. This route exists because the emails point at it: the
 * confirmation and the reminder both link here, and a link in somebody's inbox
 * has to keep working. What it renders is the same thing they would have seen
 * had they opened the portal instead.
 *
 * Not `embedded`: a client arriving from an email has none of the portal's
 * context on screen yet, so this mount carries the appointment summary and the
 * way back. The index's mount does not, because both are already there.
 *
 * The same shape as `/quote`, which renders `ProposalAnswer` for the same
 * reason — see `quoteAnsweredInThePortal.guard.test.ts`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function IntakeFormPage() {
  const params = useParams();
  const token = params.token as string;

  return <IntakePanel token={token} />;
}
