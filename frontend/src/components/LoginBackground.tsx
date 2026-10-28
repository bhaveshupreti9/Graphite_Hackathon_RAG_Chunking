import { useEffect, useRef } from 'react'

/**
 * The login page's animated background: a flowing band of particles over a twinkling star field
 * that moves away from the mouse. Drawn on one canvas behind the page content. It draws a single
 * still frame when the user prefers reduced motion, uses fewer particles on small screens, and
 * stops completely when the page is left.
 */
export function LoginBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const count = window.innerWidth < 700 ? 4000 : window.innerWidth < 1200 ? 7000 : 11000

    type Particle = { u: number; v: number; s: number; p: number; z: number }
    type Star = { x: number; y: number; p: number; s: number }
    const particles: Particle[] = []
    const stars: Star[] = []
    for (let i = 0; i < count; i += 1) {
      const spread = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5
      particles.push({
        u: Math.random(),
        v: Math.max(-1, Math.min(1, spread)),
        s: 0.5 + Math.random() * 0.9,
        p: Math.random() * 6.28,
        z: Math.random() < 0.1 ? 2 : 1,
      })
    }
    for (let i = 0; i < 500; i += 1) {
      stars.push({
        x: Math.random(),
        y: Math.random(),
        p: Math.random() * 6.28,
        s: 0.5 + Math.random() * 1.5,
      })
    }

    let width = 0
    let height = 0
    let time = 0
    let mouseX = -1e4
    let mouseY = -1e4
    let frameId = 0

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = width * ratio
      canvas.height = height * ratio
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    const onPointerMove = (event: PointerEvent) => {
      mouseX = event.clientX
      mouseY = event.clientY
    }
    const onPointerLeave = () => {
      mouseX = -1e4
      mouseY = -1e4
    }
    const bump = (u: number, mean: number, spread: number) => {
      const d = (u - mean) / spread
      return Math.exp(-d * d)
    }

    const draw = () => {
      context.clearRect(0, 0, width, height)
      context.fillStyle = '#fff'
      for (const star of stars) {
        context.globalAlpha = 0.12 + 0.25 * (0.5 + 0.5 * Math.sin(time * star.s + star.p))
        context.fillRect(star.x * width, star.y * height, 1, 1)
      }
      for (const q of particles) {
        const u = (q.u + time * 0.01 * q.s) % 1
        const centreY =
          height * (0.42 - 0.07 * bump(u, 0.22, 0.2) + 0.04 * bump(u, 0.8, 0.2)) +
          Math.sin(u * 6.28 + time * 0.5) * height * 0.035 +
          Math.sin(u * 14 - time * 0.35) * height * 0.012
        const thickness =
          height *
          (0.04 + 0.2 * bump(u, 0.22, 0.15) + 0.17 * bump(u, 0.82, 0.17)) *
          (1 + 0.1 * Math.sin(time * 0.6 + u * 5))
        const phi = u * 4.5 + time * 0.45
        let px =
          u * width + q.v * thickness * 0.35 * Math.sin(phi) + Math.sin(q.p + time * 1.3) * 1.2
        let py = centreY + q.v * thickness * Math.cos(phi) + Math.sin(q.p + time * 1.6) * 1.1
        const dx = px - mouseX
        const dy = py - mouseY
        const d2 = dx * dx + dy * dy
        if (d2 < 14400) {
          const push = (1 - d2 / 14400) * 26
          const d = Math.sqrt(d2) + 0.01
          px += (dx / d) * push
          py += (dy / d) * push
        }
        const edge = Math.pow(Math.abs(Math.sin(phi * 0.5 + q.v * 0.6)), 2.2)
        context.globalAlpha = Math.min(
          1,
          (0.2 + 0.8 * edge) * (0.4 + 0.6 * Math.min(1, thickness / (height * 0.1))),
        )
        context.fillRect(px, py, q.z, q.z)
      }
      context.globalAlpha = 1
    }

    const loop = () => {
      draw()
      time += 0.016
      frameId = window.requestAnimationFrame(loop)
    }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerleave', onPointerLeave)
    if (reduce) draw()
    else loop()

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [])

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 bg-black">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  )
}
