'use client';

/**
 * A lazily loaded dialog that survives a failed download.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (docs/workplans/PERF_1_LAZY_DIALOG_FAILURE_FIX.md)
 *
 * PERF-1 loaded the configuration and scheduling dialogs with `next/dynamic`
 * and a `.catch` that resolved to a component rendering `null`. `next/dynamic`
 * remembers whatever its loader resolves to for the life of the page, so ONE
 * slow chunk download (a `ChunkLoadError` timeout) turned the "Business
 * Setup" tab into a control that was present, wired, and permanently inert
 * until a full reload — with a single console line as the only evidence.
 * Reported by Offir.
 *
 * WHAT THIS DOES INSTEAD
 *
 * 1. Retries. A failed import is retried after a short backoff
 *    (`DEFAULT_RETRY_DELAYS_MS`) before the load counts as failed. Webpack
 *    forgets a chunk whose download failed, so a second `import()` really does
 *    request it again.
 *
 * 2. Never resolves to "nothing". An OPEN dialog whose code is not there yet
 *    shows a loading surface, and if the load failed, an error surface with a
 *    "Try again" button — inside the standard dialog primitive. A CLOSED
 *    instance (the layout's warm-up) shows nothing, failed or not.
 *
 * 3. Does not remember a failure. The in-flight promise is dropped when it
 *    rejects, so the next open, or the button, starts a fresh load, and a
 *    later success replaces the failure for every instance.
 *
 * ONE LOADER PER DIALOG, SHARED BY EVERY SITE. The state lives in the module,
 * not in the component, so the layout's closed instance warms the dialog for
 * every other site on the page (My Day, the website builder, the setup
 * wizard), exactly as one `dynamic()` call did.
 *
 * NO SERVER RENDER, NO HYDRATION MISMATCH (the `ssr: false` it replaces). Both
 * the load state and "are we hydrated" are read with `useSyncExternalStore`,
 * whose server snapshot is used on the server AND during hydration. The server
 * therefore renders nothing, hydration renders the same nothing, and only then
 * does the client switch to the real state. A site that mounts after
 * hydration, with the dialog already loaded, renders it in its first frame.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useCallback, useEffect, useSyncExternalStore, type ComponentType } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useOptionalLanguage } from '@/lib/business-os/LanguageContext';
import { clientLogger } from '@/lib/logger/client';

/** What every lazily loaded dialog accepts: the fallback needs both. */
export interface LazyDialogBaseProps {
  isOpen: boolean;
  onClose: () => void;
}

export type LazyDialogLoadState<P> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; Component: ComponentType<P> }
  | { status: 'failed' };

/** Two retries after the first attempt: 0.5 s, then 1.5 s. */
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [500, 1500];

export interface LazyDialogOptions {
  /** One entry per retry; the delay before it. Tests pass zeros. */
  retryDelaysMs?: readonly number[];
}

export interface LazyDialogLoader<P> {
  /** Starts a load, or joins the one in flight. Rejects only after the last retry. */
  load: () => Promise<ComponentType<P>>;
  getState: () => LazyDialogLoadState<P>;
  subscribe: (listener: () => void) => () => void;
}

export type LazyDialogComponent<P> = ComponentType<P> & { loader: LazyDialogLoader<P> };

