-- Intake forms every business can use, whatever it does.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Templates are keyed by `vertical`, and six of the platform's twenty-eight
-- verticals had one. A tutor, a photographer, a trainer, an accountant — each
-- of them opened the intake settings and found a single generic form, because
-- `/api/intake/templates` falls back to the `other` vertical and there was
-- exactly one row there.
--
-- The answer is NOT a template per vertical. Twenty-eight near-duplicates would
-- diverge the moment one was edited, and most professions want one of the same
-- few shapes: tell me why you are coming, tell me your history, tell me about
-- the work, help me prepare. So four well-made generic forms, filed under
-- `other` so every business sees all of them alongside anything specific to its
-- own vertical.
--
-- Trilingual, because the platform is: a Hebrew business must not be handed an
-- English form to send its clients.
--
-- `is_default` stays on the existing `generic_intake` row — the settings panel
-- now preselects the default, and moving it would change what businesses that
-- have already chosen get.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO intake_form_templates
  (template_key, vertical, name_en, name_es, name_he,
   description_en, description_es, description_he,
   fields, is_default, display_order)
VALUES

-- 1. The short one. Everything a business needs to not walk in cold, and
--    nothing else — a long form before a first meeting is left unfinished.
(
  'generic_brief_intake', 'other',
  'Quick Intake', 'Registro Rápido', 'שאלון קצר',
  'Three questions. Enough to prepare, short enough that people finish it.',
  'Tres preguntas. Suficiente para prepararse, breve para que la completen.',
  'שלוש שאלות. מספיק כדי להתכונן, קצר מספיק כדי שישלימו אותו.',
  '[
    {"key":"reason_for_booking","type":"textarea","required":true,
     "label_en":"What would you like to focus on?",
     "label_es":"¿En qué te gustaría enfocarte?",
     "label_he":"על מה תרצו להתמקד?",
     "placeholder_en":"A sentence or two is plenty",
     "placeholder_es":"Una o dos frases son suficientes",
     "placeholder_he":"משפט או שניים יספיקו"},
    {"key":"anything_to_know","type":"textarea","required":false,
     "label_en":"Anything I should know before we meet?",
     "label_es":"¿Algo que deba saber antes de vernos?",
     "label_he":"משהו שכדאי שאדע לפני שניפגש?",
     "placeholder_en":"Optional",
     "placeholder_es":"Opcional",
     "placeholder_he":"לא חובה"},
    {"key":"preferred_contact","type":"select","required":false,
     "label_en":"Best way to reach you",
     "label_es":"Mejor forma de contactarte",
     "label_he":"הדרך הטובה ביותר ליצור קשר",
     "options":[
       {"value":"phone","label_en":"Phone","label_es":"Teléfono","label_he":"טלפון"},
       {"value":"email","label_en":"Email","label_es":"Correo","label_he":"אימייל"},
       {"value":"whatsapp","label_en":"WhatsApp","label_es":"WhatsApp","label_he":"וואטסאפ"}
     ]}
  ]'::jsonb,
  false, 2
),

-- 2. Health history. For anyone working on a body — trainers, therapists,
--    beauty and wellness practitioners, clinicians.
(
  'generic_health_history', 'other',
  'Health & History', 'Salud e Historial', 'בריאות והיסטוריה',
  'Medical background, medication and anything that changes what is safe to do.',
  'Antecedentes médicos, medicación y cualquier cosa que cambie lo que es seguro hacer.',
  'רקע רפואי, תרופות וכל דבר שמשנה מה בטוח לעשות.',
  '[
    {"key":"conditions","type":"textarea","required":false,
     "label_en":"Any medical conditions or injuries?",
     "label_es":"¿Alguna condición médica o lesión?",
     "label_he":"מצבים רפואיים או פציעות?",
     "placeholder_en":"Including anything past that still affects you",
     "placeholder_es":"Incluye algo del pasado que aún te afecte",
     "placeholder_he":"כולל דברים מהעבר שעדיין משפיעים"},
    {"key":"medications","type":"textarea","required":false,
     "label_en":"Medications or supplements you take",
     "label_es":"Medicamentos o suplementos que tomas",
     "label_he":"תרופות או תוספים שאתם נוטלים"},
    {"key":"allergies","type":"text","required":false,
     "label_en":"Allergies",
     "label_es":"Alergias",
     "label_he":"אלרגיות"},
    {"key":"goals","type":"textarea","required":true,
     "label_en":"What are you hoping to achieve?",
     "label_es":"¿Qué esperas lograr?",
     "label_he":"מה אתם מקווים להשיג?"},
    {"key":"emergency_contact","type":"text","required":false,
     "label_en":"Emergency contact (name and phone)",
     "label_es":"Contacto de emergencia (nombre y teléfono)",
     "label_he":"איש קשר לחירום (שם וטלפון)"}
  ]'::jsonb,
  false, 3
),

