/**
 * @jest-environment jsdom
 *
 * QA rows for the plan Cancel drawer (D3 / SX-2), the gaps left by
 * PlanCancelDrawer.render.test.tsx: no billing date (body_nodate), a champion
 * never reading "moves to Test Flight", a refusal through the drawer never
 * reading as success, Escape before confirm, and a reopen starting clean.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';

const mockLang = { language: 'en' as 'en' | 'he' | 'es', timezone: 'UTC' };
jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  const value = () => ({
    language: mockLang.language,
    timezone: mockLang.timezone,
    isRTL: mockLang.language === 'he',
    t: (key: string) => translations[mockLang.language][key] || key,
  });
  return { useLanguage: value, useOptionalLanguage: value };
});
jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: () => <button type="button" data-testid="download-my-data" />,
}));

import { PlanCancelDrawer } from '@/components/business-os/settings/PlanCancelDrawer';
import { PlanManage } from '@/components/business-os/settings/PlanManage';
import type { PlanEndingWire, PlanPayload } from '@/components/business-os/settings/planPayloadTypes';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<string, Record<string, string>>;
};
const en = translations.en;
const RENEWS = '2099-11-26T10:00:00.000Z';

function plan(opts: { ending?: PlanEndingWire | null; billing?: unknown; freeAccessAfter?: { endsAt: string } }): PlanPayload {
  return {
    status: 'ok',
    kind: 'tier',
    name: 'Autopilot',
    ending: opts.ending ?? null,
    purchase: {
      offer: { kind: 'none', reason: 'paying' },
      billing: 'billing' in opts ? opts.billing : { state: 'renewing', date: RENEWS },
      endsFreeAccessOnPurchase: null,
      upgrade: null,
      manage: { cancel: true, reactivate: false, paymentFailed: false, ...(opts.freeAccessAfter ? { freeAccessAfter: opts.freeAccessAfter } : {}) },
    },
  } as unknown as PlanPayload;
}

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

function Harness({ payload, onFinished = jest.fn() }: { payload: PlanPayload; onFinished?: jest.Mock }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" data-testid="reopen" onClick={() => setOpen(true)} />
      <PlanCancelDrawer open={open} onOpenChange={setOpen} plan={payload} onFinished={onFinished} />
    </>
  );
}

const next = () => fireEvent.click(screen.getByTestId('plan-cancel-next'));
const toStep = (n: number) => {
  fireEvent.click(screen.getByTestId('plan-cancel-reason-other'));
  for (let i = 1; i < n; i += 1) next();
};

describe('QA: no billing date', () => {
  it('review reads last_day_nodate and confirm reads body_nodate (no "before ." sentence)', () => {
    render(<Harness payload={plan({ billing: null })} />);
    toStep(3);
    expect(screen.getByTestId('plan-cancel-last-day')).toHaveTextContent(en['settings.plan_cancel.review.last_day_nodate']);
    next();
    const body = screen.getByTestId('plan-cancel-confirm-body');
    expect(body).toHaveTextContent(en['settings.plan_cancel.confirm.body_nodate']);
    expect(body.textContent).not.toMatch(/\{|\s\./);
  });
});

describe('QA: a champion never reads "moves to Test Flight"', () => {
  const FREE_PLAN: PlanEndingWire = {
    kind: 'free_plan',
    endsAt: RENEWS,
    planName: 'Test Flight',
    until: '2099-12-10T10:00:00.000Z',
    loses: ['AI assistant'],
    thenReadOnlyDays: 7,
    thenPausedFrom: '2099-12-17T10:00:00.000Z',
  } as PlanEndingWire;

  it('with freeAccessAfter set, even a stray free_plan ending shows only the Founding Partner line', () => {
    render(<Harness payload={plan({ ending: FREE_PLAN, freeAccessAfter: { endsAt: '2100-03-01T00:00:00.000Z' } })} />);
    toStep(2);
    const step = screen.getByTestId('plan-cancel-step-2');
    expect(step.textContent).not.toMatch(/moves to the free plan/i);
    expect(screen.queryByTestId('plan-cancel-then')).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-cancel-changes-main')).toHaveTextContent(/2100/);
  });

  it('a null ending with freeAccessAfter set: the Founding Partner line in step 2 and step 4', () => {
    render(<Harness payload={plan({ ending: null, freeAccessAfter: { endsAt: '2100-03-01T00:00:00.000Z' } })} />);
    toStep(2);
    expect(screen.getByTestId('plan-cancel-changes-main')).not.toHaveTextContent(en['settings.plan_cancel.changes.unknown']);
    expect(screen.getByTestId('plan-cancel-changes-main')).toHaveTextContent(/2100/);
    next();
    next();
    expect(screen.getByTestId('plan-cancel-confirm-body')).toHaveTextContent(/2100/);
  });

  it('a null ending and no freeAccessAfter: the honest unknown line', () => {
    render(<Harness payload={plan({ ending: null })} />);
    toStep(2);
    expect(screen.getByTestId('plan-cancel-changes-main')).toHaveTextContent(en['settings.plan_cancel.changes.unknown']);
  });
});

describe('QA: Escape and reopen', () => {
  it('Escape on step 3 closes with no request; reopening starts at step 1 with nothing picked', () => {
    render(<Harness payload={plan({})} />);
    toStep(3);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByTestId('plan-cancel-drawer')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('reopen'));
    expect(screen.getByTestId('plan-cancel-step-1')).toBeInTheDocument();
    expect(screen.getByTestId('plan-cancel-next')).toBeDisabled();
    expect(screen.getAllByRole('radio').every((r) => !(r as HTMLInputElement).checked)).toBe(true);
  });
});

describe('QA: a refusal through the drawer is never success', () => {
  it.each([
    [400, { success: false, code: 'invalid_request' }],
    [409, { success: false, code: 'upgrade_pending' }],
    [500, { success: false }],
  ])('HTTP %s: the drawer closes, the card shows the refusal, no done line, Cancel stays', async (status, body) => {
    fetchMock.mockResolvedValue({ status, json: async () => body });
    render(<PlanManage plan={plan({})} />);
    fireEvent.click(screen.getByTestId('plan-manage-cancel'));
    toStep(4);
    fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
    await waitFor(() => expect(screen.getByTestId('plan-manage-refused')).toBeInTheDocument());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ reasonCode: 'other' });
    expect(screen.queryByTestId('plan-manage-done')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plan-cancel-drawer')).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-manage-cancel')).toBeInTheDocument();
  });

  it('a non-JSON 502 reads a refusal, not success', async () => {
    fetchMock.mockResolvedValue({ status: 502, json: async () => { throw new Error('not json'); } });
    render(<PlanManage plan={plan({})} />);
    fireEvent.click(screen.getByTestId('plan-manage-cancel'));
    toStep(4);
    fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
    await waitFor(() => expect(screen.getByTestId('plan-manage-refused')).toBeInTheDocument());
    expect(screen.queryByTestId('plan-manage-done')).not.toBeInTheDocument();
  });
});
