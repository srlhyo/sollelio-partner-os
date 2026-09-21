/**
 * `/partner/*` — the partner-facing surface.
 *
 * Phase 0 renders the shell only, to prove routing, session plumbing and the build.
 * Home, Request Detail, Resources and the sign-in screens are Slice 1/Slice 2 work,
 * designed mobile-first in pt-PT (03_UX_SPEC.md).
 */
import { SurfacePlaceholder } from '../platform/SurfacePlaceholder';

export function PartnerShell() {
  return (
    <SurfacePlaceholder
      surface="Parceira"
      route="/partner/*"
      note="As superfícies da parceira chegam na Fase 1."
    />
  );
}
