/**
 * Choosing a service in the landing-page wizard does not leave the step.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * `handleServiceSelect` ended with `setCurrentStep(2)`, so a tap on a service
 * card advanced the wizard. There was no way to look at two services and
 * compare them, no way to change your mind without going back, and no moment at
 * which the choice was yours to confirm — the wizard decided as soon as a
 * finger landed.
 *
 * The Continue button for that step already existed and already required a
 * selection. Nobody ever saw it, because the step was gone by the time it
 * appeared.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * A render test can click a card and assert the step did not change, and it
 * would pass against a version that advanced from somewhere else — the wizard
 * has nineteen `setCurrentStep` calls. What has to hold is about the handler:
 * selecting SELECTS, and the only thing that advances this step is `goNext`,
 * which is also where the readiness gate is enforced.
 *
 * Comments are stripped before matching, because the note beside the fix quotes
 * the line it removed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const FILE = 'components/business-os/LandingPageWizard.tsx';
const source = fs.readFileSync(path.join(process.cwd(), FILE), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** The landing-page half of the selection handler. */
const handler = code.slice(code.indexOf('const handleServiceSelect'), code.indexOf('const handleSmartLinkComplete'));

describe('selecting a service', () => {
  it('strips comments before matching, or it fails on its own explanation', () => {
    expect(source).toContain('SELECTING IS NOT CONTINUING');
    expect(code).not.toContain('SELECTING IS NOT CONTINUING');
  });

  it('does not advance the wizard', () => {
    expect(handler).not.toContain('setCurrentStep(');
  });

  it('still records the choice and prepares the step', () => {
    // The slug and the description prompt both belong to the selection, not to
    // the advance — the owner should see them before deciding to continue.
    expect(handler).toContain('setSelectedServiceId(serviceId)');
    expect(handler).toContain('setSlug(generateSlug(service.name))');
    expect(handler).toContain('setDescribeServiceId(serviceId)');
  });

  it('shows a blocking gap beside the card that caused it', () => {
    // A warning here, not a gate: the gate is on Continue.
    expect(handler).toContain('checkServiceReadiness([serviceId])');
    expect(handler).toMatch(/setServiceGate\(gate && !gate\.ready \? gate : null\)/);
  });
});

describe('the owner is told what the page will be written from', () => {
  /*
   * The generator's entire brief is the service's description, and this step
   * never said so. An owner picked a service, got a page, and had no way to
   * know that a paragraph typed months ago as an internal note was what a
   * stranger would read.
   */
  const panel = code.slice(code.indexOf('{isSelected'), code.indexOf('{describeServiceId === service.id &&'));

  it('says it, on the service they just chose', () => {
    expect(panel).toContain('labels.description_is_the_brief');
    expect(panel).toContain('isSelected');
  });

  it('shows the description itself, not just advice about it', () => {
    // "Your description matters" is a slogan; the paragraph in front of them is
    // a fact they can judge.
    expect(panel).toContain('{service.description}');
  });

  it('stands down for a service that has none', () => {
    // That one is asked for a description instead, and a card must never carry
    // two things to read.
    expect(panel).toContain('!!service.description?.trim()');
    expect(panel).toContain('describeServiceId !== service.id');
  });

  it('offers to change it right there', () => {
    expect(panel).toContain('setDescribeServiceId(service.id)');
    expect(panel).toContain('labels.description_edit');
  });

  it('opens that editor with the existing text in it', () => {
    // Without this, pressing Edit faced a blank box and retyping a paragraph
    // that already existed — or saving a short replacement by accident.
    expect(code).toContain('initialValue={service.description ?? \'\'}');
  });

  it('is written in every language the wizard speaks', () => {
    expect((code.match(/description_is_the_brief:/g) ?? []).length).toBe(3);
    expect((code.match(/description_edit:/g) ?? []).length).toBe(3);
  });

  it('and saving a description does not skip the step either', () => {
    // It used to end `setCurrentStep(2)`, which made writing a description a
    // third way out — and a way around a gate about something else entirely.
    const onSaved = code.slice(code.indexOf('onSaved={async (serviceId, description)'), code.indexOf('const seedPresetFromServices'));
    expect(onSaved).not.toContain('setCurrentStep(');
  });
});

describe('a new service gets a new page', () => {
  /*
   * The generation effect guards itself with `if (… || generatedContent) return`
   * and nothing cleared that state. So the first attempt's result stuck to the
   * wizard: when it was the STARTING DRAFT, every later visit to the preview
   * step returned immediately, no request was made, and the owner watched the
   * same placeholder page appear in under a second however many times they
   * tried — with nothing in the console, because nothing ran.
   */
  it('drops the previous draft when the service changes', () => {
    expect(handler).toContain('setGeneratedContent(null)');
  });

  it('and the banner about it', () => {
    // A warning about a page being rewritten is stale the moment it starts.
    expect(handler).toContain('setGenerationFailed(null)');
  });

  it('the effect still refuses to run twice over', () => {
    // The guard is right; what was missing was anything ever clearing it.
    expect(code).toMatch(/if \(generatingContent \|\| generatedContent \|\| !selectedService\) return;/);
  });
});

describe('Continue is the way forward', () => {
  it('appears once a service is chosen', () => {
    const shouldShow = code.slice(
      code.indexOf('const shouldShowContinueButton'),
      code.indexOf('const shouldShowContinueButton') + 1200
    );
    expect(shouldShow).toMatch(/creationType === 'landing-page' && currentStep === 1\) \{\s*return !!selectedServiceId;/);
  });

  it('is wired to goNext', () => {
    expect(code).toContain('onClick={goNext}');
  });

  it('and goNext is what stops a service that cannot be sold', () => {
    const branch = code.slice(code.indexOf("if (currentStep === 1 && selectedServiceId)"), code.indexOf('} else if (currentStep === 2)'));
    expect(branch).toContain('checkServiceReadiness([selectedServiceId])');
    expect(branch).toContain('setServiceGate(gate)');
    expect(branch).toContain('setCurrentStep(2)');
  });
});
