// lib/agentkit/v6/intent/plugin-vocabulary.ts
// Plugin Vocabulary v1 — plugin-agnostic, scalable.
// NO hardcoded plugin catalog.
// Builds injection payload from your plugin registry (golden source).

/* ─────────────────────────────────────────────────────────────
   1) Semantic Operations (global, finite, provider-agnostic)
   ───────────────────────────────────────────────────────────── */

export const SEMANTIC_OPS = [
  // EMAIL
  "EMAIL.SEARCH",
  "EMAIL.GET_MESSAGE",
  "EMAIL.LIST_MESSAGES",
  "EMAIL.LIST_ATTACHMENTS",
  "EMAIL.GET_ATTACHMENT",
  "EMAIL.SEND",
  "EMAIL.REPLY",
  "EMAIL.FORWARD",
  "EMAIL.MARK_READ",
  "EMAIL.MARK_UNREAD",
  "EMAIL.APPLY_LABEL",
  "EMAIL.REMOVE_LABEL",
  "EMAIL.ARCHIVE",
  "EMAIL.TRASH",
  "EMAIL.MOVE_TO_FOLDER",

  // FILES & FOLDERS
  "FILES.FOLDER_GET",
  "FILES.FOLDER_CREATE",
  "FILES.FOLDER_GET_OR_CREATE",
  "FILES.FOLDER_LIST",
  "FILES.FOLDER_DELETE",
  "FILES.LIST",
  "FILES.UPLOAD",
  "FILES.DOWNLOAD",
  "FILES.GET_LINK",
  "FILES.SET_PERMISSION",
  "FILES.GET_METADATA",
  "FILES.UPDATE_METADATA",
  "FILES.SEARCH",
  "FILES.COPY",
  "FILES.MOVE",
  "FILES.DELETE",
  "FILES.RENAME",

  // TABLES & SHEETS
  "TABLES.GET_SCHEMA",
  "TABLES.CREATE_TAB",
  "TABLES.APPEND_ROWS",
  "TABLES.UPDATE_ROWS",
  "TABLES.UPSERT_ROWS",
  "TABLES.DELETE_ROWS",
  "TABLES.QUERY",
  "TABLES.READ_RANGE",
  "TABLES.UPDATE_CELLS",
  "TABLES.CLEAR_RANGE",
  "TABLES.GET_METADATA",

  // DOCUMENTS
  "DOCS.EXTRACT_TEXT",
  "DOCS.EXTRACT_TABLES",
  "DOCS.OCR",
  "DOCS.CONVERT",
  "DOCS.GET_CONTENT",
  "DOCS.UPDATE_CONTENT",
  "DOCS.CREATE",
  "DOCS.GET_METADATA",

  // DATABASES & RECORDS
  "DB.QUERY",
  "DB.CREATE_RECORD",
  "DB.UPDATE_RECORD",
  "DB.DELETE_RECORD",
  "DB.GET_RECORD",
  "DB.LIST_RECORDS",
  "DB.SEARCH",
  "DB.GET_SCHEMA",

  // MESSAGING & CHAT
  "MESSAGE.SEND",
  "MESSAGE.POST_THREAD",
  "MESSAGE.UPLOAD_FILE",
  "MESSAGE.GET_CHANNEL",
  "MESSAGE.LIST_CHANNELS",
  "MESSAGE.CREATE_CHANNEL",
  "MESSAGE.GET_THREAD",
  "MESSAGE.REACT",
  "MESSAGE.PIN",
  "MESSAGE.UPDATE",
  "MESSAGE.DELETE",

  // TASKS & ISSUES
  "TASK.CREATE",
  "TASK.UPDATE",
  "TASK.GET",
  "TASK.LIST",
  "TASK.COMPLETE",
  "TASK.DELETE",
  "TASK.ADD_COMMENT",
  "TASK.ASSIGN",
  "TASK.SET_PRIORITY",
  "TASK.SET_STATUS",

  // CALENDAR & EVENTS
  "CALENDAR.CREATE_EVENT",
  "CALENDAR.UPDATE_EVENT",
  "CALENDAR.DELETE_EVENT",
  "CALENDAR.GET_EVENT",
  "CALENDAR.LIST_EVENTS",
  "CALENDAR.SEARCH_EVENTS",
  "CALENDAR.GET_AVAILABILITY",

  // CONTACTS & USERS
  "CONTACT.CREATE",
  "CONTACT.UPDATE",
  "CONTACT.GET",
  "CONTACT.LIST",
  "CONTACT.SEARCH",
  "CONTACT.DELETE",

  // PAYMENTS & TRANSACTIONS
  "PAYMENT.CREATE_CHARGE",
  "PAYMENT.GET_CUSTOMER",
  "PAYMENT.LIST_INVOICES",
  "PAYMENT.CREATE_INVOICE",
  "PAYMENT.REFUND",
  "PAYMENT.GET_TRANSACTION",
  "PAYMENT.LIST_TRANSACTIONS",

  // VERSION CONTROL & CODE
  "CODE.CREATE_ISSUE",
  "CODE.CREATE_PR",
  "CODE.GET_REPO",
  "CODE.GET_FILE",
  "CODE.CREATE_COMMIT",
  "CODE.CREATE_BRANCH",
  "CODE.MERGE_PR",
  "CODE.LIST_ISSUES",
  "CODE.LIST_PRS",
  "CODE.ADD_COMMENT",

  // COMMUNICATIONS
  "COMM.SEND_SMS",
  "COMM.SEND_CALL",
  "COMM.GET_MESSAGE",
  "COMM.LIST_MESSAGES",
  "COMM.SEND_EMAIL",

  // WEB & HTTP
  "WEB.HTTP_GET",
  "WEB.HTTP_POST",
  "WEB.HTTP_PUT",
  "WEB.HTTP_DELETE",
  "WEB.WEBHOOK_SEND",
  "WEB.SCRAPE",

  // AI & ML
  "AI.EXTRACT_FIELDS",
  "AI.CLASSIFY",
  "AI.SUMMARIZE",
  "AI.GENERATE_STRUCTURED",
  "AI.VALIDATE_OUTPUT",
  "AI.ANALYZE",
  "AI.TRANSLATE",
  "AI.SENTIMENT_ANALYSIS",

  // NOTIFICATIONS & ALERTS
  "NOTIFY.SEND_ALERT",
  "NOTIFY.SEND_NOTIFICATION",
  "NOTIFY.SEND_PUSH",

  // SEARCH & QUERY
  "SEARCH.QUERY",
  "SEARCH.FULL_TEXT",
  "SEARCH.FILTER",

  // STORAGE
  "STORAGE.PUT",
  "STORAGE.GET",
  "STORAGE.DELETE",
  "STORAGE.LIST",

  // WORKFLOWS & AUTOMATION
  "WORKFLOW.TRIGGER",
  "WORKFLOW.GET_STATUS",
  "WORKFLOW.CANCEL",
] as const;

