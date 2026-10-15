/**
 * The onboarding never says the site is live, because it is not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Reported from the build screen:
 *
 *     How clients reach you
 *     Your site is published
 *
 * It is not. `WebsiteGenerationService` writes the landing page with
 * `status: 'draft'`, under a comment that says so outright: "Website starts as
 * draft - user must explicitly publish".
 *
 * This is the expensive direction for a false claim. An owner told their site
 * is live has no reason to go and publish it, and no reason to look for a
 * problem when nobody arrives. It also appeared in three places at once: the
 * build page said it had happened, and the chat PROMISED it twice before that,
 * which is where the label came from.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

/** Comments stripped: these files necessarily quote the claim they forbid. */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SURFACES = [
  'app/onboarding-build/page.tsx',
  'app/onboarding-chat/page.tsx',
  'components/business-os/setup/OnboardingSetupPanel.tsx',
];

describe('the generated site is still a draft, and every surface says so', () => {
  it('the generator really does write a draft', () => {
    /*
     * Asserted first, because every claim below is only wrong while this is
     * true. If publishing ever becomes automatic, this test should fail here
     * and the copy should change back.
     */
    const service = read('lib/services/WebsiteGenerationService.ts');
    expect(service).toMatch(/status: 'draft', \/\/ Website starts as draft/);
  });

  it('no surface claims it is published', () => {
    for (const file of SURFACES) {
      const code = strip(read(file));
      expect(code).not.toMatch(/site is published/);
      expect(code).not.toMatch(/sitio está publicado/);
      expect(code).not.toMatch(/האתר שלך פורסם/);
    }
  });

  it('no surface promises to publish it', () => {
    /*
     * The promise is worse than the label, because the owner acts on it: they
     * finish onboarding believing a live site exists.
     */
    for (const file of SURFACES) {
      const code = strip(read(file));
      expect(code).not.toMatch(/build and publish|publish your site/);
      expect(code).not.toMatch(/publicaré tu sitio|publico un sitio/);
      expect(code).not.toMatch(/ואפרסם/);
    }
  });

  it('says instead that it is ready for them to publish', () => {
    const build = read('app/onboarding-build/page.tsx');
    expect(build).toMatch(/Your site is ready for you to publish/);
    expect(build).toMatch(/האתר שלך מוכן לפרסום/);
    expect(build).toMatch(/Tu sitio está listo para publicar/);

    const chat = read('app/onboarding-chat/page.tsx');
    expect(chat).toMatch(/leave it ready for you to publish/);
    expect(chat).toMatch(/מוכן לפרסום/);
    expect(chat).toMatch(/listo para publicar/);
  });
});
