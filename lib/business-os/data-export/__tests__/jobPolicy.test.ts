/**
 * The Phase 1 export job policy (DE-8a, workplan §5.3). The SQL literals are
 * pinned against these values by
 * supabase/migrations/__tests__/business-os-data-exports.migration.test.ts.
 */

import { EXPORT_JOB_POLICY, exportObjectPath } from '../jobPolicy';

const USER = '11111111-1111-4111-8111-111111111111';
const JOB = '44444444-4444-4444-8444-444444444444';

describe('EXPORT_JOB_POLICY', () => {
  it('holds the decided Phase 1 rules', () => {
    expect(EXPORT_JOB_POLICY).toEqual({
      BUCKET: 'business-data-exports',
      BUCKET_FILE_SIZE_LIMIT_BYTES: 50 * 1024 * 1024,
      BUCKET_MIME_TYPE: 'application/zip',
      DAILY_LIMIT: 3,
      DAILY_WINDOW_HOURS: 24,
      STALE_RUNNING_SECONDS: 90,
      RETENTION_HOURS: 72,
      OWNER_SIGNED_URL_TTL_SECONDS: 120,
      ADMIN_SIGNED_URL_TTL_SECONDS: 60,
    });
  });

  it('keeps the stale rule above a 60 second function limit', () => {
    expect(EXPORT_JOB_POLICY.STALE_RUNNING_SECONDS).toBeGreaterThan(60);
  });
});

describe('exportObjectPath', () => {
  it('is {user_id}/{job_id}/1.zip', () => {
    expect(exportObjectPath(USER, JOB)).toBe(`${USER}/${JOB}/1.zip`);
  });

  it('lower-cases, so the folder always matches the user id the purge lists', () => {
    expect(exportObjectPath(USER.toUpperCase(), JOB.toUpperCase())).toBe(`${USER}/${JOB}/1.zip`);
  });

  it.each([
    ['../etc', JOB],
    [USER, '../../x'],
    [`${USER}/x`, JOB],
    ['', JOB],
    [USER, `${JOB} `],
    ['Acme Ltd', JOB],
  ])('refuses %s / %s', (userId, jobId) => {
    expect(() => exportObjectPath(userId, jobId)).toThrow('must be uuids');
  });
});
