/**
 * Tests for the admin calibration trigger's identity split (impersonate-at-the-
 * boundary). Pure logic — the riskiest part of the feature.
 */

import { resolveCalibrationIdentity } from '../adminCalibrationIdentity';

describe('resolveCalibrationIdentity', () => {
  it('same-user run: normal path, no impersonation', () => {
    const d = resolveCalibrationIdentity({
      isAdmin: false,
      callerId: 'u1',
      callerEmail: 'u1@x.com',
      ownerId: 'u1',
    });
    expect(d.forbidden).toBe(false);
    expect(d.adminInitiated).toBe(false);
    expect(d.userId).toBe('u1');
    expect(d.userEmail).toBe('u1@x.com');
    expect(d.adminActorId).toBeNull();
    expect(d.useServiceRole).toBe(false);
  });

  it('same-user run by an admin on their OWN agent: still normal (not adminInitiated)', () => {
    const d = resolveCalibrationIdentity({
      isAdmin: true,
      callerId: 'admin1',
      callerEmail: 'admin@x.com',
      ownerId: 'admin1',
    });
    expect(d.adminInitiated).toBe(false);
    expect(d.useServiceRole).toBe(false);
    expect(d.adminActorId).toBeNull();
    expect(d.userId).toBe('admin1');
  });

  it('non-admin cross-user: forbidden', () => {
    const d = resolveCalibrationIdentity({
      isAdmin: false,
      callerId: 'u2',
      callerEmail: 'u2@x.com',
      ownerId: 'owner1',
    });
    expect(d.forbidden).toBe(true);
    expect(d.adminInitiated).toBe(false);
  });

  it('admin cross-user: impersonate the owner, keep admin email, service-role', () => {
    const d = resolveCalibrationIdentity({
      isAdmin: true,
      callerId: 'admin1',
      callerEmail: 'admin@x.com',
      ownerId: 'owner1',
    });
    expect(d.forbidden).toBe(false);
    expect(d.adminInitiated).toBe(true);
    expect(d.userId).toBe('owner1');           // execution identity = owner
    expect(d.userEmail).toBe('admin@x.com');   // notify recipient = admin (decision 3)
    expect(d.adminActorId).toBe('admin1');     // actor recorded
    expect(d.useServiceRole).toBe(true);
  });

  it('force is honored only on admin runs', () => {
    const adminForced = resolveCalibrationIdentity({
      isAdmin: true, callerId: 'admin1', callerEmail: 'a@x.com', ownerId: 'owner1', force: true,
    });
    expect(adminForced.forceCalibrate).toBe(true);

    // Non-admin passing force cross-user is forbidden anyway, but force must not leak.
    const nonAdminForced = resolveCalibrationIdentity({
      isAdmin: false, callerId: 'u2', callerEmail: 'u@x.com', ownerId: 'owner1', force: true,
    });
    expect(nonAdminForced.forceCalibrate).toBe(false);

    // Admin on their own agent with force → not adminInitiated → force ignored.
    const adminOwnForced = resolveCalibrationIdentity({
      isAdmin: true, callerId: 'admin1', callerEmail: 'a@x.com', ownerId: 'admin1', force: true,
    });
    expect(adminOwnForced.forceCalibrate).toBe(false);
  });

  it('null caller email passes through as null', () => {
    const d = resolveCalibrationIdentity({
      isAdmin: true, callerId: 'admin1', callerEmail: null, ownerId: 'owner1',
    });
    expect(d.userEmail).toBeNull();
  });
});
