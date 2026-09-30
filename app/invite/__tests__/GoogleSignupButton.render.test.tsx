/**
 * @jest-environment jsdom
 *
 * "Continue with Google" on a champion invite (Slice 3b; T-3b-16, D-1, D-6,
 * D-10, SA R-2, R-8): Google's button in popup mode with no One Tap and no
 * auto-select, the nonce contract (Google gets SHA-256 of the raw nonce; the
 * server and Supabase get the raw one), no request until a credential arrives,
 * each server code shown in the invite's language, and the "account is ready"
 * fallback when the browser sign-in fails.
 *
 * Google's script is replaced at the `next/script` boundary and `window.google`
 * is a fake that records what the page asked of it.
 */

import '@testing-library/jest-dom';
import { createHash, webcrypto } from 'crypto';
import { TextEncoder } from 'util';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

const script = { fail: false, srcs: [] as string[] };
jest.mock('next/script', () => ({
  __esModule: true,
  default: function ScriptStub(props: { src: string; onReady?: () => void; onError?: () => void }) {
    useEffect(() => {
      script.srcs.push(props.src);
      if (script.fail) props.onError?.();
      else props.onReady?.();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, like a script load
    }, []);
    return null;
  },
}));

const signIns: Array<[string, string]> = [];
let signInResult: { ok: boolean } = { ok: true };
jest.mock('@/lib/client/auth-actions', () => ({
  signInWithGoogleIdToken: async (idToken: string, nonce: string) => {
    signIns.push([idToken, nonce]);
    return signInResult;
  },
}));

import { GoogleSignupButton } from '../GoogleSignupButton';
import { INVITE_PAGE_COPY, LTR_ISOLATE, POP_ISOLATE, type InviteLocale } from '../invitePageCopy';
import { GOOGLE_IDENTITY_SCRIPT_SRC } from '../useGoogleIdentity';

const TOKEN = 'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';
const CLIENT_ID = '1234567890-abc.apps.googleusercontent.com';
const ID_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
const MASKED = 'i•••@gmail.com';

interface InitConfig {
  client_id: string;
  nonce: string;
  ux_mode: string;
  auto_select: boolean;
  callback: (response: { credential?: string }) => void;
}

let initConfigs: InitConfig[] = [];
let buttons: Array<{ options: Record<string, unknown> }> = [];
let calls: Array<{ url: string; init?: RequestInit }> = [];
let answers: Array<{ status: number; body: unknown }> = [];
let accountReady = 0;

beforeAll(() => {
  // jsdom lacks Web Crypto's subtle digest and TextEncoder; use Node's.
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
});

beforeEach(() => {
  initConfigs = [];
  buttons = [];
  calls = [];
  answers = [];
  accountReady = 0;
  signIns.length = 0;
  signInResult = { ok: true };
  script.fail = false;
  script.srcs = [];
  replace.mockReset();
  (window as unknown as { google?: unknown }).google = {
    accounts: {
      id: {
        initialize: (config: InitConfig) => initConfigs.push(config),
        renderButton: (parent: HTMLElement, options: Record<string, unknown>) => {
          buttons.push({ options });
          const button = document.createElement('div');
          button.setAttribute('data-testid', 'gis-button');
          parent.appendChild(button);
        },
      },
    },
  };
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const { status, body } = answers.shift() ?? { status: 500, body: {} };
    return Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) } as Response);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  delete (window as unknown as { google?: unknown }).google;
});

function renderButton(locale: InviteLocale = 'en') {
  return render(
    <GoogleSignupButton
      token={TOKEN}
      clientId={CLIENT_ID}
      locale={locale}
      maskedEmail={MASKED}
      copy={INVITE_PAGE_COPY[locale].signup}
      signInLabel={INVITE_PAGE_COPY[locale].signIn}
      onAccountReady={() => {
        accountReady += 1;
      }}
    />
  );
}

async function rendered(locale: InviteLocale = 'en') {
  renderButton(locale);
  await screen.findByTestId('gis-button');
  return initConfigs[0];
}

