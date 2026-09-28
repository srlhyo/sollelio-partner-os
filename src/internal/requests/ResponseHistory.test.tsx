/**
 * The staff history of the response loop: every submission and return, oldest first,
 * with who and when, and exactly what was sent.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { InternalReturnRecord, RequestFieldRecord, SubmissionRecord } from '../../modules/requests/types';
import { ResponseHistory } from './ResponseHistory';

const fields: RequestFieldRecord[] = [
  { id: 'f1', request_id: 'r1', key: 'q1', label: 'Conseguiu?', help_text: null, type: 'boolean', required: true,
    options: null, sort_order: 1, system_generated: false },
  { id: 'f2', request_id: 'r1', key: 'q2', label: 'Comentário', help_text: null, type: 'long_text', required: false,
    options: null, sort_order: 2, system_generated: false },
];

const base = { request_id: 'r1', submitted_by: 'p1', response_text: null, response_decision: null, response_notes: null };
const submissions: SubmissionRecord[] = [
  { ...base, id: 's1', return_id: null, created_at: '2026-09-28T09:00:00Z', answers: [{ request_field_id: 'f1', value: false }] },
  { ...base, id: 's2', return_id: 'ret1', response_text: 'Também no telemóvel.', created_at: '2026-09-28T11:00:00Z', answers: [] },
  { ...base, id: 's3', return_id: 'ret2', response_decision: 'needs_changes', response_notes: 'Falta o logótipo.',
    created_at: '2026-09-28T13:00:00Z', answers: [] },
];
const returns: InternalReturnRecord[] = [
  { id: 'ret1', request_id: 'r1', response_type: 'text', message: 'Acontece no telemóvel?', created_by: 's1', created_at: '2026-09-28T10:00:00Z' },
  { id: 'ret2', request_id: 'r1', response_type: 'approval', message: 'Pode aprovar?', created_by: 's1', created_at: '2026-09-28T12:00:00Z' },
];

const names: Record<string, string> = { p1: 'Nádia', s1: 'Hélio' };

describe('ResponseHistory', () => {
  it('lists responses and returns chronologically, with who, when and exactly what', () => {
    render(<ResponseHistory submissions={submissions} returns={returns} fields={fields} nameOf={(id) => names[id ?? ''] ?? '—'} />);
    const items = screen.getAllByRole('listitem');
    const kind = (li: HTMLElement) => (li.textContent?.startsWith('Resposta de Nádia') ? 'resposta' : li.textContent?.startsWith('Devolvido à parceira') ? 'devolvido' : '?');
    expect(items.map(kind)).toEqual(['resposta', 'devolvido', 'resposta', 'devolvido', 'resposta']);
    const [first, askedText, secondAnswer, askedApproval, third] = items;
    expect(within(first!).getByText('Não')).toBeDefined(); // `false` is an answer
    expect(within(first!).getByText('Sem resposta')).toBeDefined(); // optional, unanswered
    expect(within(first!).getByText(/submissão 1 de 3/)).toBeDefined();
    expect(within(askedText!).getByText('Acontece no telemóvel?')).toBeDefined();
    expect(within(askedText!).getByText(/por Hélio/)).toBeDefined();
    expect(within(askedText!).getByText(/resposta: texto/)).toBeDefined();
    expect(within(secondAnswer!).getByText('Também no telemóvel.')).toBeDefined();
    expect(within(askedApproval!).getByText(/resposta: aprovação/)).toBeDefined();
    expect(within(third!).getByText('Precisa de alterações')).toBeDefined();
    expect(within(third!).getByText(/Falta o logótipo/)).toBeDefined();
  });

  it('says plainly when the partner has not answered yet', () => {
    render(<ResponseHistory submissions={[]} returns={[]} fields={fields} nameOf={() => '—'} />);
    expect(screen.getByText('Ainda sem resposta da parceira.')).toBeDefined();
  });
});
