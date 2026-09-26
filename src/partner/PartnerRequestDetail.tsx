/**
 * `/partner/requests/:id` — one Request, read-only in C2.
 *
 * A Request that does not exist and one this partner may not see look exactly the
 * same: `partner_requests` returns nothing for both, and so does this page.
 */
import { useParams } from 'react-router-dom';
import { useAsync } from '../platform/useAsync';
import { ErrorState, LoadingBlock } from '../platform/ui/States';
import { fetchPartnerRequest, fetchRequestFields } from '../modules/requests/queries';
import { fetchVisibleResource } from '../modules/resources/queries';
import { PartnerShell } from './PartnerShell';
import { PartnerRequestView } from './PartnerRequestView';

async function load(id: string) {
  const request = await fetchPartnerRequest(id);
  if (!request) return null;
  const [fields, resource] = await Promise.all([
    fetchRequestFields(id),
    request.resource_id ? fetchVisibleResource(request.resource_id) : Promise.resolve(null),
  ]);
  return { request, fields, resource };
}

export function PartnerRequestDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const result = useAsync(() => load(id), [id]);

  return (
    <PartnerShell back={{ to: '/partner', label: 'Início' }}>
      <div className="partner__body">
        {result.status === 'loading' ? <LoadingBlock label="A carregar o pedido" /> : null}

        {result.status === 'error' ? (
          <ErrorState onRetry={result.reload}>
            Não conseguimos carregar este pedido agora. Verifique a ligação e tente novamente.
          </ErrorState>
        ) : null}

        {result.status === 'ready' && !result.data ? (
          <ErrorState title="Não conseguimos abrir este pedido." onRetry={result.reload}>
            Pode já não estar disponível. Volte ao início para ver o que precisa de si.
          </ErrorState>
        ) : null}

        {result.status === 'ready' && result.data ? (
          <PartnerRequestView
            request={result.data.request}
            fields={result.data.fields}
            resource={result.data.resource}
            resourceUnavailable={Boolean(result.data.request.resource_id) && !result.data.resource}
          />
        ) : null}
      </div>
    </PartnerShell>
  );
}
