// intent-schema-types.ts
// Phase 1 "Intent Contract" (LLM output) — GENERIC + EXTENSIBLE
// ------------------------------------------------------------
// Design goals:
// - Plugin-agnostic (no plugin keys, no action names, no param names)
// - Execution-agnostic (no IR/DSL, no {{vars}}, no JSON-path coupling)
// - Strict enough to validate + compile deterministically
// - Generic enough to cover "all possibilities" via:
//   1) a small set of universal step kinds
//   2) flexible capability hints
//   3) strongly-typed condition AST
//   4) open-ended payloads (safe extension points)

// ------------------------------------------------------------
// Core primitives
// ------------------------------------------------------------

export type IntentVersion = "intent.v1";
export type ID = string;
export type RefName = string;
export type ConfidenceScore = number; // recommended: 0..1

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [k: string]: JsonValue;
}

// "Domains" are semantic groupings; compiler maps (domain+capability) -> concrete plugin/action
export type Domain =
  | "email"
  | "messaging"
  | "calendar"
  | "storage"
  | "table"
  | "database"
  | "crm"
  | "project_management"
  | "accounting"
  | "payments"
  | "document"
  | "web"
  | "internal"
  | "custom";

// "Capabilities" are normalized verbs; compiler binds them to plugin actions using registry metadata.
export type Capability =
  | "search"
  | "list"
  | "get"
  | "fetch_content"
  | "download"
  | "upload"
  | "create"
  | "update"
  | "delete"
  | "append"
  | "upsert"
  | "send_message"
  | "post_message"
  | "create_draft"
  | "extract_structured_data"
  | "classify"
  | "summarize"
  | "generate"
  | "transform"
  | "aggregate"
  | "notify"
  | "schedule"
  | "trigger"
  | "webhook"
  | "custom";

export interface CapabilityUse {
  capability: Capability;
  domain: Domain;
  // Optional disambiguation hints (still NOT concrete plugin/action)
  hints?: string[];
  // Optional: "soft requirements" for binding, used by compiler scoring
  preferences?: {
    provider_family?: string; // e.g. "google", "microsoft", "slack"
    must_support?: string[]; // e.g. ["attachments", "html_email"]
    avoid?: string[]; // e.g. ["oauth_device_flow"]
  };
}

// Optional semantic entity hints. Keep broad.
export type Entity =
  | "email"
  | "message"
  | "thread"
  | "attachment"
  | "file"
  | "folder"
  | "row"
  | "record"
  | "event"
  | "contact"
  | "transaction"
  | "document"
  | "unknown"
  | "custom";

// Named outputs produced by steps (symbolic references, not paths)
export interface OutputRef {
  ref: RefName;
  entity?: Entity;
  cardinality?: "single" | "many";
  description?: string;
}

// ------------------------------------------------------------
// Config / parameters (resolved deterministically later)
// ------------------------------------------------------------

export type ScalarType = "string" | "number" | "boolean";

export interface ConfigParam {
  key: string; // e.g., "amount_threshold"
  type: ScalarType | "json";
  description?: string;
  default?: JsonValue;

  // Optional constraints (helps validation + UI)
  constraints?: {
    enum?: JsonPrimitive[];
    min?: number;
    max?: number;
    pattern?: string;
  };
}

// A generic "value source" that avoids JSON paths.
// Compiler resolves field mapping using registry + known semantic shapes.
export type ValueRef =
  | { kind: "literal"; value: JsonValue }
  | { kind: "config"; key: string }
  | { kind: "ref"; ref: RefName; field?: string } // field is semantic field name, not a JSON-path
  | { kind: "computed"; op: string; args: ValueRef[] }; // safe extension for derived values

// ------------------------------------------------------------
// Condition AST (structured, generic, compiler-friendly)
// ------------------------------------------------------------

export type Comparator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "exists"
  | "is_empty"
  | "not_empty"
  | "in"
  | "not_in"
  | "starts_with"
  | "ends_with"
  | "matches";

export type Condition =
  | { op: "and"; conditions: Condition[] }
  | { op: "or"; conditions: Condition[] }
  | { op: "not"; condition: Condition }
  | {
      op: "test";
      left: ValueRef; // usually {kind:"ref", ref:"extracted", field:"amount"}
      comparator: Comparator;
      right?: ValueRef; // omitted for unary tests like exists/is_empty
    };

// ------------------------------------------------------------
// Invariants / constraints
// ------------------------------------------------------------

export type InvariantType =
  | "ordering"
  | "safety"
  | "idempotency"
  | "data_availability"
  | "no_duplicate_writes"
  | "rate_limit"
  | "privacy"
  | "custom";

export interface Invariant {
  type: InvariantType;
  rule: string; // human-readable; compiler enforces where possible
  hints?: string[]; // optional machine-ish hints
}

// ------------------------------------------------------------
// Top-level Intent Contract
// ------------------------------------------------------------

export interface UnitOfWorkSpec {
  entity: Entity;
  parent_entity?: Entity;
}

export interface IntentContractV1 {
  version: IntentVersion;

  goal: string;

