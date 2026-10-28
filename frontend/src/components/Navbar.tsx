import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { logout } from '@/api/client'
import { useApiStatus } from '@/hooks/useApiStatus'
import { useIsMock } from '@/hooks/useIsMock'
import { cn } from '@/lib/cn'
import { NAV_GROUPS, NAV_LINKS, ROUTES } from '@/lib/constants'
import type { NavGroup } from '@/lib/constants'
import { loadDemoDocument } from '@/lib/demo'
import { ENV_USE_MOCK } from '@/lib/env'
import { useAppStore } from '@/store/useAppStore'

const linkClass = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'block whitespace-nowrap rounded-md px-3 py-2 text-sm transition',
    isActive ? 'bg-accent/15 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
  )

function NavDropdown({ group }: { group: NavGroup }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { pathname } = useLocation()
  const active = group.items.some((item) => pathname.startsWith(item.to))

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-2 text-sm transition hover:bg-surface-2 hover:text-fg',
          active ? 'text-fg' : 'text-muted',
        )}
      >
        {group.label}
        <span aria-hidden="true" className="text-[10px]">
          ▾
        </span>
      </button>
      {open ? (
        <ul className="card absolute left-0 top-full z-50 mt-2 min-w-52 space-y-1 p-2 shadow-xl">
          {group.items.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} className={linkClass}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function ThemeToggle() {
  const { pathname } = useLocation()
  const appTheme = useAppStore((state) => state.appTheme)
  const setAppTheme = useAppStore((state) => state.setAppTheme)
  // The landing and login pages are always dark, so the toggle would do nothing there.
  if (pathname === ROUTES.landing || pathname === ROUTES.login) return null
  const dark = appTheme === 'dark'
  const label = dark ? 'Switch to light theme' : 'Switch to dark theme'
  return (
    <button
      type="button"
      onClick={() => setAppTheme(dark ? 'light' : 'dark')}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface-2 text-muted transition hover:text-fg"
    >
      {dark ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  )
}

function AccountControls() {
  const auth = useAppStore((state) => state.auth)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [busy, setBusy] = useState(false)

  if (!auth) {
    if (pathname === ROUTES.login) return null
    return (
      <Link to={ROUTES.login} className="btn px-3 py-1.5 text-xs">
        Log in
      </Link>
    )
  }

  const signOut = async () => {
    setBusy(true)
    await logout()
    setBusy(false)
    navigate(ROUTES.login)
  }

  return (
    <div className="flex items-center gap-1 rounded-full border border-border bg-surface-2 py-1 pl-3 pr-1 text-xs">
      <span className="max-w-28 truncate text-fg" title={`Logged in as ${auth.username}`}>
        {auth.username}
      </span>
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={busy}
        className="rounded-full px-2 py-0.5 text-muted transition hover:bg-surface hover:text-fg"
      >
        Log out
      </button>
    </div>
  )
}

function NavControls() {
  const mock = useIsMock()
  const demoMode = useAppStore((state) => state.demoMode)
  const setDemoMode = useAppStore((state) => state.setDemoMode)
  const filename = useAppStore((state) => state.filename)
  const hasDocument = useAppStore((state) => state.doc_id !== null && state.processResult !== null)
  const { status, recheck } = useApiStatus(mock)

  const statusLabel = mock
    ? 'Demo data'
    : status === 'online'
      ? 'API online'
      : status === 'offline'
        ? 'API offline'
        : 'Checking API…'
  const dotClass = mock
    ? 'bg-accent'
    : status === 'online'
      ? 'bg-good'
      : status === 'offline'
        ? 'bg-bad'
        : 'bg-noise'

  return (
    <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
      {mock && !hasDocument ? (
        <button type="button" className="btn px-3 py-1.5 text-xs" onClick={loadDemoDocument}>
          Load demo document
        </button>
      ) : null}
      {hasDocument && filename ? (
        <span className="chip max-w-40 truncate xl:hidden 2xl:inline-flex" title={filename}>
          {filename}
        </span>
      ) : null}

      <button
        type="button"
        role="switch"
        aria-checked={mock}
        disabled={ENV_USE_MOCK}
        onClick={() => setDemoMode(!demoMode)}
        title={
          ENV_USE_MOCK
            ? 'Demo mode is forced on by VITE_USE_MOCK=true'
            : 'Use built-in sample data instead of the backend'
        }
        className="flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs text-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-70"
      >
        <span
          aria-hidden="true"
          className={cn(
            'relative inline-block h-4 w-7 rounded-full transition',
            mock ? 'bg-accent' : 'bg-border',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all',
              mock ? 'left-3.5' : 'left-0.5',
            )}
          />
        </span>
        Demo mode
      </button>

      <ThemeToggle />

      <AccountControls />

      <button
        type="button"
        onClick={recheck}
        disabled={mock}
        title={mock ? 'Using built-in demo data' : 'Check the backend again'}
        className="flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs text-muted transition hover:text-fg disabled:cursor-default"
      >
        <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', dotClass)} />
        <span role="status">{statusLabel}</span>
      </button>
    </div>
  )
}

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-nav w-full max-w-page items-center justify-between gap-4 px-4 sm:px-6">
        <Link to={ROUTES.landing} className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-sm text-white"
          >
            S
          </span>
          SmartChunk
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-0.5 xl:flex">
          {NAV_GROUPS.map((group) => (
            <NavDropdown key={group.label} group={group} />
          ))}
          {NAV_LINKS.map((item) => (
            <NavLink key={item.to} to={item.to} className={linkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden xl:block">
          <NavControls />
        </div>

        <button
          type="button"
          className="btn px-3 py-1.5 xl:hidden"
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          onClick={() => setMobileOpen((value) => !value)}
        >
          {mobileOpen ? 'Close' : 'Menu'}
        </button>
      </div>

      {mobileOpen ? (
        <nav
          id="mobile-nav"
          aria-label="Main (mobile)"
          className="max-h-[calc(100vh-var(--nav-h))] space-y-4 overflow-y-auto border-t border-border px-4 py-4 xl:hidden"
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-1 text-sm text-muted">{group.label}</p>
              <ul>
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} className={linkClass}>
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <ul>
            {NAV_LINKS.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} className={linkClass}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <NavControls />
        </nav>
      ) : null}
    </header>
  )
}
