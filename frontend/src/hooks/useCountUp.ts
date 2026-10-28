import { useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from './useMediaQuery'

/** Animates from the previous value to `target` (ease-out). Jumps straight there with reduced motion. */
export function useCountUp(target: number, durationMs = 900): number {
  const reduced = usePrefersReducedMotion()
  const [value, setValue] = useState(reduced ? target : 0)
  const fromRef = useRef(reduced ? target : 0)

  useEffect(() => {
    if (reduced) {
      fromRef.current = target
      setValue(target)
      return
    }
    const from = fromRef.current
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      const next = from + (target - from) * eased
      setValue(next)
      fromRef.current = next
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, durationMs, reduced])

  return value
}
