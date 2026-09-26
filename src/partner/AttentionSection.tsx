/**
 * "Precisa de si" — the first thing on Partner Home (03_UX_SPEC.md §3).
 *
 * Requests awaiting this partner only (partner_state = needs_you). Issues join the
 * same list in Slice 4. The total effort line appears from two Requests up: with a
 * single one, the card already says how long it takes.
 */
import { useAsync } from '../platform/useAsync';
import { EmptyState, ErrorState, LoadingBlock } from '../platform/ui/States';
import { fetchPartnerAttention } from '../modules/requests/queries';
import { comparePartnerAttention } from '../modules/requests/order';
import { RequestCard } from './RequestCard';

export function AttentionSection({ organizationId }: { organizationId: string }) {
  const requests = useAsync(() => fetchPartnerAttention(organizationId), [organizationId]);

  return (
    <section className="attn" aria-labelledby="attention-title">
      <div>
        <h2 className="attn__title" id="attention-title">
          Precisa de si
        </h2>
        {requests.status === 'ready' && requests.data.length >= 2 ? (
          <p className="attn__sum">
            <strong>{requests.data.length} pedidos</strong> · cerca de{' '}
            {requests.data.reduce((sum, request) => sum + request.estimated_effort_minutes, 0)} min no total
          </p>
        ) : null}
      </div>

      {requests.status === 'loading' ? <LoadingBlock label="A carregar os seus pedidos" /> : null}

      {requests.status === 'error' ? (
        <ErrorState onRetry={requests.reload}>Não conseguimos carregar os seus pedidos agora.</ErrorState>
      ) : null}

      {requests.status === 'ready' && requests.data.length === 0 ? (
        <EmptyState title="Está tudo em dia.">
          Nada precisa de si neste momento. Quando a Sollelio lhe pedir algo, aparece aqui.
        </EmptyState>
      ) : null}

      {requests.status === 'ready' && requests.data.length > 0 ? (
        <ul className="rq-list">
          {[...requests.data].sort(comparePartnerAttention).map((request) => (
            <li key={request.id}>
              <RequestCard request={request} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
