-- =====================================================
-- Seed ALL Platform Capabilities & Building Blocks
-- This migration adds missing capabilities (website, reports)
-- and seeds building blocks with activation_conditions
-- =====================================================

-- =====================================================
-- 1. Add Missing Capabilities
-- =====================================================

-- Website Builder Capability
INSERT INTO capabilities (
  capability_key,
  name_en, name_es, name_he,
  description_en, description_es, description_he,
  category,
  icon,
  color,
  is_core,
  verticals
) VALUES (
  'website',
  'Website Builder', 'Constructor de Sitio Web', 'בונה אתרים',
  'Create your professional website with booking capabilities',
  'Crea tu sitio web profesional con capacidades de reserva',
  'צור את האתר המקצועי שלך עם יכולות הזמנה',
  'system',
  'Globe',
  '#EC4899',
  false, -- NOT core - only if user needs website
  '{}' -- All verticals can benefit
) ON CONFLICT (capability_key) DO NOTHING;

-- Reports & Analytics Capability
INSERT INTO capabilities (
  capability_key,
  name_en, name_es, name_he,
  description_en, description_es, description_he,
  category,
  icon,
  color,
  is_core,
  verticals
) VALUES (
  'reports',
  'Reports & Analytics', 'Informes y Análisis', 'דוחות וניתוחים',
  'Track your business performance and financial health',
  'Rastrea el rendimiento de tu negocio y salud financiera',
  'עקוב אחרי ביצועי העסק והבריאות הפיננסית',
  'system',
  'BarChart3',
  '#22C58B',
  false, -- NOT core - only if they use payments (need financial tracking)
  '{}' -- All verticals
) ON CONFLICT (capability_key) DO NOTHING;

-- Insights & Advisor Capability
INSERT INTO capabilities (
  capability_key,
  name_en, name_es, name_he,
  description_en, description_es, description_he,
  category,
  icon,
  color,
  is_core,
  verticals
) VALUES (
  'insights',
  'Business Insights', 'Perspectivas de Negocio', 'תובנות עסקיות',
  'AI-powered insights and recommendations for your business',
  'Perspectivas y recomendaciones impulsadas por IA para tu negocio',
  'תובנות והמלצות מונעות בינה מלאכותית לעסק שלך',
  'system',
  'Lightbulb',
  '#F97316',
  false, -- Only if they have enough data to analyze
  '{}' -- All verticals
) ON CONFLICT (capability_key) DO NOTHING;

-- Automations / Workflows Capability
INSERT INTO capabilities (
  capability_key,
  name_en, name_es, name_he,
  description_en, description_es, description_he,
  category,
  icon,
  color,
  is_core,
  verticals
) VALUES (
  'automations',
  'Automations', 'Automatizaciones', 'אוטומציות',
  'Create custom workflows to automate repetitive tasks',
  'Crea flujos de trabajo personalizados para automatizar tareas repetitivas',
  'צור תהליכי עבודה מותאמים אישית לאוטומציה של משימות חוזרות',
  'system',
  'Workflow',
  '#06B6D4',
  false, -- Advanced feature
  '{}' -- All verticals
) ON CONFLICT (capability_key) DO NOTHING;

-- Campaigns / Marketing Capability
INSERT INTO capabilities (
  capability_key,
  name_en, name_es, name_he,
  description_en, description_es, description_he,
  category,
  icon,
  color,
  is_core,
  verticals
) VALUES (
  'campaigns',
  'Marketing Campaigns', 'Campañas de Marketing', 'קמפיינים שיווקיים',
  'Run targeted marketing campaigns to grow your business',
  'Ejecuta campañas de marketing dirigidas para hacer crecer tu negocio',
  'הפעל קמפיינים שיווקיים ממוקדים לצמיחת העסק שלך',
  'system',
  'Megaphone',
  '#EC4899',
  false, -- Marketing focused
  '{"coach", "consultant", "trainer", "photographer", "designer"}' -- Service businesses that market
) ON CONFLICT (capability_key) DO NOTHING;

