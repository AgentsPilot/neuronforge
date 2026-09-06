import { generateInvoicePDFAsync } from '@/lib/pdf/InvoicePDFGenerator';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function testInvoicePDF() {
  console.log('Generating Hebrew invoice PDF with @react-pdf/renderer...');

  const testInvoice = {
    id: 'test-invoice-123',
    user_id: 'test-user',
    invoice_number: 'INV-2026-001',
    amount: 500,
    currency: 'ILS',
    status: 'sent' as const,
    client_name: 'ישראל ישראלי',
    client_email: 'test@example.com',
    client_address: {
      line1: 'רחוב הרצל 123',
      city: 'תל אביב',
      country: 'ישראל'
    },
    line_items: [
      {
        description: 'שירות ייעוץ מקצועי',
        quantity: 2,
        unit_price: 200,
        total: 400
      },
      {
        description: 'פגישת המשך',
        quantity: 1,
        unit_price: 100,
        total: 100
      }
    ],
    notes: 'תודה על שיתוף הפעולה',
    created_at: new Date().toISOString(),
    due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    contact_id: null,
    booking_id: null,
    sent_at: null,
    paid_at: null,
    stripe_invoice_id: null,
    stripe_hosted_invoice_url: null,
    stripe_invoice_pdf: null,
  };

  const businessSettings = {
    invoice_company_name: 'העסק שלי בע״מ',
    invoice_address: {
      line1: 'רחוב דיזנגוף 50',
      city: 'תל אביב',
      postal_code: '6433222',
      country: 'ישראל'
    },
    invoice_tax_id: '515123456',
    invoice_bank_name: 'בנק הפועלים',
    invoice_bank_account: '123456789',
    invoice_bank_routing: '12-345',
    invoice_payment_instructions: 'נא לשלם תוך 30 יום',
    invoice_footer_text: 'תודה על העסקה!',
    invoice_number_prefix: 'INV',
    invoice_logo_url: null,
  };

  try {
    const pdfBuffer = await generateInvoicePDFAsync({
      invoice: testInvoice,
      businessSettings,
      businessName: 'העסק שלי',
      businessVertical: 'consultant',
      language: 'he',
    });

    // Save the PDF to Desktop for easy access
    const desktopPath = path.join(os.homedir(), 'Desktop', 'test-hebrew-invoice-react-pdf.pdf');
    fs.writeFileSync(desktopPath, pdfBuffer);
    console.log(`✅ PDF generated successfully! Saved to: ${desktopPath}`);
    console.log(`   Size: ${pdfBuffer.length} bytes`);
    console.log('\nOpening PDF...');

    // Open the PDF
    const { exec } = require('child_process');
    exec(`open "${desktopPath}"`);
  } catch (error) {
    console.error('❌ Failed to generate PDF:', error);
    throw error;
  }
}

testInvoicePDF();
