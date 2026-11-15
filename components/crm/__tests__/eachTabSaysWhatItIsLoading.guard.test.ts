/**
 * Every CRM tab's spinner names its OWN subject, and waits for its own data.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Reported by the owner: "when I move to kanban, list, registration, tasks the
 * spinner always shows loading contacts instead of what it is loading".
 *
 * It was not a wording slip. The page gated all four views on one condition —
 * `loading`, which belongs to its own contacts fetch — and `crm.loading` reads
 * "Loading contacts…". On Subscribers and Tasks that fetch is not even needed:
 * `CRMSubscriberList` and `CRMTaskList` each fetch their own rows, and
 * `CRMTaskList` has carried its own labelled spinner all along without ever
 * getting to show it. The owner therefore waited for contacts, was told they
 * were waiting for contacts, and then waited again for the list they asked for.
 *
 * So the gate now covers only the two views whose rows ARE contacts, and each
 * view answers for its own wait:
 *
 *   pipeline     crm.loading_board         contacts and the columns they sit in
 *   contacts     crm.loading               unchanged, and now true where it is said
 *   subscribers  crm.subscribers.loading   the list's own spinner, newly named
 *   tasks        crm.tasks.loading         its own spinner, finally visible
 *
 * Source guards: the defect is which condition wraps the view and which key
 * reaches the paragraph, and a render test of the page would need the whole
 * CRM fetch surface mocked to say anything about either.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf-8');

const PAGE = read('app', 'business-os', 'crm', 'page.tsx');
const SUBSCRIBERS = read('components', 'crm', 'CRMSubscriberList.tsx');
const TASKS = read('components', 'crm', 'CRMTaskList.tsx');

describe('the page spinner', () => {
  it('covers only the views whose rows are contacts', () => {
    expect(PAGE).toContain("const CONTACT_FETCH_VIEWS: readonly ViewMode[] = ['pipeline', 'contacts']");
    expect(PAGE.replace(/\s+/g, ' ')).toContain(
      "{(CONTACT_FETCH_VIEWS.includes(viewMode) && loading) || (viewMode === 'pipeline' && !stagesLoaded) ?"
    );
  });

  it('no longer holds every view behind that one flag', () => {
    /* The exact gate that caused it. */
    expect(PAGE).not.toContain("{loading || (viewMode === 'pipeline' && !stagesLoaded) ?");
  });

  it('names the board, which is more than its contacts', () => {
    expect(PAGE).toContain("viewMode === 'pipeline' ? t('crm.loading_board') : t('crm.loading')");
  });
});

describe('each list answers for its own wait', () => {
  it('the subscribers list says what it is loading', () => {
    /* It was a bare spinner, defensible only while the page covered it. */
    expect(SUBSCRIBERS).toContain("t('crm.subscribers.loading')");
  });

  it('the tasks list keeps the label it always had', () => {
    expect(TASKS).toContain("t('crm.tasks.loading')");
  });

  it('and all four keys exist in all three languages', () => {
    for (const locale of ['en', 'he', 'es']) {
      const copy = read('lib', 'business-os', 'translations', `${locale}.ts`);

      for (const key of [
        'crm.loading',
        'crm.loading_board',
        'crm.subscribers.loading',
        'crm.tasks.loading',
      ]) {
        expect(`${locale}:${key}:${copy.includes(`'${key}':`)}`).toBe(`${locale}:${key}:true`);
      }
    }
  });
});

describe('and they all look the same while they wait', () => {
  /*
   * The owner's follow-up: "why does the envelope page have a different
   * spinner?" Three views, three spinners — a 64px ring, a 48px ring, and a
   * 20px lucide `Loader2` with the label beside it instead of under it. Nobody
   * chose that; each was written at a different time, and the page covering
   * three of the four tabs kept it invisible.
   */
  const SHARED = read('components', 'crm', 'CRMLoadingState.tsx');

  it('every CRM wait renders the one component', () => {
    expect(PAGE).toContain('<CRMLoadingState');
    expect(SUBSCRIBERS).toContain('<CRMLoadingState');
    expect(TASKS).toContain('<CRMLoadingState');
  });

  it('and none of them hand-rolls a ring of its own', () => {
    const ring = /border-t-transparent rounded-full animate-spin/;

    expect(SHARED).toMatch(ring);
    for (const [name, source] of [
      ['page', PAGE],
      ['subscribers', SUBSCRIBERS],
      ['tasks', TASKS],
    ] as const) {
      expect(`${name}: ${ring.test(source)}`).toBe(`${name}: false`);
    }
  });

  it('so the colour has one definition instead of three', () => {
    expect(SHARED).toContain("const RING = '#8B5CF6'");
  });
});

describe('the subscribers header', () => {
  it('keeps the heading and its one control on a single row', () => {
    /*
     * Three stacked bands of text — title, sentence, switch — before the first
     * person on the list. The switch has no business taking a line of its own.
     */
    expect(SUBSCRIBERS).toContain('flex flex-wrap items-start justify-between');
  });

  it('wraps rather than hiding the switch at narrow widths', () => {
    /*
     * `flex-wrap`, not a breakpoint: this component renders inside the CRM
     * content column, and `sm:` asks about the VIEWPORT — the same mistake the
     * drawer's money row was built on. See `aDrawerRowFitsItsDrawer`.
     */
    const header = SUBSCRIBERS.slice(
      SUBSCRIBERS.indexOf('flex flex-wrap items-start justify-between'),
      SUBSCRIBERS.indexOf('crm.subscribers.show_promoted')
    );

    expect(header).not.toMatch(/\bsm:hidden\b|\bhidden sm:/);
  });
});
