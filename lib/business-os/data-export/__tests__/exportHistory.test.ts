/**
 * assembleExportHistory (module export MX-1b, workplan §5, T-5; SA C-4).
 * Pure: the order is the requests' own, module lines follow each request's
 * `modules` array, and the output never depends on the job rows' order.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  assembleExportHistory,
  type ExportHistoryJobInput,
  type ExportHistoryRequestInput,
} from '../exportHistory';

const R = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const J = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`;
const T1 = '2026-10-27T10:00:00.000Z';
const T2 = '2026-10-26T10:00:00.000Z';

const req = (n: number, modules: string[], requestedAt = T1, origin: 'owner' | 'admin' = 'owner'): ExportHistoryRequestInput => ({
  id: R(n),
  origin,
  modules,
  requestedAt,
});
const job = (n: number, request: number, module: string, overrides: Partial<ExportHistoryJobInput> = {}): ExportHistoryJobInput => ({
  id: J(n),
  requestId: R(request),
  module,
  status: 'waiting',
  sentAt: null,
  emailCount: 0,
  ...overrides,
});

/** Fisher-Yates with a fixed seed, so the test is repeatable. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 9301 + 49297) % 233280;
    const k = Math.floor((s / 233280) * (i + 1));
    [out[i], out[k]] = [out[k], out[i]];
  }
  return out;
}

describe('assembleExportHistory', () => {
  const requests = [req(2, ['quotes', 'clients', 'website']), req(1, ['bookings'], T2, 'admin')];
  const jobs = [
    job(1, 2, 'clients', { status: 'sent', sentAt: T1, emailCount: 2 }),
    job(2, 2, 'website', { status: 'failed' }),
    job(3, 2, 'quotes', { status: 'working' }),
    job(4, 1, 'bookings', { status: 'interrupted', emailCount: 1 }),
  ];

  it('keeps the request order and follows each request\'s own module order', () => {
    const { requests: out, anomalies } = assembleExportHistory(requests, jobs);
    expect(anomalies).toBe(0);
    expect(out).toEqual([
      {
        requestId: R(2),
        requestedAt: T1,
        origin: 'owner',
        modules: [
          { module: 'quotes', status: 'working', sentAt: null, emailCount: 0 },
          { module: 'clients', status: 'sent', sentAt: T1, emailCount: 2 },
          { module: 'website', status: 'failed', sentAt: null, emailCount: 0 },
        ],
      },
      { requestId: R(1), requestedAt: T2, origin: 'admin', modules: [{ module: 'bookings', status: 'interrupted', sentAt: null, emailCount: 1 }] },
    ]);
  });

  it('is deterministic: shuffled job rows give the same output', () => {
    const expected = assembleExportHistory(requests, jobs);
    for (const seed of [1, 2, 3, 42, 99]) expect(assembleExportHistory(requests, shuffled(jobs, seed))).toEqual(expected);
  });

  it('a job of a module not in the request goes after the others, by module then id, and is counted', () => {
    const extra = [...jobs, job(9, 2, 'zeta'), job(8, 2, 'alpha'), job(7, 2, 'alpha')];
    const { requests: out, anomalies } = assembleExportHistory(requests, shuffled(extra, 5));
    expect(out[0].modules.map((line) => line.module)).toEqual(['quotes', 'clients', 'website', 'alpha', 'alpha', 'zeta']);
    expect(anomalies).toBe(3);
  });

  it('a module with no job row is left out and counted', () => {
    const { requests: out, anomalies } = assembleExportHistory([req(3, ['clients', 'quotes'])], [job(1, 3, 'quotes')]);
    expect(out[0].modules.map((line) => line.module)).toEqual(['quotes']);
    expect(anomalies).toBe(1);
  });

  it('never splits a request: 21 requests in, 21 complete requests out', () => {
    const many = Array.from({ length: 21 }, (_, n) => req(n + 1, ['clients', 'quotes', 'website']));
    const manyJobs = many.flatMap((r, n) => r.modules.map((m, k) => job(n * 3 + k + 1, n + 1, m)));
    const { requests: out } = assembleExportHistory(many, shuffled(manyJobs, 7));
    expect(out).toHaveLength(21);
    for (const request of out) expect(request.modules).toHaveLength(3);
  });

  it('jobs of a request not in the list are ignored (the job read is scoped to the request ids)', () => {
    const { requests: out } = assembleExportHistory([req(2, ['clients'])], [job(1, 2, 'clients'), job(2, 77, 'clients')]);
    expect(out).toHaveLength(1);
    expect(out[0].modules).toHaveLength(1);
  });

  it('the output carries no job id, Resend id, claim field or error code', () => {
    const text = JSON.stringify(assembleExportHistory(requests, jobs));
    expect(text).not.toMatch(/bbbbbbbb|resend|claimed|error_code|failure|user_id/);
  });

  it('imports neither repository, not even a type (SA C-4)', () => {
    const source = readFileSync(join(process.cwd(), 'lib/business-os/data-export/exportHistory.ts'), 'utf8');
    expect(source).not.toMatch(/\bBusinessOsExport(Request|ModuleJob)Repository\b/);
    expect(source).not.toMatch(/^import /m);
  });
});
