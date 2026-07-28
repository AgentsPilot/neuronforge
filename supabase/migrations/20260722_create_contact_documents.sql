-- Migration: Create contact_documents table
-- Purpose: Store uploaded documents (contracts, intake forms, etc.) for CRM contacts
-- Created: 2026-07-22

-- ============================================================================
-- CONTACT DOCUMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS contact_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,

  -- Document metadata
  name VARCHAR(255) NOT NULL,
  document_type VARCHAR(50) NOT NULL DEFAULT 'other',  -- contract, intake_form, invoice, receipt, id_document, medical, insurance, other
  file_name VARCHAR(255) NOT NULL,
  file_size INTEGER NOT NULL,  -- in bytes
  mime_type VARCHAR(100) NOT NULL,

  -- Storage
  storage_path TEXT NOT NULL,  -- path in Supabase Storage
  storage_bucket VARCHAR(100) NOT NULL DEFAULT 'contact-documents',

  -- Optional metadata
  description TEXT,
  tags TEXT[] DEFAULT '{}',

  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'active',  -- active, archived, deleted

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_contact_documents_user_id ON contact_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_contact_documents_contact_id ON contact_documents(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_documents_type ON contact_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_contact_documents_status ON contact_documents(status);
CREATE INDEX IF NOT EXISTS idx_contact_documents_created_at ON contact_documents(created_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE contact_documents ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can view own contact documents" ON contact_documents;
DROP POLICY IF EXISTS "Users can create own contact documents" ON contact_documents;
DROP POLICY IF EXISTS "Users can update own contact documents" ON contact_documents;
DROP POLICY IF EXISTS "Users can delete own contact documents" ON contact_documents;

-- Create policies
CREATE POLICY "Users can view own contact documents"
  ON contact_documents FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own contact documents"
  ON contact_documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own contact documents"
  ON contact_documents FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own contact documents"
  ON contact_documents FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- TRIGGER: Auto-update updated_at
-- ============================================================================

DROP TRIGGER IF EXISTS update_contact_documents_updated_at ON contact_documents;

CREATE TRIGGER update_contact_documents_updated_at
  BEFORE UPDATE ON contact_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- TRIGGER: Log document upload as CRM activity
-- ============================================================================

CREATE OR REPLACE FUNCTION log_document_activity()
RETURNS TRIGGER AS $$
BEGIN
  -- Log document upload as CRM activity
  -- auto_logged = false because document uploads are user-initiated actions
  IF TG_OP = 'INSERT' THEN
    INSERT INTO crm_activities (
      user_id,
      contact_id,
      activity_type,
      title,
      description,
      source_entity_id,
      auto_logged
    ) VALUES (
      NEW.user_id,
      NEW.contact_id,
      'document_uploaded',
      NEW.name,
      jsonb_build_object('document_type', NEW.document_type, 'file_name', NEW.file_name)::text,
      NEW.id,
      false
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS log_document_activity_trigger ON contact_documents;

CREATE TRIGGER log_document_activity_trigger
  AFTER INSERT ON contact_documents
  FOR EACH ROW
  EXECUTE FUNCTION log_document_activity();

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE contact_documents IS 'Stores uploaded documents for CRM contacts (contracts, intake forms, etc.)';
COMMENT ON COLUMN contact_documents.document_type IS 'Type of document: contract, intake_form, invoice, receipt, id_document, medical, insurance, other';
COMMENT ON COLUMN contact_documents.storage_path IS 'Path to file in Supabase Storage bucket';
COMMENT ON COLUMN contact_documents.status IS 'Document status: active, archived, deleted';
