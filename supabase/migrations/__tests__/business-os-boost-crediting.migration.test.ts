/**
 * Guard over the Business OS boost crediting migration (credits boost slice 2b;
 * workplan BUSINESS_OS_CREDITS_BOOST_SLICE_2B_WORKPLAN.md §3, §6, §7.1 and SA
 * conditions C-1 to C-6, plus the parent's C-8).
 *
 * WHY A TEST OVER SQL TEXT. Jest cannot run PL/pgSQL and there is no branch
 * database. The user pastes the migration on PROD, then runs the shared checker
 * `scripts/check-bos-boost-purchases-migration.sql` and the write probe
 * `scripts/probe-bos-boost-crediting-migration.sql`. What the files alone can
 * prove is pinned here: paste safety, the auth rule (no PROD script writes
 * auth.users), the three INVOKER functions and their single grant, the credit
 * function's step order and cross-checks, that only the lot call is caught
 * (C-1), that transitions never touch a lot (C-8 d), that the receipt is
 * fill-only (C-8 a), and that 11a's and 2a's objects are never redefined.
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const MIGRATION = join(MIGRATIONS_DIR, '20261031_business_os_boost_crediting.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261031_business_os_boost_crediting_rollback.sql');
const PROBE = join(ROOT, 'scripts', 'probe-bos-boost-crediting-migration.sql');
const CHECKER = join(ROOT, 'scripts', 'check-bos-boost-purchases-migration.sql');
const WORKPLAN = join(ROOT, 'docs', 'workplans', 'BUSINESS_OS_CREDITS_BOOST_SLICE_2B_WORKPLAN.md');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const flat = migration.replace(/\s+/g, ' ');
const probe = read(PROBE);
const checker = read(CHECKER);
const rollbackFlat = read(ROLLBACK).replace(/\s+/g, ' ').trim();

const FUNCTIONS = {
  credit: { name: 'business_os_credit_boost_purchase', tag: 'credit_purchase', signature: 'uuid, text, text, integer, integer, integer, text, boolean' },
  transition: { name: 'business_os_transition_boost_purchase', tag: 'transition_purchase', signature: 'uuid, text, text, integer, text, text' },
  receipt: { name: 'business_os_record_boost_receipt', tag: 'record_receipt', signature: 'uuid, text, text' },
} as const;

const UPDATE_COLUMNS_2B = [
  'stripe_payment_intent_id', 'stripe_charge_id', 'receipt_url', 'amount_subtotal_minor', 'amount_tax_minor', 'amount_total_minor',
  'amount_refunded_minor', 'stripe_dispute_id', 'flag_reason', 'lot_id', 'paid_at',
];

function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

function functionText(name: string, tag: string): string {
  const start = migration.indexOf(`CREATE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const close = migration.indexOf(`$${tag}$;`, start);
  expect(close).toBeGreaterThan(start);
  return migration.slice(start, close + tag.length + 3);
}

function functionBody(sql: string, tag: string): string {
  const open = `AS $${tag}$`;
  const start = sql.indexOf(open);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(`$${tag}$;`, start + open.length);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start + open.length, end);
}

/** Index of `needle` in `body`, asserting it is present. */
function at(body: string, needle: string): number {
  const index = body.indexOf(needle);
  expect({ needle, found: index >= 0 }).toEqual({ needle, found: true });
  return index;
}

const creditBody = functionBody(migration, FUNCTIONS.credit.tag);
const transitionBody = functionBody(migration, FUNCTIONS.transition.tag);
const receiptBody = functionBody(migration, FUNCTIONS.receipt.tag);
const md5 = (text: string) => createHash('md5').update(text, 'utf8').digest('hex');

