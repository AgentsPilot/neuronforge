// app/book/manage/[token]/reschedule/page.tsx

import { redirect } from 'next/navigation';

/**
 * The old home of the reschedule screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Picking a new time moved to `/reschedule/[token]`, out of the portal section
 * — a calendar is one task, and the portal's job of showing a client their
 * whole record is the opposite of what that screen needs.
 *
 * This stays, and redirects, because the URL is in people's inboxes. Four of
 * the email templates link here, and `manageUrlFor` in `BookingEmailService`
 * built it for every reminder sent before today. A link in a client's mail has
 * to keep working long after the code behind it has moved.
 *
 * `redirect` throws, so nothing renders and the token is never exposed to a
 * client component on this path.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default async function LegacyReschedulePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  redirect(`/reschedule/${token}`);
}
