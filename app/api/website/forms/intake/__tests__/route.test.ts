/**
 * POST /api/website/forms/intake — public, unauthenticated intake submission.
 *
 * These tests are the regression lock for the phantom-column class of bug
 * (`crm_contacts.name`/`.status`, `crm_activities.type`/`.metadata`,
 * `scheduling_bookings.intake_completed`) while the generated `@/types/database`
 * file is absent — nothing else checks column names at build time.
 *
 * Workplan: docs/workplans/BUSINESS_OS_WEBSITE_INTAKE_ROUTE_FIX_WORKPLAN.md
 */

const findBySubdomainAny = jest.fn();
const findByEmail = jest.fn();
const createContact = jest.fn();
const updateContact = jest.fn();
const linkIntakeContact = jest.fn();
const createActivity = jest.fn();
const supabaseFrom = jest.fn();

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: { from: (...args: unknown[]) => supabaseFrom(...args) },
}));

jest.mock('@/lib/repositories/WebsitePageRepository', () => ({
  WebsitePageRepository: class {
    findBySubdomainAny(subdomain: string) {
      return findBySubdomainAny(subdomain);
    }
  },
}));

jest.mock('@/lib/repositories/CRMContactRepository', () => ({
  crmContactRepository: {
    findByEmail: (...args: unknown[]) => findByEmail(...args),
    create: (...args: unknown[]) => createContact(...args),
    update: (...args: unknown[]) => updateContact(...args),
  },
}));

jest.mock('@/lib/repositories/CRMActivityRepository', () => ({
  crmActivityRepository: {
    create: (...args: unknown[]) => createActivity(...args),
  },
}));

jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingBookingRepository: {
    linkIntakeContact: (...args: unknown[]) => linkIntakeContact(...args),
  },
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';
const BOOKING_ID = '33333333-3333-4333-8333-333333333333';

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/website/forms/intake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  subdomain: 'acme',
  template: 'coach',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '+15551234567',
  coaching_goals: 'Ship the analytical engine',
};

