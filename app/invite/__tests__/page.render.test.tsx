/**
 * @jest-environment jsdom
 *
 * The public invite page: the token is read from the fragment, stripped from
 * the address BEFORE the request, sent only in a POST body; each state renders
 * in the invite's own language (RTL for Hebrew); the note is text, never HTML.
 */

import '@testing-library/jest-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import InvitePage from '../page';
import { INVITE_PAGE_COPY } from '../invitePageCopy';

const TOKEN = 'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';

const validData = {
  state: 'valid',
  language: 'en',
  inviterDisplayName: 'Dana',
  personalNote: 'Welcome aboard, would love your feedback',
  linkExpiresAt: '2026-10-31T12:00:00.000Z',
  offer: {
    planName: 'Fixture Free Plan',
    free: true,
    monthlyPriceUsd: 0,
    access: { kind: 'open_ended', months: null },
    included: [{ category: 'crm', label: 'Clients (CRM)', summary: 'Contacts, Pipelines' }],
  },
};

let events: string[] = [];
let calls: Array<{ url: string; init?: RequestInit }> = [];
let respond: () => { status: number; body: unknown } = () => ({ status: 200, body: { success: true, data: validData } });

beforeEach(() => {
  events = [];
  calls = [];
  respond = () => ({ status: 200, body: { success: true, data: validData } });
  window.history.replaceState(null, '', `/invite#t=${TOKEN}`);

  const realReplace = window.history.replaceState.bind(window.history);
  jest.spyOn(window.history, 'replaceState').mockImplementation((data, unused, url) => {
    events.push(`replaceState:${String(url)}`);
    realReplace(data, unused, url);
  });

  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    events.push('fetch');
    calls.push({ url: String(url), init });
    const { status, body } = respond();
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the token (T-7, D-11)', () => {
  it('is read from #t=, stripped from the address before the request, and sent only in the POST body', async () => {
    render(<InvitePage />);
    await screen.findByTestId('invite-state-valid');

    expect(events[0]).toBe('replaceState:/invite');
    expect(events.indexOf('replaceState:/invite')).toBeLessThan(events.indexOf('fetch'));
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/invite');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/public/invites/validate');
    expect(calls[0].url).not.toContain(TOKEN);
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ token: TOKEN });
  });

  it('with no token, shows "not recognised" and sends nothing', async () => {
    window.history.replaceState(null, '', '/invite');
    events = [];
    render(<InvitePage />);
    expect(await screen.findByTestId('invite-state-not_recognised')).toHaveTextContent(
      INVITE_PAGE_COPY.en.notRecognisedHeading
    );
    expect(calls).toHaveLength(0);
  });
});

