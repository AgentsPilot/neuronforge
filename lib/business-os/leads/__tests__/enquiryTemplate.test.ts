/**
 * Reading a business's own form emails.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The fixtures are the point. Every website builder lays these out differently,
 * and the module exists because nothing may be assumed about the shape — so the
 * cases below are the real ones: a labelled plain-text form, an HTML table, a
 * subject carrying the name, a form with no message label at all, and the
 * quoted reply that repeats the whole enquiry underneath itself.
 *
 * The rule that must never bend: an address is returned only if it appears
 * verbatim in the message. Everything filed here is emailed to that address
 * fifteen minutes later, so an invented one writes to a stranger.
 */

import { deriveEnquiryTemplate, isStated, parseEnquiry } from '../enquiryTemplate';

/** Contact Form 7 / a hand-rolled mailto: labelled plain text. */
const cf7 = (name: string, email: string, msg: string) => ({
  subject: 'New inquiry from your website',
  body: `Name: ${name}\nEmail: ${email}\nMessage: ${msg}\n\n--\nSent from my-clinic.co.il`,
});

/** A builder that puts the name in the subject. */
const named = (name: string, email: string, msg: string) => ({
  subject: `New enquiry from ${name}`,
  body: `Email: ${email}\nMessage: ${msg}`,
});

describe('learning the template from the owner’s own mail', () => {
  it('takes the stable part of the subject, not the whole of it', () => {
    /*
     * The failure this prevents has no symptom: matching the whole subject
     * matches the one person in the sample and silently misses every enquiry
     * after them, forever.
     */
    const t = deriveEnquiryTemplate([
      named('Sarah Cohen', 'sarah@x.com', 'Hello'),
      named('Dana Levi', 'dana@x.com', 'Hi'),
      named('Yossi Ben-Ami', 'yossi@x.com', 'Hey'),
    ])!;

    expect(t.subjectPrefix).toBe('New enquiry from');
    expect(t.nameFollowsSubject).toBe(true);
  });

  it('keeps a fixed subject whole, and does not read a name out of it', () => {
    const t = deriveEnquiryTemplate([
      cf7('Sarah Cohen', 'sarah@x.com', 'Hello'),
      cf7('Dana Levi', 'dana@x.com', 'Hi'),
    ])!;

    expect(t.subjectPrefix).toBe('New inquiry from your website');
    expect(t.nameFollowsSubject).toBe(false);
  });

  it('cuts a prefix back to a whole word', () => {
    /* Two names sharing letters — "Sa"/"Sam" — must not leave the prefix
       mid-word, which would match one person and nobody else. */
    const t = deriveEnquiryTemplate([
      named('Sarah', 'sarah@x.com', 'a'),
      named('Samuel', 'samuel@x.com', 'b'),
    ])!;

    expect(t.subjectPrefix).toBe('New enquiry from');
  });

  it('keeps only the labels every message shares', () => {
    const t = deriveEnquiryTemplate([
      { subject: 'New inquiry', body: 'Name: A\nEmail: a@x.com\nMessage: hi' },
      /* This one also carries a phone; one message having it does not make it
         part of the template. */
      { subject: 'New inquiry', body: 'Name: B\nEmail: b@x.com\nPhone: 123\nMessage: yo' },
    ])!;

    expect(t.labels).toEqual(['Name', 'Email', 'Message']);
    expect(t.learnedFrom).toBe(2);
  });

  it('says how many it learned from, because one is a guess', () => {
    const one = deriveEnquiryTemplate([cf7('Sarah', 'sarah@x.com', 'Hello')])!;
    expect(one.learnedFrom).toBe(1);
    /* Nothing to compare, so the subject is taken whole — the narrow
       direction, which fails visibly rather than filing non-enquiries. */
    expect(one.subjectPrefix).toBe('New inquiry from your website');
  });

  it('returns null when there is nothing to learn from', () => {
    expect(deriveEnquiryTemplate([])).toBeNull();
    expect(deriveEnquiryTemplate([{ subject: '', body: '' }])).toBeNull();
  });
});

