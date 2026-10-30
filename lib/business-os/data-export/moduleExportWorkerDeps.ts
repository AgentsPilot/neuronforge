// lib/business-os/data-export/moduleExportWorkerDeps.ts
//
// Module export MX-3b (BUSINESS_OS_EXPORT_MX3_WORKPLAN.md §5, §10): the
// production wiring of `runModuleExportWorker` (moduleExportWorker.ts), kept
// apart so the worker's tests inject fakes without loading a Supabase client
// (the zipExportDeps / creditLowLineDeps precedent).
//
// SERVICE ROLE BY DESIGN (rule 4, tenant-isolation-guard step 6). The worker
// acts on module jobs of every account, so the two export repositories and
// the identity lookup run on `supabaseServer`. Every read here is keyed on the
// ids the worker passes, which are the CLAIMED row's own `request_id` and
// `user_id`, never a request value (the cron route takes no input):
//
// - the job writes filter on id + user_id + this run's runner id;
// - the request read filters on id + user_id, so a job whose user_id does not
//   own its request reads nothing (SA C-4: the worker then ends it
//   `request_mismatch`);
// - the identity, language and timezone reads take the job's user_id;
// - the section readers take a context whose userId is the job's user_id.
//
// The audit port is added by the route (it owns the bounded flush, WC-7).
//
// This file and the route are the worker's only production wiring; who may
// name the two export repositories is pinned by
// lib/repositories/__tests__/exportRequestRepositories.callers.guard.test.ts.
//
// Server-only.

import 'server-only';
import { EXPORT_MODULES } from '@/lib/business-os/data-export/exportModules';
import { buildJoinedCsv } from '@/lib/business-os/data-export/joinedCsv';
import type { ModuleExportWorkerDeps } from '@/lib/business-os/data-export/moduleExportWorker';
import { ownerClock, type WarnLogger } from '@/lib/business-os/data-export/ownerClock';
import { EXPORT_SECTIONS, runExportSections } from '@/lib/business-os/data-export/sections';
import { platformSenderAddress, sendEmail } from '@/lib/notifications/emailTransport';
import { authAccountRepository } from '@/lib/repositories/AuthAccountRepository';
import { BusinessOsExportModuleJobRepository } from '@/lib/repositories/BusinessOsExportModuleJobRepository';
import { BusinessOsExportRequestRepository } from '@/lib/repositories/BusinessOsExportRequestRepository';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';

export function moduleExportWorkerDeps(log: WarnLogger): Omit<ModuleExportWorkerDeps, 'audit'> {
  const jobs = new BusinessOsExportModuleJobRepository();
  const requests = new BusinessOsExportRequestRepository();
  return {
    jobs,
    findRequest: async (requestId, userId) => {
      const found = await requests.findByIdForUser(requestId, userId);
      if (found.error) return { data: null, error: found.error };
      return { data: found.data ? { requestedAt: found.data.requested_at, origin: found.data.origin } : null, error: null };
    },
    findIdentity: (userId) => authAccountRepository.findUserIdentity(userId),
    findPreferredLanguage: (userId) => userPreferencesRepository.findPreferredLanguage(userId),
    ownerClock: (userId) => ownerClock(userId, log),
    // Registry order is kept (a section read through its parent comes after it).
    readSections: (ctx, sectionIds, logger, opts) =>
      runExportSections(
        ctx,
        EXPORT_SECTIONS.filter((section) => sectionIds.includes(section.id)),
        logger,
        opts
      ),
    buildJoinedCsv,
    moduleMap: EXPORT_MODULES,
    send: sendEmail,
    senderAddress: platformSenderAddress,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    uuid: () => crypto.randomUUID(),
  };
}
