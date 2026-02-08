/**
 * Distributed Lock using PostgreSQL Advisory Locks
 *
 * Uses pg_advisory_lock for distributed coordination across multiple server instances.
 * Ensures only one process can execute critical sections (e.g., calibration resume) at a time.
 *
 * @module lib/utils/distributedLock
 */

import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

/**
 * Convert string key to integer for pg_advisory_lock
 * PostgreSQL advisory locks require bigint, so we hash the string
 */
function keyToLockId(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const char = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Acquire a distributed lock
 *
 * @param lockKey - Unique identifier for the lock (e.g., "execution:123:resume")
 * @param timeoutMs - Maximum time to wait for lock acquisition (default: 60s)
 * @returns true if lock acquired, false if timeout
 */
export async function acquireLock(lockKey: string, timeoutMs: number = 60000): Promise<boolean> {
  const lockId = keyToLockId(lockKey);
  const startTime = Date.now();

  console.log(`[DistributedLock] Attempting to acquire lock: ${lockKey} (id: ${lockId})`);

  try {
    // Try to acquire lock with timeout
    // pg_try_advisory_lock returns true if lock acquired, false if already held
    const { data, error } = await supabaseAdmin.rpc('pg_try_advisory_lock', {
      lock_id: lockId
    });

    if (error) {
      console.error(`[DistributedLock] ❌ Error acquiring lock:`, error);
      return false;
    }

    if (data) {
      const elapsed = Date.now() - startTime;
      console.log(`[DistributedLock] ✅ Lock acquired: ${lockKey} (took ${elapsed}ms)`);
      return true;
    }

    // Lock is already held - wait and retry
    console.log(`[DistributedLock] ⏳ Lock already held: ${lockKey}, waiting...`);

    const pollInterval = 100; // Check every 100ms
    const endTime = startTime + timeoutMs;

    while (Date.now() < endTime) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const { data: retryData, error: retryError } = await supabaseAdmin.rpc('pg_try_advisory_lock', {
        lock_id: lockId
      });

      if (retryError) {
        console.error(`[DistributedLock] ❌ Error during lock retry:`, retryError);
        return false;
      }

      if (retryData) {
        const elapsed = Date.now() - startTime;
        console.log(`[DistributedLock] ✅ Lock acquired after waiting: ${lockKey} (took ${elapsed}ms)`);
        return true;
      }
    }

    // Timeout
    console.warn(`[DistributedLock] ⏱️  Lock acquisition timeout: ${lockKey} (waited ${timeoutMs}ms)`);
    return false;

  } catch (err) {
    console.error(`[DistributedLock] ❌ Unexpected error:`, err);
    return false;
  }
}

/**
 * Release a distributed lock
 *
 * @param lockKey - The lock identifier to release
 * @returns true if lock released successfully
 */
export async function releaseLock(lockKey: string): Promise<boolean> {
  const lockId = keyToLockId(lockKey);

  console.log(`[DistributedLock] Releasing lock: ${lockKey} (id: ${lockId})`);

  try {
    // pg_advisory_unlock returns true if lock was held and released
    const { data, error } = await supabaseAdmin.rpc('pg_advisory_unlock', {
      lock_id: lockId
    });

    if (error) {
      console.error(`[DistributedLock] ❌ Error releasing lock:`, error);
      return false;
    }

    if (data) {
      console.log(`[DistributedLock] ✅ Lock released: ${lockKey}`);
      return true;
    } else {
      console.warn(`[DistributedLock] ⚠️  Lock was not held: ${lockKey}`);
      return false;
    }

  } catch (err) {
    console.error(`[DistributedLock] ❌ Unexpected error during release:`, err);
    return false;
  }
}

/**
 * Execute a function with automatic lock acquisition and release
 *
 * @param lockKey - Lock identifier
 * @param fn - Function to execute while holding the lock
 * @param timeoutMs - Lock acquisition timeout
 * @returns Result of the function execution
 * @throws Error if lock cannot be acquired or function throws
 */
export async function withLock<T>(
  lockKey: string,
  fn: () => Promise<T>,
  timeoutMs: number = 60000
): Promise<T> {
  const acquired = await acquireLock(lockKey, timeoutMs);

  if (!acquired) {
    throw new Error(`Failed to acquire lock: ${lockKey}`);
  }

  try {
    return await fn();
  } finally {
    await releaseLock(lockKey);
  }
}
