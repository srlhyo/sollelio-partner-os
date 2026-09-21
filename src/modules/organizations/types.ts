export type OrganizationStatus = 'active' | 'inactive' | 'archived';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
}