-- Integrations Capability
INSERT INTO capabilities (
  capability_key,
  name_en, name_es, name_he,
  description_en, description_es, description_he,
  category,
  icon,
  color,
  is_core,
  verticals
) VALUES (
  'integrations',
  'Integrations', 'Integraciones', 'אינטגרציות',
  'Connect with your favorite tools and services',
  'Conéctate con tus herramientas y servicios favoritos',
  'התחבר לכלים ושירותים האהובים עליך',
  'system',
  'Plug',
  '#6366F1',
  false, -- Based on tools they use
  '{}' -- All verticals
) ON CONFLICT (capability_key) DO NOTHING;

-- =====================================================
-- 2. Update Existing Capabilities with Verticals
-- =====================================================

-- CRM - useful for all service businesses
UPDATE capabilities
SET verticals = '{"therapist", "coach", "consultant", "trainer", "teacher", "photographer", "designer", "lawyer", "accountant"}'::text[]
WHERE capability_key = 'crm';

-- Scheduling - for appointment-based businesses
UPDATE capabilities
SET verticals = '{"therapist", "coach", "consultant", "trainer", "teacher", "photographer", "lawyer", "doctor", "dentist"}'::text[]
WHERE capability_key = 'scheduling';

-- Payments - for businesses that charge
UPDATE capabilities
SET verticals = '{"therapist", "coach", "consultant", "trainer", "photographer", "designer", "lawyer", "accountant", "doctor", "dentist"}'::text[]
WHERE capability_key = 'payments';

-- Email Automation - useful for all businesses
UPDATE capabilities
SET verticals = '{}'::text[] -- All verticals
WHERE capability_key = 'email_automation';

-- =====================================================
-- 3. Seed Building Blocks for Each Capability
-- =====================================================

-- Website Building Blocks
WITH website_cap AS (
  SELECT id FROM capabilities WHERE capability_key = 'website'
)
INSERT INTO capability_building_blocks (
  capability_id,
  block_key,
  name_en, name_es, name_he,
  description_en, description_es, description_he,
  is_core,
  is_recommended,
  activation_conditions
)
SELECT
  website_cap.id,
  'seo_optimization',
  'SEO Optimization', 'Optimización SEO', 'אופטימיזציה למנועי חיפוש',
  'Improve your website visibility in search engines',
  'Mejora la visibilidad de tu sitio web en motores de búsqueda',
  'שפר את הנראות של האתר שלך במנועי חיפוש',
  false, -- Not core
  true, -- Recommended
  '{}'::jsonb -- No specific conditions
FROM website_cap
ON CONFLICT (capability_id, block_key) DO NOTHING;

-- CRM Building Blocks
WITH crm_cap AS (
  SELECT id FROM capabilities WHERE capability_key = 'crm'
)
INSERT INTO capability_building_blocks (
  capability_id,
  block_key,
  name_en, name_es, name_he,
  description_en, description_es, description_he,
  is_core,
  is_recommended,
  activation_conditions
)
SELECT
  crm_cap.id,
  'pipeline_stages',
  'Sales Pipeline', 'Pipeline de Ventas', 'צינור מכירות',
  'Track leads through your sales process',
  'Rastrea clientes potenciales a través de tu proceso de ventas',
  'עקוב אחרי לקוחות פוטנציאליים בתהליך המכירה',
  true, -- Core feature
  true,
  '{"verticals": ["consultant", "coach", "sales"]}'::jsonb
FROM crm_cap
UNION ALL
SELECT
  crm_cap.id,
  'contact_import',
  'Contact Import', 'Importar Contactos', 'ייבוא אנשי קשר',
  'Import contacts from CSV or other CRMs',
  'Importa contactos desde CSV u otros CRMs',
  'ייבא אנשי קשר מ-CSV או CRM אחרים',
  false,
  true,
  '{"min_clients_per_week": 10}'::jsonb -- Only for high-volume users
FROM crm_cap
UNION ALL
SELECT
  crm_cap.id,
  'activity_log',
  'Activity Tracking', 'Seguimiento de Actividad', 'מעקב פעילות',
  'Track all interactions with contacts',
  'Rastrea todas las interacciones con contactos',
  'עקוב אחרי כל האינטראקציות עם אנשי הקשר',
  true, -- Core
  true,
  '{}'::jsonb
FROM crm_cap
ON CONFLICT (capability_id, block_key) DO NOTHING;

