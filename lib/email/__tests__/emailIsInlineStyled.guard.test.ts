/**
 * Every outgoing email styles itself INLINE, because a phone throws the rest away.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * Reported as "some emails don't render as HTML on mobile". They render: Gmail's
 * iOS and Android apps strip a stylesheet out of the head and leave everything
 * else alone, so a template styled by CLASSES arrives with its markup intact and
 * every rule that laid it out gone. The same message is correct on desktop
 * Gmail, which honours head styles — which is exactly why it went unnoticed.
 *
 * Two senders did it:
 *
 *   · the workflow APPROVAL request, whose green Approve and red Reject buttons
 *     collapsed into two indistinguishable blue links — the worst email to lose
 *     its buttons in, since the two actions are opposites and one click each;
 *   · the contact form's auto-reply, which lost its header, its panel and its
 *     quoted-message box.
 *
 * Every client-facing template was already safe: they all render through
 * `base-template.ts`, which uses inline attributes and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The failure is in a mail client, not in a browser. jsdom applies head styles
 * perfectly happily, so a render test of any of these templates passes whether
 * or not Gmail would show it. What can be checked is the rule itself: no
 * stylesheet in anything we post.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const root = process.cwd();

/** Everything that builds HTML for an email we send. */
const SENDERS = [
  ...fs
    .readdirSync(path.join(root, 'lib/email/templates'))
    .filter(name => name.endsWith('.ts'))
    .map(name => `lib/email/templates/${name}`),
  'lib/pilot/NotificationService.ts',
  'app/api/contact/route.ts',
  'lib/calibration/calibrationAdminAlert.ts',
  'lib/calibration/calibrationResultEmail.ts',
  'lib/services/WebsiteEmailSequenceService.ts',
  'lib/business-os/invites/inviteEmail.ts',
];

const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

/**
 * Comments stripped first, both kinds.
 *
 * These files necessarily DISCUSS the thing they must not contain — this one
 * does too — and a guard that cannot tell an explanation from an instance
 * either fails on its own documentation or forces the documentation out.
 */
const withoutComments = (source: string) =>
  source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('no outgoing email is styled by a stylesheet', () => {
  it.each(SENDERS)('%s', file => {
    expect(withoutComments(read(file))).not.toMatch(/<style[\s>]/i);
  });
});

describe('the templates everyone else builds on', () => {
  const base = read('lib/email/templates/base-template.ts');

  it('styles with attributes, and plenty of them', () => {
    // The reason client-facing mail was never affected. If this ever drops to
    // nothing, the shell has stopped carrying its own appearance.
    expect((base.match(/style="/g) ?? []).length).toBeGreaterThan(20);
  });
});

describe('the two that were fixed', () => {
  const approval = read('lib/pilot/NotificationService.ts');
  const contact = read('app/api/contact/route.ts');

  it('the approval buttons keep their colours inline', () => {
    // Green and red, on the element itself, so the two opposite actions stay
    // distinguishable wherever the mail is opened.
    expect(approval).toMatch(/background: #4CAF50/);
    expect(approval).toMatch(/background: #f44336/);
  });

  it('the gradient header has a solid colour behind it', () => {
    // Outlook and several mobile clients ignore linear-gradient; without the
    // fallback the header went white text on white.
    expect(contact).toMatch(/background: #667eea; background: linear-gradient/);
  });

  it('both declare a viewport, so a phone does not zoom out of them', () => {
    expect(approval).toMatch(/name="viewport"/);
    expect(contact).toMatch(/name="viewport"/);
  });
});

describe('what a stranger types never becomes markup', () => {
  const contact = read('app/api/contact/route.ts');

  it('escapes the name, the address and the message', () => {
    /*
     * The public contact form. Unescaped, a message containing "<" opens a tag
     * the rest of the email lives inside — markup injected into our own inbox,
     * and a plain way for a message to arrive looking broken.
     */
    expect(contact).toMatch(/\$\{escapeHtml\(name\)\}/);
    expect(contact).toMatch(/\$\{escapeHtml\(email\)\}/);
    expect(contact).toMatch(/escapeHtml\(message\)/);
  });

  it('escapes BEFORE turning line breaks into markup', () => {
    // The other order escapes the <br> back into visible text.
    expect(contact).toMatch(/escapeHtml\(message\)\.replace\(\/\\n\/g, '<br>'\)/);
  });
});
