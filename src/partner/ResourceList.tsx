/**
 * Canonical access cards.
 *
 * One active access point per resource, in the order Sollelio set. Superseded URLs
 * never appear here — the partner is never offered a stale choice
 * (02_OPERATING_MODEL.md §11).
 */
import { Icon, type IconName } from '../platform/ui/Icon';
import { resourceHost, type Resource, type ResourceType } from '../modules/resources/types';

const ICONS: Record<ResourceType, IconName> = {
  product: 'app',
  website: 'globe',
  folder: 'folder',
  document: 'document',
  prototype: 'prototype',
  other: 'link',
};

export function ResourceList({ resources }: { resources: Resource[] }) {
  return (
    <ul className="resources">
      {resources.map((resource) => (
        <li key={resource.id}>
          <a
            className="resource"
            href={resource.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            <span className="resource__icon">
              <Icon name={ICONS[resource.type]} size={20} />
            </span>
            <span className="resource__text">
              <span className="resource__name">{resource.name}</span>
              <span className="resource__host">{resourceHost(resource.url)}</span>
            </span>
            <Icon name="external" size={18} />
            <span className="visually-hidden">(abre num separador novo)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
