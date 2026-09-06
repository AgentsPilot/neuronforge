/**
 * The chat allowance.
 *
 * This is the only thing standing between a fixed subscription price and an
 * unbounded LLM bill, so the arithmetic matters in both directions: too loose
 * and the product loses money on its most engaged users; too tight and a paying
 * customer is stopped mid-task by a number nobody warned them about.
 *
 * The warning is tested as carefully as the limit, because a wall that arrives
 * unannounced reads as a broken product rather than a plan boundary.
 */

import { evaluateBudget, type BudgetRow } from '../telemetry/ChatBudget';

const LIMITS = { turnsLimit: 10, tokensLimit: 100_000, resetsAt: '2026-08-28T00:00:00Z' };

const turn = (id: string | null, tokens = 1000): BudgetRow => ({
  session_id: id,
  input_tokens: tokens,
  output_tokens: 0,
});

describe('chat allowance', () => {
  it('counts a question once, however many calls it took', () => {
    // A repair is the planner retrying ITSELF. Charging the user twice would be
    // charging them for our bug.
    const state = evaluateBudget([turn('t1'), turn('t1'), turn('t2')], LIMITS);

    expect(state.turnsUsed).toBe(2);
    expect(state.turnsRemaining).toBe(8);
  });

  it('allows the last question and refuses the one after', () => {
    const nine = Array.from({ length: 9 }, (_, i) => turn(`t${i}`));
    expect(evaluateBudget(nine, LIMITS).allowed).toBe(true);

    const ten = Array.from({ length: 10 }, (_, i) => turn(`t${i}`));
    const spent = evaluateBudget(ten, LIMITS);

    expect(spent.allowed).toBe(false);
    expect(spent.exceeded).toBe('turns');
    expect(spent.turnsRemaining).toBe(0);
  });

  it('warns before the wall, not at it', () => {
    // The whole point: a user who is stopped without warning concludes the
    // product broke. At 8 of 10 they can still finish what they were doing.
    const eight = Array.from({ length: 8 }, (_, i) => turn(`t${i}`));
    const state = evaluateBudget(eight, LIMITS);

    expect(state.allowed).toBe(true);
    expect(state.warn).toBe(true);
    expect(state.turnsRemaining).toBe(2);
  });

  it('does not warn while there is plenty left', () => {
    const state = evaluateBudget([turn('t1'), turn('t2')], LIMITS);

    expect(state.warn).toBe(false);
  });

  it('stops a runaway on tokens even when few questions were asked', () => {
    // The backstop. One Hebrew case in development produced 16,384 output tokens
    // of invalid JSON — ~40x a normal turn. A turn cap alone would wave those
    // through, which is exactly the case that costs real money.
    const state = evaluateBudget([turn('t1', 60_000), turn('t2', 60_000)], LIMITS);

    expect(state.turnsUsed).toBe(2);
    expect(state.allowed).toBe(false);
    expect(state.exceeded).toBe('tokens');
  });

  it('counts tokens from unattributed rows too', () => {
    // Turn ids are for grouping. The tokens were spent regardless, and a ceiling
    // that ignored some of them would not be a ceiling.
    const state = evaluateBudget([turn(null, 99_999), turn('t1', 1)], LIMITS);

    expect(state.tokensUsed).toBe(100_000);
    expect(state.allowed).toBe(false);
  });

  it('names the limit the user was shown when both are breached', () => {
    const rows = Array.from({ length: 10 }, (_, i) => turn(`t${i}`, 20_000));
    const state = evaluateBudget(rows, LIMITS);

    // Both are over, but "questions" is the number on screen, so it is the one
    // worth naming.
    expect(state.exceeded).toBe('turns');
  });

  it('never reports negative remaining', () => {
    const rows = Array.from({ length: 25 }, (_, i) => turn(`t${i}`));
    expect(evaluateBudget(rows, LIMITS).turnsRemaining).toBe(0);
  });

  it('starts a fresh day allowing everything', () => {
    const state = evaluateBudget([], LIMITS);

    expect(state).toMatchObject({
      allowed: true,
      warn: false,
      turnsUsed: 0,
      turnsRemaining: 10,
      tokensUsed: 0,
    });
  });
});
