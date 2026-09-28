/**
 * A privacy notice composed from what the platform already knows.
 *
 * Not legal advice, and it says so on the page. The bar it has to clear is not
 * "as good as a lawyer's" - it is "better than what is there now", and what is
 * there now is no page at all and a consent checkbox linking nowhere.
 *
 * Everything below is drawn from the actual stack rather than from a template:
 * the categories are the fields the public forms really collect, and the
 * processors are the services the data really reaches. A generic notice that
 * names the wrong processors is worse than none, because it is a statement the
 * business is making about itself that happens to be false.
 *
 * The owner can edit it, and once they do the edited body is stored and this
 * function stops being consulted for them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE LOCALES, EACH WRITTEN OUT, NONE TRANSLATED BY MACHINE.
 *
 * This used to be English only, on the reasoning that machine-translating a
 * legal notice produces text that reads as authoritative and is not. That
 * reasoning still holds and nothing here is machine-translated: each locale's
 * prose is authored, the same way `defaultStatements.ts` authors the consent
 * sentence in three languages.
 *
 * What changed is the conclusion. An English default is not a draft the owner
 * can see is a draft - it is the page their Hebrew-speaking clients actually
 * read, because the settings panel seeds it and most owners never edit it. A
 * notice nobody in the room can read is not a safer notice.
 *
 * ADDING A LOCALE means writing the prose, not extending a lookup. If a locale
 * has no entry it falls back to English, which is honest: better a notice in a
 * language the visitor may not read than one this file invented.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/consent/privacyPolicy
 */

/** The locales the notice is authored in. Anything else falls back to English. */
export type PrivacyLocale = 'en' | 'he' | 'es';

export interface PrivacyPolicyInputs {
  businessName: string;
  contactEmail?: string | null;
  postalAddress?: string | null;
  /** Where someone exercises their right to stop marketing email. */
  unsubscribeUrl?: string | null;
  /**
   * Which language to write it in. Anything outside `PrivacyLocale` gets
   * English. Defaults to English so existing callers are unaffected.
   */
  locale?: string | null;
}

/** What each locale's author is handed. Already trimmed and defaulted. */
interface Resolved {
  name: string;
  email?: string;
  address?: string;
  unsubscribeUrl?: string;
}

/**
 * The processors, named identically in every locale.
 *
 * Company names are not translated, and the one-line description of what each
 * one does is - so the list is built per locale from the same four keys, and a
 * processor cannot be present in one language and missing from another.
 */
const PROCESSORS = ['Supabase', 'Vercel', 'Resend', 'Stripe'] as const;

type ProcessorNotes = Record<(typeof PROCESSORS)[number], string>;

/** The two contact lines, labelled per locale, omitted when there is nothing. */
function contactBlock(r: Resolved, labels: { email: string; address: string }, fallback: string) {
  const lines = [
    r.email ? `- ${labels.email}: ${r.email}` : null,
    r.address ? `- ${labels.address}: ${r.address}` : null,
  ].filter(Boolean) as string[];
  return lines.length ? lines.join('\n') : fallback;
}

function processorList(notes: ProcessorNotes): string {
  return PROCESSORS.map(key => `- **${key}**: ${notes[key]}`).join('\n');
}

