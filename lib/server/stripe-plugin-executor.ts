// lib/server/stripe-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { BasePluginExecutor } from './base-plugin-executor';
import { getStripeService } from '@/lib/stripe/StripeService';
import type Stripe from 'stripe';

const pluginName = 'stripe';

export class StripePluginExecutor extends BasePluginExecutor {
  private stripeService: ReturnType<typeof getStripeService>;

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
    this.stripeService = getStripeService();
  }

  // Execute Stripe action with validation and error handling
  protected async executeSpecificAction(
    connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    // Extract Stripe account ID from profile_data
    const stripeAccountId = connection.profile_data?.stripe_account_id;

    if (!stripeAccountId) {
      return {
        success: false,
        error: 'stripe_account_not_found',
        message: 'Stripe account ID not found in connection. Reconnect your Stripe account.'
      };
    }

    this.logger.debug({ actionName, stripeAccountId }, 'Executing Stripe action');

    // Execute the specific action
    let result: any;
    switch (actionName) {
      case 'create_checkout_session':
        result = await this.createCheckoutSession(stripeAccountId, parameters);
        break;
      case 'create_payment_intent':
        result = await this.createPaymentIntent(stripeAccountId, parameters);
        break;
      case 'charge_saved_method':
        result = await this.chargeSavedMethod(stripeAccountId, parameters);
        break;
      case 'refund_payment':
        result = await this.refundPayment(stripeAccountId, parameters);
        break;
      case 'refund_partial':
        result = await this.refundPartial(stripeAccountId, parameters);
        break;
      case 'create_subscription':
        result = await this.createSubscription(stripeAccountId, parameters);
        break;
      case 'update_subscription':
        result = await this.updateSubscription(stripeAccountId, parameters);
        break;
      case 'cancel_subscription':
        result = await this.cancelSubscription(stripeAccountId, parameters);
        break;
      case 'list_subscriptions':
        result = await this.listSubscriptions(stripeAccountId, parameters);
        break;
      case 'create_customer':
        result = await this.createCustomer(stripeAccountId, parameters);
        break;
      case 'get_customer':
        result = await this.getCustomer(stripeAccountId, parameters);
        break;
      case 'list_customers':
        result = await this.listCustomers(stripeAccountId, parameters);
        break;
      case 'list_payment_methods':
        result = await this.listPaymentMethods(stripeAccountId, parameters);
        break;
      case 'get_payment':
        result = await this.getPayment(stripeAccountId, parameters);
        break;
      default:
        return {
          success: false,
          error: 'unknown_action',
          message: `Action ${actionName} not supported`
        };
    }

    return result;
  }

  // =====================================================
  // PAYMENT COLLECTION ACTIONS
  // =====================================================

  private async createCheckoutSession(accountId: string, params: any): Promise<any> {
    this.logger.debug('Creating Stripe checkout session');

    const { amount, currency, customer_email, success_url, cancel_url, description } = params;

    try {
      // Access Stripe SDK via service
      const stripe = (this.stripeService as any).stripe;

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: currency || 'usd',
              product_data: {
                name: description || 'Payment',
              },
              unit_amount: amount,
            },
            quantity: 1,
          },
        ],
        success_url: success_url,
        cancel_url: cancel_url || success_url,
        customer_email: customer_email || undefined,
      }, {
        stripeAccount: accountId, // Key for Connect accounts
      });

      return {
        success: true,
        data: {
          session_id: session.id,
          url: session.url,
          amount: amount,
          currency: currency || 'usd',
          expires_at: new Date(session.expires_at * 1000).toISOString(),
        },
        message: 'Checkout session created successfully'
      };

    } catch (error: any) {
      this.logger.error({ err: error, accountId }, 'Error creating checkout session');
      throw error;
    }
  }

  private async createPaymentIntent(accountId: string, params: any): Promise<any> {
    this.logger.debug('Creating payment intent');

    const { amount, currency, customer_id, payment_method_id, description, confirm } = params;

    try {
      const stripe = (this.stripeService as any).stripe;

      const paymentIntentData: Stripe.PaymentIntentCreateParams = {
        amount,
        currency: currency || 'usd',
        description: description || undefined,
      };

      if (customer_id) {
        paymentIntentData.customer = customer_id;
      }

      if (payment_method_id) {
        paymentIntentData.payment_method = payment_method_id;
      }

      if (confirm) {
        paymentIntentData.confirm = true;
      }

      const paymentIntent = await stripe.paymentIntents.create(
        paymentIntentData,
        { stripeAccount: accountId }
      );

      return {
        success: true,
        data: {
          payment_intent_id: paymentIntent.id,
          client_secret: paymentIntent.client_secret,
          status: paymentIntent.status,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
        },
        message: 'Payment intent created successfully'
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error creating payment intent');
      throw error;
    }
  }

  private async chargeSavedMethod(accountId: string, params: any): Promise<any> {
    this.logger.debug('Charging saved payment method');

    const { customer_id, payment_method_id, amount, currency, description } = params;

    try {
      const stripe = (this.stripeService as any).stripe;

      // Create and confirm payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: currency || 'usd',
        customer: customer_id,
        payment_method: payment_method_id,
        confirm: true,
        description: description || undefined,
        off_session: true, // Allow charging without customer present
      }, {
        stripeAccount: accountId
      });

      return {
        success: true,
        data: {
          charge_id: paymentIntent.latest_charge,
          status: paymentIntent.status,
          receipt_url: paymentIntent.charges?.data[0]?.receipt_url || null,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
        },
        message: 'Payment method charged successfully'
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error charging saved method');
      throw error;
    }
  }

  // =====================================================
  // REFUND ACTIONS
  // =====================================================

  private async refundPayment(accountId: string, params: any): Promise<any> {
    this.logger.debug('Processing full refund');

    const { payment_intent_id, reason } = params;

    try {
      const stripe = (this.stripeService as any).stripe;

      const refund = await stripe.refunds.create({
        payment_intent: payment_intent_id,
        reason: reason || 'requested_by_customer',
      }, {
        stripeAccount: accountId
      });

      return {
        success: true,
        data: {
          refund_id: refund.id,
          status: refund.status,
          amount: refund.amount,
          currency: refund.currency,
        },
        message: 'Refund processed successfully'
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error processing refund');
      throw error;
    }
  }

  private async refundPartial(accountId: string, params: any): Promise<any> {
    this.logger.debug('Processing partial refund');

    const { payment_intent_id, amount, reason } = params;

    try {
      const stripe = (this.stripeService as any).stripe;

      const refund = await stripe.refunds.create({
        payment_intent: payment_intent_id,
        amount,
        reason: reason || 'requested_by_customer',
      }, {
        stripeAccount: accountId
      });

      // Get original payment intent to calculate remaining
      const paymentIntent = await stripe.paymentIntents.retrieve(
        payment_intent_id,
        { stripeAccount: accountId }
      );

      const totalRefunded = paymentIntent.amount_refunded || 0;
      const amountRemaining = paymentIntent.amount - totalRefunded;

      return {
        success: true,
        data: {
          refund_id: refund.id,
          amount_refunded: refund.amount,
          amount_remaining: amountRemaining,
          currency: refund.currency,
        },
        message: 'Partial refund processed successfully'
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error processing partial refund');
      throw error;
    }
  }

  // =====================================================
  // SUBSCRIPTION ACTIONS
  // =====================================================

  private async createSubscription(accountId: string, params: any): Promise<any> {
    this.logger.debug('Creating subscription');

    const { customer_id, price_id, trial_days, payment_method_id } = params;

    try {
      const stripe = (this.stripeService as any).stripe;

      const subscriptionData: Stripe.SubscriptionCreateParams = {
        customer: customer_id,
        items: [{ price: price_id }],
      };

      if (trial_days && trial_days > 0) {
        subscriptionData.trial_period_days = trial_days;
      }

      if (payment_method_id) {
        subscriptionData.default_payment_method = payment_method_id;
      }

      const subscription = await stripe.subscriptions.create(
        subscriptionData,
        { stripeAccount: accountId }
      );

      return {
        success: true,
        data: {
          subscription_id: subscription.id,
          status: subscription.status,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
        },
        message: 'Subscription created successfully'
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error creating subscription');
      throw error;
    }
  }

  private async updateSubscription(accountId: string, params: any): Promise<any> {
    this.logger.debug('Updating subscription');

    const { subscription_id, new_price_id, cancel_at_period_end } = params;

    try {
      const stripe = (this.stripeService as any).stripe;

      const updateData: Stripe.SubscriptionUpdateParams = {};

      if (new_price_id) {
        // Get current subscription to update items
        const currentSub = await stripe.subscriptions.retrieve(
          subscription_id,
          { stripeAccount: accountId }
        );

        updateData.items = [{
          id: currentSub.items.data[0].id,
          price: new_price_id,
        }];
      }

      if (typeof cancel_at_period_end === 'boolean') {
        updateData.cancel_at_period_end = cancel_at_period_end;
      }

      const subscription = await stripe.subscriptions.update(
        subscription_id,
        updateData,
        { stripeAccount: accountId }
      );

      return {
        success: true,
        data: {
          subscription_id: subscription.id,
          status: subscription.status,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          cancel_at_period_end: subscription.cancel_at_period_end,
        },
        message: 'Subscription updated successfully'
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error updating subscription');
      throw error;
    }
  }

  private async cancelSubscription(accountId: string, params: any): Promise<any> {
    this.logger.debug('Canceling subscription');

    const { subscription_id, immediate } = params;

    try {
      const stripe = (this.stripeService as any).stripe;

      let subscription: Stripe.Subscription;

      if (immediate) {
        // Cancel immediately
        subscription = await stripe.subscriptions.cancel(
          subscription_id,
          { stripeAccount: accountId }
        );
      } else {
        // Cancel at period end
        subscription = await stripe.subscriptions.update(
          subscription_id,
          { cancel_at_period_end: true },
          { stripeAccount: accountId }
        );
      }

      return {
        success: true,
        data: {
          subscription_id: subscription.id,
          status: subscription.status,
          canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
          ended_at: subscription.ended_at ? new Date(subscription.ended_at * 1000).toISOString() : null,
        },
        message: immediate ? 'Subscription canceled immediately' : 'Subscription will cancel at period end'
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error canceling subscription');
      throw error;
    }
  }

  private async listSubscriptions(accountId: string, params: any): Promise<any> {
    this.logger.debug('Listing subscriptions');

    const { customer_id, status, limit } = params;

    try {
      const stripe = (this.stripeService as any).stripe;

      const listParams: Stripe.SubscriptionListParams = {
        limit: Math.min(limit || 50, 100),
      };

      if (customer_id) {
        listParams.customer = customer_id;
      }

      if (status && status !== 'all') {
        listParams.status = status;
      }

      const subscriptions = await stripe.subscriptions.list(
        listParams,
        { stripeAccount: accountId }
      );

      const formattedSubscriptions = subscriptions.data.map((sub: Stripe.Subscription) => ({
        subscription_id: sub.id,
        customer_id: sub.customer as string,
        status: sub.status,
        current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        plan_name: sub.items.data[0]?.price?.product as string || 'Unknown',
        amount: sub.items.data[0]?.price?.unit_amount || 0,
        currency: sub.items.data[0]?.price?.currency || 'usd',
      }));

      return {
        success: true,
        data: {
          subscriptions: formattedSubscriptions,
          total_count: formattedSubscriptions.length,
          has_more: subscriptions.has_more,
        },
        message: `Retrieved ${formattedSubscriptions.length} subscription(s)`
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error listing subscriptions');
      throw error;
    }
  }

  // =====================================================
  // CUSTOMER ACTIONS
  // =====================================================

  private async createCustomer(accountId: string, params: any): Promise<any> {
    this.logger.debug('Creating customer');

    const { email, name, phone, metadata } = params;

    try {
      const stripe = (this.stripeService as any).stripe;

      const customer = await stripe.customers.create({
        email,
        name: name || undefined,
        phone: phone || undefined,
        metadata: metadata || undefined,
      }, {
        stripeAccount: accountId
      });

      return {
        success: true,
        data: {
          customer_id: customer.id,
          email: customer.email,
          name: customer.name,
          created_at: new Date(customer.created * 1000).toISOString(),
        },
        message: 'Customer created successfully'
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error creating customer');
      throw error;
    }
  }

  private async getCustomer(accountId: string, params: any): Promise<any> {
    this.logger.debug('Getting customer');

    const { customer_id } = params;

    try {
      const stripe = (this.stripeService as any).stripe;

      const customer = await stripe.customers.retrieve(
        customer_id,
        { stripeAccount: accountId }
      );

      return {
        success: true,
        data: {
          customer_id: customer.id,
          email: customer.email,
          name: customer.name,
          phone: customer.phone,
          default_payment_method: customer.invoice_settings?.default_payment_method || null,
          balance: customer.balance || 0,
        },
        message: 'Customer retrieved successfully'
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error getting customer');
      throw error;
    }
  }

  private async listCustomers(accountId: string, params: any): Promise<any> {
    this.logger.debug('Listing customers');

    const { email, limit } = params;

    try {
      const stripe = (this.stripeService as any).stripe;

      const listParams: Stripe.CustomerListParams = {
        limit: Math.min(limit || 50, 100),
      };

      if (email) {
        listParams.email = email;
      }

      const customers = await stripe.customers.list(
        listParams,
        { stripeAccount: accountId }
      );

      const formattedCustomers = customers.data.map((customer: Stripe.Customer) => ({
        customer_id: customer.id,
        email: customer.email,
        name: customer.name,
        created_at: new Date(customer.created * 1000).toISOString(),
      }));

      return {
        success: true,
        data: {
          customers: formattedCustomers,
          total_count: formattedCustomers.length,
          has_more: customers.has_more,
        },
        message: `Retrieved ${formattedCustomers.length} customer(s)`
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error listing customers');
      throw error;
    }
  }

  private async listPaymentMethods(accountId: string, params: any): Promise<any> {
    this.logger.debug('Listing payment methods');

    const { customer_id, type } = params;

    try {
      const stripe = (this.stripeService as any).stripe;

      const paymentMethods = await stripe.paymentMethods.list({
        customer: customer_id,
        type: type || 'card',
      }, {
        stripeAccount: accountId
      });

      const formattedMethods = paymentMethods.data.map((pm: Stripe.PaymentMethod) => ({
        payment_method_id: pm.id,
        type: pm.type,
        card_brand: pm.card?.brand || null,
        last4: pm.card?.last4 || null,
        exp_month: pm.card?.exp_month || null,
        exp_year: pm.card?.exp_year || null,
      }));

      return {
        success: true,
        data: {
          payment_methods: formattedMethods,
          total_count: formattedMethods.length,
        },
        message: `Retrieved ${formattedMethods.length} payment method(s)`
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error listing payment methods');
      throw error;
    }
  }

  // =====================================================
  // PAYMENT STATUS
  // =====================================================

  private async getPayment(accountId: string, params: any): Promise<any> {
    this.logger.debug('Getting payment');

    const { payment_intent_id } = params;

    try {
      const stripe = (this.stripeService as any).stripe;

      const paymentIntent = await stripe.paymentIntents.retrieve(
        payment_intent_id,
        { stripeAccount: accountId }
      );

      const charge = paymentIntent.charges?.data[0];

      return {
        success: true,
        data: {
          payment_intent_id: paymentIntent.id,
          status: paymentIntent.status,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          customer_id: paymentIntent.customer as string || null,
          receipt_url: charge?.receipt_url || null,
          created_at: new Date(paymentIntent.created * 1000).toISOString(),
        },
        message: 'Payment retrieved successfully'
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Error getting payment');
      throw error;
    }
  }

  // =====================================================
  // ERROR HANDLING
  // =====================================================

  // Override to handle Stripe-specific errors
  protected mapPluginSpecificError(error: any, commonErrors: Record<string, string>): string | null {
    const errorMsg = error.message || '';
    const errorType = error.type || '';
    const errorCode = error.code || '';

    // Stripe-specific error patterns
    if (errorType === 'StripeCardError') {
      if (errorCode === 'card_declined') {
        return commonErrors.card_declined || 'Card was declined. Contact customer for updated payment method.';
      }
      if (errorCode === 'insufficient_funds') {
        return commonErrors.insufficient_funds || 'Customer has insufficient funds.';
      }
    }

    if (errorType === 'StripeInvalidRequestError') {
      if (errorMsg.includes('No such customer')) {
        return commonErrors.customer_not_found || 'Customer not found in your Stripe account.';
      }
      if (errorMsg.includes('No such payment_intent')) {
        return commonErrors.payment_not_found || 'Payment not found. Verify the payment intent ID.';
      }
      if (errorMsg.includes('No such price')) {
        return commonErrors.price_not_found || 'Price ID not found. Create price in Stripe Dashboard first.';
      }
      if (errorMsg.includes('has already been refunded')) {
        return commonErrors.already_refunded || 'Payment has already been fully refunded.';
      }
      if (errorMsg.includes('No such subscription')) {
        return commonErrors.subscription_not_found || 'Subscription not found.';
      }
    }

    if (errorMsg.includes('account is not fully onboarded')) {
      return commonErrors.account_not_ready || 'Stripe account not fully onboarded. Complete setup in Stripe Dashboard.';
    }

    if (errorType === 'StripePermissionError') {
      return commonErrors.insufficient_permissions || 'Insufficient permissions. Check Stripe account access.';
    }

    if (errorType === 'StripeRateLimitError') {
      return commonErrors.api_rate_limit || 'Stripe API rate limit exceeded. Please wait and try again.';
    }

    // Return null to fall back to common error handling
    return null;
  }

  // Test connection with a simple API call
  protected async performConnectionTest(connection: any): Promise<any> {
    const stripeAccountId = connection.profile_data?.stripe_account_id;

    if (!stripeAccountId) {
      throw new Error('Stripe account ID not found in connection');
    }

    try {
      const stripe = (this.stripeService as any).stripe;

      // Retrieve account details
      const account = await stripe.accounts.retrieve(stripeAccountId);

      return {
        success: true,
        data: {
          account_id: account.id,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          country: account.country,
        },
        message: 'Stripe connection active'
      };

    } catch (error: any) {
      this.logger.error({ err: error }, 'Connection test failed');
      throw error;
    }
  }
}
