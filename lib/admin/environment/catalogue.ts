/**
 * The environment variable catalogue: every variable the application reads,
 * with its group, role, sensitivity class and per-environment expectation
 * (admin environment view, EC-1; requirement §3.3, SA rulings OQ-5 and OQ-7).
 *
 * This is the single source of truth for what the Environment admin page knows.
 * It was derived mechanically from the source tree (workplan §1.3): literal
 * `process.env.NAME` reads, reads through a same-file constant, plugin
 * definition placeholders, and the few names a library or this page reads.
 *
 * PURE DATA. The only imports are types. It deliberately does not import the
 * flag readers (OQ-5: `flagDefault` is repeated here and a test checks it
 * against each reader) nor any constant from another module, so loading the
 * catalogue pulls in no dependency graph.
 *
 * Adding a `process.env.NAME` read? Add its entry here in the same PR. The
 * drift guard (`__tests__/catalogueDrift.guard.test.ts`, EC-3) fails the gate
 * when code reads a name this list lacks, or when an entry is read by nothing
 * and has no `consumedBy` marker. Steps: docs/FEATURE_FLAGS.md, "Adding an
 * environment variable".
 *
 * Wording rule for `role`: one plain sentence (or two), no value, no quoted
 * plan name or capability id (SA ruling Q-9).
 *
 * @module lib/admin/environment/catalogue
 */

import type {
  EnvCataloguedGroupId,
  EnvExpectation,
  EnvExpectedIn,
  EnvScope,
} from '@/lib/admin/environment-types';

// ── Entry types ─────────────────────────────────────────────────────────────

/** SA-C2: the closed set of shapes a `config` value may be shown in. */
export type EnvConfigShape = 'url' | 'host' | 'integer' | 'enum' | 'gitSha' | 'region' | 'identifier';

/** Q-1: how the code parses a flag. `strict-true` is an `=== 'true'` reader. */
export type EnvFlagParser = 'lenient' | 'strict-true';

/** OQ-10: how a `personal` value is summarised. */
export type EnvPersonalKind = 'single' | 'list-admin-emails' | 'list-boost-accounts';

/** SA-C13: why an entry may be read by no code in the scanned roots. */
export interface EnvConsumedBy {
  by: 'sdk' | 'platform' | 'environment-page';
  note: string;
}

interface EnvEntryBase {
  name: string;
  group: EnvCataloguedGroupId;
  role: string;
  scope: EnvScope;
  expectedIn: EnvExpectedIn;
  docLink?: string;
  seeAlsoPath?: string;
  consumedBy?: EnvConsumedBy;
}

export type EnvConfigEntry = EnvEntryBase &
  (
    | { sensitivity: 'config'; shape: Exclude<EnvConfigShape, 'enum'> }
    | { sensitivity: 'config'; shape: 'enum'; enumValues: readonly string[] }
  );

export type EnvFlagEntry = EnvEntryBase & {
  sensitivity: 'flag';
  flagParser: EnvFlagParser;
  /** What the reader returns when the variable is unset. */
  flagDefault: boolean;
};

export type EnvPersonalEntry = EnvEntryBase & { sensitivity: 'personal'; personalKind: EnvPersonalKind };

export type EnvSecretEntry = EnvEntryBase & { sensitivity: 'secret' };

export type EnvCatalogueEntry = EnvConfigEntry | EnvFlagEntry | EnvPersonalEntry | EnvSecretEntry;

// ── Groups ──────────────────────────────────────────────────────────────────

export interface EnvGroupInfo {
  id: EnvCataloguedGroupId;
  label: string;
  description: string;
}

/**
 * Page order (requirement §3.4, plus `external` after Plugins & OAuth per SA
 * ruling Q-3). Uncategorised is always last and is not listed here.
 */