describe('SQL-editor safety and the auth rule (migration, rollback, probe)', () => {
  const files: Array<[string, string]> = [
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['probe', PROBE],
  ];

  it.each(files)('%s exists, has no comment, and holds only letters, digits, underscores and spaces in literals', (_name, file) => {
    expect(existsSync(file)).toBe(true);
    const text = read(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
    for (const literal of literalsOf(text)) {
      expect({ literal, ok: /^[A-Za-z0-9_ ]*$/.test(literal) }).toEqual({ literal, ok: true });
      expect(literal).not.toMatch(/\binto\b/i);
    }
  });

  it.each(files)('%s uses no single-letter alias and names no Pilot-Credit table', (_name, file) => {
    const text = read(file);
    expect(text).not.toMatch(/\b(?:FROM|JOIN)\s+[\w.]+\s+(?:AS\s+)?[a-z]\b(?!\w)/i);
    for (const table of ['token_usage', 'user_subscriptions', 'credit_transactions', 'billing_events']) expect(text).not.toContain(table);
  });

  it.each(files)('%s never writes auth.users (user decision 2026-10-06)', (_name, file) => {
    expect(read(file)).not.toMatch(/\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE|TRUNCATE)\s+auth\.users\b/i);
  });

  it('colons and underscores inside prefixes are spelled chr(58) and chr(95)', () => {
    for (const text of [migration, probe]) {
      expect(text).not.toMatch(/'(?:boost|business_os_boost_cap|business_os_credit_lots):/);
      expect(text).not.toMatch(/'(?:cs|pi|ch|py|dp|du)_/);
    }
  });
});

describe('structure: three INVOKER functions and one grant, nothing redefined (G-1, G-2)', () => {
  it('one transaction with a lock timeout; exactly three CREATE FUNCTION; no table, alter, definer, trigger or IF NOT EXISTS', () => {
    expect(flat.trim().startsWith("BEGIN; SET LOCAL lock_timeout = '5s';")).toBe(true);
    expect(flat.trim().endsWith('COMMIT;')).toBe(true);
    expect(flat.match(/CREATE FUNCTION/g)).toHaveLength(3);
    expect(flat.match(/SECURITY INVOKER/g)).toHaveLength(3);
    expect(flat).not.toMatch(/CREATE TABLE|ALTER TABLE|SECURITY DEFINER|\bTRIGGER\b|CREATE [A-Z ]*IF NOT EXISTS|OR REPLACE|\bDROP\b/i);
  });

  it('the only grants: one 11-column UPDATE on purchases and EXECUTE to service_role on each function', () => {
    const match = flat.match(/GRANT UPDATE \(([^)]*)\) ON TABLE public\.business_os_boost_purchases TO service_role;/);
    expect(match?.[1].split(',').map((column) => column.trim())).toEqual(UPDATE_COLUMNS_2B);
    for (const column of ['user_id', 'livemode', 'price_minor', 'credits_base', 'credits_bonus', 'credits_total', 'package_id', 'retail_version', 'credit_value_version']) {
      expect(UPDATE_COLUMNS_2B).not.toContain(column);
    }
    expect(flat.match(/\bGRANT\b/g)).toHaveLength(4);
    for (const fn of Object.values(FUNCTIONS)) {
      for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
        expect(flat).toContain(`REVOKE ALL ON FUNCTION public.${fn.name}(${fn.signature}) FROM ${role};`);
      }
      expect(flat).toContain(`GRANT EXECUTE ON FUNCTION public.${fn.name}(${fn.signature}) TO service_role;`);
    }
  });

  it('G-3: no function takes a user id; each returns the account as out_user_id', () => {
    for (const fn of Object.values(FUNCTIONS)) {
      const head = functionText(fn.name, fn.tag).slice(0, functionText(fn.name, fn.tag).indexOf('LANGUAGE'));
      expect(head).not.toContain('p_user_id');
      expect(head).toContain('out_user_id uuid');
      expect(functionText(fn.name, fn.tag).replace(/\s+/g, ' ')).toContain("LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''");
    }
  });

  it("G-1: the lots are named only in the credit function's one record_credit_lot call and one read-only check; no 2a function is redefined", () => {
    const lines = migration.split('\n').filter((line) => /business_os_(?:record_|reverse_)?credit_lot/.test(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('public.business_os_record_credit_lot(');
    expect(lines[1].trim()).toBe('FROM public.business_os_credit_lots AS lot_row');
    expect(flat).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.business_os_credit_lot/);
    for (const name of ['reserve_boost_purchase', 'attach_boost_checkout', 'abandon_boost_purchase', 'set_boost_cap_override', 'end_boost_cap_override', 'business_os_credit_charges', 'record_credit_charge']) {
      expect(migration).not.toContain(name);
    }
  });
});

describe('the credit function (§3.1, C-1, C-2, C-6, C-8 b and c, Q-5, Q-6)', () => {
  it('runs its steps in order: arguments, row lock, already credited, status gate, cross-checks, lot, paid', () => {
    const order = [
      at(creditBody, "USING ERRCODE = '22004'"),
      at(creditBody, "USING ERRCODE = '22023'"),
      at(creditBody, 'FOR UPDATE'),
      at(creditBody, "out_status := 'not_found'"),
      at(creditBody, "out_status := 'already_credited'"),
      at(creditBody, "IF v_status NOT IN ('pending', 'awaiting_payment', 'expired') THEN"),
      at(creditBody, "v_flag := 'no_session'"),
      at(creditBody, "v_flag := 'session_mismatch'"),
      at(creditBody, "v_flag := 'payment_intent_mismatch'"),
      at(creditBody, "v_flag := 'livemode_mismatch'"),
      at(creditBody, "v_flag := 'currency_mismatch'"),
      at(creditBody, "v_flag := 'amount_mismatch'"),
      at(creditBody, "v_flag := 'total_mismatch'"),
      at(creditBody, "v_flag := 'payment_intent_reused'"),
      at(creditBody, "v_flag := 'account_deleted'"),
      at(creditBody, 'public.business_os_record_credit_lot('),
      at(creditBody, "SET status = 'flagged_mismatch'"),
      at(creditBody, "SET status = 'paid'"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('calls the lot function with the boost shape: source, key boost plus the stored session, source_ref, actor, no admin or reason', () => {
    expect(creditBody).toContain(
      "public.business_os_record_credit_lot(v_user, 'boost_purchase', v_base, v_bonus, v_credit_value_version, NULL, 'boost' || chr(58) || v_session, p_purchase_id, 'stripe_webhook', NULL, NULL)"
    );
  });

  it('C-1: only the lot call is wrapped, and a unique violation there flags lot_key_conflict instead of raising', () => {
    // The inner block only (four-space indent); the function's own BEGIN is at column 0.
    const blocks = [...creditBody.matchAll(/\n {4}BEGIN\n([\s\S]*?)\n {4}EXCEPTION WHEN (\w+) THEN\n([\s\S]*?)\n {4}END;/g)];
    expect(blocks).toHaveLength(1);
    const [, wrapped, condition, handler] = blocks[0];
    expect(wrapped.trim().startsWith('SELECT lot_result.out_recorded, lot_result.out_lot_id')).toBe(true);
    expect(wrapped).toContain('public.business_os_record_credit_lot(');
    expect(wrapped.match(/;/g)).toHaveLength(1);
    expect(condition).toBe('unique_violation');
    expect(handler.trim()).toBe("v_flag := 'lot_key_conflict';");
    expect(creditBody.match(/EXCEPTION WHEN/g)).toHaveLength(1);
  });

  it('C-8 b: a mismatch returns normally; the only RAISEs are argument errors and a missing lot id', () => {
    const raises = [...creditBody.matchAll(/RAISE EXCEPTION '[^']*' USING ERRCODE = '(\w+)'/g)].map((match) => match[1]);
    expect(raises).toEqual(['22004', '22023', 'XX000']);
    const flaggedPath = creditBody.slice(creditBody.indexOf('IF v_flag IS NOT NULL THEN'), creditBody.indexOf('IF v_lot_id IS NULL THEN'));
    expect(flaggedPath).toContain("out_status := 'mismatch'");
    expect(flaggedPath).toContain('RETURN;');
    expect(flaggedPath).not.toContain('RAISE');
  });

  it('QA2b-D2: an already-recorded lot is linked only if it is this purchase\'s own lot, otherwise lot_key_conflict', () => {
    const check = creditBody.slice(creditBody.indexOf('IF v_flag IS NULL AND v_recorded IS FALSE AND NOT EXISTS ('), creditBody.indexOf('IF v_flag IS NOT NULL THEN'));
    for (const clause of [
      'WHERE lot_row.id = v_lot_id',
      "AND lot_row.source = 'boost_purchase'",
      'AND lot_row.source_ref = p_purchase_id',
      'AND lot_row.user_id = v_user',
      'AND lot_row.credits_base = v_base',
      'AND lot_row.credits_bonus = v_bonus',
      'AND lot_row.credits_granted = v_credits_total',
    ]) {
      expect(check).toContain(clause);
    }
    expect(check).toContain("v_flag := 'lot_key_conflict'");
    expect(creditBody.indexOf('IF v_flag IS NULL AND v_recorded IS FALSE')).toBeGreaterThan(creditBody.indexOf('EXCEPTION WHEN unique_violation'));
  });

  it('C-2: the currency is compared after upper and btrim', () => {
    expect(creditBody).toContain('ELSIF upper(btrim(p_currency)) <> v_currency THEN');
  });

  it('C-6: reused means held by another purchase with a different id; a different stored intent is payment_intent_mismatch', () => {
    expect(creditBody).toContain('WHERE other_row.stripe_payment_intent_id = p_payment_intent_id\n      AND other_row.id <> p_purchase_id');
    expect(transitionBody).toContain('other_row.stripe_payment_intent_id = p_payment_intent_id AND other_row.id <> p_purchase_id');
    expect(creditBody).toContain('ELSIF v_intent IS NOT NULL AND v_intent <> p_payment_intent_id THEN');
  });

  it('a flagged row keeps a reused or conflicting intent out of the UNIQUE key', () => {
    expect(creditBody).toContain('stripe_payment_intent_id = COALESCE(purchase_row.stripe_payment_intent_id, (CASE WHEN v_intent_held_elsewhere THEN NULL ELSE p_payment_intent_id END))');
  });

  it('every flag code fits the 64-character flag_reason check', () => {
    for (const code of literalsOf(creditBody).filter((literal) => /^[a-z]+(?:_[a-z]+)+$/.test(literal))) {
      expect(code.length).toBeLessThanOrEqual(64);
    }
  });

  it('the paid update writes the lot id the lot function returned, after it, and only there', () => {
    expect(creditBody.indexOf('lot_id = v_lot_id')).toBeGreaterThan(creditBody.indexOf('public.business_os_record_credit_lot('));
    expect(migration.match(/\blot_id = /g)).toHaveLength(1);
    expect(migration.match(/\bpaid_at = /g)).toHaveLength(1);
  });
});

describe('the transition function (§3.0, §3.2, C-3, C-4, C-8 d)', () => {
  it('takes exactly the nine targets and never paid directly', () => {
    expect(transitionBody).toContain(
      "p_to_status NOT IN ('awaiting_payment', 'failed', 'expired', 'flagged_mismatch', 'partially_refunded', 'refunded', 'disputed', 'dispute_won', 'dispute_lost')"
    );
  });

  it('C-8 d: never writes lot_id, paid_at or any lot table', () => {
    expect(transitionBody).not.toMatch(/lot_id|paid_at|business_os_credit_lot/);
  });

  it('C-3 a: dispute won restores the status from the refunded amount', () => {
    const won = transitionBody.slice(transitionBody.lastIndexOf('IF v_refunded = 0 THEN'));
    expect(won).toContain("v_target := 'paid'");
    expect(won).toContain("ELSIF v_refunded >= v_total THEN\n      v_target := 'refunded'");
    expect(won).toContain("v_target := 'partially_refunded'");
  });

  it('C-3 b and C-4: a refund while disputed, lost or flagged records the amount without a status change', () => {
    const recordOnly = transitionBody.slice(
      transitionBody.indexOf("ELSIF v_from IN ('disputed', 'dispute_lost', 'flagged_mismatch') THEN"),
      transitionBody.indexOf("out_status := 'recorded'")
    );
    expect(recordOnly).toContain('SET amount_refunded_minor = p_amount_refunded_minor, updated_at = now()');
    expect(recordOnly).not.toMatch(/SET status/);
    expect(transitionBody).toContain('SET stripe_dispute_id = p_dispute_id, updated_at = now()');
  });

  it('refunds are monotonic and never exceed the total (stale and not_allowed, never a CHECK error)', () => {
    expect(transitionBody).toContain("ELSIF p_amount_refunded_minor < v_refunded THEN\n      out_status := 'stale'");
    expect(transitionBody).toContain("ELSIF v_total IS NOT NULL AND p_amount_refunded_minor > v_total THEN\n      out_status := 'not_allowed'");
    expect(transitionBody).toContain("ELSIF v_from = 'refunded' AND p_to_status = 'partially_refunded' THEN\n      out_status := 'not_allowed'");
    // QA2b-D1: a lower cumulative refund is stale before the refunded-to-partial rule.
    expect(transitionBody.indexOf('ELSIF p_amount_refunded_minor < v_refunded THEN')).toBeLessThan(
      transitionBody.indexOf("ELSIF v_from = 'refunded' AND p_to_status = 'partially_refunded' THEN")
    );
  });

  it('answers only the seven outcomes', () => {
    const outcomes = new Set([...transitionBody.matchAll(/out_status := '(\w+)'/g)].map((match) => match[1]));
    expect([...outcomes].sort()).toEqual(['already', 'mismatch', 'not_allowed', 'not_found', 'recorded', 'stale', 'transitioned']);
  });
});

describe('the receipt function (§3.3, C-8 a)', () => {
  it('fills only empty fields, never changes the status, and refuses unpaid rows', () => {
    expect(receiptBody).toContain('SET stripe_charge_id = COALESCE(purchase_row.stripe_charge_id, p_charge_id),');
    expect(receiptBody).toContain('receipt_url = COALESCE(purchase_row.receipt_url, p_receipt_url),');
    expect(receiptBody).not.toMatch(/SET status|status =/);
    expect(receiptBody).toContain("IF v_status NOT IN ('paid', 'partially_refunded', 'refunded', 'disputed', 'dispute_lost') THEN\n    out_status := 'not_paid'");
    expect(receiptBody.indexOf("out_status := 'conflict'")).toBeLessThan(receiptBody.indexOf('UPDATE public.business_os_boost_purchases'));
  });
});

describe('the checker is the post-2b state, and its baseline md5s match (§6.2, G-1)', () => {
  it('names the three new functions with their exact argument names, and counts eight functions and nineteen updatable columns', () => {
    for (const fn of Object.values(FUNCTIONS)) expect(checker).toContain(`'${fn.name}'`);
    expect(checker).toContain("'p_purchase_id p_session_id p_payment_intent_id p_amount_subtotal p_amount_tax p_amount_total p_currency p_livemode out_status out_user_id out_lot_id out_flag_reason'");
    expect(checker).toContain('function_summary.total = 8');
    expect(checker).toContain('column_summary.service_updatable = 19');
  });

  it('B7 72 is PASS or FAIL and B7 74 proves every paid purchase has exactly its own lot', () => {
    expect(checker).toContain("SELECT 72, 'B7 every boost lot belongs to a purchase',\n         CASE WHEN integrity_summary.orphan_boost_lots = 0 THEN 'PASS' ELSE 'FAIL' END");
    expect(checker).toContain("AND lot_row.idempotency_key = ('boost' || chr(58) || purchase_row.stripe_checkout_session_id)");
    expect(checker).toContain("SELECT 74, 'B7 every paid purchase has exactly its own lot'");
  });

  it('B8 holds the md5 of the five 2a function bodies, and the workplan lists them for the pre-check', () => {
    const boost2a = read(join(MIGRATIONS_DIR, '20261030_business_os_boost_purchases.sql')).replace(/\r/g, '');
    const workplan = read(WORKPLAN);
    for (const [name, tag] of [
      ['business_os_reserve_boost_purchase', 'reserve_purchase'],
      ['business_os_attach_boost_checkout', 'attach_checkout'],
      ['business_os_abandon_boost_purchase', 'abandon_purchase'],
      ['business_os_set_boost_cap_override', 'set_cap_override'],
      ['business_os_end_boost_cap_override', 'end_cap_override'],
    ]) {
      const hash = md5(functionBody(boost2a, tag));
      expect(checker).toContain(`pg_proc.proname = '${name}' AND md5(replace(pg_proc.prosrc, chr(13), '')) = '${hash}'`);
      expect(workplan).toContain(hash);
    }
  });
});

describe('the probe (§6.3)', () => {
  it('is one DO block that always rolls back, with its guards before any role switch', () => {
    expect(probe.trim().startsWith('DO $probe$')).toBe(true);
    expect(probe.trim().endsWith('$probe$;')).toBe(true);
    const firstSwitch = probe.indexOf('SET LOCAL ROLE');
    for (const guard of ['replace PASTE_YOUR_OWN_USER_ID_HERE', 'not a valid user id', 'this session is read only', 'not an account on this database', 'has no Business OS plan row']) {
      const index = probe.indexOf(guard);
      expect(index).toBeGreaterThan(0);
      expect(index).toBeLessThan(firstSwitch);
    }
  });

  it('C-5: sets its own cap override before the first reservation', () => {
    const override = probe.indexOf("PERFORM public.business_os_set_boost_cap_override(v_owner, 1000000, 'USD',");
    expect(override).toBeGreaterThan(probe.indexOf('SET LOCAL ROLE service_role;'));
    expect(override).toBeLessThan(probe.indexOf('business_os_reserve_boost_purchase('));
  });

  it('has every id P00 to P14', () => {
    for (let id = 0; id <= 14; id += 1) expect(probe).toContain(`'P${String(id).padStart(2, '0')} `);
  });

  it('C-2: P01 credits with usd in lower case; C-1: P07 expects lot_key_conflict without an exception', () => {
    expect(probe).toContain("business_os_credit_boost_purchase(v_one_id, v_one_session, v_one_intent, 2500, 0, 2500, 'usd', false)");
    const p07 = probe.slice(probe.indexOf("'P06 PASS"), probe.indexOf("'P07 PASS"));
    expect(p07).toContain("v_c.out_flag_reason = 'lot_key_conflict'");
  });

  it('P03 covers every cross-check code including payment_intent_mismatch and payment_intent_reused', () => {
    const p03 = probe.slice(probe.indexOf("'P02 PASS"), probe.indexOf("'P03 PASS"));
    for (const code of ['session_mismatch', 'payment_intent_mismatch', 'livemode_mismatch', 'currency_mismatch', 'amount_mismatch', 'total_mismatch', 'payment_intent_reused']) {
      expect(p03).toContain(`'${code}'`);
    }
  });

  it('C-3: P08 runs both orders and checks the restored status', () => {
    const p08 = probe.slice(probe.indexOf("'P07 PASS"), probe.indexOf("'P08 PASS"));
    expect(p08).toContain("v_row.status <> 'partially_refunded'");
    expect(p08).toContain("v_row.status <> 'refunded'");
    expect(p08).toContain("' refund while disputed '");
    expect(p08).toContain("' refund a flagged row '");
    // QA R-1 and R-3.
    expect(p08).toContain("' late lower partial after full '");
    expect(p08).toContain("' lower refund while disputed '");
    expect(p08).toContain("' over total while disputed '");
  });

  it('QA R-2, R-4, R-5: a same-credit foreign lot, a URL-only receipt fill, and the hidden 2b columns', () => {
    expect(probe).toContain("'P07b PASS a lot with the same key and credits but another purchase as its source is not linked and flags lot key conflict'");
    expect(probe).toContain("PERFORM public.business_os_record_credit_lot(v_owner, 'boost_purchase', 12500, 1250, 1, NULL, 'boost' || chr(58) || v_session, gen_random_uuid(), 'stripe_webhook', NULL, NULL);");
    expect(probe).toContain("' url only fill '");
    const p11 = probe.slice(probe.indexOf('SET LOCAL ROLE authenticated;'), probe.indexOf("'P11 PASS"));
    expect(p11).toContain('SELECT purchase_row.stripe_dispute_id INTO');
    expect(p11).toContain('SELECT purchase_row.amount_subtotal_minor INTO');
  });
});

describe('the rollback (§6.4)', () => {
  it('refuses once a purchase holds a lot, then drops only the three functions and revokes only the 2b grant', () => {
    expect(rollbackFlat).not.toMatch(/DROP TABLE|DELETE|UPDATE public|TRUNCATE/);
    const refusal = rollbackFlat.indexOf('ROLLBACK REFUSED');
    expect(refusal).toBeGreaterThan(0);
    for (const fn of Object.values(FUNCTIONS)) {
      const drop = rollbackFlat.indexOf(`DROP FUNCTION public.${fn.name}(${fn.signature});`);
      expect(drop).toBeGreaterThan(refusal);
    }
    expect(rollbackFlat.match(/DROP /g)).toHaveLength(3);
    expect(rollbackFlat).toContain(`REVOKE UPDATE (${UPDATE_COLUMNS_2B.join(', ')}) ON TABLE public.business_os_boost_purchases FROM service_role;`);
    expect(rollbackFlat).toContain('WHERE purchase_row.lot_id IS NOT NULL');
  });
});
