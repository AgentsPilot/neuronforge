/**
 * QA (D5 / SX-5, 2026-10-30): the Remove / Disconnect words and the screens
 * that show them.
 *
 *  - The copy module's English fallback cannot drift from the en dictionary.
 *  - Every refusal line, in every language, has its placeholders filled.
 *  - F-1: `record_not_removed` never says "nothing was changed", in any language.
 *  - Raw server text never reaches the owner.
 *  - Source checks (CRLF-normalised): no `alert` on the Remove / Disconnect
 *    paths, the F-3 red confirm button, the G-8 wording in DangerZonePanel and
 *    the admin deletion copy, and Disconnect never calls Stripe.
 */

import * as fs from 'fs';
import * as path from 'path';

import { en } from '@/lib/business-os/translations/en';
import { he } from '@/lib/business-os/translations/he';
import { es } from '@/lib/business-os/translations/es';
import { PLACEHOLDER_ERASURE_CONTACT } from '@/lib/business-os/supportContact';
import { STRIPE_REMOVE_BUTTON_KEY, refusalLines, removeMessageKey, stripeExitLabel } from '@/components/payments/stripeConnectExitCopy';
import { DELETION_COMMIT_REFUSAL_COPY } from '@/app/admin/users/deletionCopy';
import { blockerCopyKey } from '@/components/business-os/account-deletion/DeleteAccountDrawer';

type Dict = Record<string, string>;
const DICTS: Record<string, Dict> = { en: en as unknown as Dict, he: he as unknown as Dict, es: es as unknown as Dict };
const tOf = (dict: Dict) => (key: string) => dict[key];
const NO_TRANSLATION = () => undefined;

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

// Comments stripped: the U-1 revert note names `config.stripe.delete_account`, which the module does not read today.
const COPY_SOURCE = read('components/payments/stripeConnectExitCopy.ts')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
/** Every `config.stripe.*` key literal the copy module names. */
const COPY_KEYS = [...new Set(COPY_SOURCE.match(/'config\.stripe\.[a-z_.]+'/g)!.map((literal) => literal.slice(1, -1)))]
  // `_uncounted` twins are built from their base at runtime; the literal list already holds them.
  .filter((key) => !key.endsWith('.'));

const ALL_CODES = [
  'check_failed',
  'not_available',
  'client_money_in_flight',
  'client_plans_running',
  'stripe_refused',
  'stripe_unreachable',
  'record_not_removed',
  'not_found',
  'Unauthorized',
  'Failed to remove payment account',
];

/** The "nothing was changed" phrase of each language, read from its generic line. */
const NOTHING_CHANGED: Record<string, string> = { en: 'Nothing was changed', he: 'לא שינינו דבר', es: 'No hemos cambiado nada' };

describe('QA D5 copy: no drift, no gaps', () => {
  it('the copy module names at least the 14 config.stripe D5 keys', () => {
    expect(COPY_KEYS.length).toBeGreaterThanOrEqual(14);
  });

  it.each(Object.keys(DICTS))('%s holds every key the copy module names', (lang) => {
    const missing = COPY_KEYS.filter((key) => typeof DICTS[lang][key] !== 'string' || DICTS[lang][key].trim() === '');
    expect(missing).toEqual([]);
  });

  it('the English fallback equals the en dictionary, key by key (a missing translation reads the same words)', () => {
    for (const key of COPY_KEYS) {
      expect([key, stripeExitLabel(NO_TRANSLATION, key)]).toEqual([key, DICTS.en[key]]);
    }
  });

  it('a translation function that echoes the key back falls to the English, never prints a key', () => {
    expect(stripeExitLabel((key) => key, STRIPE_REMOVE_BUTTON_KEY)).toBe('Remove connection');
  });

  it('the button label is "Remove connection" (U-1 pending)', () => {
    expect(STRIPE_REMOVE_BUTTON_KEY).toBe('config.stripe.remove_connection');
    expect(DICTS.en[STRIPE_REMOVE_BUTTON_KEY]).toBe('Remove connection');
  });

  it.each(Object.keys(NOTHING_CHANGED))('%s: the generic line is the one that says nothing changed (the phrase table is right)', (lang) => {
    expect(DICTS[lang]['config.stripe.refused.generic']).toContain(NOTHING_CHANGED[lang]);
  });
});

describe('QA D5 copy: refusal lines in every language', () => {
  it.each(Object.keys(DICTS))('%s: every code yields filled lines (no {n}, no {support}, no raw key)', (lang) => {
    const t = tOf(DICTS[lang]);
    for (const error of ALL_CODES) {
      for (const blockers of [undefined, [{ code: 'client_plans_running', count: 2 }, { code: 'client_payments_pending' }]]) {
        const lines = refusalLines(t, { success: false, error, blockers });
        expect(lines.length).toBeGreaterThan(0);
        for (const line of lines) {
          expect([lang, error, line]).toEqual([lang, error, expect.not.stringMatching(/\{n\}|\{support\}|config\.stripe\./)]);
        }
      }
    }
  });

  it.each(Object.keys(DICTS))('%s F-1: record_not_removed names the support address and never says nothing changed', (lang) => {
    const [line] = refusalLines(tOf(DICTS[lang]), { success: false, error: 'record_not_removed' });
    expect(line).toContain(PLACEHOLDER_ERASURE_CONTACT);
    expect(line).not.toContain(NOTHING_CHANGED[lang]);
  });

  it.each(Object.keys(DICTS))('%s: not_available carries the support address from supportContact.ts', (lang) => {
    expect(refusalLines(tOf(DICTS[lang]), { error: 'not_available' })[0]).toContain(PLACEHOLDER_ERASURE_CONTACT);
  });

  it('raw server or Stripe text is never shown; it reads as the generic line', () => {
    const t = tOf(DICTS.en);
    for (const body of [{ error: 'No such account: acct_1X; platform ca_123' }, { error: 42 }, 'just a string', null, undefined, { message: 'x' }]) {
      expect(refusalLines(t, body)).toEqual([DICTS.en['config.stripe.refused.generic']]);
    }
  });

  it('a hostile count is never printed (NaN, negative, string)', () => {
    const t = tOf(DICTS.en);
    for (const count of [Number.NaN, -3, '7', 0]) {
      expect(refusalLines(t, { error: 'client_money_in_flight', blockers: [{ code: 'client_plans_running', count }] })).toEqual([
        DICTS.en['config.stripe.refused.client_plans_running_uncounted'],
      ]);
    }
  });

  it('disconnect refused with no blockers still names the plans', () => {
    expect(refusalLines(tOf(DICTS.en), { error: 'client_plans_running' })).toEqual([DICTS.en['config.stripe.refused.client_plans_running_uncounted']]);
  });
});

