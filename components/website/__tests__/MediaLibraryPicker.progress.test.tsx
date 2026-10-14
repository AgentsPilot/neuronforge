/**
 * @jest-environment jsdom
 *
 * BR-3: honest progress while a website picture is generated, and closing the
 * picker cancels the automatic placement (not the request).
 *
 * Requirement: docs/requirements/PERFORMANCE_BUSINESS_ROUND_REQUIREMENT.md §5
 * (FR-3.1 to FR-3.10, AC-3.1 to AC-3.11). Workplan:
 * docs/workplans/PERF_BR3_IMAGE_PROGRESS_WORKPLAN.md (T1 to T14, SA R-1 to R-6).
 *
 * The generate reply is a promise the test resolves by hand, so the "in
 * flight" state can be inspected, and so a reply can arrive AFTER the picker
 * was closed, which is the whole point of FR-3.10.
 */

import '@testing-library/jest-dom';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger, clientLogger: logger };
});
jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key, isRTL: false, language: 'en' }),
}));

import { MediaLibraryPicker } from '@/components/website/MediaLibraryPicker';
import { SLOW_AFTER_SECONDS } from '@/components/website/ImageGenerationProgress';
import { onCreditUsageChanged } from '@/lib/business-os/client/creditUsageSignal';
import { en } from '@/lib/business-os/translations/en';
import { es } from '@/lib/business-os/translations/es';
import { he } from '@/lib/business-os/translations/he';

type Aspect = 'wide' | 'portrait' | 'square';

const LIBRARY_ITEM = {
  id: 'lib-1',
  url: 'https://library/a.png',
  description: 'Library picture A',
  section: 'hero',
  aspect: 'wide',
  source: 'stock' as const,
};
const GENERATED_URL = 'https://generated/new.png';

function reply(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
}

let raised: jest.Mock;
let off: () => void;
beforeEach(() => {
  raised = jest.fn();
  off = onCreditUsageChanged(raised);
});
afterEach(() => {
  off();
  jest.useRealTimers();
});

/**
 * Renders the picker with a library GET that answers at once and a generate
 * POST that waits for `answer()`. Calls are routed by URL and only generate
 * calls are counted, because StrictMode fires the library GET twice (SA R-6 a).
 */
async function setup(opts: { aspect?: Aspect; items?: unknown[]; strict?: boolean } = {}) {
  let resolveGenerate: ((r: Response) => void) | null = null;
  let rejectGenerate: ((e: Error) => void) | null = null;
  const generateCalls: Array<RequestInit | undefined> = [];

  global.fetch = jest.fn((url: string, init?: RequestInit) => {
    if (String(url).includes('/media/generate')) {
      generateCalls.push(init);
      return new Promise<Response>((resolve, reject) => {
        resolveGenerate = resolve;
        rejectGenerate = reject;
      });
    }
    return Promise.resolve(reply({ success: true, data: opts.items ?? [] }));
  }) as unknown as typeof fetch;

  const onSelect = jest.fn();
  const onClose = jest.fn();
  const picker = (
    <MediaLibraryPicker section="hero" aspect={opts.aspect} onSelect={onSelect} onClose={onClose} />
  );
  const view = render(opts.strict ? <StrictMode>{picker}</StrictMode> : picker);
  // Library loaded: the spinner text is gone.
  await waitFor(() => expect(screen.queryByText('media.library.loading')).not.toBeInTheDocument());

  const start = async (via: 'click' | 'enter' = 'click') => {
    const input = screen.getByPlaceholderText('media.generate.prompt');
    fireEvent.change(input, { target: { value: 'a calm treatment room' } });
    await act(async () => {
      if (via === 'click') fireEvent.click(screen.getByText('media.generate.action'));
      else fireEvent.keyDown(input, { key: 'Enter' });
    });
  };
  const answer = async (body: unknown) => {
    await act(async () => {
      resolveGenerate?.(reply(body));
    });
  };
  const fail = async () => {
    await act(async () => {
      rejectGenerate?.(new Error('offline'));
    });
  };

  return { view, onSelect, onClose, start, answer, fail, generateCalls };
}

