/**
 * @jest-environment jsdom
 *
 * FR-22 on the public invite page (plan payments P-9.2; SA C-6, C-7).
 *
 * The page renders the server's `payment` flag and decides nothing:
 *   required     → ONE line, the existing `copy.paymentRequired` ("Payment is
 *                  required at signup."), no "opens soon" line;
 *   opens_later  → ONE line, the existing `paymentOpensLater`;
 *   none / free  → no payment line.
 * The same for an admin Paid invite and a champion's friend invite, in en,
 * he (right to left) and es. No new copy key (C-7).
 */

import '@testing-library/jest-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen } from '@testing-library/react';

jest.mock('@/lib/supabaseClient', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null }, error: null }) } },
}));
jest.mock('@/lib/client/auth-actions', () => ({
  signOutUser: async () => ({ ok: true }),
  signInWithPassword: async () => ({ ok: true }),
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock('../GoogleSignupButton', () => ({ GoogleSignupButton: () => null }));

import InvitePage from '../page';
import { INVITE_PAGE_COPY } from '../invitePageCopy';

const TOKEN = 'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';

const paidData = (language: 'en' | 'he' | 'es', payment: 'none' | 'required' | 'opens_later' | undefined, inviter = 'Dana Admin') => ({
  state: 'valid',
  language,
  inviterDisplayName: inviter,
  personalNote: null,
  linkExpiresAt: '2026-10-31T12:00:00.000Z',
  maskedEmail: 'b•••@example.com',
  offer: {
    planName: 'Fixture Paid Plan',
    free: false,
    monthlyPriceUsd: 129,
    access: { kind: 'while_paid', months: null },
    included: [],
  },
  ...(payment === undefined ? {} : { payment }),
});

let body: unknown;

beforeEach(() => {
  window.history.replaceState(null, '', `/invite#t=${TOKEN}`);
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, data: body }) } as Response)
  ) as unknown as typeof fetch;
});

describe('FR-22: payment required at signup (SA C-6, C-7)', () => {
  it.each(['en', 'he', 'es'] as const)('%s, required: exactly one "required" line (the existing key), no "opens soon"', async (language) => {
    body = paidData(language, 'required');
    render(<InvitePage />);
    const section = await screen.findByTestId('invite-state-valid');
    const copy = INVITE_PAGE_COPY[language];
    expect(screen.getByTestId('invite-payment-required')).toHaveTextContent(copy.paymentRequired);
    expect(screen.queryByTestId('invite-payment-opens-later')).not.toBeInTheDocument();
    expect(section.textContent?.split(copy.paymentRequired).length).toBe(2);
    expect(section.textContent).not.toContain(copy.paymentOpensLater);
    if (language === 'he') expect(screen.getByTestId('invite-page')).toHaveAttribute('dir', 'rtl');
  });

  it.each(['en', 'he', 'es'] as const)('%s, opens_later: exactly one "opens soon" line, never "required"', async (language) => {
    body = paidData(language, 'opens_later', 'Dana Champion');
    render(<InvitePage />);
    const section = await screen.findByTestId('invite-state-valid');
    const copy = INVITE_PAGE_COPY[language];
    expect(screen.getByTestId('invite-payment-opens-later')).toHaveTextContent(copy.paymentOpensLater);
    expect(screen.queryByTestId('invite-payment-required')).not.toBeInTheDocument();
    expect(section.textContent).not.toContain(copy.paymentRequired);
  });

  it('a paid offer whose response carries no flag reads the SAFE line ("opens soon")', async () => {
    body = paidData('en', undefined);
    render(<InvitePage />);
    await screen.findByTestId('invite-state-valid');
    expect(screen.getByTestId('invite-payment-opens-later')).toBeInTheDocument();
    expect(screen.queryByTestId('invite-payment-required')).not.toBeInTheDocument();
  });

  it('a free offer has no payment line, whatever the flag says', async () => {
    body = { ...paidData('en', 'required'), offer: { ...paidData('en', 'required').offer, free: true, monthlyPriceUsd: 0 } };
    render(<InvitePage />);
    await screen.findByTestId('invite-state-valid');
    expect(screen.queryByTestId('invite-payment-required')).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-payment-opens-later')).not.toBeInTheDocument();
  });

  it('C-7: no new copy key; the page keys on the server flag, not on who issued the invite', () => {
    const copySource = readFileSync(join(process.cwd(), 'app', 'invite', 'invitePageCopy.ts'), 'utf8');
    expect(copySource).not.toContain('paymentRequiredAtSignup');
    const page = readFileSync(join(process.cwd(), 'app', 'invite', 'page.tsx'), 'utf8');
    expect(page).toContain("data.payment === 'required'");
    expect(page).not.toMatch(/issuer|admin_invite|account_invite/);
  });
});
