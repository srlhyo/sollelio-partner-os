/**
 * Create or edit a draft Request (03_UX_SPEC.md §16).
 *
 * Two visibly separate zones: what the partner will read, and what is Sollelio's
 * only. Saving a draft needs the minimum the schema needs (person, type, title,
 * action, effort); everything else is asked for at publication, by the server.
 *
 * Saving is one attempt at a time. While it runs the whole form is locked, so nothing
 * typed can be lost behind a navigation. If the answer is lost after sending, the
 * attempt is kept in memory: the next save first confirms that attempt — repeating
 * it exactly, or reading what the server holds — and only then saves anything newer.
 * A change made by another session is never overwritten without an explicit choice.
 */
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAsync } from '../../platform/useAsync';
import { Icon } from '../../platform/ui/Icon';
import { ErrorState, LoadingBlock } from '../../platform/ui/States';
import type { Organization } from '../../modules/organizations/types';
import { fetchOrganizationMembers } from '../../modules/people/queries';
import { fetchOrganizationProducts } from '../../modules/products/queries';
import { fetchAllResources } from '../../modules/resources/queries';
import { fetchStaffProfiles } from '../../modules/requests/queries';
import { loadEditableAggregate } from '../../modules/requests/consistent';
import {
  CommandError,
  commandErrorMessage,
  createRequestDraft,
  updateRequestDraft,
  type DraftPayload,
} from '../../modules/requests/commands';
import { formatEffort, fromDateInput, isPast } from '../../modules/requests/format';
import {
  EFFORT_PRESETS,
  FIELD_TYPE_LABELS,
  LIMITS,
  PRIORITY_LABELS,
  REQUEST_TYPE_LABELS,
  REQUEST_TYPES,
  type Priority,
  type RequestType,
} from '../../modules/requests/types';
import { resourceHost } from '../../modules/resources/types';
import {
  aggregateMatches,
  initialState,
  newQuestion,
  samePayload,
  toPayload,
  validate,
  type AuthorFieldType,
  type EditableAggregate,
  type Errors,
  type FormState,
  type QuestionDraft,
} from './draftForm';
import { SessionExpiredNotice } from './SessionExpiredNotice';
import { useCurrentProfile } from '../useCurrentProfile';

/**
 * One save sent to the server; kept while its outcome is unknown. `actorProfileId`
 * is the signed-in staff profile when it was sent: the server derives the actor from
 * that same verified session and fills a blank internal owner with it.
 */
type Attempt =
  | { kind: 'create'; id: string; payload: DraftPayload; actorProfileId: string | null }
  | { kind: 'update'; id: string; expectedRevision: number; payload: DraftPayload; actorProfileId: string | null };

type Notice =
  | { kind: 'saved'; text: string }
  | { kind: 'error'; text: string }
  | { kind: 'ambiguous' }
  | { kind: 'conflict'; currentRevision: number }
  | { kind: 'session' };

/** Stable element ids for error links and aria-describedby. */
const idFor = (path: string) => `rq-${path.replace(/[[\].]+/g, '-').replace(/-+$/, '')}`;

