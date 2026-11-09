/**
 * An agent stopped by a dead connection offers the reconnection.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER HAD
 *
 * A stopped agent said "Reconnect the app and try again" — no app named, no
 * control — because nothing downstream knew WHICH plugin had failed.
 * `translateAuthIssue` looks for one, was handed a bare string, and wrote
 * "A connected app needs to be reconnected".
 *
 * And in Business OS there was nowhere to go. It has no connections screen; its
 * settings are Business, Profile, Invoice, Plan, Invite, Marketing and Password.
 * Only a MAILBOX could be reconnected at all, through the channels card. An
 * agent blocked on Google Sheets was told to reconnect something it had no way
 * to reach.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE KEY TRAVELS THE WHOLE WAY, OR THE BUTTON CANNOT EXIST
 *
 * `connectPlugin` takes a plugin key and nothing else, so every link in the
 * chain is load-bearing:
 *
 *   StepOutput.plugin            the pilot always knew it
 *     → PilotResult.failedStepPlugin
 *       → markFailed(…, plugin)
 *         → result.failure.plugin
 *           → the detector and the install list
 *             → the card's `stopped.plugin`
 *               → connectPlugin(user.id, plugin)
 *
 * Break any one and the row silently loses its button, which looks exactly like
 * a failure that is not a connection. That is why this is pinned end to end.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CARD = 'components/business-os/insight/RunningAgentsCard.tsx';
const card = code(read(CARD));

describe('the plugin key survives every hop', () => {
  it.each([
    ['the pilot names the failing step plugin', 'lib/pilot/WorkflowPilot.ts', 'failedStepPlugin:'],
    ['the result type carries it', 'lib/pilot/types.ts', 'failedStepPlugin?: string'],
    ['the runner passes it on', 'lib/execution/scheduledAgentRunner.ts', 'failedStepPlugin'],
    ['the execution row stores it', 'lib/repositories/ScheduledExecutionRepository.ts', 'plugin ? { plugin }'],
    ['the detector reads it back', 'lib/business-os/insight/detectors/catalog/AgentsStoppedDetector.ts', 'failure.plugin'],
    ['the install list reads it back', 'lib/business-os/automations/install.ts', 'failure.plugin'],
  ])('%s', (_label, file, needle) => {
    expect(code(read(file))).toContain(needle);
  });

  it('and the card ends up with it', () => {
    /*
     * The key still travels all the way, and still earns its keep: it is what
     * lets `translateAuthIssue` NAME the app in the sentence instead of writing
     * "A connected app needs to be reconnected".
     *
     * It no longer gates the BUTTON — see the test below. A control that only
     * appears when the failure record is perfect is absent exactly when the
     * record is old, which is when an owner has been stuck longest.
     */
    expect(card).toContain('plugin?: string');
  });
});

describe('the button', () => {
  it('uses the same connect path the calendar panel uses', () => {
    /* Not a new pattern: `CalendarSyncSettings` already connects a plugin from
       inside Business OS with this exact client. */
    expect(card).toContain("from '@/lib/client/plugin-api-client'");
    expect(card).toMatch(/getPluginAPIClient\(\)\.connectPlugin\(user\.id, pluginKey\)/);
  });

  it('does not require the failure to have named the plugin', () => {
    /*
     * It used to require `category: 'reconnect'` AND a plugin key. The category
     * is dependable now — it is derived on read, so even a failure recorded by
     * an older deploy gets one — but the PLUGIN key is not: nothing wrote it
     * before today. A mailbox agent that had failed for ten days was therefore
     * offered nothing, which is exactly when the owner needed it.
     *
     * So the key is used when present and the agent's own plugin list fills in
     * when it is not. `plugins` is on every row and always populated.
     */
    expect(card).toContain('reconnectable(agent).map(');
    expect(card).toMatch(/candidates = unconnected \? agent\.missingPlugins : \(agent\.plugins \?\? \[\]\)/);
  });

  it('and only for a CONNECTION problem, not any problem', () => {
    /*
     * "Is the agent unwell" was too loose by half. An agent stopped by our own
     * fault renders "this one is on us… it will keep trying" — and carried a
     * Reconnect button underneath it, inviting the owner to re-authorise
     * something that was never broken. They sign in, nothing changes, and the
     * control has taught them it means nothing.
     */
    expect(card).toMatch(/const refused = agent\.stopped\?\.category === 'reconnect'/);
    expect(card).toMatch(/const unconnected = agent\.blocked && \(agent\.missingPlugins \?\? \[\]\)\.length > 0/);
    expect(card).toMatch(/if \(!refused && !unconnected\) return \[\]/);
  });

  it('and names the one the provider actually refused, where it is known', () => {
    /* Offering every plugin an agent touches when we know which one failed is
       noise; guessing when we do not is worse. */
    expect(card).toMatch(/if \(refused && agent\.stopped\?\.plugin\) return \[agent\.stopped\.plugin\]/);
  });

  it('never offering the platform plugin, which has no account to sign into', () => {
    expect(card).toContain("PLATFORM_PLUGINS = new Set(['business-os'])");
    expect(card).toMatch(/filter\(p => !PLATFORM_PLUGINS\.has\(p\)\)/);
  });

  it('and the button names what it opens', () => {
    expect(card).toContain('automation.reconnect_named');
    for (const lang of ['en', 'he', 'es']) {
      expect(read(`lib/business-os/translations/${lang}.ts`)).toContain(
        "'automation.reconnect_named':"
      );
    }
  });

  it('says what went wrong when it cannot connect', () => {
    /* A blocked popup is the common case and the owner fixes it in a second —
       but only if told. Swallowing it leaves a button that does nothing. */
    expect(card).toContain('setReconnectError');
    expect(card).toContain('{reconnectError}');
  });

  it('and the row stops reading as stopped once it works', () => {
    expect(card).toMatch(/refreshPlugins\?\.\(\)[\s\S]{0,80}load\(\)/);
  });

  it('in every language', () => {
    for (const lang of ['en', 'he', 'es']) {
      const dict = read(`lib/business-os/translations/${lang}.ts`);
      expect(dict).toContain("'automation.reconnect':");
      expect(dict).toContain("'automation.reconnect_failed':");
    }
  });
});

describe('a dead connection is translated, not passed through', () => {
  const repo = code(read('lib/repositories/ScheduledExecutionRepository.ts'));

  it('auth failures reach translateAuthIssue', () => {
    /*
     * `toUserFacing` handed a STRING returns "Heads up" and the string verbatim
     * — it never reaches the auth branch. So what the owner read on a Business
     * OS dashboard was the plugin definition's own English, including
     * "Settings → Connected Apps", a screen Business OS does not have.
     *
     * The plugin definitions are deliberately NOT changed: that path is real in
     * the V2 agent builder, which shares those files.
     */
    expect(repo).toContain("source: 'auth'");
    expect(repo).toContain('looksLikeAuth');
  });

  it('and the plugin goes with them, so the sentence can name the app', () => {
    expect(repo).toMatch(/source: 'auth', plugin, message/);
  });
});
