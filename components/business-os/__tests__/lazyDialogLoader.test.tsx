/**
 * @jest-environment jsdom
 *
 * PERF-1 follow-up: a lazily loaded dialog survives a failed chunk download
 * (docs/workplans/PERF_1_LAZY_DIALOG_FAILURE_FIX.md, reported by Offir).
 *
 * The bug: `next/dynamic` + a `.catch` that resolved to a null-rendering
 * component. One `ChunkLoadError` and the Business Setup tab was permanently
 * inert until a full reload. These tests pin the four promises made in reply:
 * retry, a visible error surface on an open dialog only, no cached failure, and
 * a button that still works afterwards.
 */

import React from 'react';
import { TextEncoder } from 'util';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderToString } = require('react-dom/server') as typeof import('react-dom/server');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { hydrateRoot } = require('react-dom/client') as typeof import('react-dom/client');

const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger/client', () => ({ clientLogger: mockLogger }));

type MockLanguage = { t: (key: string) => string; isRTL: boolean } | undefined;
let mockLanguage: MockLanguage;
jest.mock('@/lib/business-os/LanguageContext', () => ({
  useOptionalLanguage: () => mockLanguage,
}));

/*
 * The real dialogs, replaced by stubs whose module FACTORY can be made to throw:
 * that is how a failed `import()` looks to the loader. Jest does not register a
 * module whose factory threw, so the next `import()` runs the factory again —
 * the same "a failed chunk is requested afresh" behaviour webpack has.
 */
let mockConfigFailuresLeft = 0;
jest.mock('@/components/business-os/ConfigurationDialog', () => {
  if (mockConfigFailuresLeft > 0) {
    mockConfigFailuresLeft -= 1;
    throw new Error('ChunkLoadError: Loading chunk ConfigurationDialog failed. (timeout)');
  }
  return {
    ConfigurationDialog: ({ isOpen }: { isOpen: boolean }) =>
      isOpen ? <div data-testid="real-config-dialog">configuration</div> : null,
  };
});
jest.mock('@/components/business-os/SchedulingDialog', () => ({
  SchedulingDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="real-scheduling-dialog">scheduling</div> : null,
}));

import { createLazyDialog, DEFAULT_RETRY_DELAYS_MS, type LazyDialogBaseProps } from '@/components/business-os/lazyDialogLoader';
import { he } from '@/lib/business-os/translations/he';

type Props = LazyDialogBaseProps & { label?: string };

function RealDialog({ isOpen, label }: Props) {
  return isOpen ? <div data-testid="real-dialog">{label ?? 'loaded'}</div> : null;
}

/** An importer that fails `failures` times, then resolves to `RealDialog`. */
function flakyImporter(failures: number) {
  let left = failures;
  return jest.fn(async () => {
    if (left > 0) {
      left -= 1;
      throw new Error('ChunkLoadError: Loading chunk failed. (timeout)');
    }
    return RealDialog;
  });
}

const noRetryDelay = { retryDelaysMs: [0, 0] };
const onClose = () => undefined;

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = undefined;
});

