/**
 * A connected calendar blocks hours, and the panel says whether it does.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER SAW
 *
 * Google Calendar connected in availability settings, shown as connected, and
 * not one meeting blocking an hour. On the live account:
 *
 *     calendar_sync_enabled    false
 *     calendar_sync_provider   null
 *     calendar_last_synced_at  null
 *
 * against a healthy `google-calendar` connection with calendar scope. Those two
 * flags are what the cron filters on, so the account was never in a sync batch,
 * and `getExternalBusySlots` returns an empty list before it looks — deleting
 * whatever it had cached on the way out.
 *
 * Connecting a calendar and switching sync on were two separate actions, and
 * ONLY `/api/scheduling/calendar-sync/enable` writes those columns. OAuth
 * succeeding does not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * Reaching the bug needs a real OAuth round trip, a plugin-status response, a
 * cron pass and a week of calendar. What broke is decidable without any of it:
 * a control rendered behind the wrong condition, a handler that swallowed its
 * errors, and a second step that should never have existed. Those stay legible
 * in the source, and each is the kind of thing that creeps back in a refactor.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
/** Comments stripped: the prose here quotes the very code it forbids. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PANEL = 'components/scheduling/CalendarSyncSettings.tsx';
const ROUTE = 'app/api/scheduling/calendar-sync/enable/route.ts';

const panel = code(read(PANEL));
const route = code(read(ROUTE));

describe('connecting a calendar switches sync on', () => {
  it('enables it as part of connecting', () => {
    /*
     * THE BUG, AS ONE ASSERTION. Nobody connects a calendar in availability
     * settings for any purpose other than using it, yet the connection left
     * `calendar_sync_enabled` false and nothing said so.
     */
    expect(panel).toContain('await handleEnableSync(provider)');
  });

  it('only when nothing is syncing yet', () => {
    /*
     * A second calendar connected later must NOT steal the sync from the one
     * already running: `calendar_sync_provider` holds a single provider, so the
     * first would stop silently. That row offers "sync from this one instead",
     * which is the same decision made deliberately.
     */
    expect(panel).toContain('if (provider && !syncEnabled)');
  });

  it('switching to the other calendar is an explicit action', () => {
    expect(panel).toContain('scheduling.calendar_sync.cal_use_instead');
    expect(panel).toContain('onClick={() => handleEnableSync(provider)}');
  });
});

describe('nothing hides the controls behind an expired token', () => {
  it('no render path is gated on is_expired', () => {
    /*
     * A Google ACCESS token lapses every hour by design and renews itself from
     * a refresh token that is still good — `UserProvider` says exactly that and
     * warns the flag "is the wrong basis for telling somebody their connection
     * has died". Gating on it made the only control that turns sync on vanish
     * sixty minutes after connecting.
     */
    expect(panel).not.toMatch(/&&\s*!\w*[Pp]lugin\?\.is_expired/);
    expect(panel).not.toMatch(/is_expired\s*&&/);
  });

  it('a row is judged by whether it is SYNCING, not by its token', () => {
    expect(panel).toContain('const isLive = Boolean(syncEnabled) && activeProvider === provider');
  });
});

describe('a calendar that blocks nothing says so', () => {
  it('draws one row per connected calendar', () => {
    /*
     * "Connected but syncing nothing" was invisible — the state that sent an
     * owner hunting for a switch that had never been pressed. Each row draws
     * its own line, so an idle calendar is dashed and labelled rather than
     * inferred from the absence of something.
     */
    expect(panel).toContain("renderCalendarRow('google_calendar')");
    expect(panel).toContain("renderCalendarRow('outlook')");
    expect(panel).toContain('scheduling.calendar_sync.cal_idle');
  });

  it('the line reflects what that calendar is doing', () => {
    expect(panel).toMatch(/renderDiagram\(\s*stale \? 'bad' : isLive \? 'live' : 'off'/);
  });
});

describe('amber is derived, not guessed', () => {
  it('means the sync has actually stopped answering', () => {
    /*
     * The cron runs every five minutes, so thirty is six missed passes. An
     * hourly token lapse must NOT reach this state: it is not a fault, and
     * treating it as one is what made the panel cry wolf hourly.
     */
    expect(panel).toContain('minutesSinceSync !== null && minutesSinceSync > 30');
  });

  it('only applies to a calendar that is supposed to be syncing', () => {
    expect(panel).toMatch(/const stale = isLive &&/);
  });
});

describe('turning it on loads the diary before the week is redrawn', () => {
  it('the route waits for the first read', () => {
    /* Fire-and-forget meant the caller refreshed the calendar BEFORE any event
       was fetched, so a successful enable looked like nothing happened. */
    expect(route).toContain('await CalendarSyncService.syncExternalEvents(user.id)');
  });

  it('reports what it found and whether it failed', () => {
    expect(route).toContain('events:');
    expect(route).toContain('syncError');
  });

  it('a calendar it could not read does not fail the request', () => {
    /* Saving the setting and reaching Google are two different things. The
       cron retries the second; a 500 would say the first had broken. */
    expect(route).toMatch(/success:\s*true[\s\S]{0,220}syncError/);
  });
});

describe('failures are readable', () => {
  it('the enable handler does not swallow its errors', () => {
    /* `catch { }` with an empty body was the entire error path. */
    const handler = panel.slice(
      panel.indexOf('const handleEnableSync'),
      panel.indexOf('const handleDisableSync')
    );

    expect(handler.length).toBeGreaterThan(0);
    expect(handler).not.toMatch(/catch\s*\{\s*\}/);
    expect(handler).toContain('setConnectionStatus');
  });

  it('the message is rendered, not only stored', () => {
    /* It was written in six places and displayed in none: the only sign of a
       refused action was a coloured dot on a 48px icon. */
    expect(panel).toContain('{connectionStatus.message}');
  });
});

describe('what the rewrite removed stays removed', () => {
  it('no duplicate control for one setting', () => {
    /* A "turn sync off" button used to sit in the same card as the control
       that turned sync off — and it could not say WHICH calendar it stopped. */
    expect(panel).not.toContain("t('scheduling.calendar_sync.disable')");
  });

  it('no connect tile for a calendar already connected', () => {
    /* The same account appeared twice: an icon to press, and a row below
       saying it was done. */
    expect(panel).toContain('const unconnected');
    expect(panel).not.toContain('const renderPluginButton');
    expect(panel).not.toContain('const renderConnectedList');
  });

  it('the platform is drawn with its own mark, not a glyph', () => {
    /* `PluginIcon` maps `business-os` to the app's favicon precisely because
       the platform has no vendor logo. */
    expect(panel).toContain('pluginId="business-os"');
  });
});

describe('the copy exists in every language', () => {
  it.each([
    ['en', 'lib/business-os/translations/en.ts'],
    ['he', 'lib/business-os/translations/he.ts'],
    ['es', 'lib/business-os/translations/es.ts'],
  ])('%s carries the panel keys', (_lang, file) => {
    /* A missing key renders as the key itself, which is worse than silence. */
    const source = read(file);

    for (const key of [
      'cal_none_title',
      'cal_none_sub',
      'cal_blocking',
      'cal_idle',
      'cal_idle_sub',
      'cal_stale',
      'cal_meetings',
      'cal_use_instead',
      'cal_menu_disconnect',
    ]) {
      expect(source).toContain(`'scheduling.calendar_sync.${key}'`);
    }
  });
});
