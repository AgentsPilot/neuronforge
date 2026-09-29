/**
 * A failed consent read must never render as a refusal.
 *
 * Found on 2026-09-28: the drawer was open on a contact that had been deleted,
 * so `GET /api/crm/contacts/<id>/consent` answered 404. `load` only handled the
 * success case, so `state` stayed null, and null reaches the summary as
 * `state?.consented` — falsy — which selected `crm.consent.not_given`. The
 * section therefore told the owner that this person had declined marketing
 * consent, on the strength of a request that never answered.
 *
 * Consent decides whether it is lawful to email someone, so "we could not read
 * it" and "they said no" must stay distinguishable. These tests pin that.
 */

import fs from 'fs';
import path from 'path';

const root = process.cwd();
const source = fs.readFileSync(
  path.join(root, 'components/crm/contact-drawer/ConsentSection.tsx'),
  'utf8'
);

describe('ConsentSection — an unreadable consent state is not a refusal', () => {
  it('tracks a failed read separately from the consent value itself', () => {
    expect(source).toMatch(/const \[unavailable, setUnavailable\] = useState\(false\)/);
  });

  it('sets it on a non-success response, not only on a thrown error', () => {
    const load = source.slice(source.indexOf('const load = useCallback'), source.indexOf('useEffect('));
    // The `else` of `if (json.success)` — a response that arrives and says no.
    expect(load).toMatch(/if \(json\.success\)[\s\S]*else[\s\S]*setUnavailable\(true\)/);
    // And the network-failure path.
    expect(load).toMatch(/catch[\s\S]*setUnavailable\(true\)/);
  });

  it('clears it on a later successful read, so the section recovers', () => {
    const load = source.slice(source.indexOf('const load = useCallback'), source.indexOf('useEffect('));
    expect(load).toMatch(/setState\(json\.data\)[\s\S]{0,80}setUnavailable\(false\)/);
  });

  it('shows the unknown state ahead of any consent verdict in the summary', () => {
    const summary = source.slice(source.indexOf('const summary = loading'), source.indexOf('return ('));
    const at = (needle: string) => summary.indexOf(needle);
    expect(at('unavailable')).toBeGreaterThan(-1);
    // Must be reached before the branch that would say "not given".
    expect(at('unavailable')).toBeLessThan(at("t('crm.consent.not_given')"));
    expect(at("t('crm.consent.unavailable')")).toBeLessThan(at("t('crm.consent.not_given')"));
  });

  it('does not use the refusal icon for a state nobody established', () => {
    const icon = source.slice(source.indexOf('icon={'), source.indexOf('badge={'));
    expect(icon).toContain('unavailable');
    // Match the rendered elements, not prose — the comment beside them names
    // MailX to explain why it is wrong here.
    expect(icon.indexOf('<MailQuestion')).toBeGreaterThan(-1);
    expect(icon.indexOf('<MailQuestion')).toBeLessThan(icon.indexOf('<MailX'));
  });

  it('keeps the no-email case distinct from both', () => {
    // No address is a third thing again: nothing to hold consent against.
    expect(source).toContain("t('crm.consent.no_email')");
    expect(source).toMatch(/const noEmail = state\?\.consented === null/);
  });
});

describe('crm.consent.unavailable is translated everywhere', () => {
  const locales = fs.readFileSync(path.join(root, 'lib/business-os/LanguageContext.tsx'), 'utf8');

  it('exists in all three locales', () => {
    // `t()` returns the key on a miss and a key is truthy, so a missing key
    // renders as the literal string `crm.consent.unavailable` in the badge.
    const hits = locales.match(/'crm\.consent\.unavailable':/g) ?? [];
    expect(hits).toHaveLength(3);
  });

  it('is translated once per locale that has the sibling keys', () => {
    const checking = locales.match(/'crm\.consent\.checking':/g) ?? [];
    const unavailable = locales.match(/'crm\.consent\.unavailable':/g) ?? [];
    expect(unavailable).toHaveLength(checking.length);
  });
});

describe('the CRM page consumes ?contact= even when the contact is gone', () => {
  const page = fs.readFileSync(path.join(root, 'app/business-os/crm/page.tsx'), 'utf8');
  const fn = page.slice(
    page.indexOf('const fetchContactById ='),
    page.indexOf('const handleContactUpdated')
  );

  it('clears the URL parameter on every path, not just the successful one', () => {
    // The effect that calls this runs on [searchParams, contacts]; a parameter
    // left behind re-fires the fetch on every list refresh, forever.
    expect(fn).toMatch(/finally\s*\{[\s\S]*router\.replace\('\/business-os\/crm'/);
  });

  it('no longer clears it only inside the success branch', () => {
    const success = fn.slice(fn.indexOf('if (data.success'), fn.indexOf('} else {'));
    expect(success).toContain('setSelectedContact(data.contact)');
    expect(success).not.toContain('router.replace');
  });

  it('says something when the link named a contact it could not open', () => {
    expect(fn).toMatch(/else\s*\{[\s\S]*logger\.warn/);
  });
});
