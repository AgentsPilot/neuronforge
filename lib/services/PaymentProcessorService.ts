/**
 * Payment Processor Service
 *
 * Processor-agnostic abstraction layer for payment operations.
 * Supports multiple payment processors: Stripe, PayPal, Square, Manual
 *
 * This service provides a unified interface for:
 * 1. Creating checkout sessions
 * 2. Processing payments with saved methods
 * 3. Processing refunds
 * 4. Managing saved payment methods
 *
 * Each processor has its own executor that implements the operations.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { PaymentProcessorType } from '@/lib/services/PaymentEventService';
import {
  PaymentProcessorRepository,
  SavedPaymentMethodRepository,
} from '@/lib/repositories/PaymentProcessorRepository';

const logger = createLogger({ service: 'PaymentProcessorService' });

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

export interface CheckoutSessionRequest {
  amount: number;
  currency: string;
  description?: string;
  contactId?: string;
  invoiceId?: string;
  bookingId?: string;
  installmentId?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, unknown>;
}

export interface CheckoutSessionResult {
  sessionId: string;
  checkoutUrl: string;
  processorType: PaymentProcessorType;
  expiresAt?: string;
}

export interface ChargeRequest {
  amount: number;
  currency: string;
  contactId: string;
  savedMethodId?: string;
  description?: string;
  invoiceId?: string;
  installmentId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChargeResult {
  transactionId: string;
  processorTransactionId: string;
  processorType: PaymentProcessorType;
  status: 'succeeded' | 'failed' | 'pending';
  failureReason?: string;
}

export interface RefundRequest {
  processorTransactionId: string;
  amount: number;
  reason?: string;
}

export interface RefundResult {
  refundId: string;
  processorRefundId: string;
  processorType: PaymentProcessorType;
  status: 'succeeded' | 'failed' | 'pending';
  failureReason?: string;
}

export interface SavedPaymentMethod {
  id: string;
  contactId: string;
  processorType: PaymentProcessorType;
  processorCustomerId: string;
  processorMethodId: string;
  methodType: 'card' | 'bank_account' | 'paypal';
  lastFour: string | null;
  brand: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  isDefault: boolean;
  isValid: boolean;
}

export interface PaymentProcessorServiceResult<T> {
  data: T | null;
  error: Error | null;
}

// ==================== PROCESSOR INTERFACE ====================

/**
 * Interface that each processor executor must implement
 */
export interface IPaymentProcessorExecutor {
  processorType: PaymentProcessorType;

  // Check if processor is connected and ready
  isReady(userId: string): Promise<boolean>;

  // Create a checkout session
  createCheckoutSession(
    userId: string,
    request: CheckoutSessionRequest
  ): Promise<PaymentProcessorServiceResult<CheckoutSessionResult>>;

  // Charge a saved payment method
  chargeWithSavedMethod(
    userId: string,
    request: ChargeRequest
  ): Promise<PaymentProcessorServiceResult<ChargeResult>>;

  // Process a refund
  processRefund(
    userId: string,
    request: RefundRequest
  ): Promise<PaymentProcessorServiceResult<RefundResult>>;

  // Get saved payment methods for a contact
  getSavedMethods(
    userId: string,
    contactId: string
  ): Promise<PaymentProcessorServiceResult<SavedPaymentMethod[]>>;

  // Verify payment status
  getPaymentStatus(
    userId: string,
    sessionId: string
  ): Promise<PaymentProcessorServiceResult<'paid' | 'unpaid' | 'expired' | 'unknown'>>;
}

// ==================== PROCESSOR REGISTRY ====================

const processorExecutors: Map<PaymentProcessorType, IPaymentProcessorExecutor> = new Map();

/**
 * Register a processor executor
 */
export function registerProcessorExecutor(executor: IPaymentProcessorExecutor): void {
  processorExecutors.set(executor.processorType, executor);
  logger.info({ processorType: executor.processorType }, 'Payment processor executor registered');
}

/**
 * Get a processor executor
 */
