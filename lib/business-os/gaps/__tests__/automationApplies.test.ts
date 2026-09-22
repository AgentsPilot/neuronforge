import { applicableAutomations, automationApplies } from '../automationApplies';
import { OPERATIONAL_AUTOMATIONS } from '../automations';
import { intakeRepository } from '@/lib/repositories/IntakeRepository';
import { intakeFormRepository } from '@/lib/repositories/IntakeFormRepository';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('@/lib/repositories/IntakeRepository', () => ({
  intakeRepository: { getSettings: jest.fn() },
}));

jest.mock('@/lib/repositories/IntakeFormRepository', () => ({
  intakeFormRepository: { getPublished: jest.fn() },
}));

const getSettings = intakeRepository.getSettings as jest.Mock;
const getPublished = intakeFormRepository.getPublished as jest.Mock;

function intakeState({ enabled, published }: { enabled: boolean; published: boolean }) {
  getSettings.mockResolvedValue({ data: { is_enabled: enabled }, error: null });
  getPublished.mockResolvedValue({ data: published ? { id: 'form-1' } : null, error: null });
}

const chaseIntake = OPERATIONAL_AUTOMATIONS.find(a => a.id === 'chase_intake')!;
const chaseInvoices = OPERATIONAL_AUTOMATIONS.find(a => a.id === 'chase_invoices')!;

beforeEach(() => jest.clearAllMocks());

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

describe('applicableAutomations', () => {
  it('drops only the one that cannot apply', async () => {
    intakeState({ enabled: true, published: false });

    const result = await applicableAutomations('user-1', OPERATIONAL_AUTOMATIONS);

    expect(result.map(a => a.id)).toEqual(['reply_to_enquiries', 'chase_invoices']);
  });

  it('keeps all three for a business with a published form', async () => {
    intakeState({ enabled: true, published: true });

    const result = await applicableAutomations('user-1', OPERATIONAL_AUTOMATIONS);

    expect(result).toHaveLength(3);
  });

  it('reads each fact once however many entries need it', async () => {
    intakeState({ enabled: true, published: true });

    await applicableAutomations('user-1', [chaseIntake, chaseIntake, chaseIntake]);

    expect(getSettings).toHaveBeenCalledTimes(1);
  });
});
