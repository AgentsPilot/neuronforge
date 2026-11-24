/**
 * An installed agent's answers can be changed without losing the agent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS MISSING
 *
 * The install dialog asked three questions — which spreadsheet, which tab,
 * which column — and then closed for ever. There was no path back to it: the
 * only control that opened it was the install button on the AVAILABLE list,
 * and an installed agent is not on that list.
 *
 * So an owner whose leads moved to a different sheet, or whose tab was
 * renamed, had one route: remove the agent and adopt it again. That loses its
 * schedule, its run history and its outcome record — everything the card uses
 * to tell them whether it is working — to a changed file name.
 *
 * The schedule half of the same dialog had already been given a way back (see
 * `controlSchema`'s note on `action: 'schedule'`). This is the other half.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A SOURCE GUARD, AND WHY
 *
 * The rules worth protecting here are about what the code is ALLOWED to do —
 * which door it goes through, what it accepts, what it refuses — and each is
 * one line that a later edit could quietly drop. Running them would need a
 * database, a catalogue and a session; reading them needs neither, and the
 * failure these guard against is removal, not miscomputation.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const INSTALL = read('lib/business-os/automations/install.ts');
const ROUTE = read('app/api/business-os/automation-agents/route.ts');
const CARD = read('components/business-os/insight/RunningAgentsCard.tsx');
const DIALOG = read('components/business-os/insight/AgentInputsDialog.tsx');
const DASHBOARD = read('components/business-os/insight/LiveDashboard.tsx');

describe('changing what an agent was told', () => {
  it('goes through the same door as every other control', () => {
    /*
     * `isControllableAgent` is the gate behind pause, resume and run: this
     * owner's own scheduled agent, or nothing happens. The agent id arrives
     * from a browser and must never be trusted for more than a scoped lookup.
     */
    const fn = INSTALL.slice(
      INSTALL.indexOf('export async function configureAutomation'),
      INSTALL.indexOf('export async function updateAgentSchedule')
    );
    expect(fn).toMatch(/if \(!\(await isControllableAgent\(userId, agentId\)\)\)/);
  });

  it('accepts only the questions this agent actually asks', () => {
    /*
     * The row is read by the runner and handed to a plan as variables. An
     * arbitrary key from a request body is exactly how that becomes a place to
     * park anything, so the catalogue's own schema is the allow-list.
     */
    const fn = INSTALL.slice(INSTALL.indexOf('export async function configureAutomation'));
    expect(fn).toMatch(/const asked = new Set\(schema\.map\(field => field\.name\)\)/);
    expect(fn).toMatch(/if \(asked\.has\(name\)\) accepted\[name\] = value\.trim\(\)/);
  });

  it('merges rather than replaces', () => {
    /* An owner opening the dialog to change one answer must not lose the
       others to a field the dialog did not draw this time. */
    const fn = INSTALL.slice(INSTALL.indexOf('export async function configureAutomation'));
    expect(fn).toMatch(/const merged = \{ \.\.\.\(existing\?\.input_values \?\? \{\}\), \.\.\.accepted \}/);
  });

  it('refuses to leave a required answer blank', () => {
    /*
     * Blanking the spreadsheet id leaves an agent that runs on a schedule and
     * fails at its first step — worse than refusing the change, because the
     * owner would have to work out from a failed run what the dialog could
     * have told them at the time.
     */
    const fn = INSTALL.slice(INSTALL.indexOf('export async function configureAutomation'));
    expect(fn).toMatch(/\.filter\(field => field\.required\)/);
    expect(fn).toMatch(/return \{ ok: false, reason: 'incomplete' \}/);
  });

  it('audits which questions were answered, never the answers', () => {
    /*
     * A spreadsheet id names a document and a tab names what the business
     * keeps in it. The keys are what an audit of this action is for.
     */
    const handler = ROUTE.slice(ROUTE.indexOf("if (validated.action === 'configure')"));
    expect(handler).toMatch(/action: 'AUTOMATION_AGENT_RECONFIGURED'/);
    expect(handler).toMatch(/details: \{ fields: Object\.keys\(validated\.values \?\? \{\}\)\.sort\(\) \}/);
    /* The values themselves must not reach the entry. */
    expect(handler).not.toMatch(/details: \{[^}]*values/);
  });

  it('bounds what can be sent, without pretending to know the questions', () => {
    /* A shape here, the meaning in `configureAutomation` — the same division
       the schedule fields use. Only the catalogue knows the key names. */
    expect(ROUTE).toMatch(/values: z\.record\(z\.string\(\), z\.string\(\)\.trim\(\)\.max\(500\)\)\.optional\(\)/);
    expect(ROUTE).toMatch(/action: z\.enum\(\['pause', 'resume', 'schedule', 'run', 'configure'\]\)/);
  });
});

