/**
 * Unknown route. No dead ends: always offer a way back (03_UX_SPEC.md §1).
 */
import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '12px',
        padding: '24px',
        font: '16px/1.5 system-ui, sans-serif',
        color: '#25272B',
        background: '#F7F4EE',
      }}
    >
      <h1 style={{ margin: 0, fontSize: '24px' }}>Não encontrámos esta página.</h1>
      <Link to="/partner" style={{ color: '#3030A8', fontWeight: 600 }}>
        Voltar ao início
      </Link>
    </main>
  );
}
