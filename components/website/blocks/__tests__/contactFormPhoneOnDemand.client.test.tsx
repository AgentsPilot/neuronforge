/**
 * @jest-environment jsdom
 *
 * BR-2: the public contact form's phone field arrives on demand, and nothing a
 * visitor sends changes because of it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The loader (`usePhoneLib` / `loadPhoneLib`) is replaced by a store this file
 * controls, so a test can decide WHEN the library arrives, or that it never
 * does. What it hands over is the REAL `components/crm/phoneLib` module, so
 * the phone field, the country select and the validation under test are the
 * ones the page runs.
 *
 * The same-output expectations (AC-2.7) are literal strings recorded once from
 * `main` (@ `0aee8efa`, before this change) by rendering the old block, typing
 * each input and capturing the submitted body. They are deliberately NOT
 * computed here with the library: a test that asks the same library the code
 * uses would only agree with itself (SA RC-2b).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PhoneLib } from '@/components/crm/usePhoneLib';

class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = NoopObserver;

jest.mock('@/hooks/useConsentCopy', () => ({
  useConsentCopy: () => null,
  consentPayload: () => undefined,
}));

/* ── The controllable loader ─────────────────────────────────────────────── */

let mockLib: PhoneLib | null = null;
const mockListeners = new Set<() => void>();
let mockWaiting: Array<(lib: PhoneLib | null) => void> = [];
const mockLoadCalls = { count: 0 };

jest.mock('@/components/crm/usePhoneLib', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use imports
  const React = require('react');
  return {
    loadPhoneLib: () => {
      mockLoadCalls.count += 1;
      if (mockLib) return Promise.resolve(mockLib);
      return new Promise(resolve => mockWaiting.push(resolve));
    },
    usePhoneLib: () =>
      React.useSyncExternalStore(
        (listener: () => void) => {
          mockListeners.add(listener);
          return () => mockListeners.delete(listener);
        },
        () => mockLib,
        () => null
      ),
  };
});

const realLib = jest.requireActual('@/components/crm/phoneLib') as PhoneLib;

/** The library arrives: every waiting caller and every rendered field gets it. */
async function arrive() {
  await act(async () => {
    mockLib = realLib;
    mockListeners.forEach(listener => listener());
    mockWaiting.forEach(resolve => resolve(realLib));
    mockWaiting = [];
  });
}

/** The download fails: every waiting caller gets null, as `loadPhoneLib` does. */
async function fail() {
  await act(async () => {
    mockWaiting.forEach(resolve => resolve(null));
    mockWaiting = [];
  });
}

import { ContactFormBlock } from '../ContactFormBlock';

type Locale = 'he' | 'en' | 'es';

// userEvent types one key at a time through the real phone field: slow in jsdom.
jest.setTimeout(20000);

const fetchMock = jest.fn();

beforeEach(() => {
  mockLib = null;
  mockWaiting = [];
  mockListeners.clear();
  mockLoadCalls.count = 0;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true });
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
});

function renderBlock(locale: Locale = 'en') {
  return render(
    <ContactFormBlock
      content={{ title: 'Contact', fields: [] } as never}
      locale={locale}
      isRTL={locale === 'he'}
      subdomain="acme"
    />
  );
}

/*
 * The field's own label (text plus the required asterisk), exactly. A prefix
 * match would also hit the library's hidden built-in country select, whose
 * aria-label is "Phone number country" (present on main too, display:none).
 */
const PHONE_LABEL: Record<Locale, RegExp> = { en: /^Phone\*?$/, es: /^Teléfono\*?$/, he: /^טלפון\*?$/ };

const REQUIRED: Record<Locale, string> = {
  en: 'This field is required',
  es: 'Este campo es obligatorio',
  he: 'שדה זה הוא חובה',
};

const INVALID: Record<Locale, string> = {
  en: 'Please enter a valid phone number',
  es: 'Por favor, introduce un número de teléfono válido',
  he: 'אנא הזן מספר טלפון תקין',
};

