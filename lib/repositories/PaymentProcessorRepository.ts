// lib/repositories/PaymentProcessorRepository.ts
// Repositories for payment processor connections and saved payment methods.
//
// Phase-2 of the Payments repo-layer conformance work. Mirrors the grouped
// multi-class shape of PaymentRepository.ts (constructor DI with a supabaseServer
// default, module-level Pino logger, { data, error } results, singleton exports,
// direct-path import — no index.ts barrel).

import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import type { PaymentRepositoryResult } from '@/lib/repositories/PaymentRepository';
import type { PaymentProcessorType } from '@/lib/services/PaymentEventService';

const logger = createLogger({ service: 'PaymentProcessorRepository' });

// ==================== TYPES ====================

export interface PaymentProcessor {
  id: string;
  user_id: string;
  processor_type: PaymentProcessorType;
  is_active: boolean;
  is_default: boolean;
  credentials: Record<string, unknown>;
  supports_checkout: boolean;
  supports_saved_methods: boolean;
  supports_refunds: boolean;
  supports_partial_refunds: boolean;
  connection_status: 'pending' | 'connected' | 'disconnected' | 'error';
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Raw `saved_payment_methods` row (snake_case). Callers map to their own view shape. */
export interface SavedPaymentMethodRow {
  id: string;
  user_id: string;
  contact_id: string;
  processor_type: PaymentProcessorType;
  processor_customer_id: string;
  processor_method_id: string;
  method_type: 'card' | 'bank_account' | 'paypal';
  last_four: string | null;
  brand: string | null;
  expiry_month: number | null;
  expiry_year: number | null;
  is_default: boolean;
  is_valid: boolean;
  created_at: string;
  updated_at: string;
}

// ==================== PROCESSOR REPOSITORY ====================

// `payment_processors` has an `updated_at` column but NO update trigger, so every
// update method sets `updated_at` manually.
export class PaymentProcessorRepository {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient = supabaseServer) {
    this.supabase = supabase;
  }

  /** All active + connected processors for a user. */
  async findConnected(userId: string): Promise<PaymentRepositoryResult<PaymentProcessor[]>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_processors')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .eq('connection_status', 'connected');

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to find connected processors');
      return { data: null, error: error as Error };
    }
  }

  /**
   * The user's default processor, falling back to any connected processor.
   *
   * M2: folds the service's "default row → else any-connected" fallback into one call.
   * M1: "no processor" is a graceful `{ data: null, error: null }` (via `.maybeSingle()`),
   * NEVER a thrown/returned error — callers treat a missing processor as a normal state.
   */
  async findDefault(userId: string): Promise<PaymentRepositoryResult<PaymentProcessor | null>> {
    try {
      const { data: defaultProcessor, error: defaultError } = await this.supabase
        .from('payment_processors')
        .select('*')
        .eq('user_id', userId)
        .eq('is_default', true)
        .eq('is_active', true)
        .eq('connection_status', 'connected')
        .maybeSingle();

      if (defaultError) throw defaultError;
      if (defaultProcessor) return { data: defaultProcessor, error: null };

      // No explicit default — fall back to any connected processor.
      const { data: anyProcessor, error: anyError } = await this.supabase
        .from('payment_processors')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .eq('connection_status', 'connected')
        .limit(1)
        .maybeSingle();

      if (anyError) throw anyError;
      return { data: anyProcessor || null, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to find default processor');
      return { data: null, error: error as Error };
    }
  }

  /**
   * A processor by its type.
   *
   * M1: not-found is a graceful `{ data: null, error: null }` (via `.maybeSingle()`),
   * never an error — the connect/charge/refund flows treat "no processor" as null.
   */
  async findByType(
    userId: string,
    processorType: PaymentProcessorType
  ): Promise<PaymentRepositoryResult<PaymentProcessor | null>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_processors')
        .select('*')
        .eq('user_id', userId)
        .eq('processor_type', processorType)
        .maybeSingle();

      if (error) throw error;
      return { data: data || null, error: null };
    } catch (error) {
      logger.error({ err: error, userId, processorType }, 'Failed to find processor by type');
      return { data: null, error: error as Error };
    }
  }

  async create(
    row: Omit<PaymentProcessor, 'id' | 'created_at' | 'updated_at'>
  ): Promise<PaymentRepositoryResult<PaymentProcessor>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_processors')
        .insert(row)
        .select()
        .single();

      if (error) throw error;
      logger.info({ processorId: data.id, userId: row.user_id }, 'Payment processor created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create payment processor');
      return { data: null, error: error as Error };
    }
  }

  async update(
    id: string,
    userId: string,
    patch: Partial<PaymentProcessor>
  ): Promise<PaymentRepositoryResult<PaymentProcessor>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_processors')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      logger.info({ processorId: id, userId }, 'Payment processor updated');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id, userId }, 'Failed to update payment processor');
      return { data: null, error: error as Error };
    }
  }

  /** Update the processor identified by type (used for disconnect). */
  async updateByType(
    userId: string,
    processorType: PaymentProcessorType,
    patch: Partial<PaymentProcessor>
  ): Promise<PaymentRepositoryResult<null>> {
    try {
      const { error } = await this.supabase
        .from('payment_processors')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('processor_type', processorType);

      if (error) throw error;
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, userId, processorType }, 'Failed to update processor by type');
      return { data: null, error: error as Error };
    }
  }

  /** Clear the current default flag for a user (part of a set-default operation). */
  async clearDefault(userId: string): Promise<PaymentRepositoryResult<null>> {
    try {
      const { error } = await this.supabase
        .from('payment_processors')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('is_default', true);

      if (error) throw error;
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to clear default processor');
      return { data: null, error: error as Error };
    }
  }

  /** Mark the processor of the given type as the default. */
  async setDefaultByType(
    userId: string,
    processorType: PaymentProcessorType
  ): Promise<PaymentRepositoryResult<null>> {
    try {
      const { error } = await this.supabase
        .from('payment_processors')
        .update({ is_default: true, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('processor_type', processorType);

      if (error) throw error;
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, userId, processorType }, 'Failed to set default processor');
      return { data: null, error: error as Error };
    }
  }
}

