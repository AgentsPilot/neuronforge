/**
 * @jest-environment jsdom
 *
 * PERF-2 / SA O-1: a failed phone-library download recovers WITHOUT a remount.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The dashboard's contact modal and the header's booking modal are mounted
 * once and never remount. If the library's first download failed and the only
 * retry was "on the next mount", those two would show the placeholder (and,
 * for a new contact, a disabled Save) until the page was reloaded.
 *
 * So the loader retries on interaction: pressing the placeholder, and any
 * re-render of the host (the modal opening, typing) while the library is
 * still missing. Both are tested on ONE mounted component that never
 * unmounts. Module state is per test file, so the tests run in page order.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen, act, fireEvent } from '@testing-library/react';

let mockFail = true;
let mockAttempts = 0;
jest.mock('@/components/crm/phoneLib', () => {
  mockAttempts += 1;
  if (mockFail) throw new Error('ChunkLoadError: offline');
  return {
    PhoneInput: () => <input data-testid="phone-input" />,
    SearchableCountrySelect: () => <div data-testid="country" />,
    phoneCountryLabelsEn: {},
    phoneFieldCountry: () => 'US',
    phoneFieldValue: (phone: string) => phone,
    applyCountryToPhone: (phone: string) => phone,
  };
});

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

import { usePhoneLib } from '../usePhoneLib';
import { PhoneFieldPlaceholder } from '../PhoneFieldPlaceholder';

/** Stands in for an always-mounted modal: `open` changes, the component does not remount. */
function Host({ open }: { open: boolean }) {
  const lib = usePhoneLib();
  return (
    <div data-open={String(open)}>
      {lib ? <lib.PhoneInput onChange={() => undefined} /> : <PhoneFieldPlaceholder className="phone-input-crm flex-1" />}
    </div>
  );
}

/** Lets the dynamic import and its promise handlers settle. */
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

describe('usePhoneLib retries on interaction, not only on mount', () => {
  // One test, because Testing Library unmounts between tests and the point is
  // that the host is NEVER remounted.
  it('one mounted host: fails, retries on press and on re-render, never loops, recovers', async () => {
    const { rerender } = render(<Host open={false} />);
    await flush();
    expect(mockAttempts).toBe(1);
    expect(screen.queryByTestId('phone-input')).not.toBeInTheDocument();
    const placeholder = document.querySelector('[aria-busy="true"]');
    expect(placeholder).toBeInTheDocument();

    // Pressing the placeholder tries again.
    fireEvent.pointerDown(placeholder as Element);
    await flush();
    expect(mockAttempts).toBe(2);

    // A failure on its own does not trigger another attempt: no retry loop.
    await flush();
    await flush();
    expect(mockAttempts).toBe(2);

    // The network is back; the modal opens (a re-render, not a remount).
    mockFail = false;
    rerender(<Host open={true} />);
    await flush();
    expect(mockAttempts).toBe(3);
    expect(screen.getByTestId('phone-input')).toBeInTheDocument();
  });
});