const UNAVAILABLE: Record<Locale, string> = {
  en: 'The phone field could not load. Please try again.',
  es: 'No se pudo cargar el campo de teléfono. Por favor, inténtalo de nuevo.',
  he: 'לא ניתן היה לטעון את שדה הטלפון. אנא נסה שוב.',
};

function field(container: HTMLElement, name: string) {
  return container.querySelector(`[name="${name}"]`) as HTMLInputElement;
}

/*
 * The other fields are plain controlled inputs and not under test, so they are
 * set in one change event each; only the phone is typed key by key.
 */
function fillOtherFields(container: HTMLElement) {
  act(() => {
    fireEvent.change(field(container, 'name'), { target: { value: 'Dana' } });
    fireEvent.change(field(container, 'email'), { target: { value: 'dana@example.com' } });
    fireEvent.change(field(container, 'message'), { target: { value: 'Hi' } });
  });
}

async function submit(container: HTMLElement) {
  await act(async () => {
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
  });
}

const errorTexts = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('p.ap-danger')).map(p => p.textContent);

/* ── Before the library arrives ──────────────────────────────────────────── */

describe('before the phone library arrives', () => {
  it.each([
    ['en', '+1'],
    ['he', '+972'],
    ['es', '+34'],
  ] as const)('%s: the row is a focusable, labelled placeholder on the page default (%s)', (locale, code) => {
    const { container } = renderBlock(locale);
    const box = screen.getByLabelText(PHONE_LABEL[locale]) as HTMLInputElement;

    expect(box.tagName).toBe('INPUT');
    expect(box).toHaveAttribute('type', 'tel');
    expect(box).toHaveAttribute('readonly');
    expect(box).not.toBeDisabled();
    expect(box).not.toHaveAttribute('aria-hidden');
    expect(box).not.toHaveAttribute('tabindex', '-1');
    expect(box).not.toHaveAttribute('name');
    // The country stub shows what the real button will show.
    expect(container.querySelector('.relative > button')?.textContent).toContain(code);
  });

  it('the label points at the placeholder before arrival and at the real input after (RC-7)', async () => {
    renderBlock('en');
    const before = screen.getByLabelText(PHONE_LABEL.en);
    expect(before).toHaveAttribute('readonly');

    await arrive();

    const after = screen.getByLabelText(PHONE_LABEL.en);
    expect(after).not.toBe(before);
    expect(after.tagName).toBe('INPUT');
    expect(after).not.toHaveAttribute('readonly');
    expect(after).toHaveClass('PhoneInputInput');
  });
});

/* ── Focus hand-off (FR-2.4, RC-3) ───────────────────────────────────────── */

describe('focus on the placeholder', () => {
  it('moves into the real number box when the library arrives', async () => {
    renderBlock('en');
    act(() => {
      (screen.getByLabelText(PHONE_LABEL.en) as HTMLInputElement).focus();
    });

    await arrive();

    const real = screen.getByLabelText(PHONE_LABEL.en);
    expect(real).toHaveClass('PhoneInputInput');
    expect(document.activeElement).toBe(real);
  });

  it('is never stolen back from a field the visitor moved to', async () => {
    const { container } = renderBlock('en');
    act(() => {
      (screen.getByLabelText(PHONE_LABEL.en) as HTMLInputElement).focus();
    });
    act(() => {
      field(container, 'message').focus();
    });

    await arrive();

    expect(document.activeElement).toBe(field(container, 'message'));
  });

  /*
   * The case the hand-off's `activeElement` check exists for (RC-3). The
   * placeholder loses focus with NO `relatedTarget` (as a removed node may, or
   * a blur to nowhere), so the pending hand-off survives. The visitor then
   * focuses Name, and nothing else clears it. Only the "focus is on
   * null/body" check stops the arrival from pulling focus back (QA found this
   * branch untested: removing it left every other test green).
   */
  it('is not stolen from a field focused after a blur with no relatedTarget', async () => {
    const { container } = renderBlock('en');
    const placeholder = screen.getByLabelText(PHONE_LABEL.en) as HTMLInputElement;
    const name = field(container, 'name');
    act(() => {
      placeholder.focus();
    });
    /*
     * jsdom never reports a null `relatedTarget` on a real blur (`blur()` gives
     * the Document, moving focus gives the next element), so the browser case
     * is modelled in two steps: React sees a blur with `relatedTarget: null`,
     * then focus moves to Name with the placeholder's native `focusout` kept
     * from React, so nothing clears the pending hand-off on the way.
     */
    fireEvent.focusOut(placeholder, { relatedTarget: null });
    const hideFromReact = (event: Event) => event.stopPropagation();
    placeholder.addEventListener('focusout', hideFromReact);
    act(() => {
      name.focus();
    });
    placeholder.removeEventListener('focusout', hideFromReact);
    expect(document.activeElement).toBe(name);

    await arrive();

    expect(document.activeElement).toBe(name);
  });
});

