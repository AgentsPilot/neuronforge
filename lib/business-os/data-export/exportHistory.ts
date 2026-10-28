// lib/business-os/data-export/exportHistory.ts
//
// Module export MX-1b (workplan BUSINESS_OS_EXPORT_MX1B_WORKPLAN.md §5; SA
// workplan review "The history tie-break", C-4): the export history the owner
// sees in the drawer, assembled from two reads.
//
//   1. the newest requests of the account, already limited and totally
//      ordered by the request repository (`requested_at DESC, id DESC`);
//   2. every module job of exactly those requests (no row limit).
//
// This function only joins them, deterministically:
//   - requests keep the order of read 1;
//   - inside a request, module lines follow the request's own `modules` array
//     (the drawer order at the time of the click), never the database's row
//     order, because every job of one request shares one `created_at`;
//   - a job whose module is not in the array (the start function inserts from
//     that array, so it should not happen) goes after the others, by module
//     then id, and is counted in `anomalies`;
//   - a module with no job row is left out and counted in `anomalies`.
//
// PURE. It imports neither repository, not even a type (SA C-4: the callers
// guard pins who may name them). Its inputs are declared here, structurally,
// and the route passes the repository rows in. It never logs: the route logs
// `anomalies` once.
//
// The output carries no Resend id, claim field, error code or failure code
// (the MX-1a DTO rule). `origin` is kept so MX-5 can label a support-sent
// export ("Sent by AgentPilot support", BQ-E5-1) without a shape change.

/** One request, as `listRecentForUser` returns it. */
export interface ExportHistoryRequestInput {
  id: string;
  origin: 'owner' | 'admin';
  modules: readonly string[];
  requestedAt: string;
}

/** One module job, as `listForRequestsOfUser` returns it. */
export interface ExportHistoryJobInput {
  id: string;
  requestId: string;
  module: string;
  status: ExportHistoryStatus;
  sentAt: string | null;
  emailCount: number;
}

/** The history words of requirement §3.7. "Sent", never "delivered" (XC-9). */
export type ExportHistoryStatus = 'waiting' | 'working' | 'sent' | 'failed' | 'interrupted';

/** One module line of the history. */
export interface ExportHistoryLine {
  module: string;
  status: ExportHistoryStatus;
  sentAt: string | null;
  emailCount: number;
}

/** One request of the history, with its module lines. */
export interface ExportHistoryRequest {
  requestId: string;
  requestedAt: string;
  origin: 'owner' | 'admin';
  modules: ExportHistoryLine[];
}

export interface AssembledExportHistory {
  requests: ExportHistoryRequest[];
  /** Jobs outside their request's module list, plus modules with no job. Expected 0. */
  anomalies: number;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const lineOf = (job: ExportHistoryJobInput): ExportHistoryLine => ({
  module: job.module,
  status: job.status,
  sentAt: job.sentAt,
  emailCount: job.emailCount,
});

export function assembleExportHistory(
  requests: readonly ExportHistoryRequestInput[],
  jobs: readonly ExportHistoryJobInput[]
): AssembledExportHistory {
  const jobsByRequest = new Map<string, ExportHistoryJobInput[]>();
  for (const job of jobs) {
    const list = jobsByRequest.get(job.requestId);
    if (list) list.push(job);
    else jobsByRequest.set(job.requestId, [job]);
  }

  let anomalies = 0;
  const out: ExportHistoryRequest[] = requests.map((request) => {
    const own = jobsByRequest.get(request.id) ?? [];
    const byModule = new Map<string, ExportHistoryJobInput>();
    const extras: ExportHistoryJobInput[] = [];
    for (const job of own) {
      // A module listed once has one job (UNIQUE (request_id, module)).
      if (request.modules.includes(job.module) && !byModule.has(job.module)) byModule.set(job.module, job);
      else extras.push(job);
    }

    const lines: ExportHistoryLine[] = [];
    for (const moduleId of request.modules) {
      const job = byModule.get(moduleId);
      if (job) lines.push(lineOf(job));
      else anomalies += 1;
    }
    extras.sort((a, b) => byText(a.module, b.module) || byText(a.id, b.id));
    anomalies += extras.length;
    lines.push(...extras.map(lineOf));

    return { requestId: request.id, requestedAt: request.requestedAt, origin: request.origin, modules: lines };
  });

  return { requests: out, anomalies };
}
