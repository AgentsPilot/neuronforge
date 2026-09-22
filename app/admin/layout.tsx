/*
 * The server-side guard for every page under `/admin`.
 *
 * ── Why the guard lives HERE and not in the 21 pages ──────────────────────
 * In the App Router every `app/admin/** /page.tsx` renders as the `children` of
 * this layout, and this layout's server render completes before the page's RSC
 * payload is produced. There is no per-page "skip my parent layout" escape.
 *
 * So protection is a PROPERTY OF THE ROUTE TREE, not a convention: page 22 is
 * guarded before its author writes a line of it. Twenty-one `requireAdminPage()`
 * calls at the top of twenty-one files would have been twenty-one chances to
 * forget, and the twenty-second page is the one that gets missed.
 *
 * An `app/admin/(guarded)/` route group would also have worked, and was
 * rejected: it creates a SECOND valid position for a page, only one of which is
 * protected. That is an opt-in wearing the costume of inheritance, and it is
 * more dangerous for looking structural.
 *
 * The three escapes this does NOT close (E1 route handlers under `app/admin/`,
 * E2 soft navigation, E3 admin content outside `/admin`) are documented on
 * `requireAdminPage`. Read them before assuming this is airtight.
 *
 * ── Why the chrome moved out ──────────────────────────────────────────────
 * This file must be a Server Component to await the check. The chrome needs
 * `useState`, so it has to be a client component. Hence
 * `app/admin/components/AdminChrome.tsx`, which is the previous contents of
 * this file moved verbatim.
 */

import { requireAdminPage } from '@/lib/admin/requireAdminPage';
import AdminChrome from './components/AdminChrome';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Deliberately NOT wrapped in try/catch: `requireAdminPage` redirects by
  // throwing, and swallowing that would render the admin shell to a non-admin.
  await requireAdminPage();

  return <AdminChrome>{children}</AdminChrome>;
}
