/**
 * The explicit confirmation after a submission (03_UX_SPEC.md §5): never a silent
 * redirect. What still needs the partner is read again from the server — nothing is
 * removed on the assumption that the submission worked.
 */
import { Link } from 'react-router-dom';
import { Icon } from '../platform/ui/Icon';
import { useAsync } from '../platform/useAsync';
import { fetchPartnerAttention } from '../modules/requests/queries';
import { comparePartnerAttention } from '../modules/requests/order';
import { RequestCard } from './RequestCard';

export function SubmissionSuccess({ organizationId, title }: { organizationId: string; title: string }) {
  const remaining = useAsync(() => fetchPartnerAttention(organizationId), [organizationId]);

  return (
    <section className="sent" aria-labelledby="sent-title">
      <div className="banner banner--ok" role="status">
        <Icon name="check" size={20} />
        <div>
          <span className="banner__title" id="sent-title">
            Enviado. Já está connosco.
          </span>
          <p>A Sollelio vai rever a sua resposta a “{title}”. Se precisarmos de mais alguma coisa, volta a aparecer em “Precisa de si”.</p>
        </div>
      </div>

      {remaining.status === 'ready' && remaining.data.length > 0 ? (
        <div className="sent__more">
          <h2 className="attn__title">Ainda precisa de si</h2>
          <ul className="rq-list">
            {[...remaining.data].sort(comparePartnerAttention).map((request) => (
              <li key={request.id}>
                <RequestCard request={request} />
              </li>
            ))}
          </ul>
          <Link className="btn btn--quiet btn--block" to="/partner">
            Voltar ao início
          </Link>
        </div>
      ) : null}

      {remaining.status === 'error' ? (
        <Link className="btn btn--primary btn--block" to="/partner">
          Voltar ao início
        </Link>
      ) : null}

      {remaining.status === 'ready' && remaining.data.length === 0 ? (
        <div className="sent__more">
          <p>Era o último. Não há mais nada a precisar de si por agora.</p>
          <Link className="btn btn--primary btn--block" to="/partner">
            Voltar ao início
          </Link>
        </div>
      ) : null}
    </section>
  );
}