export const ENVIRONMENT_GROUPS: readonly EnvGroupInfo[] = [
  { id: 'environment', label: 'Environment & deployment', description: 'Which environment and deployment this is, and the Node mode.' },
  { id: 'database', label: 'Database (Supabase)', description: 'Where the database is and the keys the app uses to reach it.' },
  { id: 'admin', label: 'Admin & sign-in', description: 'Who is an admin, and sign-in options.' },
  { id: 'addresses', label: 'App addresses', description: 'The addresses the app hands out: the platform and public business sites.' },
  { id: 'ai', label: 'AI providers', description: 'Keys and model settings for each AI provider.' },
  { id: 'plugins', label: 'Plugins & OAuth', description: 'Client IDs and secrets for connected-app plugins, and plugin credential encryption.' },
  { id: 'external', label: 'Other external services', description: 'Outside services the app calls that are not connected-app plugins.' },
  { id: 'payments', label: 'Payments (Stripe)', description: 'Platform and Connect keys, webhook secrets, and plan and boost switches.' },
  { id: 'email', label: 'Email', description: 'Transactional email providers, in the order the transport tries them.' },
  { id: 'jobs', label: 'Background jobs & queues', description: 'Scheduled job authentication and the queue service.' },
  { id: 'tokens', label: 'Tokens & data protection', description: 'Secrets that sign links or protect stored data.' },
  { id: 'features', label: 'Feature switches', description: 'Product feature switches not owned by a group above.' },
  { id: 'logging', label: 'Logging & observability', description: 'How much the app logs, and developer diagnostics.' },
  { id: 'testing', label: 'Test & development tools', description: 'Settings for test harnesses; these should not be on production.' },
];

export const ENVIRONMENT_GROUP_ORDER: readonly EnvCataloguedGroupId[] = ENVIRONMENT_GROUPS.map((g) => g.id);

// ── Small pure builders (keep the table below readable) ────────────────────

const LETTER: Record<'R' | 'O' | 'X', EnvExpectation> = { R: 'required', O: 'optional', X: 'forbidden' };

/** `exp('R', 'O', 'O')` = production, preview, local. */
function exp(production: 'R' | 'O' | 'X', preview: 'R' | 'O' | 'X', local: 'R' | 'O' | 'X'): EnvExpectedIn {
  return { production: LETTER[production], preview: LETTER[preview], local: LETTER[local] };
}

const OPTIONAL = exp('O', 'O', 'O');

function scopeOf(name: string): EnvScope {
  return name.startsWith('NEXT_PUBLIC_') ? 'browser-inlined' : 'server';
}

type Extra = Partial<Pick<EnvEntryBase, 'docLink' | 'seeAlsoPath' | 'consumedBy' | 'scope'>>;

function secret(name: string, group: EnvCataloguedGroupId, role: string, expectedIn = OPTIONAL, extra: Extra = {}): EnvSecretEntry {
  return { name, group, role, sensitivity: 'secret', scope: extra.scope ?? scopeOf(name), expectedIn, ...pickExtra(extra) };
}

function config(
  name: string,
  group: EnvCataloguedGroupId,
  role: string,
  shape: Exclude<EnvConfigShape, 'enum'>,
  expectedIn = OPTIONAL,
  extra: Extra = {}
): EnvConfigEntry {
  return { name, group, role, sensitivity: 'config', shape, scope: extra.scope ?? scopeOf(name), expectedIn, ...pickExtra(extra) };
}

function configEnum(
  name: string,
  group: EnvCataloguedGroupId,
  role: string,
  enumValues: readonly string[],
  expectedIn = OPTIONAL,
  extra: Extra = {}
): EnvConfigEntry {
  return {
    name,
    group,
    role,
    sensitivity: 'config',
    shape: 'enum',
    enumValues,
    scope: extra.scope ?? scopeOf(name),
    expectedIn,
    ...pickExtra(extra),
  };
}

function flag(
  name: string,
  group: EnvCataloguedGroupId,
  role: string,
  flagParser: EnvFlagParser,
  flagDefault: boolean,
  expectedIn = OPTIONAL,
  extra: Extra = {}
): EnvFlagEntry {
  return { name, group, role, sensitivity: 'flag', flagParser, flagDefault, scope: extra.scope ?? scopeOf(name), expectedIn, ...pickExtra(extra) };
}

