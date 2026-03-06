// lib/agentkit/v6/intent/core-vocabulary.ts
// Core DSL v1 — plugin-agnostic, domain-agnostic, finite.
// This is ALWAYS injected to the Intent LLM.

export const CORE_STEP_TYPES = [
  "fetch",        // get data from some source (semantic only)
  "transform",    // filter/map/select/dedupe/sort/parse/format/etc
  "loop",         // iterate over a collection
  "branch",       // conditional routing
  "parallel",     // run independent branches concurrently
  "join",         // merge outputs of parallel branches
  "aggregate",    // compute metrics (count/sum/min/max/avg)
  "deliver",      // send/store/post (semantic only)
  "ai_extract",   // structured extraction with schema + confidence
  "ai_generate",  // structured generation with schema
  "validate",     // assertions + guards
  "set",          // deterministic assignments / constants
  "wait",         // time-based pause
  "retry",        // retry wrapper with backoff
  "try_catch",    // error handling
  "debounce",     // rate limiting - debounce
  "throttle",     // rate limiting - throttle
  "end",          // terminator
] as const;

export type CoreStepType = (typeof CORE_STEP_TYPES)[number];

/* ─────────────────────────────────────────────────────────────
   Expression operators (used in filters/conditions/validations)
   ───────────────────────────────────────────────────────────── */

export const CORE_OPERATORS = {
  boolean: ["and", "or", "not"] as const,

  comparison: ["eq", "ne", "gt", "gte", "lt", "lte"] as const,

  existence: ["exists", "missing", "is_empty", "not_empty"] as const,

  string: ["contains", "starts_with", "ends_with", "regex", "length"] as const,

  array: ["in", "not_in", "includes", "unique", "first", "last", "length"] as const,

  type_check: ["is_string", "is_number", "is_boolean", "is_array", "is_object", "is_null"] as const,

  null_handling: ["coalesce", "default", "if_null"] as const,

  math: [
    "add",
    "sub",
    "mul",
    "div",
    "mod",
    "abs",
    "round",
    "floor",
    "ceil",
    "min",
    "max",
    "sum",
    "count",
    "avg",
  ] as const,

  datetime: ["before", "after", "between", "within_last", "now", "date_add", "date_sub", "date_diff"] as const,
} as const;

export type CoreOperator =
  | (typeof CORE_OPERATORS.boolean)[number]
  | (typeof CORE_OPERATORS.comparison)[number]
  | (typeof CORE_OPERATORS.existence)[number]
  | (typeof CORE_OPERATORS.string)[number]
  | (typeof CORE_OPERATORS.array)[number]
  | (typeof CORE_OPERATORS.type_check)[number]
  | (typeof CORE_OPERATORS.null_handling)[number]
  | (typeof CORE_OPERATORS.math)[number]
  | (typeof CORE_OPERATORS.datetime)[number];

/* ─────────────────────────────────────────────────────────────
   Core Expression AST
   ───────────────────────────────────────────────────────────── */

// References are always explicit: $.foo, $.loop.item.bar, etc.
export type Ref = { ref: string };
export type Value = string | number | boolean | null | Record<string, any> | any[];

export type ExprAtom = {
  op: Exclude<CoreOperator, (typeof CORE_OPERATORS.boolean)[number]>;
  left: Ref;
  right?: Value | Ref;
};

export type ExprBool = {
  op: (typeof CORE_OPERATORS.boolean)[number];
  args: Expr[];
};

export type Expr = ExprAtom | ExprBool;

/* ─────────────────────────────────────────────────────────────
   Handshake rule: steps must declare inputs & outputs explicitly
   ───────────────────────────────────────────────────────────── */

export type StepInputs = Record<string, Ref>;
export type StepOutputs = Record<string, string>; // outputName -> description (compiler enforces references)

export type CoreStepBase = {
  id: string;
  type: CoreStepType;
  inputs: StepInputs;
  outputs: StepOutputs;
  note?: string;
};

/* ─────────────────────────────────────────────────────────────
   Step specializations (still plugin-agnostic)
   ───────────────────────────────────────────────────────────── */

export type FetchStep = CoreStepBase & {
  type: "fetch";
  fetch: {
    // IMPORTANT: semantic op name (not plugin action)
    semantic_op: SemanticOp; // from plugin-vocabulary.ts
    params?: Record<string, Value | Ref>;
  };
};

export type DeliverStep = CoreStepBase & {
  type: "deliver";
  deliver: {
    semantic_op: SemanticOp; // from plugin-vocabulary.ts
    params?: Record<string, Value | Ref>;
  };
};

export type TransformStep = CoreStepBase & {
  type: "transform";
  transform: {
    kind:
      | "filter"
      | "map"
      | "select"
      | "merge"
      | "dedupe"
      | "sort"
      | "slice"
      | "flatten"
      | "group_by"
      | "format"
      | "parse"
      | "cast";
    source: Ref;
    expr?: Expr; // for filter/sort/group
    template?: Record<string, Value | Ref>; // for select/map outputs
    sort_by?: string;
    order?: "asc" | "desc";
    limit?: number;
    offset?: number;
  };
};

