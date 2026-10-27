/**
 * @jest-environment jsdom
 *
 * The plan Cancel drawer (account-deletion lifecycle SX-2 / D3; workplan §2.4,
 * §4, §7; SA Q-2, R-4, R-8, R-11). Real Radix layers throughout, so the
 * nested-drawer rows (Escape closes the top layer only, busy blocks both, focus
 * returns to "Cancel plan", `onChanged` once after close) test what an owner
 * meets, not a stand-in.
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

type Lang = 'en' | 'he' | 'es';
const mockLang: { language: Lang; timezone: string } = { language: 'en', timezone: 'UTC' };
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
  DownloadMyDataButton: (props: { variant: string }) => <button type="button" data-testid="download-my-data" data-variant={props.variant} />,
}));

import { PLAN_LEAVE_REASON_CODES } from '@/lib/business-os/billing/planLeaveReasons';
import { PlanCancelDrawer } from '@/components/business-os/settings/PlanCancelDrawer';
import { PlanManage } from '@/components/business-os/settings/PlanManage';
import { SettingsDrawer } from '@/components/business-os/settings/SettingsDrawer';
import type { PlanEndingWire, PlanPayload } from '@/components/business-os/settings/planPayloadTypes';

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<Lang, Record<string, string>>;
};
const en = translations.en;

const RENEWS = '2099-11-26T10:00:00.000Z';
const FREE_PLAN: PlanEndingWire = {
  kind: 'free_plan',
  endsAt: RENEWS,
  planName: 'Test Flight',
  until: '2099-12-10T10:00:00.000Z',
  credits: 1000,
  loses: ['AI assistant', 'Automations'],
  thenReadOnlyDays: 7,
  thenPausedFrom: '2099-12-17T10:00:00.000Z',
};

function plan(ending: PlanEndingWire | null | undefined, extra: { freeAccessAfter?: { endsAt: string } } = {}): PlanPayload {
  return {
    status: 'ok',
    kind: 'tier',
    name: 'Autopilot',
    ending,
    purchase: {
      offer: { kind: 'none', reason: 'paying' },
      billing: { state: 'renewing', date: RENEWS },
      endsFreeAccessOnPurchase: null,
      upgrade: null,
      manage: { cancel: true, reactivate: false, paymentFailed: false, ...extra },
    },
  } as unknown as PlanPayload;
}

const fetchMock = jest.fn();
beforeEach(() => {
  mockLang.language = 'en';
  mockLang.timezone = 'UTC';
  fetchMock.mockReset();
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});

function Harness({ payload, onFinished = jest.fn(), mode, requestExtra }: { payload: PlanPayload; onFinished?: jest.Mock; mode?: 'period_end' | 'now'; requestExtra?: Record<string, string> }) {
  const [open, setOpen] = useState(true);
  return <PlanCancelDrawer open={open} onOpenChange={setOpen} plan={payload} onFinished={onFinished} mode={mode} requestExtra={requestExtra} />;
}

const next = () => fireEvent.click(screen.getByTestId('plan-cancel-next'));
const pick = (code: string = 'too_expensive') => fireEvent.click(screen.getByTestId(`plan-cancel-reason-${code}`));

describe('step 1: the reason (BQ-7, BQ-17)', () => {
  it('lists the seven codes in planLeaveReasons order, as radios, with their labels; no free text', () => {
    render(<Harness payload={plan(FREE_PLAN)} />);
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((radio) => radio.value)).toEqual([...PLAN_LEAVE_REASON_CODES]);
    for (const code of PLAN_LEAVE_REASON_CODES) expect(screen.getByText(en[`settings.plan_cancel.reason.${code}`])).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('group')).toHaveAccessibleName(en['settings.plan_cancel.reason.heading']);
  });

  it('Next is disabled, and says why, until a reason is picked', () => {
    render(<Harness payload={plan(FREE_PLAN)} />);
    expect(screen.getByTestId('plan-cancel-next')).toBeDisabled();
    expect(screen.getByTestId('plan-cancel-next')).toHaveAccessibleDescription(en['settings.plan_cancel.reason.required']);
    pick('other');
    expect(screen.getByTestId('plan-cancel-next')).toBeEnabled();
    expect(screen.queryByTestId('plan-cancel-reason-required')).not.toBeInTheDocument();
  });
});

describe('the four steps', () => {
  it('in order, with the counter, Back on 2 to 4, and focus on each new heading; the pick survives Back', () => {
    render(<Harness payload={plan(FREE_PLAN)} />);
    const dialog = screen.getByTestId('plan-cancel-drawer');
    expect(dialog).toHaveTextContent('Step 1 of 4');
    pick('switching_tool');
    next();
    expect(screen.getByTestId('plan-cancel-step-2')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Step 2 of 4');
    expect(screen.getByTestId('plan-cancel-heading')).toHaveFocus();
    next();
    expect(screen.getByTestId('plan-cancel-step-3')).toBeInTheDocument();
    expect(screen.getByTestId('plan-cancel-heading')).toHaveFocus();
    next();
    expect(screen.getByTestId('plan-cancel-step-4')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Step 4 of 4');
    for (let i = 0; i < 3; i += 1) fireEvent.click(screen.getByTestId('plan-cancel-back'));
    expect(screen.getByTestId('plan-cancel-step-1')).toBeInTheDocument();
    expect((screen.getByTestId('plan-cancel-reason-switching_tool') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('plan-cancel-heading')).toHaveFocus();
  });
});

describe('step 2: what changes (from `plan.ending`)', () => {
  const toStep2 = (payload: PlanPayload) => {
    render(<Harness payload={payload} />);
    pick();
    next();
    return screen.getByTestId('plan-cancel-step-2');
  };

  it('free_plan: the move with both dates from the view, what is lost, what follows, data kept', () => {
    const step = toStep2(plan(FREE_PLAN));
    expect(screen.getByTestId('plan-cancel-changes-main')).toHaveTextContent('On November 26, 2099 your plan moves to the free plan, Test Flight, with 1,000 credits, until December 10, 2099.');
    expect(within(screen.getByTestId('plan-cancel-loses')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['AI assistant', 'Automations']);
    expect(screen.getByTestId('plan-cancel-then')).toHaveTextContent('After December 10, 2099, your account is read-only for 7 days, then paused');
    expect(step).toHaveTextContent(en['settings.plan_cancel.changes.data_kept']);
    expect(step.textContent).not.toMatch(/\{\w+\}/);
  });

  it.each([
    ['he'],
    ['es'],
  ] as const)('%s: the credit figure in the number format of the locale, no raw slot', (lang) => {
    mockLang.language = lang;
    toStep2(plan({ ...FREE_PLAN, credits: 1000 }));
    const main = screen.getByTestId('plan-cancel-changes-main').textContent ?? '';
    expect(main).toContain((1000).toLocaleString(lang === 'he' ? 'he-IL' : 'es-ES'));
    expect(main).not.toMatch(/\{\w+\}/);
  });

  it('free_plan with no credit total from the server: the sentence without a figure', () => {
    toStep2(plan({ ...FREE_PLAN, credits: null }));
    expect(screen.getByTestId('plan-cancel-changes-main')).toHaveTextContent('On November 26, 2099 your plan moves to the free plan, Test Flight, until December 10, 2099.');
    expect(screen.getByTestId('plan-cancel-changes-main')).not.toHaveTextContent('credits');
  });

  it('free_plan with nothing lost: "You keep everything"', () => {
    toStep2(plan({ ...FREE_PLAN, loses: [] }));
    expect(screen.getByTestId('plan-cancel-keep-everything')).toHaveTextContent(en['settings.plan_cancel.changes.keep_everything']);
  });

  it('back_to_plan (not the BQ-5 case): dated and open-ended', () => {
    const { unmount } = render(<Harness payload={plan({ kind: 'back_to_plan', endsAt: RENEWS, planName: 'Test Flight', until: '2099-12-01T00:00:00.000Z', loses: [] })} />);
    pick();
    next();
    expect(screen.getByTestId('plan-cancel-changes-main')).toHaveTextContent('On November 26, 2099 you go back to Test Flight, free, until December 1, 2099.');
    unmount();
    toStep2(plan({ kind: 'back_to_plan', endsAt: RENEWS, planName: 'Test Flight', until: null, loses: [] }));
    expect(screen.getByTestId('plan-cancel-changes-main')).toHaveTextContent('On November 26, 2099 you go back to Test Flight, free.');
  });

  it.each([null, undefined, { kind: 'unknown', endsAt: RENEWS } as PlanEndingWire])('ending %p: the honest "could not work out" line', (ending) => {
    const step = toStep2(plan(ending));
    expect(screen.getByTestId('plan-cancel-changes-main')).toHaveTextContent(en['settings.plan_cancel.changes.unknown']);
    // The unknown line already says the data is kept; it is not said twice.
    expect((step.textContent ?? '').split(en['settings.plan_cancel.changes.data_kept']).length - 1).toBe(1);
  });

  it('R-4c: a Founding Partner reads P-7a.3\'s own sentence, not a D3 one', () => {
    toStep2(plan({ kind: 'back_to_plan', endsAt: RENEWS, planName: 'Founding Partner', until: '2100-03-01T12:00:00.000Z', loses: [] }, { freeAccessAfter: { endsAt: '2100-03-01T12:00:00.000Z' } }));
    expect(screen.getByTestId('plan-cancel-changes-main')).toHaveTextContent('Then you go back to your Founding Partner free access, which runs until March 1, 2100.');
    expect(screen.getByTestId('plan-cancel-keep-everything')).toBeInTheDocument();
  });

  it('R-4d: ending missing but `manage.freeAccessAfter` present: the BQ-5 line still shows', () => {
    const step = toStep2(plan(null, { freeAccessAfter: { endsAt: '2100-03-01T12:00:00.000Z' } }));
    expect(screen.getByTestId('plan-cancel-changes-main')).toHaveTextContent('Founding Partner free access, which runs until March 1, 2100');
    expect(step).not.toHaveTextContent(en['settings.plan_cancel.changes.unknown']);
  });
});

describe('step 3: review (AC-D3.3, R-8)', () => {
  it('the last day on the OWNER\'s clock, no charge, no refund, and the frozen export entry', () => {
    mockLang.timezone = 'Asia/Jerusalem';
    render(<Harness payload={plan(FREE_PLAN, {})} />);
    pick();
    next();
    next();
    // 2099-11-26T23:30Z is the 27th in Jerusalem; RENEWS (10:00Z) is the 26th either way.
    expect(screen.getByTestId('plan-cancel-last-day')).toHaveTextContent('Last day of your plan: November 26, 2099');
    const step = screen.getByTestId('plan-cancel-step-3');
    expect(step).toHaveTextContent(en['settings.plan_cancel.review.no_charge']);
    expect(step).toHaveTextContent(en['settings.plan_cancel.review.no_refund']);
    expect(screen.getByTestId('download-my-data')).toHaveAttribute('data-variant', 'button');
  });

  it('a late-UTC period end is the next day in Jerusalem', () => {
    mockLang.timezone = 'Asia/Jerusalem';
    const late = plan(FREE_PLAN);
    (late.purchase as unknown as { billing: { date: string } }).billing.date = '2099-11-26T23:30:00.000Z';
    render(<Harness payload={late} />);
    pick();
    next();
    next();
    expect(screen.getByTestId('plan-cancel-last-day')).toHaveTextContent('November 27, 2099');
  });
});

describe('step 4: confirm (AC-D3.4)', () => {
  const toConfirm = (payload: PlanPayload, onFinished = jest.fn(), reason = 'business_closing') => {
    render(<Harness payload={payload} onFinished={onFinished} />);
    pick(reason);
    next();
    next();
    next();
    return onFinished;
  };

  it('names the plan; R-4c appends the Founding Partner sentence to the confirm body', () => {
    toConfirm(plan(null, { freeAccessAfter: { endsAt: '2100-03-01T12:00:00.000Z' } }));
    expect(screen.getByTestId('plan-cancel-heading')).toHaveTextContent('Cancel Autopilot?');
    const body = screen.getByTestId('plan-cancel-confirm-body');
    expect(body.textContent).toContain('You can keep it any time before November 26, 2099.');
    expect(body.textContent).toContain('Then you go back to your Founding Partner free access');
  });

  it('posts exactly `{"reasonCode":<picked>}` to the cancel route, once, and hands the answer back', async () => {
    const answer = { success: true, data: { outcome: 'cancelled', endsOn: RENEWS } };
    fetchMock.mockResolvedValue({ status: 200, json: async () => answer });
    const onFinished = toConfirm(plan(FREE_PLAN));
    fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/business-os/billing/plan/cancel', expect.objectContaining({ method: 'POST', body: '{"reasonCode":"business_closing"}' }));
    expect(onFinished).toHaveBeenCalledWith({ status: 200, body: answer });
  });

  it('a request that throws hands back `null` (the card then says "could not confirm")', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const onFinished = toConfirm(plan(FREE_PLAN));
    fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
    await waitFor(() => expect(onFinished).toHaveBeenCalledWith(null));
  });

  it('"Don\'t cancel" closes with no request', async () => {
    toConfirm(plan(FREE_PLAN));
    fireEvent.click(screen.getByTestId('plan-cancel-dismiss'));
    await waitFor(() => expect(screen.queryByTestId('plan-cancel-drawer')).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('busy: the drawer refuses Escape and its X, and every button is disabled', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    toConfirm(plan(FREE_PLAN));
    fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
    expect(screen.getByTestId('plan-cancel-busy')).toHaveTextContent(en['plan.manage.cancelling']);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.getByTestId('plan-cancel-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('plan-cancel-drawer').querySelector(`button[aria-label="${en['settings.plan_cancel.close']}"]`)).toBeDisabled();
    for (const id of ['plan-cancel-confirm', 'plan-cancel-dismiss', 'plan-cancel-back']) expect(screen.getByTestId(id)).toBeDisabled();
  });
});

describe('mode: the P-7a.4 seam (TL 2026-10-27)', () => {
  it('`now` reads "ends today" in review and confirm, and posts the extra fields with the reason code last', async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ success: true, data: { outcome: 'cancelled' } }) });
    render(<Harness payload={plan(FREE_PLAN, { freeAccessAfter: { endsAt: '2100-03-01T12:00:00.000Z' } })} mode="now" requestExtra={{ when: 'now', reasonCode: 'spoofed' }} />);
    pick('other');
    next();
    next();
    expect(screen.getByTestId('plan-cancel-last-day')).toHaveTextContent(en['settings.plan_cancel.review.ends_now']);
    next();
    const body = screen.getByTestId('plan-cancel-confirm-body');
    expect(body).toHaveTextContent(en['settings.plan_cancel.confirm.body_now']);
    expect(body).toHaveTextContent('Founding Partner free access');
    fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body)).toEqual({ when: 'now', reasonCode: 'other' });
  });
});

describe('a drawer opened from a drawer (SA Q-2), through PlanManage', () => {
  function Host({ onParentChange, onChanged }: { onParentChange: jest.Mock; onChanged: jest.Mock }) {
    return (
      <SettingsDrawer open onOpenChange={onParentChange} title="Plan" isRTL={mockLang.language === 'he'} closeLabel="Close plan">
        <PlanManage plan={plan(FREE_PLAN)} onChanged={onChanged} />
      </SettingsDrawer>
    );
  }

  it('Escape closes the TOP layer only; focus returns to "Cancel plan"', async () => {
    const onParentChange = jest.fn();
    render(<Host onParentChange={onParentChange} onChanged={jest.fn()} />);
    fireEvent.click(screen.getByTestId('plan-manage-cancel'));
    expect(screen.getByTestId('plan-cancel-drawer')).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('plan-cancel-drawer')).not.toBeInTheDocument());
    expect(onParentChange).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('plan-manage-cancel')).toHaveFocus());
  });

  it('while the request is in flight neither layer closes; after the answer the child closes, the card shows it, onChanged runs once', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise((r) => (resolve = r)));
    const onParentChange = jest.fn();
    const onChanged = jest.fn();
    render(<Host onParentChange={onParentChange} onChanged={onChanged} />);
    fireEvent.click(screen.getByTestId('plan-manage-cancel'));
    pick();
    next();
    next();
    next();
    fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getByTestId('plan-cancel-drawer')).toBeInTheDocument();
    expect(onParentChange).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();

    await act(async () => {
      resolve({ status: 200, json: async () => ({ success: true, data: { outcome: 'cancelled', endsOn: RENEWS } }) });
    });
    await waitFor(() => expect(screen.queryByTestId('plan-cancel-drawer')).not.toBeInTheDocument());
    expect(screen.getByTestId('plan-manage-done')).toHaveTextContent('Cancelled. You keep Autopilot until November 26, 2099.');
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onParentChange).not.toHaveBeenCalled();
  });
});

describe('focus after a successful cancel (SA D3 finding 2, QA 8)', () => {
  function ReReadingHost() {
    // The host's re-read: after `onChanged`, the server says "set to end", so "Cancel plan" is gone.
    const [payload, setPayload] = useState<PlanPayload>(plan(FREE_PLAN));
    const ended = () => {
      const next = plan(null);
      (next.purchase as unknown as { billing: unknown }).billing = { state: 'ending', date: RENEWS };
      (next.purchase as unknown as { manage: unknown }).manage = { cancel: false, reactivate: true, paymentFailed: false };
      setPayload(next);
    };
    return (
      <SettingsDrawer open onOpenChange={() => undefined} title="Plan" isRTL={false} closeLabel="Close plan">
        <PlanManage plan={payload} onChanged={ended} />
      </SettingsDrawer>
    );
  }

  it('lands on the outcome line, never on <body>, once the re-read has removed "Cancel plan"', async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ success: true, data: { outcome: 'cancelled', endsOn: RENEWS } }) });
    render(<ReReadingHost />);
    fireEvent.click(screen.getByTestId('plan-manage-cancel'));
    pick();
    next();
    next();
    next();
    fireEvent.click(screen.getByTestId('plan-cancel-confirm'));
    await waitFor(() => expect(screen.queryByTestId('plan-cancel-drawer')).not.toBeInTheDocument());
    expect(screen.queryByTestId('plan-manage-cancel')).not.toBeInTheDocument();
    expect(screen.getByTestId('plan-manage-reactivate')).toHaveTextContent('Keep my plan');
    await waitFor(() => expect(screen.getByTestId('plan-manage-done')).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe('RTL and 320 px', () => {
  it('he: the drawer opens from the left, dir=rtl, every line translated, buttons wrap, no physical-direction class in the steps', () => {
    mockLang.language = 'he';
    render(<Harness payload={plan(FREE_PLAN)} />);
    const drawer = screen.getByTestId('plan-cancel-drawer');
    expect(drawer).toHaveAttribute('dir', 'rtl');
    expect(drawer).toHaveAttribute('data-side', 'left');
    const PHYSICAL = /(^|\s)(-?m[lr]-|p[lr]-|left-|right-|text-left|text-right|rounded-[lr]-|border-[lr](-|\s|$))/;
    pick();
    for (let step = 1; step <= 4; step += 1) {
      const body = screen.getByTestId(`plan-cancel-step-${step}`);
      expect(body.textContent).not.toMatch(/settings\.plan_cancel\.|\{\w+\}/);
      expect(body.querySelector('.flex-wrap')).not.toBeNull();
      for (const el of Array.from(body.querySelectorAll('*'))) expect((el as HTMLElement).className?.toString() ?? '').not.toMatch(PHYSICAL);
      if (step < 4) next();
    }
  });
});
