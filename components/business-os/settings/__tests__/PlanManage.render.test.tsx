/**
 * @jest-environment jsdom
 *
 * Settings → Plan: Cancel and Reactivate (plan payments P-7a.1; workplan §2.1,
 * §4.2; SA C-1, C-5).
 *
 * The island renders only what `purchase.manage` says; Cancel asks first and
 * names the plan and the renewal date; both actions post `{}` (C-5) to their
 * route; the route's answer is shown from its own body (a failed re-read never
 * hides it); a refusal reads a dictionary line, never the server's English;
 * an unknown outcome reads "could not confirm" and asks the host to re-read.
 * Hebrew draft keys exist for every English one.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

type Lang = 'en' | 'he' | 'es';
const mockLang: { language: Lang } = { language: 'en' };
jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: mockLang.language,
      timezone: 'UTC',
      isRTL: mockLang.language === 'he',
      t: (key: string) => translations[mockLang.language][key] || key,
    }),
  };
});

import { PlanManage } from '@/components/business-os/settings/PlanManage';
import type { PlanPayload } from '@/components/business-os/settings/planPayloadTypes';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};

const RENEWS = '2099-11-26T10:00:00.000Z';

function plan(manage: { cancel: boolean; reactivate: boolean; paymentFailed: boolean } | undefined, billing: unknown = { state: 'renewing', date: RENEWS }): PlanPayload {
  return {
    status: 'ok',
    kind: 'tier',
    name: 'Essentials',
    purchase: {
      offer: { kind: 'none', reason: 'paying' },
      billing,
      endsFreeAccessOnPurchase: null,
      upgrade: null,
      ...(manage ? { manage } : {}),
    },
  } as unknown as PlanPayload;
}

const fetchMock = jest.fn();
beforeEach(() => {
  mockLang.language = 'en';
  fetchMock.mockReset();
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

function answer(status: number, body: unknown) {
  return { status, json: async () => body };
}

describe('PlanManage', () => {
  it('renders nothing when the server sends no `manage`', () => {
    const { container } = render(<PlanManage plan={plan(undefined)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('Cancel asks first, naming the plan and the date; "Keep my plan" backs out with no request', () => {
    render(<PlanManage plan={plan({ cancel: true, reactivate: false, paymentFailed: false })} />);
    expect(screen.queryByTestId('plan-manage-reactivate')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('plan-manage-cancel'));
    const confirm = screen.getByTestId('plan-manage-confirm');
    expect(confirm).toHaveTextContent('You keep Essentials until November 26, 2099');
    expect(confirm).toHaveTextContent('nothing is refunded');
    fireEvent.click(screen.getByTestId('plan-manage-keep'));
    expect(screen.queryByTestId('plan-manage-confirm')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('confirming posts `{}` to the cancel route and shows the answer, then asks the host to re-read', async () => {
    fetchMock.mockResolvedValue(answer(200, { success: true, data: { outcome: 'cancelled', endsOn: RENEWS } }));
    const onChanged = jest.fn();
    render(<PlanManage plan={plan({ cancel: true, reactivate: false, paymentFailed: false })} onChanged={onChanged} />);
    fireEvent.click(screen.getByTestId('plan-manage-cancel'));
    fireEvent.click(screen.getByTestId('plan-manage-cancel-confirm'));
    await waitFor(() => expect(screen.getByTestId('plan-manage-done')).toHaveTextContent('Cancelled. You keep Essentials until November 26, 2099.'));
    expect(fetchMock).toHaveBeenCalledWith('/api/business-os/billing/plan/cancel', expect.objectContaining({ method: 'POST', body: '{}' }));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('Reactivate posts `{}` at once (it charges nothing) and shows the renewal date', async () => {
    fetchMock.mockResolvedValue(answer(200, { success: true, data: { outcome: 'reactivated', renewsOn: RENEWS } }));
    render(<PlanManage plan={plan({ cancel: false, reactivate: true, paymentFailed: false }, { state: 'ending', date: RENEWS })} />);
    expect(screen.queryByTestId('plan-manage-cancel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('plan-manage-reactivate'));
    await waitFor(() => expect(screen.getByTestId('plan-manage-done')).toHaveTextContent('Your plan will renew on November 26, 2099.'));
    expect(fetchMock).toHaveBeenCalledWith('/api/business-os/billing/plan/reactivate', expect.objectContaining({ body: '{}' }));
  });

  it('SA F-1: `unchanged` shows what Stripe holds from the route answer, then re-reads', async () => {
    fetchMock.mockResolvedValue(answer(200, { success: true, data: { outcome: 'unchanged', state: 'cancelling', date: RENEWS } }));
    const onChanged = jest.fn();
    render(<PlanManage plan={plan({ cancel: true, reactivate: false, paymentFailed: false })} onChanged={onChanged} />);
    fireEvent.click(screen.getByTestId('plan-manage-cancel'));
    fireEvent.click(screen.getByTestId('plan-manage-cancel-confirm'));
    await waitFor(() => expect(screen.getByTestId('plan-manage-done')).toHaveTextContent('Cancelled. You keep Essentials until November 26, 2099.'));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('SA F-1: `unchanged` while renewing reads the renewal date', async () => {
    fetchMock.mockResolvedValue(answer(200, { success: true, data: { outcome: 'unchanged', state: 'renewing', date: RENEWS } }));
    render(<PlanManage plan={plan({ cancel: false, reactivate: true, paymentFailed: false }, { state: 'ending', date: RENEWS })} />);
    fireEvent.click(screen.getByTestId('plan-manage-reactivate'));
    await waitFor(() => expect(screen.getByTestId('plan-manage-done')).toHaveTextContent('Your plan will renew on November 26, 2099.'));
  });

  it('a refusal reads the dictionary line, never the server English', async () => {
    fetchMock.mockResolvedValue(answer(409, { success: false, error: 'SERVER ENGLISH', code: 'upgrade_pending' }));
    render(<PlanManage plan={plan({ cancel: true, reactivate: false, paymentFailed: false })} />);
    fireEvent.click(screen.getByTestId('plan-manage-cancel'));
    fireEvent.click(screen.getByTestId('plan-manage-cancel-confirm'));
    await waitFor(() => expect(screen.getByTestId('plan-manage-refused')).toHaveTextContent(translations.en['plan.manage.refusal.upgrade_pending']));
    expect(screen.queryByText('SERVER ENGLISH')).not.toBeInTheDocument();
  });

  it('an unknown outcome reads "could not confirm" and re-reads (never "nothing changed")', async () => {
    fetchMock.mockResolvedValue(answer(502, { success: false, code: 'stripe_error', outcomeUnknown: true }));
    const onChanged = jest.fn();
    render(<PlanManage plan={plan({ cancel: false, reactivate: true, paymentFailed: false })} onChanged={onChanged} />);
    fireEvent.click(screen.getByTestId('plan-manage-reactivate'));
    await waitFor(() => expect(screen.getByTestId('plan-manage-refused')).toHaveTextContent(translations.en['plan.manage.refusal.unknown']));
    expect(onChanged).toHaveBeenCalled();
  });

  it('a failed renewal shows the contact line and no button (P-7a.4 adds Cancel here)', () => {
    render(<PlanManage plan={plan({ cancel: false, reactivate: false, paymentFailed: true })} />);
    expect(screen.getByTestId('plan-manage-payment-failed')).toHaveTextContent(translations.en['plan.manage.payment_failed_contact']);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('every plan.manage key has a Hebrew and a Spanish draft', () => {
    const keys = Object.keys(translations.en).filter((key) => key.startsWith('plan.manage.'));
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) {
      expect(translations.he[key]).toBeTruthy();
      expect(translations.es[key]).toBeTruthy();
    }
  });
});

describe('PlanManage — the Founding Partner sentence (P-7a.3, BQ-5)', () => {
  const FREE_UNTIL = '2100-03-01T12:00:00.000Z';
  const withFreeAccess = (manage: { cancel: boolean; reactivate: boolean; paymentFailed: boolean }, billing?: unknown) =>
    plan({ ...manage, freeAccessAfter: { endsAt: FREE_UNTIL } } as typeof manage, billing);

  it('in the cancel confirmation, after the "You keep" sentence, with the free-access end date', () => {
    render(<PlanManage plan={withFreeAccess({ cancel: true, reactivate: false, paymentFailed: false })} />);
    expect(screen.queryByTestId('plan-manage-founding')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('plan-manage-cancel'));
    const confirm = screen.getByTestId('plan-manage-confirm');
    expect(confirm).toHaveTextContent('You keep Essentials until November 26, 2099');
    expect(confirm).toHaveTextContent('Then you go back to your Founding Partner free access, which runs until March 1, 2100.');
  });

  it('while the plan is set to end: shown beside Reactivate', () => {
    render(<PlanManage plan={withFreeAccess({ cancel: false, reactivate: true, paymentFailed: false }, { state: 'ending', date: RENEWS })} />);
    expect(screen.getByTestId('plan-manage-founding')).toHaveTextContent('which runs until March 1, 2100');
    expect(screen.getByTestId('plan-manage-reactivate')).toBeInTheDocument();
  });

  it('without the field: no sentence anywhere', () => {
    render(<PlanManage plan={plan({ cancel: true, reactivate: false, paymentFailed: false })} />);
    fireEvent.click(screen.getByTestId('plan-manage-cancel'));
    expect(screen.getByTestId('plan-manage-confirm')).not.toHaveTextContent('Founding Partner');
    expect(screen.queryByTestId('plan-manage-founding')).not.toBeInTheDocument();
  });

  it.each(['he', 'es'] as const)('%s: the drafted sentence renders with its date, no raw key or slot', (lang) => {
    mockLang.language = lang;
    render(<PlanManage plan={withFreeAccess({ cancel: false, reactivate: true, paymentFailed: false }, { state: 'ending', date: RENEWS })} />);
    const line = screen.getByTestId('plan-manage-founding');
    expect(line.textContent).not.toContain('plan.manage.');
    expect(line.textContent).not.toContain('{freeUntil}');
    expect(line.textContent).toContain('2100');
  });
});
