/**
 * The mailbox agents reach this business's data through the business-os plugin.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE DOOR MATTERS WHEN BOTH DOORS WORK
 *
 * The plans used to call `crm.capture_enquiry`. It worked. It also went around
 * the front door: the `business-os` plugin is the channel between the execution
 * layer and the data layer, and it is what carries tenant scoping — the
 * executor's own comment calls `connection.user_id` "the ONLY source of tenant
 * scoping. Deliberately not read from parameters." A second plugin reaching the
 * same records is a second answer to who may touch an account.
 *
 * Nothing was reimplemented. Both doors call `captureEnquiryFromEmail`, which
 * is Business OS code and always was — the CRM plugin was only ever a delivery
 * channel for it. So this was a missing catalog action, which is the fourth
 * time that has been the fix (`contacts.invite`, `invoices.remind`,
 * `proposals.remind`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PART THAT NEARLY WENT WRONG
 *
 * The two plugins answer in different shapes. `crm` returned its fields flat;
 * `business-os` returns `{ applied, summary, row }` with the handler's answer
 * in `row`. The plan's mark-as-read guard reads that answer, and it is the
 * whole idempotency: mark read unconditionally and an unparseable enquiry is
 * consumed with no contact to show for it — nobody ever sees it again.
 *
 * Left at `filing_result.filed` the guard would have read `undefined`, never
 * marked anything read, and re-filed every message on every tick. A test
 * caught it. This file is that test, kept.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const PLANS_DIR = join(process.cwd(), 'lib/business-os/leads/agent');
const SETUP = join(process.cwd(), 'lib/business-os/leads/inboxChannelSetup.ts');

interface Step {
  type?: string;
  plugin?: string;
  action?: string;
  params?: Record<string, unknown>;
  output_variable?: string;
  condition?: { field?: string; operator?: string; value?: unknown };
  steps?: Step[];
  scatter?: { steps?: Step[] };
}

function planFiles(): string[] {
  return readdirSync(PLANS_DIR).filter((f) => f.endsWith('.steps.json'));
}

function flatten(file: string): Step[] {
  const plan = JSON.parse(readFileSync(join(PLANS_DIR, file), 'utf-8')) as Step[];
  const out: Step[] = [];
  const walk = (steps: Step[]) => {
    for (const s of steps) {
      out.push(s);
      if (s.scatter?.steps) walk(s.scatter.steps);
      if (s.steps) walk(s.steps);
    }
  };
  walk(plan);
  return out;
}

describe('the CRM plugin is retired from the mailbox path', () => {
  it('no mailbox plan calls it', () => {
    for (const file of planFiles()) {
      const callers = flatten(file).filter((s) => s.plugin === 'crm');
      expect(`${file}: ${callers.length} crm call(s)`).toBe(`${file}: 0 crm call(s)`);
    }
  });

  it('the agent is granted business-os rather than crm', async () => {
    /*
     * `plugins_required` is what the runtime grants the run, so it has to name
     * the plugin the plan actually calls.
     *
     * Asserted on the function rather than on the setup file's text: the first
     * version of this grepped for the literal `[provider, 'crm']`, and broke
     * the moment that line became a call to `inboxPluginsRequired`. A test that
     * reads source is testing the spelling; this reads the contract.
     */
    const { inboxPluginsRequired } = await import('../inboxPlans');
    const { SUPPORTED_PROVIDERS } = await import('../inboxProviders');

    for (const provider of SUPPORTED_PROVIDERS) {
      const granted = inboxPluginsRequired(provider);
      expect([...granted].sort()).toEqual([provider, 'business-os'].sort());
      expect(granted).not.toContain('crm');
    }

    /* And the setup module really uses it, rather than declaring its own. */
    const setup = readFileSync(SETUP, 'utf-8');
    expect(setup).toContain('plugins_required: inboxPluginsRequired(provider)');
    expect(setup).not.toMatch(/plugins_required:\s*\[provider, 'crm'\]/);
  });
});

