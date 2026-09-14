-- ============================================================================
-- Proposals — the seam between "interested" and "owes money".
--
-- A quoted service (20260912_service_sale_mode) ends its client journey at a
-- request. This is what the owner sends back, and what the client accepts.
--
-- ONE TOTAL AND A DESCRIPTION. No line items, no cost breakdown. The platform
-- never holds what the carpentry cost — that is the owner's business, and
-- modelling it is the first step toward becoming a project-management tool.
-- A proposal says: this much, for this work, paid like this.
--
-- Deliberately NOT an invoice with a new document type: an unaccepted offer is
-- not payable, and conflating them would put speculative money into the
-- revenue figures the reports page shows.
--
-- Date: 2026-09-13
-- ============================================================================

CREATE TABLE IF NOT EXISTS proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,
  service_id UUID REFERENCES scheduling_services(id) ON DELETE SET NULL,

  -- What they are buying, in prose. Not a table of costs.
  title TEXT NOT NULL,
  description TEXT,

  currency TEXT NOT NULL DEFAULT 'USD',
  total NUMERIC(12,2) NOT NULL CHECK (total >= 0),

  /*
   * Tax COPIED at send time, never referenced live.
   *
   * A business that changes its VAT rate must not retroactively re-price a
   * quote somebody already signed. `business_profiles` holds today's rate;
   * these three hold the rate this document was written under.
   */
  prices_include_tax BOOLEAN NOT NULL DEFAULT true,
  tax_rate NUMERIC(6,3),
  tax_label TEXT,

  /*
   * draft → sent → viewed → accepted | declined | expired | withdrawn | superseded
   *
   * `declined` is NOT terminal. Most rejections are "too expensive", which the
   * owner can answer — so a declined proposal returns the work to them for a
   * revision. `withdrawn` and `superseded` are the terminal ends.
   */
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','viewed','accepted','declined','expired','withdrawn','superseded')),

  valid_until DATE,

  /*
   * How acceptance turns into money:
   *   { kind: 'single' }
   *   { kind: 'installments', count, frequency }
   *   { kind: 'milestones', stages: [{ label, percent }] }
   *
   * JSONB because the three shapes have genuinely different fields, and
   * flattening them into columns would leave most of them null most of the time.
   */
  payment_shape JSONB NOT NULL DEFAULT '{"kind":"single"}'::jsonb,

  -- Why it was declined, so a revision can answer it rather than guess.
  decline_reason TEXT,
  decline_note TEXT,

  -- The version this replaces. History is kept, never overwritten.
  supersedes_id UUID REFERENCES proposals(id) ON DELETE SET NULL,

  /*
   * The terms EXACTLY as accepted.
   *
   * Written at the moment of acceptance so a later edit cannot rewrite what was
   * agreed. This is the record that settles a dispute, not the live columns.
   */
  accepted_snapshot JSONB,

  -- What acceptance produced, so it is never produced twice.
  created_invoice_id UUID REFERENCES payment_invoices(id) ON DELETE SET NULL,
  created_plan_id UUID REFERENCES payment_plans(id) ON DELETE SET NULL,

  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposals_user_status ON proposals(user_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_contact ON proposals(contact_id);
-- The owner's "what is waiting on me" list, and the expiry sweep.
CREATE INDEX IF NOT EXISTS idx_proposals_open
  ON proposals(user_id, valid_until)
  WHERE status IN ('sent','viewed');

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own proposals" ON proposals;
CREATE POLICY "Users manage their own proposals"
  ON proposals FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- The public accept page reads through the service role with a signed token,
-- never through this policy: the client has no session.

-- ----------------------------------------------------------------------------
-- Milestones.
--
-- No new table. `payment_plan_installments` already stores a per-row amount,
-- due date and status — a 30/40/30 split has always been storable. What was
-- missing is a NAME for each stage and the ability to have no date until the
-- owner says the work is done.
-- ----------------------------------------------------------------------------
ALTER TABLE payment_plan_installments
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS trigger TEXT NOT NULL DEFAULT 'date',
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proposal_id UUID REFERENCES proposals(id) ON DELETE SET NULL;

ALTER TABLE payment_plan_installments
  DROP CONSTRAINT IF EXISTS payment_plan_installments_trigger_check;

ALTER TABLE payment_plan_installments
  ADD CONSTRAINT payment_plan_installments_trigger_check
  CHECK (trigger IN ('date', 'manual'));

-- A milestone has no date until it is marked complete. Instalment plans keep
-- theirs, which is why the column becomes nullable rather than the reverse.
ALTER TABLE payment_plan_installments
  ALTER COLUMN due_date DROP NOT NULL;

COMMENT ON COLUMN payment_plan_installments.trigger IS
  'date = bills on its due_date, the existing instalment behaviour and the default so nothing changes. manual = a milestone: no due date until the owner marks the stage complete, which is what raises its invoice.';

COMMENT ON COLUMN payment_plan_installments.label IS
  'The stage this payment is for — "Foundation", "Sessions 1-4". Null for a plain instalment, which is identified by its number.';

CREATE INDEX IF NOT EXISTS idx_installments_manual_open
  ON payment_plan_installments(user_id, payment_plan_id)
  WHERE trigger = 'manual' AND completed_at IS NULL;
