/**
 * POST /api/plugins/test-audit — isolated per-execution audit endpoint (SA Q2 / CR2).
 * Covers: happy path (non-blocking AuditTrailService.log invoked), invalid body (400),
 * invalid JSON (400).
 */

const auditLog = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: (i: unknown) => auditLog(i) }) },
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';

function makeRequest(body: unknown, raw?: string) {
  return new NextRequest('http://localhost/api/plugins/test-audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
}

describe('POST /api/plugins/test-audit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    auditLog.mockResolvedValue(undefined);
  });

  it('records a successful execution audit (happy path)', async () => {
    const res = await POST(
      makeRequest({
        targetUserId: 'user-1',
        plugin: 'google-drive',
        action: 'delete_file',
        outcome: 'success',
        durationMs: 123,
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(auditLog).toHaveBeenCalledTimes(1);
    const entry = auditLog.mock.calls[0][0];
    expect(entry.action).toBe('PLUGIN_TESTER_EXECUTE');
    expect(entry.userId).toBe('user-1');
    expect(entry.entityType).toBe('plugin');
    expect(entry.details.outcome).toBe('success');
  });

  it('returns 400 when required fields are missing (Zod)', async () => {
    const res = await POST(makeRequest({ plugin: 'google-drive' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid outcome enum', async () => {
    const res = await POST(
      makeRequest({ targetUserId: 'u', plugin: 'p', action: 'a', outcome: 'maybe' })
    );
    expect(res.status).toBe(400);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await POST(makeRequest(null, '{not json'));
    expect(res.status).toBe(400);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('does not fail the request when audit logging rejects (non-blocking)', async () => {
    auditLog.mockRejectedValue(new Error('audit down'));
    const res = await POST(
      makeRequest({ targetUserId: 'u', plugin: 'p', action: 'a', outcome: 'error' })
    );
    // Response still 200 — audit is best-effort.
    expect(res.status).toBe(200);
  });
});
