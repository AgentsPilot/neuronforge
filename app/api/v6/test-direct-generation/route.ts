import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { WorkflowPostValidator } from '@/lib/agentkit/v6/compiler/WorkflowPostValidator';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * STRONG TEST ROUTE (executable):
 * - LLM outputs a STRICT Semantic IR (json_object) with machine refs:
 *     { "$ref": "stepKey.path.to.data" }  -> {{stepN.data.path.to.data}}
 *     { "$item": "field" }               -> {{item.field}}
 * - Deterministic compile IR -> Pilot DSL
 * - Normalize + validate + validator autofix
 * - If still invalid:
 *     1) One IR repair (keeps IR contract)
 *     2) One Pilot repair (last resort)
 *
 * Stability:
 * - NEVER response_format: json_schema
 * - NEVER 500; always 200 JSON
 * - ALWAYS return workflow.workflow as an array
 */

/* ============================================================================
 * Small utilities
 * ========================================================================== */

function isObject(v: any) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function safeArray<T>(v: any): T[] {
  return Array.isArray(v) ? v : [];
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function normalizePluginAction(action: string) {
  if (typeof action !== 'string') return '';
  return action.includes('.') ? action.split('.').pop() || '' : action;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stableResponseEnvelope(partial?: any) {
  const workflow_steps = safeArray(partial?.workflow?.workflow_steps);
  return {
    success: Boolean(partial?.success),
    workflow: {
      ...(partial?.workflow || {}),
      workflow_steps,
      workflow: workflow_steps, // legacy compatibility: ALWAYS iterable
    },
    validation:
      partial?.validation || { valid: false, issues: [], autoFixed: false, issueCount: 0 },
    semantic_plan: partial?.semantic_plan,
    method: partial?.method,
    model: partial?.model,
    services_used: partial?.services_used,
    prompt_length: partial?.prompt_length,
    error: partial?.error,
    debug: partial?.debug,
  };
}

/* ============================================================================
 * Plugin Contract
 * ========================================================================== */

function buildPluginCapabilityContract(
  availablePlugins: Record<string, any>,
  services: string[]
) {
  const contract: Record<string, any> = {};
  const allowedActions: string[] = [];

  for (const pluginKey of services) {
    const plugin = availablePlugins[pluginKey];
    if (!plugin?.actions) continue;

    contract[pluginKey] = { actions: {} };

    for (const [actionName, actionDef] of Object.entries<any>(plugin.actions)) {
      contract[pluginKey].actions[actionName] = {
        params: actionDef.parameters || {},
        output: actionDef.output_schema || {},
      };
      allowedActions.push(`${pluginKey}.${actionName}`);
    }
  }

  return { contract, allowedActions };
}

/* ============================================================================
 * Semantic IR (STRICT, executable wiring)
 * ========================================================================== */

type IRRef = { $ref: string }; // e.g. "search_gmail.emails" (compiler maps to {{stepX.data.emails}})
type IRItem = { $item: string }; // e.g. "message_id" -> {{item.message_id}}
type IRValue = string | number | boolean | null | IRRef | IRItem | IRValue[] | { [k: string]: IRValue };

type SemanticPlan = {
  agent_name: string;
  description: string;
  system_prompt: string;
  workflow_type: 'ai_external_actions';
  suggested_plugins: string[];
  required_inputs: any[];
  suggested_outputs: string[];
  confidence: number;
  reasoning: string;
  steps: SemanticStep[];
};

type SemanticStep =
  | SemanticActionStep
  | SemanticAIProcessingStep
  | SemanticLoopStep
  | SemanticScatterGatherStep;

type SemanticBase = {
  key: string; // stable identifier (NOT step1)
  name: string;
  description?: string;
  depends_on?: string[];
  continue_on_error?: boolean;
};

type SemanticActionStep = SemanticBase & {
  kind: 'action';
  plugin: string;
  action: string; // action name only
  params: Record<string, IRValue>;
};

type SemanticAIProcessingStep = SemanticBase & {
  kind: 'ai_processing';
  prompt: string;
  // optional structured output hint (helps model stay deterministic)
  output_schema_hint?: any;
};

type SemanticLoopStep = SemanticBase & {
  kind: 'loop';
  over: { from_step: string; data_path: string }; // iterates over {{stepX.data.<data_path>}}
  steps: SemanticStep[];
};

type SemanticScatterGatherStep = SemanticBase & {
  kind: 'scatter_gather';
  over: { from_step: string; data_path: string };
  item_variable?: string; // default "item"
  steps: SemanticStep[];
  gather_operation?: 'collect';
};

/* ============================================================================
 * IR Prompt (the key to "same workflow" stability)
 * ========================================================================== */

function buildSemanticPrompt(opts: {
  enhanced_prompt: any;
  services: string[];
  pluginContract: any;
  allowedActions: string[];
}) {
  const { enhanced_prompt, services, pluginContract, allowedActions } = opts;

  return `
You are producing a STRICT SEMANTIC PLAN (IR) that is compilable into an executable workflow.

CRITICAL RULES (non-negotiable):
- Output MUST be valid JSON.
- Do NOT output Pilot DSL fields (no workflow_steps, no step1 ids, no iterateOver/loopSteps/scatter/gather).
- Every dependency on prior step data MUST be expressed using:
    { "$ref": "stepKey.path.to.field" }
  Where "stepKey" is the "key" of a prior step (NOT step1).
  The compiler will convert it to {{stepN.data.path.to.field}}.
- Every dependency on the current item inside loop/scatter MUST be expressed using:
    { "$item": "field" }
  The compiler will convert it to {{item.field}}.
- NEVER write English placeholders like "Use X from Y" in params. If it depends on something, use $ref or $item.
- Action steps:
  - plugin MUST be one of: ${JSON.stringify(services)}
  - action MUST be action name only (no "plugin.action")
  - action MUST correspond to allowed actions list (plugin.action): ${JSON.stringify(allowedActions)}
- Use loop/scatter only when you truly must process arrays item-by-item.

TOP LEVEL JSON SHAPE (EXACT):
{
  "agent_name": string,
  "description": string,
  "system_prompt": string,
  "workflow_type": "ai_external_actions",
  "suggested_plugins": string[],
  "required_inputs": [],
  "suggested_outputs": string[],
  "confidence": number,
  "reasoning": string,
  "steps": [SemanticStep...]
}

SemanticStep variants:

1) ACTION:
{
  "key": "stable_key",
  "kind": "action",
  "name": string,
  "description": string,
  "depends_on": string[]?,
  "continue_on_error": boolean?,
  "plugin": string,
  "action": string,
  "params": object (values can be primitives, arrays, objects, or $ref/$item)
}

2) AI_PROCESSING:
{
  "key": "stable_key",
  "kind": "ai_processing",
  "name": string,
  "description": string,
  "depends_on": string[]?,
  "continue_on_error": boolean?,
  "prompt": string
}

3) LOOP:
{
  "key": "stable_key",
  "kind": "loop",
  "name": string,
  "description": string,
  "depends_on": string[]?,
  "continue_on_error": boolean?,
  "over": { "from_step": "priorStepKey", "data_path": "arrayFieldOnThatStepData" },
  "steps": [SemanticStep...]
}

4) SCATTER_GATHER:
{
  "key": "stable_key",
  "kind": "scatter_gather",
  "name": string,
  "description": string,
  "depends_on": string[]?,
  "continue_on_error": boolean?,
  "over": { "from_step": "priorStepKey", "data_path": "arrayFieldOnThatStepData" },
  "item_variable": "item"?,
  "steps": [SemanticStep...],
  "gather_operation": "collect"?
}

PLUGIN CONTRACT (authoritative):
${JSON.stringify(pluginContract, null, 2)}

USER REQUEST (enhanced_prompt):
${JSON.stringify(enhanced_prompt, null, 2)}

Return JSON ONLY.
`.trim();
}

/* ============================================================================
 * IR Validation (hard gate: eliminate "Use X from Y" regressions)
 * ========================================================================== */

function containsEnglishPlaceholder(v: any): boolean {
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    // common failure patterns that break executability
    if (s.startsWith('use ') || s.includes('use ') || s.includes('from compose') || s.includes('from step')) {
      return true;
    }
  }
  if (Array.isArray(v)) return v.some(containsEnglishPlaceholder);
  if (isObject(v)) return Object.values(v).some(containsEnglishPlaceholder);
  return false;
}

function validateSemanticIR(plan: any, services: string[], allowedActions: string[]) {
  const issues: any[] = [];

  if (!isObject(plan)) issues.push({ message: 'plan is not an object' });
  if (!Array.isArray(plan?.steps)) issues.push({ message: 'steps[] missing' });

  const steps = safeArray<any>(plan?.steps);
  const keySet = new Set<string>();
  steps.forEach((s, idx) => {
    if (!s?.key || typeof s.key !== 'string') issues.push({ message: `step[${idx}] missing key` });
    else {
      if (keySet.has(s.key)) issues.push({ message: `duplicate step key: ${s.key}` });
      keySet.add(s.key);
    }
    if (!s?.kind || typeof s.kind !== 'string') issues.push({ message: `step[${idx}] missing kind` });
    if (!s?.name || typeof s.name !== 'string') issues.push({ message: `step[${idx}] missing name` });

    // If action step, enforce plugin/action allowlist and params discipline
    if (s?.kind === 'action') {
      if (!services.includes(s.plugin)) issues.push({ message: `step[${idx}] plugin not allowed: ${s.plugin}` });
      const full = `${s.plugin}.${normalizePluginAction(s.action || '')}`;
      if (!allowedActions.includes(full)) issues.push({ message: `step[${idx}] action not allowed: ${full}` });

      if (!isObject(s.params)) issues.push({ message: `step[${idx}] params must be object` });
      if (containsEnglishPlaceholder(s.params)) {
        issues.push({ message: `step[${idx}] params contains English placeholder text; must use $ref/$item` });
      }
    }
  });

  return { ok: issues.length === 0, issues };
}

/* ============================================================================
 * Compile IR -> Pilot DSL (deterministic)
 * - Converts $ref and $item into {{...}} references
 * ========================================================================== */

function getRef(stepId: string, dataPath: string) {
  const clean = (dataPath || '').replace(/^\.*|\.*$/g, '');
  return `{{${stepId}.data.${clean}}}`;
}

function compileIRValueToPilot(
  v: IRValue,
  keyToStepId: Map<string, string>,
  inItemScope: boolean
): any {
  if (v === null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;

  if (Array.isArray(v)) return v.map((x) => compileIRValueToPilot(x, keyToStepId, inItemScope));

  if (isObject(v)) {
    // $ref
    if ('$ref' in v && typeof (v as any).$ref === 'string') {
      const refStr = (v as any).$ref as string; // "stepKey.path.to.field"
      const [stepKey, ...pathParts] = refStr.split('.');
      const stepId = keyToStepId.get(stepKey);
      const path = pathParts.join('.');
      return stepId ? getRef(stepId, path) : ''; // if missing, blank -> validator catches
    }

    // $item
    if ('$item' in v && typeof (v as any).$item === 'string') {
      if (!inItemScope) return ''; // illegal outside item scope; keep blank
      const field = (v as any).$item as string;
      const clean = field.replace(/^\.*|\.*$/g, '');
      return `{{item.${clean}}}`;
    }

    const out: any = {};
    for (const [k, vv] of Object.entries(v)) {
      out[k] = compileIRValueToPilot(vv as any, keyToStepId, inItemScope);
    }
    return out;
  }

  return '';
}

function compileSemanticToPilot(plan: SemanticPlan) {
  const topSteps = safeArray<SemanticStep>(plan.steps);

  // Map top-level semantic keys -> step1..stepN
  const keyToStepId = new Map<string, string>();
  topSteps.forEach((s, i) => keyToStepId.set((s as any).key, `step${i + 1}`));

  const compileNestedId = (baseKey: string) =>
    `${baseKey}`.replace(/[^a-zA-Z0-9_]/g, '_') + `__${Math.random().toString(16).slice(2, 8)}`;

  const compileStep = (s: SemanticStep, scope: 'top' | 'nested', inItemScope: boolean): any => {
    const id =
      scope === 'top' ? keyToStepId.get((s as any).key) || `step${keyToStepId.size + 1}` : compileNestedId((s as any).key);

    const base: any = {
      id,
      name: (s as any).name || (s as any).key,
      type: 'ai_processing',
      description: (s as any).description || '',
      dependencies: [],
      continueOnError: Boolean((s as any).continue_on_error),
    };

    if (scope === 'top') {
      const deps = safeArray<string>((s as any).depends_on);
      base.dependencies = deps.map((k) => keyToStepId.get(k)).filter(Boolean);
    } else {
      // nested steps: allow explicit deps as-is (usually empty)
      base.dependencies = safeArray<string>((s as any).depends_on);
    }

    if ((s as any).kind === 'action') {
      const a = s as SemanticActionStep;
      base.type = 'action';
      base.plugin = a.plugin || '';
      base.action = normalizePluginAction(a.action || '');
      base.params = compileIRValueToPilot(a.params || {}, keyToStepId, inItemScope);
      return base;
    }

    if ((s as any).kind === 'ai_processing') {
      const p = s as SemanticAIProcessingStep;
      base.type = 'ai_processing';
      base.prompt = typeof p.prompt === 'string' ? p.prompt : '';
      return base;
    }

    if ((s as any).kind === 'loop') {
      const l = s as SemanticLoopStep;
      base.type = 'loop';
      const fromStepId = keyToStepId.get(l.over?.from_step || '');
      base.iterateOver = fromStepId ? getRef(fromStepId, l.over?.data_path || '') : '';
      base.loopSteps = safeArray<SemanticStep>(l.steps).map((child) => compileStep(child, 'nested', true));
      return base;
    }

    if ((s as any).kind === 'scatter_gather') {
      const sg = s as SemanticScatterGatherStep;
      base.type = 'scatter_gather';
      const fromStepId = keyToStepId.get(sg.over?.from_step || '');
      base.scatter = {
        input: fromStepId ? getRef(fromStepId, sg.over?.data_path || '') : '',
        itemVariable:
          typeof sg.item_variable === 'string' && sg.item_variable.trim() ? sg.item_variable.trim() : 'item',
        steps: safeArray<SemanticStep>(sg.steps).map((child) => compileStep(child, 'nested', true)),
      };
      base.gather = { operation: sg.gather_operation || 'collect' };
      return base;
    }

    base.type = 'ai_processing';
    base.prompt = '';
    return base;
  };

  const workflow_steps = topSteps.map((s) => compileStep(s, 'top', false));

  return {
    agent_name: plan.agent_name || '',
    description: plan.description || '',
    system_prompt: plan.system_prompt || '',
    workflow_type: 'ai_external_actions',
    suggested_plugins: safeArray<string>(plan.suggested_plugins),
    required_inputs: safeArray<any>(plan.required_inputs),
    workflow_steps,
    suggested_outputs: safeArray<string>(plan.suggested_outputs),
    reasoning: plan.reasoning || '',
    confidence: typeof plan.confidence === 'number' ? plan.confidence : 0.7,
  };
}

/* ============================================================================
 * Deterministic Pilot normalization (strong)
 * - sequential top-level ids
 * - remove plugin/action from non-action
 * - ensure required arrays/strings
 * - enforce loop/scatter item reference semantics best-effort
 * ========================================================================== */

function fixLoopItemReferences(pilot: any) {
  const w = deepClone(pilot);

  const parseIterateOver = (iterateOver: string) => {
    const m = iterateOver.match(/^\{\{(step\d+)\.data\.([a-zA-Z0-9_.]+)\}\}$/);
    if (!m) return null;
    return { stepId: m[1], arrayPath: m[2] };
  };

  const fixInString = (s: string, iterateOver: string) => {
    const info = parseIterateOver(iterateOver);
    if (!info) return s;

    const re = new RegExp(
      String.raw`\{\{${escapeRegExp(info.stepId)}\.data\.${escapeRegExp(info.arrayPath)}\.([a-zA-Z0-9_]+)\}\}`,
      'g'
    );
    return s.replace(re, '{{item.$1}}');
  };

  const fixObj = (obj: any, iterateOver: string): any => {
    if (typeof obj === 'string') return fixInString(obj, iterateOver);
    if (Array.isArray(obj)) return obj.map((v) => fixObj(v, iterateOver));
    if (isObject(obj)) {
      const out: any = {};
      for (const [k, v] of Object.entries(obj)) out[k] = fixObj(v, iterateOver);
      return out;
    }
    return obj;
  };

  const walk = (step: any) => {
    if (!isObject(step)) return;

    if (step.type === 'loop' && typeof step.iterateOver === 'string' && Array.isArray(step.loopSteps)) {
      step.loopSteps = step.loopSteps.map((ls: any) => fixObj(ls, step.iterateOver));
      step.loopSteps.forEach(walk);
      return;
    }

    if (Array.isArray(step.loopSteps)) step.loopSteps.forEach(walk);
    if (Array.isArray(step.steps)) step.steps.forEach(walk);
    if (isObject(step.scatter) && Array.isArray(step.scatter.steps)) step.scatter.steps.forEach(walk);
  };

  safeArray(w.workflow_steps).forEach(walk);
  return w;
}

function normalizePilot(pilot: any, services: string[]) {
  const w = deepClone(pilot);

  if (!Array.isArray(w.suggested_plugins) || w.suggested_plugins.length === 0) {
    w.suggested_plugins = services;
  }
  if (!Array.isArray(w.workflow_steps)) w.workflow_steps = [];

  w.workflow_steps = w.workflow_steps.map((s: any, idx: number) => {
    if (!isObject(s)) return s;

    s.id = `step${idx + 1}`;
    if (!Array.isArray(s.dependencies)) s.dependencies = [];
    if (typeof s.name !== 'string' || !s.name.trim()) s.name = s.id;
    if (typeof s.type !== 'string' || !s.type.trim()) s.type = 'ai_processing';
    if (typeof s.description !== 'string') s.description = '';
    if (typeof s.continueOnError !== 'boolean') s.continueOnError = false;

    if (s.type === 'action') {
      s.action = normalizePluginAction(s.action);
      if (typeof s.plugin !== 'string') s.plugin = '';
      if (!isObject(s.params)) s.params = {};
      // remove illegal ai keys if present
      if ('prompt' in s) delete s.prompt;
    } else {
      // non-action: no plugin/action/params
      if ('plugin' in s) delete s.plugin;
      if ('action' in s) delete s.action;
      if ('params' in s) delete s.params;
      if (s.type === 'ai_processing') {
        if (typeof s.prompt !== 'string') s.prompt = '';
      }
    }

    if (s.type === 'loop') {
      if (typeof s.iterateOver !== 'string') s.iterateOver = '';
      if (!Array.isArray(s.loopSteps)) s.loopSteps = [];
    }

    if (s.type === 'scatter_gather') {
      if (!isObject(s.scatter)) s.scatter = { input: '', itemVariable: 'item', steps: [] };
      if (typeof s.scatter.input !== 'string') s.scatter.input = '';
      if (typeof s.scatter.itemVariable !== 'string') s.scatter.itemVariable = 'item';
      if (!Array.isArray(s.scatter.steps)) s.scatter.steps = [];
      if (!isObject(s.gather)) s.gather = { operation: 'collect' };
      if (typeof s.gather.operation !== 'string') s.gather.operation = 'collect';
    }

    return s;
  });

  return fixLoopItemReferences(w);
}

/* ============================================================================
 * Validation
 * ========================================================================== */

function validateSteps(workflowSteps: any[], availablePlugins: Record<string, any>) {
  const validator = new WorkflowPostValidator(availablePlugins);
  return validator.validate({ workflow: workflowSteps }, true);
}

/* ============================================================================
 * Repair prompts
 * ========================================================================== */

function buildIRRepairPrompt(opts: {
  enhanced_prompt: any;
  services: string[];
  allowedActions: string[];
  pluginContract: any;
  irIssues: any[];
  badIR: any;
}) {
  const { enhanced_prompt, services, allowedActions, pluginContract, irIssues, badIR } = opts;

  return `
You are repairing a STRICT Semantic IR plan (NOT Pilot DSL).

Rules:
- Output JSON only.
- Keep same intent.
- Must follow the IR contract:
  - No Pilot DSL fields.
  - Any dependency must use { "$ref": "stepKey.path" } or { "$item": "field" }.
  - NEVER write "Use X from Y" in params.
- Plugins limited to: ${services.join(', ')}
- Actions allowed (plugin.action): ${allowedActions.join(', ')} (but store action name only).

IR issues:
${JSON.stringify(irIssues, null, 2)}

Plugin contract:
${JSON.stringify(pluginContract, null, 2)}

User request:
${JSON.stringify(enhanced_prompt, null, 2)}

Bad IR:
${JSON.stringify(badIR, null, 2)}

Return corrected IR JSON only.
`.trim();
}

function buildPilotRepairPrompt(opts: {
  enhanced_prompt: any;
  services: string[];
  allowedActions: string[];
  pluginContract: any;
  issues: any[];
  badPilot: any;
}) {
  const { enhanced_prompt, services, allowedActions, pluginContract, issues, badPilot } = opts;

  return `
You are repairing a Pilot workflow JSON to pass validation and be executable.

ABSOLUTE RULES:
- Return JSON only.
- Do NOT add top-level "workflow" key; keep "workflow_steps".
- Top-level ids MUST be step1..stepN sequential.
- Only type="action" may have plugin/action/params.
- action must be action name only (no plugin.action).
- NEVER put English placeholders in params (no "Use X from Y").
- Use ONLY plugins: ${services.join(', ')}
- Use ONLY actions (plugin.action list; store action name only): ${allowedActions.join(', ')}

User request:
${JSON.stringify(enhanced_prompt, null, 2)}

Plugin Contract:
${JSON.stringify(pluginContract, null, 2)}

Validation issues:
${JSON.stringify(issues, null, 2)}

Bad Pilot JSON:
${JSON.stringify(badPilot, null, 2)}

Return corrected Pilot JSON only.
`.trim();
}

/* ============================================================================
 * Route
 * ========================================================================== */

export async function POST(req: NextRequest) {
  const debug: any = {};
  try {
    const body = await req.json();
    const enhanced_prompt = body?.enhanced_prompt;

    if (!enhanced_prompt) {
      return NextResponse.json(
        stableResponseEnvelope({
          success: false,
          workflow: { workflow_steps: [] },
          validation: {
            valid: false,
            issues: [{ message: 'enhanced_prompt is required' }],
            autoFixed: false,
            issueCount: 1,
          },
          error: 'enhanced_prompt is required',
        }),
        { status: 200 }
      );
    }

    const services: string[] = safeArray(enhanced_prompt?.specifics?.services_involved);

    const pluginManager = await PluginManagerV2.getInstance();
    const availablePlugins = pluginManager.getAvailablePlugins();

    const { contract, allowedActions } = buildPluginCapabilityContract(availablePlugins, services);

    // 1) LLM -> Semantic IR
    const semanticPrompt = buildSemanticPrompt({
      enhanced_prompt,
      services,
      pluginContract: contract,
      allowedActions,
    });

    debug.semanticPromptLength = semanticPrompt.length;

    const planResp = await openai.chat.completions.create({
      model: 'gpt-5.2',
      messages: [{ role: 'user', content: semanticPrompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });

    const planRaw = planResp.choices[0]?.message?.content;
    if (!planRaw) throw new Error('No semantic plan response');

    let plan: any;
    try {
      plan = JSON.parse(planRaw);
    } catch {
      throw new Error('Semantic plan was not valid JSON');
    }

    // 1.1) Hard IR validation (block regressions)
    let irCheck = validateSemanticIR(plan, services, allowedActions);

    // 1.2) One IR repair if needed
    if (!irCheck.ok) {
      const irRepairPrompt = buildIRRepairPrompt({
        enhanced_prompt,
        services,
        allowedActions,
        pluginContract: contract,
        irIssues: irCheck.issues,
        badIR: plan,
      });

      debug.irRepairPromptLength = irRepairPrompt.length;

            const irRepairResp = await openai.chat.completions.create({
        model: 'gpt-5.2',
        messages: [{ role: 'user', content: irRepairPrompt }],
        temperature: 0.0,
        response_format: { type: 'json_object' },
      });

      const irRepairRaw = irRepairResp.choices[0]?.message?.content;
      if (!irRepairRaw) throw new Error('No IR repair response');

      try {
        plan = JSON.parse(irRepairRaw);
      } catch {
        throw new Error('IR repair response was not valid JSON');
      }

      irCheck = validateSemanticIR(plan, services, allowedActions);
    }

    // 2) Compile IR -> Pilot
    let pilot = compileSemanticToPilot(plan);

    // 3) Normalize Pilot
    pilot = normalizePilot(pilot, services);

    // 4) Validate Pilot + auto-fix
    let validation = validateSteps(pilot.workflow_steps, availablePlugins);

    if (validation?.autoFixed && validation?.fixedWorkflow?.workflow) {
      pilot.workflow_steps = validation.fixedWorkflow.workflow;
      pilot = normalizePilot(pilot, services);
      validation = validateSteps(pilot.workflow_steps, availablePlugins);
    }

    // 5) One Pilot repair if still invalid
    if (!validation.valid) {
      const pilotRepairPrompt = buildPilotRepairPrompt({
        enhanced_prompt,
        services,
        allowedActions,
        pluginContract: contract,
        issues: validation.issues || [],
        badPilot: pilot,
      });

      debug.pilotRepairPromptLength = pilotRepairPrompt.length;

      const pilotRepairResp = await openai.chat.completions.create({
        model: 'gpt-5.2',
        messages: [{ role: 'user', content: pilotRepairPrompt }],
        temperature: 0.0,
        response_format: { type: 'json_object' },
      });

      const pilotRepairRaw = pilotRepairResp.choices[0]?.message?.content;
      if (!pilotRepairRaw) throw new Error('No Pilot repair response');

      let repairedPilot: any;
      try {
        repairedPilot = JSON.parse(pilotRepairRaw);
      } catch {
        throw new Error('Pilot repair response was not valid JSON');
      }

      repairedPilot = normalizePilot(repairedPilot, services);

      const validation2 = validateSteps(repairedPilot.workflow_steps, availablePlugins);

      return NextResponse.json(
        stableResponseEnvelope({
          success: validation2.valid,
          semantic_plan: plan,
          workflow: repairedPilot,
          validation: {
            valid: validation2.valid,
            issues: validation2.issues,
            autoFixed: validation2.autoFixed,
            issueCount: validation2.issues?.length ?? 0,
          },
          method: 'ir -> compile -> normalize -> validate -> pilot_repair',
          model: 'gpt-5.2',
          services_used: services,
          prompt_length: semanticPrompt.length,
          debug,
        }),
        { status: 200 }
      );
    }

    // 6) Success path
    return NextResponse.json(
      stableResponseEnvelope({
        success: true,
        semantic_plan: plan,
        workflow: pilot,
        validation: {
          valid: validation.valid,
          issues: validation.issues,
          autoFixed: validation.autoFixed,
          issueCount: validation.issues?.length ?? 0,
        },
        method: 'ir -> compile -> normalize -> validate',
        model: 'gpt-5.2',
        services_used: services,
        prompt_length: semanticPrompt.length,
        debug,
      }),
      { status: 200 }
    );
  } catch (err: any) {
    // NEVER 500
    return NextResponse.json(
      stableResponseEnvelope({
        success: false,
        workflow: { workflow_steps: [] },
        validation: {
          valid: false,
          issues: [{ level: 'fatal', message: err?.message ?? 'Unknown error' }],
          autoFixed: false,
          issueCount: 1,
        },
        error: err?.message ?? 'Unknown error',
        method: 'ir -> compile -> normalize -> validate',
        model: 'gpt-5.2',
        debug,
      }),
      { status: 200 }
    );
  }
}