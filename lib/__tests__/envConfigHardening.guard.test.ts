/**
 * Source guards for the environment configuration hardening
 * (docs/requirements/ENV_CONFIG_HARDENING_REQUIREMENT.md, and PROD-1a for
 * G-4 and G-5). Plain file reads only.
 *
 * G-1 next.config.js passes no NANGO_* name through the build.
 * G-2 no code under lib/, app/ or components/ reads the old public-prefixed
 *     Slack secret name; V1 and V2 Slack code both use SLACK_CLIENT_SECRET.
 * G-3 the V1 Slack strategy reads SLACK_CLIENT_SECRET.
 * G-4 no code reads the retired server-only Supabase address variable. There
 *     is one Supabase address, NEXT_PUBLIC_SUPABASE_URL; two settable
 *     addresses let service-role writes land in another project (PROD-1a, A1).
 * G-5 no code or test hardcodes a Supabase project ref. A hardcoded ref is how
 *     the middleware's onboarding gate went silently off on any other project
 *     (PROD-1a, A2), and a test that hardcodes one goes vacuous when the code
 *     stops using it.
 * G-6 every cron entry point calls the shared fail-closed check
 *     `isAuthorizedCronRequest` (lib/cron/cronAuth.ts), and nothing else reads
 *     CRON_SECRET. Five routes used to run for anyone with the secret unset
 *     (PROD-1b, A5).
 * G-7 every email send site is registered, with its number of sends and its
 *     number of recipient checks pinned, so a new send path or a new send in a
 *     known file cannot skip `checkOutboundRecipients` (PROD-1b, A7).
 * G-9 every test or debug route answers 404 on every deployment to anyone but
 *     an admin (PROD-1c F-2; production only before it): it awaits
 *     `testSurfaceRouteGate` (lib/security/testSurfaceGate.ts) first in every
 *     handler, or is exempt with a check it still has. Every
 *     `app/test-*` page segment awaits `testSurfacePageGate` first in its
 *     layout, and every render entry point under it is a client component,
 *     because a layout gate is defence in depth, not the boundary (PROD-1c,
 *     A6; SA B-1). G-9 takes its `app/` file names from the suite's one
 *     directory walk (no second walk; QA Performance 1), reads a file only
 *     when a rule needs it, and uses the shared handler parser in
 *     tests/helpers/source-scan.ts (SA N-2).
 *
 * ONE PASS (SA C-9). Every file is read once, as bytes; only a file whose
 * bytes contain a needle is decoded, and every rule runs over it in that
 * single pass. Only hits are kept, never file bodies. Budget: at most +1 s
 * for this suite on CI.
 *
 * LINE-ENDING PROOF. Content is normalised once (CR LF and lone CR to LF), so
 * line numbers agree across platforms. No pattern contains a newline, an
 * anchor or the multiline flag; boundaries are character lookarounds.
 * Relative paths are normalised to `/` before any comparison (C-8 b). The
 * self-tests run every matcher over LF and CRLF forms of the same text.
 *
 * NO COMMENT STRIPPING (C-8 a). A quoted retired name in a comment is a hit:
 * describe the variable in prose instead of quoting it.
 *
 * Names and refs are built from parts so this guard does not match itself.
 */

import * as fs from 'fs';
import * as path from 'path';

import { SUPABASE_PROJECTS } from '@/lib/admin/environment/supabaseProjects';
import { isClientComponent } from '@/tests/helpers/admin-page-guard';
import { blankStringLiterals, extractBracedBody, scanHandlers, stripComments } from '@/tests/helpers/source-scan';

const ROOT = path.resolve(__dirname, '..', '..');
const OLD_SLACK_NAME = ['NEXT', 'PUBLIC', 'SLACK', 'CLIENT', 'SECRET'].join('_');
const RETIRED_NAME = ['SUPABASE', 'URL'].join('_');
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const WORKFLOW_EXT = /\.ya?ml$/;
/** Walked recursively. The walk skips dot-directories, so workflows are listed on their own. */
const WALK_DIRS = ['lib', 'app', 'components', 'hooks', 'scripts', 'tests'];
const WORKFLOW_DIR = '.github/workflows';
const ROOT_FILES = ['middleware.ts', 'next.config.js'];
/** A setup file, not a test: where a stub would hide a reintroduced import-time reader. */
const JEST_SETUP = 'tests/plugins/jest-setup.ts';

const CATALOGUE = 'lib/admin/environment/catalogue.ts';
const PROJECT_MAP = 'lib/admin/environment/supabaseProjects.ts';
const GENERATED_CATALOG = 'lib/business-os/catalog/catalog.generated.ts';

/** G-4 exemptions: they name the variable so the admin Environment page can report it. */
const G4_EXEMPT = new Set([CATALOGUE, PROJECT_MAP]);
/** G-5 exemption: the label map itself. `catalog.generated.ts` is line-confined instead (below). */
const G5_EXEMPT = new Set([PROJECT_MAP]);
/**
 * `catalog.generated.ts` is written by the catalog generator from the
 * configured address, and nothing reads its `source` at runtime (every reader
 * indexes `.tables`). A hand edit would be overwritten, so its two provenance
 * lines may carry the host; any other line may not (C-8 e).
 */
const GENERATED_PROVENANCE_LINE = /(?:Source\s*:|"source"\s*:)/;

const KNOWN_REFS = [...SUPABASE_PROJECTS.keys()];

// ── G-6: cron auth (PROD-1b, A5) ───────────────────────────────────────────

const CRON_SECRET_NAME = ['CRON', 'SECRET'].join('_');
const CRON_DIR = 'app/api/cron';
const CRON_HELPER = 'isAuthorizedCronRequest';
/**
 * Cron entry points neither the directory walk nor vercel.json would find (SA
 * condition 4). The direct scheduler is not scheduled and, once fixed, no
 * longer reads the secret, so without this line removing its check would go
 * unnoticed, which is how it was open in the first place.
 */
