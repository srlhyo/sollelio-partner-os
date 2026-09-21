export type ProductType = 'application' | 'website' | 'service' | 'other';

export interface Product {
  id: string;
  key: string;
  name: string;
  type: ProductType;
  status: 'active' | 'inactive' | 'archived';
}

export interface OrganizationProduct {
  id: string;
  status: 'active' | 'inactive';
  externalTenantId: string | null;
  product: Product;
}
