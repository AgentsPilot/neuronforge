-- Migration: Add FAQs for Run Agent and Sandbox/Debugger Pages
-- Date: 2025-01-28
-- Description: Adds help articles for the Run Agent page and Sandbox/Debugger page

-- Run Agent Page FAQs (/v2/agents/[id]/run)
INSERT INTO help_articles (topic, keywords, body, url, page_context) VALUES
('Provide agent input', ARRAY['input', 'provide input', 'input values', 'configure input', 'fill fields', 'agent input', 'required fields'], 'Fill in the input fields on the left panel before running your agent. **Required fields** are marked with a red asterisk (*). Use the help button next to each field for assistance with filling complex values like URLs or IDs.', NULL, '/v2/agents/[id]/run'),

('Save input values', ARRAY['save', 'save inputs', 'save configuration', 'remember values', 'persist inputs', 'save settings'], 'Click the **Save Inputs** button to save your input values for future runs. Saved values will automatically load when you return to this page. This is useful for agents you run frequently with similar parameters.', NULL, '/v2/agents/[id]/run'),

('Run agent execution', ARRAY['run', 'execute', 'run agent', 'start agent', 'execute agent', 'trigger', 'launch'], 'Click the **Run Agent** button to execute your agent with the provided inputs. The button is disabled until all required fields are filled. Execution results will appear in the right panel in real-time.', NULL, '/v2/agents/[id]/run'),

('View execution results', ARRAY['results', 'output', 'execution results', 'view results', 'agent output', 'response'], 'Execution results appear in the **Results** panel on the right. You will see: **Execution status** (success/failed), **Output data** from your agent, **Execution metrics** (steps completed, tokens used, duration), and any **error messages** if the execution failed.', NULL, '/v2/agents/[id]/run'),

('Execution cost', ARRAY['cost', 'price', 'how much', 'pilot credits', 'tokens used', 'execution cost', 'credit usage'], 'The cost of running an agent is displayed in the execution results as **Pilot Credits**. 1 Pilot Credit = 10 LLM tokens by default. Costs vary based on: agent complexity, number of steps, AI model used, and amount of data processed. View detailed cost breakdowns in [Analytics](/v2/analytics).', '/v2/analytics', '/v2/agents/[id]/run'),

('Execution steps', ARRAY['steps', 'workflow', 'execution steps', 'step progress', 'workflow steps', 'step visualization'], 'For workflow-based agents, you can see **real-time step execution** at the bottom. Each step shows its status: **Pending** (gray), **Executing** (blue pulse), **Completed** (green check), **Failed** (red X), or **Skipped** (yellow). Click on steps for more details.', NULL, '/v2/agents/[id]/run'),

('Input help chatbot', ARRAY['help button', 'field help', 'chatbot', 'assistant', 'help with field', 'extract value'], 'Click the **help button** (sparkle icon) next to any input field to get AI assistance. You can paste URLs, emails, or complex data, and the chatbot will extract the exact value needed for that field. It can extract spreadsheet IDs from Google Sheets URLs, email addresses from text, and more.', NULL, '/v2/agents/[id]/run'),

('Failed execution', ARRAY['failed', 'error', 'execution failed', 'failure', 'error message', 'troubleshoot'], 'If execution fails, check the **error message** in the Results panel. Common issues: **Missing required fields**, **Invalid input format**, **Insufficient credits**, **Plugin connection issues**. If the error mentions credits or quota, visit [Billing](/v2/billing) to add more credits.', '/v2/billing', '/v2/agents/[id]/run'),

('Execution timeout', ARRAY['timeout', 'slow', 'taking long', 'hung', 'stuck', 'not responding'], 'Executions timeout after 2 minutes by default. If your agent is timing out: **Reduce input data size**, **Simplify workflow steps**, **Check plugin response times**. For longer-running tasks, consider scheduling the agent instead of running it manually.', NULL, '/v2/agents/[id]/run');

-- Sandbox/Debugger Page FAQs (/v2/sandbox/[agentId])
INSERT INTO help_articles (topic, keywords, body, url, page_context) VALUES
('Use debugger', ARRAY['use', 'debugger', 'how', 'debug', 'sandbox', 'testing', 'test', 'step', 'through', 'mode', 'work', 'works'], 'The **Debugger** (Sandbox) lets you step through agent execution one step at a time. Fill in input variables on the left, click **Play** to start, and watch each workflow step execute in the timeline. Use this to test agents, identify errors, and understand how your workflow processes data.', NULL, '/v2/sandbox/[agentId]'),

('Debug controls', ARRAY['debug', 'controls', 'buttons', 'play', 'pause', 'stop', 'start', 'resume', 'what', 'control', 'panel', 'button', 'do', 'does'], 'Debug control buttons: **Play** (▶) = Start/resume execution, **Pause** (⏸) = Pause at next step, **Stop** (⏹) = Terminate execution. The debugger allows you to pause execution to inspect data before continuing.', NULL, '/v2/sandbox/[agentId]'),

