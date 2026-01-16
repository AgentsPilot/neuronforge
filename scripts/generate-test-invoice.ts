/**
 * Generate a test invoice PDF that can be parsed by pdf-parse/pdfjs-dist
 *
 * Usage:
 *   npx tsx scripts/generate-test-invoice.ts
 */

import { jsPDF } from 'jspdf';
import * as fs from 'fs';
import * as path from 'path';

function generateTestInvoice() {
  const doc = new jsPDF();

  // Company header
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('INVOICE', 105, 20, { align: 'center' });

  // Company info
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Acme Corporation', 20, 40);
  doc.text('123 Business Street', 20, 46);
  doc.text('San Francisco, CA 94105', 20, 52);
  doc.text('contact@acme.com', 20, 58);

  // Invoice details (right side)
  doc.setFont('helvetica', 'bold');
  doc.text('Invoice Number:', 130, 40);
  doc.text('Invoice Date:', 130, 46);
  doc.text('Due Date:', 130, 52);

  doc.setFont('helvetica', 'normal');
  doc.text('INV-2026-0042', 170, 40);
  doc.text('January 15, 2026', 170, 46);
  doc.text('February 15, 2026', 170, 52);

  // Bill To
  doc.setFont('helvetica', 'bold');
  doc.text('Bill To:', 20, 75);
  doc.setFont('helvetica', 'normal');
  doc.text('John Smith', 20, 82);
  doc.text('456 Customer Ave', 20, 88);
  doc.text('New York, NY 10001', 20, 94);
  doc.text('john.smith@email.com', 20, 100);

  // Table header
  const tableTop = 115;
  doc.setFillColor(240, 240, 240);
  doc.rect(20, tableTop, 170, 10, 'F');

  doc.setFont('helvetica', 'bold');
  doc.text('Description', 25, tableTop + 7);
  doc.text('Qty', 100, tableTop + 7);
  doc.text('Unit Price', 120, tableTop + 7);
  doc.text('Amount', 160, tableTop + 7);

  // Table rows
  doc.setFont('helvetica', 'normal');
  const items = [
    { description: 'Web Development Services', qty: 1, unitPrice: 2500.00 },
    { description: 'UI/UX Design Package', qty: 1, unitPrice: 1500.00 },
    { description: 'Hosting (Monthly)', qty: 3, unitPrice: 49.99 },
    { description: 'Domain Registration', qty: 1, unitPrice: 15.00 },
  ];

  let y = tableTop + 17;
  let subtotal = 0;

  for (const item of items) {
    const amount = item.qty * item.unitPrice;
    subtotal += amount;

    doc.text(item.description, 25, y);
    doc.text(item.qty.toString(), 105, y);
    doc.text(`$${item.unitPrice.toFixed(2)}`, 120, y);
    doc.text(`$${amount.toFixed(2)}`, 160, y);

    y += 8;
  }

  // Line
  doc.line(20, y + 2, 190, y + 2);

  // Totals
  const tax = subtotal * 0.08;
  const total = subtotal + tax;

  y += 12;
  doc.setFont('helvetica', 'normal');
  doc.text('Subtotal:', 130, y);
  doc.text(`$${subtotal.toFixed(2)}`, 160, y);

  y += 7;
  doc.text('Tax (8%):', 130, y);
  doc.text(`$${tax.toFixed(2)}`, 160, y);

  y += 7;
  doc.setFont('helvetica', 'bold');
  doc.text('Total:', 130, y);
  doc.text(`$${total.toFixed(2)}`, 160, y);

  // Payment info
  y += 20;
  doc.setFont('helvetica', 'bold');
  doc.text('Payment Information', 20, y);
  doc.setFont('helvetica', 'normal');
  y += 7;
  doc.text('Bank: First National Bank', 20, y);
  y += 6;
  doc.text('Account: 1234567890', 20, y);
  y += 6;
  doc.text('Routing: 021000021', 20, y);

  // Footer
  doc.setFontSize(9);
  doc.text('Thank you for your business!', 105, 270, { align: 'center' });
  doc.text('Payment is due within 30 days. Late payments subject to 1.5% monthly interest.', 105, 276, { align: 'center' });

  // Save
  const outputPath = path.join(process.cwd(), 'test-invoice.pdf');
  const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
  fs.writeFileSync(outputPath, pdfBuffer);

  console.log(`✓ Test invoice generated: ${outputPath}`);
  console.log(`  - Invoice Number: INV-2026-0042`);
  console.log(`  - Date: January 15, 2026`);
  console.log(`  - Vendor: Acme Corporation`);
  console.log(`  - Total: $${total.toFixed(2)}`);

  // Also output as base64 for easy testing
  const base64 = pdfBuffer.toString('base64');
  console.log(`\nBase64 length: ${base64.length} chars`);
  console.log(`\nTo test extraction, run:`);
  console.log(`  npx tsx scripts/test-pdf-extraction.ts test-invoice.pdf`);
}

generateTestInvoice();
