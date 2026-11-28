/**
 * The plugin and agent-creation test harness's segment layout (server
 * component). PROD-1c A-1 and F-2.
 *
 * On every deployment (production, previews, `next dev`, a local `next start`)
 * this harness renders for admins only; the API routes are the boundary.
 * Everyone else gets the not-found screen with a `noindex` tag and no harness
 * content, at HTTP 200, not 404: the Suspense boundary of the `next/dynamic`
 * `PlatformShell` catches the `notFound()` before the status is set (F-10; SA
 * B-3 option (c)). The API routes it calls answer a real 404
 * (`lib/security/testSurfaceGate.ts`).
 *
 * This is defence in depth, not the boundary: a layout gate can be skipped by a
 * crafted router-state header (OI-21 in
 * docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md). It stays harmless because the
 * page is a client component with no server props and every API it calls
 * enforces its own authorisation (the test and debug routes through the gate).
 * G-9 in lib/__tests__/envConfigHardening.guard.test.ts keeps both true.
 */

import type { ReactNode } from 'react';

import { testSurfacePageGate } from '@/lib/security/testSurfaceGate';

// The gate reads the session on every request, so this segment is never
// prerendered (a static render would skip it).
export const dynamic = 'force-dynamic';

export default async function TestPluginsV2Layout({ children }: { children: ReactNode }) {
  await testSurfacePageGate();
  return children;
}
