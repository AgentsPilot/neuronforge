# 🧠 Claude.md — Project Context for AgentPilot

## 🚀 Overview
**AgentPilot** is a **no-code AI automation platform** that converts natural-language prompts into fully working agents (workflows).  
Users describe what they want (e.g. *"Summarize my last 10 Gmail emails and save to Notion"*) — AgentPilot automatically detects required plugins, builds input/output schemas, and creates runnable automations.

---

## 🧱 Tech Stack
| Layer | Tech |
|-------|------|
| **Frontend** | Next.js (App Router) • TypeScript • React • TailwindCSS • Framer Motion |
| **Backend** | Next.js API Routes • (Legacy FastAPI optional) |
| **Database** | Supabase (PostgreSQL + Auth) |
| **LLM** | OpenAI GPT-4o for reasoning, generation, and enhancement |
| **Hosting** | Vercel |
| **Architecture** | Plugin Strategy Pattern + Dynamic Registry + Agent Builder Pipeline |

---

## 🧩 Core Concepts
### Agents
- Represent automations created from user prompts.
- Fields include: `agent_name`, `user_prompt`, `system_prompt`, `input_schema`, `output_schema`, `connected_plugins`, `mode`, `status`, `workflow_steps`.
- Stored in Supabase (`agents` table).
- Built by `/app/api/generate-agent/route.ts`.
- Executed by `/app/api/run-agent/route.ts`.

### Plugin System
- Each integration (Gmail, Notion, Slack, Drive, etc.) implements its own **strategy** under `/lib/plugins/strategies/`.
- Each strategy exports:  
  `connect()`, `disconnect()`, `handleOAuthCallback()`, `run(userId, input)`, `refreshToken()`.
- Registered globally in `/lib/plugins/pluginRegistry.ts`.
- Connections stored in `plugin_connections` table.

### Agent Creation Flow
1. **Prompt Input** → user types intent  
2. **Clarification Questions** → GPT-4o asks 2–5 focused questions  
3. **Enhanced Prompt** → GPT refines into structured plan  
4. **Generate Agent** → backend detects plugins, builds schemas  
5. **Agent Wizard** → user reviews + saves  
6. **Sandbox / Dashboard** → test, schedule, or chain agents

---

## 🧠 Supabase Schema (Key Tables)
*(agents, agent_logs, plugin_connections, audit_trail — see download for SQL definitions)*

---

## 🧰 Repository Structure
| Directory | Purpose |
|------------|----------|
| `/app/api/` | Next.js API routes for all server functions |
| `/components/` | React components (Wizard, Dashboard, Sandbox, Modals) |
| `/lib/plugins/` | Plugin strategies + registry |
| `/lib/utils/` | Helpers (`runAgentWithContext.ts`, `AuditTrailService.ts`, etc.) |
| `/styles/` | Tailwind & global styles |
| `/public/` | Static assets |
| `/docs/` | Generated documentation (architecture, APIs, schemas) |

---

## 🧾 Documentation & Audit Trail Tasks
Claude must:
- Generate `/docs/*` Markdown documentation automatically.  
- Maintain a **Smart Audit Trail** system logging every critical event (`agent create/run/update`, plugin connect/disconnect, schema change).  
- Centralize logging in `/lib/utils/AuditTrailService.ts`.  
- Provide `/app/api/audit-trail/route.ts` for retrieval (pagination + filtering).  

Example audit trail insertion:
```ts
await supabase.from('audit_trail').insert({
  user_id,
  action: 'RUN_AGENT',
  entity_type: 'agent',
  entity_id: agent.id,
  details: { input, output_summary, plugins_used },
  ip_address: requestIp,
  user_agent: headers['user-agent']
});