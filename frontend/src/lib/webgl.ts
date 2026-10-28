let cached: boolean | null = null

/** True when the browser can create a WebGL context. The result is cached. */
export function hasWebGL(): boolean {
  if (cached !== null) return cached
  try {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    cached = context !== null
    const lose = context?.getExtension('WEBGL_lose_context')
    lose?.loseContext()
  } catch {
    cached = false
  }
  return cached
}