export function getProcessorExecutor(processorType: PaymentProcessorType): IPaymentProcessorExecutor | null {
  return processorExecutors.get(processorType) || null;
}

// ==================== SERVICE ====================

export class PaymentProcessorService {
  private supabase: SupabaseClient;
  private processorRepo: PaymentProcessorRepository;
  private savedMethodRepo: SavedPaymentMethodRepository;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
    this.processorRepo = new PaymentProcessorRepository(supabaseClient);
    this.savedMethodRepo = new SavedPaymentMethodRepository(supabaseClient);
  }

  // ==================== PROCESSOR MANAGEMENT ====================

  /**
   * Get all connected processors for a user
   */
  async getConnectedProcessors(userId: string): Promise<PaymentProcessorServiceResult<PaymentProcessor[]>> {
    const { data, error } = await this.processorRepo.findConnected(userId);
    if (error) {
      logger.error({ err: error, userId }, 'Failed to get connected processors');
      return { data: null, error };
    }
    return { data: data || [], error: null };
  }

  /**
   * Get the default processor for a user
   */
  async getDefaultProcessor(userId: string): Promise<PaymentProcessorServiceResult<PaymentProcessor | null>> {
    // Repo folds the "default row → else any-connected" fallback and returns a
    // graceful null (never an error) when the user has no connected processor.
    const { data, error } = await this.processorRepo.findDefault(userId);
    if (error) {
      logger.error({ err: error, userId }, 'Failed to get default processor');
      return { data: null, error };
    }
    return { data: data || null, error: null };
  }

  /**
   * Get a specific processor by type
   */
  async getProcessor(
    userId: string,
    processorType: PaymentProcessorType
  ): Promise<PaymentProcessorServiceResult<PaymentProcessor | null>> {
    // Repo returns a graceful null on not-found (never an error).
    const { data, error } = await this.processorRepo.findByType(userId, processorType);
    if (error) {
      logger.error({ err: error, userId, processorType }, 'Failed to get processor');
      return { data: null, error };
    }
    return { data: data || null, error: null };
  }

  /**
   * Connect a payment processor
   */
  async connectProcessor(
    userId: string,
    processorType: PaymentProcessorType,
    credentials: Record<string, unknown>
  ): Promise<PaymentProcessorServiceResult<PaymentProcessor>> {
    try {
      logger.info({ userId, processorType }, 'Connecting payment processor');

      // Check if already exists
      const existing = await this.getProcessor(userId, processorType);
      if (existing.data) {
        // Update existing
        const { data, error } = await this.processorRepo.update(existing.data.id, userId, {
          credentials,
          is_active: true,
          connection_status: 'connected',
          last_verified_at: new Date().toISOString(),
        });

        if (error) throw error;
        return { data, error: null };
      }

      // Create new
      const { data, error } = await this.processorRepo.create({
        user_id: userId,
        processor_type: processorType,
        is_active: true,
        is_default: false,
        credentials,
        supports_checkout: true,
        supports_saved_methods: processorType !== 'manual',
        supports_refunds: true,
        supports_partial_refunds: processorType !== 'manual',
        connection_status: 'connected',
        last_verified_at: new Date().toISOString(),
      });

      if (error) throw error;

      logger.info({ userId, processorType, processorId: data!.id }, 'Payment processor connected');
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId, processorType }, 'Failed to connect processor');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Disconnect a payment processor
   */
  async disconnectProcessor(
    userId: string,
    processorType: PaymentProcessorType
  ): Promise<PaymentProcessorServiceResult<void>> {
    try {
      logger.info({ userId, processorType }, 'Disconnecting payment processor');

      const { error } = await this.processorRepo.updateByType(userId, processorType, {
        is_active: false,
        connection_status: 'disconnected',
        credentials: {},
      });

      if (error) throw error;

      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, userId, processorType }, 'Failed to disconnect processor');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Set default processor
   */
  async setDefaultProcessor(
    userId: string,
    processorType: PaymentProcessorType
  ): Promise<PaymentProcessorServiceResult<void>> {
    try {
      // Clear existing default
      await this.processorRepo.clearDefault(userId);

      // Set new default
      const { error } = await this.processorRepo.setDefaultByType(userId, processorType);

      if (error) throw error;

      logger.info({ userId, processorType }, 'Default processor updated');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, userId, processorType }, 'Failed to set default processor');
      return { data: null, error: error as Error };
    }
  }

  // ==================== PAYMENT OPERATIONS ====================

  /**
   * Create a checkout session using the specified or default processor
   */
  async createCheckoutSession(
    userId: string,
    request: CheckoutSessionRequest,
    processorType?: PaymentProcessorType
  ): Promise<PaymentProcessorServiceResult<CheckoutSessionResult>> {
    try {
      // Get processor
      let processor: PaymentProcessor | null;
      if (processorType) {
        const result = await this.getProcessor(userId, processorType);
        processor = result.data;
      } else {
        const result = await this.getDefaultProcessor(userId);
        processor = result.data;
      }

      if (!processor) {
        throw new Error('No payment processor configured. Please connect a payment processor.');
      }

      if (!processor.supports_checkout) {
        throw new Error(`${processor.processor_type} does not support checkout sessions.`);
      }

      // Get executor
      const executor = getProcessorExecutor(processor.processor_type as PaymentProcessorType);
      if (!executor) {
        throw new Error(`No executor registered for ${processor.processor_type}`);
      }

      // Create session
      return await executor.createCheckoutSession(userId, request);
    } catch (error) {
      logger.error({ err: error, userId, processorType }, 'Failed to create checkout session');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Charge a saved payment method
   */
  async chargeWithSavedMethod(
    userId: string,
    request: ChargeRequest,
    processorType?: PaymentProcessorType
  ): Promise<PaymentProcessorServiceResult<ChargeResult>> {
    try {
      // Get saved method to determine processor
      if (request.savedMethodId) {
        const { data: method, error: methodError } = await this.savedMethodRepo.findById(
          request.savedMethodId,
          userId
        );

        if (methodError) throw methodError;
        processorType = method!.processor_type as PaymentProcessorType;
      }

      // Get processor
      let processor: PaymentProcessor | null;
      if (processorType) {
        const result = await this.getProcessor(userId, processorType);
        processor = result.data;
      } else {
        const result = await this.getDefaultProcessor(userId);
        processor = result.data;
      }

      if (!processor) {
        throw new Error('No payment processor configured.');
      }

      if (!processor.supports_saved_methods) {
        throw new Error(`${processor.processor_type} does not support saved payment methods.`);
      }

      // Get executor
      const executor = getProcessorExecutor(processor.processor_type as PaymentProcessorType);
      if (!executor) {
        throw new Error(`No executor registered for ${processor.processor_type}`);
      }

      return await executor.chargeWithSavedMethod(userId, request);
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to charge saved method');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Process a refund
   */
  async processRefund(
    userId: string,
    request: RefundRequest,
    processorType: PaymentProcessorType
  ): Promise<PaymentProcessorServiceResult<RefundResult>> {
    try {
      // Get processor
      const processorResult = await this.getProcessor(userId, processorType);
      const processor = processorResult.data;

      if (!processor) {
        throw new Error(`Processor ${processorType} not configured.`);
      }

      if (!processor.supports_refunds) {
        throw new Error(`${processorType} does not support refunds.`);
      }

      // Get executor
      const executor = getProcessorExecutor(processorType);
      if (!executor) {
        throw new Error(`No executor registered for ${processorType}`);
      }

      return await executor.processRefund(userId, request);
    } catch (error) {
      logger.error({ err: error, userId, processorType }, 'Failed to process refund');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get saved payment methods for a contact
   */
  async getSavedPaymentMethods(
    userId: string,
    contactId: string
  ): Promise<PaymentProcessorServiceResult<SavedPaymentMethod[]>> {
    try {
      const { data, error } = await this.savedMethodRepo.findValidByContact(userId, contactId);

      if (error) throw error;

      const methods: SavedPaymentMethod[] = (data || []).map(m => ({
        id: m.id,
        contactId: m.contact_id,
        processorType: m.processor_type,
        processorCustomerId: m.processor_customer_id,
        processorMethodId: m.processor_method_id,
        methodType: m.method_type,
        lastFour: m.last_four,
        brand: m.brand,
        expiryMonth: m.expiry_month,
        expiryYear: m.expiry_year,
        isDefault: m.is_default,
        isValid: m.is_valid
      }));

      return { data: methods, error: null };
    } catch (error) {
      logger.error({ err: error, userId, contactId }, 'Failed to get saved payment methods');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Get checkout session status
   */
  async getCheckoutStatus(
    userId: string,
    sessionId: string,
    processorType: PaymentProcessorType
  ): Promise<PaymentProcessorServiceResult<'paid' | 'unpaid' | 'expired' | 'unknown'>> {
    try {
      const executor = getProcessorExecutor(processorType);
      if (!executor) {
        throw new Error(`No executor registered for ${processorType}`);
      }

      return await executor.getPaymentStatus(userId, sessionId);
    } catch (error) {
      logger.error({ err: error, userId, sessionId, processorType }, 'Failed to get checkout status');
      return { data: null, error: error as Error };
    }
  }

  // ==================== SAVED METHODS MANAGEMENT ====================

  /**
   * Save a payment method for a contact
   */
  async savePaymentMethod(
    userId: string,
    methodData: {
      contactId: string;
      processorType: PaymentProcessorType;
      processorCustomerId: string;
      processorMethodId: string;
      methodType: 'card' | 'bank_account' | 'paypal';
      lastFour?: string;
      brand?: string;
      expiryMonth?: number;
      expiryYear?: number;
      setAsDefault?: boolean;
    }
  ): Promise<PaymentProcessorServiceResult<SavedPaymentMethod>> {
    try {
      logger.info({
        userId,
        contactId: methodData.contactId,
        processorType: methodData.processorType
      }, 'Saving payment method');

      // If setting as default, clear other defaults first
      if (methodData.setAsDefault) {
        await this.savedMethodRepo.clearContactDefaults(userId, methodData.contactId);
      }

      const { data, error } = await this.savedMethodRepo.create({
        user_id: userId,
        contact_id: methodData.contactId,
        processor_type: methodData.processorType,
        processor_customer_id: methodData.processorCustomerId,
        processor_method_id: methodData.processorMethodId,
        method_type: methodData.methodType,
        last_four: methodData.lastFour || null,
        brand: methodData.brand || null,
        expiry_month: methodData.expiryMonth || null,
        expiry_year: methodData.expiryYear || null,
        is_default: methodData.setAsDefault || false,
        is_valid: true,
      });

      if (error) throw error;

      logger.info({ savedMethodId: data!.id }, 'Payment method saved');
      return {
        data: {
          id: data!.id,
          contactId: data!.contact_id,
          processorType: data!.processor_type,
          processorCustomerId: data!.processor_customer_id,
          processorMethodId: data!.processor_method_id,
          methodType: data!.method_type,
          lastFour: data!.last_four,
          brand: data!.brand,
          expiryMonth: data!.expiry_month,
          expiryYear: data!.expiry_year,
          isDefault: data!.is_default,
          isValid: data!.is_valid
        },
        error: null
      };
    } catch (error) {
      logger.error({ err: error, userId }, 'Failed to save payment method');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Invalidate a saved payment method
   */
  async invalidatePaymentMethod(
    userId: string,
    methodId: string
  ): Promise<PaymentProcessorServiceResult<void>> {
    try {
      const { error } = await this.savedMethodRepo.invalidate(methodId, userId);

      if (error) throw error;

      logger.info({ methodId }, 'Payment method invalidated');
      return { data: null, error: null };
    } catch (error) {
      logger.error({ err: error, userId, methodId }, 'Failed to invalidate payment method');
      return { data: null, error: error as Error };
    }
  }
}

// Singleton export
import { supabaseServer } from '@/lib/supabaseServer';
export const paymentProcessorService = new PaymentProcessorService(supabaseServer);