describe('createLazyDialog', () => {
  it('retries twice by default before counting a load as failed', () => {
    expect(DEFAULT_RETRY_DELAYS_MS).toHaveLength(2);
    expect(DEFAULT_RETRY_DELAYS_MS.every(ms => ms > 0 && ms <= 2000)).toBe(true);
  });

  it('retries a failed chunk load and renders the dialog without ever showing an error', async () => {
    const importer = flakyImporter(2);
    const Lazy = createLazyDialog<Props>('Flaky', importer, noRetryDelay);

    render(<Lazy isOpen onClose={onClose} />);

    expect(await screen.findByTestId('real-dialog')).toBeTruthy();
    expect(importer).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    expect(mockLogger.error).not.toHaveBeenCalled();
  });

  it('shows a visible error with a working "Try again" when every attempt fails, and the retry renders the dialog', async () => {
    const importer = flakyImporter(3);
    const Lazy = createLazyDialog<Props>('Broken', importer, noRetryDelay);

    render(<Lazy isOpen onClose={onClose} label="configuration" />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't load this");
    expect(importer).toHaveBeenCalledTimes(3);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error), dialog: 'Broken' }),
      expect.any(String)
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByTestId('real-dialog')).toBeTruthy();
    expect(screen.getByTestId('real-dialog').textContent).toBe('configuration');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(importer).toHaveBeenCalledTimes(4);
  });

  it('shows a loading surface, not nothing, while an open dialog is still downloading', async () => {
    let resolveImport: (component: React.ComponentType<Props>) => void = () => undefined;
    const importer = jest.fn(
      () => new Promise<React.ComponentType<Props>>(resolve => { resolveImport = resolve; })
    );
    const Lazy = createLazyDialog<Props>('Slow', importer, noRetryDelay);

    render(<Lazy isOpen onClose={onClose} />);

    expect((await screen.findByRole('status')).textContent).toContain('Loading');
    await act(async () => resolveImport(RealDialog));
    expect(screen.getByTestId('real-dialog')).toBeTruthy();
  });

  it('closed warm-up instance shows nothing when the load fails', async () => {
    const importer = flakyImporter(3);
    const Lazy = createLazyDialog<Props>('ClosedFail', importer, noRetryDelay);

    const { container } = render(<Lazy isOpen={false} onClose={onClose} />);

    await waitFor(() => expect(Lazy.loader.getState().status).toBe('failed'));
    expect(container.innerHTML).toBe('');
    expect(document.body.querySelector('[data-testid="lazy-dialog-fallback"]')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // A closed instance does not keep re-requesting a failed chunk.
    expect(importer).toHaveBeenCalledTimes(3);
  });

  it('does not cache a failure: opening after a failed warm-up loads afresh and the dialog renders', async () => {
    const importer = flakyImporter(3);
    const Lazy = createLazyDialog<Props>('NotCached', importer, noRetryDelay);

    const { rerender } = render(<Lazy isOpen={false} onClose={onClose} />);
    await waitFor(() => expect(Lazy.loader.getState().status).toBe('failed'));

    // The owner clicks the tab.
    rerender(<Lazy isOpen onClose={onClose} />);

    expect(await screen.findByTestId('real-dialog')).toBeTruthy();
    expect(importer).toHaveBeenCalledTimes(4);
    expect(Lazy.loader.getState().status).toBe('ready');
  });

  /*
   * QA: Offir's exact scenario. The layout's closed warm-up times out on every
   * attempt; the owner then clicks the tab while the network is still bad, so
   * the fresh load fails too. They must see "Couldn't load this" + "Try again"
   * (not a dead tab), and Try again must open the real dialog.
   */
  it("Offir's scenario: warm-up times out, tab click still fails, the error shows, Try again opens the dialog", async () => {
    const importer = flakyImporter(6);
    const Lazy = createLazyDialog<Props>('OffirScenario', importer, noRetryDelay);

    const { container, rerender } = render(<Lazy isOpen={false} onClose={onClose} label="configuration" />);
    await waitFor(() => expect(Lazy.loader.getState().status).toBe('failed'));
    expect(container.innerHTML).toBe('');
    expect(importer).toHaveBeenCalledTimes(3);

    // The owner clicks the Business Setup tab.
    rerender(<Lazy isOpen onClose={onClose} label="configuration" />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't load this");
    expect(importer).toHaveBeenCalledTimes(6);
    expect(screen.queryByTestId('real-dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect((await screen.findByTestId('real-dialog')).textContent).toBe('configuration');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(importer).toHaveBeenCalledTimes(7);
  });

  it('shares one loader between sites: the closed warm-up instance loads it for an instance opened later', async () => {
    const importer = flakyImporter(0);
    const Lazy = createLazyDialog<Props>('Shared', importer, noRetryDelay);

    render(<Lazy isOpen={false} onClose={onClose} />);
    await waitFor(() => expect(Lazy.loader.getState().status).toBe('ready'));

    render(<Lazy isOpen onClose={onClose} />);
    // Rendered in the first frame: no waiting, no loading surface.
    expect(screen.getByTestId('real-dialog')).toBeTruthy();
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('closes from the error surface through the caller onClose', async () => {
    const close = jest.fn();
    const Lazy = createLazyDialog<Props>('CloseFromError', flakyImporter(3), noRetryDelay);

    render(<Lazy isOpen onClose={close} />);
    await screen.findByRole('alert');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('uses the Business OS dictionary for the error surface (Hebrew)', async () => {
    const dictionary = he as Record<string, string>;
    mockLanguage = { t: (key: string) => dictionary[key] ?? key, isRTL: true };
    const Lazy = createLazyDialog<Props>('Hebrew', flakyImporter(3), noRetryDelay);

    render(<Lazy isOpen onClose={onClose} />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(dictionary['lazyDialog.loadFailed.title']);
    expect(screen.getByRole('button', { name: dictionary['lazyDialog.loadFailed.retry'] })).toBeTruthy();
  });

  it('renders nothing on the server and hydrates without a mismatch, even once the dialog is loaded', async () => {
    const importer = flakyImporter(0);
    const Lazy = createLazyDialog<Props>('Ssr', importer, noRetryDelay);
    const unloadedImporter = flakyImporter(0);
    const Unloaded = createLazyDialog<Props>('SsrUnloaded', unloadedImporter, noRetryDelay);
    await Lazy.loader.load();
    // Any render work on the server (a dialog primitive, a layout effect) warns
    // here: "nothing server-rendered" means no component work at all, not just
    // an empty string.
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    for (const Component of [Lazy, Unloaded]) {
      for (const isOpen of [false, true]) {
        expect(renderToString(<Component isOpen={isOpen} onClose={onClose} />)).toBe('');
      }
    }
    expect(unloadedImporter).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();

    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = renderToString(<Lazy isOpen onClose={onClose} />);
    const onRecoverableError = jest.fn();
    await act(async () => {
      hydrateRoot(container, <Lazy isOpen onClose={onClose} />, { onRecoverableError });
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
    // After hydration it switches to the real state.
    expect(container.querySelector('[data-testid="real-dialog"]')).toBeTruthy();
  });
});

describe('the real exports in lazyDialogs.tsx', () => {
  it('LazyConfigurationDialog: a failed chunk still leaves a button that opens the dialog', async () => {
    mockConfigFailuresLeft = 3;
    const { LazyConfigurationDialog } = await import('@/components/business-os/lazyDialogs');

    render(<LazyConfigurationDialog isOpen onClose={onClose} />);

    // Production backoff (0.5 s + 1.5 s) before the error appears.
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
    expect(alert.textContent).toContain("Couldn't load this");

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('real-config-dialog')).toBeTruthy();
  }, 10000);

  it('LazySchedulingDialog loads through the same loader', async () => {
    const { LazySchedulingDialog } = await import('@/components/business-os/lazyDialogs');

    render(<LazySchedulingDialog isOpen onClose={onClose} />);

    expect(await screen.findByTestId('real-scheduling-dialog')).toBeTruthy();
  });
});
