'use client';

/**
 * `/admin` — the Health landing (admin reorganisation slice 4).
 *
 * Answers "is anything wrong?" in one screen of red / amber / grey tiles, each
 * linking to the page that shows the same number. Protected by
 * `app/admin/layout.tsx` (`requireAdminPage`), and its data route by
 * `requireAdmin`.
 *
 * The previous landing (the AgentsPilot platform dashboard) now lives at its
 * own URL, reachable by URL only (user decision U-6): this page deliberately
 * does not link to it.
 */

import { HealthGrid } from './components/health/HealthGrid';

export default function AdminHealthPage() {
  return <HealthGrid />;
}
