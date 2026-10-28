import { Canvas } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { cn } from '@/lib/cn'

interface SceneCanvasProps {
  children: ReactNode
  /** Shown if the 3D scene throws (lost context, driver bug...). */
  fallback: ReactNode
  camera: { position: [number, number, number]; fov: number }
  /** Reduced motion: render on demand only (the scene snaps instead of animating). */
  reduced: boolean
  dpr?: [number, number]
  className?: string
}

/**
 * Shared 3D canvas: caps the pixel ratio at 2, pauses rendering when the canvas is off-screen or the
 * tab is hidden, renders on demand with reduced motion, and falls back to 2D on errors.
 * The canvas is decorative (aria-hidden); every page keeps its real content in the DOM.
 */
export function SceneCanvas({
  children,
  fallback,
  camera,
  reduced,
  dpr = [1, 2],
  className,
}: SceneCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [onScreen, setOnScreen] = useState(true)
  const [tabVisible, setTabVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible',
  )

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => setOnScreen(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0 },
    )
    observer.observe(element)
    const onVisibility = () => setTabVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const frameloop = !onScreen || !tabVisible ? 'never' : reduced ? 'demand' : 'always'
  const cappedDpr: [number, number] = [dpr[0], Math.min(2, dpr[1])]

  return (
    <div ref={containerRef} aria-hidden="true" className={cn('relative h-full w-full', className)}>
      <ErrorBoundary label="3D scene" fallback={() => fallback}>
        <Canvas
          frameloop={frameloop}
          dpr={cappedDpr}
          camera={{ position: camera.position, fov: camera.fov, near: 0.1, far: 80 }}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        >
          {children}
        </Canvas>
      </ErrorBoundary>
    </div>
  )
}
