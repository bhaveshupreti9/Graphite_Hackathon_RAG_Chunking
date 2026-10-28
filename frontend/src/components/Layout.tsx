import { AnimatePresence, MotionConfig, motion, useScroll, useTransform } from 'framer-motion'
import { Suspense } from 'react'
import { useLocation, useOutlet } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { ROUTES } from '@/lib/constants'
import { useAppStore } from '@/store/useAppStore'
import { ErrorBoundary } from './ErrorBoundary'
import { LoadingState } from './LoadingState'
import { Navbar } from './Navbar'

/** Subtle depth behind data-heavy pages: a grid and two glows that drift slower than the page. */
function BackgroundDepth() {
  const { scrollY } = useScroll()
  const gridY = useTransform(scrollY, [0, 2000], [0, -160])
  const glowY = useTransform(scrollY, [0, 2000], [0, -60])
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <motion.div
        style={{ y: gridY }}
        className="bg-grid absolute inset-x-0 -top-20 h-[140vh] opacity-40 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]"
      />
      <motion.div
        style={{ y: glowY }}
        className="absolute -right-40 -top-40 h-[36rem] w-[36rem] rounded-full bg-accent/10 blur-3xl"
      />
      <motion.div
        style={{ y: glowY }}
        className="absolute -left-48 top-1/3 h-[28rem] w-[28rem] rounded-full bg-type-prose/[0.06] blur-3xl"
      />
    </div>
  )
}

export function Layout() {
  const location = useLocation()
  const outlet = useOutlet()
  const isLanding = location.pathname === ROUTES.landing
  const appTheme = useAppStore((state) => state.appTheme)
  // The landing page and intro are designed for dark; every other page follows the toggle.
  const theme = isLanding ? 'dark' : appTheme
  // Set before children render so 3D scenes and charts read this theme's colour tokens.
  if (typeof document !== 'undefined' && document.documentElement.dataset.theme !== theme) {
    document.documentElement.dataset.theme = theme
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        {isLanding ? null : <BackgroundDepth />}
        <Navbar />
        <main
          id="main"
          className={cn(
            'flex-1',
            isLanding ? 'w-full' : 'mx-auto w-full max-w-page px-4 pb-16 pt-8 sm:px-6',
          )}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              // Theme in the key remounts the page so charts and 3D scenes pick up the new colours.
              key={`${location.pathname}:${theme}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              <ErrorBoundary label="page" resetKey={location.pathname}>
                <Suspense fallback={<LoadingState />}>{outlet}</Suspense>
              </ErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>
        {isLanding ? null : (
          <footer className="border-t border-border px-4 py-6 text-center text-xs text-muted">
            Both chatbots share the embedder, vector database settings, top-k, prompt, LLM and
            temperature 0. Only the chunking differs.
          </footer>
        )}
      </div>
    </MotionConfig>
  )
}