function Field({
  path,
  label,
  optional,
  hint,
  errors,
  children,
}: {
  path: string;
  label: string;
  optional?: boolean;
  hint?: ReactNode;
  errors: Errors;
  children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
}) {
  const id = idFor(path);
  const error = errors[path];
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {optional ? <span className="field__optional"> (opcional)</span> : null}
      </label>
      {children({ id, ...(error ? { 'aria-invalid': true as const } : {}), ...(describedBy ? { 'aria-describedby': describedBy } : {}) })}
      {hint ? (
        <span className="field__hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="field__error" id={`${id}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

class Conflict extends Error {
  readonly currentRevision: number;
  readonly requestId: string;
  constructor(requestId: string, currentRevision: number) {
    super('conflict');
    this.requestId = requestId;
    this.currentRevision = currentRevision;
  }
}

export function RequestEditor({
  organization,
  existing,
  onReload,
}: {
  organization: Organization;
  existing: EditableAggregate | null;
  onReload?: () => void;
}) {
  const navigate = useNavigate();
  const base = `/app/organizations/${organization.slug}/requests`;
  const formId = useId();
  // Generated once for this new draft; every repetition of its creation reuses it.
  const [createKey] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState<FormState>(() => initialState(existing));
  const [requestId, setRequestId] = useState<string | null>(existing?.request.id ?? null);
  const [revision, setRevision] = useState<number | null>(existing?.request.revision ?? null);
  const [pending, setPending] = useState<Attempt | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const actor = useCurrentProfile();
  const summaryRef = useRef<HTMLDivElement>(null);

  const options = useAsync(
    () =>
      Promise.all([
        fetchOrganizationMembers(organization.id),
        fetchStaffProfiles(),
        fetchOrganizationProducts(organization.id),
        fetchAllResources(organization.id),
      ]),
    [organization.id],
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setQuestion = (index: number, patch: Partial<QuestionDraft>) =>
    setForm((f) => ({ ...f, questions: f.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)) }));

  const errorList = useMemo(() => Object.entries(errors), [errors]);

  if (options.status === 'loading') return <LoadingBlock label="A preparar o formulário" />;
  if (options.status === 'error') {
    return <ErrorState onRetry={options.reload}>Não foi possível carregar as pessoas, produtos e recursos.</ErrorState>;
  }

  const [members, staff, products, resources] = options.data;
  const activeMembers = members.filter((m) => m.membershipStatus === 'active');
  const activeProducts = products.filter((p) => p.status === 'active' && p.product.status === 'active');
  const offeredResources = resources.filter(
    (r) => (r.status === 'active' && r.partnerVisible) || r.id === form.resourceId,
  );
  const assigneeName = activeMembers.find((m) => m.profile.id === form.assignee)?.profile.displayName;

  const focusSummary = () => requestAnimationFrame(() => summaryRef.current?.focus());

  /** Sends one attempt. Throws CommandError (ambiguous or definitive). */
  async function send(attempt: Attempt): Promise<number> {
    const result =
      attempt.kind === 'create'
        ? await createRequestDraft(attempt.id, attempt.payload)
        : await updateRequestDraft(attempt.id, attempt.expectedRevision, attempt.payload);
    if (attempt.kind === 'create' && result.replayed) {
      // The creation had already landed. Its current revision is whatever the server
      // holds now — ours if nobody has touched it since, otherwise a conflict.
      const stored = await loadEditableAggregate(attempt.id);
      if (!stored) throw new CommandError('not_found', 404);
      if (!aggregateMatches(stored, attempt.payload, attempt.actorProfileId)) throw new Conflict(attempt.id, stored.request.revision);
      return stored.request.revision;
    }
    return result.revision;
  }

  /**
   * Settles an attempt whose outcome was unknown. Create: repeat it exactly (the
   * server recognises the repetition). Update: read the aggregate — unchanged
   * revision means it did not land, so repeat it; our content at a newer revision
   * means it landed; anything else is someone else's work.
   */
  async function settle(attempt: Attempt): Promise<number> {
    if (attempt.kind === 'create') return send(attempt);
    const stored = await loadEditableAggregate(attempt.id);
    if (!stored) throw new CommandError('not_found', 404);
    if (stored.request.revision === attempt.expectedRevision) return send(attempt);
    if (aggregateMatches(stored, attempt.payload, attempt.actorProfileId)) return stored.request.revision;
    throw new Conflict(attempt.id, stored.request.revision);
  }

  function finish(id: string, created: boolean, thenPreview: boolean) {
    if (thenPreview) {
      navigate(`${base}/${id}/preview`);
    } else if (created) {
      navigate(`${base}/${id}`, { replace: true, state: { flash: 'Rascunho guardado.' } });
    } else {
      setNotice({ kind: 'saved', text: 'Rascunho guardado.' });
    }
  }

  async function save(thenPreview: boolean, overwriteRevision?: number) {
    // One save at a time, whatever triggered it: a double click, Enter, or a retry.
    if (saving.current) return;
    setNotice(null);
    const clientErrors = validate(form);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) {
      focusSummary();
      return;
    }

    saving.current = true;
    setBusy(true);
    let id = requestId;
    let rev = overwriteRevision ?? revision;
    const created = id === null;
    const payloadNow = toPayload(form, id ? null : organization.id);

    try {
      // 1. An attempt with an unknown outcome is settled first, with its own payload.
      if (pending) {
        rev = await settle(pending);
        id = pending.id;
        setRequestId(id);
        setRevision(rev);
        const settledPayload = pending.payload;
        setPending(null);
        if (samePayload(settledPayload, payloadNow)) {
          finish(id, created, thenPreview);
          return;
        }
      }

      // 2. Then whatever is on screen now, as a new attempt.
      const attempt: Attempt =
        id === null
          ? { kind: 'create', id: createKey, payload: payloadNow, actorProfileId: actor?.id ?? null }
          : { kind: 'update', id, expectedRevision: rev ?? 0, payload: toPayload(form, null), actorProfileId: actor?.id ?? null };
      try {
        rev = await send(attempt);
      } catch (error) {
        if (error instanceof CommandError && error.ambiguous) setPending(attempt);
        throw error;
      }
      setRequestId(attempt.id);
      setRevision(rev);
      finish(attempt.id, created, thenPreview);
    } catch (error) {
      if (error instanceof Conflict) {
        // The unknown attempt is settled — as a conflict. Only an explicit choice
        // below writes anything further.
        setPending(null);
        setRequestId(error.requestId);
        setNotice({ kind: 'conflict', currentRevision: error.currentRevision });
      } else if (error instanceof CommandError && error.code === 'unauthenticated') {
        setNotice({ kind: 'session' });
      } else if (error instanceof CommandError && error.ambiguous) {
        setNotice({ kind: 'ambiguous' });
      } else if (error instanceof CommandError && error.code === 'stale_revision') {
        const current = (error.details as { current_revision?: number } | undefined)?.current_revision;
        setNotice({ kind: 'conflict', currentRevision: current ?? rev ?? 0 });
      } else {
        const serverErrors: Errors = {};
        if (error instanceof CommandError) for (const item of error.fieldErrors) serverErrors[item.field] = item.message;
        setErrors(serverErrors);
        setNotice({ kind: 'error', text: commandErrorMessage(error) });
      }
      focusSummary();
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  const dueIsPast = form.due ? isPast(fromDateInput(form.due) ?? '') : false;
  const questionCount = form.questions.length;

  return (
    <form
      id={formId}
      noValidate
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        void save(false);
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 20 }}
    >
      <div className="page-head">
        <div className="head-line">
          <Link className="btn btn--ghost btn--sm" to={base} style={{ marginLeft: -8 }}>
            <Icon name="back" size={18} />
            Pedidos
          </Link>
        </div>
        <div className="head-line">
          <h1>{existing ? 'Editar rascunho' : 'Novo pedido'}</h1>
          <span className="chip chip--neutral">
            <span className="chip__dot" aria-hidden="true" />
            Rascunho
          </span>
        </div>
        <p className="sub">
          Para guardar basta a pessoa, o tipo, o título, o que precisa que faça e o esforço. O resto pode ficar
          para depois: é pedido ao publicar.
        </p>
      </div>

      <div ref={summaryRef} tabIndex={-1} style={{ outline: 'none' }}>
        {notice?.kind === 'saved' ? (
          <div className="banner banner--ok" role="status">
            <Icon name="check" size={20} />
            <p>{notice.text}</p>
          </div>
        ) : null}

        {notice?.kind === 'session' ? <SessionExpiredNotice unsavedWork /> : null}

        {notice?.kind === 'ambiguous' ? (
          <div className="banner banner--warn" role="alert">
            <Icon name="alert" size={20} />
            <div>
              <span className="banner__title">Não sabemos se a última gravação chegou ao servidor.</span>
              <p>
                A ligação falhou depois do envio. As suas alterações continuam neste formulário. «Verificar e guardar»
                confirma primeiro esse envio, sem o duplicar, e só depois guarda o que mudou entretanto.
              </p>
              <p style={{ marginTop: 8 }}>
                <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void save(false)}>
                  <Icon name="refresh" size={16} />
                  Verificar e guardar
                </button>
              </p>
            </div>
          </div>
        ) : null}

        {notice?.kind === 'conflict' ? (
          <div className="banner banner--error" role="alert">
            <Icon name="alert" size={20} />
            <div>
              <span className="banner__title">Este rascunho foi alterado noutra sessão.</span>
              <p>As suas alterações continuam neste formulário e não foram guardadas. Escolha como continuar:</p>
              <p className="actions" style={{ marginTop: 8 }}>
                {onReload ? (
                  <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={onReload}>
                    Ver a versão guardada (descarta este formulário)
                  </button>
                ) : requestId ? (
                  <Link className="btn btn--secondary btn--sm" to={`${base}/${requestId}`}>
                    Ver a versão guardada (descarta este formulário)
                  </Link>
                ) : null}
                <button
                  type="button"
                  className="btn btn--quiet btn--sm"
                  disabled={busy}
                  onClick={() => void save(false, notice.currentRevision)}
                >
                  Substituir pela minha versão
                </button>
              </p>
            </div>
          </div>
        ) : null}

        {notice?.kind === 'error' || (!notice && errorList.length > 0) ? (
          <div className="banner banner--error" role="alert">
            <Icon name="alert" size={20} />
            <div>
              <span className="banner__title">{notice?.kind === 'error' ? notice.text : 'Há campos a corrigir.'}</span>
              {errorList.length > 0 ? (
                <ul>
                  {errorList.map(([path, message]) => (
                    <li key={path}>
                      <a href={`#${idFor(path)}`}>{message}</a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* While a save is in flight every control is disabled: nothing can be typed that the save would not carry. */}
      <fieldset className="form-lock" disabled={busy}>
        <legend className="visually-hidden">Conteúdo do pedido</legend>
        <div className="split">
          <div className="zone">
            <span className="zone__tag zone__tag--partner">
              <Icon name="eye" size={16} />A parceira vai ver isto
            </span>
            <section className="panel" aria-label="Conteúdo para a parceira">
              <div className="panel__body panel__body--flush">
                <div className="form-grid">
                  <Field path="assignee_profile_id" label="Para quem" errors={errors} hint="Só membros activos desta organização.">
                    {(p) => (
                      <select {...p} value={form.assignee} onChange={(e) => set('assignee', e.target.value)}>
                        <option value="">Escolha…</option>
                        {activeMembers.map((m) => (
                          <option key={m.profile.id} value={m.profile.id}>
                            {m.profile.displayName}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>

                  <Field path="type" label="Tipo" errors={errors}>
                    {(p) => (
                      <select {...p} value={form.type} onChange={(e) => set('type', e.target.value as RequestType)}>
                        {REQUEST_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {REQUEST_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>

                  <div className="span-2">
                    <Field
                      path="title"
                      label="Título"
                      errors={errors}
                      hint={`Um pedido directo, nas palavras da parceira. Cabe melhor no cartão até cerca de 80 caracteres (${form.title.trim().length}/${LIMITS.title}).`}
                    >
                      {(p) => <input {...p} value={form.title} onChange={(e) => set('title', e.target.value)} />}
                    </Field>
                  </div>

                  <div className="span-2">
                    <Field path="context" label="Porque pedimos" optional errors={errors}>
                      {(p) => <textarea {...p} value={form.context} onChange={(e) => set('context', e.target.value)} />}
                    </Field>
                  </div>

                  <div className="span-2">
                    <Field path="requested_action" label="O que precisamos que faça" errors={errors} hint="Uma acção precisa. Evite “veja quando puder”.">
                      {(p) => (
                        <textarea {...p} value={form.requestedAction} onChange={(e) => set('requestedAction', e.target.value)} />
                      )}
                    </Field>
                  </div>

                  <Field path="product_id" label="Produto" optional errors={errors}>
                    {(p) => (
                      <select {...p} value={form.productId} onChange={(e) => set('productId', e.target.value)}>
                        <option value="">Nenhum</option>
                        {activeProducts.map((link) => (
                          <option key={link.product.id} value={link.product.id}>
                            {link.product.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>

                  <Field path="resource_id" label="Recurso associado" optional errors={errors} hint="Vem de Recursos. Não se escrevem endereços aqui.">
                    {(p) => (
                      <select {...p} value={form.resourceId} onChange={(e) => set('resourceId', e.target.value)}>
                        <option value="">Nenhum</option>
                        {offeredResources.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} · {resourceHost(r.url)}
                            {r.status !== 'active' || !r.partnerVisible ? ' (indisponível para a parceira)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>

                  <fieldset className="field span-2" aria-describedby={errors.estimated_effort_minutes ? `${idFor('estimated_effort_minutes')}-error` : undefined}>
                    <legend>Esforço estimado</legend>
                    <div className="choices" id={idFor('estimated_effort_minutes')}>
                      {EFFORT_PRESETS.map((minutes) => (
                        <label key={minutes}>
                          <input
                            type="radio"
                            name={`${formId}-effort`}
                            checked={form.effort === minutes}
                            onChange={() => set('effort', minutes)}
                          />
                          {formatEffort(minutes)}
                        </label>
                      ))}
                      <label>
                        <input
                          type="radio"
                          name={`${formId}-effort`}
                          checked={form.effort === 'other'}
                          onChange={() => set('effort', 'other')}
                        />
                        Outro
                      </label>
                    </div>
                    {form.effort === 'other' ? (
                      <div className="field" style={{ maxWidth: 220 }}>
                        <label htmlFor={`${idFor('estimated_effort_minutes')}-other`}>Minutos</label>
                        <input
                          id={`${idFor('estimated_effort_minutes')}-other`}
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          value={form.effortOther}
                          onChange={(e) => set('effortOther', e.target.value)}
                        />
                      </div>
                    ) : null}
                    <span className="field__hint">O pedido de onboarding tem ~3 min.</span>
                    {errors.estimated_effort_minutes ? (
                      <span className="field__error" id={`${idFor('estimated_effort_minutes')}-error`}>
                        {errors.estimated_effort_minutes}
                      </span>
                    ) : null}
                  </fieldset>

                  <Field
                    path="due_at"
                    label="Prazo"
                    optional
                    errors={errors}
                    hint="Termina às 23:59, hora de Lisboa, do dia escolhido. Só para uma dependência real: lançamento, reunião, evento, validade. Sem prazo, a parceira não vê nada."
                  >
                    {(p) => <input {...p} type="date" value={form.due} onChange={(e) => set('due', e.target.value)} />}
                  </Field>
                  {dueIsPast ? (
                    <div className="banner banner--warn span-2" role="status">
                      <Icon name="alert" size={20} />
                      <p>Este prazo já passou. Pode guardar e publicar, mas a parceira vê o prazo como ultrapassado.</p>
                    </div>
                  ) : null}
                </div>

                <div className="field">
                  <span style={{ fontSize: 15, fontWeight: 600 }} id={idFor('fields')}>
                    Perguntas
                  </span>
                  {form.type === 'approval' ? (
                    <div className="sys-q">
                      <strong>Geradas pelo sistema.</strong> A parceira escolhe “Aprovar” ou “Precisa de alterações” e, se
                      precisar de alterações, pode explicar o que deve mudar (opcional). Não é possível acrescentar outras
                      perguntas a uma aprovação.
                    </div>
                  ) : (
                    <>
                      <span className="field__hint">
                        {form.type === 'task'
                          ? 'Uma tarefa pode não ter perguntas.'
                          : 'Pergunta, revisão e teste precisam de pelo menos uma pergunta para publicar.'}{' '}
                        Tipos: texto, escolha única, sim/não.
                      </span>
                      {errors.fields ? <span className="field__error">{errors.fields}</span> : null}
                      {form.questions.map((q, i) => (
                        <div className="qedit" key={q.localId}>
                          <div className="qedit__head">
                            <span className="qedit__title">Pergunta {i + 1}</span>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              onClick={() => setForm((f) => ({ ...f, questions: f.questions.filter((_, k) => k !== i) }))}
                            >
                              Remover pergunta {i + 1}
                            </button>
                          </div>
                          <Field path={`fields[${i}].label`} label="Pergunta" errors={errors}>
                            {(p) => <input {...p} value={q.label} onChange={(e) => setQuestion(i, { label: e.target.value })} />}
                          </Field>
                          <div className="form-grid">
                            <Field path={`fields[${i}].type`} label="Tipo de resposta" errors={errors}>
                              {(p) => (
                                <select
                                  {...p}
                                  value={q.type}
                                  onChange={(e) => setQuestion(i, { type: e.target.value as AuthorFieldType })}
                                >
                                  {(Object.keys(FIELD_TYPE_LABELS) as AuthorFieldType[]).map((t) => (
                                    <option key={t} value={t}>
                                      {FIELD_TYPE_LABELS[t]}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </Field>
                            <label className="check" style={{ alignSelf: 'end', minHeight: 48 }}>
                              <input
                                type="checkbox"
                                checked={q.required}
                                onChange={(e) => setQuestion(i, { required: e.target.checked })}
                              />
                              Obrigatória
                            </label>
                          </div>
                          <Field path={`fields[${i}].help_text`} label="Ajuda" optional errors={errors}>
                            {(p) => <input {...p} value={q.helpText} onChange={(e) => setQuestion(i, { helpText: e.target.value })} />}
                          </Field>
                          {q.type === 'single_choice' ? (
                            <div className="qedit__options" id={idFor(`fields[${i}].options`)}>
                              <span className="field__hint">Para publicar: pelo menos duas opções diferentes.</span>
                              {errors[`fields[${i}].options`] ? (
                                <span className="field__error">{errors[`fields[${i}].options`]}</span>
                              ) : null}
                              {q.options.map((o, j) => (
                                <div className="qedit__option" key={j}>
                                  <Field path={`fields[${i}].options[${j}]`} label={`Opção ${j + 1}`} errors={errors}>
                                    {(p) => (
                                      <input
                                        {...p}
                                        value={o}
                                        onChange={(e) =>
                                          setQuestion(i, { options: q.options.map((x, k) => (k === j ? e.target.value : x)) })
                                        }
                                      />
                                    )}
                                  </Field>
                                  <button
                                    type="button"
                                    className="btn btn--ghost btn--sm"
                                    style={{ marginTop: 30 }}
                                    onClick={() => setQuestion(i, { options: q.options.filter((_, k) => k !== j) })}
                                  >
                                    Retirar opção {j + 1}
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                className="btn btn--quiet btn--sm"
                                style={{ alignSelf: 'flex-start' }}
                                onClick={() => setQuestion(i, { options: [...q.options, ''] })}
                              >
                                <Icon name="plus" size={16} />
                                Acrescentar opção
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn btn--quiet btn--sm"
                        style={{ alignSelf: 'flex-start' }}
                        disabled={questionCount >= LIMITS.fields}
                        onClick={() => setForm((f) => ({ ...f, questions: [...f.questions, newQuestion()] }))}
                      >
                        <Icon name="plus" size={16} />
                        Acrescentar pergunta
                      </button>
                    </>
                  )}
                </div>
              </div>
            </section>
          </div>

          <div className="zone zone--internal">
            <span className="zone__tag zone__tag--internal">
              <Icon name="lock" size={16} />
              Só Sollelio · nunca chega à parceira
            </span>
            <section className="panel" aria-label="Detalhes internos">
              <div className="panel__body panel__body--flush">
                <Field
                  path="internal.completion_criteria"
                  label="Critério de conclusão"
                  errors={errors}
                  hint="Obrigatório para publicar. Conversa não é conclusão; estado explícito é."
                >
                  {(p) => <textarea {...p} value={form.criteria} onChange={(e) => set('criteria', e.target.value)} />}
                </Field>
                <Field
                  path="internal.internal_owner_profile_id"
                  label="Responsável interno"
                  errors={errors}
                  hint="Por omissão, quem guarda o critério. Fica guardado com o critério de conclusão."
                >
                  {(p) => (
                    <select {...p} value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)}>
                      <option value="">Eu</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.displayName}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <fieldset className="field">
                  <legend>Prioridade interna</legend>
                  <div className="choices" id={idFor('internal.priority')}>
                    {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                      <label key={p}>
                        <input
                          type="radio"
                          name={`${formId}-priority`}
                          checked={form.priority === p}
                          onChange={() => set('priority', p)}
                        />
                        {PRIORITY_LABELS[p]}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            </section>

            <div className="actions" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <button type="button" className="btn btn--primary" onClick={() => void save(true)}>
                <Icon name="eye" size={18} />
                {busy ? 'A guardar…' : 'Guardar e pré-visualizar'}
              </button>
              <button type="submit" className="btn btn--quiet">
                {busy ? 'A guardar…' : 'Guardar rascunho'}
              </button>
              {busy ? (
                <p className="field__hint" style={{ margin: 0, fontWeight: 600 }} aria-hidden="true">
                  A guardar… o formulário fica bloqueado até o servidor confirmar.
                </p>
              ) : null}
              <p className="field__hint" style={{ margin: 0 }}>
                {assigneeName
                  ? `Publicar é um passo à parte, depois de ver o pedido como ${assigneeName} o verá.`
                  : 'Publicar é um passo à parte, depois da pré-visualização.'}{' '}
                Guardar não envia nada à parceira.
              </p>
            </div>
          </div>
        </div>
      </fieldset>

      <p className="visually-hidden" role="status" aria-live="polite">
        {busy ? 'A guardar o rascunho. O formulário fica bloqueado até o servidor confirmar.' : ''}
      </p>
    </form>
  );
}
