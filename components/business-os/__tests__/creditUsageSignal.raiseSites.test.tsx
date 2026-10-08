/**
 * @jest-environment jsdom
 *
 * The eight owner AI surfaces reachable from the dashboard raise the credit
 * usage signal exactly once per action, after it finishes, success or failure
 * (credit deduction slice 6a, workplan §4.6 S-1 to S-8, SA W6-2).
 *
 * Behavioural where the component renders cheaply (the intake "infer
 * question" box, the media picker's Generate); source-level for the chat panel,
 * the dashboard page and the intake settings panel, whose render needs half the
 * app (SA's accepted alternative). A census pins that nothing ELSE raises it.
 */

import '@testing-library/jest-dom';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger, clientLogger: logger };
});
jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key, isRTL: false, language: 'en' }),
}));

import { AddIntakeQuestion } from '@/components/scheduling/intake/AddIntakeQuestion';
import { MediaLibraryPicker } from '@/components/website/MediaLibraryPicker';
import { onCreditUsageChanged } from '@/lib/business-os/client/creditUsageSignal';

const ROOT = process.cwd();
const codeOf = (rel: string) =>
  readFileSync(join(ROOT, rel), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
const RAISE = /notifyCreditUsageChanged\(\)/g;
const count = (code: string, re: RegExp) => (code.match(re) ?? []).length;

let raised: jest.Mock;
let off: () => void;
beforeEach(() => {
  raised = jest.fn();
  off = onCreditUsageChanged(raised);
});
afterEach(() => off());

function json(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body } as Response);
}

describe('S-7 — intake "infer question" (behavioural)', () => {
  async function inferWith(fetchImpl: () => Promise<Response>) {
    global.fetch = jest.fn(fetchImpl) as unknown as typeof fetch;
    render(<AddIntakeQuestion onAdd={jest.fn()} t={(k) => k} isRTL={false} />);
    fireEvent.click(screen.getByText('config.intake.add_question'));
    fireEvent.change(screen.getByPlaceholderText('config.intake.add_placeholder'), { target: { value: 'Do you have pets?' } });
    fireEvent.keyDown(screen.getByPlaceholderText('config.intake.add_placeholder'), { key: 'Enter' });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  }

  it('raises once after a success', async () => {
    await inferWith(() => json({ success: true, data: { id: 'q1', label: 'Pets?', type: 'text' } }));
    await waitFor(() => expect(raised).toHaveBeenCalledTimes(1));
  });

  it('raises once after a refusal', async () => {
    await inferWith(() => json({ success: false, error: 'no' }));
    await waitFor(() => expect(raised).toHaveBeenCalledTimes(1));
  });

  it('raises once after a network failure', async () => {
    await inferWith(() => Promise.reject(new Error('offline')));
    await waitFor(() => expect(raised).toHaveBeenCalledTimes(1));
  });
});

describe('S-8 — media picker "Generate" (behavioural, W6-2)', () => {
  async function generateWith(generateReply: () => Promise<Response>) {
    global.fetch = jest.fn((url: string) =>
      String(url).includes('/media/generate') ? generateReply() : json({ success: true, data: [] })
    ) as unknown as typeof fetch;
    render(<MediaLibraryPicker onSelect={jest.fn()} onClose={jest.fn()} />);
    // The library load on mount is not an AI action: nothing raised.
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(raised).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('media.generate.prompt'), { target: { value: 'a calm treatment room' } });
    await act(async () => {
      fireEvent.click(screen.getByText('media.generate.action'));
    });
  }

  it('raises once after a success', async () => {
    await generateWith(() => json({ success: true, data: { url: 'https://x/y.png' } }));
    await waitFor(() => expect(raised).toHaveBeenCalledTimes(1));
  });

  it('raises once after a refusal', async () => {
    await generateWith(() => json({ success: false, reason: 'failed' }));
    await waitFor(() => expect(raised).toHaveBeenCalledTimes(1));
  });

  it('raises once after a network failure', async () => {
    await generateWith(() => Promise.reject(new Error('offline')));
    await waitFor(() => expect(raised).toHaveBeenCalledTimes(1));
  });
});

describe('S-1 to S-4 — the chat panel (source)', () => {
  const code = codeOf('components/business-os/ChatCommandPanel.tsx');

  /** A component-level `const name = useCallback(` up to the next component-level const. */
  function body(name: string): string {
    const start = code.indexOf(`  const ${name} = useCallback(`);
    expect(start).toBeGreaterThan(-1);
    const next = code.indexOf('\n  const ', start + 10);
    return code.slice(start, next === -1 ? undefined : next);
  }

  it.each(['handleSend', 'sendDirect', 'applyCorrection', 'applyPick'])('%s raises exactly once, in its finally', (name) => {
    const segment = body(name);
    expect(count(segment, RAISE)).toBe(1);
    expect(segment).toMatch(/finally \{\s*setLoading\(false\);\s*notifyCreditUsageChanged\(\);\s*\}/);
  });

  it.each(['handleV4Send', 'handleV2Send'])('%s does not raise (its callers do: once per action, never twice)', (name) => {
    expect(count(body(name), RAISE)).toBe(0);
  });

  it('raises nowhere else in the file', () => {
    expect(count(code, RAISE)).toBe(4);
  });
});

describe('S-5 — the dashboard data load (source)', () => {
  const code = codeOf('app/business-os/page.tsx');

  it('raises once the my-day response settles, resolved or rejected', () => {
    expect(code).toMatch(/fetch\('\/api\/business-os\/my-day', \{ cache: 'no-store' \}\)\.finally\(notifyCreditUsageChanged\)/);
    expect(count(code, /notifyCreditUsageChanged/g)).toBe(2); // the import and the one raise
  });
});

describe('S-6 — intake form generation (source)', () => {
  const code = codeOf('components/scheduling/IntakeSettingsPanel.tsx');

  it('raises exactly once, in generate\'s finally', () => {
    expect(count(code, RAISE)).toBe(1);
    expect(code).toMatch(/finally \{\s*setGenerating\(false\);\s*notifyCreditUsageChanged\(\);\s*\}/);
  });
});

describe('census: nothing else raises the signal', () => {
  it('only the eight named sites, in these five files', () => {
    const found: Record<string, number> = {};
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (['node_modules', '.next', '.claude', '__tests__'].includes(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry)) {
          const rel = relative(ROOT, full).split(sep).join('/');
          // The module declares the function; it does not raise it.
          if (rel === 'lib/business-os/client/creditUsageSignal.ts') continue;
          const n = count(codeOf(rel), RAISE);
          if (n > 0) found[rel] = n;
        }
      }
    };
    ['app', 'components', 'lib', 'hooks'].forEach((d) => walk(join(ROOT, d)));

    expect(found).toEqual({
      // Credits boost 5b.1: the return notice, once the purchase is credited.
      'components/business-os/BoostReturnNotice.tsx': 1,
      'components/business-os/ChatCommandPanel.tsx': 4,
      'components/scheduling/IntakeSettingsPanel.tsx': 1,
      'components/scheduling/intake/AddIntakeQuestion.tsx': 1,
      'components/website/MediaLibraryPicker.tsx': 1,
    });
    // page.tsx passes the function to `.finally(...)` rather than calling it.
    expect(codeOf('app/business-os/page.tsx')).toMatch(/\.finally\(notifyCreditUsageChanged\)/);
  });
});