export type SemanticOp = (typeof SEMANTIC_OPS)[number];

/* ─────────────────────────────────────────────────────────────
   2) Minimal param hints (NOT schemas)
   ───────────────────────────────────────────────────────────── */

export type ParamHint = {
  name: string;
  kind: "string" | "number" | "boolean" | "datetime" | "json" | "ref";
  notes?: string;
  examples?: string[];
};

export type SemanticOpHint = {
  op: SemanticOp;
  params?: ParamHint[];
  outputs?: string[]; // suggested output names to declare in step.outputs
};

export type PluginVocabularyCard = {
  plugin_key: string;
  aliases: string[];
  supported_ops: SemanticOpHint[];
};

/* ─────────────────────────────────────────────────────────────
   3) What the Plugin Registry must expose (golden source)
   This is NOT the plugin's real OpenAPI schema.
   It's the plugin's *semantic capability mapping*.
   ───────────────────────────────────────────────────────────── */

export type PluginRegistryEntry = {
  plugin_key: string;
  aliases?: string[];

  // IMPORTANT: semantic ops supported by this plugin
  // This is the only part injected into the intent LLM.
  semantic_ops: Array<{
    op: SemanticOp;
    param_hints?: ParamHint[];     // optional small hints
    output_hints?: string[];       // optional output names
  }>;
};

// Your registry type (you likely already have something like this)
export type PluginRegistry = Record<string, PluginRegistryEntry>;

/* ─────────────────────────────────────────────────────────────
   4) Build injection payload for the Intent LLM
   - Takes the registry (golden source)
   - Takes plugins_involved (extracted from enhanced prompt OR connected plugins)
   - Returns ONLY subset for those plugins
   ───────────────────────────────────────────────────────────── */

export function buildPluginVocabularyInjection(args: {
  registry: PluginRegistry;
  plugins_involved: string[]; // plugin keys or aliases
}) {
  const { registry, plugins_involved } = args;

  const wanted = new Set(plugins_involved.map((x) => x.toLowerCase()));

  const subset: PluginVocabularyCard[] = Object.values(registry)
    .filter((p) => {
      if (wanted.has(p.plugin_key.toLowerCase())) return true;
      for (const a of p.aliases ?? []) if (wanted.has(a.toLowerCase())) return true;
      return false;
    })
    .map((p) => ({
      plugin_key: p.plugin_key,
      aliases: p.aliases ?? [],
      supported_ops: p.semantic_ops.map((s) => ({
        op: s.op,
        params: s.param_hints ?? [],
        outputs: s.output_hints ?? [],
      })),
    }));

  return {
    semantic_ops: SEMANTIC_OPS,
    plugins: subset,
    rules: [
      "Use ONLY semantic_ops provided here for fetch/deliver steps.",
      "Do NOT invent plugin actions or new ops.",
      "Parameters must use the provided param_hints names if present.",
      "Intent output must stay semantic-only; binding to real plugin actions happens later.",
    ],
  } as const;
}
