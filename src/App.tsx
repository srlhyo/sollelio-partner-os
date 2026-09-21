/**
 * Route map.
 *
 * Two surfaces, one application (04_TECHNICAL_ARCHITECTURE.md §5):
 *   /partner/* — partner-facing
 *   /app/*     — Sollelio internal
 *
 * They share infrastructure but are separate user experiences and separate security
 * surfaces. Phase 0 establishes the split; the product surfaces themselves arrive
 * with their slices.
 */
import { Navigate, Route, Routes } from 'react-router-dom';
import { PartnerShell } from './partner/PartnerShell';
import { InternalShell } from './internal/InternalShell';
import { NotFound } from './platform/NotFound';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/partner" replace />} />
      <Route path="/partner/*" element={<PartnerShell />} />
      <Route path="/app/*" element={<InternalShell />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
