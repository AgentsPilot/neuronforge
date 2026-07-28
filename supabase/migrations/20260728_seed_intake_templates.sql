-- Seed Intake Form Templates
-- Purpose: Pre-built templates for each business vertical with multilingual field labels
-- Last Updated: 2026-07-28

-- Clear existing templates (for re-seeding)
DELETE FROM intake_form_templates;

-- ============================================
-- THERAPIST TEMPLATES
-- ============================================

-- Therapist Initial Intake
INSERT INTO intake_form_templates (template_key, vertical, name_en, name_es, name_he, description_en, description_es, description_he, fields, is_default, display_order)
VALUES (
  'therapist_initial',
  'therapist',
  'Initial Intake Form',
  'Formulario de Admisión Inicial',
  'טופס קליטה ראשוני',
  'Standard intake form for new therapy clients',
  'Formulario estándar para nuevos pacientes de terapia',
  'טופס קליטה סטנדרטי ללקוחות חדשים',
  '[
    {
      "key": "referral_source",
      "type": "select",
      "label_en": "How did you hear about me?",
      "label_es": "¿Cómo me conociste?",
      "label_he": "איך שמעת עליי?",
      "required": true,
      "options": [
        {"value": "google", "label_en": "Google Search", "label_es": "Búsqueda en Google", "label_he": "חיפוש בגוגל"},
        {"value": "referral", "label_en": "Friend/Family Referral", "label_es": "Referencia de amigo/familiar", "label_he": "המלצה מחבר/משפחה"},
        {"value": "social", "label_en": "Social Media", "label_es": "Redes Sociales", "label_he": "רשתות חברתיות"},
        {"value": "doctor", "label_en": "Doctor Referral", "label_es": "Referencia médica", "label_he": "הפניה מרופא"},
        {"value": "other", "label_en": "Other", "label_es": "Otro", "label_he": "אחר"}
      ]
    },
    {
      "key": "primary_concern",
      "type": "textarea",
      "label_en": "What brings you to therapy?",
      "label_es": "¿Qué te trae a terapia?",
      "label_he": "מה מביא אותך לטיפול?",
      "required": true,
      "placeholder_en": "Please describe what you would like to work on...",
      "placeholder_es": "Por favor describe en qué te gustaría trabajar...",
      "placeholder_he": "אנא תאר/י על מה תרצה/י לעבוד..."
    },
    {
      "key": "previous_therapy",
      "type": "radio",
      "label_en": "Have you been in therapy before?",
      "label_es": "¿Has estado en terapia antes?",
      "label_he": "האם היית בטיפול בעבר?",
      "required": true,
      "options": [
        {"value": "yes", "label_en": "Yes", "label_es": "Sí", "label_he": "כן"},
        {"value": "no", "label_en": "No", "label_es": "No", "label_he": "לא"}
      ]
    },
    {
      "key": "current_medications",
      "type": "textarea",
      "label_en": "Are you currently taking any medications?",
      "label_es": "¿Está tomando algún medicamento actualmente?",
      "label_he": "האם את/ה נוטל/ת תרופות כרגע?",
      "required": false,
      "placeholder_en": "List any medications or write N/A",
      "placeholder_es": "Liste los medicamentos o escriba N/A",
      "placeholder_he": "רשום/י תרופות או כתוב/י לא רלוונטי"
    },
    {
      "key": "emergency_contact",
      "type": "text",
      "label_en": "Emergency contact name and phone",
      "label_es": "Nombre y teléfono de contacto de emergencia",
      "label_he": "שם וטלפון איש קשר לחירום",
      "required": true,
      "placeholder_en": "Name - Phone number",
      "placeholder_es": "Nombre - Número de teléfono",
      "placeholder_he": "שם - מספר טלפון"
    }
  ]'::jsonb,
  true,
  1
);

