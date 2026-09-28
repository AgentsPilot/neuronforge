/**
 * @jest-environment jsdom
 *
 * The lookup, rendered against the bodies the accounts route actually returns
 * (QA-7, the second instance of the same gap).
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * The screen consumes two payloads, and both had the same defect: a component
 * written against a `types.ts` that nothing compared to the server. On this one
 * it cost two High findings at once —
 *
 *   - `basis` was declared `string` and is an OBJECT, so `{payload.basis}`
 *     compiled and then threw `Objects are not valid as a React child` on every
 *     successful lookup;
 *   - the component decided "granted" itself with `value !== false`, reporting
 *     26 of 38 in force where the resolver says 19, beside a plan card on the
 *     same screen saying 19.
 *
 * Neither is visible to a fixture the component's own author wrote.
 *
 * ── The recordings, and what keeps them honest ──────────────────────────────
 * The two JSON files under `__fixtures__/` are not hand-written: they are the
 * **verbatim bodies** the real route produced, for the two account shapes this
 * screen has to be right about —
 *
 *   1. an account on a tier: 19 of 38 in force, `basis` an object;
 *   2. a tenant with **no plan row**: `unknown` state, `none` basis, **0** in
 *      force. The state the screen was most wrong about — it used to list 14,
 *      including a zero seat count and five unavailable add-ons.
 *
 * `routes.test.ts` calls the route and asserts its bodies still deep-equal
 * these files, so a recording cannot drift from the server, and this file
 * renders the component against them, so the component cannot drift from a
 * recording. The two halves meet.
 *
 * Recording rather than running the route in here is deliberate: `next/server`
 * needs `Request`, `ReadableStream`, `MessagePort` and more at import, none of
 * which jsdom has. Polyfilling them made the suite hang.
 *
 * ── Budget (QA NEW-4) ───────────────────────────────────────────────────────
 * The id is pasted rather than typed. 36 awaited keystrokes per test is a lot
 * of event loop for no extra coverage, and it is what made this suite flake
 * under a concurrent typecheck.
 */

import '@testing-library/jest-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import * as fs from 'fs';
import * as path from 'path';

import { isGrantingValue } from '@/lib/business-os/entitlements/schema';
import { CAPABILITIES } from '@/lib/business-os/entitlements/config/catalog';
import type { CapabilityDef, CapabilityValue } from '@/lib/business-os/entitlements/types';

import { AccountLookup } from '../components/AccountLookup';
import type { AccountPayload } from '../types';
import recordedOnATier from './__fixtures__/recordedAccountBody.json';
import recordedNoPlanRow from './__fixtures__/recordedAccountBodyNoPlanRow.json';

jest.setTimeout(20000);

const ACCOUNT = '11111111-1111-4111-8111-111111111111';

/**
 * The recorded bodies, typed as the component's own contract.
 *
 * These assignments are themselves tests, and they are the ones that would have
 * caught the crash at COMPILE time: while `AccountPayload.basis` said `string`,
 * a recording — an object — would not have assigned.
 */
const onATier = recordedOnATier as { success: boolean; data: AccountPayload };
const noPlanRow = recordedNoPlanRow as { success: boolean; data: AccountPayload };

