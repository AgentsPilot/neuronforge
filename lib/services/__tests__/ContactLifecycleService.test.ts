/**
 * What must be true every time a client is deleted.
 *
 * These exist because of a real bug, and because the fix for it is destructive
 * by nature. Deleting a contact used to fail with a bare 500 for anybody who had
 * ever booked — a NOT NULL `contact_id` on `scheduling_bookings` meeting a
 * foreign key that sets it NULL, with a trigger that only cleared FUTURE
 * bookings out of the way. A booking with no time at all (a product, a course)
 * blocked its client for ever.
 *
 * Now the service deletes those bookings itself, which makes the two failure
 * modes worth pinning down:
 *
 *   1. Deleting a client the business has been PAID by, erasing the record of
 *      real money.
 *   2. Refusing halfway — deleting the first bookings and then discovering the
 *      third one was paid, with no way back.
 *
 * Every collaborator is faked; this never touches Supabase.
 */

const mockListBookings = jest.fn();
const mockListInvoices = jest.fn();
const mockHeldOnBooking = jest.fn();
const mockDeleteBooking = jest.fn();
const mockDeleteInvoice = jest.fn();
const mockDeleteContact = jest.fn();

jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingBookingRepository: {
    list: (...args: unknown[]) => mockListBookings(...args),
  },
}));

jest.mock('@/lib/repositories/PaymentRepository', () => ({
  paymentInvoiceRepository: {
    list: (...args: unknown[]) => mockListInvoices(...args),
  },
}));

jest.mock('@/lib/repositories/CRMContactRepository', () => ({
  crmContactRepository: {
    delete: (...args: unknown[]) => mockDeleteContact(...args),
  },
}));

jest.mock('@/lib/payments/invoiceLifecycle', () => ({
  deleteInvoice: (...args: unknown[]) => mockDeleteInvoice(...args),
}));

/*
 * The money question is asked through `BookingLifecycleService`, deliberately:
 * one answer, shared with the booking delete guard. Faked here so these tests
 * are about WHAT IS DONE with that answer.
 */
jest.mock('@/lib/services/BookingLifecycleService', () => ({
  heldOnBooking: (...args: unknown[]) => mockHeldOnBooking(...args),
  deleteBooking: (...args: unknown[]) => mockDeleteBooking(...args),
}));

import { deleteContact, ContactHoldsMoneyError } from '../ContactLifecycleService';

const USER = 'user-1';
const CONTACT = 'contact-1';

/** A booking with no time at all — the product booking that started all this. */
const UNSCHEDULED = { id: 'booking-product', start_time: null };
/** One whose date has been and gone, which the old trigger also never took. */
const PAST = { id: 'booking-past', start_time: '2020-01-01T09:00:00.000Z' };

beforeEach(() => {
  jest.clearAllMocks();
  mockListBookings.mockResolvedValue({ data: [], error: null });
  mockListInvoices.mockResolvedValue({ data: [], error: null });
  mockHeldOnBooking.mockResolvedValue({ data: { heldAmount: 0, invoices: [] }, error: null });
  mockDeleteBooking.mockResolvedValue({ data: { deletedInvoices: [] }, error: null });
  mockDeleteInvoice.mockResolvedValue({ data: {}, error: null });
  mockDeleteContact.mockResolvedValue({ data: null, error: null });
});

describe('a client with nothing owed', () => {
  it('goes, and takes their unscheduled and past bookings with them', async () => {
    mockListBookings.mockResolvedValue({ data: [UNSCHEDULED, PAST], error: null });

    const result = await deleteContact({ contactId: CONTACT, userId: USER });

    expect(result.error).toBeNull();
    expect(result.data?.deletedBookings).toBe(2);
    // Both of them — these are precisely the two kinds the old trigger left
    // behind to break the delete.
    expect(mockDeleteBooking).toHaveBeenCalledTimes(2);
    expect(mockDeleteBooking.mock.calls.map((call) => call[0].bookingId)).toEqual([
      'booking-product',
      'booking-past',
    ]);
    expect(mockDeleteContact).toHaveBeenCalledWith(CONTACT, USER);
  });

  it('deletes their loose OPEN invoices too, rather than orphaning them', async () => {
    // `payment_invoices.contact_id` is ON DELETE SET NULL, so an invoice raised
    // straight against a client would outlive them: still owed, still payable
    // through its hosted link, attached to nobody.
    mockListInvoices.mockResolvedValue({
      data: [{ id: 'inv-1', invoice_number: 'INV-1', status: 'sent', booking_id: null }],
      error: null,
    });

    const result = await deleteContact({ contactId: CONTACT, userId: USER });

    expect(result.error).toBeNull();
    expect(mockDeleteInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'inv-1', userId: USER })
    );
    expect(result.data?.deletedInvoices).toContain('INV-1');
  });

  it('leaves a booking-linked invoice to the booking, so it is not deleted twice', async () => {
    mockListBookings.mockResolvedValue({ data: [UNSCHEDULED], error: null });
    mockListInvoices.mockResolvedValue({
      data: [{ id: 'inv-2', invoice_number: 'INV-2', status: 'sent', booking_id: 'booking-product' }],
      error: null,
    });

    await deleteContact({ contactId: CONTACT, userId: USER });

    expect(mockDeleteInvoice).not.toHaveBeenCalled();
  });
});

