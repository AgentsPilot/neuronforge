/**
 * The mailbox lead channel's provider facts, with NO imports.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE FILE
 *
 * These belong with `inboxChannel.ts` by subject, and cannot live there by
 * dependency: that module imports `supabaseServer`, and the card and the setup
 * dialog are `'use client'`. A TYPE import from it is erased at compile time
 * and harmless, but `PROVIDER_NAMES` is a VALUE — importing it would pull the
 * service-role Supabase client into a browser bundle.
 *
 * So anything a client component needs by value lives here, where there is
 * nothing to pull. `inboxChannel.ts` re-exports all of it, so server code can
 * keep importing from the one module that answers everything about the channel.
 *
 * @module lib/business-os/leads/inboxProviders
 */

/** The mail plugins this channel is built around. */
export type InboxProvider = 'google-mail' | 'outlook';

/**
 * What an owner calls each mailbox. One definition, because it is shown in
 * three places — the setup screens, the card, and the agent's own name — and
 * "Gmail" in two of them and "google-mail" in the third is how a plugin key
 * ends up in front of a customer.
 */
export const PROVIDER_NAMES: Record<InboxProvider, string> = {
  'google-mail': 'Gmail',
  outlook: 'Outlook',
};

/**
 * The mailboxes a channel can actually be built on. Both, and this list is
 * where every surface agrees on that.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS A LIST AND NOT ASSUMED FROM THE TYPE
 *
 * For a while this was Gmail only, because the type and the screens handled
 * both and the AGENT could not. The two mailboxes disagree on three things
 * that the channel depends on, and none of them is cosmetic:
 *
 *   · marking read is `modify_email` / `mark_read` on Gmail and
 *     `modify_message` / `is_read` on Outlook
 *   · Gmail takes one opaque query string; Outlook takes OData filters and
 *     REFUSES a request carrying both a free-text search and a filter
 *   · Outlook returned only a 255-character preview and had no unread filter
 *     at all — and "unread, then marked read" is the channel's entire
 *     idempotency
 *
 * All three are closed now: Outlook's `search_emails` gained `is_unread`,
 * `from_address`, `subject_prefix` and `content_level`, and each provider has
 * its own compiled plan. The list stays because it is the honest place to say
 * what works: a provider offered here that the agent cannot run gives an owner
 * four screens of setup and a channel that silently files nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const SUPPORTED_PROVIDERS: readonly InboxProvider[] = ['google-mail', 'outlook'];

/**
 * How any inbox channel is recognised, whatever mailbox it reads.
 *
 * On `tags`, not in the name: an owner may rename their agents, and a renamed
 * agent that stops being findable would silently become a second channel the
 * next time they ran setup.
 *
 * Every channel carries this AND its provider tag below. This one answers
 * "which agents are inbox channels" — what the cron runs, what the card
 * lists. The provider tag answers "is THIS mailbox already set up".
 */
export const INBOX_CHANNEL_TAG = 'inbox-enquiries';

/**
 * The per-mailbox marker: `inbox-enquiries:google-mail`.
 *
 * This is what makes setup idempotent per CONNECTION rather than per business.
 * Matching on the shared tag alone would find the Gmail channel when an owner
 * set up Outlook, and re-point it at the wrong mailbox — turning a second
 * channel into a silent replacement of the first.
 */
export function inboxChannelTag(provider: InboxProvider): string {
  return `${INBOX_CHANNEL_TAG}:${provider}`;
}

/**
 * Where a channel's own facts live inside `agents.agent_config`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THERE IS NO `agents.config` COLUMN.
 *
 * This wrote to one, on the strength of `CreateAgentInput.config` existing in
 * the repository's types — a legacy field the repository spreads straight into
 * the insert. PostgREST refused the whole write with
 * "Could not find the 'config' column of 'agents' in the schema cache", so
 * every attempt to switch a channel on failed with a 500 at the last step.
 *
 * The real JSONB column is `agent_config`, and it is SHARED: creation metadata
 * and the V6 `ai_context` live there too (WP-48, WP-55). So the channel keeps
 * its facts under its own key and merges rather than replacing, or enabling a
 * channel would wipe an agent's provenance.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const INBOX_CHANNEL_CONFIG_KEY = 'inbox_channel';
