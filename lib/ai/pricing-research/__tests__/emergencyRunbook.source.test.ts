/**
 * Source test for the emergency price runbook (AI model price review slice 6;
 * user decision BQ-1 (a); SA SC6-5, CR-1, CR-5; QA E-4; slice 8 SA RC-4, RC-9).
 *
 * The runbook is the only way a live price changes before slice 8's Apply, and
 * an operator pastes it under pressure. These are the properties that make the
 * pastes safe; a doc edit that drops one fails here. Reads one file: fast.
 */

import * as fs from 'fs';
import * as path from 'path';

import { decisionAnswer } from '../decisionErrors';

const RUNBOOK = 'docs/runbooks/AI_MODEL_PRICE_EMERGENCY_SQL_RUNBOOK.md';
const text = fs.readFileSync(path.join(process.cwd(), RUNBOOK), 'utf8').replace(/\r\n/g, '\n');

/** Every ```sql … ``` block, in order. */
const pastes = [...text.matchAll(/```sql\n([\s\S]*?)```/g)].map((match) => match[1]);
const DO_TAG = '$emergency_price$';

/** Statements of one paste, with the DO body collapsed so its inner `;` do not count. */
function statementsOf(sql: string): string[] {
  const first = sql.indexOf(DO_TAG);
  const last = sql.lastIndexOf(DO_TAG);
  const flat = first >= 0 && last > first ? sql.slice(0, first + DO_TAG.length) + sql.slice(last) : sql;
  return flat
    .split(';')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

describe('emergency price runbook', () => {
  it('has the three pastes: 1a, 1b and the change', () => {
    expect(pastes).toHaveLength(3);
  });

  it('no paste holds a comment', () => {
    for (const sql of pastes) {
      expect(sql).not.toContain('--');
      expect(sql).not.toContain('/*');
    }
  });

  it('the editor problem word appears only as the INSERT INTO keyword, anywhere in the file', () => {
    const hits = [...text.matchAll(/into/gi)].map((match) => text.slice(Math.max(0, (match.index ?? 0) - 7), (match.index ?? 0) + 4));
    expect(hits).toEqual(['INSERT INTO']);
  });

  it('no paste deletes, truncates or overwrites a price', () => {
    for (const sql of pastes) {
      expect(sql).not.toMatch(/(^|[^A-Za-z_])(DELETE|TRUNCATE)([^A-Za-z_]|$)/i);
      expect(sql).not.toMatch(/ON\s+CONFLICT/i);
      expect(sql).not.toMatch(/SET\s+(input|output|cached_input)_cost_per_token/i);
    }
  });

  it('each paste is exactly one unit (BEGIN; LOCK …; DO …; COMMIT; is one unit)', () => {
    const [listing, counts, change] = pastes.map(statementsOf);
    expect(listing).toHaveLength(1);
    expect(counts).toHaveLength(1);
    expect(change).toHaveLength(4);
    expect(change[0]).toBe('BEGIN');
    expect(change[1]).toBe('LOCK TABLE public.ai_model_pricing IN SHARE ROW EXCLUSIVE MODE');
    expect(change[2].startsWith(`DO ${DO_TAG}`)).toBe(true);
    expect(change[3]).toBe('COMMIT');
  });

  it('slice 8 (SA RC-4): paste 2 locks the price table straight after BEGIN, so it serialises with Apply', () => {
    expect(pastes[2].startsWith(['BEGIN;', 'LOCK TABLE public.ai_model_pricing IN SHARE ROW EXCLUSIVE MODE;', ''].join(String.fromCharCode(10)))).toBe(true);
    expect(text).toContain('waits for any in-app Apply to finish');
  });

  it('slice 8 (SA RC-9): documents the emergency stop of Apply and its re-grant', () => {
    expect(text).toContain('`REVOKE EXECUTE ON FUNCTION public.ai_price_apply_lines(uuid, jsonb, jsonb) FROM service_role;`');
    expect(text).toContain('`GRANT EXECUTE ON FUNCTION public.ai_price_apply_lines(uuid, jsonb, jsonb) TO service_role;`');
  });

  it('slice 8 (SA CR8-1): quotes exactly the words the page shows while Apply is switched off', () => {
    const words = decisionAnswer('not_admin_row').error;
    expect(words).toContain('an operator has switched Apply off');
    expect(text).toContain(`the page shows "${words}"`);
  });

  it('paste 1b shows the active row ids next to the count (CR-1)', () => {
    expect(pastes[1]).toContain('AS active_rows_for_model');
    expect(pastes[1]).toContain("string_agg(id::text, ', ')");
    expect(pastes[1]).toContain('AS active_row_ids');
  });

  it('paste 2 converts by * 0.000001, retires by id with a row-count check, and has the 10x check with its override', () => {
    const change = pastes[2];
    expect(change).toContain('v_input_per_1m * 0.000001');
    expect(change).toContain('v_output_per_1m * 0.000001');
    expect(change).toContain('GET DIAGNOSTICS v_changed = ROW_COUNT');
    expect(change).toContain('WHERE id = v_old_id');
    expect(change).toContain("v_confirm_large_change text := 'no'");
    expect(change).toContain("v_confirm_large_change <> 'yes'");
    expect(change).toContain('v_old_input * 10');
    expect(change).toContain('v_old_input * 0.1');
  });

  it('keeps the warning about the 20251030 script', () => {
    expect(text).toContain('supabase/SQL Scripts/20251030_add_missing_models_pricing.sql');
    expect(text).toMatch(/Never run it/);
  });
});
