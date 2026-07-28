-- Capability Building Blocks System
-- Each capability has optional building blocks (features) that can be activated based on user's profile

-- =====================================================
-- 1. Capability Definitions Table
-- =====================================================
CREATE TABLE IF NOT EXISTS capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_key TEXT NOT NULL UNIQUE, -- 'crm', 'scheduling', 'payments', etc.

  -- Display info (multilingual)
  name_en TEXT NOT NULL,
  name_es TEXT NOT NULL,
  name_he TEXT NOT NULL,

  description_en TEXT,
  description_es TEXT,
  description_he TEXT,

  -- Categorization
  category TEXT NOT NULL, -- 'system' or 'ai_assistant'
  icon TEXT NOT NULL, -- Icon name for UI
  color TEXT, -- Hex color

  -- Availability
  verticals TEXT[] DEFAULT '{}', -- Which verticals can use this (empty = all)
  is_core BOOLEAN DEFAULT false, -- Core capabilities shown to everyone

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_capabilities_key ON capabilities(capability_key);
CREATE INDEX IF NOT EXISTS idx_capabilities_category ON capabilities(category);

-- =====================================================
-- 2. Capability Building Blocks Table
-- =====================================================
-- Each capability has modular building blocks (features)
CREATE TABLE IF NOT EXISTS capability_building_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capability_id UUID NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,

  block_key TEXT NOT NULL, -- 'contact_import', 'pipeline_stages', 'activity_log', etc.

  -- Display info (multilingual)
  name_en TEXT NOT NULL,
  name_es TEXT NOT NULL,
  name_he TEXT NOT NULL,

  description_en TEXT,
  description_es TEXT,
  description_he TEXT,

  -- Configuration
  is_core BOOLEAN DEFAULT false, -- Core blocks always activated
  is_recommended BOOLEAN DEFAULT true, -- Recommended by default

  -- Activation conditions (JSONB)
  -- Example: { "verticals": ["therapist"], "pain_points": ["manual_scheduling"], "min_clients_per_week": 10 }
  activation_conditions JSONB DEFAULT '{}',

  -- What this block provides (technical)
  provides JSONB DEFAULT '{}', -- { "tables": ["crm_custom_fields"], "endpoints": ["/api/crm/fields"], "ui": ["field_editor"] }

  -- Dependencies
  depends_on_blocks UUID[], -- Other blocks this depends on

  position INT DEFAULT 0, -- Display order

  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(capability_id, block_key)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_building_blocks_capability ON capability_building_blocks(capability_id);
CREATE INDEX IF NOT EXISTS idx_building_blocks_core ON capability_building_blocks(is_core);
CREATE INDEX IF NOT EXISTS idx_building_blocks_recommended ON capability_building_blocks(is_recommended);

-- =====================================================
-- 3. User Activated Capabilities Table
-- =====================================================
CREATE TABLE IF NOT EXISTS user_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capability_id UUID NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,

  -- Activation
  activated_at TIMESTAMPTZ DEFAULT now(),
  activation_source TEXT DEFAULT 'onboarding', -- 'onboarding', 'manual', 'auto_suggested'

  -- Configuration (capability-specific settings)
  configuration JSONB DEFAULT '{}',

  -- Status
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, capability_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_capabilities_user_id ON user_capabilities(user_id);
CREATE INDEX IF NOT EXISTS idx_user_capabilities_capability_id ON user_capabilities(capability_id);
CREATE INDEX IF NOT EXISTS idx_user_capabilities_active ON user_capabilities(is_active);

-- RLS Policies
ALTER TABLE user_capabilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own capabilities" ON user_capabilities;
CREATE POLICY "Users can view their own capabilities"
  ON user_capabilities FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own capabilities" ON user_capabilities;
CREATE POLICY "Users can insert their own capabilities"
  ON user_capabilities FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own capabilities" ON user_capabilities;
CREATE POLICY "Users can update their own capabilities"
  ON user_capabilities FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own capabilities" ON user_capabilities;
CREATE POLICY "Users can delete their own capabilities"
  ON user_capabilities FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 4. User Activated Building Blocks Table
