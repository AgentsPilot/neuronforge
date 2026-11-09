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
    expect(card).toContain('plugin?: string');
    expect(card).toContain('agent.stopped.plugin');
  });
});

describe('the button', () => {
  it('uses the same connect path the calendar panel uses', () => {
    /* Not a new pattern: `CalendarSyncSettings` already connects a plugin from
       inside Business OS with this exact client. */
    expect(card).toContain("from '@/lib/client/plugin-api-client'");
    expect(card).toMatch(/getPluginAPIClient\(\)\.connectPlugin\(user\.id, pluginKey\)/);
  });

  it('appears only for a connection failure we can actually name', () => {
    /* A button that cannot name its plugin has nothing to open, and a failure
       that is not a connection has nothing to reconnect. Both conditions are
       the server's, which is the only side that saw the failing step. */
    expect(card).toMatch(
      /agent\.stopped\.category === 'reconnect' && agent\.stopped\.plugin/
    );
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
