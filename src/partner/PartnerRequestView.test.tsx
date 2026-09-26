/**
 * The partner-facing Request presentation, shared by the partner detail and the
 * staff preview. C2 is read-only: no answer inputs, no submit control.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PartnerRequestView } from './PartnerRequestView';
import type { PartnerRequestRecord, RequestFieldRecord } from '../modules/requests/types';

const base: PartnerRequestRecord = {
  id: 'r1', organization_id: 'o1', product_id: null, product_name: 'Sollelio Events', type: 'question',
  title: 'Os endereços foram fáceis de encontrar?', context: 'Para confirmar a primeira visita.',
  requested_action: 'Abra o Sollelio Events e volte aqui.', estimated_effort_minutes: 3, due_at: null,
  partner_state: 'needs_you', published_at: '2026-09-25T10:00:00Z', completed_at: null, cancelled_at: null,
  related_update_id: null, resource_id: null,
};

const field = (patch: Partial<RequestFieldRecord>): RequestFieldRecord => ({
  id: patch.key ?? 'f', request_id: 'r1', key: 'q1', label: 'Pergunta', help_text: null, type: 'long_text',
  required: true, options: null, sort_order: 1, system_generated: false, ...patch,
});

describe('PartnerRequestView', () => {
  it('shows what, why, how long, and the questions — read-only', () => {
    const { container } = render(
      <PartnerRequestView
        request={base}
        fields={[
          field({ key: 'q1', label: 'Foi óbvio?', type: 'boolean' }),
          field({ key: 'q2', label: 'Qual?', type: 'single_choice', options: ['A', 'B'], sort_order: 2, required: false }),
        ]}
        resource={null}
        resourceUnavailable={false}
      />,
    );
    expect(screen.getByRole('heading', { name: base.title })).toBeDefined();
    expect(screen.getByText('~3 min')).toBeDefined();
    expect(screen.getByText('Porque pedimos')).toBeDefined();
    expect(screen.getByText('Sim ou não')).toBeDefined();
    expect(screen.getByText('Escolha uma opção: A · B')).toBeDefined();
    expect(screen.getByText('Opcional')).toBeDefined();
    // No way to answer, and nothing pretending to be one.
    expect(container.querySelectorAll('input, textarea, select, button').length).toBe(0);
  });

  it('renders <1 min, and no deadline element when there is no deadline', () => {
    render(<PartnerRequestView request={{ ...base, estimated_effort_minutes: 1 }} fields={[]} resource={null} resourceUnavailable={false} />);
    expect(screen.getByText('<1 min')).toBeDefined();
    expect(screen.queryByText(/até|prazo/i)).toBeNull();
  });

  it('describes the system approval decision and optional notes', () => {
    render(
      <PartnerRequestView
        request={{ ...base, type: 'approval' }}
        fields={[
          field({ key: 'approval', label: 'A sua decisão', type: 'approval', system_generated: true, options: ['approve', 'needs_changes'] }),
          field({ key: 'approval_notes', label: 'O que deve mudar?', system_generated: true, required: false, sort_order: 2 }),
        ]}
        resource={null}
        resourceUnavailable={false}
      />,
    );
    expect(screen.getByText('Aprovar ou Precisa de alterações')).toBeDefined();
    expect(screen.getByText(/só se escolher “Precisa de alterações”/)).toBeDefined();
  });

  it('states the terminal partner states plainly', () => {
    const { rerender } = render(
      <PartnerRequestView request={{ ...base, partner_state: 'with_sollelio' }} fields={[]} resource={null} resourceUnavailable={false} />,
    );
    expect(screen.getByText('Está com a Sollelio')).toBeDefined();
    rerender(
      <PartnerRequestView request={{ ...base, partner_state: 'done', completed_at: '2026-09-30T10:00:00Z' }} fields={[]} resource={null} resourceUnavailable={false} />,
    );
    expect(screen.getByText(/^Concluído/)).toBeDefined();
    rerender(
      <PartnerRequestView request={{ ...base, partner_state: 'cancelled', cancelled_at: '2026-09-30T10:00:00Z' }} fields={[]} resource={null} resourceUnavailable={false} />,
    );
    expect(screen.getByText(/A Sollelio cancelou este pedido/)).toBeDefined();
  });

  it('handles a link that is no longer available without exposing it', () => {
    render(<PartnerRequestView request={{ ...base, resource_id: 'res-1' }} fields={[]} resource={null} resourceUnavailable />);
    expect(screen.getByText(/O link deste pedido já não está disponível/)).toBeDefined();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
