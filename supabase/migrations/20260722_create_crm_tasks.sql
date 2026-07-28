-- =====================================================
-- CRM Tasks Table
-- Enables task/follow-up management linked to contacts
-- Tasks can be created manually or by AI automation
-- =====================================================

-- Create enum for task priority
DO $$ BEGIN
  CREATE TYPE task_priority AS ENUM ('low', 'medium', 'high', 'urgent');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Create enum for task status
DO $$ BEGIN
  CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =====================================================
-- CRM Tasks Table
-- =====================================================
CREATE TABLE IF NOT EXISTS crm_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,

  -- Task details
  title VARCHAR(255) NOT NULL,
  description TEXT,
  priority task_priority NOT NULL DEFAULT 'medium',
  status task_status NOT NULL DEFAULT 'pending',

  -- Timing
  due_date TIMESTAMPTZ,
  reminder_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Source tracking (manual vs AI-created)
  created_by VARCHAR(50) NOT NULL DEFAULT 'manual', -- 'manual', 'ai_employee', 'automation', etc.
  source_entity_type VARCHAR(50), -- 'booking', 'payment', 'email', etc.
  source_entity_id UUID,

  -- Metadata
  tags TEXT[] DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- Indexes for Performance
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_crm_tasks_user_id ON crm_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_contact_id ON crm_tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_status ON crm_tasks(status);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_due_date ON crm_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_user_status ON crm_tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_user_due ON crm_tasks(user_id, due_date) WHERE status IN ('pending', 'in_progress');

-- =====================================================
-- Row Level Security
-- =====================================================
ALTER TABLE crm_tasks ENABLE ROW LEVEL SECURITY;

-- Users can only see their own tasks
DROP POLICY IF EXISTS "Users can view own tasks" ON crm_tasks;
CREATE POLICY "Users can view own tasks"
  ON crm_tasks FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create tasks for themselves
DROP POLICY IF EXISTS "Users can create own tasks" ON crm_tasks;
CREATE POLICY "Users can create own tasks"
  ON crm_tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own tasks
DROP POLICY IF EXISTS "Users can update own tasks" ON crm_tasks;
CREATE POLICY "Users can update own tasks"
  ON crm_tasks FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own tasks
DROP POLICY IF EXISTS "Users can delete own tasks" ON crm_tasks;
CREATE POLICY "Users can delete own tasks"
  ON crm_tasks FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- Auto-update updated_at trigger
-- =====================================================
CREATE OR REPLACE FUNCTION update_crm_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_crm_tasks_updated_at_trigger ON crm_tasks;
CREATE TRIGGER update_crm_tasks_updated_at_trigger
  BEFORE UPDATE ON crm_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_crm_tasks_updated_at();

-- =====================================================
-- Auto-set completed_at when status changes to completed
-- =====================================================
CREATE OR REPLACE FUNCTION set_task_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    NEW.completed_at = NOW();
  ELSIF NEW.status != 'completed' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_task_completed_at_trigger ON crm_tasks;
CREATE TRIGGER set_task_completed_at_trigger
  BEFORE UPDATE ON crm_tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_task_completed_at();

-- =====================================================
-- Log task completion as CRM activity
-- =====================================================
CREATE OR REPLACE FUNCTION log_task_activity()
RETURNS TRIGGER AS $$
BEGIN
  -- Only log when task is completed and has a contact
  IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.contact_id IS NOT NULL THEN
    INSERT INTO crm_activities (
      user_id,
      contact_id,
      activity_type,
      title,
      description,
      auto_logged,
      source_capability,
      source_entity_id,
      activity_date
    ) VALUES (
      NEW.user_id,
      NEW.contact_id,
      'task_completed',
      'Task Completed: ' || NEW.title,
      NEW.description,
      true,
      CASE
        WHEN NEW.created_by = 'manual' THEN 'crm_manual'
        ELSE NEW.created_by
      END,
      NEW.id,
      NOW()
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS log_task_activity_trigger ON crm_tasks;
CREATE TRIGGER log_task_activity_trigger
  AFTER UPDATE OF status ON crm_tasks
  FOR EACH ROW
  EXECUTE FUNCTION log_task_activity();

-- =====================================================
-- Comments
-- =====================================================
COMMENT ON TABLE crm_tasks IS 'CRM tasks and follow-ups, can be linked to contacts';
COMMENT ON COLUMN crm_tasks.created_by IS 'Source of task creation: manual, ai_employee, automation, booking_reminder, etc.';
COMMENT ON COLUMN crm_tasks.source_entity_type IS 'Type of entity that triggered AI task creation (if applicable)';
COMMENT ON COLUMN crm_tasks.source_entity_id IS 'ID of entity that triggered AI task creation (if applicable)';
