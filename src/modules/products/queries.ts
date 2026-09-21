/**
 * Products linked to an organization.
 *
 * Staff-only: `products` and `organization_products` have no partner access at all,
 * the latter because it carries `external_tenant_id`, which is integration data
 * (05_DATA_MODEL_AND_API.md §12.4).
 */
import { supabase } from '../../platform/supabase';
import type { OrganizationProduct, Product } from './types';

interface Row {
  id: string;
  status: 'active' | 'inactive';
  external_tenant_id: string | null;
  products: Product | null;
}

export async function fetchOrganizationProducts(
  organizationId: string,
): Promise<OrganizationProduct[]> {
  const { data, error } = await supabase
    .from('organization_products')
    .select('id, status, external_tenant_id, products(id, key, name, type, status)')
    .eq('organization_id', organizationId)
    .returns<Row[]>();

  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((row): row is Row & { products: Product } => row.products !== null)
    .map((row) => ({
      id: row.id,
      status: row.status,
      externalTenantId: row.external_tenant_id,
      product: row.products,
    }));
}
