/**
 * "Check your email" is a designed screen, not a toast (03_UX_SPEC.md §20).
 *
 * It names no link lifetime. How long a link lasts is `otp_expiry`, an operational
 * Supabase setting that differs between environments and can change without this
 * code being touched — copy that quotes it starts lying the moment it does.
 */
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../platform/ui/Icon';
import { AuthFooter, AuthLockup } from './SignIn';

export function CheckEmail() {
  const [params] = useSearchParams();
  const email = params.get('email');

  return (
    <main className="auth">
      <AuthLockup />

      <div className="auth__card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span className="state__icon" style={{ background: 'var(--tint)', color: 'var(--indigo)', width: 48, height: 48 }}>
            <Icon name="mail" size={24} />
          </span>
          <h1 style={{ fontSize: 28, lineHeight: 1.15 }}>Veja o seu email</h1>
          <p style={{ margin: 0 }}>
            Enviámos um link para <strong>{email ?? 'o seu endereço'}</strong>. Abra-o neste
            telemóvel para entrar.
          </p>
          <p className="field__hint" style={{ margin: 0, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Icon name="clock" size={18} />
            <span>Leva-a diretamente ao que estava a abrir.</span>
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p className="field__hint" style={{ margin: 0 }}>
            Não chegou? Veja a pasta de spam ou peça um novo.
          </p>
          <Link to="/partner/sign-in" className="btn btn--secondary btn--block">
            <Icon name="refresh" size={18} />
            Pedir novo link
          </Link>
        </div>
      </div>

      <div style={{ flexGrow: 1 }} />
      <AuthFooter />
    </main>
  );
}
