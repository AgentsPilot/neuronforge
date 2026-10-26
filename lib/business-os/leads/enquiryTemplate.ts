/**
 * Learn what a business's own form emails look like, then read one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS MEASURED AND NOT GUESSED
 *
 * A business that keeps its own website still gets its enquiries by email, and
 * every website builder lays that email out differently. Contact Form 7, Wix,
 * Squarespace and a hand-rolled `mailto:` agree on nothing — not the labels,
 * not the order, not whether it is text or an HTML table.
 *
 * So nothing here assumes a shape. During setup the owner points at ONE
 * enquiry; we then read the other recent messages from that same sender and
 * work the template out by comparing them. The lines that are identical in
 * every message are the labels. The parts that differ are the values. That is
 * measurement, not a guess, and it is why the setup screen can show the owner
 * what it would have filed before anything is switched on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SUBJECT IS TWO THINGS AT ONCE
 *
 * It identifies the email, and it often carries the name: "New enquiry from
 * Sarah Cohen". Those pull in opposite directions. Matching the whole subject
 * would match Sarah and silently miss every other enquiry forever — a failure
 * with no symptom, which is the worst kind. So the rule is the STABLE PREFIX
 * the samples share, and whatever follows it is read as the name.
 *
 * One sample cannot tell a fixed subject from a parameterised one. Several can,
 * which is the whole reason setup fetches the siblings rather than asking the
 * owner to tick three boxes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ADDRESS IS NEVER INVENTED
 *
 * `parseEnquiry` only ever returns an address that appears verbatim in the
 * message it was given. Everything this agent files is emailed to that address
 * fifteen minutes later by the unanswered-enquiry chase, so an address that
 * came from nowhere is a stranger receiving mail on the business's behalf. A
 * parse that cannot find one returns null and the caller leaves the message
 * unread for a human — loudly wrong beats quietly wrong.
 *
 * @module lib/business-os/leads/enquiryTemplate
 */

import { htmlToText } from '@/lib/email/htmlToText';

/** One message as the mailbox hands it over. */
export interface EnquirySample {
  subject?: string | null;
  /** Plain text where the provider gives it. */
  body?: string | null;
  /** HTML where that is all there is. Converted before anything reads it. */
  html?: string | null;
  /**
   * `Reply-To`, which on a form notification is usually the person who filled
   * the form in — that is what the header is FOR, so hitting reply reaches
   * them rather than the web server. The strongest signal there is, and
   * stated by the form plugin rather than inferred from prose.
   */
  replyTo?: string | null;
  /** `Cc`. Some form builders copy the enquirer instead of setting Reply-To. */
  cc?: string | null;
  /**
   * The address the notification came FROM — `info@`, `forms@`, a WordPress
   * host. Never the lead, and passed in so it can be EXCLUDED: without it the
   * fallback scan of the body happily returns the business's own address out
   * of a signature and files the business as its own customer.
   */
  from?: string | null;
  /** The mailbox owner's own address, excluded for the same reason. */
  owner?: string | null;
}

export interface EnquiryTemplate {
  /**
   * What every sample's subject starts with. The matching rule, and never the
   * whole subject — see the note above.
   */
  subjectPrefix: string;
  /**
   * True when the subjects differ after the prefix, which is what a
   * parameterised subject looks like. Then the tail is read as the name.
   */
  nameFollowsSubject: boolean;
  /**
   * The labels, in the order they appear: `['Name', 'Email', 'Message']`.
   * Derived from the lines every sample shares.
   */
  labels: string[];
  /** How many messages this was learned from. One is a guess; several is not. */
  learnedFrom: number;
}

/**
 * HOW a value was obtained, which decides whether it can be trusted over a
 * model's reading of the same message.
 *
 * `reply_to` and `label` are the form STATING what a value is. `cc`,
 * `subject` and `body_scan` are us inferring it, and inference is exactly
 * where the rules kept being wrong: a footer address, a campaign name read as
 * a person, a separator line read as a message.
 *
 * Without this the merge could only ask "did the rules return something",
 * which treats a labelled field and a guess as equally good and leaves a
 * confident wrong answer standing.
 */
export type FieldSource = 'reply_to' | 'label' | 'cc' | 'subject' | 'body_scan' | 'leftover';