describe('every plan files through the business-os door', () => {
  it('calls capture_enquiry_contacts, once', () => {
    for (const file of planFiles()) {
      const filing = flatten(file).filter(
        (s) => s.plugin === 'business-os' && s.action === 'capture_enquiry_contacts'
      );
      expect(`${file}: ${filing.length}`).toBe(`${file}: 1`);
    }
  });

  it('passes its fields under `data`, which is what the plugin reads', () => {
    /*
     * `BusinessOsPluginExecutor.write` builds the mutate as
     * `data: parameters?.data`. Flat params — the shape the CRM plugin took —
     * would arrive as an empty payload and file nothing, silently.
     */
    for (const file of planFiles()) {
      const step = flatten(file).find((s) => s.action === 'capture_enquiry_contacts')!;
      expect(Object.keys(step.params ?? {})).toEqual(['data']);

      const fields = (step.params!.data ?? {}) as Record<string, unknown>;
      /* The template is what makes the parsing deterministic rather than a
         guess, and the body is the message itself. */
      expect(Object.keys(fields)).toContain('template');
      expect(Object.keys(fields)).toContain('raw_body');
      expect(Object.keys(fields)).toContain('subject');
    }
  });

  it('names the mailbox it came from, so the channel can count its own leads', () => {
    for (const file of planFiles()) {
      const step = flatten(file).find((s) => s.action === 'capture_enquiry_contacts')!;
      const fields = step.params!.data as Record<string, unknown>;
      const mailbox = flatten(file).find((s) => s.action === 'search_emails')!.plugin;
      expect(`${file}: via=${fields.via}`).toBe(`${file}: via=${mailbox}`);
    }
  });
});

describe('the mark-as-read guard reads where the answer now is', () => {
  it('guards on filing_result.row.filed', () => {
    /*
     * THE WHOLE IDEMPOTENCY. `business-os` answers
     * `{ applied, summary, row }` and the handler's result is `row`, where the
     * CRM plugin returned its fields flat. A guard still reading
     * `filing_result.filed` gets `undefined`, never fires, and the message is
     * re-filed on every tick.
     */
    for (const file of planFiles()) {
      const guard = flatten(file).find((s) => s.type === 'conditional');
      expect(`${file}: ${guard?.condition?.field}`).toBe(`${file}: filing_result.row.filed`);
      expect(guard?.condition).toMatchObject({ operator: 'equals', value: true });
    }
  });

  it('marks read INSIDE the guard, never beside it', () => {
    /* Marking read unconditionally consumes an enquiry nobody could parse and
       nobody will ever see again. */
    for (const file of planFiles()) {
      const steps = flatten(file);
      const guard = steps.find((s) => s.type === 'conditional')!;
      const mailbox = steps.find((s) => s.action === 'search_emails')!.plugin;

      const insideGuard = (guard.steps ?? []).flatMap((s) => [s, ...(s.steps ?? [])]);
      const markRead = insideGuard.find((s) => s.plugin === mailbox && s.action !== 'search_emails');

      expect(`${file}: mark-read inside the guard = ${Boolean(markRead)}`).toBe(
        `${file}: mark-read inside the guard = true`
      );
    }
  });
});

describe('the mailbox read itself is untouched', () => {
  it('still goes to the owner own mailbox plugin, and only that one', () => {
    /* Gmail and Outlook were deliberately NOT changed: they are how the mail is
       read, and the only thing that moved is where the lead is filed. */
    for (const file of planFiles()) {
      const steps = flatten(file);
      const mailPlugins = new Set(
        steps.map((s) => s.plugin).filter((p): p is string => p === 'google-mail' || p === 'outlook')
      );
      expect(`${file}: ${[...mailPlugins].join(',')}`).toBe(
        `${file}: ${file.includes('outlook') ? 'outlook' : 'google-mail'}`
      );
    }
  });
});
