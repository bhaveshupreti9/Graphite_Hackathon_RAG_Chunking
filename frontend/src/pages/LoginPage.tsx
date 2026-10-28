import { motion } from 'framer-motion'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { login, register } from '@/api/client'
import { toApiError } from '@/api/errors'
import type { LoginRedirectState } from '@/components/RequireAuth'
import { useIsMock } from '@/hooks/useIsMock'
import { cn } from '@/lib/cn'
import { ROUTES } from '@/lib/constants'
import { useAppStore } from '@/store/useAppStore'

type Mode = 'login' | 'register'

function redirectTarget(state: unknown): string {
  const from = (state as Partial<LoginRedirectState> | null)?.from
  return typeof from === 'string' && from.startsWith('/') && from !== ROUTES.login
    ? from
    : ROUTES.knowledge
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const auth = useAppStore((state) => state.auth)
  const setAuth = useAppStore((state) => state.setAuth)
  const mock = useIsMock()

  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const target = redirectTarget(location.state)
  // Only redirect while actually on /login: during the exit animation this page re-renders with
  // the next page's location and must not navigate a second time.
  if (auth && location.pathname === ROUTES.login) return <Navigate to={target} replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (mode === 'register' && password.length < 6) {
      setError('Passwords need at least 6 characters.')
      return
    }
    setBusy(true)
    try {
      const credentials = { username: username.trim(), password }
      const result = mode === 'login' ? await login(credentials) : await register(credentials)
      setAuth({ username: result.username, token: result.token })
      navigate(target, { replace: true })
    } catch (caught) {
      const apiError = toApiError(caught)
      // Server messages for validation are specific ("Usernames are 3 to 32 characters…").
      setError(apiError.code === 'VALIDATION_ERROR' ? apiError.message : apiError.userMessage)
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 py-6 sm:py-12">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold">
          {mode === 'login' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="text-muted">
          Your uploaded documents and their chunks are saved to your account, so you can open them
          again from the Knowledge Base any time.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="panel p-6 shadow-xl"
      >
        <div role="tablist" className="mb-6 grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-1">
          {(['login', 'register'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              onClick={() => switchMode(value)}
              className={cn(
                'rounded px-3 py-2 text-sm font-medium transition',
                mode === value ? 'bg-surface text-fg shadow' : 'text-muted hover:text-fg',
              )}
            >
              {value === 'login' ? 'Log in' : 'Sign up'}
            </button>
          ))}
        </div>

        <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <label htmlFor="username" className="label">
              Username
            </label>
            <input
              id="username"
              className="input"
              autoComplete="username"
              autoFocus
              required
              minLength={3}
              maxLength={32}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="e.g. aditya"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="password" className="label">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="input"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'register' ? 6 : 1}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === 'register' ? 'At least 6 characters' : ''}
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={busy || !username.trim() || !password}
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted">
          {mode === 'login' ? 'New here? ' : 'Already have an account? '}
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? 'Create an account' : 'Log in'}
          </button>
        </p>
      </motion.div>

      {mock ? (
        <p className="text-center text-xs text-muted">
          Demo mode is on: any username and password work, and nothing is sent to a server.
        </p>
      ) : null}
    </div>
  )
}
