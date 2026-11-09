/**
 * A mailbox the provider has refused is not a connected mailbox.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER SAW
 *
 * Two screenshots, same morning, both reporting a healthy Gmail channel:
 *
 *   the setup dialog's tile   "מוגדר · שינוי"   (set up · change)
 *   the channels card's row   a green dot
 *
 * while the agent behind it had failed every run for four days with "Your Gmail
 * connection has expired".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE SURFACES WERE WRONG
 *
 * Both asked `plugin_connections.status === 'active'`, and that column cannot
 * go stale in the one direction that matters:
 * `PluginConnectionRepository.upsert` writes `status: 'active'` unconditionally,
 * overriding whatever its caller passes, and nothing anywhere downgrades it when
 * a provider refuses the grant. So a revoked mailbox reads active for ever.
 *
 * `settings.refresh_failed_at` is the fact that knows better. `refreshToken`
 * writes it when the provider REFUSES a refresh, and deliberately only for
 * `grant_revoked` — never for a transient failure.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MUST NOT COME BACK
 *
 * An EXPIRY check. An access token lapsing is normal and self-healing:
 * `connectionsReady` verifies and refreshes before every run, and reading
 * `expires_at` here would mark a working mailbox broken once an hour. That
 * mistake was already made once on the calendar panel, and the live Gmail
 * connection that triggered this investigation had an `expires_at` eleven hours
 * in the past while refreshing perfectly well.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CHANNEL = 'lib/business-os/leads/inboxChannel.ts';
const DIALOG = 'components/business-os/leads/InboxChannelSetupDialog.tsx';

const channel = code(read(CHANNEL));
const dialog = code(read(DIALOG));

describe('what counts as a connected mailbox', () => {
  it('a refused grant is excluded', () => {
    expect(channel).toContain('refresh_failed_at');
    expect(channel).toMatch(/\.filter\([\s\S]{0,160}refresh_failed_at/);
  });

  it('and the read carries the marker that decides it', () => {
    /* Three columns, not two and not `*`. A select that drops `settings` makes
       the filter above silently vacuous — every row would pass it. */
    expect(code(read('lib/repositories/PluginConnectionRepository.ts'))).toContain(
      "select('plugin_name, status, settings')"
    );
  });

  it('status alone is no longer the whole test', () => {
    const connected = channel.slice(
      channel.indexOf('const connected ='),
      channel.indexOf('.map(c => c.plugin_name')
    );

    expect(connected).toContain("status === 'active'");
    expect(connected).toContain('refresh_failed_at');
  });

  it('and an expiry is NOT treated as a broken connection', () => {
    /*
     * The mistake this must never become. `expires_at` in the past is the
     * ordinary state of a healthy connection between runs.
     */
    const connected = channel.slice(
      channel.indexOf('const connected ='),
      channel.indexOf('.map(c => c.plugin_name')
    );

    expect(connected).not.toMatch(/expires_at|is_expired/);
  });
});

describe('the setup dialog says what is actually true', () => {
  it('a channel row is not enough to read as set up', () => {
    /* `done` asked only whether a channel ROW existed, so a mailbox whose grant
       had been revoked still offered "set up · change". */
    expect(dialog).toContain('const brokenChannel');
    expect(dialog).toMatch(/const done = Boolean\(channelRow\) && !brokenChannel/);
  });

  it('and a broken one offers the thing that fixes it', () => {
    expect(dialog).toMatch(/brokenChannel\s*\?[\s\S]{0,200}copy\.reconnect/);
  });

  it('in every language', () => {
    /* A missing key renders as the key itself. */
    for (const lang of ['en', 'he', 'es']) {
      expect(read(`lib/business-os/translations/${lang}.ts`)).toContain(
        "'leads.inbox.tile.reconnect':"
      );
    }
  });
});

describe('a refresh that worked says so', () => {
  it('stamps the column named after the question', () => {
    /*
     * `last_refreshed_at` was declared in `plugin-types.ts`, present on the
     * table, and written by NOTHING — so every row read NEVER however often it
     * refreshed. It misled a real investigation on 2026-11-09: a Gmail
     * connection refreshing daily reported NEVER, and the agent was called dead
     * when it had been completing its runs for two days.
     */
    const service = code(read('lib/server/user-plugin-connections.ts'));
    const refresh = service.slice(service.indexOf('async refreshToken('));

    expect(refresh).toMatch(/last_refreshed_at: new Date\(\)\.toISOString\(\)/);
  });

  it('and only on a refresh, never on a first connect', () => {
    /* A connect is an authorisation, not a refresh. Conflating them loses the
       one fact the column exists to carry. */
    const service = code(read('lib/server/user-plugin-connections.ts'));

    expect(service.match(/last_refreshed_at:/g) ?? []).toHaveLength(1);
  });
});