  // Optional: used to shape compilation (looping strategy, scoping)
  unit_of_work?: UnitOfWorkSpec;

  // Optional: allow compilation to request missing inputs/configs
  config?: ConfigParam[];

  // Optional: enforcement hints
  invariants?: Invariant[];

  // Optional: coverage targets (helps tests)
  required_outcomes?: string[];

  // The plan
  steps: IntentStep[];

  // Optional: model self-reported confidence
  confidence?: ConfidenceScore;

  // Extension point: additional metadata (safe to ignore)
  meta?: JsonObject;
}

// ------------------------------------------------------------
// Step system
// ------------------------------------------------------------

export type StepKind =
  | "data_source"
  | "artifact"
  | "transform"
  | "extract"
  | "classify"
  | "summarize"
  | "generate"
  | "decide"
  | "loop"
  | "aggregate"
  | "deliver"
  | "notify"
  | "schedule"
  | "trigger"
  | "parallel"
  | "custom_step";

export interface BaseStep {
  id: ID;
  kind: StepKind;

  summary: string;

  // What capabilities this step needs (compiler binds to real actions)
  uses?: CapabilityUse[];

  // Optional: which named inputs this step consumes
  // (symbolic, compiler maps to actual data-flow)
  inputs?: RefName[];

  // Optional: name of the output produced by this step
  output?: RefName;

  // Optional: human hints
  tags?: string[];

  // Universal extension payload (generic to capture all possibilities)
  // IMPORTANT: compiler should ignore unknown keys unless it supports them.
  payload?: JsonObject;
}

// ------------------------------------------------------------
// Concrete step types
// ------------------------------------------------------------

// 1) Data source: search/list/get from a domain
export interface DataSourceStep extends BaseStep {
  kind: "data_source";

  source: {
    domain: Domain;
    intent: "search" | "list" | "get" | "query" | "custom";
  };

  // Natural query intent (no provider syntax requirement)
  query?: string;

  // Optional structured filters (generic)
  filters?: Array<{
    field: string; // semantic field name, e.g. "is_unread", "has_attachments"
    op: Comparator;
    value?: ValueRef;
  }>;

  // Optional: retrieval shape hints
  retrieval?: {
    max_results?: number;
    include_content?: "none" | "snippet" | "full";
    include_attachments?: boolean;
    include_metadata?: boolean;
  };
}

// 2) Artifact: create/get storage container etc.
export interface ArtifactStep extends BaseStep {
  kind: "artifact";

  artifact: {
    domain: Domain; // commonly storage/table/database/etc
    type: Entity; // "folder", "table", "database", etc.
    strategy: "get_or_create" | "create_new" | "use_existing" | "custom";
    name_hint?: string;
    destination_ref?: RefName; // if strategy=use_existing, reference provided elsewhere
    options?: JsonObject;
  };
}

// 3) Transform: filter/map/group/sort/merge/dedupe/etc (semantic)
export type TransformOp =
  | "filter"
  | "map"
  | "reduce"
  | "group"
  | "sort"
  | "dedupe"
  | "flatten"
  | "merge"
  | "select"
  | "custom";

export interface TransformStep extends BaseStep {
  kind: "transform";

  transform: {
    op: TransformOp;
    input: RefName;
    // Optional expression-like description (compiler may translate to deterministic ops)
    description?: string;

    // Optional structured condition for filter operations (enables reliable runtime execution)
    where?: Condition;

    // Optional structured transform definitions (generic)
    rules?: JsonObject;

    // Optional output schema declaration (for transforms that restructure data)
    output_schema?: JsonObject;
  };
}

// 4) Extract: pull structured fields from unstructured content (documents, messages, web)
export interface ExtractStep extends BaseStep {
  kind: "extract";

  extract: {
    input: RefName; // usually attachment/document/text ref
    // Fields are semantic. Compiler maps them to downstream structures.
    fields: Array<{
      name: string; // e.g. "amount"
      type?: ScalarType | "date" | "currency" | "object" | "array" | "unknown";
      required?: boolean;
      description?: string;
    }>;

    // "deterministic" indicates you expect a stable schema output (e.g., deterministic_extract)
    deterministic?: boolean;

    // Content hints (NOT provider-specific)
    content_hints?: {
      file_types?: string[]; // e.g. ["pdf","jpg","png"]
      language?: string;
    };
  };
}

// 5) Classify: categorize items into labels
export interface ClassifyStep extends BaseStep {
  kind: "classify";

  classify: {
    input: RefName;
    labels: string[];
    multi_label?: boolean;
    output_field?: string; // semantic name for label field, default "label"
  };
}

// 6) Summarize: produce a human-readable summary
export interface SummarizeStep extends BaseStep {
  kind: "summarize";

  summarize: {
    input: RefName;
    format?: "text" | "html" | "markdown" | "json";
    focus?: string; // what to highlight
    max_length?: number;
  };
}

// 7) Generate: produce content/artifacts (email body, report, template, etc.)
export interface GenerateStep extends BaseStep {
  kind: "generate";

