/**
 * Payment Plan Repository
 *
 * Handles database operations for:
 * 1. Payment plan templates
 * 2. Payment plan installments
 *
 * Follows the repository pattern defined in REPOSITORY_STRATEGY.md
 * Supports multi-currency and multiple payment processors.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'PaymentPlanRepository' });

// ==================== TYPES ====================

export type InstallmentFrequency = 'weekly' | 'biweekly' | 'monthly';
export type InstallmentStatus = 'pending' | 'paid' | 'overdue' | 'cancelled';

export interface PaymentPlan {
  id: string;
  user_id: string;
  service_id: string | null;
  name: string;
  description: string | null;
  total_amount: number;
  currency: string;
  supported_currencies: string[];
  installment_count: number;
  installment_amount: number;
  installment_frequency: InstallmentFrequency;
  allowed_processors: string[];
  preferred_processor: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaymentPlanInsert {
  user_id: string;
  service_id?: string | null;
  name: string;
  description?: string | null;
  total_amount: number;
  currency: string;
  supported_currencies?: string[];
  installment_count: number;
  installment_amount: number;
  installment_frequency: InstallmentFrequency;
  allowed_processors?: string[];
  preferred_processor?: string | null;
  is_active?: boolean;
}

export interface PaymentPlanUpdate {
  name?: string;
  description?: string | null;
  total_amount?: number;
  currency?: string;
  supported_currencies?: string[];
  installment_count?: number;
  installment_amount?: number;
  installment_frequency?: InstallmentFrequency;
  allowed_processors?: string[];
  preferred_processor?: string | null;
  is_active?: boolean;
}

export interface PaymentPlanInstallment {
  id: string;
  user_id: string;
  payment_plan_id: string;
  booking_id: string | null;
  contact_id: string | null;
  installment_number: number;
  amount: number;
  currency: string;
  due_date: string;
  status: InstallmentStatus;
  paid_at: string | null;
  payment_method: string | null;
  processor_type: string | null;
  transaction_id: string | null;
  retry_count: number;
  last_retry_at: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaymentPlanInstallmentInsert {
  user_id: string;
  payment_plan_id: string;
  booking_id?: string | null;
  contact_id?: string | null;
  installment_number: number;
  amount: number;
  currency: string;
  due_date: string;
  status?: InstallmentStatus;
}

export interface PaymentPlanInstallmentUpdate {
  amount?: number;
  due_date?: string;
  status?: InstallmentStatus;
  paid_at?: string | null;
  payment_method?: string | null;
  processor_type?: string | null;
  transaction_id?: string | null;
  retry_count?: number;
  last_retry_at?: string | null;
  next_retry_at?: string | null;
}

export interface PaymentPlanRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

// ==================== PAYMENT PLAN REPOSITORY ====================

export class PaymentPlanRepository {
  private supabase: SupabaseClient;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  // ==================== PLAN OPERATIONS ====================

  /**
   * Create a new payment plan
   */
  async create(plan: PaymentPlanInsert): Promise<PaymentPlanRepositoryResult<PaymentPlan>> {
    try {
      logger.info({ userId: plan.user_id, planName: plan.name }, 'Creating payment plan');

      const { data, error } = await this.supabase
        .from('payment_plans')
        .insert({
          ...plan,
          supported_currencies: plan.supported_currencies || [plan.currency],
          allowed_processors: plan.allowed_processors || ['stripe', 'paypal', 'square', 'manual'],
          is_active: plan.is_active ?? true
        })
        .select()
        .single();

      if (error) throw error;

      logger.info({ planId: data.id, userId: plan.user_id }, 'Payment plan created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId: plan.user_id }, 'Failed to create payment plan');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find plan by ID
   */
  async findById(id: string, userId: string): Promise<PaymentPlanRepositoryResult<PaymentPlan>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_plans')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, planId: id, userId }, 'Failed to find payment plan');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find plans by service ID
   */
  async findByServiceId(serviceId: string, userId: string): Promise<PaymentPlanRepositoryResult<PaymentPlan[]>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_plans')
        .select('*')
        .eq('service_id', serviceId)
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, serviceId, userId }, 'Failed to find plans by service');
      return { data: null, error: error as Error };
    }
  }

  /**
   * List all plans for a user
   */
  async list(
    userId: string,
    options: {
      serviceId?: string;
      isActive?: boolean;
      currency?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<PaymentPlanRepositoryResult<PaymentPlan[]>> {
    try {
      const { serviceId, isActive, currency, limit = 50, offset = 0 } = options;

      let query = this.supabase
        .from('payment_plans')
        .select('*')
        .eq('user_id', userId);

      if (serviceId) {
        query = query.eq('service_id', serviceId);
      }

      if (isActive !== undefined) {
        query = query.eq('is_active', isActive);
      }

      if (currency) {
        query = query.contains('supported_currencies', [currency]);
      }

      query = query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, options }, 'Failed to list payment plans');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update a payment plan
   */
  async update(
    id: string,
    userId: string,
    updates: PaymentPlanUpdate
  ): Promise<PaymentPlanRepositoryResult<PaymentPlan>> {
    try {
      logger.info({ planId: id, userId }, 'Updating payment plan');

      const { data, error } = await this.supabase
        .from('payment_plans')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, planId: id, userId }, 'Failed to update payment plan');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Soft delete (deactivate) a payment plan
   */
  async delete(id: string, userId: string): Promise<PaymentPlanRepositoryResult<void>> {
    try {
      logger.info({ planId: id, userId }, 'Deactivating payment plan');

      const { error } = await this.supabase
        .from('payment_plans')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;

      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, planId: id, userId }, 'Failed to delete payment plan');
      return { data: null, error: error as Error };
    }
  }

  // ==================== INSTALLMENT OPERATIONS ====================

  /**
   * Create installments for a booking
   * Generates the full installment schedule based on the plan
   */
  async createInstallmentsForBooking(
    planId: string,
    userId: string,
    contactId: string,
    startDate: string,
    options: {
      bookingId?: string;
      currency?: string;
      customAmount?: number;
    } = {}
  ): Promise<PaymentPlanRepositoryResult<PaymentPlanInstallment[]>> {
    try {
      const { bookingId, currency, customAmount } = options;

      // Get the plan
      const planResult = await this.findById(planId, userId);
      if (planResult.error || !planResult.data) {
        throw planResult.error || new Error('Plan not found');
      }
      const plan = planResult.data;

      // Determine currency
      const installmentCurrency = currency || plan.currency;
      if (!plan.supported_currencies.includes(installmentCurrency)) {
        throw new Error(`Currency ${installmentCurrency} is not supported by this plan`);
      }

      // Calculate amounts
      const totalAmount = customAmount || plan.total_amount;
      const installmentAmount = totalAmount / plan.installment_count;

      // Generate installment dates
      const installments: PaymentPlanInstallmentInsert[] = [];
      let currentDate = new Date(startDate);

      for (let i = 1; i <= plan.installment_count; i++) {
        installments.push({
          user_id: userId,
          payment_plan_id: planId,
          booking_id: bookingId || null,
          contact_id: contactId,
          installment_number: i,
          amount: Math.round(installmentAmount * 100) / 100, // Round to 2 decimal places
          currency: installmentCurrency,
          due_date: currentDate.toISOString().split('T')[0],
          status: 'pending'
        });

        // Calculate next due date
        currentDate = this.addFrequencyToDate(currentDate, plan.installment_frequency);
      }

      // Handle rounding differences on last installment
      const totalCalculated = installments.reduce((sum, i) => sum + i.amount, 0);
      const difference = totalAmount - totalCalculated;
      if (difference !== 0) {
        installments[installments.length - 1].amount += difference;
      }

      logger.info({
        userId,
        planId,
        contactId,
        bookingId,
        installmentCount: installments.length
      }, 'Creating installments for booking');

      const { data, error } = await this.supabase
        .from('payment_plan_installments')
        .insert(installments)
        .select();

      if (error) throw error;

      logger.info({ userId, planId, created: data?.length }, 'Installments created');
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, planId, userId, contactId }, 'Failed to create installments');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get installments for a plan application
   */
  async getInstallments(
    planId: string,
    userId: string,
    options: {
      contactId?: string;
      bookingId?: string;
      status?: InstallmentStatus;
    } = {}
  ): Promise<PaymentPlanRepositoryResult<PaymentPlanInstallment[]>> {
    try {
      const { contactId, bookingId, status } = options;

      let query = this.supabase
        .from('payment_plan_installments')
        .select('*')
        .eq('payment_plan_id', planId)
        .eq('user_id', userId);

      if (contactId) {
        query = query.eq('contact_id', contactId);
      }

      if (bookingId) {
        query = query.eq('booking_id', bookingId);
      }

      if (status) {
        query = query.eq('status', status);
      }

      query = query.order('installment_number', { ascending: true });

      const { data, error } = await query;

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, planId, userId }, 'Failed to get installments');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get all installments for a contact
   */
  async getContactInstallments(
    contactId: string,
    userId: string,
    options: {
      status?: InstallmentStatus;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<PaymentPlanRepositoryResult<PaymentPlanInstallment[]>> {
    try {
      const { status, limit = 50, offset = 0 } = options;

      let query = this.supabase
        .from('payment_plan_installments')
        .select('*')
        .eq('contact_id', contactId)
        .eq('user_id', userId);

      if (status) {
        query = query.eq('status', status);
      }

      query = query
        .order('due_date', { ascending: true })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, contactId, userId }, 'Failed to get contact installments');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Mark an installment as paid
   */
  async markInstallmentPaid(
    installmentId: string,
    userId: string,
    paymentDetails: {
      paymentMethod: string;
      processorType?: string;
      transactionId?: string;
    }
  ): Promise<PaymentPlanRepositoryResult<PaymentPlanInstallment>> {
    try {
      logger.info({ installmentId, userId }, 'Marking installment as paid');

      const { data, error } = await this.supabase
        .from('payment_plan_installments')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          payment_method: paymentDetails.paymentMethod,
          processor_type: paymentDetails.processorType || null,
          transaction_id: paymentDetails.transactionId || null,
          next_retry_at: null, // Clear any scheduled retry
          updated_at: new Date().toISOString()
        })
        .eq('id', installmentId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, installmentId, userId }, 'Failed to mark installment as paid');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Update an installment
   */
  async updateInstallment(
    installmentId: string,
    userId: string,
    updates: PaymentPlanInstallmentUpdate
  ): Promise<PaymentPlanRepositoryResult<PaymentPlanInstallment>> {
    try {
      logger.info({ installmentId, userId }, 'Updating installment');

      const { data, error } = await this.supabase
        .from('payment_plan_installments')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', installmentId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, installmentId, userId }, 'Failed to update installment');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get overdue installments for a user
   */
  async getOverdueInstallments(userId: string): Promise<PaymentPlanRepositoryResult<PaymentPlanInstallment[]>> {
    try {
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await this.supabase
        .from('payment_plan_installments')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .lt('due_date', today)
        .order('due_date', { ascending: true });

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get overdue installments');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get installments due soon (for reminders)
   */
  async getInstallmentsDueSoon(
    userId: string,
    daysAhead: number
  ): Promise<PaymentPlanRepositoryResult<PaymentPlanInstallment[]>> {
    try {
      const today = new Date();
      const targetDate = new Date(today);
      targetDate.setDate(targetDate.getDate() + daysAhead);

      const { data, error } = await this.supabase
        .from('payment_plan_installments')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .gte('due_date', today.toISOString().split('T')[0])
        .lte('due_date', targetDate.toISOString().split('T')[0])
        .order('due_date', { ascending: true });

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, daysAhead }, 'Failed to get installments due soon');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get installments needing retry
   */
  async getInstallmentsForRetry(userId: string): Promise<PaymentPlanRepositoryResult<PaymentPlanInstallment[]>> {
    try {
      const now = new Date().toISOString();

      const { data, error } = await this.supabase
        .from('payment_plan_installments')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'pending')
        .not('next_retry_at', 'is', null)
        .lte('next_retry_at', now)
        .order('next_retry_at', { ascending: true });

      if (error) throw error;

      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to get installments for retry');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Cancel all pending installments for a plan application
   */
  async cancelInstallments(
    planId: string,
    contactId: string,
    userId: string
  ): Promise<PaymentPlanRepositoryResult<number>> {
    try {
      logger.info({ planId, contactId, userId }, 'Cancelling installments');

      const { data, error } = await this.supabase
        .from('payment_plan_installments')
        .update({
          status: 'cancelled',
          next_retry_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('payment_plan_id', planId)
        .eq('contact_id', contactId)
        .eq('user_id', userId)
        .eq('status', 'pending')
        .select();

      if (error) throw error;

      const cancelledCount = data?.length || 0;
      logger.info({ planId, contactId, cancelled: cancelledCount }, 'Installments cancelled');
      return { data: cancelledCount, error: null };
    } catch (error) {
      logger.error({ err: error, planId, contactId, userId }, 'Failed to cancel installments');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get plan summary for a contact (total paid, remaining, etc.)
   */
  async getPlanSummaryForContact(
    planId: string,
    contactId: string,
    userId: string
  ): Promise<PaymentPlanRepositoryResult<{
    plan: PaymentPlan;
    totalInstallments: number;
    paidInstallments: number;
    pendingInstallments: number;
    overdueInstallments: number;
    totalPaid: number;
    totalRemaining: number;
    nextDueDate: string | null;
  }>> {
    try {
      const planResult = await this.findById(planId, userId);
      if (planResult.error || !planResult.data) {
        throw planResult.error || new Error('Plan not found');
      }

      const installmentsResult = await this.getInstallments(planId, userId, { contactId });
      if (installmentsResult.error || !installmentsResult.data) {
        throw installmentsResult.error || new Error('Failed to get installments');
      }

      const installments = installmentsResult.data;
      const today = new Date().toISOString().split('T')[0];

      const paidInstallments = installments.filter(i => i.status === 'paid');
      const pendingInstallments = installments.filter(i => i.status === 'pending');
      const overdueInstallments = pendingInstallments.filter(i => i.due_date < today);

      const totalPaid = paidInstallments.reduce((sum, i) => sum + i.amount, 0);
      const totalRemaining = pendingInstallments.reduce((sum, i) => sum + i.amount, 0);

      const nextDue = pendingInstallments
        .filter(i => i.due_date >= today)
        .sort((a, b) => a.due_date.localeCompare(b.due_date))[0];

      return {
        data: {
          plan: planResult.data,
          totalInstallments: installments.length,
          paidInstallments: paidInstallments.length,
          pendingInstallments: pendingInstallments.length,
          overdueInstallments: overdueInstallments.length,
          totalPaid,
          totalRemaining,
          nextDueDate: nextDue?.due_date || null
        },
        error: null
      };
    } catch (error) {
      logger.error({ err: error, planId, contactId, userId }, 'Failed to get plan summary');
      return { data: null, error: error as Error };
    }
  }

  // ==================== HELPER METHODS ====================

  /**
   * Add frequency interval to a date
   */
  private addFrequencyToDate(date: Date, frequency: InstallmentFrequency): Date {
    const newDate = new Date(date);

    switch (frequency) {
      case 'weekly':
        newDate.setDate(newDate.getDate() + 7);
        break;
      case 'biweekly':
        newDate.setDate(newDate.getDate() + 14);
        break;
      case 'monthly':
        newDate.setMonth(newDate.getMonth() + 1);
        break;
    }

    return newDate;
  }
}

// Singleton export
import { supabaseServer } from '@/lib/supabaseServer';
export const paymentPlanRepository = new PaymentPlanRepository(supabaseServer);
