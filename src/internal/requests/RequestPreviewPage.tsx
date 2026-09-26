/**
 * Pré-visualizar como parceira, then publish (03_UX_SPEC.md §15–§16).
 *
 * The partner column is the partner's own component fed by `cmd_preview_request`,
 * which reads the same server-side projection as `partner_requests`. The recipient
 * and checklist come from the internal row of the SAME revision (checked, and
 * re-read if they differ); the two stay separate objects. Publishing sends that
 * revision with one key per attempt. If the answer is lost, the same attempt is
 * repeated — never a new key — and the server says whether it had already landed.
 */
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../../platform/useAsync';
import { Icon } from '../../platform/ui/Icon';
import { EmptyState, ErrorState, LoadingBlock } from '../../platform/ui/States';
import type { Organization } from '../../modules/organizations/types';
import { fetchOrganizationMembers } from '../../modules/people/queries';
import { toResource, type ResourceRow } from '../../modules/resources/queries';
import { fetchInternalRequest } from '../../modules/requests/queries';
import { InconsistentReadError, loadPreviewBundle } from '../../modules/requests/consistent';
import { CommandError, commandErrorMessage, publishRequest } from '../../modules/requests/commands';
import { formatDueLong, formatEffort, isPast } from '../../modules/requests/format';
import { PartnerRequestView } from '../../partner/PartnerRequestView';
import { SessionExpiredNotice } from './SessionExpiredNotice';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function load(requestId: string, organizationId: string) {
  const [bundle, members] = await Promise.all([loadPreviewBundle(requestId), fetchOrganizationMembers(organizationId)]);
  return { ...bundle, members };
}

type PublishNotice =
  | { kind: 'error'; error: CommandError | Error }
  | { kind: 'ambiguous' }
  | { kind: 'elsewhere' }
  | { kind: 'session' };

