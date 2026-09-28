/**
 * How a partner reads one Request (03_UX_SPEC.md §5–§7).
 *
 * The single presentation of the partner-facing Request. The partner detail page
 * and the staff "Pré-visualizar como parceira" both render this, from the same
 * server-side projection (`partner_requests` / `cmd_preview_request`).
 *
 * The response area is the caller's: the partner detail passes the live form (or
 * the read-only response), and the preview asks for `preview`, which renders the
 * same controls the partner will receive, none of them usable (03 §16). When the
 * Request came back to the partner, `followUp` ("Falta só isto") comes first and the
 * published content below reads as the original Request.
 */
import type { ReactNode } from 'react';
import { Icon } from '../platform/ui/Icon';
import { formatDueLong, formatEffort, longDate } from '../modules/requests/format';
import {
  REQUEST_TYPE_LABELS,
  type PartnerRequestRecord,
  type RequestFieldRecord,
} from '../modules/requests/types';
import type { Resource } from '../modules/resources/types';
import { InitialResponseFields } from './InitialResponseFields';
import { ResourceList } from './ResourceList';

function StateBanner({ request }: { request: PartnerRequestRecord }) {
  switch (request.partner_state) {
    case 'with_sollelio':
      return (
        <div className="banner" role="status">
          <Icon name="check" size={20} />
          <div>
            <span className="banner__title">Está com a Sollelio</span>
            <p>Não precisa de fazer mais nada neste pedido.</p>
          </div>
        </div>
      );
    case 'done':
      return (
        <div className="banner banner--ok" role="status">
          <Icon name="check" size={20} />
          <div>
            <span className="banner__title">
              Concluído{request.completed_at ? ` a ${longDate(new Date(request.completed_at))}` : ''}
            </span>
            <p>Obrigado. Este pedido está fechado.</p>
          </div>
        </div>
      );
    case 'cancelled':
      return (
        <div className="banner banner--muted" role="status">
          <Icon name="alert" size={20} />
          <div>
            <span className="banner__title">
              A Sollelio cancelou este pedido
              {request.cancelled_at ? ` a ${longDate(new Date(request.cancelled_at))}` : ''}
            </span>
            <p>Já não precisa de fazer nada aqui.</p>
          </div>
        </div>
      );
    default:
      return null;
  }
}

/** The partner's controls for the published Request, shown in the staff preview: visible, not usable. */
function PreviewControls({ request, fields }: { request: PartnerRequestRecord; fields: RequestFieldRecord[] }) {
  return (
    <div className="respond respond--preview" aria-label="Como a parceira responde">
      <span className="dt__label">A sua resposta</span>
      <fieldset className="form-lock" disabled>
        {fields.length > 0 ? (
          <InitialResponseFields fields={fields} draft={{}} onChange={() => undefined} idPrefix={`preview-${request.id}`} disabled />
        ) : (
          <p className="respond__note">Confirme quando tiver feito o que pedimos.</p>
        )}
        <div className="respond__actions">
          <button type="button" className="btn btn--primary btn--block" disabled>
            {request.type === 'approval' ? 'Enviar decisão' : 'Enviar resposta'}
          </button>
          <p className="respond__note">Pré-visualização: nada é enviado daqui.</p>
        </div>
      </fieldset>
    </div>
  );
}

export function PartnerRequestView({
  request,
  fields,
  resource,
  resourceUnavailable,
  headingLevel = 1,
  followUp,
  preview = false,
  children,
}: {
  request: PartnerRequestRecord;
  fields: RequestFieldRecord[];
  resource: Resource | null;
  resourceUnavailable: boolean;
  headingLevel?: 1 | 2;
  /** The current return's question, shown first ("Falta só isto"). */
  followUp?: ReactNode;
  /** Render the response controls non-interactively (staff preview). */
  preview?: boolean;
  /** The response area: the live form, or the read-only response. */
  children?: ReactNode;
}) {
  const Title = headingLevel === 1 ? 'h1' : 'h2';

  return (
    <article className="dt">
      <header className="dt__head">
        <div className="dt__meta">
          <span>{REQUEST_TYPE_LABELS[request.type]}</span>
          {request.product_name ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{request.product_name}</span>
            </>
          ) : null}
        </div>
        <Title className="dt__title">{request.title}</Title>
        <div className="dt__meta">
          <span>
            <Icon name="clock" size={16} />
            {formatEffort(request.estimated_effort_minutes)}
            <span className="visually-hidden"> de esforço estimado</span>
          </span>
          {request.due_at ? <span className="rq__due">{formatDueLong(request.due_at)}</span> : null}
        </div>
      </header>

      <StateBanner request={request} />

      {followUp}
      {followUp ? <span className="dt__label">O pedido original</span> : null}

      {request.context ? (
        <section className="dt__block" aria-label="Porque pedimos">
          <span className="dt__label">Porque pedimos</span>
          <p className="dt__text">{request.context}</p>
        </section>
      ) : null}

      <section className="dt__block" aria-label="O que precisamos que faça">
        <span className="dt__label">O que precisamos que faça</span>
        <p className="dt__action">{request.requested_action}</p>
      </section>

      {resource ? <ResourceList resources={[resource]} /> : null}
      {!resource && resourceUnavailable ? (
        <div className="banner banner--muted">
          <Icon name="link" size={20} />
          <p>O link deste pedido já não está disponível. Fale com a Sollelio.</p>
        </div>
      ) : null}

      {preview ? <PreviewControls request={request} fields={fields} /> : children}
    </article>
  );
}
