/**
 * @jest-environment jsdom
 *
 * A service you just created stays open, so you can publish it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Reported by the owner: adding a service in the settings dialog put it in the
 * list and closed the row, so the only way to publish the thing they had just
 * finished describing was to find it again, click it, and press Publish.
 *
 * The rule already existed in this file, written on the EDIT path:
 *
 *   "The service stays open. Saving used to close the panel and empty the
 *    form — which read as 'done', when saving is only half of it: an edited
 *    service goes back to DRAFT and reaches nobody until it is published.
 *    Closing the panel took away the publish button at the exact moment it
 *    mattered."
 *
 * A new service is saved as `is_active: false, status: 'draft'`, so every word
 * of that applies to it too. The create path simply never got it.
 *
 * The open is deferred until the refreshed list carries the row, because the
 * SERVER shapes what it stored — a quote has its price nulled, a service that
 * needs no time has its duration dropped — and the editor must show the record
 * rather than what was typed at it.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react';
import type { SchedulingService } from '@/lib/repositories/SchedulingRepository';

const COPY: Record<string, string> = {
  /* The two controls this test drives, by the keys the component really uses. */
  'scheduling.new_service': 'Add a service',
  'button.save': 'Save',
  'scheduling.no_services': 'Nothing here yet',
  'scheduling.no_services_desc': 'Add the first one.',
};

jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) => COPY[key] ?? key,
    isRTL: false,
    language: 'en',
    currencyCode: 'ILS',
    businessCurrency: 'ILS',
    formatCurrency: (value: number) => `₪${value}`,
  }),
}));

jest.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
}));

jest.mock('@/components/business-os/setup/ClientJourneyStrip', () => ({
  ClientJourneyStrip: () => <div data-testid="journey" />,
}));

import { SchedulingServicesList } from '../SchedulingServicesList';

const CREATED_ID = 'svc-created';

/** What the server stored, which is not quite what was typed at it. */
const CREATED = {
  id: CREATED_ID,
  service_name: 'Deep tissue massage',
  description: null,
  duration_minutes: 60,
  buffer_minutes: 0,
  price: 250,
  currency: 'ILS',
  /* The reason this test exists: a new service is a DRAFT. */
  status: 'draft',
  is_active: false,
  is_scheduled: true,
  sale_mode: 'direct',
  collection: 'invoice',
  payment_type: 'full',
  installment_count: 1,
  installment_frequency: 'monthly',
  first_payment_due: 'on_booking',
  first_payment_days: 0,
} as unknown as SchedulingService;

const settle = () => act(async () => { await Promise.resolve(); });

/**
 * The list, with the parent's refresh wired the way the real one is: the
 * component asks through `onServicePublished`, and the parent answers by
 * handing back a list that now contains the new row.
 */
function renderList() {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, service: { id: CREATED_ID } }),
    } as Response)
  ) as unknown as typeof fetch;

  function Harness() {
    const [services, setServices] = React.useState<SchedulingService[]>([]);
    return (
      <SchedulingServicesList
        services={services}
        showAddButton
        processorReady
        intakeEnabled={false}
        onServicePublished={() => setServices([CREATED])}
      />
    );
  }

  render(<Harness />);
}

/**
 * Add a service and save it, which is the flow both cases are about.
 *
 * BOTH fields are filled, and that is load-bearing: Save is
 * `disabled={saving || nameMissing || descriptionMissing || …}`, so a fixture
 * that types only a name never saves at all. An earlier draft of this test did
 * exactly that and still passed, because the value it asserted on was the one
 * it had just typed into the row that never closed. The assertions below now
 * read a figure only the SERVER could have supplied.
 */
async function createService() {
  fireEvent.click(screen.getByText('Add a service'));
  await settle();

  const name = document.querySelector('input[type="text"]') as HTMLInputElement;
  expect(name).toBeTruthy();
  fireEvent.change(name, { target: { value: 'Typed name' } });

  const description = document.querySelector('textarea') as HTMLTextAreaElement;
  expect(description).toBeTruthy();
  fireEvent.change(description, { target: { value: 'Typed description' } });
  await settle();

  const save = screen.getByText('Save').closest('button') as HTMLButtonElement;
  expect(save.disabled).toBe(false);

  fireEvent.click(save);
  await settle();
  await settle();
}

afterEach(() => {
  /*
   * EXPLICIT, because auto-cleanup is not on in this project's setup.
   *
   * Without it the previous test's DOM is still in the document, and
   * `document.querySelector('input')` returns the editor left open by the case
   * before — so the second test typed into a detached form, the Save button of
   * the live one stayed disabled, and the failure looked like "fetch was never
   * called" rather than "you are driving the wrong render".
   */
  cleanup();
  jest.clearAllMocks();
});

describe('after saving a new service', () => {
  it('the editor is open on it, rather than collapsed into the list', async () => {
    renderList();
    await createService();

    /*
     * Asserted on what the SERVER stored, never on what was typed: the fixture
     * types "Typed name" and the created record comes back as "Deep tissue
     * massage" at 250. A row that merely failed to close would still be
     * holding the typed text, which is the trap this wording exists to avoid.
     */
    const values = Array.from(document.querySelectorAll('input')).map(
      input => (input as HTMLInputElement).value
    );
    expect(values).toContain('Deep tissue massage');
    expect(values).toContain('250');
    expect(values).not.toContain('Typed name');
  });

  it('saved it as a draft, which is why staying open matters', async () => {
    renderList();
    await createService();

    const posted = (global.fetch as jest.Mock).mock.calls.find(
      ([url, init]) => String(url).includes('/api/scheduling/services') && init?.method === 'POST'
    );
    expect(posted).toBeTruthy();

    /* Saved as a draft, which is the whole reason it must stay open. */
    expect(JSON.parse(posted![1].body)).toMatchObject({ status: 'draft', is_active: false });
  });
});

describe('the source rule', () => {
  const source = require('fs').readFileSync(
    require('path').join(process.cwd(), 'components', 'scheduling', 'SchedulingServicesList.tsx'),
    'utf8'
  );

  it('defers the open until the refreshed list carries the row', () => {
    /*
     * Anchored to the start of a line, because `toContain` matched the call
     * perfectly well while it was COMMENTED OUT — found when the fix was
     * disabled on purpose to check this file could fail at all, and three of
     * these cases stayed green.
     */
    expect(source).toMatch(/^\s*setOpenAfterCreateId\(newServiceId\);$/m);
    expect(source).toContain('const created = services.find(service => service.id === openAfterCreateId);');
    expect(source).toContain('if (!created) return;');
  });

  it('reuses startRowEdit rather than writing the mapping a third time', () => {
    const effect = source.slice(source.indexOf('if (!openAfterCreateId) return;'));
    expect(effect.slice(0, 400)).toContain('startRowEdit(created);');
  });

  it('clears the id as it is consumed, so a later refresh cannot reopen it', () => {
    const effect = source.slice(source.indexOf('if (!openAfterCreateId) return;'));
    expect(effect.slice(0, 400)).toContain('setOpenAfterCreateId(null);');
  });
});
