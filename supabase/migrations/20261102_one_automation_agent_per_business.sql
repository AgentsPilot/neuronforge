-- One automation agent per business, enforced where it cannot be raced.
--
-- ---------------------------------------------------------------------------
-- WHAT HAPPENED
--
-- `installAutomation` reads the agents table for an existing install and
-- creates one only if it finds none. That is check-then-act, and it is
-- idempotent only against SEQUENTIAL calls. A browser that fired four requests
-- in ten milliseconds produced four rows:
--
--   18:30:19.226  df8b1b0a   rebook_quiet_clients
--   18:30:19.234  ce43fa61   rebook_quiet_clients
--   18:30:19.235  215f844c   rebook_quiet_clients
--   18:30:19.236  cc577207   rebook_quiet_clients
--
-- All four were live, all four scheduled, all four would have run and written
-- to the same clients — four identical emails from one press. The owner would
-- also have had four rows to stop, with no way to tell which was which.
--
-- ---------------------------------------------------------------------------
-- WHY AN INDEX AND NOT MORE APPLICATION CODE
--
-- No amount of reading-before-writing closes a ten-millisecond window; only the
-- database can. The install still does its lookup, because returning the
-- existing agent is the kind answer, and now a race that beats the lookup hits
-- this and fails loudly instead of quietly duplicating.
--
-- ---------------------------------------------------------------------------
-- WHAT IT KEYS ON
--
-- `agent_config -> business_os_automation ->> 'id'`, which is the automation's
-- catalogue id, written by `installAutomation` and by nothing else. The tag
-- array carries the same fact, but a unique index over an array element is far
-- clumsier to express and to read.
--
-- PARTIAL, on two conditions:
--
--   deleted_at IS NULL     a removed agent must not block a reinstall. Removal
--                          is a soft delete, so the row stays for the audit of
--                          what it did, and the owner may switch it back on.
--
--   the key is present     every other agent on this table — the mailbox
--                          channels, the hand-built ones — has no
--                          `business_os_automation` block, and without this
--                          they would all collide on NULL.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS agents_one_automation_per_user
  ON public.agents (
    user_id,
    ((agent_config -> 'business_os_automation' ->> 'id'))
  )
  WHERE deleted_at IS NULL
    AND agent_config -> 'business_os_automation' ->> 'id' IS NOT NULL;

COMMENT ON INDEX public.agents_one_automation_per_user IS
  'One live automation agent per business per catalogue id. Added after four '
  'identical rows were created ten milliseconds apart by repeated clicks: '
  'installAutomation checks before inserting, which cannot win a race.';