const liveRegion = () => screen.getByRole('status');

describe('BR-3 progress panel', () => {
  it('T1/T6: the live region exists before Generate, and the panel text appears before the answer arrives', async () => {
    const { start } = await setup();
    // R-1: present and empty while idle, so the start message is announced.
    expect(liveRegion()).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion()).toHaveTextContent('');

    await start();

    expect(screen.getByTestId('image-generation-placeholder')).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent('media.generate.progress_title');
    expect(liveRegion()).toHaveTextContent('media.generate.progress_can_close');
    expect(liveRegion()).toHaveTextContent('media.generate.progress_no_repeat');
  });

  it.each<Aspect>(['wide', 'portrait', 'square'])('T2: the placeholder has the %s shape', async aspect => {
    const { start } = await setup({ aspect });
    await start();
    expect(screen.getByTestId('image-generation-placeholder')).toHaveAttribute('data-aspect', aspect);
  });

  it('T3: Enter in the prompt starts the same progress state', async () => {
    const { start, generateCalls } = await setup();
    await start('enter');
    expect(generateCalls).toHaveLength(1);
    expect(liveRegion()).toHaveTextContent('media.generate.progress_title');
  });

  it('T4: no percentage and no progress bar anywhere', async () => {
    const { start } = await setup();
    await start();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByTestId('image-generation-progress').textContent).not.toMatch(/%/);
  });

  it('T5: after 75 s the message turns to "taking longer"; one request, never aborted', async () => {
    // Modern fake timers also mock Date, and elapsed time is Date-derived
    // (Date.now() - startedAt), so advancing the clock moves both (SA R-6 d).
    jest.useFakeTimers();
    const { start, generateCalls } = await setup();
    await start();

    await act(async () => {
      jest.advanceTimersByTime((SLOW_AFTER_SECONDS - 1) * 1000);
    });
    expect(liveRegion()).toHaveTextContent('media.generate.progress_title');
    expect(liveRegion()).not.toHaveTextContent('media.generate.progress_slow');

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(liveRegion()).toHaveTextContent('media.generate.progress_slow');
    expect(liveRegion()).not.toHaveTextContent('media.generate.progress_title');

    expect(SLOW_AFTER_SECONDS).toBe(75);
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]?.signal).toBeUndefined();
  });

  it('T6: the timer advances, and is outside the live region but not hidden from screen readers', async () => {
    jest.useFakeTimers();
    const { start } = await setup();
    await start();

    const elapsed = screen.getByTestId('image-generation-elapsed');
    expect(elapsed).toHaveTextContent('media.generate.progress_elapsed 0:00');
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(elapsed).toHaveTextContent('0:05');
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(elapsed).toHaveTextContent('1:05');

    expect(liveRegion()).not.toContainElement(elapsed);
    expect(elapsed.closest('[aria-hidden="true"]')).toBeNull();
  });
});

