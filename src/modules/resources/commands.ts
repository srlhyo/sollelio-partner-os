/**
 * Resource operations, all Sollelio-side.
 *
 * Partners never write here: they hold no INSERT or UPDATE grant on `resources`, so
 * a crafted request fails in the database, not in this file
 * (05_DATA_MODEL_AND_API.md §12.4, §12.5).
 *
 * These are ordinary writes under staff-only RLS rather than Edge Functions. The
 * rule that lifecycle changes go through privileged commands exists to stop
 * *partner-initiated* state changes; a staff operator editing a canonical link needs
 * no elevation beyond the policy that already gates it.
 *
 * Nothing here deletes. A replaced link is marked superseded so the history of what
 * the partner was told stays intact (02_OPERATING_MODEL.md §11).
 */
import { supabase } from '../../platform/supabase';
import type { Resource, ResourceType } from './types';

export interface NewResource {
  organizationId: string;
  name: string;
  type: ResourceType;
  url: string;
  productId: string | null;
  partnerVisible: boolean;
  sortOrder: number;
  createdBy: string;
}

export async function createResource(input: NewResource): Promise<void> {
  const { error } = await supabase.from('resources').insert({
    organization_id: input.organizationId,
    name: input.name.trim(),
    type: input.type,
    url: input.url.trim(),
    product_id: input.productId,
    partner_visible: input.partnerVisible,
    sort_order: input.sortOrder,
    created_by: input.createdBy,
  });

  if (error) throw new Error(error.message);
}

export interface ResourceEdit {
  name: string;
  url: string;
  type: ResourceType;
  partnerVisible: boolean;
  sortOrder: number;
}

export async function updateResource(id: string, edit: ResourceEdit): Promise<void> {
  const { error } = await supabase
    .from('resources')
    .update({
      name: edit.name.trim(),
      url: edit.url.trim(),
      type: edit.type,
      partner_visible: edit.partnerVisible,
      sort_order: edit.sortOrder,
    })
    .eq('id', id);

  if (error) throw new Error(error.message);
}

/**
 * Retire a canonical link without losing it.
 *
 * Superseded resources stay in internal history and stop being offered to the
 * partner. Publishing the Important Update that explains the change is Slice 3.
 */
export async function supersedeResource(id: string): Promise<void> {
  const { error } = await supabase
    .from('resources')
    .update({ status: 'superseded' })
    .eq('id', id);

  if (error) throw new Error(error.message);
}

export async function restoreResource(id: string): Promise<void> {
  const { error } = await supabase
    .from('resources')
    .update({ status: 'active', archived_at: null })
    .eq('id', id);

  if (error) throw new Error(error.message);
}

export async function archiveResource(id: string): Promise<void> {
  const { error } = await supabase
    .from('resources')
    .update({ status: 'archived', archived_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(error.message);
}

export type { Resource };
