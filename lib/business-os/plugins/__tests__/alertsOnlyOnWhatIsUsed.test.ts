/**
 * The reconnect alert names a connection this business actually depends on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS EXISTS FOR
 *
 * The readiness line was wired straight to `getActiveExpiredPluginKeys`, which
 * answers a PLATFORM question: every lapsed OAuth grant this user holds,
 * whatever made it — the agent wizard, the plugin tester, a workflow from last
 * year. An owner who uses Gmail and nothing else was told to reconnect Google
 * Sheets, Slack and Drive, none of which Business OS has ever called for them.
 *
 * That is worse than saying nothing. It teaches the reader that the amber line
 * is noise, so the next one — the one costing them leads — is skipped with the
 * rest.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE TWO THAT MUST NEVER BE OFFERED
 *
 * `stripe` is in the business_os plugin profile but BOS never invokes its
 * executor, so a reconnect would repair nothing a broken payout needs. The
 * internal plugins have no grant to expire at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { connectionsInUse, COMPONENT_CONNECTIONS } from '../connectionsInUse';
import { PLUGIN_PROFILES } from '@/lib/server/plugin-profile';
import { getFriendlyPluginName } from '@/lib/pilot/shadow/friendlyLanguage';
import { PROVIDER_NAMES } from '@/lib/business-os/leads/inboxProviders';

describe('a business that only reads Gmail', () => {
  const gmailOnly = connectionsInUse({ mailProviders: ['google-mail'] });

  it('is alerted about Gmail', () => {
    expect(gmailOnly.has('google-mail')).toBe(true);
  });

  it.each([
    ['google-sheets'],
    ['google-drive'],
    ['google-docs'],
    ['slack'],
    ['hubspot'],
    ['notion'],
    ['airtable'],
  ])('is NOT alerted about %s', plugin => {
    /* THE DEFECT, as one assertion per plugin. Each of these can hold a
       lapsed grant from somewhere else in the platform. */
    expect(gmailOnly.has(plugin)).toBe(false);
  });

  it('is not told to reconnect the mailbox it does not use', () => {
    /* Both mail providers serve the same component, so a component-level
       answer would have named Outlook to a Gmail business. */
    expect(gmailOnly.has('outlook')).toBe(false);
  });

  it('is not told to reconnect a calendar it never synced', () => {
    expect(gmailOnly.has('google-calendar')).toBe(false);
  });
});

describe('each component brings only its own', () => {
  it('calendar sync brings both calendar providers, and no mailbox', () => {
    /*
     * Both, because the owner picked one when they configured it and only the
     * connected one can expire — the other holds no grant, so it can never
     * appear in the expired list this set filters.
     */
    const synced = connectionsInUse({ calendar: true });

    expect(synced.has('google-calendar')).toBe(true);
    expect(synced.has('outlook')).toBe(true);
    expect(synced.has('google-mail')).toBe(false);
  });

  it('a connected Meta page brings meta-insights only', () => {
    const meta = connectionsInUse({ meta: true });

    expect([...meta]).toEqual(['meta-insights']);
  });

  it('a Google listing brings the listing plugin, not Analytics', () => {
    /* These were conflated once: `googleConnected` accepted a GA property, so
       an account with Analytics and no listing read as "Google connected". */
    const listing = connectionsInUse({ listing: true });

    expect(listing.has('google-business-profile')).toBe(true);
    expect(listing.has('google-analytics')).toBe(false);
  });

  it('adds up across components without crossing them', () => {
    const both = connectionsInUse({ mailProviders: ['outlook'], meta: true });

    expect([...both].sort()).toEqual(['meta-insights', 'outlook']);
  });
});

describe('a business with nothing configured', () => {
  it.each([
    ['nothing at all', {}],
    ['an empty mailbox list', { mailProviders: [] }],
    ['every component explicitly off', { calendar: false, meta: false, listing: false, analytics: false }],
  ])('is alerted about nothing, for %s', (_label, configured) => {
    expect(connectionsInUse(configured).size).toBe(0);
  });
});

describe('what must never be offered', () => {
  it('never names Stripe', () => {
    /*
     * It IS in the business_os profile, whose own entry says why it must not
     * be here: "Stripe Connect OAuth definition only; BOS never invokes its
     * executor." A broken payout is not repaired by a plugin reconnect, and
     * the payments surface reports it properly.
     */
    const everything = connectionsInUse({
      mailProviders: ['google-mail', 'outlook'],
      calendar: true,
      meta: true,
      listing: true,
      analytics: true,
    });

    expect(everything.has('stripe')).toBe(false);
  });

  it.each([['business-os'], ['crm'], ['scheduling'], ['payments']])(
    'never names the internal plugin %s',
    plugin => {
      /* No OAuth grant to expire. "Reconnect Business OS" would tell an owner
         to reconnect the page they are reading. */
      const everything = connectionsInUse({
        mailProviders: ['google-mail', 'outlook'],
        calendar: true,
        meta: true,
        listing: true,
        analytics: true,
      });

      expect(everything.has(plugin)).toBe(false);
    }
  );
});

describe('every name it can show is a name, not a key', () => {
  it('has friendly words for every plugin the table can name', () => {
    /*
     * THE GUARD FOR THE MESSAGE ITSELF.
     *
     * `PluginManagerV2.getPluginDisplayName` reads
     * `plugin.displayName || plugin.label || key` off the definition, and not
     * one definition file in the repo sets either field — so it answers with
     * the KEY for every plugin we ship. Both surfaces used it at first, and
     * "google-mail needs reconnecting" is what an owner saw.
     *
     * `getFriendlyPluginName` holds the real words. Anything it does not know
     * falls through to the key, which is the same defect one row later, so
     * this asserts the table and the map agree.
     */
    const unnamed = Object.values(COMPONENT_CONNECTIONS)
      .flat()
      .filter(plugin => getFriendlyPluginName(plugin) === plugin);

    expect(unnamed).toEqual([]);
  });

  it('names the mailbox the way the rest of the product does', () => {
    /* `PROVIDER_NAMES` is what the setup screens, the channels card and the
       agent's own name use. Two names for one mailbox on one dashboard is the
       thing its comment warns about. */
    expect(getFriendlyPluginName('google-mail')).toBe(PROVIDER_NAMES['google-mail']);
    expect(getFriendlyPluginName('outlook')).toBe(PROVIDER_NAMES.outlook);
  });
});

describe('it stays inside the deployment it runs in', () => {
  it('names only plugins the business_os profile actually loads', () => {
    /*
     * THE GUARD THAT STOPS THIS DRIFTING.
     *
     * The profile is a LOAD gate: a plugin outside it is never read, parsed or
     * registered, so `getPluginDefinition` returns undefined and the reconnect
     * route answers "Plugin not found". Alerting about one would offer a
     * button that cannot work.
     *
     * Read from the profile rather than listed again here, so adding a
     * component to the table above without adding its plugin to the profile
     * fails right here instead of on a dashboard.
     */
    const loaded = new Set(PLUGIN_PROFILES.business_os);
    const named = Object.values(COMPONENT_CONNECTIONS).flat();

    expect(named.filter(plugin => !loaded.has(plugin))).toEqual([]);
  });
});
