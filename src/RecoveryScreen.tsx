import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Dumbbell, RefreshCw } from 'lucide-react'

export function RecoveryScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="vault-gate-page">
      <section className="vault-gate-card" role="alert">
        <div className="auth-brand"><span className="brand-mark"><Dumbbell size={20} /></span><span className="brand-copy"><strong>basic<span>pass</span></strong></span></div>
        <h1>Ton espace n’a pas pu s’ouvrir</h1>
        <p>{message}</p>
        <button className="save-button" onClick={onRetry}><RefreshCw size={18} />Réessayer</button>
      </section>
    </main>
  )
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Impossible d’afficher Basic Pass.', error, info.componentStack)
  }

  render() {
    if (this.state.failed) {
      return <RecoveryScreen message="Une erreur empêche l’affichage de ton espace. Recharge la page pour réessayer." onRetry={() => window.location.reload()} />
    }
    return this.props.children
  }
}
