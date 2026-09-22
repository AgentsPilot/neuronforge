/**
 * The one platform-account rule (Layer 1.5 FR-17, AC-12), and its deliberate
 * relationship with the catalog's query-side helpers (SA WC-7).
 */

import * as fs from 'fs';
import * as path from 'path';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

import { ALL_ZERO_UUID, platformAccountId } from '../platformAccount';
import {
  isPlatformAccount,
  isPlatformAccountEnvIgnored,
  platformAccountIds,
} from '@/lib/business-os/llm/callCatalog';

const SYS = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  delete process.env.SYSTEM_ADMIN_USER_ID;
});

afterAll(() => {
  delete process.env.SYSTEM_ADMIN_USER_ID;
});

describe('platformAccountId', () => {
  it('is the all-zero id when SYSTEM_ADMIN_USER_ID is unset', () => {
    expect(platformAccountId()).toBe(ALL_ZERO_UUID);
    expect(ALL_ZERO_UUID).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('is the all-zero id when SYSTEM_ADMIN_USER_ID is empty', () => {
    process.env.SYSTEM_ADMIN_USER_ID = '';
    expect(platformAccountId()).toBe(ALL_ZERO_UUID);
  });

  it('is SYSTEM_ADMIN_USER_ID when it is a UUID', () => {
    process.env.SYSTEM_ADMIN_USER_ID = SYS;
    expect(platformAccountId()).toBe(SYS);
  });

  it('returns a non-UUID env value verbatim (the tracker behaviour it replaces)', () => {
    process.env.SYSTEM_ADMIN_USER_ID = 'not-a-uuid';
    expect(platformAccountId()).toBe('not-a-uuid');
  });

  it('reads the environment at call time, not at import', () => {
    expect(platformAccountId()).toBe(ALL_ZERO_UUID);
    process.env.SYSTEM_ADMIN_USER_ID = SYS;
    expect(platformAccountId()).toBe(SYS);
  });

  it('imports nothing, so it can never pull a file into the typecheck:bos-llm gate', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'platformAccount.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
  });
});

/*
 * Two answers to "what is the platform account" exist on purpose: the id the
 * tracker writes (raw env, or all-zero) and the ids a query looks for (UUIDs
 * only). These pin the relationship so neither can drift unnoticed.
 */
describe('platformAccountId vs the catalog query helpers (WC-7)', () => {
  it('unset: both agree on the all-zero id only', () => {
    expect(platformAccountIds()).toEqual([platformAccountId()]);
    expect(isPlatformAccountEnvIgnored()).toBe(false);
    expect(isPlatformAccount(platformAccountId())).toBe(true);
  });

  it('a UUID: the query ids contain what the tracker writes', () => {
    process.env.SYSTEM_ADMIN_USER_ID = SYS;
    expect(platformAccountIds()).toContain(platformAccountId());
    expect(platformAccountIds()).toContain(ALL_ZERO_UUID);
    expect(isPlatformAccountEnvIgnored()).toBe(false);
    expect(isPlatformAccount(platformAccountId())).toBe(true);
  });

  it('a non-UUID: the tracker value is verbatim, the query ids exclude it and the flag is raised', () => {
    process.env.SYSTEM_ADMIN_USER_ID = 'not-a-uuid';
    expect(platformAccountId()).toBe('not-a-uuid');
    expect(platformAccountIds()).not.toContain(platformAccountId());
    expect(platformAccountIds()).toEqual([ALL_ZERO_UUID]);
    expect(isPlatformAccountEnvIgnored()).toBe(true);
  });
});
