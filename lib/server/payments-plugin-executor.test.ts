// lib/server/payments-plugin-executor.test.ts
//
// Fast, pure unit tests for the Payments plugin executor. Repositories are mocked (no DB).
// Focus: dispatch + user_id scoping, the M1 tenant-ownership pre-check on record_manual_payment,
// the delegate-only guardrail (record_manual_payment never flips invoice status / writes CRM),
// create_refund_record writing the DB record only, missing user_id, and param guards.
//
// DB-backed behaviour (T3/T4 fan-out, invoice-paid transitions, real revenue sums) is QA-manual —
// see the workplan lean-test policy.

const invoiceRepo = {
  create: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  update: jest.fn(),
  markAsPaid: jest.fn(),
  count: jest.fn(),
  getNextInvoiceNumber: jest.fn(),
};
const transactionRepo = {
  list: jest.fn(),
  findById: jest.fn(),
  recordManualPayment: jest.fn(),
  createRefund: jest.fn(),
  getTotalRevenue: jest.fn(),
};
const planRepo = {
  create: jest.fn(),
  list: jest.fn(),
  findById: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  createInstallmentsForBooking: jest.fn(),
  getInstallments: jest.fn(),
  markInstallmentPaid: jest.fn(),
  cancelInstallments: jest.fn(),
  getPlanSummaryForContact: jest.fn(),
};
const businessProfileRepo = { findByUserId: jest.fn() };
const contactRepo = { findById: jest.fn() };

jest.mock('@/lib/repositories/PaymentRepository', () => ({
  paymentInvoiceRepository: invoiceRepo,
  paymentTransactionRepository: transactionRepo,
}));
jest.mock('@/lib/repositories/PaymentPlanRepository', () => ({
  paymentPlanRepository: planRepo,
}));
jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: businessProfileRepo,
}));
jest.mock('@/lib/repositories/CRMContactRepository', () => ({
  crmContactRepository: contactRepo,
}));

import { PaymentsPluginExecutor } from './payments-plugin-executor';

function run(action: string, params: any, connection: any = { user_id: 'u1' }) {
  const executor = new PaymentsPluginExecutor({} as any, {} as any);
  return (executor as any).executeSpecificAction(connection, action, params);
}

const ok = (data: any) => ({ data, error: null });

beforeEach(() => {
  jest.clearAllMocks();
  for (const repo of [invoiceRepo, transactionRepo, planRepo]) {
    for (const fn of Object.values(repo)) (fn as jest.Mock).mockResolvedValue(ok({}));
  }
  // Sensible defaults so happy-path delegation succeeds.
  invoiceRepo.getNextInvoiceNumber.mockResolvedValue(ok('INV-00001'));
  invoiceRepo.findById.mockResolvedValue(ok({ id: 'inv1', user_id: 'u1' }));
  contactRepo.findById.mockResolvedValue(ok({ id: 'c1', user_id: 'u1' }));
  businessProfileRepo.findByUserId.mockResolvedValue(ok(null));
});

describe('PaymentsPluginExecutor — dispatch + user_id scoping', () => {
  it('create_invoice → generates number then create with user_id + invoice_number', async () => {
    await run('create_invoice', { amount: 100, currency: 'USD', description: 'Consulting' });
    expect(invoiceRepo.getNextInvoiceNumber).toHaveBeenCalledWith('u1');
    expect(invoiceRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u1',
        invoice_number: 'INV-00001',
        amount: 100,
        currency: 'USD',
        status: 'draft',
      })
    );
  });

  it('list_invoices → list(userId, options)', async () => {
    await run('list_invoices', { status: 'sent', limit: 10 });
    expect(invoiceRepo.list).toHaveBeenCalledWith('u1', expect.objectContaining({ status: 'sent', limit: 10 }));
  });

  it('get_invoice → findById(id, userId)', async () => {
    await run('get_invoice', { id: 'inv1' });
    expect(invoiceRepo.findById).toHaveBeenCalledWith('inv1', 'u1');
  });

  it('send_invoice → update(id, userId, {status:sent})', async () => {
    await run('send_invoice', { id: 'inv1' });
    expect(invoiceRepo.update).toHaveBeenCalledWith('inv1', 'u1', expect.objectContaining({ status: 'sent' }));
  });

  it('cancel_invoice → update(id, userId, {status:cancelled})', async () => {
    await run('cancel_invoice', { id: 'inv1' });
    expect(invoiceRepo.update).toHaveBeenCalledWith('inv1', 'u1', { status: 'cancelled' });
  });

  it('mark_invoice_paid → markAsPaid(id, userId, details)', async () => {
    await run('mark_invoice_paid', { id: 'inv1', payment_method: 'cash' });
    expect(invoiceRepo.markAsPaid).toHaveBeenCalledWith('inv1', 'u1', expect.objectContaining({ paymentMethod: 'cash' }));
  });

  it('count_invoices → count(userId, {status})', async () => {
    invoiceRepo.count.mockResolvedValueOnce(ok(7));
    const res = await run('count_invoices', { status: 'paid' });
    expect(invoiceRepo.count).toHaveBeenCalledWith('u1', { status: 'paid' });
    expect(res).toBe(7);
  });

  it('list_transactions → list(userId, options)', async () => {
    await run('list_transactions', { status: 'succeeded' });
    expect(transactionRepo.list).toHaveBeenCalledWith('u1', expect.objectContaining({ status: 'succeeded' }));
  });

  it('get_revenue → getTotalRevenue(userId, start, end)', async () => {
    transactionRepo.getTotalRevenue.mockResolvedValueOnce(ok(4200));
    const res = await run('get_revenue', { start_date: '2026-01-01', end_date: '2026-02-01' });
    expect(transactionRepo.getTotalRevenue).toHaveBeenCalledWith('u1', '2026-01-01', '2026-02-01');
    expect(res).toBe(4200);
  });

  it('create_plan → create with user_id', async () => {
    await run('create_plan', {
      name: 'Course', total_amount: 300, currency: 'USD',
      installment_count: 3, installment_amount: 100, installment_frequency: 'monthly',
    });
    expect(planRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', name: 'Course', installment_frequency: 'monthly' })
    );
  });

  it('deactivate_plan → delete(id, userId) (soft)', async () => {
    await run('deactivate_plan', { id: 'p1' });
    expect(planRepo.delete).toHaveBeenCalledWith('p1', 'u1');
  });

  it('mark_installment_paid → markInstallmentPaid(id, userId, details)', async () => {
    await run('mark_installment_paid', { installment_id: 'i1', payment_method: 'cash', transaction_id: 't1' });
    expect(planRepo.markInstallmentPaid).toHaveBeenCalledWith('i1', 'u1', expect.objectContaining({ paymentMethod: 'cash', transactionId: 't1' }));
  });

  it('get_plan_summary → getPlanSummaryForContact(plan, contact, userId)', async () => {
    await run('get_plan_summary', { plan_id: 'p1', contact_id: 'c1' });
    expect(planRepo.getPlanSummaryForContact).toHaveBeenCalledWith('p1', 'c1', 'u1');
  });
});