describe('reading one enquiry', () => {
  const template = deriveEnquiryTemplate([
    cf7('Sarah Cohen', 'sarah@x.com', 'Hello'),
    cf7('Dana Levi', 'dana@x.com', 'Hi'),
  ]);

  it('reads a labelled plain-text form', () => {
    const got = parseEnquiry(cf7('Sarah Cohen', 'sarah@example.com', 'I would like a consultation.'), template);

    expect(got).toEqual({
      email: 'sarah@example.com',
      name: 'Sarah Cohen',
      message: 'I would like a consultation.',
      /* CF7's fixture has no phone field; a form that does not ask gets null
         rather than a guess. */
      phone: null,
      /* Where each value came from, which decides whether the model is asked
         about it at all. All three are labelled fields here, so none is. */
      sources: { email: 'label', name: 'label', message: 'label' },
    });
  });

  it('reads an HTML table, because some builders send only that', () => {
    const got = parseEnquiry(
      {
        subject: 'New inquiry from your website',
        html:
          '<table><tr><td>Name:</td><td>Dana Levi</td></tr>' +
          '<tr><td>Email:</td><td>dana@example.com</td></tr>' +
          '<tr><td>Message:</td><td>Do you work with teenagers?</td></tr></table>',
      },
      template
    );

    expect(got?.email).toBe('dana@example.com');
  });

  it('takes the name from the subject when the template says it is there', () => {
    const t = deriveEnquiryTemplate([
      named('Sarah Cohen', 'sarah@x.com', 'a'),
      named('Dana Levi', 'dana@x.com', 'b'),
    ])!;

    const got = parseEnquiry(named('Yossi Ben-Ami', 'yossi@example.com', 'Hello'), t);

    expect(got?.name).toBe('Yossi Ben-Ami');
    expect(got?.email).toBe('yossi@example.com');
  });

  it('ignores the quoted copy underneath a reply', () => {
    /* A forwarded or replied-to enquiry repeats itself. The copy is not a
       second enquiry, and the first value is the real one. */
    const got = parseEnquiry(
      {
        subject: 'Re: New inquiry from your website',
        body:
          'Name: Sarah Cohen\nEmail: sarah@example.com\nMessage: First\n\n' +
          '> Name: Someone Else\n> Email: other@example.com\n> Message: Second',
      },
      template
    );

    expect(got?.email).toBe('sarah@example.com');
    expect(got?.name).toBe('Sarah Cohen');
  });

  it('still finds an address when the form uses no labels at all', () => {
    const got = parseEnquiry(
      { subject: 'Website enquiry', body: 'Hi, please call me about therapy. reach me at dana@example.com' },
      null
    );

    expect(got?.email).toBe('dana@example.com');
  });

  it('never reports a name that is really an address', () => {
    /* "Name: sarah@x.com" would otherwise put a person called sarah@x.com in
       front of the owner. */
    const got = parseEnquiry(
      { subject: 'New inquiry', body: 'Name: sarah@example.com\nEmail: sarah@example.com\nMessage: hi' },
      template
    );

    expect(got?.name).toBeNull();
    expect(got?.email).toBe('sarah@example.com');
  });
});

describe('the rule that stops a stranger being emailed', () => {
  it('returns nothing when there is no address to answer', () => {
    /* Not an error — a refusal. The caller leaves the message unread so a
       person looks at it. */
    expect(
      parseEnquiry({ subject: 'New inquiry from your website', body: 'Name: Sarah\nMessage: call me' }, null)
    ).toBeNull();
  });

  it('only ever returns an address that is in the message, verbatim', () => {
    const got = parseEnquiry(
      { subject: 'New inquiry', body: 'Name: Sarah\nEmail: sarah@example.com\nMessage: hi' },
      null
    );

    expect(got).not.toBeNull();
    expect('Name: Sarah\nEmail: sarah@example.com\nMessage: hi').toContain(got!.email);
  });

  it('refuses an autoresponder, a bounce and a newsletter', () => {
    /* None of these is a person waiting for a reply, and each would otherwise
       be filed as a lead and emailed fifteen minutes later. */
    expect(parseEnquiry({ subject: 'Out of office', body: 'I am away until Monday.' }, null)).toBeNull();
    expect(
      parseEnquiry({ subject: 'Delivery Status Notification (Failure)', body: 'Your message could not be delivered.' }, null)
    ).toBeNull();
    expect(
      parseEnquiry({ subject: 'Your campaign report', body: 'Opens: 42\nClicks: 7\nUnsubscribes: 1' }, null)
    ).toBeNull();
  });
});

/**
 * What a real mailbox did, which no synthetic fixture had caught.
 *
 * Both of these were found by pointing `deriveFromSender` at live senders in a
 * real Gmail account during setup verification on 2026-10-25. Each produced a
 * confident, usable-looking template out of mail that was not an enquiry.
 */
