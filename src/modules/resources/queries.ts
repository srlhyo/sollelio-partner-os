/**
 * Resources — the single source of truth for partner-facing canonical URLs
 * (05_DATA_MODEL_AND_API.md §3).
 *
 * Partner reads are additionally constrained by RLS to active, partner-visible rows
 * in an organization they actively belong to. The filters here mirror that so the
 * intent is legible at the call site; the database is what enforces it.
 */
import { supabase } from '../../platform/supabase';
import type { Resource } from './types';

interface ResourceRow {
  id: string;
  organization_id: string;
  product_id: string | null;
  name: string;
  type: Resource['type'];
  url: string;
  status: Resource['status'];
  partner_visible: boolean;
  sort_order: number;
}

const COLUMNS = 'id, organization_id, product_id, name, type, url, status, partner_visible, sort_order';

function toResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    organizationId: row.organization_id,
    productId: row.product_id,
    name: row.name,
    type: row.type,
    url: row.url,
    status: row.status,
    partnerVisible: row.partner_visible,
    sortOrder: row.sort_order,
  };
}

/** What the partner sees: active, partner-visible, in their organization. */
export async function fetchPartnerResources(organizationId: string): Promise<Resource[]> {
  const { data, error } = await supabase
    .from('resources')
    .select(COLUMNS)
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .eq('partner_visible', true)
    .order('sort_order')
    .returns<ResourceRow[]>();

  if (error) throw new Error(error.message);
  return (data ?? []).map(toResource);
}

/** Every resource of an organization, including superseded and internal-only. Staff. */
export async function fetchAllResources(organizationId: string): Promise<Resource[]> {
  const { data, error } = await supabase
    .from('resources')
    .select(COLUMNS)
    .eq('organization_id', organizationId)
    .order('status')
    .order('sort_order')
    .returns<ResourceRow[]>();

  if (error) throw new Error(error.message);
  return (data ?? []).map(toResource);
}
