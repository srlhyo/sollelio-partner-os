/**
 * Organizations.
 *
 * A partner may select only organizations where they hold an active membership;
 * staff see all. RLS decides, not the query (05_DATA_MODEL_AND_API.md §12.4).
 */
import { supabase } from '../../platform/supabase';
import type { Organization } from './types';

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  status: Organization['status'];
}

/**
 * The organizations the signed-in partner actively belongs to.
 *
 * Returns every one of them. V0 assumes a single active membership, but the caller
 * must handle more than one by asking rather than picking
 * (05_DATA_MODEL_AND_API.md §1) — so this never truncates the list.
 */
export async function fetchMyActiveOrganizations(): Promise<Organization[]> {
  const { data, error } = await supabase
    .from('organization_memberships')
    .select('organizations(id, name, slug, status)')
    .eq('status', 'active')
    .returns<{ organizations: OrganizationRow | null }[]>();

  if (error) throw new Error(error.message);

  return (data ?? [])
    .map((row) => row.organizations)
    .filter((organization): organization is OrganizationRow => organization !== null);
}

/** Staff listing of every organization. */
export async function fetchAllOrganizations(): Promise<Organization[]> {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, slug, status')
    .order('name')
    .returns<OrganizationRow[]>();

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchOrganizationBySlug(slug: string): Promise<Organization | null> {
  const { data, error } = await supabase
    .from('organizations')
    .select('id, name, slug, status')
    .eq('slug', slug)
    .maybeSingle<OrganizationRow>();

  if (error) throw new Error(error.message);
  return data;
}
