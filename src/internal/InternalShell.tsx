/**
 * `/app/*` — the Sollelio internal surface.
 *
 * A separate user experience and a separate security surface from `/partner/*`
 * (04_TECHNICAL_ARCHITECTURE.md §5). Phase 0 renders the shell only.
 *
 * Route guards here are a user-experience concern. Security is enforced by RLS,
 * partner projections and domain commands — never by the router.
 */
import { SurfacePlaceholder } from '../platform/SurfacePlaceholder';

export function InternalShell() {
  return (
    <SurfacePlaceholder
      surface="Sollelio"
      route="/app/*"
      note="As superfícies internas chegam na Fase 1."
    />
  );
}
