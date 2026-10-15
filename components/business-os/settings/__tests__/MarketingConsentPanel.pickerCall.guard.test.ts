/**
 * The Marketing permission panel's call to the shared address picker (F-18).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The bug was a call written against an older shape of the picker: a `selected`
 * prop and an `AddressSource` type that no longer existed, and no `use`. The
 * compiler reported both, but CI has no `tsc` gate outside bos-llm, so it
 * shipped and wrote the book's default over the stored legal postal line on
 * every open. This pins the call shape, the picker's form type, and that the
 * test running the two together keeps the REAL picker.
 *
 * Positive pins run on comment-stripped source, so a commented-out prop cannot
 * satisfy them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const PANEL = 'components/business-os/settings/MarketingConsentPanel.tsx';
const PICKER = 'components/ui/SavedAddressPicker.tsx';
const REAL_PICKER_TEST = 'components/business-os/settings/__tests__/MarketingConsentPanel.picker.render.test.tsx';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const panel = stripComments(read(PANEL));
const picker = stripComments(read(PICKER));

/** The `<SavedAddressPicker … />` element in the panel. */
function pickerCall(): string {
  const start = panel.indexOf('<SavedAddressPicker');
  expect(start).toBeGreaterThan(-1);
  // Its own closing `/>` sits on a line of its own, after the multi-line props.
  const end = panel.indexOf('\n          />', start);
  expect(end).toBeGreaterThan(start);
  return panel.slice(start, end);
}

describe('the panel calls the picker as a text form', () => {
  it('G-1: passes use="marketing", selectedId and matchCurrent', () => {
    const call = pickerCall();
    expect(call).toMatch(/\buse="marketing"/);
    expect(call).toMatch(/\bselectedId=\{/);
    expect(call).toMatch(/\bmatchCurrent=\{/);
  });

  it('G-2: no dead `selected` prop, and no `AddressSource` anywhere in the panel', () => {
    expect(pickerCall()).not.toMatch(/\sselected=\{/);
    expect(read(PANEL)).not.toMatch(/\bAddressSource\b/);
  });
});

describe('the picker keeps the pointer type and the form type apart', () => {
  it("G-3: exports AddressForm, types `use` with it, and AddressUse stays the two pointer uses", () => {
    expect(picker).toMatch(/export type AddressForm\s*=\s*AddressUse\s*\|\s*'marketing'\s*;/);
    expect(picker).toMatch(/\buse:\s*AddressForm\s*;/);
    expect(picker).toMatch(/export type AddressUse\s*=\s*'profile'\s*\|\s*'invoice'\s*;/);
    expect(picker).toMatch(/\busedBy:\s*AddressUse\[\]\s*;/);
  });
});

describe('the real-picker test stays real (SA F-18 C-7)', () => {
  it('G-4: never mocks @/components/ui/SavedAddressPicker', () => {
    const source = read(REAL_PICKER_TEST);
    const code = stripComments(source);
    expect(code).not.toMatch(/jest\.(do)?[mM]ock\(\s*['"`][^'"`]*SavedAddressPicker['"`]/);
    expect(code).not.toMatch(/jest\.(do)?[mM]ock\(\s*['"`][^'"`]*components\/ui\/SavedAddressPicker/);
    // And it renders the panel, so the real picker is actually reached.
    expect(code).toMatch(/<MarketingConsentPanel\b/);
  });
});
