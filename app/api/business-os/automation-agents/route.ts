/**
 * The automations this business has put to work, and the controls for them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * An automation is an agent, so every verb here is an agent verb — install,
 * pause, resume, remove. There is no automation table and no second permission
 * model.
 *
 * This is the half the product has been missing. `insight_automations` rows
 * could already be created from the advisor card, and the copy told the owner
 * to "turn it off in Operation" — a screen that does not exist. A rule the
 * owner cannot see or stop is not an automation, it is something that happens
 * to them.
 *
 * Deliberately NOT at `/api/business-os/automations`: that path belongs to the
 * `insight_automations` system, which is a different thing with its own
 * lifecycle. Two endpoints called "automations" acting on two tables is exactly
 * the confusion this work exists to remove.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { automationById } from '@/lib/business-os/automations/catalog';
import { automationApplies } from '@/lib/business-os/gaps/automationApplies';
/*
 * ⟨unscoped-by-design⟩ — `InsightRepository` takes its client, and the service
 * role is what every other insight route hands it. Every call below passes
 * `user.id`, and `markAutomated` filters on it, so the scoping is the same;
 * what the service role buys is not depending on a request cookie here.
 */
import { InsightRepository } from '@/lib/business-os/insight/repository/InsightRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import {
  installAutomation,
  installedAutomations,
  pauseAutomation,
  removeAutomation,
  resumeAutomation,
  updateAgentSchedule,
} from '@/lib/business-os/automations/install';

const logger = createLogger({ module: 'AutomationAgentsAPI' });
const auditTrail = AuditTrailService.getInstance();

const installSchema = z.object({
  automationId: z.string().min(1),
  /*
   * How often it should run. Optional at the API — the catalogue's default
   * applies without it — but the install dialog is expected to ask, because
   * how often the platform writes to a client in the owner's name is a
   * decision that belongs to them, made before it is switched on.
   *
   * A named cadence, never a cron string: an owner typing `* * * * *` into a
   * free field is a mailshot, and the install would have no way to tell that
   * from a deliberate choice.
   */
  cadence: z.enum(['daily', 'every_3_days', 'weekly', 'fortnightly', 'monthly']).optional(),

  /*
   * How often, as a number and a unit, which supersedes `cadence`.
   *
   * The five named cadences all fired at 09:00 and all meant a number of days,
   * so an owner could not ask for every ten days or every four hours, and the
   * mailbox wizard — asking the same question in minutes — could not share the
   * control. This is that one control's answer.
   *
   * Still not a cron string, for the reason above: a free expression field is a
   * mailshot one keystroke away, and the install could not tell that from a
   * deliberate choice. A number and one of three units can only ever say "how
   * often", and `installAutomation` clamps it to the range the automation's own
   * `cadenceChoices` describe.
   *
   * The ceilings here are a sanity bound, not the policy. The policy is the
   * per-automation range, because only the catalogue knows that writing to
   * clients quiet for a year must never become hourly.
   */
  schedule: z
    .object({
      every: z.number().int().positive().max(1000),
      unit: z.enum(['minutes', 'hours', 'days']),
    })
    .optional(),

  /*
   * The insight this was installed in answer to, when a card is what offered it.
   *
   * Without it the card does not close. The press installs the agent and the
   * insight stays `new`, so the next page load shows the same card offering an
   * agent that is already running — and the owner's only way to make it go is
   * to dismiss it, which reads as "this did not matter".
   *
   * Optional, because an install from a management screen answers no insight.
   */
  /*
   * How long it keeps trying before giving up on one person, in days.
   *
   * The second owner choice, asked on the same dialog as the cadence. Checked
   * against the automation's own list inside `installAutomation`, so a number
   * it never offered is ignored rather than honoured — the bound decides who
   * the platform writes to in this owner's name.
   */
  stopAfterDays: z.number().int().positive().max(1095).optional(),

  insightId: z.string().uuid().optional(),

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * "I GOT IT" — CLOSE THE CARD, CHANGE NOTHING ELSE.
   *
   * Two detectors can report the same problem at different altitudes —
   * `cash_ar_overdue` names the four invoices that are late, `cash_revenue_at_risk`
   * names everything outstanding — and the overlap registry keeps both cards on
   * purpose. So an agent switched on from one leaves the other still open about
   * work already being handled.
   *
   * That card needs an ending, and it is NOT a second install. Running the
   * normal path would reach `installAutomation`, which treats a re-install of a
   * PAUSED agent as the owner asking for it back and reactivates it. An owner
   * acknowledging a card has not asked for that, and silently un-pausing
   * something they deliberately stopped is the kind of surprise this whole
   * surface exists to avoid.
   *
   * So this marks the insight and touches no agent.
   * ───────────────────────────────────────────────────────────────────────────
   */
  acknowledgeOnly: z.boolean().optional(),
});