describe('POST /api/website/forms/intake', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findBySubdomainAny.mockResolvedValue({ data: { user_id: OWNER_ID }, error: null });
    findByEmail.mockResolvedValue({ data: null, error: null });
    createContact.mockResolvedValue({ data: { id: CONTACT_ID }, error: null });
    updateContact.mockResolvedValue({ data: { id: CONTACT_ID }, error: null });
    linkIntakeContact.mockResolvedValue({ data: { id: BOOKING_ID }, error: null });
    createActivity.mockResolvedValue({ data: { id: 'activity-1' }, error: null });
  });

  // T1 — new contact, real column names only
  it('creates a new contact with first_name/last_name/stage and no phantom columns', async () => {
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, contactId: CONTACT_ID });

    expect(createContact).toHaveBeenCalledTimes(1);
    const insert = createContact.mock.calls[0][0];
    expect(insert).toMatchObject({
      user_id: OWNER_ID,
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@example.com',
      stage: 'lead',
      source: 'website_intake',
    });
    expect(insert).not.toHaveProperty('name');
    expect(insert).not.toHaveProperty('status');
    expect(insert.custom_fields.intake_data).toMatchObject({ template: 'coach' });
  });

  // Documents a tracked contract defect (workplan §1) — NOT the behaviour we want.
  // The schema is `Base.and(z.union([...templateFieldSets]))`. A z.union returns the
  // output of the FIRST branch that validates, and object schemas strip unknown keys —
  // so `TherapistIntakeFields` (all-optional, non-strict) matches almost any payload and
  // decides which answers survive, regardless of the declared `template`. For this body
  // that means `coaching_goals` is dropped. It is not a uniform "everything is stripped":
  // a therapist-shaped field would be kept even under template:'coach', and an invalid
  // value in the therapist branch flips the parse to a later branch, changing which keys
  // survive. Captured data is therefore non-deterministic w.r.t. the template.
  // The tracked fix is `z.discriminatedUnion('template', …)`.
  // Locked here so that fixing the contract fails this test loudly rather than silently
  // changing the shape of stored intake data.
  it('KNOWN GAP: strips template-specific answers from intake_data', async () => {
    await POST(makeRequest(VALID_BODY));

    const insert = createContact.mock.calls[0][0];
    expect(insert.custom_fields.intake_data).not.toHaveProperty('coaching_goals');
  });

  // T2 — existing contact: stage must not be touched
  it('updates an existing contact without writing stage or status', async () => {
    findByEmail.mockResolvedValue({
      data: { id: CONTACT_ID, custom_fields: { existing: true }, phone: '+1999' },
      error: null,
    });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    expect(createContact).not.toHaveBeenCalled();
    expect(updateContact).toHaveBeenCalledTimes(1);

    const [id, userId, patch] = updateContact.mock.calls[0];
    expect(id).toBe(CONTACT_ID);
    expect(userId).toBe(OWNER_ID);
    expect(patch).not.toHaveProperty('stage');
    expect(patch).not.toHaveProperty('status');
    expect(patch.custom_fields).toMatchObject({ existing: true });
    expect(patch.custom_fields.intake_data).toBeDefined();
  });

  // T3 — unknown subdomain
  it('returns 404 for an unknown subdomain and writes nothing', async () => {
    findBySubdomainAny.mockResolvedValue({ data: null, error: null });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(404);
    expect(createContact).not.toHaveBeenCalled();
    expect(updateContact).not.toHaveBeenCalled();
    expect(createActivity).not.toHaveBeenCalled();
  });

  // T4 — Zod rejection
  it('returns 400 for an invalid email and writes nothing', async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, email: 'not-an-email' }));

    expect(res.status).toBe(400);
    expect(findBySubdomainAny).not.toHaveBeenCalled();
    expect(createContact).not.toHaveBeenCalled();
  });

  // T5 — contact create failure is fatal
  it('returns 500 when contact creation fails and does not continue', async () => {
    createContact.mockResolvedValue({ data: null, error: new Error('insert failed') });

    const res = await POST(makeRequest({ ...VALID_BODY, booking_id: BOOKING_ID }));

    expect(res.status).toBe(500);
    expect(linkIntakeContact).not.toHaveBeenCalled();
    expect(createActivity).not.toHaveBeenCalled();
  });

  // T5b — contact update failure is fatal too (QA NB-6)
  it('returns 500 when updating an existing contact fails', async () => {
    findByEmail.mockResolvedValue({ data: { id: CONTACT_ID, custom_fields: {} }, error: null });
    updateContact.mockResolvedValue({ data: null, error: new Error('update failed') });

    const res = await POST(makeRequest({ ...VALID_BODY, booking_id: BOOKING_ID }));

    expect(res.status).toBe(500);
    expect(linkIntakeContact).not.toHaveBeenCalled();
    expect(createActivity).not.toHaveBeenCalled();
  });

  // T6 — booking link failure is non-blocking
  it('still succeeds when the booking link fails', async () => {
    linkIntakeContact.mockResolvedValue({ data: null, error: new Error('no such booking') });

    const res = await POST(makeRequest({ ...VALID_BODY, booking_id: BOOKING_ID }));

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  // T7 — activity failure is non-blocking
  it('still succeeds when the activity insert fails', async () => {
    createActivity.mockResolvedValue({ data: null, error: new Error('activity failed') });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  // T8 — activity payload shape
  it('logs the activity with activity_type and no type/metadata keys', async () => {
    await POST(makeRequest({ ...VALID_BODY, booking_id: BOOKING_ID }));

    expect(createActivity).toHaveBeenCalledTimes(1);
    const activity = createActivity.mock.calls[0][0];
    expect(activity).toMatchObject({
      user_id: OWNER_ID,
      contact_id: CONTACT_ID,
      activity_type: 'note',
      auto_logged: true,
      source_capability: 'website',
      source_entity_id: BOOKING_ID,
    });
    expect(activity).not.toHaveProperty('type');
    expect(activity).not.toHaveProperty('metadata');
  });

  // T9 — booking link payload
  it('links the booking through the scoped repository method', async () => {
    await POST(makeRequest({ ...VALID_BODY, booking_id: BOOKING_ID }));

    expect(linkIntakeContact).toHaveBeenCalledTimes(1);
    expect(linkIntakeContact).toHaveBeenCalledWith(BOOKING_ID, OWNER_ID, CONTACT_ID);
  });

  // T10 — the legacy caller's actual contract (documents the tracked gap)
  it('rejects the legacy ProcessFlowSection payload with 400 (tracked contract gap)', async () => {
    const legacyBody = {
      subdomain: 'acme',
      booking_id: BOOKING_ID,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      answers: { q1: 'a1' },
    };

    const res = await POST(makeRequest(legacyBody));

    expect(res.status).toBe(400);
    expect(findBySubdomainAny).not.toHaveBeenCalled();
    expect(createContact).not.toHaveBeenCalled();
  });

  // T11 — lookup error must not fall through to create
  it('returns 500 when the contact lookup errors, without creating a duplicate', async () => {
    findByEmail.mockResolvedValue({ data: null, error: new Error('lookup exploded') });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(500);
    expect(createContact).not.toHaveBeenCalled();
    expect(updateContact).not.toHaveBeenCalled();
  });

  // T12 — tenant-isolation invariant (tenant-isolation-guard skill, Step 7)
  it('ignores injected identity fields and scopes every write to the resolved owner', async () => {
    const ATTACKER = '99999999-9999-4999-8999-999999999999';

    // BOOKING_ID here stands for a booking the submitter does not own: under the
    // repository's user_id scope it matches no row, which is reported as a clean miss
    // ({data:null,error:null}) and must be non-blocking for the submitter.
    linkIntakeContact.mockResolvedValue({ data: null, error: null });

    const res = await POST(
      makeRequest({
        ...VALID_BODY,
        booking_id: BOOKING_ID,
        user_id: ATTACKER,
        id: 'injected-id',
        stage: 'client',
        status: 'qualified',
      })
    );

    expect(res.status).toBe(200);

    const insert = createContact.mock.calls[0][0];
    expect(insert.user_id).toBe(OWNER_ID);
    expect(insert).not.toHaveProperty('id');
    expect(insert).not.toHaveProperty('status');
    expect(insert.stage).toBe('lead');
    expect(JSON.stringify(insert)).not.toContain(ATTACKER);

    expect(linkIntakeContact).toHaveBeenCalledWith(BOOKING_ID, OWNER_ID, CONTACT_ID);
    expect(createActivity.mock.calls[0][0].user_id).toBe(OWNER_ID);
  });

  // T13 — repository-only guard
  it('never touches the database client directly', async () => {
    await POST(makeRequest({ ...VALID_BODY, booking_id: BOOKING_ID }));

    expect(supabaseFrom).not.toHaveBeenCalled();
  });
});