export interface ParsedEnquiry {
  /** Verbatim from the message. Never inferred, never corrected. */
  email: string;
  name: string | null;
  message: string | null;
  /** From a labelled field only. Null when the form did not ask. */
  phone: string | null;
  /** Where each value came from. Absent keys mean no value was found. */
  sources: {
    email: FieldSource;
    name?: FieldSource;
    message?: FieldSource;
    phone?: FieldSource;
  };
}

/** A value the form STATED, as opposed to one we inferred. */
export function isStated(source: FieldSource | undefined): boolean {
  return source === 'reply_to' || source === 'label';
}

/**
 * An address: loose enough for real mail, tight enough to be an address.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ASCII ONLY, AND THAT IS THE POINT
 *
 * The character classes excluded whitespace and punctuation but allowed every
 * letter of every script, so a label touching its value was swallowed whole.
 * A real Hebrew enquiry — label and value in adjacent table cells, run
 * together by the HTML conversion — produced
 * `אימיילasafomer06@icloud.com`, and the verbatim check below PASSED, because
 * that glued string genuinely is in the text. It would have been filed as a
 * lead and then emailed, and it can never receive mail.
 *
 * An email local part is ASCII (anything else needs SMTPUTF8, which no form
 * builder emits), so restricting both sides to ASCII ends the whole class:
 * the Hebrew stops the match and the address begins where it really begins.
 * The same applies to Arabic, Greek, Cyrillic and CJK labels.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ADDRESS = /[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/i;
const ADDRESS_GLOBAL = new RegExp(ADDRESS.source, 'gi');

/** `Label: value`, with the label short enough not to be a sentence. */
const LABEL_LINE = /^\s*([^\s:][^:]{0,40}?)\s*:\s*(.*)$/;

/**
 * Markup in something a provider called the plain body.
 *
 * Two markers rather than one `<`: a form email that reads "price < 100" is
 * not HTML, and a closing tag or a tag with an attribute is.
 */
const LOOKS_LIKE_HTML = /<\/[a-z][a-z0-9]*\s*>|<[a-z][a-z0-9]*\s[^>]*>|<!doctype/i;

/**
 * Text, whatever the provider gave us.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `body` IS NOT RELIABLY PLAIN TEXT
 *
 * This used to trust it: a non-empty `body` was returned as-is and only an
 * empty one fell through to the HTML. Both mail plugins hand back the body
 * they were given, and a message sent as HTML alone has its markup in that
 * field — so for real mail from a real mailbox, every line of it reached the
 * label detector. Run against ten live messages, the "labels" learned from
 * them came out as `style="border`, `<td style="padding` and
 * `align="center" style="font-size`, which is what the setup screen would
 * then have shown the owner as the fields it reads from their enquiries.
 *
 * So the shape decides, not the field name.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function textOf(sample: EnquirySample): string {
  const plain = (sample.body ?? '').trim();
  if (plain && !LOOKS_LIKE_HTML.test(plain)) return plain;
  /* Prefer the field that is declared as HTML; fall back to the body that
     turned out to be some. */
  const markup = (sample.html ?? '').trim() || plain;
  return htmlToText(markup).trim();
}

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
}

/**
 * The fixed label at the start of a single subject, or the whole of it.
 *
 * `התעניינות: ‹campaign›` yields `התעניינות:`; `New inquiry from your website`
 * has no delimiter and is kept whole, which is correct because it IS fixed.
 */
function labelPrefix(subject: string): string {
  const trimmed = subject.trim();
  /* Early only: a dash halfway through a sentence is punctuation, not a
     field separator. */
  const match = trimmed.slice(0, 48).match(/^(.{3,}?)\s*([:|»>]|[-–—])\s+/);
  if (!match) return trimmed;

  const label = match[1].trim();

  /* "Re:", "Fwd:" and their translations are REPLY markers, not form labels.
     Cutting there would match every reply the sender ever sends. */
  if (/^(re|fw|fwd|aw|sv|vs|antw|תשובה|הועבר)$/i.test(label)) return trimmed;

  /* A label that is itself an address or a number is not a label. */
  if (ADDRESS.test(label) || /^\d+$/.test(label)) return trimmed;

  /*
   * Sliced from the ORIGINAL, not rebuilt from the captured groups.
   * Rebuilding dropped the space a subject may carry before its delimiter, so
   * "Contact form - new submission" produced the prefix "Contact form-", which
   * `startsWith` then matched against nothing at all. The prefix is a literal
   * piece of the real subject, so it is taken as one.
   */
  return match[0].trimEnd();
}

