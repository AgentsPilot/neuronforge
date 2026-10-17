// lib/business-os/data-export/zipExportDeps.ts
//
// DE-8b: the production wiring of `runZipExport` (zipExport.ts), kept apart
// so the orchestrator's tests inject fakes without loading a Supabase client
// (the creditLeakCheckDeps precedent). DE-10a reuses it with the target
// account's context.
//
// Every repository here is a service-role singleton; each one scopes its own
// effects (job rows by (id, user_id), objects by `{user_id}/` paths).
//
// Server-only.

import 'server-only';
import { EXPORT_SECTIONS, runExportSections } from '@/lib/business-os/data-export/sections';
import { createExportFileSource } from '@/lib/business-os/data-export/fileManifest';
import { ownerClock, type WarnLogger } from '@/lib/business-os/data-export/ownerClock';
import type { ZipExportDeps } from '@/lib/business-os/data-export/zipExport';
import { businessOsDataExportJobRepository } from '@/lib/repositories/BusinessOsDataExportJobRepository';
import { businessOsDataExportStorageRepository } from '@/lib/repositories/BusinessOsDataExportStorageRepository';

export function zipExportDeps(log: WarnLogger): ZipExportDeps {
  return {
    jobs: businessOsDataExportJobRepository,
    storage: businessOsDataExportStorageRepository,
    files: createExportFileSource(),
    runSections: (ctx, logger, opts) => runExportSections(ctx, EXPORT_SECTIONS, logger, opts),
    ownerClock: (userId) => ownerClock(userId, log),
    now: () => Date.now(),
  };
}
