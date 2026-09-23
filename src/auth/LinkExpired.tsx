/**
 * An email authentication link that can no longer be used.
 *
 * Supabase does not distinguish "expired" from "already used" — both come back as
 * `otp_expired` — so the copy does not claim to know which, and says both plainly.
 * It also names no lifetime: how long a link lasts is an operational Supabase
 * setting that differs between environments and can change, and the screen stays
 * accurate without depending on it.
 * Nothing about tokens, codes, parameters or status appears here.
 */
import { Link } from 'react-router-dom';
import { Icon } from '../platform/ui/Icon';
import { AuthFooter, AuthLockup } from './SignIn';

export function LinkExpired() {
  return (
    <main className="auth">
      <AuthLockup />

      <div className="auth__card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <span className="state__icon state__icon--warn" style={{ width: 48, height: 48 }}>
            <Icon name="clock" size={24} />
          </span>
          <h1 style={{ fontSize: 28, lineHeight: 1.15 }}>Este link já não funciona</h1>
          <p style={{ margin: 0 }}>
            Este link já foi usado ou entretanto expirou. Peça um novo e abra-o no mesmo
            telemóvel ou computador onde o pediu.
          </p>
          <p className="field__hint" style={{ margin: 0 }}>
            Vai voltar exatamente ao que estava a tentar abrir.
          </p>
        </div>

        <Link to="/partner/sign-in" className="btn btn--primary btn--block">
          Pedir novo link
          <Icon name="arrow" size={18} />
        </Link>
      </div>

      <div style={{ flexGrow: 1 }} />
      <AuthFooter />
    </main>
  );
}
