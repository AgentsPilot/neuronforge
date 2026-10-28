'use client';

/**
 * Is the module export switched on? (export redesign MX-1b, workplan §9; SA
 * MX1B-1, C-1.)
 *
 * The switch is server-only. The button asks the history route once on mount:
 *
 *   probe answer (lib/client/businessOsDataExport.ts)  →  state
 *   `off`     (the route's own 404)                     →  'off'  (ZIP control)
 *   `unknown` (network, 5 s timeout, non-JSON page)     →  'off'  (ZIP, as today)
 *   `ok`      (200, valid history)                      →  'on'   (drawer, history)
 *   `error`   (any other JSON answer of our route)      →  'on'   (drawer, "history could not be loaded")
 *
 * Before the answer the state is 'unknown' and the ZIP control renders
 * unchanged. `whenKnown()` lets a click made in that moment wait for the answer
 * (at most the probe's 5 s), so a click never starts a ZIP while the switch is
 * on.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchModuleExportHistory, type ExportHistoryRequest } from '@/lib/client/businessOsDataExport';

export type ModuleExportSwitchState = 'unknown' | 'off' | 'on';

export interface ModuleExportSwitch {
  state: ModuleExportSwitchState;
  /** The first history page when on; `null` when it could not be read (or not on). */
  history: ExportHistoryRequest[] | null;
  /** Resolves as soon as the probe has answered: 'on' or 'off'. */
  whenKnown: () => Promise<'on' | 'off'>;
}

export function useModuleExportSwitch(): ModuleExportSwitch {
  const [state, setState] = useState<ModuleExportSwitchState>('unknown');
  const [history, setHistory] = useState<ExportHistoryRequest[] | null>(null);
  const known = useRef<Promise<'on' | 'off'> | null>(null);

  useEffect(() => {
    let isAlive = true;
    const probe = fetchModuleExportHistory().then((verdict): 'on' | 'off' => {
      const next = verdict.kind === 'ok' || verdict.kind === 'error' ? 'on' : 'off';
      if (isAlive) {
        setHistory(verdict.kind === 'ok' ? verdict.requests : null);
        setState(next);
      }
      return next;
    });
    known.current = probe;
    return () => {
      isAlive = false;
    };
  }, []);

  const whenKnown = useCallback((): Promise<'on' | 'off'> => known.current ?? Promise.resolve('off'), []);

  return { state, history, whenKnown };
}
