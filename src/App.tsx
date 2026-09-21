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
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { NotFound } from './platform/NotFound';
import { SignIn } from './auth/SignIn';
import { CheckEmail } from './auth/CheckEmail';
import { LinkExpired } from './auth/LinkExpired';
import { RequireSession } from './auth/RequireSession';
import { PartnerHome } from './partner/PartnerHome';
import { PartnerResources } from './partner/PartnerResources';
import { RequireStaff } from './internal/RequireStaff';
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
          <RequireSession>
            <PartnerHome />
          </RequireSession>
        }
      />
      <Route
        path="/partner/resources"
        element={
          <RequireSession>
            <PartnerResources />
          </RequireSession>
        }
      />

      {/* Sollelio internal surface */}
      <Route path="/app" element={<Navigate to="/app/organizations" replace />} />
      <Route
        path="/app/organizations"
        element={
          <RequireSession>
            <RequireStaff>
              <OrganizationsList />
            </RequireStaff>
          </RequireSession>
        }
      />
      <Route
        path="/app/organizations/:slug/*"
        element={
          <RequireSession>
            <RequireStaff>
              <OrganizationDetail />
            </RequireStaff>
          </RequireSession>
        }
      />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