describe('the row that offers it', () => {
  it('carries the questions and the answers from the server', () => {
    expect(INSTALL).toMatch(/inputs: NonNullable<AutomationAgent\['inputSchema'\]>;\n  inputValues: Record<string, unknown>;/);
    /* One batched read for the list, like every other per-list read here —
       not one round trip per row. */
    expect(INSTALL).toMatch(/const answersByAgent = await answersFor\(userId, \(data \|\| \[\]\)\.map\(a => a\.id\)\)/);
  });

  it('shows no control on an agent that asks nothing', () => {
    expect(CARD).toMatch(/\{agent\.inputs\.length > 0 && onReconfigure && \(/);
  });

  it('sends the mail channel to its own editor instead', () => {
    /*
     * That row has no questions to reopen: its sender and subject were
     * MEASURED from the owner's own mail, not asked for. The wizard that
     * wrote them already takes the update path when a channel exists, and it
     * is mounted by the page — so the row raises the action the dashboard
     * already handles rather than trying to open it here.
     */
    expect(CARD).toMatch(/agent\.family === 'mailbox' && onEditChannel/);
    expect(CARD).toMatch(/onAction\('connect_inbox_channel'\)/);
    expect(DASHBOARD).toMatch(/<RunningAgentsCard onAction=\{onAction\} \/>/);
  });

  it('saves through PATCH, because the agent already exists', () => {
    const fn = CARD.slice(CARD.indexOf('const reconfigure = useCallback'));
    expect(fn).toMatch(/method: 'PATCH'/);
    expect(fn).toMatch(/action: 'configure'/);
    /* And the list is re-read, so the row and the dialog cannot drift. */
    expect(fn).toMatch(/await load\(\)/);
  });
});

describe('the dialog, reopened', () => {
  it('opens holding what was answered last time', () => {
    expect(DIALOG).toMatch(/setValues\(initialValues \? \{ \.\.\.initialValues \} : \{\}\)/);
  });

  it('seeds on OPEN, not on the prop', () => {
    /*
     * The host builds `initialValues` inline, so a dependency on it would
     * re-seed on every render of the page and overwrite what the owner is
     * typing. The dialog opening is the one moment those answers are wanted.
     */
    const effect = DIALOG.slice(
      DIALOG.indexOf('setValues(initialValues'),
      DIALOG.indexOf('setValues(initialValues') + 200
    );
    expect(effect).toMatch(/\}, \[open\]\)/);
  });

  it('does not say "switch it on" about something already on', () => {
    expect(DIALOG).toMatch(/confirmLabel \|\| t\('automation\.switch_on'\)/);
    expect(DIALOG).toMatch(/automation\.inputs_intro_edit/);
  });

  it('is a second instance, not the install one in disguise', () => {
    /*
     * The install flow carries a variant choice, a plugin-connect path and a
     * busy state keyed on the automation being created — none of which mean
     * anything on an agent that exists. Sharing one element would make every
     * branch ask which kind of press it was looking at.
     */
    expect(CARD).toMatch(/open=\{!!reconfiguring\}/);
    expect(CARD).toMatch(/open=\{!!asking\}/);
  });

  it('carries the three strings in every language', () => {
    for (const lang of ['en', 'es', 'he']) {
      const file = read(`lib/business-os/translations/${lang}.ts`);
      for (const key of [
        'automation.inputs_intro_edit',
        'automation.change_inputs',
        'automation.change_watch',
      ]) {
        expect(file).toContain(`'${key}'`);
      }
    }
  });
});
