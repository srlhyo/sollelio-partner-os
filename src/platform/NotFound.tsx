/**
 * Unknown route. No dead ends: always offer a way back (03_UX_SPEC.md §1).
 */
import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <main className="partner">
      <div className="partner__body" style={{ paddingTop: 48 }}>
        <h1 style={{ fontSize: 26 }}>Não encontrámos esta página.</h1>
        <Link to="/partner" className="btn btn--secondary" style={{ alignSelf: 'flex-start' }}>
          Voltar ao início
        </Link>
      </div>
    </main>
  );
}
