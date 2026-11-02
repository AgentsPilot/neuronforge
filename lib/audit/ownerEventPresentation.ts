// lib/audit/ownerEventPresentation.ts
//
// How an audit entry is PRESENTED to the account owner, as opposed to what is
// written (credits boost slice 4a, SA C-5).
//
// Some owner-visible entries carry operator detail: `BOS_BOOST_FLAGGED` records
// a reason code ("amount_mismatch", "paid_not_creditable", ...) that an admin
// needs and an owner should not read as prose. The row is written in full, and
// admin screens (service role) read it in full. Only the OWNER read path
// (GET /api/audit/query) passes each row through `presentOwnerAuditRow`:
//   - a labelled event gains `owner_label` (en / he / es), a neutral name;
//   - an event in OWNER_NEUTRAL_EVENTS has its `details` replaced by `{}`.
// Every other row is returned exactly as read (the existing response shape is
// pinned by app/api/audit/__tests__/auditRoutes.test.ts).
//
// The owner's data export (module export, app/api/business-os/export-requests
// since MX-3.1 retired the ZIP) is labelled below but its details are NOT
// neutralised: they are the owner's own ids, module, counts and a code
// (export MX-4a, SA Q-6 d).
//
// Pure: no I/O. Safe in a client bundle.

/** A neutral name in the three product languages. */
export interface OwnerEventLabel {
  en: string;
  he: string;
  es: string;
}

/** Hebrew and Spanish are drafts for native review (credits boost §8.2 note). */
export const OWNER_EVENT_LABELS: Readonly<Record<string, OwnerEventLabel>> = {
  BOS_BOOST_CHECKOUT_STARTED: { en: 'Credit top-up started', he: 'התחלת רכישת קרדיטים', es: 'Recarga de créditos iniciada' },
  BOS_BOOST_CREDITED: { en: 'Credits added', he: 'קרדיטים נוספו', es: 'Créditos añadidos' },
  BOS_BOOST_PAYMENT_FAILED: { en: 'Payment did not go through', he: 'התשלום לא עבר', es: 'El pago no se completó' },
  BOS_BOOST_FLAGGED: { en: 'Payment under review', he: 'התשלום בבדיקה', es: 'Pago en revisión' },
  // Credits boost 4b.1 (SA Q-4): a refund or dispute recorded; the details stay operator-only.
  BOS_BOOST_PAYMENT_REVERSED: { en: 'Payment update', he: 'עדכון תשלום', es: 'Actualización del pago' },
  // Export MX-4a (SA Q-6 c): the module export's three events. Details kept (Q-6 d).
  DATA_EXPORT_REQUESTED: { en: 'Data export requested', he: 'התבקש ייצוא נתונים', es: 'Exportación de datos solicitada' },
  DATA_EXPORT_MODULE_SENT: { en: 'One area of your export was sent by email', he: 'תחום אחד מהייצוא נשלח באימייל', es: 'Un área de tu exportación se envió por correo' },
  DATA_EXPORT_MODULE_FAILED: { en: 'One area of your export could not be sent', he: 'לא ניתן היה לשלוח תחום אחד מהייצוא', es: 'No se pudo enviar un área de tu exportación' },
};

/** Events whose details are operator-only: the owner sees the label and nothing else. */
export const OWNER_NEUTRAL_EVENTS: ReadonlySet<string> = new Set(['BOS_BOOST_FLAGGED', 'BOS_BOOST_PAYMENT_REVERSED']);

/** The owner's view of one audit row. Unlabelled rows are returned unchanged (same object). */
export function presentOwnerAuditRow<T extends { action: string; details?: unknown }>(row: T): T | (T & { owner_label: OwnerEventLabel }) {
  const label = OWNER_EVENT_LABELS[row.action];
  if (!label) return row;
  return {
    ...row,
    owner_label: { en: label.en, he: label.he, es: label.es },
    ...(OWNER_NEUTRAL_EVENTS.has(row.action) ? { details: {} } : {}),
  };
}