-- =====================================================
CREATE TABLE IF NOT EXISTS user_capability_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_capability_id UUID NOT NULL REFERENCES user_capabilities(id) ON DELETE CASCADE,
  building_block_id UUID NOT NULL REFERENCES capability_building_blocks(id) ON DELETE CASCADE,

  -- Activation
  activated_at TIMESTAMPTZ DEFAULT now(),
  activation_reason TEXT, -- Why this was activated (auto vs manual)

  -- Block-specific configuration
  configuration JSONB DEFAULT '{}',

  -- Status
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_capability_id, building_block_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_blocks_user_capability ON user_capability_blocks(user_capability_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_building_block ON user_capability_blocks(building_block_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_active ON user_capability_blocks(is_active);

-- RLS Policies
ALTER TABLE user_capability_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own capability blocks" ON user_capability_blocks;
CREATE POLICY "Users can view their own capability blocks"
  ON user_capability_blocks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_capabilities uc
      WHERE uc.id = user_capability_blocks.user_capability_id
      AND uc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert their own capability blocks" ON user_capability_blocks;
CREATE POLICY "Users can insert their own capability blocks"
  ON user_capability_blocks FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_capabilities uc
      WHERE uc.id = user_capability_blocks.user_capability_id
      AND uc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update their own capability blocks" ON user_capability_blocks;
CREATE POLICY "Users can update their own capability blocks"
  ON user_capability_blocks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_capabilities uc
      WHERE uc.id = user_capability_blocks.user_capability_id
      AND uc.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete their own capability blocks" ON user_capability_blocks;
CREATE POLICY "Users can delete their own capability blocks"
  ON user_capability_blocks FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_capabilities uc
      WHERE uc.id = user_capability_blocks.user_capability_id
      AND uc.user_id = auth.uid()
    )
  );

-- =====================================================
-- 5. Seed Core Capabilities
-- =====================================================

-- CRM Capability
INSERT INTO capabilities (capability_key, name_en, name_es, name_he, description_en, description_es, description_he, category, icon, color, is_core)
VALUES (
  'crm',
  'Client Management',
  'Gestión de Clientes',
  'ניהול לקוחות',
  'Keep track of all your clients in one place',
  'Mantén un registro de todos tus clientes en un solo lugar',
  'עקוב אחרי כל הלקוחות שלך במקום אחד',
  'system',
  'Users',
  '#60A5FA',
  true
) ON CONFLICT (capability_key) DO NOTHING;

-- Scheduling Capability
INSERT INTO capabilities (capability_key, name_en, name_es, name_he, description_en, description_es, description_he, category, icon, color, is_core)
VALUES (
  'scheduling',
  'Booking Calendar',
  'Calendario de Reservas',
  'יומן הזמנות',
  'Let clients book time with you automatically',
  'Permite que los clientes reserven tiempo contigo automáticamente',
  'תן ללקוחות לקבוע פגישות אוטומטית',
  'system',
  'Calendar',
  '#10B981',
  true
) ON CONFLICT (capability_key) DO NOTHING;

-- Payments Capability
INSERT INTO capabilities (capability_key, name_en, name_es, name_he, description_en, description_es, description_he, category, icon, color, is_core)
VALUES (
  'payments',
  'Get Paid',
  'Recibe Pagos',
  'קבל תשלומים',
  'Accept credit cards and send invoices automatically',
  'Acepta tarjetas de crédito y envía facturas automáticamente',
  'קבל כרטיסי אשראי ושלח חשבוניות אוטומטית',
  'system',
  'CreditCard',
  '#F59E0B',
  true
) ON CONFLICT (capability_key) DO NOTHING;

-- Email Automation Capability
INSERT INTO capabilities (capability_key, name_en, name_es, name_he, description_en, description_es, description_he, category, icon, color, is_core)
VALUES (
  'email_automation',
  'Email Automation',
  'Automatización de Emails',
  'אוטומציה לאימיילים',
  'Send follow-ups and reminders automatically',
  'Envía seguimientos y recordatorios automáticamente',
  'שלח מעקבים ותזכורות אוטומטית',
  'system',
  'Mail',
  '#8B5CF6',
  true
) ON CONFLICT (capability_key) DO NOTHING;

-- =====================================================
-- 6. Seed CRM Building Blocks
-- =====================================================

-- Get CRM capability ID (for foreign key references below)
DO $$
DECLARE
  crm_capability_id UUID;
