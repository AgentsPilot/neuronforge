/**
 * StepExecutor.transformFlatten — Item 9 (Finding 3): parent-field carry-forward.
 *
 * The RCA agent 0ee53785's report had blank From/Subject/Date columns because
 * `transformFlatten` nested parent `from`/`subject` under `_parentData` and
 * DROPPED `date`, while downstream referenced flat `attachment_item.from/.subject/
 * .date`. The fix carries parent fields (incl. `date`) forward onto each child
 * with CHILD-PRECEDENCE (child fields win; additive; never clobber).
 */

// `uuid` (transitively imported by StepExecutor's module graph) ships ESM-only,
// which ts-jest does not transform by default → mock it to a CJS stub.
jest.mock('uuid', () => ({
  v4: () => '00000000-0000-4000-8000-000000000000',
  v1: () => '00000000-0000-1000-8000-000000000000',
  validate: () => true,
  version: () => 4,
  NIL: '00000000-0000-0000-0000-000000000000',
}));

import { StepExecutor } from '../StepExecutor';

function makeExecutor(): any {
  return new StepExecutor({} as any) as any;
}

// One email with two attachments, exactly the RCA shape.
function makeEmails() {
  return [
    {
      id: 'email-1',
      messageId: 'msg-1',
      from: 'vendor@acme.com',
      subject: 'Invoice March',
      date: '2026-03-01',
      attachments: [
        { filename: 'a.pdf', mimeType: 'application/pdf', attachment_id: 'att-1', message_id: 'msg-1' },
        { filename: 'b.pdf', mimeType: 'application/pdf', attachment_id: 'att-2', message_id: 'msg-1' },
      ],
    },
  ];
}

describe('transformFlatten — parent-field carry-forward (Item 9)', () => {
  it('carries from/subject/date onto each flattened child (happy path)', () => {
    const result = makeExecutor().transformFlatten(makeEmails(), { field: 'attachments' });
    expect(result).toHaveLength(2);
    for (const child of result) {
      expect(child.from).toBe('vendor@acme.com');
      expect(child.subject).toBe('Invoice March');
      expect(child.date).toBe('2026-03-01'); // previously dropped
      // child's own fields survive
      expect(child.mimeType).toBe('application/pdf');
    }
    expect(result[0].filename).toBe('a.pdf');
    expect(result[1].filename).toBe('b.pdf');
    // _parentData still present for backwards-compat, and now includes date.
    expect(result[0]._parentData.date).toBe('2026-03-01');
    expect(result[0]._parentData.from).toBe('vendor@acme.com');
  });

  it('CHILD-PRECEDENCE: a child field never gets clobbered by a same-named parent field', () => {
    const emails = [
      {
        id: 'e1',
        from: 'parent@x.com',
        subject: 'ParentSubject',
        date: 'parent-date',
        attachments: [
          // child carries its OWN subject/date — these must win over the parent's.
          { filename: 'c.pdf', subject: 'ChildSubject', date: 'child-date' },
        ],
      },
    ];
    const [child] = makeExecutor().transformFlatten(emails, { field: 'attachments' });
    expect(child.subject).toBe('ChildSubject'); // child wins
    expect(child.date).toBe('child-date');       // child wins
    expect(child.from).toBe('parent@x.com');     // parent added where child had none
  });

  it('does not re-carry the flattened array field itself', () => {
    const [child] = makeExecutor().transformFlatten(makeEmails(), { field: 'attachments' });
    expect(child.attachments).toBeUndefined();
  });

  it('failure/edge path: an email with no attachments contributes no rows', () => {
    const emails = [{ id: 'e1', from: 'x@y.com', subject: 's', date: 'd', attachments: [] }];
    const result = makeExecutor().transformFlatten(emails, { field: 'attachments' });
    expect(result).toHaveLength(0);
  });
});
