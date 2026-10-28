import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Short name used in the console message and the fallback text, e.g. "page" or "3D scene". */
  label?: string
  /** When this value changes the boundary resets (pass the route path for pages). */
  resetKey?: string
  /** Custom fallback. Defaults to a small inline message with a "Try again" button. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/** Catches render errors so one broken page or 3D scene never takes down the whole app. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary] ${this.props.label ?? 'component'} crashed:`, error, info)
  }

  componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)
    return (
      <div
        role="alert"
        className="card flex flex-col items-center gap-3 border-bad/40 p-8 text-center"
      >
        <h2 className="text-lg font-semibold">
          This {this.props.label ?? 'section'} hit a problem
        </h2>
        <p className="max-w-md text-sm text-muted">{error.message}</p>
        <button type="button" className="btn btn-primary" onClick={this.reset}>
          Try again
        </button>
      </div>
    )
  }
}