const controlSchema = z.object({
  agentId: z.string().uuid(),
  action: z.enum(['pause', 'resume', 'schedule']),

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE TWO ANSWERS, FOR `action: 'schedule'`.
   *
   * An owner answered these once on the dialog that installed the agent and
   * then had no way back: a business that got busier could not slow its own
   * chaser without removing the agent and adopting it again, which loses its
   * history.
   *
   * Validated as a SHAPE here and bounded in `updateAgentSchedule`, the same
   * division the install path uses. Only the catalogue knows that
   * `win_back_quiet_clients` must never become hourly, and a copy of every
   * automation's floor in this schema would be the second place to change and
   * the first one somebody forgot.
   *
   * Still not a cron string: a field that could say `* * * * *` is a mailshot
   * one keystroke away, and nothing downstream could tell that from a
   * deliberate choice.
   * ───────────────────────────────────────────────────────────────────────────
   */
  schedule: z
    .object({
      every: z.number().int().positive().max(1000),
      unit: z.enum(['minutes', 'hours', 'days']),
    })
    .optional(),
  stopAfterDays: z.number().int().positive().max(1095).optional(),

  /*
   * The stop rule as a number and a unit, which supersedes the day count.
   *
   * The mailbox is the one family that may answer in HOURS — its window is an
   * ISO instant handed to a mail search, where an adopted agent's reaches BizQL
   * as a whole number of days. `stopAfterDays` cannot carry that: twelve hours
   * rounds to one day in it, so a control sending only a number could never
   * change the unit.
   */
  stopAfter: z
    .object({
      every: z.number().int().positive().max(1000),
      unit: z.enum(['minutes', 'hours', 'days']),
    })
    .optional(),
});

const removeSchema = z.object({
  agentId: z.string().uuid(),
});

/** What this business currently has running. */
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const installed = await installedAutomations(user.id);

    return NextResponse.json({ success: true, data: installed });
  } catch (error) {
    requestLogger.error({ err: error }, 'Could not list automation agents');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}

