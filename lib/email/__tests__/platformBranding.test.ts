/**
 * The platform email branding (invite-only signup Slice 3a, T-3a-3; SA R-3,
 * R-9): the AgentPilot wordmark only when `NEXT_PUBLIC_APP_URL` is set and
 * https, read directly and never through `platformUrl()`'s fallback host; the
 * size from the brand manifest; the file present where sent emails point; and
 * only the two platform templates using it.
 */

import fs from 'fs';
import path from 'path';

import { LOGO_HEIGHT, WORDMARK, widthForHeight } from '@/lib/brand/logo';
import { platformEmailBranding, platformEmailLogoUrl } from '../platformBranding';

const ORIGINAL = process.env.NEXT_PUBLIC_APP_URL;
const PROD = 'https://neuronforge-kohl.vercel.app';
const ROOT = path.resolve(__dirname, '..', '..', '..');

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL;
});

describe('platformEmailBranding', () => {
  it('https: the wordmark at 154x28 on that host, flat fields, alt text is the name', () => {
    process.env.NEXT_PUBLIC_APP_URL = PROD;
    const branding = platformEmailBranding('en');
    expect(branding).toEqual({
      businessName: 'AgentPilot',
      primaryColor: '#4F46E5', // the app's V2 primary (was slate-900; invite branding refresh)
      secondaryColor: '#334155',
      locale: 'en',
      logoUrl: `${PROD}/images/brand/wordmark.png`,
      logoWidth: 154,
      logoHeight: 28,
    });
  });

  it('the size comes from the manifest (the header height, the file ratio)', () => {
    process.env.NEXT_PUBLIC_APP_URL = PROD;
    const branding = platformEmailBranding('he');
    expect(branding.logoHeight).toBe(LOGO_HEIGHT.header);
    expect(branding.logoWidth).toBe(widthForHeight(WORDMARK.light, LOGO_HEIGHT.header));
    expect(branding.locale).toBe('he');
  });

  it('a trailing slash on the origin does not double the slash', () => {
    process.env.NEXT_PUBLIC_APP_URL = `${PROD}/`;
    expect(platformEmailLogoUrl()).toBe(`${PROD}/images/brand/wordmark.png`);
  });

  it('unset (the variable deleted): no logo, the text wordmark, and never app.agentspilot.ai', () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(process.env.NEXT_PUBLIC_APP_URL).toBeUndefined();
    const branding = platformEmailBranding('en');
    expect(platformEmailLogoUrl()).toBeNull();
    expect(branding.logoUrl).toBeUndefined();
    expect(branding.logoWidth).toBeUndefined();
    expect(branding.logoHeight).toBeUndefined();
    expect(JSON.stringify(branding)).not.toContain('agentspilot.ai');
  });

  it.each(['', '   ', 'http://localhost:3000', 'http://neuronforge-kohl.vercel.app', 'neuronforge-kohl.vercel.app', 'https://'])(
    '%j: no logo',
    (value) => {
      process.env.NEXT_PUBLIC_APP_URL = value;
      expect(platformEmailLogoUrl()).toBeNull();
      expect(platformEmailBranding('en').logoUrl).toBeUndefined();
    }
  );
});

describe('the wordmark file emails point at', () => {
  /*
   * Emails already sent reference this path for as long as anyone keeps them,
   * so a rename or a move breaks them silently (SA R-3).
   */
  it('exists at public/images/brand/wordmark.png and is a PNG', () => {
    const file = path.join(ROOT, 'public', 'images', 'brand', 'wordmark.png');
    expect(fs.existsSync(file)).toBe(true);
    const signature = fs.readFileSync(file).subarray(0, 8);
    expect(signature.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(WORDMARK.light.src).toBe('/images/brand/wordmark.png');
  });
});

describe('who uses the platform branding', () => {
  /*
   * Business emails carry the business's own logo or name. The only way one
   * could pick up the AgentPilot wordmark is by importing this module, so the
   * importers are pinned. Adding a platform email means adding it here.
   */
  const ALLOWED = new Set([
    'lib/email/templates/invite-invitation.ts',
    'lib/email/templates/invite-signup-code.ts',
    // Slice 5b (F5b-3, SA R-5): the "you already have an account" notice, a
    // platform security message from the system sender, like the code email.
    'lib/email/templates/invite-existing-account.ts',
    // N-1: "your invitation was accepted", a platform message to the invite's
    // issuer (a champion or an admin), from the system sender.
    'lib/email/templates/invite-accepted.ts',
  ]);

  function walk(dir: string, out: string[]): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '__tests__') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
  }

  it('is imported only by the invitation, sign-up code, existing-account and invite-accepted templates', () => {
    const files: string[] = [];
    for (const top of ['lib', 'app', 'components']) {
      const dir = path.join(ROOT, top);
      if (fs.existsSync(dir)) walk(dir, files);
    }
    const importers = files
      .filter((file) => /from\s+['"][^'"]*platformBranding['"]/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file).split(path.sep).join('/'));

    expect(importers.sort()).toEqual([...ALLOWED].sort());
  });
});
