# 🧑‍💻 Copilot Instructions for AgentPilot (neuronforge)

## Big Picture Architecture
- **AgentPilot** is a no-code AI automation platform: users describe tasks, the system builds and runs agents (workflows) using plugins.
- **Frontend:** Next.js (App Router), React, TypeScript, TailwindCSS, Framer Motion.
- **Backend:** Next.js API routes (see `/app/api/`), Supabase (PostgreSQL), BullMQ (Redis) for agent queueing, OpenAI GPT-4o for reasoning.
- **Agents** are stored in Supabase (`agents` table) and executed via queue workers (`lib/queues/agentWorker.ts`).
- **Plugins** are implemented as strategies in `/lib/plugins/strategies/` and registered in `/lib/plugins/pluginRegistry.ts`.

## Developer Workflows
- **Run locally:** `npm run dev` (Next.js server, API routes, frontend)
- **Start worker:** Run `/scripts/start-worker.ts` to process agent jobs from the queue.
- **Deploy:** Vercel for hosting, with scheduled API triggers (cron jobs) for agent execution.
- **Database:** Supabase for all persistent data (agents, logs, plugin connections, audit trail).
- **Audit Trail:** All critical actions are logged via `/lib/utils/AuditTrailService.ts` and accessible via `/app/api/audit-trail/route.ts`.

## Project-Specific Patterns & Conventions
- **Agent Creation:**
  - User prompt → clarification questions → enhanced prompt → agent generated (see `/app/api/generate-agent/route.ts`).
  - Agents have input/output schemas, plugin requirements, and workflow steps.
- **Agent Execution:**
  - Jobs are enqueued in BullMQ (`lib/queues/agentQueue.ts`), processed by workers (`lib/queues/agentWorker.ts`).
  - Execution status, logs, and results are written to Supabase (`agent_executions`, `agent_logs`).
- **Plugin Integration:**
  - Each plugin implements a strategy: `connect`, `disconnect`, `run`, etc.
  - Plugins are dynamically detected and registered.
- **Audit Trail:**
  - Use `AuditTrailService` for all event logging. Example:
    ```ts
    await supabase.from('audit_trail').insert({
      user_id,
      action: 'RUN_AGENT',
      entity_type: 'agent',
      entity_id: agent.id,
      details: { input, output_summary, plugins_used },
      ip_address,
      user_agent
    });
    ```
- **Scheduling:**
  - Agents can be scheduled via cron (`schedule_cron` field in `agents` table).
  - Vercel cron triggers API route to enqueue jobs.
  - Concurrency protection: scheduler uses atomic claim logic to avoid double execution.

## Integration Points
- **Supabase:** All data, including agents, logs, plugin connections, audit trail.
- **Redis:** Used for BullMQ job queueing and event handling.
- **OpenAI:** Used for prompt enhancement, agent generation, and reasoning.
- **Vercel:** Hosting, API routes, and scheduled triggers.

## Key Files & Directories
- `/app/api/` — API routes for agent creation, execution, audit trail, etc.
- `/lib/queues/agentQueue.ts` — BullMQ queue setup and job management.
- `/lib/queues/agentWorker.ts` — Worker logic for processing agent jobs.
- `/lib/plugins/strategies/` — Plugin strategy implementations.
- `/lib/utils/AuditTrailService.ts` — Centralized audit/event logging.
- `/components/` — React UI components for agent wizard, dashboard, modals.
- `/docs/` — Generated documentation (architecture, APIs, schemas).

## Examples
- **Agent Creation:** `/app/api/generate-agent/route.ts`
- **Agent Execution:** `/app/api/run-agent/route.ts`, `/lib/queues/agentWorker.ts`
- **Audit Trail Logging:** `/lib/utils/AuditTrailService.ts`
- **Plugin Strategy:** `/lib/plugins/strategies/gmail.ts`, `/lib/plugins/strategies/notion.ts`

---

For more context, see `Claude.md` and `/docs/` for architecture and schema details.

---

*If any section is unclear or missing, please provide feedback to iterate and improve these instructions.*