const EXTRA_CRON_ENTRY_POINTS = ['app/api/run-scheduled-agents-direct/route.ts'];
/** Entry points with a different, still fail-closed check. Each must keep it (self-test below). */
const CRON_AUTH_EXEMPT: Record<string, { reason: string; stillHas: RegExp[] }> = {
  'app/api/cron/process-queue/route.ts': {
    reason: 'Called by QStash, not Vercel Cron: a signature check, a different credential',
    stillHas: [/verifySignatureAppRouter\(/],
  },
  'app/api/cron/check-free-tier-expiration/route.ts': {
    reason: 'Permanently disabled; its own check is stricter (no development bypass), pinned by its route test',
    stillHas: [/timingSafeEqual\(/, /if \(!secret\) return false/],
  },
};
/** The only files that may read the secret from process.env. */
const CRON_SECRET_READERS = new Set([
  'lib/cron/cronAuth.ts',
  'lib/cron/cronRunRecorder.ts',
  'app/api/cron/check-free-tier-expiration/route.ts',
]);

/** Read forms only (dot, optional chain, bracket, destructuring): route comments quote the name in backticks. */
function readPatterns(name: string): RegExp[] {
  const n = escapeRegExp(name);
  return [
    new RegExp(`process\\.env\\??\\.${n}${E}`, 'g'),
    new RegExp(`process\\.env\\??\\.?\\[\\s*['"\`]${n}['"\`]\\s*\\]`, 'g'),
    new RegExp(`\\{[^{}]*${B}${n}${E}[^{}]*\\}\\s*=\\s*process\\.env${E}`, 'g'),
  ];
}

/** The helper imported from its module, and called as a guard whose result is used (SA condition 10). */
const CRON_HELPER_IMPORT = /import\s*\{[^}]*(?<![A-Za-z0-9_])isAuthorizedCronRequest(?![A-Za-z0-9_])[^}]*\}\s*from\s*['"]@\/lib\/cron\/cronAuth['"]/;
const CRON_HELPER_GUARD = /!\s*isAuthorizedCronRequest\(/;

// ── G-7: email send sites (PROD-1b, A7) ────────────────────────────────────

/** A provider library or HTTP API in the file: it must be registered. */
const EMAIL_PROVIDER_PATTERNS: RegExp[] = [
  /(?:from\s*|require\(\s*|import\(\s*)['"`](?:nodemailer|resend|@sendgrid\/[A-Za-z0-9_.-]+|postmark|mailgun\.js|mailgun-js|@aws-sdk\/client-ses|@aws-sdk\/client-sesv2)['"`]/g,
  /api[.](?:sendgrid[.]com|mailgun[.]net|postmarkapp[.]com|brevo[.]com)/g,
];
/** A call that sends mail, or asks a provider to. Counted and pinned per file. */
const EMAIL_DISPATCH_PATTERNS: RegExp[] = [
  /[.]sendMail\(/g,
  /api[.]resend[.]com\/emails/g,
  /\/messages\/send(?![A-Za-z0-9_])/g,
  /\/drafts\/send(?![A-Za-z0-9_])/g,
  /(?<![A-Za-z0-9_])messages[.]send\(/g,
  /(?<![A-Za-z0-9_])drafts[.]send\(/g,
  /\/sendMail(?![A-Za-z0-9_])/g,
  /\/replyAll(?=['"`?])/g,
  /\/forward(?=['"`?])/g,
  /(?<![A-Za-z0-9_])sendUpdates(?![A-Za-z0-9_])/g,
  /(?<![A-Za-z0-9_])sendNotifications(?![A-Za-z0-9_])/g,
  /*
   * PROD-1b.2: a Graph calendar path. Graph mails attendees on any event
   * write and has no flag to stop it, so every path is counted (reads too):
   * `/me`, or `/users/<id>` or `/groups/<id>` (one segment: no slash,
   * whitespace or quote, so a template id counts once), then `/events`,
   * `/calendar`, `/calendars` or `/calendarGroups`. Covers `cancel`,
   * `forward`, `accept`, `decline` and `instances` below an event.
   */
  /\/(?:me|users\/[^\s'"`/]+|groups\/[^\s'"`/]+)\/(?:events|calendars?|calendarGroups)(?=['"`/?])/g,
  /* PROD-1b.2: Graph's message send (a draft) and reply, which send at once. `replyAll` has its own pattern above. */
  /\/messages\/[^\s'"`/]+\/(?:send|reply)(?=['"`?])/g,
];
/** Supabase Auth mailers (N-1): registered with zero checks, so a new one is reviewed rather than unseen (SA condition 9). */
const EMAIL_AUTH_SENDER_PATTERNS: RegExp[] = [/(?<![A-Za-z0-9_])(?:inviteUserByEmail|resetPasswordForEmail|signInWithOtp)\(/g];
/** The recipient check, as called at a send site. */
const EMAIL_CHECK_PATTERNS: RegExp[] = [/(?<![A-Za-z0-9_])(?:checkOutboundRecipients|isRecipientGuardOn)\(/g];

/**
 * Prefilter: one regex over a latin1 view of the bytes (a cheap decode). Measured
 * at about half the cost of nineteen Buffer.includes calls over the ~3,100
 * deployed files (SA condition 13). Every pattern below contains one of these.
 */
const EMAIL_PREFILTER =
  /nodemailer|resend|sendgrid|postmark|mailgun|client-ses|brevo|sendMail|messages[./]send|drafts[./]send|replyAll|[/]forward|sendUpdates|sendNotifications|inviteUserByEmail|resetPasswordForEmail|signInWithOtp|checkOutboundRecipients|isRecipientGuardOn|[/](?:me|users[/][^/'"`\s]+|groups[/][^/'"`\s]+)[/](?:events|calendar)|[/]messages[/][^/'"`\s]+[/](?:send|reply)/;

interface EmailSendSite {
  reason: string;
  dispatch: number;
  checks: number;
  authSenders?: number;
}

/**
 * Every file that sends email, or asks a provider to. Change a count only
 * together with the code: a new send needs `checkOutboundRecipients` before it
 * (lib/email/recipientAllowList.ts). Counts include comments (no stripping).
 */
const EMAIL_SEND_SITES: Record<string, EmailSendSite> = {
  'lib/notifications/emailTransport.ts': {
    reason: 'E-1 the shared transport: one check before Resend, SMTP and the Gmail system sender',
    dispatch: 3,
    checks: 1,
  },
  'lib/server/gmail-plugin-executor.ts': {
    reason: 'E-3 to E-5 send_email, reply_to_email, send_draft (refused whenever the guard is on)',
    dispatch: 3,
    checks: 3,
  },
  'lib/server/outlook-plugin-executor.ts': {
    reason:
      'E-6 send_email (the second sendMail hit is a comment); E-9 calendar (PROD-1b.2): create strips attendees when one is refused, ' +
      'update and delete read the event first and do not write when an attendee is refused. Calendar paths are counted, reads included: ' +
      'sendMail 2 + calendar 7 (list 2, create, read helper, update, delete, details). Checks: send 1, create 1, update 3, delete 2',
    dispatch: 9,
    checks: 7,
  },
  'lib/plugins/google-mail/sendEmailDraft.ts': { reason: 'E-7 the legacy Gmail helper', dispatch: 1, checks: 1 },
  'lib/server/google-calendar-plugin-executor.ts': {
    reason: 'E-8 Google invitations: sendUpdates=none whenever an attendee is refused, and on every guarded delete',
    // 5: PROD-1 S3.3c reads `sendUpdates` once to alert only when Google would have mailed someone. No new send.
    dispatch: 5,
    checks: 3,
  },
  'lib/client/auth-actions.ts': {
    reason: 'N-1 Supabase Auth password reset: sent by Supabase to the person who asked; no recipient check by design',
    dispatch: 0,
    checks: 0,
    authSenders: 1,
  },
};

// ── G-9: the test and debug surface (PROD-1c, A6) ──────────────────────────

const GATE_MODULE = '@/lib/security/testSurfaceGate';
const ROUTE_GATE = 'testSurfaceRouteGate';
const PAGE_GATE = 'testSurfacePageGate';
/** A route segment that names the test or debug surface: `test` or `debug` as a whole word of it (`test`, `test-x`, `x-debug-y`). */
const TEST_SEGMENT = /(?:^|[-_])(?:test|debug)(?:[-_]|$)/i;
/** A top-level page segment of the test surface. */
const TEST_PAGE_DIR = /^test-/;
/** Render entry points a layout gate does not protect from the router-state bypass (OI-21). */
const RENDER_ENTRY = /^(?:page|template|default|loading|error|not-found)\.(?:tsx|ts|jsx|js)$/;

/** Test-surface routes with their own, still-present check instead of the gate. */
const TEST_SURFACE_EXEMPT: Record<string, { reason: string; stillHas: RegExp[] }> = {
  'app/api/website/analytics/test/route.ts': {
    reason:
      'T-12: answers 403 on every built deployment (Vercel and a local next start build with NODE_ENV=production); ' +
      'in next dev it needs a sign-in, not an admin, so it is NOT stricter than the gate there. ' +
      'Outside the approved F-2 list (T-3 to T-10); nothing calls it, a deletion candidate (F-2 workplan section 10)',
    stillHas: [/process\.env\.NODE_ENV !== 'development'/],
  },
  'app/api/admin/business-os/test/plan-test-clock/route.ts': {
    reason: 'T-13: an admin tool, already requireAdmin in every environment',
    stillHas: [/await requireAdmin\(/],
  },
  'app/api/admin/business-os/test/take-credits/route.ts': {
    reason: 'T-14: an admin tool, already requireAdmin in every environment',
    stillHas: [/await requireAdmin\(/],
  },
  'app/api/admin/test-account-cleanup/check/route.ts': {
    reason: 'T-15: an admin tool needed in production, already requireAdmin',
    stillHas: [/await requireAdmin\(/],
  },
  'app/api/admin/test-account-cleanup/delete/route.ts': {
    reason: 'T-16: an admin tool needed in production, already requireAdmin',
    stillHas: [/await requireAdmin\(/],
  },
};

const gateImport = (name: string): RegExp =>
  new RegExp(`import\\s*\\{[^}]*(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])[^}]*\\}\\s*from\\s*['"]${escapeRegExp(GATE_MODULE)}['"]`);
/** The gate call (its argument may nest one level of parentheses), then the early return. */
const ROUTE_GATE_FIRST = new RegExp(
  `^await\\s+${ROUTE_GATE}\\((?:[^()]|\\([^()]*\\))*\\)\\s*;?\\s*if\\s*\\(\\s*gate\\s*\\)\\s*return\\s+gate(?![A-Za-z0-9_])`
);
const PAGE_GATE_FIRST = new RegExp(`^await\\s+${PAGE_GATE}\\(\\s*\\)`);

/** The code of a body, comments removed and string contents blanked, so neither can hold a decoy. */
const scaffoldOf = (code: string): string => blankStringLiterals(stripComments(code));

/** The body from its first `await` on, or null when it awaits nothing. */
function fromFirstAwait(body: string): string | null {
  const scaffold = scaffoldOf(body);
  const match = /(?<![A-Za-z0-9_$.])await(?![A-Za-z0-9_$])/.exec(scaffold);
  return match ? scaffold.slice(match.index) : null;
}

/** What is wrong with a gated route's source, or null. */
function testRouteProblem(text: string): string | null {
  if (!gateImport(ROUTE_GATE).test(stripComments(text))) return `does not import ${ROUTE_GATE} from ${GATE_MODULE}`;
  const { handlers, unparseable } = scanHandlers(text);
  if (unparseable.length > 0) return `has handlers this guard cannot parse: ${unparseable.join('; ')}`;
  if (handlers.length === 0) return 'exports no HTTP handler this guard can find';
  for (const handler of handlers) {
    const rest = fromFirstAwait(handler.body);
    if (rest === null || !ROUTE_GATE_FIRST.test(rest)) {
      return `${handler.name}: the first await is not \`await ${ROUTE_GATE}(…)\` followed by \`if (gate) return gate\``;
    }
  }
  return null;
}

/** Does this file's default-exported component await the page gate as its first statement? */
function awaitsPageGateFirst(text: string): boolean {
  const code = stripComments(text);
  if (!gateImport(PAGE_GATE).test(code)) return false;
  const head = /export\s+default\s+async\s+function\s*[A-Za-z0-9_$]*\s*\(/.exec(blankStringLiterals(code));
  if (!head) return false;
  const body = extractBracedBody(code, head.index + head[0].length - 1);
  if (body === null) return false;
  return PAGE_GATE_FIRST.test(scaffoldOf(body.slice(1)).trimStart());
}

/** What is wrong with a render entry point under a test page segment, or null (SA B-1). */
function testRenderEntryProblem(text: string): string | null {
  if (isClientComponent(text, stripComments) || awaitsPageGateFirst(text)) return null;
  return `is a server component that does not await ${PAGE_GATE}() first: a layout gate can be skipped (OI-21), so it must be 'use client' or guard itself`;
}

interface TestSurface {
  routes: string[];
  pageDirs: string[];
  /** Every file under a test page segment, relative. */
  pageFiles: string[];
}

/**
 * G-9's view of `app/`: every file name the shared walk saw there, any
 * extension, minus anything under a `__tests__` directory. File names only; a
 * file is read only when a rule needs it.
 */
function testSurface(): TestSurface {
  const rels = repositoryTree().appFiles.filter((rel) => !rel.split('/').includes('__tests__'));
  const routes = rels.filter(
    (rel) => /\/route\.(?:ts|tsx|js)$/.test(rel) && rel.split('/').slice(1, -1).some((segment) => TEST_SEGMENT.test(segment))
  );
  const pageDirs = fs
    .readdirSync(path.join(ROOT, 'app'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && TEST_PAGE_DIR.test(entry.name))
    .map((entry) => `app/${entry.name}`);
  const pageFiles = rels.filter((rel) => pageDirs.some((dir) => rel.startsWith(`${dir}/`)));
  return { routes: routes.sort(), pageDirs: pageDirs.sort(), pageFiles: pageFiles.sort() };
}

// ── Matchers (pure) ─────────────────────────────────────────────────────────

const B = '(?<![A-Za-z0-9_])';
const E = '(?![A-Za-z0-9_])';
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every form a read (or a setter) of `name` can take. */
function retiredNamePatterns(name: string): RegExp[] {
  const n = escapeRegExp(name);
  return [
    new RegExp(`process\\.env\\??\\.${n}${E}`, 'g'),
    new RegExp(`process\\.env\\??\\.?\\[\\s*['"\`]${n}['"\`]\\s*\\]`, 'g'),
    // A quoted literal: `required` lists, `Deno.env.get(…)`, a bracket read.
    new RegExp(`(['"\`])${n}\\1`, 'g'),
    // Destructuring from process.env, across lines.
    new RegExp(`\\{[^{}]*${B}${n}${E}[^{}]*\\}\\s*=\\s*process\\.env${E}`, 'g'),
    // A key: a YAML `env:` entry, or an object key handing it to a child process.
    new RegExp(`${B}${n}\\s*:(?!:)`, 'g'),
    // Workflow expressions, or `env.NAME` off any alias of process.env.
    new RegExp(`(?<![A-Za-z0-9_$])(?:secrets|vars|env)\\.${n}${E}`, 'g'),
  ];
}

/** Hardcoded project refs: every known ref, and the two shapes a hosted ref takes. */
function refPatterns(knownRefs: readonly string[]): RegExp[] {
  return [
    ...knownRefs.map((ref) => new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(ref)}(?![A-Za-z0-9])`, 'g')),
    /(?<![A-Za-z0-9-])[a-z0-9]{20}\.supabase\.(?:co|in)(?![A-Za-z0-9])/g,
    /(?<![A-Za-z0-9])sb-[a-z0-9]{20}-auth-token/g,
  ];
}

const normalise = (text: string): string => text.replace(/\r\n?/g, '\n');

/** 1-based line numbers of every match, deduplicated. `text` must be normalised. */
function hitLines(text: string, patterns: readonly RegExp[]): number[] {
  const lines = new Set<number>();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      let line = 1;
      for (let i = 0; i < (match.index ?? 0); i += 1) if (text.charCodeAt(i) === 10) line += 1;
      lines.add(line);
    }
  }
  return [...lines].sort((a, b) => a - b);
}

// ── Scope ───────────────────────────────────────────────────────────────────

const toPosix = (rel: string): string => rel.split(path.sep).join('/');

function isTestFile(rel: string): boolean {
  if (rel === JEST_SETUP) return false;
  return rel.startsWith('tests/') || rel.split('/').includes('__tests__') || /\.(test|spec)\.[a-z]+$/.test(rel);
}

/** G-4 scope: deployed and operator code, root config, workflows and the Jest setup file. */
function inG4Scope(rel: string): boolean {
  return !isTestFile(rel);
}

/** G-6 R2 and G-7 scope: deployed source, not tests and not operator scripts. */
function inDeployedScope(rel: string): boolean {
  return (/^(lib|app|components|hooks)\//.test(rel) || rel === 'middleware.ts') && !isTestFile(rel);
}

function countHits(text: string, patterns: readonly RegExp[]): number {
  let total = 0;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    total += [...text.matchAll(pattern)].length;
  }
  return total;
}

/** G-2's original scope, unchanged. */
function inG2Scope(rel: string): boolean {
  return /^(lib|app|components)\//.test(rel) && !isTestFile(rel) && rel !== CATALOGUE;
}

/** `out` gets source files (absolute). `all`, when given, gets every file name (relative, `/`). */
function walk(dir: string, out: string[], all?: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out, all);
    else {
      if (SOURCE_EXT.test(entry.name)) out.push(full);
      all?.push(toPosix(path.relative(ROOT, full)));
    }
  }
}

interface RepositoryTree {
  /** Every source file under WALK_DIRS (absolute), for the one-pass scan. */
  sourceFiles: string[];
  /** Every file under `app/`, any extension (relative, `/`), for G-9's names. */
  appFiles: string[];
}

let repositoryTreeCache: RepositoryTree | undefined;

/**
 * The directory walk, done once per suite and shared by the one-pass scan and
 * G-9 (C-9, QA Performance 1). Memoised rather than run in one `beforeAll`, so
 * a filtered run (`-t G-9`) still gets the tree.
 */
function repositoryTree(): RepositoryTree {
  if (!repositoryTreeCache) {
    const sourceFiles: string[] = [];
    const appFiles: string[] = [];
    for (const dir of WALK_DIRS) walk(path.join(ROOT, dir), sourceFiles, dir === 'app' ? appFiles : undefined);
    repositoryTreeCache = { sourceFiles, appFiles };
  }
  return repositoryTreeCache;
}

interface Hit {
  file: string;
  line: number;
  /** The text of the hit line, kept only for the generated-catalog confinement check. */
  text?: string;
}

interface EmailCounts {
  provider: number;
  dispatch: number;
  checks: number;
  authSenders: number;
}

interface ScanResult {
  counts: { g2: number; g4: number; g5: number; workflows: number; deployed: number };
  g2: string[];
  g4: Hit[];
  g5: Hit[];
  /** G-6 R2: reads of the cron secret outside the allowed files. */
  cronReads: Hit[];
  /** G-7: files with any send-shaped hit, and their counts. */
  email: Record<string, EmailCounts>;
}

function scanRepository(): ScanResult {
  // A copy: the root files and workflows below must not leak into the shared tree.
  const files = [...repositoryTree().sourceFiles];
  for (const name of ROOT_FILES) files.push(path.join(ROOT, name));
  const workflowDir = path.join(ROOT, WORKFLOW_DIR);
  const workflows = fs.readdirSync(workflowDir).filter((name) => WORKFLOW_EXT.test(name));
  for (const name of workflows) files.push(path.join(workflowDir, name));

  const g4Patterns = retiredNamePatterns(RETIRED_NAME);
  const g5Patterns = refPatterns(KNOWN_REFS);
  const slackNeedle = Buffer.from(OLD_SLACK_NAME);
  const retiredNeedle = Buffer.from(RETIRED_NAME);
  const refNeedles = [Buffer.from('.supabase.'), Buffer.from('-auth-token'), ...KNOWN_REFS.map((ref) => Buffer.from(ref))];

  const cronPatterns = readPatterns(CRON_SECRET_NAME);
  const cronNeedle = Buffer.from(CRON_SECRET_NAME);

  const result: ScanResult = {
    counts: { g2: 0, g4: 0, g5: 0, workflows: workflows.length, deployed: 0 },
    g2: [],
    g4: [],
    g5: [],
    cronReads: [],
    email: {},
  };

  for (const full of files) {
    const rel = toPosix(path.relative(ROOT, full));
    const g2 = inG2Scope(rel);
    const g4 = inG4Scope(rel);
    // G-5 covers G-4's scope plus every test file, which is every file walked.
    if (g2) result.counts.g2 += 1;
    if (g4) result.counts.g4 += 1;
    result.counts.g5 += 1;

    const deployed = inDeployedScope(rel);
    if (deployed) result.counts.deployed += 1;

    const bytes = fs.readFileSync(full);
    const wantG2 = g2 && bytes.includes(slackNeedle);
    const wantG4 = g4 && !G4_EXEMPT.has(rel) && bytes.includes(retiredNeedle);
    const wantG5 = !G5_EXEMPT.has(rel) && refNeedles.some((needle) => bytes.includes(needle));
    const wantCron = deployed && !CRON_SECRET_READERS.has(rel) && bytes.includes(cronNeedle);
    const wantEmail = deployed && EMAIL_PREFILTER.test(bytes.toString('latin1'));
    if (!wantG2 && !wantG4 && !wantG5 && !wantCron && !wantEmail) continue;

    const text = normalise(bytes.toString('utf8'));
    if (wantG2 && text.includes(OLD_SLACK_NAME)) result.g2.push(rel);
    if (wantG4) for (const line of hitLines(text, g4Patterns)) result.g4.push({ file: rel, line });
    if (wantG5) {
      const hits = hitLines(text, g5Patterns);
      if (hits.length > 0) {
        const lines = text.split('\n');
        for (const line of hits) result.g5.push({ file: rel, line, text: lines[line - 1] });
      }
    }
    if (wantCron) for (const line of hitLines(text, cronPatterns)) result.cronReads.push({ file: rel, line });
    if (wantEmail) {
      const counts: EmailCounts = {
        provider: countHits(text, EMAIL_PROVIDER_PATTERNS),
        dispatch: countHits(text, EMAIL_DISPATCH_PATTERNS),
        checks: countHits(text, EMAIL_CHECK_PATTERNS),
        authSenders: countHits(text, EMAIL_AUTH_SENDER_PATTERNS),
      };
      if (counts.provider + counts.dispatch + counts.authSenders > 0) result.email[rel] = counts;
    }
  }
  return result;
}

/** Every cron entry point: the directory, every vercel.json cron path, and the explicit extras. */
function cronEntryPoints(): { files: string[]; scheduled: number; missing: string[] } {
  const files = new Set<string>();
  for (const entry of fs.readdirSync(path.join(ROOT, CRON_DIR), { withFileTypes: true })) {
    if (entry.isDirectory() && fs.existsSync(path.join(ROOT, CRON_DIR, entry.name, 'route.ts'))) {
      files.add(`${CRON_DIR}/${entry.name}/route.ts`);
    }
  }
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as { crons?: Array<{ path: string }> };
  const missing: string[] = [];
  for (const cron of vercel.crons ?? []) {
    const rel = `app${cron.path}/route.ts`;
    if (fs.existsSync(path.join(ROOT, rel))) files.add(rel);
    else missing.push(cron.path);
  }
  for (const rel of EXTRA_CRON_ENTRY_POINTS) {
    if (fs.existsSync(path.join(ROOT, rel))) files.add(rel);
    else missing.push(rel);
  }
  return { files: [...files].sort(), scheduled: (vercel.crons ?? []).length, missing };
}

/** What is wrong with one cron entry point's source, or null. */
function cronEntryPointProblem(text: string): string | null {
  if (!CRON_HELPER_IMPORT.test(text)) return `does not import ${CRON_HELPER} from @/lib/cron/cronAuth`;
  if (!CRON_HELPER_GUARD.test(text)) return `does not refuse on !${CRON_HELPER}(…)`;
  return null;
}

const describeHits = (hits: Hit[]): string[] => hits.map((hit) => `${hit.file}:${hit.line}`);

/** G-5 hits that are allowed: the generated catalog's provenance lines only. */
function isAllowedRefHit(hit: Hit): boolean {
  return hit.file === GENERATED_CATALOG && GENERATED_PROVENANCE_LINE.test(hit.text ?? '');
}

// ── The guards ──────────────────────────────────────────────────────────────

describe('environment configuration hardening guards', () => {
  let scan: ScanResult;

  beforeAll(() => {
    scan = scanRepository();
  });

  it('G-1 next.config.js names no NANGO_ variable', () => {
    const src = fs.readFileSync(path.join(ROOT, 'next.config.js'), 'utf8');
    expect(src).not.toMatch(/NANGO_/);
  });

  it('G-2 no source file reads the old public-prefixed Slack secret name', () => {
    // A broken walk would scan nothing and pass vacuously.
    expect(scan.counts.g2).toBeGreaterThan(100);
    expect(scan.g2).toEqual([]);
  });

  it('G-3 the V1 Slack strategy reads SLACK_CLIENT_SECRET', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'plugins', 'strategies', 'slackPluginStrategy.ts'), 'utf8');
    expect(src).toContain('process.env.SLACK_CLIENT_SECRET');
  });

  it('G-4 no code reads the retired Supabase address variable; read NEXT_PUBLIC_SUPABASE_URL', () => {
    // Floors, so a broken walk cannot pass vacuously.
    expect(scan.counts.g4).toBeGreaterThan(1000);
    expect(scan.counts.workflows).toBeGreaterThan(3);
    // Each offender is file:line. Fix: read process.env.NEXT_PUBLIC_SUPABASE_URL instead.
    expect(describeHits(scan.g4)).toEqual([]);
  });

  it('G-5 no code or test hardcodes a Supabase project ref; derive it from NEXT_PUBLIC_SUPABASE_URL', () => {
    expect(scan.counts.g5).toBeGreaterThan(scan.counts.g4);
    // Each offender is file:line. Fix: derive from the configured address, or build a fixture from parts.
    expect(describeHits(scan.g5.filter((hit) => !isAllowedRefHit(hit)))).toEqual([]);
  });

  it('G-6 R1 every cron entry point calls isAuthorizedCronRequest from lib/cron/cronAuth before any work', () => {
    const { files, scheduled, missing } = cronEntryPoints();
    // Floors, so a broken walk cannot pass vacuously.
    expect(files.length).toBeGreaterThanOrEqual(25);
    expect(scheduled).toBeGreaterThanOrEqual(20);
    // A vercel.json path or an explicit extra with no route file.
    expect(missing).toEqual([]);
    for (const rel of EXTRA_CRON_ENTRY_POINTS) expect(files).toContain(rel);

    const problems: string[] = [];
    for (const rel of files) {
      if (CRON_AUTH_EXEMPT[rel]) continue;
      const problem = cronEntryPointProblem(normalise(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
      // Fix: call isAuthorizedCronRequest from lib/cron/cronAuth and answer 401 before any work.
      if (problem) problems.push(`${rel}: ${problem}`);
    }
    expect(problems).toEqual([]);
  });

  it('G-6 R2 nothing reads CRON_SECRET except the helper, the run recorder and the disabled free-tier route', () => {
    expect(scan.counts.deployed).toBeGreaterThan(1000);
    // Each offender is file:line. Fix: call isAuthorizedCronRequest instead of reading the secret.
    expect(describeHits(scan.cronReads)).toEqual([]);
  });

  it('G-7 every email send site is registered, and its sends and recipient checks are pinned', () => {
    // A file that sends and is not listed, or a listed file that no longer sends.
    expect(Object.keys(scan.email).sort()).toEqual(Object.keys(EMAIL_SEND_SITES).sort());
    const measured: Record<string, { dispatch: number; checks: number; authSenders: number }> = {};
    const pinned: Record<string, { dispatch: number; checks: number; authSenders: number }> = {};
    for (const [rel, site] of Object.entries(EMAIL_SEND_SITES)) {
      const counts = scan.email[rel];
      measured[rel] = { dispatch: counts?.dispatch ?? -1, checks: counts?.checks ?? -1, authSenders: counts?.authSenders ?? -1 };
      pinned[rel] = { dispatch: site.dispatch, checks: site.checks, authSenders: site.authSenders ?? 0 };
    }
    // A changed count means a send was added or moved: put checkOutboundRecipients before it, then update the pin.
    expect(measured).toEqual(pinned);
  });
});

describe('G-9 the test and debug surface is gated on every deployment (PROD-1c, A6, F-2)', () => {
  let surface: TestSurface;
  const read = (rel: string): string => normalise(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

  beforeAll(() => {
    surface = testSurface();
  });

  it('G-9 R1 finds the surface (floors, so a broken walk cannot pass vacuously)', () => {
    expect(surface.routes.length).toBeGreaterThanOrEqual(13);
    expect(surface.pageDirs.length).toBeGreaterThanOrEqual(2);
  });

  it('G-9 R2 every test or debug route awaits testSurfaceRouteGate first in every handler, or is exempt', () => {
    const problems: string[] = [];
    for (const rel of surface.routes) {
      if (TEST_SURFACE_EXEMPT[rel]) continue;
      const problem = testRouteProblem(read(rel));
      // Fix: `const gate = await testSurfaceRouteGate(requestLogger); if (gate) return gate;` first.
      if (problem) problems.push(`${rel}: ${problem}`);
    }
    expect(problems).toEqual([]);
  });

  it('G-9 R3 every app/test-* segment has a layout that awaits testSurfacePageGate first, and no route handler', () => {
    const problems: string[] = [];
    for (const dir of surface.pageDirs) {
      const layout = surface.pageFiles.find((rel) => rel.startsWith(`${dir}/layout.`) && rel.split('/').length === dir.split('/').length + 1);
      if (!layout) problems.push(`${dir}: no layout.tsx to carry the page gate`);
      else if (!awaitsPageGateFirst(read(layout))) problems.push(`${layout}: does not await ${PAGE_GATE}() as its first statement`);
    }
    // A route.ts under a page segment is not wrapped by its layout (the /admin E1 escape).
    for (const rel of surface.pageFiles) {
      if (/\/route\.(?:ts|tsx|js)$/.test(rel)) problems.push(`${rel}: a route handler under a test page segment`);
    }
    expect(problems).toEqual([]);
  });

  it("G-9 R3 every render entry point under app/test-* is 'use client' or guards itself first (SA B-1)", () => {
    const entries = surface.pageFiles.filter((rel) => RENDER_ENTRY.test(rel.split('/').pop() ?? ''));
    expect(entries.length).toBeGreaterThanOrEqual(surface.pageDirs.length);
    const problems = entries
      .map((rel) => ({ rel, problem: testRenderEntryProblem(read(rel)) }))
      .filter((entry) => entry.problem !== null);
    expect(problems).toEqual([]);
  });

  it('G-9 R4 every exemption is still on the surface, has a reason, and still has its own check', () => {
    for (const [rel, exemption] of Object.entries(TEST_SURFACE_EXEMPT)) {
      expect({ rel, onSurface: surface.routes.includes(rel) }).toEqual({ rel, onSurface: true });
      expect(exemption.reason.length).toBeGreaterThan(10);
      const text = read(rel);
      for (const pattern of exemption.stillHas) {
        expect({ rel, check: String(pattern), present: pattern.test(text) }).toEqual({ rel, check: String(pattern), present: true });
      }
    }
  });
});

// ── Self-tests: the guard can fail ──────────────────────────────────────────

describe('G-4 and G-5 matchers (self-tests)', () => {
  const crlf = (text: string): string => text.replace(/\n/g, '\r\n');
  const g4 = retiredNamePatterns(RETIRED_NAME);
  const ref20 = 'k'.repeat(20);
  const knownFixture = `${'k'.repeat(19)}x`;
  const g5 = refPatterns([knownFixture]);

  const FORBIDDEN_G4 = [
    `const url = process.env.${RETIRED_NAME}`,
    `const url = process.env?.${RETIRED_NAME}!`,
    `const url = process.env['${RETIRED_NAME}']`,
    `const url = process.env[ "${RETIRED_NAME}" ]`,
    `const required = ['${RETIRED_NAME}', 'X']`,
    `const url = Deno.env.get("${RETIRED_NAME}")`,
    `const {\n  ${RETIRED_NAME},\n  OTHER\n} = process.env`,
    `const { ${RETIRED_NAME}: url } = process.env`,
    `        env:\n          ${RETIRED_NAME}: 'https://ci.invalid'`,
    `run: echo \${{ secrets.${RETIRED_NAME} }}`,
    `run: echo \${{ vars.${RETIRED_NAME} }}`,
    `if: env.${RETIRED_NAME} != ''`,
    `// \`${RETIRED_NAME}\` in a comment counts (no comment stripping)`,
  ];

  const ALLOWED_G4 = [
    'const url = process.env.NEXT_PUBLIC_SUPABASE_URL',
    "const required = ['NEXT_PUBLIC_SUPABASE_URL']",
    `import { ${RETIRED_NAME}_ROW_NAMES } from './supabaseProjects'`,
    `for (const name of ${RETIRED_NAME}_ROW_NAMES) {}`,
    `const ${RETIRED_NAME} = process.env.NEXT_PUBLIC_SUPABASE_URL!;`,
    `if (!${RETIRED_NAME} || !KEY) return;`,
    `createClient(${RETIRED_NAME}, KEY)`,
    `NEXT_PUBLIC_SUPABASE_URL: 'https://ci.invalid'`,
  ];

  it.each(FORBIDDEN_G4.map((text) => [text]))('G-4 catches %p in LF and CRLF, on the same line', (text) => {
    const sample = `// first line\n${text}`;
    const lf = hitLines(normalise(sample), g4);
    expect(lf.length).toBeGreaterThan(0);
    // Never the decoy first line; never past the sample's last line.
    expect(Math.min(...lf)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...lf)).toBeLessThanOrEqual(sample.split('\n').length);
    expect(hitLines(normalise(crlf(sample)), g4)).toEqual(lf);
  });

  it.each(ALLOWED_G4.map((text) => [text]))('G-4 allows the lookalike %p', (text) => {
    expect(hitLines(normalise(text), g4)).toEqual([]);
    expect(hitLines(normalise(crlf(`x\n${text}\ny`)), g4)).toEqual([]);
  });

  it('G-5 catches a known ref, a hosted host and a cookie name, in LF and CRLF', () => {
    const samples = [`const REF = '${knownFixture}'`, `https://${ref20}.supabase.co`, `https://${ref20}.supabase.in/x`, `sb-${ref20}-auth-token.0=`];
    for (const sample of samples) {
      const text = `a\nb\n${sample}`;
      expect(hitLines(normalise(text), g5)).toEqual([3]);
      expect(hitLines(normalise(crlf(text)), g5)).toEqual([3]);
    }
  });

  it('G-5 allows lookalikes that are not a 20-character ref', () => {
    const samples = [
      `https://${'k'.repeat(19)}.supabase.co`,
      `https://${'k'.repeat(21)}.supabase.co`,
      `https://${'K'.repeat(20)}.supabase.co`,
      'https://example.supabase.co',
      'sb-test-auth-token',
      'sb-${ref}-auth-token',
    ];
    for (const sample of samples) expect(hitLines(normalise(sample), g5)).toEqual([]);
  });

  it('every exemption is still needed, and exists (C-8 e)', () => {
    const read = (rel: string): string => normalise(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const rel of G4_EXEMPT) expect(hitLines(read(rel), retiredNamePatterns(RETIRED_NAME)).length).toBeGreaterThan(0);
    for (const rel of G5_EXEMPT) expect(hitLines(read(rel), refPatterns(KNOWN_REFS)).length).toBeGreaterThan(0);
  });

  it('the generated catalog may carry the host on its two provenance lines only (C-8 e)', () => {
    const text = normalise(fs.readFileSync(path.join(ROOT, GENERATED_CATALOG), 'utf8'));
    const lines = text.split('\n');
    const hits = hitLines(text, refPatterns(KNOWN_REFS));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(2);
    for (const line of hits) expect(lines[line - 1]).toMatch(GENERATED_PROVENANCE_LINE);
    // The confinement rejects a ref on any other line.
    expect(isAllowedRefHit({ file: GENERATED_CATALOG, line: 99, text: '  "tables": {}' })).toBe(false);
  });

  it('G-6 exemptions still have their own check, and the secret readers still read it', () => {
    for (const [rel, exemption] of Object.entries(CRON_AUTH_EXEMPT)) {
      expect(exemption.reason.length).toBeGreaterThan(10);
      const text = normalise(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
      for (const pattern of exemption.stillHas) expect({ rel, check: String(pattern), present: pattern.test(text) }).toEqual({ rel, check: String(pattern), present: true });
    }
    for (const rel of CRON_SECRET_READERS) {
      expect({ rel, reads: hitLines(normalise(fs.readFileSync(path.join(ROOT, rel), 'utf8')), readPatterns(CRON_SECRET_NAME)).length > 0 }).toEqual({ rel, reads: true });
    }
    for (const rel of EXTRA_CRON_ENTRY_POINTS) expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
  });

  it('relative paths compare in POSIX form on every platform (C-8 b)', () => {
    expect(toPosix(['lib', 'admin', 'environment', 'catalogue.ts'].join(path.sep))).toBe(CATALOGUE);
    expect(isTestFile('lib/__tests__/x.ts')).toBe(true);
    expect(isTestFile(JEST_SETUP)).toBe(false);
    expect(inG4Scope('.github/workflows/build.yml')).toBe(true);
  });
});

// ── Self-tests for G-6 and G-7: they can fail ──────────────────────────────

describe('G-6 and G-7 matchers (self-tests)', () => {
  const crlf = (text: string): string => text.replace(/\n/g, '\r\n');
  const both = (text: string): string[] => [normalise(text), normalise(crlf(text))];

  it('G-6 R1 accepts the helper imported and used as a guard, in LF and CRLF', () => {
    const good = `import { NextRequest } from 'next/server';\nimport { isAuthorizedCronRequest } from '@/lib/cron/cronAuth';\n\nexport async function GET(request: NextRequest) {\n  if (!isAuthorizedCronRequest(request, logger)) {\n    return x;\n  }\n}`;
    for (const text of both(good)) expect(cronEntryPointProblem(text)).toBeNull();
  });

  it.each([
    ['no import', `function verifyCronSecret() {}\nif (!verifyCronSecret(request)) {}`],
    ['imported, never used as a guard', `import { isAuthorizedCronRequest } from '@/lib/cron/cronAuth';\nisAuthorizedCronRequest(request, logger);`],
    ['imported from elsewhere', `import { isAuthorizedCronRequest } from './local';\nif (!isAuthorizedCronRequest(request, logger)) {}`],
    ['a lookalike name', `import { isAuthorizedCronRequestLegacy } from '@/lib/cron/cronAuth';\nif (!isAuthorizedCronRequestLegacy(request)) {}`],
  ])('G-6 R1 rejects %s', (_label, text) => {
    for (const sample of both(text)) expect(cronEntryPointProblem(sample)).not.toBeNull();
  });

  it('G-6 R2 catches every read form of the secret, on the same line in LF and CRLF', () => {
    const patterns = readPatterns(CRON_SECRET_NAME);
    for (const form of [
      `const s = process.env.${CRON_SECRET_NAME};`,
      `const s = process.env?.${CRON_SECRET_NAME};`,
      `const s = process.env['${CRON_SECRET_NAME}'];`,
      `const {\n  ${CRON_SECRET_NAME},\n} = process.env;`,
    ]) {
      const sample = `// first\n${form}`;
      const lf = hitLines(normalise(sample), patterns);
      expect(lf.length).toBeGreaterThan(0);
      expect(Math.min(...lf)).toBeGreaterThanOrEqual(2);
      expect(hitLines(normalise(crlf(sample)), patterns)).toEqual(lf);
    }
  });

  it('G-6 R2 ignores comments that quote the name, and lookalike names', () => {
    const patterns = readPatterns(CRON_SECRET_NAME);
    for (const text of [
      `// without \`${CRON_SECRET_NAME}\` every call is refused`,
      `const NEXT_${CRON_SECRET_NAME}_HINT = process.env.NEXT_${CRON_SECRET_NAME}_HINT;`,
      `logger.error('${CRON_SECRET_NAME} not configured - refusing cron request (fail-closed)');`,
    ]) {
      expect(hitLines(normalise(text), patterns)).toEqual([]);
    }
  });

  it.each([
    ['nodemailer import', "import nodemailer from 'nodemailer';", EMAIL_PROVIDER_PATTERNS],
    ['resend package', "import { Resend } from 'resend';", EMAIL_PROVIDER_PATTERNS],
    ['sendgrid package', "const sg = require('@sendgrid/mail');", EMAIL_PROVIDER_PATTERNS],
    ['ses package', "import { SESClient } from '@aws-sdk/client-sesv2';", EMAIL_PROVIDER_PATTERNS],
    ['a provider host', "fetch('https://api.brevo.com/v3/smtp/email')", EMAIL_PROVIDER_PATTERNS],
    ['transporter send', 'await transporter.sendMail({ to });', EMAIL_DISPATCH_PATTERNS],
    ['the Resend API', "fetch('https://api.resend.com/emails', init)", EMAIL_DISPATCH_PATTERNS],
    ['Gmail send', 'fetch(`${base}/users/me/messages/send`, {', EMAIL_DISPATCH_PATTERNS],
    ['Gmail draft send', 'fetch(`${base}/users/me/drafts/send`, {', EMAIL_DISPATCH_PATTERNS],
    ['Gmail client library', 'await gmail.users.messages.send({ userId })', EMAIL_DISPATCH_PATTERNS],
    ['Gmail client draft', 'await gmail.users.drafts.send({ userId })', EMAIL_DISPATCH_PATTERNS],
    ['Graph sendMail', "this.makeGraphRequest(connection, '/me/sendMail', 'POST')", EMAIL_DISPATCH_PATTERNS],
    ['Graph replyAll', 'graph(`/me/messages/${id}/replyAll`)', EMAIL_DISPATCH_PATTERNS],
    ['Graph forward', 'graph(`/me/messages/${id}/forward`)', EMAIL_DISPATCH_PATTERNS],
    ['Calendar sendUpdates', "url.searchParams.set('sendUpdates', 'all');", EMAIL_DISPATCH_PATTERNS],
    ['Calendar sendNotifications', "url.searchParams.set('sendNotifications', 'true');", EMAIL_DISPATCH_PATTERNS],
    ['Graph create event', "this.makeGraphRequest(connection, '/me/events', 'POST', event)", EMAIL_DISPATCH_PATTERNS],
    ['Graph event by id', 'graph(`/me/events/${eventId}`, "PATCH")', EMAIL_DISPATCH_PATTERNS],
    ['Graph event cancel', 'graph(`/me/events/${eventId}/cancel`, "POST")', EMAIL_DISPATCH_PATTERNS],
    ['Graph calendar by id', 'graph(`/me/calendars/${calendarId}/events`)', EMAIL_DISPATCH_PATTERNS],
    ['Graph user events', 'graph(`/users/${userId}/events`)', EMAIL_DISPATCH_PATTERNS],
    ['Graph group calendar', 'graph(`/groups/${groupId}/calendar/events`)', EMAIL_DISPATCH_PATTERNS],
    ['Graph draft send', 'graph(`/me/messages/${id}/send`, "POST")', EMAIL_DISPATCH_PATTERNS],
    ['Graph reply', 'graph(`/me/messages/${id}/reply`, "POST")', EMAIL_DISPATCH_PATTERNS],
    ['Graph replyAll, counted once', 'graph(`/me/messages/${id}/replyAll`, "POST")', EMAIL_DISPATCH_PATTERNS],
    ['Supabase password reset', 'await supabase.auth.resetPasswordForEmail(email, {})', EMAIL_AUTH_SENDER_PATTERNS],
    ['Supabase invite', 'await admin.auth.admin.inviteUserByEmail(email)', EMAIL_AUTH_SENDER_PATTERNS],
    ['Supabase OTP', 'await supabase.auth.signInWithOtp({ email })', EMAIL_AUTH_SENDER_PATTERNS],
    ['the recipient check', 'const v = checkOutboundRecipients(recipientsOf(to));', EMAIL_CHECK_PATTERNS],
    ['the guard-on test', 'if (isRecipientGuardOn()) return refused;', EMAIL_CHECK_PATTERNS],
  ])('G-7 counts %s once, in LF and CRLF', (_label, line, patterns) => {
    for (const text of both(`// a\n${line}\n// b`)) expect(countHits(text, patterns)).toBe(1);
  });

  it.each([
    'onResendMail(booking.id, kind);',
    'const sendMailCount = 3;',
    'back/forward cache restores the page',
    'const send_notifications = true;',
    'recheckOutboundRecipients(x)',
    "import { resendLink } from './resend-link';",
    // PROD-1b.2 lookalikes (SA condition 8)
    "import { AUDIT_EVENTS } from '@/lib/audit/events';",
    "await fetch('/api/business-os/gaps/reply', { method: 'POST' });",
    'fetch(`${this.googleApisUrl}/calendar/v3/users/me/calendarList`)',
    'fetch(`${this.googleApisUrl}/calendar/v3/calendars/${calendarId}/events`)',
    'graph(`/me/messages/${encodeURIComponent(replyTo)}/createReply`)',
    'the owner sees upcoming events in the dashboard',
  ])('G-7 ignores the lookalike %p', (line) => {
    for (const text of both(line)) {
      expect(countHits(text, [...EMAIL_PROVIDER_PATTERNS, ...EMAIL_DISPATCH_PATTERNS, ...EMAIL_AUTH_SENDER_PATTERNS, ...EMAIL_CHECK_PATTERNS])).toBe(0);
    }
  });

  it('G-7 every registered site has a reason', () => {
    for (const site of Object.values(EMAIL_SEND_SITES)) expect(site.reason.length).toBeGreaterThan(10);
  });

  it('G-7 no registered site is left PENDING: a deferral is a written decision, not a registry note (PROD-1b.2)', () => {
    for (const [rel, site] of Object.entries(EMAIL_SEND_SITES)) expect(`${rel}: ${site.reason}`).not.toMatch(/PENDING/i);
  });

  it('G-7 the prefilter admits every new PROD-1b.2 form', () => {
    for (const line of ["'/me/events'", '`/users/${id}/events`', '`/groups/${id}/calendar/events`', '`/me/messages/${id}/send`']) {
      expect(EMAIL_PREFILTER.test(line)).toBe(true);
    }
  });
});

// ── Self-tests for G-9: it can fail ────────────────────────────────────────

describe('G-9 matchers (self-tests)', () => {
  const crlf = (text: string): string => text.replace(/\n/g, '\r\n');
  const both = (text: string): string[] => [normalise(text), normalise(crlf(text))];
  const IMPORT = `import { ${ROUTE_GATE} } from '${GATE_MODULE}';\n`;
  const PAGE_IMPORT = `import { ${PAGE_GATE} } from '${GATE_MODULE}';\n`;
  const handler = (name: string, body: string): string => `export async function ${name}(request: NextRequest) {\n${body}\n}\n`;
  const GATE = `  const gate = await ${ROUTE_GATE}(logger.child({ correlationId }));\n  if (gate) return gate;`;

  it('R2 accepts the gate first in every handler, in LF and CRLF, with a logger child and a comment before it', () => {
    const good =
      IMPORT +
      handler('POST', `  const correlationId = request.headers.get('x') || crypto.randomUUID();\n  // first: await nothing else\n${GATE}\n  const body = await request.json();`) +
      handler('OPTIONS', `${GATE.replace(/;/g, '')}\n  return new Response(null);`);
    for (const text of both(good)) expect(testRouteProblem(text)).toBeNull();
  });

  it.each([
    ['no import', handler('POST', GATE)],
    ['imported from elsewhere', `import { ${ROUTE_GATE} } from './local';\n${handler('POST', GATE)}`],
    ['a lookalike name', `import { ${ROUTE_GATE}Legacy } from '${GATE_MODULE}';\n${handler('POST', GATE.replace(ROUTE_GATE, `${ROUTE_GATE}Legacy`))}`],
    ['the gate after the body parse', IMPORT + handler('POST', `  const body = await request.json();\n${GATE}`)],
    ['the gate after a session read', IMPORT + handler('GET', `  const user = await getUser();\n${GATE}`)],
    ['imported, never awaited', IMPORT + handler('POST', `  ${ROUTE_GATE}(logger);\n  return x;`)],
    ['awaited, result ignored', IMPORT + handler('POST', `  await ${ROUTE_GATE}(logger);\n  return x;`)],
    ['a second handler without it', IMPORT + handler('POST', GATE) + handler('GET', '  return new Response(null);')],
    ['a gate only inside a string', IMPORT + handler('POST', `  const s = 'await ${ROUTE_GATE}(l); if (gate) return gate';\n  const b = await request.json();`)],
    ['a gate only inside a comment', IMPORT + handler('POST', `  // await ${ROUTE_GATE}(l); if (gate) return gate\n  const b = await request.json();`)],
    ['a handler the parser cannot attribute', `${IMPORT}export const POST = withAuth(async () => {\n${GATE}\n});\n`],
    ['no handler at all', `${IMPORT}export const x = 1;\n`],
  ])('R2 rejects %s', (_label, text) => {
    for (const sample of both(text)) expect(testRouteProblem(sample)).not.toBeNull();
  });

  it('R1 names the surface by path segment, not by substring', () => {
    for (const segment of ['test', 'debug', 'test-audit', 'execute-test', 'debug_thing', 'TEST', 'zz-debug-probe', 'v5-test-wrapper']) {
      expect(TEST_SEGMENT.test(segment)).toBe(true);
    }
    for (const segment of ['testimonial', 'latest', 'contest', 'debugger', 'enhance-testimonial', 'availability']) {
      expect(TEST_SEGMENT.test(segment)).toBe(false);
    }
  });

  const layout = (body: string): string =>
    `${PAGE_IMPORT}export const dynamic = 'force-dynamic';\nexport default async function L({ children }: { children: ReactNode }) {\n${body}\n  return children;\n}\n`;

  it('R3 accepts a layout that awaits the page gate first, in LF and CRLF', () => {
    for (const text of both(layout(`  // first\n  await ${PAGE_GATE}();\n  await redirectIfAwaitingPayment();`))) {
      expect(awaitsPageGateFirst(text)).toBe(true);
    }
  });

  it.each([
    ['another await first', layout(`  await redirectIfAwaitingPayment();\n  await ${PAGE_GATE}();`)],
    ['a conditional gate', layout(`  if (x) await ${PAGE_GATE}();`)],
    ['the gate not awaited', layout(`  ${PAGE_GATE}();`)],
    ['no import', layout(`  await ${PAGE_GATE}();`).replace(PAGE_IMPORT, '')],
    ['a gate only in a comment', layout(`  // await ${PAGE_GATE}();\n  await other();`)],
  ])('R3 rejects %s', (_label, text) => {
    for (const sample of both(text)) expect(awaitsPageGateFirst(sample)).toBe(false);
  });

  it("R3 render entries: 'use client' passes; a server page fails unless it guards itself first", () => {
    for (const text of both("'use client';\nexport default function Page() { return null; }\n")) expect(testRenderEntryProblem(text)).toBeNull();
    for (const text of both('export default async function Page() {\n  const data = await load();\n  return data;\n}\n')) {
      expect(testRenderEntryProblem(text)).not.toBeNull();
    }
    for (const text of both("/*\n'use client' in prose is not a directive\n*/\nexport default function Page() { return null; }\n")) {
      expect(testRenderEntryProblem(text)).not.toBeNull();
    }
    for (const text of both(layout(`  await ${PAGE_GATE}();`))) expect(testRenderEntryProblem(text)).toBeNull();
  });

  it('R3 render-entry names cover every segment file a layout gate does not protect', () => {
    for (const name of ['page.tsx', 'template.tsx', 'default.tsx', 'loading.tsx', 'error.tsx', 'not-found.tsx']) expect(RENDER_ENTRY.test(name)).toBe(true);
    for (const name of ['layout.tsx', 'route.ts', 'helpers.ts', 'page.module.css']) expect(RENDER_ENTRY.test(name)).toBe(false);
  });
});
