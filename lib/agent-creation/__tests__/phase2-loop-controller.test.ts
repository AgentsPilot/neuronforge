/**
 * Unit tests for the Phase 2 loop controller (pure state machine).
 *
 * Coverage:
 *   - both termination reasons (`phase2_done`, `cap_hit`) reachable
 *   - cap boundary: up to MAX_ITERATIONS (20) questions inclusive; the cap fires
 *     once iteration_count == MAX_ITERATIONS, regardless of LLM output
 *   - degraded passthrough (Zod failure) returns pass_through_degraded WITHOUT
 *     fabricating a question
 *   - disclosure banner copy is locked to the exported constant (SA Comment 3)
 *   - controller is pure: same input → same output, no Date.now / side effects
 *
 * NOTE (E3, 2026-05-29): the inter-question hint was moved out of this controller
 * to client-side generation, so there are no `inline_hint` / `INLINE_HINTS`
 * assertions here anymore.
 */

import {
  step,
  Phase2StepInput,
  INITIAL_LOOP_STATE,
  MAX_ITERATIONS,
  DISCLOSURE_BANNER,
} from '@/lib/agent-creation/phase2-loop-controller';

function input(overrides: Partial<Phase2StepInput> = {}): Phase2StepInput {
  return {
    state: { iteration_count: 0 },
    payload_valid: true,
    llm_question: 'Where is the data stored?',
    llm_phase2_done: false,
    ...overrides,
  };
}

describe('phase2-loop-controller — continue path', () => {
  it('advances iteration_count by 1 on a valid continue turn', () => {
    const result = step(input({ state: { iteration_count: 0 } }));
    expect(result.decision).toBe('continue');
    expect(result.next_state.iteration_count).toBe(1);
  });

  it('emits the LLM question and phase2_done=false on continue', () => {
    const result = step(
      input({
        state: { iteration_count: 1 },
        llm_question: 'Anything else?',
        llm_phase2_done: false,
      })
    );
    expect(result.response.question).toBe('Anything else?');
    expect(result.response.phase2_done).toBe(false);
    expect(result.response.termination_reason).toBeUndefined();
  });
});

describe('phase2-loop-controller — termination: phase2_done', () => {
  it('terminates as phase2_done when LLM emits phase2_done=true', () => {
    const result = step(
      input({
        state: { iteration_count: 2 },
        llm_question: null,
        llm_phase2_done: true,
      })
    );
    expect(result.decision).toBe('terminate');
    if (result.decision === 'terminate') {
      expect(result.termination_reason).toBe('phase2_done');
    }
    expect(result.response.question).toBeNull();
    expect(result.response.phase2_done).toBe(true);
    expect(result.response.termination_reason).toBe('phase2_done');
    // No disclosure banner on phase2_done — only on cap_hit.
    expect(result.response.disclosure_banner).toBeUndefined();
  });

  it('still advances iteration_count on terminate (audit-trail visibility)', () => {
    const result = step(
      input({
        state: { iteration_count: 3 },
        llm_question: null,
        llm_phase2_done: true,
      })
    );
    expect(result.next_state.iteration_count).toBe(4);
  });
});

describe('phase2-loop-controller — termination: cap_hit', () => {
  it('terminates as cap_hit once MAX_ITERATIONS questions have been asked', () => {
    // iteration_count == MAX_ITERATIONS (20) means 20 questions were already
    // asked, so this turn caps before a 21st. Up to 20 questions inclusive.
    const result = step(
      input({
        state: { iteration_count: MAX_ITERATIONS },
        llm_question: 'still asking?',
        llm_phase2_done: false,
      })
    );
    expect(result.decision).toBe('terminate');
    if (result.decision === 'terminate') {
      expect(result.termination_reason).toBe('cap_hit');
    }
    expect(result.response.question).toBeNull();
    expect(result.response.phase2_done).toBe(true);
    expect(result.response.termination_reason).toBe('cap_hit');
    expect(result.response.disclosure_banner).toBe(DISCLOSURE_BANNER);
  });

  it('cap fires regardless of LLM output (LLM says phase2_done=false)', () => {
    const result = step(
      input({
        state: { iteration_count: MAX_ITERATIONS },
        llm_question: 'something',
        llm_phase2_done: false,
      })
    );
    expect(result.decision).toBe('terminate');
    if (result.decision === 'terminate') {
      expect(result.termination_reason).toBe('cap_hit');
    }
  });

  it('cap fires regardless of LLM output (Zod-invalid payload)', () => {
    // SA Comment 2 / FR4.11 — degraded passthrough does NOT skip the cap.
    const result = step(
      input({
        state: { iteration_count: MAX_ITERATIONS },
        payload_valid: false,
        llm_question: undefined,
        llm_phase2_done: undefined,
      })
    );
    expect(result.decision).toBe('terminate');
    if (result.decision === 'terminate') {
      expect(result.termination_reason).toBe('cap_hit');
    }
  });

  it('does NOT cap at iteration_count = MAX_ITERATIONS - 1 (asks the MAX_ITERATIONS-th question)', () => {
    // MAX_ITERATIONS-1 questions asked so far → this turn asks the last allowed one
    // (next_state = MAX_ITERATIONS) and does NOT cap. The cap fires on the NEXT turn.
    const result = step(
      input({
        state: { iteration_count: MAX_ITERATIONS - 1 },
        llm_question: 'still going',
        llm_phase2_done: false,
      })
    );
    expect(result.decision).toBe('continue');
    expect(result.next_state.iteration_count).toBe(MAX_ITERATIONS);
  });
});

