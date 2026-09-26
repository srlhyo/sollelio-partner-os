/**
 * The session ended while working. Offers the existing sign-in flow with a safe
 * return to this page (03_UX_SPEC.md §20). Signing in happens through an email
 * link, which opens a new page: nothing unsaved on this one survives, so it says so.
 */
import { Link, useLocation } from 'react-router-dom';
import { Icon } from '../../platform/ui/Icon';
import { INTERNAL_HOME, isSafeAppPath } from '../../auth/destination';

export function SessionExpiredNotice({ unsavedWork }: { unsavedWork: boolean }) {
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;
  const destination = isSafeAppPath(here) ? here : INTERNAL_HOME;

  return (
    <div className="banner banner--error" role="alert">
      <Icon name="lock" size={20} />
      <div>
        <span className="banner__title">A sua sessão terminou.</span>
        <p>
          Entre de novo para continuar. O link de acesso chega por email e traz-o de volta a esta página.
          {unsavedWork ? ' As alterações que ainda não foram guardadas perdem-se ao sair desta página; se precisar delas, copie-as antes.' : ''}
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