describe('PaymentsPluginExecutor — record_manual_payment (delegate-only + M1)', () => {
  it('delegates to recordManualPayment with user_id and does NOT touch invoice status or CRM writes', async () => {
    transactionRepo.recordManualPayment.mockResolvedValueOnce(ok({ id: 'tx1' }));
    await run('record_manual_payment', { amount: 50, currency: 'USD', payment_method: 'cash', invoice_id: 'inv1', contact_id: 'c1' });

    expect(transactionRepo.recordManualPayment).toHaveBeenCalledTimes(1);
    expect(transactionRepo.recordManualPayment).toHaveBeenCalledWith('u1', expect.objectContaining({
      amount: 50, currency: 'USD', paymentMethod: 'cash', invoiceId: 'inv1', contactId: 'c1',
    }));
    // T3/T4 own the side-effects — the executor must NOT flip the invoice or emit CRM activity.
    expect(invoiceRepo.markAsPaid).not.toHaveBeenCalled();
    expect(invoiceRepo.update).not.toHaveBeenCalled();
  });

  it('M1: a foreign invoice_id (findById → null) throws access_denied BEFORE recording', async () => {
    invoiceRepo.findById.mockResolvedValueOnce(ok(null));
    await expect(
      run('record_manual_payment', { amount: 50, payment_method: 'cash', invoice_id: 'foreign-inv' })
    ).rejects.toThrow(/access_denied/);
    expect(transactionRepo.recordManualPayment).not.toHaveBeenCalled();
  });

  it('M1: a foreign invoice_id (findById error) throws access_denied BEFORE recording', async () => {
    invoiceRepo.findById.mockResolvedValueOnce({ data: null, error: new Error('PGRST116') });
    await expect(
      run('record_manual_payment', { amount: 50, payment_method: 'cash', invoice_id: 'foreign-inv' })
    ).rejects.toThrow(/access_denied/);
    expect(transactionRepo.recordManualPayment).not.toHaveBeenCalled();
  });

  it('M1: a foreign contact_id (findById → null) throws access_denied BEFORE recording', async () => {
    contactRepo.findById.mockResolvedValueOnce(ok(null));
    await expect(
      run('record_manual_payment', { amount: 50, payment_method: 'cash', contact_id: 'foreign-c' })
    ).rejects.toThrow(/access_denied/);
    expect(transactionRepo.recordManualPayment).not.toHaveBeenCalled();
  });

  it('records without ownership checks when no invoice_id/contact_id supplied', async () => {
    await run('record_manual_payment', { amount: 50, payment_method: 'cash' });
    expect(invoiceRepo.findById).not.toHaveBeenCalled();
    expect(contactRepo.findById).not.toHaveBeenCalled();
    expect(transactionRepo.recordManualPayment).toHaveBeenCalledTimes(1);
  });
});

describe('PaymentsPluginExecutor — create_refund_record (DB only, no processor)', () => {
  it('calls createRefund with the parsed refund details and touches no other write path', async () => {
    await run('create_refund_record', { transaction_id: 't1', amount: 20, is_full_refund: false, reason: 'partial' });
    expect(transactionRepo.createRefund).toHaveBeenCalledWith('t1', 'u1', expect.objectContaining({
      amount: 20, isFullRefund: false, reason: 'partial',
    }));
    // No money-movement / processor path exists on the executor; refund is a pure DB record.
    expect(transactionRepo.recordManualPayment).not.toHaveBeenCalled();
  });
});

describe('PaymentsPluginExecutor — guards', () => {
  it('throws when connection has no user_id', async () => {
    await expect(run('list_invoices', {}, {})).rejects.toThrow(/access_denied/);
  });

  it('rejects unknown actions', async () => {
    await expect(run('frobnicate', {})).rejects.toThrow(/not supported/);
  });

  it('requires amount on create_invoice', async () => {
    await expect(run('create_invoice', { currency: 'USD' })).rejects.toThrow(/amount/);
  });

  it('requires payment_method on record_manual_payment', async () => {
    await expect(run('record_manual_payment', { amount: 10 })).rejects.toThrow(/payment_method/);
    expect(transactionRepo.recordManualPayment).not.toHaveBeenCalled();
  });

  it('propagates a repository error as a throw', async () => {
    invoiceRepo.findById.mockResolvedValueOnce({ data: null, error: new Error('boom') });
    await expect(run('get_invoice', { id: 'inv1' })).rejects.toThrow('boom');
  });
});
