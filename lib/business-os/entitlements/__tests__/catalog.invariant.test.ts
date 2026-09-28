/**
 * The catalog invariants (requirement AC-1, FR-1, FR-2, FR-8).
 *
 * These are the checks that make "the catalog is the single source of truth for
 * what can be gated" true rather than aspirational: every capability the
 * requirement names is present, every entry is complete, and the attributes that
 * DRIVE BEHAVIOUR — audience, message class, lifecycle, variant order — cannot
 * be left ambiguous.
 */

import { CAPABILITIES, CAPABILITY_IDS } from '@/lib/business-os/entitlements/config/catalog';
import { catalogSchema } from '@/lib/business-os/entitlements/schema';
import type { CapabilityDef } from '@/lib/business-os/entitlements/types';

/**
 * Every capability from requirement §5.3.
 *
 * Written out rather than derived, deliberately: deriving it from the catalog
 * would make this test agree with whatever the catalog says, including a
 * capability someone quietly dropped.
 */
const REQUIRED_CAPABILITIES = [
  'crm.core',
  'crm.documents',
  'booking.calendar_sync',
  'website.ai_site',
  'website.branding',
  'intake.forms',
  'intake.reminders',
  'payments.invoices',
  'payments.card',
  'payments.reminders',
  'payments.multi_currency',
  // FR-46 (2026-09-24): the chat SURFACE, added when configuring the tiers
  // showed that the eight per-operation groups below cannot express "Essentials
  // has no chat". Nothing reads it until Slice 2.
  'chat.access',
  'chat.marketing',
  'chat.invoice_control',
  'chat.email',
  'chat.search',
  'chat.scheduling',
  'chat.quotes',
  'chat.reporting',
  'chat.bulk',
  'ai.actions',
  'marketing.mass_email',
  'marketing.lead_response',
  'marketing.posts',
  'insights.checks',
  'insights.channels',
  'insights.daily_briefing',
  'support.level',
  'email.volume',
  'addon.marketing_analytics',
  'addon.mobile',
  'addon.full_payment_cycle',
  'addon.sms',
  'sms.messages',
  'team.seats',
  'business.locations',
  'website.custom_domain',
  'addon.act_for_you',
] as const;

describe('AC-1 — the catalog covers the requirement', () => {
  it('contains every capability §5.3 names, and nothing undeclared', () => {
    const present = [...CAPABILITY_IDS].sort();
    const required = [...REQUIRED_CAPABILITIES].sort();

    expect(required.filter((id) => !present.includes(id))).toEqual([]);
    expect(present.filter((id) => !required.includes(id as never))).toEqual([]);
  });

  it('is 38 capabilities', () => {
    // A guard on the guard: if both lists above were edited together, this still
    // notices the size changed and asks for a deliberate decision.
    expect(CAPABILITY_IDS).toHaveLength(38);
  });

  it('validates against its own schema', () => {
    const result = catalogSchema().safeParse(CAPABILITIES);
    expect(result.success).toBe(true);
  });
});