-- Scheduling Building Blocks
WITH scheduling_cap AS (
  SELECT id FROM capabilities WHERE capability_key = 'scheduling'
)
INSERT INTO capability_building_blocks (
  capability_id,
  block_key,
  name_en, name_es, name_he,
  description_en, description_es, description_he,
  is_core,
  is_recommended,
  activation_conditions
)
SELECT
  scheduling_cap.id,
  'calendar_sync',
  'Calendar Sync', 'Sincronización de Calendario', 'סנכרון יומן',
  'Sync with Google Calendar, Outlook, etc.',
  'Sincroniza con Google Calendar, Outlook, etc.',
  'סנכרון עם Google Calendar, Outlook וכו''',
  false,
  true,
  '{"tools": ["google_calendar", "microsoft_calendar"]}'::jsonb -- Only if they have calendar tool
FROM scheduling_cap
UNION ALL
SELECT
  scheduling_cap.id,
  'reminder_automation',
  'Appointment Reminders', 'Recordatorios de Citas', 'תזכורות פגישות',
  'Automatically send reminders before appointments',
  'Envía recordatorios automáticamente antes de las citas',
  'שלח תזכורות אוטומטית לפני פגישות',
  true, -- Core
  true,
  '{"pain_points": ["no_shows", "scheduling_conflicts"]}'::jsonb
FROM scheduling_cap
UNION ALL
SELECT
  scheduling_cap.id,
  'buffer_time',
  'Buffer Time', 'Tiempo de Espera', 'זמן מרווח',
  'Add buffer time between appointments',
  'Añade tiempo de espera entre citas',
  'הוסף זמן מרווח בין פגישות',
  false,
  true,
  '{"min_clients_per_week": 5}'::jsonb -- For busy schedules
FROM scheduling_cap
ON CONFLICT (capability_id, block_key) DO NOTHING;

-- Payments Building Blocks
WITH payments_cap AS (
  SELECT id FROM capabilities WHERE capability_key = 'payments'
)
INSERT INTO capability_building_blocks (
  capability_id,
  block_key,
  name_en, name_es, name_he,
  description_en, description_es, description_he,
  is_core,
  is_recommended,
  activation_conditions
)
SELECT
  payments_cap.id,
  'payment_plans',
  'Payment Plans', 'Planes de Pago', 'תוכניות תשלום',
  'Let clients pay in installments',
  'Permite a los clientes pagar en cuotas',
  'אפשר ללקוחות לשלם בתשלומים',
  false,
  true,
  '{"verticals": ["coach", "consultant", "trainer"]}'::jsonb
FROM payments_cap
UNION ALL
SELECT
  payments_cap.id,
  'invoice_automation',
  'Invoice Automation', 'Automatización de Facturas', 'אוטומציה לחשבוניות',
  'Automatically generate and send invoices',
  'Genera y envía facturas automáticamente',
  'צור ושלח חשבוניות אוטומטית',
  true, -- Core
  true,
  '{}'::jsonb
FROM payments_cap
UNION ALL
SELECT
  payments_cap.id,
  'late_payment_reminders',
  'Late Payment Reminders', 'Recordatorios de Pago Atrasado', 'תזכורות תשלום באיחור',
  'Automatically remind clients about overdue payments',
  'Recuerda automáticamente a los clientes sobre pagos atrasados',
  'הזכר ללקוחות אוטומטית על תשלומים באיחור',
  false,
  true,
  '{"pain_points": ["late_payments", "payment_tracking"]}'::jsonb
FROM payments_cap
ON CONFLICT (capability_id, block_key) DO NOTHING;

-- Email Automation Building Blocks
WITH email_cap AS (
  SELECT id FROM capabilities WHERE capability_key = 'email_automation'
)
INSERT INTO capability_building_blocks (
  capability_id,
  block_key,
  name_en, name_es, name_he,
  description_en, description_es, description_he,
  is_core,
  is_recommended,
  activation_conditions
)
SELECT
  email_cap.id,
  'welcome_sequence',
  'Welcome Emails', 'Emails de Bienvenida', 'אימיילי ברוכים הבאים',
  'Send automated welcome series to new contacts',
  'Envía series de bienvenida automatizadas a nuevos contactos',
  'שלח סדרות ברוכים הבאים אוטומטיות לאנשי קשר חדשים',
  true, -- Core
  true,
  '{}'::jsonb
