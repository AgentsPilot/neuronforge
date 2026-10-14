/**
 * @jest-environment jsdom
 *
 * The manual-entry form (AI model price review slice 4; MP-FR-12 fallback;
 * SA O-6, RC-1, RC-7). Workplan cases M-1 to M-7.
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

jest.mock('@/lib/logger/client', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { clientLogger: logger };
});

import { ManualPriceEntryForm, type ManualEntryPrefill } from '../components/ManualPriceEntryForm';
import ModelPricingPage from '../page';
import { COMPARISON_URL, MANUAL_URL, PRICING_URL, okComparison } from '../__fixtures__/priceComparison';

const OFFICIAL = 'https://developers.openai.com/api/docs/pricing';

type Reply = { status: number; body?: unknown; notJson?: boolean } | 'reject';

function stubPost(reply: Reply) {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
    if (reply === 'reject') throw new TypeError('Failed to fetch');
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => {
        if (reply.notJson) throw new SyntaxError('Unexpected token <');
        return reply.body;
      },
    };
  }) as unknown as typeof fetch;
  return calls;
}

const okSave = (flags: string[] = [], supersededLineId: string | null = null): Reply => ({
  status: 200,
  body: { success: true, data: { proposalId: 'p-1', lines: [{ id: 'l-1', provider: 'openai', modelName: 'gpt-4o-mini', kind: 'token', flags, supersededLineId }] } },
});

function renderForm(prefill: ManualEntryPrefill = { kind: 'token', provider: 'openai', modelName: 'gpt-4o-mini' }) {
  const onSaved = jest.fn();
  render(<ManualPriceEntryForm prefill={prefill} onSaved={onSaved} onClose={jest.fn()} />);
  return { onSaved, form: screen.getByRole('form', { name: 'Enter a provider price' }) };
}

async function fillToken(form: HTMLElement, values: { input?: string; output?: string; cached?: string; source?: string }) {
  const type = async (label: string, value: string | undefined) => {
    if (value === undefined) return;
    // fireEvent, not userEvent.type: the same change event, without typing key by key (no added CI time).
    fireEvent.change(within(form).getByLabelText(label), { target: { value } });
  };
  await type('Input per 1M', values.input);
  await type('Output per 1M', values.output);
  await type('Cached input per 1M (optional)', values.cached);
  await type('Official source URL', values.source);
}

// fireEvent: the same submit click, without userEvent's pointer checks (keeps each case under 2 s).
const save = async (form: HTMLElement) => {
  fireEvent.click(within(form).getByRole('button', { name: 'Save as pending' }));
};

describe('manual entry', () => {
  it.each([
    ['a price that is not a decimal', { input: '0,15' }, 'Input per 1M'],
    ['ten decimals', { input: '0.1234567891' }, 'Input per 1M'],
    ['an unlisted host', { source: 'https://example.com/pricing' }, 'Official source URL'],
    ['http', { source: 'http://developers.openai.com/api/docs/pricing' }, 'Official source URL'],
  ])('M-1: %s is refused in the browser, marked invalid, and nothing is posted', async (_label, override, field) => {
    const calls = stubPost(okSave());
    const { form } = renderForm();
    await fillToken(form, { input: '0.15', output: '0.6', source: OFFICIAL, ...override });
    await save(form);
    expect(within(form).getByLabelText(field)).toHaveAttribute('aria-invalid', 'true');
    const describedBy = within(form).getByLabelText(field).getAttribute('aria-describedby');
    expect(describedBy && document.getElementById(describedBy)?.textContent).toBeTruthy();
    // SA F-2: the browser refusal is announced, with the field named.
    const alert = within(form).getByRole('alert');
    expect(alert).toHaveTextContent('Check the fields marked below.');
    expect(alert).toHaveTextContent(`${field}:`);
    expect(calls).toHaveLength(0);
  });

  it('M-1b: a missing provider is refused', async () => {
    const calls = stubPost(okSave());
    const { form } = renderForm({ kind: 'token', provider: null, modelName: 'x-model' });
    await fillToken(form, { input: '1', output: '2', source: OFFICIAL });
    await save(form);
    expect(within(form).getByLabelText('Provider')).toHaveAttribute('aria-invalid', 'true');
    expect(within(form).getByRole('alert')).toHaveTextContent('Provider: Choose a provider');
    expect(calls).toHaveLength(0);
  });

  it('the status region is mounted and empty before any save (QA edge case 2)', () => {
    renderForm();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('M-2: a good token line posts exactly the typed strings; a blank cached price is left out', async () => {
    const calls = stubPost(okSave());
    const { form } = renderForm();
    await fillToken(form, { input: ' 0.075 ', output: '0.3', source: OFFICIAL });
    await save(form);
    await screen.findByText('Saved as a pending price. No charge changes until it is applied.');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(MANUAL_URL);
    expect(calls[0].method).toBe('POST');
    const body = JSON.parse(calls[0].body ?? '{}');
    expect(body).toEqual({
      lines: [
        {
          kind: 'token',
          provider: 'openai',
          model_name: 'gpt-4o-mini',
          input_per_1m: '0.075',
          output_per_1m: '0.3',
          source_url: OFFICIAL,
          checked_on: expect.stringMatching(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
        },
      ],
    });
  });

  it('M-3: an image line has size, quality and per-image price', async () => {
    const calls = stubPost(okSave());
    const { form } = renderForm({ kind: 'image', provider: 'openai', modelName: 'gpt-image-x' });
    fireEvent.change(within(form).getByLabelText('Image size'), { target: { value: '1024x1024' } });
    fireEvent.change(within(form).getByLabelText('Quality'), { target: { value: 'high' } });
    fireEvent.change(within(form).getByLabelText('Price per image'), { target: { value: '0.04' } });
    fireEvent.change(within(form).getByLabelText('Official source URL'), { target: { value: OFFICIAL } });
    await save(form);
    await screen.findByText('Saved as a pending price. No charge changes until it is applied.');
    const line = JSON.parse(calls[0].body ?? '{}').lines[0];
    expect(line).toMatchObject({ kind: 'image', image_size: '1024x1024', image_quality: 'high', price_per_image: '0.04' });
    expect(line).not.toHaveProperty('input_per_1m');
  });

  it.each([
    [
      '400',
      { status: 400, body: { success: false, error: 'Some prices could not be read. Check each line.', problems: [{ path: 'lines.0.source_url', message: 'Paste the full https address with no spaces' }] } },
      ['Some prices could not be read. Check each line.', 'Official source URL: Paste the full https address with no spaces'],
    ],
    [
      '422',
      { status: 422, body: { success: false, error: 'Nothing was stored. Fix the lines below and submit again.', problems: [{ path: 'lines.0', message: 'input is above the ceiling of 1000 per 1M' }] } },
      ['Nothing was stored. Fix the lines below and submit again.', 'This price: input is above the ceiling of 1000 per 1M'],
    ],
  ])('M-4: a %s shows the route error and each problem with its field name', async (_label, reply, texts) => {
    stubPost(reply as Reply);
    const { form } = renderForm();
    await fillToken(form, { input: '2000', output: '1', source: OFFICIAL });
    await save(form);
    const alert = await screen.findByRole('alert');
    for (const text of texts) expect(alert).toHaveTextContent(text);
    // Typed values stay after a refusal (M-7).
    expect(within(form).getByLabelText('Input per 1M')).toHaveValue('2000');
  });

  it('M-4b: a 400 problem marks its field invalid', async () => {
    stubPost({ status: 400, body: { success: false, error: 'x', problems: [{ path: 'lines.0.source_url', message: 'bad url' }] } });
    const { form } = renderForm();
    await fillToken(form, { input: '1', output: '1', source: OFFICIAL });
    await save(form);
    await screen.findByRole('alert');
    expect(within(form).getByLabelText('Official source URL')).toHaveAttribute('aria-invalid', 'true');
  });

  it.each([
    ['409', { status: 409, body: { success: false, error: 'Another price for the same model was saved at the same moment. Reload and try again.' } } as Reply, 'Another price for the same model was saved at the same moment. Reload and try again.'],
    ['403', { status: 403, body: { success: false, error: 'Your admin access is not recorded in the admin list, so prices cannot be saved.' } } as Reply, 'Your admin access is not recorded in the admin list, so prices cannot be saved.'],
    ['a non-JSON body', { status: 502, notJson: true } as Reply, 'Could not save the price. Try again in a moment.'],
    ['a rejected fetch', 'reject' as Reply, 'Could not reach the server. Check your connection and try again.'],
  ])('M-5: %s shows its words', async (_label, reply, text) => {
    stubPost(reply);
    const { form, onSaved } = renderForm();
    await fillToken(form, { input: '1', output: '1', source: OFFICIAL });
    await save(form);
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('M-6: success shows the status line and the flags in words, clears the prices, and tells the page', async () => {
    stubPost(okSave(['new_model', 'large_move'], 'old-line'));
    const { form, onSaved } = renderForm();
    await fillToken(form, { input: '1', output: '1', source: OFFICIAL });
    await save(form);
    await screen.findByText('Saved as a pending price. No charge changes until it is applied.');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Saved as a pending price. No charge changes until it is applied.');
    expect(status).toHaveTextContent('It replaced an earlier pending price for the same model.');
    expect(within(status).getByText('not used yet')).toBeInTheDocument();
    expect(within(status).getByText('price moves more than 50% (needs a reason to apply)')).toBeInTheDocument();
    expect(within(form).getByLabelText('Input per 1M')).toHaveValue('');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('M-7: save is disabled while saving (no double post)', async () => {
    let release: () => void = () => undefined;
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, status: 200, json: async () => (okSave() as { body: unknown }).body });
        })
    ) as unknown as typeof fetch;
    const { form } = renderForm();
    await fillToken(form, { input: '1', output: '1', source: OFFICIAL });
    await save(form);
    expect(within(form).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    release();
    await screen.findByText('Saved as a pending price. No charge changes until it is applied.');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('kind radios sit in a fieldset with a legend (RC-7)', () => {
    renderForm();
    expect(screen.getByRole('group', { name: 'Price for' })).toBeInTheDocument();
  });
});

describe('manual entry on the page', () => {
  it('M-6b: after a save the page reads both lists again', async () => {
    const rows = [
      { id: 'a', provider: 'openai', model_name: 'gpt-4o-mini', input_cost_per_token: 0.00000015, output_cost_per_token: 0.0000006, effective_date: '2026-06-29' },
    ];
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      const reply =
        url === MANUAL_URL
          ? (okSave() as { status: number; body: unknown })
          : url === COMPARISON_URL
            ? okComparison(rows)
            : { status: 200, body: { success: true, data: rows } };
      return { ok: true, status: reply.status, json: async () => reply.body };
    }) as unknown as typeof fetch;

    render(<ModelPricingPage />);
    await screen.findByText('gpt-4o-mini');
    fireEvent.click(screen.getByRole('button', { name: 'Enter provider price for gpt-4o-mini' }));
    const form = screen.getByRole('form', { name: 'Enter a provider price' });
    await fillToken(form, { input: '0.15', output: '0.6', source: OFFICIAL });
    await save(form);
    await screen.findByText('Saved as a pending price. No charge changes until it is applied.');
    await waitFor(() =>
      expect(calls).toEqual([
        `GET ${PRICING_URL}`,
        `GET ${COMPARISON_URL}`,
        `POST ${MANUAL_URL}`,
        `GET ${PRICING_URL}`,
        `GET ${COMPARISON_URL}`,
      ])
    );
  });
});