/** Google returning a credential from the popup. */
async function credential(config: InitConfig) {
  await act(async () => {
    config.callback({ credential: ID_TOKEN });
  });
}

describe('Google Identity Services set-up (D-6, D-10)', () => {
  it('loads Google\'s script and draws Google\'s button in popup mode, no One Tap, no auto-select, in the invite\'s language', async () => {
    const config = await rendered('he');
    expect(script.srcs).toEqual([GOOGLE_IDENTITY_SCRIPT_SRC]);
    expect(GOOGLE_IDENTITY_SCRIPT_SRC).toBe('https://accounts.google.com/gsi/client');
    expect(initConfigs).toHaveLength(1);
    expect(config).toMatchObject({ client_id: CLIENT_ID, ux_mode: 'popup', auto_select: false });
    expect(buttons).toEqual([{ options: expect.objectContaining({ text: 'continue_with', locale: 'he', type: 'standard' }) }]);
  });

  it('Google is given a 64-character lowercase hex nonce, never the raw one', async () => {
    const config = await rendered();
    expect(config.nonce).toMatch(/^[0-9a-f]{64}$/);
  });

  it('T-3b-16: no request of any kind before a credential arrives (a closed popup does nothing)', async () => {
    await rendered();
    expect(calls).toEqual([]);
    expect(screen.queryByTestId('invite-google-busy')).not.toBeInTheDocument();
    expect(screen.getByTestId('invite-google-error')).toBeEmptyDOMElement();
  });

  it('a callback without a credential is ignored', async () => {
    const config = await rendered();
    await act(async () => {
      config.callback({});
      config.callback({ credential: '' });
    });
    expect(calls).toEqual([]);
  });

  it('D-10: a script that fails to load leaves nothing on the page', async () => {
    script.fail = true;
    const { container } = renderButton();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(initConfigs).toEqual([]);
  });
});

