/**
 * The plan card shows the sentence the website will be written from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * "Here is your setup" listed the business as `David KPMG · Service Provider`
 * and nothing else about it. The five follow-up questions the owner had just
 * answered — who comes to them, what those people leave with, what trained
 * them for it — were composed into a description, written to the profile, and
 * never shown. Reported as "the desc is missing from this page".
 *
 * Which made the published site the first place the owner saw our reading of
 * their own business. By then correcting it costs an edit session; here it
 * costs a sentence to the chat.
 *
 * Three surfaces carry this text and all three were checked, because having
 * fixed the wrong one once is how this test came to exist:
 *   · the markdown preview message (`generatePreviewMessage`)
 *   · the build page summary (`app/onboarding-build/page.tsx`)
 *   · THIS one — the React plan deck in `app/onboarding-chat/page.tsx`
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const page = read('app/onboarding-chat/page.tsx');
const route = read('app/api/onboarding/chat/route.ts');
const manager = read('lib/services/OnboardingConversationManager.ts');

/** This file necessarily names what it pins; comments are not evidence. */
const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the description reaches the card at all', () => {
  it('the manager composes it before the preview step', () => {
    /*
     * Not the raw story: the composed text, written from the Q/A pairs.
     *
     * Asserted as two facts rather than one statement. It used to pin the
     * literal `businessDescription = await this.writeDescription(`, which
     * broke the moment the writer was moved into a `Promise.all` beside the
     * configuration inference so the two share one wait. The INTENT is that
     * the composed text is written onto the state before the preview, and
     * that is what these two lines say.
     */
    expect(manager).toMatch(/this\.writeDescription\(/);
    expect(manager).toMatch(/collectedData\.businessDescription = written;/);
  });

  it('the route sends it in the preview payload', () => {
    /*
     * Now asserted against the ONE builder both the POST and the GET use.
     * It was two inline copies of the same object, which is how a field ends
     * up on one and not the other: the plan screen gets a description and the
     * build-page recovery does not.
     */
    expect(route).toMatch(/function previewPayload\(state: OnboardingState\)/);
    expect(route).toMatch(/businessDescription: collected\.businessDescription/);
    expect(route).toMatch(/previewData: result\.showPreview \? previewPayload\(result\.updatedState\) : undefined/);
  });

  it('the same builder answers a cold recovery, so the two cannot drift', () => {
    /*
     * The build was reachable only through `sessionStorage`. A write that threw
     * or a fresh tab sent the owner back to the first question with nothing
     * built, and nothing recorded that a build was owed.
     */
    expect(route).toMatch(/export async function GET\(\)/);
    expect(route).toMatch(/previewData: ready && state\.collectedData\.configuration \? previewPayload\(state\) : null/);
  });

  it('the page declares it on the preview type', () => {
    // Absent from the interface, the read below is a silent `undefined` and
    // the card renders nothing — which is exactly how this shipped.
    expect(page).toMatch(/businessDescription\?: string/);
  });
});

