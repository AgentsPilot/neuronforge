/**
 * The confirmation card never repeats itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The outcome line is a prefix plus whatever the provider last reported:
 *
 *     "מייל נשלח"  ·  <status>
 *
 * The prefix already means SENT, so appending the stored status produced
 * "מייל נשלח · נשלח" — sent, sent — on every message the provider had not yet
 * confirmed, which is most of them. Two bookings four minutes apart read
 * "sent · sent" and "sent · delivered", and the difference looked like a defect
 * in the data when it was only this line stuttering.
 *
 * So `sent` adds nothing and is dropped. What survives is the half the prefix
 * cannot say: it arrived, it was opened, it came back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND TWO STATES THAT ARE NOT "SENT, THEN SOMETHING"
 *
 * `pending` has not left the platform and `failed` never did. Leading either
 * with "Email sent" asserts the one thing that did not happen — the same shape
 * of error as a cancelled payment request reading "overdue".
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const tab = fs.readFileSync(
  path.join(process.cwd(), 'components/crm/contact-drawer/BookingsTab.tsx'),
  'utf8'
);

/** The confirmation step's outcome block. */
function block(): string {
  const start = tab.indexOf('WHAT HAPPENED TO THE CONFIRMATION');
  expect(start).toBeGreaterThan(-1);

  const end = tab.indexOf('Supporting detail', start);
  expect(end).toBeGreaterThan(start);

  return tab.slice(start, end);
}

describe('the outcome line adds only what the prefix cannot say', () => {
  it('drops `sent`, which the prefix already means', () => {
    expect(block()).toMatch(/reached !== 'sent'/);
  });

  it('lets pending and failed stand without a "sent" prefix', () => {
    const body = block();

    expect(body).toMatch(/adds === 'pending' \|\| adds === 'failed'/);
    expect(body).toMatch(/standsAlone/);
  });

  it('says so plainly when no send was ever recorded', () => {
    /*
     * The step's status falls back to 'sent' when there is no email row at all.
     * Fine for colouring a tick, a lie stated as a fact — so the card says
     * "no send recorded" instead of inventing one.
     */
    expect(block()).toMatch(/crm\.email\.no_record/);
  });
});

describe('it reports the furthest point reached, not the stored status', () => {
  it('prefers an open over a delivery over the status', () => {
    /*
     * `delivered` and `opened` arrive as TIMESTAMPS from the provider webhook
     * while the row's status stays `'sent'`. Reading `status` alone would
     * report "sent" for mail the client has already opened — the one signal an
     * owner actually wants, permanently invisible.
     */
    const body = block();

    /*
     * A generous window: this block sits about eleven levels deep, so the two
     * branches are separated by more whitespace than code. What is asserted is
     * the ORDER — opened tested before delivered — not how far apart they sit.
     */
    expect(body).toMatch(/meta\.openedAt[\s\S]{0,240}meta\.deliveredAt/);
  });

  it('carries delivery through from the drawer, not just the type', () => {
    /*
     * `deliveredAt` existed on `BookingConfirmationEmail` and was dropped at
     * every mapping between the query and the card, so the field was real and
     * always undefined. Both drawer paths must pass it.
     */
    const drawer = fs.readFileSync(
      path.join(process.cwd(), 'components/crm/contact-drawer/CRMContactDrawerV2.tsx'),
      'utf8'
    );

    const mapped = drawer.match(/deliveredAt: confirmationEmail\.delivered_at/g) ?? [];

    expect(mapped).toHaveLength(2);
  });
});