-- Therapist Couples Intake
INSERT INTO intake_form_templates (template_key, vertical, name_en, name_es, name_he, description_en, description_es, description_he, fields, is_default, display_order)
VALUES (
  'therapist_couples',
  'therapist',
  'Couples Therapy Intake',
  'Formulario de Terapia de Pareja',
  'טופס קליטה לזוגות',
  'Intake form for couples therapy sessions',
  'Formulario de admisión para sesiones de terapia de pareja',
  'טופס קליטה לפגישות טיפול זוגי',
  '[
    {
      "key": "relationship_duration",
      "type": "text",
      "label_en": "How long have you been together?",
      "label_es": "¿Cuánto tiempo llevan juntos?",
      "label_he": "כמה זמן אתם ביחד?",
      "required": true,
      "placeholder_en": "e.g., 5 years",
      "placeholder_es": "ej., 5 años",
      "placeholder_he": "לדוגמה: 5 שנים"
    },
    {
      "key": "main_concerns",
      "type": "textarea",
      "label_en": "What are the main issues you want to address?",
      "label_es": "¿Cuáles son los principales problemas que desean abordar?",
      "label_he": "מהם הנושאים העיקריים שתרצו לטפל בהם?",
      "required": true,
      "placeholder_en": "Describe the challenges in your relationship...",
      "placeholder_es": "Describa los desafíos en su relación...",
      "placeholder_he": "תאר/י את האתגרים בזוגיות שלכם..."
    },
    {
      "key": "previous_couples_therapy",
      "type": "radio",
      "label_en": "Have you tried couples therapy before?",
      "label_es": "¿Han intentado terapia de pareja antes?",
      "label_he": "האם ניסיתם טיפול זוגי בעבר?",
      "required": true,
      "options": [
        {"value": "yes", "label_en": "Yes", "label_es": "Sí", "label_he": "כן"},
        {"value": "no", "label_en": "No", "label_es": "No", "label_he": "לא"}
      ]
    },
    {
      "key": "goals",
      "type": "textarea",
      "label_en": "What do you hope to achieve from therapy?",
      "label_es": "¿Qué esperan lograr de la terapia?",
      "label_he": "מה אתם מקווים להשיג מהטיפול?",
      "required": false,
      "placeholder_en": "Your goals for couples therapy...",
      "placeholder_es": "Sus metas para la terapia de pareja...",
      "placeholder_he": "המטרות שלכם לטיפול הזוגי..."
    }
  ]'::jsonb,
  false,
  2
);

-- ============================================
-- COACH TEMPLATES
-- ============================================

-- Coach Discovery
INSERT INTO intake_form_templates (template_key, vertical, name_en, name_es, name_he, description_en, description_es, description_he, fields, is_default, display_order)
VALUES (
  'coach_discovery',
  'coach',
  'Discovery Session Intake',
  'Formulario de Sesión de Descubrimiento',
  'טופס קליטה לפגישת היכרות',
  'Pre-session form to understand coaching goals',
  'Formulario previo a la sesión para entender las metas de coaching',
  'טופס לפני הפגישה להבנת מטרות האימון',
  '[
    {
      "key": "coaching_goals",
      "type": "textarea",
      "label_en": "What do you want to achieve through coaching?",
      "label_es": "¿Qué quieres lograr a través del coaching?",
      "label_he": "מה את/ה רוצה להשיג דרך האימון?",
      "required": true,
      "placeholder_en": "Describe your main goals...",
      "placeholder_es": "Describe tus metas principales...",
      "placeholder_he": "תאר/י את המטרות העיקריות שלך..."
    },
    {
      "key": "biggest_challenge",
      "type": "textarea",
      "label_en": "What is your biggest challenge right now?",
      "label_es": "¿Cuál es tu mayor desafío en este momento?",
      "label_he": "מהו האתגר הגדול ביותר שלך כרגע?",
      "required": true,
      "placeholder_en": "What''s holding you back?",
      "placeholder_es": "¿Qué te está frenando?",
      "placeholder_he": "מה מעכב אותך?"
    },
    {
      "key": "previous_coaching",
      "type": "radio",
      "label_en": "Have you worked with a coach before?",
      "label_es": "¿Has trabajado con un coach antes?",
      "label_he": "האם עבדת עם מאמן/ת בעבר?",
      "required": true,
      "options": [
        {"value": "yes", "label_en": "Yes", "label_es": "Sí", "label_he": "כן"},
        {"value": "no", "label_en": "No", "label_es": "No", "label_he": "לא"}
      ]
    },
    {
      "key": "commitment_level",
      "type": "select",
      "label_en": "How committed are you to making changes?",
      "label_es": "¿Qué tan comprometido estás a hacer cambios?",
      "label_he": "כמה את/ה מחויב/ת לעשות שינויים?",
      "required": true,
      "options": [
        {"value": "exploring", "label_en": "Just exploring", "label_es": "Solo explorando", "label_he": "רק בודק/ת"},
        {"value": "ready", "label_en": "Ready to start", "label_es": "Listo para empezar", "label_he": "מוכן/ה להתחיל"},
        {"value": "committed", "label_en": "Fully committed", "label_es": "Completamente comprometido", "label_he": "מחויב/ת לחלוטין"}
      ]
    }
  ]'::jsonb,
  true,
  1
);

