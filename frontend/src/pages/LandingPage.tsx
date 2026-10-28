import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useIsSmallScreen, usePrefersReducedMotion } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/cn'
import { ROUTES } from '@/lib/constants'
import { hasWebGL } from '@/lib/webgl'
import { HeroFallback } from '@/three/HeroFallback'

gsap.registerPlugin(ScrollTrigger)

const HeroCanvas = lazy(() => import('@/three/HeroCanvas'))

// ---------------------------------------------------------------------------------------------
// Intro: video, then "Welcome" with dust blowing out behind the car, then the site fades in.
// To change it, edit only these constants. The video goes in frontend/public/ (served at "/").
// ---------------------------------------------------------------------------------------------
const INTRO_VIDEO_SRC = '/intro.mp4'
const INTRO_WELCOME_TEXT = 'Welcome'
/** Where the dust starts, as a fraction of the screen (0,0 = top-left). Put it behind the car. */
const INTRO_DUST_ORIGIN = { x: 0.32, y: 0.78 }
/** Direction the dust blows: -1 = to the left (car drives right), 1 = to the right. */
const INTRO_DUST_DIRECTION = -1
const INTRO_MAX_VIDEO_MS = 8000 // stop waiting for the video after this long
const INTRO_WELCOME_MS = 2600 // how long "Welcome" + dust stays before the site appears
const INTRO_SEEN_KEY = 'smartchunk-intro-seen'

interface DustParticle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number
  maxLife: number
  shade: number
}

/** Canvas dust cloud: particles burst out behind the car, drift, grow and fade. */
function DustCloud({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !active) return
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const resize = () => {
      canvas.width = window.innerWidth * ratio
      canvas.height = window.innerHeight * ratio
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const particles: DustParticle[] = []
    const started = performance.now()
    let last = started
    let frame = 0

    const spawn = (count: number) => {
      const ox = INTRO_DUST_ORIGIN.x * window.innerWidth
      const oy = INTRO_DUST_ORIGIN.y * window.innerHeight
      for (let i = 0; i < count; i += 1) {
        const speed = 120 + Math.random() * 420
        const spread = (Math.random() - 0.5) * 0.9
        particles.push({
          x: ox + (Math.random() - 0.5) * 30,
          y: oy + (Math.random() - 0.5) * 16,
          vx: INTRO_DUST_DIRECTION * speed * Math.cos(spread),
          vy: -Math.abs(speed * Math.sin(spread)) * 0.6 - Math.random() * 40,
          size: 6 + Math.random() * 18,
          life: 0,
          maxLife: 1.2 + Math.random() * 1.6,
          shade: 150 + Math.random() * 70,
        })
      }
    }

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (now - started < 1400) spawn(14)
      context.clearRect(0, 0, window.innerWidth, window.innerHeight)
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i]
        if (!p) continue
        p.life += dt
        if (p.life >= p.maxLife) {
          particles.splice(i, 1)
          continue
        }
        p.vx *= 1 - 1.6 * dt // air drag
        p.vy = p.vy * (1 - 1.2 * dt) - 12 * dt // dust rises slowly
        p.x += p.vx * dt
        p.y += p.vy * dt
        const t = p.life / p.maxLife
        const radius = p.size * (1 + t * 3.5)
        const alpha = (1 - t) * 0.32
        const gradient = context.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius)
        gradient.addColorStop(0, `rgba(${p.shade}, ${p.shade - 18}, ${p.shade - 40}, ${alpha})`)
        gradient.addColorStop(1, `rgba(${p.shade}, ${p.shade - 18}, ${p.shade - 40}, 0)`)
        context.fillStyle = gradient
        context.beginPath()
        context.arc(p.x, p.y, radius, 0, Math.PI * 2)
        context.fill()
      }
      if (particles.length > 0 || now - started < 1400) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [active])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  )
}

type IntroPhase = 'video' | 'welcome' | 'done'

