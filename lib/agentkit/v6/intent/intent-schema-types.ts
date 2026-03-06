/* lib/intent/intent-schema-types.ts */

export type ISODateTime = string; // e.g. "2026-02-24T18:34:00Z"
export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };

export type Confidence = {
  score: number; // 0..1
  notes?: string;
};

export type EntityRef =
  | { kind: "literal"; value: JsonValue }
  | { kind: "var"; path: string } // e.g. "email.subject" or "steps.fetch_emails.output.emails"
  | { kind: "input"; key: string } // resolved user input key
  | { kind: "context"; key: string }; // runtime context (userId, timezone, runId, etc.)

export type DataSource =
  | {
      id: string;
      kind: "plugin";
      plugin_key: string; // "google-mail"
      capability: string; // "search_emails"
      query?: string;
      params?: Record<string, EntityRef>;
      output_hint?: { // semantic only
        shape: "array" | "object";
        primary_field?: string; // e.g. "emails"
      };
    }
  | {
      id: string;
      kind: "user_input";
      keys: string[]; // inputs expected/used
    }
  | {
      id: string;
      kind: "memory";
      scope: "user" | "agent" | "run";
      query: string;
    }
  | {
      id: string;
      kind: "external";
      description: string; // non-plugin source, e.g. "company policy pdf"
    };

export type OutputArtifact =
  | {
      id: string;
      kind: "email";
      to?: EntityRef;
      subject?: EntityRef;
      body?: EntityRef;
      format?: "text" | "html";
      attachments?: Array<{
        filename: EntityRef;
        content: EntityRef;
        mime_type?: EntityRef;
      }>;
    }
  | {
      id: string;
      kind: "table";
      destination?: { plugin_key: string; capability: string }; // e.g. google-sheets append_rows
      table_name?: EntityRef;
      columns: string[];
      rows?: EntityRef; // semantic reference to produced rows
    }
  | {
      id: string;
      kind: "file";
      destination?: { plugin_key: string; capability: string }; // e.g. google-drive upload_file
      name?: EntityRef;
      folder?: EntityRef;
      link_out?: boolean;
    }
  | {
      id: string;
      kind: "alert";
      title: EntityRef;
      message: EntityRef;
      severity: "low" | "medium" | "high" | "critical";
      channels?: Array<"dashboard" | "email" | "slack" | "sms" | "push">;
    }
  | {
      id: string;
      kind: "structured_json";
      schema_name?: string;
      value?: EntityRef;
    };

export type Constraint =
  | {
      id: string;
      kind: "unit_of_work";
      value: "email" | "attachment" | "row" | "record" | "ticket" | "event" | "file";
      notes?: string;
    }
  | {
      id: string;
      kind: "threshold";
      field_path: string; // semantic field like "transaction.amount"
      operator: "gt" | "gte" | "lt" | "lte" | "eq" | "ne";
      value: number | string;
      applies_to?: string[]; // step ids or output ids
      notes?: string;
    }
  | {
      id: string;
      kind: "side_effect";
      action: "write" | "send" | "delete" | "update" | "create";
      allowed_when?: string; // semantic condition string
      forbidden_when?: string;
      notes?: string;
    }
  | {
      id: string;
      kind: "invariant";
      rule: string; // e.g. "delivery_after_processing", "no_duplicate_writes"
      notes?: string;
    }
  | {
      id: string;
      kind: "privacy";
      rule: "no_account_identifiers" | "minimize_pii" | "mask_secrets";
      notes?: string;
    };

export type StepBase = {
  id: string;
  name: string;
  // Semantic only (no plugin params here). Compiler decides exact plugin actions.
  intent: string;
  inputs?: string[]; // ids of DataSource or previous step ids
  produces?: string[]; // semantic names e.g. ["transactions", "skipped_items"]
  confidence?: Confidence;
  notes?: string;
};

export type Step =
  | (StepBase & { kind: "fetch"; target: string }) // e.g. "unread emails"
  | (StepBase & { kind: "create"; target: string }) // e.g. "drive folder"
  | (StepBase & { kind: "transform"; operation: "filter" | "map" | "group" | "dedupe" | "flatten" | "sort"; rule: string })
  | (StepBase & { kind: "extract"; fields: string[]; from: string }) // semantic extraction
  | (StepBase & { kind: "decide"; condition: string; then: Step[]; else?: Step[] })
  | (StepBase & { kind: "loop"; over: string; item_name: string; collect: boolean; do: Step[] })
  | (StepBase & { kind: "parallel"; branches: Array<{ id: string; name: string; steps: Step[] }>; join: "all" | "any" })
  | (StepBase & { kind: "aggregate"; groupings: string[]; metrics: string[]; over: string })
  | (StepBase & { kind: "deliver"; output_ids: string[]; rule?: string })
  | (StepBase & { kind: "custom_step"; payload: JsonValue });

export type PluginNeed = {
  plugin_key: string;
  role: "input" | "output" | "both";
  capabilities: string[];
  required: boolean;
  reason: string;
};

export type ClarifyingQuestion = {
  id: string;
  question: string;
  type: "single_select" | "multi_select" | "text" | "number" | "boolean" | "date" | "json";
  options?: string[];
  required: boolean;
  blocks_progress?: boolean;
  maps_to?: { input_key: string }; // where answer goes
};

export type IntentContract = {
  version: "1.0";
  created_at: ISODateTime;

  goal: string;
  summary: string;

  // Must be stable: what the user wants, not how you execute it.
  unit_of_work: Constraint["value"];
  plugins: PluginNeed[];

  data_sources: DataSource[];
  steps: Step[];

  outputs: OutputArtifact[];
  constraints: Constraint[];

  // Optional: only if missing info blocks compilation.
  questions?: ClarifyingQuestion[];

  // Optional: model self-check
  risks?: string[];
  confidence?: Confidence;
};