-- ============================================
-- CONSULTANT TEMPLATES
-- ============================================

-- Consultant Strategy
INSERT INTO intake_form_templates (template_key, vertical, name_en, name_es, name_he, description_en, description_es, description_he, fields, is_default, display_order)
VALUES (
  'consultant_strategy',
  'consultant',
  'Strategy Consultation Intake',
  'Formulario de Consulta Estratégica',
  'טופס קליטה לייעוץ אסטרטגי',
  'Pre-consultation form for business consulting',
  'Formulario previo a la consulta para consultoría empresarial',
  'טופס לפני הייעוץ לייעוץ עסקי',
  '[
    {
      "key": "company_name",
      "type": "text",
      "label_en": "Company Name",
      "label_es": "Nombre de la Empresa",
      "label_he": "שם החברה",
      "required": true,
      "placeholder_en": "Your company name",
      "placeholder_es": "Nombre de su empresa",
      "placeholder_he": "שם החברה שלך"
    },
    {
      "key": "company_size",
      "type": "select",
      "label_en": "Company Size",
      "label_es": "Tamaño de la Empresa",
      "label_he": "גודל החברה",
      "required": true,
      "options": [
        {"value": "solo", "label_en": "Solo/Freelancer", "label_es": "Solo/Freelancer", "label_he": "עצמאי/פרילנסר"},
        {"value": "small", "label_en": "2-10 employees", "label_es": "2-10 empleados", "label_he": "2-10 עובדים"},
        {"value": "medium", "label_en": "11-50 employees", "label_es": "11-50 empleados", "label_he": "11-50 עובדים"},
        {"value": "large", "label_en": "50+ employees", "label_es": "50+ empleados", "label_he": "50+ עובדים"}
      ]
    },
    {
      "key": "main_challenge",
      "type": "textarea",
      "label_en": "What is your main business challenge?",
      "label_es": "¿Cuál es tu principal desafío empresarial?",
      "label_he": "מהו האתגר העסקי העיקרי שלך?",
      "required": true,
      "placeholder_en": "Describe the challenge you need help with...",
      "placeholder_es": "Describe el desafío con el que necesitas ayuda...",
      "placeholder_he": "תאר/י את האתגר שאתה צריך עזרה איתו..."
    },
    {
      "key": "budget_range",
      "type": "select",
      "label_en": "Budget Range for Consulting",
      "label_es": "Rango de Presupuesto para Consultoría",
      "label_he": "טווח תקציב לייעוץ",
      "required": false,
      "options": [
        {"value": "under_1k", "label_en": "Under $1,000", "label_es": "Menos de $1,000", "label_he": "עד $1,000"},
        {"value": "1k_5k", "label_en": "$1,000 - $5,000", "label_es": "$1,000 - $5,000", "label_he": "$1,000 - $5,000"},
        {"value": "5k_10k", "label_en": "$5,000 - $10,000", "label_es": "$5,000 - $10,000", "label_he": "$5,000 - $10,000"},
        {"value": "over_10k", "label_en": "Over $10,000", "label_es": "Más de $10,000", "label_he": "מעל $10,000"}
      ]
    }
  ]'::jsonb,
  true,
  1
);

-- ============================================
-- LAWYER TEMPLATES
-- ============================================

