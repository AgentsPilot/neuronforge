import { applicableAutomations, automationApplies } from '../automationApplies';
import { OPERATIONAL_AUTOMATIONS } from '../automations';
import { intakeRepository } from '@/lib/repositories/IntakeRepository';
import { intakeFormRepository } from '@/lib/repositories/IntakeFormRepository';
import { schedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('@/lib/repositories/IntakeRepository', () => ({
  intakeRepository: { getSettings: jest.fn() },
}));

jest.mock('@/lib/repositories/IntakeFormRepository', () => ({
  intakeFormRepository: { getPublished: jest.fn() },
}));

jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingServiceRepository: { listAll: jest.fn() },
}));

const getSettings = intakeRepository.getSettings as jest.Mock;
const getPublished = intakeFormRepository.getPublished as jest.Mock;
const listServices = schedulingServiceRepository.listAll as jest.Mock;

function intakeState({ enabled, published }: { enabled: boolean; published: boolean }) {
  getSettings.mockResolvedValue({ data: { is_enabled: enabled }, error: null });
  getPublished.mockResolvedValue({ data: published ? { id: 'form-1' } : null, error: null });
}

function bookableServices(count: number) {
  listServices.mockResolvedValue({
    data: Array.from({ length: count }, (_, i) => ({ id: `svc-${i}` })),
    error: null,
  });
}

const chaseIntake = OPERATIONAL_AUTOMATIONS.find(a => a.id === 'chase_intake')!;
const chaseInvoices = OPERATIONAL_AUTOMATIONS.find(a => a.id === 'chase_invoices')!;
const remindAboutMeeting = OPERATIONAL_AUTOMATIONS.find(a => a.id === 'remind_about_meeting')!;

beforeEach(() => {
  jest.clearAllMocks();
  // The default for the tests that are not about scheduling.
  bookableServices(1);
});

describe('automationApplies', () => {
  it('offers the intake chase when a form actually reaches clients', async () => {
    intakeState({ enabled: true, published: true });

    expect(await automationApplies('user-1', chaseIntake)).toBe(true);
  });

  it('does not offer it when intake is on but nothing is published', async () => {
    /*
     * The reported case: intake switched on, no published form. Saying yes
     * would have produced nothing — permission asked for something that cannot
     * happen.
     */
    intakeState({ enabled: true, published: false });

    expect(await automationApplies('user-1', chaseIntake)).toBe(false);
  });

  it('does not count a draft form', async () => {
    // `getPublished` returns only published rows, so a business whose only form
    // is a draft reads as having none. The questions in a draft were written by
    // a model and never read by the owner.
    intakeState({ enabled: true, published: false });

    expect(await automationApplies('user-1', chaseIntake)).toBe(false);
  });

  it('does not offer it when the business does not collect intake', async () => {
    intakeState({ enabled: false, published: true });

    expect(await automationApplies('user-1', chaseIntake)).toBe(false);
  });

  it('hides the automation rather than offering it when the read fails', async () => {
    // Failing towards not asking: an offer that does nothing costs trust in
    // every other thing the card asks.
    getSettings.mockRejectedValue(new Error('unreadable'));
    getPublished.mockResolvedValue({ data: null, error: null });

    expect(await automationApplies('user-1', chaseIntake)).toBe(false);
  });

  it('asks nothing of an automation with no requirement', async () => {
    expect(await automationApplies('user-1', chaseInvoices)).toBe(true);
    expect(getSettings).not.toHaveBeenCalled();
    expect(getPublished).not.toHaveBeenCalled();
  });
});

describe('automationApplies — the meeting reminder', () => {
  it('offers it to a business with a bookable service', async () => {
    bookableServices(2);

    expect(await automationApplies('user-1', remindAboutMeeting)).toBe(true);
  });

  it('does not offer it to a business that takes no bookings', async () => {
    // Nothing to remind anyone about. Same reasoning as the intake chase.
    bookableServices(0);

    expect(await automationApplies('user-1', remindAboutMeeting)).toBe(false);
  });

  it('asks about services, not about appointments', async () => {
    /*
     * A brand-new business with a published service and an empty diary is
     * exactly who this is for. Gating on existing bookings would hide the
     * automation until the first appointment had already happened without a
     * reminder.
     */
    bookableServices(1);

    expect(await automationApplies('user-1', remindAboutMeeting)).toBe(true);
    expect(listServices).toHaveBeenCalledWith('user-1', true);
  });

  it('hides it rather than offering it when the read fails', async () => {
    listServices.mockRejectedValue(new Error('unreadable'));

    expect(await automationApplies('user-1', remindAboutMeeting)).toBe(false);
  });
});

describe('applicableAutomations', () => {
  it('drops only the one that cannot apply', async () => {
    intakeState({ enabled: true, published: false });
    bookableServices(1);

    const result = await applicableAutomations('user-1', OPERATIONAL_AUTOMATIONS);

    /*
     * Membership, not a count. The count assertion this replaced broke the day
     * a fourth automation was registered, which told nobody anything about
     * whether the requirement gates work.
     */
    expect(result.map(a => a.id)).not.toContain('chase_intake');
    expect(result.map(a => a.id)).toEqual(
      expect.arrayContaining(['reply_to_enquiries', 'chase_invoices', 'remind_about_meeting'])
    );
  });

  it('keeps every entry for a business with a form and a bookable service', async () => {
    intakeState({ enabled: true, published: true });
    bookableServices(1);

    const result = await applicableAutomations('user-1', OPERATIONAL_AUTOMATIONS);

    expect(result).toHaveLength(OPERATIONAL_AUTOMATIONS.length);
  });

  it('drops both gated entries for a business with neither', async () => {
    intakeState({ enabled: false, published: false });
    bookableServices(0);

    const result = await applicableAutomations('user-1', OPERATIONAL_AUTOMATIONS);

    // The two ungated ones remain: every business can receive an enquiry and
    // every business can issue an invoice.
    expect(result.map(a => a.id)).toEqual(['reply_to_enquiries', 'chase_invoices']);
  });

  it('reads each fact once however many entries need it', async () => {
    intakeState({ enabled: true, published: true });

    await applicableAutomations('user-1', [chaseIntake, chaseIntake, chaseIntake]);

    expect(getSettings).toHaveBeenCalledTimes(1);
  });
});