('Step through execution', ARRAY['how', 'step', 'through', 'execution', 'next', 'manual', 'one', 'pause', 'continue', 'run'], 'Click **Pause** to pause execution between steps. While paused, you can inspect step data in the Data Inspector, then click **Play** to continue to the next step. This helps you understand exactly what data is being passed between steps.', NULL, '/v2/sandbox/[agentId]'),

('Inspect step data', ARRAY['how', 'inspect', 'data', 'inspector', 'view', 'step', 'output', 'see', 'check', 'examine'], 'The **Data Inspector** (right panel) shows detailed information about the selected step: **Step name and type**, **Input/output data**, **Execution time**, **Plugin used**, **Error messages** (if failed). Click any step in the timeline to inspect it.', NULL, '/v2/sandbox/[agentId]'),

('Execution timeline', ARRAY['timeline', 'step timeline', 'workflow timeline', 'execution order', 'step order'], 'The **Execution Timeline** (middle panel) shows all workflow steps in order. Each step displays: **Step number and name**, **Status** (pending/running/completed/failed), **Duration** (for completed steps). Click a step to view its data in the Inspector.', NULL, '/v2/sandbox/[agentId]'),

('Pilot credits usage', ARRAY['what', 'are', 'pilot', 'credits', 'tokens', 'cost', 'usage', 'price', 'charge', 'spend', 'money'], '**Pilot Credits** show the cost of the debug execution in real-time. The counter updates as steps complete. Debug executions consume credits just like normal runs, so be mindful when testing large workflows.', '/v2/billing', '/v2/sandbox/[agentId]'),

('Execution time', ARRAY['execution', 'time', 'duration', 'how', 'long', 'timer', 'elapsed', 'speed'], 'The **Execution Time** shows how long the debug run has taken. This includes: **Step execution time**, **AI processing time**, **Plugin API calls**. Use this to identify slow steps and optimize your workflow performance.', NULL, '/v2/sandbox/[agentId]'),

('Pause and resume', ARRAY['how', 'pause', 'resume', 'pausing', 'resuming', 'execution', 'stop', 'continue'], 'Click **Pause** to pause execution before the next step starts. While paused, you can inspect the current state and data. Click **Play** (resume button) to continue execution from where you paused. This is useful for debugging complex workflows.', NULL, '/v2/sandbox/[agentId]'),

('Input variables', ARRAY['input', 'variables', 'input variables', 'configure input', 'test data', 'sample data'], 'The **Input Variables** panel (left) lets you provide test data for debugging. Fill in the same fields as you would in the Run Agent page. Changes to inputs are saved in your browser and persist across page refreshes during your debug session.', NULL, '/v2/sandbox/[agentId]'),

('Sandbox vs run agent', ARRAY['difference', 'sandbox vs run', 'debugger vs run', 'why use sandbox', 'when to debug'], 'Use **Sandbox/Debugger** for: **Testing new workflows**, **Debugging failures**, **Understanding step execution**, **Optimizing performance**. Use **Run Agent** for: **Production executions**, **Scheduled runs**, **Normal agent operations**. Sandbox provides step-by-step visibility, while Run Agent executes continuously.', '/v2/agents/[id]/run', '/v2/sandbox/[agentId]'),

('Debug errors', ARRAY['error', 'failed step', 'debugging errors', 'troubleshoot', 'step failed', 'failure'], 'When a step fails in the debugger, click the failed step to see: **Error message**, **Error code**, **Failed data**, **Plugin response** (if applicable). Use this information to fix your workflow configuration or input data.', NULL, '/v2/sandbox/[agentId]'),

('Step status indicators', ARRAY['status', 'colors', 'indicators', 'step status', 'step colors', 'badges'], 'Step status colors: **Gray** = Pending (not started), **Blue** with pulse = Running, **Green** with checkmark = Completed successfully, **Red** with X = Failed, **Yellow** = Skipped (conditional logic). These help you quickly see execution progress.', NULL, '/v2/sandbox/[agentId]');

-- Navigation FAQs for finding sandbox
INSERT INTO help_articles (topic, keywords, body, url, page_context) VALUES
('Find sandbox', ARRAY['find sandbox', 'where sandbox', 'debugger', 'where is debugger', 'locate sandbox', 'debug mode', 'testing mode'], 'To access the **Sandbox/Debugger**, go to any agent detail page and click the **Sandbox** button (purple button with flask icon). You can also access it from the Agent List by clicking the **Sandbox** button on any agent card.', NULL, '/v2/agent-list'),

('Find run agent', ARRAY['find run', 'where run', 'run page', 'execute agent', 'where to run', 'how to run'], 'To run an agent, go to the agent detail page and click the **Run** button, or visit the [Agent List](/v2/agent-list) and click **Run** on any agent card. This takes you to the execution page where you can provide inputs and run the agent.', NULL, '/v2/agent-list');
