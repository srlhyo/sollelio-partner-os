/**
 * `/app/organizations/:slug/requests/:requestId` — the editor for a draft, the
 * read-only detail otherwise. A Request of another organization is "not found"
 * here, whatever its id.
 */
import { useLocation, useParams } from 'react-router-dom';
import { useAsync } from '../../platform/useAsync';
import { Icon } from '../../platform/ui/Icon';
import { EmptyState, ErrorState, LoadingBlock } from '../../platform/ui/States';
import type { Organization } from '../../modules/organizations/types';
import { InconsistentReadError, loadEditableAggregate } from '../../modules/requests/consistent';
import { InternalRequestDetail } from './InternalRequestDetail';
import { RequestEditor } from './RequestEditor';

export function RequestRoute({ organization }: { organization: Organization }) {
  const { requestId = '' } = useParams<{ requestId: string }>();
  const location = useLocation();
  const flash = (location.state as { flash?: string } | null)?.flash;
  // Row, internal details and fields of ONE revision: a mixed read is retried.
  const result = useAsync(() => loadEditableAggregate(requestId), [requestId]);

  if (result.status === 'loading') return <LoadingBlock label="A carregar o pedido" />;
  if (result.status === 'error') {
    return (
      <ErrorState onRetry={result.reload}>
        {result.error instanceof InconsistentReadError ? result.error.message : 'Não foi possível carregar este pedido.'}
      </ErrorState>
    );
  }

  if (!result.data || result.data.request.organizationId !== organization.id) {
    return (
      <EmptyState title="Não encontrámos este pedido." tone="warn">
        Verifique o endereço ou volte à lista de pedidos desta organização.
      </EmptyState>
    );
  }

  if (result.data.request.status === 'draft') {
    return (
      <>
        {flash ? (
          <div className="banner banner--ok" role="status">
            <Icon name="check" size={20} />
            <p>{flash}</p>
          </div>
        ) : null}
        <RequestEditor
          key={`${result.data.request.id}-${result.data.request.revision}`}
          organization={organization}
          existing={result.data}
          onReload={result.reload}
        />
      </>
    );
  }

  return <InternalRequestDetail organization={organization} request={result.data.request} fields={result.data.fields} />;
}
