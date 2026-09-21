/**
 * The Phase 0 shell body.
 *
 * Exists to verify routing, environment wiring and session plumbing end to end. It
 * is replaced by real product surfaces in Slice 1 and carries no product meaning.
 */
import { env } from './env';
import { useSession } from './session-context';

const SESSION_LABEL: Record<string, string> = {
  loading: 'a verificar a sessão…',
  'signed-out': 'sem sessão iniciada',
  'signed-in': 'sessão iniciada',
};

export function SurfacePlaceholder({
  surface,
  route,
  note,
}: {
  surface: string;
  route: string;
  note: string;
}) {
  const session = useSession();

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '8px',
        padding: '24px',
        font: '16px/1.5 system-ui, sans-serif',
        color: '#25272B',
        background: '#F7F4EE',
      }}
    >
      <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#5A5E66' }}>
        Sollelio Partner OS · {env.appEnv}
      </p>
      <h1 style={{ margin: 0, fontSize: '24px' }}>Superfície {surface}</h1>
      <p style={{ margin: 0, color: '#5A5E66' }}>
        <code>{route}</code> · {SESSION_LABEL[session.status]}
      </p>
      <p style={{ margin: 0, maxWidth: '44ch', color: '#5A5E66' }}>{note}</p>
    </main>
  );
}