  generate: {
    input?: RefName; // optional
    format?: "text" | "html" | "markdown" | "json";
    instruction: string;

    // Optional: structured outputs (still semantic)
    outputs?: Array<{
      name: string; // e.g., "email_subject", "email_body_html"
      type?: ScalarType | "object" | "array" | "unknown";
      description?: string;
    }>;
  };
}

// 8) Decide: conditional branching (structured)
export interface DecideStep extends BaseStep {
  kind: "decide";

  decide: {
    condition: Condition;
    then: IntentStep[];
    else?: IntentStep[];
  };
}

// 9) Loop: iterate over a collection (symbolic)
export interface LoopStep extends BaseStep {
  kind: "loop";

  loop: {
    over: RefName; // ref to a collection
    item_ref: RefName; // symbolic name for "current item" inside loop
    unit_of_work?: UnitOfWorkSpec;

    // collection semantics: gather results from iterations
    collect?: {
      enabled: boolean;
      collect_as?: RefName;
      from_step_output?: RefName; // output ref produced inside the loop body
    };

    do: IntentStep[];

    // Optional: concurrency hint (compiler may ignore)
    concurrency?: number;
  };
}

// 10) Aggregate: compute grouped subsets, totals, etc.
export interface AggregateStep extends BaseStep {
  kind: "aggregate";

  aggregate: {
    input: RefName;

    // Generic "views" and stats to compute
    outputs: Array<
      | { name: string; type: "subset"; where: Condition }
      | { name: string; type: "count"; of?: RefName }
      | { name: string; type: "sum"; of?: RefName; field: string }
      | { name: string; type: "min"; of?: RefName; field: string }
      | { name: string; type: "max"; of?: RefName; field: string }
      | { name: string; type: "custom"; spec: JsonObject }
    >;
  };
}

// 11) Deliver: write/store/append/create records, upload files, etc. (still abstract)
export interface DeliverStep extends BaseStep {
  kind: "deliver";

  deliver: {
    domain: Domain;
    intent:
      | "create_record"
      | "append_record"
      | "upsert_record"
      | "upload_file"
      | "store_file"
      | "create_artifact"
      | "custom";

    // Inputs are symbolic. Compiler maps to actual action params.
    input: RefName;

    // Destination is symbolic. Could be a prior artifact output.
    destination?: RefName;

    // Optional mapping hints (semantic fields -> destination columns/fields)
    mapping?: Array<{
      from: { ref: RefName; field?: string } | ValueRef;
      to: string; // semantic destination field name (compiler maps to concrete)
    }>;

    options?: JsonObject;
  };
}

// 12) Notify: send message/notification (email/slack/etc)
export interface NotifyStep extends BaseStep {
  kind: "notify";

  notify: {
    channel: "email" | "chat" | "sms" | "push" | "webhook" | "custom";
    // Symbolic recipient spec (compiler binds to available connected providers)
    recipients?: {
      to?: ValueRef[]; // literal emails, user ids, channel ids, etc.
      cc?: ValueRef[];
      bcc?: ValueRef[];
    };
    content: {
      subject?: ValueRef;
      body: ValueRef;
      format?: "text" | "html" | "markdown";
    };
    options?: JsonObject;
  };
}

// 13) Schedule: indicates desired timing (compiler -> IR schedule nodes)
export interface ScheduleStep extends BaseStep {
  kind: "schedule";

  schedule: {
    mode: "once" | "recurring";
    when?: ValueRef; // literal datetime or config ref
    cron?: string; // if recurring (optional)
    timezone?: string;
  };
}

// 14) Trigger: event-driven activation (compiler -> IR nodes)
export interface TriggerStep extends BaseStep {
  kind: "trigger";

  trigger: {
    source_domain: Domain;
    event: string; // semantic event key, e.g. "new_email", "new_row", "new_file"
    filters?: Condition;
    options?: JsonObject;
  };
}

// 15) Parallel: indicates independent branches (compiler chooses if truly parallel)
export interface ParallelStep extends BaseStep {
  kind: "parallel";

  parallel: {
    branches: Array<{
      id: ID;
      summary: string;
      steps: IntentStep[];
    }>;
    wait_for: "all" | "any";
  };
}

// 16) Custom step: escape hatch for novel cases
export interface CustomStep extends BaseStep {
  kind: "custom_step";

  custom: {
    // Human-readable type identifier
    type: string;

    // Any additional structured data
    spec?: JsonObject;
  };
}

// The master union
export type IntentStep =
  | DataSourceStep
  | ArtifactStep
  | TransformStep
  | ExtractStep
  | ClassifyStep
  | SummarizeStep
  | GenerateStep
  | DecideStep
  | LoopStep
  | AggregateStep
  | DeliverStep
  | NotifyStep
  | ScheduleStep
  | TriggerStep
  | ParallelStep
  | CustomStep;

// ------------------------------------------------------------
// Helper types for compiler implementers (optional)
// ------------------------------------------------------------

// A minimal "symbol table" view (useful inside compiler passes)
export interface IntentSymbol {
  ref: RefName;
  entity?: Entity;
  cardinality?: "single" | "many";
  produced_by_step_id: ID;
}

// LLM output should conform to IntentContractV1.
// Exported alias for convenience:
export type IntentContract = IntentContractV1;
