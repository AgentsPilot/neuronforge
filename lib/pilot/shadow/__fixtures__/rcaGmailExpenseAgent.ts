/**
 * Fixture: compiled DSL steps of the RCA agent
 * `0ee53785-44d0-4b46-85dd-367551a657ba` ("Gmail Expense Attachment Table +
 * Total Summary"), reconstructed from the RCA doc's compiled-data-path table.
 *
 * The defect: step2 `flatten` declares snake_case `mime_type` while the Gmail
 * `search_emails` producer emits camelCase `mimeType`; step3 `filter` then
 * conditions on `mime_type`, and step4's scatter body references
 * `{{attachment_item.mime_type}}`. Used to prove Item 7's in-place correction.
 */

/** The real Gmail `search_emails` output schema (camelCase attachment items). */
export const GMAIL_SEARCH_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    emails: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          subject: { type: 'string' },
          from: { type: 'string' },
          attachments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                filename: { type: 'string' },
                mimeType: { type: 'string' },
                size: { type: 'number' },
                attachment_id: { type: 'string' },
                message_id: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

/** Resolver that returns the Gmail schema for the search action (source of truth). */
export const rcaResolver = (plugin: string, action: string) =>
  plugin === 'google-mail' && action === 'search_emails' ? GMAIL_SEARCH_OUTPUT_SCHEMA : null;

/** Fresh copy of the compiled steps (so tests can mutate without cross-talk). */
export function makeRcaSteps(): any[] {
  return [
    {
      step_id: 'step1',
      type: 'action',
      plugin: 'google-mail',
      action: 'search_emails',
      output_variable: 'expense_emails',
      output_schema: GMAIL_SEARCH_OUTPUT_SCHEMA,
      params: { query: 'subject:expense', max_results: 500, include_attachments: true },
    },
    {
      step_id: 'step2',
      type: 'transform',
      output_variable: 'all_attachments',
      config: {
        type: 'flatten',
        input: '{{expense_emails.emails}}',
        field: 'attachments',
        output_schema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              mime_type: { type: 'string' },
              message_id: { type: 'string' },
              attachment_id: { type: 'string' },
              filename: { type: 'string' },
            },
          },
        },
      },
    },
    {
      step_id: 'step3',
      type: 'transform',
      output_variable: 'eligible_attachments',
      config: {
        type: 'filter',
        input: '{{all_attachments}}',
        condition: {
          field: 'mime_type',
          operator: 'in',
          value: ['application/pdf', 'image/jpeg', 'image/png'],
        },
        _on_empty: 'throw',
      },
    },
    {
      step_id: 'step4',
      type: 'scatter_gather',
      output_variable: 'expense_rows',
      scatter: {
        input: '{{eligible_attachments}}',
        itemVariable: 'attachment_item',
        steps: [
          {
            step_id: 'step5',
            type: 'action',
            plugin: 'google-mail',
            action: 'get_attachment',
            output_variable: 'downloaded',
            params: {
              attachment_id: '{{attachment_item.attachment_id}}',
              message_id: '{{attachment_item.message_id}}',
              mime_type: '{{attachment_item.mime_type}}',
              filename: '{{attachment_item.filename}}',
            },
          },
        ],
      },
      gather: { itemVariable: 'attachment_item', outputKey: 'expense_rows', operation: 'collect' },
    },
  ];
}
