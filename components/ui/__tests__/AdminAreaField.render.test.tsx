/**
 * @jest-environment jsdom
 */

/**
 * The State field appears for a country that has one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS MISSING
 *
 * No State input on the business profile or the invoice settings, for any
 * country — and the address saved without one even though Google had returned
 * `NJ` in the dropdown the owner picked from.
 *
 * One value explains both. This component renders `null` when
 * `rules.adminLabel` is falsy, and `resolveSuggestion` DELETES the state when
 * it is falsy, because that is the rule for countries with no administrative
 * area. `lib-address`'s browser build registers no countries, so `adminLabel`
 * was null for every country on earth.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING IS MOCKED HERE, DELIBERATELY.
 *
 * The rules now come from `lib-address/lite` and a generated label map, both
 * bundled. A test that stubbed them would have passed against the broken
 * version too — the old suite did exactly that for weeks, because Node resolves
 * the working entry point and jsdom was never exercised.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { render, waitFor } from '@testing-library/react';

import { AdminAreaField } from '../AdminAreaField';

function mount(country: string, value = '') {
  return render(
    <AdminAreaField
      country={country}
      value={value}
      onChange={jest.fn()}
      label={(key: string) => key}
      emptyLabel="none"
    />
  );
}

describe('a country whose addresses carry an administrative area', () => {
  it('draws a control for the United States', async () => {
    const { container } = mount('US');

    // Nothing until the rules resolve — deliberate, so an Israeli form does not
    // flash a State box and then remove it.
    await waitFor(() => expect(container.firstChild).not.toBeNull());
    expect(container.innerHTML).toContain('state');
  });

  it('loaded the real subdivisions, so it offers a list rather than a free box', () => {
    /*
     * The component draws a plain text input when a country has the field but
     * the data carries no list for it, and a combobox when it does. A combobox
     * for the US therefore proves the 62 US subdivisions arrived — which is the
     * half of the fix the label alone would not show.
     */
    const { container } = mount('US', 'NJ');

    return waitFor(() =>
      expect(container.querySelector('[role="combobox"]')).not.toBeNull()
    );
  });

  it('calls it a province in Canada and a prefecture in Japan', async () => {
    const canada = mount('CA');
    await waitFor(() => expect(canada.container.firstChild).not.toBeNull());
    expect(canada.container.innerHTML).toContain('province');

    const japan = mount('JP');
    await waitFor(() => expect(japan.container.firstChild).not.toBeNull());
    expect(japan.container.innerHTML).toContain('prefecture');
  });
});

describe('a country whose addresses carry none', () => {
  it('renders nothing for Israel', async () => {
    const { container } = mount('IL');

    // Given a tick to resolve, so this cannot pass merely by being early.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for the United Kingdom', async () => {
    const { container } = mount('GB');

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a code that is not a country', async () => {
    const { container } = mount('ZZ');

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(container.firstChild).toBeNull();
  });
});
