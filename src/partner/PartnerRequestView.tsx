/**
 * How a partner reads one Request (03_UX_SPEC.md §5–§7).
 *
 * The single presentation of the partner-facing Request. The partner detail page
 * and the staff "Pré-visualizar como parceira" both render this, from the same
 * server-side projection (`partner_requests` / `cmd_preview_request`).
 *
 * C2 is read-only: questions are listed so the partner knows what will be asked,
 * with no inputs and no submit control. Responding arrives with C3.
 */
import { Icon } from '../platform/ui/Icon';
import { formatDueLong, formatEffort, longDate } from '../modules/requests/format';
import {
  REQUEST_TYPE_LABELS,
  type PartnerRequestRecord,
  type RequestFieldRecord,
} from '../modules/requests/types';
import type { Resource } from '../modules/resources/types';
import { ResourceList } from './ResourceList';

function describeField(field: RequestFieldRecord): string {
  if (field.system_generated && field.key === 'approval') return 'Aprovar ou Precisa de alterações';
  if (field.system_generated && field.key === 'approval_notes') {
    return 'Resposta escrita, só se escolher “Precisa de alterações”';
  }
  switch (field.type) {
    case 'long_text':
      return 'Resposta escrita';
    case 'boolean':
      return 'Sim ou não';
    case 'single_choice':
      return field.options && field.options.length > 0
        ? `Escolha uma opção: ${field.options.join(' · ')}`
        : 'Escolha uma opção';
    default:
      return '';
  }
}

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

export function PartnerRequestView({
  request,
  fields,
  resource,
  resourceUnavailable,
  headingLevel = 1,
}: {
  request: PartnerRequestRecord;
  fields: RequestFieldRecord[];
  resource: Resource | null;
  resourceUnavailable: boolean;
  headingLevel?: 1 | 2;
}) {
  const Title = headingLevel === 1 ? 'h1' : 'h2';
  const ordered = [...fields].sort((a, b) => a.sort_order - b.sort_order);

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

      {ordered.length > 0 ? (
        <section className="dt__block" aria-labelledby={`questions-${request.id}`}>
          <span className="dt__label" id={`questions-${request.id}`}>
            O que vamos perguntar
          </span>
          <ol className="qs">
            {ordered.map((field) => (
              <li key={field.id} className="qs__item">
                <span className="qs__label">{field.label}</span>
                <span className="qs__kind">{describeField(field)}</span>
                {field.help_text ? <p className="qs__help">{field.help_text}</p> : null}
                <span className="qs__req">{field.required ? 'Obrigatória' : 'Opcional'}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </article>
  );
}
