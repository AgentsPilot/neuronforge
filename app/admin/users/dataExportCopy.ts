/**
 * Words of the admin "Data export" box of the Businesses drawer (data export
 * DE-10a; export redesign MX-3.1, workplan §8; MX-5, workplan §4.8). English
 * only, like the rest of the admin console. Pure: no React, no I/O.
 *
 * MX-5 (BQ-30, answered 2026-11-03): "Send export to owner" replaces the
 * MX-3.1 placeholder. The admin sends the owner their own export, by email to
 * the owner's login address, and never receives or sees the files. The box
 * names no address.
 */

export type DataExportSendStatusWord = 'waiting' | 'working' | 'sent' | 'failed' | 'interrupted';

export const DATA_EXPORT_COPY = {
  title: 'Data export',
  purpose: 'Send the owner their own data, by email to their login address. You never see the files.',
  open: 'Send export to owner…',
  dialogTitle: 'Send export to owner',
  dialogDescription: 'The owner gets one email per area at their login address. You will not receive the files.',
  loading: 'Loading the export state…',
  readFailed: 'Could not load the export state.',
  retry: 'Try again',
  closed: 'This account is closed. Nothing can be sent.',
  noLoginEmail: 'This account has no login email the export can be sent to.',
  self: 'You cannot send an export to your own account.',
  pickerLegend: 'Areas to send',
  selectAll: 'Select all',
  send: 'Send',
  sending: 'Sending…',
  close: 'Close',
  sent: 'Sent. The owner will get one email per area at their login address.',
  inProgress: 'An export sent by support is already running for this owner. Try again when it has finished.',
  sendFailed: 'Could not send. Please try again.',
  historyTitle: 'Sent by support',
  historyEmpty: 'Support has not sent this owner an export yet.',
  status: {
    waiting: 'Waiting',
    working: 'Working',
    sent: 'Sent',
    failed: 'Failed',
    interrupted: 'Interrupted',
  } satisfies Record<DataExportSendStatusWord, string>,
} as const;

/** The limit line. `time` is already formatted; null when the time is unknown. */
export function dataExportLimitLine(time: string | null): string {
  return time === null ? '2 sends a day per owner. You can send again later.' : `2 sends a day per owner. You can send again at ${time}.`;
}