-- Lawyer Initial Consultation
INSERT INTO intake_form_templates (template_key, vertical, name_en, name_es, name_he, description_en, description_es, description_he, fields, is_default, display_order)
VALUES (
  'lawyer_initial',
  'lawyer',
  'Legal Consultation Intake',
  'Formulario de Consulta Legal',
  'טופס קליטה לייעוץ משפטי',
  'Initial intake for legal consultations',
  'Formulario inicial para consultas legales',
  'טופס קליטה ראשוני לייעוץ משפטי',
  '[
    {
      "key": "legal_matter_type",
      "type": "select",
      "label_en": "Type of Legal Matter",
      "label_es": "Tipo de Asunto Legal",
      "label_he": "סוג העניין המשפטי",
      "required": true,
      "options": [
        {"value": "family", "label_en": "Family Law", "label_es": "Derecho Familiar", "label_he": "דיני משפחה"},
        {"value": "business", "label_en": "Business/Corporate", "label_es": "Empresarial/Corporativo", "label_he": "עסקי/תאגידי"},
        {"value": "real_estate", "label_en": "Real Estate", "label_es": "Bienes Raíces", "label_he": "נדל\"ן"},
        {"value": "employment", "label_en": "Employment", "label_es": "Laboral", "label_he": "דיני עבודה"},
        {"value": "immigration", "label_en": "Immigration", "label_es": "Inmigración", "label_he": "הגירה"},
        {"value": "other", "label_en": "Other", "label_es": "Otro", "label_he": "אחר"}
      ]
    },
    {
      "key": "matter_description",
      "type": "textarea",
      "label_en": "Please describe your legal matter",
      "label_es": "Por favor describa su asunto legal",
      "label_he": "אנא תאר/י את העניין המשפטי שלך",
      "required": true,
      "placeholder_en": "Provide a brief overview of your situation...",
      "placeholder_es": "Proporcione una breve descripción de su situación...",
      "placeholder_he": "ספק/י סקירה קצרה של המצב שלך..."
    },
    {
      "key": "urgency",
      "type": "select",
      "label_en": "How urgent is this matter?",
      "label_es": "¿Qué tan urgente es este asunto?",
      "label_he": "כמה דחוף העניין?",
      "required": true,
      "options": [
        {"value": "not_urgent", "label_en": "Not urgent - general consultation", "label_es": "No urgente - consulta general", "label_he": "לא דחוף - ייעוץ כללי"},
        {"value": "soon", "label_en": "Needs attention within weeks", "label_es": "Necesita atención en semanas", "label_he": "דורש טיפול תוך שבועות"},
        {"value": "urgent", "label_en": "Urgent - deadline approaching", "label_es": "Urgente - fecha límite próxima", "label_he": "דחוף - מועד אחרון מתקרב"}
      ]
    },
    {
      "key": "documents",
      "type": "radio",
      "label_en": "Do you have relevant documents to share?",
      "label_es": "¿Tiene documentos relevantes para compartir?",
      "label_he": "האם יש לך מסמכים רלוונטיים לשתף?",
      "required": true,
      "options": [
        {"value": "yes", "label_en": "Yes", "label_es": "Sí", "label_he": "כן"},
        {"value": "no", "label_en": "No", "label_es": "No", "label_he": "לא"}
      ]
    }
  ]'::jsonb,
  true,
  1
);

-- ============================================
-- FITNESS TEMPLATES
-- ============================================