function personal(
  name: string,
  group: EnvCataloguedGroupId,
  role: string,
  personalKind: EnvPersonalKind,
  expectedIn = OPTIONAL,
  extra: Extra = {}
): EnvPersonalEntry {
  return { name, group, role, sensitivity: 'personal', personalKind, scope: extra.scope ?? scopeOf(name), expectedIn, ...pickExtra(extra) };
}

/** Copies only the optional descriptive fields, never `scope` (already set). */
function pickExtra(extra: Extra): Pick<EnvEntryBase, 'docLink' | 'seeAlsoPath' | 'consumedBy'> {
  const out: Pick<EnvEntryBase, 'docLink' | 'seeAlsoPath' | 'consumedBy'> = {};
  if (extra.docLink) out.docLink = extra.docLink;
  if (extra.seeAlsoPath) out.seeAlsoPath = extra.seeAlsoPath;
  if (extra.consumedBy) out.consumedBy = extra.consumedBy;
  return out;
}

const VERCEL_ENVS = ['production', 'preview', 'development'] as const;
const AWS_CAVEAT = 'On Vercel the runtime may set this name itself, so Set does not prove the extraction credential is configured.';
const FLAGS_DOC = 'docs/FEATURE_FLAGS.md';

// ── The catalogue ───────────────────────────────────────────────────────────

