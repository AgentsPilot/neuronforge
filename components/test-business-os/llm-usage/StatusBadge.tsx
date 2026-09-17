'use client';

import { STATUS_COLOR, STATUS_LABEL, type DisplayStatus } from './formatters';

interface StatusBadgeProps {
  status: DisplayStatus;
  testId?: string;
}

/** A check status: text label AND colour, never colour alone. */
export function StatusBadge({ status, testId }: StatusBadgeProps) {
  const { background, color } = STATUS_COLOR[status];
  return (
    <span
      data-testid={testId}
      data-status={status}
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: '10px',
        fontSize: '12px',
        fontWeight: 'bold',
        background,
        color,
        border: `1px solid ${color}`,
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