describe('what the live mailbox taught us', () => {
  /**
   * A message sent as HTML only. Gmail hands the markup back in `body`, not in
   * `html` — so the field name proves nothing about the shape.
   */
  const htmlInBody = (email: string) => ({
    subject: 'A task was assigned to you',
    body:
      '<div style="margin:0"><table style="width:100%"><tr>' +
      `<td align="center" style="font-size:14px">Reply to ${email}</td>` +
      '</tr></table></div>',
  });

  it('converts markup that arrived in the plain-text field', () => {
    /*
     * This is the bug exactly as it ran: ten live messages produced labels of
     * `style="border`, `<td style="padding` and `align="center" style="font-size`
     * — and the setup screen shows the owner those labels as the fields it
     * reads from their enquiries.
     */
    const t = deriveEnquiryTemplate([
      { subject: 'New inquiry from your website', body: '<p>Name: Sarah Cohen</p><p>Email: sarah@x.com</p>' },
      { subject: 'New inquiry from your website', body: '<p>Name: Dana Levi</p><p>Email: dana@x.com</p>' },
    ])!;

    expect(t.labels).toEqual(['Name', 'Email']);
    expect(t.labels.some(label => /[<>="]/.test(label))).toBe(false);
  });

  it('refuses a sender whose messages share nothing', () => {
    /*
     * No shared label and no stable subject means no rule separates an enquiry
     * from anything else that sender writes. Against a real notifications
     * sender this returned a template, and the only address in the body was
     * the OWNER'S OWN — which would have been filed as a lead and then sent a
     * booking link.
     */
    expect(
      deriveEnquiryTemplate([
        htmlInBody('one@x.com'),
        { subject: 'Weekly specials!', body: '<div style="padding:4px">Buy things</div>' },
        { subject: 'How did we do?', body: '<span style="color:red">Rate us</span>' },
      ])
    ).toBeNull();
  });
});

/**
 * An address must not absorb the label touching it.
 *
 * Found on a real Hebrew enquiry on 2026-10-25: the form email put the label
 * and the value in adjacent table cells, the HTML conversion ran them together
 * with no separator, and the parse returned `אימיילasafomer06@icloud.com`.
 * The verbatim rule did not catch it — that glued string IS in the text — so
 * it would have been filed as a lead and then emailed, at an address no mail
 * server can deliver to.
 */
describe('an address stops where the address stops', () => {
  const GLUED = 'פרטי הפנייה\nשםAsaf Omer\nאימיילasafomer06@icloud.com\nטלפון050';

  it('does not swallow a Hebrew label touching the address', () => {
    const parsed = parseEnquiry({ subject: 'פנייה חדשה', body: GLUED }, null)!;
    expect(parsed.email).toBe('asafomer06@icloud.com');
  });

  it.each([
    ['Hebrew', 'אימייל'],
    ['Arabic', 'البريد'],
    ['Cyrillic', 'Почта'],
    ['CJK', 'メール'],
  ])('nor a %s one', (_script, label) => {
    const parsed = parseEnquiry({ subject: 'x', body: `${label}sarah@example.com` }, null)!;
    expect(parsed.email).toBe('sarah@example.com');
  });

  it('still reads an ordinary separated address', () => {
    const parsed = parseEnquiry(
      { subject: 'x', body: 'Name: Sarah Cohen\nEmail: sarah@example.com' },
      null
    )!;
    expect(parsed.email).toBe('sarah@example.com');
    expect(parsed.name).toBe('Sarah Cohen');
  });
});

/**
 * Whose address is the lead's.
 *
 * A form notification comes FROM the business or its web host and is ABOUT
 * somebody else. Getting this backwards files the business as its own customer
 * and then emails it a booking link, which is both wrong and visible to
 * nobody — the row looks like any other lead.
 */
describe('the client is not the sender', () => {
  const BUSINESS = 'info@my-clinic.co.il';
  const OWNER = 'owner@my-clinic.co.il';

  it('prefers Reply-To, which is where form plugins put the enquirer', () => {
    const parsed = parseEnquiry(
      {
        subject: 'New enquiry from your website',
        body: `Somebody wrote in.\nReply to them or visit ${BUSINESS}`,
        replyTo: 'Sarah Cohen <sarah@example.com>',
        from: `My Clinic <${BUSINESS}>`,
        owner: OWNER,
      },
      null
    )!;

    expect(parsed.email).toBe('sarah@example.com');
  });

  it('never returns the sender, even when it is the only address in the body', () => {
    expect(
      parseEnquiry(
        {
          subject: 'New enquiry',
          body: `A new enquiry arrived. Manage it at ${BUSINESS}`,
          from: BUSINESS,
          owner: OWNER,
        },
        null
      )
    ).toBeNull();
  });

  it('takes a single Cc when there is no Reply-To and no labelled field', () => {
    const parsed = parseEnquiry(
      {
        subject: 'Website enquiry',
        body: 'Someone is interested.',
        cc: 'dana@example.com',
        from: BUSINESS,
        owner: OWNER,
      },
      null
    )!;

    expect(parsed.email).toBe('dana@example.com');
  });

  it('refuses to guess between two Cc addresses', () => {
    expect(
      parseEnquiry(
        {
          subject: 'Website enquiry',
          body: 'Someone is interested.',
          cc: 'dana@example.com, yossi@example.com',
          from: BUSINESS,
          owner: OWNER,
        },
        null
      )
    ).toBeNull();
  });

  it('still prefers a labelled body field over a Cc', () => {
    const parsed = parseEnquiry(
      {
        subject: 'Website enquiry',
        body: 'Name: Sarah Cohen\nEmail: sarah@example.com',
        cc: 'accounts@my-clinic.co.il',
        from: BUSINESS,
        owner: OWNER,
      },
      null
    )!;

    expect(parsed.email).toBe('sarah@example.com');
  });
});

/**
 * A real Elementor form, from a live WordPress site (2026-10-25).
 *
 * The shape most external websites actually send, and the one that exposed
 * two defects no synthetic fixture had: the subject carries the CAMPAIGN
 * rather than the person, and the form collects no message at all.
 */
describe('a real WordPress / Elementor enquiry', () => {
  const elementor = (subject: string, first: string, last: string, email: string) => ({
    subject,
    from: 'info@internationalparentingschool.com',
    body: [
      `שם: ${first}`,
      `שם משפחה: ${last}`,
      `אימייל: ${email}`,
      'טלפון: 2017273840',
      'מדינה: United States',
      'utm_campaign:',
      'אישור דיוור: on',
      '',
      '---',
      '',
      'תאריך: אוקטובר 21, 2026',
      'קישור לעמוד: https://iparentingschool.com/morning-routine-oct-2026/#contact',
      'פרטי משתמש: Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)',
      'IP השולח: 68.193.123.26',
      'מופעל באמצעות: אלמנטור',
    ].join('\n'),
  });

  const samples = [
    elementor('התעניינות: הרצאה על התארגנות בוקר רגועה ויעילה אוקטובר 2026', 'אסנת', 'גורן', 'osnat.gorren@gmail.com'),
    elementor('התעניינות: סדנת הורות נובמבר 2026', 'דנה', 'לוי', 'dana@example.com'),
  ];

  const template = deriveEnquiryTemplate(samples)!;

  it('joins a name the form split in two, rather than keeping half', () => {
    expect(parseEnquiry(samples[0], template)!.name).toBe('אסנת גורן');
  });

  it('never names the contact after the campaign in the subject', () => {
    /*
     * The prefix here is "התעניינות:" and the tail is the LECTURE. Taking the
     * subject tail filed a contact called
     * "הרצאה על התארגנות בוקר רגועה ויעילה אוקטובר 2026".
     */
    const name = parseEnquiry(samples[0], template)!.name!;
    expect(name).not.toContain('הרצאה');
    expect(name).not.toContain('2026');
  });

  it('reads the enquirer, never the business that sent the notification', () => {
    expect(parseEnquiry(samples[0], template)!.email).toBe('osnat.gorren@gmail.com');
  });

  it('takes the phone the form collected', () => {
    expect(parseEnquiry(samples[0], template)!.phone).toBe('2017273840');
  });

  it('leaves the message empty when the form collects none', () => {
    /* It used to file the separator line, `---`, as the client's first
       message; other runs would have filed a user-agent string or an IP. */
    expect(parseEnquiry(samples[0], template)!.message).toBeNull();
  });
});

/**
 * Where each value came from, which is what decides whether a model is asked.
 *
 * `captureEnquiryFromEmail` consults the extractor whenever a value was
 * INFERRED rather than STATED. Getting these labels wrong is expensive in both
 * directions: too strict and every enquiry pays for a model call it did not
 * need; too loose and a confident wrong guess is never questioned.
 */
describe('what the reader knows versus what it guessed', () => {
  it('calls a Reply-To address stated, so no model is needed', () => {
    const parsed = parseEnquiry(
      {
        subject: 'Website enquiry',
        body: 'Somebody wrote in.',
        replyTo: 'sarah@example.com',
        from: 'info@clinic.com',
      },
      null
    )!;

    expect(parsed.sources.email).toBe('reply_to');
    expect(isStated(parsed.sources.email)).toBe(true);
  });

  it('calls a labelled field stated', () => {
    const parsed = parseEnquiry(
      { subject: 'x', body: 'Name: Sarah Cohen\nEmail: sarah@example.com' },
      null
    )!;

    expect(parsed.sources.email).toBe('label');
    expect(parsed.sources.name).toBe('label');
    expect(isStated(parsed.sources.name)).toBe(true);
  });

  it('calls a body scan a guess, so the model is consulted', () => {
    const parsed = parseEnquiry(
      { subject: 'x', body: 'Please get in touch with sarah@example.com about this.' },
      null
    )!;

    expect(parsed.sources.email).toBe('body_scan');
    expect(isStated(parsed.sources.email)).toBe(false);
  });

  it('calls a name taken off the subject a guess', () => {
    const template = deriveEnquiryTemplate([
      { subject: 'New enquiry from Sarah Cohen', body: 'Email: sarah@example.com' },
      { subject: 'New enquiry from Dana Levi', body: 'Email: dana@example.com' },
    ])!;
    const parsed = parseEnquiry(
      { subject: 'New enquiry from Sarah Cohen', body: 'Email: sarah@example.com' },
      template
    )!;

    expect(parsed.sources.name).toBe('subject');
    expect(isStated(parsed.sources.name)).toBe(false);
  });

  it('calls leftover prose a guess', () => {
    const parsed = parseEnquiry(
      { subject: 'x', body: 'sarah@example.com\nI would like to book a session please.' },
      null
    )!;

    expect(parsed.sources.message).toBe('leftover');
    expect(isStated(parsed.sources.message)).toBe(false);
  });
});

/**
 * One sample, which is the NORMAL case at setup.
 *
 * An owner connects the channel the day their first enquiry arrives, so there
 * is nothing to compare against. Taking the subject whole then produced a rule
 * carrying the campaign name — matching one lecture and silently missing every
 * enquiry about anything else. Silent misses are this module's worst failure:
 * the owner sees a channel that is running, and no leads.
 */
describe('learning a rule from a single enquiry', () => {
  const one = (subject: string) =>
    deriveEnquiryTemplate([{ subject, body: 'אימייל: sarah@example.com' }])!.subjectPrefix;

  it('cuts at the label when the subject carries a campaign after it', () => {
    expect(one('התעניינות: הרצאה על התארגנות בוקר רגועה ויעילה אוקטובר 2026')).toBe('התעניינות:');
  });

  it.each([
    ['a dash', 'Contact form - new submission', 'Contact form -'],
    ['a pipe', 'Website | enquiry from the pricing page', 'Website |'],
  ])('cuts at %s too', (_what, subject, expected) => {
    expect(one(subject)).toBe(expected);
  });

  it('keeps a fixed subject whole, because it has no variable half', () => {
    expect(one('New inquiry from your website')).toBe('New inquiry from your website');
  });

  it.each([
    ['Re: your appointment'],
    ['Fwd: a message for you'],
    ['תשובה: פנייה חדשה'],
  ])('never cuts at a reply marker (%s)', subject => {
    /* "Re:" as a prefix would match every reply that sender ever writes. */
    expect(one(subject)).toBe(subject);
  });

  it('does not cut at a number or an address', () => {
    expect(one('2026: the year ahead')).toBe('2026: the year ahead');
  });

  it('still measures the stable part when there IS more than one', () => {
    const t = deriveEnquiryTemplate([
      { subject: 'התעניינות: הרצאה על בוקר רגוע', body: 'אימייל: a@example.com' },
      { subject: 'התעניינות: סדנת הורות', body: 'אימייל: b@example.com' },
    ])!;
    /* Measured, not guessed: comparison beats the delimiter heuristic. */
    expect(t.subjectPrefix).toBe('התעניינות:');
    expect(t.learnedFrom).toBe(2);
  });
});