export const ENVIRONMENT_CATALOGUE: readonly EnvCatalogueEntry[] = [
  // 1. Environment & deployment
  configEnum('NODE_ENV', 'environment', 'Whether the app runs in development or production mode; decides development-only fallbacks and log verbosity.', ['development', 'production', 'test'], exp('R', 'R', 'R')),
  configEnum('VERCEL_ENV', 'environment', 'Which Vercel environment this deployment belongs to; the source of this page\'s environment label.', VERCEL_ENVS, exp('R', 'R', 'O')),
  configEnum('NEXT_PUBLIC_VERCEL_ENV', 'environment', 'The same environment name, built into the browser bundle so browser code can tell where it runs.', VERCEL_ENVS),
  configEnum('VERCEL', 'environment', 'Set by Vercel on every deployment; tells the code it is running on Vercel.', ['1']),
  config('VERCEL_URL', 'environment', 'This deployment\'s own host; used for preview links and callbacks to this exact deployment.', 'host'),
  config('NEXT_PUBLIC_VERCEL_URL', 'environment', 'This deployment\'s own host, built into the browser bundle.', 'host'),
  config('VERCEL_PROJECT_PRODUCTION_URL', 'environment', 'The project\'s stable production host; a fallback when no app address is configured.', 'host'),
  config('NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL', 'environment', 'The project\'s stable production host, built into the browser bundle.', 'host'),
  config('VERCEL_REGION', 'environment', 'The region serving this request; shown as a deployment fact.', 'region', OPTIONAL, {
    consumedBy: { by: 'environment-page', note: 'Read only by the admin Environment page, as a deployment fact.' },
  }),
  config('VERCEL_GIT_COMMIT_REF', 'environment', 'The git branch this deployment was built from; shown as a deployment fact.', 'identifier', OPTIONAL, {
    consumedBy: { by: 'environment-page', note: 'Read only by the admin Environment page, as a deployment fact.' },
  }),
  config('VERCEL_GIT_COMMIT_SHA', 'environment', 'The git commit this deployment was built from; shown as a deployment fact.', 'gitSha', OPTIONAL, {
    consumedBy: { by: 'environment-page', note: 'Read only by the admin Environment page, as a deployment fact.' },
  }),
  // SA Q4-10 / E4-2: the name matches AUTH, so it is secret-class (Set / Not set only).
  secret('NODE_TLS_REJECT_UNAUTHORIZED', 'environment', 'Tells Node.js whether to verify TLS certificates on outgoing connections; it can switch that check off, so it belongs only on a developer machine.', exp('X', 'X', 'O'), {
    consumedBy: { by: 'platform', note: 'Read by the Node.js runtime itself, not by app code.' },
  }),

  // 2. Database (Supabase)
  config('NEXT_PUBLIC_SUPABASE_URL', 'database', 'Address of the Supabase project; every database, auth and storage call goes here.', 'url', exp('R', 'R', 'R')),
  secret('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'database', 'The browser\'s key to Supabase; what it can reach is limited by row-level security.', exp('R', 'R', 'R')),
  secret('SUPABASE_SERVICE_ROLE_KEY', 'database', 'The server\'s full-access key, which bypasses row-level security; used only by server code that must act across users.', exp('R', 'R', 'R')),
  config('SUPABASE_URL', 'database', 'A server-only setting for the Supabase address, read by older server clients; must name the same project as the public address.', 'url', exp('R', 'R', 'R')),
  config('SUPABASE_MAX_CONCURRENCY', 'database', 'Caps how many database requests one server instance sends at once; unset uses the built-in limit.', 'integer'),
  config('SUPABASE_REQUEST_TIMEOUT_MS', 'database', 'How long a database request may take before it is abandoned, in milliseconds; unset uses the built-in timeout.', 'integer'),

  // 3. Admin & sign-in
  personal('ADMIN_EMAILS', 'admin', 'Addresses granted admin access by configuration, in addition to the admin users table; changing it needs a redeploy.', 'list-admin-emails', OPTIONAL, {
    seeAlsoPath: '/admin/settings',
  }),
  config('NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID', 'admin', 'Google client ID for "Continue with Google" on a signup invite; unset means the button is off.', 'identifier'),
  personal('SYSTEM_ADMIN_USER_ID', 'admin', "The platform's own account; activity recorded against it counts as the platform's, not a customer's.", 'single'),

  // 4. App addresses
  config('NEXT_PUBLIC_APP_URL', 'addresses', 'The platform\'s own address, used in links the app sends out (emails, payment returns, plugin sign-in redirects).', 'url', exp('R', 'R', 'R')),
  config('NEXT_PUBLIC_PUBLIC_SITE_HOST', 'addresses', 'The host under which each business\'s public pages are served as subdomains.', 'host'),
  config('NEXT_PUBLIC_MARKETING_URL', 'addresses', 'Address of the marketing site, used where the app links back to it.', 'url'),

  // 5. AI providers
  secret('OPENAI_API_KEY', 'ai', 'Key for OpenAI models; calls routed to OpenAI fail without it.', exp('R', 'R', 'O')),
  secret('ANTHROPIC_API_KEY', 'ai', 'Key for Anthropic models; calls routed to Anthropic fail without it.', exp('R', 'R', 'O')),
  secret('GROQ_API_KEY', 'ai', 'Key for Groq-hosted models.'),
  secret('KIMI_API_KEY', 'ai', 'Key for Kimi (Moonshot) models.'),
  config('OPENAI_MODEL', 'ai', 'Overrides the model one older orchestration route uses; unset uses that route\'s default.', 'identifier'),
  config('OPENAI_CHAT_MODEL', 'ai', 'Overrides the model the Business OS AI data layer chat uses; unset uses its default.', 'identifier'),

  // 6. Plugins & OAuth
  config('GOOGLE_CLIENT_ID', 'plugins', 'Google OAuth client used by the Google plugins (Gmail, Drive, Calendar, Sheets, Docs and others).', 'identifier'),
  secret('GOOGLE_CLIENT_SECRET', 'plugins', 'Secret for the Google OAuth client the Google plugins use.'),
  config('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'plugins', 'The Google plugin client ID, built into the browser bundle.', 'identifier'),
  config('AIRTABLE_CLIENT_ID', 'plugins', 'OAuth client for the Airtable plugin; the plugin cannot connect without it and its secret.', 'identifier'),
  secret('AIRTABLE_CLIENT_SECRET', 'plugins', 'OAuth secret for the Airtable plugin.'),
  config('DISCORD_CLIENT_ID', 'plugins', 'OAuth client for the Discord plugin; the plugin cannot connect without it and its secret.', 'identifier'),
  secret('DISCORD_CLIENT_SECRET', 'plugins', 'OAuth secret for the Discord plugin.'),
  secret('DROPBOX_APP_KEY', 'plugins', 'OAuth app key for the Dropbox plugin; the plugin cannot connect without it and its secret.'),
  secret('DROPBOX_APP_SECRET', 'plugins', 'OAuth app secret for the Dropbox plugin.'),
  config('HUBSPOT_CLIENT_ID', 'plugins', 'OAuth client for the HubSpot plugin; the plugin cannot connect without it and its secret.', 'identifier'),
  secret('HUBSPOT_CLIENT_SECRET', 'plugins', 'OAuth secret for the HubSpot plugin.'),
  config('LINKEDIN_CLIENT_ID', 'plugins', 'OAuth client for the LinkedIn plugin; the plugin cannot connect without it and its secret.', 'identifier'),
  secret('LINKEDIN_CLIENT_SECRET', 'plugins', 'OAuth secret for the LinkedIn plugin.'),
  config('META_ADS_CLIENT_ID', 'plugins', 'OAuth client for the Meta Ads and Meta Insights plugins.', 'identifier'),
  secret('META_ADS_CLIENT_SECRET', 'plugins', 'OAuth secret for the Meta Ads and Meta Insights plugins.'),
  config('MICROSOFT_CLIENT_ID', 'plugins', 'OAuth client for the Outlook and OneDrive plugins.', 'identifier'),
  secret('MICROSOFT_CLIENT_SECRET', 'plugins', 'OAuth secret for the Outlook and OneDrive plugins.'),
  config('NOTION_CLIENT_ID', 'plugins', 'OAuth client for the Notion plugin; the plugin cannot connect without it and its secret.', 'identifier'),
  secret('NOTION_CLIENT_SECRET', 'plugins', 'OAuth secret for the Notion plugin.'),
  config('SALESFORCE_CLIENT_ID', 'plugins', 'OAuth client for the Salesforce plugin; the plugin cannot connect without it and its secret.', 'identifier'),
  secret('SALESFORCE_CLIENT_SECRET', 'plugins', 'OAuth secret for the Salesforce plugin.'),
  config('SLACK_CLIENT_ID', 'plugins', 'OAuth client for the Slack plugin; the plugin cannot connect without it and its secret.', 'identifier'),
  secret('SLACK_CLIENT_SECRET', 'plugins', 'OAuth secret for the Slack plugin.'),
  config('NEXT_PUBLIC_SLACK_CLIENT_ID', 'plugins', 'Slack client ID read by the older (version 1) Slack plugin code.', 'identifier'),
  config('NGROK_SLACK_REDIRECT_URI', 'plugins', 'A tunnel address for testing the Slack sign-in redirect on a developer machine.', 'url', exp('X', 'X', 'O')),
  config('NEXT_PUBLIC_NGROK_SLACK_REDIRECT_URI', 'plugins', 'The Slack test tunnel address, built into the browser bundle; developer machines only.', 'url', exp('X', 'X', 'O')),
  config('WHATSAPP_CLIENT_ID', 'plugins', 'Meta app client for the WhatsApp Business plugin.', 'identifier'),
  secret('WHATSAPP_CLIENT_SECRET', 'plugins', 'Meta app secret for the WhatsApp Business plugin.'),
  config('WHATSAPP_CONFIG_ID', 'plugins', 'The Meta sign-in configuration the WhatsApp Business plugin connects with.', 'identifier'),
  secret('WHATSAPP_VERIFY_TOKEN', 'plugins', 'Answers Meta\'s check when the WhatsApp webhook is registered.'),
  secret('ENCRYPTION_SECRET', 'plugins', 'Key used to encrypt plugin credentials stored in the database.', exp('R', 'R', 'R')),

  // 6b. Other external services (SA ruling Q-3)
  secret('AWS_ACCESS_KEY_ID', 'external', `Access key for AWS Textract, which extracts text from documents. ${AWS_CAVEAT}`),
  secret('AWS_SECRET_ACCESS_KEY', 'external', `Secret for the AWS Textract access key. ${AWS_CAVEAT}`),
  config('AWS_REGION', 'external', `The AWS region Textract calls go to; unset uses a default region. ${AWS_CAVEAT}`, 'region'),
  secret('GOOGLE_SEARCH_API_KEY', 'external', 'Key for Google web search, used by the research plugin.'),
  config('GOOGLE_SEARCH_ENGINE_ID', 'external', 'The Google search engine the research plugin queries.', 'identifier'),
  secret('NEXT_PUBLIC_GOOGLE_PLACES_API_KEY', 'external', 'Browser key for Google Places address suggestions; unset means no suggestions.'),
  secret('PEXELS_API_KEY', 'external', 'Key for Pexels stock images.'),
  secret('EXCHANGE_RATE_API_KEY', 'external', 'Key for one exchange-rate provider used by the currency service.'),
  secret('FIXER_API_KEY', 'external', 'Key for the Fixer exchange-rate provider used by the currency service.'),

  // 7. Payments (Stripe)
  secret('STRIPE_SECRET_KEY', 'payments', 'The platform\'s Stripe key: plan and boost checkouts, price lookups, Connect calls.', exp('R', 'R', 'O')),
  secret('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'payments', 'Stripe\'s browser key for embedded checkout.', exp('R', 'R', 'O')),
  secret('STRIPE_WEBHOOK_SECRET', 'payments', 'Verifies that platform webhook events really come from Stripe.', exp('R', 'O', 'O')),
  secret('STRIPE_CONNECT_WEBHOOK_SECRET', 'payments', 'Verifies Stripe Connect webhook events for businesses\' connected accounts.'),
  config('STRIPE_CLIENT_ID', 'payments', 'The Stripe Connect platform client used when a business connects its Stripe account.', 'identifier'),
  config('NEXT_PUBLIC_STRIPE_CLIENT_ID', 'payments', 'A Stripe Connect client ID read by the Stripe plugin definition.', 'identifier'),
  flag('BUSINESS_OS_PLAN_PRICES_ENABLED', 'payments', 'Lets the webhook recognise Business OS plan prices; off means every plan invoice is treated as unknown.', 'lenient', false, OPTIONAL, { docLink: FLAGS_DOC }),
  flag('BUSINESS_OS_PLAN_CHECKOUT_ENABLED', 'payments', 'Opens the Business OS plan checkout; needs plan price recognition on.', 'lenient', false, OPTIONAL, { docLink: FLAGS_DOC }),
  config('STRIPE_BOS_PORTAL_CONFIGURATION_ID', 'payments', 'The Stripe customer portal configuration (card and invoices only) that Settings → Plan opens; unset means Update card is not offered. Created by scripts/setup-bos-portal-configuration.ts.', 'identifier'),
  flag('BUSINESS_OS_CREDITS_BOOST_ENABLED', 'payments', 'Lets owners buy a credits boost.', 'lenient', false, OPTIONAL, { docLink: FLAGS_DOC }),
  personal('BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS', 'payments', 'Optional list of accounts allowed to buy a boost; unset means every account when the boost switch is on. Only valid account ids count, as the checkout counts them; a list that holds none closes the boost to every account.', 'list-boost-accounts'),
  config('INVOICE_BARE_URL_GRACE_DAYS', 'payments', 'How many days an invoice link without a signed token keeps working; 0 requires a signed link for every invoice, unset uses the token lifetime.', 'integer'),

  // 8. Email
  secret('RESEND_API_KEY', 'email', 'Key for Resend, the first email provider the transport tries.'),
  personal('RESEND_FROM_EMAIL', 'email', 'The sender address for email sent through Resend; unset uses the built-in sender.', 'single'),
  secret('RESEND_WEBHOOK_SECRET', 'email', 'Verifies that email delivery events really come from Resend.'),
  config('SMTP_HOST', 'email', 'SMTP server, the second email provider tried.', 'host'),
  config('SMTP_PORT', 'email', 'Port of the SMTP server.', 'integer'),
  flag('SMTP_SECURE', 'email', 'Forces an encrypted SMTP connection; port 465 is always encrypted whatever this says.', 'strict-true', false),
  personal('SMTP_USER', 'email', 'SMTP login name, often an address.', 'single'),
  secret('SMTP_PASS', 'email', 'SMTP password.'),
  personal('SMTP_FROM', 'email', 'Sender address for SMTP email; unset uses the SMTP login name.', 'single'),
  config('SMTP_FROM_NAME', 'email', 'Sender display name for SMTP email; a name containing a space is not shown here.', 'identifier'),
  personal('GMAIL_USER', 'email', 'Gmail account for the third email provider (Gmail OAuth).', 'single'),
  config('GMAIL_CLIENT_ID', 'email', 'OAuth client for the Gmail email provider.', 'identifier'),
  secret('GMAIL_CLIENT_SECRET', 'email', 'OAuth secret for the Gmail email provider.'),
  secret('GMAIL_REFRESH_TOKEN', 'email', 'Long-lived sign-in for the Gmail email provider.'),

  // 9. Background jobs & queues
  secret('CRON_SECRET', 'jobs', 'Shared secret scheduled jobs must present; protects the cron endpoints from outside callers.', exp('R', 'O', 'O')),
  secret('QSTASH_TOKEN', 'jobs', 'Key for Upstash QStash, the queue that runs agent executions.'),
  config('QSTASH_URL', 'jobs', 'Address of the QStash service; without it agent runs are not queued.', 'url'),
  secret('QSTASH_CURRENT_SIGNING_KEY', 'jobs', 'Verifies that queue callbacks really come from QStash.', OPTIONAL, {
    consumedBy: { by: 'sdk', note: 'Read by the QStash library\'s signature check, not by app code.' },
  }),
  secret('QSTASH_NEXT_SIGNING_KEY', 'jobs', 'The next QStash signing key, accepted during key rotation.', OPTIONAL, {
    consumedBy: { by: 'sdk', note: 'Read by the QStash library\'s signature check, not by app code.' },
  }),
  secret('SENTINEL_WEBHOOK_SECRET', 'jobs', 'Authenticates calls to the webhook that starts an agent run.'),

  // 10. Tokens & data protection
  secret('BOOKING_TOKEN_SECRET', 'tokens', 'Signs the links in client emails (booking management, quotes, invoices, portal); when unset the code falls back to the older shared signing secret.', exp('R', 'R', 'O')),
  secret('CONSENT_TOKEN_SECRET', 'tokens', 'Signs consent confirmation links; when unset the code falls back to the older shared signing secret.'),
  secret('NEXTAUTH_SECRET', 'tokens', 'An older shared signing secret, used only when a link-signing secret above is not set.'),
  secret('IP_HASH_SALT', 'tokens', 'Salt for hashing visitor IP addresses, so analytics never stores a raw IP.'),
  secret('DELETION_RECEIPT_FINGERPRINT_KEY', 'tokens', 'Keys the email fingerprint stored in deletion receipts; without it admin deletions are refused.'),

  // 11. Feature switches
  flag('NEXT_PUBLIC_USE_V6_AGENT_GENERATION', 'features', 'Uses the V6 agent generation pipeline in agent creation.', 'lenient', false, OPTIONAL, { docLink: FLAGS_DOC }),
  flag('NEXT_PUBLIC_USE_V6_REVIEW_MODE', 'features', 'With V6 on, shows the review step before compiling; on unless set otherwise.', 'lenient', true, OPTIONAL, { docLink: FLAGS_DOC }),
  flag('NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION', 'features', 'Offers calibration right after an agent is created.', 'lenient', false, OPTIONAL, { docLink: FLAGS_DOC }),
  flag('NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION', 'features', 'Legacy agent-creation route only: the thread-based flow.', 'lenient', false, OPTIONAL, { docLink: FLAGS_DOC }),
  flag('NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI', 'features', 'Legacy agent-creation route only: the newer builder UI.', 'lenient', false, OPTIONAL, { docLink: FLAGS_DOC }),
  flag('NEXT_PUBLIC_USE_AI_DATA_LAYER', 'features', 'Business OS chat uses the AI data layer with tool calling. One chat route reads this switch strictly, so there only the exact word true turns it on.', 'lenient', false, OPTIONAL, { docLink: FLAGS_DOC }),
  flag('CALIBRATION_AUTO_RCA_ENABLED', 'features', 'Adds an AI root-cause analysis to failed-calibration admin alerts; only the exact word true turns it on.', 'strict-true', false, OPTIONAL, { docLink: FLAGS_DOC }),
  flag('NEXT_PUBLIC_ENABLE_BUSINESS_DELETE', 'features', 'Draws the customer "delete my business" surface; the server makes its own check.', 'lenient', false, OPTIONAL, { docLink: FLAGS_DOC }),
  flag('NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY', 'features', 'Shows the owner\'s Credit history on the Credits card.', 'lenient', false, OPTIONAL, { docLink: FLAGS_DOC }),
  flag('ADMIN_BUSINESS_DELETE_ENABLED', 'features', 'Lets an admin delete a business from Businesses.', 'lenient', false, OPTIONAL, { docLink: FLAGS_DOC }),
  flag('BUSINESS_OS_ACCOUNT_SELF_DELETE_ENABLED', 'features', 'Lets an owner delete their own Business OS account; only the exact word true turns it on.', 'strict-true', false),
  configEnum('BOS_ENTITLEMENTS_MODE', 'features', 'How Business OS plan limits are applied: off, shadow (measured, not enforced) or enforce. A launch check can downgrade enforce to shadow, so this shows what was asked for.', ['off', 'shadow', 'enforce']),
  flag('V6_SEMANTIC_SKELETON_ENABLED', 'features', 'V6 pipeline: builds a semantic skeleton before formalising; only the exact word true turns it on.', 'strict-true', false),
  flag('V6_VALIDATION_DRIVEN_ENABLED', 'features', 'V6 pipeline: validation-driven formalising; only the exact word true turns it on.', 'strict-true', false),
  config('HARD_REQS_FORMAT', 'features', 'V6 pipeline: the format hard requirements are written in for the model; unset uses the default format.', 'identifier'),
  config('SEMANTIC_PLAN_PROMPT_VERSION', 'features', 'V6 pipeline: which semantic plan prompt version is used; unset uses the default.', 'identifier'),
  config('V6_VERSION', 'features', 'A version label recorded with calibration metrics.', 'identifier'),

  // 12. Logging & observability
  configEnum('LOG_LEVEL', 'logging', 'Minimum log level written; when unset, debug in development and info otherwise.', ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']),
  flag('DEBUG_IR_FORMALIZER', 'logging', 'Writes extra V6 formaliser diagnostics to the log; only the exact word true turns it on.', 'strict-true', false),
  personal('BIZQL_DUMP_PROMPT', 'logging', 'A local file path the Business OS chat planner writes its prompt to, for debugging; developer machines only.', 'single', exp('X', 'X', 'O')),

  // 13. Test & development tools
  flag('BUSINESS_OS_TEST_CREDIT_TOOLS_ENABLED', 'testing', 'Enables the Test credits tab on the test harness; developer machines only.', 'lenient', false, exp('X', 'X', 'O'), { docLink: FLAGS_DOC }),
  flag('BUSINESS_OS_UPGRADE_MODAL_DEMO_ENABLED', 'testing', 'Enables the upgrade window demo for testing; must not be on in production.', 'lenient', false, exp('X', 'O', 'O')),
  flag('NEXT_PUBLIC_ALLOW_EARLY_SESSION_OUTCOME', 'testing', 'Temporary: lets a package session be marked held before its hour, for testing; must not be on in production.', 'lenient', false, exp('X', 'O', 'O'), { docLink: FLAGS_DOC }),
  secret('TEST_CLEANUP_SECRET', 'testing', 'Unlocks the test-account cleanup tool; production only, never preview.', exp('O', 'X', 'O')),
  personal('NEXT_PUBLIC_TEST_PAGE_USER_ID', 'testing', 'The user the plugin test page acts as by default; developer machines only.', 'single', exp('X', 'X', 'O')),
];
