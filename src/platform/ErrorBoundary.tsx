/**
 * Baseline application error handling.
 *
 * Catches render-time failures so a broken surface never shows a blank page. Copy is
 * Portuguese (pt-PT) on every surface (04_TECHNICAL_ARCHITECTURE.md §21).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from './logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('Unhandled render error', {
      error: error.message,
      componentStack: info.componentStack,
    });
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <main
        role="alert"
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
        <h1 style={{ margin: 0, fontSize: '24px' }}>Algo correu mal deste lado.</h1>
        <p style={{ margin: 0, maxWidth: '40ch' }}>
          Já registámos o problema. Atualize a página — se continuar, avise a Sollelio.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            alignSelf: 'flex-start',
            minHeight: '44px',
            padding: '0 20px',
            borderRadius: '12px',
            border: '1px solid #3030A8',
            background: '#3030A8',
            color: '#FFFFFF',
            font: '600 16px system-ui, sans-serif',
            cursor: 'pointer',
          }}
        >
          Atualizar a página
        </button>
      </main>
    );
  }
}
