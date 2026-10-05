/**
 * @jest-environment jsdom
 *
 * The public invite page: the token is read from the fragment, stripped from
 * the address BEFORE the request, sent only in a POST body; each state renders
 * in the invite's own language (RTL for Hebrew); the note is text, never HTML.
 *
 * Slice 1a: the `existing_account` state sends the person to the normal
 * sign-in page and signs nobody in; a signed-in visitor is asked to sign out
 * first (L-8). The browser session and the audited sign-out are faked at the
 * module boundary, so the real `useSignedInVisitor` hook runs.
 */

import '@testing-library/jest-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const session = {
  user: null as { id: string; email: string | null } | null,
  getSessionRejects: false,
  /** QA-3: when set, getSession waits for this promise before answering. */
  gate: null as Promise<void> | null,
  signOuts: [] as Array<Record<string, unknown>>,
};

jest.mock('@/lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: async () => {
        if (session.gate) await session.gate;
        if (session.getSessionRejects) throw new Error('storage unavailable');
        return { data: { session: session.user ? { user: session.user } : null }, error: null };
      },
    },
  },
}));

jest.mock('@/lib/client/auth-actions', () => ({
  signOutUser: async (opts: Record<string, unknown>) => {
    session.signOuts.push(opts);
    session.user = null;
    return { ok: true };
  },
  signInWithPassword: async () => ({ ok: true }),
}));

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }) }));

// Slice 3b: the Google button is tested on its own (GoogleSignupButton.render.test.tsx).
// Here it is a stub, so the page's job is visible: when it is shown, with what,
// and that the code form goes once a Google signup created the account.
const mockGoogleProps: Array<{ clientId: string; locale: string; maskedEmail: string }> = [];
jest.mock('../GoogleSignupButton', () => ({
  GoogleSignupButton: (props: { clientId: string; locale: string; maskedEmail: string; onAccountReady: () => void }) => {
    mockGoogleProps.push({ clientId: props.clientId, locale: props.locale, maskedEmail: props.maskedEmail });
    return jest.requireActual<typeof import('react')>('react').createElement(
      'button',
      { 'data-testid': 'invite-google-stub', type: 'button', onClick: props.onAccountReady },
      'google'
    );
  },
}));

import InvitePage from '../page';
import { INVITE_PAGE_COPY } from '../invitePageCopy';
import { describeInviteOffer } from '@/lib/business-os/invites/inviteOffer';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';

const TOKEN = 'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';