-- 3. The brief. Consultants, designers, photographers, accountants, lawyers —
--    anyone whose work starts with understanding a piece of work.
(
  'generic_project_brief', 'other',
  'Project Brief', 'Brief del Proyecto', 'תיאור הפרויקט',
  'Scope, timing and budget, so the first meeting is about the work.',
  'Alcance, tiempos y presupuesto, para que la primera reunión trate del trabajo.',
  'היקף, לוחות זמנים ותקציב, כדי שהפגישה הראשונה תעסוק בעבודה עצמה.',
  '[
    {"key":"project_description","type":"textarea","required":true,
     "label_en":"What are you looking to get done?",
     "label_es":"¿Qué necesitas que se haga?",
     "label_he":"מה אתם צריכים שייעשה?"},
    {"key":"timeline","type":"select","required":false,
     "label_en":"When do you need this by?",
     "label_es":"¿Para cuándo lo necesitas?",
     "label_he":"עד מתי אתם צריכים את זה?",
     "options":[
       {"value":"urgent","label_en":"As soon as possible","label_es":"Lo antes posible","label_he":"בהקדם האפשרי"},
       {"value":"weeks","label_en":"Within a few weeks","label_es":"En unas semanas","label_he":"תוך מספר שבועות"},
       {"value":"months","label_en":"Within a few months","label_es":"En unos meses","label_he":"תוך מספר חודשים"},
       {"value":"exploring","label_en":"Just exploring","label_es":"Solo explorando","label_he":"רק בודקים"}
     ]},
    {"key":"budget_range","type":"text","required":false,
     "label_en":"Budget range, if you have one in mind",
     "label_es":"Rango de presupuesto, si tienes uno en mente",
     "label_he":"טווח תקציב, אם יש לכם"},
    {"key":"previous_work","type":"textarea","required":false,
     "label_en":"Have you worked with someone on this before?",
     "label_es":"¿Has trabajado con alguien en esto antes?",
     "label_he":"עבדתם עם מישהו על זה בעבר?"}
  ]'::jsonb,
  false, 4
),

-- 4. Preparation. Tutors, coaches, instructors — a recurring session where what
--    matters is where the client is now.
(
  'generic_session_prep', 'other',
  'Session Preparation', 'Preparación de la Sesión', 'הכנה למפגש',
  'Where the client is now, and what they want out of the session.',
  'Dónde está el cliente ahora y qué quiere de la sesión.',
  'איפה הלקוח נמצא עכשיו, ומה הוא רוצה מהמפגש.',
  '[
    {"key":"current_level","type":"textarea","required":true,
     "label_en":"Where are you starting from?",
     "label_es":"¿Desde dónde partes?",
     "label_he":"מאיפה אתם מתחילים?",
     "placeholder_en":"Your experience so far with this",
     "placeholder_es":"Tu experiencia hasta ahora con esto",
     "placeholder_he":"הניסיון שלכם עד כה בתחום"},
    {"key":"session_goals","type":"textarea","required":true,
     "label_en":"What would make this session worth it for you?",
     "label_es":"¿Qué haría que esta sesión valiera la pena para ti?",
     "label_he":"מה יגרום למפגש הזה להיות שווה עבורכם?"},
    {"key":"challenges","type":"textarea","required":false,
     "label_en":"What has been getting in the way?",
     "label_es":"¿Qué te ha estado impidiendo avanzar?",
     "label_he":"מה עמד בדרך עד עכשיו?"},
    {"key":"materials","type":"textarea","required":false,
     "label_en":"Anything you would like me to prepare or bring?",
     "label_es":"¿Algo que quieras que prepare o lleve?",
     "label_he":"משהו שתרצו שאכין או אביא?"}
  ]'::jsonb,
  false, 5
)

-- Re-running must not duplicate them. `template_key` is the stable identifier
-- a settings row points at, so a second insert would leave businesses pointing
-- at whichever copy won.
ON CONFLICT (template_key) DO NOTHING;
