/**
 * A public form speaks in the platform's words, in the business's colours.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two things were wrong with what a visitor saw when they got something wrong.
 *
 * THE BROWSER ANSWERED FIRST. The booking dialog's forms carried `required` and
 * `type="email"` with no `noValidate`, so native validation blocked the submit
 * before any handler ran and rendered its own bubble — in the BROWSER's
 * language, not the site's, with none of the business's type or colour. The
 * intake step had no custom wording at all, so it showed "Please fill out this
 * field" verbatim.
 *
 * AND THE COLOUR CAME FROM SOMEWHERE ELSE. Every message was `text-red-600` or
 * `text-red-500`, and the fields rang `focus:ring-blue-200` — Tailwind values
 * belonging to the signed-in app's palette, on pages painted entirely in the
 * tenant's. Unreadable on a dark template; simply foreign on a warm one.
 *
 * Both are source-level facts: a render test cannot see a native bubble (jsdom
 * does not implement constraint validation UI), and a colour that resolves
 * through a CSS variable has no computed value in jsdom either.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const BLOCKS = join(__dirname, '..');
const read = (name: string) => readFileSync(join(BLOCKS, name), 'utf8');

/** Every public surface that asks a visitor for something. */
const FORMS = ['ContactFormBlock.tsx', 'ProcessFlowSection.tsx', 'IntakeFormStep.tsx'];

describe('the platform answers, not the browser', () => {
  it.each(FORMS)('%s suppresses native validation on every form it renders', name => {
    const source = read(name);
    const forms = source.match(/<form\b[^>]*>/g) ?? [];
    expect(forms.length).toBeGreaterThan(0);
    for (const tag of forms) {
      expect(tag).toContain('noValidate');
    }
  });

  /*
   * Suppressing the browser's check makes the handler the only one left, so the
   * fields the form stars as required have to be checked there — otherwise an
   * empty one submits and the route answers 400 with nothing a visitor can act
   * on. These are the three the booking dialog marks with a `*`.
   */
  it('the booking details step checks each field it marks required', () => {
    const flow = read('ProcessFlowSection.tsx');
    expect(flow).toMatch(/!clientName\?\.trim\(\)/);
    expect(flow).toMatch(/!clientEmail\?\.trim\(\)/);
    expect(flow).toMatch(/!clientPhone\?\.trim\(\)/);
    // And the shape `type="email"` used to be the only test of.
    expect(flow).toContain('labels.errEmailInvalid');
  });

  it('the intake step checks its own required answers', () => {
    const flow = read('ProcessFlowSection.tsx');
    expect(flow).toMatch(/field\.required && !\(answers\[field\.name\] \?\? ''\)\.trim\(\)/);
    expect(flow).toContain('labels.errRequiredFields');
  });
});

describe('the message is in the business\'s palette', () => {
  const FORBIDDEN = [
    'text-red-500',
    'text-red-600',
    'border-red-500',
    'focus:ring-red-200',
    'focus:ring-blue-200',
  ];

  it.each(FORMS)('%s names no colour of its own', name => {
    const source = read(name);
    for (const className of FORBIDDEN) {
      expect(source).not.toContain(className);
    }
  });

  it.each(FORMS)('%s uses the themed vocabulary instead', name => {
    expect(read(name)).toContain('ap-danger');
  });

  /*
   * The tokens those classes resolve through. Defined beside every other
   * `--ap-*` so a surface cannot get the classes without the values, and a
   * fixed hue whose lightness follows the palette — an error must not be the
   * brand colour, or a red-branded business has invisible errors and a
   * green-branded one announces failures in green.
   */
  it('the theme emits the danger tokens', () => {
    const emitter = readFileSync(
      join(BLOCKS, '..', '..', 'public', 'PublicThemeStyle.tsx'),
      'utf8'
    );
    expect(emitter).toContain('--ap-danger:');
    expect(emitter).toContain('--ap-danger-tint:');
    expect(emitter).toContain('--ap-danger-border:');
    // Not derived from the brand.
    expect(emitter).not.toMatch(/--ap-danger:\s*\$\{[^}]*colors\.primary/);
  });

  it('the utilities exist on both public surfaces', () => {
    const css = readFileSync(join(BLOCKS, '..', '..', '..', 'app', 'globals.css'), 'utf8');
    for (const utility of ['.ap-danger', '.ap-danger-line', '.ap-danger-surface', '.ap-ring', '.ap-ring-danger']) {
      // Each is declared for the document surface and for a scoped one.
      expect(css).toContain(`html[data-public-surface] ${utility}`);
      expect(css).toContain(`[data-ap-site] ${utility}`);
    }
  });
});
