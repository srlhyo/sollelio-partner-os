/**
 * Reads that belong to one version of a Request.
 *
 * The editable aggregate (row, internal details, fields) and the preview bundle
 * (partner projection + internal row) are each read by more than one query. A
 * change landing between them would mix versions, so each read is checked against
 * the aggregate revision and retried; after a few attempts the caller is told to
 * try again rather than being shown a mixture.
 */
import { previewRequest } from './commands';
import { fetchInternalRequest, fetchRequestFields, fetchRequestRevision } from './queries';
import type { InternalRequest, RequestFieldRecord, RequestPreview } from './types';

export class InconsistentReadError extends Error {
  constructor() {
    super('O pedido mudou enquanto era lido. Tente novamente.');
  }
}

export interface EditableAggregate {
  request: InternalRequest;
  fields: RequestFieldRecord[];
}

interface AggregateSources {
  fetchInternalRequest: (id: string) => Promise<InternalRequest | null>;
  fetchRequestFields: (id: string) => Promise<RequestFieldRecord[]>;
  fetchRequestRevision: (id: string) => Promise<number | null>;
}

const defaultAggregateSources: AggregateSources = { fetchInternalRequest, fetchRequestFields, fetchRequestRevision };

/** Row + internal details (one query) and fields, confirmed to be one revision. */
export async function loadEditableAggregate(
  id: string,
  sources: AggregateSources = defaultAggregateSources,
  attempts = 3,
): Promise<EditableAggregate | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const request = await sources.fetchInternalRequest(id);
    if (!request) return null;
    const fields = await sources.fetchRequestFields(id);
    const revision = await sources.fetchRequestRevision(id);
    if (revision === request.revision) return { request, fields };
  }
  throw new InconsistentReadError();
}

interface PreviewSources {
  previewRequest: (id: string) => Promise<RequestPreview>;
  fetchInternalRequest: (id: string) => Promise<InternalRequest | null>;
}

const defaultPreviewSources: PreviewSources = { previewRequest, fetchInternalRequest };

/**
 * The partner-facing preview and the internal row (recipient, completion criterion)
 * of the same revision. The two stay separate objects: nothing internal is mixed
 * into the partner projection.
 */
export async function loadPreviewBundle(
  id: string,
  sources: PreviewSources = defaultPreviewSources,
  attempts = 3,
): Promise<{ preview: RequestPreview; internal: InternalRequest | null }> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const [preview, internal] = await Promise.all([sources.previewRequest(id), sources.fetchInternalRequest(id)]);
    if (!internal || internal.revision === preview.revision) return { preview, internal };
  }
  throw new InconsistentReadError();
}
