/**
 * @jest-environment jsdom
 *
 * Settings → Plan: Cancel and Reactivate (plan payments P-7a.1; workplan §2.1,
 * §4.2; SA C-1, C-5).
 *
 * The island renders only what `purchase.manage` says; Cancel opens the
 * Cancel drawer (D3 / SX-2), whose confirm step names the plan and the
 * renewal date and posts `{ reasonCode }`; "Keep my plan" (reactivate) posts
 * `{}` (C-5); the route's answer is shown from its own body (a failed re-read
 * never hides it); a refusal reads a dictionary line, never the server's
 * English; an unknown outcome reads "could not confirm" and asks the host to
 * re-read. Hebrew draft keys exist for every English one.
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

jest.mock('@/components/business-os/data-export/DownloadMyDataButton', () => ({
  DownloadMyDataButton: () => <div data-testid="download-my-data" />,
}));

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

/** D3: Cancel opens the Cancel drawer; walk it to the confirm step (reason → changes → review → confirm). */
function walkToConfirm(reason = 'too_expensive') {
  fireEvent.click(screen.getByTestId('plan-manage-cancel'));
  fireEvent.click(screen.getByTestId(`plan-cancel-reason-${reason}`));
  for (let step = 1; step < 4; step += 1) fireEvent.click(screen.getByTestId('plan-cancel-next'));
}

describe('PlanManage', () => {
  it('renders nothing when the server sends no `manage`', () => {
    const { container } = render(<PlanManage plan={plan(undefined)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('Cancel opens the drawer; its confirm names the plan and the date; "Don\'t cancel" backs out with no request', async () => {
    render(<PlanManage plan={plan({ cancel: true, reactivate: false, paymentFailed: false })} />);
    expect(screen.queryByTestId('plan-manage-reactivate')).not.toBeInTheDocument();
    walkToConfirm();
    expect(screen.getByTestId('plan-cancel-heading')).toHaveTextContent('Cancel Essentials?');
    expect(screen.getByTestId('plan-cancel-confirm-body')).toHaveTextContent('You can keep it any time before November 26, 2099.');
    fireEvent.click(screen.getByTestId('plan-cancel-dismiss'));
    await waitFor(() => expect(screen.queryByTestId('plan-cancel-drawer')).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('confirming posts `{ reasonCode }` to the cancel route and shows the answer, then asks the host to re-read once', async () => {
    fetchMock.mockResolvedValue(answer(200, { success: true, data: { outcome: 'cancelled', endsOn: RENEWS } }));
    const onChanged = jest.fn();
    render(<PlanManage plan={plan({ cancel: true, reactivate: false, paymentFailed: false })} onChanged={onChanged} />);
    walkToConfirm('missing_feature');
    fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
    await waitFor(() => expect(screen.getByTestId('plan-manage-done')).toHaveTextContent('Cancelled. You keep Essentials until November 26, 2099.'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/business-os/billing/plan/cancel',
      expect.objectContaining({ method: 'POST', body: '{"reasonCode":"missing_feature"}' })
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('plan-cancel-drawer')).not.toBeInTheDocument());
  });

  it('"Keep my plan" (reactivate) posts `{}` at once (it charges nothing) and shows the renewal date', async () => {
    fetchMock.mockResolvedValue(answer(200, { success: true, data: { outcome: 'reactivated', renewsOn: RENEWS } }));
    render(<PlanManage plan={plan({ cancel: false, reactivate: true, paymentFailed: false }, { state: 'ending', date: RENEWS })} />);
    expect(screen.queryByTestId('plan-manage-cancel')).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-manage-reactivate')).toHaveTextContent('Keep my plan');
    fireEvent.click(screen.getByTestId('plan-manage-reactivate'));
    await waitFor(() => expect(screen.getByTestId('plan-manage-done')).toHaveTextContent('Your plan will renew on November 26, 2099.'));
    expect(fetchMock).toHaveBeenCalledWith('/api/business-os/billing/plan/reactivate', expect.objectContaining({ body: '{}' }));
  });

  it('SA F-1: `unchanged` shows what Stripe holds from the route answer, then re-reads', async () => {
    fetchMock.mockResolvedValue(answer(200, { success: true, data: { outcome: 'unchanged', state: 'cancelling', date: RENEWS } }));
    const onChanged = jest.fn();
    render(<PlanManage plan={plan({ cancel: true, reactivate: false, paymentFailed: false })} onChanged={onChanged} />);
    walkToConfirm();
    fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
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
    walkToConfirm();
    fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
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

  it('in the Cancel drawer\'s confirm step (SA R-4c), after the confirm sentence, with the free-access end date', () => {
    render(<PlanManage plan={withFreeAccess({ cancel: true, reactivate: false, paymentFailed: false })} />);
    expect(screen.queryByTestId('plan-manage-founding')).not.toBeInTheDocument();
    walkToConfirm();
    const confirm = screen.getByTestId('plan-cancel-confirm-body');
    expect(confirm).toHaveTextContent('You can keep it any time before November 26, 2099.');
    expect(confirm).toHaveTextContent('Then you go back to your Founding Partner free access, which runs until March 1, 2100.');
  });

  it('while the plan is set to end: shown beside "Keep my plan" (SA R-4e)', () => {
    render(<PlanManage plan={withFreeAccess({ cancel: false, reactivate: true, paymentFailed: false }, { state: 'ending', date: RENEWS })} />);
    expect(screen.getByTestId('plan-manage-founding')).toHaveTextContent('which runs until March 1, 2100');
    expect(screen.getByTestId('plan-manage-reactivate')).toBeInTheDocument();
  });

  it('without the field: no sentence anywhere', () => {
    render(<PlanManage plan={plan({ cancel: true, reactivate: false, paymentFailed: false })} />);
    walkToConfirm();
    expect(screen.getByTestId('plan-cancel-confirm-body')).not.toHaveTextContent('Founding Partner');
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
