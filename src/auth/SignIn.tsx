/**
 * Sign in — magic link / email OTP.
 *
 * There is no password field anywhere in Partner OS
 * (04_TECHNICAL_ARCHITECTURE.md §20). The destination the person was trying to
 * reach travels through the link, so a deep link survives authentication
 * (03_UX_SPEC.md §20).
 */
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../platform/supabase';
import { logger } from '../platform/logger';
import { Icon, SollelioSymbol } from '../platform/ui/Icon';

export function AuthLockup() {
  return (
    <div className="auth__lockup">
      <img src="/sollelio-symbol-color.svg" alt="" width={44} height={44} />
      <span className="auth__product">Sollelio Partner OS</span>
    </div>
  );
}

export function AuthFooter() {
  return (
    <div className="auth__foot">
      <SollelioSymbol size={20} />
      <span>Um espaço da Sollelio para trabalhar consigo.</span>
    </div>
  );
}

export function SignIn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = params.get('redirectTo') ?? '/partner';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const address = email.trim();
    if (!address) {
      setError('Escreva o seu email para continuarmos.');
      return;
    }

    setSending(true);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: address,
      options: {
        emailRedirectTo: `${window.location.origin}${redirectTo}`,
        shouldCreateUser: false,
      },
    });
    setSending(false);

    if (sendError) {
      logger.warn('Magic link request failed', { reason: sendError.message });
      setError('Não conseguimos enviar o link. Verifique o email e tente outra vez.');
      return;
    }

    navigate(`/partner/check-email?email=${encodeURIComponent(address)}`, { replace: true });
  }

  return (
    <main className="auth">
      <AuthLockup />

      <div className="auth__card">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h1 style={{ fontSize: 28, lineHeight: 1.15 }}>Entrar</h1>
          <p style={{ margin: 0 }}>
            Escreva o seu email. Enviamos-lhe um link para entrar — sem palavra-passe.
          </p>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }} noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder="nome@empresa.pt"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-describedby={error ? 'email-error' : undefined}
              aria-invalid={error ? true : undefined}
            />
            {error ? (
              <p className="field__error" id="email-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <button type="submit" className="btn btn--primary btn--block" disabled={sending}>
            {sending ? 'A enviar…' : 'Enviar link de acesso'}
            {sending ? null : <Icon name="arrow" size={18} />}
          </button>
        </form>

        <p className="field__hint" style={{ margin: 0 }}>
          Só funciona com o email que a Sollelio registou para si.
        </p>
      </div>

      <div style={{ flexGrow: 1 }} />
      <AuthFooter />
    </main>
  );
}
