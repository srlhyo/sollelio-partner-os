/**
 * `/partner/requests/:id` — one Request, and the round the partner answers now (C3).
 *
 * A Request that does not exist and one this partner may not see look exactly the
 * same: `partner_requests` returns nothing for both, and so does this page.
 *
 * Everything shown comes from the server: after a submission, and whenever the
 * server says the Request changed meanwhile, the page reads it again instead of
 * guessing (05_DATA_MODEL_AND_API.md §13).
 */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAsync } from '../platform/useAsync';
import { Icon } from '../platform/ui/Icon';
import { ErrorState, LoadingBlock } from '../platform/ui/States';
import { fetchPartnerRequest, fetchPartnerReturns, fetchRequestFields, fetchSubmissions } from '../modules/requests/queries';
import { currentRound } from '../modules/requests/rounds';
import { fetchVisibleResource } from '../modules/resources/queries';
import { PartnerShell } from './PartnerShell';
import { PartnerRequestView } from './PartnerRequestView';
import { PartnerResponse } from './PartnerResponse';
import { PreviousResponses } from './PreviousResponses';
import { SubmissionSuccess } from './SubmissionSuccess';

async function load(id: string) {
  const request = await fetchPartnerRequest(id);
  if (!request) return null;
  const [fields, resource, returns, submissions] = await Promise.all([
    fetchRequestFields(id),
    request.resource_id ? fetchVisibleResource(request.resource_id) : Promise.resolve(null),
    fetchPartnerReturns(id),
    fetchSubmissions(id),
  ]);
  return { request, fields, resource, returns, submissions };
}

export function PartnerRequestDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<'sent' | 'changed' | null>(null);
  const result = useAsync(() => load(id), [id, version]);
  const reload = () => setVersion((v) => v + 1);

  return (
    <PartnerShell back={{ to: '/partner', label: 'Início' }}>
      <div className="partner__body">
        {notice === 'sent' && result.status === 'ready' && result.data ? (
          <SubmissionSuccess organizationId={result.data.request.organization_id} title={result.data.request.title} />
        ) : null}
        {notice === 'changed' ? (
          <div className="banner banner--warn" role="status">
            <Icon name="alert" size={20} />
            <p>Este pedido mudou entretanto. Mostramos-lhe o que ele pede agora.</p>
          </div>
        ) : null}

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

        {result.status === 'ready' && result.data ? <Loaded data={result.data} onSent={() => { setNotice('sent'); reload(); }}
          onChanged={() => { setNotice('changed'); reload(); }} /> : null}
      </div>
    </PartnerShell>
  );
}

function Loaded({
  data,
  onSent,
  onChanged,
}: {
  data: NonNullable<Awaited<ReturnType<typeof load>>>;
  onSent: () => void;
  onChanged: () => void;
}) {
  const { request, fields, resource, returns, submissions } = data;
  const actionable = request.partner_state === 'needs_you';
  const round = currentRound(returns, submissions);
  const common = {
    request,
    fields,
    resource,
    resourceUnavailable: Boolean(request.resource_id) && !resource,
  };

  if (actionable && round.kind === 'returned') {
    return (
      <PartnerRequestView
        {...common}
        followUp={
          <PartnerResponse key={round.ret.id} request={request} fields={fields} round={round} onDone={onSent} onChanged={onChanged} />
        }
      >
        <PreviousResponses title="A sua resposta anterior" submissions={submissions} returns={returns} fields={fields} />
      </PartnerRequestView>
    );
  }

  if (actionable) {
    return (
      <PartnerRequestView {...common}>
        <PartnerResponse key="initial" request={request} fields={fields} round={round} onDone={onSent} onChanged={onChanged} />
      </PartnerRequestView>
    );
  }

  return (
    <PartnerRequestView {...common}>
      <PreviousResponses title="A sua resposta" submissions={submissions} returns={returns} fields={fields} />
    </PartnerRequestView>
  );
}