describe('it is its own card, under the name', () => {
  it('renders a second fact card for it', () => {
    expect(code).toMatch(/previewData\.businessDescription && \(/);
    expect(code).toMatch(/<bdi>\{previewData\.businessDescription\}<\/bdi>/);
  });

  it('sits after the business-name card and before the services block', () => {
    /*
     * Order is the point of the request — "name and below the description".
     * A card appended to the end of the deck would read as an afterthought
     * among the payment and booking facts.
     */
    const name = code.indexOf('setEditingName(previewData.businessProfile?.company_name');
    const description = code.indexOf('previewData.businessDescription && (');
    const services = code.indexOf('{plannedServiceCount > 0 && (');

    expect(name).toBeGreaterThan(-1);
    expect(description).toBeGreaterThan(name);
    expect(services).toBeGreaterThan(description);
  });

  it('is stretched across the deck rather than sharing a row', () => {
    /*
     * The deck is `repeat(auto-fit, minmax(220px, 1fr))`. A paragraph in a
     * 220px column wraps to eight lines and reads as a wall beside two
     * one-line facts, so it takes the full row like the services block does.
     */
    const card = code.slice(
      code.indexOf('previewData.businessDescription && ('),
      code.indexOf('{plannedServiceCount > 0 && (')
    );
    expect(card).toMatch(/gridColumn: '1\/-1'/);
  });

  it('offers no change link', () => {
    /*
     * Every other card points at the editor that OWNS its fact. This text was
     * composed from the interview; an input here would be a second, competing
     * source of the same sentence. It is corrected by saying so to the chat.
     */
    const card = code.slice(
      code.indexOf('previewData.businessDescription && ('),
      code.indexOf('{plannedServiceCount > 0 && (')
    );
    expect(card).not.toMatch(/onChange=/);
  });
});

describe('it reads correctly in every language the chat speaks', () => {
  const card = code.slice(
    code.indexOf('previewData.businessDescription && ('),
    code.indexOf('{plannedServiceCount > 0 && (')
  );

  it('titles the card in the owner\'s language', () => {
    // An English heading over a Hebrew paragraph is the failure the
    // extraction already cost this platform once.
    expect(card).toMatch(/selectedLanguage === 'he'/);
    expect(card).toMatch(/selectedLanguage === 'es'/);
  });

  it('aligns the paragraph to the reading direction', () => {
    expect(card).toMatch(/isRTL && 'text-right'/);
  });

  it('isolates the text with bdi, so a Latin name cannot reorder a Hebrew line', () => {
    /*
     * "I train at ProGym" inside a Hebrew sentence drags the clause to the
     * wrong end of the line without this. The description is the one field
     * here guaranteed to be free prose, so it is the one that needs it.
     */
    expect(card).toMatch(/<bdi>/);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * THE PLAN SCREEN'S OWN EDITS, reported together:
 *
 *   "check the what you sell change button open the form of services. The
 *    change it only for the services names not more."
 *   "the title my plan to [business name] is not looking great"
 *
 * Both are the same kind of fault: a screen saying one thing and offering
 * another.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the what-you-sell editor matches what the card promises', () => {
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const editor = code.slice(
    code.indexOf("{planEditor === 'services' && ("),
    code.indexOf('Save changes')
  );

  it('found the editor', () => {
    expect(editor.length).toBeGreaterThan(300);
  });

  it('edits the name and nothing else', () => {
    /*
     * The card directly above it says "We will create these as drafts. You set
     * prices and durations later." Behind that sentence sat the full services
     * settings form: fifteen grid columns with a price, a currency, a
     * duration, a scheduled toggle, a sale mode and a payment plan. It asked
     * the owner to do the work twice, and to price their services at the least
     * informed moment they will ever have.
     */
    expect(editor).toMatch(/updateDraftService\(index, 'service_name', e\.target\.value\)/);
    expect(editor).not.toMatch(/'price'|'duration_minutes'|'currency'|'sale_mode'|'is_scheduled'/);
  });

  it('says where the rest is set', () => {
    expect(page).toMatch(/Prices, durations and how you take payment are set later, in the services screen/);
  });

  it('keeps add and remove, which are name-level edits', () => {
    expect(editor).toMatch(/Add service/);
    expect(editor).toMatch(/rows\.filter\(\(_, i\) => i !== index\)/);
  });

  it('leaves no unreachable instalment dialog behind', () => {
    /*
     * Its only trigger was a button inside the removed grid, so
     * `setDraftPaymentIndex` was left callable with `null` alone: a dialog that
     * could be closed and never opened.
     */
    expect(code).not.toMatch(/draftPaymentIndex/);
    expect(code).not.toMatch(/setDraftPaymentPlan/);
  });
});

describe('the plan heading reads as one sentence', () => {
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('is one element at one type size, not a label beside a title', () => {
    /*
     * A `p` above an `h2` stranded the preposition on its own line. Pairing
     * them on one baseline then put `text-xs` muted beside `text-xl` bold — a
     * four-step size jump that reads as two adjacent fragments rather than a
     * sentence.
     */
    const heading = code.slice(code.indexOf("'התוכנית שלי עבור'") - 300, code.indexOf("'התוכנית שלי עבור'") + 500);
    expect(heading).toMatch(/<p className="mb-4 text-lg/);
    expect(heading).not.toMatch(/<h2/);
    expect(heading).not.toMatch(/items-baseline/);
  });

  it('gives the name the weight, so it is plainly the subject', () => {
    const heading = code.slice(code.indexOf("'התוכנית שלי עבור'"), code.indexOf("'התוכנית שלי עבור'") + 500);
    expect(heading).toMatch(/<bdi className="font-bold text-\[var\(--v2-text-primary\)\]">/);
  });
});
