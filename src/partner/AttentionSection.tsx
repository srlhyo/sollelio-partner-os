/**
 * "Precisa de si" — the first thing on Partner Home (03_UX_SPEC.md §3).
 *
 * Requests awaiting this partner only (partner_state = needs_you). Issues join the
 * same list in Slice 4. The total effort line appears from two Requests up: with a
 * single one, the card already says how long it takes.
 */
import { useAsync } from '../platform/useAsync';
import { EmptyState, ErrorState, LoadingBlock } from '../platform/ui/States';
import { fetchPartnerAttention, fetchReturnedRequestIds } from '../modules/requests/queries';
import { comparePartnerAttention } from '../modules/requests/order';
import { RequestCard } from './RequestCard';

/** Requests awaiting the partner, and which of them came back after a return. */
async function loadAttention(organizationId: string) {
  const list = await fetchPartnerAttention(organizationId);
  const returned = await fetchReturnedRequestIds(list.map((request) => request.id));
  return { list, returned };
}

export function AttentionSection({ organizationId }: { organizationId: string }) {
  const attention = useAsync(() => loadAttention(organizationId), [organizationId]);
  const requests =
    attention.status === 'ready' ? { status: 'ready' as const, data: attention.data.list } : attention;
  const returned = attention.status === 'ready' ? attention.data.returned : new Set<string>();

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
        <ErrorState onRetry={attention.reload}>Não conseguimos carregar os seus pedidos agora.</ErrorState>
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
              <RequestCard request={request} returned={returned.has(request.id)} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
