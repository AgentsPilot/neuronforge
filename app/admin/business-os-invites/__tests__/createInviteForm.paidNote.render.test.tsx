/**
 * @jest-environment jsdom
 *
 * Plan payments P-9.2 (§3.6, SA C-4): the create form RENDERS the server's
 * Paid grants (each with its price in the label) and the server's note under
 * the plan select; it decides nothing. A type without a note shows none.
 * Fixture labels only: the real labels come from the server (`adminInviteOps`).
 */

import '@testing-library/jest-dom';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen, within } from '@testing-library/react';

import { CreateInviteForm, initialInviteDraft } from '../components/CreateInviteForm';
import type { InviteFormOptions } from '../types';

const NOTE = 'Fixture note from the server.';

const options: InviteFormOptions = {
  expiryDays: [7, 30],
  defaultExpiryDays: 30,
  languages: ['en', 'he', 'es'],
  defaultLanguage: 'en',
  championAccessMonthsMax: 60,
  inviteTypes: [
    { type: 'fixture-cohort', label: 'Fixture Cohort', available: true, unavailableReason: null, requiresAccess: true, grants: [], note: null },
    {
      type: 'fixture-paid',
      label: 'Fixture Paid',
      available: true,
      unavailableReason: null,
      requiresAccess: false,
      grants: [
        { id: 'plan-a', label: 'Plan A · $11 a month', default: true },
        { id: 'plan-b', label: 'Plan B · $22 a month', default: false },
      ],
      note: NOTE,
    },
  ],
};

function renderWith(inviteType: string) {
  const draft = { ...initialInviteDraft(options), inviteType };
  render(
    <CreateInviteForm
      options={options}
      draft={draft}
      onDraftChange={() => undefined}
      onBusyChange={() => undefined}
      onCreated={() => undefined}
      onCancel={() => undefined}
    />
  );
}

describe('P-9.2: the Paid note and priced grants, as the server sends them', () => {
  it('a Paid type: the plan select lists the server labels (with price) and the note shows under it', () => {
    renderWith('fixture-paid');
    const select = screen.getByLabelText('Plan');
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Plan A · $11 a month', 'Plan B · $22 a month']);
    expect(screen.getByTestId('invite-grant-note')).toHaveTextContent(NOTE);
  });

  it('a type with no note (a champion) shows none', () => {
    renderWith('fixture-cohort');
    expect(screen.queryByTestId('invite-grant-note')).not.toBeInTheDocument();
  });

  it('the form writes no note text and no price of its own (thin renderer)', () => {
    const text = readFileSync(join(process.cwd(), 'app', 'admin', 'business-os-invites', 'components', 'CreateInviteForm.tsx'), 'utf8');
    expect(text).not.toContain('pays this plan at signup');
    expect(text).not.toMatch(/\$\d/);
    expect(text).toContain('selected.note');
  });
});
