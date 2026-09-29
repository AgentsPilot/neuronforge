/**
 * @jest-environment jsdom
 *
 * The champion signup form (Slice 1b): the two steps, the client-side checks
 * (6 digits, 8 characters, 72 BYTES per R-13, matching confirmation), the
 * server's error codes shown in the invite's language in a live region, the
 * password sign-in after success (F-2), the "account is ready" fallback, and
 * that the password and token go only into POST bodies.
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Typing a 25-character password several times with userEvent is slow when the
// machine is busy (a full-suite run): give these tests room rather than flake.
jest.setTimeout(30_000);

const replace = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));

const signIns: Array<[string, string]> = [];
let signInResult = { ok: true };
jest.mock('@/lib/client/auth-actions', () => ({
  signInWithPassword: async (email: string, password: string) => {
    signIns.push([email, password]);
    return signInResult;
  },
}));

import { SignupForm } from '../SignupForm';
import { INVITE_PAGE_COPY } from '../invitePageCopy';

const TOKEN = 'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';
const PASSWORD = 'correct horse battery';
const copy = INVITE_PAGE_COPY.en.signup;

let calls: Array<{ url: string; init?: RequestInit }> = [];
let answers: Array<{ status: number; body: unknown }> = [];

beforeEach(() => {
  calls = [];
  answers = [];
  signIns.length = 0;
  signInResult = { ok: true };
  replace.mockReset();
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const { status, body } = answers.shift() ?? { status: 500, body: {} };
    return Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) } as Response);
  }) as unknown as typeof fetch;
});

function renderForm() {
  return render(<SignupForm token={TOKEN} maskedEmail="i•••@example.com" copy={copy} signInLabel="Sign in" />);
}

async function toCodeStep() {
  const user = userEvent.setup();
  answers.push({ status: 200, body: { success: true, data: { codeExpiresAt: 'x', resendAvailableAt: 'y' } } });
  renderForm();
  await user.click(screen.getByRole('button', { name: copy.sendCode }));
  await screen.findByTestId('invite-signup-form');
  return user;
}

async function fill(user: ReturnType<typeof userEvent.setup>, values: { code?: string; password?: string; confirm?: string }) {
  if (values.code !== undefined) await user.type(screen.getByLabelText(copy.codeLabel), values.code);
  if (values.password !== undefined) await user.type(screen.getByLabelText(copy.passwordLabel), values.password);
  if (values.confirm !== undefined) await user.type(screen.getByLabelText(copy.confirmLabel), values.confirm);
}

describe('step 1: request a code', () => {
  it('shows the masked address, and posts ONLY the token to the code route', async () => {
    await toCodeStep();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/public/invites/signup/code');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ token: TOKEN });
    expect(screen.getByTestId('invite-signup')).toHaveTextContent('i•••@example.com');
  });

  it('shows a 429 with its wait time, in the live region', async () => {
    const user = userEvent.setup();
    answers.push({ status: 429, body: { success: false, error: 'code_recently_sent', retryAfterSeconds: 42 } });
    renderForm();
    await user.click(screen.getByRole('button', { name: copy.sendCode }));
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert).toHaveTextContent(copy.errors.code_recently_sent(42)));
    expect(alert).toHaveAttribute('aria-live', 'polite');
  });
});

describe('step 2: code and password', () => {
  it('client checks: 6 digits, 8 characters, 72 BYTES (R-13), matching confirmation; nothing posted', async () => {
    const user = await toCodeStep();
    await user.click(screen.getByRole('button', { name: copy.create }));
    expect(screen.getByRole('alert')).toHaveTextContent(copy.errors.code_format);

    await fill(user, { code: '482913', password: 'short', confirm: 'short' });
    await user.click(screen.getByRole('button', { name: copy.create }));
    expect(screen.getByRole('alert')).toHaveTextContent(copy.errors.password_short);

    await user.clear(screen.getByLabelText(copy.passwordLabel));
    await user.clear(screen.getByLabelText(copy.confirmLabel));
    const multiByte = '漢'.repeat(25); // 25 characters, 75 bytes
    await fill(user, { password: multiByte, confirm: multiByte });
    await user.click(screen.getByRole('button', { name: copy.create }));
    expect(screen.getByRole('alert')).toHaveTextContent(copy.errors.password_long);

    await user.clear(screen.getByLabelText(copy.passwordLabel));
    await user.clear(screen.getByLabelText(copy.confirmLabel));
    await fill(user, { password: PASSWORD, confirm: `${PASSWORD}x` });
    await user.click(screen.getByRole('button', { name: copy.create }));
    expect(screen.getByRole('alert')).toHaveTextContent(copy.errors.password_mismatch);

    expect(calls).toHaveLength(1);
  });

  it('the code field keeps digits only, at most six', async () => {
    const user = await toCodeStep();
    await fill(user, { code: '48a29 13999' });
    expect(screen.getByLabelText(copy.codeLabel)).toHaveValue('482913');
  });

  it('success: posts token, code and password only, signs in with the returned email and the password, goes to onboarding', async () => {
    const user = await toCodeStep();
    answers.push({ status: 200, body: { success: true, data: { email: 'invitee@example.com', redirectTo: '/onboarding-chat' } } });
    await fill(user, { code: '482913', password: PASSWORD, confirm: PASSWORD });
    await user.click(screen.getByRole('button', { name: copy.create }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/onboarding-chat'));
    expect(calls[1].url).toBe('/api/public/invites/signup/complete');
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ token: TOKEN, signupCode: '482913', password: PASSWORD });
    expect(calls.every((call) => !call.url.includes(PASSWORD) && !call.url.includes(TOKEN))).toBe(true);
    expect(signIns).toEqual([['invitee@example.com', PASSWORD]]);
  });

  it('F-2 fallback: if the browser sign-in fails, the account is ready and the page links to sign in', async () => {
    signInResult = { ok: false };
    const user = await toCodeStep();
    answers.push({ status: 200, body: { success: true, data: { email: 'invitee@example.com', redirectTo: '/onboarding-chat' } } });
    await fill(user, { code: '482913', password: PASSWORD, confirm: PASSWORD });
    await user.click(screen.getByRole('button', { name: copy.create }));

    const ready = await screen.findByTestId('invite-signup-ready');
    expect(ready).toHaveTextContent(copy.readyBody);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', expect.stringContaining('/login'));
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    [{ error: 'code_invalid', attemptsRemaining: 3 }, copy.errors.code_invalid(3)],
    [{ error: 'code_locked' }, copy.errors.code_locked],
    [{ error: 'code_expired' }, copy.errors.code_expired],
    [{ error: 'existing_account' }, copy.errors.existing_account],
    [{ error: 'signup_in_progress' }, copy.errors.signup_in_progress],
    [{ error: 'weak_password' }, copy.errors.weak_password],
    [{ error: 'revoked' }, copy.errors.no_longer_available],
    [{ error: 'unavailable_try_again' }, copy.errors.generic],
  ])('maps the server answer %j to its message', async (body, message) => {
    const user = await toCodeStep();
    answers.push({ status: 409, body: { success: false, ...body } });
    await fill(user, { code: '482913', password: PASSWORD, confirm: PASSWORD });
    await user.click(screen.getByRole('button', { name: copy.create }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
    expect(signIns).toEqual([]);
  });

  it('"not recognised" is shown as "no longer available"', async () => {
    const user = await toCodeStep();
    answers.push({ status: 200, body: { success: true, data: { state: 'not_recognised' } } });
    await fill(user, { code: '482913', password: PASSWORD, confirm: PASSWORD });
    await user.click(screen.getByRole('button', { name: copy.create }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(copy.errors.no_longer_available));
  });
});

describe('copy', () => {
  it('every locale has every signup string, including every error', () => {
    const keys = (value: object) => Object.keys(value).sort();
    for (const locale of ['he', 'es'] as const) {
      expect(keys(INVITE_PAGE_COPY[locale].signup)).toEqual(keys(INVITE_PAGE_COPY.en.signup));
      expect(keys(INVITE_PAGE_COPY[locale].signup.errors)).toEqual(keys(INVITE_PAGE_COPY.en.signup.errors));
    }
  });

  it('Hebrew isolates the masked address left to right (QA-6 rule)', () => {
    expect(INVITE_PAGE_COPY.he.signup.codeSentTo('d•••@x.com')).toContain('⁦d•••@x.com⁩');
  });
});