/** The longest start that every string shares, trimmed to a word boundary. */
function commonPrefix(values: string[]): string {
  if (values.length === 0) return '';
  let prefix = values[0];
  for (const value of values.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < value.length && prefix[i] === value[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  /*
   * Cut back to a whole word ONLY when we actually stopped mid-word.
   *
   * "New enquiry from Sa" is the dangerous kind of prefix — it matches today's
   * sample and nobody else — so it is trimmed to "New enquiry from". But when
   * every subject is identical, or they diverge exactly at a space, the prefix
   * is already whole and trimming it would throw away a real word: a fixed
   * "New inquiry from your website" became "New inquiry from your", and the
   * leftover "website" was then read as the enquirer's name.
   */
  const stoppedMidWord = values.some(
    value => value.length > prefix.length && !/\s/.test(value[prefix.length])
  );

  return (stoppedMidWord ? prefix.replace(/\S*$/, '') : prefix).trim();
}

/**
 * Work out the template from the owner's own messages.
 *
 * Give it every recent message from the sender they picked. One sample still
 * works — the subject is then taken whole and the labels come from that single
 * message — but `learnedFrom` says so, and the setup screen should show the
 * owner what it concluded either way.
 */
export function deriveEnquiryTemplate(samples: EnquirySample[]): EnquiryTemplate | null {
  const usable = samples.filter(s => textOf(s) || (s.subject ?? '').trim());
  if (usable.length === 0) return null;

  const subjects = usable.map(s => (s.subject ?? '').trim()).filter(Boolean);

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * ONE SAMPLE: CUT AT THE LABEL, DO NOT SWALLOW THE WHOLE SUBJECT.
   *
   * With several samples the stable part is measured. With ONE there is
   * nothing to compare, and this took the subject whole — which is the normal
   * case at setup, because an owner connects the channel the day their first
   * enquiry arrives.
   *
   * On a real form that produced the rule "subject starts with: התעניינות:
   * הרצאה על התארגנות בוקר רגועה ויעילה אוקטובר 2026" — the campaign name
   * included. It matches that one lecture and silently misses every enquiry
   * about anything else, forever. Silent misses are the worst failure this
   * module has: the owner sees a channel that is running and no leads.
   *
   * Form subjects are overwhelmingly `‹fixed label›‹delimiter›‹variable›`, so
   * a delimiter near the start is strong evidence of where the fixed part
   * ends. Guarded, because cutting "Re:" off a reply would produce a rule
   * matching every reply that sender ever writes: the label must be a real
   * word and must not be a mail prefix.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const subjectPrefix =
    subjects.length > 1 ? commonPrefix(subjects) : labelPrefix(subjects[0] ?? '');
  const nameFollowsSubject =
    subjects.length > 1 &&
    subjectPrefix.length > 0 &&
    subjects.some(s => s.slice(subjectPrefix.length).trim().length > 0);

  /*
   * The labels are the lines every message shares. A line that reads
   * `Email: sarah@…` differs between messages, so the LABEL is what is
   * compared, never the whole line.
   */
  const labelSets = usable.map(s => {
    const found: string[] = [];
    for (const line of lines(textOf(s))) {
      const m = line.match(LABEL_LINE);
      if (m) found.push(m[1].trim());
    }
    return found;
  });

  const first = labelSets[0] ?? [];
  const labels = first
    .filter(label =>
      labelSets.every(set => set.some(l => l.toLowerCase() === label.toLowerCase()))
    )
    /* Nothing that is really markup. `textOf` strips HTML now, so this should
       never fire — but a label is shown to the owner as the name of a field we
       read from their enquiries, and `style="border` must not be one of them
       however it got here. */
    .filter(label => !/[<>="]/.test(label));

  /*
   * NOTHING TO RECOGNISE IS NOT A TEMPLATE.
   *
   * No shared labels and no stable subject means these messages have nothing
   * in common beyond their sender, so there is no rule that distinguishes an
   * enquiry from anything else that sender writes — and `parseEnquiry` would
   * fall back to "the first address anywhere in the body". Run against a real
   * mailbox that is exactly what happened: a notifications sender with ten
   * unrelated messages produced a template, and the one address it found was
   * the OWNER'S OWN, which would have been filed as a lead and then emailed a
   * booking link.
   *
   * Refusing here is what the derive route turns into "pick one that came
   * from your website form", which is both true and actionable.
   */
  if (labels.length === 0 && !subjectPrefix) return null;

  return {
    subjectPrefix,
    nameFollowsSubject,
    labels,
    learnedFrom: usable.length,
  };
}

/** Which label is likely to hold what, by the words businesses actually use. */
const EMAIL_WORDS = /mail|דוא|אימייל|correo|e-?mail/i;
const NAME_WORDS = /name|שם|nombre/i;
/**
 * The SURNAME half, when a form splits the name in two.
 *
 * Real forms very often do: a live Elementor form sends `שם: אסנת` and
 * `שם משפחה: גורן` as separate fields. Both match NAME_WORDS, so taking the
 * first match filed the contact as "אסנת" and threw the family name away.
 */
const LAST_NAME_WORDS = /last\s*name|family|surname|משפחה|apellido/i;
const MESSAGE_WORDS = /message|comment|enquir|inquir|question|הודעה|mensaje|detail/i;
/** Phone, for the forms that ask. A lead with a number is worth more than one without. */
const PHONE_WORDS = /phone|mobile|tel|טלפון|נייד|tel[eé]fono|m[oó]vil/i;

/**
 * Read one message using a template learned from its siblings.
 *
 * Returns null when there is no address to answer — which is not an error, it
 * is this function refusing to invent one. The caller leaves such a message
 * unread so a person sees it.
 */
export function parseEnquiry(
  sample: EnquirySample,
  template?: EnquiryTemplate | null
): ParsedEnquiry | null {
  const text = textOf(sample);
  const subject = (sample.subject ?? '').trim();
  if (!text && !subject) return null;

  const fields = new Map<string, string>();
  const unlabelled: string[] = [];

  for (const line of lines(text)) {
    const m = line.match(LABEL_LINE);
    if (m) {
      const label = m[1].trim();
      const value = m[2].trim();
      /* A label we have seen before keeps its FIRST value: quoted replies
         repeat the whole message underneath, and the copy is not the enquiry. */
      if (!fields.has(label.toLowerCase())) fields.set(label.toLowerCase(), value);
    } else {
      unlabelled.push(line);
    }
  }

  const byWords = (words: RegExp, accept?: (label: string) => boolean): string | null => {
    const known = template?.labels ?? [...fields.keys()];
    for (const label of known) {
      if (!words.test(label)) continue;
      if (accept && !accept(label)) continue;
      const value = fields.get(label.toLowerCase());
      if (value) return value;
    }
    return null;
  };

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * THE CLIENT'S ADDRESS IS NOT THE SENDER'S.
   *
   * A form notification comes FROM the business or its web host — `info@`,
   * `support@`, `forms@`, `wordpress@` — and the person who wrote in is
   * somewhere else entirely. Four places, in order of how much they can be
   * trusted:
   *
   *   1. `Reply-To`. Stated by the form plugin precisely so that hitting
   *      reply reaches the enquirer. Nobody writes that header by accident,
   *      which makes it the strongest evidence available.
   *   2. A labelled field in the body — `Email: …`, `אימייל …`.
   *   3. `Cc`, when exactly one address is copied. Builders that do not set
   *      Reply-To often copy the enquirer instead. More than one and we
   *      cannot tell which is the client, so we do not guess.
   *   4. The first address in the body, which is the old behaviour and the
   *      weakest: a signature or a privacy-policy link can win it.
   *
   * And throughout: NEVER the sender, never the mailbox owner. Without that
   * exclusion the fallback happily returns `info@thebusiness.com` out of the
   * footer and files the business as its own customer — which then emails
   * itself a booking link.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const excluded = new Set(
    [sample.from, sample.owner]
      .flatMap(v => (v ?? '').match(ADDRESS_GLOBAL) ?? [])
      .map(a => a.toLowerCase())
  );
  const usable = (value: string | null | undefined): string | null => {
    const found = (value ?? '').match(ADDRESS_GLOBAL) ?? [];
    const first = found.find(a => !excluded.has(a.toLowerCase()));
    return first ?? null;
  };

  const ccAddresses = (sample.cc ?? '').match(ADDRESS_GLOBAL) ?? [];
  const bodyAddresses = (text.match(ADDRESS_GLOBAL) ?? []).filter(
    a => !excluded.has(a.toLowerCase())
  );

  let emailSource: FieldSource = 'body_scan';
  let candidate = usable(sample.replyTo);
  if (candidate) emailSource = 'reply_to';

  if (!candidate) {
    candidate = usable(byWords(EMAIL_WORDS));
    if (candidate) emailSource = 'label';
  }
  if (!candidate && ccAddresses.length === 1) {
    candidate = usable(sample.cc);
    if (candidate) emailSource = 'cc';
  }
  if (!candidate) {
    candidate = bodyAddresses[0] ?? null;
    emailSource = 'body_scan';
  }

  if (!candidate) return null;

  /*
   * The verbatim rule, widened to the whole message rather than only its body.
   *
   * An address may now legitimately come from a header the body never
   * mentions — which is the normal case for Reply-To — so "it must be in the
   * text" would have thrown away the best source we have. It must still be
   * somewhere in what the mailbox actually handed us, and never assembled,
   * corrected or inferred.
   */
  const everything = [text, sample.subject ?? '', sample.replyTo ?? '', sample.cc ?? ''].join('\n');
  if (!everything.includes(candidate)) return null;

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * THE NAME. A LABELLED FIELD BEATS THE SUBJECT, ALWAYS.
   *
   * This took the subject tail first, on the reasoning that "New enquiry from
   * Sarah Cohen" is steadier than a body whose layout drifts. That holds only
   * for subjects that carry a person, and plenty do not. A live Elementor form
   * sends `התעניינות: הרצאה על התארגנות בוקר רגועה ויעילה אוקטובר 2026` — the
   * prefix is "התעניינות:" and the tail is the LECTURE being enquired about.
   * The contact was filed under the name of a seminar while `שם: אסנת` and
   * `שם משפחה: גורן` sat labelled in the body, ignored.
   *
   * A label is the form telling us what a value is. The subject tail is us
   * inferring. The statement wins, and the inference is the fallback.
   *
   * Both halves are joined when the form splits them, which is common.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const firstName = byWords(NAME_WORDS, label => !LAST_NAME_WORDS.test(label));
  const lastName = byWords(LAST_NAME_WORDS);
  let name = [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  let nameSource: FieldSource | undefined = name ? 'label' : undefined;

  if (!name && template?.nameFollowsSubject && template.subjectPrefix && subject.startsWith(template.subjectPrefix)) {
    const tail = subject.slice(template.subjectPrefix.length).trim();
    if (tail && !ADDRESS.test(tail)) {
      name = tail;
      nameSource = 'subject';
    }
  }
  /* Never a name that is really an address: "Name: sarah@x.com" is an address
     in the wrong box, and filing it as a name puts it in front of the owner
     as a person called sarah@x.com. */
  if (name && ADDRESS.test(name)) {
    name = null;
    nameSource = undefined;
  }

  /*
   * ─────────────────────────────────────────────────────────────────────────
   * THE MESSAGE, AND WHEN THERE SIMPLY IS NOT ONE.
   *
   * The leftover-prose fallback exists for plain emails that label nothing. On
   * a STRUCTURED form it is actively harmful: a live Elementor form has no
   * message field at all, and the leftover was the separator line, so the
   * contact's first message read `---`. Other runs would file a user-agent
   * string or an IP address.
   *
   * So the fallback applies only when the form labelled nothing. A form that
   * labels its fields and has no message field did not collect one, and the
   * honest answer is none — the owner can see the enquiry on the timeline
   * either way.
   * ─────────────────────────────────────────────────────────────────────────
   */
  let message = byWords(MESSAGE_WORDS);
  let messageSource: FieldSource | undefined = message ? 'label' : undefined;
  const structured = (template?.labels.length ?? fields.size) > 0;
  if (!message && !structured) {
    const leftover = unlabelled
      .filter(l => !ADDRESS_GLOBAL.test(l))
      .join('\n')
      .trim();
    message = leftover || null;
    if (message) messageSource = 'leftover';
  }

  /* The phone, when the form asked for one. Nothing is inferred: it is the
     value of a labelled field or it is absent. */
  const phone = byWords(PHONE_WORDS);

  const trimmedName = name?.trim() || null;
  const trimmedMessage = message?.trim() || null;
  const trimmedPhone = phone?.trim() || null;

  return {
    email: candidate,
    name: trimmedName,
    message: trimmedMessage,
    phone: trimmedPhone,
    sources: {
      email: emailSource,
      ...(trimmedName ? { name: nameSource } : {}),
      ...(trimmedMessage ? { message: messageSource } : {}),
      ...(trimmedPhone ? { phone: 'label' as const } : {}),
    },
  };
}
