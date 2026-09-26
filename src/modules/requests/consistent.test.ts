/**
 * Multi-query reads must describe one revision. These tests interleave an edit
 * between the reads deterministically, with a call-by-call script.
 */
import { describe, expect, it } from 'vitest';
import { InconsistentReadError, loadEditableAggregate, loadPreviewBundle } from './consistent';
import type { InternalRequest, RequestFieldRecord, RequestPreview } from './types';

const request = (revision: number, title: string): InternalRequest => ({
  id: 'r1', organizationId: 'o1', productId: null, resourceId: null, type: 'question', status: 'draft', nextActor: 'none',
  title, context: null, requestedAction: 'x', estimatedEffortMinutes: 3, assigneeProfileId: 'p1', dueAt: null,
  createdBy: 's', createdAt: '2026-09-25T10:00:00Z', publishedAt: null, updatedAt: '2026-09-25T10:00:00Z', revision,
  internal: null,
});
const field = (label: string): RequestFieldRecord => ({
  id: label, request_id: 'r1', key: 'q1', label, help_text: null, type: 'boolean', required: true, options: null,
  sort_order: 1, system_generated: false,
});

describe('loadEditableAggregate', () => {
  it('discards a read with an edit between the row and the fields, and returns one revision', async () => {
    // Server timeline: v3 {title A, field A} → edit lands → v4 {title B, field B}.
    let version = 3;
    const calls: string[] = [];
    const sources = {
      fetchInternalRequest: async () => {
        calls.push(`row@${version}`);
        return request(version, version === 3 ? 'A' : 'B');
      },
      fetchRequestFields: async () => {
        if (calls.length === 1) version = 4; // the interleaved edit, after the first row read
        calls.push(`fields@${version}`);
        return [field(version === 3 ? 'A' : 'B')];
      },
      fetchRequestRevision: async () => {
        calls.push(`revision@${version}`);
        return version;
      },
    };

    const result = await loadEditableAggregate('r1', sources);
    expect(calls).toEqual(['row@3', 'fields@4', 'revision@4', 'row@4', 'fields@4', 'revision@4']);
    expect(result?.request.revision).toBe(4);
    expect(result?.request.title).toBe('B');
    expect(result?.fields.map((f) => f.label)).toEqual(['B']); // never v3's row with v4's fields
  });

  it('gives up with a clear error instead of returning a mixture', async () => {
    let version = 1;
    const sources = {
      fetchInternalRequest: async () => request(version, 'x'),
      fetchRequestFields: async () => {
        version += 1; // an edit lands during every attempt
        return [];
      },
      fetchRequestRevision: async () => version,
    };
    await expect(loadEditableAggregate('r1', sources)).rejects.toBeInstanceOf(InconsistentReadError);
  });
});

describe('loadPreviewBundle', () => {
  it('re-reads until the preview and the internal row are the same revision', async () => {
    const preview = (revision: number) => ({ revision, request_id: 'r1' }) as unknown as RequestPreview;
    const script = [
      { preview: 5, internal: 4 }, // the internal row was read before an edit landed
      { preview: 5, internal: 5 },
    ];
    let i = 0;
    const sources = {
      previewRequest: async () => preview(script[i]?.preview ?? 0),
      fetchInternalRequest: async () => {
        const step = script[i];
        i += 1;
        return request(step?.internal ?? 0, 'x');
      },
    };
    const result = await loadPreviewBundle('r1', sources);
    expect(i).toBe(2);
    expect(result.preview.revision).toBe(5);
    expect(result.internal?.revision).toBe(5);
  });
});