export function RequestPreviewPage({ organization }: { organization: Organization }) {
  const { requestId = '' } = useParams<{ requestId: string }>();
  const navigate = useNavigate();
  const base = `/app/organizations/${organization.slug}/requests`;
  const [attempt, setAttempt] = useState(0);
  const result = useAsync(() => load(requestId, organization.id), [requestId, organization.id, attempt]);
  // One key per loaded preview: a retry of the same publication replays safely; a
  // reloaded preview is a new attempt with a new key.
  const [publishKey, setPublishKey] = useState(() => crypto.randomUUID());
  const [publishing, setPublishing] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<PublishNotice | null>(null);

  const reloadPreview = () => {
    setNotice(null);
    setPublishKey(crypto.randomUUID());
    setAttempt((a) => a + 1);
  };

  if (result.status === 'loading') return <LoadingBlock label="A preparar a pré-visualização" />;

  if (result.status === 'error') {
    const error = result.error;
    if (error instanceof CommandError && error.code === 'unauthenticated') return <SessionExpiredNotice unsavedWork={false} />;
    if (error instanceof CommandError && error.code === 'not_found') {
      return (
        <EmptyState title="Não encontrámos este pedido." tone="warn">
          Verifique o endereço ou volte à lista de pedidos.
        </EmptyState>
      );
    }
    return (
      <ErrorState onRetry={result.reload}>
        {error instanceof InconsistentReadError ? error.message : commandErrorMessage(error)}
      </ErrorState>
    );
  }

  const { preview, internal, members } = result.data;
  if (preview.organization_id !== organization.id || !internal) {
    return (
      <EmptyState title="Não encontrámos este pedido." tone="warn">
        Verifique o endereço ou volte à lista de pedidos.
      </EmptyState>
    );
  }

  const assignee = members.find((m) => m.profile.id === internal.assigneeProfileId)?.profile.displayName ?? 'a parceira';
  const isDraft = preview.status === 'draft';
  const request = preview.request;
  const authored = preview.fields.filter((f) => !f.system_generated);
  const requiredCount = authored.filter((f) => f.required).length;
  const needsQuestion = ['question', 'review', 'test'].includes(request.type);
  const singleChoiceIncomplete = authored.some(
    (f) => f.type === 'single_choice' && new Set((f.options ?? []).map((o) => o.trim().toLowerCase())).size < 2,
  );

  const checks: { ok: boolean; text: string }[] = [
    {
      ok: request.title.length <= 80,
      text:
        request.title.length <= 80
          ? `Título cabe no cartão (${request.title.length} caracteres).`
          : `Título longo para o cartão (${request.title.length} caracteres). Pode encurtar.`,
    },
    { ok: true, text: `Esforço: ${formatEffort(request.estimated_effort_minutes)}.` },
    request.due_at
      ? {
          ok: !isPast(request.due_at),
          text: isPast(request.due_at)
            ? `Prazo já passou (${formatDueLong(request.due_at)}, hora de Lisboa). A parceira vê-o como ultrapassado.`
            : `Prazo: ${formatDueLong(request.due_at)} (hora de Lisboa).`,
        }
      : { ok: true, text: 'Sem prazo: a parceira não vê nenhum prazo.' },
    preview.resource_unavailable
      ? { ok: false, text: 'O recurso associado não está activo ou não é visível para a parceira. Não é possível publicar assim.' }
      : { ok: true, text: preview.resource ? 'Recurso associado e visível para a parceira.' : 'Sem recurso associado.' },
    {
      ok: Boolean(internal.internal),
      text: internal.internal ? 'Critério de conclusão definido (só Sollelio).' : 'Falta o critério de conclusão. É obrigatório para publicar.',
    },
    request.type === 'approval'
      ? { ok: true, text: 'Aprovação com a decisão gerada pelo sistema e notas opcionais.' }
      : needsQuestion && authored.length === 0
        ? { ok: false, text: 'Este tipo precisa de pelo menos uma pergunta para publicar.' }
        : {
            ok: !singleChoiceIncomplete,
            text: singleChoiceIncomplete
              ? 'Há uma escolha única sem duas opções diferentes.'
              : authored.length === 0
                ? 'Sem perguntas.'
                : `${plural(authored.length, 'pergunta', 'perguntas')}, ${plural(requiredCount, 'obrigatória', 'obrigatórias')}.`,
          },
  ];

  async function publish() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPublishing(true);
    setNotice(null);
    try {
      // Always this preview's revision and this attempt's key — also on a retry.
      await publishRequest(preview.request_id, preview.revision, publishKey);
      navigate(`${base}/${preview.request_id}`, { state: { flash: `Publicado. ${assignee} já vê o pedido.` } });
    } catch (error) {
      if (error instanceof CommandError && error.code === 'unauthenticated') {
        setNotice({ kind: 'session' });
      } else if (error instanceof CommandError && error.ambiguous) {
        setNotice({ kind: 'ambiguous' });
      } else if (error instanceof CommandError && error.code === 'invalid_state') {
        // Not this attempt (that would have replayed): read what happened.
        const current = await fetchInternalRequest(preview.request_id).catch(() => null);
        setNotice(current && current.status !== 'draft' ? { kind: 'elsewhere' } : { kind: 'error', error });
      } else {
        setNotice({ kind: 'error', error: error instanceof Error ? error : new Error(String(error)) });
      }
    } finally {
      inFlight.current = false;
      setPublishing(false);
    }
  }

  const stale = notice?.kind === 'error' && notice.error instanceof CommandError && notice.error.code === 'stale_revision';
  const canPublish = isDraft && !stale && notice?.kind !== 'ambiguous' && notice?.kind !== 'elsewhere';

  return (
    <>
      <div className="head-line">
        <Link className="btn btn--ghost btn--sm" to={`${base}/${preview.request_id}`} style={{ marginLeft: -8 }}>
          <Icon name="back" size={18} />
          {isDraft ? 'Voltar a editar' : 'Voltar ao pedido'}
        </Link>
      </div>

      <div className="preview-bar">
        <Icon name="eye" size={20} />
        <span>
          <strong>Pré-visualização</strong> · exactamente o que {assignee} vai ver
          {isDraft ? ' depois de publicar' : ''}.
        </span>
      </div>

      <div className="preview-layout">
        <div className="zone">
          <section className="panel" aria-labelledby="preview-checks">
            <div className="panel__head">
              <h2 id="preview-checks">Verificação antes de publicar</h2>
            </div>
            <ul className="checklist">
              {checks.map((check) => (
                <li key={check.text}>
                  <span className={check.ok ? 'ok' : 'warn'}>
                    <Icon name={check.ok ? 'check' : 'alert'} size={18} />
                  </span>
                  <span>
                    <span className="visually-hidden">{check.ok ? 'Pronto: ' : 'Atenção: '}</span>
                    {check.text}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {notice?.kind === 'session' ? <SessionExpiredNotice unsavedWork={false} /> : null}

          {notice?.kind === 'ambiguous' ? (
            <div className="banner banner--warn" role="alert">
              <Icon name="alert" size={20} />
              <div>
                <span className="banner__title">Não sabemos se o pedido foi publicado.</span>
                <p>A ligação falhou depois do envio. «Verificar e repetir» repete exactamente a mesma publicação: se já tinha sido feita, não é feita outra vez.</p>
                <p style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn--secondary btn--sm" disabled={publishing} onClick={() => void publish()}>
                    <Icon name="refresh" size={16} />
                    {publishing ? 'A verificar…' : 'Verificar e repetir'}
                  </button>
                </p>
              </div>
            </div>
          ) : null}

          {notice?.kind === 'elsewhere' ? (
            <div className="banner" role="alert">
              <Icon name="alert" size={20} />
              <div>
                <span className="banner__title">Este pedido já não é um rascunho.</span>
                <p>Foi publicado por outra operação. Nada foi publicado outra vez.</p>
                <p style={{ marginTop: 8 }}>
                  <Link className="btn btn--secondary btn--sm" to={`${base}/${preview.request_id}`}>
                    Abrir o pedido
                  </Link>
                </p>
              </div>
            </div>
          ) : null}

          {notice?.kind === 'error' ? (
            <div className="banner banner--error" role="alert">
              <Icon name="alert" size={20} />
              <div>
                <span className="banner__title">{commandErrorMessage(notice.error)}</span>
                {notice.error instanceof CommandError && notice.error.fieldErrors.length > 0 ? (
                  <ul>
                    {notice.error.fieldErrors.map((item) => (
                      <li key={`${item.field}-${item.code}`}>{item.message}</li>
                    ))}
                  </ul>
                ) : null}
                {stale ? (
                  <p style={{ marginTop: 8 }}>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={reloadPreview}>
                      <Icon name="refresh" size={16} />
                      Recarregar a pré-visualização
                    </button>
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {canPublish ? (
            <div className="actions">
              <Link className="btn btn--quiet" to={`${base}/${preview.request_id}`}>
                Voltar a editar
              </Link>
              <button type="button" className="btn btn--primary" disabled={publishing} aria-busy={publishing} onClick={() => void publish()}>
                <Icon name="send" size={18} />
                {publishing ? 'A publicar…' : `Publicar para ${assignee}`}
              </button>
            </div>
          ) : null}
          <p className="visually-hidden" role="status" aria-live="polite">
            {publishing ? 'A publicar o pedido.' : ''}
          </p>
          {isDraft ? (
            <p className="field__hint" style={{ margin: 0 }}>
              Publicar passa o pedido a “Espera pela parceira” e regista a actividade. Não envia nenhuma notificação: o
              aviso no WhatsApp é manual.
            </p>
          ) : null}
        </div>

        <div className="preview-frame" aria-label={`Como ${assignee} vê o pedido`}>
          <PartnerRequestView
            request={request}
            fields={preview.fields}
            resource={preview.resource ? toResource(preview.resource as unknown as ResourceRow) : null}
            resourceUnavailable={preview.resource_unavailable}
            headingLevel={2}
          />
        </div>
      </div>
    </>
  );
}