/* ── Submitting before arrival (FR-2.5, RC-1, RC-2a) ─────────────────────── */

describe('pressing Send before the library arrives', () => {
  it('shows the sending state, then today\'s "required" on the phone, and sends nothing', async () => {
    const { container } = renderBlock('en');
    fillOtherFields(container);

    await submit(container);
    const button = container.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(button).toBeDisabled();
    expect(button.querySelector('.animate-spin')).not.toBeNull();
    expect(errorTexts(container)).toEqual([]);

    await arrive();

    expect(errorTexts(container)).toEqual([REQUIRED.en]);
    expect(errorTexts(container)).not.toContain(INVALID.en);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /send/i })).not.toBeDisabled();
    expect(field(container, 'name').value).toBe('Dana');
    expect(field(container, 'email').value).toBe('dana@example.com');
    expect(field(container, 'message').value).toBe('Hi');
  });

  it('pressed twice quickly waits once and sends nothing', async () => {
    const { container } = renderBlock('en');
    fillOtherFields(container);
    const callsBefore = mockLoadCalls.count;

    await submit(container);
    await submit(container);
    expect(mockLoadCalls.count - callsBefore).toBe(1);

    await arrive();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('once loaded and filled, sends exactly once with today\'s body', async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = renderBlock('en');
    await arrive();
    fillOtherFields(container);
    await user.type(screen.getByLabelText(PHONE_LABEL.en), '2015550123');

    await submit(container);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/website/forms/contact');
    const body = JSON.parse(init.body);
    // Keys and values as `main` sends them (recorded).
    expect(Object.keys(body)).toEqual(['subdomain', 'name', 'email', 'phone', 'message', 'page_url']);
    expect(body).toMatchObject({
      subdomain: 'acme',
      name: 'Dana',
      email: 'dana@example.com',
      phone: '+12015550123',
      message: 'Hi',
    });
  });
});

/* ── The library cannot load (FR-2.6, BQ-5, RC-2c) ───────────────────────── */

describe('when the library cannot load', () => {
  it.each(['en', 'es', 'he'] as const)(
    '%s: says "please try again", keeps the fields, sends nothing, and clears once it loads',
    async locale => {
      const { container } = renderBlock(locale);
      fillOtherFields(container);

      await submit(container);
      await fail();

      expect(errorTexts(container)).toEqual([UNAVAILABLE[locale]]);
      expect(errorTexts(container)).not.toContain(REQUIRED[locale]);
      expect(errorTexts(container)).not.toContain(INVALID[locale]);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(field(container, 'name').value).toBe('Dana');
      expect(field(container, 'email').value).toBe('dana@example.com');
      expect(field(container, 'message').value).toBe('Hi');
      expect(container.querySelector('button[type="submit"]')).not.toBeDisabled();

      // A later attempt succeeds: the stale message goes, the real field is there.
      await arrive();
      expect(errorTexts(container)).toEqual([]);
      expect(screen.getByLabelText(PHONE_LABEL[locale])).toHaveClass('PhoneInputInput');
    },
    20000
  );
});

