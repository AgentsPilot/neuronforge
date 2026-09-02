// hooks/useSideConsole.ts
//
// Session-scoped state for the FR8 side console (Phase B). Holds an in-memory,
// newest-first list of ConsoleEntry, bounded to a most-recent-N cap to bound memory.
// Every appended entry is passed through the defensive redaction helper before it is
// stored (so nothing credential-shaped is ever retained/rendered/copied — Phase B AC).

import { useCallback, useState } from 'react';
import type { ConsoleEntry } from '@/lib/plugins/tester/tester-types';
import { redactSensitive } from '@/lib/plugins/tester/redaction';

/** Retention cap — matches the page's existing debugLogs slice(-49) convention. */
export const CONSOLE_RETENTION_CAP = 50;

export interface UseSideConsole {
  entries: ConsoleEntry[];
  append: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: string }) => void;
  clear: () => void;
}

let entrySeq = 0;

export function useSideConsole(cap: number = CONSOLE_RETENTION_CAP): UseSideConsole {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);

  const append = useCallback<UseSideConsole['append']>(
    (partial) => {
      const entry: ConsoleEntry = {
        id: partial.id ?? `console-${Date.now()}-${entrySeq++}`,
        timestamp: partial.timestamp ?? new Date().toISOString(),
        userId: partial.userId,
        plugin: partial.plugin,
        action: partial.action,
        // Defensive redaction at capture time (belt-and-suspenders — Level 1 carries no secret).
        request: redactSensitive(partial.request),
        response: redactSensitive(partial.response),
        outcome: partial.outcome,
        durationMs: partial.durationMs,
      };
      // Newest-first; bound to the retention cap.
      setEntries((prev) => [entry, ...prev].slice(0, cap));
    },
    [cap]
  );

  const clear = useCallback(() => setEntries([]), []);

  return { entries, append, clear };
}
