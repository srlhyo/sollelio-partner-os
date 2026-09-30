/**
 * The partner-facing Request presentation, shared by the partner detail and the
 * staff preview. In C3 the preview shows the partner's real response controls, but
 * none of them can be used and nothing can be sent (03_UX_SPEC.md §16).
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
  related_update_id: null, resource_id: null, cancellation_reason: null,
};

const field = (patch: Partial<RequestFieldRecord>): RequestFieldRecord => ({
  id: patch.key ?? 'f', request_id: 'r1', key: 'q1', label: 'Pergunta', help_text: null, type: 'long_text',
  required: true, options: null, sort_order: 1, system_generated: false, ...patch,
});

describe('PartnerRequestView', () => {
  it('preview: shows what, why, how long, and the partner\'s controls — none of them usable', () => {
    const { container } = render(
      <PartnerRequestView
        request={base}
        fields={[
          field({ key: 'q1', label: 'Foi óbvio?', type: 'boolean' }),
          field({ key: 'q2', label: 'Qual?', type: 'single_choice', options: ['A', 'B'], sort_order: 2, required: false }),
        ]}
        resource={null}
        resourceUnavailable={false}
        preview
      />,
    );
    expect(screen.getByRole('heading', { name: base.title })).toBeDefined();
    expect(screen.getByText('~3 min')).toBeDefined();
    expect(screen.getByText('Porque pedimos')).toBeDefined();
    // The same controls the partner receives…
    expect(screen.getByRole('group', { name: 'Foi óbvio?' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Sim' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Não' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'A' })).toBeDefined();
    expect(screen.getByText('(opcional)')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Enviar resposta' })).toBeDefined();
    // …and not one of them can be used.
    const controls = container.querySelectorAll('input, textarea, select, button');
    expect(controls.length).toBeGreaterThan(0);
    expect([...controls].every((el) => (el as HTMLInputElement).matches(':disabled'))).toBe(true);
    expect(container.querySelector('form')).toBeNull();
  });

  it('without the preview flag and without a response area, renders no controls', () => {
    const { container } = render(
      <PartnerRequestView request={base} fields={[field({ key: 'q1', type: 'boolean' })]} resource={null} resourceUnavailable={false} />,
    );
    expect(container.querySelectorAll('input, textarea, select, button').length).toBe(0);
  });

  it('renders <1 min, and no deadline element when there is no deadline', () => {
    render(<PartnerRequestView request={{ ...base, estimated_effort_minutes: 1 }} fields={[]} resource={null} resourceUnavailable={false} />);
    expect(screen.getByText('<1 min')).toBeDefined();
    expect(screen.queryByText(/até|prazo/i)).toBeNull();
  });

  it('preview: an approval Request shows the two decisions; notes only appear after “Precisa de alterações”', () => {
    render(
      <PartnerRequestView
        request={{ ...base, type: 'approval' }}
        fields={[
          field({ key: 'approval', label: 'A sua decisão', type: 'approval', system_generated: true, options: ['approve', 'needs_changes'] }),
          field({ key: 'approval_notes', label: 'O que deve mudar?', system_generated: true, required: false, sort_order: 2 }),
        ]}
        resource={null}
        resourceUnavailable={false}
        preview
      />,
    );
    expect(screen.getByRole('radio', { name: 'Aprovar' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Precisa de alterações' })).toBeDefined();
    expect(screen.queryByLabelText(/O que deve mudar/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Enviar decisão' })).toBeDefined();
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
    expect(screen.getByText('Este pedido foi cancelado pela Sollelio.')).toBeDefined();
    rerender(
      <PartnerRequestView
        request={{ ...base, partner_state: 'cancelled', cancelled_at: '2026-09-30T10:00:00Z', cancellation_reason: 'O evento foi adiado.' }}
        fields={[]}
        resource={null}
        resourceUnavailable={false}
      />,
    );
    // The reason Sollelio gave is shown; nothing can be answered.
    expect(screen.getByText('O evento foi adiado.')).toBeDefined();
    expect(screen.getByText('Já não precisa de fazer nada aqui.')).toBeDefined();
    expect(document.querySelectorAll('input, textarea, select, button').length).toBe(0);
  });

  it('handles a link that is no longer available without exposing it', () => {
    render(<PartnerRequestView request={{ ...base, resource_id: 'res-1' }} fields={[]} resource={null} resourceUnavailable />);
    expect(screen.getByText(/O link deste pedido já não está disponível/)).toBeDefined();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
