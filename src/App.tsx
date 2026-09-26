/**
 * Route map.
 *
 * Two surfaces, one application (04_TECHNICAL_ARCHITECTURE.md §5):
 *   /partner/* — partner-facing, mobile-first
 *   /app/*     — Sollelio internal, desktop-first
 *
 * They share infrastructure but are separate user experiences and separate security
 * surfaces. Route paths stay English: they are identifiers, like table and command
 * names. Everything a person reads is pt-PT.
 *
 * Each protected route declares the surface it belongs to, and the guard sends
 * anyone whose role belongs elsewhere to their own home. A magic link is minted
 * before the role is known, so the surface is settled here, on arrival.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { NotFound } from './platform/NotFound';
import { SignIn } from './auth/SignIn';
import { CheckEmail } from './auth/CheckEmail';
import { LinkExpired } from './auth/LinkExpired';
import { RequireSurface } from './auth/RequireSurface';
import { PartnerHome } from './partner/PartnerHome';
import { PartnerResources } from './partner/PartnerResources';
import { PartnerRequestDetail } from './partner/PartnerRequestDetail';
import { OrganizationsList } from './internal/OrganizationsList';
import { OrganizationDetail } from './internal/OrganizationDetail';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/partner" replace />} />

      {/* Partner surface */}
      <Route path="/partner/sign-in" element={<SignIn />} />
      <Route path="/partner/check-email" element={<CheckEmail />} />
      <Route path="/partner/link-expired" element={<LinkExpired />} />
      <Route
        path="/partner"
        element={
          <RequireSurface surface="partner">
            <PartnerHome />
          </RequireSurface>
        }
      />
      <Route
        path="/partner/requests/:id"
        element={
          <RequireSurface surface="partner">
            <PartnerRequestDetail />
          </RequireSurface>
        }
      />
      <Route
        path="/partner/resources"
        element={
          <RequireSurface surface="partner">
            <PartnerResources />
          </RequireSurface>
        }
      />

      {/* Sollelio internal surface */}
      <Route path="/app" element={<Navigate to="/app/organizations" replace />} />
      <Route
        path="/app/organizations"
        element={
          <RequireSurface surface="internal">
            <OrganizationsList />
          </RequireSurface>
        }
      />
      <Route
        path="/app/organizations/:slug/*"
        element={
          <RequireSurface surface="internal">
            <OrganizationDetail />
          </RequireSurface>
        }
      />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