export type LoopStep = CoreStepBase & {
  type: "loop";
  loop: {
    iterate_over: Ref;
    item_var: string;
    collect: boolean;
    collect_as?: string;
    body: CoreStep[];
  };
};

export type BranchStep = CoreStepBase & {
  type: "branch";
  branch:
    | { kind: "if_else"; condition: Expr; then: CoreStep[]; else: CoreStep[] }
    | { kind: "rules"; rules: { condition: Expr; next_step_id: string }[]; default_step_id: string };
};

export type ParallelStep = CoreStepBase & {
  type: "parallel";
  parallel: {
    branches: { id: string; steps: CoreStep[] }[];
    strategy: "all" | "race" | "any";
  };
};

export type JoinStep = CoreStepBase & {
  type: "join";
  join: {
    sources: Ref[];
    strategy: "merge" | "concat" | "pick_first";
  };
};

export type AggregateStep = CoreStepBase & {
  type: "aggregate";
  aggregate: {
    source: Ref;
    metrics: (
      | { metric: "count"; as: string }
      | { metric: "sum"; field: string; as: string }
      | { metric: "min"; field: string; as: string }
      | { metric: "max"; field: string; as: string }
      | { metric: "avg"; field: string; as: string }
    )[];
    where?: Expr;
  };
};

export type AiExtractStep = CoreStepBase & {
  type: "ai_extract";
  ai_extract: {
    instruction: string;
    input: Ref;
    output_schema: Record<string, any>;
    confidence_field?: string; // e.g. "confidence" | "extraction_confidence"
  };
};

export type AiGenerateStep = CoreStepBase & {
  type: "ai_generate";
  ai_generate: {
    instruction: string;
    input: Ref;
    output_schema: Record<string, any>;
  };
};

export type ValidateStep = CoreStepBase & {
  type: "validate";
  validate: {
    checks: { name: string; expr: Expr; on_fail: "error" | "skip" | "warn"; message?: string }[];
  };
};

export type SetStep = CoreStepBase & {
  type: "set";
  set: { values: Record<string, Value | Ref> };
};

export type WaitStep = CoreStepBase & {
  type: "wait";
  wait: { seconds?: number; until?: Ref };
};

export type RetryStep = CoreStepBase & {
  type: "retry";
  retry: {
    attempt: CoreStep[];
    max_attempts: number;
    backoff?: "linear" | "exponential" | "constant";
    initial_delay_seconds?: number;
    max_delay_seconds?: number;
    on_failure?: CoreStep[];
  };
};

export type TryCatchStep = CoreStepBase & {
  type: "try_catch";
  try_catch: { try: CoreStep[]; catch: CoreStep[]; finally?: CoreStep[] };
};

export type DebounceStep = CoreStepBase & {
  type: "debounce";
  debounce: {
    wait_seconds: number;
    key?: Ref; // optional grouping key
    steps: CoreStep[];
  };
};

export type ThrottleStep = CoreStepBase & {
  type: "throttle";
  throttle: {
    max_per_window: number;
    window_seconds: number;
    key?: Ref; // optional grouping key
    steps: CoreStep[];
  };
};

export type EndStep = CoreStepBase & { type: "end" };

export type CoreStep =
  | FetchStep
  | DeliverStep
  | TransformStep
  | LoopStep
  | BranchStep
  | ParallelStep
  | JoinStep
  | AggregateStep
  | AiExtractStep
  | AiGenerateStep
  | ValidateStep
  | SetStep
  | WaitStep
  | RetryStep
  | TryCatchStep
  | DebounceStep
  | ThrottleStep
  | EndStep;

/* ─────────────────────────────────────────────────────────────
   Intent Contract — what Phase-1 LLM must return
   ───────────────────────────────────────────────────────────── */

export type IntentContractV1 = {
  version: "core_dsl_v1";
  goal: string;
  summary?: string;

  unit_of_work: "item" | "record" | "attachment" | "event" | "message" | "file" | "row" | "entity";

  plugins_involved: string[]; // plugin keys only (e.g., "google-mail")

  questions?: { id: string; question: string; blocking: boolean; choices?: string[] }[];
  constraints?: { id: string; description: string }[];
  risks?: string[];

  steps: CoreStep[];
};

/* ─────────────────────────────────────────────────────────────
   Injection builder — what you literally pass to the Intent LLM
   ───────────────────────────────────────────────────────────── */

import type { SemanticOp } from "./plugin-vocabulary";

export function buildCoreVocabularyInjection() {
  return {
    core_step_types: CORE_STEP_TYPES,
    core_operators: CORE_OPERATORS,
    handshake_rules: [
      "Every step MUST declare inputs and outputs explicitly.",
      "Downstream steps may ONLY reference prior declared outputs or the current loop item_var scope.",
      "If loop.collect=true then loop.collect_as is REQUIRED and MUST be written to outputs.",
      "Conditions/filters MUST use only allowed operators.",
      "fetch/deliver steps MUST use semantic_op only (no plugin action names).",
      "ai_extract/ai_generate MUST include output_schema.",
    ],
  } as const;
}
