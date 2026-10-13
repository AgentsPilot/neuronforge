import { redirect } from 'next/navigation';

/**
 * Calling off an appointment, which now happens on the portal itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A REDIRECT, NOT A SCREEN.
 *
 * This was a standalone mount point: the panel, then the portal's other cards
 * underneath it, inside the portal shell but without the booking card above —
 * so the same action looked like a different page depending on whether the
 * client came from their email or from the portal.
 *
 * Every task on the index opens as a card under the booking now, so this sends
 * the client there with the card already open. The route stays because ten
 * links across the email templates point at these four paths and a link in
 * somebody's inbox has to keep working; deleting one is the mistake that left
 * the package rows pointing at a removed `/reschedule/[token]` for weeks.
 *
 * It also closes the second half of the same gap. The index trades the token
 * for a grant cookie and rewrites its address; a task screen did neither, so
 * arriving here left the credential sitting in the address bar for the whole
 * visit. Landing on the index means that happens here too.
 *
 * The token is carried through unchanged — it is still the credential, and the
 * index is what exchanges it.
 *
 * A server component, so the redirect happens before anything paints: a client
 * is never shown one screen for a moment and then moved. Same shape as
 * `/proposal/[token]`, which redirects into the portal for the same reason.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default async function PortalCancelRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/book/manage/${token}?task=cancel`);
}