describe('a credential (D-1, D-6)', () => {
  it('posts exactly { token, idToken, nonce: raw } where SHA-256(raw) is what Google got, then signs in with the same pair and lands', async () => {
    answers.push({ status: 200, body: { success: true, data: { redirectTo: '/onboarding-chat' } } });
    const config = await rendered();
    await credential(config);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/onboarding-chat'));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/public/invites/signup/google');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.referrerPolicy).toBe('no-referrer');
    const body = JSON.parse(String(calls[0].init?.body));
    expect(Object.keys(body).sort()).toEqual(['idToken', 'nonce', 'token']);
    expect(body.token).toBe(TOKEN);
    expect(body.idToken).toBe(ID_TOKEN);
    expect(body.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createHash('sha256').update(body.nonce).digest('hex')).toBe(config.nonce);
    // Supabase gets the RAW nonce too (it hashes it to compare with the token).
    expect(signIns).toEqual([[ID_TOKEN, body.nonce]]);
  });

  it('shows the busy line only while the request is in flight', async () => {
    let release: () => void = () => undefined;
    global.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () =>
            resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, data: { redirectTo: '/onboarding-chat' } }) } as Response);
        })
    ) as unknown as typeof fetch;
    const config = await rendered();
    await credential(config);
    expect(screen.getByTestId('invite-google-busy')).toHaveTextContent(INVITE_PAGE_COPY.en.signup.google.creating);
    await act(async () => release());
    await waitFor(() => expect(screen.queryByTestId('invite-google-busy')).not.toBeInTheDocument());
  });

  it('the browser sign-in failing shows "Your account is ready" with the sign-in link, and tells the page', async () => {
    answers.push({ status: 200, body: { success: true, data: { redirectTo: '/onboarding-chat' } } });
    signInResult = { ok: false };
    const config = await rendered();
    await credential(config);

    const ready = await screen.findByTestId('invite-google-ready');
    expect(ready).toHaveTextContent(INVITE_PAGE_COPY.en.signup.google.readyHeading);
    expect(ready).toHaveTextContent(INVITE_PAGE_COPY.en.signup.google.readyBody);
    expect(ready.querySelector('a')?.getAttribute('href')).toMatch(/\/login$/);
    expect(accountReady).toBe(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('a not-recognised answer (200 without redirectTo) is "no longer available", and no sign-in is tried', async () => {
    answers.push({ status: 200, body: { success: true, data: { state: 'not_recognised' } } });
    const config = await rendered();
    await credential(config);
    expect(await screen.findByText(INVITE_PAGE_COPY.en.signup.errors.no_longer_available)).toBeInTheDocument();
    expect(signIns).toEqual([]);
  });

  it('nothing is written to browser storage', async () => {
    answers.push({ status: 200, body: { success: true, data: { redirectTo: '/onboarding-chat' } } });
    const config = await rendered();
    await credential(config);
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe('each server code in the invite\'s language (R-2, R-8)', () => {
  const en = INVITE_PAGE_COPY.en.signup;

  it.each([
    ['google_email_mismatch', 409, en.google.errors.google_email_mismatch(MASKED)],
    ['google_email_unverified', 409, en.google.errors.google_email_unverified],
    ['google_use_code', 409, en.google.errors.google_use_code],
    ['google_token_invalid', 400, en.google.errors.google_token_invalid],
    ['existing_account', 409, en.errors.existing_account],
    ['signup_in_progress', 409, en.errors.signup_in_progress],
    ['signed_in', 409, en.errors.signed_in],
    ['used', 409, en.errors.no_longer_available],
    ['paid_invites_not_available', 409, en.errors.no_longer_available],
    ['try_again', 409, en.errors.generic],
    ['unavailable_try_again', 503, en.errors.generic],
    ['google_signin_not_configured', 404, en.errors.generic],
  ])('%s (%i) → its message; no sign-in attempted', async (error, status, message) => {
    answers.push({ status, body: { success: false, error } });
    const config = await rendered();
    await credential(config);
    await waitFor(() => expect(screen.getByTestId('invite-google-error')).toHaveTextContent(message));
    expect(signIns).toEqual([]);
  });

  it('every refusal about the Google account points to the emailed code (R-8)', () => {
    for (const locale of ['en', 'he', 'es'] as const) {
      const google = INVITE_PAGE_COPY[locale].signup.google;
      const phrase = { en: 'emailed code below', he: 'בקוד שנשלח במייל', es: 'código por correo' }[locale];
      for (const text of [
        google.errors.google_email_mismatch(MASKED),
        google.errors.google_email_unverified,
        google.errors.google_use_code,
        google.errors.google_token_invalid,
      ]) {
        expect(text).toContain(phrase);
      }
    }
  });

  it('SA R-2 copy is exactly as ruled in English', () => {
    expect(en.google.errors.google_use_code).toBe('For this address, please use the emailed code below.');
  });

  it('Hebrew: the mismatch message isolates the masked address left-to-right', async () => {
    answers.push({ status: 409, body: { success: false, error: 'google_email_mismatch' } });
    const config = await rendered('he');
    await credential(config);
    await waitFor(() =>
      expect(screen.getByTestId('invite-google-error')).toHaveTextContent(`${LTR_ISOLATE}${MASKED}${POP_ISOLATE}`, { normalizeWhitespace: false })
    );
  });

  it('Spanish: the not-authoritative message', async () => {
    answers.push({ status: 409, body: { success: false, error: 'google_use_code' } });
    const config = await rendered('es');
    await credential(config);
    await waitFor(() => expect(screen.getByTestId('invite-google-error')).toHaveTextContent(INVITE_PAGE_COPY.es.signup.google.errors.google_use_code));
  });

  it('every locale has every Google string', () => {
    const keys = (locale: InviteLocale) => [
      ...Object.keys(INVITE_PAGE_COPY[locale].signup.google).sort(),
      ...Object.keys(INVITE_PAGE_COPY[locale].signup.google.errors).sort(),
    ];
    expect(keys('he')).toEqual(keys('en'));
    expect(keys('es')).toEqual(keys('en'));
  });
});