describe('a client who has paid', () => {
  it('is refused, and NOTHING of theirs is deleted', async () => {
    mockListBookings.mockResolvedValue({ data: [UNSCHEDULED, PAST], error: null });
    mockHeldOnBooking.mockImplementation((bookingId: string) =>
      Promise.resolve(
        bookingId === 'booking-past'
          ? { data: { heldAmount: 150, invoices: [{ invoice_number: 'INV-9', status: 'paid' }] }, error: null }
          : { data: { heldAmount: 0, invoices: [] }, error: null }
      )
    );

    const result = await deleteContact({ contactId: CONTACT, userId: USER });

    expect(result.error).toBeInstanceOf(ContactHoldsMoneyError);
    expect((result.error as ContactHoldsMoneyError).heldAmount).toBe(150);

    /*
     * The whole point of asking every booking first. The paid one is SECOND in
     * the list, so a guard applied per booking as it went would already have
     * destroyed the first — and there is no way back from that.
     */
    expect(mockDeleteBooking).not.toHaveBeenCalled();
    expect(mockDeleteInvoice).not.toHaveBeenCalled();
    expect(mockDeleteContact).not.toHaveBeenCalled();
  });

  it('counts a settled invoice of their own, not only their bookings', async () => {
    mockListInvoices.mockResolvedValue({
      data: [
        { id: 'inv-3', invoice_number: 'INV-3', status: 'paid', amount: 80, refunded_amount: 0, booking_id: null },
      ],
      error: null,
    });

    const result = await deleteContact({ contactId: CONTACT, userId: USER });

    expect(result.error).toBeInstanceOf(ContactHoldsMoneyError);
    expect((result.error as ContactHoldsMoneyError).invoiceNumbers).toEqual(['INV-3']);
    expect(mockDeleteContact).not.toHaveBeenCalled();
  });

  it('but a FULLY refunded invoice holds nothing, so the client can go', async () => {
    // The same line the booking delete guard draws: money that has all gone back
    // is not money held, and a client stuck behind their own refund would be
    // undeletable for ever.
    mockListInvoices.mockResolvedValue({
      data: [
        { id: 'inv-4', invoice_number: 'INV-4', status: 'paid', amount: 80, refunded_amount: 80, booking_id: null },
      ],
      error: null,
    });

    const result = await deleteContact({ contactId: CONTACT, userId: USER });

    expect(result.error).toBeNull();
    expect(mockDeleteContact).toHaveBeenCalledWith(CONTACT, USER);
  });
});

describe('the limits of what it will do unseen', () => {
  it('refuses a client with more bookings than one scan can hold', async () => {
    mockListBookings.mockResolvedValue({
      data: Array.from({ length: 200 }, (_, i) => ({ id: `b-${i}`, start_time: null })),
      error: null,
    });

    const result = await deleteContact({ contactId: CONTACT, userId: USER });

    expect(result.error?.message).toMatch(/more than 200 bookings/i);
    expect(mockDeleteBooking).not.toHaveBeenCalled();
    expect(mockDeleteContact).not.toHaveBeenCalled();
  });

  it('stops if a booking delete fails, rather than deleting the client anyway', async () => {
    mockListBookings.mockResolvedValue({ data: [UNSCHEDULED], error: null });
    mockDeleteBooking.mockResolvedValue({ data: null, error: new Error('booking delete blew up') });

    const result = await deleteContact({ contactId: CONTACT, userId: USER });

    expect(result.error?.message).toBe('booking delete blew up');
    expect(mockDeleteContact).not.toHaveBeenCalled();
  });
});
