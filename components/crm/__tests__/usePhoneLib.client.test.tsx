/**
 * @jest-environment jsdom
 *
 * PERF-2: the phone library is fetched once, after mount, and read synchronously after that.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The acceptance criterion this backs is AC-2.2: a modal opened after the
 * after-paint download has finished draws the real phone field in its FIRST
 * render, alongside the other fields. That is a property of the loader, not of
 * any one modal, so it is tested here: a component mounted after the load sees
 * the library on its first render, with no placeholder render in between.
 *
 * Module state is per test file in Jest, so the order of the tests below is
 * the order of a page's life: nothing loaded, then loaded.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen, act } from '@testing-library/react';

// The real library is not needed to test the loader, only something to load.
jest.mock('@/components/crm/phoneLib', () => ({
  PhoneInput: () => <input data-testid="phone-input" />,
  SearchableCountrySelect: () => <div data-testid="country" />,
  phoneCountryLabelsEn: {},
  phoneFieldCountry: () => 'US',
  phoneFieldValue: (phone: string) => phone,
  applyCountryToPhone: (phone: string) => phone,
}));

import { usePhoneLib, usePhoneLibSettled, loadPhoneLib } from '../usePhoneLib';

/** Records what each render saw, so "the first render" can be asserted on. */
function Probe({ renders }: { renders: Array<boolean> }) {
  const lib = usePhoneLib();
  renders.push(lib !== null);
  return lib ? <lib.PhoneInput onChange={() => undefined} /> : <span data-testid="placeholder" />;
}

function SettledProbe() {
  const settled = usePhoneLibSettled();
  return <span data-testid="settled">{String(settled)}</span>;
}

describe('usePhoneLib', () => {
  it('starts with the placeholder, then draws the field once the module arrives', async () => {
    const renders: boolean[] = [];
    render(<Probe renders={renders} />);
    expect(screen.getByTestId('placeholder')).toBeInTheDocument();
    expect(renders[0]).toBe(false);

    // Mounting started the download; let it resolve.
    await act(async () => {
      await loadPhoneLib();
    });
    expect(screen.getByTestId('phone-input')).toBeInTheDocument();
  });

  it('a component mounted after the download draws the field on its very first render (AC-2.2)', () => {
    const renders: boolean[] = [];
    render(<Probe renders={renders} />);
    expect(renders[0]).toBe(true);
    expect(screen.getByTestId('phone-input')).toBeInTheDocument();
  });

  it('reports settled once loaded', () => {
    render(<SettledProbe />);
    expect(screen.getByTestId('settled')).toHaveTextContent('true');
  });

  it('downloads once: every later load resolves to the same module', async () => {
    const first = await loadPhoneLib();
    const second = await loadPhoneLib();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });
});