// "Are we past hydration?" — false on the server and during hydration, true
// after. Nothing to subscribe to: the answer never changes once it is true.
const subscribeNever = (): (() => void) => () => undefined;
const onClient = (): boolean => true;
const onServer = (): boolean => false;

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createLoader<P>(
  name: string,
  importer: () => Promise<ComponentType<P>>,
  retryDelaysMs: readonly number[]
): LazyDialogLoader<P> {
  let state: LazyDialogLoadState<P> = { status: 'idle' };
  let inFlight: Promise<ComponentType<P>> | null = null;
  const listeners = new Set<() => void>();

  const setState = (next: LazyDialogLoadState<P>) => {
    state = next;
    listeners.forEach(listener => listener());
  };

  const attempt = async (): Promise<ComponentType<P>> => {
    for (let retry = 0; ; retry++) {
      try {
        return await importer();
      } catch (err) {
        if (retry >= retryDelaysMs.length) throw err;
        clientLogger.warn({ err, dialog: name, retry: retry + 1 }, 'Dialog chunk failed to load, retrying');
        await wait(retryDelaysMs[retry]);
      }
    }
  };

  const load = (): Promise<ComponentType<P>> => {
    if (state.status === 'ready') return Promise.resolve(state.Component);
    if (inFlight) return inFlight;
    setState({ status: 'loading' });
    inFlight = attempt().then(
      Component => {
        setState({ status: 'ready', Component });
        return Component;
      },
      (err: unknown) => {
        // Forget the failure: the next open or "Try again" starts a fresh load.
        inFlight = null;
        setState({ status: 'failed' });
        clientLogger.error({ err, dialog: name }, 'Dialog chunk failed to load after retries');
        throw err;
      }
    );
    return inFlight;
  };

  return {
    load,
    getState: () => state,
    subscribe: listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Starts a load from an effect or a click. The failure has already been logged
 * and is in the loader's state, which is what the UI renders from; the promise
 * is only caught here so it is not reported again as an unhandled rejection.
 */
function startLoad<P>(loader: LazyDialogLoader<P>): void {
  loader.load().catch(() => undefined);
}

/**
 * The surface an OPEN dialog shows while its code is not there: loading, or
 * failed with a way to try again. `useOptionalLanguage` rather than
 * `useLanguage`: this is the failure path, and it must not itself throw on a
 * surface without a `LanguageProvider`.
 */
function LazyDialogFallback({
  isFailed,
  onClose,
  onRetry,
}: {
  isFailed: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  const language = useOptionalLanguage();
  const text = (key: string, english: string): string => (language ? language.t(key) : english);

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent
        className="sm:max-w-sm"
        dir={language?.isRTL ? 'rtl' : undefined}
        aria-busy={!isFailed}
        data-testid="lazy-dialog-fallback"
      >
        {isFailed ? (
          <div role="alert" className="flex flex-col items-center gap-3 py-2 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden="true" />
            <DialogTitle className="text-base font-semibold text-[var(--v2-text-primary)]">
              {text('lazyDialog.loadFailed.title', "Couldn't load this")}
            </DialogTitle>
            <DialogDescription className="text-sm text-[var(--v2-text-muted)]">
              {text('lazyDialog.loadFailed.body', 'Check your connection and try again.')}
            </DialogDescription>
            <Button type="button" onClick={onRetry}>
              {text('lazyDialog.loadFailed.retry', 'Try again')}
            </Button>
          </div>
        ) : (
          <div role="status" className="flex flex-col items-center gap-3 py-6 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--v2-text-muted)]" aria-hidden="true" />
            <DialogTitle className="text-sm font-medium text-[var(--v2-text-muted)]">
              {text('lazyDialog.loading', 'Loading…')}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {text('lazyDialog.loading', 'Loading…')}
            </DialogDescription>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * One loader and one component per dialog. Call it once, at module scope, so
 * every site shares the loader.
 */
export function createLazyDialog<P extends LazyDialogBaseProps>(
  name: string,
  importer: () => Promise<ComponentType<P>>,
  options: LazyDialogOptions = {}
): LazyDialogComponent<P> {
  const loader = createLoader<P>(name, importer, options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS);
  // A stable object: `useSyncExternalStore` compares snapshots by identity.
  const serverState: LazyDialogLoadState<P> = { status: 'idle' };
  const getServerState = (): LazyDialogLoadState<P> => serverState;

  function LazyDialog(props: P) {
    const state = useSyncExternalStore(loader.subscribe, loader.getState, getServerState);
    const isHydrated = useSyncExternalStore(subscribeNever, onClient, onServer);
    const { isOpen, onClose } = props;

    // Warm up on mount, open or closed. A failed load is retried only when the
    // dialog is opened, so a closed instance never re-requests in a loop.
    useEffect(() => {
      const current = loader.getState().status;
      if (current === 'idle' || (isOpen && current === 'failed')) startLoad(loader);
    }, [isOpen]);

    const retry = useCallback(() => startLoad(loader), []);

    // `ssr: false`: nothing on the server or in the hydration pass, open or
    // not, so the server HTML and the first client render always agree.
    if (!isHydrated) return null;
    if (state.status === 'ready') {
      const Loaded = state.Component;
      return <Loaded {...props} />;
    }
    if (!isOpen) return null;
    return <LazyDialogFallback isFailed={state.status === 'failed'} onClose={onClose} onRetry={retry} />;
  }

  LazyDialog.displayName = `Lazy(${name})`;
  return Object.assign(LazyDialog, { loader });
}