// ==================== SAVED PAYMENT METHOD REPOSITORY ====================

// `saved_payment_methods` has an `updated_at` column but NO update trigger, so
// update methods set `updated_at` manually.
export class SavedPaymentMethodRepository {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient = supabaseServer) {
    this.supabase = supabase;
  }

  async findById(id: string, userId: string): Promise<PaymentRepositoryResult<SavedPaymentMethodRow>> {
    try {
      const { data, error } = await this.supabase
        .from('saved_payment_methods')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id, userId }, 'Failed to find saved payment method');
      return { data: null, error: error as Error };
    }
  }

  /** Valid saved methods for a contact, default first then most recent. */
  async findValidByContact(
    userId: string,
    contactId: string
  ): Promise<PaymentRepositoryResult<SavedPaymentMethodRow[]>> {
    try {
      const { data, error } = await this.supabase
        .from('saved_payment_methods')
        .select('*')
        .eq('user_id', userId)
        .eq('contact_id', contactId)
        .eq('is_valid', true)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      logger.error({ err: error, userId, contactId }, 'Failed to find valid saved methods');
      return { data: null, error: error as Error };
    }
  }

  /** Clear default flags for a contact's saved methods (part of a set-default operation). */
  async clearContactDefaults(
    userId: string,
    contactId: string
  ): Promise<PaymentRepositoryResult<null>> {
    try {
      const { error } = await this.supabase
        .from('saved_payment_methods')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('contact_id', contactId)
        .eq('is_default', true);

      if (error) throw error;
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, userId, contactId }, 'Failed to clear contact default methods');
      return { data: null, error: error as Error };
    }
  }

  async create(
    row: Omit<SavedPaymentMethodRow, 'id' | 'created_at' | 'updated_at'>
  ): Promise<PaymentRepositoryResult<SavedPaymentMethodRow>> {
    try {
      const { data, error } = await this.supabase
        .from('saved_payment_methods')
        .insert(row)
        .select()
        .single();

      if (error) throw error;
      logger.info({ savedMethodId: data.id, userId: row.user_id }, 'Saved payment method created');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error }, 'Failed to create saved payment method');
      return { data: null, error: error as Error };
    }
  }

  async invalidate(id: string, userId: string): Promise<PaymentRepositoryResult<null>> {
    try {
      const { error } = await this.supabase
        .from('saved_payment_methods')
        .update({ is_valid: false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
      logger.info({ savedMethodId: id, userId }, 'Saved payment method invalidated');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, id, userId }, 'Failed to invalidate saved payment method');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton exports
export const paymentProcessorRepository = new PaymentProcessorRepository();
export const savedPaymentMethodRepository = new SavedPaymentMethodRepository();