describe('the attributes that drive behaviour', () => {
  it.each(CAPABILITY_IDS)('%s declares a complete entry', (id) => {
    const capability = CAPABILITIES[id];

    expect(capability.labels.en.length).toBeGreaterThan(0);
    expect(capability.labels.he.length).toBeGreaterThan(0);
    expect(capability.labels.es.length).toBeGreaterThan(0);
    expect(capability.category).toBeTruthy();
    expect(capability.shape.kind).toBeTruthy();
    expect(['available', 'beta', 'not_built']).toContain(capability.lifecycle);
    expect(typeof capability.sellableAsAddon).toBe('boolean');
  });

  it('gives every automated client SEND a message class, and nothing else one', () => {
    // FR-39 / S-1. The class is what decides whether a message survives grace
    // (B-9) and pause (B-11), so a send without one has no answer at the moment
    // it matters. Branding is the reason `client_render` exists: visible to
    // clients, but not a message.
    const sendsWithoutClass = CAPABILITY_IDS.filter(
      (id) => CAPABILITIES[id].audience === 'client' && !('messageClass' in CAPABILITIES[id])
    );
    const nonSendsWithClass = CAPABILITY_IDS.filter(
      (id) => CAPABILITIES[id].audience !== 'client' && 'messageClass' in CAPABILITIES[id]
    );

    expect(sendsWithoutClass).toEqual([]);
    expect(nonSendsWithClass).toEqual([]);
  });

  it('orders variant options low to high, with no duplicates', () => {
    // The order is not presentational: it is how "the highest variant" is
    // derived for a cohort that grants everything, and how the snapshot test
    // recognises a downgrade.
    for (const id of CAPABILITY_IDS) {
      const shape = CAPABILITIES[id].shape;
      if (shape.kind !== 'variant') continue;

      const variants = shape.variants as readonly string[];
      expect(variants.length).toBeGreaterThanOrEqual(2);
      expect(new Set(variants).size).toBe(variants.length);
    }

    // The two whose order carries a commercial meaning, spelled out so a
    // reversal is caught here rather than in a customer's footer.
    expect(CAPABILITIES['website.branding'].shape).toMatchObject({ variants: ['branded', 'unbranded'] });
    expect(CAPABILITIES['intake.forms'].shape).toMatchObject({ variants: ['manual', 'ai'] });
    expect(CAPABILITIES['support.level'].shape).toMatchObject({ variants: ['standard', 'priority'] });
  });

  it('explains every capability that is not built', () => {
    // `not_built` means "never entitled, whatever config says" (FR-13). That is
    // a strong claim about the code, so it has to carry its evidence.
    const unexplained = CAPABILITY_IDS.filter(
      (id) => CAPABILITIES[id].lifecycle === 'not_built' && !CAPABILITIES[id].note
    );

    expect(unexplained).toEqual([]);
  });

  it('marks the five rows that are still with Eyal', () => {
    // B-1. They ship as placeholders so the engine does not wait on them; the
    // marker is what stops a placeholder being read as a decision.
    // Read through the declared type: on the `as const` literal, `placeholder`
    // only exists on the entries that have one, which is not a question the
    // type should be answering.
    const placeholders = CAPABILITY_IDS.filter(
      (id) => (CAPABILITIES[id] as CapabilityDef).placeholder === 'B-1'
    ).sort();

    expect(placeholders).toEqual(
      [
        'addon.full_payment_cycle',
        'addon.marketing_analytics',
        'addon.mobile',
        'chat.marketing',
        'marketing.mass_email',
        'payments.card',
        'payments.invoices',
      ].sort()
    );
  });

  it('records what the code says about B-1\'s "marketing chat vs mass email" split', () => {
    // SA challenged `marketing.mass_email = available` and was right. Tracing it
    // on 2026-09-22 answered the commercial question the sheet could not:
    //
    //   chat.marketing       — contacts.send / invoices.send reach emailSend.ts,
    //                          which calls sendEmail() (Resend/SMTP), and
    //                          ForEachExecutor fans it out. It SENDS.
    //   marketing.mass_email — the campaign/sequence builder writes an enrollment
    //                          with a next_send_at that NOTHING READS. No cron,
    //                          no dispatcher, and triggerSequence has no caller.
    //
    // Pinned here so a future edit cannot quietly flip either back without
    // saying what changed in the code.
    expect(CAPABILITIES['chat.marketing'].lifecycle).toBe('available');
    expect(CAPABILITIES['marketing.mass_email'].lifecycle).toBe('not_built');
    expect(CAPABILITIES['marketing.mass_email'].note).toMatch(/next_send_at/);
  });

  it('keeps the at-limit behaviour consistent with D-12', () => {
    // Client-facing automations degrade to template text; owner-facing AI
    // pauses. Getting this backwards would leave a customer's clients without a
    // reply, which is the one outcome D-12 exists to prevent.
    expect(CAPABILITIES['marketing.lead_response'].atLimit).toBe('degrade_to_template');
    expect(CAPABILITIES['insights.daily_briefing'].atLimit).toBe('pause');
    // B-7: a fair-use ceiling alerts the platform team and never blocks.
    expect(CAPABILITIES['email.volume'].atLimit).toBe('alert_only');
    // The allowance itself defers to the call site, because it is spent by both.
    expect(CAPABILITIES['ai.actions'].atLimit).toBe('by_call_site_audience');
  });
});
