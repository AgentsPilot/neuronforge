-- Business OS chat — conversation memory
--
-- WHY
--
-- Without this the chat cannot hold a conversation, and clarification becomes a
-- loop. Observed verbatim:
--
--   "מצא איש קשר"        -> "which contact are you looking for?"
--   "אופיר"               -> "what do you want to know about אופיר?"
--   "הצג אותו"            -> "what do you mean by 'show him'?"
--   "פתח את איש הקשר"     -> returned ALL contacts
--
-- Every turn was planned in isolation, so "him" had no referent and the final
-- request carried no filter at all. Asking a clarifying question is only useful
-- if the answer can be combined with what was asked before.
--
-- ONE ROW PER USER. This is a small, rolling context — the last few turns and
-- the last result set — not a transcript. Chat history is not a system of
-- record, and keeping one would mean storing customer data indefinitely for no
-- benefit.
--
-- Deliberately NOT command_sessions: that table holds at most one active session
-- per user and confirmations already use it, so the two would evict each other.

CREATE TABLE IF NOT EXISTS business_chat_conversation (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Rolling window: recent turns (utterance + what was planned) and the last
  -- result set (entity + row ids + labels), capped in application code.
  context JSONB NOT NULL DEFAULT '{}',

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bcc_updated ON business_chat_conversation (updated_at DESC);

ALTER TABLE business_chat_conversation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own conversation" ON business_chat_conversation;
CREATE POLICY "own conversation"
  ON business_chat_conversation FOR SELECT
  USING (user_id = auth.uid());

COMMENT ON TABLE business_chat_conversation IS
  'Rolling per-user chat context (recent turns + last result set) so pronouns and clarification answers resolve. Not a transcript.';