describe('BR-3 outcomes for an open picker (unchanged)', () => {
  it('T7: success places the picture, then closes, and clears the panel', async () => {
    const { start, answer, onSelect, onClose } = await setup();
    await start();
    await answer({ success: true, data: { url: GENERATED_URL } });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(GENERATED_URL);
    expect(onClose).toHaveBeenCalledTimes(1);
    // AC-3.4: placement before close, as on main.
    expect(onSelect.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
    expect(liveRegion()).toHaveTextContent('');
    expect(raised).toHaveBeenCalledTimes(1);
  });

  it.each(['depicts_people', 'limit_reached', 'unavailable', 'failed'])(
    'T8: a "%s" refusal ends the panel at once and shows the message',
    async reason => {
      const { start, answer, onSelect } = await setup();
      await start();
      await answer({ success: false, reason, allowance: { used: 5, limit: 5, remaining: 0 } });

      expect(screen.queryByTestId('image-generation-placeholder')).not.toBeInTheDocument();
      expect(liveRegion()).toHaveTextContent('');
      expect(screen.getAllByText(`media.generate.${reason}`).length).toBeGreaterThan(0);
      expect(onSelect).not.toHaveBeenCalled();
      expect(raised).toHaveBeenCalledTimes(1);
    }
  );

  it('T8: a network failure ends the panel and shows the failure message', async () => {
    const { start, fail, onSelect } = await setup();
    await start();
    await fail();
    expect(liveRegion()).toHaveTextContent('');
    expect(screen.getByText('media.generate.failed')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    expect(raised).toHaveBeenCalledTimes(1);
  });
});

describe('BR-3 FR-3.10: closing the picker cancels the placement, not the request', () => {
  it('T9: closed with X, then the picture arrives: not placed, request not aborted, credits still refreshed', async () => {
    const { start, answer, onSelect, onClose, generateCalls } = await setup();
    await start();

    fireEvent.click(screen.getByLabelText('media.library.close'));
    expect(onClose).toHaveBeenCalledTimes(1);

    await answer({ success: true, data: { url: GENERATED_URL } });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]?.signal).toBeUndefined();
    expect(liveRegion()).toHaveTextContent('');
    expect(raised).toHaveBeenCalledTimes(1);
  });

  it('T10: closed by the backdrop, then the picture arrives: not placed', async () => {
    const { start, answer, onSelect, onClose, view } = await setup();
    await start();

    const backdrop = view.container.querySelector('[role="presentation"]') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);

    await answer({ success: true, data: { url: GENERATED_URL } });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(liveRegion()).toHaveTextContent('');
    expect(raised).toHaveBeenCalledTimes(1);
  });

  it('T11: a library picture chosen during generation is the only one placed', async () => {
    const { start, answer, onSelect, onClose } = await setup({ items: [LIBRARY_ITEM] });
    await start();

    fireEvent.click(screen.getByTitle(LIBRARY_ITEM.description));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(LIBRARY_ITEM.url);

    await answer({ success: true, data: { url: GENERATED_URL } });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalledWith(GENERATED_URL);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(liveRegion()).toHaveTextContent('');
    expect(raised).toHaveBeenCalledTimes(1);
  });

  it('T12: the host unmounts the picker during generation: the late picture is not placed', async () => {
    const { start, answer, onSelect, onClose, view } = await setup();
    await start();

    view.unmount();
    await answer({ success: true, data: { url: GENERATED_URL } });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(raised).toHaveBeenCalledTimes(1);
  });

  it('T13: under StrictMode an open picker still places the picture (the closed flag resets on remount)', async () => {
    const { start, answer, onSelect, onClose, generateCalls } = await setup({ strict: true });
    await start();
    expect(generateCalls).toHaveLength(1);

    await answer({ success: true, data: { url: GENERATED_URL } });

    expect(onSelect).toHaveBeenCalledWith(GENERATED_URL);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('BR-3 copy (FR-3.8, AC-3.8, SA R-3)', () => {
  const KEYS = [
    'media.generate.progress_title',
    'media.generate.progress_slow',
    'media.generate.progress_elapsed',
    'media.generate.progress_can_close',
    'media.generate.progress_no_repeat',
    // R-3: the reason the server sends, so a people refusal shows a sentence.
    'media.generate.depicts_people',
  ];
  const dictionaries: Record<string, Record<string, string>> = { en, es, he };

  it.each(Object.keys(dictionaries))('T14: every new key is present and non-empty in %s', lang => {
    for (const key of KEYS) {
      expect(typeof dictionaries[lang][key]).toBe('string');
      expect(dictionaries[lang][key].trim()).not.toBe('');
    }
    // The old key had no reader; it was renamed, not duplicated.
    expect(dictionaries[lang]['media.generate.no_people']).toBeUndefined();
  });
});
