/**
 * Invoice Settings API
 * GET/PUT /api/business-os/invoice-settings
 *
 * Manages invoice-specific settings in business_profiles
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { z } from 'zod';

const logger = createLogger({ module: 'InvoiceSettingsAPI' });

// Validation schema for invoice settings
const invoiceAddressSchema = z.object({
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().optional(),
}).optional();

const invoiceSettingsSchema = z.object({
  invoice_company_name: z.string().max(200).optional(),
  invoice_address: invoiceAddressSchema,
  invoice_tax_id: z.string().max(50).optional(),
  invoice_bank_name: z.string().max(100).optional(),
  invoice_bank_account: z.string().max(50).optional(),
  invoice_bank_routing: z.string().max(50).optional(),
  invoice_payment_instructions: z.string().max(1000).optional(),
  invoice_footer_text: z.string().max(500).optional(),
  invoice_number_prefix: z.string().max(10).optional(),

  // Tax, as the business states it. Display only — the platform never adds tax
  // to a price. The rate bounds match the database CHECK: a value outside them
  // is a typo rather than an instruction, and 100 is excluded because the tax
  // cannot be the whole of an inclusive price.
  invoice_prices_include_tax: z.boolean().optional(),
  invoice_tax_rate: z.number().gt(0).lt(100).nullable().optional(),
  invoice_tax_label: z.string().max(30).nullable().optional(),

  // Null is a real value here, not an omission: it means "follow the derived
  // default", which is different from "leave what is stored alone". Hence
  // `.nullable()` before `.optional()`.
  invoice_document_type: z.enum(['receipt', 'invoice', 'tax_invoice']).nullable().optional(),
});

/**
 * GET - Retrieve invoice settings
 */
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    requestLogger.info({ userId: user.id }, 'Getting invoice settings');

    // 2. Fetch invoice settings
    const { data: settings, error } = await businessProfileRepository.getInvoiceSettings(user.id);

    if (error) {
      requestLogger.error({ err: error }, 'Failed to get invoice settings');
      return NextResponse.json(
        { success: false, error: 'Failed to get invoice settings' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: settings,
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Unexpected error getting invoice settings');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT - Update invoice settings
 */
export async function PUT(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Parse and validate body
    const body = await request.json();
    const validationResult = invoiceSettingsSchema.safeParse(body);

    if (!validationResult.success) {
      requestLogger.warn({ errors: validationResult.error.errors }, 'Invalid invoice settings');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid invoice settings',
          details: validationResult.error.errors,
        },
        { status: 400 }
      );
    }

    const settings = validationResult.data;

    requestLogger.info({ userId: user.id }, 'Updating invoice settings');

    // 3. Update invoice settings
    const { data: updated, error } = await businessProfileRepository.updateInvoiceSettings(
      user.id,
      {
        invoice_company_name: settings.invoice_company_name || null,
        invoice_address: settings.invoice_address || {},
        invoice_tax_id: settings.invoice_tax_id || null,
        invoice_bank_name: settings.invoice_bank_name || null,
        invoice_bank_account: settings.invoice_bank_account || null,
        invoice_bank_routing: settings.invoice_bank_routing || null,
        invoice_payment_instructions: settings.invoice_payment_instructions || null,
        invoice_footer_text: settings.invoice_footer_text || null,
        invoice_number_prefix: settings.invoice_number_prefix || 'INV',

        // Passed through undefined-and-all: the repository skips keys that are
        // `undefined`, so a caller that does not send these leaves them as they
        // were. Coercing to a default here — the pattern the fields above use —
        // would switch tax off for any client posting a partial body.
        invoice_prices_include_tax: settings.invoice_prices_include_tax,
        invoice_tax_rate: settings.invoice_tax_rate,
        invoice_tax_label: settings.invoice_tax_label,
        invoice_document_type: settings.invoice_document_type,
        // The logo is not an invoice setting — it belongs to the business and is
        // written through updateBranding. Passing it here is what used to null
        // it on every save of this form.
      }
    );

    if (error) {
      requestLogger.error({ err: error }, 'Failed to update invoice settings');
      return NextResponse.json(
        { success: false, error: 'Failed to update invoice settings' },
        { status: 500 }
      );
    }

    requestLogger.info({ userId: user.id }, 'Invoice settings updated successfully');

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Unexpected error updating invoice settings');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
