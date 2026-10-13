/**
 * A service with no duration still gets a generated landing page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * `scheduling_services.duration_minutes` is NULL for every service that is not
 * scheduled: a course, a product, a quote. The wizard sends that column through
 * verbatim as `serviceDuration`, and both landing-page schemas declared it
 *
 *     serviceDuration: z.number().optional()
 *
 * which accepts a number or absence but NOT null. So the generator answered 400
 * before the model was ever called, and the save route would have refused the
 * same services afterwards. `serviceDescription` and `servicePrice` were both
 * already `.nullable()`; this one field was missed.
 *
 * The visible symptom was not an error. The wizard answers a failed request by
 * drawing its starting draft, so the owner got a page of generic placeholder
 * benefits about their own service in roughly a second, with nothing in the
 * server log but `POST … 400` -- the ZodError branch logged nothing at all.
 * Diagnosed on a live row (`קורס קשב`, `is_scheduled: false`,
 * `duration_minutes: null`) on 2026-10-08.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The failure is the SCHEMA's, before any handler code runs, so there is no
 * function to call and no branch to cover. What has to hold is that these
 * fields admit the shape the database actually stores, and that a refusal is
 * never again silent.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

const GENERATE = 'app/api/website/landing-pages/generate/route.ts';
const SAVE = 'app/api/website/landing-pages/route.ts';
const WIZARD = 'components/business-os/LandingPageWizard.tsx';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('the schemas admit what the database stores', () => {
  it('strips comments before matching, or it fails on its own explanation', () => {
    expect(read(GENERATE)).toContain('z.number().optional()');
    expect(strip(read(GENERATE))).not.toContain('serviceDuration: z.number().optional()');
  });

  it.each([
    ['the generator', GENERATE],
    ['the save route', SAVE],
  ])('%s takes a null serviceDuration', (_label, file) => {
    const code = strip(read(file));
    expect(code).toContain('serviceDuration: z.number().nullable().optional()');
    expect(code).not.toContain('serviceDuration: z.number().optional()');
  });

  it('and still takes a null price and description, which were never the bug', () => {
    const code = strip(read(GENERATE));
    expect(code).toContain('servicePrice: z.number().nullable().optional()');
    expect(code).toContain('serviceDescription: z.string().nullable().optional()');
  });
});

describe('the payload the wizard actually sends', () => {
  /*
   * The generator's schema, restated. Replayed here rather than imported
   * because a route module may only export handlers and a fixed config set --
   * exporting the schema to test it breaks the build's generated types.
   */
  const Schema = z.object({
    serviceId: z.string().uuid(),
    serviceName: z.string().min(1),
    serviceDescription: z.string().nullable().optional(),
    servicePrice: z.number().nullable().optional(),
    serviceDuration: z.number().nullable().optional(),
    theme: z
      .object({
        colors: z.object({ primary: z.string(), secondary: z.string() }).passthrough(),
        fonts: z.object({ heading: z.string(), body: z.string() }).passthrough(),
      })
      .passthrough()
      .optional(),
  });

  /** The live row that exposed this, field for field. */
  const payload = {
    serviceId: '72d698b5-b846-49a3-8e1b-fb7640ec0408',
    serviceName: 'קורס קשב',
    serviceDescription: 'כמדריכי הורים ומטפלים המלווים הורים ומשפחות',
    servicePrice: 100,
    serviceDuration: null,
    theme: {
      colors: { primary: '#111111', secondary: '#222222' },
      fonts: { heading: 'Heebo', body: 'Heebo' },
    },
  };

  it('a course with no duration is accepted', () => {
    expect(Schema.safeParse(payload).success).toBe(true);
  });

  it('the old schema is what rejected it, on exactly that field', () => {
    // Proving the diagnosis, not the fix: without this the test above passes
    // against a schema that was never broken.
    const old = Schema.extend({ serviceDuration: z.number().optional() });
    const result = old.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors).toHaveLength(1);
      expect(result.error.errors[0].path).toEqual(['serviceDuration']);
      expect(result.error.errors[0].code).toBe('invalid_type');
    }
  });

  it.each([null, 0, 60, undefined])('a duration of %p is accepted', (duration) => {
    expect(Schema.safeParse({ ...payload, serviceDuration: duration }).success).toBe(true);
  });

  it('a duration that is genuinely wrong is still refused', () => {
    expect(Schema.safeParse({ ...payload, serviceDuration: '60' }).success).toBe(false);
  });
});

describe('a refusal is never silent again', () => {
  it.each([
    ['the generator', GENERATE],
    ['the save route', SAVE],
  ])('%s logs the rejected field paths', (_label, file) => {
    const code = strip(read(file));
    expect(code).toMatch(/error\.errors\.map\(\(e\) => \(\{ path: e\.path\.join\('\.'\), code: e\.code \}\)\)/);
  });

  it.each([
    ['the generator', GENERATE],
    ['the save route', SAVE],
  ])('%s logs no field VALUES, which are the owner\'s copy', (_label, file) => {
    const code = strip(read(file));
    const warnCall = code.slice(code.indexOf('issues: error.errors'), code.indexOf('issues: error.errors') + 320);
    expect(warnCall).not.toContain('e.message');
    expect(warnCall).not.toContain('received');
    expect(warnCall).not.toMatch(/\bbody\b/);
  });

  it('the wizard says so on screen when the request is refused', () => {
    // It drew the starting draft and said nothing, so placeholder copy read as
    // generated work. `success: false` is the branch a 400 lands in.
    const code = strip(read(WIZARD));
    const branch = code.slice(
      code.indexOf("console.warn('[LandingPageWizard] API failed"),
      code.indexOf('} catch (error) {')
    );
    expect(branch).toContain('setGenerationFailed(labels.generation_failed)');
    expect(branch).toContain('getDefaultGeneratedContent(selectedService)');
  });
});