const BODIES: Record<PrivacyLocale, (r: Resolved) => string> = {
  en: (r) =>
    [
      `# Privacy notice`,
      ``,
      `${r.name} collects and uses personal information when you get in touch, book an`,
      `appointment, request a quote, or pay for something. This notice explains what`,
      `is collected, why, and what you can ask us to do about it.`,
      ``,
      `## What is collected`,
      ``,
      `- Your name, email address and phone number, where you provide them`,
      `- The content of messages and forms you submit`,
      `- Appointment details: the service, the date and time, and any notes you add`,
      `- Payment records: amounts, dates and status. Card details are handled by our`,
      `  payment processor and are never stored by ${r.name}`,
      `- How you arrived: the page you came from and, where present, the campaign or`,
      `  link you followed`,
      `- A one-way hash of your IP address, used to count visitors without`,
      `  identifying them, and your browser's user-agent string`,
      ``,
      `## Why`,
      ``,
      `- To reply to you and to arrange, confirm and remind you about appointments`,
      `- To issue invoices and receipts, and to keep the records the law requires`,
      `- To understand which channels bring people here, in aggregate`,
      `- To send marketing email, and **only** where you have agreed to receive it`,
      ``,
      `## Marketing email`,
      ``,
      `Marketing messages are sent only to people who have explicitly agreed to them.`,
      `Agreeing is always optional and never a condition of booking, buying or being`,
      `replied to.`,
      ``,
      r.unsubscribeUrl
        ? `You can withdraw that agreement at any time, using the unsubscribe link in\nany marketing email or at ${r.unsubscribeUrl}. Withdrawing is as easy as\nagreeing was, and takes effect immediately.`
        : `You can withdraw that agreement at any time, using the unsubscribe link in\nany marketing email. Withdrawing is as easy as agreeing was, and takes effect\nimmediately.`,
      ``,
      `Withdrawing does not stop messages about something you have actually done:`,
      `booking confirmations, reminders, invoices and receipts will still reach you.`,
      ``,
      `## Who else sees it`,
      ``,
      `Personal information is not sold, and is not shared for anyone else's`,
      `marketing. It is handled on our behalf by the services that run this site:`,
      ``,
      processorList({
        Supabase: 'database and account hosting',
        Vercel: 'website and application hosting',
        Resend: 'sending email',
        Stripe: 'processing payments, where you pay online',
      }),
      ``,
      `It may also be disclosed where the law requires it.`,
      ``,
      `## How long it is kept`,
      ``,
      `Contact and appointment records are kept for as long as ${r.name} is working`,
      `with you, and afterwards for as long as tax and accounting rules require.`,
      `A record that you asked to stop receiving marketing email is kept`,
      `indefinitely: deleting it would mean emailing you again by mistake.`,
      ``,
      `## Your rights`,
      ``,
      `You can ask ${r.name} to:`,
      ``,
      `- Tell you what information is held about you, and give you a copy`,
      `- Correct anything inaccurate`,
      `- Delete your information, where there is no legal reason to keep it`,
      `- Stop using it for marketing, which takes effect immediately`,
      `- Restrict or object to other uses`,
      ``,
      `## Getting in touch`,
      ``,
      contactBlock(
        r,
        { email: 'Email', address: 'Postal address' },
        `Contact details are available on request.`
      ),
      ``,
      `---`,
      ``,
      `*This notice was generated from the information ${r.name} holds, and is a`,
      `starting point rather than legal advice. If your situation is unusual (you`,
      `handle health data, work with children, or operate across several countries),`,
      `have it reviewed.*`,
    ].join('\n'),

  he: (r) =>
    [
      `# הצהרת פרטיות`,
      ``,
      `${r.name} אוסף ומשתמש בפרטים אישיים כשאתם יוצרים קשר, קובעים תור, מבקשים`,
      `הצעת מחיר או משלמים על משהו. ההצהרה הזאת מסבירה מה נאסף, למה, ומה אתם יכולים`,
      `לבקש שייעשה עם זה.`,
      ``,
      `## מה נאסף`,
      ``,
      `- השם, כתובת המייל ומספר הטלפון שלכם, ככל שמסרתם אותם`,
      `- תוכן ההודעות והטפסים שאתם שולחים`,
      `- פרטי התור: השירות, התאריך והשעה, וכל הערה שהוספתם`,
      `- רשומות תשלום: סכומים, תאריכים וסטטוס. פרטי הכרטיס מטופלים אצל חברת הסליקה`,
      `  שלנו ואינם נשמרים אצל ${r.name} בשום שלב`,
      `- איך הגעתם: הדף שממנו באתם, ואם קיים, הקמפיין או הקישור שבעקבותיו הגעתם`,
      `- גיבוב חד-כיווני של כתובת ה-IP שלכם, שמשמש לספירת מבקרים בלי לזהות אותם,`,
      `  ומזהה הדפדפן שלכם`,
      ``,
      `## למה`,
      ``,
      `- כדי להשיב לכם, ולקבוע, לאשר ולהזכיר לכם על תורים`,
      `- כדי להפיק חשבוניות וקבלות, ולשמור את הרשומות שהחוק מחייב`,
      `- כדי להבין דרך אילו ערוצים אנשים מגיעים לכאן, במצטבר`,
      `- כדי לשלוח דיוור שיווקי, ו**רק** אם הסכמתם לקבל אותו`,
      ``,
      `## דיוור שיווקי`,
      ``,
      `הודעות שיווקיות נשלחות רק לאנשים שהסכימו להן במפורש. ההסכמה היא תמיד`,
      `אופציונלית, ואף פעם לא תנאי לקביעת תור, לרכישה או לקבלת תשובה.`,
      ``,
      r.unsubscribeUrl
        ? `אפשר לחזור מההסכמה בכל עת, דרך קישור ההסרה שמופיע בכל מייל שיווקי או\nבכתובת ${r.unsubscribeUrl}. ההסרה פשוטה בדיוק כמו ההסכמה, והיא נכנסת לתוקף\nמיד.`
        : `אפשר לחזור מההסכמה בכל עת, דרך קישור ההסרה שמופיע בכל מייל שיווקי. ההסרה\nפשוטה בדיוק כמו ההסכמה, והיא נכנסת לתוקף מיד.`,
      ``,
      `חזרה מההסכמה לא מפסיקה הודעות על משהו שאתם באמת עשיתם: אישורי תורים,`,
      `תזכורות, חשבוניות וקבלות ימשיכו להגיע אליכם.`,
      ``,
      `## מי עוד רואה את זה`,
      ``,
      `פרטים אישיים לא נמכרים, ולא משותפים לצורכי שיווק של אף אחד אחר. הם מטופלים`,
      `בשמנו על ידי השירותים שמריצים את האתר הזה:`,
      ``,
      processorList({
        Supabase: 'אירוח בסיס הנתונים והחשבונות',
        Vercel: 'אירוח האתר והאפליקציה',
        Resend: 'שליחת מייל',
        Stripe: 'סליקת תשלומים, כשמשלמים אונליין',
      }),
      ``,
      `ייתכן גם גילוי במקרים שהחוק מחייב.`,
      ``,
      `## כמה זמן זה נשמר`,
      ``,
      `רשומות של אנשי קשר ותורים נשמרות כל זמן ש-${r.name} עובד איתכם, ולאחר מכן`,
      `למשך הזמן שדיני המס וההנהלת חשבונות מחייבים. תיעוד של בקשה להפסיק לקבל דיוור`,
      `שיווקי נשמר ללא הגבלת זמן: מחיקה שלו הייתה אומרת לשלוח לכם מייל שוב בטעות.`,
      ``,
      `## הזכויות שלכם`,
      ``,
      `אתם יכולים לבקש מ-${r.name}:`,
      ``,
      `- לומר לכם איזה מידע מוחזק עליכם, ולתת לכם העתק`,
      `- לתקן כל דבר לא מדויק`,
      `- למחוק את המידע שלכם, כשאין סיבה חוקית לשמור אותו`,
      `- להפסיק להשתמש בו לשיווק, וזה נכנס לתוקף מיד`,
      `- להגביל שימושים אחרים או להתנגד להם`,
      ``,
      `## ליצירת קשר`,
      ``,
      contactBlock(
        r,
        { email: 'מייל', address: 'כתובת פיזית' },
        `פרטי יצירת קשר זמינים לפי בקשה.`
      ),
      ``,
      `---`,
      ``,
      `*ההצהרה הזאת נוצרה מהמידע שמוחזק אצל ${r.name}, והיא נקודת התחלה ולא ייעוץ`,
      `משפטי. אם המצב שלכם לא שגרתי (אתם מטפלים במידע רפואי, עובדים עם ילדים או`,
      `פועלים בכמה מדינות), כדאי שמישהו יעבור עליה.*`,
    ].join('\n'),

  es: (r) =>
    [
      `# Aviso de privacidad`,
      ``,
      `${r.name} recoge y utiliza datos personales cuando te pones en contacto, pides`,
      `una cita, solicitas un presupuesto o pagas algo. Este aviso explica qué se`,
      `recoge, para qué, y qué puedes pedirnos que hagamos con ello.`,
      ``,
      `## Qué se recoge`,
      ``,
      `- Tu nombre, correo electrónico y teléfono, cuando los facilitas`,
      `- El contenido de los mensajes y formularios que envías`,
      `- Los datos de la cita: el servicio, la fecha y la hora, y las notas que añadas`,
      `- Registros de pago: importes, fechas y estado. Los datos de la tarjeta los`,
      `  gestiona nuestra pasarela de pago y ${r.name} no los guarda nunca`,
      `- Cómo llegaste: la página de la que vienes y, si existe, la campaña o el`,
      `  enlace que seguiste`,
      `- Un hash unidireccional de tu dirección IP, usado para contar visitas sin`,
      `  identificar a nadie, y la cadena de tu navegador`,
      ``,
      `## Para qué`,
      ``,
      `- Para responderte y para concertar, confirmar y recordarte las citas`,
      `- Para emitir facturas y recibos, y conservar los registros que exige la ley`,
      `- Para entender, de forma agregada, por qué canales llega la gente`,
      `- Para enviar email de marketing, y **solo** si has aceptado recibirlo`,
      ``,
      `## Email de marketing`,
      ``,
      `Los mensajes de marketing se envían únicamente a quienes los han aceptado de`,
      `forma expresa. Aceptar es siempre opcional y nunca una condición para reservar,`,
      `comprar o recibir respuesta.`,
      ``,
      r.unsubscribeUrl
        ? `Puedes retirar esa aceptación en cualquier momento, con el enlace para darte de\nbaja incluido en cualquier email de marketing o en ${r.unsubscribeUrl}. Darse de\nbaja es tan fácil como aceptar, y surte efecto de inmediato.`
        : `Puedes retirar esa aceptación en cualquier momento, con el enlace para darte de\nbaja incluido en cualquier email de marketing. Darse de baja es tan fácil como\naceptar, y surte efecto de inmediato.`,
      ``,
      `Darse de baja no detiene los mensajes sobre algo que realmente has hecho:`,
      `las confirmaciones de cita, los recordatorios, las facturas y los recibos`,
      `seguirán llegándote.`,
      ``,
      `## Quién más lo ve`,
      ``,
      `Los datos personales no se venden ni se comparten para el marketing de nadie`,
      `más. Los tratan por cuenta nuestra los servicios que hacen funcionar este`,
      `sitio:`,
      ``,
      processorList({
        Supabase: 'alojamiento de la base de datos y de las cuentas',
        Vercel: 'alojamiento del sitio y de la aplicación',
        Resend: 'envío de correo',
        Stripe: 'procesamiento de pagos, cuando pagas en línea',
      }),
      ``,
      `También podrán comunicarse cuando la ley lo exija.`,
      ``,
      `## Cuánto tiempo se conservan`,
      ``,
      `Los registros de contacto y de citas se conservan mientras ${r.name} trabaje`,
      `contigo y, después, durante el tiempo que exijan las normas fiscales y`,
      `contables. La constancia de que pediste dejar de recibir email de marketing se`,
      `conserva indefinidamente: borrarla supondría volver a escribirte por error.`,
      ``,
      `## Tus derechos`,
      ``,
      `Puedes pedir a ${r.name}:`,
      ``,
      `- Que te diga qué información tiene sobre ti, y que te dé una copia`,
      `- Que corrija cualquier dato inexacto`,
      `- Que borre tu información, cuando no haya motivo legal para conservarla`,
      `- Que deje de usarla para marketing, lo que surte efecto de inmediato`,
      `- Que limite otros usos, o que atienda tu oposición a ellos`,
      ``,
      `## Cómo contactar`,
      ``,
      contactBlock(
        r,
        { email: 'Correo electrónico', address: 'Dirección postal' },
        `Los datos de contacto están disponibles si los solicitas.`
      ),
      ``,
      `---`,
      ``,
      `*Este aviso se ha generado a partir de la información que ${r.name} tiene, y es`,
      `un punto de partida, no asesoramiento legal. Si tu situación no es la habitual`,
      `(manejas datos de salud, trabajas con menores u operas en varios países),`,
      `conviene que alguien lo revise.*`,
    ].join('\n'),
};

/** The business's own name, per locale, when it has not given one. */
const UNNAMED: Record<PrivacyLocale, string> = {
  en: 'This business',
  he: 'העסק הזה',
  es: 'Este negocio',
};

/** Narrow whatever the caller passed to a locale we have prose for. */
export function privacyLocale(value?: string | null): PrivacyLocale {
  const key = (value || 'en').slice(0, 2).toLowerCase();
  return key === 'he' || key === 'es' ? key : 'en';
}

/**
 * Markdown, not HTML. The page renders it, the settings panel edits it as text,
 * and a business pasting it into their own site gets something portable.
 */
export function generatePrivacyPolicy(input: PrivacyPolicyInputs): string {
  const locale = privacyLocale(input.locale);

  return BODIES[locale]({
    name: input.businessName?.trim() || UNNAMED[locale],
    email: input.contactEmail?.trim() || undefined,
    address: input.postalAddress?.trim() || undefined,
    unsubscribeUrl: input.unsubscribeUrl?.trim() || undefined,
  });
}