FROM email_cap
UNION ALL
SELECT
  email_cap.id,
  'follow_up_automation',
  'Follow-up Automation', 'Automatización de Seguimiento', 'אוטומציה למעקבים',
  'Automatically follow up with leads',
  'Haz seguimiento automático con clientes potenciales',
  'עקוב אוטומטית אחרי לקוחות פוטנציאליים',
  false,
  true,
  '{"pain_points": ["client_follow_up", "lead_management"]}'::jsonb
FROM email_cap
ON CONFLICT (capability_id, block_key) DO NOTHING;

-- Insights Building Blocks
WITH insights_cap AS (
  SELECT id FROM capabilities WHERE capability_key = 'insights'
)
INSERT INTO capability_building_blocks (
  capability_id,
  block_key,
  name_en, name_es, name_he,
  description_en, description_es, description_he,
  is_core,
  is_recommended,
  activation_conditions
)
SELECT
  insights_cap.id,
  'revenue_insights',
  'Revenue Insights', 'Perspectivas de Ingresos', 'תובנות הכנסות',
  'AI analysis of your revenue patterns and trends',
  'Análisis de IA de tus patrones y tendencias de ingresos',
  'ניתוח בינה מלאכותית של דפוסי ומגמות ההכנסות שלך',
  true, -- Core
  true,
  '{}'::jsonb
FROM insights_cap
UNION ALL
SELECT
  insights_cap.id,
  'client_health',
  'Client Health Alerts', 'Alertas de Salud del Cliente', 'התראות בריאות לקוח',
  'Get notified when clients might be at risk of churning',
  'Recibe notificaciones cuando los clientes podrían estar en riesgo de irse',
  'קבל התראה כאשר לקוחות עשויים להיות בסיכון לנטישה',
  false,
  true,
  '{"min_clients_per_week": 5}'::jsonb -- Need enough clients to analyze
FROM insights_cap
UNION ALL
SELECT
  insights_cap.id,
  'operational_alerts',
  'Operational Alerts', 'Alertas Operacionales', 'התראות תפעוליות',
  'Alerts for no-shows, cancellations, and scheduling issues',
  'Alertas para ausencias, cancelaciones y problemas de programación',
  'התראות על אי-הגעות, ביטולים ובעיות תזמון',
  true, -- Core
  true,
  '{"pain_points": ["no_shows", "scheduling_conflicts"]}'::jsonb
FROM insights_cap
ON CONFLICT (capability_id, block_key) DO NOTHING;

-- Automations Building Blocks
WITH automations_cap AS (
  SELECT id FROM capabilities WHERE capability_key = 'automations'
)
INSERT INTO capability_building_blocks (
  capability_id,
  block_key,
  name_en, name_es, name_he,
  description_en, description_es, description_he,
  is_core,
  is_recommended,
  activation_conditions
)
SELECT
  automations_cap.id,
  'trigger_workflows',
  'Trigger-based Workflows', 'Flujos de Trabajo Basados en Disparadores', 'תהליכי עבודה מבוססי טריגר',
  'Automate actions based on events like new bookings or payments',
  'Automatiza acciones basadas en eventos como nuevas reservas o pagos',
  'אוטומציה של פעולות בהתבסס על אירועים כמו הזמנות או תשלומים חדשים',
  true, -- Core
  true,
  '{}'::jsonb
FROM automations_cap
UNION ALL
SELECT
  automations_cap.id,
  'scheduled_tasks',
  'Scheduled Tasks', 'Tareas Programadas', 'משימות מתוזמנות',
  'Run automated tasks on a schedule',
  'Ejecuta tareas automatizadas según un horario',
  'הפעל משימות אוטומטיות לפי לוח זמנים',
  false,
  true,
  '{"min_clients_per_week": 10}'::jsonb -- For busy businesses
FROM automations_cap
ON CONFLICT (capability_id, block_key) DO NOTHING;

-- Campaigns Building Blocks
WITH campaigns_cap AS (
  SELECT id FROM capabilities WHERE capability_key = 'campaigns'
)
INSERT INTO capability_building_blocks (
  capability_id,
  block_key,
  name_en, name_es, name_he,
  description_en, description_es, description_he,
  is_core,
  is_recommended,
  activation_conditions
)
SELECT
  campaigns_cap.id,
  'email_campaigns',
  'Email Campaigns', 'Campañas de Email', 'קמפייני אימייל',
  'Send targeted email campaigns to your contacts',
  'Envía campañas de email dirigidas a tus contactos',
  'שלח קמפייני אימייל ממוקדים לאנשי הקשר שלך',
  true, -- Core
  true,
  '{}'::jsonb
