'use client';

/**
 * `/admin/jobs-queues` — Scheduled jobs & queues (admin reorganisation slice 5,
 * part C). Protected by `app/admin/layout.tsx` (`requireAdminPage`), and its
 * data route by `requireAdmin`. Read-only.
 */

import { JobsQueuesView } from '../components/jobs/JobsQueuesView';

export default function AdminJobsQueuesPage() {
  return <JobsQueuesView />;
}