function stubFetch(status: number, payload: unknown) {
  global.fetch = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

async function lookUp(payload: unknown = onATier, status = 200) {
  stubFetch(status, payload);
  render(<AccountLookup />);
  // Pasted, not typed: one event instead of 36 (QA NEW-4).
  fireEvent.change(screen.getByLabelText('Account id'), { target: { value: ACCOUNT } });
  fireEvent.click(screen.getByRole('button', { name: /Look up/ }));
}

describe('an account on a tier', () => {
  it('renders a result at all — the assertion that was missing', async () => {
    await lookUp();
    await waitFor(() => expect(screen.getByTestId('account-result')).toBeInTheDocument());
  });

  it('renders the basis, which is an OBJECT, without throwing', async () => {
    await lookUp();
    await waitFor(() => expect(screen.getByTestId('account-result')).toBeInTheDocument());

    expect(typeof onATier.data.basis).toBe('object');
    const result = screen.getByTestId('account-result');
    expect(result).toHaveTextContent(onATier.data.basis.kind);
    if (onATier.data.basis.tier) expect(result).toHaveTextContent(onATier.data.basis.tier);
  });

  it('counts capabilities in force with the resolver rule, not one of its own', async () => {
    await lookUp();
    await waitFor(() => expect(screen.getByTestId('account-result')).toBeInTheDocument());

    const catalog = CAPABILITIES as unknown as Record<string, CapabilityDef>;
    const expected = Object.entries(onATier.data.capabilities).filter(([capability, resolved]) =>
      isGrantingValue(resolved.value as CapabilityValue, catalog[capability])
    ).length;
    const total = Object.keys(onATier.data.capabilities).length;

    // The numbers QA measured: `value !== false` said 26 of 38 where the
    // resolver says 19 — on the same screen as a card that said 19.
    expect(screen.getByTestId('account-result')).toHaveTextContent(
      `Capabilities in force (${expected} of ${total})`
    );
    expect(expected).toBeLessThan(total);
  });

  it('never lists a withheld quantity or an unavailable add-on as held', async () => {
    await lookUp();
    await waitFor(() => expect(screen.getByTestId('account-result')).toBeInTheDocument());

    const table = within(screen.getByTestId('account-result')).getByRole('table');
    expect(table).not.toHaveTextContent('unavailable');
    expect(table).not.toHaveTextContent('"included":0');
  });

  it('writes values for a human, not JSON (QA-8)', async () => {
    await lookUp();
    await waitFor(() => expect(screen.getByTestId('account-result')).toBeInTheDocument());

    const table = within(screen.getByTestId('account-result')).getByRole('table');
    // The server's own rendering — the plan cards' rendering.
    const [, sample] = Object.entries(onATier.data.capabilities).find(
      ([, resolved]) => resolved.granting && resolved.display !== 'yes'
    )!;
    expect(table).toHaveTextContent(sample.display);
    // And no object literal anywhere in the column.
    expect(table).not.toHaveTextContent('{"');
  });

  it('shows the layer that decided each capability, from the payload', async () => {
    await lookUp();
    await waitFor(() => expect(screen.getByTestId('account-result')).toBeInTheDocument());

    const table = within(screen.getByTestId('account-result')).getByRole('table');
    const [firstGranted] = Object.entries(onATier.data.capabilities).filter(
      ([, resolved]) => resolved.granting
    );

    expect(table).toHaveTextContent(firstGranted[0]);
    expect(table).toHaveTextContent(firstGranted[1].decidedBy);
  });
});

describe('a tenant with no plan row — the state the screen was most wrong about', () => {
  it('reports nothing in force, rather than fourteen things', async () => {
    // The old rule (`value !== false`) listed 14 of 38 here, including
    // `Team seats {"included":0}` and five `'unavailable'` add-ons, for an
    // account with no entitlements at all.
    const inForce = Object.values(noPlanRow.data.capabilities).filter((c) => c.granting).length;
    expect(inForce).toBe(0);

    await lookUp(noPlanRow);
    await waitFor(() => expect(screen.getByTestId('account-result')).toBeInTheDocument());

    expect(screen.getByTestId('account-result')).toHaveTextContent(
      `Capabilities in force (0 of ${Object.keys(noPlanRow.data.capabilities).length})`
    );
  });

  it('says the basis is none and names the anomaly, rather than implying a plan', async () => {
    await lookUp(noPlanRow);
    await waitFor(() => expect(screen.getByTestId('account-result')).toBeInTheDocument());

    const result = screen.getByTestId('account-result');
    expect(result).toHaveTextContent('none');
    expect(result).toHaveTextContent(noPlanRow.data.anomaly ?? 'no_plan_row');
    expect(result).toHaveTextContent(noPlanRow.data.state);
  });
});

describe('every refusal the route can return has copy (QA NEW-3)', () => {
  /**
   * The third uncovered path: the ERROR bodies.
   *
   * `tenant_check_failed` was added to the route in the same round as the
   * payload contract and fell straight through it, so an admin would have seen
   * the raw code. The two lists are pinned to each other here, from the route's
   * own source, so the next one cannot.
   */
  const routeSource = fs.readFileSync(
    path.join(
      process.cwd(),
      'app/api/admin/business-os/entitlements/accounts/[accountId]/route.ts'
    ),
    'utf8'
  );

  /** Every `error: '…'` the GET handler can return. */
  const getHandler = routeSource.slice(
    routeSource.indexOf('export async function GET'),
    routeSource.indexOf('export async function POST')
  );
  // Quote-agnostic (QA): a code written with double quotes or a template
  // literal is the same code, and a scan that missed it would report "no
  // uncovered codes" while one sat on the screen.
  const codes = [
    ...new Set(
      [...getHandler.matchAll(/error:\s*(['"`])([^'"`]+)\1/g)].map((match) => match[2])
    ),
  ];

  it('found the codes to check — a scan that found none would prove nothing', () => {
    expect(codes.length).toBeGreaterThanOrEqual(4);
    expect(codes).toContain('tenant_check_failed');
    expect(codes).toContain('not_a_business_os_account');
  });

  it.each(codes)('%s is shown as a sentence, not as a code', async (code) => {
    await lookUp({ success: false, error: code }, code === 'not_a_business_os_account' ? 404 : 500);

    await waitFor(() => expect(screen.getByTestId('account-error')).toBeInTheDocument());
    const message = screen.getByTestId('account-error').textContent ?? '';

    // The failure mode this catches: the fallback renders `Could not read that
    // account (tenant_check_failed).` — the code, on the screen.
    expect(message).not.toContain(code);
    expect(message.length).toBeGreaterThan(30);
  });
});
