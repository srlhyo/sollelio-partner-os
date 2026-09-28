/**
 * A Request on Partner Home: what, how long, by when, and one clear way in
 * (03_UX_SPEC.md §4). No IDs, priority, owner or lifecycle names. A Request Sollelio
 * returned says so in plain words (03 §5, "Falta só isto").
 */
import { Link } from 'react-router-dom';
import { Icon } from '../platform/ui/Icon';
import { formatDueShort, formatEffort } from '../modules/requests/format';
import { REQUEST_TYPE_LABELS, type PartnerRequestRecord } from '../modules/requests/types';

export function RequestCard({ request, returned = false }: { request: PartnerRequestRecord; returned?: boolean }) {
  return (
    <Link className={returned ? 'rq rq--returned' : 'rq'} to={`/partner/requests/${request.id}`}>
      {returned ? <span className="rq__flag">Voltou a precisar de si</span> : null}
      <span className="rq__eyebrow">
        <span>{REQUEST_TYPE_LABELS[request.type]}</span>
        {request.product_name ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{request.product_name}</span>
          </>
        ) : null}
      </span>
      <span className="rq__title">{request.title}</span>
      <span className="rq__foot">
        <span className="rq__meta">
          <span>
            <Icon name="clock" size={16} />
            {formatEffort(request.estimated_effort_minutes)}
            <span className="visually-hidden"> de esforço estimado</span>
          </span>
          {request.due_at ? <span className="rq__due">{formatDueShort(request.due_at)}</span> : null}
        </span>
        <span className="rq__cta" aria-hidden="true">
          Abrir
          <Icon name="arrow" size={16} />
        </span>
      </span>
    </Link>
  );
}