FROM campaigns_cap
UNION ALL
SELECT
  campaigns_cap.id,
  'audience_segments',
  'Audience Segments', 'Segmentos de Audiencia', 'פלחי קהל',
  'Create targeted segments based on client behavior',
  'Crea segmentos dirigidos basados en el comportamiento del cliente',
  'צור פלחים ממוקדים בהתבסס על התנהגות הלקוח',
  false,
  true,
  '{"min_clients_per_week": 10}'::jsonb -- Need enough contacts
FROM campaigns_cap
ON CONFLICT (capability_id, block_key) DO NOTHING;

-- Integrations Building Blocks
WITH integrations_cap AS (
  SELECT id FROM capabilities WHERE capability_key = 'integrations'
)
INSERT INTO capability_building_blocks (
  capability_id,
  block_key,
  name_en, name_es, name_he,
  description_en, description_es, description_he,
  is_core,
  is_recommended,
  activation_conditions
)
SELECT
  integrations_cap.id,
  'calendar_integration',
  'Calendar Integration', 'Integración de Calendario', 'אינטגרציית יומן',
  'Connect with Google Calendar, Outlook, and more',
  'Conéctate con Google Calendar, Outlook y más',
  'התחבר ל-Google Calendar, Outlook ועוד',
  true, -- Core
  true,
  '{"tools": ["google_calendar", "microsoft_calendar"]}'::jsonb
FROM integrations_cap
UNION ALL
SELECT
  integrations_cap.id,
  'payment_integration',
  'Payment Integration', 'Integración de Pagos', 'אינטגרציית תשלומים',
  'Connect with Stripe, PayPal, and more',
  'Conéctate con Stripe, PayPal y más',
  'התחבר ל-Stripe, PayPal ועוד',
  true, -- Core
  true,
  '{"tools": ["stripe", "paypal"]}'::jsonb
FROM integrations_cap
UNION ALL
SELECT
  integrations_cap.id,
  'crm_import',
  'CRM Import', 'Importar CRM', 'ייבוא CRM',
  'Import data from other CRM systems',
  'Importa datos de otros sistemas CRM',
  'ייבא נתונים ממערכות CRM אחרות',
  false,
  true,
  '{"tools": ["hubspot", "salesforce", "zoho"]}'::jsonb
FROM integrations_cap
ON CONFLICT (capability_id, block_key) DO NOTHING;

-- Reports Building Blocks
WITH reports_cap AS (
  SELECT id FROM capabilities WHERE capability_key = 'reports'
)
INSERT INTO capability_building_blocks (
  capability_id,
  block_key,
  name_en, name_es, name_he,
  description_en, description_es, description_he,
  is_core,
  is_recommended,
  activation_conditions
)
SELECT
  reports_cap.id,
  'revenue_reports',
  'Revenue Reports', 'Informes de Ingresos', 'דוחות הכנסות',
  'Track your revenue over time',
  'Rastrea tus ingresos a lo largo del tiempo',
  'עקוב אחרי ההכנסות שלך לאורך זמן',
  true, -- Core
  true,
  '{}'::jsonb
FROM reports_cap
UNION ALL
SELECT
  reports_cap.id,
  'booking_analytics',
  'Booking Analytics', 'Análisis de Reservas', 'ניתוח הזמנות',
  'Analyze your booking patterns and trends',
  'Analiza tus patrones y tendencias de reservas',
  'נתח את דפוסי ומגמות ההזמנות שלך',
  true, -- Core
  true,
  '{}'::jsonb
FROM reports_cap
UNION ALL
SELECT
  reports_cap.id,
  'client_reports',
  'Client Reports', 'Informes de Clientes', 'דוחות לקוחות',
  'Analyze client acquisition and retention',
  'Analiza la adquisición y retención de clientes',
  'נתח רכישת ושימור לקוחות',
  false,
  true,
  '{"min_clients_per_week": 5}'::jsonb
FROM reports_cap
ON CONFLICT (capability_id, block_key) DO NOTHING;