describe('phase2-loop-controller — degraded passthrough', () => {
  it('returns pass_through_degraded when payload_valid=false', () => {
    const result = step(
      input({
        state: { iteration_count: 1 },
        payload_valid: false,
        llm_question: undefined,
        llm_phase2_done: undefined,
      })
    );
    expect(result.decision).toBe('pass_through_degraded');
  });

  it('still advances iteration_count on degraded passthrough (so cap eventually fires)', () => {
    const result = step(
      input({
        state: { iteration_count: 2 },
        payload_valid: false,
        llm_question: undefined,
        llm_phase2_done: undefined,
      })
    );
    expect(result.next_state.iteration_count).toBe(3);
  });

  it('does NOT fabricate a synthetic question on degraded passthrough', () => {
    // FR4.11 / SA Comment 2: server MUST NOT invent question text. The
    // response carries `null` / `false` when fields are missing.
    const result = step(
      input({
        state: { iteration_count: 1 },
        payload_valid: false,
        llm_question: undefined,
        llm_phase2_done: undefined,
      })
    );
    expect(result.response.question).toBeNull();
    expect(result.response.phase2_done).toBe(false);
  });

  it('passes through whatever LLM emitted when fields are partial', () => {
    const result = step(
      input({
        state: { iteration_count: 1 },
        payload_valid: false,
        llm_question: 'partial question',
        llm_phase2_done: undefined,
      })
    );
    expect(result.response.question).toBe('partial question');
    expect(result.response.phase2_done).toBe(false);
  });
});

describe('phase2-loop-controller — purity', () => {
  it('returns the same output for the same input (no Date.now / no side effects)', () => {
    const i: Phase2StepInput = {
      state: { iteration_count: 4 },
      payload_valid: true,
      llm_question: 'sample',
      llm_phase2_done: false,
    };
    const a = step({ ...i, state: { ...i.state } });
    const b = step({ ...i, state: { ...i.state } });
    expect(a).toEqual(b);
  });

  it('does not mutate the input state', () => {
    const original = { iteration_count: 5 };
    step({
      state: original,
      payload_valid: true,
      llm_question: 'x',
      llm_phase2_done: false,
    });
    expect(original.iteration_count).toBe(5);
  });
});

describe('phase2-loop-controller — disclosure banner & constants', () => {
  it('exports the exact disclosure banner copy from FR5.13', () => {
    // SA Comment 3 — the banner copy is locked. Any future change to this
    // string requires updating the requirement MD.
    expect(DISCLOSURE_BANNER).toBe(
      'Proceeding with what we have — you can refine after the agent is created.'
    );
  });

  it('disclosure banner copy does NOT mention the cap or any number', () => {
    expect(DISCLOSURE_BANNER).not.toMatch(/\b10\b/);
    expect(DISCLOSURE_BANNER.toLowerCase()).not.toContain('cap');
    expect(DISCLOSURE_BANNER.toLowerCase()).not.toContain('limit');
    expect(DISCLOSURE_BANNER.toLowerCase()).not.toContain('iteration');
  });

  it('MAX_ITERATIONS is 20 — a pure runaway backstop (Part 5, raised 10 → 20; supersedes FR5.12)', () => {
    expect(MAX_ITERATIONS).toBe(20);
  });

  it('INITIAL_LOOP_STATE.iteration_count is 0', () => {
    expect(INITIAL_LOOP_STATE.iteration_count).toBe(0);
  });
});
