/**
 * T-19: the Messages display helpers (Admin Layout Standard L-7).
 */

import {
  ageLine,
  countLine,
  priorityLabel,
  priorityTone,
  sourceLabel,
  statusLabel,
  statusTone,
  visibleMessages,
} from '../messagesFormat';
import type { ContactMessage } from '../messagesTypes';

const NOW = Date.parse('2026-10-12T12:00:00Z');

function message(id: string, overrides: Partial<ContactMessage> = {}): ContactMessage {
  return {
    id,
    name: `Person ${id}`,
    email: `${id}@example.test`,
    message: 'Some text',
    status: 'read',
    email_sent: false,
    created_at: '2026-10-10T00:00:00Z',
    ...overrides,
  };
}

describe('ageLine', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));
  afterEach(() => jest.restoreAllMocks());

  it('reads just now, hours, then days (never a locale date), and empty for an invalid time', () => {
    expect(ageLine('2026-10-12T11:30:00Z')).toBe('Just now');
    expect(ageLine('2026-10-12T07:00:00Z')).toBe('5h ago');
    expect(ageLine('2026-10-10T12:00:00Z')).toBe('2d ago');
    expect(ageLine('2026-01-01T00:00:00Z')).toBe('284d ago');
    expect(ageLine('not a date')).toBe('');
  });
});

describe('status and priority', () => {
  it('Unread is info; Read and Replied are neutral (SA Q-4)', () => {
    expect(statusTone('unread')).toBe('info');
    expect(statusTone('read')).toBe('neutral');
    expect(statusTone('replied')).toBe('neutral');
    expect(['unread', 'read', 'replied'].map((s) => statusLabel(s as ContactMessage['status']))).toEqual([
      'Unread',
      'Read',
      'Replied',
    ]);
  });

  it('Low and Normal neutral, High warn, Urgent danger; no or an unknown priority has no chip (SA Q-5)', () => {
    expect(priorityTone('low')).toBe('neutral');
    expect(priorityTone('normal')).toBe('neutral');
    expect(priorityTone('high')).toBe('warn');
    expect(priorityTone('urgent')).toBe('danger');
    expect(priorityTone(undefined)).toBeNull();
    expect(priorityTone('critical')).toBeNull();
    expect(priorityLabel('urgent')).toBe('Urgent');
  });

  it('sourceLabel keeps the old words', () => {
    expect(sourceLabel('contact_form')).toBe('contact form');
    expect(sourceLabel('email')).toBe('email');
  });
});

describe('countLine', () => {
  it('singular, plural, the unread part omitted at 0, thousands separators', () => {
    expect(countLine([message('a')])).toBe('1 message, newest first');
    expect(countLine([message('a'), message('b', { status: 'unread' })])).toBe('2 messages, 1 unread, newest first');
    expect(countLine([])).toBe('0 messages, newest first');
    const many = Array.from({ length: 1200 }, (_, i) => message(String(i), { status: 'unread' }));
    expect(countLine(many)).toBe('1,200 messages, 1,200 unread, newest first');
  });
});

describe('visibleMessages', () => {
  it('filters by status and a five-field search, newest first, and sorts a copy (SA S-1)', () => {
    const input = [
      message('old', { created_at: '2026-10-01T00:00:00Z', company: 'Example Dental' }),
      message('new', { created_at: '2026-10-11T00:00:00Z', status: 'unread', subject: 'Pricing' }),
    ];
    const before = input.map((m) => m.id);
    expect(visibleMessages(input, 'all', '').map((m) => m.id)).toEqual(['new', 'old']);
    expect(input.map((m) => m.id)).toEqual(before);
    expect(visibleMessages(input, 'unread', '').map((m) => m.id)).toEqual(['new']);
    expect(visibleMessages(input, 'all', 'dental').map((m) => m.id)).toEqual(['old']);
    expect(visibleMessages(input, 'all', 'PRICING').map((m) => m.id)).toEqual(['new']);
    expect(visibleMessages(input, 'all', 'old@example').map((m) => m.id)).toEqual(['old']);
  });
});