/* ── Same output as main (AC-2.7, AC-2.8) ────────────────────────────────── */

interface Recorded {
  locale: Locale;
  typed: string;
  /** A country picked in the dropdown after typing (AC-2.8). */
  pick?: string;
  /** The stored `phone` in the submitted body, or null when nothing was sent. */
  stored: string | null;
  /** The messages shown, in order. */
  errors: string[];
}

/* Recorded from `main` @ 0aee8efa (the old block, unchanged), 2026-10-14. */
const RECORDED_ON_MAIN: Recorded[] = [
  { locale: 'he', typed: '0501234567', stored: '+972501234567', errors: [] },
  { locale: 'he', typed: '2015550123', stored: null, errors: ['אנא הזן מספר טלפון תקין'] },
  { locale: 'he', typed: '07400123456', stored: null, errors: ['אנא הזן מספר טלפון תקין'] },
  { locale: 'he', typed: '123', stored: null, errors: ['אנא הזן מספר טלפון תקין'] },
  { locale: 'he', typed: '', stored: null, errors: ['שדה זה הוא חובה'] },
  { locale: 'en', typed: '0501234567', stored: null, errors: ['Please enter a valid phone number'] },
  { locale: 'en', typed: '2015550123', stored: '+12015550123', errors: [] },
  { locale: 'en', typed: '07400123456', stored: null, errors: ['Please enter a valid phone number'] },
  { locale: 'en', typed: '123', stored: null, errors: ['Please enter a valid phone number'] },
  { locale: 'en', typed: '', stored: null, errors: ['This field is required'] },
  { locale: 'es', typed: '0501234567', stored: null, errors: ['Por favor, introduce un número de teléfono válido'] },
  { locale: 'es', typed: '2015550123', stored: null, errors: ['Por favor, introduce un número de teléfono válido'] },
  { locale: 'es', typed: '07400123456', stored: null, errors: ['Por favor, introduce un número de teléfono válido'] },
  { locale: 'es', typed: '123', stored: null, errors: ['Por favor, introduce un número de teléfono válido'] },
  { locale: 'es', typed: '', stored: null, errors: ['Este campo es obligatorio'] },
  // A valid Spanish mobile on a Spanish page.
  { locale: 'es', typed: '612345678', stored: '+34612345678', errors: [] },
  // A country change rewrites the number (AC-2.8).
  { locale: 'he', typed: '2015550123', pick: 'United States', stored: '+12015550123', errors: [] },
  { locale: 'he', typed: '0501234567', pick: 'United Kingdom', stored: null, errors: ['אנא הזן מספר טלפון תקין'] },
];

describe('the stored phone and the message match main', () => {
  it.each(RECORDED_ON_MAIN.map(r => [`${r.locale} "${r.typed}"${r.pick ? ` → ${r.pick}` : ''}`, r] as const))(
    '%s',
    async (_name, recorded) => {
      const user = userEvent.setup({ delay: null });
      const { container } = renderBlock(recorded.locale);
      await arrive();
      fillOtherFields(container);
      const phone = screen.getByLabelText(PHONE_LABEL[recorded.locale]);
      if (recorded.typed) await user.type(phone, recorded.typed);
      if (recorded.pick) {
        await user.click(container.querySelector('.relative > button') as HTMLElement);
        const option = Array.from(container.querySelectorAll('span.truncate')).find(
          span => span.textContent === recorded.pick
        );
        await user.click(option as HTMLElement);
      }

      await submit(container);

      const sent = fetchMock.mock.calls[0] ? JSON.parse(fetchMock.mock.calls[0][1].body) : null;
      expect(sent ? sent.phone : null).toBe(recorded.stored);
      expect(errorTexts(container)).toEqual(recorded.errors);
    },
    20000
  );
});