function readIntroSeen(): boolean {
  try {
    return sessionStorage.getItem(INTRO_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

/** Full-screen intro shown once per browser tab session. Skipped with reduced motion. */
function IntroSplash() {
  const reduced = usePrefersReducedMotion()
  const [phase, setPhase] = useState<IntroPhase>(() =>
    reduced || readIntroSeen() ? 'done' : 'video',
  )

  const finish = useCallback(() => {
    try {
      sessionStorage.setItem(INTRO_SEEN_KEY, '1')
    } catch {
      // Storage unavailable: the intro will simply play again next time.
    }
    setPhase('done')
  }, [])

  const toWelcome = useCallback(
    () => setPhase((current) => (current === 'video' ? 'welcome' : current)),
    [],
  )

  useEffect(() => {
    if (phase === 'video') {
      const timer = window.setTimeout(toWelcome, INTRO_MAX_VIDEO_MS)
      return () => window.clearTimeout(timer)
    }
    if (phase === 'welcome') {
      const timer = window.setTimeout(finish, INTRO_WELCOME_MS)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [phase, toWelcome, finish])

  useEffect(() => {
    if (phase === 'done') return
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      document.removeEventListener('keydown', onKey)
    }
  }, [phase, finish])

  return (
    <AnimatePresence>
      {phase !== 'done' ? (
        <motion.div
          key="intro"
          role="dialog"
          aria-label="Intro"
          className="fixed inset-0 z-[100] overflow-hidden bg-black"
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 0.8, ease: 'easeInOut' }}
        >
          <video
            className="absolute inset-0 h-full w-full object-cover"
            src={INTRO_VIDEO_SRC}
            autoPlay
            muted
            playsInline
            preload="auto"
            onEnded={toWelcome}
            onError={toWelcome}
          />
          <DustCloud active={phase === 'welcome'} />
          <AnimatePresence>
            {phase === 'welcome' ? (
              <motion.h2
                key="welcome"
                className="absolute inset-0 flex items-center justify-center text-6xl font-bold text-white [text-shadow:0_4px_40px_rgb(0_0_0/0.6)] sm:text-8xl"
                initial={{ opacity: 0, scale: 1.25, filter: 'blur(12px)', letterSpacing: '0.3em' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', letterSpacing: '0em' }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
              >
                {INTRO_WELCOME_TEXT}
              </motion.h2>
            ) : null}
          </AnimatePresence>
          <button
            type="button"
            onClick={finish}
            className="btn absolute bottom-6 right-6 border-white/30 bg-black/40 text-white backdrop-blur hover:bg-black/60"
          >
            Skip intro
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

interface Stage {
  name: string
  title: string
  body: string
}

/** The six scroll-story stages from spec C5, in order. Plain language, matching spec A1. */
const STAGES: readonly Stage[] = [
  {
    name: 'Problem',
    title: 'Fixed-size chunking cuts blindly',
    body: 'Most RAG pipelines slice a document every few hundred tokens, wherever the cut happens to land. Functions, tables and lists are split in half, and each half is retrieved on its own, so the model is handed broken pieces.',
  },
  {
    name: 'LLM',
    title: 'A language model only knows what is in its prompt',
    body: 'A large language model (LLM) writes text by predicting the next words from the words it was given. It has never read your document. To answer questions about it, the right passages have to be placed in the prompt.',
  },
  {
    name: 'Context window',
    title: 'The prompt has a hard size limit',
    body: 'The context window is the most text a model can read at once, measured in tokens: 8,192 here. A full manual does not fit, so only a handful of chunks can go in. Every chunk has to be worth its space.',
  },
  {
    name: 'RAG',
    title: 'Retrieve the right chunks, then answer',
    body: 'Retrieval-augmented generation (RAG) finds the chunks most similar to the question and pastes only those into the prompt. The answer can only be as good as the chunks that were retrieved.',
  },
  {
    name: 'Vector DB',
    title: 'Meaning becomes coordinates',
    body: 'Each chunk is turned into an embedding, a list of numbers that captures what it means, and stored in a vector database (ChromaDB). Chunks about the same thing sit close together, so finding relevant text is a nearest-neighbour search.',
  },
  {
    name: 'Solution',
    title: 'SmartChunk cuts along the document’s own seams',
    body: 'SmartChunk keeps code blocks, tables and lists whole, splits prose where the topic changes, removes repeated headers, footers and duplicates, and labels every chunk with its heading path and page. Same embedder, same database, same model. Only the chunking changes.',
  },
]

/** The headline, sliced like the blade does it: the lower half shifts once on load. */
/**
 * Headline whose last word is sliced in two, like a chunker cutting through a code block.
 * Only that word is cut, so the effect stays the width of the word on every screen size and
 * never collides with the line above.
 */
function SlicedHeadline({ text, reduced }: { text: string; reduced: boolean }) {
  const words = text.trim().split(/\s+/)
  const cutWord = words.pop() ?? ''
  const firstLine = words.slice(0, 2).join(' ')
  const secondLine = words.slice(2).join(' ')
  const ease = [0.22, 1, 0.36, 1] as const

  return (
    <h1 className="text-5xl font-bold tracking-tight !leading-[1.14] sm:text-6xl lg:text-[4.6rem]">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="block">
        {firstLine}
      </span>
      <span aria-hidden="true" className="block">
        {secondLine ? `${secondLine} ` : null}
        <span className="relative inline-block">
          <span className="block [clip-path:inset(-10%_-10%_50%_-10%)]">{cutWord}</span>
          <motion.span
            className="absolute inset-0 block text-fg/75 [clip-path:inset(50%_-10%_-10%_-10%)]"
            initial={{ x: 0, y: 0 }}
            animate={{ x: reduced ? 7 : [0, 0, 7], y: reduced ? 4 : [0, 0, 4] }}
            transition={{ duration: 0.9, times: [0, 0.6, 1], ease, delay: 0.5 }}
          >
            {cutWord}
          </motion.span>
          <motion.span
            className="absolute -left-1 -right-1 top-1/2 block h-[2px] origin-left -translate-y-1/2 rounded-full bg-bad"
            initial={{ scaleX: reduced ? 1 : 0, opacity: 1 }}
            animate={{ scaleX: 1, opacity: reduced ? 0.7 : [1, 1, 0.7] }}
            transition={{ duration: 0.9, times: [0, 0.6, 1], ease, delay: 0.5 }}
          />
        </span>
      </span>
    </h1>
  )
}

export default function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState(0)
  const reduced = usePrefersReducedMotion()
  const small = useIsSmallScreen()
  const webgl = useMemo(() => hasWebGL(), [])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const context = gsap.context(() => {
      ScrollTrigger.create({
        trigger: root.querySelector('[data-hero]'),
        start: 'top top',
        end: 'bottom center',
        onToggle: (self) => {
          if (self.isActive) setStage(0)
        },
      })
      gsap.utils.toArray<HTMLElement>('[data-stage]').forEach((panel) => {
        const index = Number(panel.dataset.stage ?? 0)
        ScrollTrigger.create({
          trigger: panel,
          start: 'top 55%',
          end: 'bottom 55%',
          onToggle: (self) => {
            if (self.isActive) setStage(index)
          },
        })
        if (!reduced) {
          gsap.fromTo(
            panel.querySelector('[data-panel]'),
            { autoAlpha: 0.15, y: 60 },
            {
              autoAlpha: 1,
              y: 0,
              ease: 'none',
              scrollTrigger: { trigger: panel, start: 'top 85%', end: 'top 45%', scrub: true },
            },
          )
        }
      })
    }, root)
    return () => context.revert()
  }, [reduced])

  const scrollToStage = (index: number) => {
    const panel = rootRef.current?.querySelector(`[data-stage="${index}"]`)
    panel?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
  }

  return (
    <div ref={rootRef} className="relative">
      <IntroSplash />
      <div className="relative">
        {/* Sticky 3D scene behind the story. */}
        <div className="sticky top-0 h-[100svh] w-full overflow-hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[radial-gradient(70rem_40rem_at_70%_40%,rgb(var(--c-accent)/0.14),transparent_65%)]"
          />
          <div className={cn('absolute inset-0', small && 'opacity-30')}>
            {webgl ? (
              <ErrorBoundary
                label="3D scene"
                fallback={() => <HeroFallback className="p-8 lg:pl-[40%]" />}
              >
                <Suspense fallback={<HeroFallback className="p-8 opacity-40 lg:pl-[40%]" />}>
                  <HeroCanvas stage={stage} compact={small} />
                </Suspense>
              </ErrorBoundary>
            ) : (
              <HeroFallback className="p-8 lg:pl-[40%]" />
            )}
          </div>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg to-transparent"
          />
        </div>

        <div className="relative -mt-[100svh]">
          <section
            data-hero
            className="mx-auto flex min-h-[100svh] max-w-page items-center px-4 pb-24 pt-nav sm:px-6"
          >
            <div className="max-w-xl space-y-7">
              <SlicedHeadline text="Stop cutting code in half." reduced={reduced} />
              <p className="max-w-md text-lg text-fg/80">
                SmartChunk is a structure-aware chunking engine for RAG. Upload a document and ask
                two identical chatbots about it: one reads fixed-size chunks, the other reads
                SmartChunk.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link to={ROUTES.upload} className="btn btn-primary px-5 py-2.5 text-base">
                  Upload a document
                </Link>
                <Link to={ROUTES.howItWorks} className="btn px-5 py-2.5 text-base">
                  How it works
                </Link>
              </div>
              <p className="text-sm text-muted">Scroll to see why chunking decides the answer.</p>
            </div>
          </section>

          {STAGES.map((item, index) => (
            <section
              key={item.name}
              data-stage={index}
              aria-labelledby={`stage-${index}`}
              className="mx-auto flex min-h-[100svh] max-w-page items-center px-4 sm:px-6"
            >
              <div
                data-panel
                className="max-w-md rounded-[var(--radius-lg)] border border-border bg-bg/80 p-6 shadow-2xl backdrop-blur-md sm:p-8"
              >
                <p className="mb-3 flex items-center gap-3 text-sm text-muted">
                  <span className="font-mono text-accent">{index + 1}/6</span>
                  {item.name}
                </p>
                <h2 id={`stage-${index}`} className="text-2xl font-semibold sm:text-3xl">
                  {item.title}
                </h2>
                <p className="mt-4 leading-7 text-fg/80">{item.body}</p>
                {index === STAGES.length - 1 ? (
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link to={ROUTES.upload} className="btn btn-primary">
                      Try it with a document
                    </Link>
                    <Link to={ROUTES.evaluation} className="btn">
                      See the evaluation
                    </Link>
                  </div>
                ) : null}
              </div>
            </section>
          ))}
        </div>

        {/* Stage rail: shows where you are in the story and jumps between stages. */}
        <nav
          aria-label="Story stages"
          className="pointer-events-none fixed right-4 top-1/2 z-30 hidden -translate-y-1/2 lg:block"
        >
          <ol className="pointer-events-auto space-y-2">
            {STAGES.map((item, index) => (
              <li key={item.name}>
                <button
                  type="button"
                  onClick={() => scrollToStage(index)}
                  aria-current={stage === index ? 'step' : undefined}
                  className="group flex items-center justify-end gap-3 py-0.5 text-right"
                >
                  <span
                    className={cn(
                      'text-xs transition-opacity',
                      stage === index
                        ? 'text-fg opacity-100'
                        : 'text-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
                    )}
                  >
                    {item.name}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      'block h-1.5 rounded-full transition-all',
                      stage === index ? 'w-6 bg-accent' : 'w-3 bg-border group-hover:bg-muted',
                    )}
                  />
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </div>

      <section className="border-t border-border bg-surface/40">
        <div className="mx-auto grid max-w-page gap-10 px-4 py-20 sm:px-6 md:grid-cols-[1.2fr_1fr] md:items-end">
          <div className="space-y-4">
            <h2 className="text-3xl font-semibold sm:text-4xl">
              Run the comparison on your own file
            </h2>
            <p className="max-w-lg text-fg/75">
              Drop in a PDF, Markdown, text, CSV or Excel file. You will see every chunk both
              methods produced, where the traditional chunker broke a code block or table, and how
              the two chatbots answer the same question.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 md:justify-end">
            <Link to={ROUTES.upload} className="btn btn-primary px-5 py-2.5 text-base">
              Upload a document
            </Link>
            <Link to={ROUTES.compareAnswers} className="btn px-5 py-2.5 text-base">
              Compare answers
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