describe('each state', () => {
  it('valid: the inviter, the note, the plan, what it includes, the expiry, and the R-4 line', async () => {
    render(<InvitePage />);
    const section = await screen.findByTestId('invite-state-valid');
    expect(section).toHaveTextContent('Dana invited you');
    expect(screen.getByTestId('invite-note')).toHaveTextContent('Welcome aboard, would love your feedback');
    expect(screen.getByTestId('invite-plan')).toHaveTextContent('Fixture Free Plan');
    expect(section).toHaveTextContent('Free');
    expect(section).toHaveTextContent('No end date');
    expect(section).toHaveTextContent('Contacts, Pipelines');
    expect(section).toHaveTextContent('October 31, 2026');
    expect(screen.getByTestId('invite-signup-not-yet')).toHaveTextContent(
      "You can't create your account from this page yet. Dana will let you know when you can."
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('valid, paid: the price and "payment required"', async () => {
    respond = () => ({
      status: 200,
      body: {
        success: true,
        data: { ...validData, offer: { ...validData.offer, free: false, monthlyPriceUsd: 42, access: { kind: 'while_paid', months: null } } },
      },
    });
    render(<InvitePage />);
    const section = await screen.findByTestId('invite-state-valid');
    expect(section).toHaveTextContent('$42 per month');
    expect(section).toHaveTextContent('Payment is required at signup.');
  });

  it.each([
    ['expired', INVITE_PAGE_COPY.en.expiredHeading],
    ['revoked', INVITE_PAGE_COPY.en.revokedHeading],
    ['unavailable', INVITE_PAGE_COPY.en.unavailableHeading],
  ])('%s: names the inviter and suggests asking for a new one; no note, no plan', async (state, heading) => {
    respond = () => ({ status: 200, body: { success: true, data: { state, language: 'en', inviterDisplayName: 'Dana' } } });
    render(<InvitePage />);
    const section = await screen.findByTestId(`invite-state-${state}`);
    expect(section).toHaveTextContent(heading);
    expect(section).toHaveTextContent('Ask Dana for a new one.');
    expect(screen.queryByTestId('invite-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-plan')).not.toBeInTheDocument();
  });

  it('used: says so and offers sign in', async () => {
    respond = () => ({ status: 200, body: { success: true, data: { state: 'used', language: 'en', inviterDisplayName: 'Dana' } } });
    render(<InvitePage />);
    const section = await screen.findByTestId('invite-state-used');
    expect(section).toHaveTextContent(INVITE_PAGE_COPY.en.usedHeading);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', expect.stringContaining('/login'));
  });

  it('not recognised', async () => {
    respond = () => ({ status: 200, body: { success: true, data: { state: 'not_recognised' } } });
    render(<InvitePage />);
    expect(await screen.findByTestId('invite-state-not_recognised')).toHaveTextContent("We don't recognise this invitation");
  });

  it('a failed check offers to try again, with the token still in memory only', async () => {
    respond = () => ({ status: 503, body: { success: false, error: 'unavailable_try_again' } });
    const user = userEvent.setup();
    render(<InvitePage />);
    await screen.findByTestId('invite-error');
    respond = () => ({ status: 200, body: { success: true, data: validData } });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('invite-state-valid');
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ token: TOKEN });
  });
});

describe('language (C-8)', () => {
  it('renders in the invite\'s language, right to left for Hebrew', async () => {
    respond = () => ({ status: 200, body: { success: true, data: { ...validData, language: 'he' } } });
    render(<InvitePage />);
    await screen.findByTestId('invite-state-valid');
    const main = screen.getByTestId('invite-page');
    expect(main).toHaveAttribute('dir', 'rtl');
    expect(main).toHaveAttribute('lang', 'he');
    expect(main).toHaveTextContent(INVITE_PAGE_COPY.he.validHeading('Dana'));
  });

  it('Spanish, left to right', async () => {
    respond = () => ({ status: 200, body: { success: true, data: { ...validData, language: 'es' } } });
    render(<InvitePage />);
    await screen.findByTestId('invite-state-valid');
    expect(screen.getByTestId('invite-page')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByTestId('invite-signup-not-yet')).toHaveTextContent(INVITE_PAGE_COPY.es.signupNotYet('Dana'));
  });

  it('ignores the browser language', async () => {
    Object.defineProperty(window.navigator, 'language', { value: 'he-IL', configurable: true });
    render(<InvitePage />);
    await screen.findByTestId('invite-state-valid');
    expect(screen.getByTestId('invite-page')).toHaveAttribute('lang', 'en');
    expect(screen.getByTestId('invite-page')).toHaveAttribute('dir', 'ltr');
  });

  it('every locale has every string', () => {
    const keys = Object.keys(INVITE_PAGE_COPY.en).sort();
    expect(Object.keys(INVITE_PAGE_COPY.he).sort()).toEqual(keys);
    expect(Object.keys(INVITE_PAGE_COPY.es).sort()).toEqual(keys);
  });
});

describe('the note is text, never HTML', () => {
  it('a <script> string appears literally and creates no element', async () => {
    const hostile = '<script>window.__pwned = true</script><b>bold</b>';
    respond = () => ({ status: 200, body: { success: true, data: { ...validData, personalNote: hostile } } });
    render(<InvitePage />);
    const note = await screen.findByTestId('invite-note');
    expect(note).toHaveTextContent(hostile);
    expect(note.querySelector('script')).toBeNull();
    expect(note.querySelector('b')).toBeNull();
  });
});

describe('source rules', () => {
  const read = (file: string) => readFileSync(join(process.cwd(), 'app', 'invite', file), 'utf8');

  it.each(['page.tsx', 'layout.tsx', 'invitePageCopy.ts'])('%s uses no dangerouslySetInnerHTML, LanguageContext, navigator.language or console', (file) => {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(source).not.toContain('dangerouslySetInnerHTML');
    expect(source).not.toMatch(/LanguageContext|useLanguage/);
    expect(source).not.toMatch(/navigator\.language/);
    expect(source).not.toMatch(/console\.(log|warn|error|info|debug)\s*\(/);
  });

  it('the layout sets no-referrer and no indexing', () => {
    const layout = read('layout.tsx');
    expect(layout).toContain("referrer: 'no-referrer'");
    expect(layout).toContain('robots: { index: false, follow: false }');
  });

  it('the page stores the token nowhere that survives', () => {
    const source = read('page.tsx');
    expect(source).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});

describe('waiting', () => {
  it('shows a loading line until the check returns', async () => {
    let release: () => void = () => undefined;
    global.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () =>
            resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, data: validData }) } as Response);
        })
    ) as unknown as typeof fetch;
    render(<InvitePage />);
    expect(screen.getByTestId('invite-loading')).toBeInTheDocument();
    release();
    await waitFor(() => expect(screen.getByTestId('invite-state-valid')).toBeInTheDocument());
  });
});
