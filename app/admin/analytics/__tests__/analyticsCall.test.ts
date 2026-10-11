/**
 * AI cost & usage: the typed metadata reads and the status words (Admin
 * Layout Standard L-2b, workplan §3.2, §6.1 U-1 to U-5). Pure: no rendering.
 */

import { ANALYTICS_DEFAULT_WINDOW, type AnalyticsFilters } from '../analyticsFilters';
import { callStatus, executionStatusTone, formatLatency, isDrilled, readMeta, type CallMeta } from '../analyticsCall';

const ALL_NULL: CallMeta = {
  model: null,
  provider: null,
  latencyMs: null,
  success: null,
  timestamp: null,
  requestType: null,
  dbCategory: null,
  category: null,
  activityType: null,
  activityName: null,
  activityStep: null,
  workflowStep: null,
  feature: null,
  component: null,
  endpoint: null,
  callId: null,
  userCount: null,
  agentCount: null,
  executionCount: null,
};

describe('readMeta (U-1)', () => {
  it('keeps strings, finite numbers and booleans', () => {
    const meta = readMeta({
      metadata: {
        model: 'gpt-4o',
        provider: 'openai',
        latencyMs: 1234,
        success: false,
        timestamp: '2026-09-03T10:00:00.000Z',
        requestType: 'chat',
        dbCategory: 'agent_execution',
        category: 'execution',
        activityType: 'run',
        activityName: 'Run agent',
        activityStep: 'step 1',
        workflowStep: 'wf 1',
        feature: 'insights',
        component: 'planner',
        endpoint: '/api/x',
        callId: 'call-abc',
        userCount: 2,
        agentCount: 0,
        executionCount: 3,
      },
    });
    expect(meta).toEqual({
      model: 'gpt-4o',
      provider: 'openai',
      latencyMs: 1234,
      success: false,
      timestamp: '2026-09-03T10:00:00.000Z',
      requestType: 'chat',
      dbCategory: 'agent_execution',
      category: 'execution',
      activityType: 'run',
      activityName: 'Run agent',
      activityStep: 'step 1',
      workflowStep: 'wf 1',
      feature: 'insights',
      component: 'planner',
      endpoint: '/api/x',
      callId: 'call-abc',
      userCount: 2,
      agentCount: 0,
      executionCount: 3,
    });
  });

  it.each([
    ['an empty string', ''],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['an object', { a: 1 }],
    ['an array', ['x']],
    ['null', null],
  ])('turns %s into null for every key', (_name, value) => {
    const metadata: Record<string, unknown> = {};
    for (const key of Object.keys(ALL_NULL)) metadata[key] = value;
    expect(readMeta({ metadata })).toEqual(ALL_NULL);
  });

  it('turns the wrong type into null: a number for a string key, a string for a number or boolean key', () => {
    const meta = readMeta({ metadata: { model: 42, latencyMs: '120', success: 'true', userCount: '2' } });
    expect(meta.model).toBeNull();
    expect(meta.latencyMs).toBeNull();
    expect(meta.success).toBeNull();
    expect(meta.userCount).toBeNull();
  });

  it('gives every key null for {} and for a missing metadata', () => {
    expect(readMeta({ metadata: {} })).toEqual(ALL_NULL);
    expect(readMeta({})).toEqual(ALL_NULL);
  });
});

describe('callStatus (U-2)', () => {
  it('true is ok "Succeeded", false is danger "Failed", null is unknown "Unknown" (SA Q-6, M-3)', () => {
    expect(callStatus(true)).toEqual({ tone: 'ok', word: 'Succeeded' });
    expect(callStatus(false)).toEqual({ tone: 'danger', word: 'Failed' });
    expect(callStatus(null)).toEqual({ tone: 'unknown', word: 'Unknown' });
  });
});

describe('executionStatusTone (U-3)', () => {
  it('completed is ok, failed is danger', () => {
    expect(executionStatusTone('completed')).toBe('ok');
    expect(executionStatusTone('failed')).toBe('danger');
  });

  it.each(['running', 'pending', 'cancelled', 'anything'])('%s is info', (status) => {
    expect(executionStatusTone(status)).toBe('info');
  });

  it.each(['', null, undefined])('%p is unknown', (status) => {
    expect(executionStatusTone(status)).toBe('unknown');
  });
});

describe('formatLatency (U-4)', () => {
  it('cell: rounded milliseconds', () => {
    expect(formatLatency(1234.4, 'cell')).toBe('1234ms');
    expect(formatLatency(999, 'cell')).toBe('999ms');
  });

  it('detail: milliseconds under a second, seconds with two decimals from one second', () => {
    expect(formatLatency(999, 'detail')).toBe('999ms');
    expect(formatLatency(1000, 'detail')).toBe('1.00s');
    expect(formatLatency(1234, 'detail')).toBe('1.23s');
  });

  it('null and 0 are an em dash in both (SA S-3)', () => {
    for (const style of ['cell', 'detail'] as const) {
      expect(formatLatency(null, style)).toBe('—');
      expect(formatLatency(0, style)).toBe('—');
    }
  });
});

describe('isDrilled (U-5, F-49)', () => {
  const DEFAULTS: AnalyticsFilters = {
    scope: 'bos',
    window: ANALYTICS_DEFAULT_WINDOW,
    account: '',
    category: 'all',
    groupBy: 'provider',
    provider: '',
    model: '',
    activity: '',
    requestType: '',
    feature: '',
    component: '',
    endpoint: '',
    agent: '',
    execution: '',
  };

  it('is false at the defaults, whatever the scope, window and group by', () => {
    expect(isDrilled(DEFAULTS)).toBe(false);
    expect(isDrilled({ ...DEFAULTS, scope: 'all', groupBy: 'model', window: { kind: 'preset', preset: '7d' } })).toBe(false);
  });

  it.each<[keyof AnalyticsFilters, string]>([
    ['provider', 'openai'],
    ['model', 'gpt-4o'],
    ['activity', 'run'],
    ['requestType', 'chat'],
    ['feature', 'insights'],
    ['component', 'planner'],
    ['endpoint', '/api/x'],
    ['account', '99999999-9999-4999-8999-999999999999'],
    ['agent', '44444444-4444-4444-8444-444444444444'],
    ['execution', '33333333-3333-4333-8333-333333333333'],
    ['category', 'memory'],
  ])('is true for %s alone', (field, value) => {
    expect(isDrilled({ ...DEFAULTS, [field]: value })).toBe(true);
  });
});
