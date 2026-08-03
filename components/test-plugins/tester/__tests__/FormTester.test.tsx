/**
 * @jest-environment jsdom
 *
 * Critical UI-path test for the Plugin API Tester (SA decision 3 — the CI QA gate).
 * Drives FormTester with mocked getActionSchema + executeAction and asserts:
 *   - the form renders from the schema,
 *   - required-field validation blocks Run,
 *   - the destructive confirm gate blocks until confirmed (CR1),
 *   - result renders and one side-console entry is appended (FR7 + FR8).
 * No live calls — no real Google side effects.
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { FormTester } from '../FormTester';
import { REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS } from '@/lib/plugins/tester/connection-gate';
import type { ActionSchema } from '@/lib/plugins/tester/tester-types';

const allConnected = {
  connected: REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS.map((key) => ({ key })),
};

const CREATE_FOLDER: ActionSchema = {
  name: 'create_folder',
  description: 'Create a folder',
  parameters: { type: 'object', required: ['name'], properties: { name: { type: 'string', description: 'Folder name' } } },
  required_params: ['name'],
  optional_params: [],
  capability: 'create',
  idempotent: false,
  rules: { confirmations: {} },
};

const DELETE_FILE: ActionSchema = {
  name: 'delete_file',
  description: 'Move a file to Trash',
  parameters: { type: 'object', required: ['file_id'], properties: { file_id: { type: 'string' } } },
  required_params: ['file_id'],
  optional_params: [],
  capability: 'delete',
  idempotent: true,
  rules: {
    confirmations: {
      confirm_trash: {
        condition: 'file_id != null',
        action: 'confirm',
        message: 'Move this file to Trash?',
      },
    },
  },
};

// Nested object (start) + array-of-objects (attendees) → must render as free-text
// group + add/remove-row repeater (NO JSON), and reassemble into a nested payload.
const CREATE_EVENT: ActionSchema = {
  name: 'create_event',
  description: 'Create a calendar event',
  parameters: {
    type: 'object',
    required: ['summary', 'start'],
    properties: {
      summary: { type: 'string' },
      start: {
        type: 'object',
        required: ['date_time'],
        properties: { date_time: { type: 'string' }, time_zone: { type: 'string' } },
      },
      attendees: {
        type: 'array',
        items: { type: 'object', properties: { email: { type: 'string' }, optional: { type: 'boolean' } } },
      },
    },
  },
  required_params: ['summary', 'start'],
  optional_params: ['attendees'],
  capability: 'create',
  idempotent: false,
  rules: { confirmations: {} },
};

function makeGetActionSchema() {
  return jest.fn(async (_plugin: string) => ({ actions: [CREATE_FOLDER, DELETE_FILE, CREATE_EVENT] }));
}

async function selectPluginAndAction(action: string) {
  fireEvent.change(await screen.findByLabelText('Plugin'), { target: { value: 'google-drive' } });
  const actionSelect = await screen.findByLabelText('Action');
  await waitFor(() => expect(within(actionSelect).queryByText(action)).toBeInTheDocument());
  fireEvent.change(actionSelect, { target: { value: action } });
}

describe('FormTester — critical UI path (CI gate)', () => {
  it('shows the connection gate when a required plugin is missing', () => {
    const status = { connected: [{ key: 'google-drive' }] };
    render(
      <FormTester
        userId="u1"
        connectionStatus={status}
        getActionSchema={makeGetActionSchema()}
        executeAction={jest.fn()}
      />
    );
    expect(screen.getByTestId('connection-gate-panel')).toBeInTheDocument();
    expect(screen.queryByLabelText('Plugin')).not.toBeInTheDocument();
  });

  it('wires per-plugin refresh and sequential refresh-all for expired tokens', async () => {
    // All five appear connected, but two tokens are expired → gate locked, refresh path.
    const status = {
      connected: REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS.map((key) => ({ key })),
      active_expired: ['google-sheets', 'google-calendar'],
    };
    const onRefresh = jest.fn();
    const onRefreshAll = jest.fn();
    render(
      <FormTester
        userId="u1"
        connectionStatus={status}
        getActionSchema={makeGetActionSchema()}
        executeAction={jest.fn()}
        onRefresh={onRefresh}
        onRefreshAll={onRefreshAll}
      />
    );
    // Two "Refresh token" buttons (one per expired plugin); click the first.
    const refreshButtons = screen.getAllByRole('button', { name: 'Refresh token' });
    expect(refreshButtons).toHaveLength(2);
    fireEvent.click(refreshButtons[0]);
    expect(onRefresh).toHaveBeenCalledWith('google-sheets');
    // Refresh-all button reflects the expired count and fires onRefreshAll.
    const refreshAll = screen.getByTestId('refresh-all-tokens');
    expect(refreshAll).toHaveTextContent('Refresh all tokens (2)');
    fireEvent.click(refreshAll);
    expect(onRefreshAll).toHaveBeenCalledTimes(1);
  });

  it('shows a userId-required state when userId is empty (FR11)', () => {
    render(
      <FormTester
        userId=""
        connectionStatus={allConnected}
        getActionSchema={makeGetActionSchema()}
        executeAction={jest.fn()}
      />
    );
    expect(screen.getByTestId('gate-userid-required')).toBeInTheDocument();
  });

  it('renders the form from schema and blocks Run until required fields are filled', async () => {
    render(
      <FormTester
        userId="u1"
        connectionStatus={allConnected}
        getActionSchema={makeGetActionSchema()}
        executeAction={jest.fn()}
      />
    );

    await selectPluginAndAction('create_folder');

    // Form renders from schema.
    expect(await screen.findByTestId('field-name')).toBeInTheDocument();
    // Required not filled → Run disabled.
    const runBtn = screen.getByRole('button', { name: 'Run' });
    expect(runBtn).toBeDisabled();

    // Fill required field → Run enabled.
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'My Folder' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled());
  });

  it('runs a non-destructive action and appends a console entry (FR7 + FR8)', async () => {
    const executeAction = jest.fn(async () => ({ success: true, data: { id: 'folder-1' } }));
    const recordAudit = jest.fn();
    render(
      <FormTester
        userId="u1"
        connectionStatus={allConnected}
        getActionSchema={makeGetActionSchema()}
        executeAction={executeAction}
        recordAudit={recordAudit}
      />
    );

    await selectPluginAndAction('create_folder');
    fireEvent.change(await screen.findByLabelText(/Name/), { target: { value: 'My Folder' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    // Result renders.
    expect(await screen.findByTestId('tester-result')).toHaveTextContent('Success');
    expect(executeAction).toHaveBeenCalledWith('u1', 'google-drive', 'create_folder', { name: 'My Folder' });
    // One console entry appended.
    await waitFor(() => expect(screen.getAllByTestId('console-entry')).toHaveLength(1));
    // Audit fired (CR2).
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ targetUserId: 'u1', plugin: 'google-drive', action: 'create_folder', outcome: 'success' })
    );
  });

  it('renders nested object + array-of-objects as free-text (no JSON) and reassembles the payload (Fix 2)', async () => {
    const executeAction = jest.fn(async () => ({ success: true, data: { id: 'evt-1' } }));
    render(
      <FormTester
        userId="u1"
        connectionStatus={allConnected}
        getActionSchema={makeGetActionSchema()}
        executeAction={executeAction}
      />
    );

    fireEvent.change(await screen.findByLabelText('Plugin'), { target: { value: 'google-calendar' } });
    const actionSelect = await screen.findByLabelText('Action');
    await waitFor(() => expect(within(actionSelect).queryByText('create_event')).toBeInTheDocument());
    fireEvent.change(actionSelect, { target: { value: 'create_event' } });

    // Nested object renders as a titled group of plain inputs — NO JSON textarea.
    expect(await screen.findByTestId('group-start')).toBeInTheDocument();
    expect(screen.queryByLabelText('Raw JSON parameters')).not.toBeInTheDocument();

    // Fill top-level + nested-object leaves.
    fireEvent.change(screen.getByLabelText(/^Summary/), { target: { value: 'Standup' } });
    fireEvent.change(screen.getByLabelText(/Date Time/), { target: { value: '2026-08-01T09:00' } });

    // Add an attendee row and fill it (object-array repeater).
    fireEvent.click(within(screen.getByTestId('objectarray-attendees')).getByRole('button', { name: '+ Add row' }));
    fireEvent.change(await screen.findByLabelText(/Email/), { target: { value: 'a@x.com' } });

    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => expect(executeAction).toHaveBeenCalledTimes(1));
    expect(executeAction).toHaveBeenCalledWith('u1', 'google-calendar', 'create_event', {
      summary: 'Standup',
      start: { date_time: '2026-08-01T09:00' },
      // Booleans always emit their value (consistent with top-level behavior).
      attendees: [{ email: 'a@x.com', optional: false }],
    });
  });

  it('blocks a destructive action behind the confirm gate until confirmed (FR6/CR1)', async () => {
    const executeAction = jest.fn(async () => ({ success: true, data: { trashed: true } }));
    render(
      <FormTester
        userId="u1"
        connectionStatus={allConnected}
        getActionSchema={makeGetActionSchema()}
        executeAction={executeAction}
      />
    );

    await selectPluginAndAction('delete_file');
    fireEvent.change(await screen.findByLabelText(/File Id/), { target: { value: 'file-123' } });

    // Clicking Run does NOT execute yet — shows the confirm gate.
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(executeAction).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Move this file to Trash?');

    // Confirming runs it.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm & Run' }));
    await waitFor(() => expect(executeAction).toHaveBeenCalledTimes(1));
    expect(executeAction).toHaveBeenCalledWith('u1', 'google-drive', 'delete_file', { file_id: 'file-123' });
  });

  it('can cancel the destructive confirm without running', async () => {
    const executeAction = jest.fn(async () => ({ success: true, data: {} }));
    render(
      <FormTester
        userId="u1"
        connectionStatus={allConnected}
        getActionSchema={makeGetActionSchema()}
        executeAction={executeAction}
      />
    );

    await selectPluginAndAction('delete_file');
    fireEvent.change(await screen.findByLabelText(/File Id/), { target: { value: 'file-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(executeAction).not.toHaveBeenCalled();
  });

  // ── Regression: typed input must survive a background re-fetch / parent re-render ──
  // Reproduces the live bug: the parent passed a NEW getActionSchema identity each
  // render, which re-fired the load effect → refetch → re-seed, silently overwriting
  // the user's typed values with the PARAMETER_TEMPLATES placeholder. The send_email
  // case (nested recipients.to) went out with `recipient@example.com`.
  it('preserves user-typed nested input through a background re-fetch (does NOT revert to template)', async () => {
    const SEND_EMAIL: ActionSchema = {
      name: 'send_email',
      description: 'Send an email',
      parameters: {
        type: 'object',
        required: ['recipients'],
        properties: {
          recipients: {
            type: 'object',
            required: ['to'],
            properties: { to: { type: 'array', items: { type: 'string' } } },
          },
          content: { type: 'object', properties: { subject: { type: 'string' } } },
        },
      },
      required_params: ['recipients'],
      optional_params: ['content'],
      capability: 'send_message',
      idempotent: false,
      rules: { confirmations: {} },
    };

    // PARAMETER_TEMPLATES-style placeholder — what the seed uses if it (wrongly) re-runs.
    const parameterTemplates = {
      'google-mail': { send_email: { recipients: { to: ['recipient@example.com'] } } },
    };

    const executeAction = jest.fn(async () => ({ success: true, data: { id: 'msg-1' } }));
    // UNSTABLE getActionSchema: a fresh arrow (new identity) + fresh actions array on
    // every render, exactly like the pre-fix page. `schemaCalls` counts real fetches so
    // we can deterministically wait for the background refetch to actually happen.
    let schemaCalls = 0;
    const element = () => (
      <FormTester
        userId="u1"
        connectionStatus={allConnected}
        getActionSchema={() => {
          schemaCalls++;
          // Return a FRESH clone each call — a real fetch JSON-parses a new object, so
          // activeSchema's identity changes on every refetch (that's what re-fires the
          // seed effect in the live bug). Reusing one constant would hide it.
          return Promise.resolve({ actions: [JSON.parse(JSON.stringify(SEND_EMAIL))] });
        }}
        executeAction={executeAction}
        parameterTemplates={parameterTemplates}
      />
    );
    const { rerender } = render(element());

    // Select google-mail → send_email (fetch #1).
    fireEvent.change(await screen.findByLabelText('Plugin'), { target: { value: 'google-mail' } });
    const actionSelect = await screen.findByLabelText('Action');
    await waitFor(() => expect(within(actionSelect).queryByText('send_email')).toBeInTheDocument());
    fireEvent.change(actionSelect, { target: { value: 'send_email' } });

    // The nested "To" field (recipients.to) starts seeded from the template placeholder.
    const toInput = () =>
      within(screen.getByTestId('field-recipients-to')).getByRole('textbox') as HTMLInputElement;
    await waitFor(() => expect(toInput().value).toBe('recipient@example.com'));
    const callsAfterSeed = schemaCalls;

    // User types their REAL address.
    fireEvent.change(toInput(), { target: { value: 'me@myreal.com' } });
    expect(toInput().value).toBe('me@myreal.com');

    // Force a parent re-render with a NEW getActionSchema identity → background refetch,
    // and WAIT for that refetch to actually resolve + flush (this is when the pre-fix
    // code re-seeds and wipes the input).
    await act(async () => {
      rerender(element());
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(schemaCalls).toBeGreaterThan(callsAfterSeed));
    await act(async () => {
      await Promise.resolve();
    });

    // ASSERT: the edited value PERSISTED (not reverted to the template placeholder).
    // Without the seed-key guard, the resolved refetch re-seeds and this reads
    // 'recipient@example.com' — the exact live bug.
    expect(toInput().value).toBe('me@myreal.com');

    // ASSERT: Run sends the user's value, never the template.
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(executeAction).toHaveBeenCalledTimes(1));
    expect(executeAction).toHaveBeenCalledWith('u1', 'google-mail', 'send_email', {
      recipients: { to: ['me@myreal.com'] },
    });
  });
});