BEGIN
  SELECT id INTO crm_capability_id FROM capabilities WHERE capability_key = 'crm';

  -- Contact Database (core block)
  INSERT INTO capability_building_blocks (
    capability_id, block_key,
    name_en, name_es, name_he,
    description_en, description_es, description_he,
    is_core, is_recommended
  ) VALUES (
    crm_capability_id, 'contact_database',
    'Contact Database', 'Base de Datos de Contactos', 'מאגר אנשי קשר',
    'Store client names, emails, and phone numbers', 'Almacena nombres, emails y teléfonos de clientes', 'שמור שמות, אימיילים וטלפונים של לקוחות',
    true, true
  ) ON CONFLICT (capability_id, block_key) DO NOTHING;

  -- Pipeline Stages
  INSERT INTO capability_building_blocks (
    capability_id, block_key,
    name_en, name_es, name_he,
    description_en, description_es, description_he,
    is_core, is_recommended,
    activation_conditions
  ) VALUES (
    crm_capability_id, 'pipeline_stages',
    'Pipeline Stages', 'Etapas de Pipeline', 'שלבי צינור מכירות',
    'Track where each client is in your process (Lead → Client → Past Client)',
    'Rastrea dónde está cada cliente en tu proceso (Lead → Cliente → Cliente Pasado)',
    'עקוב אחרי איפה כל לקוח בתהליך שלך (ליד → לקוח → לקוח לשעבר)',
    false, true,
    '{"min_clients_per_week": 5}'::jsonb
  ) ON CONFLICT (capability_id, block_key) DO NOTHING;

  -- Activity Log
  INSERT INTO capability_building_blocks (
    capability_id, block_key,
    name_en, name_es, name_he,
    description_en, description_es, description_he,
    is_core, is_recommended
  ) VALUES (
    crm_capability_id, 'activity_log',
    'Activity Log', 'Registro de Actividades', 'יומן פעילות',
    'Automatic log of all interactions (calls, emails, appointments)',
    'Registro automático de todas las interacciones (llamadas, emails, citas)',
    'תיעוד אוטומטי של כל האינטראקציות (שיחות, אימיילים, פגישות)',
    false, true
  ) ON CONFLICT (capability_id, block_key) DO NOTHING;

  -- Tags & Segments
  INSERT INTO capability_building_blocks (
    capability_id, block_key,
    name_en, name_es, name_he,
    description_en, description_es, description_he,
    is_core, is_recommended,
    activation_conditions
  ) VALUES (
    crm_capability_id, 'tags_segments',
    'Tags & Segments', 'Etiquetas y Segmentos', 'תגיות וקבוצות',
    'Organize clients with tags (e.g., "ADHD Course", "VIP Client")',
    'Organiza clientes con etiquetas (ej. "Curso ADHD", "Cliente VIP")',
    'ארגן לקוחות עם תגיות (למשל "קורס ADHD", "לקוח VIP")',
    false, true,
    '{"min_clients_per_week": 10}'::jsonb
  ) ON CONFLICT (capability_id, block_key) DO NOTHING;

  -- Custom Fields (vertical-specific)
  INSERT INTO capability_building_blocks (
    capability_id, block_key,
    name_en, name_es, name_he,
    description_en, description_es, description_he,
    is_core, is_recommended,
    activation_conditions
  ) VALUES (
    crm_capability_id, 'custom_fields',
    'Custom Fields', 'Campos Personalizados', 'שדות מותאמים אישית',
    'Add fields specific to your business (Insurance, Diagnosis, Package Type, etc.)',
    'Añade campos específicos de tu negocio (Seguro, Diagnóstico, Tipo de Paquete, etc.)',
    'הוסף שדות ספציפיים לעסק שלך (ביטוח, אבחנה, סוג חבילה וכו)',
    false, true,
    '{"verticals": ["therapist", "coach", "consultant"]}'::jsonb
  ) ON CONFLICT (capability_id, block_key) DO NOTHING;

  -- Contact Import
  INSERT INTO capability_building_blocks (
    capability_id, block_key,
    name_en, name_es, name_he,
    description_en, description_es, description_he,
    is_core, is_recommended,
    activation_conditions
  ) VALUES (
    crm_capability_id, 'contact_import',
    'Contact Import', 'Importación de Contactos', 'ייבוא אנשי קשר',
    'Import existing clients from CSV or spreadsheet',
    'Importa clientes existentes desde CSV o hoja de cálculo',
    'ייבא לקוחות קיימים מקובץ CSV או גיליון אלקטרוני',
    false, false, -- Not recommended by default, only if they have existing clients
    '{"min_clients_per_week": 15}'::jsonb
  ) ON CONFLICT (capability_id, block_key) DO NOTHING;

END $$;

-- =====================================================
-- 7. Seed Scheduling Building Blocks
-- =====================================================

DO $$
DECLARE
  scheduling_capability_id UUID;