/** Put one to work. */
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const validated = installSchema.parse(await request.json());

    /*
     * From the catalogue, never from the caller. The request names WHICH
     * automation, and everything else — the plan, the schedule, the plugins —
     * comes from the committed entry. A caller that could supply steps could
     * make the platform send anything to anyone.
     */
    const automation = automationById(validated.automationId);

    if (!automation) {
      return NextResponse.json(
        { success: false, error: 'No such automation', code: 'unknown_automation' },
        { status: 404 }
      );
    }

    /*
     * The acknowledgement, before anything else is considered.
     *
     * Refused unless the automation really is installed: "I got it" means "an
     * agent has this", and closing an insight on the strength of an agent that
     * does not exist is the silent-success failure in a new costume.
     */
    if (validated.acknowledgeOnly) {
      if (!validated.insightId) {
        return NextResponse.json(
          { success: false, error: 'Nothing to acknowledge', code: 'no_insight' },
          { status: 400 }
        );
      }

      const installed = await installedAutomations(user.id);
      const covering = installed.find(row => row.automationId === automation.id);

      if (!covering) {
        return NextResponse.json(
          { success: false, error: 'That automation is not installed', code: 'not_installed' },
          { status: 409 }
        );
      }

      const marked = await new InsightRepository(supabaseServer).markAutomated(
        validated.insightId,
        user.id
      );

      if (marked.error) {
        requestLogger.error(
          { err: marked.error, insightId: validated.insightId },
          'Could not close the insight'
        );
        return NextResponse.json(
          { success: false, error: 'Could not close that card' },
          { status: 500 }
        );
      }

      requestLogger.info(
        { userId: user.id, automationId: automation.id, insightId: validated.insightId },
        'Insight acknowledged as covered by an installed automation'
      );

      return NextResponse.json({
        success: true,
        data: { acknowledged: true, agentId: covering.agentId },
      });
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE REQUIREMENT, ENFORCED HERE BECAUSE THIS IS WHERE IT CANNOT BE SKIPPED.
     *
     * Every agent declares `requires` — "sends quotes", "bills for anything",
     * "may lawfully send marketing" — and until this check existed, nothing
     * read it. The field was decoration: the card offered whatever the
     * catalogue matched, and an owner could install an automation whose sends
     * are refused at the transport on every run.
     *
     * `can_send_marketing` is the one that bites today.
     * `MARKETING_SENDING_ENABLED` is false platform-wide until unsubscribe
     * support ships, so an invite-based agent installs happily and writes to
     * nobody, while telling the owner their clients are being followed up.
     *
     * 409 rather than 403: nothing is wrong with the caller or the request.
     * The business is not in a state where this automation can do its job, and
     * `code` names which state so the card can say so in words.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (!(await automationApplies(user.id, automation as never))) {
      requestLogger.info(
        { userId: user.id, automationId: automation.id, requires: automation.requires },
        'Refused to install an automation this business cannot use yet'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'This automation cannot run for this business yet',
          code: 'requirement_unmet',
          requires: automation.requires,
        },
        { status: 409 }
      );
    }

    const outcome = await installAutomation(
      user.id,
      automation,
      validated.cadence,
      validated.stopAfterDays,
      validated.schedule
    );

    if (!outcome.ok) {
      requestLogger.error(
        { userId: user.id, automationId: automation.id },
        'Could not install automation'
      );
      return NextResponse.json(
        { success: false, error: 'Could not install the automation' },
        { status: 500 }
      );
    }

    /*
     * Close the card that offered this.
     *
     * `automated` is not an open status, so the insight leaves the carousel —
     * the same ending the older automate path gives, reached without also
     * writing an `insight_automations` row. Two standing rules for one press is
     * how this product gets two senders for one job.
     *
     * Deliberately NOT fatal. The agent exists and is running; an insight left
     * open is a card that comes back, which is a great deal better than
     * answering "could not install" for something that installed.
     */
    if (validated.insightId) {
      const marked = await new InsightRepository(supabaseServer).markAutomated(
        validated.insightId,
        user.id
      );

      if (marked.error) {
        requestLogger.error(
          { err: marked.error, insightId: validated.insightId, automationId: automation.id },
          'Installed the agent but could not close the insight'
        );
      }
    }

    /* Only a real install is an event. Re-pressing an installed one is not a
       second decision and must not read as one in the trail. */
    if (!outcome.alreadyInstalled) {
      auditTrail
        .log({
          action: 'AUTOMATION_AGENT_INSTALLED',
          entityType: 'agent',
          entityId: outcome.agentId,
          userId: user.id,
          resourceName: automation.id,
          request,
        })
        .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));
    }

    return NextResponse.json({ success: true, data: outcome });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.flatten() },
        { status: 400 }
      );
    }
    requestLogger.error({ err: error }, 'Install request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}

/** Stop one, or start it again. */
export async function PATCH(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const validated = controlSchema.parse(await request.json());

    /*
     * Both helpers take the user id and the repository filters on it, so an
     * agent id belonging to another business updates nothing and reports a
     * failure rather than acting.
     */
    /*
     * A schedule change answers with the new next run, so the list can show
     * what the owner just did rather than guessing or re-reading. The other two
     * answer yes or no.
     */
    if (validated.action === 'schedule') {
      if (!validated.schedule && !validated.stopAfter && validated.stopAfterDays === undefined) {
        return NextResponse.json(
          { success: false, error: 'Nothing to change' },
          { status: 400 }
        );
      }

      const outcome = await updateAgentSchedule(user.id, validated.agentId, {
        schedule: validated.schedule,
        stopAfterDays: validated.stopAfterDays,
        stopAfter: validated.stopAfter,
      });

      if (!outcome.ok) {
        requestLogger.warn(
          { userId: user.id, agentId: validated.agentId, reason: outcome.reason },
          'Could not change the agent schedule'
        );
        return NextResponse.json(
          { success: false, error: 'Could not change the schedule' },
          { status: outcome.reason === 'not_found' ? 404 : 400 }
        );
      }

      auditTrail
        .log({
          action: 'AUTOMATION_AGENT_RESCHEDULED',
          entityType: 'agent',
          entityId: validated.agentId,
          userId: user.id,
          /* `details`, which is the field this type has. What changed is the
             whole value of the entry: an owner asking "who slowed my chaser
             down" needs the new number, not just that something moved. */
          details: {
            schedule: validated.schedule ?? null,
            stopAfter: validated.stopAfter ?? validated.stopAfterDays ?? null,
            nextRun: outcome.nextRun ?? null,
          },
          request,
        })
        .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

      return NextResponse.json({ success: true, data: { nextRun: outcome.nextRun ?? null } });
    }

    const done =
      validated.action === 'pause'
        ? await pauseAutomation(user.id, validated.agentId)
        : await resumeAutomation(user.id, validated.agentId);

    if (!done) {
      return NextResponse.json(
        { success: false, error: 'Could not change the automation' },
        { status: 500 }
      );
    }

    auditTrail
      .log({
        action:
          validated.action === 'pause' ? 'AUTOMATION_AGENT_PAUSED' : 'AUTOMATION_AGENT_RESUMED',
        entityType: 'agent',
        entityId: validated.agentId,
        userId: user.id,
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.flatten() },
        { status: 400 }
      );
    }
    requestLogger.error({ err: error }, 'Control request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}

/** Take one away. Soft delete — what it did outlives the decision to stop it. */
export async function DELETE(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const validated = removeSchema.parse(await request.json());

    const done = await removeAutomation(user.id, validated.agentId);

    if (!done) {
      return NextResponse.json(
        { success: false, error: 'Could not remove the automation' },
        { status: 500 }
      );
    }

    auditTrail
      .log({
        action: 'AUTOMATION_AGENT_REMOVED',
        entityType: 'agent',
        entityId: validated.agentId,
        userId: user.id,
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.flatten() },
        { status: 400 }
      );
    }
    requestLogger.error({ err: error }, 'Remove request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}
