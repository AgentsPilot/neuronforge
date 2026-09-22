CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id UUID PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

CREATE TABLE crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT, last_name TEXT, email TEXT,
  stage TEXT NOT NULL DEFAULT 'lead',
  source TEXT,
  source_metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE email_unsubscribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  email TEXT NOT NULL, reason TEXT,
  unsubscribed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, email)
);

INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-000000000001');

-- A subscriber that exists as a contact today, exactly as production has one.
INSERT INTO crm_contacts (id, user_id, email, stage, source, source_metadata, created_at)
VALUES ('cccccccc-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
        'offir.omer@windpoint.io','subscriber','newsletter','{"utm_source":"instagram"}'::jsonb,
        '2026-09-18T19:50:54Z');
