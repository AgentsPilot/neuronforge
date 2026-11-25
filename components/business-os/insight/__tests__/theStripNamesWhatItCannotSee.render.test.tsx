/**
 * @jest-environment jsdom
 *
 * The tracking strip names the vectors it has NO data for, not only the slow ones.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The note read "Reading 4 of 7. Still learning: conversion, retention." An
 * owner can account for six vectors in that sentence and has no way to find the
 * seventh — and the seventh is always in the worse state: not slow, but with
 * nothing to read at all.
 *
 * `noteLearning` carried only `state === 'learn'`. `dark` was computed, drawn
 * as a pale pill, and never mentioned in the one line most owners actually
 * read.
 *
 * The two states stay separate sentences because the owner's next move differs.
 * A learning vector needs time and lights on its own. A dark one will not:
 * nothing has happened for it to read, and only the owner can change that.
 */

import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

const COPY: Record<string, string> = {
  'vecs.header': 'What I am tracking',
  'vecs.note.partial': 'Reading {lit} of 7.',
  'vecs.note.learning': 'Still learning: {list}.',
  'vecs.note.nothing_yet': 'Nothing yet on {list}.',
  'insight.vector.conv': 'conversion',
  'insight.vector.ret': 'retention',
  'insight.vector.price': 'pricing',
  'insight.vector.wins': 'wins',
  'insight.vector.ops': 'bookings',
  'insight.vector.cash': 'cash flow',
  'insight.vector.leads': 'leads',
};

jest.mock('@/lib/business-os/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    isRTL: false,
    t: (key: string, vars?: Record<string, string | number>) =>
      (COPY[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? '')),
  }),
}));

import { VectorsStrip } from '@/components/business-os/insight/VectorsStrip';

const vector = (key: string, state: 'lit' | 'learn' | 'dark') =>
  ({ key, name: key, state, dataPoints: state === 'dark' ? 0 : 3, threshold: 10 }) as never;

/** Four lit, two learning, one with nothing: the reported card exactly. */
const maturity = {
  vectors: [
    vector('wins', 'lit'),
    vector('ops', 'lit'),
    vector('cash', 'lit'),
    vector('leads', 'lit'),
    vector('conv', 'learn'),
    vector('ret', 'learn'),
    vector('price', 'dark'),
  ],
  maturityLevel: 'growing',
  litCount: 4,
  totalVectors: 7,
  accountAgeDays: 30,
  note: 'Reading 4 of 7.',
  noteKey: 'vecs.note.partial',
  noteLearning: ['conv', 'ret'],
  noteDark: ['price'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

afterEach(cleanup);

describe('the note', () => {
  it('names the vector that has nothing at all', () => {
    render(<VectorsStrip vectorMaturity={maturity} />);
    expect(screen.getByText(/Nothing yet on pricing\./)).toBeInTheDocument();
  });

  it('still names the ones that are merely learning', () => {
    render(<VectorsStrip vectorMaturity={maturity} />);
    expect(screen.getByText(/Still learning: conversion, retention\./)).toBeInTheDocument();
  });

  it('keeps the count sentence first', () => {
    render(<VectorsStrip vectorMaturity={maturity} />);
    expect(screen.getByText(/^Reading 4 of 7\./)).toBeInTheDocument();
  });

  it('accounts for all seven between the three clauses', () => {
    render(<VectorsStrip vectorMaturity={maturity} />);
    const line = screen.getByText(/Reading 4 of 7/).textContent ?? '';
    const named = ['conversion', 'retention', 'pricing'].filter(name => line.includes(name));
    /* 4 lit are counted, 3 named: nothing is left unexplained. */
    expect(named).toHaveLength(3);
  });
});

describe('when there is nothing to add', () => {
  it('says only the count when every unlit vector is learning', () => {
    render(
      <VectorsStrip
        vectorMaturity={{ ...maturity, noteDark: [], vectors: maturity.vectors.slice(0, 6) }}
      />
    );

    expect(screen.queryByText(/Nothing yet on/)).not.toBeInTheDocument();
    expect(screen.getByText(/Still learning: conversion, retention\./)).toBeInTheDocument();
  });

  it('says only the dark clause when nothing is mid-learning', () => {
    render(<VectorsStrip vectorMaturity={{ ...maturity, noteLearning: [] }} />);

    expect(screen.queryByText(/Still learning/)).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing yet on pricing\./)).toBeInTheDocument();
  });

  it('leaves the cold and full notes alone, which name nothing by design', () => {
    render(
      <VectorsStrip
        vectorMaturity={{ ...maturity, noteKey: 'vecs.note.full', litCount: 7 }}
      />
    );

    expect(screen.queryByText(/Nothing yet on/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Still learning/)).not.toBeInTheDocument();
  });
});
