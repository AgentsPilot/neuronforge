-- Scheduling Tables Migration
-- Creates scheduling/booking functionality: services, bookings, availability

-- =====================================================
-- 1. Scheduling Services Table
-- =====================================================
CREATE TABLE IF NOT EXISTS scheduling_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Service details
  service_name TEXT NOT NULL,
  description TEXT,
  duration_minutes INT NOT NULL, -- 30, 50, 60, 90, etc.
  price DECIMAL(10, 2), -- Can be NULL for free consultations

  -- Booking settings
  buffer_minutes INT DEFAULT 15, -- Time between appointments
  max_bookings_per_day INT, -- Optional limit
  advance_booking_days INT DEFAULT 30, -- How far in advance can clients book
  min_notice_hours INT DEFAULT 24, -- Minimum notice required

  -- Availability (day-specific)
  -- Example: { "monday": [{"start": "09:00", "end": "17:00"}], "tuesday": [...] }
  availability JSONB DEFAULT '{}',

  -- Status
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scheduling_services_user_id ON scheduling_services(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_services_active ON scheduling_services(is_active);

-- RLS Policies
ALTER TABLE scheduling_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own services" ON scheduling_services;
CREATE POLICY "Users can view their own services"
  ON scheduling_services FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own services" ON scheduling_services;
CREATE POLICY "Users can insert their own services"
  ON scheduling_services FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own services" ON scheduling_services;
CREATE POLICY "Users can update their own services"
  ON scheduling_services FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own services" ON scheduling_services;
CREATE POLICY "Users can delete their own services"
  ON scheduling_services FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 2. Scheduling Bookings Table
-- =====================================================
CREATE TABLE IF NOT EXISTS scheduling_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES scheduling_services(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL, -- Link to CRM

  -- Client info (stored here for booking widget submissions before contact creation)
  client_first_name TEXT NOT NULL,
  client_last_name TEXT,
  client_email TEXT NOT NULL,
  client_phone TEXT,

  -- Booking details
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  timezone TEXT DEFAULT 'UTC',

  -- Status
  status TEXT NOT NULL DEFAULT 'confirmed', -- 'confirmed', 'cancelled', 'completed', 'no_show'
  cancellation_reason TEXT,

  -- Payment
  payment_status TEXT DEFAULT 'pending', -- 'pending', 'paid', 'refunded'
  payment_id UUID, -- Link to payment_transactions (future capability)

  -- Metadata
  notes TEXT, -- Client notes from booking form
  internal_notes TEXT, -- Private notes (therapist/coach notes)
  booking_source TEXT DEFAULT 'manual', -- 'manual', 'widget', 'campaign'

  -- Reminders sent
  reminder_24hr_sent BOOLEAN DEFAULT false,
  reminder_2hr_sent BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scheduling_bookings_user_id ON scheduling_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_bookings_service_id ON scheduling_bookings(service_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_bookings_contact_id ON scheduling_bookings(contact_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_bookings_start_time ON scheduling_bookings(start_time);
CREATE INDEX IF NOT EXISTS idx_scheduling_bookings_status ON scheduling_bookings(status);
CREATE INDEX IF NOT EXISTS idx_scheduling_bookings_email ON scheduling_bookings(client_email);

-- RLS Policies
ALTER TABLE scheduling_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own bookings" ON scheduling_bookings;
CREATE POLICY "Users can view their own bookings"
  ON scheduling_bookings FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own bookings" ON scheduling_bookings;
CREATE POLICY "Users can insert their own bookings"
  ON scheduling_bookings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own bookings" ON scheduling_bookings;
CREATE POLICY "Users can update their own bookings"
  ON scheduling_bookings FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own bookings" ON scheduling_bookings;
CREATE POLICY "Users can delete their own bookings"
  ON scheduling_bookings FOR DELETE
  USING (auth.uid() = user_id);

-- Public policy for booking widget (clients can create bookings)
-- Note: This will be implemented when we build the booking widget
-- CREATE POLICY "Anyone can create bookings via widget"
--   ON scheduling_bookings FOR INSERT
--   WITH CHECK (true);

-- =====================================================
-- 3. Scheduling Availability Exceptions Table
-- =====================================================
-- For handling holidays, time off, special hours
CREATE TABLE IF NOT EXISTS scheduling_availability_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  exception_type TEXT NOT NULL, -- 'unavailable', 'custom_hours'
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,

  -- For 'custom_hours' type
  custom_hours JSONB, -- { "start": "10:00", "end": "14:00" }

  reason TEXT, -- Optional description

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scheduling_exceptions_user_id ON scheduling_availability_exceptions(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_exceptions_dates ON scheduling_availability_exceptions(start_date, end_date);

-- RLS Policies
ALTER TABLE scheduling_availability_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own exceptions" ON scheduling_availability_exceptions;
CREATE POLICY "Users can view their own exceptions"
  ON scheduling_availability_exceptions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own exceptions" ON scheduling_availability_exceptions;
CREATE POLICY "Users can insert their own exceptions"
  ON scheduling_availability_exceptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own exceptions" ON scheduling_availability_exceptions;
CREATE POLICY "Users can update their own exceptions"
  ON scheduling_availability_exceptions FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own exceptions" ON scheduling_availability_exceptions;
CREATE POLICY "Users can delete their own exceptions"
  ON scheduling_availability_exceptions FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 4. Updated_at Triggers
-- =====================================================
CREATE OR REPLACE FUNCTION update_scheduling_services_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_scheduling_services_updated_at_trigger ON scheduling_services;
CREATE TRIGGER update_scheduling_services_updated_at_trigger
  BEFORE UPDATE ON scheduling_services
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduling_services_updated_at();

CREATE OR REPLACE FUNCTION update_scheduling_bookings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_scheduling_bookings_updated_at_trigger ON scheduling_bookings;
CREATE TRIGGER update_scheduling_bookings_updated_at_trigger
  BEFORE UPDATE ON scheduling_bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduling_bookings_updated_at();

-- =====================================================
-- 5. Trigger: Auto-create CRM contact when booking is created
-- =====================================================
CREATE OR REPLACE FUNCTION create_crm_contact_from_booking()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create contact if one doesn't exist with this email
  IF NOT EXISTS (
    SELECT 1 FROM crm_contacts
    WHERE user_id = NEW.user_id AND email = NEW.client_email
  ) THEN
    INSERT INTO crm_contacts (
      user_id,
      first_name,
      last_name,
      email,
      phone,
      stage,
      source
    ) VALUES (
      NEW.user_id,
      NEW.client_first_name,
      NEW.client_last_name,
      NEW.client_email,
      NEW.client_phone,
      'client', -- Move directly to 'client' stage since they booked
      'booking'
    );
  END IF;

  -- Link booking to contact
  UPDATE scheduling_bookings
  SET contact_id = (
    SELECT id FROM crm_contacts
    WHERE user_id = NEW.user_id AND email = NEW.client_email
    LIMIT 1
  )
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS create_crm_contact_from_booking_trigger ON scheduling_bookings;
CREATE TRIGGER create_crm_contact_from_booking_trigger
  AFTER INSERT ON scheduling_bookings
  FOR EACH ROW
  EXECUTE FUNCTION create_crm_contact_from_booking();

-- =====================================================
-- 6. Trigger: Auto-create CRM activity when booking status changes
-- =====================================================
CREATE OR REPLACE FUNCTION log_booking_activity()
RETURNS TRIGGER AS $$
DECLARE
  activity_title TEXT;
  activity_desc TEXT;
BEGIN
  -- Determine activity based on status
  CASE NEW.status
    WHEN 'confirmed' THEN
      activity_title := 'Booking Confirmed: ' || (SELECT service_name FROM scheduling_services WHERE id = NEW.service_id);
      activity_desc := 'Scheduled for ' || TO_CHAR(NEW.start_time, 'YYYY-MM-DD HH24:MI');
    WHEN 'cancelled' THEN
      activity_title := 'Booking Cancelled';
      activity_desc := COALESCE(NEW.cancellation_reason, 'No reason provided');
    WHEN 'completed' THEN
      activity_title := 'Session Completed';
      activity_desc := (SELECT service_name FROM scheduling_services WHERE id = NEW.service_id);
    WHEN 'no_show' THEN
      activity_title := 'No-Show';
      activity_desc := 'Client did not attend scheduled session';
    ELSE
      RETURN NEW;
  END CASE;

  -- Create activity if contact exists
  IF NEW.contact_id IS NOT NULL THEN
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
      'booking',
      activity_title,
      activity_desc,
      true,
      'scheduling',
      NEW.id,
      NEW.start_time
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS log_booking_activity_trigger ON scheduling_bookings;
CREATE TRIGGER log_booking_activity_trigger
  AFTER INSERT OR UPDATE OF status ON scheduling_bookings
  FOR EACH ROW
  EXECUTE FUNCTION log_booking_activity();
