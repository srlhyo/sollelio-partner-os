export type ResourceType =
  | 'product'
  | 'website'
  | 'folder'
  | 'document'
  | 'prototype'
  | 'other';

export type ResourceStatus = 'active' | 'superseded' | 'archived';

export interface Resource {
  id: string;
  organizationId: string;
  productId: string | null;
  name: string;
  type: ResourceType;
  url: string;
  status: ResourceStatus;
  partnerVisible: boolean;
  sortOrder: number;
}

export const RESOURCE_TYPE_LABELS: Record<ResourceType, string> = {
  product: 'Produto',
  website: 'Site',
  folder: 'Pasta de ficheiros',
  document: 'Documento',
  prototype: 'Protótipo',
  other: 'Outro',
};

export const RESOURCE_STATUS_LABELS: Record<ResourceStatus, string> = {
  active: 'Ativo',
  superseded: 'Substituído',
  archived: 'Arquivado',
};

/** The host shown under a resource name, so the partner recognises where it goes. */
export function resourceHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
