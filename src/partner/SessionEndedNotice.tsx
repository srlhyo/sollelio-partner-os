/**
 * The partner's session ended while answering (03_UX_SPEC.md §5, §21).
 *
 * No silent redirect. Signing in happens through an email link that opens a new
 * page, and unsent answers live only on this one (never in browser storage), so the
 * notice says plainly that leaving loses them.
 */
import { Link, useLocation } from 'react-router-dom';
import { Icon } from '../platform/ui/Icon';
import { PARTNER_HOME, isSafeAppPath } from '../auth/destination';

export function SessionEndedNotice() {
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;
  const destination = isSafeAppPath(here) ? here : PARTNER_HOME;

  return (
    <div className="banner banner--error" role="alert">
      <Icon name="lock" size={20} />
      <div>
        <span className="banner__title">A sua sessão terminou.</span>
        <p>
          Para enviar, entre de novo: o link de acesso chega por email e traz-o de volta a este pedido. As respostas
          que ainda não enviou perdem-se ao sair desta página; se precisar delas, copie-as antes.
        </p>
        <p style={{ marginTop: 8 }}>
          <Link className="btn btn--secondary btn--sm" to={`/partner/sign-in?redirectTo=${encodeURIComponent(destination)}`}>
            Entrar de novo
          </Link>
        </p>
      </div>
    </div>
  );
}
