import { motion } from 'framer-motion'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { login, register } from '@/api/client'
import { toApiError } from '@/api/errors'
import type { LoginRedirectState } from '@/components/RequireAuth'
import { useIsMock } from '@/hooks/useIsMock'
import { ROUTES } from '@/lib/constants'
import { useAppStore } from '@/store/useAppStore'
import './LoginPage.css'

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
    <div className="sc-login">
      <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
      <p className="sc-login-sub">
        Your uploaded documents and their chunks are saved to your account, so you can open them
        again from the Knowledge Base any time.
      </p>

      <motion.section
        className="sc-login-card"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        <div className="sc-login-tabs" role="tablist">
          {(['login', 'register'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              className={mode === value ? 'on' : undefined}
              onClick={() => switchMode(value)}
            >
              {value === 'login' ? 'Log in' : 'Sign up'}
            </button>
          ))}
        </div>

        <form onSubmit={(event) => void submit(event)} noValidate>
          <div className="sc-login-field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              placeholder="e.g. aditya"
              autoComplete="username"
              autoFocus
              required
              minLength={3}
              maxLength={32}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
          <div className="sc-login-field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'register' ? 'At least 6 characters' : undefined}
              required
              minLength={mode === 'register' ? 6 : 1}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          {error ? (
            <p role="alert" className="sc-login-error">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="sc-login-go"
            disabled={busy || !username.trim() || !password}
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>

        <p className="sc-login-alt">
          {mode === 'login' ? 'New here? ' : 'Already have an account? '}
          <button type="button" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Create an account' : 'Log in'}
          </button>
        </p>
      </motion.section>

      {mock ? (
        <p className="sc-login-note">
          Demo mode is on: any username and password work, and nothing is sent to a server.
        </p>
      ) : null}
    </div>
  )
}
