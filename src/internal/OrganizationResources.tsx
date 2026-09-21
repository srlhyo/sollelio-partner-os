/**
 * Managing canonical resources.
 *
 * These are ordinary writes under staff-only RLS. Nothing here deletes: a link that
 * is replaced becomes superseded, so what the partner was previously told stays in
 * the record (02_OPERATING_MODEL.md §11, 04_TECHNICAL_ARCHITECTURE.md §18).
 *
 * Publishing the Important Update that explains a change is Slice 3.
 */
import { useState, type FormEvent } from 'react';
import { useAsync } from '../platform/useAsync';
import { Icon } from '../platform/ui/Icon';
import { EmptyState, ErrorState, LoadingBlock } from '../platform/ui/States';
import { fetchAllResources } from '../modules/resources/queries';
import {
  archiveResource,
  createResource,
  restoreResource,
  supersedeResource,
} from '../modules/resources/commands';
import {
  RESOURCE_STATUS_LABELS,
  RESOURCE_TYPE_LABELS,
  resourceHost,
  type ResourceType,
} from '../modules/resources/types';
import type { Organization } from '../modules/organizations/types';
import { useCurrentProfile } from './useCurrentProfile';

const TYPES = Object.keys(RESOURCE_TYPE_LABELS) as ResourceType[];

export function OrganizationResources({ organization }: { organization: Organization }) {
  const profile = useCurrentProfile();
  const resources = useAsync(() => fetchAllResources(organization.id), [organization.id]);

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [type, setType] = useState<ResourceType>('product');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!name.trim() || !url.trim()) {
      setFormError('Indique o nome e o endereço.');
      return;
    }
    if (!/^https?:\/\//.test(url.trim())) {
      setFormError('O endereço tem de começar por http:// ou https://.');
      return;
    }
    if (!profile) {
      setFormError('Não conseguimos identificar quem está a criar o recurso.');
      return;
    }

    setBusy(true);
    try {
      const nextOrder =
        resources.status === 'ready'
          ? Math.max(0, ...resources.data.map((resource) => resource.sortOrder)) + 1
          : 0;

      await createResource({
        organizationId: organization.id,
        name,
        url,
        type,
        productId: null,
        partnerVisible: true,
        sortOrder: nextOrder,
        createdBy: profile.id,
      });
      setName('');
      setUrl('');
      resources.reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Não foi possível guardar.');
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      resources.reload();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'A operação falhou.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p style={{ margin: 0, color: 'var(--ink-2)', maxWidth: '68ch' }}>
        Esta lista é a única fonte dos endereços que a parceira vê. Um endereço substituído
        deixa de lhe aparecer, mas fica no histórico.
      </p>

      <form onSubmit={onCreate} className="panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 16 }}>Novo recurso</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          <div className="field">
            <label htmlFor="resource-name">Nome</label>
            <input
              id="resource-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Sollelio Events"
            />
          </div>
          <div className="field">
            <label htmlFor="resource-url">Endereço</label>
            <input
              id="resource-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://events.sollelio.com/…"
            />
          </div>
          <div className="field">
            <label htmlFor="resource-type">Tipo</label>
            <select
              id="resource-type"
              value={type}
              onChange={(event) => setType(event.target.value as ResourceType)}
            >
              {TYPES.map((value) => (
                <option key={value} value={value}>
                  {RESOURCE_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {formError ? (
          <p className="field__error" role="alert">
            {formError}
          </p>
        ) : null}

        <button type="submit" className="btn btn--primary btn--sm" style={{ alignSelf: 'flex-start' }} disabled={busy}>
          <Icon name="plus" size={18} />
          Adicionar recurso
        </button>
      </form>

      {resources.status === 'loading' ? <LoadingBlock label="A carregar recursos" /> : null}

      {resources.status === 'error' ? (
        <ErrorState onRetry={resources.reload}>Não foi possível carregar os recursos.</ErrorState>
      ) : null}

      {resources.status === 'ready' && resources.data.length === 0 ? (
        <EmptyState title="Ainda não há recursos." tone="warn">
          Adicione o primeiro endereço canónico acima.
        </EmptyState>
      ) : null}

      {resources.status === 'ready' && resources.data.length > 0 ? (
        <section className="panel">
          <div className="panel__head">
            <h2>Todos os recursos</h2>
            <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{resources.data.length}</span>
          </div>

          {resources.data.map((resource) => (
            <div key={resource.id} className="row">
              <span className="row__text">
                <span className="row__title">{resource.name}</span>
                <span className="row__meta">
                  {RESOURCE_TYPE_LABELS[resource.type]} · {resourceHost(resource.url)}
                  {resource.partnerVisible ? '' : ' · só Sollelio'}
                </span>
              </span>

              <span
                className={`chip chip--${
                  resource.status === 'active' ? 'green' : resource.status === 'superseded' ? 'amber' : 'neutral'
                }`}
              >
                {RESOURCE_STATUS_LABELS[resource.status]}
              </span>

              <span className="table-actions">
                {resource.status === 'active' ? (
                  <button
                    type="button"
                    className="btn btn--quiet btn--sm"
                    disabled={busy}
                    onClick={() => void run(() => supersedeResource(resource.id))}
                  >
                    Marcar substituído
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn--quiet btn--sm"
                    disabled={busy}
                    onClick={() => void run(() => restoreResource(resource.id))}
                  >
                    Reativar
                  </button>
                )}
                {resource.status !== 'archived' ? (
                  <button
                    type="button"
                    className="btn btn--quiet btn--sm"
                    disabled={busy}
                    onClick={() => void run(() => archiveResource(resource.id))}
                  >
                    Arquivar
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
