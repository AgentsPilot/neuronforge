/**
 * @jest-environment jsdom
 *
 * The account lookup after Admin Layout Standard L-5 (T-10 to T-12): the read
 * goes through `readAdminResponse`, so no parser or browser message reaches the
 * screen; the Businesses link is a `next/link`; and the snapshot table (shared
 * with the Businesses drawer) is the standard admin table.
 *
 * The happy-path and every-code contract lives in `accountLookup.contract`,
 * unchanged. This file renders against the same recorded body.
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import * as fs from 'fs';
import * as path from 'path';

import { ADMIN_TH } from '@/app/admin/components/layout/adminTable';
import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';

import { AccountLookup } from '../components/AccountLookup';
import { ENTITLEMENT_ERROR_COPY } from '../components/EntitlementSnapshot';
import type { AccountPayload, AccountPlanRow } from '../types';
import recordedOnATier from './__fixtures__/recordedAccountBody.json';

jest.setTimeout(20000);

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const onATier = recordedOnATier as { success: boolean; data: AccountPayload };

type StubResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function lookUpWith(answer: StubResponse | Error) {
  global.fetch = jest.fn(() =>
    answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
  ) as unknown as typeof fetch;
  render(<AccountLookup />);
  // Pasted, not typed (QA NEW-4, as in the contract suite).
  fireEvent.change(screen.getByLabelText('Account id'), { target: { value: ACCOUNT } });
  fireEvent.click(screen.getByRole('button', { name: /Look up/ }));
}

async function errorText(): Promise<string> {
  await waitFor(() => expect(screen.getByTestId('account-error')).toBeInTheDocument());
  return screen.getByTestId('account-error').textContent ?? '';
}

describe('T-10: the lookup never shows a parser or browser message', () => {
  it('a body that is not JSON reads as the fixed sentence', async () => {
    lookUpWith({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    });
    expect(await errorText()).toBe('Could not read that account. Try again in a moment.');
    expect(document.body.textContent).not.toContain('Unexpected token');
  });

  it('a rejected fetch reads as the network sentence', async () => {
    lookUpWith(new TypeError('Failed to fetch'));
    expect(await errorText()).toBe(ADMIN_NETWORK_ERROR);
    expect(document.body.textContent).not.toContain('Failed to fetch');
  });

  it('a 403 from the admin guard says the session ended', async () => {
    lookUpWith({ ok: false, status: 403, json: async () => ({ success: false, error: 'Forbidden' }) });
    expect(await errorText()).toBe('Your admin session has ended. Sign in again.');
  });

  it('a route code is still worded through the copy table after the helper', async () => {
    lookUpWith({
      ok: false,
      status: 404,
      json: async () => ({ success: false, error: 'not_a_business_os_account' }),
    });
    expect(await errorText()).toBe(ENTITLEMENT_ERROR_COPY.not_a_business_os_account);
  });

  it('the error is the shared alert, with no Try again (the form is the retry)', async () => {
    lookUpWith(new TypeError('Failed to fetch'));
    await errorText();
    expect(screen.getByRole('alert')).toContainElement(screen.getByTestId('account-error'));
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});

describe('T-11: the Businesses link navigates client-side', () => {
  it('keeps its words and href', () => {
    render(<AccountLookup />);
    expect(screen.getByRole('link', { name: /Businesses/ })).toHaveAttribute('href', '/admin/users');
  });

  it('is a next/link, with no plain anchor left in the code', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app/admin/business-os-tiers/components/AccountLookup.tsx'),
      'utf8'
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).toMatch(/import Link from ['"]next\/link['"]/);
    expect(code).not.toMatch(/<a\s/);
  });
});

describe('T-12: the snapshot table is the standard admin table', () => {
  it('is named, and every header is a column header with the standard classes', async () => {
    lookUpWith({ ok: true, status: 200, json: async () => onATier });
    await waitFor(() => expect(screen.getByTestId('account-result')).toBeInTheDocument());

    const table = screen.getByRole('table', { name: 'Capabilities in force' });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((th) => th.textContent)).toEqual(['Capability', 'Value', 'Decided by']);
    for (const th of headers) {
      expect(th).toHaveAttribute('scope', 'col');
      expect(th.className).toBe(ADMIN_TH);
    }
  });

  it('prints a set end date in UTC, and a missing one in words', async () => {
    const plan = onATier.data.plan as AccountPlanRow;
    const withEnd = {
      ...onATier,
      data: { ...onATier.data, plan: { ...plan, tier_expires_at: '2026-12-31T23:30:00.000Z', cohort_expires_at: null } },
    };
    lookUpWith({ ok: true, status: 200, json: async () => withEnd });
    await waitFor(() => expect(screen.getByTestId('account-result')).toBeInTheDocument());

    const result = screen.getByTestId('account-result');
    expect(within(result).getByText('2026-12-31 23:30 UTC')).toBeInTheDocument();
    expect(within(result).getAllByText('no end date')).toHaveLength(1);
    expect(result).not.toHaveTextContent('2026-12-31T23:30');
  });
});
