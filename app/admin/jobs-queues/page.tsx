'use client';

/**
 * `/admin/jobs-queues` — Scheduled jobs & queues (admin reorganisation slice 5,
 * part C). Protected by `app/admin/layout.tsx` (`requireAdminPage`), and its
 * data route by `requireAdmin`. Read-only apart from Drain now
 * (ADMIN_BOS_CLEANUP slice 7d), which lives in the view's per-queue dialog.
 */

import { JobsQueuesView } from '../components/jobs/JobsQueuesView';

export default function AdminJobsQueuesPage() {
  return <JobsQueuesView />;
}
