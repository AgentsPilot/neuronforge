/**
 * The wire shape of `GET /api/admin/business-os/llm-settings`, as the CLIENT
 * sees it.
 *
 * ── Why these are re-declared instead of imported ─────────────────────────
 * `lib/business-os/llm/adminSettingsView.ts` already declares this shape — but
 * it starts with `import 'server-only'` and pulls in the resolver, the policy
 * module and the call catalog. FR-6 is that the client imports NONE of those:
 * areas, call names, locks, providers and options arrive from the payload, so
 * the browser bundle can never carry a guardrail rule, a model name or a
 * temperature bound of its own.
 *
 * A `import type` would be erased at compile time and would "work", but it
 * puts a server module's path in a client file, where the next edit drops the
 * `type` keyword and the build breaks in a way nobody expects. The duplication
 * is deliberate and it is PINNED — but NOT by `npm test`. The pin is
 * `lib/business-os/llm/__tests__/adminSettingsView.wireTypes.test.ts` as
 * evaluated by **`npm run typecheck:bos-llm`**, which has that file in scope
 * and fails with `TS2344` when the server's `AreaView` stops satisfying the
 * type below. Jest does NOT catch it: ts-jest emits no diagnostics under this
 * repo's config, so no test here fails on a type error (SA F-4 / QA DEF-S2-9).
 * Run the gate, not the suite, after editing either side.
 *
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md §5
 */

/** Which level a resolved field came from. Rendered as a provenance badge. */
export type ProvenanceLevel = 'call' | 'area' | 'default';

/** The four settable fields, in the order the payload reports them. */
export type SettingField = 'enabled' | 'provider' | 'model' | 'temperature';

export interface SettingIssue {
  area: string;
  /** Absent for an area-level or whole-row issue. */
  callName?: string;
  level: 'row' | 'area' | 'call';
  field: SettingField | 'calls' | 'row';
  kind: 'rejected' | 'locked' | 'unknown' | 'adjusted';
  /** The guardrail's OWN words. Rendered verbatim, with a gloss beside it. */
  reason: string;
  value?: unknown;
}

/**
 * Who last changed an area — three states that are NOT interchangeable.
 *
 * `at` is nullable on every attributed state. The repository type says
 * `string`, but it is hand-written rather than generated, so nothing here
 * establishes what the column permits — and `new Date(null)` is the epoch,
 * which would render as 1970 and read as a fact. Defensive, and pinned by a
 * test (QA DEF-6 / S2-T7c, reworded per F-10).
 */
export type LastChangedBy =
  | { kind: 'no_row' }
  | { kind: 'not_recorded'; at: string | null }
  | { kind: 'admin'; at: string | null; email: string }
  | { kind: 'unresolved'; at: string | null; userId: string };

export interface ModelOption {
  provider: string;
  model: string;
}

export interface AreaModelOptions {
  byCall: Record<string, ModelOption[]>;
  allowedProvidersByCall: Record<string, readonly string[]>;
  cacheAgeMs: number;
  cacheTtlMs: number;
}

export interface CallView {
  callName: string;
  resolved: {
    enabled: boolean;
    provider: string;
    model: string;
    /** `null` means no temperature is sent. NEVER render this as 0. */
    temperature: number | null;
  };
  provenance: Record<SettingField, ProvenanceLevel>;
  issues: SettingIssue[];
  locks: {
    switchable: boolean;
    lockedTemperature: number | null;
    temperatureNotApplicable: boolean;
  };
  defaults: { provider: string; model: string; temperature: number | null };
}

export interface AreaView {
  area: string;
  key: string;
  switchable: boolean;
  configuredEnabled: boolean;
  rowPresent: boolean;
  storedRow: unknown;
  updatedAt: string | null;
  lastChangedBy: LastChangedBy;
  calls: CallView[];
  areaIssues: SettingIssue[];
  temperatureBounds: { min: number; max: number };
  modelOptions: AreaModelOptions;
}

export interface SettingsPayload {
  areas: AreaView[];
  generatedAt: string;
}

/** One window's two facts. `null` on the readings that read nothing. */
export interface LedgerWindowSummary {
  count: number;
  latestAt: string | null;
}

export interface LedgerCheckData {
  area: string;
  /** Kept as a string on the wire; the panel narrows it against the shared union. */
  kind: string;
  /** The shared sentence for this reading. The panel never writes its own. */
  reading: string;
  caveat: string;
  observationStartsAt?: string;
  after: LedgerWindowSummary | null;
  before: LedgerWindowSummary | null;
}
