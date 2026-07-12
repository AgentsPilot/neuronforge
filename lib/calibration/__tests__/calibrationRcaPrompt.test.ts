/**
 * Unit tests for the RCA prompt-builder guardrails (AC-15, FR-24).
 * Proves secret-pattern values are masked and oversized values truncated in the
 * LLM prompt, independent of the LLM call.
 */

import {
  maskSecrets,
  truncateForPrompt,
  redactInputValues,
  buildRcaPrompt,
  type RcaEvidence,
} from '../calibrationRcaPrompt';

describe('maskSecrets', () => {
  it('masks values under secret-implying keys', () => {
    const out = maskSecrets({ api_key: 'abcd1234', password: 'hunter2', normal: 'keep me' }) as Record<string, string>;
    expect(out.api_key).toBe('***MASKED***');
    expect(out.password).toBe('***MASKED***');
    expect(out.normal).toBe('keep me');
  });

  it('masks bearer tokens and provider keys under innocuous keys', () => {
    const out = maskSecrets({
      note: 'Authorization: Bearer abc.def.ghi123',
      hint: 'use sk-abcdef1234567890ABCDEF here',
    }) as Record<string, string>;
    expect(out.note).toContain('***MASKED***');
    expect(out.note).not.toContain('abc.def.ghi123');
    expect(out.hint).toContain('***MASKED***');
  });

  it('masks JWT-shaped and high-entropy tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N';
    const out = maskSecrets({ token_like: jwt }) as Record<string, string>;
    expect(out.token_like).toBe('***MASKED***');
  });

  it('leaves ordinary short strings untouched', () => {
    const out = maskSecrets({ range: 'Sheet1!A1:B10', name: 'Leads' }) as Record<string, string>;
    expect(out.range).toBe('Sheet1!A1:B10');
    expect(out.name).toBe('Leads');
  });
});

describe('truncateForPrompt', () => {
  it('caps oversized strings with a marker', () => {
    const big = 'x'.repeat(5000);
    const out = truncateForPrompt(big, 100) as string;
    expect(out.length).toBeLessThan(200);
    expect(out).toContain('[truncated');
  });

  it('caps oversized arrays', () => {
    const arr = Array.from({ length: 200 }, (_, i) => i);
    const out = truncateForPrompt(arr) as unknown[];
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out[out.length - 1]).toContain('truncated');
  });

  it('recurses into nested objects', () => {
    const out = truncateForPrompt({ a: { b: 'y'.repeat(3000) } }, 50) as { a: { b: string } };
    expect(out.a.b).toContain('[truncated');
  });
});

describe('redactInputValues', () => {
  it('masks then truncates, and passes null through', () => {
    expect(redactInputValues(null)).toBeNull();
    const out = redactInputValues({ secret: 'topsecretvalue', big: 'z'.repeat(5000) }) as Record<string, string>;
    expect(out.secret).toBe('***MASKED***');
    expect(out.big).toContain('[truncated');
  });
});

describe('buildRcaPrompt', () => {
  const evidence: RcaEvidence = {
    agentId: 'a1',
    agentName: 'Leads',
    status: 'needs_review',
    iterations: 2,
    autoFixesApplied: 1,
    stepsCompleted: 3,
    stepsFailed: 1,
    stepsSkipped: 0,
    issuesRemaining: [{ category: 'parameter_error', message: 'bad range' }],
    issuesFixed: [],
    pilotSteps: [{ id: 'step_2', action: 'sheets.read_range' }],
    inputSchema: [{ name: 'range' }],
    enhancedPrompt: 'Read the sheet',
    userPrompt: 'read my sheet',
    aiContext: null,
    inputValues: { api_key: 'sk-shouldbemasked1234567890abcd', range: 'Sheet1' },
  };

  it('produces a system + user message pair', () => {
    const messages = buildRcaPrompt(evidence);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('encodes the 6-step method and strict JSON contract in the system prompt', () => {
    const [system] = buildRcaPrompt(evidence);
    expect(system.content).toContain('EARLIEST failing step');
    expect(system.content).toContain('rootCauseLayer');
    expect(system.content).toContain('SINGLE JSON object');
  });

  it('redacts secret input values inside the user payload (defence in depth)', () => {
    const [, user] = buildRcaPrompt(evidence);
    expect(user.content).toContain('***MASKED***');
    expect(user.content).not.toContain('sk-shouldbemasked1234567890abcd');
    // Non-secret evidence still present.
    expect(user.content).toContain('read_range');
  });
});
