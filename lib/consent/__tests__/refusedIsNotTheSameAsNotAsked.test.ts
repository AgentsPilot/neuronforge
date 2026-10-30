/**
 * Three states, not two.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The booking form shows a consent box and a client can book without touching
 * it. `recordConsent` writes NOTHING in that case, deliberately — its own
 * comment says an untouched box is not a decision, because recording one would
 * silently unsubscribe somebody who agreed on an earlier form.
 *
 * So the data holds three answers and the gate read two:
 *
 *   granted       they ticked
 *   withdrawn     they unsubscribed
 *   nothing       nobody ever asked them
 *
 * `!consented` collapsed the last two into a refusal, which is why a client who
 * books without ticking could never be written to about their next appointment.
 *
 * The fix is NOT to default anybody to consented — that is a pre-ticked box by
 * another name, and it destroys the evidence by making a real agreement
 * indistinguishable from an invented one. It is soft opt-in: ePrivacy Art
 * 13(2), PECR reg 22(3), and the existing-customer exception in Israel's
 * Amendment 40.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const gate = readFileSync(join(root, 'lib', 'consent', 'marketingGate.ts'), 'utf-8');
const record = readFileSync(join(root, 'lib', 'consent', 'recordConsent.ts'), 'utf-8');

describe('the three states are kept apart', () => {
  it('an untouched box still records nothing', () => {
    /* The premise everything here rests on. If this ever starts writing
       `withdrawn`, soft opt-in silently stops reaching anybody. */
    expect(record).toContain('if (!consent?.granted) return;');
  });

  it('the gate tells refused from not-asked', () => {
    expect(gate).toContain('const refused = state?.consented === false;');
    expect(gate).toContain('const granted = state?.consented === true;');
    /* The old reading, which treated both as a no. */
    expect(gate).not.toContain('if (!state?.consented) {');
  });

  it('a refusal is absolute, whatever the caller claims', () => {
    const check = gate.slice(gate.indexOf('const refused ='), gate.indexOf('const known ='));
    const refusalFirst = check.indexOf('if (refused)');
    const claimRead = check.indexOf('intent.softOptIn');

    expect(refusalFirst).toBeGreaterThan(-1);
    /* Read before the claim is even looked at. */
    expect(claimRead).toBeGreaterThan(refusalFirst);
  });
});

describe('soft opt-in is a basis, not a hole', () => {
  it('needs the caller to claim it', () => {
    expect(gate).toContain('if (!intent.softOptIn) {');
  });

  it('and verifies the relationship rather than trusting the claim', () => {
    /* A caller that could assert its way past this would make the flag a hole.
       A booking is a sale; an enquiry is negotiating one. */
    expect(gate).toContain('await this.hasRelationship(ownerUserId, email)');
    expect(gate).toContain("from('scheduling_bookings')");
    expect(gate).toContain("from('crm_activities')");
  });

  it('refuses when it cannot confirm the relationship', () => {
    /* A lookup that fails must never read as confirmation. */
    expect(gate).toContain('if (known === undefined)');
    expect(gate).toContain("reason: 'consent_lookup_failed'");
    expect(gate).toContain("reason: 'no_relationship'");
  });

  it('says which basis made the send lawful', () => {
    /* The two are defended differently if anybody asks, so "allowed" alone is
       not a record. */
    expect(gate).toContain("basis: granted ? 'consent' : 'soft_opt_in'");
  });
});

describe('only the agents it actually fits claim it', () => {
  const plan = (file: string) =>
    readFileSync(join(root, 'lib', 'business-os', 'automations', 'agents', file), 'utf-8');

  it('rebooking and enquiries do', () => {
    /* A booking is the sale; an enquiry is negotiating one. Both messages are
       about the same kind of work the person came for. */
    expect(plan('rebookQuietClients.steps.json')).toContain('"soft_opt_in": true');
    expect(plan('followUpNewEnquiries.steps.json')).toContain('"soft_opt_in": true');
  });

  it('win-back does not', () => {
    /*
     * The exception wants a RECENT sale. Six to eighteen months after the last
     * visit, "recent" is doing work it cannot bear, and a warm note about
     * coming back is the closest thing in this product to a cold mailshot.
     */
    expect(plan('winBackQuietClients.steps.json')).not.toContain('"soft_opt_in": true');
  });
});