BEGIN
  SELECT id INTO scheduling_capability_id FROM capabilities WHERE capability_key = 'scheduling';

  -- Service Menu (core)
  INSERT INTO capability_building_blocks (
    capability_id, block_key,
    name_en, name_es, name_he,
    description_en, description_es, description_he,
    is_core, is_recommended
  ) VALUES (
    scheduling_capability_id, 'service_menu',
    'Service Menu', 'Menú de Servicios', 'תפריט שירותים',
    'Define your appointment types (duration, price)',
    'Define tus tipos de citas (duración, precio)',
    'הגדר את סוגי הפגישות שלך (משך, מחיר)',
    true, true
  ) ON CONFLICT (capability_id, block_key) DO NOTHING;

  -- Availability Calendar (core)
  INSERT INTO capability_building_blocks (
    capability_id, block_key,
    name_en, name_es, name_he,
    description_en, description_es, description_he,
    is_core, is_recommended
  ) VALUES (
    scheduling_capability_id, 'availability_calendar',
    'Availability Calendar', 'Calendario de Disponibilidad', 'לוח זמינות',
    'Set your working hours and availability',
    'Establece tus horarios de trabajo y disponibilidad',
    'הגדר את שעות העבודה והזמינות שלך',
    true, true
  ) ON CONFLICT (capability_id, block_key) DO NOTHING;

  -- Booking Widget
  INSERT INTO capability_building_blocks (
    capability_id, block_key,
    name_en, name_es, name_he,
    description_en, description_es, description_he,
    is_core, is_recommended
  ) VALUES (
    scheduling_capability_id, 'booking_widget',
    'Booking Widget', 'Widget de Reservas', 'וידג''ט הזמנות',
    'Let clients book directly on your website',
    'Permite que los clientes reserven directamente en tu sitio web',
    'תן ללקוחות להזמין ישירות באתר שלך',
    false, true
  ) ON CONFLICT (capability_id, block_key) DO NOTHING;

  -- Google Calendar Sync
  INSERT INTO capability_building_blocks (
    capability_id, block_key,
    name_en, name_es, name_he,
    description_en, description_es, description_he,
    is_core, is_recommended,
    activation_conditions
  ) VALUES (
    scheduling_capability_id, 'google_calendar_sync',
    'Google Calendar Sync', 'Sincronización con Google Calendar', 'סנכרון עם Google Calendar',
    'Two-way sync with your Google Calendar',
    'Sincronización bidireccional con tu Google Calendar',
    'סנכרון דו-כיווני עם Google Calendar שלך',
    false, true,
    '{"tools": ["google_calendar"]}'::jsonb
  ) ON CONFLICT (capability_id, block_key) DO NOTHING;

  -- Automated Reminders
  INSERT INTO capability_building_blocks (
    capability_id, block_key,
    name_en, name_es, name_he,
    description_en, description_es, description_he,
    is_core, is_recommended
  ) VALUES (
    scheduling_capability_id, 'automated_reminders',
    'Automated Reminders', 'Recordatorios Automáticos', 'תזכורות אוטומטיות',
    'Send email/SMS reminders 24 hours and 2 hours before appointments',
    'Envía recordatorios por email/SMS 24 horas y 2 horas antes de las citas',
    'שלח תזכורות באימייל/SMS 24 שעות ו-2 שעות לפני הפגישות',
    false, true
  ) ON CONFLICT (capability_id, block_key) DO NOTHING;

  -- Waitlist Management
  INSERT INTO capability_building_blocks (
    capability_id, block_key,
    name_en, name_es, name_he,
    description_en, description_es, description_he,
    is_core, is_recommended,
    activation_conditions
  ) VALUES (
    scheduling_capability_id, 'waitlist',
    'Waitlist Management', 'Gestión de Lista de Espera', 'ניהול רשימת המתנה',
    'Fill cancellations automatically with waitlisted clients',
    'Llena cancelaciones automáticamente con clientes en espera',
    'מלא ביטולים אוטומטית עם לקוחות מרשימת ההמתנה',
    false, false,
    '{"min_clients_per_week": 20, "pain_points": ["no_shows"]}'::jsonb
  ) ON CONFLICT (capability_id, block_key) DO NOTHING;

END $$;

-- =====================================================
-- 8. Updated_at Trigger
-- =====================================================
CREATE OR REPLACE FUNCTION update_user_capabilities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_capabilities_updated_at_trigger ON user_capabilities;
CREATE TRIGGER update_user_capabilities_updated_at_trigger
  BEFORE UPDATE ON user_capabilities
  FOR EACH ROW
  EXECUTE FUNCTION update_user_capabilities_updated_at();
