// lib/business-os/data-export/exportModuleSchema.ts
//
// MX-0 (BUSINESS_OS_EXPORT_MX0_WORKPLAN.md, SA C-1): the Zod side of the
// export module map. Split from `exportModules.ts` so the owner-facing drawer
// can import ids, names and switches without zod; the route is the authority
// and validates with these (XC-21 rule 2). Pure, no `server-only`.

import { z } from 'zod';
import {
  EXPORT_MODULE_IDS,
  EXPORT_MODULES,
  isModuleEnabled,
  type ExportModuleDefinition,
} from '@/lib/business-os/data-export/exportModules';

/** A module id: only the ids of the map, built from the tuple with no cast (SA C-2). */
export const ExportModuleIdSchema = z.enum(EXPORT_MODULE_IDS);

/**
 * The modules a request asks for: at least one, no more than the map holds,
 * no duplicates, and every one switched on in `map`. MX-1b uses it inside its
 * `.strict()` body schema. The map is injectable so a test can switch a module
 * off; no caller passes a switch from a request (the switch is code only).
 */
export function requestedModulesSchema(map: readonly ExportModuleDefinition[] = EXPORT_MODULES) {
  return z
    .array(ExportModuleIdSchema)
    .min(1)
    .max(map.length)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'A module is listed twice' })
    .refine((ids) => ids.every((id) => isModuleEnabled(id, map)), { message: 'A module is not available' });
}
