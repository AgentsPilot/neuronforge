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

/**
 * The `<SavedAddressPicker … />` element starting at `from` in `source`: up to
 * its own closing `/>`, found by brace depth rather than by indentation, so the
 * call can sit in any branch (C-a moved it into the "book is in" branch).
 * Prop values are `{…}` expressions; a `/>` inside one (a JSX prop) is not the
 * element's end.
 */
function elementAt(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length - 1; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (depth === 0 && ch === '/' && source[i + 1] === '>') return source.slice(from, i + 2);
  }
  throw new Error('no closing /> for the element');
}

/** The `<SavedAddressPicker … />` element in the panel. */
function pickerCall(): string {
  const start = panel.indexOf('<SavedAddressPicker');
  expect(start).toBeGreaterThan(-1);
  return elementAt(panel, start);
}

describe('pickerCall() finds the element, at any indentation (SA-CA-5 negative controls)', () => {
  it("stops at the element's own />, not at a /> inside a prop, and ignores indentation", () => {
    const source = [
      '{ready ? (',
      '<SavedAddressPicker',
      '  use="marketing"',
      '      icon={<Icon />}',
      '  matchCurrent={(o) => o.id === "x"}',
      '            />',
      ') : null}',
      '<p>after</p>',
    ].join('\n');
    const call = elementAt(source, source.indexOf('<SavedAddressPicker'));
    expect(call).toContain('matchCurrent={(o) => o.id === "x"}');
    expect(call.endsWith('/>')).toBe(true);
    expect(call).not.toContain('<p>after</p>');
    expect(call).not.toContain(') : null}');
  });

  it('a call with no closing /> is an error, not a silent slice of the rest of the file', () => {
    expect(() => elementAt('<SavedAddressPicker use="marketing"', 0)).toThrow();
  });
});

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

describe('exactly one picker, seeded, and it is the text form (SA-CA-5)', () => {
  it('G-5: the call passes initialBook', () => {
    expect(pickerCall()).toMatch(/\binitialBook=\{/);
  });

  it('G-6: <SavedAddressPicker occurs exactly once in the panel, and that one carries matchCurrent', () => {
    // A second, fallback picker in another branch without `matchCurrent` would
    // take the structured path and fill the field on its own again (F-18).
    expect(panel.split('<SavedAddressPicker').length - 1).toBe(1);
    expect(pickerCall()).toMatch(/\bmatchCurrent=\{/);
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
