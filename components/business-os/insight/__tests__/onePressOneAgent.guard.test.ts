/**
 * One press is one agent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A browser under memory pressure fired the install four times in TEN
 * MILLISECONDS and created four live agents:
 *
 *   18:30:19.226  df8b1b0a   rebook_quiet_clients
 *   18:30:19.234  ce43fa61   rebook_quiet_clients
 *   18:30:19.235  215f844c   rebook_quiet_clients
 *   18:30:19.236  cc577207   rebook_quiet_clients
 *
 * Each was scheduled and each would have written to the same clients: four
 * identical emails from one press, and four rows for the owner to stop with no
 * way to tell them apart.
 *
 * `installAutomation` reads before it writes, which is idempotent against
 * SEQUENTIAL calls and cannot win a ten-millisecond race. Three things now
 * stand in the way, and this pins all three.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const card = readFileSync(
  join(root, 'components', 'business-os', 'insight', 'InsightAdvisorCard.tsx'),
  'utf-8'
);
const install = readFileSync(
  join(root, 'lib', 'business-os', 'automations', 'install.ts'),
  'utf-8'
);

describe('the browser sends one request', () => {
  it('holds the guard in a ref, not in state', () => {
    /*
     * State updates are batched and asynchronous, so a second press in the same
     * tick reads the old value and goes. A ref is written synchronously.
     */
    expect(card).toContain('const installing = useRef(false);');
    expect(card).toContain('if (installing.current) return;');
    expect(card).toContain('installing.current = true;');
  });

  it('and releases it however the attempt ends', () => {
    /* A refusal, a network error or a thrown render must not leave the button
       dead for the rest of the session. */
    expect(card).toContain('installing.current = false;');
    expect(card.replace(/\s+/g, ' ')).toContain('} finally { installing.current = false; }');
  });

  it('imports what it uses', () => {
    /*
     * This one has bitten twice now: an edit adds a symbol and its import
     * separately, the import's anchor misses, and every source-level
     * assertion still passes because reading is not running.
     */
    expect(card).toMatch(/import React, \{[^}]*useRef[^}]*\} from 'react'/);
  });
});

describe('the database refuses a duplicate', () => {
  it('ships the unique index', () => {
    /* The only thing that actually closes the window. */
    const migration = join(
      root, 'supabase', 'migrations', '20261102_one_automation_agent_per_business.sql'
    );

    expect(existsSync(migration)).toBe(true);

    const sql = readFileSync(migration, 'utf-8');
    expect(sql).toContain('CREATE UNIQUE INDEX');
    /* Partial: a removed agent must not block a reinstall, and every other
       agent on the table has no automation id to collide on. */
    expect(sql).toContain('WHERE deleted_at IS NULL');
    expect(sql).toContain("agent_config -> 'business_os_automation' ->> 'id' IS NOT NULL");
  });

  it('and the install returns the winner rather than an error', () => {
    /*
     * 23505 is that index speaking. From the owner's side they pressed once and
     * the automation is on, so it is `alreadyInstalled`, not a failure.
     */
    expect(install).toContain("?.code === '23505'");
    expect(install.replace(/\s+/g, ' ')).toContain('alreadyInstalled: true');
  });
});
