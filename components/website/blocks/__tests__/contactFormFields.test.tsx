/**
 * @jest-environment jsdom
 *
 * The website's contact form has to ask for what its own route requires.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every `contact_form` block in the database stores `fields: []` — all ten of
 * them, on every page, generated that way. `normalizeFields` falls back to its
 * default set only when the value is NOT AN ARRAY, and an empty array is an
 * array, so it mapped to nothing. The block then rendered the single field the
 * phone guard appends, and submitted with no `email` and no `message`.
 *
 * `/api/website/forms/contact` requires both (`email` is `z.string().email()`,
 * `message` is `z.string().min(1)`), so every submission came back 400 and the
 * visitor saw the generic failure. One contact has ever been captured this way.
 *
 * Rendered rather than asserted on the source, because the defect is in what the
 * form ASKS FOR: the client-side validator only walks the fields that exist, so
 * nothing upstream of the route could notice the missing ones.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { render, screen } from '@testing-library/react';

/*
 * The section animates itself into view, and jsdom has no
 * `IntersectionObserver` for framer-motion's `whileInView` to hang off. Stubbed
 * rather than worked around: the animation is not what is under test, and
 * without it React unmounts the tree on the thrown reference error.
 */
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

import { ContactFormBlock } from '../ContactFormBlock';

/** What the route cannot do without. */
const REQUIRED_BY_THE_ROUTE = ['email', 'message'];

function renderWith(fields: unknown) {
  render(
    <ContactFormBlock
      content={{ title: 'Contact', fields } as never}
      locale="en"
      isRTL={false}
      subdomain="acme"
    />
  );
}

describe('a contact form block with no field configuration', () => {
  it.each(REQUIRED_BY_THE_ROUTE)('still asks for %s, which the route requires', name => {
    renderWith([]);
    expect(document.querySelector(`[name="${name}"]`)).not.toBeNull();
  });

  it('asks for a name too, as the default set always did', () => {
    renderWith([]);
    expect(document.querySelector('[name="name"]')).not.toBeNull();
  });

  /*
   * The phone box is rendered by `react-phone-number-input`, which carries no
   * `name` attribute of its own — hence the type selector. Checked because the
   * block appends a phone field whatever the configuration says, and with an
   * empty list that one field was the ENTIRE form.
   */
  it('still appends the phone box it insists on', () => {
    renderWith([]);
    expect(document.querySelector('input[type="tel"]')).not.toBeNull();
  });

  it('treats a missing field list the same way', () => {
    renderWith(undefined);
    for (const name of REQUIRED_BY_THE_ROUTE) {
      expect(document.querySelector(`[name="${name}"]`)).not.toBeNull();
    }
  });
});

describe('a contact form block that was configured', () => {
  it('renders exactly what the owner chose, plus the phone it insists on', () => {
    renderWith(['name', 'email', 'message']);
    expect(document.querySelector('[name="name"]')).not.toBeNull();
    expect(document.querySelector('[name="email"]')).not.toBeNull();
    expect(document.querySelector('[name="message"]')).not.toBeNull();
    expect(document.querySelector('input[type="tel"]')).not.toBeNull();
  });

  it('does not invent fields the owner left out beyond that', () => {
    renderWith(['name', 'email', 'message']);
    expect(document.querySelector('[name="company"]')).toBeNull();
  });

  it('renders a submit control either way', () => {
    renderWith([]);
    // Not `getByRole('button')`: the phone widget contributes a country-select
    // button of its own, so there are always two.
    expect(screen.getByRole('button', { name: /send/i })).toBeTruthy();
  });
});