describe('QA D5 copy: the confirm text matches the account kind (C-9)', () => {
  it.each([
    ['express', 'config.stripe.remove_message_express'],
    ['custom', 'config.stripe.remove_message_express'],
    ['standard', 'config.stripe.remove_message_standard'],
    [null, 'config.stripe.remove_message_standard'],
    [undefined, 'config.stripe.remove_message_standard'],
    ['Express', 'config.stripe.remove_message_standard'],
  ])('%s → %s', (type, key) => {
    expect(removeMessageKey(type as string | null | undefined)).toBe(key);
  });

  it.each(Object.keys(DICTS))('%s: the Standard text never says the account is closed or cannot be undone', (lang) => {
    const standard = DICTS[lang]['config.stripe.remove_message_standard'];
    const express = DICTS[lang]['config.stripe.remove_message_express'];
    expect(standard).not.toEqual(express);
    // The irreversible sentence is Express-only: it is the last sentence of the Express text.
    const lastExpressSentence = express.trim().split(/(?<=\.)\s+/).pop()!;
    expect(standard).not.toContain(lastExpressSentence);
  });
});

describe('QA D5: G-8 wording everywhere it is shown', () => {
  it('the drawer reads the new stripe_linked key for G-8', () => {
    expect(blockerCopyKey({ code: 'stripe_connected' })).toBe('settings.account_delete.blocker.stripe_linked');
  });

  it('DangerZonePanel fallback for stripe_linked equals the en text', () => {
    const source = read('components/business-os/purge/DangerZonePanel.tsx');
    const match = source.match(/'settings\.account_delete\.blocker\.stripe_linked':\s*'([^']+)'/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe(DICTS.en['settings.account_delete.blocker.stripe_linked']);
  });

  it('admin deletionCopy names Remove connection and says Disconnect alone does not clear it', () => {
    expect(DELETION_COMMIT_REFUSAL_COPY.stripe_connected).toContain('Remove connection');
    expect(DELETION_COMMIT_REFUSAL_COPY.stripe_connected).toContain('Disconnect alone does not clear it');
  });
});

/** The body of a `const name = async (...) => { ... };` arrow, by brace counting. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = async`);
  expect(start).toBeGreaterThan(-1);
  const open = source.indexOf('{', source.indexOf('=>', start));
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}

describe('QA D5: the screens', () => {
  const status = read('components/payments/StripeConnectStatus.tsx');
  const config = read('components/business-os/ConfigurationDialog.tsx');

  it('StripeConnectStatus: the Remove path shows an inline refusal, never alert()', () => {
    const body = functionBody(status, 'handleDeleteAccount');
    expect(body).not.toMatch(/\balert\(/);
    expect(body).toContain('setDeleteRefusal(refusalLines(t, result))');
    expect(status).toContain('role="alert"');
  });

  it('StripeConnectStatus F-3: the confirm button is red and no longer uses the missing destructive variant', () => {
    expect(status).not.toContain('variant="destructive"');
    expect(status).toContain('className="!text-white !bg-red-500 hover:!bg-red-600"');
  });

  it.each(['confirmDeleteStripe', 'confirmDisconnectStripe'])('ConfigurationDialog %s: inline refusal, never alert()', (name) => {
    const body = functionBody(config, name);
    expect(body).not.toMatch(/\balert\(/);
    expect(body).toContain('setStripeExitError(refusalLines(t, ');
  });

  it('ConfigurationDialog: the refusal box is an alert that follows the reading direction', () => {
    const box = config.slice(config.indexOf('{stripeExitError && ('), config.indexOf('{stripeExitError && (') + 600);
    expect(box).toContain('role="alert"');
    expect(box).toContain("dir={isRTL ? 'rtl' : 'ltr'}");
  });

  it('ConfigurationDialog: no screen still reads the old Delete Account literal', () => {
    expect(config).not.toContain("|| 'Delete Account'");
    expect(config).not.toContain("t('config.stripe.delete_message')");
  });
});

describe('QA D5: Disconnect never calls Stripe', () => {
  it('the disconnect route imports nothing that reaches Stripe', () => {
    const source = read('app/api/payments/stripe-connect/disconnect/route.ts');
    const imports = source.split('\n').filter((line) => line.startsWith('import '));
    expect(imports.join('\n')).not.toMatch(/StripeService|connectRelease|from 'stripe'|lib\/stripe/);
    expect(source).not.toMatch(/getStripeService|releaseConnectedAccount|accounts\.del|deauthorize/);
  });
});
