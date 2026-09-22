/**
 * A privacy notice composed from what the platform already knows.
 *
 * Not legal advice, and it says so on the page. The bar it has to clear is not
 * "as good as a lawyer's" — it is "better than what is there now", and what is
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
 * ENGLISH ONLY, deliberately. Machine-translating a legal notice produces text
 * that reads as authoritative and is not, and a Hebrew-speaking business is
 * better served by an English default it can see is a draft than by fluent
 * Hebrew it assumes was written for it. The settings panel says so and takes a
 * replacement in any language.
 *
 * @module lib/consent/privacyPolicy
 */

export interface PrivacyPolicyInputs {
  businessName: string;
  contactEmail?: string | null;
  postalAddress?: string | null;
  /** Where someone exercises their right to stop marketing email. */
  unsubscribeUrl?: string | null;
}

/**
 * Markdown, not HTML. The page renders it, the settings panel edits it as text,
 * and a business pasting it into their own site gets something portable.
 */
export function generatePrivacyPolicy(input: PrivacyPolicyInputs): string {
  const name = input.businessName?.trim() || 'This business';
  const email = input.contactEmail?.trim();
  const address = input.postalAddress?.trim();

  const contactLines = [
    email ? `- Email: ${email}` : null,
    address ? `- Postal address: ${address}` : null,
  ].filter(Boolean);

  return [
    `# Privacy notice`,
    ``,
    `${name} collects and uses personal information when you get in touch, book an`,
    `appointment, request a quote, or pay for something. This notice explains what`,
    `is collected, why, and what you can ask us to do about it.`,
    ``,
    `## What is collected`,
    ``,
    `- Your name, email address and phone number, where you provide them`,
    `- The content of messages and forms you submit`,
    `- Appointment details: the service, the date and time, and any notes you add`,
    `- Payment records: amounts, dates and status. Card details are handled by our`,
    `  payment processor and are never stored by ${name}`,
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
    input.unsubscribeUrl
      ? `You can withdraw that agreement at any time, using the unsubscribe link in\nany marketing email or at ${input.unsubscribeUrl}. Withdrawing is as easy as\nagreeing was, and takes effect immediately.`
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
    `- **Supabase** — database and account hosting`,
    `- **Vercel** — website and application hosting`,
    `- **Resend** — sending email`,
    `- **Stripe** — processing payments, where you pay online`,
    ``,
    `It may also be disclosed where the law requires it.`,
    ``,
    `## How long it is kept`,
    ``,
    `Contact and appointment records are kept for as long as ${name} is working`,
    `with you, and afterwards for as long as tax and accounting rules require.`,
    `A record that you asked to stop receiving marketing email is kept`,
    `indefinitely — deleting it would mean emailing you again by mistake.`,
    ``,
    `## Your rights`,
    ``,
    `You can ask ${name} to:`,
    ``,
    `- Tell you what information is held about you, and give you a copy`,
    `- Correct anything inaccurate`,
    `- Delete your information, where there is no legal reason to keep it`,
    `- Stop using it for marketing, which takes effect immediately`,
    `- Restrict or object to other uses`,
    ``,
    `## Getting in touch`,
    ``,
    contactLines.length
      ? contactLines.join('\n')
      : `Contact details are available on request.`,
    ``,
    `---`,
    ``,
    `*This notice was generated from the information ${name} holds, and is a`,
    `starting point rather than legal advice. If your situation is unusual — you`,
    `handle health data, work with children, or operate across several countries —`,
    `have it reviewed.*`,
  ].join('\n');
}
