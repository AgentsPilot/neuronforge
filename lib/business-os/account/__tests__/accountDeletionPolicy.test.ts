import {
  ACCOUNT_POLICY_EXCEPTIONS,
  CASCADE_ROOT_TABLE,
  accountTablesToProcess,
  keyColumnFor,
  policyFor,
} from '../accountDeletionPolicy';
import { USER_OWNED_TABLES, BUSINESS_OWNED_TABLES } from '../../businessOwnedTables';

/*
 * The policy is a list, and a list that drifts is the failure this repository
 * has already been bitten by once — `scripts/reset-onboarding.ts` named 17
 * tables and had fallen 38 behind, and nothing failed, because an out-of-date
 * list looks exactly like a complete one.
 */

describe('[smoke] account deletion policy', () => {
  it('covers every account-level table that survives the business cascade', () => {
    const covered = new Set(accountTablesToProcess());

    const uncovered = Object.keys(USER_OWNED_TABLES)
      .filter(table => table !== CASCADE_ROOT_TABLE)
      .filter(table => !covered.has(table));

    expect(uncovered).toEqual([]);
  });

  it('never claims a business-owned table — those go with the cascade', () => {
    // Deleting one here would be at best redundant and at worst a second,
    // divergent opinion about who owns the row.
    const business = new Set<string>(BUSINESS_OWNED_TABLES);
    const overlap = accountTablesToProcess().filter(table => business.has(table));

    expect(overlap).toEqual([]);
  });

  it('never touches the cascade root — deleting it IS the cascade', () => {
    expect(accountTablesToProcess()).not.toContain(CASCADE_ROOT_TABLE);
  });

  it('deletes by default, so retention has to be argued for', () => {
    expect(policyFor('a_table_nobody_has_classified').verdict).toBe('delete');
  });

  it('removes platform admin rights rather than retaining them', () => {
    // A deleted account keeping admin authorization is a security hole, not a
    // retention requirement.
    expect(policyFor('admin_users').verdict).toBe('delete');
  });

  it('keeps the suppression list intact, identity included', () => {
    // The only row whose usefulness IS the identity: stripping it would resume
    // mailing people who asked not to be mailed.
    expect(policyFor('email_unsubscribes').verdict).toBe('keep');
  });

  it('gives every exception a stated reason', () => {
    for (const [table, policy] of Object.entries(ACCOUNT_POLICY_EXCEPTIONS)) {
      expect(policy.reason.length).toBeGreaterThan(20);
      expect(['keep', 'minimise']).toContain(policy.verdict);
      // An exception whose verdict is `delete` is not an exception.
      expect(table).toBeTruthy();
    }
  });

  it('still deletes what the previous route deleted by name', () => {
    /*
     * The rewrite replaced six hand-named tables with a list-driven sweep, and
     * four of the six were in none of the lists — so the "safer" version
     * silently stopped deleting them. `user_memory` alone held 332 rows.
     *
     * These are the four. A regression here is invisible in production: the
     * deletion reports success, and `verify` reads the same lists.
     */
    for (const table of ['user_memory', 'notification_settings', 'security_settings', 'user_api_keys']) {
      expect(accountTablesToProcess()).toContain(table);
      expect(policyFor(table).verdict).toBe('delete');
    }
  });

  it('scopes profiles by `id`, not `user_id`', () => {
    /*
     * The profile row IS the auth user — every caller in the codebase reads it
     * with `.eq('id', user.id)`. A delete scoped to a column that does not
     * exist errors instead of deleting, and the sweep logs and continues, so
     * this would fail silently: the account reports deleted with its profile
     * still there.
     */
    expect(keyColumnFor('profiles')).toBe('id');
    expect(keyColumnFor('plugin_connections')).toBe('user_id');
  });

  it('never writes a substitute derived from the identity it removes', () => {
    /*
     * The route this replaces wrote `DELETED_USER_${user.id.substring(0, 8)}`
     * and called it anonymised. The link was intact, so the data stayed
     * personal data. `strip` may only ever null a column.
     */
    for (const policy of Object.values(ACCOUNT_POLICY_EXCEPTIONS)) {
      for (const value of Object.values(policy.strip ?? {})) {
        expect(value).toBeNull();
      }
    }
  });

  it('Q-8: keeps the credit ledger detached, and deletes its derived totals', () => {
    /*
     * The ledger is a financial record, like credit_transactions: minimise.
     * Its totals are derived and worthless once detached: the default delete.
     * Both are carried out by the foreign keys to auth.users (SET NULL and
     * CASCADE), which is why the minimise reason says so.
     */
    expect(accountTablesToProcess()).toEqual(
      expect.arrayContaining(['business_os_credit_charges', 'business_os_credit_totals'])
    );
    expect(policyFor('business_os_credit_charges').verdict).toBe('minimise');
    expect(policyFor('business_os_credit_charges').reason).toMatch(/ON DELETE SET NULL/);
    expect(policyFor('business_os_credit_totals').verdict).toBe('delete');
    expect(ACCOUNT_POLICY_EXCEPTIONS).not.toHaveProperty('business_os_credit_totals');
  });

  it('S11-SQ-12: keeps the credit lots and their draws detached (minimise), carried out by ON DELETE SET NULL', () => {
    /*
     * Credits added to an account, and taken back, are financial records like
     * the charges: retained, detached from the person. Neither table holds an
     * UPDATE grant, so the detach is the foreign key's SET NULL.
     */
    expect(accountTablesToProcess()).toEqual(
      expect.arrayContaining(['business_os_credit_lots', 'business_os_credit_lot_draws'])
    );
    for (const table of ['business_os_credit_lots', 'business_os_credit_lot_draws']) {
      expect(policyFor(table).verdict).toBe('minimise');
      expect(policyFor(table).reason).toMatch(/ON DELETE SET NULL/);
      expect(policyFor(table).strip).toBeUndefined();
    }
  });
});
