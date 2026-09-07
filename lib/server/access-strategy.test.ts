// lib/server/access-strategy.test.ts
//
// Fast, pure unit tests for the access/eligibility resolver. No DB, no network — both
// dependencies (UserPluginConnections, BusinessProfileRepository) are injected as mocks.
// Focus: db_active FAILS CLOSED, and the strategy-specific error contract (C2).

import { AccessStrategyResolver } from './access-strategy';
import type { PluginAuthConfig } from '@/lib/types/plugin-types';

const OAUTH_CFG = { auth_type: 'oauth' } as unknown as PluginAuthConfig;

function makeResolver(opts: {
  getConnection?: jest.Mock;
  findByUserId?: jest.Mock;
}) {
  const userConnections = { getConnection: opts.getConnection ?? jest.fn() } as any;
  const businessProfiles = { findByUserId: opts.findByUserId ?? jest.fn() } as any;
  return new AccessStrategyResolver(userConnections, businessProfiles);
}

describe('AccessStrategyResolver — db_active (fail-closed)', () => {
  it('is eligible and issues a virtual connection carrying user_id when the tenant has a profile', async () => {
    const findByUserId = jest.fn().mockResolvedValue({ data: { id: 'p1' }, error: null });
    const resolver = makeResolver({ findByUserId });

    const res = await resolver.resolve('user-1', 'crm', { accessStrategy: { type: 'db_active' } });

    expect(res.eligible).toBe(true);
    expect(res.strategy).toBe('db_active');
    expect(res.connection?.user_id).toBe('user-1');
    expect(findByUserId).toHaveBeenCalledWith('user-1');
  });

  it('DENIES (access_denied) when the tenant has no business_profiles row', async () => {
    // findByUserId returns { data: null, error: null } for an absent profile (PGRST116).
    const findByUserId = jest.fn().mockResolvedValue({ data: null, error: null });
    const resolver = makeResolver({ findByUserId });

    const res = await resolver.resolve('user-2', 'crm', { accessStrategy: { type: 'db_active' } });

    expect(res.eligible).toBe(false);
    expect(res.connection).toBeNull();
    expect(res.errorCode).toBe('access_denied');
    expect(res.reason).toBe('no_active_tenant');
  });

  it('DENIES (fail-closed) when the profile lookup errors', async () => {
    const findByUserId = jest.fn().mockResolvedValue({ data: null, error: new Error('db down') });
    const resolver = makeResolver({ findByUserId });

    const res = await resolver.resolve('user-3', 'crm', { accessStrategy: { type: 'db_active' } });

    expect(res.eligible).toBe(false);
    expect(res.errorCode).toBe('access_denied');
    expect(res.reason).toBe('lookup_error');
  });
});

describe('AccessStrategyResolver — oauth contract (C2)', () => {
  it('returns auth_failed (not access_denied) when there is no OAuth connection', async () => {
    const getConnection = jest.fn().mockResolvedValue(null);
    const resolver = makeResolver({ getConnection });

    const res = await resolver.resolve('user-4', 'gmail', { authConfig: OAUTH_CFG });

    expect(res.eligible).toBe(false);
    expect(res.errorCode).toBe('auth_failed');
  });

  it('is eligible and returns the resolved connection when OAuth is connected', async () => {
    const connection = { user_id: 'user-5', plugin_key: 'gmail' };
    const getConnection = jest.fn().mockResolvedValue(connection);
    const resolver = makeResolver({ getConnection });

    const res = await resolver.resolve('user-5', 'gmail', { authConfig: OAUTH_CFG });

    expect(res.eligible).toBe(true);
    expect(res.connection).toBe(connection);
  });
});

describe('AccessStrategyResolver — license_tier seam', () => {
  it('is a designed-but-unbuilt seam and denies closed', async () => {
    const resolver = makeResolver({});
    const res = await resolver.resolve('user-6', 'x', { accessStrategy: { type: 'license_tier' } });

    expect(res.eligible).toBe(false);
    expect(res.errorCode).toBe('access_strategy_unavailable');
  });
});