-- Fitness Assessment
INSERT INTO intake_form_templates (template_key, vertical, name_en, name_es, name_he, description_en, description_es, description_he, fields, is_default, display_order)
VALUES (
  'fitness_assessment',
  'fitness',
  'Fitness Assessment Form',
  'Formulario de Evaluación Física',
  'טופס הערכת כושר',
  'Pre-session health and fitness assessment',
  'Evaluación de salud y condición física previa a la sesión',
  'הערכת בריאות וכושר לפני הפגישה',
  '[
    {
      "key": "fitness_goals",
      "type": "select",
      "label_en": "What is your primary fitness goal?",
      "label_es": "¿Cuál es tu objetivo principal de fitness?",
      "label_he": "מהי מטרת הכושר העיקרית שלך?",
      "required": true,
      "options": [
        {"value": "weight_loss", "label_en": "Weight Loss", "label_es": "Pérdida de Peso", "label_he": "ירידה במשקל"},
        {"value": "muscle_gain", "label_en": "Build Muscle", "label_es": "Ganar Músculo", "label_he": "בניית שריר"},
        {"value": "endurance", "label_en": "Improve Endurance", "label_es": "Mejorar Resistencia", "label_he": "שיפור סיבולת"},
        {"value": "flexibility", "label_en": "Flexibility/Mobility", "label_es": "Flexibilidad/Movilidad", "label_he": "גמישות/ניידות"},
        {"value": "general", "label_en": "General Fitness", "label_es": "Fitness General", "label_he": "כושר כללי"}
      ]
    },
    {
      "key": "current_activity_level",
      "type": "select",
      "label_en": "Current activity level",
      "label_es": "Nivel de actividad actual",
      "label_he": "רמת הפעילות הנוכחית",
      "required": true,
      "options": [
        {"value": "sedentary", "label_en": "Sedentary (little to no exercise)", "label_es": "Sedentario (poco o ningún ejercicio)", "label_he": "יושבני (מעט או ללא פעילות)"},
        {"value": "light", "label_en": "Light (1-2 days/week)", "label_es": "Ligero (1-2 días/semana)", "label_he": "קל (1-2 ימים בשבוע)"},
        {"value": "moderate", "label_en": "Moderate (3-4 days/week)", "label_es": "Moderado (3-4 días/semana)", "label_he": "בינוני (3-4 ימים בשבוע)"},
        {"value": "active", "label_en": "Active (5+ days/week)", "label_es": "Activo (5+ días/semana)", "label_he": "פעיל (5+ ימים בשבוע)"}
      ]
    },
    {
      "key": "health_conditions",
      "type": "textarea",
      "label_en": "Any health conditions or injuries we should know about?",
      "label_es": "¿Alguna condición de salud o lesión que debamos saber?",
      "label_he": "האם יש מצבים בריאותיים או פציעות שעלינו לדעת עליהם?",
      "required": false,
      "placeholder_en": "List any conditions or write None",
      "placeholder_es": "Liste condiciones o escriba Ninguna",
      "placeholder_he": "רשום/י מצבים או כתוב/י אין"
    },
    {
      "key": "preferred_time",
      "type": "select",
      "label_en": "Preferred workout time",
      "label_es": "Hora preferida de entrenamiento",
      "label_he": "זמן אימון מועדף",
      "required": false,
      "options": [
        {"value": "morning", "label_en": "Morning", "label_es": "Mañana", "label_he": "בוקר"},
        {"value": "afternoon", "label_en": "Afternoon", "label_es": "Tarde", "label_he": "צהריים"},
        {"value": "evening", "label_en": "Evening", "label_es": "Noche", "label_he": "ערב"}
      ]
    }
  ]'::jsonb,
  true,
  1
);

-- ============================================
-- GENERIC/OTHER TEMPLATES
-- ============================================

-- Generic Intake
INSERT INTO intake_form_templates (template_key, vertical, name_en, name_es, name_he, description_en, description_es, description_he, fields, is_default, display_order)
VALUES (
  'generic_intake',
  'other',
  'General Intake Form',
  'Formulario de Admisión General',
  'טופס קליטה כללי',
  'A simple intake form for any service type',
  'Un formulario simple de admisión para cualquier tipo de servicio',
  'טופס קליטה פשוט לכל סוג שירות',
  '[
    {
      "key": "reason_for_booking",
      "type": "textarea",
      "label_en": "What brings you here today?",
      "label_es": "¿Qué te trae aquí hoy?",
      "label_he": "מה מביא אותך לכאן היום?",
      "required": true,
      "placeholder_en": "Please describe why you are booking this session...",
      "placeholder_es": "Por favor describe por qué estás reservando esta sesión...",
      "placeholder_he": "אנא תאר/י למה את/ה מזמין/ה את הפגישה הזו..."
    },
    {
      "key": "expectations",
      "type": "textarea",
      "label_en": "What do you expect from this session?",
      "label_es": "¿Qué esperas de esta sesión?",
      "label_he": "מה את/ה מצפה מהפגישה הזו?",
      "required": false,
      "placeholder_en": "Your expectations and goals...",
      "placeholder_es": "Tus expectativas y metas...",
      "placeholder_he": "הציפיות והמטרות שלך..."
    },
    {
      "key": "how_did_you_find_us",
      "type": "select",
      "label_en": "How did you find us?",
      "label_es": "¿Cómo nos encontraste?",
      "label_he": "איך מצאת אותנו?",
      "required": false,
      "options": [
        {"value": "google", "label_en": "Google Search", "label_es": "Búsqueda en Google", "label_he": "חיפוש בגוגל"},
        {"value": "referral", "label_en": "Referral", "label_es": "Referencia", "label_he": "המלצה"},
        {"value": "social", "label_en": "Social Media", "label_es": "Redes Sociales", "label_he": "רשתות חברתיות"},
        {"value": "other", "label_en": "Other", "label_es": "Otro", "label_he": "אחר"}
      ]
    }
  ]'::jsonb,
  true,
  1
);

-- Comment
COMMENT ON TABLE intake_form_templates IS 'Seeded with vertical-specific templates for therapist, coach, consultant, lawyer, fitness, and generic/other';