const validData = {
  state: 'valid',
  language: 'en',
  inviterDisplayName: 'Dana',
  personalNote: 'Welcome aboard, would love your feedback',
  linkExpiresAt: '2026-10-31T12:00:00.000Z',
  maskedEmail: 'i•••@example.com',
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

const savedGoogleClientId = process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID;
const savedPluginClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

beforeEach(() => {
  // Slice 3b: off unless a test switches it on (D-9).
  delete process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID;
  mockGoogleProps.length = 0;
  session.user = null;
  session.getSessionRejects = false;
  session.gate = null;
  session.signOuts = [];
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
  for (const [name, value] of [
    ['NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID', savedGoogleClientId],
    ['NEXT_PUBLIC_GOOGLE_CLIENT_ID', savedPluginClientId],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
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
  it('valid: the inviter, the note, the plan, what it includes, the expiry, and (Slice 1b) the signup form', async () => {
    render(<InvitePage />);
    const section = await screen.findByTestId('invite-state-valid');
    expect(section).toHaveTextContent('Dana invited you');
    expect(screen.getByTestId('invite-note')).toHaveTextContent('Welcome aboard, would love your feedback');
    expect(screen.getByTestId('invite-plan')).toHaveTextContent('Fixture Free Plan');
    expect(section).toHaveTextContent('Free');
    expect(section).toHaveTextContent('No end date');
    expect(section).toHaveTextContent('Contacts, Pipelines');
    expect(section).toHaveTextContent('October 31, 2026');
    // Slice 1b: the R-4 line is gone; the form offers a code to the MASKED address, with no email field.
    expect(screen.queryByTestId('invite-signup-not-yet')).not.toBeInTheDocument();
    const signup = await screen.findByTestId('invite-signup');
    expect(signup).toHaveTextContent("We'll email a 6-digit code to i•••@example.com");
    expect(screen.getByRole('button', { name: 'Send me a code' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('valid, paid: the price and ONE payment statement (SA CR-1: "opens soon", not "required at signup", until 5c)', async () => {
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
    expect(section).not.toHaveTextContent('Payment is required at signup.');
    expect(section).toHaveTextContent(INVITE_PAGE_COPY.en.paymentOpensLater);
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

describe('Slice 1a: the invited email already has an account (FR-8a)', () => {
  const existing = (language = 'en') => ({
    status: 200,
    body: { success: true, data: { state: 'existing_account', language, inviterDisplayName: 'Dana' } },
  });

  it('says so and sends the person to the normal sign-in page; no offer, no note, no form', async () => {
    respond = () => existing();
    render(<InvitePage />);
    const section = await screen.findByTestId('invite-state-existing_account');
    expect(section).toHaveTextContent(INVITE_PAGE_COPY.en.existingAccountHeading);
    expect(section).toHaveTextContent(INVITE_PAGE_COPY.en.existingAccountBody);
    const signIn = screen.getByTestId('invite-sign-in');
    expect(signIn).toHaveAttribute('href', expect.stringContaining('/login'));
    expect(signIn.getAttribute('href')).not.toContain(TOKEN);
    expect(screen.queryByTestId('invite-plan')).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-note')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['he', 'rtl'],
    ['es', 'ltr'],
  ])('renders in the invite language (%s, %s)', async (language, dir) => {
    respond = () => existing(language);
    render(<InvitePage />);
    const section = await screen.findByTestId('invite-state-existing_account');
    const copy = INVITE_PAGE_COPY[language as 'he' | 'es'];
    expect(section).toHaveTextContent(copy.existingAccountHeading);
    expect(screen.getByTestId('invite-sign-in')).toHaveTextContent(copy.signIn);
    expect(screen.getByTestId('invite-page')).toHaveAttribute('dir', dir);
  });
});

describe('Slice 1a: a signed-in visitor is asked to sign out first (L-8)', () => {
  it('on a valid invite: names the account and offers Sign out; the offer is still visible', async () => {
    session.user = { id: 'user-1', email: 'someone@example.com' };
    render(<InvitePage />);
    const notice = await screen.findByTestId('invite-signed-in');
    expect(notice).toHaveTextContent("You're signed in as someone@example.com");
    expect(notice).toHaveTextContent(INVITE_PAGE_COPY.en.signedInBody);
    expect(screen.getByTestId('invite-state-valid')).toBeInTheDocument();
  });

  it('on an existing-account invite: shows the notice and hides the Sign in button', async () => {
    session.user = { id: 'user-1', email: 'someone@example.com' };
    respond = () => ({
      status: 200,
      body: { success: true, data: { state: 'existing_account', language: 'en', inviterDisplayName: 'Dana' } },
    });
    render(<InvitePage />);
    await screen.findByTestId('invite-signed-in');
    expect(screen.getByTestId('invite-state-existing_account')).toBeInTheDocument();
    expect(screen.queryByTestId('invite-sign-in')).not.toBeInTheDocument();
  });

  it.each(['expired', 'revoked', 'used', 'unavailable'])('not shown on a %s invite (nothing to accept)', async (state) => {
    session.user = { id: 'user-1', email: 'someone@example.com' };
    respond = () => ({ status: 200, body: { success: true, data: { state, language: 'en', inviterDisplayName: 'Dana' } } });
    render(<InvitePage />);
    await screen.findByTestId(`invite-state-${state}`);
    expect(screen.queryByTestId('invite-signed-in')).not.toBeInTheDocument();
  });

  it('Sign out goes through the audited sign-out for this browser, then re-checks the invite', async () => {
    session.user = { id: 'user-1', email: 'someone@example.com' };
    const user = userEvent.setup();
    render(<InvitePage />);
    await screen.findByTestId('invite-signed-in');
    await user.click(screen.getByRole('button', { name: INVITE_PAGE_COPY.en.signOut }));

    await waitFor(() => expect(screen.queryByTestId('invite-signed-in')).not.toBeInTheDocument());
    expect(session.signOuts).toEqual([
      { scope: 'local', user: { id: 'user-1', email: 'someone@example.com' }, method: 'invite-page' },
    ]);
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ token: TOKEN });
  });

  it('Slice 1b (L-8): a signed-in visitor on a valid invite gets no signup form', async () => {
    session.user = { id: 'user-1', email: 'someone@example.com' };
    render(<InvitePage />);
    await screen.findByTestId('invite-signed-in');
    expect(screen.queryByTestId('invite-signup')).not.toBeInTheDocument();
  });

  it('Slice 3b (L-8): a signed-in visitor gets no Google button either, even when it is configured', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID = 'client.apps.googleusercontent.com';
    session.user = { id: 'user-1', email: 'someone@example.com' };
    render(<InvitePage />);
    await screen.findByTestId('invite-signed-in');
    expect(screen.queryByTestId('invite-google-stub')).not.toBeInTheDocument();
  });

  it('SA N-1: the notice body reads correctly on an existing-account invite', () => {
    expect(INVITE_PAGE_COPY.en.signedInBody).toBe('Sign out to continue with this invitation.');
    expect(INVITE_PAGE_COPY.en.signedInBody).not.toContain('can only be accepted');
  });

  it('a signed-out visitor sees no notice', async () => {
    render(<InvitePage />);
    await screen.findByTestId('invite-state-valid');
    expect(screen.queryByTestId('invite-signed-in')).not.toBeInTheDocument();
  });

  it('an unreadable session is treated as signed out for display only', async () => {
    session.getSessionRejects = true;
    render(<InvitePage />);
    await screen.findByTestId('invite-state-valid');
    expect(screen.queryByTestId('invite-signed-in')).not.toBeInTheDocument();
  });

  it('QA-3: the Sign in button stays hidden while the session check is pending, even after the invite check answered', async () => {
    let release: () => void = () => undefined;
    session.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    session.user = { id: 'user-1', email: 'someone@example.com' };
    respond = () => ({
      status: 200,
      body: { success: true, data: { state: 'existing_account', language: 'en', inviterDisplayName: 'Dana' } },
    });
    render(<InvitePage />);
    await screen.findByTestId('invite-state-existing_account');
    expect(screen.queryByTestId('invite-sign-in')).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-signed-in')).not.toBeInTheDocument();

    release();
    await screen.findByTestId('invite-signed-in');
    expect(screen.queryByTestId('invite-sign-in')).not.toBeInTheDocument();
  });

  it('QA-3: a signed-out visitor sees Sign in once the session check answers', async () => {
    let release: () => void = () => undefined;
    session.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    respond = () => ({
      status: 200,
      body: { success: true, data: { state: 'existing_account', language: 'en', inviterDisplayName: 'Dana' } },
    });
    render(<InvitePage />);
    await screen.findByTestId('invite-state-existing_account');
    expect(screen.queryByTestId('invite-sign-in')).not.toBeInTheDocument();
    release();
    expect(await screen.findByTestId('invite-sign-in')).toBeInTheDocument();
  });

  it('QA-6: in Hebrew the email is isolated left-to-right inside the right-to-left sentence', async () => {
    session.user = { id: 'user-1', email: 'someone@example.com' };
    respond = () => ({ status: 200, body: { success: true, data: { ...validData, language: 'he' } } });
    render(<InvitePage />);
    const notice = await screen.findByTestId('invite-signed-in');
    expect(notice.textContent).toContain('\u2066someone@example.com\u2069');
    expect(INVITE_PAGE_COPY.he.signedInHeading('a@b.co')).toMatch(/\u2066a@b\.co\u2069$/);
    expect(screen.getByTestId('invite-page')).toHaveAttribute('dir', 'rtl');
  });

  it('with no email on the session, still says someone is signed in', async () => {
    session.user = { id: 'user-1', email: null };
    render(<InvitePage />);
    expect(await screen.findByTestId('invite-signed-in')).toHaveTextContent("You're already signed in");
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
    expect(await screen.findByTestId('invite-signup')).toHaveTextContent(INVITE_PAGE_COPY.es.signup.codeWillGoTo('i•••@example.com'));
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

describe('credit deduction slice 6: the credits row, its number and its sentence (D-g, D-h, OI-10)', () => {
  // The offer is the REAL one the server builds, in the invite's language — no
  // credit figure is written in this test; the expected number is read off the
  // resolver, and grouped by the same `Intl` call the module makes.
  const config = getEntitlementConfig();
  const NOW = new Date('2026-10-01T00:00:00.000Z');
  const plans = [...config.tierOrder, ...Object.keys(config.cohorts)];

  function allowanceOf(planId: string): { perMonth?: number; total?: number } {
    const resolution = resolveEntitlements({ config, account: previewAccountFor(config, planId, NOW), overrides: [], addons: [], now: NOW });
    return resolution.values['credits.allowance'].value as { perMonth?: number; total?: number };
  }

  function grantFor(planId: string) {
    return config.tierOrder.includes(planId)
      ? { grant_kind: 'tier' as const, grant_id: planId, access_open_ended: null, access_months: null }
      : { grant_kind: 'cohort' as const, grant_id: planId, access_open_ended: true, access_months: null };
  }

  const PHRASE = {
    en: { perMonth: 'per month', total: 'in total' },
    he: { perMonth: 'לחודש', total: 'בסך הכול' },
    es: { perMonth: 'al mes', total: 'en total' },
  } as const;

  it.each((['en', 'he', 'es'] as const).flatMap((language) => plans.map((planId) => [language, planId] as const)))(
    '%s, %s: "Credits" heads the list, the line carries the configured number, the sentence sits under it',
    async (language, planId) => {
      const offer = describeInviteOffer(grantFor(planId), config, NOW, language);
      respond = () => ({ status: 200, body: { success: true, data: { ...validData, language, offer } } });
      render(<InvitePage />);
      await screen.findByTestId('invite-state-valid');

      const copy = INVITE_PAGE_COPY[language];
      const allowance = allowanceOf(planId);
      const oneOff = typeof allowance.total === 'number';
      const number = new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(
        (oneOff ? allowance.total : allowance.perMonth)!
      );
      const sentence = copy.planCategoryNote[oneOff ? 'usage.explain.trial' : 'usage.explain.monthly'];

      const firstRow = screen.getAllByRole('listitem')[0];
      const heading = copy.planCategory['plan.category.credits'];
      // "Credits: 19,750 per month" — the value alone after the heading, never
      // "Credits: Credits (…)" (user decision, 2026-10-02).
      const note = firstRow.querySelector('[data-testid^="invite-category-note-"]')?.textContent ?? '';
      const headingAndLine = (firstRow.textContent ?? '').replace(note, '').trim();
      expect(headingAndLine).toBe(`${heading}: ${number} ${oneOff ? PHRASE[language].total : PHRASE[language].perMonth}`);
      expect(headingAndLine.split(heading)).toHaveLength(2);
      expect(screen.getByTestId('invite-category-note-credits')).toHaveTextContent(sentence);
      // Once, and only under the credits row.
      expect(screen.getAllByTestId(/^invite-category-note-/)).toHaveLength(1);
    }
  );

  it('a note key the page has no words for shows nothing, never the raw key', async () => {
    const offer = {
      ...validData.offer,
      included: [{ category: 'credits', labelKey: 'plan.category.credits', noteKey: 'usage.explain.unknown', summary: 'Credits (x)' }],
    };
    respond = () => ({ status: 200, body: { success: true, data: { ...validData, offer } } });
    render(<InvitePage />);
    await screen.findByTestId('invite-state-valid');

    expect(screen.queryByTestId('invite-category-note-credits')).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toContain('usage.explain.unknown');
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

  it.each([
    'page.tsx',
    'layout.tsx',
    'invitePageCopy.ts',
    'useSignedInVisitor.ts',
    'SignupForm.tsx',
    // Slice 3b
    'GoogleSignupButton.tsx',
    'useGoogleIdentity.ts',
  ])('%s uses no dangerouslySetInnerHTML, LanguageContext, navigator.language or console', (file) => {
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

describe('Slice 3b: "Continue with Google" on the page (D-9, R-6, L-8, T-3b-16)', () => {
  const CLIENT_ID = 'client.apps.googleusercontent.com';

  it('unconfigured: no Google button at all; the code form is there', async () => {
    render(<InvitePage />);
    await screen.findByTestId('invite-signup');
    expect(screen.queryByTestId('invite-google-stub')).not.toBeInTheDocument();
    expect(mockGoogleProps).toEqual([]);
  });

  it('R-6: the plugin client id alone does not show it', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'plugin-client.apps.googleusercontent.com';
    render(<InvitePage />);
    await screen.findByTestId('invite-signup');
    expect(screen.queryByTestId('invite-google-stub')).not.toBeInTheDocument();
  });

  it('configured, signed out, valid: the button ABOVE the code form, with the client id, the invite language and the masked email', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID = CLIENT_ID;
    respond = () => ({ status: 200, body: { success: true, data: { ...validData, language: 'he' } } });
    render(<InvitePage />);
    const google = await screen.findByTestId('invite-google-stub');
    const form = screen.getByTestId('invite-signup');
    expect(google.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(mockGoogleProps.at(-1)).toEqual({ clientId: CLIENT_ID, locale: 'he', maskedEmail: 'i•••@example.com' });
  });

  it.each(['existing_account', 'expired', 'revoked', 'used', 'unavailable'])('not on a %s invite', async (state) => {
    process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID = CLIENT_ID;
    respond = () => ({ status: 200, body: { success: true, data: { state, language: 'en', inviterDisplayName: 'Dana' } } });
    render(<InvitePage />);
    await screen.findByTestId(`invite-state-${state}`);
    expect(screen.queryByTestId('invite-google-stub')).not.toBeInTheDocument();
  });

  it('once a Google signup created the account, the code form is hidden', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID = CLIENT_ID;
    const user = userEvent.setup();
    render(<InvitePage />);
    await user.click(await screen.findByTestId('invite-google-stub'));
    await waitFor(() => expect(screen.queryByTestId('invite-signup')).not.toBeInTheDocument());
  });
});

describe('Slice 5b (FR-34, D-11): a champion friend invite is `valid`, with the form, the Google button and the payment line', () => {
  const friendData = {
    state: 'valid',
    language: 'en',
    inviterDisplayName: 'Dana Champion',
    personalNote: 'You will love this',
    linkExpiresAt: '2026-10-31T12:00:00.000Z',
    maskedEmail: 'f•••@example.com',
    offer: {
      planName: 'Fixture Paid Plan',
      free: false,
      monthlyPriceUsd: 49,
      access: { kind: 'while_paid', months: null },
      included: [{ category: 'crm', label: 'Clients (CRM)', summary: 'Contacts, Pipelines' }],
    },
  };

  it('shows who invited, the note, the plan, its price, "payment required", the payment-later line, the form and Google', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID = 'client.apps.googleusercontent.com';
    respond = () => ({ status: 200, body: { success: true, data: friendData } });
    render(<InvitePage />);

    const section = await screen.findByTestId('invite-state-valid');
    const copy = INVITE_PAGE_COPY.en;
    expect(section).toHaveTextContent(copy.validHeading('Dana Champion'));
    expect(screen.getByTestId('invite-note')).toHaveTextContent('You will love this');
    expect(section).toHaveTextContent(copy.perMonth(49));
    expect(screen.getByTestId('invite-payment-opens-later')).toHaveTextContent(copy.paymentOpensLater);
    expect(await screen.findByTestId('invite-signup')).toBeInTheDocument();
    expect(screen.getByTestId('invite-google-stub')).toBeInTheDocument();
    // Only the validate call: nothing is requested until the friend acts.
    expect(calls).toHaveLength(1);
  });

  it.each(['en', 'he', 'es'] as const)('SA CR-1 (%s): a friend invite shows exactly ONE payment statement, never "required at signup"', async (language) => {
    respond = () => ({ status: 200, body: { success: true, data: { ...friendData, language } } });
    render(<InvitePage />);
    const section = await screen.findByTestId('invite-state-valid');
    const copy = INVITE_PAGE_COPY[language];
    expect(section.textContent).not.toContain(copy.paymentRequired);
    expect(section.textContent?.split(copy.paymentOpensLater).length).toBe(2);
  });

  it('a free (champion) offer has no payment line', async () => {
    render(<InvitePage />);
    await screen.findByTestId('invite-state-valid');
    expect(screen.queryByTestId('invite-payment-opens-later')).not.toBeInTheDocument();
  });

  it('the 5a "opens soon" state is gone (SA Q-8): an unknown state renders nothing actionable', async () => {
    respond = () => ({ status: 200, body: { success: true, data: { ...friendData, state: 'signup_opens_soon' } } });
    render(<InvitePage />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.queryByTestId('invite-signup')).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-google-stub')).not.toBeInTheDocument();
  });

  it('every locale has the payment-later sentence, and it names no price or plan', () => {
    for (const locale of ['en', 'he', 'es'] as const) {
      const line = INVITE_PAGE_COPY[locale].paymentOpensLater;
      expect(line.length).toBeGreaterThan(10);
      expect(line).not.toMatch(/[0-9$]/);
    }
  });
});
