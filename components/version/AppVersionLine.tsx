'use client';

/**
 * One small line saying which build is running, e.g.
 * `Staging · a1b2c3d · built 2026-01-02 03:04 UTC` (app version stamp R19;
 * DEVELOPMENT_LIFECYCLE.md §5.4; SA-V8).
 *
 * Shown in Business OS Settings and in the admin shell, so a customer, the
 * on-duty person or a bug report can quote it. It fetches the public
 * `/api/version` once, uncached, and aborts on unmount.
 *
 * A convenience, never a failure: while loading, or if the request or its
 * answer is not what the schema says, it renders nothing and logs nothing.
 *
 * @module components/version/AppVersionLine
 */

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import { appVersionSchema } from '@/lib/validation/app-version-schema';
import { formatVersionLine } from '@/lib/version/formatVersionLine';

export function AppVersionLine({ className }: { className?: string }) {
  const [line, setLine] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch('/api/version', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const body: unknown = await response.json();
        const data = (body as { data?: unknown } | null)?.data;
        const parsed = appVersionSchema.safeParse(data);
        if (parsed.success && !controller.signal.aborted) setLine(formatVersionLine(parsed.data));
      } catch {
        // Deliberately silent: an aborted or failed probe just shows no line.
      }
    })();
    return () => controller.abort();
  }, []);

  if (!line) return null;
  return (
    <p dir="ltr" data-testid="app-version-line" className={cn('text-xs font-mono select-all', className)}>
      {line}
    </p>
  );
}

export default AppVersionLine;
